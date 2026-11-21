const mongoose = require('mongoose');
const testDbBootstrap = require('./testDbBootstrap');

function maskUri(rawUri) {
  if (!rawUri || typeof rawUri !== 'string') return '[EMPTY_URI]';
  try {
    const parsed = new URL(rawUri.replace(/^mongodb(\+srv)?:\/\//, 'http://'));
    const host = parsed.hostname || 'unknown-host';
    const port = parsed.port || 'default-port';
    const db = (parsed.pathname.replace(/^\//, '').split('?')[0]) || 'unknown-db';
    return `[MASKED_URI: host=${host}, port=${port}, db=${db}]`;
  } catch {
    return '[MALFORMED_URI]';
  }
}

function verifyParsedUri(rawUri, fallbackDbName) {
  if (!rawUri || typeof rawUri !== 'string' || !rawUri.trim()) {
    throw new Error('CRITICAL_SAFETY_VIOLATION: NO_TEST_CONFIG');
  }

  const cleanUri = rawUri.trim();

  // Fail-closed on cloud or replica-set srv schemes
  if (cleanUri.startsWith('mongodb+srv:') || /atlas|cloud|prod/i.test(cleanUri)) {
    throw new Error('CRITICAL_SAFETY_VIOLATION: REMOTE_DB_NOT_PERMITTED');
  }

  // Parse structured URI
  let parsed;
  try {
    parsed = new URL(cleanUri.replace(/^mongodb:\/\//, 'http://'));
  } catch (err) {
    throw new Error('CRITICAL_SAFETY_VIOLATION: MALFORMED_URI');
  }

  const host = parsed.hostname;
  const port = parsed.port ? parseInt(parsed.port, 10) : 27017;
  const pathDb = parsed.pathname.replace(/^\//, '').split('?')[0].trim();
  const dbName = pathDb || fallbackDbName || '';

  // Must be strictly local loopback
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('CRITICAL_SAFETY_VIOLATION: REMOTE_DB_NOT_PERMITTED ' + maskUri(cleanUri));
  }

  // Blocked database names
  const blockedDbNames = ['admin', 'config', 'local', 'school_management', 'production', 'prod'];
  if (dbName && blockedDbNames.includes(dbName.toLowerCase())) {
    throw new Error('CRITICAL_SAFETY_VIOLATION: INVALID_OR_BLOCKED_DB_NAME ' + maskUri(cleanUri));
  }

  // LỖI 1: Không suy luận "cổng khác 27017 thì an toàn".
  // Yêu cầu URI phải có đăng ký provenance từ controlled test bootstrap.
  if (!testDbBootstrap.isRegisteredUri(cleanUri)) {
    throw new Error(
      'CRITICAL_SAFETY_VIOLATION: UNREGISTERED_TEST_DB_URI. ' +
      'URI local không có nguồn xác minh từ controlled test bootstrap: ' +
      maskUri(cleanUri)
    );
  }

  return { host, port, dbName, rawPathDb: pathDb };
}

function assertIsolatedTestDb(arg1, arg2, session) {
  let conn = null;
  let targetUri = null;

  if (arg1 && typeof arg1 === 'object' && typeof arg1.readyState === 'number') {
    conn = arg1;
    targetUri = typeof arg2 === 'string' ? arg2 : null;
  } else if (arg2 && typeof arg2 === 'object' && typeof arg2.readyState === 'number') {
    conn = arg2;
    targetUri = typeof arg1 === 'string' ? arg1 : null;
  } else {
    // Không fallback sang mongoose.connection mặc định nếu không cung cấp connection hợp lệ
    throw new Error(
      'CRITICAL_SAFETY_VIOLATION: NO_VALID_CONNECTION_PROVIDED. ' +
      'A verified active database connection is strictly required.'
    );
  }

  // 1. Connection must be in active connected state (readyState === 1)
  if (!conn || conn.readyState !== 1) {
    throw new Error('CRITICAL_SAFETY_VIOLATION: CONNECTION_NOT_READY. Database connection must be active.');
  }

  // 2. Connection must be managed and verified by testDbBootstrap
  if (!testDbBootstrap.isVerifiedConnection(conn)) {
    throw new Error(
      'CRITICAL_SAFETY_VIOLATION: UNVERIFIED_CONNECTION_SOURCE. ' +
      'Database connection was not created or verified by the controlled test bootstrap.'
    );
  }

  const record = testDbBootstrap.getVerifiedRecord(conn);
  const connHost = conn.host;
  const connPort = conn.port;
  const connDbName = conn.name;

  if (connHost !== '127.0.0.1' && connHost !== 'localhost') {
    throw new Error('CRITICAL_SAFETY_VIOLATION: ACTIVE_CONNECTION_REMOTE');
  }

  // 3. Database name must match the verified bootstrap record
  if (record && record.dbName && connDbName && record.dbName.toLowerCase() !== connDbName.toLowerCase()) {
    throw new Error(
      `CRITICAL_SAFETY_VIOLATION: DB_NAME_MISMATCH. Connection DB name ('${connDbName}') does not match verified bootstrap record ('${record.dbName}').`
    );
  }

  // 4. If targetUri is provided, verify it against the bootstrap registry and connection
  if (targetUri) {
    const parsed = verifyParsedUri(targetUri, connDbName);
    if (parsed.host !== connHost || parsed.port !== connPort) {
      throw new Error(
        'CRITICAL_SAFETY_VIOLATION: CONNECTION_MISMATCH. Passed URI host/port does not match active connection.'
      );
    }
    if (parsed.rawPathDb && connDbName && parsed.rawPathDb.toLowerCase() !== connDbName.toLowerCase()) {
      throw new Error(
        `CRITICAL_SAFETY_VIOLATION: DB_NAME_MISMATCH. Passed URI database name ('${parsed.rawPathDb}') does not match active connection ('${connDbName}').`
      );
    }
  }

  // 5. Verify that all Phase 1A models are bound to this exact verified connection
  const modelsToVerify = [
    require('../models/zone1_system/User'),
    require('../models/zone1_system/Tenant'),
    require('../models/zone1_system/PlatformAdmin'),
    require('../models/zone1_system/PlatformAuditLog'),
    require('../models/zone1_system/RevokedSession'),
    require('../models/zone1_system/Subscription'),
    require('../models/zone1_system/MfaChallenge')
  ];

  for (const model of modelsToVerify) {
    if (model && model.db) {
      if (model.db !== conn) {
        throw new Error(
          `CRITICAL_SAFETY_VIOLATION: MODEL_CONNECTION_MISMATCH. Model '${model.modelName}' is bound to a different connection than the verified connection.`
        );
      }
    }
  }

  // 6. Verify transaction session uses the verified connection
  if (session) {
    const sessionClient = session.client || session.clientPromise;
    const connClient = conn.getClient ? conn.getClient() : conn.client;
    if (sessionClient && connClient && sessionClient !== connClient) {
      throw new Error(
        'CRITICAL_SAFETY_VIOLATION: SESSION_CONNECTION_MISMATCH. Transaction session does not share the verified connection.'
      );
    }
  }

  return true;
}

function assertNoWorkersRunning() {
  if (process.env.TIMEKEEPING_SCHEDULER_ENABLED === 'true' && process.env.SAAS_MODE === 'phase1a') {
    throw new Error('CRITICAL_SAFETY_VIOLATION: Schedulers/workers không được phép kích hoạt trong Giai đoạn 1A!');
  }
  return true;
}

module.exports = {
  maskUri,
  verifyParsedUri,
  assertIsolatedTestDb,
  assertNoWorkersRunning
};
