'use strict';

const mongoose = require('mongoose');
const assembleSaasApp = require('./assembleSaasApp');

/**
 * Production SaaS App Factory for local host deployment (e.g. port 5001).
 * Strictly verifies target connection, binds to local loopback, enforces autoIndex: false,
 * and ensures schedulers remain disabled.
 */
const createProductionSaasApp = (options = {}) => {
  const connection = options.connection || mongoose.connection;
  if (!connection || connection.readyState !== 1) {
    throw new Error('createProductionSaasApp: Database connection must be active and connected (readyState === 1)');
  }

  // 1. Verify host is strictly local loopback
  const host = connection.host || '';
  const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!isLoopback) {
    throw new Error(`createProductionSaasApp: Target host "${host}" is not an authorized local loopback address.`);
  }

  // 2. Verify target database name
  const allowedDbs = options.allowedDbNames || ['school_management'];
  const dbName = connection.name || '';
  if (!allowedDbs.includes(dbName)) {
    throw new Error(`createProductionSaasApp: Target database "${dbName}" is not in authorized databases: [${allowedDbs.join(', ')}]`);
  }

  // 3. Verify autoIndex is disabled
  const autoIndex = mongoose.get('autoIndex');
  if (autoIndex !== false) {
    throw new Error('createProductionSaasApp: autoIndex must be explicitly disabled (mongoose.set("autoIndex", false)) to protect production indexes');
  }

  // 4. Verify schedulers remain disabled
  if (process.env.TIMEKEEPING_SCHEDULER_ENABLED !== 'false') {
    throw new Error('createProductionSaasApp: TIMEKEEPING_SCHEDULER_ENABLED must be "false" for production cutover');
  }

  const saasMode = options.saasMode || 'phase1e';

  return assembleSaasApp({
    ...options,
    saasMode
  });
};

module.exports = createProductionSaasApp;
