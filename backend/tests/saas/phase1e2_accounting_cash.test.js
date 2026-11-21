/**
 * Phase 1E.2 Accounting Period & Cashbook Isolation Test Suite
 *
 * File: backend/tests/saas/phase1e2_accounting_cash.test.js
 *
 * Verifies multi-tenant isolation, atomic concurrency, actor verification,
 * and fail-closed security for AccountingPeriod and DailyCashReconciliation (Zone 4 Finance):
 * - Nhóm A: Ranh giới đọc dữ liệu Sổ Quỹ (loadEntries, getCashbookData) và Báo Cáo Kế Toán (buildAccountingReport).
 * - Nhóm B: Nghiệp vụ Kỳ Kế Toán (assertOpen, lockOpenPeriod, getPeriod, closePeriod, reopenPeriod).
 * - Nhóm C: Nghiệp vụ Đối Soát Sổ Quỹ Hàng Ngày (saveDailyReconciliation, revision control, snapshot).
 * - Nhóm D: Chặn Context Không Hợp Lệ Trước Mọi Đường Ghi & Đọc (Context Boundary & Anti-Sentinel).
 * - Nhóm E: Kiểm Chứng Độc Lập Xung Đột Global Unique Index (month_1 và workDate_1).
 * - Nhóm F: Tính Nguyên Tử, Transaction Rollback & Re-verify Actor (Kể cả Race Condition).
 * - Nhóm G: SaaS Router Gating & Fail-Closed (Finance & Reports routes 501 Not Implemented in phase1d and phase1e).
 */

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';

jest.setTimeout(120000);

const mongoose = require('mongoose');
const request = require('supertest');

const testDbBootstrap = require('../../src/saas/testDbBootstrap');
const createSaasApp = require('../../src/saas/createSaasApp');
const { createTrustedTenantContext, buildTenantFilter } = require('../../src/services/tenantFilterService');
const { generateSchoolUserToken } = require('../../src/saas/utils/saasJwt');

// System models
const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const Classroom = require('../../src/models/zone3_school/Classroom');
const Student = require('../../src/models/zone3_school/Student');

// Zone 2 HR
const Payroll = require('../../src/models/zone2_hr/Payroll');

// Zone 4 Finance
const AccountingPeriod = require('../../src/models/zone4_finance/AccountingPeriod');
const DailyCashReconciliation = require('../../src/models/zone4_finance/DailyCashReconciliation');
const FeeSchedule = require('../../src/models/zone4_finance/FeeSchedule');
const InvoiceAdjustment = require('../../src/models/zone4_finance/InvoiceAdjustment');
const OperatingExpense = require('../../src/models/zone4_finance/OperatingExpense');
const Payment = require('../../src/models/zone4_finance/Payment');
const PurchaseExpense = require('../../src/models/zone4_finance/PurchaseExpense');
const TuitionFee = require('../../src/models/zone4_finance/TuitionFee');

// Services & Controllers
const { assertOpen, lockOpenPeriod, resolvePeriodContext } = require('../../src/services/accountingPeriodService');
const { loadEntries, getCashbookData, saveDailyReconciliation, getCashbook } = require('../../src/controllers/cashbookController');
const { buildAccountingReport, getAccountingReport } = require('../../src/controllers/accountingReportController');
const { getPeriod, closePeriod, reopenPeriod } = require('../../src/controllers/accountingPeriodController');

describe('SaaS Phase 1E.2 — Cách Ly Kỳ Kế Toán Và Sổ Quỹ Theo Trường', () => {
  let bootstrapInstance;
  let mongoUri;
  let app1d;
  let app1e;
  let tenantA;
  let tenantB;
  let adminA;
  let principalA;
  let accountantA;
  let teacherA;
  let adminB;
  let legacyAdmin;
  let contextA;
  let contextB;
  let legacyContext;

  beforeAll(async () => {
    bootstrapInstance = await testDbBootstrap.startTestDb({
      instanceOpts: [{ dbName: 'school_saas_1e2_test_isolated' }]
    });
    mongoUri = bootstrapInstance.uri;

    await Promise.all([
      Tenant.syncIndexes(),
      User.syncIndexes(),
      AccountingPeriod.syncIndexes(),
      DailyCashReconciliation.syncIndexes(),
      TuitionFee.syncIndexes(),
      Payment.syncIndexes(),
      InvoiceAdjustment.syncIndexes(),
      PurchaseExpense.syncIndexes(),
      OperatingExpense.syncIndexes(),
      Payroll.syncIndexes()
    ]);

    app1d = createSaasApp({
      mongoUri,
      connection: bootstrapInstance.connection,
      saasMode: 'phase1d'
    });

    app1e = createSaasApp({
      mongoUri,
      connection: bootstrapInstance.connection,
      saasMode: 'phase1e'
    });
  });

  afterAll(async () => {
    if (bootstrapInstance) {
      await bootstrapInstance.stop();
    }
  });

  beforeEach(async () => {
    const collectionsToClear = [
      Tenant, User, Classroom, Student, AccountingPeriod, DailyCashReconciliation,
      TuitionFee, Payment, InvoiceAdjustment, PurchaseExpense,
      OperatingExpense, Payroll
    ];
    for (const m of collectionsToClear) {
      await m.deleteMany({});
    }

    // 1. Setup Tenant A
    tenantA = await Tenant.create({
      code: 'SCHOOL-A',
      name: 'Trường Mầm Non Ban Mai A',
      status: 'active',
      subscriptionTier: 'standard'
    });

    // 2. Setup Tenant B
    tenantB = await Tenant.create({
      code: 'SCHOOL-B',
      name: 'Trường Tiểu Học Ánh Dương B',
      status: 'active',
      subscriptionTier: 'standard'
    });

    // 3. Setup Users for Tenant A
    adminA = await User.create({
      tenantId: tenantA._id,
      username: 'admin_a',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Quản trị viên Trường A' }
    });

    principalA = await User.create({
      tenantId: tenantA._id,
      username: 'principal_a',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'principal',
      status: 'active',
      profile: { fullName: 'Hiệu trưởng Trường A' }
    });

    accountantA = await User.create({
      tenantId: tenantA._id,
      username: 'accountant_a',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'accountant',
      status: 'active',
      profile: { fullName: 'Kế toán viên Trường A' }
    });

    teacherA = await User.create({
      tenantId: tenantA._id,
      username: 'teacher_a',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'teacher',
      status: 'active',
      profile: { fullName: 'Giáo viên Trường A' }
    });

    // 4. Setup Users for Tenant B
    adminB = await User.create({
      tenantId: tenantB._id,
      username: 'admin_b',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Quản trị viên Trường B' }
    });

    // 5. Setup Legacy User (tenantId: null)
    legacyAdmin = await User.create({
      tenantId: null,
      username: 'admin_legacy',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Quản trị viên Legacy' }
    });

    // 6. Setup Trusted Tenant Contexts
    contextA = createTrustedTenantContext({ tenantId: tenantA._id });
    contextB = createTrustedTenantContext({ tenantId: tenantB._id });
    legacyContext = createTrustedTenantContext({ isLegacy: true });
  });

  // Helper to construct Express mock req & res
  const makeMockReq = ({ user, tenantId, params = {}, query = {}, body = {}, isLegacy } = {}) => ({
    user,
    tenantId: tenantId !== undefined ? tenantId : user?.tenantId,
    params,
    query,
    body,
    isLegacy,
    headers: {},
    get: (name) => (name.toLowerCase() === 'x-tenant-id' ? String(tenantId || '') : undefined)
  });

  const makeMockRes = () => {
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

  const createDeferred = () => {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  // =========================================================================
  // NHÓM A: Ranh giới đọc dữ liệu Sổ Quỹ và Báo Cáo Kế Toán
  // =========================================================================
  describe('Nhóm A: Ranh giới đọc dữ liệu Sổ Quỹ và Báo Cáo Kế Toán', () => {
    beforeEach(async () => {
      // 0. Classrooms & Students
      const classA = await Classroom.create({
        tenantId: tenantA._id,
        name: 'Lớp Mầm A',
        ageGroup: '3-4',
        academicYear: '2025-2026',
        room: 'P101',
        capacity: 30
      });
      const classB = await Classroom.create({
        tenantId: tenantB._id,
        name: 'Lớp 1B',
        ageGroup: '4-5',
        academicYear: '2025-2026',
        room: 'P201',
        capacity: 30
      });
      const classLegacy = await Classroom.create({
        tenantId: null,
        name: 'Lớp Legacy',
        ageGroup: '5-6',
        academicYear: '2025-2026',
        room: 'P301',
        capacity: 30
      });

      const studentA = await Student.create({
        tenantId: tenantA._id,
        fullName: 'Nguyễn Văn A',
        studentCode: 'HS-2026-000001',
        birthDate: new Date('2022-01-01'),
        gender: 'male',
        classroomId: classA._id,
        status: 'enrolled'
      });
      const studentB = await Student.create({
        tenantId: tenantB._id,
        fullName: 'Trần Thị B',
        studentCode: 'HS-2026-000002',
        birthDate: new Date('2021-02-02'),
        gender: 'female',
        classroomId: classB._id,
        status: 'enrolled'
      });
      const studentLegacy = await Student.create({
        tenantId: null,
        fullName: 'Lê Văn C',
        studentCode: 'HS-2026-000003',
        birthDate: new Date('2020-03-03'),
        gender: 'male',
        classroomId: classLegacy._id,
        status: 'enrolled'
      });

      // 1. TuitionFee (Hóa đơn)
      const invoiceA = await TuitionFee.create({
        tenantId: tenantA._id,
        studentId: studentA._id,
        studentName: studentA.fullName,
        studentCode: studentA.studentCode,
        classroomId: classA._id,
        className: classA.name,
        period: '03-2026',
        totalAmount: 5000000,
        paidAmount: 5000000,
        tuitionBase: 5000000,
        status: 'paid',
        dueDate: new Date('2026-03-15')
      });

      const invoiceB = await TuitionFee.create({
        tenantId: tenantB._id,
        studentId: studentB._id,
        studentName: studentB.fullName,
        studentCode: studentB.studentCode,
        classroomId: classB._id,
        className: classB.name,
        period: '03-2026',
        totalAmount: 8000000,
        paidAmount: 8000000,
        tuitionBase: 8000000,
        status: 'paid',
        dueDate: new Date('2026-03-15')
      });

      const invoiceLegacy = await TuitionFee.create({
        tenantId: null,
        studentId: studentLegacy._id,
        studentName: studentLegacy.fullName,
        studentCode: studentLegacy.studentCode,
        classroomId: classLegacy._id,
        className: classLegacy.name,
        period: '03-2026',
        totalAmount: 4000000,
        paidAmount: 4000000,
        tuitionBase: 4000000,
        status: 'paid',
        dueDate: new Date('2026-03-15')
      });

      // 2. Payments
      await Payment.create({
        tenantId: tenantA._id,
        invoiceId: invoiceA._id,
        amount: 5000000,
        paidAt: new Date('2026-03-10T08:00:00.000Z'),
        method: 'bank_transfer',
        txnRef: 'TXN-A-001',
        receiptNumber: 'REC-A-001',
        idempotencyKey: 'IDEM-PAY-A-001',
        recordedBy: adminA._id,
        recordedByName: 'Admin A'
      });

      await Payment.create({
        tenantId: tenantB._id,
        invoiceId: invoiceB._id,
        amount: 8000000,
        paidAt: new Date('2026-03-10T09:00:00.000Z'),
        method: 'bank_transfer',
        txnRef: 'TXN-B-001',
        receiptNumber: 'REC-B-001',
        idempotencyKey: 'IDEM-PAY-B-001',
        recordedBy: adminB._id,
        recordedByName: 'Admin B'
      });

      await Payment.create({
        tenantId: null,
        invoiceId: invoiceLegacy._id,
        amount: 4000000,
        paidAt: new Date('2026-03-10T10:00:00.000Z'),
        method: 'cash',
        receiptNumber: 'REC-LEGACY-001',
        idempotencyKey: 'IDEM-PAY-LEG-001',
        recordedBy: legacyAdmin._id,
        recordedByName: 'Legacy Admin'
      });

      // 3. InvoiceAdjustments (Refunds)
      await InvoiceAdjustment.create({
        tenantId: tenantA._id,
        invoiceId: invoiceA._id,
        type: 'refund',
        amount: 500000,
        paidAt: new Date('2026-03-10T11:00:00.000Z'),
        method: 'cash',
        reason: 'Hoàn trả học phí thừa theo yêu cầu phụ huynh',
        documentNumber: 'REFUND-A-001',
        idempotencyKey: 'IDEM-REF-A-001',
        recordedBy: adminA._id,
        recordedByName: 'Admin A'
      });

      // 4. PurchaseExpense
      await PurchaseExpense.create({
        tenantId: tenantA._id,
        orderId: new mongoose.Types.ObjectId(),
        orderCode: 'PO-A-001',
        supplierName: 'Nhà cung cấp A',
        amount: 1200000,
        paidAt: new Date('2026-03-10T14:00:00.000Z'),
        method: 'bank_transfer',
        transactionRef: 'TXN-PUR-A-001',
        documentNumber: 'PC-A-001',
        idempotencyKey: 'IDEM-PUR-A-001',
        recordedBy: adminA._id,
        recordedByName: 'Admin A'
      });

      // 5. OperatingExpense
      await OperatingExpense.create({
        tenantId: tenantA._id,
        category: 'utilities',
        payee: 'Điện lực A',
        description: 'Tiền điện tháng 3',
        amount: 800000,
        paidAt: new Date('2026-03-10T15:00:00.000Z'),
        method: 'bank_transfer',
        transactionRef: 'TXN-OP-A-001',
        documentNumber: 'PC-OP-A-001',
        approvalReference: 'APP-A-001',
        idempotencyKey: 'IDEM-OP-A-001',
        recordedBy: adminA._id,
        recordedByName: 'Admin A'
      });

      // 6. Payroll
      await Payroll.create({
        tenantId: tenantA._id,
        employeeId: new mongoose.Types.ObjectId(),
        employeeCode: 'NV-A-001',
        employeeName: 'Nhân viên A',
        month: 3,
        year: 2026,
        baseSalary: 7000000,
        netSalary: 7000000,
        status: 'paid',
        paidAt: new Date('2026-03-10T16:00:00.000Z'),
        paymentMethod: 'bank_transfer',
        paymentReference: 'PAYROLL-A-001'
      });

      await Payroll.create({
        tenantId: tenantB._id,
        employeeId: new mongoose.Types.ObjectId(),
        employeeCode: 'NV-B-001',
        employeeName: 'Nhân viên B',
        month: 3,
        year: 2026,
        baseSalary: 9000000,
        netSalary: 9000000,
        status: 'paid',
        paidAt: new Date('2026-03-10T17:00:00.000Z'),
        paymentMethod: 'bank_transfer',
        paymentReference: 'PAYROLL-B-001'
      });
    });

    test('A.1: Sổ Quỹ của Tenant A chỉ hiển thị các bút toán thu/chi của Tenant A', async () => {
      const { rows } = await loadEntries('2026-03-01', '2026-03-31', null, contextA);

      // Tenant A có: 1 Payment, 1 Refund, 1 Purchase, 1 Operating, 1 Payroll = 5 rows
      expect(rows).toHaveLength(5);
      const sources = rows.map((r) => r.source).sort();
      expect(sources).toEqual(['operating', 'payroll', 'purchase', 'tuition', 'tuition_refund']);

      // Kiểm tra tuyệt đối không có dữ liệu của Tenant B hoặc Legacy
      const amounts = rows.map((r) => r.amount);
      expect(amounts).not.toContain(8000000); // Học phí B
      expect(amounts).not.toContain(9000000); // Lương B
      expect(amounts).not.toContain(4000000); // Học phí Legacy
    });

    test('A.2: Caller Legacy chỉ đọc các bản ghi legacy (tenantId: null)', async () => {
      const { rows } = await loadEntries('2026-03-01', '2026-03-31', null, legacyContext);

      // Legacy chỉ có 1 payment học phí 4.000.000
      expect(rows).toHaveLength(1);
      expect(rows[0].source).toBe('tuition');
      expect(rows[0].amount).toBe(4000000);
      expect(rows[0].documentNumber).toBe('REC-LEGACY-001');
    });

    test('A.3: Lookup hóa đơn trong Sổ Quỹ không làm rò rỉ tên/mã học sinh của tenant khác', async () => {
      const { rows } = await loadEntries('2026-03-01', '2026-03-31', null, contextA);
      const tuitionRow = rows.find((r) => r.source === 'tuition');
      expect(tuitionRow).toBeDefined();
      expect(tuitionRow.party).toContain('Nguyễn Văn A');
      expect(tuitionRow.party).not.toContain('Trần Thị B');
    });

    test('A.4: buildAccountingReport tổng hợp số liệu kế toán tháng cách ly triệt để theo tenant', async () => {
      const reportA = await buildAccountingReport('2026-03', null, contextA);

      // Tenant A: 1 invoice 5.000.000, 1 payroll 7.000.000
      expect(reportA.invoicePeriod.count).toBe(1);
      expect(reportA.invoicePeriod.billed).toBe(5000000);
      expect(reportA.payrollPeriod.count).toBe(1);
      expect(reportA.payrollPeriod.totalNet).toBe(7000000);
      expect(reportA.cashFlow.tuitionIncome).toBe(5000000);
      expect(reportA.cashFlow.tuitionRefundOutflow).toBe(500000);
      expect(reportA.cashFlow.purchaseOutflow).toBe(1200000);
      expect(reportA.cashFlow.operatingOutflow).toBe(800000);
      expect(reportA.cashFlow.payrollOutflow).toBe(7000000);

      // Tenant B: 1 invoice 8.000.000, 1 payroll 9.000.000
      const reportB = await buildAccountingReport('2026-03', null, contextB);
      expect(reportB.invoicePeriod.count).toBe(1);
      expect(reportB.invoicePeriod.billed).toBe(8000000);
      expect(reportB.payrollPeriod.totalNet).toBe(9000000);
    });
  });

  // =========================================================================
  // NHÓM B: Nghiệp vụ Kỳ Kế Toán (AccountingPeriod)
  // =========================================================================
  describe('Nhóm B: Nghiệp vụ Kỳ Kế Toán (AccountingPeriod)', () => {
    test('B.1: Kỳ chốt của Tenant A không được làm chặn thao tác ghi của Tenant B', async () => {
      // Chốt kỳ tháng 2026-01 cho Tenant A
      await AccountingPeriod.create({
        tenantId: tenantA._id,
        month: '2026-01',
        status: 'closed',
        revision: 1,
        writeVersion: 1,
        snapshot: {},
        sourceHash: 'hash-a',
        history: [{ action: 'closed', actorId: adminA._id, actorName: 'Admin A', at: new Date(), reason: 'Chốt tháng 1' }]
      });

      const reqA = makeMockReq({ user: adminA, tenantId: tenantA._id });
      const reqB = makeMockReq({ user: adminB, tenantId: tenantB._id });

      // Tenant A gọi assertOpen('2026-01') phải ném lỗi 409
      await expect(assertOpen('2026-01', null, reqA)).rejects.toThrow(
        'Kỳ kế toán đã chốt. Cần hiệu trưởng hoặc admin mở lại và ghi lý do trước khi sửa.'
      );

      // Tenant B gọi assertOpen('2026-01') phải thành công bình thường (không ném lỗi)
      await expect(assertOpen('2026-01', null, reqB)).resolves.toBeUndefined();
    });

    test('B.2: lockOpenPeriod tạo kỳ mới gắn đúng tenantId và tăng writeVersion nguyên tử', async () => {
      const reqA = makeMockReq({ user: adminA, tenantId: tenantA._id });

      const lock1 = await lockOpenPeriod('2026-04', null, reqA);
      expect(lock1.status).toBe('open');
      expect(lock1.writeVersion).toBe(1);
      expect(String(lock1.tenantId)).toBe(String(tenantA._id));

      const lock2 = await lockOpenPeriod('2026-04', null, reqA);
      expect(lock2.writeVersion).toBe(2);
      expect(String(lock2._id)).toBe(String(lock1._id));
    });

    test('B.3: getPeriod trả về trạng thái kỳ của đúng tenant, không nhầm lẫn với kỳ khác', async () => {
      // Tenant A có kỳ closed
      await AccountingPeriod.create({
        tenantId: tenantA._id,
        month: '2026-02',
        status: 'closed',
        revision: 1,
        writeVersion: 1,
        snapshot: {},
        sourceHash: 'hash-a-02',
        history: []
      });

      // Tenant A query
      const reqA = makeMockReq({ user: adminA, tenantId: tenantA._id, params: { month: '2026-02' } });
      const resA = makeMockRes();
      await getPeriod(reqA, resA);
      expect(resA.statusCode).toBe(200);
      expect(resA.body.success).toBe(true);
      expect(resA.body.data.status).toBe('closed');

      // Tenant B query cùng tháng 2026-02 -> nhận kỳ open mặc định
      const reqB = makeMockReq({ user: adminB, tenantId: tenantB._id, params: { month: '2026-02' } });
      const resB = makeMockRes();
      await getPeriod(reqB, resB);
      expect(resB.statusCode).toBe(200);
      expect(resB.body.success).toBe(true);
      expect(resB.body.data.status).toBe('open');
      expect(resB.body.data.history).toHaveLength(0);
    });

    test('B.4: closePeriod chốt kỳ thành công, lưu snapshot và re-verify actor trong transaction', async () => {
      const month = '2026-01';

      const reqA = makeMockReq({
        user: principalA,
        tenantId: tenantA._id,
        params: { month },
        body: { reason: 'Chốt số liệu kế toán tháng 1 năm 2026 hợp lệ' }
      });
      const resA = makeMockRes();

      await closePeriod(reqA, resA);
      expect(resA.statusCode).toBe(200);
      expect(resA.body.success).toBe(true);
      expect(resA.body.data.status).toBe('closed');
      expect(String(resA.body.data.tenantId)).toBe(String(tenantA._id));
      expect(resA.body.data.history[0].action).toBe('closed');
      expect(String(resA.body.data.history[0].actorId)).toBe(String(principalA._id));

      const recordInDb = await AccountingPeriod.findOne({ tenantId: tenantA._id, month });
      expect(recordInDb.status).toBe('closed');
      expect(recordInDb.snapshot).toBeDefined();
    });

    test('B.5: reopenPeriod mở lại kỳ đã chốt thành công và lưu lịch sử action: reopened', async () => {
      const month = '2026-01';
      await AccountingPeriod.create({
        tenantId: tenantA._id,
        month,
        status: 'closed',
        revision: 1,
        writeVersion: 1,
        snapshot: { test: true },
        sourceHash: 'source-hash-init',
        history: [{ action: 'closed', actorId: principalA._id, actorName: 'Principal A', at: new Date(), reason: 'Chốt ban đầu' }]
      });

      const reqA = makeMockReq({
        user: adminA,
        tenantId: tenantA._id,
        params: { month },
        body: { reason: 'Mở lại để bổ sung chứng từ chi tiền mặt đã kiểm kê' }
      });
      const resA = makeMockRes();

      await reopenPeriod(reqA, resA);
      expect(resA.statusCode).toBe(200);
      expect(resA.body.success).toBe(true);
      expect(resA.body.data.status).toBe('open');
      expect(resA.body.data.revision).toBe(2);
      expect(resA.body.data.history).toHaveLength(2);
      expect(resA.body.data.history[1].action).toBe('reopened');

      // Tenant B cố mở lại kỳ của Tenant A -> bị từ chối 409
      const reqB = makeMockReq({
        user: adminB,
        tenantId: tenantB._id,
        params: { month },
        body: { reason: 'Tenant B cố tình can thiệp mở lại kỳ' }
      });
      const resB = makeMockRes();
      await reopenPeriod(reqB, resB);
      expect(resB.statusCode).toBe(409);
      expect(resB.body.message).toBe('Kỳ chưa chốt hoặc đã mở lại');
    });
  });

  // =========================================================================
  // NHÓM C: Nghiệp vụ Đối Soát Sổ Quỹ Hàng Ngày (DailyCashReconciliation)
  // =========================================================================
  describe('Nhóm C: Nghiệp vụ Đối Soát Sổ Quỹ Hàng Ngày (DailyCashReconciliation)', () => {
    test('C.1: saveDailyReconciliation tạo mới revision 1 gắn đúng tenantId và actor', async () => {
      const workDate = '2026-02-20';
      const req = makeMockReq({
        user: accountantA,
        tenantId: tenantA._id,
        body: {
          workDate,
          actual: { cashIn: 1000000, cashOut: 500000, bankIn: 2000000, bankOut: 1500000, walletIn: 0, walletOut: 0 },
          expectedRevision: 0,
          evidenceReference: 'SAO-KE-VCB-20260220',
          note: 'Đối soát cuối ngày 20/02'
        }
      });
      const res = makeMockRes();

      await saveDailyReconciliation(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.revision).toBe(1);

      const record = await DailyCashReconciliation.findOne({ tenantId: tenantA._id, workDate });
      expect(record).not.toBeNull();
      expect(String(record.tenantId)).toBe(String(tenantA._id));
      expect(String(record.recordedBy)).toBe(String(accountantA._id));
      expect(record.evidenceReference).toBe('SAO-KE-VCB-20260220');
      expect(record.history).toHaveLength(1);
    });

    test('C.2: saveDailyReconciliation cập nhật revision 2 với changeReason hợp lệ', async () => {
      const workDate = '2026-02-21';
      await DailyCashReconciliation.create({
        tenantId: tenantA._id,
        workDate,
        actual: { cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0, walletIn: 0, walletOut: 0 },
        bookSnapshot: { cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0, walletIn: 0, walletOut: 0 },
        sourceSignature: 'sig-001',
        evidenceReference: 'OLD-REF',
        note: 'Bản cũ',
        revision: 1,
        recordedBy: accountantA._id,
        recordedByName: 'Kế toán A',
        history: []
      });

      const req = makeMockReq({
        user: accountantA,
        tenantId: tenantA._id,
        body: {
          workDate,
          actual: { cashIn: 500000, cashOut: 0, bankIn: 1000000, bankOut: 0, walletIn: 0, walletOut: 0 },
          expectedRevision: 1,
          evidenceReference: 'NEW-REF-20260221',
          changeReason: 'Cập nhật thêm khoản thu trực tiếp từ phụ huynh chiều muộn',
          note: 'Đã bổ sung phiếu thu'
        }
      });
      const res = makeMockRes();

      await saveDailyReconciliation(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.revision).toBe(2);

      const record = await DailyCashReconciliation.findOne({ tenantId: tenantA._id, workDate });
      expect(record.revision).toBe(2);
      expect(record.evidenceReference).toBe('NEW-REF-20260221');
      expect(record.history).toHaveLength(1);
      expect(record.history[0].changeReason).toBe('Cập nhật thêm khoản thu trực tiếp từ phụ huynh chiều muộn');
    });

    test('C.3: Tenant B không thể cập nhật bản đối soát của Tenant A', async () => {
      const workDate = '2026-02-22';
      await DailyCashReconciliation.create({
        tenantId: tenantA._id,
        workDate,
        actual: { cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0, walletIn: 0, walletOut: 0 },
        bookSnapshot: { cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0, walletIn: 0, walletOut: 0 },
        sourceSignature: 'sig-a',
        evidenceReference: 'REF-A',
        revision: 1,
        recordedBy: accountantA._id,
        recordedByName: 'Kế toán A',
        history: []
      });

      const reqB = makeMockReq({
        user: adminB,
        tenantId: tenantB._id,
        body: {
          workDate,
          actual: { cashIn: 100, cashOut: 0, bankIn: 0, bankOut: 0, walletIn: 0, walletOut: 0 },
          expectedRevision: 1,
          evidenceReference: 'REF-B-HACK',
          changeReason: 'Tenant B cố tình sửa đối soát của Tenant A'
        }
      });
      const resB = makeMockRes();

      await saveDailyReconciliation(reqB, resB);
      expect(resB.statusCode).toBe(409);
      expect(resB.body.message).toContain('Bản đối soát đã thay đổi');
    });
  });

  // =========================================================================
  // NHÓM D: Xác thực Tenant Context Chặt Chẽ Trước Mọi Đường Ghi & Đọc
  // =========================================================================
  describe('Nhóm D: Xác thực Tenant Context Chặt Chẽ Trước Mọi Đường Ghi & Đọc', () => {
    test('D.1: lockOpenPeriod từ chối plain object giả mạo tenantId (HTTP 403, không tạo document, không sentinel _id toàn số 0)', async () => {
      const fakePlainContext = { tenantId: tenantA._id };

      await expect(lockOpenPeriod('2026-07', null, fakePlainContext)).rejects.toMatchObject({
        statusCode: 403,
        code: 'INVALID_TENANT_CONTEXT'
      });

      // Kiểm tra DB: Tuyệt đối không tạo kỳ kế toán cho tháng 2026-07
      const count = await AccountingPeriod.countDocuments({ month: '2026-07' });
      expect(count).toBe(0);

      // Kiểm tra DB: Tuyệt đối không có document sentinel với _id toàn số 0
      const sentinelDoc = await AccountingPeriod.findOne({
        _id: new mongoose.Types.ObjectId('000000000000000000000000')
      });
      expect(sentinelDoc).toBeNull();
    });

    test('D.2: lockOpenPeriod từ chối request có req.tenantId khác req.user.tenantId (Cross-tenant mismatch HTTP 403)', async () => {
      const spoofedReq = makeMockReq({
        user: adminA,
        tenantId: tenantB._id // Giả mạo sang Tenant B
      });

      await expect(lockOpenPeriod('2026-08', null, spoofedReq)).rejects.toMatchObject({
        statusCode: 403,
        code: 'INVALID_TENANT_CONTEXT'
      });

      const count = await AccountingPeriod.countDocuments({ month: '2026-08' });
      expect(count).toBe(0);
    });

    test('D.3: lockOpenPeriod từ chối request có user SaaS nhưng thiếu req.tenantId (HTTP 403)', async () => {
      const incompleteReq = {
        user: adminA,
        tenantId: null // User có tenantId nhưng req.tenantId bị thiếu/null
      };

      await expect(lockOpenPeriod('2026-09', null, incompleteReq)).rejects.toMatchObject({
        statusCode: 403,
        code: 'INVALID_TENANT_CONTEXT'
      });

      const count = await AccountingPeriod.countDocuments({ month: '2026-09' });
      expect(count).toBe(0);
    });

    test('D.4: assertOpen từ chối context không hợp lệ (HTTP 403, không im lặng coi là kỳ mở)', async () => {
      const fakePlainContext = { tenantId: tenantA._id };
      await expect(assertOpen('2026-03', null, fakePlainContext)).rejects.toMatchObject({
        statusCode: 403,
        code: 'INVALID_TENANT_CONTEXT'
      });

      const spoofedReq = makeMockReq({ user: adminA, tenantId: tenantB._id });
      await expect(assertOpen('2026-03', null, spoofedReq)).rejects.toMatchObject({
        statusCode: 403,
        code: 'INVALID_TENANT_CONTEXT'
      });
    });

    test('D.5: Các handler ghi (closePeriod, reopenPeriod, saveDailyReconciliation) từ chối context không hợp lệ (HTTP 403)', async () => {
      const fakeReqClose = {
        params: { month: '2026-01' },
        body: { reason: 'Chốt kỳ với context giả mạo' },
        tenantId: tenantA._id
        // Thiếu req.user hoặc user mismatch
      };
      const resClose = makeMockRes();
      await closePeriod(fakeReqClose, resClose);
      expect(resClose.statusCode).toBe(403);

      const fakeReqReopen = {
        params: { month: '2026-01' },
        body: { reason: 'Mở lại kỳ với context giả mạo' },
        tenantId: tenantA._id
      };
      const resReopen = makeMockRes();
      await reopenPeriod(fakeReqReopen, resReopen);
      expect(resReopen.statusCode).toBe(403);

      const fakeReqSave = {
        body: {
          workDate: '2026-02-15',
          actual: { cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0, walletIn: 0, walletOut: 0 },
          expectedRevision: 0,
          evidenceReference: 'FAKE-EVIDENCE'
        },
        tenantId: tenantA._id
      };
      const resSave = makeMockRes();
      await saveDailyReconciliation(fakeReqSave, resSave);
      expect(resSave.statusCode).toBe(403);

      // Xác minh DB không tạo document đối soát nào
      const countRecon = await DailyCashReconciliation.countDocuments({ workDate: '2026-02-15' });
      expect(countRecon).toBe(0);
    });

    test('D.6: Các helper đọc (loadEntries, getCashbookData, buildAccountingReport) từ chối context không hợp lệ (HTTP 403)', async () => {
      const fakePlainContext = { tenantId: tenantA._id };

      await expect(loadEntries('2026-03-01', '2026-03-31', null, fakePlainContext)).rejects.toMatchObject({
        statusCode: 403,
        code: 'INVALID_TENANT_CONTEXT'
      });

      await expect(getCashbookData({ from: '2026-03-01', to: '2026-03-31', context: fakePlainContext })).rejects.toMatchObject({
        statusCode: 403,
        code: 'INVALID_TENANT_CONTEXT'
      });

      await expect(buildAccountingReport('2026-03', null, fakePlainContext)).rejects.toMatchObject({
        statusCode: 403,
        code: 'INVALID_TENANT_CONTEXT'
      });
    });

    test('D.7: Happy paths đối ứng cho Tenant A, Tenant B và Legacy context tường minh', async () => {
      // 1. Tenant A happy path
      const reqA = makeMockReq({ user: adminA, tenantId: tenantA._id });
      const lockA = await lockOpenPeriod('2026-10', null, reqA);
      expect(lockA.status).toBe('open');
      expect(String(lockA.tenantId)).toBe(String(tenantA._id));

      // 2. Legacy context tường minh qua un-scoped caller (context: null)
      const lockLegacy = await lockOpenPeriod('2026-11', null, null);
      expect(lockLegacy.status).toBe('open');
      expect(lockLegacy.tenantId).toBeNull();
    });
  });

  // =========================================================================
  // NHÓM E: Kiểm Chứng Độc Lập Xung Đột Global Unique Index (month_1 và workDate_1)
  // =========================================================================
  describe('Nhóm E: Kiểm Chứng Độc Lập Xung Đột Global Unique Index (month_1 và workDate_1)', () => {
    test('E.1: Xử lý va chạm Global Unique Index month_1 trên AccountingPeriod (HTTP 409 có kiểm soát, không lộ raw MongoError)', async () => {
      const month = '2026-05';
      // Tenant A tạo kỳ trước
      await lockOpenPeriod(month, null, makeMockReq({ user: adminA, tenantId: tenantA._id }));

      // Tenant B lockOpenPeriod cùng tháng -> bắt lỗi 11000 và ném 409 có kiểm soát
      const reqB = makeMockReq({ user: adminB, tenantId: tenantB._id });
      await expect(lockOpenPeriod(month, null, reqB)).rejects.toMatchObject({
        statusCode: 409,
        message: 'Kỳ kế toán đang có giao dịch đồng thời hoặc xung đột hệ thống. Hãy thử lại.'
      });
    });

    test('E.2: Xử lý va chạm Global Unique Index workDate_1 trên DailyCashReconciliation khi lockOpenPeriod đã thành công', async () => {
      const month = '2026-06';
      const workDate = '2026-06-15';

      // 1. Tạo sẵn kỳ kế toán mở cho Tenant B trong tháng 2026-06 để lockOpenPeriod của Tenant B THÀNH CÔNG
      const periodB = await AccountingPeriod.create({
        tenantId: tenantB._id,
        month,
        status: 'open',
        revision: 0,
        writeVersion: 1,
        snapshot: {},
        sourceHash: 'init-hash',
        history: []
      });

      // 2. Tenant A đã có bản đối soát ngày 2026-06-15 từ trước
      const reconA = await DailyCashReconciliation.create({
        tenantId: tenantA._id,
        workDate,
        actual: { cashIn: 500000, cashOut: 0, bankIn: 0, bankOut: 0, walletIn: 0, walletOut: 0 },
        bookSnapshot: { cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0, walletIn: 0, walletOut: 0 },
        sourceSignature: 'sig-a-recon',
        evidenceReference: 'REF-TENANT-A',
        revision: 1,
        recordedBy: accountantA._id,
        recordedByName: 'Kế toán A'
      });

      // 3. Tenant B gọi saveDailyReconciliation cho cùng ngày workDate 2026-06-15
      const reqB = makeMockReq({
        user: adminB,
        tenantId: tenantB._id,
        body: {
          workDate,
          actual: { cashIn: 200000, cashOut: 0, bankIn: 0, bankOut: 0, walletIn: 0, walletOut: 0 },
          expectedRevision: 0,
          evidenceReference: 'REF-TENANT-B'
        }
      });
      const resB = makeMockRes();

      await saveDailyReconciliation(reqB, resB);

      // Assert 1: Nhận đúng mã lỗi 409 từ nhánh xử lý lỗi DailyCashReconciliation (không phải lỗi của lockOpenPeriod)
      expect(resB.statusCode).toBe(409);
      expect(resB.body.message).toBe('Ngày này đã có bản đối soát hoặc xung đột hệ thống. Hãy tải lại.');

      // Assert 2: Transaction rollback toàn diện, writeVersion của kỳ kế toán Tenant B KHÔNG bị tăng lên
      const periodBAfter = await AccountingPeriod.findById(periodB._id);
      expect(periodBAfter.writeVersion).toBe(1);

      // Assert 3: Bản đối soát của Tenant A giữ nguyên 100%
      const reconAAfter = await DailyCashReconciliation.findById(reconA._id);
      expect(String(reconAAfter.tenantId)).toBe(String(tenantA._id));
      expect(reconAAfter.evidenceReference).toBe('REF-TENANT-A');
    });
  });

  // =========================================================================
  // NHÓM F: Tính Nguyên Tử, Transaction Rollback & Re-verify Actor (Kể cả Concurrency & Race Condition)
  // =========================================================================
  describe('Nhóm F: Tính Nguyên Tử, Transaction Rollback & Re-verify Actor', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('F.1a: closePeriod Rollback khi inject lỗi tại thao tác ghi trạng thái/history sau lockOpenPeriod', async () => {
      const month = '2026-01';

      const openPeriod = await AccountingPeriod.create({
        tenantId: tenantA._id,
        month,
        status: 'open',
        revision: 0,
        writeVersion: 1,
        snapshot: {},
        sourceHash: 'init-hash',
        history: []
      });

      const origFindOneAndUpdate = AccountingPeriod.findOneAndUpdate;
      jest.spyOn(AccountingPeriod, 'findOneAndUpdate').mockImplementation(function (...args) {
        if (args[1]?.$set?.status === 'closed') {
          throw new Error('Simulated Database Error During Period Close Update');
        }
        return origFindOneAndUpdate.apply(this, args);
      });

      const reqClose = makeMockReq({
        user: principalA,
        tenantId: tenantA._id,
        params: { month },
        body: { reason: 'Chốt kỳ nhưng bị lỗi DB giả lập để kiểm tra rollback' }
      });
      const resClose = makeMockRes();

      try {
        await closePeriod(reqClose, resClose);
        expect(resClose.statusCode).toBe(500);

        // Assert DB sau rollback: status vẫn là 'open', revision 0, writeVersion 1, snapshot {}, sourceHash, history rỗng
        const periodInDb = await AccountingPeriod.findById(openPeriod._id);
        expect(periodInDb.status).toBe('open');
        expect(periodInDb.revision).toBe(0);
        expect(periodInDb.writeVersion).toBe(1);
        expect(periodInDb.sourceHash).toBe('init-hash');
        expect(periodInDb.snapshot || {}).toEqual({});
        expect(periodInDb.history).toHaveLength(0);
      } finally {
        jest.restoreAllMocks();
      }

      // Happy path đối ứng: Khi không có lỗi, closePeriod chốt kỳ thành công và tăng revision/writeVersion
      const reqHappy = makeMockReq({
        user: principalA,
        tenantId: tenantA._id,
        params: { month },
        body: { reason: 'Chốt kỳ kế toán tháng 1 năm 2026 thành công' }
      });
      const resHappy = makeMockRes();
      await closePeriod(reqHappy, resHappy);
      expect(resHappy.statusCode).toBe(200);
      const happyPeriod = await AccountingPeriod.findById(openPeriod._id);
      expect(happyPeriod.status).toBe('closed');
      expect(happyPeriod.revision).toBe(1);
      expect(happyPeriod.history).toHaveLength(1);
    });

    test('F.1b: reopenPeriod Rollback khi inject lỗi tại thao tác ghi trạng thái/history', async () => {
      const month = '2026-01';

      const closedPeriod = await AccountingPeriod.create({
        tenantId: tenantA._id,
        month,
        status: 'closed',
        revision: 1,
        writeVersion: 1,
        snapshot: { closed: true },
        sourceHash: 'source-hash-closed',
        history: [{ action: 'closed', actorId: principalA._id, actorName: 'Principal A', at: new Date(), reason: 'Chốt ban đầu' }]
      });

      const origFindOneAndUpdate = AccountingPeriod.findOneAndUpdate;
      jest.spyOn(AccountingPeriod, 'findOneAndUpdate').mockImplementation(function (...args) {
        if (args[1]?.$set?.status === 'open') {
          throw new Error('Simulated Database Error During Period Reopen Update');
        }
        return origFindOneAndUpdate.apply(this, args);
      });

      const reqReopen = makeMockReq({
        user: adminA,
        tenantId: tenantA._id,
        params: { month },
        body: { reason: 'Mở lại kỳ kế toán để bổ sung chứng từ chi' }
      });
      const resReopen = makeMockRes();

      try {
        await reopenPeriod(reqReopen, resReopen);
        expect(resReopen.statusCode).toBe(500);

        // Assert DB sau rollback: status vẫn là 'closed', revision 1, writeVersion 1, history 1 phần tử
        const periodInDb = await AccountingPeriod.findById(closedPeriod._id);
        expect(periodInDb.status).toBe('closed');
        expect(periodInDb.revision).toBe(1);
        expect(periodInDb.writeVersion).toBe(1);
        expect(periodInDb.sourceHash).toBe('source-hash-closed');
        expect(periodInDb.history).toHaveLength(1);
        expect(periodInDb.history[0].action).toBe('closed');
      } finally {
        jest.restoreAllMocks();
      }

      // Happy path đối ứng: Khi không có lỗi, reopenPeriod mở lại kỳ thành công
      const reqReopenHappy = makeMockReq({
        user: adminA,
        tenantId: tenantA._id,
        params: { month },
        body: { reason: 'Mở lại kỳ kế toán hợp lệ để kiểm kê' }
      });
      const resReopenHappy = makeMockRes();
      await reopenPeriod(reqReopenHappy, resReopenHappy);
      expect(resReopenHappy.statusCode).toBe(200);
      const happyPeriod = await AccountingPeriod.findById(closedPeriod._id);
      expect(happyPeriod.status).toBe('open');
      expect(happyPeriod.revision).toBe(2);
      expect(happyPeriod.history).toHaveLength(2);
      expect(happyPeriod.history[1].action).toBe('reopened');
    });

    test('F.1c: saveDailyReconciliation tạo mới Rollback khi inject lỗi sau khi lockOpenPeriod đã ghi', async () => {
      const month = '2026-02';
      const workDate = '2026-02-18';

      // Chuẩn bị kỳ mở trước với writeVersion = 1
      const initialPeriod = await AccountingPeriod.create({
        tenantId: tenantA._id,
        month,
        status: 'open',
        revision: 0,
        writeVersion: 1,
        snapshot: {},
        sourceHash: 'init-hash',
        history: []
      });

      // Inject lỗi tại DailyCashReconciliation.create
      jest.spyOn(DailyCashReconciliation, 'create').mockImplementation(() => {
        throw new Error('Simulated Database Error During Reconciliation Create');
      });

      const reqSave = makeMockReq({
        user: accountantA,
        tenantId: tenantA._id,
        body: {
          workDate,
          actual: { cashIn: 100000, cashOut: 0, bankIn: 0, bankOut: 0, walletIn: 0, walletOut: 0 },
          expectedRevision: 0,
          evidenceReference: 'REF-CREATE-FAIL'
        }
      });
      const resSave = makeMockRes();

      try {
        await saveDailyReconciliation(reqSave, resSave);
        expect(resSave.statusCode).toBe(500);

        // Assert DB sau rollback: không có document đối soát nào được tạo
        const reconCount = await DailyCashReconciliation.countDocuments({ workDate });
        expect(reconCount).toBe(0);

        // Assert DB sau rollback: writeVersion của kỳ kế toán được rollback về 1 (không tăng lên 2)
        const periodInDb = await AccountingPeriod.findById(initialPeriod._id);
        expect(periodInDb.writeVersion).toBe(1);
      } finally {
        jest.restoreAllMocks();
      }

      // Happy path đối ứng: Khi không có lỗi, tạo mới đối soát thành công revision 1 và writeVersion tăng lên 2
      const reqHappy = makeMockReq({
        user: accountantA,
        tenantId: tenantA._id,
        body: {
          workDate,
          actual: { cashIn: 100000, cashOut: 0, bankIn: 0, bankOut: 0, walletIn: 0, walletOut: 0 },
          expectedRevision: 0,
          evidenceReference: 'REF-CREATE-HAPPY'
        }
      });
      const resHappy = makeMockRes();
      await saveDailyReconciliation(reqHappy, resHappy);
      expect(resHappy.statusCode).toBe(200);

      const createdRecon = await DailyCashReconciliation.findOne({ tenantId: tenantA._id, workDate });
      expect(createdRecon).not.toBeNull();
      expect(createdRecon.revision).toBe(1);
      const periodAfterHappy = await AccountingPeriod.findById(initialPeriod._id);
      expect(periodAfterHappy.writeVersion).toBe(2);
    });

    test('F.1d: saveDailyReconciliation cập nhật Rollback khi inject lỗi ghi cập nhật bản đối soát', async () => {
      const month = '2026-02';
      const workDate = '2026-02-19';

      await AccountingPeriod.create({
        tenantId: tenantA._id,
        month,
        status: 'open',
        revision: 0,
        writeVersion: 1,
        snapshot: {},
        sourceHash: 'init-hash',
        history: []
      });

      const initialRecon = await DailyCashReconciliation.create({
        tenantId: tenantA._id,
        workDate,
        actual: { cashIn: 500000, cashOut: 0, bankIn: 0, bankOut: 0, walletIn: 0, walletOut: 0 },
        bookSnapshot: { cashIn: 500000, cashOut: 0, bankIn: 0, bankOut: 0, walletIn: 0, walletOut: 0 },
        sourceSignature: 'sig-019',
        evidenceReference: 'REF-OLD-019',
        revision: 1,
        recordedBy: accountantA._id,
        recordedByName: 'Kế toán A',
        history: []
      });

      // Inject lỗi tại DailyCashReconciliation.findOneAndUpdate
      const origFindOneAndUpdate = DailyCashReconciliation.findOneAndUpdate;
      jest.spyOn(DailyCashReconciliation, 'findOneAndUpdate').mockImplementation(function (...args) {
        throw new Error('Simulated Database Error During Reconciliation Update');
      });

      const reqUpdate = makeMockReq({
        user: accountantA,
        tenantId: tenantA._id,
        body: {
          workDate,
          actual: { cashIn: 800000, cashOut: 0, bankIn: 0, bankOut: 0, walletIn: 0, walletOut: 0 },
          expectedRevision: 1,
          evidenceReference: 'REF-NEW-FAIL',
          changeReason: 'Cập nhật tiền mặt buổi chiều'
        }
      });
      const resUpdate = makeMockRes();

      try {
        await saveDailyReconciliation(reqUpdate, resUpdate);
        expect(resUpdate.statusCode).toBe(500);

        // Assert DB sau rollback: bản đối soát giữ nguyên revision 1, actual 500.000, history rỗng
        const reconInDb = await DailyCashReconciliation.findById(initialRecon._id);
        expect(reconInDb.revision).toBe(1);
        expect(reconInDb.actual.cashIn).toBe(500000);
        expect(reconInDb.evidenceReference).toBe('REF-OLD-019');
        expect(reconInDb.history).toHaveLength(0);

        // Assert DB sau rollback: writeVersion của kỳ kế toán giữ nguyên
        const periodInDb = await AccountingPeriod.findOne({ tenantId: tenantA._id, month });
        expect(periodInDb.writeVersion).toBe(1);
      } finally {
        jest.restoreAllMocks();
      }

      // Happy path đối ứng: Khi không có lỗi, cập nhật thành công lên revision 2
      const reqUpdateHappy = makeMockReq({
        user: accountantA,
        tenantId: tenantA._id,
        body: {
          workDate,
          actual: { cashIn: 800000, cashOut: 0, bankIn: 0, bankOut: 0, walletIn: 0, walletOut: 0 },
          expectedRevision: 1,
          evidenceReference: 'REF-NEW-HAPPY',
          changeReason: 'Cập nhật số tiền mặt khớp với sổ cái chiều'
        }
      });
      const resUpdateHappy = makeMockRes();
      await saveDailyReconciliation(reqUpdateHappy, resUpdateHappy);
      expect(resUpdateHappy.statusCode).toBe(200);

      const updatedRecon = await DailyCashReconciliation.findById(initialRecon._id);
      expect(updatedRecon.revision).toBe(2);
      expect(updatedRecon.actual.cashIn).toBe(800000);
      expect(updatedRecon.history).toHaveLength(1);
    });

    test('F.2: Re-verify actor: Từ chối khi actor không đúng quyền trong DB (kể cả trước khi gọi)', async () => {
      // 1. Giáo viên không có quyền mở lại kỳ kế toán
      const reqTeacherReopen = makeMockReq({
        user: teacherA,
        tenantId: tenantA._id,
        params: { month: '2026-01' },
        body: { reason: 'Giáo viên cố tình mở lại kỳ' }
      });
      const resTeacherReopen = makeMockRes();
      await reopenPeriod(reqTeacherReopen, resTeacherReopen);
      expect(resTeacherReopen.statusCode).toBe(403);
      expect(resTeacherReopen.body.message).toContain('Người dùng không có quyền');

      // 2. Giáo viên không có quyền đối soát sổ quỹ
      const reqTeacherSave = makeMockReq({
        user: teacherA,
        tenantId: tenantA._id,
        body: {
          workDate: '2026-02-19',
          actual: { cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0, walletIn: 0, walletOut: 0 },
          expectedRevision: 0,
          evidenceReference: 'REF-TEACHER'
        }
      });
      const resTeacherSave = makeMockRes();
      await saveDailyReconciliation(reqTeacherSave, resTeacherSave);
      expect(resTeacherSave.statusCode).toBe(403);
      expect(resTeacherSave.body.message).toContain('Người dùng không có quyền');
    });

    test('F.3a: Stale Request: Từ chối thao tác khi request mang thông tin actor cũ nhưng database đã khóa trước khi controller chạy', async () => {
      const month = '2026-01';

      await AccountingPeriod.create({
        tenantId: tenantA._id,
        month,
        status: 'open',
        revision: 0,
        writeVersion: 1,
        snapshot: {},
        sourceHash: 'init-hash',
        history: []
      });

      // User object ở request là active (stale token/request context)
      const staleUser = { ...principalA.toObject(), status: 'active', role: 'principal' };
      const reqClose = makeMockReq({
        user: staleUser,
        tenantId: tenantA._id,
        params: { month },
        body: { reason: 'Chốt kỳ khi tài khoản đã bị khóa trước trên database' }
      });
      const resClose = makeMockRes();

      // Database thực tế đã khóa tài khoản trước khi controller chạy
      await User.updateOne({ _id: principalA._id }, { $set: { status: 'inactive' } });

      try {
        await closePeriod(reqClose, resClose);

        // Phải bị từ chối với HTTP 403 vì re-verify actor trong transaction phát hiện user đã inactive
        expect(resClose.statusCode).toBe(403);
        expect(resClose.body.message).toContain('Người dùng không có quyền chốt kỳ kế toán hoặc tài khoản đã bị khóa');
      } finally {
        await User.updateOne({ _id: principalA._id }, { $set: { status: 'active' } });
      }
    });

    test('F.3b: Khóa actor sau xác thực request nhưng trước khi transaction snapshot được đọc', async () => {
      const month = '2026-01';

      await AccountingPeriod.create({
        tenantId: tenantA._id,
        month,
        status: 'open',
        revision: 0,
        writeVersion: 1,
        snapshot: {},
        sourceHash: 'init-hash',
        history: []
      });

      // Spy vào mongoose.startSession: Khi session vừa bắt đầu (sau khi assertTenantContext vượt qua nhưng trước câu lệnh đầu của transaction)
      const origStartSession = mongoose.startSession;
      jest.spyOn(mongoose, 'startSession').mockImplementation(async function (...args) {
        // Khóa tài khoản trong DB trước khi transaction thực hiện câu lệnh đầu tiên (thiết lập snapshot)
        await User.updateOne({ _id: principalA._id }, { $set: { status: 'inactive' } });
        return origStartSession.apply(this, args);
      });

      const reqClose = makeMockReq({
        user: principalA,
        tenantId: tenantA._id,
        params: { month },
        body: { reason: 'Chốt kỳ khi tài khoản bị khóa ngay trước snapshot' }
      });
      const resClose = makeMockRes();

      try {
        await closePeriod(reqClose, resClose);

        expect(resClose.statusCode).toBe(403);
        expect(resClose.body.message).toContain('Người dùng không có quyền chốt kỳ kế toán hoặc tài khoản đã bị khóa');
      } finally {
        jest.restoreAllMocks();
        await User.updateOne({ _id: principalA._id }, { $set: { status: 'active' } });
      }
    });

    test('F.4a: Kiểm thử tuần tự: saveDailyReconciliation bị chặn khi kỳ kế toán đã chốt từ trước', async () => {
      const month = '2026-01';
      const workDate = '2026-01-25';

      // 1. Chốt kỳ tháng 2026-01 cho Tenant A
      const reqClose = makeMockReq({
        user: principalA,
        tenantId: tenantA._id,
        params: { month },
        body: { reason: 'Chốt kỳ kế toán tháng 1 trước khi đối soát muộn' }
      });
      const resClose = makeMockRes();
      await closePeriod(reqClose, resClose);
      expect(resClose.statusCode).toBe(200);

      // 2. Thao tác đối soát đến sau cố tình ghi vào ngày 2026-01-25 (thuộc tháng 2026-01 đã đóng)
      const reqSave = makeMockReq({
        user: accountantA,
        tenantId: tenantA._id,
        body: {
          workDate,
          actual: { cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0, walletIn: 0, walletOut: 0 },
          expectedRevision: 0,
          evidenceReference: 'REF-LATE-RECON'
        }
      });
      const resSave = makeMockRes();

      await saveDailyReconciliation(reqSave, resSave);

      // Assert: Bị từ chối HTTP 409 vì kỳ đã chốt
      expect(resSave.statusCode).toBe(409);
      expect(resSave.body.message).toContain('Kỳ kế toán đã chốt. Cần hiệu trưởng hoặc admin mở lại và ghi lý do trước khi sửa.');

      // Assert: Không có bản ghi đối soát nào được tạo cho ngày này
      const reconCount = await DailyCashReconciliation.countDocuments({ workDate });
      expect(reconCount).toBe(0);
    });

    test('F.4b: Concurrency thực sự với Handshake Barrier hai luồng: Cạnh tranh đồng thời giữa closePeriod và saveDailyReconciliation', async () => {
      const month = '2026-01';
      const workDate = '2026-01-26';

      await AccountingPeriod.create({
        tenantId: tenantA._id,
        month,
        status: 'open',
        revision: 0,
        writeVersion: 1,
        snapshot: {},
        sourceHash: 'init-hash',
        history: []
      });

      function createBarrier(name, timeoutMs = 10000) {
        let res, rej, timer;
        const promise = new Promise((resolve, reject) => {
          res = resolve;
          rej = reject;
          timer = setTimeout(() => {
            reject(new Error(`BARRIER_TIMEOUT: Barrier "${name}" was not reached within ${timeoutMs}ms`));
          }, timeoutMs);
        });
        return {
          name,
          promise,
          resolve(val) {
            if (timer) { clearTimeout(timer); timer = null; }
            res(val);
          },
          reject(err) {
            if (timer) { clearTimeout(timer); timer = null; }
            rej(err);
          },
          cleanup() {
            if (timer) { clearTimeout(timer); timer = null; }
          }
        };
      }

      const barrierCloseHoldingLock = createBarrier('closeHoldingLock', 10000);
      const barrierSaveReachedLock = createBarrier('saveReachedLock', 10000);
      const barrierCloseCanProceed = createBarrier('closeCanProceed', 10000);

      let closeSession = null;
      let saveSession = null;
      let saveActorReadCompleted = false;

      const origUserFindOne = User.findOne;
      const origAcctFindOneAndUpdate = AccountingPeriod.findOneAndUpdate;

      // 1. Theo dõi User.findOne để kiểm chứng luồng save:
      // - Đã vào transaction
      // - Đã hoàn thành lần đọc actor trong session
      // - Session của save khác session của close
      jest.spyOn(User, 'findOne').mockImplementation(function (...args) {
        const query = origUserFindOne.apply(this, args);
        const origExec = query.exec.bind(query);
        query.exec = async function () {
          const result = await origExec();
          const session = query.getOptions().session;
          if (session && closeSession && session !== closeSession) {
            saveSession = session;
            if (session.inTransaction() && session.transaction.state === 'TRANSACTION_IN_PROGRESS') {
              saveActorReadCompleted = true;
            }
          }
          return result;
        };
        return query;
      });

      // 2. Theo dõi AccountingPeriod.findOneAndUpdate:
      // - closePeriod: khi cập nhật status: 'closed', báo hiệu closeHoldingLock và tạm dừng chờ save
      // - saveDailyReconciliation: khi gọi lockOpenPeriod trên đúng document/tháng/tenant trong transaction của nó,
      //   xác nhận đủ 4 điều kiện handshake rồi mới thả barrier closeCanProceed
      jest.spyOn(AccountingPeriod, 'findOneAndUpdate').mockImplementation(async function (...args) {
        const filter = args[0] || {};
        const update = args[1] || {};
        const options = args[2] || {};
        const session = options.session;

        // Điểm dừng của closePeriod: sau khi lockOpenPeriod đã tăng writeVersion và tính xong báo cáo, chuẩn bị commit status closed
        if (update.$set?.status === 'closed') {
          closeSession = session;
          barrierCloseHoldingLock.resolve(closeSession);
          // Chờ tín hiệu handshake đầy đủ từ luồng save (timeout bảo vệ sẽ reject test nếu save không đến)
          await barrierCloseCanProceed.promise;
        }

        // Điểm quan sát của saveDailyReconciliation: khi tới lockOpenPeriod
        if (update.$inc?.writeVersion && session && closeSession && session !== closeSession) {
          if (saveActorReadCompleted &&
              filter.month === month &&
              String(filter.tenantId) === String(tenantA._id) &&
              filter.status === 'open' &&
              session.id.id.toString('hex') !== closeSession.id.id.toString('hex')) {
            // Đã đạt đủ 4 tín hiệu xác nhận:
            // 1. save đã vào transaction
            // 2. save đã hoàn thành đọc actor trong session
            // 3. save đã tới thao tác lockOpenPeriod trên đúng document/tháng/tenant
            // 4. session của save khác biệt hoàn toàn với session của close
            barrierSaveReachedLock.resolve();
            // Thả luồng close được phép ghi status: 'closed' và commit
            barrierCloseCanProceed.resolve();
          }
        }

        return origAcctFindOneAndUpdate.apply(this, args);
      });

      const reqClose = makeMockReq({
        user: principalA,
        tenantId: tenantA._id,
        params: { month },
        body: { reason: 'Chốt kỳ kế toán tháng 1 cạnh tranh đồng thời' }
      });
      const resClose = makeMockRes();

      const reqSave = makeMockReq({
        user: accountantA,
        tenantId: tenantA._id,
        body: {
          workDate,
          actual: { cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0, walletIn: 0, walletOut: 0 },
          expectedRevision: 0,
          evidenceReference: 'REF-BARRIER-RACE'
        }
      });
      const resSave = makeMockRes();

      let closePromise = null;
      let savePromise = null;

      try {
        // Bước 1: Khởi chạy luồng closePeriod
        closePromise = closePeriod(reqClose, resClose);

        // Bước 2: Chờ luồng close hoàn thành lockOpenPeriod và giữ write lock trong transaction
        await barrierCloseHoldingLock.promise;
        expect(closeSession).toBeDefined();
        expect(closeSession.inTransaction()).toBe(true);

        // Bước 3: Khởi chạy luồng saveDailyReconciliation trong khi transaction của close đang dở
        savePromise = saveDailyReconciliation(reqSave, resSave);

        // Bước 4: Chờ tín hiệu handshake xác nhận luồng save đã vào transaction, đọc actor và tới lockOpenPeriod
        await barrierSaveReachedLock.promise;
        expect(saveSession).toBeDefined();
        expect(saveSession.inTransaction()).toBe(true);
        expect(saveSession.id.id.toString('hex')).not.toBe(closeSession.id.id.toString('hex'));

        // Bước 5: Chờ cả hai request kết thúc hoàn toàn (bao gồm xử lý xung đột / retry của transaction)
        await Promise.all([closePromise, savePromise]);

        // Assert kết quả xử lý cạnh tranh
        expect(resClose.statusCode).toBe(200);
        expect(resClose.body.success).toBe(true);
        expect(resClose.body.message).toContain('Đã chốt kỳ');

        expect(resSave.statusCode).toBe(409);
        expect(resSave.body.message).toContain('Kỳ kế toán đã chốt. Cần hiệu trưởng hoặc admin mở lại và ghi lý do trước khi sửa.');

        // Assert trạng thái database cuối cùng - Xác định rõ ràng, không dùng nhánh if
        const finalPeriod = await AccountingPeriod.findOne({ tenantId: tenantA._id, month });
        expect(finalPeriod).not.toBeNull();
        expect(finalPeriod.status).toBe('closed');
        expect(finalPeriod.revision).toBe(1);
        expect(finalPeriod.writeVersion).toBe(2);
        expect(finalPeriod.history).toHaveLength(1);
        expect(finalPeriod.history[0].action).toBe('closed');
        expect(finalPeriod.history[0].actorId.toString()).toBe(principalA._id.toString());
        expect(finalPeriod.snapshot).toBeDefined();

        const finalRecon = await DailyCashReconciliation.findOne({ tenantId: tenantA._id, workDate });
        expect(finalRecon).toBeNull();
        const totalRecons = await DailyCashReconciliation.countDocuments({});
        expect(totalRecons).toBe(0);
      } finally {
        // Dọn dẹp timer bảo vệ
        barrierCloseHoldingLock.cleanup();
        barrierSaveReachedLock.cleanup();
        barrierCloseCanProceed.cleanup();

        // Mở bất kỳ barrier nào còn pending để tránh treo nếu có lỗi xảy ra trước đó
        barrierCloseHoldingLock.resolve(null);
        barrierSaveReachedLock.resolve(null);
        barrierCloseCanProceed.resolve(null);

        // Chờ các request đang chạy kết thúc để không rò rỉ sang test kế tiếp
        if (closePromise || savePromise) {
          await Promise.allSettled([closePromise, savePromise]);
        }

        jest.restoreAllMocks();
      }
    });
  });

  // =========================================================================
  // NHÓM G: SaaS Router Gating & Fail-Closed
  // =========================================================================
  describe('Nhóm G: SaaS Router Gating & Fail-Closed', () => {
    let tokenA;

    beforeEach(() => {
      tokenA = generateSchoolUserToken(adminA, tenantA);
    });

    test('G.1: Module Finance và Reports bị chặn HTTP 501 Not Implemented ở mode phase1d (/api/v1 và /api)', async () => {
      // 1. Finance /api/v1/finance/...
      const resV1 = await request(app1d)
        .get('/api/v1/finance/cashbook')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resV1.status).toBe(501);
      expect(resV1.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');

      // 2. Finance alias /api/finance/...
      const resAlias = await request(app1d)
        .get('/api/finance/cashbook')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resAlias.status).toBe(501);
      expect(resAlias.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');

      // 3. Accounting period route
      const resPeriod = await request(app1d)
        .get('/api/v1/finance/accounting-period/2026-03')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resPeriod.status).toBe(501);

      // 4. Reports route
      const resReports = await request(app1d)
        .get('/api/v1/reports/accounting')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resReports.status).toBe(501);
    });

    test('G.2: Module Finance mở endpoint /cashbook được duyệt ở mode phase1e, trong khi mode phase1d và unapproved submodules tiếp tục bị chặn 501', async () => {
      // 1. Endpoint /cashbook được duyệt ở mode phase1e trả về 200 với token hợp lệ
      const resV1 = await request(app1e)
        .get('/api/v1/finance/cashbook')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resV1.status).toBe(200);
      expect(resV1.body.success).toBe(true);

      const resAlias = await request(app1e)
        .get('/api/finance/cashbook')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resAlias.status).toBe(200);
      expect(resAlias.body.success).toBe(true);

      // 2. Unapproved submodule (ví dụ /export/payroll) tiếp tục bị chặn HTTP 501 trên phase1e
      const resPayroll = await request(app1e)
        .get('/api/v1/finance/export/payroll')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resPayroll.status).toBe(501);
      expect(resPayroll.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
    });

    test('G.3: Untrusted context không thể giả mạo dữ liệu tenant (Fail-Closed)', () => {
      const fakeUntrustedContext = { tenantId: tenantA._id };
      const filter = buildTenantFilter(fakeUntrustedContext);
      expect(String(filter._id)).toBe('000000000000000000000000');
      expect(String(filter.tenantId)).toBe('000000000000000000000000');
    });
  });
});
