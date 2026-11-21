'use strict';

const path = require('path');
process.env.NODE_PATH = path.join(__dirname, '../backend/node_modules');
require('module').Module._initPaths();

const mongoose = require('mongoose');
const testDbBootstrap = require('../backend/src/saas/testDbBootstrap');
const { assertIsolatedTestDb } = require('../backend/src/saas/safeDbGuard');

async function test() {
  const uri = 'mongodb://127.0.0.1:27018/school_isolation_audit?replicaSet=rs0';
  const conn = await mongoose.createConnection(uri).asPromise();
  
  testDbBootstrap.registerTestInstance({
    connection: conn,
    uri
  });

  console.log('Testing safeDbGuard...');
  assertIsolatedTestDb(conn, uri);
  console.log('SAFE DB GUARD PASSED FOR ISOLATED DB!');

  await conn.close();
}

test().catch(console.error);
