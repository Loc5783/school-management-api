const crypto = require('crypto');
const cron = require('node-cron');
const AttendanceAuditLog = require('../models/zone2_hr/AttendanceAuditLog');
const AttendanceCalculationRun = require('../models/zone2_hr/AttendanceCalculationRun');
const AttendanceJobLock = require('../models/zone2_hr/AttendanceJobLock');
const Tenant = require('../models/zone1_system/Tenant');
const { enqueueUsersForWorkDate, processQueuedRecalculations } = require('./attendanceCalculationService');
const { createTrustedTenantContext } = require('./tenantFilterService');
const { DEFAULT_SCHOOL_TIMEZONE, addWorkDays, getWorkDate, startOfWorkDate } = require('../utils/dateHelpers');

const workerId = `${process.env.HOSTNAME || 'timekeeping'}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
let schedulerStarted = false;

const acquireJobLock = async (key, leaseMs = 55 * 60 * 1000) => {
  const now = new Date();
  try {
    const lock = await AttendanceJobLock.findOneAndUpdate(
      { key, $or: [{ lockedUntil: { $lt: now } }, { ownerId: workerId }] },
      { $set: { ownerId: workerId, lockedUntil: new Date(now.getTime() + leaseMs) } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return lock?.ownerId === workerId;
  } catch (error) {
    if (error?.code === 11000) return false;
    throw error;
  }
};

const releaseJobLock = (key) => AttendanceJobLock.deleteOne({ key, ownerId: workerId });

const runDailyTimekeepingSync = async () => {
  const targetWorkDate = addWorkDays(getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE), -1);
  const key = `attendance:daily:${targetWorkDate}`;
  if (!await acquireJobLock(key)) return { skipped: true, reason: 'LOCK_NOT_ACQUIRED' };

  const run = await AttendanceCalculationRun.create({
    jobType: 'DAILY',
    workDate: startOfWorkDate(targetWorkDate, DEFAULT_SCHOOL_TIMEZONE),
    workerId,
    status: 'RUNNING'
  });
  try {
    await AttendanceAuditLog.create({
      action: 'MIDNIGHT_SYNC_STARTED',
      entity: 'AttendanceCalculationRun',
      entityId: run._id,
      newValue: { workDate: targetWorkDate },
      reason: 'Scheduled daily attendance calculation',
      timestamp: new Date()
    });

    // 1. Enqueue for each active SaaS tenant with explicit trusted context
    const activeTenants = await Tenant.find({ status: 'active' }).select('_id');
    for (const tenant of activeTenants) {
      await enqueueUsersForWorkDate(
        targetWorkDate,
        'DAILY_SCHEDULED_CALCULATION',
        createTrustedTenantContext({ tenantId: tenant._id })
      );
    }

    // 2. Enqueue for legacy with explicit legacy context
    await enqueueUsersForWorkDate(
      targetWorkDate,
      'DAILY_SCHEDULED_CALCULATION',
      createTrustedTenantContext({ isLegacy: true })
    );

    // 3. Process queued recalculations as global background worker
    const records = await processQueuedRecalculations({
      workerId,
      maxItems: 500,
      isGlobalWorker: true
    });

    run.status = 'COMPLETED';
    run.recordsProcessed = records.length;
    run.finishedAt = new Date();
    await run.save();
    await AttendanceAuditLog.create({
      action: 'MIDNIGHT_SYNC_COMPLETED',
      entity: 'AttendanceCalculationRun',
      entityId: run._id,
      newValue: { workDate: targetWorkDate, recordsCount: records.length },
      reason: 'Scheduled calculation completed',
      timestamp: new Date()
    });
    return { skipped: false, records };
  } catch (error) {
    run.status = 'FAILED';
    run.error = error.message;
    run.finishedAt = new Date();
    await run.save();
    throw error;
  } finally {
    await releaseJobLock(key);
  }
};

const runQueuedRecalculations = async () => processQueuedRecalculations({
  workerId,
  maxItems: 100,
  isGlobalWorker: true
});

function startTimekeepingSync() {
  if (schedulerStarted) {
    console.warn('Attendance scheduler was already started; skipping duplicate initialization.');
    return;
  }
  schedulerStarted = true;

  cron.schedule('0 0 * * *', () => {
    runDailyTimekeepingSync().catch((error) => console.error('Midnight attendance sync failed:', error));
  }, { timezone: DEFAULT_SCHOOL_TIMEZONE });

  // Applies late approvals and late device logs without waiting for midnight.
  cron.schedule('*/5 * * * *', () => {
    runQueuedRecalculations().catch((error) => console.error('Attendance queue worker failed:', error));
  }, { timezone: DEFAULT_SCHOOL_TIMEZONE });

  console.log(`Attendance scheduler started for ${DEFAULT_SCHOOL_TIMEZONE}`);
}

module.exports = { runDailyTimekeepingSync, runQueuedRecalculations, startTimekeepingSync };
