const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const schoolAuthMiddleware = require('../middlewares/schoolAuthMiddleware');
const roleCheck = require('../../middlewares/roleCheck');
const { getAccountingReport } = require('../../controllers/accountingReportController');
const {
  getClassReport,
  getFinanceReport,
  saveReport,
  getReports,
  getReportById,
  publishReport
} = require('../../controllers/reportController');
const { getRequestSaasMode, isFinanceAllowed } = require('../utils/saasMode');

// Defense-in-depth: Reports module is strictly allowed in phase1e only
router.use((req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isFinanceAllowed(saasMode)) {
    return next('router');
  }
  next();
});

// Cho phép các đường dẫn thuộc schoolReportRoutes; các đường dẫn của Hiệu trưởng (/dashboard, /class-quality, /principal-*)
// sẽ được chuyển sang schoolPrincipalReportRoutes phía sau, còn đường dẫn lạ sẽ rơi xuống tenantFeatureGate (501).
router.use((req, res, next) => {
  const { path, method } = req;
  if (path === '/accounting-summary' && method === 'GET') return next();
  if (path === '/finance' && method === 'GET') return next();
  if (path.startsWith('/class/') && method === 'GET') return next();
  if (path === '/' && (method === 'GET' || method === 'POST')) return next();
  if (path.startsWith('/publish/') && method === 'PUT') return next();
  const singleSegment = path.slice(1);
  if (method === 'GET' && singleSegment && !singleSegment.includes('/') && mongoose.isValidObjectId(singleSegment)) {
    return next();
  }
  return next('router');
});

// Common School Auth
router.use(schoolAuthMiddleware);

// 1. Báo cáo kế toán tổng hợp
router.get('/accounting-summary', roleCheck(['admin', 'principal', 'accountant']), getAccountingReport);

// 2. Báo cáo chuyên cần theo lớp & Báo cáo học phí theo kỳ
router.get('/class/:classroomId', roleCheck(['admin', 'principal', 'teacher', 'accountant']), getClassReport);
router.get('/finance', roleCheck(['admin', 'principal', 'accountant']), getFinanceReport);

// 3. Kho báo cáo định kỳ đã lưu (cô lập theo tenantId)
router.get('/', roleCheck(['admin', 'principal', 'accountant']), getReports);
router.post('/', roleCheck(['admin', 'principal', 'accountant']), saveReport);
router.put('/publish/:id', roleCheck(['admin', 'principal']), publishReport);
router.get('/:id', roleCheck(['admin', 'principal', 'accountant']), getReportById);

// Catch-all
router.use((req, res, next) => {
  return next('router');
});

module.exports = router;
