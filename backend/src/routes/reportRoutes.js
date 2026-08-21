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
router.get('/dashboard', getDashboardStats);
router.get('/class/:classroomId', getClassReport);
router.get('/finance', getFinanceReport);

// Quản lý báo cáo lưu
router.post('/', roleCheck(['admin', 'principal', 'accountant']), saveReport);
router.get('/', getReports);
router.get('/:id', getReportById);
router.put('/publish/:id', roleCheck(['admin', 'principal']), publishReport);

module.exports = router;