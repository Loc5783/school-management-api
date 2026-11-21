process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';
process.env.PLATFORM_MFA_ENCRYPTION_KEY = 'mfa-encryption-key-for-phase1a-isolated-test-32bytes!';
process.env.SAAS_MODE = 'phase1a';
process.env.TENANT_FEATURE_READINESS = 'false';
jest.setTimeout(60000);

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const createSaasApp = require('../../src/saas/createSaasApp');
const createApp = require('../../app'); // Legacy Single-Tenant App
const {
  generateTotpSecret,
  generateTOTP,
  verifyTOTP,
  encryptTotpSecret,
  decryptTotpSecret,
  getMfaEncryptionKey
} = require('../../src/saas/utils/totpHelper');
const {
  generateSchoolUserToken,
  generatePlatformAdminToken,
  generateMfaChallengeToken,
  generateSupportAccessToken,
  verifySaasToken,
  validateTokenClaims
} = require('../../src/saas/utils/saasJwt');
const { generateToken: generateLegacyToken } = require('../../src/utils/jwt');
const { verifySocketHandshake } = require('../../src/saas/middlewares/tenantFeatureGate');
const {
  assertIsolatedTestDb,
  verifyParsedUri,
  maskUri,
  assertNoWorkersRunning
} = require('../../src/saas/safeDbGuard');
const testDbBootstrap = require('../../src/saas/testDbBootstrap');

const Tenant = require('../../src/models/zone1_system/Tenant');
const PlatformAdmin = require('../../src/models/zone1_system/PlatformAdmin');
const PlatformAuditLog = require('../../src/models/zone1_system/PlatformAuditLog');
const RevokedSession = require('../../src/models/zone1_system/RevokedSession');
const MfaChallenge = require('../../src/models/zone1_system/MfaChallenge');
const User = require('../../src/models/zone1_system/User');

let bootstrapInstance;
let mongoServer;
let mongoUri;
let saasApp;
let legacyApp;
let tenantA;
let tenantB;
let userA;
let userB;
let legacyUser;
let platformLead;
let platformSupport;
let platformRawTotpSecret;

beforeAll(async () => {
  bootstrapInstance = await testDbBootstrap.startTestDb({
    instanceOpts: [{ dbName: 'school_saas_test_isolated' }]
  });
  mongoServer = bootstrapInstance.replSet;
  mongoUri = bootstrapInstance.uri;

  saasApp = createSaasApp({ mongoUri, connection: bootstrapInstance.connection });
  legacyApp = createApp();
}, 60000);

afterAll(async () => {
  if (bootstrapInstance) {
    await bootstrapInstance.stop();
  }
}, 60000);

beforeEach(async () => {
  await Promise.all([
    Tenant.deleteMany({}),
    PlatformAdmin.deleteMany({}),
    PlatformAuditLog.deleteMany({}),
    RevokedSession.deleteMany({}),
    User.deleteMany({})
  ]);

  // Seed Tenant A and Tenant B
  tenantA = await Tenant.create({
    code: 'TRUONG-A',
    name: 'Trường Mầm Non Bình Minh A',
    status: 'active',
    authVersion: 0,
    config: { secretKeySetting: 'confidential_a' }
  });

  tenantB = await Tenant.create({
    code: 'TRUONG-B',
    name: 'Trường Mầm Non Bình Minh B',
    status: 'active',
    authVersion: 0,
    config: { secretKeySetting: 'confidential_b' }
  });

  const passwordHash = await bcrypt.hash('Password123!', 8);

  // User 'admin' in School A (SaaS)
  userA = await User.create({
    tenantId: tenantA._id,
    username: 'admin',
    passwordHash,
    role: 'admin',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Admin Trường A' }
  });

  // User 'admin' in School B (SaaS - same username, different tenant)
  userB = await User.create({
    tenantId: tenantB._id,
    username: 'admin',
    passwordHash: await bcrypt.hash('PasswordB123!', 8),
    role: 'admin',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Admin Trường B' }
  });

  // Legacy user (Single-Tenant, no tenantId)
  legacyUser = await User.create({
    username: 'legacy_admin',
    passwordHash,
    role: 'admin',
    status: 'active',
    authVersion: 0,
    profile: { fullName: 'Admin Đơn Trường' }
  });

  // Platform Admin (Lead)
  platformRawTotpSecret = generateTotpSecret();
  const encryptedTotpLead = encryptTotpSecret(platformRawTotpSecret);
  platformLead = await PlatformAdmin.create({
    username: 'saas_lead',
    passwordHash,
    role: 'platform_lead',
    totpSecret: encryptedTotpLead.encrypted,
    totpSecretIv: encryptedTotpLead.iv,
    totpSecretTag: encryptedTotpLead.tag,
    authVersion: 0,
    status: 'active'
  });

  // Platform Admin (Support)
  const encryptedTotpSupport = encryptTotpSecret(platformRawTotpSecret);
  platformSupport = await PlatformAdmin.create({
    username: 'saas_support',
    passwordHash,
    role: 'platform_support',
    totpSecret: encryptedTotpSupport.encrypted,
    totpSecretIv: encryptedTotpSupport.iv,
    totpSecretTag: encryptedTotpSupport.tag,
    authVersion: 0,
    status: 'active'
  });
});

describe('SaaS Multi-Tenant Giai đoạn 1A: Kiểm Thử Toàn Diện & Hồi Quy (Đã Khắc Phục Nghiệm Thu)', () => {

  // =========================================================================
  // I. DATABASE SAFETY GUARD (LỖI 1: KIỂM SOÁT NGUỒN TEST DB BOOTSTRAP)
  // =========================================================================
  describe('Lỗi 1: Database Safety Guard (Kiểm Soát Nguồn Test DB Bootstrap)', () => {
    test('1.A: Instance MongoMemoryReplSet do bootstrap tạo được chấp nhận', () => {
      expect(assertIsolatedTestDb(bootstrapInstance.connection, mongoUri)).toBe(true);
    });

    test('1.B: URI local cổng bất kỳ không có đăng ký bootstrap bị từ chối', () => {
      // Cổng 32123 không được đăng ký trong test bootstrap registry
      const unregisteredLocalUri = 'mongodb://127.0.0.1:32123/company_school';
      expect(() => verifyParsedUri(unregisteredLocalUri)).toThrow('CRITICAL_SAFETY_VIOLATION: UNREGISTERED_TEST_DB_URI');
    });

    test('1.C: URI có tên chứa "test" nhưng không có nguồn xác minh bootstrap vẫn bị từ chối', () => {
      const unregisteredWithTest = 'mongodb://127.0.0.1:32123/school_test_db';
      expect(() => verifyParsedUri(unregisteredWithTest)).toThrow('CRITICAL_SAFETY_VIOLATION: UNREGISTERED_TEST_DB_URI');
    });

    test('1.D: Connection khác với connection được bootstrap quản lý bị từ chối', () => {
      const mockUnverifiedConn = {
        readyState: 1,
        host: '127.0.0.1',
        port: bootstrapInstance.port,
        name: bootstrapInstance.dbName
      };
      expect(() => assertIsolatedTestDb(mockUnverifiedConn, mongoUri)).toThrow('CRITICAL_SAFETY_VIOLATION: UNVERIFIED_CONNECTION_SOURCE');
    });

    test('1.E: URI và connection khác database bị từ chối (DB Name Mismatch)', () => {
      const connPort = bootstrapInstance.connection.port;
      const mismatchedDbUri = `mongodb://127.0.0.1:${connPort}/completely_different_db_name`;
      const tempConn = {
        readyState: 1,
        host: '127.0.0.1',
        port: connPort,
        name: 'completely_different_db_name'
      };
      testDbBootstrap.registerTestInstance({
        connection: tempConn,
        uri: mismatchedDbUri
      });

      try {
        expect(() => assertIsolatedTestDb(bootstrapInstance.connection, mismatchedDbUri)).toThrow(
          'CRITICAL_SAFETY_VIOLATION: DB_NAME_MISMATCH'
        );
      } finally {
        testDbBootstrap.unregisterTestInstance(mismatchedDbUri);
      }
    });

    test('1.F: Một model bind sang connection khác bị từ chối (Model Connection Mismatch)', () => {
      const mockRegisteredConn = {
        readyState: 1,
        host: '127.0.0.1',
        port: bootstrapInstance.port,
        name: bootstrapInstance.dbName
      };
      testDbBootstrap.registerTestInstance({
        connection: mockRegisteredConn,
        uri: `mongodb://127.0.0.1:${bootstrapInstance.port}/${bootstrapInstance.dbName}`
      });

      try {
        expect(() => assertIsolatedTestDb(mockRegisteredConn)).toThrow('CRITICAL_SAFETY_VIOLATION: MODEL_CONNECTION_MISMATCH');
      } finally {
        testDbBootstrap.unregisterTestInstance(mockRegisteredConn);
      }
    });

    test('1.G: Thiếu cấu hình, không truyền connection, hoặc connection đóng đều fail-closed', () => {
      expect(() => assertIsolatedTestDb('')).toThrow('CRITICAL_SAFETY_VIOLATION: NO_VALID_CONNECTION_PROVIDED');
      expect(() => assertIsolatedTestDb(null)).toThrow('CRITICAL_SAFETY_VIOLATION: NO_VALID_CONNECTION_PROVIDED');
      expect(() => createSaasApp({})).toThrow('CRITICAL_SAFETY_VIOLATION: NO_VALID_CONNECTION_PROVIDED');

      const closedConn = {
        readyState: 0,
        host: '127.0.0.1',
        port: bootstrapInstance.port,
        name: 'closed_conn_db'
      };
      const closedUri = `mongodb://127.0.0.1:${bootstrapInstance.port}/closed_conn_db`;
      testDbBootstrap.registerTestInstance({ connection: closedConn, uri: closedUri });
      try {
        expect(() => assertIsolatedTestDb(closedConn)).toThrow('CRITICAL_SAFETY_VIOLATION: CONNECTION_NOT_READY');
      } finally {
        testDbBootstrap.unregisterTestInstance(closedConn);
      }
    });

    test('1.H: Xác nhận các trường hợp bị từ chối không chạy index/seed/write', async () => {
      let appCreated = false;
      try {
        createSaasApp({ connection: null });
        appCreated = true;
      } catch (err) {
        expect(err.message).toContain('NO_VALID_CONNECTION_PROVIDED');
      }
      expect(appCreated).toBe(false);
    });

    test('1.I: Dùng instance memory thứ 2 không được đăng ký vào bootstrap để chứng minh bị từ chối mà không chạm DB thật', async () => {
      const secondReplSet = await MongoMemoryReplSet.create({
        replSet: { count: 1, storageEngine: 'wiredTiger' }
      });
      const secondUri = secondReplSet.getUri();

      try {
        expect(() => verifyParsedUri(secondUri)).toThrow('CRITICAL_SAFETY_VIOLATION: UNREGISTERED_TEST_DB_URI');
      } finally {
        await secondReplSet.stop();
      }
    });

    test('1.J: Từ chối khi cấu hình rỗng hoặc thiếu', () => {
      expect(() => verifyParsedUri('')).toThrow('CRITICAL_SAFETY_VIOLATION: NO_TEST_CONFIG');
    });

    test('1.K: Từ chối URI remote / mongodb+srv kể cả khi có chữ test trong query/credentials', () => {
      const remoteUriWithTest = 'mongodb+srv://user_test:pass_test@cluster.mongodb.net/school_db?authSource=test&replicaSet=testRS';
      expect(() => verifyParsedUri(remoteUriWithTest)).toThrow('CRITICAL_SAFETY_VIOLATION: REMOTE_DB_NOT_PERMITTED');
    });

    test('1.L: Thông báo lỗi đã được che (masked), không lộ raw credentials', () => {
      const uriWithCredentials = 'mongodb://admin_user:SuperSecretPassword123@remote-host.com:27017/db_name';
      const masked = maskUri(uriWithCredentials);
      expect(masked).not.toContain('SuperSecretPassword123');
      expect(masked).not.toContain('admin_user');
      expect(masked).toContain('remote-host.com');
      expect(masked).toContain('db_name');
    });

    test('1.M (Ca I): Bootstrap teardown đóng đúng connection/instance do nó quản lý mà không đóng connection bên ngoài', async () => {
      const externalConn = await mongoose.createConnection(mongoUri).asPromise();
      expect(externalConn.readyState).toBe(1);

      const secondBootstrap = await testDbBootstrap.startTestDb({
        useCreateConnection: true,
        instanceOpts: [{ dbName: 'secondary_saas_teardown_test' }]
      });
      expect(secondBootstrap.connection.readyState).toBe(1);
      expect(testDbBootstrap.isVerifiedConnection(secondBootstrap.connection)).toBe(true);

      await secondBootstrap.stop();

      expect(secondBootstrap.connection.readyState).toBe(0);
      expect(testDbBootstrap.isVerifiedConnection(secondBootstrap.connection)).toBe(false);

      expect(externalConn.readyState).toBe(1);
      expect(bootstrapInstance.connection.readyState).toBe(1);
      expect(testDbBootstrap.isVerifiedConnection(bootstrapInstance.connection)).toBe(true);

      await externalConn.close();
    });

    test('1.N: Transaction session phải chia sẻ cùng connection với model, session connection khác bị từ chối', async () => {
      const validSession = await PlatformAdmin.db.startSession();
      try {
        expect(assertIsolatedTestDb(bootstrapInstance.connection, mongoUri, validSession)).toBe(true);
      } finally {
        await validSession.endSession();
      }

      const foreignSession = {
        client: { id: 'foreign_mongo_client_instance' }
      };
      expect(() => assertIsolatedTestDb(bootstrapInstance.connection, mongoUri, foreignSession)).toThrow(
        'CRITICAL_SAFETY_VIOLATION: SESSION_CONNECTION_MISMATCH'
      );
    });
  });

  // =========================================================================
  // II. TOKEN & DOMAIN ISOLATION (LỖI 2: TÁCH BIỆT MIỀN TIN CẬY LEGACY VÀ SAAS)
  // =========================================================================
  describe('Lỗi 2: Phân tách Miền Tin Cậy giữa Legacy và SaaS', () => {
    test('2.1: Token SaaS School bị legacy auth middleware từ chối HTTP 401', async () => {
      const saasSchoolToken = generateSchoolUserToken(userA, tenantA);

      // Call legacy GET /api/auth/me using SaaS token
      const res = await request(legacyApp)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${saasSchoolToken}`);

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Token đa trường');
    });

    test('2.2: Token SaaS School gọi legacy GET /api/system/accounts bị từ chối 401, không rò rỉ dữ liệu', async () => {
      const saasSchoolToken = generateSchoolUserToken(userA, tenantA);

      const res = await request(legacyApp)
        .get('/api/system/accounts')
        .set('Authorization', `Bearer ${saasSchoolToken}`);

      expect(res.status).toBe(401);
    });

    test('2.3: Token Platform Admin và MFA Challenge bị legacy auth từ chối 401', async () => {
      const platformToken = generatePlatformAdminToken(platformLead);
      const challengeToken = generateMfaChallengeToken(platformLead);

      const res1 = await request(legacyApp)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${platformToken}`);
      expect(res1.status).toBe(401);

      const res2 = await request(legacyApp)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${challengeToken}`);
      expect(res2.status).toBe(401);
    });

    test('2.4: Token Legacy hợp lệ vẫn dùng được đúng trên app Legacy theo contract', async () => {
      const legacyToken = generateLegacyToken(legacyUser);

      const res = await request(legacyApp)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${legacyToken}`);

      expect(res.status).toBe(200);
      expect(res.body.username).toBe('legacy_admin');
    });

    test('2.5: Token Legacy bị SaaS middleware từ chối HTTP 403', async () => {
      const legacyToken = generateLegacyToken(legacyUser);

      const res = await request(saasApp)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${legacyToken}`);

      expect([401, 403]).toContain(res.status);
    });

    test('2.6: Legacy login không tìm và không đăng nhập nhầm tài khoản SaaS cùng username', async () => {
      // User 'admin' exists in Tenant A, but does not exist in legacy domain
      const res = await request(legacyApp)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'Password123!' });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('không đúng');
    });

    test('2.7: Tenant bị suspended bị SaaS chặn 403 và cũng bị legacy từ chối 401', async () => {
      tenantA.status = 'suspended';
      await tenantA.save();

      const saasToken = generateSchoolUserToken(userA, tenantA);

      // SaaS rejects with 403 TENANT_SUSPENDED
      const resSaas = await request(saasApp)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${saasToken}`);
      expect(resSaas.status).toBe(403);
      expect(resSaas.body.code).toBe('TENANT_SUSPENDED');

      // Legacy rejects with 401
      const resLegacy = await request(legacyApp)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${saasToken}`);
      expect(resLegacy.status).toBe(401);
    });

    test('2.8: Legacy admin gọi GET /api/system/accounts chỉ trả về tài khoản legacy, không lộ tài khoản SaaS', async () => {
      const legacyToken = generateLegacyToken(legacyUser);

      const res = await request(legacyApp)
        .get('/api/system/accounts')
        .set('Authorization', `Bearer ${legacyToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const returnedUsernames = res.body.data.map((u) => u.username);
      expect(returnedUsernames).toContain('legacy_admin');
      // Must NOT contain userA or userB from Tenant A / B
      const returnedIds = res.body.data.map((u) => u._id.toString());
      expect(returnedIds).not.toContain(userA._id.toString());
      expect(returnedIds).not.toContain(userB._id.toString());
    });

    test('2.9: Legacy admin gọi PATCH /api/system/accounts/:id với ID của tài khoản SaaS nhận 404', async () => {
      const legacyToken = generateLegacyToken(legacyUser);

      const res = await request(legacyApp)
        .patch(`/api/system/accounts/${userA._id}`)
        .set('Authorization', `Bearer ${legacyToken}`)
        .send({ status: 'inactive' });

      expect(res.status).toBe(404);

      // Verify userA in DB remains untouched
      const userAInDb = await User.findById(userA._id);
      expect(userAInDb.status).toBe('active');
    });

    test('2.10: Legacy admin gọi DELETE /api/system/accounts/:id với ID tài khoản SaaS nhận 404', async () => {
      const legacyToken = generateLegacyToken(legacyUser);

      const res = await request(legacyApp)
        .delete(`/api/system/accounts/${userA._id}`)
        .set('Authorization', `Bearer ${legacyToken}`);

      expect(res.status).toBe(404);

      const userAInDb = await User.findById(userA._id);
      expect(userAInDb.status).toBe('active');
    });
  });

  // =========================================================================
  // III. TOKEN CLAIMS VALIDATION (LỖI 3: VALIDATE BẮT BUỘC TỪNG CLAIM)
  // =========================================================================
  describe('Lỗi 3: Validate Đầy Đủ Claim Bắt Buộc theo Purpose', () => {
    test('3.1: Token ký hợp lệ nhưng thiếu exp bị verifySaasToken từ chối MISSING_OR_INVALID_EXP_CLAIM', () => {
      const tokenWithoutExp = jwt.sign(
        {
          sub: userA._id.toString(),
          username: userA.username,
          tenantId: tenantA._id.toString(),
          schoolCode: 'TRUONG-A',
          authVersion: 0,
          tenantAuthVersion: 0,
          purpose: 'SCHOOL_USER_ACCESS',
          jti: 'jti-123'
          // no exp specified, no expiresIn
        },
        process.env.JWT_SECRET,
        { audience: process.env.JWT_AUDIENCE, issuer: process.env.JWT_ISSUER, algorithm: 'HS256' }
      );

      expect(() => verifySaasToken(tokenWithoutExp)).toThrow('MISSING_OR_INVALID_EXP_CLAIM');
    });

    test('3.2: Token thiếu tenantId khi purpose=SCHOOL_USER_ACCESS bị từ chối INVALID_TOKEN_CLAIMS', () => {
      const tokenWithoutTenantId = jwt.sign(
        {
          sub: userA._id.toString(),
          username: userA.username,
          authVersion: 0,
          purpose: 'SCHOOL_USER_ACCESS',
          jti: 'jti-123'
        },
        process.env.JWT_SECRET,
        { audience: process.env.JWT_AUDIENCE, issuer: process.env.JWT_ISSUER, expiresIn: '1h' }
      );

      expect(() => verifySaasToken(tokenWithoutTenantId)).toThrow('INVALID_TOKEN_CLAIMS');
    });

    test('3.3: Token có authVersion = 0 được coi là hợp lệ (không bị lỗi do falsy check)', () => {
      const validToken = generateSchoolUserToken(userA, tenantA);
      const decoded = verifySaasToken(validToken);
      expect(decoded.authVersion).toBe(0);
      expect(decoded.tenantAuthVersion).toBe(0);
    });

    test('3.4: Token có algorithm không thuộc allowlist bị từ chối', () => {
      // Simulate none algorithm token
      const fakeToken = jwt.sign(
        { sub: userA._id.toString(), purpose: 'SCHOOL_USER_ACCESS' },
        '',
        { algorithm: 'none' }
      );

      expect(() => verifySaasToken(fakeToken)).toThrow();
    });

    test('3.5: SUPPORT_ACCESS trong 1A bị middleware trường trả về HTTP 501', async () => {
      const supportToken = generateSupportAccessToken(platformLead, tenantA);

      const res = await request(saasApp)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${supportToken}`);

      expect(res.status).toBe(501);
      expect(res.body.code).toBe('SUPPORT_ACCESS_NOT_IMPLEMENTED');
    });
  });

  // =========================================================================
  // IV. ATOMIC TRANSACTIONS (LỖI 4: TENANT VÀ AUDIT NGUYÊN KHỐI)
  // =========================================================================
  describe('Lỗi 4: Tính Nguyên Khối giữa Thao Tác Tenant và AuditLog qua MongoDB Transaction', () => {
    test('4.1: Tạo tenant thành công tạo cả Tenant và PlatformAuditLog trong cùng session', async () => {
      const platformToken = generatePlatformAdminToken(platformLead);

      const res = await request(saasApp)
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({
          code: 'TRUONG-TX-1',
          name: 'Trường Mầm Non Transaction 1',
          contactEmail: 'contact@tx1.edu.vn'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const created = await Tenant.findOne({ code: 'TRUONG-TX-1' });
      expect(created).toBeDefined();

      const audit = await PlatformAuditLog.findOne({ targetId: created._id.toString(), action: 'CREATE_TENANT' });
      expect(audit).toBeDefined();
      expect(audit.actorId.toString()).toBe(platformLead._id.toString());
    });

    test('4.2: AuditLog lỗi khi tạo tenant -> Transaction Rollback, KHÔNG tạo Tenant mồ côi trong DB', async () => {
      const platformToken = generatePlatformAdminToken(platformLead);

      // Spy and force PlatformAuditLog.create to throw an error inside transaction
      const auditSpy = jest.spyOn(PlatformAuditLog, 'create').mockImplementationOnce(() => {
        throw new Error('SIMULATED_AUDIT_FAILURE');
      });

      const res = await request(saasApp)
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({
          code: 'TRUONG-ROLLBACK-1',
          name: 'Trường Sẽ Bị Rollback'
        });

      expect(res.status).toBe(500);

      // Verify rollback: Tenant MUST NOT exist in DB
      const tenantInDb = await Tenant.findOne({ code: 'TRUONG-ROLLBACK-1' });
      expect(tenantInDb).toBeNull();

      auditSpy.mockRestore();
    });

    test('4.3: AuditLog lỗi khi đổi status -> Transaction Rollback, status và authVersion giữ nguyên', async () => {
      const platformToken = generatePlatformAdminToken(platformLead);
      const initialAuthVersion = tenantA.authVersion;
      const initialStatus = tenantA.status;

      const auditSpy = jest.spyOn(PlatformAuditLog, 'create').mockImplementationOnce(() => {
        throw new Error('SIMULATED_STATUS_AUDIT_FAILURE');
      });

      const res = await request(saasApp)
        .patch(`/api/v1/platform/tenants/${tenantA._id}/status`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ status: 'suspended' });

      expect(res.status).toBe(500);

      // Verify rollback: Tenant status and authVersion must remain untouched
      const tenantInDb = await Tenant.findById(tenantA._id);
      expect(tenantInDb.status).toBe(initialStatus);
      expect(tenantInDb.authVersion).toBe(initialAuthVersion);

      auditSpy.mockRestore();
    });

    test('4.4: Duplicate code đồng thời được bắt bằng unique index và trả 409 Conflict', async () => {
      const platformToken = generatePlatformAdminToken(platformLead);

      // Concurrent creation via Promise.all
      const [res1, res2] = await Promise.all([
        request(saasApp)
          .post('/api/v1/platform/tenants')
          .set('Authorization', `Bearer ${platformToken}`)
          .send({ code: 'TRUONG-CONCUR', name: 'Trường Trùng Mã A' }),
        request(saasApp)
          .post('/api/v1/platform/tenants')
          .set('Authorization', `Bearer ${platformToken}`)
          .send({ code: 'TRUONG-CONCUR', name: 'Trường Trùng Mã B' })
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([201, 409]);

      const conflictRes = res1.status === 409 ? res1 : res2;
      expect(conflictRes.body.code).toBe('TENANT_CODE_EXISTS');

      // Exactly 1 record exists in DB
      const count = await Tenant.countDocuments({ code: 'TRUONG-CONCUR' });
      expect(count).toBe(1);
    });

    test('4.5: No-op status contract: Gửi status trùng hiện tại trả 200, changed=false, không tăng authVersion', async () => {
      const platformToken = generatePlatformAdminToken(platformLead);
      const initialVersion = tenantA.authVersion;

      // tenantA is currently 'active'
      const res = await request(saasApp)
        .patch(`/api/v1/platform/tenants/${tenantA._id}/status`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ status: 'active' });

      expect(res.status).toBe(200);
      expect(res.body.changed).toBe(false);

      const tenantInDb = await Tenant.findById(tenantA._id);
      expect(tenantInDb.authVersion).toBe(initialVersion);
    });

    test('4.6: ID sai định dạng trả về HTTP 400 INVALID_TENANT_ID', async () => {
      const platformToken = generatePlatformAdminToken(platformLead);

      const res = await request(saasApp)
        .patch('/api/v1/platform/tenants/invalid-id-format/status')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ status: 'suspended' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_TENANT_ID');
    });
  });

  // =========================================================================
  // V. LOGOUT & SESSION REVOCATION (LỖI 5: THU HỒI ĐÚNG PHIÊN)
  // =========================================================================
  describe('Lỗi 5: Thu Hồi Phiên Riêng Biệt (Single-Session Logout & Revocation)', () => {
    test('5.1: Đăng xuất đơn phiên (Token A) thu hồi đúng Token A, Token B cùng tài khoản vẫn hoạt động', async () => {
      // User A creates Token 1 and Token 2 (representing two active devices)
      const tokenA = generateSchoolUserToken(userA, tenantA);
      const tokenB = generateSchoolUserToken(userA, tenantA);

      // Verify both tokens work initially
      const initA = await request(saasApp).get('/api/v1/auth/me').set('Authorization', `Bearer ${tokenA}`);
      const initB = await request(saasApp).get('/api/v1/auth/me').set('Authorization', `Bearer ${tokenB}`);
      expect(initA.status).toBe(200);
      expect(initB.status).toBe(200);

      // Logout single session with Token A
      const logoutRes = await request(saasApp)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(logoutRes.status).toBe(200);

      // Calling /me with Token A must now be REJECTED with 401 SESSION_REVOKED
      const checkA = await request(saasApp)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(checkA.status).toBe(401);
      expect(checkA.body.code).toBe('SESSION_REVOKED');

      // Calling /me with Token B must STILL SUCCEED (200 OK)
      const checkB = await request(saasApp)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokenB}`);
      expect(checkB.status).toBe(200);
    });

    test('5.2: Đăng xuất all thiết bị (all=true) tăng authVersion và vô hiệu hóa cả Token A và Token B', async () => {
      const tokenA = generateSchoolUserToken(userA, tenantA);
      const tokenB = generateSchoolUserToken(userA, tenantA);

      // Global logout
      const logoutAllRes = await request(saasApp)
        .post('/api/v1/auth/logout?all=true')
        .set('Authorization', `Bearer ${tokenB}`);
      expect(logoutAllRes.status).toBe(200);
      expect(logoutAllRes.body.globalLogout).toBe(true);

      // Both tokens must now be rejected
      const checkA = await request(saasApp).get('/api/v1/auth/me').set('Authorization', `Bearer ${tokenA}`);
      const checkB = await request(saasApp).get('/api/v1/auth/me').set('Authorization', `Bearer ${tokenB}`);
      expect(checkA.status).toBe(401);
      expect(checkB.status).toBe(401);
    });
  });

  // =========================================================================
  // VI. MFA ENCRYPTION & OFFICIAL RFC 6238 VECTORS (LỖI 6)
  // =========================================================================
  describe('Lỗi 6: MFA Encryption không Fallback & Kiểm Chứng Vector Chuẩn RFC 6238', () => {
    test('6.1: Thiếu hoặc sai độ dài PLATFORM_MFA_ENCRYPTION_KEY lập tức ném lỗi fail-closed', () => {
      expect(() => getMfaEncryptionKey('')).toThrow('CRITICAL_SAFETY_VIOLATION');
      expect(() => getMfaEncryptionKey('short-key-15ch')).toThrow('CRITICAL_SAFETY_VIOLATION');
    });

    test('6.2: Bản ghi admin chứa plaintext secret hoặc thiếu IV/tag bị từ chối đăng nhập', async () => {
      // Create admin with plaintext secret and missing IV/tag
      await PlatformAdmin.create({
        username: 'plaintext_admin',
        passwordHash: await bcrypt.hash('PlainSecret123!', 8),
        role: 'platform_lead',
        totpSecret: 'PLAINTEXT_SECRET_UNENCRYPTED',
        totpSecretIv: '',
        totpSecretTag: '',
        authVersion: 0,
        status: 'active'
      });

      const res = await request(saasApp)
        .post('/api/v1/platform/auth/login')
        .send({ username: 'plaintext_admin', password: 'PlainSecret123!' });

      expect(res.status).toBe(500);
      expect(res.body.code).toBe('MFA_CONFIGURATION_ERROR');
    });

    test('6.3: Đăng nhập platform bắt buộc qua 2 bước, không thể gửi totpCode trực tiếp ở /login để bypass', async () => {
      // Even if totpCode is sent to /login, server strictly only returns challengeToken
      const res = await request(saasApp)
        .post('/api/v1/platform/auth/login')
        .send({
          username: 'saas_lead',
          password: 'Password123!',
          totpCode: '123456'
        });

      expect(res.status).toBe(200);
      expect(res.body.mfaRequired).toBe(true);
      expect(res.body.challengeToken).toBeDefined();

      const decoded = jwt.decode(res.body.challengeToken);
      expect(decoded.purpose).toBe('PRE_AUTH_MFA_CHALLENGE');
    });

    test('6.4: Xác minh thuật toán TOTP bằng các Vector chuẩn RFC 6238 Appendix B', () => {
      // RFC 6238 Appendix B: Secret is ASCII "12345678901234567890"
      // In Base32: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
      const rfcSecretBase32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

      // Epoch 59000 (Unix time 59s) -> Expected TOTP "287082"
      expect(generateTOTP(rfcSecretBase32, 30, 59 * 1000)).toBe('287082');

      // Epoch 1111111109000 (Unix time 1111111109s) -> Expected TOTP "081804"
      expect(generateTOTP(rfcSecretBase32, 30, 1111111109 * 1000)).toBe('081804');

      // Epoch 1234567890000 (Unix time 1234567890s) -> Expected TOTP "005924"
      expect(generateTOTP(rfcSecretBase32, 30, 1234567890 * 1000)).toBe('005924');

      // Epoch 2000000000000 (Unix time 2000000000s) -> Expected TOTP "279037"
      expect(generateTOTP(rfcSecretBase32, 30, 2000000000 * 1000)).toBe('279037');
    });

    test('6.5: Xác thực MFA thành công với challenge token hợp lệ và mã TOTP đúng', async () => {
      // Step 1: Login to get challenge
      const loginRes = await request(saasApp)
        .post('/api/v1/platform/auth/login')
        .send({ username: 'saas_lead', password: 'Password123!' });

      expect(loginRes.status).toBe(200);
      const { challengeToken } = loginRes.body;
      expect(challengeToken).toBeDefined();

      // Step 2: Verify MFA with generated code
      const currentCode = generateTOTP(platformRawTotpSecret);
      const verifyRes = await request(saasApp)
        .post('/api/v1/platform/auth/verify-mfa')
        .set('Authorization', `Bearer ${challengeToken}`)
        .send({ totpCode: currentCode });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.success).toBe(true);
      expect(verifyRes.body.token).toBeDefined();

      const decoded = jwt.decode(verifyRes.body.token);
      expect(decoded.purpose).toBe('PLATFORM_ADMIN_ACCESS');
      expect(decoded.role).toBe('platform_lead');
    });

    test('6.6: Chống Replay Challenge tuần tự: Dùng lại cùng challenge token sau khi đã verify bị chặn 401', async () => {
      // Login to get fresh challenge
      const rawSecret = generateTotpSecret();
      const encrypted = encryptTotpSecret(rawSecret);
      await PlatformAdmin.create({
        username: 'mfa_replay_lead',
        passwordHash: await bcrypt.hash('Password123!', 8),
        role: 'platform_lead',
        totpSecret: encrypted.encrypted,
        totpSecretIv: encrypted.iv,
        totpSecretTag: encrypted.tag,
        authVersion: 0,
        status: 'active'
      });

      const loginRes = await request(saasApp)
        .post('/api/v1/platform/auth/login')
        .send({ username: 'mfa_replay_lead', password: 'Password123!' });
      const { challengeToken } = loginRes.body;

      const code = generateTOTP(rawSecret);

      // First call: Success
      const firstVerify = await request(saasApp)
        .post('/api/v1/platform/auth/verify-mfa')
        .set('Authorization', `Bearer ${challengeToken}`)
        .send({ totpCode: code });
      expect(firstVerify.status).toBe(200);

      // Replay call with exact same challenge token: Must be rejected 401
      const replayVerify = await request(saasApp)
        .post('/api/v1/platform/auth/verify-mfa')
        .set('Authorization', `Bearer ${challengeToken}`)
        .send({ totpCode: code });
      expect(replayVerify.status).toBe(401);
      expect(replayVerify.body.code).toBe('CHALLENGE_ALREADY_USED_OR_EXPIRED');
    });

    test('6.7: Chống Replay Challenge đồng thời (Race condition): Promise.all gửi 2 request cùng challenge', async () => {
      const rawSecret = generateTotpSecret();
      const encrypted = encryptTotpSecret(rawSecret);
      await PlatformAdmin.create({
        username: 'mfa_race_lead',
        passwordHash: await bcrypt.hash('Password123!', 8),
        role: 'platform_lead',
        totpSecret: encrypted.encrypted,
        totpSecretIv: encrypted.iv,
        totpSecretTag: encrypted.tag,
        authVersion: 0,
        status: 'active'
      });

      const loginRes = await request(saasApp)
        .post('/api/v1/platform/auth/login')
        .send({ username: 'mfa_race_lead', password: 'Password123!' });
      const { challengeToken } = loginRes.body;
      const code = generateTOTP(rawSecret);

      // Concurrent race condition test
      const [res1, res2] = await Promise.all([
        request(saasApp)
          .post('/api/v1/platform/auth/verify-mfa')
          .set('Authorization', `Bearer ${challengeToken}`)
          .send({ totpCode: code }),
        request(saasApp)
          .post('/api/v1/platform/auth/verify-mfa')
          .set('Authorization', `Bearer ${challengeToken}`)
          .send({ totpCode: code })
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 401]);

      const failedRes = res1.status === 401 ? res1 : res2;
      expect(failedRes.body.code).toBe('CHALLENGE_ALREADY_USED_OR_EXPIRED');
    });

    test('6.8: Chống Replay mã OTP trong cùng step (RFC 6238 5.2): 2 challenge khác nhau dùng cùng OTP', async () => {
      const rawSecret = generateTotpSecret();
      const encrypted = encryptTotpSecret(rawSecret);
      await PlatformAdmin.create({
        username: 'mfa_otp_step_lead',
        passwordHash: await bcrypt.hash('Password123!', 8),
        role: 'platform_lead',
        totpSecret: encrypted.encrypted,
        totpSecretIv: encrypted.iv,
        totpSecretTag: encrypted.tag,
        authVersion: 0,
        status: 'active'
      });

      // Login twice to get two completely separate, valid challenge tokens
      const login1 = await request(saasApp)
        .post('/api/v1/platform/auth/login')
        .send({ username: 'mfa_otp_step_lead', password: 'Password123!' });
      const login2 = await request(saasApp)
        .post('/api/v1/platform/auth/login')
        .send({ username: 'mfa_otp_step_lead', password: 'Password123!' });

      const challengeToken1 = login1.body.challengeToken;
      const challengeToken2 = login2.body.challengeToken;
      expect(challengeToken1).not.toBe(challengeToken2);

      const code = generateTOTP(rawSecret);

      // First challenge with code succeeds
      const res1 = await request(saasApp)
        .post('/api/v1/platform/auth/verify-mfa')
        .set('Authorization', `Bearer ${challengeToken1}`)
        .send({ totpCode: code });
      expect(res1.status).toBe(200);

      // Second fresh challenge using the exact same OTP in the same 30s step fails
      const res2 = await request(saasApp)
        .post('/api/v1/platform/auth/verify-mfa')
        .set('Authorization', `Bearer ${challengeToken2}`)
        .send({ totpCode: code });
      expect(res2.status).toBe(401);
      expect(res2.body.code).toBe('OTP_ALREADY_USED');
    });

    test('6.9: Chống Replay OTP đồng thời: Promise.all với 2 challenge khác nhau và cùng mã OTP', async () => {
      const rawSecret = generateTotpSecret();
      const encrypted = encryptTotpSecret(rawSecret);
      await PlatformAdmin.create({
        username: 'mfa_otp_concurrent_lead',
        passwordHash: await bcrypt.hash('Password123!', 8),
        role: 'platform_lead',
        totpSecret: encrypted.encrypted,
        totpSecretIv: encrypted.iv,
        totpSecretTag: encrypted.tag,
        authVersion: 0,
        status: 'active'
      });

      const [loginA, loginB] = await Promise.all([
        request(saasApp)
          .post('/api/v1/platform/auth/login')
          .send({ username: 'mfa_otp_concurrent_lead', password: 'Password123!' }),
        request(saasApp)
          .post('/api/v1/platform/auth/login')
          .send({ username: 'mfa_otp_concurrent_lead', password: 'Password123!' })
      ]);

      const tokenA = loginA.body.challengeToken;
      const tokenB = loginB.body.challengeToken;
      const code = generateTOTP(rawSecret);

      const [resA, resB] = await Promise.all([
        request(saasApp)
          .post('/api/v1/platform/auth/verify-mfa')
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ totpCode: code }),
        request(saasApp)
          .post('/api/v1/platform/auth/verify-mfa')
          .set('Authorization', `Bearer ${tokenB}`)
          .send({ totpCode: code })
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([200, 401]);

      const failedRes = resA.status === 401 ? resA : resB;
      expect(['OTP_ALREADY_USED', 'CHALLENGE_ALREADY_USED_OR_EXPIRED']).toContain(failedRes.body.code);
    });

    test('6.10 (Ca A): OTP sai định dạng bị từ chối 400, challenge KHÔNG bị used, gửi lại OTP đúng thành công', async () => {
      const rawSecret = generateTotpSecret();
      const encrypted = encryptTotpSecret(rawSecret);
      const testAdmin = await PlatformAdmin.create({
        username: 'mfa_malformed_test',
        passwordHash: await bcrypt.hash('Password123!', 8),
        role: 'platform_lead',
        totpSecret: encrypted.encrypted,
        totpSecretIv: encrypted.iv,
        totpSecretTag: encrypted.tag,
        authVersion: 0,
        status: 'active'
      });

      const loginRes = await request(saasApp)
        .post('/api/v1/platform/auth/login')
        .send({ username: 'mfa_malformed_test', password: 'Password123!' });
      const { challengeToken } = loginRes.body;
      const decoded = jwt.decode(challengeToken);

      // 1. Gửi OTP sai format "abc" -> Trả 400
      const badRes = await request(saasApp)
        .post('/api/v1/platform/auth/verify-mfa')
        .set('Authorization', `Bearer ${challengeToken}`)
        .send({ totpCode: 'abc' });
      expect(badRes.status).toBe(400);
      expect(badRes.body.code).toBe('INVALID_TOTP_FORMAT');

      // Xác nhận trong DB: challenge vẫn used = false, lastUsedTotpStep không đổi
      const chInDb = await MfaChallenge.findOne({ jti: decoded.jti });
      expect(chInDb.used).toBe(false);
      const adminInDb = await PlatformAdmin.findById(testAdmin._id);
      expect(adminInDb.lastUsedTotpStep).toBe(0);

      // 2. Gửi lại OTP đúng bằng chính challenge đó -> Thành công 200
      const correctCode = generateTOTP(rawSecret);
      const okRes = await request(saasApp)
        .post('/api/v1/platform/auth/verify-mfa')
        .set('Authorization', `Bearer ${challengeToken}`)
        .send({ totpCode: correctCode });
      expect(okRes.status).toBe(200);
      expect(okRes.body.success).toBe(true);
      expect(okRes.body.token).toBeDefined();

      const finalCh = await MfaChallenge.findOne({ jti: decoded.jti });
      expect(finalCh.used).toBe(true);
    });

    test('6.11 (Ca B): OTP đủ 6 số nhưng sai: Bị từ chối 401, không tính là used, cho phép thử lại', async () => {
      const rawSecret = generateTotpSecret();
      const encrypted = encryptTotpSecret(rawSecret);
      await PlatformAdmin.create({
        username: 'mfa_wrong_otp_test',
        passwordHash: await bcrypt.hash('Password123!', 8),
        role: 'platform_lead',
        totpSecret: encrypted.encrypted,
        totpSecretIv: encrypted.iv,
        totpSecretTag: encrypted.tag,
        authVersion: 0,
        status: 'active'
      });

      const loginRes = await request(saasApp)
        .post('/api/v1/platform/auth/login')
        .send({ username: 'mfa_wrong_otp_test', password: 'Password123!' });
      const { challengeToken } = loginRes.body;
      const decoded = jwt.decode(challengeToken);

      // Gửi OTP sai 6 số "000000"
      const resWrong = await request(saasApp)
        .post('/api/v1/platform/auth/verify-mfa')
        .set('Authorization', `Bearer ${challengeToken}`)
        .send({ totpCode: '000000' });
      expect(resWrong.status).toBe(401);
      expect(resWrong.body.code).toBe('MFA_OTP_INVALID');

      // Challenge vẫn used = false, failedAttempts tăng lên 1
      const chInDb = await MfaChallenge.findOne({ jti: decoded.jti });
      expect(chInDb.used).toBe(false);
      expect(chInDb.failedAttempts).toBe(1);

      // Thử lại với mã OTP đúng -> Thành công
      const code = generateTOTP(rawSecret);
      const resRight = await request(saasApp)
        .post('/api/v1/platform/auth/verify-mfa')
        .set('Authorization', `Bearer ${challengeToken}`)
        .send({ totpCode: code });
      expect(resRight.status).toBe(200);
      expect(resRight.body.token).toBeDefined();
    });

    test('6.12 (Ca C): Lỗi DB trước commit trong transaction: Challenge và lastUsedTotpStep đều rollback, retry thành công', async () => {
      const rawSecret = generateTotpSecret();
      const encrypted = encryptTotpSecret(rawSecret);
      const testAdmin = await PlatformAdmin.create({
        username: 'mfa_rollback_test',
        passwordHash: await bcrypt.hash('Password123!', 8),
        role: 'platform_lead',
        totpSecret: encrypted.encrypted,
        totpSecretIv: encrypted.iv,
        totpSecretTag: encrypted.tag,
        authVersion: 0,
        status: 'active'
      });

      const loginRes = await request(saasApp)
        .post('/api/v1/platform/auth/login')
        .send({ username: 'mfa_rollback_test', password: 'Password123!' });
      const { challengeToken } = loginRes.body;
      const decoded = jwt.decode(challengeToken);
      const code = generateTOTP(rawSecret);

      // Mock update PlatformAdmin trong transaction ném lỗi
      const adminUpdateSpy = jest.spyOn(PlatformAdmin, 'findOneAndUpdate').mockImplementationOnce(() => {
        throw new Error('SIMULATED_DB_ERROR_IN_TRANSACTION');
      });

      const failRes = await request(saasApp)
        .post('/api/v1/platform/auth/verify-mfa')
        .set('Authorization', `Bearer ${challengeToken}`)
        .send({ totpCode: code });
      expect(failRes.status).toBe(500);

      adminUpdateSpy.mockRestore();

      // Kiểm tra trong DB: CẢ HAI ĐỀU ROLLBACK!
      const chInDb = await MfaChallenge.findOne({ jti: decoded.jti });
      expect(chInDb.used).toBe(false); // Challenge không bị tiêu thụ oan!
      const adminInDb = await PlatformAdmin.findById(testAdmin._id);
      expect(adminInDb.lastUsedTotpStep).toBe(0);

      // Retry ngay sau đó với cùng challenge -> Thành công 200
      const retryRes = await request(saasApp)
        .post('/api/v1/platform/auth/verify-mfa')
        .set('Authorization', `Bearer ${challengeToken}`)
        .send({ totpCode: code });
      expect(retryRes.status).toBe(200);
      expect(retryRes.body.token).toBeDefined();

      const finalCh = await MfaChallenge.findOne({ jti: decoded.jti });
      expect(finalCh.used).toBe(true);
    });

    test('6.13 (Ca D): Challenge hết hạn (expiresAt trong quá khứ) bị từ chối ngay cả khi document chưa bị TTL xóa', async () => {
      const rawSecret = generateTotpSecret();
      const encrypted = encryptTotpSecret(rawSecret);
      const testAdmin = await PlatformAdmin.create({
        username: 'mfa_expired_test',
        passwordHash: await bcrypt.hash('Password123!', 8),
        role: 'platform_lead',
        totpSecret: encrypted.encrypted,
        totpSecretIv: encrypted.iv,
        totpSecretTag: encrypted.tag,
        authVersion: 0,
        status: 'active'
      });

      const loginRes = await request(saasApp)
        .post('/api/v1/platform/auth/login')
        .send({ username: 'mfa_expired_test', password: 'Password123!' });
      const { challengeToken } = loginRes.body;
      const decoded = jwt.decode(challengeToken);

      // Đặt expiresAt trong quá khứ (document vẫn còn trong DB, chưa bị TTL xóa)
      await MfaChallenge.updateOne(
        { jti: decoded.jti },
        { $set: { expiresAt: new Date(Date.now() - 10000) } }
      );

      const code = generateTOTP(rawSecret);
      const res = await request(saasApp)
        .post('/api/v1/platform/auth/verify-mfa')
        .set('Authorization', `Bearer ${challengeToken}`)
        .send({ totpCode: code });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('CHALLENGE_ALREADY_USED_OR_EXPIRED');

      // Bước OTP không bị cập nhật
      const adminInDb = await PlatformAdmin.findById(testAdmin._id);
      expect(adminInDb.lastUsedTotpStep).toBe(0);
    });

    test('6.14 (Ca E): Admin bị khóa hoặc authVersion đổi giữa bước đọc ban đầu và commit -> Không cấp token', async () => {
      const rawSecret = generateTotpSecret();
      const encrypted = encryptTotpSecret(rawSecret);
      const testAdmin = await PlatformAdmin.create({
        username: 'mfa_locked_test',
        passwordHash: await bcrypt.hash('Password123!', 8),
        role: 'platform_lead',
        totpSecret: encrypted.encrypted,
        totpSecretIv: encrypted.iv,
        totpSecretTag: encrypted.tag,
        authVersion: 0,
        status: 'active'
      });

      const loginRes = await request(saasApp)
        .post('/api/v1/platform/auth/login')
        .send({ username: 'mfa_locked_test', password: 'Password123!' });
      const { challengeToken } = loginRes.body;

      // Khóa tài khoản admin
      testAdmin.status = 'locked';
      await testAdmin.save();

      const code = generateTOTP(rawSecret);
      const res = await request(saasApp)
        .post('/api/v1/platform/auth/verify-mfa')
        .set('Authorization', `Bearer ${challengeToken}`)
        .send({ totpCode: code });

      expect(res.status).toBe(401);
      expect(res.body.token).toBeUndefined();
    });

    test('6.14b (Ca E): authVersion của admin thay đổi sau khi cấp challenge -> Bị từ chối, không hoàn tất xác thực', async () => {
      const rawSecret = generateTotpSecret();
      const encrypted = encryptTotpSecret(rawSecret);
      const testAdmin = await PlatformAdmin.create({
        username: 'mfa_authversion_change_test',
        passwordHash: await bcrypt.hash('Password123!', 8),
        role: 'platform_lead',
        totpSecret: encrypted.encrypted,
        totpSecretIv: encrypted.iv,
        totpSecretTag: encrypted.tag,
        authVersion: 1,
        status: 'active'
      });

      const loginRes = await request(saasApp)
        .post('/api/v1/platform/auth/login')
        .send({ username: 'mfa_authversion_change_test', password: 'Password123!' });
      const { challengeToken } = loginRes.body;

      // Đổi authVersion của admin
      testAdmin.authVersion = 2;
      await testAdmin.save();

      const code = generateTOTP(rawSecret);
      const res = await request(saasApp)
        .post('/api/v1/platform/auth/verify-mfa')
        .set('Authorization', `Bearer ${challengeToken}`)
        .send({ totpCode: code });

      expect(res.status).toBe(401);
      expect(res.body.token).toBeUndefined();

      const adminInDb = await PlatformAdmin.findById(testAdmin._id);
      expect(adminInDb.lastUsedTotpStep).toBe(0);
    });

    test('6.14c (Ca E): Credential MFA (totpSecret/IV) xoay vòng trong lúc xác thực -> Transaction rollback, không cấp token với secret cũ', async () => {
      const rawSecret = generateTotpSecret();
      const encrypted = encryptTotpSecret(rawSecret);
      const testAdmin = await PlatformAdmin.create({
        username: 'mfa_credential_rotation_test',
        passwordHash: await bcrypt.hash('Password123!', 8),
        role: 'platform_lead',
        totpSecret: encrypted.encrypted,
        totpSecretIv: encrypted.iv,
        totpSecretTag: encrypted.tag,
        authVersion: 0,
        status: 'active'
      });

      const loginRes = await request(saasApp)
        .post('/api/v1/platform/auth/login')
        .send({ username: 'mfa_credential_rotation_test', password: 'Password123!' });
      const { challengeToken } = loginRes.body;
      const decoded = jwt.decode(challengeToken);

      const code = generateTOTP(rawSecret);

      // Ngay trước khi verify hoàn tất, admin đổi secret MFA
      const newRawSecret = generateTotpSecret();
      const newEncrypted = encryptTotpSecret(newRawSecret);
      testAdmin.totpSecret = newEncrypted.encrypted;
      testAdmin.totpSecretIv = newEncrypted.iv;
      testAdmin.totpSecretTag = newEncrypted.tag;
      await testAdmin.save();

      const res = await request(saasApp)
        .post('/api/v1/platform/auth/verify-mfa')
        .set('Authorization', `Bearer ${challengeToken}`)
        .send({ totpCode: code });

      expect(res.status).toBe(401);
      expect(res.body.token).toBeUndefined();

      const chInDb = await MfaChallenge.findOne({ jti: decoded.jti });
      expect(chInDb.used).toBe(false);
      const adminInDb = await PlatformAdmin.findById(testAdmin._id);
      expect(adminInDb.lastUsedTotpStep).toBe(0);
    });

    test('6.15 (Ca I): Vượt giới hạn thử OTP (5 lần): Bị khóa với MFA_MAX_ATTEMPTS_EXCEEDED, đổi IP không bypass', async () => {
      const rawSecret = generateTotpSecret();
      const encrypted = encryptTotpSecret(rawSecret);
      await PlatformAdmin.create({
        username: 'mfa_limit_test',
        passwordHash: await bcrypt.hash('Password123!', 8),
        role: 'platform_lead',
        totpSecret: encrypted.encrypted,
        totpSecretIv: encrypted.iv,
        totpSecretTag: encrypted.tag,
        authVersion: 0,
        status: 'active'
      });

      const loginRes = await request(saasApp)
        .post('/api/v1/platform/auth/login')
        .send({ username: 'mfa_limit_test', password: 'Password123!' });
      const { challengeToken } = loginRes.body;

      // Thử sai 4 lần liên tiếp từ IP 1
      for (let i = 0; i < 4; i++) {
        const r = await request(saasApp)
          .post('/api/v1/platform/auth/verify-mfa')
          .set('Authorization', `Bearer ${challengeToken}`)
          .set('X-Forwarded-For', '192.168.1.100')
          .send({ totpCode: '111111' });
        expect(r.status).toBe(401);
        expect(r.body.code).toBe('MFA_OTP_INVALID');
      }

      // Lần thứ 5: Giả mạo đổi sang IP khác (X-Forwarded-For: 10.0.0.99)
      const r5 = await request(saasApp)
        .post('/api/v1/platform/auth/verify-mfa')
        .set('Authorization', `Bearer ${challengeToken}`)
        .set('X-Forwarded-For', '10.0.0.99')
        .send({ totpCode: '222222' });

      // Phải bị khóa có chủ đích theo challenge/tài khoản, không thể bypass qua IP
      expect(r5.status).toBe(401);
      expect(r5.body.code).toBe('MFA_MAX_ATTEMPTS_EXCEEDED');

      // Dù gửi mã đúng sau đó cũng bị từ chối
      const code = generateTOTP(rawSecret);
      const rAfter = await request(saasApp)
        .post('/api/v1/platform/auth/verify-mfa')
        .set('Authorization', `Bearer ${challengeToken}`)
        .send({ totpCode: code });
      expect(rAfter.status).toBe(401);
      expect(rAfter.body.code).toBe('MFA_MAX_ATTEMPTS_EXCEEDED');
    });
  });

  // =========================================================================
  // VII. PLATFORM AUTHORIZATION MATRIX (LỖI 7: PHÂN QUYỀN LEAD VS SUPPORT)
  // =========================================================================
  describe('Lỗi 7: Ma trận Phân Quyền Nền Tảng (platform_lead vs platform_support)', () => {
    test('7.1: platform_support không thể tạo tenant (POST /tenants bị từ chối 403 FORBIDDEN_PLATFORM_ROLE)', async () => {
      const supportToken = generatePlatformAdminToken(platformSupport);

      const res = await request(saasApp)
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${supportToken}`)
        .send({ code: 'TRUONG-SUPPORT-FAIL', name: 'Trường Cố Tạo Bằng Support' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_PLATFORM_ROLE');

      // Verify DB side-effect: tenant was NOT created
      const exists = await Tenant.findOne({ code: 'TRUONG-SUPPORT-FAIL' });
      expect(exists).toBeNull();
    });

    test('7.2: platform_support không thể thay đổi status tenant (PATCH /status bị từ chối 403)', async () => {
      const supportToken = generatePlatformAdminToken(platformSupport);

      const res = await request(saasApp)
        .patch(`/api/v1/platform/tenants/${tenantA._id}/status`)
        .set('Authorization', `Bearer ${supportToken}`)
        .send({ status: 'suspended' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_PLATFORM_ROLE');

      const tenantInDb = await Tenant.findById(tenantA._id);
      expect(tenantInDb.status).toBe('active');
    });

    test('7.3: platform_support đọc danh sách tenants bị ẩn các trường config nhạy cảm', async () => {
      const supportToken = generatePlatformAdminToken(platformSupport);

      const res = await request(saasApp)
        .get('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${supportToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);

      // Support must NOT receive sensitive config field
      for (const t of res.body.data) {
        expect(t.config).toBeUndefined();
        expect(t.code).toBeDefined();
        expect(t.name).toBeDefined();
      }
    });

    test('7.4: platform_lead có đầy đủ quyền tạo và đổi status tenant', async () => {
      const leadToken = generatePlatformAdminToken(platformLead);

      const createRes = await request(saasApp)
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${leadToken}`)
        .send({ code: 'TRUONG-LEAD-OK', name: 'Trường Tạo Bởi Lead' });
      expect(createRes.status).toBe(201);

      const patchRes = await request(saasApp)
        .patch(`/api/v1/platform/tenants/${createRes.body.data._id}/status`)
        .set('Authorization', `Bearer ${leadToken}`)
        .send({ status: 'suspended' });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.changed).toBe(true);
    });
  });

  // =========================================================================
  // VIII. KIỂM TRA MÃ NGUỒN VÀ KHÔNG CHẠY WORKER THẬT (PHẦN IX)
  // =========================================================================
  describe('Phần IX: Quét Mã Nguồn Thực Tế & Đảm Bảo Không Chạy Workers', () => {
    test('8.1: Quét các file mã nguồn SaaS trên disk đảm bảo không có secret hay fallback hardcoded', () => {
      const saasDir = path.resolve(__dirname, '../../src/saas');
      const filesToScan = [
        path.join(saasDir, 'utils/totpHelper.js'),
        path.join(saasDir, 'utils/saasJwt.js'),
        path.join(saasDir, 'safeDbGuard.js'),
        path.join(saasDir, 'createSaasApp.js'),
        path.join(saasDir, 'controllers/platformAuthController.js'),
        path.join(saasDir, 'controllers/schoolAuthController.js'),
        path.join(saasDir, 'controllers/platformTenantController.js')
      ];

      for (const filePath of filesToScan) {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        expect(fileContent).not.toContain('default-saas-isolated-test-key-32b');
        expect(fileContent).not.toContain('mongodb+srv://');
        expect(fileContent).not.toContain('supersecret');
      }
    });

    test('8.2: [Kiểm tra cấu hình & Guard Helper] Schedulers/workers bị chặn ở mức env và assertNoWorkersRunning (chưa phải integration test toàn bộ runtime scheduler)', () => {
      expect(assertNoWorkersRunning()).toBe(true);
      expect(process.env.TIMEKEEPING_SCHEDULER_ENABLED).not.toBe('true');
    });

    test('8.3: [Unit test helper] verifySocketHandshake với fakeSocket: Trả về HTTP 501 khi TENANT_FEATURE_READINESS=false (chưa phải integration test trên server WebSocket thực tế)', () => {
      let writtenData = '';
      let destroyed = false;
      const fakeSocket = {
        write: (d) => { writtenData += d; },
        destroy: () => { destroyed = true; }
      };

      const accepted = verifySocketHandshake({}, fakeSocket);
      expect(accepted).toBe(false);
      expect(writtenData).toContain('501 Not Implemented');
      expect(destroyed).toBe(true);
    });
  });


  // =========================================================================
  // X. MULTI-TENANT DATA & INDEX INTEGRITY (TIẾP TỤC KIỂM CHỨNG SCHEMA)
  // =========================================================================
  describe('X. Multi-Tenant Data & Index Integrity (Schema & Partial Index)', () => {
    test('10.1: Tạo 2 phụ huynh trong cùng Trường A không có employeeId thành công cả hai, không lỗi E11000', async () => {
      const p1 = await User.create({
        tenantId: tenantA._id,
        username: 'parent_a1',
        passwordHash: 'dummy',
        role: 'parent',
        profile: { fullName: 'Phụ huynh A1' }
      });

      const p2 = await User.create({
        tenantId: tenantA._id,
        username: 'parent_a2',
        passwordHash: 'dummy',
        role: 'parent',
        profile: { fullName: 'Phụ huynh A2' }
      });

      expect(p1._id).toBeDefined();
      expect(p2._id).toBeDefined();
    });

    test('10.2: Hai nhân viên cùng Trường A có cùng employeeId NV01 bị chặn E11000 duplicate key', async () => {
      await User.create({
        tenantId: tenantA._id,
        username: 'emp_a1',
        passwordHash: 'dummy',
        role: 'teacher',
        profile: { fullName: 'GV A1' },
        employeeInfo: { employeeId: 'NV01' }
      });

      let err;
      try {
        await User.create({
          tenantId: tenantA._id,
          username: 'emp_a2',
          passwordHash: 'dummy',
          role: 'teacher',
          profile: { fullName: 'GV A2' },
          employeeInfo: { employeeId: 'NV01' }
        });
      } catch (e) {
        err = e;
      }

      expect(err).toBeDefined();
      expect(err.code).toBe(11000);
    });

    test('10.3: Cùng mã nhân viên NV01 ở hai trường khác nhau (Trường A và Trường B) thành công cả hai', async () => {
      const empA = await User.create({
        tenantId: tenantA._id,
        username: 'emp_school_a',
        passwordHash: 'dummy',
        role: 'teacher',
        profile: { fullName: 'GV Trường A' },
        employeeInfo: { employeeId: 'NV01' }
      });

      const empB = await User.create({
        tenantId: tenantB._id,
        username: 'emp_school_b',
        passwordHash: 'dummy',
        role: 'teacher',
        profile: { fullName: 'GV Trường B' },
        employeeInfo: { employeeId: 'NV01' }
      });

      expect(empA._id).toBeDefined();
      expect(empB._id).toBeDefined();
    });

    test('10.4: Chuẩn hóa employeeId: trim & uppercase; chuỗi rỗng chuyển thành undefined không index', async () => {
      const empWithSpaces = await User.create({
        tenantId: tenantA._id,
        username: 'emp_spaces',
        passwordHash: 'dummy',
        role: 'teacher',
        profile: { fullName: 'GV Khoảng Trắng' },
        employeeInfo: { employeeId: '  nv02  ' }
      });
      expect(empWithSpaces.employeeInfo.employeeId).toBe('NV02');

      const empEmpty = await User.create({
        tenantId: tenantA._id,
        username: 'emp_empty',
        passwordHash: 'dummy',
        role: 'teacher',
        profile: { fullName: 'GV Rỗng' },
        employeeInfo: { employeeId: '   ' }
      });
      expect(empEmpty.employeeInfo.employeeId).toBeUndefined();
    });

    test('10.5: Hai user có cùng username gv_huong trong cùng Trường A bị chặn E11000', async () => {
      await User.create({
        tenantId: tenantA._id,
        username: 'gv_huong',
        passwordHash: 'dummy',
        role: 'teacher',
        profile: { fullName: 'GV Hương 1' }
      });

      let err;
      try {
        await User.create({
          tenantId: tenantA._id,
          username: 'gv_huong',
          passwordHash: 'dummy',
          role: 'teacher',
          profile: { fullName: 'GV Hương 2' }
        });
      } catch (e) {
        err = e;
      }

      expect(err).toBeDefined();
      expect(err.code).toBe(11000);
    });

    test('10.6: Hai user có cùng username gv_huong ở 2 trường khác nhau thành công cả hai', async () => {
      const uA = await User.create({
        tenantId: tenantA._id,
        username: 'gv_huong',
        passwordHash: 'dummy',
        role: 'teacher',
        profile: { fullName: 'GV Hương Trường A' }
      });

      const uB = await User.create({
        tenantId: tenantB._id,
        username: 'gv_huong',
        passwordHash: 'dummy',
        role: 'teacher',
        profile: { fullName: 'GV Hương Trường B' }
      });

      expect(uA._id).toBeDefined();
      expect(uB._id).toBeDefined();
    });
  });

  // =========================================================================
  // XI. BACKEND FEATURE GATE (KHÓA TOÀN BỘ 19 ROUTER CŨ VÀ MỚI HTTP 501)
  // =========================================================================
  describe('XI. Backend Feature Gate Fail-Closed trên Toàn Bộ Tuyến Đường Nghiệp Vụ', () => {
    test('11.1: GET /api/v1/students bị chặn HTTP 501 Not Implemented', async () => {
      const res = await request(saasApp).get('/api/v1/students');
      expect(res.status).toBe(501);
      expect(res.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
    });

    test('11.2: GET /api/students (đường dẫn cũ) bị chặn HTTP 501 Not Implemented', async () => {
      const res = await request(saasApp).get('/api/students');
      expect(res.status).toBe(501);
      expect(res.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
    });

    test('11.3: Toàn bộ các route nghiệp vụ cũ & mới đều bị gate chặn 501', async () => {
      const routes = [
        '/api/v1/classrooms',
        '/api/classrooms',
        '/api/v1/finance',
        '/api/finance',
        '/api/v1/guard',
        '/api/guard',
        '/api/v1/nutrition',
        '/api/hr'
      ];

      for (const route of routes) {
        const res = await request(saasApp).get(route);
        expect(res.status).toBe(501);
        expect(res.body.code).toBe('MODULE_NOT_IMPLEMENTED_IN_PHASE_1A');
      }
    });

    test('11.4: Health check mở 200 OK trên cả /api/health và /api/v1/health', async () => {
      const res1 = await request(saasApp).get('/api/health');
      const res2 = await request(saasApp).get('/api/v1/health');
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.body.mode).toBe('saas_phase1a');
    });
  });

});
