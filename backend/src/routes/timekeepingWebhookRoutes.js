'use strict';

/**
 * @fileoverview Router dự phòng cho nhánh `/api/webhooks/timekeeping` (tương thích song song với `/api/attendance/webhook`).
 * Các API xem lịch sử gói tin (`/logs`) bắt buộc xác thực JWT quản trị trường để bảo vệ dữ liệu sinh trắc học đa trường.
 */

const express = require('express');
const webhookTestAuth = require('../middlewares/webhookTestAuth');
const schoolAuthMiddleware = require('../saas/middlewares/schoolAuthMiddleware');
const roleCheck = require('../middlewares/roleCheck');
const { deviceIngestLimiter } = require('../saas/middlewares/rateLimiter');
const {
  pingWebhook,
  handleWebhook,
  getWebhookLogs,
  getWebhookLogById
} = require('../controllers/timekeepingWebhookController');

const router = express.Router();
const rawWebhookBody = express.raw({ type: '*/*', limit: '10mb' });

router.get('/ping', deviceIngestLimiter, webhookTestAuth, pingWebhook);
router.get('/hikvision', deviceIngestLimiter, webhookTestAuth, pingWebhook);
router.get('/hikvision/:schoolCode', deviceIngestLimiter, webhookTestAuth, pingWebhook);
router.get('/logs', schoolAuthMiddleware, roleCheck(['admin', 'principal', 'hr']), getWebhookLogs);
router.get('/logs/:id', schoolAuthMiddleware, roleCheck(['admin', 'principal', 'hr']), getWebhookLogById);

router.post('/hikvision', deviceIngestLimiter, webhookTestAuth, rawWebhookBody, handleWebhook);
router.post('/hikvision/:schoolCode', deviceIngestLimiter, webhookTestAuth, rawWebhookBody, handleWebhook);
router.post('/token/:token/hikvision', deviceIngestLimiter, webhookTestAuth, rawWebhookBody, handleWebhook);
router.post('/token/:token/hikvision/:schoolCode', deviceIngestLimiter, webhookTestAuth, rawWebhookBody, handleWebhook);

module.exports = router;
