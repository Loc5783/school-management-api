const express = require('express');
const router = express.Router();
const schoolAuthMiddleware = require('../middlewares/schoolAuthMiddleware');
const saasDeviceAuth = require('../../middlewares/saasDeviceAuth');
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
const { getRequestSaasMode, isHrAllowed } = require('../utils/saasMode');

// Defense-in-depth: Timekeeping module is strictly allowed in phase1d only
router.use((req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isHrAllowed(saasMode)) {
    return next('router');
  }
  next();
});

// Hardware machine ingest endpoint: Bypasses staff JWT and strictly enforces saasDeviceAuth
router.post('/device-events', saasDeviceAuth, receiveDeviceEvent);

// Explicitly gate unapproved timekeeping submodules so they cleanly fall through to tenantFeatureGate (501)
// E.g. kiosk terminals, overtime & overtime rates, GET /device-events
const UNAPPROVED_TIMEKEEPING_PREFIXES = [
  '/kiosk',
  '/overtime',
  '/overtime-rates'
];

router.use((req, res, next) => {
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

// 1. Web Check-in & Inquiries
router.post('/check-in', roleCheck(employeeRoles), manualCheckIn);
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

// 5. Timekeeping Device & Person Mapping Management Endpoints
router.get('/devices', roleCheck(['admin', 'principal', 'hr']), deviceCtrl.listDevices);
router.post('/devices', roleCheck(['admin']), deviceCtrl.createDevice);
router.get('/devices-unmapped', roleCheck(['admin', 'principal', 'hr']), deviceCtrl.getUnmappedEvents);
router.get('/devices/:id', roleCheck(['admin', 'principal', 'hr']), deviceCtrl.getDeviceById);
router.patch('/devices/:id', roleCheck(['admin']), deviceCtrl.updateDevice);
router.post('/devices/:id/test-connection', roleCheck(['admin']), deviceCtrl.testDeviceConn);
router.post('/devices/:id/sync', roleCheck(['admin', 'principal']), deviceCtrl.triggerDeviceSync);
router.get('/devices/:id/person-mappings', roleCheck(['admin', 'principal', 'hr']), deviceCtrl.listPersonMappings);
router.post('/devices/:id/person-mappings', roleCheck(['admin']), deviceCtrl.upsertPersonMapping);
router.delete('/devices/:id/person-mappings/:mappingId', roleCheck(['admin']), deviceCtrl.deletePersonMapping);
router.get('/devices/:id/sync-logs', roleCheck(['admin', 'principal', 'hr']), deviceCtrl.getSyncLogs);

module.exports = router;
