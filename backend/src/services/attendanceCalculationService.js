const crypto = require('crypto');
const AttendanceAuditLog = require('../models/zone2_hr/AttendanceAuditLog');
const AttendanceRecord = require('../models/zone2_hr/AttendanceRecord');
const AttendanceRecalculationQueue = require('../models/zone2_hr/AttendanceRecalculationQueue');
const RawAttendance = require('../models/zone2_hr/RawAttendance');
const RawAttendanceEvent = require('../models/zone2_hr/RawAttendanceEvent');
const TimekeepingCorrectionRequest = require('../models/zone2_hr/TimekeepingCorrectionRequest');
const { queueRecalculation, withTransaction } = require('./attendanceAdjustmentService');
const {
  DEFAULT_SCHOOL_TIMEZONE,
  getWorkDate,
  getWorkDateRange,
  isValidWorkDate,
  startOfWorkDate
} = require('../utils/dateHelpers');

const buildInputHash = (value) => crypto
  .createHash('sha256')
  .update(JSON.stringify(value))
  .digest('hex');

const toWorkDate = (value, timezone = DEFAULT_SCHOOL_TIMEZONE) => {
  if (typeof value === 'string' && isValidWorkDate(value)) return value;
  return getWorkDate(value, timezone);
};

const getCalculationInputs = async ({ userId, workDate, timezone, session }) => {
  const { start, end } = getWorkDateRange(workDate, timezone);
  const [events, adjustments, legacyRaw, existingRecord] = await Promise.all([
    RawAttendanceEvent.find({
      userId,
      isValid: true,
      workDate: start
    }).sort({ occurredAt: 1 }).session(session || null),
    TimekeepingCorrectionRequest.find({
      userId,
      workDate: { $gte: start, $lt: end },
      status: 'APPROVED'
    }).sort({ requestedAt: 1 }).session(session || null),
    // Read-only fallback for records created by the pre-event implementation.
    RawAttendance.find({
      userId,
      workDate: { $gte: start, $lt: end }
    }).session(session || null),
    AttendanceRecord.findOne({ userId, workDate: start }).session(session || null)
  ]);

  return { adjustments, events, existingRecord, legacyRaw, start };
};

const resolveTimeline = ({ events, adjustments, legacyRaw, existingRecord }) => {
  const rawCheckIn = events.filter((event) => event.eventType === 'CHECK_IN')[0]?.occurredAt
    || legacyRaw.map((item) => item.checkInTime).filter(Boolean).sort((a, b) => a - b)[0]
    || (existingRecord?.source === 'manual' ? existingRecord.checkInTime : null);
  const rawCheckOut = events.filter((event) => event.eventType === 'CHECK_OUT').at(-1)?.occurredAt
    || legacyRaw.map((item) => item.checkOutTime).filter(Boolean).sort((a, b) => b - a)[0]
    || null;

  const adjustmentCheckIn = adjustments
    .filter((item) => item.adjustmentType === 'MISSING_CHECK_IN')
    .at(-1)?.requestedAt || null;
  const adjustmentCheckOut = adjustments
    .filter((item) => item.adjustmentType === 'MISSING_CHECK_OUT')
    .at(-1)?.requestedAt || null;

  // Device logs always take precedence. Approved adjustments fill only gaps.
  const checkInTime = rawCheckIn || adjustmentCheckIn;
  const checkOutTime = rawCheckOut || adjustmentCheckOut;
  const checkInSource = rawCheckIn
    ? (existingRecord?.source === 'manual' && rawCheckIn === existingRecord.checkInTime ? 'manual' : 'biometric')
    : (adjustmentCheckIn ? 'correction' : 'unknown');
  const checkOutSource = rawCheckOut ? 'biometric' : (adjustmentCheckOut ? 'correction' : 'unknown');

  return { checkInSource, checkInTime, checkOutSource, checkOutTime };
};

const calculateAttendanceForUserDate = async ({ userId, workDate, actorId = null, calculatedBy = 'queue_worker' }) => {
  const timezone = DEFAULT_SCHOOL_TIMEZONE;
  const normalizedWorkDate = toWorkDate(workDate, timezone);

  return withTransaction(async (session) => {
    const inputs = await getCalculationInputs({
      userId,
      workDate: normalizedWorkDate,
      timezone,
      session
    });
    const timeline = resolveTimeline(inputs);
    const workingMinutes = timeline.checkInTime && timeline.checkOutTime
      ? Math.max(0, Math.round((timeline.checkOutTime - timeline.checkInTime) / 60000))
      : 0;
    const inputHash = buildInputHash({
      eventIds: inputs.events.map((item) => item._id.toString()),
      legacyRawIds: inputs.legacyRaw.map((item) => item._id.toString()),
      adjustmentIds: inputs.adjustments.map((item) => item._id.toString()),
      times: timeline,
      timezone
    });

    const oldRecord = inputs.existingRecord;
    const calculationVersion = (oldRecord?.calculationVersion || 0) + 1;
    const recordData = {
      employeeName: oldRecord?.employeeName || inputs.events[0]?.employeeName || inputs.adjustments[0]?.employeeName || 'Nhân viên',
      checkInTime: timeline.checkInTime,
      checkOutTime: timeline.checkOutTime,
      workingMinutes,
      checkInSource: timeline.checkInSource,
      checkOutSource: timeline.checkOutSource,
      status: timeline.checkInTime && timeline.checkOutTime ? 'present' : 'incomplete',
      source: 'merged',
      correctionRequestId: inputs.adjustments.at(-1)?._id || null,
      finalized: true,
      timezone,
      calculationVersion,
      inputHash,
      needsRecalculation: false,
      calculatedAt: new Date(),
      calculatedBy
    };

    const record = await AttendanceRecord.findOneAndUpdate(
      { userId, workDate: inputs.start },
      {
        $set: recordData,
        $setOnInsert: { userId, workDate: inputs.start }
      },
      { new: true, upsert: true, session, setDefaultsOnInsert: true }
    );

    if (inputs.adjustments.length) {
      await TimekeepingCorrectionRequest.updateMany(
        { _id: { $in: inputs.adjustments.map((item) => item._id) } },
        { $set: { attendanceRecordId: record._id } },
        { session }
      );
    }

    await AttendanceAuditLog.create([{
      actor: actorId,
      action: 'ATTENDANCE_RECALCULATED',
      entity: 'AttendanceRecord',
      entityId: record._id,
      oldValue: oldRecord?.toObject() || null,
      newValue: record.toObject(),
      reason: 'Idempotent attendance calculation',
      timestamp: new Date()
    }], { session });

    return record;
  });
};

const enqueueUsersForWorkDate = async (workDate, reason, session = null) => {
  const timezone = DEFAULT_SCHOOL_TIMEZONE;
  const normalizedWorkDate = toWorkDate(workDate, timezone);
  const { start, end } = getWorkDateRange(normalizedWorkDate, timezone);
  const [eventUsers, adjustmentUsers, legacyUsers, manualUsers] = await Promise.all([
    RawAttendanceEvent.distinct('userId', { workDate: start, isValid: true }).session(session || null),
    TimekeepingCorrectionRequest.distinct('userId', { workDate: { $gte: start, $lt: end }, status: 'APPROVED' }).session(session || null),
    RawAttendance.distinct('userId', { workDate: { $gte: start, $lt: end } }).session(session || null),
    AttendanceRecord.distinct('userId', { workDate: start }).session(session || null)
  ]);
  const userIds = new Map();
  [...eventUsers, ...adjustmentUsers, ...legacyUsers, ...manualUsers].forEach((id) => userIds.set(id.toString(), id));
  await Promise.all([...userIds.values()].map((userId) => queueRecalculation({
    userId,
    workDate: start,
    reason,
    session
  })));
  return userIds.size;
};

const claimQueueItem = async (workerId) => {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + 5 * 60 * 1000);
  return AttendanceRecalculationQueue.findOneAndUpdate(
    {
      status: { $in: ['PENDING', 'FAILED'] },
      nextAttemptAt: { $lte: now },
      $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }]
    },
    {
      $set: { status: 'PROCESSING', lockedBy: workerId, lockedUntil: leaseUntil },
      $inc: { attempts: 1 }
    },
    { new: true, sort: { nextAttemptAt: 1 } }
  );
};

const processQueuedRecalculations = async ({ workerId, maxItems = 100, actorId = null }) => {
  const processed = [];
  for (let index = 0; index < maxItems; index += 1) {
    const item = await claimQueueItem(workerId);
    if (!item) break;
    try {
      const record = await calculateAttendanceForUserDate({
        userId: item.userId,
        workDate: item.workDate,
        actorId,
        calculatedBy: 'queue_worker'
      });
      await AttendanceRecalculationQueue.updateOne(
        { _id: item._id, lockedBy: workerId },
        {
          $set: {
            status: 'DONE',
            completedAt: new Date(),
            lockedBy: null,
            lockedUntil: null,
            lastError: null
          }
        }
      );
      processed.push(record);
    } catch (error) {
      const delayMs = Math.min(30 * 60 * 1000, 1000 * (2 ** Math.min(item.attempts, 10)));
      await AttendanceRecalculationQueue.updateOne(
        { _id: item._id, lockedBy: workerId },
        {
          $set: {
            status: 'FAILED',
            lockedBy: null,
            lockedUntil: null,
            nextAttemptAt: new Date(Date.now() + delayMs),
            lastError: error.message
          }
        }
      );
      console.error('Attendance recalculation failed:', error);
    }
  }
  return processed;
};

const recalculateAttendanceForDate = async (workDate, actorId = null) => {
  const normalizedWorkDate = toWorkDate(workDate);
  const queued = await enqueueUsersForWorkDate(normalizedWorkDate, 'MANUAL_RECALCULATION');
  const records = await processQueuedRecalculations({
    workerId: `manual-${process.pid}`,
    actorId,
    maxItems: Math.max(queued, 1)
  });
  return records;
};

module.exports = {
  calculateAttendanceForUserDate,
  enqueueUsersForWorkDate,
  processQueuedRecalculations,
  recalculateAttendanceForDate,
  toWorkDate
};
