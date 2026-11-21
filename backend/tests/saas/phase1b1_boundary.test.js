process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';

const mongoose = require('mongoose');
const request = require('supertest');
const createApp = require('../../app');
const testDbBootstrap = require('../../src/saas/testDbBootstrap');

const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const Classroom = require('../../src/models/zone3_school/Classroom');
const Student = require('../../src/models/zone3_school/Student');
const StudentTransferHistory = require('../../src/models/zone3_school/StudentTransferHistory');

describe('Task 1B.1 - Data Boundary & Public Legacy Auth Gate', () => {
  let bootstrapInstance;
  let app;
  let tenantA;
  let tenantB;
  let legacyClassroomMissingTenant;
  let legacyClassroomNullTenant;
  let legacyClassroomArchived;
  let tenantAClassroom;
  let tenantBClassroom;

  beforeAll(async () => {
    bootstrapInstance = await testDbBootstrap.startTestDb({
      instanceOpts: [{ dbName: 'school_saas_1b1_test_isolated' }]
    });
    await Classroom.syncIndexes();
    await Student.syncIndexes();
    await StudentTransferHistory.syncIndexes();
    app = createApp();
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

    // 1. Legacy classroom with field omitted (missing tenantId)
    legacyClassroomMissingTenant = await Classroom.create({
      name: 'Lớp Mầm 1 (Legacy Missing)',
      fullName: 'Lớp Mầm 1 Legacy Missing Tenant',
      ageGroup: '3-4',
      schoolYear: '2025-2026',
      status: 'active'
    });

    // 2. Legacy classroom with explicit tenantId: null
    legacyClassroomNullTenant = await Classroom.create({
      tenantId: null,
      name: 'Lớp Chồi 1 (Legacy Null)',
      fullName: 'Lớp Chồi 1 Legacy Null Tenant',
      ageGroup: '4-5',
      schoolYear: '2025-2026',
      status: 'active'
    });

    // 3. Legacy archived classroom (should not appear in active registration lists)
    legacyClassroomArchived = await Classroom.create({
      name: 'Lớp Cũ (Archived)',
      fullName: 'Lớp Cũ Đã Lưu Trữ',
      ageGroup: '5-6',
      schoolYear: '2024-2025',
      status: 'archived'
    });

    // 4. SaaS Tenant A classroom
    tenantAClassroom = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Mầm A (SaaS A)',
      fullName: 'Lớp Mầm Tenant A',
      ageGroup: '3-4',
      schoolYear: '2025-2026',
      status: 'active'
    });

    // 5. SaaS Tenant B classroom
    tenantBClassroom = await Classroom.create({
      tenantId: tenantB._id,
      name: 'Lớp Chồi B (SaaS B)',
      fullName: 'Lớp Chồi Tenant B',
      ageGroup: '4-5',
      schoolYear: '2025-2026',
      status: 'active'
    });
  });

  describe('Requirement 1: Schema optional tenantId & index preservation', () => {
    test('Schema paths correctly define optional tenantId referencing Tenant and do not declare single tenantId index', async () => {
      for (const [modelName, model] of [
        ['Classroom', Classroom],
        ['Student', Student],
        ['StudentTransferHistory', StudentTransferHistory]
      ]) {
        const tenantIdPath = model.schema.path('tenantId');
        expect(tenantIdPath).toBeDefined();
        expect(tenantIdPath.instance).toBe('ObjectId');
        expect(tenantIdPath.options.ref).toBe('Tenant');
        expect(tenantIdPath.isRequired).toBeFalsy();
        expect(tenantIdPath.options.index).toBeFalsy();

        // Ensure no schema index is created solely for tenantId
        const schemaIndexes = model.schema.indexes();
        const singleTenantIndex = schemaIndexes.find(([fields]) => fields && fields.tenantId !== undefined && Object.keys(fields).length === 1);
        expect(singleTenantIndex).toBeUndefined();

        // Ensure no collection-level single tenantId index was built
        const collectionIndexes = await model.collection.indexes();
        const builtTenantIndex = collectionIndexes.find(idx => idx.key && idx.key.tenantId !== undefined && Object.keys(idx.key).length === 1);
        expect(builtTenantIndex).toBeUndefined();
      }

      // Check Classroom existing unique index definition
      const classroomIndexes = Classroom.schema.indexes();
      const homeroomUniqueIndex = classroomIndexes.find(([fields, opts]) => fields.schoolYear === 1 && fields.homeroomTeacherId === 1);
      expect(homeroomUniqueIndex).toBeDefined();
      expect(homeroomUniqueIndex[1].unique).toBe(true);
      expect(homeroomUniqueIndex[1].partialFilterExpression).toEqual({
        status: 'active',
        homeroomTeacherId: { $type: 'objectId' }
      });

      // Check Student existing unique index definition
      const studentIndexes = Student.schema.indexes();
      const studentCodeIndex = studentIndexes.find(([fields, opts]) => fields.studentCode === 1);
      expect(studentCodeIndex).toBeDefined();
      expect(studentCodeIndex[1].unique).toBe(true);
    });

    test('Classroom schema supports missing, null, and multi-tenant tenantId', async () => {
      expect(legacyClassroomMissingTenant.tenantId).toBeUndefined();
      expect(legacyClassroomNullTenant.tenantId).toBeNull();
      expect(tenantAClassroom.tenantId.toString()).toBe(tenantA._id.toString());
      expect(tenantBClassroom.tenantId.toString()).toBe(tenantB._id.toString());

      // Existing unique index check: homeroomTeacherId per schoolYear for active classrooms
      const teacherId = new mongoose.Types.ObjectId();
      await Classroom.create({
        name: 'Lớp Test Index 1',
        ageGroup: '3-4',
        schoolYear: '2025-2026',
        status: 'active',
        homeroomTeacherId: teacherId
      });

      await expect(
        Classroom.create({
          name: 'Lớp Test Index 2',
          ageGroup: '3-4',
          schoolYear: '2025-2026',
          status: 'active',
          homeroomTeacherId: teacherId
        })
      ).rejects.toThrow();
    });

    test('Student schema supports missing, null, and multi-tenant tenantId', async () => {
      // Missing tenantId
      const studentLegacyMissing = await Student.create({
        studentCode: 'HS-2026-000001',
        fullName: 'Học Sinh Legacy Missing',
        birthDate: new Date('2021-01-01'),
        gender: 'male',
        classroomId: legacyClassroomMissingTenant._id,
        schoolYear: '2025-2026'
      });
      expect(studentLegacyMissing.tenantId).toBeUndefined();

      // Explicit null tenantId
      const studentLegacyNull = await Student.create({
        tenantId: null,
        studentCode: 'HS-2026-000002',
        fullName: 'Học Sinh Legacy Null',
        birthDate: new Date('2021-02-01'),
        gender: 'female',
        classroomId: legacyClassroomNullTenant._id,
        schoolYear: '2025-2026'
      });
      expect(studentLegacyNull.tenantId).toBeNull();

      // Tenant A
      const studentTenantA = await Student.create({
        tenantId: tenantA._id,
        studentCode: 'HS-2026-000003',
        fullName: 'Học Sinh Trường A',
        birthDate: new Date('2021-03-01'),
        gender: 'male',
        classroomId: tenantAClassroom._id,
        schoolYear: '2025-2026'
      });
      expect(studentTenantA.tenantId.toString()).toBe(tenantA._id.toString());

      // Tenant B
      const studentTenantB = await Student.create({
        tenantId: tenantB._id,
        studentCode: 'HS-2026-000004',
        fullName: 'Học Sinh Trường B',
        birthDate: new Date('2021-04-01'),
        gender: 'female',
        classroomId: tenantBClassroom._id,
        schoolYear: '2025-2026'
      });
      expect(studentTenantB.tenantId.toString()).toBe(tenantB._id.toString());

      // Existing unique index check: studentCode must remain globally unique
      await expect(
        Student.create({
          tenantId: tenantB._id,
          studentCode: 'HS-2026-000001', // duplicate of studentLegacyMissing
          fullName: 'Học Sinh Trùng Mã',
          birthDate: new Date('2021-05-01'),
          gender: 'male',
          classroomId: tenantBClassroom._id,
          schoolYear: '2025-2026'
        })
      ).rejects.toThrow();
    });

    test('StudentTransferHistory schema supports missing, null, and multi-tenant tenantId', async () => {
      const staffUser = await User.create({
        username: 'staff-user-test',
        passwordHash: 'not-used',
        role: 'admin',
        profile: { fullName: 'Nhân viên test' }
      });

      const historyLegacy = await StudentTransferHistory.create({
        studentId: new mongoose.Types.ObjectId(),
        studentCode: 'HS-2026-000010',
        studentName: 'Học Sinh Chuyển Lớp Legacy',
        fromClassroomId: legacyClassroomMissingTenant._id,
        fromClassName: legacyClassroomMissingTenant.name,
        toClassroomId: legacyClassroomNullTenant._id,
        toClassName: legacyClassroomNullTenant.name,
        schoolYear: '2025-2026',
        reason: 'Chuyển lớp theo nguyện vọng phụ huynh',
        transferredBy: staffUser._id,
        transferredByName: staffUser.profile.fullName
      });
      expect(historyLegacy.tenantId).toBeUndefined();

      const historyNull = await StudentTransferHistory.create({
        tenantId: null,
        studentId: new mongoose.Types.ObjectId(),
        studentCode: 'HS-2026-000011',
        studentName: 'Học Sinh Chuyển Lớp Null',
        fromClassroomId: legacyClassroomMissingTenant._id,
        fromClassName: legacyClassroomMissingTenant.name,
        toClassroomId: legacyClassroomNullTenant._id,
        toClassName: legacyClassroomNullTenant.name,
        schoolYear: '2025-2026',
        reason: 'Chuyển lớp bảo đảm',
        transferredBy: staffUser._id,
        transferredByName: staffUser.profile.fullName
      });
      expect(historyNull.tenantId).toBeNull();

      const historyTenantA = await StudentTransferHistory.create({
        tenantId: tenantA._id,
        studentId: new mongoose.Types.ObjectId(),
        studentCode: 'HS-2026-000012',
        studentName: 'Học Sinh Chuyển Lớp Tenant A',
        fromClassroomId: tenantAClassroom._id,
        fromClassName: tenantAClassroom.name,
        toClassroomId: new mongoose.Types.ObjectId(),
        toClassName: 'Lớp Chồi A',
        schoolYear: '2025-2026',
        reason: 'Chuyển lớp nội bộ trường A',
        transferredBy: staffUser._id,
        transferredByName: staffUser.profile.fullName
      });
      expect(historyTenantA.tenantId.toString()).toBe(tenantA._id.toString());
    });
  });

  describe('Requirement 2: GET /api/auth/registration-classrooms public legacy isolation', () => {
    test('returns only active legacy classrooms (missing or null tenantId), strictly excludes SaaS classrooms', async () => {
      const res = await request(app)
        .get('/api/auth/registration-classrooms')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      const returnedIds = res.body.data.map((c) => c._id.toString());

      // Must include active legacy classrooms
      expect(returnedIds).toContain(legacyClassroomMissingTenant._id.toString());
      expect(returnedIds).toContain(legacyClassroomNullTenant._id.toString());

      // Must exclude archived legacy classroom
      expect(returnedIds).not.toContain(legacyClassroomArchived._id.toString());

      // Strictly must NOT include Tenant A or Tenant B classrooms
      expect(returnedIds).not.toContain(tenantAClassroom._id.toString());
      expect(returnedIds).not.toContain(tenantBClassroom._id.toString());

      // Exactly 2 active legacy classrooms
      expect(res.body.data).toHaveLength(2);

      // Verify returned shape doesn't leak tenantId
      for (const item of res.body.data) {
        expect(item).toHaveProperty('name');
        expect(item).toHaveProperty('ageGroup');
        expect(item).toHaveProperty('schoolYear');
        expect(item.tenantId).toBeUndefined();
      }
    });
  });

  describe('Requirement 3: POST /api/auth/register rejection of SaaS classrooms', () => {
    test('permits registration with an active legacy classroom with missing tenantId', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'phuhuynh-legacy-missing',
          password: 'mat-khau-an-toan-123',
          profile: {
            fullName: 'Phụ huynh Legacy Missing',
            phone: '0912345678',
            email: 'ph-missing@example.com'
          },
          parentInfo: {
            requestedClassroomId: legacyClassroomMissingTenant._id.toString(),
            registrationNote: 'Bé Nguyễn Văn A, xin đăng ký'
          }
        })
        .expect(201);

      expect(res.body.data).toEqual(
        expect.objectContaining({
          username: 'phuhuynh-legacy-missing',
          role: 'parent',
          status: 'inactive'
        })
      );

      const user = await User.findOne({ username: 'phuhuynh-legacy-missing' });
      expect(user).toBeTruthy();
      expect(user.role).toBe('parent');
      expect(user.status).toBe('inactive');
      expect(user.parentInfo.requestedClassroomId.toString()).toBe(
        legacyClassroomMissingTenant._id.toString()
      );
      expect(user.tenantId == null).toBe(true);
    });

    test('permits registration with an active legacy classroom with explicit tenantId: null', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'phuhuynh-legacy-null',
          password: 'mat-khau-an-toan-123',
          profile: {
            fullName: 'Phụ huynh Legacy Null'
          },
          parentInfo: {
            requestedClassroomId: legacyClassroomNullTenant._id.toString(),
            registrationNote: 'Bé Trần Thị B, xin đăng ký'
          }
        })
        .expect(201);

      expect(res.body.data.username).toBe('phuhuynh-legacy-null');
      const user = await User.findOne({ username: 'phuhuynh-legacy-null' });
      expect(user).toBeTruthy();
      expect(user.parentInfo.requestedClassroomId.toString()).toBe(
        legacyClassroomNullTenant._id.toString()
      );
    });

    test('rejects registration with Tenant A classroom even with known valid ObjectId, without creating user', async () => {
      const countBefore = await User.countDocuments({});
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'phuhuynh-hack-tenant-a',
          password: 'mat-khau-an-toan-123',
          profile: {
            fullName: 'Phụ huynh Đăng ký trộm Lớp Tenant A'
          },
          parentInfo: {
            requestedClassroomId: tenantAClassroom._id.toString(),
            registrationNote: 'Cố ý đăng ký vào lớp trường A'
          }
        })
        .expect(400);

      expect(res.body.message).toBe('Lớp học đã chọn không tồn tại hoặc không còn hoạt động');

      // Crucial: no side effect - user must NOT be created
      const userExists = await User.exists({ username: 'phuhuynh-hack-tenant-a' });
      expect(userExists).toBeNull();
      const countAfter = await User.countDocuments({});
      expect(countAfter).toBe(countBefore);
    });

    test('rejects registration with Tenant B classroom even with known valid ObjectId, without creating user', async () => {
      const countBefore = await User.countDocuments({});
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'phuhuynh-hack-tenant-b',
          password: 'mat-khau-an-toan-123',
          profile: {
            fullName: 'Phụ huynh Đăng ký trộm Lớp Tenant B'
          },
          parentInfo: {
            requestedClassroomId: tenantBClassroom._id.toString(),
            registrationNote: 'Cố ý đăng ký vào lớp trường B'
          }
        })
        .expect(400);

      expect(res.body.message).toBe('Lớp học đã chọn không tồn tại hoặc không còn hoạt động');

      const userExists = await User.exists({ username: 'phuhuynh-hack-tenant-b' });
      expect(userExists).toBeNull();
      const countAfter = await User.countDocuments({});
      expect(countAfter).toBe(countBefore);
    });

    test('rejects registration with non-existent classroom ObjectId', async () => {
      const countBefore = await User.countDocuments({});
      const fakeClassroomId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'phuhuynh-fake-class',
          password: 'mat-khau-an-toan-123',
          profile: { fullName: 'Phụ huynh Lớp Fake' },
          parentInfo: {
            requestedClassroomId: fakeClassroomId.toString(),
            registrationNote: 'Đăng ký lớp không tồn tại'
          }
        })
        .expect(400);

      expect(res.body.message).toBe('Lớp học đã chọn không tồn tại hoặc không còn hoạt động');
      expect(await User.exists({ username: 'phuhuynh-fake-class' })).toBeNull();
      const countAfter = await User.countDocuments({});
      expect(countAfter).toBe(countBefore);
    });

    test('rejects registration with archived legacy classroom', async () => {
      const countBefore = await User.countDocuments({});
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'phuhuynh-archived-class',
          password: 'mat-khau-an-toan-123',
          profile: { fullName: 'Phụ huynh Lớp Archived' },
          parentInfo: {
            requestedClassroomId: legacyClassroomArchived._id.toString(),
            registrationNote: 'Đăng ký lớp archived'
          }
        })
        .expect(400);

      expect(res.body.message).toBe('Lớp học đã chọn không tồn tại hoặc không còn hoạt động');
      expect(await User.exists({ username: 'phuhuynh-archived-class' })).toBeNull();
      const countAfter = await User.countDocuments({});
      expect(countAfter).toBe(countBefore);
    });
  });
});
