const Student = require('../models/zone3_school/Student');
const Classroom = require('../models/zone3_school/Classroom');
const {
    applyStudentListScope,
    canAccessStudent,
    isParent,
    isValidStudentId
} = require('../services/studentAccessService');
const {
    canAccessClassroom,
    getTeacherClassroomIds,
    hasSchoolWideReadAccess
} = require('../services/schoolDataAccessService');

const STUDENT_MUTABLE_FIELDS = [
    'fullName',
    'birthDate',
    'gender',
    'address',
    'classroomId',
    'schoolYear',
    'parents',
    'authorizedPickers',
    'allergies',
    'disease',
    'emergencyContact'
];

const pickStudentFields = (payload = {}) => Object.fromEntries(
    STUDENT_MUTABLE_FIELDS
        .filter((field) => Object.hasOwn(payload, field))
        .map((field) => [field, payload[field]])
);

// Tạo học sinh mới
const createStudent = async (req, res) => {
    try {
        const studentPayload = pickStudentFields(req.body);
        if (!isValidStudentId(studentPayload.classroomId)) {
            return res.status(400).json({ message: 'ID lớp học không hợp lệ' });
        }

        const classroom = await Classroom.findOne({ _id: studentPayload.classroomId, status: 'active' });
        if (!classroom) {
            return res.status(404).json({ message: 'Không tìm thấy lớp học' });
        }

        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, classroom._id)) {
            return res.status(403).json({ message: 'Bạn không có quyền thêm học sinh vào lớp này' });
        }

        studentPayload.className = classroom.name;

        const student = new Student(studentPayload);
        await student.save();

        // Cập nhật số lượng học sinh trong lớp
        await Classroom.findByIdAndUpdate(
            classroom._id,
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
        let filter = { status: 'enrolled' };
        if (classroomId) {
            filter.classroomId = classroomId;
        }

        if (isParent(req.user)) {
            // Scope is applied after client filters so a parent can narrow results,
            // but can never remove the linked-student condition.
            filter = applyStudentListScope(req.user, filter);
        } else if (req.user.role === 'teacher') {
            const classroomIds = await getTeacherClassroomIds(req.user);
            if (classroomId) {
                filter.classroomId = classroomIds.includes(classroomId.toString())
                    ? classroomId
                    : { $in: [] };
            } else {
                filter.classroomId = { $in: classroomIds };
            }
        } else if (!hasSchoolWideReadAccess(req.user)) {
            return res.status(403).json({ message: 'Bạn không có quyền xem dữ liệu học sinh' });
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
        if (!isValidStudentId(req.params.id)) {
            return res.status(400).json({ message: 'ID học sinh không hợp lệ' });
        }

        const student = await Student.findById(req.params.id);
        if (!student) {
            return res.status(404).json({ message: 'Không tìm thấy học sinh' });
        }

        if (isParent(req.user) && !canAccessStudent(req.user, student._id)) {
            return res.status(403).json({ message: 'Bạn không có quyền xem thông tin học sinh này' });
        }

        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, student.classroomId)) {
            return res.status(403).json({ message: 'Bạn không có quyền xem thông tin học sinh này' });
        }

        if (!isParent(req.user) && req.user.role !== 'teacher' && !hasSchoolWideReadAccess(req.user)) {
            return res.status(403).json({ message: 'Bạn không có quyền xem dữ liệu học sinh' });
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
        if (!isValidStudentId(req.params.id)) {
            return res.status(400).json({ message: 'ID học sinh không hợp lệ' });
        }

        const currentStudent = await Student.findById(req.params.id);
        if (!currentStudent) {
            return res.status(404).json({ message: 'Không tìm thấy học sinh' });
        }

        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, currentStudent.classroomId)) {
            return res.status(403).json({ message: 'Bạn không có quyền cập nhật học sinh này' });
        }

        const updates = pickStudentFields(req.body);
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ message: 'Không có trường học sinh hợp lệ để cập nhật' });
        }

        let targetClassroom = null;
        if (Object.hasOwn(updates, 'classroomId')) {
            if (!isValidStudentId(updates.classroomId)) {
                return res.status(400).json({ message: 'ID lớp học không hợp lệ' });
            }

            targetClassroom = await Classroom.findOne({ _id: updates.classroomId, status: 'active' });
            if (!targetClassroom) {
                return res.status(404).json({ message: 'Không tìm thấy lớp học' });
            }

            if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, targetClassroom._id)) {
                return res.status(403).json({ message: 'Bạn không có quyền chuyển học sinh sang lớp này' });
            }

            updates.className = targetClassroom.name;
        }

        const student = await Student.findByIdAndUpdate(
            currentStudent._id,
            { $set: updates },
            { returnDocument: 'after', runValidators: true }
        );

        if (targetClassroom && currentStudent.classroomId.toString() !== targetClassroom._id.toString()) {
            await Classroom.bulkWrite([
                { updateOne: { filter: { _id: currentStudent.classroomId }, update: { $inc: { 'statistics.currentStudents': -1 } } } },
                { updateOne: { filter: { _id: targetClassroom._id }, update: { $inc: { 'statistics.currentStudents': 1 } } } }
            ]);
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
        if (!isValidStudentId(req.params.id)) {
            return res.status(400).json({ message: 'ID học sinh không hợp lệ' });
        }

        const student = await Student.findByIdAndUpdate(
            req.params.id,
            { status: 'withdrawn' },
            { returnDocument: 'after' }
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
