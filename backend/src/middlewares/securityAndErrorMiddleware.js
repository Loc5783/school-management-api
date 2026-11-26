'use strict';

/**
 * Middleware bảo mật HTTP Headers & Xử lý lỗi tập trung toàn hệ thống.
 *
 * Mục đích:
 * 1. Ẩn thông tin công nghệ máy chủ (`X-Powered-By`) để chống dò quét lỗ hổng theo phiên bản.
 * 2. Bổ sung bộ HTTP Security Headers chuẩn (CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy).
 * 3. Chuẩn hóa mọi lỗi phát sinh (JSON sai cú pháp, lỗi Mongoose, vượt dung lượng, lỗi không mong muốn)
 *    về định dạng JSON tiếng Việt thân thiện, tuyệt đối không trả trang HTML lỗi thô hoặc lộ stack trace.
 */

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
 * Gắn cấu hình ẩn dấu vết framework và thiết lập HTTP Security Headers cho ứng dụng Express.
 * @param {import('express').Application} app
 */
const applySecurityMiddleware = (app) => {
  app.disable('x-powered-by');

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

  // 2. Lỗi gửi gói tin JSON sai cú pháp từ phía client
  if ((err instanceof SyntaxError && err.status === 400 && 'body' in err) || err?.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      message: 'Dữ liệu gửi lên không đúng định dạng hợp lệ. Vui lòng thử lại.'
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
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Tệp tải lên vượt quá dung lượng cho phép.'
      : 'Tệp tải lên không hợp lệ, vui lòng kiểm tra lại định dạng tệp.';
    return res.status(400).json({ success: false, message });
  }

  // 4. Lỗi kiểm tra dữ liệu hoặc mã định danh từ tầng cơ sở dữ liệu
  if (err?.name === 'ValidationError') {
    return res.status(422).json({
      success: false,
      message: 'Dữ liệu nhập vào chưa hợp lệ hoặc thiếu trường bắt buộc. Vui lòng kiểm tra lại.'
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
  globalErrorHandler
};

