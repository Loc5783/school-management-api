'use strict';

/**
 * @fileoverview Router dự phòng cho nhánh `/api/webhooks/timekeeping` (giữ tương thích song song với
 * đường dẫn chính `/api/attendance/webhook` được thiết kế giống dự án `JussStudio/BE`).
 */

const express = require('express');
const webhookTestAuth = require('../middlewares/webhookTestAuth');
const {
  pingWebhook,
  handleWebhook,
  getWebhookLogs,
  getWebhookLogById
} = require('../controllers/timekeepingWebhookController');

const router = express.Router();
const rawWebhookBody = express.raw({ type: '*/*', limit: '50mb' });

router.get('/ping', webhookTestAuth, pingWebhook);
router.get('/hikvision', webhookTestAuth, pingWebhook);
router.get('/hikvision/:schoolCode', webhookTestAuth, pingWebhook);
router.get('/logs', webhookTestAuth, getWebhookLogs);
router.get('/logs/:id', webhookTestAuth, getWebhookLogById);

router.post('/hikvision', webhookTestAuth, rawWebhookBody, handleWebhook);
router.post('/hikvision/:schoolCode', webhookTestAuth, rawWebhookBody, handleWebhook);
router.post('/token/:token/hikvision', webhookTestAuth, rawWebhookBody, handleWebhook);
router.post('/token/:token/hikvision/:schoolCode', webhookTestAuth, rawWebhookBody, handleWebhook);

module.exports = router;
