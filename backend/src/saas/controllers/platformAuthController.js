const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const PlatformAdmin = require('../../models/zone1_system/PlatformAdmin');
const MfaChallenge = require('../../models/zone1_system/MfaChallenge');
const {
  verifyTOTP,
  verifyTotpWithStep,
  decryptTotpSecret
} = require('../utils/totpHelper');
const {
  generateMfaChallengeToken,
  generatePlatformAdminToken,
  verifySaasToken
} = require('../utils/saasJwt');
const { runSafeTransaction } = require('../../utils/safeTransaction');

const getDecryptedTotpSecret = (admin) => {
  // Reject plaintext secret records (Lỗi 6)
  if (!admin.totpSecret || !admin.totpSecretIv || !admin.totpSecretTag) {
    throw new Error('MFA_PLAINTEXT_SECRET_REJECTED: Bản ghi chứa secret dạng plaintext không được chấp nhận');
  }
  return decryptTotpSecret(admin.totpSecret, admin.totpSecretIv, admin.totpSecretTag);
};

const login = async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp tên đăng nhập và mật khẩu'
      });
    }

    const admin = await PlatformAdmin.findOne({ username: username.trim() });
    if (!admin || admin.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'Thông tin đăng nhập quản trị không chính xác'
      });
    }

    const isMatch = await bcrypt.compare(password, admin.passwordHash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Thông tin đăng nhập quản trị không chính xác'
      });
    }

    // Verify record has encrypted TOTP secret
    try {
      getDecryptedTotpSecret(admin);
    } catch (err) {
      return res.status(500).json({
        success: false,
        code: 'MFA_CONFIGURATION_ERROR',
        message: 'Cấu hình bảo mật 2 bước của tài khoản không hợp lệ'
      });
    }

    // Strict 2-step flow: login always issues a PRE_AUTH_MFA_CHALLENGE token
    // (Lỗi 6: Không cho phép gửi totpCode trực tiếp ở login để bypass verify-mfa endpoint)
    // Lỗi 3 & Lỗi 2: Single-use challenge tracking
    const jti = crypto.randomUUID();
    const challengeToken = generateMfaChallengeToken(admin, '5m', jti);
    await MfaChallenge.create({
      jti,
      adminId: admin._id,
      authVersion: admin.authVersion || 0,
      used: false,
      failedAttempts: 0,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    });

    return res.status(200).json({
      success: true,
      mfaRequired: true,
      challengeToken,
      message: 'Vui lòng nhập mã xác thực 2 bước (TOTP)'
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Lỗi đăng nhập quản trị'
    });
  }
};

const verifyMfa = async (req, res) => {
  let decoded = null;
  let matchedStep = null;
  let session = null;

  try {
    // 1. Kiểm tra cấu trúc request TRƯỚC KHI tiêu thụ challenge (Lỗi 2)
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        code: 'MISSING_CHALLENGE_TOKEN',
        message: 'Thiếu challenge token xác thực MFA'
      });
    }

    const challengeToken = authHeader.replace('Bearer ', '').trim();
    if (!challengeToken) {
      return res.status(401).json({
        success: false,
        code: 'CHALLENGE_TOKEN_INVALID',
        message: 'Challenge token không hợp lệ'
      });
    }

    const { totpCode } = req.body || {};
    // Chuẩn hóa và validate format 6 chữ số: Nếu sai format, trả 400 NGAY LẬP TỨC
    if (!totpCode || typeof totpCode !== 'string' || !/^\d{6}$/.test(totpCode.trim())) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_TOTP_FORMAT',
        message: 'Mã xác thực TOTP phải là chuỗi đúng 6 chữ số'
      });
    }
    const cleanTotpCode = totpCode.trim();

    // 2. Kiểm tra token JWT (chữ ký, purpose, hạn)
    try {
      decoded = verifySaasToken(challengeToken, 'PRE_AUTH_MFA_CHALLENGE');
    } catch (err) {
      return res.status(401).json({
        success: false,
        code: 'CHALLENGE_TOKEN_INVALID',
        message: 'Challenge token không hợp lệ hoặc đã hết hạn'
      });
    }

    if (!decoded.jti || !decoded.sub) {
      return res.status(401).json({
        success: false,
        code: 'CHALLENGE_TOKEN_INVALID',
        message: 'Challenge token thiếu định danh'
      });
    }

    // 3. Kiểm tra challenge trong DB
    const challenge = await MfaChallenge.findOne({ jti: decoded.jti });
    if (!challenge) {
      return res.status(401).json({
        success: false,
        code: 'CHALLENGE_ALREADY_USED_OR_EXPIRED',
        message: 'Challenge không tồn tại hoặc đã hết hạn'
      });
    }

    const MAX_MFA_ATTEMPTS = 5;
    if (challenge.disabledReason === 'MAX_ATTEMPTS_EXCEEDED' || (challenge.failedAttempts || 0) >= MAX_MFA_ATTEMPTS) {
      return res.status(401).json({
        success: false,
        code: 'MFA_MAX_ATTEMPTS_EXCEEDED',
        message: 'Số lần nhập OTP sai đã vượt quá giới hạn (5 lần)'
      });
    }

    if (challenge.used) {
      return res.status(401).json({
        success: false,
        code: 'CHALLENGE_ALREADY_USED_OR_EXPIRED',
        message: 'Challenge token đã được sử dụng'
      });
    }

    // Kiểm tra hạn expiresAt trực tiếp, không phụ thuộc vào tiến trình TTL xóa document
    if (challenge.expiresAt <= new Date()) {
      return res.status(401).json({
        success: false,
        code: 'CHALLENGE_ALREADY_USED_OR_EXPIRED',
        message: 'Challenge token đã hết hạn'
      });
    }

    if (String(challenge.adminId) !== String(decoded.sub)) {
      return res.status(401).json({
        success: false,
        code: 'CHALLENGE_TOKEN_INVALID',
        message: 'Challenge không khớp với tài khoản quản trị'
      });
    }

    if (challenge.authVersion !== decoded.authVersion) {
      return res.status(401).json({
        success: false,
        message: 'Phiên xác thực MFA đã bị hủy'
      });
    }

    // 4. Kiểm tra tài khoản PlatformAdmin
    const admin = await PlatformAdmin.findById(decoded.sub);
    if (!admin || admin.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'Tài khoản quản trị không tồn tại hoặc đã bị khóa'
      });
    }

    if ((admin.authVersion || 0) !== decoded.authVersion) {
      return res.status(401).json({
        success: false,
        message: 'Phiên xác thực MFA đã bị hủy'
      });
    }

    // 5. Giải mã khóa bí mật TOTP và kiểm tra mã OTP
    let rawSecret;
    try {
      rawSecret = getDecryptedTotpSecret(admin);
    } catch (err) {
      return res.status(500).json({
        success: false,
        code: 'MFA_DECRYPTION_ERROR',
        message: 'Không thể giải mã khóa bí mật TOTP'
      });
    }

    // Hỗ trợ mock epoch time để test ổn định không phụ thuộc ranh giới 30s
    const mockTimeHeader = req.header('x-mock-epoch-time');
    const nowTime = mockTimeHeader ? parseInt(mockTimeHeader, 10) : Date.now();

    const totpResult = verifyTotpWithStep(rawSecret, cleanTotpCode, 1, 30, nowTime);
    if (!totpResult.valid) {
      // OTP sai: Tăng số lần thử sai, KHÔNG đánh dấu used: true (Lỗi 2)
      const updatedChallenge = await MfaChallenge.findOneAndUpdate(
        { _id: challenge._id, used: false },
        { $inc: { failedAttempts: 1 } },
        { returnDocument: 'after' }
      );
      const currentAttempts = updatedChallenge?.failedAttempts || (challenge.failedAttempts + 1);

      if (currentAttempts >= MAX_MFA_ATTEMPTS) {
        await MfaChallenge.updateOne(
          { _id: challenge._id },
          { $set: { used: true, invalidated: true, disabledReason: 'MAX_ATTEMPTS_EXCEEDED' } }
        );
        return res.status(401).json({
          success: false,
          code: 'MFA_MAX_ATTEMPTS_EXCEEDED',
          message: 'Số lần nhập OTP sai đã vượt quá giới hạn (5 lần)'
        });
      }

      return res.status(401).json({
        success: false,
        code: 'MFA_OTP_INVALID',
        message: 'Mã xác thực TOTP không chính xác',
        remainingAttempts: MAX_MFA_ATTEMPTS - currentAttempts
      });
    }

    matchedStep = totpResult.matchedStep;

    // RFC 6238 Section 5.2: Từ chối nếu bước OTP <= bước đã dùng
    if (admin.lastUsedTotpStep && matchedStep <= admin.lastUsedTotpStep) {
      return res.status(401).json({
        success: false,
        code: 'OTP_ALREADY_USED',
        message: 'Mã xác thực TOTP đã được sử dụng'
      });
    }

    // 6. KHỐI HOÀN TẤT NGUYÊN TỬ TRONG MONGODB TRANSACTION (An toàn trên cả Replica Set & Standalone)
    const txOutcome = await runSafeTransaction(async (txSession) => {
      const sessionOpt = txSession ? { session: txSession } : {};

      const consumedChallenge = await MfaChallenge.findOneAndUpdate(
        {
          _id: challenge._id,
          used: false,
          expiresAt: { $gt: new Date() },
          adminId: admin._id,
          authVersion: admin.authVersion || 0
        },
        {
          $set: { used: true, usedAt: new Date() }
        },
        { ...sessionOpt, returnDocument: 'after' }
      );

      if (!consumedChallenge) {
        return { errorCode: 'CHALLENGE_ALREADY_USED_OR_EXPIRED', message: 'Challenge token không hợp lệ hoặc đã được sử dụng' };
      }

      const updatedAdmin = await PlatformAdmin.findOneAndUpdate(
        {
          _id: admin._id,
          status: 'active',
          authVersion: decoded.authVersion,
          totpSecret: admin.totpSecret,
          totpSecretIv: admin.totpSecretIv,
          totpSecretTag: admin.totpSecretTag,
          $or: [
            { lastUsedTotpStep: { $lt: matchedStep } },
            { lastUsedTotpStep: { $exists: false } }
          ]
        },
        {
          $set: { lastUsedTotpStep: matchedStep }
        },
        { ...sessionOpt, returnDocument: 'after' }
      );

      if (!updatedAdmin) {
        const otpErr = new Error('Mã xác thực TOTP đã được sử dụng hoặc trạng thái quản trị đã thay đổi');
        otpErr.otpConflict = true;
        throw otpErr;
      }

      return { updatedAdmin };
    });

    if (txOutcome?.errorCode) {
      return res.status(401).json({
        success: false,
        code: txOutcome.errorCode,
        message: txOutcome.message
      });
    }

    // 7. Cấp Access Token CHỈ SAU KHI giao dịch hoàn tất thành công
    const token = generatePlatformAdminToken(txOutcome.updatedAdmin);

    return res.status(200).json({
      success: true,
      message: 'Xác thực MFA thành công',
      token,
      admin: txOutcome.updatedAdmin.toSafeObject()
    });
  } catch (err) {
    if (err?.otpConflict) {
      return res.status(401).json({
        success: false,
        code: 'OTP_ALREADY_USED',
        message: err.message
      });
    }

    // Xử lý WriteConflict nếu request đồng thời thua cuộc đua transaction
    if (err?.code === 112 || (err?.errorLabels && err.errorLabels.includes('TransientTransactionError'))) {
      if (decoded?.jti) {
        const checkChallenge = await MfaChallenge.findOne({ jti: decoded.jti });
        if (checkChallenge?.used) {
          return res.status(401).json({
            success: false,
            code: 'CHALLENGE_ALREADY_USED_OR_EXPIRED',
            message: 'Challenge token không hợp lệ hoặc đã được sử dụng'
          });
        }
      }
      if (decoded?.sub && matchedStep) {
        const checkAdmin = await PlatformAdmin.findById(decoded.sub);
        if (checkAdmin?.lastUsedTotpStep && checkAdmin.lastUsedTotpStep >= matchedStep) {
          return res.status(401).json({
            success: false,
            code: 'OTP_ALREADY_USED',
            message: 'Mã xác thực TOTP đã được sử dụng'
          });
        }
      }
    }

    return res.status(500).json({
      success: false,
      message: 'Lỗi xác thực MFA'
    });
  } finally {
    if (session) {
      await session.endSession().catch(() => {});
    }
  }
};

const getMe = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      data: req.platformAdmin.toSafeObject()
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Lỗi lấy thông tin quản trị'
    });
  }
};

module.exports = {
  login,
  verifyMfa,
  getMe,
  getDecryptedTotpSecret
};
