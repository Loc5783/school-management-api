'use strict';

/**
 * @fileoverview Bộ điều khiển Xác thực Hợp nhất theo Vai trò (Unified Role-Aware Login).
 *
 * Quy tắc tự động nhận diện vai trò trên 1 màn hình đăng nhập duy nhất (không chia tab):
 * 1. Người dùng chỉ cần nhập `username` + `password` (`schoolCode` là tùy chọn):
 *    - Nếu khớp tài khoản **Admin Tổng Đa Trường (`PlatformAdmin`)** -> trả về `isSuperAdmin: true`,
 *      `user.role = 'superadmin'` để Frontend chuyển thẳng vào `/multi-school`.
 *    - Nếu khớp duy nhất 1 tài khoản trường học (`admin`, `principal`, `teacher`, `accountant`, `hr`, `chef`, `guard`, `parent`) ->
 *      tự động xác định `tenant` của tài khoản đó và chuyển thẳng vào trang chủ đúng `role`.
 *    - Chỉ khi trùng cả `username` và `password` ở nhiều trường khác nhau mới yêu cầu nhập thêm `schoolCode` để phân biệt.
 * 2. Khi có nhập `schoolCode` (VD: `HOANANG-A`):
 *    - Ưu tiên xác thực tài khoản thuộc đúng trường `schoolCode`.
 *    - Nếu không khớp user trong trường nhưng khớp tài khoản `PlatformAdmin` (trường hợp trình duyệt còn lưu mã trường cũ),
 *      vẫn tự động đăng nhập đúng vào Admin Tổng (`/multi-school`).
 */

const bcrypt = require('bcryptjs');
const Tenant = require('../../models/zone1_system/Tenant');
const User = require('../../models/zone1_system/User');
const PlatformAdmin = require('../../models/zone1_system/PlatformAdmin');
const RevokedSession = require('../../models/zone1_system/RevokedSession');
const { generateSchoolUserToken, generatePlatformAdminToken } = require('../utils/saasJwt');
const { isHoneypotTriggered } = require('../../middlewares/botScannerShield');
const { ALL_ENABLED_MODULES, sanitizeEnabledModules, getSystemSettings } = require('../../services/superAdminControlService');

const buildSuperAdminPayload = (platformAdmin) => ({
  success: true,
  message: 'Đăng nhập Quản trị Tổng Hệ thống thành công',
  isSuperAdmin: true,
  token: generatePlatformAdminToken(platformAdmin),
  tenant: null,
  user: {
    _id: platformAdmin._id,
    username: platformAdmin.username,
    role: 'superadmin',
    platformRole: platformAdmin.role,
    profile: {
      fullName: 'Quản trị Tổng Hệ thống (Đa trường)'
    }
  }
});

const buildSchoolUserPayload = async (user, tenant) => {
  const settings = await getSystemSettings();
  if (settings.maintenanceMode?.enabled) {
    throw Object.assign(
      new Error(settings.maintenanceMode.message || 'Hệ thống đang bảo trì nâng cấp định kỳ.'),
      { statusCode: 503, code: 'MAINTENANCE_MODE' }
    );
  }

  user.lastLogin = new Date();
  if (typeof user.save === 'function') {
    await user.save();
  } else {
    await User.updateOne({ _id: user._id }, { $set: { lastLogin: user.lastLogin } });
  }

  const sessionHours = settings.securityPolicy?.sessionTimeoutHours;
  const expiresIn = Number.isInteger(sessionHours) && sessionHours >= 1 && sessionHours <= 72
    ? `${sessionHours}h`
    : undefined;
  const token = generateSchoolUserToken(user, tenant, expiresIn);
  const resolvedModules = tenant.config?.moduleGateConfigured
    ? sanitizeEnabledModules(tenant.enabledModules)
    : [...ALL_ENABLED_MODULES];

  return {
    success: true,
    message: 'Đăng nhập thành công',
    token,
    tenant: {
      _id: tenant._id,
      id: tenant._id,
      code: tenant.code,
      name: tenant.name,
      status: tenant.status,
      enabledModules: resolvedModules,
      moduleGateConfigured: Boolean(tenant.config?.moduleGateConfigured),
      quotas: tenant.quotas || { maxCampuses: 10, maxStudents: 800, maxStaff: 200 }
    },
    user: {
      _id: user._id,
      username: user.username,
      role: user.role,
      profile: user.profile,
      tenantId: tenant._id,
      schoolCode: tenant.code
    }
  };
};

const isTenantSuspended = (tenant) =>
  !tenant || tenant.status === 'suspended' || tenant.status === 'terminated';

const isUserLockedOrExpired = (user, now = new Date()) =>
  user.status !== 'active' || Boolean(user.accessEndsAt && user.accessEndsAt <= now);

const login = async (req, res) => {
  try {
    if (isHoneypotTriggered(req)) {
      return res.status(403).json({
        success: false,
        code: 'BOT_DETECTED',
        message: 'Yêu cầu đăng nhập tự động bị từ chối.'
      });
    }

    const { schoolCode, username, password } = req.body || {};

    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp tên đăng nhập và mật khẩu'
      });
    }

    const cleanUsername = username.trim();
    const candidateAdminNames = cleanUsername === cleanUsername.toLowerCase()
      ? [cleanUsername]
      : [cleanUsername, cleanUsername.toLowerCase()];
    const hasSchoolCode = typeof schoolCode === 'string' && schoolCode.trim().length > 0;
    const now = new Date();

    // =========================================================================
    // LUỒNG 1: KHÔNG NHẬP MÃ TRƯỜNG -> TỰ ĐỘNG NHẬN DIỆN VAI TRÒ & TRƯỜNG HỌC
    // =========================================================================
    if (!hasSchoolCode) {
      // Bước 1A: Kiểm tra tài khoản Quản trị Tổng Đa Trường (PlatformAdmin)
      const platformAdmin = await PlatformAdmin.findOne({
        username: { $in: candidateAdminNames }
      });

      if (platformAdmin) {
        const isAdminMatch = await bcrypt.compare(password, platformAdmin.passwordHash);
        if (isAdminMatch) {
          if (platformAdmin.status !== 'active') {
            return res.status(401).json({
              success: false,
              code: 'ACCOUNT_LOCKED',
              message: 'Tài khoản Quản trị Tổng đang bị khóa hoặc tạm ngưng hoạt động'
            });
          }
          return res.status(200).json(buildSuperAdminPayload(platformAdmin));
        }
      }

      // Bước 1B: Tự động dò tài khoản thuộc các trường học theo username + password (tránh bắt người dùng nhớ mã trường)
      const candidateUsers = await User.find({
        tenantId: { $ne: null },
        username: cleanUsername
      }).limit(30);

      if (candidateUsers.length > 0) {
        const tenantIds = [...new Set(candidateUsers.map((u) => String(u.tenantId)))];
        const tenants = await Tenant.find({ _id: { $in: tenantIds } }).lean();
        const tenantMap = new Map(tenants.map((t) => [String(t._id), t]));

        const passwordChecks = await Promise.all(
          candidateUsers.map(async (u) => ({
            user: u,
            tenant: tenantMap.get(String(u.tenantId)) || null,
            matched: await bcrypt.compare(password, u.passwordHash)
          }))
        );

        const matchedEntries = passwordChecks.filter((entry) => entry.matched && entry.tenant);
        const activeEntries = matchedEntries.filter(
          (entry) => !isTenantSuspended(entry.tenant) && !isUserLockedOrExpired(entry.user, now)
        );

        if (activeEntries.length === 1) {
          const payload = await buildSchoolUserPayload(activeEntries[0].user, activeEntries[0].tenant);
          return res.status(200).json(payload);
        }

        if (activeEntries.length > 1) {
          return res.status(401).json({
            success: false,
            code: 'SCHOOL_CODE_REQUIRED',
            message: 'Tài khoản này trùng ở nhiều trường học. Vui lòng nhập thêm Mã trường học (VD: HOANANG-A) để vào đúng trường.'
          });
        }

        if (matchedEntries.length === 1) {
          if (isTenantSuspended(matchedEntries[0].tenant)) {
            return res.status(403).json({
              success: false,
              code: 'TENANT_SUSPENDED',
              message: 'Trường học đã bị tạm ngưng hoạt động'
            });
          }
          return res.status(401).json({
            success: false,
            code: 'ACCOUNT_LOCKED',
            message: 'Tài khoản đã bị vô hiệu hóa, bị khóa hoặc đã hết thời hạn truy cập'
          });
        }
      }

      // Bước 1C: Tương thích ngược tài khoản đơn trường Legacy (tenantId: null)
      const legacyUser = await User.findOne({
        tenantId: { $in: [null, undefined] },
        username: cleanUsername
      });

      if (legacyUser) {
        if (isUserLockedOrExpired(legacyUser, now)) {
          return res.status(401).json({
            success: false,
            code: 'ACCOUNT_LOCKED',
            message: 'Tài khoản đã bị vô hiệu hóa, bị khóa hoặc đã hết thời hạn truy cập'
          });
        }

        const isLegacyMatch = await bcrypt.compare(password, legacyUser.passwordHash);
        if (isLegacyMatch) {
          legacyUser.lastLogin = now;
          await legacyUser.save();

          const { generateToken } = require('../../utils/jwt');
          const token = generateToken(legacyUser);

          return res.status(200).json({
            success: true,
            message: 'Đăng nhập thành công',
            token,
            tenant: null,
            user: {
              _id: legacyUser._id,
              username: legacyUser.username,
              role: legacyUser.role,
              profile: legacyUser.profile,
              tenantId: null
            }
          });
        }
      }

      return res.status(401).json({
        success: false,
        message: 'Tên đăng nhập hoặc mật khẩu không chính xác'
      });
    }

    // =========================================================================
    // LUỒNG 2: CÓ NHẬP MÃ TRƯỜNG -> ƯU TIÊN TRƯỜNG ĐÓ, FALLBACK ADMIN TỔNG NẾU KHỚP
    // =========================================================================
    const cleanSchoolCode = String(schoolCode).trim().toUpperCase();
    const tenant = await Tenant.findOne({ code: cleanSchoolCode });
    let schoolUser = null;

    if (tenant) {
      schoolUser = await User.findOne({
        tenantId: tenant._id,
        username: cleanUsername
      });

      if (schoolUser) {
        const isSchoolMatch = await bcrypt.compare(password, schoolUser.passwordHash);
        if (isSchoolMatch) {
          if (isTenantSuspended(tenant)) {
            return res.status(403).json({
              success: false,
              code: 'TENANT_SUSPENDED',
              message: 'Trường học đã bị tạm ngưng hoạt động'
            });
          }
          if (isUserLockedOrExpired(schoolUser, now)) {
            return res.status(401).json({
              success: false,
              code: 'ACCOUNT_LOCKED',
              message: 'Tài khoản đã bị vô hiệu hóa, bị khóa hoặc đã hết thời hạn truy cập'
            });
          }

          const payload = await buildSchoolUserPayload(schoolUser, tenant);
          return res.status(200).json(payload);
        }
      }
    }

    // Fallback thông minh: nếu trình duyệt còn lưu mã trường cũ nhưng người dùng đăng nhập bằng tài khoản Admin Tổng
    const platformAdminFallback = await PlatformAdmin.findOne({
      username: { $in: candidateAdminNames }
    });
    if (platformAdminFallback) {
      const isFallbackAdminMatch = await bcrypt.compare(password, platformAdminFallback.passwordHash);
      if (isFallbackAdminMatch) {
        if (platformAdminFallback.status !== 'active') {
          return res.status(401).json({
            success: false,
            code: 'ACCOUNT_LOCKED',
            message: 'Tài khoản Quản trị Tổng đang bị khóa hoặc tạm ngưng hoạt động'
          });
        }
        return res.status(200).json(buildSuperAdminPayload(platformAdminFallback));
      }
    }

    if (!tenant) {
      return res.status(401).json({
        success: false,
        message: 'Mã trường học không tồn tại hoặc thông tin đăng nhập không chính xác'
      });
    }

    if (isTenantSuspended(tenant)) {
      return res.status(403).json({
        success: false,
        code: 'TENANT_SUSPENDED',
        message: 'Trường học đã bị tạm ngưng hoạt động'
      });
    }

    if (schoolUser && isUserLockedOrExpired(schoolUser, now)) {
      return res.status(401).json({
        success: false,
        code: 'ACCOUNT_LOCKED',
        message: 'Tài khoản đã bị vô hiệu hóa, bị khóa hoặc đã hết thời hạn truy cập'
      });
    }

    return res.status(401).json({
      success: false,
      message: 'Thông tin đăng nhập không chính xác'
    });
  } catch (err) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({
        success: false,
        ...(err.code ? { code: err.code } : {}),
        message: err.message
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Lỗi đăng nhập hệ thống'
    });
  }
};

const getMe = async (req, res) => {
  try {
    const user = req.user.toObject ? req.user.toObject() : req.user;
    delete user.passwordHash;

    const resolvedModules = req.tenant
      ? (req.tenant.config?.moduleGateConfigured
          ? sanitizeEnabledModules(req.tenant.enabledModules)
          : [...ALL_ENABLED_MODULES])
      : null;

    return res.status(200).json({
      success: true,
      data: user,
      tenant: req.tenant ? {
        _id: req.tenant._id,
        id: req.tenant._id,
        code: req.tenant.code,
        name: req.tenant.name,
        status: req.tenant.status,
        enabledModules: resolvedModules,
        moduleGateConfigured: Boolean(req.tenant.config?.moduleGateConfigured),
        quotas: req.tenant.quotas || { maxCampuses: 10, maxStudents: 800, maxStaff: 200 }
      } : null
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Lỗi lấy thông tin người dùng'
    });
  }
};

const logout = async (req, res) => {
  try {
    const isGlobal = req.query.all === 'true' || req.body?.all === true;

    if (isGlobal && req.user) {
      await User.updateOne({ _id: req.user._id }, { $inc: { authVersion: 1 } });
      req.user.authVersion = (req.user.authVersion || 0) + 1;
    } else if (req.tokenJti && req.user) {
      const expiresAt = req.tokenExp ? new Date(req.tokenExp * 1000) : new Date(Date.now() + 8 * 3600 * 1000);
      await RevokedSession.updateOne(
        { jti: req.tokenJti },
        {
          $setOnInsert: {
            jti: req.tokenJti,
            userId: req.user._id,
            tenantId: req.user.tenantId,
            expiresAt
          }
        },
        { upsert: true }
      );
    }

    return res.status(200).json({
      success: true,
      globalLogout: isGlobal,
      message: isGlobal
        ? 'Đã đăng xuất toàn bộ phiên thiết bị thành công'
        : 'Đăng xuất thành công. Phiên làm việc này đã bị thu hồi.'
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Lỗi đăng xuất'
    });
  }
};

module.exports = {
  login,
  getMe,
  logout
};
