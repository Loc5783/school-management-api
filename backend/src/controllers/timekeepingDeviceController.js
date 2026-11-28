'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const TimekeepingDevice = require('../models/zone2_hr/TimekeepingDevice');
const AttendanceDevicePersonMapping = require('../models/zone2_hr/AttendanceDevicePersonMapping');
const DeviceStoredPerson = require('../models/zone2_hr/DeviceStoredPerson');
const DeviceSyncLog = require('../models/zone2_hr/DeviceSyncLog');
const RawAttendanceEvent = require('../models/zone2_hr/RawAttendanceEvent');
const User = require('../models/zone1_system/User');
const Student = require('../models/zone3_school/Student');
const Tenant = require('../models/zone1_system/Tenant');
const { testDeviceConnection, syncDeviceEvents } = require('../services/hikvisionSyncService');
const { validateDeviceHost } = require('../services/hikvisionIsapiService');
const biometricSyncService = require('../services/hikvisionBiometricSyncService');
const { ingestStudentDeviceAttendance } = require('../services/attendanceDeviceService');
const { simulateSchoolWebhookEvent } = require('../services/timekeepingWebhookService');
const { calculateAttendanceForUserDate } = require('../services/attendanceCalculationService');
const { createTrustedTenantContext } = require('../services/tenantFilterService');
const { getWorkDate, DEFAULT_SCHOOL_TIMEZONE } = require('../utils/dateHelpers');
const { encryptDeviceCredentials } = require('../utils/deviceCredentialCrypto');
const {
  resolveDynamicPublicBaseUrl,
  issueConnectorGrantForTenant,
  generateDownloadableConnectorZipBuffer
} = require('../services/localConnectorGrantService');
const {
  attachCampusSseStream,
  getRecentCampusRealtimeEvents
} = require('../services/realtimeCampusEventHub');
const { formatFriendlyVietnameseHardwareNotice } = require('../utils/vietnameseHardwareTranslator');

/**
 * Enforces authenticated tenant context.
 * Rejects with HTTP 403 TENANT_CONTEXT_REQUIRED if tenantId is missing.
 */
function assertTenantContext(req) {
  const tenantId = req.tenantId || req.schoolTenant?._id || req.user?.tenantId;
  if (!tenantId) {
    const err = new Error('Yêu cầu ngữ cảnh trường học (tenant)');
    err.code = 'TENANT_CONTEXT_REQUIRED';
    err.statusCode = 403;
    throw err;
  }
  return tenantId;
}

function assertValidPort(portValue, label = 'Cổng mạng') {
  if (portValue === undefined || portValue === null || portValue === '') return;
  const num = Number(portValue);
  if (!Number.isInteger(num) || num < 1 || num > 65535) {
    const err = new Error(`${label} phải là số nguyên hợp lệ từ 1 đến 65535`);
    err.code = 'INVALID_PORT_RANGE';
    err.statusCode = 400;
    throw err;
  }
}

/**
 * Helper to sanitize device DTO, stripping secret fields:
 * apiKeyHash, credentialKey, syncLease, encryptedAuth.
 * Attaches non-sensitive boolean flags: credentialConfigured, credentialStatus.
 */
function sanitizeDevice(doc) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  const prefix = obj.credentialKey;
  let hasEnvCreds = false;
  if (prefix) {
    const username = process.env[`${prefix}_USERNAME`];
    const password = process.env[`${prefix}_PASSWORD`];
    hasEnvCreds = Boolean(username && password);
  }
  const hasEncryptedDeviceCreds = Boolean(obj.encryptedAuth?.cipherText);
  const credentialConfigured = hasEnvCreds || hasEncryptedDeviceCreds;

  obj.credentialConfigured = credentialConfigured;
  obj.credentialStatus = credentialConfigured ? 'CONFIGURED' : 'MISSING';

  delete obj.apiKeyHash;
  delete obj.credentialKey;
  delete obj.syncLease;
  delete obj.encryptedAuth;
  return obj;
}

/**
 * Resolves tenant code string for server-side credential derivation.
 */
async function resolveTenantCode(req, tenantId) {
  if (req.schoolTenant?.code) {
    return req.schoolTenant.code;
  }
  const tenantDoc = await Tenant.findById(tenantId).lean();
  return tenantDoc?.code || null;
}

/**
 * List all timekeeping devices for current tenant.
 */
async function listDevices(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const [devices, schoolCode] = await Promise.all([
      TimekeepingDevice.find({ tenantId }).sort({ createdAt: -1 }),
      resolveTenantCode(req, tenantId)
    ]);

    const deviceCodes = devices.map((d) => d.deviceCode);
    const unmappedCounts = await RawAttendanceEvent.aggregate([
      { $match: { deviceId: { $in: deviceCodes }, mappingStatus: 'UNMAPPED', tenantId } },
      { $group: { _id: '$deviceId', count: { $sum: 1 } } }
    ]);

    const countMap = new Map();
    unmappedCounts.forEach((c) => countMap.set(c._id, c.count));

    const result = devices.map((d) => ({
      ...sanitizeDevice(d),
      unmappedCount: countMap.get(d.deviceCode) || 0
    }));

    return res.json({
      success: true,
      data: result,
      webhookMeta: {
        schoolCode: schoolCode || null,
        endpointPath: schoolCode ? `/api/attendance/webhook/${schoolCode}` : '/api/attendance/webhook',
        hikvisionAliasPath: schoolCode ? `/api/webhooks/timekeeping/hikvision/${schoolCode}` : '/api/webhooks/timekeeping/hikvision'
      }
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code || 'LIST_DEVICES_FAILED',
      message: err.message || 'Lỗi tải danh sách thiết bị'
    });
  }
}

/**
 * Create a new device registration (supports campus, 500-slot strategy & AES-256-GCM encrypted ISAPI auth).
 */
async function createDevice(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const {
      deviceCode,
      name,
      campus = 'Cơ sở chính',
      location = 'Sảnh đón trẻ',
      vendor = 'HIKVISION',
      model = 'DS-K1T320MX',
      host,
      httpPort = 80,
      httpsPort = 443,
      sdkPort = 8000,
      transportScheme,
      protocol = 'ISAPI',
      timezone = 'Asia/Ho_Chi_Minh',
      apiKey,
      serialNumber,
      allowSelfSigned = true,
      maxUserCapacity = 500,
      syncAllocationMode = 'BY_CAMPUS_PRIORITY',
      syncTargetScope = 'ALL',
      autoSyncOnChange = true,
      deviceUsername,
      devicePassword,
      connectorVerifiedInfo = null,
      upsertExistingSameCampus = false
    } = req.body;

    // Strict contract: Client is NOT allowed to specify or send credentialKey
    if (req.body.credentialKey !== undefined) {
      return res.status(400).json({
        success: false,
        code: 'CREDENTIAL_KEY_IMMUTABLE',
        message: 'Client không được phép chỉ định credentialKey. Hệ thống tự động xác định theo trường.'
      });
    }

    if (!deviceCode || !name || !host) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp mã thiết bị (deviceCode), tên (name) và địa chỉ IP/Host'
      });
    }

    const cleanDeviceCode = String(deviceCode).trim().toUpperCase();
    if (!/^[A-Z0-9_-]{1,40}$/.test(cleanDeviceCode)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_DEVICE_CODE',
        message: 'Mã thiết bị chỉ được chứa chữ cái không dấu, chữ số, gạch ngang/dưới (tối đa 40 ký tự)'
      });
    }
    if (String(name).trim().length > 120) {
      return res.status(400).json({
        success: false,
        code: 'DEVICE_NAME_TOO_LONG',
        message: 'Tên thiết bị không được vượt quá 120 ký tự'
      });
    }

    assertValidPort(httpPort, 'Cổng HTTP');
    assertValidPort(httpsPort, 'Cổng HTTPS');
    assertValidPort(sdkPort, 'Cổng SDK');

    // SSRF & Safety validation
    validateDeviceHost(host);

    // Server automatically derives credential reference strictly from tenant
    const tenantCode = await resolveTenantCode(req, tenantId);
    const cleanCode = String(tenantCode || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const credentialKey = `HIKVISION_${cleanCode}`;

    // Check serialNumber global cross-campus hardware lock FIRST
    let normalizedSerial;
    const rawSn = serialNumber || connectorVerifiedInfo?.serialNumber;
    if (rawSn && String(rawSn).trim()) {
      const cleanSerial = String(rawSn).trim();
      const existingSerialOtherCampus = await TimekeepingDevice.findOne({
        serialNumber: cleanSerial,
        tenantId: { $ne: tenantId }
      }).lean();
      if (existingSerialOtherCampus) {
        return res.status(409).json({
          success: false,
          code: 'SERIAL_LOCKED_OTHER_CAMPUS',
          message: `Thiết bị này hiện đang được khóa bảo mật cho một phân hiệu trường khác. Để bảo vệ dữ liệu học sinh không bị kéo hoặc đẩy nhầm trường, chỉ Kỹ thuật viên Nhà cung cấp phần mềm mới có thể gỡ khóa chuyển phân hiệu cho thiết bị này.`
        });
      }
      normalizedSerial = cleanSerial;
    }

    const cleanUsername = String(deviceUsername || 'admin').trim() || 'admin';
    const encryptedAuth =
      devicePassword && String(devicePassword).trim()
        ? encryptDeviceCredentials(tenantId, cleanUsername, String(devicePassword))
        : undefined;

    const resolvedScheme =
      transportScheme === 'http' || transportScheme === 'https'
        ? transportScheme
        : 'https';

    // Nếu kết nối lại máy đã từng lưu trong cùng phân hiệu (Bước 2 Quét LAN) -> Cập nhật mượt mà thay vì báo lỗi trùng mã
    if (upsertExistingSameCampus) {
      const sameCampusConditions = [{ deviceCode: cleanDeviceCode }, { host: host.trim() }];
      if (normalizedSerial) {
        sameCampusConditions.push({ serialNumber: normalizedSerial });
      }
      const existingSameCampus = await TimekeepingDevice.findOne({
        tenantId,
        $or: sameCampusConditions
      });
      if (existingSameCampus) {
        existingSameCampus.name = String(name).trim();
        existingSameCampus.campus = String(campus || 'Cơ sở chính').trim() || 'Cơ sở chính';
        existingSameCampus.location = String(location || 'Sảnh đón trẻ').trim();
        existingSameCampus.model = String(connectorVerifiedInfo?.model || model).trim();
        existingSameCampus.host = host.trim();
        existingSameCampus.httpPort = Number(httpPort) || 80;
        existingSameCampus.httpsPort = Number(httpsPort) || 443;
        existingSameCampus.transportScheme = resolvedScheme;
        existingSameCampus.authUsernameHint = cleanUsername;
        if (encryptedAuth) {
          existingSameCampus.encryptedAuth = encryptedAuth;
        }
        if (normalizedSerial) {
          existingSameCampus.serialNumber = normalizedSerial;
          if (!existingSameCampus.serialLockedAt) {
            existingSameCampus.serialLockedAt = new Date();
          }
        }
        if (connectorVerifiedInfo) {
          if (connectorVerifiedInfo.macAddress) existingSameCampus.macAddress = connectorVerifiedInfo.macAddress;
          if (connectorVerifiedInfo.maxUserCapacity) {
            existingSameCampus.maxUserCapacity = Number(connectorVerifiedInfo.maxUserCapacity) || 500;
          }
          if (connectorVerifiedInfo.currentStoredUsers !== undefined) {
            existingSameCampus.currentStoredUsers = Number(connectorVerifiedInfo.currentStoredUsers) || 0;
          }
          if (connectorVerifiedInfo.currentStoredFaces !== undefined) {
            existingSameCampus.currentStoredFaces = Number(connectorVerifiedInfo.currentStoredFaces) || 0;
          }
          existingSameCampus.status = 'ONLINE';
          existingSameCampus.lastSeenAt = new Date();
          existingSameCampus.statusMessage = `Đang trực tuyến • Bộ nhớ lưu ${existingSameCampus.currentStoredUsers || 0}/${existingSameCampus.maxUserCapacity || 500} hồ sơ`;
        }
        existingSameCampus.updatedBy = req.user?._id;
        await existingSameCampus.save();
        return res.status(200).json({
          success: true,
          data: sanitizeDevice(existingSameCampus)
        });
      }
    }

    // Check deviceCode uniqueness within tenant
    const existing = await TimekeepingDevice.findOne({
      tenantId,
      deviceCode: cleanDeviceCode
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Mã thiết bị "${deviceCode}" đã tồn tại trong trường này`
      });
    }

    if (normalizedSerial) {
      const existingSerialSameTenant = await TimekeepingDevice.findOne({
        tenantId,
        serialNumber: normalizedSerial
      });
      if (existingSerialSameTenant) {
        return res.status(409).json({
          success: false,
          code: 'DUPLICATE_SERIAL_SAME_CAMPUS',
          message: `Máy chấm công có số serial này đã được lưu sẵn trong danh sách phân hiệu (${existingSerialSameTenant.name})`
        });
      }
    }

    // Hash apiKey if provided
    let apiKeyHash;
    if (apiKey && String(apiKey).trim()) {
      apiKeyHash = crypto.createHash('sha256').update(String(apiKey).trim()).digest('hex');
      const keyConflict = await TimekeepingDevice.findOne({ apiKeyHash });
      if (keyConflict) {
        return res.status(409).json({
          success: false,
          message: 'Khóa API Key này đã được gán cho một thiết bị khác trong hệ thống'
        });
      }
    }

    const device = new TimekeepingDevice({
      tenantId,
      deviceCode: cleanDeviceCode,
      name: String(name).trim(),
      campus: String(campus || 'Cơ sở chính').trim() || 'Cơ sở chính',
      location: String(location || 'Sảnh đón trẻ').trim(),
      vendor,
      model: String(connectorVerifiedInfo?.model || model).trim(),
      serialNumber: normalizedSerial,
      ...(normalizedSerial
        ? {
            serialLockedAt: new Date(),
            serialLockedByVendor: Boolean(req.isVendorSupport)
          }
        : {}),
      macAddress: String(connectorVerifiedInfo?.macAddress || '').trim(),
      host: host.trim(),
      httpPort: Number(httpPort) || 80,
      httpsPort: Number(httpsPort) || 443,
      sdkPort: Number(sdkPort) || 8000,
      transportScheme: resolvedScheme,
      protocol,
      timezone,
      credentialKey,
      authUsernameHint: cleanUsername,
      ...(encryptedAuth ? { encryptedAuth } : {}),
      maxUserCapacity: Math.max(
        10,
        Math.min(50000, Number(connectorVerifiedInfo?.maxUserCapacity || maxUserCapacity) || 500)
      ),
      ...(connectorVerifiedInfo
        ? {
            status: 'ONLINE',
            lastSeenAt: new Date(),
            currentStoredUsers: Number(connectorVerifiedInfo.currentStoredUsers) || 0,
            currentStoredFaces: Number(connectorVerifiedInfo.currentStoredFaces) || 0,
            statusMessage: `Đang trực tuyến • Bộ nhớ lưu ${Number(connectorVerifiedInfo.currentStoredUsers) || 0}/${Number(connectorVerifiedInfo.maxUserCapacity || maxUserCapacity) || 500} hồ sơ`
          }
        : {}),
      syncAllocationMode: ['BY_CAMPUS_PRIORITY', 'TODAY_ATTENDANCE_FIRST', 'ALL_ACTIVE'].includes(syncAllocationMode)
        ? syncAllocationMode
        : 'BY_CAMPUS_PRIORITY',
      syncTargetScope: ['ALL', 'EMPLOYEE_ONLY', 'STUDENT_ONLY'].includes(syncTargetScope)
        ? syncTargetScope
        : 'ALL',
      autoSyncOnChange: autoSyncOnChange !== false,
      apiKeyHash,
      allowSelfSigned: Boolean(allowSelfSigned),
      createdBy: req.user?._id
    });

    await device.save();

    // Chỉ gọi kiểm tra trực tiếp từ Backend nếu KHÔNG đi qua Local Connector (tránh Cloud VPS chờ timeout khi ping IP LAN nội bộ)
    let health = null;
    if (encryptedAuth && !connectorVerifiedInfo) {
      health = await biometricSyncService.checkDeviceCapacityAndHealth(tenantId, device._id).catch(() => null);
    }

    const freshDevice = health ? await TimekeepingDevice.findById(device._id) : device;
    return res.status(201).json({
      success: true,
      data: sanitizeDevice(freshDevice),
      ...(health ? { health } : {})
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code,
      message: formatFriendlyVietnameseHardwareNotice(err, { host: req.body?.host, deviceName: req.body?.name })
    });
  }
}

/**
 * Get device by ID.
 */
async function getDeviceById(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'ID thiết bị không hợp lệ' });
    }
    const device = await TimekeepingDevice.findOne({ _id: req.params.id, tenantId });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thiết bị' });
    }

    const unmappedCount = await RawAttendanceEvent.countDocuments({
      deviceId: device.deviceCode,
      mappingStatus: 'UNMAPPED',
      tenantId
    });

    return res.json({
      success: true,
      data: {
        ...sanitizeDevice(device),
        unmappedCount
      }
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code || 'GET_DEVICE_FAILED',
      message: err.message || 'Lỗi lấy thông tin thiết bị'
    });
  }
}

/**
 * Update device details.
 */
async function updateDevice(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'ID thiết bị không hợp lệ' });
    }
    const device = await TimekeepingDevice.findOne({ _id: req.params.id, tenantId });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thiết bị' });
    }

    // Strict contract: Client is NOT allowed to specify or update credentialKey
    if (req.body.credentialKey !== undefined) {
      return res.status(400).json({
        success: false,
        code: 'CREDENTIAL_KEY_IMMUTABLE',
        message: 'Client không được phép chỉ định credentialKey. Hệ thống tự động xác định theo trường.'
      });
    }

    const {
      name,
      campus,
      location,
      model,
      serialNumber,
      host,
      httpPort,
      httpsPort,
      sdkPort,
      transportScheme,
      enabled,
      timezone,
      apiKey,
      allowSelfSigned,
      maxUserCapacity,
      syncAllocationMode,
      syncTargetScope,
      autoSyncOnChange,
      deviceUsername,
      devicePassword
    } = req.body;

    if (host) {
      validateDeviceHost(host);
      device.host = host.trim();
    }
    if (name) device.name = String(name).trim();
    if (campus !== undefined) device.campus = String(campus || 'Cơ sở chính').trim() || 'Cơ sở chính';
    if (location !== undefined) device.location = String(location || '').trim();
    if (model) device.model = String(model).trim();
    if (serialNumber !== undefined) {
      const cleanSerial = String(serialNumber).trim();
      // Admin trường không được tự ý đổi hoặc xóa mã phần cứng đã khóa — chỉ Kỹ thuật Nhà cung cấp mới được gỡ/đổi khóa
      if (device.serialNumber && cleanSerial !== device.serialNumber && !req.isVendorSupport) {
        return res.status(403).json({
          success: false,
          code: 'SERIAL_UNLOCK_VENDOR_ONLY',
          message:
            'Mã phần cứng của máy chấm công đã được khóa cố định với phân hiệu trường để bảo vệ dữ liệu. Vui lòng liên hệ Kỹ thuật viên Nhà cung cấp phần mềm nếu bạn cần thay thế thiết bị.'
        });
      }
      if (cleanSerial) {
        const serialConflictSame = await TimekeepingDevice.findOne({
          tenantId,
          serialNumber: cleanSerial,
          _id: { $ne: device._id }
        });
        if (serialConflictSame) {
          return res.status(409).json({
            success: false,
            code: 'DUPLICATE_SERIAL_SAME_CAMPUS',
            message: `Số serial "${cleanSerial}" đã tồn tại trong phân hiệu trường này`
          });
        }
        const serialConflictForeign = await TimekeepingDevice.findOne({
          serialNumber: cleanSerial,
          tenantId: { $ne: tenantId },
          _id: { $ne: device._id }
        }).lean();
        if (serialConflictForeign) {
          return res.status(409).json({
            success: false,
            code: 'SERIAL_LOCKED_OTHER_CAMPUS',
            message: `Thiết bị có số serial "${cleanSerial}" hiện đang được khóa bảo mật cho một phân hiệu trường khác. Chỉ Kỹ thuật viên Nhà cung cấp phần mềm mới có quyền chuyển phân hiệu cho thiết bị này.`
          });
        }
      }
      device.serialNumber = cleanSerial || undefined;
      if (cleanSerial && !device.serialLockedAt) {
        device.serialLockedAt = new Date();
      }
    }
    if (httpPort !== undefined) {
      assertValidPort(httpPort, 'Cổng HTTP');
      device.httpPort = Number(httpPort);
    }
    if (httpsPort !== undefined) {
      assertValidPort(httpsPort, 'Cổng HTTPS');
      device.httpsPort = Number(httpsPort);
    }
    if (sdkPort !== undefined) {
      assertValidPort(sdkPort, 'Cổng SDK');
      device.sdkPort = Number(sdkPort);
    }
    if (transportScheme === 'http' || transportScheme === 'https') {
      device.transportScheme = transportScheme;
    }
    if (enabled !== undefined) device.enabled = Boolean(enabled);
    if (timezone) device.timezone = timezone;
    if (allowSelfSigned !== undefined) device.allowSelfSigned = Boolean(allowSelfSigned);
    if (maxUserCapacity !== undefined) {
      device.maxUserCapacity = Math.max(10, Math.min(50000, Number(maxUserCapacity) || 500));
    }
    if (['BY_CAMPUS_PRIORITY', 'TODAY_ATTENDANCE_FIRST', 'ALL_ACTIVE'].includes(syncAllocationMode)) {
      device.syncAllocationMode = syncAllocationMode;
    }
    if (['ALL', 'EMPLOYEE_ONLY', 'STUDENT_ONLY'].includes(syncTargetScope)) {
      device.syncTargetScope = syncTargetScope;
    }
    if (autoSyncOnChange !== undefined) {
      device.autoSyncOnChange = Boolean(autoSyncOnChange);
    }

    if (deviceUsername !== undefined) {
      device.authUsernameHint = String(deviceUsername || 'admin').trim() || 'admin';
    }
    if (devicePassword && String(devicePassword).trim()) {
      device.encryptedAuth = encryptDeviceCredentials(
        tenantId,
        device.authUsernameHint || 'admin',
        String(devicePassword)
      );
    }

    if (apiKey !== undefined) {
      if (apiKey && String(apiKey).trim()) {
        const hash = crypto.createHash('sha256').update(String(apiKey).trim()).digest('hex');
        const conflict = await TimekeepingDevice.findOne({ apiKeyHash: hash, _id: { $ne: device._id } });
        if (conflict) {
          return res.status(409).json({ success: false, message: 'API Key đã được gán cho thiết bị khác' });
        }
        device.apiKeyHash = hash;
      } else {
        device.apiKeyHash = undefined;
      }
    }

    device.updatedBy = req.user?._id;
    await device.save();

    return res.json({ success: true, data: sanitizeDevice(device) });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code,
      message: formatFriendlyVietnameseHardwareNotice(err, { host: req.body?.host || device?.host, deviceName: req.body?.name || device?.name })
    });
  }
}

/**
 * Delete a timekeeping device within current tenant.
 */
async function deleteDevice(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'ID thiết bị không hợp lệ' });
    }
    const deleted = await TimekeepingDevice.findOneAndDelete({ _id: req.params.id, tenantId });
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thiết bị trong trường này' });
    }
    await Promise.all([
      AttendanceDevicePersonMapping.deleteMany({ tenantId, deviceId: deleted._id }),
      DeviceStoredPerson.deleteMany({ tenantId, deviceId: deleted._id })
    ]);
    return res.json({
      success: true,
      message: `Đã xóa máy chấm công "${deleted.name}" khỏi phân hiệu ${deleted.campus || 'Cơ sở chính'}`
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code || 'DELETE_DEVICE_FAILED',
      message: err.message || 'Lỗi xóa thiết bị'
    });
  }
}

/**
 * Test connectivity to an ISAPI device (Admin only).
 */
async function testDeviceConn(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'ID thiết bị không hợp lệ' });
    }
    const device = await TimekeepingDevice.findOne({ _id: req.params.id, tenantId });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thiết bị' });
    }

    const result = await testDeviceConnection(device);
    return res.json({ success: result.success, ...result });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code || 'TEST_CONNECTION_FAILED',
      message: err.message || 'Lỗi kiểm tra kết nối thiết bị'
    });
  }
}

/**
 * Trigger manual event sync job (Admin, Principal).
 */
async function triggerDeviceSync(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'ID thiết bị không hợp lệ' });
    }
    const device = await TimekeepingDevice.findOne({ _id: req.params.id, tenantId });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thiết bị' });
    }

    const result = await syncDeviceEvents(device, {
      actorId: req.user?._id,
      triggeredBy: 'MANUAL',
      startTime: req.body?.startTime,
      pageSize: req.body?.pageSize,
      safetyCap: req.body?.safetyCap
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code || 'SYNC_FAILED',
      message: err.message || 'Lỗi đồng bộ thiết bị'
    });
  }
}

/**
 * List person mappings for a device.
 */
async function listPersonMappings(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const deviceId = req.params.id;
    if (!mongoose.isValidObjectId(deviceId)) {
      return res.status(400).json({ success: false, message: 'ID thiết bị không hợp lệ' });
    }

    const device = await TimekeepingDevice.findOne({ _id: deviceId, tenantId });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thiết bị trong trường này' });
    }

    const mappings = await AttendanceDevicePersonMapping.find({ tenantId, deviceId: device._id })
      .populate('userId', 'username profile role employeeInfo')
      .populate('studentId', 'fullName studentCode className')
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: mappings });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code || 'LIST_MAPPINGS_FAILED',
      message: err.message || 'Lỗi tải danh sách ánh xạ người'
    });
  }
}

/**
 * Create or update a person mapping.
 */
async function upsertPersonMapping(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const deviceId = req.params.id;
    const { externalPersonId, subjectType, subjectId, metadata = {} } = req.body;

    if (!externalPersonId || !subjectType || !subjectId) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp externalPersonId, subjectType (EMPLOYEE/STUDENT) và subjectId'
      });
    }
    if (!mongoose.isValidObjectId(deviceId) || !mongoose.isValidObjectId(subjectId)) {
      return res.status(400).json({
        success: false,
        message: 'ID thiết bị hoặc ID đối tượng ánh xạ không hợp lệ'
      });
    }

    if (!['EMPLOYEE', 'STUDENT'].includes(subjectType)) {
      return res.status(400).json({ success: false, message: 'subjectType phải là EMPLOYEE hoặc STUDENT' });
    }

    const device = await TimekeepingDevice.findOne({ _id: deviceId, tenantId });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thiết bị trong trường này' });
    }

    let verifiedUser = null;
    let verifiedStudent = null;

    if (subjectType === 'EMPLOYEE') {
      verifiedUser = await User.findOne({
        _id: subjectId,
        tenantId,
        status: 'active'
      });
      if (!verifiedUser) {
        return res.status(404).json({
          success: false,
          message: 'Không tìm thấy nhân viên đang hoạt động trong trường này'
        });
      }
    } else {
      verifiedStudent = await Student.findOne({
        _id: subjectId,
        tenantId
      });
      if (!verifiedStudent) {
        return res.status(404).json({
          success: false,
          message: 'Không tìm thấy học sinh trong trường này'
        });
      }
    }

    const conflictSubject = await AttendanceDevicePersonMapping.findOne({
      tenantId: device.tenantId,
      deviceId: device._id,
      subjectType,
      subjectId,
      externalPersonId: { $ne: String(externalPersonId).trim() }
    });
    if (conflictSubject) {
      return res.status(409).json({
        success: false,
        message: `Đối tượng này đã được ánh xạ với ID máy "${conflictSubject.externalPersonId}" trên thiết bị này`
      });
    }

    const mapping = await AttendanceDevicePersonMapping.findOneAndUpdate(
      {
        tenantId: device.tenantId,
        deviceId: device._id,
        externalPersonId: String(externalPersonId).trim()
      },
      {
        $set: {
          subjectType,
          subjectId,
          userId: verifiedUser ? verifiedUser._id : undefined,
          studentId: verifiedStudent ? verifiedStudent._id : undefined,
          active: true,
          metadata: {
            displayName: metadata.displayName || (verifiedUser?.profile?.fullName || verifiedStudent?.fullName || ''),
            note: metadata.note || ''
          },
          createdBy: req.user?._id
        }
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );

    const cleanExtId = String(externalPersonId).trim();
    const unmappedEvents = await RawAttendanceEvent.find({
      tenantId: device.tenantId,
      deviceId: device.deviceCode,
      externalPersonId: cleanExtId,
      mappingStatus: 'UNMAPPED'
    }).sort({ occurredAt: 1 });

    if (unmappedEvents.length > 0) {
      const targetName = verifiedUser ? (verifiedUser.profile?.fullName || verifiedUser.username) : verifiedStudent.fullName;
      await RawAttendanceEvent.updateMany(
        { _id: { $in: unmappedEvents.map((e) => e._id) } },
        {
          $set: {
            mappingStatus: 'MAPPED',
            subjectType,
            userId: verifiedUser ? verifiedUser._id : null,
            studentId: verifiedStudent ? verifiedStudent._id : null,
            employeeName: targetName
          }
        }
      );

      if (verifiedUser) {
        const trustedCtx = createTrustedTenantContext({ tenantId: device.tenantId });
        const distinctDates = [...new Set(unmappedEvents.map((e) => getWorkDate(e.occurredAt, DEFAULT_SCHOOL_TIMEZONE)))];
        for (const workDateStr of distinctDates) {
          await calculateAttendanceForUserDate({
            userId: verifiedUser._id,
            workDate: workDateStr,
            actorId: req.user?._id || null,
            calculatedBy: 'admin',
            context: trustedCtx
          });
        }
      } else if (verifiedStudent) {
        for (const ev of unmappedEvents) {
          await ingestStudentDeviceAttendance({
            tenantId: device.tenantId,
            student: verifiedStudent,
            occurredAtDate: ev.occurredAt,
            source: ev.source,
            deviceId: device.deviceCode,
            enableMorningLateCheck: true,
            session: null
          });
        }
      }
    }

    return res.json({ success: true, data: mapping, backfilledEvents: unmappedEvents.length });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code,
      message: err.message || 'Lỗi cập nhật ánh xạ người'
    });
  }
}

/**
 * Delete a person mapping.
 */
async function deletePersonMapping(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const { id: deviceId, mappingId } = req.params;
    if (!mongoose.isValidObjectId(deviceId) || !mongoose.isValidObjectId(mappingId)) {
      return res.status(400).json({ success: false, message: 'ID thiết bị hoặc ID ánh xạ không hợp lệ' });
    }

    const device = await TimekeepingDevice.findOne({ _id: deviceId, tenantId });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thiết bị trong trường này' });
    }

    const result = await AttendanceDevicePersonMapping.findOneAndDelete({
      _id: mappingId,
      deviceId: device._id,
      tenantId
    });
    if (!result) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy bản ghi ánh xạ' });
    }

    return res.json({ success: true, message: 'Đã xóa bản ghi ánh xạ' });
  } catch {
    return res.status(500).json({ success: false, message: 'Lỗi xóa ánh xạ người' });
  }
}

/**
 * List sync logs for a device.
 */
async function getSyncLogs(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const deviceId = req.params.id;
    if (!mongoose.isValidObjectId(deviceId)) {
      return res.status(400).json({ success: false, message: 'ID thiết bị không hợp lệ' });
    }

    const device = await TimekeepingDevice.findOne({ _id: deviceId, tenantId });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thiết bị trong trường này' });
    }

    const logs = await DeviceSyncLog.find({ tenantId, deviceId: device._id })
      .sort({ startedAt: -1 })
      .limit(50);

    return res.json({ success: true, data: logs });
  } catch (err) {
    return res.status(500).json({
      success: false,
      code: err.code || 'GET_SYNC_LOGS_FAILED',
      message: err.message || 'Lỗi tải nhật ký đồng bộ'
    });
  }
}

/**
 * Get unmapped events for this device.
 */
async function getUnmappedEvents(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const filter = {
      tenantId,
      mappingStatus: 'UNMAPPED'
    };
    const deviceCode = req.params.deviceCode || req.query.deviceCode;
    if (deviceCode) {
      filter.deviceId = String(deviceCode).trim();
    }

    const unmapped = await RawAttendanceEvent.find(filter)
      .sort({ occurredAt: -1 })
      .limit(50);

    return res.json({ success: true, data: unmapped });
  } catch (err) {
    return res.status(500).json({
      success: false,
      code: err.code || 'GET_UNMAPPED_FAILED',
      message: err.message || 'Lỗi tải danh sách sự kiện chưa ánh xạ'
    });
  }
}

/**
 * Giả lập tín hiệu máy chấm công đẩy về Webhook đuôi `/:schoolCode` của chính trường hiện tại.
 */
async function simulateWebhook(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const schoolCode = await resolveTenantCode(req, tenantId);
    if (!schoolCode) {
      return res.status(404).json({
        success: false,
        message: 'Không xác định được Mã trường (schoolCode) của đơn vị hiện tại'
      });
    }

    const { externalPersonId, personName, verifyMode, occurredAt, deviceCode } = req.body || {};
    const out = await simulateSchoolWebhookEvent({
      schoolCode,
      externalPersonId,
      personName,
      verifyMode,
      occurredAt,
      deviceCode: deviceCode || 'SIMULATOR-SCHOOL-UI',
      sourceIp: req.ip || '127.0.0.1'
    });

    return res.status(200).json({
      success: true,
      message: out.record?.processingNote || 'Đã gửi gói tin kiểm tra Webhook thành công',
      data: {
        schoolCode,
        endpointPath: `/api/attendance/webhook/${schoolCode}`,
        logId: out.savedId,
        processingStatus: out.record?.processingStatus,
        processingNote: out.record?.processingNote,
        attendanceResult: out.attendanceResult
      }
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Không thể giả lập sự kiện Webhook chấm công'
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CÁC API ĐỒNG BỘ 1 CHIỀU HIKVISION ISAPI, 500-SLOT & ẢNH KHUÔN MẶT (<200KB) THEO PHÂN HIỆU
// ═══════════════════════════════════════════════════════════════════════════════

async function getBiometricOverview(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const data = await biometricSyncService.getBiometricOverview(tenantId, req.query || {}, sanitizeDevice);
    const dynamicOrigin = resolveDynamicPublicBaseUrl(req, req.header('Origin') || '');
    if (data?.webhookMeta) {
      data.webhookMeta.publicBaseUrl = dynamicOrigin;
      data.webhookMeta.fullWebhookUrl = data.webhookMeta.schoolCode
        ? `${dynamicOrigin}/api/attendance/webhook/${data.webhookMeta.schoolCode}`
        : `${dynamicOrigin}/api/attendance/webhook`;
    }
    data.sessionMeta = {
      isVendorSupport: Boolean(req.isVendorSupport),
      vendorUsername: req.vendorUsername || null,
      connectorLocalUrl: 'http://127.0.0.1:18686'
    };
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code || 'BIOMETRIC_OVERVIEW_FAILED',
      message: formatFriendlyVietnameseHardwareNotice(err)
    });
  }
}

async function discoverLanDevices(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const result = await biometricSyncService.scanLanDevicesForTenant(tenantId, {
      subnetPrefix: req.body?.subnetPrefix || null,
      probeUsername: req.body?.probeUsername || '',
      probePassword: req.body?.probePassword || ''
    });
    return res.json({
      success: true,
      data: result,
      message:
        result.discoveredDevices.length > 0
          ? `Tuyệt vời! Đã tìm thấy ${result.discoveredDevices.length} máy chấm công Hikvision trong mạng của trường.`
          : 'Đã quét xong mạng nội bộ nhưng chưa thấy máy chấm công mới. Bạn hãy kiểm tra máy chấm công đã cắm điện và nối cùng mạng với máy tính chưa nhé.'
    });
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      code: err.code || 'LAN_DISCOVERY_FAILED',
      message: formatFriendlyVietnameseHardwareNotice(err)
    });
  }
}

async function checkDeviceCapacity(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const health = await biometricSyncService.checkDeviceCapacityAndHealth(tenantId, req.params.id);
    return res.json({
      success: Boolean(health.online),
      data: health,
      message: health.message
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code || 'CAPACITY_CHECK_FAILED',
      message: formatFriendlyVietnameseHardwareNotice(err)
    });
  }
}

async function pullUsersFromDevice(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const overwriteExistingFaces =
      req.body?.overwriteExistingFaces !== undefined ? Boolean(req.body.overwriteExistingFaces) : true;

    const result = await biometricSyncService.pullUsersAndFacesFromDevice(tenantId, req.params.id, {
      overwriteExistingFaces,
      actorId: req.user?._id
    });

    return res.json({
      success: true,
      data: result,
      message: `Đã kéo thành công từ máy "${result.deviceName}": khớp ${result.matchedCount}/${result.totalOnDevice} hồ sơ và lưu ${result.pulledFaceCount} ảnh khuôn mặt về phần mềm!`
    });
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      code: err.code || 'PULL_DEVICE_USERS_FAILED',
      message: formatFriendlyVietnameseHardwareNotice(err)
    });
  }
}

async function pushSmartSyncToDevice(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const report = await biometricSyncService.syncSmartToDevices(tenantId, {
      deviceId: req.params.id,
      fastDelta: req.body?.fastDelta !== false,
      forceFullSync: Boolean(req.body?.forceFullSync),
      actorId: req.user?._id
    });
    const first = report.deviceReports[0] || {};
    return res.json({
      success: Boolean(first.success),
      data: report,
      message: first.message || 'Đã đồng bộ danh sách học sinh & nhân sự xuống máy chấm công thành công!'
    });
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      code: err.code || 'PUSH_SYNC_FAILED',
      message: formatFriendlyVietnameseHardwareNotice(err)
    });
  }
}

async function syncAllDevicesSmart(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const report = await biometricSyncService.syncSmartToDevices(tenantId, {
      deviceId: req.body?.deviceId || null,
      campus: req.body?.campus || null,
      fastDelta: req.body?.fastDelta !== false,
      forceFullSync: Boolean(req.body?.forceFullSync),
      actorId: req.user?._id
    });
    return res.json({
      success: true,
      data: report,
      message: `Đã đồng bộ thành công danh sách khuôn mặt xuống ${report.syncedDevices}/${report.totalDevices} máy chấm công của phân hiệu!`
    });
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      code: err.code || 'SYNC_ALL_FAILED',
      message: formatFriendlyVietnameseHardwareNotice(err)
    });
  }
}

async function pullAllDevicesFast(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const report = await biometricSyncService.pullAllFromDevices(tenantId, {
      deviceId: req.body?.deviceId || null,
      campus: req.body?.campus || null,
      overwriteExistingFaces: req.body?.overwriteExistingFaces !== undefined ? Boolean(req.body.overwriteExistingFaces) : false,
      includeEvents: req.body?.includeEvents !== false,
      actorId: req.user?._id
    });
    return res.json({
      success: report.pulledDevices > 0,
      data: report,
      message: `Đã kéo xong dữ liệu từ ${report.pulledDevices}/${report.totalDevices} máy chấm công về phần mềm: khớp ${report.totalMatchedUsers} hồ sơ, ${report.totalPulledFaces} ảnh khuôn mặt và ${report.totalEventsIngested} lượt điểm danh mới!`
    });
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      code: err.code || 'PULL_ALL_FAILED',
      message: formatFriendlyVietnameseHardwareNotice(err)
    });
  }
}

async function quickBidirectionalSync(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const deviceId = req.params.id || req.body?.deviceId || null;
    const report = await biometricSyncService.quickBidirectionalSync(tenantId, {
      deviceId,
      campus: req.body?.campus || null,
      actorId: req.user?._id
    });
    const sec = Math.max(0.1, Math.round((report.durationMs / 1000) * 10) / 10);
    return res.json({
      success: true,
      data: report,
      message: `Đã đồng bộ hai chiều hoàn tất trong ${sec} giây! Vừa kéo về ${report.pullSummary.eventsIngested} lượt điểm danh & ${report.pullSummary.pulledFaces} ảnh khuôn mặt, đồng thời đẩy cập nhật xuống ${report.pushSummary.syncedDevices}/${report.pushSummary.totalDevices} máy chấm công.`
    });
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      code: err.code || 'BIDIRECTIONAL_SYNC_FAILED',
      message: formatFriendlyVietnameseHardwareNotice(err)
    });
  }
}

async function linkPulledDeviceUser(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const result = await biometricSyncService.linkPulledDeviceUserToSubject(tenantId, req.params.id, {
      externalPersonId: req.body?.externalPersonId,
      subjectType: req.body?.subjectType,
      subjectId: req.body?.subjectId,
      faceDataUrl: req.body?.faceDataUrl || '',
      actorId: req.user?._id
    });
    return res.json({
      success: true,
      data: result,
      message: `Đã ghép thành công mã số "${result.externalPersonId}" trên máy chấm công với hồ sơ "${result.fullName}" (${result.personCode})${result.faceSaved ? ' và lưu luôn ảnh khuôn mặt' : ''}!`
    });
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      code: err.code || 'LINK_PULLED_USER_FAILED',
      message: formatFriendlyVietnameseHardwareNotice(err)
    });
  }
}

async function importPulledUsersToWeb(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const result = await biometricSyncService.importPulledUsersToWebRoster(tenantId, req.params.id, {
      externalPersonIds: req.body?.externalPersonIds || [],
      importAll: Boolean(req.body?.importAll),
      overwriteName: req.body?.overwriteName !== false,
      overwriteFace: req.body?.overwriteFace !== false,
      actorId: req.user?._id
    });
    return res.json({
      success: true,
      data: result,
      message: result.message
    });
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      code: err.code || 'IMPORT_DEVICE_USERS_FAILED',
      message: formatFriendlyVietnameseHardwareNotice(err)
    });
  }
}

async function pruneDeviceInactiveSlots(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const result = await biometricSyncService.pruneInactiveUsersOnDevice(tenantId, req.params.id);
    return res.json({
      success: true,
      data: result,
      message: result.message
    });
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      code: err.code || 'PRUNE_SLOTS_FAILED',
      message: formatFriendlyVietnameseHardwareNotice(err)
    });
  }
}

async function unlockDeviceDoor(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const rawDoor = req.body?.doorNo !== undefined ? Number(req.body.doorNo) : 1;
    if (!Number.isInteger(rawDoor) || rawDoor < 1 || rawDoor > 8) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_DOOR_NUMBER',
        message: 'Số thứ tự cửa cần mở phải từ 1 đến 8.'
      });
    }
    const result = await biometricSyncService.unlockDoorOnDevice(tenantId, req.params.id, rawDoor);
    return res.json(result);
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      code: err.code || 'UNLOCK_DOOR_FAILED',
      message: formatFriendlyVietnameseHardwareNotice(err)
    });
  }
}

async function uploadBiometricFace(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const { subjectType, subjectId } = req.params;
    const { imageBase64, source = 'UPLOAD' } = req.body || {};

    const saved = await biometricSyncService.saveBiometricFacePhoto({
      tenantId,
      subjectType,
      subjectId,
      imageBase64,
      source,
      actorId: req.user?._id
    });

    return res.json({
      success: true,
      data: saved,
      message: `Đã lưu ảnh chân dung điểm danh rõ nét (${saved.sizeKB} KB) cho "${saved.fullName}". Bạn có thể bấm "Đẩy xuống máy chấm công" ngay!`
    });
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      code: err.code || 'UPLOAD_FACE_FAILED',
      message: formatFriendlyVietnameseHardwareNotice(err)
    });
  }
}

async function removeBiometricFace(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const { subjectType, subjectId } = req.params;
    await biometricSyncService.deleteBiometricFacePhoto({ tenantId, subjectType, subjectId });
    return res.json({
      success: true,
      message: 'Đã xóa ảnh khuôn mặt chấm công của hồ sơ này trên phần mềm.'
    });
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      code: err.code || 'DELETE_FACE_FAILED',
      message: formatFriendlyVietnameseHardwareNotice(err)
    });
  }
}

async function pushSingleBiometricPerson(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const { subjectType, subjectId } = req.params;
    const result = await biometricSyncService.pushSinglePersonToCampusDevices(tenantId, {
      subjectType,
      subjectId,
      targetDeviceId: req.body?.deviceId || null,
      actorId: req.user?._id
    });

    return res.json({
      success: result.syncedDevices > 0,
      data: result,
      message:
        result.syncedDevices > 0
          ? `Đã đồng bộ thành công khuôn mặt của "${result.fullName}" xuống ${result.syncedDevices}/${result.totalDevices} máy chấm công!`
          : formatFriendlyVietnameseHardwareNotice(result.results[0]?.message || 'DEVICE_OFFLINE', { personName: result.fullName })
    });
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      code: err.code || 'PUSH_SINGLE_PERSON_FAILED',
      message: formatFriendlyVietnameseHardwareNotice(err)
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CẦU NỐI MẠNG NỘI BỘ 127.0.0.1:18686, ĐỔI TÊN MIỀN WEBHOOK 1 CHẠM & SSE TRỰC TIẾP
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tải xuống bộ cài đặt 1 chạm `HoaNang-BoKetNoiMayChamCong-1Cham.zip` cho máy tính Windows đặt tại trường.
 */
async function downloadConnectorPackage(req, res) {
  try {
    assertTenantContext(req);
    const zipBuffer = await generateDownloadableConnectorZipBuffer();
    res.status(200);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="HoaNang-BoKetNoiMayChamCong-1Cham.zip"'
    );
    res.setHeader('Content-Length', zipBuffer.length);
    return res.end(zipBuffer);
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: formatFriendlyVietnameseHardwareNotice(err)
    });
  }
}

/**
 * Ký cấp `grantToken` (Ed25519) động theo tên miền hiện tại để trình duyệt giao tiếp an toàn với `http://127.0.0.1:18686`.
 */
async function issueLocalConnectorGrant(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const tenantDoc = req.tenant || (await Tenant.findById(tenantId).select('code name').lean());
    const schoolCode = tenantDoc?.code || '';
    const allowedOrigin = resolveDynamicPublicBaseUrl(req, req.body?.clientOrigin || req.header('Origin') || '');

    const grantData = await issueConnectorGrantForTenant({
      tenantId,
      schoolCode,
      schoolName: tenantDoc?.name || '',
      allowedOrigin,
      isVendorSupport: Boolean(req.isVendorSupport)
    });

    return res.json({
      success: true,
      data: {
        ...grantData,
        publicBaseUrl: allowedOrigin,
        webhookUrl: schoolCode
          ? `${allowedOrigin}/api/attendance/webhook/${schoolCode}`
          : `${allowedOrigin}/api/attendance/webhook`
      }
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: formatFriendlyVietnameseHardwareNotice(err)
    });
  }
}

/**
 * Đối chiếu danh sách thiết bị vừa quét từ `Local LAN Connector (127.0.0.1:18686)` với CSDL phân hiệu.
 */
async function enrichConnectorLanScan(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const rawList = Array.isArray(req.body?.discoveredDevices)
      ? req.body.discoveredDevices
      : Array.isArray(req.body?.devices)
        ? req.body.devices
        : [];
    const enriched = await biometricSyncService.enrichConnectorDiscoveredDevices(tenantId, rawList);
    return res.json({
      success: true,
      data: {
        scannedSubnets: req.body?.scannedSubnets || ['Mạng nội bộ tại trường'],
        discoveredDevices: enriched
      },
      message:
        enriched.length > 0
          ? `Đã tìm thấy ${enriched.length} máy chấm công Hikvision ngay trong mạng nội bộ của trường!`
          : 'Đã quét mạng nội bộ trên máy tính này nhưng chưa thấy máy chấm công Hikvision nào đang bật.'
    });
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      message: formatFriendlyVietnameseHardwareNotice(err)
    });
  }
}

/**
 * Chuẩn bị gói lệnh & phong bì mật khẩu mã hóa `encryptedDeviceAuth` gửi xuống `127.0.0.1:18686`.
 */
async function prepareConnectorAction(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const taskPayload = await biometricSyncService.prepareConnectorDeviceTask(
      tenantId,
      req.params.id,
      req.body || {}
    );
    const dynamicOrigin = resolveDynamicPublicBaseUrl(req, req.body?.clientOrigin || req.header('Origin') || '');
    const tenantDoc = await Tenant.findById(tenantId).select('code name').lean();
    const schoolCode = tenantDoc?.code || (await resolveTenantCode(req, tenantId));
    const grantInfo = await issueConnectorGrantForTenant({
      tenantId,
      schoolCode,
      schoolName: tenantDoc?.name || '',
      allowedOrigin: dynamicOrigin,
      isVendorSupport: Boolean(req.isVendorSupport)
    });
    taskPayload.grantToken = grantInfo.grantToken;
    taskPayload.webhookUrl = schoolCode
      ? `${dynamicOrigin}/api/attendance/webhook/${schoolCode}`
      : `${dynamicOrigin}/api/attendance/webhook`;

    return res.json({ success: true, data: taskPayload });
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      code: err.code,
      message: formatFriendlyVietnameseHardwareNotice(err)
    });
  }
}

/**
 * Lưu dữ liệu Người dùng + Ảnh mặt + Lượt quẹt vừa kéo từ `127.0.0.1:18686` vào đúng phân hiệu (`tenantId`).
 */
async function ingestConnectorPull(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const result = await biometricSyncService.ingestConnectorPulledPayload(tenantId, req.params.id, {
      ...(req.body || {}),
      actorId: req.user?._id
    });
    return res.json({
      success: true,
      data: result,
      message: result.message
    });
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      code: err.code,
      message: formatFriendlyVietnameseHardwareNotice(err)
    });
  }
}

/**
 * Cập nhật kết quả sau khi `127.0.0.1:18686` đẩy xong danh sách khuôn mặt từ Web xuống máy chấm công.
 */
async function completeConnectorPush(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const result = await biometricSyncService.completeConnectorPushedPayload(tenantId, req.params.id, {
      ...(req.body || {}),
      actorId: req.user?._id
    });
    return res.json({
      success: true,
      data: result,
      message: result.message
    });
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      code: err.code,
      message: formatFriendlyVietnameseHardwareNotice(err)
    });
  }
}

/**
 * Nút 1 chạm cập nhật địa chỉ HTTP Listening Webhook theo Tên miền động hiện tại xuống máy Hikvision.
 */
async function configureDeviceWebhook(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const publicBaseUrl = resolveDynamicPublicBaseUrl(req, req.body?.clientOrigin || req.header('Origin') || '');
    const result = await biometricSyncService.configureDeviceWebhookEndpoint(tenantId, req.params.id, {
      publicBaseUrl,
      connectorVerifiedResult: req.body?.connectorVerifiedResult || req.body?.connectorAppliedResult || null
    });
    return res.json({
      success: true,
      data: result,
      message: result.message
    });
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      code: err.code,
      message: formatFriendlyVietnameseHardwareNotice(err)
    });
  }
}

/**
 * Chỉ dành cho Kỹ thuật viên Nhà cung cấp phần mềm (`req.isVendorSupport === true`):
 * Gỡ khóa `deviceSerial` hoặc chuyển máy chấm công sang phân hiệu trường khác.
 */
async function unlockDeviceSerialByVendor(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const result = await biometricSyncService.unlockOrReassignDeviceSerialByVendor(tenantId, req.params.id, {
      newSerialNumber: req.body?.newSerialNumber || '',
      targetSchoolCode: req.body?.targetSchoolCode || '',
      targetTenantId: req.body?.targetTenantId || '',
      isVendorSupport: Boolean(req.isVendorSupport)
    });
    return res.json({
      success: true,
      data: result,
      message: result.message
    });
  } catch (err) {
    return res.status(err.statusCode || 403).json({
      success: false,
      code: err.code,
      message: formatFriendlyVietnameseHardwareNotice(err)
    });
  }
}

/**
 * Luồng SSE thời gian thực cô lập tuyệt đối theo `tenantId` để báo tiếng Việt ngay khi học sinh/nhân sự quét mặt.
 */
function streamCampusLiveEvents(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    attachCampusSseStream(req, res, tenantId);
  } catch (err) {
    res.status(err.statusCode || 403).json({
      success: false,
      message: 'Phiên kết nối thông báo trực tiếp chưa hợp lệ.'
    });
  }
}

function getCampusRecentLiveEvents(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const items = getRecentCampusRealtimeEvents(tenantId, req.query?.limit || 15);
    return res.json({ success: true, data: items });
  } catch (err) {
    return res.status(err.statusCode || 403).json({
      success: false,
      message: 'Không thể tải danh sách sự kiện trực tiếp.'
    });
  }
}

module.exports = {
  assertTenantContext,
  sanitizeDevice,
  listDevices,
  createDevice,
  getDeviceById,
  updateDevice,
  deleteDevice,
  testDeviceConn,
  triggerDeviceSync,
  listPersonMappings,
  upsertPersonMapping,
  deletePersonMapping,
  getSyncLogs,
  getUnmappedEvents,
  simulateWebhook,
  getBiometricOverview,
  discoverLanDevices,
  checkDeviceCapacity,
  pullUsersFromDevice,
  pushSmartSyncToDevice,
  syncAllDevicesSmart,
  pullAllDevicesFast,
  quickBidirectionalSync,
  linkPulledDeviceUser,
  importPulledUsersToWeb,
  pruneDeviceInactiveSlots,
  unlockDeviceDoor,
  uploadBiometricFace,
  removeBiometricFace,
  pushSingleBiometricPerson,
  downloadConnectorPackage,
  issueLocalConnectorGrant,
  enrichConnectorLanScan,
  prepareConnectorAction,
  ingestConnectorPull,
  completeConnectorPush,
  configureDeviceWebhook,
  unlockDeviceSerialByVendor,
  streamCampusLiveEvents,
  getCampusRecentLiveEvents
};
