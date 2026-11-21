const express = require('express');
const router = express.Router();
const schoolAuthMiddleware = require('../middlewares/schoolAuthMiddleware');
const roleCheck = require('../../middlewares/roleCheck');
const hrAccessAudit = require('../../middlewares/hrAccessAudit');
const {
  listInternalAccounts,
  createInternalAccount,
  updateInternalAccountRole,
  updateInternalAccount,
  deactivateInternalAccount
} = require('../../controllers/systemUserController');
const { getRequestSaasMode, isHrAllowed } = require('../utils/saasMode');

// Defense-in-depth: Internal Accounts module is strictly allowed in phase1d only
router.use((req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isHrAllowed(saasMode)) {
    return next('router');
  }
  next();
});

// Gate any subpath other than /accounts (e.g. /parents, /parents/*)
// so unapproved submodules cleanly fall through to downstream tenantFeatureGate (501)
router.use((req, res, next) => {
  if (!req.path.startsWith('/accounts')) {
    return next('router');
  }
  next();
});

// Common middleware chain: School auth -> HR access audit
router.use(schoolAuthMiddleware);
router.use(hrAccessAudit('accounts'));

// 5 Approved Internal Account Endpoints from Phase 1D.2
// Admin and HR roles only (HR cannot modify principal/admin hierarchy as enforced in controller)
router.get('/accounts', roleCheck(['admin', 'hr']), listInternalAccounts);
router.post('/accounts', roleCheck(['admin', 'hr']), createInternalAccount);
router.patch('/accounts/:id/role', roleCheck(['admin', 'hr']), updateInternalAccountRole);
router.patch('/accounts/:id', roleCheck(['admin', 'hr']), updateInternalAccount);
router.delete('/accounts/:id', roleCheck(['admin', 'hr']), deactivateInternalAccount);

module.exports = router;
