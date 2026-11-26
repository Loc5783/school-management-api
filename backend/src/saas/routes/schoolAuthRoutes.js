const express = require('express');
const router = express.Router();
const { login, getMe, logout } = require('../controllers/schoolAuthController');
const { changeMyPassword } = require('../../controllers/authController');
const schoolAuthMiddleware = require('../middlewares/schoolAuthMiddleware');
const { authLimiter } = require('../middlewares/rateLimiter');

router.post('/login', authLimiter, login);
router.get('/me', schoolAuthMiddleware, getMe);
router.post('/me/password', schoolAuthMiddleware, authLimiter, changeMyPassword);
router.post('/logout', schoolAuthMiddleware, logout);


// Public registration is disabled
router.post('/register', (req, res) => {
  return res.status(403).json({
    success: false,
    message: 'Chức năng tự đăng ký tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ nhà trường để được cấp tài khoản.'
  });
});

router.get('/registration-classrooms', (req, res) => {
  return res.status(403).json({
    success: false,
    message: 'Chức năng tự đăng ký tài khoản đã bị vô hiệu hóa.'
  });
});

module.exports = router;
