// One-time, idempotent bootstrap for a demo HR login. Never stores or logs a plaintext password.
require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/zone1_system/User');
const Employee = require('../models/zone2_hr/Employee');
const AuditLog = require('../models/zone1_system/AuditLog');
const { hashPassword } = require('../utils/passwordHash');

const main = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const administrator = await User.findOne({ role: 'admin', status: 'active' }).select('_id username').lean();
  if (!administrator) throw new Error('Cần tài khoản quản trị đang hoạt động để ghi nhật ký tạo HR');
  if (await User.exists({ username: 'hr' }) || await User.exists({ role: 'hr' })) {
    console.log('Tài khoản hr hoặc vai trò HR đã tồn tại; không tạo thêm.');
    return;
  }

  const password = crypto.randomBytes(21).toString('base64url');
  const session = await mongoose.startSession();
  let employeeCode;
  try {
    await session.withTransaction(async () => {
      if (await User.exists({ role: 'hr' }).session(session)) throw new Error('Tài khoản HR đã được tạo đồng thời');
      const [account] = await User.create([{
        username: 'hr', passwordHash: await hashPassword(password), role: 'hr', status: 'active',
        permissions: [], profile: { fullName: 'Nhân sự Hoa Nắng (cần cập nhật)', phone: '', email: '' }
      }], { session });
      employeeCode = `NS-${new Date().getFullYear()}-${String(account._id).slice(-6).toUpperCase()}`;
      await Employee.create([{
        userId: account._id, employeeCode, fullName: account.profile.fullName,
        gender: null, qualification: { degree: '', major: '' }, contractType: null,
        startDate: null, position: 'hr', payrollRole: 'hr', status: 'active',
        salaryConfig: { baseSalary: 0, positionAllowance: 0, lunchAllowance: 0 }
      }], { session });
      account.employeeInfo = { employeeId: employeeCode, baseSalary: 0, position: 'hr' };
      await account.save({ session });
      await AuditLog.create([{
        actorId: administrator._id, actorUsername: administrator.username,
        action: 'INTERNAL_ACCOUNT_CREATED', targetType: 'User', targetId: account._id,
        before: {}, after: { username: 'hr', role: 'hr', status: 'active', employeeCode },
        reason: 'Khởi tạo tài khoản HR dùng thử theo yêu cầu của chủ hệ thống'
      }], { session });
    });
  } finally { await session.endSession(); }
  console.log(JSON.stringify({ username: 'hr', temporaryPassword: password, employeeCode, reminder: 'Đổi mật khẩu và cập nhật họ tên thật trước khi dùng chính thức.' }));
};

main().catch((error) => { console.error(`Không thể tạo tài khoản HR: ${error.message}`); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
