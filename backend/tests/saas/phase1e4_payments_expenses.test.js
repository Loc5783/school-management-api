/**
 * Phase 1E.4 Payments, Refunds, Operating & Purchase Expenses Isolation Test Suite
 *
 * File: backend/tests/saas/phase1e4_payments_expenses.test.js
 *
 * Verifies multi-tenant isolation, atomic concurrency, actor verification,
 * and fail-closed security for Payments, TuitionRefundRequest, OperatingExpense,
 * OperatingExpenseRequest, and PurchaseExpense (Zone 4 Finance):
 * - Nhóm A: Phân quyền, tenant boundary và context enforcement.
 * - Nhóm B: Thanh toán học phí (Payments) & Idempotency & Notifications.
 * - Nhóm C: Đề nghị và chi trả hoàn phí (TuitionRefundRequest & InvoiceAdjustment).
 * - Nhóm D: Chi vận hành (OperatingExpenseRequest & OperatingExpense).
 * - Nhóm E: Chi mua sắm (PurchaseExpense & PurchaseOrder).
 * - Nhóm F: Xuất Excel sổ chi và biên lai.
 * - Nhóm G: Giao dịch nguyên tử (Transaction Rollback) & Actor Re-verify.
 * - Nhóm H: Concurrency & Handshake hai luồng xác định (Barrier-based).
 * - Nhóm I: Kỳ kế toán cách ly & Cổng SaaS Finance tiếp tục đóng (HTTP 501).
 */

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';

jest.setTimeout(120000);

const mongoose = require('mongoose');

const testDbBootstrap = require('../../src/saas/testDbBootstrap');
const createSaasApp = require('../../src/saas/createSaasApp');
const { createTrustedTenantContext, buildTenantFilter } = require('../../src/services/tenantFilterService');

// System models
const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const Notification = require('../../src/models/zone1_system/Notification');
const AuditLog = require('../../src/models/zone1_system/AuditLog');
const Classroom = require('../../src/models/zone3_school/Classroom');
const Student = require('../../src/models/zone3_school/Student');

// Zone 4 Finance models
const AccountingPeriod = require('../../src/models/zone4_finance/AccountingPeriod');
const TuitionFee = require('../../src/models/zone4_finance/TuitionFee');
const Payment = require('../../src/models/zone4_finance/Payment');
const InvoiceAdjustment = require('../../src/models/zone4_finance/InvoiceAdjustment');
const TuitionRefundRequest = require('../../src/models/zone4_finance/TuitionRefundRequest');
const OperatingExpense = require('../../src/models/zone4_finance/OperatingExpense');
const OperatingExpenseRequest = require('../../src/models/zone4_finance/OperatingExpenseRequest');
const PurchaseExpense = require('../../src/models/zone4_finance/PurchaseExpense');
const PurchaseOrder = require('../../src/models/zone6_procurement/PurchaseOrder');
const ProcurementRequest = require('../../src/models/zone6_procurement/ProcurementRequest');

// Controllers & Services
const financeController = require('../../src/controllers/financeController');
const paymentTransactionService = require('../../src/services/paymentTransactionService');
const tuitionRefundController = require('../../src/controllers/tuitionRefundController');
const operatingExpenseController = require('../../src/controllers/operatingExpenseController');
const purchaseExpenseController = require('../../src/controllers/purchaseExpenseController');
const financeExcelController = require('../../src/controllers/financeExcelController');
const { lockOpenPeriod, assertOpen } = require('../../src/services/accountingPeriodService');
const { closePeriod } = require('../../src/controllers/accountingPeriodController');
const { getWorkDate } = require('../../src/utils/dateHelpers');

describe('SaaS Phase 1E.4 — Cách Ly Thanh Toán, Hoàn Phí Và Các Khoản Chi Theo Trường', () => {
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
  let parentA;

  let adminB;
  let principalB;
  let accountantB;

  let legacyAdmin;
  let legacyAccountant;

  let classA1;
  let classB1;
  let classLeg;

  let studentA1;
  let studentB1;
  let studentLeg;

  let invoiceA1;
  let invoiceB1;
  let invoiceLeg;

  beforeAll(async () => {
    bootstrapInstance = await testDbBootstrap.startTestDb({
      instanceOpts: [{ dbName: 'school_saas_1e4_test_isolated' }]
    });
    mongoUri = bootstrapInstance.uri;

    await Promise.all([
      Tenant.syncIndexes(),
      User.syncIndexes(),
      Classroom.syncIndexes(),
      Student.syncIndexes(),
      AccountingPeriod.syncIndexes(),
      TuitionFee.syncIndexes(),
      Payment.syncIndexes(),
      InvoiceAdjustment.syncIndexes(),
      TuitionRefundRequest.syncIndexes(),
      OperatingExpense.syncIndexes(),
      OperatingExpenseRequest.syncIndexes(),
      PurchaseExpense.syncIndexes(),
      PurchaseOrder.syncIndexes(),
      ProcurementRequest.syncIndexes(),
      Notification.syncIndexes(),
      AuditLog.syncIndexes()
    ]);

    // Khẳng định đầy đủ index sản phẩm hiện hành: month_1 là unique toàn cục
    const apIndexes = await AccountingPeriod.collection.indexes();
    const monthIdx = apIndexes.find((idx) => idx.name === 'month_1' || (idx.key && idx.key.month === 1));
    expect(monthIdx).toBeDefined();
    expect(monthIdx.unique).toBe(true);

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
      Tenant, User, Classroom, Student, AccountingPeriod,
      TuitionFee, Payment, InvoiceAdjustment, TuitionRefundRequest,
      OperatingExpense, OperatingExpenseRequest, PurchaseExpense,
      PurchaseOrder, ProcurementRequest, Notification, AuditLog
    ];
    for (const m of collectionsToClear) {
      await m.deleteMany({});
    }

    // 1. Tenants
    tenantA = await Tenant.create({
      code: 'SCHOOL-A',
      name: 'Trường Mầm Non Ban Mai A',
      status: 'active',
      subscriptionTier: 'standard'
    });

    tenantB = await Tenant.create({
      code: 'SCHOOL-B',
      name: 'Trường Tiểu Học Ánh Dương B',
      status: 'active',
      subscriptionTier: 'standard'
    });

    // 2. Classrooms
    classA1 = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Mầm 1A',
      ageGroup: '3-4',
      academicYear: '2026-2027',
      status: 'active'
    });

    classB1 = await Classroom.create({
      tenantId: tenantB._id,
      name: 'Lớp 1B',
      ageGroup: '5-6',
      academicYear: '2026-2027',
      status: 'active'
    });

    classLeg = await Classroom.create({
      name: 'Lớp Legacy',
      ageGroup: '3-4',
      academicYear: '2026-2027',
      status: 'active'
    });

    // 3. Students
    studentA1 = await Student.create({
      tenantId: tenantA._id,
      studentCode: 'HS-2026-000001',
      fullName: 'Nguyễn Văn An A',
      birthDate: new Date('2022-05-10'),
      gender: 'male',
      classroomId: classA1._id,
      className: classA1.name,
      status: 'enrolled'
    });

    studentB1 = await Student.create({
      tenantId: tenantB._id,
      studentCode: 'HS-2026-000002',
      fullName: 'Lê Hoàng Cường B',
      birthDate: new Date('2020-03-20'),
      gender: 'male',
      classroomId: classB1._id,
      className: classB1.name,
      status: 'enrolled'
    });

    studentLeg = await Student.create({
      studentCode: 'HS-2026-000003',
      fullName: 'Học Sinh Legacy',
      birthDate: new Date('2021-01-15'),
      gender: 'female',
      classroomId: classLeg._id,
      className: classLeg.name,
      status: 'enrolled'
    });

    // 4. Users
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

    parentA = await User.create({
      tenantId: tenantA._id,
      username: 'parent_a',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'parent',
      status: 'active',
      profile: { fullName: 'Phụ huynh Nguyễn Văn An' },
      parentInfo: { studentIds: [studentA1._id] }
    });

    adminB = await User.create({
      tenantId: tenantB._id,
      username: 'admin_b',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Quản trị viên Trường B' }
    });

    principalB = await User.create({
      tenantId: tenantB._id,
      username: 'principal_b',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'principal',
      status: 'active',
      profile: { fullName: 'Hiệu trưởng Trường B' }
    });

    accountantB = await User.create({
      tenantId: tenantB._id,
      username: 'accountant_b',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'accountant',
      status: 'active',
      profile: { fullName: 'Kế toán viên Trường B' }
    });

    legacyAdmin = await User.create({
      tenantId: null,
      username: 'admin_legacy',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Quản trị viên Legacy' }
    });

    legacyAccountant = await User.create({
      tenantId: null,
      username: 'accountant_legacy',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'accountant',
      status: 'active',
      profile: { fullName: 'Kế toán Legacy' }
    });

    // 5. Invoices
    invoiceA1 = await TuitionFee.create({
      tenantId: tenantA._id,
      studentId: studentA1._id,
      studentName: studentA1.fullName,
      studentCode: studentA1.studentCode,
      classroomId: classA1._id,
      className: classA1.name,
      period: '11-2026',
      tuitionBase: 3000000,
      totalAmount: 3000000,
      paidAmount: 0,
      status: 'unpaid',
      dueDate: new Date('2026-11-20')
    });

    invoiceB1 = await TuitionFee.create({
      tenantId: tenantB._id,
      studentId: studentB1._id,
      studentName: studentB1.fullName,
      studentCode: studentB1.studentCode,
      classroomId: classB1._id,
      className: classB1.name,
      period: '11-2026',
      tuitionBase: 4000000,
      totalAmount: 4000000,
      paidAmount: 0,
      status: 'unpaid',
      dueDate: new Date('2026-11-20')
    });

    invoiceLeg = await TuitionFee.create({
      studentId: studentLeg._id,
      studentName: studentLeg.fullName,
      studentCode: studentLeg.studentCode,
      classroomId: classLeg._id,
      className: classLeg.name,
      period: '11-2026',
      tuitionBase: 2500000,
      totalAmount: 2500000,
      paidAmount: 0,
      status: 'unpaid',
      dueDate: new Date('2026-11-20')
    });
  });

  const makeMockReq = ({ user, tenantId, params = {}, query = {}, body = {}, headers = {}, isLegacy } = {}) => ({
    user,
    tenantId: tenantId !== undefined ? tenantId : user?.tenantId,
    params,
    query,
    body,
    isLegacy,
    headers: { ...headers },
    get: (name) => {
      const lower = name.toLowerCase();
      if (lower === 'x-tenant-id') return headers['x-tenant-id'] || (tenantId !== undefined ? String(tenantId || '') : String(user?.tenantId || ''));
      if (lower === 'idempotency-key') return headers['idempotency-key'];
      return headers[lower];
    }
  });

  const makeMockRes = () => {
    const chunks = [];
    const res = {
      statusCode: 200,
      body: null,
      headers: {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
      setHeader(name, val) {
        this.headers[name] = val;
      },
      write(chunk) {
        chunks.push(Buffer.from(chunk));
        return true;
      },
      end(chunk) {
        if (chunk) chunks.push(Buffer.from(chunk));
        this.bodyBuffer = Buffer.concat(chunks);
        return this;
      }
    };
    return res;
  };

  // =========================================================================
  // NHÓM A: PHÂN QUYỀN, TENANT BOUNDARY VÀ CONTEXT ENFORCEMENT
  // =========================================================================
  describe('Nhóm A: Phân quyền, tenant boundary và context enforcement', () => {
    it('A.1: Context giả mạo hoặc user/context mismatch bị chặn HTTP 403 (Fail-Closed)', async () => {
      // User Tenant A gửi kèm tenantId của Tenant B
      const reqMismatched = makeMockReq({
        user: accountantA,
        tenantId: tenantB._id,
        body: { invoiceId: invoiceA1._id, amount: 500000, method: 'cash' },
        headers: { 'idempotency-key': 'PAY-MISMATCH-1' }
      });
      const res = makeMockRes();

      await financeController.makePayment(reqMismatched, res);
      expect(res.statusCode).toBe(403);
    });

    it('A.2: Client cố tình đưa tenantId ngoại lai trong body không đổi được tenant của document', async () => {
      const req = makeMockReq({
        user: accountantA,
        body: {
          invoiceId: invoiceA1._id,
          amount: 500000,
          method: 'cash',
          tenantId: tenantB._id, // Cố tình truyền tenantId của trường B
          recordedBy: adminB._id  // Cố tình truyền user trường B
        },
        headers: { 'idempotency-key': 'PAY-OVERRIDE-ATTEMPT-1' }
      });
      const res = makeMockRes();

      await financeController.makePayment(req, res);
      expect(res.statusCode).toBe(201);
      expect(res.body.success !== false).toBe(true);

      const savedPayment = await Payment.findOne({ invoiceId: invoiceA1._id });
      expect(savedPayment).not.toBeNull();
      expect(String(savedPayment.tenantId)).toBe(String(tenantA._id)); // Vẫn là Tenant A
      expect(String(savedPayment.recordedBy)).toBe(String(accountantA._id)); // Vẫn là accountant A
    });

    it('A.3: Quyền không đủ: giáo viên hoặc phụ huynh gọi makePayment bị từ chối 403', async () => {
      const reqTeacher = makeMockReq({
        user: teacherA,
        body: { invoiceId: invoiceA1._id, amount: 500000, method: 'cash' },
        headers: { 'idempotency-key': 'PAY-TEACHER-1' }
      });
      const res = makeMockRes();

      await financeController.makePayment(reqTeacher, res);
      expect(res.statusCode).toBe(403);
    });

    it('A.4: Phụ huynh chỉ được xem biên lai của con mình; xem của học sinh khác bị 403', async () => {
      // Tạo payment cho invoiceA1 (con của parentA)
      const payA1 = await Payment.create({
        tenantId: tenantA._id,
        invoiceId: invoiceA1._id,
        amount: 1000000,
        method: 'cash',
        receiptNumber: 'PT-TEST-A1',
        idempotencyKey: 'PAY-RECEIPT-A1',
        recordedBy: accountantA._id
      });

      // Xem biên lai của con mình -> thành công
      const reqOwn = makeMockReq({ user: parentA, params: { paymentId: payA1._id } });
      const resOwn = makeMockRes();
      await financeController.getReceipt(reqOwn, resOwn);
      expect(resOwn.statusCode).toBe(200);
      expect(resOwn.body.success).toBe(true);

      // Tạo học sinh A2 và payment cho A2 (thuộc Tenant A nhưng không phải con parentA)
      const studentA2 = await Student.create({
        tenantId: tenantA._id,
        studentCode: 'HS-2026-000004',
        fullName: 'Trần Thị Bình',
        birthDate: new Date('2022-08-15'),
        gender: 'female',
        classroomId: classA1._id,
        className: classA1.name,
        status: 'enrolled'
      });
      const invoiceA2 = await TuitionFee.create({
        tenantId: tenantA._id,
        studentId: studentA2._id,
        studentName: studentA2.fullName,
        studentCode: studentA2.studentCode,
        classroomId: classA1._id,
        className: classA1.name,
        period: '11-2026',
        tuitionBase: 2000000,
        totalAmount: 2000000,
        paidAmount: 0,
        status: 'unpaid',
        dueDate: new Date('2026-11-20')
      });
      const payA2 = await Payment.create({
        tenantId: tenantA._id,
        invoiceId: invoiceA2._id,
        amount: 500000,
        method: 'cash',
        receiptNumber: 'PT-TEST-A2',
        idempotencyKey: 'PAY-RECEIPT-A2',
        recordedBy: accountantA._id
      });

      // parentA cố xem biên lai của A2 -> 403
      const reqOther = makeMockReq({ user: parentA, params: { paymentId: payA2._id } });
      const resOther = makeMockRes();
      await financeController.getReceipt(reqOther, resOther);
      expect(resOther.statusCode).toBe(403);
    });

    it('A.5: Kế toán Tenant A gọi getPaymentsByInvoice / getReceipt với dữ liệu của Tenant B nhận 404', async () => {
      const payB1 = await Payment.create({
        tenantId: tenantB._id,
        invoiceId: invoiceB1._id,
        amount: 1500000,
        method: 'cash',
        receiptNumber: 'PT-TEST-B1',
        idempotencyKey: 'PAY-RECEIPT-B1',
        recordedBy: accountantB._id
      });

      const reqHistory = makeMockReq({ user: accountantA, params: { invoiceId: invoiceB1._id } });
      const resHistory = makeMockRes();
      await financeController.getPaymentsByInvoice(reqHistory, resHistory);
      expect(resHistory.statusCode).toBe(404);

      const reqReceipt = makeMockReq({ user: accountantA, params: { paymentId: payB1._id } });
      const resReceipt = makeMockRes();
      await financeController.getReceipt(reqReceipt, resReceipt);
      expect(resReceipt.statusCode).toBe(404);
    });
  });

  // =========================================================================
  // NHÓM B: THANH TOÁN HỌC PHÍ (PAYMENTS) & IDEMPOTENCY & NOTIFICATIONS
  // =========================================================================
  describe('Nhóm B: Thanh toán học phí (Payments) & Idempotency & Notifications', () => {
    it('B.1: Happy path: Thu tiền thành công, gán tenantId, cập nhật TuitionFee chính xác', async () => {
      const req = makeMockReq({
        user: accountantA,
        body: {
          invoiceId: invoiceA1._id,
          amount: 1000000,
          method: 'bank_transfer',
          txnRef: 'TXN-A1-001',
          note: 'Thu đợt 1'
        },
        headers: { 'idempotency-key': 'IDEMP-PAY-1' }
      });
      const res = makeMockRes();

      await financeController.makePayment(req, res);
      expect(res.statusCode).toBe(201);
      expect(res.body.replayed).toBe(false);
      expect(res.body.data.invoice.paidAmount).toBe(1000000);
      expect(res.body.data.invoice.status).toBe('partial');

      // Kiểm tra Payment lưu trong DB
      const paymentDoc = await Payment.findOne({ invoiceId: invoiceA1._id });
      expect(paymentDoc).not.toBeNull();
      expect(String(paymentDoc.tenantId)).toBe(String(tenantA._id));
      expect(paymentDoc.amount).toBe(1000000);
      expect(paymentDoc.txnRef).toBe('TXN-A1-001');
      expect(paymentDoc.auditTrail.length).toBe(1);
      expect(String(paymentDoc.auditTrail[0].actorId)).toBe(String(accountantA._id));

      // Kiểm tra TuitionFee trong DB
      const updatedInvoice = await TuitionFee.findById(invoiceA1._id);
      expect(updatedInvoice.paidAmount).toBe(1000000);
      expect(updatedInvoice.status).toBe('partial');
    });

    it('B.2: Idempotency replay: Gửi lại cùng key và payload -> replayed: true, không tạo doc mới', async () => {
      const req1 = makeMockReq({
        user: accountantA,
        body: { invoiceId: invoiceA1._id, amount: 500000, method: 'cash', note: 'Đợt 1' },
        headers: { 'idempotency-key': 'IDEMP-REPLAY-1' }
      });
      const res1 = makeMockRes();
      await financeController.makePayment(req1, res1);
      expect(res1.statusCode).toBe(201);
      expect(res1.body.replayed).toBe(false);

      const req2 = makeMockReq({
        user: accountantA,
        body: { invoiceId: invoiceA1._id, amount: 500000, method: 'cash', note: 'Đợt 1' },
        headers: { 'idempotency-key': 'IDEMP-REPLAY-1' }
      });
      const res2 = makeMockRes();
      await financeController.makePayment(req2, res2);
      expect(res2.statusCode).toBe(200);
      expect(res2.body.replayed).toBe(true);

      const count = await Payment.countDocuments({ invoiceId: invoiceA1._id });
      expect(count).toBe(1);
    });

    it('B.3: Idempotency conflict: Gửi lại cùng key nhưng khác payload -> trả về HTTP 409', async () => {
      const req1 = makeMockReq({
        user: accountantA,
        body: { invoiceId: invoiceA1._id, amount: 500000, method: 'cash' },
        headers: { 'idempotency-key': 'IDEMP-CONFLICT-1' }
      });
      const res1 = makeMockRes();
      await financeController.makePayment(req1, res1);
      expect(res1.statusCode).toBe(201);

      const req2 = makeMockReq({
        user: accountantA,
        body: { invoiceId: invoiceA1._id, amount: 700000, method: 'cash' }, // Khác số tiền
        headers: { 'idempotency-key': 'IDEMP-CONFLICT-1' }
      });
      const res2 = makeMockRes();
      await financeController.makePayment(req2, res2);
      expect(res2.statusCode).toBe(409);
      expect(res2.body.message).toContain('Mã yêu cầu này đã dùng cho khoản thu khác');
    });

    it('B.4: Chống thu tiền cho hóa đơn của Tenant B từ Tenant A -> HTTP 404', async () => {
      const req = makeMockReq({
        user: accountantA,
        body: { invoiceId: invoiceB1._id, amount: 500000, method: 'cash' },
        headers: { 'idempotency-key': 'PAY-CROSS-TENANT' }
      });
      const res = makeMockRes();

      await financeController.makePayment(req, res);
      expect(res.statusCode).toBe(404);
      expect(res.body.message).toContain('Không tìm thấy hóa đơn');
    });

    it('B.5: Chống thu vượt số còn lại của hóa đơn -> HTTP 422', async () => {
      const req = makeMockReq({
        user: accountantA,
        body: { invoiceId: invoiceA1._id, amount: 5000000, method: 'cash' }, // Tổng nợ là 3.000.000đ
        headers: { 'idempotency-key': 'PAY-OVERFLOW-1' }
      });
      const res = makeMockRes();

      await financeController.makePayment(req, res);
      expect(res.statusCode).toBe(422);
      expect(res.body.message).toContain('Số tiền thanh toán vượt quá số tiền còn lại');
    });

    it('B.6: Chống thu tiền cho hóa đơn đã bị hủy (status: cancelled) -> HTTP 400', async () => {
      invoiceA1.status = 'cancelled';
      await invoiceA1.save();

      const req = makeMockReq({
        user: accountantA,
        body: { invoiceId: invoiceA1._id, amount: 500000, method: 'cash' },
        headers: { 'idempotency-key': 'PAY-CANCELLED-1' }
      });
      const res = makeMockRes();

      await financeController.makePayment(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain('Hóa đơn đã bị hủy');
    });

    it('B.7: Xung đột Global Unique Index txnRef với tenant khác -> HTTP 409 có kiểm soát', async () => {
      // Tenant B đã có giao dịch ngân hàng với txnRef 'TXN-GLOBAL-SHARED'
      await Payment.create({
        tenantId: tenantB._id,
        invoiceId: invoiceB1._id,
        amount: 1000000,
        method: 'bank_transfer',
        txnRef: 'TXN-GLOBAL-SHARED',
        receiptNumber: 'PT-B-GLOBAL-1',
        idempotencyKey: 'IDEMP-B-1',
        recordedBy: accountantB._id
      });

      // Tenant A cố ghi nhận giao dịch với cùng txnRef
      const req = makeMockReq({
        user: accountantA,
        body: {
          invoiceId: invoiceA1._id,
          amount: 500000,
          method: 'bank_transfer',
          txnRef: 'TXN-GLOBAL-SHARED'
        },
        headers: { 'idempotency-key': 'IDEMP-A-GLOBAL-ATTEMPT' }
      });
      const res = makeMockRes();

      await financeController.makePayment(req, res);
      expect(res.statusCode).toBe(409);
      // Không để lộ raw MongoDB error hoặc tenant sở hữu
      expect(res.body.message).not.toContain('MongoServerError');
      expect(res.body.message).not.toContain('E11000');
    });

    it('B.8: Thông báo thanh toán chỉ gửi đến phụ huynh và hiệu trưởng của Tenant A', async () => {
      const req = makeMockReq({
        user: accountantA,
        body: { invoiceId: invoiceA1._id, amount: 500000, method: 'cash' },
        headers: { 'idempotency-key': 'PAY-NOTIF-1' }
      });
      const res = makeMockRes();

      await financeController.makePayment(req, res);
      expect(res.statusCode).toBe(201);

      const notifs = await Notification.find({ type: 'finance' });
      expect(notifs.length).toBeGreaterThan(0);

      const recipientIds = notifs.map((n) => String(n.recipientId));
      expect(recipientIds).toContain(String(parentA._id));
      expect(recipientIds).toContain(String(principalA._id));

      // Tuyệt đối không gửi cho phụ huynh hoặc admin/hiệu trưởng trường B
      expect(recipientIds).not.toContain(String(adminB._id));
      expect(recipientIds).not.toContain(String(principalB._id));
    });
  });

  // =========================================================================
  // NHÓM C: ĐỀ NGHỊ VÀ CHI TRẢ HOÀN PHÍ (TUITION REFUND)
  // =========================================================================
  describe('Nhóm C: Đề nghị và chi trả hoàn phí (Tuition Refund)', () => {
    beforeEach(async () => {
      // Giả sử invoiceA1 đã thu 2.000.000đ
      invoiceA1.paidAmount = 2000000;
      invoiceA1.status = 'partial';
      await invoiceA1.save();

      invoiceB1.paidAmount = 3000000;
      invoiceB1.status = 'partial';
      await invoiceB1.save();
    });

    it('C.1: Happy path: Lập đề nghị hoàn tiền thành công và gán đúng tenantId', async () => {
      const req = makeMockReq({
        user: accountantA,
        body: { invoiceId: invoiceA1._id, amount: 500000, reason: 'Học sinh chuyển trường trả lại tiền ăn' }
      });
      const res = makeMockRes();

      await tuitionRefundController.createRefundRequest(req, res);
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('pending');

      const saved = await TuitionRefundRequest.findById(res.body.data._id);
      expect(saved).not.toBeNull();
      expect(String(saved.tenantId)).toBe(String(tenantA._id));
      expect(String(saved.requestedBy)).toBe(String(accountantA._id));
    });

    it('C.2: Duyệt đề nghị hoàn tiền: Hiệu trưởng duyệt thành công, người lập không được tự duyệt', async () => {
      const refund = await TuitionRefundRequest.create({
        tenantId: tenantA._id,
        invoiceId: invoiceA1._id,
        amount: 500000,
        reason: 'Hoàn tiền cơ sở vật chất',
        requestedBy: adminA._id,
        requestedByName: 'Quản trị viên A',
        status: 'pending'
      });

      // Người lập tự duyệt -> bị từ chối 403
      const reqSelf = makeMockReq({
        user: adminA,
        params: { id: refund._id },
        body: { decision: 'approved', reviewNote: 'Tự duyệt' }
      });
      const resSelf = makeMockRes();
      await tuitionRefundController.reviewRefundRequest(reqSelf, resSelf);
      expect(resSelf.statusCode).toBe(403);
      expect(resSelf.body.message).toContain('Người lập yêu cầu không được tự duyệt');

      // Hiệu trưởng duyệt -> thành công
      const reqPrincipal = makeMockReq({
        user: principalA,
        params: { id: refund._id },
        body: { decision: 'approved', reviewNote: 'Đồng ý hoàn tiền' }
      });
      const resPrincipal = makeMockRes();
      await tuitionRefundController.reviewRefundRequest(reqPrincipal, resPrincipal);
      expect(resPrincipal.statusCode).toBe(200);
      expect(resPrincipal.body.data.status).toBe('approved');
    });

    it('C.3: Chi trả hoàn tiền: Tạo InvoiceAdjustment, giảm paidAmount hóa đơn, gán tenantId', async () => {
      const refund = await TuitionRefundRequest.create({
        tenantId: tenantA._id,
        invoiceId: invoiceA1._id,
        amount: 500000,
        reason: 'Hoàn tiền học hè',
        requestedBy: accountantA._id,
        requestedByName: 'Kế toán A',
        reviewedBy: adminA._id,
        reviewedByName: 'Hiệu trưởng A',
        reviewedAt: new Date('2026-11-01'),
        status: 'approved'
      });

      const today = getWorkDate();
      const req = makeMockReq({
        user: accountantA,
        params: { id: refund._id },
        body: {
          paidDate: today,
          method: 'bank_transfer',
          transactionRef: 'REFUND-TXN-001',
          documentNumber: 'PC-REFUND-001'
        },
        headers: { 'idempotency-key': 'KEY-REFUND-PAY-1' }
      });
      const res = makeMockRes();

      await tuitionRefundController.payRefundRequest(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.replayed).toBe(false);

      // Kiểm tra hóa đơn bị giảm số đã thu: 2.000.000 - 500.000 = 1.500.000đ
      const invAfter = await TuitionFee.findById(invoiceA1._id);
      expect(invAfter.paidAmount).toBe(1500000);

      // Kiểm tra InvoiceAdjustment tạo ra có tenantId đúng
      const adj = await InvoiceAdjustment.findById(res.body.data.adjustment._id);
      expect(adj).not.toBeNull();
      expect(String(adj.tenantId)).toBe(String(tenantA._id));
      expect(adj.type).toBe('refund');
      expect(adj.amount).toBe(500000);

      // Kiểm tra trạng thái request
      const reqAfter = await TuitionRefundRequest.findById(refund._id);
      expect(reqAfter.status).toBe('paid');
    });

    it('C.4: Replay idempotency khi chi trả hoàn phí', async () => {
      const refund = await TuitionRefundRequest.create({
        tenantId: tenantA._id,
        invoiceId: invoiceA1._id,
        amount: 300000,
        reason: 'Hoàn tiền xe bus',
        requestedBy: accountantA._id,
        requestedByName: 'Kế toán A',
        reviewedBy: adminA._id,
        reviewedByName: 'Hiệu trưởng A',
        reviewedAt: new Date('2026-11-01'),
        status: 'approved'
      });

      const today = getWorkDate();
      const req1 = makeMockReq({
        user: accountantA,
        params: { id: refund._id },
        body: { paidDate: today, method: 'cash', documentNumber: 'PC-BUS-1' },
        headers: { 'idempotency-key': 'KEY-REFUND-REPLAY-1' }
      });
      const res1 = makeMockRes();
      await tuitionRefundController.payRefundRequest(req1, res1);
      expect(res1.statusCode).toBe(200);
      expect(res1.body.data.replayed).toBe(false);

      // Gửi lại cùng key
      const req2 = makeMockReq({
        user: accountantA,
        params: { id: refund._id },
        body: { paidDate: today, method: 'cash', documentNumber: 'PC-BUS-1' },
        headers: { 'idempotency-key': 'KEY-REFUND-REPLAY-1' }
      });
      const res2 = makeMockRes();
      await tuitionRefundController.payRefundRequest(req2, res2);
      expect(res2.statusCode).toBe(200);
      expect(res2.body.data.replayed).toBe(true);
    });

    it('C.5: Chống hoàn vượt quá số tiền đã thu của hóa đơn -> HTTP 422', async () => {
      const req = makeMockReq({
        user: accountantA,
        body: { invoiceId: invoiceA1._id, amount: 2500000, reason: 'Hoàn vượt số đã thu' } // Đã thu 2.000.000
      });
      const res = makeMockRes();

      await tuitionRefundController.createRefundRequest(req, res);
      expect(res.statusCode).toBe(422);
      expect(res.body.message).toContain('Hóa đơn không còn đủ số đã thu');
    });

    it('C.6: Tenant A không thể xem, duyệt hoặc chi trả đề nghị hoàn tiền của Tenant B (404)', async () => {
      const refundB = await TuitionRefundRequest.create({
        tenantId: tenantB._id,
        invoiceId: invoiceB1._id,
        amount: 500000,
        reason: 'Hoàn tiền trường B',
        requestedBy: accountantB._id,
        requestedByName: 'Kế toán B',
        status: 'pending'
      });

      // Tenant A xem danh sách với invoice của B -> không thấy
      const reqList = makeMockReq({ user: accountantA, query: { invoiceId: invoiceB1._id } });
      const resList = makeMockRes();
      await tuitionRefundController.listRefundRequests(reqList, resList);
      expect(resList.statusCode).toBe(200);
      expect(resList.body.data.length).toBe(0);

      // Tenant A duyệt đề nghị của B -> 404
      const reqReview = makeMockReq({
        user: adminA,
        params: { id: refundB._id },
        body: { decision: 'approved', reviewNote: 'Duyệt trái phép' }
      });
      const resReview = makeMockRes();
      await tuitionRefundController.reviewRefundRequest(reqReview, resReview);
      expect(resReview.statusCode).toBe(404);

      // Tenant A chi trả đề nghị của B -> 404
      const reqPay = makeMockReq({
        user: accountantA,
        params: { id: refundB._id },
        body: { paidDate: getWorkDate(), method: 'cash', documentNumber: 'PC-HACK-1' },
        headers: { 'idempotency-key': 'KEY-HACK-1' }
      });
      const resPay = makeMockRes();
      await tuitionRefundController.payRefundRequest(reqPay, resPay);
      expect(resPay.statusCode).toBe(404);
    });
  });

  // =========================================================================
  // NHÓM D: CHI VẬN HÀNH (OPERATING EXPENSES)
  // =========================================================================
  describe('Nhóm D: Chi vận hành (Operating Expenses)', () => {
    it('D.1: Happy path: Tạo đề nghị chi vận hành thành công và lưu đúng tenantId', async () => {
      const req = makeMockReq({
        user: accountantA,
        body: {
          category: 'utilities',
          payee: 'Công ty Điện Lực',
          description: 'Tiền điện tháng 11',
          amount: 5000000
        },
        headers: { 'idempotency-key': 'REQ-EXP-UTIL-1' }
      });
      const res = makeMockRes();

      await operatingExpenseController.createOperatingExpenseRequest(req, res);
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);

      const saved = await OperatingExpenseRequest.findOne({ requestKey: 'REQ-EXP-UTIL-1' });
      expect(saved).not.toBeNull();
      expect(String(saved.tenantId)).toBe(String(tenantA._id));
      expect(saved.category).toBe('utilities');
      expect(saved.amount).toBe(5000000);
    });

    it('D.2: Duyệt đề nghị chi: Hiệu trưởng duyệt thành công, người lập không được tự duyệt', async () => {
      const opReq = await OperatingExpenseRequest.create({
        tenantId: tenantA._id,
        category: 'rent',
        payee: 'Chủ nhà',
        description: 'Tiền thuê mặt bằng',
        amount: 20000000,
        requestKey: 'REQ-RENT-1',
        requestedBy: accountantA._id,
        requestedByName: 'Kế toán A',
        status: 'pending'
      });

      // Người lập tự duyệt -> 403
      const reqSelf = makeMockReq({
        user: accountantA,
        params: { id: opReq._id },
        body: { decision: 'approved', reviewNote: 'Tự duyệt' }
      });
      const resSelf = makeMockRes();
      await operatingExpenseController.reviewOperatingExpenseRequest(reqSelf, resSelf);
      expect(resSelf.statusCode).toBe(403);

      // Hiệu trưởng duyệt -> 200
      const reqAdmin = makeMockReq({
        user: adminA,
        params: { id: opReq._id },
        body: { decision: 'approved', reviewNote: 'Đồng ý chi trả' }
      });
      const resAdmin = makeMockRes();
      await operatingExpenseController.reviewOperatingExpenseRequest(reqAdmin, resAdmin);
      expect(resAdmin.statusCode).toBe(200);
      expect(resAdmin.body.data.status).toBe('approved');
    });

    it('D.3: Ghi nhận chi vận hành: Tạo OperatingExpense có tenantId, cập nhật request thành paid', async () => {
      const opReq = await OperatingExpenseRequest.create({
        tenantId: tenantA._id,
        category: 'maintenance',
        payee: 'Công ty Sửa Chữa',
        description: 'Sửa điều hòa phòng học',
        amount: 1500000,
        requestKey: 'REQ-MAINT-1',
        requestedBy: accountantA._id,
        requestedByName: 'Kế toán A',
        reviewedBy: adminA._id,
        reviewedByName: 'Hiệu trưởng A',
        reviewedAt: new Date('2026-11-01'),
        status: 'approved'
      });

      const today = getWorkDate();
      const req = makeMockReq({
        user: accountantA,
        body: {
          requestId: opReq._id,
          paidAt: today,
          method: 'bank_transfer',
          transactionRef: 'OP-TXN-001',
          documentNumber: 'PC-OP-001',
          note: 'Đã chuyển khoản thành công'
        },
        headers: { 'idempotency-key': 'KEY-OP-PAY-1' }
      });
      const res = makeMockRes();

      await operatingExpenseController.recordOperatingExpense(req, res);
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);

      const expense = await OperatingExpense.findOne({ documentNumber: 'PC-OP-001' });
      expect(expense).not.toBeNull();
      expect(String(expense.tenantId)).toBe(String(tenantA._id));
      expect(expense.amount).toBe(1500000);
      expect(expense.transactionRef).toBe('OP-TXN-001');

      const updatedReq = await OperatingExpenseRequest.findById(opReq._id);
      expect(updatedReq.status).toBe('paid');
      expect(String(updatedReq.expenseId)).toBe(String(expense._id));
    });

    it('D.4: Tenant A không xem, không duyệt và không ghi chi cho đề nghị của Tenant B (404)', async () => {
      const opReqB = await OperatingExpenseRequest.create({
        tenantId: tenantB._id,
        category: 'services',
        payee: 'Dịch vụ vệ sinh',
        description: 'Dọn vệ sinh trường B',
        amount: 2000000,
        requestKey: 'REQ-B-CLEAN-1',
        requestedBy: accountantB._id,
        requestedByName: 'Kế toán B',
        status: 'pending'
      });

      const reqReview = makeMockReq({
        user: adminA,
        params: { id: opReqB._id },
        body: { decision: 'approved', reviewNote: 'Trái phép' }
      });
      const resReview = makeMockRes();
      await operatingExpenseController.reviewOperatingExpenseRequest(reqReview, resReview);
      expect(resReview.statusCode).toBe(404);

      const reqPay = makeMockReq({
        user: accountantA,
        body: { requestId: opReqB._id, paidAt: getWorkDate(), method: 'cash', documentNumber: 'PC-X-1' },
        headers: { 'idempotency-key': 'KEY-X-1' }
      });
      const resPay = makeMockRes();
      await operatingExpenseController.recordOperatingExpense(reqPay, resPay);
      expect(resPay.statusCode).toBe(404);
    });

    it('D.5: Sổ chi vận hành getOperatingExpenses chỉ hiển thị chi phí của đúng tenant', async () => {
      const today = getWorkDate();
      await OperatingExpense.create({
        tenantId: tenantA._id,
        category: 'utilities',
        payee: 'Điện Lực A',
        description: 'Tiền điện A',
        amount: 3000000,
        paidAt: new Date(`${today}T05:00:00.000Z`),
        method: 'cash',
        documentNumber: 'PC-EXP-A',
        approvalReference: 'DX-1',
        idempotencyKey: 'IDEMP-EXP-A',
        recordedBy: accountantA._id,
        recordedByName: 'Kế toán A'
      });

      await OperatingExpense.create({
        tenantId: tenantB._id,
        category: 'utilities',
        payee: 'Điện Lực B',
        description: 'Tiền điện B',
        amount: 4000000,
        paidAt: new Date(`${today}T05:00:00.000Z`),
        method: 'cash',
        documentNumber: 'PC-EXP-B',
        approvalReference: 'DX-2',
        idempotencyKey: 'IDEMP-EXP-B',
        recordedBy: accountantB._id,
        recordedByName: 'Kế toán B'
      });

      const req = makeMockReq({ user: accountantA, query: { month: today.slice(0, 7) } });
      const res = makeMockRes();
      await operatingExpenseController.getOperatingExpenses(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.summary.count).toBe(1);
      expect(res.body.summary.total).toBe(3000000);
      expect(res.body.data[0].payee).toBe('Điện Lực A');
    });

    it('D.6: Xung đột Global Unique Index trên requestKey giữa hai tenant -> HTTP 409 có kiểm soát', async () => {
      await OperatingExpenseRequest.create({
        tenantId: tenantB._id,
        category: 'other',
        payee: 'Đối tác B',
        description: 'Chi phí B',
        amount: 1000000,
        requestKey: 'SHARED-KEY-123',
        requestedBy: accountantB._id,
        requestedByName: 'Kế toán B',
        status: 'pending'
      });

      const req = makeMockReq({
        user: accountantA,
        body: {
          category: 'other',
          payee: 'Đối tác A',
          description: 'Chi phí A',
          amount: 1500000
        },
        headers: { 'idempotency-key': 'SHARED-KEY-123' }
      });
      const res = makeMockRes();
      await operatingExpenseController.createOperatingExpenseRequest(req, res);
      expect(res.statusCode).toBe(409);
      expect(res.body.message).not.toContain('MongoServerError');
      expect(res.body.message).not.toContain('E11000');
    });
  });

  // =========================================================================
  // NHÓM E: CHI MUA SẮM (PURCHASE EXPENSES)
  // =========================================================================
  describe('Nhóm E: Chi mua sắm (Purchase Expenses)', () => {
    let orderA;
    let orderB;

    beforeEach(async () => {
      const reqProcA = await ProcurementRequest.create({
        tenantId: tenantA._id,
        requesterId: accountantA._id,
        requesterName: 'Kế toán A',
        category: 'stationery',
        reason: 'Mua sắm văn phòng phẩm kỳ 11-2026',
        items: [{ itemName: 'Giấy A4', quantity: 10, unitPrice: 50000, totalPrice: 500000 }],
        totalEstimatedCost: 500000,
        status: 'approved_l1'
      });

      orderA = await PurchaseOrder.create({
        tenantId: tenantA._id,
        orderCode: 'PO-A-001',
        requestId: reqProcA._id,
        supplierName: 'Công ty Văn Phòng Phẩm A',
        items: [{ itemName: 'Giấy A4', quantity: 10, unitPrice: 50000, totalPrice: 500000 }],
        totalAmount: 500000,
        paidAmount: 0,
        status: 'delivered',
        createdBy: accountantA._id
      });

      const reqProcB = await ProcurementRequest.create({
        tenantId: tenantB._id,
        requesterId: accountantB._id,
        requesterName: 'Kế toán B',
        category: 'toy',
        reason: 'Mua đồ chơi giáo dục cho lớp 1B',
        items: [{ itemName: 'Đồ chơi thông minh', quantity: 5, unitPrice: 200000, totalPrice: 1000000 }],
        totalEstimatedCost: 1000000,
        status: 'approved_l1'
      });

      orderB = await PurchaseOrder.create({
        tenantId: tenantB._id,
        orderCode: 'PO-B-001',
        requestId: reqProcB._id,
        supplierName: 'Công ty Đồ Chơi B',
        items: [{ itemName: 'Đồ chơi thông minh', quantity: 5, unitPrice: 200000, totalPrice: 1000000 }],
        totalAmount: 1000000,
        paidAmount: 0,
        status: 'delivered',
        createdBy: accountantB._id
      });
    });

    it('E.1: Happy path: Ghi nhận chi mua sắm, lưu đúng tenantId và cập nhật PurchaseOrder.paidAmount', async () => {
      const today = getWorkDate();
      const req = makeMockReq({
        user: accountantA,
        body: {
          orderId: orderA._id,
          amount: 500000,
          paidAt: today,
          method: 'bank_transfer',
          transactionRef: 'PO-TXN-A-001',
          documentNumber: 'PC-PO-A-001',
          note: 'Thanh toán trọn gói đơn PO-A-001'
        },
        headers: { 'idempotency-key': 'KEY-PO-PAY-A1' }
      });
      const res = makeMockRes();

      await purchaseExpenseController.recordPurchaseExpense(req, res);
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);

      const expense = await PurchaseExpense.findOne({ orderId: orderA._id });
      expect(expense).not.toBeNull();
      expect(String(expense.tenantId)).toBe(String(tenantA._id));
      expect(expense.amount).toBe(500000);
      expect(expense.orderCode).toBe('PO-A-001');

      const orderUpdated = await PurchaseOrder.findById(orderA._id);
      expect(orderUpdated.paidAmount).toBe(500000);
    });

    it('E.2: Idempotency replay khi chi mua sắm', async () => {
      const today = getWorkDate();
      const req1 = makeMockReq({
        user: accountantA,
        body: {
          orderId: orderA._id,
          amount: 200000,
          paidAt: today,
          method: 'cash',
          documentNumber: 'PC-PO-PARTIAL-1'
        },
        headers: { 'idempotency-key': 'KEY-PO-REPLAY' }
      });
      const res1 = makeMockRes();
      await purchaseExpenseController.recordPurchaseExpense(req1, res1);
      expect(res1.statusCode).toBe(201);
      expect(res1.body.replayed).toBe(false);

      const req2 = makeMockReq({
        user: accountantA,
        body: {
          orderId: orderA._id,
          amount: 200000,
          paidAt: today,
          method: 'cash',
          documentNumber: 'PC-PO-PARTIAL-1'
        },
        headers: { 'idempotency-key': 'KEY-PO-REPLAY' }
      });
      const res2 = makeMockRes();
      await purchaseExpenseController.recordPurchaseExpense(req2, res2);
      expect(res2.statusCode).toBe(200);
      expect(res2.body.replayed).toBe(true);
    });

    it('E.3: Chống chi vượt giá trị đơn hàng còn lại -> HTTP 422', async () => {
      const today = getWorkDate();
      const req = makeMockReq({
        user: accountantA,
        body: {
          orderId: orderA._id,
          amount: 600000, // Đơn hàng chỉ 500.000đ
          paidAt: today,
          method: 'cash',
          documentNumber: 'PC-OVERFLOW'
        },
        headers: { 'idempotency-key': 'KEY-PO-OVER' }
      });
      const res = makeMockRes();

      await purchaseExpenseController.recordPurchaseExpense(req, res);
      expect(res.statusCode).toBe(422);
      expect(res.body.message).toContain('Số tiền chi vượt phần còn lại');
    });

    it('E.4: Cách ly tenant: Đơn hàng của Tenant B bị từ chối 404 khi Tenant A ghi chi', async () => {
      const today = getWorkDate();
      const req = makeMockReq({
        user: accountantA,
        body: {
          orderId: orderB._id, // Đơn hàng của Tenant B
          amount: 1000000,
          paidAt: today,
          method: 'cash',
          documentNumber: 'PC-HACK-B'
        },
        headers: { 'idempotency-key': 'KEY-HACK-PO-B' }
      });
      const res = makeMockRes();

      await purchaseExpenseController.recordPurchaseExpense(req, res);
      expect(res.statusCode).toBe(404);
      expect(res.body.message).toContain('Không tìm thấy đơn đặt hàng');

      // getExpenseOrders chỉ thấy đơn của Tenant A
      const reqOrders = makeMockReq({ user: accountantA });
      const resOrders = makeMockRes();
      await purchaseExpenseController.getExpenseOrders(reqOrders, resOrders);
      expect(resOrders.statusCode).toBe(200);
      expect(resOrders.body.data.length).toBe(1);
      expect(resOrders.body.data[0].orderCode).toBe('PO-A-001');
    });

    it('E.5: Tổng quan mua sắm getAccountingProcurementOverview chỉ tính toán dữ liệu của tenant mình', async () => {
      const reqA = makeMockReq({ user: accountantA, query: { period: '11-2026' } });
      const resA = makeMockRes();
      await financeController.getAccountingProcurementOverview(reqA, resA);
      expect(resA.statusCode).toBe(200);
      expect(resA.body.data.requests.length).toBe(1);
      expect(resA.body.data.requests[0].category).toBe('stationery'); // của trường A
      expect(resA.body.data.pendingEstimate).toBe(500000);
    });
  });

  // =========================================================================
  // NHÓM F: XUẤT EXCEL SỔ CHI VÀ BIÊN LAI
  // =========================================================================
  describe('Nhóm F: Xuất Excel sổ chi và biên lai', () => {
    it('F.1: exportPayments: Chỉ xuất các khoản thanh toán của đúng tenant', async () => {
      await Payment.create({
        tenantId: tenantA._id,
        invoiceId: invoiceA1._id,
        amount: 1000000,
        method: 'cash',
        receiptNumber: 'PT-EXPORT-A',
        idempotencyKey: 'IDEMP-EX-A',
        recordedBy: accountantA._id
      });

      await Payment.create({
        tenantId: tenantB._id,
        invoiceId: invoiceB1._id,
        amount: 2000000,
        method: 'cash',
        receiptNumber: 'PT-EXPORT-B',
        idempotencyKey: 'IDEMP-EX-B',
        recordedBy: accountantB._id
      });

      const reqA = makeMockReq({ user: accountantA, query: {} });
      const resA = makeMockRes();
      await financeExcelController.exportPayments(reqA, resA);
      expect(resA.statusCode).toBe(200);
      expect(resA.bodyBuffer).toBeDefined();

      // Kiểm tra lọc hóa đơn của tenant khác -> 404
      const reqCross = makeMockReq({ user: accountantA, query: { invoiceId: invoiceB1._id } });
      const resCross = makeMockRes();
      await financeExcelController.exportPayments(reqCross, resCross);
      expect(resCross.statusCode).toBe(404);
    });

    it('F.2: exportPurchaseExpenses: Chỉ xuất sổ chi mua sắm của tenant mình', async () => {
      const today = getWorkDate();
      await PurchaseExpense.create({
        tenantId: tenantA._id,
        orderId: new mongoose.Types.ObjectId(),
        orderCode: 'PO-EX-A',
        supplierName: 'Nhà cung cấp A',
        amount: 1000000,
        paidAt: new Date(`${today}T05:00:00.000Z`),
        method: 'cash',
        documentNumber: 'PC-PO-A',
        idempotencyKey: 'ID-PO-EX-A',
        recordedBy: accountantA._id,
        recordedByName: 'Kế toán A'
      });

      await PurchaseExpense.create({
        tenantId: tenantB._id,
        orderId: new mongoose.Types.ObjectId(),
        orderCode: 'PO-EX-B',
        supplierName: 'Nhà cung cấp B',
        amount: 2000000,
        paidAt: new Date(`${today}T05:00:00.000Z`),
        method: 'cash',
        documentNumber: 'PC-PO-B',
        idempotencyKey: 'ID-PO-EX-B',
        recordedBy: accountantB._id,
        recordedByName: 'Kế toán B'
      });

      const req = makeMockReq({ user: accountantA, query: { month: today.slice(0, 7) } });
      const res = makeMockRes();
      await financeExcelController.exportPurchaseExpenses(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.bodyBuffer).toBeDefined();
    });

    it('F.3: exportOperatingExpenses: Chỉ xuất chi vận hành của tenant mình; populate approvalRequestId an toàn', async () => {
      const today = getWorkDate();
      const opReqA = await OperatingExpenseRequest.create({
        tenantId: tenantA._id,
        category: 'utilities',
        payee: 'Công ty A',
        description: 'Mô tả A',
        amount: 1000000,
        requestKey: 'REQ-POP-A',
        requestedBy: accountantA._id,
        requestedByName: 'Kế toán A',
        reviewedByName: 'Hiệu trưởng A',
        status: 'approved'
      });

      await OperatingExpense.create({
        tenantId: tenantA._id,
        category: 'utilities',
        payee: 'Công ty A',
        description: 'Mô tả A',
        amount: 1000000,
        paidAt: new Date(`${today}T05:00:00.000Z`),
        method: 'cash',
        documentNumber: 'PC-OP-POP-A',
        approvalReference: 'DX-POP',
        approvalRequestId: opReqA._id,
        idempotencyKey: 'IDEMP-POP-A',
        recordedBy: accountantA._id,
        recordedByName: 'Kế toán A'
      });

      const req = makeMockReq({ user: accountantA, query: { month: today.slice(0, 7) } });
      const res = makeMockRes();
      await financeExcelController.exportOperatingExpenses(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.bodyBuffer).toBeDefined();
    });
  });

  // =========================================================================
  // NHÓM G: GIAO DỊCH NGUYÊN TỬ (TRANSACTION ROLLBACK) & ACTOR RE-VERIFY
  // =========================================================================
  describe('Nhóm G: Giao dịch nguyên tử (Transaction Rollback) & Actor Re-verify', () => {
    it('G.1: Re-verify actor trong session khi thanh toán: Tài khoản bị khóa -> rollback hoàn toàn; Happy path lưu embedded auditTrail', async () => {
      // 1. Rollback case: Khóa tài khoản accountantA trong DB
      accountantA.status = 'inactive';
      await accountantA.save();

      const reqFail = makeMockReq({
        user: accountantA, // req.user object cũ vẫn là active nhưng DB là inactive
        body: { invoiceId: invoiceA1._id, amount: 500000, method: 'cash' },
        headers: { 'idempotency-key': 'PAY-INACTIVE-ACTOR' }
      });
      const resFail = makeMockRes();

      await financeController.makePayment(reqFail, resFail);
      expect(resFail.statusCode).toBe(403);
      expect(resFail.body.message).toContain('Bạn không có quyền thu tiền hoặc tài khoản đã bị khóa');

      // Database nguyên vẹn: không tạo payment, hóa đơn giữ nguyên
      const paymentsFail = await Payment.find({ invoiceId: invoiceA1._id });
      expect(paymentsFail.length).toBe(0);

      const invFail = await TuitionFee.findById(invoiceA1._id);
      expect(invFail.paidAmount).toBe(0);

      // 2. Happy path đối ứng: Mở lại tài khoản accountantA -> thanh toán thành công, lưu đúng embedded auditTrail
      accountantA.status = 'active';
      await accountantA.save();

      const reqPass = makeMockReq({
        user: accountantA,
        body: { invoiceId: invoiceA1._id, amount: 500000, method: 'cash' },
        headers: { 'idempotency-key': 'PAY-ACTIVE-ACTOR-HAPPY' }
      });
      const resPass = makeMockRes();

      await financeController.makePayment(reqPass, resPass);
      expect(resPass.statusCode).toBe(201);

      const paymentPass = await Payment.findOne({ idempotencyKey: 'PAY-ACTIVE-ACTOR-HAPPY' });
      expect(paymentPass).not.toBeNull();
      expect(paymentPass.auditTrail).toBeDefined();
      expect(paymentPass.auditTrail.length).toBe(1);
      expect(paymentPass.auditTrail[0].action).toBe('created');
      expect(String(paymentPass.auditTrail[0].actorId)).toBe(String(accountantA._id));
    });

    it('G.2: Rollback thanh toán học phí: Lỗi ghi sau Payment.create -> rollback cả Payment lẫn writeVersion kỳ kế toán', async () => {
      const month = getWorkDate().slice(0, 7);
      const period = await AccountingPeriod.create({
        tenantId: tenantA._id,
        month,
        status: 'open',
        writeVersion: 1,
        revision: 1,
        snapshot: {},
        sourceHash: 'init-g2'
      });

      // Inject lỗi vào invoice.save bên trong session (sau khi lockOpenPeriod và Payment.create đã chạy)
      const origSave = TuitionFee.prototype.save;
      jest.spyOn(TuitionFee.prototype, 'save').mockImplementationOnce(function () {
        const err = new Error('Simulated Invoice Save Failure after Payment.create');
        err.statusCode = 500;
        throw err;
      });

      const req = makeMockReq({
        user: accountantA,
        body: { invoiceId: invoiceA1._id, amount: 500000, method: 'cash' },
        headers: { 'idempotency-key': 'PAY-ROLLBACK-AFTER-CREATE' }
      });
      const res = makeMockRes();

      await financeController.makePayment(req, res);
      expect(res.statusCode).toBe(500);

      TuitionFee.prototype.save = origSave;

      // Assert rollback:
      const payCount = await Payment.countDocuments({ invoiceId: invoiceA1._id });
      expect(payCount).toBe(0);

      const invAfter = await TuitionFee.findById(invoiceA1._id);
      expect(invAfter.paidAmount).toBe(0);

      const periodAfter = await AccountingPeriod.findById(period._id);
      expect(periodAfter.writeVersion).toBe(1);
    });

    it('G.3: Rollback chi trả hoàn phí: Lỗi ghi sau InvoiceAdjustment.create -> rollback cả adjustment, request và kỳ kế toán', async () => {
      const month = getWorkDate().slice(0, 7);
      const period = await AccountingPeriod.create({
        tenantId: tenantA._id,
        month,
        status: 'open',
        writeVersion: 1,
        revision: 1,
        snapshot: {},
        sourceHash: 'init-g3'
      });

      const refund = await TuitionRefundRequest.create({
        tenantId: tenantA._id,
        invoiceId: invoiceA1._id,
        amount: 500000,
        reason: 'Hoàn lỗi rollback',
        requestedBy: accountantA._id,
        requestedByName: 'Kế toán A',
        reviewedBy: adminA._id,
        reviewedByName: 'Hiệu trưởng A',
        reviewedAt: new Date('2026-11-01'),
        status: 'approved'
      });

      invoiceA1.paidAmount = 1000000;
      await invoiceA1.save();

      // Inject lỗi vào TuitionRefundRequest.prototype.save sau khi InvoiceAdjustment.create đã chạy
      const origReqSave = TuitionRefundRequest.prototype.save;
      jest.spyOn(TuitionRefundRequest.prototype, 'save').mockImplementationOnce(function () {
        const err = new Error('Simulated RefundRequest Save Failure');
        err.statusCode = 500;
        throw err;
      });

      const today = getWorkDate();
      const req = makeMockReq({
        user: accountantA,
        params: { id: refund._id },
        body: { paidDate: today, method: 'cash', documentNumber: 'PC-ERR-REF-1' },
        headers: { 'idempotency-key': 'KEY-REF-ROLLBACK' }
      });
      const res = makeMockRes();

      await tuitionRefundController.payRefundRequest(req, res);
      expect(res.statusCode).toBe(500);

      TuitionRefundRequest.prototype.save = origReqSave;

      // Assert rollback:
      const adjCount = await InvoiceAdjustment.countDocuments({ invoiceId: invoiceA1._id });
      expect(adjCount).toBe(0);

      const invAfter = await TuitionFee.findById(invoiceA1._id);
      expect(invAfter.paidAmount).toBe(1000000);

      const reqAfter = await TuitionRefundRequest.findById(refund._id);
      expect(reqAfter.status).toBe('approved');
      expect(reqAfter.paymentKey).toBeUndefined();

      const periodAfter = await AccountingPeriod.findById(period._id);
      expect(periodAfter.writeVersion).toBe(1);
    });

    it('G.4: Rollback chi mua sắm: Lỗi sau PurchaseExpense.create -> rollback cả expense, order và kỳ kế toán', async () => {
      const month = getWorkDate().slice(0, 7);
      const period = await AccountingPeriod.create({
        tenantId: tenantA._id,
        month,
        status: 'open',
        writeVersion: 1,
        revision: 1,
        snapshot: {},
        sourceHash: 'init-g4'
      });

      const order = await PurchaseOrder.create({
        tenantId: tenantA._id,
        orderCode: 'PO-ROLLBACK-1',
        requestId: new mongoose.Types.ObjectId(),
        supplierName: 'Nhà cung cấp Test',
        items: [{ itemName: 'Món A', quantity: 1, unitPrice: 100000, totalPrice: 100000 }],
        totalAmount: 100000,
        paidAmount: 0,
        status: 'delivered',
        createdBy: accountantA._id
      });

      const origOrderSave = PurchaseOrder.prototype.save;
      jest.spyOn(PurchaseOrder.prototype, 'save').mockImplementationOnce(function () {
        const err = new Error('Simulated Order Save Failure');
        err.statusCode = 500;
        throw err;
      });

      const today = getWorkDate();
      const req = makeMockReq({
        user: accountantA,
        body: {
          orderId: order._id,
          amount: 100000,
          paidAt: today,
          method: 'cash',
          documentNumber: 'PC-PO-ERR-1'
        },
        headers: { 'idempotency-key': 'KEY-PO-ERR-1' }
      });
      const res = makeMockRes();

      await purchaseExpenseController.recordPurchaseExpense(req, res);
      expect(res.statusCode).toBe(500);

      PurchaseOrder.prototype.save = origOrderSave;

      // Assert rollback:
      const orderAfter = await PurchaseOrder.findById(order._id);
      expect(orderAfter.paidAmount).toBe(0);

      const expCount = await PurchaseExpense.countDocuments({ orderId: order._id });
      expect(expCount).toBe(0);

      const periodAfter = await AccountingPeriod.findById(period._id);
      expect(periodAfter.writeVersion).toBe(1);
    });

    it('G.5: Rollback chi vận hành: Lỗi sau OperatingExpense.create -> rollback cả expense, request và kỳ kế toán', async () => {
      const month = getWorkDate().slice(0, 7);
      const period = await AccountingPeriod.create({
        tenantId: tenantA._id,
        month,
        status: 'open',
        writeVersion: 1,
        revision: 1,
        snapshot: {},
        sourceHash: 'init-g5'
      });

      const opReq = await OperatingExpenseRequest.create({
        tenantId: tenantA._id,
        category: 'utilities',
        payee: 'Công ty Điện Lực',
        description: 'Chi tiền điện rollback test',
        amount: 2000000,
        requestKey: 'REQ-OP-ROLLBACK-1',
        requestedBy: accountantA._id,
        requestedByName: 'Kế toán A',
        reviewedBy: adminA._id,
        reviewedByName: 'Hiệu trưởng A',
        reviewedAt: new Date('2026-11-01'),
        status: 'approved'
      });

      const origOpSave = OperatingExpenseRequest.prototype.save;
      jest.spyOn(OperatingExpenseRequest.prototype, 'save').mockImplementationOnce(function () {
        const err = new Error('Simulated OpRequest Save Failure');
        err.statusCode = 500;
        throw err;
      });

      const today = getWorkDate();
      const req = makeMockReq({
        user: accountantA,
        body: {
          requestId: opReq._id,
          paidAt: today,
          method: 'bank_transfer',
          transactionRef: 'TXN-OP-ROLLBACK',
          documentNumber: 'PC-OP-ROLLBACK-1'
        },
        headers: { 'idempotency-key': 'KEY-OP-ROLLBACK-1' }
      });
      const res = makeMockRes();

      await operatingExpenseController.recordOperatingExpense(req, res);
      expect(res.statusCode).toBe(500);

      OperatingExpenseRequest.prototype.save = origOpSave;

      // Assert rollback:
      const expCount = await OperatingExpense.countDocuments({ approvalRequestId: opReq._id });
      expect(expCount).toBe(0);

      const opReqAfter = await OperatingExpenseRequest.findById(opReq._id);
      expect(opReqAfter.status).toBe('approved');
      expect(opReqAfter.expenseId).toBeUndefined();

      const periodAfter = await AccountingPeriod.findById(period._id);
      expect(periodAfter.writeVersion).toBe(1);
    });
  });

  // =========================================================================
  // NHÓM H: CONCURRENCY & HANDSHAKE HAI LUỒNG XÁC ĐỊNH (BARRIER-BASED)
  // =========================================================================
  describe('Nhóm H: Concurrency & Handshake hai luồng xác định', () => {
    // Helper tạo deferred barrier với timeout tự động reject (không bao giờ tự resolve)
    const createBarrier = (name, timeoutMs = 8000) => {
      let resolveFn;
      let rejectFn;
      let timer;
      let settled = false;
      const promise = new Promise((res, rej) => {
        resolveFn = res;
        rejectFn = rej;
        timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            rej(new Error(`Barrier '${name}' timed out after ${timeoutMs}ms`));
          }
        }, timeoutMs);
      });
      return {
        promise,
        resolve: (val) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolveFn(val);
          }
        },
        reject: (err) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            rejectFn(err);
          }
        }
      };
    };

    it('H.1: Hai khoản thu cạnh tranh: không thu vượt hóa đơn (Handshake barrier hai luồng xác định)', async () => {
      invoiceA1.totalAmount = 1000000;
      invoiceA1.paidAmount = 0;
      invoiceA1.status = 'unpaid';
      await invoiceA1.save();

      const month = getWorkDate().slice(0, 7);
      await AccountingPeriod.create({
        tenantId: tenantA._id,
        month,
        status: 'open',
        writeVersion: 1,
        revision: 1,
        snapshot: {},
        sourceHash: 'init-h1'
      });

      let session1 = null;
      let session2 = null;
      const barrierThread1Holding = createBarrier('H.1_Thread1Holding', 8000);
      const barrierThread2Reached = createBarrier('H.1_Thread2Reached', 8000);
      const barrierThread1CanProceed = createBarrier('H.1_Thread1CanProceed', 8000);

      const origPaymentFindOne = Payment.findOne;
      jest.spyOn(Payment, 'findOne').mockImplementation(function (...args) {
        const query = origPaymentFindOne.apply(this, args);
        const origExec = query.exec.bind(query);
        query.exec = async function () {
          const session = query.getOptions().session;
          if (session && !session1) {
            session1 = session;
            barrierThread1Holding.resolve(session1);
            await barrierThread1CanProceed.promise;
          } else if (session && session1 && session !== session1 && !session2) {
            session2 = session;
            barrierThread2Reached.resolve(session2);
            barrierThread1CanProceed.resolve();
          }
          return await origExec();
        };
        return query;
      });

      const req1 = makeMockReq({
        user: accountantA,
        body: { invoiceId: invoiceA1._id, amount: 1000000, method: 'cash', note: 'Luồng 1' },
        headers: { 'idempotency-key': 'CONCUR-PAY-1' }
      });
      const res1 = makeMockRes();

      const req2 = makeMockReq({
        user: accountantA,
        body: { invoiceId: invoiceA1._id, amount: 1000000, method: 'cash', note: 'Luồng 2' },
        headers: { 'idempotency-key': 'CONCUR-PAY-2' }
      });
      const res2 = makeMockRes();

      let p1 = null;
      let p2 = null;

      try {
        p1 = financeController.makePayment(req1, res1);
        await barrierThread1Holding.promise;

        p2 = financeController.makePayment(req2, res2);
        await barrierThread2Reached.promise;

        await Promise.all([p1, p2]);

        expect(session1).toBeDefined();
        expect(session2).toBeDefined();
        expect(session1.id.id.toString('hex')).not.toBe(session2.id.id.toString('hex'));

        const statusCodes = [res1.statusCode, res2.statusCode].sort();
        expect(statusCodes[0]).toBe(201);
        expect([409, 422]).toContain(statusCodes[1]);

        const payCount = await Payment.countDocuments({ invoiceId: invoiceA1._id });
        expect(payCount).toBe(1);

        const totalPaid = (await Payment.find({ invoiceId: invoiceA1._id })).reduce((s, p) => s + p.amount, 0);
        expect(totalPaid).toBe(1000000);

        const invFinal = await TuitionFee.findById(invoiceA1._id);
        expect(invFinal.paidAmount).toBe(1000000);
        expect(invFinal.status).toBe('paid');

        const periodFinal = await AccountingPeriod.findOne({ tenantId: tenantA._id, month });
        expect(periodFinal.writeVersion).toBeGreaterThanOrEqual(2);
      } finally {
        barrierThread1CanProceed.resolve();
        Payment.findOne = origPaymentFindOne;
        await Promise.allSettled([p1, p2]);
      }
    });

    it('H.2: Hai khoản chi mua sắm cạnh tranh: không chi vượt đơn hàng (Handshake barrier hai luồng xác định)', async () => {
      const order = await PurchaseOrder.create({
        tenantId: tenantA._id,
        orderCode: 'PO-CONCUR-H2',
        requestId: new mongoose.Types.ObjectId(),
        supplierName: 'Công ty Cạnh Tranh H2',
        items: [{ itemName: 'Món B', quantity: 1, unitPrice: 500000, totalPrice: 500000 }],
        totalAmount: 500000,
        paidAmount: 0,
        status: 'delivered',
        createdBy: accountantA._id
      });

      const today = getWorkDate();
      const month = today.slice(0, 7);
      await AccountingPeriod.create({
        tenantId: tenantA._id,
        month,
        status: 'open',
        writeVersion: 1,
        revision: 1,
        snapshot: {},
        sourceHash: 'init-h2'
      });

      let session1 = null;
      let session2 = null;
      const barrierThread1Holding = createBarrier('H.2_Thread1Holding', 8000);
      const barrierThread2Reached = createBarrier('H.2_Thread2Reached', 8000);
      const barrierThread1CanProceed = createBarrier('H.2_Thread1CanProceed', 8000);

      const origExpenseFindOne = PurchaseExpense.findOne;
      jest.spyOn(PurchaseExpense, 'findOne').mockImplementation(function (...args) {
        const query = origExpenseFindOne.apply(this, args);
        const origExec = query.exec.bind(query);
        query.exec = async function () {
          const session = query.getOptions().session;
          if (session && !session1) {
            session1 = session;
            barrierThread1Holding.resolve(session1);
            await barrierThread1CanProceed.promise;
          } else if (session && session1 && session !== session1 && !session2) {
            session2 = session;
            barrierThread2Reached.resolve(session2);
            barrierThread1CanProceed.resolve();
          }
          return await origExec();
        };
        return query;
      });

      const req1 = makeMockReq({
        user: accountantA,
        body: { orderId: order._id, amount: 500000, paidAt: today, method: 'cash', documentNumber: 'PC-H2-1' },
        headers: { 'idempotency-key': 'KEY-PO-CONCUR-H2-1' }
      });
      const res1 = makeMockRes();

      const req2 = makeMockReq({
        user: accountantA,
        body: { orderId: order._id, amount: 500000, paidAt: today, method: 'cash', documentNumber: 'PC-H2-2' },
        headers: { 'idempotency-key': 'KEY-PO-CONCUR-H2-2' }
      });
      const res2 = makeMockRes();

      let p1 = null;
      let p2 = null;

      try {
        p1 = purchaseExpenseController.recordPurchaseExpense(req1, res1);
        await barrierThread1Holding.promise;

        p2 = purchaseExpenseController.recordPurchaseExpense(req2, res2);
        await barrierThread2Reached.promise;

        await Promise.all([p1, p2]);

        expect(session1).toBeDefined();
        expect(session2).toBeDefined();
        expect(session1.id.id.toString('hex')).not.toBe(session2.id.id.toString('hex'));

        const statusCodes = [res1.statusCode, res2.statusCode].sort();
        expect(statusCodes[0]).toBe(201);
        expect([409, 422]).toContain(statusCodes[1]);

        const expCount = await PurchaseExpense.countDocuments({ orderId: order._id });
        expect(expCount).toBe(1);

        const orderFinal = await PurchaseOrder.findById(order._id);
        expect(orderFinal.paidAmount).toBe(500000);

        const periodFinal = await AccountingPeriod.findOne({ tenantId: tenantA._id, month });
        expect(periodFinal.writeVersion).toBeGreaterThanOrEqual(2);
      } finally {
        barrierThread1CanProceed.resolve();
        PurchaseExpense.findOne = origExpenseFindOne;
        await Promise.allSettled([p1, p2]);
      }
    });

    it('H.3: Hai request chi cùng đề nghị vận hành: chỉ một khoản chi (Handshake barrier hai luồng xác định)', async () => {
      const today = getWorkDate();
      const month = today.slice(0, 7);
      await AccountingPeriod.create({
        tenantId: tenantA._id,
        month,
        status: 'open',
        writeVersion: 1,
        revision: 1,
        snapshot: {},
        sourceHash: 'init-h3'
      });

      const opReq = await OperatingExpenseRequest.create({
        tenantId: tenantA._id,
        category: 'maintenance',
        payee: 'Công ty Sửa Chữa H3',
        description: 'Chi sửa chữa bảo trì cạnh tranh H3',
        amount: 1500000,
        requestKey: 'REQ-OP-CONCUR-H3',
        requestedBy: accountantA._id,
        requestedByName: 'Kế toán A',
        reviewedBy: adminA._id,
        reviewedByName: 'Hiệu trưởng A',
        reviewedAt: new Date('2026-11-01'),
        status: 'approved'
      });

      let session1 = null;
      let session2 = null;
      const barrierThread1Holding = createBarrier('H.3_Thread1Holding', 8000);
      const barrierThread2Reached = createBarrier('H.3_Thread2Reached', 8000);
      const barrierThread1CanProceed = createBarrier('H.3_Thread1CanProceed', 8000);

      const origOpReqFindOne = OperatingExpenseRequest.findOne;
      jest.spyOn(OperatingExpenseRequest, 'findOne').mockImplementation(function (...args) {
        const query = origOpReqFindOne.apply(this, args);
        const origExec = query.exec.bind(query);
        query.exec = async function () {
          const session = query.getOptions().session;
          if (session && !session1) {
            session1 = session;
            barrierThread1Holding.resolve(session1);
            await barrierThread1CanProceed.promise;
          } else if (session && session1 && session !== session1 && !session2) {
            session2 = session;
            barrierThread2Reached.resolve(session2);
            barrierThread1CanProceed.resolve();
          }
          return await origExec();
        };
        return query;
      });

      const req1 = makeMockReq({
        user: accountantA,
        body: {
          requestId: opReq._id,
          paidAt: today,
          method: 'cash',
          documentNumber: 'PC-OP-H3-1',
          note: 'Luồng 1'
        },
        headers: { 'idempotency-key': 'KEY-OP-H3-1' }
      });
      const res1 = makeMockRes();

      const req2 = makeMockReq({
        user: accountantA,
        body: {
          requestId: opReq._id,
          paidAt: today,
          method: 'cash',
          documentNumber: 'PC-OP-H3-2',
          note: 'Luồng 2'
        },
        headers: { 'idempotency-key': 'KEY-OP-H3-2' }
      });
      const res2 = makeMockRes();

      let p1 = null;
      let p2 = null;

      try {
        p1 = operatingExpenseController.recordOperatingExpense(req1, res1);
        await barrierThread1Holding.promise;

        p2 = operatingExpenseController.recordOperatingExpense(req2, res2);
        await barrierThread2Reached.promise;

        await Promise.all([p1, p2]);

        expect(session1).toBeDefined();
        expect(session2).toBeDefined();
        expect(session1.id.id.toString('hex')).not.toBe(session2.id.id.toString('hex'));

        const statusCodes = [res1.statusCode, res2.statusCode].sort();
        expect(statusCodes[0]).toBe(201);
        expect(statusCodes[1]).toBe(409);

        const expCount = await OperatingExpense.countDocuments({ approvalRequestId: opReq._id });
        expect(expCount).toBe(1);

        const opReqFinal = await OperatingExpenseRequest.findById(opReq._id);
        expect(opReqFinal.status).toBe('paid');
        expect(['KEY-OP-H3-1', 'KEY-OP-H3-2']).toContain(opReqFinal.paymentKey);

        const periodFinal = await AccountingPeriod.findOne({ tenantId: tenantA._id, month });
        expect(periodFinal.writeVersion).toBeGreaterThanOrEqual(2);
      } finally {
        barrierThread1CanProceed.resolve();
        OperatingExpenseRequest.findOne = origOpReqFindOne;
        await Promise.allSettled([p1, p2]);
      }
    });

    it('H.4: Hai request chi cùng đề nghị hoàn phí: chỉ một adjustment, paidAmount giảm đúng một lần (Handshake barrier)', async () => {
      invoiceA1.paidAmount = 2000000;
      invoiceA1.status = 'partial';
      await invoiceA1.save();

      const today = getWorkDate();
      const month = today.slice(0, 7);
      await AccountingPeriod.create({
        tenantId: tenantA._id,
        month,
        status: 'open',
        writeVersion: 1,
        revision: 1,
        snapshot: {},
        sourceHash: 'init-h4'
      });

      const refund = await TuitionRefundRequest.create({
        tenantId: tenantA._id,
        invoiceId: invoiceA1._id,
        amount: 500000,
        reason: 'Hoàn tiền cạnh tranh H4',
        requestedBy: accountantA._id,
        requestedByName: 'Kế toán A',
        reviewedBy: adminA._id,
        reviewedByName: 'Hiệu trưởng A',
        reviewedAt: new Date('2026-11-01'),
        status: 'approved'
      });

      let session1 = null;
      let session2 = null;
      const barrierThread1Holding = createBarrier('H.4_Thread1Holding', 8000);
      const barrierThread2Reached = createBarrier('H.4_Thread2Reached', 8000);
      const barrierThread1CanProceed = createBarrier('H.4_Thread1CanProceed', 8000);

      const origRefundFindOne = TuitionRefundRequest.findOne;
      jest.spyOn(TuitionRefundRequest, 'findOne').mockImplementation(function (...args) {
        const query = origRefundFindOne.apply(this, args);
        const origExec = query.exec.bind(query);
        query.exec = async function () {
          const session = query.getOptions().session;
          if (session && !session1) {
            session1 = session;
            barrierThread1Holding.resolve(session1);
            await barrierThread1CanProceed.promise;
          } else if (session && session1 && session !== session1 && !session2) {
            session2 = session;
            barrierThread2Reached.resolve(session2);
            barrierThread1CanProceed.resolve();
          }
          return await origExec();
        };
        return query;
      });

      const req1 = makeMockReq({
        user: accountantA,
        params: { id: refund._id },
        body: { paidDate: today, method: 'cash', documentNumber: 'PC-REF-H4-1' },
        headers: { 'idempotency-key': 'KEY-REF-H4-1' }
      });
      const res1 = makeMockRes();

      const req2 = makeMockReq({
        user: accountantA,
        params: { id: refund._id },
        body: { paidDate: today, method: 'cash', documentNumber: 'PC-REF-H4-2' },
        headers: { 'idempotency-key': 'KEY-REF-H4-2' }
      });
      const res2 = makeMockRes();

      let p1 = null;
      let p2 = null;

      try {
        p1 = tuitionRefundController.payRefundRequest(req1, res1);
        await barrierThread1Holding.promise;

        p2 = tuitionRefundController.payRefundRequest(req2, res2);
        await barrierThread2Reached.promise;

        await Promise.all([p1, p2]);

        expect(session1).toBeDefined();
        expect(session2).toBeDefined();
        expect(session1.id.id.toString('hex')).not.toBe(session2.id.id.toString('hex'));

        const statusCodes = [res1.statusCode, res2.statusCode].sort();
        expect([200, 201]).toContain(statusCodes[0]);
        expect(statusCodes[1]).toBe(409);

        const adjCount = await InvoiceAdjustment.countDocuments({ invoiceId: invoiceA1._id });
        expect(adjCount).toBe(1);

        const invFinal = await TuitionFee.findById(invoiceA1._id);
        expect(invFinal.paidAmount).toBe(1500000);

        const refundFinal = await TuitionRefundRequest.findById(refund._id);
        expect(refundFinal.status).toBe('paid');
        expect(['KEY-REF-H4-1', 'KEY-REF-H4-2']).toContain(refundFinal.paymentKey);

        const periodFinal = await AccountingPeriod.findOne({ tenantId: tenantA._id, month });
        expect(periodFinal.writeVersion).toBeGreaterThanOrEqual(2);
      } finally {
        barrierThread1CanProceed.resolve();
        TuitionRefundRequest.findOne = origRefundFindOne;
        await Promise.allSettled([p1, p2]);
      }
    });

    it('H.5: Writer 1E.4 cạnh tranh closePeriod: không commit ghi trái phép vào kỳ đã đóng', async () => {
      // Dùng tháng kết thúc trong quá khứ để closePeriod thỏa mãn month < getWorkDate().slice(0, 7)
      const month = '2026-10';
      await AccountingPeriod.create({
        tenantId: tenantA._id,
        month,
        status: 'open',
        writeVersion: 1,
        revision: 1,
        snapshot: {},
        sourceHash: 'init-h5'
      });

      const orderH5 = await PurchaseOrder.create({
        tenantId: tenantA._id,
        orderCode: 'PO-CONCUR-H5',
        requestId: new mongoose.Types.ObjectId(),
        supplierName: 'Nhà cung cấp H5',
        items: [{ itemName: 'Món H5', quantity: 1, unitPrice: 300000, totalPrice: 300000 }],
        totalAmount: 300000,
        paidAmount: 0,
        status: 'delivered',
        createdBy: accountantA._id
      });

      let closeSession = null;
      let writerSession = null;
      const barrierCloseHoldingLock = createBarrier('H.5_CloseHoldingLock', 8000);
      const barrierWriterReachedLock = createBarrier('H.5_WriterReachedLock', 8000);
      const barrierCloseCanProceed = createBarrier('H.5_CloseCanProceed', 8000);

      const origAcctFindOneAndUpdate = AccountingPeriod.findOneAndUpdate;
      jest.spyOn(AccountingPeriod, 'findOneAndUpdate').mockImplementation(async function (...args) {
        const filter = args[0] || {};
        const update = args[1] || {};
        const options = args[2] || {};
        const session = options.session;

        // Điểm dừng closePeriod: sau khi tính xong báo cáo, chuẩn bị commit ghi status: 'closed'
        if (update.$set?.status === 'closed') {
          closeSession = session;
          barrierCloseHoldingLock.resolve(closeSession);
          await barrierCloseCanProceed.promise;
        }

        // Điểm quan sát writer: khi tới lockOpenPeriod trên đúng tháng 2026-10 của tenant
        if (update.$inc?.writeVersion && session && closeSession && session !== closeSession && filter.month === month) {
          writerSession = session;
          barrierWriterReachedLock.resolve();
          barrierCloseCanProceed.resolve();
        }

        return origAcctFindOneAndUpdate.apply(this, args);
      });

      const reqClose = makeMockReq({
        user: principalA,
        tenantId: tenantA._id,
        params: { month },
        body: { reason: 'Chốt kỳ kế toán tháng 10 cạnh tranh đồng thời H5' }
      });
      const resClose = makeMockRes();

      const reqWriter = makeMockReq({
        user: accountantA,
        body: {
          orderId: orderH5._id,
          amount: 300000,
          paidAt: '2026-10-25',
          method: 'cash',
          documentNumber: 'PC-H5'
        },
        headers: { 'idempotency-key': 'KEY-PO-CONCUR-H5' }
      });
      const resWriter = makeMockRes();

      let pClose = null;
      let pWriter = null;

      try {
        pClose = closePeriod(reqClose, resClose);
        await barrierCloseHoldingLock.promise;

        pWriter = purchaseExpenseController.recordPurchaseExpense(reqWriter, resWriter);
        await barrierWriterReachedLock.promise;

        await Promise.all([pClose, pWriter]);

        expect(closeSession).toBeDefined();
        expect(writerSession).toBeDefined();
        expect(writerSession.id.id.toString('hex')).not.toBe(closeSession.id.id.toString('hex'));

        expect(resClose.statusCode).toBe(200);
        expect(resClose.body.message).toContain('Đã chốt kỳ');

        expect(resWriter.statusCode).toBe(409);
        expect(resWriter.body.message).toContain('Kỳ kế toán đã chốt');

        const expCount = await PurchaseExpense.countDocuments({ orderId: orderH5._id });
        expect(expCount).toBe(0);

        const periodFinal = await AccountingPeriod.findOne({ tenantId: tenantA._id, month });
        expect(periodFinal.status).toBe('closed');
      } finally {
        barrierCloseCanProceed.resolve();
        AccountingPeriod.findOneAndUpdate = origAcctFindOneAndUpdate;
        await Promise.allSettled([pClose, pWriter]);
      }
    });
  });

  // =========================================================================
  // NHÓM I: KỲ KẾ TOÁN CÁCH LY & CỔNG SAAS FINANCE (HTTP 501)
  // =========================================================================
  describe('Nhóm I: Kỳ kế toán cách ly & Cổng SaaS Finance (HTTP 501)', () => {
    it('I.1a: Đọc phạm vi kỳ kế toán: assertOpen của Tenant B không bị ảnh hưởng bởi kỳ đóng của Tenant A', async () => {
      const month = '2026-11';
      await AccountingPeriod.create({
        tenantId: tenantA._id,
        month,
        status: 'closed',
        revision: 1,
        writeVersion: 1,
        sourceHash: 'dummy-hash-a',
        snapshot: {},
        history: [{
          action: 'closed',
          actorId: adminA._id,
          actorName: adminA.profile?.fullName,
          at: new Date(),
          reason: 'Chốt sổ kế toán tháng 11 trường A',
          sourceHash: 'dummy-hash-a',
          revision: 1,
          snapshot: {}
        }]
      });

      const reqA = makeMockReq({ user: adminA, tenantId: tenantA._id });
      const reqB = makeMockReq({ user: adminB, tenantId: tenantB._id });

      // Tenant A gọi assertOpen('2026-11') phải bị chặn HTTP 409
      await expect(assertOpen(month, null, reqA)).rejects.toThrow(
        'Kỳ kế toán đã chốt. Cần hiệu trưởng hoặc admin mở lại và ghi lý do trước khi sửa.'
      );

      // Tenant B gọi assertOpen('2026-11') hoàn toàn thành công (không đọc kỳ của Tenant A)
      await expect(assertOpen(month, null, reqB)).resolves.toBeUndefined();
    });

    it('I.1b: Giới hạn index hiện hành: Đường ghi của Tenant B trong cùng tháng nhận HTTP 409 có kiểm soát do va chạm global unique month_1', async () => {
      // Đọc metadata index khẳng định month_1 là unique toàn cục trên schema sản phẩm
      const indexes = await AccountingPeriod.collection.indexes();
      const monthIdx = indexes.find((i) => i.name === 'month_1' || (i.key && i.key.month === 1));
      expect(monthIdx).toBeDefined();
      expect(monthIdx.unique).toBe(true);

      const month = getWorkDate().slice(0, 7);
      // Tạo kỳ kế toán đóng cho Tenant A
      await AccountingPeriod.create({
        tenantId: tenantA._id,
        month,
        status: 'closed',
        revision: 1,
        writeVersion: 1,
        sourceHash: 'dummy-hash-i1b',
        snapshot: {},
        history: [{
          action: 'closed',
          actorId: adminA._id,
          actorName: adminA.profile?.fullName,
          at: new Date(),
          reason: 'Chốt sổ tháng 11 trường A',
          sourceHash: 'dummy-hash-i1b',
          revision: 1,
          snapshot: {}
        }]
      });

      // Tenant A cố thu tiền trong kỳ đóng -> bị chặn 409 "Kỳ kế toán đã chốt"
      const reqPayA = makeMockReq({
        user: accountantA,
        body: { invoiceId: invoiceA1._id, amount: 500000, method: 'cash' },
        headers: { 'idempotency-key': 'PAY-A-CLOSED-I1B' }
      });
      const resPayA = makeMockRes();
      await financeController.makePayment(reqPayA, resPayA);
      expect(resPayA.statusCode).toBe(409);
      expect(resPayA.body.message).toContain('Kỳ kế toán đã chốt');

      // Tenant B cố ghi thanh toán cùng tháng: lockOpenPeriod va chạm index month_1 -> nhận HTTP 409 có kiểm soát
      const reqPayB = makeMockReq({
        user: accountantB,
        body: { invoiceId: invoiceB1._id, amount: 500000, method: 'cash' },
        headers: { 'idempotency-key': 'PAY-B-COLLIDE-I1B' }
      });
      const resPayB = makeMockRes();
      await financeController.makePayment(reqPayB, resPayB);
      expect(resPayB.statusCode).toBe(409);
      expect(resPayB.body.message).toContain('Kỳ kế toán đang có giao dịch đồng thời hoặc xung đột hệ thống');
      expect(resPayB.body.message).not.toContain('E11000');
      expect(resPayB.body.message).not.toContain('MongoServerError');
    });

    it('I.1c: Happy path độc lập: Tenant B ghi nhận thanh toán thành công trong kỳ không bị tranh chấp', async () => {
      // Khi không có tenant khác chiếm giữ tháng đó trong DB, Tenant B thu tiền thành công bình thường
      const reqPayB = makeMockReq({
        user: accountantB,
        body: { invoiceId: invoiceB1._id, amount: 500000, method: 'cash' },
        headers: { 'idempotency-key': 'PAY-B-HAPPY-ISOLATED' }
      });
      const resPayB = makeMockRes();

      await financeController.makePayment(reqPayB, resPayB);
      expect(resPayB.statusCode).toBe(201);
      expect(resPayB.body.replayed).toBe(false);

      const paymentB = await Payment.findOne({ invoiceId: invoiceB1._id });
      expect(paymentB).not.toBeNull();
      expect(String(paymentB.tenantId)).toBe(String(tenantB._id));
      expect(paymentB.amount).toBe(500000);
    });

    it('I.1d: PoC kiểm chứng thiết kế index tương lai { tenantId: 1, month: 1 } trên collection tạm riêng biệt', async () => {
      // Minh chứng trên collection tạm: khi chuyển sang index compound theo thiết kế Phase 1E.1, cả hai tenant có thể mở kỳ cùng tháng
      const tempCol = mongoose.connection.collection('temp_accountingperiods_poc');
      await tempCol.dropIndexes().catch(() => {});
      await tempCol.deleteMany({});

      await tempCol.createIndex(
        { tenantId: 1, month: 1 },
        { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } }
      );
      await tempCol.createIndex(
        { month: 1 },
        { unique: true, partialFilterExpression: { tenantId: null } }
      );

      // Tenant A tạo kỳ tháng 2026-11
      const docA = await tempCol.insertOne({
        tenantId: tenantA._id,
        month: '2026-11',
        status: 'closed',
        writeVersion: 1
      });
      expect(docA.insertedId).toBeDefined();

      // Tenant B tạo kỳ cùng tháng 2026-11 -> thành công, không bị E11000
      const docB = await tempCol.insertOne({
        tenantId: tenantB._id,
        month: '2026-11',
        status: 'open',
        writeVersion: 1
      });
      expect(docB.insertedId).toBeDefined();

      // Cùng tenant A tạo thêm bản ghi trùng kỳ -> bị E11000 chặn
      let duplicateError = null;
      try {
        await tempCol.insertOne({
          tenantId: tenantA._id,
          month: '2026-11',
          status: 'open',
          writeVersion: 2
        });
      } catch (err) {
        duplicateError = err;
      }
      expect(duplicateError).not.toBeNull();
      expect(duplicateError.code).toBe(11000);

      // Dọn dẹp collection tạm sau PoC
      await tempCol.drop();
    });

    it('I.2: createSaasApp chặn 501 trên phase1d; mode phase1e mở endpoint tài chính được duyệt và chặn unapproved', async () => {
      const supertest = require('supertest');
      const { generateSchoolUserToken } = require('../../src/saas/utils/saasJwt');
      const tokenAccountant = generateSchoolUserToken(accountantA, tenantA);

      // 1. Mode phase1d: Vẫn fail-closed 501
      const res1d = await supertest(app1d)
        .get('/api/v1/finance/classrooms')
        .set('Authorization', `Bearer ${tokenAccountant}`);
      expect(res1d.status).toBe(501);

      // 2. Mode phase1e: Endpoints được duyệt trả về 200 cho cả 2 alias
      const resClassrooms = await supertest(app1e)
        .get('/api/v1/finance/classrooms')
        .set('Authorization', `Bearer ${tokenAccountant}`);
      expect(resClassrooms.status).toBe(200);
      expect(resClassrooms.body.success).toBe(true);

      const resAlias = await supertest(app1e)
        .get('/api/finance/operating-expenses?month=2026-11')
        .set('Authorization', `Bearer ${tokenAccountant}`);
      expect(resAlias.status).toBe(200);
      expect(resAlias.body.success).toBe(true);

      // 3. Unapproved submodule (ví dụ /export/payroll) tiếp tục bị chặn 501 trên phase1e
      const resPayroll = await supertest(app1e)
        .get('/api/v1/finance/export/payroll')
        .set('Authorization', `Bearer ${tokenAccountant}`);
      expect(resPayroll.status).toBe(501);
    });
  });
});
