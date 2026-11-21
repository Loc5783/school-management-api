/**
 * Task 1D.4: Cách ly chấm công nhân sự cốt lõi theo trường (Timekeeping Scoping)
 *
 * File: backend/tests/saas/phase1d4_timekeeping_scoping.test.js
 *
 * Kiểm chứng toàn diện:
 * - Nhóm A: Chấm công thủ công (manualCheckIn)
 * - Nhóm B: Đọc chấm công cá nhân (getMyTimekeeping)
 * - Nhóm C: Bảng chấm công toàn trường theo ngày (getDailyTimekeeping)
 * - Nhóm D: Cách ly Legacy & Khóa Router SaaS
 */

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';

jest.setTimeout(60000);

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');

const testDbBootstrap = require('../../src/saas/testDbBootstrap');
const createSaasApp = require('../../src/saas/createSaasApp');
const schoolAuthMiddleware = require('../../src/saas/middlewares/schoolAuthMiddleware');
const legacyAuth = require('../../src/middlewares/auth');
const roleCheck = require('../../src/middlewares/roleCheck');
const hrAccessAudit = require('../../src/middlewares/hrAccessAudit');

const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const Employee = require('../../src/models/zone2_hr/Employee');
const StaffShift = require('../../src/models/zone2_hr/StaffShift');
const AttendanceRecord = require('../../src/models/zone2_hr/AttendanceRecord');
const AttendanceAuditLog = require('../../src/models/zone2_hr/AttendanceAuditLog');
const TimekeepingCorrectionRequest = require('../../src/models/zone2_hr/TimekeepingCorrectionRequest');

const timekeepingController = require('../../src/controllers/timekeepingController');
const { generateSchoolUserToken } = require('../../src/saas/utils/saasJwt');
const { generateToken: generateLegacyToken } = require('../../src/utils/jwt');
const { hashPassword } = require('../../src/utils/passwordHash');
const { DEFAULT_SCHOOL_TIMEZONE, getWorkDate, startOfWorkDate } = require('../../src/utils/dateHelpers');

const employeeRoles = ['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard', 'hr'];
const approvalRoles = ['admin', 'principal'];

// Build SaaS test harness
const buildSaasTimekeepingApp = () => {
  const app = express();
  app.use(express.json());

  const router = express.Router();
  router.use(schoolAuthMiddleware);
  router.use(hrAccessAudit('timekeeping'));

  router.post('/check-in', roleCheck(employeeRoles), timekeepingController.manualCheckIn);
  router.get('/me', roleCheck(employeeRoles), timekeepingController.getMyTimekeeping);
  router.get('/daily', roleCheck(['admin', 'principal', 'hr']), timekeepingController.getDailyTimekeeping);

  app.use('/api/v1/timekeeping', router);
  return app;
};

// Build Legacy test harness
const buildLegacyTimekeepingApp = () => {
  const app = express();
  app.use(express.json());

  const router = express.Router();
  router.use(legacyAuth);
  router.use(hrAccessAudit('timekeeping'));

  router.post('/check-in', roleCheck(employeeRoles), timekeepingController.manualCheckIn);
  router.get('/me', roleCheck(employeeRoles), timekeepingController.getMyTimekeeping);
  router.get('/daily', roleCheck(['admin', 'principal', 'hr']), timekeepingController.getDailyTimekeeping);

  app.use('/api/v1/timekeeping', router);
  return app;
};

describe('Task 1D.4: Chấm công nhân sự cốt lõi theo trường (Timekeeping Scoping)', () => {
  let bootstrapInstance;
  let saasApp;
  let legacyApp;

  let tenantA;
  let tenantB;

  let adminUserA;
  let adminTokenA;
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

  let legacyAdminUser;
  let legacyAdminToken;
  let legacyTeacherUser;
  let legacyTeacherToken;

  let employeeTeacherA;
  let employeeTeacherB;
  let employeeGuardA;

  beforeAll(async () => {
    bootstrapInstance = await testDbBootstrap.startTestDb({ instanceOpts: [{ dbName: 'school_saas_phase1d4_timekeeping_test' }] });
    saasApp = buildSaasTimekeepingApp();
    legacyApp = buildLegacyTimekeepingApp();

    await Promise.all([
      Tenant.syncIndexes(),
      User.syncIndexes(),
      Employee.syncIndexes(),
      StaffShift.syncIndexes(),
      AttendanceRecord.syncIndexes(),
      AttendanceAuditLog.syncIndexes(),
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
      StaffShift.deleteMany({}),
      AttendanceRecord.deleteMany({}),
      AttendanceAuditLog.deleteMany({}),
      TimekeepingCorrectionRequest.deleteMany({})
    ]);

    // 1. Setup Tenants
    tenantA = await Tenant.create({
      code: 'SCHOOL-A',
      name: 'Trường Quốc tế Ánh Sao A',
      status: 'active',
      subscriptionPlan: 'standard'
    });

    tenantB = await Tenant.create({
      code: 'SCHOOL-B',
      name: 'Trường Mầm non Tuổi Thơ B',
      status: 'active',
      subscriptionPlan: 'standard'
    });

    const defaultPasswordHash = await hashPassword('TestPassword123@');

    // 2. Setup Users Tenant A
    adminUserA = await User.create({
      username: 'admin_a',
      tenantId: tenantA._id,
      passwordHash: defaultPasswordHash,
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Quản trị viên Trường A', phone: '0901000001' }
    });
    adminTokenA = generateSchoolUserToken(adminUserA, tenantA);

    hrUserA = await User.create({
      username: 'hr_a',
      tenantId: tenantA._id,
      passwordHash: defaultPasswordHash,
      role: 'hr',
      status: 'active',
      profile: { fullName: 'Nhân sự Trường A', phone: '0901000002' }
    });
    hrTokenA = generateSchoolUserToken(hrUserA, tenantA);

    teacherUserA = await User.create({
      username: 'teacher_a',
      tenantId: tenantA._id,
      passwordHash: defaultPasswordHash,
      role: 'teacher',
      status: 'active',
      profile: { fullName: 'Giáo viên Nguyễn Văn A', phone: '0901000003' }
    });
    teacherTokenA = generateSchoolUserToken(teacherUserA, tenantA);

    guardUserA = await User.create({
      username: 'guard_a',
      tenantId: tenantA._id,
      passwordHash: defaultPasswordHash,
      role: 'guard',
      status: 'active',
      profile: { fullName: 'Bảo vệ Trần Văn A', phone: '0901000004' }
    });
    guardTokenA = generateSchoolUserToken(guardUserA, tenantA);

    // 3. Setup Users Tenant B
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
      profile: { fullName: 'Giáo viên Trần Thị B', phone: '0902000003' }
    });
    teacherTokenB = generateSchoolUserToken(teacherUserB, tenantB);

    // 4. Setup Legacy Users
    legacyAdminUser = await User.create({
      username: 'legacy_admin',
      tenantId: null,
      passwordHash: defaultPasswordHash,
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Quản trị viên Legacy' }
    });
    legacyAdminToken = generateLegacyToken(legacyAdminUser);

    legacyTeacherUser = await User.create({
      username: 'legacy_teacher',
      tenantId: null,
      passwordHash: defaultPasswordHash,
      role: 'teacher',
      status: 'active',
      profile: { fullName: 'Giáo viên Legacy' }
    });
    legacyTeacherToken = generateLegacyToken(legacyTeacherUser);

    // 5. Setup Employees
    employeeTeacherA = await Employee.create({
      userId: teacherUserA._id,
      tenantId: tenantA._id,
      employeeCode: 'GV-A-001',
      fullName: 'Giáo viên Nguyễn Văn A',
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active'
    });

    employeeTeacherB = await Employee.create({
      userId: teacherUserB._id,
      tenantId: tenantB._id,
      employeeCode: 'GV-B-001',
      fullName: 'Giáo viên Trần Thị B',
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active'
    });

    employeeGuardA = await Employee.create({
      userId: guardUserA._id,
      tenantId: tenantA._id,
      employeeCode: 'BV-A-001',
      fullName: 'Bảo vệ Trần Văn A',
      position: 'security',
      payrollRole: 'guard',
      status: 'active'
    });
  });

  // =========================================================================
  // NHÓM A: CHẤM CÔNG THỦ CÔNG (manualCheckIn)
  // =========================================================================
  describe('Nhóm A: Chấm công thủ công (manualCheckIn)', () => {
    it('A.1: Giáo viên Tenant A chấm công thành công (201), nhận đúng tenantId và ghi AttendanceAuditLog nguyên tử', async () => {
      const res = await request(saasApp)
        .post('/api/v1/timekeeping/check-in')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({ note: 'Chấm công đầu ngày đúng giờ' });

      expect(res.status).toBe(201);
      expect(res.body.alreadyCheckedIn).toBe(false);
      expect(res.body.data.employeeName).toBe('Giáo viên Nguyễn Văn A');
      expect(res.body.data.tenantId.toString()).toBe(tenantA._id.toString());

      // Xác minh DB AttendanceRecord
      const today = startOfWorkDate(getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE), DEFAULT_SCHOOL_TIMEZONE);
      const record = await AttendanceRecord.findOne({ userId: teacherUserA._id, workDate: today });
      expect(record).not.toBeNull();
      expect(record.tenantId.toString()).toBe(tenantA._id.toString());
      expect(record.source).toBe('manual');
      expect(record.checkInTime).toBeDefined();

      // Xác minh AttendanceAuditLog
      const audit = await AttendanceAuditLog.findOne({ entityId: record._id, action: 'MANUAL_CHECK_IN' });
      expect(audit).not.toBeNull();
      expect(audit.tenantId.toString()).toBe(tenantA._id.toString());
      expect(audit.actor.toString()).toBe(teacherUserA._id.toString());
    });

    it('A.2: Chấm công lặp lại trong ngày trả về HTTP 200 { alreadyCheckedIn: true }, không đổi checkInTime cũ', async () => {
      // Lần 1: Chấm công 201
      const res1 = await request(saasApp)
        .post('/api/v1/timekeeping/check-in')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({});
      expect(res1.status).toBe(201);
      const firstCheckIn = res1.body.data.checkInTime;

      // Lần 2: Chấm công lại cùng ngày -> trả về 200 alreadyCheckedIn: true
      const res2 = await request(saasApp)
        .post('/api/v1/timekeeping/check-in')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({});
      expect(res2.status).toBe(200);
      expect(res2.body.alreadyCheckedIn).toBe(true);
      expect(new Date(res2.body.data.checkInTime).getTime()).toBe(new Date(firstCheckIn).getTime());
    });

    it('A.3: Ngày công đã chốt (finalized: true) không cho ghi đè bằng chấm công thủ công (409)', async () => {
      const today = startOfWorkDate(getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE), DEFAULT_SCHOOL_TIMEZONE);
      await AttendanceRecord.create({
        tenantId: tenantA._id,
        userId: teacherUserA._id,
        employeeName: 'Giáo viên Nguyễn Văn A',
        workDate: today,
        finalized: true,
        source: 'manual'
      });

      const res = await request(saasApp)
        .post('/api/v1/timekeeping/check-in')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('đã chốt');
    });

    it('A.4: Client gửi kèm userId hoặc tenantId ngoại lai trong payload -> Bị bỏ qua, chỉ chấm công cho actor xác thực', async () => {
      const res = await request(saasApp)
        .post('/api/v1/timekeeping/check-in')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({
          userId: teacherUserB._id.toString(),
          tenantId: tenantB._id.toString()
        });

      expect(res.status).toBe(201);
      // Bản ghi tạo ra phải thuộc teacherUserA và tenantA
      expect(res.body.data.userId.toString()).toBe(teacherUserA._id.toString());
      expect(res.body.data.tenantId.toString()).toBe(tenantA._id.toString());

      // Tenant B hoàn toàn không có AttendanceRecord nào
      const recordB = await AttendanceRecord.findOne({ userId: teacherUserB._id });
      expect(recordB).toBeNull();
    });

    it('A.5: Actor bị hạ quyền hoặc khóa sau middleware nhưng trước snapshot transaction -> Bị từ chối 403; Happy path đối ứng thành công', async () => {
      const originalStartSession = mongoose.startSession.bind(mongoose);
      let demotionTriggered = false;

      // Barrier: khi middleware xác thực xong và controller bắt đầu transaction,
      // cập nhật DB thật để khóa tài khoản teacherUserA
      const spySession = jest.spyOn(mongoose, 'startSession').mockImplementation(async (...args) => {
        if (!demotionTriggered) {
          demotionTriggered = true;
          await User.collection.updateOne({ _id: teacherUserA._id }, { $set: { status: 'inactive' } });
        }
        return originalStartSession(...args);
      });

      try {
        const resDenied = await request(saasApp)
          .post('/api/v1/timekeeping/check-in')
          .set('Authorization', `Bearer ${teacherTokenA}`)
          .send({});

        expect(resDenied.status).toBe(403);
        expect(resDenied.body.message).toContain('không còn quyền hoặc đã bị khóa');

        // Xác minh DB không có bản ghi chấm công nào
        const recordCheck = await AttendanceRecord.findOne({ userId: teacherUserA._id });
        expect(recordCheck).toBeNull();
      } finally {
        spySession.mockRestore();
        await User.collection.updateOne({ _id: teacherUserA._id }, { $set: { status: 'active' } });
      }

      // Happy path đối ứng: Khi actor active hợp lệ -> 201 thành công
      const resSuccess = await request(saasApp)
        .post('/api/v1/timekeeping/check-in')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({});

      expect(resSuccess.status).toBe(201);
      const recordSuccess = await AttendanceRecord.findOne({ userId: teacherUserA._id });
      expect(recordSuccess).not.toBeNull();
    });

    it('A.6: AttendanceAuditLog lỗi mô phỏng -> Rollback toàn bộ AttendanceRecord', async () => {
      const spyAudit = jest.spyOn(AttendanceAuditLog, 'create').mockImplementationOnce(async () => {
        throw new Error('Simulated AuditLog Failure in Check-In');
      });

      try {
        const res = await request(saasApp)
          .post('/api/v1/timekeeping/check-in')
          .set('Authorization', `Bearer ${teacherTokenA}`)
          .send({});

        expect(res.status).toBe(500);

        // Xác minh AttendanceRecord KHÔNG ĐƯỢC TẠO (rollback sạch sẽ)
        const count = await AttendanceRecord.countDocuments({ userId: teacherUserA._id });
        expect(count).toBe(0);
      } finally {
        spyAudit.mockRestore();
      }
    });
  });

  // =========================================================================
  // NHÓM B: ĐỌC CHẤM CÔNG CÁ NHÂN (getMyTimekeeping)
  // =========================================================================
  describe('Nhóm B: Đọc chấm công cá nhân (getMyTimekeeping)', () => {
    it('B.1: Giáo viên Tenant A chỉ đọc chấm công và phiếu điều chỉnh của mình, không thấy của Tenant B', async () => {
      const today = startOfWorkDate(getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE), DEFAULT_SCHOOL_TIMEZONE);

      // Tạo chấm công và correction cho Tenant A
      await AttendanceRecord.create({
        tenantId: tenantA._id,
        userId: teacherUserA._id,
        employeeName: 'Giáo viên Nguyễn Văn A',
        workDate: today,
        checkInTime: new Date()
      });
      await TimekeepingCorrectionRequest.create({
        tenantId: tenantA._id,
        userId: teacherUserA._id,
        employeeName: 'Giáo viên Nguyễn Văn A',
        workDate: today,
        adjustmentType: 'MISSING_CHECK_OUT',
        requestedAt: new Date(),
        requestedTime: '17:00',
        reason: 'Quên chấm công ra về',
        status: 'PENDING'
      });

      // Tạo chấm công cho Tenant B
      await AttendanceRecord.create({
        tenantId: tenantB._id,
        userId: teacherUserB._id,
        employeeName: 'Giáo viên Trần Thị B',
        workDate: today,
        checkInTime: new Date()
      });

      const res = await request(saasApp)
        .get('/api/v1/timekeeping/me')
        .set('Authorization', `Bearer ${teacherTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.records.length).toBe(1);
      expect(res.body.data.records[0].employeeName).toBe('Giáo viên Nguyễn Văn A');
      expect(res.body.data.corrections.length).toBe(1);
      expect(res.body.data.corrections[0].reason).toBe('Quên chấm công ra về');
    });

    it('B.2: Không thể dùng query userId để xem dữ liệu người khác (luôn ép dùng req.user._id)', async () => {
      const today = startOfWorkDate(getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE), DEFAULT_SCHOOL_TIMEZONE);
      await AttendanceRecord.create({
        tenantId: tenantA._id,
        userId: adminUserA._id,
        employeeName: 'Quản trị viên Trường A',
        workDate: today,
        checkInTime: new Date()
      });

      const res = await request(saasApp)
        .get(`/api/v1/timekeeping/me?userId=${adminUserA._id}`)
        .set('Authorization', `Bearer ${teacherTokenA}`);

      expect(res.status).toBe(200);
      // Teacher A chưa có bản ghi nào thì mảng rỗng, không được trả về của adminUserA
      expect(res.body.data.records.length).toBe(0);
    });

    it('B.3: Tính đúng ca làm việc, lateMinutes, earlyLeaveMinutes theo StaffShift của tenant', async () => {
      const dateStr = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
      const today = startOfWorkDate(dateStr, DEFAULT_SCHOOL_TIMEZONE);
      const weekday = new Date(`${dateStr}T00:00:00.000Z`).getUTCDay();

      // Gán ca làm việc: 08:00 - 17:00 cho bảo vệ guardUserA
      await StaffShift.create({
        tenantId: tenantA._id,
        employeeId: employeeGuardA._id,
        name: 'Ca Bảo Vệ Ngày',
        role: 'guard',
        createdBy: adminUserA._id,
        startTime: '08:00',
        endTime: '17:00',
        validFrom: '2026-01-01',
        validUntil: '2026-12-31',
        weekdays: [weekday],
        status: 'active'
      });

      // Tạo chấm công vào trễ: 08:15 (trễ 15 phút), ra sớm: 16:50 (sớm 10 phút)
      const checkInTime = new Date(`${dateStr}T08:15:00.000+07:00`);
      const checkOutTime = new Date(`${dateStr}T16:50:00.000+07:00`);

      await AttendanceRecord.create({
        tenantId: tenantA._id,
        userId: guardUserA._id,
        employeeName: 'Bảo vệ Trần Văn A',
        workDate: today,
        checkInTime,
        checkOutTime,
        source: 'manual'
      });

      const res = await request(saasApp)
        .get('/api/v1/timekeeping/me')
        .set('Authorization', `Bearer ${guardTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.records.length).toBe(1);
      const rec = res.body.data.records[0];
      expect(rec.shift.name).toBe('Ca Bảo Vệ Ngày');
      expect(rec.lateMinutes).toBe(15);
      expect(rec.earlyLeaveMinutes).toBe(10);
    });

    it('B.4: Employee trỏ nhầm User Tenant B (alien user link) -> Bị cô lập, không lộ ca làm việc', async () => {
      const dateStr = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
      const today = startOfWorkDate(dateStr, DEFAULT_SCHOOL_TIMEZONE);

      // Tạo User mới thuộc Tenant B chưa có Employee
      const alienUserB2 = await User.create({
        username: 'teacher_b2',
        tenantId: tenantB._id,
        passwordHash: await hashPassword('TestPassword123@'),
        role: 'teacher',
        status: 'active',
        profile: { fullName: 'Giáo viên B2' }
      });
      const alienTokenB2 = generateSchoolUserToken(alienUserB2, tenantB);

      // Tạo employee ngoại lai ở Tenant A nhưng trỏ vào alienUserB2
      const alienEmp = await Employee.create({
        tenantId: tenantA._id,
        userId: alienUserB2._id,
        employeeCode: 'ALIEN-001',
        fullName: 'Alien Teacher',
        position: 'teacher',
        status: 'active'
      });

      await StaffShift.create({
        tenantId: tenantA._id,
        employeeId: alienEmp._id,
        name: 'Ca Bí Mật Trường A',
        role: 'guard',
        createdBy: adminUserA._id,
        startTime: '07:30',
        endTime: '16:30',
        validFrom: '2026-01-01',
        validUntil: '2026-12-31',
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        status: 'active'
      });

      // Teacher B2 gọi getMyTimekeeping ở Tenant B
      const res = await request(saasApp)
        .get('/api/v1/timekeeping/me')
        .set('Authorization', `Bearer ${alienTokenB2}`);

      expect(res.status).toBe(200);
      // Không được nhìn thấy Ca Bí Mật Trường A
      if (res.body.data.records.length > 0) {
        expect(res.body.data.records[0].shift?.name).not.toBe('Ca Bí Mật Trường A');
      }
    });
  });

  // =========================================================================
  // NHÓM C: BẢNG CHẤM CÔNG TOÀN TRƯỜNG THEO NGÀY (getDailyTimekeeping)
  // =========================================================================
  describe('Nhóm C: Bảng chấm công theo ngày (getDailyTimekeeping)', () => {
    it('C.1: Admin/HR Tenant A xem bảng công của ngày -> Chỉ hiện nhân sự và chấm công thuộc Tenant A', async () => {
      const dateStr = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
      const today = startOfWorkDate(dateStr, DEFAULT_SCHOOL_TIMEZONE);

      await AttendanceRecord.create({
        tenantId: tenantA._id,
        userId: teacherUserA._id,
        employeeName: 'Giáo viên Nguyễn Văn A',
        workDate: today,
        checkInTime: new Date()
      });

      await AttendanceRecord.create({
        tenantId: tenantB._id,
        userId: teacherUserB._id,
        employeeName: 'Giáo viên Trần Thị B',
        workDate: today,
        checkInTime: new Date()
      });

      const res = await request(saasApp)
        .get(`/api/v1/timekeeping/daily?date=${dateStr}`)
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.date).toBe(dateStr);
      // Chỉ có nhân sự của trường A
      const names = res.body.data.rows.map((r) => r.employeeName);
      expect(names).toContain('Giáo viên Nguyễn Văn A');
      expect(names).not.toContain('Giáo viên Trần Thị B');
    });

    it('C.2: Employee Tenant A bị trỏ nhầm userId sang Tenant B -> Bị lọc bỏ, không rò rỉ dữ liệu', async () => {
      const dateStr = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);

      const alienUserB3 = await User.create({
        username: 'teacher_b3',
        tenantId: tenantB._id,
        passwordHash: await hashPassword('TestPassword123@'),
        role: 'teacher',
        status: 'active',
        profile: { fullName: 'Giáo viên B3' }
      });

      // Tạo Employee thuộc Tenant A nhưng userId trỏ vào alienUserB3
      await Employee.create({
        tenantId: tenantA._id,
        userId: alienUserB3._id,
        employeeCode: 'ALIEN-EMP',
        fullName: 'Hồ Sơ Ngoại Lai Giả Mạo',
        position: 'teacher',
        payrollRole: 'teacher',
        status: 'active'
      });

      const res = await request(saasApp)
        .get(`/api/v1/timekeeping/daily?date=${dateStr}`)
        .set('Authorization', `Bearer ${hrTokenA}`);

      expect(res.status).toBe(200);
      const codes = res.body.data.rows.map((r) => r.employeeCode);
      expect(codes).not.toContain('ALIEN-EMP');
    });

    it('C.3: Teacher không có quyền gọi GET /daily (403)', async () => {
      const res = await request(saasApp)
        .get('/api/v1/timekeeping/daily')
        .set('Authorization', `Bearer ${teacherTokenA}`);

      expect(res.status).toBe(403);
    });

    it('C.4: Ngày công sai định dạng trả HTTP 400 có kiểm soát', async () => {
      const res = await request(saasApp)
        .get('/api/v1/timekeeping/daily?date=invalid-date-format')
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('YYYY-MM-DD');
    });
  });

  // =========================================================================
  // NHÓM D: CÁCH LY LEGACY & KHÓA ROUTER SAAS
  // =========================================================================
  describe('Nhóm D: Cách ly Legacy & Khóa Router SaaS', () => {
    it('D.1: Legacy Teacher chấm công độc lập với tenantId: null, không thấy dữ liệu SaaS', async () => {
      const res = await request(legacyApp)
        .post('/api/v1/timekeeping/check-in')
        .set('Authorization', `Bearer ${legacyTeacherToken}`)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.data.tenantId).toBeNull();

      // Kiểm tra DB
      const record = await AttendanceRecord.findOne({ userId: legacyTeacherUser._id });
      expect(record).not.toBeNull();
      expect(record.tenantId).toBeNull();

      // Legacy không đọc được dữ liệu của SaaS
      const resMe = await request(legacyApp)
        .get('/api/v1/timekeeping/me')
        .set('Authorization', `Bearer ${legacyTeacherToken}`);

      expect(resMe.status).toBe(200);
      expect(resMe.body.data.records.length).toBe(1);
      expect(resMe.body.data.records[0].tenantId).toBeNull();
    });

    it('D.2: createSaasApp tiếp tục chặn route timekeeping ở mode hiện hành (501 / 404)', async () => {
      const realSaasApp = createSaasApp({ connection: mongoose.connection });

      const res = await request(realSaasApp)
        .post('/api/v1/timekeeping/check-in')
        .set('Authorization', `Bearer ${teacherTokenA}`)
        .send({});

      // Chưa mở router ở 1D.4, phải trả về 501 hoặc 404
      expect([404, 501]).toContain(res.status);
    });
  });
});
