const PickupRecord = require('../models/zone3_school/PickupRecord');
const Student = require('../models/zone3_school/Student');
const Notification = require('../models/zone1_system/Notification');
const { canAccessStudent, getLinkedStudentIds, isParent } = require('../services/studentAccessService');
const { canAccessClassroom, getTeacherClassroomIds } = require('../services/schoolDataAccessService');
const { isValidObjectId } = require('../utils/idValidation');
const { DEFAULT_SCHOOL_TIMEZONE, getWorkDate, isValidWorkDate } = require('../utils/dateHelpers');

const today = () => getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
const actorName = (user) => user?.profile?.fullName || user?.username || 'Nhân viên nhà trường';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

const accessStudent = async (user, student) => {
  if (isParent(user)) return canAccessStudent(user, student._id);
  if (user.role === 'teacher') return canAccessClassroom(user, student.classroomId);
  return ['guard', 'admin', 'principal'].includes(user.role);
};

const loadStudent = async (studentId) => {
  if (!isValidObjectId(studentId)) throw fail('ID học sinh không hợp lệ');
  const student = await Student.findById(studentId).select('fullName classroomId currentClassName className authorizedPickers status').lean();
  if (!student) throw fail('Không tìm thấy học sinh', 404);
  return student;
};

const listPickupRecords = async (req, res) => {
  try {
    const pickupDate = req.query.pickupDate || today();
    if (!isValidWorkDate(pickupDate)) return res.status(400).json({ success: false, message: 'Ngày đón không hợp lệ' });
    const filter = { pickupDate };
    if (isParent(req.user)) filter.studentId = { $in: getLinkedStudentIds(req.user) };
    else if (req.user.role === 'teacher') filter.classroomId = { $in: await getTeacherClassroomIds(req.user) };
    else if (!['guard', 'admin', 'principal'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Bạn không có quyền xem lịch đón trẻ' });
    if (req.query.studentId) {
      if (!isValidObjectId(req.query.studentId)) return res.status(400).json({ success: false, message: 'ID học sinh không hợp lệ' });
      if (isParent(req.user) && !canAccessStudent(req.user, req.query.studentId)) return res.status(403).json({ success: false, message: 'Bạn không có quyền xem lịch đón của học sinh này' });
      filter.studentId = req.query.studentId;
    }
    const data = await PickupRecord.find(filter).sort({ expectedPickupTime: 1, createdAt: -1 }).lean();
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Không thể tải lịch đón trẻ' });
  }
};

const createPickupRecord = async (req, res) => {
  try {
    const { studentId, pickerId, pickupDate = today(), expectedPickupTime = '', note = '' } = req.body || {};
    if (!isValidWorkDate(pickupDate) || pickupDate < today()) throw fail('Chỉ có thể đăng ký đón trẻ từ hôm nay trở đi');
    if (!isValidObjectId(pickerId)) throw fail('Vui lòng chọn người được ủy quyền đón trẻ');
    if (expectedPickupTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(expectedPickupTime)) throw fail('Giờ dự kiến phải có dạng HH:mm');
    if (String(note).trim().length > 500) throw fail('Ghi chú tối đa 500 ký tự');
    const student = await loadStudent(studentId);
    if (!await accessStudent(req.user, student) || !isParent(req.user)) throw fail('Bạn chỉ được đăng ký đón cho con đã liên kết', 403);
    const picker = student.authorizedPickers?.find((item) => String(item._id) === String(pickerId) && item.isActive !== false);
    if (!picker) throw fail('Người này không còn trong danh sách được phép đón trẻ');
    const existing = await PickupRecord.exists({ studentId: student._id, pickupDate, status: 'scheduled' });
    if (existing) throw fail('Đã có một yêu cầu đón trẻ đang hiệu lực trong ngày này', 409);
    const identity = String(picker.identityCard || '');
    const item = await PickupRecord.create({
      studentId: student._id, studentName: student.fullName, classroomId: student.classroomId,
      className: student.currentClassName || student.className || '', requesterId: req.user._id,
      requesterName: actorName(req.user), pickupDate, expectedPickupTime, note: String(note).trim(),
      picker: { pickerId: picker._id, fullName: picker.fullName, phone: picker.phone || '', relationship: picker.relationship || '', identityCardLast4: identity.slice(-4) }
    });
    return res.status(201).json({ success: true, message: 'Đã đăng ký người đón trẻ. Giáo viên/bảo vệ sẽ xác nhận khi bàn giao.', data: item });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Không thể đăng ký đón trẻ' });
  }
};

const confirmPickupRecord = async (req, res) => {
  try {
    const { confirmationNote = '' } = req.body || {};
    if (!isValidObjectId(req.params.id)) throw fail('ID lịch đón không hợp lệ');
    if (String(confirmationNote).trim().length > 500) throw fail('Ghi chú xác nhận tối đa 500 ký tự');
    const record = await PickupRecord.findById(req.params.id);
    if (!record) throw fail('Không tìm thấy lịch đón trẻ', 404);
    if (record.status === 'confirmed') return res.json({ success: true, message: 'Lịch đón trẻ đã được xác nhận trước đó', data: record });
    if (record.status !== 'scheduled') throw fail('Lịch đón trẻ này không còn hiệu lực', 409);
    if (record.pickupDate !== today()) throw fail('Chỉ xác nhận bàn giao trong đúng ngày đã đăng ký', 409);
    if (!await accessStudent(req.user, { _id: record.studentId, classroomId: record.classroomId }) || !['teacher', 'guard', 'admin', 'principal'].includes(req.user.role)) throw fail('Bạn không có quyền xác nhận bàn giao này', 403);
    record.status = 'confirmed'; record.confirmedBy = req.user._id; record.confirmedByName = actorName(req.user); record.confirmedAt = new Date(); record.confirmationNote = String(confirmationNote).trim();
    await record.save();
    await Notification.create({ recipientId: record.requesterId, title: `Đã xác nhận đón trẻ: ${record.studentName}`, message: `${record.picker.fullName} đã đón ${record.studentName} lúc ${record.confirmedAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}.`, type: 'info', link: '/pickup', createdBy: req.user._id, metadata: { pickupRecordId: record._id, studentId: record.studentId } });
    return res.json({ success: true, message: 'Đã xác nhận bàn giao trẻ', data: record });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Không thể xác nhận bàn giao trẻ' });
  }
};

const cancelPickupRecord = async (req, res) => {
  try {
    const reason = String(req.body?.reason || '').trim();
    if (!isValidObjectId(req.params.id)) throw fail('ID lịch đón không hợp lệ');
    const record = await PickupRecord.findById(req.params.id);
    if (!record) throw fail('Không tìm thấy lịch đón trẻ', 404);
    if (!isParent(req.user) || !canAccessStudent(req.user, record.studentId)) throw fail('Bạn không có quyền hủy lịch đón này', 403);
    if (record.status !== 'scheduled') throw fail('Chỉ có thể hủy lịch đang chờ bàn giao', 409);
    record.status = 'cancelled'; record.cancelledAt = new Date(); record.cancellationReason = reason;
    await record.save();
    return res.json({ success: true, message: 'Đã hủy lịch đón trẻ', data: record });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Không thể hủy lịch đón trẻ' });
  }
};

module.exports = { listPickupRecords, createPickupRecord, confirmPickupRecord, cancelPickupRecord };
