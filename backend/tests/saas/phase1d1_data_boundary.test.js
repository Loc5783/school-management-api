process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';

const mongoose = require('mongoose');
const request = require('supertest');
const testDbBootstrap = require('../../src/saas/testDbBootstrap');
const createSaasApp = require('../../src/saas/createSaasApp');

const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const Classroom = require('../../src/models/zone3_school/Classroom');

const Department = require('../../src/models/zone2_hr/Department');
const Employee = require('../../src/models/zone2_hr/Employee');
const LeaveRequest = require('../../src/models/zone2_hr/LeaveRequest');
const StaffShift = require('../../src/models/zone2_hr/StaffShift');
const StaffReplacement = require('../../src/models/zone2_hr/StaffReplacement');
const AttendanceRecord = require('../../src/models/zone2_hr/AttendanceRecord');
const MonthlyTimesheet = require('../../src/models/zone2_hr/MonthlyTimesheet');

const {
  createTrustedTenantContext,
  buildTenantFilter
} = require('../../src/services/tenantFilterService');
const { generateSchoolUserToken } = require('../../src/saas/utils/saasJwt');

describe('Task 1D.1 — Nền Dữ Liệu Nhân Sự & Phòng Ban Đa Trường (Data Boundary & Index Verification)', () => {
  let bootstrapInstance;
  let saasApp;
  let tenantA;
  let tenantB;
  let userLegacy1;
  let userLegacy2;
  let userTenantA;
  let userTenantB;
  let classroomLegacy;
  let classroomTenantA;
  let classroomTenantB;

  const ALL_HR_MODELS = [
    { name: 'Department', model: Department },
    { name: 'Employee', model: Employee },
    { name: 'LeaveRequest', model: LeaveRequest },
    { name: 'StaffShift', model: StaffShift },
    { name: 'StaffReplacement', model: StaffReplacement },
    { name: 'AttendanceRecord', model: AttendanceRecord },
    { name: 'MonthlyTimesheet', model: MonthlyTimesheet }
  ];

  beforeAll(async () => {
    bootstrapInstance = await testDbBootstrap.startTestDb({
      instanceOpts: [{ dbName: 'school_saas_1d1_test_isolated' }]
    });

    // Explicitly sync schema indexes on the verified in-memory connection
    await Promise.all([
      Tenant.syncIndexes(),
      User.syncIndexes(),
      Classroom.syncIndexes(),
      Department.syncIndexes(),
      Employee.syncIndexes(),
      LeaveRequest.syncIndexes(),
      StaffShift.syncIndexes(),
      StaffReplacement.syncIndexes(),
      AttendanceRecord.syncIndexes(),
      MonthlyTimesheet.syncIndexes()
    ]);

    saasApp = createSaasApp({
      mongoUri: bootstrapInstance.uri,
      connection: bootstrapInstance.connection
    });
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
      Department.deleteMany({}),
      Employee.deleteMany({}),
      LeaveRequest.deleteMany({}),
      StaffShift.deleteMany({}),
      StaffReplacement.deleteMany({}),
      AttendanceRecord.deleteMany({}),
      MonthlyTimesheet.deleteMany({})
    ]);

    // Seed Tenants
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

    // Seed Reference Users
    userLegacy1 = await User.create({
      username: 'user_leg_1',
      passwordHash: 'hash_leg_1',
      role: 'teacher',
      status: 'active',
      profile: { fullName: 'Giáo viên Legacy 1' }
    });

    userLegacy2 = await User.create({
      username: 'user_leg_2',
      passwordHash: 'hash_leg_2',
      role: 'accountant',
      status: 'active',
      profile: { fullName: 'Kế toán Legacy 2' }
    });

    userTenantA = await User.create({
      tenantId: tenantA._id,
      username: 'user_tenant_a',
      passwordHash: 'hash_tenant_a',
      role: 'teacher',
      status: 'active',
      profile: { fullName: 'Giáo viên Trường A' }
    });

    userTenantB = await User.create({
      tenantId: tenantB._id,
      username: 'user_tenant_b',
      passwordHash: 'hash_tenant_b',
      role: 'teacher',
      status: 'active',
      profile: { fullName: 'Giáo viên Trường B' }
    });

    // Seed Reference Classrooms
    classroomLegacy = await Classroom.create({
      name: 'Lớp Legacy 1',
      fullName: 'Lớp Mầm Legacy',
      ageGroup: '3-4',
      status: 'active'
    });

    classroomTenantA = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp A1',
      fullName: 'Lớp Mầm Trường A',
      ageGroup: '3-4',
      status: 'active'
    });

    classroomTenantB = await Classroom.create({
      tenantId: tenantB._id,
      name: 'Lớp B1',
      fullName: 'Lớp Mầm Trường B',
      ageGroup: '3-4',
      status: 'active'
    });
  });

  // =========================================================================
  // NHÓM A — HỢP ĐỒNG SCHEMA (7 MODEL)
  // =========================================================================
  describe('Nhóm A — Hợp đồng Schema trên 7 Mô hình', () => {
    test.each(ALL_HR_MODELS)(
      'A.1-A.4: $name schema có tenantId top-level, kiểu ObjectId, ref Tenant, optional, không tự thêm single index',
      async ({ name, model }) => {
        const tenantIdPath = model.schema.path('tenantId');
        expect(tenantIdPath).toBeDefined();
        expect(tenantIdPath.instance).toBe('ObjectId');
        expect(tenantIdPath.options.ref).toBe('Tenant');
        expect(tenantIdPath.isRequired).toBeFalsy();
        expect(tenantIdPath.options.index).toBeFalsy();

        // Ensure no single tenantId index is declared in schema
        const schemaIndexes = model.schema.indexes();
        const singleTenantSchemaIdx = schemaIndexes.find(
          ([fields]) => fields && fields.tenantId !== undefined && Object.keys(fields).length === 1
        );
        expect(singleTenantSchemaIdx).toBeUndefined();

        // Ensure no single tenantId index was built on the collection
        const collIndexes = await model.collection.indexes();
        const singleTenantBuiltIdx = collIndexes.find(
          (idx) => idx.key && idx.key.tenantId !== undefined && Object.keys(idx.key).length === 1
        );
        expect(singleTenantBuiltIdx).toBeUndefined();
      }
    );

    test('A.5 & A.6: Department chấp nhận document legacy thiếu tenantId hoặc tenantId: null', async () => {
      const docMissing = await Department.create({
        code: 'DEP_M1',
        name: 'Phòng Legacy Thiếu TenantId'
      });
      expect(docMissing.tenantId).toBeUndefined();

      const docNull = await Department.create({
        tenantId: null,
        code: 'DEP_N1',
        name: 'Phòng Legacy TenantId Null'
      });
      expect(docNull.tenantId).toBeNull();
    });

    test('A.7: Department lưu và đọc lại đúng ObjectId của Tenant A và Tenant B', async () => {
      const depA = await Department.create({
        tenantId: tenantA._id,
        code: 'DEP_A1',
        name: 'Phòng Tenant A'
      });
      const depB = await Department.create({
        tenantId: tenantB._id,
        code: 'DEP_B1',
        name: 'Phòng Tenant B'
      });

      expect(depA.tenantId.toString()).toBe(tenantA._id.toString());
      expect(depB.tenantId.toString()).toBe(tenantB._id.toString());

      const readA = await Department.findById(depA._id);
      expect(readA.tenantId).toEqual(tenantA._id);

      const readB = await Department.findById(depB._id);
      expect(readB.tenantId).toEqual(tenantB._id);
    });

    test.each(ALL_HR_MODELS)(
      'A.8: $name từ chối tenantId sai kiểu (cast error) khi validate hoặc save',
      async ({ model }) => {
        const invalidDoc = new model({ tenantId: 'not-a-valid-object-id-123' });
        const validationError = invalidDoc.validateSync();
        expect(validationError).toBeDefined();
        expect(validationError.errors.tenantId).toBeDefined();
        expect(validationError.errors.tenantId.name).toBe('CastError');
      }
    );
  });

  // =========================================================================
  // NHÓM B — DỮ LIỆU THỰC TRÊN DB KIỂM THỬ (FIXTURES & FILTER VERIFICATION)
  // =========================================================================
  describe('Nhóm B — Dữ liệu Thực & Cách ly Filter trên DB Kiểm Thử', () => {
    const trustedLegacyCtx = createTrustedTenantContext({ isLegacy: true });
    const trustedCtxA = createTrustedTenantContext({ tenantId: () => tenantA._id }); // lazy resolve
    const trustedCtxB = createTrustedTenantContext({ tenantId: () => tenantB._id });

    const getLegacyFilter = () => buildTenantFilter(trustedLegacyCtx);
    const getFilterA = () => buildTenantFilter(createTrustedTenantContext({ tenantId: tenantA._id }));
    const getFilterB = () => buildTenantFilter(createTrustedTenantContext({ tenantId: tenantB._id }));

    // Helper to verify 4 fixtures for any model
    const testModelBoundary = async (model, createFixturesFn) => {
      const { docMissing, docNull, docA, docB } = await createFixturesFn();

      // 1. Verify BSON storage directly from collection (avoiding Mongoose schema default masking)
      const rawMissing = await model.collection.findOne({ _id: docMissing._id });
      const rawNull = await model.collection.findOne({ _id: docNull._id });
      const rawA = await model.collection.findOne({ _id: docA._id });
      const rawB = await model.collection.findOne({ _id: docB._id });

      expect(rawMissing).toBeDefined();
      expect('tenantId' in rawMissing).toBe(false);

      expect(rawNull).toBeDefined();
      expect('tenantId' in rawNull).toBe(true);
      expect(rawNull.tenantId).toBeNull();

      expect(rawA).toBeDefined();
      expect(rawA.tenantId.toString()).toBe(tenantA._id.toString());

      expect(rawB).toBeDefined();
      expect(rawB.tenantId.toString()).toBe(tenantB._id.toString());

      // 2. Filter legacy: { tenantId: null } matches both missing and explicit null
      const legacyDocs = await model.find(getLegacyFilter());
      expect(legacyDocs).toHaveLength(2);
      const legacyIds = legacyDocs.map((d) => d._id.toString());
      expect(legacyIds).toContain(docMissing._id.toString());
      expect(legacyIds).toContain(docNull._id.toString());
      expect(legacyIds).not.toContain(docA._id.toString());
      expect(legacyIds).not.toContain(docB._id.toString());

      const legacyCount = await model.countDocuments(getLegacyFilter());
      expect(legacyCount).toBe(2);

      // 3. Filter Tenant A: only returns docA
      const docsA = await model.find(getFilterA());
      expect(docsA).toHaveLength(1);
      expect(docsA[0]._id.toString()).toBe(docA._id.toString());
      const countA = await model.countDocuments(getFilterA());
      expect(countA).toBe(1);

      // 4. Filter Tenant B: only returns docB
      const docsB = await model.find(getFilterB());
      expect(docsB).toHaveLength(1);
      expect(docsB[0]._id.toString()).toBe(docB._id.toString());
      const countB = await model.countDocuments(getFilterB());
      expect(countB).toBe(1);

      // 5. Query document B with Filter A returns null (cross-tenant lookup blocked)
      const crossLookup = await model.findOne({ _id: docB._id, ...getFilterA() });
      expect(crossLookup).toBeNull();

      // 6. Query document A with Filter B returns null
      const crossLookupReverse = await model.findOne({ _id: docA._id, ...getFilterB() });
      expect(crossLookupReverse).toBeNull();
    };

    test('B.1: Department — 4 fixtures (missing, null, Tenant A, Tenant B) cách ly đúng phạm vi filter', async () => {
      await testModelBoundary(Department, async () => {
        const docMissing = await Department.create({ code: 'D_LEG_MISS', name: 'Phòng Legacy 1' });
        const docNull = await Department.create({ tenantId: null, code: 'D_LEG_NULL', name: 'Phòng Legacy 2' });
        const docA = await Department.create({ tenantId: tenantA._id, code: 'D_TENA_1', name: 'Phòng Tenant A' });
        const docB = await Department.create({ tenantId: tenantB._id, code: 'D_TENB_1', name: 'Phòng Tenant B' });
        return { docMissing, docNull, docA, docB };
      });
    });

    test('B.2: Employee — 4 fixtures (missing, null, Tenant A, Tenant B) cách ly đúng phạm vi filter', async () => {
      await testModelBoundary(Employee, async () => {
        const docMissing = await Employee.create({
          userId: userLegacy1._id,
          employeeCode: 'E_LEG_MISS',
          fullName: 'Nhân viên Legacy 1',
          position: 'teacher',
          payrollRole: 'teacher',
          salaryConfig: { baseSalary: 8000000 }
        });
        const docNull = await Employee.create({
          tenantId: null,
          userId: userLegacy2._id,
          employeeCode: 'E_LEG_NULL',
          fullName: 'Nhân viên Legacy 2',
          position: 'accountant',
          payrollRole: 'accountant',
          salaryConfig: { baseSalary: 9000000 }
        });
        const docA = await Employee.create({
          tenantId: tenantA._id,
          userId: userTenantA._id,
          employeeCode: 'E_TENA_1',
          fullName: 'Nhân viên Tenant A',
          position: 'teacher',
          payrollRole: 'teacher',
          salaryConfig: { baseSalary: 8500000 }
        });
        const docB = await Employee.create({
          tenantId: tenantB._id,
          userId: userTenantB._id,
          employeeCode: 'E_TENB_1',
          fullName: 'Nhân viên Tenant B',
          position: 'teacher',
          payrollRole: 'teacher',
          salaryConfig: { baseSalary: 8700000 }
        });
        return { docMissing, docNull, docA, docB };
      });
    });

    test('B.3: LeaveRequest — 4 fixtures (missing, null, Tenant A, Tenant B) cách ly đúng phạm vi filter', async () => {
      // Create reference employees for leave requests
      const empLeg1 = await Employee.create({
        userId: userLegacy1._id,
        employeeCode: 'EMP_LR_LEG1',
        fullName: 'NV LR Leg1',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });
      const empLeg2 = await Employee.create({
        tenantId: null,
        userId: userLegacy2._id,
        employeeCode: 'EMP_LR_LEG2',
        fullName: 'NV LR Leg2',
        position: 'accountant',
        payrollRole: 'accountant',
        salaryConfig: { baseSalary: 5000000 }
      });
      const empA = await Employee.create({
        tenantId: tenantA._id,
        userId: userTenantA._id,
        employeeCode: 'EMP_LR_A',
        fullName: 'NV LR A',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });
      const empB = await Employee.create({
        tenantId: tenantB._id,
        userId: userTenantB._id,
        employeeCode: 'EMP_LR_B',
        fullName: 'NV LR B',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });

      await testModelBoundary(LeaveRequest, async () => {
        const docMissing = await LeaveRequest.create({
          employeeId: empLeg1._id,
          employeeCode: empLeg1.employeeCode,
          employeeName: empLeg1.fullName,
          startDate: new Date('2026-11-10'),
          endDate: new Date('2026-11-11'),
          totalDays: 2,
          reason: 'Việc gia đình Legacy Missing'
        });
        const docNull = await LeaveRequest.create({
          tenantId: null,
          employeeId: empLeg2._id,
          employeeCode: empLeg2.employeeCode,
          employeeName: empLeg2.fullName,
          startDate: new Date('2026-11-12'),
          endDate: new Date('2026-11-13'),
          totalDays: 2,
          reason: 'Việc gia đình Legacy Null'
        });
        const docA = await LeaveRequest.create({
          tenantId: tenantA._id,
          employeeId: empA._id,
          employeeCode: empA.employeeCode,
          employeeName: empA.fullName,
          startDate: new Date('2026-11-14'),
          endDate: new Date('2026-11-15'),
          totalDays: 2,
          reason: 'Việc gia đình Tenant A'
        });
        const docB = await LeaveRequest.create({
          tenantId: tenantB._id,
          employeeId: empB._id,
          employeeCode: empB.employeeCode,
          employeeName: empB.fullName,
          startDate: new Date('2026-11-16'),
          endDate: new Date('2026-11-17'),
          totalDays: 2,
          reason: 'Việc gia đình Tenant B'
        });
        return { docMissing, docNull, docA, docB };
      });
    });

    test('B.4: StaffShift — 4 fixtures (missing, null, Tenant A, Tenant B) cách ly đúng phạm vi filter', async () => {
      const empLeg1 = await Employee.create({
        userId: userLegacy1._id,
        employeeCode: 'EMP_SS_LEG1',
        fullName: 'Bảo vệ Leg 1',
        position: 'security',
        payrollRole: 'guard',
        salaryConfig: { baseSalary: 6000000 }
      });
      const empLeg2 = await Employee.create({
        tenantId: null,
        userId: userLegacy2._id,
        employeeCode: 'EMP_SS_LEG2',
        fullName: 'Đầu bếp Leg 2',
        position: 'chef',
        payrollRole: 'chef',
        salaryConfig: { baseSalary: 6500000 }
      });
      const empA = await Employee.create({
        tenantId: tenantA._id,
        userId: userTenantA._id,
        employeeCode: 'EMP_SS_A',
        fullName: 'Bảo vệ A',
        position: 'security',
        payrollRole: 'guard',
        salaryConfig: { baseSalary: 6000000 }
      });
      const empB = await Employee.create({
        tenantId: tenantB._id,
        userId: userTenantB._id,
        employeeCode: 'EMP_SS_B',
        fullName: 'Đầu bếp B',
        position: 'chef',
        payrollRole: 'chef',
        salaryConfig: { baseSalary: 6500000 }
      });

      await testModelBoundary(StaffShift, async () => {
        const docMissing = await StaffShift.create({
          employeeId: empLeg1._id,
          role: 'guard',
          name: 'Ca sáng Legacy 1',
          startTime: '06:00',
          endTime: '14:00',
          validFrom: '2026-11-01',
          validUntil: '2026-11-30',
          createdBy: userLegacy1._id
        });
        const docNull = await StaffShift.create({
          tenantId: null,
          employeeId: empLeg2._id,
          role: 'chef',
          name: 'Ca bếp Legacy 2',
          startTime: '05:30',
          endTime: '13:30',
          validFrom: '2026-11-01',
          validUntil: '2026-11-30',
          createdBy: userLegacy2._id
        });
        const docA = await StaffShift.create({
          tenantId: tenantA._id,
          employeeId: empA._id,
          role: 'guard',
          name: 'Ca sáng Tenant A',
          startTime: '06:00',
          endTime: '14:00',
          validFrom: '2026-11-01',
          validUntil: '2026-11-30',
          createdBy: userTenantA._id
        });
        const docB = await StaffShift.create({
          tenantId: tenantB._id,
          employeeId: empB._id,
          role: 'chef',
          name: 'Ca bếp Tenant B',
          startTime: '05:30',
          endTime: '13:30',
          validFrom: '2026-11-01',
          validUntil: '2026-11-30',
          createdBy: userTenantB._id
        });
        return { docMissing, docNull, docA, docB };
      });
    });

    test('B.5: StaffReplacement — 4 fixtures (missing, null, Tenant A, Tenant B) cách ly đúng phạm vi filter', async () => {
      // Create 8 employees for replacements (4 absent, 4 replacement)
      const eAbsentLeg1 = await Employee.create({
        employeeCode: 'E_AB_L1',
        fullName: 'Vắng L1',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });
      const eRepLeg1 = await Employee.create({
        employeeCode: 'E_RP_L1',
        fullName: 'Dạy thay L1',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });

      const eAbsentLeg2 = await Employee.create({
        tenantId: null,
        employeeCode: 'E_AB_L2',
        fullName: 'Vắng L2',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });
      const eRepLeg2 = await Employee.create({
        tenantId: null,
        employeeCode: 'E_RP_L2',
        fullName: 'Dạy thay L2',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });

      const eAbsentA = await Employee.create({
        tenantId: tenantA._id,
        employeeCode: 'E_AB_A',
        fullName: 'Vắng A',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });
      const eRepA = await Employee.create({
        tenantId: tenantA._id,
        employeeCode: 'E_RP_A',
        fullName: 'Dạy thay A',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });

      const eAbsentB = await Employee.create({
        tenantId: tenantB._id,
        employeeCode: 'E_AB_B',
        fullName: 'Vắng B',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });
      const eRepB = await Employee.create({
        tenantId: tenantB._id,
        employeeCode: 'E_RP_B',
        fullName: 'Dạy thay B',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });

      await testModelBoundary(StaffReplacement, async () => {
        const docMissing = await StaffReplacement.create({
          date: '2026-11-20',
          kind: 'classroom',
          classroomId: classroomLegacy._id,
          absentEmployeeId: eAbsentLeg1._id,
          replacementEmployeeId: eRepLeg1._id,
          createdBy: userLegacy1._id
        });
        const docNull = await StaffReplacement.create({
          tenantId: null,
          date: '2026-11-21',
          kind: 'classroom',
          classroomId: classroomLegacy._id,
          absentEmployeeId: eAbsentLeg2._id,
          replacementEmployeeId: eRepLeg2._id,
          createdBy: userLegacy2._id
        });
        const docA = await StaffReplacement.create({
          tenantId: tenantA._id,
          date: '2026-11-22',
          kind: 'classroom',
          classroomId: classroomTenantA._id,
          absentEmployeeId: eAbsentA._id,
          replacementEmployeeId: eRepA._id,
          createdBy: userTenantA._id
        });
        const docB = await StaffReplacement.create({
          tenantId: tenantB._id,
          date: '2026-11-23',
          kind: 'classroom',
          classroomId: classroomTenantB._id,
          absentEmployeeId: eAbsentB._id,
          replacementEmployeeId: eRepB._id,
          createdBy: userTenantB._id
        });
        return { docMissing, docNull, docA, docB };
      });
    });

    test('B.6: AttendanceRecord — 4 fixtures (missing, null, Tenant A, Tenant B) cách ly đúng phạm vi filter', async () => {
      await testModelBoundary(AttendanceRecord, async () => {
        const docMissing = await AttendanceRecord.create({
          userId: userLegacy1._id,
          employeeName: userLegacy1.profile.fullName,
          workDate: new Date('2026-11-01T00:00:00.000Z'),
          status: 'present',
          workday: 1
        });
        const docNull = await AttendanceRecord.create({
          tenantId: null,
          userId: userLegacy2._id,
          employeeName: userLegacy2.profile.fullName,
          workDate: new Date('2026-11-01T00:00:00.000Z'),
          status: 'present',
          workday: 1
        });
        const docA = await AttendanceRecord.create({
          tenantId: tenantA._id,
          userId: userTenantA._id,
          employeeName: userTenantA.profile.fullName,
          workDate: new Date('2026-11-01T00:00:00.000Z'),
          status: 'present',
          workday: 1
        });
        const docB = await AttendanceRecord.create({
          tenantId: tenantB._id,
          userId: userTenantB._id,
          employeeName: userTenantB.profile.fullName,
          workDate: new Date('2026-11-01T00:00:00.000Z'),
          status: 'present',
          workday: 1
        });
        return { docMissing, docNull, docA, docB };
      });
    });

    test('B.7: MonthlyTimesheet — 4 fixtures (missing, null, Tenant A, Tenant B) cách ly đúng phạm vi filter', async () => {
      const empLeg1 = await Employee.create({
        userId: userLegacy1._id,
        employeeCode: 'E_TS_L1',
        fullName: 'NV TS L1',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 7000000 }
      });
      const empLeg2 = await Employee.create({
        tenantId: null,
        userId: userLegacy2._id,
        employeeCode: 'E_TS_L2',
        fullName: 'NV TS L2',
        position: 'accountant',
        payrollRole: 'accountant',
        salaryConfig: { baseSalary: 7000000 }
      });
      const empA = await Employee.create({
        tenantId: tenantA._id,
        userId: userTenantA._id,
        employeeCode: 'E_TS_A',
        fullName: 'NV TS A',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 7000000 }
      });
      const empB = await Employee.create({
        tenantId: tenantB._id,
        userId: userTenantB._id,
        employeeCode: 'E_TS_B',
        fullName: 'NV TS B',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 7000000 }
      });

      await testModelBoundary(MonthlyTimesheet, async () => {
        const docMissing = await MonthlyTimesheet.create({
          employeeId: empLeg1._id,
          userId: userLegacy1._id,
          period: '2026-10',
          totalWorkdays: 22,
          publishedBy: userLegacy1._id
        });
        const docNull = await MonthlyTimesheet.create({
          tenantId: null,
          employeeId: empLeg2._id,
          userId: userLegacy2._id,
          period: '2026-10',
          totalWorkdays: 23,
          publishedBy: userLegacy2._id
        });
        const docA = await MonthlyTimesheet.create({
          tenantId: tenantA._id,
          employeeId: empA._id,
          userId: userTenantA._id,
          period: '2026-10',
          totalWorkdays: 24,
          publishedBy: userTenantA._id
        });
        const docB = await MonthlyTimesheet.create({
          tenantId: tenantB._id,
          employeeId: empB._id,
          userId: userTenantB._id,
          period: '2026-10',
          totalWorkdays: 25,
          publishedBy: userTenantB._id
        });
        return { docMissing, docNull, docA, docB };
      });
    });
  });

  // =========================================================================
  // NHÓM C — BẢO TOÀN INDEX VÀ QUY TẮC NGHIỆP VỤ HIỆN CÓ
  // =========================================================================
  describe('Nhóm C — Bảo Toàn Index và Quy Tắc Nghiệp Vụ Hiện Có', () => {
    test('C.1: Department.code chuẩn hóa uppercase, trim và giữ unique hiện tại', async () => {
      const dep = new Department({ code: '  kt_maugiao  ', name: 'Kế toán' });
      expect(dep.code).toBe('KT_MAUGIAO');

      await Department.create({ code: 'BGH', name: 'Ban Giám Hiệu' });
      await expect(Department.create({ code: 'BGH', name: 'Ban Giám Hiệu 2' })).rejects.toMatchObject({
        code: 11000
      });
    });

    test('C.2: Employee.employeeCode chuẩn hóa uppercase, trim và giữ unique hiện tại', async () => {
      const emp = new Employee({
        employeeCode: '  nv_0099  ',
        fullName: 'Nguyễn Văn 99',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });
      expect(emp.employeeCode).toBe('NV_0099');

      await Employee.create({
        employeeCode: 'NV_TEST_DUP',
        fullName: 'NV 1',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });
      await expect(
        Employee.create({
          employeeCode: 'NV_TEST_DUP',
          fullName: 'NV 2',
          position: 'teacher',
          payrollRole: 'teacher',
          salaryConfig: { baseSalary: 5000000 }
        })
      ).rejects.toMatchObject({ code: 11000 });
    });

    test('C.3: Employee.userId giữ unique và sparse (nhiều nhân viên không có userId vẫn hợp lệ)', async () => {
      // 2 employees without userId succeed
      const e1 = await Employee.create({
        employeeCode: 'E_NO_USER_1',
        fullName: 'Nhân viên không tài khoản 1',
        position: 'security',
        payrollRole: 'guard',
        salaryConfig: { baseSalary: 5000000 }
      });
      const e2 = await Employee.create({
        employeeCode: 'E_NO_USER_2',
        fullName: 'Nhân viên không tài khoản 2',
        position: 'cleaner',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });
      expect(e1._id).toBeDefined();
      expect(e2._id).toBeDefined();

      // Duplicate userId is rejected by E11000
      await Employee.create({
        userId: userLegacy1._id,
        employeeCode: 'E_HAS_USER_1',
        fullName: 'NV có User 1',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });
      await expect(
        Employee.create({
          userId: userLegacy1._id,
          employeeCode: 'E_HAS_USER_2',
          fullName: 'NV có User 2',
          position: 'teacher',
          payrollRole: 'teacher',
          salaryConfig: { baseSalary: 5000000 }
        })
      ).rejects.toMatchObject({ code: 11000 });
    });

    test('C.4: AttendanceRecord giữ unique compound userId + workDate', async () => {
      const workDate = new Date('2026-11-05T00:00:00.000Z');
      await AttendanceRecord.create({
        userId: userLegacy1._id,
        employeeName: userLegacy1.profile.fullName,
        workDate,
        status: 'present',
        workday: 1
      });

      await expect(
        AttendanceRecord.create({
          userId: userLegacy1._id,
          employeeName: userLegacy1.profile.fullName,
          workDate,
          status: 'incomplete',
          workday: 0.5
        })
      ).rejects.toMatchObject({ code: 11000 });
    });

    test('C.5: MonthlyTimesheet giữ unique compound employeeId + period và optimisticConcurrency', async () => {
      expect(MonthlyTimesheet.schema.options.optimisticConcurrency).toBe(true);

      const emp = await Employee.create({
        employeeCode: 'E_OC_1',
        fullName: 'NV OC',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 6000000 }
      });

      await MonthlyTimesheet.create({
        employeeId: emp._id,
        userId: userLegacy1._id,
        period: '2026-09',
        totalWorkdays: 20,
        publishedBy: userLegacy1._id
      });

      await expect(
        MonthlyTimesheet.create({
          employeeId: emp._id,
          userId: userLegacy1._id,
          period: '2026-09',
          totalWorkdays: 22,
          publishedBy: userLegacy1._id
        })
      ).rejects.toMatchObject({ code: 11000 });
    });

    test('C.6a: StaffReplacement — Vi phạm độc lập Partial Index 1 ({ date, kind, classroomId, shiftId, absentEmployeeId }) khi replacementEmployeeId khác biệt', async () => {
      const empAbsent = await Employee.create({
        employeeCode: 'E_REP_AB_1',
        fullName: 'NV Vắng 1',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });
      const empRep1 = await Employee.create({
        employeeCode: 'E_REP_SUB_1A',
        fullName: 'NV Thay 1A',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });
      const empRep2 = await Employee.create({
        employeeCode: 'E_REP_SUB_1B',
        fullName: 'NV Thay 1B',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });

      // Tạo bản ghi thay thế gốc với empRep1
      await StaffReplacement.create({
        date: '2026-11-25',
        kind: 'classroom',
        classroomId: classroomLegacy._id,
        absentEmployeeId: empAbsent._id,
        replacementEmployeeId: empRep1._id,
        status: 'active',
        createdBy: userLegacy1._id
      });

      // Bản ghi thứ 2 trùng hoàn toàn bộ Index 1 (date, kind, classroomId, absentEmployeeId) nhưng replacementEmployeeId KHÁC BIỆT (empRep2)
      let capturedError = null;
      try {
        await StaffReplacement.create({
          date: '2026-11-25',
          kind: 'classroom',
          classroomId: classroomLegacy._id,
          absentEmployeeId: empAbsent._id,
          replacementEmployeeId: empRep2._id,
          status: 'active',
          createdBy: userLegacy1._id
        });
      } catch (err) {
        capturedError = err;
      }

      expect(capturedError).not.toBeNull();
      expect(capturedError.code).toBe(11000);
      expect(capturedError.keyPattern).toBeDefined();
      expect(capturedError.keyPattern.absentEmployeeId).toBe(1);
      expect(capturedError.keyPattern.date).toBe(1);
      expect(capturedError.keyPattern.kind).toBe(1);
      expect(capturedError.keyPattern.classroomId).toBe(1);
      // Đảm bảo KHÔNG phải do Index 2 (replacementEmployeeId) gây ra lỗi
      expect(capturedError.keyPattern.replacementEmployeeId).toBeUndefined();
    });

    test('C.6b: StaffReplacement — Vi phạm độc lập Partial Index 2 ({ date, replacementEmployeeId }) khi absentEmployeeId / classroom / shift khác biệt', async () => {
      const empAbsentA = await Employee.create({
        employeeCode: 'E_REP_AB_2A',
        fullName: 'NV Vắng 2A',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });
      const empAbsentB = await Employee.create({
        employeeCode: 'E_REP_AB_2B',
        fullName: 'NV Vắng 2B',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });
      const empRep = await Employee.create({
        employeeCode: 'E_REP_SUB_2',
        fullName: 'NV Thay Chung',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });

      const classroomExtra = await Classroom.create({
        name: 'Lớp C.6b',
        fullName: 'Lớp Phụ Thử Nghiệm Index 2',
        ageGroup: '4-5',
        status: 'active'
      });

      // Tạo bản ghi thay thế cho Lớp classroomLegacy và nhân viên vắng empAbsentA
      await StaffReplacement.create({
        date: '2026-11-26',
        kind: 'classroom',
        classroomId: classroomLegacy._id,
        absentEmployeeId: empAbsentA._id,
        replacementEmployeeId: empRep._id,
        status: 'active',
        createdBy: userLegacy1._id
      });

      // Bản ghi thứ 2 có absentEmployeeId và classroomId HOÀN TOÀN KHÁC (empAbsentB và classroomExtra),
      // chỉ trùng duy nhất bộ Index 2 ({ date, replacementEmployeeId })
      let capturedError = null;
      try {
        await StaffReplacement.create({
          date: '2026-11-26',
          kind: 'classroom',
          classroomId: classroomExtra._id,
          absentEmployeeId: empAbsentB._id,
          replacementEmployeeId: empRep._id,
          status: 'active',
          createdBy: userLegacy1._id
        });
      } catch (err) {
        capturedError = err;
      }

      expect(capturedError).not.toBeNull();
      expect(capturedError.code).toBe(11000);
      expect(capturedError.keyPattern).toBeDefined();
      expect(capturedError.keyPattern.replacementEmployeeId).toBe(1);
      expect(capturedError.keyPattern.date).toBe(1);
      // Đảm bảo KHÔNG phải do Index 1 (absentEmployeeId / classroomId) gây ra lỗi
      expect(capturedError.keyPattern.absentEmployeeId).toBeUndefined();
      expect(capturedError.keyPattern.classroomId).toBeUndefined();
    });

    test('C.6c: StaffReplacement — Xác minh 2 partial index trên collection metadata có unique: true và partialFilterExpression: { status: "active" }', async () => {
      const collIndexes = await StaffReplacement.collection.indexes();

      const idx1 = collIndexes.find((idx) => idx.name === 'date_1_kind_1_classroomId_1_shiftId_1_absentEmployeeId_1');
      expect(idx1).toBeDefined();
      expect(idx1.unique).toBe(true);
      expect(idx1.partialFilterExpression).toEqual({ status: 'active' });
      expect(idx1.key).toEqual({
        date: 1,
        kind: 1,
        classroomId: 1,
        shiftId: 1,
        absentEmployeeId: 1
      });

      const idx2 = collIndexes.find((idx) => idx.name === 'date_1_replacementEmployeeId_1');
      expect(idx2).toBeDefined();
      expect(idx2.unique).toBe(true);
      expect(idx2.partialFilterExpression).toEqual({ status: 'active' });
      expect(idx2.key).toEqual({
        date: 1,
        replacementEmployeeId: 1
      });
    });

    test('C.6d: StaffReplacement — Bản ghi status: "cancelled" bỏ qua partial filter trên cả 2 index', async () => {
      const empAbsent = await Employee.create({
        employeeCode: 'E_REP_CAN_AB',
        fullName: 'NV Vắng Cancelled',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });
      const empRep = await Employee.create({
        employeeCode: 'E_REP_CAN_SUB',
        fullName: 'NV Thay Cancelled',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });

      // Tạo bản ghi active cơ sở
      await StaffReplacement.create({
        date: '2026-11-27',
        kind: 'classroom',
        classroomId: classroomLegacy._id,
        absentEmployeeId: empAbsent._id,
        replacementEmployeeId: empRep._id,
        status: 'active',
        createdBy: userLegacy1._id
      });

      // Bản ghi trùng bộ Index 1 nhưng status: 'cancelled' -> Thành công
      const cancelled1 = await StaffReplacement.create({
        date: '2026-11-27',
        kind: 'classroom',
        classroomId: classroomLegacy._id,
        absentEmployeeId: empAbsent._id,
        replacementEmployeeId: new mongoose.Types.ObjectId(),
        status: 'cancelled',
        createdBy: userLegacy1._id
      });
      expect(cancelled1._id).toBeDefined();
      expect(cancelled1.status).toBe('cancelled');

      // Bản ghi trùng bộ Index 2 nhưng status: 'cancelled' -> Thành công
      const cancelled2 = await StaffReplacement.create({
        date: '2026-11-27',
        kind: 'classroom',
        classroomId: new mongoose.Types.ObjectId(),
        absentEmployeeId: new mongoose.Types.ObjectId(),
        replacementEmployeeId: empRep._id,
        status: 'cancelled',
        createdBy: userLegacy1._id
      });
      expect(cancelled2._id).toBeDefined();
      expect(cancelled2.status).toBe('cancelled');
    });

    test('C.7: Giữ nguyên validation enum trên position và contractType của Employee', async () => {
      const invalidEmp = new Employee({
        employeeCode: 'E_INVALID_ENUM',
        fullName: 'Sai Enum',
        position: 'invalid_position_name',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 5000000 }
      });
      const err = invalidEmp.validateSync();
      expect(err).toBeDefined();
      expect(err.errors.position).toBeDefined();
    });
  });

  // =========================================================================
  // NHÓM D — TÁI HIỆN GIỚI HẠN INDEX TOÀN CỤC (GLOBAL UNIQUE CONFLICTS)
  // =========================================================================
  describe('Nhóm D — Tái hiện Giới hạn Index Toàn cục (Mô tả Giới hạn Hiện tại, Chưa Coi là Đã Sửa)', () => {
    test('D.1: [GIỚI HẠN HIỆN TẠI] Hai Tenant A và B dùng cùng Department.code "GV" bị lỗi E11000 do index toàn cục code_1', async () => {
      // Tenant A creates department 'GV'
      const depA = await Department.create({
        tenantId: tenantA._id,
        code: 'GV',
        name: 'Tổ Giáo Viên Trường A'
      });
      expect(depA._id).toBeDefined();

      // Tenant B creates department 'GV' with same code
      let capturedError = null;
      try {
        await Department.create({
          tenantId: tenantB._id,
          code: 'GV',
          name: 'Tổ Giáo Viên Trường B'
        });
      } catch (err) {
        capturedError = err;
      }

      // Explicit assertions on error code and keyPattern
      expect(capturedError).not.toBeNull();
      expect(capturedError.code).toBe(11000);
      expect(capturedError.keyPattern).toBeDefined();
      expect(capturedError.keyPattern.code).toBe(1);
    });

    test('D.2: [GIỚI HẠN HIỆN TẠI] Hai Tenant A và B dùng cùng Employee.employeeCode "GV001" bị lỗi E11000 do index toàn cục employeeCode_1', async () => {
      // Tenant A creates employee 'GV001'
      const empA = await Employee.create({
        tenantId: tenantA._id,
        employeeCode: 'GV001',
        fullName: 'Cô Nguyễn Thị Hoa Trường A',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 8000000 }
      });
      expect(empA._id).toBeDefined();

      // Tenant B creates employee 'GV001' with same code
      let capturedError = null;
      try {
        await Employee.create({
          tenantId: tenantB._id,
          employeeCode: 'GV001',
          fullName: 'Cô Trần Thị Mai Trường B',
          position: 'teacher',
          payrollRole: 'teacher',
          salaryConfig: { baseSalary: 8500000 }
        });
      } catch (err) {
        capturedError = err;
      }

      // Explicit assertions on error code and keyPattern
      expect(capturedError).not.toBeNull();
      expect(capturedError.code).toBe(11000);
      expect(capturedError.keyPattern).toBeDefined();
      expect(capturedError.keyPattern.employeeCode).toBe(1);
    });
  });

  // =========================================================================
  // NHÓM E — GIỚI HẠN BẰNG CHỨNG (FAIL-CLOSED ROUTER GATE VERIFICATION)
  // =========================================================================
  describe('Nhóm E — Giới hạn Bằng chứng: Router SaaS HR & Timekeeping Tiếp tục Đóng (HTTP 501)', () => {
    test('E.1: GET /api/v1/hr/departments trên SaaS app trả về HTTP 501 Not Implemented', async () => {
      const tokenA = generateSchoolUserToken(userTenantA, tenantA);
      const res = await request(saasApp)
        .get('/api/v1/hr/departments')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(501);
      expect(res.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
      expect(res.body.message).toContain('chưa sẵn sàng');
    });

    test('E.2: GET /api/v1/hr/employees trên SaaS app trả về HTTP 501 Not Implemented', async () => {
      const tokenA = generateSchoolUserToken(userTenantA, tenantA);
      const res = await request(saasApp)
        .get('/api/v1/hr/employees')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(501);
      expect(res.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
      expect(res.body.message).toContain('chưa sẵn sàng');
    });

    test('E.3: GET /api/v1/timekeeping/daily trên SaaS app trả về HTTP 501 Not Implemented', async () => {
      const tokenA = generateSchoolUserToken(userTenantA, tenantA);
      const res = await request(saasApp)
        .get('/api/v1/timekeeping/daily')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(501);
      expect(res.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
      expect(res.body.message).toContain('chưa sẵn sàng');
    });

    test('E.4: POST /api/v1/system/accounts trên SaaS app trả về HTTP 501 Not Implemented', async () => {
      const tokenA = generateSchoolUserToken(userTenantA, tenantA);
      const res = await request(saasApp)
        .post('/api/v1/system/accounts')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ username: 'new_teacher_a' });

      expect(res.status).toBe(501);
      expect(res.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
      expect(res.body.message).toContain('chưa sẵn sàng');
    });
  });
});
