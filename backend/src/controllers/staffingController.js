const mongoose = require('mongoose');
const Classroom = require('../models/zone3_school/Classroom');
const Employee = require('../models/zone2_hr/Employee');
const LeaveRequest = require('../models/zone2_hr/LeaveRequest');
const StaffShift = require('../models/zone2_hr/StaffShift');
const StaffHandover = require('../models/zone2_hr/StaffHandover');
const StaffReplacement = require('../models/zone2_hr/StaffReplacement');
const Notification = require('../models/zone1_system/Notification');
const { inTransaction, audit } = require('../services/credentialService');
const auditedCreate = (req, Model, fields, action) => inTransaction(async (session) => {
  const [record] = await Model.create([fields], { session });
  await audit(req.user, action, Model.modelName, record._id, {}, record.toObject(), session);
  return record;
});
const auditedUpdate = (req, Model, filter, fields, action) => inTransaction(async (session) => {
  const before = await Model.findOne(filter).session(session).lean();
  if (!before) throw fail('Phân công đã thay đổi hoặc không còn hoạt động', 409);
  const record = await Model.findOneAndUpdate(filter, { $set: fields, $inc: { __v: 1 } }, { new: true, runValidators: true, session });
  await audit(req.user, action, Model.modelName, record._id, before, record.toObject(), session);
  return record;
});
const { getStaffingSnapshot, leaveOn, weekdayOf, worksOn } = require('../services/staffingService');
const { addWorkDays, getWorkDate, isValidWorkDate, isValidTime } = require('../utils/dateHelpers');

const fail = (message, status = 422) => Object.assign(new Error(message), { status });
const respond = (res, error) => res.status(error.code === 11000 ? 409 : error.statusCode || error.status || 500).json({ message: error.code === 11000 ? 'Phân công này đã tồn tại' : error.message });
const id = (value) => mongoose.isValidObjectId(value);
const notifyAssignment = async (recipientId, title, message, actorId, key) => {
  if (!recipientId) return;
  try {
    await Notification.updateOne({ deduplicationKey: key }, { $setOnInsert: { recipientId, title, message, type: 'info', link: '/my-staffing', createdBy: actorId, deduplicationKey: key } }, { upsert: true });
  } catch (error) { console.error('Không thể gửi thông báo phân công:', error); }
};
const sharedShiftDay = (first, second) => {
  const occurrence = (shift, date) => {
    if (date < shift.validFrom || date > shift.validUntil || !shift.weekdays.includes(weekdayOf(date))) return null;
    const minutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
    const base = Date.parse(`${date}T00:00:00.000Z`);
    const start = base + minutes(shift.startTime) * 60000;
    const end = base + minutes(shift.endTime) * 60000 + (shift.endTime < shift.startTime ? 86400000 : 0);
    return { start, end };
  };
  const maxFrom = first.validFrom > second.validFrom ? first.validFrom : second.validFrom;
  const minUntil = first.validUntil < second.validUntil ? first.validUntil : second.validUntil;
  for (let day = addWorkDays(maxFrom, -1), count = 0; day <= addWorkDays(minUntil, 1) && count < 9; day = addWorkDays(day, 1), count++) {
    const a = occurrence(first, day);
    if (!a) continue;
    for (const otherDay of [addWorkDays(day, -1), day, addWorkDays(day, 1)]) {
      const b = occurrence(second, otherDay);
      if (b && a.start < b.end && b.start < a.end) return true;
    }
  }
  return false;
};

const getStaffing = async (req, res) => {
  try {
    const date = req.query.date || getWorkDate();
    if (!isValidWorkDate(date)) throw fail('Ngày xem phân công không hợp lệ');
    const [snapshot, shifts] = await Promise.all([getStaffingSnapshot(date), StaffShift.find({ status: 'active', validUntil: { $gte: date } }).sort({ role: 1, name: 1 }).lean()]);
    res.json({ data: { ...snapshot, shifts } });
  } catch (error) { respond(res, error); }
};

const getMyStaffing = async (req, res) => {
  try {
    const date = req.query.date || getWorkDate();
    if (!isValidWorkDate(date)) throw fail('Ngày xem phân công không hợp lệ');
    const employee = await Employee.findOne({ userId: req.user._id }).select('_id fullName').lean();
    if (!employee) return res.json({ data: { date, classrooms: [], duties: [] } });
    const snapshot = await getStaffingSnapshot(date);
    const classrooms = snapshot.classrooms.filter((item) => item.assigned.some((entry) => idOf(entry._id) === idOf(employee._id)) ||
      item.replacements.some((entry) => idOf(entry._id) === idOf(employee._id)));
    const duties = snapshot.duties.filter((item) => idOf(item.employeeId) === idOf(employee._id) || idOf(item.replacement?._id) === idOf(employee._id));
    res.json({ data: { date, classrooms, duties } });
  } catch (error) { respond(res, error); }
};

const idOf = (value) => String(value?._id || value || '');

const assignClassroomStaff = async (req, res) => {
  try {
    if (!id(req.params.id)) throw fail('Lớp học không hợp lệ');
    const { homeroomTeacherId, supportTeacherIds = [], requiredTeachers = 1, teachingWeekdays = [1, 2, 3, 4, 5] } = req.body || {};
    if (!Array.isArray(supportTeacherIds) || !Number.isInteger(Number(requiredTeachers)) || Number(requiredTeachers) < 1 || Number(requiredTeachers) > 5) throw fail('Số giáo viên cần của lớp phải từ 1 đến 5');
    if (!Array.isArray(teachingWeekdays) || !teachingWeekdays.length || teachingWeekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw fail('Ngày học trong tuần không hợp lệ');
    const teacherIds = [...new Set([homeroomTeacherId, ...supportTeacherIds].filter(Boolean).map(String))];
    if (teacherIds.some((value) => !id(value))) throw fail('ID giáo viên không hợp lệ');
    const classroom = await Classroom.findById(req.params.id);
    if (!classroom || classroom.status !== 'active') throw fail('Không tìm thấy lớp đang hoạt động', 404);
    const profiles = await Employee.find({ userId: { $in: teacherIds }, status: 'active' }).populate('userId', 'role status profile username');
    if (profiles.length !== teacherIds.length || profiles.some((employee) => employee.userId?.role !== 'teacher' || employee.userId?.status !== 'active')) throw fail('Chỉ phân công giáo viên đang làm việc và có tài khoản hợp lệ');
    if (await StaffHandover.exists({ employeeId: { $in: profiles.map((employee) => employee._id) }, kind: 'resignation', status: 'scheduled' })) throw fail('Giáo viên đã hẹn nghỉ việc. Không thể phân công lớp mới.', 409);
    const conflicts = await Classroom.find({ _id: { $ne: classroom._id }, schoolYear: classroom.schoolYear, status: 'active',
      $or: [{ homeroomTeacherId: { $in: teacherIds } }, { teachers: { $elemMatch: { teacherId: { $in: teacherIds }, role: { $in: ['homeroom', 'support'] } } } }] }).select('name').lean();
    if (conflicts.length) throw fail(`Giáo viên đã được phân công lớp ${conflicts.map((item) => item.name).join(', ')} trong năm học này`, 409);
    const byUser = new Map(profiles.map((employee) => [String(employee.userId._id), employee]));
    classroom.homeroomTeacherId = homeroomTeacherId || null;
    classroom.teachers = [...(classroom.teachers || []).filter((entry) => entry.role === 'subject' && !teacherIds.includes(String(entry.teacherId))),
      ...teacherIds.map((userId) => ({ teacherId: userId, teacherName: byUser.get(userId).fullName,
        role: userId === String(homeroomTeacherId) ? 'homeroom' : 'support', assignedAt: new Date() }))];
    classroom.requiredTeachers = Number(requiredTeachers);
    classroom.teachingWeekdays = [...new Set(teachingWeekdays)];
    const saved = await auditedUpdate(req, Classroom, { _id: classroom._id, __v: classroom.__v }, { homeroomTeacherId: classroom.homeroomTeacherId, teachers: classroom.teachers.toObject(), requiredTeachers: classroom.requiredTeachers, teachingWeekdays: classroom.teachingWeekdays }, 'CLASSROOM_STAFF_ASSIGNED');
    res.json({ message: 'Đã lưu phân công giáo viên của lớp', data: saved });
  } catch (error) { respond(res, error); }
};

const createShift = async (req, res) => {
  try {
    const { employeeId, name, startTime, endTime, weekdays, validFrom, validUntil } = req.body || {};
    if (!id(employeeId) || !String(name || '').trim() || !isValidTime(startTime) || !isValidTime(endTime) || startTime === endTime ||
      !isValidWorkDate(validFrom) || !isValidWorkDate(validUntil) || validUntil < validFrom ||
      !Array.isArray(weekdays) || !weekdays.length || weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw fail('Thông tin ca trực không hợp lệ');
    const employee = await Employee.findById(employeeId).populate('userId', 'role status');
    if (!employee || !['chef', 'guard'].includes(employee.userId?.role) || employee.status !== 'active' || employee.userId.status !== 'active') throw fail('Chỉ phân ca cho nhân viên bếp hoặc bảo vệ đang hoạt động');
    if (await StaffHandover.exists({ employeeId, kind: 'resignation', status: 'scheduled' })) throw fail('Nhân viên đã hẹn nghỉ việc. Không thể phân ca mới.', 409);
    const days = [...new Set(weekdays)];
    const overlaps = await StaffShift.find({ employeeId, status: 'active', validFrom: { $lte: addWorkDays(validUntil, 1) }, validUntil: { $gte: addWorkDays(validFrom, -1) } }).lean();
    if (overlaps.some((shift) => sharedShiftDay(shift, { validFrom, validUntil, weekdays: days }))) throw fail('Nhân viên đã có ca trong một hoặc nhiều ngày trùng lịch. Hãy kết thúc ca cũ trước.', 409);
    const created = await auditedCreate(req, StaffShift, { employeeId, role: employee.userId.role, name: String(name).trim(), startTime, endTime, weekdays: days, validFrom, validUntil, createdBy: req.user._id }, 'STAFF_SHIFT_CREATED');
    await notifyAssignment(employee.userId._id, 'Bạn có ca làm mới', `${created.name}: ${startTime}–${endTime}, từ ${validFrom} đến ${validUntil}. Xem lịch phân công để biết các ngày làm.`, req.user._id, `shift-created:${created._id}`);
    res.status(201).json({ message: 'Đã phân ca làm việc', data: created });
  } catch (error) { respond(res, error); }
};

const cancelShift = async (req, res) => {
  try {
    if (!id(req.params.id)) throw fail('Ca trực không hợp lệ');
    if (await StaffReplacement.exists({ shiftId: req.params.id, status: 'active', date: { $gte: getWorkDate() } })) throw fail('Ca đã có người thay trong hôm nay hoặc tương lai. Hãy hủy phân công thay thế trước.', 409);
    const shift = await auditedUpdate(req, StaffShift, { _id: req.params.id, status: 'active' }, { status: 'cancelled', cancelledAt: new Date(), cancelledBy: req.user._id }, 'STAFF_SHIFT_CANCELLED');
    if (!shift) throw fail('Không tìm thấy ca đang hoạt động', 404);
    const employee = await Employee.findById(shift.employeeId).select('userId').lean();
    await notifyAssignment(employee?.userId, 'Ca làm đã kết thúc', `Ca ${shift.name} (${shift.validFrom}–${shift.validUntil}) đã được kết thúc.`, req.user._id, `shift-cancelled:${shift._id}`);
    res.json({ message: 'Đã kết thúc phân ca', data: shift });
  } catch (error) { respond(res, error); }
};

const createReplacement = async (req, res) => {
  try {
    const { date, kind, classroomId, shiftId, absentEmployeeId, replacementEmployeeId, note = '' } = req.body || {};
    if (!isValidWorkDate(date) || !['classroom', 'shift'].includes(kind) || !id(absentEmployeeId) || !id(replacementEmployeeId) ||
      String(absentEmployeeId) === String(replacementEmployeeId) || String(note).length > 500) throw fail('Thông tin thay thế không hợp lệ');
    const [absent, replacement, leaves] = await Promise.all([
      Employee.findById(absentEmployeeId).populate('userId', 'role status'),
      Employee.findById(replacementEmployeeId).populate('userId', 'role status'),
      LeaveRequest.find({ employeeId: absentEmployeeId, status: 'approved' }).select('startDate endDate workDates status').lean()
    ]);
    if (!absent || !replacement || replacement.status !== 'active' || replacement.userId?.status !== 'active') throw fail('Nhân viên thay thế phải đang làm việc');
    if (!leaves.some((leave) => leaveOn(leave, date))) throw fail('Chỉ phân người thay khi nhân viên vắng có đơn nghỉ đã duyệt trong ngày này', 409);
    const replacementLeaves = await LeaveRequest.find({ employeeId: replacementEmployeeId, status: 'approved' }).select('startDate endDate workDates status').lean();
    if (replacementLeaves.some((leave) => leaveOn(leave, date))) throw fail('Người thay cũng đang nghỉ phép trong ngày này', 409);
    let target;
    if (kind === 'classroom') {
      if (!id(classroomId) || absent.userId?.role !== 'teacher' || replacement.userId?.role !== 'teacher') throw fail('Thay lớp chỉ áp dụng cho giáo viên');
      target = await Classroom.findOne({ _id: classroomId, status: 'active' });
      if (!target || ![target.homeroomTeacherId, ...(target.teachers || []).map((entry) => entry.teacherId)].some((value) => String(value) === String(absent.userId._id))) throw fail('Giáo viên vắng không được phân công lớp này');
      if (!(target.teachingWeekdays || [1, 2, 3, 4, 5]).includes(weekdayOf(date))) throw fail('Lớp không có lịch học trong ngày này');
      if (await Classroom.exists({ status: 'active', schoolYear: target.schoolYear, $or: [{ homeroomTeacherId: replacement.userId._id }, { 'teachers.teacherId': replacement.userId._id }] })) throw fail('Giáo viên thay đã được phân công lớp trong năm học này', 409);
    } else {
      if (!id(shiftId) || !['chef', 'guard'].includes(absent.userId?.role) || replacement.userId?.role !== absent.userId.role) throw fail('Người thay ca phải cùng vai trò bếp hoặc bảo vệ');
      target = await StaffShift.findOne({ _id: shiftId, status: 'active', employeeId: absentEmployeeId });
      if (!target || !worksOn(target, date)) throw fail('Nhân viên vắng không có ca này trong ngày đã chọn');
      const ownShifts = await StaffShift.find({ employeeId: replacementEmployeeId, status: 'active', validFrom: { $lte: date }, validUntil: { $gte: date } }).lean();
      if (ownShifts.some((shift) => worksOn(shift, date))) throw fail('Người thay đã có ca làm trong ngày này', 409);
    }
    if (await StaffReplacement.exists({ date, replacementEmployeeId, status: 'active' })) throw fail('Người thay đã nhận một phân công khác trong ngày', 409);
    const created = await auditedCreate(req, StaffReplacement, { date, kind, classroomId: kind === 'classroom' ? target._id : null,
      shiftId: kind === 'shift' ? target._id : null, absentEmployeeId, replacementEmployeeId, note: String(note).trim(), createdBy: req.user._id }, 'STAFF_REPLACEMENT_CREATED');
    await notifyAssignment(replacement.userId._id, 'Bạn được phân công thay thế', `Ngày ${date}: ${kind === 'classroom' ? `phụ trách lớp ${target.name}` : `thay ca ${target.name}`}.${note ? ` Ghi chú: ${note}` : ''}`, req.user._id, `replacement-created:${created._id}`);
    res.status(201).json({ message: 'Đã phân người thay thế', data: created });
  } catch (error) { respond(res, error); }
};

const cancelReplacement = async (req, res) => {
  try {
    if (!id(req.params.id)) throw fail('Phân công thay thế không hợp lệ');
    const item = await auditedUpdate(req, StaffReplacement, { _id: req.params.id, status: 'active' }, { status: 'cancelled', cancelledAt: new Date(), cancelledBy: req.user._id }, 'STAFF_REPLACEMENT_CANCELLED');
    if (!item) throw fail('Không tìm thấy phân công thay thế', 404);
    const employee = await Employee.findById(item.replacementEmployeeId).select('userId').lean();
    await notifyAssignment(employee?.userId, 'Đã hủy phân công thay thế', `Phân công thay thế ngày ${item.date} đã được hủy.`, req.user._id, `replacement-cancelled:${item._id}`);
    res.json({ message: 'Đã hủy phân công thay thế', data: item });
  } catch (error) { respond(res, error); }
};

module.exports = { getStaffing, getMyStaffing, assignClassroomStaff, createShift, cancelShift, createReplacement, cancelReplacement };
