'use strict';
const mongoose = require('../backend/node_modules/mongoose');
const bcrypt = require('../backend/node_modules/bcryptjs');

async function main() {
  await mongoose.connect('mongodb://127.0.0.1:27018/school_management?replicaSet=rs0');
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const users = await User.find({}).lean();
  console.log('Total users:', users.length);
  const candidates = [
    '123456', 'admin123', 'password123', '123456aA@', 'hieutruong', 'hieutruong123',
    'hieutruong_hoanang', 'hr123', 'hr', 'HoaNang123', 'HoaNang@123', 'Admin@123',
    'School@123', 'Son123', 'cogiao', 'demo123', 'password', '12345678', '123456789',
    'admin', 'teacher', 'chef', 'guard', 'accountant', 'parent', 'phuhuynh', '1234'
  ];
  for (const u of users) {
    const h = u.passwordHash || u.password;
    let matched = null;
    for (const p of candidates) {
      if (h && bcrypt.compareSync(p, h)) {
        matched = p;
        break;
      }
    }
    console.log(u.username, u.role, matched ? `FOUND: ${matched}` : 'NO_MATCH');
  }
  await mongoose.disconnect();
}

main().catch(console.error);
