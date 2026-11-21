'use strict';
const path = require('path');
process.env.NODE_PATH = path.join(__dirname, '../backend/node_modules');
require('module').Module._initPaths();
const mongoose = require('mongoose');

async function check() {
  await mongoose.connect('mongodb://127.0.0.1:27018/school_management?replicaSet=rs0');
  const db = mongoose.connection.db;
  const userB = await db.collection('users').findOne({ username: 'giaovien_b' });
  console.log('giaovien_b id:', userB._id);
  await db.collection('internalannouncements').updateOne(
    { title: 'Thông báo Họp Phụ Huynh Cơ Sở B' },
    { $set: { recipientIds: [userB._id] } }
  );
  console.log('Updated recipientIds for notice B');
  await mongoose.disconnect();
}
check().catch(console.error);
