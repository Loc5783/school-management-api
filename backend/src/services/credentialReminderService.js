'use strict';

/**
 * @fileoverview Dịch vụ nhắc hạn bằng cấp/chứng chỉ nhân sự theo đúng từng cơ sở trường học (`tenantId`).
 */

const cron = require('node-cron');
const Tenant = require('../models/zone1_system/Tenant');
const User = require('../models/zone1_system/User');
const Notification = require('../models/zone1_system/Notification');
const { getCompliance } = require('./credentialService');
const { DEFAULT_SCHOOL_TIMEZONE } = require('../utils/dateHelpers');

let job;
let running = false;

const sendScopedCredentialReminderForTenant = async (tenantId) => {
  const { summary, rows, today } = await getCompliance({}, { tenantId });
  if (!summary.expired && !summary.expiring) return;

  const tenantFilter = tenantId ? { tenantId } : { tenantId: { $in: [null, undefined] } };
  const managers = await User.find({
    ...tenantFilter,
    role: { $in: ['admin', 'principal', 'hr'] },
    status: 'active'
  })
    .select('_id')
    .lean();

  const names = rows
    .filter((row) => row.documents.some((d) => ['expired', 'expiring'].includes(d.state)))
    .slice(0, 3)
    .map((row) => row.fullName)
    .join(', ');

  for (const manager of managers) {
    const deduplicationKey = `hr-credentials:${tenantId || 'legacy'}:${today}:${manager._id}`;
    try {
      await Notification.updateOne(
        { deduplicationKey },
        {
          $setOnInsert: {
            ...(tenantId ? { tenantId } : {}),
            recipientId: manager._id,
            title: 'Giấy tờ nhân sự cần gia hạn',
            message: `${summary.expiring} giấy tờ sắp hết hạn, ${summary.expired} giấy tờ đã hết hạn. Nhân viên cần lưu ý: ${names}.`,
            type: 'warning',
            link: '/hr',
            metadata: { source: 'hr-credentials', date: today },
            deduplicationKey
          }
        },
        { upsert: true }
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }

  const affected = rows.filter(
    (row) => row.userId && row.documents.some((document) => ['expired', 'expiring'].includes(document.state))
  );
  if (!affected.length) return;

  const activeAccounts = await User.find({
    ...tenantFilter,
    _id: { $in: affected.map((row) => row.userId) },
    status: 'active'
  })
    .select('_id')
    .lean();
  const activeIds = new Set(activeAccounts.map((account) => String(account._id)));

  for (const employee of affected) {
    if (!activeIds.has(String(employee.userId))) continue;
    const documents = employee.documents.filter((document) => ['expired', 'expiring'].includes(document.state));
    const deduplicationKey = `hr-my-credentials:${tenantId || 'legacy'}:${today}:${employee.userId}`;
    try {
      await Notification.updateOne(
        { deduplicationKey },
        {
          $setOnInsert: {
            ...(tenantId ? { tenantId } : {}),
            recipientId: employee.userId,
            title: 'Giấy tờ nghề nghiệp cần cập nhật',
            message: `${documents.map((document) => `${document.requirement.name}: ${document.state === 'expired' ? 'đã hết hạn' : 'sắp hết hạn'}`).join('; ')}. Liên hệ HR để cập nhật hồ sơ.`.slice(0, 1000),
            type: 'warning',
            link: '/internal-notices',
            metadata: { source: 'hr-my-credentials', date: today },
            deduplicationKey
          }
        },
        { upsert: true }
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }
};

const sendCredentialReminders = async () => {
  if (running) return;
  running = true;
  try {
    const activeTenants = await Tenant.find({ status: 'active' }).select('_id').lean();
    if (activeTenants.length > 0) {
      for (const tenant of activeTenants) {
        await sendScopedCredentialReminderForTenant(tenant._id);
      }
    } else {
      await sendScopedCredentialReminderForTenant(null);
    }
  } finally {
    running = false;
  }
};

const startCredentialReminders = () => {
  if (job) return job;
  job = cron.schedule(
    '0 8 * * *',
    () => {
      void sendCredentialReminders().catch((error) =>
        console.error('Không thể gửi nhắc giấy tờ nhân sự:', error.message)
      );
    },
    { timezone: DEFAULT_SCHOOL_TIMEZONE }
  );
  void sendCredentialReminders().catch((error) =>
    console.error('Không thể kiểm tra giấy tờ nhân sự:', error.message)
  );
  return job;
};

module.exports = { sendCredentialReminders, startCredentialReminders };
