'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const assembleSaasApp = require('../src/saas/assembleSaasApp');
const { ensureDefaultAdminAccount } = require('../src/services/defaultAdminBootstrapService');
const { invalidateSystemSettingsCache } = require('../src/services/superAdminControlService');
const Classroom = require('../src/models/zone3_school/Classroom');
const Student = require('../src/models/zone3_school/Student');
const StudentAttendance = require('../src/models/zone3_school/StudentAttendance');
const AttendanceRecord = require('../src/models/zone2_hr/AttendanceRecord');
const TuitionFee = require('../src/models/zone4_finance/TuitionFee');

describe('E2E: SuperAdmin -> School Admin -> Staff Roles + Webhook /:schoolCode + Analytics & School Logs', () => {
  jest.setTimeout(30000);
  let replSet;
  let saasApp;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test_superadmin_e2e_jwt_secret_at_least_32_chars_long';
    process.env.JWT_ISSUER = 'school-management-api';
    process.env.JWT_AUDIENCE = 'school-management-web';
    process.env.JWT_EXPIRES_IN = '1h';
    delete process.env.TIMEKEEPING_WEBHOOK_TOKEN;

    mongoose.set('autoIndex', false);
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri(), { dbName: 'superadmin_webhook_logs_e2e' });
    saasApp = assembleSaasApp({ saasMode: 'phase1e' });
  }, 45000);

  afterEach(async () => {
    invalidateSystemSettingsCache();
    const collections = await mongoose.connection.db.collections();
    for (const col of collections) {
      await col.deleteMany({});
    }
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (replSet) {
      await replSet.stop();
    }
  });

  test('Chuỗi đầy đủ: SuperAdmin cấp TK Admin trường -> Admin trường tạo Giám đốc/GV/Đầu bếp -> Đồng bộ Webhook /:schoolCode -> Xem Thống kê & Log từng trường', async () => {
    // 1. Khởi tạo SuperAdmin mặc định và đăng nhập
    await ensureDefaultAdminAccount({ useLegacyApp: false });
    const superLogin = await request(saasApp)
      .post('/api/auth/login')
      .send({ username: 'admin', password: '123456' });

    expect(superLogin.status).toBe(200);
    expect(superLogin.body.isSuperAdmin).toBe(true);
    const superToken = superLogin.body.token;

    // 2. SuperAdmin tạo 2 trường độc lập (HOANANG-A & HOANANG-B) kèm tài khoản Admin riêng
    const createSchoolARes = await request(saasApp)
      .post('/api/multi-school/schools')
      .set('Authorization', `Bearer ${superToken}`)
      .send({
        code: 'HOANANG-A',
        name: 'Trường Mầm non Hoa Nắng - Cơ sở A',
        adminUsername: 'admin_csa',
        adminPassword: 'AdminA@2026',
        adminFullName: 'Quản trị Cơ sở A'
      });
    expect(createSchoolARes.status).toBe(201);
    const schoolAId = createSchoolARes.body.data.school._id;

    const createSchoolBRes = await request(saasApp)
      .post('/api/multi-school/schools')
      .set('Authorization', `Bearer ${superToken}`)
      .send({
        code: 'HOANANG-B',
        name: 'Trường Mầm non Hoa Nắng - Cơ sở B',
        adminUsername: 'admin_csb',
        adminPassword: 'AdminB@2026',
        adminFullName: 'Quản trị Cơ sở B'
      });
    expect(createSchoolBRes.status).toBe(201);
    const schoolBId = createSchoolBRes.body.data.school._id;

    // 3. Admin trường HOANANG-A đăng nhập (không cần truyền schoolCode vì username riêng biệt)
    const adminALogin = await request(saasApp)
      .post('/api/auth/login')
      .send({ username: 'admin_csa', password: 'AdminA@2026' });
    expect(adminALogin.status).toBe(200);
    expect(adminALogin.body.user.role).toBe('admin');
    expect(adminALogin.body.tenant.code).toBe('HOANANG-A');
    const adminAToken = adminALogin.body.token;

    // 4. Admin trường A tự tạo tài khoản Ban Giám đốc (principal), Giáo viên (teacher) và Đầu bếp (chef)
    const rolesToCreate = [
      { username: 'giamdoc_a', role: 'principal', fullName: 'Trần Thị Giám Đốc' },
      { username: 'giaovien_a', role: 'teacher', fullName: 'Nguyễn Thị Giáo Viên' },
      { username: 'daubep_a', role: 'chef', fullName: 'Lê Văn Đầu Bếp' },
      { username: 'ketoan_a', role: 'accountant', fullName: 'Phạm Thị Kế Toán' }
    ];

    const createdStaff = {};
    for (const item of rolesToCreate) {
      const res = await request(saasApp)
        .post('/api/system/accounts')
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          username: item.username,
          password: 'Staff@12345',
          role: item.role,
          profile: { fullName: item.fullName, phone: '0912345678' }
        });
      expect(res.status).toBe(201);
      expect(res.body.data.role).toBe(item.role);
      createdStaff[item.role] = res.body.data;
    }

    // Giám đốc vừa tạo có thể đăng nhập vào hệ thống bình thường
    const directorLogin = await request(saasApp)
      .post('/api/auth/login')
      .send({ username: 'giamdoc_a', password: 'Staff@12345' });
    expect(directorLogin.status).toBe(200);
    expect(directorLogin.body.user.role).toBe('principal');

    // 5. Tạo lớp học, học sinh & hóa đơn tại trường A để kiểm tra Webhook điểm danh + Kinh tế
    const clsA = await Classroom.create({
      tenantId: schoolAId,
      name: 'Mầm 1',
      ageGroup: '3-4',
      schoolYear: '2026-2027',
      campus: 'Cơ sở chính',
      maxSize: 25,
      status: 'active'
    });

    const studentA = await Student.create({
      tenantId: schoolAId,
      studentCode: 'HS-2026-000101',
      fullName: 'Bé Nguyễn Minh Khôi',
      birthDate: new Date('2022-05-10'),
      gender: 'male',
      classroomId: clsA._id,
      className: clsA.name,
      status: 'enrolled'
    });

    await TuitionFee.create({
      tenantId: schoolAId,
      studentId: studentA._id,
      studentName: studentA.fullName,
      classroomId: clsA._id,
      className: clsA.name,
      period: '11-2026',
      tuitionBase: 3500000,
      mealFee: 1000000,
      totalAmount: 4500000,
      paidAmount: 3500000,
      remainingAmount: 1000000,
      dueDate: new Date('2026-11-15'),
      status: 'partial'
    });

    // 6. Kiểm tra GET ping & POST đồng bộ Webhook đuôi /:schoolCode cho CẢ Học sinh & Nhân viên
    const pingRes = await request(saasApp).get('/api/attendance/webhook/HOANANG-A');
    expect(pingRes.status).toBe(200);
    expect(pingRes.body.schoolCode).toBe('HOANANG-A');
    expect(pingRes.body.schoolActive).toBe(true);

    // 6a. Quẹt khuôn mặt HỌC SINH qua /api/attendance/webhook/HOANANG-A
    const punchStudentRes = await request(saasApp)
      .post('/api/attendance/webhook/HOANANG-A')
      .send({
        ipAddress: '192.168.1.50',
        dateTime: '2026-11-27T07:35:00+07:00',
        eventType: 'AccessControllerEvent',
        AccessControllerEvent: {
          majorEventType: 5,
          subEventType: 75,
          employeeNoString: 'HS-2026-000101',
          name: 'Bé Nguyễn Minh Khôi',
          currentVerifyMode: 'face',
          serialNo: 1001
        }
      });

    expect(punchStudentRes.status).toBe(200);
    expect(punchStudentRes.body.attendanceResult?.status).toBe('OK');
    expect(punchStudentRes.body.attendanceResult?.subjectType).toBe('STUDENT');
    expect(punchStudentRes.body.attendanceResult?.action).toBe('CHECK_IN');

    const stuAttDoc = await StudentAttendance.findOne({ tenantId: schoolAId, studentId: studentA._id }).lean();
    expect(stuAttDoc).toBeTruthy();
    expect(stuAttDoc.status).toBe('present');

    // Không bị rò rỉ sang trường B
    const stuAttInB = await StudentAttendance.countDocuments({ tenantId: schoolBId });
    expect(stuAttInB).toBe(0);

    // 6b. Quẹt khuôn mặt GIÁO VIÊN qua nhánh alias /api/timekeeping/webhook/HOANANG-A (dùng mã nhân sự tự sinh hoặc username)
    const teacherEmpCode = createdStaff.teacher.employeeId || 'giaovien_a';
    const punchTeacherRes = await request(saasApp)
      .post('/api/timekeeping/webhook/HOANANG-A')
      .send({
        ipAddress: '192.168.1.50',
        dateTime: '2026-11-27T07:20:00+07:00',
        eventType: 'AccessControllerEvent',
        AccessControllerEvent: {
          majorEventType: 5,
          subEventType: 75,
          employeeNoString: teacherEmpCode,
          name: 'Nguyễn Thị Giáo Viên',
          currentVerifyMode: 'face',
          serialNo: 1002
        }
      });

    expect(punchTeacherRes.status).toBe(200);
    expect(punchTeacherRes.body.attendanceResult?.status).toBe('OK');
    expect(punchTeacherRes.body.attendanceResult?.subjectType).toBe('EMPLOYEE');

    const staffAttDoc = await AttendanceRecord.findOne({
      tenantId: schoolAId,
      userId: createdStaff.teacher._id
    }).lean();
    expect(staffAttDoc).toBeTruthy();

    // 6c. Admin trường A giả lập test Webhook ngay trên giao diện trường
    const simRes = await request(saasApp)
      .post('/api/timekeeping/devices/simulate-webhook')
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({
        externalPersonId: 'daubep_a',
        personName: 'Lê Văn Đầu Bếp',
        verifyMode: 'FACE'
      });
    expect(simRes.status).toBe(200);
    expect(simRes.body.data.attendanceResult?.subjectType).toBe('EMPLOYEE');

    // 7. SuperAdmin xem Dashboard Kinh tế, Mức độ sử dụng & Log của từng trường một
    const dashRes = await request(saasApp)
      .get('/api/multi-school/schools')
      .set('Authorization', `Bearer ${superToken}`);
    expect(dashRes.status).toBe(200);
    expect(Array.isArray(dashRes.body.data.economicTrend)).toBe(true);
    expect(dashRes.body.data.economicTrend.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(dashRes.body.data.roleDistribution)).toBe(true);

    const schoolADash = dashRes.body.data.schools.find((s) => s.code === 'HOANANG-A');
    expect(schoolADash.webhook.endpointPath).toBe('/api/attendance/webhook/HOANANG-A');
    expect(schoolADash.webhook.totalEvents).toBe(3);
    expect(schoolADash.usage.usageScorePercent).toBeGreaterThanOrEqual(60);

    // 7a. SuperAdmin xem Nhật ký Nghiệp vụ riêng của trường A (thấy đúng 4 lần tạo tài khoản nhân sự)
    const schoolAAuditRes = await request(saasApp)
      .get('/api/multi-school/school-logs')
      .query({ schoolId: String(schoolAId), logType: 'school_audit' })
      .set('Authorization', `Bearer ${superToken}`);
    expect(schoolAAuditRes.status).toBe(200);
    expect(schoolAAuditRes.body.data.length).toBeGreaterThanOrEqual(4);
    expect(schoolAAuditRes.body.data.every((l) => l.schoolCode === 'HOANANG-A')).toBe(true);

    // Trường B chưa có thao tác nội bộ nào -> Log riêng trường B phải bằng 0 (cách ly tuyệt đối)
    const schoolBAuditRes = await request(saasApp)
      .get('/api/multi-school/school-logs')
      .query({ schoolId: String(schoolBId), logType: 'school_audit' })
      .set('Authorization', `Bearer ${superToken}`);
    expect(schoolBAuditRes.status).toBe(200);
    expect(schoolBAuditRes.body.data.length).toBe(0);

    // 7b. SuperAdmin xem Nhật ký Webhook riêng của trường A -> thấy đúng 3 sự kiện quẹt máy
    const schoolAWebhookLogs = await request(saasApp)
      .get('/api/multi-school/school-logs')
      .query({ schoolId: String(schoolAId), logType: 'webhook' })
      .set('Authorization', `Bearer ${superToken}`);
    expect(schoolAWebhookLogs.status).toBe(200);
    expect(schoolAWebhookLogs.body.data.length).toBe(3);
  });

  test('Cách ly tuyệt đối Thông báo: Cảnh báo vận hành trường không đẩy lên SuperAdmin; thông báo của trường nào CHỈ gửi cho đúng trường đó', async () => {
    await ensureDefaultAdminAccount({ useLegacyApp: false });
    const superLogin = await request(saasApp)
      .post('/api/auth/login')
      .send({ username: 'admin', password: '123456' });
    const superToken = superLogin.body.token;

    // Tạo Trường A và Trường B
    const resA = await request(saasApp)
      .post('/api/multi-school/schools')
      .set('Authorization', `Bearer ${superToken}`)
      .send({
        code: 'TRUONG-A',
        name: 'Trường Mầm non Ánh Dương A',
        adminUsername: 'admin_a',
        adminPassword: 'PasswordA1!'
      });
    const schoolAId = resA.body.data.school._id;

    const resB = await request(saasApp)
      .post('/api/multi-school/schools')
      .set('Authorization', `Bearer ${superToken}`)
      .send({
        code: 'TRUONG-B',
        name: 'Trường Mầm non Bình Minh B',
        adminUsername: 'admin_b',
        adminPassword: 'PasswordB1!'
      });
    const schoolBId = resB.body.data.school._id;

    // Trường A có học sinh đang theo học nhưng CHƯA điểm danh hôm nay
    const clsA = await Classroom.create({
      tenantId: schoolAId,
      name: 'Lá 1',
      ageGroup: '4-5',
      schoolYear: '2026-2027',
      campus: 'Cơ sở chính',
      maxSize: 25,
      status: 'active'
    });
    await Student.create({
      tenantId: schoolAId,
      studentCode: 'HS-2026-000999',
      fullName: 'Bé Trần Bảo Ngọc',
      birthDate: new Date('2021-08-12'),
      gender: 'female',
      classroomId: clsA._id,
      className: clsA.name,
      status: 'enrolled'
    });

    // 1. Kiểm tra Dashboard của SuperAdmin: KHÔNG BAO GIỜ chứa cảnh báo điểm danh nội bộ của Trường A
    const superDash = await request(saasApp)
      .get('/api/multi-school/schools')
      .set('Authorization', `Bearer ${superToken}`);
    expect(superDash.status).toBe(200);
    const leakedAttendanceAlert = (superDash.body.data.alerts || []).find(
      (al) => al.category === 'attendance' || al.category === 'food_safety' || al.category === 'feedback'
    );
    expect(leakedAttendanceAlert).toBeUndefined();

    // 2. Đăng nhập Admin Trường A và Admin Trường B
    const loginA = await request(saasApp)
      .post('/api/auth/login')
      .send({ username: 'admin_a', password: 'PasswordA1!' });
    const tokenA = loginA.body.token;

    const loginB = await request(saasApp)
      .post('/api/auth/login')
      .send({ username: 'admin_b', password: 'PasswordB1!' });
    const tokenB = loginB.body.token;

    // 3. SuperAdmin gửi thông báo hệ thống CHỈ dành riêng cho Trường A
    const dispatchRes = await request(saasApp)
      .post('/api/multi-school/notifications/dispatch')
      .set('Authorization', `Bearer ${superToken}`)
      .send({
        targetScope: 'single',
        schoolId: String(schoolAId),
        type: 'system',
        title: 'Đã nâng hạn mức gói phần mềm cho Trường Ánh Dương A',
        message: 'Hệ thống vừa nâng hạn mức học sinh tối đa của trường lên 1.200 học sinh.'
      });
    expect(dispatchRes.status).toBe(201);

    // 4. SuperAdmin bật System Banner CHỈ chỉ định cho TRUONG-A
    const bannerSave = await request(saasApp)
      .put('/api/multi-school/settings')
      .set('Authorization', `Bearer ${superToken}`)
      .send({
        systemBanner: {
          enabled: true,
          level: 'info',
          message: 'Thông báo bảo trì riêng cổng dữ liệu Trường A',
          targetSchoolCodes: ['TRUONG-A']
        }
      });
    expect(bannerSave.status).toBe(200);

    const metaForA = await request(saasApp).get('/api/multi-school/public-meta').query({ schoolCode: 'TRUONG-A' });
    const metaForB = await request(saasApp).get('/api/multi-school/public-meta').query({ schoolCode: 'TRUONG-B' });
    expect(metaForA.body.data.systemBanner.enabled).toBe(true);
    expect(metaForB.body.data.systemBanner.enabled).toBe(false);

    // 5. Chuông thông báo của Trường A nhận đầy đủ thông báo riêng của Trường A; Trường B tuyệt đối KHÔNG thấy thông báo nào của Trường A
    const notifA = await request(saasApp)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(notifA.status).toBe(200);
    expect(notifA.body.data.some((n) => n.title.includes('Trường Ánh Dương A'))).toBe(true);

    const notifB = await request(saasApp)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(notifB.status).toBe(200);
    expect(notifB.body.data.some((n) => n.title.includes('Trường Ánh Dương A'))).toBe(false);
    expect(notifB.body.data.some((n) => String(n.tenantId) === String(schoolAId))).toBe(false);
    expect(schoolBId).toBeDefined();
  });
});
