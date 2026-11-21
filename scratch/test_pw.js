'use strict';
const bcrypt = require('../backend/node_modules/bcryptjs');
const mongoose = require('../backend/node_modules/mongoose');

async function main() {
  await mongoose.connect('mongodb://127.0.0.1:27018/school_management?replicaSet=rs0');
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const ht = await User.findOne({ username: 'hieutruong_hoanang' }).lean();
  const hr = await User.findOne({ username: 'hr' }).lean();
  const htHash = ht.passwordHash;
  const hrHash = hr.passwordHash;

  const bases = [
    '123456', '12345678', '123456789', 'admin', 'admin123', 'password', 'password123',
    'hoanang', 'hoanang123', 'hoanang2026', 'HoaNang123', 'HoaNang@123', 'HoaNang@2026',
    'hieutruong', 'hieutruong123', 'hieutruong2026', 'HieuTruong123', 'HieuTruong@123',
    'hr', 'hr123', 'hr2026', 'Hr@123', 'Hr@2026', 'nhansu', 'nhansu123', 'Nhansu@123',
    'principal', 'principal123', 'Principal@123', '123456aA@', '123456Aa@', 'Abc@123',
    'Abc@123456', 'P@ssword123', 'Pass@123', 'Password@123', 'School@123', 'School123',
    'mamnon', 'mamnonhoanang', 'mamnon123', 'truongmamnon', '111111', '123123', 'abc123'
  ];

  console.log('Testing', bases.length, 'candidates...');
  for (const b of bases) {
    if (bcrypt.compareSync(b, htHash)) {
      console.log('>>> MATCH HT:', b);
    }
    if (bcrypt.compareSync(b, hrHash)) {
      console.log('>>> MATCH HR:', b);
    }
  }
  console.log('Done test.');
  await mongoose.disconnect();
}

main().catch(console.error);
