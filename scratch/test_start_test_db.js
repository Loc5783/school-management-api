'use strict';

const path = require('path');
process.env.NODE_PATH = path.join(__dirname, '../backend/node_modules');
require('module').Module._initPaths();

const { startTestDb } = require('../backend/src/saas/testDbBootstrap');
const createSaasApp = require('../backend/src/saas/createSaasApp');

async function main() {
  console.log('Starting test DB via startTestDb()...');
  const { connection, uri, stop } = await startTestDb();
  console.log('Test DB started at URI:', uri);

  const app = createSaasApp({
    connection,
    mongoUri: uri,
    saasMode: 'phase1e'
  });
  console.log('SaaS App successfully created with test DB!');

  await stop();
  console.log('Test DB stopped cleanly.');
}

main().catch(console.error);
