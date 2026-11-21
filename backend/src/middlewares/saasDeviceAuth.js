'use strict';

const crypto = require('crypto');
const TimekeepingDevice = require('../models/zone2_hr/TimekeepingDevice');

/**
 * Tenant-aware authentication middleware for hardware timekeeping devices.
 * 
 * Rules:
 * 1. API key is REQUIRED for every push request.
 * 2. Look up TimekeepingDevice strictly by apiKeyHash (SHA-256 of the raw API key).
 * 3. Never look up device solely by deviceCode (different tenants may have same deviceCode).
 * 4. Timing-safe comparison of the hash.
 * 5. Rejects with 401 DEVICE_KEY_REQUIRED if key is missing.
 * 6. Rejects with 401 DEVICE_AUTH_FAILED if key does not match any registered device.
 * 7. Rejects with 401 DEVICE_KEY_COLLISION if multiple devices share the same key hash.
 * 8. Rejects with 403 DEVICE_NO_TENANT if device has no tenantId.
 * 9. Rejects with 403 DEVICE_DISABLED if device is disabled.
 * 10. If X-Device-Code header is sent, it must match device.deviceCode; mismatch returns 401 DEVICE_CODE_MISMATCH.
 * 11. Overwrites any tenantId in request body with device.tenantId to prevent spoofing.
 */
const saasDeviceAuth = async (req, res, next) => {
  try {
    let rawApiKey = req.header('X-Device-Api-Key');
    if (!rawApiKey) {
      const authHeader = req.header('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        rawApiKey = authHeader.slice(7).trim();
      }
    }

    if (!rawApiKey || typeof rawApiKey !== 'string' || !rawApiKey.trim()) {
      return res.status(401).json({
        success: false,
        code: 'DEVICE_KEY_REQUIRED',
        message: 'API Key là bắt buộc cho thiết bị điểm danh (X-Device-Api-Key hoặc Bearer token)'
      });
    }

    const trimmedKey = rawApiKey.trim();
    const keyHash = crypto.createHash('sha256').update(trimmedKey).digest('hex');

    // Query device by apiKeyHash
    const devices = await TimekeepingDevice.find({ apiKeyHash: keyHash });

    if (!devices || devices.length === 0) {
      return res.status(401).json({
        success: false,
        code: 'DEVICE_AUTH_FAILED',
        message: 'Khóa API Key không hợp lệ hoặc thiết bị chưa được đăng ký trong hệ thống'
      });
    }

    if (devices.length > 1) {
      // Fail-closed security: Ambiguous key collision across devices
      return res.status(401).json({
        success: false,
        code: 'DEVICE_KEY_COLLISION',
        message: 'Phát hiện xung đột khóa xác thực giữa nhiều thiết bị. Yêu cầu cấp lại khóa mới.'
      });
    }

    const device = devices[0];

    // Timing-safe equal check on hash
    const storedHashBuf = Buffer.from(device.apiKeyHash, 'utf8');
    const computedHashBuf = Buffer.from(keyHash, 'utf8');
    if (storedHashBuf.length !== computedHashBuf.length || !crypto.timingSafeEqual(storedHashBuf, computedHashBuf)) {
      return res.status(401).json({
        success: false,
        code: 'DEVICE_AUTH_FAILED',
        message: 'Khóa API Key xác thực thất bại'
      });
    }

    // Check tenant boundary
    if (!device.tenantId) {
      return res.status(403).json({
        success: false,
        code: 'DEVICE_NO_TENANT',
        message: 'Thiết bị chưa được liên kết với trường học (tenant) nào'
      });
    }

    // Check enabled status
    if (!device.enabled) {
      return res.status(403).json({
        success: false,
        code: 'DEVICE_DISABLED',
        message: 'Thiết bị này đang bị tạm dừng hoặc đã bị vô hiệu hóa'
      });
    }

    // Optional deviceCode mismatch check if header provided
    const headerCode = req.header('X-Device-Code') || req.body?.deviceCode || req.body?.deviceId;
    if (headerCode && String(headerCode).trim().toUpperCase() !== String(device.deviceCode).toUpperCase()) {
      return res.status(401).json({
        success: false,
        code: 'DEVICE_CODE_MISMATCH',
        message: `Mã thiết bị gửi lên (${headerCode}) không khớp với cấu hình thiết bị (${device.deviceCode})`
      });
    }

    // Attach verified device and enforce tenant context from DB
    req.device = device;
    req.tenantId = device.tenantId;

    // SECURITY: Overwrite any tenantId passed in the request body to prevent tenant spoofing
    if (req.body && typeof req.body === 'object') {
      req.body.tenantId = device.tenantId;
      req.body.deviceId = device.deviceCode;
    }

    return next();
  } catch (err) {
    console.error('saasDeviceAuth error:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi xác thực thiết bị'
    });
  }
};

module.exports = saasDeviceAuth;
