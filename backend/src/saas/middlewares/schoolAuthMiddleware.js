const { verifySaasToken } = require('../utils/saasJwt');
const User = require('../../models/zone1_system/User');
const Tenant = require('../../models/zone1_system/Tenant');
const RevokedSession = require('../../models/zone1_system/RevokedSession');
const { getSystemSettings, sanitizeEnabledModules } = require('../../services/superAdminControlService');

/**
 * Ánh xạ đường dẫn API của trường sang khóa Module do SuperAdmin cấp phép.
 */
const resolveModuleKeyFromBaseUrl = (baseUrl = '') => {
  const clean = String(baseUrl || '').replace(/^\/api(\/v1)?\//, '');
  const prefix = clean.split('/')[0];
  const map = {
    students: 'students',
    classrooms: 'classrooms',
    attendance: 'attendance',
    hr: 'hr',
    timekeeping: 'timekeeping',
    finance: 'finance',
    reports: 'reports',
    nutrition: 'nutrition',
    notifications: 'notifications',
    chat: 'chat',
    'class-communication': 'chat',
    pickups: 'pickups',
    guard: 'guard',
    procurement: 'procurement',
    'parent-feedback': 'feedback',
    'student-profile-change-requests': 'feedback'
  };
  return map[prefix] || null;
};

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
            if (!user || user.status !== 'active' || user.tenantId || (user.accessEndsAt && user.accessEndsAt <= new Date())) {
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
        message: err?.name === 'TokenExpiredError'
          ? 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại'
          : 'Token xác thực không hợp lệ hoặc đã hết hạn'
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

    // Tối ưu hiệu năng Hot-Path: Chạy song song kiểm tra thu hồi phiên, đọc User (ẩn passwordHash),
    // đọc Tenant và đọc Cấu hình Hệ thống trong 1 nhịp Promise.all thay vì 4 lượt tuần tự
    const [isRevoked, user, tenant, sysSettings] = await Promise.all([
      decoded.jti ? RevokedSession.exists({ jti: decoded.jti }) : Promise.resolve(null),
      User.findById(decoded.sub).select('-passwordHash'),
      decoded.tenantId ? Tenant.findById(decoded.tenantId) : Promise.resolve(null),
      getSystemSettings()
    ]);

    if (isRevoked) {
      return res.status(401).json({
        success: false,
        code: 'SESSION_REVOKED',
        message: 'Phiên đăng nhập đã bị thu hồi'
      });
    }

    if (!user || user.status !== 'active' || (user.accessEndsAt && user.accessEndsAt <= new Date())) {
      return res.status(401).json({
        success: false,
        code: 'USER_INACTIVE',
        message: 'Tài khoản không tồn tại, đã bị khóa hoặc đã hết thời hạn truy cập'
      });
    }

    if (decoded.authVersion !== (user.authVersion || 0)) {
      return res.status(401).json({
        success: false,
        code: 'AUTH_VERSION_MISMATCH',
        message: 'Phiên đăng nhập đã bị thu hồi'
      });
    }

    if (!user.tenantId || user.tenantId.toString() !== decoded.tenantId) {
      return res.status(403).json({
        success: false,
        code: 'TENANT_MISMATCH',
        message: 'Token không khớp với tenant của người dùng (Tenant Mismatch)'
      });
    }

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

    // Kiểm tra Chế độ Bảo trì Toàn Hệ thống & Phân hệ chức năng được SuperAdmin cấp phép cho trường
    if (sysSettings.maintenanceMode?.enabled && req.baseUrl !== '/api/auth' && req.baseUrl !== '/api/v1/auth') {
      return res.status(503).json({
        success: false,
        code: 'MAINTENANCE_MODE',
        message: sysSettings.maintenanceMode.message || 'Hệ thống đang trong chế độ bảo trì toàn chuỗi.'
      });
    }

    if (tenant.config?.moduleGateConfigured) {
      const requiredModule = resolveModuleKeyFromBaseUrl(req.baseUrl);
      if (requiredModule) {
        const activeModules = sanitizeEnabledModules(tenant.enabledModules);
        if (!activeModules.includes(requiredModule)) {
          return res.status(403).json({
            success: false,
            code: 'MODULE_DISABLED_BY_SUPERADMIN',
            message: 'Phân hệ chức năng này chưa được Quản trị Tổng kích hoạt cho trường của bạn.'
          });
        }
      }
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
