'use strict';

/**
 * @fileoverview Dịch vụ nhắc nhở định kỳ các sự cố an ninh nghiêm trọng/khẩn cấp chưa được Ban Giám Hiệu xác nhận.
 * Tuân thủ nghiêm ngặt cách ly đa trường (`tenantId`): chỉ thông báo tới Admin/Hiệu trưởng của đúng trường xảy ra sự cố.
 */

const SecurityIncident = require('../models/zone3_school/SecurityIncident');
const User = require('../models/zone1_system/User');
const Notification = require('../models/zone1_system/Notification');

const REMINDER_INTERVAL_MS = 15 * 60 * 1000;
let timer = null;
let running = false;

const remindUnacknowledgedIncidents = async () => {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const managersCache = new Map();

    for (let i = 0; i < 100; i += 1) {
      const incident = await SecurityIncident.findOneAndUpdate(
        {
          severity: { $in: ['serious', 'emergency'] },
          status: { $ne: 'closed' },
          acknowledgedAt: null,
          nextReminderAt: { $lte: now }
        },
        {
          $set: { nextReminderAt: new Date(now.getTime() + REMINDER_INTERVAL_MS) },
          $inc: { reminderCount: 1 }
        },
        { sort: { nextReminderAt: 1 }, returnDocument: 'after' }
      );
      if (!incident) break;

      try {
        const stillPending = await SecurityIncident.exists({
          _id: incident._id,
          acknowledgedAt: null,
          status: { $ne: 'closed' }
        });
        if (!stillPending) continue;

        const tenantKey = incident.tenantId ? String(incident.tenantId) : '__legacy__';
        if (!managersCache.has(tenantKey)) {
          const tenantFilter = incident.tenantId
            ? { tenantId: incident.tenantId }
            : { tenantId: { $in: [null, undefined] } };
          const scopedManagers = await User.find({
            ...tenantFilter,
            role: { $in: ['admin', 'principal'] },
            status: 'active'
          })
            .select('_id')
            .lean();
          managersCache.set(tenantKey, scopedManagers);
        }

        const managers = managersCache.get(tenantKey) || [];
        if (!managers.length) continue;

        await Notification.insertMany(
          managers.map((manager) => ({
            ...(incident.tenantId ? { tenantId: incident.tenantId } : {}),
            recipientId: manager._id,
            title: `Nhắc tiếp nhận sự cố ${incident.severity === 'emergency' ? 'khẩn cấp' : 'nghiêm trọng'}`,
            message: `${incident.location || 'Cổng trường'}: ${String(incident.description || '').slice(0, 180)}`,
            type: 'warning',
            link: '/guard',
            createdBy: incident.reportedBy,
            metadata: {
              incidentId: incident._id,
              severity: incident.severity,
              priority: 'high',
              reminder: true
            }
          }))
        );
      } catch (error) {
        console.error('Không thể gửi nhắc sự cố an ninh:', error);
      }
    }
  } finally {
    running = false;
  }
};

const startGuardAlertReminders = () => {
  if (timer) return timer;
  timer = setInterval(() => {
    void remindUnacknowledgedIncidents().catch((error) =>
      console.error('Nhắc sự cố an ninh thất bại:', error)
    );
  }, 60 * 1000);
  timer.unref?.();
  return timer;
};

module.exports = { remindUnacknowledgedIncidents, startGuardAlertReminders };
