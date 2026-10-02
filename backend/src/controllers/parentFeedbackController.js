const ParentFeedback = require('../models/zone3_school/ParentFeedback');
const Student = require('../models/zone3_school/Student');
const Notification = require('../models/zone1_system/Notification');
const { canAccessStudent } = require('../services/studentAccessService');
const { isValidObjectId } = require('../utils/idValidation');

const categories = ['general', 'health', 'tuition', 'service', 'complaint'];
const statuses = ['pending', 'in_progress', 'responded', 'closed'];
const actorName = (user) => user?.profile?.fullName || user?.username || 'Nhà trường';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

const createFeedback = async (req, res) => {
  try {
    const { studentId, category = 'general', subject, message } = req.body || {};
    if (!isValidObjectId(studentId)) throw fail('ID học sinh không hợp lệ');
    if (!categories.includes(category)) throw fail('Nhóm phản hồi không hợp lệ');
    if (!String(subject || '').trim() || String(subject).trim().length > 160) throw fail('Tiêu đề cần từ 3 đến 160 ký tự');
    if (String(subject).trim().length < 3 || String(message || '').trim().length < 10 || String(message).trim().length > 3000) throw fail('Nội dung phản hồi cần từ 10 đến 3000 ký tự');
    const student = await Student.findById(studentId).select('fullName classroomId className');
    if (!student) throw fail('Không tìm thấy học sinh', 404);
    if (!canAccessStudent(req.user, student._id)) throw fail('Bạn chỉ được gửi phản hồi liên quan đến con đã liên kết', 403);
    const item = await ParentFeedback.create({ studentId: student._id, studentName: student.fullName, classroomId: student.classroomId, className: student.className || '', parentId: req.user._id, parentName: actorName(req.user), category, subject: subject.trim(), message: message.trim() });
    return res.status(201).json({ success: true, message: 'Đã gửi phản hồi riêng tới ban quản lý nhà trường.', data: item });
  } catch (error) { return res.status(error.status || 500).json({ success: false, message: error.message || 'Không thể gửi phản hồi' }); }
};

const listFeedback = async (req, res) => {
  try {
    const filter = req.user.role === 'parent' ? { parentId: req.user._id } : {};
    if (req.query.studentId) { if (!isValidObjectId(req.query.studentId)) throw fail('ID học sinh không hợp lệ'); if (req.user.role === 'parent' && !canAccessStudent(req.user, req.query.studentId)) throw fail('Bạn không có quyền xem phản hồi của học sinh này', 403); filter.studentId = req.query.studentId; }
    if (req.query.status) { if (!statuses.includes(req.query.status)) throw fail('Trạng thái phản hồi không hợp lệ'); filter.status = req.query.status; }
    const data = await ParentFeedback.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    return res.json({ success: true, data });
  } catch (error) { return res.status(error.status || 500).json({ success: false, message: error.message || 'Không thể tải phản hồi' }); }
};

const respondFeedback = async (req, res) => {
  try {
    const { response, status = 'responded' } = req.body || {};
    if (!isValidObjectId(req.params.id)) throw fail('ID phản hồi không hợp lệ');
    if (!['in_progress', 'responded', 'closed'].includes(status)) throw fail('Trạng thái phản hồi không hợp lệ');
    if (['responded', 'closed'].includes(status) && String(response || '').trim().length < 3) throw fail('Vui lòng nhập nội dung phản hồi cho phụ huynh');
    if (String(response || '').trim().length > 3000) throw fail('Nội dung phản hồi tối đa 3000 ký tự');
    const item = await ParentFeedback.findById(req.params.id);
    if (!item) throw fail('Không tìm thấy phản hồi', 404);
    item.status = status;
    if (String(response || '').trim()) { item.response = response.trim(); item.respondedBy = req.user._id; item.responderName = actorName(req.user); item.respondedAt = new Date(); }
    await item.save();
    if (item.response) await Notification.create({ recipientId: item.parentId, title: `Phản hồi từ nhà trường: ${item.subject}`, message: item.response, type: 'info', link: '/parent-portal', createdBy: req.user._id, metadata: { feedbackId: item._id, studentId: item.studentId } });
    return res.json({ success: true, message: 'Đã cập nhật phản hồi cho phụ huynh', data: item });
  } catch (error) { return res.status(error.status || 500).json({ success: false, message: error.message || 'Không thể phản hồi' }); }
};
module.exports = { createFeedback, listFeedback, respondFeedback };
