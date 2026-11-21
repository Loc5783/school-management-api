/**
 * Phase 1E.1 Data Boundary & Multi-Tenant Finance Foundation Test Suite
 *
 * File: backend/tests/saas/phase1e1_data_boundary.test.js
 *
 * Verifies the foundational data layer and index decisions for SaaS Phase 1E:
 * - Nhóm A: Schema 10 model Zone 4 Finance có top-level tenantId, optional, no default, ref 'Tenant'.
 * - Nhóm B: Tạo fixture thực tế cho cả 10 model (Legacy missing, Legacy null, Tenant A, Tenant B).
 * - Nhóm C: Ranh giới lọc dữ liệu với buildTenantFilter (Tenant A chỉ khớp A, B chỉ khớp B, Legacy chỉ khớp null/missing).
 * - Nhóm D: Bảo toàn nghiệp vụ và các index hiện hữu (unique, partial, sparse, validation số tiền âm/enum).
 * - Nhóm E: Tái hiện giới hạn va chạm mã/kỳ toàn cục (Global Unique) giữa các trường A và B.
 * - Nhóm F: Thử nghiệm và kiểm chứng cú pháp MongoDB của Index đề xuất (compound partial index) trên collection tạm.
 * - Nhóm G: Kiểm soát router SaaS và gating fail-closed của module tài chính.
 */

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';

jest.setTimeout(90000);

const mongoose = require('mongoose');
const request = require('supertest');

const testDbBootstrap = require('../../src/saas/testDbBootstrap');
const createSaasApp = require('../../src/saas/createSaasApp');
const { createTrustedTenantContext, buildTenantFilter } = require('../../src/services/tenantFilterService');
const { generateSchoolUserToken } = require('../../src/saas/utils/saasJwt');

// System & School models
const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const Classroom = require('../../src/models/zone3_school/Classroom');
const Student = require('../../src/models/zone3_school/Student');

// 10 Finance Models in zone4_finance
const AccountingPeriod = require('../../src/models/zone4_finance/AccountingPeriod');
const DailyCashReconciliation = require('../../src/models/zone4_finance/DailyCashReconciliation');
const FeeSchedule = require('../../src/models/zone4_finance/FeeSchedule');
const InvoiceAdjustment = require('../../src/models/zone4_finance/InvoiceAdjustment');
const OperatingExpense = require('../../src/models/zone4_finance/OperatingExpense');
const OperatingExpenseRequest = require('../../src/models/zone4_finance/OperatingExpenseRequest');
const Payment = require('../../src/models/zone4_finance/Payment');
const PurchaseExpense = require('../../src/models/zone4_finance/PurchaseExpense');
const TuitionFee = require('../../src/models/zone4_finance/TuitionFee');
const TuitionRefundRequest = require('../../src/models/zone4_finance/TuitionRefundRequest');

describe('SaaS Phase 1E.1 — Nền Dữ Liệu & Thiết Kế Index Tài Chính Đa Trường', () => {
  let bootstrapInstance;
  let mongoUri;
  let app1d;
  let tenantA;
  let tenantB;
  let userA;
  let userB;
  let classroomA;
  let classroomB;
  let studentA;
  let studentB;

  const ALL_FINANCE_MODELS = [
    { name: 'AccountingPeriod', model: AccountingPeriod, colName: 'accountingperiods' },
    { name: 'DailyCashReconciliation', model: DailyCashReconciliation, colName: 'dailycashreconciliations' },
    { name: 'FeeSchedule', model: FeeSchedule, colName: 'feeschedules' },
    { name: 'InvoiceAdjustment', model: InvoiceAdjustment, colName: 'invoiceadjustments' },
    { name: 'OperatingExpense', model: OperatingExpense, colName: 'operatingexpenses' },
    { name: 'OperatingExpenseRequest', model: OperatingExpenseRequest, colName: 'operatingexpenserequests' },
    { name: 'Payment', model: Payment, colName: 'payments' },
    { name: 'PurchaseExpense', model: PurchaseExpense, colName: 'purchaseexpenses' },
    { name: 'TuitionFee', model: TuitionFee, colName: 'tuitionfees' },
    { name: 'TuitionRefundRequest', model: TuitionRefundRequest, colName: 'tuitionrefundrequests' }
  ];

  beforeAll(async () => {
    bootstrapInstance = await testDbBootstrap.startTestDb({
      instanceOpts: [{ dbName: 'school_saas_1e1_test_isolated' }]
    });
    mongoUri = bootstrapInstance.mongoUri;

    // Sync schema indexes on memory repl set
    await Promise.all([
      Tenant.syncIndexes(),
      User.syncIndexes(),
      Classroom.syncIndexes(),
      Student.syncIndexes(),
      AccountingPeriod.syncIndexes(),
      DailyCashReconciliation.syncIndexes(),
      FeeSchedule.syncIndexes(),
      InvoiceAdjustment.syncIndexes(),
      OperatingExpense.syncIndexes(),
      OperatingExpenseRequest.syncIndexes(),
      Payment.syncIndexes(),
      PurchaseExpense.syncIndexes(),
      TuitionFee.syncIndexes(),
      TuitionRefundRequest.syncIndexes()
    ]);

    app1d = createSaasApp({
      mongoUri,
      connection: bootstrapInstance.connection,
      saasMode: 'phase1d'
    });
  });

  afterAll(async () => {
    if (bootstrapInstance) {
      await bootstrapInstance.stop();
    }
  });

  beforeEach(async () => {
    // Clear all collections
    const collectionsToClear = [
      Tenant, User, Classroom, Student,
      AccountingPeriod, DailyCashReconciliation, FeeSchedule, InvoiceAdjustment,
      OperatingExpense, OperatingExpenseRequest, Payment, PurchaseExpense,
      TuitionFee, TuitionRefundRequest
    ];
    for (const m of collectionsToClear) {
      await m.deleteMany({});
    }

    // Seed tenants
    tenantA = await Tenant.create({
      code: 'TRUONG-A',
      name: 'Trường Mầm Non Họa Mi A',
      status: 'active',
      authVersion: 1
    });

    tenantB = await Tenant.create({
      code: 'TRUONG-B',
      name: 'Trường Mầm Non Ban Mai B',
      status: 'active',
      authVersion: 1
    });

    // Seed users
    userA = await User.create({
      username: 'accountant_a',
      email: 'accountant@school-a.edu.vn',
      passwordHash: 'valid-hash-password',
      role: 'accountant',
      tenantId: tenantA._id,
      status: 'active',
      authVersion: 1,
      profile: { fullName: 'Kế toán Trường A' }
    });

    userB = await User.create({
      username: 'accountant_b',
      email: 'accountant@school-b.edu.vn',
      passwordHash: 'valid-hash-password',
      role: 'accountant',
      tenantId: tenantB._id,
      status: 'active',
      authVersion: 1,
      profile: { fullName: 'Kế toán Trường B' }
    });

    // Seed classrooms
    classroomA = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Mầm 1A',
      schoolYear: '2026-2027',
      ageGroup: '3-4',
      maxSize: 30,
      status: 'active'
    });

    classroomB = await Classroom.create({
      tenantId: tenantB._id,
      name: 'Lớp Mầm 1B',
      schoolYear: '2026-2027',
      ageGroup: '3-4',
      maxSize: 30,
      status: 'active'
    });

    // Seed students
    studentA = await Student.create({
      tenantId: tenantA._id,
      studentCode: 'HS-2026-000001',
      fullName: 'Học sinh Trường A',
      birthDate: new Date('2022-01-01'),
      gender: 'male',
      classroomId: classroomA._id,
      status: 'enrolled'
    });

    studentB = await Student.create({
      tenantId: tenantB._id,
      studentCode: 'HS-2026-000002',
      fullName: 'Học sinh Trường B',
      birthDate: new Date('2022-02-02'),
      gender: 'female',
      classroomId: classroomB._id,
      status: 'enrolled'
    });
  });

  // Helper: Tạo payload mẫu tối thiểu hợp lệ theo schema của từng model
  const createValidPayload = (modelName, customProps = {}) => {
    switch (modelName) {
      case 'AccountingPeriod':
        return {
          month: customProps.month || '2026-01',
          status: 'open',
          revision: 1,
          writeVersion: 0,
          snapshot: { total: 0 },
          sourceHash: 'sample-hash-01',
          ...customProps
        };
      case 'DailyCashReconciliation':
        return {
          workDate: customProps.workDate || '2026-01-01',
          actual: { cashIn: 1000, cashOut: 0, bankIn: 0, bankOut: 0, walletIn: 0, walletOut: 0 },
          bookSnapshot: { cashIn: 1000, cashOut: 0, bankIn: 0, bankOut: 0, walletIn: 0, walletOut: 0 },
          sourceSignature: 'sig-01',
          evidenceReference: 'EV-001',
          revision: 1,
          recordedBy: userA._id,
          recordedByName: 'Kế toán A',
          ...customProps
        };
      case 'FeeSchedule':
        return {
          period: customProps.period || '01-2026',
          classroomId: customProps.classroomId !== undefined ? customProps.classroomId : classroomA._id,
          tuitionBase: 2000000,
          dueDate: new Date('2026-01-20'),
          ...customProps
        };
      case 'InvoiceAdjustment':
        return {
          invoiceId: customProps.invoiceId || new mongoose.Types.ObjectId(),
          type: 'discount',
          amount: 100000,
          reason: 'Miễn giảm con giáo viên',
          recordedBy: userA._id,
          recordedByName: 'Kế toán A',
          idempotencyKey: customProps.idempotencyKey || `adj-idem-${new mongoose.Types.ObjectId()}`,
          ...customProps
        };
      case 'OperatingExpense':
        return {
          category: 'utilities',
          payee: 'Công ty Điện lực',
          description: 'Thanh toán tiền điện',
          amount: 500000,
          paidAt: new Date('2026-01-10'),
          method: 'cash',
          documentNumber: customProps.documentNumber || `PC-${new mongoose.Types.ObjectId()}`,
          approvalReference: 'APR-REF-01',
          idempotencyKey: customProps.idempotencyKey || `op-idem-${new mongoose.Types.ObjectId()}`,
          recordedBy: userA._id,
          recordedByName: 'Kế toán A',
          ...customProps
        };
      case 'OperatingExpenseRequest':
        return {
          category: 'utilities',
          payee: 'Công ty Cấp nước',
          description: 'Đề nghị duyệt chi tiền nước',
          amount: 300000,
          status: 'pending',
          requestKey: customProps.requestKey || `req-key-${new mongoose.Types.ObjectId()}`,
          requestedBy: userA._id,
          requestedByName: 'Kế toán A',
          ...customProps
        };
      case 'Payment':
        return {
          invoiceId: customProps.invoiceId || new mongoose.Types.ObjectId(),
          amount: 1500000,
          method: 'bank_transfer',
          receiptNumber: customProps.receiptNumber || `PT-${new mongoose.Types.ObjectId().toString().slice(-8).toUpperCase()}`,
          idempotencyKey: customProps.idempotencyKey || `pay-idem-${new mongoose.Types.ObjectId()}`,
          recordedBy: userA._id,
          ...customProps
        };
      case 'PurchaseExpense':
        return {
          orderId: customProps.orderId || new mongoose.Types.ObjectId(),
          orderCode: 'PO-2026-001',
          supplierName: 'Nhà sách Giáo dục',
          amount: 450000,
          paidAt: new Date('2026-01-12'),
          method: 'bank_transfer',
          documentNumber: customProps.documentNumber || `PC-PUR-${new mongoose.Types.ObjectId()}`,
          recordedBy: userA._id,
          recordedByName: 'Kế toán A',
          idempotencyKey: customProps.idempotencyKey || `pur-idem-${new mongoose.Types.ObjectId()}`,
          ...customProps
        };
      case 'TuitionFee':
        return {
          studentId: customProps.studentId || studentA._id,
          studentName: 'Học sinh A',
          classroomId: customProps.classroomId || classroomA._id,
          className: 'Lớp Mầm 1A',
          period: customProps.period || '01-2026',
          tuitionBase: 2500000,
          totalAmount: 2500000,
          dueDate: new Date('2026-01-25'),
          status: 'unpaid',
          ...customProps
        };
      case 'TuitionRefundRequest':
        return {
          invoiceId: customProps.invoiceId || new mongoose.Types.ObjectId(),
          amount: 200000,
          reason: 'Hoàn phí chuyển trường',
          status: 'pending',
          requestedBy: userA._id,
          requestedByName: 'Kế toán A',
          ...customProps
        };
      default:
        throw new Error(`Unknown model: ${modelName}`);
    }
  };

  // =========================================================================
  // NHÓM A: SCHEMA CỦA CẢ 10 MODEL TÀI CHÍNH
  // =========================================================================
  describe('Nhóm A: Khảo sát Schema 10 Model Tài Chính (Hợp đồng tenantId)', () => {
    test.each(ALL_FINANCE_MODELS)(
      'A.1 Model %s có trường top-level tenantId là ObjectId tham chiếu Tenant',
      ({ model }) => {
        const tenantPath = model.schema.path('tenantId');
        expect(tenantPath).toBeDefined();
        expect(tenantPath.instance).toBe('ObjectId');
        expect(tenantPath.options.ref).toBe('Tenant');
      }
    );

    test.each(ALL_FINANCE_MODELS)(
      'A.2 Model %s: tenantId là optional, không có default value, không required',
      ({ model }) => {
        const tenantPath = model.schema.path('tenantId');
        expect(tenantPath.defaultValue).toBeUndefined();
        expect(tenantPath.isRequired).toBeFalsy();
      }
    );

    test.each(ALL_FINANCE_MODELS)(
      'A.3 Model %s: schema không tự khai báo single index riêng lẻ trên tenantId',
      ({ model }) => {
        const indexes = model.schema.indexes();
        const hasSingleTenantIdIndex = indexes.some(
          ([keys]) => Object.keys(keys).length === 1 && keys.tenantId === 1
        );
        expect(hasSingleTenantIdIndex).toBe(false);
      }
    );

    test.each(ALL_FINANCE_MODELS)(
      'A.4 Model %s: truyền tenantId sai kiểu (string không phải ObjectId) sẽ bị CastError/ValidationError',
      async ({ name, model }) => {
        const payload = createValidPayload(name, { tenantId: 'not-a-valid-hex-object-id' });
        let error = null;
        try {
          await model.create(payload);
        } catch (err) {
          error = err;
        }
        expect(error).not.toBeNull();
        expect(['CastError', 'ValidationError']).toContain(error.name);
      }
    );

    test.each(ALL_FINANCE_MODELS)(
      'A.5 Model %s: dữ liệu thiếu tenantId hoặc tenantId: null vẫn hợp lệ (Legacy compatibility)',
      async ({ name, model }) => {
        // Missing tenantId
        const payloadMissing = createValidPayload(name);
        delete payloadMissing.tenantId;
        const docMissing = await model.create(payloadMissing);
        expect(docMissing._id).toBeDefined();

        // Null tenantId
        const payloadNull = createValidPayload(name, {
          // đảm bảo khóa nghiệp vụ khác để tránh trùng unique cũ
          month: '2026-02',
          workDate: '2026-01-02',
          period: '02-2026',
          documentNumber: `PC-NULL-${new mongoose.Types.ObjectId()}`,
          idempotencyKey: `idem-null-${new mongoose.Types.ObjectId()}`,
          requestKey: `req-null-${new mongoose.Types.ObjectId()}`,
          receiptNumber: `PT-NULL-${new mongoose.Types.ObjectId().toString().slice(-8).toUpperCase()}`,
          studentId: new mongoose.Types.ObjectId(),
          invoiceId: new mongoose.Types.ObjectId(),
          orderId: new mongoose.Types.ObjectId(),
          tenantId: null
        });
        const docNull = await model.create(payloadNull);
        expect(docNull._id).toBeDefined();
        expect(docNull.tenantId).toBeNull();
      }
    );

    test.each(ALL_FINANCE_MODELS)(
      'A.6 Model %s: xác minh metadata index thật trên schema và collection (đối chiếu unique/sparse/partial)',
      async ({ name, model, colName }) => {
        const schemaIndexes = model.schema.indexes();
        const rawCollection = bootstrapInstance.connection.db.collection(colName);
        const colIndexes = await rawCollection.indexes();

        // 1. Luôn có index mặc định _id_
        expect(colIndexes.some((idx) => idx.name === '_id_')).toBe(true);

        // 2. Không có index nào chứa tenantId ở mức single index
        expect(colIndexes.some((idx) => idx.name === 'tenantId_1')).toBe(false);

        // 3. Khảo sát chi tiết theo từng model cụ thể:
        if (name === 'AccountingPeriod') {
          expect(schemaIndexes).toEqual([[ { month: 1 }, { unique: true } ]]);
          expect(colIndexes.some((i) => i.name === 'month_1' && i.unique === true)).toBe(true);
        } else if (name === 'DailyCashReconciliation') {
          expect(schemaIndexes).toEqual([[ { workDate: 1 }, { unique: true } ]]);
          expect(colIndexes.some((i) => i.name === 'workDate_1' && i.unique === true)).toBe(true);
        } else if (name === 'FeeSchedule') {
          expect(schemaIndexes).toEqual([[ { period: 1, classroomId: 1 }, { unique: true } ]]);
          expect(colIndexes.some((i) => i.name === 'period_1_classroomId_1' && i.unique === true)).toBe(true);
        } else if (name === 'InvoiceAdjustment') {
          expect(schemaIndexes.length).toBe(4);
          expect(colIndexes.some((i) => i.name === 'invoiceId_1')).toBe(true);
          expect(colIndexes.some((i) => i.name === 'invoiceId_1_createdAt_-1')).toBe(true);
          expect(colIndexes.some((i) => i.name === 'invoiceId_1_idempotencyKey_1' && i.unique === true)).toBe(true);
          expect(colIndexes.some((i) => i.name === 'paidAt_-1')).toBe(true);
        } else if (name === 'OperatingExpense') {
          expect(schemaIndexes.length).toBe(5);
          expect(colIndexes.some((i) => i.name === 'documentNumber_1' && i.unique === true)).toBe(true);
          expect(colIndexes.some((i) => i.name === 'idempotencyKey_1' && i.unique === true)).toBe(true);
          expect(colIndexes.some((i) => i.name === 'transactionRef_1' && i.unique === true)).toBe(true);
          expect(colIndexes.some((i) => i.name === 'approvalRequestId_1' && i.unique === true)).toBe(true);
          expect(colIndexes.some((i) => i.name === 'paidAt_-1')).toBe(true);
        } else if (name === 'OperatingExpenseRequest') {
          expect(schemaIndexes.length).toBe(2);
          expect(colIndexes.some((i) => i.name === 'requestKey_1' && i.unique === true)).toBe(true);
          expect(colIndexes.some((i) => i.name === 'status_1_createdAt_-1')).toBe(true);
        } else if (name === 'Payment') {
          expect(schemaIndexes.length).toBe(6);
          expect(colIndexes.some((i) => i.name === 'receiptNumber_1' && i.unique === true && i.sparse === true)).toBe(true);
          expect(colIndexes.some((i) => i.name === 'txnRef_1' && i.unique === true && i.sparse === true)).toBe(true);
          expect(colIndexes.some((i) => i.name === 'invoiceId_1_idempotencyKey_1' && i.unique === true)).toBe(true);
          expect(colIndexes.some((i) => i.name === 'invoiceId_1')).toBe(true);
          expect(colIndexes.some((i) => i.name === 'recordedBy_1')).toBe(true);
          expect(colIndexes.some((i) => i.name === 'paidAt_1')).toBe(true);
        } else if (name === 'PurchaseExpense') {
          expect(schemaIndexes.length).toBe(4);
          expect(colIndexes.some((i) => i.name === 'orderId_1')).toBe(true);
          expect(colIndexes.some((i) => i.name === 'orderId_1_idempotencyKey_1' && i.unique === true)).toBe(true);
          expect(colIndexes.some((i) => i.name === 'transactionRef_1' && i.unique === true && i.sparse === true)).toBe(true);
          expect(colIndexes.some((i) => i.name === 'paidAt_-1')).toBe(true);
        } else if (name === 'TuitionFee') {
          expect(schemaIndexes.length).toBe(4);
          expect(colIndexes.some((i) => i.name === 'period_1')).toBe(true);
          expect(colIndexes.some((i) => i.name === 'classroomId_1')).toBe(true);
          expect(colIndexes.some((i) => i.name === 'status_1')).toBe(true);
          expect(colIndexes.some((i) => i.name === 'dueDate_1')).toBe(true);
        } else if (name === 'TuitionRefundRequest') {
          expect(schemaIndexes.length).toBe(2);
          expect(colIndexes.some((i) => i.name === 'invoiceId_1_createdAt_-1')).toBe(true);
          expect(colIndexes.some((i) => i.name === 'invoiceId_1' && i.unique === true)).toBe(true);
        }
      }
    );
  });

  // =========================================================================
  // NHÓM B: FIXTURE THỰC TẾ TRÊN 10 MODEL (MISSING, NULL, TENANT A, TENANT B)
  // =========================================================================
  describe('Nhóm B: Fixture thực tế trên 10 Model (Kiểm tra BSON Document)', () => {
    test.each(ALL_FINANCE_MODELS)(
      'B.1 Tạo đủ 4 trạng thái cho %s và phân biệt rõ missing vs null ở tầng BSON',
      async ({ name, model, colName }) => {
        const rawCollection = bootstrapInstance.connection.db.collection(colName);

        // 1. Legacy Missing
        const pMissing = createValidPayload(name, {
          month: '2026-03',
          workDate: '2026-01-03',
          period: '03-2026',
          documentNumber: `PC-M-${new mongoose.Types.ObjectId()}`,
          idempotencyKey: `idem-m-${new mongoose.Types.ObjectId()}`,
          requestKey: `req-m-${new mongoose.Types.ObjectId()}`,
          receiptNumber: `PT-M-${new mongoose.Types.ObjectId().toString().slice(-8).toUpperCase()}`,
          studentId: new mongoose.Types.ObjectId(),
          invoiceId: new mongoose.Types.ObjectId(),
          orderId: new mongoose.Types.ObjectId()
        });
        delete pMissing.tenantId;
        const docMissing = await model.create(pMissing);

        // 2. Legacy Null
        const pNull = createValidPayload(name, {
          month: '2026-04',
          workDate: '2026-01-04',
          period: '04-2026',
          documentNumber: `PC-N-${new mongoose.Types.ObjectId()}`,
          idempotencyKey: `idem-n-${new mongoose.Types.ObjectId()}`,
          requestKey: `req-n-${new mongoose.Types.ObjectId()}`,
          receiptNumber: `PT-N-${new mongoose.Types.ObjectId().toString().slice(-8).toUpperCase()}`,
          studentId: new mongoose.Types.ObjectId(),
          invoiceId: new mongoose.Types.ObjectId(),
          orderId: new mongoose.Types.ObjectId(),
          tenantId: null
        });
        const docNull = await model.create(pNull);

        // 3. Tenant A
        const pA = createValidPayload(name, {
          month: '2026-05',
          workDate: '2026-01-05',
          period: '05-2026',
          documentNumber: `PC-A-${new mongoose.Types.ObjectId()}`,
          idempotencyKey: `idem-a-${new mongoose.Types.ObjectId()}`,
          requestKey: `req-a-${new mongoose.Types.ObjectId()}`,
          receiptNumber: `PT-A-${new mongoose.Types.ObjectId().toString().slice(-8).toUpperCase()}`,
          studentId: new mongoose.Types.ObjectId(),
          invoiceId: new mongoose.Types.ObjectId(),
          orderId: new mongoose.Types.ObjectId(),
          tenantId: tenantA._id
        });
        const docA = await model.create(pA);

        // 4. Tenant B
        const pB = createValidPayload(name, {
          month: '2026-06',
          workDate: '2026-01-06',
          period: '06-2026',
          documentNumber: `PC-B-${new mongoose.Types.ObjectId()}`,
          idempotencyKey: `idem-b-${new mongoose.Types.ObjectId()}`,
          requestKey: `req-b-${new mongoose.Types.ObjectId()}`,
          receiptNumber: `PT-B-${new mongoose.Types.ObjectId().toString().slice(-8).toUpperCase()}`,
          studentId: new mongoose.Types.ObjectId(),
          invoiceId: new mongoose.Types.ObjectId(),
          orderId: new mongoose.Types.ObjectId(),
          tenantId: tenantB._id
        });
        const docB = await model.create(pB);

        // Kiểm tra BSON raw document
        const rawMissing = await rawCollection.findOne({ _id: docMissing._id });
        const rawNull = await rawCollection.findOne({ _id: docNull._id });
        const rawA = await rawCollection.findOne({ _id: docA._id });
        const rawB = await rawCollection.findOne({ _id: docB._id });

        // Missing: không có key tenantId trên BSON
        expect(Object.prototype.hasOwnProperty.call(rawMissing, 'tenantId')).toBe(false);
        // Null: có key tenantId với value null
        expect(Object.prototype.hasOwnProperty.call(rawNull, 'tenantId')).toBe(true);
        expect(rawNull.tenantId).toBeNull();
        // Tenant A & B: có ObjectId tương ứng
        expect(String(rawA.tenantId)).toBe(String(tenantA._id));
        expect(String(rawB.tenantId)).toBe(String(tenantB._id));
      }
    );
  });

  // =========================================================================
  // NHÓM C: RANH GIỚI LỌC DỮ LIỆU VỚI buildTenantFilter
  // =========================================================================
  describe('Nhóm C: Ranh giới lọc dữ liệu với buildTenantFilter', () => {
    test.each(ALL_FINANCE_MODELS)(
      'C.1 Context Tenant A chỉ tìm thấy bản ghi Tenant A của %s',
      async ({ name, model }) => {
        // Seed 1 bản ghi cho A, 1 cho B, 1 legacy
        await model.create(createValidPayload(name, {
          month: '2026-07',
          workDate: '2026-01-07',
          period: '07-2026',
          documentNumber: `PC-CA-${new mongoose.Types.ObjectId()}`,
          idempotencyKey: `idem-ca-${new mongoose.Types.ObjectId()}`,
          requestKey: `req-ca-${new mongoose.Types.ObjectId()}`,
          receiptNumber: `PT-CA-${new mongoose.Types.ObjectId().toString().slice(-8).toUpperCase()}`,
          studentId: new mongoose.Types.ObjectId(),
          invoiceId: new mongoose.Types.ObjectId(),
          orderId: new mongoose.Types.ObjectId(),
          tenantId: tenantA._id
        }));

        await model.create(createValidPayload(name, {
          month: '2026-08',
          workDate: '2026-01-08',
          period: '08-2026',
          documentNumber: `PC-CB-${new mongoose.Types.ObjectId()}`,
          idempotencyKey: `idem-cb-${new mongoose.Types.ObjectId()}`,
          requestKey: `req-cb-${new mongoose.Types.ObjectId()}`,
          receiptNumber: `PT-CB-${new mongoose.Types.ObjectId().toString().slice(-8).toUpperCase()}`,
          studentId: new mongoose.Types.ObjectId(),
          invoiceId: new mongoose.Types.ObjectId(),
          orderId: new mongoose.Types.ObjectId(),
          tenantId: tenantB._id
        }));

        await model.create(createValidPayload(name, {
          month: '2026-09',
          workDate: '2026-01-09',
          period: '09-2026',
          documentNumber: `PC-CL-${new mongoose.Types.ObjectId()}`,
          idempotencyKey: `idem-cl-${new mongoose.Types.ObjectId()}`,
          requestKey: `req-cl-${new mongoose.Types.ObjectId()}`,
          receiptNumber: `PT-CL-${new mongoose.Types.ObjectId().toString().slice(-8).toUpperCase()}`,
          studentId: new mongoose.Types.ObjectId(),
          invoiceId: new mongoose.Types.ObjectId(),
          orderId: new mongoose.Types.ObjectId()
        }));

        const contextA = createTrustedTenantContext({ tenantId: tenantA._id });
        const filterA = buildTenantFilter(contextA);
        const resultsA = await model.find(filterA);

        expect(resultsA.length).toBe(1);
        expect(String(resultsA[0].tenantId)).toBe(String(tenantA._id));

        const contextB = createTrustedTenantContext({ tenantId: tenantB._id });
        const filterB = buildTenantFilter(contextB);
        const resultsB = await model.find(filterB);

        expect(resultsB.length).toBe(1);
        expect(String(resultsB[0].tenantId)).toBe(String(tenantB._id));
      }
    );

    test('C.2 Context không hợp lệ / không tin cậy sẽ fail-closed khi throwOnInvalid=true', () => {
      expect(() => {
        buildTenantFilter({}, { throwOnInvalid: true });
      }).toThrow();

      expect(() => {
        buildTenantFilter({ tenantContext: { tenantId: 'not-an-objectid' } }, { throwOnInvalid: true });
      }).toThrow();
    });

    test('C.3 Legacy query với filter { $or: [{ tenantId: null }, { tenantId: { $exists: false } }] } chỉ lấy đúng legacy documents', async () => {
      // Seed 1 legacy missing, 1 legacy null, 1 Tenant A trên OperatingExpense
      await OperatingExpense.create(createValidPayload('OperatingExpense', {
        documentNumber: 'PC-LEG-MISSING',
        idempotencyKey: 'idem-leg-1'
      }));

      await OperatingExpense.create(createValidPayload('OperatingExpense', {
        documentNumber: 'PC-LEG-NULL',
        idempotencyKey: 'idem-leg-2',
        tenantId: null
      }));

      await OperatingExpense.create(createValidPayload('OperatingExpense', {
        documentNumber: 'PC-TENANT-A',
        idempotencyKey: 'idem-leg-3',
        tenantId: tenantA._id
      }));

      const legacyDocs = await OperatingExpense.find({
        $or: [{ tenantId: null }, { tenantId: { $exists: false } }]
      });

      expect(legacyDocs.length).toBe(2);
      const docNumbers = legacyDocs.map(d => d.documentNumber);
      expect(docNumbers).toContain('PC-LEG-MISSING');
      expect(docNumbers).toContain('PC-LEG-NULL');
      expect(docNumbers).not.toContain('PC-TENANT-A');
    });
  });

  // =========================================================================
  // NHÓM D: BẢO TOÀN NGHIỆP VỤ & INDEX HIỆN HỮU
  // =========================================================================
  describe('Nhóm D: Bảo toàn Nghiệp Vụ & Ràng Buộc Index Hiện Hữu', () => {
    test('D.1 AccountingPeriod: Trùng month bị chặn bởi index unique toàn cục (E11000)', async () => {
      await AccountingPeriod.create(createValidPayload('AccountingPeriod', { month: '2026-10' }));
      let err;
      try {
        await AccountingPeriod.create(createValidPayload('AccountingPeriod', { month: '2026-10' }));
      } catch (e) {
        err = e;
      }
      expect(err).toBeDefined();
      expect(err.code).toBe(11000);
      expect(err.keyPattern).toHaveProperty('month');
    });

    test('D.2 DailyCashReconciliation: Trùng workDate bị chặn bởi index unique toàn cục (E11000)', async () => {
      await DailyCashReconciliation.create(createValidPayload('DailyCashReconciliation', { workDate: '2026-10-15' }));
      let err;
      try {
        await DailyCashReconciliation.create(createValidPayload('DailyCashReconciliation', { workDate: '2026-10-15' }));
      } catch (e) {
        err = e;
      }
      expect(err).toBeDefined();
      expect(err.code).toBe(11000);
      expect(err.keyPattern).toHaveProperty('workDate');
    });

    test('D.3 OperatingExpense: Trùng documentNumber hoặc idempotencyKey bị chặn bởi E11000', async () => {
      const docNum = 'PC-2026-UNIQUE-TEST';
      await OperatingExpense.create(createValidPayload('OperatingExpense', {
        documentNumber: docNum,
        idempotencyKey: 'idem-oe-1'
      }));

      // Duplicate documentNumber
      let errDoc;
      try {
        await OperatingExpense.create(createValidPayload('OperatingExpense', {
          documentNumber: docNum,
          idempotencyKey: 'idem-oe-2'
        }));
      } catch (e) {
        errDoc = e;
      }
      expect(errDoc).toBeDefined();
      expect(errDoc.code).toBe(11000);
      expect(errDoc.keyPattern).toHaveProperty('documentNumber');

      // Duplicate idempotencyKey
      let errIdem;
      try {
        await OperatingExpense.create(createValidPayload('OperatingExpense', {
          documentNumber: 'PC-2026-OTHER',
          idempotencyKey: 'idem-oe-1'
        }));
      } catch (e) {
        errIdem = e;
      }
      expect(errIdem).toBeDefined();
      expect(errIdem.code).toBe(11000);
      expect(errIdem.keyPattern).toHaveProperty('idempotencyKey');
    });

    test('D.4 FeeSchedule: Trùng period và classroomId bị chặn bởi E11000', async () => {
      await FeeSchedule.create(createValidPayload('FeeSchedule', {
        period: '10-2026',
        classroomId: classroomA._id
      }));

      let err;
      try {
        await FeeSchedule.create(createValidPayload('FeeSchedule', {
          period: '10-2026',
          classroomId: classroomA._id
        }));
      } catch (e) {
        err = e;
      }
      expect(err).toBeDefined();
      expect(err.code).toBe(11000);
      expect(err.keyPattern).toHaveProperty('period');
      expect(err.keyPattern).toHaveProperty('classroomId');
    });

    test('D.5 Payment: Trùng receiptNumber hoặc trùng invoiceId+idempotencyKey bị chặn bởi E11000', async () => {
      const receiptNo = 'PT-20261020-ABCD1234';
      const invId = new mongoose.Types.ObjectId();

      await Payment.create(createValidPayload('Payment', {
        receiptNumber: receiptNo,
        invoiceId: invId,
        idempotencyKey: 'idem-pay-u1'
      }));

      // Duplicate receiptNumber
      let errReceipt;
      try {
        await Payment.create(createValidPayload('Payment', {
          receiptNumber: receiptNo,
          invoiceId: new mongoose.Types.ObjectId(),
          idempotencyKey: 'idem-pay-u2'
        }));
      } catch (e) {
        errReceipt = e;
      }
      expect(errReceipt).toBeDefined();
      expect(errReceipt.code).toBe(11000);
      expect(errReceipt.keyPattern).toHaveProperty('receiptNumber');

      // Duplicate invoiceId + idempotencyKey
      let errIdem;
      try {
        await Payment.create(createValidPayload('Payment', {
          receiptNumber: 'PT-OTHER-1234',
          invoiceId: invId,
          idempotencyKey: 'idem-pay-u1'
        }));
      } catch (e) {
        errIdem = e;
      }
      expect(errIdem).toBeDefined();
      expect(errIdem.code).toBe(11000);
      expect(errIdem.keyPattern).toHaveProperty('invoiceId');
      expect(errIdem.keyPattern).toHaveProperty('idempotencyKey');
    });

    test('D.6 Validation số tiền âm và các quy tắc schema cốt lõi được bảo toàn nguyên vẹn', async () => {
      // TuitionFee: totalAmount âm
      let errTuition;
      try {
        await TuitionFee.create(createValidPayload('TuitionFee', { totalAmount: -100 }));
      } catch (e) {
        errTuition = e;
      }
      expect(errTuition).toBeDefined();
      expect(errTuition.name).toBe('ValidationError');

      // OperatingExpense: amount < 1
      let errExpense;
      try {
        await OperatingExpense.create(createValidPayload('OperatingExpense', { amount: 0 }));
      } catch (e) {
        errExpense = e;
      }
      expect(errExpense).toBeDefined();
      expect(errExpense.name).toBe('ValidationError');

      // Payment: amount âm
      let errPayment;
      try {
        await Payment.create(createValidPayload('Payment', { amount: -500 }));
      } catch (e) {
        errPayment = e;
      }
      expect(errPayment).toBeDefined();
      expect(errPayment.name).toBe('ValidationError');
    });
  });

  // =========================================================================
  // NHÓM E: GIỚI HẠN VA CHẠM TOÀN CỤC (GLOBAL UNIQUE CROSS-TENANT CONFLICT)
  // =========================================================================
  describe('Nhóm E: Giới hạn Va Chạm Khóa Toàn Cục Giữa Các Trường (Cross-Tenant Limitation)', () => {
    test('E.1 Trường A và Trường B cùng mở kỳ kế toán tháng "2026-11" -> Trường B bị chặn bởi index month_1', async () => {
      // Trường A mở kỳ 2026-11
      await AccountingPeriod.create(createValidPayload('AccountingPeriod', {
        month: '2026-11',
        tenantId: tenantA._id
      }));

      // Trường B cố mở cùng kỳ 2026-11 -> vấp phải E11000 từ index cũ chưa migrate
      let errB;
      try {
        await AccountingPeriod.create(createValidPayload('AccountingPeriod', {
          month: '2026-11',
          tenantId: tenantB._id
        }));
      } catch (e) {
        errB = e;
      }
      expect(errB).toBeDefined();
      expect(errB.code).toBe(11000);
      expect(errB.keyPattern).toHaveProperty('month');
    });

    test('E.2 Trường A và Trường B cùng chốt đối soát sổ quỹ ngày "2026-11-06" -> Trường B bị chặn bởi index workDate_1', async () => {
      await DailyCashReconciliation.create(createValidPayload('DailyCashReconciliation', {
        workDate: '2026-11-06',
        tenantId: tenantA._id
      }));

      let errB;
      try {
        await DailyCashReconciliation.create(createValidPayload('DailyCashReconciliation', {
          workDate: '2026-11-06',
          tenantId: tenantB._id
        }));
      } catch (e) {
        errB = e;
      }
      expect(errB).toBeDefined();
      expect(errB.code).toBe(11000);
      expect(errB.keyPattern).toHaveProperty('workDate');
    });

    test('E.3 Trường A và Trường B cùng tạo phiếu chi với số chứng từ "PC-2026-001" -> Trường B bị chặn bởi index documentNumber_1', async () => {
      await OperatingExpense.create(createValidPayload('OperatingExpense', {
        documentNumber: 'PC-2026-001',
        idempotencyKey: 'idem-exp-a-01',
        tenantId: tenantA._id
      }));

      let errB;
      try {
        await OperatingExpense.create(createValidPayload('OperatingExpense', {
          documentNumber: 'PC-2026-001',
          idempotencyKey: 'idem-exp-b-01',
          tenantId: tenantB._id
        }));
      } catch (e) {
        errB = e;
      }
      expect(errB).toBeDefined();
      expect(errB.code).toBe(11000);
      expect(errB.keyPattern).toHaveProperty('documentNumber');
    });

    test('E.4 Trường A và Trường B cùng tạo mức thu chung toàn trường (classroomId: null) cho kỳ "11-2026" -> Bị chặn bởi index period_1_classroomId_1', async () => {
      await FeeSchedule.create(createValidPayload('FeeSchedule', {
        period: '11-2026',
        classroomId: null,
        tenantId: tenantA._id
      }));

      let errB;
      try {
        await FeeSchedule.create(createValidPayload('FeeSchedule', {
          period: '11-2026',
          classroomId: null,
          tenantId: tenantB._id
        }));
      } catch (e) {
        errB = e;
      }
      expect(errB).toBeDefined();
      expect(errB.code).toBe(11000);
      expect(errB.keyPattern).toHaveProperty('period');
      expect(errB.keyPattern).toHaveProperty('classroomId');
    });
  });

  // =========================================================================
  // NHÓM F: THỬ NGHIỆM VÀ KIỂM CHỨNG INDEX ĐỀ XUẤT TRÊN COLLECTION TẠM RIÊNG
  // =========================================================================
  describe('Nhóm F: Thử Nghiệm Index Compound & PartialFilter Đề Xuất (Collection Tạm)', () => {
    let tempCol;

    beforeEach(async () => {
      const db = bootstrapInstance.connection.db;
      tempCol = db.collection('temp_saas_index_verification');
      await tempCol.deleteMany({});
      // Drop existing indexes on temp collection if any
      try {
        await tempCol.dropIndexes();
      } catch (e) {
        // ignore if collection didn't exist
      }

      // Tạo 2 index đề xuất trong tài liệu thiết kế:
      // 1. SaaS Compound Index: { tenantId: 1, docCode: 1 } với partialFilter { tenantId: { $type: 'objectId' } }
      await tempCol.createIndex(
        { tenantId: 1, docCode: 1 },
        {
          name: 'tenantId_1_docCode_1_saas_unique',
          unique: true,
          partialFilterExpression: { tenantId: { $type: 'objectId' } }
        }
      );

      // 2. Legacy Index: { docCode: 1 } với partialFilter { tenantId: null } (bảo vệ cả null lẫn missing)
      await tempCol.createIndex(
        { docCode: 1 },
        {
          name: 'docCode_1_legacy_unique',
          unique: true,
          partialFilterExpression: { tenantId: null }
        }
      );
    });

    test('F.1 Thiết kế mới: Trường A và Trường B ĐƯỢC PHÉP dùng chung mã chứng từ (docCode: "PC-001")', async () => {
      // Trường A tạo PC-001
      const resA = await tempCol.insertOne({
        tenantId: tenantA._id,
        docCode: 'PC-001',
        amount: 100000
      });
      expect(resA.insertedId).toBeDefined();

      // Trường B cũng tạo PC-001 -> Thành công theo thiết kế mới!
      const resB = await tempCol.insertOne({
        tenantId: tenantB._id,
        docCode: 'PC-001',
        amount: 200000
      });
      expect(resB.insertedId).toBeDefined();

      // Kiểm tra trong cùng Trường A nếu tạo lại PC-001 -> BỊ CHẶN (E11000)
      let errDupA;
      try {
        await tempCol.insertOne({
          tenantId: tenantA._id,
          docCode: 'PC-001',
          amount: 150000
        });
      } catch (e) {
        errDupA = e;
      }
      expect(errDupA).toBeDefined();
      expect(errDupA.code).toBe(11000);
      expect(errDupA.keyPattern).toHaveProperty('tenantId');
      expect(errDupA.keyPattern).toHaveProperty('docCode');
    });

    test('F.2 Dữ liệu Legacy được bảo vệ tính duy nhất, nhưng không chặn trường SaaS dùng cùng mã', async () => {
      // Legacy document (không có tenantId)
      await tempCol.insertOne({
        docCode: 'PC-LEGACY-001',
        amount: 50000
      });

      // Bản ghi Legacy thứ 2 trùng docCode -> BỊ CHẶN (E11000)
      let errDupLeg;
      try {
        await tempCol.insertOne({
          docCode: 'PC-LEGACY-001',
          amount: 60000,
          tenantId: null
        });
      } catch (e) {
        errDupLeg = e;
      }
      expect(errDupLeg).toBeDefined();
      expect(errDupLeg.code).toBe(11000);
      expect(errDupLeg.message).toContain('docCode_1_legacy_unique');

      // Trường A (SaaS) tạo PC-LEGACY-001 -> ĐƯỢC PHÉP (không bị dữ liệu legacy chặn nhầm)
      const resA = await tempCol.insertOne({
        tenantId: tenantA._id,
        docCode: 'PC-LEGACY-001',
        amount: 70000
      });
      expect(resA.insertedId).toBeDefined();
    });

    test('F.3 Thiết kế mới cho mã tùy chọn (receiptNumber/txnRef/transactionRef): loại bỏ sparse, dùng $gt: ""', async () => {
      const receiptCol = bootstrapInstance.connection.db.collection('temp_saas_receipt_verification');
      await receiptCol.deleteMany({});
      try {
        await receiptCol.dropIndexes();
      } catch (e) {}

      // Tạo index đề xuất cho trường mã tùy chọn (Payment.receiptNumber / txnRef / PurchaseExpense.transactionRef)
      // Loại bỏ hoàn toàn sparse: true, dùng partialFilterExpression với $gt: ''
      await receiptCol.createIndex(
        { tenantId: 1, receiptNumber: 1 },
        {
          name: 'tenantId_1_receiptNumber_1_saas_unique',
          unique: true,
          partialFilterExpression: {
            tenantId: { $type: 'objectId' },
            receiptNumber: { $gt: '' }
          }
        }
      );

      // Đọc lại metadata index từ MongoDB để xác minh cấu hình
      const indexes = await receiptCol.indexes();
      const saasIdx = indexes.find((i) => i.name === 'tenantId_1_receiptNumber_1_saas_unique');
      expect(saasIdx).toBeDefined();
      expect(saasIdx.sparse).toBeUndefined();
      expect(saasIdx.unique).toBe(true);
      expect(saasIdx.partialFilterExpression).toEqual({
        tenantId: { $type: 'objectId' },
        receiptNumber: { $gt: '' }
      });

      // 1. Kiểm chứng Tenant A tạo nhiều document MISSING receiptNumber -> THÀNH CÔNG (không bị giới hạn 1 doc)
      await receiptCol.insertOne({ tenantId: tenantA._id, note: 'Tenant A missing receipt 1' });
      await receiptCol.insertOne({ tenantId: tenantA._id, note: 'Tenant A missing receipt 2' });

      // 2. Kiểm chứng Tenant A tạo nhiều document NULL receiptNumber -> THÀNH CÔNG
      await receiptCol.insertOne({ tenantId: tenantA._id, receiptNumber: null, note: 'Tenant A null receipt 1' });
      await receiptCol.insertOne({ tenantId: tenantA._id, receiptNumber: null, note: 'Tenant A null receipt 2' });

      // 3. Kiểm chứng Tenant A tạo nhiều document EMPTY STRING "" receiptNumber -> THÀNH CÔNG
      await receiptCol.insertOne({ tenantId: tenantA._id, receiptNumber: '', note: 'Tenant A empty receipt 1' });
      await receiptCol.insertOne({ tenantId: tenantA._id, receiptNumber: '', note: 'Tenant A empty receipt 2' });

      // 4. Kiểm chứng Tenant B cũng tạo nhiều missing, null, empty -> THÀNH CÔNG
      await receiptCol.insertOne({ tenantId: tenantB._id, note: 'Tenant B missing receipt' });
      await receiptCol.insertOne({ tenantId: tenantB._id, receiptNumber: null, note: 'Tenant B null receipt' });
      await receiptCol.insertOne({ tenantId: tenantB._id, receiptNumber: '', note: 'Tenant B empty receipt' });

      // 5. Kiểm chứng Tenant A và Tenant B dùng chung mã hóa đơn/biên lai hợp lệ (REC-2026-001) -> THÀNH CÔNG
      const rA = await receiptCol.insertOne({
        tenantId: tenantA._id,
        receiptNumber: 'REC-2026-001',
        amount: 500000
      });
      const rB = await receiptCol.insertOne({
        tenantId: tenantB._id,
        receiptNumber: 'REC-2026-001',
        amount: 800000
      });
      expect(rA.insertedId).toBeDefined();
      expect(rB.insertedId).toBeDefined();

      // 6. Kiểm chứng trùng mã TRONG CÙNG TENANT A -> BỊ CHẶN BỞI ĐÚNG INDEX
      let errDupReceipt;
      try {
        await receiptCol.insertOne({
          tenantId: tenantA._id,
          receiptNumber: 'REC-2026-001',
          amount: 900000
        });
      } catch (err) {
        errDupReceipt = err;
      }
      expect(errDupReceipt).toBeDefined();
      expect(errDupReceipt.code).toBe(11000);
      expect(errDupReceipt.message).toContain('tenantId_1_receiptNumber_1_saas_unique');
    });

    test('F.4 Thiết kế mới cho mã tùy chọn Legacy: bảo vệ duy nhất mã hợp lệ, cho phép nhiều missing/null/empty', async () => {
      const receiptCol = bootstrapInstance.connection.db.collection('temp_saas_receipt_legacy_verification');
      await receiptCol.deleteMany({});
      try {
        await receiptCol.dropIndexes();
      } catch (e) {}

      await receiptCol.createIndex(
        { receiptNumber: 1 },
        {
          name: 'receiptNumber_1_legacy_unique',
          unique: true,
          partialFilterExpression: {
            tenantId: null,
            receiptNumber: { $gt: '' }
          }
        }
      );

      const indexes = await receiptCol.indexes();
      const legacyIdx = indexes.find((i) => i.name === 'receiptNumber_1_legacy_unique');
      expect(legacyIdx).toBeDefined();
      expect(legacyIdx.sparse).toBeUndefined();
      expect(legacyIdx.unique).toBe(true);

      // Legacy nhiều missing, null, empty -> THÀNH CÔNG
      await receiptCol.insertOne({ note: 'Legacy missing 1' });
      await receiptCol.insertOne({ note: 'Legacy missing 2' });
      await receiptCol.insertOne({ receiptNumber: null, note: 'Legacy null 1' });
      await receiptCol.insertOne({ receiptNumber: null, note: 'Legacy null 2' });
      await receiptCol.insertOne({ receiptNumber: '', note: 'Legacy empty 1' });
      await receiptCol.insertOne({ receiptNumber: '', note: 'Legacy empty 2' });

      // Legacy tạo mã hợp lệ
      await receiptCol.insertOne({ receiptNumber: 'REC-LEG-001', amount: 100000 });

      // Trùng mã trong Legacy -> BỊ CHẶN BỞI ĐÚNG INDEX
      let errDup;
      try {
        await receiptCol.insertOne({ receiptNumber: 'REC-LEG-001', amount: 120000 });
      } catch (e) {
        errDup = e;
      }
      expect(errDup).toBeDefined();
      expect(errDup.code).toBe(11000);
      expect(errDup.message).toContain('receiptNumber_1_legacy_unique');
    });

    test('F.5 Kiểm chứng rủi ro cấu hình sai: cấm sparse+partial và rủi ro nếu thiếu $gt: ""', async () => {
      // 1. Chứng minh MongoDB từ chối kết hợp cả sparse: true và partialFilterExpression
      let sparseConflictError = null;
      try {
        await tempCol.createIndex(
          { txnRef: 1 },
          {
            sparse: true,
            partialFilterExpression: { tenantId: null }
          }
        );
      } catch (err) {
        sparseConflictError = err;
      }
      expect(sparseConflictError).not.toBeNull();
      // MongoDB trả về lỗi không cho phép kết hợp sparse và filter
      expect(sparseConflictError.message).toMatch(/(filter.*sparse|sparse.*filter|cannot.*filter)/i);

      // 2. Chứng minh rủi ro nếu chỉ dùng { $type: "string" } mà KHÔNG có $gt: ''
      const flawedCol = bootstrapInstance.connection.db.collection('temp_flawed_index_demo');
      await flawedCol.deleteMany({});
      try {
        await flawedCol.dropIndexes();
      } catch (e) {}

      await flawedCol.createIndex(
        { tenantId: 1, txnRef: 1 },
        {
          name: 'tenantId_1_txnRef_flawed',
          unique: true,
          partialFilterExpression: {
            tenantId: { $type: 'objectId' },
            txnRef: { $type: 'string' }
          }
        }
      );

      // Document 1 có chuỗi rỗng ''
      await flawedCol.insertOne({ tenantId: tenantA._id, txnRef: '' });

      // Document 2 cũng có chuỗi rỗng '' trong cùng Tenant A -> BỊ E11000 CHẶN ĐỨNG!
      let flawedCollisionError = null;
      try {
        await flawedCol.insertOne({ tenantId: tenantA._id, txnRef: '' });
      } catch (err) {
        flawedCollisionError = err;
      }
      expect(flawedCollisionError).not.toBeNull();
      expect(flawedCollisionError.code).toBe(11000);
      expect(flawedCollisionError.message).toContain('tenantId_1_txnRef_flawed');
      // -> Kết luận: Cần bắt buộc dùng $gt: '' để loại trừ chuỗi rỗng!
    });
  });

  // =========================================================================
  // NHÓM G: SAAS ROUTER & MODE GATING (FAIL-CLOSED)
  // =========================================================================
  describe('Nhóm G: SaaS Router & Mode Gating Fail-Closed', () => {
    test('G.1 createSaasApp ở phase1d vẫn tiếp tục khóa chặt phân hệ tài chính (HTTP 501)', async () => {
      const tokenAdminA = generateSchoolUserToken(userA, tenantA);

      const financeEndpoints = [
        '/finance',
        '/finance/fee-schedules',
        '/finance/tuition-fees',
        '/finance/payments',
        '/finance/accounting-periods',
        '/finance/cash-reconciliation'
      ];

      for (const ep of financeEndpoints) {
        for (const prefix of ['/api/v1', '/api']) {
          const res = await request(app1d)
            .get(`${prefix}${ep}`)
            .set('Authorization', `Bearer ${tokenAdminA}`);
          expect(res.status).toBe(501);
          expect(res.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
        }
      }
    });

    test('G.2 phase1e là future mode, khi khởi tạo app với saasMode: "phase1e" vẫn fail-closed với 501', async () => {
      const appFuture = createSaasApp({
        mongoUri,
        connection: bootstrapInstance.connection,
        saasMode: 'phase1e'
      });

      const tokenAdminA = generateSchoolUserToken(userA, tenantA);
      const res = await request(appFuture)
        .get('/api/v1/finance')
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(res.status).toBe(501);
      expect(res.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
    });
  });
});
