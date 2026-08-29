const express = require('express');
const {
    getDashboardStats,
    getClassReport,
    getFinanceReport,
    saveReport,
    getReports,
    getReportById,
    publishReport
} = require('../controllers/reportController');
const auth = require('../middlewares/auth');
const roleCheck = require('../middlewares/roleCheck');

const router = express.Router();

router.use(auth);

// Báo cáo thống kê
router.get('/dashboard', roleCheck(['admin', 'principal']), getDashboardStats);
router.get('/class/:classroomId', roleCheck(['admin', 'principal', 'teacher']), getClassReport);
router.get('/finance', roleCheck(['admin', 'principal', 'accountant']), getFinanceReport);

// Quản lý báo cáo lưu
router.post('/', roleCheck(['admin', 'principal', 'accountant']), saveReport);
router.get('/', roleCheck(['admin', 'principal', 'accountant']), getReports);
router.get('/:id', roleCheck(['admin', 'principal', 'accountant']), getReportById);
router.put('/publish/:id', roleCheck(['admin', 'principal']), publishReport);

module.exports = router;
