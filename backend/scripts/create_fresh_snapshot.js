'use strict';

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { EJSON } = require('bson');

const TARGET_SNAPSHOT_PATH = 'E:/school-mongo-recovery-20261106/two-school-test-20261111/snapshot_fresh.ejson';
const LIVE_URI = 'mongodb://127.0.0.1:27018/school_management?replicaSet=rs0&directConnection=true&readPreference=primaryPreferred';

async function createFreshSnapshot() {
  console.log('Connecting to live database school_management in read-only mode...');
  await mongoose.connect(LIVE_URI);
  const db = mongoose.connection.db;

  const cols = await db.listCollections().toArray();
  console.log(`Found ${cols.length} collections.`);

  const snapshotCollections = [];
  let totalDocs = 0;

  for (const c of cols) {
    const colName = c.name;
    const documents = await db.collection(colName).find({}).toArray();
    const indexes = await db.collection(colName).indexes();
    totalDocs += documents.length;

    snapshotCollections.push({
      name: colName,
      indexes,
      documents
    });
  }

  const payload = {
    database: 'school_management',
    createdAt: new Date(),
    collections: snapshotCollections
  };

  const serialized = EJSON.stringify(payload, null, 2);
  fs.writeFileSync(TARGET_SNAPSHOT_PATH, serialized, 'utf8');

  console.log(`Fresh snapshot created successfully!`);
  console.log(`Path: ${TARGET_SNAPSHOT_PATH}`);
  console.log(`Collections: ${snapshotCollections.length}`);
  console.log(`Total documents: ${totalDocs}`);

  await mongoose.disconnect();
}

createFreshSnapshot().catch(err => {
  console.error('Error creating fresh snapshot:', err);
  process.exit(1);
});
