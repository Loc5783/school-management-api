/**
 * Task 1C.5: FINAL INTEGRATION ACCEPTANCE TEST SUITE
 * Multi-Tenant Attendance, Leave Request Transactions, Student Transfer & Foreign-ID Rejection
 *
 * Verifies end-to-end multi-tenant behavior on createSaasApp with MongoMemoryReplSet:
 * ONE complete actual HTTP workflow per Tenant A and Tenant B:
 *   1. Attendance creation and query
 *   2. Parent leave request submission & admin review/approval with automated attendance generation
 *   3. Student classroom transfer with shared raw Idempotency-Key across A and B & replay verification
 *   4. Verify capacity counts & transfer history invariants
 *   5. Strict foreign-ID rejection across all workflow stages (404 Invisible)
 */

process.env.JWT_SECRET = 'acceptance-test-jwt-secret-minimum-32-characters-long!';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';
process.env.SAAS_MODE = 'phase1c';
process.env.TENANT_FEATURE_READINESS = 'false';

jest.setTimeout(60000);

const mongoose = require('mongoose');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const createSaasApp = require('../../src/saas/createSaasApp');
const testDbBootstrap = require('../../src/saas/testDbBootstrap');

const { generateSchoolUserToken } = require('../../src/saas/utils/saasJwt');
const { getWorkDate, addWorkDays, DEFAULT_SCHOOL_TIMEZONE } = require('../../src/utils/dateHelpers');

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

let tenantA, tenantB;
let adminA, teacherA1, teacherA2, parentA1;
let adminB, teacherB1, teacherB2, parentB1;

let classroomA1, classroomA2;
let classroomB1, classroomB2;

let studentA1;
let studentB1;

beforeAll(async () => {
  bootstrapInstance = await testDbBootstrap.startTestDb({
    instanceOpts: [{ dbName: 'school_saas_phase1c5_acceptance_test' }]
  });
  mongoUri = bootstrapInstance.uri;
  saasApp = createSaasApp({ mongoUri, connection: bootstrapInstance.connection, saasMode: 'phase1c' });

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

  // 2. Users - Tenant A
  adminA = await User.create({
    tenantId: tenantA._id,
    username: 'admin_a',
    passwordHash,
    role: 'admin',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Admin Trường A' }
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

  // 3. Users - Tenant B
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

  teacherB2 = await User.create({
    tenantId: tenantB._id,
    username: 'teacher_b2',
    passwordHash,
    role: 'teacher',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Giáo Viên B2' }
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

  // 4. Classrooms
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
    currentEnrollment: 8,
    statistics: { currentStudents: 8 },
    homeroomTeacherId: teacherB1._id,
    teachers: [{ teacherId: teacherB1._id }],
    status: 'active',
    tenantId: tenantB._id
  });

  classroomB2 = await Classroom.create({
    name: 'Lớp Chồi 1B',
    schoolYear: '2026-2027',
    ageGroup: '4-5',
    maxSize: 25,
    currentEnrollment: 4,
    statistics: { currentStudents: 4 },
    homeroomTeacherId: teacherB2._id,
    teachers: [{ teacherId: teacherB2._id }],
    status: 'active',
    tenantId: tenantB._id
  });

  // 5. Students
  studentA1 = await Student.create({
    fullName: 'Nguyễn Văn An',
    studentCode: 'HS-2026-000001',
    birthDate: new Date('2021-02-15'),
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
    fullName: 'Lê Hoàng Cường',
    studentCode: 'HS-2026-000002',
    birthDate: new Date('2021-03-10'),
    gender: 'male',
    status: 'enrolled',
    admissionDate: new Date('2026-09-01'),
    enrollmentDate: new Date('2026-09-01'),
    schoolYear: '2026-2027',
    classroomId: classroomB1._id,
    className: classroomB1.name,
    tenantId: tenantB._id
  });

  // 6. User assignments & parent linkings
  await Promise.all([
    User.updateOne({ _id: teacherA1._id }, { assignedClassrooms: [classroomA1._id] }),
    User.updateOne({ _id: teacherA2._id }, { assignedClassrooms: [classroomA2._id] }),
    User.updateOne({ _id: teacherB1._id }, { assignedClassrooms: [classroomB1._id] }),
    User.updateOne({ _id: teacherB2._id }, { assignedClassrooms: [classroomB2._id] }),
    User.updateOne({ _id: parentA1._id }, { 'parentInfo.studentIds': [studentA1._id] }),
    User.updateOne({ _id: parentB1._id }, { 'parentInfo.studentIds': [studentB1._id] })
  ]);
});

const getNextSchoolDay = (baseDate = new Date()) => {
  const candidate = new Date(baseDate);
  candidate.setDate(candidate.getDate() + 1);
  const day = candidate.getDay();
  if (day === 6) candidate.setDate(candidate.getDate() + 2);
  else if (day === 0) candidate.setDate(candidate.getDate() + 1);
  return getWorkDate(candidate, DEFAULT_SCHOOL_TIMEZONE);
};

describe('Task 1C.5: FINAL INTEGRATION ACCEPTANCE SUITE', () => {

  test('Complete actual HTTP workflow per Tenant A and B: Attendance -> Parent Leave & Approval -> Transfer -> Counts/History & Foreign-ID Rejection', async () => {
    const tokenTeacherA = generateSchoolUserToken(teacherA1, tenantA);
    const tokenParentA = generateSchoolUserToken(parentA1, tenantA);
    const tokenAdminA = generateSchoolUserToken(adminA, tenantA);

    const tokenTeacherB = generateSchoolUserToken(teacherB1, tenantB);
    const tokenParentB = generateSchoolUserToken(parentB1, tenantB);
    const tokenAdminB = generateSchoolUserToken(adminB, tenantB);

    const today = getWorkDate();
    const leaveStart = getNextSchoolDay();
    const leaveEnd = addWorkDays(leaveStart, 1);

    // =========================================================================
    // STEP 1: Attendance Creation & Verification
    // =========================================================================
    // Tenant A attendance
    const resAttA = await request(saasApp)
      .post('/api/v1/attendance')
      .set('Authorization', `Bearer ${tokenTeacherA}`)
      .send({
        studentId: studentA1._id.toString(),
        status: 'present',
        checkInTime: new Date(),
        note: 'Học sinh có mặt đúng giờ'
      });
    expect(resAttA.status).toBe(201);
    expect(resAttA.body.data.tenantId).toBe(tenantA._id.toString());
    expect(resAttA.body.data.studentId).toBe(studentA1._id.toString());

    // Tenant B attendance
    const resAttB = await request(saasApp)
      .post('/api/v1/attendance')
      .set('Authorization', `Bearer ${tokenTeacherB}`)
      .send({
        studentId: studentB1._id.toString(),
        status: 'present',
        checkInTime: new Date(),
        note: 'Học sinh trường B có mặt đúng giờ'
      });
    expect(resAttB.status).toBe(201);
    expect(resAttB.body.data.tenantId).toBe(tenantB._id.toString());
    expect(resAttB.body.data.studentId).toBe(studentB1._id.toString());

    // Verified scoped query on attendance
    const resQueryAttA = await request(saasApp)
      .get(`/api/v1/attendance/student/${studentA1._id}`)
      .set('Authorization', `Bearer ${tokenTeacherA}`);
    expect(resQueryAttA.status).toBe(200);
    expect(resQueryAttA.body.data.length).toBe(1);
    expect(resQueryAttA.body.data[0].tenantId).toBe(tenantA._id.toString());

    const resQueryAttB = await request(saasApp)
      .get(`/api/v1/attendance/student/${studentB1._id}`)
      .set('Authorization', `Bearer ${tokenTeacherB}`);
    expect(resQueryAttB.status).toBe(200);
    expect(resQueryAttB.body.data.length).toBe(1);
    expect(resQueryAttB.body.data[0].tenantId).toBe(tenantB._id.toString());

    // =========================================================================
    // STEP 2: Parent Leave Request & Admin Approval
    // =========================================================================
    // Tenant A: Parent submits leave request
    const resLeaveReqA = await request(saasApp)
      .post('/api/v1/attendance/leave-requests')
      .set('Authorization', `Bearer ${tokenParentA}`)
      .send({
        studentId: studentA1._id.toString(),
        startDate: leaveStart,
        endDate: leaveEnd,
        reason: 'Gia đình có việc cần cho bé nghỉ học'
      });
    expect(resLeaveReqA.status).toBe(201);
    expect(resLeaveReqA.body.success).toBe(true);
    expect(resLeaveReqA.body.data.tenantId).toBe(tenantA._id.toString());
    const leaveIdA = resLeaveReqA.body.data._id;

    // Tenant A: Admin reviews and approves leave request
    const resReviewA = await request(saasApp)
      .patch(`/api/v1/attendance/leave-requests/${leaveIdA}/review`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        decision: 'approved',
        reviewNote: 'Đã duyệt đơn nghỉ cho bé'
      });
    expect(resReviewA.status).toBe(200);
    expect(resReviewA.body.success).toBe(true);
    expect(resReviewA.body.data.status).toBe('approved');

    // Verify automated absent_permission attendance created in DB for Tenant A
    const autoAttA = await StudentAttendance.find({
      studentId: studentA1._id,
      tenantId: tenantA._id,
      status: 'absent_permission'
    });
    expect(autoAttA.length).toBeGreaterThanOrEqual(1);

    // Tenant B: Parent submits leave request
    const resLeaveReqB = await request(saasApp)
      .post('/api/v1/attendance/leave-requests')
      .set('Authorization', `Bearer ${tokenParentB}`)
      .send({
        studentId: studentB1._id.toString(),
        startDate: leaveStart,
        endDate: leaveEnd,
        reason: 'Bé bị sốt cần nghỉ ngơi và theo dõi tại nhà'
      });
    expect(resLeaveReqB.status).toBe(201);
    expect(resLeaveReqB.body.success).toBe(true);
    expect(resLeaveReqB.body.data.tenantId).toBe(tenantB._id.toString());
    const leaveIdB = resLeaveReqB.body.data._id;

    // Tenant B: Admin reviews and approves leave request
    const resReviewB = await request(saasApp)
      .patch(`/api/v1/attendance/leave-requests/${leaveIdB}/review`)
      .set('Authorization', `Bearer ${tokenAdminB}`)
      .send({
        decision: 'approved',
        reviewNote: 'Đã duyệt đơn nghỉ trường B'
      });
    expect(resReviewB.status).toBe(200);
    expect(resReviewB.body.success).toBe(true);
    expect(resReviewB.body.data.status).toBe('approved');

    // Verify automated absent_permission attendance created in DB for Tenant B
    const autoAttB = await StudentAttendance.find({
      studentId: studentB1._id,
      tenantId: tenantB._id,
      status: 'absent_permission'
    });
    expect(autoAttB.length).toBeGreaterThanOrEqual(1);

    // =========================================================================
    // STEP 3: Student Classroom Transfer with Same Raw Idempotency-Key
    // =========================================================================
    // Shared raw key: exactly identical across Tenant A and Tenant B
    const sharedRawIdempotencyKey = 'TRANSFER-RAW-KEY-ACCPT-1C5-99887766';

    // Tenant A: Transfer student A1 from classroomA1 to classroomA2
    const resTransferA = await request(saasApp)
      .post(`/api/v1/students/${studentA1._id}/transfer`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .set('Idempotency-Key', sharedRawIdempotencyKey)
      .send({
        toClassroomId: classroomA2._id.toString(),
        reason: 'Chuyển sang lớp phù hợp lứa tuổi',
        effectiveDate: today
      });
    expect(resTransferA.status).toBe(200);
    expect(resTransferA.body.success).toBe(true);
    expect(resTransferA.body.data.student.classroomId).toBe(classroomA2._id.toString());
    expect(resTransferA.body.data.transferHistory.tenantId).toBe(tenantA._id.toString());

    // Replay idempotency on Tenant A with same key -> returns 200 with replayed: true
    const resReplayA = await request(saasApp)
      .post(`/api/v1/students/${studentA1._id}/transfer`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .set('Idempotency-Key', sharedRawIdempotencyKey)
      .send({
        toClassroomId: classroomA2._id.toString(),
        reason: 'Chuyển sang lớp phù hợp lứa tuổi',
        effectiveDate: today
      });
    expect(resReplayA.status).toBe(200);
    expect(resReplayA.body.replayed).toBe(true);

    // Tenant B: Transfer student B1 from classroomB1 to classroomB2 with SAME RAW KEY
    // Must succeed without 409 collision because internal key is namespaced by tenantId
    const resTransferB = await request(saasApp)
      .post(`/api/v1/students/${studentB1._id}/transfer`)
      .set('Authorization', `Bearer ${tokenAdminB}`)
      .set('Idempotency-Key', sharedRawIdempotencyKey)
      .send({
        toClassroomId: classroomB2._id.toString(),
        reason: 'Chuyển học sinh sang lớp B2',
        effectiveDate: today
      });
    expect(resTransferB.status).toBe(200);
    expect(resTransferB.body.success).toBe(true);
    expect(resTransferB.body.data.student.classroomId).toBe(classroomB2._id.toString());
    expect(resTransferB.body.data.transferHistory.tenantId).toBe(tenantB._id.toString());

    // =========================================================================
    // STEP 4: Verify Classroom Headcounts & Transfer History Invariants
    // =========================================================================
    // Tenant A classroom counts
    const updatedClassA1 = await Classroom.findById(classroomA1._id);
    const updatedClassA2 = await Classroom.findById(classroomA2._id);
    expect(updatedClassA1.statistics.currentStudents).toBe(9); // 10 - 1
    expect(updatedClassA2.statistics.currentStudents).toBe(6); // 5 + 1

    // Tenant B classroom counts
    const updatedClassB1 = await Classroom.findById(classroomB1._id);
    const updatedClassB2 = await Classroom.findById(classroomB2._id);
    expect(updatedClassB1.statistics.currentStudents).toBe(7); // 8 - 1
    expect(updatedClassB2.statistics.currentStudents).toBe(5); // 4 + 1

    // Transfer history queries strictly scoped
    const resHistA = await request(saasApp)
      .get(`/api/v1/students/${studentA1._id}/transfer-history`)
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(resHistA.status).toBe(200);
    expect(resHistA.body.data.length).toBe(1);
    expect(resHistA.body.data[0].tenantId).toBe(tenantA._id.toString());
    expect(resHistA.body.data[0].toClassroomId).toBe(classroomA2._id.toString());

    const resHistB = await request(saasApp)
      .get(`/api/v1/students/${studentB1._id}/transfer-history`)
      .set('Authorization', `Bearer ${tokenAdminB}`);
    expect(resHistB.status).toBe(200);
    expect(resHistB.body.data.length).toBe(1);
    expect(resHistB.body.data[0].tenantId).toBe(tenantB._id.toString());
    expect(resHistB.body.data[0].toClassroomId).toBe(classroomB2._id.toString());

    // =========================================================================
    // STEP 5: Strict Foreign-ID Rejection (Cross-Tenant 404 Invisible)
    // =========================================================================
    // 5.1 Cross-tenant attendance query
    const resCrossAtt = await request(saasApp)
      .get(`/api/v1/attendance/student/${studentB1._id}`)
      .set('Authorization', `Bearer ${tokenTeacherA}`);
    expect(resCrossAtt.status).toBe(404);

    // 5.2 Cross-tenant leave request review
    const resCrossReview = await request(saasApp)
      .patch(`/api/v1/attendance/leave-requests/${leaveIdB}/review`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ decision: 'approved', reviewNote: 'Cross-tenant review attempt' });
    expect(resCrossReview.status).toBe(404);

    // 5.3 Cross-tenant student transfer (source student belongs to other tenant)
    const resCrossStudent = await request(saasApp)
      .post(`/api/v1/students/${studentB1._id}/transfer`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .set('Idempotency-Key', 'TRANSFER-CROSS-SOURCE-TEST-KEY-001')
      .send({
        toClassroomId: classroomA2._id.toString(),
        reason: 'Transfer foreign student attempt',
        effectiveDate: today
      });
    expect(resCrossStudent.status).toBe(404);

    // 5.4 Cross-tenant student transfer (target classroom belongs to other tenant)
    const resCrossTarget = await request(saasApp)
      .post(`/api/v1/students/${studentA1._id}/transfer`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .set('Idempotency-Key', 'TRANSFER-CROSS-TARGET-TEST-KEY-002')
      .send({
        toClassroomId: classroomB1._id.toString(),
        reason: 'Transfer to foreign classroom attempt',
        effectiveDate: today
      });
    expect(resCrossTarget.status).toBe(404);

    // 5.5 Cross-tenant transfer history query
    const resCrossHist = await request(saasApp)
      .get(`/api/v1/students/${studentB1._id}/transfer-history`)
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(resCrossHist.status).toBe(404);
  });
});
