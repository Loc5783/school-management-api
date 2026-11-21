'use strict';

const path = require('path');
process.env.NODE_PATH = path.join(__dirname, '../backend/node_modules');
require('module').Module._initPaths();
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const request = require('supertest');
const { startTestDb } = require('../backend/src/saas/testDbBootstrap');
const createSaasApp = require('../backend/src/saas/createSaasApp');
const { generateIsolationFixtures, TEST_PASSWORD } = require('../backend/scripts/fixtures/generate_isolation_fixtures');

async function main() {
  const { connection, uri, stop } = await startTestDb();
  await generateIsolationFixtures();
  const app = createSaasApp({ connection, mongoUri: uri, saasMode: 'phase1e' });

  const roles = ['admin', 'principal', 'hr', 'accountant', 'teacher', 'chef', 'guard', 'parent'];

  console.log('Testing authentication for all 8 roles in HOANANG-A and HOANANG-B...');
  for (const role of roles) {
    // School A
    const resA = await request(app)
      .post('/api/auth/login')
      .send({
        schoolCode: 'HOANANG-A',
        username: `iso_a_${role}`,
        password: TEST_PASSWORD
      });
    if (resA.status !== 200 || !resA.body.token) {
      throw new Error(`Failed to login as iso_a_${role}: ${resA.status} - ${JSON.stringify(resA.body)}`);
    }

    // School B
    const resB = await request(app)
      .post('/api/auth/login')
      .send({
        schoolCode: 'HOANANG-B',
        username: `iso_b_${role}`,
        password: TEST_PASSWORD
      });
    if (resB.status !== 200 || !resB.body.token) {
      throw new Error(`Failed to login as iso_b_${role}: ${resB.status} - ${JSON.stringify(resB.body)}`);
    }

    console.log(`  [OK] role=${role} authenticated successfully for both HOANANG-A and HOANANG-B`);
  }

  await stop();
  console.log('All 16 accounts authenticated successfully!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
