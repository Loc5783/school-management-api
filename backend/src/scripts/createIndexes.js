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
  PickupRecord: require('../models/zone3_school/PickupRecord'),
  StudentProfileChangeRequest: require('../models/zone3_school/StudentProfileChangeRequest'),
  ParentFeedback: require('../models/zone3_school/ParentFeedback'),
  StudentGateEvent: require('../models/zone3_school/StudentGateEvent'),
  SchoolVisitor: require('../models/zone3_school/SchoolVisitor'),
  SecurityIncident: require('../models/zone3_school/SecurityIncident'),
  GuardShiftHandover: require('../models/zone3_school/GuardShiftHandover'),
  PickupOtpChallenge: require('../models/zone3_school/PickupOtpChallenge'),
  SupplierDelivery: require('../models/zone3_school/SupplierDelivery'),
  GuardEmergencyMode: require('../models/zone3_school/GuardEmergencyMode'),
  GuardDevice: require('../models/zone3_school/GuardDevice'),
  GuardDeviceEvent: require('../models/zone3_school/GuardDeviceEvent'),
  TuitionFee: require('../models/zone4_finance/TuitionFee'),
  Payment: require('../models/zone4_finance/Payment'),
  InvoiceAdjustment: require('../models/zone4_finance/InvoiceAdjustment'),
  TuitionRefundRequest: require('../models/zone4_finance/TuitionRefundRequest'),
  FeeSchedule: require('../models/zone4_finance/FeeSchedule'),
  PurchaseExpense: require('../models/zone4_finance/PurchaseExpense'),
  OperatingExpense: require('../models/zone4_finance/OperatingExpense'),
  OperatingExpenseRequest: require('../models/zone4_finance/OperatingExpenseRequest'),
  DailyCashReconciliation: require('../models/zone4_finance/DailyCashReconciliation'),
  AccountingPeriod: require('../models/zone4_finance/AccountingPeriod'),
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
  ['PickupRecord', { studentId: 1, pickupDate: 1, status: 1 }],
  ['PickupRecord', { classroomId: 1, pickupDate: 1, status: 1 }],
  ['PickupRecord', { requesterId: 1, pickupDate: -1 }],
  ['PickupRecord', { pickupCode: 1 }, { unique: true, sparse: true }],
  ['StudentProfileChangeRequest', { studentId: 1, status: 1, createdAt: -1 }],
  ['StudentProfileChangeRequest', { requesterId: 1, createdAt: -1 }],
  ['StudentProfileChangeRequest', { status: 1, createdAt: -1 }],
  ['ParentFeedback', { parentId: 1, createdAt: -1 }],
  ['ParentFeedback', { status: 1, createdAt: -1 }],
  ['ParentFeedback', { studentId: 1, createdAt: -1 }],
  ['StudentGateEvent', { studentId: 1, gateDate: 1, direction: 1 }, { unique: true }],
  ['StudentGateEvent', { gateDate: 1, occurredAt: -1 }],
  ['StudentGateEvent', { clientEventId: 1 }, { unique: true, sparse: true }],
  ['SchoolVisitor', { visitDate: 1, status: 1, checkInAt: -1 }],
  ['SchoolVisitor', { clientEventId: 1 }, { unique: true, sparse: true }],
  ['SecurityIncident', { status: 1, severity: 1, createdAt: -1 }],
  ['SecurityIncident', { clientEventId: 1 }, { unique: true, sparse: true }],
  ['GuardShiftHandover', { handoverDate: 1, handedOverAt: -1 }],
  ['PickupOtpChallenge', { studentId: 1, pickupDate: 1, status: 1 }],
  ['SupplierDelivery', { deliveryDate: 1, status: 1, checkInAt: -1 }],
  ['SupplierDelivery', { clientEventId: 1 }, { unique: true, sparse: true }],
  ['GuardEmergencyMode', { status: 1, activatedAt: -1 }],
  ['GuardEmergencyMode', { activeKey: 1 }, { unique: true, partialFilterExpression: { status: 'active' } }],
  ['GuardDeviceEvent', { deviceId: 1, externalEventId: 1 }, { unique: true }],
  ['GuardDeviceEvent', { occurredAt: -1, status: 1 }],
  ['TuitionFee', { studentId: 1, period: 1 }, {
    unique: true,
    partialFilterExpression: { status: { $in: ['unpaid', 'partial', 'paid'] } }
  }],
  ['TuitionFee', { classroomId: 1, period: 1 }],
  ['Payment', { invoiceId: 1 }],
  ['FeeSchedule', { period: 1, classroomId: 1 }, { unique: true }],
  ['PurchaseExpense', { orderId: 1, idempotencyKey: 1 }, { unique: true }],
  ['PurchaseExpense', { transactionRef: 1 }, { unique: true, sparse: true }],
  ['PurchaseExpense', { paidAt: -1 }],
  ['OperatingExpense', { paidAt: -1 }],
  ['OperatingExpense', { idempotencyKey: 1 }, { unique: true }],
  ['OperatingExpense', { documentNumber: 1 }, { unique: true }],
  ['OperatingExpense', { transactionRef: 1 }, { unique: true, partialFilterExpression: { transactionRef: { $type: 'string' } } }],
  ['OperatingExpense', { approvalRequestId: 1 }, { unique: true, partialFilterExpression: { approvalRequestId: { $type: 'objectId' } } }],
  ['OperatingExpenseRequest', { requestKey: 1 }, { unique: true }],
  ['OperatingExpenseRequest', { status: 1, createdAt: -1 }],
  ['DailyCashReconciliation', { workDate: 1 }, { unique: true }],
  ['AccountingPeriod', { month: 1 }, { unique: true }],
  ['InvoiceAdjustment', { invoiceId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }],
  ['InvoiceAdjustment', { paidAt: -1 }],
  ['TuitionRefundRequest', { invoiceId: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['pending', 'approved'] } } }],
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
