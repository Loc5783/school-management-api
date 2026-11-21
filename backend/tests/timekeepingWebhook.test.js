'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const createApp = require('../app');
const assembleSaasApp = require('../src/saas/assembleSaasApp');
const TimekeepingWebhookLog = require('../src/models/zone2_hr/TimekeepingWebhookLog');

describe('Attendance Hikvision Webhook (/api/attendance/webhook - Đồng bộ JussStudio/BE)', () => {
  let mongoServer;
  let saasApp;
  let legacyApp;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    delete process.env.TIMEKEEPING_WEBHOOK_TOKEN;
    saasApp = assembleSaasApp({ saasMode: 'phase1e' });
    legacyApp = createApp();
  });

  afterAll(async () => {
    delete process.env.TIMEKEEPING_WEBHOOK_TOKEN;
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    delete process.env.TIMEKEEPING_WEBHOOK_TOKEN;
    await TimekeepingWebhookLog.deleteMany({});
  });

  test('1. GET /api/attendance/webhook trả về 200 OK và hỗ trợ CORS từ IP mạng LAN', async () => {
    const res = await request(saasApp)
      .get('/api/attendance/webhook')
      .set('Origin', 'http://192.168.1.200:5173');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://192.168.1.200:5173');
    expect(res.body.status).toBe('OK');
  });

  test('2. POST /api/attendance/webhook nhận gói JSON từ Hikvision và suy luận đúng phương thức qua subEventType', async () => {
    const hikJsonPayload = {
      ipAddress: '192.168.1.22',
      portNo: 5000,
      protocol: 'HTTP',
      dateTime: '2026-11-21T07:45:12+07:00',
      eventType: 'AccessControllerEvent',
      eventState: 'active',
      AccessControllerEvent: {
        deviceName: 'Access Controller',
        majorEventType: 5,
        subEventType: 38,
        name: 'Nguyễn Thị Hoa',
        employeeNoString: '7',
        currentVerifyMode: 'faceOrFpOrCardOrPw',
        attendanceStatus: 'undefined',
        serialNo: 23420
      }
    };

    const res = await request(saasApp)
      .post('/api/attendance/webhook')
      .send(hikJsonPayload)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Success');
    expect(res.body.skippedNoise).toBe(false);
    expect(res.body.hikvisionSummary).toMatchObject({
      majorEventType: 5,
      subEventType: 38,
      employeeNoString: '7',
      personName: 'Nguyễn Thị Hoa',
      currentVerifyMode: 'FINGERPRINT',
      serialNo: 23420
    });
  });

  test('3. POST /api/attendance/webhook/:schoolCode nhận multipart/form-data (Buffer) kèm ảnh JPEG chứa ký tự ngoặc nhọn nhiễu', async () => {
    const eventLogJson = JSON.stringify({
      ipAddress: '192.168.1.8',
      dateTime: '2026-11-21T07:50:00+07:00',
      eventType: 'AccessControllerEvent',
      eventState: 'active',
      AccessControllerEvent: {
        deviceName: 'DS-K1T320MX',
        majorEventType: 5,
        subEventType: 75,
        name: 'Bé Trần Minh Khôi',
        employeeNoString: 'HS2026001',
        currentVerifyMode: 'faceOrFpOrCardOrPw',
        serialNo: 502
      }
    });

    // Chèn cố ý các byte '{' (0x7b) và '}' (0x7d) vào ảnh JPEG giả lập để kiểm chứng extractJsonFromMultipart không bị hỏng
    const fakeJpegWithBraces = Buffer.from([0xff, 0xd8, 0xff, 0x7b, 0x41, 0x7d, 0xff, 0xd9]);

    const res = await request(saasApp)
      .post('/api/attendance/webhook/HOANANG-A')
      .field('event_log', eventLogJson)
      .attach('Picture', fakeJpegWithBraces, { filename: 'face_snap.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.payloadFormat).toBe('MULTIPART_FORM_DATA');
    expect(res.body.hikvisionSummary).toMatchObject({
      subEventType: 75,
      employeeNoString: 'HS2026001',
      personName: 'Bé Trần Minh Khôi',
      currentVerifyMode: 'FACE',
      hasFaceImage: true
    });

    const saved = await TimekeepingWebhookLog.findById(res.body.logId).lean();
    expect(saved.schoolCode).toBe('HOANANG-A');
  });

  test('4. Bỏ qua không lưu DB đối với các gói đóng/mở rơ-le cửa (subEventType 21, 22) và heartBeat giống JussStudio/BE', async () => {
    const doorOpenPayload = {
      eventType: 'AccessControllerEvent',
      AccessControllerEvent: {
        majorEventType: 5,
        subEventType: 21,
        doorNo: 1,
        serialNo: 23421
      }
    };

    const resDoor = await request(legacyApp)
      .post('/api/attendance/webhook')
      .send(doorOpenPayload);
    expect(resDoor.status).toBe(200);
    expect(resDoor.body.skippedNoise).toBe(true);
    expect(resDoor.body.persisted).toBe(false);

    const resHeartbeat = await request(saasApp)
      .post('/api/attendance/webhook')
      .send({ eventType: 'heartBeat' });
    expect(resHeartbeat.status).toBe(200);
    expect(resHeartbeat.body.skippedNoise).toBe(true);

    const count = await TimekeepingWebhookLog.countDocuments({});
    expect(count).toBe(0);
  });

  test('5. GET /api/attendance/webhook/logs trả về danh sách sự kiện đã nhận có phân trang', async () => {
    await request(saasApp)
      .post('/api/attendance/webhook/HOANANG-A')
      .send({
        dateTime: '2026-11-21T08:00:00+07:00',
        eventType: 'AccessControllerEvent',
        AccessControllerEvent: {
          majorEventType: 5,
          subEventType: 75,
          employeeNoString: 'GV002',
          name: 'Cô Lan',
          serialNo: 900
        }
      });

    const logsRes = await request(saasApp).get('/api/attendance/webhook/logs?schoolCode=HOANANG-A');
    expect(logsRes.status).toBe(200);
    expect(logsRes.body.data).toHaveLength(1);
    expect(logsRes.body.data[0].hikvisionSummary.employeeNoString).toBe('GV002');
  });
});
