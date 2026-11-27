const express = require('express');
const router = express.Router();
const multer = require('multer');

const schoolAuthMiddleware = require('../middlewares/schoolAuthMiddleware');
const roleCheck = require('../../middlewares/roleCheck');
const periodOpen = require('../../middlewares/accountingPeriodOpen');

const {
  createTuitionFee,
  createBulkTuitionFees,
  previewBulkTuitionFees,
  makePayment,
  getTuitionByStudent,
  getTuitionByClass,
  getInvoices,
  getDebtReport,
  sendDebtReminders,
  getPaymentsByInvoice,
  getReceipt,
  cancelTuitionFee,
  adjustTuitionFee,
  addBulkInvoiceItem,
  getInvoiceAdjustments,
  getFinanceClassrooms,
  getAccountingProcurementOverview,
  getFeeSchedules,
  saveFeeSchedule,
  deleteFeeSchedule
} = require('../../controllers/financeController');

const {
  getExpenseOrders,
  getPurchaseExpenses,
  recordPurchaseExpense
} = require('../../controllers/purchaseExpenseController');

const {
  getCashbook,
  saveDailyReconciliation
} = require('../../controllers/cashbookController');

const accountingPeriod = require('../../controllers/accountingPeriodController');
const refunds = require('../../controllers/tuitionRefundController');
const operating = require('../../controllers/operatingExpenseController');
const excelCtrl = require('../../controllers/financeExcelController');
const { getRequestSaasMode, isFinanceAllowed } = require('../utils/saasMode');

// 1. Defense-in-depth: Finance module is strictly allowed in phase1e only
router.use((req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isFinanceAllowed(saasMode)) {
    return next('router');
  }
  next();
});

// 2. Explicitly gate unapproved finance submodules so they fall through to tenantFeatureGate (501)
// Payroll is not yet SaaS-scoped in Phase 1E
const UNAPPROVED_FINANCE_PREFIXES = [
  '/export/payroll'
];

router.use((req, res, next) => {
  if (UNAPPROVED_FINANCE_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
    return next('router');
  }
  next();
});

// 3. Common School Authentication Middleware for all approved endpoints
router.use(schoolAuthMiddleware);

// Multer memory storage for Excel import (max 5MB)
const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.originalname.toLowerCase().endsWith('.xlsx')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ chấp nhận tập tin định dạng Excel (.xlsx)'));
    }
  }
});

const handleUploadExcel = (req, res, next) => {
  uploadExcel.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, message: 'Dung lượng file vượt quá giới hạn cho phép (tối đa 5MB).' });
        }
        return res.status(400).json({ success: false, message: err.message || 'Lỗi tải lên tệp tin.' });
      }
      return res.status(err.statusCode || 400).json({ success: false, message: err.message || 'Lỗi xử lý tệp tin tải lên.' });
    }
    next();
  });
};

// ============================================================================
// 4. APPROVED ENDPOINTS (51 endpoints total)
// ============================================================================

// --- A. Classrooms & Overview (2 endpoints) ---
router.get('/classrooms', roleCheck(['admin', 'principal', 'accountant']), getFinanceClassrooms);
router.get('/procurement-overview', roleCheck(['admin', 'principal', 'accountant']), getAccountingProcurementOverview);

// --- B. Fee Schedules (3 endpoints) ---
router.get('/fee-schedules', roleCheck(['admin', 'principal', 'accountant']), getFeeSchedules);
router.put('/fee-schedules', roleCheck(['admin', 'accountant']), periodOpen.byPeriod, saveFeeSchedule);
router.delete('/fee-schedules/:id', roleCheck(['admin', 'accountant']), periodOpen.bySchedule, deleteFeeSchedule);

// --- C. Invoices & Debts (12 endpoints) ---
// Route tĩnh phải đặt trước route có dynamic param :id
router.post('/tuition/bulk', roleCheck(['admin', 'accountant']), periodOpen.byPeriod, createBulkTuitionFees);
router.post('/tuition/bulk/preview', roleCheck(['admin', 'principal', 'accountant']), previewBulkTuitionFees);
router.post('/tuition/bulk-additional-item', roleCheck(['admin', 'accountant']), periodOpen.byPeriod, addBulkInvoiceItem);
router.post('/tuition', roleCheck(['admin', 'accountant']), periodOpen.byPeriod, createTuitionFee);
router.get('/invoices', roleCheck(['admin', 'principal', 'accountant']), getInvoices);
router.get('/debts', roleCheck(['admin', 'principal', 'accountant']), getDebtReport);
router.post('/debts/remind', roleCheck(['admin', 'accountant']), sendDebtReminders);
router.get('/tuition/student/:studentId', roleCheck(['admin', 'principal', 'accountant', 'parent']), getTuitionByStudent);
router.get('/tuition/class/:classroomId', roleCheck(['admin', 'principal', 'accountant']), getTuitionByClass);
router.put('/tuition/cancel/:id', roleCheck(['admin', 'principal']), periodOpen.byInvoice, cancelTuitionFee);
router.post('/tuition/:id/adjustments', roleCheck(['admin', 'accountant']), periodOpen.byInvoice, adjustTuitionFee);
router.get('/tuition/:id/adjustments', roleCheck(['admin', 'principal', 'accountant', 'parent']), getInvoiceAdjustments);

// --- D. Payments & Receipts (3 endpoints) ---
router.post('/payment', roleCheck(['admin', 'accountant']), periodOpen.currentCashMonth, makePayment);
router.get('/payment/invoice/:invoiceId', roleCheck(['admin', 'principal', 'accountant', 'parent']), getPaymentsByInvoice);
router.get('/receipt/:paymentId', roleCheck(['admin', 'principal', 'accountant', 'parent']), getReceipt);

// --- E. Purchase Expenses (3 endpoints) ---
router.get('/expense-orders', roleCheck(['admin', 'principal', 'accountant']), getExpenseOrders);
router.get('/expenses', roleCheck(['admin', 'principal', 'accountant']), getPurchaseExpenses);
router.post('/expenses', roleCheck(['admin', 'accountant']), periodOpen.byPaidDate, recordPurchaseExpense);

// --- F. Operating Expenses (5 endpoints) ---
router.get('/operating-expenses', roleCheck(['admin', 'principal', 'accountant']), operating.getOperatingExpenses);
router.get('/operating-expense-requests', roleCheck(['admin', 'principal', 'accountant']), operating.listOperatingExpenseRequests);
router.post('/operating-expense-requests', roleCheck(['accountant']), operating.createOperatingExpenseRequest);
router.patch('/operating-expense-requests/:id/review', roleCheck(['admin', 'principal']), operating.reviewOperatingExpenseRequest);
router.post('/operating-expenses', roleCheck(['accountant']), periodOpen.byPaidDate, operating.recordOperatingExpense);

// --- G. Cashbook & Accounting Period (5 endpoints) ---
router.get('/cashbook', roleCheck(['admin', 'principal', 'accountant']), getCashbook);
router.put('/cashbook/reconciliation', roleCheck(['admin', 'accountant']), periodOpen.byWorkDate, saveDailyReconciliation);
router.get('/accounting-period/:month', roleCheck(['admin', 'principal', 'accountant']), accountingPeriod.getPeriod);
router.post('/accounting-period/:month/close', roleCheck(['admin', 'principal']), accountingPeriod.closePeriod);
router.post('/accounting-period/:month/reopen', roleCheck(['admin', 'principal']), accountingPeriod.reopenPeriod);

// --- H. Tuition Refund Requests (4 endpoints - TUYỆT ĐỐI KHÔNG MỞ CHO PARENT) ---
router.get('/refund-requests', roleCheck(['admin', 'principal', 'accountant']), refunds.listRefundRequests);
router.post('/refund-requests', roleCheck(['admin', 'accountant']), refunds.createRefundRequest);
router.patch('/refund-requests/:id/review', roleCheck(['admin', 'principal']), refunds.reviewRefundRequest);
router.post('/refund-requests/:id/pay', roleCheck(['admin', 'accountant']), refunds.payRefundRequest);

// --- I. Excel Export & Import (14 endpoints) ---
// 1. Export (8 endpoints)
router.get('/export/fee-schedules', roleCheck(['admin', 'principal', 'accountant']), excelCtrl.exportFeeSchedules);
router.get('/export/invoices', roleCheck(['admin', 'principal', 'accountant']), excelCtrl.exportInvoices);
router.get('/export/debts', roleCheck(['admin', 'principal', 'accountant']), excelCtrl.exportDebts);
router.get('/export/payments', roleCheck(['admin', 'principal', 'accountant']), excelCtrl.exportPayments);
router.get('/export/expenses', roleCheck(['admin', 'principal', 'accountant']), excelCtrl.exportPurchaseExpenses);
router.get('/export/operating-expenses', roleCheck(['admin', 'principal', 'accountant']), excelCtrl.exportOperatingExpenses);
router.get('/export/cashbook', roleCheck(['admin', 'principal', 'accountant']), excelCtrl.exportCashbook);
router.get('/export/accounting-report', roleCheck(['admin', 'principal', 'accountant']), excelCtrl.exportAccountingReport);

// 2. Import Fee Schedules (3 endpoints)
router.get('/import/fee-schedules/template', roleCheck(['admin', 'accountant']), excelCtrl.getFeeScheduleTemplate);
router.post('/import/fee-schedules/preview', roleCheck(['admin', 'accountant']), handleUploadExcel, excelCtrl.previewFeeScheduleImport);
router.post('/import/fee-schedules/confirm', roleCheck(['admin', 'accountant']), excelCtrl.confirmFeeScheduleImport);

// 3. Import Invoices (3 endpoints)
router.get('/import/invoices/template', roleCheck(['admin', 'accountant']), excelCtrl.getInvoiceTemplate);
router.post('/import/invoices/preview', roleCheck(['admin', 'accountant']), handleUploadExcel, excelCtrl.previewInvoiceImport);
router.post('/import/invoices/confirm', roleCheck(['admin', 'accountant']), excelCtrl.confirmInvoiceImport);

// ============================================================================
// 5. CATCH-ALL: Bất kỳ sub-route nào khác trong /finance đều fall through tới 501
// ============================================================================
router.use((req, res, next) => {
  return next('router');
});

module.exports = router;
