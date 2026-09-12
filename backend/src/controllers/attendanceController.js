const StudentAttendance = require('../models/zone3_school/StudentAttendance');
const StudentLeaveRequest = require('../models/zone3_school/StudentLeaveRequest');
const Notification = require('../models/zone1_system/Notification');
const Student = require('../models/zone3_school/Student');
const Classroom = require('../models/zone3_school/Classroom');
const {
    canAccessStudent,
    isParent,
    isValidStudentId
} = require('../services/studentAccessService');
const {
    canAccessClassroom,
    hasSchoolWideReadAccess
} = require('../services/schoolDataAccessService');
const { isValidObjectId } = require('../utils/idValidation');
const {
    DEFAULT_SCHOOL_TIMEZONE,
    getWorkDate,
    getWorkDateRange,
    addWorkDays,
    isValidWorkDate
} = require('../utils/dateHelpers');
const { runStudentTransaction } = require('../services/studentCoreService');

const getTodayRange = () => getWorkDateRange(
    getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE),
    DEFAULT_SCHOOL_TIMEZONE
);

const parseWorkDate = (value) => {
    if (typeof value !== 'string' || !value.trim()) return null;
    if (isValidWorkDate(value)) return value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
        ? null
        : getWorkDate(parsed, DEFAULT_SCHOOL_TIMEZONE);
};

const isDuplicateKeyError = (error) => error?.code === 11000;
const SCHOOL_WIDE_ATTENDANCE_ROLES = new Set(['admin', 'principal']);

const getWeekdayDateKeys = (startDate, endDate) => {
    const dates = [];
    for (let date = startDate; date <= endDate; date = addWorkDays(date, 1)) {
        const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
        if (weekday !== 0 && weekday !== 6) dates.push(date);
    }
    return dates;
};

const canReadLeaveRequests = async (user, classroomId) => (
    SCHOOL_WIDE_ATTENDANCE_ROLES.has(user?.role)
    || (user?.role === 'teacher' && await canAccessClassroom(user, classroomId))
);

// Check-in tự động bằng mã thẻ hoặc mã hồ sơ khuôn mặt từ thiết bị/dịch vụ nhận diện.
const automaticCheckIn = async (req, res) => {
    try {
        const { identifier, method } = req.body;
        if (!identifier || !['card', 'face'].includes(method)) {
            return res.status(400).json({ message: 'Cần gửi identifier và method là card hoặc face' });
        }

        const field = method === 'card' ? 'attendanceCardId' : 'faceProfileId';
        const value = method === 'card' ? String(identifier).trim().toUpperCase() : String(identifier).trim();
        const student = await Student.findOne({ [field]: value, status: 'enrolled' });
        if (!student) {
            return res.status(404).json({ message: 'Không tìm thấy học sinh đã đăng ký thông tin điểm danh này' });
        }

        const workDate = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
        const { start, end } = getWorkDateRange(workDate, DEFAULT_SCHOOL_TIMEZONE);
        const existing = await StudentAttendance.findOne({
            studentId: student._id,
            attendDate: { $gte: start, $lt: end }
        });
        if (existing) {
            return res.status(200).json({
                message: `${student.fullName} đã được điểm danh hôm nay`,
                alreadyCheckedIn: true,
                data: existing
            });
        }

        const classroom = await Classroom.findById(student.classroomId);
        if (!classroom) {
            return res.status(404).json({ message: 'Không tìm thấy lớp học của học sinh' });
        }

        const attendance = await StudentAttendance.create({
            studentId: student._id,
            studentName: student.fullName,
            classroomId: student.classroomId,
            className: classroom.name,
            attendDate: start,
            attendanceDateKey: workDate,
            status: 'present',
            checkInTime: new Date(),
            attendanceMethod: method,
            recordedBy: req.user._id,
            recordedByName: req.user.profile.fullName
        });

        return res.status(201).json({
            message: `Đã điểm danh ${student.fullName}`,
            alreadyCheckedIn: false,
            data: attendance
        });
    } catch (err) {
        if (isDuplicateKeyError(err)) {
            return res.status(409).json({ message: 'Học sinh đã có bản ghi điểm danh trong ngày' });
        }
        console.error(err);
        return res.status(500).json({ message: 'Không thể xử lý điểm danh tự động' });
    }
};

// Điểm danh một học sinh
const createAttendance = async (req, res) => {
    try {
        const { studentId, status, checkInTime, checkOutTime, pickerName, note } = req.body;

        if (!isValidStudentId(studentId)) {
            return res.status(400).json({ message: 'ID học sinh không hợp lệ' });
        }

        // Kiểm tra học sinh tồn tại
        const student = await Student.findById(studentId);
        if (!student) {
            return res.status(404).json({ message: 'Không tìm thấy học sinh' });
        }

        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, student.classroomId)) {
            return res.status(403).json({ message: 'Bạn không có quyền điểm danh học sinh ngoài lớp được phân công' });
        }

        // Lấy classroom
        const classroom = await Classroom.findById(student.classroomId);
        if (!classroom) {
            return res.status(404).json({ message: 'Không tìm thấy lớp học' });
        }

        const workDate = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
        const { start, end } = getWorkDateRange(workDate, DEFAULT_SCHOOL_TIMEZONE);
        const existing = await StudentAttendance.findOne({
            studentId: student._id,
            attendDate: { $gte: start, $lt: end }
        });
        if (existing) {
            return res.status(409).json({ message: 'Học sinh đã có bản ghi điểm danh hôm nay', data: existing });
        }

        // Tạo bản ghi điểm danh
        const attendance = new StudentAttendance({
            studentId,
            studentName: student.fullName,
            classroomId: student.classroomId,
            className: classroom.name,
            attendDate: start,
            attendanceDateKey: workDate,
            status: status || 'present',
            checkInTime,
            attendanceMethod: 'manual',
            checkOutTime,
            pickerName,
            note,
            recordedBy: req.user._id,
            recordedByName: req.user.profile.fullName
        });

        await attendance.save();

        res.status(201).json({
            message: 'Điểm danh thành công',
            data: attendance
        });
    } catch (err) {
        if (isDuplicateKeyError(err)) {
            return res.status(409).json({ message: 'Học sinh đã có bản ghi điểm danh trong ngày' });
        }
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Điểm danh nhiều học sinh cùng lúc (theo lớp)
const createBulkAttendance = async (req, res) => {
    try {
        const { classroomId, attendDate, records } = req.body;
        // records: [{ studentId, status, checkInTime, note }]

        if (!Array.isArray(records) || records.length === 0) {
            return res.status(400).json({ message: 'Cần gửi ít nhất một bản ghi điểm danh' });
        }

        const workDate = attendDate
            ? parseWorkDate(String(attendDate))
            : getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
        if (!workDate) {
            return res.status(400).json({ message: 'Ngày điểm danh không hợp lệ' });
        }

        if (!isValidObjectId(classroomId)) {
            return res.status(400).json({ message: 'ID lớp học không hợp lệ' });
        }

        // Kiểm tra lớp
        const classroom = await Classroom.findById(classroomId);
        if (!classroom) {
            return res.status(404).json({ message: 'Không tìm thấy lớp học' });
        }

        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, classroomId)) {
            return res.status(403).json({ message: 'Bạn không có quyền điểm danh lớp này' });
        }

        const studentIds = records.map((record) => record?.studentId);
        if (studentIds.some((studentId) => !isValidStudentId(studentId))) {
            return res.status(400).json({ message: 'Danh sách học sinh chứa ID không hợp lệ' });
        }

        const uniqueStudentIds = [...new Set(studentIds.map(String))];
        if (uniqueStudentIds.length !== studentIds.length) {
            return res.status(400).json({ message: 'Không được gửi trùng học sinh trong một lần điểm danh' });
        }

        const students = await Student.find({
            _id: { $in: uniqueStudentIds },
            classroomId,
            status: 'enrolled'
        }).select('fullName classroomId');

        if (students.length !== uniqueStudentIds.length) {
            return res.status(400).json({ message: 'Mỗi học sinh phải đang theo học và thuộc đúng lớp được điểm danh' });
        }

        const { start: workDateStart, end: workDateEnd } = getWorkDateRange(workDate, DEFAULT_SCHOOL_TIMEZONE);
        const existingRecords = await StudentAttendance.find({
            studentId: { $in: uniqueStudentIds },
            attendDate: { $gte: workDateStart, $lt: workDateEnd }
        }).select('studentId');
        const existingStudentIds = new Set(existingRecords.map((record) => record.studentId.toString()));
        const studentsById = new Map(students.map((student) => [student._id.toString(), student]));
        const attendanceRecords = records
            .filter((record) => !existingStudentIds.has(record.studentId.toString()))
            .map((record) => {
                const student = studentsById.get(record.studentId.toString());
                return {
                    studentId: student._id,
                    studentName: student.fullName,
                    classroomId: student.classroomId,
                    className: classroom.name,
                    attendDate: workDateStart,
                    attendanceDateKey: workDate,
                    status: record.status || 'present',
                    checkInTime: record.checkInTime,
                    note: record.note,
                    recordedBy: req.user._id,
                    recordedByName: req.user.profile.fullName
                };
            });

        if (attendanceRecords.length === 0) {
            return res.status(200).json({ message: 'Các học sinh này đã có bản ghi điểm danh trong ngày', data: [] });
        }

        const result = await StudentAttendance.insertMany(attendanceRecords);

        res.status(201).json({
            message: `Điểm danh thành công ${result.length} học sinh`,
            data: result
        });
    } catch (err) {
        if (isDuplicateKeyError(err)) {
            return res.status(409).json({ message: 'Bản ghi điểm danh đã được tạo bởi một yêu cầu khác' });
        }
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Lấy danh sách điểm danh theo học sinh
const getAttendanceByStudent = async (req, res) => {
    try {
        const { studentId } = req.params;
        const { startDate, endDate } = req.query;

        if (!isValidStudentId(studentId)) {
            return res.status(400).json({ message: 'ID học sinh không hợp lệ' });
        }

        // This check intentionally happens before querying StudentAttendance.
        if (isParent(req.user) && !canAccessStudent(req.user, studentId)) {
            return res.status(403).json({ message: 'Bạn không có quyền xem dữ liệu điểm danh của học sinh này' });
        }

        if (req.user.role === 'teacher') {
            const student = await Student.findById(studentId).select('classroomId');
            if (!student || !await canAccessClassroom(req.user, student.classroomId)) {
                return res.status(403).json({ message: 'Bạn không có quyền xem dữ liệu điểm danh của học sinh này' });
            }
        } else if (!isParent(req.user) && !hasSchoolWideReadAccess(req.user)) {
            return res.status(403).json({ message: 'Bạn không có quyền xem dữ liệu điểm danh' });
        }

        const startWorkDate = startDate ? parseWorkDate(startDate) : null;
        const endWorkDate = endDate ? parseWorkDate(endDate) : null;
        if ((startDate && !startWorkDate) || (endDate && !endWorkDate) || (startWorkDate && endWorkDate && startWorkDate > endWorkDate)) {
            return res.status(400).json({ message: 'startDate và endDate phải là ngày hợp lệ' });
        }

        const filter = { studentId };
        if (startWorkDate || endWorkDate) {
            filter.attendDate = {};
            if (startWorkDate) filter.attendDate.$gte = getWorkDateRange(startWorkDate, DEFAULT_SCHOOL_TIMEZONE).start;
            if (endWorkDate) filter.attendDate.$lt = getWorkDateRange(endWorkDate, DEFAULT_SCHOOL_TIMEZONE).end;
        }

        const records = await StudentAttendance.find(filter)
            .sort({ attendDate: -1 })
            .limit(100); // Giới hạn 100 bản ghi gần nhất

        res.json({
            message: 'Lấy lịch sử điểm danh thành công',
            data: records
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Lấy danh sách điểm danh theo lớp (theo ngày)
const getAttendanceByClass = async (req, res) => {
    try {
        if (isParent(req.user)) {
            return res.status(403).json({ message: 'Phụ huynh không có quyền xem điểm danh theo lớp' });
        }

        const { classroomId } = req.params;
        const { date } = req.query;

        if (!isValidObjectId(classroomId)) {
            return res.status(400).json({ message: 'ID lớp học không hợp lệ' });
        }

        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, classroomId)) {
            return res.status(403).json({ message: 'Bạn không có quyền xem điểm danh lớp này' });
        }

        if (req.user.role !== 'teacher' && !hasSchoolWideReadAccess(req.user)) {
            return res.status(403).json({ message: 'Bạn không có quyền xem dữ liệu điểm danh' });
        }

        const filter = { classroomId };
        if (date) {
            const workDate = parseWorkDate(date);
            if (!workDate) {
                return res.status(400).json({ message: 'Ngày điểm danh không hợp lệ' });
            }
            const { start, end } = getWorkDateRange(workDate, DEFAULT_SCHOOL_TIMEZONE);
            filter.attendDate = { $gte: start, $lt: end };
        } else {
            const { start, end } = getTodayRange();
            filter.attendDate = { $gte: start, $lt: end };
        }

        const records = await StudentAttendance.find(filter)
            .sort({ studentName: 1 });

        res.json({
            message: 'Lấy danh sách điểm danh theo lớp thành công',
            data: records
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Cập nhật bản ghi điểm danh
const updateAttendance = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidObjectId(id)) {
            return res.status(400).json({ message: 'ID không hợp lệ' });
        }
        const record = await StudentAttendance.findById(id);
        if (!record) {
            return res.status(404).json({ message: 'Không tìm thấy bản ghi điểm danh' });
        }

        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, record.classroomId)) {
            return res.status(403).json({ message: 'Bạn không có quyền cập nhật điểm danh lớp này' });
        }

        const allowedFields = ['status', 'checkInTime', 'checkOutTime', 'pickerName', 'note'];
        const updates = Object.fromEntries(
            allowedFields
                .filter((field) => Object.hasOwn(req.body, field))
                .map((field) => [field, req.body[field]])
        );

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ message: 'Không có trường điểm danh hợp lệ để cập nhật' });
        }

        const updatedRecord = await StudentAttendance.findByIdAndUpdate(
            id,
            { $set: updates },
            { returnDocument: 'after', runValidators: true }
        );

        res.json({
            message: 'Cập nhật điểm danh thành công',
            data: updatedRecord
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Xóa bản ghi điểm danh
const deleteAttendance = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidObjectId(id)) {
            return res.status(400).json({ message: 'ID không hợp lệ' });
        }
        const record = await StudentAttendance.findByIdAndDelete(id);
        if (!record) {
            return res.status(404).json({ message: 'Không tìm thấy bản ghi điểm danh' });
        }
        res.json({ message: 'Xóa điểm danh thành công' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Phụ huynh chỉ được tạo đơn cho học sinh đã liên kết với tài khoản của mình.
const createLeaveRequest = async (req, res) => {
    try {
        const { studentId, startDate, endDate, reason } = req.body;
        if (!isParent(req.user)) {
            return res.status(403).json({ success: false, message: 'Chỉ phụ huynh có thể gửi đơn xin nghỉ trên cổng này' });
        }
        if (!isValidStudentId(studentId)) {
            return res.status(400).json({ success: false, message: 'ID học sinh không hợp lệ' });
        }
        const start = parseWorkDate(String(startDate || ''));
        const end = parseWorkDate(String(endDate || ''));
        if (!start || !end || start > end) {
            return res.status(400).json({ success: false, message: 'Khoảng ngày xin nghỉ không hợp lệ' });
        }
        if (!getWeekdayDateKeys(start, end).length) {
            return res.status(400).json({ success: false, message: 'Khoảng xin nghỉ phải có ít nhất một ngày học từ Thứ Hai đến Thứ Sáu' });
        }
        if (start < getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE)) {
            return res.status(400).json({ success: false, message: 'Chỉ có thể gửi đơn nghỉ từ ngày hôm nay trở đi' });
        }
        if (typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 1000) {
            return res.status(400).json({ success: false, message: 'Lý do xin nghỉ cần từ 5 đến 1000 ký tự' });
        }
        if (!canAccessStudent(req.user, studentId)) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền gửi đơn cho học sinh này' });
        }
        const student = await Student.findById(studentId).select('fullName classroomId className status');
        if (!student || student.status !== 'enrolled') {
            return res.status(422).json({ success: false, message: 'Chỉ học sinh đang theo học mới có thể gửi đơn xin nghỉ' });
        }
        const overlap = await StudentLeaveRequest.exists({
            studentId,
            status: { $in: ['pending', 'approved'] },
            startDate: { $lte: end },
            endDate: { $gte: start }
        });
        if (overlap) {
            return res.status(409).json({ success: false, message: 'Đã có đơn chờ duyệt hoặc được duyệt trong khoảng ngày này' });
        }
        const request = await StudentLeaveRequest.create({
            studentId: student._id,
            studentName: student.fullName,
            classroomId: student.classroomId,
            className: student.className || '',
            requesterId: req.user._id,
            requesterName: req.user.profile?.fullName || req.user.username,
            startDate: start,
            endDate: end,
            reason: reason.trim()
        });
        return res.status(201).json({ success: true, message: 'Đã gửi đơn xin nghỉ đến nhà trường', data: request });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Không thể gửi đơn xin nghỉ' });
    }
};

const getLeaveRequests = async (req, res) => {
    try {
        const status = req.query.status;
        if (status && !['pending', 'approved', 'rejected', 'cancelled'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Trạng thái đơn không hợp lệ' });
        }
        let filter;
        if (isParent(req.user)) {
            filter = { requesterId: req.user._id };
        } else if (SCHOOL_WIDE_ATTENDANCE_ROLES.has(req.user.role)) {
            filter = {};
        } else if (req.user.role === 'teacher') {
            const classroomIds = (await Classroom.find({ 'teachers.teacherId': req.user._id, status: 'active' }).select('_id')).map((item) => item._id);
            filter = { classroomId: { $in: classroomIds } };
        } else {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền xem đơn xin nghỉ' });
        }
        if (status) filter.status = status;
        const data = await StudentLeaveRequest.find(filter).sort({ createdAt: -1 }).limit(100);
        return res.json({ success: true, data });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Không thể lấy danh sách đơn xin nghỉ' });
    }
};

const reviewLeaveRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const { decision, reviewNote = '' } = req.body;
        if (!SCHOOL_WIDE_ATTENDANCE_ROLES.has(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Chỉ Principal hoặc quản trị viên được duyệt đơn nghỉ' });
        }
        if (!isValidObjectId(id) || !['approved', 'rejected'].includes(decision)) {
            return res.status(400).json({ success: false, message: 'Dữ liệu duyệt đơn không hợp lệ' });
        }
        if (typeof reviewNote !== 'string' || reviewNote.length > 500) {
            return res.status(400).json({ success: false, message: 'Ghi chú phản hồi tối đa 500 ký tự' });
        }
        const reviewed = await runStudentTransaction(async (session) => {
            const request = await StudentLeaveRequest.findById(id).session(session);
            if (!request) {
                const error = new Error('Không tìm thấy đơn xin nghỉ'); error.statusCode = 404; throw error;
            }
            if (request.status !== 'pending') {
                const error = new Error('Đơn này đã được xử lý'); error.statusCode = 409; throw error;
            }
            if (decision === 'approved') {
                const dates = getWeekdayDateKeys(request.startDate, request.endDate);
                const existing = dates.length ? await StudentAttendance.find({
                    studentId: request.studentId,
                    attendanceDateKey: { $in: dates }
                }).session(session).select('attendanceDateKey') : [];
                if (existing.length) {
                    const error = new Error(`Không thể duyệt vì đã có điểm danh vào ngày ${existing[0].attendanceDateKey}`);
                    error.statusCode = 409;
                    throw error;
                }
                if (dates.length) {
                    await StudentAttendance.insertMany(dates.map((dateKey) => ({
                        studentId: request.studentId,
                        studentName: request.studentName,
                        classroomId: request.classroomId,
                        className: request.className,
                        attendDate: getWorkDateRange(dateKey, DEFAULT_SCHOOL_TIMEZONE).start,
                        attendanceDateKey: dateKey,
                        status: 'absent_permission',
                        attendanceMethod: 'manual',
                        note: `Nghỉ có phép: ${request.reason}`,
                        recordedBy: req.user._id,
                        recordedByName: req.user.profile?.fullName || req.user.username
                    })), { session });
                }
            }
            request.status = decision;
            request.reviewedBy = req.user._id;
            request.reviewerName = req.user.profile?.fullName || req.user.username;
            request.reviewNote = reviewNote.trim();
            request.reviewedAt = new Date();
            await request.save({ session });
            return request;
        });
        await Notification.create({
            recipientId: reviewed.requesterId,
            title: decision === 'approved' ? 'Đơn xin nghỉ đã được duyệt' : 'Đơn xin nghỉ bị từ chối',
            message: decision === 'approved' ? `Đơn nghỉ của ${reviewed.studentName} đã được ghi nhận là nghỉ có phép.` : (reviewed.reviewNote || 'Nhà trường chưa thể phê duyệt đơn nghỉ này.'),
            type: 'attendance', link: '/parent-portal', createdBy: req.user._id
        });
        return res.json({ success: true, message: decision === 'approved' ? 'Đã duyệt đơn và ghi nhận nghỉ có phép' : 'Đã từ chối đơn xin nghỉ', data: reviewed });
    } catch (err) {
        const status = err.statusCode || (isDuplicateKeyError(err) ? 409 : 500);
        if (status === 500) console.error(err);
        return res.status(status).json({ success: false, message: err.message || 'Không thể xử lý đơn xin nghỉ' });
    }
};

const getAbsenceReport = async (req, res) => {
    try {
        if (isParent(req.user) || !['teacher', 'admin', 'principal'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền xem báo cáo vắng mặt' });
        }
        const endDate = req.query.endDate ? parseWorkDate(String(req.query.endDate)) : getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
        const startDate = req.query.startDate ? parseWorkDate(String(req.query.startDate)) : addWorkDays(endDate, -29);
        if (!startDate || !endDate || startDate > endDate) {
            return res.status(400).json({ success: false, message: 'Khoảng thời gian báo cáo không hợp lệ' });
        }
        const filter = {
            attendDate: { $gte: getWorkDateRange(startDate, DEFAULT_SCHOOL_TIMEZONE).start, $lt: getWorkDateRange(endDate, DEFAULT_SCHOOL_TIMEZONE).end },
            status: { $in: ['absent', 'absent_permission', 'late'] }
        };
        if (req.query.classroomId) {
            if (!isValidObjectId(req.query.classroomId)) return res.status(400).json({ success: false, message: 'ID lớp học không hợp lệ' });
            if (!await canReadLeaveRequests(req.user, req.query.classroomId)) return res.status(403).json({ success: false, message: 'Bạn không có quyền xem lớp này' });
            filter.classroomId = req.query.classroomId;
        } else if (req.user.role === 'teacher') {
            filter.classroomId = { $in: (await Classroom.find({ 'teachers.teacherId': req.user._id, status: 'active' }).select('_id')).map((item) => item._id) };
        }
        const records = await StudentAttendance.find(filter).sort({ attendDate: -1, studentName: 1 }).lean();
        const summary = new Map();
        records.forEach((item) => {
            const key = item.studentId.toString();
            if (!summary.has(key)) summary.set(key, { studentId: item.studentId, studentName: item.studentName, className: item.className, absent: 0, permitted: 0, late: 0, total: 0 });
            const row = summary.get(key); row.total += 1;
            if (item.status === 'absent') row.absent += 1;
            if (item.status === 'absent_permission') row.permitted += 1;
            if (item.status === 'late') row.late += 1;
        });
        return res.json({ success: true, data: { startDate, endDate, totals: { absent: records.filter((r) => r.status === 'absent').length, permitted: records.filter((r) => r.status === 'absent_permission').length, late: records.filter((r) => r.status === 'late').length }, students: [...summary.values()].sort((a, b) => b.total - a.total || a.studentName.localeCompare(b.studentName, 'vi')), records } });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Không thể lập báo cáo vắng mặt' });
    }
};

module.exports = {
    createAttendance,
    automaticCheckIn,
    createBulkAttendance,
    getAttendanceByStudent,
    getAttendanceByClass,
    updateAttendance,
    deleteAttendance,
    createLeaveRequest,
    getLeaveRequests,
    reviewLeaveRequest,
    getAbsenceReport
};
