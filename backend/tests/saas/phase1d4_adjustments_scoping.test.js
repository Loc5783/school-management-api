/**
 * Task 1D.4: State Machine Điều Chỉnh & Phê Duyệt Chấm Công theo Trường
 *
 * File: backend/tests/saas/phase1d4_adjustments_scoping.test.js
 *
 * Kiểm chứng toàn diện:
 * - Nhóm E: State Machine Điều Chỉnh Chấm Công (Draft, Update, Submit, Cancel, Compatibility)
 * - Nhóm F: Phê Duyệt & Từ Chối Điều Chỉnh (Approval, Rejection, Concurrency & Security)
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
const roleCheck = require('../../src/middlewares/roleCheck');
const hrAccessAudit = require('../../src/middlewares/hrAccessAudit');

const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const Employee = require('../../src/models/zone2_hr/Employee');
const TimekeepingCorrectionRequest = require('../../src/models/zone2_hr/TimekeepingCorrectionRequest');
const AttendanceAuditLog = require('../../src/models/zone2_hr/AttendanceAuditLog');
const AttendanceRecalculationQueue = require('../../src/models/zone2_hr/AttendanceRecalculationQueue');
const OutboxEvent = require('../../src/models/zone1_system/OutboxEvent');
const RawAttendanceEvent = require('../../src/models/zone2_hr/RawAttendanceEvent');

const timekeepingController = require('../../src/controllers/timekeepingController');
const { generateSchoolUserToken } = require('../../src/saas/utils/saasJwt');
const { hashPassword } = require('../../src/utils/passwordHash');
const { DEFAULT_SCHOOL_TIMEZONE, getWorkDate, startOfWorkDate } = require('../../src/utils/dateHelpers');

const employeeRoles = ['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard', 'hr'];
const approvalRoles = ['admin', 'principal'];
const adjustmentRoles = employeeRoles.filter((role) => role !== 'guard');

const buildSaasAdjustmentsApp = () => {
  const app = express();
  app.use(express.json());

  const router = express.Router();
  router.use(schoolAuthMiddleware);
  router.use(hrAccessAudit('timekeeping'));

  router.post('/adjustments', roleCheck(adjustmentRoles), timekeepingController.createAdjustmentDraft);
  router.get('/adjustments', roleCheck(employeeRoles), timekeepingController.listMyAdjustments);
  router.get('/adjustments/:id', roleCheck(employeeRoles), timekeepingController.getMyAdjustment);
  router.patch('/adjustments/:id', roleCheck(adjustmentRoles), timekeepingController.updateAdjustmentDraft);
  router.post('/adjustments/:id/submit', roleCheck(adjustmentRoles), timekeepingController.submitAdjustmentDraft);
  router.post('/adjustments/:id/cancel', roleCheck(employeeRoles), timekeepingController.cancelAdjustment);

  router.post('/corrections', roleCheck(adjustmentRoles), timekeepingController.createCorrectionRequest);
  router.get('/corrections/pending', roleCheck([...approvalRoles, 'hr']), timekeepingController.getPendingCorrectionRequests);
  router.patch('/corrections/:id/approve', roleCheck(approvalRoles), timekeepingController.approveCorrectionRequest);
  router.patch('/corrections/:id/reject', roleCheck(approvalRoles), timekeepingController.rejectCorrectionRequest);

  app.use('/api/v1/timekeeping', router);
  return app;
};

describe('Task 1D.4: State Machine Điều Chỉnh & Phê Duyệt Chấm Công theo Trường', () => {
  let bootstrapInstance;
  let saasApp;

  let tenantA;
  let tenantB;

  let adminUserA;
  let adminTokenA;

  let principalUserA;
  let principalTokenA;

  let hrUserA;
  let hrTokenA;

  let teacherUserA;
  let teacherTokenA;

  let guardUserA;
  let guardTokenA;

  let adminUserB;
  let adminTokenB;

  let teacherUserB;
  let teacherTokenB;

  beforeAll(async () => {
    bootstrapInstance = await testDbBootstrap.startTestDb({
      instanceOpts: [{ dbName: 'test-saas-phase1d4-adjustments' }]
    });
    saasApp = buildSaasAdjustmentsApp();

    await Promise.all([
      Tenant.syncIndexes(),
      User.syncIndexes(),
      Employee.syncIndexes(),
      AttendanceAuditLog.syncIndexes(),
      AttendanceRecalculationQueue.syncIndexes(),
      OutboxEvent.syncIndexes(),
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
      AttendanceAuditLog.deleteMany({}),
      AttendanceRecalculationQueue.deleteMany({}),
      OutboxEvent.deleteMany({}),
      TimekeepingCorrectionRequest.deleteMany({}),
      RawAttendanceEvent.deleteMany({})
    ]);

    // 1. Tạo Tenant A & Tenant B
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

    teacherUserA = await User.create({
      username: 'teacher_a',
      tenantId: tenantA._id,
      passwordHash: defaultPasswordHash,
      role: 'teacher',
      status: 'active',
      profile: { fullName: 'Giáo viên Nguyễn Văn A', phone: '0901000004' }
    });
    teacherTokenA = generateSchoolUserToken(teacherUserA, tenantA);

    guardUserA = await User.create({
      username: 'guard_a',
      tenantId: tenantA._id,
      passwordHash: defaultPasswordHash,
      role: 'guard',
      status: 'active',
      profile: { fullName: 'Bảo vệ Trần Văn A', phone: '0901000005' }
    });
    guardTokenA = generateSchoolUserToken(guardUserA, tenantA);

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
    teacherTokenB = generateSchoolUserToken(teacherUserB, tenantB);

    // 4. Employees
    await Employee.create({
      userId: teacherUserA._id,
      tenantId: tenantA._id,
      employeeCode: 'GV-A-001',
      fullName: 'Giáo viên Nguyễn Văn A',
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
  });

  describe('Nhóm E: State Machine Điều Chỉnh Chấm Công (Draft, Update, Submit, Cancel, Compatibility)', () => {
    it('E.1: Giáo viên Tenant A tạo draft điều chỉnh thành công (201), gán đúng tenantId và ghi AuditLog', async () => {
      const dateStr = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
      const res = await request(saasApp)
        .post('/api/v1/timekeeping/adjustments')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({
          workDate: dateStr,
          adjustmentType: 'MISSING_CHECK_IN',
          requestedTime: '08:00',
          reason: 'Quên quét thẻ vào ca sáng'
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('DRAFT');
      expect(res.body.data.version).toBe(1);
      expect(String(res.body.data.userId)).toBe(String(teacherUserA._id));

      const created = await TimekeepingCorrectionRequest.findById(res.body.data._id);
      expect(created).not.toBeNull();
      expect(String(created.tenantId)).toBe(String(tenantA._id));
      expect(created.status).toBe('DRAFT');

      const audit = await AttendanceAuditLog.findOne({
        entityId: created._id,
        action: 'ADJUSTMENT_DRAFT_CREATED'
      });
      expect(audit).not.toBeNull();
      expect(String(audit.tenantId)).toBe(String(tenantA._id));
      expect(String(audit.actor)).toBe(String(teacherUserA._id));
    });

    it('E.2: Tạo trùng draft/pending cùng ngày và loại trả về 409 DUPLICATE_ADJUSTMENT', async () => {
      const dateStr = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
      const firstRes = await request(saasApp)
        .post('/api/v1/timekeeping/adjustments')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({
          workDate: dateStr,
          adjustmentType: 'MISSING_CHECK_IN',
          requestedTime: '08:00',
          reason: 'Quên quét thẻ'
        });
      expect(firstRes.status).toBe(201);

      // Thử tạo trùng
      const dupRes = await request(saasApp)
        .post('/api/v1/timekeeping/adjustments')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({
          workDate: dateStr,
          adjustmentType: 'MISSING_CHECK_IN',
          requestedTime: '08:05',
          reason: 'Thử tạo lại'
        });

      expect(dupRes.status).toBe(409);
      expect(dupRes.body.code).toBe('DUPLICATE_ADJUSTMENT');
    });

    it('E.3: Đọc danh sách và chi tiết điều chỉnh: chỉ đọc của chính mình, ngoại lai trả 404', async () => {
      const dateStr = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
      // Tạo phiếu cho teacher A
      const resDraftA = await request(saasApp)
        .post('/api/v1/timekeeping/adjustments')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({
          workDate: dateStr,
          adjustmentType: 'MISSING_CHECK_IN',
          requestedTime: '08:00',
          reason: 'Phiếu của A'
        });
      expect(resDraftA.status).toBe(201);
      const idA = resDraftA.body.data._id;

      // Tạo phiếu cho teacher B
      const resDraftB = await request(saasApp)
        .post('/api/v1/timekeeping/adjustments')
        .set('Authorization', `Bearer ${teacherTokenB}`)
        .send({
          workDate: dateStr,
          adjustmentType: 'MISSING_CHECK_IN',
          requestedTime: '08:00',
          reason: 'Phiếu của B'
        });
      expect(resDraftB.status).toBe(201);
      const idB = resDraftB.body.data._id;

      // Teacher A list -> chỉ thấy idA
      const listResA = await request(saasApp)
        .get('/api/v1/timekeeping/adjustments')
        .set('Authorization', `Bearer ${teacherTokenA}`);
      expect(listResA.status).toBe(200);
      expect(listResA.body.data.length).toBe(1);
      expect(String(listResA.body.data[0]._id)).toBe(String(idA));

      // Teacher A get my idA -> 200
      const getOneA = await request(saasApp)
        .get(`/api/v1/timekeeping/adjustments/${idA}`)
        .set('Authorization', `Bearer ${teacherTokenA}`);
      expect(getOneA.status).toBe(200);
      expect(String(getOneA.body.data._id)).toBe(String(idA));

      // Teacher A get idB (thuộc Tenant B) -> 404 không rò rỉ
      const getOneB = await request(saasApp)
        .get(`/api/v1/timekeeping/adjustments/${idB}`)
        .set('Authorization', `Bearer ${teacherTokenA}`);
      expect(getOneB.status).toBe(404);
    });

    it('E.4: Cập nhật draft: tăng version, chặn version cũ (409) và chặn sửa phiếu của Tenant B (404)', async () => {
      const dateStr = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
      const draftA = await request(saasApp)
        .post('/api/v1/timekeeping/adjustments')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({
          workDate: dateStr,
          adjustmentType: 'MISSING_CHECK_IN',
          requestedTime: '08:00',
          reason: 'Lý do ban đầu'
        });
      const idA = draftA.body.data._id;
      expect(draftA.body.data.version).toBe(1);

      // Cập nhật thành công với version: 1
      const updateRes = await request(saasApp)
        .patch(`/api/v1/timekeeping/adjustments/${idA}`)
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({
          version: 1,
          requestedTime: '08:10',
          reason: 'Lý do đã sửa'
        });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.version).toBe(2);
      expect(updateRes.body.data.requestedTime).toBe('08:10');

      // Gửi lại với version: 1 cũ -> 409 VERSION_CONFLICT
      const conflictRes = await request(saasApp)
        .patch(`/api/v1/timekeeping/adjustments/${idA}`)
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({
          version: 1,
          requestedTime: '08:15',
          reason: 'Ghi đè cũ'
        });
      expect(conflictRes.status).toBe(409);
      expect(conflictRes.body.code).toBe('VERSION_CONFLICT');

      // Tạo draft của B, teacher A cố sửa -> 404
      const draftB = await request(saasApp)
        .post('/api/v1/timekeeping/adjustments')
        .set('Authorization', `Bearer ${teacherTokenB}`)
        .send({
          workDate: dateStr,
          adjustmentType: 'MISSING_CHECK_IN',
          requestedTime: '08:00',
          reason: 'Phiếu của B'
        });
      const idB = draftB.body.data._id;

      const alienPatch = await request(saasApp)
        .patch(`/api/v1/timekeeping/adjustments/${idB}`)
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({
          version: 1,
          requestedTime: '08:20',
          reason: 'Hacker sửa'
        });
      expect(alienPatch.status).toBe(404);
    });

    it('E.5: Gửi duyệt draft (submit): chuyển PENDING, chặn version conflict và duplicate device event (409)', async () => {
      const dateStr = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
      const draftA = await request(saasApp)
        .post('/api/v1/timekeeping/adjustments')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({
          workDate: dateStr,
          adjustmentType: 'MISSING_CHECK_IN',
          requestedTime: '08:00',
          reason: 'Cần nộp duyệt'
        });
      const idA = draftA.body.data._id;

      // Submit với version sai -> 409
      const wrongVer = await request(saasApp)
        .post(`/api/v1/timekeeping/adjustments/${idA}/submit`)
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({ expectedVersion: 99 });
      expect(wrongVer.status).toBe(409);
      expect(wrongVer.body.code).toBe('VERSION_CONFLICT');

      // Giả lập có log máy chấm công trùng giờ (08:00 +- 2 phút)
      const requestedAt = new Date(`${dateStr}T08:00:00.000+07:00`);
      await RawAttendanceEvent.create({
        tenantId: tenantA._id,
        userId: teacherUserA._id,
        employeeName: 'Giáo viên Nguyễn Văn A',
        deviceId: 'DEV-001',
        externalEventId: 'EVT-TEST-001',
        workDate: new Date(`${dateStr}T00:00:00.000Z`),
        eventType: 'CHECK_IN',
        occurredAt: new Date(requestedAt.getTime() + 30000), // trễ 30s
        isValid: true
      });

      // Submit bị chặn do DUPLICATE_DEVICE_EVENT
      const dupDevRes = await request(saasApp)
        .post(`/api/v1/timekeeping/adjustments/${idA}/submit`)
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({ expectedVersion: 1 });
      expect(dupDevRes.status).toBe(409);
      expect(dupDevRes.body.code).toBe('DUPLICATE_DEVICE_EVENT');

      // Xóa log máy và submit thành công
      await RawAttendanceEvent.deleteMany({});
      const submitOk = await request(saasApp)
        .post(`/api/v1/timekeeping/adjustments/${idA}/submit`)
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({ expectedVersion: 1 });
      expect(submitOk.status).toBe(200);
      expect(submitOk.body.data.status).toBe('PENDING');
      expect(submitOk.body.data.version).toBe(2);
    });

    it('E.6: Hủy phiếu (cancel): chuyển CANCELLED, isActive=false; ngoại lai trả 404', async () => {
      const dateStr = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
      const draftA = await request(saasApp)
        .post('/api/v1/timekeeping/adjustments')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({
          workDate: dateStr,
          adjustmentType: 'MISSING_CHECK_IN',
          requestedTime: '08:00',
          reason: 'Cần hủy'
        });
      const idA = draftA.body.data._id;

      // Hủy thành công
      const cancelRes = await request(saasApp)
        .post(`/api/v1/timekeeping/adjustments/${idA}/cancel`)
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({ expectedVersion: 1, cancelReason: 'Đã tìm thấy thẻ' });
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.data.status).toBe('CANCELLED');
      expect(cancelRes.body.data.isActive).toBe(false);

      // Cố hủy lại phiếu đã CANCELLED -> 404 (do filter status $in: ['DRAFT', 'PENDING'])
      const reCancel = await request(saasApp)
        .post(`/api/v1/timekeeping/adjustments/${idA}/cancel`)
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({ expectedVersion: 2, cancelReason: 'Hủy lại' });
      expect(reCancel.status).toBe(404);
    });

    it('E.7: Compatibility alias (POST /corrections): tạo và submit trực tiếp thành PENDING (201)', async () => {
      const dateStr = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
      const res = await request(saasApp)
        .post('/api/v1/timekeeping/corrections')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({
          workDate: dateStr,
          adjustmentType: 'MISSING_CHECK_IN',
          requestedTime: '08:00',
          reason: 'Dùng API cũ'
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('PENDING');
      expect(String(res.body.data.tenantId)).toBe(String(tenantA._id));
    });

    it('E.8: Guard không có quyền gọi endpoint tạo/sửa điều chỉnh -> 403', async () => {
      const dateStr = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
      const res = await request(saasApp)
        .post('/api/v1/timekeeping/adjustments')
        .set('Authorization', `Bearer ${guardTokenA}`)
        .send({
          workDate: dateStr,
          adjustmentType: 'MISSING_CHECK_IN',
          requestedTime: '08:00',
          reason: 'Bảo vệ tạo đơn'
        });

      expect(res.status).toBe(403);
    });

    it('E.9: Transaction atomicity cho Draft/Update/Submit/Cancel: AuditLog fail -> Rollback toàn bộ, không có doc mồ côi', async () => {
      const spyAudit = jest.spyOn(AttendanceAuditLog, 'create').mockImplementationOnce(() => {
        throw new Error('Simulated Audit Failure in Draft Creation');
      });

      try {
        const res = await request(saasApp)
          .post('/api/v1/timekeeping/adjustments')
          .set('Authorization', `Bearer ${teacherTokenA}`)
          .send({
            workDate: '2026-11-01',
            adjustmentType: 'MISSING_CHECK_IN',
            requestedTime: '08:00',
            reason: 'Tạo draft thử nghiệm rollback'
          });
        expect(res.status).toBe(500);

        // Kiểm tra không có document nào được tạo
        const count = await TimekeepingCorrectionRequest.countDocuments({
          userId: teacherUserA._id,
          workDate: startOfWorkDate('2026-11-01', DEFAULT_SCHOOL_TIMEZONE)
        });
        expect(count).toBe(0);
      } finally {
        spyAudit.mockRestore();
      }
    });

    it('E.10: Transaction atomicity: createAndSubmitLegacy rollback draft nếu submit thất bại', async () => {
      // Tạo sẵn device event để bước submit sẽ ném DUPLICATE_DEVICE_EVENT (409)
      const workDateStr = '2026-11-01';
      const eventTime = new Date(`${workDateStr}T08:00:00.000+07:00`);
      await RawAttendanceEvent.create({
        tenantId: tenantA._id,
        userId: teacherUserA._id,
        employeeName: 'Teacher A',
        deviceId: 'DEV-A-01',
        externalEventId: 'EVT-DUP-01',
        workDate: startOfWorkDate(workDateStr, DEFAULT_SCHOOL_TIMEZONE),
        eventType: 'CHECK_IN',
        occurredAt: eventTime,
        isValid: true
      });

      // Gọi compatibility POST /corrections (gọi createAndSubmitLegacy)
      const res = await request(saasApp)
        .post('/api/v1/timekeeping/corrections')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({
          workDate: workDateStr,
          adjustmentType: 'MISSING_CHECK_IN',
          requestedTime: '08:00',
          reason: 'Đơn bù trùng giờ máy'
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DUPLICATE_DEVICE_EVENT');

      // Đảm bảo không có draft nào bị sót lại trong DB do transaction rollback toàn bộ
      const leftover = await TimekeepingCorrectionRequest.findOne({
        userId: teacherUserA._id,
        workDate: startOfWorkDate(workDateStr, DEFAULT_SCHOOL_TIMEZONE)
      });
      expect(leftover).toBeNull();
    });

    it('E.11: Barrier test cho createDraft: Teacher bị khóa/hạ quyền sau middleware nhưng trước snapshot transaction -> 403', async () => {
      let barrierHit = false;
      const originalFindOne = User.findOne.bind(User);
      const spyUser = jest.spyOn(User, 'findOne').mockImplementation(function (filter, ...args) {
        if (filter?._id && String(filter._id) === String(teacherUserA._id) && filter?.status === 'active' && !barrierHit) {
          barrierHit = true;
          // Khóa teacherUserA trong DB thật trước khi transaction snapshot
          return mongoose.connection.collection('users').updateOne(
            { _id: teacherUserA._id },
            { $set: { status: 'suspended' } }
          ).then(() => originalFindOne(filter, ...args));
        }
        return originalFindOne(filter, ...args);
      });

      try {
        const res = await request(saasApp)
          .post('/api/v1/timekeeping/adjustments')
          .set('Authorization', `Bearer ${teacherTokenA}`)
          .send({
            workDate: '2026-11-02',
            adjustmentType: 'MISSING_CHECK_IN',
            requestedTime: '08:00',
            reason: 'Tạo draft khi sắp bị khóa'
          });

        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/không còn quyền|bị khóa/i);

        const doc = await TimekeepingCorrectionRequest.findOne({
          userId: teacherUserA._id,
          workDate: startOfWorkDate('2026-11-02', DEFAULT_SCHOOL_TIMEZONE)
        });
        expect(doc).toBeNull();
      } finally {
        spyUser.mockRestore();
        // Restore status
        await mongoose.connection.collection('users').updateOne(
          { _id: teacherUserA._id },
          { $set: { status: 'active' } }
        );
      }
    });

    it('E.12: Barrier test: Actor đổi thành parent sau middleware trước snapshot createDraft -> 403; không tạo phiếu, không ghi audit; Happy path thành công', async () => {
      const workDateStr = '2026-10-25';
      const initialAuditCount = await AttendanceAuditLog.countDocuments({ actor: teacherUserA._id });

      let barrierHit = false;
      const originalFindOne = User.findOne.bind(User);
      const spyUser = jest.spyOn(User, 'findOne').mockImplementation(function (filter, ...args) {
        if (filter?._id && String(filter._id) === String(teacherUserA._id) && filter?.role && !barrierHit) {
          barrierHit = true;
          return mongoose.connection.collection('users').updateOne(
            { _id: teacherUserA._id },
            { $set: { role: 'parent' } }
          ).then(() => originalFindOne(filter, ...args));
        }
        return originalFindOne(filter, ...args);
      });

      try {
        const res = await request(saasApp)
          .post('/api/v1/timekeeping/adjustments')
          .set('Authorization', `Bearer ${teacherTokenA}`)
          .send({
            workDate: workDateStr,
            adjustmentType: 'MISSING_CHECK_IN',
            requestedTime: '08:00',
            reason: 'Tạo draft khi actor đổi thành parent'
          });

        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/không còn quyền|bị khóa/i);

        // Document không được tạo
        const doc = await TimekeepingCorrectionRequest.findOne({
          userId: teacherUserA._id,
          workDate: startOfWorkDate(workDateStr, DEFAULT_SCHOOL_TIMEZONE)
        });
        expect(doc).toBeNull();

        // Không sinh audit log thành công
        const finalAuditCount = await AttendanceAuditLog.countDocuments({ actor: teacherUserA._id });
        expect(finalAuditCount).toBe(initialAuditCount);
      } finally {
        spyUser.mockRestore();
        await mongoose.connection.collection('users').updateOne(
          { _id: teacherUserA._id },
          { $set: { role: 'teacher' } }
        );
      }

      // Happy path đối ứng: role teacher hợp lệ
      const happyRes = await request(saasApp)
        .post('/api/v1/timekeeping/adjustments')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({
          workDate: workDateStr,
          adjustmentType: 'MISSING_CHECK_IN',
          requestedTime: '08:00',
          reason: 'Tạo draft hợp lệ'
        });
      expect(happyRes.status).toBe(201);
      expect(happyRes.body.data.status).toBe('DRAFT');
    });

    it('E.13: Barrier test: Actor đổi thành parent sau middleware trước snapshot updateDraft -> 403; phiếu và version không đổi, không ghi audit; Happy path thành công', async () => {
      const workDateStr = '2026-10-26';
      // 1. Tạo sẵn draft
      const draft = await TimekeepingCorrectionRequest.create({
        tenantId: tenantA._id,
        userId: teacherUserA._id,
        employeeName: 'Teacher A',
        workDate: startOfWorkDate(workDateStr, DEFAULT_SCHOOL_TIMEZONE),
        timezone: DEFAULT_SCHOOL_TIMEZONE,
        adjustmentType: 'MISSING_CHECK_IN',
        requestType: 'MISSING_CHECK_IN',
        requestedAt: new Date(`${workDateStr}T08:00:00.000+07:00`),
        requestedTime: '08:00',
        reason: 'Lý do ban đầu',
        status: 'DRAFT',
        version: 1,
        isActive: true
      });

      const initialAuditCount = await AttendanceAuditLog.countDocuments({ entityId: draft._id });

      let barrierHit = false;
      const originalFindOne = User.findOne.bind(User);
      const spyUser = jest.spyOn(User, 'findOne').mockImplementation(function (filter, ...args) {
        if (filter?._id && String(filter._id) === String(teacherUserA._id) && filter?.role && !barrierHit) {
          barrierHit = true;
          return mongoose.connection.collection('users').updateOne(
            { _id: teacherUserA._id },
            { $set: { role: 'parent' } }
          ).then(() => originalFindOne(filter, ...args));
        }
        return originalFindOne(filter, ...args);
      });

      try {
        const res = await request(saasApp)
          .patch(`/api/v1/timekeeping/adjustments/${draft._id}`)
          .set('Authorization', `Bearer ${teacherTokenA}`)
          .send({
            version: 1,
            reason: 'Cập nhật khi role đổi thành parent'
          });

        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/không còn quyền|bị khóa/i);

        // Document không đổi, version không đổi
        const currentDoc = await TimekeepingCorrectionRequest.findById(draft._id);
        expect(currentDoc.version).toBe(1);
        expect(currentDoc.reason).toBe('Lý do ban đầu');

        // Audit log không đổi
        const auditCount = await AttendanceAuditLog.countDocuments({ entityId: draft._id });
        expect(auditCount).toBe(initialAuditCount);
      } finally {
        spyUser.mockRestore();
        await mongoose.connection.collection('users').updateOne(
          { _id: teacherUserA._id },
          { $set: { role: 'teacher' } }
        );
      }

      // Happy path đối ứng: cập nhật hợp lệ
      const happyRes = await request(saasApp)
        .patch(`/api/v1/timekeeping/adjustments/${draft._id}`)
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({
          version: 1,
          reason: 'Cập nhật hợp lệ'
        });
      expect(happyRes.status).toBe(200);
      expect(happyRes.body.data.version).toBe(2);
      expect(happyRes.body.data.reason).toBe('Cập nhật hợp lệ');
    });

    it('E.14: Barrier test: Actor đổi thành parent sau middleware trước snapshot submitDraft -> 403; status DRAFT và version không đổi; Happy path thành công', async () => {
      const workDateStr = '2026-10-27';
      const draft = await TimekeepingCorrectionRequest.create({
        tenantId: tenantA._id,
        userId: teacherUserA._id,
        employeeName: 'Teacher A',
        workDate: startOfWorkDate(workDateStr, DEFAULT_SCHOOL_TIMEZONE),
        timezone: DEFAULT_SCHOOL_TIMEZONE,
        adjustmentType: 'MISSING_CHECK_IN',
        requestType: 'MISSING_CHECK_IN',
        requestedAt: new Date(`${workDateStr}T08:00:00.000+07:00`),
        requestedTime: '08:00',
        reason: 'Chờ nộp',
        status: 'DRAFT',
        version: 1,
        isActive: true
      });

      const initialAuditCount = await AttendanceAuditLog.countDocuments({ entityId: draft._id });

      let barrierHit = false;
      const originalFindOne = User.findOne.bind(User);
      const spyUser = jest.spyOn(User, 'findOne').mockImplementation(function (filter, ...args) {
        if (filter?._id && String(filter._id) === String(teacherUserA._id) && filter?.role && !barrierHit) {
          barrierHit = true;
          return mongoose.connection.collection('users').updateOne(
            { _id: teacherUserA._id },
            { $set: { role: 'parent' } }
          ).then(() => originalFindOne(filter, ...args));
        }
        return originalFindOne(filter, ...args);
      });

      try {
        const res = await request(saasApp)
          .post(`/api/v1/timekeeping/adjustments/${draft._id}/submit`)
          .set('Authorization', `Bearer ${teacherTokenA}`)
          .send({ expectedVersion: 1 });

        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/không còn quyền|bị khóa/i);

        // Phiếu vẫn là DRAFT, version không đổi
        const currentDoc = await TimekeepingCorrectionRequest.findById(draft._id);
        expect(currentDoc.status).toBe('DRAFT');
        expect(currentDoc.version).toBe(1);

        // Audit log không tăng
        const auditCount = await AttendanceAuditLog.countDocuments({ entityId: draft._id });
        expect(auditCount).toBe(initialAuditCount);
      } finally {
        spyUser.mockRestore();
        await mongoose.connection.collection('users').updateOne(
          { _id: teacherUserA._id },
          { $set: { role: 'teacher' } }
        );
      }

      // Happy path đối ứng: submit hợp lệ
      const happyRes = await request(saasApp)
        .post(`/api/v1/timekeeping/adjustments/${draft._id}/submit`)
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({ expectedVersion: 1 });
      expect(happyRes.status).toBe(200);
      expect(happyRes.body.data.status).toBe('PENDING');
      expect(happyRes.body.data.version).toBe(2);
    });

    it('E.15: Barrier test: Actor đổi thành parent sau middleware trước snapshot cancelAdjustment -> 403; status và version không đổi; Happy path thành công', async () => {
      const workDateStr = '2026-10-28';
      const pendingDoc = await TimekeepingCorrectionRequest.create({
        tenantId: tenantA._id,
        userId: teacherUserA._id,
        employeeName: 'Teacher A',
        workDate: startOfWorkDate(workDateStr, DEFAULT_SCHOOL_TIMEZONE),
        timezone: DEFAULT_SCHOOL_TIMEZONE,
        adjustmentType: 'MISSING_CHECK_IN',
        requestType: 'MISSING_CHECK_IN',
        requestedAt: new Date(`${workDateStr}T08:00:00.000+07:00`),
        requestedTime: '08:00',
        reason: 'Phiếu chờ hủy',
        status: 'PENDING',
        version: 2,
        isActive: true
      });

      const initialAuditCount = await AttendanceAuditLog.countDocuments({ entityId: pendingDoc._id });

      let barrierHit = false;
      const originalFindOne = User.findOne.bind(User);
      const spyUser = jest.spyOn(User, 'findOne').mockImplementation(function (filter, ...args) {
        if (filter?._id && String(filter._id) === String(teacherUserA._id) && filter?.role && !barrierHit) {
          barrierHit = true;
          return mongoose.connection.collection('users').updateOne(
            { _id: teacherUserA._id },
            { $set: { role: 'parent' } }
          ).then(() => originalFindOne(filter, ...args));
        }
        return originalFindOne(filter, ...args);
      });

      try {
        const res = await request(saasApp)
          .post(`/api/v1/timekeeping/adjustments/${pendingDoc._id}/cancel`)
          .set('Authorization', `Bearer ${teacherTokenA}`)
          .send({ expectedVersion: 2, cancelReason: 'Thử hủy khi thành parent' });

        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/không còn quyền|bị khóa/i);

        // Phiếu vẫn là PENDING, isActive vẫn true, version không đổi
        const currentDoc = await TimekeepingCorrectionRequest.findById(pendingDoc._id);
        expect(currentDoc.status).toBe('PENDING');
        expect(currentDoc.isActive).toBe(true);
        expect(currentDoc.version).toBe(2);

        // Audit log không tăng
        const auditCount = await AttendanceAuditLog.countDocuments({ entityId: pendingDoc._id });
        expect(auditCount).toBe(initialAuditCount);
      } finally {
        spyUser.mockRestore();
        await mongoose.connection.collection('users').updateOne(
          { _id: teacherUserA._id },
          { $set: { role: 'teacher' } }
        );
      }

      // Happy path đối ứng: cancel hợp lệ (hủy phiếu)
      const happyRes = await request(saasApp)
        .post(`/api/v1/timekeeping/adjustments/${pendingDoc._id}/cancel`)
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({ expectedVersion: 2, cancelReason: 'Hủy hợp lệ' });
      expect(happyRes.status).toBe(200);
      expect(happyRes.body.data.status).toBe('CANCELLED');
      expect(happyRes.body.data.isActive).toBe(false);
      expect(happyRes.body.data.version).toBe(3);
    });

    it('E.16: Barrier test: Compatibility endpoint /corrections actor đổi thành parent sau middleware -> 403; không tạo phiếu, không ghi audit; Happy path thành công', async () => {
      const workDateStr = '2026-10-29';
      const initialAuditCount = await AttendanceAuditLog.countDocuments({ actor: teacherUserA._id });

      let barrierHit = false;
      const originalFindOne = User.findOne.bind(User);
      const spyUser = jest.spyOn(User, 'findOne').mockImplementation(function (filter, ...args) {
        if (filter?._id && String(filter._id) === String(teacherUserA._id) && filter?.role && !barrierHit) {
          barrierHit = true;
          return mongoose.connection.collection('users').updateOne(
            { _id: teacherUserA._id },
            { $set: { role: 'parent' } }
          ).then(() => originalFindOne(filter, ...args));
        }
        return originalFindOne(filter, ...args);
      });

      try {
        const res = await request(saasApp)
          .post('/api/v1/timekeeping/corrections')
          .set('Authorization', `Bearer ${teacherTokenA}`)
          .send({
            workDate: workDateStr,
            adjustmentType: 'MISSING_CHECK_IN',
            requestedTime: '08:00',
            reason: 'Tạo đơn cũ khi actor đổi thành parent'
          });

        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/không còn quyền|bị khóa/i);

        // Phiếu không tồn tại
        const doc = await TimekeepingCorrectionRequest.findOne({
          userId: teacherUserA._id,
          workDate: startOfWorkDate(workDateStr, DEFAULT_SCHOOL_TIMEZONE)
        });
        expect(doc).toBeNull();

        // Audit log không tăng
        const finalAuditCount = await AttendanceAuditLog.countDocuments({ actor: teacherUserA._id });
        expect(finalAuditCount).toBe(initialAuditCount);
      } finally {
        spyUser.mockRestore();
        await mongoose.connection.collection('users').updateOne(
          { _id: teacherUserA._id },
          { $set: { role: 'teacher' } }
        );
      }

      // Happy path đối ứng: gọi /corrections hợp lệ
      const happyRes = await request(saasApp)
        .post('/api/v1/timekeeping/corrections')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({
          workDate: workDateStr,
          adjustmentType: 'MISSING_CHECK_IN',
          requestedTime: '08:00',
          reason: 'Tạo đơn cũ hợp lệ'
        });
      expect(happyRes.status).toBe(201);
      expect(happyRes.body.data.status).toBe('PENDING');
    });
  });

  describe('Nhóm F: Phê Duyệt & Từ Chối Điều Chỉnh (Approval, Rejection, Concurrency & Security)', () => {
    let pendingAdjustmentA;
    let pendingAdjustmentB;

    beforeEach(async () => {
      const dateStr = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
      // Tạo pending adjustment cho Tenant A
      const resA = await request(saasApp)
        .post('/api/v1/timekeeping/corrections')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({
          workDate: dateStr,
          adjustmentType: 'MISSING_CHECK_IN',
          requestedTime: '08:00',
          reason: 'Chờ duyệt Tenant A'
        });
      pendingAdjustmentA = resA.body.data;

      // Tạo pending adjustment cho Tenant B
      const resB = await request(saasApp)
        .post('/api/v1/timekeeping/corrections')
        .set('Authorization', `Bearer ${teacherTokenB}`)
        .send({
          workDate: dateStr,
          adjustmentType: 'MISSING_CHECK_IN',
          requestedTime: '08:00',
          reason: 'Chờ duyệt Tenant B'
        });
      pendingAdjustmentB = resB.body.data;
    });

    it('F.1: GET /corrections/pending: Admin/HR xem được pending của trường mình, không thấy trường B, Teacher bị 403', async () => {
      // Admin A xem
      const adminRes = await request(saasApp)
        .get('/api/v1/timekeeping/corrections/pending')
        .set('Authorization', `Bearer ${adminTokenA}`);
      expect(adminRes.status).toBe(200);
      expect(adminRes.body.data.length).toBe(1);
      expect(String(adminRes.body.data[0]._id)).toBe(String(pendingAdjustmentA._id));

      // HR A xem được
      const hrRes = await request(saasApp)
        .get('/api/v1/timekeeping/corrections/pending')
        .set('Authorization', `Bearer ${hrTokenA}`);
      expect(hrRes.status).toBe(200);
      expect(hrRes.body.data.length).toBe(1);

      // Teacher A gọi -> 403
      const teacherRes = await request(saasApp)
        .get('/api/v1/timekeeping/corrections/pending')
        .set('Authorization', `Bearer ${teacherTokenA}`);
      expect(teacherRes.status).toBe(403);
    });

    it('F.2: Admin Tenant A duyệt phiếu thành công: chuyển APPROVED, sinh Queue, Outbox và AuditLog kèm tenantId', async () => {
      const res = await request(saasApp)
        .patch(`/api/v1/timekeeping/corrections/${pendingAdjustmentA._id}/approve`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          expectedVersion: pendingAdjustmentA.version,
          reviewNote: 'Đồng ý duyệt'
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('APPROVED');
      expect(String(res.body.data.reviewedBy)).toBe(String(adminUserA._id));
      expect(String(res.body.data.tenantId)).toBe(String(tenantA._id));

      // Kiểm tra Queue recalculation đã được tạo kèm tenantId
      const queueItem = await AttendanceRecalculationQueue.findOne({
        userId: pendingAdjustmentA.userId,
        status: 'PENDING'
      });
      expect(queueItem).not.toBeNull();
      expect(String(queueItem.tenantId)).toBe(String(tenantA._id));
      expect(queueItem.reasons).toContain('ADJUSTMENT_APPROVED');

      // Kiểm tra OutboxEvent đã sinh kèm tenantId
      const outbox = await OutboxEvent.findOne({
        type: 'ATTENDANCE_RECALCULATION_REQUESTED',
        'payload.adjustmentId': new mongoose.Types.ObjectId(pendingAdjustmentA._id)
      });
      expect(outbox).not.toBeNull();
      expect(String(outbox.tenantId)).toBe(String(tenantA._id));

      // Kiểm tra AuditLog
      const audit = await AttendanceAuditLog.findOne({
        entityId: pendingAdjustmentA._id,
        action: 'CORRECTION_APPROVED'
      });
      expect(audit).not.toBeNull();
      expect(String(audit.tenantId)).toBe(String(tenantA._id));
      expect(String(audit.actor)).toBe(String(adminUserA._id));
    });

    it('F.3: HR gọi approve -> 403 (chỉ Admin/Principal có quyền duyệt); Teacher gọi -> 403', async () => {
      const hrRes = await request(saasApp)
        .patch(`/api/v1/timekeeping/corrections/${pendingAdjustmentA._id}/approve`)
        .set('Authorization', `Bearer ${hrTokenA}`)
        .send({ expectedVersion: pendingAdjustmentA.version });
      expect(hrRes.status).toBe(403);

      const teacherRes = await request(saasApp)
        .patch(`/api/v1/timekeeping/corrections/${pendingAdjustmentA._id}/approve`)
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({ expectedVersion: pendingAdjustmentA.version });
      expect(teacherRes.status).toBe(403);
    });

    it('F.4: Cấm tự phê duyệt (Self-approval prevention): Admin tự nộp phiếu và tự duyệt -> 403 SELF_APPROVAL_FORBIDDEN', async () => {
      const dateStr = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
      // Admin A tự tạo phiếu điều chỉnh cho chính mình
      const adminReqRes = await request(saasApp)
        .post('/api/v1/timekeeping/corrections')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          workDate: dateStr,
          adjustmentType: 'MISSING_CHECK_IN',
          requestedTime: '08:00',
          reason: 'Admin tự tạo phiếu'
        });
      expect(adminReqRes.status).toBe(201);
      const adminAdj = adminReqRes.body.data;

      // Admin A tự duyệt phiếu của chính mình -> 403
      const selfApproveRes = await request(saasApp)
        .patch(`/api/v1/timekeeping/corrections/${adminAdj._id}/approve`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ expectedVersion: adminAdj.version });
      expect(selfApproveRes.status).toBe(403);
      expect(selfApproveRes.body.code).toBe('SELF_APPROVAL_FORBIDDEN');

      // Principal A duyệt phiếu của Admin A -> Thành công (200)
      const principalApproveRes = await request(saasApp)
        .patch(`/api/v1/timekeeping/corrections/${adminAdj._id}/approve`)
        .set('Authorization', `Bearer ${principalTokenA}`)
        .send({ expectedVersion: adminAdj.version });
      expect(principalApproveRes.status).toBe(200);
      expect(principalApproveRes.body.data.status).toBe('APPROVED');
    });

    it('F.5: Cách ly liên trường: Admin Tenant A cố duyệt phiếu của Tenant B -> 404 ADJUSTMENT_NOT_FOUND', async () => {
      const alienApprove = await request(saasApp)
        .patch(`/api/v1/timekeeping/corrections/${pendingAdjustmentB._id}/approve`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ expectedVersion: pendingAdjustmentB.version });
      expect(alienApprove.status).toBe(404);
      expect(alienApprove.body.code).toBe('ADJUSTMENT_NOT_FOUND');
    });

    it('F.6: Concurrency / Race condition: 2 reviewer cùng duyệt 1 phiếu -> người thứ hai bị 409', async () => {
      // Reviewer 1 (Admin) duyệt thành công
      const rev1 = await request(saasApp)
        .patch(`/api/v1/timekeeping/corrections/${pendingAdjustmentA._id}/approve`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ expectedVersion: pendingAdjustmentA.version });
      expect(rev1.status).toBe(200);

      // Reviewer 2 (Principal) cùng gửi expectedVersion cũ -> 409
      const rev2 = await request(saasApp)
        .patch(`/api/v1/timekeeping/corrections/${pendingAdjustmentA._id}/approve`)
        .set('Authorization', `Bearer ${principalTokenA}`)
        .send({ expectedVersion: pendingAdjustmentA.version });
      expect(rev2.status).toBe(409);
    });

    it('F.7: Transaction atomicity: lỗi mô phỏng ở OutboxEvent -> Rollback toàn bộ, phiếu vẫn PENDING', async () => {
      const spyOutbox = jest.spyOn(OutboxEvent, 'create').mockImplementationOnce(() => {
        throw new Error('Simulated Outbox Failure');
      });

      try {
        const res = await request(saasApp)
          .patch(`/api/v1/timekeeping/corrections/${pendingAdjustmentA._id}/approve`)
          .set('Authorization', `Bearer ${adminTokenA}`)
          .send({ expectedVersion: pendingAdjustmentA.version });
        expect(res.status).toBe(500);

        // Kiểm tra phiếu vẫn là PENDING, version không tăng
        const doc = await TimekeepingCorrectionRequest.findById(pendingAdjustmentA._id);
        expect(doc.status).toBe('PENDING');
        expect(doc.version).toBe(pendingAdjustmentA.version);

        // Không sinh Queue recalculation
        const queue = await AttendanceRecalculationQueue.findOne({ userId: pendingAdjustmentA.userId });
        expect(queue).toBeNull();
      } finally {
        spyOutbox.mockRestore();
      }
    });

    it('F.8: Barrier test: Admin bị hạ quyền/khóa sau middleware nhưng trước snapshot transaction -> Bị từ chối 403; Happy path đối ứng thành công', async () => {
      let barrierHit = false;
      const originalFindOne = User.findOne.bind(User);
      const spyUser = jest.spyOn(User, 'findOne').mockImplementation(function (filter, ...args) {
        if (filter?._id && String(filter._id) === String(adminUserA._id) && filter?.status === 'active' && !barrierHit) {
          barrierHit = true;
          // Kích hoạt thay đổi DB thật: khóa tài khoản adminUserA
          return mongoose.connection.collection('users').updateOne(
            { _id: adminUserA._id },
            { $set: { status: 'suspended' } }
          ).then(() => originalFindOne(filter, ...args));
        }
        return originalFindOne(filter, ...args);
      });

      try {
        const res = await request(saasApp)
          .patch(`/api/v1/timekeeping/corrections/${pendingAdjustmentA._id}/approve`)
          .set('Authorization', `Bearer ${adminTokenA}`)
          .send({ expectedVersion: pendingAdjustmentA.version });

        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/không còn quyền|bị khóa/i);

        // Phiếu không bị duyệt
        const doc = await TimekeepingCorrectionRequest.findById(pendingAdjustmentA._id);
        expect(doc.status).toBe('PENDING');
      } finally {
        spyUser.mockRestore();
      }

      // Happy path đối ứng: Mở khóa lại admin và duyệt thành công
      await mongoose.connection.collection('users').updateOne(
        { _id: adminUserA._id },
        { $set: { status: 'active' } }
      );

      const happyRes = await request(saasApp)
        .patch(`/api/v1/timekeeping/corrections/${pendingAdjustmentA._id}/approve`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ expectedVersion: pendingAdjustmentA.version });
      expect(happyRes.status).toBe(200);
      expect(happyRes.body.data.status).toBe('APPROVED');
    });

    it('F.9: Từ chối phiếu (reject): Admin từ chối thành công; cấm tự từ chối (403); Tenant B trả 404', async () => {
      // 1. Admin A từ chối phiếu của Tenant B -> 404
      const alienReject = await request(saasApp)
        .patch(`/api/v1/timekeeping/corrections/${pendingAdjustmentB._id}/reject`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ expectedVersion: pendingAdjustmentB.version, reviewNote: 'Không duyệt được' });
      expect(alienReject.status).toBe(404);

      // 2. Admin A tự tạo phiếu rồi tự từ chối -> 403 SELF_REJECTION_FORBIDDEN
      const adminReqRes = await request(saasApp)
        .post('/api/v1/timekeeping/corrections')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          workDate: '2026-11-01',
          adjustmentType: 'MISSING_CHECK_OUT',
          requestedTime: '17:00',
          reason: 'Admin tự tạo phiếu ra ca'
        });
      expect(adminReqRes.status).toBe(201);
      const adminAdj = adminReqRes.body.data;

      const selfRejectRes = await request(saasApp)
        .patch(`/api/v1/timekeeping/corrections/${adminAdj._id}/reject`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ expectedVersion: adminAdj.version, reviewNote: 'Tự từ chối' });
      expect(selfRejectRes.status).toBe(403);
      expect(selfRejectRes.body.code).toBe('SELF_REJECTION_FORBIDDEN');

      // 3. Admin A từ chối phiếu của Teacher A thành công kèm reviewNote
      const rejectOk = await request(saasApp)
        .patch(`/api/v1/timekeeping/corrections/${pendingAdjustmentA._id}/reject`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ expectedVersion: pendingAdjustmentA.version, reviewNote: 'Camera không thấy mặt lúc 08:00' });
      expect(rejectOk.status).toBe(200);
      expect(rejectOk.body.data.status).toBe('REJECTED');
      expect(rejectOk.body.data.isActive).toBe(false);

      const audit = await AttendanceAuditLog.findOne({
        entityId: pendingAdjustmentA._id,
        action: 'CORRECTION_REJECTED'
      });
      expect(audit).not.toBeNull();
      expect(String(audit.tenantId)).toBe(String(tenantA._id));
      expect(String(audit.actor)).toBe(String(adminUserA._id));
    });

    it('F.10: Owner verification: Phiếu PENDING có owner (pending.userId) bị inactive -> Admin duyệt/từ chối bị từ chối 403 INVALID_OWNER', async () => {
      // Khóa owner của pendingAdjustmentA (teacherUserA)
      await mongoose.connection.collection('users').updateOne(
        { _id: teacherUserA._id },
        { $set: { status: 'inactive' } }
      );

      try {
        const approveRes = await request(saasApp)
          .patch(`/api/v1/timekeeping/corrections/${pendingAdjustmentA._id}/approve`)
          .set('Authorization', `Bearer ${adminTokenA}`)
          .send({ expectedVersion: pendingAdjustmentA.version });

        expect(approveRes.status).toBe(403);
        expect(approveRes.body.code).toBe('INVALID_OWNER');

        const rejectRes = await request(saasApp)
          .patch(`/api/v1/timekeeping/corrections/${pendingAdjustmentA._id}/reject`)
          .set('Authorization', `Bearer ${adminTokenA}`)
          .send({ expectedVersion: pendingAdjustmentA.version, reviewNote: 'Từ chối owner inactive' });

        expect(rejectRes.status).toBe(403);
        expect(rejectRes.body.code).toBe('INVALID_OWNER');

        // Phiếu vẫn PENDING, không sinh Queue recalculation
        const doc = await TimekeepingCorrectionRequest.findById(pendingAdjustmentA._id);
        expect(doc.status).toBe('PENDING');
        const queue = await AttendanceRecalculationQueue.findOne({ userId: pendingAdjustmentA.userId });
        expect(queue).toBeNull();
      } finally {
        await mongoose.connection.collection('users').updateOne(
          { _id: teacherUserA._id },
          { $set: { status: 'active' } }
        );
      }
    });

    it('F.11: Owner verification: Phiếu PENDING có Employee liên kết bị inactive -> Admin duyệt bị từ chối 403 INVALID_OWNER', async () => {
      // Cập nhật Employee của teacherUserA sang status: 'resigned'
      await Employee.updateOne(
        { userId: teacherUserA._id },
        { $set: { status: 'resigned' } }
      );

      try {
        const approveRes = await request(saasApp)
          .patch(`/api/v1/timekeeping/corrections/${pendingAdjustmentA._id}/approve`)
          .set('Authorization', `Bearer ${adminTokenA}`)
          .send({ expectedVersion: pendingAdjustmentA.version });

        expect(approveRes.status).toBe(403);
        expect(approveRes.body.code).toBe('INVALID_OWNER');
        expect(approveRes.body.message).toMatch(/hồ sơ nhân viên/i);
      } finally {
        await Employee.updateOne(
          { userId: teacherUserA._id },
          { $set: { status: 'active' } }
        );
      }
    });
  });
});
