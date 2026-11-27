'use strict';

/**
 * @fileoverview Bộ giới hạn tần suất truy cập (Rate Limiters) chống tấn công Brute-Force, Flood & Bot cào dữ liệu.
 * Trong môi trường kiểm thử tự động (`NODE_ENV=test` / Jest), ngưỡng được nới rộng để không cản trở kịch bản chạy song song.
 */

const rateLimit = require('express-rate-limit');

const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isTestEnv ? 1000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    code: 'TOO_MANY_LOGIN_ATTEMPTS',
    message: 'Có quá nhiều lần thử đăng nhập. Vui lòng thử lại sau 15 phút.'
  }
});

const mfaVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isTestEnv ? 1000 : 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    code: 'TOO_MANY_MFA_ATTEMPTS',
    message: 'Nhập sai OTP quá 5 lần. Vui lòng thử lại sau 15 phút.'
  }
});

const apiGeneralLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: isTestEnv ? 5000 : 500,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Tần suất gửi yêu cầu quá cao. Vui lòng chậm lại và thử lại sau ít giây.'
  }
});

const deviceIngestLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: isTestEnv ? 2000 : 180,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    code: 'DEVICE_RATE_LIMIT_EXCEEDED',
    message: 'Thiết bị đẩy sự kiện vượt quá tần suất cho phép.'
  }
});

module.exports = {
  authLimiter,
  mfaVerifyLimiter,
  apiGeneralLimiter,
  deviceIngestLimiter
};
