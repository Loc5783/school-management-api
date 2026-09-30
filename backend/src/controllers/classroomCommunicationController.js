const mongoose = require('mongoose');
const Classroom = require('../models/zone3_school/Classroom');
const Student = require('../models/zone3_school/Student');
const User = require('../models/zone1_system/User');
const Notification = require('../models/zone1_system/Notification');
const ClassroomAnnouncement = require('../models/zone3_school/ClassroomAnnouncement');
const ClassroomDailyCareReport = require('../models/zone3_school/ClassroomDailyCareReport');
const { canAccessClassroom, getTeacherClassroomIds, hasSchoolWideReadAccess } = require('../services/schoolDataAccessService');
const { getLinkedStudentIds, isParent } = require('../services/studentAccessService');

const readableClassroomIds = async (user) => {
    if (user.role === 'teacher') return getTeacherClassroomIds(user);
    if (isParent(user)) {
        const students = await Student.find({ _id: { $in: getLinkedStudentIds(user) }, status: { $in: ['enrolled', 'temporarily_absent'] } }).select('classroomId').lean();
        return [...new Set(students.map((student) => String(student.classroomId)))];
    }
    return hasSchoolWideReadAccess(user) ? null : [];
};

const listAnnouncements = async (req, res) => {
    try {
        const ids = await readableClassroomIds(req.user);
        const filter = ids ? { classroomId: { $in: ids } } : {};
        if (req.query.classroomId) {
            if (!mongoose.isValidObjectId(req.query.classroomId)) return res.status(400).json({ message: 'ID lớp không hợp lệ' });
            if (ids && !ids.includes(String(req.query.classroomId))) return res.status(403).json({ message: 'Bạn không có quyền xem thông báo lớp này' });
            filter.classroomId = req.query.classroomId;
        }
        const data = await ClassroomAnnouncement.find(filter).sort({ publishedAt: -1 }).limit(50).lean();
        return res.json({ success: true, data });
    } catch (error) { console.error(error); return res.status(500).json({ message: 'Không thể tải thông báo lớp' }); }
};

const createAnnouncement = async (req, res) => {
    try {
        const { classroomId } = req.body;
        if (!mongoose.isValidObjectId(classroomId)) return res.status(400).json({ message: 'ID lớp không hợp lệ' });
        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, classroomId)) return res.status(403).json({ message: 'Bạn không được gửi thông báo cho lớp khác' });
        const title = String(req.body.title || '').trim();
        const content = String(req.body.content || '').trim();
        if (!title || title.length > 160 || !content || content.length > 2000) return res.status(422).json({ message: 'Vui lòng nhập tiêu đề và nội dung thông báo hợp lệ' });
        const classroom = await Classroom.findOne({ _id: classroomId, status: 'active' }).select('name');
        if (!classroom) return res.status(404).json({ message: 'Không tìm thấy lớp đang hoạt động' });
        const announcement = await ClassroomAnnouncement.create({ classroomId, className: classroom.name, title, content, createdBy: req.user._id, createdByName: req.user.profile?.fullName || req.user.username });
        const studentIds = await Student.distinct('_id', { classroomId, status: { $in: ['enrolled', 'temporarily_absent'] } });
        const parents = await User.find({ role: 'parent', status: 'active', 'parentInfo.studentIds': { $in: studentIds } }).select('_id').lean();
        if (parents.length) await Notification.insertMany(parents.map((parent) => ({ recipientId: parent._id, title: `${classroom.name}: ${title}`, message: content, type: 'info', link: '/parent-portal', createdBy: req.user._id, metadata: { classroomId, announcementId: announcement._id } })));
        return res.status(201).json({ success: true, message: `Đã gửi thông báo tới ${parents.length} phụ huynh`, data: announcement });
    } catch (error) { console.error(error); return res.status(500).json({ message: 'Không thể gửi thông báo lớp' }); }
};

const listClassCareReports = async (req, res) => {
    try {
        const ids = await readableClassroomIds(req.user);
        const filter = ids ? { classroomId: { $in: ids } } : {};
        if (req.query.classroomId) {
            if (!mongoose.isValidObjectId(req.query.classroomId)) return res.status(400).json({ message: 'ID lớp không hợp lệ' });
            if (ids && !ids.includes(String(req.query.classroomId))) return res.status(403).json({ message: 'Bạn không có quyền xem sổ chăm sóc lớp này' });
            filter.classroomId = req.query.classroomId;
        }
        const reports = await ClassroomDailyCareReport.find(filter).sort({ reportDate: -1 }).limit(60).lean();
        if (isParent(req.user)) {
            const linkedIds = new Set(getLinkedStudentIds(req.user));
            reports.forEach((report) => { report.studentNotes = (report.studentNotes || []).filter((note) => linkedIds.has(String(note.studentId))); });
        }
        return res.json({ success: true, data: reports });
    } catch (error) { console.error(error); return res.status(500).json({ message: 'Không thể tải sổ chăm sóc lớp' }); }
};

const saveClassCareReport = async (req, res) => {
    try {
        const { classroomId } = req.body;
        if (!mongoose.isValidObjectId(classroomId)) return res.status(400).json({ message: 'ID lớp không hợp lệ' });
        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, classroomId)) return res.status(403).json({ message: 'Bạn không được ghi sổ cho lớp khác' });
        const classroom = await Classroom.findOne({ _id: classroomId, status: 'active' }).select('name');
        if (!classroom) return res.status(404).json({ message: 'Không tìm thấy lớp đang hoạt động' });
        const reportDate = new Date(req.body.reportDate || new Date());
        if (Number.isNaN(reportDate.getTime())) return res.status(422).json({ message: 'Ngày ghi nhận không hợp lệ' });
        const today = new Date(); today.setHours(23, 59, 59, 999);
        if (reportDate > today) return res.status(422).json({ message: 'Không thể ghi sổ cho ngày tương lai' });
        const dateKey = reportDate.toISOString().slice(0, 10);
        const common = Object.fromEntries(['activities', 'meals', 'sleep', 'health'].map((field) => [field, String(req.body[field] || '').trim().slice(0, 1000)]));
        const rawNotes = Array.isArray(req.body.studentNotes) ? req.body.studentNotes : [];
        const noteIds = rawNotes.map((item) => String(item.studentId || '')).filter(Boolean);
        if (new Set(noteIds).size !== noteIds.length || noteIds.some((id) => !mongoose.isValidObjectId(id))) return res.status(422).json({ message: 'Danh sách học sinh cần lưu ý không hợp lệ hoặc bị trùng' });
        const students = await Student.find({ _id: { $in: noteIds }, classroomId, status: { $in: ['enrolled', 'temporarily_absent'] } }).select('fullName').lean();
        if (students.length !== noteIds.length) return res.status(422).json({ message: 'Chỉ được gắn học sinh đang thuộc lớp này' });
        const byId = new Map(students.map((student) => [String(student._id), student]));
        const studentNotes = rawNotes.map((item) => ({ studentId: item.studentId, studentName: byId.get(String(item.studentId)).fullName, note: String(item.note || '').trim().slice(0, 1000) })).filter((item) => item.note);
        if (!Object.values(common).some(Boolean) && !studentNotes.length) return res.status(422).json({ message: 'Vui lòng nhập nhận xét chung hoặc ít nhất một lưu ý riêng' });
        const report = await ClassroomDailyCareReport.findOneAndUpdate(
            { classroomId, dateKey },
            { $set: { classroomId, className: classroom.name, reportDate, dateKey, ...common, studentNotes, recordedBy: req.user._id, recordedByName: req.user.profile?.fullName || req.user.username, sentAt: new Date() } },
            { upsert: true, returnDocument: 'after', runValidators: true }
        );
        const classStudentIds = await Student.distinct('_id', { classroomId, status: { $in: ['enrolled', 'temporarily_absent'] } });
        const parents = await User.find({ role: 'parent', status: 'active', 'parentInfo.studentIds': { $in: classStudentIds } }).select('_id parentInfo.studentIds').lean();
        const noteByStudent = new Map(studentNotes.map((note) => [String(note.studentId), note]));
        if (parents.length) await Notification.insertMany(parents.map((parent) => {
            const privateNotes = (parent.parentInfo?.studentIds || []).map(String).map((id) => noteByStudent.get(id)).filter(Boolean);
            const privateNote = privateNotes[0];
            return {
                recipientId: parent._id,
                title: privateNotes.length ? `Lưu ý riêng về ${privateNotes.map((note) => note.studentName).join(', ')}` : `Sổ chăm sóc lớp ${classroom.name}`,
                message: privateNotes.length ? privateNotes.map((note) => `${note.studentName}: ${note.note}`).join(' · ') : `Giáo viên đã cập nhật tình hình chung của lớp ngày ${reportDate.toLocaleDateString('vi-VN')}.`,
                type: privateNote ? 'warning' : 'info', link: '/parent-portal', createdBy: req.user._id,
                metadata: { classroomId, careReportId: report._id, studentId: privateNote?.studentId || null }
            };
        }));
        return res.json({ success: true, message: `Đã lưu sổ lớp và gửi tới ${parents.length} phụ huynh`, data: report });
    } catch (error) { console.error(error); return res.status(error.code === 11000 ? 409 : 500).json({ message: error.code === 11000 ? 'Sổ chăm sóc ngày này vừa được cập nhật, vui lòng tải lại' : 'Không thể lưu sổ chăm sóc lớp' }); }
};

module.exports = { listAnnouncements, createAnnouncement, listClassCareReports, saveClassCareReport };
