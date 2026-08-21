const Classroom = require('../models/zone3_school/Classroom');

// Tạo lớp học mới
const createClassroom = async (req, res) => {
    try {
        const classroom = new Classroom(req.body);
        await classroom.save();
        res.status(201).json({
            message: 'Tạo lớp học thành công',
            data: classroom
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Lấy danh sách tất cả lớp học
const getAllClassrooms = async (req, res) => {
    try {
        const classrooms = await Classroom.find({ status: 'active' })
            .sort({ name: 1 });
        res.json({
            message: 'Lấy danh sách lớp học thành công',
            data: classrooms
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Lấy chi tiết một lớp học
const getClassroomById = async (req, res) => {
    try {
        const classroom = await Classroom.findById(req.params.id);
        if (!classroom) {
            return res.status(404).json({ message: 'Không tìm thấy lớp học' });
        }
        res.json({
            message: 'Lấy chi tiết lớp học thành công',
            data: classroom
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Cập nhật thông tin lớp học
const updateClassroom = async (req, res) => {
    try {
        const classroom = await Classroom.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );
        if (!classroom) {
            return res.status(404).json({ message: 'Không tìm thấy lớp học' });
        }
        res.json({
            message: 'Cập nhật lớp học thành công',
            data: classroom
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Xóa lớp học (chuyển sang archived)
const deleteClassroom = async (req, res) => {
    try {
        const classroom = await Classroom.findByIdAndUpdate(
            req.params.id,
            { status: 'archived' },
            { new: true }
        );
        if (!classroom) {
            return res.status(404).json({ message: 'Không tìm thấy lớp học' });
        }
        res.json({
            message: 'Xóa lớp học thành công',
            data: classroom
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

module.exports = {
    createClassroom,
    getAllClassrooms,
    getClassroomById,
    updateClassroom,
    deleteClassroom
};