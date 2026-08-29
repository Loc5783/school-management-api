const StudentAttendance = require('../models/zone3_school/StudentAttendance');
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

const getTodayRange = () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
};

const parseQueryDate = (value) => {
    if (typeof value !== 'string' || !value.trim()) return null;

    const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
        const [, year, month, day] = dateOnlyMatch.map(Number);
        const parsed = new Date(Date.UTC(year, month - 1, day));
        if (
            parsed.getUTCFullYear() !== year ||
            parsed.getUTCMonth() !== month - 1 ||
            parsed.getUTCDate() !== day
        ) {
            return null;
        }
        return parsed;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getStartOfDay = (value) => {
    const date = value ? parseQueryDate(String(value)) : new Date();
    if (!date) return null;

    date.setHours(0, 0, 0, 0);
    return date;
};

const getEndOfDay = (start) => {
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return end;
};

const toAttendanceDateKey = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

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

        const { start, end } = getTodayRange();
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
            attendanceDateKey: toAttendanceDateKey(start),
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
        console.error(err);
        return res.status(500).json({ message: 'Không thể xử lý điểm danh tự động' });
    }
};

// Điểm danh một học sinh
const createAttendance = async (req, res) => {
    try {
        const { studentId, status, checkInTime, checkOutTime, pickerName, note } = req.body;

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

        const { start, end } = getTodayRange();
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
            attendanceDateKey: toAttendanceDateKey(start),
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

        const workDate = getStartOfDay(attendDate);
        if (!workDate) {
            return res.status(400).json({ message: 'Ngày điểm danh không hợp lệ' });
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

        const existingRecords = await StudentAttendance.find({
            studentId: { $in: uniqueStudentIds },
            attendDate: { $gte: workDate, $lt: getEndOfDay(workDate) }
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
                    attendDate: workDate,
                    attendanceDateKey: toAttendanceDateKey(workDate),
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

        const start = startDate ? parseQueryDate(startDate) : null;
        const end = endDate ? parseQueryDate(endDate) : null;
        if ((startDate && !start) || (endDate && !end) || (start && end && start > end)) {
            return res.status(400).json({ message: 'startDate và endDate phải là ngày hợp lệ' });
        }

        const filter = { studentId };
        if (start || end) {
            filter.attendDate = {};
            if (start) filter.attendDate.$gte = start;
            if (end) filter.attendDate.$lte = end;
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

        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, classroomId)) {
            return res.status(403).json({ message: 'Bạn không có quyền xem điểm danh lớp này' });
        }

        if (req.user.role !== 'teacher' && !hasSchoolWideReadAccess(req.user)) {
            return res.status(403).json({ message: 'Bạn không có quyền xem dữ liệu điểm danh' });
        }

        const filter = { classroomId };
        if (date) {
            const start = getStartOfDay(date);
            if (!start) {
                return res.status(400).json({ message: 'Ngày điểm danh không hợp lệ' });
            }
            filter.attendDate = { $gte: start, $lt: getEndOfDay(start) };
        } else {
            // Mặc định lấy hôm nay
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            filter.attendDate = { $gte: today, $lt: tomorrow };
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

module.exports = {
    createAttendance,
    automaticCheckIn,
    createBulkAttendance,
    getAttendanceByStudent,
    getAttendanceByClass,
    updateAttendance,
    deleteAttendance
};
