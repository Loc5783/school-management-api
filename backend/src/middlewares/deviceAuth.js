const crypto = require('crypto');

/**
 * Authentication for physical timekeeping devices. Keep this separate from a
 * staff JWT so a device cannot impersonate an admin account.
 */
const deviceAuth = (req, res, next) => {
  const configuredKey = process.env.DEVICE_INGEST_API_KEY;
  const providedKey = req.header('X-Device-Api-Key');
  if (!configuredKey) {
    return res.status(503).json({ message: 'Thiếu cấu hình DEVICE_INGEST_API_KEY' });
  }
  if (!providedKey || providedKey.length !== configuredKey.length) {
    return res.status(401).json({ message: 'Thiết bị chưa được xác thực' });
  }
  const valid = crypto.timingSafeEqual(Buffer.from(providedKey), Buffer.from(configuredKey));
  if (!valid) return res.status(401).json({ message: 'Thiết bị chưa được xác thực' });
  return next();
};

module.exports = deviceAuth;
