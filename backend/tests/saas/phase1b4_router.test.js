process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';
process.env.PLATFORM_MFA_ENCRYPTION_KEY = 'mfa-encryption-key-for-phase1a-isolated-test-32bytes!';
process.env.SAAS_MODE = 'phase1b';
process.env.TENANT_FEATURE_READINESS = 'false';

jest.setTimeout(60000);

const mongoose = require('mongoose');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const createSaasApp = require('../../src/saas/createSaasApp');
const createApp = require('../../app'); // Legacy app
const testDbBootstrap = require('../../src/saas/testDbBootstrap');

const {
  generateSchoolUserToken,
  generatePlatformAdminToken,
  generateMfaChallengeToken,
  generateSupportAccessToken,
  getSigningSecret
} = require('../../src/saas/utils/saasJwt');
const { generateToken: generateLegacyToken } = require('../../src/utils/jwt');

const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const PlatformAdmin = require('../../src/models/zone1_system/PlatformAdmin');
const RevokedSession = require('../../src/models/zone1_system/RevokedSession');
const Classroom = require('../../src/models/zone3_school/Classroom');
const Student = require('../../src/models/zone3_school/Student');
const StudentTransferHistory = require('../../src/models/zone3_school/StudentTransferHistory');

const {
  getAllClassrooms,
  getClassroomById
} = require('../../src/controllers/classroomController');

let bootstrapInstance;
let mongoUri;
let saasApp;
let legacyApp;

let tenantA;
let tenantB;
let tenantSuspended;
let tenantTerminated;

let adminA, principalA, hrA, teacherA1, teacherA2, parentA1, inactiveUserA;
let adminB;
let userSuspended, userTerminated;
let legacyAdmin;
let platformAdmin;

let classroomA1, classroomA2;
let classroomB1;
let legacyClassroom;

let studentA1, studentA2;
let studentB1;
let legacyStudent;

let transferHistoryA1, transferHistoryB1;

beforeAll(async () => {
  bootstrapInstance = await testDbBootstrap.startTestDb({
    instanceOpts: [{ dbName: 'school_saas_phase1b4_test' }]
  });
  mongoUri = bootstrapInstance.uri;

  saasApp = createSaasApp({ mongoUri, connection: bootstrapInstance.connection, saasMode: 'phase1b' });
  legacyApp = createApp();
}, 60000);

afterAll(async () => {
  if (bootstrapInstance) {
    await bootstrapInstance.stop();
  }
}, 60000);

beforeEach(async () => {
  await Promise.all([
    Tenant.deleteMany({}),
    User.deleteMany({}),
    PlatformAdmin.deleteMany({}),
    RevokedSession.deleteMany({}),
    Classroom.deleteMany({}),
    Student.deleteMany({}),
    StudentTransferHistory.deleteMany({})
  ]);

  const passwordHash = await bcrypt.hash('Password123!', 8);

  // 1. Tenants
  tenantA = await Tenant.create({
    code: 'TRUONG-A',
    name: 'Trường Mầm Non Ánh Dương A',
    status: 'active',
    authVersion: 0,
    config: { secretKeySetting: 'config_a' }
  });

  tenantB = await Tenant.create({
    code: 'TRUONG-B',
    name: 'Trường Mầm Non Bình Minh B',
    status: 'active',
    authVersion: 0,
    config: { secretKeySetting: 'config_b' }
  });

  tenantSuspended = await Tenant.create({
    code: 'TRUONG-SUSP',
    name: 'Trường Tạm Ngưng',
    status: 'suspended',
    authVersion: 0
  });

  tenantTerminated = await Tenant.create({
    code: 'TRUONG-TERM',
    name: 'Trường Chấm Dứt',
    status: 'terminated',
    authVersion: 0
  });

  // 2. Classrooms
  classroomA1 = await Classroom.create({
    name: 'Lớp Mầm 1A',
    schoolYear: '2026-2027',
    ageGroup: '3-4',
    maxSize: 25,
    status: 'active',
    tenantId: tenantA._id
  });

  classroomA2 = await Classroom.create({
    name: 'Lớp Chồi 1A',
    schoolYear: '2026-2027',
    ageGroup: '4-5',
    maxSize: 25,
    status: 'active',
    tenantId: tenantA._id
  });

  classroomB1 = await Classroom.create({
    name: 'Lớp Mầm 1B',
    schoolYear: '2026-2027',
    ageGroup: '3-4',
    maxSize: 25,
    status: 'active',
    tenantId: tenantB._id
  });

  legacyClassroom = await Classroom.create({
    name: 'Lớp Legacy',
    schoolYear: '2026-2027',
    ageGroup: '3-4',
    maxSize: 25,
    status: 'active',
    tenantId: null
  });

  // 3. Students (create preliminary to link parent)
  studentA1 = await Student.create({
    fullName: 'Nguyễn Văn An',
    studentCode: 'HS-2026-000001',
    birthDate: new Date('2021-01-15'),
    gender: 'male',
    status: 'enrolled',
    admissionDate: new Date('2026-09-01'),
    enrollmentDate: new Date('2026-09-01'),
    schoolYear: '2026-2027',
    classroomId: classroomA1._id,
    className: classroomA1.name,
    tenantId: tenantA._id,
    dailyReports: [
      {
        reportDate: new Date('2026-10-25'),
        activities: 'Học vẽ hoa',
        meals: 'Ăn hết suất',
        sleep: 'Ngủ 2 tiếng',
        health: 'Bình thường'
      }
    ]
  });

  studentA2 = await Student.create({
    fullName: 'Trần Thị Bình',
    studentCode: 'HS-2026-000002',
    birthDate: new Date('2021-05-20'),
    gender: 'female',
    status: 'enrolled',
    admissionDate: new Date('2026-09-01'),
    enrollmentDate: new Date('2026-09-01'),
    schoolYear: '2026-2027',
    classroomId: classroomA2._id,
    className: classroomA2.name,
    tenantId: tenantA._id
  });

  studentB1 = await Student.create({
    fullName: 'Nguyễn Văn An', // Same name as studentA1 to test search isolation
    studentCode: 'HS-2026-000003',
    birthDate: new Date('2021-02-10'),
    gender: 'male',
    status: 'enrolled',
    admissionDate: new Date('2026-09-01'),
    enrollmentDate: new Date('2026-09-01'),
    schoolYear: '2026-2027',
    classroomId: classroomB1._id,
    className: classroomB1.name,
    tenantId: tenantB._id
  });

  legacyStudent = await Student.create({
    fullName: 'Lê Legacy',
    studentCode: 'HS-2026-000004',
    birthDate: new Date('2021-03-05'),
    gender: 'male',
    status: 'enrolled',
    admissionDate: new Date('2026-09-01'),
    enrollmentDate: new Date('2026-09-01'),
    schoolYear: '2026-2027',
    classroomId: legacyClassroom._id,
    className: legacyClassroom.name,
    tenantId: null
  });

  // 4. Users
  adminA = await User.create({
    tenantId: tenantA._id,
    username: 'admin_a',
    passwordHash,
    role: 'admin',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Admin Trường A' }
  });

  principalA = await User.create({
    tenantId: tenantA._id,
    username: 'principal_a',
    passwordHash,
    role: 'principal',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Hiệu Trưởng A' }
  });

  hrA = await User.create({
    tenantId: tenantA._id,
    username: 'hr_a',
    passwordHash,
    role: 'hr',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Nhân Sự A' }
  });

  teacherA1 = await User.create({
    tenantId: tenantA._id,
    username: 'teacher_a1',
    passwordHash,
    role: 'teacher',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Giáo Viên A1' }
  });

  teacherA2 = await User.create({
    tenantId: tenantA._id,
    username: 'teacher_a2',
    passwordHash,
    role: 'teacher',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Giáo Viên A2' }
  });

  parentA1 = await User.create({
    tenantId: tenantA._id,
    username: 'parent_a1',
    passwordHash,
    role: 'parent',
    status: 'active',
    authVersion: 0,
    parentInfo: {
      studentIds: [studentA1._id]
    },
    profile: { fullName: 'Phụ Huynh A1' }
  });

  inactiveUserA = await User.create({
    tenantId: tenantA._id,
    username: 'inactive_a',
    passwordHash,
    role: 'teacher',
    status: 'inactive',
    authVersion: 0,
    profile: { fullName: 'Giáo Viên Đã Nghỉ' }
  });

  adminB = await User.create({
    tenantId: tenantB._id,
    username: 'admin_b',
    passwordHash,
    role: 'admin',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Admin Trường B' }
  });

  userSuspended = await User.create({
    tenantId: tenantSuspended._id,
    username: 'user_susp',
    passwordHash,
    role: 'admin',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'User Tạm Ngưng' }
  });

  userTerminated = await User.create({
    tenantId: tenantTerminated._id,
    username: 'user_term',
    passwordHash,
    role: 'admin',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'User Chấm Dứt' }
  });

  legacyAdmin = await User.create({
    tenantId: null,
    username: 'legacy_admin',
    passwordHash,
    role: 'admin',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Quản Trị Legacy' }
  });

  platformAdmin = await PlatformAdmin.create({
    username: 'platform_lead',
    passwordHash,
    role: 'platform_lead',
    totpSecret: 'mock-totp-secret',
    status: 'active',
    authVersion: 0
  });

  // Assign teachers to classrooms
  classroomA1.teachers = [{ teacherId: teacherA1._id, role: 'homeroom', teacherName: teacherA1.profile.fullName }];
  classroomA1.homeroomTeacherId = teacherA1._id;
  await classroomA1.save();

  classroomA2.teachers = [{ teacherId: teacherA2._id, role: 'homeroom', teacherName: teacherA2.profile.fullName }];
  classroomA2.homeroomTeacherId = teacherA2._id;
  await classroomA2.save();

  // 5. Transfer History
  transferHistoryA1 = await StudentTransferHistory.create({
    studentId: studentA1._id,
    studentCode: studentA1.studentCode,
    studentName: studentA1.fullName,
    fromClassroomId: classroomA1._id,
    fromClassName: classroomA1.name,
    toClassroomId: classroomA2._id,
    toClassName: classroomA2.name,
    schoolYear: '2026-2027',
    reason: 'Chuyển theo độ tuổi',
    transferredBy: adminA._id,
    transferredByName: adminA.profile.fullName,
    tenantId: tenantA._id,
    effectiveDate: new Date('2026-10-01')
  });

  transferHistoryB1 = await StudentTransferHistory.create({
    studentId: studentB1._id,
    studentCode: studentB1.studentCode,
    studentName: studentB1.fullName,
    fromClassroomId: classroomB1._id,
    fromClassName: classroomB1.name,
    toClassroomId: classroomB1._id,
    toClassName: classroomB1.name,
    schoolYear: '2026-2027',
    reason: 'Cập nhật nội bộ',
    transferredBy: adminB._id,
    transferredByName: adminB.profile.fullName,
    tenantId: tenantB._id,
    effectiveDate: new Date('2026-10-01')
  });
});

// =========================================================================
// TEST SUITES: TASK 1B.4 SAAS ROUTER
// =========================================================================

describe('Task 1B.4 - SaaS Router Integration & Multi-tenant Read Verification', () => {

  // =======================================================================
  // 1. Valid A/B/Legacy Isolation via HTTP & Aliases
  // =======================================================================
  describe('1. Valid A/B/Legacy Isolation and Aliases (/api/v1 and /api)', () => {
    test('1.1 Tenant A admin lists classrooms on /api/v1/classrooms and /api/classrooms: returns only Tenant A classrooms', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res1 = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(true);
      expect(res1.body.data.length).toBe(2);
      const names1 = res1.body.data.map((c) => c.name);
      expect(names1).toContain('Lớp Mầm 1A');
      expect(names1).toContain('Lớp Chồi 1A');
      expect(names1).not.toContain('Lớp Mầm 1B');
      expect(names1).not.toContain('Lớp Legacy');

      // Test /api alias
      const res2 = await request(saasApp)
        .get('/api/classrooms')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res2.status).toBe(200);
      expect(res2.body.data.length).toBe(2);
    });

    test('1.2 Tenant A admin gets Classroom A1 by ID via /api/v1 and /api: returns classroom detail', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res1 = await request(saasApp)
        .get(`/api/v1/classrooms/${classroomA1._id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(true);
      expect(res1.body.data._id).toBe(classroomA1._id.toString());
      expect(res1.body.data.name).toBe('Lớp Mầm 1A');

      const res2 = await request(saasApp)
        .get(`/api/classrooms/${classroomA1._id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res2.status).toBe(200);
      expect(res2.body.data.name).toBe('Lớp Mầm 1A');
    });

    test('1.3 Tenant A admin lists students on /api/v1/students and /api/students: returns only Tenant A students with pagination', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res1 = await request(saasApp)
        .get('/api/v1/students')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(true);
      expect(res1.body.data.length).toBe(2);
      expect(res1.body.pagination.total).toBe(2);
      expect(res1.body.pagination.totalPages).toBe(1);
      const codes = res1.body.data.map((s) => s.studentCode);
      expect(codes).toContain('HS-2026-000001');
      expect(codes).toContain('HS-2026-000002');
      expect(codes).not.toContain('HS-2026-000003');
      expect(codes).not.toContain('HS-2026-000004');

      // Alias
      const res2 = await request(saasApp)
        .get('/api/students')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res2.status).toBe(200);
      expect(res2.body.pagination.total).toBe(2);
    });

    test('1.4 Tenant A admin gets Student A1 by ID on /api/v1 and /api: returns student detail', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res1 = await request(saasApp)
        .get(`/api/v1/students/${studentA1._id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(true);
      expect(res1.body.data._id).toBe(studentA1._id.toString());
      expect(res1.body.data.fullName).toBe('Nguyễn Văn An');

      const res2 = await request(saasApp)
        .get(`/api/students/${studentA1._id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res2.status).toBe(200);
      expect(res2.body.data.fullName).toBe('Nguyễn Văn An');
    });

    test('1.5 Tenant A admin gets Student A1 daily reports on /api/v1 and /api: returns daily reports', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res1 = await request(saasApp)
        .get(`/api/v1/students/${studentA1._id}/daily-reports`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(true);
      expect(Array.isArray(res1.body.data)).toBe(true);
      expect(res1.body.data.length).toBe(1);
      expect(res1.body.data[0].activities).toBe('Học vẽ hoa');

      const res2 = await request(saasApp)
        .get(`/api/students/${studentA1._id}/daily-reports`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res2.status).toBe(200);
      expect(res2.body.data.length).toBe(1);
    });

    test('1.6 Tenant A admin gets Student A1 transfer history on /api/v1 and /api: returns transfer history', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res1 = await request(saasApp)
        .get(`/api/v1/students/${studentA1._id}/transfer-history`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(true);
      expect(Array.isArray(res1.body.data)).toBe(true);
      expect(res1.body.data.length).toBe(1);
      expect(res1.body.data[0].reason).toBe('Chuyển theo độ tuổi');

      const res2 = await request(saasApp)
        .get(`/api/students/${studentA1._id}/transfer-history`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res2.status).toBe(200);
      expect(res2.body.data.length).toBe(1);
    });

    test('1.7 Tenant B admin lists classrooms and students: returns only Tenant B data', async () => {
      const tokenB = generateSchoolUserToken(adminB, tenantB);

      const resClassrooms = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(resClassrooms.status).toBe(200);
      expect(resClassrooms.body.data.length).toBe(1);
      expect(resClassrooms.body.data[0].name).toBe('Lớp Mầm 1B');

      const resStudents = await request(saasApp)
        .get('/api/v1/students')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(resStudents.status).toBe(200);
      expect(resStudents.body.data.length).toBe(1);
      expect(resStudents.body.data[0].studentCode).toBe('HS-2026-000003');
    });

    test('1.8 Legacy App isolation: legacy caller sees only legacy data; legacy rejects SaaS token; SaaS rejects legacy token', async () => {
      const legacyToken = generateLegacyToken(legacyAdmin);
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      // Legacy token on legacy app -> sees legacy classroom
      const legacyRes = await request(legacyApp)
        .get('/api/classrooms')
        .set('Authorization', `Bearer ${legacyToken}`);
      expect(legacyRes.status).toBe(200);
      expect(legacyRes.body.data.length).toBe(1);
      expect(legacyRes.body.data[0].name).toBe('Lớp Legacy');

      // SaaS token on legacy app -> 401 rejected
      const rejectSaasOnLegacy = await request(legacyApp)
        .get('/api/classrooms')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(rejectSaasOnLegacy.status).toBe(401);

      // Legacy token on SaaS app -> 401 rejected (TOKEN_INVALID due to missing purpose)
      const rejectLegacyOnSaas = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${legacyToken}`);
      expect(rejectLegacyOnSaas.status).toBe(401);
      expect(rejectLegacyOnSaas.body.code).toBe('TOKEN_INVALID');
    });
  });

  // =======================================================================
  // 2. 404 Foreign IDs and Cross-Tenant Filtering
  // =======================================================================
  describe('2. 404 for Foreign IDs and Cross-Tenant Queries', () => {
    test('2.1 Tenant A accessing Tenant B classroom ID returns 404 Not Found on /api/v1 and /api', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res1 = await request(saasApp)
        .get(`/api/v1/classrooms/${classroomB1._id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res1.status).toBe(404);
      expect(res1.body.message).toContain('Không tìm thấy lớp học');

      const res2 = await request(saasApp)
        .get(`/api/classrooms/${classroomB1._id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res2.status).toBe(404);
    });

    test('2.2 Tenant A accessing Tenant B student ID returns 404 Not Found', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res1 = await request(saasApp)
        .get(`/api/v1/students/${studentB1._id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res1.status).toBe(404);
      expect(res1.body.message).toContain('Không tìm thấy học sinh');

      const res2 = await request(saasApp)
        .get(`/api/students/${studentB1._id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res2.status).toBe(404);
    });

    test('2.3 Tenant A accessing Tenant B student daily reports returns 404 Not Found', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res = await request(saasApp)
        .get(`/api/v1/students/${studentB1._id}/daily-reports`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Không tìm thấy học sinh');
    });

    test('2.4 Tenant A accessing Tenant B student transfer history returns 404 Not Found', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res = await request(saasApp)
        .get(`/api/v1/students/${studentB1._id}/transfer-history`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Không tìm thấy học sinh');
    });

    test('2.5 Tenant A accessing Legacy classroom/student returns 404 Not Found', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const resClass = await request(saasApp)
        .get(`/api/v1/classrooms/${legacyClassroom._id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resClass.status).toBe(404);

      const resStudent = await request(saasApp)
        .get(`/api/v1/students/${legacyStudent._id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resStudent.status).toBe(404);
    });

    test('2.6 Tenant A filtering students with foreign classroomId returns empty array with total=0', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res = await request(saasApp)
        .get(`/api/v1/students?classroomId=${classroomB1._id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
      expect(res.body.pagination.totalPages).toBe(0);
    });

    test('2.7 Search keyword isolation: searching "Nguyễn Văn An" returns only Tenant A record', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res = await request(saasApp)
        .get('/api/v1/students?search=Nguy%E1%BB%85n%20V%C4%83n%20An')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].studentCode).toBe('HS-2026-000001');
      expect(res.body.pagination.total).toBe(1);
    });
  });

  // =======================================================================
  // 3. Forged X-Tenant-Id Header Rejection / Anti-Spoofing
  // =======================================================================
  describe('3. Anti-Spoofing: Forged X-Tenant-Id Header is Strictly Ignored', () => {
    test('3.1 Forged X-Tenant-Id header on classroom list is ignored and returns caller tenant data only', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantB._id.toString());

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.data.map((c) => c.name)).toContain('Lớp Mầm 1A');
      expect(res.body.data.map((c) => c.name)).not.toContain('Lớp Mầm 1B');
    });

    test('3.2 Forged X-Tenant-Id header on student list is ignored', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res = await request(saasApp)
        .get('/api/v1/students')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantB._id.toString());

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.data.map((s) => s.studentCode)).not.toContain('HS-2026-000003');
    });

    test('3.3 Forged X-Tenant-Id with foreign classroom ID still returns 404', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res = await request(saasApp)
        .get(`/api/v1/classrooms/${classroomB1._id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantB._id.toString());

      expect(res.status).toBe(404);
    });

    test('3.4 Forged X-Tenant-Id with foreign student ID still returns 404', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res = await request(saasApp)
        .get(`/api/v1/students/${studentB1._id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantB._id.toString());

      expect(res.status).toBe(404);
    });
  });

  // =======================================================================
  // 4. Missing Authentication & Malformed Tokens
  // =======================================================================
  describe('4. Missing Authentication & Invalid Tokens (HTTP 401)', () => {
    test('4.1 Missing Authorization header on all 1B GET endpoints returns 401', async () => {
      const endpoints = [
        ['get', '/api/v1/classrooms'],
        ['get', '/api/classrooms'],
        ['get', `/api/v1/classrooms/${classroomA1._id}`],
        ['get', `/api/classrooms/${classroomA1._id}`],
        ['get', '/api/v1/students'],
        ['get', '/api/students'],
        ['get', `/api/v1/students/${studentA1._id}`],
        ['get', `/api/students/${studentA1._id}`],
        ['get', `/api/v1/students/${studentA1._id}/daily-reports`],
        ['get', `/api/students/${studentA1._id}/daily-reports`],
        ['get', `/api/v1/students/${studentA1._id}/transfer-history`],
        ['get', `/api/students/${studentA1._id}/transfer-history`]
      ];

      for (const [method, url] of endpoints) {
        const res = await request(saasApp)[method](url);
        expect(res.status).toBe(401);
        expect(res.body.message).toContain('Vui lòng cung cấp access token');
      }
    });

    test('4.2 Malformed or invalid signature token returns 401 TOKEN_INVALID', async () => {
      const res1 = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', 'Bearer invalid.token.structure');

      expect(res1.status).toBe(401);
      expect(res1.body.code).toBe('TOKEN_INVALID');

      // Wrong signature
      const fakeToken = jwt.sign(
        { sub: adminA._id.toString(), purpose: 'SCHOOL_USER_ACCESS' },
        'wrong-secret-that-is-at-least-32-chars-long-123456789'
      );
      const res2 = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${fakeToken}`);

      expect(res2.status).toBe(401);
      expect(res2.body.code).toBe('TOKEN_INVALID');
    });

    test('4.3 Expired token returns 401 TOKEN_INVALID', async () => {
      const expiredToken = generateSchoolUserToken(adminA, tenantA, '-1s');

      const res = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('TOKEN_INVALID');
    });
  });

  // =======================================================================
  // 5. Tenant State Validation (Invalid, Suspended, Revoked)
  // =======================================================================
  describe('5. Tenant State Validation (Suspended, Terminated, Revoked)', () => {
    test('5.1 Suspended tenant user token returns 403 TENANT_SUSPENDED', async () => {
      const tokenSusp = generateSchoolUserToken(userSuspended, tenantSuspended);

      const res = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${tokenSusp}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TENANT_SUSPENDED');
      expect(res.body.message).toContain('Trường học đã bị tạm ngưng hoạt động');
    });

    test('5.2 Terminated tenant user token returns 403 TENANT_SUSPENDED', async () => {
      const tokenTerm = generateSchoolUserToken(userTerminated, tenantTerminated);

      const res = await request(saasApp)
        .get('/api/v1/students')
        .set('Authorization', `Bearer ${tokenTerm}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TENANT_SUSPENDED');
    });

    test('5.3 Deleted/non-existent tenant returns 401 TENANT_NOT_FOUND', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);
      await Tenant.findByIdAndDelete(tenantA._id);

      const res = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('TENANT_NOT_FOUND');
    });

    test('5.4 Tenant authVersion incremented returns 403 TENANT_AUTH_REVOKED', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      // School-wide logout increments tenant authVersion
      await Tenant.findByIdAndUpdate(tenantA._id, { $inc: { authVersion: 1 } });

      const res = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TENANT_AUTH_REVOKED');
      expect(res.body.message).toContain('Phiên làm việc của trường đã bị thu hồi');
    });
  });

  // =======================================================================
  // 6. Session Revocation & Inactive User
  // =======================================================================
  describe('6. Session Revocation & Inactive User', () => {
    test('6.1 Revoked session (jti in RevokedSession) returns 401 SESSION_REVOKED', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);
      const decoded = jwt.decode(tokenA);

      await RevokedSession.create({
        jti: decoded.jti,
        userId: adminA._id,
        tenantId: tenantA._id,
        reason: 'User manual logout',
        expiresAt: new Date(Date.now() + 86400000)
      });

      const res = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('SESSION_REVOKED');
      expect(res.body.message).toContain('Phiên đăng nhập đã bị thu hồi');
    });

    test('6.2 User authVersion mismatch (password change / reset) returns 401 AUTH_VERSION_MISMATCH', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      await User.findByIdAndUpdate(adminA._id, { $inc: { authVersion: 1 } });

      const res = await request(saasApp)
        .get('/api/v1/students')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTH_VERSION_MISMATCH');
    });

    test('6.3 Inactive or locked user returns 401 USER_INACTIVE', async () => {
      const tokenInactive = generateSchoolUserToken(inactiveUserA, tenantA);

      const res = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${tokenInactive}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('USER_INACTIVE');
      expect(res.body.message).toContain('Tài khoản không tồn tại hoặc đã bị khóa');
    });
  });

  // =======================================================================
  // 7. Token Purpose Check
  // =======================================================================
  describe('7. Token Purpose Enforcement', () => {
    test('7.1 SUPPORT_ACCESS token returns 501 SUPPORT_ACCESS_NOT_IMPLEMENTED', async () => {
      const tokenSupport = generateSupportAccessToken(platformAdmin, tenantA);

      const res = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${tokenSupport}`);

      expect(res.status).toBe(501);
      expect(res.body.code).toBe('SUPPORT_ACCESS_NOT_IMPLEMENTED');
    });

    test('7.2 PLATFORM_ADMIN_ACCESS token returns 403 INVALID_TOKEN_PURPOSE', async () => {
      const tokenPlatform = generatePlatformAdminToken(platformAdmin);

      const res = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${tokenPlatform}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INVALID_TOKEN_PURPOSE');
    });

    test('7.3 PRE_AUTH_MFA_CHALLENGE token returns 403 INVALID_TOKEN_PURPOSE', async () => {
      const tokenMfa = generateMfaChallengeToken(platformAdmin);

      const res = await request(saasApp)
        .get('/api/v1/students')
        .set('Authorization', `Bearer ${tokenMfa}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INVALID_TOKEN_PURPOSE');
    });
  });

  // =======================================================================
  // 8. Fail-Closed Protection for Write Operations and Other Modules
  // =======================================================================
  describe('8. Fail-Closed Feature Gate (HTTP 501 for Writes & Unapproved Routes)', () => {
    test('8.1 Classroom write routes return 501 Not Implemented', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      // POST /api/v1/classrooms
      const resPost1 = await request(saasApp)
        .post('/api/v1/classrooms')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Lớp Mới' });
      expect(resPost1.status).toBe(501);
      expect(resPost1.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');

      // POST /api/classrooms alias
      const resPost2 = await request(saasApp)
        .post('/api/classrooms')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Lớp Mới' });
      expect(resPost2.status).toBe(501);

      // PUT /api/v1/classrooms/:id
      const resPut = await request(saasApp)
        .put(`/api/v1/classrooms/${classroomA1._id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Lớp Đổi Tên' });
      expect(resPut.status).toBe(501);

      // PUT /api/v1/classrooms/:id/homeroom-teacher
      const resPutTeacher = await request(saasApp)
        .put(`/api/v1/classrooms/${classroomA1._id}/homeroom-teacher`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ teacherId: teacherA2._id });
      expect(resPutTeacher.status).toBe(501);

      // DELETE /api/v1/classrooms/:id
      const resDel = await request(saasApp)
        .delete(`/api/v1/classrooms/${classroomA1._id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resDel.status).toBe(501);
    });

    test('8.2 Student write routes return 501 Not Implemented', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      // POST /api/v1/students
      const resPost = await request(saasApp)
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ fullName: 'Học Sinh Mới' });
      expect(resPost.status).toBe(501);
      expect(resPost.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');

      // PUT /api/v1/students/:id
      const resPut = await request(saasApp)
        .put(`/api/v1/students/${studentA1._id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ fullName: 'Tên Mới' });
      expect(resPut.status).toBe(501);

      // PATCH /api/v1/students/:id/status
      const resPatch = await request(saasApp)
        .patch(`/api/v1/students/${studentA1._id}/status`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ status: 'graduated' });
      expect(resPatch.status).toBe(501);

      // POST /api/v1/students/:id/transfer
      const resTransfer = await request(saasApp)
        .post(`/api/v1/students/${studentA1._id}/transfer`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ toClassroomId: classroomA2._id });
      expect(resTransfer.status).toBe(501);

      // DELETE /api/v1/students/:id
      const resDel = await request(saasApp)
        .delete(`/api/v1/students/${studentA1._id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resDel.status).toBe(501);

      // PUT /api/v1/students/:id/daily-reports (write care report)
      const resPutCare = await request(saasApp)
        .put(`/api/v1/students/${studentA1._id}/daily-reports`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ activities: 'New Activity' });
      expect(resPutCare.status).toBe(501);

      // POST /api/v1/students/excel/preview
      const resExcel = await request(saasApp)
        .post('/api/v1/students/excel/preview')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resExcel.status).toBe(501);
    });

    test('8.3 Unaudited GET endpoints return 501 Not Implemented', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      // /excel/template was NOT audited in 1B.3
      const resTemplate1 = await request(saasApp)
        .get('/api/v1/students/excel/template')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resTemplate1.status).toBe(501);
      expect(resTemplate1.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');

      const resTemplate2 = await request(saasApp)
        .get('/api/students/excel/template')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resTemplate2.status).toBe(501);
    });

    test('8.4 Other modules return 501 Not Implemented', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const otherRoutes = [
        '/api/v1/attendance',
        '/api/attendance',
        '/api/v1/finance',
        '/api/finance',
        '/api/v1/reports',
        '/api/reports',
        '/api/v1/timekeeping',
        '/api/v1/nutrition',
        '/api/v1/hr',
        '/api/v1/chat',
        '/api/v1/class-communication',
        '/api/v1/pickups',
        '/api/v1/parent-feedback',
        '/api/v1/guard'
      ];

      for (const route of otherRoutes) {
        const res = await request(saasApp)
          .get(route)
          .set('Authorization', `Bearer ${tokenA}`);
        expect(res.status).toBe(501);
        expect(res.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
      }
    });

    test('8.5 Reserved single-segment paths fall through to 501 on both aliases with valid auth and missing auth', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const reservedCases = [
        // Student endpoints
        { prefix: '/api/v1/students', segment: 'export' },
        { prefix: '/api/students', segment: 'export' },
        { prefix: '/api/v1/students', segment: 'template' },
        { prefix: '/api/students', segment: 'template' },
        { prefix: '/api/v1/students', segment: 'templates' },
        { prefix: '/api/students', segment: 'templates' },
        { prefix: '/api/v1/students', segment: 'import' },
        { prefix: '/api/v1/students', segment: 'active' },
        { prefix: '/api/v1/students', segment: 'stats' },
        // Classroom endpoints
        { prefix: '/api/v1/classrooms', segment: 'export' },
        { prefix: '/api/classrooms', segment: 'export' },
        { prefix: '/api/v1/classrooms', segment: 'template' },
        { prefix: '/api/classrooms', segment: 'template' },
        { prefix: '/api/v1/classrooms', segment: 'templates' },
        { prefix: '/api/students', segment: 'templates' },
        { prefix: '/api/v1/classrooms', segment: 'active' },
        { prefix: '/api/classrooms', segment: 'active' },
        { prefix: '/api/v1/classrooms', segment: 'import' }
      ];

      for (const { prefix, segment } of reservedCases) {
        const url = `${prefix}/${segment}`;

        // 1. With valid auth -> must fall through to 501 (NOT captured by /:id returning 400)
        const resAuth = await request(saasApp)
          .get(url)
          .set('Authorization', `Bearer ${tokenA}`);
        expect(resAuth.status).toBe(501);
        expect(resAuth.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');

        // 2. Without auth -> must fall through to 501 (NOT intercepted by schoolAuthMiddleware returning 401)
        const resNoAuth = await request(saasApp).get(url);
        expect(resNoAuth.status).toBe(501);
        expect(resNoAuth.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
      }
    });

    test('8.6 All writes (POST, PUT, PATCH, DELETE) fail closed with 501 on reserved and parameterized paths', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const writeEndpoints = [
        // Reserved endpoints
        { method: 'post', url: '/api/v1/students/export' },
        { method: 'post', url: '/api/students/export' },
        { method: 'post', url: '/api/v1/classrooms/export' },
        { method: 'post', url: '/api/classrooms/export' },
        { method: 'put', url: '/api/v1/students/export' },
        { method: 'delete', url: '/api/v1/classrooms/export' },
        // Parameterized endpoints with IDs
        { method: 'put', url: `/api/v1/students/${studentA1._id}` },
        { method: 'put', url: `/api/students/${studentA1._id}` },
        { method: 'delete', url: `/api/v1/students/${studentA1._id}` },
        { method: 'delete', url: `/api/students/${studentA1._id}` },
        { method: 'patch', url: `/api/v1/students/${studentA1._id}/status` },
        { method: 'patch', url: `/api/students/${studentA1._id}/status` },
        { method: 'put', url: `/api/v1/classrooms/${classroomA1._id}` },
        { method: 'put', url: `/api/classrooms/${classroomA1._id}` },
        { method: 'delete', url: `/api/v1/classrooms/${classroomA1._id}` },
        { method: 'delete', url: `/api/classrooms/${classroomA1._id}` },
        // Malformed IDs on write routes
        { method: 'put', url: '/api/v1/students/invalid-id' },
        { method: 'delete', url: '/api/v1/classrooms/invalid-id' }
      ];

      for (const { method, url } of writeEndpoints) {
        const res = await request(saasApp)[method](url)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ test: true });
        expect(res.status).toBe(501);
        expect(res.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
      }
    });
  });

  // =======================================================================
  // 9. Invalid ID 400 Bad Request Tests
  // =======================================================================
  describe('9. Invalid ID Format Handling (HTTP 400 Bad Request)', () => {
    test('9.1 Invalid ObjectId on getClassroomById returns 400', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res = await request(saasApp)
        .get('/api/v1/classrooms/not-a-valid-objectid')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('ID lớp học không hợp lệ');
    });

    test('9.2 Invalid ObjectId on getStudentById returns 400', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res = await request(saasApp)
        .get('/api/v1/students/not-a-valid-objectid')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('ID học sinh không hợp lệ');
    });

    test('9.3 Invalid ObjectId on getDailyReports returns 400', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res = await request(saasApp)
        .get('/api/v1/students/not-a-valid-objectid/daily-reports')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('ID học sinh không hợp lệ');
    });

    test('9.4 Invalid ObjectId on getStudentTransferHistory returns 400', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res = await request(saasApp)
        .get('/api/v1/students/not-a-valid-objectid/transfer-history')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('ID học sinh không hợp lệ');
    });

    test('9.5 Invalid classroomId query parameter on getAllStudents returns 400', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res = await request(saasApp)
        .get('/api/v1/students?classroomId=invalid-classroom-id')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('ID lớp học không hợp lệ');
    });

    test('9.6 Genuine malformed ID (/invalid-id) returns 400 Bad Request with auth, 401 without auth across both aliases', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      // 1. Students /invalid-id on /api/v1 and /api
      // Authenticated -> 400
      const resStudV1Auth = await request(saasApp)
        .get('/api/v1/students/invalid-id')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resStudV1Auth.status).toBe(400);
      expect(resStudV1Auth.body.message).toContain('ID học sinh không hợp lệ');

      const resStudAliasAuth = await request(saasApp)
        .get('/api/students/invalid-id')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resStudAliasAuth.status).toBe(400);
      expect(resStudAliasAuth.body.message).toContain('ID học sinh không hợp lệ');

      // Unauthenticated -> 401
      const resStudV1NoAuth = await request(saasApp).get('/api/v1/students/invalid-id');
      expect(resStudV1NoAuth.status).toBe(401);
      expect(resStudV1NoAuth.body.message).toContain('Vui lòng cung cấp access token');

      const resStudAliasNoAuth = await request(saasApp).get('/api/students/invalid-id');
      expect(resStudAliasNoAuth.status).toBe(401);
      expect(resStudAliasNoAuth.body.message).toContain('Vui lòng cung cấp access token');

      // 2. Classrooms /invalid-id on /api/v1 and /api
      // Authenticated -> 400
      const resClassV1Auth = await request(saasApp)
        .get('/api/v1/classrooms/invalid-id')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resClassV1Auth.status).toBe(400);
      expect(resClassV1Auth.body.message).toContain('ID lớp học không hợp lệ');

      const resClassAliasAuth = await request(saasApp)
        .get('/api/classrooms/invalid-id')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resClassAliasAuth.status).toBe(400);
      expect(resClassAliasAuth.body.message).toContain('ID lớp học không hợp lệ');

      // Unauthenticated -> 401
      const resClassV1NoAuth = await request(saasApp).get('/api/v1/classrooms/invalid-id');
      expect(resClassV1NoAuth.status).toBe(401);
      expect(resClassV1NoAuth.body.message).toContain('Vui lòng cung cấp access token');

      const resClassAliasNoAuth = await request(saasApp).get('/api/classrooms/invalid-id');
      expect(resClassAliasNoAuth.status).toBe(401);
      expect(resClassAliasNoAuth.body.message).toContain('Vui lòng cung cấp access token');
    });

    test('9.7 Valid ObjectId detail returns 200 OK with valid auth and 401 when missing auth across both aliases', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      // 1. Student detail with valid ObjectId
      const resStudV1 = await request(saasApp)
        .get(`/api/v1/students/${studentA1._id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resStudV1.status).toBe(200);
      expect(resStudV1.body.data._id).toBe(studentA1._id.toString());

      const resStudAlias = await request(saasApp)
        .get(`/api/students/${studentA1._id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resStudAlias.status).toBe(200);
      expect(resStudAlias.body.data._id).toBe(studentA1._id.toString());

      const resStudNoAuth = await request(saasApp).get(`/api/v1/students/${studentA1._id}`);
      expect(resStudNoAuth.status).toBe(401);

      // 2. Classroom detail with valid ObjectId
      const resClassV1 = await request(saasApp)
        .get(`/api/v1/classrooms/${classroomA1._id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resClassV1.status).toBe(200);
      expect(resClassV1.body.data._id).toBe(classroomA1._id.toString());

      const resClassAlias = await request(saasApp)
        .get(`/api/classrooms/${classroomA1._id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resClassAlias.status).toBe(200);
      expect(resClassAlias.body.data._id).toBe(classroomA1._id.toString());

      const resClassNoAuth = await request(saasApp).get(`/api/v1/classrooms/${classroomA1._id}`);
      expect(resClassNoAuth.status).toBe(401);
    });
  });

  // =======================================================================
  // 10. Missing req.user Controller Robustness (Fixing 1B.3 Low Finding)
  // =======================================================================
  describe('10. Controller Safety: Missing req.user fails closed with 401/403 (No 500)', () => {
    const mockRes = () => {
      const res = {
        statusCode: 200,
        body: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          this.body = data;
          return this;
        }
      };
      return res;
    };

    test('10.1 getAllClassrooms with missing req.user returns 403, never throws 500', async () => {
      const req = { user: null, query: {}, header: () => null };
      const res = mockRes();

      await getAllClassrooms(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toContain('Bạn không có quyền');
    });

    test('10.2 getClassroomById with missing req.user returns 403, never throws 500', async () => {
      const req = {
        user: null,
        params: { id: legacyClassroom._id.toString() },
        header: () => null,
        isLegacy: true
      };
      const res = mockRes();

      await getClassroomById(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toContain('Bạn không có quyền');
    });
  });

  // =======================================================================
  // 11. Role-based Scoping within Tenant
  // =======================================================================
  describe('11. Role-based Scoping within Tenant', () => {
    test('11.1 Teacher token sees only assigned classroom; 403 on other classroom in same tenant', async () => {
      const teacherToken = generateSchoolUserToken(teacherA1, tenantA);

      // List classrooms
      const resList = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${teacherToken}`);

      expect(resList.status).toBe(200);
      expect(resList.body.data.length).toBe(1);
      expect(resList.body.data[0].name).toBe('Lớp Mầm 1A');

      // Access assigned classroom
      const resAssigned = await request(saasApp)
        .get(`/api/v1/classrooms/${classroomA1._id}`)
        .set('Authorization', `Bearer ${teacherToken}`);
      expect(resAssigned.status).toBe(200);

      // Access unassigned classroom -> 403
      const resUnassigned = await request(saasApp)
        .get(`/api/v1/classrooms/${classroomA2._id}`)
        .set('Authorization', `Bearer ${teacherToken}`);
      expect(resUnassigned.status).toBe(403);
    });

    test('11.2 Teacher token sees only students in assigned classroom', async () => {
      const teacherToken = generateSchoolUserToken(teacherA1, tenantA);

      const res = await request(saasApp)
        .get('/api/v1/students')
        .set('Authorization', `Bearer ${teacherToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].studentCode).toBe('HS-2026-000001');

      // Detail of student in other classroom -> 403
      const resOtherStudent = await request(saasApp)
        .get(`/api/v1/students/${studentA2._id}`)
        .set('Authorization', `Bearer ${teacherToken}`);
      expect(resOtherStudent.status).toBe(403);
    });

    test('11.3 Parent token is forbidden from viewing classrooms (403)', async () => {
      const parentToken = generateSchoolUserToken(parentA1, tenantA);

      const resList = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${parentToken}`);
      expect(resList.status).toBe(403);

      const resDetail = await request(saasApp)
        .get(`/api/v1/classrooms/${classroomA1._id}`)
        .set('Authorization', `Bearer ${parentToken}`);
      expect(resDetail.status).toBe(403);
    });

    test('11.4 Parent token sees only linked child; forbidden from accessing other students (403)', async () => {
      const parentToken = generateSchoolUserToken(parentA1, tenantA);

      // List students
      const resList = await request(saasApp)
        .get('/api/v1/students')
        .set('Authorization', `Bearer ${parentToken}`);

      expect(resList.status).toBe(200);
      expect(resList.body.data.length).toBe(1);
      expect(resList.body.data[0]._id).toBe(studentA1._id.toString());

      // Linked child detail -> 200
      const resChild = await request(saasApp)
        .get(`/api/v1/students/${studentA1._id}`)
        .set('Authorization', `Bearer ${parentToken}`);
      expect(resChild.status).toBe(200);

      // Linked child daily reports -> 200
      const resChildCare = await request(saasApp)
        .get(`/api/v1/students/${studentA1._id}/daily-reports`)
        .set('Authorization', `Bearer ${parentToken}`);
      expect(resChildCare.status).toBe(200);

      // Linked child transfer history -> 200
      const resChildHist = await request(saasApp)
        .get(`/api/v1/students/${studentA1._id}/transfer-history`)
        .set('Authorization', `Bearer ${parentToken}`);
      expect(resChildHist.status).toBe(200);

      // Unlinked student detail -> 403
      const resOther = await request(saasApp)
        .get(`/api/v1/students/${studentA2._id}`)
        .set('Authorization', `Bearer ${parentToken}`);
      expect(resOther.status).toBe(403);
    });
  });

});
