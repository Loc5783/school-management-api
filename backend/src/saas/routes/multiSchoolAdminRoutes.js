'use strict';

const express = require('express');
const router = express.Router();
const {
  platformAuthMiddleware,
  requirePlatformRole
} = require('../middlewares/platformAuthMiddleware');
const { authLimiter } = require('../middlewares/rateLimiter');
const {
  getPublicSystemMeta,
  loginSuperAdmin,
  getSuperAdminMe,
  changeSuperAdminPassword,
  listAllSchoolsOverview,
  getPlatformGrowthReportHandler,
  getSchoolDetailedReportHandler,
  getSystemSettingsHandler,
  updateSystemSettingsHandler,
  listPlatformAuditLogsHandler,
  listSchoolOperationalLogsHandler,
  dispatchSchoolNotificationHandler,
  testSchoolWebhookBySuperAdmin,
  createSchoolWithAdmin,
  updateSchoolAndAdmin,
  enterSchoolWorkspace,
  listSchoolAccountsHandler,
  createSchoolAccountHandler,
  updateSchoolAccountHandler
} = require('../controllers/multiSchoolAdminController');

router.get('/public-meta', getPublicSystemMeta);
router.post('/login', authLimiter, loginSuperAdmin);

router.use(platformAuthMiddleware);
router.get('/me', getSuperAdminMe);
router.post('/me/password', authLimiter, changeSuperAdminPassword);
router.get('/schools', listAllSchoolsOverview);
router.get('/growth-report', getPlatformGrowthReportHandler);
router.get('/schools/:id/report', getSchoolDetailedReportHandler);
router.get('/schools/:id/accounts', listSchoolAccountsHandler);
router.post('/schools/:id/accounts', requirePlatformRole(['platform_lead']), createSchoolAccountHandler);
router.patch('/schools/:id/accounts/:accountId', requirePlatformRole(['platform_lead']), updateSchoolAccountHandler);
router.post('/schools/:id/test-webhook', requirePlatformRole(['platform_lead']), testSchoolWebhookBySuperAdmin);
router.post('/schools', requirePlatformRole(['platform_lead']), createSchoolWithAdmin);
router.put('/schools/:id', requirePlatformRole(['platform_lead']), updateSchoolAndAdmin);
router.post('/schools/:id/enter', requirePlatformRole(['platform_lead']), enterSchoolWorkspace);
router.get('/settings', getSystemSettingsHandler);
router.put('/settings', requirePlatformRole(['platform_lead']), updateSystemSettingsHandler);
router.get('/audit-logs', listPlatformAuditLogsHandler);
router.get('/school-logs', listSchoolOperationalLogsHandler);
router.post('/notifications/dispatch', requirePlatformRole(['platform_lead']), dispatchSchoolNotificationHandler);

module.exports = router;
