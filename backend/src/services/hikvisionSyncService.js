'use strict';

const mongoose = require('mongoose');
const TimekeepingDevice = require('../models/zone2_hr/TimekeepingDevice');
const AttendanceDevicePersonMapping = require('../models/zone2_hr/AttendanceDevicePersonMapping');
const DeviceSyncLog = require('../models/zone2_hr/DeviceSyncLog');
const RawAttendanceEvent = require('../models/zone2_hr/RawAttendanceEvent');
const Tenant = require('../models/zone1_system/Tenant');
const hikvisionIsapiService = require('./hikvisionIsapiService');
const { ingestDeviceEvent } = require('./attendanceDeviceService');
const { DEFAULT_SCHOOL_TIMEZONE, getWorkDate } = require('../utils/dateHelpers');

// Fast in-process single-flight lock map
const activeSyncJobs = new Set();

/**
 * Validates that credentialKey belongs to the tenant's allowlist.
 * Prevents cross-tenant credential theft (e.g. Tenant B using HIKVISION_HOANANG_A).
 */
function validateTenantCredentialKey(tenantCode, credentialKey) {
  if (!tenantCode) {
    throw new hikvisionIsapiService.HikvisionError(
      'Không thể xác định mã trường (tenant code)',
      'DEVICE_NO_TENANT',
      403
    );
  }
  const cleanCode = String(tenantCode).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  const allowedPrefix = `HIKVISION_${cleanCode}`;

  if (!credentialKey) {
    return allowedPrefix;
  }

  const cleanKey = String(credentialKey).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  if (!cleanKey.startsWith(allowedPrefix) && cleanKey !== allowedPrefix) {
    throw new hikvisionIsapiService.HikvisionError(
      `Tenant "${tenantCode}" không có quyền sử dụng khóa xác thực "${credentialKey}"`,
      'FORBIDDEN_CREDENTIAL_KEY',
      403
    );
  }
  return cleanKey;
}

/**
 * Resolves credentials for a device strictly scoped to its tenant.
 * Does NOT default to HIKVISION_HOANANG_A for other tenants.
 */
async function resolveDeviceCredentials(device) {
  let tenantCode = null;
  if (device.tenantId && typeof device.tenantId === 'object' && device.tenantId.code) {
    tenantCode = device.tenantId.code;
  } else if (device.tenantId) {
    const tenantDoc = await Tenant.findById(device.tenantId).lean();
    if (tenantDoc) {
      tenantCode = tenantDoc.code;
    }
  }

  if (!tenantCode) {
    throw new hikvisionIsapiService.HikvisionError(
      'Thiết bị chưa được gán trường học (tenant) hợp lệ',
      'DEVICE_NO_TENANT',
      403
    );
  }

  const prefix = validateTenantCredentialKey(tenantCode, device.credentialKey);

  const username = process.env[`${prefix}_USERNAME`];
  const password = process.env[`${prefix}_PASSWORD`];
  const baseUrl = process.env[`${prefix}_BASE_URL`];
  const allowSelfSignedStr = process.env[`${prefix}_ALLOW_SELF_SIGNED`];

  return {
    prefix,
    username,
    password,
    baseUrl,
    allowSelfSigned: allowSelfSignedStr !== 'false'
  };
}

/**
 * Builds deviceConfig payload for hikvisionIsapiService.
 */
async function buildDeviceConfig(device, overrideCreds = {}) {
  const creds = await resolveDeviceCredentials(device);
  return {
    host: device.host,
    httpPort: device.httpPort || 80,
    httpsPort: device.httpsPort || 443,
    useHttps: device.protocol === 'ISAPI' && device.httpsPort !== 80,
    allowSelfSigned: device.allowSelfSigned !== false && creds.allowSelfSigned !== false,
    timeoutMs: device.timeoutMs || 5000,
    username: overrideCreds.username || creds.username,
    password: overrideCreds.password || creds.password,
    _allowLoopbackForTesting: Boolean(device._allowLoopbackForTesting || overrideCreds._allowLoopbackForTesting)
  };
}

/**
 * Tests connection to a physical or mock ISAPI device.
 */
async function testDeviceConnection(device, overrideCreds = {}) {
  let config;
  try {
    config = await buildDeviceConfig(device, overrideCreds);
  } catch (err) {
    return {
      success: false,
      status: 'ERROR',
      code: err.code || 'CREDENTIAL_ERROR',
      message: err.message
    };
  }

  if (!config.username || !config.password) {
    return {
      success: false,
      status: 'NOT_RUN_MISSING_SECRET',
      code: 'DEVICE_CREDENTIALS_MISSING',
      message: 'Chưa cấu hình tài khoản/mật khẩu thiết bị trong biến môi trường'
    };
  }

  try {
    const info = await hikvisionIsapiService.getDeviceInfo(config);

    device.status = 'ONLINE';
    device.statusMessage = `Đã kết nối: ${info.model || device.model} (Serial: ${info.serialNumber || 'N/A'})`;
    device.lastSeenAt = new Date();
    if (info.serialNumber && !device.serialNumber) {
      device.serialNumber = info.serialNumber;
    }
    if (info.model && !device.model) {
      device.model = info.model;
    }
    await device.save();

    return {
      success: true,
      status: 'ONLINE',
      deviceInfo: info
    };
  } catch (err) {
    const isAuthFailed = err.code === 'DEVICE_AUTH_FAILED';
    device.status = isAuthFailed ? 'AUTH_FAILED' : 'OFFLINE';
    device.statusMessage = err.message;
    await device.save();

    return {
      success: false,
      status: device.status,
      code: err.code || 'CONNECTION_FAILED',
      message: err.message
    };
  }
}

/**
 * Synchronizes events from an ISAPI device into our multi-tenant attendance engine.
 * Uses atomic distributed lease with periodic heartbeat renewal in MongoDB and in-process single-flight lock.
 */
async function syncDeviceEvents(device, options = {}) {
  const deviceIdStr = device._id.toString();
  const workerId = options.workerId || `worker-${process.pid}-${Date.now()}`;
  const leaseTtlMs = options.leaseTtlMs || 60000; // 60s TTL
  const now = new Date();

  // In-process lock check
  if (activeSyncJobs.has(deviceIdStr)) {
    throw new hikvisionIsapiService.HikvisionError(
      'Tiến trình đồng bộ đang chạy trên thiết bị này. Vui lòng đợi job hoàn tất.',
      'JOB_ALREADY_RUNNING',
      409
    );
  }

  if (!device.enabled) {
    throw new hikvisionIsapiService.HikvisionError(
      'Thiết bị đã bị vô hiệu hóa, không thể thực hiện đồng bộ.',
      'DEVICE_DISABLED',
      403
    );
  }

  // Atomic distributed single-flight lease acquisition in MongoDB
  const leaseExpiresAt = new Date(now.getTime() + leaseTtlMs);
  const leaseFilter = {
    _id: device._id,
    $or: [
      { 'syncLease.lockedBy': null },
      { 'syncLease.expiresAt': { $lte: now } },
      { 'syncLease.lockedBy': { $exists: false } }
    ]
  };
  const leaseUpdate = {
    $set: {
      'syncLease.lockedBy': workerId,
      'syncLease.lockedAt': now,
      'syncLease.expiresAt': leaseExpiresAt
    }
  };

  const acquiredDevice = await TimekeepingDevice.findOneAndUpdate(leaseFilter, leaseUpdate, { returnDocument: 'after' });
  if (!acquiredDevice) {
    throw new hikvisionIsapiService.HikvisionError(
      'Tiến trình đồng bộ đang chạy trên thiết bị này bởi tiến trình khác.',
      'JOB_ALREADY_RUNNING',
      409
    );
  }

  activeSyncJobs.add(deviceIdStr);

  // Heartbeat lease renewal mechanism
  let leaseLost = false;
  let heartbeatTimer = null;
  const heartbeatIntervalMs = options.heartbeatIntervalMs || Math.max(500, Math.floor(leaseTtlMs / 3));

  heartbeatTimer = setInterval(async () => {
    try {
      const hbNow = new Date();
      const extendedExpiresAt = new Date(hbNow.getTime() + leaseTtlMs);
      const renewed = await TimekeepingDevice.findOneAndUpdate(
        {
          _id: device._id,
          'syncLease.lockedBy': workerId
        },
        {
          $set: {
            'syncLease.expiresAt': extendedExpiresAt,
            'syncLease.lockedAt': hbNow
          }
        },
        { returnDocument: 'after' }
      );
      if (!renewed) {
        leaseLost = true;
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      }
    } catch (hbErr) {
      console.error('Lỗi heartbeat gia hạn lease:', hbErr.message);
    }
  }, heartbeatIntervalMs);

  if (heartbeatTimer && typeof heartbeatTimer.unref === 'function') {
    heartbeatTimer.unref();
  }

  const syncLog = new DeviceSyncLog({
    tenantId: device.tenantId,
    deviceId: device._id,
    startedAt: new Date(),
    status: 'IN_PROGRESS',
    triggeredBy: options.triggeredBy || 'MANUAL',
    actorId: options.actorId || null
  });
  await syncLog.save();

  try {
    const config = await buildDeviceConfig(device, options.overrideCreds || {});
    if (!config.username || !config.password) {
      syncLog.status = 'FAILED';
      syncLog.completedAt = new Date();
      syncLog.errorMessage = 'Chưa cấu hình tài khoản/mật khẩu thiết bị trong biến môi trường';
      await syncLog.save();

      return {
        success: false,
        status: 'NOT_RUN_MISSING_SECRET',
        message: syncLog.errorMessage,
        log: syncLog
      };
    }

    // Determine query time range with 5-minute overlap window
    const syncStartTime = new Date();
    const endTime = hikvisionIsapiService.formatHikvisionTime(syncStartTime, device.timezone || DEFAULT_SCHOOL_TIMEZONE);

    let startTime;
    if (options.startTime) {
      startTime = options.startTime;
    } else if (device.lastSuccessfulEventAt) {
      // 5-minute overlap window
      const overlapMs = 5 * 60 * 1000;
      startTime = hikvisionIsapiService.formatHikvisionTime(
        new Date(device.lastSuccessfulEventAt.getTime() - overlapMs),
        device.timezone || DEFAULT_SCHOOL_TIMEZONE
      );
    } else {
      // Default: Beginning of today in local timezone
      const todayStr = getWorkDate(syncStartTime, device.timezone || DEFAULT_SCHOOL_TIMEZONE);
      startTime = `${todayStr}T00:00:00+07:00`;
    }

    device.lastSyncStartedAt = syncStartTime;
    await device.save();

    // Query events from ISAPI with multi-page pagination & safety cap
    const acsResult = await hikvisionIsapiService.getAcsEvents(config, {
      startTime,
      endTime,
      pageSize: options.pageSize || 30,
      safetyCap: options.safetyCap || 1000,
      maxPages: options.maxPages || 100
    });

    const verifyLeaseOwnership = async () => {
      if (leaseLost) {
        throw new hikvisionIsapiService.HikvisionError(
          'Khóa đồng bộ (syncLease) đã bị mất trong quá trình xử lý. Tiến trình bị hủy bỏ.',
          'LEASE_LOST',
          409
        );
      }
      const currentDoc = await TimekeepingDevice.findById(device._id).select('syncLease').lean();
      if (currentDoc?.syncLease?.lockedBy && currentDoc.syncLease.lockedBy !== workerId) {
        leaseLost = true;
        throw new hikvisionIsapiService.HikvisionError(
          'Khóa đồng bộ (syncLease) đã bị mất trong quá trình xử lý. Tiến trình bị hủy bỏ.',
          'LEASE_LOST',
          409
        );
      }
    };

    await verifyLeaseOwnership();

    const events = acsResult.events || [];
    syncLog.eventsFetched = events.length;

    // Load active person mappings for this device and tenant
    const mappings = await AttendanceDevicePersonMapping.find({
      tenantId: device.tenantId,
      deviceId: device._id,
      active: true
    });

    const mappingMap = new Map();
    mappings.forEach((m) => {
      mappingMap.set(String(m.externalPersonId).trim(), m);
    });

    let ingestedCount = 0;
    let duplicateCount = 0;
    let unmappedCount = 0;
    let failedCount = 0;
    let safeWatermark = device.lastSuccessfulEventAt || null;
    let encounteredError = false;

    const syncBatchId = `SYNC-${device.deviceCode}-${Date.now()}`;

    // Sort events ascending by occurred time to advance cursor safely
    events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    // Process each event
    for (const ev of events) {
      // Heartbeat lease ownership check
      if (leaseLost) {
        throw new hikvisionIsapiService.HikvisionError(
          'Khóa đồng bộ (syncLease) đã bị mất trong quá trình xử lý. Tiến trình bị hủy bỏ.',
          'LEASE_LOST',
          409
        );
      }

      try {
        const externalPersonId = String(ev.employeeNoString || ev.cardNo || '').trim();
        const occurredAt = new Date(ev.time);
        const externalEventId = ev.serialNo || `${device.deviceCode}-${externalPersonId}-${occurredAt.getTime()}`;

        const mapping = mappingMap.get(externalPersonId);

        if (mapping) {
          // Mapped Person (Employee or Student)
          const ingestPayload = {
            deviceId: device.deviceCode,
            externalEventId,
            tenantId: device.tenantId,
            externalPersonId,
            eventType: 'PUNCH',
            source: ev.authMethod === 'FACE' ? 'FACE' : (ev.authMethod === 'CARD' ? 'CARD' : 'DEVICE'),
            authenticationMethod: ev.authMethod,
            vendorEventCode: String(ev.minor || ''),
            syncBatchId,
            occurredAt,
            timezone: device.timezone || DEFAULT_SCHOOL_TIMEZONE,
            rawPayload: {
              major: ev.major,
              minor: ev.minor,
              cardNo: ev.cardNo,
              eventDescription: ev.eventDescription
            }
          };

          if (mapping.subjectType === 'STUDENT') {
            ingestPayload.subjectType = 'STUDENT';
            ingestPayload.studentId = mapping.subjectId;
          } else {
            ingestPayload.subjectType = 'EMPLOYEE';
            ingestPayload.userId = mapping.subjectId;
          }

          const ingestRes = await ingestDeviceEvent(ingestPayload);
          if (ingestRes.duplicate) {
            duplicateCount++;
          } else {
            ingestedCount++;
            mapping.lastMatchedAt = new Date();
            await mapping.save();
          }
        } else {
          // Unmapped Person: Store safely in RawAttendanceEvent with mappingStatus: UNMAPPED
          const ingestRes = await ingestDeviceEvent({
            deviceId: device.deviceCode,
            externalEventId,
            tenantId: device.tenantId,
            externalPersonId,
            eventType: 'PUNCH',
            source: ev.authMethod === 'FACE' ? 'FACE' : (ev.authMethod === 'CARD' ? 'CARD' : 'DEVICE'),
            authenticationMethod: ev.authMethod,
            vendorEventCode: String(ev.minor || ''),
            syncBatchId,
            occurredAt,
            mappingStatus: 'UNMAPPED',
            subjectType: 'UNKNOWN',
            employeeName: ev.name || `Chưa ánh xạ (${externalPersonId})`,
            timezone: device.timezone || DEFAULT_SCHOOL_TIMEZONE,
            rawPayload: {
              major: ev.major,
              minor: ev.minor,
              cardNo: ev.cardNo,
              name: ev.name
            }
          });

          if (ingestRes.duplicate) {
            duplicateCount++;
          } else {
            unmappedCount++;
          }
        }

        // Safe Watermark Rule: Only advance watermark if no error has occurred yet
        if (!encounteredError) {
          if (!safeWatermark || occurredAt > safeWatermark) {
            safeWatermark = occurredAt;
          }
        }
      } catch (err) {
        failedCount++;
        encounteredError = true; // Stop advancing watermark so this and subsequent events can be retried next time
        console.error(`Lỗi xử lý sự kiện ISAPI (${ev.serialNo}):`, err.message);
      }
    }

    // Verify lease is still held before committing success
    await verifyLeaseOwnership();

    syncLog.eventsIngested = ingestedCount;
    syncLog.eventsDuplicate = duplicateCount;
    syncLog.eventsUnmapped = unmappedCount;
    syncLog.eventsFailed = failedCount;

    if (acsResult.truncated) {
      syncLog.status = 'PARTIAL';
    } else {
      syncLog.status = failedCount > 0 && ingestedCount === 0 ? 'FAILED' : (failedCount > 0 ? 'PARTIAL' : 'SUCCESS');
    }
    syncLog.completedAt = new Date();
    await syncLog.save();

    device.lastSyncCompletedAt = new Date();
    device.status = 'ONLINE';
    device.statusMessage = acsResult.truncated
      ? `Đồng bộ một phần (đạt giới hạn an toàn): ${ingestedCount} mới, ${duplicateCount} trùng, ${unmappedCount} chưa ánh xạ`
      : `Đồng bộ thành công: ${ingestedCount} mới, ${duplicateCount} trùng, ${unmappedCount} chưa ánh xạ`;

    if (safeWatermark && (!device.lastSuccessfulEventAt || safeWatermark > device.lastSuccessfulEventAt)) {
      device.lastSuccessfulEventAt = safeWatermark;
    }
    await device.save();

    return {
      success: syncLog.status !== 'FAILED',
      truncated: Boolean(acsResult.truncated),
      summary: {
        totalFetched: events.length,
        totalMatches: acsResult.totalMatches,
        ingested: ingestedCount,
        duplicate: duplicateCount,
        unmapped: unmappedCount,
        failed: failedCount
      },
      log: syncLog
    };
  } catch (err) {
    syncLog.status = 'FAILED';
    syncLog.completedAt = new Date();
    syncLog.errorMessage = err.message;
    await syncLog.save();

    if (err.code !== 'LEASE_LOST') {
      device.status = err.code === 'DEVICE_AUTH_FAILED' ? 'AUTH_FAILED' : 'ERROR';
      device.statusMessage = err.message;
      await device.save();
    }

    throw err;
  } finally {
    // 1. Clear heartbeat timer
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    // 2. Remove in-process lock
    activeSyncJobs.delete(deviceIdStr);

    // 3. Release distributed single-flight lease ONLY if we still own it
    if (!leaseLost) {
      try {
        await TimekeepingDevice.updateOne(
          { _id: device._id, 'syncLease.lockedBy': workerId },
          {
            $set: {
              'syncLease.lockedBy': null,
              'syncLease.expiresAt': null
            }
          }
        );
      } catch (releaseErr) {
        console.error('Lỗi giải phóng syncLease:', releaseErr.message);
      }
    }
  }
}

module.exports = {
  validateTenantCredentialKey,
  resolveDeviceCredentials,
  buildDeviceConfig,
  testDeviceConnection,
  syncDeviceEvents
};
