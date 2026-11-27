'use strict';

/**
 * @fileoverview Bộ điều khiển Xác thực Hợp nhất (Unified SaaS & Multi-School Login).
 *
 * Quy tắc phân luồng đăng nhập thực tế trên 1 màn hình duy nhất:
 * 1. Khi để trống `schoolCode` (Mã trường học trống):
 *    - Ưu tiên xác thực tài khoản **Admin Tổng Đa Trường (`PlatformAdmin`)** -> trả về `isSuperAdmin: true`,
 *      `user.role = 'superadmin'` để Frontend điều hướng thẳng vào Trung tâm Điều hành Đa Trường (`/multi-school`).
 *    - Nếu không phải `PlatformAdmin`, kiểm tra tương thích ngược tài khoản đơn trường Legacy (`tenantId: null`).
 *    - Nếu tài khoản thuộc một trường học cụ thể nhưng người dùng quên nhập Mã trường, trả thông báo hướng dẫn rõ ràng.
 * 2. Khi có nhập `schoolCode` (VD: `HOANANG-A`):
 *    - Xác thực nghiêm ngặt trong phạm vi `tenantId` của trường đó (`User`), cô lập tuyệt đối dữ liệu giữa các trường.
 */

const bcrypt = require('bcryptjs');
const Tenant = require('../../models/zone1_system/Tenant');
const User = require('../../models/zone1_system/User');
const PlatformAdmin = require('../../models/zone1_system/PlatformAdmin');
const RevokedSession = require('../../models/zone1_system/RevokedSession');
const { generateSchoolUserToken, generatePlatformAdminToken } = require('../utils/saasJwt');
const { isHoneypotTriggered } = require('../../middlewares/botScannerShield');

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
    const hasSchoolCode = typeof schoolCode === 'string' && schoolCode.trim().length > 0;

    // =========================================================================
    // LUỒNG 1: ĐỂ TRỐNG MÃ TRƯỜNG -> ĐĂNG NHẬP ADMIN TỔNG ĐA TRƯỜNG (HOẶC LEGACY)
    // =========================================================================
    if (!hasSchoolCode) {
      const candidateUsernames = cleanUsername === cleanUsername.toLowerCase()
        ? [cleanUsername]
        : [cleanUsername, cleanUsername.toLowerCase()];

      // Bước 1A: Kiểm tra tài khoản Quản trị Tổng Đa Trường (PlatformAdmin)
      const platformAdmin = await PlatformAdmin.findOne({
        username: { $in: candidateUsernames }
      });

      if (platformAdmin) {
        if (platformAdmin.status !== 'active') {
          return res.status(401).json({
            success: false,
            code: 'ACCOUNT_LOCKED',
            message: 'Tài khoản Quản trị Tổng đang bị khóa hoặc tạm ngưng hoạt động'
          });
        }

        const isAdminMatch = await bcrypt.compare(password, platformAdmin.passwordHash);
        if (!isAdminMatch) {
          return res.status(401).json({
            success: false,
            message: 'Mật khẩu tài khoản Admin Tổng không chính xác (nếu đăng nhập tài khoản từng trường, vui lòng nhập Mã trường học)'
          });
        }

        const superToken = generatePlatformAdminToken(platformAdmin);
        return res.status(200).json({
          success: true,
          message: 'Đăng nhập Quản trị Tổng Hệ thống thành công',
          isSuperAdmin: true,
          token: superToken,
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
      }

      // Bước 1B: Tương thích ngược tài khoản đơn trường Legacy (tenantId: null) nếu có
      const legacyUser = await User.findOne({
        tenantId: { $in: [null, undefined] },
        username: cleanUsername
      });

      if (legacyUser) {
        if (legacyUser.status !== 'active' || (legacyUser.accessEndsAt && legacyUser.accessEndsAt <= new Date())) {
          return res.status(401).json({
            success: false,
            code: 'ACCOUNT_LOCKED',
            message: 'Tài khoản đã bị vô hiệu hóa, bị khóa hoặc đã hết thời hạn truy cập'
          });
        }

        const isLegacyMatch = await bcrypt.compare(password, legacyUser.passwordHash);
        if (!isLegacyMatch) {
          return res.status(401).json({
            success: false,
            message: 'Thông tin đăng nhập không chính xác'
          });
        }

        legacyUser.lastLogin = new Date();
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

      // Bước 1C: Gợi ý rõ nếu người dùng của trường quên điền Mã trường học
      const existsInSchool = await User.exists({
        tenantId: { $ne: null },
        username: cleanUsername
      });

      if (existsInSchool) {
        return res.status(401).json({
          success: false,
          code: 'SCHOOL_CODE_REQUIRED',
          message: 'Tài khoản này thuộc một trường học cụ thể. Vui lòng nhập Mã trường học (School Code) để đăng nhập.'
        });
      }

      return res.status(401).json({
        success: false,
        message: 'Tài khoản Admin Tổng không tồn tại, hoặc bạn chưa nhập Mã trường học để đăng nhập vào trường.'
      });
    }

    // =========================================================================
    // LUỒNG 2: CÓ NHẬP MÃ TRƯỜNG -> ĐĂNG NHẬP TÀI KHOẢN RIÊNG CỦA TỪNG TRƯỜNG
    // =========================================================================
    const cleanSchoolCode = String(schoolCode).trim().toUpperCase();

    const tenant = await Tenant.findOne({ code: cleanSchoolCode });
    if (!tenant) {
      return res.status(401).json({
        success: false,
        message: 'Mã trường học không tồn tại hoặc thông tin đăng nhập không chính xác'
      });
    }

    if (tenant.status === 'suspended' || tenant.status === 'terminated') {
      return res.status(403).json({
        success: false,
        code: 'TENANT_SUSPENDED',
        message: 'Trường học đã bị tạm ngưng hoạt động'
      });
    }

    const user = await User.findOne({
      tenantId: tenant._id,
      username: cleanUsername
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Thông tin đăng nhập không chính xác'
      });
    }

    if (user.status !== 'active' || (user.accessEndsAt && user.accessEndsAt <= new Date())) {
      return res.status(401).json({
        success: false,
        code: 'ACCOUNT_LOCKED',
        message: 'Tài khoản đã bị vô hiệu hóa, bị khóa hoặc đã hết thời hạn truy cập'
      });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Thông tin đăng nhập không chính xác'
      });
    }

    user.lastLogin = new Date();
    await user.save();

    const token = generateSchoolUserToken(user, tenant);

    return res.status(200).json({
      success: true,
      message: 'Đăng nhập thành công',
      token,
      tenant: {
        _id: tenant._id,
        id: tenant._id,
        code: tenant.code,
        name: tenant.name,
        status: tenant.status
      },
      user: {
        _id: user._id,
        username: user.username,
        role: user.role,
        profile: user.profile,
        tenantId: tenant._id,
        schoolCode: tenant.code
      }
    });
  } catch (err) {
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

    return res.status(200).json({
      success: true,
      data: user,
      tenant: req.tenant ? {
        id: req.tenant._id,
        code: req.tenant.code,
        name: req.tenant.name,
        status: req.tenant.status
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
