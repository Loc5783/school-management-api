'use strict';

const express = require('express');
const router = express.Router();
const schoolAuthMiddleware = require('../middlewares/schoolAuthMiddleware');
const roleCheck = require('../../middlewares/roleCheck');
const {
  getMyNotifications,
  markRead,
  markAllRead,
  createNotification
} = require('../../controllers/notificationController');
const { getRequestSaasMode, isNotificationAllowed } = require('../utils/saasMode');

// Defense-in-depth: Notifications module gating
router.use((req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isNotificationAllowed(saasMode)) {
    return next('router');
  }
  next();
});

// All notification endpoints require valid SaaS school auth
router.use(schoolAuthMiddleware);

// GET /api/v1/notifications or /api/notifications (with optional ?unread=true, ?page=1, ?limit=15)
router.get('/', getMyNotifications);

// PATCH /api/v1/notifications/read-all
router.patch('/read-all', markAllRead);

// PATCH /api/v1/notifications/:id/read
router.patch('/:id/read', markRead);

// POST /api/v1/notifications (Admin and Principal only)
router.post('/', roleCheck(['admin', 'principal']), createNotification);

module.exports = router;
