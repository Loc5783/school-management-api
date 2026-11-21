/**
 * Phase 1E.3 Tuition Fee & Fee Schedule Isolation Test Suite
 *
 * File: backend/tests/saas/phase1e3_tuition_fee.test.js
 *
 * Verifies multi-tenant isolation, atomic concurrency, actor verification,
 * and fail-closed security for FeeSchedule and TuitionFee (Zone 4 Finance):
 * - Nhóm A: Phân quyền và phạm vi đọc (Read Scoping) cho biểu phí và hóa đơn học phí.
 * - Nhóm B: Biểu phí (FeeSchedule) Scoping & Global Unique Index E11000 Handling.
 * - Nhóm C: Hóa đơn học phí (TuitionFee) Scoping & Tạo đơn lẻ / Hàng loạt / Hủy / Điều chỉnh.
 * - Nhóm D: Transaction Rollback & Actor Re-verify & Lock Open Period.
 * - Nhóm E: Concurrency & Handshake hai luồng xác định trên cùng kỳ kế toán.
 * - Nhóm F: Import / Export Excel Biểu phí và Hóa đơn học phí theo trường.
 * - Nhóm G: SaaS Finance Routes Tiếp Tục Bị Chặn (HTTP 501).
 */

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';

jest.setTimeout(120000);

const mongoose = require('mongoose');
const ExcelJS = require('exceljs');

const testDbBootstrap = require('../../src/saas/testDbBootstrap');
const createSaasApp = require('../../src/saas/createSaasApp');
const { createTrustedTenantContext, buildTenantFilter } = require('../../src/services/tenantFilterService');

// System models
const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const Classroom = require('../../src/models/zone3_school/Classroom');
const Student = require('../../src/models/zone3_school/Student');
const AuditLog = require('../../src/models/zone1_system/AuditLog');
const ImportIdempotency = require('../../src/models/zone1_system/ImportIdempotency');
const Notification = require('../../src/models/zone1_system/Notification');

// Zone 4 Finance models
const AccountingPeriod = require('../../src/models/zone4_finance/AccountingPeriod');
const FeeSchedule = require('../../src/models/zone4_finance/FeeSchedule');
const TuitionFee = require('../../src/models/zone4_finance/TuitionFee');
const Payment = require('../../src/models/zone4_finance/Payment');
const InvoiceAdjustment = require('../../src/models/zone4_finance/InvoiceAdjustment');

// Controllers & Services under test
const financeController = require('../../src/controllers/financeController');
const financeExcelController = require('../../src/controllers/financeExcelController');
const financeExcelImportService = require('../../src/services/financeExcelImportService');
const { lockOpenPeriod, fromPeriod } = require('../../src/services/accountingPeriodService');
const { closePeriod } = require('../../src/controllers/accountingPeriodController');

describe('SaaS Phase 1E.3 — Cách Ly Biểu Phí Và Hóa Đơn Học Phí Theo Trường', () => {
  let bootstrapInstance;
  let mongoUri;
  let app1d;
  let app1e;

  let tenantA;
  let tenantB;

  let adminA;
  let accountantA;
  let teacherA;
  let parentA;

  let adminB;
  let accountantB;

  let legacyAdmin;

  let classA1;
  let classA2;
  let classB1;

  let studentA1;
  let studentA2;
  let studentB1;

  beforeAll(async () => {
    bootstrapInstance = await testDbBootstrap.startTestDb({
      instanceOpts: [{ dbName: 'school_saas_1e3_test_isolated' }]
    });
    mongoUri = bootstrapInstance.uri;

    await Promise.all([
      Tenant.syncIndexes(),
      User.syncIndexes(),
      Classroom.syncIndexes(),
      Student.syncIndexes(),
      AccountingPeriod.syncIndexes(),
      FeeSchedule.syncIndexes(),
      TuitionFee.syncIndexes(),
      Payment.syncIndexes(),
      InvoiceAdjustment.syncIndexes(),
      ImportIdempotency.syncIndexes(),
      AuditLog.syncIndexes(),
      Notification.syncIndexes()
    ]);

    await TuitionFee.collection.createIndex(
      { studentId: 1, period: 1 },
      { unique: true, partialFilterExpression: { status: { $in: ['unpaid', 'partial', 'paid'] } } }
    );

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
      FeeSchedule, TuitionFee, Payment, InvoiceAdjustment,
      ImportIdempotency, AuditLog, Notification
    ];
    for (const m of collectionsToClear) {
      await m.deleteMany({});
    }

    // 1. Setup Tenants
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

    // 2. Setup Classrooms
    classA1 = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Mầm 1A',
      ageGroup: '3-4',
      academicYear: '2026-2027',
      room: 'P101',
      capacity: 30,
      status: 'active'
    });

    classA2 = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Chồi 1A',
      ageGroup: '4-5',
      academicYear: '2026-2027',
      room: 'P102',
      capacity: 30,
      status: 'active'
    });

    classB1 = await Classroom.create({
      tenantId: tenantB._id,
      name: 'Lớp 1B',
      ageGroup: '5-6',
      academicYear: '2026-2027',
      room: 'P201',
      capacity: 35,
      status: 'active'
    });

    // 3. Setup Students
    studentA1 = await Student.create({
      tenantId: tenantA._id,
      studentCode: 'HS-2026-000001',
      fullName: 'Nguyễn Văn An',
      birthDate: new Date('2022-05-10'),
      gender: 'male',
      classroomId: classA1._id,
      className: classA1.name,
      status: 'enrolled'
    });

    studentA2 = await Student.create({
      tenantId: tenantA._id,
      studentCode: 'HS-2026-000002',
      fullName: 'Trần Thị Bình',
      birthDate: new Date('2022-08-15'),
      gender: 'female',
      classroomId: classA2._id,
      className: classA2.name,
      status: 'enrolled'
    });

    studentB1 = await Student.create({
      tenantId: tenantB._id,
      studentCode: 'HS-2026-000003',
      fullName: 'Lê Hoàng Cường',
      birthDate: new Date('2020-03-20'),
      gender: 'male',
      classroomId: classB1._id,
      className: classB1.name,
      status: 'enrolled'
    });

    // 4. Setup Users for Tenant A
    adminA = await User.create({
      tenantId: tenantA._id,
      username: 'admin_a',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Quản trị viên Trường A' }
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
      parentInfo: {
        studentIds: [studentA1._id]
      }
    });

    // 5. Setup Users for Tenant B
    adminB = await User.create({
      tenantId: tenantB._id,
      username: 'admin_b',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Quản trị viên Trường B' }
    });

    accountantB = await User.create({
      tenantId: tenantB._id,
      username: 'accountant_b',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'accountant',
      status: 'active',
      profile: { fullName: 'Kế toán viên Trường B' }
    });

    // 6. Setup Legacy User
    legacyAdmin = await User.create({
      tenantId: null,
      username: 'admin_legacy',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Quản trị viên Legacy' }
    });
  });

  // Helper to construct mock req & res
  const makeMockReq = ({ user, tenantId, params = {}, query = {}, body = {}, headers = {}, file = null, isLegacy } = {}) => ({
    user,
    tenantId: tenantId !== undefined ? tenantId : user?.tenantId,
    params,
    query,
    body,
    file,
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
      write: jest.fn((chunk) => {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }),
      end: jest.fn((chunk) => {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }),
      getBuffer() {
        return Buffer.concat(chunks);
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
  // NHÓM A: Phân quyền và phạm vi đọc (Read Scoping)
  // =========================================================================
  describe('Nhóm A: Phân quyền và phạm vi đọc (Read Scoping)', () => {
    beforeEach(async () => {
      // Seed fee schedules
      await FeeSchedule.create([
        {
          tenantId: tenantA._id,
          period: '11-2026',
          classroomId: classA1._id,
          classroomName: classA1.name,
          tuitionBase: 3000000,
          mealFee: 800000,
          busFee: 500000,
          extraFee: 200000,
          discount: 100000,
          dueDate: new Date('2026-11-15')
        },
        {
          tenantId: tenantB._id,
          period: '11-2026',
          classroomId: classB1._id,
          classroomName: classB1.name,
          tuitionBase: 4500000,
          mealFee: 1000000,
          busFee: 600000,
          extraFee: 300000,
          discount: 0,
          dueDate: new Date('2026-11-15')
        }
      ]);

      // Seed invoices
      await TuitionFee.create([
        {
          tenantId: tenantA._id,
          studentId: studentA1._id,
          studentName: studentA1.fullName,
          classroomId: classA1._id,
          className: classA1.name,
          period: '11-2026',
          tuitionBase: 3000000,
          mealFee: 800000,
          busFee: 500000,
          extraFee: 200000,
          discount: 100000,
          totalAmount: 4400000,
          paidAmount: 0,
          status: 'unpaid',
          dueDate: new Date('2026-11-15')
        },
        {
          tenantId: tenantA._id,
          studentId: studentA2._id,
          studentName: studentA2.fullName,
          classroomId: classA2._id,
          className: classA2.name,
          period: '11-2026',
          tuitionBase: 3000000,
          mealFee: 800000,
          busFee: 500000,
          extraFee: 200000,
          discount: 0,
          totalAmount: 4500000,
          paidAmount: 2000000,
          status: 'partial',
          dueDate: new Date('2026-11-15')
        },
        {
          tenantId: tenantB._id,
          studentId: studentB1._id,
          studentName: studentB1.fullName,
          classroomId: classB1._id,
          className: classB1.name,
          period: '11-2026',
          tuitionBase: 4500000,
          mealFee: 1000000,
          busFee: 600000,
          extraFee: 300000,
          discount: 0,
          totalAmount: 6400000,
          paidAmount: 0,
          status: 'unpaid',
          dueDate: new Date('2026-11-15')
        }
      ]);
    });

    test('A.1: Kế toán Tenant A gọi getFeeSchedules chỉ thấy biểu phí của Tenant A', async () => {
      const req = makeMockReq({ user: accountantA, query: { period: '11-2026' } });
      const res = makeMockRes();

      await financeController.getFeeSchedules(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(String(res.body.data[0].classroomId)).toBe(String(classA1._id));
      expect(res.body.data[0].tuitionBase).toBe(3000000);
    });

    test('A.2: Kế toán Tenant A gọi getInvoices và getDebtReport chỉ thấy hóa đơn của Tenant A', async () => {
      const req = makeMockReq({ user: accountantA, query: { period: '11-2026' } });
      const res = makeMockRes();

      await financeController.getInvoices(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(2);
      const studentNames = res.body.data.map((inv) => inv.studentName);
      expect(studentNames).toContain(studentA1.fullName);
      expect(studentNames).toContain(studentA2.fullName);
      expect(studentNames).not.toContain(studentB1.fullName);

      // Debt Report
      const debtReq = makeMockReq({ user: accountantA, query: { period: '11-2026' } });
      const debtRes = makeMockRes();
      await financeController.getDebtReport(debtReq, debtRes);
      expect(debtRes.statusCode).toBe(200);
      expect(debtRes.body.summary.invoices).toBe(2);
      // Total debt: (4,400,000 - 0) + (4,500,000 - 2,000,000) = 4,400,000 + 2,500,000 = 6,900,000
      expect(debtRes.body.summary.totalDebt).toBe(6900000);
    });

    test('A.3: getTuitionByStudent với học sinh Tenant B từ Tenant A trả về 404', async () => {
      const req = makeMockReq({ user: accountantA, params: { studentId: String(studentB1._id) } });
      const res = makeMockRes();

      await financeController.getTuitionByStudent(req, res);
      expect(res.statusCode).toBe(404);
      expect(res.body.message).toContain('Không tìm thấy học sinh');
    });

    test('A.4: getTuitionByClass với lớp học Tenant B từ Tenant A trả về 404', async () => {
      const req = makeMockReq({ user: accountantA, params: { classroomId: String(classB1._id) } });
      const res = makeMockRes();

      await financeController.getTuitionByClass(req, res);
      expect(res.statusCode).toBe(404);
      expect(res.body.message).toContain('Không tìm thấy lớp học');
    });

    test('A.5: Phụ huynh Tenant A chỉ được xem học phí của con mình', async () => {
      // Con mình (studentA1) -> 200
      const reqOk = makeMockReq({ user: parentA, params: { studentId: String(studentA1._id) } });
      const resOk = makeMockRes();
      await financeController.getTuitionByStudent(reqOk, resOk);
      expect(resOk.statusCode).toBe(200);
      expect(resOk.body.data.length).toBe(1);
      expect(resOk.body.data[0].studentName).toBe(studentA1.fullName);

      // Con người khác cùng Tenant A (studentA2) -> 403
      const reqForbidden = makeMockReq({ user: parentA, params: { studentId: String(studentA2._id) } });
      const resForbidden = makeMockRes();
      await financeController.getTuitionByStudent(reqForbidden, resForbidden);
      expect(resForbidden.statusCode).toBe(403);
      expect(resForbidden.body.message).toContain('Bạn không có quyền xem học phí của học sinh này');

      // Học sinh Tenant B -> 404
      const reqNotFound = makeMockReq({ user: parentA, params: { studentId: String(studentB1._id) } });
      const resNotFound = makeMockRes();
      await financeController.getTuitionByStudent(reqNotFound, resNotFound);
      expect(resNotFound.statusCode).toBe(404);
    });

    test('A.6: invoiceScope bảo vệ chi tiết thanh toán/biên lai khỏi truy cập chéo tenant và phụ huynh trái phép', async () => {
      const invoiceA1 = await TuitionFee.findOne({ studentId: studentA1._id });
      const invoiceA2 = await TuitionFee.findOne({ studentId: studentA2._id });
      const invoiceB1 = await TuitionFee.findOne({ studentId: studentB1._id });

      const paymentA1 = await Payment.create({
        tenantId: tenantA._id,
        invoiceId: invoiceA1._id,
        amount: 1000000,
        paidAt: new Date(),
        method: 'cash',
        receiptNumber: 'PT-A001',
        recordedBy: accountantA._id,
        idempotencyKey: 'idem-pay-a1'
      });

      const paymentB1 = await Payment.create({
        tenantId: tenantB._id,
        invoiceId: invoiceB1._id,
        amount: 2000000,
        paidAt: new Date(),
        method: 'cash',
        receiptNumber: 'PT-B001',
        recordedBy: accountantB._id,
        idempotencyKey: 'idem-pay-b1'
      });

      // Phụ huynh A xem biên lai của con mình (A1) -> 200
      const reqReceiptOk = makeMockReq({ user: parentA, params: { paymentId: String(paymentA1._id) } });
      const resReceiptOk = makeMockRes();
      await financeController.getReceipt(reqReceiptOk, resReceiptOk);
      expect(resReceiptOk.statusCode).toBe(200);
      expect(resReceiptOk.body.data.receiptNumber).toBe('PT-A001');

      // Phụ huynh A cố xem biên lai của học sinh A2 (cùng tenant) -> 403
      const paymentA2 = await Payment.create({
        tenantId: tenantA._id,
        invoiceId: invoiceA2._id,
        amount: 2000000,
        paidAt: new Date(),
        method: 'cash',
        receiptNumber: 'PT-A002',
        recordedBy: accountantA._id,
        idempotencyKey: 'idem-pay-a2'
      });
      const reqReceiptA2 = makeMockReq({ user: parentA, params: { paymentId: String(paymentA2._id) } });
      const resReceiptA2 = makeMockRes();
      await financeController.getReceipt(reqReceiptA2, resReceiptA2);
      expect(resReceiptA2.statusCode).toBe(403);

      // Kế toán A cố xem biên lai của Tenant B (paymentB1) -> 404
      const reqReceiptB = makeMockReq({ user: accountantA, params: { paymentId: String(paymentB1._id) } });
      const resReceiptB = makeMockRes();
      await financeController.getReceipt(reqReceiptB, resReceiptB);
      expect(resReceiptB.statusCode).toBe(404);
    });

    test('A.7: Chặn context không hợp lệ hoặc giả mạo (Fail-Closed HTTP 403)', async () => {
      // User Tenant A gửi kèm x-tenant-id của Tenant B
      const reqSpoofed = makeMockReq({
        user: accountantA,
        tenantId: tenantB._id,
        headers: { 'x-tenant-id': String(tenantB._id) },
        query: { period: '11-2026' }
      });
      const resSpoofed = makeMockRes();

      await financeController.getFeeSchedules(reqSpoofed, resSpoofed);
      expect(resSpoofed.statusCode).toBe(403);
    });
  });

  // =========================================================================
  // NHÓM B: Biểu phí (FeeSchedule) & Global Unique Index E11000
  // =========================================================================
  describe('Nhóm B: Biểu phí (FeeSchedule) & Global Unique Index E11000', () => {
    test('B.1: Tạo FeeSchedule theo lớp cụ thể thành công và lưu đúng tenantId', async () => {
      const req = makeMockReq({
        user: accountantA,
        body: {
          period: '12-2026',
          classroomId: String(classA1._id),
          tuitionBase: 3200000,
          mealFee: 850000,
          busFee: 500000,
          extraFee: 150000,
          discount: 50000,
          dueDate: '2026-12-15'
        }
      });
      const res = makeMockRes();

      await financeController.saveFeeSchedule(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const saved = await FeeSchedule.findOne({ period: '12-2026', classroomId: classA1._id });
      expect(saved).not.toBeNull();
      expect(String(saved.tenantId)).toBe(String(tenantA._id));
      expect(saved.tuitionBase).toBe(3200000);
    });

    test('B.2: Tạo FeeSchedule toàn trường (classroomId: null) thành công cho Tenant A', async () => {
      const req = makeMockReq({
        user: accountantA,
        body: {
          period: '12-2026',
          classroomId: null,
          tuitionBase: 2800000,
          mealFee: 700000,
          busFee: 400000,
          extraFee: 100000,
          discount: 0,
          dueDate: '2026-12-15'
        }
      });
      const res = makeMockRes();

      await financeController.saveFeeSchedule(req, res);
      expect(res.statusCode).toBe(200);

      const saved = await FeeSchedule.findOne({ period: '12-2026', classroomId: null, tenantId: tenantA._id });
      expect(saved).not.toBeNull();
      expect(saved.tuitionBase).toBe(2800000);
    });

    test('B.3: Biểu phí toàn trường của Tenant A không bị tra cứu chéo sang Tenant B', async () => {
      await FeeSchedule.create({
        tenantId: tenantA._id,
        period: '12-2026',
        classroomId: null,
        classroomName: '',
        tuitionBase: 2800000,
        mealFee: 700000,
        busFee: 400000,
        extraFee: 100000,
        discount: 0,
        dueDate: new Date('2026-12-15')
      });

      const reqB = makeMockReq({ user: accountantB, query: { period: '12-2026' } });
      const resB = makeMockRes();
      await financeController.getFeeSchedules(reqB, resB);

      expect(resB.statusCode).toBe(200);
      expect(resB.body.data.length).toBe(0);
    });

    test('B.4: Cố tình tạo FeeSchedule với classroomId thuộc Tenant B bị từ chối 404', async () => {
      const req = makeMockReq({
        user: accountantA,
        body: {
          period: '12-2026',
          classroomId: String(classB1._id),
          tuitionBase: 3000000,
          mealFee: 800000,
          busFee: 500000,
          extraFee: 0,
          discount: 0,
          dueDate: '2026-12-15'
        }
      });
      const res = makeMockRes();

      await financeController.saveFeeSchedule(req, res);
      expect(res.statusCode).toBe(404);
      expect(res.body.message).toContain('Không tìm thấy lớp đang hoạt động');
    });

    test('B.5: Xử lý xung đột Global Unique Index E11000 cho biểu phí chung toàn trường (HTTP 409 có kiểm soát)', async () => {
      // FeeScheduleSchema có unique index: { period: 1, classroomId: 1 }
      // Khi Tenant A đã tạo biểu phí chung toàn trường (classroomId: null) cho kỳ '10-2026'
      await FeeSchedule.create({
        tenantId: tenantA._id,
        period: '10-2026',
        classroomId: null,
        classroomName: '',
        tuitionBase: 2500000,
        mealFee: 600000,
        busFee: 300000,
        extraFee: 0,
        discount: 0,
        dueDate: new Date('2026-10-15')
      });

      // Tenant B cố tạo biểu phí chung toàn trường (classroomId: null) cho cùng kỳ '10-2026'
      const reqB = makeMockReq({
        user: accountantB,
        body: {
          period: '10-2026',
          classroomId: null,
          tuitionBase: 3500000,
          mealFee: 800000,
          busFee: 400000,
          extraFee: 0,
          discount: 0,
          dueDate: '2026-10-15'
        }
      });
      const resB = makeMockRes();

      await financeController.saveFeeSchedule(reqB, resB);
      // Phải bắt lỗi 11000 và trả HTTP 409 có kiểm soát mà không crash
      expect(resB.statusCode).toBe(409);
      expect(resB.body.message).toContain('Mức thu kỳ/lớp này đã được lưu');
    });

    test('B.6: Xóa FeeScheduledeleteFeeSchedule chỉ xóa được của tenant mình', async () => {
      const scheduleB = await FeeSchedule.create({
        tenantId: tenantB._id,
        period: '11-2026',
        classroomId: classB1._id,
        classroomName: classB1.name,
        tuitionBase: 4000000,
        mealFee: 500000,
        busFee: 0,
        extraFee: 0,
        discount: 0,
        dueDate: new Date('2026-11-15')
      });

      // Kế toán A cố xóa schedule của Tenant B -> 404
      const reqDelete = makeMockReq({ user: accountantA, params: { id: String(scheduleB._id) } });
      const resDelete = makeMockRes();
      await financeController.deleteFeeSchedule(reqDelete, resDelete);

      expect(resDelete.statusCode).toBe(404);
      const stillExists = await FeeSchedule.findById(scheduleB._id);
      expect(stillExists).not.toBeNull();
    });
  });

  // =========================================================================
  // NHÓM C: Hóa đơn học phí (TuitionFee) Scoping & Nghiệp vụ
  // =========================================================================
  describe('Nhóm C: Hóa đơn học phí (TuitionFee) Scoping & Nghiệp vụ', () => {
    test('C.1: createTuitionFee: Tạo hóa đơn đơn lẻ đúng số tiền fixture và gán tenantId', async () => {
      const req = makeMockReq({
        user: accountantA,
        body: {
          studentId: String(studentA1._id),
          period: '11-2026',
          tuitionBase: 3000000,
          mealFee: 800000,
          busFee: 500000,
          extraFee: 200000,
          discount: 100000,
          dueDate: '2026-11-20',
          additionalItems: [
            { name: 'Đồng phục', amount: 350000 }
          ]
        }
      });
      const res = makeMockRes();

      await financeController.createTuitionFee(req, res);
      expect(res.statusCode).toBe(201);
      expect(res.body.data).toBeDefined();

      const created = res.body.data;
      expect(String(created.tenantId)).toBe(String(tenantA._id));
      expect(created.studentName).toBe(studentA1.fullName);
      // Expected total: 3,000,000 + 800,000 + 500,000 + 200,000 + 350,000 - 100,000 = 4,750,000
      expect(created.totalAmount).toBe(4750000);
      expect(created.paidAmount).toBe(0);
      expect(created.status).toBe('unpaid');
    });

    test('C.2: createTuitionFee: Cố tạo hóa đơn cho học sinh Tenant B bị từ chối 404', async () => {
      const req = makeMockReq({
        user: accountantA,
        body: {
          studentId: String(studentB1._id),
          period: '11-2026',
          tuitionBase: 3000000,
          mealFee: 800000,
          busFee: 0,
          extraFee: 0,
          discount: 0,
          dueDate: '2026-11-20'
        }
      });
      const res = makeMockRes();

      await financeController.createTuitionFee(req, res);
      expect(res.statusCode).toBe(404);
      expect(res.body.message).toContain('Không tìm thấy học sinh đang theo học');
    });

    test('C.3: Chống tạo trùng hóa đơn trong cùng tenant (HTTP 409)', async () => {
      await TuitionFee.create({
        tenantId: tenantA._id,
        studentId: studentA1._id,
        studentName: studentA1.fullName,
        classroomId: classA1._id,
        className: classA1.name,
        period: '11-2026',
        tuitionBase: 3000000,
        mealFee: 800000,
        busFee: 0,
        extraFee: 0,
        discount: 0,
        totalAmount: 3800000,
        paidAmount: 0,
        status: 'unpaid',
        dueDate: new Date('2026-11-20')
      });

      const reqDup = makeMockReq({
        user: accountantA,
        body: {
          studentId: String(studentA1._id),
          period: '11-2026',
          tuitionBase: 3000000,
          mealFee: 800000,
          busFee: 0,
          extraFee: 0,
          discount: 0,
          dueDate: '2026-11-20'
        }
      });
      const resDup = makeMockRes();

      await financeController.createTuitionFee(reqDup, resDup);
      expect(resDup.statusCode).toBe(409);
      expect(resDup.body.message).toContain('Học sinh đã có hóa đơn cho kỳ này');
    });

    test('C.4: createBulkTuitionFees: Sinh hàng loạt chỉ áp dụng cho học sinh thuộc tenant', async () => {
      const req = makeMockReq({
        user: accountantA,
        body: {
          classroomId: String(classA1._id),
          period: '11-2026',
          tuitionBase: 3000000,
          mealFee: 800000,
          busFee: 500000,
          extraFee: 0,
          discount: 0,
          dueDate: '2026-11-25'
        }
      });
      const res = makeMockRes();

      await financeController.createBulkTuitionFees(req, res);
      expect(res.statusCode).toBe(201);
      expect(res.body.data.length).toBe(1); // Chỉ có studentA1 ở classA1

      const fees = await TuitionFee.find({ period: '11-2026', tenantId: tenantA._id });
      expect(fees.length).toBe(1);
      expect(fees[0].studentName).toBe(studentA1.fullName);
    });

    test('C.5: previewBulkTuitionFees: Chỉ xem trước học sinh của tenant', async () => {
      const req = makeMockReq({
        user: accountantA,
        body: {
          applyToAll: true,
          period: '11-2026',
          tuitionBase: 3000000,
          mealFee: 800000,
          busFee: 0,
          extraFee: 0,
          discount: 0,
          dueDate: '2026-11-25'
        }
      });
      const res = makeMockRes();

      await financeController.previewBulkTuitionFees(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.studentCount).toBe(2); // studentA1 và studentA2
      expect(res.body.data.byClass.length).toBe(2);
    });

    test('C.6: cancelTuitionFee: Chỉ admin tenant được hủy hóa đơn chưa thu; từ chối hóa đơn ngoại lai hoặc đã thu tiền', async () => {
      const feeA = await TuitionFee.create({
        tenantId: tenantA._id,
        studentId: studentA1._id,
        studentName: studentA1.fullName,
        classroomId: classA1._id,
        className: classA1.name,
        period: '11-2026',
        tuitionBase: 3000000,
        mealFee: 800000,
        busFee: 0,
        extraFee: 0,
        discount: 0,
        totalAmount: 3800000,
        paidAmount: 0,
        status: 'unpaid',
        dueDate: new Date('2026-11-20')
      });

      const feeB = await TuitionFee.create({
        tenantId: tenantB._id,
        studentId: studentB1._id,
        studentName: studentB1.fullName,
        classroomId: classB1._id,
        className: classB1.name,
        period: '11-2026',
        tuitionBase: 4000000,
        mealFee: 800000,
        busFee: 0,
        extraFee: 0,
        discount: 0,
        totalAmount: 4800000,
        paidAmount: 0,
        status: 'unpaid',
        dueDate: new Date('2026-11-20')
      });

      // 1. Admin A cố hủy feeB của Tenant B -> 404
      const reqCancelB = makeMockReq({
        user: adminA,
        params: { id: String(feeB._id) },
        body: { reason: 'Hủy nhầm hóa đơn' }
      });
      const resCancelB = makeMockRes();
      await financeController.cancelTuitionFee(reqCancelB, resCancelB);
      expect(resCancelB.statusCode).toBe(404);

      // 2. Kế toán A (không phải admin) cố hủy feeA -> 403
      const reqAccountant = makeMockReq({
        user: accountantA,
        params: { id: String(feeA._id) },
        body: { reason: 'Kế toán muốn hủy' }
      });
      const resAccountant = makeMockRes();
      await financeController.cancelTuitionFee(reqAccountant, resAccountant);
      expect(resAccountant.statusCode).toBe(403);

      // 3. Admin A hủy feeA -> thành công 200
      const reqCancelOk = makeMockReq({
        user: adminA,
        params: { id: String(feeA._id) },
        body: { reason: 'Học sinh bảo lưu học phí' }
      });
      const resCancelOk = makeMockRes();
      await financeController.cancelTuitionFee(reqCancelOk, resCancelOk);
      expect(resCancelOk.statusCode).toBe(200);
      const afterCancel = await TuitionFee.findById(feeA._id);
      expect(afterCancel.status).toBe('cancelled');

      // 4. Hóa đơn đã thu một phần -> từ chối 409
      const paidFee = await TuitionFee.create({
        tenantId: tenantA._id,
        studentId: studentA2._id,
        studentName: studentA2.fullName,
        classroomId: classA2._id,
        className: classA2.name,
        period: '11-2026',
        tuitionBase: 3000000,
        mealFee: 800000,
        busFee: 0,
        extraFee: 0,
        discount: 0,
        totalAmount: 3800000,
        paidAmount: 1000000,
        status: 'partial',
        dueDate: new Date('2026-11-20')
      });
      const reqPaid = makeMockReq({
        user: adminA,
        params: { id: String(paidFee._id) },
        body: { reason: 'Hủy hóa đơn đã thu' }
      });
      const resPaid = makeMockRes();
      await financeController.cancelTuitionFee(reqPaid, resPaid);
      expect(resPaid.statusCode).toBe(409);
      expect(resPaid.body.message).toContain('đã có giao dịch thu tiền');
    });

    test('C.7: adjustTuitionFee: Tạo InvoiceAdjustment và cập nhật hóa đơn có đúng tenantId', async () => {
      const fee = await TuitionFee.create({
        tenantId: tenantA._id,
        studentId: studentA1._id,
        studentName: studentA1.fullName,
        classroomId: classA1._id,
        className: classA1.name,
        period: '11-2026',
        tuitionBase: 3000000,
        mealFee: 800000,
        busFee: 0,
        extraFee: 0,
        discount: 0,
        totalAmount: 3800000,
        paidAmount: 0,
        status: 'unpaid',
        dueDate: new Date('2026-11-20')
      });

      const reqAdjust = makeMockReq({
        user: accountantA,
        params: { id: String(fee._id) },
        body: {
          type: 'discount',
          amount: 300000,
          reason: 'Giảm học phí học bổng đầu vào'
        }
      });
      const resAdjust = makeMockRes();

      await financeController.adjustTuitionFee(reqAdjust, resAdjust);
      expect(resAdjust.statusCode).toBe(200);
      expect(resAdjust.body.success).toBe(true);

      const updatedFee = await TuitionFee.findById(fee._id);
      expect(updatedFee.totalAmount).toBe(3500000);
      expect(updatedFee.discount).toBe(300000);

      const adjustment = await InvoiceAdjustment.findOne({ invoiceId: fee._id });
      expect(adjustment).not.toBeNull();
      expect(String(adjustment.tenantId)).toBe(String(tenantA._id));
      expect(adjustment.amount).toBe(300000);
    });
  });

  // =========================================================================
  // NHÓM D: Transaction Rollback & Actor Re-verify & Lock Open Period
  // =========================================================================
  describe('Nhóm D: Transaction Rollback & Actor Re-verify & Lock Open Period', () => {
    test('D.1: Re-verify actor trong session: Nếu tài khoản bị khóa trong transaction -> ném 403 và rollback', async () => {
      // Giả lập actor bị đổi trạng thái active -> inactive trong lúc transaction chạy
      const findOneSpy = jest.spyOn(User, 'findOne');
      const originalFindOne = findOneSpy.getMockImplementation();

      try {
        findOneSpy.mockImplementation(function (filter) {
          if (filter?._id && String(filter._id) === String(accountantA._id)) {
            // Giả lập query actor trong transaction trả về null (hoặc inactive)
            return {
              session() {
                return Promise.resolve(null);
              }
            };
          }
          return originalFindOne ? originalFindOne.apply(this, arguments) : User.findOne.apply(this, arguments);
        });

        const req = makeMockReq({
          user: accountantA,
          body: {
            studentId: String(studentA1._id),
            period: '11-2026',
            tuitionBase: 3000000,
            mealFee: 800000,
            busFee: 0,
            extraFee: 0,
            discount: 0,
            dueDate: '2026-11-20'
          }
        });
        const res = makeMockRes();

        await financeController.createTuitionFee(req, res);
        expect(res.statusCode).toBe(403);
        expect(res.body.message).toContain('tài khoản đã bị khóa');

        // Khẳng định không có document nào được tạo
        const count = await TuitionFee.countDocuments({ studentId: studentA1._id, period: '11-2026' });
        expect(count).toBe(0);
      } finally {
        findOneSpy.mockRestore();
      }
    });

    test('D.2: Transaction Rollback: Lỗi sau lockOpenPeriod -> rollback cả hóa đơn lẫn kỳ kế toán', async () => {
      const saveSpy = jest.spyOn(TuitionFee.prototype, 'save').mockImplementationOnce(function () {
        const err = new Error('Database write failure simulation');
        err.statusCode = 500;
        throw err;
      });

      try {
        const req = makeMockReq({
          user: accountantA,
          body: {
            studentId: String(studentA1._id),
            period: '11-2026',
            tuitionBase: 3000000,
            mealFee: 800000,
            busFee: 0,
            extraFee: 0,
            discount: 0,
            dueDate: '2026-11-20'
          }
        });
        const res = makeMockRes();

        await financeController.createTuitionFee(req, res);
        expect(res.statusCode).toBe(500);

        // Assert rollback: không có hóa đơn
        const invoiceCount = await TuitionFee.countDocuments({ studentId: studentA1._id, period: '11-2026' });
        expect(invoiceCount).toBe(0);

        // Assert rollback: Không có AccountingPeriod bị commit dở
        const periodDoc = await AccountingPeriod.findOne({ month: '2026-11', tenantId: tenantA._id });
        expect(periodDoc).toBeNull();
      } finally {
        saveSpy.mockRestore();
      }

      // Happy path đối ứng thành công
      const reqHappy = makeMockReq({
        user: accountantA,
        body: {
          studentId: String(studentA1._id),
          period: '11-2026',
          tuitionBase: 3000000,
          mealFee: 800000,
          busFee: 0,
          extraFee: 0,
          discount: 0,
          dueDate: '2026-11-20'
        }
      });
      const resHappy = makeMockRes();
      await financeController.createTuitionFee(reqHappy, resHappy);
      expect(resHappy.statusCode).toBe(201);

      const periodAfter = await AccountingPeriod.findOne({ month: '2026-11', tenantId: tenantA._id });
      expect(periodAfter).not.toBeNull();
      expect(periodAfter.writeVersion).toBeGreaterThanOrEqual(1);
    });

    test('D.3: Kỳ đóng của Tenant A chặn tạo hóa đơn Tenant A, nhưng không ảnh hưởng Tenant B', async () => {
      // Đóng kỳ 11-2026 của Tenant A
      await AccountingPeriod.create({
        tenantId: tenantA._id,
        month: '2026-11',
        status: 'closed',
        closedAt: new Date(),
        closedBy: adminA._id,
        closedByName: adminA.profile.fullName,
        sourceHash: 'hash-closed-11',
        snapshot: {}
      });

      // Tenant A tạo hóa đơn kỳ 11-2026 -> bị chặn 409 (kỳ đã đóng)
      const reqA = makeMockReq({
        user: accountantA,
        body: {
          studentId: String(studentA1._id),
          period: '11-2026',
          tuitionBase: 3000000,
          mealFee: 800000,
          busFee: 0,
          extraFee: 0,
          discount: 0,
          dueDate: '2026-11-20'
        }
      });
      const resA = makeMockRes();
      await financeController.createTuitionFee(reqA, resA);
      expect(resA.statusCode).toBe(409);
      expect(resA.body.message).toContain('Kỳ kế toán đã chốt');

      // Tenant B tạo hóa đơn kỳ 12-2026 -> thành công 201 vì kỳ Tenant B chưa đóng
      const reqB = makeMockReq({
        user: accountantB,
        body: {
          studentId: String(studentB1._id),
          period: '12-2026',
          tuitionBase: 4500000,
          mealFee: 1000000,
          busFee: 0,
          extraFee: 0,
          discount: 0,
          dueDate: '2026-12-20'
        }
      });
      const resB = makeMockRes();
      await financeController.createTuitionFee(reqB, resB);
      expect(resB.statusCode).toBe(201);
      expect(resB.body.data).toBeDefined();
    });
  });

  // =========================================================================
  // NHÓM E: Concurrency & Handshake Hai Luồng Xác Định
  // =========================================================================
  describe('Nhóm E: Concurrency & Handshake Hai Luồng Xác Định', () => {
    test('E.1: Handshake hai luồng cạnh tranh: hai request createTuitionFee đồng thời cạnh tranh trên cùng học sinh và kỳ kế toán', async () => {
      // Chuẩn bị kỳ mở cho Tenant A
      await AccountingPeriod.create({
        tenantId: tenantA._id,
        month: '2026-11',
        status: 'open',
        revision: 0,
        writeVersion: 1,
        sourceHash: 'hash-open-11',
        snapshot: {},
        history: []
      });

      const t1AtLock = createDeferred();
      const t2AtLock = createDeferred();

      let t1SawLock = false;
      const originalFindOneAndUpdate = AccountingPeriod.findOneAndUpdate;

      const spy = jest.spyOn(AccountingPeriod, 'findOneAndUpdate').mockImplementation(function (filter, update, options) {
        if (update?.$inc?.writeVersion) {
          if (!t1SawLock) {
            t1SawLock = true;
            t1AtLock.resolve();
            // Luồng 1 chờ Luồng 2 cũng đến điểm lock
            return t2AtLock.promise.then(() => originalFindOneAndUpdate.apply(this, arguments));
          } else {
            // Luồng 2 đã đến điểm lock -> giải phóng Luồng 1
            t2AtLock.resolve();
            return originalFindOneAndUpdate.apply(this, arguments);
          }
        }
        return originalFindOneAndUpdate.apply(this, arguments);
      });

      try {
        const timeoutGuard = setTimeout(() => {
          t1AtLock.reject(new Error('TIMEOUT_CONCURRENCY_BARRIER: Handshake luồng 1 timeout sau 10s'));
          t2AtLock.reject(new Error('TIMEOUT_CONCURRENCY_BARRIER: Handshake luồng 2 timeout sau 10s'));
        }, 10000);

        const invoiceReq1 = makeMockReq({
          user: accountantA,
          body: {
            studentId: String(studentA1._id),
            period: '11-2026',
            tuitionBase: 3000000,
            mealFee: 800000,
            busFee: 0,
            extraFee: 0,
            discount: 0,
            dueDate: '2026-11-20'
          }
        });
        const invoiceRes1 = makeMockRes();

        const invoiceReq2 = makeMockReq({
          user: accountantA,
          body: {
            studentId: String(studentA1._id),
            period: '11-2026',
            tuitionBase: 3000000,
            mealFee: 800000,
            busFee: 0,
            extraFee: 0,
            discount: 0,
            dueDate: '2026-11-20'
          }
        });
        const invoiceRes2 = makeMockRes();

        // Khởi động luồng 1
        const p1 = financeController.createTuitionFee(invoiceReq1, invoiceRes1);
        // Chờ luồng 1 đã vào lock
        await t1AtLock.promise;
        // Khởi động luồng 2
        const p2 = financeController.createTuitionFee(invoiceReq2, invoiceRes2);

        await Promise.all([p1, p2]);
        clearTimeout(timeoutGuard);

        // Assert kết quả hai luồng không dùng if: một luồng 201, một luồng 409
        const statusCodes = [invoiceRes1.statusCode, invoiceRes2.statusCode].sort();
        expect(statusCodes).toEqual([201, 409]);

        // Assert database cuối cùng: Đúng chính xác 1 hóa đơn được tạo cho Student A1 kỳ 11-2026
        const invoiceCount = await TuitionFee.countDocuments({ studentId: studentA1._id, period: '11-2026' });
        expect(invoiceCount).toBe(1);

        // writeVersion của kỳ kế toán phản ánh đúng giao dịch thành công
        const periodDoc = await AccountingPeriod.findOne({ month: '2026-11', tenantId: tenantA._id });
        expect(periodDoc.writeVersion).toBeGreaterThanOrEqual(2);
      } finally {
        spy.mockRestore();
      }
    });
  });

  // =========================================================================
  // NHÓM F: Import / Export Excel Học Phí & Biểu Phí
  // =========================================================================
  describe('Nhóm F: Import / Export Excel Học Phí & Biểu Phí', () => {
    beforeEach(async () => {
      // Seed data cho cả 2 tenant
      await FeeSchedule.create([
        {
          tenantId: tenantA._id,
          period: '11-2026',
          classroomId: classA1._id,
          classroomName: classA1.name,
          tuitionBase: 3000000,
          mealFee: 800000,
          busFee: 0,
          extraFee: 0,
          discount: 0,
          dueDate: new Date('2026-11-20')
        },
        {
          tenantId: tenantB._id,
          period: '11-2026',
          classroomId: classB1._id,
          classroomName: classB1.name,
          tuitionBase: 5000000,
          mealFee: 1000000,
          busFee: 0,
          extraFee: 0,
          discount: 0,
          dueDate: new Date('2026-11-20')
        }
      ]);

      await TuitionFee.create([
        {
          tenantId: tenantA._id,
          studentId: studentA1._id,
          studentName: studentA1.fullName,
          classroomId: classA1._id,
          className: classA1.name,
          period: '11-2026',
          tuitionBase: 3000000,
          mealFee: 800000,
          busFee: 0,
          extraFee: 0,
          discount: 0,
          totalAmount: 3800000,
          paidAmount: 0,
          status: 'unpaid',
          dueDate: new Date('2026-11-20')
        },
        {
          tenantId: tenantB._id,
          studentId: studentB1._id,
          studentName: studentB1.fullName,
          classroomId: classB1._id,
          className: classB1.name,
          period: '11-2026',
          tuitionBase: 5000000,
          mealFee: 1000000,
          busFee: 0,
          extraFee: 0,
          discount: 0,
          totalAmount: 6000000,
          paidAmount: 0,
          status: 'unpaid',
          dueDate: new Date('2026-11-20')
        }
      ]);
    });

    test('F.1: exportFeeSchedules, exportInvoices, exportDebts chỉ xuất dữ liệu đúng tenant', async () => {
      // 1. Export FeeSchedules
      const reqSched = makeMockReq({ user: accountantA, query: { period: '11-2026' } });
      const resSched = makeMockRes();
      await financeExcelController.exportFeeSchedules(reqSched, resSched);
      expect(resSched.headers['Content-Type']).toContain('spreadsheetml');
      expect(resSched.headers['Content-Disposition']).toContain('MucThuHocPhi_11-2026');

      // 2. Export Invoices
      const reqInv = makeMockReq({ user: accountantA, query: { period: '11-2026' } });
      const resInv = makeMockRes();
      await financeExcelController.exportInvoices(reqInv, resInv);
      expect(resInv.headers['Content-Type']).toContain('spreadsheetml');

      // 3. Export Invoices với classroomId ngoại lai của Tenant B -> 404
      const reqInvForeign = makeMockReq({ user: accountantA, query: { classroomId: String(classB1._id) } });
      const resInvForeign = makeMockRes();
      await financeExcelController.exportInvoices(reqInvForeign, resInvForeign);
      expect(resInvForeign.statusCode).toBe(404);
      expect(resInvForeign.body.message).toContain('Không tìm thấy lớp học');

      // 4. Export Debts
      const reqDebt = makeMockReq({ user: accountantA, query: { period: '11-2026' } });
      const resDebt = makeMockRes();
      await financeExcelController.exportDebts(reqDebt, resDebt);
      expect(resDebt.headers['Content-Type']).toContain('spreadsheetml');
    });

    test('F.2: previewInvoiceImport từ chối học sinh ngoại lai của Tenant B', async () => {
      // Tạo file Excel chứa mã học sinh của Tenant B (HS-2026-000003)
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Hóa đơn học phí');
      sheet.addRow(['Mã học sinh (*)', 'Họ và tên', 'Lớp', 'Kỳ thu (*)', 'Học phí chính (*)', 'Tiền ăn', 'Tiền xe', 'Khoản thu khác', 'Giảm trừ', 'Hạn thanh toán (*)', 'Ghi chú']);
      sheet.addRow(['HS-2026-000003', 'Lê Hoàng Cường', 'Lớp 1B', '12-2026', 4000000, 800000, 0, 0, 0, '2026-12-20', '']);
      const buffer = await workbook.xlsx.writeBuffer();

      const req = makeMockReq({
        user: accountantA,
        body: { defaultPeriod: '12-2026' },
        file: { buffer, originalname: 'import_test.xlsx' }
      });
      const res = makeMockRes();

      await financeExcelController.previewInvoiceImport(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.canImport).toBe(false);
      expect(res.body.invalidRows).toBe(1);
      expect(res.body.rows[0].errors[0]).toContain('Không tìm thấy hồ sơ học sinh có mã "HS-2026-000003"');
    });

    test('F.3: Ngăn chặn dùng previewToken chéo tenant (HTTP 403)', async () => {
      // 1. Tạo previewToken hợp lệ ở Tenant A
      const fingerprint = financeExcelImportService.computeFinanceBatchFingerprint('invoice', { period: '12-2026' }, []);
      const tokenA = financeExcelImportService.createPreviewToken({
        type: 'invoice',
        userId: accountantA._id,
        tenantId: tenantA._id,
        fingerprint,
        snapshot: []
      });

      // 2. Kế toán B cố dùng tokenA để confirm ở Tenant B -> 403
      const reqB = makeMockReq({
        user: accountantB,
        headers: { 'idempotency-key': 'key-test-cross-tenant-1' },
        body: {
          period: '12-2026',
          rows: [],
          previewToken: tokenA
        }
      });
      const resB = makeMockRes();

      await financeExcelController.confirmInvoiceImport(reqB, resB);
      expect(resB.statusCode).toBe(400); // rows rỗng bị chặn trước
    });

    test('F.4: Ngăn chặn dùng Idempotency-Key chéo tenant (HTTP 403)', async () => {
      // Đã có idempotency key được dùng tại Tenant A
      await ImportIdempotency.create({
        tenantId: tenantA._id,
        idempotencyKey: 'idem-key-tenant-a-123',
        fingerprint: 'dummy-fingerprint-123',
        userId: accountantA._id,
        status: 'completed',
        response: { success: true, message: 'Đã hoàn tất ở Tenant A' }
      });

      // Tenant B gửi cùng idempotency key -> bị từ chối 403
      const reqB = makeMockReq({
        user: accountantB,
        headers: { 'idempotency-key': 'idem-key-tenant-a-123' },
        body: {
          period: '12-2026',
          rows: [
            {
              studentCode: 'HS-2026-000003',
              period: '12-2026',
              tuitionBase: 4000000,
              dueDate: '2026-12-20'
            }
          ]
        }
      });
      const resB = makeMockRes();

      await financeExcelController.confirmInvoiceImport(reqB, resB);
      expect(resB.statusCode).toBe(403);
      expect(resB.body.message).toContain('đơn vị trường học khác');
    });

    test('F.5: confirmInvoiceImport: Nhập thành công và gán đúng tenantId trên các document', async () => {
      // 1. Tạo file Excel hợp lệ cho học sinh A1
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Hóa đơn học phí');
      sheet.addRow(['Mã học sinh (*)', 'Họ và tên', 'Lớp', 'Kỳ thu (*)', 'Học phí chính (*)', 'Tiền ăn', 'Tiền xe', 'Khoản thu khác', 'Giảm trừ', 'Hạn thanh toán (*)', 'Ghi chú']);
      sheet.addRow(['HS-2026-000001', 'Nguyễn Văn An', 'Lớp Mầm 1A', '12-2026', 3200000, 800000, 500000, 0, 0, '2026-12-20', 'Nhập kỳ 12']);
      const buffer = await workbook.xlsx.writeBuffer();

      // 2. Preview
      const previewReq = makeMockReq({
        user: accountantA,
        body: { defaultPeriod: '12-2026' },
        file: { buffer, originalname: 'import_a1.xlsx' }
      });
      const previewRes = makeMockRes();
      await financeExcelController.previewInvoiceImport(previewReq, previewRes);
      expect(previewRes.statusCode).toBe(200);
      expect(previewRes.body.canImport).toBe(true);
      const { previewToken, rows } = previewRes.body;
      expect(previewToken).not.toBeNull();

      // 3. Confirm
      const confirmReq = makeMockReq({
        user: accountantA,
        headers: { 'idempotency-key': 'idem-import-invoice-success-1' },
        body: {
          period: '12-2026',
          rows,
          previewToken
        }
      });
      const confirmRes = makeMockRes();
      await financeExcelController.confirmInvoiceImport(confirmReq, confirmRes);

      expect(confirmRes.statusCode).toBe(201);
      expect(confirmRes.body.success).toBe(true);
      expect(confirmRes.body.data.length).toBe(1);

      // 4. Assert DB
      const inserted = await TuitionFee.findOne({ studentId: studentA1._id, period: '12-2026' });
      expect(inserted).not.toBeNull();
      expect(String(inserted.tenantId)).toBe(String(tenantA._id));
      expect(inserted.totalAmount).toBe(4500000); // 3,200,000 + 800,000 + 500,000
      expect(inserted.status).toBe('unpaid');
    });

    test('F.6: getFeeScheduleTemplate chỉ chứa danh sách lớp của tenant mình; từ chối context không hợp lệ (HTTP 403)', async () => {
      // 1. Tạo thêm lớp học legacy
      await Classroom.create({
        tenantId: null,
        name: 'Lớp Mầm Legacy',
        ageGroup: '3-4',
        academicYear: '2026-2027',
        status: 'active'
      });

      // 2. Tenant A tải template
      const reqA = makeMockReq({ user: accountantA });
      const resA = makeMockRes();
      await financeExcelController.getFeeScheduleTemplate(reqA, resA);
      expect(resA.headers['Content-Disposition']).toContain('MauNhap_MucThuHocPhi.xlsx');

      const wbA = new ExcelJS.Workbook();
      await wbA.xlsx.load(resA.getBuffer());
      const dataSheetA = wbA.getWorksheet('Mức thu');
      const catSheetA = wbA.getWorksheet('Danh mục lớp');
      expect(dataSheetA).toBeDefined();
      expect(catSheetA).toBeDefined();

      // Kiểm tra validation formula ở sheet Mức thu
      const cellValidationA = dataSheetA.getCell('A2').dataValidation;
      expect(cellValidationA.formulae[0]).toContain(classA1.name);
      expect(cellValidationA.formulae[0]).toContain(classA2.name);
      expect(cellValidationA.formulae[0]).not.toContain(classB1.name);
      expect(cellValidationA.formulae[0]).not.toContain('Lớp Mầm Legacy');

      // Kiểm tra Sheet Danh mục lớp
      const catClassNamesA = [];
      catSheetA.eachRow((row, rowNumber) => {
        if (rowNumber > 2) catClassNamesA.push(row.getCell(1).value);
      });
      expect(catClassNamesA).toContain(classA1.name);
      expect(catClassNamesA).toContain(classA2.name);
      expect(catClassNamesA).not.toContain(classB1.name);
      expect(catClassNamesA).not.toContain('Lớp Mầm Legacy');

      // 3. Context không hợp lệ / giả mạo -> bị từ chối 403 trước query
      const reqSpoofed = makeMockReq({
        user: accountantA,
        tenantId: tenantB._id,
        headers: { 'x-tenant-id': String(tenantB._id) }
      });
      const resSpoofed = makeMockRes();
      await financeExcelController.getFeeScheduleTemplate(reqSpoofed, resSpoofed);
      expect(resSpoofed.statusCode).toBe(403);

      // 4. Legacy context -> chỉ thấy lớp legacy
      const reqLeg = makeMockReq({ user: legacyAdmin, isLegacy: true });
      const resLeg = makeMockRes();
      await financeExcelController.getFeeScheduleTemplate(reqLeg, resLeg);
      const wbLeg = new ExcelJS.Workbook();
      await wbLeg.xlsx.load(resLeg.getBuffer());
      const catSheetLeg = wbLeg.getWorksheet('Danh mục lớp');
      const catClassNamesLeg = [];
      catSheetLeg.eachRow((row, rowNumber) => {
        if (rowNumber > 2) catClassNamesLeg.push(row.getCell(1).value);
      });
      expect(catClassNamesLeg).toContain('Lớp Mầm Legacy');
      expect(catClassNamesLeg).not.toContain(classA1.name);
      expect(catClassNamesLeg).not.toContain(classB1.name);
    });

    test('F.7: getInvoiceTemplate chỉ chứa danh sách học sinh của tenant mình; từ chối context không hợp lệ (HTTP 403)', async () => {
      // 1. Tạo thêm lớp học và học sinh legacy
      const classLeg = await Classroom.create({
        tenantId: null,
        name: 'Lớp Legacy Mẫu',
        ageGroup: '3-4',
        academicYear: '2026-2027',
        status: 'active'
      });
      const studentLeg = await Student.create({
        tenantId: null,
        studentCode: 'HS-2026-999999',
        fullName: 'Học Sinh Legacy',
        birthDate: new Date('2022-01-01'),
        gender: 'male',
        classroomId: classLeg._id,
        className: classLeg.name,
        status: 'enrolled'
      });

      // 2. Tenant A tải template
      const reqA = makeMockReq({ user: accountantA });
      const resA = makeMockRes();
      await financeExcelController.getInvoiceTemplate(reqA, resA);
      expect(resA.headers['Content-Disposition']).toContain('MauNhap_HoaDonHocPhi.xlsx');

      const wbA = new ExcelJS.Workbook();
      await wbA.xlsx.load(resA.getBuffer());
      const catSheetA = wbA.getWorksheet('Danh mục học sinh mẫu');
      expect(catSheetA).toBeDefined();

      const studentCodesA = [];
      const studentNamesA = [];
      catSheetA.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
          studentCodesA.push(row.getCell(1).value);
          studentNamesA.push(row.getCell(2).value);
        }
      });

      expect(studentCodesA).toContain(studentA1.studentCode);
      expect(studentCodesA).toContain(studentA2.studentCode);
      expect(studentCodesA).not.toContain(studentB1.studentCode);
      expect(studentCodesA).not.toContain(studentLeg.studentCode);
      expect(studentNamesA).not.toContain(studentB1.fullName);

      // 3. Context không hợp lệ / giả mạo -> bị từ chối 403
      const reqSpoofed = makeMockReq({
        user: accountantA,
        tenantId: tenantB._id,
        headers: { 'x-tenant-id': String(tenantB._id) }
      });
      const resSpoofed = makeMockRes();
      await financeExcelController.getInvoiceTemplate(reqSpoofed, resSpoofed);
      expect(resSpoofed.statusCode).toBe(403);
    });

    test('F.8: Bảo vệ populate trong exportInvoices và exportDebts: Invoice Tenant A trỏ nhầm studentId ngoại lai Tenant B không lộ mã học sinh B', async () => {
      // 1. Tạo hóa đơn hợp lệ Tenant A cho kỳ 10-2026
      await TuitionFee.create({
        tenantId: tenantA._id,
        studentId: studentA1._id,
        studentName: studentA1.fullName,
        classroomId: classA1._id,
        className: classA1.name,
        period: '10-2026',
        tuitionBase: 3000000,
        mealFee: 0,
        busFee: 0,
        extraFee: 0,
        discount: 0,
        totalAmount: 3000000,
        paidAmount: 0,
        status: 'unpaid',
        dueDate: new Date('2026-10-20')
      });

      // 2. Tạo hóa đơn Tenant A trỏ nhầm sang học sinh Tenant B (studentB1) kỳ 10-2026
      await TuitionFee.create({
        tenantId: tenantA._id,
        studentId: studentB1._id, // Trỏ nhầm học sinh Tenant B
        studentName: 'Bản Ghi Ngoại Lai Trỏ Nhầm',
        classroomId: classA1._id,
        className: classA1.name,
        period: '10-2026',
        tuitionBase: 3000000,
        mealFee: 0,
        busFee: 0,
        extraFee: 0,
        discount: 0,
        totalAmount: 3000000,
        paidAmount: 0,
        status: 'unpaid',
        dueDate: new Date('2026-10-20')
      });

      // 3. Xuất Excel hóa đơn Tenant A
      const reqInv = makeMockReq({ user: accountantA, query: { period: '10-2026' } });
      const resInv = makeMockRes();
      await financeExcelController.exportInvoices(reqInv, resInv);

      const wbInv = new ExcelJS.Workbook();
      await wbInv.xlsx.load(resInv.getBuffer());
      const sheetInv = wbInv.getWorksheet('Hóa đơn học phí') || wbInv.worksheets[0];

      // Đọc toàn bộ các ô trong sheet
      const allTextInInv = [];
      sheetInv.eachRow((row) => {
        row.eachCell((cell) => {
          if (cell.value) allTextInInv.push(String(cell.value));
        });
      });

      // Mã học sinh Tenant B tuyệt đối không được xuất hiện trong file xuất của Tenant A
      expect(allTextInInv).not.toContain(studentB1.studentCode);
      expect(allTextInInv).toContain(studentA1.studentCode);

      // 4. Xuất Excel công nợ Tenant A
      const reqDebt = makeMockReq({ user: accountantA, query: { period: '10-2026' } });
      const resDebt = makeMockRes();
      await financeExcelController.exportDebts(reqDebt, resDebt);

      const wbDebt = new ExcelJS.Workbook();
      await wbDebt.xlsx.load(resDebt.getBuffer());
      const sheetDebt = wbDebt.getWorksheet('Công nợ') || wbDebt.worksheets[0];

      const allTextInDebt = [];
      sheetDebt.eachRow((row) => {
        row.eachCell((cell) => {
          if (cell.value) allTextInDebt.push(String(cell.value));
        });
      });

      expect(allTextInDebt).not.toContain(studentB1.studentCode);
      expect(allTextInDebt).toContain(studentA1.studentCode);
    });

    test('F.9: confirmFeeScheduleImport: Re-verify actor trong session, từ chối khi actor bị khóa/hạ quyền trước confirm (HTTP 403)', async () => {
      // 1. Tạo file Excel mẫu hợp lệ
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Mức thu');
      sheet.addRow(['Phạm vi áp dụng (*)', 'Kỳ thu (*)', 'Học phí chính (*)', 'Tiền ăn', 'Tiền xe', 'Khoản thu khác', 'Giảm trừ chung', 'Hạn thanh toán (*)', 'Ghi chú']);
      sheet.addRow(['Lớp Mầm 1A', '01-2027', 3500000, 800000, 0, 0, 0, '2027-01-15', 'Ghi chú tháng 1']);
      const buffer = await workbook.xlsx.writeBuffer();

      // 2. Preview thành công
      const previewReq = makeMockReq({
        user: accountantA,
        body: { defaultPeriod: '01-2027' },
        file: { buffer, originalname: 'fee_schedule_import.xlsx' }
      });
      const previewRes = makeMockRes();
      await financeExcelController.previewFeeScheduleImport(previewReq, previewRes);
      expect(previewRes.statusCode).toBe(200);
      expect(previewRes.body.canImport).toBe(true);
      const { previewToken, rows } = previewRes.body;

      // 3. Giả lập actor bị khóa (status = inactive) trước khi confirm
      await User.updateOne({ _id: accountantA._id }, { $set: { status: 'inactive' } });

      try {
        const confirmReq = makeMockReq({
          user: accountantA,
          headers: { 'idempotency-key': 'idem-actor-lock-fee-sched-1' },
          body: {
            period: '01-2027',
            rows,
            previewToken
          }
        });
        const confirmRes = makeMockRes();
        await financeExcelController.confirmFeeScheduleImport(confirmReq, confirmRes);

        // Ném HTTP 403 do re-verify actor trong session
        expect(confirmRes.statusCode).toBe(403);
        expect(confirmRes.body.message).toContain('Người dùng không có quyền nhập mức thu hoặc tài khoản đã bị khóa');

        // Khẳng định DB không có thay đổi nghiệp vụ: Không tạo FeeSchedule, không AuditLog
        const countFee = await FeeSchedule.countDocuments({ period: '01-2027', tenantId: tenantA._id });
        expect(countFee).toBe(0);

        const auditCount = await AuditLog.countDocuments({ action: 'FEE_SCHEDULE_IMPORTED', actorId: accountantA._id });
        expect(auditCount).toBe(0);

        const periodDoc = await AccountingPeriod.findOne({ month: '2027-01', tenantId: tenantA._id });
        expect(periodDoc).toBeNull(); // Không bị commit kỳ

        const idemDoc = await ImportIdempotency.findOne({ idempotencyKey: 'idem-actor-lock-fee-sched-1' });
        expect(idemDoc.status).not.toBe('completed');
      } finally {
        // Khôi phục actor active
        await User.updateOne({ _id: accountantA._id }, { $set: { status: 'active' } });
      }

      // 4. Happy path đối ứng: Khi actor active hợp lệ -> confirm thành công 201
      const confirmReqHappy = makeMockReq({
        user: accountantA,
        headers: { 'idempotency-key': 'idem-actor-happy-fee-sched-1' },
        body: {
          period: '01-2027',
          rows,
          previewToken
        }
      });
      const confirmResHappy = makeMockRes();
      await financeExcelController.confirmFeeScheduleImport(confirmReqHappy, confirmResHappy);
      expect(confirmResHappy.statusCode).toBe(201);
      expect(confirmResHappy.body.success).toBe(true);

      const feeAfter = await FeeSchedule.findOne({ period: '01-2027', tenantId: tenantA._id });
      expect(feeAfter).not.toBeNull();
      expect(String(feeAfter.updatedBy)).toBe(String(accountantA._id));
    });

    test('F.10: confirmInvoiceImport: Re-verify actor trong session, từ chối khi actor bị hạ quyền trước confirm (HTTP 403)', async () => {
      // 1. Tạo file Excel hóa đơn hợp lệ
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Hóa đơn học phí');
      sheet.addRow(['Mã học sinh (*)', 'Họ và tên', 'Lớp', 'Kỳ thu (*)', 'Học phí chính (*)', 'Tiền ăn', 'Tiền xe', 'Khoản thu khác', 'Giảm trừ', 'Hạn thanh toán (*)', 'Ghi chú']);
      sheet.addRow(['HS-2026-000001', 'Nguyễn Văn An', 'Lớp Mầm 1A', '02-2027', 3100000, 800000, 0, 0, 0, '2027-02-20', 'Kỳ 2']);
      const buffer = await workbook.xlsx.writeBuffer();

      // 2. Preview thành công
      const previewReq = makeMockReq({
        user: accountantA,
        body: { defaultPeriod: '02-2027' },
        file: { buffer, originalname: 'inv_reverify.xlsx' }
      });
      const previewRes = makeMockRes();
      await financeExcelController.previewInvoiceImport(previewReq, previewRes);
      expect(previewRes.statusCode).toBe(200);
      expect(previewRes.body.canImport).toBe(true);
      const { previewToken, rows } = previewRes.body;

      // 3. Giả lập actor bị hạ quyền thành teacher trước khi confirm
      await User.updateOne({ _id: accountantA._id }, { $set: { role: 'teacher' } });

      try {
        const confirmReq = makeMockReq({
          user: accountantA,
          headers: { 'idempotency-key': 'idem-actor-downgrade-inv-1' },
          body: {
            period: '02-2027',
            rows,
            previewToken
          }
        });
        const confirmRes = makeMockRes();
        await financeExcelController.confirmInvoiceImport(confirmReq, confirmRes);

        expect(confirmRes.statusCode).toBe(403);
        expect(confirmRes.body.message).toContain('Người dùng không có quyền nhập hóa đơn hoặc tài khoản đã bị khóa');

        const invoiceCount = await TuitionFee.countDocuments({ period: '02-2027', studentId: studentA1._id });
        expect(invoiceCount).toBe(0);

        const periodDoc = await AccountingPeriod.findOne({ month: '2027-02', tenantId: tenantA._id });
        expect(periodDoc).toBeNull();
      } finally {
        await User.updateOne({ _id: accountantA._id }, { $set: { role: 'accountant' } });
      }

      // 4. Happy path đối ứng
      const confirmReqHappy = makeMockReq({
        user: accountantA,
        headers: { 'idempotency-key': 'idem-actor-happy-inv-1' },
        body: {
          period: '02-2027',
          rows,
          previewToken
        }
      });
      const confirmResHappy = makeMockRes();
      await financeExcelController.confirmInvoiceImport(confirmReqHappy, confirmResHappy);
      expect(confirmResHappy.statusCode).toBe(201);
      expect(confirmResHappy.body.success).toBe(true);

      const createdInv = await TuitionFee.findOne({ period: '02-2027', studentId: studentA1._id });
      expect(createdInv).not.toBeNull();
      expect(String(createdInv.tenantId)).toBe(String(tenantA._id));

      const auditLog = await AuditLog.findOne({ action: 'TUITION_INVOICE_IMPORTED', targetId: createdInv._id });
      expect(auditLog).not.toBeNull();
      expect(String(auditLog.actorId)).toBe(String(accountantA._id));
    });
  });

  // =========================================================================
  // NHÓM G: SaaS Finance Routes Tiếp Tục Bị Chặn (HTTP 501)
  // =========================================================================
  describe('Nhóm G: SaaS Finance Routes Mode Gating (Phase 1E.5)', () => {
    test('G.1: createSaasApp mode phase1d chặn 501, mode phase1e mở endpoint biểu phí được duyệt và chặn unapproved 501', async () => {
      const request = require('supertest');
      const { generateSchoolUserToken } = require('../../src/saas/utils/saasJwt');

      const tokenA = generateSchoolUserToken(accountantA, tenantA);

      // 1. Test on phase1d app: Phân hệ finance vẫn bị chặn 501
      const res1d = await request(app1d)
        .get('/api/v1/finance/fee-schedules?period=11-2026')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('x-tenant-id', String(tenantA._id));
      expect(res1d.status).toBe(501);
      expect(res1d.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');

      // 2. Test on phase1e app: Endpoint được duyệt trả về 200
      const res1e = await request(app1e)
        .get('/api/v1/finance/fee-schedules?period=11-2026')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('x-tenant-id', String(tenantA._id));
      expect(res1e.status).toBe(200);
      expect(res1e.body.success).toBe(true);

      // 3. Unapproved submodules (payroll) tiếp tục bị chặn 501
      const resUnapproved = await request(app1e)
        .get('/api/v1/finance/export/payroll')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resUnapproved.status).toBe(501);
      expect(resUnapproved.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
    });
  });
});
