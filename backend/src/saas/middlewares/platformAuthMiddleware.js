const { verifySaasToken } = require('../utils/saasJwt');
const PlatformAdmin = require('../../models/zone1_system/PlatformAdmin');

const platformAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Vui lòng cung cấp token quản trị nền tảng'
      });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    let decoded;
    try {
      decoded = verifySaasToken(token, 'PLATFORM_ADMIN_ACCESS');
    } catch (err) {
      if (err.message && err.message.includes('PRE_AUTH_MFA_CHALLENGE')) {
        return res.status(403).json({
          success: false,
          code: 'MFA_REQUIRED',
          message: 'Token thử thách MFA không có quyền truy cập API quản trị'
        });
      }
      return res.status(401).json({
        success: false,
        code: 'TOKEN_INVALID',
        message: err.message || 'Token không hợp lệ hoặc đã hết hạn'
      });
    }

    const admin = await PlatformAdmin.findById(decoded.sub);
    if (!admin || admin.status !== 'active') {
      return res.status(401).json({
        success: false,
        code: 'ADMIN_INACTIVE',
        message: 'Tài khoản quản trị không tồn tại hoặc đã bị khóa'
      });
    }

    if (decoded.authVersion !== (admin.authVersion || 0)) {
      return res.status(401).json({
        success: false,
        code: 'AUTH_VERSION_MISMATCH',
        message: 'Phiên quản trị đã bị thu hồi'
      });
    }

    req.platformAdmin = admin;
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Lỗi xác thực quản trị nền tảng'
    });
  }
};

const requirePlatformRole = (allowedRoles = []) => (req, res, next) => {
  if (!req.platformAdmin) {
    return res.status(401).json({
      success: false,
      message: 'Chưa xác thực quyền quản trị'
    });
  }

  if (!allowedRoles.includes(req.platformAdmin.role)) {
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN_PLATFORM_ROLE',
      message: `Vai trò '${req.platformAdmin.role}' không có quyền thực hiện thao tác này`
    });
  }

  next();
};

module.exports = {
  platformAuthMiddleware,
  requirePlatformRole
};
