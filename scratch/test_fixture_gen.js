'use strict';

const path = require('path');
process.env.NODE_PATH = path.join(__dirname, '../backend/node_modules');
require('module').Module._initPaths();

const { startTestDb } = require('../backend/src/saas/testDbBootstrap');
const { generateIsolationFixtures } = require('../backend/scripts/fixtures/generate_isolation_fixtures');

async function main() {
  console.log('Starting test DB...');
  const { connection, uri, stop } = await startTestDb();
  console.log('Seeding isolation fixtures...');
  const res = await generateIsolationFixtures();
  console.log('Seeded successfully!');
  console.log('Manifest entries count:', Object.keys(res.manifest).length);
  await stop();
  console.log('Stopped.');
}

main().catch(err => {
  console.error('Error in main:', err);
  process.exit(1);
});
