const express = require('express');
const auth = require('../middlewares/auth');
const roleCheck = require('../middlewares/roleCheck');
const controller = require('../controllers/pickupController');

const router = express.Router();
router.use(auth);
router.get('/classrooms', roleCheck(['teacher', 'admin', 'principal', 'guard']), controller.listPickupClassrooms);
router.get('/class-roster/:classroomId', roleCheck(['teacher', 'admin', 'principal', 'guard']), controller.getClassroomPickupRoster);
router.post('/direct-handover', roleCheck(['teacher', 'admin', 'principal', 'guard']), controller.directHandover);
router.post('/:id/undo-handover', roleCheck(['teacher', 'admin', 'principal', 'guard']), controller.undoHandover);
router.get('/', roleCheck(['parent', 'teacher', 'admin', 'principal']), controller.listPickupRecords);
router.post('/', roleCheck(['parent']), controller.createPickupRecord);
router.patch('/:id/confirm', roleCheck(['teacher', 'admin']), controller.confirmPickupRecord);
router.patch('/:id/cancel', roleCheck(['parent']), controller.cancelPickupRecord);

module.exports = router;
