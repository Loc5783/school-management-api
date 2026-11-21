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

  // Login as guard A
  const resLoginA = await request(app)
    .post('/api/auth/login')
    .send({ schoolCode: 'HOANANG-A', username: 'iso_a_guard', password: TEST_PASSWORD });
  const tokenA = resLoginA.body.token;

  console.log('Testing GET /api/guard/visitors with token A...');
  const resVisitors = await request(app)
    .get('/api/guard/visitors')
    .set('Authorization', `Bearer ${tokenA}`);
  
  const visitorsText = JSON.stringify(resVisitors.body);
  console.log('Visitors text contains ISO_A_VISITOR_NAM:', visitorsText.includes('ISO_A_VISITOR_NAM'));
  console.log('Visitors text contains ISO_B_VISITOR_LAN (LEAK!):', visitorsText.includes('ISO_B_VISITOR_LAN'));

  console.log('\nTesting GET /api/guard/incidents with token A...');
  const resIncidents = await request(app)
    .get('/api/guard/incidents')
    .set('Authorization', `Bearer ${tokenA}`);
  
  const incidentsText = JSON.stringify(resIncidents.body);
  console.log('Incidents text contains ISO_A_INCIDENT_CUA_SO:', incidentsText.includes('ISO_A_INCIDENT_CUA_SO'));
  console.log('Incidents text contains ISO_B_INCIDENT_HANG_RAO (LEAK!):', incidentsText.includes('ISO_B_INCIDENT_HANG_RAO'));

  await stop();
}

main().catch(console.error);
