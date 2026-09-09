const Student = require('../models/zone3_school/Student');
const Classroom = require('../models/zone3_school/Classroom');
const AuditLog = require('../models/zone1_system/AuditLog');
const { applyStudentListScope, canAccessStudent, isParent, isValidStudentId } = require('../services/studentAccessService');
const { canAccessClassroom, getTeacherClassroomIds, hasSchoolWideReadAccess } = require('../services/schoolDataAccessService');
const { STUDENT_STATUSES, isClassroomCountedStatus, canTransitionStudentStatus, generateStudentCode, runStudentTransaction, serializeStudent } = require('../services/studentCoreService');

const ADMIN_MUTABLE = ['fullName', 'birthDate', 'gender', 'address', 'nationality', 'ethnicity', 'birthPlace', 'avatar', 'notes', 'classroomId', 'schoolYear', 'parents', 'authorizedPickers', 'allergies', 'disease', 'emergencyContact', 'admissionDate'];
const TEACHER_MUTABLE = ['fullName', 'birthDate', 'gender', 'address', 'nationality', 'ethnicity', 'birthPlace', 'avatar', 'notes'];
const SORTS = new Set(['fullName', 'studentCode', 'birthDate', 'admissionDate', 'createdAt', 'updatedAt']);
const pick = (body = {}, role = 'admin') => Object.fromEntries((role === 'teacher' ? TEACHER_MUTABLE : ADMIN_MUTABLE).filter((key) => Object.hasOwn(body, key)).map((key) => [key, body[key]]));
const assertTeacherAllowedFields = (body, creating = false) => {
    const allowed = new Set(creating ? [...TEACHER_MUTABLE, 'classroomId'] : TEACHER_MUTABLE);
    const forbidden = Object.keys(body || {}).filter((key) => !allowed.has(key));
    if (forbidden.length) throw httpError(`Giáo viên không có quyền cập nhật trường: ${forbidden.join(', ')}`, 403);
};
const actorName = (user) => user.profile?.fullName || user.username;
const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const regexEscape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const audit = (req, action, student, before = {}, after = {}, session = null) => AuditLog.create([{
    actorId: req.user._id, actorUsername: req.user.username, action, targetType: 'Student', targetId: student._id, before, after
}], { session });
const adjustHeadcount = (classroomId, delta, session = null) => delta ? Classroom.findOneAndUpdate({ _id: classroomId, 'statistics.currentStudents': { $gte: delta < 0 ? Math.abs(delta) : 0 } }, { $inc: { 'statistics.currentStudents': delta } }, { session }) : null;
const validatePayload = (data, creating = false) => {
    if (creating && (!String(data.fullName || '').trim() || !data.birthDate || !data.gender || !data.classroomId)) throw httpError('Vui lòng nhập họ tên, ngày sinh, giới tính và lớp học', 422);
    if (data.birthDate && Number.isNaN(new Date(data.birthDate).getTime())) throw httpError('Ngày sinh không hợp lệ', 422);
    if (data.birthDate && new Date(data.birthDate) > new Date()) throw httpError('Ngày sinh không được ở tương lai', 422);
    if (data.admissionDate && Number.isNaN(new Date(data.admissionDate).getTime())) throw httpError('Ngày nhập học không hợp lệ', 422);
    if (data.birthDate && data.admissionDate && new Date(data.admissionDate) < new Date(data.birthDate)) throw httpError('Ngày nhập học không được trước ngày sinh', 422);
    if (data.gender && !['male', 'female'].includes(data.gender)) throw httpError('Giới tính không hợp lệ', 422);
    for (const contact of [...(data.parents || []), data.emergencyContact || {}]) {
        if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) throw httpError('Email không hợp lệ', 422);
        if (contact.phone && !/^(0|\+84)\d{9,10}$/.test(String(contact.phone).replace(/[.\s-]/g, ''))) throw httpError('Số điện thoại không hợp lệ', 422);
    }
};
const scopedFilter = async (user, filter, classroomId) => {
    if (isParent(user)) return applyStudentListScope(user, filter);
    if (user.role === 'teacher') {
        const ids = await getTeacherClassroomIds(user);
        filter.classroomId = classroomId ? (ids.includes(String(classroomId)) ? classroomId : { $in: [] }) : { $in: ids };
        return filter;
    }
    if (!hasSchoolWideReadAccess(user)) throw httpError('Bạn không có quyền xem dữ liệu học sinh', 403);
    return filter;
};

const createStudent = async (req, res) => {
    try {
        if (req.user.role === 'teacher') assertTeacherAllowedFields(req.body, true);
        const data = req.user.role === 'teacher' ? { ...pick(req.body, req.user.role), classroomId: req.body.classroomId } : pick(req.body, req.user.role); validatePayload(data, true);
        if (!isValidStudentId(data.classroomId)) return res.status(400).json({ message: 'ID lớp học không hợp lệ' });
        const classroom = await Classroom.findOne({ _id: data.classroomId, status: 'active' });
        if (!classroom) return res.status(404).json({ message: 'Không tìm thấy lớp học' });
        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, classroom._id)) return res.status(403).json({ message: 'Bạn không có quyền thêm học sinh vào lớp này' });
        const status = req.user.role === 'teacher' ? 'enrolled' : (req.body.status || 'enrolled');
        if (!STUDENT_STATUSES.includes(status)) return res.status(422).json({ message: 'Trạng thái học sinh không hợp lệ' });
        const admissionDate = data.admissionDate || new Date();
        const student = await runStudentTransaction(async (session) => {
            const created = (await Student.create([{ ...data, fullName: data.fullName.trim(), classroomId: classroom._id, className: classroom.name, status, admissionDate, enrollmentDate: admissionDate, studentCode: await generateStudentCode(admissionDate, session), createdBy: req.user._id, updatedBy: req.user._id, statusHistory: [{ toStatus: status, reason: 'Tạo hồ sơ học sinh', effectiveDate: admissionDate, changedBy: req.user._id, changedByName: actorName(req.user) }] }], { session }))[0];
            if (isClassroomCountedStatus(status) && !await adjustHeadcount(classroom._id, 1, session)) throw httpError('Không thể cập nhật sĩ số lớp', 409);
            await audit(req, 'STUDENT_CREATED', created, {}, { studentCode: created.studentCode, status }, session);
            return created;
        });
        res.status(201).json({ message: 'Thêm học sinh thành công', data: serializeStudent(student, req.user.role) });
    } catch (err) { console.error(err); res.status(err.statusCode || (err.code === 11000 ? 409 : 500)).json({ message: err.code === 11000 ? 'Mã học sinh đã tồn tại' : (err.message || 'Lỗi server') }); }
};

const getAllStudents = async (req, res) => {
    try {
        const { classroomId, status, search, sortBy = 'fullName', sortOrder = 'asc' } = req.query;
        const page = Number(req.query.page || 1); const limit = Number(req.query.limit || 20);
        if (classroomId && !isValidStudentId(classroomId)) return res.status(400).json({ message: 'ID lớp học không hợp lệ' });
        if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) return res.status(400).json({ message: 'Thông tin phân trang không hợp lệ' });
        if (!SORTS.has(sortBy) || !['asc', 'desc'].includes(sortOrder)) return res.status(400).json({ message: 'Thông tin sắp xếp không hợp lệ' });
        if (status && status !== 'all' && !STUDENT_STATUSES.includes(status)) return res.status(400).json({ message: 'Trạng thái học sinh không hợp lệ' });
        let filter = {};
        if (classroomId) filter.classroomId = classroomId;
        if (status && status !== 'all') filter.status = status; else if (!status) filter.status = 'enrolled';
        if (search?.trim()) { const keyword = regexEscape(search.trim()); filter.$or = [{ fullName: { $regex: keyword, $options: 'i' } }, { studentCode: { $regex: keyword, $options: 'i' } }]; }
        filter = await scopedFilter(req.user, filter, classroomId);
        const [students, total] = await Promise.all([Student.find(filter).sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1, _id: 1 }).skip((page - 1) * limit).limit(limit), Student.countDocuments(filter)]);
        res.json({ message: 'Lấy danh sách học sinh thành công', data: students.map((student) => serializeStudent(student, req.user.role, 'list')), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } catch (err) { console.error(err); res.status(err.statusCode || 500).json({ message: err.message || 'Lỗi server' }); }
};

const getStudentById = async (req, res) => {
    try {
        if (!isValidStudentId(req.params.id)) return res.status(400).json({ message: 'ID học sinh không hợp lệ' });
        const student = await Student.findById(req.params.id); if (!student) return res.status(404).json({ message: 'Không tìm thấy học sinh' });
        if (isParent(req.user) && !canAccessStudent(req.user, student._id)) return res.status(403).json({ message: 'Bạn không có quyền xem thông tin học sinh này' });
        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, student.classroomId)) return res.status(403).json({ message: 'Bạn không có quyền xem thông tin học sinh này' });
        if (!isParent(req.user) && req.user.role !== 'teacher' && !hasSchoolWideReadAccess(req.user)) return res.status(403).json({ message: 'Bạn không có quyền xem dữ liệu học sinh' });
        res.json({ message: 'Lấy chi tiết học sinh thành công', data: serializeStudent(student, req.user.role) });
    } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi server' }); }
};

const updateStudent = async (req, res) => {
    try {
        if (!isValidStudentId(req.params.id)) return res.status(400).json({ message: 'ID học sinh không hợp lệ' });
        const current = await Student.findById(req.params.id); if (!current) return res.status(404).json({ message: 'Không tìm thấy học sinh' });
        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, current.classroomId)) return res.status(403).json({ message: 'Bạn không có quyền cập nhật học sinh này' });
        if (req.user.role === 'teacher') assertTeacherAllowedFields(req.body);
        const updates = pick(req.body, req.user.role); if (!Object.keys(updates).length) return res.status(400).json({ message: 'Không có trường học sinh hợp lệ để cập nhật' });
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
        res.json({ message: 'Cập nhật học sinh thành công', data: serializeStudent(student, req.user.role) });
    } catch (err) { console.error(err); res.status(err.statusCode || 500).json({ message: err.message || 'Lỗi server' }); }
};

const changeStudentStatus = async (req, res) => {
    try {
        if (!isValidStudentId(req.params.id)) return res.status(400).json({ message: 'ID học sinh không hợp lệ' });
        const { status, reason = '', effectiveDate = new Date() } = req.body;
        if (!STUDENT_STATUSES.includes(status)) return res.status(422).json({ message: 'Trạng thái học sinh không hợp lệ' });
        if (Number.isNaN(new Date(effectiveDate).getTime())) return res.status(422).json({ message: 'Ngày hiệu lực không hợp lệ' });
        const student = await Student.findById(req.params.id); if (!student) return res.status(404).json({ message: 'Không tìm thấy học sinh' });
        if (!canTransitionStudentStatus(student.status, status)) return res.status(409).json({ message: `Không thể chuyển từ ${student.status} sang ${status}` });
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
    } catch (err) { console.error(err); res.status(err.statusCode || 500).json({ message: err.message || 'Lỗi server' }); }
};

const deleteStudent = (req, res) => { req.body = { ...req.body, status: 'withdrawn', reason: req.body.reason || 'Hồ sơ ngừng theo học' }; return changeStudentStatus(req, res); };
module.exports = { createStudent, getAllStudents, getStudentById, updateStudent, changeStudentStatus, deleteStudent };
