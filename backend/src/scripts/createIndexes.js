const mongoose = require('mongoose');
require('dotenv').config();

// Some domain files are scaffolds and do not export a Mongoose model yet.
// Keep this script usable while the rest of the project is implemented.
const models = {
  User: require('../models/zone1_system/User'),
  AuditLog: require('../models/zone1_system/AuditLog'),
  Notification: require('../models/zone1_system/Notification'),
  SystemConfig: require('../models/zone1_system/SystemConfig'),
  OutboxEvent: require('../models/zone1_system/OutboxEvent'),
  Department: require('../models/zone2_hr/Department'),
  Employee: require('../models/zone2_hr/Employee'),
  AttendanceRecord: require('../models/zone2_hr/AttendanceRecord'),
  LeaveRequest: require('../models/zone2_hr/LeaveRequest'),
  OvertimeRequest: require('../models/zone2_hr/OvertimeRequest'),
  Payroll: require('../models/zone2_hr/Payroll'),
  AdvancePayment: require('../models/zone2_hr/AdvancePayment'),
  DisciplineRecord: require('../models/zone2_hr/DisciplineRecord'),
  RawAttendance: require('../models/zone2_hr/RawAttendance'),
  RawAttendanceEvent: require('../models/zone2_hr/RawAttendanceEvent'),
  TimekeepingCorrectionRequest: require('../models/zone2_hr/TimekeepingCorrectionRequest'),
  AttendanceAuditLog: require('../models/zone2_hr/AttendanceAuditLog'),
  AttendanceRecalculationQueue: require('../models/zone2_hr/AttendanceRecalculationQueue'),
  AttendanceJobLock: require('../models/zone2_hr/AttendanceJobLock'),
  AttendanceCalculationRun: require('../models/zone2_hr/AttendanceCalculationRun'),
  Classroom: require('../models/zone3_school/Classroom'),
  Student: require('../models/zone3_school/Student'),
  StudentAttendance: require('../models/zone3_school/StudentAttendance'),
  HealthRecord: require('../models/zone3_school/HealthRecord'),
  AcademicReport: require('../models/zone3_school/AcademicReport'),
  DailyReport: require('../models/zone3_school/DailyReport'),
  Incident: require('../models/zone3_school/Incident'),
  EntryExitLog: require('../models/zone3_school/EntryExitLog'),
  AuthorizedPicker: require('../models/zone3_school/AuthorizedPicker'),
  TuitionFee: require('../models/zone4_finance/TuitionFee'),
  Payment: require('../models/zone4_finance/Payment'),
  Debt: require('../models/zone4_finance/Debt'),
  ClassFund: require('../models/zone4_finance/ClassFund'),
  FundTransaction: require('../models/zone4_finance/FundTransaction'),
  Invoice: require('../models/zone4_finance/Invoice'),
  InvoiceDetail: require('../models/zone4_finance/InvoiceDetail'),
  IngredientMaster: require('../models/zone5_nutrition/IngredientMaster'),
  Menu: require('../models/zone5_nutrition/Menu'),
  MenuIngredient: require('../models/zone5_nutrition/MenuIngredient'),
  KitchenRequest: require('../models/zone5_nutrition/KitchenRequest'),
  Inventory: require('../models/zone5_nutrition/Inventory'),
  InventoryTransaction: require('../models/zone5_nutrition/InventoryTransaction'),
  Supplier: require('../models/zone5_nutrition/Supplier'),
  FoodSample: require('../models/zone5_nutrition/FoodSample'),
  ItemMaster: require('../models/zone6_procurement/ItemMaster'),
  ProcurementRequest: require('../models/zone6_procurement/ProcurementRequest'),
  PurchaseOrder: require('../models/zone6_procurement/PurchaseOrder'),
  PurchaseOrderDetail: require('../models/zone6_procurement/PurchaseOrderDetail'),
  Asset: require('../models/zone6_procurement/Asset'),
  AssetMaintenance: require('../models/zone6_procurement/AssetMaintenance'),
  AssetLiquidation: require('../models/zone6_procurement/AssetLiquidation'),
  Report: require('../models/zone7_reporting/Report')
};

const specs = [
  ['User', { username: 1 }, { unique: true }],
  ['User', { 'employeeInfo.employeeId': 1 }, { unique: true, sparse: true }],
  ['AuditLog', { userId: 1, timestamp: -1 }],
  ['Notification', { senderId: 1, sentAt: -1 }],
  ['SystemConfig', { configKey: 1 }, { unique: true }],
  ['OutboxEvent', { status: 1, createdAt: 1 }],
  ['Department', { name: 1 }, { unique: true }],
  ['Employee', { userId: 1 }, { unique: true }],
  ['Employee', { departmentId: 1 }],
  ['AttendanceRecord', { userId: 1, workDate: 1 }, { unique: true }],
  ['AttendanceRecord', { workDate: 1, finalized: 1 }],
  ['LeaveRequest', { employeeId: 1, startDate: 1 }],
  ['OvertimeRequest', { employeeId: 1, workDate: 1 }],
  ['Payroll', { employeeId: 1, period: 1 }],
  ['AdvancePayment', { employeeId: 1, requestDate: 1 }],
  ['DisciplineRecord', { employeeId: 1 }],
  ['RawAttendance', { userId: 1, workDate: 1 }, { unique: true }],
  ['RawAttendanceEvent', { deviceId: 1, externalEventId: 1 }, { unique: true }],
  ['RawAttendanceEvent', { userId: 1, occurredAt: 1 }],
  ['RawAttendanceEvent', { userId: 1, workDate: 1 }],
  ['TimekeepingCorrectionRequest', { userId: 1, workDate: 1, status: 1 }],
  ['TimekeepingCorrectionRequest', { status: 1, workDate: 1 }],
  ['TimekeepingCorrectionRequest', { userId: 1, workDate: 1, adjustmentType: 1 }, {
    unique: true,
    partialFilterExpression: { isActive: true }
  }],
  ['AttendanceAuditLog', { entityId: 1 }],
  ['AttendanceAuditLog', { actor: 1 }],
  ['AttendanceAuditLog', { timestamp: -1 }],
  ['AttendanceRecalculationQueue', { userId: 1, workDate: 1 }, { unique: true }],
  ['AttendanceRecalculationQueue', { status: 1, nextAttemptAt: 1, lockedUntil: 1 }],
  ['AttendanceJobLock', { key: 1 }, { unique: true }],
  ['AttendanceJobLock', { lockedUntil: 1 }, { expireAfterSeconds: 0 }],
  ['AttendanceCalculationRun', { jobType: 1, workDate: 1, startedAt: -1 }],
  ['Classroom', { name: 1, schoolYear: 1 }],
  ['Student', { classroomId: 1, status: 1 }],
  ['Student', { fullName: 'text' }],
  ['StudentAttendance', { studentId: 1, attendDate: 1 }],
  ['StudentAttendance', { studentId: 1, attendanceDateKey: 1 }, {
    unique: true,
    partialFilterExpression: { attendanceDateKey: { $exists: true } }
  }],
  ['StudentAttendance', { classroomId: 1, attendDate: 1 }],
  ['HealthRecord', { studentId: 1, recordDate: 1 }],
  ['AcademicReport', { studentId: 1, semester: 1 }],
  ['DailyReport', { studentId: 1, reportDate: 1 }],
  ['Incident', { studentId: 1, incidentDate: 1 }],
  ['EntryExitLog', { studentId: 1, entryTime: 1 }],
  ['AuthorizedPicker', { studentId: 1 }],
  ['TuitionFee', { studentId: 1, period: 1 }],
  ['TuitionFee', { classroomId: 1, period: 1 }],
  ['Payment', { invoiceId: 1 }],
  ['Debt', { studentId: 1 }],
  ['ClassFund', { classroomId: 1 }],
  ['FundTransaction', { classFundId: 1 }],
  ['Invoice', { studentId: 1 }],
  ['InvoiceDetail', { invoiceId: 1 }],
  ['IngredientMaster', { name: 1 }],
  ['Menu', { weekStart: 1, ageGroup: 1 }],
  ['MenuIngredient', { menuId: 1 }],
  ['KitchenRequest', { ingredientId: 1, requestDate: 1 }],
  ['Inventory', { ingredientId: 1 }, { unique: true }],
  ['Inventory', { supplierId: 1 }],
  ['InventoryTransaction', { inventoryId: 1 }],
  ['Supplier', { name: 1 }],
  ['FoodSample', { sampleDate: 1 }],
  ['ItemMaster', { category: 1, name: 1 }],
  ['ProcurementRequest', { requesterId: 1, status: 1 }],
  ['PurchaseOrder', { requestId: 1 }, { unique: true }],
  ['PurchaseOrder', { supplierId: 1, orderDate: 1 }],
  ['PurchaseOrderDetail', { purchaseOrderId: 1 }],
  ['Asset', { itemId: 1, assignedTo: 1 }],
  ['Asset', { status: 1 }],
  ['AssetMaintenance', { assetId: 1 }],
  ['AssetLiquidation', { assetId: 1 }],
  ['Report', { reportType: 1, periodValue: 1 }],
  ['Report', { generatedBy: 1, generatedAt: -1 }]
];

const createIndexIfAvailable = async ([name, keys, options = {}]) => {
  const model = models[name];
  if (!model?.collection) {
    console.warn(`⚠️ Bỏ qua ${name}: model chưa được triển khai.`);
    return false;
  }
  await model.collection.createIndex(keys, options);
  return true;
};

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('Thiếu MONGODB_URI trong .env');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('🔄 Bắt đầu tạo indexes...');
  let created = 0;
  for (const spec of specs) {
    if (await createIndexIfAvailable(spec)) created += 1;
  }
  console.log(`✅ Hoàn tất: ${created} index specs đã được xử lý.`);
}

main()
  .catch((error) => {
    console.error('❌ Lỗi tạo indexes:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
