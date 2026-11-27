'use strict';

/**
 * @fileoverview Tiện ích chuẩn hóa phản hồi lỗi HTTP tại tầng Controller (`controllerError.js`)
 * và thoát ký tự đặc biệt cho biểu thức chính quy (`escapeRegex`).
 *
 * Mục đích:
 * - Ngăn chặn triệt để lỗi `500` hoặc lộ thông báo tiếng Anh nội bộ từ Mongoose (`CastError`, `ValidationError`, `E11000`),
 *   JWT (`jwt malformed`, `jwt expired`) hay cú pháp Regex (`SyntaxError: Invalid regular expression`).
 * - Đảm bảo mọi phản hồi lỗi đều có mã HTTP chuẩn xác (`400`, `403`, `404`, `409`, `422`, `500`) và tiếng Việt rõ ràng.
 */

/**
 * Thoát toàn bộ ký tự điều khiển Regex từ chuỗi tìm kiếm của người dùng để chống lỗi `500 Invalid regular expression` và ReDoS.
 *
 * @param {string} raw
 * @returns {string}
 */
const escapeRegex = (raw) => String(raw || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Gửi phản hồi JSON lỗi chuẩn hóa cho các khối `catch (err)` tại Controller.
 *
 * @param {import('express').Response} res
 * @param {any} err
 * @param {string} [fallbackMessage='Hệ thống đang bận hoặc gặp sự cố tạm thời. Vui lòng thử lại sau.']
 * @returns {import('express').Response}
 */
const sendControllerError = (
  res,
  err,
  fallbackMessage = 'Hệ thống đang bận hoặc gặp sự cố tạm thời. Vui lòng thử lại sau.'
) => {
  if (!err) {
    return res.status(500).json({ success: false, message: fallbackMessage });
  }

  if (err.name === 'InvalidTenantContextError') {
    return res.status(403).json({
      success: false,
      message: 'Ngữ cảnh trường học không hợp lệ hoặc không khớp quyền truy cập.'
    });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Mã định danh hoặc định dạng dữ liệu đầu vào không hợp lệ.'
    });
  }

  if (err.name === 'ValidationError') {
    const firstMsg = Object.values(err.errors || {})[0]?.message;
    const isVietnamese = firstMsg && /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(firstMsg);
    return res.status(422).json({
      success: false,
      message: isVietnamese ? firstMsg : 'Dữ liệu nhập vào chưa hợp lệ hoặc thiếu trường bắt buộc.'
    });
  }

  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      message: 'Dữ liệu bị trùng lặp trên hệ thống. Vui lòng kiểm tra lại.'
    });
  }

  const statusCode = Number(err.statusCode || err.status) || 500;
  if (statusCode >= 400 && statusCode < 500) {
    return res.status(statusCode).json({
      success: false,
      message: err.message || 'Yêu cầu không hợp lệ, vui lòng kiểm tra lại thông tin.'
    });
  }

  return res.status(500).json({
    success: false,
    message: fallbackMessage
  });
};

module.exports = {
  escapeRegex,
  sendControllerError
};

