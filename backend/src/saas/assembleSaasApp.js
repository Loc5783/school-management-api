'use strict';

const express = require('express');
const cors = require('cors');
const { attachFrontendStatic, isSameHostOrigin } = require('../utils/staticFrontendMiddleware');
const { attachSwaggerDocs } = require('../docs/swaggerSetup');
const {
  applySecurityMiddleware,
  requestPayloadSanitizer,
  globalErrorHandler
} = require('../middlewares/securityAndErrorMiddleware');
const responseCompressionMiddleware = require('../middlewares/responseCompressionMiddleware');
const { apiGeneralLimiter } = require('./middlewares/rateLimiter');
const { tenantFeatureGate } = require('./middlewares/tenantFeatureGate');
const schoolAuthRoutes = require('./routes/schoolAuthRoutes');
const platformAuthRoutes = require('./routes/platformAuthRoutes');
const platformTenantRoutes = require('./routes/platformTenantRoutes');
const multiSchoolAdminRoutes = require('./routes/multiSchoolAdminRoutes');
const schoolClassroomRoutes = require('./routes/schoolClassroomRoutes');
const schoolStudentRoutes = require('./routes/schoolStudentRoutes');
const schoolAttendanceRoutes = require('./routes/schoolAttendanceRoutes');
const schoolSystemUserRoutes = require('./routes/schoolSystemUserRoutes');
const schoolHrRoutes = require('./routes/schoolHrRoutes');
const schoolTimekeepingRoutes = require('./routes/schoolTimekeepingRoutes');
const schoolFinanceRoutes = require('./routes/schoolFinanceRoutes');
const schoolReportRoutes = require('./routes/schoolReportRoutes');
const schoolPrincipalReportRoutes = require('./routes/schoolPrincipalReportRoutes');
const schoolNutritionRoutes = require('./routes/schoolNutritionRoutes');
const schoolNotificationRoutes = require('./routes/schoolNotificationRoutes');
const schoolChatRoutes = require('./routes/schoolChatRoutes');
const schoolClassroomCommunicationRoutes = require('./routes/schoolClassroomCommunicationRoutes');
const schoolPickupRoutes = require('./routes/schoolPickupRoutes');
const schoolGuardRoutes = require('./routes/schoolGuardRoutes');
const schoolProcurementRoutes = require('./routes/schoolProcurementRoutes');
const schoolParentFeedbackRoutes = require('./routes/schoolParentFeedbackRoutes');
const schoolStudentProfileChangeRequestRoutes = require('./routes/schoolStudentProfileChangeRequestRoutes');
const timekeepingWebhookRoutes = require('../routes/timekeepingWebhookRoutes');

const {
  resolveSaasMode,
  isReadModuleAllowed,
  isAttendanceAllowed,
  isHrAllowed,
  isFinanceAllowed,
  isNutritionAllowed,
  isNotificationAllowed,
  isChatAllowed,
  isPickupAllowed,
  isProcurementAllowed,
  isFeedbackAllowed
} = require('./utils/saasMode');

const assembleSaasApp = (options = {}) => {
  const app = express();

  applySecurityMiddleware(app);
  app.use(responseCompressionMiddleware);

  // Tin cậy Reverse Proxy (Nginx trong Docker) khi biến TRUST_PROXY được cấu hình để express-rate-limit v8 không báo lỗi X-Forwarded-For
  if (process.env.TRUST_PROXY) {
    const rawTrustProxy = process.env.TRUST_PROXY.trim();
    const parsedTrustProxy = rawTrustProxy === 'true'
      ? 1
      : (/^\d+$/.test(rawTrustProxy) ? Number(rawTrustProxy) : rawTrustProxy);
    app.set('trust proxy', parsedTrustProxy);
  }

  const allowedOrigins = [
    ...(process.env.CORS_ORIGINS || 'http://localhost:5173').split(','),
    process.env.PUBLIC_APP_URL || '',
    process.env.PUBLIC_BASE_URL || ''
  ]
    .map((origin) => origin.trim())
    .filter(Boolean);

  const LAN_OR_LOCAL_ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

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
        allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Tenant-Id', 'X-Device-Api-Key', 'X-Webhook-Token', 'X-School-Code']
      });
    }
    return callback(new Error('Origin không được phép truy cập API'));
  }));

  // Tăng giới hạn JSON/urlencoded lên 15MB (đồng bộ JussStudio/BE); gói multipart/form-data từ máy chấm công sẽ do express.raw() tại route /webhook nhận trực tiếp
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));
  app.use(requestPayloadSanitizer);
  app.use('/api', apiGeneralLimiter);

  app.use('/api/v1/webhooks/timekeeping', timekeepingWebhookRoutes);
  app.use('/api/webhooks/timekeeping', timekeepingWebhookRoutes);

  // Public Health Checks
  const healthHandler = (req, res) => {
    res.status(200).json({ status: 'OK', mode: 'saas_phase1a', message: 'SaaS Control Plane 1A Active' });
  };
  app.get('/api/health', healthHandler);
  app.get('/api/v1/health', healthHandler);

  // Tài liệu kỹ thuật tương tác Swagger UI (/api-docs, /api/docs) & Từ điển Database (/api/docs/database)
  attachSwaggerDocs(app);

  // SaaS School Auth (both /api/v1/auth and /api/auth)
  app.use('/api/v1/auth', schoolAuthRoutes);
  app.use('/api/auth', schoolAuthRoutes);

  // Platform Admin Endpoints
  app.use('/api/v1/platform/auth', platformAuthRoutes);
  app.use('/api/v1/platform/tenants', platformTenantRoutes);

  // SaaS Approved Read and Mutation Endpoints (Classrooms & Students)
  const saasMode = resolveSaasMode(options);
  app.set('saasMode', saasMode);
  if (isReadModuleAllowed(saasMode)) {
    app.use('/api/v1/classrooms', schoolClassroomRoutes);
    app.use('/api/classrooms', schoolClassroomRoutes);
    app.use('/api/v1/students', schoolStudentRoutes);
    app.use('/api/students', schoolStudentRoutes);
  }

  // SaaS Approved Attendance Endpoints
  if (isAttendanceAllowed(saasMode)) {
    app.use('/api/v1/attendance', schoolAttendanceRoutes);
    app.use('/api/attendance', schoolAttendanceRoutes);
  }

  // SaaS Approved HR, System Internal Accounts, and Timekeeping Endpoints
  if (isHrAllowed(saasMode)) {
    app.use('/api/v1/system', schoolSystemUserRoutes);
    app.use('/api/system', schoolSystemUserRoutes);
    app.use('/api/v1/hr', schoolHrRoutes);
    app.use('/api/hr', schoolHrRoutes);
    app.use('/api/v1/timekeeping', schoolTimekeepingRoutes);
    app.use('/api/timekeeping', schoolTimekeepingRoutes);
  }

  // SaaS Approved Finance and Accounting Report Endpoints
  if (isFinanceAllowed(saasMode)) {
    app.use('/api/v1/multi-school', multiSchoolAdminRoutes);
    app.use('/api/multi-school', multiSchoolAdminRoutes);
    app.use('/api/v1/finance', schoolFinanceRoutes);
    app.use('/api/finance', schoolFinanceRoutes);
    app.use('/api/v1/reports', schoolReportRoutes);
    app.use('/api/reports', schoolReportRoutes);
    app.use('/api/v1/reports', schoolPrincipalReportRoutes);
    app.use('/api/reports', schoolPrincipalReportRoutes);
  }

  // SaaS Approved Nutrition (Kitchen) Endpoints
  if (isNutritionAllowed(saasMode)) {
    app.use('/api/v1/nutrition', schoolNutritionRoutes);
    app.use('/api/nutrition', schoolNutritionRoutes);
  }

  // SaaS Approved Notifications Endpoints
  if (isNotificationAllowed(saasMode)) {
    app.use('/api/v1/notifications', schoolNotificationRoutes);
    app.use('/api/notifications', schoolNotificationRoutes);
  }

  // SaaS Approved Chat and Class Communication Endpoints
  if (isChatAllowed(saasMode)) {
    app.use('/api/v1/chat', schoolChatRoutes);
    app.use('/api/chat', schoolChatRoutes);
    app.use('/api/v1/class-communication', schoolClassroomCommunicationRoutes);
    app.use('/api/class-communication', schoolClassroomCommunicationRoutes);
  }

  // SaaS Approved Pickups and Guard Endpoints
  if (isPickupAllowed(saasMode)) {
    app.use('/api/v1/pickups', schoolPickupRoutes);
    app.use('/api/pickups', schoolPickupRoutes);
    app.use('/api/v1/guard', schoolGuardRoutes);
    app.use('/api/guard', schoolGuardRoutes);
  }

  // SaaS Approved Procurement Endpoints
  if (isProcurementAllowed(saasMode)) {
    app.use('/api/v1/procurement', schoolProcurementRoutes);
    app.use('/api/procurement', schoolProcurementRoutes);
  }

  // SaaS Approved Parent Feedback and Profile Change Requests
  if (isFeedbackAllowed(saasMode)) {
    app.use('/api/v1/parent-feedback', schoolParentFeedbackRoutes);
    app.use('/api/parent-feedback', schoolParentFeedbackRoutes);
    app.use('/api/v1/student-profile-change-requests', schoolStudentProfileChangeRequestRoutes);
    app.use('/api/student-profile-change-requests', schoolStudentProfileChangeRequestRoutes);
  }

  // Modules that are not yet ported to SaaS remain gated with 501 Not Implemented
  const gatedModules = [
    'guard-device',
    'parent-teacher-evaluations'
  ];

  gatedModules.forEach((mod) => {
    app.use(`/api/v1/${mod}`, tenantFeatureGate);
    app.use(`/api/${mod}`, tenantFeatureGate);
  });

  // Catch-all for any other /api or /api/v1 business route
  app.use('/api/v1', tenantFeatureGate);
  app.use('/api', tenantFeatureGate);

  // Phục vụ trực tiếp giao diện Frontend Production (nếu đã có bản build dist) trên cùng máy chủ Backend
  attachFrontendStatic(app);

  // Middleware xử lý lỗi tập trung: đảm bảo mọi lỗi đều trả JSON tiếng Việt an toàn, không lộ stack trace
  app.use(globalErrorHandler);

  return app;
};

module.exports = assembleSaasApp;
