const express = require('express');
const router = express.Router();
const schoolAuthMiddleware = require('../middlewares/schoolAuthMiddleware');
const roleCheck = require('../../middlewares/roleCheck');
const hrAccessAudit = require('../../middlewares/hrAccessAudit');
const {
  createParentAccount,
  linkParentStudents,
  listParents,
  updateParentStatus,
  listInternalAccounts,
  createInternalAccount,
  updateInternalAccountRole,
  updateInternalAccount,
  deactivateInternalAccount
} = require('../../controllers/systemUserController');
const {
  listCampuses,
  createCampus,
  updateCampus,
  updateCurrentSchoolInfo,
  deleteCampus
} = require('../../controllers/campusController');
const { getRequestSaasMode, isHrAllowed, isFinanceAllowed } = require('../utils/saasMode');

// Defense-in-depth: Internal Accounts module is strictly allowed in phase1d and phase1e
router.use((req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isHrAllowed(saasMode)) {
    return next('router');
  }
  next();
});

// Gate /parents and /campuses to phase1e (isFinanceAllowed) so phase1d contract tests stay untouched
router.use((req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (req.path.startsWith('/parents') || req.path.startsWith('/campuses') || req.path.startsWith('/school-info')) {
    return isFinanceAllowed(saasMode) ? next() : next('router');
  }
  if (!req.path.startsWith('/accounts')) {
    return next('router');
  }
  next();
});

// Common middleware chain: School auth -> HR access audit
router.use(schoolAuthMiddleware);
router.use(hrAccessAudit('accounts'));

// School Info & Campus (Phân hiệu / Cơ sở) Management Endpoints
router.get('/campuses', roleCheck(['admin', 'principal']), listCampuses);
router.post('/campuses', roleCheck(['admin']), createCampus);
router.put('/campuses/:campusCode', roleCheck(['admin']), updateCampus);
router.delete('/campuses/:campusCode', roleCheck(['admin']), deleteCampus);
router.put('/school-info', roleCheck(['admin']), updateCurrentSchoolInfo);

// Parent Account Management Endpoints (Tenant-isolated, Admin only)
router.get('/parents', roleCheck(['admin']), listParents);
router.post('/parents', roleCheck(['admin']), createParentAccount);
router.patch('/parents/:id/students', roleCheck(['admin']), linkParentStudents);
router.patch('/parents/:id/status', roleCheck(['admin']), updateParentStatus);

// 5 Approved Internal Account Endpoints from Phase 1D.2
// Admin and HR roles only (HR cannot modify principal/admin hierarchy as enforced in controller)
router.get('/accounts', roleCheck(['admin', 'hr']), listInternalAccounts);
router.post('/accounts', roleCheck(['admin', 'hr']), createInternalAccount);
router.patch('/accounts/:id/role', roleCheck(['admin', 'hr']), updateInternalAccountRole);
router.patch('/accounts/:id', roleCheck(['admin', 'hr']), updateInternalAccount);
router.delete('/accounts/:id', roleCheck(['admin', 'hr']), deactivateInternalAccount);

module.exports = router;
