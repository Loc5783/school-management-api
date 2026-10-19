const express = require('express');
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
} = require('../controllers/financeController');
const auth = require('../middlewares/auth');
const roleCheck = require('../middlewares/roleCheck');
const { getExpenseOrders, getPurchaseExpenses, recordPurchaseExpense } = require('../controllers/purchaseExpenseController');
const { getCashbook, saveDailyReconciliation } = require('../controllers/cashbookController');
const periodOpen = require('../middlewares/accountingPeriodOpen');
const accountingPeriod = require('../controllers/accountingPeriodController');
const refunds = require('../controllers/tuitionRefundController');
const operating = require('../controllers/operatingExpenseController');

const router = express.Router();

router.use(auth);
router.get('/classrooms', roleCheck(['admin', 'principal', 'accountant']), getFinanceClassrooms);
router.get('/procurement-overview', roleCheck(['admin', 'principal', 'accountant']), getAccountingProcurementOverview);
router.get('/expense-orders', roleCheck(['admin', 'principal', 'accountant']), getExpenseOrders);
router.get('/expenses', roleCheck(['admin', 'principal', 'accountant']), getPurchaseExpenses);
router.post('/expenses', roleCheck(['admin', 'accountant']), periodOpen.byPaidDate, recordPurchaseExpense);
router.get('/operating-expenses', roleCheck(['admin', 'principal', 'accountant']), operating.getOperatingExpenses);
router.get('/operating-expense-requests', roleCheck(['admin', 'principal', 'accountant']), operating.listOperatingExpenseRequests);
router.post('/operating-expense-requests', roleCheck(['accountant']), operating.createOperatingExpenseRequest);
router.patch('/operating-expense-requests/:id/review', roleCheck(['admin', 'principal']), operating.reviewOperatingExpenseRequest);
router.post('/operating-expenses', roleCheck(['accountant']), periodOpen.byPaidDate, operating.recordOperatingExpense);
router.get('/cashbook', roleCheck(['admin', 'principal', 'accountant']), getCashbook);
router.put('/cashbook/reconciliation', roleCheck(['admin', 'accountant']), periodOpen.byWorkDate, saveDailyReconciliation);
router.get('/accounting-period/:month', roleCheck(['admin', 'principal', 'accountant']), accountingPeriod.getPeriod);
router.post('/accounting-period/:month/close', roleCheck(['admin', 'principal']), accountingPeriod.closePeriod);
router.post('/accounting-period/:month/reopen', roleCheck(['admin', 'principal']), accountingPeriod.reopenPeriod);
router.get('/refund-requests', roleCheck(['admin', 'principal', 'accountant']), refunds.listRefundRequests);
router.post('/refund-requests', roleCheck(['accountant']), refunds.createRefundRequest);
router.patch('/refund-requests/:id/review', roleCheck(['admin', 'principal']), refunds.reviewRefundRequest);
router.post('/refund-requests/:id/pay', roleCheck(['accountant']), refunds.payRefundRequest);
router.get('/fee-schedules', roleCheck(['admin', 'principal', 'accountant']), getFeeSchedules);
router.put('/fee-schedules', roleCheck(['admin', 'accountant']), periodOpen.byPeriod, saveFeeSchedule);
router.delete('/fee-schedules/:id', roleCheck(['admin', 'accountant']), periodOpen.bySchedule, deleteFeeSchedule);

// Hóa đơn
router.post('/tuition', roleCheck(['admin', 'accountant']), periodOpen.byPeriod, createTuitionFee);
router.post('/tuition/bulk', roleCheck(['admin', 'accountant']), periodOpen.byPeriod, createBulkTuitionFees);
router.post('/tuition/bulk/preview', roleCheck(['admin', 'principal', 'accountant']), previewBulkTuitionFees);
router.get('/invoices', roleCheck(['admin', 'principal', 'accountant']), getInvoices);
router.get('/debts', roleCheck(['admin', 'principal', 'accountant']), getDebtReport);
router.post('/debts/remind', roleCheck(['admin', 'accountant']), sendDebtReminders);
router.get('/tuition/student/:studentId', roleCheck(['admin', 'principal', 'accountant', 'parent']), getTuitionByStudent);
router.get('/tuition/class/:classroomId', roleCheck(['admin', 'principal', 'accountant']), getTuitionByClass);
router.put('/tuition/cancel/:id', roleCheck(['admin']), periodOpen.byInvoice, cancelTuitionFee);
router.post('/tuition/:id/adjustments', roleCheck(['admin', 'accountant']), periodOpen.byInvoice, adjustTuitionFee);
router.post('/tuition/bulk-additional-item', roleCheck(['admin', 'accountant']), periodOpen.byPeriod, addBulkInvoiceItem);
router.get('/tuition/:id/adjustments', roleCheck(['admin', 'principal', 'accountant', 'parent']), getInvoiceAdjustments);

// Thanh toán
router.post('/payment', roleCheck(['admin', 'accountant']), periodOpen.currentCashMonth, makePayment);
router.get('/payment/invoice/:invoiceId', roleCheck(['admin', 'principal', 'accountant', 'parent']), getPaymentsByInvoice);
router.get('/receipt/:paymentId', roleCheck(['admin', 'principal', 'accountant', 'parent']), getReceipt);

module.exports = router;
