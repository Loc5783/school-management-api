const express = require('express');
const {
    createTuitionFee,
    createBulkTuitionFees,
    makePayment,
    getTuitionByStudent,
    getTuitionByClass,
    getPaymentsByInvoice,
    cancelTuitionFee
} = require('../controllers/financeController');
const auth = require('../middlewares/auth');
const roleCheck = require('../middlewares/roleCheck');

const router = express.Router();

router.use(auth);

// Hóa đơn
router.post('/tuition', roleCheck(['admin', 'principal', 'accountant']), createTuitionFee);
router.post('/tuition/bulk', roleCheck(['admin', 'principal', 'accountant']), createBulkTuitionFees);
router.get('/tuition/student/:studentId', getTuitionByStudent);
router.get('/tuition/class/:classroomId', getTuitionByClass);
router.put('/tuition/cancel/:id', roleCheck(['admin', 'principal']), cancelTuitionFee);

// Thanh toán
router.post('/payment', roleCheck(['admin', 'principal', 'accountant']), makePayment);
router.get('/payment/invoice/:invoiceId', getPaymentsByInvoice);

module.exports = router;