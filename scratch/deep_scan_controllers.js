'use strict';

const fs = require('fs');
const path = require('path');

const controllersDir = path.join(__dirname, '../backend/src/controllers');
const files = fs.readdirSync(controllersDir).filter(f => f.endsWith('.js'));

const targetControllers = [
  'accountingPeriodController.js',
  'accountingReportController.js',
  'attendanceController.js',
  'cashbookController.js',
  'chatController.js',
  'classroomCommunicationController.js',
  'classroomController.js',
  'financeController.js',
  'financeExcelController.js',
  'guardController.js',
  'hrController.js',
  'internalCommunicationController.js',
  'kitchenReconciliationController.js',
  'kitchenSafetyController.js',
  'mealServingController.js',
  'notificationController.js',
  'nutritionController.js',
  'operatingExpenseController.js',
  'parentFeedbackController.js',
  'pickupController.js',
  'procurementController.js',
  'purchaseExpenseController.js',
  'reportController.js',
  'staffingController.js',
  'studentController.js',
  'studentProfileChangeRequestController.js',
  'systemUserController.js',
  'timekeepingController.js',
  'tuitionRefundController.js'
];

targetControllers.forEach(filename => {
  const filePath = path.join(controllersDir, filename);
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  const suspicious = [];
  lines.forEach((line, idx) => {
    const l = line.trim();
    // Check find, findOne, findById, aggregate, countDocuments
    if (
      /\b[A-Z][a-zA-Z0-9]+\.(find|findOne|findById|findByIdAndUpdate|findByIdAndDelete|findOneAndUpdate|findOneAndDelete|aggregate|countDocuments)\(/.test(l)
    ) {
      // If it doesn't mention tenantFilter, tenantId, or $match with tenant
      if (!l.includes('tenantFilter') && !l.includes('tenantId') && !l.includes('FAIL_CLOSED_FILTER')) {
        suspicious.push({ lineNum: idx + 1, text: l });
      }
    }
  });

  if (suspicious.length > 0) {
    console.log(`\n[${filename}] found ${suspicious.length} calls without direct tenant reference:`);
    suspicious.forEach(s => {
      console.log(`  L${s.lineNum}: ${s.text.slice(0, 120)}`);
    });
  }
});
