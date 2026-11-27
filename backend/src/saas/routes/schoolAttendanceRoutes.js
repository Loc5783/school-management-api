const express = require('express');
const router = express.Router();
const schoolAuthMiddleware = require('../middlewares/schoolAuthMiddleware');
const roleCheck = require('../../middlewares/roleCheck');
const webhookTestAuth = require('../../middlewares/webhookTestAuth');
const { deviceIngestLimiter } = require('../middlewares/rateLimiter');
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
} = require('../../controllers/attendanceController');
const {
  pingWebhook,
  handleWebhook,
  getWebhookLogs,
  getWebhookLogById
} = require('../../controllers/timekeepingWebhookController');
const { isReservedAttendanceSegment } = require('../utils/reservedRoutes');
const { getRequestSaasMode, isAttendanceAllowed } = require('../utils/saasMode');

// Defense-in-depth: Attendance module is strictly allowed in phase1c+ only
router.use((req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isAttendanceAllowed(saasMode)) {
    return next('router');
  }
  next();
});

// Route nhận Webhook từ máy chấm công Hikvision (cấu trúc đồng bộ với JussStudio/BE: /api/attendance/webhook)
// Giới hạn gói raw tối đa 10MB kèm rate-limiter để chống tấn công tràn bộ nhớ; API đọc logs bắt buộc JWT của trường
const rawWebhookBody = express.raw({ type: '*/*', limit: '10mb' });

router.get('/webhook', deviceIngestLimiter, webhookTestAuth, pingWebhook);
router.get('/webhook/logs', schoolAuthMiddleware, roleCheck(['admin', 'principal', 'hr']), getWebhookLogs);
router.get('/webhook/logs/:id', schoolAuthMiddleware, roleCheck(['admin', 'principal', 'hr']), getWebhookLogById);
router.get('/webhook/:schoolCode', deviceIngestLimiter, webhookTestAuth, pingWebhook);
router.post('/webhook', deviceIngestLimiter, webhookTestAuth, rawWebhookBody, handleWebhook);
router.post('/webhook/:schoolCode', deviceIngestLimiter, webhookTestAuth, rawWebhookBody, handleWebhook);

// Guard against route parameter shadowing on :id, :studentId, and :classroomId:
// If parameter matches a reserved sub-path / action (e.g. 'bulk', 'check-in', 'export', 'template', 'webhook'),
// skip this router with next('router') so it cleanly falls through to downstream tenantFeatureGate (501).
// Genuine detail attempts with malformed IDs (e.g. 'invalid-id') continue to controller (400).
router.param('id', (req, res, next, id) => {
  if (isReservedAttendanceSegment(id)) {
    return next('router');
  }
  next();
});

router.param('studentId', (req, res, next, id) => {
  if (isReservedAttendanceSegment(id)) {
    return next('router');
  }
  next();
});

router.param('classroomId', (req, res, next, id) => {
  if (isReservedAttendanceSegment(id)) {
    return next('router');
  }
  next();
});

// Explicitly audited 1C attendance endpoints:
// 1. POST / (create single attendance) -> teacher, admin
router.post('/', schoolAuthMiddleware, roleCheck(['teacher', 'admin']), createAttendance);

// 2. POST /bulk (bulk classroom attendance) -> teacher, admin
router.post('/bulk', schoolAuthMiddleware, roleCheck(['teacher', 'admin']), createBulkAttendance);

// 3. POST /check-in (automatic check-in via card/face within tenant) -> teacher, admin
router.post('/check-in', schoolAuthMiddleware, roleCheck(['teacher', 'admin']), automaticCheckIn);

// 4. POST /leave-requests (parent leave request) -> parent
router.post('/leave-requests', schoolAuthMiddleware, roleCheck(['parent']), createLeaveRequest);

// 5. GET /leave-requests (list leave requests) -> parent, teacher, admin, principal
router.get('/leave-requests', schoolAuthMiddleware, roleCheck(['parent', 'teacher', 'admin', 'principal']), getLeaveRequests);

// 6. PATCH /leave-requests/:id/review (review leave request) -> admin, principal
router.patch('/leave-requests/:id/review', schoolAuthMiddleware, roleCheck(['admin', 'principal']), reviewLeaveRequest);

// 7. GET /reports/absence (absence report) -> teacher, admin, principal
router.get('/reports/absence', schoolAuthMiddleware, roleCheck(['teacher', 'admin', 'principal']), getAbsenceReport);

// 8. GET /student/:studentId (student attendance history) -> parent, teacher, admin, principal
router.get('/student/:studentId', schoolAuthMiddleware, roleCheck(['parent', 'teacher', 'admin', 'principal']), getAttendanceByStudent);

// 9. GET /class/:classroomId (class attendance for day) -> teacher, admin, principal
router.get('/class/:classroomId', schoolAuthMiddleware, roleCheck(['teacher', 'admin', 'principal']), getAttendanceByClass);

// 10. PUT /:id (update attendance record) -> admin, teacher
router.put('/:id', schoolAuthMiddleware, roleCheck(['admin', 'teacher']), updateAttendance);

// 11. DELETE /:id (delete attendance record) -> admin
router.delete('/:id', schoolAuthMiddleware, roleCheck(['admin']), deleteAttendance);

module.exports = router;
