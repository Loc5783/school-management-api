/**
 * Task 1D.4: Queue và Tính Lại Chấm Công theo Trường (Recalculation & Queue Scoping)
 *
 * File: backend/tests/saas/phase1d4_recalculation_scoping.test.js
 *
 * Kiểm chứng toàn diện:
 * - Nhóm G: Hàng đợi và Tính toán lại chấm công theo ngữ cảnh trường (Recalculation & Queue Scoping)
 */

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';

jest.setTimeout(60000);

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');

const testDbBootstrap = require('../../src/saas/testDbBootstrap');
const schoolAuthMiddleware = require('../../src/saas/middlewares/schoolAuthMiddleware');
const legacyAuth = require('../../src/middlewares/auth');
const roleCheck = require('../../src/middlewares/roleCheck');
const hrAccessAudit = require('../../src/middlewares/hrAccessAudit');

const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const Employee = require('../../src/models/zone2_hr/Employee');
const AttendanceRecord = require('../../src/models/zone2_hr/AttendanceRecord');
const AttendanceAuditLog = require('../../src/models/zone2_hr/AttendanceAuditLog');
const AttendanceRecalculationQueue = require('../../src/models/zone2_hr/AttendanceRecalculationQueue');
const RawAttendanceEvent = require('../../src/models/zone2_hr/RawAttendanceEvent');
const TimekeepingCorrectionRequest = require('../../src/models/zone2_hr/TimekeepingCorrectionRequest');

const timekeepingController = require('../../src/controllers/timekeepingController');
const {
  calculateAttendanceForUserDate,
  enqueueUsersForWorkDate,
  processQueuedRecalculations,
  recalculateAttendanceForDate,
  resolveTenantScope
} = require('../../src/services/attendanceCalculationService');
const { createTrustedTenantContext } = require('../../src/services/tenantFilterService');
const { generateSchoolUserToken } = require('../../src/saas/utils/saasJwt');
const { generateToken: generateLegacyToken } = require('../../src/utils/jwt');
const { hashPassword } = require('../../src/utils/passwordHash');
const { DEFAULT_SCHOOL_TIMEZONE, getWorkDate, startOfWorkDate } = require('../../src/utils/dateHelpers');

const employeeRoles = ['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard', 'hr'];
const approvalRoles = ['admin', 'principal'];

const buildSaasRecalculateApp = () => {
  const app = express();
  app.use(express.json());

  const router = express.Router();
  router.use(schoolAuthMiddleware);
  router.use(hrAccessAudit('timekeeping'));

  router.post('/recalculate/:date', roleCheck(approvalRoles), timekeepingController.recalculateAttendance);

  app.use('/api/v1/timekeeping', router);
  return app;
};

const buildLegacyRecalculateApp = () => {
  const app = express();
  app.use(express.json());

  const router = express.Router();
  router.use(legacyAuth);

  router.post('/recalculate/:date', roleCheck(approvalRoles), timekeepingController.recalculateAttendance);

  app.use('/api/v1/timekeeping', router);
  return app;
};

describe('Task 1D.4: Queue và Tính Lại Chấm Công theo Trường (Recalculation Scoping)', () => {
  let bootstrapInstance;
  let saasApp;
  let legacyApp;

  let tenantA;
  let tenantB;

  let adminUserA;
  let adminTokenA;

  let principalUserA;
  let principalTokenA;

  let hrUserA;
  let hrTokenA;

  let teacherUserA1;
  let teacherTokenA1;

  let teacherUserA2;

  let adminUserB;
  let adminTokenB;

  let teacherUserB;

  let legacyAdminUser;
  let legacyAdminToken;

  let legacyTeacherUser;

  beforeAll(async () => {
    bootstrapInstance = await testDbBootstrap.startTestDb({
      instanceOpts: [{ dbName: 'test-saas-phase1d4-recalculation' }]
    });
    saasApp = buildSaasRecalculateApp();
    legacyApp = buildLegacyRecalculateApp();

    await Promise.all([
      Tenant.syncIndexes(),
      User.syncIndexes(),
      Employee.syncIndexes(),
      AttendanceRecord.syncIndexes(),
      AttendanceAuditLog.syncIndexes(),
      AttendanceRecalculationQueue.syncIndexes(),
      RawAttendanceEvent.syncIndexes(),
      TimekeepingCorrectionRequest.syncIndexes()
    ]);
  });

  afterAll(async () => {
    if (bootstrapInstance) {
      await bootstrapInstance.stop();
    }
  });

  beforeEach(async () => {
    await Promise.all([
      Tenant.deleteMany({}),
      User.deleteMany({}),
      Employee.deleteMany({}),
      AttendanceRecord.deleteMany({}),
      AttendanceAuditLog.deleteMany({}),
      AttendanceRecalculationQueue.deleteMany({}),
      RawAttendanceEvent.deleteMany({}),
      TimekeepingCorrectionRequest.deleteMany({})
    ]);

    // 1. Tạo Tenants
    tenantA = await Tenant.create({
      code: 'SCHOOL-A',
      name: 'Trường Tiểu học Alpha',
      status: 'active',
      subscriptionPlan: 'standard'
    });

    tenantB = await Tenant.create({
      code: 'SCHOOL-B',
      name: 'Trường Tiểu học Beta',
      status: 'active',
      subscriptionPlan: 'standard'
    });

    const defaultPasswordHash = await hashPassword('TestPassword123@');

    // 2. Users Tenant A
    adminUserA = await User.create({
      username: 'admin_a',
      tenantId: tenantA._id,
      passwordHash: defaultPasswordHash,
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Quản trị viên Trường A', phone: '0901000001' }
    });
    adminTokenA = generateSchoolUserToken(adminUserA, tenantA);

    principalUserA = await User.create({
      username: 'principal_a',
      tenantId: tenantA._id,
      passwordHash: defaultPasswordHash,
      role: 'principal',
      status: 'active',
      profile: { fullName: 'Hiệu trưởng Trường A', phone: '0901000002' }
    });
    principalTokenA = generateSchoolUserToken(principalUserA, tenantA);

    hrUserA = await User.create({
      username: 'hr_a',
      tenantId: tenantA._id,
      passwordHash: defaultPasswordHash,
      role: 'hr',
      status: 'active',
      profile: { fullName: 'Nhân sự Trường A', phone: '0901000003' }
    });
    hrTokenA = generateSchoolUserToken(hrUserA, tenantA);

    teacherUserA1 = await User.create({
      username: 'teacher_a1',
      tenantId: tenantA._id,
      passwordHash: defaultPasswordHash,
      role: 'teacher',
      status: 'active',
      profile: { fullName: 'Giáo viên Nguyễn Văn A1', phone: '0901000004' }
    });
    teacherTokenA1 = generateSchoolUserToken(teacherUserA1, tenantA);

    teacherUserA2 = await User.create({
      username: 'teacher_a2',
      tenantId: tenantA._id,
      passwordHash: defaultPasswordHash,
      role: 'teacher',
      status: 'active',
      profile: { fullName: 'Giáo viên Lê Văn A2', phone: '0901000005' }
    });

    // 3. Users Tenant B
    adminUserB = await User.create({
      username: 'admin_b',
      tenantId: tenantB._id,
      passwordHash: defaultPasswordHash,
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Quản trị viên Trường B', phone: '0902000001' }
    });
    adminTokenB = generateSchoolUserToken(adminUserB, tenantB);

    teacherUserB = await User.create({
      username: 'teacher_b',
      tenantId: tenantB._id,
      passwordHash: defaultPasswordHash,
      role: 'teacher',
      status: 'active',
      profile: { fullName: 'Giáo viên Trần Thị B', phone: '0902000002' }
    });

    // 4. Legacy Users (tenantId: null)
    legacyAdminUser = await User.create({
      username: 'legacy_admin',
      tenantId: null,
      passwordHash: defaultPasswordHash,
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Quản trị viên Legacy', phone: '0903000001' }
    });
    legacyAdminToken = generateLegacyToken(legacyAdminUser._id);

    legacyTeacherUser = await User.create({
      username: 'legacy_teacher',
      tenantId: null,
      passwordHash: defaultPasswordHash,
      role: 'teacher',
      status: 'active',
      profile: { fullName: 'Giáo viên Legacy', phone: '0903000002' }
    });

    // 5. Employees
    await Employee.create({
      userId: teacherUserA1._id,
      tenantId: tenantA._id,
      employeeCode: 'GV-A-001',
      fullName: 'Giáo viên Nguyễn Văn A1',
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active'
    });

    await Employee.create({
      userId: teacherUserA2._id,
      tenantId: tenantA._id,
      employeeCode: 'GV-A-002',
      fullName: 'Giáo viên Lê Văn A2',
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active'
    });

    await Employee.create({
      userId: teacherUserB._id,
      tenantId: tenantB._id,
      employeeCode: 'GV-B-001',
      fullName: 'Giáo viên Trần Thị B',
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active'
    });

    await Employee.create({
      userId: legacyTeacherUser._id,
      tenantId: null,
      employeeCode: 'GV-LEGACY-001',
      fullName: 'Giáo viên Legacy',
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active'
    });
  });

  describe('Nhóm G: Hàng đợi và Tính toán lại chấm công (Recalculation & Queue Scoping)', () => {
    it('G.1: POST /recalculate/:date với Admin Tenant A: chỉ enqueue users của Tenant A, không chạm Tenant B', async () => {
      const dateStr = '2026-11-04';
      const today = startOfWorkDate(dateStr, DEFAULT_SCHOOL_TIMEZONE);

      // Tạo chấm công cũ cho cả Tenant A (teacher A1, A2) và Tenant B (teacher B)
      await AttendanceRecord.create([
        {
          tenantId: tenantA._id,
          userId: teacherUserA1._id,
          employeeName: 'Giáo viên Nguyễn Văn A1',
          workDate: today,
          source: 'manual'
        },
        {
          tenantId: tenantA._id,
          userId: teacherUserA2._id,
          employeeName: 'Giáo viên Lê Văn A2',
          workDate: today,
          source: 'manual'
        },
        {
          tenantId: tenantB._id,
          userId: teacherUserB._id,
          employeeName: 'Giáo viên Trần Thị B',
          workDate: today,
          source: 'manual'
        }
      ]);

      const res = await request(saasApp)
        .post(`/api/v1/timekeeping/recalculate/${dateStr}`)
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/tính lại/i);

      // Kiểm tra trong Queue: CHỈ có items của Tenant A, không có Tenant B
      const queueItemsA = await AttendanceRecalculationQueue.find({ tenantId: tenantA._id });
      expect(queueItemsA.length).toBe(2);
      const queuedUserIds = queueItemsA.map((q) => String(q.userId));
      expect(queuedUserIds).toContain(String(teacherUserA1._id));
      expect(queuedUserIds).toContain(String(teacherUserA2._id));

      const queueItemsB = await AttendanceRecalculationQueue.find({ tenantId: tenantB._id });
      expect(queueItemsB.length).toBe(0);
    });

    it('G.2: RBAC: Teacher và HR không có quyền gọi POST /recalculate/:date -> 403', async () => {
      const dateStr = '2026-11-04';

      const teacherRes = await request(saasApp)
        .post(`/api/v1/timekeeping/recalculate/${dateStr}`)
        .set('Authorization', `Bearer ${teacherTokenA1}`);
      expect(teacherRes.status).toBe(403);

      const hrRes = await request(saasApp)
        .post(`/api/v1/timekeeping/recalculate/${dateStr}`)
        .set('Authorization', `Bearer ${hrTokenA}`);
      expect(hrRes.status).toBe(403);

      // Principal gọi được -> 200
      const principalRes = await request(saasApp)
        .post(`/api/v1/timekeeping/recalculate/${dateStr}`)
        .set('Authorization', `Bearer ${principalTokenA}`);
      expect(principalRes.status).toBe(200);
    });

    it('G.3: Ngày công sai định dạng trả về 400 có kiểm soát', async () => {
      const invalidDateRes = await request(saasApp)
        .post('/api/v1/timekeeping/recalculate/2026-15-40')
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(invalidDateRes.status).toBe(400);
      expect(invalidDateRes.body.message).toMatch(/YYYY-MM-DD/i);

      const strRes = await request(saasApp)
        .post('/api/v1/timekeeping/recalculate/invalid-date')
        .set('Authorization', `Bearer ${adminTokenA}`);
      expect(strRes.status).toBe(400);
    });

    it('G.4: Tenant Scoping trong tính toán: log máy Tenant B không bao giờ được tính cho Teacher Tenant A', async () => {
      const dateStr = '2026-11-04';
      const today = startOfWorkDate(dateStr, DEFAULT_SCHOOL_TIMEZONE);

      // 1. Tạo log máy Tenant A: vào lúc 08:00, ra lúc 17:00
      await RawAttendanceEvent.create([
        {
          tenantId: tenantA._id,
          userId: teacherUserA1._id,
          employeeName: 'Giáo viên Nguyễn Văn A1',
          deviceId: 'DEV-A-01',
          externalEventId: 'EVT-A-01',
          workDate: today,
          eventType: 'CHECK_IN',
          occurredAt: new Date(`${dateStr}T08:00:00.000+07:00`),
          isValid: true
        },
        {
          tenantId: tenantA._id,
          userId: teacherUserA1._id,
          employeeName: 'Giáo viên Nguyễn Văn A1',
          deviceId: 'DEV-A-01',
          externalEventId: 'EVT-A-02',
          workDate: today,
          eventType: 'CHECK_OUT',
          occurredAt: new Date(`${dateStr}T17:00:00.000+07:00`),
          isValid: true
        }
      ]);

      // 2. Tạo log máy Tenant B: vào lúc 06:00, ra lúc 20:00 (nếu bị rò rỉ sẽ làm sai lệch giờ vào ra của A1)
      await RawAttendanceEvent.create([
        {
          tenantId: tenantB._id,
          userId: teacherUserA1._id, // Cố tình gán trỏ teacherUserA1 ở Tenant B
          employeeName: 'Xâm nhập ngoại lai',
          deviceId: 'DEV-B-01',
          externalEventId: 'EVT-B-01',
          workDate: today,
          eventType: 'CHECK_IN',
          occurredAt: new Date(`${dateStr}T06:00:00.000+07:00`),
          isValid: true
        },
        {
          tenantId: tenantB._id,
          userId: teacherUserA1._id,
          employeeName: 'Xâm nhập ngoại lai',
          deviceId: 'DEV-B-01',
          externalEventId: 'EVT-B-02',
          workDate: today,
          eventType: 'CHECK_OUT',
          occurredAt: new Date(`${dateStr}T20:00:00.000+07:00`),
          isValid: true
        }
      ]);

      const trustedContextA = createTrustedTenantContext({ tenantId: tenantA._id });

      // Tính toán cho teacherUserA1 với context Tenant A
      const record = await calculateAttendanceForUserDate({
        userId: teacherUserA1._id,
        workDate: dateStr,
        calculatedBy: 'test_runner',
        context: trustedContextA
      });

      expect(record).not.toBeNull();
      expect(String(record.tenantId)).toBe(String(tenantA._id));
      // Giờ vào phải đúng 08:00 của Tenant A, KHÔNG PHẢI 06:00 của Tenant B
      expect(new Date(record.checkInTime).toISOString()).toBe(new Date(`${dateStr}T08:00:00.000+07:00`).toISOString());
      // Giờ ra phải đúng 17:00 của Tenant A, KHÔNG PHẢI 20:00 của Tenant B
      expect(new Date(record.checkOutTime).toISOString()).toBe(new Date(`${dateStr}T17:00:00.000+07:00`).toISOString());
      expect(record.workingMinutes).toBe(540); // 9 tiếng = 540 phút
    });

    it('G.5: Queue Worker Isolation & Alien Item Fail Closed: Queue item trỏ nhầm user Tenant B bị đánh dấu FAILED', async () => {
      const dateStr = '2026-11-04';
      const today = startOfWorkDate(dateStr, DEFAULT_SCHOOL_TIMEZONE);

      // Tạo queue item giả lập: tenantId là Tenant A, nhưng userId lại là teacherUserB của Tenant B
      const alienQueueItem = await AttendanceRecalculationQueue.create({
        tenantId: tenantA._id,
        userId: teacherUserB._id,
        workDate: today,
        reasons: ['CORRUPTED_QUEUE_ITEM'],
        status: 'PENDING',
        nextAttemptAt: new Date(Date.now() - 1000)
      });

      // Chạy worker xử lý hàng đợi
      await processQueuedRecalculations({
        workerId: 'worker-test-isolation',
        maxItems: 5,
        isGlobalWorker: true
      });

      // Queue item phải bị đánh dấu FAILED do không tìm thấy user hợp lệ trong scope Tenant A
      const updatedQueue = await AttendanceRecalculationQueue.findById(alienQueueItem._id);
      expect(updatedQueue.status).toBe('FAILED');
      expect(updatedQueue.lastError).toMatch(/User tenant mismatch|not found/i);

      // Không có AttendanceRecord nào được tạo cho teacherUserB tại Tenant A
      const alienRecord = await AttendanceRecord.findOne({
        userId: teacherUserB._id,
        tenantId: tenantA._id
      });
      expect(alienRecord).toBeNull();
    });

    it('G.6: Idempotency, CalculationVersion increment & Audit Log nguyên tử', async () => {
      const dateStr = '2026-11-04';
      const today = startOfWorkDate(dateStr, DEFAULT_SCHOOL_TIMEZONE);

      await RawAttendanceEvent.create({
        tenantId: tenantA._id,
        userId: teacherUserA1._id,
        employeeName: 'Giáo viên Nguyễn Văn A1',
        deviceId: 'DEV-A-01',
        externalEventId: 'EVT-A-V1',
        workDate: today,
        eventType: 'CHECK_IN',
        occurredAt: new Date(`${dateStr}T08:00:00.000+07:00`),
        isValid: true
      });

      const trustedContextA = createTrustedTenantContext({ tenantId: tenantA._id });

      // Lần tính thứ 1
      const rec1 = await calculateAttendanceForUserDate({
        userId: teacherUserA1._id,
        workDate: dateStr,
        calculatedBy: 'test_runner',
        context: trustedContextA
      });
      expect(rec1.calculationVersion).toBe(1);

      // Lần tính thứ 2 (idempotent recalculation)
      const rec2 = await calculateAttendanceForUserDate({
        userId: teacherUserA1._id,
        workDate: dateStr,
        calculatedBy: 'test_runner',
        context: trustedContextA
      });
      expect(rec2.calculationVersion).toBe(2);

      // Đảm bảo vẫn chỉ có DUY NHẤT 1 bản ghi AttendanceRecord trong DB
      const totalDocs = await AttendanceRecord.countDocuments({
        userId: teacherUserA1._id,
        workDate: today,
        tenantId: tenantA._id
      });
      expect(totalDocs).toBe(1);

      // Kiểm tra có ít nhất 2 audit log ATTENDANCE_RECALCULATED kèm tenantId
      const auditLogs = await AttendanceAuditLog.find({
        entityId: rec1._id,
        action: 'ATTENDANCE_RECALCULATED'
      });
      expect(auditLogs.length).toBe(2);
      expect(String(auditLogs[0].tenantId)).toBe(String(tenantA._id));
      expect(String(auditLogs[1].tenantId)).toBe(String(tenantA._id));
    });

    it('G.7: Cách ly Legacy: Recalculate cho Legacy chỉ tác động record có tenantId: null', async () => {
      const dateStr = '2026-11-04';
      const today = startOfWorkDate(dateStr, DEFAULT_SCHOOL_TIMEZONE);

      // Tạo record cho Legacy Teacher (tenantId: null)
      await AttendanceRecord.create({
        tenantId: null,
        userId: legacyTeacherUser._id,
        employeeName: 'Giáo viên Legacy',
        workDate: today,
        source: 'manual'
      });

      // Tạo record cho SaaS Teacher A (tenantId: tenantA._id)
      await AttendanceRecord.create({
        tenantId: tenantA._id,
        userId: teacherUserA1._id,
        employeeName: 'Giáo viên Nguyễn Văn A1',
        workDate: today,
        source: 'manual'
      });

      // Legacy Admin gọi recalculate qua Legacy App
      const res = await request(legacyApp)
        .post(`/api/v1/timekeeping/recalculate/${dateStr}`)
        .set('Authorization', `Bearer ${legacyAdminToken}`);

      expect(res.status).toBe(200);

      // Kiểm tra trong queue: Chỉ có item của legacy (tenantId: null)
      const legacyQueueItems = await AttendanceRecalculationQueue.find({
        $or: [{ tenantId: null }, { tenantId: { $exists: false } }]
      });
      expect(legacyQueueItems.length).toBe(1);
      expect(String(legacyQueueItems[0].userId)).toBe(String(legacyTeacherUser._id));

      // Không có item nào của Tenant A được đưa vào queue của đợt gọi này
      const queueItemsA = await AttendanceRecalculationQueue.find({ tenantId: tenantA._id });
      expect(queueItemsA.length).toBe(0);
    });

    it('G.8: Cách ly HTTP Recalculate khỏi Queue toàn cục: queue B và legacy đến hạn trước không bị claim bởi request A; Worker nền xử lý riêng', async () => {
      const dateStr = '2026-11-04';
      const today = startOfWorkDate(dateStr, DEFAULT_SCHOOL_TIMEZONE);

      // 1. Tạo sẵn queue item cho Tenant B đến hạn trước (10 phút trước)
      const queueItemB = await AttendanceRecalculationQueue.create({
        tenantId: tenantB._id,
        userId: teacherUserB._id,
        workDate: today,
        reasons: ['EARLIER_RECALCULATION_B'],
        status: 'PENDING',
        nextAttemptAt: new Date(Date.now() - 10 * 60 * 1000)
      });

      // 2. Tạo sẵn queue item cho Legacy đến hạn trước (15 phút trước)
      const queueItemLegacy = await AttendanceRecalculationQueue.create({
        tenantId: null,
        userId: legacyTeacherUser._id,
        workDate: today,
        reasons: ['EARLIER_RECALCULATION_LEGACY'],
        status: 'PENDING',
        nextAttemptAt: new Date(Date.now() - 15 * 60 * 1000)
      });

      // 3. Tạo raw event cho Teacher A1 thuộc Tenant A
      await RawAttendanceEvent.create({
        tenantId: tenantA._id,
        userId: teacherUserA1._id,
        employeeName: 'Giáo viên A1',
        deviceId: 'DEV-A-01',
        externalEventId: 'EVT-A1-01',
        workDate: today,
        eventType: 'CHECK_IN',
        occurredAt: new Date(`${dateStr}T08:00:00.000+07:00`),
        isValid: true
      });

      // 4. Admin Tenant A gọi HTTP recalculate cho dateStr
      const resA = await request(saasApp)
        .post(`/api/v1/timekeeping/recalculate/${dateStr}`)
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(resA.status).toBe(200);
      expect(Array.isArray(resA.body.data)).toBe(true);
      // Kết quả trả về của request A CHỈ chứa record thuộc Tenant A
      resA.body.data.forEach((rec) => {
        expect(String(rec.tenantId)).toBe(String(tenantA._id));
        expect(String(rec.userId)).not.toBe(String(teacherUserB._id));
        expect(String(rec.userId)).not.toBe(String(legacyTeacherUser._id));
      });

      // 5. Kiểm tra queue item của Tenant B và Legacy KHÔNG BỊ THAY ĐỔI hay claim bởi request của Tenant A
      const updatedQueueB = await AttendanceRecalculationQueue.findById(queueItemB._id);
      expect(updatedQueueB.status).toBe('PENDING');
      expect(updatedQueueB.lockedBy || null).toBeNull();
      expect(updatedQueueB.attempts).toBe(0);

      const updatedQueueLegacy = await AttendanceRecalculationQueue.findById(queueItemLegacy._id);
      expect(updatedQueueLegacy.status).toBe('PENDING');
      expect(updatedQueueLegacy.lockedBy || null).toBeNull();
      expect(updatedQueueLegacy.attempts).toBe(0);

      // 6. Kiểm tra không có AttendanceRecord nào được tạo cho Tenant B hay Legacy do request A
      const recB = await AttendanceRecord.findOne({ userId: teacherUserB._id, workDate: today });
      expect(recB).toBeNull();

      // 7. Worker nền toàn cục (isGlobalWorker: true) xử lý từng tenant bằng context của chính item
      const bgProcessed = await processQueuedRecalculations({
        workerId: 'global-bg-worker',
        maxItems: 10,
        isGlobalWorker: true
      });

      expect(bgProcessed.length).toBeGreaterThanOrEqual(2);
      const doneQueueB = await AttendanceRecalculationQueue.findById(queueItemB._id);
      expect(doneQueueB.status).toBe('DONE');
      const doneQueueLegacy = await AttendanceRecalculationQueue.findById(queueItemLegacy._id);
      expect(doneQueueLegacy.status).toBe('DONE');

      // Record của Tenant B được tạo với đúng tenantId của B
      const createdRecB = await AttendanceRecord.findOne({ userId: teacherUserB._id, workDate: today });
      expect(createdRecB).not.toBeNull();
      expect(String(createdRecB.tenantId)).toBe(String(tenantB._id));

      // Record của Legacy được tạo với đúng tenantId: null
      const createdRecLegacy = await AttendanceRecord.findOne({ userId: legacyTeacherUser._id, workDate: today });
      expect(createdRecLegacy).not.toBeNull();
      expect(createdRecLegacy.tenantId).toBeNull();
    });

    it('G.9: calculateAttendanceForUserDate phải xác minh user đích thuộc đúng scope (Alien user fail closed)', async () => {
      const dateStr = '2026-11-04';
      const trustedContextA = createTrustedTenantContext({ tenantId: tenantA._id });

      // Cố tình gọi tính công cho teacherUserB (thuộc Tenant B) bằng context của Tenant A
      await expect(
        calculateAttendanceForUserDate({
          userId: teacherUserB._id,
          workDate: dateStr,
          calculatedBy: 'malicious_caller',
          context: trustedContextA
        })
      ).rejects.toThrow(/Không tìm thấy tài khoản người dùng trong phạm vi trường/i);

      // Đảm bảo không có record nào của teacherUserB dưới tenantId của Tenant A
      const alienRec = await AttendanceRecord.findOne({
        userId: teacherUserB._id,
        tenantId: tenantA._id
      });
      expect(alienRec).toBeNull();
    });

    it('G.10: Thống nhất hợp đồng context: resolveTenantScope fail closed khi user và context lệch tenant', async () => {
      const trustedContextA = createTrustedTenantContext({ tenantId: tenantA._id });
      const trustedContextB = createTrustedTenantContext({ tenantId: tenantB._id });
      const legacyContext = createTrustedTenantContext({ isLegacy: true });

      // User A + Context B -> Throw 403 FORBIDDEN
      expect(() => resolveTenantScope(teacherUserA1, trustedContextB)).toThrow(/Ngữ cảnh tenant không hợp lệ hoặc người dùng không khớp/i);

      // User A (SaaS) + Legacy Context -> Throw 403 FORBIDDEN
      expect(() => resolveTenantScope(teacherUserA1, legacyContext)).toThrow(/Ngữ cảnh tenant không hợp lệ hoặc người dùng không khớp/i);

      // Legacy User + Context A -> Throw 403 FORBIDDEN
      expect(() => resolveTenantScope(legacyTeacherUser, trustedContextA)).toThrow(/Ngữ cảnh tenant không hợp lệ hoặc người dùng không khớp/i);

      // Thiếu cả user lẫn context -> Throw 403 FORBIDDEN
      expect(() => resolveTenantScope(null, null)).toThrow(/Thiếu thông tin người dùng và ngữ cảnh trường/i);

      // User A + Context A -> Hợp lệ
      const validScopeA = resolveTenantScope(teacherUserA1, trustedContextA);
      expect(String(validScopeA.tenantId)).toBe(String(tenantA._id));
      expect(String(validScopeA.filter.tenantId)).toBe(String(tenantA._id));

      // User A mà không truyền context -> Trả về context hợp lệ của chính User A
      const selfScopeA = resolveTenantScope(teacherUserA1, null);
      expect(String(selfScopeA.tenantId)).toBe(String(tenantA._id));

      // Legacy User mà không truyền context -> Trả về context legacy hợp lệ
      const legacyScope = resolveTenantScope(legacyTeacherUser, null);
      expect(legacyScope.tenantId).toBeNull();
      expect(legacyScope.filter.tenantId).toBeNull();
    });

    it('G.11: processQueuedRecalculations fail-closed: thiếu context và flag không đổi queue; context A + filter B bị từ chối; global worker xử lý hợp lệ', async () => {
      const dateStr = '2026-11-04';
      const today = startOfWorkDate(dateStr, DEFAULT_SCHOOL_TIMEZONE);

      // 1. Tạo queue item cho Tenant A
      const queueItem = await AttendanceRecalculationQueue.create({
        tenantId: tenantA._id,
        userId: teacherUserA1._id,
        workDate: today,
        reasons: ['FAIL_CLOSED_CHECK'],
        status: 'PENDING',
        nextAttemptAt: new Date(Date.now() - 5000)
      });

      // Tạo raw event hợp lệ cho teacherUserA1
      await RawAttendanceEvent.create({
        tenantId: tenantA._id,
        userId: teacherUserA1._id,
        employeeName: 'Giáo viên Nguyễn Văn A1',
        deviceId: 'DEV-A-01',
        externalEventId: 'EVT-A1-G11',
        workDate: today,
        eventType: 'CHECK_IN',
        occurredAt: new Date(`${dateStr}T08:00:00.000+07:00`),
        isValid: true
      });

      // A. Gọi processQueuedRecalculations THIẾU context VÀ THIẾU isGlobalWorker -> Phải fail closed 403
      await expect(
        processQueuedRecalculations({
          workerId: 'untrusted-worker',
          maxItems: 5
        })
      ).rejects.toThrow(/ngữ cảnh trường đáng tin cậy hoặc cờ global worker/i);

      // Queue item không bị thay đổi
      const queueAfterFail = await AttendanceRecalculationQueue.findById(queueItem._id);
      expect(queueAfterFail.status).toBe('PENDING');
      expect(queueAfterFail.attempts).toBe(0);
      expect(queueAfterFail.lockedBy || null).toBeNull();

      // B. Gọi với context A nhưng queueFilter lại trỏ tenant B -> Phải fail closed 403
      const trustedContextA = createTrustedTenantContext({ tenantId: tenantA._id });
      await expect(
        processQueuedRecalculations({
          workerId: 'cross-tenant-filter-worker',
          context: trustedContextA,
          queueFilter: { tenantId: tenantB._id }
        })
      ).rejects.toThrow(/không khớp với ngữ cảnh trường được xác thực/i);

      // C. Gọi với isGlobalWorker: true hợp lệ -> Xử lý thành công
      const processed = await processQueuedRecalculations({
        workerId: 'valid-global-worker',
        isGlobalWorker: true,
        maxItems: 5
      });

      expect(processed.length).toBeGreaterThanOrEqual(1);
      const queueDone = await AttendanceRecalculationQueue.findById(queueItem._id);
      expect(queueDone.status).toBe('DONE');
      expect(queueDone.lockedBy).toBeNull();
    });
  });
});
