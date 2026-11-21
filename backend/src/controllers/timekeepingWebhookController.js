'use strict';

/**
 * @fileoverview Controller xử lý Webhook nhận sự kiện chấm công từ máy Hikvision (`/api/attendance/webhook`).
 *
 * // NOTE: Tuân thủ quy tắc phần cứng từ `JussStudio/BE` — `handleWebhook` LUÔN trả về HTTP 200 kể cả khi
 * xảy ra lỗi nội bộ trong khối `catch`, nhằm tránh việc máy Hikvision đẩy lại sự kiện liên tục gây tràn bộ nhớ thiết bị.
 */

const {
  captureIncomingWebhook,
  listWebhookLogs,
  getWebhookLogDetail
} = require('../services/timekeepingWebhookService');

/**
 * Kiểm tra nhanh trạng thái hoạt động của endpoint Webhook trên trình duyệt hoặc máy chấm công (`GET /api/attendance/webhook`).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const pingWebhook = (req, res) => {
  return res.status(200).json({
    success: true,
    status: 'OK',
    message: 'Endpoint /api/attendance/webhook đang hoạt động sẵn sàng nhận dữ liệu Hikvision',
    serverTime: new Date().toISOString(),
    schoolCode: req.params?.schoolCode ? String(req.params.schoolCode).toUpperCase() : null
  });
};

/**
 * Nhận sự kiện đẩy về từ máy chấm công Hikvision (`POST /api/attendance/webhook` & `/api/attendance/webhook/:schoolCode`).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const handleWebhook = async (req, res) => {
  try {
    const result = await captureIncomingWebhook(req);
    return res.status(200).json({
      success: true,
      message: 'Success',
      skippedNoise: result.skippedNoise,
      logId: result.savedId,
      persisted: result.persisted,
      payloadFormat: result.record.payloadFormat,
      hikvisionSummary: result.record.hikvisionSummary,
      attendanceResult: result.attendanceResult || null,
      filesCount: result.record.filesMeta?.length || 0
    });
  } catch (error) {
    console.error('[Controller Error - Webhook Chấm Công]:', error.message);
    // Vẫn trả HTTP 200 giống JussStudio/BE để tránh máy Hikvision retry dồn ứ hàng đợi trên phần cứng
    return res.status(200).json({
      success: false,
      message: 'Success',
      error: 'Đã tiếp nhận tín hiệu nhưng gặp lỗi khi ghi nhật ký nội bộ'
    });
  }
};

/**
 * Xem danh sách các gói tin Webhook chấm công đã lưu trong MongoDB (`GET /api/attendance/webhook/logs`).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getWebhookLogs = async (req, res) => {
  try {
    const result = await listWebhookLogs({
      tenantId: req.user?.tenantId || req.tenantId || null,
      schoolCode: req.query.schoolCode || null,
      page: req.query.page,
      limit: req.query.limit
    });

    return res.status(200).json({
      success: true,
      message: 'Lấy danh sách gói tin Webhook chấm công thành công',
      data: result.items,
      pagination: result.pagination
    });
  } catch (error) {
    console.error('[TimekeepingWebhookController] Lỗi truy vấn danh sách Webhook logs:', error.message);
    return res.status(500).json({
      success: false,
      code: 'WEBHOOK_LOGS_QUERY_FAILED',
      message: 'Không thể tải danh sách gói tin Webhook lúc này'
    });
  }
};

/**
 * Xem chi tiết toàn bộ 1 gói tin Webhook theo ID (`GET /api/attendance/webhook/logs/:id`).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getWebhookLogById = async (req, res) => {
  try {
    const detail = await getWebhookLogDetail(
      req.params.id,
      req.user?.tenantId || req.tenantId || null
    );

    if (!detail) {
      return res.status(404).json({
        success: false,
        code: 'WEBHOOK_LOG_NOT_FOUND',
        message: 'Không tìm thấy bản ghi gói tin Webhook yêu cầu'
      });
    }

    return res.status(200).json({
      success: true,
      data: detail
    });
  } catch (error) {
    console.error('[TimekeepingWebhookController] Lỗi truy vấn chi tiết Webhook log:', error.message);
    return res.status(500).json({
      success: false,
      code: 'WEBHOOK_LOG_DETAIL_FAILED',
      message: 'Không thể tải chi tiết gói tin Webhook lúc này'
    });
  }
};

module.exports = {
  pingWebhook,
  handleWebhook,
  receiveHikvisionWebhook: handleWebhook,
  getWebhookLogs,
  getWebhookLogById
};
