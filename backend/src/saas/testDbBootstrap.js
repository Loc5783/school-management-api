const mongoose = require('mongoose');

// Internal provenance registry in memory (private to this process)
// Maps connection or URI to verified test instance metadata
const verifiedConnections = new WeakSet();
const verifiedRecords = new WeakMap();
const registeredUris = new Map();

function normalizeUri(uri) {
  if (!uri || typeof uri !== 'string') return '';
  return uri.trim().replace(/\/+$/, '');
}

function parseUriDetails(rawUri) {
  const cleanUri = normalizeUri(rawUri);
  const parsed = new URL(cleanUri.replace(/^mongodb(\+srv)?:\/\//, 'http://'));
  const host = parsed.hostname;
  const port = parsed.port ? parseInt(parsed.port, 10) : 27017;
  const dbName = parsed.pathname.replace(/^\//, '').split('?')[0].trim() || 'test';
  return { host, port, dbName };
}

function registerTestInstance({ replSet, connection, uri }) {
  if (!connection) {
    throw new Error('BOOTSTRAP_ERROR: Cannot register null connection');
  }
  const cleanUri = normalizeUri(uri);
  const { host, port, dbName } = parseUriDetails(cleanUri);

  const record = {
    replSet,
    connection,
    uri: cleanUri,
    host,
    port,
    dbName,
    active: true,
    createdAt: new Date()
  };

  verifiedConnections.add(connection);
  verifiedRecords.set(connection, record);
  registeredUris.set(cleanUri, record);
  // Also register normalized origin base
  registeredUris.set(`mongodb://${host}:${port}/${dbName}`, record);

  return record;
}

function unregisterTestInstance(connectionOrUri) {
  if (!connectionOrUri) return;
  if (typeof connectionOrUri === 'string') {
    const cleanUri = normalizeUri(connectionOrUri);
    const record = registeredUris.get(cleanUri);
    if (record) {
      record.active = false;
      registeredUris.delete(cleanUri);
      if (record.connection) {
        // Only remove connection from verified set if no other active URI references it
        let otherActive = false;
        for (const r of registeredUris.values()) {
          if (r.active && r.connection === record.connection) {
            otherActive = true;
            break;
          }
        }
        if (!otherActive) {
          verifiedConnections.delete(record.connection);
          verifiedRecords.delete(record.connection);
        }
      }
    }
  } else if (typeof connectionOrUri === 'object') {
    const record = verifiedRecords.get(connectionOrUri);
    if (record) {
      record.active = false;
      if (record.uri && registeredUris.get(record.uri) === record) {
        registeredUris.delete(record.uri);
      }
      verifiedConnections.delete(connectionOrUri);
      verifiedRecords.delete(connectionOrUri);
    }
  }
}

function isVerifiedConnection(conn) {
  if (!conn || typeof conn !== 'object') return false;
  if (!verifiedConnections.has(conn)) return false;
  const record = verifiedRecords.get(conn);
  return Boolean(record && record.active);
}

function getVerifiedRecord(conn) {
  if (!conn || typeof conn !== 'object') return null;
  return verifiedRecords.get(conn) || null;
}

function isRegisteredUri(uri) {
  if (!uri || typeof uri !== 'string') return false;
  const cleanUri = normalizeUri(uri);
  const record = registeredUris.get(cleanUri);
  if (record && record.active) return true;

  try {
    const { host, port, dbName } = parseUriDetails(cleanUri);
    const canonical = `mongodb://${host}:${port}/${dbName}`;
    const canonicalRecord = registeredUris.get(canonical);
    return Boolean(canonicalRecord && canonicalRecord.active);
  } catch {
    return false;
  }
}

function getRegisteredRecordByUri(uri) {
  if (!uri || typeof uri !== 'string') return null;
  const cleanUri = normalizeUri(uri);
  return registeredUris.get(cleanUri) || null;
}

async function startTestDb(options = {}) {
  // Nạp lười (lazy-load) thư viện devDependency chỉ khi chạy kiểm thử, tránh lỗi thiếu gói trong môi trường Production (--omit=dev)
  const { MongoMemoryReplSet } = require('mongodb-memory-server');
  // 1. Controlled bootstrap spawns MongoMemoryReplSet
  const replSet = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: 'wiredTiger'
    },
    ...options
  });

  const uri = normalizeUri(replSet.getUri());
  const { host, port, dbName } = parseUriDetails(uri);

  // 2. Prevent Mongoose from auto-creating indexes before guard validation
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);

  // 3. Connect to in-memory instance
  let connection;
  if (options.useCreateConnection) {
    connection = await mongoose.createConnection(uri, {
      autoIndex: false,
      autoCreate: false
    }).asPromise();
  } else {
    await mongoose.connect(uri, {
      autoIndex: false,
      autoCreate: false
    });
    connection = mongoose.connection;
  }

  // 4. Register instance provenance in internal registry
  const record = registerTestInstance({ replSet, connection, uri });

  // 5. Enforce guard immediately upon bootstrap (prior to any index/seed/write)
  const { assertIsolatedTestDb } = require('./safeDbGuard');
  if (!options.useCreateConnection) {
    assertIsolatedTestDb(connection, uri);

    // 6. After guard confirms safety, sync indexes for Phase 1A models on the verified connection
    const Tenant = require('../models/zone1_system/Tenant');
    const User = require('../models/zone1_system/User');
    const PlatformAdmin = require('../models/zone1_system/PlatformAdmin');
    const PlatformAuditLog = require('../models/zone1_system/PlatformAuditLog');
    const RevokedSession = require('../models/zone1_system/RevokedSession');
    const MfaChallenge = require('../models/zone1_system/MfaChallenge');

    await Promise.all([
      Tenant.syncIndexes().catch(() => {}),
      User.syncIndexes().catch(() => {}),
      PlatformAdmin.syncIndexes().catch(() => {}),
      PlatformAuditLog.syncIndexes().catch(() => {}),
      RevokedSession.syncIndexes().catch(() => {}),
      MfaChallenge.syncIndexes().catch(() => {})
    ]);
  }

  const stop = async () => {
    try {
      unregisterTestInstance(connection);
      if (connection.readyState !== 0) {
        await connection.close();
      }
    } finally {
      if (replSet) {
        await replSet.stop();
      }
    }
  };

  return {
    replSet,
    connection,
    uri,
    host,
    port,
    dbName,
    stop
  };
}

module.exports = {
  startTestDb,
  registerTestInstance,
  unregisterTestInstance,
  isVerifiedConnection,
  getVerifiedRecord,
  isRegisteredUri,
  getRegisteredRecordByUri
};
