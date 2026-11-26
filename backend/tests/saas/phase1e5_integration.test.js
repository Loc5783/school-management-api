/**
 * Phase 1E.5 SaaS Finance Router Integration & End-to-End Acceptance Test Suite
 *
 * File: backend/tests/saas/phase1e5_integration.test.js
 *
 * Verifies end-to-end integration of Zone 4 Finance routers mounted in createSaasApp:
 * - Nhóm A: Mode Gating, Prefixes & Route Aliasing (/api/v1 and /api, phase1e allowlist, 501 fail-closed)
 * - Nhóm B: Authentication, RBAC & Tenant Boundary (Token verification, roles, cross-tenant isolation, parent scoping)
 * - Nhóm C: Representative Business Workflows (FeeSchedule -> TuitionFee -> Payment -> Receipt; Refund; OpExpense; Purchase; Cashbook; Period)
 * - Nhóm D: Excel Template, Preview, Confirm & Export Scoping
 * - Nhóm E: Consistency, Idempotency Replay & Real-World Index Constraints
 */

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';

jest.setTimeout(120000);

const mongoose = require('mongoose');
const request = require('supertest');
const ExcelJS = require('exceljs');

const testDbBootstrap = require('../../src/saas/testDbBootstrap');
const createSaasApp = require('../../src/saas/createSaasApp');
const { generateSchoolUserToken } = require('../../src/saas/utils/saasJwt');
const { getWorkDate } = require('../../src/utils/dateHelpers');

// System models
const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const ImportIdempotency = require('../../src/models/zone1_system/ImportIdempotency');
const AuditLog = require('../../src/models/zone1_system/AuditLog');
const Classroom = require('../../src/models/zone3_school/Classroom');
const Student = require('../../src/models/zone3_school/Student');

// Zone 4 Finance models
const AccountingPeriod = require('../../src/models/zone4_finance/AccountingPeriod');
const TuitionFee = require('../../src/models/zone4_finance/TuitionFee');
const Payment = require('../../src/models/zone4_finance/Payment');
const InvoiceAdjustment = require('../../src/models/zone4_finance/InvoiceAdjustment');
const TuitionRefundRequest = require('../../src/models/zone4_finance/TuitionRefundRequest');
const OperatingExpense = require('../../src/models/zone4_finance/OperatingExpense');
const OperatingExpenseRequest = require('../../src/models/zone4_finance/OperatingExpenseRequest');
const PurchaseExpense = require('../../src/models/zone4_finance/PurchaseExpense');
const DailyCashReconciliation = require('../../src/models/zone4_finance/DailyCashReconciliation');
const FeeSchedule = require('../../src/models/zone4_finance/FeeSchedule');

// Zone 6 Procurement model
const PurchaseOrder = require('../../src/models/zone6_procurement/PurchaseOrder');

describe('SaaS Phase 1E.5 — Tích Hợp Router Tài Chính SaaS Và Nghiệm Thu Phase 1E', () => {
  let bootstrapInstance;
  let mongoUri;

  // App instances with different SaaS modes
  let app1e;
  let app1d;
  let appUnknown;

  // Tenant fixtures
  let tenantA;
  let tenantB;

  // Users Tenant A
  let adminA;
  let principalA;
  let accountantA;
  let teacherA;
  let parentA1;
  let parentA2;

  // Users Tenant B
  let adminB;
  let principalB;
  let accountantB;
  let parentB;

  // Tokens
  let tokenAdminA;
  let tokenPrincipalA;
  let tokenAccountantA;
  let tokenTeacherA;
  let tokenParentA1;
  let tokenParentA2;

  let tokenAdminB;
  let tokenPrincipalB;
  let tokenAccountantB;
  let tokenParentB;

  // Academic fixtures
  let classroomA1;
  let classroomA2;
  let studentA1;
  let studentA2;

  let classroomB1;
  let studentB1;

  // Legacy fixtures (tenantId: null)
  let classroomLeg;
  let studentLeg;

  // Helper để nhận buffer binary từ supertest khi tải file Excel
  const fetchExcelBinary = async (reqBuilder) => {
    return reqBuilder
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
  };

  beforeAll(async () => {
    bootstrapInstance = await testDbBootstrap.startTestDb({
      instanceOpts: [{ dbName: 'school_saas_phase1e5_integration_test' }]
    });
    mongoUri = bootstrapInstance.uri;

    // Create Express SaaS apps under test
    app1e = createSaasApp({ mongoUri, connection: bootstrapInstance.connection, saasMode: 'phase1e' });
    app1d = createSaasApp({ mongoUri, connection: bootstrapInstance.connection, saasMode: 'phase1d' });
    appUnknown = createSaasApp({ mongoUri, connection: bootstrapInstance.connection, saasMode: 'unknown_mode' });

    await Promise.all([
      Tenant.syncIndexes(),
      User.syncIndexes(),
      ImportIdempotency.syncIndexes(),
      AuditLog.syncIndexes(),
      Classroom.syncIndexes(),
      Student.syncIndexes(),
      AccountingPeriod.syncIndexes(),
      FeeSchedule.syncIndexes(),
      TuitionFee.syncIndexes(),
      Payment.syncIndexes(),
      InvoiceAdjustment.syncIndexes(),
      TuitionRefundRequest.syncIndexes(),
      OperatingExpense.syncIndexes(),
      OperatingExpenseRequest.syncIndexes(),
      PurchaseExpense.syncIndexes(),
      PurchaseOrder.syncIndexes()
    ]);

    // 1. Create Tenants
    tenantA = await Tenant.create({
      code: 'MN-ANHDUONG-A',
      name: 'Trường Mầm Non Ánh Dương A',
      status: 'active',
      authVersion: 1
    });

    tenantB = await Tenant.create({
      code: 'MN-SENHONG-B',
      name: 'Trường Mầm Non Sen Hồng B',
      status: 'active',
      authVersion: 1
    });

    // 2. Classrooms & Students
    classroomA1 = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Mầm 1A',
      ageGroup: '3-4',
      academicYear: '2026-2027',
      status: 'active'
    });

    classroomA2 = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Chồi 1A',
      ageGroup: '4-5',
      academicYear: '2026-2027',
      status: 'active'
    });

    studentA1 = await Student.create({
      tenantId: tenantA._id,
      studentCode: 'HS-2026-000001',
      fullName: 'Nguyễn Văn Bé Một',
      birthDate: new Date('2022-05-10'),
      gender: 'male',
      classroomId: classroomA1._id,
      className: classroomA1.name,
      status: 'enrolled'
    });

    studentA2 = await Student.create({
      tenantId: tenantA._id,
      studentCode: 'HS-2026-000002',
      fullName: 'Trần Thị Bé Hai',
      birthDate: new Date('2021-08-15'),
      gender: 'female',
      classroomId: classroomA2._id,
      className: classroomA2.name,
      status: 'enrolled'
    });

    classroomB1 = await Classroom.create({
      tenantId: tenantB._id,
      name: 'Lớp Mầm 1B',
      ageGroup: '3-4',
      academicYear: '2026-2027',
      status: 'active'
    });

    studentB1 = await Student.create({
      tenantId: tenantB._id,
      studentCode: 'HS-2026-000003',
      fullName: 'Lê Văn Bé Ba',
      birthDate: new Date('2022-03-20'),
      gender: 'male',
      classroomId: classroomB1._id,
      className: classroomB1.name,
      status: 'enrolled'
    });

    // 2b. Legacy Classrooms & Students (tenantId: null)
    classroomLeg = await Classroom.create({
      tenantId: null,
      name: 'Lớp Mầm Legacy',
      ageGroup: '3-4',
      academicYear: '2026-2027',
      status: 'active'
    });

    studentLeg = await Student.create({
      tenantId: null,
      studentCode: 'HS-2026-000099',
      fullName: 'Học Sinh Legacy Mẫu',
      birthDate: new Date('2022-01-01'),
      gender: 'male',
      classroomId: classroomLeg._id,
      className: classroomLeg.name,
      status: 'enrolled'
    });

    // 3. Users Tenant A
    adminA = await User.create({
      tenantId: tenantA._id,
      username: 'admin.a',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'admin',
      status: 'active',
      authVersion: 1,
      profile: { fullName: 'Quản Trị Viên A' }
    });

    principalA = await User.create({
      tenantId: tenantA._id,
      username: 'principal.a',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'principal',
      status: 'active',
      authVersion: 1,
      profile: { fullName: 'Hiệu Trưởng A' }
    });

    accountantA = await User.create({
      tenantId: tenantA._id,
      username: 'accountant.a',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'accountant',
      status: 'active',
      authVersion: 1,
      profile: { fullName: 'Kế Toán Viên A' }
    });

    teacherA = await User.create({
      tenantId: tenantA._id,
      username: 'teacher.a',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'teacher',
      status: 'active',
      authVersion: 1,
      profile: { fullName: 'Giáo Viên A' }
    });

    parentA1 = await User.create({
      tenantId: tenantA._id,
      username: 'parent.a1',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'parent',
      status: 'active',
      authVersion: 1,
      profile: { fullName: 'Phụ Huynh Bé Một' },
      parentInfo: { studentIds: [studentA1._id] }
    });

    parentA2 = await User.create({
      tenantId: tenantA._id,
      username: 'parent.a2',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'parent',
      status: 'active',
      authVersion: 1,
      profile: { fullName: 'Phụ Huynh Bé Hai' },
      parentInfo: { studentIds: [studentA2._id] }
    });

    // 4. Users Tenant B
    adminB = await User.create({
      tenantId: tenantB._id,
      username: 'admin.b',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'admin',
      status: 'active',
      authVersion: 1,
      profile: { fullName: 'Quản Trị Viên B' }
    });

    principalB = await User.create({
      tenantId: tenantB._id,
      username: 'principal.b',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'principal',
      status: 'active',
      authVersion: 1,
      profile: { fullName: 'Hiệu Trưởng B' }
    });

    accountantB = await User.create({
      tenantId: tenantB._id,
      username: 'accountant.b',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'accountant',
      status: 'active',
      authVersion: 1,
      profile: { fullName: 'Kế Toán Viên B' }
    });

    parentB = await User.create({
      tenantId: tenantB._id,
      username: 'parent.b',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'parent',
      status: 'active',
      authVersion: 1,
      profile: { fullName: 'Phụ Huynh Trường B' },
      parentInfo: { studentIds: [studentB1._id] }
    });

    // Generate JWT tokens
    tokenAdminA = generateSchoolUserToken(adminA, tenantA);
    tokenPrincipalA = generateSchoolUserToken(principalA, tenantA);
    tokenAccountantA = generateSchoolUserToken(accountantA, tenantA);
    tokenTeacherA = generateSchoolUserToken(teacherA, tenantA);
    tokenParentA1 = generateSchoolUserToken(parentA1, tenantA);
    tokenParentA2 = generateSchoolUserToken(parentA2, tenantA);

    tokenAdminB = generateSchoolUserToken(adminB, tenantB);
    tokenPrincipalB = generateSchoolUserToken(principalB, tenantB);
    tokenAccountantB = generateSchoolUserToken(accountantB, tenantB);
    tokenParentB = generateSchoolUserToken(parentB, tenantB);
  });

  afterAll(async () => {
    if (bootstrapInstance) {
      await bootstrapInstance.stop();
    }
  });

  // =========================================================================
  // NHÓM A: MODE GATING, PREFIXES & ROUTE ALIASING
  // =========================================================================
  describe('Nhóm A: Mode Gating, Prefixes & Route Aliasing', () => {
    it('A.1: phase1e mở đúng các endpoint tài chính được duyệt tại cả hai alias /api/v1 và /api', async () => {
      // 1. Alias /api/v1/finance/classrooms
      const resV1 = await request(app1e)
        .get('/api/v1/finance/classrooms')
        .set('Authorization', `Bearer ${tokenAccountantA}`);
      expect(resV1.status).toBe(200);
      expect(resV1.body.success).toBe(true);
      expect(Array.isArray(resV1.body.data)).toBe(true);

      // 2. Alias /api/finance/classrooms
      const resAlias = await request(app1e)
        .get('/api/finance/classrooms')
        .set('Authorization', `Bearer ${tokenAccountantA}`);
      expect(resAlias.status).toBe(200);
      expect(resAlias.body.success).toBe(true);

      // 3. Alias /api/v1/reports/accounting-summary và /api/reports/accounting-summary
      const resRepV1 = await request(app1e)
        .get('/api/v1/reports/accounting-summary?month=2026-11')
        .set('Authorization', `Bearer ${tokenAccountantA}`);
      expect(resRepV1.status).toBe(200);
      expect(resRepV1.body.success).toBe(true);

      const resRepAlias = await request(app1e)
        .get('/api/reports/accounting-summary?month=2026-11')
        .set('Authorization', `Bearer ${tokenAccountantA}`);
      expect(resRepAlias.status).toBe(200);
      expect(resRepAlias.body.success).toBe(true);
    });

    it('A.2: phase1d giữ đóng toàn bộ các route tài chính với HTTP 501 Fail-Closed', async () => {
      const endpoints = [
        '/finance/classrooms',
        '/finance/fee-schedules',
        '/finance/invoices',
        '/finance/debts',
        '/finance/cashbook',
        '/finance/expenses',
        '/finance/operating-expenses',
        '/finance/refund-requests',
        '/reports/accounting-summary'
      ];

      for (const endpoint of endpoints) {
        for (const prefix of ['/api/v1', '/api']) {
          const res = await request(app1d)
            .get(`${prefix}${endpoint}`)
            .set('Authorization', `Bearer ${tokenAccountantA}`);
          expect(res.status).toBe(501);
          expect(res.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
        }
      }
    });

    it('A.3: Unknown mode fail-closed với HTTP 501', async () => {
      const res = await request(appUnknown)
        .get('/api/v1/finance/classrooms')
        .set('Authorization', `Bearer ${tokenAccountantA}`);
      expect(res.status).toBe(501);
      expect(res.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
    });

    it('A.4: Unapproved submodule /finance/export/payroll trên phase1e tiếp tục bị chặn HTTP 501', async () => {
      for (const prefix of ['/api/v1', '/api']) {
        const res = await request(app1e)
          .get(`${prefix}/finance/export/payroll`)
          .set('Authorization', `Bearer ${tokenAccountantA}`);
        expect(res.status).toBe(501);
        expect(res.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
      }
    });

    it('A.5: Toàn bộ router /procurement/* hoạt động theo hợp đồng khi đã được mở trên phase1e', async () => {
      const res = await request(app1e)
        .get('/api/v1/procurement/orders')
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect([200, 403]).toContain(res.status);
    });

    it('A.6: Các route báo cáo hoạt động đúng hợp đồng phân hệ trên phase1e', async () => {
      // 1. Các route báo cáo đã mở trên phase1e
      const approvedReportRoutes = [
        '/reports/dashboard',
        '/reports/principal-work',
        '/reports/class-quality',
        '/reports/finance?period=11-2026'
      ];

      for (const r of approvedReportRoutes) {
        const res = await request(app1e)
          .get(`/api/v1${r}`)
          .set('Authorization', `Bearer ${tokenAdminA}`);
        expect([200, 403]).toContain(res.status);
      }

      // 2. Route báo cáo lạ chưa phê duyệt trong phase1e tiếp tục fail-closed 501
      const resUnapproved = await request(app1e)
        .get('/api/v1/reports/unapproved-custom-report')
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resUnapproved.status).toBe(501);
      expect(resUnapproved.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
    });

    it('A.7: Các route Phase 1B/1C/1D tiếp tục hoạt động trơn tru trong mode phase1e', async () => {
      // 1B: Classrooms GET
      const resClassrooms = await request(app1e)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${tokenTeacherA}`);
      expect(resClassrooms.status).toBe(200);

      // 1C: Attendance GET
      const resAttendance = await request(app1e)
        .get('/api/v1/attendance/class/' + classroomA1._id)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resAttendance.status).toBe(200);

      // 1D: HR Departments GET
      const resDepts = await request(app1e)
        .get('/api/v1/hr/departments')
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resDepts.status).toBe(200);

      // 1D: Timekeeping daily
      const resTk = await request(app1e)
        .get('/api/v1/timekeeping/daily?date=' + getWorkDate())
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resTk.status).toBe(200);
    });

    it('A.8: Unknown path hoặc method không được duyệt trong /finance fall-through về HTTP 501 Fail-Closed', async () => {
      // 1. Unknown GET subpath
      const resUnknownPath = await request(app1e)
        .get('/api/v1/finance/unknown-subroute-123')
        .set('Authorization', `Bearer ${tokenAccountantA}`);
      expect(resUnknownPath.status).toBe(501);
      expect(resUnknownPath.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');

      // 2. Unapproved method (DELETE /api/v1/finance/invoices)
      const resUnapprovedMethod = await request(app1e)
        .delete('/api/v1/finance/invoices')
        .set('Authorization', `Bearer ${tokenAccountantA}`);
      expect(resUnapprovedMethod.status).toBe(501);
      expect(resUnapprovedMethod.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');

      // 3. Unapproved method trên alias (/api/finance/debts với PUT)
      const resAliasMethod = await request(app1e)
        .put('/api/finance/debts')
        .set('Authorization', `Bearer ${tokenAccountantA}`);
      expect(resAliasMethod.status).toBe(501);
      expect(resAliasMethod.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
    });

    it('A.9: Route đại diện hoạt động đồng nhất trên cả hai alias /api/v1 và /api', async () => {
      const resV1 = await request(app1e)
        .get('/api/v1/finance/invoices')
        .set('Authorization', `Bearer ${tokenAccountantA}`);
      expect(resV1.status).toBe(200);

      const resAlias = await request(app1e)
        .get('/api/finance/invoices')
        .set('Authorization', `Bearer ${tokenAccountantA}`);
      expect(resAlias.status).toBe(200);
      expect(resAlias.body.data.length).toBe(resV1.body.data.length);
    });
  });

  // =========================================================================
  // NHÓM B: AUTHENTICATION, RBAC & TENANT BOUNDARY
  // =========================================================================
  describe('Nhóm B: Authentication, RBAC & Tenant Boundary', () => {
    it('B.1: Request không có token -> HTTP 401', async () => {
      const res = await request(app1e).get('/api/v1/finance/invoices');
      expect(res.status).toBe(401);
      expect(res.body.message).toContain('access token');
    });

    it('B.2: Token sai hoặc hết hạn -> HTTP 401 TOKEN_INVALID', async () => {
      const res = await request(app1e)
        .get('/api/v1/finance/invoices')
        .set('Authorization', 'Bearer invalid-token-sample');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('TOKEN_INVALID');
    });

    it('B.3: Tài khoản inactive -> HTTP 401 USER_INACTIVE', async () => {
      const inactiveUser = await User.create({
        tenantId: tenantA._id,
        username: 'inactive.accountant',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
        role: 'accountant',
        status: 'inactive',
        authVersion: 1,
        profile: { fullName: 'Kế toán không kích hoạt' }
      });
      const inactiveToken = generateSchoolUserToken(inactiveUser, tenantA);

      const res = await request(app1e)
        .get('/api/v1/finance/invoices')
        .set('Authorization', `Bearer ${inactiveToken}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('USER_INACTIVE');
    });

    it('B.4: Trường bị suspended -> HTTP 403 TENANT_SUSPENDED', async () => {
      const suspendedTenant = await Tenant.create({
        code: 'MN-SUSPENDED',
        name: 'Trường Tạm Khóa',
        status: 'suspended',
        authVersion: 1
      });
      const suspendedUser = await User.create({
        tenantId: suspendedTenant._id,
        username: 'suspended.user',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
        role: 'admin',
        status: 'active',
        authVersion: 1,
        profile: { fullName: 'Quản trị viên Trường Khóa' }
      });
      const suspendedToken = generateSchoolUserToken(suspendedUser, suspendedTenant);

      const res = await request(app1e)
        .get('/api/v1/finance/invoices')
        .set('Authorization', `Bearer ${suspendedToken}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TENANT_SUSPENDED');
    });

    it('B.5: RBAC Role Checks: Giáo viên bị từ chối 403 khi thao tác tài chính', async () => {
      // 1. Tạo hóa đơn
      const resCreateInvoice = await request(app1e)
        .post('/api/v1/finance/tuition')
        .set('Authorization', `Bearer ${tokenTeacherA}`)
        .send({ studentId: studentA1._id, period: '11-2026', totalAmount: 1000000 });
      expect(resCreateInvoice.status).toBe(403);

      // 2. Thu tiền
      const resPay = await request(app1e)
        .post('/api/v1/finance/payment')
        .set('Authorization', `Bearer ${tokenTeacherA}`)
        .send({ invoiceId: new mongoose.Types.ObjectId(), amount: 500000, method: 'cash' });
      expect(resPay.status).toBe(403);

      // 3. Phê duyệt đề nghị chi
      const resReview = await request(app1e)
        .patch('/api/v1/finance/operating-expense-requests/' + new mongoose.Types.ObjectId() + '/review')
        .set('Authorization', `Bearer ${tokenTeacherA}`)
        .send({ status: 'approved' });
      expect(resReview.status).toBe(403);
    });

    it('B.6: Chặn người lập tự phê duyệt (Self-Review Protection HTTP 403)', async () => {
      // Tạo đề nghị chi bởi accountantA
      const opReq = await OperatingExpenseRequest.create({
        tenantId: tenantA._id,
        category: 'maintenance',
        payee: 'Công ty Điện Lạnh A',
        description: 'Sửa điều hòa phòng học',
        amount: 800000,
        requestKey: 'REQ-SELF-REV-1',
        requestedBy: accountantA._id,
        requestedByName: accountantA.profile.fullName,
        status: 'pending'
      });

      // Kế toán A không có role duyệt (chỉ admin/principal được duyệt) -> nhận 403 từ roleCheck
      const resReviewAccountant = await request(app1e)
        .patch(`/api/v1/finance/operating-expense-requests/${opReq._id}/review`)
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .send({ decision: 'approved' });
      expect(resReviewAccountant.status).toBe(403);

      // Nếu người lập là Hiệu trưởng (principalA)
      const opReqByPrincipal = await OperatingExpenseRequest.create({
        tenantId: tenantA._id,
        category: 'services',
        payee: 'Công ty Vệ Sinh A',
        description: 'Dịch vụ diệt khuẩn',
        amount: 1200000,
        requestKey: 'REQ-SELF-REV-2',
        requestedBy: principalA._id,
        requestedByName: principalA.profile.fullName,
        status: 'pending'
      });

      // Hiệu trưởng cố tự duyệt đề nghị do chính mình lập -> Bị chặn 403 bởi business validation
      const resSelfReviewPrincipal = await request(app1e)
        .patch(`/api/v1/finance/operating-expense-requests/${opReqByPrincipal._id}/review`)
        .set('Authorization', `Bearer ${tokenPrincipalA}`)
        .send({ decision: 'approved' });
      expect(resSelfReviewPrincipal.status).toBe(403);
      expect(resSelfReviewPrincipal.body.message).toContain('Người lập không được tự duyệt');
    });

    it('B.7: Cách ly chéo tenant (Cross-tenant boundary): Tenant A không thể truy cập tài chính của Tenant B', async () => {
      // Tạo hóa đơn thuộc Tenant B
      const invoiceB = await TuitionFee.create({
        tenantId: tenantB._id,
        studentId: studentB1._id,
        studentName: studentB1.fullName,
        studentCode: studentB1.studentCode,
        classroomId: classroomB1._id,
        className: classroomB1.name,
        period: '11-2026',
        tuitionBase: 2000000,
        mealFee: 500000,
        totalAmount: 2500000,
        paidAmount: 0,
        dueDate: new Date('2026-11-20'),
        status: 'unpaid'
      });

      // Kế toán Tenant A cố tình truy vấn hóa đơn Tenant B -> HTTP 404
      const resInvoiceCross = await request(app1e)
        .get(`/api/v1/finance/tuition/${invoiceB._id}/adjustments`)
        .set('Authorization', `Bearer ${tokenAccountantA}`);
      expect(resInvoiceCross.status).toBe(404);

      // Kế toán Tenant A cố thu tiền cho hóa đơn Tenant B -> HTTP 404
      const resPayCross = await request(app1e)
        .post('/api/v1/finance/payment')
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .send({ invoiceId: invoiceB._id, amount: 1000000, method: 'cash' })
        .set('Idempotency-Key', 'PAY-CROSS-TENANT-1');
      expect(resPayCross.status).toBe(404);
    });

    it('B.8: Quyền Phụ huynh (Parent Scoping): Chỉ xem đúng con mình, không xem con người khác, không mở refund-requests', async () => {
      const invoiceA1 = await TuitionFee.create({
        tenantId: tenantA._id,
        studentId: studentA1._id,
        studentName: studentA1.fullName,
        studentCode: studentA1.studentCode,
        classroomId: classroomA1._id,
        className: classroomA1.name,
        period: '11-2026',
        tuitionBase: 1500000,
        mealFee: 300000,
        totalAmount: 1800000,
        paidAmount: 0,
        dueDate: new Date('2026-11-20'),
        status: 'unpaid'
      });

      // 1. Phụ huynh A1 xem học phí của con mình (studentA1) -> HTTP 200
      const resParentOwn = await request(app1e)
        .get(`/api/v1/finance/tuition/student/${studentA1._id}`)
        .set('Authorization', `Bearer ${tokenParentA1}`);
      expect(resParentOwn.status).toBe(200);
      expect(resParentOwn.body.data).toHaveLength(1);

      // 2. Phụ huynh A1 cố xem học phí của con khác (studentA2) -> HTTP 403
      const resParentForeign = await request(app1e)
        .get(`/api/v1/finance/tuition/student/${studentA2._id}`)
        .set('Authorization', `Bearer ${tokenParentA1}`);
      expect(resParentForeign.status).toBe(403);
      expect(resParentForeign.body.message).toContain('không có quyền xem');

      // 3. Phụ huynh cố gọi /refund-requests -> Bị chặn 403 bởi roleCheck
      const resRefundParent = await request(app1e)
        .get('/api/v1/finance/refund-requests')
        .set('Authorization', `Bearer ${tokenParentA1}`);
      expect(resRefundParent.status).toBe(403);
    });
  });

  // =========================================================================
  // NHÓM C: CÁC LUỒNG NGHIỆP VỤ ĐẠI DIỆN QUA ROUTER THỰC TẾ
  // =========================================================================
  describe('Nhóm C: Các luồng nghiệp vụ đại diện qua router thực tế', () => {
    const currentMonth = getWorkDate().slice(0, 7);

    beforeEach(async () => {
      // Đảm bảo kỳ kế toán mở cho tháng hiện tại
      await AccountingPeriod.findOneAndUpdate(
        { tenantId: tenantA._id, month: currentMonth },
        { $setOnInsert: { tenantId: tenantA._id, month: currentMonth, status: 'open', revision: 0, writeVersion: 1 } },
        { upsert: true }
      );
    });

    it('C.1: Luồng Thu: Tạo biểu phí -> Sinh hóa đơn -> Thu tiền -> Xem biên lai', async () => {
      // 1. Kế toán tạo biểu phí (FeeSchedule) cho Lớp Mầm 1A
      const resSchedule = await request(app1e)
        .put('/api/v1/finance/fee-schedules')
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .send({
          period: '12-2026',
          classroomId: classroomA1._id,
          tuitionBase: 2000000,
          mealFee: 400000,
          dueDate: '2026-12-15'
        });
      expect(resSchedule.status).toBe(200);
      expect(resSchedule.body.success).toBe(true);

      // 2. Kế toán sinh hóa đơn (TuitionFee) cho học sinh A1
      const resInvoice = await request(app1e)
        .post('/api/v1/finance/tuition')
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .send({
          studentId: studentA1._id,
          period: '12-2026',
          tuitionBase: 2000000,
          mealFee: 400000,
          dueDate: '2026-12-15'
        });
      expect(resInvoice.status).toBe(201);
      const createdInvoice = resInvoice.body.data;
      expect(createdInvoice.totalAmount).toBe(2400000);
      expect(createdInvoice.paidAmount).toBe(0);

      // 3. Kế toán thu tiền học phí
      const resPayment = await request(app1e)
        .post('/api/v1/finance/payment')
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .set('Idempotency-Key', 'PAY-FLOW-C1-001')
        .send({
          invoiceId: createdInvoice._id,
          amount: 2400000,
          method: 'cash',
          note: 'Thu tiền đầy đủ kỳ 12'
        });
      expect(resPayment.status).toBe(201);
      const createdPayment = resPayment.body.data.payment;
      expect(createdPayment.amount).toBe(2400000);

      // Xác nhận DB: Hóa đơn đã thành status 'paid'
      const invoiceInDb = await TuitionFee.findById(createdInvoice._id);
      expect(invoiceInDb.paidAmount).toBe(2400000);
      expect(invoiceInDb.status).toBe('paid');

      // 4. Phụ huynh xem biên lai của con mình qua router
      const resReceipt = await request(app1e)
        .get(`/api/v1/finance/receipt/${createdPayment._id}`)
        .set('Authorization', `Bearer ${tokenParentA1}`);
      expect(resReceipt.status).toBe(200);
      expect(resReceipt.body.data.amount).toBe(2400000);
      expect(resReceipt.body.data.invoiceId.toString()).toBe(createdInvoice._id.toString());
    });

    it('C.2: Luồng Hoàn phí: Đề nghị hoàn -> Hiệu trưởng duyệt -> Kế toán chi trả', async () => {
      // Tạo hóa đơn đã đóng tiền sẵn
      const invoicePaid = await TuitionFee.create({
        tenantId: tenantA._id,
        studentId: studentA2._id,
        studentName: studentA2.fullName,
        studentCode: studentA2.studentCode,
        classroomId: classroomA2._id,
        className: classroomA2.name,
        period: '12-2026',
        tuitionBase: 2000000,
        mealFee: 500000,
        totalAmount: 2500000,
        paidAmount: 2500000,
        dueDate: new Date('2026-12-10'),
        status: 'paid'
      });

      // 1. Kế toán lập đề nghị hoàn phí 500.000 VNĐ
      const resCreateRefund = await request(app1e)
        .post('/api/v1/finance/refund-requests')
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .send({
          invoiceId: invoicePaid._id,
          amount: 500000,
          reason: 'Hoàn tiền ăn do nghỉ ốm'
        });
      expect(resCreateRefund.status).toBe(201);
      const refundDoc = resCreateRefund.body.data;
      expect(refundDoc.status).toBe('pending');

      // 2. Hiệu trưởng phê duyệt đề nghị hoàn
      const resReviewRefund = await request(app1e)
        .patch(`/api/v1/finance/refund-requests/${refundDoc._id}/review`)
        .set('Authorization', `Bearer ${tokenPrincipalA}`)
        .send({
          decision: 'approved',
          reviewNote: 'Đồng ý hoàn trả theo đơn xin nghỉ của phụ huynh'
        });
      expect(resReviewRefund.status).toBe(200);
      expect(resReviewRefund.body.data.status).toBe('approved');

      // 3. Kế toán chi trả hoàn phí
      const today = getWorkDate();
      const resPayRefund = await request(app1e)
        .post(`/api/v1/finance/refund-requests/${refundDoc._id}/pay`)
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .set('Idempotency-Key', 'KEY-PAY-REFUND-C2')
        .send({
          paidDate: today,
          method: 'cash',
          documentNumber: 'PC-REF-C2-001'
        });
      expect(resPayRefund.status).toBe(200);
      expect(resPayRefund.body.data.request.status).toBe('paid');

      // Kiểm tra DB: paidAmount của hóa đơn giảm từ 2.500.000 xuống 2.000.000
      const invoiceAfter = await TuitionFee.findById(invoicePaid._id);
      expect(invoiceAfter.paidAmount).toBe(2000000);

      // Kiểm tra InvoiceAdjustment được tạo đúng
      const adj = await InvoiceAdjustment.findOne({ invoiceId: invoicePaid._id, type: 'refund' });
      expect(adj).toBeDefined();
      expect(adj.amount).toBe(500000);
      expect(adj.tenantId.toString()).toBe(tenantA._id.toString());
    });

    it('C.3: Luồng Chi vận hành: Đề nghị chi -> Hiệu trưởng duyệt -> Kế toán ghi chi', async () => {
      // 1. Kế toán lập đề nghị chi vận hành
      const resCreateOp = await request(app1e)
        .post('/api/v1/finance/operating-expense-requests')
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .set('Idempotency-Key', 'REQ-WATER-NOV-26')
        .send({
          category: 'utilities',
          payee: 'Công ty Cấp Nước Thành Phố',
          description: 'Tiền nước sinh hoạt tháng 11',
          amount: 650000
        });
      expect(resCreateOp.status).toBe(201);
      const opReq = resCreateOp.body.data;
      expect(opReq.status).toBe('pending');

      // 2. Hiệu trưởng duyệt đề nghị chi
      const resReviewOp = await request(app1e)
        .patch(`/api/v1/finance/operating-expense-requests/${opReq._id}/review`)
        .set('Authorization', `Bearer ${tokenPrincipalA}`)
        .send({ decision: 'approved' });
      expect(resReviewOp.status).toBe(200);

      // 3. Kế toán ghi nhận chi vận hành
      const today = getWorkDate();
      const resRecordOp = await request(app1e)
        .post('/api/v1/finance/operating-expenses')
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .set('Idempotency-Key', 'KEY-OP-EXP-C3')
        .send({
          requestId: opReq._id,
          paidAt: today,
          method: 'cash',
          documentNumber: 'PC-WATER-001'
        });
      expect(resRecordOp.status).toBe(201);
      expect(resRecordOp.body.data.amount).toBe(650000);

      // DB check
      const opExpInDb = await OperatingExpense.findById(resRecordOp.body.data._id);
      expect(opExpInDb.tenantId.toString()).toBe(tenantA._id.toString());
    });

    it('C.4: Luồng Chi mua sắm: Xem đơn hàng cần thanh toán -> Ghi chi mua sắm', async () => {
      // Tạo đơn hàng mua sắm trạng thái 'delivered' thuộc Tenant A
      const orderA = await PurchaseOrder.create({
        tenantId: tenantA._id,
        orderCode: 'PO-FLOW-C4',
        requestId: new mongoose.Types.ObjectId(),
        supplierName: 'Nhà Sách Giáo Dục',
        items: [{ itemName: 'Sách Tập Tô', quantity: 50, unitPrice: 20000, totalPrice: 1000000 }],
        totalAmount: 1000000,
        paidAmount: 0,
        status: 'delivered',
        createdBy: accountantA._id
      });

      // 1. Kế toán lấy danh sách đơn hàng cần chi
      const resExpenseOrders = await request(app1e)
        .get('/api/v1/finance/expense-orders')
        .set('Authorization', `Bearer ${tokenAccountantA}`);
      expect(resExpenseOrders.status).toBe(200);
      const orders = resExpenseOrders.body.data;
      expect(orders.some((o) => o._id.toString() === orderA._id.toString())).toBe(true);

      // 2. Kế toán ghi chi mua sắm 1.000.000 VNĐ
      const today = getWorkDate();
      const resRecordPurchase = await request(app1e)
        .post('/api/v1/finance/expenses')
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .set('Idempotency-Key', 'KEY-PURCHASE-C4')
        .send({
          orderId: orderA._id,
          amount: 1000000,
          paidAt: today,
          method: 'cash',
          documentNumber: 'PC-PO-C4-001'
        });
      expect(resRecordPurchase.status).toBe(201);

      // DB check: order.paidAmount được cập nhật lên 1.000.000
      const orderAfter = await PurchaseOrder.findById(orderA._id);
      expect(orderAfter.paidAmount).toBe(1000000);
    });

    it('C.5: Sổ quỹ & Báo cáo kế toán: Đọc số liệu chính xác theo tenant', async () => {
      // 1. Xem sổ quỹ qua route /finance/cashbook
      const resCashbook = await request(app1e)
        .get('/api/v1/finance/cashbook')
        .set('Authorization', `Bearer ${tokenAccountantA}`);
      expect(resCashbook.status).toBe(200);
      expect(resCashbook.body.overall).toBeDefined();

      // 2. Xem báo cáo kế toán tổng hợp qua route /reports/accounting-summary
      const resAccountingReport = await request(app1e)
        .get(`/api/v1/reports/accounting-summary?month=${currentMonth}`)
        .set('Authorization', `Bearer ${tokenPrincipalA}`);
      expect(resAccountingReport.status).toBe(200);
      expect(resAccountingReport.body.data.month).toBe(currentMonth);
      expect(resAccountingReport.body.data.cashFlow).toBeDefined();
    });

    it('C.6: Đối soát sổ quỹ & Chốt/Mở lại kỳ kế toán qua router thực tế', async () => {
      const today = getWorkDate();
      // 1. Lưu đối soát sổ quỹ hàng ngày
      const resRecon = await request(app1e)
        .put('/api/v1/finance/cashbook/reconciliation')
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .send({
          workDate: today,
          actual: { cashIn: 5000000, cashOut: 2000000, bankIn: 0, bankOut: 0, walletIn: 0, walletOut: 0 },
          expectedRevision: 0,
          evidenceReference: 'REF-RECON-C6'
        });
      expect(resRecon.status).toBe(200);
      expect(resRecon.body.data.revision).toBe(1);

      // 2. Chốt kỳ kế toán tháng trước (2026-10)
      const pastMonth = '2026-10';
      await AccountingPeriod.findOneAndUpdate(
        { tenantId: tenantA._id, month: pastMonth },
        { $setOnInsert: { tenantId: tenantA._id, month: pastMonth, status: 'open', revision: 0, writeVersion: 1 } },
        { upsert: true }
      );

      const resClose = await request(app1e)
        .post(`/api/v1/finance/accounting-period/${pastMonth}/close`)
        .set('Authorization', `Bearer ${tokenPrincipalA}`)
        .send({ reason: 'Chốt sổ kế toán tháng 10 năm 2026' });
      expect(resClose.status).toBe(200);
      expect(resClose.body.data.status).toBe('closed');

      // 3. Mở lại kỳ kế toán tháng 10
      const resReopen = await request(app1e)
        .post(`/api/v1/finance/accounting-period/${pastMonth}/reopen`)
        .set('Authorization', `Bearer ${tokenPrincipalA}`)
        .send({ reason: 'Mở lại kỳ để kế toán bổ sung chứng từ chi' });
      expect(resReopen.status).toBe(200);
      expect(resReopen.body.data.status).toBe('open');
    });
  });

  // =========================================================================
  // NHÓM D: EXCEL TEMPLATE, PREVIEW, CONFIRM & EXPORT SCOPING
  // =========================================================================
  describe('Nhóm D: Excel Template, Preview, Confirm & Export Scoping', () => {
    it('D.1: Tải template biểu phí qua HTTP binary: Chỉ chứa danh sách lớp của Tenant A, kiểm tra toàn bộ sheet bằng ExcelJS', async () => {
      // 1. Gọi route /api/v1/finance/import/fee-schedules/template qua supertest binary parser
      const resV1 = await fetchExcelBinary(
        request(app1e)
          .get('/api/v1/finance/import/fee-schedules/template')
          .set('Authorization', `Bearer ${tokenAccountantA}`)
      );
      expect(resV1.status).toBe(200);
      expect(resV1.headers['content-type']).toContain('spreadsheetml');
      expect(resV1.headers['content-disposition']).toContain('MauNhap_MucThuHocPhi.xlsx');

      const wbA = new ExcelJS.Workbook();
      await wbA.xlsx.load(resV1.body);

      // Sheet 1: Mức thu
      const sheetMucThu = wbA.getWorksheet('Mức thu');
      expect(sheetMucThu).toBeDefined();

      // Kiểm tra dataValidation của ô A2
      const cellValidationA2 = sheetMucThu.getCell('A2').dataValidation;
      expect(cellValidationA2).toBeDefined();
      expect(cellValidationA2.formulae[0]).toContain(classroomA1.name);
      expect(cellValidationA2.formulae[0]).toContain(classroomA2.name);
      expect(cellValidationA2.formulae[0]).not.toContain(classroomB1.name);
      expect(cellValidationA2.formulae[0]).not.toContain(classroomLeg.name);

      // Sheet 3: Danh mục lớp
      const sheetDanhMucLop = wbA.getWorksheet('Danh mục lớp');
      expect(sheetDanhMucLop).toBeDefined();
      const classNamesInSheet = [];
      sheetDanhMucLop.eachRow((row, rowNumber) => {
        if (rowNumber > 2) {
          classNamesInSheet.push(row.getCell(1).value);
        }
      });
      expect(classNamesInSheet).toContain(classroomA1.name);
      expect(classNamesInSheet).toContain(classroomA2.name);
      expect(classNamesInSheet).not.toContain(classroomB1.name);
      expect(classNamesInSheet).not.toContain(classroomLeg.name);

      // 2. Alias /api/finance/import/fee-schedules/template cũng hoạt động đồng nhất
      const resAlias = await fetchExcelBinary(
        request(app1e)
          .get('/api/finance/import/fee-schedules/template')
          .set('Authorization', `Bearer ${tokenAccountantA}`)
      );
      expect(resAlias.status).toBe(200);
      const wbAlias = new ExcelJS.Workbook();
      await wbAlias.xlsx.load(resAlias.body);
      expect(wbAlias.getWorksheet('Danh mục lớp')).toBeDefined();
    });

    it('D.2: Tải template hóa đơn qua HTTP binary: Chỉ chứa học sinh của Tenant A, kiểm tra toàn bộ sheet bằng ExcelJS', async () => {
      const res = await fetchExcelBinary(
        request(app1e)
          .get('/api/v1/finance/import/invoices/template')
          .set('Authorization', `Bearer ${tokenAccountantA}`)
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('MauNhap_HoaDonHocPhi.xlsx');

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body);

      // Sheet 1: Hóa đơn học phí
      const sheetHoaDon = wb.getWorksheet('Hóa đơn học phí');
      expect(sheetHoaDon).toBeDefined();

      // Sheet 3: Danh mục học sinh mẫu
      const sheetHocSinh = wb.getWorksheet('Danh mục học sinh mẫu');
      expect(sheetHocSinh).toBeDefined();

      const studentCodes = [];
      const studentNames = [];
      sheetHocSinh.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
          studentCodes.push(row.getCell(1).value);
          studentNames.push(row.getCell(2).value);
        }
      });

      // Phải có học sinh của Tenant A
      expect(studentCodes).toContain(studentA1.studentCode);
      expect(studentCodes).toContain(studentA2.studentCode);
      expect(studentNames).toContain(studentA1.fullName);
      expect(studentNames).toContain(studentA2.fullName);

      // Tuyệt đối không chứa học sinh của Tenant B hay Legacy
      expect(studentCodes).not.toContain(studentB1.studentCode);
      expect(studentCodes).not.toContain(studentLeg.studentCode);
      expect(studentNames).not.toContain(studentB1.fullName);
      expect(studentNames).not.toContain(studentLeg.fullName);
    });

    it('D.3: Export các sổ chi và thanh toán: Kiểm tra nội dung, số tiền thực tế và cách ly qua ExcelJS', async () => {
      // 1. Export sổ thu tiền / biên lai (/finance/export/payments)
      const resPayments = await fetchExcelBinary(
        request(app1e)
          .get('/api/v1/finance/export/payments')
          .set('Authorization', `Bearer ${tokenAccountantA}`)
      );
      expect(resPayments.status).toBe(200);
      expect(resPayments.headers['content-type']).toContain('spreadsheetml');

      const wbPayments = new ExcelJS.Workbook();
      await wbPayments.xlsx.load(resPayments.body);
      const sheetPayments = wbPayments.getWorksheet('Biên lai thu tiền');
      expect(sheetPayments).toBeDefined();

      // Dòng 5 là tiêu đề cột
      const headerRow = sheetPayments.getRow(5);
      expect(headerRow.getCell(2).value).toBe('Số biên lai (Phiếu thu)');
      expect(headerRow.getCell(4).value).toBe('Số tiền thu (VNĐ)');

      // Dòng 6 là thanh toán tạo từ luồng C.1 (số tiền 2.400.000 VNĐ)
      const row1 = sheetPayments.getRow(6);
      expect(row1.getCell(4).value).toBe(2400000);
      expect(row1.getCell(5).value).toBe('Tiền mặt');

      // 2. Kiểm tra các route export còn lại trong allowlist đều trả về file Excel hợp lệ
      const otherExportRoutes = [
        '/finance/export/fee-schedules',
        '/finance/export/invoices',
        '/finance/export/debts',
        '/finance/export/expenses',
        '/finance/export/operating-expenses',
        '/finance/export/cashbook',
        '/finance/export/accounting-report'
      ];

      for (const r of otherExportRoutes) {
        const res = await request(app1e)
          .get(`/api/v1${r}`)
          .set('Authorization', `Bearer ${tokenAccountantA}`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('spreadsheetml');
      }
    });

    it('D.4: Upload qua Middleware Thật: Xử lý lỗi thiếu file, file hỏng, và file vượt quá 5MB có kiểm soát', async () => {
      // 1. Thiếu file -> HTTP 400
      const resNoFile = await request(app1e)
        .post('/api/v1/finance/import/invoices/preview')
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .send({});
      expect(resNoFile.status).toBe(400);
      expect(resNoFile.body.message).toContain('Vui lòng chọn tập tin Excel');

      // 2. File không phải workbook hợp lệ (text file) -> HTTP 400
      const resInvalid = await request(app1e)
        .post('/api/v1/finance/import/invoices/preview')
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .attach('file', Buffer.from('dummy text content'), 'test.txt');
      expect(resInvalid.status).toBe(400);
      expect(resInvalid.body.message).toMatch(/Tập tin Excel không hợp lệ hoặc bị hỏng|Chỉ chấp nhận tập tin định dạng Excel/);

      // 3. File vượt quá 5MB -> HTTP 400 có kiểm soát (Multer LIMIT_FILE_SIZE), không văng HTML 500 hay lộ stack trace
      const bigBuffer = Buffer.alloc(5 * 1024 * 1024 + 2048, 'a');
      const resTooLarge = await request(app1e)
        .post('/api/v1/finance/import/invoices/preview')
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .attach('file', bigBuffer, 'oversized.xlsx');
      expect(resTooLarge.status).toBe(400);
      expect(resTooLarge.body.success).toBe(false);
      expect(resTooLarge.body.message).toContain('Dung lượng file vượt quá giới hạn cho phép (tối đa 5MB).');
    });

    it('D.5: Luồng Import Biểu Phí Thật: Preview multipart -> Confirm -> DB check đúng tenant -> Idempotency Replay', async () => {
      // 1. Tạo file Excel Biểu Phí hợp lệ cho Tenant A bằng ExcelJS
      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet('Mức thu');
      sheet.addRow([
        'Phạm vi áp dụng (*)',
        'Kỳ thu (*)',
        'Học phí chính (*)',
        'Tiền ăn',
        'Tiền xe',
        'Khoản thu khác',
        'Giảm trừ chung',
        'Hạn thanh toán (*)',
        'Tên khoản thu thêm 1',
        'Số tiền khoản 1',
        'Tên khoản thu thêm 2',
        'Số tiền khoản 2',
        'Ghi chú'
      ]);
      sheet.addRow([
        classroomA1.name,
        '01-2027',
        3500000,
        900000,
        600000,
        0,
        0,
        '2027-01-15',
        '',
        '',
        '',
        '',
        'Biểu phí kỳ 01-2027 nhập qua router'
      ]);
      const fileBuffer = await wb.xlsx.writeBuffer();

      // 2. POST preview qua router với multipart .attach('file', ...)
      const resPreview = await request(app1e)
        .post('/api/v1/finance/import/fee-schedules/preview')
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .field('defaultPeriod', '01-2027')
        .attach('file', fileBuffer, 'bph_2027_01.xlsx');

      expect(resPreview.status).toBe(200);
      expect(resPreview.body.success).toBe(true);
      expect(resPreview.body.canImport).toBe(true);
      expect(resPreview.body.validRows).toBe(1);
      expect(resPreview.body.previewToken).toBeDefined();

      const { previewToken, rows } = resPreview.body;

      // 3. POST confirm qua router với token, rows, Idempotency-Key
      const idempotencyKey = 'IDEM-FEE-IMPORT-ROUTER-001';
      const resConfirm = await request(app1e)
        .post('/api/v1/finance/import/fee-schedules/confirm')
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          period: '01-2027',
          rows,
          previewToken
        });

      expect(resConfirm.status).toBe(201);
      expect(resConfirm.body.success).toBe(true);

      // 4. Kiểm tra Database: FeeSchedule được tạo với đúng tenantId
      const feeInDb = await FeeSchedule.findOne({ classroomId: classroomA1._id, period: '01-2027' });
      expect(feeInDb).not.toBeNull();
      expect(feeInDb.tenantId.toString()).toBe(tenantA._id.toString());
      expect(feeInDb.tuitionBase).toBe(3500000);
      expect(feeInDb.mealFee).toBe(900000);

      // Kiểm tra AuditLog được ghi lại
      const audit = await AuditLog.findOne({ targetId: feeInDb._id, action: 'FEE_SCHEDULE_IMPORTED' });
      expect(audit).not.toBeNull();
      expect(audit.actorId.toString()).toBe(accountantA._id.toString());

      // 5. Idempotency Replay: Gửi lại y hệt request confirm -> Nhận HTTP 200, không tạo thêm bản ghi
      const resReplay = await request(app1e)
        .post('/api/v1/finance/import/fee-schedules/confirm')
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          period: '01-2027',
          rows,
          previewToken
        });

      expect(resReplay.status).toBe(200);
      expect(resReplay.body.success).toBe(true);

      const feeCount = await FeeSchedule.countDocuments({ classroomId: classroomA1._id, period: '01-2027' });
      expect(feeCount).toBe(1);
    });

    it('D.6: Luồng Import Hóa Đơn Thật: Preview multipart -> Confirm -> DB check đúng tenant -> Idempotency Replay', async () => {
      // 1. Tạo file Excel Hóa Đơn hợp lệ cho học sinh A2 của Tenant A bằng ExcelJS
      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet('Hóa đơn học phí');
      sheet.addRow([
        'Mã học sinh (*)',
        'Họ và tên',
        'Lớp',
        'Kỳ thu (*)',
        'Học phí chính (*)',
        'Tiền ăn',
        'Tiền xe',
        'Khoản thu khác',
        'Giảm trừ',
        'Hạn thanh toán (*)',
        'Ghi chú'
      ]);
      sheet.addRow([
        studentA2.studentCode,
        studentA2.fullName,
        classroomA2.name,
        '01-2027',
        3000000,
        800000,
        400000,
        0,
        0,
        '2027-01-20',
        'Hóa đơn kỳ 01-2027 nhập qua router'
      ]);
      const fileBuffer = await wb.xlsx.writeBuffer();

      // 2. POST preview qua router với multipart .attach('file', ...)
      const resPreview = await request(app1e)
        .post('/api/v1/finance/import/invoices/preview')
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .field('defaultPeriod', '01-2027')
        .attach('file', fileBuffer, 'hd_2027_01.xlsx');

      expect(resPreview.status).toBe(200);
      expect(resPreview.body.success).toBe(true);
      expect(resPreview.body.canImport).toBe(true);
      expect(resPreview.body.validRows).toBe(1);
      expect(resPreview.body.previewToken).toBeDefined();

      const { previewToken, rows } = resPreview.body;

      // 3. POST confirm qua router
      const idempotencyKey = 'IDEM-INV-IMPORT-ROUTER-001';
      const resConfirm = await request(app1e)
        .post('/api/v1/finance/import/invoices/confirm')
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          period: '01-2027',
          rows,
          previewToken
        });

      expect(resConfirm.status).toBe(201);
      expect(resConfirm.body.success).toBe(true);

      // 4. Kiểm tra Database: TuitionFee được tạo với đúng tenantId và tổng tiền
      const invoiceInDb = await TuitionFee.findOne({ studentId: studentA2._id, period: '01-2027' });
      expect(invoiceInDb).not.toBeNull();
      expect(invoiceInDb.tenantId.toString()).toBe(tenantA._id.toString());
      expect(invoiceInDb.totalAmount).toBe(4200000); // 3,000,000 + 800,000 + 400,000
      expect(invoiceInDb.status).toBe('unpaid');

      // Kiểm tra AuditLog được ghi lại
      const audit = await AuditLog.findOne({ targetId: invoiceInDb._id, action: 'TUITION_INVOICE_IMPORTED' });
      expect(audit).not.toBeNull();
      expect(audit.actorId.toString()).toBe(accountantA._id.toString());

      // 5. Idempotency Replay: Gửi lại y hệt request confirm -> Nhận HTTP 200, không tạo thêm bản ghi
      const resReplay = await request(app1e)
        .post('/api/v1/finance/import/invoices/confirm')
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          period: '01-2027',
          rows,
          previewToken
        });

      expect(resReplay.status).toBe(200);
      expect(resReplay.body.success).toBe(true);

      const invCount = await TuitionFee.countDocuments({ studentId: studentA2._id, period: '01-2027' });
      expect(invCount).toBe(1);
    });

    it('D.7: Bảo mật Import qua Router: Preview token chéo tenant bị 403, file chứa học sinh ngoại lai bị từ chối, actor bị khóa không ghi dở dang', async () => {
      // 1. Token preview của Tenant A dùng bởi Kế toán Tenant B -> HTTP 403
      // Tạo previewToken hợp lệ cho Tenant A
      const wbA = new ExcelJS.Workbook();
      const sheetA = wbA.addWorksheet('Hóa đơn học phí');
      sheetA.addRow(['Mã học sinh (*)', 'Họ và tên', 'Lớp', 'Kỳ thu (*)', 'Học phí chính (*)', 'Tiền ăn', 'Tiền xe', 'Khoản thu khác', 'Giảm trừ', 'Hạn thanh toán (*)', 'Ghi chú']);
      sheetA.addRow([studentA1.studentCode, studentA1.fullName, classroomA1.name, '02-2027', 3000000, 500000, 0, 0, 0, '2027-02-15', '']);
      const bufA = await wbA.xlsx.writeBuffer();

      const resPreviewA = await request(app1e)
        .post('/api/v1/finance/import/invoices/preview')
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .field('defaultPeriod', '02-2027')
        .attach('file', bufA, 'hd_a_022027.xlsx');
      expect(resPreviewA.status).toBe(200);
      expect(resPreviewA.body.previewToken).toBeDefined();

      // Kế toán B cố dùng previewToken của Tenant A để confirm -> HTTP 403
      const resCrossTenant = await request(app1e)
        .post('/api/v1/finance/import/invoices/confirm')
        .set('Authorization', `Bearer ${tokenAccountantB}`)
        .set('Idempotency-Key', 'IDEM-CROSS-ROUTER-B')
        .send({
          period: '02-2027',
          rows: resPreviewA.body.rows,
          previewToken: resPreviewA.body.previewToken
        });
      expect(resCrossTenant.status).toBe(403);
      expect(resCrossTenant.body.message).toMatch(/đơn vị trường học khác|tài khoản người dùng khác/);

      // 2. File chứa học sinh ngoại lai của Tenant B (studentB1) gửi preview bởi Tenant A
      const wbForeign = new ExcelJS.Workbook();
      const sheetForeign = wbForeign.addWorksheet('Hóa đơn học phí');
      sheetForeign.addRow(['Mã học sinh (*)', 'Họ và tên', 'Lớp', 'Kỳ thu (*)', 'Học phí chính (*)', 'Tiền ăn', 'Tiền xe', 'Khoản thu khác', 'Giảm trừ', 'Hạn thanh toán (*)', 'Ghi chú']);
      sheetForeign.addRow([studentB1.studentCode, studentB1.fullName, classroomB1.name, '02-2027', 3000000, 500000, 0, 0, 0, '2027-02-15', '']);
      const bufForeign = await wbForeign.xlsx.writeBuffer();

      const resPreviewForeign = await request(app1e)
        .post('/api/v1/finance/import/invoices/preview')
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .field('defaultPeriod', '02-2027')
        .attach('file', bufForeign, 'hd_foreign.xlsx');
      expect(resPreviewForeign.status).toBe(200);
      expect(resPreviewForeign.body.canImport).toBe(false);
      expect(resPreviewForeign.body.previewToken).toBeNull();
      expect(resPreviewForeign.body.rows[0].errors[0]).toContain(studentB1.studentCode);

      // 3. Giả mạo header x-tenant-id hoặc payload tenantId không thể thay đổi phạm vi ghi của Tenant A
      const resSpoof = await request(app1e)
        .post('/api/v1/finance/import/invoices/confirm')
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .set('x-tenant-id', tenantB._id.toString())
        .set('Idempotency-Key', 'IDEM-SPOOF-TENANT-ROUTER')
        .send({
          tenantId: tenantB._id.toString(),
          period: '02-2027',
          rows: resPreviewA.body.rows,
          previewToken: resPreviewA.body.previewToken
        });
      expect(resSpoof.status).toBe(201); // Nhập thành công vào Tenant A
      // Kiểm tra hóa đơn được tạo thuộc Tenant A, không phải Tenant B
      const insertedSpoofCheck = await TuitionFee.findOne({ studentId: studentA1._id, period: '02-2027' });
      expect(insertedSpoofCheck).not.toBeNull();
      expect(insertedSpoofCheck.tenantId.toString()).toBe(tenantA._id.toString());

      // 4. Actor bị khóa giữa preview và confirm -> bị từ chối 401 hoặc 403, không ghi dở dang
      const tempAccountant = await User.create({
        tenantId: tenantA._id,
        username: 'temp.accountant.a',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
        role: 'accountant',
        status: 'active',
        authVersion: 1,
        profile: { fullName: 'Kế Toán Tạm Thời' }
      });
      const tempToken = generateSchoolUserToken(tempAccountant, tenantA);

      // Tạo preview hợp lệ với tempToken
      const wbTemp = new ExcelJS.Workbook();
      const sheetTemp = wbTemp.addWorksheet('Hóa đơn học phí');
      sheetTemp.addRow(['Mã học sinh (*)', 'Họ và tên', 'Lớp', 'Kỳ thu (*)', 'Học phí chính (*)', 'Tiền ăn', 'Tiền xe', 'Khoản thu khác', 'Giảm trừ', 'Hạn thanh toán (*)', 'Ghi chú']);
      sheetTemp.addRow([studentA1.studentCode, studentA1.fullName, classroomA1.name, '03-2027', 2800000, 500000, 0, 0, 0, '2027-03-15', '']);
      const bufTemp = await wbTemp.xlsx.writeBuffer();

      const resPreviewTemp = await request(app1e)
        .post('/api/v1/finance/import/invoices/preview')
        .set('Authorization', `Bearer ${tempToken}`)
        .field('defaultPeriod', '03-2027')
        .attach('file', bufTemp, 'hd_temp.xlsx');
      expect(resPreviewTemp.status).toBe(200);
      expect(resPreviewTemp.body.previewToken).toBeDefined();

      // Khóa user
      await User.updateOne({ _id: tempAccountant._id }, { status: 'inactive' });

      // Gửi confirm với tài khoản đã bị khóa
      const resConfirmLocked = await request(app1e)
        .post('/api/v1/finance/import/invoices/confirm')
        .set('Authorization', `Bearer ${tempToken}`)
        .set('Idempotency-Key', 'IDEM-LOCKED-ACTOR-ROUTER')
        .send({
          period: '03-2027',
          rows: resPreviewTemp.body.rows,
          previewToken: resPreviewTemp.body.previewToken
        });
      // Auth middleware hoặc transaction check từ chối (401 hoặc 403)
      expect([401, 403]).toContain(resConfirmLocked.status);

      // Đảm bảo không có document nào được tạo dở dang cho kỳ 03-2027
      const noDoc = await TuitionFee.findOne({ studentId: studentA1._id, period: '03-2027' });
      expect(noDoc).toBeNull();
    });
  });

  // =========================================================================
  // NHÓM E: TÍNH NHẤT QUÁN, IDEMPOTENCY REPLAY & GIỚI HẠN INDEX
  // =========================================================================
  describe('Nhóm E: Tính nhất quán, Idempotency Replay & Giới hạn Index', () => {
    it('E.1: Idempotency Replay: Gửi lại cùng key và payload nhận HTTP 200 replayed: true, không tạo doc mới', async () => {
      const invoice = await TuitionFee.create({
        tenantId: tenantA._id,
        studentId: studentA1._id,
        studentName: studentA1.fullName,
        studentCode: studentA1.studentCode,
        classroomId: classroomA1._id,
        className: classroomA1.name,
        period: '12-2026',
        tuitionBase: 1000000,
        totalAmount: 1000000,
        paidAmount: 0,
        dueDate: new Date('2026-12-15'),
        status: 'unpaid'
      });

      const payload = {
        invoiceId: invoice._id,
        amount: 500000,
        method: 'cash',
        note: 'Thu một nửa học phí'
      };

      // Lần 1: Tạo mới thành công (201)
      const res1 = await request(app1e)
        .post('/api/v1/finance/payment')
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .set('Idempotency-Key', 'KEY-REPLAY-E1')
        .send(payload);
      expect(res1.status).toBe(201);
      expect(res1.body.replayed).toBe(false);

      // Lần 2: Gửi lại y hệt cùng key -> Nhận 200, replayed: true
      const res2 = await request(app1e)
        .post('/api/v1/finance/payment')
        .set('Authorization', `Bearer ${tokenAccountantA}`)
        .set('Idempotency-Key', 'KEY-REPLAY-E1')
        .send(payload);
      expect(res2.status).toBe(200);
      expect(res2.body.replayed).toBe(true);

      // Tổng số payment chỉ có 1
      const count = await Payment.countDocuments({ invoiceId: invoice._id });
      expect(count).toBe(1);
    });

    it('E.2: Giới hạn index hiện hành: Tenant B cố mở kỳ cùng tháng với Tenant A nhận HTTP 409 có kiểm soát', async () => {
      const monthConflict = '2026-09';

      // Tenant A mở kỳ 2026-09
      await AccountingPeriod.create({
        tenantId: tenantA._id,
        month: monthConflict,
        status: 'open',
        revision: 1,
        writeVersion: 1,
        snapshot: {},
        sourceHash: 'source-hash-e2'
      });

      // Tenant B gửi request chốt kỳ 2026-09 (bên trong gọi lockOpenPeriod cho tháng đó)
      // Do schema mang unique index month_1 toàn cục, câu lệnh upsert va chạm E11000 và chuyển đổi thành HTTP 409
      const resB = await request(app1e)
        .post(`/api/v1/finance/accounting-period/${monthConflict}/close`)
        .set('Authorization', `Bearer ${tokenPrincipalB}`)
        .send({ reason: 'Trường B cố chốt kỳ trùng tháng Trường A' });

      // Nhận HTTP 409 có kiểm soát, không bị raw 500
      expect(resB.status).toBe(409);
    });
  });
});

