process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';

const mongoose = require('mongoose');
const testDbBootstrap = require('../../src/saas/testDbBootstrap');

const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const Classroom = require('../../src/models/zone3_school/Classroom');
const Student = require('../../src/models/zone3_school/Student');
const StudentAttendance = require('../../src/models/zone3_school/StudentAttendance');
const StudentLeaveRequest = require('../../src/models/zone3_school/StudentLeaveRequest');
const Notification = require('../../src/models/zone1_system/Notification');

const {
  automaticCheckIn,
  createAttendance,
  createBulkAttendance,
  getAttendanceByStudent,
  getAttendanceByClass,
  updateAttendance,
  deleteAttendance,
  createLeaveRequest,
  getLeaveRequests,
  reviewLeaveRequest,
  getAbsenceReport
} = require('../../src/controllers/attendanceController');

const { getWorkDate, getWorkDateRange, addWorkDays, DEFAULT_SCHOOL_TIMEZONE } = require('../../src/utils/dateHelpers');

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

const getNextSchoolDay = (baseDate = new Date()) => {
  const candidate = new Date(baseDate);
  candidate.setDate(candidate.getDate() + 1);
  const day = candidate.getDay();
  if (day === 6) {
    candidate.setDate(candidate.getDate() + 2);
  } else if (day === 0) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return getWorkDate(candidate, DEFAULT_SCHOOL_TIMEZONE);
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

describe('Task 1C.2 - Attendance & Leave Scoping by Trusted Tenant Context', () => {
  let bootstrapInstance;

  // Tenants
  let tenantA;
  let tenantB;

  // Users Tenant A
  let adminA;
  let teacherA;
  let parentA;

  // Users Tenant B
  let adminB;
  let teacherB;
  let parentB;

  // Users Legacy
  let adminL;
  let teacherL;
  let parentL;

  // Classrooms
  let classroomA1;
  let classroomA2;
  let classroomB1;
  let classroomL1;

  // Students
  let studentA1;
  let studentA2;
  let studentB1;
  let studentL1;

  beforeAll(async () => {
    bootstrapInstance = await testDbBootstrap.startTestDb({
      instanceOpts: [{ dbName: 'school_saas_1c2_test_isolated' }]
    });

    await Promise.all([
      Tenant.syncIndexes(),
      User.syncIndexes(),
      Classroom.syncIndexes(),
      Student.syncIndexes(),
      StudentAttendance.syncIndexes(),
      StudentLeaveRequest.syncIndexes(),
      Notification.syncIndexes()
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
      StudentAttendance.deleteMany({}),
      StudentLeaveRequest.deleteMany({}),
      Notification.deleteMany({})
    ]);

    // 1. Create Tenants
    tenantA = await Tenant.create({
      code: 'TRUONG-A',
      name: 'Trường Mầm Non Hoa Sen A',
      status: 'active',
      authVersion: 0
    });

    tenantB = await Tenant.create({
      code: 'TRUONG-B',
      name: 'Trường Mầm Non Hướng Dương B',
      status: 'active',
      authVersion: 0
    });

    // 2. Create Users
    adminA = await User.create({
      username: 'admin_a',
      email: 'admin_a@school-a.edu.vn',
      passwordHash: 'hashed_password_test_123',
      role: 'admin',
      status: 'active',
      tenantId: tenantA._id,
      profile: { fullName: 'Quản Trị A' }
    });

    teacherA = await User.create({
      username: 'teacher_a',
      email: 'teacher_a@school-a.edu.vn',
      passwordHash: 'hashed_password_test_123',
      role: 'teacher',
      status: 'active',
      tenantId: tenantA._id,
      profile: { fullName: 'Cô Giáo A' }
    });

    adminB = await User.create({
      username: 'admin_b',
      email: 'admin_b@school-b.edu.vn',
      passwordHash: 'hashed_password_test_123',
      role: 'admin',
      status: 'active',
      tenantId: tenantB._id,
      profile: { fullName: 'Quản Trị B' }
    });

    teacherB = await User.create({
      username: 'teacher_b',
      email: 'teacher_b@school-b.edu.vn',
      passwordHash: 'hashed_password_test_123',
      role: 'teacher',
      status: 'active',
      tenantId: tenantB._id,
      profile: { fullName: 'Cô Giáo B' }
    });

    adminL = await User.create({
      username: 'admin_legacy',
      email: 'admin@legacy-school.edu.vn',
      passwordHash: 'hashed_password_test_123',
      role: 'admin',
      status: 'active',
      tenantId: null,
      profile: { fullName: 'Quản Trị Legacy' }
    });

    teacherL = await User.create({
      username: 'teacher_legacy',
      email: 'teacher@legacy-school.edu.vn',
      passwordHash: 'hashed_password_test_123',
      role: 'teacher',
      status: 'active',
      tenantId: null,
      profile: { fullName: 'Cô Giáo Legacy' }
    });

    // 3. Create Classrooms
    // classroomA1 assigned to teacherA
    classroomA1 = await Classroom.create({
      name: 'Lớp Mầm 1',
      fullName: 'Lớp Mầm 1 - Cơ sở A',
      ageGroup: '3-4',
      schoolYear: '2026-2027',
      status: 'active',
      tenantId: tenantA._id,
      homeroomTeacherId: teacherA._id
    });

    // classroomA2 unassigned to teacherA
    classroomA2 = await Classroom.create({
      name: 'Lớp Chồi 1',
      fullName: 'Lớp Chồi 1 - Cơ sở A',
      ageGroup: '4-5',
      schoolYear: '2026-2027',
      status: 'active',
      tenantId: tenantA._id
    });

    classroomB1 = await Classroom.create({
      name: 'Lớp Mầm B1',
      fullName: 'Lớp Mầm B1 - Cơ sở B',
      ageGroup: '3-4',
      schoolYear: '2026-2027',
      status: 'active',
      tenantId: tenantB._id,
      homeroomTeacherId: teacherB._id
    });

    classroomL1 = await Classroom.create({
      name: 'Lớp Mầm L1',
      fullName: 'Lớp Mầm L1 - Legacy',
      ageGroup: '3-4',
      schoolYear: '2026-2027',
      status: 'active',
      tenantId: null,
      homeroomTeacherId: teacherL._id
    });

    // 4. Create Students
    studentA1 = await Student.create({
      fullName: 'Bé Nguyễn An A1',
      studentCode: 'HS-2026-000001',
      birthDate: new Date('2021-01-15'),
      gender: 'male',
      classroomId: classroomA1._id,
      className: classroomA1.name,
      schoolYear: '2026-2027',
      status: 'enrolled',
      tenantId: tenantA._id,
      attendanceCardId: 'CARD-A1',
      faceProfileId: 'FACE-A1'
    });

    studentA2 = await Student.create({
      fullName: 'Bé Trần Bình A2',
      studentCode: 'HS-2026-000002',
      birthDate: new Date('2021-05-20'),
      gender: 'female',
      classroomId: classroomA2._id,
      className: classroomA2.name,
      schoolYear: '2026-2027',
      status: 'enrolled',
      tenantId: tenantA._id,
      attendanceCardId: 'CARD-A2',
      faceProfileId: 'FACE-A2'
    });

    studentB1 = await Student.create({
      fullName: 'Bé Lê Cúc B1',
      studentCode: 'HS-2026-000003',
      birthDate: new Date('2021-02-10'),
      gender: 'female',
      classroomId: classroomB1._id,
      className: classroomB1.name,
      schoolYear: '2026-2027',
      status: 'enrolled',
      tenantId: tenantB._id,
      attendanceCardId: 'CARD-B1',
      faceProfileId: 'FACE-B1'
    });

    studentL1 = await Student.create({
      fullName: 'Bé Phạm Dũng L1',
      studentCode: 'HS-2026-000004',
      birthDate: new Date('2021-03-05'),
      gender: 'male',
      classroomId: classroomL1._id,
      className: classroomL1.name,
      schoolYear: '2026-2027',
      status: 'enrolled',
      tenantId: null,
      attendanceCardId: 'CARD-L1',
      faceProfileId: 'FACE-L1'
    });

    // 5. Create Parents linked to students
    parentA = await User.create({
      username: 'parent_a',
      email: 'parent_a@school-a.edu.vn',
      passwordHash: 'hashed_password_test_123',
      role: 'parent',
      status: 'active',
      tenantId: tenantA._id,
      parentInfo: { studentIds: [studentA1._id] },
      profile: { fullName: 'Phụ Huynh Bé A1' }
    });

    parentB = await User.create({
      username: 'parent_b',
      email: 'parent_b@school-b.edu.vn',
      passwordHash: 'hashed_password_test_123',
      role: 'parent',
      status: 'active',
      tenantId: tenantB._id,
      parentInfo: { studentIds: [studentB1._id] },
      profile: { fullName: 'Phụ Huynh Bé B1' }
    });

    parentL = await User.create({
      username: 'parent_legacy',
      email: 'parent@legacy.edu.vn',
      passwordHash: 'hashed_password_test_123',
      role: 'parent',
      status: 'active',
      tenantId: null,
      parentInfo: { studentIds: [studentL1._id] },
      profile: { fullName: 'Phụ Huynh Legacy' }
    });
  });

  // =========================================================================
  // 1. automaticCheckIn
  // =========================================================================
  describe('1. automaticCheckIn', () => {
    test('1.1. Successfully check in student by card in Tenant A (stores tenantId: tenantA)', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        body: { identifier: 'CARD-A1', method: 'card' }
      });
      const res = createMockResponse();

      await automaticCheckIn(req, res);

      expect(res.statusCode).toBe(201);
      expect(res.body.alreadyCheckedIn).toBe(false);
      expect(res.body.data.studentId.toString()).toBe(studentA1._id.toString());
      expect(res.body.data.tenantId.toString()).toBe(tenantA._id.toString());

      const saved = await StudentAttendance.findById(res.body.data._id);
      expect(saved.tenantId.toString()).toBe(tenantA._id.toString());
    });

    test('1.2. Successfully check in student by face in Tenant A', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        body: { identifier: 'FACE-A1', method: 'face' }
      });
      const res = createMockResponse();

      await automaticCheckIn(req, res);

      expect(res.statusCode).toBe(201);
      expect(res.body.data.attendanceMethod).toBe('face');
      expect(res.body.data.tenantId.toString()).toBe(tenantA._id.toString());
    });

    test('1.3. Foreign card identifier from Tenant B returns 404 Not Found in Tenant A context', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        body: { identifier: 'CARD-B1', method: 'card' } // Card belongs to studentB1 in Tenant B
      });
      const res = createMockResponse();

      await automaticCheckIn(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy học sinh/);

      // Verify no record created in either tenant
      const count = await StudentAttendance.countDocuments({});
      expect(count).toBe(0);
    });

    test('1.4. Teacher outside assigned classroom gets 403 Forbidden in Tenant A', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        body: { identifier: 'CARD-A2', method: 'card' } // studentA2 is in classroomA2, not assigned to teacherA
      });
      const res = createMockResponse();

      await automaticCheckIn(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/không có quyền điểm danh học sinh ngoài lớp được phân công/);
    });

    test('1.5. Idempotent duplicate check-in on the same day returns 200 with alreadyCheckedIn: true', async () => {
      const req1 = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        body: { identifier: 'CARD-A1', method: 'card' }
      });
      const res1 = createMockResponse();
      await automaticCheckIn(req1, res1);
      expect(res1.statusCode).toBe(201);

      // Second check-in attempt
      const req2 = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        body: { identifier: 'CARD-A1', method: 'card' }
      });
      const res2 = createMockResponse();
      await automaticCheckIn(req2, res2);

      expect(res2.statusCode).toBe(200);
      expect(res2.body.alreadyCheckedIn).toBe(true);

      const count = await StudentAttendance.countDocuments({ studentId: studentA1._id });
      expect(count).toBe(1);
    });

    test('1.6. Legacy card check-in succeeds with tenantId: null', async () => {
      const req = createMockReq({
        user: teacherL,
        body: { identifier: 'CARD-L1', method: 'card' }
      });
      const res = createMockResponse();

      await automaticCheckIn(req, res);

      expect(res.statusCode).toBe(201);
      expect(res.body.data.tenantId).toBeNull();

      const saved = await StudentAttendance.findById(res.body.data._id);
      expect(saved.tenantId).toBeNull();
    });
  });

  // =========================================================================
  // 2. createAttendance
  // =========================================================================
  describe('2. createAttendance', () => {
    test('2.1. Teacher creates single attendance for assigned student in Tenant A (stores tenantId: tenantA)', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        body: {
          studentId: studentA1._id.toString(),
          status: 'present',
          note: 'Bé đi học đầy đủ'
        }
      });
      const res = createMockResponse();

      await createAttendance(req, res);

      expect(res.statusCode).toBe(201);
      expect(res.body.data.tenantId.toString()).toBe(tenantA._id.toString());
      expect(res.body.data.studentId.toString()).toBe(studentA1._id.toString());
    });

    test('2.2. Foreign student ID (Tenant B student) returns 404 Not Found', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        body: {
          studentId: studentB1._id.toString(), // Tenant B student
          status: 'present'
        }
      });
      const res = createMockResponse();

      await createAttendance(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy học sinh/);
    });

    test('2.3. Same-tenant unassigned classroom for teacher returns 403 Forbidden', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        body: {
          studentId: studentA2._id.toString(), // In classroomA2, not assigned to teacherA
          status: 'present'
        }
      });
      const res = createMockResponse();

      await createAttendance(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/không có quyền điểm danh học sinh ngoài lớp được phân công/);
    });

    test('2.4. Duplicate attendance on the same day returns 409 Conflict', async () => {
      const req1 = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        body: { studentId: studentA1._id.toString(), status: 'present' }
      });
      const res1 = createMockResponse();
      await createAttendance(req1, res1);
      expect(res1.statusCode).toBe(201);

      const req2 = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        body: { studentId: studentA1._id.toString(), status: 'late' }
      });
      const res2 = createMockResponse();
      await createAttendance(req2, res2);

      expect(res2.statusCode).toBe(409);
      expect(res2.body.message).toMatch(/đã có bản ghi điểm danh hôm nay/);
    });

    test('2.5. Legacy single attendance creation sets tenantId: null', async () => {
      const req = createMockReq({
        user: teacherL,
        body: { studentId: studentL1._id.toString(), status: 'present' }
      });
      const res = createMockResponse();

      await createAttendance(req, res);

      expect(res.statusCode).toBe(201);
      expect(res.body.data.tenantId).toBeNull();
    });
  });

  // =========================================================================
  // 3. createBulkAttendance
  // =========================================================================
  describe('3. createBulkAttendance', () => {
    test('3.1. Bulk attendance creates records with tenantId: tenantA for assigned classroom', async () => {
      const today = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        body: {
          classroomId: classroomA1._id.toString(),
          attendDate: today,
          records: [{ studentId: studentA1._id.toString(), status: 'present' }]
        }
      });
      const res = createMockResponse();

      await createBulkAttendance(req, res);

      expect(res.statusCode).toBe(201);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].tenantId.toString()).toBe(tenantA._id.toString());
    });

    test('3.2. Foreign classroom ID (Tenant B classroom) returns 404 Not Found', async () => {
      const today = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        body: {
          classroomId: classroomB1._id.toString(),
          attendDate: today,
          records: [{ studentId: studentB1._id.toString(), status: 'present' }]
        }
      });
      const res = createMockResponse();

      await createBulkAttendance(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy lớp học/);
    });

    test('3.3. Same-tenant unassigned classroom for teacher returns 403 Forbidden', async () => {
      const today = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        body: {
          classroomId: classroomA2._id.toString(),
          attendDate: today,
          records: [{ studentId: studentA2._id.toString(), status: 'present' }]
        }
      });
      const res = createMockResponse();

      await createBulkAttendance(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/không có quyền điểm danh lớp này/);
    });

    test('3.4. Student list containing a student from another tenant/classroom returns 400', async () => {
      const today = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id.toString(),
        body: {
          classroomId: classroomA1._id.toString(),
          attendDate: today,
          records: [
            { studentId: studentA1._id.toString(), status: 'present' },
            { studentId: studentB1._id.toString(), status: 'present' } // From Tenant B!
          ]
        }
      });
      const res = createMockResponse();

      await createBulkAttendance(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/Mỗi học sinh phải đang theo học và thuộc đúng lớp được điểm danh/);
    });

    test('3.5. Idempotent retry on the same day returns 200 with empty new data', async () => {
      const today = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
      const req1 = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        body: {
          classroomId: classroomA1._id.toString(),
          attendDate: today,
          records: [{ studentId: studentA1._id.toString(), status: 'present' }]
        }
      });
      const res1 = createMockResponse();
      await createBulkAttendance(req1, res1);
      expect(res1.statusCode).toBe(201);

      // Retry exact same bulk attendance
      const req2 = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        body: {
          classroomId: classroomA1._id.toString(),
          attendDate: today,
          records: [{ studentId: studentA1._id.toString(), status: 'present' }]
        }
      });
      const res2 = createMockResponse();
      await createBulkAttendance(req2, res2);

      expect(res2.statusCode).toBe(200);
      expect(res2.body.data).toHaveLength(0);
      expect(res2.body.message).toMatch(/đã có bản ghi điểm danh trong ngày/);
    });
  });

  // =========================================================================
  // 4. getAttendanceByStudent
  // =========================================================================
  describe('4. getAttendanceByStudent', () => {
    let attendRecordA;

    beforeEach(async () => {
      attendRecordA = await StudentAttendance.create({
        tenantId: tenantA._id,
        studentId: studentA1._id,
        studentName: studentA1.fullName,
        classroomId: classroomA1._id,
        className: classroomA1.name,
        attendDate: new Date(),
        status: 'present',
        attendanceMethod: 'manual',
        recordedBy: teacherA._id,
        recordedByName: teacherA.profile.fullName
      });
    });

    test('4.1. Parent A views attendance history of linked child in Tenant A (200 OK)', async () => {
      const req = createMockReq({
        user: parentA,
        tenantId: tenantA._id.toString(),
        params: { studentId: studentA1._id.toString() }
      });
      const res = createMockResponse();

      await getAttendanceByStudent(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]._id.toString()).toBe(attendRecordA._id.toString());
    });

    test('4.2. Foreign student ID (Tenant B student) returns 404 Not Found to Parent A', async () => {
      const req = createMockReq({
        user: parentA,
        tenantId: tenantA._id.toString(),
        params: { studentId: studentB1._id.toString() }
      });
      const res = createMockResponse();

      await getAttendanceByStudent(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy học sinh/);
    });

    test('4.3. Same-tenant unlinked student ID returns 403 Forbidden to Parent A', async () => {
      const req = createMockReq({
        user: parentA,
        tenantId: tenantA._id.toString(),
        params: { studentId: studentA2._id.toString() } // Same tenant, but not linked to parentA
      });
      const res = createMockResponse();

      await getAttendanceByStudent(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/không có quyền xem dữ liệu điểm danh của học sinh này/);
    });

    test('4.4. Teacher A views attendance for student in assigned classroom (200 OK)', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        params: { studentId: studentA1._id.toString() }
      });
      const res = createMockResponse();

      await getAttendanceByStudent(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    test('4.5. Teacher A querying student in unassigned classroom in Tenant A returns 403 Forbidden', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        params: { studentId: studentA2._id.toString() }
      });
      const res = createMockResponse();

      await getAttendanceByStudent(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/không có quyền xem dữ liệu điểm danh của học sinh này/);
    });

    test('4.6. Teacher A querying student in Tenant B returns 404 Not Found', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        params: { studentId: studentB1._id.toString() }
      });
      const res = createMockResponse();

      await getAttendanceByStudent(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy học sinh/);
    });

    test('4.7. Legacy parent views linked legacy child (200 OK) but gets 404 for SaaS student', async () => {
      await StudentAttendance.create({
        tenantId: null,
        studentId: studentL1._id,
        studentName: studentL1.fullName,
        classroomId: classroomL1._id,
        className: classroomL1.name,
        attendDate: new Date(),
        status: 'present',
        attendanceMethod: 'manual',
        recordedBy: teacherL._id,
        recordedByName: teacherL.profile.fullName
      });

      const reqL = createMockReq({
        user: parentL,
        params: { studentId: studentL1._id.toString() }
      });
      const resL = createMockResponse();
      await getAttendanceByStudent(reqL, resL);
      expect(resL.statusCode).toBe(200);
      expect(resL.body.data).toHaveLength(1);

      // Legacy parent querying SaaS student -> 404
      const reqForeign = createMockReq({
        user: parentL,
        params: { studentId: studentA1._id.toString() }
      });
      const resForeign = createMockResponse();
      await getAttendanceByStudent(reqForeign, resForeign);
      expect(resForeign.statusCode).toBe(404);
    });
  });

  // =========================================================================
  // 5. getAttendanceByClass
  // =========================================================================
  describe('5. getAttendanceByClass', () => {
    beforeEach(async () => {
      const { start } = getWorkDateRange(getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE), DEFAULT_SCHOOL_TIMEZONE);
      await StudentAttendance.create({
        tenantId: tenantA._id,
        studentId: studentA1._id,
        studentName: studentA1.fullName,
        classroomId: classroomA1._id,
        className: classroomA1.name,
        attendDate: start,
        status: 'present',
        attendanceMethod: 'manual',
        recordedBy: teacherA._id,
        recordedByName: teacherA.profile.fullName
      });
    });

    test('5.1. Teacher A views attendance for assigned classroom in Tenant A (200 OK)', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        params: { classroomId: classroomA1._id.toString() }
      });
      const res = createMockResponse();

      await getAttendanceByClass(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    test('5.2. Teacher A querying unassigned classroom in Tenant A returns 403 Forbidden', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        params: { classroomId: classroomA2._id.toString() }
      });
      const res = createMockResponse();

      await getAttendanceByClass(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/không có quyền xem điểm danh lớp này/);
    });

    test('5.3. Querying foreign classroom in Tenant B returns 404 Not Found', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        params: { classroomId: classroomB1._id.toString() }
      });
      const res = createMockResponse();

      await getAttendanceByClass(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy lớp học/);
    });

    test('5.4. Parent querying classroom attendance returns 403 Forbidden', async () => {
      const req = createMockReq({
        user: parentA,
        tenantId: tenantA._id.toString(),
        params: { classroomId: classroomA1._id.toString() }
      });
      const res = createMockResponse();

      await getAttendanceByClass(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/Phụ huynh không có quyền xem điểm danh theo lớp/);
    });
  });

  // =========================================================================
  // 6. updateAttendance and deleteAttendance
  // =========================================================================
  describe('6. updateAttendance and deleteAttendance', () => {
    let recordA;
    let recordB;

    beforeEach(async () => {
      recordA = await StudentAttendance.create({
        tenantId: tenantA._id,
        studentId: studentA1._id,
        studentName: studentA1.fullName,
        classroomId: classroomA1._id,
        className: classroomA1.name,
        attendDate: new Date(),
        status: 'present',
        attendanceMethod: 'manual',
        recordedBy: teacherA._id,
        recordedByName: teacherA.profile.fullName
      });

      recordB = await StudentAttendance.create({
        tenantId: tenantB._id,
        studentId: studentB1._id,
        studentName: studentB1.fullName,
        classroomId: classroomB1._id,
        className: classroomB1.name,
        attendDate: new Date(),
        status: 'present',
        attendanceMethod: 'manual',
        recordedBy: teacherB._id,
        recordedByName: teacherB.profile.fullName
      });
    });

    test('6.1. Teacher A updates attendance in assigned classroom in Tenant A (200 OK)', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        params: { id: recordA._id.toString() },
        body: { status: 'late', note: 'Đến muộn do thời tiết' }
      });
      const res = createMockResponse();

      await updateAttendance(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.status).toBe('late');
      expect(res.body.data.note).toBe('Đến muộn do thời tiết');
    });

    test('6.2. Updating foreign attendance record (Tenant B) returns 404 Not Found', async () => {
      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id.toString(),
        params: { id: recordB._id.toString() },
        body: { status: 'absent' }
      });
      const res = createMockResponse();

      await updateAttendance(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy bản ghi điểm danh/);

      // Verify recordB was untouched
      const untouched = await StudentAttendance.findById(recordB._id);
      expect(untouched.status).toBe('present');
    });

    test('6.3. Admin A deletes attendance record in Tenant A (200 OK)', async () => {
      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id.toString(),
        params: { id: recordA._id.toString() }
      });
      const res = createMockResponse();

      await deleteAttendance(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.message).toMatch(/Xóa điểm danh thành công/);

      const exists = await StudentAttendance.findById(recordA._id);
      expect(exists).toBeNull();
    });

    test('6.4. Admin A attempting to delete attendance in Tenant B returns 404 Not Found and does not delete it', async () => {
      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id.toString(),
        params: { id: recordB._id.toString() }
      });
      const res = createMockResponse();

      await deleteAttendance(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy bản ghi điểm danh/);

      const exists = await StudentAttendance.findById(recordB._id);
      expect(exists).not.toBeNull();
    });
  });

  // =========================================================================
  // 7. createLeaveRequest (SaaS Unlocked & Scoped)
  // =========================================================================
  describe('7. createLeaveRequest', () => {
    test('7.1. Parent A creates leave request for linked child in Tenant A (201 Created with tenantId: tenantA)', async () => {
      const tomorrow = getNextSchoolDay();
      const req = createMockReq({
        user: parentA,
        tenantId: tenantA._id.toString(),
        body: {
          studentId: studentA1._id.toString(),
          startDate: tomorrow,
          endDate: tomorrow,
          reason: 'Bé bị cảm sốt cần nghỉ theo dõi tại nhà'
        }
      });
      const res = createMockResponse();

      await createLeaveRequest(req, res);

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tenantId.toString()).toBe(tenantA._id.toString());
      expect(res.body.data.status).toBe('pending');
    });

    test('7.2. Foreign student ID (Tenant B) returns 404 Not Found', async () => {
      const tomorrow = getNextSchoolDay();
      const req = createMockReq({
        user: parentA,
        tenantId: tenantA._id.toString(),
        body: {
          studentId: studentB1._id.toString(), // Tenant B
          startDate: tomorrow,
          endDate: tomorrow,
          reason: 'Đơn nghỉ học cho học sinh trường B'
        }
      });
      const res = createMockResponse();

      await createLeaveRequest(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Không tìm thấy học sinh/);
    });

    test('7.3. Same-tenant unlinked student ID returns 403 Forbidden', async () => {
      const tomorrow = getNextSchoolDay();
      const req = createMockReq({
        user: parentA,
        tenantId: tenantA._id.toString(),
        body: {
          studentId: studentA2._id.toString(), // In Tenant A, but not linked to parentA
          startDate: tomorrow,
          endDate: tomorrow,
          reason: 'Đơn nghỉ cho học sinh không phải con mình'
        }
      });
      const res = createMockResponse();

      await createLeaveRequest(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/không có quyền gửi đơn cho học sinh này/);
    });

    test('7.4. Overlapping leave request on same dates returns 409 Conflict', async () => {
      const tomorrow = getNextSchoolDay();
      const req1 = createMockReq({
        user: parentA,
        tenantId: tenantA._id.toString(),
        body: {
          studentId: studentA1._id.toString(),
          startDate: tomorrow,
          endDate: tomorrow,
          reason: 'Lý do 1'
        }
      });
      const res1 = createMockResponse();
      await createLeaveRequest(req1, res1);
      expect(res1.statusCode).toBe(201);

      const req2 = createMockReq({
        user: parentA,
        tenantId: tenantA._id.toString(),
        body: {
          studentId: studentA1._id.toString(),
          startDate: tomorrow,
          endDate: tomorrow,
          reason: 'Lý do 2'
        }
      });
      const res2 = createMockResponse();
      await createLeaveRequest(req2, res2);

      expect(res2.statusCode).toBe(409);
      expect(res2.body.message).toMatch(/Đã có đơn chờ duyệt hoặc được duyệt/);
    });

    test('7.5. Legacy parent creates leave request with tenantId: null', async () => {
      const tomorrow = getNextSchoolDay();
      const req = createMockReq({
        user: parentL,
        body: {
          studentId: studentL1._id.toString(),
          startDate: tomorrow,
          endDate: tomorrow,
          reason: 'Bé cần nghỉ học việc gia đình'
        }
      });
      const res = createMockResponse();

      await createLeaveRequest(req, res);

      expect(res.statusCode).toBe(201);
      expect(res.body.data.tenantId).toBeNull();
    });
  });

  // =========================================================================
  // 8. getLeaveRequests
  // =========================================================================
  describe('8. getLeaveRequests', () => {
    let leaveA;
    let leaveB;

    beforeEach(async () => {
      const tomorrow = getNextSchoolDay();
      leaveA = await StudentLeaveRequest.create({
        tenantId: tenantA._id,
        studentId: studentA1._id,
        studentName: studentA1.fullName,
        classroomId: classroomA1._id,
        className: classroomA1.name,
        requesterId: parentA._id,
        requesterName: parentA.profile.fullName,
        startDate: tomorrow,
        endDate: tomorrow,
        reason: 'Nghỉ ốm',
        status: 'pending'
      });

      leaveB = await StudentLeaveRequest.create({
        tenantId: tenantB._id,
        studentId: studentB1._id,
        studentName: studentB1.fullName,
        classroomId: classroomB1._id,
        className: classroomB1.name,
        requesterId: parentB._id,
        requesterName: parentB.profile.fullName,
        startDate: tomorrow,
        endDate: tomorrow,
        reason: 'Việc bận',
        status: 'pending'
      });
    });

    test('8.1. Parent A only sees their own leave requests in Tenant A', async () => {
      const req = createMockReq({
        user: parentA,
        tenantId: tenantA._id.toString()
      });
      const res = createMockResponse();

      await getLeaveRequests(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]._id.toString()).toBe(leaveA._id.toString());
    });

    test('8.2. Teacher A only sees leave requests for assigned classroom in Tenant A', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString()
      });
      const res = createMockResponse();

      await getLeaveRequests(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].classroomId.toString()).toBe(classroomA1._id.toString());
    });

    test('8.3. Admin A sees all leave requests in Tenant A, zero from Tenant B or Legacy', async () => {
      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id.toString()
      });
      const res = createMockResponse();

      await getLeaveRequests(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].tenantId.toString()).toBe(tenantA._id.toString());
    });
  });

  // =========================================================================
  // 9. reviewLeaveRequest
  // =========================================================================
  describe('9. reviewLeaveRequest', () => {
    let leaveA;

    beforeEach(async () => {
      const tomorrow = getNextSchoolDay();
      leaveA = await StudentLeaveRequest.create({
        tenantId: tenantA._id,
        studentId: studentA1._id,
        studentName: studentA1.fullName,
        classroomId: classroomA1._id,
        className: classroomA1.name,
        requesterId: parentA._id,
        requesterName: parentA.profile.fullName,
        startDate: tomorrow,
        endDate: tomorrow,
        reason: 'Bé nghỉ ốm',
        status: 'pending'
      });
    });

    test('9.1. Admin A approves leave request in Tenant A, creating StudentAttendance records with tenantId: tenantA', async () => {
      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id.toString(),
        params: { id: leaveA._id.toString() },
        body: { decision: 'approved', reviewNote: 'Chúc bé sớm khỏi bệnh' }
      });
      const res = createMockResponse();

      await reviewLeaveRequest(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('approved');

      const attendance = await StudentAttendance.findOne({ studentId: studentA1._id });
      expect(attendance).not.toBeNull();
      expect(attendance.status).toBe('absent_permission');
      expect(attendance.tenantId.toString()).toBe(tenantA._id.toString());
    });

    test('9.2. Admin B attempting to review Tenant A leave request returns 404 Not Found (zero side effects)', async () => {
      const req = createMockReq({
        user: adminB,
        tenantId: tenantB._id.toString(),
        params: { id: leaveA._id.toString() }, // Tenant A request
        body: { decision: 'approved', reviewNote: 'Duyệt trái phép' }
      });
      const res = createMockResponse();

      await reviewLeaveRequest(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy đơn xin nghỉ/);

      // Verify leaveA is still pending and no attendance created
      const leaveCheck = await StudentLeaveRequest.findById(leaveA._id);
      expect(leaveCheck.status).toBe('pending');
      const attendanceCount = await StudentAttendance.countDocuments({});
      expect(attendanceCount).toBe(0);
    });

    test('9.3. Approval with existing attendance on date rolls back and returns 409 Conflict', async () => {
      const tomorrow = getNextSchoolDay();
      // Pre-create an attendance record on that date
      await StudentAttendance.create({
        tenantId: tenantA._id,
        studentId: studentA1._id,
        studentName: studentA1.fullName,
        classroomId: classroomA1._id,
        className: classroomA1.name,
        attendDate: getWorkDateRange(tomorrow, DEFAULT_SCHOOL_TIMEZONE).start,
        attendanceDateKey: tomorrow,
        status: 'present',
        attendanceMethod: 'manual',
        recordedBy: teacherA._id,
        recordedByName: teacherA.profile.fullName
      });

      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id.toString(),
        params: { id: leaveA._id.toString() },
        body: { decision: 'approved' }
      });
      const res = createMockResponse();

      await reviewLeaveRequest(req, res);

      expect(res.statusCode).toBe(409);
      expect(res.body.message).toMatch(/Không thể duyệt vì đã có điểm danh vào ngày/);

      // Request remains pending because transaction rolled back
      const leaveCheck = await StudentLeaveRequest.findById(leaveA._id);
      expect(leaveCheck.status).toBe('pending');
    });

    test('9.4. Teacher role attempting review returns 403 Forbidden', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        params: { id: leaveA._id.toString() },
        body: { decision: 'approved' }
      });
      const res = createMockResponse();

      await reviewLeaveRequest(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/Chỉ Principal hoặc quản trị viên/);
    });
  });

  // =========================================================================
  // 10. getAbsenceReport
  // =========================================================================
  describe('10. getAbsenceReport', () => {
    beforeEach(async () => {
      const today = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
      const { start } = getWorkDateRange(today, DEFAULT_SCHOOL_TIMEZONE);

      // 1 absent record in Tenant A
      await StudentAttendance.create({
        tenantId: tenantA._id,
        studentId: studentA1._id,
        studentName: studentA1.fullName,
        classroomId: classroomA1._id,
        className: classroomA1.name,
        attendDate: start,
        status: 'absent',
        attendanceMethod: 'manual',
        recordedBy: teacherA._id,
        recordedByName: teacherA.profile.fullName
      });

      // 1 late record in Tenant A
      await StudentAttendance.create({
        tenantId: tenantA._id,
        studentId: studentA2._id,
        studentName: studentA2.fullName,
        classroomId: classroomA2._id,
        className: classroomA2.name,
        attendDate: start,
        status: 'late',
        attendanceMethod: 'manual',
        recordedBy: adminA._id,
        recordedByName: adminA.profile.fullName
      });

      // 5 absent records in Tenant B
      await StudentAttendance.create({
        tenantId: tenantB._id,
        studentId: studentB1._id,
        studentName: studentB1.fullName,
        classroomId: classroomB1._id,
        className: classroomB1.name,
        attendDate: start,
        status: 'absent',
        attendanceMethod: 'manual',
        recordedBy: teacherB._id,
        recordedByName: teacherB.profile.fullName
      });
    });

    test('10.1. Admin A absence report aggregates data strictly within Tenant A', async () => {
      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id.toString()
      });
      const res = createMockResponse();

      await getAbsenceReport(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.totals.absent).toBe(1); // Not 2 (Tenant B's absent record excluded)
      expect(res.body.data.totals.late).toBe(1);
      expect(res.body.data.records).toHaveLength(2);
    });

    test('10.2. Filter by foreign classroom (Tenant B) returns 404 Not Found', async () => {
      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id.toString(),
        query: { classroomId: classroomB1._id.toString() }
      });
      const res = createMockResponse();

      await getAbsenceReport(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy lớp học/);
    });

    test('10.3. Teacher A querying unassigned classroom in Tenant A returns 403 Forbidden', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        query: { classroomId: classroomA2._id.toString() }
      });
      const res = createMockResponse();

      await getAbsenceReport(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/Bạn không có quyền xem lớp này/);
    });

    test('10.4. Teacher A without classroom param only aggregates for their assigned classrooms', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString()
      });
      const res = createMockResponse();

      await getAbsenceReport(req, res);

      expect(res.statusCode).toBe(200);
      // Teacher A only has classroomA1 assigned, so only studentA1 (absent: 1, late: 0)
      expect(res.body.data.totals.absent).toBe(1);
      expect(res.body.data.totals.late).toBe(0);
      expect(res.body.data.records).toHaveLength(1);
    });
  });

  // =========================================================================
  // 11. Security & Anti-Spoofing (Forged / Invalid Context)
  // =========================================================================
  describe('11. Security & Anti-Spoofing (Forged / Invalid Context)', () => {
    test('11.1. Request with forged req.tenantId mismatched with req.user.tenantId returns 403', async () => {
      const req = createMockReq({
        user: teacherA, // tenantId = tenantA
        tenantId: tenantB._id.toString(), // Forged to tenantB!
        body: { identifier: 'CARD-A1', method: 'card' }
      });
      const res = createMockResponse();

      await automaticCheckIn(req, res);

      expect(res.statusCode).toBe(403);
    });

    test('11.2. Request without req.user but with spoofed req.tenantId returns 403', async () => {
      const req = createMockReq({
        user: null,
        tenantId: tenantA._id.toString(),
        body: { studentId: studentA1._id.toString() }
      });
      const res = createMockResponse();

      await createAttendance(req, res);

      expect(res.statusCode).toBe(403);
    });

    test('11.3. Legacy user with spoofed req.tenantId returns 403', async () => {
      const req = createMockReq({
        user: adminL, // Legacy user (tenantId: null)
        tenantId: tenantA._id.toString(), // Spoofed SaaS tenantId
        params: { studentId: studentA1._id.toString() }
      });
      const res = createMockResponse();

      await getAttendanceByStudent(req, res);

      expect(res.statusCode).toBe(403);
    });
  });
});
