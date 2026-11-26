const express = require('express');
const router = express.Router();
const schoolAuthMiddleware = require('../middlewares/schoolAuthMiddleware');
const roleCheck = require('../../middlewares/roleCheck');
const hrAccessAudit = require('../../middlewares/hrAccessAudit');
const hrController = require('../../controllers/hrController');
const hrAuditController = require('../../controllers/hrAuditController');
const staffingController = require('../../controllers/staffingController');
const internalCommunicationController = require('../../controllers/internalCommunicationController');
const financeExcelController = require('../../controllers/financeExcelController');
const accountingPeriodOpen = require('../../middlewares/accountingPeriodOpen');
const { getRequestSaasMode, isHrAllowed, isFinanceAllowed } = require('../utils/saasMode');

// Defense-in-depth: HR module is strictly allowed in phase1d only
router.use((req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isHrAllowed(saasMode)) {
    return next('router');
  }
  next();
});

// Explicitly gate unapproved HR submodules so they cleanly fall through to tenantFeatureGate (501)
const UNAPPROVED_HR_PREFIXES = [
  '/personal-requests',
  '/credentials',
  '/development',
  '/handover',
  '/handovers',
  '/reports'
];

router.use((req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isFinanceAllowed(saasMode)) {
    if (
      req.path.startsWith('/payroll')
      || req.path.startsWith('/my-payroll')
      || req.path.startsWith('/internal')
      || req.path.startsWith('/audit')
    ) {
      return next('router');
    }
  }
  if (UNAPPROVED_HR_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
    return next('router');
  }
  next();
});

// Retired recruitment and onboarding endpoints (HTTP 410 Gone)
const retiredRecruitmentHandler = (req, res) => {
  return res.status(410).json({
    success: false,
    message: 'Chức năng tuyển dụng và tiếp nhận nhân sự đã chính thức ngừng hoạt động theo quy định của nhà trường.'
  });
};
router.use('/recruitment', retiredRecruitmentHandler);
router.retiredRecruitmentHandler = retiredRecruitmentHandler;

// Common middleware chain: School auth -> HR access audit
router.use(schoolAuthMiddleware);
router.use(hrAccessAudit('hr'));

// 1. Departments (3 endpoints)
router.get('/departments', roleCheck(['admin', 'principal', 'accountant', 'hr']), hrController.getDepartments);
router.post('/departments', roleCheck(['admin']), hrController.createDepartment);
router.put('/departments/:id', roleCheck(['admin']), hrController.updateDepartment);

// 2. Staff Accounts (2 endpoints)
router.get('/staff-accounts', roleCheck(['admin', 'principal', 'hr']), hrController.getStaffAccounts);
router.post('/staff-accounts/sync', roleCheck(['admin', 'hr']), hrController.syncStaffAccounts);

// 3. Employees (6 endpoints)
router.get('/employees', roleCheck(['admin', 'principal', 'accountant', 'hr']), hrController.getEmployees);
router.get('/employees/:id/history', roleCheck(['admin', 'principal', 'hr']), hrController.getEmployeeHistory);
router.get('/employees/:id', roleCheck(['admin', 'principal', 'accountant', 'hr']), hrController.getEmployeeById);
router.post('/employees', roleCheck(['admin', 'hr']), hrController.createEmployee);
router.put('/employees/:id', roleCheck(['admin', 'hr']), hrController.updateEmployee);
router.delete('/employees/:id', roleCheck(['admin', 'hr']), hrController.deleteEmployee);

// 4. Staffing & Shifts (8 endpoints)
router.get('/staffing/timetable', roleCheck(['admin', 'principal', 'hr']), staffingController.getTimetable);
router.get('/staffing', roleCheck(['admin', 'principal', 'hr']), staffingController.getStaffing);
router.get('/my-staffing', roleCheck(['admin', 'principal', 'teacher', 'chef', 'guard', 'accountant', 'hr']), staffingController.getMyStaffing);
router.put('/staffing/classrooms/:id', roleCheck(['admin', 'hr']), staffingController.assignClassroomStaff);
router.post('/staffing/shifts', roleCheck(['admin', 'hr']), staffingController.createShift);
router.delete('/staffing/shifts/:id', roleCheck(['admin', 'hr']), staffingController.cancelShift);
router.post('/staffing/replacements', roleCheck(['admin', 'hr']), staffingController.createReplacement);
router.delete('/staffing/replacements/:id', roleCheck(['admin', 'hr']), staffingController.cancelReplacement);

// 5. Leave Requests (5 endpoints)
router.post('/leave-requests', roleCheck(['admin', 'teacher', 'accountant', 'chef', 'guard', 'hr']), hrController.createLeaveRequest);
router.get('/my-leave-requests', roleCheck(['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard', 'hr']), hrController.getMyLeaveRequests);
router.get('/leave-requests/overview', roleCheck(['admin', 'principal', 'hr']), hrController.getLeaveOverview);
router.get('/leave-requests', roleCheck(['admin', 'principal', 'hr']), hrController.getLeaveRequests);
router.patch('/leave-requests/:id/review', roleCheck(['admin', 'principal']), hrController.processLeaveRequest);

// 6. Payroll (7 endpoints)
router.post('/payroll/generate', roleCheck(['admin', 'hr']), accountingPeriodOpen.byPayrollBody, hrController.generateMonthlyPayroll);
router.get('/my-payroll', roleCheck(['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard', 'hr']), hrController.getMyPayroll);
router.get('/payroll/export', roleCheck(['admin', 'principal', 'accountant', 'hr']), financeExcelController.exportPayroll);
router.get('/payroll', roleCheck(['admin', 'principal', 'accountant', 'hr']), hrController.getPayrollByMonth);
router.patch('/payroll/:id/status', roleCheck(['admin', 'principal', 'accountant']), accountingPeriodOpen.byPayroll, accountingPeriodOpen.byPayrollPaidDate, hrController.updatePayrollStatus);
router.patch('/payroll/:id/reopen', roleCheck(['admin', 'principal']), accountingPeriodOpen.byPayroll, hrController.reopenConfirmedPayroll);
router.patch('/payroll/:id/adjustments', roleCheck(['admin', 'accountant']), accountingPeriodOpen.byPayroll, hrController.updatePayrollAdjustment);

// 7. Internal Communication / Staff Notices & Timesheets (7 endpoints)
router.get('/internal', roleCheck(['admin', 'principal', 'hr']), internalCommunicationController.overview);
router.post('/internal/announcements', roleCheck(['admin', 'principal', 'hr']), internalCommunicationController.sendAnnouncement);
router.get('/internal/announcements/:id/receipts', roleCheck(['admin', 'principal', 'hr']), internalCommunicationController.getAnnouncementReceipts);
router.get('/internal/my-announcements', roleCheck(['admin', 'principal', 'hr', 'teacher', 'accountant', 'chef', 'guard']), internalCommunicationController.myAnnouncements);
router.post('/internal/timesheets', roleCheck(['admin', 'hr']), internalCommunicationController.publishTimesheet);
router.get('/internal/my-timesheets', roleCheck(['admin', 'principal', 'hr', 'teacher', 'accountant', 'chef', 'guard']), internalCommunicationController.myTimesheets);
router.patch('/internal/timesheets/:id/respond', roleCheck(['admin', 'hr', 'teacher', 'accountant', 'chef', 'guard']), internalCommunicationController.respondTimesheet);

// 8. HR Access & Change Audit Journal (Tenant-scoped in controller)
router.get('/audit/options', roleCheck(['admin', 'principal', 'hr', 'accountant']), hrAuditController.options);
router.get('/audit', roleCheck(['admin', 'principal', 'hr', 'accountant']), hrAuditController.list);
router.get('/audit/:source/:id', roleCheck(['admin', 'principal', 'hr', 'accountant']), hrAuditController.detail);

// Catch-all: Any unhandled sub-route in /hr falls through to tenantFeatureGate (501)
router.use((req, res, next) => {
  return next('router');
});

module.exports = router;
