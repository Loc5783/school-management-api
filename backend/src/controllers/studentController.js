const Student = require('../models/zone3_school/Student');
const Classroom = require('../models/zone3_school/Classroom');

// Tạo học sinh mới
const createStudent = async (req, res) => {
    try {
        // Kiểm tra lớp học tồn tại
        const classroom = await Classroom.findById(req.body.classroomId);
        if (!classroom) {
            return res.status(404).json({ message: 'Không tìm thấy lớp học' });
        }

        // Tự động gán className
        req.body.className = classroom.name;

        const student = new Student(req.body);
        await student.save();

        // Cập nhật số lượng học sinh trong lớp
        await Classroom.findByIdAndUpdate(
            req.body.classroomId,
            { $inc: { 'statistics.currentStudents': 1 } }
        );

        res.status(201).json({
            message: 'Thêm học sinh thành công',
            data: student
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Lấy danh sách học sinh (theo lớp hoặc tất cả)
const getAllStudents = async (req, res) => {
    try {
        const { classroomId } = req.query;
        const filter = { status: 'enrolled' };
        if (classroomId) {
            filter.classroomId = classroomId;
        }

        const students = await Student.find(filter)
            .sort({ fullName: 1 });

        res.json({
            message: 'Lấy danh sách học sinh thành công',
            data: students
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Lấy chi tiết học sinh
const getStudentById = async (req, res) => {
    try {
        const student = await Student.findById(req.params.id);
        if (!student) {
            return res.status(404).json({ message: 'Không tìm thấy học sinh' });
        }
        res.json({
            message: 'Lấy chi tiết học sinh thành công',
            data: student
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Cập nhật thông tin học sinh
const updateStudent = async (req, res) => {
    try {
        const student = await Student.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );
        if (!student) {
            return res.status(404).json({ message: 'Không tìm thấy học sinh' });
        }
        res.json({
            message: 'Cập nhật học sinh thành công',
            data: student
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Xóa học sinh (chuyển sang withdrawn)
const deleteStudent = async (req, res) => {
    try {
        const student = await Student.findByIdAndUpdate(
            req.params.id,
            { status: 'withdrawn' },
            { new: true }
        );
        if (!student) {
            return res.status(404).json({ message: 'Không tìm thấy học sinh' });
        }

        // Giảm số lượng học sinh trong lớp
        await Classroom.findByIdAndUpdate(
            student.classroomId,
            { $inc: { 'statistics.currentStudents': -1 } }
        );

        res.json({
            message: 'Xóa học sinh thành công',
            data: student
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

module.exports = {
    createStudent,
    getAllStudents,
    getStudentById,
    updateStudent,
    deleteStudent
};