'use strict';

/**
 * @fileoverview Middleware kiểm tra mã khóa tùy chọn cho endpoint Webhook máy chấm công.
 *
 * Quy tắc vận hành:
 * - Nếu biến môi trường `TIMEKEEPING_WEBHOOK_TOKEN` chưa được cấu hình (để trống):
 *   Cho phép request đi qua ở chế độ mở nội bộ (Bước 1) để kỹ thuật viên bắn thử gói tin từ máy Hikvision dễ dàng.
 * - Nếu `TIMEKEEPING_WEBHOOK_TOKEN` có giá trị:
 *   Bắt buộc đối chiếu hằng số thời gian (`timingSafeEqual` qua băm SHA-256) với khóa gửi qua
 *   URL param (`:token`), query (`?token=...`) hoặc HTTP Header (`X-Webhook-Token` / `X-Device-Api-Key`).
 */

const crypto = require('crypto');

/**
 * So sánh 2 chuỗi bí mật theo thời gian hằng số để chống tấn công dò ký tự (timing attack).
 * Băm SHA-256 trước khi so sánh giúp an toàn ngay cả khi 2 chuỗi có độ dài khác nhau.
 *
 * @param {string} provided - Chuỗi token do thiết bị/client gửi lên
 * @param {string} expected - Chuỗi token cấu hình trên server
 * @returns {boolean}
 */
const isTokenEqualSafe = (provided, expected) => {
  const providedHash = crypto.createHash('sha256').update(String(provided)).digest();
  const expectedHash = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(providedHash, expectedHash);
};

/**
 * Middleware xác thực linh hoạt cho Webhook chấm công giai đoạn thử nghiệm & vận hành.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const webhookTestAuth = (req, res, next) => {
  const configuredToken = String(process.env.TIMEKEEPING_WEBHOOK_TOKEN || '').trim();

  // Early return: Chưa đặt khóa trong .env -> mở chế độ bắt gói tin nội bộ ở Bước 1
  if (!configuredToken) {
    return next();
  }

  const providedToken = (
    req.params?.token ||
    req.query?.token ||
    req.header('X-Webhook-Token') ||
    req.header('X-Device-Api-Key') ||
    ''
  ).toString().trim();

  if (!providedToken || !isTokenEqualSafe(providedToken, configuredToken)) {
    return res.status(401).json({
      success: false,
      code: 'WEBHOOK_UNAUTHORIZED',
      message: 'Mã xác thực Webhook không hợp lệ hoặc bị thiếu'
    });
  }

  return next();
};

module.exports = webhookTestAuth;

