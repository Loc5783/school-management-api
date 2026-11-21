const express = require('express');
const router = express.Router();
const {
  listTenants,
  createTenant,
  updateTenantStatus
} = require('../controllers/platformTenantController');
const {
  platformAuthMiddleware,
  requirePlatformRole
} = require('../middlewares/platformAuthMiddleware');

router.use(platformAuthMiddleware);

// GET is accessible by both lead and support (support gets safe projection)
router.get('/', listTenants);

// Mutating actions are strictly restricted to platform_lead (Lỗi 7)
router.post('/', requirePlatformRole(['platform_lead']), createTenant);
router.patch('/:id/status', requirePlatformRole(['platform_lead']), updateTenantStatus);

module.exports = router;
