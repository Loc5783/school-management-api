const crypto = require('crypto');
const Student = require('../models/zone3_school/Student');
const Classroom = require('../models/zone3_school/Classroom');
const AuditLog = require('../models/zone1_system/AuditLog');
const User = require('../models/zone1_system/User');
const Notification = require('../models/zone1_system/Notification');
const ImportIdempotency = require('../models/zone1_system/ImportIdempotency');
const { applyStudentListScope, canAccessStudent, isParent, isValidStudentId } = require('../services/studentAccessService');
const { buildTenantFilter, applyTenantFilter, assertTenantContext } = require('../services/tenantFilterService');
const { canAccessClassroom, getTeacherClassroomIds, hasSchoolWideReadAccess } = require('../services/schoolDataAccessService');
const { STUDENT_STATUSES, isClassroomCountedStatus, canTransitionStudentStatus, generateStudentCode, runStudentTransaction, serializeStudent } = require('../services/studentCoreService');
const { assertPersonCodeAvailable } = require('../services/personCodeService');
const { buildAuthorizedPickersFromParents, normalizeParentPhoneUsername, syncParentAccountsForStudents } = require('../services/parentAutoAccountService');
const { isValidWorkDate, getWorkDate } = require('../utils/dateHelpers');

const ADMIN_MUTABLE = ['studentCode', 'identityCode', 'healthInsuranceCode', 'bloodType', 'fullName', 'birthDate', 'gender', 'address', 'nationality', 'ethnicity', 'birthPlace', 'avatar', 'notes', 'classroomId', 'schoolYear', 'parents', 'authorizedPickers', 'allergies', 'disease', 'emergencyContact', 'admissionDate'];
const TEACHER_CREATE_FIELDS = ['studentCode', 'identityCode', 'healthInsuranceCode', 'bloodType', 'fullName', 'birthDate', 'gender', 'address', 'nationality', 'ethnicity', 'birthPlace', 'avatar', 'notes', 'parents'];
const TEACHER_MUTABLE = ['avatar', 'notes', 'healthInsuranceCode', 'bloodType'];
const PARENT_MUTABLE = ['identityCode', 'healthInsuranceCode', 'bloodType', 'fullName', 'birthDate', 'gender', 'address', 'nationality', 'ethnicity', 'birthPlace', 'avatar', 'allergies', 'disease', 'emergencyContact', 'authorizedPickers'];
const VALID_BLOOD_TYPES = new Set(['', 'A', 'B', 'AB', 'O', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
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
    if (err.name === 'ValidationError') {
        const firstMsg = Object.values(err.errors || {})[0]?.message;
        return res.status(422).json({ success: false, message: firstMsg || 'Dữ liệu hồ sơ học sinh không hợp lệ' });
    }
    if (err.name === 'CastError') {
        return res.status(400).json({ success: false, message: 'Định dạng mã định danh hoặc dữ liệu đầu vào không hợp lệ' });
    }
    const field = Object.keys(err.keyPattern || {})[0];
    const duplicateMessages = { studentCode: 'Mã học sinh đã tồn tại', attendanceCardId: 'Mã thẻ điểm danh đã tồn tại', faceProfileId: 'Mã hồ sơ khuôn mặt đã tồn tại' };
    const status = err.statusCode || (err.code === 11000 ? 409 : 500);
    return res.status(status).json({
        success: false,
        message: err.code === 11000 ? (duplicateMessages[field] || 'Dữ liệu trùng lặp') : (status < 500 ? (err.message || fallback) : fallback)
    });
};
const regexEscape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const deriveSchoolYear = (date = new Date()) => {
    const parsed = new Date(date);
    const startYear = parsed.getMonth() >= 7 ? parsed.getFullYear() : parsed.getFullYear() - 1;
    return `${startYear}-${startYear + 1}`;
};

const isStrictValidCalendarDate = (rawVal) => {
    if (rawVal instanceof Date) return !Number.isNaN(rawVal.getTime());
    const str = String(rawVal || '').trim();
    const ymd = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
    if (ymd) {
        const y = Number(ymd[1]); const m = Number(ymd[2]); const d = Number(ymd[3]);
        const check = new Date(Date.UTC(y, m - 1, d));
        return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d;
    }
    const parsed = new Date(str);
    return !Number.isNaN(parsed.getTime());
};

const audit = (req, action, student, before = {}, after = {}, session = null) => AuditLog.create([{
    ...(req.tenantId || req.user?.tenantId ? { tenantId: req.tenantId || req.user?.tenantId } : {}),
    actorId: req.user._id, actorUsername: req.user.username || req.user.profile?.fullName || 'system', action, targetType: 'Student', targetId: student._id, before, after
}], session ? { session } : undefined);
const adjustHeadcount = (classroomId, delta, session = null) => {
    if (!delta) return null;
    const filter = delta < 0
        ? { _id: classroomId, 'statistics.currentStudents': { $gte: Math.abs(delta) } }
        : {
            _id: classroomId,
            $expr: {
                $lte: [
                    { $add: [{ $ifNull: ['$statistics.currentStudents', 0] }, delta] },
                    { $ifNull: ['$maxSize', 25] }
                ]
            }
        };
    return Classroom.findOneAndUpdate(filter, { $inc: { 'statistics.currentStudents': delta } }, session ? { session } : undefined);
};
const validatePayload = (data, creating = false) => {
    if (creating && (!String(data.fullName || '').trim() || !data.birthDate || !data.gender || !data.classroomId)) throw httpError('Vui lòng nhập họ tên, ngày sinh, giới tính và lớp học', 422);
    if (data.birthDate) {
        if (!isStrictValidCalendarDate(data.birthDate)) throw httpError('Ngày sinh không hợp lệ (ngày không tồn tại trên lịch)', 422);
        const bd = new Date(data.birthDate);
        const now = new Date();
        if (bd > now) throw httpError('Ngày sinh không được ở tương lai', 422);
        const ageYears = (now.getTime() - bd.getTime()) / (365.25 * 24 * 3600 * 1000);
        if (ageYears > 12) throw httpError('Độ tuổi học sinh mầm non không hợp lệ (vượt quá 12 tuổi)', 422);
    }
    if (data.admissionDate && !isStrictValidCalendarDate(data.admissionDate)) throw httpError('Ngày nhập học không hợp lệ', 422);
    if (data.birthDate && data.admissionDate && new Date(data.admissionDate) < new Date(data.birthDate)) throw httpError('Ngày nhập học không được trước ngày sinh', 422);
    if (data.schoolYear) {
        const match = String(data.schoolYear).trim().match(/^(\d{4})-(\d{4})$/);
        if (!match || Number(match[2]) !== Number(match[1]) + 1) throw httpError('Năm học phải có dạng YYYY-YYYY liên tiếp, ví dụ 2026-2027', 422);
    }
    if (data.gender && !['male', 'female'].includes(data.gender)) throw httpError('Giới tính không hợp lệ', 422);
    if (data.bloodType != null && !VALID_BLOOD_TYPES.has(String(data.bloodType).trim().toUpperCase())) throw httpError('Nhóm máu không hợp lệ', 422);
    for (const [field, value, max] of [['fullName', data.fullName, 120], ['identityCode', data.identityCode, 40], ['healthInsuranceCode', data.healthInsuranceCode, 30], ['address', data.address, 500], ['nationality', data.nationality, 80], ['ethnicity', data.ethnicity, 80], ['birthPlace', data.birthPlace, 120], ['notes', data.notes, 2000]]) {
        if (value != null && String(value).trim().length > max) throw httpError(`${field} vượt quá ${max} ký tự`, 422);
    }
    for (const contact of [...(data.parents || []), data.emergencyContact || {}]) {
        if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) throw httpError('Email không hợp lệ', 422);
        if (contact.phone) {
            const normalizedPhone = normalizeParentPhoneUsername(contact.phone) || String(contact.phone).replace(/[.\s()-]/g, '').trim();
            if (!/^(0|\+84)\d{9,10}$/.test(normalizedPhone)) throw httpError('Số điện thoại không hợp lệ', 422);
            contact.phone = normalizedPhone;
        }
    }
    if (Array.isArray(data.parents)) {
        for (const p of data.parents) {
            if (!String(p?.fullName || '').trim() || !String(p?.phone || '').trim()) {
                throw httpError('Thông tin phụ huynh cần có đầy đủ cả Họ tên và Số điện thoại', 422);
            }
            if (p.relationship && !['father', 'mother', 'guardian'].includes(p.relationship)) {
                p.relationship = 'guardian';
            }
        }
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
const scopedFilter = async (user, filter, classroomId, req) => {
    if (!isParent(user) && user?.role !== 'teacher' && user?.role !== 'hr' && !hasSchoolWideReadAccess(user)) {
        throw httpError('Bạn không có quyền xem dữ liệu học sinh', 403);
    }

    const tenantFilter = buildTenantFilter(req);

    if (classroomId) {
        const classroomExists = await Classroom.exists({ _id: classroomId, ...tenantFilter });
        if (!classroomExists) {
            filter.classroomId = { $in: [] };
        }
    }

    if (isParent(user)) {
        filter = applyStudentListScope(user, filter, req);
    } else if (user.role === 'teacher') {
        const ids = await getTeacherClassroomIds(user, req);
        if (classroomId) {
            filter.classroomId = ids.includes(String(classroomId)) ? classroomId : { $in: [] };
        } else {
            filter.classroomId = { $in: ids };
        }
        filter = applyTenantFilter(filter, req);
    } else {
        filter = applyTenantFilter(filter, req);
    }

    return filter;
};

const createStudent = async (req, res) => {
    try {
        if (req.user.role === 'teacher') assertTeacherAllowedFields(req.body, true);
        const data = req.user.role === 'teacher' ? { ...pick(req.body, req.user.role, true), classroomId: req.body.classroomId } : pick(req.body, req.user.role); validatePayload(data, true);
        if (!isValidStudentId(data.classroomId)) return res.status(400).json({ message: 'ID lớp học không hợp lệ' });
        const tenantFilter = buildTenantFilter(req);
        const tenantId = req.tenantId || req.user?.tenantId;
        const classroom = await Classroom.findOne({ _id: data.classroomId, status: 'active', ...tenantFilter });
        if (!classroom) return res.status(404).json({ message: 'Không tìm thấy lớp học' });
        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, classroom._id, req)) return res.status(403).json({ message: 'Bạn không có quyền thêm học sinh vào lớp này' });
        const status = req.user.role === 'teacher' ? 'enrolled' : (req.body.status || 'enrolled');
        if (!STUDENT_STATUSES.includes(status)) return res.status(422).json({ message: 'Trạng thái học sinh không hợp lệ' });
        const admissionDate = data.admissionDate || new Date();
        data.schoolYear = data.schoolYear || deriveSchoolYear(admissionDate);
        const student = await runStudentTransaction(async (session) => {
            const rawManualCode = String(data.studentCode || '').trim();
            const resolvedStudentCode = rawManualCode
                ? await assertPersonCodeAvailable({ code: rawManualCode, tenantId, session })
                : await generateStudentCode(admissionDate, session, tenantId);

            const studentPayload = {
                ...data,
                authorizedPickers: buildAuthorizedPickersFromParents(data.parents, data.authorizedPickers),
                fullName: data.fullName.trim(),
                classroomId: classroom._id,
                className: classroom.name,
                status,
                admissionDate,
                enrollmentDate: admissionDate,
                studentCode: resolvedStudentCode,
                createdBy: req.user._id,
                updatedBy: req.user._id,
                statusHistory: [{ toStatus: status, reason: 'Tạo hồ sơ học sinh', effectiveDate: admissionDate, changedBy: req.user._id, changedByName: actorName(req.user) }]
            };
            if (tenantId) studentPayload.tenantId = tenantId;
            const created = (await Student.create([studentPayload], { session }))[0];
            await syncParentAccountsForStudents({ students: [created], tenantId: tenantId || null, session });
            if (isClassroomCountedStatus(status) && !await adjustHeadcount(classroom._id, 1, session)) throw httpError(`Lớp ${classroom.name} đã đạt sĩ số tối đa (${classroom.maxSize} học sinh)`, 409);
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
        if (schoolYear !== undefined && typeof schoolYear !== 'string') return res.status(400).json({ message: 'Năm học lọc không hợp lệ' });
        if (search !== undefined && typeof search !== 'string') return res.status(400).json({ message: 'Từ khóa tìm kiếm không hợp lệ' });
        let filter = {};
        if (classroomId) filter.classroomId = classroomId;
        if (typeof schoolYear === 'string' && schoolYear.trim()) filter.schoolYear = schoolYear.trim();
        if (status && status !== 'all') filter.status = status; else if (!status) filter.status = 'enrolled';
        if (typeof search === 'string' && search.trim()) {
            const keyword = regexEscape(search.trim().slice(0, 120));
            filter.$or = [
                { fullName: { $regex: keyword, $options: 'i' } },
                { studentCode: { $regex: keyword, $options: 'i' } },
                { identityCode: { $regex: keyword, $options: 'i' } }
            ];
        }
        filter = await scopedFilter(req.user, filter, classroomId, req);
        const [students, total] = await Promise.all([Student.find(filter).sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1, _id: 1 }).skip((page - 1) * limit).limit(limit), Student.countDocuments(filter)]);
        res.json({ success: true, message: 'Lấy danh sách học sinh thành công', data: students.map((student) => serializeStudent(student, req.user.role, 'list')), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } catch (err) { console.error(err); return respondError(res, err); }
};

const getStudentById = async (req, res) => {
    try {
        if (!isValidStudentId(req.params.id)) return res.status(400).json({ message: 'ID học sinh không hợp lệ' });
        const tenantFilter = buildTenantFilter(req);
        const student = await Student.findOne({ _id: req.params.id, ...tenantFilter });
        if (!student) return res.status(404).json({ message: 'Không tìm thấy học sinh' });
        if (isParent(req.user) && !canAccessStudent(req.user, student, req)) return res.status(403).json({ message: 'Bạn không có quyền xem thông tin học sinh này' });
        if (req.user?.role === 'teacher' && !await canAccessClassroom(req.user, student.classroomId, req)) return res.status(403).json({ message: 'Bạn không có quyền xem thông tin học sinh này' });
        if (!isParent(req.user) && req.user?.role !== 'teacher' && req.user?.role !== 'hr' && !hasSchoolWideReadAccess(req.user)) return res.status(403).json({ message: 'Bạn không có quyền xem dữ liệu học sinh' });
        res.json({ success: true, message: 'Lấy chi tiết học sinh thành công', data: serializeStudent(student, req.user?.role) });
    } catch (err) { console.error(err); return respondError(res, err); }
};

const updateStudent = async (req, res) => {
    try {
        if (!isValidStudentId(req.params.id)) return res.status(400).json({ message: 'ID học sinh không hợp lệ' });
        const tenantFilter = buildTenantFilter(req);
        const current = await Student.findOne({ _id: req.params.id, ...tenantFilter }); if (!current) return res.status(404).json({ message: 'Không tìm thấy học sinh' });
        if (isParent(req.user) && !canAccessStudent(req.user, current._id, req)) return res.status(403).json({ message: 'Bạn chỉ được cập nhật hồ sơ của con đã liên kết với tài khoản' });
        if (isParent(req.user)) return res.status(403).json({ success: false, message: 'Phụ huynh cần gửi yêu cầu cập nhật hồ sơ để nhà trường phê duyệt' });
        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, current.classroomId, req)) return res.status(403).json({ message: 'Bạn không có quyền cập nhật học sinh này' });
        if (req.user.role === 'teacher') assertTeacherAllowedFields(req.body);
        const updates = pick(req.body, req.user.role);
        if (Object.hasOwn(updates, 'studentCode') && !String(updates.studentCode || '').trim()) {
            delete updates.studentCode;
        }
        if (!Object.keys(updates).length) return res.status(400).json({ message: 'Không có trường học sinh hợp lệ để cập nhật' });
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
            target = await Classroom.findOne({ _id: updates.classroomId, status: 'active', ...tenantFilter }); if (!target) return res.status(404).json({ message: 'Không tìm thấy lớp học' });
            if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, target._id, req)) return res.status(403).json({ message: 'Bạn không có quyền chuyển học sinh sang lớp này' });
            updates.classroomId = target._id; updates.className = target.name;
        }
        updates.updatedBy = req.user._id;
        const tenantId = req.tenantId || req.user?.tenantId || current.tenantId || null;
        const student = await runStudentTransaction(async (session) => {
            if (Object.hasOwn(updates, 'studentCode')) {
                updates.studentCode = await assertPersonCodeAvailable({
                    code: updates.studentCode,
                    tenantId,
                    excludeStudentId: current._id,
                    session
                });
            }
            if (Array.isArray(updates.parents) && updates.parents.length > 0 && !Object.hasOwn(updates, 'authorizedPickers')) {
                updates.authorizedPickers = buildAuthorizedPickersFromParents(updates.parents, current.authorizedPickers || []);
            }
            const updated = await Student.findOneAndUpdate({ _id: current._id, ...tenantFilter }, { $set: updates }, { returnDocument: 'after', runValidators: true, session });
            if (Array.isArray(updates.parents) && updates.parents.length > 0) {
                await syncParentAccountsForStudents({ students: [updated], tenantId, session });
            }
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
        const tenantFilter = buildTenantFilter(req);
        const student = await Student.findOne({ _id: req.params.id, ...tenantFilter }); if (!student) return res.status(404).json({ success: false, message: 'Không tìm thấy học sinh' });
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

const canReadStudentCare = async (user, student, context) => {
    if (isParent(user)) return canAccessStudent(user, student, context);
    if (user.role === 'teacher') return canAccessClassroom(user, student.classroomId, context);
    return hasSchoolWideReadAccess(user);
};

const getDailyReports = async (req, res) => {
    try {
        if (!isValidStudentId(req.params.id)) return res.status(400).json({ success: false, message: 'ID học sinh không hợp lệ' });
        const tenantFilter = buildTenantFilter(req);
        const student = await Student.findOne({ _id: req.params.id, ...tenantFilter }).select('fullName classroomId dailyReports tenantId');
        if (!student) return res.status(404).json({ success: false, message: 'Không tìm thấy học sinh' });
        if (!await canReadStudentCare(req.user, student, req)) return res.status(403).json({ success: false, message: 'Bạn không có quyền xem sổ chăm sóc của học sinh này' });
        const reports = [...(student.dailyReports || [])].sort((a, b) => new Date(b.reportDate) - new Date(a.reportDate)).slice(0, 60);
        return res.json({ success: true, data: reports });
    } catch (err) { console.error(err); return respondError(res, err); }
};

const saveDailyReport = async (req, res) => {
    try {
        if (!isValidStudentId(req.params.id)) return res.status(400).json({ success: false, message: 'ID học sinh không hợp lệ' });
        const tenantFilter = buildTenantFilter(req);
        const tenantId = req.tenantId || req.user?.tenantId;
        const student = await Student.findOne({ _id: req.params.id, ...tenantFilter });
        if (!student) return res.status(404).json({ success: false, message: 'Không tìm thấy học sinh' });
        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, student.classroomId, req)) return res.status(403).json({ success: false, message: 'Bạn không được ghi sổ cho học sinh ngoài lớp phụ trách' });
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
        const parents = await User.find({ role: 'parent', status: 'active', 'parentInfo.studentIds': student._id, ...tenantFilter }).select('_id').lean();
        await Promise.all(parents.map((parent) => Notification.create({
            ...(tenantId ? { tenantId } : {}),
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
    MULTI_CLASS_TARGET,
    generateTemplateWorkbook,
    parseAndValidateExcelBuffer,
    validateStudentRowStrict,
    computeBatchFingerprint,
    matchClassroomByInput
} = require('../services/studentExcelImportService');

/**
 * Lấy danh sách lớp đang hoạt động mà người dùng hiện tại được phép nhập học sinh,
 * luôn lọc theo tenantId của trường để đảm bảo cách ly dữ liệu Multi-Tenant.
 */
const getAccessibleActiveClassroomsForImport = async (req) => {
    const tenantFilter = buildTenantFilter(req);
    if (req.user?.role === 'teacher') {
        const teacherClassIds = await getTeacherClassroomIds(req.user, req);
        return Classroom.find({ _id: { $in: teacherClassIds }, status: 'active', ...tenantFilter })
            .select('name fullName campus maxSize statistics status schoolYear')
            .sort({ campus: 1, name: 1 })
            .lean();
    }
    return Classroom.find({ status: 'active', ...tenantFilter })
        .select('name fullName campus maxSize statistics status schoolYear')
        .sort({ campus: 1, name: 1 })
        .lean();
};

const downloadExcelTemplate = async (req, res) => {
    try {
        const classrooms = await getAccessibleActiveClassroomsForImport(req);
        const workbook = await generateTemplateWorkbook(classrooms);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="Mau_Nhap_Hoc_Sinh_Hoa_Nang.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error('Lỗi tạo file Excel mẫu:', err);
        if (res.headersSent) return;
        return res.status(500).json({ success: false, message: 'Không thể tạo file Excel mẫu' });
    }
};

const previewExcelImport = async (req, res) => {
    try {
        const tenantFilter = buildTenantFilter(req);
        const rawClassroomId = String(req.body?.classroomId || '').trim();
        const isMultiClass = rawClassroomId === MULTI_CLASS_TARGET;

        if (isMultiClass) {
            if (!['admin', 'principal', 'hr'].includes(req.user.role)) {
                return res.status(403).json({
                    success: false,
                    message: 'Chỉ Ban giám hiệu / Quản trị viên mới được đẩy danh sách tổng nhiều lớp.'
                });
            }
        } else if (!rawClassroomId || !isValidStudentId(rawClassroomId)) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn lớp học hợp lệ để nhập học sinh.' });
        }

        let selectedClassroom = null;
        let availableClassrooms = [];

        if (isMultiClass) {
            availableClassrooms = await getAccessibleActiveClassroomsForImport(req);
            if (!availableClassrooms.length) {
                return res.status(422).json({
                    success: false,
                    message: 'Trường hiện chưa có lớp học nào đang hoạt động để tiếp nhận học sinh.'
                });
            }
        } else {
            selectedClassroom = await Classroom.findOne({ _id: rawClassroomId, status: 'active', ...tenantFilter }).lean();
            if (!selectedClassroom) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy lớp học hoặc lớp đã bị lưu trữ/khóa.' });
            }
            if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, selectedClassroom._id, req)) {
                return res.status(403).json({ success: false, message: 'Bạn không có quyền quản lý lớp học này.' });
            }
            availableClassrooms = [selectedClassroom];
        }

        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn tập tin Excel (.xlsx) để tải lên.' });
        }

        const parsedResult = await parseAndValidateExcelBuffer(
            req.file.buffer,
            isMultiClass ? MULTI_CLASS_TARGET : String(selectedClassroom._id),
            req.user,
            { availableClassrooms, selectedClassroom, reqContext: req }
        );

        // Kiểm tra sĩ số từng lớp tiếp nhận so với số dòng hợp lệ phân bổ vào lớp đó
        const classMap = new Map(availableClassrooms.map((c) => [String(c._id), c]));
        const incomingByClass = new Map();
        for (const row of parsedResult.rows) {
            if (!row.isValid || !row.resolvedClassroomId) continue;
            incomingByClass.set(row.resolvedClassroomId, (incomingByClass.get(row.resolvedClassroomId) || 0) + 1);
        }

        const classSummary = [];
        const exceededMessages = [];
        for (const [clsId, addingCount] of incomingByClass.entries()) {
            const cls = classMap.get(clsId);
            if (!cls) continue;
            const currentCount = Number(cls.statistics?.currentStudents || 0);
            const maxSize = Number(cls.maxSize || 25);
            const prospectiveCount = currentCount + addingCount;
            const exceeded = prospectiveCount > maxSize;
            classSummary.push({
                classroomId: cls._id,
                className: cls.name,
                campus: cls.campus || 'Cơ sở chính',
                currentStudents: currentCount,
                maxSize,
                addingCount,
                prospectiveCount,
                exceeded
            });
            if (exceeded) {
                exceededMessages.push(
                    `Lớp ${cls.name} hiện có ${currentCount}/${maxSize} học sinh, thêm ${addingCount} học sinh sẽ vượt sĩ số tối đa (${prospectiveCount}/${maxSize})`
                );
            }
        }

        let capacityWarning = null;
        let capacityExceeded = false;
        if (exceededMessages.length > 0) {
            capacityExceeded = true;
            capacityWarning = `${exceededMessages.join('; ')}.`;
            parsedResult.canImport = false;
            parsedResult.isValid = false;
            parsedResult.totalErrors += exceededMessages.length;
        }

        return res.json({
            success: true,
            data: {
                fileName: req.file.originalname,
                classroomId: isMultiClass ? MULTI_CLASS_TARGET : selectedClassroom._id,
                className: isMultiClass ? 'Toàn trường (theo cột Lớp)' : selectedClassroom.name,
                currentStudents: selectedClassroom ? Number(selectedClassroom.statistics?.currentStudents || 0) : 0,
                maxSize: selectedClassroom ? Number(selectedClassroom.maxSize || 25) : 0,
                classSummary,
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
        const tenantFilter = buildTenantFilter(req);
        const tenantId = req.tenantId || req.user?.tenantId || null;
        const rawClassroomId = String(req.body?.classroomId || '').trim();
        const rawStudents = req.body?.students;
        const rawIdempotencyKey = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();

        if (!rawIdempotencyKey) {
            return res.status(400).json({ success: false, message: 'Yêu cầu thiếu mã chống ghi lặp (Idempotency-Key).' });
        }

        const idempotencyKey = tenantId ? `${tenantId}:${rawIdempotencyKey}` : rawIdempotencyKey;
        const isMultiClass = rawClassroomId === MULTI_CLASS_TARGET;

        if (isMultiClass) {
            if (!['admin', 'principal', 'hr'].includes(req.user.role)) {
                return res.status(403).json({
                    success: false,
                    message: 'Chỉ Ban giám hiệu / Quản trị viên mới được đẩy danh sách tổng nhiều lớp.'
                });
            }
        } else if (!rawClassroomId || !isValidStudentId(rawClassroomId)) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn lớp học hợp lệ.' });
        }

        let selectedClassroom = null;
        let availableClassrooms = [];

        if (isMultiClass) {
            availableClassrooms = await getAccessibleActiveClassroomsForImport(req);
            if (!availableClassrooms.length) {
                return res.status(422).json({
                    success: false,
                    message: 'Trường hiện chưa có lớp học nào đang hoạt động để tiếp nhận học sinh.'
                });
            }
        } else {
            selectedClassroom = await Classroom.findOne({ _id: rawClassroomId, status: 'active', ...tenantFilter }).lean();
            if (!selectedClassroom) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy lớp học hoặc lớp đã bị lưu trữ.' });
            }
            if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, selectedClassroom._id, req)) {
                return res.status(403).json({ success: false, message: 'Bạn không có quyền thêm học sinh vào lớp này.' });
            }
            availableClassrooms = [selectedClassroom];
        }

        if (!Array.isArray(rawStudents) || rawStudents.length === 0) {
            return res.status(400).json({ success: false, message: 'Danh sách học sinh để nhập không được để trống.' });
        }

        if (rawStudents.length > MAX_ROWS) {
            return res.status(422).json({ success: false, message: `Vượt quá giới hạn tối đa ${MAX_ROWS} học sinh/lần import.` });
        }

        // Bước 1: Kiểm tra tính hợp lệ từng dòng, phân giải lớp đích và chống trùng lặp nội bộ
        const classById = new Map(availableClassrooms.map((c) => [String(c._id), c]));
        const validatedStudents = [];
        const inMemoryCheck = new Set();
        const inMemoryCodes = new Set();
        const incomingByClass = new Map();
        const currentYear = deriveSchoolYear(new Date());

        for (let i = 0; i < rawStudents.length; i++) {
            const rawItem = rawStudents[i] || {};
            const rowNumber = rawItem.rowNumber || (i + 2);
            const { isValid, errors, parsedData } = validateStudentRowStrict(rawItem, rowNumber);
            if (!isValid || !parsedData) {
                return res.status(422).json({
                    success: false,
                    message: `Dòng ${rowNumber}: ${(errors && errors.length) ? errors.join('; ') : 'Dữ liệu không hợp lệ'}`
                });
            }

            let targetClass = null;
            if (isMultiClass) {
                if (rawItem.resolvedClassroomId && classById.has(String(rawItem.resolvedClassroomId))) {
                    targetClass = classById.get(String(rawItem.resolvedClassroomId));
                } else if (parsedData.classNameInput) {
                    const matched = matchClassroomByInput(parsedData.classNameInput, availableClassrooms);
                    if (!matched.classroom) {
                        return res.status(422).json({
                            success: false,
                            message: `Dòng ${rowNumber}: ${matched.ambiguousError || matched.notFoundError}`
                        });
                    }
                    targetClass = matched.classroom;
                } else {
                    return res.status(422).json({
                        success: false,
                        message: `Dòng ${rowNumber}: Cột "Lớp" không được để trống khi đẩy danh sách tổng nhiều lớp.`
                    });
                }
            } else {
                if (parsedData.classNameInput) {
                    const matchedSingle = matchClassroomByInput(parsedData.classNameInput, [selectedClassroom]);
                    if (!matchedSingle.classroom) {
                        return res.status(422).json({
                            success: false,
                            message: `Dòng ${rowNumber}: Cột Lớp "${parsedData.classNameInput}" không khớp với lớp đang chọn "${selectedClassroom.name}".`
                        });
                    }
                }
                targetClass = selectedClassroom;
            }

            const uniqueKey = `${parsedData.fullName.toLowerCase()}||${parsedData.birthDateStr || parsedData.birthDate}||${parsedData.gender}`;
            if (inMemoryCheck.has(uniqueKey)) {
                return res.status(422).json({
                    success: false,
                    message: `Dòng ${rowNumber}: Học sinh "${parsedData.fullName}" bị trùng lặp thông tin với một dòng khác trong cùng danh sách import.`
                });
            }
            inMemoryCheck.add(uniqueKey);

            if (parsedData.studentCode) {
                if (inMemoryCodes.has(parsedData.studentCode)) {
                    return res.status(422).json({
                        success: false,
                        message: `Dòng ${rowNumber}: Mã ID học sinh "${parsedData.studentCode}" bị trùng lặp trong cùng danh sách import.`
                    });
                }
                inMemoryCodes.add(parsedData.studentCode);
            }

            const targetIdStr = String(targetClass._id);
            const prevStats = incomingByClass.get(targetIdStr) || { total: 0, male: 0, female: 0, className: targetClass.name };
            prevStats.total += 1;
            if (parsedData.gender === 'female') prevStats.female += 1;
            else prevStats.male += 1;
            incomingByClass.set(targetIdStr, prevStats);

            validatedStudents.push({
                studentCode: parsedData.studentCode || '',
                identityCode: parsedData.identityCode || '',
                healthInsuranceCode: parsedData.healthInsuranceCode || '',
                bloodType: parsedData.bloodType || '',
                fullName: parsedData.fullName,
                birthDate: parsedData.birthDateObj || new Date(parsedData.birthDate),
                birthDateStr: parsedData.birthDateStr || parsedData.birthDate,
                gender: parsedData.gender,
                admissionDate: parsedData.admissionDate || '',
                admissionDateObj: parsedData.admissionDateObj || null,
                parents: parsedData.parents || [],
                emergencyContact: parsedData.emergencyContact || {},
                allergies: parsedData.allergies || [],
                disease: parsedData.disease || {},
                address: parsedData.address,
                nationality: parsedData.nationality,
                ethnicity: parsedData.ethnicity,
                birthPlace: parsedData.birthPlace,
                notes: parsedData.notes,
                classroomId: targetClass._id,
                className: targetClass.name,
                resolvedClassroomId: targetIdStr,
                resolvedClassName: targetClass.name,
                classNameInput: parsedData.classNameInput || targetClass.name,
                parent1Name: parsedData.parent1Name || '',
                parent1Phone: parsedData.parent1Phone || '',
                parent1Email: parsedData.parent1Email || '',
                parent2Name: parsedData.parent2Name || '',
                parent2Phone: parsedData.parent2Phone || '',
                parent2Email: parsedData.parent2Email || '',
                allergiesText: parsedData.allergiesText || '',
                diseaseText: parsedData.diseaseText || '',
                status: 'enrolled',
                schoolYear: targetClass.schoolYear || currentYear
            });
        }

        // Bước 2: Khóa nguyên tử Idempotency chống gửi lặp request
        const fingerprint = computeBatchFingerprint(
            isMultiClass ? MULTI_CLASS_TARGET : String(selectedClassroom._id),
            validatedStudents
        );
        const STALE_PROCESSING_MS = 2 * 60 * 1000;
        try {
            const idempPayload = {
                idempotencyKey,
                fingerprint,
                userId: req.user._id,
                status: 'processing',
                lockToken: currentLockToken
            };
            if (!isMultiClass && selectedClassroom) {
                idempPayload.classroomId = selectedClassroom._id;
            }
            idempotencyDoc = await ImportIdempotency.create(idempPayload);
        } catch (dupErr) {
            if (dupErr.code === 11000) {
                const existingRecord = await ImportIdempotency.findOne({ idempotencyKey });
                if (!existingRecord) {
                    return res.status(409).json({ success: false, message: 'Yêu cầu đang được xử lý, vui lòng chờ trong giây lát.' });
                }
                if (String(existingRecord.userId) !== String(req.user._id)) {
                    return res.status(403).json({
                        success: false,
                        message: 'Mã yêu cầu (Idempotency-Key) thuộc về người dùng khác. Vui lòng thử lại với yêu cầu mới.'
                    });
                }
                if (existingRecord.fingerprint !== fingerprint) {
                    return res.status(409).json({
                        success: false,
                        message: 'Mã yêu cầu (Idempotency-Key) đã được dùng cho một lô dữ liệu khác.'
                    });
                }
                if (existingRecord.status === 'completed') {
                    return res.status(200).json({
                        ...(existingRecord.response || {}),
                        replayed: true
                    });
                }

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

        // Bước 3: Kiểm tra sơ bộ sĩ số các lớp đích trước khi mở Transaction
        for (const [clsId, stats] of incomingByClass.entries()) {
            const cls = classById.get(clsId);
            const initialCount = Number(cls?.statistics?.currentStudents || 0);
            const maxSize = Number(cls?.maxSize || 25);
            if (initialCount + stats.total > maxSize) {
                if (idempotencyDoc) {
                    await ImportIdempotency.updateOne(
                        { _id: idempotencyDoc._id, lockToken: currentLockToken, status: 'processing' },
                        { $set: { status: 'failed' } }
                    ).catch(() => {});
                }
                return res.status(422).json({
                    success: false,
                    message: `Lớp ${cls.name} hiện có ${initialCount}/${maxSize} học sinh. Thêm ${stats.total} học sinh sẽ vượt quá sĩ số tối đa (${initialCount + stats.total}/${maxSize}).`
                });
            }
        }

        // Bước 4: Thực thi MongoDB Transaction nguyên khối (không N+1 queries)
        const now = new Date();
        const actorFullName = actorName(req.user);
        const actorUsername = req.user.username || actorFullName;
        const actorRole = req.user.role || 'admin';

        const resultPayload = await runStudentTransaction(async (session) => {
            const targetClassIds = [...incomingByClass.keys()];
            const lockedClassrooms = await Classroom.find({
                _id: { $in: targetClassIds },
                status: 'active',
                ...tenantFilter
            }).session(session);

            if (lockedClassrooms.length !== targetClassIds.length) {
                throw httpError('Một hoặc nhiều lớp học tiếp nhận không tồn tại hoặc đã bị lưu trữ.', 404);
            }

            for (const lockedCls of lockedClassrooms) {
                const stats = incomingByClass.get(String(lockedCls._id));
                const currentCount = Number(lockedCls.statistics?.currentStudents || 0);
                const classMax = Number(lockedCls.maxSize || 25);
                if (currentCount + stats.total > classMax) {
                    throw httpError(
                        `Sĩ số lớp ${lockedCls.name} sẽ vượt quá mức tối đa cho phép (${currentCount + stats.total}/${classMax}). Không thể hoàn tất nhập học sinh.`,
                        422
                    );
                }
            }

            // Đối chiếu trùng lặp với DB trong 1 truy vấn gom nhóm ($in)
            const candidateNames = [...new Set(validatedStudents.map((s) => s.fullName))];
            const manualCodes = [...new Set(validatedStudents.map((s) => s.studentCode).filter(Boolean))];
            const dupOrConditions = [{ fullName: { $in: candidateNames } }];
            if (manualCodes.length > 0) {
                dupOrConditions.push({ studentCode: { $in: manualCodes } });
            }

            const existing = await Student.find({
                ...tenantFilter,
                $or: dupOrConditions
            }).select('fullName birthDate gender className studentCode classroomId').session(session).lean();

            for (const candidate of validatedStudents) {
                if (candidate.studentCode) {
                    const codeMatch = existing.find((s) => String(s.studentCode || '').toUpperCase() === candidate.studentCode);
                    if (codeMatch) {
                        throw httpError(`Mã ID học sinh "${candidate.studentCode}" đã được cấp cho học sinh "${codeMatch.fullName}".`, 409);
                    }
                    await assertPersonCodeAvailable({ code: candidate.studentCode, tenantId, session });
                }

                const candDate = candidate.birthDateStr;
                const match = existing.find((s) => {
                    if (s.fullName.toLowerCase() !== candidate.fullName.toLowerCase()) return false;
                    if (s.gender !== candidate.gender) return false;
                    const sDate = s.birthDate instanceof Date ? s.birthDate.toISOString().slice(0, 10) : String(s.birthDate || '').slice(0, 10);
                    return sDate === candDate;
                });

                if (match) {
                    const isAuthorized = req.user.role !== 'teacher' || (match.classroomId && (await canAccessClassroom(req.user, match.classroomId, req)));
                    const errorDetail = isAuthorized
                        ? `Học sinh "${candidate.fullName}" nghi trùng với hồ sơ đã có (${match.studentCode || 'Đã có'}, lớp ${match.className || 'Chưa xếp lớp'}). Vui lòng kiểm tra lại.`
                        : `Học sinh "${candidate.fullName}" nghi trùng với hồ sơ học sinh đã có trong toàn trường. Vui lòng kiểm tra lại.`;
                    throw httpError(errorDetail, 409);
                }
            }

            // Cấp mã ID học sinh tuần tự cho các dòng để trống mã và gom mảng insertMany
            const docsToInsert = [];
            for (const data of validatedStudents) {
                const effectiveAdmissionDate = data.admissionDateObj || now;
                const resolvedCode = data.studentCode
                    ? data.studentCode
                    : await generateStudentCode(effectiveAdmissionDate, session, tenantId);

                const doc = {
                    studentCode: resolvedCode,
                    identityCode: data.identityCode || '',
                    healthInsuranceCode: data.healthInsuranceCode || '',
                    bloodType: data.bloodType || '',
                    fullName: data.fullName,
                    birthDate: data.birthDate,
                    gender: data.gender,
                    address: data.address,
                    nationality: data.nationality,
                    ethnicity: data.ethnicity,
                    birthPlace: data.birthPlace,
                    notes: data.notes,
                    parents: data.parents,
                    authorizedPickers: buildAuthorizedPickersFromParents(data.parents, []),
                    emergencyContact: data.emergencyContact,
                    allergies: data.allergies,
                    disease: data.disease,
                    classroomId: data.classroomId,
                    className: data.className,
                    status: 'enrolled',
                    schoolYear: data.schoolYear || deriveSchoolYear(effectiveAdmissionDate),
                    admissionDate: effectiveAdmissionDate,
                    enrollmentDate: effectiveAdmissionDate,
                    createdBy: req.user._id,
                    updatedBy: req.user._id,
                    statusHistory: [{
                        toStatus: 'enrolled',
                        reason: 'Nhập học sinh hàng loạt từ Excel',
                        effectiveDate: effectiveAdmissionDate,
                        changedBy: req.user._id,
                        changedByName: actorFullName
                    }]
                };
                if (tenantId) doc.tenantId = tenantId;
                docsToInsert.push(doc);
            }

            const createdStudents = await Student.insertMany(docsToInsert, { session, ordered: true });
            const parentSyncStats = await syncParentAccountsForStudents({
                students: createdStudents,
                tenantId: tenantId || null,
                session
            });

            // Ghi nhật ký kiểm toán hàng loạt (đính kèm sẵn actorName & actorRole để tránh truy vấn lặp User)
            const auditEntries = createdStudents.map((created) => ({
                ...(tenantId ? { tenantId } : {}),
                actorId: req.user._id,
                actorUsername,
                actorName: actorFullName,
                actorRole,
                action: 'STUDENT_CREATED',
                targetType: 'Student',
                targetId: created._id,
                before: {},
                after: {
                    studentCode: created.studentCode,
                    identityCode: created.identityCode || '',
                    className: created.className,
                    status: 'enrolled',
                    importSource: 'excel'
                }
            }));
            await AuditLog.insertMany(auditEntries, { session, ordered: true });

            // Cập nhật thống kê sĩ số tất cả lớp tiếp nhận bằng 1 lệnh bulkWrite duy nhất
            const classBulkOps = [...incomingByClass.entries()].map(([clsId, stats]) => ({
                updateOne: {
                    filter: { _id: clsId, ...tenantFilter },
                    update: {
                        $inc: {
                            'statistics.currentStudents': stats.total,
                            'statistics.male': stats.male,
                            'statistics.female': stats.female
                        }
                    }
                }
            }));
            await Classroom.bulkWrite(classBulkOps, { session });

            const serialized = createdStudents.map((s) => serializeStudent(s, req.user.role));
            const summaryLabel = isMultiClass
                ? `${incomingByClass.size} lớp (${[...incomingByClass.values()].map((c) => `${c.className}: +${c.total}`).join(', ')})`
                : `lớp ${selectedClassroom.name}`;

            const parentAccountNote = (parentSyncStats.createdCount > 0 || parentSyncStats.linkedCount > 0)
                ? ` (Đã tự động cấp ${parentSyncStats.createdCount} tài khoản phụ huynh mới & liên kết ${parentSyncStats.linkedCount} tài khoản hiện có theo SĐT)`
                : '';

            const responsePayload = {
                success: true,
                message: `Nhập thành công ${createdStudents.length} học sinh vào ${summaryLabel}${parentAccountNote}.`,
                parentSyncStats,
                data: serialized
            };

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
    let internalKey = null;
    try {
        const tenantContext = assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req);

        if (!['admin', 'hr', 'principal'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền chuyển lớp học sinh' });
        }
        if (!isValidStudentId(req.params.id)) return res.status(400).json({ success: false, message: 'ID học sinh không hợp lệ' });
        const { toClassroomId, reason = '', effectiveDate } = req.body || {};
        if (!isValidStudentId(toClassroomId)) return res.status(400).json({ success: false, message: 'ID lớp chuyển đến không hợp lệ' });
        const cleanReason = String(reason).trim();
        if (!cleanReason) return res.status(422).json({ success: false, message: 'Vui lòng nhập lý do chuyển lớp' });

        // Require valid Idempotency-Key header (16-128 chars)
        const rawIdempotencyKey = String(req.get('Idempotency-Key') || '').trim();
        if (!rawIdempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(rawIdempotencyKey)) {
            return res.status(400).json({
                success: false,
                message: 'Header Idempotency-Key là bắt buộc để chuyển lớp (chuỗi 16-128 ký tự gồm chữ cái, chữ số, gạch nối hoặc gạch dưới).'
            });
        }

        // Namespaced internal idempotency key for SaaS so global unique index remains safe; legacy raw key behavior unchanged
        internalKey = tenantContext.isSaaS
            ? `${tenantContext.tenantId}:${rawIdempotencyKey}`
            : rawIdempotencyKey;

        // Check existing idempotency record first to stabilize contract on retries
        const existingRecord = await ImportIdempotency.findOne({
            idempotencyKey: internalKey,
            ...tenantFilter
        });

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
            if (tenantContext.isSaaS && (!existingRecord.tenantId || !existingRecord.tenantId.equals(tenantContext.tenantId))) {
                return res.status(409).json({ success: false, message: 'Khóa idempotency này thuộc về một người dùng khác.' });
            }
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
                    idempotencyKey: internalKey,
                    ...tenantFilter,
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
                    tenantId: tenantContext.tenantId || null,
                    idempotencyKey: internalKey,
                    fingerprint,
                    status: 'processing',
                    lockToken: currentLockToken,
                    userId: req.user._id,
                    effectiveDate: targetEffectiveDate
                });
            } catch (dupErr) {
                if (dupErr.code === 11000) {
                    const raceRecord = await ImportIdempotency.findOne({
                        idempotencyKey: internalKey,
                        ...tenantFilter
                    });
                    if (!raceRecord) {
                        return res.status(409).json({ success: false, message: 'Khóa idempotency bị xung đột dữ liệu.' });
                    }
                    if (tenantContext.isSaaS && (!raceRecord.tenantId || !raceRecord.tenantId.equals(tenantContext.tenantId))) {
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
                            idempotencyKey: internalKey,
                            ...tenantFilter,
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
                    {
                        _id: idempotencyDoc._id,
                        ...(internalKey ? { idempotencyKey: internalKey } : {}),
                        lockToken: currentLockToken,
                        status: 'processing'
                    },
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
            const studentDoc = await Student.findOne({ _id: req.params.id, ...tenantFilter }).session(session);
            if (!studentDoc) throw httpError('Không tìm thấy học sinh', 404);
            if (!['enrolled', 'temporarily_absent'].includes(studentDoc.status)) {
                throw httpError('Chỉ được chuyển lớp cho học sinh đang theo học (enrolled hoặc tạm vắng)', 422);
            }

            const fromClassroomId = studentDoc.classroomId;
            if (String(fromClassroomId) === String(toClassroomId)) {
                throw httpError('Lớp mới phải khác lớp hiện tại của học sinh', 422);
            }

            // Đọc tuần tự trong session để tránh xung đột startTransaction song song trên Replica Set
            const fromClassroom = await Classroom.findOne({ _id: fromClassroomId, ...tenantFilter }).session(session);
            const toClassroom = await Classroom.findOne({ _id: toClassroomId, status: 'active', ...tenantFilter }).session(session);

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
                    ...tenantFilter,
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
                    ...tenantFilter,
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
                    classroomId: fromClassroomId,
                    ...tenantFilter
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
                tenantId: tenantContext.tenantId || null,
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

            const parentUsers = await User.find({
                role: 'parent',
                'parentInfo.studentIds': studentDoc._id,
                ...tenantFilter
            }).select('_id').session(session);
            for (const p of parentUsers) recipients.add(String(p._id));

            const notifTenantId = req.tenantId || req.user?.tenantId || studentDoc.tenantId || null;
            for (const recipientId of recipients) {
                await Notification.create([{
                    ...(notifTenantId ? { tenantId: notifTenantId } : {}),
                    recipientId,
                    title: `Học sinh ${studentDoc.fullName} chuyển lớp`,
                    message: `Học sinh ${studentDoc.fullName} (${studentDoc.studentCode}) đã được chuyển từ lớp ${fromClassroom.name} sang lớp ${toClassroom.name}. Lý do: ${cleanReason}`,
                    type: 'info',
                    link: '/students',
                    createdBy: req.user._id
                }], session ? { session } : undefined);
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
                        ...(internalKey ? { idempotencyKey: internalKey } : {}),
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
                {
                    _id: idempotencyDoc._id,
                    ...(internalKey ? { idempotencyKey: internalKey } : {}),
                    lockToken: currentLockToken,
                    status: 'processing'
                },
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
        const tenantContext = assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req);
        
        const student = await Student.findOne({ _id: req.params.id, ...tenantFilter })
            .select('_id classroomId parents fullName studentCode tenantId')
            .lean();
        if (!student) return res.status(404).json({ success: false, message: 'Không tìm thấy học sinh' });

        // Scoped access control
        if (['admin', 'principal', 'hr'].includes(req.user.role)) {
            // Full access within tenant
        } else if (req.user.role === 'teacher') {
            const teacherClassIds = await getTeacherClassroomIds(req.user, req);
            const isCurrentClass = student.classroomId && teacherClassIds.includes(String(student.classroomId));
            if (!isCurrentClass) {
                const hadPastClass = await StudentTransferHistory.exists({
                    studentId: student._id,
                    ...tenantFilter,
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
            const hasAccess = canAccessStudent(req.user, student, req);
            if (!hasAccess) {
                return res.status(403).json({ success: false, message: 'Bạn không có quyền xem thông tin học sinh này' });
            }
        } else {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền xem lịch sử chuyển lớp' });
        }

        const history = await StudentTransferHistory.find({ studentId: req.params.id, ...tenantFilter })
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

/**
 * Đánh giá nhanh thể trạng mầm non theo BMI tham khảo để giáo viên & phụ huynh theo dõi xu hướng hàng tháng.
 */
const evaluatePreschoolNutritionStatus = (bmi) => {
    if (!Number.isFinite(bmi)) return 'Bình thường';
    if (bmi < 13.5) return 'Nhẹ cân / Cần tăng cường dinh dưỡng';
    if (bmi > 18.5) return 'Thừa cân / Cần cân đối khẩu phần';
    return 'Phát triển bình thường';
};

/**
 * Thêm hoặc cập nhật chỉ số Cân nặng & Chiều cao theo tháng (YYYY-MM) của học sinh.
 */
const saveGrowthRecord = async (req, res) => {
    try {
        if (!isValidStudentId(req.params.id)) return res.status(400).json({ success: false, message: 'ID học sinh không hợp lệ' });
        const tenantFilter = buildTenantFilter(req);
        const student = await Student.findOne({ _id: req.params.id, ...tenantFilter });
        if (!student) return res.status(404).json({ success: false, message: 'Không tìm thấy học sinh' });
        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, student.classroomId, req)) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền cập nhật sức khỏe học sinh ngoài lớp phụ trách' });
        }

        const month = String(req.body?.month || '').trim();
        const weightKg = Number(req.body?.weightKg);
        const heightCm = Number(req.body?.heightCm);
        const note = String(req.body?.note || '').trim().slice(0, 500);

        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
            return res.status(422).json({ success: false, message: 'Tháng đo phải có định dạng YYYY-MM (ví dụ: 2026-11)' });
        }
        if (!Number.isFinite(weightKg) || weightKg < 1 || weightKg > 120) {
            return res.status(422).json({ success: false, message: 'Cân nặng phải nằm trong khoảng 1 – 120 kg' });
        }
        if (!Number.isFinite(heightCm) || heightCm < 30 || heightCm > 200) {
            return res.status(422).json({ success: false, message: 'Chiều cao phải nằm trong khoảng 30 – 200 cm' });
        }

        const bmi = Number((weightKg / ((heightCm / 100) ** 2)).toFixed(1));
        if (!Number.isFinite(bmi) || bmi < 5 || bmi > 80) {
            return res.status(422).json({ success: false, message: 'Tỷ lệ cân nặng và chiều cao không hợp lý (BMI nằm ngoài ngưỡng sinh học). Vui lòng kiểm tra lại đơn vị kg và cm.' });
        }
        const nutritionStatus = (String(req.body?.nutritionStatus || '').trim() || evaluatePreschoolNutritionStatus(bmi)).slice(0, 80);

        student.growthRecords = student.growthRecords || [];
        const existing = student.growthRecords.find((item) => item.month === month);
        if (existing) {
            existing.weightKg = Number(weightKg.toFixed(1));
            existing.heightCm = Number(heightCm.toFixed(1));
            existing.bmi = bmi;
            existing.nutritionStatus = nutritionStatus;
            existing.note = note;
            existing.measuredAt = new Date();
            existing.recordedBy = req.user._id;
            existing.recordedByName = actorName(req.user);
        } else {
            student.growthRecords.push({
                month,
                measuredAt: new Date(),
                weightKg: Number(weightKg.toFixed(1)),
                heightCm: Number(heightCm.toFixed(1)),
                bmi,
                nutritionStatus,
                note,
                recordedBy: req.user._id,
                recordedByName: actorName(req.user)
            });
        }

        student.growthRecords.sort((a, b) => String(b.month).localeCompare(String(a.month)));
        student.updatedBy = req.user._id;
        await student.save();

        return res.json({
            success: true,
            message: `Đã lưu chỉ số cân nặng – chiều cao tháng ${month.split('-').reverse().join('/')}`,
            data: serializeStudent(student, req.user.role)
        });
    } catch (err) {
        console.error(err);
        return respondError(res, err, 'Không thể lưu chỉ số cân nặng – chiều cao');
    }
};

const deleteGrowthRecord = async (req, res) => {
    try {
        if (!isValidStudentId(req.params.id) || !isValidStudentId(req.params.recordId)) {
            return res.status(400).json({ success: false, message: 'ID không hợp lệ' });
        }
        const tenantFilter = buildTenantFilter(req);
        const student = await Student.findOne({ _id: req.params.id, ...tenantFilter });
        if (!student) return res.status(404).json({ success: false, message: 'Không tìm thấy học sinh' });
        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, student.classroomId, req)) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền xóa chỉ số sức khỏe của học sinh ngoài lớp phụ trách' });
        }

        const beforeLen = (student.growthRecords || []).length;
        student.growthRecords = (student.growthRecords || []).filter((item) => String(item._id) !== String(req.params.recordId));
        if (student.growthRecords.length === beforeLen) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy bản ghi cân đo' });
        }
        student.updatedBy = req.user._id;
        await student.save();

        return res.json({
            success: true,
            message: 'Đã xóa bản ghi cân đo tháng',
            data: serializeStudent(student, req.user.role)
        });
    } catch (err) {
        console.error(err);
        return respondError(res, err);
    }
};

/**
 * Thêm mũi tiêm chủng vào Sổ tiêm chủng của học sinh.
 */
const addVaccinationRecord = async (req, res) => {
    try {
        if (!isValidStudentId(req.params.id)) return res.status(400).json({ success: false, message: 'ID học sinh không hợp lệ' });
        const tenantFilter = buildTenantFilter(req);
        const student = await Student.findOne({ _id: req.params.id, ...tenantFilter });
        if (!student) return res.status(404).json({ success: false, message: 'Không tìm thấy học sinh' });
        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, student.classroomId, req)) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền cập nhật sổ tiêm chủng ngoài lớp phụ trách' });
        }

        const vaccineName = String(req.body?.vaccineName || '').trim();
        const doseNumber = Number(req.body?.doseNumber ?? 1);
        const status = String(req.body?.status || 'completed').trim();
        const facility = String(req.body?.facility || '').trim().slice(0, 150);
        const note = String(req.body?.note || '').trim().slice(0, 500);
        const rawDate = req.body?.vaccinatedDate;

        if (!vaccineName || vaccineName.length > 150) {
            return res.status(422).json({ success: false, message: 'Vui lòng nhập tên vắc-xin hợp lệ (tối đa 150 ký tự)' });
        }
        if (!Number.isInteger(doseNumber) || doseNumber < 1 || doseNumber > 20) {
            return res.status(422).json({ success: false, message: 'Mũi tiêm số phải là số nguyên từ 1 đến 20' });
        }
        if (!['completed', 'scheduled', 'missed'].includes(status)) {
            return res.status(422).json({ success: false, message: 'Trạng thái mũi tiêm không hợp lệ' });
        }

        let vaccinatedDate = null;
        if (rawDate) {
            if (!isStrictValidCalendarDate(rawDate)) {
                return res.status(422).json({ success: false, message: 'Ngày tiêm chủng không hợp lệ' });
            }
            vaccinatedDate = new Date(rawDate);
            if (student.birthDate && vaccinatedDate < new Date(student.birthDate)) {
                return res.status(422).json({ success: false, message: 'Ngày tiêm chủng không được trước ngày sinh của bé' });
            }
        }

        student.vaccinations = student.vaccinations || [];
        student.vaccinations.push({
            vaccineName,
            doseNumber,
            ...(vaccinatedDate ? { vaccinatedDate } : {}),
            status,
            facility,
            note,
            recordedBy: req.user._id,
            recordedByName: actorName(req.user),
            recordedAt: new Date()
        });
        student.vaccinations.sort((a, b) => new Date(b.vaccinatedDate || b.recordedAt || 0) - new Date(a.vaccinatedDate || a.recordedAt || 0));
        student.updatedBy = req.user._id;
        await student.save();

        return res.status(201).json({
            success: true,
            message: 'Đã thêm mũi tiêm vào hồ sơ tiêm chủng',
            data: serializeStudent(student, req.user.role)
        });
    } catch (err) {
        console.error(err);
        return respondError(res, err, 'Không thể lưu thông tin tiêm chủng');
    }
};

const deleteVaccinationRecord = async (req, res) => {
    try {
        if (!isValidStudentId(req.params.id) || !isValidStudentId(req.params.vaxId)) {
            return res.status(400).json({ success: false, message: 'ID không hợp lệ' });
        }
        const tenantFilter = buildTenantFilter(req);
        const student = await Student.findOne({ _id: req.params.id, ...tenantFilter });
        if (!student) return res.status(404).json({ success: false, message: 'Không tìm thấy học sinh' });
        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, student.classroomId, req)) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền xóa mũi tiêm của học sinh ngoài lớp phụ trách' });
        }

        const beforeLen = (student.vaccinations || []).length;
        student.vaccinations = (student.vaccinations || []).filter((item) => String(item._id) !== String(req.params.vaxId));
        if (student.vaccinations.length === beforeLen) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy mũi tiêm cần xóa' });
        }
        student.updatedBy = req.user._id;
        await student.save();

        return res.json({
            success: true,
            message: 'Đã xóa thông tin mũi tiêm',
            data: serializeStudent(student, req.user.role)
        });
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
    saveGrowthRecord,
    deleteGrowthRecord,
    addVaccinationRecord,
    deleteVaccinationRecord,
    downloadExcelTemplate,
    previewExcelImport,
    confirmExcelImport,
    transferStudentClassroom,
    getStudentTransferHistory
};
