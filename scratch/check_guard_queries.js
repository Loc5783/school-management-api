'use strict';

const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, '../backend/src/controllers/guardController.js'), 'utf8');

// Check model queries in guardController:
const models = [
  'StudentGateEvent',
  'SchoolVisitor',
  'SecurityIncident',
  'GuardShiftHandover',
  'PickupOtpChallenge',
  'SupplierDelivery',
  'GuardEmergencyMode',
  'Student',
  'PickupRecord',
  'User',
  'Notification',
  'PurchaseOrder'
];

const lines = content.split('\n');
models.forEach(model => {
  const matches = [];
  lines.forEach((line, idx) => {
    const regex = new RegExp(`\\b${model}\\.(find|findOne|findById|create|aggregate|countDocuments|exists|updateOne|findOneAndUpdate|findByIdAndUpdate)\\b`);
    if (regex.test(line)) {
      matches.push({ lineNum: idx + 1, text: line.trim() });
    }
  });
  console.log(`\n=== Model: ${model} (${matches.length} calls) ===`);
  matches.forEach(m => console.log(`  L${m.lineNum}: ${m.text}`));
});
