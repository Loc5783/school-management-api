'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const TimekeepingDevice = require('../models/zone2_hr/TimekeepingDevice');
const AttendanceDevicePersonMapping = require('../models/zone2_hr/AttendanceDevicePersonMapping');
const DeviceSyncLog = require('../models/zone2_hr/DeviceSyncLog');
const RawAttendanceEvent = require('../models/zone2_hr/RawAttendanceEvent');
const User = require('../models/zone1_system/User');
const Student = require('../models/zone3_school/Student');
const Tenant = require('../models/zone1_system/Tenant');
const { testDeviceConnection, syncDeviceEvents } = require('../services/hikvisionSyncService');
const { validateDeviceHost } = require('../services/hikvisionIsapiService');
const { ingestStudentDeviceAttendance } = require('../services/attendanceDeviceService');
const { calculateAttendanceForUserDate } = require('../services/attendanceCalculationService');
const { createTrustedTenantContext } = require('../services/tenantFilterService');
const { getWorkDate, DEFAULT_SCHOOL_TIMEZONE } = require('../utils/dateHelpers');

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

/**
 * Helper to sanitize device DTO, stripping secret fields:
 * apiKeyHash, credentialKey, syncLease.
 * Attaches non-sensitive boolean flags: credentialConfigured, credentialStatus.
 */
function sanitizeDevice(doc) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  const prefix = obj.credentialKey;
  let credentialConfigured = false;
  if (prefix) {
    const username = process.env[`${prefix}_USERNAME`];
    const password = process.env[`${prefix}_PASSWORD`];
    credentialConfigured = Boolean(username && password);
  }
  obj.credentialConfigured = credentialConfigured;
  obj.credentialStatus = credentialConfigured ? 'CONFIGURED' : 'MISSING';

  delete obj.apiKeyHash;
  delete obj.credentialKey;
  delete obj.syncLease;
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
    const devices = await TimekeepingDevice.find({ tenantId }).sort({ createdAt: -1 });

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

    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code || 'LIST_DEVICES_FAILED',
      message: err.message || 'Lỗi tải danh sách thiết bị'
    });
  }
}

/**
 * Create a new device registration.
 */
async function createDevice(req, res) {
  try {
    const tenantId = assertTenantContext(req);
    const {
      deviceCode,
      name,
      vendor = 'HIKVISION',
      model = 'DS-K1T320MX',
      host,
      httpPort = 80,
      httpsPort = 443,
      sdkPort = 8000,
      protocol = 'ISAPI',
      timezone = 'Asia/Ho_Chi_Minh',
      apiKey,
      serialNumber,
      allowSelfSigned = true
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

    // SSRF & Safety validation
    validateDeviceHost(host);

    // Server automatically derives credential reference strictly from tenant
    const tenantCode = await resolveTenantCode(req, tenantId);
    const cleanCode = String(tenantCode || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const credentialKey = `HIKVISION_${cleanCode}`;

    // Check deviceCode uniqueness within tenant
    const existing = await TimekeepingDevice.findOne({
      tenantId,
      deviceCode: String(deviceCode).trim().toUpperCase()
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Mã thiết bị "${deviceCode}" đã tồn tại trong trường này`
      });
    }

    // Check serialNumber uniqueness within tenant if provided
    if (serialNumber && String(serialNumber).trim()) {
      const cleanSerial = String(serialNumber).trim();
      const existingSerial = await TimekeepingDevice.findOne({
        tenantId,
        serialNumber: cleanSerial
      });
      if (existingSerial) {
        return res.status(409).json({
          success: false,
          message: `Số serial "${cleanSerial}" đã tồn tại trong trường này`
        });
      }
    }

    // Hash apiKey if provided
    let apiKeyHash = undefined;
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
      deviceCode: String(deviceCode).trim().toUpperCase(),
      name: String(name).trim(),
      vendor,
      model: String(model).trim(),
      serialNumber: serialNumber ? String(serialNumber).trim() : undefined,
      host: host.trim(),
      httpPort: Number(httpPort) || 80,
      httpsPort: Number(httpsPort) || 443,
      sdkPort: Number(sdkPort) || 8000,
      protocol,
      timezone,
      credentialKey,
      apiKeyHash,
      allowSelfSigned: Boolean(allowSelfSigned),
      createdBy: req.user?._id
    });

    await device.save();
    return res.status(201).json({ success: true, data: sanitizeDevice(device) });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code,
      message: err.message || 'Lỗi tạo thiết bị'
    });
  }
}

/**
 * Get device by ID.
 */
async function getDeviceById(req, res) {
  try {
    const tenantId = assertTenantContext(req);
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
      model,
      serialNumber,
      host,
      httpPort,
      httpsPort,
      sdkPort,
      enabled,
      timezone,
      apiKey,
      allowSelfSigned
    } = req.body;

    if (host) {
      validateDeviceHost(host);
      device.host = host.trim();
    }
    if (name) device.name = String(name).trim();
    if (model) device.model = String(model).trim();
    if (serialNumber !== undefined) {
      const cleanSerial = String(serialNumber).trim();
      if (cleanSerial) {
        const serialConflict = await TimekeepingDevice.findOne({
          tenantId,
          serialNumber: cleanSerial,
          _id: { $ne: device._id }
        });
        if (serialConflict) {
          return res.status(409).json({
            success: false,
            message: `Số serial "${cleanSerial}" đã tồn tại trong trường này`
          });
        }
      }
      device.serialNumber = cleanSerial || undefined;
    }
    if (httpPort !== undefined) device.httpPort = Number(httpPort);
    if (httpsPort !== undefined) device.httpsPort = Number(httpsPort);
    if (sdkPort !== undefined) device.sdkPort = Number(sdkPort);
    if (enabled !== undefined) device.enabled = Boolean(enabled);
    if (timezone) device.timezone = timezone;
    if (allowSelfSigned !== undefined) device.allowSelfSigned = Boolean(allowSelfSigned);

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
      message: err.message || 'Lỗi cập nhật thiết bị'
    });
  }
}

/**
 * Test connectivity to an ISAPI device (Admin only).
 */
async function testDeviceConn(req, res) {
  try {
    const tenantId = assertTenantContext(req);
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
 * Trigger manual sync job (Admin, Principal).
 */
async function triggerDeviceSync(req, res) {
  try {
    const tenantId = assertTenantContext(req);
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
 * Create or update a person mapping (Admin only).
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

    if (!['EMPLOYEE', 'STUDENT'].includes(subjectType)) {
      return res.status(400).json({ success: false, message: 'subjectType phải là EMPLOYEE hoặc STUDENT' });
    }

    // Verify device belongs to this tenant
    const device = await TimekeepingDevice.findOne({ _id: deviceId, tenantId });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thiết bị trong trường này' });
    }

    // Tenant boundary verification on target subject
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

    // Check conflict: subject mapped to another external ID on this device
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

    // Upsert mapping
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

    // Tự động xử lý bù (backfill) các sự kiện UNMAPPED trước đó của mã máy này sang đúng Học sinh / Nhân viên vừa gán
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
  } catch (err) {
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
 * Get unmapped events for this device to help admin map persons easily.
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

module.exports = {
  assertTenantContext,
  sanitizeDevice,
  listDevices,
  createDevice,
  getDeviceById,
  updateDevice,
  testDeviceConn,
  triggerDeviceSync,
  listPersonMappings,
  upsertPersonMapping,
  deletePersonMapping,
  getSyncLogs,
  getUnmappedEvents
};
