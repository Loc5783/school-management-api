const StudentAttendance = require('../models/zone3_school/StudentAttendance');
const Student = require('../models/zone3_school/Student');
const Classroom = require('../models/zone3_school/Classroom');

const getTodayRange = () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
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

        // Lấy classroom
        const classroom = await Classroom.findById(student.classroomId);
        if (!classroom) {
            return res.status(404).json({ message: 'Không tìm thấy lớp học' });
        }

        // Tạo bản ghi điểm danh
        const attendance = new StudentAttendance({
            studentId,
            studentName: student.fullName,
            classroomId: student.classroomId,
            className: classroom.name,
            attendDate: new Date().setHours(0, 0, 0, 0),
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

        // Kiểm tra lớp
        const classroom = await Classroom.findById(classroomId);
        if (!classroom) {
            return res.status(404).json({ message: 'Không tìm thấy lớp học' });
        }

        const attendanceRecords = [];
        for (const rec of records) {
            const student = await Student.findById(rec.studentId);
            if (!student) continue;

            attendanceRecords.push({
                studentId: rec.studentId,
                studentName: student.fullName,
                classroomId,
                className: classroom.name,
                attendDate: attendDate || new Date().setHours(0, 0, 0, 0),
                status: rec.status || 'present',
                checkInTime: rec.checkInTime,
                note: rec.note,
                recordedBy: req.user._id,
                recordedByName: req.user.profile.fullName
            });
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

        const filter = { studentId };
        if (startDate || endDate) {
            filter.attendDate = {};
            if (startDate) filter.attendDate.$gte = new Date(startDate);
            if (endDate) filter.attendDate.$lte = new Date(endDate);
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
        const { classroomId } = req.params;
        const { date } = req.query;

        const filter = { classroomId };
        if (date) {
            const start = new Date(date);
            start.setHours(0, 0, 0, 0);
            const end = new Date(date);
            end.setHours(23, 59, 59, 999);
            filter.attendDate = { $gte: start, $lte: end };
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
        const updates = req.body;

        const record = await StudentAttendance.findByIdAndUpdate(
            id,
            updates,
            { new: true, runValidators: true }
        );

        if (!record) {
            return res.status(404).json({ message: 'Không tìm thấy bản ghi điểm danh' });
        }

        res.json({
            message: 'Cập nhật điểm danh thành công',
            data: record
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
