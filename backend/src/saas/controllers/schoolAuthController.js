const bcrypt = require('bcryptjs');
const Tenant = require('../../models/zone1_system/Tenant');
const User = require('../../models/zone1_system/User');
const RevokedSession = require('../../models/zone1_system/RevokedSession');
const { generateSchoolUserToken } = require('../utils/saasJwt');

const login = async (req, res) => {
  try {
    const { schoolCode, username, password } = req.body || {};

    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp tên đăng nhập và mật khẩu'
      });
    }

    const cleanUsername = username.trim();

    // 1. Phân luồng đăng nhập phiên Legacy (không có mã trường schoolCode)
    if (!schoolCode || typeof schoolCode !== 'string' || !schoolCode.trim()) {
      const user = await User.findOne({
        tenantId: { $in: [null, undefined] },
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

      const { generateToken } = require('../../utils/jwt');
      const token = generateToken(user);

      return res.status(200).json({
        success: true,
        message: 'Đăng nhập thành công',
        token,
        tenant: null,
        user: {
          _id: user._id,
          username: user.username,
          role: user.role,
          profile: user.profile,
          tenantId: null
        }
      });
    }

    const cleanSchoolCode = String(schoolCode).trim().toUpperCase();

    // Find tenant
    const tenant = await Tenant.findOne({ code: cleanSchoolCode });
    if (!tenant) {
      // Do not leak tenant existence
      return res.status(401).json({
        success: false,
        message: 'Thông tin đăng nhập không chính xác'
      });
    }

    // Check tenant status
    if (tenant.status === 'suspended' || tenant.status === 'terminated') {
      return res.status(403).json({
        success: false,
        code: 'TENANT_SUSPENDED',
        message: 'Trường học đã bị tạm ngưng hoạt động'
      });
    }

    // Find user strictly scoped to tenant
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

    // Check account status & access expiration
    if (user.status !== 'active' || (user.accessEndsAt && user.accessEndsAt <= new Date())) {
      return res.status(401).json({
        success: false,
        code: 'ACCOUNT_LOCKED',
        message: 'Tài khoản đã bị vô hiệu hóa, bị khóa hoặc đã hết thời hạn truy cập'
      });
    }

    // Verify password
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
      // Global logout: atomically increment authVersion to revoke all sessions
      await User.updateOne({ _id: req.user._id }, { $inc: { authVersion: 1 } });
      req.user.authVersion = (req.user.authVersion || 0) + 1;
    } else if (req.tokenJti && req.user) {
      // Single-session logout: revoke only this specific session/token via RevokedSession
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
