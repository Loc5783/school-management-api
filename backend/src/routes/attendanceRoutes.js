const express = require('express');
const {
    createAttendance,
    automaticCheckIn,
    createBulkAttendance,
    getAttendanceByStudent,
    getAttendanceByClass,
    updateAttendance,
    deleteAttendance
} = require('../controllers/attendanceController');
const auth = require('../middlewares/auth');
const roleCheck = require('../middlewares/roleCheck');

const router = express.Router();

// Tất cả đều yêu cầu xác thực
router.use(auth);

// Điểm danh
router.post('/', roleCheck(['teacher', 'admin', 'principal']), createAttendance);
router.post('/bulk', roleCheck(['teacher', 'admin', 'principal']), createBulkAttendance);
router.post('/check-in', roleCheck(['teacher', 'admin', 'principal', 'guard']), automaticCheckIn);

// Xem danh sách
router.get('/student/:studentId', getAttendanceByStudent);
router.get('/class/:classroomId', getAttendanceByClass);

// Giáo viên chỉ được cập nhật bản ghi thuộc lớp được phân công (controller kiểm tra scope).
// Xóa vẫn chỉ dành cho admin/principal để tránh mất lịch sử điểm danh.
router.put('/:id', roleCheck(['admin', 'principal', 'teacher']), updateAttendance);
router.delete('/:id', roleCheck(['admin', 'principal']), deleteAttendance);

module.exports = router;
