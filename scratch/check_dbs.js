'use strict';

const path = require('path');
process.env.NODE_PATH = path.join(__dirname, '../backend/node_modules');
require('module').Module._initPaths();

const mongoose = require('mongoose');

async function main() {
  await mongoose.connect('mongodb://127.0.0.1:27018/school_management?replicaSet=rs0');
  const admin = mongoose.connection.db.admin();
  const dbs = await admin.listDatabases();
  console.log('Databases:', dbs.databases.map(d => ({ name: d.name, sizeOnDisk: d.sizeOnDisk })));
  await mongoose.disconnect();
}

main().catch(console.error);
