'use strict';

const { assertIsolatedTestDb, assertNoWorkersRunning } = require('./safeDbGuard');
const assembleSaasApp = require('./assembleSaasApp');

const createSaasApp = (options = {}) => {
  // Enforce safety guards unconditionally - no bypass flag allowed
  // Enforce verified connection from controlled test bootstrap (fail-closed if missing)
  assertIsolatedTestDb(options.connection, options.mongoUri);
  assertNoWorkersRunning();

  return assembleSaasApp(options);
};

module.exports = createSaasApp;
