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
    await Promise.all([
      User.deleteMany({}),
      Tenant.deleteMany({}),
      Permission.deleteMany({}),
      PlatformAdmin.deleteMany({})
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
});
