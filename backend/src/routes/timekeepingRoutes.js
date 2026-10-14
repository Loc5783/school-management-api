const express = require('express');
const {
  approveCorrectionRequest,
  cancelAdjustment,
  createAdjustmentDraft,
  createCorrectionRequest,
  getDeviceEvents,
  getDailyTimekeeping,
  getMyAdjustment,
  getMyTimekeeping,
  getPendingCorrectionRequests,
  kioskCheckIn,
  listMyAdjustments,
  manualCheckIn,
  receiveDeviceEvent,
  recalculateAttendance,
  rejectCorrectionRequest,
  submitAdjustmentDraft,
  updateAdjustmentDraft
} = require('../controllers/timekeepingController');
const auth = require('../middlewares/auth');
const deviceAuth = require('../middlewares/deviceAuth');
const roleCheck = require('../middlewares/roleCheck');
const overtime = require('../controllers/overtimeController');

const router = express.Router();
const employeeRoles = ['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard', 'hr'];
const approvalRoles = ['admin', 'principal'];
const adjustmentRoles = employeeRoles.filter((role) => role !== 'guard');

// Raw machine logs bypass staff JWT and use a dedicated device secret.
router.post('/device-events', deviceAuth, receiveDeviceEvent);

router.use(auth);
router.use(require('../middlewares/hrAccessAudit')('timekeeping'));

router.post('/check-in', roleCheck(employeeRoles), manualCheckIn);
router.post('/kiosk/check-in', roleCheck(employeeRoles), kioskCheckIn);

// State-machine endpoints for adjustment drafts and submissions.
router.post('/adjustments', roleCheck(adjustmentRoles), createAdjustmentDraft);
router.get('/adjustments', roleCheck(employeeRoles), listMyAdjustments);
router.get('/adjustments/:id', roleCheck(employeeRoles), getMyAdjustment);
router.patch('/adjustments/:id', roleCheck(adjustmentRoles), updateAdjustmentDraft);
router.post('/adjustments/:id/submit', roleCheck(adjustmentRoles), submitAdjustmentDraft);
router.post('/adjustments/:id/cancel', roleCheck(employeeRoles), cancelAdjustment);

// Compatibility for the existing client: creates and submits in one request.
router.post('/corrections', roleCheck(adjustmentRoles), createCorrectionRequest);
router.get('/me', roleCheck(employeeRoles), getMyTimekeeping);
router.get('/daily', roleCheck(['admin', 'principal', 'hr']), getDailyTimekeeping);
router.post('/overtime', roleCheck(['chef', 'guard']), overtime.createOvertime);
router.get('/overtime/me', roleCheck(employeeRoles), overtime.myOvertime);
router.get('/overtime', roleCheck(['admin', 'principal', 'hr']), overtime.listOvertime);
router.patch('/overtime/:id/review', roleCheck(['admin', 'principal']), overtime.reviewOvertime);
router.get('/overtime-rates', roleCheck(['admin', 'principal', 'hr']), overtime.listRates);
router.put('/overtime-rates/:employeeId', roleCheck(['admin', 'hr']), overtime.setRate);

router.get('/corrections/pending', roleCheck([...approvalRoles, 'hr']), getPendingCorrectionRequests);
router.patch('/corrections/:id/approve', roleCheck(approvalRoles), approveCorrectionRequest);
router.patch('/corrections/:id/reject', roleCheck(approvalRoles), rejectCorrectionRequest);
router.post('/recalculate/:date', roleCheck(approvalRoles), recalculateAttendance);

router.get('/device-events', roleCheck(approvalRoles), getDeviceEvents);

module.exports = router;
