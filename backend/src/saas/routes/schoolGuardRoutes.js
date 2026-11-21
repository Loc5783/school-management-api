'use strict';

const express = require('express');
const router = express.Router();
const schoolAuthMiddleware = require('../middlewares/schoolAuthMiddleware');
const roleCheck = require('../../middlewares/roleCheck');
const controller = require('../../controllers/guardController');
const { getRequestSaasMode, isPickupAllowed } = require('../utils/saasMode');

// Defense-in-depth: Guard module gating
router.use((req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isPickupAllowed(saasMode)) {
    return next('router');
  }
  next();
});

router.use(schoolAuthMiddleware);

// Gate Operations
router.get('/dashboard', roleCheck(['guard', 'admin', 'principal']), controller.getDashboard);
router.get('/status', roleCheck(['guard', 'admin', 'principal']), controller.getDashboard);
router.get('/students', roleCheck(['guard', 'admin', 'principal']), controller.searchStudents);
router.get('/gate-events', roleCheck(['guard', 'admin', 'principal']), controller.listGateEvents);
router.post('/gate-events', roleCheck(['guard', 'admin', 'principal']), controller.recordGateEvent);
router.get('/visitors', roleCheck(['guard', 'admin', 'principal']), controller.listVisitors);
router.post('/visitors', roleCheck(['guard', 'admin', 'principal']), controller.createVisitor);
router.patch('/visitors/:id/check-out', roleCheck(['guard', 'admin', 'principal']), controller.checkoutVisitor);

// Security Incidents
router.get('/incidents', roleCheck(['guard', 'admin', 'principal']), controller.listIncidents);
router.post('/incidents', roleCheck(['guard', 'admin']), controller.createIncident);
router.patch('/incidents/:id', roleCheck(['guard', 'admin']), controller.updateIncident);
router.patch('/incidents/:id/acknowledge', roleCheck(['admin', 'principal']), controller.acknowledgeIncident);
router.patch('/incidents/:id/management-instruction', roleCheck(['admin', 'principal']), controller.addManagementInstruction);

// Shift Handovers
router.get('/handovers', roleCheck(['guard', 'admin']), controller.listHandovers);
router.get('/receivers', roleCheck(['guard', 'admin', 'principal']), controller.listReceivers);
router.post('/handovers', roleCheck(['guard', 'admin']), controller.createHandover);
router.patch('/handovers/:id/accept', roleCheck(['guard', 'admin']), controller.acceptHandover);

// QR & OTP Pickups
router.post('/qr/resolve', roleCheck(['guard', 'admin']), controller.resolveQrCode);
router.post('/pickup-otp', roleCheck(['guard', 'admin']), controller.requestPickupOtp);
router.post('/pickup-otp/:id/verify', roleCheck(['guard', 'admin']), controller.verifyPickupOtp);

// Deliveries
router.get('/deliveries', roleCheck(['guard', 'admin']), controller.listSupplierDeliveries);
router.get('/deliveries/expected-orders', roleCheck(['guard', 'admin']), controller.listExpectedDeliveries);
router.post('/deliveries', roleCheck(['guard', 'admin']), controller.createSupplierDelivery);
router.patch('/deliveries/:id/check-out', roleCheck(['guard', 'admin']), controller.checkoutSupplierDelivery);

// Emergency Mode
router.get('/emergency-mode', roleCheck(['guard', 'admin', 'principal', 'teacher']), controller.getEmergencyMode);
router.post('/emergency-mode', roleCheck(['guard', 'admin', 'principal']), controller.activateEmergencyMode);
router.patch('/emergency-mode/:id/resolve', roleCheck(['guard', 'admin', 'principal']), controller.resolveEmergencyMode);
router.get('/reports', roleCheck(['admin', 'principal']), controller.getGuardReport);

module.exports = router;
