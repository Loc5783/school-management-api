const express = require('express');
const router = express.Router();

const schoolAuthMiddleware = require('../middlewares/schoolAuthMiddleware');
const roleCheck = require('../../middlewares/roleCheck');
const { getAccountingReport } = require('../../controllers/accountingReportController');
const { getRequestSaasMode, isFinanceAllowed } = require('../utils/saasMode');

// Defense-in-depth: Reports module for accounting summary is strictly allowed in phase1e only
router.use((req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isFinanceAllowed(saasMode)) {
    return next('router');
  }
  next();
});

// Explicitly gate unapproved report submodules so they fall through to tenantFeatureGate (501)
// Only /accounting-summary is approved in Phase 1E
router.use((req, res, next) => {
  if (req.path !== '/accounting-summary') {
    return next('router');
  }
  next();
});

// Common School Auth
router.use(schoolAuthMiddleware);

// Approved Phase 1E Accounting Summary Report endpoint
router.get('/accounting-summary', roleCheck(['admin', 'principal', 'accountant']), getAccountingReport);

// Catch-all
router.use((req, res, next) => {
  return next('router');
});

module.exports = router;
