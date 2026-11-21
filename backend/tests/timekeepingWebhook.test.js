'use strict';

const request = require('supertest');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const createApp = require('../app');
const assembleSaasApp = require('../src/saas/assembleSaasApp');
const Tenant = require('../src/models/zone1_system/Tenant');
const User = require('../src/models/zone1_system/User');
const Classroom = require('../src/models/zone3_school/Classroom');
const Student = require('../src/models/zone3_school/Student');
const StudentAttendance = require('../src/models/zone3_school/StudentAttendance');
const Department = require('../src/models/zone2_hr/Department');
const Employee = require('../src/models/zone2_hr/Employee');
const StaffShift = require('../src/models/zone2_hr/StaffShift');
const AttendanceRecord = require('../src/models/zone2_hr/AttendanceRecord');
const RawAttendanceEvent = require('../src/models/zone2_hr/RawAttendanceEvent');
const TimekeepingDevice = require('../src/models/zone2_hr/TimekeepingDevice');
const AttendanceDevicePersonMapping = require('../src/models/zone2_hr/AttendanceDevicePersonMapping');
const TimekeepingWebhookLog = require('../src/models/zone2_hr/TimekeepingWebhookLog');
const { generateNextPersonCode, assertPersonCodeAvailable } = require('../src/services/personCodeService');

describe('Attendance Hikvision Webhook E2E (Bước 1 & Bước 2: Học sinh + Nhân viên + Chống quẹt đúp 5p)', () => {
  let replSet;
  let saasApp;
  let legacyApp;
  let tenantA;
  let adminUser;
  let teacherUser;
  let studentMapped;
  let studentAutoCode;
  let hikDevice;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    delete process.env.TIMEKEEPING_WEBHOOK_TOKEN;
    saasApp = assembleSaasApp({ saasMode: 'phase1e' });
    legacyApp = createApp();
  });

  afterAll(async () => {
    delete process.env.TIMEKEEPING_WEBHOOK_TOKEN;
    await mongoose.disconnect();
    if (replSet) {
      await replSet.stop();
    }
  });

  beforeEach(async () => {
    delete process.env.TIMEKEEPING_WEBHOOK_TOKEN;
    const collections = await mongoose.connection.db.collections();
    for (const col of collections) {
      await col.deleteMany({});
    }

    const passwordHash = await bcrypt.hash('123456', 10);
    tenantA = await Tenant.create({
      name: 'Trường Mầm non Hoa Nắng A',
      code: 'HOANANG-A',
      status: 'active'
    });

    adminUser = await User.create({
      tenantId: tenantA._id,
      username: 'admin',
      passwordHash,
      role: 'admin',
      profile: { fullName: 'Quản trị viên' },
      status: 'active'
    });

    teacherUser = await User.create({
      tenantId: tenantA._id,
      username: 'teacher',
      passwordHash,
      role: 'teacher',
      profile: { fullName: 'Cô Nguyễn Thị Mai' },
      employeeInfo: { employeeId: 'GV001', position: 'teacher' },
      status: 'active'
    });

    const dept = await Department.create({
      tenantId: tenantA._id,
      code: 'EDU',
      name: 'Tổ Sư phạm',
      status: 'active'
    });

    const chefUser = await User.create({
      tenantId: tenantA._id,
      username: 'chef',
      passwordHash,
      role: 'chef',
      profile: { fullName: 'Chú Đặng Văn Hùng' },
      employeeInfo: { employeeId: 'NV003', position: 'chef' },
      status: 'active'
    });

    await Employee.create({
      tenantId: tenantA._id,
      employeeCode: 'GV001',
      fullName: 'Cô Nguyễn Thị Mai',
      userId: teacherUser._id,
      departmentId: dept._id,
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active'
    });

    const chefEmp = await Employee.create({
      tenantId: tenantA._id,
      employeeCode: 'NV003',
      fullName: 'Chú Đặng Văn Hùng',
      userId: chefUser._id,
      departmentId: dept._id,
      position: 'chef',
      payrollRole: 'chef',
      status: 'active'
    });

    await StaffShift.create({
      tenantId: tenantA._id,
      employeeId: chefEmp._id,
      role: 'chef',
      name: 'Ca sáng Bếp',
      startTime: '07:30',
      endTime: '16:30',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      validFrom: '2026-01-01',
      validUntil: '2026-12-31',
      createdBy: adminUser._id
    });

    const classroom = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Mầm 1',
      code: 'MAM_1',
      ageGroup: '3-4',
      schoolYear: '2026-2027',
      homeroomTeacherId: teacherUser._id,
      status: 'active'
    });

    studentMapped = await Student.create({
      tenantId: tenantA._id,
      studentCode: 'HS-2026-000001',
      fullName: 'Bé Trần Gia Hân',
      birthDate: new Date('2023-03-15'),
      gender: 'female',
      classroomId: classroom._id,
      className: classroom.name,
      status: 'enrolled'
    });

    studentAutoCode = await Student.create({
      tenantId: tenantA._id,
      studentCode: 'HS-2026-000002',
      fullName: 'Bé Trần Minh Khôi',
      birthDate: new Date('2022-05-20'),
      gender: 'male',
      classroomId: classroom._id,
      className: classroom.name,
      status: 'enrolled'
    });

    hikDevice = await TimekeepingDevice.create({
      tenantId: tenantA._id,
      deviceCode: 'HIK-GATE-01',
      name: 'Hikvision Cổng chính',
      vendor: 'HIKVISION',
      model: 'DS-K1T320MX',
      host: '192.168.1.8',
      serialNumber: 'LA5403347',
      protocol: 'PUSH_API',
      enabled: true,
      createdBy: adminUser._id
    });

    // Ánh xạ mã máy "101" sang Học sinh Bé Trần Gia Hân
    await AttendanceDevicePersonMapping.create({
      tenantId: tenantA._id,
      deviceId: hikDevice._id,
      externalPersonId: '101',
      subjectType: 'STUDENT',
      subjectId: studentMapped._id,
      studentId: studentMapped._id,
      active: true,
      createdBy: adminUser._id
    });
  });

  test('1. Học sinh quét khuôn mặt: Đúng giờ (<08:00), chống quẹt đúp 5 phút, và Check-out buổi chiều', async () => {
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0x7b, 0x41, 0x7d, 0xff, 0xd9]);

    // Lần 1 (07:45): Đến lớp đúng giờ -> CHECK_IN (present)
    const scan1 = await request(saasApp)
      .post('/api/attendance/webhook/HOANANG-A')
      .field('event_log', JSON.stringify({
        ipAddress: '192.168.1.8',
        shortSerialNumber: 'LA5403347',
        dateTime: '2026-11-21T07:45:00+07:00',
        eventType: 'AccessControllerEvent',
        AccessControllerEvent: {
          majorEventType: 5,
          subEventType: 75,
          employeeNoString: '101',
          name: 'Gia Han',
          serialNo: 201
        }
      }))
      .attach('Picture', fakeJpeg, { filename: 'Picture.jpg', contentType: 'image/jpeg' });

    expect(scan1.status).toBe(200);
    expect(scan1.body.attendanceResult).toMatchObject({
      status: 'OK',
      subjectType: 'STUDENT',
      action: 'CHECK_IN',
      attendanceStatus: 'present'
    });

    // Lần 2 (07:47 - chỉ cách 2 phút < 5 phút): Đứng trước camera bị quét đúp -> COOLDOWN_IGNORED
    const scan2 = await request(saasApp)
      .post('/api/attendance/webhook/HOANANG-A')
      .send({
        ipAddress: '192.168.1.8',
        shortSerialNumber: 'LA5403347',
        dateTime: '2026-11-21T07:47:30+07:00',
        eventType: 'AccessControllerEvent',
        AccessControllerEvent: {
          majorEventType: 5,
          subEventType: 75,
          employeeNoString: '101',
          name: 'Gia Han',
          serialNo: 202
        }
      });

    expect(scan2.status).toBe(200);
    expect(scan2.body.attendanceResult.action).toBe('COOLDOWN_IGNORED');

    let attDoc = await StudentAttendance.findOne({ studentId: studentMapped._id }).lean();
    expect(attDoc.checkOutTime).toBeUndefined();

    // Lần 3 (16:40 chiều - sau > 5 phút): Về trường -> CHECK_OUT
    const scan3 = await request(saasApp)
      .post('/api/attendance/webhook/HOANANG-A')
      .send({
        ipAddress: '192.168.1.8',
        shortSerialNumber: 'LA5403347',
        dateTime: '2026-11-21T16:40:00+07:00',
        eventType: 'AccessControllerEvent',
        AccessControllerEvent: {
          majorEventType: 5,
          subEventType: 75,
          employeeNoString: '101',
          name: 'Gia Han',
          serialNo: 203
        }
      });

    expect(scan3.status).toBe(200);
    expect(scan3.body.attendanceResult.action).toBe('CHECK_OUT');

    attDoc = await StudentAttendance.findOne({ studentId: studentMapped._id }).lean();
    expect(new Date(attDoc.checkInTime).toISOString()).toBe(new Date('2026-11-21T07:45:00+07:00').toISOString());
    expect(new Date(attDoc.checkOutTime).toISOString()).toBe(new Date('2026-11-21T16:40:00+07:00').toISOString());
  });

  test('2. Tự động nhận diện Học sinh theo mã viết liền HS2026000002 & đánh dấu Đi muộn sau 08:00', async () => {
    // Gửi vào /api/attendance/webhook KHÔNG cần đuôi :schoolCode -> tự nhận diện trường qua Serial LA5403347
    const res = await request(saasApp)
      .post('/api/attendance/webhook')
      .send({
        ipAddress: '192.168.1.8',
        shortSerialNumber: 'LA5403347',
        dateTime: '2026-11-21T08:15:00+07:00',
        eventType: 'AccessControllerEvent',
        AccessControllerEvent: {
          majorEventType: 5,
          subEventType: 75,
          employeeNoString: 'HS2026000002',
          name: 'Minh Khoi',
          serialNo: 301
        }
      });

    expect(res.status).toBe(200);
    expect(res.body.attendanceResult).toMatchObject({
      status: 'OK',
      subjectType: 'STUDENT',
      action: 'CHECK_IN',
      attendanceStatus: 'late',
      fullName: 'Bé Trần Minh Khôi'
    });
  });

  test('3. Nhân viên tự động khớp mã NV003 (có StaffShift 07:30) & GV001 (mặc định 08:00), chống quẹt đúp 5p & Check-out', async () => {
    // 3a. Đầu bếp NV003 có StaffShift 07:30 -> quét lúc 08:05 tính muộn 35 phút
    const chefIn = await request(saasApp)
      .post('/api/attendance/webhook/HOANANG-A')
      .send({
        ipAddress: '192.168.1.8',
        shortSerialNumber: 'LA5403347',
        dateTime: '2026-11-21T08:05:00+07:00',
        eventType: 'AccessControllerEvent',
        AccessControllerEvent: {
          majorEventType: 5,
          subEventType: 75,
          employeeNoString: 'NV003',
          name: 'Chu Hung',
          serialNo: 400
        }
      });
    expect(chefIn.body.attendanceResult).toMatchObject({
      status: 'OK',
      subjectType: 'EMPLOYEE',
      action: 'CHECK_IN',
      isLate: true,
      lateMinutes: 35
    });

    // 3b. Giáo viên GV001 không có StaffShift -> dùng mặc định 08:00 -> quét lúc 08:12 tính muộn 12 phút
    const inRes = await request(saasApp)
      .post('/api/attendance/webhook/HOANANG-A')
      .send({
        ipAddress: '192.168.1.8',
        shortSerialNumber: 'LA5403347',
        dateTime: '2026-11-21T08:12:00+07:00',
        eventType: 'AccessControllerEvent',
        AccessControllerEvent: {
          majorEventType: 5,
          subEventType: 75,
          employeeNoString: 'GV001',
          name: 'Co Mai',
          serialNo: 401
        }
      });

    expect(inRes.status).toBe(200);
    expect(inRes.body.attendanceResult).toMatchObject({
      status: 'OK',
      subjectType: 'EMPLOYEE',
      action: 'CHECK_IN',
      isLate: true,
      lateMinutes: 12
    });

    // Lần 2: 08:14 (sau 2 phút < 5 phút) -> Chống quẹt đúp COOLDOWN_IGNORED
    const dupRes = await request(saasApp)
      .post('/api/attendance/webhook/HOANANG-A')
      .send({
        ipAddress: '192.168.1.8',
        shortSerialNumber: 'LA5403347',
        dateTime: '2026-11-21T08:14:00+07:00',
        eventType: 'AccessControllerEvent',
        AccessControllerEvent: {
          majorEventType: 5,
          subEventType: 75,
          employeeNoString: 'GV001',
          name: 'Co Mai',
          serialNo: 402
        }
      });

    expect(dupRes.status).toBe(200);
    expect(dupRes.body.attendanceResult.action).toBe('COOLDOWN_IGNORED');

    let empRecord = await AttendanceRecord.findOne({ userId: teacherUser._id }).lean();
    expect(empRecord.status).toBe('incomplete');
    expect(empRecord.checkOutTime).toBeNull();

    // Lần 3: 17:10 chiều -> CHECK_OUT & chuyển status sang 'present'
    const outRes = await request(saasApp)
      .post('/api/attendance/webhook/HOANANG-A')
      .send({
        ipAddress: '192.168.1.8',
        shortSerialNumber: 'LA5403347',
        dateTime: '2026-11-21T17:10:00+07:00',
        eventType: 'AccessControllerEvent',
        AccessControllerEvent: {
          majorEventType: 5,
          subEventType: 75,
          employeeNoString: 'GV001',
          name: 'Co Mai',
          serialNo: 403
        }
      });

    expect(outRes.status).toBe(200);
    expect(outRes.body.attendanceResult.action).toBe('CHECK_OUT');

    empRecord = await AttendanceRecord.findOne({ userId: teacherUser._id }).lean();
    expect(empRecord.status).toBe('present');
    expect(empRecord.isLate).toBe(true);
    expect(empRecord.lateMinutes).toBe(12);
    expect(new Date(empRecord.checkOutTime).toISOString()).toBe(new Date('2026-11-21T17:10:00+07:00').toISOString());
  });

  test('4. Mã người mới trên máy chưa ánh xạ (VD: "2" - "khoa") được đưa vào danh sách UNMAPPED an toàn', async () => {
    const res = await request(saasApp)
      .post('/api/attendance/webhook/HOANANG-A')
      .send({
        ipAddress: '192.168.1.8',
        shortSerialNumber: 'LA5403347',
        dateTime: '2026-11-21T11:10:32+07:00',
        eventType: 'AccessControllerEvent',
        AccessControllerEvent: {
          majorEventType: 5,
          subEventType: 75,
          employeeNoString: '2',
          name: 'khoa',
          serialNo: 501
        }
      });

    expect(res.status).toBe(200);
    expect(res.body.attendanceResult).toEqual({
      status: 'UNMAPPED',
      externalPersonId: '2'
    });

    const rawUnmapped = await RawAttendanceEvent.findOne({ externalPersonId: '2', mappingStatus: 'UNMAPPED' }).lean();
    expect(rawUnmapped).toBeTruthy();
    expect(rawUnmapped.employeeName).toBe('khoa');
  });

  test('5. Lọc bỏ các gói nhiễu đóng/mở cửa (21, 22), heartBeat và sự kiện hệ thống (majorEventType 2, 3)', async () => {
    await request(legacyApp).post('/api/attendance/webhook').send({
      eventType: 'AccessControllerEvent',
      AccessControllerEvent: { majorEventType: 5, subEventType: 21, serialNo: 601 }
    });
    await request(saasApp).post('/api/attendance/webhook').send({
      eventType: 'AccessControllerEvent',
      AccessControllerEvent: { majorEventType: 2, subEventType: 1024, serialNo: 602 }
    });
    await request(saasApp).post('/api/attendance/webhook').send({ eventType: 'heartBeat' });

    expect(await TimekeepingWebhookLog.countDocuments({})).toBe(0);
  });

  test('6. Dùng chung 1 dãy số nguyên 1, 2, 3... cho cả Nhân viên & Học sinh, chống trùng chéo & tự nhận diện trực tiếp', async () => {
    // Tạo Nhân viên có mã số '1'
    await User.updateOne({ _id: teacherUser._id }, { $set: { 'employeeInfo.employeeId': '1' } });
    await Employee.updateOne({ userId: teacherUser._id }, { $set: { employeeCode: '1' } });

    // Nếu cố gán Học sinh trùng mã '1' của Nhân viên -> chặn ngay với HTTP 409
    await expect(
      assertPersonCodeAvailable({ code: '1', tenantId: tenantA._id })
    ).rejects.toMatchObject({ statusCode: 409 });

    // Bộ đếm tự sinh cho người tiếp theo phải tự nhảy sang '2' (vì '1' đã có Nhân viên dùng)
    const nextCode = await generateNextPersonCode({ tenantId: tenantA._id });
    expect(nextCode).toBe('2');

    // Gán mã '2' cho Học sinh và quét thẳng trên máy Hikvision (không cần bảng ánh xạ phụ)
    await Student.updateOne({ _id: studentAutoCode._id }, { $set: { studentCode: '2' } });

    const scanStu = await request(saasApp)
      .post('/api/attendance/webhook/HOANANG-A')
      .send({
        ipAddress: '192.168.1.8',
        shortSerialNumber: 'LA5403347',
        dateTime: '2026-11-21T07:40:00+07:00',
        eventType: 'AccessControllerEvent',
        AccessControllerEvent: {
          majorEventType: 5,
          subEventType: 75,
          employeeNoString: '2',
          name: 'Minh Khoi',
          serialNo: 701
        }
      });

    expect(scanStu.status).toBe(200);
    expect(scanStu.body.attendanceResult).toMatchObject({
      status: 'OK',
      subjectType: 'STUDENT',
      action: 'CHECK_IN',
      fullName: 'Bé Trần Minh Khôi'
    });
  });
});
