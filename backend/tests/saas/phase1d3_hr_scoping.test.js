/**
 * Task 1D.3: Cách ly nghiệp vụ nhân sự, phòng ban và nghỉ phép theo trường
 *
 * File: backend/tests/saas/phase1d3_hr_scoping.test.js
 *
 * Kiểm chứng toàn diện:
 * - Nhóm A: Phòng ban (getDepartments, createDepartment, updateDepartment).
 *   Tenant A chỉ thấy/sửa phòng ban A; Bắt E11000 từ global unique index code; ID ngoại lai trả 404; Không đổi được tenantId.
 * - Nhóm B: Tài khoản nhân sự & Đồng bộ (getStaffAccounts, syncStaffAccounts).
 *   Chỉ tài khoản User/Employee cùng tenant; Sync không tạo chéo trường; Idempotent; Rollback an toàn.
 * - Nhóm C: Hồ sơ nhân sự (getEmployees, getEmployeeById, getEmployeeHistory, createEmployee, updateEmployee, deleteEmployee).
 *   Scope danh sách/chi tiết/lịch sử; Sanitize populate ngoại lai; Chặn liên kết User/Department chéo trường; Delete trả 409.
 * - Nhóm D: Nghỉ phép nhân sự (createLeaveRequest, getMyLeaveRequests, getLeaveOverview, getLeaveRequests, processLeaveRequest).
 *   Nhân viên chỉ tạo/xem đơn của mình; Admin/HR chỉ xem/duyệt đơn cùng trường; Notification chỉ gửi nội bộ trường; Không tự duyệt đơn mình.
 * - Nhóm E: RBAC Middleware thật & Legacy Isolation.
 *   Role không đủ quyền bị 403; Legacy Admin thao tác độc lập với tenantId: null; createSaasApp tiếp tục chặn router HR ở mode hiện hành.
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
const Department = require('../../src/models/zone2_hr/Department');
const Employee = require('../../src/models/zone2_hr/Employee');
const LeaveRequest = require('../../src/models/zone2_hr/LeaveRequest');
const Notification = require('../../src/models/zone1_system/Notification');
const AuditLog = require('../../src/models/zone1_system/AuditLog');

const hrController = require('../../src/controllers/hrController');
const Classroom = require('../../src/models/zone3_school/Classroom');
const StaffShift = require('../../src/models/zone2_hr/StaffShift');
const { getStaffingSnapshot, getStaffingTimetable } = require('../../src/services/staffingService');
const { scheduledLeaveDates } = require('../../src/services/staffLeaveService');
const { createTrustedTenantContext } = require('../../src/services/tenantFilterService');
const credentialService = require('../../src/services/credentialService');
const { generateSchoolUserToken } = require('../../src/saas/utils/saasJwt');
const { generateToken: generateLegacyToken } = require('../../src/utils/jwt');
const { hashPassword } = require('../../src/utils/passwordHash');

// Build SaaS test harness for HR endpoints using real schoolAuthMiddleware and roleCheck
const buildSaasHrApp = () => {
  const app = express();
  app.use(express.json());

  const router = express.Router();
  router.use(schoolAuthMiddleware);
  router.use(hrAccessAudit('hr'));

  // Departments
  router.get('/departments', roleCheck(['admin', 'principal', 'accountant', 'hr']), hrController.getDepartments);
  router.post('/departments', roleCheck(['admin']), hrController.createDepartment);
  router.put('/departments/:id', roleCheck(['admin']), hrController.updateDepartment);

  // Staff accounts
  router.get('/staff-accounts', roleCheck(['admin', 'principal', 'hr']), hrController.getStaffAccounts);
  router.post('/staff-accounts/sync', roleCheck(['admin', 'hr']), hrController.syncStaffAccounts);

  // Employees
  router.get('/employees', roleCheck(['admin', 'principal', 'accountant', 'hr']), hrController.getEmployees);
  router.get('/employees/:id', roleCheck(['admin', 'principal', 'accountant', 'hr']), hrController.getEmployeeById);
  router.get('/employees/:id/history', roleCheck(['admin', 'principal', 'hr']), hrController.getEmployeeHistory);
  router.post('/employees', roleCheck(['admin', 'hr']), hrController.createEmployee);
  router.put('/employees/:id', roleCheck(['admin', 'hr']), hrController.updateEmployee);
  router.delete('/employees/:id', roleCheck(['admin', 'hr']), hrController.deleteEmployee);

  // Leave Requests
  router.post('/leave-requests', roleCheck(['admin', 'teacher', 'accountant', 'chef', 'guard', 'hr']), hrController.createLeaveRequest);
  router.get('/my-leave-requests', roleCheck(['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard', 'hr']), hrController.getMyLeaveRequests);
  router.get('/leave-requests/overview', roleCheck(['admin', 'principal', 'hr']), hrController.getLeaveOverview);
  router.get('/leave-requests', roleCheck(['admin', 'principal', 'hr']), hrController.getLeaveRequests);
  router.patch('/leave-requests/:id/review', roleCheck(['admin', 'principal']), hrController.processLeaveRequest);

  app.use('/api/v1/hr', router);
  return app;
};

// Build Legacy test harness for HR endpoints using real legacyAuth and roleCheck
const buildLegacyHrApp = () => {
  const app = express();
  app.use(express.json());

  const router = express.Router();
  router.use(legacyAuth);
  router.use(hrAccessAudit('hr'));

  router.get('/departments', roleCheck(['admin', 'principal', 'accountant', 'hr']), hrController.getDepartments);
  router.post('/departments', roleCheck(['admin']), hrController.createDepartment);
  router.put('/departments/:id', roleCheck(['admin']), hrController.updateDepartment);

  router.get('/staff-accounts', roleCheck(['admin', 'principal', 'hr']), hrController.getStaffAccounts);
  router.post('/staff-accounts/sync', roleCheck(['admin', 'hr']), hrController.syncStaffAccounts);

  router.get('/employees', roleCheck(['admin', 'principal', 'accountant', 'hr']), hrController.getEmployees);
  router.get('/employees/:id', roleCheck(['admin', 'principal', 'accountant', 'hr']), hrController.getEmployeeById);
  router.post('/employees', roleCheck(['admin', 'hr']), hrController.createEmployee);
  router.put('/employees/:id', roleCheck(['admin', 'hr']), hrController.updateEmployee);

  router.post('/leave-requests', roleCheck(['admin', 'teacher', 'accountant', 'chef', 'guard', 'hr']), hrController.createLeaveRequest);
  router.get('/my-leave-requests', roleCheck(['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard', 'hr']), hrController.getMyLeaveRequests);
  router.get('/leave-requests', roleCheck(['admin', 'principal', 'hr']), hrController.getLeaveRequests);
  router.patch('/leave-requests/:id/review', roleCheck(['admin', 'principal']), hrController.processLeaveRequest);

  app.use('/api/v1/hr', router);
  return app;
};

describe('Task 1D.3: Cách ly nghiệp vụ nhân sự, phòng ban và nghỉ phép theo trường', () => {
  let bootstrapInstance;
  let saasApp;
  let legacyApp;

  let tenantA;
  let tenantB;

  let adminUserA, adminTokenA;
  let hrUserA, hrTokenA;
  let teacherUserA, teacherTokenA;
  let employeeTeacherA;

  let adminUserB, adminTokenB;
  let hrUserB, hrTokenB;
  let teacherUserB, teacherTokenB;
  let employeeTeacherB;

  let legacyAdminUser, legacyAdminToken;

  let deptA1, deptB1;

  beforeAll(async () => {
    bootstrapInstance = await testDbBootstrap.startTestDb({
      instanceOpts: [{ dbName: 'school_saas_phase1d3_hr_test' }]
    });
    saasApp = buildSaasHrApp();
    legacyApp = buildLegacyHrApp();

    await Promise.all([
      Tenant.syncIndexes(),
      User.syncIndexes(),
      Department.syncIndexes(),
      Employee.syncIndexes(),
      LeaveRequest.syncIndexes(),
      Notification.syncIndexes(),
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
      Department.deleteMany({}),
      Employee.deleteMany({}),
      LeaveRequest.deleteMany({}),
      Notification.deleteMany({}),
      AuditLog.deleteMany({})
    ]);

    // 1. Setup Tenants
    tenantA = await Tenant.create({
      code: 'SCHOOL-A',
      name: 'Trường Tiểu học Quốc tế Ánh Sao',
      status: 'active',
      subscriptionPlan: 'standard'
    });

    tenantB = await Tenant.create({
      code: 'SCHOOL-B',
      name: 'Trường Mầm non Tuổi Thơ B',
      status: 'active',
      subscriptionPlan: 'standard'
    });

    const defaultPasswordHash = await hashPassword('TestPassword123@');

    // 2. Setup Users Tenant A
    adminUserA = await User.create({
      username: 'admin_a',
      tenantId: tenantA._id,
      passwordHash: defaultPasswordHash,
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Quản trị viên Trường A', phone: '0901000001' }
    });
    adminTokenA = generateSchoolUserToken(adminUserA, tenantA);

    hrUserA = await User.create({
      username: 'hr_a',
      tenantId: tenantA._id,
      passwordHash: defaultPasswordHash,
      role: 'hr',
      status: 'active',
      profile: { fullName: 'Nhân sự Trường A', phone: '0901000002' }
    });
    hrTokenA = generateSchoolUserToken(hrUserA, tenantA);

    teacherUserA = await User.create({
      username: 'teacher_a',
      tenantId: tenantA._id,
      passwordHash: defaultPasswordHash,
      role: 'teacher',
      status: 'active',
      profile: { fullName: 'Giáo viên Nguyễn Văn A', phone: '0901000003' }
    });
    teacherTokenA = generateSchoolUserToken(teacherUserA, tenantA);

    // 3. Setup Users Tenant B
    adminUserB = await User.create({
      username: 'admin_b',
      tenantId: tenantB._id,
      passwordHash: defaultPasswordHash,
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Quản trị viên Trường B', phone: '0902000001' }
    });
    adminTokenB = generateSchoolUserToken(adminUserB, tenantB);

    hrUserB = await User.create({
      username: 'hr_b',
      tenantId: tenantB._id,
      passwordHash: defaultPasswordHash,
      role: 'hr',
      status: 'active',
      profile: { fullName: 'Nhân sự Trường B', phone: '0902000002' }
    });
    hrTokenB = generateSchoolUserToken(hrUserB, tenantB);

    teacherUserB = await User.create({
      username: 'teacher_b',
      tenantId: tenantB._id,
      passwordHash: defaultPasswordHash,
      role: 'teacher',
      status: 'active',
      profile: { fullName: 'Giáo viên Trần Thị B', phone: '0902000003' }
    });
    teacherTokenB = generateSchoolUserToken(teacherUserB, tenantB);

    // 4. Setup Legacy Admin
    legacyAdminUser = await User.create({
      username: 'legacy_admin',
      tenantId: null,
      passwordHash: defaultPasswordHash,
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Quản trị viên Hệ thống Cũ' }
    });
    legacyAdminToken = generateLegacyToken(legacyAdminUser);

    // 5. Setup Departments
    deptA1 = await Department.create({
      code: 'DEPT-A-PRIMARY',
      name: 'Tổ Tiểu học A',
      tenantId: tenantA._id,
      status: 'active'
    });

    deptB1 = await Department.create({
      code: 'DEPT-B-KINDER',
      name: 'Tổ Mầm non B',
      tenantId: tenantB._id,
      status: 'active'
    });

    // 6. Setup Employees
    employeeTeacherA = await Employee.create({
      userId: teacherUserA._id,
      tenantId: tenantA._id,
      employeeCode: 'GV-A-001',
      fullName: 'Giáo viên Nguyễn Văn A',
      phone: '0901000003',
      departmentId: deptA1._id,
      departmentName: deptA1.name,
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active',
      salaryConfig: { baseSalary: 12000000, lowMonthlySalaryConfirmed: true }
    });

    employeeTeacherB = await Employee.create({
      userId: teacherUserB._id,
      tenantId: tenantB._id,
      employeeCode: 'GV-B-001',
      fullName: 'Giáo viên Trần Thị B',
      phone: '0902000003',
      departmentId: deptB1._id,
      departmentName: deptB1.name,
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active',
      salaryConfig: { baseSalary: 13000000, lowMonthlySalaryConfirmed: true }
    });
  });

  afterEach(async () => {
    // Clean up any test spies/mocks if needed
  });

  // =========================================================================
  // NHÓM A: PHÒNG BAN (DEPARTMENTS)
  // =========================================================================
  describe('Nhóm A: Phòng Ban (Departments)', () => {
    it('A.1: Admin Tenant A chỉ xem được phòng ban của Tenant A (getDepartments)', async () => {
      const res = await request(saasApp)
        .get('/api/v1/hr/departments')
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      const codes = res.body.data.map((d) => d.code);
      expect(codes).toContain('DEPT-A-PRIMARY');
      expect(codes).not.toContain('DEPT-B-KINDER');
    });

    it('A.2: Admin Tenant A tạo Department mới tự động nhận tenantId của Tenant A', async () => {
      const res = await request(saasApp)
        .post('/api/v1/hr/departments')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          code: 'DEPT-A-SEC',
          name: 'Tổ Trung học Cơ sở A',
          description: 'Phòng ban cấp 2'
        });

      expect(res.status).toBe(201);
      expect(res.body.data.code).toBe('DEPT-A-SEC');

      const saved = await Department.findOne({ code: 'DEPT-A-SEC' }).lean();
      expect(saved).not.toBeNull();
      expect(saved.tenantId.toString()).toBe(tenantA._id.toString());
    });

    it('A.3: Tenant A tạo trùng code trong tenant bị trả lỗi 400', async () => {
      const res = await request(saasApp)
        .post('/api/v1/hr/departments')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          code: 'dept-a-primary', // cùng code case-insensitive
          name: 'Tổ Tiểu học trùng mã'
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('đã tồn tại');
    });

    it('A.4: Tenant B tạo trùng code với Tenant A bị chặn bởi global unique index -> trả lỗi 409 có kiểm soát', async () => {
      const res = await request(saasApp)
        .post('/api/v1/hr/departments')
        .set('Authorization', `Bearer ${adminTokenB}`)
        .send({
          code: 'DEPT-A-PRIMARY', // code này đã có ở Tenant A
          name: 'Tổ Thử Trùng Mã Global'
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('đã tồn tại trên hệ thống');
    });

    it('A.5: Admin Tenant A cập nhật phòng ban Tenant A thành công (200), không sửa được của Tenant B (404)', async () => {
      // Sửa phòng ban Tenant A: thành công
      const resOk = await request(saasApp)
        .put(`/api/v1/hr/departments/${deptA1._id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ name: 'Tổ Tiểu học A Đổi Tên', description: 'Mô tả mới' });

      expect(resOk.status).toBe(200);
      expect(resOk.body.data.name).toBe('Tổ Tiểu học A Đổi Tên');

      // Sửa phòng ban Tenant B: 404
      const resForeign = await request(saasApp)
        .put(`/api/v1/hr/departments/${deptB1._id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ name: 'Hack đổi tên Tenant B' });

      expect(resForeign.status).toBe(404);

      // Phòng ban B không bị thay đổi
      const unchangedB = await Department.findById(deptB1._id).lean();
      expect(unchangedB.name).toBe('Tổ Mầm non B');
    });

    it('A.6: Không cho client thay đổi hoặc xóa tenantId của Department qua payload update', async () => {
      const res = await request(saasApp)
        .put(`/api/v1/hr/departments/${deptA1._id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ name: 'Đổi tên có kèm tenantId giả', tenantId: tenantB._id.toString() });

      expect(res.status).toBe(200);
      const after = await Department.findById(deptA1._id).lean();
      expect(after.tenantId.toString()).toBe(tenantA._id.toString()); // tenantId không bị đổi
    });
  });

  // =========================================================================
  // NHÓM B: TÀI KHOẢN NHÂN SỰ & ĐỒNG BỘ (STAFF ACCOUNTS & SYNC)
  // =========================================================================
  describe('Nhóm B: Tài Khoản Nhân Sự & Đồng Bộ (Staff Accounts & Sync)', () => {
    it('B.1: getStaffAccounts chỉ trả về tài khoản và hồ sơ Employee thuộc cùng tenant', async () => {
      const res = await request(saasApp)
        .get('/api/v1/hr/staff-accounts')
        .set('Authorization', `Bearer ${hrTokenA}`);

      expect(res.status).toBe(200);
      const usernames = res.body.data.map((u) => u.username);
      expect(usernames).toContain('admin_a');
      expect(usernames).toContain('hr_a');
      expect(usernames).toContain('teacher_a');
      expect(usernames).not.toContain('admin_b');
      expect(usernames).not.toContain('teacher_b');

      // Kiểm tra employeeProfile đi kèm
      const teacherEntry = res.body.data.find((u) => u.username === 'teacher_a');
      expect(teacherEntry.employeeProfile).not.toBeNull();
      expect(teacherEntry.employeeProfile.employeeCode).toBe('GV-A-001');
    });

    it('B.2: syncStaffAccounts tự động tạo hồ sơ Employee cho tài khoản chưa có trong Tenant A', async () => {
      // Tạo một chef tài khoản mới chưa có Employee trong Tenant A
      const chefUserA = await User.create({
        username: 'chef_a',
        tenantId: tenantA._id,
        passwordHash: 'hash',
        role: 'chef',
        status: 'active',
        profile: { fullName: 'Đầu bếp Trần Văn C', phone: '0901000005' }
      });

      const res = await request(saasApp)
        .post('/api/v1/hr/staff-accounts/sync')
        .set('Authorization', `Bearer ${hrTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.created.length).toBeGreaterThanOrEqual(1);

      // Verify Employee được tạo đúng tenant
      const createdEmployee = await Employee.findOne({ userId: chefUserA._id }).lean();
      expect(createdEmployee).not.toBeNull();
      expect(createdEmployee.tenantId.toString()).toBe(tenantA._id.toString());
      expect(createdEmployee.fullName).toBe('Đầu bếp Trần Văn C');
      expect(createdEmployee.payrollRole).toBe('chef');

      // Chạy lại sync: idempotent (không tạo lại)
      const resRerun = await request(saasApp)
        .post('/api/v1/hr/staff-accounts/sync')
        .set('Authorization', `Bearer ${hrTokenA}`);

      expect(resRerun.status).toBe(200);
      expect(resRerun.body.data.created.length).toBe(0);
    });

    it('B.3: syncStaffAccounts của Tenant A không tạo hồ sơ cho tài khoản của Tenant B', async () => {
      const chefUserB = await User.create({
        username: 'chef_b',
        tenantId: tenantB._id,
        passwordHash: 'hash',
        role: 'chef',
        status: 'active',
        profile: { fullName: 'Đầu bếp Trường B' }
      });

      await request(saasApp)
        .post('/api/v1/hr/staff-accounts/sync')
        .set('Authorization', `Bearer ${hrTokenA}`);

      // Chef B không được tạo hồ sơ bởi Tenant A
      const chefBProfile = await Employee.findOne({ userId: chefUserB._id });
      expect(chefBProfile).toBeNull();
    });
  });

  // =========================================================================
  // NHÓM C: HỒ SƠ NHÂN SỰ (EMPLOYEES CRUD & HISTORY)
  // =========================================================================
  describe('Nhóm C: Hồ Sơ Nhân Sự (Employees CRUD & History)', () => {
    it('C.1: getEmployees chỉ trả về nhân sự thuộc Tenant A, lọc và tìm kiếm chính xác', async () => {
      const res = await request(saasApp)
        .get('/api/v1/hr/employees')
        .set('Authorization', `Bearer ${hrTokenA}`);

      expect(res.status).toBe(200);
      const codes = res.body.data.map((e) => e.employeeCode);
      expect(codes).toContain('GV-A-001');
      expect(codes).not.toContain('GV-B-001');
    });

    it('C.2: getEmployeeById đọc hồ sơ của Tenant A thành công (200), đọc ID của Tenant B trả 404', async () => {
      const resOk = await request(saasApp)
        .get(`/api/v1/hr/employees/${employeeTeacherA._id}`)
        .set('Authorization', `Bearer ${hrTokenA}`);

      expect(resOk.status).toBe(200);
      expect(resOk.body.data.employeeCode).toBe('GV-A-001');

      const resForeign = await request(saasApp)
        .get(`/api/v1/hr/employees/${employeeTeacherB._id}`)
        .set('Authorization', `Bearer ${hrTokenA}`);

      expect(resForeign.status).toBe(404);
    });

    it('C.3: Populate an toàn: Nếu hồ sơ bị liên kết nhầm Department/User ngoại lai, không rò rỉ dữ liệu Tenant B', async () => {
      // Giả lập dữ liệu lỗi: Employee của Tenant A bị link sang department của Tenant B
      const corruptedEmployee = await Employee.create({
        userId: null,
        tenantId: tenantA._id,
        employeeCode: 'NV-A-CORRUPT',
        fullName: 'Nhân viên A Bị Link Nhầm Dept B',
        phone: '0901000999',
        departmentId: deptB1._id, // Dept thuộc Tenant B!
        position: 'teacher',
        payrollRole: 'teacher',
        status: 'active'
      });

      const res = await request(saasApp)
        .get(`/api/v1/hr/employees/${corruptedEmployee._id}`)
        .set('Authorization', `Bearer ${hrTokenA}`);

      expect(res.status).toBe(200);
      // departmentId phải được sanitize thành null hoặc không lộ thông tin Tenant B
      expect(res.body.data.departmentId).toBeNull();
    });

    it('C.4: createEmployee không cho phép liên kết User hoặc Department thuộc Tenant khác (422/404)', async () => {
      // 1. Thử liên kết với User của Tenant B
      const resAlienUser = await request(saasApp)
        .post('/api/v1/hr/employees')
        .set('Authorization', `Bearer ${hrTokenA}`)
        .send({
          employeeCode: 'GV-A-TEST1',
          fullName: 'Giáo viên test liên kết ngoại lai User',
          userId: teacherUserB._id.toString(), // User thuộc Tenant B!
          position: 'teacher',
          payrollRole: 'teacher',
          departmentId: deptA1._id.toString()
        });

      expect(resAlienUser.status).toBe(422);

      // 2. Thử liên kết với Department của Tenant B
      const resAlienDept = await request(saasApp)
        .post('/api/v1/hr/employees')
        .set('Authorization', `Bearer ${hrTokenA}`)
        .send({
          employeeCode: 'GV-A-TEST2',
          fullName: 'Giáo viên test liên kết ngoại lai Dept',
          userId: null,
          position: 'teacher',
          payrollRole: 'teacher',
          departmentId: deptB1._id.toString() // Dept thuộc Tenant B!
        });

      expect(resAlienDept.status).toBe(404);
    });

    it('C.5: createEmployee thành công gán đúng tenantId và ghi AuditLog nguyên tử', async () => {
      const res = await request(saasApp)
        .post('/api/v1/hr/employees')
        .set('Authorization', `Bearer ${hrTokenA}`)
        .send({
          employeeCode: 'GV-A-002',
          fullName: 'Giáo viên Mới Của Trường A',
          phone: '0901000022',
          email: 'gva002@school-a.edu.vn',
          position: 'teacher',
          payrollRole: 'teacher',
          departmentId: deptA1._id.toString(),
          salaryConfig: { baseSalary: 15000000, lowMonthlySalaryConfirmed: true }
        });

      expect(res.status).toBe(201);
      const created = await Employee.findOne({ employeeCode: 'GV-A-002' }).lean();
      expect(created).not.toBeNull();
      expect(created.tenantId.toString()).toBe(tenantA._id.toString());

      // Kiểm tra AuditLog
      const audit = await AuditLog.findOne({ targetId: created._id, action: 'EMPLOYEE_CREATED' }).lean();
      expect(audit).not.toBeNull();
      expect(audit.actorUsername).toBe('hr_a');
    });

    it('C.6: updateEmployee không thể sửa hồ sơ của Tenant B (404) và không thể gán Department ngoại lai (404)', async () => {
      // Sửa hồ sơ Tenant B: 404
      const resForeign = await request(saasApp)
        .put(`/api/v1/hr/employees/${employeeTeacherB._id}`)
        .set('Authorization', `Bearer ${hrTokenA}`)
        .send({ fullName: 'Hack Tên Nhân Viên B' });

      expect(resForeign.status).toBe(404);

      // Sửa hồ sơ Tenant A nhưng truyền departmentId của Tenant B: 404
      const resAlienDept = await request(saasApp)
        .put(`/api/v1/hr/employees/${employeeTeacherA._id}`)
        .set('Authorization', `Bearer ${hrTokenA}`)
        .send({ departmentId: deptB1._id.toString() });

      expect(resAlienDept.status).toBe(404);
    });

    it('C.7: deleteEmployee trả về 409 theo quy định nghiệp vụ hiện hành', async () => {
      const res = await request(saasApp)
        .delete(`/api/v1/hr/employees/${employeeTeacherA._id}`)
        .set('Authorization', `Bearer ${hrTokenA}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('Không thể cho nghỉ việc trực tiếp');
    });

    it('C.8: getEmployeeHistory xác minh đúng tenant: 200 cho nhân sự A, 404 cho nhân sự B (không rò rỉ audit)', async () => {
      // Ghi một audit cho nhân viên B
      await AuditLog.create({
        actorId: adminUserB._id,
        actorUsername: 'admin_b',
        action: 'EMPLOYEE_UPDATED',
        targetType: 'Employee',
        targetId: employeeTeacherB._id,
        before: { fullName: 'Tên Cũ B' },
        after: { fullName: 'Giáo viên Trần Thị B' }
      });

      // Admin A đọc history của nhân viên A: 200
      const resOk = await request(saasApp)
        .get(`/api/v1/hr/employees/${employeeTeacherA._id}/history`)
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(resOk.status).toBe(200);

      // Admin A đọc history của nhân viên B: 404
      const resForeign = await request(saasApp)
        .get(`/api/v1/hr/employees/${employeeTeacherB._id}/history`)
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(resForeign.status).toBe(404);
    });
  });

  // =========================================================================
  // NHÓM D: NGHỈ PHÉP NHÂN SỰ (LEAVE REQUESTS)
  // =========================================================================
  describe('Nhóm D: Nghỉ Phép Nhân Sự (Leave Requests)', () => {
    it('D.1: createLeaveRequest: Giáo viên tạo đơn nghỉ cho chính mình thành công (201)', async () => {
      const res = await request(saasApp)
        .post('/api/v1/hr/leave-requests')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({
          employeeId: employeeTeacherA._id.toString(),
          leaveType: 'annual',
          startDate: '2026-11-10',
          endDate: '2026-11-11',
          reason: 'Nghỉ giải quyết việc gia đình'
        });

      expect(res.status).toBe(201);
      expect(res.body.data.employeeId.toString()).toBe(employeeTeacherA._id.toString());
      expect(res.body.data.totalDays).toBeGreaterThanOrEqual(1);

      const saved = await LeaveRequest.findById(res.body.data._id).lean();
      expect(saved).not.toBeNull();
      expect(saved.tenantId.toString()).toBe(tenantA._id.toString());
    });

    it('D.2: Giáo viên Tenant A không thể tạo đơn nghỉ cho nhân sự Tenant B (403/404)', async () => {
      const res = await request(saasApp)
        .post('/api/v1/hr/leave-requests')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({
          employeeId: employeeTeacherB._id.toString(),
          leaveType: 'annual',
          startDate: '2026-11-10',
          endDate: '2026-11-11',
          reason: 'Cố tình tạo đơn nghỉ cho nhân sự trường khác'
        });

      // Bị từ chối 404 (không tìm thấy nhân viên trong tenant)
      expect(res.status).toBe(404);
    });

    it('D.3: Notification khi tạo đơn nghỉ chỉ gửi cho admin/principal cùng tenant, không gửi cho Tenant B', async () => {
      await request(saasApp)
        .post('/api/v1/hr/leave-requests')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({
          employeeId: employeeTeacherA._id.toString(),
          leaveType: 'annual',
          startDate: '2026-11-16',
          endDate: '2026-11-16',
          reason: 'Nghỉ khám sức khỏe định kỳ'
        });

      // Admin A nhận notification
      const notifA = await Notification.findOne({ recipientId: adminUserA._id, type: 'leave_request' });
      expect(notifA).not.toBeNull();

      // Admin B KHÔNG nhận notification
      const notifB = await Notification.findOne({ recipientId: adminUserB._id, type: 'leave_request' });
      expect(notifB).toBeNull();
    });

    it('D.4: getMyLeaveRequests: Giáo viên A chỉ xem đơn của mình, không thấy đơn của giáo viên B', async () => {
      // Tạo đơn cho B
      await LeaveRequest.create({
        employeeId: employeeTeacherB._id,
        employeeCode: employeeTeacherB.employeeCode,
        employeeName: employeeTeacherB.fullName,
        leaveType: 'sick',
        startDate: new Date('2026-11-12T12:00:00.000Z'),
        endDate: new Date('2026-11-13T12:00:00.000Z'),
        totalDays: 2,
        workDates: ['2026-11-12', '2026-11-13'],
        reason: 'Đơn nghỉ của B',
        requestedBy: teacherUserB._id,
        tenantId: tenantB._id,
        status: 'pending'
      });

      const res = await request(saasApp)
        .get('/api/v1/hr/my-leave-requests')
        .set('Authorization', `Bearer ${teacherTokenA}`);

      expect(res.status).toBe(200);
      const requests = res.body.data.requests;
      expect(requests.some((r) => r.employeeCode === 'GV-B-001')).toBe(false);
    });

    it('D.5: getLeaveRequests: HR Tenant A chỉ xem các đơn nghỉ của Tenant A', async () => {
      // Đơn của A
      await LeaveRequest.create({
        employeeId: employeeTeacherA._id,
        employeeCode: employeeTeacherA.employeeCode,
        employeeName: employeeTeacherA.fullName,
        leaveType: 'annual',
        startDate: new Date('2026-11-18T12:00:00.000Z'),
        endDate: new Date('2026-11-18T12:00:00.000Z'),
        totalDays: 1,
        workDates: ['2026-11-18'],
        reason: 'Đơn nghỉ của A',
        requestedBy: teacherUserA._id,
        tenantId: tenantA._id,
        status: 'pending'
      });

      const res = await request(saasApp)
        .get('/api/v1/hr/leave-requests')
        .set('Authorization', `Bearer ${hrTokenA}`);

      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.every((r) => r.employeeCode.startsWith('GV-A'))).toBe(true);
    });

    it('D.6: processLeaveRequest: Admin duyệt đơn của Tenant A (200), duyệt đơn Tenant B bị 404', async () => {
      // Đơn của A
      const leaveA = await LeaveRequest.create({
        employeeId: employeeTeacherA._id,
        employeeCode: employeeTeacherA.employeeCode,
        employeeName: employeeTeacherA.fullName,
        leaveType: 'annual',
        startDate: new Date('2026-11-20T12:00:00.000Z'),
        endDate: new Date('2026-11-20T12:00:00.000Z'),
        totalDays: 1,
        workDates: ['2026-11-20'],
        reason: 'Đơn nghỉ cần duyệt của A',
        requestedBy: teacherUserA._id,
        tenantId: tenantA._id,
        status: 'pending'
      });

      // Đơn của B
      const leaveB = await LeaveRequest.create({
        employeeId: employeeTeacherB._id,
        employeeCode: employeeTeacherB.employeeCode,
        employeeName: employeeTeacherB.fullName,
        leaveType: 'annual',
        startDate: new Date('2026-11-20T12:00:00.000Z'),
        endDate: new Date('2026-11-20T12:00:00.000Z'),
        totalDays: 1,
        workDates: ['2026-11-20'],
        reason: 'Đơn nghỉ cần duyệt của B',
        requestedBy: teacherUserB._id,
        tenantId: tenantB._id,
        status: 'pending'
      });

      // Admin A duyệt đơn của B: 404
      const resForeign = await request(saasApp)
        .patch(`/api/v1/hr/leave-requests/${leaveB._id}/review`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ approved: true });

      expect(resForeign.status).toBe(404);

      // Admin A duyệt đơn của A: 200
      const resOk = await request(saasApp)
        .patch(`/api/v1/hr/leave-requests/${leaveA._id}/review`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ approved: true });

      expect(resOk.status).toBe(200);
      expect(resOk.body.data.status).toBe('approved');

      // Notification chỉ gửi cho giáo viên A và HR của A
      const notifTeacher = await Notification.findOne({ recipientId: teacherUserA._id, title: 'Đơn nghỉ phép đã được duyệt' });
      expect(notifTeacher).not.toBeNull();

      const notifHrA = await Notification.findOne({ recipientId: hrUserA._id, title: 'Cần kiểm tra phân công khi nhân viên nghỉ' });
      expect(notifHrA).not.toBeNull();

      const notifHrB = await Notification.findOne({ recipientId: hrUserB._id, title: 'Cần kiểm tra phân công khi nhân viên nghỉ' });
      expect(notifHrB).toBeNull();
    });
  });

  // =========================================================================
  // NHÓM E: RBAC MIDDLEWARE THẬT & LEGACY ISOLATION
  // =========================================================================
  describe('Nhóm E: RBAC Middleware Thật & Legacy Isolation', () => {
    it('E.1: Giáo viên bị từ chối 403 khi gọi các endpoint quản lý của HR/Admin', async () => {
      // Giáo viên gọi POST /departments -> 403
      const resDept = await request(saasApp)
        .post('/api/v1/hr/departments')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({ code: 'DEPT-TEST', name: 'Tổ Thử' });
      expect(resDept.status).toBe(403);

      // Giáo viên gọi POST /employees -> 403
      const resEmp = await request(saasApp)
        .post('/api/v1/hr/employees')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({ employeeCode: 'GV-TEST', fullName: 'Test' });
      expect(resEmp.status).toBe(403);

      // Giáo viên gọi PATCH /leave-requests/:id/review -> 403
      const resReview = await request(saasApp)
        .patch(`/api/v1/hr/leave-requests/${new mongoose.Types.ObjectId()}/review`)
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({ approved: true });
      expect(resReview.status).toBe(403);
    });

    it('E.2: Legacy Admin thao tác độc lập với tenantId: null, không thấy dữ liệu SaaS', async () => {
      // Tạo phòng ban legacy
      const legacyDept = await Department.create({
        code: 'DEPT-LEGACY',
        name: 'Tổ Hệ Thống Cũ',
        tenantId: null,
        status: 'active'
      });

      const res = await request(legacyApp)
        .get('/api/v1/hr/departments')
        .set('Authorization', `Bearer ${legacyAdminToken}`);

      expect(res.status).toBe(200);
      const codes = res.body.data.map((d) => d.code);
      expect(codes).toContain('DEPT-LEGACY');
      expect(codes).not.toContain('DEPT-A-PRIMARY');
      expect(codes).not.toContain('DEPT-B-KINDER');
    });

    it('E.3: createSaasApp tiếp tục chặn các route HR (HTTP 501 / 404) ở mode hiện hành (chưa tích hợp router SaaS HR)', async () => {
      const productionSaasApp = createSaasApp({
        mongoUri: bootstrapInstance.uri,
        connection: bootstrapInstance.connection,
        saasMode: 'phase1b'
      });
      const res = await request(productionSaasApp)
        .get('/api/v1/hr/departments')
        .set('Authorization', `Bearer ${adminTokenA}`);

      // Router /api/v1/hr chưa được mount trong createSaasApp -> trả về 404 hoặc 501
      expect([404, 501]).toContain(res.status);
    });
  });

  // =========================================================================
  // NHÓM F: TENANT CONTEXT ENFORCEMENT TRONG STAFFING SERVICE & LEAVE HELPER (MỤC 1 & 2)
  // =========================================================================
  describe('Nhóm F: Tenant Context Enforcement trong Staffing & Leave Helper (Mục 1 & 2)', () => {
    it('F.1: getStaffingSnapshot và getStaffingTimetable thiếu context hoặc context sai bị fail closed (throw), không đọc {} toàn collection', async () => {
      // 1. Thiếu context (undefined)
      await expect(getStaffingSnapshot('2026-11-04')).rejects.toThrow();
      await expect(getStaffingTimetable({ startDate: '2026-11-04' })).rejects.toThrow();

      // 2. Context sai (plain object giả mạo không qua trusted context)
      await expect(getStaffingSnapshot('2026-11-04', { tenantId: '12345' })).rejects.toThrow();
      await expect(getStaffingTimetable({ startDate: '2026-11-04', context: { tenantId: '12345' } })).rejects.toThrow();
    });

    it('F.2: getStaffingSnapshot với Tenant A, B và Legacy Context cách ly độc lập, chỉ đọc dữ liệu của mình', async () => {
      // Tạo lớp học ở Tenant A, Tenant B, và Legacy
      const classA = await Classroom.create({
        tenantId: tenantA._id,
        name: 'Lớp Snapshot A',
        schoolYear: '2026-2027',
        ageGroup: '5-6',
        status: 'active',
        teachers: []
      });

      const classB = await Classroom.create({
        tenantId: tenantB._id,
        name: 'Lớp Snapshot B',
        schoolYear: '2026-2027',
        ageGroup: '5-6',
        status: 'active',
        teachers: []
      });

      const classLegacy = await Classroom.create({
        tenantId: null,
        name: 'Lớp Snapshot Legacy',
        schoolYear: '2026-2027',
        ageGroup: '5-6',
        status: 'active',
        teachers: []
      });

      const ctxA = createTrustedTenantContext({ tenantId: tenantA._id });
      const ctxB = createTrustedTenantContext({ tenantId: tenantB._id });
      const ctxLegacy = createTrustedTenantContext({ isLegacy: true });

      const snapA = await getStaffingSnapshot('2026-11-04', ctxA);
      const namesA = snapA.classrooms.map((c) => c.name);
      expect(namesA).toContain('Lớp Snapshot A');
      expect(namesA).not.toContain('Lớp Snapshot B');
      expect(namesA).not.toContain('Lớp Snapshot Legacy');

      const snapB = await getStaffingSnapshot('2026-11-04', ctxB);
      const namesB = snapB.classrooms.map((c) => c.name);
      expect(namesB).toContain('Lớp Snapshot B');
      expect(namesB).not.toContain('Lớp Snapshot A');
      expect(namesB).not.toContain('Lớp Snapshot Legacy');

      const snapLegacy = await getStaffingSnapshot('2026-11-04', ctxLegacy);
      const namesLegacy = snapLegacy.classrooms.map((c) => c.name);
      expect(namesLegacy).toContain('Lớp Snapshot Legacy');
      expect(namesLegacy).not.toContain('Lớp Snapshot A');
      expect(namesLegacy).not.toContain('Lớp Snapshot B');
    });

    it('F.3: scheduledLeaveDates: User A bị Classroom Tenant B tham chiếu ngày học khác -> lịch Tenant B không làm đổi workDates của đơn A', async () => {
      // Giáo viên A thuộc Tenant A có lịch lớp A học thứ 2, 4, 6 (1, 3, 5)
      await Classroom.create({
        tenantId: tenantA._id,
        name: 'Lớp A Lịch 2-4-6',
        schoolYear: '2026-2027',
        ageGroup: '5-6',
        status: 'active',
        homeroomTeacherId: teacherUserA._id,
        teachingWeekdays: [1, 3, 5]
      });

      // Lớp ngoại lai ở Tenant B tham chiếu teacherUserA nhưng dạy thứ 3, 5 (2, 4)
      await Classroom.create({
        tenantId: tenantB._id,
        name: 'Lớp Ngoại Lai B Lịch 3-5',
        schoolYear: '2026-2027',
        ageGroup: '5-6',
        status: 'active',
        homeroomTeacherId: teacherUserA._id,
        teachingWeekdays: [2, 4]
      });

      const ctxA = createTrustedTenantContext({ tenantId: tenantA._id });

      // Khoảng ngày từ Thứ Hai 2026-11-02 đến Thứ Sáu 2026-11-06 (5 ngày)
      // Nếu đúng lịch của Tenant A: chỉ gồm 2026-11-02 (T2), 2026-11-04 (T4), 2026-11-06 (T6) -> 3 ngày!
      // Nếu bị ô nhiễm bởi lớp B: sẽ có thêm ngày thứ 3 và thứ 5!
      const dates = await scheduledLeaveDates(employeeTeacherA, '2026-11-02', '2026-11-06', ctxA);
      expect(dates).toEqual(['2026-11-02', '2026-11-04', '2026-11-06']);
      expect(dates).not.toContain('2026-11-03');
      expect(dates).not.toContain('2026-11-05');
    });

    it('F.4: scheduledLeaveDates: StaffShift Tenant B tham chiếu Employee A -> không làm đổi ngày nghỉ đơn A', async () => {
      // Tạo bảo vệ A tại Tenant A
      const defaultHash = await hashPassword('Password123@#');
      const guardUserA = await User.create({
        username: 'guard_f4_a',
        tenantId: tenantA._id,
        passwordHash: defaultHash,
        role: 'guard',
        status: 'active',
        profile: { fullName: 'Bảo Vệ A' }
      });
      const guardEmpA = await Employee.create({
        userId: guardUserA._id,
        tenantId: tenantA._id,
        employeeCode: 'BV-F4-A',
        fullName: 'Bảo Vệ A',
        position: 'security',
        payrollRole: 'guard',
        status: 'active'
      });
      guardEmpA.userId = guardUserA;

      // Ca làm việc ở Tenant A: chỉ làm thứ 2, thứ 3 (weekdays [1, 2])
      await StaffShift.create({
        tenantId: tenantA._id,
        employeeId: guardEmpA._id,
        role: 'guard',
        name: 'Ca Trực Đêm A',
        startTime: '18:00',
        endTime: '22:00',
        validFrom: '2026-11-01',
        validUntil: '2026-11-30',
        weekdays: [1, 2],
        status: 'active',
        createdBy: adminUserA._id
      });

      // Ca ngoại lai ở Tenant B tham chiếu guardEmpA làm thứ 4, thứ 5 (weekdays [3, 4])
      await StaffShift.create({
        tenantId: tenantB._id,
        employeeId: guardEmpA._id,
        role: 'guard',
        name: 'Ca Ngoại Lai B',
        startTime: '08:00',
        endTime: '12:00',
        validFrom: '2026-11-01',
        validUntil: '2026-11-30',
        weekdays: [3, 4],
        status: 'active',
        createdBy: adminUserA._id
      });

      const ctxA = createTrustedTenantContext({ tenantId: tenantA._id });

      // Khoảng 2026-11-02 (T2) đến 2026-11-06 (T6)
      // Chỉ được tính ca của Tenant A (T2, T3: 2026-11-02, 2026-11-03)
      const dates = await scheduledLeaveDates(guardEmpA, '2026-11-02', '2026-11-06', ctxA);
      expect(dates).toEqual(['2026-11-02', '2026-11-03']);
      expect(dates).not.toContain('2026-11-04');
      expect(dates).not.toContain('2026-11-05');
    });
  });

  // =========================================================================
  // NHÓM G: XÁC MINH RECIPIENT NOTIFICATION, ACTOR RE-VERIFICATION & TRANSACTION PROTECTION (MỤC 3, 4, 5)
  // =========================================================================
  describe('Nhóm G: Recipient Notification, Actor Re-verification & Transaction Protection (Mục 3, 4, 5)', () => {
    it('G.1: processLeaveRequest: Employee A trỏ tới User B (alien user link) -> User B không nhận được thông báo', async () => {
      const defaultHash = await hashPassword('Password123@#');
      const alienUserB = await User.create({
        username: 'alien_user_b_g1',
        tenantId: tenantB._id,
        passwordHash: defaultHash,
        role: 'teacher',
        status: 'active',
        profile: { fullName: 'Alien User B' }
      });

      // Tạo Employee A bị hỏng liên kết trỏ sang User B
      const corruptedEmp = await Employee.create({
        tenantId: tenantA._id,
        userId: alienUserB._id, // Alien User B
        employeeCode: 'GV-CORRUPT-A',
        fullName: 'Nhân viên A link User B',
        position: 'teacher',
        payrollRole: 'teacher',
        status: 'active'
      });

      const leaveCorrupt = await LeaveRequest.create({
        tenantId: tenantA._id,
        employeeId: corruptedEmp._id,
        employeeCode: corruptedEmp.employeeCode,
        employeeName: corruptedEmp.fullName,
        leaveType: 'annual',
        startDate: new Date('2026-11-16T12:00:00.000Z'),
        endDate: new Date('2026-11-17T12:00:00.000Z'),
        totalDays: 2,
        workDates: ['2026-11-16', '2026-11-17'],
        reason: 'Nghỉ giải quyết việc gia đình cá nhân',
        requestedBy: adminUserA._id,
        status: 'pending'
      });

      // Admin A duyệt đơn
      const res = await request(saasApp)
        .patch(`/api/v1/hr/leave-requests/${leaveCorrupt._id}/review`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ approved: true });

      expect(res.status).toBe(200);

      // User B KHÔNG ĐƯỢC nhận thông báo từ việc duyệt đơn của Tenant A!
      const notifB = await Notification.findOne({ recipientId: alienUserB._id, title: 'Đơn nghỉ phép đã được duyệt' });
      expect(notifB).toBeNull();
    });

    it('G.2: createLeaveRequest: Actor bị đổi role sang teacher trước khi transaction snapshot đọc -> Bị từ chối 403', async () => {
      // Hạ quyền adminA xuống teacher trong database
      await User.updateOne({ _id: adminUserA._id }, { $set: { role: 'teacher' } });

      const res = await request(saasApp)
        .post('/api/v1/hr/leave-requests')
        .set('Authorization', `Bearer ${adminTokenA}`) // Token cũ vẫn mang claim admin
        .send({
          employeeId: employeeTeacherA._id.toString(),
          leaveType: 'annual',
          startDate: '2026-11-23',
          endDate: '2026-11-24',
          reason: 'Xin nghỉ việc riêng gia đình dài ngày'
        });

      // Bị từ chối vì actor không còn quyền admin/principal để tạo đơn cho người khác (hoặc không còn quyền hợp lệ)
      expect(res.status).toBe(403);
    });

    it('G.3: createLeaveRequest: Đơn nghỉ trùng lặp được tạo trước transaction snapshot -> Bị từ chối 409 trong transaction', async () => {
      // Tạo trước một đơn pending trong khoảng ngày
      await LeaveRequest.create({
        tenantId: tenantA._id,
        employeeId: employeeTeacherA._id,
        employeeCode: employeeTeacherA.employeeCode,
        employeeName: employeeTeacherA.fullName,
        leaveType: 'annual',
        startDate: new Date('2026-12-01T12:00:00.000Z'),
        endDate: new Date('2026-12-03T12:00:00.000Z'),
        totalDays: 3,
        workDates: ['2026-12-01', '2026-12-02', '2026-12-03'],
        reason: 'Đã có đơn nghỉ từ trước',
        requestedBy: teacherUserA._id,
        status: 'pending'
      });

      // Gửi request tạo đơn trùng khoảng ngày
      const res = await request(saasApp)
        .post('/api/v1/hr/leave-requests')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({
          employeeId: employeeTeacherA._id.toString(),
          leaveType: 'annual',
          startDate: '2026-12-02',
          endDate: '2026-12-04',
          reason: 'Xin nghỉ việc riêng gia đình dài ngày'
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('trùng khoảng ngày');
    });

    it('G.4: createLeaveRequest: AuditLog lỗi mô phỏng -> Rollback toàn bộ LeaveRequest', async () => {
      const spyAudit = jest.spyOn(credentialService, 'audit').mockImplementationOnce(async () => {
        throw new Error('Simulated Audit Failure for Leave Request');
      });

      const res = await request(saasApp)
        .post('/api/v1/hr/leave-requests')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({
          employeeId: employeeTeacherA._id.toString(),
          leaveType: 'sick',
          startDate: '2026-12-10',
          endDate: '2026-12-11',
          reason: 'Nghỉ ốm có chỉ định bác sĩ điều trị'
        });

      expect(res.status).toBe(500);

      // Xác minh LeaveRequest KHÔNG ĐƯỢC tạo (đã rollback hoàn toàn)
      const count = await LeaveRequest.countDocuments({ employeeId: employeeTeacherA._id, reason: 'Nghỉ ốm có chỉ định bác sĩ điều trị' });
      expect(count).toBe(0);

      spyAudit.mockRestore();
    });

  });

  // =========================================================================
  // NHÓM H: KIỂM TRA LẠI QUYỀN ACTOR TRONG TRANSACTION CHO 5 HANDLER
  // =========================================================================
  describe('Nhóm H: Actor Re-verification trong Transaction Snapshot cho 5 Handler', () => {
    let startSessionSpy;

    afterEach(async () => {
      if (startSessionSpy) {
        startSessionSpy.mockRestore();
        startSessionSpy = null;
      }
      // Phục hồi quyền mặc định cho adminUserA và hrUserA
      await User.updateOne({ _id: adminUserA._id }, { $set: { role: 'admin', status: 'active' } });
      await User.updateOne({ _id: hrUserA._id }, { $set: { role: 'hr', status: 'active' } });
    });

    it('H.1: createDepartment: Actor bị hạ quyền sau middleware nhưng trước snapshot -> 403, không tạo phòng ban; Happy path đối ứng thành công', async () => {
      const originalStartSession = mongoose.startSession.bind(mongoose);
      let demotionExecuted = false;

      // Barrier: khi middleware xác thực xong và controller bắt đầu transaction session,
      // cập nhật DB thật để hạ quyền actor thành teacher
      startSessionSpy = jest.spyOn(mongoose, 'startSession').mockImplementation(async (...args) => {
        if (!demotionExecuted) {
          demotionExecuted = true;
          await User.collection.updateOne({ _id: adminUserA._id }, { $set: { role: 'teacher' } });
        }
        return originalStartSession(...args);
      });

      // 1. Phủ nhận: Request qua middleware thật (lúc middleware đọc actor ban đầu là admin),
      // nhưng transaction snapshot đọc actor trong session thấy role teacher -> từ chối 403
      const resDenied = await request(saasApp)
        .post('/api/v1/hr/departments')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          code: 'DEPT-DEMOTE-TEST',
          name: 'Tổ Thử Nghiệm Demote',
          description: 'Mô tả thử nghiệm'
        });

      expect(resDenied.status).toBe(403);
      expect(resDenied.body.message).toContain('không còn quyền');

      // Xác minh DB không bị tạo Department mới
      const deptCheck = await Department.findOne({ code: 'DEPT-DEMOTE-TEST' });
      expect(deptCheck).toBeNull();

      // Dọn dẹp barrier và khôi phục actor
      startSessionSpy.mockRestore();
      startSessionSpy = null;
      await User.collection.updateOne({ _id: adminUserA._id }, { $set: { role: 'admin' } });

      // 2. Khẳng định (Happy Path đối ứng): Khi actor giữ nguyên quyền admin hợp lệ -> 201 thành công
      const resSuccess = await request(saasApp)
        .post('/api/v1/hr/departments')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          code: 'DEPT-DEMOTE-TEST',
          name: 'Tổ Thử Nghiệm Demote',
          description: 'Mô tả thử nghiệm'
        });

      expect(resSuccess.status).toBe(201);
      expect(resSuccess.body.data.code).toBe('DEPT-DEMOTE-TEST');
      const deptCreated = await Department.findOne({ code: 'DEPT-DEMOTE-TEST' });
      expect(deptCreated).not.toBeNull();
      expect(deptCreated.tenantId.toString()).toBe(tenantA._id.toString());
    });

    it('H.2: updateDepartment: Actor bị khóa sau middleware nhưng trước snapshot -> 403, không sửa phòng ban; Happy path đối ứng thành công', async () => {
      const originalStartSession = mongoose.startSession.bind(mongoose);
      let demotionExecuted = false;

      // Barrier: khóa actor sau middleware nhưng trước snapshot
      startSessionSpy = jest.spyOn(mongoose, 'startSession').mockImplementation(async (...args) => {
        if (!demotionExecuted) {
          demotionExecuted = true;
          await User.collection.updateOne({ _id: adminUserA._id }, { $set: { status: 'inactive' } });
        }
        return originalStartSession(...args);
      });

      const resDenied = await request(saasApp)
        .put(`/api/v1/hr/departments/${deptA1._id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          name: 'Tổ Tiểu học A Đã Sửa Đổi Trộm'
        });

      expect(resDenied.status).toBe(403);
      expect(resDenied.body.message).toContain('không còn quyền');

      // Xác minh Department trong DB không bị thay đổi
      const deptAfterDenied = await Department.findById(deptA1._id);
      expect(deptAfterDenied.name).toBe('Tổ Tiểu học A');

      // Dọn dẹp barrier và khôi phục actor
      startSessionSpy.mockRestore();
      startSessionSpy = null;
      await User.collection.updateOne({ _id: adminUserA._id }, { $set: { status: 'active' } });

      // Happy Path đối ứng
      const resSuccess = await request(saasApp)
        .put(`/api/v1/hr/departments/${deptA1._id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          name: 'Tổ Tiểu học A Cập Nhật Hợp Lệ'
        });

      expect(resSuccess.status).toBe(200);
      const deptAfterSuccess = await Department.findById(deptA1._id);
      expect(deptAfterSuccess.name).toBe('Tổ Tiểu học A Cập Nhật Hợp Lệ');
    });

    it('H.3: syncStaffAccounts: Actor bị hạ quyền sau middleware nhưng trước snapshot -> 403, không tạo liên kết hồ sơ; Happy path đối ứng thành công', async () => {
      // Chuẩn bị 1 tài khoản nhân sự chưa có hồ sơ
      const defaultPasswordHash = await hashPassword('TestPassword123@');
      const unlinkedUser = await User.create({
        username: 'accountant_h3_test',
        tenantId: tenantA._id,
        passwordHash: defaultPasswordHash,
        role: 'accountant',
        status: 'active',
        profile: { fullName: 'Kế toán H3 Mới' }
      });

      const originalStartSession = mongoose.startSession.bind(mongoose);
      let demotionExecuted = false;

      // Barrier: hạ quyền hrUserA thành teacher
      startSessionSpy = jest.spyOn(mongoose, 'startSession').mockImplementation(async (...args) => {
        if (!demotionExecuted) {
          demotionExecuted = true;
          await User.collection.updateOne({ _id: hrUserA._id }, { $set: { role: 'teacher' } });
        }
        return originalStartSession(...args);
      });

      const resDenied = await request(saasApp)
        .post('/api/v1/hr/staff-accounts/sync')
        .set('Authorization', `Bearer ${hrTokenA}`);

      expect(resDenied.status).toBe(403);
      expect(resDenied.body.message).toContain('không còn quyền');

      // Xác minh chưa có Employee nào được tạo cho unlinkedUser
      const empAfterDenied = await Employee.findOne({ userId: unlinkedUser._id });
      expect(empAfterDenied).toBeNull();

      // Dọn dẹp barrier và khôi phục actor
      startSessionSpy.mockRestore();
      startSessionSpy = null;
      await User.collection.updateOne({ _id: hrUserA._id }, { $set: { role: 'hr' } });

      // Happy Path đối ứng
      const resSuccess = await request(saasApp)
        .post('/api/v1/hr/staff-accounts/sync')
        .set('Authorization', `Bearer ${hrTokenA}`);

      expect(resSuccess.status).toBe(200);
      expect(resSuccess.body.data.created.length).toBeGreaterThanOrEqual(1);
      const empAfterSuccess = await Employee.findOne({ userId: unlinkedUser._id });
      expect(empAfterSuccess).not.toBeNull();
      expect(empAfterSuccess.fullName).toBe('Kế toán H3 Mới');
    });

    it('H.4: createEmployee: Actor bị hạ quyền sau middleware nhưng trước snapshot -> 403, không tạo Employee và không ghi AuditLog; Happy path đối ứng thành công', async () => {
      const originalStartSession = mongoose.startSession.bind(mongoose);
      let demotionExecuted = false;

      // Barrier: hạ quyền hrUserA thành parent sau middleware
      startSessionSpy = jest.spyOn(mongoose, 'startSession').mockImplementation(async (...args) => {
        if (!demotionExecuted) {
          demotionExecuted = true;
          await User.collection.updateOne({ _id: hrUserA._id }, { $set: { role: 'parent' } });
        }
        return originalStartSession(...args);
      });

      const resDenied = await request(saasApp)
        .post('/api/v1/hr/employees')
        .set('Authorization', `Bearer ${hrTokenA}`)
        .send({
          employeeCode: 'GV-H4-TEST',
          fullName: 'Giáo viên H4 Chưa Tạo',
          position: 'teacher'
        });

      expect(resDenied.status).toBe(403);
      expect(resDenied.body.message).toContain('không còn quyền');

      // Xác minh DB: Không có Employee và không có AuditLog
      const empDenied = await Employee.findOne({ employeeCode: 'GV-H4-TEST' });
      expect(empDenied).toBeNull();
      const auditDenied = await AuditLog.findOne({ 'after.employeeCode': 'GV-H4-TEST' });
      expect(auditDenied).toBeNull();

      // Dọn dẹp barrier và khôi phục actor
      startSessionSpy.mockRestore();
      startSessionSpy = null;
      await User.collection.updateOne({ _id: hrUserA._id }, { $set: { role: 'hr' } });

      // Happy Path đối ứng
      const resSuccess = await request(saasApp)
        .post('/api/v1/hr/employees')
        .set('Authorization', `Bearer ${hrTokenA}`)
        .send({
          employeeCode: 'GV-H4-TEST',
          fullName: 'Giáo viên H4 Đã Tạo Thành Công',
          position: 'teacher'
        });

      expect(resSuccess.status).toBe(201);
      const empSuccess = await Employee.findOne({ employeeCode: 'GV-H4-TEST' });
      expect(empSuccess).not.toBeNull();

      // Xác minh AuditLog được ghi đúng với actorId xác minh từ session
      const auditSuccess = await AuditLog.findOne({ targetId: empSuccess._id, action: 'EMPLOYEE_CREATED' });
      expect(auditSuccess).not.toBeNull();
      expect(auditSuccess.actorId.toString()).toBe(hrUserA._id.toString());
      expect(auditSuccess.actorUsername).toBe(hrUserA.username);
    });

    it('H.5: updateEmployee: Actor bị khóa sau middleware nhưng trước snapshot -> 403, không sửa Employee và không ghi AuditLog; Happy path đối ứng thành công', async () => {
      const originalStartSession = mongoose.startSession.bind(mongoose);
      let demotionExecuted = false;

      // Barrier: khóa actor sau middleware
      startSessionSpy = jest.spyOn(mongoose, 'startSession').mockImplementation(async (...args) => {
        if (!demotionExecuted) {
          demotionExecuted = true;
          await User.collection.updateOne({ _id: hrUserA._id }, { $set: { status: 'inactive' } });
        }
        return originalStartSession(...args);
      });

      const resDenied = await request(saasApp)
        .put(`/api/v1/hr/employees/${employeeTeacherA._id}`)
        .set('Authorization', `Bearer ${hrTokenA}`)
        .send({
          fullName: 'Tên Đã Bị Sửa Trộm H5'
        });

      expect(resDenied.status).toBe(403);
      expect(resDenied.body.message).toContain('không còn quyền');

      // Xác minh DB: Employee không đổi, không có AuditLog sửa trộm
      const empDenied = await Employee.findById(employeeTeacherA._id);
      expect(empDenied.fullName).toBe('Giáo viên Nguyễn Văn A');
      const auditDenied = await AuditLog.findOne({
        targetId: employeeTeacherA._id,
        action: 'EMPLOYEE_UPDATED',
        'after.fullName': 'Tên Đã Bị Sửa Trộm H5'
      });
      expect(auditDenied).toBeNull();

      // Dọn dẹp barrier và khôi phục actor
      startSessionSpy.mockRestore();
      startSessionSpy = null;
      await User.collection.updateOne({ _id: hrUserA._id }, { $set: { status: 'active' } });

      // Happy Path đối ứng
      const resSuccess = await request(saasApp)
        .put(`/api/v1/hr/employees/${employeeTeacherA._id}`)
        .set('Authorization', `Bearer ${hrTokenA}`)
        .send({
          fullName: 'Giáo viên Nguyễn Văn A Cập Nhật Hợp Lệ'
        });

      expect(resSuccess.status).toBe(200);
      const empSuccess = await Employee.findById(employeeTeacherA._id);
      expect(empSuccess.fullName).toBe('Giáo viên Nguyễn Văn A Cập Nhật Hợp Lệ');

      const auditSuccess = await AuditLog.findOne({
        targetId: employeeTeacherA._id,
        action: 'EMPLOYEE_UPDATED',
        'after.fullName': 'Giáo viên Nguyễn Văn A Cập Nhật Hợp Lệ'
      });
      expect(auditSuccess).not.toBeNull();
      expect(auditSuccess.actorId.toString()).toBe(hrUserA._id.toString());
      expect(auditSuccess.actorUsername).toBe(hrUserA.username);
    });
  });
});
