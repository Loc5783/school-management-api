'use strict';

const express = require('express');
const router = express.Router();
const {
  platformAuthMiddleware,
  requirePlatformRole
} = require('../middlewares/platformAuthMiddleware');
const { authLimiter } = require('../middlewares/rateLimiter');
const {
  loginSuperAdmin,
  getSuperAdminMe,
  changeSuperAdminPassword,
  listAllSchoolsOverview,
  createSchoolWithAdmin,
  updateSchoolAndAdmin,
  enterSchoolWorkspace
} = require('../controllers/multiSchoolAdminController');

router.post('/login', authLimiter, loginSuperAdmin);

router.use(platformAuthMiddleware);
router.get('/me', getSuperAdminMe);
router.post('/me/password', authLimiter, changeSuperAdminPassword);
router.get('/schools', listAllSchoolsOverview);
router.post('/schools', requirePlatformRole(['platform_lead']), createSchoolWithAdmin);
router.put('/schools/:id', requirePlatformRole(['platform_lead']), updateSchoolAndAdmin);
router.post('/schools/:id/enter', requirePlatformRole(['platform_lead']), enterSchoolWorkspace);

module.exports = router;

