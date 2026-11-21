const { verifySaasToken } = require('../utils/saasJwt');
const User = require('../../models/zone1_system/User');
const Tenant = require('../../models/zone1_system/Tenant');
const RevokedSession = require('../../models/zone1_system/RevokedSession');

const schoolAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Vui lòng cung cấp access token'
      });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    let decoded;
    try {
      decoded = verifySaasToken(token);
    } catch (err) {
      // Cho phép phiên Legacy xác thực tại endpoint kế thừa /api/auth (không phải /api/v1/*)
      if (req.baseUrl === '/api/auth') {
        const { verifyToken } = require('../../utils/jwt');
        try {
          const legacyDecoded = verifyToken(token);
          if (!legacyDecoded.purpose && !legacyDecoded.tenantId) {
            const user = await User.findById(legacyDecoded.sub || legacyDecoded.subject);
            if (!user || user.status !== 'active' || user.tenantId) {
              return res.status(401).json({
                success: false,
                code: 'TOKEN_INVALID',
                message: 'Phiên đăng nhập không còn hiệu lực'
              });
            }
            if (legacyDecoded.authVersion !== (user.authVersion || 0)) {
              return res.status(401).json({
                success: false,
                code: 'AUTH_VERSION_MISMATCH',
                message: 'Phiên đăng nhập đã bị thu hồi'
              });
            }
            req.user = user;
            req.tenant = null;
            return next();
          }
        } catch {
          // Token legacy cũng không hợp lệ -> trả về lỗi TOKEN_INVALID bên dưới
        }
      }

      return res.status(401).json({
        success: false,
        code: 'TOKEN_INVALID',
        message: err.message || 'Token không hợp lệ hoặc đã hết hạn'
      });
    }

    // Token purpose check
    if (decoded.purpose === 'SUPPORT_ACCESS') {
      return res.status(501).json({
        success: false,
        code: 'SUPPORT_ACCESS_NOT_IMPLEMENTED',
        message: 'Cổng hỗ trợ kỹ thuật chưa mở trong Giai đoạn 1A'
      });
    }

    if (decoded.purpose !== 'SCHOOL_USER_ACCESS') {
      return res.status(403).json({
        success: false,
        code: 'INVALID_TOKEN_PURPOSE',
        message: 'Loại token không được phép truy cập cổng trường học'
      });
    }

    // Single-session revocation check (Lỗi 5)
    if (decoded.jti) {
      const isRevoked = await RevokedSession.exists({ jti: decoded.jti });
      if (isRevoked) {
        return res.status(401).json({
          success: false,
          code: 'SESSION_REVOKED',
          message: 'Phiên đăng nhập đã bị thu hồi'
        });
      }
    }

    // Authoritative check on User
    const user = await User.findById(decoded.sub);
    if (!user || user.status !== 'active') {
      return res.status(401).json({
        success: false,
        code: 'USER_INACTIVE',
        message: 'Tài khoản không tồn tại hoặc đã bị khóa'
      });
    }

    if (decoded.authVersion !== (user.authVersion || 0)) {
      return res.status(401).json({
        success: false,
        code: 'AUTH_VERSION_MISMATCH',
        message: 'Phiên đăng nhập đã bị thu hồi'
      });
    }

    // Verify tenant match between token and user record
    if (!user.tenantId || user.tenantId.toString() !== decoded.tenantId) {
      return res.status(403).json({
        success: false,
        code: 'TENANT_MISMATCH',
        message: 'Token không khớp với tenant của người dùng (Tenant Mismatch)'
      });
    }

    // Authoritative check on Tenant
    const tenant = await Tenant.findById(user.tenantId);
    if (!tenant) {
      return res.status(401).json({
        success: false,
        code: 'TENANT_NOT_FOUND',
        message: 'Trường học không tồn tại'
      });
    }

    if (tenant.status === 'suspended' || tenant.status === 'terminated') {
      return res.status(403).json({
        success: false,
        code: 'TENANT_SUSPENDED',
        message: 'Trường học đã bị tạm ngưng hoạt động'
      });
    }

    if (decoded.tenantAuthVersion !== (tenant.authVersion || 0)) {
      return res.status(403).json({
        success: false,
        code: 'TENANT_AUTH_REVOKED',
        message: 'Phiên làm việc của trường đã bị thu hồi'
      });
    }

    // Bind authoritative context (ignore any spoofed X-Tenant-Id header)
    req.user = user;
    req.tenant = tenant;
    req.tenantId = user.tenantId.toString();
    req.tokenJti = decoded.jti;
    req.tokenExp = decoded.exp;

    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Lỗi xác thực hệ thống'
    });
  }
};

module.exports = schoolAuthMiddleware;
