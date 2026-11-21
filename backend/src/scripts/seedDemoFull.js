'use strict';

/**
 * @fileoverview Script khởi tạo dữ liệu mẫu toàn diện (Idempotent Demo Seed) cho dự án `school-management-api`.
 *
 * Cách chạy:
 *   cd backend && npm run seed:demo
 *
 * Dữ liệu được tạo an toàn (chạy lại nhiều lần không tạo bản ghi trùng):
 * 1. Hệ thống quyền (`Permission`) và 2 cơ sở trường học Multi-Tenant (`HOANANG-A`, `HOANANG-B`).
 * 2. Đầy đủ 8 nhóm tài khoản theo vai trò (`admin`, `principal`, `hr`, `accountant`, `teacher`, `chef`, `guard`, `parent`)
 *    cùng mật khẩu phát triển thống nhất `123456`.
 * 3. Dữ liệu nghiệp vụ thực tế cho tất cả phân hệ: Lớp học, Học sinh, Điểm danh, Nhật ký chăm sóc, Đón trả trẻ,
 *    Trực cổng bảo vệ, Nhân sự, Ca làm, Bảng lương, Máy chấm công Hikvision & Ánh xạ mã người, Tài chính - Học phí,
 *    Thực đơn - Kho bếp, Mua sắm - Tài sản.
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const { getWorkDate, startOfWorkDate, DEFAULT_SCHOOL_TIMEZONE } = require('../utils/dateHelpers');

// Zone 1: System
const Tenant = require('../models/zone1_system/Tenant');
const Permission = require('../models/zone1_system/Permission');
const User = require('../models/zone1_system/User');
const Notification = require('../models/zone1_system/Notification');
const Conversation = require('../models/zone1_system/Conversation');
const ChatMessage = require('../models/zone1_system/ChatMessage');

// Zone 2: HR & Timekeeping
const Department = require('../models/zone2_hr/Department');
const Employee = require('../models/zone2_hr/Employee');
const StaffShift = require('../models/zone2_hr/StaffShift');
const Payroll = require('../models/zone2_hr/Payroll');
const InternalAnnouncement = require('../models/zone2_hr/InternalAnnouncement');
const TimekeepingDevice = require('../models/zone2_hr/TimekeepingDevice');
const AttendanceDevicePersonMapping = require('../models/zone2_hr/AttendanceDevicePersonMapping');

// Zone 3: School Operations
const Classroom = require('../models/zone3_school/Classroom');
const Student = require('../models/zone3_school/Student');
const StudentCodeCounter = require('../models/zone3_school/StudentCodeCounter');
const StudentAttendance = require('../models/zone3_school/StudentAttendance');
const StudentLeaveRequest = require('../models/zone3_school/StudentLeaveRequest');
const ClassroomAnnouncement = require('../models/zone3_school/ClassroomAnnouncement');
const ClassroomDailyCareReport = require('../models/zone3_school/ClassroomDailyCareReport');
const PickupRecord = require('../models/zone3_school/PickupRecord');
const SchoolVisitor = require('../models/zone3_school/SchoolVisitor');
const GuardShiftHandover = require('../models/zone3_school/GuardShiftHandover');
const SupplierDelivery = require('../models/zone3_school/SupplierDelivery');
const ParentFeedback = require('../models/zone3_school/ParentFeedback');

// Zone 4: Finance
const FeeSchedule = require('../models/zone4_finance/FeeSchedule');
const TuitionFee = require('../models/zone4_finance/TuitionFee');
const Payment = require('../models/zone4_finance/Payment');
const OperatingExpense = require('../models/zone4_finance/OperatingExpense');

// Zone 5: Nutrition
const Supplier = require('../models/zone5_nutrition/Supplier');
const IngredientMaster = require('../models/zone5_nutrition/IngredientMaster');
const Inventory = require('../models/zone5_nutrition/Inventory');
const Dish = require('../models/zone5_nutrition/Dish');
const Menu = require('../models/zone5_nutrition/Menu');
const FoodSample = require('../models/zone5_nutrition/FoodSample');

// Zone 6: Procurement & Assets
const ItemMaster = require('../models/zone6_procurement/ItemMaster');
const ProcurementRequest = require('../models/zone6_procurement/ProcurementRequest');
const PurchaseOrder = require('../models/zone6_procurement/PurchaseOrder');
const Asset = require('../models/zone6_procurement/Asset');

const DEFAULT_DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD || '123456';
const CURRENT_SCHOOL_YEAR = '2026-2027';

const ALL_PERMISSIONS = [
  { name: 'system.manage', module: 'system', resource: 'system', action: 'manage', description: 'Quản trị hệ thống' },
  { name: 'user.manage', module: 'system', resource: 'user', action: 'manage', description: 'Quản lý người dùng' },
  { name: 'student.read', module: 'school', resource: 'student', action: 'read', description: 'Xem danh sách học sinh' },
  { name: 'student.create', module: 'school', resource: 'student', action: 'create', description: 'Thêm học sinh' },
  { name: 'student.update', module: 'school', resource: 'student', action: 'update', description: 'Cập nhật học sinh' },
  { name: 'student.delete', module: 'school', resource: 'student', action: 'delete', description: 'Xóa học sinh' },
  { name: 'student.view_own', module: 'school', resource: 'student', action: 'view_own', description: 'Xem hồ sơ con' },
  { name: 'classroom.read', module: 'school', resource: 'classroom', action: 'read', description: 'Xem lớp học' },
  { name: 'classroom.manage', module: 'school', resource: 'classroom', action: 'manage', description: 'Quản lý lớp học' },
  { name: 'attendance.manage', module: 'school', resource: 'attendance', action: 'manage', description: 'Điểm danh học sinh' },
  { name: 'tuition.read', module: 'finance', resource: 'tuition', action: 'read', description: 'Xem học phí' },
  { name: 'tuition.create', module: 'finance', resource: 'tuition', action: 'create', description: 'Tạo hóa đơn học phí' },
  { name: 'tuition.update', module: 'finance', resource: 'tuition', action: 'update', description: 'Cập nhật hóa đơn' },
  { name: 'payment.create', module: 'finance', resource: 'payment', action: 'create', description: 'Ghi nhận thanh toán' },
  { name: 'finance.report', module: 'finance', resource: 'report', action: 'read', description: 'Báo cáo tài chính' },
  { name: 'menu.manage', module: 'nutrition', resource: 'menu', action: 'manage', description: 'Quản lý thực đơn' },
  { name: 'inventory.manage', module: 'nutrition', resource: 'inventory', action: 'manage', description: 'Quản lý kho bếp' },
  { name: 'ingredient.manage', module: 'nutrition', resource: 'ingredient', action: 'manage', description: 'Quản lý nguyên liệu' },
  { name: 'foodsample.manage', module: 'nutrition', resource: 'foodsample', action: 'manage', description: 'Lưu mẫu thức ăn' },
  { name: 'kitchen.equipment', module: 'nutrition', resource: 'equipment', action: 'manage', description: 'Thiết bị nhà bếp' },
  { name: 'kitchen.staff', module: 'nutrition', resource: 'staff', action: 'manage', description: 'Nhân sự nhà bếp' },
  { name: 'kitchen.financial', module: 'nutrition', resource: 'financial', action: 'read', description: 'Đối soát chi phí bếp' },
  { name: 'procurement.manage', module: 'procurement', resource: 'procurement', action: 'manage', description: 'Quản lý mua sắm' },
  { name: 'asset.manage', module: 'procurement', resource: 'asset', action: 'manage', description: 'Quản lý tài sản' },
  { name: 'attendance.correction', module: 'hr', resource: 'attendance', action: 'approve', description: 'Duyệt điều chỉnh công' },
  { name: 'employee.manage', module: 'hr', resource: 'employee', action: 'manage', description: 'Quản lý hồ sơ nhân sự' },
  { name: 'payroll.manage', module: 'hr', resource: 'payroll', action: 'manage', description: 'Quản lý bảng lương' },
  { name: 'report.read', module: 'report', resource: 'report', action: 'read', description: 'Xem báo cáo tổng hợp' },
  { name: 'report.manage', module: 'report', resource: 'report', action: 'manage', description: 'Quản lý báo cáo' }
];

const ROLE_PERMISSION_NAMES = {
  admin: ALL_PERMISSIONS.map((p) => p.name),
  principal: [
    'student.read', 'classroom.read', 'classroom.manage', 'attendance.manage',
    'tuition.read', 'finance.report', 'report.read', 'report.manage',
    'attendance.correction', 'employee.manage', 'payroll.manage', 'procurement.manage', 'asset.manage'
  ],
  hr: ['user.manage', 'employee.manage', 'payroll.manage', 'attendance.correction', 'report.read'],
  accountant: ['tuition.read', 'tuition.create', 'tuition.update', 'payment.create', 'finance.report', 'report.read'],
  teacher: ['student.read', 'student.create', 'student.update', 'classroom.read', 'attendance.manage'],
  chef: ['menu.manage', 'inventory.manage', 'ingredient.manage', 'foodsample.manage', 'kitchen.equipment', 'kitchen.staff', 'kitchen.financial'],
  guard: ['attendance.manage'],
  parent: ['student.view_own']
};

/**
 * Khởi tạo danh mục quyền dùng chung toàn hệ thống.
 */
const seedPermissionsCatalog = async () => {
  const ops = ALL_PERMISSIONS.map((perm) => ({
    updateOne: {
      filter: { name: perm.name },
      update: { $set: perm },
      upsert: true
    }
  }));
  await Permission.bulkWrite(ops);

  const docs = await Permission.find({}).select('_id name').lean();
  return Object.fromEntries(docs.map((d) => [d.name, d._id]));
};

/**
 * Tạo hoặc cập nhật tài khoản người dùng gắn với từng cơ sở trường học (`tenantId`).
 */
const upsertSchoolUsers = async (tenantId, passwordHash, permMap, definitions) => {
  const result = {};
  for (const def of definitions) {
    const permIds = (ROLE_PERMISSION_NAMES[def.role] || []).map((n) => permMap[n]).filter(Boolean);
    const updateDoc = {
      tenantId,
      username: def.username,
      passwordHash,
      role: def.role,
      permissions: permIds,
      profile: {
        fullName: def.fullName,
        phone: def.phone,
        email: def.email,
        address: def.address || 'Quận Cầu Giấy, Hà Nội'
      },
      status: 'active'
    };
    if (def.employeeId) {
      updateDoc.employeeInfo = {
        employeeId: def.employeeId,
        baseSalary: def.baseSalary || 8500000,
        position: def.position || def.role,
        hireDate: new Date('2024-08-15')
      };
    }

    const user = await User.findOneAndUpdate(
      { tenantId, username: def.username },
      { $set: updateDoc, $setOnInsert: { authVersion: 0 } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    result[def.key || def.role] = user;
  }
  return result;
};

const runSeed = async () => {
  await connectDB();

  // Bước 1: Đồng bộ các compound index cốt lõi của Tenant và User để tránh trùng lặp khi chạy lại
  await Promise.all([
    Tenant.createIndexes().catch(() => {}),
    User.createIndexes().catch(() => {})
  ]);

  const passwordHash = await bcrypt.hash(DEFAULT_DEMO_PASSWORD, 10);
  const permMap = await seedPermissionsCatalog();
  const todayKey = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
  const todayStart = startOfWorkDate(todayKey, DEFAULT_SCHOOL_TIMEZONE);
  const now = new Date();

  // Bước 2: Khởi tạo 2 cơ sở trường học Multi-Tenant (HOANANG-A & HOANANG-B)
  const [tenantA, tenantB] = await Promise.all([
    Tenant.findOneAndUpdate(
      { code: 'HOANANG-A' },
      { $set: { name: 'Trường Mầm non Hoa Nắng - Cơ sở A', code: 'HOANANG-A', status: 'active' } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    ),
    Tenant.findOneAndUpdate(
      { code: 'HOANANG-B' },
      { $set: { name: 'Trường Mầm non Hoa Nắng - Cơ sở B', code: 'HOANANG-B', status: 'active' } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    )
  ]);

  // Gỡ index unique toàn cục cũ trên employeeCode (nếu có) và dọn bản ghi mã chữ cũ trước khi gán dãy số chuẩn 1, 2, 3...
  await Employee.collection.dropIndex('employeeCode_1').catch(() => {});
  await Promise.all([
    Employee.createIndexes().catch(() => {}),
    Student.createIndexes().catch(() => {})
  ]);

  // Bước 3: Khởi tạo đầy đủ 8 vai trò tài khoản cho Cơ sở A (mã số 1 -> 8) và Cơ sở B (mã số 1 -> 7)
  const usersA = await upsertSchoolUsers(tenantA._id, passwordHash, permMap, [
    { key: 'teacher', username: 'teacher', role: 'teacher', fullName: 'Cô Nguyễn Thị Mai', phone: '0901000005', email: 'mai.gv@hoanang-a.edu.vn', employeeId: '1', baseSalary: 9500000 },
    { key: 'admin', username: 'admin', role: 'admin', fullName: 'Nguyễn Minh Quản (Admin)', phone: '0901000001', email: 'admin@hoanang-a.edu.vn', employeeId: '2', baseSalary: 15000000 },
    { key: 'principal', username: 'principal', role: 'principal', fullName: 'Cô Trần Thu Hà (Hiệu trưởng)', phone: '0901000002', email: 'hieutruong@hoanang-a.edu.vn', employeeId: '3', baseSalary: 18000000 },
    { key: 'hr', username: 'hr', role: 'hr', fullName: 'Chị Lê Hoàng Yến (Nhân sự)', phone: '0901000003', email: 'hr@hoanang-a.edu.vn', employeeId: '4', baseSalary: 11000000 },
    { key: 'accountant', username: 'accountant', role: 'accountant', fullName: 'Anh Phạm Quốc Tuấn (Kế toán)', phone: '0901000004', email: 'ketoan@hoanang-a.edu.vn', employeeId: '5', baseSalary: 12000000 },
    { key: 'teacher2', username: 'teacher2', role: 'teacher', fullName: 'Cô Vũ Thanh Lan', phone: '0901000006', email: 'lan.gv@hoanang-a.edu.vn', employeeId: '6', baseSalary: 9200000 },
    { key: 'chef', username: 'chef', role: 'chef', fullName: 'Chú Đặng Văn Hùng (Bếp trưởng)', phone: '0901000007', email: 'bep@hoanang-a.edu.vn', employeeId: '7', baseSalary: 9000000 },
    { key: 'guard', username: 'guard', role: 'guard', fullName: 'Chú Hoàng Văn Bình (Bảo vệ)', phone: '0901000008', email: 'baove@hoanang-a.edu.vn', employeeId: '8', baseSalary: 7500000 },
    { key: 'parent', username: 'parent', role: 'parent', fullName: 'Chị Trần Thị Ngọc (Phụ huynh)', phone: '0909888777', email: 'ngoc.ph@gmail.com' }
  ]);

  const usersB = await upsertSchoolUsers(tenantB._id, passwordHash, permMap, [
    { key: 'admin', username: 'admin_b', role: 'admin', fullName: 'Quản trị Cơ sở B', phone: '0902000001', email: 'admin@hoanang-b.edu.vn', employeeId: '1' },
    { key: 'principal', username: 'principal_b', role: 'principal', fullName: 'Hiệu trưởng Cơ sở B', phone: '0902000002', email: 'ht@hoanang-b.edu.vn', employeeId: '2' },
    { key: 'hr', username: 'hr_b', role: 'hr', fullName: 'Nhân sự Cơ sở B', phone: '0902000003', email: 'hr@hoanang-b.edu.vn', employeeId: '3' },
    { key: 'accountant', username: 'accountant_b', role: 'accountant', fullName: 'Kế toán Cơ sở B', phone: '0902000004', email: 'kt@hoanang-b.edu.vn', employeeId: '4' },
    { key: 'teacher', username: 'teacher_b', role: 'teacher', fullName: 'Cô Giáo Cơ sở B', phone: '0902000005', email: 'gv@hoanang-b.edu.vn', employeeId: '5' },
    { key: 'chef', username: 'chef_b', role: 'chef', fullName: 'Bếp trưởng Cơ sở B', phone: '0902000006', email: 'bep@hoanang-b.edu.vn', employeeId: '6' },
    { key: 'guard', username: 'guard_b', role: 'guard', fullName: 'Bảo vệ Cơ sở B', phone: '0902000007', email: 'bv@hoanang-b.edu.vn', employeeId: '7' },
    { key: 'parent', username: 'parent_b', role: 'parent', fullName: 'Phụ huynh Cơ sở B', phone: '0902000008', email: 'ph@hoanang-b.edu.vn' }
  ]);

  // Bước 4: Khởi tạo Lớp học & Học sinh mầm non cho Cơ sở A và Cơ sở B
  const classroomsDefA = [
    { code: 'MAM_1', name: 'Lớp Mầm 1', fullName: 'Mẫu giáo bé 3–4 tuổi (Mầm 1)', ageGroup: '3-4', grade: 'Mầm', maxSize: 25, teacher: usersA.teacher._id },
    { code: 'CHOI_1', name: 'Lớp Chồi 1', fullName: 'Mẫu giáo nhỡ 4–5 tuổi (Chồi 1)', ageGroup: '4-5', grade: 'Chồi', maxSize: 25, teacher: usersA.teacher2._id },
    { code: 'LA_1', name: 'Lớp Lá 1', fullName: 'Mẫu giáo lớn 5–6 tuổi (Lá 1)', ageGroup: '5-6', grade: 'Lá', maxSize: 28, teacher: null }
  ];

  const classesA = {};
  for (const c of classroomsDefA) {
    classesA[c.code] = await Classroom.findOneAndUpdate(
      { tenantId: tenantA._id, name: c.name, schoolYear: CURRENT_SCHOOL_YEAR },
      {
        $set: {
          tenantId: tenantA._id,
          code: c.code,
          name: c.name,
          fullName: c.fullName,
          ageGroup: c.ageGroup,
          grade: c.grade,
          maxSize: c.maxSize,
          schoolYear: CURRENT_SCHOOL_YEAR,
          homeroomTeacherId: c.teacher,
          status: 'active'
        }
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
  }

  const classB1 = await Classroom.findOneAndUpdate(
    { tenantId: tenantB._id, name: 'Lớp Mầm 1 (Cơ sở B)', schoolYear: CURRENT_SCHOOL_YEAR },
    {
      $set: {
        tenantId: tenantB._id,
        code: 'MAM_1',
        name: 'Lớp Mầm 1 (Cơ sở B)',
        ageGroup: '3-4',
        grade: 'Mầm',
        maxSize: 25,
        schoolYear: CURRENT_SCHOOL_YEAR,
        homeroomTeacherId: usersB.teacher._id,
        status: 'active'
      }
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );

  // Nối tiếp dãy số nguyên cho Học sinh Cơ sở A từ 9 -> 17 (sau 8 nhân sự 1 -> 8)
  await Student.deleteMany({ tenantId: tenantA._id, studentCode: /^HS-/ });
  await Student.deleteMany({ tenantId: tenantB._id, studentCode: /^HS-/ });

  const studentsDefA = [
    { code: '9', fullName: 'Bé Trần Gia Hân', birthDate: '2023-03-15', gender: 'female', classKey: 'MAM_1', pickerName: 'Chị Trần Thị Ngọc', pickerRel: 'Mẹ', pickerPhone: '0909888777' },
    { code: '10', fullName: 'Bé Trần Minh Khôi', birthDate: '2022-05-20', gender: 'male', classKey: 'CHOI_1', pickerName: 'Chị Trần Thị Ngọc', pickerRel: 'Mẹ', pickerPhone: '0909888777' },
    { code: '11', fullName: 'Bé Lê Minh Khang', birthDate: '2023-07-21', gender: 'male', classKey: 'MAM_1', pickerName: 'Anh Lê Văn Dũng', pickerRel: 'Bố', pickerPhone: '0912345003' },
    { code: '12', fullName: 'Bé Phạm Bảo Ngọc', birthDate: '2023-11-06', gender: 'female', classKey: 'MAM_1', pickerName: 'Chị Nguyễn Thu Trang', pickerRel: 'Mẹ', pickerPhone: '0912345004' },
    { code: '13', fullName: 'Bé Nguyễn Đức Anh', birthDate: '2022-02-19', gender: 'male', classKey: 'CHOI_1', pickerName: 'Anh Nguyễn Đức Bình', pickerRel: 'Bố', pickerPhone: '0912345005' },
    { code: '14', fullName: 'Bé Võ Khánh Linh', birthDate: '2022-06-12', gender: 'female', classKey: 'CHOI_1', pickerName: 'Chị Võ Thị Hương', pickerRel: 'Mẹ', pickerPhone: '0912345006' },
    { code: '15', fullName: 'Bé Bùi Thanh Mai', birthDate: '2021-01-30', gender: 'female', classKey: 'LA_1', pickerName: 'Anh Bùi Quốc Khánh', pickerRel: 'Bố', pickerPhone: '0912345007' },
    { code: '16', fullName: 'Bé Hồ Quốc Bảo', birthDate: '2021-05-18', gender: 'male', classKey: 'LA_1', pickerName: 'Chị Phan Thị Thảo', pickerRel: 'Mẹ', pickerPhone: '0912345008' },
    { code: '17', fullName: 'Bé Dương Nhật Minh', birthDate: '2021-10-09', gender: 'male', classKey: 'LA_1', pickerName: 'Anh Dương Văn Sơn', pickerRel: 'Bố', pickerPhone: '0912345009' }
  ];

  const studentsA = [];
  for (const s of studentsDefA) {
    const cls = classesA[s.classKey];
    const doc = await Student.findOneAndUpdate(
      { tenantId: tenantA._id, studentCode: s.code },
      {
        $set: {
          tenantId: tenantA._id,
          studentCode: s.code,
          fullName: s.fullName,
          birthDate: new Date(s.birthDate),
          gender: s.gender,
          classroomId: cls._id,
          className: cls.name,
          schoolYear: CURRENT_SCHOOL_YEAR,
          admissionDate: new Date('2026-08-20'),
          enrollmentDate: new Date('2026-08-20'),
          status: 'enrolled',
          address: 'Phường Dịch Vọng, Cầu Giấy, Hà Nội',
          authorizedPickers: [{
            fullName: s.pickerName,
            relationship: s.pickerRel,
            phone: s.pickerPhone,
            isActive: true
          }]
        }
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    studentsA.push(doc);
  }

  // Đồng bộ thống kê sĩ số cho từng lớp Cơ sở A
  for (const cls of Object.values(classesA)) {
    const inClass = studentsA.filter((st) => String(st.classroomId) === String(cls._id));
    const maleCount = inClass.filter((st) => st.gender === 'male').length;
    const femaleCount = inClass.filter((st) => st.gender === 'female').length;
    await Classroom.updateOne(
      { _id: cls._id },
      { $set: { statistics: { currentStudents: inClass.length, male: maleCount, female: femaleCount } } }
    );
  }

  // Học sinh mẫu bên Cơ sở B (mã số 8 nối tiếp sau 7 nhân sự của Cơ sở B)
  const studentB1 = await Student.findOneAndUpdate(
    { tenantId: tenantB._id, studentCode: '8' },
    {
      $set: {
        tenantId: tenantB._id,
        studentCode: '8',
        fullName: 'Bé Nguyễn Gia Bảo (Cơ sở B)',
        birthDate: new Date('2023-04-12'),
        gender: 'male',
        classroomId: classB1._id,
        className: classB1.name,
        schoolYear: CURRENT_SCHOOL_YEAR,
        status: 'enrolled',
        authorizedPickers: [{ fullName: 'Phụ huynh Cơ sở B', relationship: 'Bố', phone: '0902000008', isActive: true }]
      }
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
  await Classroom.updateOne({ _id: classB1._id }, { $set: { statistics: { currentStudents: 1, male: 1, female: 0 } } });

  // Liên kết tài khoản Phụ huynh với học sinh tương ứng (bắt buộc để mở cổng Phụ huynh)
  await Promise.all([
    User.updateOne(
      { _id: usersA.parent._id },
      { $set: { 'parentInfo.studentIds': [studentsA[0]._id, studentsA[1]._id] } }
    ),
    User.updateOne(
      { _id: usersB.parent._id },
      { $set: { 'parentInfo.studentIds': [studentB1._id] } }
    )
  ]);

  // Bước 5: Điểm danh hôm nay, Nhật ký chăm sóc, Đơn xin nghỉ, Đón trẻ, Trực cổng & Tin nhắn
  for (let i = 0; i < 6; i += 1) {
    const st = studentsA[i];
    await StudentAttendance.findOneAndUpdate(
      { tenantId: tenantA._id, studentId: st._id, attendDate: todayStart },
      {
        $set: {
          tenantId: tenantA._id,
          studentId: st._id,
          studentName: st.fullName,
          classroomId: st.classroomId,
          className: st.className,
          attendDate: todayStart,
          attendanceDateKey: todayKey,
          dateKey: todayKey,
          status: i === 5 ? 'late' : 'present',
          checkInTime: new Date(`${todayKey}T07:${35 + i * 3}:00+07:00`),
          attendanceMethod: i < 2 ? 'face' : 'manual',
          recordedBy: usersA.teacher._id,
          recordedByName: usersA.teacher.profile.fullName,
          note: i === 5 ? 'Phụ huynh báo kẹt xe đến muộn 10 phút' : 'Bé đến lớp vui vẻ, sức khỏe tốt'
        }
      },
      { upsert: true }
    );
  }

  await ClassroomDailyCareReport.findOneAndUpdate(
    { tenantId: tenantA._id, classroomId: classesA.MAM_1._id, dateKey: todayKey },
    {
      $set: {
        tenantId: tenantA._id,
        classroomId: classesA.MAM_1._id,
        className: classesA.MAM_1.name,
        reportDate: now,
        dateKey: todayKey,
        summary: 'Các con ăn hết suất trưa (cháo cá hồi & canh bí đỏ), ngủ trưa ngoan từ 11:45 đến 14:00.',
        recordedBy: usersA.teacher._id,
        recordedByName: usersA.teacher.profile.fullName
      }
    },
    { upsert: true }
  );

  await ClassroomAnnouncement.findOneAndUpdate(
    { tenantId: tenantA._id, classroomId: classesA.MAM_1._id, title: 'Thông báo lịch dã ngoại tháng 11' },
    {
      $set: {
        tenantId: tenantA._id,
        classroomId: classesA.MAM_1._id,
        className: classesA.MAM_1.name,
        title: 'Thông báo lịch dã ngoại tháng 11',
        content: 'Thứ Sáu tuần này lớp Mầm 1 tổ chức hoạt động trải nghiệm vườn sinh thái trong khuôn viên trường.',
        createdBy: usersA.teacher._id,
        createdByName: usersA.teacher.profile.fullName
      }
    },
    { upsert: true }
  );

  await StudentLeaveRequest.findOneAndUpdate(
    { tenantId: tenantA._id, studentId: studentsA[2]._id, startDate: todayKey },
    {
      $set: {
        tenantId: tenantA._id,
        studentId: studentsA[2]._id,
        studentName: studentsA[2].fullName,
        classroomId: studentsA[2].classroomId,
        className: studentsA[2].className,
        requesterId: usersA.parent._id,
        requesterName: 'Anh Lê Văn Dũng',
        startDate: todayKey,
        endDate: todayKey,
        reason: 'Gia đình cho bé đi khám răng định kỳ buổi chiều',
        status: 'pending'
      }
    },
    { upsert: true }
  );

  const firstPicker = studentsA[0].authorizedPickers[0];
  await PickupRecord.findOneAndUpdate(
    { tenantId: tenantA._id, pickupCode: 'DON-HN-001' },
    {
      $set: {
        tenantId: tenantA._id,
        studentId: studentsA[0]._id,
        studentName: studentsA[0].fullName,
        classroomId: studentsA[0].classroomId,
        className: studentsA[0].className,
        requesterId: usersA.parent._id,
        requesterName: usersA.parent.profile.fullName,
        pickupDate: todayKey,
        pickupCode: 'DON-HN-001',
        status: 'scheduled',
        note: 'Mẹ đón bé lúc 16:45 tại cổng chính',
        picker: {
          pickerId: firstPicker._id,
          fullName: firstPicker.fullName,
          phone: firstPicker.phone,
          relationship: firstPicker.relationship
        }
      }
    },
    { upsert: true }
  );

  const conv = await Conversation.findOneAndUpdate(
    { tenantId: tenantA._id, parentId: usersA.parent._id, teacherId: usersA.teacher._id, studentId: studentsA[0]._id },
    {
      $set: {
        tenantId: tenantA._id,
        parentId: usersA.parent._id,
        teacherId: usersA.teacher._id,
        studentId: studentsA[0]._id,
        lastMessageText: 'Dạ vâng, chiều nay cô sẽ chuẩn bị sẵn balo cho bé Gia Hân ạ!',
        lastMessageAt: now
      }
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );

  if ((await ChatMessage.countDocuments({ conversationId: conv._id })) === 0) {
    await ChatMessage.insertMany([
      { tenantId: tenantA._id, conversationId: conv._id, senderId: usersA.parent._id, body: 'Chào cô Mai, sáng nay bé Gia Hân hơi sổ mũi nhẹ, nhờ cô để ý giúp gia đình nhé ạ.' },
      { tenantId: tenantA._id, conversationId: conv._id, senderId: usersA.teacher._id, body: 'Dạ vâng, chiều nay cô sẽ chuẩn bị sẵn balo cho bé Gia Hân ạ!' }
    ]);
  }

  await Promise.all([
    SchoolVisitor.findOneAndUpdate(
      { tenantId: tenantA._id, fullName: 'Nguyễn Hoàng Nam (Phòng Giáo dục)', visitDate: todayKey },
      {
        $set: {
          tenantId: tenantA._id,
          fullName: 'Nguyễn Hoàng Nam (Phòng Giáo dục)',
          phone: '0988112233',
          purpose: 'Kiểm tra công tác an toàn vệ sinh thực phẩm định kỳ',
          hostName: 'Cô Trần Thu Hà',
          visitDate: todayKey,
          checkInAt: now,
          status: 'inside',
          recordedBy: usersA.guard._id,
          recordedByName: usersA.guard.profile.fullName
        }
      },
      { upsert: true }
    ),
    GuardShiftHandover.findOneAndUpdate(
      { tenantId: tenantA._id, handoverDate: todayKey, shiftName: 'morning' },
      {
        $set: {
          tenantId: tenantA._id,
          handoverDate: todayKey,
          shiftName: 'morning',
          receiverName: 'Bảo vệ ca chiều - Anh Tùng',
          handedOverBy: usersA.guard._id,
          handedOverByName: usersA.guard.profile.fullName,
          handedOverAt: now,
          notes: 'Cổng chính và hệ thống camera hoạt động ổn định, đã đón đủ xe thực phẩm lúc 06:30.',
          status: 'pending'
        }
      },
      { upsert: true }
    ),
    SupplierDelivery.findOneAndUpdate(
      { tenantId: tenantA._id, deliveryDate: todayKey, supplierName: 'Công ty Thực phẩm Sạch GreenFarm' },
      {
        $set: {
          tenantId: tenantA._id,
          deliveryDate: todayKey,
          supplierName: 'Công ty Thực phẩm Sạch GreenFarm',
          driverName: 'Anh Phan Văn Tài',
          itemsDescription: '25kg gạo ST25, 15kg thịt thăn heo VietGAP, 20kg rau củ tươi',
          recipientName: usersA.chef.profile.fullName,
          checkInAt: new Date(`${todayKey}T06:30:00+07:00`),
          recordedBy: usersA.guard._id,
          recordedByName: usersA.guard.profile.fullName
        }
      },
      { upsert: true }
    ),
    ParentFeedback.findOneAndUpdate(
      { tenantId: tenantA._id, studentId: studentsA[0]._id, subject: 'Đề xuất bổ sung thêm món sữa hạt buổi xế' },
      {
        $set: {
          tenantId: tenantA._id,
          studentId: studentsA[0]._id,
          studentName: studentsA[0].fullName,
          classroomId: studentsA[0].classroomId,
          parentId: usersA.parent._id,
          parentName: usersA.parent.profile.fullName,
          subject: 'Đề xuất bổ sung thêm món sữa hạt buổi xế',
          message: 'Gia đình rất hài lòng với thực đơn hiện tại, mong nhà trường có thêm sữa hạt óc chó 2 buổi/tuần.',
          category: 'service',
          status: 'pending'
        }
      },
      { upsert: true }
    ),
    Notification.findOneAndUpdate(
      { tenantId: tenantA._id, recipientId: usersA.admin._id, title: 'Hệ thống Hoa Nắng đã sẵn sàng vận hành' },
      {
        $set: {
          tenantId: tenantA._id,
          recipientId: usersA.admin._id,
          title: 'Hệ thống Hoa Nắng đã sẵn sàng vận hành',
          message: 'Toàn bộ phân hệ Quản lý lớp học, Chấm công Hikvision, Tài chính và Dinh dưỡng đã được khởi tạo.',
          type: 'system',
          createdBy: usersA.admin._id
        }
      },
      { upsert: true }
    )
  ]);

  // Bước 6: Nhân sự (Departments, Employees, Shifts, Payroll, Thiết bị chấm công Hikvision & Ánh xạ mẫu)
  const [deptEdu, deptKitchen, deptOps] = await Promise.all([
    Department.findOneAndUpdate(
      { tenantId: tenantA._id, code: 'TO_GIAO_VIEN' },
      { $set: { tenantId: tenantA._id, code: 'TO_GIAO_VIEN', name: 'Tổ Giáo viên Mầm non', status: 'active' } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    ),
    Department.findOneAndUpdate(
      { tenantId: tenantA._id, code: 'TO_DINH_DUONG' },
      { $set: { tenantId: tenantA._id, code: 'TO_DINH_DUONG', name: 'Tổ Dinh dưỡng & Bán trú', status: 'active' } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    ),
    Department.findOneAndUpdate(
      { tenantId: tenantA._id, code: 'TO_VAN_HANH' },
      { $set: { tenantId: tenantA._id, code: 'TO_VAN_HANH', name: 'Tổ Hành chính - Kế toán - An ninh', status: 'active' } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    )
  ]);

  // Dọn các bản ghi Employee mang mã chữ cũ (GV001, NV003...) trước khi chuẩn hóa sang mã số nguyên 1..8
  await Employee.deleteMany({ tenantId: tenantA._id, employeeCode: { $not: /^\d+$/ } });
  await AttendanceDevicePersonMapping.deleteMany({ tenantId: tenantA._id });

  const employeesSeed = [
    { code: '1', user: usersA.teacher, dept: deptEdu._id, position: 'teacher', payrollRole: 'teacher', salary: 9500000 },
    { code: '3', user: usersA.principal, dept: deptOps._id, position: 'principal', payrollRole: 'principal', salary: 18000000 },
    { code: '4', user: usersA.hr, dept: deptOps._id, position: 'hr', payrollRole: 'hr', salary: 11000000 },
    { code: '5', user: usersA.accountant, dept: deptOps._id, position: 'accountant', payrollRole: 'accountant', salary: 12000000 },
    { code: '6', user: usersA.teacher2, dept: deptEdu._id, position: 'teacher', payrollRole: 'teacher', salary: 9200000 },
    { code: '7', user: usersA.chef, dept: deptKitchen._id, position: 'chef', payrollRole: 'chef', salary: 9000000 },
    { code: '8', user: usersA.guard, dept: deptOps._id, position: 'security', payrollRole: 'guard', salary: 7500000 }
  ];

  const empDocs = {};
  for (const e of employeesSeed) {
    const emp = await Employee.findOneAndUpdate(
      { tenantId: tenantA._id, userId: e.user._id },
      {
        $set: {
          tenantId: tenantA._id,
          employeeCode: e.code,
          fullName: e.user.profile.fullName,
          userId: e.user._id,
          departmentId: e.dept,
          position: e.position,
          payrollRole: e.payrollRole,
          salaryConfig: { baseSalary: e.salary, positionAllowance: 1000000, lunchAllowance: 730000 },
          startDate: new Date('2024-08-15'),
          status: 'active'
        }
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    empDocs[e.code] = emp;

    await Payroll.findOneAndUpdate(
      { tenantId: tenantA._id, employeeId: emp._id, month: 11, year: 2026 },
      {
        $set: {
          tenantId: tenantA._id,
          employeeId: emp._id,
          employeeCode: emp.employeeCode,
          employeeName: emp.fullName,
          payrollRole: e.payrollRole,
          month: 11,
          year: 2026,
          baseSalary: e.salary,
          netSalary: e.salary + 1000000 + 730000,
          status: 'paid',
          note: 'Bảng lương tháng 11/2026'
        }
      },
      { upsert: true }
    );
  }

  await StaffShift.findOneAndUpdate(
    { tenantId: tenantA._id, employeeId: empDocs['7']._id, name: 'Ca sáng Bếp bán trú' },
    {
      $set: {
        tenantId: tenantA._id,
        employeeId: empDocs['7']._id,
        role: 'chef',
        name: 'Ca sáng Bếp bán trú',
        startTime: '07:00',
        endTime: '16:30',
        weekdays: [1, 2, 3, 4, 5],
        validFrom: '2026-01-01',
        validUntil: '2026-12-31',
        createdBy: usersA.admin._id
      }
    },
    { upsert: true }
  );

  await InternalAnnouncement.findOneAndUpdate(
    { tenantId: tenantA._id, requestId: 'DEMO-INT-NOTICE-01' },
    {
      $set: {
        tenantId: tenantA._id,
        category: 'general',
        title: 'Lịch họp Hội đồng Sư phạm đầu tuần',
        message: 'Mời các thầy cô và tổ bộ phận họp giao ban lúc 12:15 Thứ Hai tại phòng Hội đồng tầng 2.',
        priority: 'normal',
        targetRoles: ['principal', 'hr', 'accountant', 'teacher', 'chef', 'guard'],
        recipientIds: [usersA.principal._id, usersA.hr._id, usersA.accountant._id, usersA.teacher._id, usersA.chef._id, usersA.guard._id],
        requestId: 'DEMO-INT-NOTICE-01',
        createdBy: usersA.admin._id
      }
    },
    { upsert: true }
  );

  // Đăng ký sẵn Thiết bị chấm công Hikvision mẫu & Bảng ánh xạ mã máy (sẵn sàng cho Bước 2 Webhook)
  const hikDevice = await TimekeepingDevice.findOneAndUpdate(
    { tenantId: tenantA._id, deviceCode: 'HIK-GATE-01' },
    {
      $set: {
        tenantId: tenantA._id,
        deviceCode: 'HIK-GATE-01',
        name: 'Máy chấm công Khuôn mặt Hikvision Cổng chính',
        vendor: 'HIKVISION',
        model: 'DS-K1T320MX',
        host: '192.168.1.8',
        protocol: 'PUSH_API',
        enabled: true,
        status: 'ONLINE',
        credentialKey: 'HIKVISION_HOANANG_A',
        createdBy: usersA.admin._id
      }
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );

  // Nhờ dùng chung 1 dãy số nguyên (Nhân sự: 1..8, Học sinh: 9..17), hệ thống tự động nhận diện trực tiếp
  // theo employeeId / studentCode mà không bắt buộc phải tạo bản ghi phụ trong AttendanceDevicePersonMapping!
  await Promise.all([
    StudentCodeCounter.findOneAndUpdate(
      { tenantId: tenantA._id, year: 0 },
      { $set: { sequence: 17, tenantId: tenantA._id, year: 0 } },
      { upsert: true }
    ),
    StudentCodeCounter.findOneAndUpdate(
      { tenantId: tenantB._id, year: 0 },
      { $set: { sequence: 8, tenantId: tenantB._id, year: 0 } },
      { upsert: true }
    )
  ]);

  // Bước 7: Tài chính & Học phí (FeeSchedule, TuitionFee, Payment, OperatingExpense)
  await FeeSchedule.findOneAndUpdate(
    { tenantId: tenantA._id, period: '11-2026', classroomId: classesA.MAM_1._id },
    {
      $set: {
        tenantId: tenantA._id,
        period: '11-2026',
        classroomId: classesA.MAM_1._id,
        classroomName: classesA.MAM_1.name,
        tuitionBase: 3200000,
        mealFee: 1100000,
        totalAmount: 4300000,
        dueDate: new Date('2026-11-25'),
        note: 'Biểu phí chuẩn tháng 11/2026 khối Mầm'
      }
    },
    { upsert: true }
  );

  const invoicePaid = await TuitionFee.findOneAndUpdate(
    { tenantId: tenantA._id, studentId: studentsA[0]._id, period: '11-2026' },
    {
      $set: {
        tenantId: tenantA._id,
        studentId: studentsA[0]._id,
        studentName: studentsA[0].fullName,
        classroomId: studentsA[0].classroomId,
        className: studentsA[0].className,
        period: '11-2026',
        tuitionBase: 3200000,
        mealFee: 1100000,
        totalAmount: 4300000,
        paidAmount: 4300000,
        remainingAmount: 0,
        dueDate: new Date('2026-11-25'),
        status: 'paid',
        note: 'Học phí & tiền ăn bán trú tháng 11/2026'
      }
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );

  await TuitionFee.findOneAndUpdate(
    { tenantId: tenantA._id, studentId: studentsA[1]._id, period: '11-2026' },
    {
      $set: {
        tenantId: tenantA._id,
        studentId: studentsA[1]._id,
        studentName: studentsA[1].fullName,
        classroomId: studentsA[1].classroomId,
        className: studentsA[1].className,
        period: '11-2026',
        tuitionBase: 3400000,
        mealFee: 1100000,
        totalAmount: 4500000,
        paidAmount: 0,
        remainingAmount: 4500000,
        dueDate: new Date('2026-11-25'),
        status: 'unpaid',
        note: 'Học phí & tiền ăn bán trú tháng 11/2026 (Chờ thanh toán)'
      }
    },
    { upsert: true }
  );

  await Payment.findOneAndUpdate(
    { tenantId: tenantA._id, receiptNumber: 'PT-202611-0001' },
    {
      $set: {
        tenantId: tenantA._id,
        invoiceId: invoicePaid._id,
        amount: 4300000,
        method: 'bank_transfer',
        txnRef: 'VCB-99887766',
        receiptNumber: 'PT-202611-0001',
        idempotencyKey: 'SEED-PAY-HN-A-0001',
        recordedBy: usersA.accountant._id,
        note: 'Phụ huynh chuyển khoản học phí tháng 11 cho bé Trần Gia Hân'
      }
    },
    { upsert: true }
  );

  await OperatingExpense.findOneAndUpdate(
    { tenantId: tenantA._id, documentNumber: 'PC-202611-0001' },
    {
      $set: {
        tenantId: tenantA._id,
        category: 'utilities',
        payee: 'Công ty Điện lực Cầu Giấy',
        description: 'Thanh toán tiền điện sinh hoạt và điều hòa lớp học tháng 11/2026',
        amount: 6850000,
        paidAt: now,
        method: 'bank_transfer',
        documentNumber: 'PC-202611-0001',
        approvalReference: 'DUYET-BGH-1101',
        idempotencyKey: 'SEED-EXP-HN-A-0001',
        recordedBy: usersA.accountant._id,
        recordedByName: usersA.accountant.profile.fullName
      }
    },
    { upsert: true }
  );

  // Bước 8: Dinh dưỡng & Nhà bếp (Supplier, Ingredient, Inventory, Dish, Menu, FoodSample)
  const supplier = await Supplier.findOneAndUpdate(
    { tenantId: tenantA._id, code: 'NCC-GREENFARM' },
    {
      $set: {
        tenantId: tenantA._id,
        code: 'NCC-GREENFARM',
        name: 'Công ty Thực phẩm Sạch GreenFarm',
        phone: '0905123456',
        address: 'Khu Công nghiệp Bắc Thăng Long, Hà Nội',
        status: 'active'
      }
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );

  const [ingRice, ingSalmon] = await Promise.all([
    IngredientMaster.findOneAndUpdate(
      { tenantId: tenantA._id, code: 'NL-GAO-ST25' },
      { $set: { tenantId: tenantA._id, code: 'NL-GAO-ST25', name: 'Gạo thơm ST25 hữu cơ', category: 'grain', unit: 'kg' } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    ),
    IngredientMaster.findOneAndUpdate(
      { tenantId: tenantA._id, code: 'NL-CA-HOI' },
      { $set: { tenantId: tenantA._id, code: 'NL-CA-HOI', name: 'Phi lê cá hồi tươi Na Uy', category: 'seafood', unit: 'kg' } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    )
  ]);

  await Promise.all([
    Inventory.findOneAndUpdate(
      { tenantId: tenantA._id, ingredientId: ingRice._id, batchNumber: 'LO-GAO-202611' },
      {
        $set: {
          tenantId: tenantA._id,
          ingredientId: ingRice._id,
          ingredientName: ingRice.name,
          batchNumber: 'LO-GAO-202611',
          quantity: 120,
          unit: 'kg',
          expiryDate: new Date('2027-05-30')
        }
      },
      { upsert: true }
    ),
    Inventory.findOneAndUpdate(
      { tenantId: tenantA._id, ingredientId: ingSalmon._id, batchNumber: 'LO-CAHOI-202611' },
      {
        $set: {
          tenantId: tenantA._id,
          ingredientId: ingSalmon._id,
          ingredientName: ingSalmon.name,
          batchNumber: 'LO-CAHOI-202611',
          quantity: 18,
          unit: 'kg',
          expiryDate: new Date('2026-11-28')
        }
      },
      { upsert: true }
    ),
    Dish.findOneAndUpdate(
      { tenantId: tenantA._id, name: 'Cháo cá hồi bí đỏ phô mai' },
      { $set: { tenantId: tenantA._id, name: 'Cháo cá hồi bí đỏ phô mai', category: 'main_course', mealType: 'lunch', ageGroups: ['3-4', '4-5', '5-6'], status: 'active' } },
      { upsert: true }
    ),
    Dish.findOneAndUpdate(
      { tenantId: tenantA._id, name: 'Canh sườn non hầm củ quả' },
      { $set: { tenantId: tenantA._id, name: 'Canh sườn non hầm củ quả', category: 'soup', mealType: 'lunch', ageGroups: ['3-4', '4-5', '5-6'], status: 'active' } },
      { upsert: true }
    ),
    Menu.findOneAndUpdate(
      { tenantId: tenantA._id, classroomId: classesA.MAM_1._id, weekNumber: 47, schoolYear: CURRENT_SCHOOL_YEAR },
      {
        $set: {
          tenantId: tenantA._id,
          classroomId: classesA.MAM_1._id,
          className: classesA.MAM_1.name,
          weekNumber: 47,
          schoolYear: CURRENT_SCHOOL_YEAR,
          startDate: new Date('2026-11-16'),
          endDate: new Date('2026-11-22'),
          approvalNote: 'Thực đơn tuần 47 giàu DHA và vitamin mùa thu đông',
          status: 'published'
        }
      },
      { upsert: true }
    ),
    FoodSample.findOneAndUpdate(
      { tenantId: tenantA._id, sampleCode: 'MAU-20261121-TRUA' },
      {
        $set: {
          tenantId: tenantA._id,
          sampleCode: 'MAU-20261121-TRUA',
          mealDate: now,
          mealType: 'lunch',
          dishName: 'Cháo cá hồi bí đỏ phô mai',
          sampleWeightGram: 150,
          storedBy: usersA.chef._id,
          storedByName: usersA.chef.profile.fullName
        }
      },
      { upsert: true }
    )
  ]);

  // Bước 9: Mua sắm & Cơ sở vật chất (ItemMaster, ProcurementRequest, PurchaseOrder, Asset)
  const itemAirPurifier = await ItemMaster.findOneAndUpdate(
    { tenantId: tenantA._id, name: 'Máy lọc không khí kháng khuẩn lớp học' },
    { $set: { tenantId: tenantA._id, name: 'Máy lọc không khí kháng khuẩn lớp học', category: 'equipment', unit: 'piece' } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );

  let procReq = await ProcurementRequest.findOne({ tenantId: tenantA._id, reason: 'Trang bị máy lọc không khí cho 3 lớp mầm non mùa đông' });
  if (!procReq) {
    procReq = await ProcurementRequest.create({
      tenantId: tenantA._id,
      requesterId: usersA.teacher._id,
      requesterName: usersA.teacher.profile.fullName,
      category: 'equipment',
      reason: 'Trang bị máy lọc không khí cho 3 lớp mầm non mùa đông',
      status: 'approved_l2',
      totalEstimatedCost: 13500000,
      items: [{ itemName: 'Máy lọc không khí Sharp FP-J60E', quantity: 3, estimatedPrice: 4500000, totalEstimated: 13500000 }]
    });
  }

  await Promise.all([
    PurchaseOrder.findOneAndUpdate(
      { tenantId: tenantA._id, orderCode: 'PO-202611-001' },
      {
        $set: {
          tenantId: tenantA._id,
          orderCode: 'PO-202611-001',
          requestId: procReq._id,
          supplierId: supplier._id,
          supplierName: 'Điện máy Giáo dục Thủ Đô',
          totalAmount: 13500000,
          createdBy: usersA.admin._id,
          status: 'ordered',
          expectedDelivery: new Date('2026-11-26'),
          items: [{ itemName: 'Máy lọc không khí Sharp FP-J60E', quantity: 3, unitPrice: 4500000, totalPrice: 13500000 }]
        }
      },
      { upsert: true }
    ),
    Asset.findOneAndUpdate(
      { tenantId: tenantA._id, qrCode: 'TS-HOANANG-A-001' },
      {
        $set: {
          tenantId: tenantA._id,
          itemId: itemAirPurifier._id,
          name: 'Máy lọc không khí Lớp Mầm 1',
          category: 'equipment',
          originalCost: 4500000,
          qrCode: 'TS-HOANANG-A-001',
          serialNumber: 'SHARP-HN-0001',
          status: 'active'
        }
      },
      { upsert: true }
    ),
    Asset.findOneAndUpdate(
      { tenantId: tenantA._id, qrCode: 'TS-HOANANG-A-002' },
      {
        $set: {
          tenantId: tenantA._id,
          itemId: itemAirPurifier._id,
          name: 'Tivi tương tác thông minh 65 inch Lớp Chồi 1',
          category: 'it',
          originalCost: 16500000,
          qrCode: 'TS-HOANANG-A-002',
          serialNumber: 'TV65-HN-0002',
          status: 'active'
        }
      },
      { upsert: true }
    )
  ]);

  console.log('\n====================================================================');
  console.log('🎉 KHỞI TẠO DỮ LIỆU GIẢ & TÀI KHOẢN MẪU HOÀN TẤT!');
  console.log('====================================================================');
  console.log(`📌 Mã trường chính (School Code): HOANANG-A  | Mật khẩu chung: ${DEFAULT_DEMO_PASSWORD}`);
  console.log('   1. Quản trị viên (Admin)     : admin');
  console.log('   2. Hiệu trưởng (Principal)   : principal');
  console.log('   3. Nhân sự (HR)              : hr');
  console.log('   4. Kế toán (Accountant)      : accountant');
  console.log('   5. Giáo viên (Teacher)       : teacher   (hoặc teacher2)');
  console.log('   6. Bếp trưởng (Chef)         : chef');
  console.log('   7. Bảo vệ (Guard)            : guard');
  console.log('   8. Phụ huynh (Parent)        : parent    (gắn 2 bé: Gia Hân & Minh Khôi)');
  console.log('--------------------------------------------------------------------');
  console.log(`📌 Mã trường đối chứng 2        : HOANANG-B  | Mật khẩu chung: ${DEFAULT_DEMO_PASSWORD}`);
  console.log('   admin_b, principal_b, hr_b, accountant_b, teacher_b, chef_b, guard_b, parent_b');
  console.log('====================================================================\n');
};

runSeed()
  .catch((err) => {
    console.error('❌ Lỗi khi khởi tạo dữ liệu mẫu:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
