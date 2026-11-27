'use strict';

const express = require('express');
const router = express.Router();
const schoolAuthMiddleware = require('../middlewares/schoolAuthMiddleware');
const roleCheck = require('../../middlewares/roleCheck');
const {
  listPickupRecords,
  listPickupClassrooms,
  createPickupRecord,
  confirmPickupRecord,
  cancelPickupRecord,
  getClassroomPickupRoster,
  directHandover,
  undoHandover
} = require('../../controllers/pickupController');
const { getRequestSaasMode, isPickupAllowed } = require('../utils/saasMode');

// Defense-in-depth: Pickups module gating
router.use((req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isPickupAllowed(saasMode)) {
    return next('router');
  }
  next();
});

router.use(schoolAuthMiddleware);

router.get('/classrooms', roleCheck(['teacher', 'admin', 'principal', 'guard']), listPickupClassrooms);
router.get('/class-roster/:classroomId', roleCheck(['teacher', 'admin', 'principal', 'guard']), getClassroomPickupRoster);
router.post('/direct-handover', roleCheck(['teacher', 'admin', 'principal', 'guard']), directHandover);
router.post('/:id/undo-handover', roleCheck(['teacher', 'admin', 'principal', 'guard']), undoHandover);
router.get('/today', roleCheck(['parent', 'teacher', 'admin', 'principal', 'guard']), listPickupRecords);
router.get('/records', roleCheck(['parent', 'teacher', 'admin', 'principal', 'guard']), listPickupRecords);
router.get('/', roleCheck(['parent', 'teacher', 'admin', 'principal', 'guard']), listPickupRecords);
router.post('/', roleCheck(['parent', 'admin']), createPickupRecord);
router.patch('/:id/confirm', roleCheck(['teacher', 'admin', 'guard', 'principal']), confirmPickupRecord);
router.patch('/:id/cancel', roleCheck(['parent', 'admin']), cancelPickupRecord);

module.exports = router;
