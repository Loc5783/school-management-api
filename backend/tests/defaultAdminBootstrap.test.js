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
const { ensureDefaultAdminAccount } = require('../src/services/defaultAdminBootstrapService');

describe('Default Admin Bootstrap Service (Auto-create admin/123456)', () => {
  let mongod;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test_bootstrap_jwt_secret_at_least_32_characters_long';
    process.env.JWT_ISSUER = 'school-management-api';
    process.env.JWT_AUDIENCE = 'school-management-web';
    process.env.JWT_EXPIRES_IN = '1h';
    delete process.env.AUTO_CREATE_DEFAULT_ADMIN;

    mongoose.set('autoIndex', false);
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: 'bootstrap_admin_test' });
  }, 30000);

  afterEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Tenant.deleteMany({}),
      Permission.deleteMany({})
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) {
      await mongod.stop();
    }
  });

  test('Tự động tạo trường HOANANG-A và tài khoản admin/123456 khi DB trống, đăng nhập SaaS thành công', async () => {
    const result = await ensureDefaultAdminAccount({ useLegacyApp: false });
    expect(result.created).toBe(true);
    expect(result.schoolCode).toBe('HOANANG-A');
    expect(result.username).toBe('admin');

    const permCount = await Permission.countDocuments({});
    expect(permCount).toBeGreaterThanOrEqual(29);

    const saasApp = assembleSaasApp({ saasMode: 'phase1e' });
    const loginRes = await request(saasApp)
      .post('/api/auth/login')
      .send({
        schoolCode: 'HOANANG-A',
        username: 'admin',
        password: '123456'
      });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);
    expect(loginRes.body.token).toBeTruthy();
    expect(loginRes.body.user.role).toBe('admin');

    const meRes = await request(saasApp)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.token}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.username).toBe('admin');
  });

  test('Không ghi đè mật khẩu nếu DB đã có tài khoản admin từ trước (bảo toàn khi restart server)', async () => {
    await ensureDefaultAdminAccount({ useLegacyApp: false });

    const adminInDb = await User.findOne({ username: 'admin', role: 'admin' });
    adminInDb.passwordHash = await bcrypt.hash('MatKhauMoiAnToan2026!', 10);
    await adminInDb.save();

    // Khởi động lại server lần 2 -> không được ghi đè lại 123456
    const secondRun = await ensureDefaultAdminAccount({ useLegacyApp: false });
    expect(secondRun.created).toBe(false);

    const saasApp = assembleSaasApp({ saasMode: 'phase1e' });
    const oldPassRes = await request(saasApp)
      .post('/api/auth/login')
      .send({ schoolCode: 'HOANANG-A', username: 'admin', password: '123456' });
    expect(oldPassRes.status).toBe(401);

    const newPassRes = await request(saasApp)
      .post('/api/auth/login')
      .send({ schoolCode: 'HOANANG-A', username: 'admin', password: 'MatKhauMoiAnToan2026!' });
    expect(newPassRes.status).toBe(200);
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
});

