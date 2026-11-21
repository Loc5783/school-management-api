'use strict';

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { EJSON } = require('bson');

const TARGET_BACKUP_PATH = 'E:/school-mongo-recovery-20261106/two-school-test-20261111/snapshot_pre_cutover_live.ejson';
const LIVE_URI = 'mongodb://127.0.0.1:27018/school_management?replicaSet=rs0&directConnection=true&readPreference=primaryPreferred';

async function createPreCutoverBackup() {
  console.log('=== TẠO BẢN SAO LƯU TRƯỚC KHI CUTOVER BẢN CHÍNH (school_management) ===');
  console.log('Connecting to mongodb 127.0.0.1:27018/school_management...');
  await mongoose.connect(LIVE_URI);
  const db = mongoose.connection.db;

  const cols = await db.listCollections().toArray();
  console.log(`Found ${cols.length} collections.`);

  const snapshotCollections = [];
  let totalDocs = 0;
  let totalIndexes = 0;

  for (const c of cols) {
    const colName = c.name;
    const documents = await db.collection(colName).find({}).toArray();
    const indexes = await db.collection(colName).indexes();
    totalDocs += documents.length;
    totalIndexes += indexes.length;

    snapshotCollections.push({
      name: colName,
      indexes,
      documents
    });
  }

  const payload = {
    database: 'school_management',
    createdAt: new Date(),
    collectionsCount: snapshotCollections.length,
    totalDocuments: totalDocs,
    totalIndexes: totalIndexes,
    collections: snapshotCollections
  };

  const serialized = EJSON.stringify(payload, null, 2);
  fs.writeFileSync(TARGET_BACKUP_PATH, serialized, 'utf8');

  console.log(`Pre-cutover backup completed successfully!`);
  console.log(`Output: ${TARGET_BACKUP_PATH}`);
  console.log(`Collections: ${snapshotCollections.length}`);
  console.log(`Total documents: ${totalDocs}`);
  console.log(`Total indexes: ${totalIndexes}`);

  await mongoose.disconnect();
}

createPreCutoverBackup().catch(err => {
  console.error('Lỗi tạo backup:', err);
  process.exit(1);
});
