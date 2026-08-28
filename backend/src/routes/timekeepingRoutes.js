const express = require('express');
const {
  approveCorrectionRequest,
  cancelAdjustment,
  createAdjustmentDraft,
  createCorrectionRequest,
  getDeviceEvents,
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

const router = express.Router();
const employeeRoles = ['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard'];
const approvalRoles = ['admin', 'principal'];

// Raw machine logs bypass staff JWT and use a dedicated device secret.
router.post('/device-events', deviceAuth, receiveDeviceEvent);

router.use(auth);

router.post('/check-in', roleCheck(employeeRoles), manualCheckIn);
router.post('/kiosk/check-in', roleCheck(employeeRoles), kioskCheckIn);

// State-machine endpoints for adjustment drafts and submissions.
router.post('/adjustments', roleCheck(employeeRoles), createAdjustmentDraft);
router.get('/adjustments', roleCheck(employeeRoles), listMyAdjustments);
router.get('/adjustments/:id', roleCheck(employeeRoles), getMyAdjustment);
router.patch('/adjustments/:id', roleCheck(employeeRoles), updateAdjustmentDraft);
router.post('/adjustments/:id/submit', roleCheck(employeeRoles), submitAdjustmentDraft);
router.post('/adjustments/:id/cancel', roleCheck(employeeRoles), cancelAdjustment);

// Compatibility for the existing client: creates and submits in one request.
router.post('/corrections', roleCheck(employeeRoles), createCorrectionRequest);
router.get('/me', roleCheck(employeeRoles), getMyTimekeeping);

router.get('/corrections/pending', roleCheck(approvalRoles), getPendingCorrectionRequests);
router.patch('/corrections/:id/approve', roleCheck(approvalRoles), approveCorrectionRequest);
router.patch('/corrections/:id/reject', roleCheck(approvalRoles), rejectCorrectionRequest);
router.post('/recalculate/:date', roleCheck(approvalRoles), recalculateAttendance);

router.get('/device-events', roleCheck(approvalRoles), getDeviceEvents);

module.exports = router;
