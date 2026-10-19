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
const { getAccountingReport } = require('../controllers/accountingReportController');
const { getPrincipalWork } = require('../controllers/principalWorkController');
const { getPrincipalDecisions } = require('../controllers/principalDecisionController');
const { getPrincipalAlerts } = require('../controllers/principalAlertsController');
const { createTask, getTasks, updateTaskStatus, getDepartmentStaff } = require('../controllers/principalTaskController');
const { getClassQualityReport } = require('../controllers/classQualityController');

const router = express.Router();

router.use(auth);

// Báo cáo thống kê
router.get('/dashboard', roleCheck(['admin', 'principal', 'teacher']), getDashboardStats);
router.get('/principal-work', roleCheck(['principal', 'admin']), getPrincipalWork);
router.get('/principal-decisions', roleCheck(['principal', 'admin']), getPrincipalDecisions);
router.get('/principal-alerts', roleCheck(['principal', 'admin']), getPrincipalAlerts);
router.get('/principal-tasks/staff', roleCheck(['principal', 'admin']), getDepartmentStaff);
router.get('/principal-tasks', roleCheck(['principal', 'admin', 'hr', 'accountant', 'chef', 'guard', 'teacher']), getTasks);
router.post('/principal-tasks', roleCheck(['principal', 'admin']), createTask);
router.patch('/principal-tasks/:id/status', roleCheck(['principal', 'admin', 'hr', 'accountant', 'chef', 'guard', 'teacher']), updateTaskStatus);
router.get('/class-quality', roleCheck(['admin', 'principal']), getClassQualityReport);
router.get('/class/:classroomId', roleCheck(['admin', 'principal', 'teacher']), getClassReport);
router.get('/finance', roleCheck(['admin', 'principal', 'accountant']), getFinanceReport);
router.get('/accounting-summary', roleCheck(['admin', 'principal', 'accountant']), getAccountingReport);

// Quản lý báo cáo lưu
router.post('/', roleCheck(['admin', 'principal', 'accountant']), saveReport);
router.get('/', roleCheck(['admin', 'principal', 'accountant']), getReports);
router.get('/:id', roleCheck(['admin', 'principal', 'accountant']), getReportById);
router.put('/publish/:id', roleCheck(['admin', 'principal']), publishReport);

module.exports = router;
