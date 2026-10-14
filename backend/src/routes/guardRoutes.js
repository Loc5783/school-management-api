const express = require('express');
const auth = require('../middlewares/auth');
const roleCheck = require('../middlewares/roleCheck');
const controller = require('../controllers/guardController');
const devices = require('../controllers/guardDeviceController');

const router = express.Router();
router.use(auth);

// Vận hành cổng (chỉ bảo vệ và quản trị viên)
router.get('/dashboard', roleCheck(['guard', 'admin']), controller.getDashboard);
router.get('/students', roleCheck(['guard', 'admin']), controller.searchStudents);
router.get('/gate-events', roleCheck(['guard', 'admin']), controller.listGateEvents);
router.post('/gate-events', roleCheck(['guard', 'admin']), controller.recordGateEvent);
router.get('/visitors', roleCheck(['guard', 'admin']), controller.listVisitors);
router.post('/visitors', roleCheck(['guard', 'admin']), controller.createVisitor);
router.patch('/visitors/:id/check-out', roleCheck(['guard', 'admin']), controller.checkoutVisitor);

// Quản lý sự cố an ninh & an toàn trường học
router.get('/incidents', roleCheck(['guard', 'admin', 'principal']), controller.listIncidents);
router.post('/incidents', roleCheck(['guard', 'admin']), controller.createIncident);
router.patch('/incidents/:id', roleCheck(['guard', 'admin']), controller.updateIncident);
router.patch('/incidents/:id/acknowledge', roleCheck(['admin', 'principal']), controller.acknowledgeIncident);
router.patch('/incidents/:id/management-instruction', roleCheck(['admin', 'principal']), controller.addManagementInstruction);

// Bàn giao ca và nghiệp vụ cổng
router.get('/handovers', roleCheck(['guard', 'admin']), controller.listHandovers);
router.get('/receivers', roleCheck(['guard', 'admin', 'principal']), controller.listReceivers);
router.post('/handovers', roleCheck(['guard', 'admin']), controller.createHandover);
router.patch('/handovers/:id/accept', roleCheck(['guard', 'admin']), controller.acceptHandover);
router.post('/qr/resolve', roleCheck(['guard', 'admin']), controller.resolveQrCode);
router.post('/pickup-otp', roleCheck(['guard', 'admin']), controller.requestPickupOtp);
router.post('/pickup-otp/:id/verify', roleCheck(['guard', 'admin']), controller.verifyPickupOtp);
router.get('/deliveries', roleCheck(['guard', 'admin']), controller.listSupplierDeliveries);
router.get('/deliveries/expected-orders', roleCheck(['guard', 'admin']), controller.listExpectedDeliveries);
router.post('/deliveries', roleCheck(['guard', 'admin']), controller.createSupplierDelivery);
router.patch('/deliveries/:id/check-out', roleCheck(['guard', 'admin']), controller.checkoutSupplierDelivery);
router.get('/emergency-mode', roleCheck(['guard', 'admin']), controller.getEmergencyMode);
router.post('/emergency-mode', roleCheck(['guard', 'admin']), controller.activateEmergencyMode);
router.patch('/emergency-mode/:id/resolve', roleCheck(['guard', 'admin']), controller.resolveEmergencyMode);
router.get('/reports', roleCheck(['guard', 'admin', 'principal']), controller.getGuardReport);

// Thiết bị kiểm soát cổng (IoT / Camera / Barcode)
router.get('/devices', roleCheck(['guard', 'admin']), devices.listDevices);
router.post('/devices', roleCheck(['admin']), devices.createDevice);
router.patch('/devices/:id', roleCheck(['admin']), devices.updateDevice);
router.post('/devices/:id/rotate-token', roleCheck(['admin']), devices.rotateDeviceToken);
router.get('/device-events', roleCheck(['guard', 'admin']), devices.listEvents);
router.patch('/device-events/:id/review', roleCheck(['guard', 'admin']), devices.reviewEvent);

module.exports = router;
