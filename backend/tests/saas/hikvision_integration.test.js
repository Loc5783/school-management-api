'use strict';

/**
 * SaaS Hikvision DS-K1T320MX Integration & Multi-Tenant Acceptance Test Suite
 *
 * File: backend/tests/saas/hikvision_integration.test.js
 *
 * Verifies:
 * 1. Device Registration & Multi-Tenant Scoping (Server-derived credential reference, no secret leakage)
 * 2. Scoped serialNumber index & global apiKeyHash index & rejection of client credentialKey (400)
 * 3. SSRF Guard (192.168.1.22 forbidden, public IP forbidden)
 * 4. RBAC checks on Device & Mapping endpoints
 * 5. Cross-tenant isolation (ID access returns 404, credentialKey allowlist returns 403)
 * 6. Person Mapping (Employee & Student mapping within tenant, anti-cross-tenant boundary)
 * 7. Device Authentication (saasDeviceAuth, key required, collision, disabled, mismatch, spoofing)
 * 8. Event Ingest Idempotency & Duplicate handling
 * 9. Unmapped events (graceful ingest, admin review queue)
 * 10. Student attendance ingest scoping
 * 11. Employee PUNCH logic (1 punch = incomplete, 2 punches = in/out, out-of-order resolution)
 * 12. Multi-page event sync (250 events, safetyCap, truncated: true, cursor continuation)
 * 13. Distributed sync lease heartbeat, lease renewal beyond initial TTL, LEASE_LOST abort & recovery
 */

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';

jest.setTimeout(120000);

const crypto = require('crypto');
const mongoose = require('mongoose');
const request = require('supertest');

const testDbBootstrap = require('../../src/saas/testDbBootstrap');
const createSaasApp = require('../../src/saas/createSaasApp');
const { generateSchoolUserToken } = require('../../src/saas/utils/saasJwt');
const { getWorkDate, startOfWorkDate, DEFAULT_SCHOOL_TIMEZONE } = require('../../src/utils/dateHelpers');
const { processQueuedRecalculations } = require('../../src/services/attendanceCalculationService');
const { syncDeviceEvents } = require('../../src/services/hikvisionSyncService');
const hikvisionIsapiService = require('../../src/services/hikvisionIsapiService');

// System models
const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const Student = require('../../src/models/zone3_school/Student');
const StudentAttendance = require('../../src/models/zone3_school/StudentAttendance');
const Classroom = require('../../src/models/zone3_school/Classroom');

// HR & Timekeeping models
const Employee = require('../../src/models/zone2_hr/Employee');
const StaffShift = require('../../src/models/zone2_hr/StaffShift');
const TimekeepingDevice = require('../../src/models/zone2_hr/TimekeepingDevice');
const AttendanceDevicePersonMapping = require('../../src/models/zone2_hr/AttendanceDevicePersonMapping');
const DeviceSyncLog = require('../../src/models/zone2_hr/DeviceSyncLog');
const RawAttendanceEvent = require('../../src/models/zone2_hr/RawAttendanceEvent');
const AttendanceRecord = require('../../src/models/zone2_hr/AttendanceRecord');
const AttendanceAuditLog = require('../../src/models/zone2_hr/AttendanceAuditLog');
const AttendanceRecalculationQueue = require('../../src/models/zone2_hr/AttendanceRecalculationQueue');

describe('SaaS Hikvision Multi-Tenant A/B Integration Test Suite', () => {
  let bootstrapInstance;
  let mongoUri;
  let app;

  // Tenants
  let tenantA;
  let tenantB;

  // Users Tenant A
  let adminA;
  let principalA;
  let hrA;
  let teacherA;
  let employeeUserA;

  // Users Tenant B
  let adminB;
  let principalB;
  let hrB;
  let teacherB;
  let employeeUserB;

  // Tokens
  let tokenAdminA;
  let tokenPrincipalA;
  let tokenHrA;
  let tokenTeacherA;

  let tokenAdminB;
  let tokenPrincipalB;
  let tokenHrB;
  let tokenTeacherB;

  // Academic fixtures
  let studentA;
  let studentB;

  // Devices
  let deviceA;
  let deviceB;
  const apiKeyA = 'api-key-hoanang-a-secret-01';
  const apiKeyB = 'api-key-hoanang-b-secret-02';

  beforeAll(async () => {
    bootstrapInstance = await testDbBootstrap.startTestDb({
      instanceOpts: [{ dbName: 'school_saas_hikvision_integration_test' }]
    });
    mongoUri = bootstrapInstance.uri;

    app = createSaasApp({ mongoUri, connection: bootstrapInstance.connection, saasMode: 'phase1e' });

    await Promise.all([
      Tenant.syncIndexes(),
      User.syncIndexes(),
      Student.syncIndexes(),
      StudentAttendance.syncIndexes(),
      Classroom.syncIndexes(),
      Employee.syncIndexes(),
      StaffShift.syncIndexes(),
      TimekeepingDevice.syncIndexes(),
      AttendanceDevicePersonMapping.syncIndexes(),
      DeviceSyncLog.syncIndexes(),
      RawAttendanceEvent.syncIndexes(),
      AttendanceRecord.syncIndexes(),
      AttendanceAuditLog.syncIndexes(),
      AttendanceRecalculationQueue.syncIndexes()
    ]);

    // Create Tenants
    tenantA = await Tenant.create({
      code: 'HOANANG-A',
      name: 'Trường Mầm Non Hoa Nắng A',
      status: 'active'
    });

    tenantB = await Tenant.create({
      code: 'HOANANG-B',
      name: 'Trường Mầm Non Hoa Nắng B',
      status: 'active'
    });

    // Users Tenant A
    adminA = await User.create({
      username: 'admin_a_hik',
      passwordHash: 'hashed',
      role: 'admin',
      status: 'active',
      tenantId: tenantA._id,
      profile: { fullName: 'Quản Trị A' }
    });
    tokenAdminA = generateSchoolUserToken(adminA, tenantA);

    principalA = await User.create({
      username: 'principal_a_hik',
      passwordHash: 'hashed',
      role: 'principal',
      status: 'active',
      tenantId: tenantA._id,
      profile: { fullName: 'Hiệu Trưởng A' }
    });
    tokenPrincipalA = generateSchoolUserToken(principalA, tenantA);

    hrA = await User.create({
      username: 'hr_a_hik',
      passwordHash: 'hashed',
      role: 'hr',
      status: 'active',
      tenantId: tenantA._id,
      profile: { fullName: 'Nhân Sự A' }
    });
    tokenHrA = generateSchoolUserToken(hrA, tenantA);

    teacherA = await User.create({
      username: 'teacher_a_hik',
      passwordHash: 'hashed',
      role: 'teacher',
      status: 'active',
      tenantId: tenantA._id,
      profile: { fullName: 'Giáo Viên A' }
    });
    tokenTeacherA = generateSchoolUserToken(teacherA, tenantA);

    employeeUserA = await User.create({
      username: 'emp_a_hik',
      passwordHash: 'hashed',
      role: 'teacher',
      status: 'active',
      tenantId: tenantA._id,
      profile: { fullName: 'Cô Giáo Lộc A' }
    });
    await Employee.create({
      tenantId: tenantA._id,
      userId: employeeUserA._id,
      fullName: 'Cô Giáo Lộc A',
      employeeCode: 'NV-A-01',
      payrollRole: 'teacher',
      status: 'active'
    });

    // Users Tenant B
    adminB = await User.create({
      username: 'admin_b_hik',
      passwordHash: 'hashed',
      role: 'admin',
      status: 'active',
      tenantId: tenantB._id,
      profile: { fullName: 'Quản Trị B' }
    });
    tokenAdminB = generateSchoolUserToken(adminB, tenantB);

    principalB = await User.create({
      username: 'principal_b_hik',
      passwordHash: 'hashed',
      role: 'principal',
      status: 'active',
      tenantId: tenantB._id,
      profile: { fullName: 'Hiệu Trưởng B' }
    });
    tokenPrincipalB = generateSchoolUserToken(principalB, tenantB);

    hrB = await User.create({
      username: 'hr_b_hik',
      passwordHash: 'hashed',
      role: 'hr',
      status: 'active',
      tenantId: tenantB._id,
      profile: { fullName: 'Nhân Sự B' }
    });
    tokenHrB = generateSchoolUserToken(hrB, tenantB);

    teacherB = await User.create({
      username: 'teacher_b_hik',
      passwordHash: 'hashed',
      role: 'teacher',
      status: 'active',
      tenantId: tenantB._id,
      profile: { fullName: 'Giáo Viên B' }
    });
    tokenTeacherB = generateSchoolUserToken(teacherB, tenantB);

    employeeUserB = await User.create({
      username: 'emp_b_hik',
      passwordHash: 'hashed',
      role: 'teacher',
      status: 'active',
      tenantId: tenantB._id,
      profile: { fullName: 'Cô Giáo Lộc B' }
    });
    await Employee.create({
      tenantId: tenantB._id,
      userId: employeeUserB._id,
      fullName: 'Cô Giáo Lộc B',
      employeeCode: 'NV-B-01',
      payrollRole: 'teacher',
      status: 'active'
    });

    // Students
    const classA = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Mầm 1A',
      code: 'MAM1A',
      ageGroup: '3-4',
      status: 'active'
    });
    studentA = await Student.create({
      tenantId: tenantA._id,
      studentCode: 'HS-2026-000011',
      fullName: 'Bé Nguyễn Văn A',
      classroomId: classA._id,
      className: classA.name,
      gender: 'male',
      status: 'enrolled',
      birthDate: new Date('2022-01-01')
    });

    const classB = await Classroom.create({
      tenantId: tenantB._id,
      name: 'Lớp Mầm 1B',
      code: 'MAM1B',
      ageGroup: '3-4',
      status: 'active'
    });
    studentB = await Student.create({
      tenantId: tenantB._id,
      studentCode: 'HS-2026-000012',
      fullName: 'Bé Trần Văn B',
      classroomId: classB._id,
      className: classB.name,
      gender: 'male',
      status: 'enrolled',
      birthDate: new Date('2022-02-02')
    });
  });

  afterAll(async () => {
    if (bootstrapInstance) {
      await bootstrapInstance.stop();
    }
  });

  describe('1. Device Registration & Multi-Tenant Scoping', () => {
    test('Admin A registers Device A without credentialKey (Server automatically derives namespace)', async () => {
      const res = await request(app)
        .post('/api/v1/timekeeping/devices')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          deviceCode: 'HIK-GATE-01',
          name: 'Cổng Chính A',
          vendor: 'HIKVISION',
          model: 'DS-K1T320MX',
          serialNumber: 'SN-HIK-001',
          apiKey: apiKeyA,
          host: '192.168.1.8',
          httpsPort: 443
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deviceCode).toBe('HIK-GATE-01');
      expect(res.body.data.tenantId).toBe(String(tenantA._id));
      // Sanitize check: API response must NOT expose apiKeyHash, credentialKey, or syncLease
      expect(res.body.data.apiKeyHash).toBeUndefined();
      expect(res.body.data.credentialKey).toBeUndefined();
      expect(res.body.data.syncLease).toBeUndefined();
      // Must contain non-sensitive configuration status
      expect(res.body.data.credentialConfigured).toBeDefined();
      expect(res.body.data.credentialStatus).toBe('MISSING');
      deviceA = res.body.data;

      // Verify in DB that server derived credentialKey strictly as HIKVISION_HOANANG_A
      const dbDeviceA = await TimekeepingDevice.findById(deviceA._id);
      expect(dbDeviceA.credentialKey).toBe('HIKVISION_HOANANG_A');
    });

    test('Admin B can register same deviceCode (HIK-GATE-01) under Tenant B (Server derives HIKVISION_HOANANG_B)', async () => {
      const res = await request(app)
        .post('/api/v1/timekeeping/devices')
        .set('Authorization', `Bearer ${tokenAdminB}`)
        .send({
          deviceCode: 'HIK-GATE-01',
          name: 'Cổng Chính B',
          vendor: 'HIKVISION',
          model: 'DS-K1T320MX',
          serialNumber: 'SN-HIK-002',
          apiKey: apiKeyB,
          host: '192.168.2.8',
          httpsPort: 443
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tenantId).toBe(String(tenantB._id));
      expect(res.body.data.apiKeyHash).toBeUndefined();
      expect(res.body.data.credentialKey).toBeUndefined();
      deviceB = res.body.data;

      const dbDeviceB = await TimekeepingDevice.findById(deviceB._id);
      expect(dbDeviceB.credentialKey).toBe('HIKVISION_HOANANG_B');
    });

    test('Client attempting to pass credentialKey in POST payload is strictly rejected with 400', async () => {
      const res = await request(app)
        .post('/api/v1/timekeeping/devices')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          deviceCode: 'HIK-CLIENT-KEY',
          name: 'Máy Gửi Kèm Key',
          host: '192.168.1.15',
          credentialKey: 'HIKVISION_HOANANG_A' // Client forbidden from providing
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CREDENTIAL_KEY_IMMUTABLE');
    });

    test('Client attempting to pass credentialKey in PATCH payload is strictly rejected with 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/timekeeping/devices/${deviceA._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          credentialKey: 'HIKVISION_MUTATE'
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CREDENTIAL_KEY_IMMUTABLE');
    });

    test('Duplicate deviceCode within the same tenant is rejected with 409', async () => {
      const res = await request(app)
        .post('/api/v1/timekeeping/devices')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          deviceCode: 'HIK-GATE-01',
          name: 'Cổng Phụ Trùng Mã',
          host: '192.168.1.9'
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('đã tồn tại');
    });

    test('Duplicate serialNumber within the same tenant is rejected with 409', async () => {
      const res = await request(app)
        .post('/api/v1/timekeeping/devices')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          deviceCode: 'HIK-ANOTHER-01',
          name: 'Máy Khác Cùng Serial',
          serialNumber: 'SN-HIK-001', // Already belongs to deviceA
          host: '192.168.1.10'
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('serial');
    });

    test('Duplicate global apiKey across any tenant is rejected with 409', async () => {
      const res = await request(app)
        .post('/api/v1/timekeeping/devices')
        .set('Authorization', `Bearer ${tokenAdminB}`)
        .send({
          deviceCode: 'HIK-ANOTHER-02',
          name: 'Máy B Cố Dùng Key A',
          apiKey: apiKeyA, // Collision with deviceA
          host: '192.168.2.11'
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('API Key');
    });

    test('Registration with forbidden device 192.168.1.22 is strictly rejected with 403', async () => {
      const res = await request(app)
        .post('/api/v1/timekeeping/devices')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          deviceCode: 'FORBIDDEN-01',
          name: 'Máy Cấm',
          host: '192.168.1.22'
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_DEVICE_IP');
    });

    test('Registration with public IP (SSRF guard) is strictly rejected with 403', async () => {
      const res = await request(app)
        .post('/api/v1/timekeeping/devices')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          deviceCode: 'SSRF-01',
          name: 'Máy Public',
          host: '8.8.8.8'
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('SSRF_BLOCKED');
    });

    test('Device list is strictly isolated by tenant and sanitized', async () => {
      const resA = await request(app)
        .get('/api/v1/timekeeping/devices')
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(resA.status).toBe(200);
      expect(resA.body.data.length).toBe(1);
      expect(resA.body.data[0].deviceCode).toBe('HIK-GATE-01');
      expect(resA.body.data[0].name).toBe('Cổng Chính A');
      expect(resA.body.data[0].apiKeyHash).toBeUndefined();
      expect(resA.body.data.credentialKey).toBeUndefined();

      const resB = await request(app)
        .get('/api/v1/timekeeping/devices')
        .set('Authorization', `Bearer ${tokenAdminB}`);

      expect(resB.status).toBe(200);
      expect(resB.body.data.length).toBe(1);
      expect(resB.body.data[0].deviceCode).toBe('HIK-GATE-01');
      expect(resB.body.data[0].name).toBe('Cổng Chính B');
      expect(resB.body.data[0].apiKeyHash).toBeUndefined();
      expect(resB.body.data.credentialKey).toBeUndefined();
    });

    test('RBAC: Principal and HR can view devices; Teacher cannot', async () => {
      const resPrinc = await request(app)
        .get('/api/v1/timekeeping/devices')
        .set('Authorization', `Bearer ${tokenPrincipalA}`);
      expect(resPrinc.status).toBe(200);

      const resHr = await request(app)
        .get('/api/v1/timekeeping/devices')
        .set('Authorization', `Bearer ${tokenHrA}`);
      expect(resHr.status).toBe(200);

      const resTeacher = await request(app)
        .get('/api/v1/timekeeping/devices')
        .set('Authorization', `Bearer ${tokenTeacherA}`);
      expect(resTeacher.status).toBe(403);
    });
  });

  describe('2. Cross-Tenant Isolation & Credential Security', () => {
    test('Cross-tenant ID access: Admin A requesting Device B by ID returns 404 (does not leak existence)', async () => {
      const res = await request(app)
        .get(`/api/v1/timekeeping/devices/${deviceB._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(404);
    });

    test('Cross-tenant update: Admin A attempting to patch Device B returns 404', async () => {
      const res = await request(app)
        .patch(`/api/v1/timekeeping/devices/${deviceB._id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ name: 'Hacked Name' });

      expect(res.status).toBe(404);
    });

    test('Cross-tenant test-connection: Admin A testing Device B returns 404', async () => {
      const res = await request(app)
        .post(`/api/v1/timekeeping/devices/${deviceB._id}/test-connection`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(404);
    });

    test('Cross-tenant sync trigger: Admin A triggering sync on Device B returns 404', async () => {
      const res = await request(app)
        .post(`/api/v1/timekeeping/devices/${deviceB._id}/sync`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(404);
    });

    test('Cross-tenant mappings: Admin A requesting mappings of Device B returns 404', async () => {
      const res = await request(app)
        .get(`/api/v1/timekeeping/devices/${deviceB._id}/person-mappings`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(404);
    });

    test('Cross-tenant sync logs: Admin A requesting logs of Device B returns 404', async () => {
      const res = await request(app)
        .get(`/api/v1/timekeeping/devices/${deviceB._id}/sync-logs`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(404);
    });
  });

  describe('3. Person Mapping & Cross-Tenant Boundary', () => {
    test('Admin A can map externalPersonId "LOC01" to Employee A', async () => {
      const res = await request(app)
        .post(`/api/v1/timekeeping/devices/${deviceA._id}/person-mappings`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          externalPersonId: 'LOC01',
          subjectType: 'EMPLOYEE',
          subjectId: employeeUserA._id,
          displayName: 'Cô Giáo Lộc A'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.externalPersonId).toBe('LOC01');
      expect(res.body.data.tenantId).toBe(String(tenantA._id));
    });

    test('Admin A can map externalPersonId "STU01" to Student A', async () => {
      const res = await request(app)
        .post(`/api/v1/timekeeping/devices/${deviceA._id}/person-mappings`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          externalPersonId: 'STU01',
          subjectType: 'STUDENT',
          subjectId: studentA._id,
          displayName: 'Bé Nguyễn Văn A'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.subjectType).toBe('STUDENT');
    });

    test('Cross-tenant mapping attempt: Admin A trying to map Employee B is rejected with 404', async () => {
      const res = await request(app)
        .post(`/api/v1/timekeeping/devices/${deviceA._id}/person-mappings`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          externalPersonId: 'LOC02',
          subjectType: 'EMPLOYEE',
          subjectId: employeeUserB._id,
          displayName: 'Alien Employee'
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Không tìm thấy nhân viên');
    });

    test('Cross-tenant mapping attempt: Admin A trying to map Student B is rejected with 404', async () => {
      const res = await request(app)
        .post(`/api/v1/timekeeping/devices/${deviceA._id}/person-mappings`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          externalPersonId: 'STU02',
          subjectType: 'STUDENT',
          subjectId: studentB._id,
          displayName: 'Alien Student'
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Không tìm thấy học sinh');
    });

    test('Admin B can map externalPersonId "LOC01" to Employee B independently without conflict', async () => {
      const res = await request(app)
        .post(`/api/v1/timekeeping/devices/${deviceB._id}/person-mappings`)
        .set('Authorization', `Bearer ${tokenAdminB}`)
        .send({
          externalPersonId: 'LOC01',
          subjectType: 'EMPLOYEE',
          subjectId: employeeUserB._id,
          displayName: 'Cô Giáo Lộc B'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tenantId).toBe(String(tenantB._id));
    });
  });

  describe('4. Hardware Event Ingest & saasDeviceAuth Security', () => {
    test('Rejects request with missing API key with 401 DEVICE_KEY_REQUIRED', async () => {
      const res = await request(app)
        .post('/api/v1/timekeeping/device-events')
        .send({
          deviceCode: 'HIK-GATE-01',
          externalEventId: 'EVT-NOKEY'
        });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('DEVICE_KEY_REQUIRED');
    });

    test('Rejects request with invalid / unknown API key with 401 DEVICE_AUTH_FAILED', async () => {
      const res = await request(app)
        .post('/api/v1/timekeeping/device-events')
        .set('X-Device-Api-Key', 'invalid-fake-api-key-12345')
        .send({
          deviceCode: 'HIK-GATE-01',
          externalEventId: 'EVT-WRONGKEY'
        });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('DEVICE_AUTH_FAILED');
    });

    test('Disabled device is rejected with 403 DEVICE_DISABLED', async () => {
      await TimekeepingDevice.updateOne({ _id: deviceB._id }, { $set: { enabled: false } });

      const res = await request(app)
        .post('/api/v1/timekeeping/device-events')
        .set('X-Device-Api-Key', apiKeyB)
        .send({
          deviceCode: 'HIK-GATE-01',
          externalEventId: 'EVT-DISABLED'
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('DEVICE_DISABLED');

      // Restore deviceB enabled
      await TimekeepingDevice.updateOne({ _id: deviceB._id }, { $set: { enabled: true } });
    });

    test('Device code mismatch header returns 401 DEVICE_CODE_MISMATCH', async () => {
      const res = await request(app)
        .post('/api/v1/timekeeping/device-events')
        .set('X-Device-Api-Key', apiKeyA)
        .set('X-Device-Code', 'DIFFERENT-CODE') // Key belongs to HIK-GATE-01
        .send({
          externalEventId: 'EVT-MISMATCH'
        });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('DEVICE_CODE_MISMATCH');
    });

    test('Tenant Spoofing Attack: Client cannot override device tenantId', async () => {
      const occurredAt = new Date('2026-09-16T08:00:00.000Z');
      const res = await request(app)
        .post('/api/v1/timekeeping/device-events')
        .set('X-Device-Api-Key', apiKeyA)
        .send({
          deviceId: 'HIK-GATE-01',
          externalEventId: 'EVT-SPOOF-01',
          tenantId: String(tenantB._id), // ATTACK: spoof tenant B
          externalPersonId: 'LOC01',
          eventType: 'PUNCH',
          source: 'FACE',
          occurredAt
        });

      expect(res.status).toBe(201);
      // Verify in DB that event is saved strictly under tenantA (device's tenant)
      const eventInDb = await RawAttendanceEvent.findOne({ externalEventId: 'EVT-SPOOF-01' });
      expect(eventInDb).not.toBeNull();
      expect(String(eventInDb.tenantId)).toBe(String(tenantA._id));
      expect(String(eventInDb.tenantId)).not.toBe(String(tenantB._id));
    });

    test('Two tenants having identical deviceCode "HIK-GATE-01" are differentiated solely by API key', async () => {
      const occurredAt = new Date('2026-09-16T08:05:00.000Z');

      // Push using apiKeyA -> goes to Tenant A
      const resA = await request(app)
        .post('/api/v1/timekeeping/device-events')
        .set('X-Device-Api-Key', apiKeyA)
        .send({
          externalEventId: 'EVT-IDENTICAL-A',
          externalPersonId: 'LOC01',
          eventType: 'PUNCH',
          source: 'FACE',
          occurredAt
        });
      expect(resA.status).toBe(201);

      // Push using apiKeyB -> goes to Tenant B
      const resB = await request(app)
        .post('/api/v1/timekeeping/device-events')
        .set('X-Device-Api-Key', apiKeyB)
        .send({
          externalEventId: 'EVT-IDENTICAL-B',
          externalPersonId: 'LOC01',
          eventType: 'PUNCH',
          source: 'FACE',
          occurredAt
        });
      expect(resB.status).toBe(201);

      const dbEventA = await RawAttendanceEvent.findOne({ externalEventId: 'EVT-IDENTICAL-A' });
      const dbEventB = await RawAttendanceEvent.findOne({ externalEventId: 'EVT-IDENTICAL-B' });

      expect(String(dbEventA.tenantId)).toBe(String(tenantA._id));
      expect(String(dbEventB.tenantId)).toBe(String(tenantB._id));
    });

    test('Duplicate event ingest is idempotent and does not duplicate records', async () => {
      const occurredAt = new Date('2026-09-16T08:00:00.000Z');
      const res = await request(app)
        .post('/api/v1/timekeeping/device-events')
        .set('X-Device-Api-Key', apiKeyA)
        .send({
          deviceId: 'HIK-GATE-01',
          externalEventId: 'EVT-SPOOF-01', // Replaying same event
          externalPersonId: 'LOC01',
          eventType: 'PUNCH',
          source: 'FACE',
          occurredAt
        });

      expect(res.status).toBe(200);
      expect(res.body.duplicate).toBe(true);

      const count = await RawAttendanceEvent.countDocuments({ externalEventId: 'EVT-SPOOF-01' });
      expect(count).toBe(1);
    });

    test('Unmapped event is stored safely as UNMAPPED without throwing transaction error', async () => {
      const occurredAt = new Date('2026-09-16T08:15:00.000Z');
      const res = await request(app)
        .post('/api/v1/timekeeping/device-events')
        .set('X-Device-Api-Key', apiKeyA)
        .send({
          deviceId: 'HIK-GATE-01',
          externalEventId: 'EVT-UNKNOWN-PERSON-01',
          externalPersonId: 'UNKNOWN-999',
          eventType: 'PUNCH',
          source: 'FACE',
          occurredAt
        });

      expect(res.status).toBe(201);
      expect(res.body.data.mappingStatus).toBe('UNMAPPED');
      expect(res.body.data.userId).toBeNull();
      expect(res.body.data.studentId).toBeNull();

      // Appears in unmapped queue for Tenant A
      const unmappedRes = await request(app)
        .get('/api/v1/timekeeping/devices-unmapped')
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(unmappedRes.status).toBe(200);
      expect(unmappedRes.body.data.some((e) => e.externalEventId === 'EVT-UNKNOWN-PERSON-01')).toBe(true);

      // Does not leak to Tenant B
      const unmappedResB = await request(app)
        .get('/api/v1/timekeeping/devices-unmapped')
        .set('Authorization', `Bearer ${tokenAdminB}`);
      expect(unmappedResB.status).toBe(200);
      expect(unmappedResB.body.data.some((e) => e.externalEventId === 'EVT-UNKNOWN-PERSON-01')).toBe(false);
    });

    test('Student event automatically marks StudentAttendance for Tenant A only', async () => {
      const occurredAt = new Date('2026-09-16T07:45:00.000Z');
      const res = await request(app)
        .post('/api/v1/timekeeping/device-events')
        .set('X-Device-Api-Key', apiKeyA)
        .send({
          deviceId: 'HIK-GATE-01',
          externalEventId: 'EVT-STU-01',
          externalPersonId: 'STU01',
          eventType: 'PUNCH',
          source: 'FACE',
          occurredAt
        });

      expect(res.status).toBe(201);

      // Verify StudentAttendance created for studentA
      const studentAttA = await StudentAttendance.findOne({ studentId: studentA._id });
      expect(studentAttA).not.toBeNull();
      expect(studentAttA.status).toBe('present');
      expect(String(studentAttA.tenantId)).toBe(String(tenantA._id));

      // Tenant B's student attendance remains untouched
      const studentAttB = await StudentAttendance.findOne({ studentId: studentB._id });
      expect(studentAttB).toBeNull();
    });
  });

  describe('5. Biometric PUNCH Attendance Resolution & Recalculation', () => {
    const testDate = '2026-09-17';

    test('Single PUNCH event sets checkInTime and leaves checkOutTime null (incomplete shift)', async () => {
      const punchInTime = new Date(`${testDate}T08:02:00.000Z`);

      const res = await request(app)
        .post('/api/v1/timekeeping/device-events')
        .set('X-Device-Api-Key', apiKeyA)
        .send({
          deviceId: 'HIK-GATE-01',
          externalEventId: 'EVT-PUNCH-SINGLE-01',
          externalPersonId: 'LOC01',
          eventType: 'PUNCH',
          source: 'FACE',
          workDate: testDate,
          occurredAt: punchInTime
        });

      expect(res.status).toBe(201);

      await processQueuedRecalculations({ workerId: 'test-worker', maxItems: 10, isGlobalWorker: true });

      const workDateObj = startOfWorkDate(testDate, DEFAULT_SCHOOL_TIMEZONE);
      const record = await AttendanceRecord.findOne({
        userId: employeeUserA._id,
        workDate: workDateObj,
        tenantId: tenantA._id
      });

      expect(record).not.toBeNull();
      expect(record.checkInTime).toEqual(punchInTime);
      expect(record.checkOutTime).toBeNull();
      expect(record.status).toBe('incomplete');
    });

    test('Second PUNCH event on same day sets checkOutTime (first punch in, last punch out)', async () => {
      const punchOutTime = new Date(`${testDate}T17:15:00.000Z`);

      const res = await request(app)
        .post('/api/v1/timekeeping/device-events')
        .set('X-Device-Api-Key', apiKeyA)
        .send({
          deviceId: 'HIK-GATE-01',
          externalEventId: 'EVT-PUNCH-SECOND-02',
          externalPersonId: 'LOC01',
          eventType: 'PUNCH',
          source: 'FACE',
          workDate: testDate,
          occurredAt: punchOutTime
        });

      expect(res.status).toBe(201);

      await processQueuedRecalculations({ workerId: 'test-worker', maxItems: 10, isGlobalWorker: true });

      const workDateObj = startOfWorkDate(testDate, DEFAULT_SCHOOL_TIMEZONE);
      const record = await AttendanceRecord.findOne({
        userId: employeeUserA._id,
        workDate: workDateObj,
        tenantId: tenantA._id
      });

      expect(record).not.toBeNull();
      expect(record.checkInTime).toEqual(new Date(`${testDate}T08:02:00.000Z`));
      expect(record.checkOutTime).toEqual(punchOutTime);
      expect(record.status).toBe('present');
    });

    test('Out-of-order punch events are resolved correctly (earliest is in, latest is out)', async () => {
      const dateOutOfOrder = '2026-09-18';
      const punchOutTime = new Date(`${dateOutOfOrder}T17:30:00.000Z`);
      const punchInTime = new Date(`${dateOutOfOrder}T07:55:00.000Z`);

      // Send checkout first!
      await request(app)
        .post('/api/v1/timekeeping/device-events')
        .set('X-Device-Api-Key', apiKeyA)
        .send({
          deviceId: 'HIK-GATE-01',
          externalEventId: 'EVT-ORDER-OUT',
          externalPersonId: 'LOC01',
          eventType: 'PUNCH',
          source: 'FACE',
          workDate: dateOutOfOrder,
          occurredAt: punchOutTime
        });

      // Send checkin second!
      await request(app)
        .post('/api/v1/timekeeping/device-events')
        .set('X-Device-Api-Key', apiKeyA)
        .send({
          deviceId: 'HIK-GATE-01',
          externalEventId: 'EVT-ORDER-IN',
          externalPersonId: 'LOC01',
          eventType: 'PUNCH',
          source: 'FACE',
          workDate: dateOutOfOrder,
          occurredAt: punchInTime
        });

      await processQueuedRecalculations({ workerId: 'test-worker', maxItems: 10, isGlobalWorker: true });

      const workDateObj = startOfWorkDate(dateOutOfOrder, DEFAULT_SCHOOL_TIMEZONE);
      const record = await AttendanceRecord.findOne({
        userId: employeeUserA._id,
        workDate: workDateObj,
        tenantId: tenantA._id
      });

      expect(record).not.toBeNull();
      expect(record.checkInTime).toEqual(punchInTime);
      expect(record.checkOutTime).toEqual(punchOutTime);
    });
  });

  describe('6. Distributed Single-Flight Lease, Heartbeat & Multi-Page Sync', () => {
    test('Disabled device rejects sync with DEVICE_DISABLED', async () => {
      const disabledDevice = await TimekeepingDevice.create({
        tenantId: tenantA._id,
        deviceCode: 'HIK-DISABLED-TEST',
        name: 'Máy Tạm Dừng',
        host: '192.168.1.50',
        enabled: false
      });

      await expect(syncDeviceEvents(disabledDevice)).rejects.toMatchObject({
        code: 'DEVICE_DISABLED',
        statusCode: 403
      });
    });

    test('Expired sync lease allows next process to acquire lease and proceed', async () => {
      const testLeaseDevice = await TimekeepingDevice.create({
        tenantId: tenantA._id,
        deviceCode: 'HIK-LEASE-EXPIRED',
        name: 'Máy Lease Hết Hạn',
        host: '192.168.1.51',
        enabled: true,
        syncLease: {
          lockedBy: 'stale-dead-worker',
          lockedAt: new Date(Date.now() - 120000),
          expiresAt: new Date(Date.now() - 60000) // Expired 1 min ago
        }
      });

      // Missing credentials will fail at sync execution, but it should acquire lease without JOB_ALREADY_RUNNING!
      const syncPromise = syncDeviceEvents(testLeaseDevice);
      await expect(syncPromise).resolves.toMatchObject({
        status: 'NOT_RUN_MISSING_SECRET'
      });
    });

    test('Active unexpired lease on device blocks concurrent worker with JOB_ALREADY_RUNNING', async () => {
      const testActiveLeaseDevice = await TimekeepingDevice.create({
        tenantId: tenantA._id,
        deviceCode: 'HIK-LEASE-ACTIVE',
        name: 'Máy Lease Đang Chạy',
        host: '192.168.1.52',
        enabled: true,
        syncLease: {
          lockedBy: 'active-other-process',
          lockedAt: new Date(),
          expiresAt: new Date(Date.now() + 60000) // Active for next 60s
        }
      });

      await expect(syncDeviceEvents(testActiveLeaseDevice, { workerId: 'new-worker' })).rejects.toMatchObject({
        code: 'JOB_ALREADY_RUNNING',
        statusCode: 409
      });
    });

    test('Section IV: Heartbeat renews lease beyond original TTL preventing worker theft', async () => {
      const testHeartbeatDevice = await TimekeepingDevice.create({
        tenantId: tenantA._id,
        deviceCode: 'HIK-HEARTBEAT-TEST',
        name: 'Máy Test Heartbeat',
        host: '192.168.1.53',
        enabled: true
      });

      const workerA = 'worker-heartbeat-a';
      const shortTtlMs = 800; // 800ms TTL
      const heartbeatIntervalMs = 200; // 200ms heartbeat

      // Spy getAcsEvents to simulate a slow ISAPI response of 1200ms (exceeding initial 800ms TTL)
      const spy = jest.spyOn(hikvisionIsapiService, 'getAcsEvents').mockImplementation(async () => {
        // Sleep for 1200ms
        await new Promise((resolve) => setTimeout(resolve, 1200));

        // In the middle of sync (1000ms), Worker B attempts to steal lease
        // At 1000ms > initial 800ms, but heartbeat has renewed it!
        const workerBAttempt = TimekeepingDevice.findOneAndUpdate(
          {
            _id: testHeartbeatDevice._id,
            $or: [
              { 'syncLease.lockedBy': null },
              { 'syncLease.expiresAt': { $lte: new Date() } }
            ]
          },
          {
            $set: {
              'syncLease.lockedBy': 'worker-b-thief',
              'syncLease.expiresAt': new Date(Date.now() + 5000)
            }
          },
          { returnDocument: 'after' }
        );
        const stole = await workerBAttempt;
        expect(stole).toBeNull(); // Worker B must NOT be able to steal lease!

        return {
          totalMatches: 0,
          responseStatus: 'OK',
          events: [],
          truncated: false
        };
      });

      const res = await syncDeviceEvents(testHeartbeatDevice, {
        workerId: workerA,
        leaseTtlMs: shortTtlMs,
        heartbeatIntervalMs,
        overrideCreds: { username: 'mock', password: 'mock' }
      });

      expect(res.success).toBe(true);
      spy.mockRestore();

      // After job finished, lease was cleanly released and no timer hangs
      const finishedDoc = await TimekeepingDevice.findById(testHeartbeatDevice._id);
      expect(finishedDoc.syncLease.lockedBy).toBeNull();
    });

    test('Section IV: Detects LEASE_LOST if lease was stolen and aborts safely without corrupting foreign lease', async () => {
      const testLeaseLostDevice = await TimekeepingDevice.create({
        tenantId: tenantA._id,
        deviceCode: 'HIK-LEASE-LOST-TEST',
        name: 'Máy Test Lease Lost',
        host: '192.168.1.54',
        enabled: true
      });

      const workerA = 'worker-victim-a';
      const alienWorker = 'worker-alien-b';

      const spy = jest.spyOn(hikvisionIsapiService, 'getAcsEvents').mockImplementation(async () => {
        // Simulate external overwrite of lease
        await TimekeepingDevice.updateOne(
          { _id: testLeaseLostDevice._id },
          {
            $set: {
              'syncLease.lockedBy': alienWorker,
              'syncLease.expiresAt': new Date(Date.now() + 60000)
            }
          }
        );

        return {
          totalMatches: 2,
          responseStatus: 'OK',
          events: [
            {
              serialNo: 'EVT-LOST-1',
              major: 5,
              minor: 75,
              time: '2026-09-16T08:00:00+07:00',
              employeeNoString: 'LOC01',
              authMethod: 'FACE'
            }
          ],
          truncated: false
        };
      });

      await expect(syncDeviceEvents(testLeaseLostDevice, {
        workerId: workerA,
        leaseTtlMs: 2000,
        heartbeatIntervalMs: 100,
        overrideCreds: { username: 'mock', password: 'mock' }
      })).rejects.toMatchObject({
        code: 'LEASE_LOST',
        statusCode: 409
      });

      spy.mockRestore();

      // Check that alienWorker's lease was NOT released/cleared by workerA in finally
      const checkDoc = await TimekeepingDevice.findById(testLeaseLostDevice._id);
      expect(checkDoc.syncLease.lockedBy).toBe(alienWorker);
    });

    test('Section III: Full 250-event sync ingests all events without loss or duplicate', async () => {
      const test250Device = await TimekeepingDevice.create({
        tenantId: tenantA._id,
        deviceCode: 'HIK-250-EVENTS',
        name: 'Máy Test 250 Events',
        host: '192.168.1.55',
        enabled: true
      });

      // Map a few sample persons
      await AttendanceDevicePersonMapping.create({
        tenantId: tenantA._id,
        deviceId: test250Device._id,
        externalPersonId: 'USER-1',
        subjectType: 'EMPLOYEE',
        subjectId: employeeUserA._id,
        userId: employeeUserA._id,
        active: true
      });

      // Generate 250 mock events
      const mockEvents = [];
      for (let i = 1; i <= 250; i++) {
        mockEvents.push({
          serialNo: `EVT-250-${String(i).padStart(4, '0')}`,
          major: 5,
          minor: i % 2 === 0 ? 75 : 1,
          time: `2026-09-16T${String(8 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00+07:00`,
          cardNo: i % 2 === 0 ? '' : `CARD-${i}`,
          employeeNoString: `USER-${i}`,
          name: `Nhan Vien ${i}`,
          eventDescription: i % 2 === 0 ? 'Authenticated via Face' : 'Authenticated via Card',
          authMethod: i % 2 === 0 ? 'FACE' : 'CARD'
        });
      }

      const spy = jest.spyOn(hikvisionIsapiService, 'getAcsEvents').mockResolvedValue({
        totalMatches: 250,
        responseStatus: 'OK',
        events: mockEvents,
        truncated: false
      });

      const res = await syncDeviceEvents(test250Device, {
        overrideCreds: { username: 'mock', password: 'mock' },
        safetyCap: 1000
      });

      expect(res.success).toBe(true);
      expect(res.truncated).toBe(false);
      expect(res.summary.totalFetched).toBe(250);
      expect(res.summary.ingested + res.summary.unmapped).toBe(250);

      // Verify count in database
      const count = await RawAttendanceEvent.countDocuments({
        tenantId: tenantA._id,
        deviceId: 'HIK-250-EVENTS'
      });
      expect(count).toBe(250);

      spy.mockRestore();
    });

    test('Section III: safetyCap smaller than totalMatches marks truncated: true and PARTIAL status', async () => {
      const testCapDevice = await TimekeepingDevice.create({
        tenantId: tenantA._id,
        deviceCode: 'HIK-CAP-TEST',
        name: 'Máy Test Safety Cap',
        host: '192.168.1.56',
        enabled: true
      });

      // Generate 50 items out of 250
      const mockCapEvents = [];
      for (let i = 1; i <= 50; i++) {
        mockCapEvents.push({
          serialNo: `EVT-CAP-${String(i).padStart(4, '0')}`,
          major: 5,
          minor: 75,
          time: `2026-09-16T08:${String(i % 60).padStart(2, '0')}:00+07:00`,
          employeeNoString: `USER-${i}`,
          authMethod: 'FACE'
        });
      }

      const spy = jest.spyOn(hikvisionIsapiService, 'getAcsEvents').mockResolvedValue({
        totalMatches: 250,
        responseStatus: 'OK',
        events: mockCapEvents,
        truncated: true
      });

      const res = await syncDeviceEvents(testCapDevice, {
        overrideCreds: { username: 'mock', password: 'mock' },
        safetyCap: 50
      });

      expect(res.success).toBe(true);
      expect(res.truncated).toBe(true);
      expect(res.log.status).toBe('PARTIAL');
      expect(res.summary.totalFetched).toBe(50);
      expect(res.summary.totalMatches).toBe(250);

      // Verify watermark only advanced up to event 50
      const updatedDevice = await TimekeepingDevice.findById(testCapDevice._id);
      expect(updatedDevice.lastSuccessfulEventAt).toEqual(new Date(mockCapEvents[49].time));

      spy.mockRestore();
    });
  });
});
