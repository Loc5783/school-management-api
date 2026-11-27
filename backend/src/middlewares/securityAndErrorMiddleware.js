'use strict';

/**
 * @fileoverview Middleware bảo mật HTTP Headers, Chống Bot Quét & Xử lý lỗi tập trung toàn hệ thống.
 *
 * Mục đích:
 * 1. Ẩn dấu vết công nghệ máy chủ (`X-Powered-By`) để chống dò quét lỗ hổng theo phiên bản.
 * 2. Kích hoạt lá chắn `botScannerShieldMiddleware` chặn sớm các công cụ quét lỗ hổng tự động (`sqlmap`, `nuclei`, `/.env`, `*.php`).
 * 3. Bổ sung bộ HTTP Security Headers chuẩn (CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy).
 * 4. Chuẩn hóa mọi ngoại lệ phát sinh về định dạng JSON tiếng Việt thân thiện, tuyệt đối không lộ stack trace.
 */

const { botScannerShieldMiddleware, requestPayloadSanitizer } = require('./botScannerShield');

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https: http:",
  "connect-src 'self' https: http: ws: wss:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "object-src 'none'"
].join('; ');

/**
 * Gắn cấu hình ẩn dấu vết framework, lá chắn chống Bot quét và HTTP Security Headers cho Express.
 * @param {import('express').Application} app
 */
const applySecurityMiddleware = (app) => {
  app.disable('x-powered-by');

  // Chặn sớm các hành vi dò quét lỗ hổng tự động trước mọi middleware nặng khác
  app.use(botScannerShieldMiddleware);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Cho phép camera trên chính domain trường học để tính năng quét mã QR đón trả trẻ hoạt động
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);

    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    if (req.secure || forwardedProto === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    next();
  });
};

const MULTER_ERROR_MESSAGES = {
  LIMIT_FILE_SIZE: 'Tệp tải lên vượt quá dung lượng tối đa cho phép.',
  LIMIT_FILE_COUNT: 'Chỉ được phép tải lên tối đa 1 tệp mỗi lần thao tác.',
  LIMIT_UNEXPECTED_FILE: 'Trường dữ liệu tệp đính kèm không đúng định dạng quy định.',
  LIMIT_PART_COUNT: 'Biểu mẫu tải lên chứa quá nhiều trường dữ liệu.'
};

/**
 * Middleware xử lý lỗi cuối chuỗi Express (4 tham số).
 * Chặn mọi trang lỗi HTML mặc định và che giấu chi tiết hạ tầng nội bộ.
 */
// eslint-disable-next-line no-unused-vars
const globalErrorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  // 1. Lỗi chặn nguồn CORS
  if (err?.message === 'Origin không được phép truy cập API') {
    return res.status(403).json({
      success: false,
      message: 'Nguồn truy cập không được phép kết nối tới máy chủ.'
    });
  }

  // 2. Lỗi gửi gói tin JSON sai cú pháp hoặc URL sai bảng mã URI
  if (
    (err instanceof SyntaxError && err.status === 400 && 'body' in err) ||
    err?.type === 'entity.parse.failed' ||
    err instanceof URIError
  ) {
    return res.status(400).json({
      success: false,
      message: 'Dữ liệu hoặc đường dẫn gửi lên không đúng định dạng hợp lệ. Vui lòng thử lại.'
    });
  }

  // 3. Lỗi vượt quá giới hạn dung lượng payload / tệp đính kèm
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return res.status(413).json({
      success: false,
      message: 'Dữ liệu hoặc tệp tải lên vượt quá dung lượng cho phép.'
    });
  }

  if (err?.name === 'MulterError') {
    const message =
      MULTER_ERROR_MESSAGES[err.code] ||
      'Tệp tải lên không hợp lệ, vui lòng kiểm tra lại định dạng và dung lượng tệp.';
    return res.status(400).json({ success: false, message });
  }

  // 4. Lỗi kiểm tra dữ liệu hoặc mã định danh từ tầng cơ sở dữ liệu
  if (err?.name === 'ValidationError') {
    const details = Object.values(err.errors || {})
      .map((item) => item?.message)
      .filter(Boolean);
    return res.status(422).json({
      success: false,
      message: details[0] || 'Dữ liệu nhập vào chưa hợp lệ hoặc thiếu trường bắt buộc. Vui lòng kiểm tra lại.'
    });
  }

  if (err?.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Mã định danh dữ liệu không hợp lệ.'
    });
  }

  if (err?.code === 11000) {
    return res.status(409).json({
      success: false,
      message: 'Dữ liệu bị trùng lặp trên hệ thống. Vui lòng kiểm tra lại.'
    });
  }

  // 5. Lỗi nghiệp vụ chủ động có gắn mã HTTP 4xx
  const statusCode = Number(err?.statusCode || err?.status) || 500;
  if (statusCode >= 400 && statusCode < 500) {
    return res.status(statusCode).json({
      success: false,
      message: err.message || 'Yêu cầu không hợp lệ, vui lòng kiểm tra lại thông tin.'
    });
  }

  // 6. Lỗi hệ thống không mong muốn: ghi log nội bộ và trả thông báo chung an toàn
  console.error('[GlobalErrorHandler]', err?.message || err);
  return res.status(500).json({
    success: false,
    message: 'Hệ thống đang bận hoặc gặp sự cố tạm thời. Vui lòng thử lại sau.'
  });
};

module.exports = {
  applySecurityMiddleware,
  requestPayloadSanitizer,
  globalErrorHandler
};
