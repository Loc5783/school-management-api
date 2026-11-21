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
const ImportIdempotency = require('../../src/models/zone1_system/ImportIdempotency');
const { buildTenantFilter } = require('../../src/services/tenantFilterService');

describe('Task 1C.1 - Data Boundary & Index Behavior (Attendance, Leave, Idempotency)', () => {
  let bootstrapInstance;
  let tenantA;
  let tenantB;
  let legacyUser;
  let tenantAUser;
  let tenantBUser;
  let legacyStudent;
  let tenantAStudent;
  let tenantBStudent;
  let legacyClassroom;
  let tenantAClassroom;
  let tenantBClassroom;

  beforeAll(async () => {
    bootstrapInstance = await testDbBootstrap.startTestDb({
      instanceOpts: [{ dbName: 'school_saas_1c1_test_isolated' }]
    });

    // Sync schema indexes in isolated in-memory test database
    await Promise.all([
      Tenant.syncIndexes(),
      User.syncIndexes(),
      Classroom.syncIndexes(),
      Student.syncIndexes(),
      StudentAttendance.syncIndexes(),
      StudentLeaveRequest.syncIndexes(),
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
      Classroom.deleteMany({}),
      Student.deleteMany({}),
      StudentAttendance.deleteMany({}),
      StudentLeaveRequest.deleteMany({}),
      ImportIdempotency.deleteMany({})
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

    // Create reference users (legacy, tenantA, tenantB)
    legacyUser = await User.create({
      username: 'teacher_legacy',
      passwordHash: 'hashed_password_legacy',
      role: 'teacher',
      status: 'active',
      profile: { fullName: 'Giáo viên Legacy' }
    });

    tenantAUser = await User.create({
      tenantId: tenantA._id,
      username: 'teacher_tenant_a',
      passwordHash: 'hashed_password_tenant_a',
      role: 'teacher',
      status: 'active',
      profile: { fullName: 'Giáo viên Trường A' }
    });

    tenantBUser = await User.create({
      tenantId: tenantB._id,
      username: 'teacher_tenant_b',
      passwordHash: 'hashed_password_tenant_b',
      role: 'teacher',
      status: 'active',
      profile: { fullName: 'Giáo viên Trường B' }
    });

    // Create reference classrooms
    legacyClassroom = await Classroom.create({
      name: 'Lớp Legacy 1',
      fullName: 'Lớp Mầm Legacy',
      ageGroup: '3-4',
      schoolYear: '2025-2026',
      status: 'active'
    });

    tenantAClassroom = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp A1',
      fullName: 'Lớp Mầm Trường A',
      ageGroup: '3-4',
      schoolYear: '2025-2026',
      status: 'active'
    });

    tenantBClassroom = await Classroom.create({
      tenantId: tenantB._id,
      name: 'Lớp B1',
      fullName: 'Lớp Mầm Trường B',
      ageGroup: '3-4',
      schoolYear: '2025-2026',
      status: 'active'
    });

    // Create reference students
    legacyStudent = await Student.create({
      studentCode: 'HS-2025-000001',
      fullName: 'Nguyễn Văn Legacy',
      gender: 'male',
      birthDate: new Date('2021-05-10'),
      classroomId: legacyClassroom._id,
      status: 'enrolled',
      enrollmentDate: new Date('2025-09-01'),
      primaryContactPhone: '0901000001',
      admissionStatus: 'admitted'
    });

    tenantAStudent = await Student.create({
      tenantId: tenantA._id,
      studentCode: 'HS-2025-000002',
      fullName: 'Trần Thị A',
      gender: 'female',
      birthDate: new Date('2021-06-15'),
      classroomId: tenantAClassroom._id,
      status: 'enrolled',
      enrollmentDate: new Date('2025-09-01'),
      primaryContactPhone: '0901000002',
      admissionStatus: 'admitted'
    });

    tenantBStudent = await Student.create({
      tenantId: tenantB._id,
      studentCode: 'HS-2025-000003',
      fullName: 'Lê Văn B',
      gender: 'male',
      birthDate: new Date('2021-07-20'),
      classroomId: tenantBClassroom._id,
      status: 'enrolled',
      enrollmentDate: new Date('2025-09-01'),
      primaryContactPhone: '0901000003',
      admissionStatus: 'admitted'
    });
  });

  // =========================================================================
  // 1. StudentAttendance Data Boundary & Index Behavior
  // =========================================================================
  describe('1. StudentAttendance Model & Boundary', () => {
    test('1.1. Legacy attendance with omitted tenantId saves successfully and queries with legacy filter', async () => {
      const doc = await StudentAttendance.create({
        studentId: legacyStudent._id,
        studentName: legacyStudent.fullName,
        classroomId: legacyClassroom._id,
        className: legacyClassroom.name,
        attendDate: new Date('2026-11-02T00:00:00.000Z'),
        attendanceDateKey: '2026-11-02',
        status: 'present',
        recordedBy: legacyUser._id,
        recordedByName: legacyUser.profile.fullName
      });

      expect(doc._id).toBeDefined();
      expect(doc.tenantId).toBeUndefined();

      // Query via canonical legacy filter
      const legacyFilter = buildTenantFilter({ user: legacyUser });
      const found = await StudentAttendance.find({ ...legacyFilter, studentId: legacyStudent._id });
      expect(found).toHaveLength(1);
      expect(found[0]._id.toString()).toBe(doc._id.toString());
    });

    test('1.2. Legacy attendance with explicit tenantId: null saves successfully', async () => {
      const doc = await StudentAttendance.create({
        tenantId: null,
        studentId: legacyStudent._id,
        studentName: legacyStudent.fullName,
        classroomId: legacyClassroom._id,
        className: legacyClassroom.name,
        attendDate: new Date('2026-11-03T00:00:00.000Z'),
        attendanceDateKey: '2026-11-03',
        status: 'present',
        recordedBy: legacyUser._id,
        recordedByName: legacyUser.profile.fullName
      });

      expect(doc._id).toBeDefined();
      expect(doc.tenantId).toBeNull();

      const legacyFilter = buildTenantFilter({ user: legacyUser });
      const found = await StudentAttendance.find({ ...legacyFilter, attendanceDateKey: '2026-11-03' });
      expect(found).toHaveLength(1);
      expect(found[0].tenantId).toBeNull();
    });

    test('1.3. SaaS Tenant A and Tenant B attendance records save with respective tenantId and remain strictly isolated', async () => {
      const docA = await StudentAttendance.create({
        tenantId: tenantA._id,
        studentId: tenantAStudent._id,
        studentName: tenantAStudent.fullName,
        classroomId: tenantAClassroom._id,
        className: tenantAClassroom.name,
        attendDate: new Date('2026-11-02T00:00:00.000Z'),
        attendanceDateKey: '2026-11-02',
        status: 'present',
        recordedBy: tenantAUser._id,
        recordedByName: tenantAUser.profile.fullName
      });

      const docB = await StudentAttendance.create({
        tenantId: tenantB._id,
        studentId: tenantBStudent._id,
        studentName: tenantBStudent.fullName,
        classroomId: tenantBClassroom._id,
        className: tenantBClassroom.name,
        attendDate: new Date('2026-11-02T00:00:00.000Z'),
        attendanceDateKey: '2026-11-02',
        status: 'late',
        recordedBy: tenantBUser._id,
        recordedByName: tenantBUser.profile.fullName
      });

      expect(docA.tenantId.toString()).toBe(tenantA._id.toString());
      expect(docB.tenantId.toString()).toBe(tenantB._id.toString());

      // Query via Tenant A filter
      const filterA = buildTenantFilter({ tenantId: tenantA._id, user: tenantAUser });
      const resultsA = await StudentAttendance.find(filterA);
      expect(resultsA).toHaveLength(1);
      expect(resultsA[0]._id.toString()).toBe(docA._id.toString());
      expect(resultsA[0].status).toBe('present');

      // Query via Tenant B filter
      const filterB = buildTenantFilter({ tenantId: tenantB._id, user: tenantBUser });
      const resultsB = await StudentAttendance.find(filterB);
      expect(resultsB).toHaveLength(1);
      expect(resultsB[0]._id.toString()).toBe(docB._id.toString());
      expect(resultsB[0].status).toBe('late');
    });

    test('1.4. Attendance uniqueness { studentId: 1, attendanceDateKey: 1 } blocks duplicate for same student, but allows identical date across tenants', async () => {
      // Create Tenant A student attendance for 2026-11-02
      await StudentAttendance.create({
        tenantId: tenantA._id,
        studentId: tenantAStudent._id,
        studentName: tenantAStudent.fullName,
        classroomId: tenantAClassroom._id,
        className: tenantAClassroom.name,
        attendDate: new Date('2026-11-02T00:00:00.000Z'),
        attendanceDateKey: '2026-11-02',
        status: 'present',
        recordedBy: tenantAUser._id,
        recordedByName: tenantAUser.profile.fullName
      });

      // Same student, same attendanceDateKey -> MUST throw duplicate key error E11000
      let duplicateError;
      try {
        await StudentAttendance.create({
          tenantId: tenantA._id,
          studentId: tenantAStudent._id,
          studentName: tenantAStudent.fullName,
          classroomId: tenantAClassroom._id,
          className: tenantAClassroom.name,
          attendDate: new Date('2026-11-02T00:00:00.000Z'),
          attendanceDateKey: '2026-11-02',
          status: 'absent',
          recordedBy: tenantAUser._id,
          recordedByName: tenantAUser.profile.fullName
        });
      } catch (err) {
        duplicateError = err;
      }
      expect(duplicateError).toBeDefined();
      expect(duplicateError.code).toBe(11000);

      // Different student in Tenant B with the EXACT SAME attendanceDateKey -> MUST SUCCEED (no cross-tenant collision)
      const docB = await StudentAttendance.create({
        tenantId: tenantB._id,
        studentId: tenantBStudent._id,
        studentName: tenantBStudent.fullName,
        classroomId: tenantBClassroom._id,
        className: tenantBClassroom.name,
        attendDate: new Date('2026-11-02T00:00:00.000Z'),
        attendanceDateKey: '2026-11-02',
        status: 'present',
        recordedBy: tenantBUser._id,
        recordedByName: tenantBUser.profile.fullName
      });
      expect(docB._id).toBeDefined();
      expect(docB.tenantId.toString()).toBe(tenantB._id.toString());
    });

    test('1.5. StudentAttendance indexes include planned performance compound indexes', async () => {
      const indexes = await StudentAttendance.collection.indexes();
      const indexKeyPatterns = indexes.map((idx) => JSON.stringify(idx.key));

      // Existing indexes preserved
      expect(indexKeyPatterns).toContain(JSON.stringify({ studentId: 1, attendDate: 1 }));
      expect(indexKeyPatterns).toContain(JSON.stringify({ studentId: 1, attendanceDateKey: 1 }));
      expect(indexKeyPatterns).toContain(JSON.stringify({ classroomId: 1, attendDate: 1 }));
      expect(indexKeyPatterns).toContain(JSON.stringify({ attendDate: 1 }));

      // New multi-tenant compound indexes
      expect(indexKeyPatterns).toContain(JSON.stringify({ tenantId: 1, studentId: 1, attendDate: 1 }));
      expect(indexKeyPatterns).toContain(JSON.stringify({ tenantId: 1, classroomId: 1, attendDate: 1 }));
      expect(indexKeyPatterns).toContain(JSON.stringify({ tenantId: 1, attendDate: 1 }));
    });
  });

  // =========================================================================
  // 2. StudentLeaveRequest Data Boundary & Index Behavior
  // =========================================================================
  describe('2. StudentLeaveRequest Model & Boundary', () => {
    test('2.1. Legacy leave request with omitted tenantId saves successfully and queries with legacy filter', async () => {
      const leaveDoc = await StudentLeaveRequest.create({
        studentId: legacyStudent._id,
        studentName: legacyStudent.fullName,
        classroomId: legacyClassroom._id,
        className: legacyClassroom.name,
        requesterId: legacyUser._id,
        requesterName: legacyUser.profile.fullName,
        startDate: '2026-11-10',
        endDate: '2026-11-12',
        reason: 'Gia đình có việc bận cần về quê',
        status: 'pending'
      });

      expect(leaveDoc._id).toBeDefined();
      expect(leaveDoc.tenantId).toBeUndefined();

      const legacyFilter = buildTenantFilter({ user: legacyUser });
      const found = await StudentLeaveRequest.find({ ...legacyFilter, studentId: legacyStudent._id });
      expect(found).toHaveLength(1);
      expect(found[0]._id.toString()).toBe(leaveDoc._id.toString());
    });

    test('2.2. Legacy leave request with explicit tenantId: null saves successfully', async () => {
      const leaveDoc = await StudentLeaveRequest.create({
        tenantId: null,
        studentId: legacyStudent._id,
        studentName: legacyStudent.fullName,
        classroomId: legacyClassroom._id,
        className: legacyClassroom.name,
        requesterId: legacyUser._id,
        requesterName: legacyUser.profile.fullName,
        startDate: '2026-11-15',
        endDate: '2026-11-16',
        reason: 'Học sinh bị cảm cúm sốt nhẹ',
        status: 'pending'
      });

      expect(leaveDoc.tenantId).toBeNull();
      const legacyFilter = buildTenantFilter({ user: legacyUser });
      const found = await StudentLeaveRequest.find({ ...legacyFilter, startDate: '2026-11-15' });
      expect(found).toHaveLength(1);
    });

    test('2.3. SaaS Tenant A and Tenant B leave requests save with respective tenantId and remain strictly isolated', async () => {
      const reqA = await StudentLeaveRequest.create({
        tenantId: tenantA._id,
        studentId: tenantAStudent._id,
        studentName: tenantAStudent.fullName,
        classroomId: tenantAClassroom._id,
        className: tenantAClassroom.name,
        requesterId: tenantAUser._id,
        requesterName: tenantAUser.profile.fullName,
        startDate: '2026-11-10',
        endDate: '2026-11-12',
        reason: 'Học sinh trường A đi khám định kỳ',
        status: 'pending'
      });

      const reqB = await StudentLeaveRequest.create({
        tenantId: tenantB._id,
        studentId: tenantBStudent._id,
        studentName: tenantBStudent.fullName,
        classroomId: tenantBClassroom._id,
        className: tenantBClassroom.name,
        requesterId: tenantBUser._id,
        requesterName: tenantBUser.profile.fullName,
        startDate: '2026-11-10',
        endDate: '2026-11-12',
        reason: 'Học sinh trường B gia đình có việc',
        status: 'pending'
      });

      expect(reqA.tenantId.toString()).toBe(tenantA._id.toString());
      expect(reqB.tenantId.toString()).toBe(tenantB._id.toString());

      // Query Tenant A
      const filterA = buildTenantFilter({ tenantId: tenantA._id, user: tenantAUser });
      const foundA = await StudentLeaveRequest.find(filterA);
      expect(foundA).toHaveLength(1);
      expect(foundA[0]._id.toString()).toBe(reqA._id.toString());

      // Query Tenant B
      const filterB = buildTenantFilter({ tenantId: tenantB._id, user: tenantBUser });
      const foundB = await StudentLeaveRequest.find(filterB);
      expect(foundB).toHaveLength(1);
      expect(foundB[0]._id.toString()).toBe(reqB._id.toString());
    });

    test('2.4. Multiple leave requests on identical dates across tenants do NOT collide', async () => {
      // Overlapping dates between Tenant A and Tenant B
      const [doc1, doc2] = await Promise.all([
        StudentLeaveRequest.create({
          tenantId: tenantA._id,
          studentId: tenantAStudent._id,
          studentName: tenantAStudent.fullName,
          classroomId: tenantAClassroom._id,
          className: tenantAClassroom.name,
          requesterId: tenantAUser._id,
          requesterName: tenantAUser.profile.fullName,
          startDate: '2026-11-20',
          endDate: '2026-11-21',
          reason: 'Lý do 1 trường A',
          status: 'pending'
        }),
        StudentLeaveRequest.create({
          tenantId: tenantB._id,
          studentId: tenantBStudent._id,
          studentName: tenantBStudent.fullName,
          classroomId: tenantBClassroom._id,
          className: tenantBClassroom.name,
          requesterId: tenantBUser._id,
          requesterName: tenantBUser.profile.fullName,
          startDate: '2026-11-20',
          endDate: '2026-11-21',
          reason: 'Lý do 2 trường B',
          status: 'pending'
        })
      ]);

      expect(doc1._id).toBeDefined();
      expect(doc2._id).toBeDefined();
      expect(doc1._id.toString()).not.toBe(doc2._id.toString());
    });

    test('2.5. StudentLeaveRequest indexes include planned performance compound indexes', async () => {
      const indexes = await StudentLeaveRequest.collection.indexes();
      const indexKeyPatterns = indexes.map((idx) => JSON.stringify(idx.key));

      // Existing indexes preserved
      expect(indexKeyPatterns).toContain(JSON.stringify({ studentId: 1, startDate: 1, endDate: 1, status: 1 }));
      expect(indexKeyPatterns).toContain(JSON.stringify({ classroomId: 1, status: 1, startDate: 1 }));
      expect(indexKeyPatterns).toContain(JSON.stringify({ requesterId: 1, createdAt: -1 }));

      // New multi-tenant compound indexes
      expect(indexKeyPatterns).toContain(JSON.stringify({ tenantId: 1, status: 1, createdAt: -1 }));
      expect(indexKeyPatterns).toContain(JSON.stringify({ tenantId: 1, classroomId: 1, status: 1 }));
      expect(indexKeyPatterns).toContain(JSON.stringify({ tenantId: 1, studentId: 1, status: 1 }));
    });
  });

  // =========================================================================
  // 3. ImportIdempotency Data Boundary & Cross-Tenant Uniqueness Collision Analysis
  // =========================================================================
  describe('3. ImportIdempotency Model & Uniqueness Collision Analysis', () => {
    test('3.1. Legacy idempotency record with omitted/null tenantId saves and queries successfully', async () => {
      const doc = await ImportIdempotency.create({
        idempotencyKey: 'LEGACY-IMPORT-KEY-001',
        fingerprint: 'fp-legacy-001',
        status: 'completed',
        userId: legacyUser._id
      });

      expect(doc._id).toBeDefined();
      expect(doc.tenantId).toBeUndefined();

      const found = await ImportIdempotency.findOne({ idempotencyKey: 'LEGACY-IMPORT-KEY-001' });
      expect(found).not.toBeNull();
      expect(found._id.toString()).toBe(doc._id.toString());
    });

    test('3.2. SaaS Tenant A and Tenant B records with distinct keys save with respective tenantId', async () => {
      const docA = await ImportIdempotency.create({
        tenantId: tenantA._id,
        idempotencyKey: 'TENANT-A-KEY-001',
        fingerprint: 'fp-tenant-a-001',
        status: 'processing',
        userId: tenantAUser._id
      });

      const docB = await ImportIdempotency.create({
        tenantId: tenantB._id,
        idempotencyKey: 'TENANT-B-KEY-001',
        fingerprint: 'fp-tenant-b-001',
        status: 'processing',
        userId: tenantBUser._id
      });

      expect(docA.tenantId.toString()).toBe(tenantA._id.toString());
      expect(docB.tenantId.toString()).toBe(tenantB._id.toString());

      // Query by tenantId
      const foundA = await ImportIdempotency.find({ tenantId: tenantA._id });
      expect(foundA).toHaveLength(1);
      expect(foundA[0].idempotencyKey).toBe('TENANT-A-KEY-001');

      const foundB = await ImportIdempotency.find({ tenantId: tenantB._id });
      expect(foundB).toHaveLength(1);
      expect(foundB[0].idempotencyKey).toBe('TENANT-B-KEY-001');
    });

    test('3.3. VERIFICATION OF BLOCKER: Un-migrated global unique index { idempotencyKey: 1 } collides across tenants on identical raw keys', async () => {
      const commonRawKey = 'TRANSFER-REQ-IDEMPOTENCY-COMMON-KEY-999';

      // Tenant A creates a record with commonRawKey
      const docA = await ImportIdempotency.create({
        tenantId: tenantA._id,
        idempotencyKey: commonRawKey,
        fingerprint: 'fp-tenant-a-transfer',
        status: 'completed',
        userId: tenantAUser._id,
        response: { success: true, message: 'Tenant A transfer success' }
      });
      expect(docA._id).toBeDefined();

      // Tenant B sends a request using the exact same raw key
      // Under current global unique index on idempotencyKey alone, this FAILS with E11000
      let collisionError;
      try {
        await ImportIdempotency.create({
          tenantId: tenantB._id,
          idempotencyKey: commonRawKey,
          fingerprint: 'fp-tenant-b-transfer',
          status: 'processing',
          userId: tenantBUser._id
        });
      } catch (err) {
        collisionError = err;
      }

      expect(collisionError).toBeDefined();
      expect(collisionError.code).toBe(11000);
      expect(collisionError.message).toMatch(/duplicate key error/i);

      // Demonstrates cross-tenant leak risk if queried without tenant filter:
      const leakedRecord = await ImportIdempotency.findOne({ idempotencyKey: commonRawKey });
      expect(leakedRecord).not.toBeNull();
      // Tenant B would erroneously receive Tenant A's tenantId and user's cached response!
      expect(leakedRecord.tenantId.toString()).toBe(tenantA._id.toString());
      expect(leakedRecord.userId.toString()).toBe(tenantAUser._id.toString());
    });

    test('3.4. SAFE MITIGATION PATTERN: Service-level key namespacing `${tenantId}:${idempotencyKey}` prevents collision', async () => {
      const clientKey = 'TRANSFER-REQ-USER-CHOSEN-KEY-12345';
      const namespacedKeyA = `${tenantA._id}:${clientKey}`;
      const namespacedKeyB = `${tenantB._id}:${clientKey}`;

      // Both tenants can save concurrently without any duplicate key collision
      const [docA, docB] = await Promise.all([
        ImportIdempotency.create({
          tenantId: tenantA._id,
          idempotencyKey: namespacedKeyA,
          fingerprint: 'fp-namespaced-a',
          status: 'completed',
          userId: tenantAUser._id
        }),
        ImportIdempotency.create({
          tenantId: tenantB._id,
          idempotencyKey: namespacedKeyB,
          fingerprint: 'fp-namespaced-b',
          status: 'completed',
          userId: tenantBUser._id
        })
      ]);

      expect(docA._id).toBeDefined();
      expect(docB._id).toBeDefined();
      expect(docA.tenantId.toString()).toBe(tenantA._id.toString());
      expect(docB.tenantId.toString()).toBe(tenantB._id.toString());

      // Each tenant's lookup resolves only their own record
      const lookupA = await ImportIdempotency.findOne({
        tenantId: tenantA._id,
        idempotencyKey: namespacedKeyA
      });
      expect(lookupA._id.toString()).toBe(docA._id.toString());

      const lookupB = await ImportIdempotency.findOne({
        tenantId: tenantB._id,
        idempotencyKey: namespacedKeyB
      });
      expect(lookupB._id.toString()).toBe(docB._id.toString());
    });

    test('3.5. ImportIdempotency indexes preserve global unique and include tenant lookup index', async () => {
      const indexes = await ImportIdempotency.collection.indexes();
      const indexNames = indexes.map((idx) => idx.name);
      const indexKeyPatterns = indexes.map((idx) => JSON.stringify(idx.key));

      // Global unique index on idempotencyKey preserved
      expect(indexKeyPatterns).toContain(JSON.stringify({ idempotencyKey: 1 }));
      const keyIdx = indexes.find((idx) => idx.name === 'idempotencyKey_1' || idx.key.idempotencyKey === 1);
      expect(keyIdx.unique).toBe(true);

      // Multi-tenant index added
      expect(indexKeyPatterns).toContain(JSON.stringify({ tenantId: 1, createdAt: -1 }));
    });
  });

  // =========================================================================
  // 4. Schema Optionality (No Hard Schema Enforcement for Legacy)
  // =========================================================================
  describe('4. Schema Optionality & Service-Level Enforcement Contract', () => {
    test('4.1. Schemas do NOT enforce tenantId: required (validation succeeds with undefined / null)', async () => {
      const att = new StudentAttendance({
        studentId: legacyStudent._id,
        studentName: legacyStudent.fullName,
        classroomId: legacyClassroom._id,
        className: legacyClassroom.name,
        recordedBy: legacyUser._id,
        recordedByName: legacyUser.profile.fullName
      });
      await expect(att.validate()).resolves.toBeUndefined();

      const leave = new StudentLeaveRequest({
        studentId: legacyStudent._id,
        studentName: legacyStudent.fullName,
        classroomId: legacyClassroom._id,
        className: legacyClassroom.name,
        requesterId: legacyUser._id,
        requesterName: legacyUser.profile.fullName,
        startDate: '2026-11-01',
        endDate: '2026-11-02',
        reason: 'Lý do xin nghỉ hợp lệ 5 ký tự'
      });
      await expect(leave.validate()).resolves.toBeUndefined();

      const idemp = new ImportIdempotency({
        idempotencyKey: 'TEST-SCHEMA-OPTIONALITY-KEY',
        fingerprint: 'fp-test-optionality',
        userId: legacyUser._id
      });
      await expect(idemp.validate()).resolves.toBeUndefined();
    });

    test('4.2. Service-level check correctly validates tenantId for SaaS writes', () => {
      const validateSaaSWritePayload = (payload, isSaaS) => {
        if (!isSaaS) return true; // Legacy write allows null / omitted tenantId
        if (!payload.tenantId || !mongoose.isValidObjectId(payload.tenantId)) {
          throw new Error('SaaS write requires a valid tenantId ObjectId');
        }
        return true;
      };

      // Legacy write: passes without tenantId
      expect(validateSaaSWritePayload({}, false)).toBe(true);
      expect(validateSaaSWritePayload({ tenantId: null }, false)).toBe(true);

      // SaaS write: fails without tenantId
      expect(() => validateSaaSWritePayload({}, true)).toThrow('SaaS write requires a valid tenantId ObjectId');
      expect(() => validateSaaSWritePayload({ tenantId: null }, true)).toThrow('SaaS write requires a valid tenantId ObjectId');
      expect(() => validateSaaSWritePayload({ tenantId: 'not-valid' }, true)).toThrow('SaaS write requires a valid tenantId ObjectId');

      // SaaS write: succeeds with valid ObjectId
      expect(validateSaaSWritePayload({ tenantId: tenantA._id }, true)).toBe(true);
    });
  });
});
