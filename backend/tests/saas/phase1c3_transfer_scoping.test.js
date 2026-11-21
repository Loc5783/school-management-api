process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';

const mongoose = require('mongoose');
const testDbBootstrap = require('../../src/saas/testDbBootstrap');

const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const Classroom = require('../../src/models/zone3_school/Classroom');
const Student = require('../../src/models/zone3_school/Student');
const StudentTransferHistory = require('../../src/models/zone3_school/StudentTransferHistory');
const ImportIdempotency = require('../../src/models/zone1_system/ImportIdempotency');
const Notification = require('../../src/models/zone1_system/Notification');
const AuditLog = require('../../src/models/zone1_system/AuditLog');

const {
  transferStudentClassroom,
  getStudentTransferHistory
} = require('../../src/controllers/studentController');

const { getWorkDate } = require('../../src/utils/dateHelpers');

const createMockResponse = () => {
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

const createMockReq = ({
  user = null,
  tenantId = undefined,
  body = {},
  params = {},
  query = {},
  headers = {},
  isLegacy = undefined
} = {}) => {
  const req = {
    user,
    body: { ...body },
    params: { ...params },
    query: { ...query },
    headers: { ...headers },
    header(name) {
      const lower = String(name || '').toLowerCase();
      return this.headers[lower] || this.headers[name] || null;
    },
    get(name) {
      return this.header(name);
    }
  };

  if (tenantId !== undefined) {
    req.tenantId = tenantId;
  }
  if (isLegacy !== undefined) {
    req.isLegacy = isLegacy;
  }
  return req;
};

describe('Task 1C.3 - Student Transfer Scoping & Idempotency Namespacing', () => {
  let bootstrapInstance;

  // Tenants
  let tenantA;
  let tenantB;

  // Users Tenant A
  let adminA;
  let hrA;
  let principalA;
  let teacherA1;
  let teacherA2;
  let teacherAOther;
  let parentA;

  // Users Tenant B
  let adminB;
  let teacherB;
  let parentB;

  // Users Legacy
  let adminL;
  let teacherL;
  let parentL;

  // Classrooms Tenant A
  let classroomA1;
  let classroomA2;
  let classroomAFull;

  // Classrooms Tenant B
  let classroomB1;
  let classroomB2;

  // Classrooms Legacy
  let classroomL1;
  let classroomL2;

  // Students
  let studentA1;
  let studentA2;
  let studentB1;
  let studentL1;

  beforeAll(async () => {
    bootstrapInstance = await testDbBootstrap.startTestDb({
      instanceOpts: [{ dbName: 'school_saas_1c3_test_isolated' }]
    });

    await Promise.all([
      Tenant.syncIndexes(),
      User.syncIndexes(),
      Classroom.syncIndexes(),
      Student.syncIndexes(),
      StudentTransferHistory.syncIndexes(),
      ImportIdempotency.syncIndexes(),
      Notification.syncIndexes(),
      AuditLog.syncIndexes()
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
      Classroom.deleteMany({}),
      Student.deleteMany({}),
      StudentTransferHistory.deleteMany({}),
      ImportIdempotency.deleteMany({}),
      Notification.deleteMany({}),
      AuditLog.deleteMany({})
    ]);

    // 1. Create Tenants
    tenantA = await Tenant.create({
      code: 'TRUONG-A',
      name: 'Trường Mầm Non Ánh Sao A',
      status: 'active',
      authVersion: 0
    });

    tenantB = await Tenant.create({
      code: 'TRUONG-B',
      name: 'Trường Mầm Non Mặt Trời B',
      status: 'active',
      authVersion: 0
    });

    // 2. Create Users - Tenant A
    adminA = await User.create({
      username: 'admin_a',
      email: 'admin@school-a.edu.vn',
      passwordHash: 'hashed_password_123',
      role: 'admin',
      status: 'active',
      tenantId: tenantA._id,
      profile: { fullName: 'Quản Trị Viên A' }
    });

    hrA = await User.create({
      username: 'hr_a',
      email: 'hr@school-a.edu.vn',
      passwordHash: 'hashed_password_123',
      role: 'hr',
      status: 'active',
      tenantId: tenantA._id,
      profile: { fullName: 'Nhân Sự A' }
    });

    principalA = await User.create({
      username: 'principal_a',
      email: 'principal@school-a.edu.vn',
      passwordHash: 'hashed_password_123',
      role: 'principal',
      status: 'active',
      tenantId: tenantA._id,
      profile: { fullName: 'Hiệu Trưởng A' }
    });

    teacherA1 = await User.create({
      username: 'teacher_a1',
      email: 'teacher1@school-a.edu.vn',
      passwordHash: 'hashed_password_123',
      role: 'teacher',
      status: 'active',
      tenantId: tenantA._id,
      profile: { fullName: 'Cô Giáo Lớp 1' }
    });

    teacherA2 = await User.create({
      username: 'teacher_a2',
      email: 'teacher2@school-a.edu.vn',
      passwordHash: 'hashed_password_123',
      role: 'teacher',
      status: 'active',
      tenantId: tenantA._id,
      profile: { fullName: 'Cô Giáo Lớp 2' }
    });

    teacherAOther = await User.create({
      username: 'teacher_a_other',
      email: 'teacher_other@school-a.edu.vn',
      passwordHash: 'hashed_password_123',
      role: 'teacher',
      status: 'active',
      tenantId: tenantA._id,
      profile: { fullName: 'Cô Giáo Ngoài Lớp' }
    });

    parentA = await User.create({
      username: 'parent_a',
      email: 'parent@school-a.edu.vn',
      passwordHash: 'hashed_password_123',
      role: 'parent',
      status: 'active',
      tenantId: tenantA._id,
      profile: { fullName: 'Phụ Huynh A' }
    });

    // 3. Create Users - Tenant B
    adminB = await User.create({
      username: 'admin_b',
      email: 'admin@school-b.edu.vn',
      passwordHash: 'hashed_password_123',
      role: 'admin',
      status: 'active',
      tenantId: tenantB._id,
      profile: { fullName: 'Quản Trị Viên B' }
    });

    teacherB = await User.create({
      username: 'teacher_b',
      email: 'teacher@school-b.edu.vn',
      passwordHash: 'hashed_password_123',
      role: 'teacher',
      status: 'active',
      tenantId: tenantB._id,
      profile: { fullName: 'Cô Giáo B' }
    });

    parentB = await User.create({
      username: 'parent_b',
      email: 'parent@school-b.edu.vn',
      passwordHash: 'hashed_password_123',
      role: 'parent',
      status: 'active',
      tenantId: tenantB._id,
      profile: { fullName: 'Phụ Huynh B' }
    });

    // 4. Create Users - Legacy
    adminL = await User.create({
      username: 'admin_l',
      email: 'admin@school-legacy.edu.vn',
      passwordHash: 'hashed_password_123',
      role: 'admin',
      status: 'active',
      tenantId: null,
      profile: { fullName: 'Quản Trị Viên Legacy' }
    });

    teacherL = await User.create({
      username: 'teacher_l',
      email: 'teacher@school-legacy.edu.vn',
      passwordHash: 'hashed_password_123',
      role: 'teacher',
      status: 'active',
      tenantId: null,
      profile: { fullName: 'Cô Giáo Legacy' }
    });

    parentL = await User.create({
      username: 'parent_l',
      email: 'parent@school-legacy.edu.vn',
      passwordHash: 'hashed_password_123',
      role: 'parent',
      status: 'active',
      tenantId: null,
      profile: { fullName: 'Phụ Huynh Legacy' }
    });

    // 5. Create Classrooms
    // Tenant A Classrooms
    classroomA1 = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Mầm 1',
      ageGroup: '3-4',
      schoolYear: '2025-2026',
      status: 'active',
      maxSize: 25,
      homeroomTeacherId: teacherA1._id,
      statistics: { currentStudents: 10 }
    });

    classroomA2 = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Mầm 2',
      ageGroup: '3-4',
      schoolYear: '2025-2026',
      status: 'active',
      maxSize: 25,
      homeroomTeacherId: teacherA2._id,
      statistics: { currentStudents: 5 }
    });

    classroomAFull = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Mầm Đầy',
      ageGroup: '3-4',
      schoolYear: '2025-2026',
      status: 'active',
      maxSize: 20,
      statistics: { currentStudents: 20 }
    });

    // Tenant B Classrooms
    classroomB1 = await Classroom.create({
      tenantId: tenantB._id,
      name: 'Chồi 1',
      ageGroup: '4-5',
      schoolYear: '2025-2026',
      status: 'active',
      maxSize: 25,
      homeroomTeacherId: teacherB._id,
      statistics: { currentStudents: 12 }
    });

    classroomB2 = await Classroom.create({
      tenantId: tenantB._id,
      name: 'Chồi 2',
      ageGroup: '4-5',
      schoolYear: '2025-2026',
      status: 'active',
      maxSize: 25,
      statistics: { currentStudents: 8 }
    });

    // Legacy Classrooms
    classroomL1 = await Classroom.create({
      tenantId: null,
      name: 'Lá 1',
      ageGroup: '5-6',
      schoolYear: '2025-2026',
      status: 'active',
      maxSize: 25,
      homeroomTeacherId: teacherL._id,
      statistics: { currentStudents: 15 }
    });

    classroomL2 = await Classroom.create({
      tenantId: null,
      name: 'Lá 2',
      ageGroup: '5-6',
      schoolYear: '2025-2026',
      status: 'active',
      maxSize: 25,
      statistics: { currentStudents: 10 }
    });

    // 6. Create Students
    studentA1 = await Student.create({
      tenantId: tenantA._id,
      studentCode: 'HS-2025-000001',
      fullName: 'Nguyễn Văn Bé A',
      birthDate: new Date('2022-03-15'),
      gender: 'male',
      classroomId: classroomA1._id,
      className: classroomA1.name,
      schoolYear: '2025-2026',
      status: 'enrolled',
      parents: [{
        userId: parentA._id,
        phone: '0912345678',
        relationship: 'father',
        fullName: 'Phụ Huynh A'
      }]
    });

    studentA2 = await Student.create({
      tenantId: tenantA._id,
      studentCode: 'HS-2025-000002',
      fullName: 'Trần Thị Bé A2',
      birthDate: new Date('2022-05-20'),
      gender: 'female',
      classroomId: classroomA1._id,
      className: classroomA1.name,
      schoolYear: '2025-2026',
      status: 'enrolled',
      parents: [{
        fullName: 'Mẹ Bé A2',
        phone: '0912345679',
        relationship: 'mother'
      }]
    });

    studentB1 = await Student.create({
      tenantId: tenantB._id,
      studentCode: 'HS-2025-000003',
      fullName: 'Lê Hoàng Bé B',
      birthDate: new Date('2021-08-10'),
      gender: 'male',
      classroomId: classroomB1._id,
      className: classroomB1.name,
      schoolYear: '2025-2026',
      status: 'enrolled',
      parents: [{
        userId: parentB._id,
        phone: '0987654321',
        relationship: 'mother',
        fullName: 'Phụ Huynh B'
      }]
    });

    studentL1 = await Student.create({
      tenantId: null,
      studentCode: 'HS-2025-000004',
      fullName: 'Phạm Minh Bé L',
      birthDate: new Date('2020-04-12'),
      gender: 'male',
      classroomId: classroomL1._id,
      className: classroomL1.name,
      schoolYear: '2025-2026',
      status: 'enrolled',
      parents: [{
        userId: parentL._id,
        phone: '0933333333',
        relationship: 'father',
        fullName: 'Phụ Huynh Legacy'
      }]
    });

    // Update parentUser parentInfo in-memory and in DB
    parentA.parentInfo = { studentIds: [studentA1._id] };
    parentB.parentInfo = { studentIds: [studentB1._id] };
    parentL.parentInfo = { studentIds: [studentL1._id] };
    await User.updateOne({ _id: parentA._id }, { $set: { 'parentInfo.studentIds': [studentA1._id] } });
    await User.updateOne({ _id: parentB._id }, { $set: { 'parentInfo.studentIds': [studentB1._id] } });
    await User.updateOne({ _id: parentL._id }, { $set: { 'parentInfo.studentIds': [studentL1._id] } });
  });

  // =========================================================================
  // 1. Core Scoping: Multi-Tenant Student Transfer Execution (A / B / Legacy)
  // =========================================================================
  describe('1. Core Scoping: Multi-Tenant Student Transfer Execution', () => {
    test('1.1. Tenant A admin transfers student from Classroom A1 to A2: succeeds, updates counts, records history and namespaced idempotency', async () => {
      const today = getWorkDate();
      const rawKey = 'KEY-TRANSFER-TENANT-A-0001';

      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id,
        params: { id: studentA1._id.toString() },
        body: {
          toClassroomId: classroomA2._id.toString(),
          reason: 'Chuyển theo nguyện vọng phụ huynh',
          effectiveDate: today
        },
        headers: { 'idempotency-key': rawKey }
      });
      const res = createMockResponse();

      await transferStudentClassroom(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.student.classroomId.toString()).toBe(classroomA2._id.toString());
      expect(res.body.data.student.className).toBe('Mầm 2');

      // Verify classroom headcount atomic updates
      const updatedSource = await Classroom.findById(classroomA1._id);
      const updatedTarget = await Classroom.findById(classroomA2._id);
      expect(updatedSource.statistics.currentStudents).toBe(9); // 10 - 1
      expect(updatedTarget.statistics.currentStudents).toBe(6); // 5 + 1

      // Verify StudentTransferHistory record has tenantId
      const history = await StudentTransferHistory.findOne({ studentId: studentA1._id });
      expect(history).not.toBeNull();
      expect(history.tenantId.toString()).toBe(tenantA._id.toString());
      expect(history.fromClassroomId.toString()).toBe(classroomA1._id.toString());
      expect(history.toClassroomId.toString()).toBe(classroomA2._id.toString());
      expect(history.transferredBy.toString()).toBe(adminA._id.toString());

      // Verify ImportIdempotency namespaced by tenant
      const idempRecord = await ImportIdempotency.findOne({ tenantId: tenantA._id });
      expect(idempRecord).not.toBeNull();
      expect(idempRecord.idempotencyKey).toBe(`${tenantA._id}:${rawKey}`);
      expect(idempRecord.status).toBe('completed');
    });

    test('1.2. Tenant B admin transfers student from Classroom B1 to B2: completely isolated from Tenant A', async () => {
      const today = getWorkDate();
      const rawKey = 'KEY-TRANSFER-TENANT-B-0001';

      const req = createMockReq({
        user: adminB,
        tenantId: tenantB._id,
        params: { id: studentB1._id.toString() },
        body: {
          toClassroomId: classroomB2._id.toString(),
          reason: 'Đổi lớp phù hợp thời khóa biểu',
          effectiveDate: today
        },
        headers: { 'idempotency-key': rawKey }
      });
      const res = createMockResponse();

      await transferStudentClassroom(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const updatedSourceB = await Classroom.findById(classroomB1._id);
      const updatedTargetB = await Classroom.findById(classroomB2._id);
      expect(updatedSourceB.statistics.currentStudents).toBe(11); // 12 - 1
      expect(updatedTargetB.statistics.currentStudents).toBe(9);  // 8 + 1

      const historyB = await StudentTransferHistory.findOne({ studentId: studentB1._id });
      expect(historyB.tenantId.toString()).toBe(tenantB._id.toString());

      // Ensure Tenant A's classes were untouched
      const sourceA = await Classroom.findById(classroomA1._id);
      expect(sourceA.statistics.currentStudents).toBe(10);
    });

    test('1.3. Legacy admin transfers legacy student: preserves legacy behavior with raw idempotency key', async () => {
      const today = getWorkDate();
      const rawKey = 'KEY-TRANSFER-LEGACY-RAW-0001';

      const req = createMockReq({
        user: adminL,
        isLegacy: true,
        params: { id: studentL1._id.toString() },
        body: {
          toClassroomId: classroomL2._id.toString(),
          reason: 'Chuyển lớp Legacy hệ thống cũ',
          effectiveDate: today
        },
        headers: { 'idempotency-key': rawKey }
      });
      const res = createMockResponse();

      await transferStudentClassroom(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const historyL = await StudentTransferHistory.findOne({ studentId: studentL1._id });
      expect(historyL).not.toBeNull();
      expect(historyL.tenantId).toBeNull();

      // Legacy ImportIdempotency uses raw key unchanged
      const idempRecord = await ImportIdempotency.findOne({ idempotencyKey: rawKey });
      expect(idempRecord).not.toBeNull();
      expect(idempRecord.tenantId).toBeNull();
      expect(idempRecord.idempotencyKey).toBe(rawKey);
    });
  });

  // =========================================================================
  // 2. Idempotency Namespacing: Same Raw Key A/B, Retry, Conflicting Payload
  // =========================================================================
  describe('2. Idempotency Namespacing & Collision Protection', () => {
    test('2.1. SAME RAW IDEMPOTENCY KEY used by Tenant A and Tenant B succeeds without 11000 duplicate key error', async () => {
      const today = getWorkDate();
      const sharedRawKey = 'SHARED-RAW-KEY-ACROSS-TENANTS-1234';

      // Tenant A sends transfer request with shared raw key
      const reqA = createMockReq({
        user: adminA,
        tenantId: tenantA._id,
        params: { id: studentA1._id.toString() },
        body: {
          toClassroomId: classroomA2._id.toString(),
          reason: 'Lý do trường A',
          effectiveDate: today
        },
        headers: { 'idempotency-key': sharedRawKey }
      });
      const resA = createMockResponse();
      await transferStudentClassroom(reqA, resA);
      expect(resA.statusCode).toBe(200);

      // Tenant B sends transfer request with EXACT SAME raw key
      const reqB = createMockReq({
        user: adminB,
        tenantId: tenantB._id,
        params: { id: studentB1._id.toString() },
        body: {
          toClassroomId: classroomB2._id.toString(),
          reason: 'Lý do trường B',
          effectiveDate: today
        },
        headers: { 'idempotency-key': sharedRawKey }
      });
      const resB = createMockResponse();
      await transferStudentClassroom(reqB, resB);
      expect(resB.statusCode).toBe(200);

      // Verify both records exist in DB under namespaced keys
      const docA = await ImportIdempotency.findOne({
        tenantId: tenantA._id,
        idempotencyKey: `${tenantA._id}:${sharedRawKey}`
      });
      const docB = await ImportIdempotency.findOne({
        tenantId: tenantB._id,
        idempotencyKey: `${tenantB._id}:${sharedRawKey}`
      });
      expect(docA).not.toBeNull();
      expect(docB).not.toBeNull();
      expect(docA._id.toString()).not.toBe(docB._id.toString());
      expect(docA.response.data.student.fullName).toBe(studentA1.fullName);
      expect(docB.response.data.student.fullName).toBe(studentB1.fullName);
    });

    test('2.2. Replay isolation: each tenant replaying same raw key receives only their own cached response', async () => {
      const today = getWorkDate();
      const sharedRawKey = 'REPLAY-ISOLATION-RAW-KEY-987654';

      // Setup completed records for both tenants
      await transferStudentClassroom(
        createMockReq({
          user: adminA,
          tenantId: tenantA._id,
          params: { id: studentA1._id.toString() },
          body: { toClassroomId: classroomA2._id.toString(), reason: 'Trường A', effectiveDate: today },
          headers: { 'idempotency-key': sharedRawKey }
        }),
        createMockResponse()
      );

      await transferStudentClassroom(
        createMockReq({
          user: adminB,
          tenantId: tenantB._id,
          params: { id: studentB1._id.toString() },
          body: { toClassroomId: classroomB2._id.toString(), reason: 'Trường B', effectiveDate: today },
          headers: { 'idempotency-key': sharedRawKey }
        }),
        createMockResponse()
      );

      // Replay by Tenant A
      const replayReqA = createMockReq({
        user: adminA,
        tenantId: tenantA._id,
        params: { id: studentA1._id.toString() },
        body: { toClassroomId: classroomA2._id.toString(), reason: 'Trường A', effectiveDate: today },
        headers: { 'idempotency-key': sharedRawKey }
      });
      const replayResA = createMockResponse();
      await transferStudentClassroom(replayReqA, replayResA);

      expect(replayResA.statusCode).toBe(200);
      expect(replayResA.body.replayed).toBe(true);
      expect(replayResA.body.data.student.fullName).toBe(studentA1.fullName);

      // Replay by Tenant B
      const replayReqB = createMockReq({
        user: adminB,
        tenantId: tenantB._id,
        params: { id: studentB1._id.toString() },
        body: { toClassroomId: classroomB2._id.toString(), reason: 'Trường B', effectiveDate: today },
        headers: { 'idempotency-key': sharedRawKey }
      });
      const replayResB = createMockResponse();
      await transferStudentClassroom(replayReqB, replayResB);

      expect(replayResB.statusCode).toBe(200);
      expect(replayResB.body.replayed).toBe(true);
      expect(replayResB.body.data.student.fullName).toBe(studentB1.fullName);
    });

    test('2.3. Retry with conflicting payload using same idempotency key returns 409 conflict', async () => {
      const today = getWorkDate();
      const rawKey = 'CONFLICT-PAYLOAD-KEY-1234567';

      // Initial successful request
      await transferStudentClassroom(
        createMockReq({
          user: adminA,
          tenantId: tenantA._id,
          params: { id: studentA1._id.toString() },
          body: { toClassroomId: classroomA2._id.toString(), reason: 'Lý do ban đầu', effectiveDate: today },
          headers: { 'idempotency-key': rawKey }
        }),
        createMockResponse()
      );

      // Second request with same key but different reason
      const conflictReq = createMockReq({
        user: adminA,
        tenantId: tenantA._id,
        params: { id: studentA1._id.toString() },
        body: { toClassroomId: classroomA2._id.toString(), reason: 'Lý do bị thay đổi', effectiveDate: today },
        headers: { 'idempotency-key': rawKey }
      });
      const conflictRes = createMockResponse();
      await transferStudentClassroom(conflictReq, conflictRes);

      expect(conflictRes.statusCode).toBe(409);
      expect(conflictRes.body.success).toBe(false);
      expect(conflictRes.body.message).toMatch(/yêu cầu khác với nội dung khác/i);
    });

    test('2.4. Same idempotency key used by different user in same tenant returns 409', async () => {
      const today = getWorkDate();
      const rawKey = 'USER-MISMATCH-KEY-12345678';

      // Admin A executes initial request
      await transferStudentClassroom(
        createMockReq({
          user: adminA,
          tenantId: tenantA._id,
          params: { id: studentA1._id.toString() },
          body: { toClassroomId: classroomA2._id.toString(), reason: 'Lý do 1', effectiveDate: today },
          headers: { 'idempotency-key': rawKey }
        }),
        createMockResponse()
      );

      // Principal A (different user) attempts to reuse the same key
      const mismatchReq = createMockReq({
        user: principalA,
        tenantId: tenantA._id,
        params: { id: studentA1._id.toString() },
        body: { toClassroomId: classroomA2._id.toString(), reason: 'Lý do 1', effectiveDate: today },
        headers: { 'idempotency-key': rawKey }
      });
      const mismatchRes = createMockResponse();
      await transferStudentClassroom(mismatchReq, mismatchRes);

      expect(mismatchRes.statusCode).toBe(409);
      expect(mismatchRes.body.message).toMatch(/thuộc về một người dùng khác/i);
    });
  });

  // =========================================================================
  // 3. Foreign ID Boundary Checks (Cross-Tenant 404s)
  // =========================================================================
  describe('3. Foreign ID Boundary Checks (Cross-Tenant 404)', () => {
    test('3.1. Tenant A admin attempting to transfer Tenant B student returns 404', async () => {
      const today = getWorkDate();
      const rawKey = 'FOREIGN-STUDENT-KEY-000123';

      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id,
        params: { id: studentB1._id.toString() }, // Foreign student
        body: { toClassroomId: classroomA2._id.toString(), reason: 'Chuyển lậu', effectiveDate: today },
        headers: { 'idempotency-key': rawKey }
      });
      const res = createMockResponse();

      await transferStudentClassroom(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy học sinh/i);

      // Ensure counts not affected
      const sourceB = await Classroom.findById(classroomB1._id);
      expect(sourceB.statistics.currentStudents).toBe(12);
    });

    test('3.2. Tenant A admin attempting to transfer student to Tenant B target classroom returns 404', async () => {
      const today = getWorkDate();
      const rawKey = 'FOREIGN-TARGET-CLASS-000123';

      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id,
        params: { id: studentA1._id.toString() },
        body: { toClassroomId: classroomB1._id.toString(), reason: 'Chuyển sang trường khác', effectiveDate: today }, // Foreign target class
        headers: { 'idempotency-key': rawKey }
      });
      const res = createMockResponse();

      await transferStudentClassroom(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy lớp chuyển đến hoặc lớp không hoạt động/i);

      // Target classroom count remains untouched
      const targetB = await Classroom.findById(classroomB1._id);
      expect(targetB.statistics.currentStudents).toBe(12);
    });

    test('3.3. Legacy admin attempting to transfer SaaS student returns 404', async () => {
      const today = getWorkDate();
      const rawKey = 'LEGACY-FOREIGN-STUDENT-0001';

      const req = createMockReq({
        user: adminL,
        isLegacy: true,
        params: { id: studentA1._id.toString() },
        body: { toClassroomId: classroomL2._id.toString(), reason: 'Legacy lấn sân', effectiveDate: today },
        headers: { 'idempotency-key': rawKey }
      });
      const res = createMockResponse();

      await transferStudentClassroom(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy học sinh/i);
    });

    test('3.4. SaaS admin attempting to transfer Legacy student returns 404', async () => {
      const today = getWorkDate();
      const rawKey = 'SAAS-FOREIGN-LEGACY-STUDENT-001';

      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id,
        params: { id: studentL1._id.toString() },
        body: { toClassroomId: classroomA2._id.toString(), reason: 'SaaS nhận legacy trái phép', effectiveDate: today },
        headers: { 'idempotency-key': rawKey }
      });
      const res = createMockResponse();

      await transferStudentClassroom(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy học sinh/i);
    });
  });

  // =========================================================================
  // 4. Role Checks & Same-Tenant Permission Enforcements
  // =========================================================================
  describe('4. Role Checks & Same-Tenant Permission Enforcements', () => {
    test('4.1. Teacher in Tenant A attempting transfer receives 403', async () => {
      const today = getWorkDate();
      const req = createMockReq({
        user: teacherA1,
        tenantId: tenantA._id,
        params: { id: studentA1._id.toString() },
        body: { toClassroomId: classroomA2._id.toString(), reason: 'Giáo viên tự chuyển', effectiveDate: today },
        headers: { 'idempotency-key': 'TEACHER-TRANSFER-ATTEMPT-01' }
      });
      const res = createMockResponse();

      await transferStudentClassroom(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/Bạn không có quyền chuyển lớp học sinh/i);
    });

    test('4.2. Parent attempting transfer receives 403', async () => {
      const today = getWorkDate();
      const req = createMockReq({
        user: parentA,
        tenantId: tenantA._id,
        params: { id: studentA1._id.toString() },
        body: { toClassroomId: classroomA2._id.toString(), reason: 'Phụ huynh tự chuyển', effectiveDate: today },
        headers: { 'idempotency-key': 'PARENT-TRANSFER-ATTEMPT-01' }
      });
      const res = createMockResponse();

      await transferStudentClassroom(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/Bạn không có quyền chuyển lớp học sinh/i);
    });

    test('4.3. Admin from Tenant A attempting to act with Tenant B header/context receives 403 (InvalidTenantContext)', async () => {
      const today = getWorkDate();
      const req = createMockReq({
        user: adminA, // User is from Tenant A
        tenantId: tenantB._id, // Context is from Tenant B (impersonation attempt)
        params: { id: studentB1._id.toString() },
        body: { toClassroomId: classroomB2._id.toString(), reason: 'Mạo danh tenant B', effectiveDate: today },
        headers: { 'idempotency-key': 'IMPERSONATION-ATTEMPT-0001' }
      });
      const res = createMockResponse();

      await transferStudentClassroom(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/Ngữ cảnh tenant không hợp lệ/i);
    });

    test('4.4. HR and Principal roles in Tenant A have full transfer permissions', async () => {
      const today = getWorkDate();

      // HR transfer
      const reqHR = createMockReq({
        user: hrA,
        tenantId: tenantA._id,
        params: { id: studentA1._id.toString() },
        body: { toClassroomId: classroomA2._id.toString(), reason: 'HR điều chuyển', effectiveDate: today },
        headers: { 'idempotency-key': 'HR-TRANSFER-PERMISSION-01' }
      });
      const resHR = createMockResponse();
      await transferStudentClassroom(reqHR, resHR);
      expect(resHR.statusCode).toBe(200);

      // Principal transfer (transfers studentA2)
      const reqPrin = createMockReq({
        user: principalA,
        tenantId: tenantA._id,
        params: { id: studentA2._id.toString() },
        body: { toClassroomId: classroomA2._id.toString(), reason: 'Hiệu trưởng phê duyệt', effectiveDate: today },
        headers: { 'idempotency-key': 'PRIN-TRANSFER-PERMISSION-01' }
      });
      const resPrin = createMockResponse();
      await transferStudentClassroom(reqPrin, resPrin);
      expect(resPrin.statusCode).toBe(200);
    });
  });

  // =========================================================================
  // 5. Transaction Atomicity, Concurrency & Rollback
  // =========================================================================
  describe('5. Transaction Atomicity, Rollback & Concurrency Controls', () => {
    test('5.1. Target classroom capacity full: rolls back transaction, preserves source & target counts and history', async () => {
      const today = getWorkDate();
      const rawKey = 'TARGET-CAPACITY-FULL-ROLLBACK';

      const initialSourceCount = classroomA1.statistics.currentStudents; // 10
      const initialTargetCount = classroomAFull.statistics.currentStudents; // 20 (maxSize: 20)

      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id,
        params: { id: studentA1._id.toString() },
        body: {
          toClassroomId: classroomAFull._id.toString(),
          reason: 'Chuyển vào lớp đã đầy',
          effectiveDate: today
        },
        headers: { 'idempotency-key': rawKey }
      });
      const res = createMockResponse();

      await transferStudentClassroom(req, res);

      expect(res.statusCode).toBe(409);
      expect(res.body.message).toMatch(/đã đạt sĩ số tối đa/i);

      // Verify counts remain unchanged
      const currentSource = await Classroom.findById(classroomA1._id);
      const currentTarget = await Classroom.findById(classroomAFull._id);
      expect(currentSource.statistics.currentStudents).toBe(initialSourceCount);
      expect(currentTarget.statistics.currentStudents).toBe(initialTargetCount);

      // Verify student classroom was not modified
      const currentStudent = await Student.findById(studentA1._id);
      expect(currentStudent.classroomId.toString()).toBe(classroomA1._id.toString());

      // Verify no StudentTransferHistory was created
      const historyCount = await StudentTransferHistory.countDocuments({ studentId: studentA1._id });
      expect(historyCount).toBe(0);

      // Verify idempotency record status was set to 'failed' to allow future retry
      const idemp = await ImportIdempotency.findOne({ idempotencyKey: `${tenantA._id}:${rawKey}` });
      expect(idemp).not.toBeNull();
      expect(idemp.status).toBe('failed');
    });

    test('5.2. Retry after failure with updated target class succeeds', async () => {
      const today = getWorkDate();
      const rawKey = 'RETRY-AFTER-FAILURE-KEY-001';

      // 1st attempt: fails because target is full
      await transferStudentClassroom(
        createMockReq({
          user: adminA,
          tenantId: tenantA._id,
          params: { id: studentA1._id.toString() },
          body: { toClassroomId: classroomAFull._id.toString(), reason: 'Chuyển thử', effectiveDate: today },
          headers: { 'idempotency-key': rawKey }
        }),
        createMockResponse()
      );

      // 2nd attempt: retry with available class classroomA2 using same key
      // Note: fingerprint includes payload, so retry with same key must match fingerprint.
      // If client retries same payload after increasing capacity, it succeeds:
      await Classroom.updateOne({ _id: classroomAFull._id }, { $set: { maxSize: 30 } });

      const retryReq = createMockReq({
        user: adminA,
        tenantId: tenantA._id,
        params: { id: studentA1._id.toString() },
        body: { toClassroomId: classroomAFull._id.toString(), reason: 'Chuyển thử', effectiveDate: today },
        headers: { 'idempotency-key': rawKey }
      });
      const retryRes = createMockResponse();

      await transferStudentClassroom(retryReq, retryRes);

      expect(retryRes.statusCode).toBe(200);
      expect(retryRes.body.success).toBe(true);

      const idemp = await ImportIdempotency.findOne({ idempotencyKey: `${tenantA._id}:${rawKey}` });
      expect(idemp.status).toBe('completed');
    });

    test('5.3. Transfer to same classroom is rejected with 422 without modifying state', async () => {
      const today = getWorkDate();
      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id,
        params: { id: studentA1._id.toString() },
        body: {
          toClassroomId: classroomA1._id.toString(), // Same as student's current class
          reason: 'Chuyển vào chính lớp hiện tại',
          effectiveDate: today
        },
        headers: { 'idempotency-key': 'SAME-CLASS-TRANSFER-422' }
      });
      const res = createMockResponse();

      await transferStudentClassroom(req, res);

      expect(res.statusCode).toBe(422);
      expect(res.body.message).toMatch(/Lớp mới phải khác lớp hiện tại/i);

      const source = await Classroom.findById(classroomA1._id);
      expect(source.statistics.currentStudents).toBe(10);
    });

    test('5.4. Student in non-enrolled status (e.g. withdrawn) cannot be transferred', async () => {
      const today = getWorkDate();
      await Student.updateOne({ _id: studentA1._id }, { $set: { status: 'withdrawn' } });

      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id,
        params: { id: studentA1._id.toString() },
        body: {
          toClassroomId: classroomA2._id.toString(),
          reason: 'Chuyển học sinh đã thôi học',
          effectiveDate: today
        },
        headers: { 'idempotency-key': 'WITHDRAWN-STUDENT-TRANSFER' }
      });
      const res = createMockResponse();

      await transferStudentClassroom(req, res);

      expect(res.statusCode).toBe(422);
      expect(res.body.message).toMatch(/Chỉ được chuyển lớp cho học sinh đang theo học/i);
    });
  });

  // =========================================================================
  // 6. getStudentTransferHistory Scoping & Security
  // =========================================================================
  describe('6. getStudentTransferHistory Tenant Scoping & Access Control', () => {
    beforeEach(async () => {
      // Create a transfer history entry for studentA1 in Tenant A
      await StudentTransferHistory.create({
        tenantId: tenantA._id,
        studentId: studentA1._id,
        studentCode: studentA1.studentCode,
        studentName: studentA1.fullName,
        fromClassroomId: classroomA1._id,
        fromClassName: classroomA1.name,
        toClassroomId: classroomA2._id,
        toClassName: classroomA2.name,
        schoolYear: '2025-2026',
        reason: 'Chuyển lớp học kỳ 1',
        effectiveDate: new Date(),
        transferredBy: adminA._id,
        transferredByName: 'Quản Trị Viên A'
      });
    });

    test('6.1. Admin A can view transfer history of Tenant A student', async () => {
      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id,
        params: { id: studentA1._id.toString() }
      });
      const res = createMockResponse();

      await getStudentTransferHistory(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].studentCode).toBe(studentA1.studentCode);
    });

    test('6.2. Admin A cannot view transfer history of Tenant B student (returns 404)', async () => {
      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id,
        params: { id: studentB1._id.toString() }
      });
      const res = createMockResponse();

      await getStudentTransferHistory(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy học sinh/i);
    });

    test('6.3. Admin B cannot view transfer history of Tenant A student (returns 404)', async () => {
      const req = createMockReq({
        user: adminB,
        tenantId: tenantB._id,
        params: { id: studentA1._id.toString() }
      });
      const res = createMockResponse();

      await getStudentTransferHistory(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy học sinh/i);
    });

    test('6.4. Legacy admin cannot view transfer history of SaaS student (returns 404)', async () => {
      const req = createMockReq({
        user: adminL,
        isLegacy: true,
        params: { id: studentA1._id.toString() }
      });
      const res = createMockResponse();

      await getStudentTransferHistory(req, res);

      expect(res.statusCode).toBe(404);
    });

    test('6.5. Teacher A1 (homeroom of past class) can view history; unrelated teacher receives 403', async () => {
      // Teacher A1 is homeroom of classroomA1 (the source class)
      const reqA1 = createMockReq({
        user: teacherA1,
        tenantId: tenantA._id,
        params: { id: studentA1._id.toString() }
      });
      const resA1 = createMockResponse();
      await getStudentTransferHistory(reqA1, resA1);
      expect(resA1.statusCode).toBe(200);

      // Unrelated teacher (teacherAOther) has no classes associated with studentA1
      const reqOther = createMockReq({
        user: teacherAOther,
        tenantId: tenantA._id,
        params: { id: studentA1._id.toString() }
      });
      const resOther = createMockResponse();
      await getStudentTransferHistory(reqOther, resOther);
      expect(resOther.statusCode).toBe(403);
    });

    test('6.6. Parent of student can view sanitized transfer history; foreign parent receives 403', async () => {
      const reqParent = createMockReq({
        user: parentA,
        tenantId: tenantA._id,
        params: { id: studentA1._id.toString() }
      });
      const resParent = createMockResponse();
      await getStudentTransferHistory(reqParent, resParent);

      expect(resParent.statusCode).toBe(200);
      expect(resParent.body.data.length).toBe(1);
      // Sanitized: does not reveal transferredBy / transferredByName to parent
      expect(resParent.body.data[0].transferredBy).toBeUndefined();

      // Parent B (from another tenant) attempting to view studentA1 receives 404/403
      const reqParentB = createMockReq({
        user: parentB,
        tenantId: tenantB._id,
        params: { id: studentA1._id.toString() }
      });
      const resParentB = createMockResponse();
      await getStudentTransferHistory(reqParentB, resParentB);
      expect(resParentB.statusCode).toBe(404);
    });
  });
});
