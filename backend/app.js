const express = require('express');
const cors = require('cors');
const { attachFrontendStatic, isSameHostOrigin } = require('./src/utils/staticFrontendMiddleware');
const { attachSwaggerDocs } = require('./src/docs/swaggerSetup');
const {
    applySecurityMiddleware,
    requestPayloadSanitizer,
    globalErrorHandler
} = require('./src/middlewares/securityAndErrorMiddleware');
const { apiGeneralLimiter } = require('./src/saas/middlewares/rateLimiter');

const authRoutes = require('./src/routes/authRoutes');
const classroomRoutes = require('./src/routes/classroomRoutes');
const studentRoutes = require('./src/routes/studentRoutes');
const attendanceRoutes = require('./src/routes/attendanceRoutes');
const financeRoutes = require('./src/routes/financeRoutes');
const reportRoutes = require('./src/routes/reportRoutes');
const procurementRoutes = require('./src/routes/procurementRoutes');
const timekeepingRoutes = require('./src/routes/timekeepingRoutes');
const systemUserRoutes = require('./src/routes/systemUserRoutes');
const nutritionRoutes = require('./src/routes/nutritionRoutes');
const hrRoutes = require('./src/routes/hrRoutes');
const notificationRoutes = require('./src/routes/notificationRoutes');
const chatRoutes = require('./src/routes/chatRoutes');
const classroomCommunicationRoutes = require('./src/routes/classroomCommunicationRoutes');
const pickupRoutes = require('./src/routes/pickupRoutes');
const studentProfileChangeRequestRoutes = require('./src/routes/studentProfileChangeRequestRoutes');
const parentFeedbackRoutes = require('./src/routes/parentFeedbackRoutes');
const parentTeacherEvaluationRoutes = require('./src/routes/parentTeacherEvaluationRoutes');
const guardRoutes = require('./src/routes/guardRoutes');
const guardDeviceIngestRoutes = require('./src/routes/guardDeviceIngestRoutes');
const timekeepingWebhookRoutes = require('./src/routes/timekeepingWebhookRoutes');

// Biểu thức chính quy cho phép truy cập từ localhost và toàn bộ dải IP mạng LAN nội bộ (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
const LAN_OR_LOCAL_ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

const createApp = () => {
    const app = express();

    applySecurityMiddleware(app);

    // Tin cậy Reverse Proxy (Nginx trong Docker) khi biến TRUST_PROXY được cấu hình để express-rate-limit lấy đúng IP thật của người dùng
    if (process.env.TRUST_PROXY) {
        const rawTrustProxy = process.env.TRUST_PROXY.trim();
        const parsedTrustProxy = rawTrustProxy === 'true'
            ? 1
            : (/^\d+$/.test(rawTrustProxy) ? Number(rawTrustProxy) : rawTrustProxy);
        app.set('trust proxy', parsedTrustProxy);
    }

    const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

    app.use(cors((req, callback) => {
        const origin = req.header('Origin');
        const isAllowed = !origin
            || allowedOrigins.includes(origin)
            || allowedOrigins.includes('*')
            || LAN_OR_LOCAL_ORIGIN_REGEX.test(origin)
            || isSameHostOrigin(origin, req);

        if (isAllowed) {
            return callback(null, {
                origin: true,
                methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
                allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Device-Api-Key', 'X-Webhook-Token', 'X-School-Code']
            });
        }
        return callback(new Error('Origin không được phép truy cập API'));
    }));

    // Tăng giới hạn JSON/urlencoded lên 15MB (giống JussStudio/BE); multipart/form-data từ máy chấm công sẽ đi thẳng vào express.raw() của route /webhook
    app.use(express.json({ limit: '15mb' }));
    app.use(express.urlencoded({ extended: true, limit: '15mb' }));
    app.use(requestPayloadSanitizer);
    app.use('/api', apiGeneralLimiter);

    app.use('/api/webhooks/timekeeping', timekeepingWebhookRoutes);
    app.use('/api/auth', authRoutes);
    app.use('/api/classrooms', classroomRoutes);
    app.use('/api/students', studentRoutes);
    app.use('/api/attendance', attendanceRoutes);
    app.use('/api/finance', financeRoutes);
    app.use('/api/reports', reportRoutes);
    app.use('/api/procurement', procurementRoutes);
    app.use('/api/timekeeping', timekeepingRoutes);
    app.use('/api/system', systemUserRoutes);
    app.use('/api/nutrition', nutritionRoutes);
    app.use('/api/hr', hrRoutes);
    app.use('/api/notifications', notificationRoutes);
    app.use('/api/chat', chatRoutes);
    app.use('/api/class-communication', classroomCommunicationRoutes);
    app.use('/api/pickups', pickupRoutes);
    app.use('/api/student-profile-change-requests', studentProfileChangeRequestRoutes);
    app.use('/api/parent-feedback', parentFeedbackRoutes);
    app.use('/api/parent-teacher-evaluations', parentTeacherEvaluationRoutes);
    app.use('/api/guard', guardRoutes);
    app.use('/api/guard-device', guardDeviceIngestRoutes);

    app.get('/api/health', (req, res) => {
        res.status(200).json({ status: 'OK', message: 'Server đang chạy!' });
    });

    // Tài liệu kỹ thuật tương tác Swagger UI (/api-docs, /api/docs) & Từ điển Database (/api/docs/database)
    attachSwaggerDocs(app);

    // Đảm bảo đường dẫn /api/* không tồn tại luôn trả JSON 404 thay vì rơi vào SPA Fallback
    app.use('/api', (req, res) => {
        res.status(404).json({ success: false, message: 'Không tìm thấy đường dẫn API' });
    });

    // Phục vụ trực tiếp giao diện Frontend Production (nếu đã có bản build dist) trên cùng máy chủ Backend
    attachFrontendStatic(app);

    // Middleware xử lý lỗi tập trung toàn hệ thống
    app.use(globalErrorHandler);

    return app;
};

module.exports = createApp;
