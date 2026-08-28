/*
 * Backfills correction-request documents created by the pre-state-machine
 * implementation. It is intentionally dry-run by default:
 *   node src/scripts/migrateTimekeepingV2.js
 * Apply only after reviewing the report:
 *   node src/scripts/migrateTimekeepingV2.js --apply
 */
const mongoose = require('mongoose');
require('dotenv').config();

const AttendanceAuditLog = require('../models/zone2_hr/AttendanceAuditLog');
const TimekeepingCorrectionRequest = require('../models/zone2_hr/TimekeepingCorrectionRequest');
const {
  DEFAULT_SCHOOL_TIMEZONE,
  createDateTime,
  getWorkDate,
  startOfWorkDate
} = require('../utils/dateHelpers');

const apply = process.argv.includes('--apply');
const statusMap = {
  draft: 'DRAFT',
  pending: 'PENDING',
  approved: 'APPROVED',
  rejected: 'REJECTED',
  synced: 'APPROVED'
};

const activeStates = new Set(['DRAFT', 'PENDING', 'APPROVED']);

const normalize = (document) => {
  const timezone = document.timezone || DEFAULT_SCHOOL_TIMEZONE;
  const adjustmentType = document.adjustmentType
    || (document.requestType === 'MISSING_CHECK_OUT' ? 'MISSING_CHECK_OUT' : 'MISSING_CHECK_IN');
  const requestedTime = document.requestedTime
    || (adjustmentType === 'MISSING_CHECK_OUT'
      ? document.requestedCheckOutTime
      : document.requestedCheckInTime);
  if (!requestedTime || !document.workDate) return null;

  const workDateLabel = getWorkDate(document.workDate, timezone);
  const status = statusMap[document.status] || document.status || 'DRAFT';
  return {
    workDateLabel,
    adjustmentType,
    requestedTime,
    status,
    update: {
      workDate: startOfWorkDate(workDateLabel, timezone),
      timezone,
      adjustmentType,
      requestType: adjustmentType,
      requestedTime,
      requestedDayOffset: document.requestedDayOffset || 0,
      requestedAt: document.requestedAt || createDateTime(workDateLabel, requestedTime, timezone),
      status,
      isActive: activeStates.has(status),
      version: document.version || 1,
      submittedAt: document.submittedAt || (status !== 'DRAFT' ? document.createdAt : null),
      reviewedBy: document.reviewedBy || document.approvedBy || null,
      reviewedAt: document.reviewedAt || document.approvedAt || null,
      reviewNote: document.reviewNote || document.rejectionReason || null
    }
  };
};

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const documents = await TimekeepingCorrectionRequest.find({}).sort({ createdAt: 1 });
  const seenActiveKeys = new Set();
  const updates = [];
  const invalid = [];
  const collisions = [];

  for (const document of documents) {
    const normalized = normalize(document);
    if (!normalized) {
      invalid.push(document._id.toString());
      continue;
    }
    const key = `${document.userId}:${normalized.workDateLabel}:${normalized.adjustmentType}`;
    if (normalized.update.isActive && seenActiveKeys.has(key)) {
      collisions.push({ id: document._id.toString(), key });
      continue;
    }
    if (normalized.update.isActive) seenActiveKeys.add(key);

    const changed = !document.requestedAt
      || !document.adjustmentType
      || document.status !== normalized.status
      || document.isActive !== normalized.update.isActive;
    if (!changed) continue;
    updates.push({ document, normalized });
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    total: documents.length,
    updates: updates.length,
    invalid,
    collisions
  }, null, 2));

  if (!apply || invalid.length || collisions.length) {
    await mongoose.disconnect();
    process.exit(collisions.length || invalid.length ? 1 : 0);
  }

  for (const { document, normalized } of updates) {
    await TimekeepingCorrectionRequest.updateOne({ _id: document._id }, { $set: normalized.update });
    await AttendanceAuditLog.create({
      action: 'TIMEKEEPING_MIGRATED',
      entity: 'TimekeepingCorrectionRequest',
      entityId: document._id,
      oldValue: document.toObject(),
      newValue: normalized.update,
      reason: 'Backfilled for timekeeping state machine v2',
      timestamp: new Date()
    });
  }
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
