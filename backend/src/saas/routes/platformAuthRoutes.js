const express = require('express');
const router = express.Router();
const { login, verifyMfa, getMe } = require('../controllers/platformAuthController');
const { platformAuthMiddleware } = require('../middlewares/platformAuthMiddleware');
const { authLimiter, mfaVerifyLimiter } = require('../middlewares/rateLimiter');

router.post('/login', authLimiter, login);
router.post('/verify-mfa', mfaVerifyLimiter, verifyMfa);
router.get('/me', platformAuthMiddleware, getMe);

module.exports = router;
