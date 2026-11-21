const express = require('express');
const schoolAuthMiddleware = require('../middlewares/schoolAuthMiddleware');
const roleCheck = require('../../middlewares/roleCheck');
const { getRequestSaasMode, isFinanceAllowed } = require('../utils/saasMode');
const { getPrincipalWork } = require('../../controllers/principalWorkController');
const { getPrincipalDecisions } = require('../../controllers/principalDecisionController');
const { getPrincipalAlerts } = require('../../controllers/principalAlertsController');
const { createTask, getTasks, updateTaskStatus, getDepartmentStaff } = require('../../controllers/principalTaskController');
const { getDashboardStats } = require('../../controllers/reportController');
const { getClassQualityReport } = require('../../controllers/classQualityController');

const router = express.Router();
router.use((req, res, next) => isFinanceAllowed(getRequestSaasMode(req)) ? next() : next('router'));
router.use(schoolAuthMiddleware);

router.get('/dashboard', roleCheck(['principal', 'admin', 'teacher']), getDashboardStats);
router.get('/class-quality', roleCheck(['principal', 'admin']), getClassQualityReport);
router.get('/principal-work', roleCheck(['principal', 'admin']), getPrincipalWork);
router.get('/principal-decisions', roleCheck(['principal', 'admin']), getPrincipalDecisions);
router.get('/principal-alerts', roleCheck(['principal', 'admin']), getPrincipalAlerts);
router.get('/principal-tasks/staff', roleCheck(['principal', 'admin']), getDepartmentStaff);
router.get('/principal-tasks', roleCheck(['principal', 'admin', 'hr', 'accountant', 'chef', 'guard', 'teacher']), getTasks);
router.post('/principal-tasks', roleCheck(['principal', 'admin']), createTask);
router.patch('/principal-tasks/:id/status', roleCheck(['principal', 'admin', 'hr', 'accountant', 'chef', 'guard', 'teacher']), updateTaskStatus);
router.use((req, res, next) => next('router'));

module.exports = router;
