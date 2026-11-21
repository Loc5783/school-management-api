'use strict';

const path = require('path');
process.env.NODE_PATH = path.join(__dirname, '../backend/node_modules');
require('module').Module._initPaths();

const modules = [
  { moduleName: 'Auth', prefix: '/api/auth', r: require('../backend/src/saas/routes/schoolAuthRoutes') },
  { moduleName: 'Classrooms', prefix: '/api/classrooms', r: require('../backend/src/saas/routes/schoolClassroomRoutes') },
  { moduleName: 'Students', prefix: '/api/students', r: require('../backend/src/saas/routes/schoolStudentRoutes') },
  { moduleName: 'Attendance', prefix: '/api/attendance', r: require('../backend/src/saas/routes/schoolAttendanceRoutes') },
  { moduleName: 'System / Accounts', prefix: '/api/system', r: require('../backend/src/saas/routes/schoolSystemUserRoutes') },
  { moduleName: 'HR & Staffing', prefix: '/api/hr', r: require('../backend/src/saas/routes/schoolHrRoutes') },
  { moduleName: 'Timekeeping', prefix: '/api/timekeeping', r: require('../backend/src/saas/routes/schoolTimekeepingRoutes') },
  { moduleName: 'Finance', prefix: '/api/finance', r: require('../backend/src/saas/routes/schoolFinanceRoutes') },
  { moduleName: 'Reports', prefix: '/api/reports', r: require('../backend/src/saas/routes/schoolReportRoutes') },
  { moduleName: 'Nutrition (Kitchen)', prefix: '/api/nutrition', r: require('../backend/src/saas/routes/schoolNutritionRoutes') },
  { moduleName: 'Notifications', prefix: '/api/notifications', r: require('../backend/src/saas/routes/schoolNotificationRoutes') },
  { moduleName: 'Chat', prefix: '/api/chat', r: require('../backend/src/saas/routes/schoolChatRoutes') },
  { moduleName: 'Class Communication', prefix: '/api/class-communication', r: require('../backend/src/saas/routes/schoolClassroomCommunicationRoutes') },
  { moduleName: 'Pickups', prefix: '/api/pickups', r: require('../backend/src/saas/routes/schoolPickupRoutes') },
  { moduleName: 'Guard', prefix: '/api/guard', r: require('../backend/src/saas/routes/schoolGuardRoutes') },
  { moduleName: 'Procurement', prefix: '/api/procurement', r: require('../backend/src/saas/routes/schoolProcurementRoutes') },
  { moduleName: 'Parent Feedback', prefix: '/api/parent-feedback', r: require('../backend/src/saas/routes/schoolParentFeedbackRoutes') },
  { moduleName: 'Student Profile Requests', prefix: '/api/student-profile-change-requests', r: require('../backend/src/saas/routes/schoolStudentProfileChangeRequestRoutes') }
];

const results = [];
modules.forEach(({ moduleName, prefix, r }) => {
  if (!r.stack) return;
  r.stack.forEach(layer => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase()).join(',');
      results.push({
        moduleName,
        method: methods,
        path: `${prefix}${layer.route.path}`
      });
    }
  });
});

console.log(`Total SaaS endpoints registered: ${results.length}`);
results.forEach(item => {
  console.log(`[${item.moduleName}] ${item.method.padEnd(7)} ${item.path}`);
});
