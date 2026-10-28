const crypto = require('crypto');
const Student = require('../models/zone3_school/Student');
const Classroom = require('../models/zone3_school/Classroom');
const AuditLog = require('../models/zone1_system/AuditLog');
const User = require('../models/zone1_system/User');
const Notification = require('../models/zone1_system/Notification');
const ImportIdempotency = require('../models/zone1_system/ImportIdempotency');
const { applyStudentListScope, canAccessStudent, isParent, isValidStudentId } = require('../services/studentAccessService');
const { canAccessClassroom, getTeacherClassroomIds, hasSchoolWideReadAccess } = require('../services/schoolDataAccessService');
const { STUDENT_STATUSES, isClassroomCountedStatus, canTransitionStudentStatus, generateStudentCode, runStudentTransaction, serializeStudent } = require('../services/studentCoreService');
const { isValidWorkDate, getWorkDate } = require('../utils/dateHelpers');

const ADMIN_MUTABLE = ['fullName', 'birthDate', 'gender', 'address', 'nationality', 'ethnicity', 'birthPlace', 'avatar', 'notes', 'classroomId', 'schoolYear', 'parents', 'authorizedPickers', 'allergies', 'disease', 'emergencyContact', 'admissionDate'];
const TEACHER_CREATE_FIELDS = ['fullName', 'birthDate', 'gender', 'address', 'nationality', 'ethnicity', 'birthPlace', 'avatar', 'notes'];
const TEACHER_MUTABLE = ['avatar', 'notes'];
const PARENT_MUTABLE = ['fullName', 'birthDate', 'gender', 'address', 'nationality', 'ethnicity', 'birthPlace', 'avatar', 'allergies', 'disease', 'emergencyContact', 'authorizedPickers'];
const SORTS = new Set(['fullName', 'studentCode', 'birthDate', 'admissionDate', 'createdAt', 'updatedAt']);
const mutableFieldsFor = (role, creating = false) => role === 'teacher'
    ? (creating ? TEACHER_CREATE_FIELDS : TEACHER_MUTABLE)
    : role === 'parent' ? PARENT_MUTABLE : ADMIN_MUTABLE;
const pick = (body = {}, role = 'admin', creating = false) => Object.fromEntries(mutableFieldsFor(role, creating).filter((key) => Object.hasOwn(body, key)).map((key) => [key, body[key]]));
const assertTeacherAllowedFields = (body, creating = false) => {
    const allowed = new Set(creating ? [...TEACHER_CREATE_FIELDS, 'classroomId'] : TEACHER_MUTABLE);
    const forbidden = Object.keys(body || {}).filter((key) => !allowed.has(key));
    if (forbidden.length) throw httpError(`Giáo viên không có quyền cập nhật trường: ${forbidden.join(', ')}`, 403);
};
const actorName = (user) => user?.fullName || user?.profile?.fullName || user?.username || 'Hệ thống';
const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const respondError = (res, err, fallback = 'Lỗi server') => {
    const field = Object.keys(err.keyPattern || {})[0];
    const duplicateMessages = { studentCode: 'Mã học sinh đã tồn tại', attendanceCardId: 'Mã thẻ điểm danh đã tồn tại', faceProfileId: 'Mã hồ sơ khuôn mặt đã tồn tại' };
    return res.status(err.statusCode || (err.code === 11000 ? 409 : 500)).json({ success: false, message: err.code === 11000 ? (duplicateMessages[field] || 'Dữ liệu trùng lặp') : (err.message || fallback) });
};
const regexEscape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const deriveSchoolYear = (date = new Date()) => {
    const parsed = new Date(date);
    const startYear = parsed.getMonth() >= 7 ? parsed.getFullYear() : parsed.getFullYear() - 1;
    return `${startYear}-${startYear + 1}`;
};

const audit = (req, action, student, before = {}, after = {}, session = null) => AuditLog.create([{
    actorId: req.user._id, actorUsername: req.user.username || req.user.profile?.fullName || 'system', action, targetType: 'Student', targetId: student._id, before, after
}], { session });
const adjustHeadcount = (classroomId, delta, session = null) => delta ? Classroom.findOneAndUpdate({ _id: classroomId, 'statistics.currentStudents': { $gte: delta < 0 ? Math.abs(delta) : 0 } }, { $inc: { 'statistics.currentStudents': delta } }, { session }) : null;
const validatePayload = (data, creating = false) => {
    if (creating && (!String(data.fullName || '').trim() || !data.birthDate || !data.gender || !data.classroomId)) throw httpError('Vui lòng nhập họ tên, ngày sinh, giới tính và lớp học', 422);
    if (data.birthDate && Number.isNaN(new Date(data.birthDate).getTime())) throw httpError('Ngày sinh không hợp lệ', 422);
    if (data.birthDate && new Date(data.birthDate) > new Date()) throw httpError('Ngày sinh không được ở tương lai', 422);
    if (data.admissionDate && Number.isNaN(new Date(data.admissionDate).getTime())) throw httpError('Ngày nhập học không hợp lệ', 422);
    if (data.birthDate && data.admissionDate && new Date(data.admissionDate) < new Date(data.birthDate)) throw httpError('Ngày nhập học không được trước ngày sinh', 422);
    if (data.schoolYear) {
        const match = String(data.schoolYear).trim().match(/^(\d{4})-(\d{4})$/);
        if (!match || Number(match[2]) !== Number(match[1]) + 1) throw httpError('Năm học phải có dạng YYYY-YYYY liên tiếp, ví dụ 2026-2027', 422);
    }
    if (data.gender && !['male', 'female'].includes(data.gender)) throw httpError('Giới tính không hợp lệ', 422);
    for (const [field, value, max] of [['fullName', data.fullName, 120], ['address', data.address, 500], ['nationality', data.nationality, 80], ['ethnicity', data.ethnicity, 80], ['birthPlace', data.birthPlace, 120], ['notes', data.notes, 2000]]) {
        if (value != null && String(value).trim().length > max) throw httpError(`${field} vượt quá ${max} ký tự`, 422);
    }
    for (const contact of [...(data.parents || []), data.emergencyContact || {}]) {
        if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) throw httpError('Email không hợp lệ', 422);
        if (contact.phone && !/^(0|\+84)\d{9,10}$/.test(String(contact.phone).replace(/[.\s-]/g, ''))) throw httpError('Số điện thoại không hợp lệ', 422);
    }
    if (data.authorizedPickers != null) {
        if (!Array.isArray(data.authorizedPickers) || data.authorizedPickers.length > 10) throw httpError('Danh sách người được phép đón phải có tối đa 10 người', 422);
        for (const picker of data.authorizedPickers) {
            if (!String(picker?.fullName || '').trim()) throw httpError('Mỗi người được phép đón cần có họ tên', 422);
            if (String(picker.fullName).trim().length > 120 || String(picker.relationship || '').trim().length > 80) throw httpError('Thông tin người được phép đón quá dài', 422);
            if (picker.phone && !/^(0|\+84)\d{9,10}$/.test(String(picker.phone).replace(/[.\s-]/g, ''))) throw httpError('Số điện thoại người đón không hợp lệ', 422);
            if (picker.photoURL && (!/^https?:\/\//i.test(picker.photoURL) || String(picker.photoURL).length > 1000)) throw httpError('Đường dẫn ảnh người đón không hợp lệ', 422);
            if (String(picker.vehicleType || '').length > 80 || String(picker.vehiclePlate || '').length > 20) throw httpError('Thông tin phương tiện người đón quá dài', 422);
        }
    }
};
const scopedFilter = async (user, filter, classroomId) => {
    if (isParent(user)) return applyStudentListScope(user, filter);
    if (user.role === 'teacher') {
        const ids = await getTeacherClassroomIds(user);
        filter.classroomId = classroomId ? (ids.includes(String(classroomId)) ? classroomId : { $in: [] }) : { $in: ids };
        return filter;
    }
    if (user.role === 'hr') {
        if (classroomId) filter.classroomId = classroomId;
        return filter;
    }
    if (!hasSchoolWideReadAccess(user)) throw httpError('Bạn không có quyền xem dữ liệu học sinh', 403);
    return filter;
};

const createStudent = async (req, res) => {
    try {
        if (req.user.role === 'teacher') assertTeacherAllowedFields(req.body, true);
        const data = req.user.role === 'teacher' ? { ...pick(req.body, req.user.role, true), classroomId: req.body.classroomId } : pick(req.body, req.user.role); validatePayload(data, true);
        if (!isValidStudentId(data.classroomId)) return res.status(400).json({ message: 'ID lớp học không hợp lệ' });
        const classroom = await Classroom.findOne({ _id: data.classroomId, status: 'active' });
        if (!classroom) return res.status(404).json({ message: 'Không tìm thấy lớp học' });
        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, classroom._id)) return res.status(403).json({ message: 'Bạn không có quyền thêm học sinh vào lớp này' });
        const status = req.user.role === 'teacher' ? 'enrolled' : (req.body.status || 'enrolled');
        if (!STUDENT_STATUSES.includes(status)) return res.status(422).json({ message: 'Trạng thái học sinh không hợp lệ' });
        const admissionDate = data.admissionDate || new Date();
        data.schoolYear = data.schoolYear || deriveSchoolYear(admissionDate);
        const student = await runStudentTransaction(async (session) => {
            const created = (await Student.create([{ ...data, fullName: data.fullName.trim(), classroomId: classroom._id, className: classroom.name, status, admissionDate, enrollmentDate: admissionDate, studentCode: await generateStudentCode(admissionDate, session), createdBy: req.user._id, updatedBy: req.user._id, statusHistory: [{ toStatus: status, reason: 'Tạo hồ sơ học sinh', effectiveDate: admissionDate, changedBy: req.user._id, changedByName: actorName(req.user) }] }], { session }))[0];
            if (isClassroomCountedStatus(status) && !await adjustHeadcount(classroom._id, 1, session)) throw httpError('Không thể cập nhật sĩ số lớp', 409);
            await audit(req, 'STUDENT_CREATED', created, {}, { studentCode: created.studentCode, status }, session);
            return created;
        });
        res.status(201).json({ success: true, message: 'Thêm học sinh thành công', data: serializeStudent(student, req.user.role) });
    } catch (err) { console.error(err); return respondError(res, err); }
};

const getAllStudents = async (req, res) => {
    try {
        const { classroomId, status, schoolYear, search, sortBy = 'fullName', sortOrder = 'asc' } = req.query;
        const page = Number(req.query.page || 1); const limit = Number(req.query.limit || 20);
        if (classroomId && !isValidStudentId(classroomId)) return res.status(400).json({ message: 'ID lớp học không hợp lệ' });
        if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) return res.status(400).json({ message: 'Thông tin phân trang không hợp lệ' });
        if (!SORTS.has(sortBy) || !['asc', 'desc'].includes(sortOrder)) return res.status(400).json({ message: 'Thông tin sắp xếp không hợp lệ' });
        if (status && status !== 'all' && !STUDENT_STATUSES.includes(status)) return res.status(400).json({ message: 'Trạng thái học sinh không hợp lệ' });
        let filter = {};
        if (classroomId) filter.classroomId = classroomId;
        if (schoolYear?.trim()) filter.schoolYear = schoolYear.trim();
        if (status && status !== 'all') filter.status = status; else if (!status) filter.status = 'enrolled';
        if (search?.trim()) { const keyword = regexEscape(search.trim()); filter.$or = [{ fullName: { $regex: keyword, $options: 'i' } }, { studentCode: { $regex: keyword, $options: 'i' } }]; }
        filter = await scopedFilter(req.user, filter, classroomId);
        const [students, total] = await Promise.all([Student.find(filter).sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1, _id: 1 }).skip((page - 1) * limit).limit(limit), Student.countDocuments(filter)]);
        res.json({ success: true, message: 'Lấy danh sách học sinh thành công', data: students.map((student) => serializeStudent(student, req.user.role, 'list')), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } catch (err) { console.error(err); return respondError(res, err); }
};

const getStudentById = async (req, res) => {
    try {
        if (!isValidStudentId(req.params.id)) return res.status(400).json({ message: 'ID học sinh không hợp lệ' });
        const student = await Student.findById(req.params.id); if (!student) return res.status(404).json({ message: 'Không tìm thấy học sinh' });
        if (isParent(req.user) && !canAccessStudent(req.user, student._id)) return res.status(403).json({ message: 'Bạn không có quyền xem thông tin học sinh này' });
        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, student.classroomId)) return res.status(403).json({ message: 'Bạn không có quyền xem thông tin học sinh này' });
        if (!isParent(req.user) && req.user.role !== 'teacher' && req.user.role !== 'hr' && !hasSchoolWideReadAccess(req.user)) return res.status(403).json({ message: 'Bạn không có quyền xem dữ liệu học sinh' });
        res.json({ success: true, message: 'Lấy chi tiết học sinh thành công', data: serializeStudent(student, req.user.role) });
    } catch (err) { console.error(err); return respondError(res, err); }
};

const updateStudent = async (req, res) => {
    try {
        if (!isValidStudentId(req.params.id)) return res.status(400).json({ message: 'ID học sinh không hợp lệ' });
        const current = await Student.findById(req.params.id); if (!current) return res.status(404).json({ message: 'Không tìm thấy học sinh' });
        if (isParent(req.user) && !canAccessStudent(req.user, current._id)) return res.status(403).json({ message: 'Bạn chỉ được cập nhật hồ sơ của con đã liên kết với tài khoản' });
        if (isParent(req.user)) return res.status(403).json({ success: false, message: 'Phụ huynh cần gửi yêu cầu cập nhật hồ sơ để nhà trường phê duyệt' });
        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, current.classroomId)) return res.status(403).json({ message: 'Bạn không có quyền cập nhật học sinh này' });
        if (req.user.role === 'teacher') assertTeacherAllowedFields(req.body);
        const updates = pick(req.body, req.user.role); if (!Object.keys(updates).length) return res.status(400).json({ message: 'Không có trường học sinh hợp lệ để cập nhật' });
        // Parent-facing serialization deliberately hides identity documents. Keep
        // existing protected values when a parent edits the visible picker list.
        if (isParent(req.user) && Array.isArray(updates.authorizedPickers)) {
            const existingPickers = new Map((current.authorizedPickers || []).map((picker) => [String(picker._id), picker]));
            updates.authorizedPickers = updates.authorizedPickers.map((picker) => {
                const existing = existingPickers.get(String(picker._id || ''));
                return existing ? { ...picker, identityCard: existing.identityCard || '', photoURL: picker.photoURL || existing.photoURL || '' } : picker;
            });
        }
        validatePayload(updates); let target;
        if (Object.hasOwn(updates, 'classroomId')) {
            if (!isValidStudentId(updates.classroomId)) return res.status(400).json({ message: 'ID lớp học không hợp lệ' });
            target = await Classroom.findOne({ _id: updates.classroomId, status: 'active' }); if (!target) return res.status(404).json({ message: 'Không tìm thấy lớp học' });
            if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, target._id)) return res.status(403).json({ message: 'Bạn không có quyền chuyển học sinh sang lớp này' });
            updates.classroomId = target._id; updates.className = target.name;
        }
        updates.updatedBy = req.user._id;
        const student = await runStudentTransaction(async (session) => {
            const updated = await Student.findByIdAndUpdate(current._id, { $set: updates }, { returnDocument: 'after', runValidators: true, session });
            if (target && String(current.classroomId) !== String(target._id) && isClassroomCountedStatus(current.status)) {
                if (!await adjustHeadcount(current.classroomId, -1, session) || !await adjustHeadcount(target._id, 1, session)) throw httpError('Không thể cập nhật sĩ số lớp', 409);
            }
            await audit(req, 'STUDENT_UPDATED', updated, {}, { changedFields: Object.keys(updates).filter((key) => key !== 'updatedBy') }, session);
            return updated;
        });
        res.json({ success: true, message: 'Cập nhật học sinh thành công', data: serializeStudent(student, req.user.role) });
    } catch (err) { console.error(err); return respondError(res, err); }
};

const changeStudentStatus = async (req, res) => {
    try {
        if (!isValidStudentId(req.params.id)) return res.status(400).json({ message: 'ID học sinh không hợp lệ' });
        const { status, reason = '', effectiveDate = new Date() } = req.body;
        if (!STUDENT_STATUSES.includes(status)) return res.status(422).json({ message: 'Trạng thái học sinh không hợp lệ' });
        if (Number.isNaN(new Date(effectiveDate).getTime())) return res.status(422).json({ message: 'Ngày hiệu lực không hợp lệ' });
        const student = await Student.findById(req.params.id); if (!student) return res.status(404).json({ success: false, message: 'Không tìm thấy học sinh' });
        if (student.admissionDate && new Date(effectiveDate) < new Date(student.admissionDate)) return res.status(422).json({ success: false, message: 'Ngày thôi học không được trước ngày nhập học' });
        if (!canTransitionStudentStatus(student.status, status)) return res.status(409).json({ success: false, message: `Không thể chuyển từ ${student.status} sang ${status}` });
        if (student.status === status) return res.json({ success: true, message: 'Trạng thái học sinh không thay đổi', data: serializeStudent(student, req.user.role) });
        const fromStatus = student.status; student.status = status; student.updatedBy = req.user._id;
        if (['withdrawn', 'transferred', 'graduated'].includes(status)) student.exitDate = new Date(effectiveDate);
        if (status === 'enrolled' && !student.admissionDate) student.admissionDate = new Date(effectiveDate);
        student.statusHistory.push({ fromStatus, toStatus: status, reason: String(reason).trim(), effectiveDate: new Date(effectiveDate), changedBy: req.user._id, changedByName: actorName(req.user) });
        const savedStudent = await runStudentTransaction(async (session) => {
            await student.save({ session });
            if (isClassroomCountedStatus(fromStatus) !== isClassroomCountedStatus(status) && !await adjustHeadcount(student.classroomId, isClassroomCountedStatus(status) ? 1 : -1, session)) throw httpError('Không thể cập nhật sĩ số lớp', 409);
            await audit(req, 'STUDENT_STATUS_CHANGED', student, { status: fromStatus }, { status, reason: String(reason).trim() }, session);
            return student;
        });
        res.json({ success: true, message: 'Đã cập nhật trạng thái học sinh', data: serializeStudent(savedStudent, req.user.role) });
    } catch (err) { console.error(err); return respondError(res, err); }
};

const deleteStudent = (req, res) => { req.body = { ...req.body, status: 'withdrawn', reason: req.body.reason || 'Hồ sơ ngừng theo học' }; return changeStudentStatus(req, res); };

const canReadStudentCare = async (user, student) => {
    if (isParent(user)) return canAccessStudent(user, student._id);
    if (user.role === 'teacher') return canAccessClassroom(user, student.classroomId);
    return hasSchoolWideReadAccess(user);
};

const getDailyReports = async (req, res) => {
    try {
        if (!isValidStudentId(req.params.id)) return res.status(400).json({ success: false, message: 'ID học sinh không hợp lệ' });
        const student = await Student.findById(req.params.id).select('fullName classroomId dailyReports');
        if (!student) return res.status(404).json({ success: false, message: 'Không tìm thấy học sinh' });
        if (!await canReadStudentCare(req.user, student)) return res.status(403).json({ success: false, message: 'Bạn không có quyền xem sổ chăm sóc của học sinh này' });
        const reports = [...(student.dailyReports || [])].sort((a, b) => new Date(b.reportDate) - new Date(a.reportDate)).slice(0, 60);
        return res.json({ success: true, data: reports });
    } catch (err) { console.error(err); return respondError(res, err); }
};

const saveDailyReport = async (req, res) => {
    try {
        if (!isValidStudentId(req.params.id)) return res.status(400).json({ success: false, message: 'ID học sinh không hợp lệ' });
        const student = await Student.findById(req.params.id);
        if (!student) return res.status(404).json({ success: false, message: 'Không tìm thấy học sinh' });
        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, student.classroomId)) return res.status(403).json({ success: false, message: 'Bạn không được ghi sổ cho học sinh ngoài lớp phụ trách' });
        const reportDate = new Date(req.body.reportDate || new Date());
        if (Number.isNaN(reportDate.getTime())) return res.status(422).json({ success: false, message: 'Ngày ghi nhận không hợp lệ' });
        const today = new Date(); today.setHours(23, 59, 59, 999);
        if (reportDate > today) return res.status(422).json({ success: false, message: 'Không thể ghi sổ chăm sóc cho ngày tương lai' });
        const fields = ['activities', 'meals', 'sleep', 'health'];
        const values = Object.fromEntries(fields.map((field) => [field, String(req.body[field] || '').trim().slice(0, 1000)]));
        if (!Object.values(values).some(Boolean)) return res.status(422).json({ success: false, message: 'Vui lòng nhập ít nhất một nội dung chăm sóc' });
        const dateKey = reportDate.toISOString().slice(0, 10);
        const existing = student.dailyReports.find((item) => new Date(item.reportDate).toISOString().slice(0, 10) === dateKey);
        if (existing) Object.assign(existing, values, { recordedBy: req.user._id, recordedByName: actorName(req.user), sentAt: new Date() });
        else student.dailyReports.push({ reportDate, ...values, recordedBy: req.user._id, recordedByName: actorName(req.user), sentAt: new Date() });
        student.updatedBy = req.user._id;
        await student.save();
        const saved = student.dailyReports.find((item) => new Date(item.reportDate).toISOString().slice(0, 10) === dateKey);
        const parents = await User.find({ role: 'parent', status: 'active', 'parentInfo.studentIds': student._id }).select('_id').lean();
        await Promise.all(parents.map((parent) => Notification.create({
            recipientId: parent._id, title: `Sổ chăm sóc: ${student.fullName}`,
            message: `Giáo viên đã cập nhật tình hình ăn, ngủ, sức khỏe và hoạt động ngày ${reportDate.toLocaleDateString('vi-VN')}.`,
            type: 'info', link: '/parent-portal', createdBy: req.user._id,
            metadata: { studentId: student._id, dailyReportId: saved?._id }
        })));
        return res.json({ success: true, message: 'Đã lưu và gửi sổ chăm sóc cho phụ huynh', data: saved });
    } catch (err) { console.error(err); return respondError(res, err); }
};

const {
    MAX_FILE_SIZE,
    MAX_ROWS,
    generateTemplateWorkbook,
    parseAndValidateExcelBuffer,
    validateStudentRowStrict,
    computeBatchFingerprint
} = require('../services/studentExcelImportService');

const downloadExcelTemplate = async (req, res) => {
    try {
        const workbook = await generateTemplateWorkbook();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="Mau_Nhap_Hoc_Sinh_Hoa_Nang.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error('Lỗi tạo file Excel mẫu:', err);
        return res.status(500).json({ success: false, message: 'Không thể tạo file Excel mẫu' });
    }
};

const previewExcelImport = async (req, res) => {
    try {
        const { classroomId } = req.body || {};
        if (!classroomId || !isValidStudentId(classroomId)) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn lớp học hợp lệ để nhập học sinh.' });
        }

        const classroom = await Classroom.findOne({ _id: classroomId, status: 'active' });
        if (!classroom) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy lớp học hoặc lớp đã bị lưu trữ/khóa.' });
        }

        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, classroom._id)) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền quản lý lớp học này.' });
        }

        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn tập tin Excel (.xlsx) để tải lên.' });
        }

        const parsedResult = await parseAndValidateExcelBuffer(req.file.buffer, classroomId, req.user);

        // Kiểm tra sĩ số lớp hiện tại với số lượng dòng hợp lệ
        const currentCount = Number(classroom.statistics?.currentStudents || 0);
        const maxSize = Number(classroom.maxSize || 25);
        const prospectiveCount = currentCount + parsedResult.totalValid;
        let capacityWarning = null;
        let capacityExceeded = false;
        if (prospectiveCount > maxSize) {
            capacityExceeded = true;
            capacityWarning = `Lớp hiện có ${currentCount}/${maxSize} học sinh. Thêm ${parsedResult.totalValid} học sinh sẽ vượt sĩ số tối đa (${prospectiveCount}/${maxSize}).`;
            // Chặn import khi vượt quá sĩ số tối đa
            parsedResult.canImport = false;
            parsedResult.isValid = false;
            parsedResult.totalErrors += 1;
        }

        return res.json({
            success: true,
            data: {
                fileName: req.file.originalname,
                classroomId: classroom._id,
                className: classroom.name,
                currentStudents: currentCount,
                maxSize,
                capacityWarning,
                capacityExceeded,
                ...parsedResult
            }
        });
    } catch (err) {
        console.error('Lỗi xem trước import Excel:', err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || 'Không thể xử lý tập tin Excel.'
        });
    }
};

const confirmExcelImport = async (req, res) => {
    let idempotencyDoc = null;
    const currentLockToken = crypto.randomUUID();
    try {
        const { classroomId, students: rawStudents } = req.body || {};
        const idempotencyKey = String(req.get('Idempotency-Key') || req.body.idempotencyKey || '').trim();

        if (!idempotencyKey) {
            return res.status(400).json({ success: false, message: 'Yêu cầu thiếu mã chống ghi lặp (Idempotency-Key).' });
        }

        if (!classroomId || !isValidStudentId(classroomId)) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn lớp học hợp lệ.' });
        }

        const classroom = await Classroom.findOne({ _id: classroomId, status: 'active' });
        if (!classroom) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy lớp học hoặc lớp đã bị lưu trữ.' });
        }

        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, classroom._id)) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền thêm học sinh vào lớp này.' });
        }

        if (!Array.isArray(rawStudents) || rawStudents.length === 0) {
            return res.status(400).json({ success: false, message: 'Danh sách học sinh để nhập không được để trống.' });
        }

        if (rawStudents.length > MAX_ROWS) {
            return res.status(422).json({ success: false, message: `Vượt quá giới hạn tối đa ${MAX_ROWS} học sinh/lần import.` });
        }

        // Kiểm tra tính hợp lệ nghiêm ngặt của từng học sinh bằng hàm validate chuẩn
        const validatedStudents = [];
        const inMemoryCheck = new Set();
        const currentYear = deriveSchoolYear(new Date());

        for (let i = 0; i < rawStudents.length; i++) {
            const rowNumber = rawStudents[i]?.rowNumber || (i + 2);
            const { isValid, errors, parsedData } = validateStudentRowStrict(rawStudents[i], rowNumber);
            if (!isValid || !parsedData) {
                return res.status(422).json({
                    success: false,
                    message: `Dòng ${rowNumber}: ${(errors && errors.length) ? errors.join('; ') : 'Dữ liệu không hợp lệ'}`
                });
            }

            const uniqueKey = `${parsedData.fullName.toLowerCase()}||${parsedData.birthDateStr || parsedData.birthDate}||${parsedData.gender}`;
            if (inMemoryCheck.has(uniqueKey)) {
                return res.status(422).json({
                    success: false,
                    message: `Dòng ${rowNumber}: Học sinh "${parsedData.fullName}" bị trùng lặp thông tin với một dòng khác trong cùng danh sách import.`
                });
            }
            inMemoryCheck.add(uniqueKey);

            validatedStudents.push({
                fullName: parsedData.fullName,
                birthDate: parsedData.birthDateObj || new Date(parsedData.birthDate),
                birthDateStr: parsedData.birthDateStr || parsedData.birthDate,
                gender: parsedData.gender,
                address: parsedData.address,
                nationality: parsedData.nationality,
                ethnicity: parsedData.ethnicity,
                birthPlace: parsedData.birthPlace,
                notes: parsedData.notes,
                classroomId: classroom._id,
                className: classroom.name,
                status: 'enrolled',
                admissionDate: new Date(),
                enrollmentDate: new Date(),
                schoolYear: currentYear
            });
        }

        // Tính fingerprint SHA-256 toàn diện cho cả lô
        const fingerprint = computeBatchFingerprint(classroomId, validatedStudents);

        // Khóa nguyên tử Idempotency: tạo mới hoặc cập nhật có điều kiện nếu retry
        const STALE_PROCESSING_MS = 2 * 60 * 1000; // 2 phút phục hồi yêu cầu bị treo do server gián đoạn
        try {
            idempotencyDoc = await ImportIdempotency.create({
                idempotencyKey,
                fingerprint,
                userId: req.user._id,
                classroomId: classroom._id,
                status: 'processing',
                lockToken: currentLockToken
            });
        } catch (dupErr) {
            if (dupErr.code === 11000) {
                const existingRecord = await ImportIdempotency.findOne({ idempotencyKey });
                if (!existingRecord) {
                    return res.status(409).json({ success: false, message: 'Yêu cầu đang được xử lý, vui lòng chờ trong giây lát.' });
                }

                // Ràng buộc người thực hiện (chủ sở hữu yêu cầu)
                if (String(existingRecord.userId) !== String(req.user._id)) {
                    return res.status(403).json({
                        success: false,
                        message: 'Mã yêu cầu (Idempotency-Key) thuộc về người dùng khác. Vui lòng thử lại với yêu cầu mới.'
                    });
                }

                // Đối chiếu fingerprint
                if (existingRecord.fingerprint !== fingerprint) {
                    return res.status(409).json({
                        success: false,
                        message: 'Mã yêu cầu (Idempotency-Key) đã được dùng cho một lô dữ liệu khác.'
                    });
                }

                // Nếu đã hoàn thành thành công -> trả về kết quả đã lưu kèm replayed: true
                if (existingRecord.status === 'completed') {
                    return res.status(200).json({
                        ...(existingRecord.response || {}),
                        replayed: true
                    });
                }

                // Cập nhật có điều kiện nguyên tử để chuyển failed hoặc processing quá hạn sang processing với lockToken mới
                const staleThreshold = new Date(Date.now() - STALE_PROCESSING_MS);
                const acquired = await ImportIdempotency.findOneAndUpdate(
                    {
                        idempotencyKey,
                        userId: req.user._id,
                        fingerprint,
                        $or: [
                            { status: 'failed' },
                            { status: 'processing', updatedAt: { $lt: staleThreshold } }
                        ]
                    },
                    {
                        $set: {
                            status: 'processing',
                            lockToken: currentLockToken,
                            updatedAt: new Date()
                        }
                    },
                    { returnDocument: 'after' }
                );

                if (!acquired) {
                    return res.status(409).json({
                        success: false,
                        message: 'Yêu cầu nhập học sinh này đang được xử lý bởi hệ thống. Vui lòng không gửi lặp lại.'
                    });
                }

                idempotencyDoc = acquired;
            } else {
                throw dupErr;
            }
        }

        // Kiểm tra sơ bộ sĩ số lớp trước khi vào transaction
        const initialCount = Number(classroom.statistics?.currentStudents || 0);
        const maxSize = Number(classroom.maxSize || 25);
        if (initialCount + validatedStudents.length > maxSize) {
            if (idempotencyDoc) {
                await ImportIdempotency.updateOne(
                    { _id: idempotencyDoc._id, lockToken: currentLockToken, status: 'processing' },
                    { $set: { status: 'failed' } }
                ).catch(() => {});
            }
            return res.status(422).json({
                success: false,
                message: `Lớp hiện có ${initialCount}/${maxSize} học sinh. Thêm ${validatedStudents.length} học sinh sẽ vượt quá sĩ số tối đa (${initialCount + validatedStudents.length}/${maxSize}).`
            });
        }

        // Thực hiện transaction: Kiểm tra khóa sĩ số, trùng lặp DB và lưu Idempotency nguyên khối
        const now = new Date();
        const resultPayload = await runStudentTransaction(async (session) => {
            // Khóa và kiểm tra lại sĩ số lớp trong transaction
            const lockedClassroom = await Classroom.findById(classroom._id).session(session);
            if (!lockedClassroom || lockedClassroom.status !== 'active') {
                throw httpError('Không tìm thấy lớp học hoặc lớp không còn hoạt động.', 404);
            }

            const currentCount = Number(lockedClassroom.statistics?.currentStudents || 0);
            const classMax = Number(lockedClassroom.maxSize || 25);
            if (currentCount + validatedStudents.length > classMax) {
                throw httpError(`Sĩ số lớp sẽ vượt quá mức tối đa cho phép (${currentCount + validatedStudents.length}/${classMax}). Không thể hoàn tất nhập học sinh.`, 422);
            }

            // Kiểm tra trùng lặp DB với session
            const candidateNames = validatedStudents.map(s => s.fullName);
            const existing = await Student.find({
                fullName: { $in: candidateNames }
            }).select('fullName birthDate gender className studentCode classroomId').session(session).lean();

            for (const candidate of validatedStudents) {
                const candDate = candidate.birthDateStr;
                const match = existing.find(s => {
                    if (s.fullName.toLowerCase() !== candidate.fullName.toLowerCase()) return false;
                    if (s.gender !== candidate.gender) return false;
                    const sDate = s.birthDate instanceof Date ? s.birthDate.toISOString().slice(0, 10) : String(s.birthDate || '').slice(0, 10);
                    return sDate === candDate;
                });

                if (match) {
                    const isAuthorized = req.user.role !== 'teacher' || (match.classroomId && (await canAccessClassroom(req.user, match.classroomId)));
                    const errorDetail = isAuthorized
                        ? `Học sinh "${candidate.fullName}" nghi trùng với hồ sơ đã có (${match.studentCode || 'Đã có'}, lớp ${match.className || 'Chưa xếp lớp'}). Vui lòng kiểm tra lại.`
                        : `Học sinh "${candidate.fullName}" nghi trùng với hồ sơ học sinh đã có trong toàn trường. Vui lòng kiểm tra lại.`;
                    throw httpError(errorDetail, 409);
                }
            }

            // Lưu học sinh hàng loạt
            const createdStudents = [];
            for (const data of validatedStudents) {
                const studentCode = await generateStudentCode(now, session);
                const created = (await Student.create([{
                    ...data,
                    studentCode,
                    admissionDate: now,
                    enrollmentDate: now,
                    createdBy: req.user._id,
                    updatedBy: req.user._id,
                    statusHistory: [{
                        toStatus: 'enrolled',
                        reason: 'Nhập học sinh hàng loạt từ Excel',
                        effectiveDate: now,
                        changedBy: req.user._id,
                        changedByName: actorName(req.user)
                    }]
                }], { session }))[0];

                await audit(req, 'STUDENT_CREATED', created, {}, { studentCode, status: 'enrolled', importSource: 'excel' }, session);
                createdStudents.push(created);
            }

            // Cập nhật thống kê sĩ số lớp trong transaction
            lockedClassroom.statistics = lockedClassroom.statistics || {};
            lockedClassroom.statistics.currentStudents = currentCount + createdStudents.length;
            await lockedClassroom.save({ session });

            const serialized = createdStudents.map(s => serializeStudent(s, req.user.role));
            const responsePayload = {
                success: true,
                message: `Nhập thành công ${createdStudents.length} học sinh vào lớp ${classroom.name}.`,
                data: serialized
            };

            // LƯU TRẠNG THÁI COMPLETED CỦA IDEMPOTENCY NGUYÊN KHỐI NGAY TRONG TRANSACTION
            const updateResult = await ImportIdempotency.updateOne(
                {
                    _id: idempotencyDoc._id,
                    lockToken: currentLockToken,
                    status: 'processing'
                },
                {
                    $set: {
                        status: 'completed',
                        response: responsePayload
                    }
                },
                { session }
            );

            if (updateResult.matchedCount === 0) {
                throw httpError('Tiến trình xử lý đã mất quyền sở hữu độc quyền hoặc bị tiếp quản bởi một yêu cầu khác.', 409);
            }

            return responsePayload;
        });

        return res.status(201).json(resultPayload);
    } catch (err) {
        if (idempotencyDoc) {
            await ImportIdempotency.updateOne(
                { _id: idempotencyDoc._id, lockToken: currentLockToken, status: 'processing' },
                { $set: { status: 'failed' } }
            ).catch(() => {});
        }
        console.error('Lỗi xác nhận import học sinh từ Excel:', err);
        return respondError(res, err, 'Không thể nhập học sinh từ Excel.');
    }
};

const transferStudentClassroom = async (req, res) => {
    let idempotencyDoc = null;
    let currentLockToken = null;
    try {
        if (!['admin', 'hr', 'principal'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền chuyển lớp học sinh' });
        }
        if (!isValidStudentId(req.params.id)) return res.status(400).json({ success: false, message: 'ID học sinh không hợp lệ' });
        const { toClassroomId, reason = '', effectiveDate } = req.body || {};
        if (!isValidStudentId(toClassroomId)) return res.status(400).json({ success: false, message: 'ID lớp chuyển đến không hợp lệ' });
        const cleanReason = String(reason).trim();
        if (!cleanReason) return res.status(422).json({ success: false, message: 'Vui lòng nhập lý do chuyển lớp' });

        // Require valid Idempotency-Key header (16-128 chars)
        const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
        if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
            return res.status(400).json({
                success: false,
                message: 'Header Idempotency-Key là bắt buộc để chuyển lớp (chuỗi 16-128 ký tự gồm chữ cái, chữ số, gạch nối hoặc gạch dưới).'
            });
        }

        // Check existing idempotency record first to stabilize contract on retries
        const existingRecord = await ImportIdempotency.findOne({ idempotencyKey });

        // Canonical payload for stable idempotency fingerprint
        let targetEffectiveDate = '';
        if (effectiveDate !== undefined && effectiveDate !== null && effectiveDate !== '') {
            const dateStr = String(effectiveDate).slice(0, 10);
            if (!isValidWorkDate(dateStr)) {
                return res.status(422).json({ success: false, message: 'Ngày hiệu lực không hợp lệ theo lịch thực tế' });
            }
            targetEffectiveDate = dateStr;
        } else if (existingRecord) {
            targetEffectiveDate = existingRecord.effectiveDate
                || (existingRecord.response?.data?.transferHistory?.effectiveDate
                    ? getWorkDate(new Date(existingRecord.response.data.transferHistory.effectiveDate))
                    : getWorkDate(new Date(existingRecord.createdAt)));
        } else {
            targetEffectiveDate = getWorkDate();
        }

        currentLockToken = crypto.randomUUID();
        const canonicalPayload = {
            studentId: String(req.params.id),
            toClassroomId: String(toClassroomId),
            reason: cleanReason,
            effectiveDate: targetEffectiveDate
        };
        const fingerprint = crypto.createHash('sha256')
            .update(JSON.stringify(canonicalPayload))
            .digest('hex');

        if (existingRecord) {
            if (String(existingRecord.userId) !== String(req.user._id)) {
                return res.status(409).json({ success: false, message: 'Khóa idempotency này thuộc về một người dùng khác.' });
            }
            if (existingRecord.fingerprint !== fingerprint) {
                return res.status(409).json({ success: false, message: 'Khóa idempotency này đã được sử dụng cho một yêu cầu khác với nội dung khác.' });
            }
            if (existingRecord.status === 'completed') {
                return res.status(200).json({
                    ...(existingRecord.response || {}),
                    replayed: true
                });
            }

            const staleThreshold = new Date(Date.now() - 30000);
            const acquired = await ImportIdempotency.findOneAndUpdate(
                {
                    idempotencyKey,
                    userId: req.user._id,
                    fingerprint,
                    $or: [
                        { status: 'failed' },
                        { status: 'processing', updatedAt: { $lt: staleThreshold } }
                    ]
                },
                {
                    $set: {
                        status: 'processing',
                        lockToken: currentLockToken,
                        effectiveDate: targetEffectiveDate,
                        updatedAt: new Date()
                    }
                },
                { returnDocument: 'after' }
            );

            if (!acquired) {
                return res.status(409).json({
                    success: false,
                    message: 'Yêu cầu chuyển lớp này đang được xử lý bởi hệ thống. Vui lòng không gửi lặp lại.'
                });
            }
            idempotencyDoc = acquired;
        } else {
            try {
                idempotencyDoc = await ImportIdempotency.create({
                    idempotencyKey,
                    fingerprint,
                    status: 'processing',
                    lockToken: currentLockToken,
                    userId: req.user._id,
                    effectiveDate: targetEffectiveDate
                });
            } catch (dupErr) {
                if (dupErr.code === 11000) {
                    const raceRecord = await ImportIdempotency.findOne({ idempotencyKey });
                    if (!raceRecord) {
                        return res.status(409).json({ success: false, message: 'Khóa idempotency bị xung đột dữ liệu.' });
                    }
                    if (String(raceRecord.userId) !== String(req.user._id)) {
                        return res.status(409).json({ success: false, message: 'Khóa idempotency này thuộc về một người dùng khác.' });
                    }
                    if (raceRecord.fingerprint !== fingerprint) {
                        return res.status(409).json({ success: false, message: 'Khóa idempotency này đã được sử dụng cho một yêu cầu khác với nội dung khác.' });
                    }
                    if (raceRecord.status === 'completed') {
                        return res.status(200).json({
                            ...(raceRecord.response || {}),
                            replayed: true
                        });
                    }

                    const staleThreshold = new Date(Date.now() - 30000);
                    const acquired = await ImportIdempotency.findOneAndUpdate(
                        {
                            idempotencyKey,
                            userId: req.user._id,
                            fingerprint,
                            $or: [
                                { status: 'failed' },
                                { status: 'processing', updatedAt: { $lt: staleThreshold } }
                            ]
                        },
                        {
                            $set: {
                                status: 'processing',
                                lockToken: currentLockToken,
                                effectiveDate: targetEffectiveDate,
                                updatedAt: new Date()
                            }
                        },
                        { returnDocument: 'after' }
                    );

                    if (!acquired) {
                        return res.status(409).json({
                            success: false,
                            message: 'Yêu cầu chuyển lớp này đang được xử lý bởi hệ thống. Vui lòng không gửi lặp lại.'
                        });
                    }
                    idempotencyDoc = acquired;
                } else {
                    throw dupErr;
                }
            }
        }
        // Strict immediate effective date in Asia/Ho_Chi_Minh for NEW or RETRIED non-completed requests
        const todayWorkDate = getWorkDate();
        if (targetEffectiveDate !== todayWorkDate) {
            if (idempotencyDoc) {
                await ImportIdempotency.updateOne(
                    { _id: idempotencyDoc._id, lockToken: currentLockToken, status: 'processing' },
                    { $set: { status: 'failed' } }
                ).catch(() => {});
            }
            return res.status(422).json({
                success: false,
                message: 'Chuyển lớp hiện chỉ hỗ trợ có hiệu lực ngay trong ngày làm việc hiện tại (Asia/Ho_Chi_Minh). Không chấp nhận ngày trong tương lai hoặc quá khứ.'
            });
        }

        const StudentTransferHistory = require('../models/zone3_school/StudentTransferHistory');
        const Notification = require('../models/zone1_system/Notification');
        const User = require('../models/zone1_system/User');

        const result = await runStudentTransaction(async (session) => {
            // Read and validate student inside session
            const studentDoc = await Student.findById(req.params.id).session(session);
            if (!studentDoc) throw httpError('Không tìm thấy học sinh', 404);
            if (!['enrolled', 'temporarily_absent'].includes(studentDoc.status)) {
                throw httpError('Chỉ được chuyển lớp cho học sinh đang theo học (enrolled hoặc tạm vắng)', 422);
            }

            const fromClassroomId = studentDoc.classroomId;
            if (String(fromClassroomId) === String(toClassroomId)) {
                throw httpError('Lớp mới phải khác lớp hiện tại của học sinh', 422);
            }

            // Read source and target classrooms inside session
            const [fromClassroom, toClassroom] = await Promise.all([
                Classroom.findById(fromClassroomId).session(session),
                Classroom.findOne({ _id: toClassroomId, status: 'active' }).session(session)
            ]);

            if (!fromClassroom) throw httpError('Không tìm thấy lớp học hiện tại của học sinh', 404);
            if (!toClassroom) throw httpError('Không tìm thấy lớp chuyển đến hoặc lớp không hoạt động', 404);

            // Same school year constraint
            if (studentDoc.schoolYear && toClassroom.schoolYear && studentDoc.schoolYear !== toClassroom.schoolYear) {
                throw httpError(`Chỉ được chuyển giữa các lớp trong cùng năm học (Lớp mới: ${toClassroom.schoolYear}, Học sinh: ${studentDoc.schoolYear})`, 422);
            }

            // Atomic capacity control on target classroom
            const maxSize = Number(toClassroom.maxSize || 25);
            const targetClassUpdated = await Classroom.findOneAndUpdate(
                {
                    _id: toClassroomId,
                    status: 'active',
                    $or: [
                        { 'statistics.currentStudents': { $lt: maxSize } },
                        { 'statistics.currentStudents': { $exists: false } }
                    ]
                },
                { $inc: { 'statistics.currentStudents': 1 } },
                { session, new: true }
            );
            if (!targetClassUpdated) {
                throw httpError(`Lớp ${toClassroom.name} đã đạt sĩ số tối đa (${toClassroom.statistics?.currentStudents || maxSize}/${maxSize} học sinh). Không thể tiếp nhận thêm.`, 409);
            }

            // Atomic headcount decrement on source classroom
            const sourceClassUpdated = await Classroom.findOneAndUpdate(
                {
                    _id: fromClassroomId,
                    'statistics.currentStudents': { $gt: 0 }
                },
                { $inc: { 'statistics.currentStudents': -1 } },
                { session, new: true }
            );
            if (!sourceClassUpdated) {
                throw httpError(`Không thể cập nhật sĩ số lớp nguồn ${fromClassroom.name}.`, 409);
            }

            // Conditional write on student (concurrency control)
            const updatedStudent = await Student.findOneAndUpdate(
                {
                    _id: studentDoc._id,
                    classroomId: fromClassroomId
                },
                {
                    $set: {
                        classroomId: toClassroom._id,
                        className: toClassroom.name,
                        updatedBy: req.user._id
                    }
                },
                { session, new: true }
            );
            if (!updatedStudent) {
                throw httpError('Học sinh đã bị thay đổi thông tin lớp học bởi một thao tác khác.', 409);
            }

            // Record Transfer History inside session
            const [historyEntry] = await StudentTransferHistory.create([{
                studentId: studentDoc._id,
                studentCode: studentDoc.studentCode,
                studentName: studentDoc.fullName,
                fromClassroomId: fromClassroom._id,
                fromClassName: fromClassroom.name,
                toClassroomId: toClassroom._id,
                toClassName: toClassroom.name,
                schoolYear: toClassroom.schoolYear,
                reason: cleanReason,
                effectiveDate: new Date(`${targetEffectiveDate}T00:00:00.000Z`),
                transferredBy: req.user._id,
                transferredByName: actorName(req.user)
            }], { session });

            // Audit inside session
            await audit(req, 'STUDENT_TRANSFERRED', studentDoc, {
                classroomId: fromClassroom._id,
                className: fromClassroom.name
            }, {
                classroomId: toClassroom._id,
                className: toClassroom.name,
                reason: cleanReason,
                effectiveDate: targetEffectiveDate
            }, session);

            // Buffer notifications inside session
            const recipients = new Set();
            if (fromClassroom.homeroomTeacherId) recipients.add(String(fromClassroom.homeroomTeacherId));
            if (toClassroom.homeroomTeacherId) recipients.add(String(toClassroom.homeroomTeacherId));

            const parentUsers = await User.find({ role: 'parent', 'parentInfo.studentIds': studentDoc._id }).select('_id').session(session);
            for (const p of parentUsers) recipients.add(String(p._id));

            for (const recipientId of recipients) {
                await Notification.create([{
                    recipientId,
                    title: `Học sinh ${studentDoc.fullName} chuyển lớp`,
                    message: `Học sinh ${studentDoc.fullName} (${studentDoc.studentCode}) đã được chuyển từ lớp ${fromClassroom.name} sang lớp ${toClassroom.name}. Lý do: ${cleanReason}`,
                    type: 'info',
                    link: '/students',
                    createdBy: req.user._id
                }], { session });
            }

            const responsePayload = {
                success: true,
                message: `Đã chuyển học sinh ${studentDoc.fullName} sang lớp ${toClassroom.name} thành công.`,
                data: {
                    student: serializeStudent(updatedStudent, req.user.role),
                    transferHistory: historyEntry
                }
            };

            // Save idempotency completed response inside session
            if (idempotencyDoc) {
                const updateRes = await ImportIdempotency.updateOne(
                    {
                        _id: idempotencyDoc._id,
                        lockToken: currentLockToken,
                        status: 'processing'
                    },
                    {
                        $set: {
                            status: 'completed',
                            response: responsePayload
                        }
                    },
                    { session }
                );
                if (updateRes.matchedCount === 0) {
                    throw httpError('Tiến trình xử lý chuyển lớp đã mất khóa sở hữu độc quyền.', 409);
                }
            }

            return responsePayload;
        });

        return res.json(result);
    } catch (err) {
        if (idempotencyDoc) {
            await ImportIdempotency.updateOne(
                { _id: idempotencyDoc._id, lockToken: currentLockToken, status: 'processing' },
                { $set: { status: 'failed' } }
            ).catch(() => {});
        }
        console.error('Lỗi chuyển lớp học sinh:', err);
        return respondError(res, err, 'Không thể chuyển lớp cho học sinh.');
    }
};

const getStudentTransferHistory = async (req, res) => {
    try {
        if (!isValidStudentId(req.params.id)) return res.status(400).json({ success: false, message: 'ID học sinh không hợp lệ' });
        const StudentTransferHistory = require('../models/zone3_school/StudentTransferHistory');
        
        const student = await Student.findById(req.params.id).select('classroomId parents fullName studentCode').lean();
        if (!student) return res.status(404).json({ success: false, message: 'Không tìm thấy học sinh' });

        // Scoped access control
        if (['admin', 'principal', 'hr'].includes(req.user.role)) {
            // Full access
        } else if (req.user.role === 'teacher') {
            const teacherClassIds = await getTeacherClassroomIds(req.user);
            const isCurrentClass = student.classroomId && teacherClassIds.includes(String(student.classroomId));
            if (!isCurrentClass) {
                const hadPastClass = await StudentTransferHistory.exists({
                    studentId: student._id,
                    $or: [
                        { fromClassroomId: { $in: teacherClassIds } },
                        { toClassroomId: { $in: teacherClassIds } }
                    ]
                });
                if (!hadPastClass) {
                    return res.status(403).json({ success: false, message: 'Bạn không có quyền xem lịch sử chuyển lớp của học sinh này' });
                }
            }
        } else if (isParent(req.user)) {
            const hasAccess = await canAccessStudent(req.user, student._id);
            if (!hasAccess) {
                return res.status(403).json({ success: false, message: 'Bạn không có quyền xem thông tin học sinh này' });
            }
        } else {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền xem lịch sử chuyển lớp' });
        }

        const history = await StudentTransferHistory.find({ studentId: req.params.id })
            .sort({ effectiveDate: -1, createdAt: -1 })
            .lean();

        const sanitized = history.map((item) => {
            if (isParent(req.user)) {
                return {
                    _id: item._id,
                    studentId: item.studentId,
                    studentName: item.studentName,
                    fromClassName: item.fromClassName,
                    toClassName: item.toClassName,
                    schoolYear: item.schoolYear,
                    effectiveDate: item.effectiveDate,
                    createdAt: item.createdAt
                };
            }
            return item;
        });

        res.json({ success: true, data: sanitized });
    } catch (err) {
        console.error(err);
        return respondError(res, err);
    }
};

module.exports = {
    createStudent,
    getAllStudents,
    getStudentById,
    updateStudent,
    changeStudentStatus,
    deleteStudent,
    getDailyReports,
    saveDailyReport,
    downloadExcelTemplate,
    previewExcelImport,
    confirmExcelImport,
    transferStudentClassroom,
    getStudentTransferHistory
};
