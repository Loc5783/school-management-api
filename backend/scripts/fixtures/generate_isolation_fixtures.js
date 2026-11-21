'use strict';

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

// Zone 1
const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const Notification = require('../../src/models/zone1_system/Notification');
const Conversation = require('../../src/models/zone1_system/Conversation');
const ChatMessage = require('../../src/models/zone1_system/ChatMessage');

// Zone 2
const Department = require('../../src/models/zone2_hr/Department');
const Employee = require('../../src/models/zone2_hr/Employee');
const StaffShift = require('../../src/models/zone2_hr/StaffShift');
const Payroll = require('../../src/models/zone2_hr/Payroll');
const InternalAnnouncement = require('../../src/models/zone2_hr/InternalAnnouncement');

// Zone 3
const Classroom = require('../../src/models/zone3_school/Classroom');
const Student = require('../../src/models/zone3_school/Student');
const ClassroomAnnouncement = require('../../src/models/zone3_school/ClassroomAnnouncement');
const ClassroomDailyCareReport = require('../../src/models/zone3_school/ClassroomDailyCareReport');
const StudentAttendance = require('../../src/models/zone3_school/StudentAttendance');
const StudentLeaveRequest = require('../../src/models/zone3_school/StudentLeaveRequest');
const PickupRecord = require('../../src/models/zone3_school/PickupRecord');
const StudentGateEvent = require('../../src/models/zone3_school/StudentGateEvent');
const SchoolVisitor = require('../../src/models/zone3_school/SchoolVisitor');
const SecurityIncident = require('../../src/models/zone3_school/SecurityIncident');
const GuardShiftHandover = require('../../src/models/zone3_school/GuardShiftHandover');
const SupplierDelivery = require('../../src/models/zone3_school/SupplierDelivery');
const GuardEmergencyMode = require('../../src/models/zone3_school/GuardEmergencyMode');
const ParentFeedback = require('../../src/models/zone3_school/ParentFeedback');
const StudentProfileChangeRequest = require('../../src/models/zone3_school/StudentProfileChangeRequest');

// Zone 4
const FeeSchedule = require('../../src/models/zone4_finance/FeeSchedule');
const TuitionFee = require('../../src/models/zone4_finance/TuitionFee');
const Payment = require('../../src/models/zone4_finance/Payment');
const OperatingExpense = require('../../src/models/zone4_finance/OperatingExpense');
const PurchaseExpense = require('../../src/models/zone4_finance/PurchaseExpense');
const TuitionRefundRequest = require('../../src/models/zone4_finance/TuitionRefundRequest');

// Zone 5
const Supplier = require('../../src/models/zone5_nutrition/Supplier');
const Dish = require('../../src/models/zone5_nutrition/Dish');
const IngredientMaster = require('../../src/models/zone5_nutrition/IngredientMaster');
const Menu = require('../../src/models/zone5_nutrition/Menu');
const FoodSample = require('../../src/models/zone5_nutrition/FoodSample');
const Inventory = require('../../src/models/zone5_nutrition/Inventory');
const MealServing = require('../../src/models/zone5_nutrition/MealServing');

// Zone 6
const ItemMaster = require('../../src/models/zone6_procurement/ItemMaster');
const ProcurementRequest = require('../../src/models/zone6_procurement/ProcurementRequest');
const PurchaseOrder = require('../../src/models/zone6_procurement/PurchaseOrder');
const Asset = require('../../src/models/zone6_procurement/Asset');

const TEST_PASSWORD = 'TestPassword123!';

async function generateIsolationFixtures() {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const now = new Date();
  const todayStr = '2026-11-14';

  // 1. Tenants
  const tenantA = await Tenant.create({
    name: 'Hoa Nắng A - Isolation Audit',
    code: 'HOANANG-A',
    status: 'active'
  });

  const tenantB = await Tenant.create({
    name: 'Hoa Nắng B - Isolation Audit',
    code: 'HOANANG-B',
    status: 'active'
  });

  const roles = ['admin', 'principal', 'hr', 'accountant', 'teacher', 'chef', 'guard', 'parent'];

  // Helper to create users for a tenant
  async function createUsers(tenant, prefix) {
    const users = {};
    for (const role of roles) {
      const username = `${prefix.toLowerCase()}_${role}`;
      const user = await User.create({
        username,
        tenantId: tenant._id,
        passwordHash,
        role,
        profile: {
          fullName: `${prefix.toUpperCase()}_USER_${role.toUpperCase()}`,
          phone: '0901234567',
          email: `${username}@example.com`
        },
        status: 'active',
        authVersion: 0
      });
      users[role] = user;
    }
    return users;
  }

  const usersA = await createUsers(tenantA, 'iso_a');
  const usersB = await createUsers(tenantB, 'iso_b');

  // 2. Classrooms (Same code/ageGroup, different tenant)
  const classA = await Classroom.create({
    tenantId: tenantA._id,
    name: 'ISO_A_CLASS_MAM_1',
    code: 'MAM_1',
    ageGroup: '3-4',
    grade: 'Mầm',
    schoolYear: '2026-2027',
    homeroomTeacherId: usersA.teacher._id,
    status: 'active'
  });

  const classB = await Classroom.create({
    tenantId: tenantB._id,
    name: 'ISO_B_CLASS_MAM_1',
    code: 'MAM_1', // Identical code!
    ageGroup: '3-4',
    grade: 'Mầm',
    schoolYear: '2026-2027',
    homeroomTeacherId: usersB.teacher._id,
    status: 'active'
  });

  // 3. Students (Same studentCode HS-2026-000001!)
  const studentA = await Student.create({
    tenantId: tenantA._id,
    studentCode: 'HS-2026-000001',
    fullName: 'ISO_A_STUDENT_AN',
    birthDate: new Date('2022-05-10'),
    gender: 'male',
    classroomId: classA._id,
    className: classA.name,
    status: 'enrolled',
    authorizedPickers: [{
      fullName: 'ISO_A_PICKER_BAP',
      relationship: 'Bố',
      phone: '0901111111',
      isActive: true
    }]
  });

  const studentB = await Student.create({
    tenantId: tenantB._id,
    studentCode: 'HS-2026-000001', // Identical code!
    fullName: 'ISO_B_STUDENT_BINH',
    birthDate: new Date('2022-08-20'),
    gender: 'female',
    classroomId: classB._id,
    className: classB.name,
    status: 'enrolled',
    authorizedPickers: [{
      fullName: 'ISO_B_PICKER_CHUOI',
      relationship: 'Mẹ',
      phone: '0902222222',
      isActive: true
    }]
  });

  // Link parents to their respective students
  await User.updateOne({ _id: usersA.parent._id }, { $set: { 'parentInfo.studentIds': [studentA._id] } });
  await User.updateOne({ _id: usersB.parent._id }, { $set: { 'parentInfo.studentIds': [studentB._id] } });

  // 4. HR: Departments & Employees (Same codes!)
  const deptA = await Department.create({
    tenantId: tenantA._id,
    code: 'DSP',
    name: 'ISO_A_DEP_SU_PHAM',
    status: 'active'
  });

  const deptB = await Department.create({
    tenantId: tenantB._id,
    code: 'DSP', // Identical code!
    name: 'ISO_B_DEP_SU_PHAM',
    status: 'active'
  });

  const empA = await Employee.create({
    tenantId: tenantA._id,
    employeeCode: 'NV001',
    fullName: 'ISO_A_EMP_NGUYEN_A',
    userId: usersA.teacher._id,
    departmentId: deptA._id,
    position: 'teacher',
    payrollRole: 'teacher',
    salaryConfig: { baseSalary: 8000000 },
    startDate: new Date('2025-01-01'),
    status: 'active'
  });

  const empB = await Employee.create({
    tenantId: tenantB._id,
    employeeCode: 'NV001', // Identical code!
    fullName: 'ISO_B_EMP_TRAN_B',
    userId: usersB.teacher._id,
    departmentId: deptB._id,
    position: 'teacher',
    payrollRole: 'teacher',
    salaryConfig: { baseSalary: 9000000 },
    startDate: new Date('2025-01-01'),
    status: 'active'
  });

  const empChefA = await Employee.create({
    tenantId: tenantA._id,
    employeeCode: 'NV002',
    fullName: 'ISO_A_EMP_CHEF',
    userId: usersA.chef._id,
    departmentId: deptA._id,
    position: 'chef',
    payrollRole: 'chef',
    salaryConfig: { baseSalary: 8000000 },
    startDate: new Date('2025-01-01'),
    status: 'active'
  });

  const empChefB = await Employee.create({
    tenantId: tenantB._id,
    employeeCode: 'NV002',
    fullName: 'ISO_B_EMP_CHEF',
    userId: usersB.chef._id,
    departmentId: deptB._id,
    position: 'chef',
    payrollRole: 'chef',
    salaryConfig: { baseSalary: 8500000 },
    startDate: new Date('2025-01-01'),
    status: 'active'
  });

  // 5. StaffShift & Payroll
  const shiftA = await StaffShift.create({
    tenantId: tenantA._id,
    employeeId: empChefA._id,
    role: 'chef',
    name: 'ISO_A_SHIFT_SANG',
    startTime: '07:30',
    endTime: '11:30',
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
    createdBy: usersA.admin._id
  });

  const shiftB = await StaffShift.create({
    tenantId: tenantB._id,
    employeeId: empChefB._id,
    role: 'chef',
    name: 'ISO_B_SHIFT_CHIEU',
    startTime: '13:30',
    endTime: '17:30',
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
    createdBy: usersB.admin._id
  });

  const payrollA = await Payroll.create({
    tenantId: tenantA._id,
    employeeId: empA._id,
    employeeCode: empA.employeeCode,
    employeeName: empA.fullName,
    payrollRole: 'teacher',
    month: 11,
    year: 2026,
    baseSalary: 8000000,
    netSalary: 8000000,
    status: 'paid',
    note: 'ISO_A_PAYROLL_NOTE'
  });

  const payrollB = await Payroll.create({
    tenantId: tenantB._id,
    employeeId: empB._id,
    employeeCode: empB.employeeCode,
    employeeName: empB.fullName,
    payrollRole: 'teacher',
    month: 11,
    year: 2026,
    baseSalary: 9000000,
    netSalary: 9000000,
    status: 'paid',
    note: 'ISO_B_PAYROLL_NOTE'
  });

  // 6. Announcements & Notifications
  const notifA = await Notification.create({
    tenantId: tenantA._id,
    recipientId: usersA.admin._id,
    title: 'ISO_A_NOTIF_TITLE',
    message: 'Nội dung thông báo riêng của Trường A',
    type: 'system',
    createdBy: usersA.admin._id
  });

  const notifB = await Notification.create({
    tenantId: tenantB._id,
    recipientId: usersB.admin._id,
    title: 'ISO_B_NOTIF_TITLE',
    message: 'Nội dung thông báo riêng của Trường B',
    type: 'system',
    createdBy: usersB.admin._id
  });

  const classAnnounceA = await ClassroomAnnouncement.create({
    tenantId: tenantA._id,
    classroomId: classA._id,
    className: classA.name,
    title: 'ISO_A_CLASS_ANNOUNCEMENT',
    content: 'Thông báo lớp Mầm 1 Trường A',
    createdBy: usersA.teacher._id,
    createdByName: usersA.teacher.profile.fullName
  });

  const classAnnounceB = await ClassroomAnnouncement.create({
    tenantId: tenantB._id,
    classroomId: classB._id,
    className: classB.name,
    title: 'ISO_B_CLASS_ANNOUNCEMENT',
    content: 'Thông báo lớp Mầm 1 Trường B',
    createdBy: usersB.teacher._id,
    createdByName: usersB.teacher.profile.fullName
  });

  const internalAnnounceA = await InternalAnnouncement.create({
    tenantId: tenantA._id,
    category: 'general',
    title: 'ISO_A_INTERNAL_NOTICE',
    message: 'Nội dung thông báo nội bộ trường A',
    priority: 'normal',
    targetRoles: ['teacher'],
    recipientIds: [usersA.teacher._id],
    requestId: 'REQ-INT-A1',
    createdBy: usersA.admin._id
  });

  const internalAnnounceB = await InternalAnnouncement.create({
    tenantId: tenantB._id,
    category: 'general',
    title: 'ISO_B_INTERNAL_NOTICE',
    message: 'Nội dung thông báo nội bộ trường B',
    priority: 'normal',
    targetRoles: ['teacher'],
    recipientIds: [usersB.teacher._id],
    requestId: 'REQ-INT-B1',
    createdBy: usersB.admin._id
  });

  const careReportA = await ClassroomDailyCareReport.create({
    tenantId: tenantA._id,
    classroomId: classA._id,
    className: classA.name,
    reportDate: now,
    dateKey: todayStr,
    summary: 'ISO_A_CARE_REPORT',
    recordedBy: usersA.teacher._id,
    recordedByName: usersA.teacher.profile.fullName
  });

  const careReportB = await ClassroomDailyCareReport.create({
    tenantId: tenantB._id,
    classroomId: classB._id,
    className: classB.name,
    reportDate: now,
    dateKey: todayStr,
    summary: 'ISO_B_CARE_REPORT',
    recordedBy: usersB.teacher._id,
    recordedByName: usersB.teacher.profile.fullName
  });

  // 7. Chat
  const convA = await Conversation.create({
    tenantId: tenantA._id,
    parentId: usersA.parent._id,
    teacherId: usersA.teacher._id,
    studentId: studentA._id,
    lastMessageText: 'ISO_A_CHAT_MSG',
    lastMessageAt: now
  });

  const chatMsgA = await ChatMessage.create({
    tenantId: tenantA._id,
    conversationId: convA._id,
    senderId: usersA.parent._id,
    body: 'ISO_A_CHAT_MSG'
  });

  const convB = await Conversation.create({
    tenantId: tenantB._id,
    parentId: usersB.parent._id,
    teacherId: usersB.teacher._id,
    studentId: studentB._id,
    lastMessageText: 'ISO_B_CHAT_MSG',
    lastMessageAt: now
  });

  const chatMsgB = await ChatMessage.create({
    tenantId: tenantB._id,
    conversationId: convB._id,
    senderId: usersB.parent._id,
    body: 'ISO_B_CHAT_MSG'
  });

  // 8. Attendance & Leave
  const attA = await StudentAttendance.create({
    tenantId: tenantA._id,
    studentId: studentA._id,
    studentName: studentA.fullName,
    classroomId: classA._id,
    className: classA.name,
    attendDate: now,
    dateKey: todayStr,
    status: 'present',
    recordedBy: usersA.teacher._id,
    recordedByName: usersA.teacher.profile.fullName
  });

  const attB = await StudentAttendance.create({
    tenantId: tenantB._id,
    studentId: studentB._id,
    studentName: studentB.fullName,
    classroomId: classB._id,
    className: classB.name,
    attendDate: now,
    dateKey: todayStr,
    status: 'present',
    recordedBy: usersB.teacher._id,
    recordedByName: usersB.teacher.profile.fullName
  });

  const leaveA = await StudentLeaveRequest.create({
    tenantId: tenantA._id,
    studentId: studentA._id,
    studentName: studentA.fullName,
    classroomId: classA._id,
    className: classA.name,
    requesterId: usersA.parent._id,
    requesterName: usersA.parent.profile.fullName,
    startDate: todayStr,
    endDate: todayStr,
    reason: 'ISO_A_LEAVE_REQ',
    status: 'approved'
  });

  const leaveB = await StudentLeaveRequest.create({
    tenantId: tenantB._id,
    studentId: studentB._id,
    studentName: studentB.fullName,
    classroomId: classB._id,
    className: classB.name,
    requesterId: usersB.parent._id,
    requesterName: usersB.parent.profile.fullName,
    startDate: todayStr,
    endDate: todayStr,
    reason: 'ISO_B_LEAVE_REQ',
    status: 'approved'
  });

  // 9. Guard & Pickups
  const pickerObjA = studentA.authorizedPickers[0];
  const pickupA = await PickupRecord.create({
    tenantId: tenantA._id,
    studentId: studentA._id,
    studentName: studentA.fullName,
    classroomId: classA._id,
    className: classA.name,
    requesterId: usersA.parent._id,
    requesterName: usersA.parent.profile.fullName,
    pickupDate: todayStr,
    pickupCode: 'CODEA123',
    status: 'scheduled',
    note: 'ISO_A_PICKUP_REC',
    picker: {
      pickerId: pickerObjA._id,
      fullName: pickerObjA.fullName,
      phone: pickerObjA.phone,
      relationship: pickerObjA.relationship
    }
  });

  const pickerObjB = studentB.authorizedPickers[0];
  const pickupB = await PickupRecord.create({
    tenantId: tenantB._id,
    studentId: studentB._id,
    studentName: studentB.fullName,
    classroomId: classB._id,
    className: classB.name,
    requesterId: usersB.parent._id,
    requesterName: usersB.parent.profile.fullName,
    pickupDate: todayStr,
    pickupCode: 'CODEB123',
    status: 'scheduled',
    note: 'ISO_B_PICKUP_REC',
    picker: {
      pickerId: pickerObjB._id,
      fullName: pickerObjB.fullName,
      phone: pickerObjB.phone,
      relationship: pickerObjB.relationship
    }
  });

  const visitorA = await SchoolVisitor.create({
    tenantId: tenantA._id,
    fullName: 'ISO_A_VISITOR_NAM',
    phone: '0903333333',
    purpose: 'Liên hệ công việc',
    hostName: 'Hiệu trưởng',
    visitDate: todayStr,
    checkInAt: now,
    status: 'inside',
    recordedBy: usersA.guard._id,
    recordedByName: usersA.guard.profile.fullName
  });

  const visitorB = await SchoolVisitor.create({
    tenantId: tenantB._id,
    fullName: 'ISO_B_VISITOR_LAN',
    phone: '0904444444',
    purpose: 'Tham quan trường',
    hostName: 'Hiệu phó',
    visitDate: todayStr,
    checkInAt: now,
    status: 'inside',
    recordedBy: usersB.guard._id,
    recordedByName: usersB.guard.profile.fullName
  });

  const incidentA = await SecurityIncident.create({
    tenantId: tenantA._id,
    incidentDate: todayStr,
    occurredAt: now,
    category: 'accident',
    severity: 'normal',
    location: 'Sân chơi A',
    description: 'ISO_A_INCIDENT_CUA_SO',
    reportedBy: usersA.guard._id,
    reportedByName: usersA.guard.profile.fullName,
    status: 'open'
  });

  const incidentB = await SecurityIncident.create({
    tenantId: tenantB._id,
    incidentDate: todayStr,
    occurredAt: now,
    category: 'accident',
    severity: 'normal',
    location: 'Sân chơi B',
    description: 'ISO_B_INCIDENT_HANG_RAO',
    reportedBy: usersB.guard._id,
    reportedByName: usersB.guard.profile.fullName,
    status: 'open'
  });

  const handoverA = await GuardShiftHandover.create({
    tenantId: tenantA._id,
    handoverDate: todayStr,
    shiftName: 'morning',
    receiverName: 'Bảo vệ ca chiều A',
    handedOverBy: usersA.guard._id,
    handedOverByName: usersA.guard.profile.fullName,
    handedOverAt: now,
    notes: 'ISO_A_HANDOVER_CA_SANG',
    status: 'pending'
  });

  const handoverB = await GuardShiftHandover.create({
    tenantId: tenantB._id,
    handoverDate: todayStr,
    shiftName: 'morning',
    receiverName: 'Bảo vệ ca chiều B',
    handedOverBy: usersB.guard._id,
    handedOverByName: usersB.guard.profile.fullName,
    handedOverAt: now,
    notes: 'ISO_B_HANDOVER_CA_SANG',
    status: 'pending'
  });

  const deliveryA = await SupplierDelivery.create({
    tenantId: tenantA._id,
    deliveryDate: todayStr,
    supplierName: 'ISO_A_SUPPLIER_NONG_SAN',
    driverName: 'Tài xế A',
    itemsDescription: 'ISO_A_DELIVERY_RAU',
    recipientName: 'Nhân viên bếp A',
    checkInAt: now,
    recordedBy: usersA.guard._id,
    recordedByName: usersA.guard.profile.fullName
  });

  const deliveryB = await SupplierDelivery.create({
    tenantId: tenantB._id,
    deliveryDate: todayStr,
    supplierName: 'ISO_B_SUPPLIER_THUC_PHAM',
    driverName: 'Tài xế B',
    itemsDescription: 'ISO_B_DELIVERY_THIT',
    recipientName: 'Nhân viên bếp B',
    checkInAt: now,
    recordedBy: usersB.guard._id,
    recordedByName: usersB.guard.profile.fullName
  });

  const emergencyA = await GuardEmergencyMode.create({
    tenantId: tenantA._id,
    level: 'security',
    title: 'ISO_A_EMERGENCY_TITLE',
    instructions: 'Hướng dẫn an toàn Trường A',
    activatedAt: now,
    activatedBy: usersA.admin._id,
    activatedByName: usersA.admin.profile.fullName,
    status: 'active',
    activeKey: 'ACTIVE'
  });

  const emergencyB = await GuardEmergencyMode.create({
    tenantId: tenantB._id,
    level: 'security',
    title: 'ISO_B_EMERGENCY_TITLE',
    instructions: 'Hướng dẫn an toàn Trường B',
    activatedAt: now,
    activatedBy: usersB.admin._id,
    activatedByName: usersB.admin.profile.fullName,
    status: 'active',
    activeKey: 'ACTIVE'
  });

  // 10. Parent Feedback & Profile Requests
  const feedbackA = await ParentFeedback.create({
    tenantId: tenantA._id,
    studentId: studentA._id,
    studentName: studentA.fullName,
    classroomId: classA._id,
    parentId: usersA.parent._id,
    parentName: usersA.parent.profile.fullName,
    subject: 'ISO_A_FEEDBACK_XE_DUA_DON',
    message: 'Nội dung phản hồi dịch vụ đưa đón học sinh Trường A',
    category: 'service',
    status: 'pending'
  });

  const feedbackB = await ParentFeedback.create({
    tenantId: tenantB._id,
    studentId: studentB._id,
    studentName: studentB.fullName,
    classroomId: classB._id,
    parentId: usersB.parent._id,
    parentName: usersB.parent.profile.fullName,
    subject: 'ISO_B_FEEDBACK_XE_DUA_DON',
    message: 'Nội dung phản hồi dịch vụ đưa đón học sinh Trường B',
    category: 'service',
    status: 'pending'
  });

  const profileReqA = await StudentProfileChangeRequest.create({
    tenantId: tenantA._id,
    studentId: studentA._id,
    studentName: studentA.fullName,
    classroomId: classA._id,
    requesterId: usersA.parent._id,
    requesterName: usersA.parent.profile.fullName,
    changes: { address: 'ISO_A_ADDRESS_NEW' },
    baseUpdatedAt: studentA.updatedAt,
    status: 'pending'
  });

  const profileReqB = await StudentProfileChangeRequest.create({
    tenantId: tenantB._id,
    studentId: studentB._id,
    studentName: studentB.fullName,
    classroomId: classB._id,
    requesterId: usersB.parent._id,
    requesterName: usersB.parent.profile.fullName,
    changes: { address: 'ISO_B_ADDRESS_NEW' },
    baseUpdatedAt: studentB.updatedAt,
    status: 'pending'
  });

  // 11. Nutrition
  const supA = await Supplier.create({
    tenantId: tenantA._id,
    name: 'ISO_A_SUPPLIER_NONG_SAN',
    code: 'SUP01',
    phone: '0905555555',
    status: 'active'
  });

  const supB = await Supplier.create({
    tenantId: tenantB._id,
    name: 'ISO_B_SUPPLIER_THUC_PHAM',
    code: 'SUP01', // Identical code!
    phone: '0906666666',
    status: 'active'
  });

  const dishA = await Dish.create({
    tenantId: tenantA._id,
    name: 'ISO_A_DISH_CANH_CHUA',
    category: 'soup',
    mealType: 'lunch',
    ageGroups: ['3-4'],
    status: 'active'
  });

  const dishB = await Dish.create({
    tenantId: tenantB._id,
    name: 'ISO_B_DISH_THIT_KHO',
    category: 'main_course',
    mealType: 'lunch',
    ageGroups: ['3-4'],
    status: 'active'
  });

  const ingA = await IngredientMaster.create({
    tenantId: tenantA._id,
    name: 'ISO_A_ING_CA_CHUA',
    code: 'ING01',
    category: 'vegetable',
    unit: 'kg'
  });

  const ingB = await IngredientMaster.create({
    tenantId: tenantB._id,
    name: 'ISO_B_ING_THIT_HEO',
    code: 'ING01', // Identical code!
    category: 'meat',
    unit: 'kg'
  });

  const menuA = await Menu.create({
    tenantId: tenantA._id,
    classroomId: classA._id,
    className: classA.name,
    weekNumber: 45,
    schoolYear: '2026-2027',
    startDate: new Date('2026-11-09'),
    endDate: new Date('2026-11-15'),
    approvalNote: 'ISO_A_MENU_TUAN_45',
    status: 'published'
  });

  const menuB = await Menu.create({
    tenantId: tenantB._id,
    classroomId: classB._id,
    className: classB.name,
    weekNumber: 45,
    schoolYear: '2026-2027',
    startDate: new Date('2026-11-09'),
    endDate: new Date('2026-11-15'),
    approvalNote: 'ISO_B_MENU_TUAN_45',
    status: 'published'
  });

  const sampleA = await FoodSample.create({
    tenantId: tenantA._id,
    sampleCode: 'SAM01',
    mealDate: now,
    mealType: 'lunch',
    dishName: 'ISO_A_SAMPLE_CANH',
    sampleWeightGram: 100,
    storedBy: usersA.chef._id,
    storedByName: usersA.chef.profile.fullName
  });

  const sampleB = await FoodSample.create({
    tenantId: tenantB._id,
    sampleCode: 'SAM01', // Identical code!
    mealDate: now,
    mealType: 'lunch',
    dishName: 'ISO_B_SAMPLE_THIT',
    sampleWeightGram: 100,
    storedBy: usersB.chef._id,
    storedByName: usersB.chef.profile.fullName
  });

  const invA = await Inventory.create({
    tenantId: tenantA._id,
    ingredientId: ingA._id,
    ingredientName: ingA.name,
    batchNumber: 'BATCH-A1',
    quantity: 50,
    unit: 'kg',
    expiryDate: new Date('2026-12-31')
  });

  const invB = await Inventory.create({
    tenantId: tenantB._id,
    ingredientId: ingB._id,
    ingredientName: ingB.name,
    batchNumber: 'BATCH-B1',
    quantity: 60,
    unit: 'kg',
    expiryDate: new Date('2026-12-31')
  });

  // 12. Procurement
  const itemMasterA = await ItemMaster.create({
    tenantId: tenantA._id,
    name: 'ISO_A_ITEM_GIAY_A4',
    category: 'stationery',
    unit: 'piece'
  });

  const itemMasterB = await ItemMaster.create({
    tenantId: tenantB._id,
    name: 'ISO_B_ITEM_BUT_DA',
    category: 'stationery',
    unit: 'piece'
  });

  const procReqA = await ProcurementRequest.create({
    tenantId: tenantA._id,
    requesterId: usersA.teacher._id,
    requesterName: usersA.teacher.profile.fullName,
    category: 'furniture',
    reason: 'ISO_A_PROCUREMENT_BAN_GHE',
    status: 'approved_l2',
    totalEstimatedCost: 2000000,
    items: [{
      itemName: 'Bàn ghế học sinh',
      quantity: 5,
      estimatedPrice: 400000,
      totalEstimated: 2000000
    }]
  });

  const procReqB = await ProcurementRequest.create({
    tenantId: tenantB._id,
    requesterId: usersB.teacher._id,
    requesterName: usersB.teacher.profile.fullName,
    category: 'it',
    reason: 'ISO_B_PROCUREMENT_MAY_CHIEU',
    status: 'approved_l2',
    totalEstimatedCost: 5000000,
    items: [{
      itemName: 'Máy chiếu mini',
      quantity: 1,
      estimatedPrice: 5000000,
      totalEstimated: 5000000
    }]
  });

  const poA = await PurchaseOrder.create({
    tenantId: tenantA._id,
    orderCode: 'ORD01',
    requestId: procReqA._id,
    supplierName: supA.name,
    supplierId: supA._id,
    totalAmount: 2000000,
    createdBy: usersA.admin._id,
    status: 'ordered',
    note: 'ISO_A_PO_NOTE',
    expectedDelivery: new Date('2026-11-20'),
    items: [{
      itemName: 'Bàn ghế học sinh',
      quantity: 5,
      unitPrice: 400000,
      totalPrice: 2000000
    }]
  });

  const poB = await PurchaseOrder.create({
    tenantId: tenantB._id,
    orderCode: 'ORD01', // Identical orderCode!
    requestId: procReqB._id,
    supplierName: supB.name,
    supplierId: supB._id,
    totalAmount: 5000000,
    createdBy: usersB.admin._id,
    status: 'ordered',
    note: 'ISO_B_PO_NOTE',
    expectedDelivery: new Date('2026-11-20'),
    items: [{
      itemName: 'Máy chiếu mini',
      quantity: 1,
      unitPrice: 5000000,
      totalPrice: 5000000
    }]
  });

  const assetA = await Asset.create({
    tenantId: tenantA._id,
    itemId: itemMasterA._id,
    name: 'ISO_A_ASSET_TIVI_55',
    category: 'it',
    originalCost: 10000000,
    qrCode: 'TS001',
    serialNumber: 'TS001',
    status: 'active'
  });

  const assetB = await Asset.create({
    tenantId: tenantB._id,
    itemId: itemMasterB._id,
    name: 'ISO_B_ASSET_DIEU_HOA',
    category: 'equipment',
    originalCost: 12000000,
    qrCode: 'TS001', // Identical code!
    serialNumber: 'TS001',
    status: 'active'
  });

  // 13. Finance
  const feeSchedA = await FeeSchedule.create({
    tenantId: tenantA._id,
    period: '11-2026',
    classroomId: classA._id,
    classroomName: classA.name,
    tuitionBase: 3000000,
    dueDate: new Date('2026-11-25'),
    totalAmount: 3000000,
    note: 'ISO_A_FEE_SCHEDULE'
  });

  const feeSchedB = await FeeSchedule.create({
    tenantId: tenantB._id,
    period: '11-2026',
    classroomId: classB._id,
    classroomName: classB.name,
    tuitionBase: 3500000,
    dueDate: new Date('2026-11-25'),
    totalAmount: 3500000,
    note: 'ISO_B_FEE_SCHEDULE'
  });

  const tuitionFeeA = await TuitionFee.create({
    tenantId: tenantA._id,
    studentId: studentA._id,
    studentName: studentA.fullName,
    classroomId: classA._id,
    className: classA.name,
    period: '11-2026',
    tuitionBase: 3000000,
    totalAmount: 3000000,
    dueDate: new Date('2026-11-25'),
    note: 'ISO_A_TUITION_INV',
    status: 'unpaid'
  });

  const tuitionFeeB = await TuitionFee.create({
    tenantId: tenantB._id,
    studentId: studentB._id,
    studentName: studentB.fullName,
    classroomId: classB._id,
    className: classB.name,
    period: '11-2026',
    tuitionBase: 3500000,
    totalAmount: 3500000,
    dueDate: new Date('2026-11-25'),
    note: 'ISO_B_TUITION_INV',
    status: 'unpaid'
  });

  const paymentA = await Payment.create({
    tenantId: tenantA._id,
    invoiceId: tuitionFeeA._id,
    amount: 3000000,
    method: 'bank_transfer',
    receiptNumber: 'RCP01',
    idempotencyKey: 'IDEM-PAY-A1',
    recordedBy: usersA.accountant._id,
    note: 'ISO_A_PAYMENT_RECEIPT'
  });

  const paymentB = await Payment.create({
    tenantId: tenantB._id,
    invoiceId: tuitionFeeB._id,
    amount: 3500000,
    method: 'bank_transfer',
    receiptNumber: 'RCP01', // Identical receiptNumber!
    idempotencyKey: 'IDEM-PAY-B1',
    recordedBy: usersB.accountant._id,
    note: 'ISO_B_PAYMENT_RECEIPT'
  });

  const opExpA = await OperatingExpense.create({
    tenantId: tenantA._id,
    category: 'utilities',
    payee: 'Công ty Điện Lực A',
    description: 'ISO_A_OP_EXPENSE',
    amount: 1500000,
    paidAt: now,
    method: 'bank_transfer',
    documentNumber: 'DOC01',
    approvalReference: 'REF-A1',
    idempotencyKey: 'IDEM-OP-A1',
    recordedBy: usersA.accountant._id,
    recordedByName: usersA.accountant.profile.fullName
  });

  const opExpB = await OperatingExpense.create({
    tenantId: tenantB._id,
    category: 'utilities',
    payee: 'Công ty Điện Lực B',
    description: 'ISO_B_OP_EXPENSE',
    amount: 2500000,
    paidAt: now,
    method: 'bank_transfer',
    documentNumber: 'DOC01', // Identical documentNumber!
    approvalReference: 'REF-B1',
    idempotencyKey: 'IDEM-OP-B1',
    recordedBy: usersB.accountant._id,
    recordedByName: usersB.accountant.profile.fullName
  });

  const purExpA = await PurchaseExpense.create({
    tenantId: tenantA._id,
    orderId: poA._id,
    orderCode: poA.orderCode,
    supplierName: poA.supplierName,
    amount: 2000000,
    paidAt: now,
    method: 'bank_transfer',
    documentNumber: 'PEDOC01',
    recordedBy: usersA.accountant._id,
    recordedByName: usersA.accountant.profile.fullName,
    idempotencyKey: 'IDEM-PE-A1',
    note: 'ISO_A_PURCHASE_EXPENSE'
  });

  const purExpB = await PurchaseExpense.create({
    tenantId: tenantB._id,
    orderId: poB._id,
    orderCode: poB.orderCode,
    supplierName: poB.supplierName,
    amount: 5000000,
    paidAt: now,
    method: 'bank_transfer',
    documentNumber: 'PEDOC01', // Identical documentNumber!
    recordedBy: usersB.accountant._id,
    recordedByName: usersB.accountant.profile.fullName,
    idempotencyKey: 'IDEM-PE-B1',
    note: 'ISO_B_PURCHASE_EXPENSE'
  });

  const refundA = await TuitionRefundRequest.create({
    tenantId: tenantA._id,
    invoiceId: tuitionFeeA._id,
    amount: 500000,
    reason: 'ISO_A_REFUND_REQ',
    status: 'pending',
    requestedBy: usersA.parent._id,
    requestedByName: usersA.parent.profile.fullName
  });

  const refundB = await TuitionRefundRequest.create({
    tenantId: tenantB._id,
    invoiceId: tuitionFeeB._id,
    amount: 600000,
    reason: 'ISO_B_REFUND_REQ',
    status: 'pending',
    requestedBy: usersB.parent._id,
    requestedByName: usersB.parent.profile.fullName
  });

  return {
    testPassword: TEST_PASSWORD,
    tenants: {
      a: tenantA,
      b: tenantB
    },
    usersA,
    usersB,
    manifest: {
      classA,
      classB,
      studentA,
      studentB,
      deptA,
      deptB,
      empA,
      empB,
      shiftA,
      shiftB,
      payrollA,
      payrollB,
      notifA,
      notifB,
      classAnnounceA,
      classAnnounceB,
      internalAnnounceA,
      internalAnnounceB,
      careReportA,
      careReportB,
      convA,
      convB,
      chatMsgA,
      chatMsgB,
      attA,
      attB,
      leaveA,
      leaveB,
      pickupA,
      pickupB,
      visitorA,
      visitorB,
      incidentA,
      incidentB,
      handoverA,
      handoverB,
      deliveryA,
      deliveryB,
      emergencyA,
      emergencyB,
      feedbackA,
      feedbackB,
      profileReqA,
      profileReqB,
      supA,
      supB,
      dishA,
      dishB,
      ingA,
      ingB,
      menuA,
      menuB,
      sampleA,
      sampleB,
      invA,
      invB,
      itemMasterA,
      itemMasterB,
      procReqA,
      procReqB,
      poA,
      poB,
      assetA,
      assetB,
      feeSchedA,
      feeSchedB,
      tuitionFeeA,
      tuitionFeeB,
      paymentA,
      paymentB,
      opExpA,
      opExpB,
      purExpA,
      purExpB,
      refundA,
      refundB
    }
  };
}

module.exports = { generateIsolationFixtures, TEST_PASSWORD };
