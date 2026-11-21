'use strict';

const path = require('path');
process.env.NODE_PATH = path.join(__dirname, '../backend/node_modules');
require('module').Module._initPaths();

const { startTestDb } = require('../backend/src/saas/testDbBootstrap');
const { generateIsolationFixtures, TEST_PASSWORD } = require('../backend/scripts/fixtures/generate_isolation_fixtures');
const User = require('../backend/src/models/zone1_system/User');
const Tenant = require('../backend/src/models/zone1_system/Tenant');
const bcrypt = require('bcryptjs');
const { generateSchoolUserToken } = require('../backend/src/saas/utils/saasJwt');

async function main() {
  const { stop } = await startTestDb();
  await generateIsolationFixtures();

  try {
    const tenant = await Tenant.findOne({ code: 'HOANANG-A' });
    console.log('Tenant:', tenant?.code);
    const user = await User.findOne({ username: 'iso_a_admin', tenantId: tenant._id });
    console.log('User:', user?.username);
    const isMatch = await bcrypt.compare(TEST_PASSWORD, user.passwordHash);
    console.log('Password match:', isMatch);
    user.lastLogin = new Date();
    await user.save();
    console.log('User saved.');
    const token = generateSchoolUserToken(user, tenant);
    console.log('Token generated:', Boolean(token));
  } catch (err) {
    console.error('DEBUG CAUGHT ERROR:', err);
  }

  await stop();
}

main().catch(console.error);
