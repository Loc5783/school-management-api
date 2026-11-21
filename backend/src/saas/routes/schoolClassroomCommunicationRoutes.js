'use strict';

const express = require('express');
const router = express.Router();
const schoolAuthMiddleware = require('../middlewares/schoolAuthMiddleware');
const roleCheck = require('../../middlewares/roleCheck');
const {
  listAnnouncements,
  createAnnouncement,
  listClassCareReports,
  saveClassCareReport
} = require('../../controllers/classroomCommunicationController');
const { getRequestSaasMode, isChatAllowed } = require('../utils/saasMode');

// Defense-in-depth: Classroom Communication gating
router.use((req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isChatAllowed(saasMode)) {
    return next('router');
  }
  next();
});

router.use(schoolAuthMiddleware);

router.get('/announcements', roleCheck(['admin', 'principal', 'teacher', 'parent']), listAnnouncements);
router.post('/announcements', roleCheck(['admin', 'principal', 'teacher']), createAnnouncement);
router.get('/care-reports', roleCheck(['admin', 'principal', 'teacher', 'parent']), listClassCareReports);
router.put('/care-reports', roleCheck(['admin', 'principal', 'teacher']), saveClassCareReport);

module.exports = router;
