/**
 * Phase 1D.5 Integration & SaaS Gate Verification Test Suite
 *
 * File: backend/tests/saas/phase1d5_integration.test.js
 *
 * Verifies end-to-end integration of Phase 1D:
 * - SaaS Mode Matrix: phase1d opens approved routes; phase1a/1b/1c/unknown/future fail-closed (501).
 * - Aliases: /api/v1 and /api behave identically.
 * - Routing & Gating: Unapproved routes & submodules cleanly return 501 (Feature Gate).
 * - Recruitment retirement: /hr/recruitment returns HTTP 410 Gone.
 * - RBAC & Authentication: Auth, token purpose, user status, tenant status, role checks.
 * - HR & Internal Accounts: CRUD accounts, sync staff, departments, employees, staffing, homeroom teacher assignment.
 * - Timekeeping & Adjustments: Check-in, inquiries, draft -> submit -> approve/reject/cancel state machine.
 * - Recalculation Queue: HTTP recalculate strictly processes tenant/date scoped queue items; leaves foreign & legacy intact.
 * - Phase 1B/1C Regression: Reads, student attendance, transfer remain fully functional in phase1d; Phase 1E remains gated.
 */

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';

jest.setTimeout(90000);

const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const testDbBootstrap = require('../../src/saas/testDbBootstrap');
const createSaasApp = require('../../src/saas/createSaasApp');
const { generateSchoolUserToken, generatePlatformAdminToken } = require('../../src/saas/utils/saasJwt');
const { hashPassword } = require('../../src/utils/passwordHash');
const { DEFAULT_SCHOOL_TIMEZONE, startOfWorkDate } = require('../../src/utils/dateHelpers');

const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const Department = require('../../src/models/zone2_hr/Department');
const Employee = require('../../src/models/zone2_hr/Employee');
const StaffShift = require('../../src/models/zone2_hr/StaffShift');
const LeaveRequest = require('../../src/models/zone2_hr/LeaveRequest');
const Classroom = require('../../src/models/zone3_school/Classroom');
const Student = require('../../src/models/zone3_school/Student');
const StudentAttendance = require('../../src/models/zone3_school/StudentAttendance');
const StudentTransferHistory = require('../../src/models/zone3_school/StudentTransferHistory');
const AttendanceRecord = require('../../src/models/zone2_hr/AttendanceRecord');
const TimekeepingCorrectionRequest = require('../../src/models/zone2_hr/TimekeepingCorrectionRequest');
const AttendanceRecalculationQueue = require('../../src/models/zone2_hr/AttendanceRecalculationQueue');
const AttendanceAuditLog = require('../../src/models/zone2_hr/AttendanceAuditLog');
const RawAttendanceEvent = require('../../src/models/zone2_hr/RawAttendanceEvent');
const OutboxEvent = require('../../src/models/zone1_system/OutboxEvent');

describe('SaaS Phase 1D.5 Integration & Route Gating Test Suite', () => {
  let bootstrapInstance;
  let mongoUri;
  let app1d;
  let hashedPassword;
  let originalEnvSaasMode;

  // Tenant fixtures
  let tenantA;
  let tenantB;
  let tenantC_suspended;

  // Users Tenant A
  let adminA;
  let principalA;
  let hrA;
  let teacherA;
  let teacherA2;
  let guardA;
  let accountantA;
  let chefA;
  let parentA;
  let inactiveUserA;

  // Users Tenant B
  let adminB;
  let teacherB;
  let hrB;

  // Employees Tenant A & B
  let empAdminA;
  let empTeacherA;
  let empTeacherA2;
  let empHrA;
  let empChefA;
  let empGuardA;
  let empTeacherB;

  // Classrooms & Departments
  let deptA;
  let classroomA1;
  let classroomA2;
  let classroomB1;
  let studentA1;

  beforeAll(async () => {
    bootstrapInstance = await testDbBootstrap.startTestDb({
      instanceOpts: [{ dbName: 'school_saas_phase1d5_integration_test' }]
    });
    mongoUri = bootstrapInstance.mongoUri;
    hashedPassword = await hashPassword('Password123@Valid');

    app1d = createSaasApp({
      mongoUri,
      connection: bootstrapInstance.connection,
      saasMode: 'phase1d'
    });
  });

  afterAll(async () => {
    if (bootstrapInstance) {
      await bootstrapInstance.stop();
    }
  });

  afterEach(async () => {
    // Restore environment variables unconditionally after each test
    if (originalEnvSaasMode !== undefined) {
      process.env.SAAS_MODE = originalEnvSaasMode;
    } else {
      delete process.env.SAAS_MODE;
    }
  });

  beforeEach(async () => {
    originalEnvSaasMode = process.env.SAAS_MODE;

    // Clear all test collections
    const collections = [
      Tenant, User, Department, Employee, StaffShift, LeaveRequest,
      Classroom, Student, StudentAttendance, StudentTransferHistory,
      AttendanceRecord, TimekeepingCorrectionRequest, AttendanceRecalculationQueue, AttendanceAuditLog,
      RawAttendanceEvent, OutboxEvent
    ];
    for (const model of collections) {
      await model.deleteMany({});
    }

    // Seed Tenants
    tenantA = await Tenant.create({
      code: 'school-a',
      name: 'Trường Mầm Non A',
      status: 'active',
      authVersion: 1
    });

    tenantB = await Tenant.create({
      code: 'school-b',
      name: 'Trường Mầm Non B',
      status: 'active',
      authVersion: 1
    });

    tenantC_suspended = await Tenant.create({
      code: 'school-c',
      name: 'Trường Mầm Non C (Đình chỉ)',
      status: 'suspended',
      authVersion: 1
    });

    // Seed Users for Tenant A
    adminA = await User.create({
      username: 'admin_a',
      email: 'admin.a@school-a.edu.vn',
      passwordHash: hashedPassword,
      role: 'admin',
      tenantId: tenantA._id,
      status: 'active',
      authVersion: 1,
      assignmentVersion: 0,
      profile: { fullName: 'Quản trị viên Trường A' }
    });

    principalA = await User.create({
      username: 'principal_a',
      email: 'principal.a@school-a.edu.vn',
      passwordHash: hashedPassword,
      role: 'principal',
      tenantId: tenantA._id,
      status: 'active',
      authVersion: 1,
      assignmentVersion: 0,
      profile: { fullName: 'Hiệu trưởng Trường A' }
    });

    hrA = await User.create({
      username: 'hr_a',
      email: 'hr.a@school-a.edu.vn',
      passwordHash: hashedPassword,
      role: 'hr',
      tenantId: tenantA._id,
      status: 'active',
      authVersion: 1,
      assignmentVersion: 0,
      profile: { fullName: 'Nhân sự Trường A' }
    });

    teacherA = await User.create({
      username: 'teacher_a',
      email: 'teacher.a@school-a.edu.vn',
      passwordHash: hashedPassword,
      role: 'teacher',
      tenantId: tenantA._id,
      status: 'active',
      authVersion: 1,
      assignmentVersion: 0,
      profile: { fullName: 'Giáo viên Trường A' }
    });

    teacherA2 = await User.create({
      username: 'teacher_a2',
      email: 'teacher.a2@school-a.edu.vn',
      passwordHash: hashedPassword,
      role: 'teacher',
      tenantId: tenantA._id,
      status: 'active',
      authVersion: 1,
      assignmentVersion: 0,
      profile: { fullName: 'Giáo viên 2 Trường A' }
    });

    guardA = await User.create({
      username: 'guard_a',
      email: 'guard.a@school-a.edu.vn',
      passwordHash: hashedPassword,
      role: 'guard',
      tenantId: tenantA._id,
      status: 'active',
      authVersion: 1,
      profile: { fullName: 'Bảo vệ Trường A' }
    });

    accountantA = await User.create({
      username: 'accountant_a',
      email: 'accountant.a@school-a.edu.vn',
      passwordHash: hashedPassword,
      role: 'accountant',
      tenantId: tenantA._id,
      status: 'active',
      authVersion: 1,
      profile: { fullName: 'Kế toán Trường A' }
    });

    chefA = await User.create({
      username: 'chef_a',
      email: 'chef.a@school-a.edu.vn',
      passwordHash: hashedPassword,
      role: 'chef',
      tenantId: tenantA._id,
      status: 'active',
      authVersion: 1,
      profile: { fullName: 'Bếp trưởng Trường A' }
    });

    parentA = await User.create({
      username: 'parent_a',
      email: 'parent.a@school-a.edu.vn',
      passwordHash: hashedPassword,
      role: 'parent',
      tenantId: tenantA._id,
      status: 'active',
      authVersion: 1,
      profile: { fullName: 'Phụ huynh Trường A' }
    });

    inactiveUserA = await User.create({
      username: 'inactive_a',
      email: 'inactive.a@school-a.edu.vn',
      passwordHash: hashedPassword,
      role: 'teacher',
      tenantId: tenantA._id,
      status: 'inactive',
      authVersion: 1,
      profile: { fullName: 'Giáo viên bị khóa' }
    });

    // Seed Users for Tenant B
    adminB = await User.create({
      username: 'admin_b',
      email: 'admin.b@school-b.edu.vn',
      passwordHash: hashedPassword,
      role: 'admin',
      tenantId: tenantB._id,
      status: 'active',
      authVersion: 1,
      profile: { fullName: 'Quản trị viên Trường B' }
    });

    teacherB = await User.create({
      username: 'teacher_b',
      email: 'teacher.b@school-b.edu.vn',
      passwordHash: hashedPassword,
      role: 'teacher',
      tenantId: tenantB._id,
      status: 'active',
      authVersion: 1,
      profile: { fullName: 'Giáo viên Trường B' }
    });

    hrB = await User.create({
      username: 'hr_b',
      email: 'hr.b@school-b.edu.vn',
      passwordHash: hashedPassword,
      role: 'hr',
      tenantId: tenantB._id,
      status: 'active',
      authVersion: 1,
      profile: { fullName: 'Nhân sự Trường B' }
    });

    // Seed Departments
    deptA = await Department.create({
      tenantId: tenantA._id,
      name: 'Tổ Chuyên Môn Mầm',
      code: 'TCM-MAM',
      status: 'active'
    });

    // Seed Employees for Tenant A
    empAdminA = await Employee.create({
      tenantId: tenantA._id,
      userId: adminA._id,
      employeeCode: 'NV-A-ADM',
      fullName: 'Quản trị viên Trường A',
      status: 'active',
      employmentType: 'full_time',
      hireDate: new Date('2024-01-01')
    });

    empTeacherA = await Employee.create({
      tenantId: tenantA._id,
      userId: teacherA._id,
      employeeCode: 'NV-A-TC1',
      fullName: 'Giáo viên Trường A',
      departmentId: deptA._id,
      status: 'active',
      employmentType: 'full_time',
      hireDate: new Date('2024-01-01')
    });

    empTeacherA2 = await Employee.create({
      tenantId: tenantA._id,
      userId: teacherA2._id,
      employeeCode: 'NV-A-TC2',
      fullName: 'Giáo viên 2 Trường A',
      departmentId: deptA._id,
      status: 'active',
      employmentType: 'full_time',
      hireDate: new Date('2024-01-01')
    });

    empHrA = await Employee.create({
      tenantId: tenantA._id,
      userId: hrA._id,
      employeeCode: 'NV-A-HR',
      fullName: 'Nhân sự Trường A',
      departmentId: deptA._id,
      status: 'active',
      employmentType: 'full_time',
      hireDate: new Date('2024-01-01')
    });

    empChefA = await Employee.create({
      tenantId: tenantA._id,
      userId: chefA._id,
      employeeCode: 'NV-A-CHF',
      fullName: 'Bếp trưởng Trường A',
      status: 'active',
      employmentType: 'full_time',
      hireDate: new Date('2024-01-01')
    });

    empGuardA = await Employee.create({
      tenantId: tenantA._id,
      userId: guardA._id,
      employeeCode: 'NV-A-GRD',
      fullName: 'Bảo vệ Trường A',
      status: 'active',
      employmentType: 'full_time',
      hireDate: new Date('2024-01-01')
    });

    // Seed Employee for Tenant B
    empTeacherB = await Employee.create({
      tenantId: tenantB._id,
      userId: teacherB._id,
      employeeCode: 'NV-B-TC1',
      fullName: 'Giáo viên Trường B',
      status: 'active',
      employmentType: 'full_time',
      hireDate: new Date('2024-01-01')
    });

    // Seed Classrooms
    classroomA1 = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Mầm 1A',
      schoolYear: '2026-2027',
      ageGroup: '3-4',
      maxSize: 30,
      status: 'active',
      homeroomTeacherId: teacherA._id,
      teachers: [{ teacherId: teacherA._id, role: 'homeroom' }],
      statistics: { currentStudents: 1, male: 1, female: 0 }
    });

    classroomA2 = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Chồi 1A',
      schoolYear: '2026-2027',
      ageGroup: '4-5',
      maxSize: 30,
      status: 'active',
      statistics: { currentStudents: 0, male: 0, female: 0 }
    });

    classroomB1 = await Classroom.create({
      tenantId: tenantB._id,
      name: 'Lớp Mầm 1B',
      schoolYear: '2026-2027',
      ageGroup: '3-4',
      maxSize: 30,
      status: 'active',
      homeroomTeacherId: teacherB._id,
      teachers: [{ teacherId: teacherB._id, role: 'homeroom' }],
      statistics: { currentStudents: 0, male: 0, female: 0 }
    });

    // Seed Student for Tenant A
    studentA1 = await Student.create({
      tenantId: tenantA._id,
      classroomId: classroomA1._id,
      className: classroomA1.name,
      fullName: 'Nguyễn Văn An',
      studentCode: 'HS-2026-000001',
      birthDate: new Date('2021-01-15'),
      gender: 'male',
      status: 'enrolled',
      schoolYear: '2026-2027',
      admissionDate: new Date('2026-09-01'),
      enrollmentDate: new Date('2026-09-01'),
      parentInfo: { primaryPhone: '0901234567' }
    });
  });

  // =========================================================================
  // NHÓM A: SAAS MODE MATRIX, ALIASES & ROUTE GATING VERIFICATION
  // =========================================================================
  describe('Nhóm A: SaaS Mode Matrix, Aliases & Route Gating', () => {
    test('A.1 phase1d mode opens approved HR, Accounts, and Timekeeping endpoints on /api/v1 and /api aliases', async () => {
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);

      for (const prefix of ['/api/v1', '/api']) {
        // Accounts: GET /system/accounts -> 200
        const resAccounts = await request(app1d)
          .get(`${prefix}/system/accounts`)
          .set('Authorization', `Bearer ${tokenAdmin}`);
        expect(resAccounts.status).toBe(200);
        expect(resAccounts.body.success).toBe(true);

        // HR: GET /hr/departments -> 200
        const resDepts = await request(app1d)
          .get(`${prefix}/hr/departments`)
          .set('Authorization', `Bearer ${tokenAdmin}`);
        expect(resDepts.status).toBe(200);
        expect(Array.isArray(resDepts.body.data)).toBe(true);

        // Timekeeping: GET /timekeeping/daily -> 200
        const resTimekeeping = await request(app1d)
          .get(`${prefix}/timekeeping/daily`)
          .set('Authorization', `Bearer ${tokenAdmin}`);
        expect(resTimekeeping.status).toBe(200);
        expect(resTimekeeping.body.data).toBeDefined();
      }
    });

    test('A.2 Earlier modes ("phase1b", "phase1c", "phase1a") fail-closed with 501 for HR, Accounts, and Timekeeping', async () => {
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);

      for (const pastMode of ['phase1b', 'phase1c', 'phase1a']) {
        const appPast = createSaasApp({
          mongoUri,
          connection: bootstrapInstance.connection,
          saasMode: pastMode
        });

        // /system/accounts -> 501
        const resAccounts = await request(appPast)
          .get('/api/v1/system/accounts')
          .set('Authorization', `Bearer ${tokenAdmin}`);
        expect(resAccounts.status).toBe(501);

        // /hr/departments -> 501
        const resDepts = await request(appPast)
          .get('/api/v1/hr/departments')
          .set('Authorization', `Bearer ${tokenAdmin}`);
        expect(resDepts.status).toBe(501);

        // /timekeeping/daily -> 501
        const resTimekeeping = await request(appPast)
          .get('/api/v1/timekeeping/daily')
          .set('Authorization', `Bearer ${tokenAdmin}`);
        expect(resTimekeeping.status).toBe(501);

        // PUT /classrooms/:id/homeroom-teacher -> 501
        const resHomeroom = await request(appPast)
          .put(`/api/v1/classrooms/${classroomA1._id}/homeroom-teacher`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send({ teacherId: teacherA._id.toString() });
        expect(resHomeroom.status).toBe(501);
      }
    });

    test('A.3 Unknown & future modes ("unknown", "phase1f", "phase1g") fail-closed with 501', async () => {
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);

      for (const futureMode of ['unknown', 'phase1f', 'phase1g']) {
        const appFuture = createSaasApp({
          mongoUri,
          connection: bootstrapInstance.connection,
          saasMode: futureMode
        });

        const resAccounts = await request(appFuture)
          .get('/api/v1/system/accounts')
          .set('Authorization', `Bearer ${tokenAdmin}`);
        expect(resAccounts.status).toBe(501);

        const resDepts = await request(appFuture)
          .get('/api/v1/hr/departments')
          .set('Authorization', `Bearer ${tokenAdmin}`);
        expect(resDepts.status).toBe(501);

        const resTimekeeping = await request(appFuture)
          .get('/api/v1/timekeeping/daily')
          .set('Authorization', `Bearer ${tokenAdmin}`);
        expect(resTimekeeping.status).toBe(501);
      }
    });

    test('A.4 Public 410 contract: /hr/recruitment returns HTTP 410 Gone with/without auth or with invalid token on both aliases', async () => {
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);

      for (const prefix of ['/api/v1', '/api']) {
        // Without Authorization header -> 410 Gone
        const resNoAuth = await request(app1d).get(`${prefix}/hr/recruitment/candidates`);
        expect(resNoAuth.status).toBe(410);
        expect(resNoAuth.body.success).toBe(false);
        expect(resNoAuth.body.message).toContain('ngừng hoạt động');

        // With invalid / malformed token -> still 410 Gone (public retired route)
        const resBadAuth = await request(app1d)
          .get(`${prefix}/hr/recruitment/candidates`)
          .set('Authorization', 'Bearer totally-invalid-jwt-token');
        expect(resBadAuth.status).toBe(410);
        expect(resBadAuth.body.success).toBe(false);

        // With valid token -> 410 Gone
        const resValidAuth = await request(app1d)
          .get(`${prefix}/hr/recruitment/candidates`)
          .set('Authorization', `Bearer ${tokenAdmin}`);
        expect(resValidAuth.status).toBe(410);
        expect(resValidAuth.body.success).toBe(false);
      }
    });

    test('A.5 Unapproved submodules in HR, System, and Timekeeping cleanly fall through to 501 (Feature Gate)', async () => {
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);

      const unapprovedEndpoints = [
        '/system/parents',
        '/hr/payroll',
        '/hr/personal-requests',
        '/hr/credentials',
        '/hr/development',
        '/hr/handovers',
        '/hr/internal',
        '/hr/reports',
        '/hr/audit',
        '/timekeeping/kiosk/check-in',
        '/timekeeping/device-events',
        '/timekeeping/overtime'
      ];

      for (const endpoint of unapprovedEndpoints) {
        for (const prefix of ['/api/v1', '/api']) {
          const res = await request(app1d)
            .get(`${prefix}${endpoint}`)
            .set('Authorization', `Bearer ${tokenAdmin}`);
          expect(res.status).toBe(501);
          expect(res.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
        }
      }
    });

    test('A.6 Mode precedence: options.saasMode takes precedence over process.env.SAAS_MODE', async () => {
      process.env.SAAS_MODE = 'phase1b';
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);

      // Explicit options.saasMode = 'phase1d' must override process.env.SAAS_MODE = 'phase1b'
      const app = createSaasApp({
        mongoUri,
        connection: bootstrapInstance.connection,
        saasMode: 'phase1d'
      });

      const res = await request(app)
        .get('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res.status).toBe(200);
    });

    test('A.7 Mode precedence: process.env.SAAS_MODE is used when options.saasMode is omitted', async () => {
      process.env.SAAS_MODE = 'phase1c';
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);

      const app = createSaasApp({
        mongoUri,
        connection: bootstrapInstance.connection
      });

      // In phase1c, attendance is open but HR/timekeeping is gated 501
      const resAttendance = await request(app)
        .get('/api/v1/attendance/class/' + classroomA1._id)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resAttendance.status).toBe(200);

      const resHr = await request(app)
        .get('/api/v1/hr/departments')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resHr.status).toBe(501);
    });

    test('A.8 Mode precedence: default mode is phase1b when both options and env are unset', async () => {
      delete process.env.SAAS_MODE;
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);

      const app = createSaasApp({
        mongoUri,
        connection: bootstrapInstance.connection
      });

      // In default phase1b, classrooms read is open, attendance & HR are gated 501
      const resClassrooms = await request(app)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resClassrooms.status).toBe(200);

      const resAttendance = await request(app)
        .get('/api/v1/attendance?classroomId=' + classroomA1._id)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resAttendance.status).toBe(501);

      const resHr = await request(app)
        .get('/api/v1/hr/departments')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resHr.status).toBe(501);
    });

    test('A.9 Mutating process.env.SAAS_MODE after app creation does NOT alter permissions of created app', async () => {
      const app = createSaasApp({
        mongoUri,
        connection: bootstrapInstance.connection,
        saasMode: 'phase1d'
      });
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);

      // Verify open in phase1d
      const resBefore = await request(app)
        .get('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resBefore.status).toBe(200);

      // Attempt to downgrade env afterwards
      process.env.SAAS_MODE = 'phase1b';

      const resAfter = await request(app)
        .get('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resAfter.status).toBe(200);
    });

    test('A.10 Typo modes (e.g. "phase1d ") fail-closed with 501', async () => {
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);

      const appTypo = createSaasApp({
        mongoUri,
        connection: bootstrapInstance.connection,
        saasMode: 'phase1d '
      });

      const res = await request(appTypo)
        .get('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res.status).toBe(501);
    });
  });

  // =========================================================================
  // NHÓM B: AUTHENTICATION, RBAC & TENANT BOUNDARY
  // =========================================================================
  describe('Nhóm B: Authentication, RBAC & Tenant Boundary', () => {
    test('B.1 Missing or invalid token returns 401', async () => {
      const resNoAuth = await request(app1d).get('/api/v1/system/accounts');
      expect(resNoAuth.status).toBe(401);

      const resBadAuth = await request(app1d)
        .get('/api/v1/system/accounts')
        .set('Authorization', 'Bearer invalid-jwt-token');
      expect(resBadAuth.status).toBe(401);
    });

    test('B.2 Inactive user returns 401 USER_INACTIVE', async () => {
      const tokenInactive = generateSchoolUserToken(inactiveUserA, tenantA);
      const res = await request(app1d)
        .get('/api/v1/hr/departments')
        .set('Authorization', `Bearer ${tokenInactive}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('USER_INACTIVE');
    });

    test('B.3 Suspended tenant returns 403 TENANT_SUSPENDED', async () => {
      const userC = await User.create({
        username: 'admin_c',
        email: 'admin.c@school-c.edu.vn',
        passwordHash: hashedPassword,
        role: 'admin',
        tenantId: tenantC_suspended._id,
        status: 'active',
        authVersion: 1,
        profile: { fullName: 'Quản trị viên Trường C' }
      });

      const tokenSuspended = generateSchoolUserToken(userC, tenantC_suspended);
      const res = await request(app1d)
        .get('/api/v1/hr/departments')
        .set('Authorization', `Bearer ${tokenSuspended}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TENANT_SUSPENDED');
    });

    test('B.4 Tenant A token accessing Tenant B employee returns 404', async () => {
      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);
      const res = await request(app1d)
        .get(`/api/v1/hr/employees/${empTeacherB._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Không tìm thấy');
    });

    test('B.5 Role checks on /system/accounts: admin & hr allowed; teacher, guard, parent rejected with 403', async () => {
      const tokenTeacher = generateSchoolUserToken(teacherA, tenantA);
      const tokenGuard = generateSchoolUserToken(guardA, tenantA);
      const tokenParent = generateSchoolUserToken(parentA, tenantA);

      for (const token of [tokenTeacher, tokenGuard, tokenParent]) {
        const res = await request(app1d)
          .get('/api/v1/system/accounts')
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(403);
      }
    });

    test('B.6 HR cannot create admin or principal accounts (HTTP 422)', async () => {
      const tokenHr = generateSchoolUserToken(hrA, tenantA);

      const res = await request(app1d)
        .post('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenHr}`)
        .send({
          username: 'new_principal',
          password: 'Password123@Valid',
          role: 'principal',
          profile: {
            fullName: 'Hiệu trưởng mới',
            email: 'new.principal@school-a.edu.vn'
          }
        });

      expect(res.status).toBe(422);
      expect(res.body.message).toContain('không có quyền gán vai trò này');
    });

    test('B.7 Only admin can create department: hr and teacher rejected with 403', async () => {
      const tokenHr = generateSchoolUserToken(hrA, tenantA);
      const tokenTeacher = generateSchoolUserToken(teacherA, tenantA);

      for (const token of [tokenHr, tokenTeacher]) {
        const res = await request(app1d)
          .post('/api/v1/hr/departments')
          .set('Authorization', `Bearer ${token}`)
          .send({ name: 'Phòng Mới', code: 'PM' });
        expect(res.status).toBe(403);
      }
    });

    test('B.8 Staff leave request review: only admin & principal allowed; teacher and hr rejected with 403', async () => {
      const leave = await LeaveRequest.create({
        tenantId: tenantA._id,
        employeeId: empTeacherA._id,
        employeeCode: empTeacherA.employeeCode,
        employeeName: empTeacherA.fullName,
        leaveType: 'sick',
        startDate: new Date('2026-11-10'),
        endDate: new Date('2026-11-11'),
        totalDays: 2,
        reason: 'Ốm sốt',
        status: 'pending'
      });

      const tokenTeacher = generateSchoolUserToken(teacherA, tenantA);
      const tokenHr = generateSchoolUserToken(hrA, tenantA);

      for (const token of [tokenTeacher, tokenHr]) {
        const res = await request(app1d)
          .patch(`/api/v1/hr/leave-requests/${leave._id}/review`)
          .set('Authorization', `Bearer ${token}`)
          .send({ status: 'approved' });
        expect(res.status).toBe(403);
      }
    });

    test('B.9 Legacy JWT token (missing purpose/SaaS claims) rejected with 401 on school router', async () => {
      const legacyToken = jwt.sign(
        { id: adminA._id.toString(), role: 'admin' },
        process.env.JWT_SECRET,
        { expiresIn: '8h' }
      );

      const res = await request(app1d)
        .get('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${legacyToken}`);
      expect(res.status).toBe(401);
    });

    test('B.10 Platform Admin JWT token (PLATFORM_ADMIN_ACCESS) rejected with 401 on school router', async () => {
      const platformAdmin = {
        _id: new mongoose.Types.ObjectId(),
        username: 'platform_lead_user',
        role: 'platform_lead',
        authVersion: 1
      };
      const platformToken = generatePlatformAdminToken(platformAdmin);

      const res = await request(app1d)
        .get('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${platformToken}`);
      expect([401, 403]).toContain(res.status);
      expect(res.body.code).toBe('INVALID_TOKEN_PURPOSE');
    });

    test('B.11 Stale user authVersion token rejected with 401 TOKEN_VERSION_STALE', async () => {
      // Generate token with current authVersion = 1
      const token = generateSchoolUserToken(adminA, tenantA);

      // Increment authVersion in database to 2
      await User.updateOne({ _id: adminA._id }, { $set: { authVersion: 2 } });

      const res = await request(app1d)
        .get('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTH_VERSION_MISMATCH');
    });

    test('B.12 Stale tenant authVersion token rejected with 401 TENANT_VERSION_STALE', async () => {
      const token = generateSchoolUserToken(adminA, tenantA);

      // Increment tenant authVersion in database
      await Tenant.updateOne({ _id: tenantA._id }, { $set: { authVersion: 2 } });

      const res = await request(app1d)
        .get('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${token}`);
      expect([401, 403]).toContain(res.status);
      expect(res.body.code).toBe('TENANT_AUTH_REVOKED');
    });

    test('B.13 Token referencing non-existent tenant returns 403 or 404', async () => {
      const nonExistentTenant = {
        _id: new mongoose.Types.ObjectId(),
        code: 'ghost-school',
        authVersion: 1
      };
      const tokenGhost = generateSchoolUserToken(adminA, nonExistentTenant);

      const res = await request(app1d)
        .get('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenGhost}`);
      expect([401, 403, 404]).toContain(res.status);
    });

    test('B.14 Payload body cannot escalate caller privileges', async () => {
      const tokenTeacher = generateSchoolUserToken(teacherA, tenantA);

      // Teacher attempts to inject role: 'admin' into body
      const res = await request(app1d)
        .post('/api/v1/hr/departments')
        .set('Authorization', `Bearer ${tokenTeacher}`)
        .send({
          name: 'Phòng Đặc Biệt',
          code: 'PDB',
          role: 'admin'
        });
      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // NHÓM C: NGHIỆP VỤ NHÂN SỰ, TÀI KHOẢN NỘI BỘ & PHÂN CÔNG CHỦ NHIỆM
  // =========================================================================
  describe('Nhóm C: Nghiệp vụ Nhân sự, Tài khoản nội bộ & Phân công chủ nhiệm', () => {
    test('C.1 CRUD internal accounts within Tenant A; cross-tenant modification prevented', async () => {
      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);

      // Create new teacher account
      const resCreate = await request(app1d)
        .post('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          username: 'teacher_new_a',
          password: 'Password123@Valid',
          role: 'teacher',
          profile: {
            fullName: 'Giáo viên mới A',
            email: 'teacher.new.a@school-a.edu.vn'
          }
        });
      expect(resCreate.status).toBe(201);
      const newUserId = resCreate.body.data._id;

      // Verify tenantId was set to Tenant A
      const createdUser = await User.findById(newUserId);
      expect(createdUser.tenantId.toString()).toBe(tenantA._id.toString());

      // Update role
      const resRole = await request(app1d)
        .patch(`/api/v1/system/accounts/${newUserId}/role`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ role: 'accountant' });
      expect(resRole.status).toBe(200);
      expect(resRole.body.data.role).toBe('accountant');

      // Admin A attempting to deactivate Tenant B user -> returns 404
      const resDeactB = await request(app1d)
        .delete(`/api/v1/system/accounts/${teacherB._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resDeactB.status).toBe(404);

      // Deactivate own tenant user
      const resDeact = await request(app1d)
        .delete(`/api/v1/system/accounts/${newUserId}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resDeact.status).toBe(200);
      expect(resDeact.body.data.status).toBe('inactive');
    });

    test('C.2 Sync staff accounts links User to Employee within Tenant A without touching Tenant B', async () => {
      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);

      // Create an unlinked user in Tenant A
      const unlinkedUser = await User.create({
        username: 'unlinked_teacher_a',
        email: 'unlinked.teacher@school-a.edu.vn',
        passwordHash: hashedPassword,
        role: 'teacher',
        tenantId: tenantA._id,
        status: 'active',
        authVersion: 1,
        profile: { fullName: 'Giáo viên Chưa Liên Kết' }
      });

      // Sync
      const resSync = await request(app1d)
        .post('/api/v1/hr/staff-accounts/sync')
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resSync.status).toBe(200);

      // Verify newly created Employee belongs to Tenant A
      const emp = await Employee.findOne({ userId: unlinkedUser._id });
      expect(emp).not.toBeNull();
      expect(emp.tenantId.toString()).toBe(tenantA._id.toString());
      expect(emp.fullName).toBe('Giáo viên Chưa Liên Kết');
    });

    test('C.3 Departments and Employees management within tenant', async () => {
      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);

      // Create Department
      const resDept = await request(app1d)
        .post('/api/v1/hr/departments')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          name: 'Phòng Hành Chính Tổng Hợp',
          code: 'HCTH',
          description: 'Hành chính và quản trị'
        });
      expect(resDept.status).toBe(201);
      const newDeptId = resDept.body.data._id;

      // Create Employee under new department
      const resEmp = await request(app1d)
        .post('/api/v1/hr/employees')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          fullName: 'Nhân viên Hành chính Mới',
          employeeCode: 'NV-HCTH-01',
          departmentId: newDeptId,
          employmentType: 'full_time',
          hireDate: '2024-01-01'
        });
      expect(resEmp.status).toBe(201);
      const newEmpId = resEmp.body.data._id;

      // Get Employee Detail
      const resDetail = await request(app1d)
        .get(`/api/v1/hr/employees/${newEmpId}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resDetail.status).toBe(200);
      expect(resDetail.body.data.employeeCode).toBe('NV-HCTH-01');

      // Get Employee History
      const resHist = await request(app1d)
        .get(`/api/v1/hr/employees/${newEmpId}/history`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resHist.status).toBe(200);
      expect(Array.isArray(resHist.body.data)).toBe(true);
    });

    test('C.4 Staffing shift creation, timetable query, and shift cancellation', async () => {
      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);

      // Create shift
      const resShift = await request(app1d)
        .post('/api/v1/hr/staffing/shifts')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          employeeId: empChefA._id.toString(),
          name: 'Ca sáng',
          startTime: '07:30',
          endTime: '11:30',
          weekdays: [1, 2, 3, 4, 5],
          validFrom: '2026-11-01',
          validUntil: '2026-11-30'
        });
      expect(resShift.status).toBe(201);
      const shiftId = resShift.body.data._id;

      // Query timetable
      const resTimetable = await request(app1d)
        .get('/api/v1/hr/staffing/timetable?week=2026-W46')
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resTimetable.status).toBe(200);

      // Cancel shift
      const resCancel = await request(app1d)
        .delete(`/api/v1/hr/staffing/shifts/${shiftId}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resCancel.status).toBe(200);
    });

    test('C.5 Homeroom teacher assignment PUT /classrooms/:id/homeroom-teacher updates classroom and teacher version', async () => {
      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);

      const resAssign = await request(app1d)
        .put(`/api/v1/classrooms/${classroomA1._id}/homeroom-teacher`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ teacherId: teacherA2._id.toString() });

      expect(resAssign.status).toBe(200);
      expect(resAssign.body.success).toBe(true);
      expect(resAssign.body.data.homeroomTeacherId.toString()).toBe(teacherA2._id.toString());

      // Verify atomic increment on assignmentVersion
      const teacherUpdated = await User.findById(teacherA2._id);
      expect(teacherUpdated.assignmentVersion).toBe(1);
    });

    test('C.6 Assigning Tenant B teacher to Tenant A classroom fails with 422', async () => {
      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);

      const resAssign = await request(app1d)
        .put(`/api/v1/classrooms/${classroomA1._id}/homeroom-teacher`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ teacherId: teacherB._id.toString() });

      expect(resAssign.status).toBe(422);
      expect(resAssign.body.message).toContain('giáo viên đang hoạt động');
    });

    test('C.7 Representative write operations behave identically on /api/v1 and /api aliases', async () => {
      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);
      const tokenTeacherA = generateSchoolUserToken(teacherA, tenantA);

      // 1. Accounts on /api
      const resAccount = await request(app1d)
        .post('/api/system/accounts')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          username: 'account_via_api_alias',
          password: 'Password123@Valid',
          role: 'teacher',
          profile: { fullName: 'Giáo viên qua /api', email: 'alias.account@school-a.edu.vn' }
        });
      expect(resAccount.status).toBe(201);

      // 2. HR Department on /api
      const resDept = await request(app1d)
        .post('/api/hr/departments')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ name: 'Tổ Văn Phòng Qua Alias', code: 'TVP-ALIAS' });
      expect(resDept.status).toBe(201);

      // 3. Staffing Shift on /api
      const resShift = await request(app1d)
        .post('/api/hr/staffing/shifts')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          employeeId: empGuardA._id.toString(),
          name: 'Ca tối alias',
          startTime: '18:00',
          endTime: '22:00',
          weekdays: [1, 2, 3],
          validFrom: '2026-11-01',
          validUntil: '2026-11-30'
        });
      expect(resShift.status).toBe(201);

      // 4. Homeroom on /api
      const resHomeroom = await request(app1d)
        .put(`/api/classrooms/${classroomA2._id}/homeroom-teacher`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ teacherId: teacherA2._id.toString() });
      expect(resHomeroom.status).toBe(200);

      // 5. Timekeeping on /api
      const resTimekeeping = await request(app1d)
        .post('/api/timekeeping/check-in')
        .set('Authorization', `Bearer ${tokenTeacherA}`)
        .send({ note: 'Checkin via /api alias' });
      expect([200, 201]).toContain(resTimekeeping.status);
    });

    test('C.8 Department update is PUT /hr/departments/:id: admin allowed, hr and teacher rejected with 403', async () => {
      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);
      const tokenHrA = generateSchoolUserToken(hrA, tenantA);
      const tokenTeacherA = generateSchoolUserToken(teacherA, tenantA);

      // HR rejected 403
      const resHr = await request(app1d)
        .put(`/api/v1/hr/departments/${deptA._id}`)
        .set('Authorization', `Bearer ${tokenHrA}`)
        .send({ name: 'Tên mới bởi HR' });
      expect(resHr.status).toBe(403);

      // Teacher rejected 403
      const resTeacher = await request(app1d)
        .put(`/api/v1/hr/departments/${deptA._id}`)
        .set('Authorization', `Bearer ${tokenTeacherA}`)
        .send({ name: 'Tên mới bởi Teacher' });
      expect(resTeacher.status).toBe(403);

      // Admin allowed 200
      const resAdmin = await request(app1d)
        .put(`/api/v1/hr/departments/${deptA._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ name: 'Tổ Chuyên Môn Mầm Cập Nhật', description: 'Mô tả cập nhật' });
      expect(resAdmin.status).toBe(200);
      expect(resAdmin.body.data.name).toBe('Tổ Chuyên Môn Mầm Cập Nhật');
    });

    test('C.9 No route shadowing: specific routes under /staffing and /leave-requests are preserved', async () => {
      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);

      // /hr/staffing/timetable is not shadowed
      const resTimetable = await request(app1d)
        .get('/api/v1/hr/staffing/timetable?week=2026-W46')
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resTimetable.status).toBe(200);

      // /hr/leave-requests/overview is not shadowed by /hr/leave-requests/:id
      const resOverview = await request(app1d)
        .get('/api/v1/hr/leave-requests/overview')
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resOverview.status).toBe(200);
    });
  });

  // =========================================================================
  // NHÓM D: CHẤM CÔNG & STATE MACHINE ĐIỀU CHỈNH
  // =========================================================================
  describe('Nhóm D: Chấm công & State Machine Điều chỉnh', () => {
    test('D.1 Web manual check-in creates attendance record within tenant', async () => {
      const tokenTeacher = generateSchoolUserToken(teacherA, tenantA);

      const resCheckIn = await request(app1d)
        .post('/api/v1/timekeeping/check-in')
        .set('Authorization', `Bearer ${tokenTeacher}`)
        .send({ note: 'Chấm công đầu ngày tại cổng web' });

      expect([200, 201]).toContain(resCheckIn.status);

      const record = await AttendanceRecord.findOne({ userId: teacherA._id });
      expect(record).not.toBeNull();
      expect(record.tenantId.toString()).toBe(tenantA._id.toString());
      expect(record.checkInTime).toBeDefined();
    });

    test('D.2 Inquiries GET /timekeeping/me and GET /timekeeping/daily isolate tenant data', async () => {
      const tokenTeacherA = generateSchoolUserToken(teacherA, tenantA);
      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);

      // Query my timekeeping
      const resMe = await request(app1d)
        .get('/api/v1/timekeeping/me')
        .set('Authorization', `Bearer ${tokenTeacherA}`);
      expect(resMe.status).toBe(200);
      expect(resMe.body.data).toBeDefined();

      // Query daily timekeeping
      const resDaily = await request(app1d)
        .get('/api/v1/timekeeping/daily?date=2026-11-06')
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resDaily.status).toBe(200);
      expect(resDaily.body.data).toBeDefined();
    });

    test('D.3 Full Adjustment State Machine: Draft -> Update -> Submit -> Approve', async () => {
      const tokenTeacherA = generateSchoolUserToken(teacherA, tenantA);
      const tokenPrincipalA = generateSchoolUserToken(principalA, tenantA);

      // 1. Create Draft
      const resDraft = await request(app1d)
        .post('/api/v1/timekeeping/adjustments')
        .set('Authorization', `Bearer ${tokenTeacherA}`)
        .send({
          workDate: '2026-10-20',
          requestedTime: '08:00',
          adjustmentType: 'MISSING_CHECK_IN',
          reason: 'Quên mang thẻ chấm công'
        });
      expect(resDraft.status).toBe(201);
      const adjustmentId = resDraft.body.data._id;
      expect(resDraft.body.data.status).toBe('DRAFT');
      expect(resDraft.body.data.version).toBe(1);

      // 2. Update Draft
      const resUpdate = await request(app1d)
        .patch(`/api/v1/timekeeping/adjustments/${adjustmentId}`)
        .set('Authorization', `Bearer ${tokenTeacherA}`)
        .send({
          version: 1,
          requestedTime: '07:45',
          reason: 'Cập nhật lại giờ chính xác'
        });
      expect(resUpdate.status).toBe(200);
      expect(resUpdate.body.data.version).toBe(2);

      // 3. Submit Draft
      const resSubmit = await request(app1d)
        .post(`/api/v1/timekeeping/adjustments/${adjustmentId}/submit`)
        .set('Authorization', `Bearer ${tokenTeacherA}`)
        .send({ version: 2 });
      expect(resSubmit.status).toBe(200);
      expect(resSubmit.body.data.status).toBe('PENDING');
      expect(resSubmit.body.data.version).toBe(3);

      // 4. Approve Adjustment (Principal A)
      const resApprove = await request(app1d)
        .patch(`/api/v1/timekeeping/corrections/${adjustmentId}/approve`)
        .set('Authorization', `Bearer ${tokenPrincipalA}`)
        .send({ version: 3, note: 'Duyệt đơn hợp lệ' });
      expect(resApprove.status).toBe(200);
      expect(resApprove.body.data.status).toBe('APPROVED');
      expect(resApprove.body.data.version).toBe(4);

      // Verify AttendanceAuditLog created for approval
      const audit = await AttendanceAuditLog.findOne({ entityId: adjustmentId, action: 'CORRECTION_APPROVED' });
      expect(audit).not.toBeNull();
      expect(audit.tenantId.toString()).toBe(tenantA._id.toString());
      expect(audit.action).toBe('CORRECTION_APPROVED');
    });

    test('D.4 Version conflict returns 409 VERSION_CONFLICT', async () => {
      const tokenTeacherA = generateSchoolUserToken(teacherA, tenantA);

      const resDraft = await request(app1d)
        .post('/api/v1/timekeeping/adjustments')
        .set('Authorization', `Bearer ${tokenTeacherA}`)
        .send({
          workDate: '2026-10-21',
          requestedTime: '08:00',
          adjustmentType: 'MISSING_CHECK_IN',
          reason: 'Thử nghiệm xung đột phiên bản'
        });
      expect(resDraft.status).toBe(201);
      const adjustmentId = resDraft.body.data._id;

      // Submit with stale version (expected 1, passing 99)
      const resConflict = await request(app1d)
        .post(`/api/v1/timekeeping/adjustments/${adjustmentId}/submit`)
        .set('Authorization', `Bearer ${tokenTeacherA}`)
        .send({ version: 99 });
      expect(resConflict.status).toBe(409);
      expect(resConflict.body.code).toBe('VERSION_CONFLICT');
    });

    test('D.5 Guard role is prohibited from creating adjustment drafts (HTTP 403)', async () => {
      const tokenGuardA = generateSchoolUserToken(guardA, tenantA);

      const res = await request(app1d)
        .post('/api/v1/timekeeping/adjustments')
        .set('Authorization', `Bearer ${tokenGuardA}`)
        .send({
          workDate: '2026-10-22',
          requestedTime: '08:00',
          adjustmentType: 'MISSING_CHECK_IN',
          reason: 'Bảo vệ thử gửi yêu cầu'
        });
      expect(res.status).toBe(403);
    });

    test('D.6 Approver cannot approve own adjustment request', async () => {
      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);

      // Admin A creates and submits own adjustment
      const resDraft = await request(app1d)
        .post('/api/v1/timekeeping/adjustments')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          workDate: '2026-10-23',
          requestedTime: '08:00',
          adjustmentType: 'MISSING_CHECK_IN',
          reason: 'Admin tự tạo đơn'
        });
      expect(resDraft.status).toBe(201);
      const adjustmentId = resDraft.body.data._id;

      await request(app1d)
        .post(`/api/v1/timekeeping/adjustments/${adjustmentId}/submit`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ version: 1 });

      // Admin A attempts to self-approve -> rejected
      const resSelfApprove = await request(app1d)
        .patch(`/api/v1/timekeeping/corrections/${adjustmentId}/approve`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ version: 2 });
      expect(resSelfApprove.status).toBe(403);
      expect(resSelfApprove.body.message).toContain('tự phê duyệt');
    });

    test('D.7 Cancellation of draft and pending adjustments: owner allowed, foreign user rejected', async () => {
      const tokenTeacherA = generateSchoolUserToken(teacherA, tenantA);
      const tokenTeacherB = generateSchoolUserToken(teacherB, tenantB);

      // 1. Owner cancels DRAFT
      const resDraft = await request(app1d)
        .post('/api/v1/timekeeping/adjustments')
        .set('Authorization', `Bearer ${tokenTeacherA}`)
        .send({
          workDate: '2026-10-25',
          requestedTime: '08:00',
          adjustmentType: 'MISSING_CHECK_IN',
          reason: 'Tạo để hủy thử nghiệm'
        });
      expect(resDraft.status).toBe(201);
      const draftId = resDraft.body.data._id;

      // Foreign user (Tenant B) attempts to cancel -> rejected 404
      const resForeignCancel = await request(app1d)
        .post(`/api/v1/timekeeping/adjustments/${draftId}/cancel`)
        .set('Authorization', 'Bearer ' + tokenTeacherB)
        .send({ version: 1, reason: 'Foreign cancel attempt' });
      expect([403, 404]).toContain(resForeignCancel.status);

      // Owner cancels own draft -> 200 CANCELLED
      const resCancelDraft = await request(app1d)
        .post(`/api/v1/timekeeping/adjustments/${draftId}/cancel`)
        .set('Authorization', 'Bearer ' + tokenTeacherA)
        .send({ version: 1, reason: 'Đổi ý không cần điều chỉnh' });
      expect(resCancelDraft.status).toBe(200);
      expect(resCancelDraft.body.data.status).toBe('CANCELLED');

      // 2. Owner cancels PENDING adjustment
      const resDraft2 = await request(app1d)
        .post('/api/v1/timekeeping/adjustments')
        .set('Authorization', `Bearer ${tokenTeacherA}`)
        .send({
          workDate: '2026-10-26',
          requestedTime: '08:00',
          adjustmentType: 'MISSING_CHECK_IN',
          reason: 'Pending để hủy'
        });
      expect(resDraft2.status).toBe(201);
      const pendingId = resDraft2.body.data._id;

      await request(app1d)
        .post(`/api/v1/timekeeping/adjustments/${pendingId}/submit`)
        .set('Authorization', `Bearer ${tokenTeacherA}`)
        .send({ version: 1 });

      const resCancelPending = await request(app1d)
        .post(`/api/v1/timekeeping/adjustments/${pendingId}/cancel`)
        .set('Authorization', 'Bearer ' + tokenTeacherA)
        .send({ version: 2, reason: 'Hủy đơn đang chờ duyệt' });
      expect(resCancelPending.status).toBe(200);
      expect(resCancelPending.body.data.status).toBe('CANCELLED');
    });

    test('D.8 Rejection of correction request by Principal updates status to REJECTED with audit log', async () => {
      const tokenTeacherA = generateSchoolUserToken(teacherA, tenantA);
      const tokenPrincipalA = generateSchoolUserToken(principalA, tenantA);

      // Create & submit
      const resDraft = await request(app1d)
        .post('/api/v1/timekeeping/adjustments')
        .set('Authorization', `Bearer ${tokenTeacherA}`)
        .send({
          workDate: '2026-10-27',
          requestedTime: '08:00',
          adjustmentType: 'MISSING_CHECK_IN',
          reason: 'Yêu cầu chờ từ chối'
        });
      expect(resDraft.status).toBe(201);
      const adjustmentId = resDraft.body.data._id;

      await request(app1d)
        .post(`/api/v1/timekeeping/adjustments/${adjustmentId}/submit`)
        .set('Authorization', `Bearer ${tokenTeacherA}`)
        .send({ version: 1 });

      // Reject (Principal A)
      const resReject = await request(app1d)
        .patch(`/api/v1/timekeeping/corrections/${adjustmentId}/reject`)
        .set('Authorization', `Bearer ${tokenPrincipalA}`)
        .send({ version: 2, reason: 'Dữ liệu không khớp thực tế' });
      expect(resReject.status).toBe(200);
      expect(resReject.body.data.status).toBe('REJECTED');
      expect(resReject.body.data.version).toBe(3);

      // Verify audit log
      const audit = await AttendanceAuditLog.findOne({ entityId: adjustmentId, action: 'CORRECTION_REJECTED' });
      expect(audit).not.toBeNull();
      expect(audit.tenantId.toString()).toBe(tenantA._id.toString());
    });

    test('D.9 Audit log creation failure rolls back draft creation transaction atomically', async () => {
      const tokenTeacherA = generateSchoolUserToken(teacherA, tenantA);
      const auditSpy = jest.spyOn(AttendanceAuditLog, 'create').mockRejectedValueOnce(new Error('Simulated Audit Failure'));

      try {
        const res = await request(app1d)
          .post('/api/v1/timekeeping/adjustments')
          .set('Authorization', `Bearer ${tokenTeacherA}`)
          .send({
            workDate: '2026-10-28',
            requestedTime: '08:00',
            adjustmentType: 'MISSING_CHECK_IN',
            reason: 'Thử nghiệm rollback audit'
          });
        expect([500]).toContain(res.status);

        // Verify transaction rolled back: no document persisted
        const savedDoc = await TimekeepingCorrectionRequest.findOne({
          userId: teacherA._id,
          workDate: '2026-10-28'
        });
        expect(savedDoc).toBeNull();
      } finally {
        auditSpy.mockRestore();
      }
    });

    test('D.10 OutboxEvent creation failure rolls back correction approval transaction atomically', async () => {
      const tokenTeacherA = generateSchoolUserToken(teacherA, tenantA);
      const tokenPrincipalA = generateSchoolUserToken(principalA, tenantA);

      // Create and submit valid adjustment
      const resDraft = await request(app1d)
        .post('/api/v1/timekeeping/adjustments')
        .set('Authorization', `Bearer ${tokenTeacherA}`)
        .send({
          workDate: '2026-10-29',
          requestedTime: '08:00',
          adjustmentType: 'MISSING_CHECK_IN',
          reason: 'Thử nghiệm rollback approval'
        });
      expect(resDraft.status).toBe(201);
      const adjustmentId = resDraft.body.data._id;

      await request(app1d)
        .post(`/api/v1/timekeeping/adjustments/${adjustmentId}/submit`)
        .set('Authorization', `Bearer ${tokenTeacherA}`)
        .send({ version: 1 });

      // Mock OutboxEvent.create to simulate downstream failure in transaction
      const outboxSpy = jest.spyOn(OutboxEvent, 'create').mockRejectedValueOnce(new Error('Simulated Outbox Failure'));

      try {
        const resApprove = await request(app1d)
          .patch(`/api/v1/timekeeping/corrections/${adjustmentId}/approve`)
          .set('Authorization', `Bearer ${tokenPrincipalA}`)
          .send({ version: 2, note: 'Duyệt thử nghiệm rollback' });
        expect(resApprove.status).toBe(500);

        // Verify transaction aborted: document remains PENDING with version 2
        const docAfter = await TimekeepingCorrectionRequest.findById(adjustmentId);
        expect(docAfter.status).toBe('PENDING');
        expect(docAfter.version).toBe(2);

        // Verify no AttendanceRecord was persisted for this adjustment
        const record = await AttendanceRecord.findOne({ userId: teacherA._id, workDate: startOfWorkDate('2026-10-29', DEFAULT_SCHOOL_TIMEZONE) });
        expect(record).toBeNull();
      } finally {
        outboxSpy.mockRestore();
      }
    });
  });

  // =========================================================================
  // NHÓM E: HÀNG ĐỢI TÍNH CÔNG & HTTP RECALCULATE ISOLATION
  // =========================================================================
  describe('Nhóm E: Hàng đợi tính công & HTTP Recalculate Isolation', () => {
    test('E.1 POST /timekeeping/recalculate/:date claims only Tenant A items; Tenant B and legacy queues untouched', async () => {
      const targetDate = '2026-10-24';
      const today = startOfWorkDate(targetDate, DEFAULT_SCHOOL_TIMEZONE);
      const tokenPrincipalA = generateSchoolUserToken(principalA, tenantA);

      // 1. Seed Queue Item for Tenant B (10 mins earlier)
      const queueB = await AttendanceRecalculationQueue.create({
        tenantId: tenantB._id,
        userId: teacherB._id,
        workDate: today,
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(Date.now() - 10 * 60 * 1000)
      });

      // 2. Seed Legacy Queue Item without tenantId (15 mins earlier)
      const legacyQueue = await AttendanceRecalculationQueue.create({
        tenantId: null,
        userId: teacherA2._id,
        workDate: today,
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(Date.now() - 15 * 60 * 1000)
      });

      // 3. Create raw attendance event for Teacher A in Tenant A to trigger recalculation
      await RawAttendanceEvent.create({
        tenantId: tenantA._id,
        userId: teacherA._id,
        employeeName: 'Giáo viên Trường A',
        deviceId: 'DEV-A-01',
        externalEventId: 'EVT-A-01',
        workDate: today,
        eventType: 'CHECK_IN',
        occurredAt: new Date(`${targetDate}T08:00:00.000+07:00`),
        isValid: true
      });

      // 4. Call HTTP recalculate as Tenant A
      const resRecalc = await request(app1d)
        .post(`/api/v1/timekeeping/recalculate/${targetDate}`)
        .set('Authorization', `Bearer ${tokenPrincipalA}`);
      expect(resRecalc.status).toBe(200);
      expect(resRecalc.body.message).toContain('tính lại');
      expect(Array.isArray(resRecalc.body.data)).toBe(true);

      // Verify response data contains only Tenant A records
      resRecalc.body.data.forEach((rec) => {
        expect(String(rec.tenantId)).toBe(String(tenantA._id));
        expect(String(rec.userId)).not.toBe(String(teacherB._id));
        expect(String(rec.userId)).not.toBe(String(teacherA2._id));
      });

      // Verify Tenant B queue item is completely untouched
      const updatedQueueB = await AttendanceRecalculationQueue.findById(queueB._id);
      expect(updatedQueueB.status).toBe('PENDING');
      expect(updatedQueueB.attempts).toBe(0);
      expect(updatedQueueB.lockedBy || null).toBeNull();

      // Verify legacy queue item is completely untouched
      const updatedLegacy = await AttendanceRecalculationQueue.findById(legacyQueue._id);
      expect(updatedLegacy.status).toBe('PENDING');
      expect(updatedLegacy.attempts).toBe(0);
      expect(updatedLegacy.lockedBy || null).toBeNull();
    });
  });

  // =========================================================================
  // NHÓM F: HỒI QUY PHASE 1B / 1C & GATING PHASE 1E
  // =========================================================================
  describe('Nhóm F: Hồi quy Phase 1B/1C & Cổng Phase 1E', () => {
    test('F.1 Classrooms & Students reads continue to work seamlessly in phase1d mode', async () => {
      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);

      const resClassrooms = await request(app1d)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resClassrooms.status).toBe(200);
      expect(Array.isArray(resClassrooms.body.data)).toBe(true);

      const resStudents = await request(app1d)
        .get('/api/v1/students')
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resStudents.status).toBe(200);
      expect(Array.isArray(resStudents.body.data)).toBe(true);
    });

    test('F.2 Student Attendance and Student Transfer continue to work in phase1d mode', async () => {
      const tokenTeacherA = generateSchoolUserToken(teacherA, tenantA);
      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);

      // Student Attendance (Teacher)
      const resAttendance = await request(app1d)
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${tokenTeacherA}`)
        .send({
          studentId: studentA1._id.toString(),
          classroomId: classroomA1._id.toString(),
          date: '2026-11-06',
          status: 'present'
        });
      expect([200, 201]).toContain(resAttendance.status);

      // Student Transfer (Admin)
      const resTransfer = await request(app1d)
        .post(`/api/v1/students/${studentA1._id}/transfer`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .set('Idempotency-Key', 'idem-test-key-phase1d5-transfer-001')
        .send({
          toClassroomId: classroomA2._id.toString(),
          reason: 'Chuyển lớp định kỳ'
        });
      expect(resTransfer.status).toBe(200);
    });

    test('F.3 Phase 1E business modules remain strictly gated at 501 (Not Implemented)', async () => {
      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);

      const phase1eModules = [
        '/finance',
        '/nutrition',
        '/procurement',
        '/chat',
        '/pickups'
      ];

      for (const mod of phase1eModules) {
        for (const prefix of ['/api/v1', '/api']) {
          const res = await request(app1d)
            .get(`${prefix}${mod}`)
            .set('Authorization', `Bearer ${tokenAdminA}`);
          expect(res.status).toBe(501);
          expect(res.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
        }
      }
    });

    test('F.4 Method/Path matrix verifies unapproved mutation endpoints outside allowlist remain strictly gated at 501', async () => {
      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);

      const unapprovedMutations = [
        { method: 'post', path: '/classrooms', body: { name: 'Lớp 1D Test' } },
        { method: 'delete', path: `/classrooms/${classroomA1._id}`, body: {} },
        { method: 'post', path: '/students', body: { fullName: 'Học sinh 1D Test' } },
        { method: 'delete', path: `/students/${studentA1._id}`, body: {} },
        { method: 'post', path: '/system/unknown', body: { foo: 'bar' } },
        { method: 'get', path: '/hr/unapproved-subpath', body: null },
        { method: 'get', path: '/timekeeping/kiosk/events', body: null }
      ];

      for (const item of unapprovedMutations) {
        for (const prefix of ['/api/v1', '/api']) {
          const req = request(app1d)[item.method](`${prefix}${item.path}`)
            .set('Authorization', `Bearer ${tokenAdminA}`);
          if (item.body) {
            req.send(item.body);
          }
          const res = await req;
          expect(res.status).toBe(501);
          expect(res.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
        }
      }
    });
  });
});
