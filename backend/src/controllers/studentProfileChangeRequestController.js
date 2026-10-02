const Student = require('../models/zone3_school/Student');
const StudentProfileChangeRequest = require('../models/zone3_school/StudentProfileChangeRequest');
const Notification = require('../models/zone1_system/Notification');
const AuditLog = require('../models/zone1_system/AuditLog');
const { canAccessStudent } = require('../services/studentAccessService');
const { isValidObjectId } = require('../utils/idValidation');

const PARENT_CHANGE_FIELDS = new Set(['fullName', 'birthDate', 'gender', 'address', 'nationality', 'ethnicity', 'birthPlace', 'allergies', 'disease', 'emergencyContact', 'authorizedPickers']);
const actorName = (user) => user?.profile?.fullName || user?.username || 'Người dùng';
const error = (message, status = 400) => Object.assign(new Error(message), { status });

const cleanChanges = (body = {}) => {
  const changes = Object.fromEntries(Object.entries(body).filter(([key]) => PARENT_CHANGE_FIELDS.has(key)));
  if (!Object.keys(changes).length) throw error('Không có thông tin hồ sơ hợp lệ để gửi duyệt');
  if (changes.fullName != null && (!String(changes.fullName).trim() || String(changes.fullName).trim().length > 120)) throw error('Họ và tên không hợp lệ');
  if (changes.birthDate && (Number.isNaN(new Date(changes.birthDate).getTime()) || new Date(changes.birthDate) > new Date())) throw error('Ngày sinh không hợp lệ');
  if (changes.gender && !['male', 'female'].includes(changes.gender)) throw error('Giới tính không hợp lệ');
  if (changes.authorizedPickers != null && (!Array.isArray(changes.authorizedPickers) || changes.authorizedPickers.length > 10 || changes.authorizedPickers.some((item) => !String(item?.fullName || '').trim()))) throw error('Danh sách người được phép đón không hợp lệ');
  return changes;
};

const writeAudit = (req, action, target, before, after, reason = '') => AuditLog.create({ actorId: req.user._id, actorUsername: req.user.username, action, targetType: 'StudentProfileChangeRequest', targetId: target._id, before, after, reason });

const createRequest = async (req, res) => {
  try {
    const { studentId, changes } = req.body || {};
    if (!isValidObjectId(studentId)) throw error('ID học sinh không hợp lệ');
    const student = await Student.findById(studentId);
    if (!student) throw error('Không tìm thấy học sinh', 404);
    if (!canAccessStudent(req.user, student._id)) throw error('Bạn chỉ được gửi yêu cầu cho con đã liên kết', 403);
    if (await StudentProfileChangeRequest.exists({ studentId: student._id, status: 'pending' })) throw error('Hồ sơ này đang có một yêu cầu cập nhật chờ duyệt', 409);
    const request = await StudentProfileChangeRequest.create({ studentId: student._id, studentName: student.fullName, classroomId: student.classroomId, className: student.className || '', requesterId: req.user._id, requesterName: actorName(req.user), changes: cleanChanges(changes), baseUpdatedAt: student.updatedAt });
    await writeAudit(req, 'STUDENT_PROFILE_CHANGE_REQUESTED', request, {}, { fields: Object.keys(request.changes) });
    return res.status(201).json({ success: true, message: 'Đã gửi yêu cầu cập nhật hồ sơ. Nhà trường sẽ phê duyệt trước khi áp dụng.', data: request });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message || 'Không thể gửi yêu cầu cập nhật' }); }
};

const listRequests = async (req, res) => {
  try {
    const filter = {};
    if (req.user.role === 'parent') filter.requesterId = req.user._id;
    if (req.query.studentId) { if (!isValidObjectId(req.query.studentId)) throw error('ID học sinh không hợp lệ'); if (req.user.role === 'parent' && !canAccessStudent(req.user, req.query.studentId)) throw error('Bạn không có quyền xem yêu cầu của học sinh này', 403); filter.studentId = req.query.studentId; }
    if (req.query.status) { if (!['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status)) throw error('Trạng thái không hợp lệ'); filter.status = req.query.status; }
    const data = await StudentProfileChangeRequest.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    return res.json({ success: true, data });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message || 'Không thể tải yêu cầu cập nhật' }); }
};

const reviewRequest = async (req, res) => {
  try {
    const { decision, reviewNote = '' } = req.body || {};
    if (!['approved', 'rejected'].includes(decision)) throw error('Quyết định duyệt không hợp lệ');
    if (decision === 'rejected' && !String(reviewNote).trim()) throw error('Cần nhập lý do từ chối');
    if (!isValidObjectId(req.params.id)) throw error('ID yêu cầu không hợp lệ');
    const request = await StudentProfileChangeRequest.findById(req.params.id);
    if (!request) throw error('Không tìm thấy yêu cầu', 404);
    if (request.status !== 'pending') throw error('Yêu cầu này đã được xử lý', 409);
    const student = await Student.findById(request.studentId);
    if (!student) throw error('Học sinh không còn tồn tại', 404);
    if (decision === 'approved') {
      if (student.updatedAt.getTime() !== new Date(request.baseUpdatedAt).getTime()) throw error('Hồ sơ đã thay đổi sau khi gửi yêu cầu. Hãy kiểm tra lại trước khi duyệt.', 409);
      const changes = cleanChanges(request.changes);
      if (Array.isArray(changes.authorizedPickers)) {
        const current = new Map((student.authorizedPickers || []).map((picker) => [String(picker._id), picker]));
        changes.authorizedPickers = changes.authorizedPickers.map((picker) => {
          const existing = current.get(String(picker._id || ''));
          return existing ? { ...picker, identityCard: existing.identityCard || '', photoURL: picker.photoURL || existing.photoURL || '' } : picker;
        });
      }
      student.set(changes); student.updatedBy = req.user._id; await student.save();
    }
    request.status = decision; request.reviewedBy = req.user._id; request.reviewerName = actorName(req.user); request.reviewNote = String(reviewNote).trim(); request.reviewedAt = new Date(); await request.save();
    await writeAudit(req, decision === 'approved' ? 'STUDENT_PROFILE_CHANGE_APPROVED' : 'STUDENT_PROFILE_CHANGE_REJECTED', request, { status: 'pending' }, { status: decision }, request.reviewNote);
    await Notification.create({ recipientId: request.requesterId, title: `Yêu cầu cập nhật hồ sơ ${decision === 'approved' ? 'đã được duyệt' : 'bị từ chối'}`, message: decision === 'approved' ? `Thông tin của ${request.studentName} đã được cập nhật.` : `Lý do: ${request.reviewNote}`, type: 'info', link: '/parent-portal', createdBy: req.user._id, metadata: { profileChangeRequestId: request._id, studentId: request.studentId } });
    return res.json({ success: true, message: decision === 'approved' ? 'Đã duyệt và cập nhật hồ sơ học sinh' : 'Đã từ chối yêu cầu cập nhật', data: request });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message || 'Không thể xử lý yêu cầu' }); }
};

module.exports = { createRequest, listRequests, reviewRequest };
