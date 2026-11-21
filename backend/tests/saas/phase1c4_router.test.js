/**
 * Task 1C.4: SaaS Attendance Router & Student Transfer Router Verification
 * 
 * Verifies end-to-end multi-tenant HTTP behavior for SaaS 1C:
 * 1. Valid A/B/Legacy Isolation and Aliases (/api/v1 and /api) across all 11 audited attendance endpoints and student transfer
 * 2. Role Middleware Enforcement on each endpoint (reject unauthorized roles with HTTP 403)
 * 3. Foreign ID Access Boundary (cross-tenant traversal strictly returns HTTP 404)
 * 4. Session Verification & Security Boundary (token expiry, suspended/terminated tenants, revocation, forged headers, wrong purpose)
 * 5. Route Shadowing and Fail-Closed Protection (reserved single-segment paths fall through to 501, hardware ingest 501, unapproved routes 501)
 * 6. Writes & Transactions (atomic transfer, capacity updates, transfer history tenantId, Idempotency-Key replay)
 */

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';
process.env.PLATFORM_MFA_ENCRYPTION_KEY = 'mfa-encryption-key-for-phase1a-isolated-test-32bytes!';
process.env.SAAS_MODE = 'phase1c';
process.env.TENANT_FEATURE_READINESS = 'false';

jest.setTimeout(60000);

const mongoose = require('mongoose');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const createSaasApp = require('../../src/saas/createSaasApp');
const createApp = require('../../app'); // Legacy app
const testDbBootstrap = require('../../src/saas/testDbBootstrap');

const {
  generateSchoolUserToken,
  generatePlatformAdminToken,
  generateMfaChallengeToken,
  generateSupportAccessToken
} = require('../../src/saas/utils/saasJwt');
const { generateToken: generateLegacyToken } = require('../../src/utils/jwt');
const { getWorkDate, getWorkDateRange, addWorkDays, DEFAULT_SCHOOL_TIMEZONE } = require('../../src/utils/dateHelpers');

const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const PlatformAdmin = require('../../src/models/zone1_system/PlatformAdmin');
const RevokedSession = require('../../src/models/zone1_system/RevokedSession');
const Classroom = require('../../src/models/zone3_school/Classroom');
const Student = require('../../src/models/zone3_school/Student');
const StudentAttendance = require('../../src/models/zone3_school/StudentAttendance');
const StudentLeaveRequest = require('../../src/models/zone3_school/StudentLeaveRequest');
const StudentTransferHistory = require('../../src/models/zone3_school/StudentTransferHistory');
const ImportIdempotency = require('../../src/models/zone1_system/ImportIdempotency');
const Notification = require('../../src/models/zone1_system/Notification');

let bootstrapInstance;
let mongoUri;
let saasApp;
let legacyApp;

let tenantA, tenantB, tenantSuspended, tenantTerminated;
let adminA, principalA, hrA, teacherA1, teacherA2, parentA1, parentA2, inactiveUserA, guardA;
let adminB, teacherB1, parentB1;
let userSuspended, userTerminated;
let legacyAdmin, legacyTeacher, legacyParent;
let platformAdmin;

let classroomA1, classroomA2;
let classroomB1;
let legacyClassroom;

let studentA1, studentA2;
let studentB1;
let legacyStudent;

beforeAll(async () => {
  bootstrapInstance = await testDbBootstrap.startTestDb({
    instanceOpts: [{ dbName: 'school_saas_phase1c4_test' }]
  });
  mongoUri = bootstrapInstance.uri;

  saasApp = createSaasApp({ mongoUri, connection: bootstrapInstance.connection, saasMode: 'phase1c' });
  legacyApp = createApp();

  await Promise.all([
    Tenant.syncIndexes(),
    User.syncIndexes(),
    Classroom.syncIndexes(),
    Student.syncIndexes(),
    StudentAttendance.syncIndexes(),
    StudentLeaveRequest.syncIndexes(),
    StudentTransferHistory.syncIndexes(),
    ImportIdempotency.syncIndexes()
  ]);
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
    StudentAttendance.deleteMany({}),
    StudentLeaveRequest.deleteMany({}),
    StudentTransferHistory.deleteMany({}),
    ImportIdempotency.deleteMany({}),
    Notification.deleteMany({})
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
    name: 'Trường Mầm Non Bình Minh B',
    status: 'active',
    authVersion: 0
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

  // 2. Users (Base accounts created first so IDs are ready)
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
    profile: { fullName: 'Phụ Huynh A1' }
  });

  parentA2 = await User.create({
    tenantId: tenantA._id,
    username: 'parent_a2',
    passwordHash,
    role: 'parent',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Phụ Huynh A2' }
  });

  guardA = await User.create({
    tenantId: tenantA._id,
    username: 'guard_a',
    passwordHash,
    role: 'guard',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Bảo Vệ A' }
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

  teacherB1 = await User.create({
    tenantId: tenantB._id,
    username: 'teacher_b1',
    passwordHash,
    role: 'teacher',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Giáo Viên B1' }
  });

  parentB1 = await User.create({
    tenantId: tenantB._id,
    username: 'parent_b1',
    passwordHash,
    role: 'parent',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Phụ Huynh B1' }
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

  legacyTeacher = await User.create({
    tenantId: null,
    username: 'legacy_teacher',
    passwordHash,
    role: 'teacher',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Giáo Viên Legacy' }
  });

  legacyParent = await User.create({
    tenantId: null,
    username: 'legacy_parent',
    passwordHash,
    role: 'parent',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Phụ Huynh Legacy' }
  });

  platformAdmin = await PlatformAdmin.create({
    username: 'platform_lead',
    passwordHash,
    role: 'platform_lead',
    totpSecret: 'mock-totp-secret',
    status: 'active',
    authVersion: 0
  });

  // 3. Classrooms (Assigned to teachers)
  classroomA1 = await Classroom.create({
    name: 'Lớp Mầm 1A',
    schoolYear: '2026-2027',
    ageGroup: '3-4',
    maxSize: 25,
    currentEnrollment: 10,
    statistics: { currentStudents: 10 },
    homeroomTeacherId: teacherA1._id,
    teachers: [{ teacherId: teacherA1._id }],
    status: 'active',
    tenantId: tenantA._id
  });

  classroomA2 = await Classroom.create({
    name: 'Lớp Chồi 1A',
    schoolYear: '2026-2027',
    ageGroup: '4-5',
    maxSize: 25,
    currentEnrollment: 5,
    statistics: { currentStudents: 5 },
    homeroomTeacherId: teacherA2._id,
    teachers: [{ teacherId: teacherA2._id }],
    status: 'active',
    tenantId: tenantA._id
  });

  classroomB1 = await Classroom.create({
    name: 'Lớp Mầm 1B',
    schoolYear: '2026-2027',
    ageGroup: '3-4',
    maxSize: 25,
    currentEnrollment: 5,
    statistics: { currentStudents: 5 },
    homeroomTeacherId: teacherB1._id,
    teachers: [{ teacherId: teacherB1._id }],
    status: 'active',
    tenantId: tenantB._id
  });

  legacyClassroom = await Classroom.create({
    name: 'Lớp Legacy',
    schoolYear: '2026-2027',
    ageGroup: '3-4',
    maxSize: 25,
    currentEnrollment: 5,
    statistics: { currentStudents: 5 },
    homeroomTeacherId: legacyTeacher._id,
    teachers: [{ teacherId: legacyTeacher._id }],
    status: 'active',
    tenantId: null
  });

  // 4. Students
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
    attendanceCardId: 'CARD-A1-001',
    tenantId: tenantA._id
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
    attendanceCardId: 'CARD-A2-002',
    tenantId: tenantA._id
  });

  studentB1 = await Student.create({
    fullName: 'Lê Hoàng Cường',
    studentCode: 'HS-2026-000003',
    birthDate: new Date('2021-02-10'),
    gender: 'male',
    status: 'enrolled',
    admissionDate: new Date('2026-09-01'),
    enrollmentDate: new Date('2026-09-01'),
    schoolYear: '2026-2027',
    classroomId: classroomB1._id,
    className: classroomB1.name,
    attendanceCardId: 'CARD-B1-003',
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
    attendanceCardId: 'CARD-LEGACY-004',
    tenantId: null
  });

  // 5. Update teacher assignedClassrooms and parent studentIds
  await Promise.all([
    User.updateOne({ _id: teacherA1._id }, { assignedClassrooms: [classroomA1._id] }),
    User.updateOne({ _id: teacherA2._id }, { assignedClassrooms: [classroomA2._id] }),
    User.updateOne({ _id: teacherB1._id }, { assignedClassrooms: [classroomB1._id] }),
    User.updateOne({ _id: legacyTeacher._id }, { assignedClassrooms: [legacyClassroom._id] }),
    User.updateOne({ _id: parentA1._id }, { 'parentInfo.studentIds': [studentA1._id] }),
    User.updateOne({ _id: parentA2._id }, { 'parentInfo.studentIds': [studentA2._id] }),
    User.updateOne({ _id: parentB1._id }, { 'parentInfo.studentIds': [studentB1._id] }),
    User.updateOne({ _id: legacyParent._id }, { 'parentInfo.studentIds': [legacyStudent._id] })
  ]);
});

describe('Task 1C.4 - SaaS Attendance & Student Transfer Router Verification', () => {

  // =======================================================================
  // 1. Valid A/B/Legacy Isolation and Aliases (/api/v1 and /api)
  // =======================================================================
  describe('1. Valid A/B/Legacy Isolation and Aliases (/api/v1 and /api)', () => {

    test('1.1 POST /api/v1/attendance and /api/attendance creates attendance with tenantId; duplicate returns 409', async () => {
      const tokenTeacher = generateSchoolUserToken(teacherA1, tenantA);

      // 1. /api/v1/attendance
      const res1 = await request(saasApp)
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${tokenTeacher}`)
        .send({
          studentId: studentA1._id.toString(),
          status: 'present',
          checkInTime: new Date(),
          note: 'Đến đúng giờ'
        });

      expect(res1.status).toBe(201);
      expect(res1.body.data.studentId).toBe(studentA1._id.toString());
      expect(res1.body.data.tenantId).toBe(tenantA._id.toString());

      // Duplicate attendance for same student today returns 409
      const resDup = await request(saasApp)
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${tokenTeacher}`)
        .send({
          studentId: studentA1._id.toString(),
          status: 'present'
        });
      expect(resDup.status).toBe(409);

      // 2. /api/attendance alias for studentA2
      const tokenTeacher2 = generateSchoolUserToken(teacherA2, tenantA);
      const resAlias = await request(saasApp)
        .post('/api/attendance')
        .set('Authorization', `Bearer ${tokenTeacher2}`)
        .send({
          studentId: studentA2._id.toString(),
          status: 'present',
          checkInTime: new Date()
        });

      expect(resAlias.status).toBe(201);
      expect(resAlias.body.data.tenantId).toBe(tenantA._id.toString());
    });

    test('1.2 POST /api/v1/attendance/bulk and /api/attendance/bulk creates bulk attendance with tenantId', async () => {
      const tokenTeacher = generateSchoolUserToken(teacherA1, tenantA);

      const res = await request(saasApp)
        .post('/api/v1/attendance/bulk')
        .set('Authorization', `Bearer ${tokenTeacher}`)
        .send({
          classroomId: classroomA1._id.toString(),
          records: [
            { studentId: studentA1._id.toString(), status: 'present', checkInTime: new Date() }
          ]
        });

      expect(res.status).toBe(201);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].tenantId).toBe(tenantA._id.toString());

      // Alias
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);
      const resAlias = await request(saasApp)
        .post('/api/attendance/bulk')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          classroomId: classroomA2._id.toString(),
          records: [
            { studentId: studentA2._id.toString(), status: 'late', checkInTime: new Date() }
          ]
        });

      expect(resAlias.status).toBe(201);
      expect(resAlias.body.data[0].tenantId).toBe(tenantA._id.toString());
    });

    test('1.3 POST /api/v1/attendance/check-in and /api/attendance/check-in scans card within tenant', async () => {
      const tokenTeacher = generateSchoolUserToken(teacherA1, tenantA);

      const res1 = await request(saasApp)
        .post('/api/v1/attendance/check-in')
        .set('Authorization', `Bearer ${tokenTeacher}`)
        .send({ identifier: 'CARD-A1-001', method: 'card' });

      expect(res1.status).toBe(201);
      expect(res1.body.data.studentId).toBe(studentA1._id.toString());
      expect(res1.body.data.tenantId).toBe(tenantA._id.toString());

      // Check-in alias with admin token for studentA2
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);
      const resAlias = await request(saasApp)
        .post('/api/attendance/check-in')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ identifier: 'CARD-A2-002', method: 'card' });

      expect(resAlias.status).toBe(201);
      expect(resAlias.body.data.studentId).toBe(studentA2._id.toString());
      expect(resAlias.body.data.tenantId).toBe(tenantA._id.toString());
    });

    test('1.4 POST /api/v1/attendance/leave-requests and /api/attendance/leave-requests submits leave request', async () => {
      const tokenParent = generateSchoolUserToken(parentA1, tenantA);
      const today = getWorkDate();
      const nextWeek = addWorkDays(today, 4);

      const res = await request(saasApp)
        .post('/api/v1/attendance/leave-requests')
        .set('Authorization', `Bearer ${tokenParent}`)
        .send({
          studentId: studentA1._id.toString(),
          startDate: today,
          endDate: nextWeek,
          reason: 'Gia đình có việc bận xin cho cháu nghỉ học'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tenantId).toBe(tenantA._id.toString());
      expect(res.body.data.studentId).toBe(studentA1._id.toString());

      // Alias
      const tokenParent2 = generateSchoolUserToken(parentA2, tenantA);
      const resAlias = await request(saasApp)
        .post('/api/attendance/leave-requests')
        .set('Authorization', `Bearer ${tokenParent2}`)
        .send({
          studentId: studentA2._id.toString(),
          startDate: today,
          endDate: nextWeek,
          reason: 'Bé bị ốm cần đi khám bác sĩ và theo dõi'
        });

      expect(resAlias.status).toBe(201);
      expect(resAlias.body.data.tenantId).toBe(tenantA._id.toString());
    });

    test('1.5 GET /api/v1/attendance/leave-requests and /api/attendance/leave-requests returns only Tenant A requests', async () => {
      const today = getWorkDate();
      const nextWeek = addWorkDays(today, 4);

      // Create leave request in Tenant A and Tenant B
      await StudentLeaveRequest.create({
        tenantId: tenantA._id,
        studentId: studentA1._id,
        studentName: studentA1.fullName,
        classroomId: classroomA1._id,
        className: classroomA1.name,
        requesterId: parentA1._id,
        requesterName: 'Phụ Huynh A1',
        startDate: today,
        endDate: nextWeek,
        reason: 'Đơn nghỉ trường A'
      });

      await StudentLeaveRequest.create({
        tenantId: tenantB._id,
        studentId: studentB1._id,
        studentName: studentB1.fullName,
        classroomId: classroomB1._id,
        className: classroomB1.name,
        requesterId: parentB1._id,
        requesterName: 'Phụ Huynh B1',
        startDate: today,
        endDate: nextWeek,
        reason: 'Đơn nghỉ trường B'
      });

      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);
      const res1 = await request(saasApp)
        .get('/api/v1/attendance/leave-requests')
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res1.status).toBe(200);
      expect(res1.body.data.length).toBe(1);
      expect(res1.body.data[0].reason).toBe('Đơn nghỉ trường A');

      // Alias
      const resAlias = await request(saasApp)
        .get('/api/attendance/leave-requests')
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(resAlias.status).toBe(200);
      expect(resAlias.body.data.length).toBe(1);
    });

    test('1.6 PATCH /api/v1/attendance/leave-requests/:id/review and /api/attendance/leave-requests/:id/review approves request', async () => {
      const now = new Date();
      const addDays = now.getDay() === 6 ? 2 : now.getDay() === 0 ? 1 : 0;
      const targetDate = new Date(now.getTime() + addDays * 86400000);
      const today = getWorkDate(targetDate);
      const reqDoc = await StudentLeaveRequest.create({
        tenantId: tenantA._id,
        studentId: studentA1._id,
        studentName: studentA1.fullName,
        classroomId: classroomA1._id,
        className: classroomA1.name,
        requesterId: parentA1._id,
        requesterName: 'Phụ Huynh A1',
        startDate: today,
        endDate: today,
        reason: 'Nghỉ 1 ngày hợp lệ'
      });

      const tokenPrincipal = generateSchoolUserToken(principalA, tenantA);
      const res = await request(saasApp)
        .patch(`/api/v1/attendance/leave-requests/${reqDoc._id}/review`)
        .set('Authorization', `Bearer ${tokenPrincipal}`)
        .send({
          decision: 'approved',
          reviewNote: 'Đồng ý cho bé nghỉ'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('approved');

      // Verify StudentAttendance was automatically created with tenantId
      const createdAtt = await StudentAttendance.findOne({ studentId: studentA1._id, attendanceDateKey: today });
      expect(createdAtt).not.toBeNull();
      expect(createdAtt.tenantId.toString()).toBe(tenantA._id.toString());
      expect(createdAtt.status).toBe('absent_permission');
    });

    test('1.7 GET /api/v1/attendance/reports/absence and /api/attendance/reports/absence returns scoped absence report', async () => {
      const today = getWorkDate();
      const { start } = getWorkDateRange(today, DEFAULT_SCHOOL_TIMEZONE);

      await StudentAttendance.create({
        tenantId: tenantA._id,
        studentId: studentA1._id,
        studentName: studentA1.fullName,
        classroomId: classroomA1._id,
        className: classroomA1.name,
        attendDate: start,
        attendanceDateKey: today,
        status: 'absent',
        attendanceMethod: 'manual',
        recordedBy: teacherA1._id,
        recordedByName: 'Giáo Viên A1'
      });

      await StudentAttendance.create({
        tenantId: tenantB._id,
        studentId: studentB1._id,
        studentName: studentB1.fullName,
        classroomId: classroomB1._id,
        className: classroomB1.name,
        attendDate: start,
        attendanceDateKey: today,
        status: 'absent',
        attendanceMethod: 'manual',
        recordedBy: teacherB1._id,
        recordedByName: 'Giáo Viên B1'
      });

      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);
      const res = await request(saasApp)
        .get(`/api/v1/attendance/reports/absence?startDate=${today}&endDate=${today}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(res.status).toBe(200);
      expect(res.body.data.records.length).toBe(1);
      expect(res.body.data.records[0].studentName).toBe('Nguyễn Văn An');

      // Alias
      const resAlias = await request(saasApp)
        .get(`/api/attendance/reports/absence?startDate=${today}&endDate=${today}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(resAlias.status).toBe(200);
      expect(resAlias.body.data.records.length).toBe(1);
    });

    test('1.8 GET /api/v1/attendance/student/:studentId and /api/attendance/student/:studentId returns student records', async () => {
      const today = getWorkDate();
      const { start } = getWorkDateRange(today, DEFAULT_SCHOOL_TIMEZONE);

      await StudentAttendance.create({
        tenantId: tenantA._id,
        studentId: studentA1._id,
        studentName: studentA1.fullName,
        classroomId: classroomA1._id,
        className: classroomA1.name,
        attendDate: start,
        attendanceDateKey: today,
        status: 'present',
        attendanceMethod: 'manual',
        recordedBy: teacherA1._id,
        recordedByName: 'Giáo Viên A1'
      });

      const tokenParent = generateSchoolUserToken(parentA1, tenantA);
      const res = await request(saasApp)
        .get(`/api/v1/attendance/student/${studentA1._id}`)
        .set('Authorization', `Bearer ${tokenParent}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].studentId).toBe(studentA1._id.toString());

      // Alias
      const resAlias = await request(saasApp)
        .get(`/api/attendance/student/${studentA1._id}`)
        .set('Authorization', `Bearer ${tokenParent}`);

      expect(resAlias.status).toBe(200);
      expect(resAlias.body.data.length).toBe(1);
    });

    test('1.9 GET /api/v1/attendance/class/:classroomId and /api/attendance/class/:classroomId returns class records', async () => {
      const today = getWorkDate();
      const { start } = getWorkDateRange(today, DEFAULT_SCHOOL_TIMEZONE);

      await StudentAttendance.create({
        tenantId: tenantA._id,
        studentId: studentA1._id,
        studentName: studentA1.fullName,
        classroomId: classroomA1._id,
        className: classroomA1.name,
        attendDate: start,
        attendanceDateKey: today,
        status: 'present',
        attendanceMethod: 'manual',
        recordedBy: teacherA1._id,
        recordedByName: 'Giáo Viên A1'
      });

      const tokenTeacher = generateSchoolUserToken(teacherA1, tenantA);
      const res = await request(saasApp)
        .get(`/api/v1/attendance/class/${classroomA1._id}`)
        .set('Authorization', `Bearer ${tokenTeacher}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].classroomId).toBe(classroomA1._id.toString());

      // Alias
      const resAlias = await request(saasApp)
        .get(`/api/attendance/class/${classroomA1._id}`)
        .set('Authorization', `Bearer ${tokenTeacher}`);

      expect(resAlias.status).toBe(200);
      expect(resAlias.body.data.length).toBe(1);
    });

    test('1.10 PUT /api/v1/attendance/:id and /api/attendance/:id updates attendance record', async () => {
      const today = getWorkDate();
      const { start } = getWorkDateRange(today, DEFAULT_SCHOOL_TIMEZONE);

      const att = await StudentAttendance.create({
        tenantId: tenantA._id,
        studentId: studentA1._id,
        studentName: studentA1.fullName,
        classroomId: classroomA1._id,
        className: classroomA1.name,
        attendDate: start,
        attendanceDateKey: today,
        status: 'present',
        attendanceMethod: 'manual',
        recordedBy: teacherA1._id,
        recordedByName: 'Giáo Viên A1'
      });

      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);
      const res = await request(saasApp)
        .put(`/api/v1/attendance/${att._id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ status: 'late', note: 'Đi muộn 15 phút' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('late');
      expect(res.body.data.note).toBe('Đi muộn 15 phút');

      // Alias update
      const resAlias = await request(saasApp)
        .put(`/api/attendance/${att._id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ note: 'Đã cập nhật qua alias' });

      expect(resAlias.status).toBe(200);
      expect(resAlias.body.data.note).toBe('Đã cập nhật qua alias');
    });

    test('1.11 DELETE /api/v1/attendance/:id and /api/attendance/:id deletes attendance record', async () => {
      const today = getWorkDate();
      const { start } = getWorkDateRange(today, DEFAULT_SCHOOL_TIMEZONE);

      const att = await StudentAttendance.create({
        tenantId: tenantA._id,
        studentId: studentA1._id,
        studentName: studentA1.fullName,
        classroomId: classroomA1._id,
        className: classroomA1.name,
        attendDate: start,
        attendanceDateKey: today,
        status: 'present',
        attendanceMethod: 'manual',
        recordedBy: adminA._id,
        recordedByName: 'Admin A'
      });

      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);
      const res = await request(saasApp)
        .delete(`/api/v1/attendance/${att._id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('Xóa điểm danh thành công');

      const deleted = await StudentAttendance.findById(att._id);
      expect(deleted).toBeNull();
    });

    test('1.12 POST /api/v1/students/:id/transfer and /api/students/:id/transfer transfers student with Idempotency-Key', async () => {
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);
      const idempotencyKey = 'TRANSFER-A1-TO-A2-KEY12345';

      const res = await request(saasApp)
        .post(`/api/v1/students/${studentA1._id}/transfer`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          toClassroomId: classroomA2._id.toString(),
          reason: 'Chuyển sang lớp phù hợp hơn với độ tuổi',
          effectiveDate: getWorkDate()
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.student.classroomId).toBe(classroomA2._id.toString());
      expect(res.body.data.transferHistory.tenantId).toBe(tenantA._id.toString());
      expect(res.body.data.transferHistory.fromClassroomId).toBe(classroomA1._id.toString());
      expect(res.body.data.transferHistory.toClassroomId).toBe(classroomA2._id.toString());

      // Idempotency replay with same key returns 200 with replayed: true
      const resReplay = await request(saasApp)
        .post(`/api/v1/students/${studentA1._id}/transfer`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          toClassroomId: classroomA2._id.toString(),
          reason: 'Chuyển sang lớp phù hợp hơn với độ tuổi',
          effectiveDate: getWorkDate()
        });

      expect(resReplay.status).toBe(200);
      expect(resReplay.body.replayed).toBe(true);

      // Verify classroom capacity updates
      const updatedClassA1 = await Classroom.findById(classroomA1._id);
      const updatedClassA2 = await Classroom.findById(classroomA2._id);
      expect(updatedClassA1.statistics.currentStudents).toBe(9); // decremented from 10
      expect(updatedClassA2.statistics.currentStudents).toBe(6); // incremented from 5

      // Verify alias /api/students/:id/transfer works
      const idempotencyKeyAlias = 'TRANSFER-A1-BACK-A1-KEY54321';
      const resAlias = await request(saasApp)
        .post(`/api/students/${studentA1._id}/transfer`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .set('Idempotency-Key', idempotencyKeyAlias)
        .send({
          toClassroomId: classroomA1._id.toString(),
          reason: 'Chuyển lại về lớp cũ',
          effectiveDate: getWorkDate()
        });

      expect(resAlias.status).toBe(200);
      expect(resAlias.body.data.student.classroomId).toBe(classroomA1._id.toString());
    });

    test('1.13 Legacy token on SaaS rejected; SaaS token on legacy rejected', async () => {
      const legacyToken = generateLegacyToken(legacyAdmin);
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      // Legacy token on SaaS attendance endpoint returns 401
      const res1 = await request(saasApp)
        .get('/api/v1/attendance/leave-requests')
        .set('Authorization', `Bearer ${legacyToken}`);
      expect(res1.status).toBe(401);
      expect(res1.body.code).toBe('TOKEN_INVALID');

      // SaaS token on Legacy app attendance endpoint returns 401
      const res2 = await request(legacyApp)
        .get('/api/attendance/leave-requests')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res2.status).toBe(401);
      expect(res2.body.message).toMatch(/Token đa trường không được phép truy cập hệ thống đơn trường/i);
    });
  });

  // =======================================================================
  // 2. Role Middleware Enforcement (HTTP 403 Forbidden)
  // =======================================================================
  describe('2. Role Middleware Enforcement (HTTP 403 Forbidden)', () => {

    test('2.1 POST /attendance rejects parent, guard, hr with 403', async () => {
      const rolesToReject = [parentA1, guardA, hrA];
      for (const user of rolesToReject) {
        const token = generateSchoolUserToken(user, tenantA);
        const res = await request(saasApp)
          .post('/api/v1/attendance')
          .set('Authorization', `Bearer ${token}`)
          .send({ studentId: studentA1._id.toString() });

        expect(res.status).toBe(403);
        expect(res.body.message).toContain('Bạn không có quyền');
      }
    });

    test('2.2 POST /attendance/bulk rejects parent and guard with 403', async () => {
      const rolesToReject = [parentA1, guardA];
      for (const user of rolesToReject) {
        const token = generateSchoolUserToken(user, tenantA);
        const res = await request(saasApp)
          .post('/api/v1/attendance/bulk')
          .set('Authorization', `Bearer ${token}`)
          .send({ classroomId: classroomA1._id.toString() });

        expect(res.status).toBe(403);
      }
    });

    test('2.3 POST /attendance/check-in rejects parent with 403', async () => {
      const token = generateSchoolUserToken(parentA1, tenantA);
      const res = await request(saasApp)
        .post('/api/v1/attendance/check-in')
        .set('Authorization', `Bearer ${token}`)
        .send({ identifier: 'CARD-A1-001', method: 'card' });

      expect(res.status).toBe(403);
    });

    test('2.4 POST /attendance/leave-requests requires parent role (rejects teacher, admin with 403)', async () => {
      const rolesToReject = [teacherA1, adminA, principalA, guardA];
      for (const user of rolesToReject) {
        const token = generateSchoolUserToken(user, tenantA);
        const res = await request(saasApp)
          .post('/api/v1/attendance/leave-requests')
          .set('Authorization', `Bearer ${token}`)
          .send({ studentId: studentA1._id.toString() });

        expect(res.status).toBe(403);
      }
    });

    test('2.5 GET /attendance/leave-requests rejects guard with 403', async () => {
      const token = generateSchoolUserToken(guardA, tenantA);
      const res = await request(saasApp)
        .get('/api/v1/attendance/leave-requests')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    test('2.6 PATCH /attendance/leave-requests/:id/review rejects teacher, parent, guard with 403', async () => {
      const dummyId = new mongoose.Types.ObjectId();
      const rolesToReject = [teacherA1, parentA1, guardA];
      for (const user of rolesToReject) {
        const token = generateSchoolUserToken(user, tenantA);
        const res = await request(saasApp)
          .patch(`/api/v1/attendance/leave-requests/${dummyId}/review`)
          .set('Authorization', `Bearer ${token}`)
          .send({ decision: 'approved' });

        expect(res.status).toBe(403);
      }
    });

    test('2.7 GET /attendance/reports/absence rejects parent and guard with 403', async () => {
      const rolesToReject = [parentA1, guardA];
      for (const user of rolesToReject) {
        const token = generateSchoolUserToken(user, tenantA);
        const res = await request(saasApp)
          .get('/api/v1/attendance/reports/absence')
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(403);
      }
    });

    test('2.8 GET /attendance/student/:studentId rejects foreign parent with 403', async () => {
      // Parent A2 is NOT the parent of Student A1
      const tokenParentA2 = generateSchoolUserToken(parentA2, tenantA);
      const res = await request(saasApp)
        .get(`/api/v1/attendance/student/${studentA1._id}`)
        .set('Authorization', `Bearer ${tokenParentA2}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Bạn không có quyền');
    });

    test('2.9 GET /attendance/class/:classroomId rejects parent and unassigned teacher with 403', async () => {
      const tokenParent = generateSchoolUserToken(parentA1, tenantA);
      const resParent = await request(saasApp)
        .get(`/api/v1/attendance/class/${classroomA1._id}`)
        .set('Authorization', `Bearer ${tokenParent}`);
      expect(resParent.status).toBe(403);

      // Teacher A2 is assigned to classroomA2, NOT classroomA1
      const tokenTeacher2 = generateSchoolUserToken(teacherA2, tenantA);
      const resTeacher2 = await request(saasApp)
        .get(`/api/v1/attendance/class/${classroomA1._id}`)
        .set('Authorization', `Bearer ${tokenTeacher2}`);
      expect(resTeacher2.status).toBe(403);
    });

    test('2.10 PUT /attendance/:id rejects parent with 403', async () => {
      const dummyId = new mongoose.Types.ObjectId();
      const tokenParent = generateSchoolUserToken(parentA1, tenantA);
      const res = await request(saasApp)
        .put(`/api/v1/attendance/${dummyId}`)
        .set('Authorization', `Bearer ${tokenParent}`)
        .send({ status: 'present' });

      expect(res.status).toBe(403);
    });

    test('2.11 DELETE /attendance/:id rejects teacher and parent with 403', async () => {
      const dummyId = new mongoose.Types.ObjectId();
      const rolesToReject = [teacherA1, parentA1];
      for (const user of rolesToReject) {
        const token = generateSchoolUserToken(user, tenantA);
        const res = await request(saasApp)
          .delete(`/api/v1/attendance/${dummyId}`)
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(403);
      }
    });

    test('2.12 POST /students/:id/transfer rejects teacher, parent, guard with 403', async () => {
      const rolesToReject = [teacherA1, parentA1, guardA];
      for (const user of rolesToReject) {
        const token = generateSchoolUserToken(user, tenantA);
        const res = await request(saasApp)
          .post(`/api/v1/students/${studentA1._id}/transfer`)
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', 'TRANSFER-ROLE-CHECK-KEY1234')
          .send({ toClassroomId: classroomA2._id.toString() });

        expect(res.status).toBe(403);
      }
    });
  });

  // =======================================================================
  // 3. Foreign ID Access Boundary (Strict HTTP 404 Invisible)
  // =======================================================================
  describe('3. Foreign ID Access Boundary (HTTP 404 Invisible)', () => {

    test('3.1 Tenant A teacher creating attendance for Tenant B student returns 404', async () => {
      const tokenTeacher = generateSchoolUserToken(teacherA1, tenantA);
      const res = await request(saasApp)
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${tokenTeacher}`)
        .send({
          studentId: studentB1._id.toString(),
          status: 'present'
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Không tìm thấy học sinh');
    });

    test('3.2 Tenant A check-in with Tenant B card returns 404', async () => {
      const tokenTeacher = generateSchoolUserToken(teacherA1, tenantA);
      const res = await request(saasApp)
        .post('/api/v1/attendance/check-in')
        .set('Authorization', `Bearer ${tokenTeacher}`)
        .send({ identifier: 'CARD-B1-003', method: 'card' });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Không tìm thấy học sinh');
    });

    test('3.3 Tenant A parent creating leave request for Tenant B student returns 404', async () => {
      const tokenParent = generateSchoolUserToken(parentA1, tenantA);
      const today = getWorkDate();
      const res = await request(saasApp)
        .post('/api/v1/attendance/leave-requests')
        .set('Authorization', `Bearer ${tokenParent}`)
        .send({
          studentId: studentB1._id.toString(),
          startDate: today,
          endDate: addWorkDays(today, 2),
          reason: 'Xin nghỉ phép học sinh trường khác'
        });

      expect(res.status).toBe(404);
    });

    test('3.4 Tenant A principal reviewing Tenant B leave request returns 404', async () => {
      const today = getWorkDate();
      const reqB = await StudentLeaveRequest.create({
        tenantId: tenantB._id,
        studentId: studentB1._id,
        studentName: studentB1.fullName,
        classroomId: classroomB1._id,
        className: classroomB1.name,
        requesterId: parentB1._id,
        requesterName: 'Phụ Huynh B1',
        startDate: today,
        endDate: today,
        reason: 'Nghỉ trường B'
      });

      const tokenPrincipalA = generateSchoolUserToken(principalA, tenantA);
      const res = await request(saasApp)
        .patch(`/api/v1/attendance/leave-requests/${reqB._id}/review`)
        .set('Authorization', `Bearer ${tokenPrincipalA}`)
        .send({ decision: 'approved' });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Không tìm thấy đơn xin nghỉ');
    });

    test('3.5 Tenant A getting attendance of Tenant B student returns 404', async () => {
      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);
      const res = await request(saasApp)
        .get(`/api/v1/attendance/student/${studentB1._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Không tìm thấy học sinh');
    });

    test('3.6 Tenant A getting attendance of Tenant B classroom returns 404', async () => {
      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);
      const res = await request(saasApp)
        .get(`/api/v1/attendance/class/${classroomB1._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Không tìm thấy lớp học');
    });

    test('3.7 Tenant A updating Tenant B attendance record returns 404', async () => {
      const today = getWorkDate();
      const { start } = getWorkDateRange(today, DEFAULT_SCHOOL_TIMEZONE);
      const attB = await StudentAttendance.create({
        tenantId: tenantB._id,
        studentId: studentB1._id,
        studentName: studentB1.fullName,
        classroomId: classroomB1._id,
        className: classroomB1.name,
        attendDate: start,
        attendanceDateKey: today,
        status: 'present',
        attendanceMethod: 'manual',
        recordedBy: adminB._id,
        recordedByName: 'Admin B'
      });

      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);
      const res = await request(saasApp)
        .put(`/api/v1/attendance/${attB._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ status: 'late' });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Không tìm thấy bản ghi điểm danh');
    });

    test('3.8 Tenant A deleting Tenant B attendance record returns 404', async () => {
      const today = getWorkDate();
      const { start } = getWorkDateRange(today, DEFAULT_SCHOOL_TIMEZONE);
      const attB = await StudentAttendance.create({
        tenantId: tenantB._id,
        studentId: studentB1._id,
        studentName: studentB1.fullName,
        classroomId: classroomB1._id,
        className: classroomB1.name,
        attendDate: start,
        attendanceDateKey: today,
        status: 'present',
        attendanceMethod: 'manual',
        recordedBy: adminB._id,
        recordedByName: 'Admin B'
      });

      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);
      const res = await request(saasApp)
        .delete(`/api/v1/attendance/${attB._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Không tìm thấy bản ghi điểm danh');
    });

    test('3.9 Tenant A transferring Tenant B student returns 404', async () => {
      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);
      const res = await request(saasApp)
        .post(`/api/v1/students/${studentB1._id}/transfer`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .set('Idempotency-Key', 'TRANSFER-CROSS-TENANT-KEY01')
        .send({
          toClassroomId: classroomA2._id.toString(),
          reason: 'Chuyển trái phép',
          effectiveDate: getWorkDate()
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Không tìm thấy học sinh');
    });

    test('3.10 Tenant A transferring student into Tenant B classroom returns 404', async () => {
      const tokenAdminA = generateSchoolUserToken(adminA, tenantA);
      const res = await request(saasApp)
        .post(`/api/v1/students/${studentA1._id}/transfer`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .set('Idempotency-Key', 'TRANSFER-CROSS-TENANT-KEY02')
        .send({
          toClassroomId: classroomB1._id.toString(),
          reason: 'Chuyển sang trường B',
          effectiveDate: getWorkDate()
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Không tìm thấy lớp chuyển đến');
    });
  });

  // =======================================================================
  // 4. Session Verification & Security Boundary
  // =======================================================================
  describe('4. Session Verification & Security Boundary', () => {

    test('4.1 Missing access token returns 401 on attendance and transfer endpoints', async () => {
      const endpoints = [
        ['post', '/api/v1/attendance'],
        ['post', '/api/attendance'],
        ['post', '/api/v1/attendance/bulk'],
        ['post', '/api/v1/attendance/check-in'],
        ['post', '/api/v1/attendance/leave-requests'],
        ['get', '/api/v1/attendance/leave-requests'],
        ['get', '/api/v1/attendance/reports/absence'],
        ['get', `/api/v1/attendance/student/${studentA1._id}`],
        ['get', `/api/v1/attendance/class/${classroomA1._id}`],
        ['put', `/api/v1/attendance/${new mongoose.Types.ObjectId()}`],
        ['delete', `/api/v1/attendance/${new mongoose.Types.ObjectId()}`],
        ['post', `/api/v1/students/${studentA1._id}/transfer`]
      ];

      for (const [method, url] of endpoints) {
        const res = await request(saasApp)[method](url);
        expect(res.status).toBe(401);
        expect(res.body.message).toContain('Vui lòng cung cấp access token');
      }
    });

    test('4.2 Malformed or invalid signature token returns 401 TOKEN_INVALID', async () => {
      const res = await request(saasApp)
        .get('/api/v1/attendance/leave-requests')
        .set('Authorization', 'Bearer malformed.jwt.token');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('TOKEN_INVALID');
    });

    test('4.3 Expired token returns 401 TOKEN_INVALID', async () => {
      const expiredToken = generateSchoolUserToken(adminA, tenantA, '-1s');
      const res = await request(saasApp)
        .get('/api/v1/attendance/leave-requests')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('TOKEN_INVALID');
    });

    test('4.4 Suspended tenant returns 403 TENANT_SUSPENDED', async () => {
      const token = generateSchoolUserToken(userSuspended, tenantSuspended);
      const res = await request(saasApp)
        .get('/api/v1/attendance/leave-requests')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TENANT_SUSPENDED');
    });

    test('4.5 Terminated tenant returns 403 TENANT_SUSPENDED', async () => {
      const token = generateSchoolUserToken(userTerminated, tenantTerminated);
      const res = await request(saasApp)
        .get('/api/v1/attendance/leave-requests')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TENANT_SUSPENDED');
    });

    test('4.6 Incremented tenant authVersion (school logout) returns 403 TENANT_AUTH_REVOKED', async () => {
      const token = generateSchoolUserToken(adminA, tenantA);
      await Tenant.updateOne({ _id: tenantA._id }, { $inc: { authVersion: 1 } });

      const res = await request(saasApp)
        .get('/api/v1/attendance/leave-requests')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TENANT_AUTH_REVOKED');
    });

    test('4.7 Revoked session (jti in RevokedSession) returns 401 SESSION_REVOKED', async () => {
      const token = generateSchoolUserToken(adminA, tenantA);
      const decoded = jwt.decode(token);

      await RevokedSession.create({
        jti: decoded.jti,
        userId: adminA._id,
        tenantId: tenantA._id,
        reason: 'User manual logout',
        expiresAt: new Date(Date.now() + 86400000)
      });

      const res = await request(saasApp)
        .get('/api/v1/attendance/leave-requests')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('SESSION_REVOKED');
    });

    test('4.8 Inactive user returns 401 USER_INACTIVE', async () => {
      const token = generateSchoolUserToken(inactiveUserA, tenantA);
      const res = await request(saasApp)
        .get('/api/v1/attendance/leave-requests')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('USER_INACTIVE');
    });

    test('4.9 User authVersion mismatch returns 401 AUTH_VERSION_MISMATCH', async () => {
      const token = generateSchoolUserToken(adminA, tenantA);
      await User.updateOne({ _id: adminA._id }, { $inc: { authVersion: 1 } });

      const res = await request(saasApp)
        .get('/api/v1/attendance/leave-requests')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTH_VERSION_MISMATCH');
    });

    test('4.10 Wrong token purpose returns 403 INVALID_TOKEN_PURPOSE', async () => {
      const platformToken = generatePlatformAdminToken(platformAdmin);
      const res = await request(saasApp)
        .get('/api/v1/attendance/leave-requests')
        .set('Authorization', `Bearer ${platformToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INVALID_TOKEN_PURPOSE');

      const mfaToken = generateMfaChallengeToken(platformAdmin);
      const resMfa = await request(saasApp)
        .get('/api/v1/attendance/leave-requests')
        .set('Authorization', `Bearer ${mfaToken}`);

      expect(resMfa.status).toBe(403);
      expect(resMfa.body.code).toBe('INVALID_TOKEN_PURPOSE');
    });

    test('4.11 SUPPORT_ACCESS token returns 501 SUPPORT_ACCESS_NOT_IMPLEMENTED', async () => {
      const supportToken = generateSupportAccessToken(platformAdmin, tenantA);
      const res = await request(saasApp)
        .get('/api/v1/attendance/leave-requests')
        .set('Authorization', `Bearer ${supportToken}`);

      expect(res.status).toBe(501);
      expect(res.body.code).toBe('SUPPORT_ACCESS_NOT_IMPLEMENTED');
    });

    test('4.12 Forged X-Tenant-Id header is ignored in favor of token claims', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      // Attempt to spoof Tenant B via header
      const res = await request(saasApp)
        .get('/api/v1/attendance/leave-requests')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantB._id.toString());

      expect(res.status).toBe(200);
      // Confirms operation ran authoritatively against Tenant A
      expect(res.body.data.every((r) => r.tenantId === tenantA._id.toString())).toBe(true);
    });
  });

  // =======================================================================
  // 5. Route Shadowing and Fail-Closed (HTTP 501)
  // =======================================================================
  describe('5. Route Shadowing and Fail-Closed Protection (HTTP 501)', () => {

    test('5.1 Reserved single-segment paths fall through to 501 on unapproved methods (with & without auth)', async () => {
      const tokenA = generateSchoolUserToken(adminA, tenantA);

      const reservedAttendanceCases = [
        { method: 'put', url: '/api/v1/attendance/bulk' },
        { method: 'delete', url: '/api/v1/attendance/bulk' },
        { method: 'put', url: '/api/v1/attendance/check-in' },
        { method: 'delete', url: '/api/v1/attendance/check-in' },
        { method: 'put', url: '/api/v1/attendance/leave-requests' },
        { method: 'delete', url: '/api/v1/attendance/leave-requests' },
        { method: 'put', url: '/api/v1/attendance/reports' },
        { method: 'delete', url: '/api/v1/attendance/reports' },
        { method: 'get', url: '/api/v1/attendance/export' },
        { method: 'post', url: '/api/v1/attendance/export' },
        { method: 'get', url: '/api/v1/attendance/template' },
        { method: 'post', url: '/api/v1/attendance/template' },
        { method: 'put', url: '/api/v1/attendance/student' },
        { method: 'delete', url: '/api/v1/attendance/student' },
        { method: 'put', url: '/api/v1/attendance/class' },
        { method: 'delete', url: '/api/v1/attendance/class' },
        // Aliases
        { method: 'put', url: '/api/attendance/bulk' },
        { method: 'delete', url: '/api/attendance/bulk' }
      ];

      for (const { method, url } of reservedAttendanceCases) {
        // Authenticated: must NOT be captured by /:id returning 400
        const resAuth = await request(saasApp)[method](url)
          .set('Authorization', `Bearer ${tokenA}`);
        expect(resAuth.status).toBe(501);
        expect(resAuth.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');

        // Unauthenticated: must NOT be intercepted by schoolAuthMiddleware returning 401
        const resNoAuth = await request(saasApp)[method](url);
        expect(resNoAuth.status).toBe(501);
      }
    });

    test('5.2 Genuine detail attempts with malformed IDs continue to controller returning 400', async () => {
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);

      // PUT /attendance/invalid-id -> 400
      const resPut = await request(saasApp)
        .put('/api/v1/attendance/not-a-valid-objectid')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ status: 'present' });
      expect(resPut.status).toBe(400);

      // DELETE /attendance/invalid-id -> 400
      const resDel = await request(saasApp)
        .delete('/api/v1/attendance/not-a-valid-objectid')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resDel.status).toBe(400);

      // PATCH /attendance/leave-requests/invalid-id/review -> 400
      const resReview = await request(saasApp)
        .patch('/api/v1/attendance/leave-requests/not-a-valid-objectid/review')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ decision: 'approved' });
      expect(resReview.status).toBe(400);

      // GET /attendance/student/invalid-id -> 400
      const resStudent = await request(saasApp)
        .get('/api/v1/attendance/student/not-a-valid-objectid')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resStudent.status).toBe(400);

      // GET /attendance/class/invalid-id -> 400
      const resClass = await request(saasApp)
        .get('/api/v1/attendance/class/not-a-valid-objectid')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resClass.status).toBe(400);

      // POST /students/invalid-id/transfer -> 400
      const resTransfer = await request(saasApp)
        .post('/api/v1/students/not-a-valid-objectid/transfer')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .set('Idempotency-Key', 'TRANSFER-MALFORMED-ID-KEY1234')
        .send({ toClassroomId: classroomA2._id.toString() });
      expect(resTransfer.status).toBe(400);
    });

    test('5.3 Reserved student routes and unapproved transfer methods fall through to 501', async () => {
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);

      // POST /students/transfer (missing student ID, :id is 'transfer') -> 501
      const res1 = await request(saasApp)
        .post('/api/v1/students/transfer')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res1.status).toBe(501);

      // POST /students/export/transfer (:id is 'export') -> 501
      const res2 = await request(saasApp)
        .post('/api/v1/students/export/transfer')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res2.status).toBe(501);

      // Unapproved methods on transfer endpoint -> 501
      const unapprovedTransferMethods = [
        ['get', `/api/v1/students/${studentA1._id}/transfer`],
        ['put', `/api/v1/students/${studentA1._id}/transfer`],
        ['patch', `/api/v1/students/${studentA1._id}/transfer`],
        ['delete', `/api/v1/students/${studentA1._id}/transfer`]
      ];

      for (const [method, url] of unapprovedTransferMethods) {
        const res = await request(saasApp)[method](url)
          .set('Authorization', `Bearer ${tokenAdmin}`);
        expect(res.status).toBe(501);
      }
    });

    test('5.4 Unapproved methods/subroutes on attendance module return 501', async () => {
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);

      const unapprovedRoutes = [
        ['get', '/api/v1/attendance'],
        ['get', '/api/attendance'],
        ['get', `/api/v1/attendance/${new mongoose.Types.ObjectId()}`],
        ['post', `/api/v1/attendance/${new mongoose.Types.ObjectId()}`],
        ['get', `/api/v1/attendance/leave-requests/${new mongoose.Types.ObjectId()}`],
        ['post', '/api/v1/attendance/reports/absence'],
        ['put', '/api/v1/attendance/reports/absence'],
        ['post', `/api/v1/attendance/student/${studentA1._id}`],
        ['put', `/api/v1/attendance/student/${studentA1._id}`],
        ['delete', `/api/v1/attendance/student/${studentA1._id}`],
        ['post', `/api/v1/attendance/class/${classroomA1._id}`],
        ['put', `/api/v1/attendance/class/${classroomA1._id}`],
        ['delete', `/api/v1/attendance/class/${classroomA1._id}`]
      ];

      for (const [method, url] of unapprovedRoutes) {
        const res = await request(saasApp)[method](url)
          .set('Authorization', `Bearer ${tokenAdmin}`);
        expect(res.status).toBe(501);
      }
    });

    test('5.5 Hardware device ingest endpoints return 501', async () => {
      const hardwareEndpoints = [
        ['post', '/api/v1/attendance/device-events'],
        ['post', '/api/attendance/device-events'],
        ['post', '/api/v1/timekeeping/device-events'],
        ['post', '/api/timekeeping/device-events']
      ];

      for (const [method, url] of hardwareEndpoints) {
        const res = await request(saasApp)[method](url)
          .send({ deviceSecret: 'some-hardware-secret', events: [] });
        expect(res.status).toBe(501);
      }
    });

    test('5.6 No route outside 1C opens (finance, hr, timekeeping, nutrition remain 501)', async () => {
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);

      const non1CRoutes = [
        '/api/v1/finance',
        '/api/finance',
        '/api/v1/finance/invoices',
        '/api/v1/finance/tuition',
        '/api/v1/hr',
        '/api/v1/hr/employees',
        '/api/v1/hr/departments',
        '/api/v1/timekeeping',
        '/api/v1/timekeeping/daily',
        '/api/v1/system',
        '/api/v1/nutrition'
      ];

      for (const route of non1CRoutes) {
        const res = await request(saasApp)
          .get(route)
          .set('Authorization', `Bearer ${tokenAdmin}`);
        expect(res.status).toBe(501);
      }
    });
  });

  // =======================================================================
  // 6. Writes & Transactions Invariants
  // =======================================================================
  describe('6. Writes & Transactions Invariants', () => {

    test('6.1 Student transfer requires valid Idempotency-Key header (16-128 chars)', async () => {
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);

      // Missing Idempotency-Key
      const resMissing = await request(saasApp)
        .post(`/api/v1/students/${studentA1._id}/transfer`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          toClassroomId: classroomA2._id.toString(),
          reason: 'Thiếu idempotency header'
        });
      expect(resMissing.status).toBe(400);
      expect(resMissing.body.message).toContain('Idempotency-Key');

      // Too short (< 16 chars)
      const resShort = await request(saasApp)
        .post(`/api/v1/students/${studentA1._id}/transfer`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .set('Idempotency-Key', 'short-key')
        .send({
          toClassroomId: classroomA2._id.toString(),
          reason: 'Khóa quá ngắn'
        });
      expect(resShort.status).toBe(400);

      // Invalid characters
      const resInvalidChars = await request(saasApp)
        .post(`/api/v1/students/${studentA1._id}/transfer`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .set('Idempotency-Key', 'invalid key with spaces!!@#$')
        .send({
          toClassroomId: classroomA2._id.toString(),
          reason: 'Khóa chứa ký tự sai'
        });
      expect(resInvalidChars.status).toBe(400);
    });

    test('6.2 Student transfer fails if destination classroom is same as current classroom', async () => {
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);

      const res = await request(saasApp)
        .post(`/api/v1/students/${studentA1._id}/transfer`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .set('Idempotency-Key', 'TRANSFER-SAME-CLASS-KEY1234')
        .send({
          toClassroomId: classroomA1._id.toString(), // Same class
          reason: 'Chuyển vào chính lớp hiện tại'
        });

      expect(res.status).toBe(422);
      expect(res.body.message).toContain('Lớp mới phải khác lớp hiện tại');
    });

    test('6.3 Student transfer fails if student is not enrolled', async () => {
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);
      await Student.updateOne({ _id: studentA1._id }, { status: 'withdrawn' });

      const res = await request(saasApp)
        .post(`/api/v1/students/${studentA1._id}/transfer`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .set('Idempotency-Key', 'TRANSFER-NOT-ENROLLED-KEY12')
        .send({
          toClassroomId: classroomA2._id.toString(),
          reason: 'Học sinh đã rút hồ sơ'
        });

      expect(res.status).toBe(422);
      expect(res.body.message).toContain('Chỉ được chuyển lớp cho học sinh đang theo học');
    });
  });

  // =======================================================================
  // 7. Mode Compatibility & Earlier Phase Isolation (Default vs 1A vs 1B vs 1C)
  // =======================================================================
  describe('7. Mode Compatibility & Earlier Phase Isolation (Default vs 1A vs 1B vs 1C)', () => {

    test('7.1 Explicit phase1b mode does not gain writes: transfer and attendance return 501 with and without auth for both aliases, reads work (200), zero mutations', async () => {
      const app1B = createSaasApp({ mongoUri, connection: bootstrapInstance.connection, saasMode: 'phase1b' });
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);
      const tokenTeacher = generateSchoolUserToken(teacherA1, tenantA);

      const initialTransferCount = await StudentTransferHistory.countDocuments({ tenantId: tenantA._id });
      const initialAttendanceCount = await StudentAttendance.countDocuments({ tenantId: tenantA._id });
      const studentInitial = await Student.findById(studentA1._id).lean();

      // Student transfer is gated at 501 in phase1b - test both aliases with and without auth
      for (const prefix of ['/api/v1', '/api']) {
        // With auth
        const resWithAuth = await request(app1B)
          .post(`${prefix}/students/${studentA1._id}/transfer`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .set('Idempotency-Key', `TRANSFER-1B-${prefix.replace('/', '')}-AUTH`)
          .send({ toClassroomId: classroomA2._id.toString() });
        expect(resWithAuth.status).toBe(501);
        expect(resWithAuth.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');

        // Without auth
        const resWithoutAuth = await request(app1B)
          .post(`${prefix}/students/${studentA1._id}/transfer`)
          .set('Idempotency-Key', `TRANSFER-1B-${prefix.replace('/', '')}-NOAUTH`)
          .send({ toClassroomId: classroomA2._id.toString() });
        expect(resWithoutAuth.status).toBe(501);
        expect(resWithoutAuth.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
      }

      // Attendance routes are gated at 501 in phase1b - test both aliases with and without auth
      for (const prefix of ['/api/v1', '/api']) {
        // Attendance POST with auth
        const resAttAuth = await request(app1B)
          .post(`${prefix}/attendance`)
          .set('Authorization', `Bearer ${tokenTeacher}`)
          .send({ studentId: studentA1._id.toString(), status: 'present' });
        expect(resAttAuth.status).toBe(501);
        expect(resAttAuth.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');

        // Attendance POST without auth
        const resAttNoAuth = await request(app1B)
          .post(`${prefix}/attendance`)
          .send({ studentId: studentA1._id.toString(), status: 'present' });
        expect(resAttNoAuth.status).toBe(501);
        expect(resAttNoAuth.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');

        // Attendance GET with auth
        const resGetAuth = await request(app1B)
          .get(`${prefix}/attendance/leave-requests`)
          .set('Authorization', `Bearer ${tokenAdmin}`);
        expect(resGetAuth.status).toBe(501);

        // Attendance GET without auth
        const resGetNoAuth = await request(app1B)
          .get(`${prefix}/attendance/leave-requests`);
        expect(resGetNoAuth.status).toBe(501);
      }

      // Zero mutations verification
      const studentAfter = await Student.findById(studentA1._id).lean();
      expect(studentAfter.classroomId.toString()).toBe(studentInitial.classroomId.toString());
      expect(await StudentTransferHistory.countDocuments({ tenantId: tenantA._id })).toBe(initialTransferCount);
      expect(await StudentAttendance.countDocuments({ tenantId: tenantA._id })).toBe(initialAttendanceCount);

      // But approved 1B read routes remain fully operational (200) with auth
      for (const prefix of ['/api/v1', '/api']) {
        const resReadStudents = await request(app1B)
          .get(`${prefix}/students`)
          .set('Authorization', `Bearer ${tokenAdmin}`);
        expect(resReadStudents.status).toBe(200);

        const resReadClasses = await request(app1B)
          .get(`${prefix}/classrooms`)
          .set('Authorization', `Bearer ${tokenAdmin}`);
        expect(resReadClasses.status).toBe(200);
      }
    });

    test('7.2 Explicit phase1a mode gates classrooms, students, and attendance at 501 for both aliases with and without auth', async () => {
      const app1A = createSaasApp({ mongoUri, connection: bootstrapInstance.connection, saasMode: 'phase1a' });
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);

      for (const prefix of ['/api/v1', '/api']) {
        // Reads fail-closed 501 (with and without auth)
        const resStudentsAuth = await request(app1A)
          .get(`${prefix}/students`)
          .set('Authorization', `Bearer ${tokenAdmin}`);
        expect(resStudentsAuth.status).toBe(501);

        const resStudentsNoAuth = await request(app1A)
          .get(`${prefix}/students`);
        expect(resStudentsNoAuth.status).toBe(501);

        const resClassroomsAuth = await request(app1A)
          .get(`${prefix}/classrooms`)
          .set('Authorization', `Bearer ${tokenAdmin}`);
        expect(resClassroomsAuth.status).toBe(501);

        const resClassroomsNoAuth = await request(app1A)
          .get(`${prefix}/classrooms`);
        expect(resClassroomsNoAuth.status).toBe(501);

        // Attendance fail-closed 501 (with and without auth)
        const resAttendanceAuth = await request(app1A)
          .get(`${prefix}/attendance/leave-requests`)
          .set('Authorization', `Bearer ${tokenAdmin}`);
        expect(resAttendanceAuth.status).toBe(501);

        const resAttendanceNoAuth = await request(app1A)
          .get(`${prefix}/attendance/leave-requests`);
        expect(resAttendanceNoAuth.status).toBe(501);
      }
    });

    test('7.3 Default mode (no options, env unset) defaults to phase1b (reads work, writes fail-closed with 501, zero mutations)', async () => {
      const originalEnv = process.env.SAAS_MODE;
      delete process.env.SAAS_MODE;

      try {
        const appDefault = createSaasApp({ mongoUri, connection: bootstrapInstance.connection });
        const tokenAdmin = generateSchoolUserToken(adminA, tenantA);

        const initialTransferCount = await StudentTransferHistory.countDocuments({ tenantId: tenantA._id });
        const initialAttendanceCount = await StudentAttendance.countDocuments({ tenantId: tenantA._id });
        const studentInitial = await Student.findById(studentA1._id).lean();

        for (const prefix of ['/api/v1', '/api']) {
          // Writes fail closed (501) with auth
          const resTransfer = await request(appDefault)
            .post(`${prefix}/students/${studentA1._id}/transfer`)
            .set('Authorization', `Bearer ${tokenAdmin}`)
            .set('Idempotency-Key', `TRANSFER-DEFAULT-MODE-KEY-${prefix.replace('/', '')}`)
            .send({ toClassroomId: classroomA2._id.toString() });
          expect(resTransfer.status).toBe(501);

          // Writes fail closed (501) without auth
          const resTransferNoAuth = await request(appDefault)
            .post(`${prefix}/students/${studentA1._id}/transfer`)
            .send({ toClassroomId: classroomA2._id.toString() });
          expect(resTransferNoAuth.status).toBe(501);

          const resAttendance = await request(appDefault)
            .post(`${prefix}/attendance`)
            .set('Authorization', `Bearer ${tokenAdmin}`)
            .send({ studentId: studentA1._id.toString() });
          expect(resAttendance.status).toBe(501);

          const resAttendanceNoAuth = await request(appDefault)
            .post(`${prefix}/attendance`)
            .send({ studentId: studentA1._id.toString() });
          expect(resAttendanceNoAuth.status).toBe(501);

          // Reads work (200)
          const resRead = await request(appDefault)
            .get(`${prefix}/students`)
            .set('Authorization', `Bearer ${tokenAdmin}`);
          expect(resRead.status).toBe(200);
        }

        // Zero mutations verification
        const studentAfter = await Student.findById(studentA1._id).lean();
        expect(studentAfter.classroomId.toString()).toBe(studentInitial.classroomId.toString());
        expect(await StudentTransferHistory.countDocuments({ tenantId: tenantA._id })).toBe(initialTransferCount);
        expect(await StudentAttendance.countDocuments({ tenantId: tenantA._id })).toBe(initialAttendanceCount);
      } finally {
        process.env.SAAS_MODE = originalEnv;
      }
    });

    test('7.4 Unknown mode ("unknown") fails closed: read modules, attendance, and transfer writes return 501 for both aliases with and without auth, with zero mutations', async () => {
      const appUnknown = createSaasApp({ mongoUri, connection: bootstrapInstance.connection, saasMode: 'unknown' });
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);
      const tokenTeacher = generateSchoolUserToken(teacherA1, tenantA);

      const initialTransferCount = await StudentTransferHistory.countDocuments({ tenantId: tenantA._id });
      const initialAttendanceCount = await StudentAttendance.countDocuments({ tenantId: tenantA._id });
      const initialLeaveCount = await StudentLeaveRequest.countDocuments({ tenantId: tenantA._id });
      const studentInitial = await Student.findById(studentA1._id).lean();

      for (const prefix of ['/api/v1', '/api']) {
        // 1. Read modules fail-closed 501
        const resStudentsAuth = await request(appUnknown).get(`${prefix}/students`).set('Authorization', `Bearer ${tokenAdmin}`);
        expect(resStudentsAuth.status).toBe(501);
        expect(resStudentsAuth.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');

        const resStudentsNoAuth = await request(appUnknown).get(`${prefix}/students`);
        expect(resStudentsNoAuth.status).toBe(501);

        const resClassroomsAuth = await request(appUnknown).get(`${prefix}/classrooms`).set('Authorization', `Bearer ${tokenAdmin}`);
        expect(resClassroomsAuth.status).toBe(501);

        const resClassroomsNoAuth = await request(appUnknown).get(`${prefix}/classrooms`);
        expect(resClassroomsNoAuth.status).toBe(501);

        // 2. Student transfer write fails-closed 501
        const resTransferAuth = await request(appUnknown)
          .post(`${prefix}/students/${studentA1._id}/transfer`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .set('Idempotency-Key', `TRANSFER-UNKNOWN-${prefix.replace('/', '')}-AUTH`)
          .send({ toClassroomId: classroomA2._id.toString() });
        expect(resTransferAuth.status).toBe(501);
        expect(resTransferAuth.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');

        const resTransferNoAuth = await request(appUnknown)
          .post(`${prefix}/students/${studentA1._id}/transfer`)
          .set('Idempotency-Key', `TRANSFER-UNKNOWN-${prefix.replace('/', '')}-NOAUTH`)
          .send({ toClassroomId: classroomA2._id.toString() });
        expect(resTransferNoAuth.status).toBe(501);

        // 3. Attendance endpoints fail-closed 501
        const resAttAuth = await request(appUnknown)
          .post(`${prefix}/attendance`)
          .set('Authorization', `Bearer ${tokenTeacher}`)
          .send({ studentId: studentA1._id.toString(), status: 'present' });
        expect(resAttAuth.status).toBe(501);
        expect(resAttAuth.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');

        const resAttNoAuth = await request(appUnknown)
          .post(`${prefix}/attendance`)
          .send({ studentId: studentA1._id.toString(), status: 'present' });
        expect(resAttNoAuth.status).toBe(501);

        const resLeaveAuth = await request(appUnknown)
          .post(`${prefix}/attendance/leave-requests`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send({ studentId: studentA1._id.toString(), reason: 'Sick', fromDate: '2026-11-05', toDate: '2026-11-06' });
        expect(resLeaveAuth.status).toBe(501);

        const resLeaveNoAuth = await request(appUnknown)
          .post(`${prefix}/attendance/leave-requests`)
          .send({ studentId: studentA1._id.toString(), reason: 'Sick', fromDate: '2026-11-05', toDate: '2026-11-06' });
        expect(resLeaveNoAuth.status).toBe(501);
      }

      // Zero mutations verification
      const studentAfter = await Student.findById(studentA1._id).lean();
      expect(studentAfter.classroomId.toString()).toBe(studentInitial.classroomId.toString());
      expect(await StudentTransferHistory.countDocuments({ tenantId: tenantA._id })).toBe(initialTransferCount);
      expect(await StudentAttendance.countDocuments({ tenantId: tenantA._id })).toBe(initialAttendanceCount);
      expect(await StudentLeaveRequest.countDocuments({ tenantId: tenantA._id })).toBe(initialLeaveCount);
    });

    test('7.5 Typo mode ("phase1c ") fails closed: returns 501 for both aliases with and without auth, with zero mutations', async () => {
      const appTypo = createSaasApp({ mongoUri, connection: bootstrapInstance.connection, saasMode: 'phase1c ' });
      const tokenAdmin = generateSchoolUserToken(adminA, tenantA);

      const initialTransferCount = await StudentTransferHistory.countDocuments({ tenantId: tenantA._id });
      const initialAttendanceCount = await StudentAttendance.countDocuments({ tenantId: tenantA._id });
      const studentInitial = await Student.findById(studentA1._id).lean();

      for (const prefix of ['/api/v1', '/api']) {
        // Reads fail 501
        const resReadAuth = await request(appTypo).get(`${prefix}/students`).set('Authorization', `Bearer ${tokenAdmin}`);
        expect(resReadAuth.status).toBe(501);

        const resReadNoAuth = await request(appTypo).get(`${prefix}/students`);
        expect(resReadNoAuth.status).toBe(501);

        // Transfer fails 501
        const resTransferAuth = await request(appTypo)
          .post(`${prefix}/students/${studentA1._id}/transfer`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send({ toClassroomId: classroomA2._id.toString() });
        expect(resTransferAuth.status).toBe(501);

        const resTransferNoAuth = await request(appTypo)
          .post(`${prefix}/students/${studentA1._id}/transfer`)
          .send({ toClassroomId: classroomA2._id.toString() });
        expect(resTransferNoAuth.status).toBe(501);

        // Attendance fails 501
        const resAttAuth = await request(appTypo)
          .post(`${prefix}/attendance`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send({ studentId: studentA1._id.toString(), status: 'present' });
        expect(resAttAuth.status).toBe(501);

        const resAttNoAuth = await request(appTypo)
          .post(`${prefix}/attendance`)
          .send({ studentId: studentA1._id.toString(), status: 'present' });
        expect(resAttNoAuth.status).toBe(501);
      }

      // Zero mutations
      const studentAfter = await Student.findById(studentA1._id).lean();
      expect(studentAfter.classroomId.toString()).toBe(studentInitial.classroomId.toString());
      expect(await StudentTransferHistory.countDocuments({ tenantId: tenantA._id })).toBe(initialTransferCount);
      expect(await StudentAttendance.countDocuments({ tenantId: tenantA._id })).toBe(initialAttendanceCount);
    });

    test('7.6 Future modes ("phase1f", "phase1g") fail closed: do not pre-enable routes, return 501 for both aliases with and without auth, zero mutations', async () => {
      for (const futureMode of ['phase1f', 'phase1g']) {
        const appFuture = createSaasApp({ mongoUri, connection: bootstrapInstance.connection, saasMode: futureMode });
        const tokenAdmin = generateSchoolUserToken(adminA, tenantA);

        const initialTransferCount = await StudentTransferHistory.countDocuments({ tenantId: tenantA._id });
        const initialAttendanceCount = await StudentAttendance.countDocuments({ tenantId: tenantA._id });
        const studentInitial = await Student.findById(studentA1._id).lean();

        for (const prefix of ['/api/v1', '/api']) {
          // Reads fail 501
          const resReadAuth = await request(appFuture).get(`${prefix}/students`).set('Authorization', `Bearer ${tokenAdmin}`);
          expect(resReadAuth.status).toBe(501);

          const resReadNoAuth = await request(appFuture).get(`${prefix}/students`);
          expect(resReadNoAuth.status).toBe(501);

          // Transfer fails 501
          const resTransferAuth = await request(appFuture)
            .post(`${prefix}/students/${studentA1._id}/transfer`)
            .set('Authorization', `Bearer ${tokenAdmin}`)
            .send({ toClassroomId: classroomA2._id.toString() });
          expect(resTransferAuth.status).toBe(501);

          const resTransferNoAuth = await request(appFuture)
            .post(`${prefix}/students/${studentA1._id}/transfer`)
            .send({ toClassroomId: classroomA2._id.toString() });
          expect(resTransferNoAuth.status).toBe(501);

          // Attendance fails 501
          const resAttAuth = await request(appFuture)
            .post(`${prefix}/attendance`)
            .set('Authorization', `Bearer ${tokenAdmin}`)
            .send({ studentId: studentA1._id.toString(), status: 'present' });
          expect(resAttAuth.status).toBe(501);

          const resAttNoAuth = await request(appFuture)
            .post(`${prefix}/attendance`)
            .send({ studentId: studentA1._id.toString(), status: 'present' });
          expect(resAttNoAuth.status).toBe(501);
        }

        // Zero mutations
        const studentAfter = await Student.findById(studentA1._id).lean();
        expect(studentAfter.classroomId.toString()).toBe(studentInitial.classroomId.toString());
        expect(await StudentTransferHistory.countDocuments({ tenantId: tenantA._id })).toBe(initialTransferCount);
        expect(await StudentAttendance.countDocuments({ tenantId: tenantA._id })).toBe(initialAttendanceCount);
      }
    });

    test('7.7 Request-time isolation avoids environment fallback when app mode was already configured', async () => {
      // Set process.env.SAAS_MODE to 'phase1c'
      const originalEnv = process.env.SAAS_MODE;
      process.env.SAAS_MODE = 'phase1c';

      try {
        // App explicitly configured in 'phase1b'
        const app1B = createSaasApp({ mongoUri, connection: bootstrapInstance.connection, saasMode: 'phase1b' });
        const tokenAdmin = generateSchoolUserToken(adminA, tenantA);

        // Even though process.env.SAAS_MODE is 'phase1c', requests to app1B MUST NOT gain writes!
        const resTransfer = await request(app1B)
          .post(`/api/v1/students/${studentA1._id}/transfer`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send({ toClassroomId: classroomA2._id.toString() });
        expect(resTransfer.status).toBe(501);

        const resAtt = await request(app1B)
          .post('/api/v1/attendance')
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send({ studentId: studentA1._id.toString() });
        expect(resAtt.status).toBe(501);
      } finally {
        process.env.SAAS_MODE = originalEnv;
      }
    });
  });
});
