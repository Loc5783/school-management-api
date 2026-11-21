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

const {
  getAllClassrooms,
  getClassroomById
} = require('../../src/controllers/classroomController');

const {
  getAllStudents,
  getStudentById,
  getDailyReports,
  getStudentTransferHistory
} = require('../../src/controllers/studentController');

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
  params = {},
  query = {},
  headers = {},
  isLegacy = undefined
} = {}) => {
  const req = {
    user,
    params,
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

describe('Task 1B.3 - Tenant Scoping for Student & Classroom GET Reads', () => {
  let bootstrapInstance;

  // Tenants
  let tenantA;
  let tenantB;

  // Classrooms
  let classroomA1;
  let classroomA2;
  let classroomA_SameName;
  let classroomB1;
  let classroomB_SameName;
  let classroomL1;
  let classroomL2;
  let classroomL_SameName;

  // Users
  let adminA;
  let teacherA;
  let parentA;

  let adminB;
  let teacherB;
  let parentB;

  let adminL;
  let teacherL;
  let parentL;

  // Students
  let studentA1;
  let studentA2;
  let studentB1;
  let studentB2;
  let studentL1;
  let studentL2;

  // Transfer history
  let historyA1;
  let historyB1;
  let historyL1;

  beforeAll(async () => {
    bootstrapInstance = await testDbBootstrap.startTestDb({
      instanceOpts: [{ dbName: 'school_saas_1b3_test_isolated' }]
    });
    await Classroom.syncIndexes();
    await Student.syncIndexes();
    await StudentTransferHistory.syncIndexes();
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
      StudentTransferHistory.deleteMany({})
    ]);

    // 1. Create Tenants
    tenantA = await Tenant.create({
      code: 'TRUONG-A',
      name: 'Trường Mầm Non Họa Mi A',
      status: 'active',
      authVersion: 0
    });

    tenantB = await Tenant.create({
      code: 'TRUONG-B',
      name: 'Trường Mầm Non Ban Mai B',
      status: 'active',
      authVersion: 0
    });

    // 2. Create Users
    adminA = await User.create({
      username: 'admin_tenant_a',
      passwordHash: 'not-used',
      role: 'admin',
      status: 'active',
      tenantId: tenantA._id,
      authVersion: 0,
      profile: { fullName: 'Admin Tenant A' }
    });

    teacherA = await User.create({
      username: 'teacher_tenant_a',
      passwordHash: 'not-used',
      role: 'teacher',
      status: 'active',
      tenantId: tenantA._id,
      authVersion: 0,
      profile: { fullName: 'Cô Giáo Tenant A' }
    });

    adminB = await User.create({
      username: 'admin_tenant_b',
      passwordHash: 'not-used',
      role: 'admin',
      status: 'active',
      tenantId: tenantB._id,
      authVersion: 0,
      profile: { fullName: 'Admin Tenant B' }
    });

    teacherB = await User.create({
      username: 'teacher_tenant_b',
      passwordHash: 'not-used',
      role: 'teacher',
      status: 'active',
      tenantId: tenantB._id,
      authVersion: 0,
      profile: { fullName: 'Cô Giáo Tenant B' }
    });

    adminL = await User.create({
      username: 'admin_legacy',
      passwordHash: 'not-used',
      role: 'admin',
      status: 'active',
      tenantId: null,
      authVersion: 0,
      profile: { fullName: 'Admin Legacy' }
    });

    teacherL = await User.create({
      username: 'teacher_legacy',
      passwordHash: 'not-used',
      role: 'teacher',
      status: 'active',
      tenantId: null,
      authVersion: 0,
      profile: { fullName: 'Cô Giáo Legacy' }
    });

    // 3. Create Classrooms
    // Tenant A
    classroomA1 = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Mầm 1A',
      fullName: 'Lớp Mầm 1 - Cơ sở A',
      ageGroup: '3-4',
      schoolYear: '2025-2026',
      status: 'active',
      homeroomTeacherId: teacherA._id,
      teachers: [{ teacherId: teacherA._id, role: 'homeroom' }]
    });

    classroomA2 = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Chồi 1A',
      fullName: 'Lớp Chồi 1 - Cơ sở A',
      ageGroup: '4-5',
      schoolYear: '2025-2026',
      status: 'active'
    });

    classroomA_SameName = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Mầm Hoa Hồng',
      fullName: 'Lớp Mầm Hoa Hồng Trường A',
      ageGroup: '3-4',
      schoolYear: '2025-2026',
      status: 'active'
    });

    // Tenant B
    classroomB1 = await Classroom.create({
      tenantId: tenantB._id,
      name: 'Lớp Mầm 1B',
      fullName: 'Lớp Mầm 1 - Cơ sở B',
      ageGroup: '3-4',
      schoolYear: '2025-2026',
      status: 'active',
      homeroomTeacherId: teacherB._id,
      teachers: [{ teacherId: teacherB._id, role: 'homeroom' }]
    });

    classroomB_SameName = await Classroom.create({
      tenantId: tenantB._id,
      name: 'Lớp Mầm Hoa Hồng',
      fullName: 'Lớp Mầm Hoa Hồng Trường B',
      ageGroup: '3-4',
      schoolYear: '2025-2026',
      status: 'active'
    });

    // Legacy
    classroomL1 = await Classroom.create({
      tenantId: null,
      name: 'Lớp Mầm Legacy Null',
      fullName: 'Lớp Mầm Legacy Null Tenant',
      ageGroup: '3-4',
      schoolYear: '2025-2026',
      status: 'active',
      homeroomTeacherId: teacherL._id,
      teachers: [{ teacherId: teacherL._id, role: 'homeroom' }]
    });

    classroomL2 = await Classroom.create({
      name: 'Lớp Chồi Legacy Missing',
      fullName: 'Lớp Chồi Legacy Missing Field',
      ageGroup: '4-5',
      schoolYear: '2025-2026',
      status: 'active'
    });

    classroomL_SameName = await Classroom.create({
      tenantId: null,
      name: 'Lớp Mầm Hoa Hồng',
      fullName: 'Lớp Mầm Hoa Hồng Legacy',
      ageGroup: '3-4',
      schoolYear: '2025-2026',
      status: 'active'
    });

    // 4. Create Students (with care books / daily reports)
    studentA1 = await Student.create({
      tenantId: tenantA._id,
      fullName: 'Nguyễn Văn An',
      studentCode: 'HS-2026-000001',
      birthDate: new Date('2021-01-15'),
      gender: 'male',
      classroomId: classroomA1._id,
      className: classroomA1.name,
      schoolYear: '2025-2026',
      status: 'enrolled',
      dailyReports: [{
        reportDate: new Date('2026-03-01'),
        activities: 'Học vẽ tranh màu nước tại trường A',
        meals: 'Ăn hết suất cơm trưa',
        sleep: 'Ngủ ngoan 2 tiếng',
        health: 'Bình thường'
      }]
    });

    studentA2 = await Student.create({
      tenantId: tenantA._id,
      fullName: 'Trần Thị Bình',
      studentCode: 'HS-2026-000002',
      birthDate: new Date('2021-05-20'),
      gender: 'female',
      classroomId: classroomA2._id,
      className: classroomA2.name,
      schoolYear: '2025-2026',
      status: 'enrolled',
      dailyReports: [{
        reportDate: new Date('2026-03-01'),
        activities: 'Múa hát cùng các bạn',
        meals: 'Ăn tốt',
        sleep: 'Ngủ đủ giấc',
        health: 'Tốt'
      }]
    });

    studentB1 = await Student.create({
      tenantId: tenantB._id,
      fullName: 'Nguyễn Văn An', // SAME EXACT FULLNAME
      studentCode: 'HS-2026-000003',
      birthDate: new Date('2021-02-10'),
      gender: 'male',
      classroomId: classroomB1._id,
      className: classroomB1.name,
      schoolYear: '2025-2026',
      status: 'enrolled',
      dailyReports: [{
        reportDate: new Date('2026-03-01'),
        activities: 'Chơi lắp ráp lego tại trường B',
        meals: 'Ăn đầy đủ dinh dưỡng',
        sleep: 'Ngủ ngon giấc',
        health: 'Khỏe mạnh'
      }]
    });

    studentB2 = await Student.create({
      tenantId: tenantB._id,
      fullName: 'Lê Văn Cường',
      studentCode: 'HS-2026-000004',
      birthDate: new Date('2021-08-12'),
      gender: 'male',
      classroomId: classroomB1._id,
      className: classroomB1.name,
      schoolYear: '2025-2026',
      status: 'enrolled'
    });

    studentL1 = await Student.create({
      tenantId: null,
      fullName: 'Nguyễn Văn An', // SAME EXACT FULLNAME
      studentCode: 'HS-2026-000005',
      birthDate: new Date('2021-03-05'),
      gender: 'male',
      classroomId: classroomL1._id,
      className: classroomL1.name,
      schoolYear: '2025-2026',
      status: 'enrolled',
      dailyReports: [{
        reportDate: new Date('2026-03-01'),
        activities: 'Kể chuyện cổ tích tại lớp Legacy',
        meals: 'Ăn hết cháo',
        sleep: 'Ngủ 1.5 tiếng',
        health: 'Bình thường'
      }]
    });

    studentL2 = await Student.create({
      fullName: 'Phạm Minh Đức', // MISSING TENANTID FIELD
      studentCode: 'HS-2026-000006',
      birthDate: new Date('2021-09-19'),
      gender: 'male',
      classroomId: classroomL2._id,
      className: classroomL2.name,
      schoolYear: '2025-2026',
      status: 'enrolled'
    });

    // 5. Create Parents linked to respective students
    parentA = await User.create({
      username: 'parent_tenant_a',
      passwordHash: 'not-used',
      role: 'parent',
      status: 'active',
      tenantId: tenantA._id,
      authVersion: 0,
      profile: { fullName: 'Phụ huynh Tenant A' },
      parentInfo: { studentIds: [studentA1._id] }
    });

    parentB = await User.create({
      username: 'parent_tenant_b',
      passwordHash: 'not-used',
      role: 'parent',
      status: 'active',
      tenantId: tenantB._id,
      authVersion: 0,
      profile: { fullName: 'Phụ huynh Tenant B' },
      parentInfo: { studentIds: [studentB1._id] }
    });

    parentL = await User.create({
      username: 'parent_legacy',
      passwordHash: 'not-used',
      role: 'parent',
      status: 'active',
      tenantId: null,
      authVersion: 0,
      profile: { fullName: 'Phụ huynh Legacy' },
      parentInfo: { studentIds: [studentL1._id] }
    });

    // 6. Create Transfer History
    historyA1 = await StudentTransferHistory.create({
      tenantId: tenantA._id,
      studentId: studentA1._id,
      studentCode: studentA1.studentCode,
      studentName: studentA1.fullName,
      fromClassroomId: classroomA2._id,
      fromClassName: classroomA2.name,
      toClassroomId: classroomA1._id,
      toClassName: classroomA1.name,
      schoolYear: '2025-2026',
      reason: 'Chuyển sang lớp phù hợp lứa tuổi tại trường A',
      effectiveDate: new Date('2026-01-10'),
      transferredBy: adminA._id,
      transferredByName: 'Admin Trường A'
    });

    historyB1 = await StudentTransferHistory.create({
      tenantId: tenantB._id,
      studentId: studentB1._id,
      studentCode: studentB1.studentCode,
      studentName: studentB1.fullName,
      fromClassroomId: classroomB1._id,
      fromClassName: classroomB1.name,
      toClassroomId: classroomB_SameName._id,
      toClassName: classroomB_SameName.name,
      schoolYear: '2025-2026',
      reason: 'Chuyển phân lớp tại trường B',
      effectiveDate: new Date('2026-01-15'),
      transferredBy: adminB._id,
      transferredByName: 'Admin Trường B'
    });

    historyL1 = await StudentTransferHistory.create({
      tenantId: null,
      studentId: studentL1._id,
      studentCode: studentL1.studentCode,
      studentName: studentL1.fullName,
      fromClassroomId: classroomL2._id,
      fromClassName: classroomL2.name,
      toClassroomId: classroomL1._id,
      toClassName: classroomL1.name,
      schoolYear: '2025-2026',
      reason: 'Chuyển lớp hệ thống legacy',
      effectiveDate: new Date('2026-01-20'),
      transferredBy: adminL._id,
      transferredByName: 'Admin Legacy'
    });
  });

  // =========================================================================
  // Part 1: Classroom Read Scoping (getAllClassrooms, getClassroomById)
  // =========================================================================
  describe('Part 1: Classroom Read Scoping', () => {
    test('1.1 Admin A only discovers classrooms belonging to Tenant A', async () => {
      const req = createMockReq({ user: adminA, tenantId: tenantA._id.toString() });
      const res = createMockResponse();

      await getAllClassrooms(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      const ids = res.body.data.map((c) => c._id.toString());
      expect(ids).toContain(classroomA1._id.toString());
      expect(ids).toContain(classroomA2._id.toString());
      expect(ids).toContain(classroomA_SameName._id.toString());
      // Must NOT contain Tenant B or Legacy classrooms
      expect(ids).not.toContain(classroomB1._id.toString());
      expect(ids).not.toContain(classroomB_SameName._id.toString());
      expect(ids).not.toContain(classroomL1._id.toString());
      expect(ids).not.toContain(classroomL2._id.toString());
      expect(ids).not.toContain(classroomL_SameName._id.toString());
    });

    test('1.2 Teacher A only discovers classrooms assigned to Teacher A in Tenant A', async () => {
      const req = createMockReq({ user: teacherA, tenantId: tenantA._id.toString() });
      const res = createMockResponse();

      await getAllClassrooms(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      const ids = res.body.data.map((c) => c._id.toString());
      // Teacher A is only assigned to classroomA1
      expect(ids).toEqual([classroomA1._id.toString()]);
      expect(ids).not.toContain(classroomA2._id.toString());
      expect(ids).not.toContain(classroomB1._id.toString());
    });

    test('1.3 Legacy Admin only discovers classrooms with tenantId null or missing', async () => {
      const req = createMockReq({ user: adminL, isLegacy: true });
      const res = createMockResponse();

      await getAllClassrooms(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      const ids = res.body.data.map((c) => c._id.toString());
      expect(ids).toContain(classroomL1._id.toString());
      expect(ids).toContain(classroomL2._id.toString());
      expect(ids).toContain(classroomL_SameName._id.toString());
      // Must NOT contain any SaaS classroom
      expect(ids).not.toContain(classroomA1._id.toString());
      expect(ids).not.toContain(classroomB1._id.toString());
    });

    test('1.4 Same classroom name ("Lớp Mầm Hoa Hồng") across tenants is strictly isolated', async () => {
      // Query for Tenant A
      const reqA = createMockReq({ user: adminA, tenantId: tenantA._id.toString() });
      const resA = createMockResponse();
      await getAllClassrooms(reqA, resA);
      const sameNameA = resA.body.data.filter((c) => c.name === 'Lớp Mầm Hoa Hồng');
      expect(sameNameA).toHaveLength(1);
      expect(sameNameA[0]._id.toString()).toBe(classroomA_SameName._id.toString());

      // Query for Tenant B
      const reqB = createMockReq({ user: adminB, tenantId: tenantB._id.toString() });
      const resB = createMockResponse();
      await getAllClassrooms(reqB, resB);
      const sameNameB = resB.body.data.filter((c) => c.name === 'Lớp Mầm Hoa Hồng');
      expect(sameNameB).toHaveLength(1);
      expect(sameNameB[0]._id.toString()).toBe(classroomB_SameName._id.toString());

      // Query for Legacy
      const reqL = createMockReq({ user: adminL, isLegacy: true });
      const resL = createMockResponse();
      await getAllClassrooms(reqL, resL);
      const sameNameL = resL.body.data.filter((c) => c.name === 'Lớp Mầm Hoa Hồng');
      expect(sameNameL).toHaveLength(1);
      expect(sameNameL[0]._id.toString()).toBe(classroomL_SameName._id.toString());
    });

    test('1.5 getClassroomById returns 200 for classroom in caller tenant', async () => {
      const req = createMockReq({ user: adminA, tenantId: tenantA._id.toString(), params: { id: classroomA1._id.toString() } });
      const res = createMockResponse();

      await getClassroomById(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data._id.toString()).toBe(classroomA1._id.toString());
    });

    test('1.6 Foreign ID -> 404: Admin A querying Tenant B classroom gets 404', async () => {
      const req = createMockReq({ user: adminA, tenantId: tenantA._id.toString(), params: { id: classroomB1._id.toString() } });
      const res = createMockResponse();

      await getClassroomById(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Không tìm thấy lớp học/i);
    });

    test('1.7 Foreign ID -> 404: Admin A querying Legacy classroom gets 404', async () => {
      const req = createMockReq({ user: adminA, tenantId: tenantA._id.toString(), params: { id: classroomL1._id.toString() } });
      const res = createMockResponse();

      await getClassroomById(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Không tìm thấy lớp học/i);
    });

    test('1.8 Foreign ID -> 404: Legacy Admin querying SaaS classroom gets 404', async () => {
      const req = createMockReq({ user: adminL, isLegacy: true, params: { id: classroomA1._id.toString() } });
      const res = createMockResponse();

      await getClassroomById(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Không tìm thấy lớp học/i);
    });

    test('1.9 Teacher A querying unassigned classroom in same tenant gets 403', async () => {
      const req = createMockReq({ user: teacherA, tenantId: tenantA._id.toString(), params: { id: classroomA2._id.toString() } });
      const res = createMockResponse();

      await getClassroomById(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Bạn không có quyền xem lớp học này/i);
    });

    test('1.10 Teacher A querying foreign classroom gets 404 (filter at DB query BEFORE role check)', async () => {
      const req = createMockReq({ user: teacherA, tenantId: tenantA._id.toString(), params: { id: classroomB1._id.toString() } });
      const res = createMockResponse();

      await getClassroomById(req, res);

      // Must be 404 (invisible), NOT 403
      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Không tìm thấy lớp học/i);
    });

    test('1.11 Anti-tamper: Client query cannot override tenant in getAllClassrooms', async () => {
      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id.toString(),
        query: { tenantId: tenantB._id.toString() }
      });
      const res = createMockResponse();

      await getAllClassrooms(req, res);

      expect(res.statusCode).toBe(200);
      const ids = res.body.data.map((c) => c._id.toString());
      expect(ids).toContain(classroomA1._id.toString());
      expect(ids).not.toContain(classroomB1._id.toString());
    });
  });

  // =========================================================================
  // Part 2: Student List Scoping, Search, Count, Pagination (getAllStudents)
  // =========================================================================
  describe('Part 2: Student List Scoping, Search, Count & Pagination', () => {
    test('2.1 Admin A only lists students in Tenant A', async () => {
      const req = createMockReq({ user: adminA, tenantId: tenantA._id.toString(), query: { status: 'all' } });
      const res = createMockResponse();

      await getAllStudents(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      const studentCodes = res.body.data.map((s) => s.studentCode);
      expect(studentCodes).toContain('HS-2026-000001');
      expect(studentCodes).toContain('HS-2026-000002');
      expect(studentCodes).not.toContain('HS-2026-000003');
      expect(studentCodes).not.toContain('HS-2026-000004');
      expect(studentCodes).not.toContain('HS-2026-000005');
      expect(studentCodes).not.toContain('HS-2026-000006');
    });

    test('2.2 Legacy Admin only lists students with tenantId null or missing', async () => {
      const req = createMockReq({ user: adminL, isLegacy: true, query: { status: 'all' } });
      const res = createMockResponse();

      await getAllStudents(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      const studentCodes = res.body.data.map((s) => s.studentCode);
      expect(studentCodes).toContain('HS-2026-000005');
      expect(studentCodes).toContain('HS-2026-000006');
      expect(studentCodes).not.toContain('HS-2026-000001');
      expect(studentCodes).not.toContain('HS-2026-000003');
    });

    test('2.3 Search: Searching for "Nguyễn Văn An" from Tenant A returns ONLY Student A1 (count 1, total 1)', async () => {
      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id.toString(),
        query: { search: 'Nguyễn Văn An', status: 'all' }
      });
      const res = createMockResponse();

      await getAllStudents(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].studentCode).toBe('HS-2026-000001');
      expect(res.body.data[0].fullName).toBe('Nguyễn Văn An');
      expect(res.body.pagination.total).toBe(1);
      expect(res.body.pagination.totalPages).toBe(1);
    });

    test('2.4 Search: Searching for "Nguyễn Văn An" from Legacy returns ONLY Student L1', async () => {
      const req = createMockReq({
        user: adminL,
        isLegacy: true,
        query: { search: 'Nguyễn Văn An', status: 'all' }
      });
      const res = createMockResponse();

      await getAllStudents(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].studentCode).toBe('HS-2026-000005');
      expect(res.body.pagination.total).toBe(1);
    });

    test('2.5 Count & Pagination: Pagination operates strictly within caller tenant', async () => {
      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id.toString(),
        query: { page: 1, limit: 1, status: 'all' }
      });
      const res = createMockResponse();

      await getAllStudents(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(1);
      expect(res.body.pagination.total).toBe(2);
      expect(res.body.pagination.totalPages).toBe(2);
    });

    test('2.6 Foreign list filter -> empty total 0: Admin A querying with Tenant B classroomId returns total 0', async () => {
      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id.toString(),
        query: { classroomId: classroomB1._id.toString(), status: 'all' }
      });
      const res = createMockResponse();

      await getAllStudents(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
      expect(res.body.pagination.totalPages).toBe(0);
    });

    test('2.7 Teacher Scoping: Teacher A only sees students in assigned classroom A1', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        query: { status: 'all' }
      });
      const res = createMockResponse();

      await getAllStudents(req, res);

      expect(res.statusCode).toBe(200);
      const studentCodes = res.body.data.map((s) => s.studentCode);
      expect(studentCodes).toEqual(['HS-2026-000001']);
      expect(studentCodes).not.toContain('HS-2026-000002');
      expect(res.body.pagination.total).toBe(1);
    });

    test('2.8 Parent Scoping: Parent A only sees linked child (Student A1)', async () => {
      const req = createMockReq({
        user: parentA,
        tenantId: tenantA._id.toString(),
        query: { status: 'all' }
      });
      const res = createMockResponse();

      await getAllStudents(req, res);

      expect(res.statusCode).toBe(200);
      const studentCodes = res.body.data.map((s) => s.studentCode);
      expect(studentCodes).toEqual(['HS-2026-000001']);
      expect(studentCodes).not.toContain('HS-2026-000002');
      expect(res.body.pagination.total).toBe(1);
    });

    test('2.9 Anti-tamper: Client query tenantId is stripped and cannot cross tenant', async () => {
      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id.toString(),
        query: { tenantId: tenantB._id.toString(), status: 'all' }
      });
      const res = createMockResponse();

      await getAllStudents(req, res);

      expect(res.statusCode).toBe(200);
      const studentCodes = res.body.data.map((s) => s.studentCode);
      expect(studentCodes).toContain('HS-2026-000001');
      expect(studentCodes).not.toContain('HS-2026-000003');
    });
  });

  // =========================================================================
  // Part 3: Student Detail Scoping (getStudentById)
  // =========================================================================
  describe('Part 3: Student Detail Scoping (getStudentById)', () => {
    test('3.1 Admin A queries Student A1 in same tenant -> 200', async () => {
      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id.toString(),
        params: { id: studentA1._id.toString() }
      });
      const res = createMockResponse();

      await getStudentById(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.studentCode).toBe('HS-2026-000001');
    });

    test('3.2 Foreign ID -> 404: Admin A queries Student B1 -> 404', async () => {
      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id.toString(),
        params: { id: studentB1._id.toString() }
      });
      const res = createMockResponse();

      await getStudentById(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy học sinh/i);
    });

    test('3.3 Foreign ID -> 404: Admin A queries Legacy Student L1 -> 404', async () => {
      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id.toString(),
        params: { id: studentL1._id.toString() }
      });
      const res = createMockResponse();

      await getStudentById(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy học sinh/i);
    });

    test('3.4 Foreign ID -> 404: Legacy Admin queries SaaS Student A1 -> 404', async () => {
      const req = createMockReq({
        user: adminL,
        isLegacy: true,
        params: { id: studentA1._id.toString() }
      });
      const res = createMockResponse();

      await getStudentById(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy học sinh/i);
    });

    test('3.5 Teacher A queries assigned Student A1 -> 200', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        params: { id: studentA1._id.toString() }
      });
      const res = createMockResponse();

      await getStudentById(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.studentCode).toBe('HS-2026-000001');
    });

    test('3.6 Teacher A queries unassigned Student A2 in same tenant -> 403', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        params: { id: studentA2._id.toString() }
      });
      const res = createMockResponse();

      await getStudentById(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/Bạn không có quyền xem thông tin học sinh này/i);
    });

    test('3.7 Teacher A queries foreign Student B1 -> 404 (NOT 403)', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        params: { id: studentB1._id.toString() }
      });
      const res = createMockResponse();

      await getStudentById(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy học sinh/i);
    });

    test('3.8 Parent A queries linked Student A1 -> 200', async () => {
      const req = createMockReq({
        user: parentA,
        tenantId: tenantA._id.toString(),
        params: { id: studentA1._id.toString() }
      });
      const res = createMockResponse();

      await getStudentById(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.studentCode).toBe('HS-2026-000001');
    });

    test('3.9 Parent A queries unlinked Student A2 in same tenant -> 403', async () => {
      const req = createMockReq({
        user: parentA,
        tenantId: tenantA._id.toString(),
        params: { id: studentA2._id.toString() }
      });
      const res = createMockResponse();

      await getStudentById(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/Bạn không có quyền xem thông tin học sinh này/i);
    });

    test('3.10 Parent A queries foreign Student B1 -> 404 (NOT 403)', async () => {
      const req = createMockReq({
        user: parentA,
        tenantId: tenantA._id.toString(),
        params: { id: studentB1._id.toString() }
      });
      const res = createMockResponse();

      await getStudentById(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy học sinh/i);
    });
  });

  // =========================================================================
  // Part 4: Care Books / Daily Reports (getDailyReports)
  // =========================================================================
  describe('Part 4: Care Books / Daily Reports Scoping', () => {
    test('4.1 Parent A queries linked Student A1 care book -> 200 with daily reports', async () => {
      const req = createMockReq({
        user: parentA,
        tenantId: tenantA._id.toString(),
        params: { id: studentA1._id.toString() }
      });
      const res = createMockResponse();

      await getDailyReports(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].activities).toMatch(/Học vẽ tranh màu nước tại trường A/i);
    });

    test('4.2 Teacher A queries assigned Student A1 care book -> 200', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        params: { id: studentA1._id.toString() }
      });
      const res = createMockResponse();

      await getDailyReports(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    test('4.3 Admin A queries Student A1 care book -> 200', async () => {
      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id.toString(),
        params: { id: studentA1._id.toString() }
      });
      const res = createMockResponse();

      await getDailyReports(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    test('4.4 Teacher A queries unassigned Student A2 care book in same tenant -> 403', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        params: { id: studentA2._id.toString() }
      });
      const res = createMockResponse();

      await getDailyReports(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/Bạn không có quyền xem sổ chăm sóc của học sinh này/i);
    });

    test('4.5 Parent A queries unlinked Student A2 care book in same tenant -> 403', async () => {
      const req = createMockReq({
        user: parentA,
        tenantId: tenantA._id.toString(),
        params: { id: studentA2._id.toString() }
      });
      const res = createMockResponse();

      await getDailyReports(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/Bạn không có quyền xem sổ chăm sóc của học sinh này/i);
    });

    test('4.6 Foreign ID -> 404: Any caller querying foreign Student B1 care book gets 404', async () => {
      // Admin A
      const reqAdmin = createMockReq({ user: adminA, tenantId: tenantA._id.toString(), params: { id: studentB1._id.toString() } });
      const resAdmin = createMockResponse();
      await getDailyReports(reqAdmin, resAdmin);
      expect(resAdmin.statusCode).toBe(404);

      // Teacher A
      const reqTeacher = createMockReq({ user: teacherA, tenantId: tenantA._id.toString(), params: { id: studentB1._id.toString() } });
      const resTeacher = createMockResponse();
      await getDailyReports(reqTeacher, resTeacher);
      expect(resTeacher.statusCode).toBe(404);

      // Parent A
      const reqParent = createMockReq({ user: parentA, tenantId: tenantA._id.toString(), params: { id: studentB1._id.toString() } });
      const resParent = createMockResponse();
      await getDailyReports(reqParent, resParent);
      expect(resParent.statusCode).toBe(404);
    });
  });

  // =========================================================================
  // Part 5: Transfer History Scoping (getStudentTransferHistory)
  // =========================================================================
  describe('Part 5: Transfer History Scoping', () => {
    test('5.1 Admin A queries Student A1 transfer history -> 200 with history', async () => {
      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id.toString(),
        params: { id: studentA1._id.toString() }
      });
      const res = createMockResponse();

      await getStudentTransferHistory(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].reason).toBe('Chuyển sang lớp phù hợp lứa tuổi tại trường A');
    });

    test('5.2 Parent A queries linked Student A1 transfer history -> 200 with sanitized fields', async () => {
      const req = createMockReq({
        user: parentA,
        tenantId: tenantA._id.toString(),
        params: { id: studentA1._id.toString() }
      });
      const res = createMockResponse();

      await getStudentTransferHistory(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
      const item = res.body.data[0];
      expect(item.studentName).toBe('Nguyễn Văn An');
      expect(item.fromClassName).toBe(classroomA2.name);
      expect(item.toClassName).toBe(classroomA1.name);
      // Sanitized: internal transferredBy should NOT be present for parent
      expect(item.transferredBy).toBeUndefined();
    });

    test('5.3 Teacher A queries Student A1 transfer history (classroomA1 is target) -> 200', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        params: { id: studentA1._id.toString() }
      });
      const res = createMockResponse();

      await getStudentTransferHistory(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    test('5.4 Teacher A queries Student A2 transfer history (no past or current class) -> 403', async () => {
      const req = createMockReq({
        user: teacherA,
        tenantId: tenantA._id.toString(),
        params: { id: studentA2._id.toString() }
      });
      const res = createMockResponse();

      await getStudentTransferHistory(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/Bạn không có quyền xem lịch sử chuyển lớp/i);
    });

    test('5.5 Foreign ID -> 404: Admin A querying foreign Student B1 transfer history gets 404', async () => {
      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id.toString(),
        params: { id: studentB1._id.toString() }
      });
      const res = createMockResponse();

      await getStudentTransferHistory(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy học sinh/i);
    });

    test('5.6 Foreign ID -> 404: Parent A querying foreign Student B1 transfer history gets 404', async () => {
      const req = createMockReq({
        user: parentA,
        tenantId: tenantA._id.toString(),
        params: { id: studentB1._id.toString() }
      });
      const res = createMockResponse();

      await getStudentTransferHistory(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Không tìm thấy học sinh/i);
    });

    test('5.7 No cross-tenant history entries leaked when querying transfer history', async () => {
      // Query history for Tenant B
      const reqB = createMockReq({
        user: adminB,
        tenantId: tenantB._id.toString(),
        params: { id: studentB1._id.toString() }
      });
      const resB = createMockResponse();
      await getStudentTransferHistory(reqB, resB);

      expect(resB.statusCode).toBe(200);
      expect(resB.body.data).toHaveLength(1);
      expect(resB.body.data[0].reason).toBe('Chuyển phân lớp tại trường B');
      expect(resB.body.data[0].tenantId.toString()).toBe(tenantB._id.toString());
    });
  });

  // =========================================================================
  // Part 6: Missing Context, Mismatch, Anti-Spoofing & Zero Side Effects
  // =========================================================================
  describe('Part 6: Missing Context, Mismatch & Zero Side Effects', () => {
    test('6.1 Missing context req fails closed: getAllStudents returns empty list or 403', async () => {
      const req = createMockReq({ user: null, query: { status: 'all' } });
      const res = createMockResponse();

      await getAllStudents(req, res);

      expect(res.statusCode).toBe(403);
    });

    test('6.2 Tenant mismatch fails closed: User A with tenantId B returns empty list', async () => {
      const req = createMockReq({
        user: adminA, // User tenantId is Tenant A
        tenantId: tenantB._id.toString(), // req.tenantId is Tenant B
        query: { status: 'all' }
      });
      const res = createMockResponse();

      await getAllStudents(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
    });

    test('6.3 SaaS User A without req.tenantId (unverified state) fails closed', async () => {
      const req = createMockReq({
        user: adminA,
        tenantId: undefined, // missing req.tenantId
        query: { status: 'all' }
      });
      const res = createMockResponse();

      await getAllStudents(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
    });

    test('6.4 Client headers spoofing (X-Tenant-Id) cannot override tenant boundary', async () => {
      const req = createMockReq({
        user: adminA,
        tenantId: tenantA._id.toString(),
        headers: { 'x-tenant-id': tenantB._id.toString() },
        query: { status: 'all' }
      });
      const res = createMockResponse();

      await getAllStudents(req, res);

      expect(res.statusCode).toBe(200);
      const studentCodes = res.body.data.map((s) => s.studentCode);
      expect(studentCodes).toContain('HS-2026-000001');
      expect(studentCodes).not.toContain('HS-2026-000003');
    });

    test('6.5 Zero Side Effects: GET read operations performed zero DB mutations', async () => {
      const studentCountBefore = await Student.countDocuments({});
      const classroomCountBefore = await Classroom.countDocuments({});
      const historyCountBefore = await StudentTransferHistory.countDocuments({});

      // Run multiple GET operations
      const reqAdmin = createMockReq({ user: adminA, tenantId: tenantA._id.toString(), params: { id: studentA1._id.toString() } });
      const res1 = createMockResponse();
      await getStudentById(reqAdmin, res1);

      const res2 = createMockResponse();
      await getDailyReports(reqAdmin, res2);

      const res3 = createMockResponse();
      await getStudentTransferHistory(reqAdmin, res3);

      const res4 = createMockResponse();
      await getAllStudents(reqAdmin, res4);

      const res5 = createMockResponse();
      await getAllClassrooms(reqAdmin, res5);

      const studentCountAfter = await Student.countDocuments({});
      const classroomCountAfter = await Classroom.countDocuments({});
      const historyCountAfter = await StudentTransferHistory.countDocuments({});

      expect(studentCountAfter).toBe(studentCountBefore);
      expect(classroomCountAfter).toBe(classroomCountBefore);
      expect(historyCountAfter).toBe(historyCountBefore);
    });
  });
});
