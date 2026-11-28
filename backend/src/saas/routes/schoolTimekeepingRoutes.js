const express = require('express');
const router = express.Router();
const schoolAuthMiddleware = require('../middlewares/schoolAuthMiddleware');
const saasDeviceAuth = require('../../middlewares/saasDeviceAuth');
const { deviceIngestLimiter } = require('../middlewares/rateLimiter');
const roleCheck = require('../../middlewares/roleCheck');
const hrAccessAudit = require('../../middlewares/hrAccessAudit');
const {
  approveCorrectionRequest,
  cancelAdjustment,
  createAdjustmentDraft,
  createCorrectionRequest,
  getDailyTimekeeping,
  getMyAdjustment,
  getMyTimekeeping,
  getPendingCorrectionRequests,
  kioskCheckIn,
  listMyAdjustments,
  manualCheckIn,
  recalculateAttendance,
  receiveDeviceEvent,
  rejectCorrectionRequest,
  submitAdjustmentDraft,
  updateAdjustmentDraft,
  getDeviceEvents
} = require('../../controllers/timekeepingController');
const deviceCtrl = require('../../controllers/timekeepingDeviceController');
const webhookTestAuth = require('../../middlewares/webhookTestAuth');
const { pingWebhook, handleWebhook } = require('../../controllers/timekeepingWebhookController');
const { getRequestSaasMode, isHrAllowed, isFinanceAllowed } = require('../utils/saasMode');

const rawWebhookBody = express.raw({ type: '*/*', limit: '10mb' });

// Defense-in-depth: Timekeeping module is strictly allowed in phase1d and phase1e
router.use((req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isHrAllowed(saasMode)) {
    return next('router');
  }
  next();
});

// Hardware machine ingest endpoint & schoolCode webhook alias (`/api/timekeeping/webhook/:schoolCode`):
router.post('/device-events', deviceIngestLimiter, saasDeviceAuth, receiveDeviceEvent);
router.get('/webhook', deviceIngestLimiter, webhookTestAuth, pingWebhook);
router.get('/webhook/:schoolCode', deviceIngestLimiter, webhookTestAuth, pingWebhook);
router.post('/webhook', deviceIngestLimiter, webhookTestAuth, rawWebhookBody, handleWebhook);
router.post('/webhook/:schoolCode', deviceIngestLimiter, webhookTestAuth, rawWebhookBody, handleWebhook);

// Explicitly gate unapproved timekeeping submodules so they cleanly fall through to tenantFeatureGate (501)
const UNAPPROVED_TIMEKEEPING_PREFIXES = [
  '/overtime',
  '/overtime-rates'
];

router.use((req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (req.path.startsWith('/kiosk') && !isFinanceAllowed(saasMode)) {
    return next('router');
  }
  if (UNAPPROVED_TIMEKEEPING_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
    return next('router');
  }
  if (req.method === 'GET' && req.path === '/device-events') {
    return next('router');
  }
  next();
});

// Common middleware chain: School auth -> Timekeeping access audit
router.use(schoolAuthMiddleware);
router.use(hrAccessAudit('timekeeping'));

const employeeRoles = ['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard', 'hr'];
const approvalRoles = ['admin', 'principal'];
const adjustmentRoles = ['admin', 'principal', 'teacher', 'accountant', 'chef', 'hr'];

// 1. Web Check-in, Kiosk Code Check-in & Inquiries
router.post('/check-in', roleCheck(employeeRoles), manualCheckIn);
router.post('/kiosk/check-in', roleCheck(employeeRoles), kioskCheckIn);
router.get('/me', roleCheck(employeeRoles), getMyTimekeeping);
router.get('/daily', roleCheck(['admin', 'principal', 'hr']), getDailyTimekeeping);

// 2. Adjustments State Machine
router.post('/adjustments', roleCheck(adjustmentRoles), createAdjustmentDraft);
router.get('/adjustments', roleCheck(employeeRoles), listMyAdjustments);
router.post('/adjustments/:id/submit', roleCheck(adjustmentRoles), submitAdjustmentDraft);
router.post('/adjustments/:id/cancel', roleCheck(employeeRoles), cancelAdjustment);
router.get('/adjustments/:id', roleCheck(employeeRoles), getMyAdjustment);
router.patch('/adjustments/:id', roleCheck(adjustmentRoles), updateAdjustmentDraft);

// 3. Corrections Compatibility Endpoints
router.post('/corrections', roleCheck(adjustmentRoles), createCorrectionRequest);
router.get('/corrections/pending', roleCheck([...approvalRoles, 'hr']), getPendingCorrectionRequests);
router.patch('/corrections/:id/approve', roleCheck(approvalRoles), approveCorrectionRequest);
router.patch('/corrections/:id/reject', roleCheck(approvalRoles), rejectCorrectionRequest);

// 4. Attendance Recalculation
router.post('/recalculate/:date', roleCheck(approvalRoles), recalculateAttendance);

// 5. Timekeeping Device, 500-Slot Biometric ISAPI Sync & Person Mapping Management Endpoints
router.get('/biometric-overview', roleCheck(['admin', 'principal', 'hr']), deviceCtrl.getBiometricOverview);
router.put('/biometric-faces/:subjectType/:subjectId', roleCheck(['admin', 'principal', 'hr']), deviceCtrl.uploadBiometricFace);
router.delete('/biometric-faces/:subjectType/:subjectId', roleCheck(['admin', 'principal', 'hr']), deviceCtrl.removeBiometricFace);
router.post('/biometric-faces/:subjectType/:subjectId/push', roleCheck(['admin', 'principal', 'hr']), deviceCtrl.pushSingleBiometricPerson);

router.get('/devices', roleCheck(['admin', 'principal', 'hr']), deviceCtrl.listDevices);
router.post('/devices', roleCheck(['admin']), deviceCtrl.createDevice);
router.post('/devices/discover-lan', roleCheck(['admin', 'principal', 'hr']), deviceCtrl.discoverLanDevices);
router.post('/devices/sync-all', roleCheck(['admin', 'principal', 'hr']), deviceCtrl.syncAllDevicesSmart);
router.post('/devices/pull-all', roleCheck(['admin', 'principal', 'hr']), deviceCtrl.pullAllDevicesFast);
router.post('/devices/quick-bidirectional-sync', roleCheck(['admin', 'principal', 'hr']), deviceCtrl.quickBidirectionalSync);
router.post('/devices/simulate-webhook', roleCheck(['admin', 'principal']), deviceCtrl.simulateWebhook);
router.get('/devices-unmapped', roleCheck(['admin', 'principal', 'hr']), deviceCtrl.getUnmappedEvents);
router.get('/devices/:id', roleCheck(['admin', 'principal', 'hr']), deviceCtrl.getDeviceById);
router.patch('/devices/:id', roleCheck(['admin']), deviceCtrl.updateDevice);
router.delete('/devices/:id', roleCheck(['admin']), deviceCtrl.deleteDevice);
router.post('/devices/:id/test-connection', roleCheck(['admin']), deviceCtrl.testDeviceConn);
router.post('/devices/:id/check-capacity', roleCheck(['admin', 'principal', 'hr']), deviceCtrl.checkDeviceCapacity);
router.post('/devices/:id/pull-users', roleCheck(['admin', 'principal', 'hr']), deviceCtrl.pullUsersFromDevice);
router.post('/devices/:id/link-pulled-user', roleCheck(['admin', 'principal', 'hr']), deviceCtrl.linkPulledDeviceUser);
router.post('/devices/:id/push-sync', roleCheck(['admin', 'principal', 'hr']), deviceCtrl.pushSmartSyncToDevice);
router.post('/devices/:id/quick-bidirectional-sync', roleCheck(['admin', 'principal', 'hr']), deviceCtrl.quickBidirectionalSync);
router.post('/devices/:id/prune-inactive', roleCheck(['admin', 'principal']), deviceCtrl.pruneDeviceInactiveSlots);
router.post('/devices/:id/unlock-door', roleCheck(['admin', 'principal']), deviceCtrl.unlockDeviceDoor);
router.post('/devices/:id/sync', roleCheck(['admin', 'principal']), deviceCtrl.triggerDeviceSync);
router.get('/devices/:id/person-mappings', roleCheck(['admin', 'principal', 'hr']), deviceCtrl.listPersonMappings);
router.post('/devices/:id/person-mappings', roleCheck(['admin', 'hr']), deviceCtrl.upsertPersonMapping);
router.delete('/devices/:id/person-mappings/:mappingId', roleCheck(['admin', 'hr']), deviceCtrl.deletePersonMapping);
router.get('/devices/:id/sync-logs', roleCheck(['admin', 'principal', 'hr']), deviceCtrl.getSyncLogs);

module.exports = router;
