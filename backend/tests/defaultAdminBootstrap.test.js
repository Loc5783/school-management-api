'use strict';

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const assembleSaasApp = require('../src/saas/assembleSaasApp');
const createLegacyApp = require('../app');
const User = require('../src/models/zone1_system/User');
const Tenant = require('../src/models/zone1_system/Tenant');
const Permission = require('../src/models/zone1_system/Permission');
const PlatformAdmin = require('../src/models/zone1_system/PlatformAdmin');
const SystemSetting = require('../src/models/zone1_system/SystemSetting');
const { invalidateSystemSettingsCache } = require('../src/services/superAdminControlService');
const { ensureDefaultAdminAccount } = require('../src/services/defaultAdminBootstrapService');

describe('Default Admin Tổng Bootstrap & Unified Login (Auto-create Admin Tổng admin/123456)', () => {
  let mongod;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test_bootstrap_jwt_secret_at_least_32_characters_long';
    process.env.JWT_ISSUER = 'school-management-api';
    process.env.JWT_AUDIENCE = 'school-management-web';
    process.env.JWT_EXPIRES_IN = '1h';
    delete process.env.AUTO_CREATE_DEFAULT_ADMIN;
    delete process.env.AUTO_CREATE_DEFAULT_SCHOOL;

    mongoose.set('autoIndex', false);
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: 'bootstrap_admin_test' });
  }, 30000);

  afterEach(async () => {
    invalidateSystemSettingsCache();
    await Promise.all([
      User.deleteMany({}),
      Tenant.deleteMany({}),
      Permission.deleteMany({}),
      PlatformAdmin.deleteMany({}),
      SystemSetting.deleteMany({})
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) {
      await mongod.stop();
    }
  });

  test('Khi DB trống: Tự động tạo Admin Tổng (admin/123456), KHÔNG tạo trường ảo; để trống Mã trường vào thẳng Admin Tổng rồi tạo trường riêng', async () => {
    const result = await ensureDefaultAdminAccount({ useLegacyApp: false });
    expect(result.created).toBe(true);
    expect(result.isSuperAdmin).toBe(true);
    expect(result.schoolCode).toBeNull();
    expect(result.username).toBe('admin');

    // Không tự động sinh trường ảo khi DB mới
    expect(await Tenant.countDocuments({})).toBe(0);
    expect(await Permission.countDocuments({})).toBeGreaterThanOrEqual(29);

    const saasApp = assembleSaasApp({ saasMode: 'phase1e' });

    // 1. Đăng nhập tại /api/auth/login với Mã trường ĐỂ TRỐNG -> Vào thẳng phiên Admin Tổng Đa Trường
    const superLoginRes = await request(saasApp)
      .post('/api/auth/login')
      .send({
        schoolCode: '',
        username: 'admin',
        password: '123456'
      });

    expect(superLoginRes.status).toBe(200);
    expect(superLoginRes.body.success).toBe(true);
    expect(superLoginRes.body.isSuperAdmin).toBe(true);
    expect(superLoginRes.body.user.role).toBe('superadmin');
    expect(superLoginRes.body.user.username).toBe('admin');

    // 2. Admin Tổng chủ động tạo trường đầu tiên và cấp tài khoản Admin riêng cho trường đó
    const createSchoolRes = await request(saasApp)
      .post('/api/multi-school/schools')
      .set('Authorization', `Bearer ${superLoginRes.body.token}`)
      .send({
        code: 'HOANANG-A',
        name: 'Trường Mầm non Hoa Nắng - Cơ sở A',
        adminUsername: 'admin',
        adminPassword: 'MatKhauTruongA!',
        adminFullName: 'Quản trị Trường A'
      });
    expect(createSchoolRes.status).toBe(201);

    // 3. Có nhập Mã trường HOANANG-A + tài khoản riêng của trường A -> Vào đúng không gian làm việc Trường A
    const schoolLoginRes = await request(saasApp)
      .post('/api/auth/login')
      .send({
        schoolCode: 'HOANANG-A',
        username: 'admin',
        password: 'MatKhauTruongA!'
      });
    expect(schoolLoginRes.status).toBe(200);
    expect(schoolLoginRes.body.isSuperAdmin).toBeUndefined();
    expect(schoolLoginRes.body.user.role).toBe('admin');
    expect(schoolLoginRes.body.tenant.code).toBe('HOANANG-A');

    // 4. Để trống Mã trường + mật khẩu của Admin Tổng vẫn vào đúng Admin Tổng (không bị nhầm sang Trường A)
    const superLoginAgain = await request(saasApp)
      .post('/api/auth/login')
      .send({
        username: 'admin',
        password: '123456'
      });
    expect(superLoginAgain.status).toBe(200);
    expect(superLoginAgain.body.isSuperAdmin).toBe(true);
    expect(superLoginAgain.body.user.role).toBe('superadmin');

    // 5. KHÔNG cần nhập Mã trường: tài khoản riêng của Trường A (mật khẩu khác Admin Tổng) tự động nhận diện vào thẳng Trường A!
    const schoolAdminAutoDetectRes = await request(saasApp)
      .post('/api/auth/login')
      .send({
        username: 'admin',
        password: 'MatKhauTruongA!'
      });
    expect(schoolAdminAutoDetectRes.status).toBe(200);
    expect(schoolAdminAutoDetectRes.body.user.role).toBe('admin');
    expect(schoolAdminAutoDetectRes.body.tenant.code).toBe('HOANANG-A');

    // 6. Kể cả khi còn lưu Mã trường HOANANG-A, đăng nhập bằng tài khoản Admin Tổng vẫn tự động vào đúng /multi-school (superadmin)
    const superAdminWithStaleSchoolCodeRes = await request(saasApp)
      .post('/api/auth/login')
      .send({
        schoolCode: 'HOANANG-A',
        username: 'admin',
        password: '123456'
      });
    expect(superAdminWithStaleSchoolCodeRes.status).toBe(200);
    expect(superAdminWithStaleSchoolCodeRes.body.isSuperAdmin).toBe(true);
    expect(superAdminWithStaleSchoolCodeRes.body.user.role).toBe('superadmin');

    // 7. Giáo viên / Phụ huynh / Nhân sự chỉ cần nhập username + password (KHÔNG cần nhập Mã trường) -> Tự động nhận diện đúng trường & role
    const tenantADoc = await Tenant.findOne({ code: 'HOANANG-A' });
    await User.create({
      tenantId: tenantADoc._id,
      username: 'phungvandung@gmail.com',
      passwordHash: await bcrypt.hash('GiaoVien123!', 8),
      role: 'teacher',
      status: 'active',
      profile: { fullName: 'Phùng Văn Dũng' }
    });

    const teacherAutoLoginRes = await request(saasApp)
      .post('/api/auth/login')
      .send({
        username: 'phungvandung@gmail.com',
        password: 'GiaoVien123!'
      });
    expect(teacherAutoLoginRes.status).toBe(200);
    expect(teacherAutoLoginRes.body.user.role).toBe('teacher');
    expect(teacherAutoLoginRes.body.tenant.code).toBe('HOANANG-A');
  });

  test('Không ghi đè mật khẩu nếu DB đã có tài khoản Admin Tổng từ trước và hỗ trợ Admin Tổng tự đổi mật khẩu', async () => {
    await ensureDefaultAdminAccount({ useLegacyApp: false });
    const saasApp = assembleSaasApp({ saasMode: 'phase1e' });

    const loginRes = await request(saasApp)
      .post('/api/auth/login')
      .send({ schoolCode: '', username: 'admin', password: '123456' });
    expect(loginRes.status).toBe(200);

    // Admin Tổng đổi mật khẩu qua API /api/multi-school/me/password
    const changePassRes = await request(saasApp)
      .post('/api/multi-school/me/password')
      .set('Authorization', `Bearer ${loginRes.body.token}`)
      .send({
        currentPassword: '123456',
        newPassword: 'MatKhauTongAnToan2026!'
      });
    expect(changePassRes.status).toBe(200);
    expect(changePassRes.body.token).toBeTruthy();

    // Khởi động lại server lần 2 -> không được ghi đè lại 123456
    const secondRun = await ensureDefaultAdminAccount({ useLegacyApp: false });
    expect(secondRun.created).toBe(false);

    const oldPassRes = await request(saasApp)
      .post('/api/auth/login')
      .send({ username: 'admin', password: '123456' });
    expect(oldPassRes.status).toBe(401);

    const newPassRes = await request(saasApp)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'MatKhauTongAnToan2026!' });
    expect(newPassRes.status).toBe(200);
    expect(newPassRes.body.isSuperAdmin).toBe(true);
  });

  test('Hỗ trợ tự động tạo admin/123456 ở chế độ Legacy (useLegacyApp=true)', async () => {
    const result = await ensureDefaultAdminAccount({ useLegacyApp: true });
    expect(result.created).toBe(true);
    expect(result.schoolCode).toBeNull();

    const legacyApp = createLegacyApp();
    const loginRes = await request(legacyApp)
      .post('/api/auth/login')
      .send({ username: 'admin', password: '123456' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeTruthy();
    expect(loginRes.body.user.role).toBe('admin');
  });

  test('Chạy một mình Backend phục vụ trọn vẹn cả Frontend Production SPA, Assets và API đăng nhập gộp trên cùng cổng', async () => {
    await ensureDefaultAdminAccount({ useLegacyApp: false });
    const saasApp = assembleSaasApp({ saasMode: 'phase1e' });

    const rootRes = await request(saasApp).get('/');
    expect(rootRes.status).toBe(200);
    expect(rootRes.headers['content-type']).toMatch(/text\/html/);
    expect(rootRes.text).toContain('<div id="root">');

    const spaRouteRes = await request(saasApp).get('/multi-school');
    expect(spaRouteRes.status).toBe(200);
    expect(spaRouteRes.headers['content-type']).toMatch(/text\/html/);
    expect(spaRouteRes.text).toContain('<div id="root">');

    const missingApiRes = await request(saasApp).get('/api/duong-dan-khong-ton-tai');
    expect(missingApiRes.headers['content-type']).toMatch(/application\/json/);

    // Gửi POST đăng nhập Admin Tổng cùng Origin với tên miền Production bất kỳ (Mã trường để trống)
    const sameOriginLoginRes = await request(saasApp)
      .post('/api/auth/login')
      .set('Host', 'chaosin3d.io.vn')
      .set('Origin', 'https://chaosin3d.io.vn')
      .send({
        schoolCode: '',
        username: 'admin',
        password: '123456'
      });
    expect(sameOriginLoginRes.status).toBe(200);
    expect(sameOriginLoginRes.body.success).toBe(true);
    expect(sameOriginLoginRes.body.isSuperAdmin).toBe(true);
  });

  test('SuperAdmin Dashboard Hiệu năng, Báo cáo 360°, Cấu hình Hệ thống, Gói Module/Hạn mức và Ranh giới Admin trường', async () => {
    await ensureDefaultAdminAccount({ useLegacyApp: false });
    const saasApp = assembleSaasApp({ saasMode: 'phase1e' });

    const superLogin = await request(saasApp)
      .post('/api/auth/login')
      .send({ username: 'admin', password: '123456' });
    expect(superLogin.status).toBe(200);
    const superToken = superLogin.body.token;

    // 1. Tạo trường mới kèm hạn mức maxCampuses = 2 và khóa thử phân hệ 'finance'
    const createRes = await request(saasApp)
      .post('/api/multi-school/schools')
      .set('Authorization', `Bearer ${superToken}`)
      .send({
        code: 'HOANANG-PRO',
        name: 'Trường Mầm non Hoa Nắng Pro',
        organizationCode: 'HOA-NANG-GROUP',
        adminUsername: 'admin_pro',
        adminPassword: 'PasswordPro123!',
        enabledModules: ['students', 'classrooms', 'attendance', 'nutrition'],
        quotas: { maxCampuses: 2, maxStudents: 150, maxStaff: 40 }
      });
    expect(createRes.status).toBe(201);
    const schoolId = createRes.body.data.school._id;

    // 2. Dashboard tổng hợp trả về đủ systemHealth, moduleCatalog, settings và thống kê trường
    const dashRes = await request(saasApp)
      .get('/api/multi-school/schools')
      .set('Authorization', `Bearer ${superToken}`);
    expect(dashRes.status).toBe(200);
    expect(dashRes.body.data.systemHealth).toBeDefined();
    expect(dashRes.body.data.systemHealth.memory.systemTotalMb).toBeGreaterThan(0);
    expect(dashRes.body.data.moduleCatalog.length).toBeGreaterThanOrEqual(14);
    expect(dashRes.body.data.schools[0].quotas.maxCampuses).toBe(2);

    // 3. Xem Báo cáo 360° chi tiết trường học cho SuperAdmin
    const reportRes = await request(saasApp)
      .get(`/api/multi-school/schools/${schoolId}/report`)
      .set('Authorization', `Bearer ${superToken}`);
    expect(reportRes.status).toBe(200);
    expect(reportRes.body.data.school.code).toBe('HOANANG-PRO');
    expect(Array.isArray(reportRes.body.data.campuses)).toBe(true);
    expect(reportRes.body.data.finance.summary).toBeDefined();

    // 4. Đăng nhập Admin riêng của trường (chỉ cần username + password)
    const schoolAdminLogin = await request(saasApp)
      .post('/api/auth/login')
      .send({ username: 'admin_pro', password: 'PasswordPro123!' });
    expect(schoolAdminLogin.status).toBe(200);
    const schoolAdminToken = schoolAdminLogin.body.token;

    // 4A. Admin trường KHÔNG được sửa định danh cấp Trường (403 SCHOOL_IDENTITY_LOCKED)
    const editSchoolBlocked = await request(saasApp)
      .put('/api/system/school-info')
      .set('Authorization', `Bearer ${schoolAdminToken}`)
      .send({ name: 'Tên Tự Đổi Trái Phép' });
    expect(editSchoolBlocked.status).toBe(403);
    expect(editSchoolBlocked.body.code).toBe('SCHOOL_IDENTITY_LOCKED');

    // 4B. Admin trường quản lý đầy đủ cấu hình Phân hiệu trong phạm vi hạn mức (2 phân hiệu)
    const addCampus2 = await request(saasApp)
      .post('/api/system/campuses')
      .set('Authorization', `Bearer ${schoolAdminToken}`)
      .send({
        name: 'Phân hiệu 2 - Cầu Giấy',
        address: 'Số 10 Cầu Giấy',
        phone: '0988111222',
        managerName: 'Cô Mai',
        openTime: '06:45',
        closeTime: '17:15',
        maxClassrooms: 12,
        notes: 'Có sân vận động riêng'
      });
    expect(addCampus2.status).toBe(201);
    expect(addCampus2.body.data.openTime).toBe('06:45');

    // Thêm phân hiệu thứ 3 vượt hạn mức maxCampuses = 2 -> Bị chặn 403 QUOTA_EXCEEDED
    const addCampus3Blocked = await request(saasApp)
      .post('/api/system/campuses')
      .set('Authorization', `Bearer ${schoolAdminToken}`)
      .send({ name: 'Phân hiệu 3 Vượt Hạn Mức' });
    expect(addCampus3Blocked.status).toBe(403);
    expect(addCampus3Blocked.body.code).toBe('QUOTA_EXCEEDED');

    // 4C. Phân hệ 'finance' chưa được SuperAdmin bật -> Bị chặn 403 MODULE_DISABLED_BY_SUPERADMIN
    const financeBlocked = await request(saasApp)
      .get('/api/finance/tuition')
      .set('Authorization', `Bearer ${schoolAdminToken}`);
    expect(financeBlocked.status).toBe(403);
    expect(financeBlocked.body.code).toBe('MODULE_DISABLED_BY_SUPERADMIN');

    // 5. SuperAdmin lưu Cấu hình Chung Hệ thống (System Banner + Chế độ bảo trì) & đọc Nhật ký Audit
    const saveSettingsRes = await request(saasApp)
      .put('/api/multi-school/settings')
      .set('Authorization', `Bearer ${superToken}`)
      .send({
        systemBanner: {
          enabled: true,
          level: 'warning',
          message: 'Thông báo kiểm tra định kỳ toàn hệ thống.'
        },
        maintenanceMode: {
          enabled: true,
          message: 'Đang bảo trì nâng cấp 15 phút.'
        }
      });
    expect(saveSettingsRes.status).toBe(200);

    const publicMeta = await request(saasApp).get('/api/multi-school/public-meta');
    expect(publicMeta.status).toBe(200);
    expect(publicMeta.body.data.systemBanner.enabled).toBe(true);

    // Khi bật bảo trì: trường học bị tạm ngưng 503 MAINTENANCE_MODE, nhưng SuperAdmin vẫn hoạt động bình thường
    const maintSchoolCheck = await request(saasApp)
      .get('/api/students')
      .set('Authorization', `Bearer ${schoolAdminToken}`);
    expect(maintSchoolCheck.status).toBe(503);
    expect(maintSchoolCheck.body.code).toBe('MAINTENANCE_MODE');

    const auditRes = await request(saasApp)
      .get('/api/multi-school/audit-logs')
      .set('Authorization', `Bearer ${superToken}`);
    expect(auditRes.status).toBe(200);
    expect(auditRes.body.data.length).toBeGreaterThanOrEqual(2);
  });
});
