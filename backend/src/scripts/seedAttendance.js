const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Import models
const User = require('../models/zone1_system/User');
const RawAttendanceEvent = require('../models/zone2_hr/RawAttendanceEvent');
const TimekeepingCorrectionRequest = require('../models/zone2_hr/TimekeepingCorrectionRequest');
const { DEFAULT_SCHOOL_TIMEZONE, addWorkDays, createDateTime, getWorkDate, startOfWorkDate } = require('../utils/dateHelpers');

async function seed() {
  // Kết nối DB
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Kết nối DB thành công');

  // Tạo admin nếu chưa có
  const adminPassword = await bcrypt.hash('123456', 10);
  let admin = await User.findOne({ username: 'admin' });
  if (!admin) {
    admin = await User.create({
      username: 'admin',
      passwordHash: adminPassword,
      role: 'admin',
      profile: { fullName: 'Quản trị viên', phone: '0909123456', email: 'admin@school.com' },
      status: 'active'
    });
    console.log('✅ Đã tạo admin');
  } else {
    console.log('ℹ️ Admin đã tồn tại');
  }

  // Tạo nhân viên (teacher)
  let teacher = await User.findOne({ username: 'teacher' });
  if (!teacher) {
    const teacherPassword = await bcrypt.hash('123456', 10);
    teacher = await User.create({
      username: 'teacher',
      passwordHash: teacherPassword,
      role: 'teacher',
      profile: { fullName: 'Giáo viên Nguyễn Văn A', phone: '0987654321', email: 'teacher@school.com' },
      employeeInfo: { employeeId: 'NV001', hireDate: new Date('2024-01-01'), baseSalary: 10000000 },
      status: 'active'
    });
    console.log('✅ Đã tạo nhân viên teacher');
  } else {
    if (!teacher.employeeInfo?.employeeId) {
      teacher.employeeInfo = { ...teacher.employeeInfo?.toObject?.(), employeeId: 'NV001' };
      await teacher.save();
      console.log('✅ Đã bổ sung mã nhân viên NV001 cho teacher');
    }
    console.log('ℹ️ Teacher đã tồn tại');
  }

  // Tạo raw attendance cho ngày hôm qua
  const yesterdayLabel = addWorkDays(getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE), -1);
  const yesterday = startOfWorkDate(yesterdayLabel, DEFAULT_SCHOOL_TIMEZONE);

  const rawExternalEventId = `seed-${teacher._id}-${yesterdayLabel}-checkout`;
  const existingRaw = await RawAttendanceEvent.findOne({ deviceId: 'D001', externalEventId: rawExternalEventId });
  if (!existingRaw) {
    await RawAttendanceEvent.create({
      deviceId: 'D001',
      externalEventId: rawExternalEventId,
      userId: teacher._id,
      employeeName: teacher.profile.fullName,
      workDate: yesterday,
      eventType: 'CHECK_OUT',
      occurredAt: createDateTime(yesterdayLabel, '17:00', DEFAULT_SCHOOL_TIMEZONE),
      timezone: DEFAULT_SCHOOL_TIMEZONE,
      rawPayload: { deviceId: 'D001' }
    });
    console.log(`✅ Đã tạo raw attendance cho ngày ${yesterday.toISOString().slice(0, 10)}`);
  } else {
    console.log(`ℹ️ Raw attendance cho ngày ${yesterday.toISOString().slice(0, 10)} đã tồn tại`);
  }

  // Tạo correction request đang pending
  const pendingCorr = await TimekeepingCorrectionRequest.findOne({
    userId: teacher._id,
    workDate: yesterday,
    adjustmentType: 'MISSING_CHECK_IN',
    isActive: true
  });
  if (!pendingCorr) {
    await TimekeepingCorrectionRequest.create({
      userId: teacher._id,
      employeeName: teacher.profile.fullName,
      workDate: yesterday,
      timezone: DEFAULT_SCHOOL_TIMEZONE,
      requestedAt: createDateTime(yesterdayLabel, '08:00', DEFAULT_SCHOOL_TIMEZONE),
      requestedTime: '08:00',
      adjustmentType: 'MISSING_CHECK_IN',
      requestedCheckInTime: '08:00',
      requestType: 'MISSING_CHECK_IN',
      reason: 'Quên chấm công vào buổi sáng',
      status: 'PENDING',
      submittedAt: new Date()
    });
    console.log(`✅ Đã tạo correction pending cho ngày ${yesterday.toISOString().slice(0, 10)}`);
  } else {
    console.log(`ℹ️ Correction pending cho ngày ${yesterday.toISOString().slice(0, 10)} đã tồn tại`);
  }

  console.log('✅ Seed hoàn tất!');
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Lỗi seed:', err);
  process.exit(1);
});
