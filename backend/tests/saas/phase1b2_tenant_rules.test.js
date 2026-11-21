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
const StudentLeaveRequest = require('../../src/models/zone3_school/StudentLeaveRequest');
const StudentProfileChangeRequest = require('../../src/models/zone3_school/StudentProfileChangeRequest');
const ParentFeedback = require('../../src/models/zone3_school/ParentFeedback');

const { createLeaveRequest } = require('../../src/controllers/attendanceController');
const { createRequest: createProfileChangeRequest } = require('../../src/controllers/studentProfileChangeRequestController');
const { createFeedback } = require('../../src/controllers/parentFeedbackController');

const { getWorkDate, DEFAULT_SCHOOL_TIMEZONE } = require('../../src/utils/dateHelpers');

const {
  FAIL_CLOSED_FILTER,
  IS_TRUSTED_CONTEXT,
  InvalidTenantContextError,
  applyTenantFilter,
  assertTenantContext,
  buildTenantFilter,
  createTrustedTenantContext,
  resolveTenantContext,
  resolveUserAndTenantContext
} = require('../../src/services/tenantFilterService');

const {
  applyStudentListScope,
  canAccessStudent,
  canAccessStudentAsync,
  getLinkedStudentIds
} = require('../../src/services/studentAccessService');

const {
  applyClassroomListScope,
  canAccessClassroom,
  getTeacherClassroomIds,
  hasSchoolWideReadAccess
} = require('../../src/services/schoolDataAccessService');

describe('Task 1B.2 - Shared Tenant Filter Rules & Scope Isolation', () => {
  let bootstrapInstance;
  let tenantA;
  let tenantB;

  let classroomA1;
  let classroomA2;
  let classroomB1;
  let classroomL1;
  let classroomL2;

  let adminA;
  let teacherA;
  let parentA;

  let adminB;
  let teacherB;
  let parentB;

  let adminL;
  let teacherL;
  let parentL;

  let studentA1;
  let studentA2;
  let studentB1;
  let studentL1;
  let studentL2;

  beforeAll(async () => {
    bootstrapInstance = await testDbBootstrap.startTestDb({
      instanceOpts: [{ dbName: 'school_saas_1b2_test_isolated' }]
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

  beforeEach(async () => {
    await Promise.all([
      Tenant.deleteMany({}),
      User.deleteMany({}),
      Classroom.deleteMany({}),
      Student.deleteMany({}),
      StudentTransferHistory.deleteMany({}),
      StudentLeaveRequest.deleteMany({}),
      StudentProfileChangeRequest.deleteMany({}),
      ParentFeedback.deleteMany({})
    ]);

    // Create 2 SaaS tenants
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

    // Users - Tenant A
    adminA = await User.create({
      tenantId: tenantA._id,
      username: 'admin-tenant-a',
      passwordHash: 'not-used',
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Admin Trường A' }
    });

    teacherA = await User.create({
      tenantId: tenantA._id,
      username: 'teacher-tenant-a',
      passwordHash: 'not-used',
      role: 'teacher',
      status: 'active',
      profile: { fullName: 'Giáo viên Trường A' }
    });

    parentA = await User.create({
      tenantId: tenantA._id,
      username: 'parent-tenant-a',
      passwordHash: 'not-used',
      role: 'parent',
      status: 'active',
      profile: { fullName: 'Phụ huynh Trường A' }
    });

    // Users - Tenant B
    adminB = await User.create({
      tenantId: tenantB._id,
      username: 'admin-tenant-b',
      passwordHash: 'not-used',
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Admin Trường B' }
    });

    teacherB = await User.create({
      tenantId: tenantB._id,
      username: 'teacher-tenant-b',
      passwordHash: 'not-used',
      role: 'teacher',
      status: 'active',
      profile: { fullName: 'Giáo viên Trường B' }
    });

    parentB = await User.create({
      tenantId: tenantB._id,
      username: 'parent-tenant-b',
      passwordHash: 'not-used',
      role: 'parent',
      status: 'active',
      profile: { fullName: 'Phụ huynh Trường B' }
    });

    // Users - Legacy (tenantId is null / undefined)
    adminL = await User.create({
      tenantId: null,
      username: 'admin-legacy',
      passwordHash: 'not-used',
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Admin Legacy' }
    });

    teacherL = await User.create({
      tenantId: null,
      username: 'teacher-legacy',
      passwordHash: 'not-used',
      role: 'teacher',
      status: 'active',
      profile: { fullName: 'Giáo viên Legacy' }
    });

    parentL = await User.create({
      tenantId: null,
      username: 'parent-legacy',
      passwordHash: 'not-used',
      role: 'parent',
      status: 'active',
      profile: { fullName: 'Phụ huynh Legacy' }
    });

    // Classrooms - Tenant A
    classroomA1 = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Mầm 1 A',
      ageGroup: '3-4',
      schoolYear: '2025-2026',
      status: 'active',
      homeroomTeacherId: teacherA._id,
      teachers: [{ teacherId: teacherA._id, teacherName: 'Giáo viên Trường A', role: 'homeroom' }]
    });

    classroomA2 = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Chồi 1 A',
      ageGroup: '4-5',
      schoolYear: '2025-2026',
      status: 'active'
    });

    // Classroom - Tenant B
    classroomB1 = await Classroom.create({
      tenantId: tenantB._id,
      name: 'Lớp Mầm 1 B',
      ageGroup: '3-4',
      schoolYear: '2025-2026',
      status: 'active',
      homeroomTeacherId: teacherB._id,
      teachers: [{ teacherId: teacherB._id, teacherName: 'Giáo viên Trường B', role: 'homeroom' }]
    });

    // Classrooms - Legacy (one with null, one missing tenantId)
    classroomL1 = await Classroom.create({
      tenantId: null,
      name: 'Lớp Legacy 1',
      ageGroup: '3-4',
      schoolYear: '2025-2026',
      status: 'active',
      homeroomTeacherId: teacherL._id,
      teachers: [{ teacherId: teacherL._id, teacherName: 'Giáo viên Legacy', role: 'homeroom' }]
    });

    classroomL2 = await Classroom.create({
      name: 'Lớp Legacy 2 (Missing)',
      ageGroup: '4-5',
      schoolYear: '2025-2026',
      status: 'active'
    });

    // Students - Tenant A
    studentA1 = await Student.create({
      tenantId: tenantA._id,
      studentCode: 'HS-2026-100001',
      fullName: 'Học Sinh A1',
      birthDate: new Date('2021-01-01'),
      gender: 'male',
      classroomId: classroomA1._id,
      className: classroomA1.name,
      schoolYear: '2025-2026',
      status: 'enrolled'
    });

    studentA2 = await Student.create({
      tenantId: tenantA._id,
      studentCode: 'HS-2026-100002',
      fullName: 'Học Sinh A2',
      birthDate: new Date('2021-02-01'),
      gender: 'female',
      classroomId: classroomA2._id,
      className: classroomA2.name,
      schoolYear: '2025-2026',
      status: 'enrolled'
    });

    // Student - Tenant B
    studentB1 = await Student.create({
      tenantId: tenantB._id,
      studentCode: 'HS-2026-200001',
      fullName: 'Học Sinh B1',
      birthDate: new Date('2021-03-01'),
      gender: 'male',
      classroomId: classroomB1._id,
      className: classroomB1.name,
      schoolYear: '2025-2026',
      status: 'enrolled'
    });

    // Students - Legacy
    studentL1 = await Student.create({
      tenantId: null,
      studentCode: 'HS-2026-300001',
      fullName: 'Học Sinh Legacy 1',
      birthDate: new Date('2021-04-01'),
      gender: 'female',
      classroomId: classroomL1._id,
      className: classroomL1.name,
      schoolYear: '2025-2026',
      status: 'enrolled'
    });

    studentL2 = await Student.create({
      studentCode: 'HS-2026-300002',
      fullName: 'Học Sinh Legacy 2 (Missing)',
      birthDate: new Date('2021-05-01'),
      gender: 'male',
      classroomId: classroomL2._id,
      className: classroomL2.name,
      schoolYear: '2025-2026',
      status: 'enrolled'
    });

    // Link parents to their respective students
    parentA.parentInfo = { studentIds: [studentA1._id] };
    await parentA.save();

    parentB.parentInfo = { studentIds: [studentB1._id] };
    await parentB.save();

    parentL.parentInfo = { studentIds: [studentL1._id] };
    await parentL.save();
  });

  describe('Part 1: Unit Rules for tenantFilterService', () => {
    test('1.1 SaaS context resolution trusts only verified req.tenantId and ignores raw headers/query/body', () => {
      // Valid req with req.tenantId from middleware
      const validReq = {
        tenantId: tenantA._id.toString(),
        user: { _id: adminA._id, role: 'admin', tenantId: tenantA._id },
        headers: { 'x-tenant-id': tenantB._id.toString() }, // Spoofed header
        query: { tenantId: tenantB._id.toString() },         // Spoofed query
        body: { tenantId: tenantB._id.toString() }           // Spoofed body
      };

      const resolved = resolveTenantContext(validReq);
      expect(resolved.isSaaS).toBe(true);
      expect(resolved.isLegacy).toBe(false);
      expect(resolved.isValid).toBe(true);
      expect(resolved.tenantId.toString()).toBe(tenantA._id.toString()); // Ignored tenantB

      const filter = buildTenantFilter(validReq);
      expect(filter).toEqual({ tenantId: tenantA._id });
    });

    test('1.2 Legacy context resolution matches only tenantId: null or missing', () => {
      // Legacy req: req.user has no tenantId and req.tenantId is undefined
      const legacyReq = {
        user: { _id: adminL._id, role: 'admin', tenantId: null }
      };

      const resolved = resolveTenantContext(legacyReq);
      expect(resolved.isSaaS).toBe(false);
      expect(resolved.isLegacy).toBe(true);
      expect(resolved.isValid).toBe(true);
      expect(resolved.tenantId).toBeNull();

      const filter = buildTenantFilter(legacyReq);
      expect(filter).toEqual({ tenantId: null });

      // Explicit legacy context flag via trusted context
      const explicitLegacy = resolveTenantContext(createTrustedTenantContext({ isLegacy: true }));
      expect(explicitLegacy.isLegacy).toBe(true);
      expect(explicitLegacy.tenantId).toBeNull();

      const explicitFilter = buildTenantFilter(createTrustedTenantContext({ isLegacy: true }));
      expect(explicitFilter).toEqual({ tenantId: null });
    });

    test('1.3 Missing or invalid trusted context fails closed', () => {
      // Missing context (null, undefined, empty object)
      expect(resolveTenantContext(null).isValid).toBe(false);
      expect(resolveTenantContext(undefined).isValid).toBe(false);
      expect(resolveTenantContext({}).isValid).toBe(false);

      // assertTenantContext throws on missing/invalid
      expect(() => assertTenantContext(null)).toThrow(InvalidTenantContextError);
      expect(() => assertTenantContext({})).toThrow(InvalidTenantContextError);
      expect(() => assertTenantContext({ tenantId: 'not-an-object-id' })).toThrow(InvalidTenantContextError);

      // buildTenantFilter with throwOnInvalid
      expect(() => buildTenantFilter(null, { throwOnInvalid: true })).toThrow(InvalidTenantContextError);
      expect(() => buildTenantFilter({ tenantId: 'invalid' }, { throwOnInvalid: true })).toThrow(InvalidTenantContextError);

      // buildTenantFilter default returns FAIL_CLOSED_FILTER
      const failClosed = buildTenantFilter(null);
      expect(failClosed).toEqual(FAIL_CLOSED_FILTER);

      // Spoofed request: only has headers['x-tenant-id'] without verified req.tenantId or user
      const spoofedReq = {
        headers: { 'x-tenant-id': tenantA._id.toString() }
      };
      const spoofedResolved = resolveTenantContext(spoofedReq);
      expect(spoofedResolved.isValid).toBe(false);
      expect(buildTenantFilter(spoofedReq)).toEqual(FAIL_CLOSED_FILTER);
    });

    test('1.4 Anti-tamper: user filter cannot override trusted tenant boundary', () => {
      const saasContext = createTrustedTenantContext({ tenantId: tenantA._id });

      // Attempt 1: Caller injects foreign tenantId in top-level filter
      const tamperedFilter1 = {
        status: 'active',
        tenantId: tenantB._id
      };
      const applied1 = applyTenantFilter(tamperedFilter1, saasContext);
      expect(applied1.tenantId.toString()).toBe(tenantA._id.toString());
      expect(applied1.status).toBe('active');

      // Attempt 2: Caller injects tenantId: null to attempt escape into legacy data
      const tamperedFilter2 = {
        tenantId: null
      };
      const applied2 = applyTenantFilter(tamperedFilter2, saasContext);
      expect(applied2.tenantId.toString()).toBe(tenantA._id.toString());

      // Attempt 3: Caller tries $and injection with conflicting tenantId
      const tamperedFilter3 = {
        $and: [
          { tenantId: tenantB._id },
          { name: 'Lớp Test' }
        ]
      };
      const applied3 = applyTenantFilter(tamperedFilter3, saasContext);
      expect(applied3.tenantId.toString()).toBe(tenantA._id.toString());
      // Inner $and tenantId condition was cleanly stripped
      expect(applied3.$and).toEqual([{ name: 'Lớp Test' }]);
    });
  });

  describe('Part 2: Integration - Student Scope & ID Invisibility on MongoMemoryReplSet', () => {
    test('2.1 Student list & count strictly isolated per tenant (Tenant A, B, Legacy)', async () => {
      // Admin A queries students
      const filterA = applyStudentListScope(adminA, {});
      const [studentsA, countA] = await Promise.all([
        Student.find(filterA),
        Student.countDocuments(filterA)
      ]);
      expect(countA).toBe(2);
      expect(studentsA.map((s) => s.studentCode).sort()).toEqual(['HS-2026-100001', 'HS-2026-100002']);

      // Admin B queries students
      const filterB = applyStudentListScope(adminB, {});
      const [studentsB, countB] = await Promise.all([
        Student.find(filterB),
        Student.countDocuments(filterB)
      ]);
      expect(countB).toBe(1);
      expect(studentsB[0].studentCode).toBe('HS-2026-200001');

      // Legacy Admin queries students (matches both null and missing tenantId)
      const filterL = applyStudentListScope(adminL, {});
      const [studentsL, countL] = await Promise.all([
        Student.find(filterL),
        Student.countDocuments(filterL)
      ]);
      expect(countL).toBe(2);
      expect(studentsL.map((s) => s.studentCode).sort()).toEqual(['HS-2026-300001', 'HS-2026-300002']);
    });

    test('2.2 Foreign tenant student IDs are invisible (404 / null) under scoped query', async () => {
      const saasContextA = createTrustedTenantContext({ tenantId: tenantA._id });
      const tenantFilterA = buildTenantFilter(saasContextA);

      // Student B1 exists, but when queried with Tenant A filter, returns null
      const foreignLookupB = await Student.findOne({ _id: studentB1._id, ...tenantFilterA });
      expect(foreignLookupB).toBeNull();

      // Student L1 (legacy) exists, but when queried with Tenant A filter, returns null
      const foreignLookupL = await Student.findOne({ _id: studentL1._id, ...tenantFilterA });
      expect(foreignLookupL).toBeNull();

      // Legacy context cannot see Tenant A or Tenant B students
      const legacyFilter = buildTenantFilter(createTrustedTenantContext({ isLegacy: true }));
      const saasLookupFromLegacy = await Student.findOne({ _id: studentA1._id, ...legacyFilter });
      expect(saasLookupFromLegacy).toBeNull();
    });

    test('2.3 Parent access scope strictly enforced within tenant; cross-tenant link is blocked', async () => {
      // Normal Parent A query: returns only their linked student (studentA1)
      const parentAFilter = applyStudentListScope(parentA, {});
      const parentAStudents = await Student.find(parentAFilter);
      expect(parentAStudents).toHaveLength(1);
      expect(parentAStudents[0]._id.toString()).toBe(studentA1._id.toString());

      // Malicious case: Parent A user record is tampered to contain Student B1 ID in parentInfo.studentIds
      const tamperedParentA = {
        _id: parentA._id,
        role: 'parent',
        tenantId: tenantA._id,
        parentInfo: {
          studentIds: [studentA1._id, studentB1._id] // Contains cross-tenant ID
        }
      };

      const tamperedFilter = applyStudentListScope(tamperedParentA, {});
      const tamperedResults = await Student.find(tamperedFilter);
      // Strictly returns ONLY studentA1. studentB1 is filtered out by tenantId: tenantA._id!
      expect(tamperedResults).toHaveLength(1);
      expect(tamperedResults[0]._id.toString()).toBe(studentA1._id.toString());
    });

    test('2.4 canAccessStudent (synchronous) enforces tenant boundary on student document', () => {
      // Parent A
      expect(canAccessStudent(parentA, studentA1)).toBe(true);
      expect(canAccessStudent(parentA, studentA2)).toBe(false); // Unlinked student in same tenant
      expect(canAccessStudent(parentA, studentB1)).toBe(false); // Student in Tenant B
      expect(canAccessStudent(parentA, studentL1)).toBe(false); // Student in Legacy

      // Admin A with Student documents
      expect(canAccessStudent(adminA, studentA1)).toBe(true);
      expect(canAccessStudent(adminA, studentA2)).toBe(true);
      expect(canAccessStudent(adminA, studentB1)).toBe(false); // Admin A cannot access Tenant B student document
      expect(canAccessStudent(adminA, studentL1)).toBe(false); // Admin A cannot access Legacy student document

      // Legacy Parent L
      expect(canAccessStudent(parentL, studentL1)).toBe(true);
      expect(canAccessStudent(parentL, studentA1)).toBe(false);

      // Legacy Admin with Student documents
      expect(canAccessStudent(adminL, studentL1)).toBe(true);
      expect(canAccessStudent(adminL, studentL2)).toBe(true);
      expect(canAccessStudent(adminL, studentA1)).toBe(false); // Legacy admin cannot access Tenant A student document
    });

    test('2.5 canAccessStudentAsync enforces DB-backed tenant boundary for student IDs', async () => {
      // Admin A
      expect(await canAccessStudentAsync(adminA, studentA1._id)).toBe(true);
      expect(await canAccessStudentAsync(adminA, studentB1._id)).toBe(false); // Foreign ID returns false
      expect(await canAccessStudentAsync(adminA, studentL1._id)).toBe(false); // Foreign ID returns false
      expect(await canAccessStudentAsync(adminA, new mongoose.Types.ObjectId())).toBe(false); // Non-existent ID

      // Parent A
      expect(await canAccessStudentAsync(parentA, studentA1._id)).toBe(true);
      expect(await canAccessStudentAsync(parentA, studentA2._id)).toBe(false);
      expect(await canAccessStudentAsync(parentA, studentB1._id)).toBe(false);

      // Teacher A (assigned to classroomA1 where studentA1 is enrolled, but not classroomA2 where studentA2 is enrolled)
      expect(await canAccessStudentAsync(teacherA, studentA1._id)).toBe(true);
      expect(await canAccessStudentAsync(teacherA, studentA2._id)).toBe(false);
      expect(await canAccessStudentAsync(teacherA, studentB1._id)).toBe(false);

      // Missing context returns false (fail-closed)
      expect(await canAccessStudentAsync(null, studentA1._id)).toBe(false);
    });

    test('2.6 Query with missing or invalid context produces empty list and count = 0', async () => {
      const failClosedFilter = applyTenantFilter({}, null);
      const [list, count] = await Promise.all([
        Student.find(failClosedFilter),
        Student.countDocuments(failClosedFilter)
      ]);
      expect(list).toEqual([]);
      expect(count).toBe(0);
    });
  });

  describe('Part 3: Integration - Classroom Scope & Teacher Permissions on MongoMemoryReplSet', () => {
    test('3.1 canAccessClassroom enforces tenant boundary for Admin / Principal (role cannot cross tenant)', async () => {
      // Admin A (SaaS Tenant A)
      expect(await canAccessClassroom(adminA, classroomA1._id)).toBe(true);
      expect(await canAccessClassroom(adminA, classroomA2._id)).toBe(true);
      // Admin A MUST NOT have access to Tenant B or Legacy classrooms
      expect(await canAccessClassroom(adminA, classroomB1._id)).toBe(false);
      expect(await canAccessClassroom(adminA, classroomL1._id)).toBe(false);
      expect(await canAccessClassroom(adminA, classroomL2._id)).toBe(false);

      // Admin B (SaaS Tenant B)
      expect(await canAccessClassroom(adminB, classroomB1._id)).toBe(true);
      expect(await canAccessClassroom(adminB, classroomA1._id)).toBe(false);
      expect(await canAccessClassroom(adminB, classroomL1._id)).toBe(false);

      // Legacy Admin L
      expect(await canAccessClassroom(adminL, classroomL1._id)).toBe(true);
      expect(await canAccessClassroom(adminL, classroomL2._id)).toBe(true);
      expect(await canAccessClassroom(adminL, classroomA1._id)).toBe(false);
      expect(await canAccessClassroom(adminL, classroomB1._id)).toBe(false);

      // Non-existent classroom
      expect(await canAccessClassroom(adminA, new mongoose.Types.ObjectId())).toBe(false);

      // Missing / invalid user
      expect(await canAccessClassroom(null, classroomA1._id)).toBe(false);
    });

    test('3.2 canAccessClassroom & getTeacherClassroomIds enforce teacher boundary', async () => {
      // Teacher A is assigned to classroomA1, NOT classroomA2, NOT classroomB1
      expect(await canAccessClassroom(teacherA, classroomA1._id)).toBe(true);
      expect(await canAccessClassroom(teacherA, classroomA2._id)).toBe(false);
      expect(await canAccessClassroom(teacherA, classroomB1._id)).toBe(false);
      expect(await canAccessClassroom(teacherA, classroomL1._id)).toBe(false);

      // Teacher A classroom IDs: only [classroomA1._id]
      const teacherAIds = await getTeacherClassroomIds(teacherA);
      expect(teacherAIds).toEqual([classroomA1._id.toString()]);

      // Teacher B is assigned to classroomB1
      expect(await canAccessClassroom(teacherB, classroomB1._id)).toBe(true);
      expect(await canAccessClassroom(teacherB, classroomA1._id)).toBe(false);

      // Legacy Teacher L
      expect(await canAccessClassroom(teacherL, classroomL1._id)).toBe(true);
      expect(await canAccessClassroom(teacherL, classroomA1._id)).toBe(false);

      // Anomaly test: If Teacher A is added into teachers list of Classroom B1 (data anomaly)
      await Classroom.updateOne(
        { _id: classroomB1._id },
        { $push: { teachers: { teacherId: teacherA._id, teacherName: 'Giáo viên A', role: 'subject' } } }
      );
      // getTeacherClassroomIds with Tenant A context must STILL exclude classroomB1
      const teacherAIdsAfterAnomaly = await getTeacherClassroomIds(teacherA, createTrustedTenantContext({ tenantId: tenantA._id }));
      expect(teacherAIdsAfterAnomaly).toEqual([classroomA1._id.toString()]);
      expect(teacherAIdsAfterAnomaly).not.toContain(classroomB1._id.toString());
    });

    test('3.3 applyClassroomListScope isolates classroom listing by tenant & role', async () => {
      // Admin A sees all classrooms in Tenant A (2 classrooms), zero B, zero legacy
      const adminAClassFilter = await applyClassroomListScope(adminA, {});
      const adminAClasses = await Classroom.find(adminAClassFilter);
      expect(adminAClasses).toHaveLength(2);
      expect(adminAClasses.map((c) => c.name).sort()).toEqual(['Lớp Chồi 1 A', 'Lớp Mầm 1 A']);

      // Admin B sees only Classroom B1 (1 classroom)
      const adminBClassFilter = await applyClassroomListScope(adminB, {});
      const adminBClasses = await Classroom.find(adminBClassFilter);
      expect(adminBClasses).toHaveLength(1);
      expect(adminBClasses[0].name).toBe('Lớp Mầm 1 B');

      // Legacy Admin sees only Legacy classrooms (2 classrooms)
      const legacyClassFilter = await applyClassroomListScope(adminL, {});
      const legacyClasses = await Classroom.find(legacyClassFilter);
      expect(legacyClasses).toHaveLength(2);
      expect(legacyClasses.map((c) => c.name).sort()).toEqual(['Lớp Legacy 1', 'Lớp Legacy 2 (Missing)']);

      // Teacher A sees only their assigned classroom in Tenant A (1 classroom)
      const teacherAClassFilter = await applyClassroomListScope(teacherA, {});
      const teacherAClasses = await Classroom.find(teacherAClassFilter);
      expect(teacherAClasses).toHaveLength(1);
      expect(teacherAClasses[0].name).toBe('Lớp Mầm 1 A');

      // Client filter override attempt: Admin A attempts { tenantId: tenantB._id }
      const overrideFilter = await applyClassroomListScope(adminA, { tenantId: tenantB._id });
      const overrideClasses = await Classroom.find(overrideFilter);
      expect(overrideClasses).toHaveLength(2); // Still Tenant A!
      expect(overrideClasses.every((c) => c.tenantId.toString() === tenantA._id.toString())).toBe(true);
    });

    test('3.4 Foreign classroom lookup by ID returns null (invisible / 404 contract)', async () => {
      const saasContextA = createTrustedTenantContext({ tenantId: tenantA._id });
      const tenantFilterA = buildTenantFilter(saasContextA);

      // Lookup Classroom B1 with Tenant A filter -> null
      const lookupB = await Classroom.findOne({ _id: classroomB1._id, ...tenantFilterA });
      expect(lookupB).toBeNull();

      // Lookup Classroom L1 (legacy) with Tenant A filter -> null
      const lookupL = await Classroom.findOne({ _id: classroomL1._id, ...tenantFilterA });
      expect(lookupL).toBeNull();
    });
  });

  describe('Part 4: SEC-1B2-01 - User & Context Tenant Alignment (Fail-Closed)', () => {
    test('4.1 Admin A with Context B cannot access Classroom B or Student B', async () => {
      const contextB = createTrustedTenantContext({ tenantId: tenantB._id });

      // Admin A trying to access Classroom B with Context B -> MUST return false
      expect(await canAccessClassroom(adminA, classroomB1._id, contextB)).toBe(false);

      // Admin A trying to access Student B with Context B -> MUST return false
      expect(canAccessStudent(adminA, studentB1, contextB)).toBe(false);
      expect(await canAccessStudentAsync(adminA, studentB1._id, contextB)).toBe(false);

      // Scoped filters with mismatched user A and context B -> fail closed
      const scopedClasses = await applyClassroomListScope(adminA, {}, contextB);
      expect(scopedClasses).toEqual(FAIL_CLOSED_FILTER);

      const scopedStudents = applyStudentListScope(adminA, {}, contextB);
      expect(scopedStudents).toEqual(FAIL_CLOSED_FILTER);
    });

    test('4.2 Teacher A with Context B cannot access Classroom B or Student B', async () => {
      const contextB = createTrustedTenantContext({ tenantId: tenantB._id });

      expect(await canAccessClassroom(teacherA, classroomB1._id, contextB)).toBe(false);
      expect(canAccessStudent(teacherA, studentB1, contextB)).toBe(false);
      expect(await canAccessStudentAsync(teacherA, studentB1._id, contextB)).toBe(false);

      const teacherBIds = await getTeacherClassroomIds(teacherA, contextB);
      expect(teacherBIds).toEqual([]);
    });

    test('4.3 Parent A with Context B cannot access Student B', async () => {
      const contextB = createTrustedTenantContext({ tenantId: tenantB._id });

      expect(canAccessStudent(parentA, studentB1, contextB)).toBe(false);
      expect(await canAccessStudentAsync(parentA, studentB1._id, contextB)).toBe(false);
    });

    test('4.4 Legacy User with SaaS Context fails closed', async () => {
      const contextA = createTrustedTenantContext({ tenantId: tenantA._id });

      expect(await canAccessClassroom(adminL, classroomA1._id, contextA)).toBe(false);
      expect(canAccessStudent(adminL, studentA1, contextA)).toBe(false);
      expect(await canAccessStudentAsync(adminL, studentA1._id, contextA)).toBe(false);

      expect(await applyClassroomListScope(adminL, {}, contextA)).toEqual(FAIL_CLOSED_FILTER);
      expect(applyStudentListScope(adminL, {}, contextA)).toEqual(FAIL_CLOSED_FILTER);
    });

    test('4.5 SaaS User with Legacy Context fails closed', async () => {
      const contextL = createTrustedTenantContext({ isLegacy: true });

      expect(await canAccessClassroom(adminA, classroomL1._id, contextL)).toBe(false);
      expect(canAccessStudent(adminA, studentL1, contextL)).toBe(false);
      expect(await canAccessStudentAsync(adminA, studentL1._id, contextL)).toBe(false);

      expect(await applyClassroomListScope(adminA, {}, contextL)).toEqual(FAIL_CLOSED_FILTER);
      expect(applyStudentListScope(adminA, {}, contextL)).toEqual(FAIL_CLOSED_FILTER);
    });

    test('4.6 Express req requires req.user corresponding to req.tenantId (cannot trust tenantId alone)', () => {
      // req has req.tenantId but NO req.user -> MUST fail closed
      const reqWithoutUser = {
        tenantId: tenantA._id.toString(),
        headers: { authorization: 'Bearer some-token' },
        method: 'GET'
      };
      expect(resolveTenantContext(reqWithoutUser).isValid).toBe(false);
      expect(buildTenantFilter(reqWithoutUser)).toEqual(FAIL_CLOSED_FILTER);

      // req has req.tenantId but req.user is Legacy (no tenantId) -> MUST fail closed
      const reqWithLegacyUser = {
        tenantId: tenantA._id.toString(),
        user: { _id: adminL._id, role: 'admin', tenantId: null },
        headers: {},
        method: 'GET'
      };
      expect(resolveTenantContext(reqWithLegacyUser).isValid).toBe(false);

      // req has req.tenantId A but req.user has tenantId B -> MUST fail closed
      const reqWithMismatchedUser = {
        tenantId: tenantA._id.toString(),
        user: { _id: adminB._id, role: 'admin', tenantId: tenantB._id },
        headers: {},
        method: 'GET'
      };
      expect(resolveTenantContext(reqWithMismatchedUser).isValid).toBe(false);
    });
  });

  describe('Part 5: SEC-1B2-02 - canAccessStudent Non-Parent Raw ID Restriction & Caller Defenses', () => {
    test('5.1 Synchronous canAccessStudent with raw ID/ObjectId returns FALSE for non-parent', () => {
      // Admin A with raw string ID or ObjectId
      expect(canAccessStudent(adminA, studentA1._id.toString())).toBe(false);
      expect(canAccessStudent(adminA, studentA1._id)).toBe(false);

      // Teacher A with raw string ID or ObjectId
      expect(canAccessStudent(teacherA, studentA1._id.toString())).toBe(false);
      expect(canAccessStudent(teacherA, studentA1._id)).toBe(false);

      // Guard / Staff / HR with raw string ID or ObjectId
      const guardUser = { _id: new mongoose.Types.ObjectId(), role: 'guard', tenantId: tenantA._id };
      expect(canAccessStudent(guardUser, studentA1._id.toString())).toBe(false);
      expect(canAccessStudent(guardUser, studentA1._id)).toBe(false);

      // Non-parent must use canAccessStudentAsync or pass document!
      // When passing full document: Admin A returns true within tenant A
      expect(canAccessStudent(adminA, studentA1)).toBe(true);
      // But Admin A returns false for student B1 document (Tenant B)
      expect(canAccessStudent(adminA, studentB1)).toBe(false);
    });

    test('5.2 Synchronous canAccessStudent with raw ID allows ONLY parent linked IDs', () => {
      // Parent A with linked student ID (studentA1)
      expect(canAccessStudent(parentA, studentA1._id.toString())).toBe(true);
      expect(canAccessStudent(parentA, studentA1._id)).toBe(true);

      // Parent A with unlinked student ID in same tenant (studentA2)
      expect(canAccessStudent(parentA, studentA2._id.toString())).toBe(false);

      // Parent A with foreign tenant student document -> strictly false
      expect(canAccessStudent(parentA, studentB1)).toBe(false);
    });

    test('5.3 canAccessStudentAsync protects parent from foreign tenant ID even if forged into parentInfo', async () => {
      const forgedParent = {
        _id: parentA._id,
        role: 'parent',
        tenantId: tenantA._id,
        parentInfo: {
          studentIds: [studentA1._id, studentB1._id] // Contains cross-tenant ID
        }
      };

      // Linked student in same tenant -> true
      expect(await canAccessStudentAsync(forgedParent, studentA1._id)).toBe(true);

      // Forged student in Tenant B -> strictly false (DB lookup scoped to Tenant A)
      expect(await canAccessStudentAsync(forgedParent, studentB1._id)).toBe(false);
    });

    test('5.4 attendanceController.createLeaveRequest enforces tenant boundary, serves SaaS (Phase 1C) and legacy', async () => {
      const now = new Date();
      const addDays = now.getDay() === 6 ? 2 : now.getDay() === 0 ? 1 : 0;
      const targetDate = new Date(now.getTime() + addDays * 86400000);
      const today = getWorkDate(targetDate, DEFAULT_SCHOOL_TIMEZONE);
      // 1. SaaS user creating leave request -> unlocked in Phase 1C (201 Created with tenantId: tenantA)
      const saasReq = {
        tenantId: tenantA._id.toString(),
        user: parentA,
        body: {
          studentId: studentA1._id.toString(),
          startDate: today,
          endDate: today,
          reason: 'Bé bị ốm cần nghỉ học'
        },
        headers: {},
        method: 'POST'
      };
      const saasRes = createMockResponse();
      await createLeaveRequest(saasReq, saasRes);
      expect(saasRes.statusCode).toBe(201);
      expect(saasRes.body.data.tenantId.toString()).toBe(tenantA._id.toString());

      // 2. Legacy parent attempting cross-tenant student B1 -> 404 (Foreign ID in 1C) / 403
      const crossTenantReq = {
        user: parentL,
        body: {
          studentId: studentB1._id.toString(),
          startDate: today,
          endDate: today,
          reason: 'Bé bị ốm cần nghỉ học'
        },
        headers: {},
        method: 'POST'
      };
      const crossTenantRes = createMockResponse();
      await createLeaveRequest(crossTenantReq, crossTenantRes);
      expect([403, 404]).toContain(crossTenantRes.statusCode);

      // 3. Legacy parent with valid linked legacy student -> 201 Created
      const validLegacyReq = {
        user: parentL,
        body: {
          studentId: studentL1._id.toString(),
          startDate: today,
          endDate: today,
          reason: 'Bé bị sốt cần nghỉ theo dõi sức khỏe'
        },
        headers: {},
        method: 'POST'
      };
      const validLegacyRes = createMockResponse();
      await createLeaveRequest(validLegacyReq, validLegacyRes);
      expect(validLegacyRes.statusCode).toBe(201);
      expect(validLegacyRes.body.success).toBe(true);
      expect(validLegacyRes.body.data.studentId.toString()).toBe(studentL1._id.toString());
    });

    test('5.5 studentProfileChangeRequestController & parentFeedbackController enforce tenant & parent protection', async () => {
      // 1. Profile change request: SaaS user blocked by write gate
      const saasProfileReq = {
        tenantId: tenantA._id.toString(),
        user: parentA,
        body: { studentId: studentA1._id.toString(), changes: { fullName: 'Tên Mới' } },
        headers: {},
        method: 'POST'
      };
      const saasProfileRes = createMockResponse();
      await createProfileChangeRequest(saasProfileReq, saasProfileRes);
      expect(saasProfileRes.statusCode).toBe(403);

      // 2. Profile change request: non-parent blocked
      const nonParentReq = {
        user: teacherL,
        body: { studentId: studentL1._id.toString(), changes: { fullName: 'Tên Mới' } },
        headers: {},
        method: 'POST'
      };
      const nonParentRes = createMockResponse();
      await createProfileChangeRequest(nonParentReq, nonParentRes);
      expect(nonParentRes.statusCode).toBe(403);

      // 3. Feedback: SaaS user blocked by write gate
      const saasFeedbackReq = {
        tenantId: tenantA._id.toString(),
        user: parentA,
        body: { studentId: studentA1._id.toString(), subject: 'Bữa ăn', message: 'Ý kiến về bữa ăn tại trường' },
        headers: {},
        method: 'POST'
      };
      const saasFeedbackRes = createMockResponse();
      await createFeedback(saasFeedbackReq, saasFeedbackRes);
      expect(saasFeedbackRes.statusCode).toBe(403);
    });
  });

  describe('Part 6: SEC-1B2-03 - Plain Object & Client Input Rejection (Anti-Spoofing)', () => {
    test('6.1 req.query as context is rejected (fails closed)', () => {
      // Express req.query: plain object from client query params
      const forgedQuery = {
        tenantId: tenantB._id.toString(),
        page: '1',
        limit: '10'
      };

      const resolved = resolveTenantContext(forgedQuery);
      expect(resolved.isValid).toBe(false);
      expect(resolved.isInvalid).toBe(true);
      expect(buildTenantFilter(forgedQuery)).toEqual(FAIL_CLOSED_FILTER);

      // applyTenantFilter with forged query fails closed
      const filter = applyTenantFilter({ status: 'active' }, forgedQuery);
      expect(filter).toEqual(expect.objectContaining(FAIL_CLOSED_FILTER));
    });

    test('6.2 req.body as context is rejected (fails closed)', () => {
      // Express req.body: plain object from JSON body
      const forgedBody = {
        tenantId: tenantB._id.toString(),
        reason: 'Malicious injection',
        role: 'admin' // Fake role property in body
      };

      const resolved = resolveTenantContext(forgedBody);
      expect(resolved.isValid).toBe(false);
      expect(resolved.isInvalid).toBe(true);
      expect(buildTenantFilter(forgedBody)).toEqual(FAIL_CLOSED_FILTER);
    });

    test('6.3 Plain objects without IS_TRUSTED_CONTEXT cannot be trusted', () => {
      const plainSaaS = { tenantId: tenantA._id.toString() };
      expect(resolveTenantContext(plainSaaS).isValid).toBe(false);

      const plainLegacy = { isLegacy: true };
      expect(resolveTenantContext(plainLegacy).isValid).toBe(false);
    });

    test('6.4 createTrustedTenantContext produces trusted and frozen context', () => {
      const trustedSaaS = createTrustedTenantContext({ tenantId: tenantA._id });
      expect(trustedSaaS[IS_TRUSTED_CONTEXT]).toBe(true);
      expect(Object.isFrozen(trustedSaaS)).toBe(true);

      const resolved = resolveTenantContext(trustedSaaS);
      expect(resolved.isValid).toBe(true);
      expect(resolved.isSaaS).toBe(true);
      expect(resolved.tenantId.toString()).toBe(tenantA._id.toString());

      const trustedLegacy = createTrustedTenantContext({ isLegacy: true });
      expect(resolveTenantContext(trustedLegacy).isLegacy).toBe(true);
    });
  });
});
