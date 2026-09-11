const express = require('express');
const {
    createTuitionFee,
    createBulkTuitionFees,
    makePayment,
    getTuitionByStudent,
    getTuitionByClass,
    getInvoices,
    getDebtReport,
    getPaymentsByInvoice,
    getReceipt,
    cancelTuitionFee
} = require('../controllers/financeController');
const auth = require('../middlewares/auth');
const roleCheck = require('../middlewares/roleCheck');

const router = express.Router();

router.use(auth);

// Hóa đơn
router.post('/tuition', roleCheck(['admin', 'principal', 'accountant']), createTuitionFee);
router.post('/tuition/bulk', roleCheck(['admin', 'principal', 'accountant']), createBulkTuitionFees);
router.get('/invoices', roleCheck(['admin', 'principal', 'accountant']), getInvoices);
router.get('/debts', roleCheck(['admin', 'principal', 'accountant']), getDebtReport);
router.get('/tuition/student/:studentId', roleCheck(['admin', 'principal', 'accountant', 'parent']), getTuitionByStudent);
router.get('/tuition/class/:classroomId', roleCheck(['admin', 'principal', 'accountant']), getTuitionByClass);
router.put('/tuition/cancel/:id', roleCheck(['admin', 'principal']), cancelTuitionFee);

// Thanh toán
router.post('/payment', roleCheck(['admin', 'principal', 'accountant']), makePayment);
router.get('/payment/invoice/:invoiceId', roleCheck(['admin', 'principal', 'accountant', 'parent']), getPaymentsByInvoice);
router.get('/receipt/:paymentId', roleCheck(['admin', 'principal', 'accountant', 'parent']), getReceipt);

module.exports = router;
