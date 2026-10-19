const express = require('express');
const {
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
} = require('../controllers/attendanceController');
const auth = require('../middlewares/auth');
const roleCheck = require('../middlewares/roleCheck');

const router = express.Router();

// Tất cả đều yêu cầu xác thực
router.use(auth);

// Điểm danh
router.post('/', roleCheck(['teacher', 'admin']), createAttendance);
router.post('/bulk', roleCheck(['teacher', 'admin']), createBulkAttendance);
router.post('/check-in', roleCheck(['teacher', 'admin', 'guard']), automaticCheckIn);

// Đơn xin nghỉ và báo cáo vắng mặt. Các kiểm tra liên kết phụ huynh/lớp giáo
// viên tiếp tục nằm ở controller để không tin tưởng riêng vào giao diện.
router.post('/leave-requests', roleCheck(['parent']), createLeaveRequest);
router.get('/leave-requests', getLeaveRequests);
router.patch('/leave-requests/:id/review', roleCheck(['admin', 'principal']), reviewLeaveRequest);
router.get('/reports/absence', roleCheck(['teacher', 'admin', 'principal']), getAbsenceReport);

// Xem danh sách
router.get('/student/:studentId', getAttendanceByStudent);
router.get('/class/:classroomId', getAttendanceByClass);

// Giáo viên chỉ được cập nhật bản ghi thuộc lớp được phân công (controller kiểm tra scope).
// Xóa chỉ dành cho admin để tránh mất lịch sử điểm danh.
router.put('/:id', roleCheck(['admin', 'teacher']), updateAttendance);
router.delete('/:id', roleCheck(['admin']), deleteAttendance);

module.exports = router;
