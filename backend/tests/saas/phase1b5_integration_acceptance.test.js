/**
 * Task 1B.5: FINAL INTEGRATION ACCEPTANCE TEST SUITE
 * Multi-Tenant Read Isolation & Router Gate Acceptance
 *
 * Verifies the end-to-end multi-tenant security architecture across real
 * createSaasApp and legacy createApp on MongoMemoryReplSet:
 * 1. Name collisions across Tenant A, Tenant B, and Legacy (classrooms & students)
 * 2. List, search, count, and pagination invariant isolation
 * 3. Foreign ID traversal boundary (strict 404 invisible)
 * 4. Foreign classroomId query filter scoping
 * 5. Teacher assignment and parent linking boundary integrity
 * 6. Nested care reports and transfer history (including wrong tenant history isolation)
 * 7. Public registration endpoint boundary (Legacy app vs createSaasApp)
 * 8. Anti-tamper & context spoofing (forged headers, query params)
 * 9. Tenant lifecycle enforcement (suspended & terminated tenants)
 * 10. Session revocation, JTI blacklist, and authVersion mismatch
 * 11. Token purpose boundary enforcement
 * 12. Complete route exposure surface: approved GETs 200, unapproved GETs & all writes fail-closed (501)
 * 13. Zero read side-effects & document immutability verification
 */

process.env.JWT_SECRET = 'super-secret-jwt-key-for-testing-purposes-min-32-chars-long';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';
process.env.SAAS_MODE = 'phase1b';

const request = require('supertest');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const testDbBootstrap = require('../../src/saas/testDbBootstrap');
const createSaasApp = require('../../src/saas/createSaasApp');
const createApp = require('../../app');

const { generateSchoolUserToken } = require('../../src/saas/utils/saasJwt');
const { generateToken } = require('../../src/utils/jwt');

const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const PlatformAdmin = require('../../src/models/zone1_system/PlatformAdmin');
const RevokedSession = require('../../src/models/zone1_system/RevokedSession');
const Classroom = require('../../src/models/zone3_school/Classroom');
const Student = require('../../src/models/zone3_school/Student');
const StudentTransferHistory = require('../../src/models/zone3_school/StudentTransferHistory');
const AuditLog = require('../../src/models/zone1_system/AuditLog');

let bootstrapInstance;
let mongoUri;
let saasApp;
let legacyApp;

// Entities
let tenantA, tenantB, tenantSuspended, tenantTerminated;
let adminA, principalA, hrA, teacherA1, teacherA2, parentA1, parentA2, guardA, inactiveUserA;
let adminB, teacherB1, parentB1;
let legacyAdmin, legacyTeacher, legacyParent;
let userSuspended, userTerminated;

let classroomA1, classroomA2;
let classroomB1, classroomB2;
let legacyClassroom1, legacyClassroom2;

let studentA1, studentA2, studentA3;
let studentB1, studentB2, studentB3;
let legacyStudent1, legacyStudent2, legacyStudent3;

let transferHistoryA1_valid;
let transferHistoryA1_wrongTenantB;
let transferHistoryA1_wrongTenantLegacy;
let transferHistoryB1_valid;
let transferHistoryLegacy1_valid;

beforeAll(async () => {
  bootstrapInstance = await testDbBootstrap.startTestDb({
    instanceOpts: [{ dbName: 'school_saas_phase1b5_acceptance_test' }]
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
    StudentTransferHistory.deleteMany({}),
    AuditLog.deleteMany({})
  ]);

  const passwordHash = await bcrypt.hash('Password123!', 8);

  // 1. Tenants
  tenantA = await Tenant.create({
    code: 'TRUONG-A',
    name: 'Trường Mầm Non Ánh Dương A',
    status: 'active',
    authVersion: 0
  });

  tenantB = await Tenant.create({
    code: 'TRUONG-B',
    name: 'Trường Mầm Non Ánh Dương B',
    status: 'active',
    authVersion: 0
  });

  tenantSuspended = await Tenant.create({
    code: 'TRUONG-SUSPENDED',
    name: 'Trường Mầm Non Tạm Ngưng',
    status: 'suspended',
    authVersion: 0
  });

  tenantTerminated = await Tenant.create({
    code: 'TRUONG-TERMINATED',
    name: 'Trường Mầm Non Đã Hủy',
    status: 'terminated',
    authVersion: 0
  });

  // 2. Classrooms (EXACT SAME NAMES across Tenant A, Tenant B, and Legacy)
  classroomA1 = await Classroom.create({
    name: 'Lớp Mầm 1',
    fullName: 'Lớp Mầm 1 - Cơ Sở A',
    ageGroup: '3-4',
    maxSize: 25,
    schoolYear: '2026-2027',
    status: 'active',
    tenantId: tenantA._id
  });

  classroomA2 = await Classroom.create({
    name: 'Lớp Chồi 1',
    fullName: 'Lớp Chồi 1 - Cơ Sở A',
    ageGroup: '4-5',
    maxSize: 30,
    schoolYear: '2026-2027',
    status: 'active',
    tenantId: tenantA._id
  });

  classroomB1 = await Classroom.create({
    name: 'Lớp Mầm 1', // Same name as classroomA1
    fullName: 'Lớp Mầm 1 - Cơ Sở B',
    ageGroup: '3-4',
    maxSize: 25,
    schoolYear: '2026-2027',
    status: 'active',
    tenantId: tenantB._id
  });

  classroomB2 = await Classroom.create({
    name: 'Lớp Chồi 1', // Same name as classroomA2
    fullName: 'Lớp Chồi 1 - Cơ Sở B',
    ageGroup: '4-5',
    maxSize: 30,
    schoolYear: '2026-2027',
    status: 'active',
    tenantId: tenantB._id
  });

  legacyClassroom1 = await Classroom.create({
    name: 'Lớp Mầm 1', // Same name as classroomA1 and classroomB1
    fullName: 'Lớp Mầm 1 - Cơ Sở Đơn Trường',
    ageGroup: '3-4',
    maxSize: 25,
    schoolYear: '2026-2027',
    status: 'active',
    tenantId: null
  });

  legacyClassroom2 = await Classroom.create({
    name: 'Lớp Chồi 1', // Same name as classroomA2 and classroomB2
    fullName: 'Lớp Chồi 1 - Cơ Sở Đơn Trường',
    ageGroup: '4-5',
    maxSize: 30,
    schoolYear: '2026-2027',
    status: 'active',
    tenantId: null
  });

  // 3. Students (EXACT SAME NAMES across Tenant A, Tenant B, and Legacy)
  studentA1 = await Student.create({
    fullName: 'Nguyễn Văn An',
    studentCode: 'HS-2026-000001',
    birthDate: new Date('2022-03-15'),
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
        reportDate: new Date('2026-10-20'),
        activities: 'Học hát bé ngoan',
        meals: 'Ăn hết bát cháo',
        sleep: 'Ngủ ngoan 120 phút',
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

  studentA3 = await Student.create({
    fullName: 'Lê Hoàng Long',
    studentCode: 'HS-2026-000003',
    birthDate: new Date('2022-08-10'),
    gender: 'male',
    status: 'enrolled',
    admissionDate: new Date('2026-09-01'),
    enrollmentDate: new Date('2026-09-01'),
    schoolYear: '2026-2027',
    classroomId: classroomA1._id,
    className: classroomA1.name,
    tenantId: tenantA._id
  });

  studentB1 = await Student.create({
    fullName: 'Nguyễn Văn An', // Same name as studentA1
    studentCode: 'HS-2026-000004',
    birthDate: new Date('2022-03-15'),
    gender: 'male',
    status: 'enrolled',
    admissionDate: new Date('2026-09-01'),
    enrollmentDate: new Date('2026-09-01'),
    schoolYear: '2026-2027',
    classroomId: classroomB1._id,
    className: classroomB1.name,
    tenantId: tenantB._id,
    dailyReports: [
      {
        reportDate: new Date('2026-10-20'),
        activities: 'Học vẽ hoa cúc',
        meals: 'Ăn 1/2 cơm',
        sleep: 'Ngủ 90 phút',
        health: 'Hơi ho nhẹ'
      }
    ]
  });

  studentB2 = await Student.create({
    fullName: 'Trần Thị Bình', // Same name as studentA2
    studentCode: 'HS-2026-000005',
    birthDate: new Date('2021-05-20'),
    gender: 'female',
    status: 'enrolled',
    admissionDate: new Date('2026-09-01'),
    enrollmentDate: new Date('2026-09-01'),
    schoolYear: '2026-2027',
    classroomId: classroomB2._id,
    className: classroomB2.name,
    tenantId: tenantB._id
  });

  studentB3 = await Student.create({
    fullName: 'Lê Hoàng Long', // Same name as studentA3
    studentCode: 'HS-2026-000006',
    birthDate: new Date('2022-08-10'),
    gender: 'male',
    status: 'enrolled',
    admissionDate: new Date('2026-09-01'),
    enrollmentDate: new Date('2026-09-01'),
    schoolYear: '2026-2027',
    classroomId: classroomB1._id,
    className: classroomB1.name,
    tenantId: tenantB._id
  });

  legacyStudent1 = await Student.create({
    fullName: 'Nguyễn Văn An', // Same name as studentA1 and studentB1
    studentCode: 'HS-2026-000007',
    birthDate: new Date('2022-03-15'),
    gender: 'male',
    status: 'enrolled',
    admissionDate: new Date('2026-09-01'),
    enrollmentDate: new Date('2026-09-01'),
    schoolYear: '2026-2027',
    classroomId: legacyClassroom1._id,
    className: legacyClassroom1.name,
    tenantId: null,
    dailyReports: [
      {
        reportDate: new Date('2026-10-20'),
        activities: 'Học múa quạt',
        meals: 'Ăn giỏi',
        sleep: 'Ngủ 2 tiếng',
        health: 'Khỏe mạnh'
      }
    ]
  });

  legacyStudent2 = await Student.create({
    fullName: 'Trần Thị Bình',
    studentCode: 'HS-2026-000008',
    birthDate: new Date('2021-05-20'),
    gender: 'female',
    status: 'enrolled',
    admissionDate: new Date('2026-09-01'),
    enrollmentDate: new Date('2026-09-01'),
    schoolYear: '2026-2027',
    classroomId: legacyClassroom2._id,
    className: legacyClassroom2.name,
    tenantId: null
  });

  legacyStudent3 = await Student.create({
    fullName: 'Lê Hoàng Long',
    studentCode: 'HS-2026-000009',
    birthDate: new Date('2022-08-10'),
    gender: 'male',
    status: 'enrolled',
    admissionDate: new Date('2026-09-01'),
    enrollmentDate: new Date('2026-09-01'),
    schoolYear: '2026-2027',
    classroomId: legacyClassroom1._id,
    className: legacyClassroom1.name,
    tenantId: null
  });

  // 4. Users (Tenant A)
  adminA = await User.create({
    tenantId: tenantA._id,
    username: 'admin_a',
    passwordHash,
    role: 'admin',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Quản trị viên Trường A' }
  });

  principalA = await User.create({
    tenantId: tenantA._id,
    username: 'principal_a',
    passwordHash,
    role: 'principal',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Hiệu trưởng Trường A' }
  });

  hrA = await User.create({
    tenantId: tenantA._id,
    username: 'hr_a',
    passwordHash,
    role: 'hr',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Nhân sự Trường A' }
  });

  teacherA1 = await User.create({
    tenantId: tenantA._id,
    username: 'teacher_a1',
    passwordHash,
    role: 'teacher',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Giáo viên A1' }
  });

  teacherA2 = await User.create({
    tenantId: tenantA._id,
    username: 'teacher_a2',
    passwordHash,
    role: 'teacher',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Giáo viên A2' }
  });

  parentA1 = await User.create({
    tenantId: tenantA._id,
    username: 'parent_a1',
    passwordHash,
    role: 'parent',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Phụ huynh A1' },
    parentInfo: {
      studentIds: [studentA1._id]
    }
  });

  parentA2 = await User.create({
    tenantId: tenantA._id,
    username: 'parent_a2',
    passwordHash,
    role: 'parent',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Phụ huynh A2' },
    parentInfo: {
      studentIds: [studentA2._id]
    }
  });

  guardA = await User.create({
    tenantId: tenantA._id,
    username: 'guard_a',
    passwordHash,
    role: 'guard',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Bảo vệ A' }
  });

  inactiveUserA = await User.create({
    tenantId: tenantA._id,
    username: 'inactive_a',
    passwordHash,
    role: 'teacher',
    status: 'inactive',
    authVersion: 0,
    profile: { fullName: 'Giáo viên đã nghỉ việc' }
  });

  // Assign teachers to classrooms in Tenant A
  classroomA1.homeroomTeacherId = teacherA1._id;
  await classroomA1.save();

  classroomA2.homeroomTeacherId = teacherA2._id;
  await classroomA2.save();

  // 5. Users (Tenant B)
  adminB = await User.create({
    tenantId: tenantB._id,
    username: 'admin_b',
    passwordHash,
    role: 'admin',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Quản trị viên Trường B' }
  });

  teacherB1 = await User.create({
    tenantId: tenantB._id,
    username: 'teacher_b1',
    passwordHash,
    role: 'teacher',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Giáo viên B1' }
  });

  parentB1 = await User.create({
    tenantId: tenantB._id,
    username: 'parent_b1',
    passwordHash,
    role: 'parent',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Phụ huynh B1' },
    parentInfo: {
      studentIds: [studentB1._id]
    }
  });

  classroomB1.homeroomTeacherId = teacherB1._id;
  await classroomB1.save();

  // 6. Users (Legacy)
  legacyAdmin = await User.create({
    username: 'legacy_admin',
    passwordHash,
    role: 'admin',
    status: 'active',
    authVersion: 0,
    tenantId: null,
    profile: { fullName: 'Quản trị viên Legacy' }
  });

  legacyTeacher = await User.create({
    username: 'legacy_teacher',
    passwordHash,
    role: 'teacher',
    status: 'active',
    authVersion: 0,
    tenantId: null,
    profile: { fullName: 'Giáo viên Legacy' }
  });

  legacyParent = await User.create({
    username: 'legacy_parent',
    passwordHash,
    role: 'parent',
    status: 'active',
    authVersion: 0,
    tenantId: null,
    profile: { fullName: 'Phụ huynh Legacy' },
    parentInfo: {
      studentIds: [legacyStudent1._id]
    }
  });

  legacyClassroom1.homeroomTeacherId = legacyTeacher._id;
  await legacyClassroom1.save();

  // 7. Users in Suspended & Terminated Tenants
  userSuspended = await User.create({
    tenantId: tenantSuspended._id,
    username: 'user_suspended',
    passwordHash,
    role: 'admin',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Admin Trường Suspended' }
  });

  userTerminated = await User.create({
    tenantId: tenantTerminated._id,
    username: 'user_terminated',
    passwordHash,
    role: 'admin',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Admin Trường Terminated' }
  });

  // 8. Student Transfer History Records (Including Wrong Tenant History Injection)
  // Legitimate transfer in Tenant A for studentA1
  transferHistoryA1_valid = await StudentTransferHistory.create({
    studentId: studentA1._id,
    studentCode: studentA1.studentCode,
    studentName: studentA1.fullName,
    fromClassroomId: classroomA1._id,
    fromClassName: classroomA1.name,
    toClassroomId: classroomA2._id,
    toClassName: classroomA2.name,
    schoolYear: '2026-2027',
    effectiveDate: new Date('2026-10-01'),
    reason: 'Chuyển lớp chính đáng trong Trường A',
    tenantId: tenantA._id,
    transferredBy: adminA._id,
    transferredByName: 'Admin A'
  });

  // Corrupted / Wrong Tenant History Record #1: points to studentA1 but tagged with Tenant B's tenantId
  transferHistoryA1_wrongTenantB = await StudentTransferHistory.create({
    studentId: studentA1._id,
    studentCode: studentA1.studentCode,
    studentName: studentA1.fullName,
    fromClassroomId: classroomB1._id,
    fromClassName: classroomB1.name,
    toClassroomId: classroomB2._id,
    toClassName: classroomB2.name,
    schoolYear: '2026-2027',
    effectiveDate: new Date('2026-10-05'),
    reason: 'Lịch sử sai tenant B tiêm nhiễm',
    tenantId: tenantB._id,
    transferredBy: adminB._id,
    transferredByName: 'Admin B'
  });

  // Corrupted / Wrong Tenant History Record #2: points to studentA1 but tagged with tenantId: null (legacy)
  transferHistoryA1_wrongTenantLegacy = await StudentTransferHistory.create({
    studentId: studentA1._id,
    studentCode: studentA1.studentCode,
    studentName: studentA1.fullName,
    fromClassroomId: legacyClassroom1._id,
    fromClassName: legacyClassroom1.name,
    toClassroomId: legacyClassroom2._id,
    toClassName: legacyClassroom2.name,
    schoolYear: '2026-2027',
    effectiveDate: new Date('2026-10-10'),
    reason: 'Lịch sử sai tenant legacy tiêm nhiễm',
    tenantId: null,
    transferredBy: legacyAdmin._id,
    transferredByName: 'Legacy Admin'
  });

  // Legitimate transfer in Tenant B for studentB1
  transferHistoryB1_valid = await StudentTransferHistory.create({
    studentId: studentB1._id,
    studentCode: studentB1.studentCode,
    studentName: studentB1.fullName,
    fromClassroomId: classroomB1._id,
    fromClassName: classroomB1.name,
    toClassroomId: classroomB2._id,
    toClassName: classroomB2.name,
    schoolYear: '2026-2027',
    effectiveDate: new Date('2026-10-02'),
    reason: 'Chuyển lớp chính đáng trong Trường B',
    tenantId: tenantB._id,
    transferredBy: adminB._id,
    transferredByName: 'Admin B'
  });

  // Legitimate transfer in Legacy for legacyStudent1
  transferHistoryLegacy1_valid = await StudentTransferHistory.create({
    studentId: legacyStudent1._id,
    studentCode: legacyStudent1.studentCode,
    studentName: legacyStudent1.fullName,
    fromClassroomId: legacyClassroom1._id,
    fromClassName: legacyClassroom1.name,
    toClassroomId: legacyClassroom2._id,
    toClassName: legacyClassroom2.name,
    schoolYear: '2026-2027',
    effectiveDate: new Date('2026-10-03'),
    reason: 'Chuyển lớp hợp lệ đơn trường',
    tenantId: null,
    transferredBy: legacyAdmin._id,
    transferredByName: 'Legacy Admin'
  });
});

describe('Task 1B.5: Final Integration Acceptance Test Suite', () => {

  // ---------------------------------------------------------------------------
  // Suite 1: Name Collisions across Tenant A, Tenant B, and Legacy
  // ---------------------------------------------------------------------------
  describe('[ACCEPTANCE-1B5-01] Identity & Cross-Tenant Name Collision Isolation', () => {
    it('isolates classroom list when Tenant A, Tenant B, and Legacy share identical classroom names', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);
      const tokenB = generateSchoolUserToken(adminB, tenantB);
      const tokenLegacy = generateToken(legacyAdmin);

      // Tenant A via SaaS App
      const resA = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resA.status).toBe(200);
      expect(resA.body.data.length).toBe(2);
      expect(resA.body.data.map(c => c._id)).toEqual(
        expect.arrayContaining([classroomA1._id.toString(), classroomA2._id.toString()])
      );
      expect(resA.body.data.some(c => c.fullName.includes('Cơ Sở B'))).toBe(false);
      expect(resA.body.data.some(c => c.fullName.includes('Đơn Trường'))).toBe(false);

      // Tenant B via SaaS App
      const resB = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${tokenB}`);
      expect(resB.status).toBe(200);
      expect(resB.body.data.length).toBe(2);
      expect(resB.body.data.map(c => c._id)).toEqual(
        expect.arrayContaining([classroomB1._id.toString(), classroomB2._id.toString()])
      );
      expect(resB.body.data.some(c => c.fullName.includes('Cơ Sở A'))).toBe(false);
      expect(resB.body.data.some(c => c.fullName.includes('Đơn Trường'))).toBe(false);

      // Legacy via Legacy App
      const resLegacy = await request(legacyApp)
        .get('/api/classrooms')
        .set('Authorization', `Bearer ${tokenLegacy}`);
      expect(resLegacy.status).toBe(200);
      expect(resLegacy.body.data.length).toBe(2);
      expect(resLegacy.body.data.map(c => c._id)).toEqual(
        expect.arrayContaining([legacyClassroom1._id.toString(), legacyClassroom2._id.toString()])
      );
      expect(resLegacy.body.data.some(c => c.fullName.includes('Cơ Sở A'))).toBe(false);
      expect(resLegacy.body.data.some(c => c.fullName.includes('Cơ Sở B'))).toBe(false);
    });

    it('isolates student search when identical full names ("Nguyễn Văn An") exist across all environments', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);
      const tokenB = generateSchoolUserToken(adminB, tenantB);
      const tokenLegacy = generateToken(legacyAdmin);

      // Search "Nguyễn Văn An" on Tenant A
      const resA = await request(saasApp)
        .get('/api/v1/students?search=Nguyễn Văn An')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resA.status).toBe(200);
      expect(resA.body.data.length).toBe(1);
      expect(resA.body.data[0]._id).toBe(studentA1._id.toString());
      expect(resA.body.data[0].studentCode).toBe('HS-2026-000001');
      expect(resA.body.pagination.total).toBe(1);

      // Search "Nguyễn Văn An" on Tenant B
      const resB = await request(saasApp)
        .get('/api/v1/students?search=Nguyễn Văn An')
        .set('Authorization', `Bearer ${tokenB}`);
      expect(resB.status).toBe(200);
      expect(resB.body.data.length).toBe(1);
      expect(resB.body.data[0]._id).toBe(studentB1._id.toString());
      expect(resB.body.data[0].studentCode).toBe('HS-2026-000004');
      expect(resB.body.pagination.total).toBe(1);

      // Search "Nguyễn Văn An" on Legacy App
      const resLegacy = await request(legacyApp)
        .get('/api/students?search=Nguyễn Văn An')
        .set('Authorization', `Bearer ${tokenLegacy}`);
      expect(resLegacy.status).toBe(200);
      expect(resLegacy.body.data.length).toBe(1);
      expect(resLegacy.body.data[0]._id).toBe(legacyStudent1._id.toString());
      expect(resLegacy.body.data[0].studentCode).toBe('HS-2026-000007');
      expect(resLegacy.body.pagination.total).toBe(1);
    });

    it('returns identical isolated results on /api alias on createSaasApp', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const resV1 = await request(saasApp)
        .get('/api/v1/students?search=Nguyễn Văn An')
        .set('Authorization', `Bearer ${tokenA}`);

      const resAlias = await request(saasApp)
        .get('/api/students?search=Nguyễn Văn An')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(resV1.status).toBe(200);
      expect(resAlias.status).toBe(200);
      expect(resV1.body.data).toEqual(resAlias.body.data);
      expect(resV1.body.pagination).toEqual(resAlias.body.pagination);
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 2: List, Search, Count, and Pagination Multi-Tenant Invariance
  // ---------------------------------------------------------------------------
  describe('[ACCEPTANCE-1B5-02] List, Search, Count, and Pagination Multi-Tenant Invariance', () => {
    it('guarantees accurate total count and pages strictly within tenant boundaries', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      // Total students in DB = 9 (3 in A, 3 in B, 3 in Legacy).
      // Tenant A must report total = 3, never 9.
      const res = await request(saasApp)
        .get('/api/v1/students?page=1&limit=2')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.pagination).toEqual({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2
      });

      // Page 2
      const resPage2 = await request(saasApp)
        .get('/api/v1/students?page=2&limit=2')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(resPage2.status).toBe(200);
      expect(resPage2.body.data.length).toBe(1);
      expect(resPage2.body.pagination).toEqual({
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2
      });

      // Ensure no item overlap between pages
      const page1Ids = res.body.data.map(s => s._id);
      const page2Ids = resPage2.body.data.map(s => s._id);
      expect(page1Ids).not.toContain(page2Ids[0]);
    });

    it('filters by status and schoolYear without leaking cross-tenant documents', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res = await request(saasApp)
        .get('/api/v1/students?status=enrolled&schoolYear=2026-2027')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.pagination.total).toBe(3);
      const studentAIds = [studentA1._id.toString(), studentA2._id.toString(), studentA3._id.toString()];
      for (const item of res.body.data) {
        expect(item.status).toBe('enrolled');
        expect(studentAIds).toContain(item._id);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 3: Foreign ID Traversal Boundary (Strict 404 Invisible)
  // ---------------------------------------------------------------------------
  describe('[ACCEPTANCE-1B5-03] Foreign ID Traversal Boundary (Strict 404 Invisible)', () => {
    it('returns 404 when Tenant A user requests a Student ID belonging to Tenant B', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res = await request(saasApp)
        .get(`/api/v1/students/${studentB1._id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy học sinh/i);
    });

    it('returns 404 when Tenant A user requests a Classroom ID belonging to Tenant B', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res = await request(saasApp)
        .get(`/api/v1/classrooms/${classroomB1._id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy lớp học/i);
    });

    it('returns 404 when Tenant A user requests a legacy student or classroom ID', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const resStudent = await request(saasApp)
        .get(`/api/v1/students/${legacyStudent1._id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resStudent.status).toBe(404);

      const resClassroom = await request(saasApp)
        .get(`/api/v1/classrooms/${legacyClassroom1._id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resClassroom.status).toBe(404);
    });

    it('returns 404 when Legacy user requests a SaaS student or classroom ID on legacyApp', async () => {
      const tokenLegacy = generateToken(legacyAdmin);

      const resStudent = await request(legacyApp)
        .get(`/api/students/${studentA1._id}`)
        .set('Authorization', `Bearer ${tokenLegacy}`);
      expect(resStudent.status).toBe(404);

      const resClassroom = await request(legacyApp)
        .get(`/api/classrooms/${classroomA1._id}`)
        .set('Authorization', `Bearer ${tokenLegacy}`);
      expect(resClassroom.status).toBe(404);
    });

    it('returns 400 when malformed ObjectID format is provided', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const resStudent = await request(saasApp)
        .get('/api/v1/students/malformed-not-an-object-id')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resStudent.status).toBe(400);

      const resClassroom = await request(saasApp)
        .get('/api/v1/classrooms/malformed-not-an-object-id')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resClassroom.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 4: Foreign classroomId Query Filter Scoping
  // ---------------------------------------------------------------------------
  describe('[ACCEPTANCE-1B5-04] Foreign classroomId Query Filter Scoping', () => {
    it('returns empty list and total: 0 when filtering students by a foreign classroom ID', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      // Filtering with Tenant B's classroom ID
      const resForeign = await request(saasApp)
        .get(`/api/v1/students?classroomId=${classroomB1._id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(resForeign.status).toBe(200);
      expect(resForeign.body.data).toEqual([]);
      expect(resForeign.body.pagination.total).toBe(0);
      expect(resForeign.body.pagination.totalPages).toBe(0);

      // Filtering with Legacy classroom ID
      const resLegacy = await request(saasApp)
        .get(`/api/v1/students?classroomId=${legacyClassroom1._id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(resLegacy.status).toBe(200);
      expect(resLegacy.body.data).toEqual([]);
      expect(resLegacy.body.pagination.total).toBe(0);
    });

    it('returns accurate filtered list when filtering by own tenant classroom ID', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      // Classroom A1 contains studentA1 and studentA3
      const resOwn = await request(saasApp)
        .get(`/api/v1/students?classroomId=${classroomA1._id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(resOwn.status).toBe(200);
      expect(resOwn.body.data.length).toBe(2);
      expect(resOwn.body.pagination.total).toBe(2);
      expect(resOwn.body.data.map(s => s._id)).toEqual(
        expect.arrayContaining([studentA1._id.toString(), studentA3._id.toString()])
      );
    });

    it('returns empty list on legacyApp when filtering by a SaaS classroom ID', async () => {
      const tokenLegacy = generateToken(legacyAdmin);

      const res = await request(legacyApp)
        .get(`/api/students?classroomId=${classroomA1._id}`)
        .set('Authorization', `Bearer ${tokenLegacy}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 5: Teacher Assignment & Parent Linking Boundary Integrity
  // ---------------------------------------------------------------------------
  describe('[ACCEPTANCE-1B5-05] Teacher Assignment & Parent Linking Boundary Integrity', () => {
    it('restricts teacher in Tenant A strictly to their assigned classroom and students', async () => {
      const tokenTeacherA1 = generateSchoolUserToken(teacherA1, tenantA);

      // Teacher A1 is homeroom for classroomA1 only
      const resClassrooms = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${tokenTeacherA1}`);
      expect(resClassrooms.status).toBe(200);
      expect(resClassrooms.body.data.length).toBe(1);
      expect(resClassrooms.body.data[0]._id).toBe(classroomA1._id.toString());

      // Teacher A1 student list: only students in classroomA1 (studentA1 and studentA3)
      const resStudents = await request(saasApp)
        .get('/api/v1/students')
        .set('Authorization', `Bearer ${tokenTeacherA1}`);
      expect(resStudents.status).toBe(200);
      expect(resStudents.body.data.length).toBe(2);
      expect(resStudents.body.data.map(s => s._id)).toEqual(
        expect.arrayContaining([studentA1._id.toString(), studentA3._id.toString()])
      );

      // Teacher A1 detail access to student in assigned class -> 200
      const resAssignedStudent = await request(saasApp)
        .get(`/api/v1/students/${studentA1._id}`)
        .set('Authorization', `Bearer ${tokenTeacherA1}`);
      expect(resAssignedStudent.status).toBe(200);

      // Teacher A1 detail access to student in unassigned class (classroomA2) -> 403
      const resUnassignedStudent = await request(saasApp)
        .get(`/api/v1/students/${studentA2._id}`)
        .set('Authorization', `Bearer ${tokenTeacherA1}`);
      expect(resUnassignedStudent.status).toBe(403);

      // Teacher A1 detail access to student in Tenant B -> 404 (invisible cross-tenant)
      const resForeignStudent = await request(saasApp)
        .get(`/api/v1/students/${studentB1._id}`)
        .set('Authorization', `Bearer ${tokenTeacherA1}`);
      expect(resForeignStudent.status).toBe(404);
    });

    it('restricts parent in Tenant A strictly to their linked student', async () => {
      const tokenParentA1 = generateSchoolUserToken(parentA1, tenantA);

      // Parent student list: returns ONLY linked studentA1
      const resList = await request(saasApp)
        .get('/api/v1/students')
        .set('Authorization', `Bearer ${tokenParentA1}`);
      expect(resList.status).toBe(200);
      expect(resList.body.data.length).toBe(1);
      expect(resList.body.data[0]._id).toBe(studentA1._id.toString());
      expect(resList.body.pagination.total).toBe(1);

      // Detail access to linked studentA1 -> 200
      const resDetailOwn = await request(saasApp)
        .get(`/api/v1/students/${studentA1._id}`)
        .set('Authorization', `Bearer ${tokenParentA1}`);
      expect(resDetailOwn.status).toBe(200);
      expect(resDetailOwn.body.data._id).toBe(studentA1._id.toString());

      // Detail access to unlinked studentA2 (same tenant) -> 403
      const resDetailUnlinked = await request(saasApp)
        .get(`/api/v1/students/${studentA2._id}`)
        .set('Authorization', `Bearer ${tokenParentA1}`);
      expect(resDetailUnlinked.status).toBe(403);

      // Detail access to foreign studentB1 (Tenant B) -> 404
      const resDetailForeign = await request(saasApp)
        .get(`/api/v1/students/${studentB1._id}`)
        .set('Authorization', `Bearer ${tokenParentA1}`);
      expect(resDetailForeign.status).toBe(404);

      // Parent attempt to list classrooms -> 403 Forbidden
      const resClassrooms = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${tokenParentA1}`);
      expect(resClassrooms.status).toBe(403);
    });

    it('prevents cross-tenant parent linkage bypass even if foreign student ID is in parentInfo', async () => {
      // Maliciously tamper parent's record to include studentB1._id
      const maliciousParent = await User.create({
        tenantId: tenantA._id,
        username: 'malicious_parent_a',
        passwordHash: await bcrypt.hash('Password123!', 8),
        role: 'parent',
        status: 'active',
        authVersion: 0,
        profile: { fullName: 'Phụ huynh gian lận' },
        parentInfo: {
          studentIds: [studentA1._id, studentB1._id] // studentB1 belongs to Tenant B!
        }
      });

      const tokenMalicious = generateSchoolUserToken(maliciousParent, tenantA);

      // Student list must NOT leak studentB1
      const resList = await request(saasApp)
        .get('/api/v1/students')
        .set('Authorization', `Bearer ${tokenMalicious}`);
      expect(resList.status).toBe(200);
      expect(resList.body.data.length).toBe(1);
      expect(resList.body.data[0]._id).toBe(studentA1._id.toString());
      expect(resList.body.data.some(s => s._id === studentB1._id.toString())).toBe(false);

      // Detail request to studentB1 must return 404
      const resDetail = await request(saasApp)
        .get(`/api/v1/students/${studentB1._id}`)
        .set('Authorization', `Bearer ${tokenMalicious}`);
      expect(resDetail.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 6: Nested Care Reports & Transfer History (Including Wrong Tenant History)
  // ---------------------------------------------------------------------------
  describe('[ACCEPTANCE-1B5-06] Nested Care Reports & Transfer History (Including Wrong Tenant History)', () => {
    it('isolates nested daily care reports across tenants and roles', async () => {
      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);
      const tokenTeacherA1 = generateSchoolUserToken(teacherA1, tenantA);
      const tokenTeacherA2 = generateSchoolUserToken(teacherA2, tenantA);
      const tokenParentA1 = generateSchoolUserToken(parentA1, tenantA);
      const tokenParentA2 = generateSchoolUserToken(parentA2, tenantA);
      const tokenAdminB = generateSchoolUserToken(adminB, tenantB);

      // Admin A reading studentA1 care report -> 200
      const resAdminA = await request(saasApp)
        .get(`/api/v1/students/${studentA1._id}/daily-reports`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(resAdminA.status).toBe(200);
      expect(resAdminA.body.data.length).toBe(1);
      expect(resAdminA.body.data[0].activities).toBe('Học hát bé ngoan');

      // Assigned Teacher A1 reading studentA1 care report -> 200
      const resTeacherA1 = await request(saasApp)
        .get(`/api/v1/students/${studentA1._id}/daily-reports`)
        .set('Authorization', `Bearer ${tokenTeacherA1}`);
      expect(resTeacherA1.status).toBe(200);
      expect(resTeacherA1.body.data.length).toBe(1);

      // Unassigned Teacher A2 reading studentA1 care report -> 403
      const resTeacherA2 = await request(saasApp)
        .get(`/api/v1/students/${studentA1._id}/daily-reports`)
        .set('Authorization', `Bearer ${tokenTeacherA2}`);
      expect(resTeacherA2.status).toBe(403);

      // Linked Parent A1 reading studentA1 care report -> 200
      const resParentA1 = await request(saasApp)
        .get(`/api/v1/students/${studentA1._id}/daily-reports`)
        .set('Authorization', `Bearer ${tokenParentA1}`);
      expect(resParentA1.status).toBe(200);
      expect(resParentA1.body.data.length).toBe(1);

      // Unlinked Parent A2 reading studentA1 care report -> 403
      const resParentA2 = await request(saasApp)
        .get(`/api/v1/students/${studentA1._id}/daily-reports`)
        .set('Authorization', `Bearer ${tokenParentA2}`);
      expect(resParentA2.status).toBe(403);

      // Admin B reading studentA1 care report -> 404 (foreign tenant student)
      const resAdminB = await request(saasApp)
        .get(`/api/v1/students/${studentA1._id}/daily-reports`)
        .set('Authorization', `Bearer ${tokenAdminB}`);
      expect(resAdminB.status).toBe(404);
    });

    it('strictly filters out wrong tenant transfer history records for a student', async () => {
      // In beforeEach, studentA1 has 3 transfer history records:
      // 1) transferHistoryA1_valid: tenantId = tenantA._id
      // 2) transferHistoryA1_wrongTenantB: tenantId = tenantB._id (corrupted / foreign tenant)
      // 3) transferHistoryA1_wrongTenantLegacy: tenantId = null (corrupted / legacy)

      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);
      const tokenParentA1 = generateSchoolUserToken(parentA1, tenantA);
      const tokenTeacherA1 = generateSchoolUserToken(teacherA1, tenantA);

      // Admin A queries studentA1 transfer history
      const resAdmin = await request(saasApp)
        .get(`/api/v1/students/${studentA1._id}/transfer-history`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(resAdmin.status).toBe(200);
      expect(resAdmin.body.data.length).toBe(1);
      expect(resAdmin.body.data[0]._id).toBe(transferHistoryA1_valid._id.toString());
      expect(resAdmin.body.data[0].reason).toBe('Chuyển lớp chính đáng trong Trường A');
      // Crucial: Ensure records with tenantB and legacy are NOT returned!
      const allReturnedIds = resAdmin.body.data.map(r => r._id);
      expect(allReturnedIds).not.toContain(transferHistoryA1_wrongTenantB._id.toString());
      expect(allReturnedIds).not.toContain(transferHistoryA1_wrongTenantLegacy._id.toString());

      // Parent A1 queries studentA1 transfer history (sanitized)
      const resParent = await request(saasApp)
        .get(`/api/v1/students/${studentA1._id}/transfer-history`)
        .set('Authorization', `Bearer ${tokenParentA1}`);

      expect(resParent.status).toBe(200);
      expect(resParent.body.data.length).toBe(1);
      expect(resParent.body.data[0]._id).toBe(transferHistoryA1_valid._id.toString());
      expect(resParent.body.data[0].transferredBy).toBeUndefined(); // Sanitized
      expect(resParent.body.data[0].transferredByName).toBeUndefined(); // Sanitized

      // Teacher A1 queries studentA1 transfer history (Teacher A1 is associated with classroomA1)
      const resTeacher = await request(saasApp)
        .get(`/api/v1/students/${studentA1._id}/transfer-history`)
        .set('Authorization', `Bearer ${tokenTeacherA1}`);

      expect(resTeacher.status).toBe(200);
      expect(resTeacher.body.data.length).toBe(1);
      expect(resTeacher.body.data[0]._id).toBe(transferHistoryA1_valid._id.toString());

      // Querying with foreign student ID -> 404
      const tokenAdminB = generateSchoolUserToken(adminB, tenantB);
      const resForeign = await request(saasApp)
        .get(`/api/v1/students/${studentA1._id}/transfer-history`)
        .set('Authorization', `Bearer ${tokenAdminB}`);
      expect(resForeign.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 7: Public Registration Gate Isolation (Locked 403 on both Legacy & SaaS)
  // ---------------------------------------------------------------------------
  describe('[ACCEPTANCE-1B5-07] Public Registration Gate Isolation (Legacy App vs createSaasApp)', () => {
    it('legacy GET /api/auth/registration-classrooms is locked down with 403 Forbidden', async () => {
      const res = await request(legacyApp)
        .get('/api/auth/registration-classrooms');

      expect(res.status).toBe(403);
      expect(res.body.data).toBeUndefined();
    });

    it('legacy POST /api/auth/register rejects anonymous registration with a SaaS classroom ID (403)', async () => {
      const payload = {
        username: 'new_parent_legacy',
        password: 'Password123!',
        profile: {
          fullName: 'Phụ huynh mới',
          phone: '0912345678',
          email: 'newparent@example.com'
        },
        parentInfo: {
          requestedClassroomId: classroomA1._id.toString(),
          registrationNote: 'Xin đăng ký cho cháu Nguyễn Văn An vào học'
        }
      };

      const res = await request(legacyApp)
        .post('/api/auth/register')
        .send(payload);

      expect(res.status).toBe(403);
    });

    it('legacy POST /api/auth/register also blocks anonymous registration for legacy classrooms (403)', async () => {
      const payload = {
        username: 'legit_parent_legacy',
        password: 'Password123!',
        profile: {
          fullName: 'Phụ huynh hợp lệ',
          phone: '0912345679',
          email: 'legitparent@example.com'
        },
        parentInfo: {
          requestedClassroomId: legacyClassroom1._id.toString(),
          registrationNote: 'Xin đăng ký cho cháu Bé Hợp Lệ vào học'
        }
      };

      const res = await request(legacyApp)
        .post('/api/auth/register')
        .send(payload);

      expect(res.status).toBe(403);
    });

    it('saasApp locks public registration endpoints fail-closed with 403/501', async () => {
      const resGetV1 = await request(saasApp)
        .get('/api/v1/auth/registration-classrooms');
      expect([403, 501]).toContain(resGetV1.status);

      const resPostV1 = await request(saasApp)
        .post('/api/v1/auth/register')
        .send({});
      expect([403, 501]).toContain(resPostV1.status);

      const resGetAlias = await request(saasApp)
        .get('/api/auth/registration-classrooms');
      expect([403, 501]).toContain(resGetAlias.status);

      const resPostAlias = await request(saasApp)
        .post('/api/auth/register')
        .send({});
      expect([403, 501]).toContain(resPostAlias.status);
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 8: Anti-Tamper & Context Spoofing (Forged Headers, Query Params)
  // ---------------------------------------------------------------------------
  describe('[ACCEPTANCE-1B5-08] Anti-Tamper & Context Spoofing (Forged Headers, Query Params)', () => {
    it('ignores client forged X-Tenant-Id header and binds strictly to verified token tenant', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      // Client sends forged X-Tenant-Id header pointing to Tenant B
      const res = await request(saasApp)
        .get('/api/v1/students')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantB._id.toString());

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(3);
      const studentAIds = [studentA1._id.toString(), studentA2._id.toString(), studentA3._id.toString()];
      const studentBIds = [studentB1._id.toString(), studentB2._id.toString(), studentB3._id.toString()];
      expect(res.body.data.every(s => studentAIds.includes(s._id))).toBe(true);
      expect(res.body.data.some(s => studentBIds.includes(s._id))).toBe(false);
    });

    it('strips client supplied ?tenantId= query parameter and prevents cross-tenant access', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res = await request(saasApp)
        .get(`/api/v1/students?tenantId=${tenantB._id.toString()}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(3);
      const studentAIds = [studentA1._id.toString(), studentA2._id.toString(), studentA3._id.toString()];
      expect(res.body.data.every(s => studentAIds.includes(s._id))).toBe(true);
    });

    it('ignores X-Tenant-Id header on legacyApp to prevent tenant escalation', async () => {
      const tokenLegacy = generateToken(legacyAdmin);

      const res = await request(legacyApp)
        .get('/api/students')
        .set('Authorization', `Bearer ${tokenLegacy}`)
        .set('X-Tenant-Id', tenantA._id.toString());

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(3);
      const legacyStudentIds = [legacyStudent1._id.toString(), legacyStudent2._id.toString(), legacyStudent3._id.toString()];
      expect(res.body.data.every(s => legacyStudentIds.includes(s._id))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 9: Tenant Lifecycle Protection (Suspended and Terminated Tenants)
  // ---------------------------------------------------------------------------
  describe('[ACCEPTANCE-1B5-09] Tenant Lifecycle Protection (Suspended and Terminated Tenants)', () => {
    it('returns 403 TENANT_SUSPENDED when tenant status is suspended', async () => {
      const tokenSuspended = generateSchoolUserToken(userSuspended, tenantSuspended);

      const resClassrooms = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${tokenSuspended}`);

      expect(resClassrooms.status).toBe(403);
      expect(resClassrooms.body.code).toBe('TENANT_SUSPENDED');

      const resStudents = await request(saasApp)
        .get('/api/v1/students')
        .set('Authorization', `Bearer ${tokenSuspended}`);

      expect(resStudents.status).toBe(403);
      expect(resStudents.body.code).toBe('TENANT_SUSPENDED');
    });

    it('returns 403 TENANT_SUSPENDED when tenant status is terminated', async () => {
      const tokenTerminated = generateSchoolUserToken(userTerminated, tenantTerminated);

      const resStudents = await request(saasApp)
        .get('/api/v1/students')
        .set('Authorization', `Bearer ${tokenTerminated}`);

      expect(resStudents.status).toBe(403);
      expect(resStudents.body.code).toBe('TENANT_SUSPENDED');
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 10: Token Revocation, JTI Blacklist, and Auth Version Invalidation
  // ---------------------------------------------------------------------------
  describe('[ACCEPTANCE-1B5-10] Token Revocation, JTI Blacklist, and Auth Version Invalidation', () => {
    it('rejects token immediately with 401 SESSION_REVOKED if token JTI is in RevokedSession', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);
      const jwt = require('jsonwebtoken');
      const decoded = jwt.decode(tokenA);

      // Verify token initially works
      const resInitial = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resInitial.status).toBe(200);

      // Blacklist session JTI
      await RevokedSession.create({
        jti: decoded.jti,
        userId: adminA._id,
        tenantId: tenantA._id,
        expiresAt: new Date(Date.now() + 3600000)
      });

      // Subsequent call fails
      const resRevoked = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(resRevoked.status).toBe(401);
      expect(resRevoked.body.code).toBe('SESSION_REVOKED');
    });

    it('rejects token with 401 AUTH_VERSION_MISMATCH when user authVersion is bumped', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      // Bump user authVersion in database
      await User.updateOne({ _id: adminA._id }, { $inc: { authVersion: 1 } });

      const res = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTH_VERSION_MISMATCH');
    });

    it('rejects token with 403 TENANT_AUTH_REVOKED when tenant authVersion is bumped', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      // Bump tenant authVersion in database
      await Tenant.updateOne({ _id: tenantA._id }, { $inc: { authVersion: 1 } });

      const res = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TENANT_AUTH_REVOKED');
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 11: Token Purpose Boundary Enforcement
  // ---------------------------------------------------------------------------
  describe('[ACCEPTANCE-1B5-11] Token Purpose Boundary Enforcement', () => {
    it('rejects tokens with PLATFORM_ADMIN_ACCESS purpose on school endpoints with 403', async () => {
      const jwt = require('jsonwebtoken');
      const crypto = require('crypto');
      const platformToken = jwt.sign(
        {
          sub: adminA._id.toString(),
          role: 'platform_lead',
          purpose: 'PLATFORM_ADMIN_ACCESS',
          jti: crypto.randomUUID(),
          authVersion: 0
        },
        process.env.JWT_SECRET,
        {
          expiresIn: '1h',
          issuer: 'school-management-api',
          audience: 'school-management-web'
        }
      );

      const res = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${platformToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INVALID_TOKEN_PURPOSE');
    });

    it('returns 501 SUPPORT_ACCESS_NOT_IMPLEMENTED when token purpose is SUPPORT_ACCESS', async () => {
      const jwt = require('jsonwebtoken');
      const crypto = require('crypto');
      const supportToken = jwt.sign(
        {
          sub: adminA._id.toString(),
          purpose: 'SUPPORT_ACCESS',
          jti: crypto.randomUUID(),
          authVersion: 0
        },
        process.env.JWT_SECRET,
        {
          expiresIn: '1h',
          issuer: 'school-management-api',
          audience: 'school-management-web'
        }
      );

      const res = await request(saasApp)
        .get('/api/v1/classrooms')
        .set('Authorization', `Bearer ${supportToken}`);

      expect(res.status).toBe(501);
      expect(res.body.code).toBe('SUPPORT_ACCESS_NOT_IMPLEMENTED');
    });

    it('strictly rejects SaaS tokens when presented to legacy endpoints with 401', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const res = await request(legacyApp)
        .get('/api/classrooms')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/Token đa trường không được phép truy cập hệ thống đơn trường/i);
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 12: Complete Route Exposure Surface: Approved GETs Allowed,
  // Unapproved GETs and All Writes Fail-Closed (HTTP 501)
  // ---------------------------------------------------------------------------
  describe('[ACCEPTANCE-1B5-12] Route Exposure Surface: Approved GETs Allowed, All Writes & Unapproved GETs Fail-Closed (501)', () => {
    it('allows all approved 1B GET endpoints', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const routes = [
        '/api/v1/classrooms',
        `/api/v1/classrooms/${classroomA1._id}`,
        '/api/v1/students',
        `/api/v1/students/${studentA1._id}`,
        `/api/v1/students/${studentA1._id}/daily-reports`,
        `/api/v1/students/${studentA1._id}/transfer-history`,
        '/api/classrooms',
        `/api/classrooms/${classroomA1._id}`,
        '/api/students',
        `/api/students/${studentA1._id}`,
        `/api/students/${studentA1._id}/daily-reports`,
        `/api/students/${studentA1._id}/transfer-history`
      ];

      for (const route of routes) {
        const res = await request(saasApp)
          .get(route)
          .set('Authorization', `Bearer ${tokenA}`);
        expect(res.status).toBe(200);
      }
    });

    it('fails closed with 501 Not Implemented on all unapproved GET routes (both auth & unauth)', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const unapprovedRoutes = [
        '/api/v1/students/export',
        '/api/v1/students/template',
        '/api/v1/students/excel/template',
        '/api/v1/classrooms/export',
        '/api/v1/classrooms/template',
        '/api/v1/attendance',
        '/api/v1/finance',
        '/api/v1/reports',
        '/api/v1/procurement',
        '/api/v1/timekeeping',
        '/api/v1/system',
        '/api/v1/nutrition',
        '/api/v1/hr',
        '/api/attendance',
        '/api/finance'
      ];

      for (const route of unapprovedRoutes) {
        // Authenticated
        const resAuth = await request(saasApp)
          .get(route)
          .set('Authorization', `Bearer ${tokenA}`);
        expect(resAuth.status).toBe(501);

        // Unauthenticated
        const resUnauth = await request(saasApp)
          .get(route);
        expect(resUnauth.status).toBe(501);
      }
    });

    it('fails closed with 501 Not Implemented on all POST/PUT/PATCH/DELETE writes (both auth & unauth)', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const writeEndpoints = [
        { method: 'post', url: '/api/v1/classrooms' },
        { method: 'put', url: `/api/v1/classrooms/${classroomA1._id}` },
        { method: 'delete', url: `/api/v1/classrooms/${classroomA1._id}` },
        { method: 'post', url: '/api/v1/students' },
        { method: 'put', url: `/api/v1/students/${studentA1._id}` },
        { method: 'patch', url: `/api/v1/students/${studentA1._id}` },
        { method: 'delete', url: `/api/v1/students/${studentA1._id}` },
        { method: 'post', url: `/api/v1/students/${studentA1._id}/daily-reports` },
        { method: 'post', url: `/api/v1/students/${studentA1._id}/transfer` },
        { method: 'post', url: '/api/v1/students/excel/confirm' },
        { method: 'post', url: '/api/classrooms' },
        { method: 'post', url: '/api/students' }
      ];

      for (const ep of writeEndpoints) {
        // Authenticated
        const resAuth = await request(saasApp)[ep.method](ep.url)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({});
        expect(resAuth.status).toBe(501);

        // Unauthenticated
        const resUnauth = await request(saasApp)[ep.method](ep.url)
          .send({});
        expect(resUnauth.status).toBe(501);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 13: Zero Read Side-Effects & Document Immutability Verification
  // ---------------------------------------------------------------------------
  describe('[ACCEPTANCE-1B5-13] Zero Read Side-Effects & Document Immutability Verification', () => {
    it('verifies that executing read requests leaves database documents completely unmodified', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      // 1. Take baseline snapshot
      const studentCountBefore = await Student.countDocuments();
      const classroomCountBefore = await Classroom.countDocuments();
      const transferCountBefore = await StudentTransferHistory.countDocuments();
      const auditLogCountBefore = await AuditLog.countDocuments();

      const studentBefore = await Student.findById(studentA1._id).lean();
      const classroomBefore = await Classroom.findById(classroomA1._id).lean();

      // 2. Execute extensive series of read requests
      await request(saasApp).get('/api/v1/classrooms').set('Authorization', `Bearer ${tokenA}`);
      await request(saasApp).get(`/api/v1/classrooms/${classroomA1._id}`).set('Authorization', `Bearer ${tokenA}`);
      await request(saasApp).get('/api/v1/students').set('Authorization', `Bearer ${tokenA}`);
      await request(saasApp).get(`/api/v1/students/${studentA1._id}`).set('Authorization', `Bearer ${tokenA}`);
      await request(saasApp).get(`/api/v1/students/${studentA1._id}/daily-reports`).set('Authorization', `Bearer ${tokenA}`);
      await request(saasApp).get(`/api/v1/students/${studentA1._id}/transfer-history`).set('Authorization', `Bearer ${tokenA}`);
      await request(saasApp).get('/api/v1/students?search=Nguyễn').set('Authorization', `Bearer ${tokenA}`);
      await request(saasApp).get(`/api/v1/students?classroomId=${classroomA1._id}`).set('Authorization', `Bearer ${tokenA}`);

      // 3. Take post-execution snapshot
      const studentCountAfter = await Student.countDocuments();
      const classroomCountAfter = await Classroom.countDocuments();
      const transferCountAfter = await StudentTransferHistory.countDocuments();
      const auditLogCountAfter = await AuditLog.countDocuments();

      const studentAfter = await Student.findById(studentA1._id).lean();
      const classroomAfter = await Classroom.findById(classroomA1._id).lean();

      // 4. Assert zero side-effects
      expect(studentCountAfter).toBe(studentCountBefore);
      expect(classroomCountAfter).toBe(classroomCountBefore);
      expect(transferCountAfter).toBe(transferCountBefore);
      expect(auditLogCountAfter).toBe(auditLogCountBefore);

      expect(studentAfter.updatedAt).toEqual(studentBefore.updatedAt);
      expect(studentAfter.dailyReports.length).toBe(studentBefore.dailyReports.length);

      expect(classroomAfter.updatedAt).toEqual(classroomBefore.updatedAt);
      expect(classroomAfter.statistics).toEqual(classroomBefore.statistics);
    });
  });
});
