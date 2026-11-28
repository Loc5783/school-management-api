'use strict';

/**
 * Kiểm thử tích hợp toàn diện Cụm Máy Chấm Công Hikvision ISAPI 500-Slot,
 * Phân bổ theo Phân hiệu (`campus`) & Ảnh Quét Mặt Chấm Công (`< 200KB`) cho Nhân sự và Học sinh.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-biometric-2026';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';

jest.setTimeout(90000);

const http = require('http');
const request = require('supertest');
const testDbBootstrap = require('../../src/saas/testDbBootstrap');
const createSaasApp = require('../../src/saas/createSaasApp');
const { generateSchoolUserToken } = require('../../src/saas/utils/saasJwt');

const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const Classroom = require('../../src/models/zone3_school/Classroom');
const Student = require('../../src/models/zone3_school/Student');
const Employee = require('../../src/models/zone2_hr/Employee');
const TimekeepingDevice = require('../../src/models/zone2_hr/TimekeepingDevice');
const BiometricFaceProfile = require('../../src/models/zone2_hr/BiometricFaceProfile');
const AttendanceDevicePersonMapping = require('../../src/models/zone2_hr/AttendanceDevicePersonMapping');
const biometricSyncService = require('../../src/services/hikvisionBiometricSyncService');

// Tạo mẫu ảnh JPEG hợp lệ tối giản (bắt đầu bằng FF D8 FF E0 ... FF D9, < 200KB)
function createValidTinyJpegBuffer(extraLength = 512) {
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const body = Buffer.alloc(extraLength, 0x5a);
  const footer = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([header, body, footer]);
}

describe('Multi-Campus Hikvision ISAPI 500-Slot & Biometric Face Sync Suite', () => {
  let bootstrapInstance;
  let app;
  let mockHikServer;
  let mockHikPort;

  // Trạng thái bộ nhớ giả lập bên trong máy chấm công phần cứng Hikvision
  const mockHardwareUsers = new Map();
  const mockHardwareFaces = new Map();
  let doorOpenedCount = 0;

  let tenantA;
  let tenantB;
  let tokenAdminA;
  let tokenAdminB;

  let empCampus1;
  let empCampus2;
  let empResigned;
  let stuCampus1;
  let stuCampus2;
  let stuWithdrawn;

  let deviceCampus1Id;
  let deviceCampus2Id;

  beforeAll(async () => {
    // Khởi tạo Mock Hikvision DS-K1T320MX ISAPI Server (yêu cầu Digest Auth chuẩn)
    mockHikServer = http.createServer((req, res) => {
      const auth = req.headers.authorization || '';
      if (!auth.startsWith('Digest ')) {
        res.writeHead(401, {
          'WWW-Authenticate': 'Digest realm="DS-K1T320MX", nonce="hikmocknonce99", qop="auth", opaque="hikopaque"'
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
  <deviceName>Cong Chinh CS1</deviceName>
  <model>DS-K1T320MFWX</model>
  <serialNumber>DS-K1T320MFWX-MOCK-CS1</serialNumber>
  <macAddress>aa:bb:cc:11:22:33</macAddress>
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
          let cond = {};
          try {
            cond = JSON.parse(bodyText)?.UserInfoSearchCond || {};
          } catch {
            cond = {};
          }
          let all = Array.from(mockHardwareUsers.values());
          if (Array.isArray(cond.EmployeeNoList) && cond.EmployeeNoList.length > 0) {
            const targetNos = new Set(cond.EmployeeNoList.map((x) => String(x.employeeNo)));
            all = all.filter((u) => targetNos.has(u.employeeNo));
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(
            JSON.stringify({
              UserInfoSearch: {
                searchID: cond.searchID || '1',
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
          const prev = mockHardwareUsers.get(u.employeeNo) || {};
          mockHardwareUsers.set(u.employeeNo, {
            employeeNo: u.employeeNo,
            name: u.name,
            userType: 'normal',
            numOfCard: prev.numOfCard || 0,
            numOfFace: mockHardwareFaces.has(u.employeeNo) ? 1 : (prev.numOfFace || 0),
            faceURL: mockHardwareFaces.has(u.employeeNo) ? `/LOCALS/pic/${u.employeeNo}.jpg` : ''
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ statusCode: 1, statusString: 'OK' }));
        }

        if (req.method === 'PUT' && req.url.startsWith('/ISAPI/Intelligent/FDLib/FDSetUp')) {
          const fpidMatch = bodyText.match(/"FPID"\s*:\s*"([^"]+)"/);
          const fpid = fpidMatch ? fpidMatch[1] : 'UNKNOWN';
          // Trích xuất phần JPEG bắt đầu từ FF D8
          const jpegStart = rawBuf.indexOf(Buffer.from([0xff, 0xd8]));
          const jpegEnd = rawBuf.lastIndexOf(Buffer.from([0xff, 0xd9]));
          if (jpegStart !== -1 && jpegEnd !== -1) {
            const imgSlice = rawBuf.subarray(jpegStart, jpegEnd + 2);
            mockHardwareFaces.set(fpid, imgSlice);
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
          const img = mockHardwareFaces.get(code) || createValidTinyJpegBuffer(640);
          res.writeHead(200, { 'Content-Type': 'image/jpeg' });
          return res.end(img);
        }

        if (req.method === 'PUT' && req.url.startsWith('/ISAPI/AccessControl/UserInfo/Delete')) {
          const parsed = JSON.parse(bodyText);
          const list = parsed?.UserInfoDelCond?.EmployeeNoList || [];
          for (const item of list) {
            mockHardwareUsers.delete(item.employeeNo);
            mockHardwareFaces.delete(item.employeeNo);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ statusCode: 1, statusString: 'OK' }));
        }

        if (req.method === 'PUT' && req.url.startsWith('/ISAPI/AccessControl/RemoteControl/door/')) {
          doorOpenedCount += 1;
          res.writeHead(200, { 'Content-Type': 'application/xml' });
          return res.end('<ResponseStatus><statusCode>1</statusCode><statusString>OK</statusString></ResponseStatus>');
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
                    time: '2026-11-27T07:35:00+07:00',
                    employeeNoString: 'HS-CS1-001',
                    name: 'Be Tran Gia Huy',
                    serialNo: 'EVT-BI-SYNC-001'
                  }
                ]
              }
            })
          );
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

    bootstrapInstance = await testDbBootstrap.startTestDb({
      instanceOpts: [{ dbName: 'school_hikvision_biometric_campus_test' }]
    });
    app = createSaasApp({
      mongoUri: bootstrapInstance.uri,
      connection: bootstrapInstance.connection,
      saasMode: 'phase1e'
    });

    await Promise.all([
      Tenant.syncIndexes(),
      User.syncIndexes(),
      Classroom.syncIndexes(),
      Student.syncIndexes(),
      Employee.syncIndexes(),
      TimekeepingDevice.syncIndexes(),
      BiometricFaceProfile.syncIndexes(),
      AttendanceDevicePersonMapping.syncIndexes()
    ]);

    tenantA = await Tenant.create({
      code: 'MN-SAOMAI',
      name: 'Trường Mầm Non Sao Mai',
      status: 'active',
      campuses: [
        { code: 'CS1', name: 'Cơ sở chính', isActive: true },
        { code: 'CS2', name: 'Phân hiệu Cầu Giấy', isActive: true }
      ]
    });

    tenantB = await Tenant.create({
      code: 'MN-BINHMINH',
      name: 'Trường Mầm Non Bình Minh',
      status: 'active',
      campuses: [{ code: 'CS1', name: 'Cơ sở chính', isActive: true }]
    });

    const adminA = await User.create({
      username: 'admin_saomai',
      passwordHash: 'hashed',
      role: 'admin',
      status: 'active',
      tenantId: tenantA._id,
      profile: { fullName: 'Quản trị Hệ thống Sao Mai' }
    });
    tokenAdminA = generateSchoolUserToken(adminA, tenantA);

    const adminB = await User.create({
      username: 'admin_binhminh',
      passwordHash: 'hashed',
      role: 'admin',
      status: 'active',
      tenantId: tenantB._id,
      profile: { fullName: 'Quản trị Bình Minh' }
    });
    tokenAdminB = generateSchoolUserToken(adminB, tenantB);

    const userTeacher1 = await User.create({
      username: 'gv_cs1',
      passwordHash: 'hashed',
      role: 'teacher',
      status: 'active',
      tenantId: tenantA._id,
      profile: { fullName: 'Cô Nguyễn Thu Hà' }
    });
    const userTeacher2 = await User.create({
      username: 'gv_cs2',
      passwordHash: 'hashed',
      role: 'teacher',
      status: 'active',
      tenantId: tenantA._id,
      profile: { fullName: 'Cô Lê Minh Tâm' }
    });

    empCampus1 = await Employee.create({
      tenantId: tenantA._id,
      userId: userTeacher1._id,
      employeeCode: 'NV-CS1-01',
      fullName: 'Cô Nguyễn Thu Hà',
      campus: 'Cơ sở chính',
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active'
    });

    empCampus2 = await Employee.create({
      tenantId: tenantA._id,
      userId: userTeacher2._id,
      employeeCode: 'NV-CS2-01',
      fullName: 'Cô Lê Minh Tâm',
      campus: 'Phân hiệu Cầu Giấy',
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active'
    });

    empResigned = await Employee.create({
      tenantId: tenantA._id,
      employeeCode: 'NV-OLD-99',
      fullName: 'Nhân Viên Đã Nghỉ',
      campus: 'Cơ sở chính',
      position: 'security',
      payrollRole: 'guard',
      status: 'resigned'
    });

    const classCs1 = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Mầm CS1',
      campus: 'Cơ sở chính',
      ageGroup: '3-4',
      status: 'active'
    });
    const classCs2 = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Chồi CS2',
      campus: 'Phân hiệu Cầu Giấy',
      ageGroup: '4-5',
      status: 'active'
    });

    stuCampus1 = await Student.create({
      tenantId: tenantA._id,
      studentCode: 'HS-CS1-001',
      fullName: 'Bé Trần Gia Huy',
      classroomId: classCs1._id,
      className: classCs1.name,
      gender: 'male',
      status: 'enrolled',
      birthDate: new Date('2022-05-10')
    });

    stuCampus2 = await Student.create({
      tenantId: tenantA._id,
      studentCode: 'HS-CS2-001',
      fullName: 'Bé Phạm Bảo Ngọc',
      classroomId: classCs2._id,
      className: classCs2.name,
      gender: 'female',
      status: 'enrolled',
      birthDate: new Date('2021-08-15')
    });

    stuWithdrawn = await Student.create({
      tenantId: tenantA._id,
      studentCode: 'HS-OLD-888',
      fullName: 'Bé Đã Thôi Học',
      classroomId: classCs1._id,
      className: classCs1.name,
      gender: 'male',
      status: 'withdrawn',
      birthDate: new Date('2020-02-02')
    });
  });

  afterAll(async () => {
    if (mockHikServer) {
      await new Promise((resolve) => mockHikServer.close(resolve));
    }
    if (bootstrapInstance) {
      await bootstrapInstance.stop();
    }
  });

  test('1. School Admin registers campus-specific Hikvision devices with encrypted ISAPI credentials (never leaked)', async () => {
    const res1 = await request(app)
      .post('/api/v1/timekeeping/devices')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        deviceCode: 'HIK-CS1-GATE',
        name: 'Máy Cổng Cơ Sở Chính',
        campus: 'Cơ sở chính',
        location: 'Sảnh đón trẻ CS1',
        host: '192.168.1.50',
        transportScheme: 'http',
        httpPort: 80,
        maxUserCapacity: 500,
        syncAllocationMode: 'BY_CAMPUS_PRIORITY',
        deviceUsername: 'admin',
        devicePassword: 'HikSecretPassword1!'
      });

    expect(res1.status).toBe(201);
    expect(res1.body.data.campus).toBe('Cơ sở chính');
    expect(res1.body.data.credentialConfigured).toBe(true);
    expect(res1.body.data.encryptedAuth).toBeUndefined();
    expect(res1.body.data.credentialKey).toBeUndefined();
    deviceCampus1Id = res1.body.data._id;

    const res2 = await request(app)
      .post('/api/v1/timekeeping/devices')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        deviceCode: 'HIK-CS2-GATE',
        name: 'Máy Cổng Phân Hiệu Cầu Giấy',
        campus: 'Phân hiệu Cầu Giấy',
        location: 'Cổng chính Cầu Giấy',
        host: '192.168.2.50',
        transportScheme: 'http',
        httpPort: 80,
        maxUserCapacity: 500,
        syncAllocationMode: 'BY_CAMPUS_PRIORITY',
        deviceUsername: 'admin',
        devicePassword: 'HikSecretPassword2!'
      });

    expect(res2.status).toBe(201);
    expect(res2.body.data.campus).toBe('Phân hiệu Cầu Giấy');
    deviceCampus2Id = res2.body.data._id;
  });

  test('2. Biometric face upload enforces <= 200KB JPEG standard & isolates Tenant A vs Tenant B', async () => {
    // Ảnh vượt 200KB bị chặn ngay ở tầng Backend
    const oversizedJpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(210 * 1024, 0x41),
      Buffer.from([0xff, 0xd9])
    ]);
    const overRes = await request(app)
      .put(`/api/v1/timekeeping/biometric-faces/EMPLOYEE/${empCampus1._id}`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        imageBase64: `data:image/jpeg;base64,${oversizedJpeg.toString('base64')}`,
        source: 'CAMERA'
      });
    expect(overRes.status).toBe(400);
    expect(overRes.body.code).toBe('FACE_IMAGE_TOO_LARGE');

    // Ảnh chuẩn < 200KB lưu thành công cho cả Nhân sự và Học sinh
    const validJpeg = createValidTinyJpegBuffer(1200);
    const okEmp = await request(app)
      .put(`/api/v1/timekeeping/biometric-faces/EMPLOYEE/${empCampus1._id}`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        imageBase64: `data:image/jpeg;base64,${validJpeg.toString('base64')}`,
        source: 'CAMERA'
      });
    expect(okEmp.status).toBe(200);
    expect(okEmp.body.data.personCode).toBe('NV-CS1-01');

    const okStu = await request(app)
      .put(`/api/v1/timekeeping/biometric-faces/STUDENT/${stuCampus1._id}`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        imageBase64: `data:image/jpeg;base64,${validJpeg.toString('base64')}`,
        source: 'UPLOAD'
      });
    expect(okStu.status).toBe(200);
    expect(okStu.body.data.personCode).toBe('HS-CS1-001');

    // Cross-tenant: Admin trường B không thể gắn ảnh hay xem dữ liệu trường A
    const crossAttempt = await request(app)
      .put(`/api/v1/timekeeping/biometric-faces/STUDENT/${stuCampus1._id}`)
      .set('Authorization', `Bearer ${tokenAdminB}`)
      .send({
        imageBase64: `data:image/jpeg;base64,${validJpeg.toString('base64')}`
      });
    expect(crossAttempt.status).toBe(404);
  });

  test('3. Biometric overview filters KPIs, devices & roster accurately per Campus (Phân hiệu)', async () => {
    const resAll = await request(app)
      .get('/api/v1/timekeeping/biometric-overview?campus=ALL')
      .set('Authorization', `Bearer ${tokenAdminA}`);

    expect(resAll.status).toBe(200);
    expect(resAll.body.data.kpi.totalDevices).toBe(2);
    expect(resAll.body.data.kpi.totalSlotCapacity).toBe(1000);
    expect(resAll.body.data.kpi.activeWithCodeCount).toBe(4); // 2 NV + 2 HS active
    expect(resAll.body.data.kpi.withBiometricFaceCount).toBe(2);
    expect(resAll.body.data.kpi.reclaimableInactiveCount).toBe(2); // 1 NV nghỉ + 1 HS thôi học

    const resCs2 = await request(app)
      .get(`/api/v1/timekeeping/biometric-overview?campus=${encodeURIComponent('Phân hiệu Cầu Giấy')}`)
      .set('Authorization', `Bearer ${tokenAdminA}`);

    expect(resCs2.status).toBe(200);
    expect(resCs2.body.data.kpi.totalDevices).toBe(1);
    expect(resCs2.body.data.kpi.activeWithCodeCount).toBe(2); // empCampus2 + stuCampus2
    expect(resCs2.body.data.roster.every((r) => r.campus === 'Phân hiệu Cầu Giấy')).toBe(true);
  });

  test('4. Live ISAPI Hardware Flow: Smart 1-Way Campus Sync, Pull Faces from Machine, Prune Inactive Slots & Remote Door Unlock', async () => {
    // Trỏ thiết bị Cơ sở chính vào Mock Hikvision ISAPI Server (127.0.0.1:mockHikPort trong chế độ test loopback)
    await TimekeepingDevice.updateOne(
      { _id: deviceCampus1Id },
      {
        $set: {
          host: '127.0.0.1',
          httpPort: mockHikPort,
          transportScheme: 'http'
        }
      }
    );

    // Giả lập trên máy chấm công có sẵn hồ sơ đã nghỉ việc + 1 khuôn mặt đăng ký trực tiếp tại máy
    mockHardwareUsers.set('NV-OLD-99', {
      employeeNo: 'NV-OLD-99',
      name: 'Nhan Vien Da Nghi',
      numOfFace: 0
    });
    mockHardwareUsers.set('HS-OLD-888', {
      employeeNo: 'HS-OLD-888',
      name: 'Be Da Thoi Hoc',
      numOfFace: 0
    });

    // 4a. Kiểm tra kết nối & đọc dung lượng
    const capHealth = await biometricSyncService.checkDeviceCapacityAndHealth(
      tenantA._id,
      deviceCampus1Id,
      { _allowLoopbackForTesting: true }
    );
    expect(capHealth.online).toBe(true);
    expect(capHealth.currentStoredUsers).toBe(2);

    // 4b. Đồng bộ 1 chiều thông minh xuống máy Cơ sở chính -> CHỈ đẩy nhân sự & học sinh Cơ sở chính (không đẩy Phân hiệu Cầu Giấy!)
    const syncReport = await biometricSyncService.syncSmartToDevices(tenantA._id, {
      deviceId: deviceCampus1Id,
      overrideOpts: { _allowLoopbackForTesting: true }
    });
    expect(syncReport.syncedDevices).toBe(1);
    expect(syncReport.deviceReports[0].syncedUsers).toBe(2); // NV-CS1-01 + HS-CS1-001
    expect(syncReport.deviceReports[0].syncedFaces).toBe(2);
    expect(mockHardwareUsers.has('NV-CS1-01')).toBe(true);
    expect(mockHardwareUsers.has('HS-CS1-001')).toBe(true);
    expect(mockHardwareUsers.has('NV-CS2-01')).toBe(false); // Phân hiệu 2 không bị đẩy nhầm vào máy CS1!
    expect(mockHardwareFaces.has('NV-CS1-01')).toBe(true);
    expect(mockHardwareFaces.has('HS-CS1-001')).toBe(true);

    // Tự động tạo bản ghi ánh xạ AttendanceDevicePersonMapping cho máy CS1
    const autoMappings = await AttendanceDevicePersonMapping.find({
      tenantId: tenantA._id,
      deviceId: deviceCampus1Id
    }).lean();
    expect(autoMappings.length).toBe(2);

    // 4c. Kéo ngược Ảnh khuôn mặt từ máy chấm công về Web (cho hồ sơ chưa có ảnh mặt trên Web rồi được quét tại máy)
    await BiometricFaceProfile.deleteOne({
      tenantId: tenantA._id,
      subjectType: 'STUDENT',
      subjectId: stuCampus1._id
    });
    const pullReport = await biometricSyncService.pullUsersAndFacesFromDevice(
      tenantA._id,
      deviceCampus1Id,
      {
        overwriteExistingFaces: true,
        overrideOpts: { _allowLoopbackForTesting: true }
      }
    );
    expect(pullReport.matchedCount).toBe(2);
    expect(pullReport.pulledFaceCount).toBe(2);

    const restoredStuFace = await BiometricFaceProfile.findOne({
      tenantId: tenantA._id,
      subjectType: 'STUDENT',
      subjectId: stuCampus1._id
    }).lean();
    expect(restoredStuFace).not.toBeNull();
    expect(restoredStuFace.source).toBe('PULLED_FROM_DEVICE');

    // 4d. Giải phóng slot nghỉ việc / thôi học khỏi máy chấm công (xóa NV-OLD-99 & HS-OLD-888, giữ nguyên NV-CS1-01 & HS-CS1-001)
    const pruneRes = await biometricSyncService.pruneInactiveUsersOnDevice(
      tenantA._id,
      deviceCampus1Id,
      { _allowLoopbackForTesting: true }
    );
    expect(pruneRes.removedCount).toBe(2);
    expect(mockHardwareUsers.has('NV-OLD-99')).toBe(false);
    expect(mockHardwareUsers.has('HS-OLD-888')).toBe(false);
    expect(mockHardwareUsers.has('NV-CS1-01')).toBe(true);
    expect(mockHardwareUsers.has('HS-CS1-001')).toBe(true);

    // 4e. Điều khiển Mở khóa cửa từ xa (Door 1)
    const unlockRes = await biometricSyncService.unlockDoorOnDevice(
      tenantA._id,
      deviceCampus1Id,
      1,
      { _allowLoopbackForTesting: true }
    );
    expect(unlockRes.success).toBe(true);
    expect(doorOpenedCount).toBe(1);

    // 4f. Xóa máy chấm công Phân hiệu 2 (kiểm tra cách ly tenant)
    const crossDel = await request(app)
      .delete(`/api/v1/timekeeping/devices/${deviceCampus2Id}`)
      .set('Authorization', `Bearer ${tokenAdminB}`);
    expect(crossDel.status).toBe(404);

    const okDel = await request(app)
      .delete(`/api/v1/timekeeping/devices/${deviceCampus2Id}`)
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(okDel.status).toBe(200);
  });

  test('5. LAN Auto-Discovery supports single IP, CIDR, range & strictly blocks forbidden/public IPs', async () => {
    const blockedRes = await request(app)
      .post('/api/v1/timekeeping/devices/discover-lan')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ subnetPrefix: '192.168.1.22' });
    expect(blockedRes.status).toBe(403);
    expect(blockedRes.body.code).toBe('FORBIDDEN_DEVICE_IP');

    const publicRes = await request(app)
      .post('/api/v1/timekeeping/devices/discover-lan')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ subnetPrefix: '8.8.8.0/24' });
    expect(publicRes.status).toBe(400);
    expect(publicRes.body.code).toBe('INVALID_SUBNET_PREFIX');

    // Quét dải hẹp 192.168.99.20-23 (nhanh < 500ms, hợp lệ chuẩn mạng nội bộ)
    const rangeScan = await request(app)
      .post('/api/v1/timekeeping/devices/discover-lan')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ subnetPrefix: '192.168.99.20-23' });
    expect(rangeScan.status).toBe(200);
    expect(rangeScan.body.data.scannedSubnets).toEqual(['192.168.99.20 - 192.168.99.23']);
  });

  test('6. Fast Delta Push, 2-Way Bidirectional Sync & 1-Click Quick-Link of Unmatched Machine User', async () => {
    // 6a. Chạy lại đồng bộ nhanh (fastDelta = true) khi không có gì đổi -> Bỏ qua toàn bộ ghi mạng thừa!
    const deltaReport = await biometricSyncService.syncSmartToDevices(tenantA._id, {
      deviceId: deviceCampus1Id,
      fastDelta: true,
      overrideOpts: { _allowLoopbackForTesting: true }
    });
    expect(deltaReport.deviceReports[0].skippedUnchangedCount).toBe(2);
    expect(deltaReport.deviceReports[0].pushedChangedCount).toBe(0);

    // 6b. Giả lập trên máy chấm công vừa có người quét mặt trực tiếp dưới ID ngắn "77" ("Co Tam Moi")
    mockHardwareFaces.set('77', createValidTinyJpegBuffer(800));
    mockHardwareUsers.set('77', {
      employeeNo: '77',
      name: 'Co Tam Moi',
      userType: 'normal',
      numOfFace: 1,
      faceURL: '/LOCALS/pic/77.jpg'
    });

    // Chạy Đồng bộ nhanh 2 chiều (Máy <-> Web):
    // - Chiều 1 (Máy -> Web): Kéo sự kiện chấm công EVT-BI-SYNC-001 của HS-CS1-001 + phát hiện ID "77" kèm ảnh mặt preview
    // - Chiều 2 (Web -> Máy): Đẩy nhanh Delta
    const biReport = await biometricSyncService.quickBidirectionalSync(tenantA._id, {
      deviceId: deviceCampus1Id,
      overrideOpts: { _allowLoopbackForTesting: true }
    });

    expect(biReport.pullSummary.eventsIngested).toBeGreaterThanOrEqual(1);
    const unmatched77 = biReport.pullSummary.unmatchedOnDevice.find((u) => u.employeeNo === '77');
    expect(unmatched77).toBeDefined();
    expect(unmatched77.faceDataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);

    // 6c. Admin bấm "Ghép & Lưu Ảnh Mặt Ngay" gắn ID "77" -> empCampus2 (Cô Lê Minh Tâm)
    const linkRes = await biometricSyncService.linkPulledDeviceUserToSubject(
      tenantA._id,
      deviceCampus1Id,
      {
        externalPersonId: '77',
        subjectType: 'EMPLOYEE',
        subjectId: empCampus2._id,
        faceDataUrl: unmatched77.faceDataUrl,
        overrideOpts: { _allowLoopbackForTesting: true }
      }
    );
    expect(linkRes.faceSaved).toBe(true);
    expect(linkRes.personCode).toBe('NV-CS2-01');

    const savedFaceEmp2 = await BiometricFaceProfile.findOne({
      tenantId: tenantA._id,
      subjectType: 'EMPLOYEE',
      subjectId: empCampus2._id
    }).lean();
    expect(savedFaceEmp2).not.toBeNull();
  });
});

