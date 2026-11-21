'use strict';

const path = require('path');
process.env.NODE_PATH = path.join(__dirname, '../backend/node_modules');
require('module').Module._initPaths();

const models = [
  '../backend/src/models/zone1_system/Tenant',
  '../backend/src/models/zone1_system/User',
  '../backend/src/models/zone1_system/Notification',
  '../backend/src/models/zone1_system/Conversation',
  '../backend/src/models/zone1_system/ChatMessage',
  '../backend/src/models/zone2_hr/Department',
  '../backend/src/models/zone2_hr/Employee',
  '../backend/src/models/zone2_hr/StaffShift',
  '../backend/src/models/zone2_hr/Payroll',
  '../backend/src/models/zone2_hr/InternalAnnouncement',
  '../backend/src/models/zone3_school/Classroom',
  '../backend/src/models/zone3_school/Student',
  '../backend/src/models/zone3_school/ClassroomAnnouncement',
  '../backend/src/models/zone3_school/ClassroomDailyCareReport',
  '../backend/src/models/zone3_school/StudentAttendance',
  '../backend/src/models/zone3_school/StudentLeaveRequest',
  '../backend/src/models/zone3_school/PickupRecord',
  '../backend/src/models/zone3_school/StudentGateEvent',
  '../backend/src/models/zone3_school/SchoolVisitor',
  '../backend/src/models/zone3_school/SecurityIncident',
  '../backend/src/models/zone3_school/GuardShiftHandover',
  '../backend/src/models/zone3_school/SupplierDelivery',
  '../backend/src/models/zone3_school/GuardEmergencyMode',
  '../backend/src/models/zone3_school/ParentFeedback',
  '../backend/src/models/zone3_school/StudentProfileChangeRequest',
  '../backend/src/models/zone4_finance/FeeSchedule',
  '../backend/src/models/zone4_finance/TuitionFee',
  '../backend/src/models/zone4_finance/Payment',
  '../backend/src/models/zone4_finance/OperatingExpense',
  '../backend/src/models/zone4_finance/PurchaseExpense',
  '../backend/src/models/zone4_finance/TuitionRefundRequest',
  '../backend/src/models/zone5_nutrition/Supplier',
  '../backend/src/models/zone5_nutrition/Dish',
  '../backend/src/models/zone5_nutrition/IngredientMaster',
  '../backend/src/models/zone5_nutrition/Menu',
  '../backend/src/models/zone5_nutrition/FoodSample',
  '../backend/src/models/zone5_nutrition/Inventory',
  '../backend/src/models/zone5_nutrition/MealServing',
  '../backend/src/models/zone6_procurement/ItemMaster',
  '../backend/src/models/zone6_procurement/ProcurementRequest',
  '../backend/src/models/zone6_procurement/PurchaseOrder',
  '../backend/src/models/zone6_procurement/Asset'
];

models.forEach(mPath => {
  const M = require(mPath);
  const required = [];
  M.schema.eachPath((pathname, schematype) => {
    if (schematype.isRequired) required.push(pathname);
  });
  console.log(`${M.modelName}: required fields = [${required.join(', ')}]`);
});
