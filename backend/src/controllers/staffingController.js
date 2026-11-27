const mongoose = require('mongoose');
const Classroom = require('../models/zone3_school/Classroom');
const Employee = require('../models/zone2_hr/Employee');
const LeaveRequest = require('../models/zone2_hr/LeaveRequest');
const StaffShift = require('../models/zone2_hr/StaffShift');
const StaffHandover = require('../models/zone2_hr/StaffHandover');
const StaffReplacement = require('../models/zone2_hr/StaffReplacement');
const User = require('../models/zone1_system/User');
const Notification = require('../models/zone1_system/Notification');
const credentialService = require('../services/credentialService');
const { inTransaction, audit } = credentialService;
const {
  buildTenantFilter,
  assertTenantContext,
  InvalidTenantContextError
} = require('../services/tenantFilterService');
const { getStaffingSnapshot, getStaffingTimetable, leaveOn, weekdayOf, worksOn } = require('../services/staffingService');
const { addWorkDays, getWorkDate, isValidWorkDate, isValidTime } = require('../utils/dateHelpers');

const fail = (message, status = 422) => Object.assign(new Error(message), { status, statusCode: status });
const respond = (res, error) => {
  const status = error.code === 11000 ? 409 : error.statusCode || error.status || (error.name === 'InvalidTenantContextError' ? 403 : 500);
  const message = error.code === 11000 ? 'Phân công này đã tồn tại' : error.message;
  return res.status(status).json({ success: false, message });
};
const id = (value) => mongoose.isValidObjectId(value);

const notifyAssignment = async (recipientId, title, message, actorId, key, reqOrContext) => {
  if (!recipientId || !reqOrContext) return;
  try {
    const tenantFilter = buildTenantFilter(reqOrContext, { failClosed: true });
    const tenantId = reqOrContext.tenantId || reqOrContext.user?.tenantId || null;
    const validRecipient = await User.findOne({ _id: recipientId, ...tenantFilter }).select('_id').lean();
    if (!validRecipient) return;
    await Notification.updateOne(
      { deduplicationKey: key, ...(tenantId ? { tenantId } : {}) },
      { $setOnInsert: { ...(tenantId ? { tenantId } : {}), recipientId: validRecipient._id, title, message, type: 'info', link: '/my-staffing', createdBy: actorId, deduplicationKey: key } },
      { upsert: true }
    );
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
    const one = occurrence(first, day);
    const two = occurrence(second, day);
    if (!one || !two) continue;
    if (Math.max(one.start, two.start) < Math.min(one.end, two.end)) return true;
  }
  return false;
};

const getStaffing = async (req, res) => {
  try {
    assertTenantContext(req);
    const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
    const date = getWorkDate(req.query.date);
    const [snapshot, shifts, replacements] = await Promise.all([
      getStaffingSnapshot(date, req),
      StaffShift.find({ status: 'active', validFrom: { $lte: date }, validUntil: { $gte: date }, ...tenantFilter })
        .populate({ path: 'employeeId', match: tenantFilter, select: 'fullName employeeCode' })
        .sort({ startTime: 1 }).lean(),
      StaffReplacement.find({ date, status: 'active', ...tenantFilter })
        .populate({ path: 'absentEmployeeId', match: tenantFilter, select: 'fullName employeeCode' })
        .populate({ path: 'replacementEmployeeId', match: tenantFilter, select: 'fullName employeeCode' })
        .populate({ path: 'classroomId', match: tenantFilter, select: 'name' })
        .populate({ path: 'shiftId', match: tenantFilter, select: 'name startTime endTime' })
        .lean()
    ]);
    const responseData = {
      date,
      classrooms: snapshot.classrooms,
      duties: snapshot.duties || [],
      shifts,
      replacements,
      teacherShortages: snapshot.teacherShortages || [],
      missingTeacherTotal: snapshot.missingTeacherTotal || 0,
      uncoveredShifts: snapshot.uncoveredShifts || 0,
      summary: {
        totalClassrooms: snapshot.classrooms.length,
        teacherShortages: snapshot.missingTeacherTotal || 0,
        uncoveredShifts: snapshot.uncoveredShifts || 0,
        activeReplacements: replacements.length
      }
    };
    res.json({ success: true, data: responseData, ...responseData });
  } catch (error) { respond(res, error); }
};

const getTimetable = async (req, res) => {
  try {
    assertTenantContext(req);
    const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
    const { startDate = getWorkDate(), days = 7, schoolYear, role, classroomId, employeeId, shiftId } = req.query;
    if (!isValidWorkDate(startDate)) throw fail('Ngày bắt đầu không hợp lệ');
    const count = Number(days);
    if (!Number.isInteger(count) || count < 1 || count > 31) throw fail('Số ngày xem phải từ 1 đến 31');
    if (classroomId && !id(classroomId)) throw fail('Lớp học không hợp lệ');
    if (employeeId && !id(employeeId)) throw fail('Nhân viên không hợp lệ');
    if (shiftId && !id(shiftId)) throw fail('Ca trực không hợp lệ');

    if (classroomId && !await Classroom.exists({ _id: classroomId, status: 'active', ...tenantFilter })) {
      throw fail('Không tìm thấy lớp học', 404);
    }
    if (employeeId && !await Employee.exists({ _id: employeeId, status: { $ne: 'resigned' }, ...tenantFilter })) {
      throw fail('Không tìm thấy nhân viên', 404);
    }
    if (shiftId && !await StaffShift.exists({ _id: shiftId, status: 'active', ...tenantFilter })) {
      throw fail('Không tìm thấy ca trực', 404);
    }

    const data = await getStaffingTimetable({
      startDate,
      daysCount: count,
      schoolYear,
      role,
      classroomId,
      employeeId,
      shiftId,
      context: req
    });
    res.json({ success: true, data, ...data });
  } catch (error) { respond(res, error); }
};

const getMyStaffing = async (req, res) => {
  try {
    assertTenantContext(req);
    const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
    const date = getWorkDate(req.query.date);
    const employee = await Employee.findOne({ userId: req.user._id, ...tenantFilter }).lean();
    if (!employee) {
      const emptyPayload = { date, classrooms: [], shifts: [], replacements: [], duties: [] };
      return res.json({ success: true, data: emptyPayload, ...emptyPayload });
    }
    const [snapshot, shifts, replacements] = await Promise.all([
      getStaffingSnapshot(date, req),
      StaffShift.find({ employeeId: employee._id, status: 'active', validFrom: { $lte: date }, validUntil: { $gte: date }, ...tenantFilter }).sort({ startTime: 1 }).lean(),
      StaffReplacement.find({ replacementEmployeeId: employee._id, date, status: 'active', ...tenantFilter })
        .populate({ path: 'absentEmployeeId', match: tenantFilter, select: 'fullName employeeCode' })
        .populate({ path: 'classroomId', match: tenantFilter, select: 'name' })
        .populate({ path: 'shiftId', match: tenantFilter, select: 'name startTime endTime' })
        .lean()
    ]);

    const coveringClassroomIds = new Set(
      replacements
        .filter((r) => r.kind === 'classroom' && r.classroomId)
        .map((r) => String(r.classroomId?._id || r.classroomId))
    );

    const currentUserId = String(req.user._id);
    const currentEmployeeId = String(employee._id);

    const classrooms = snapshot.classrooms
      .filter((item) => (item.supportTeacherIds || []).some((id) => String(id) === currentUserId) ||
                        (item.homeroomTeacherId && String(item.homeroomTeacherId) === currentUserId) ||
                        coveringClassroomIds.has(String(item._id)))
      .map((item) => ({
        ...item,
        isCovering: coveringClassroomIds.has(String(item._id))
      }));

    const myDuties = (snapshot.duties || []).filter((duty) =>
      (duty.employeeId && String(duty.employeeId) === currentEmployeeId) ||
      (duty.replacement?._id && String(duty.replacement._id) === currentEmployeeId)
    );

    const payload = { date, classrooms, shifts, replacements, duties: myDuties };
    res.json({ success: true, data: payload, ...payload });
  } catch (error) { respond(res, error); }
};

const assignClassroomStaff = async (req, res) => {
  try {
    assertTenantContext(req);
    const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
    const { homeroomTeacherId, supportTeacherIds = [], requiredTeachers = 1, teachingWeekdays = [1, 2, 3, 4, 5] } = req.body || {};
    if (!id(req.params.id)) throw fail('Lớp học không hợp lệ', 400);
    if (homeroomTeacherId && !id(homeroomTeacherId)) throw fail('Giáo viên chủ nhiệm không hợp lệ');
    if (!Array.isArray(supportTeacherIds) || supportTeacherIds.some((item) => !id(item))) throw fail('Danh sách giáo viên hỗ trợ không hợp lệ');
    if (!Number.isInteger(Number(requiredTeachers)) || Number(requiredTeachers) < 1 || Number(requiredTeachers) > 5) throw fail('Số giáo viên định biên phải từ 1 đến 5');
    if (!Array.isArray(teachingWeekdays) || !teachingWeekdays.length || teachingWeekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw fail('Ngày học trong tuần không hợp lệ');

    const teacherIds = [...new Set([homeroomTeacherId, ...supportTeacherIds].filter(Boolean).map(String))];

    const saved = await inTransaction(async (session) => {
      // 1. Re-verify actor in transaction session
      const currentActor = await User.findOne({
        _id: req.user._id,
        role: { $in: ['admin', 'hr'] },
        status: 'active',
        ...tenantFilter
      }).session(session);
      if (!currentActor) {
        throw fail('Tài khoản thực hiện thao tác không còn quyền quản lý hoặc đã bị khóa/hạ quyền', 403);
      }

      const classroom = await Classroom.findOne({ _id: req.params.id, ...tenantFilter }).session(session);
      if (!classroom) throw fail('Không tìm thấy lớp học', 404);
      if (classroom.status !== 'active') throw fail('Không thể phân công cho lớp đã lưu trữ', 409);

      // Check alien employee link on teachers
      if (teacherIds.length) {
        const unscopedEmps = await Employee.find({ userId: { $in: teacherIds } }).select('_id tenantId userId').session(session);
        const isSaaS = Boolean(req.tenantId);
        for (const meta of unscopedEmps) {
          const same = isSaaS
            ? Boolean(meta.tenantId && String(meta.tenantId) === String(req.tenantId))
            : (meta.tenantId === null || meta.tenantId === undefined);
          if (!same) {
            throw fail('Phát hiện liên kết hồ sơ nhân sự ngoại lai không hợp lệ', 409);
          }
        }
      }

      const profiles = teacherIds.length
        ? await Employee.find({ userId: { $in: teacherIds }, status: 'active', ...tenantFilter })
            .populate({ path: 'userId', match: tenantFilter, select: 'role status profile username' })
            .session(session)
        : [];
      if (profiles.length !== teacherIds.length || profiles.some((employee) => employee.userId?.role !== 'teacher' || employee.userId?.status !== 'active')) {
        throw fail('Chỉ phân công giáo viên đang làm việc và có tài khoản hợp lệ');
      }
      if (await StaffHandover.exists({ employeeId: { $in: profiles.map((employee) => employee._id) }, kind: 'resignation', status: 'scheduled' }).session(session)) {
        throw fail('Giáo viên đã hẹn nghỉ việc. Không thể phân công lớp mới.', 409);
      }

      // Homeroom constraint: teacher can only be homeroom teacher for max 1 class in the academic year
      if (homeroomTeacherId) {
        const existingHomeroom = await Classroom.findOne({
          _id: { $ne: classroom._id },
          schoolYear: classroom.schoolYear,
          status: 'active',
          homeroomTeacherId,
          ...tenantFilter
        }).session(session).select('name').lean();
        if (existingHomeroom) throw fail(`Giáo viên này đã làm giáo viên chủ nhiệm lớp ${existingHomeroom.name} trong năm học ${classroom.schoolYear}. Mỗi giáo viên chỉ được chủ nhiệm 1 lớp/năm học.`, 409);
      }

      // Double booking constraint: cannot assign teacher to overlapping classes on the same teaching weekdays
      const conflicts = await Classroom.find({
        _id: { $ne: classroom._id },
        schoolYear: classroom.schoolYear,
        status: 'active',
        ...tenantFilter,
        $or: [
          { homeroomTeacherId: { $in: teacherIds } },
          { teachers: { $elemMatch: { teacherId: { $in: teacherIds }, role: { $in: ['homeroom', 'support'] } } } }
        ]
      }).session(session).select('name teachingWeekdays').lean();

      for (const conflict of conflicts) {
        const conflictDays = conflict.teachingWeekdays || [1, 2, 3, 4, 5];
        const sharedDays = teachingWeekdays.filter((d) => conflictDays.includes(d));
        if (sharedDays.length > 0) {
          throw fail(`Giáo viên đã được phân công lớp ${conflict.name} có ngày học trùng lịch (${sharedDays.join(', ')}) trong năm học này`, 409);
        }
      }

      // Coordination conditional write on teacher Users
      if (teacherIds.length) {
        const updatedTeachers = await User.updateMany(
          {
            _id: { $in: teacherIds },
            role: 'teacher',
            status: 'active',
            ...tenantFilter
          },
          { $inc: { assignmentVersion: 1 } },
          { session }
        );
        if (updatedTeachers.matchedCount !== teacherIds.length) {
          throw fail('Chỉ phân công giáo viên đang làm việc và có tài khoản hợp lệ');
        }
      }

      const before = classroom.toObject();
      const byUser = new Map(profiles.map((employee) => [String(employee.userId._id), employee]));
      classroom.homeroomTeacherId = homeroomTeacherId || null;
      classroom.teachers = [
        ...(classroom.teachers || []).filter((entry) => entry.role === 'subject' && !teacherIds.includes(String(entry.teacherId))),
        ...teacherIds.map((userId) => ({
          teacherId: userId,
          teacherName: byUser.get(userId).fullName,
          role: userId === String(homeroomTeacherId) ? 'homeroom' : 'support',
          assignedAt: new Date()
        }))
      ];
      classroom.requiredTeachers = Number(requiredTeachers);
      classroom.teachingWeekdays = [...new Set(teachingWeekdays)];

      await classroom.save({ session });
      await credentialService.audit(currentActor, 'CLASSROOM_STAFF_ASSIGNED', Classroom.modelName, classroom._id, before, classroom.toObject(), session);
      return classroom;
    });

    res.json({ message: 'Đã lưu phân công giáo viên của lớp', data: saved });
  } catch (error) { respond(res, error); }
};

const createShift = async (req, res) => {
  try {
    const tenantContext = assertTenantContext(req);
    const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
    const { employeeId, name, startTime, endTime, weekdays, validFrom, validUntil } = req.body || {};
    if (!id(employeeId) || !String(name || '').trim() || !isValidTime(startTime) || !isValidTime(endTime) || startTime === endTime ||
      !isValidWorkDate(validFrom) || !isValidWorkDate(validUntil) || validUntil < validFrom ||
      !Array.isArray(weekdays) || !weekdays.length || weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw fail('Thông tin ca trực không hợp lệ');

    const days = [...new Set(weekdays)];

    const { created, employee } = await inTransaction(async (session) => {
      // 1. Re-verify actor in transaction
      const currentActor = await User.findOne({
        _id: req.user._id,
        role: { $in: ['admin', 'hr'] },
        status: 'active',
        ...tenantFilter
      }).session(session);
      if (!currentActor) throw fail('Tài khoản thực hiện không còn quyền hoặc đã bị khóa/hạ quyền', 403);

      // 2. Re-verify employee in transaction
      const emp = await Employee.findOne({ _id: employeeId, ...tenantFilter }).session(session);
      if (!emp || emp.status !== 'active') {
        throw fail('Chỉ phân ca cho nhân viên bếp hoặc bảo vệ đang hoạt động');
      }

      const unscopedUser = await User.findById(emp.userId).session(session).select('_id tenantId role status').lean();
      const isSaaS = Boolean(req.tenantId);
      const isCrossUser = isSaaS
        ? (!unscopedUser?.tenantId || String(unscopedUser.tenantId) !== String(req.tenantId))
        : (unscopedUser?.tenantId !== null && unscopedUser?.tenantId !== undefined);
      if (isCrossUser) {
        throw fail('Phát hiện liên kết hồ sơ nhân sự ngoại lai không hợp lệ', 409);
      }
      if (!unscopedUser || !['chef', 'guard'].includes(unscopedUser.role) || unscopedUser.status !== 'active') {
        throw fail('Chỉ phân ca cho nhân viên bếp hoặc bảo vệ đang hoạt động');
      }

      // 3. Re-verify handover in transaction
      if (await StaffHandover.exists({ employeeId, kind: 'resignation', status: 'scheduled' }).session(session)) {
        throw fail('Nhân viên đã hẹn nghỉ việc. Không thể phân ca mới.', 409);
      }

      // 4. Write skew coordination on employee
      const touchEmp = await Employee.findOneAndUpdate(
        { _id: employeeId, status: 'active', ...tenantFilter },
        { $inc: { __v: 1 } },
        { session, new: true }
      );
      if (!touchEmp) throw fail('Không thể phối hợp phân ca', 409);

      // 5. Re-verify overlapping shifts in transaction
      const overlaps = await StaffShift.find({
        employeeId,
        status: 'active',
        validFrom: { $lte: addWorkDays(validUntil, 1) },
        validUntil: { $gte: addWorkDays(validFrom, -1) },
        ...tenantFilter
      }).session(session).lean();
      if (overlaps.some((shift) => sharedShiftDay(shift, { validFrom, validUntil, weekdays: days, startTime, endTime }))) {
        throw fail('Nhân viên đã có ca trong một hoặc nhiều ngày trùng lịch. Hãy kết thúc ca cũ trước.', 409);
      }

      const [shiftDoc] = await StaffShift.create([{
        employeeId,
        role: unscopedUser.role,
        name: String(name).trim(),
        startTime,
        endTime,
        weekdays: days,
        validFrom,
        validUntil,
        createdBy: currentActor._id,
        tenantId: tenantContext.tenantId || null
      }], { session });

      await credentialService.audit(currentActor, 'STAFF_SHIFT_CREATED', StaffShift.modelName, shiftDoc._id, {}, shiftDoc.toObject(), session);
      return { created: shiftDoc, employee: { userId: unscopedUser } };
    });

    await notifyAssignment(employee.userId?._id, 'Bạn có ca làm mới', `${created.name}: ${startTime}–${endTime}, từ ${validFrom} đến ${validUntil}. Xem lịch phân công để biết các ngày làm.`, req.user._id, `shift-created:${created._id}`, req);
    res.status(201).json({ message: 'Đã phân ca làm việc', data: created });
  } catch (error) { respond(res, error); }
};

const cancelShift = async (req, res) => {
  try {
    assertTenantContext(req);
    const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
    if (!id(req.params.id)) throw fail('Ca trực không hợp lệ', 400);

    const { shift, employee } = await inTransaction(async (session) => {
      // 1. Re-verify actor
      const currentActor = await User.findOne({
        _id: req.user._id,
        role: { $in: ['admin', 'hr'] },
        status: 'active',
        ...tenantFilter
      }).session(session);
      if (!currentActor) throw fail('Tài khoản thực hiện không còn quyền hoặc đã bị khóa/hạ quyền', 403);

      if (await StaffReplacement.exists({ shiftId: req.params.id, status: 'active', date: { $gte: getWorkDate() }, ...tenantFilter }).session(session)) {
        throw fail('Ca đã có người thay trong hôm nay hoặc tương lai. Hãy hủy phân công thay thế trước.', 409);
      }

      const before = await StaffShift.findOne({ _id: req.params.id, status: 'active', ...tenantFilter }).session(session).lean();
      if (!before) throw fail('Không tìm thấy ca đang hoạt động', 404);

      const updated = await StaffShift.findOneAndUpdate(
        { _id: req.params.id, status: 'active', ...tenantFilter },
        { $set: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: currentActor._id }, $inc: { __v: 1 } },
        { new: true, runValidators: true, session }
      );

      await credentialService.audit(currentActor, 'STAFF_SHIFT_CANCELLED', StaffShift.modelName, updated._id, before, updated.toObject(), session);

      const emp = await Employee.findOne({ _id: updated.employeeId, ...tenantFilter }).session(session).select('userId').lean();
      return { shift: updated, employee: emp };
    });

    await notifyAssignment(employee?.userId, 'Ca làm đã kết thúc', `Ca ${shift.name} (${shift.validFrom}–${shift.validUntil}) đã được kết thúc.`, req.user._id, `shift-cancelled:${shift._id}`, req);
    res.json({ message: 'Đã kết thúc phân ca', data: shift });
  } catch (error) { respond(res, error); }
};

const createReplacement = async (req, res) => {
  try {
    const tenantContext = assertTenantContext(req);
    const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
    const { date, kind, classroomId, shiftId, absentEmployeeId, replacementEmployeeId, note = '' } = req.body || {};
    if (!isValidWorkDate(date) || !['classroom', 'shift'].includes(kind) || !id(absentEmployeeId) || !id(replacementEmployeeId) ||
      String(absentEmployeeId) === String(replacementEmployeeId) || String(note).length > 500) {
      throw fail('Thông tin thay thế không hợp lệ. Không được phân công tự thay chính mình.');
    }

    const { created, target, replacement } = await inTransaction(async (session) => {
      // 1. Re-verify actor
      const currentActor = await User.findOne({
        _id: req.user._id,
        role: { $in: ['admin', 'hr'] },
        status: 'active',
        ...tenantFilter
      }).session(session);
      if (!currentActor) throw fail('Tài khoản thực hiện không còn quyền hoặc đã bị khóa/hạ quyền', 403);

      const [absent, repl] = await Promise.all([
        Employee.findOne({ _id: absentEmployeeId, ...tenantFilter }).session(session),
        Employee.findOne({ _id: replacementEmployeeId, ...tenantFilter }).session(session)
      ]);

      if (!absent || !repl || repl.status !== 'active') {
        throw fail('Nhân viên thay thế phải đang làm việc');
      }

      const [absentUserMeta, replUserMeta] = await Promise.all([
        User.findById(absent.userId).session(session).select('_id tenantId role status').lean(),
        User.findById(repl.userId).session(session).select('_id tenantId role status').lean()
      ]);
      const isSaaS = Boolean(req.tenantId);
      const isCross = (u) => {
        if (!u) return false;
        if (isSaaS) return !u.tenantId || String(u.tenantId) !== String(req.tenantId);
        return u.tenantId !== null && u.tenantId !== undefined;
      };
      if (isCross(absentUserMeta) || isCross(replUserMeta)) {
        throw fail('Phát hiện liên kết hồ sơ nhân sự ngoại lai không hợp lệ', 409);
      }
      if (!replUserMeta || replUserMeta.status !== 'active') {
        throw fail('Nhân viên thay thế phải đang làm việc');
      }

      const leaves = await LeaveRequest.find({ employeeId: absentEmployeeId, status: 'approved', ...tenantFilter }).session(session).select('startDate endDate workDates status').lean();
      if (!leaves.some((leave) => leaveOn(leave, date))) {
        throw fail('Chỉ phân người thay khi nhân viên vắng có đơn nghỉ đã duyệt trong ngày này', 409);
      }

      const replacementLeaves = await LeaveRequest.find({ employeeId: replacementEmployeeId, status: 'approved', ...tenantFilter }).session(session).select('startDate endDate workDates status').lean();
      if (replacementLeaves.some((leave) => leaveOn(leave, date))) {
        throw fail('Người thay cũng đang nghỉ phép trong ngày này', 409);
      }

      let tgt;
      if (kind === 'classroom') {
        if (!id(classroomId) || absentUserMeta?.role !== 'teacher' || replUserMeta?.role !== 'teacher') {
          throw fail('Thay lớp chỉ áp dụng cho giáo viên');
        }
        tgt = await Classroom.findOne({ _id: classroomId, status: 'active', ...tenantFilter }).session(session);
        if (!tgt || ![tgt.homeroomTeacherId, ...(tgt.teachers || []).map((entry) => entry.teacherId)].some((value) => String(value) === String(absentUserMeta?._id))) {
          throw fail('Giáo viên vắng không được phân công lớp này');
        }
        if (!(tgt.teachingWeekdays || [1, 2, 3, 4, 5]).includes(weekdayOf(date))) {
          throw fail('Lớp không có lịch học trong ngày này');
        }
        if (await Classroom.exists({ status: 'active', schoolYear: tgt.schoolYear, ...tenantFilter, $or: [{ homeroomTeacherId: replUserMeta._id }, { 'teachers.teacherId': replUserMeta._id }] }).session(session)) {
          throw fail('Giáo viên thay đã được phân công lớp trong năm học này', 409);
        }
      } else {
        if (!id(shiftId) || !['chef', 'guard'].includes(absentUserMeta?.role) || replUserMeta?.role !== absentUserMeta?.role) {
          throw fail('Người thay ca phải cùng vai trò bếp hoặc bảo vệ');
        }
        tgt = await StaffShift.findOne({ _id: shiftId, status: 'active', employeeId: absentEmployeeId, ...tenantFilter }).session(session);
        if (!tgt || !worksOn(tgt, date)) {
          throw fail('Nhân viên vắng không có ca này trong ngày đã chọn');
        }
        const ownShifts = await StaffShift.find({ employeeId: replacementEmployeeId, status: 'active', validFrom: { $lte: date }, validUntil: { $gte: date }, ...tenantFilter }).session(session).lean();
        if (ownShifts.some((shift) => worksOn(shift, date))) {
          throw fail('Người thay đã có ca làm trong ngày này', 409);
        }
      }

      if (await StaffReplacement.exists({ date, replacementEmployeeId, status: 'active', ...tenantFilter }).session(session)) {
        throw fail('Người thay đã nhận một phân công khác trong ngày', 409);
      }

      // Coordination conditional write on replacement and absent employee documents
      await Employee.findOneAndUpdate({ _id: replacementEmployeeId, status: 'active', ...tenantFilter }, { $inc: { __v: 1 } }, { session });
      await Employee.findOneAndUpdate({ _id: absentEmployeeId, ...tenantFilter }, { $inc: { __v: 1 } }, { session });

      const [createdDoc] = await StaffReplacement.create([{
        date,
        kind,
        classroomId: kind === 'classroom' ? tgt._id : null,
        shiftId: kind === 'shift' ? tgt._id : null,
        absentEmployeeId,
        replacementEmployeeId,
        note: String(note).trim(),
        createdBy: currentActor._id,
        tenantId: tenantContext.tenantId || null
      }], { session });

      await credentialService.audit(currentActor, 'STAFF_REPLACEMENT_CREATED', StaffReplacement.modelName, createdDoc._id, {}, createdDoc.toObject(), session);
      return { created: createdDoc, target: tgt, replacement: { userId: replUserMeta } };
    });

    await notifyAssignment(replacement.userId?._id, 'Bạn được phân công thay thế', `Ngày ${date}: ${kind === 'classroom' ? `phụ trách lớp ${target.name}` : `thay ca ${target.name}`}.${note ? ` Ghi chú: ${note}` : ''}`, req.user._id, `replacement-created:${created._id}`, req);
    res.status(201).json({ message: 'Đã phân người thay thế', data: created });
  } catch (error) { respond(res, error); }
};

const cancelReplacement = async (req, res) => {
  try {
    assertTenantContext(req);
    const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
    if (!id(req.params.id)) throw fail('Phân công thay thế không hợp lệ', 400);

    const { item, employee } = await inTransaction(async (session) => {
      // 1. Re-verify actor
      const currentActor = await User.findOne({
        _id: req.user._id,
        role: { $in: ['admin', 'hr'] },
        status: 'active',
        ...tenantFilter
      }).session(session);
      if (!currentActor) throw fail('Tài khoản thực hiện không còn quyền hoặc đã bị khóa/hạ quyền', 403);

      const before = await StaffReplacement.findOne({ _id: req.params.id, status: 'active', ...tenantFilter }).session(session).lean();
      if (!before) throw fail('Không tìm thấy phân công thay thế', 404);

      const updated = await StaffReplacement.findOneAndUpdate(
        { _id: req.params.id, status: 'active', ...tenantFilter },
        { $set: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: currentActor._id }, $inc: { __v: 1 } },
        { new: true, runValidators: true, session }
      );

      await credentialService.audit(currentActor, 'STAFF_REPLACEMENT_CANCELLED', StaffReplacement.modelName, updated._id, before, updated.toObject(), session);

      const emp = await Employee.findOne({ _id: updated.replacementEmployeeId, ...tenantFilter }).session(session).select('userId').lean();
      return { item: updated, employee: emp };
    });

    await notifyAssignment(employee?.userId, 'Đã hủy phân công thay thế', `Phân công thay thế ngày ${item.date} đã được hủy.`, req.user._id, `replacement-cancelled:${item._id}`, req);
    res.json({ message: 'Đã hủy phân công thay thế', data: item });
  } catch (error) { respond(res, error); }
};

module.exports = { getStaffing, getTimetable, getMyStaffing, assignClassroomStaff, createShift, cancelShift, createReplacement, cancelReplacement };
