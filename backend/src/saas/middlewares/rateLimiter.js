const rateLimit = require('express-rate-limit');

const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isTestEnv ? 1000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
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

module.exports = {
  authLimiter,
  mfaVerifyLimiter
};
