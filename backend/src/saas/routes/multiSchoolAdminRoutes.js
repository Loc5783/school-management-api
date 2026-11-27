'use strict';

const express = require('express');
const router = express.Router();
const {
  platformAuthMiddleware,
  requirePlatformRole
} = require('../middlewares/platformAuthMiddleware');
const {
  loginSuperAdmin,
  getSuperAdminMe,
  changeSuperAdminPassword,
  listAllSchoolsOverview,
  createSchoolWithAdmin,
  updateSchoolAndAdmin,
  enterSchoolWorkspace
} = require('../controllers/multiSchoolAdminController');

router.post('/login', loginSuperAdmin);

router.use(platformAuthMiddleware);
router.get('/me', getSuperAdminMe);
router.post('/me/password', changeSuperAdminPassword);
router.get('/schools', listAllSchoolsOverview);
router.post('/schools', requirePlatformRole(['platform_lead']), createSchoolWithAdmin);
router.put('/schools/:id', requirePlatformRole(['platform_lead']), updateSchoolAndAdmin);
router.post('/schools/:id/enter', requirePlatformRole(['platform_lead']), enterSchoolWorkspace);

module.exports = router;

