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
const {
    pingWebhook,
    handleWebhook,
    getWebhookLogs,
    getWebhookLogById
} = require('../controllers/timekeepingWebhookController');
const auth = require('../middlewares/auth');
const roleCheck = require('../middlewares/roleCheck');
const webhookTestAuth = require('../middlewares/webhookTestAuth');

const router = express.Router();

// Sử dụng express.raw cục bộ riêng cho route /webhook (giống JussStudio/BE) để lấy trọn Buffer gốc lên tới 50MB
const rawWebhookBody = express.raw({ type: '*/*', limit: '50mb' });

// NOTE: Đặt các route Webhook máy chấm công Hikvision TRƯỚC `router.use(auth)` vì thiết bị phần cứng
// bắn HTTP trực tiếp không mang JWT đăng nhập của giáo viên/nhân sự.
router.get('/webhook', webhookTestAuth, pingWebhook);
router.get('/webhook/logs', webhookTestAuth, getWebhookLogs);
router.get('/webhook/logs/:id', webhookTestAuth, getWebhookLogById);
router.post('/webhook', webhookTestAuth, rawWebhookBody, handleWebhook);
router.post('/webhook/:schoolCode', webhookTestAuth, rawWebhookBody, handleWebhook);

// Tất cả các route nghiệp vụ bên dưới đều yêu cầu xác thực người dùng
router.use(auth);

// Điểm danh
router.post('/', roleCheck(['teacher', 'admin']), createAttendance);
router.post('/bulk', roleCheck(['teacher', 'admin']), createBulkAttendance);
router.post('/check-in', roleCheck(['teacher', 'admin']), automaticCheckIn);

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
