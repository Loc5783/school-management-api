'use strict';

/**
 * Kiểm thử tích hợp toàn diện 4 trụ cột nâng cấp Máy chấm công & Phân quyền:
 * 1. Cầu nối nội bộ `Local LAN Connector (127.0.0.1:18686)` + Gói `.zip` 1 chạm + Phong bì mật khẩu AES-256-GCM.
 * 2. Hỗ trợ đổi Tên miền (Domain) linh hoạt bằng chữ ký bất đối xứng `Ed25519` (không fix cứng domain, không cần cài lại Connector)
 *    + Nút 1 chạm cập nhật địa chỉ `HTTP Listening Webhook` mới xuống máy Hikvision.
 * 3. Khóa an toàn tuyệt đối `deviceSerial <-> campus_id` (`tenantId`): chặn kéo/đẩy/cấu hình chéo phân hiệu & chỉ Kỹ thuật Nhà cung cấp mới mở khóa/chuyển giao được.
 * 4. Thông báo 100% tiếng Việt tự nhiên (không lộ thuật ngữ kỹ thuật thô) & luồng sự kiện thời gian thực cách ly chặt theo trường.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-connector-2026';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';

jest.setTimeout(90000);

const http = require('http');
const zlib = require('zlib');
const request = require('supertest');
const testDbBootstrap = require('../../src/saas/testDbBootstrap');
const createSaasApp = require('../../src/saas/createSaasApp');
const { generateSchoolUserToken } = require('../../src/saas/utils/saasJwt');

const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const SystemSetting = require('../../src/models/zone1_system/SystemSetting');
const Classroom = require('../../src/models/zone3_school/Classroom');
const Student = require('../../src/models/zone3_school/Student');
const StudentAttendance = require('../../src/models/zone3_school/StudentAttendance');
const Employee = require('../../src/models/zone2_hr/Employee');
const TimekeepingDevice = require('../../src/models/zone2_hr/TimekeepingDevice');
const BiometricFaceProfile = require('../../src/models/zone2_hr/BiometricFaceProfile');
const AttendanceDevicePersonMapping = require('../../src/models/zone2_hr/AttendanceDevicePersonMapping');

const { createConnectorHttpServer } = require('../../../local-lan-connector/connector-server');
const {
  translateHardwareErrorToVietnamese,
  formatFriendlyVietnameseHardwareNotice
} = require('../../src/utils/vietnameseHardwareTranslator');

function createValidTinyJpegBuffer(extraLength = 512) {
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const body = Buffer.alloc(extraLength, 0x42);
  const footer = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([header, body, footer]);
}

/**
 * Giải nén tối giản file `.zip` tạo bởi `miniZipBuilder.js` để kiểm tra cấu hình thực tế phát cho máy tính nhà trường.
 */
function extractZipEntriesFromBuffer(zipBuffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= zipBuffer.length) {
    const sig = zipBuffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const method = zipBuffer.readUInt16LE(offset + 8);
    const compressedSize = zipBuffer.readUInt32LE(offset + 18);
    const nameLen = zipBuffer.readUInt16LE(offset + 26);
    const extraLen = zipBuffer.readUInt16LE(offset + 28);
    const name = zipBuffer.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;
    const rawSlice = zipBuffer.subarray(dataStart, dataStart + compressedSize);
    const contentBuf = method === 8 ? zlib.inflateRawSync(rawSlice) : Buffer.from(rawSlice);
    entries.set(name, contentBuf);
    offset = dataStart + compressedSize;
  }
  return entries;
}

/**
 * Gửi HTTP JSON trực tiếp tới `Local LAN Connector (127.0.0.1)` mô phỏng trình duyệt tại trường.
 */
function callLocalConnector(port, { method = 'POST', path = '/health', origin = '', grantToken = '', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const headers = { Accept: 'application/json' };
    if (origin) headers.Origin = origin;
    if (grantToken) headers['X-Connector-Grant'] = grantToken;
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = payload.length;
    }
    const req = http.request(
      { hostname: '127.0.0.1', port, method, path, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = {};
          try {
            json = JSON.parse(text);
          } catch {
            json = { raw: text };
          }
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('Local LAN Connector (127.0.0.1), Dynamic Domain Ed25519, Campus Serial Lock & Vietnamese Realtime Suite', () => {
  let bootstrapInstance;
  let app;
  let mockHikServer;
  let mockHikPort;
  let connectorServer;
  let connectorPort;

  let currentMockHardwareSerial = 'DS-K1T320MFWX-CAMPUS-A-001';
  const mockHardwareUsers = new Map();
  const mockHardwareFaces = new Map();
  let lastConfiguredHttpHostXml = '';

  let tenantA;
  let tenantB;
  let adminUserA;
  let adminUserB;
  let tokenCampusAdminA;
  let tokenCampusAdminB;
  let tokenVendorOnCampusA;

  let classroomA;
  let studentA;
  let employeeA;
  let lockedDeviceAId;

  beforeAll(async () => {
    // 1. Khởi tạo Mock Hikvision ISAPI Server
    mockHikServer = http.createServer((req, res) => {
      const auth = req.headers.authorization || '';
      if (!auth.startsWith('Digest ')) {
        res.writeHead(401, {
          'WWW-Authenticate': 'Digest realm="DS-K1T320MX", nonce="connectorlocknonce88", qop="auth", opaque="opaque88"'
        });
        return res.end();
      }
      if (!auth.includes('username="admin"')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ statusCode: 4, statusString: 'Invalid Operation' }));
      }

      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const rawBuf = Buffer.concat(chunks);
        const bodyText = rawBuf.toString('utf8');

        if (req.method === 'GET' && req.url === '/ISAPI/System/deviceInfo') {
          res.writeHead(200, { 'Content-Type': 'application/xml' });
          return res.end(`<?xml version="1.0" encoding="UTF-8"?>
<DeviceInfo>
  <deviceName>Cong Phan Hieu A</deviceName>
  <model>DS-K1T320MFWX</model>
  <serialNumber>${currentMockHardwareSerial}</serialNumber>
  <macAddress>aa:bb:cc:dd:ee:01</macAddress>
</DeviceInfo>`);
        }

        if (req.method === 'GET' && req.url.startsWith('/ISAPI/AccessControl/UserInfo/Count')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ UserInfoCount: { userNumber: mockHardwareUsers.size } }));
        }

        if (req.method === 'GET' && req.url.startsWith('/ISAPI/Intelligent/FDLib/Count')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ FDRecordDataInfo: [{ recordDataNumber: mockHardwareFaces.size }] }));
        }

        if (req.method === 'GET' && req.url.startsWith('/ISAPI/AccessControl/UserInfo/capabilities')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ UserInfo: { maxRecordNum: 500 } }));
        }

        if (req.method === 'POST' && req.url.startsWith('/ISAPI/AccessControl/UserInfo/Search')) {
          const all = Array.from(mockHardwareUsers.values());
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(
            JSON.stringify({
              UserInfoSearch: {
                searchID: '1',
                responseStatusStrg: 'OK',
                totalMatches: all.length,
                UserInfo: all
              }
            })
          );
        }

        if (
          (req.method === 'POST' || req.method === 'PUT') &&
          (req.url.startsWith('/ISAPI/AccessControl/UserInfo/Record') ||
            req.url.startsWith('/ISAPI/AccessControl/UserInfo/Modify') ||
            req.url.startsWith('/ISAPI/AccessControl/UserInfo/SetUp'))
        ) {
          const parsed = JSON.parse(bodyText);
          const u = parsed.UserInfo;
          mockHardwareUsers.set(u.employeeNo, {
            employeeNo: u.employeeNo,
            name: u.name,
            userType: 'normal',
            numOfCard: 0,
            numOfFace: mockHardwareFaces.has(u.employeeNo) ? 1 : 0,
            faceURL: mockHardwareFaces.has(u.employeeNo) ? `/LOCALS/pic/${u.employeeNo}.jpg` : ''
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ statusCode: 1, statusString: 'OK' }));
        }

        if (req.method === 'PUT' && req.url.startsWith('/ISAPI/Intelligent/FDLib/FDSetUp')) {
          const fpidMatch = bodyText.match(/"FPID"\s*:\s*"([^"]+)"/);
          const fpid = fpidMatch ? fpidMatch[1] : 'UNKNOWN';
          const jpegStart = rawBuf.indexOf(Buffer.from([0xff, 0xd8]));
          const jpegEnd = rawBuf.lastIndexOf(Buffer.from([0xff, 0xd9]));
          if (jpegStart !== -1 && jpegEnd !== -1) {
            mockHardwareFaces.set(fpid, rawBuf.subarray(jpegStart, jpegEnd + 2));
            const u = mockHardwareUsers.get(fpid);
            if (u) {
              u.numOfFace = 1;
              u.faceURL = `/LOCALS/pic/${fpid}.jpg`;
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ statusCode: 1, statusString: 'OK' }));
        }

        if (req.method === 'GET' && req.url.startsWith('/LOCALS/pic/')) {
          const code = req.url.replace('/LOCALS/pic/', '').replace('.jpg', '');
          const img = mockHardwareFaces.get(code) || createValidTinyJpegBuffer(400);
          res.writeHead(200, { 'Content-Type': 'image/jpeg' });
          return res.end(img);
        }

        if (req.method === 'POST' && req.url.startsWith('/ISAPI/AccessControl/AcsEvent')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(
            JSON.stringify({
              AcsEvent: {
                searchID: '1',
                totalMatches: 1,
                responseStatusStrg: 'OK',
                InfoList: [
                  {
                    major: 5,
                    minor: 75,
                    time: '2026-11-28T07:42:00+07:00',
                    employeeNoString: 'HS-CA-01',
                    name: 'Be Nguyen Minh Khoi',
                    serialNo: 'EVT-CONNECTOR-101'
                  }
                ]
              }
            })
          );
        }

        if (req.method === 'PUT' && req.url.startsWith('/ISAPI/Event/notification/httpHosts/')) {
          lastConfiguredHttpHostXml = bodyText;
          res.writeHead(200, { 'Content-Type': 'application/xml' });
          return res.end('<ResponseStatus><statusCode>1</statusCode><statusString>OK</statusString></ResponseStatus>');
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Not Found' }));
      });
    });

    await new Promise((resolve) => {
      mockHikServer.listen(0, '127.0.0.1', () => {
        mockHikPort = mockHikServer.address().port;
        resolve();
      });
    });

    // 2. Khởi tạo Test DB & SaaS App
    bootstrapInstance = await testDbBootstrap.startTestDb({
      instanceOpts: [{ dbName: 'school_local_connector_campus_lock_test' }]
    });
    app = createSaasApp({
      mongoUri: bootstrapInstance.uri,
      connection: bootstrapInstance.connection,
      saasMode: 'phase1e'
    });

    await Promise.all([
      Tenant.syncIndexes(),
      User.syncIndexes(),
      SystemSetting.syncIndexes(),
      Classroom.syncIndexes(),
      Student.syncIndexes(),
      StudentAttendance.syncIndexes(),
      Employee.syncIndexes(),
      TimekeepingDevice.syncIndexes(),
      BiometricFaceProfile.syncIndexes(),
      AttendanceDevicePersonMapping.syncIndexes()
    ]);

    // 3. Khởi tạo 2 Phân hiệu độc lập (Campus A & Campus B)
    tenantA = await Tenant.create({
      code: 'HOANANG-CA',
      name: 'Mầm non Hoa Nắng - Phân hiệu A',
      status: 'active',
      campuses: [{ code: 'CA1', name: 'Phân hiệu A', isActive: true }]
    });
    tenantB = await Tenant.create({
      code: 'HOANANG-CB',
      name: 'Mầm non Hoa Nắng - Phân hiệu B',
      status: 'active',
      campuses: [{ code: 'CB1', name: 'Phân hiệu B', isActive: true }]
    });

    adminUserA = await User.create({
      tenantId: tenantA._id,
      username: 'admin_ca',
      passwordHash: 'hashed-pw',
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Quản trị Phân hiệu A' }
    });
    adminUserB = await User.create({
      tenantId: tenantB._id,
      username: 'admin_cb',
      passwordHash: 'hashed-pw',
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Quản trị Phân hiệu B' }
    });

    tokenCampusAdminA = generateSchoolUserToken(adminUserA, tenantA);
    tokenCampusAdminB = generateSchoolUserToken(adminUserB, tenantB);
    tokenVendorOnCampusA = generateSchoolUserToken(adminUserA, tenantA, '8h', {
      isVendorSupport: true,
      vendorUsername: 'superadmin_vendor'
    });

    classroomA = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Mẫu giáo lớn A1',
      campus: 'Phân hiệu A',
      ageGroup: '4-5',
      status: 'active'
    });

    studentA = await Student.create({
      tenantId: tenantA._id,
      studentCode: 'HS-CA-01',
      fullName: 'Bé Nguyễn Minh Khôi',
      birthDate: new Date('2021-05-10'),
      gender: 'male',
      classroomId: classroomA._id,
      className: classroomA.name,
      status: 'enrolled'
    });

    employeeA = await Employee.create({
      tenantId: tenantA._id,
      employeeCode: 'GV-CA-01',
      fullName: 'Cô Phạm Thu Hà',
      campus: 'Phân hiệu A',
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active'
    });
  });

  afterAll(async () => {
    if (connectorServer) {
      await new Promise((resolve) => connectorServer.close(resolve));
    }
    if (mockHikServer) {
      await new Promise((resolve) => mockHikServer.close(resolve));
    }
    if (bootstrapInstance) {
      await bootstrapInstance.stop();
    }
  });

  test('1. Tải gói .zip 1 chạm không fix cứng domain & Xác thực Ed25519 đa tên miền không cần cài lại Connector', async () => {
    const zipRes = await request(app)
      .get('/api/v1/timekeeping/connector-package')
      .set('Authorization', `Bearer ${tokenCampusAdminA}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(zipRes.status).toBe(200);
    expect(zipRes.headers['content-type']).toContain('application/zip');
    expect(zipRes.body.readUInt32LE(0)).toBe(0x04034b50);

    const files = extractZipEntriesFromBuffer(zipRes.body);
    expect(files.has('HoaNangConnector/connector-server.js')).toBe(true);
    expect(files.has('HoaNangConnector/connector-config.json')).toBe(true);
    expect(files.has('HoaNangConnector/1-Bat-Ket-Noi-1-Cham.bat')).toBe(true);

    const extractedCfgText = files.get('HoaNangConnector/connector-config.json').toString('utf8');
    expect(extractedCfgText.toLowerCase()).not.toContain('chaosin3d.io.vn');

    const extractedCfg = JSON.parse(extractedCfgText);
    expect(extractedCfg.publicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(extractedCfg.envelopeSecretHex).toHaveLength(64);

    // Đảm bảo SystemSetting không bao giờ rò rỉ khóa bí mật ra JSON API
    const sysDoc = await SystemSetting.findOne({ key: 'GLOBAL_CONFIG' });
    expect(sysDoc).toBeTruthy();
    expect(JSON.stringify(sysDoc.toJSON())).not.toContain('privateKeyPem');

    // Bật Local LAN Connector thực tế từ chính config giải nén trong gói .zip
    connectorServer = createConnectorHttpServer({
      ...extractedCfg,
      _allowLoopbackForTesting: true
    });
    await new Promise((resolve) => {
      connectorServer.listen(0, '127.0.0.1', () => {
        connectorPort = connectorServer.address().port;
        resolve();
      });
    });

    // Kiểm tra CORS Private Network Access preflight cho Chrome HTTPS -> http://127.0.0.1
    const preflightRes = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: connectorPort,
          method: 'OPTIONS',
          path: '/device/pull',
          headers: {
            Origin: 'https://ten-mien-moi.edu.vn',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Private-Network': 'true'
          }
        },
        (res) => resolve({ status: res.statusCode, headers: res.headers })
      );
      req.on('error', reject);
      req.end();
    });
    expect(preflightRes.status).toBe(204);
    expect(preflightRes.headers['access-control-allow-private-network']).toBe('true');

    // Xin Grant ở Tên miền cũ (Domain 1)
    const grantDomain1 = await request(app)
      .post('/api/v1/timekeeping/connector-grant')
      .set('Authorization', `Bearer ${tokenCampusAdminA}`)
      .set('Host', 'domain-cu-2026.vn')
      .set('Origin', 'https://domain-cu-2026.vn')
      .send({ clientOrigin: 'https://domain-cu-2026.vn' });

    expect(grantDomain1.status).toBe(200);
    expect(grantDomain1.body.data.webhookUrl).toBe('https://domain-cu-2026.vn/api/attendance/webhook/HOANANG-CA');

    const inspectDomain1 = await callLocalConnector(connectorPort, {
      method: 'POST',
      path: '/device/inspect',
      origin: 'https://domain-cu-2026.vn',
      grantToken: grantDomain1.body.data.grantToken,
      body: {
        device: { host: '127.0.0.1', port: mockHikPort, username: 'admin', password: 'hik-secret-password' }
      }
    });
    expect(inspectDomain1.status).toBe(200);
    expect(inspectDomain1.body.data.serialNumber).toBe('DS-K1T320MFWX-CAMPUS-A-001');

    // Đổi sang Tên miền hoàn toàn mới (Domain 2) — KHÔNG khởi động lại Connector, KHÔNG đổi connector-config.json
    const grantDomain2 = await request(app)
      .post('/api/v1/timekeeping/connector-grant')
      .set('Authorization', `Bearer ${tokenCampusAdminA}`)
      .set('Host', 'mamnon-hoanang-cloud.edu.vn')
      .set('Origin', 'https://mamnon-hoanang-cloud.edu.vn')
      .send({ clientOrigin: 'https://mamnon-hoanang-cloud.edu.vn' });

    expect(grantDomain2.status).toBe(200);
    expect(grantDomain2.body.data.webhookUrl).toBe(
      'https://mamnon-hoanang-cloud.edu.vn/api/attendance/webhook/HOANANG-CA'
    );

    const inspectDomain2 = await callLocalConnector(connectorPort, {
      method: 'POST',
      path: '/device/inspect',
      origin: 'https://mamnon-hoanang-cloud.edu.vn',
      grantToken: grantDomain2.body.data.grantToken,
      body: {
        device: { host: '127.0.0.1', port: mockHikPort, username: 'admin', password: 'hik-secret-password' }
      }
    });
    expect(inspectDomain2.status).toBe(200);
    expect(inspectDomain2.body.data.serialNumber).toBe('DS-K1T320MFWX-CAMPUS-A-001');

    // Chặn giả mạo Origin khác với Grant Token đã ký
    const spoofedOriginCall = await callLocalConnector(connectorPort, {
      method: 'POST',
      path: '/device/inspect',
      origin: 'https://trang-gia-mao.evil.com',
      grantToken: grantDomain2.body.data.grantToken,
      body: {
        device: { host: '127.0.0.1', port: mockHikPort, username: 'admin', password: 'hik-secret-password' }
      }
    });
    expect(spoofedOriginCall.status).toBe(403);
    expect(spoofedOriginCall.body.code).toBe('CONNECTOR_ORIGIN_MISMATCH');
  });

  test('2. Khóa chặt deviceSerial theo Phân hiệu & Đồng bộ 2 chiều (Push/Pull) qua Local Connector 127.0.0.1', async () => {
    // Gắn ảnh chân dung chuẩn < 200KB cho học sinh Phân hiệu A
    const uploadFaceRes = await request(app)
      .put(`/api/v1/timekeeping/biometric-faces/STUDENT/${studentA._id}`)
      .set('Authorization', `Bearer ${tokenCampusAdminA}`)
      .send({
        imageBase64: `data:image/jpeg;base64,${createValidTinyJpegBuffer(600).toString('base64')}`,
        source: 'UPLOAD'
      });
    expect(uploadFaceRes.status).toBe(200);

    // Phân hiệu A đăng ký máy chấm công và khóa chặt Serial
    const createRes = await request(app)
      .post('/api/v1/timekeeping/devices')
      .set('Authorization', `Bearer ${tokenCampusAdminA}`)
      .send({
        deviceCode: 'HIK-CA-GATE1',
        name: 'Máy Cổng Chính Phân hiệu A',
        campus: 'Phân hiệu A',
        serialNumber: 'DS-K1T320MFWX-CAMPUS-A-001',
        host: '192.168.1.50',
        transportScheme: 'http',
        httpPort: 80,
        deviceUsername: 'admin',
        devicePassword: 'hik-secret-password'
      });

    expect(createRes.status).toBe(201);
    lockedDeviceAId = createRes.body.data._id;

    // Trỏ thiết bị vào Mock Hikvision Loopback Server trong môi trường test
    await TimekeepingDevice.updateOne(
      { _id: lockedDeviceAId },
      { $set: { host: '127.0.0.1', httpPort: mockHikPort, transportScheme: 'http' } }
    );

    // Phân hiệu B cố tình đăng ký trùng Serial phần cứng của Phân hiệu A -> Bị chặn đứng 409 với tiếng Việt tự nhiên!
    const crossCampusCreate = await request(app)
      .post('/api/v1/timekeeping/devices')
      .set('Authorization', `Bearer ${tokenCampusAdminB}`)
      .send({
        deviceCode: 'HIK-CB-STEAL',
        name: 'Máy Phân hiệu B thêm nhầm',
        campus: 'Phân hiệu B',
        serialNumber: 'DS-K1T320MFWX-CAMPUS-A-001',
        host: '192.168.1.99',
        transportScheme: 'http',
        httpPort: 80,
        deviceUsername: 'admin',
        devicePassword: '123'
      });

    expect(crossCampusCreate.status).toBe(409);
    expect(crossCampusCreate.body.code).toBe('SERIAL_LOCKED_OTHER_CAMPUS');
    expect(crossCampusCreate.body.message).toContain('khóa bảo mật cho một phân hiệu trường khác');

    // Phân hiệu B quét mạng LAN thấy máy của Phân hiệu A -> API enrich đánh dấu khóa rõ ràng
    const enrichResB = await request(app)
      .post('/api/v1/timekeeping/devices/connector-enrich-scan')
      .set('Authorization', `Bearer ${tokenCampusAdminB}`)
      .send({
        devices: [
          {
            ip: '192.168.1.50',
            port: 80,
            model: 'DS-K1T320MFWX',
            serialNumber: 'DS-K1T320MFWX-CAMPUS-A-001',
            authVerified: true
          }
        ]
      });
    expect(enrichResB.status).toBe(200);
    expect(enrichResB.body.data.discoveredDevices[0].lockedToOtherCampus).toBe(true);
    expect(enrichResB.body.data.discoveredDevices[0].alreadySaved).toBe(false);

    // Phân hiệu A thực hiện ĐẨY (Push) danh sách & khuôn mặt <200KB từ Web xuống máy qua Local Connector
    const prepPush = await request(app)
      .post(`/api/v1/timekeeping/devices/${lockedDeviceAId}/connector-prepare`)
      .set('Authorization', `Bearer ${tokenCampusAdminA}`)
      .set('Host', 'mamnon-hoanang-cloud.edu.vn')
      .set('Origin', 'https://mamnon-hoanang-cloud.edu.vn')
      .send({ operation: 'push', clientOrigin: 'https://mamnon-hoanang-cloud.edu.vn' });

    expect(prepPush.status).toBe(200);
    // Đảm bảo mật khẩu thô không bao giờ nằm trong response gửi về trình duyệt
    expect(JSON.stringify(prepPush.body.data.device)).not.toContain('hik-secret-password');
    expect(prepPush.body.data.targets.length).toBeGreaterThanOrEqual(2);

    const connectorPush = await callLocalConnector(connectorPort, {
      method: 'POST',
      path: '/device/push',
      origin: 'https://mamnon-hoanang-cloud.edu.vn',
      grantToken: prepPush.body.data.grantToken,
      body: {
        device: prepPush.body.data.device,
        encryptedDeviceAuth: prepPush.body.data.encryptedDeviceAuth,
        expectedSerial: prepPush.body.data.expectedSerial,
        targets: prepPush.body.data.targets,
        fastDelta: true
      }
    });
    expect(connectorPush.status).toBe(200);
    expect(connectorPush.body.data.syncedUsers).toBe(2);
    expect(connectorPush.body.data.syncedFaces).toBe(1);
    expect(mockHardwareUsers.has('HS-CA-01')).toBe(true);
    expect(mockHardwareFaces.has('HS-CA-01')).toBe(true);

    const completePush = await request(app)
      .post(`/api/v1/timekeeping/devices/${lockedDeviceAId}/connector-complete-push`)
      .set('Authorization', `Bearer ${tokenCampusAdminA}`)
      .send(connectorPush.body.data);
    expect(completePush.status).toBe(200);
    expect(completePush.body.message).toContain('Đã đồng bộ thành công');

    // Bổ sung 1 nhân sự đã có trên Web (GV-CA-01) VÀ 1 nhân sự mới chỉ đăng ký trực tiếp trên máy (ID "77" - Co Le Minh Anh)
    mockHardwareUsers.set('GV-CA-01', {
      employeeNo: 'GV-CA-01',
      name: 'Co Pham Thu Ha',
      userType: 'normal',
      numOfFace: 1,
      faceURL: '/LOCALS/pic/GV-CA-01.jpg'
    });
    mockHardwareFaces.set('GV-CA-01', createValidTinyJpegBuffer(520));

    mockHardwareUsers.set('77', {
      employeeNo: '77',
      name: 'Co Le Minh Anh',
      userType: 'normal',
      numOfFace: 1,
      faceURL: '/LOCALS/pic/77.jpg'
    });
    mockHardwareFaces.set('77', createValidTinyJpegBuffer(610));

    const prepPull = await request(app)
      .post(`/api/v1/timekeeping/devices/${lockedDeviceAId}/connector-prepare`)
      .set('Authorization', `Bearer ${tokenCampusAdminA}`)
      .set('Host', 'mamnon-hoanang-cloud.edu.vn')
      .set('Origin', 'https://mamnon-hoanang-cloud.edu.vn')
      .send({ operation: 'pull', clientOrigin: 'https://mamnon-hoanang-cloud.edu.vn' });
    expect(prepPull.status).toBe(200);

    const connectorPull = await callLocalConnector(connectorPort, {
      method: 'POST',
      path: '/device/pull',
      origin: 'https://mamnon-hoanang-cloud.edu.vn',
      grantToken: prepPull.body.data.grantToken,
      body: {
        device: prepPull.body.data.device,
        encryptedDeviceAuth: prepPull.body.data.encryptedDeviceAuth,
        expectedSerial: prepPull.body.data.expectedSerial
      }
    });
    expect(connectorPull.status).toBe(200);
    expect(connectorPull.body.data.users.length).toBeGreaterThanOrEqual(3);
    expect(connectorPull.body.data.events.length).toBe(1);

    const ingestPull = await request(app)
      .post(`/api/v1/timekeeping/devices/${lockedDeviceAId}/connector-ingest-pull`)
      .set('Authorization', `Bearer ${tokenCampusAdminA}`)
      .send(connectorPull.body.data);
    expect(ingestPull.status).toBe(200);
    expect(ingestPull.body.data.pulledFaceCount).toBeGreaterThanOrEqual(1);

    // Kiểm tra biometric-overview trả về đầy đủ danh sách hồ sơ đang lưu trong máy (deviceStoredPeople)
    const overviewBeforeImport = await request(app)
      .get('/api/v1/timekeeping/biometric-overview')
      .set('Authorization', `Bearer ${tokenCampusAdminA}`);
    expect(overviewBeforeImport.status).toBe(200);
    const stored77 = overviewBeforeImport.body.data.deviceStoredPeople.find((x) => x.externalPersonId === '77');
    expect(stored77).toBeTruthy();
    expect(stored77.nameOnDevice).toBe('Co Le Minh Anh');
    expect(stored77.faceDataUrl).toContain('data:image/jpeg;base64,');
    expect(stored77.isMatchedOnWeb).toBe(false);

    // Bấm 1 chạm "Lấy Ảnh & Tên từ máy về Web" cho ID "77" -> Tự động lưu cả Họ tên + Ảnh khuôn mặt vào danh sách Web!
    const importRes = await request(app)
      .post(`/api/v1/timekeeping/devices/${lockedDeviceAId}/import-to-web`)
      .set('Authorization', `Bearer ${tokenCampusAdminA}`)
      .send({ externalPersonIds: ['77'] });
    expect(importRes.status).toBe(200);
    expect(importRes.body.data.importedNewCount).toBe(1);
    expect(importRes.body.data.savedFacesCount).toBe(1);

    const overviewAfterImport = await request(app)
      .get('/api/v1/timekeeping/biometric-overview')
      .set('Authorization', `Bearer ${tokenCampusAdminA}`);
    expect(overviewAfterImport.status).toBe(200);
    const stored77After = overviewAfterImport.body.data.deviceStoredPeople.find((x) => x.externalPersonId === '77');
    expect(stored77After.isMatchedOnWeb).toBe(true);
    const importedInRoster = overviewAfterImport.body.data.roster.find((x) => x.fullName === 'Co Le Minh Anh');
    expect(importedInRoster).toBeTruthy();
    expect(importedInRoster.hasBiometricFace).toBe(true);
    expect(importedInRoster.isOnDevice).toBe(true);
    expect(ingestPull.body.data.eventsIngested).toBe(1);

    const attRecord = await StudentAttendance.findOne({ tenantId: tenantA._id, studentId: studentA._id }).lean();
    expect(attRecord).toBeTruthy();

    // GIẢ LẬP CẮM NHẦM DÂY MẠNG / TRÙNG IP VỚI MÁY CHẤM CÔNG CỦA PHÂN HIỆU KHÁC:
    // Connector phải phát hiện lệch Serial phần cứng và chặn đứng trước khi Kéo hoặc Đẩy!
    currentMockHardwareSerial = 'DS-K1T320MFWX-WRONG-FOREIGN-999';
    try {
      const blockedWrongMachinePull = await callLocalConnector(connectorPort, {
        method: 'POST',
        path: '/device/pull',
        origin: 'https://mamnon-hoanang-cloud.edu.vn',
        grantToken: prepPull.body.data.grantToken,
        body: {
          device: prepPull.body.data.device,
          encryptedDeviceAuth: prepPull.body.data.encryptedDeviceAuth,
          expectedSerial: prepPull.body.data.expectedSerial
        }
      });
      expect(blockedWrongMachinePull.status).toBe(409);
      expect(blockedWrongMachinePull.body.code).toBe('HARDWARE_SERIAL_MISMATCH');
      expect(blockedWrongMachinePull.body.message).toContain('không khớp với máy đã khóa cho phân hiệu của bạn');
    } finally {
      currentMockHardwareSerial = 'DS-K1T320MFWX-CAMPUS-A-001';
    }
  });

  test('3. Nút 1 chạm cập nhật địa chỉ HTTP Listening Webhook theo tên miền động mới xuống máy Hikvision', async () => {
    const newDomainOrigin = 'https://hethong-mamnon-2027.vn';
    const prepWebhook = await request(app)
      .post(`/api/v1/timekeeping/devices/${lockedDeviceAId}/connector-prepare`)
      .set('Authorization', `Bearer ${tokenCampusAdminA}`)
      .set('Host', 'hethong-mamnon-2027.vn')
      .set('Origin', newDomainOrigin)
      .send({ operation: 'configure-webhook', clientOrigin: newDomainOrigin });

    expect(prepWebhook.status).toBe(200);
    expect(prepWebhook.body.data.webhookUrl).toBe('https://hethong-mamnon-2027.vn/api/attendance/webhook/HOANANG-CA');

    const connectorWebhook = await callLocalConnector(connectorPort, {
      method: 'POST',
      path: '/device/configure-webhook',
      origin: newDomainOrigin,
      grantToken: prepWebhook.body.data.grantToken,
      body: {
        device: prepWebhook.body.data.device,
        encryptedDeviceAuth: prepWebhook.body.data.encryptedDeviceAuth,
        expectedSerial: prepWebhook.body.data.expectedSerial,
        webhookUrl: prepWebhook.body.data.webhookUrl
      }
    });
    expect(connectorWebhook.status).toBe(200);
    expect(lastConfiguredHttpHostXml).toContain('<hostName>hethong-mamnon-2027.vn</hostName>');
    expect(lastConfiguredHttpHostXml).toContain('<url>/api/attendance/webhook/HOANANG-CA</url>');
    expect(lastConfiguredHttpHostXml).toContain('<protocolType>HTTPS</protocolType>');

    const saveWebhook = await request(app)
      .post(`/api/v1/timekeeping/devices/${lockedDeviceAId}/configure-webhook`)
      .set('Authorization', `Bearer ${tokenCampusAdminA}`)
      .set('Host', 'hethong-mamnon-2027.vn')
      .set('Origin', newDomainOrigin)
      .send({
        clientOrigin: newDomainOrigin,
        connectorAppliedResult: connectorWebhook.body.data
      });

    expect(saveWebhook.status).toBe(200);
    expect(saveWebhook.body.data.webhookUrl).toBe('https://hethong-mamnon-2027.vn/api/attendance/webhook/HOANANG-CA');

    const updatedDev = await TimekeepingDevice.findById(lockedDeviceAId).lean();
    expect(updatedDev.webhookConfiguredUrl).toBe('https://hethong-mamnon-2027.vn/api/attendance/webhook/HOANANG-CA');
  });

  test('4. Phân quyền mở khóa Serial (chỉ Kỹ thuật Nhà cung cấp), Dịch tiếng Việt 100% & Luồng thời gian thực cách ly theo trường', async () => {
    // Kiểm tra bộ dịch tiếng Việt tự nhiên — tuyệt đối không để lọt lỗi kỹ thuật thô
    const rawTechCases = [
      new Error("ENOENT: no such file or directory, open '/local-lan-connector/connector-server.js'"),
      new Error('connect ETIMEDOUT 192.168.1.200:80'),
      Object.assign(new Error('Digest 401 Unauthorized'), { code: 'DEVICE_AUTH_FAILED' }),
      Object.assign(new Error('CORS Network Error Failed to fetch http://127.0.0.1:18686'), { code: 'CONNECTOR_NOT_RUNNING' }),
      Object.assign(new Error('Invalid subnet regex pattern'), { code: 'INVALID_SUBNET_PREFIX' }),
      Object.assign(new Error('FDSetUp subStatusCode faceQualityLow'), { code: 'FACE_QUALITY_LOW' })
    ];

    for (const errCase of rawTechCases) {
      const vi = translateHardwareErrorToVietnamese(errCase);
      const fullText = formatFriendlyVietnameseHardwareNotice(errCase);
      expect(fullText.length).toBeGreaterThan(20);
      expect(vi.nextStepHint.length).toBeGreaterThan(10);
      expect(fullText).not.toMatch(/ENOENT|no such file|CORS|Digest\s*401|ETIMEDOUT|ECONNREFUSED|subnet|regex|ISAPI|Failed to fetch/i);
    }

    // Webhook điểm danh trực tiếp tại cổng Phân hiệu A:
    // 1) Chặn đứng nếu máy gửi sự kiện có Serial thuộc Phân hiệu khác
    await TimekeepingDevice.create({
      tenantId: tenantB._id,
      deviceCode: 'HIK-CB-GATE1',
      name: 'Máy Cổng Phân hiệu B',
      campus: 'Phân hiệu B',
      host: '192.168.2.88',
      serialNumber: 'DS-K1T320MFWX-CAMPUS-B-888'
    });

    const foreignWebhookAttempt = await request(app)
      .post('/api/attendance/webhook/HOANANG-CA')
      .send({
        AccessControllerEvent: {
          deviceName: 'May la',
          shortSerialNumber: 'DS-K1T320MFWX-CAMPUS-B-888',
          majorEventType: 5,
          subEventType: 75,
          employeeNoString: 'HS-CA-01',
          name: 'Be Nguyen Minh Khoi'
        },
        dateTime: '2026-11-28T07:55:00+07:00'
      });
    // Trả 200 để phần cứng Hikvision không retry treo hàng đợi, nhưng chặn ghi dữ liệu chéo trường 100%
    expect(foreignWebhookAttempt.status).toBe(200);
    expect(foreignWebhookAttempt.body.crossCampusSerialBlocked).toBe(true);
    expect(foreignWebhookAttempt.body.persisted).toBe(false);
    expect(foreignWebhookAttempt.body.attendanceResult?.status).toBe('BLOCKED_CROSS_CAMPUS_SERIAL');

    // 2) Máy đúng của Phân hiệu A quét mặt bé -> phát thông báo tiếng Việt tự nhiên CHỈ cho Phân hiệu A
    const validGateScan = await request(app)
      .post('/api/attendance/webhook/HOANANG-CA')
      .send({
        AccessControllerEvent: {
          deviceName: 'Cong Chinh Phan hieu A',
          shortSerialNumber: 'DS-K1T320MFWX-CAMPUS-A-001',
          majorEventType: 5,
          subEventType: 75,
          employeeNoString: 'HS-CA-01',
          name: 'Be Nguyen Minh Khoi'
        },
        dateTime: '2026-11-28T08:01:00+07:00'
      });
    expect(validGateScan.status).toBe(200);

    const liveEventsA = await request(app)
      .get('/api/v1/timekeeping/live-events')
      .set('Authorization', `Bearer ${tokenCampusAdminA}`);
    expect(liveEventsA.status).toBe(200);
    const scanNoticeA = liveEventsA.body.data.find((e) => e.type === 'STUDENT_GATE_SCAN');
    expect(scanNoticeA).toBeTruthy();
    expect(scanNoticeA.message).toContain('Bé Nguyễn Minh Khôi');
    expect(scanNoticeA.message).toContain('quét khuôn mặt');

    // Phân hiệu B tuyệt đối KHÔNG thấy thông báo thời gian thực của Phân hiệu A
    const liveEventsB = await request(app)
      .get('/api/v1/timekeeping/live-events')
      .set('Authorization', `Bearer ${tokenCampusAdminB}`);
    expect(liveEventsB.status).toBe(200);
    expect(liveEventsB.body.data.some((e) => e.message?.includes('Bé Nguyễn Minh Khôi'))).toBe(false);

    // Kiểm tra Phân quyền Mở khóa / Chuyển giao `deviceSerial`:
    // - Admin Phân hiệu A cố tình tự sửa Serial hoặc gọi API mở khóa -> Bị từ chối 403!
    const adminEditSerial = await request(app)
      .patch(`/api/v1/timekeeping/devices/${lockedDeviceAId}`)
      .set('Authorization', `Bearer ${tokenCampusAdminA}`)
      .send({ serialNumber: 'DS-HACK-NEW-SERIAL' });
    expect(adminEditSerial.status).toBe(403);
    expect(adminEditSerial.body.code).toBe('SERIAL_UNLOCK_VENDOR_ONLY');

    const adminUnlockAttempt = await request(app)
      .post(`/api/v1/timekeeping/devices/${lockedDeviceAId}/unlock-serial`)
      .set('Authorization', `Bearer ${tokenCampusAdminA}`)
      .send({ action: 'unlock' });
    expect(adminUnlockAttempt.status).toBe(403);
    expect(adminUnlockAttempt.body.code).toBe('SERIAL_UNLOCK_VENDOR_ONLY');

    // - Kỹ thuật viên Nhà cung cấp (`isVendorSupport: true`) được phép điều chuyển máy vật lý sang Phân hiệu B!
    const vendorTransfer = await request(app)
      .post(`/api/v1/timekeeping/devices/${lockedDeviceAId}/unlock-serial`)
      .set('Authorization', `Bearer ${tokenVendorOnCampusA}`)
      .send({ action: 'transfer', targetTenantId: String(tenantB._id) });

    expect(vendorTransfer.status).toBe(200);
    expect(vendorTransfer.body.message).toContain('Mầm non Hoa Nắng - Phân hiệu B');

    const transferredDoc = await TimekeepingDevice.findById(lockedDeviceAId).lean();
    expect(String(transferredDoc.tenantId)).toBe(String(tenantB._id));
  });
});

