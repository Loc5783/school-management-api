/**
 * Task 1D.2: Quản lý tài khoản nội bộ và đồng bộ Employee–User theo tenant
 *
 * File: backend/tests/saas/phase1d2_internal_accounts_scoping.test.js
 *
 * Kiểm chứng toàn diện:
 * - Nhóm A: Đọc danh sách tài khoản nội bộ (listInternalAccounts) theo tenant, metadata Employee không rò chéo.
 * - Nhóm B: Tạo tài khoản và hồ sơ nhân sự nguyên tử (createInternalAccount), kiểm tra trùng username theo tenant,
 *   bảo đảm transaction rollback khi lỗi Employee hoặc Audit, phân loại lỗi E11000.
 * - Nhóm C: Cập nhật tài khoản và đổi vai trò (updateInternalAccount & updateInternalAccountRole), bảo vệ ID chéo trường (404),
 *   phát hiện liên kết ngoại lai (409), bảo vệ giáo viên đang phân công lớp (chủ nhiệm homeroomTeacherId và giáo viên giảng dạy teachers),
 *   bảo vệ nhân viên đã nghỉ việc, hỗ trợ tài khoản thiếu Employee, rollback 100% khi audit lỗi cho cả có và không có Employee,
 *   củng cố bằng chứng vô hiệu hóa token cũ (401 AUTH_VERSION_MISMATCH) khi đổi role hoặc đổi password.
 * - Nhóm D: Phân quyền RBAC (teacher/parent bị chặn 403, HR không quản lý principal, không tự sửa/thu hồi chính mình, không nâng quyền admin).
 * - Nhóm E: Thu hồi tài khoản (deactivateInternalAccount), tăng authVersion, vô hiệu hóa token cũ trên schoolAuthMiddleware thật, cách ly tenant B.
 * - Nhóm F: Legacy isolation và fail-closed feature gate trên createSaasApp (HTTP 501).
 */

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';

jest.setTimeout(60000);

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');

const testDbBootstrap = require('../../src/saas/testDbBootstrap');
const createSaasApp = require('../../src/saas/createSaasApp');
const schoolAuthMiddleware = require('../../src/saas/middlewares/schoolAuthMiddleware');
const legacyAuth = require('../../src/middlewares/auth');
const roleCheck = require('../../src/middlewares/roleCheck');
const hrAccessAudit = require('../../src/middlewares/hrAccessAudit');

const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const Employee = require('../../src/models/zone2_hr/Employee');
const Classroom = require('../../src/models/zone3_school/Classroom');
const AuditLog = require('../../src/models/zone1_system/AuditLog');

const {
  listInternalAccounts,
  createInternalAccount,
  updateInternalAccountRole,
  updateInternalAccount,
  deactivateInternalAccount
} = require('../../src/controllers/systemUserController');

const { generateSchoolUserToken } = require('../../src/saas/utils/saasJwt');
const { generateToken: generateLegacyToken } = require('../../src/utils/jwt');
const { hashPassword, comparePassword } = require('../../src/utils/passwordHash');

// Build SaaS test harness app using real schoolAuthMiddleware and roleCheck
const buildSaasApp = () => {
  const app = express();
  app.use(express.json());

  const router = express.Router();
  router.use(schoolAuthMiddleware);

  // Endpoint without roleCheck to directly verify schoolAuthMiddleware authentication without role interference
  router.get('/me', (req, res) => {
    res.json({
      success: true,
      message: 'Thông tin phiên hợp lệ',
      user: {
        _id: req.user._id,
        username: req.user.username,
        role: req.user.role,
        authVersion: req.user.authVersion
      }
    });
  });

  router.use(hrAccessAudit('accounts'));
  router.get('/accounts', roleCheck(['admin', 'hr']), listInternalAccounts);
  router.post('/accounts', roleCheck(['admin', 'hr']), createInternalAccount);
  router.patch('/accounts/:id', roleCheck(['admin', 'hr']), updateInternalAccount);
  router.patch('/accounts/:id/role', roleCheck(['admin', 'hr']), updateInternalAccountRole);
  router.delete('/accounts/:id', roleCheck(['admin', 'hr']), deactivateInternalAccount);

  app.use('/api/v1/system', router);
  return app;
};

// Build Legacy test harness app using real legacyAuth and roleCheck
const buildLegacyApp = () => {
  const app = express();
  app.use(express.json());

  const router = express.Router();
  router.use(legacyAuth);
  router.use(hrAccessAudit('accounts'));
  router.get('/accounts', roleCheck(['admin', 'hr']), listInternalAccounts);
  router.post('/accounts', roleCheck(['admin', 'hr']), createInternalAccount);
  router.patch('/accounts/:id', roleCheck(['admin', 'hr']), updateInternalAccount);
  router.patch('/accounts/:id/role', roleCheck(['admin', 'hr']), updateInternalAccountRole);
  router.delete('/accounts/:id', roleCheck(['admin', 'hr']), deactivateInternalAccount);

  app.use('/api/v1/system', router);
  return app;
};

describe('Task 1D.2 — Quản Lý Tài Khoản Nội Bộ và Đồng Bộ Employee–User Theo Tenant', () => {
  let bootstrapInstance;
  let mongoUri;
  let saasApp;
  let legacyApp;

  // Tenants
  let tenantA;
  let tenantB;

  // Tokens
  let tokenAdminA;
  let tokenHrA;
  let tokenTeacherA;
  let tokenParentA;
  let tokenAdminB;
  let tokenTeacherB;
  let tokenLegacyAdmin;
  let tokenLegacyTeacher;

  // Fixture Users
  let adminA;
  let hrA;
  let principalA;
  let teacherA;
  let parentA;
  let userA_NoEmp;
  let userA_Corrupted;
  let userA_Resigned;
  let userA_Assigned;
  let userA_HomeroomOnly;
  let userA_TeachersOnly;
  let userA_InactiveClass;

  let adminB;
  let teacherB;

  let legacyAdmin;
  let legacyTeacherMissing;
  let legacyTeacherNull;

  // Fixture Employees
  let empTeacherA;
  let empResignedA;
  let empAssignedA;
  let empHomeroomA;
  let empTeachersOnlyA;
  let empInactiveClassA;
  let empTeacherB;
  let empCorruptedAlien;
  let empLegacyMissing;
  let empLegacyNull;

  // Fixture Classrooms
  let classroomA;
  let classroomA_HR;
  let classroomA_T;
  let classroomA_Inactive;
  let classroomB;

  beforeAll(async () => {
    bootstrapInstance = await testDbBootstrap.startTestDb({
      instanceOpts: [{ dbName: 'school_saas_phase1d2_test' }]
    });
    mongoUri = bootstrapInstance.uri;

    saasApp = buildSaasApp();
    legacyApp = buildLegacyApp();

    await Promise.all([
      Tenant.syncIndexes(),
      User.syncIndexes(),
      Employee.syncIndexes(),
      Classroom.syncIndexes(),
      AuditLog.syncIndexes()
    ]);
  });

  afterAll(async () => {
    if (bootstrapInstance) {
      await bootstrapInstance.stop();
    }
  });

  beforeEach(async () => {
    await Promise.all([
      Tenant.deleteMany({}),
      User.deleteMany({}),
      Employee.deleteMany({}),
      Classroom.deleteMany({}),
      AuditLog.deleteMany({})
    ]);

    const passwordHash = await hashPassword('Password123@#');

    // 1. Create Tenants
    tenantA = await Tenant.create({
      code: 'TRUONGA',
      name: 'Trường Mầm Non Ánh Dương A',
      status: 'active',
      subscriptionPlan: 'standard',
      authVersion: 0
    });

    tenantB = await Tenant.create({
      code: 'TRUONGB',
      name: 'Trường Mầm Non Bình Minh B',
      status: 'active',
      subscriptionPlan: 'standard',
      authVersion: 0
    });

    // 2. Users for Tenant A
    adminA = await User.create({
      tenantId: tenantA._id,
      username: 'admin_a',
      passwordHash,
      role: 'admin',
      status: 'active',
      authVersion: 0,
      profile: { fullName: 'Admin Trường A', phone: '0901000001', email: 'admin@truonga.edu.vn' }
    });

    hrA = await User.create({
      tenantId: tenantA._id,
      username: 'hr_a',
      passwordHash,
      role: 'hr',
      status: 'active',
      authVersion: 0,
      profile: { fullName: 'Nhân Sự Trường A', phone: '0901000002', email: 'hr@truonga.edu.vn' }
    });

    principalA = await User.create({
      tenantId: tenantA._id,
      username: 'principal_a',
      passwordHash,
      role: 'principal',
      status: 'active',
      authVersion: 0,
      profile: { fullName: 'Hiệu Trưởng Trường A', phone: '0901000003', email: 'principal@truonga.edu.vn' }
    });

    teacherA = await User.create({
      tenantId: tenantA._id,
      username: 'teacher_a',
      passwordHash,
      role: 'teacher',
      status: 'active',
      authVersion: 0,
      profile: { fullName: 'Cô Nguyễn Thị Hoa A', phone: '0901000004', email: 'hoa@truonga.edu.vn' }
    });

    parentA = await User.create({
      tenantId: tenantA._id,
      username: 'parent_a',
      passwordHash,
      role: 'parent',
      status: 'active',
      authVersion: 0,
      profile: { fullName: 'Phụ Huynh A', phone: '0901000005', email: 'parent@truonga.edu.vn' }
    });

    userA_NoEmp = await User.create({
      tenantId: tenantA._id,
      username: 'chef_no_emp_a',
      passwordHash,
      role: 'chef',
      status: 'active',
      authVersion: 0,
      profile: { fullName: 'Đầu Bếp Không Hồ Sơ A', phone: '0901000006', email: 'bep@truonga.edu.vn' }
    });

    userA_Corrupted = await User.create({
      tenantId: tenantA._id,
      username: 'user_corrupted_a',
      passwordHash,
      role: 'teacher',
      status: 'active',
      authVersion: 0,
      profile: { fullName: 'Người Dùng Bị Lệch Hồ Sơ', phone: '0901000007', email: 'corrupt@truonga.edu.vn' }
    });

    userA_Resigned = await User.create({
      tenantId: tenantA._id,
      username: 'guard_resigned_a',
      passwordHash,
      role: 'guard',
      status: 'inactive',
      authVersion: 0,
      profile: { fullName: 'Bảo Vệ Đã Nghỉ Việc A', phone: '0901000008', email: 'guard_resigned@truonga.edu.vn' }
    });

    userA_Assigned = await User.create({
      tenantId: tenantA._id,
      username: 'teacher_assigned_a',
      passwordHash,
      role: 'teacher',
      status: 'active',
      authVersion: 0,
      profile: { fullName: 'Giáo Viên Đang Phân Công A', phone: '0901000009', email: 'assigned@truonga.edu.vn' }
    });

    userA_HomeroomOnly = await User.create({
      tenantId: tenantA._id,
      username: 'teacher_homeroom_only_a',
      passwordHash,
      role: 'teacher',
      status: 'active',
      authVersion: 0,
      profile: { fullName: 'Giáo Viên Chỉ Làm Chủ Nhiệm A', phone: '0901000010', email: 'homeroom_only@truonga.edu.vn' }
    });

    userA_TeachersOnly = await User.create({
      tenantId: tenantA._id,
      username: 'teacher_teachers_only_a',
      passwordHash,
      role: 'teacher',
      status: 'active',
      authVersion: 0,
      profile: { fullName: 'Giáo Viên Chỉ Phụ Trách Lớp A', phone: '0901000011', email: 'teachers_only@truonga.edu.vn' }
    });

    userA_InactiveClass = await User.create({
      tenantId: tenantA._id,
      username: 'teacher_inactive_class_a',
      passwordHash,
      role: 'teacher',
      status: 'active',
      authVersion: 0,
      profile: { fullName: 'Giáo Viên Lớp Đã Đóng A', phone: '0901000012', email: 'inactive_class@truonga.edu.vn' }
    });

    // 3. Users for Tenant B
    adminB = await User.create({
      tenantId: tenantB._id,
      username: 'admin_b',
      passwordHash,
      role: 'admin',
      status: 'active',
      authVersion: 0,
      profile: { fullName: 'Admin Trường B', phone: '0902000001', email: 'admin@truongb.edu.vn' }
    });

    teacherB = await User.create({
      tenantId: tenantB._id,
      username: 'teacher_b',
      passwordHash,
      role: 'teacher',
      status: 'active',
      authVersion: 0,
      profile: { fullName: 'Thầy Lê Văn B', phone: '0902000002', email: 'levanb@truongb.edu.vn' }
    });

    // 4. Users for Legacy
    legacyAdmin = await User.create({
      tenantId: null,
      username: 'legacy_admin',
      passwordHash,
      role: 'admin',
      status: 'active',
      authVersion: 0,
      profile: { fullName: 'Quản Trị Legacy', phone: '0903000001', email: 'legacy_admin@system.local' }
    });

    legacyTeacherMissing = await User.create({
      username: 'legacy_teacher_missing',
      passwordHash,
      role: 'teacher',
      status: 'active',
      authVersion: 0,
      profile: { fullName: 'Giáo Viên Legacy Thiếu Tenant', phone: '0903000002', email: 'leg_teacher1@system.local' }
    });

    legacyTeacherNull = await User.create({
      tenantId: null,
      username: 'legacy_teacher_null',
      passwordHash,
      role: 'teacher',
      status: 'active',
      authVersion: 0,
      profile: { fullName: 'Giáo Viên Legacy Null Tenant', phone: '0903000003', email: 'leg_teacher2@system.local' }
    });

    // 5. Employees
    empTeacherA = await Employee.create({
      tenantId: tenantA._id,
      userId: teacherA._id,
      employeeCode: 'GV-2026-A00001',
      fullName: teacherA.profile.fullName,
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active',
      salaryConfig: { baseSalary: 6000000 }
    });
    teacherA.employeeInfo = { employeeId: empTeacherA.employeeCode, position: 'teacher', baseSalary: 6000000 };
    await teacherA.save();

    empResignedA = await Employee.create({
      tenantId: tenantA._id,
      userId: userA_Resigned._id,
      employeeCode: 'BV-2026-A00002',
      fullName: userA_Resigned.profile.fullName,
      position: 'security',
      payrollRole: 'guard',
      status: 'resigned',
      salaryConfig: { baseSalary: 5000000 }
    });

    empAssignedA = await Employee.create({
      tenantId: tenantA._id,
      userId: userA_Assigned._id,
      employeeCode: 'GV-2026-A00003',
      fullName: userA_Assigned.profile.fullName,
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active',
      salaryConfig: { baseSalary: 6000000 }
    });
    userA_Assigned.employeeInfo = { employeeId: empAssignedA.employeeCode, position: 'teacher', baseSalary: 6000000 };
    await userA_Assigned.save();

    empHomeroomA = await Employee.create({
      tenantId: tenantA._id,
      userId: userA_HomeroomOnly._id,
      employeeCode: 'GV-2026-A00004',
      fullName: userA_HomeroomOnly.profile.fullName,
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active',
      salaryConfig: { baseSalary: 6000000 }
    });
    userA_HomeroomOnly.employeeInfo = { employeeId: empHomeroomA.employeeCode, position: 'teacher', baseSalary: 6000000 };
    await userA_HomeroomOnly.save();

    empTeachersOnlyA = await Employee.create({
      tenantId: tenantA._id,
      userId: userA_TeachersOnly._id,
      employeeCode: 'GV-2026-A00005',
      fullName: userA_TeachersOnly.profile.fullName,
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active',
      salaryConfig: { baseSalary: 6000000 }
    });
    userA_TeachersOnly.employeeInfo = { employeeId: empTeachersOnlyA.employeeCode, position: 'teacher', baseSalary: 6000000 };
    await userA_TeachersOnly.save();

    empInactiveClassA = await Employee.create({
      tenantId: tenantA._id,
      userId: userA_InactiveClass._id,
      employeeCode: 'GV-2026-A00006',
      fullName: userA_InactiveClass.profile.fullName,
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active',
      salaryConfig: { baseSalary: 6000000 }
    });
    userA_InactiveClass.employeeInfo = { employeeId: empInactiveClassA.employeeCode, position: 'teacher', baseSalary: 6000000 };
    await userA_InactiveClass.save();

    empTeacherB = await Employee.create({
      tenantId: tenantB._id,
      userId: teacherB._id,
      employeeCode: 'GV-2026-B00001',
      fullName: teacherB.profile.fullName,
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active',
      salaryConfig: { baseSalary: 6500000 }
    });
    teacherB.employeeInfo = { employeeId: empTeacherB.employeeCode, position: 'teacher', baseSalary: 6500000 };
    await teacherB.save();

    // Alien fixture: Employee belongs to Tenant B, but points to userA_Corrupted of Tenant A!
    empCorruptedAlien = await Employee.create({
      tenantId: tenantB._id,
      userId: userA_Corrupted._id,
      employeeCode: 'GV-2026-ALIEN01',
      fullName: 'Hồ Sơ Thuộc Tenant B Nhưng Trỏ Nhầm User A',
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active',
      salaryConfig: { baseSalary: 6000000 }
    });

    empLegacyMissing = await Employee.create({
      userId: legacyTeacherMissing._id,
      employeeCode: 'GV-2026-LEG001',
      fullName: legacyTeacherMissing.profile.fullName,
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active',
      salaryConfig: { baseSalary: 5000000 }
    });

    empLegacyNull = await Employee.create({
      tenantId: null,
      userId: legacyTeacherNull._id,
      employeeCode: 'GV-2026-LEG002',
      fullName: legacyTeacherNull.profile.fullName,
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active',
      salaryConfig: { baseSalary: 5000000 }
    });

    // 6. Classrooms
    classroomA = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Mầm A1',
      fullName: 'Lớp Mầm Ánh Dương A1',
      ageGroup: '3-4',
      status: 'active',
      homeroomTeacherId: userA_Assigned._id,
      teachers: [{ teacherId: userA_Assigned._id }]
    });

    classroomA_HR = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Chồi A2',
      fullName: 'Lớp Chồi Ánh Dương A2',
      ageGroup: '4-5',
      status: 'active',
      homeroomTeacherId: userA_HomeroomOnly._id,
      teachers: []
    });

    classroomA_T = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Lá A3',
      fullName: 'Lớp Lá Ánh Dương A3',
      ageGroup: '5-6',
      status: 'active',
      homeroomTeacherId: null,
      teachers: [{ teacherId: userA_TeachersOnly._id }]
    });

    classroomA_Inactive = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Mầm A-Old',
      fullName: 'Lớp Mầm Niên Khóa Cũ Đã Đóng',
      ageGroup: '3-4',
      status: 'archived',
      homeroomTeacherId: userA_InactiveClass._id,
      teachers: [{ teacherId: userA_InactiveClass._id }]
    });

    classroomB = await Classroom.create({
      tenantId: tenantB._id,
      name: 'Lớp Chồi B1',
      fullName: 'Lớp Chồi Bình Minh B1',
      ageGroup: '4-5',
      status: 'active',
      homeroomTeacherId: teacherB._id,
      teachers: [{ teacherId: teacherB._id }]
    });

    // 7. Tokens
    tokenAdminA = generateSchoolUserToken(adminA, tenantA);
    tokenHrA = generateSchoolUserToken(hrA, tenantA);
    tokenTeacherA = generateSchoolUserToken(teacherA, tenantA);
    tokenParentA = generateSchoolUserToken(parentA, tenantA);

    tokenAdminB = generateSchoolUserToken(adminB, tenantB);
    tokenTeacherB = generateSchoolUserToken(teacherB, tenantB);

    tokenLegacyAdmin = generateLegacyToken(legacyAdmin);
    tokenLegacyTeacher = generateLegacyToken(legacyTeacherMissing);
  });

  // =========================================================================
  // NHÓM A — ĐỌC DANH SÁCH TÀI KHOẢN NỘI BỘ (listInternalAccounts)
  // =========================================================================
  describe('Nhóm A — Đọc Danh Sách Tài Khoản Nội Bộ (listInternalAccounts)', () => {
    test('A.1: Admin A chỉ nhìn thấy các tài khoản nội bộ của Tenant A, không thấy Tenant B hay Legacy', async () => {
      const res = await request(saasApp)
        .get('/api/v1/system/accounts?limit=50')
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      const returnedUsernames = res.body.data.map((u) => u.username);

      // Must include Tenant A internal accounts
      expect(returnedUsernames).toContain('admin_a');
      expect(returnedUsernames).toContain('hr_a');
      expect(returnedUsernames).toContain('principal_a');
      expect(returnedUsernames).toContain('teacher_a');

      // Parent is NOT an internal role
      expect(returnedUsernames).not.toContain('parent_a');

      // MUST NOT include Tenant B accounts
      expect(returnedUsernames).not.toContain('admin_b');
      expect(returnedUsernames).not.toContain('teacher_b');

      // MUST NOT include Legacy accounts
      expect(returnedUsernames).not.toContain('legacy_admin');
      expect(returnedUsernames).not.toContain('legacy_teacher_missing');
      expect(returnedUsernames).not.toContain('legacy_teacher_null');
    });

    test('A.2: Admin B chỉ nhìn thấy tài khoản nội bộ thuộc Tenant B', async () => {
      const res = await request(saasApp)
        .get('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenAdminB}`);

      expect(res.status).toBe(200);
      const returnedUsernames = res.body.data.map((u) => u.username);

      expect(returnedUsernames).toContain('admin_b');
      expect(returnedUsernames).toContain('teacher_b');
      expect(returnedUsernames).not.toContain('admin_a');
      expect(returnedUsernames).not.toContain('teacher_a');
      expect(returnedUsernames).not.toContain('legacy_admin');
    });

    test('A.3: Metadata Employee không bị rò rỉ chéo trường (alien Employee không gắn vào User A)', async () => {
      const res = await request(saasApp)
        .get('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(200);

      // teacher_a has valid matching employee in Tenant A
      const accountTeacherA = res.body.data.find((u) => u.username === 'teacher_a');
      expect(accountTeacherA).toBeDefined();
      expect(accountTeacherA.employeeId).toBe('GV-2026-A00001');

      // userA_Corrupted has an alien Employee in Tenant B (empCorruptedAlien)
      // Must NOT leak empCorruptedAlien.employeeCode ('GV-2026-ALIEN01')
      const accountCorrupted = res.body.data.find((u) => u.username === 'user_corrupted_a');
      expect(accountCorrupted).toBeDefined();
      expect(accountCorrupted.employeeId).toBe(''); // Stripped, not leaked!

      // userA_NoEmp has no employee at all
      const accountNoEmp = res.body.data.find((u) => u.username === 'chef_no_emp_a');
      expect(accountNoEmp).toBeDefined();
      expect(accountNoEmp.employeeId).toBe('');
    });

    test('A.4: Bộ lọc role, status và tìm kiếm search hoạt động chính xác trong phạm vi tenant', async () => {
      // Filter by role=teacher
      const resRole = await request(saasApp)
        .get('/api/v1/system/accounts?role=teacher')
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resRole.status).toBe(200);
      expect(resRole.body.data.every((u) => u.role === 'teacher')).toBe(true);

      // Filter by status=inactive
      const resStatus = await request(saasApp)
        .get('/api/v1/system/accounts?status=inactive')
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resStatus.status).toBe(200);
      expect(resStatus.body.data.every((u) => u.status === 'inactive')).toBe(true);

      // Search by name
      const resSearch = await request(saasApp)
        .get('/api/v1/system/accounts?search=Hoa')
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resSearch.status).toBe(200);
      expect(resSearch.body.data.some((u) => u.username === 'teacher_a')).toBe(true);
      expect(resSearch.body.data.some((u) => u.username === 'teacher_b')).toBe(false);
    });

    test('A.5: Không cung cấp token hoặc token sai purpose bị từ chối 401/403', async () => {
      const resNoToken = await request(saasApp).get('/api/v1/system/accounts');
      expect(resNoToken.status).toBe(401);

      const resBadToken = await request(saasApp)
        .get('/api/v1/system/accounts')
        .set('Authorization', 'Bearer invalid-token-string');
      expect(resBadToken.status).toBe(401);
    });
  });

  // =========================================================================
  // NHÓM B — TẠO TÀI KHOẢN VÀ HỒ SƠ NHÂN SỰ NGUYÊN TỬ (createInternalAccount)
  // =========================================================================
  describe('Nhóm B — Tạo Tài Khoản và Hồ Sơ Nhân Sự Nguyên Tử (createInternalAccount)', () => {
    test('B.1: Admin A tạo thành công tài khoản mới, cả User và Employee nhận đúng tenantId của Tenant A', async () => {
      const res = await request(saasApp)
        .post('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          username: 'teacher_new_a',
          password: 'Password123@#',
          role: 'teacher',
          profile: {
            fullName: 'Cô Lê Thị Mới A',
            phone: '0901999001',
            email: 'new_a@truonga.edu.vn'
          }
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.username).toBe('teacher_new_a');
      expect(res.body.data.role).toBe('teacher');
      expect(res.body.data.status).toBe('active');
      expect(res.body.data.employeeId).toBeDefined();

      // Verify User in DB
      const userInDb = await User.findOne({ username: 'teacher_new_a' });
      expect(userInDb).not.toBeNull();
      expect(userInDb.tenantId.toString()).toBe(tenantA._id.toString());
      expect(userInDb.role).toBe('teacher');
      expect(userInDb.status).toBe('active');
      expect(userInDb.authVersion).toBe(0);

      // Verify Employee in DB
      const empInDb = await Employee.findOne({ userId: userInDb._id });
      expect(empInDb).not.toBeNull();
      expect(empInDb.tenantId.toString()).toBe(tenantA._id.toString());
      expect(empInDb.fullName).toBe('Cô Lê Thị Mới A');
      expect(empInDb.position).toBe('teacher');
      expect(empInDb.payrollRole).toBe('teacher');
      expect(empInDb.status).toBe('active');
      expect(empInDb.employeeCode).toBe(userInDb.employeeInfo.employeeId);

      // Verify AuditLog written in same transaction
      const auditLog = await AuditLog.findOne({ targetId: userInDb._id, action: 'INTERNAL_ACCOUNT_CREATED' });
      expect(auditLog).not.toBeNull();
      expect(auditLog.targetId.toString()).toBe(userInDb._id.toString());
      expect(auditLog.actorId.toString()).toBe(adminA._id.toString());
    });

    test('B.2: Cùng một username giữa Tenant A và Tenant B đều được tạo thành công (201)', async () => {
      // Create 'shared_username' in Tenant A
      const resA = await request(saasApp)
        .post('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          username: 'shared_username',
          password: 'Password123@#',
          role: 'teacher',
          profile: { fullName: 'Giáo Viên Trường A' }
        });
      expect(resA.status).toBe(201);

      // Create 'shared_username' in Tenant B
      const resB = await request(saasApp)
        .post('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenAdminB}`)
        .send({
          username: 'shared_username',
          password: 'Password123@#',
          role: 'teacher',
          profile: { fullName: 'Giáo Viên Trường B' }
        });
      expect(resB.status).toBe(201);

      // Confirm 2 distinct users in DB
      const usersInDb = await User.find({ username: 'shared_username' });
      expect(usersInDb).toHaveLength(2);
      const tenantIds = usersInDb.map((u) => u.tenantId.toString());
      expect(tenantIds).toContain(tenantA._id.toString());
      expect(tenantIds).toContain(tenantB._id.toString());
    });

    test('B.3: Trùng username trong CÙNG một tenant trả về 409 và không tạo dữ liệu dở dang (orphan)', async () => {
      const payload = {
        username: 'dup_user_test',
        password: 'Password123@#',
        role: 'guard',
        profile: { fullName: 'Bảo Vệ 1' }
      };

      const resFirst = await request(saasApp)
        .post('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send(payload);
      expect(resFirst.status).toBe(201);

      // Attempt duplicate username in Tenant A
      const resDup = await request(saasApp)
        .post('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          username: 'dup_user_test',
          password: 'Password123@#',
          role: 'guard',
          profile: { fullName: 'Bảo Vệ 2 Trùng Tên' }
        });

      expect(resDup.status).toBe(409);
      expect(resDup.body.message).toContain('Tên đăng nhập đã tồn tại');

      // Verify no duplicate or orphan User
      const count = await User.countDocuments({ username: 'dup_user_test', tenantId: tenantA._id });
      expect(count).toBe(1);
    });

    test('B.4: Client gửi tenantId, permissions hoặc status giả mạo không được chấp nhận', async () => {
      const fakeTenantId = new mongoose.Types.ObjectId();
      const res = await request(saasApp)
        .post('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          username: 'tamper_test_user',
          password: 'Password123@#',
          role: 'teacher',
          tenantId: fakeTenantId.toString(),
          permissions: ['ADMIN_ALL_PERMISSIONS'],
          status: 'suspended',
          authVersion: 99,
          profile: { fullName: 'Người Dùng Giả Mạo Input' }
        });

      expect(res.status).toBe(201);
      const userInDb = await User.findOne({ username: 'tamper_test_user' });
      expect(userInDb).not.toBeNull();
      // TenantId MUST be tenantA, NOT fakeTenantId
      expect(userInDb.tenantId.toString()).toBe(tenantA._id.toString());
      // Permissions MUST be empty
      expect(userInDb.permissions).toEqual([]);
      // Status MUST be 'active'
      expect(userInDb.status).toBe('active');
      // AuthVersion MUST be 0
      expect(userInDb.authVersion).toBe(0);
    });

    test('B.5: Lỗi khi tạo Employee (trùng employeeCode) trả về 409 phân loại đúng và rollback toàn bộ User', async () => {
      // Spy on Employee.create to simulate E11000 duplicate key error on employeeCode
      const empSpy = jest.spyOn(Employee, 'create').mockImplementationOnce(async () => {
        const err = new Error('E11000 duplicate key error collection: employees index: employeeCode_1 dup key');
        err.code = 11000;
        err.keyPattern = { employeeCode: 1 };
        throw err;
      });

      const res = await request(saasApp)
        .post('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          username: 'rollback_emp_user',
          password: 'Password123@#',
          role: 'teacher',
          profile: { fullName: 'Thử Nghiệm Rollback Khi Trùng Mã Nhân Viên' }
        });

      empSpy.mockRestore();

      expect(res.status).toBe(409);
      // Must NOT report duplicate username!
      expect(res.body.message).toContain('Mã nhân viên đã tồn tại');

      // Crucial: User MUST have been completely rolled back by transaction!
      const userInDb = await User.findOne({ username: 'rollback_emp_user' });
      expect(userInDb).toBeNull();
    });

    test('B.6: Lỗi khi ghi AuditLog trong transaction khiến toàn bộ User và Employee bị rollback', async () => {
      const auditSpy = jest.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('Simulated Audit Failure'));

      const res = await request(saasApp)
        .post('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          username: 'audit_rollback_user',
          password: 'Password123@#',
          role: 'chef',
          profile: { fullName: 'Thử Nghiệm Rollback Khi Lỗi Audit' }
        });

      auditSpy.mockRestore();

      expect(res.status).toBe(500);

      // Both User and Employee must NOT exist in DB
      const userInDb = await User.findOne({ username: 'audit_rollback_user' });
      expect(userInDb).toBeNull();
      const empInDb = await Employee.findOne({ fullName: 'Thử Nghiệm Rollback Khi Lỗi Audit' });
      expect(empInDb).toBeNull();
    });
  });

  // =========================================================================
  // NHÓM C — CẬP NHẬT TÀI KHOẢN VÀ ĐỔI VAI TRÒ (updateInternalAccount & /role)
  // =========================================================================
  describe('Nhóm C — Cập Nhật Tài Khoản và Đổi Vai Trò', () => {
    test('C.1: Cập nhật thông tin User đồng bộ sang Employee tương ứng trong cùng tenant', async () => {
      const res = await request(saasApp)
        .patch(`/api/v1/system/accounts/${teacherA._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          profile: {
            fullName: 'Cô Nguyễn Thị Hoa Đã Đổi Tên',
            phone: '0901999888',
            email: 'hoa_new@truonga.edu.vn'
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.data.profile.fullName).toBe('Cô Nguyễn Thị Hoa Đã Đổi Tên');
      expect(res.body.data.employeeId).toBe('GV-2026-A00001');

      // Verify User in DB
      const userInDb = await User.findById(teacherA._id);
      expect(userInDb.profile.fullName).toBe('Cô Nguyễn Thị Hoa Đã Đổi Tên');
      expect(userInDb.authVersion).toBe(1); // Incremented

      // Verify Employee in DB
      const empInDb = await Employee.findOne({ userId: teacherA._id });
      expect(empInDb.fullName).toBe('Cô Nguyễn Thị Hoa Đã Đổi Tên');
      expect(empInDb.phone).toBe('0901999888');
      expect(empInDb.email).toBe('hoa_new@truonga.edu.vn');
    });

    test('C.2: Đổi role qua endpoint /role cập nhật payrollRole, position và vô hiệu hóa token cũ (401 AUTH_VERSION_MISMATCH)', async () => {
      // 1. teacherA has tokenTeacherA generated with authVersion: 0.
      // Verify tokenTeacherA currently works on /api/v1/system/me before role change
      const resBefore = await request(saasApp)
        .get('/api/v1/system/me')
        .set('Authorization', `Bearer ${tokenTeacherA}`);
      expect(resBefore.status).toBe(200);
      expect(resBefore.body.user.role).toBe('teacher');
      expect(resBefore.body.user.authVersion).toBe(0);

      // 2. Admin A changes role of teacherA from 'teacher' to 'accountant'
      const res = await request(saasApp)
        .patch(`/api/v1/system/accounts/${teacherA._id}/role`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ role: 'accountant' });

      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe('accountant');

      const userInDb = await User.findById(teacherA._id);
      expect(userInDb.role).toBe('accountant');
      expect(userInDb.authVersion).toBe(1);
      expect(userInDb.employeeInfo.position).toBe('accountant');

      const empInDb = await Employee.findOne({ userId: teacherA._id });
      expect(empInDb.payrollRole).toBe('accountant');
      expect(empInDb.position).toBe('accountant');

      // 3. PROOF: Send old tokenTeacherA (authVersion: 0) to /api/v1/system/me (route without roleCheck)
      const resOldTokenMe = await request(saasApp)
        .get('/api/v1/system/me')
        .set('Authorization', `Bearer ${tokenTeacherA}`);

      expect(resOldTokenMe.status).toBe(401);
      expect(resOldTokenMe.body.code).toBe('AUTH_VERSION_MISMATCH');
      expect(resOldTokenMe.body.message).toContain('Phiên đăng nhập đã bị thu hồi');

      // 4. PROOF: Send old tokenTeacherA to /api/v1/system/accounts (has roleCheck(['admin', 'hr']))
      // Must be rejected by schoolAuthMiddleware with 401 AUTH_VERSION_MISMATCH, NOT 403 by roleCheck!
      const resOldTokenAccounts = await request(saasApp)
        .get('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenTeacherA}`);

      expect(resOldTokenAccounts.status).toBe(401);
      expect(resOldTokenAccounts.body.code).toBe('AUTH_VERSION_MISMATCH');

      // 5. New token with authVersion: 1 succeeds
      const tokenTeacherANew = generateSchoolUserToken(userInDb, tenantA);
      const resNewToken = await request(saasApp)
        .get('/api/v1/system/me')
        .set('Authorization', `Bearer ${tokenTeacherANew}`);

      expect(resNewToken.status).toBe(200);
      expect(resNewToken.body.user.role).toBe('accountant');
      expect(resNewToken.body.user.authVersion).toBe(1);
    });

    test('C.3: Thao tác cập nhật với ID của Tenant B từ Tenant A trả về 404 và không đổi dữ liệu', async () => {
      const res = await request(saasApp)
        .patch(`/api/v1/system/accounts/${teacherB._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          profile: { fullName: 'Cố Ý Hack Tên Thầy B' }
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Không tìm thấy tài khoản');

      // Verify Tenant B's data remains untouched
      const teacherBInDb = await User.findById(teacherB._id);
      expect(teacherBInDb.profile.fullName).toBe('Thầy Lê Văn B');
    });

    test('C.4: Phát hiện liên kết Employee ngoại lai (corrupted link) trả về 409, tối thiểu dữ liệu đọc và không sửa Employee ngoại lai lẫn User', async () => {
      // userA_Corrupted in Tenant A has empCorruptedAlien in Tenant B pointing to it
      const alienBefore = await Employee.findById(empCorruptedAlien._id).lean();
      const userBefore = await User.findById(userA_Corrupted._id).lean();

      const res = await request(saasApp)
        .patch(`/api/v1/system/accounts/${userA_Corrupted._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          profile: { fullName: 'Tên Mới Sau Khi Cập Nhật' }
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CORRUPTED_EMPLOYEE_LINK');

      // Alien employee must NOT be mutated!
      const alienAfter = await Employee.findById(empCorruptedAlien._id).lean();
      expect(alienAfter).toEqual(alienBefore);
      expect(alienAfter.fullName).toBe('Hồ Sơ Thuộc Tenant B Nhưng Trỏ Nhầm User A');
      expect(alienAfter.tenantId.toString()).toBe(tenantB._id.toString());
      expect(alienAfter.salaryConfig.baseSalary).toBe(6000000);

      // User must NOT be mutated!
      const userAfter = await User.findById(userA_Corrupted._id).lean();
      expect(userAfter.profile.fullName).toBe(userBefore.profile.fullName);
      expect(userAfter.authVersion).toBe(userBefore.authVersion);
    });

    test('C.5: Không được kích hoạt lại (status: active) tài khoản của nhân viên đã resigned (409)', async () => {
      const res = await request(saasApp)
        .patch(`/api/v1/system/accounts/${userA_Resigned._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ status: 'active' });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('Nhân viên đã nghỉ việc');

      const userInDb = await User.findById(userA_Resigned._id);
      expect(userInDb.status).toBe('inactive');
    });

    test('C.6a: Giáo viên CHỈ làm homeroomTeacherId bị chặn đổi role (409) cả endpoint PATCH /accounts/:id lẫn /role', async () => {
      const userBefore = await User.findById(userA_HomeroomOnly._id).lean();
      const empBefore = await Employee.findOne({ userId: userA_HomeroomOnly._id }).lean();
      const classroomBefore = await Classroom.findById(classroomA_HR._id).lean();

      // 1. Try role change via general update endpoint
      const resGeneral = await request(saasApp)
        .patch(`/api/v1/system/accounts/${userA_HomeroomOnly._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ role: 'guard' });

      expect(resGeneral.status).toBe(409);
      expect(resGeneral.body.message).toContain('Giáo viên đang được phân công lớp');

      // 2. Try role change via dedicated /role endpoint
      const resRole = await request(saasApp)
        .patch(`/api/v1/system/accounts/${userA_HomeroomOnly._id}/role`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ role: 'accountant' });

      expect(resRole.status).toBe(409);
      expect(resRole.body.message).toContain('Giáo viên đang được phân công lớp');

      // 3. Database records remain completely untouched
      const userAfter = await User.findById(userA_HomeroomOnly._id).lean();
      expect(userAfter.role).toBe('teacher');
      expect(userAfter.authVersion).toBe(userBefore.authVersion);

      const empAfter = await Employee.findOne({ userId: userA_HomeroomOnly._id }).lean();
      expect(empAfter.payrollRole).toBe('teacher');
      expect(empAfter.position).toBe('teacher');

      const classroomAfter = await Classroom.findById(classroomA_HR._id).lean();
      expect(classroomAfter.homeroomTeacherId.toString()).toBe(userA_HomeroomOnly._id.toString());
      expect(classroomAfter).toEqual(classroomBefore);
    });

    test('C.6b: Giáo viên CHỈ nằm trong mảng teachers bị chặn đổi role (409) cả endpoint PATCH /accounts/:id lẫn /role', async () => {
      const userBefore = await User.findById(userA_TeachersOnly._id).lean();
      const empBefore = await Employee.findOne({ userId: userA_TeachersOnly._id }).lean();
      const classroomBefore = await Classroom.findById(classroomA_T._id).lean();

      // 1. Try role change via general update endpoint
      const resGeneral = await request(saasApp)
        .patch(`/api/v1/system/accounts/${userA_TeachersOnly._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ role: 'guard' });

      expect(resGeneral.status).toBe(409);
      expect(resGeneral.body.message).toContain('Giáo viên đang được phân công lớp');

      // 2. Try role change via dedicated /role endpoint
      const resRole = await request(saasApp)
        .patch(`/api/v1/system/accounts/${userA_TeachersOnly._id}/role`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ role: 'accountant' });

      expect(resRole.status).toBe(409);
      expect(resRole.body.message).toContain('Giáo viên đang được phân công lớp');

      // 3. Database records remain completely untouched
      const userAfter = await User.findById(userA_TeachersOnly._id).lean();
      expect(userAfter.role).toBe('teacher');
      expect(userAfter.authVersion).toBe(userBefore.authVersion);

      const empAfter = await Employee.findOne({ userId: userA_TeachersOnly._id }).lean();
      expect(empAfter.payrollRole).toBe('teacher');
      expect(empAfter.position).toBe('teacher');

      const classroomAfter = await Classroom.findById(classroomA_T._id).lean();
      expect(classroomAfter.teachers[0].teacherId.toString()).toBe(userA_TeachersOnly._id.toString());
      expect(classroomAfter).toEqual(classroomBefore);
    });

    test('C.6c.1: Lớp active thuộc Tenant B tham chiếu chính User giáo viên A qua homeroomTeacherId; giáo viên A không có phân công active ở A -> Đổi role A thành công (200)', async () => {
      // Create cross-tenant reference in active classroom of Tenant B referencing teacherA._id as homeroomTeacherId
      const alienClassroomB = await Classroom.create({
        tenantId: tenantB._id,
        name: 'Lớp Mầm B-Cross-HR',
        fullName: 'Lớp Mầm Tenant B Tham Chiếu Nhầm Giáo Viên A Làm Chủ Nhiệm',
        ageGroup: '3-4',
        status: 'active',
        homeroomTeacherId: teacherA._id,
        teachers: []
      });

      const classroomBBefore = await Classroom.findById(alienClassroomB._id).lean();

      // teacherA has no active assignment in Tenant A
      const res = await request(saasApp)
        .patch(`/api/v1/system/accounts/${teacherA._id}/role`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ role: 'accountant' });

      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe('accountant');

      // Verify teacherA updated in DB
      const userInDb = await User.findById(teacherA._id);
      expect(userInDb.role).toBe('accountant');

      // Verify Classroom B and Tenant B data remain 100% untouched
      const classroomBAfter = await Classroom.findById(alienClassroomB._id).lean();
      expect(classroomBAfter).toEqual(classroomBBefore);
      expect(classroomBAfter.tenantId.toString()).toBe(tenantB._id.toString());
      expect(classroomBAfter.homeroomTeacherId.toString()).toBe(teacherA._id.toString());
    });

    test('C.6c.2: Lớp active thuộc Tenant B tham chiếu chính User giáo viên A qua teachers.teacherId; giáo viên A không có phân công active ở A -> Đổi role A thành công (200)', async () => {
      // Create cross-tenant reference in active classroom of Tenant B referencing teacherA._id in teachers array
      const alienClassroomB = await Classroom.create({
        tenantId: tenantB._id,
        name: 'Lớp Chồi B-Cross-Teacher',
        fullName: 'Lớp Chồi Tenant B Tham Chiếu Nhầm Giáo Viên A Trong Mảng Teachers',
        ageGroup: '4-5',
        status: 'active',
        homeroomTeacherId: null,
        teachers: [{ teacherId: teacherA._id }]
      });

      const classroomBBefore = await Classroom.findById(alienClassroomB._id).lean();

      // Changing teacherA role to guard succeeds
      const res = await request(saasApp)
        .patch(`/api/v1/system/accounts/${teacherA._id}/role`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ role: 'guard' });

      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe('guard');

      // Verify Classroom B remains 100% untouched
      const classroomBAfter = await Classroom.findById(alienClassroomB._id).lean();
      expect(classroomBAfter).toEqual(classroomBBefore);
      expect(classroomBAfter.teachers[0].teacherId.toString()).toBe(teacherA._id.toString());
    });

    test('C.6c.3: Lớp archived thuộc Tenant A tham chiếu giáo viên A: không chặn đổi role (200)', async () => {
      // userA_InactiveClass is assigned to classroomA_Inactive (status: 'archived') in Tenant A
      const res = await request(saasApp)
        .patch(`/api/v1/system/accounts/${userA_InactiveClass._id}/role`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ role: 'accountant' });

      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe('accountant');

      const userInDb = await User.findById(userA_InactiveClass._id);
      expect(userInDb.role).toBe('accountant');
    });

    test('C.6c.4: Lớp active thuộc Tenant A tham chiếu giáo viên A: chặn cả endpoint update thường và /role (409)', async () => {
      // Assign teacherA to active classroom classroomA_HR in Tenant A
      await Classroom.updateOne(
        { _id: classroomA_HR._id },
        { $set: { homeroomTeacherId: teacherA._id } }
      );

      // 1. General update endpoint is blocked
      const resGeneral = await request(saasApp)
        .patch(`/api/v1/system/accounts/${teacherA._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ role: 'guard' });

      expect(resGeneral.status).toBe(409);
      expect(resGeneral.body.message).toContain('Giáo viên đang được phân công lớp');

      // 2. Dedicated /role endpoint is blocked
      const resRole = await request(saasApp)
        .patch(`/api/v1/system/accounts/${teacherA._id}/role`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ role: 'accountant' });

      expect(resRole.status).toBe(409);
      expect(resRole.body.message).toContain('Giáo viên đang được phân công lớp');

      // DB state unchanged
      const teacherInDb = await User.findById(teacherA._id);
      expect(teacherInDb.role).toBe('teacher');
      expect(teacherInDb.authVersion).toBe(0);
    });

    test('C.7: Tài khoản hợp lệ chưa có Employee (userA_NoEmp) cập nhật thành công (200), không lỗi 500', async () => {
      const res = await request(saasApp)
        .patch(`/api/v1/system/accounts/${userA_NoEmp._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          profile: { fullName: 'Đầu Bếp Cũ Đã Đổi Tên' }
        });

      expect(res.status).toBe(200);
      expect(res.body.data.profile.fullName).toBe('Đầu Bếp Cũ Đã Đổi Tên');
      expect(res.body.data.employeeId).toBe('');

      const userInDb = await User.findById(userA_NoEmp._id);
      expect(userInDb.profile.fullName).toBe('Đầu Bếp Cũ Đã Đổi Tên');
    });

    test('C.8: Cập nhật tài khoản KHÔNG CÓ Employee (userA_NoEmp): AuditLog.create thất bại rollback 100% User', async () => {
      const userBefore = await User.findById(userA_NoEmp._id).select('+passwordHash').lean();
      const auditCountBefore = await AuditLog.countDocuments({ targetId: userA_NoEmp._id });

      const auditSpy = jest.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('Simulated Audit Failure For NoEmp User'));

      let res;
      try {
        res = await request(saasApp)
          .patch(`/api/v1/system/accounts/${userA_NoEmp._id}`)
          .set('Authorization', `Bearer ${tokenAdminA}`)
          .send({
            username: 'chef_no_emp_rollback_test',
            password: 'NewStrongPassword@2026',
            role: 'guard',
            status: 'inactive',
            profile: {
              fullName: 'Tên Không Được Lưu Khi Audit Lỗi',
              phone: '0901999888',
              email: 'newemail@truonga.edu.vn'
            }
          });
      } finally {
        auditSpy.mockRestore();
      }

      expect(res.status).toBe(500);

      // Verify User in DB is 100% unchanged across all modified fields
      const userAfter = await User.findById(userA_NoEmp._id).select('+passwordHash').lean();
      expect(userAfter.username).toBe(userBefore.username);
      expect(userAfter.role).toBe(userBefore.role);
      expect(userAfter.status).toBe(userBefore.status);
      expect(userAfter.authVersion).toBe(userBefore.authVersion);
      expect(userAfter.passwordHash).toBe(userBefore.passwordHash);
      expect(userAfter.profile.fullName).toBe(userBefore.profile.fullName);
      expect(userAfter.profile.phone).toBe(userBefore.profile.phone);
      expect(userAfter.profile.email).toBe(userBefore.profile.email);
      expect(userAfter.updatedAt.getTime()).toBe(userBefore.updatedAt.getTime());

      // No orphan Employee created
      const empAfter = await Employee.findOne({ userId: userA_NoEmp._id });
      expect(empAfter).toBeNull();

      // No AuditLog written
      const auditCountAfter = await AuditLog.countDocuments({ targetId: userA_NoEmp._id });
      expect(auditCountAfter).toBe(auditCountBefore);
    });

    test('C.9: Cập nhật tài khoản CÓ Employee (teacherA): AuditLog.create thất bại rollback 100% cả User và Employee', async () => {
      const userBefore = await User.findById(teacherA._id).select('+passwordHash').lean();
      const empBefore = await Employee.findOne({ userId: teacherA._id }).lean();
      const auditCountBefore = await AuditLog.countDocuments({ targetId: teacherA._id });

      const auditSpy = jest.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('Simulated Audit Failure For Emp User'));

      let res;
      try {
        res = await request(saasApp)
          .patch(`/api/v1/system/accounts/${teacherA._id}`)
          .set('Authorization', `Bearer ${tokenAdminA}`)
          .send({
            username: 'teacher_a_rollback_test',
            password: 'NewStrongPassword@2026',
            role: 'accountant',
            status: 'inactive',
            profile: {
              fullName: 'Cô Hoa Tên Mới Rollback',
              phone: '0901777666',
              email: 'hoarollback@truonga.edu.vn'
            }
          });
      } finally {
        auditSpy.mockRestore();
      }

      expect(res.status).toBe(500);

      // Both User and Employee are 100% unchanged across all modified fields
      const userAfter = await User.findById(teacherA._id).select('+passwordHash').lean();
      expect(userAfter.username).toBe(userBefore.username);
      expect(userAfter.role).toBe(userBefore.role);
      expect(userAfter.status).toBe(userBefore.status);
      expect(userAfter.authVersion).toBe(userBefore.authVersion);
      expect(userAfter.passwordHash).toBe(userBefore.passwordHash);
      expect(userAfter.profile.fullName).toBe(userBefore.profile.fullName);
      expect(userAfter.profile.phone).toBe(userBefore.profile.phone);
      expect(userAfter.profile.email).toBe(userBefore.profile.email);
      expect(userAfter.updatedAt.getTime()).toBe(userBefore.updatedAt.getTime());

      const empAfter = await Employee.findOne({ userId: teacherA._id }).lean();
      expect(empAfter.fullName).toBe(empBefore.fullName);
      expect(empAfter.phone).toBe(empBefore.phone);
      expect(empAfter.email).toBe(empBefore.email);
      expect(empAfter.payrollRole).toBe(empBefore.payrollRole);
      expect(empAfter.position).toBe(empBefore.position);
      expect(empAfter.status).toBe(empBefore.status);
      expect(empAfter.updatedAt.getTime()).toBe(empBefore.updatedAt.getTime());

      // No AuditLog written
      const auditCountAfter = await AuditLog.countDocuments({ targetId: teacherA._id });
      expect(auditCountAfter).toBe(auditCountBefore);
    });

    test('C.10: Đổi mật khẩu tài khoản nội bộ: hash bảo mật, không lộ mật khẩu, authVersion tăng và vô hiệu hóa token cũ', async () => {
      // 1. Generate token before password change
      const tokenBefore = generateSchoolUserToken(userA_NoEmp, tenantA);

      // Verify tokenBefore currently works on /api/v1/system/me
      const resBefore = await request(saasApp)
        .get('/api/v1/system/me')
        .set('Authorization', `Bearer ${tokenBefore}`);
      expect(resBefore.status).toBe(200);

      const userBefore = await User.findById(userA_NoEmp._id).select('+passwordHash');
      const oldHash = userBefore.passwordHash;

      // 2. Change password
      const newPasswordRaw = 'NewStrongPassword@2026';
      const resChange = await request(saasApp)
        .patch(`/api/v1/system/accounts/${userA_NoEmp._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          password: newPasswordRaw
        });

      expect(resChange.status).toBe(200);

      // Security check: response body does NOT leak password or passwordHash
      expect(resChange.body.data.password).toBeUndefined();
      expect(resChange.body.data.passwordHash).toBeUndefined();
      expect(JSON.stringify(resChange.body)).not.toContain(newPasswordRaw);

      // 3. Database check
      const userAfter = await User.findById(userA_NoEmp._id).select('+passwordHash');
      expect(userAfter.passwordHash).not.toBe(oldHash);
      const isMatch = await comparePassword(newPasswordRaw, userAfter.passwordHash);
      expect(isMatch).toBe(true);
      expect(userAfter.authVersion).toBe((userBefore.authVersion || 0) + 1);

      // 4. AuditLog security check
      const auditLog = await AuditLog.findOne({
        targetId: userA_NoEmp._id,
        action: 'INTERNAL_ACCOUNT_UPDATED'
      }).sort({ createdAt: -1 });

      expect(auditLog).not.toBeNull();
      const auditJson = JSON.stringify(auditLog);
      expect(auditJson).not.toContain(newPasswordRaw);
      expect(auditLog.before?.password).toBeUndefined();
      expect(auditLog.before?.passwordHash).toBeUndefined();
      expect(auditLog.after?.password).toBeUndefined();
      expect(auditLog.after?.passwordHash).toBeUndefined();

      // 5. Old token is rejected with 401 AUTH_VERSION_MISMATCH on /me
      const resOldTokenMe = await request(saasApp)
        .get('/api/v1/system/me')
        .set('Authorization', `Bearer ${tokenBefore}`);

      expect(resOldTokenMe.status).toBe(401);
      expect(resOldTokenMe.body.code).toBe('AUTH_VERSION_MISMATCH');

      // 6. Old token is rejected with 401 AUTH_VERSION_MISMATCH on /accounts
      const resOldTokenAccounts = await request(saasApp)
        .get('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenBefore}`);

      expect(resOldTokenAccounts.status).toBe(401);
      expect(resOldTokenAccounts.body.code).toBe('AUTH_VERSION_MISMATCH');

      // 7. New token with incremented authVersion works
      const tokenAfter = generateSchoolUserToken(userAfter, tenantA);
      const resNewToken = await request(saasApp)
        .get('/api/v1/system/me')
        .set('Authorization', `Bearer ${tokenAfter}`);

      expect(resNewToken.status).toBe(200);
      expect(resNewToken.body.user.authVersion).toBe(userAfter.authVersion);
    });
  });

  // =========================================================================
  // NHÓM C.CONCURRENCY — KIỂM CHỨNG DỮ LIỆU THAY ĐỔI GIỮA HAI LẦN ĐỌC (ANTI-TOCTOU & TRANSACTION SAFETY)
  // =========================================================================
  describe('Nhóm C.Concurrency — Kiểm Chứng Dữ Liệu Thay Đổi Giữa Hai Lần Đọc (Anti-TOCTOU & Transaction Safety)', () => {
    test('C.CC.1: Employee chuyển sang resigned sau kiểm tra sơ bộ nhưng trước lần đọc trong transaction -> Kích hoạt bị từ chối 409', async () => {
      // Setup: user is inactive, employee is active
      const userInactive = await User.create({
        tenantId: tenantA._id,
        username: 'guard_toctou_resigned',
        passwordHash: await hashPassword('Password123@#'),
        role: 'guard',
        status: 'inactive',
        authVersion: 0,
        profile: { fullName: 'Bảo Vệ Đang Chờ Kích Hoạt' }
      });

      const empActive = await Employee.create({
        tenantId: tenantA._id,
        userId: userInactive._id,
        employeeCode: 'BV-2026-TOCTOU01',
        fullName: userInactive.profile.fullName,
        position: 'security',
        payrollRole: 'guard',
        status: 'active',
        salaryConfig: { baseSalary: 5000000 }
      });

      const userBefore = await User.findById(userInactive._id).lean();

      let preCheckReadStatus = null;
      let txCallbackExecuted = false;
      let txReadStatus = null;
      let updatedBeforeSnapshot = false;

      // Spy on Employee.findOne:
      // 1. Query metadata (_id/tenantId, no session): do NOT update DB.
      // 2. Query pre-check status (select 'status', no session): reads active doc from DB.
      //    After reading 'active', perform real DB update (status: 'resigned') exactly once before transaction starts.
      //    Do NOT mutate the doc returned to pre-check, allowing pre-check to pass cleanly.
      // 3. Transaction callback executes: re-reads Employee in transaction session.
      //    Fresh snapshot from MongoDB reflects status 'resigned', triggering 409 rejection inside transaction.
      const origFindOne = Employee.findOne.bind(Employee);
      const empSpy = jest.spyOn(Employee, 'findOne').mockImplementation((...args) => {
        const query = origFindOne(...args);
        const origThen = query.then.bind(query);

        query.then = function (resolve, reject) {
          return origThen(async (doc) => {
            const session = query.getOptions().session;
            const isTargetUser = args[0]?.userId?.toString() === userInactive._id.toString();

            if (isTargetUser) {
              if (!session && query._fields?.status) {
                // Pre-check status query without session:
                preCheckReadStatus = doc?.status;
                if (!updatedBeforeSnapshot) {
                  updatedBeforeSnapshot = true;
                  // Commit real change to MongoDB collection before transaction snapshot starts
                  await Employee.collection.updateOne({ _id: empActive._id }, { $set: { status: 'resigned' } });
                }
              } else if (session) {
                // Inside transaction session:
                txCallbackExecuted = true;
                if (doc?.status) {
                  // Business record query inside transaction
                  txReadStatus = doc.status;
                }
              }
            }
            return resolve(doc);
          }, reject);
        };

        return query;
      });

      let res;
      try {
        res = await request(saasApp)
          .patch(`/api/v1/system/accounts/${userInactive._id}`)
          .set('Authorization', `Bearer ${tokenAdminA}`)
          .send({ status: 'active' });
      } finally {
        empSpy.mockRestore();
      }

      // Assertions verifying the exact sequence and evidence:
      // 1. Pre-check status query read 'active' cleanly and passed
      expect(preCheckReadStatus).toBe('active');
      expect(updatedBeforeSnapshot).toBe(true);

      // 2. Transaction callback was truly executed
      expect(txCallbackExecuted).toBe(true);

      // 3. Query inside transaction read 'resigned' from DB snapshot
      expect(txReadStatus).toBe('resigned');

      // 4. Request was rejected with 409 by transaction validation
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('Nhân viên đã nghỉ việc');

      // 5. Database assertions: User remains inactive and authVersion unchanged
      const userAfter = await User.findById(userInactive._id).lean();
      expect(userAfter.status).toBe('inactive');
      expect(userAfter.authVersion).toBe(userBefore.authVersion);

      // 6. Verify Employee in DB really is resigned
      const empInDb = await Employee.findById(empActive._id).lean();
      expect(empInDb.status).toBe('resigned');

      // 7. No AuditLog written for this rejected update
      const auditLog = await AuditLog.findOne({ targetId: userInactive._id });
      expect(auditLog).toBeNull();
    });

    test('C.CC.2: Target đổi sang role được bảo vệ (principal) sau kiểm tra sơ bộ nhưng trước lần đọc trong transaction -> Cập nhật bị từ chối 409', async () => {
      // Setup: user is teacher
      const userStaff = await User.create({
        tenantId: tenantA._id,
        username: 'staff_toctou_principal',
        passwordHash: await hashPassword('Password123@#'),
        role: 'teacher',
        status: 'active',
        authVersion: 0,
        profile: { fullName: 'Giáo Viên Sắp Thành Hiệu Trưởng' }
      });

      const userBefore = await User.findById(userStaff._id).lean();

      // HR A is attempting to update staff's profile.
      // Intercept pre-check query (no session) for userStaff.
      // Await real commit in DB collection before transaction snapshot starts.
      // Do NOT mutate doc returned by query.
      const origFindOne = User.findOne.bind(User);
      const userSpy = jest.spyOn(User, 'findOne').mockImplementation((...args) => {
        const query = origFindOne(...args);
        const origSession = query.session.bind(query);
        let hasSession = false;
        query.session = function (sess) {
          hasSession = Boolean(sess);
          return origSession(sess);
        };
        const origThen = query.then.bind(query);
        query.then = function (resolve, reject) {
          return origThen(async (doc) => {
            if (!hasSession && args[0]?._id?.toString() === userStaff._id.toString()) {
              // Pre-check passed: doc is teacher.
              // Perform real DB update and await commit before transaction starts snapshot:
              await User.collection.updateOne({ _id: userStaff._id }, { $set: { role: 'principal' } });
            }
            return resolve(doc);
          }, reject);
        };
        return query;
      });

      let res;
      try {
        res = await request(saasApp)
          .patch(`/api/v1/system/accounts/${userStaff._id}`)
          .set('Authorization', `Bearer ${tokenHrA}`)
          .send({ profile: { fullName: 'Tên Đổi Trái Phép' } });
      } finally {
        userSpy.mockRestore();
      }

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('Nhân sự không thể thay đổi tài khoản Hiệu trưởng');

      // Profile remains untouched
      const userAfter = await User.findById(userStaff._id).lean();
      expect(userAfter.profile.fullName).toBe(userBefore.profile.fullName);
      expect(userAfter.authVersion).toBe(userBefore.authVersion);

      // Verify User in DB really has role principal
      expect(userAfter.role).toBe('principal');

      // No AuditLog written
      const auditLog = await AuditLog.findOne({ targetId: userStaff._id });
      expect(auditLog).toBeNull();
    });

    test('C.CC.3: Giáo viên được gán vào lớp active cùng tenant sau kiểm tra sơ bộ nhưng trước kiểm tra trong transaction -> Đổi role bị từ chối 409', async () => {
      // teacherA is currently unassigned
      const teacherBefore = await User.findById(teacherA._id).lean();
      const empBefore = await Employee.findOne({ userId: teacherA._id }).lean();

      // Spy on Classroom.exists: call 1 (pre-check) sees unassigned teacher;
      // as soon as pre-check completes and BEFORE transaction snapshot starts, assign teacherA in DB
      const origExists = Classroom.exists.bind(Classroom);
      let callCount = 0;
      const classSpy = jest.spyOn(Classroom, 'exists').mockImplementation(function (...args) {
        callCount++;
        const query = origExists(...args);
        if (callCount === 1) {
          const origThen = query.then.bind(query);
          query.then = function (resolve, reject) {
            return origThen((result) => {
              // Pre-check concluded false/null. Now assign teacher before transaction starts:
              return Classroom.collection.updateOne(
                { _id: classroomA_HR._id },
                { $set: { homeroomTeacherId: teacherA._id } }
              ).then(() => resolve(result));
            }, reject);
          };
        }
        return query;
      });

      let res;
      try {
        res = await request(saasApp)
          .patch(`/api/v1/system/accounts/${teacherA._id}/role`)
          .set('Authorization', `Bearer ${tokenAdminA}`)
          .send({ role: 'accountant' });
      } finally {
        classSpy.mockRestore();
      }

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('Giáo viên đang được phân công lớp');

      // Teacher role and authVersion in DB remain unchanged
      const teacherAfter = await User.findById(teacherA._id).lean();
      expect(teacherAfter.role).toBe('teacher');
      expect(teacherAfter.authVersion).toBe(teacherBefore.authVersion);

      const empAfter = await Employee.findOne({ userId: teacherA._id }).lean();
      expect(empAfter.payrollRole).toBe('teacher');
      expect(empAfter.position).toBe('teacher');
    });

    test('C.CC.ActorDemoted.1: Actor HR bị đổi thành teacher sau kiểm tra sơ bộ nhưng trước transaction snapshot -> Bị từ chối 403 khi cập nhật profile', async () => {
      // HR A attempts to update teacherA's profile.
      // Initially HR A is active and role 'hr'.
      const targetBefore = await User.findById(teacherA._id).lean();
      const empBefore = await Employee.findOne({ userId: teacherA._id }).lean();

      // Intercept pre-check User.findOne (no session) for teacherA:
      // Demote HR A to 'teacher' in DB before transaction starts snapshot:
      const origFindOne = User.findOne.bind(User);
      const userSpy = jest.spyOn(User, 'findOne').mockImplementation((...args) => {
        const query = origFindOne(...args);
        const origSession = query.session.bind(query);
        let hasSession = false;
        query.session = function (sess) {
          hasSession = Boolean(sess);
          return origSession(sess);
        };
        const origThen = query.then.bind(query);
        query.then = function (resolve, reject) {
          return origThen(async (doc) => {
            if (!hasSession && args[0]?._id?.toString() === teacherA._id.toString()) {
              // Pre-check passed. Demote HR A in DB:
              await User.collection.updateOne({ _id: hrA._id }, { $set: { role: 'teacher' } });
            }
            return resolve(doc);
          }, reject);
        };
        return query;
      });

      let res;
      try {
        res = await request(saasApp)
          .patch(`/api/v1/system/accounts/${teacherA._id}`)
          .set('Authorization', `Bearer ${tokenHrA}`)
          .send({ profile: { fullName: 'Tên Đổi Khi HR Bị Hạ Quyền' } });
      } finally {
        userSpy.mockRestore();
        await User.collection.updateOne({ _id: hrA._id }, { $set: { role: 'hr' } });
      }

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Tài khoản thực hiện thao tác không còn quyền quản lý tài khoản nội bộ hoặc đã bị khóa/hạ quyền');

      // Target user untouched
      const targetAfter = await User.findById(teacherA._id).lean();
      expect(targetAfter.profile.fullName).toBe(targetBefore.profile.fullName);
      expect(targetAfter.authVersion).toBe(targetBefore.authVersion);

      // Target employee untouched
      const empAfter = await Employee.findOne({ userId: teacherA._id }).lean();
      expect(empAfter.fullName).toBe(empBefore.fullName);

      // No AuditLog written
      const auditLog = await AuditLog.findOne({ targetId: teacherA._id, action: 'INTERNAL_ACCOUNT_UPDATED' });
      expect(auditLog).toBeNull();
    });

    test('C.CC.ActorDemoted.2: Actor HR bị đổi thành teacher sau kiểm tra sơ bộ nhưng trước transaction snapshot -> Bị từ chối 403 khi đổi password hoặc status', async () => {
      const targetBefore = await User.findById(teacherA._id).lean();

      // Test password update
      const origFindOne = User.findOne.bind(User);
      let userSpy = jest.spyOn(User, 'findOne').mockImplementation((...args) => {
        const query = origFindOne(...args);
        const origSession = query.session.bind(query);
        let hasSession = false;
        query.session = function (sess) {
          hasSession = Boolean(sess);
          return origSession(sess);
        };
        const origThen = query.then.bind(query);
        query.then = function (resolve, reject) {
          return origThen(async (doc) => {
            if (!hasSession && args[0]?._id?.toString() === teacherA._id.toString()) {
              await User.collection.updateOne({ _id: hrA._id }, { $set: { role: 'teacher' } });
            }
            return resolve(doc);
          }, reject);
        };
        return query;
      });

      let resPassword;
      try {
        resPassword = await request(saasApp)
          .patch(`/api/v1/system/accounts/${teacherA._id}`)
          .set('Authorization', `Bearer ${tokenHrA}`)
          .send({ password: 'NewPassword123@#' });
      } finally {
        userSpy.mockRestore();
        await User.collection.updateOne({ _id: hrA._id }, { $set: { role: 'hr' } });
      }

      expect(resPassword.status).toBe(403);
      expect(resPassword.body.message).toContain('Tài khoản thực hiện thao tác không còn quyền quản lý tài khoản nội bộ hoặc đã bị khóa/hạ quyền');

      // Test status update
      userSpy = jest.spyOn(User, 'findOne').mockImplementation((...args) => {
        const query = origFindOne(...args);
        const origSession = query.session.bind(query);
        let hasSession = false;
        query.session = function (sess) {
          hasSession = Boolean(sess);
          return origSession(sess);
        };
        const origThen = query.then.bind(query);
        query.then = function (resolve, reject) {
          return origThen(async (doc) => {
            if (!hasSession && args[0]?._id?.toString() === teacherA._id.toString()) {
              await User.collection.updateOne({ _id: hrA._id }, { $set: { role: 'teacher' } });
            }
            return resolve(doc);
          }, reject);
        };
        return query;
      });

      let resStatus;
      try {
        resStatus = await request(saasApp)
          .patch(`/api/v1/system/accounts/${teacherA._id}`)
          .set('Authorization', `Bearer ${tokenHrA}`)
          .send({ status: 'inactive' });
      } finally {
        userSpy.mockRestore();
        await User.collection.updateOne({ _id: hrA._id }, { $set: { role: 'hr' } });
      }

      expect(resStatus.status).toBe(403);
      expect(resStatus.body.message).toContain('Tài khoản thực hiện thao tác không còn quyền quản lý tài khoản nội bộ hoặc đã bị khóa/hạ quyền');

      // Target password, status, authVersion remain untouched
      const targetAfter = await User.findById(teacherA._id).lean();
      expect(targetAfter.passwordHash).toBe(targetBefore.passwordHash);
      expect(targetAfter.status).toBe(targetBefore.status);
      expect(targetAfter.authVersion).toBe(targetBefore.authVersion);
    });

    test('C.CC.4: Transaction retry: Khi gặp TransientTransactionError mô phỏng, callback transaction chạy lại và re-evaluate dữ liệu mới từ DB (Employee resigned -> 409)', async () => {
      const { MongoServerError } = require('mongodb');

      // Setup: user is inactive, employee is active
      const userRetry = await User.create({
        tenantId: tenantA._id,
        username: 'guard_retry_resigned',
        passwordHash: await hashPassword('Password123@#'),
        role: 'guard',
        status: 'inactive',
        authVersion: 0,
        profile: { fullName: 'Bảo Vệ Thử Nghiệm Retry' }
      });

      const empRetry = await Employee.create({
        tenantId: tenantA._id,
        userId: userRetry._id,
        employeeCode: 'BV-2026-RETRY01',
        fullName: userRetry.profile.fullName,
        position: 'security',
        payrollRole: 'guard',
        status: 'active',
        salaryConfig: { baseSalary: 5000000 }
      });

      const userBefore = await User.findById(userRetry._id).lean();

      let attempts = 0;
      const origFindOne = User.findOne.bind(User);
      const userSpy = jest.spyOn(User, 'findOne').mockImplementation((...args) => {
        const query = origFindOne(...args);
        const origSession = query.session.bind(query);
        query.session = function (sess) {
          if (sess && args[0]?._id?.toString() === userRetry._id.toString()) {
            attempts++;
            if (attempts === 1) {
              // In attempt 1: Simulate concurrent business change before retry is triggered:
              // Concurrently mark employee as resigned in the real DB collection
              return origSession(sess).then(async (doc) => {
                await Employee.collection.updateOne({ _id: empRetry._id }, { $set: { status: 'resigned' } });
                // Simulate driver transient transaction error to trigger automatic retry by withTransaction
                const simulatedTransientErr = new MongoServerError({
                  message: 'WriteConflict simulated for retry demonstration (not a real database lock conflict)',
                  errorLabels: ['TransientTransactionError']
                });
                throw simulatedTransientErr;
              });
            }
          }
          return origSession(sess);
        };
        return query;
      });

      let res;
      try {
        res = await request(saasApp)
          .patch(`/api/v1/system/accounts/${userRetry._id}`)
          .set('Authorization', `Bearer ${tokenAdminA}`)
          .send({ status: 'active' });
      } finally {
        userSpy.mockRestore();
      }

      // MongoDB driver retried the callback because of TransientTransactionError.
      // On attempt 2, callback re-read the fresh snapshot from MongoDB where Employee is now resigned,
      // and rejected the activation with 409!
      expect(attempts).toBeGreaterThanOrEqual(2);
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('Nhân viên đã nghỉ việc');

      // Database assertion: User remains inactive and authVersion unchanged
      const userAfter = await User.findById(userRetry._id).lean();
      expect(userAfter.status).toBe('inactive');
      expect(userAfter.authVersion).toBe(userBefore.authVersion);

      // Verify Employee is resigned in DB
      const empInDb = await Employee.findById(empRetry._id).lean();
      expect(empInDb.status).toBe('resigned');

      // Crucial: No partial write and NO duplicate or dangling AuditLog
      const auditLogs = await AuditLog.find({ targetId: userRetry._id }).lean();
      expect(auditLogs.length).toBe(0);
    });
  });

  // =========================================================================
  // NHÓM D — PHÂN QUYỀN VÀ BẢO VỆ RBAC
  // =========================================================================
  describe('Nhóm D — Phân Quyền và Bảo Vệ RBAC', () => {
    test('D.1: Teacher và Parent bị từ chối 403 khi gọi endpoints quản lý tài khoản', async () => {
      const resTeacher = await request(saasApp)
        .get('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenTeacherA}`);
      expect(resTeacher.status).toBe(403);

      const resParent = await request(saasApp)
        .get('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenParentA}`);
      expect(resParent.status).toBe(403);
    });

    test('D.2: HR không được tạo tài khoản có role principal (422)', async () => {
      const res = await request(saasApp)
        .post('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenHrA}`)
        .send({
          username: 'principal_unauthorized',
          password: 'Password123@#',
          role: 'principal',
          profile: { fullName: 'Hiệu Trưởng Trái Phép' }
        });

      expect(res.status).toBe(422);
      expect(res.body.message).toContain('Bạn không có quyền gán vai trò này');
    });

    test('D.3: HR không được sửa hoặc thu hồi tài khoản Hiệu trưởng (409)', async () => {
      const resUpdate = await request(saasApp)
        .patch(`/api/v1/system/accounts/${principalA._id}`)
        .set('Authorization', `Bearer ${tokenHrA}`)
        .send({ profile: { fullName: 'Sửa Trái Phép Tên HT' } });
      expect(resUpdate.status).toBe(409);
      expect(resUpdate.body.message).toContain('Nhân sự không thể thay đổi tài khoản Hiệu trưởng');

      const resDeact = await request(saasApp)
        .delete(`/api/v1/system/accounts/${principalA._id}`)
        .set('Authorization', `Bearer ${tokenHrA}`);
      expect(resDeact.status).toBe(409);
      expect(resDeact.body.message).toContain('Nhân sự không thể thay đổi tài khoản Hiệu trưởng');
    });

    test('D.4: Không thể tự sửa hoặc tự thu hồi tài khoản của chính mình (409)', async () => {
      const resSelfUpdate = await request(saasApp)
        .patch(`/api/v1/system/accounts/${adminA._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ profile: { fullName: 'Tự Đổi Tên Mình' } });
      expect(resSelfUpdate.status).toBe(409);
      expect(resSelfUpdate.body.message).toContain('Không thể tự thay đổi hoặc thu hồi tài khoản của chính mình');

      const resSelfDeact = await request(saasApp)
        .delete(`/api/v1/system/accounts/${adminA._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resSelfDeact.status).toBe(409);
      expect(resSelfDeact.body.message).toContain('Không thể tự thay đổi hoặc thu hồi tài khoản của chính mình');
    });

    test('D.5: Không thể tự cấp hoặc nâng quyền lên admin qua endpoint update thường lẫn /role (422)', async () => {
      const resUpdate = await request(saasApp)
        .patch(`/api/v1/system/accounts/${teacherA._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ role: 'admin' });
      expect(resUpdate.status).toBe(422);
      expect(resUpdate.body.message).toContain('Bạn không có quyền gán vai trò này');

      const resRole = await request(saasApp)
        .patch(`/api/v1/system/accounts/${teacherA._id}/role`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ role: 'admin' });
      expect(resRole.status).toBe(422);
      expect(resRole.body.message).toContain('Bạn không có quyền gán vai trò này');
    });
  });

  // =========================================================================
  // NHÓM E — THU HỒI TÀI KHOẢN (deactivateInternalAccount)
  // =========================================================================
  describe('Nhóm E — Thu Hồi Quyền Truy Cập (deactivateInternalAccount)', () => {
    test('E.1: Khóa đúng tài khoản trong tenant: status thành inactive, authVersion tăng lên 1', async () => {
      const res = await request(saasApp)
        .delete(`/api/v1/system/accounts/${teacherA._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('inactive');

      const userInDb = await User.findById(teacherA._id);
      expect(userInDb.status).toBe('inactive');
      expect(userInDb.authVersion).toBe(1);

      // Does NOT mark Employee as resigned
      const empInDb = await Employee.findOne({ userId: teacherA._id });
      expect(empInDb.status).toBe('active');
    });

    test('E.2: Token cũ của tài khoản vừa bị khóa bị schoolAuthMiddleware thật từ chối (401)', async () => {
      // teacherA has valid tokenTeacherA generated with authVersion: 0 and status: active
      // 1. Deactivate teacherA
      await request(saasApp)
        .delete(`/api/v1/system/accounts/${teacherA._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      // 2. teacherA attempts to call SaaS endpoint with the old token on /me
      const resMe = await request(saasApp)
        .get('/api/v1/system/me')
        .set('Authorization', `Bearer ${tokenTeacherA}`);

      expect(resMe.status).toBe(401);
      // Denied because user status is inactive
      expect(resMe.body.code).toBe('USER_INACTIVE');

      // 3. teacherA attempts to call /accounts with old token
      const resAccounts = await request(saasApp)
        .get('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenTeacherA}`);

      expect(resAccounts.status).toBe(401);
      expect(resAccounts.body.code).toBe('USER_INACTIVE');
    });

    test('E.3: Thao tác deactivate lặp lại trên tài khoản đã inactive có hành vi ổn định (200, idempotent)', async () => {
      // First deactivation
      await request(saasApp)
        .delete(`/api/v1/system/accounts/${teacherA._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      const userAfterFirst = await User.findById(teacherA._id);
      const authVersionFirst = userAfterFirst.authVersion;

      // Second deactivation on the already inactive account
      const resSecond = await request(saasApp)
        .delete(`/api/v1/system/accounts/${teacherA._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(resSecond.status).toBe(200);

      const userAfterSecond = await User.findById(teacherA._id);
      expect(userAfterSecond.status).toBe('inactive');
      // Idempotent: authVersion does not continuously increment if already inactive
      expect(userAfterSecond.authVersion).toBe(authVersionFirst);
    });

    test('E.4: Thao tác thu hồi tại Tenant A hoàn toàn không ảnh hưởng đến Tenant B', async () => {
      // Admin A attempts to deactivate Teacher B
      const res = await request(saasApp)
        .delete(`/api/v1/system/accounts/${teacherB._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(404);

      // Teacher B remains active and unaffected
      const teacherBInDb = await User.findById(teacherB._id);
      expect(teacherBInDb.status).toBe('active');
      expect(teacherBInDb.authVersion).toBe(0);
    });
  });

  // =========================================================================
  // NHÓM F — LEGACY ISOLATION VÀ FAIL-CLOSED FEATURE GATE TRÊN createSaasApp
  // =========================================================================
  describe('Nhóm F — Legacy Isolation và Fail-Closed Feature Gate', () => {
    test('F.1: Legacy Admin thao tác được danh sách tài khoản legacy (missing / null) và không thấy dữ liệu SaaS', async () => {
      const res = await request(legacyApp)
        .get('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenLegacyAdmin}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const usernames = res.body.data.map((u) => u.username);
      expect(usernames).toContain('legacy_admin');
      expect(usernames).toContain('legacy_teacher_missing');
      expect(usernames).toContain('legacy_teacher_null');

      // MUST NOT see SaaS accounts
      expect(usernames).not.toContain('admin_a');
      expect(usernames).not.toContain('teacher_a');
      expect(usernames).not.toContain('admin_b');
      expect(usernames).not.toContain('teacher_b');
    });

    test('F.2: Legacy Admin tạo tài khoản nội bộ mới nhận đúng tenantId: null cho cả User và Employee', async () => {
      const res = await request(legacyApp)
        .post('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenLegacyAdmin}`)
        .send({
          username: 'legacy_chef_new',
          password: 'Password123@#',
          role: 'chef',
          profile: { fullName: 'Đầu Bếp Legacy Mới' }
        });

      expect(res.status).toBe(201);

      const userInDb = await User.findOne({ username: 'legacy_chef_new' });
      expect(userInDb).not.toBeNull();
      expect(userInDb.tenantId).toBeNull();

      const empInDb = await Employee.findOne({ userId: userInDb._id });
      expect(empInDb).not.toBeNull();
      expect(empInDb.tenantId).toBeNull();
    });

    test('F.3: createSaasApp sản phẩm tiếp tục chặn endpoint /api/v1/system/accounts (501) trong các mode hiện hành', async () => {
      // Phase 1b mode
      const saasApp1b = createSaasApp({
        mongoUri,
        connection: bootstrapInstance.connection,
        saasMode: 'phase1b'
      });

      const resGet1b = await request(saasApp1b)
        .get('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resGet1b.status).toBe(501);
      expect(resGet1b.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');

      const resPost1b = await request(saasApp1b)
        .post('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ username: 'any_user' });
      expect(resPost1b.status).toBe(501);
      expect(resPost1b.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');

      // Phase 1c mode
      const saasApp1c = createSaasApp({
        mongoUri,
        connection: bootstrapInstance.connection,
        saasMode: 'phase1c'
      });

      const resGet1c = await request(saasApp1c)
        .get('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resGet1c.status).toBe(501);
      expect(resGet1c.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
    });
  });
});
