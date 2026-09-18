const mongoose = require('mongoose');
require('dotenv').config();

const models = {
  User: require('../models/zone1_system/User'),
  AuditLog: require('../models/zone1_system/AuditLog'),
  Notification: require('../models/zone1_system/Notification'),
  OutboxEvent: require('../models/zone1_system/OutboxEvent'),
  Department: require('../models/zone2_hr/Department'),
  Employee: require('../models/zone2_hr/Employee'),
  AttendanceRecord: require('../models/zone2_hr/AttendanceRecord'),
  LeaveRequest: require('../models/zone2_hr/LeaveRequest'),
  Payroll: require('../models/zone2_hr/Payroll'),
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
  StudentLeaveRequest: require('../models/zone3_school/StudentLeaveRequest'),
  TuitionFee: require('../models/zone4_finance/TuitionFee'),
  Payment: require('../models/zone4_finance/Payment'),
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
  Asset: require('../models/zone6_procurement/Asset'),
  Report: require('../models/zone7_reporting/Report')
};

const specs = [
  ['User', { username: 1 }, { unique: true }],
  ['User', { 'employeeInfo.employeeId': 1 }, { unique: true, sparse: true }],
  ['AuditLog', { userId: 1, timestamp: -1 }],
  ['Notification', { senderId: 1, sentAt: -1 }],
  ['OutboxEvent', { status: 1, createdAt: 1 }],
  ['Department', { name: 1 }, { unique: true }],
  ['Employee', { userId: 1 }, { unique: true }],
  ['Employee', { departmentId: 1 }],
  ['AttendanceRecord', { userId: 1, workDate: 1 }, { unique: true }],
  ['AttendanceRecord', { workDate: 1, finalized: 1 }],
  ['LeaveRequest', { employeeId: 1, startDate: 1 }],
  ['Payroll', { employeeId: 1, period: 1 }],
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
  ['StudentLeaveRequest', { studentId: 1, startDate: 1, endDate: 1, status: 1 }],
  ['StudentLeaveRequest', { classroomId: 1, status: 1, startDate: 1 }],
  ['StudentLeaveRequest', { requesterId: 1, createdAt: -1 }],
  ['TuitionFee', { studentId: 1, period: 1 }, {
    unique: true,
    partialFilterExpression: { status: { $in: ['unpaid', 'partial', 'paid'] } }
  }],
  ['TuitionFee', { classroomId: 1, period: 1 }],
  ['Payment', { invoiceId: 1 }],
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
  ['Asset', { itemId: 1, assignedTo: 1 }],
  ['Asset', { status: 1 }],
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
