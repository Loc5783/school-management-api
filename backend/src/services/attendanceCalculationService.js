const crypto = require('crypto');
const AttendanceAuditLog = require('../models/zone2_hr/AttendanceAuditLog');
const AttendanceRecord = require('../models/zone2_hr/AttendanceRecord');
const AttendanceRecalculationQueue = require('../models/zone2_hr/AttendanceRecalculationQueue');
const Employee = require('../models/zone2_hr/Employee');
const RawAttendance = require('../models/zone2_hr/RawAttendance');
const RawAttendanceEvent = require('../models/zone2_hr/RawAttendanceEvent');
const StaffShift = require('../models/zone2_hr/StaffShift');
const TimekeepingCorrectionRequest = require('../models/zone2_hr/TimekeepingCorrectionRequest');
const User = require('../models/zone1_system/User');
const { queueRecalculation, withTransaction, TimekeepingError } = require('./attendanceAdjustmentService');
const {
  buildTenantFilter,
  createTrustedTenantContext,
  resolveUserAndTenantContext,
  resolveTenantContext
} = require('./tenantFilterService');
const {
  DEFAULT_SCHOOL_TIMEZONE,
  createDateTime,
  getWorkDate,
  getWorkDateRange,
  isValidWorkDate,
  startOfWorkDate
} = require('../utils/dateHelpers');

// Ngưỡng chống quẹt đúp liên tiếp trước máy chấm công: 5 phút (300.000 ms)
const DEFAULT_PUNCH_COOLDOWN_MS = Number(process.env.ATTENDANCE_PUNCH_COOLDOWN_MS || 5 * 60 * 1000);
const DEFAULT_EMPLOYEE_SHIFT_START = '08:00';

const resolveTenantScope = (user, context) => {
  if (user) {
    const resolved = resolveUserAndTenantContext(user, context);
    if (!resolved.isValid) {
      throw new TimekeepingError('Ngữ cảnh tenant không hợp lệ hoặc người dùng không khớp', 403, 'FORBIDDEN');
    }
    return {
      filter: resolved.isSaaS ? { tenantId: resolved.tenantId } : { tenantId: null },
      tenantId: resolved.tenantId ? resolved.tenantId.toString() : null
    };
  }

  if (context) {
    const resolved = resolveTenantContext(context);
    if (!resolved.isValid) {
      throw new TimekeepingError('Ngữ cảnh tenant không hợp lệ hoặc bị thiếu', 403, 'FORBIDDEN');
    }
    return {
      filter: resolved.isSaaS ? { tenantId: resolved.tenantId } : { tenantId: null },
      tenantId: resolved.tenantId ? resolved.tenantId.toString() : null
    };
  }

  throw new TimekeepingError('Thiếu thông tin người dùng và ngữ cảnh trường', 403, 'FORBIDDEN');
};

const buildInputHash = (value) => crypto
  .createHash('sha256')
  .update(JSON.stringify(value))
  .digest('hex');

const toWorkDate = (value, timezone = DEFAULT_SCHOOL_TIMEZONE) => {
  if (typeof value === 'string' && isValidWorkDate(value)) return value;
  return getWorkDate(value, timezone);
};

const getCalculationInputs = async ({ userId, workDate, timezone, tenantFilter = {}, session }) => {
  const { start, end } = getWorkDateRange(workDate, timezone);
  // Sequential reads prevent queue worker failure in concurrent transactions
  const events = await RawAttendanceEvent.find({
    userId,
    isValid: true,
    workDate: start,
    ...tenantFilter
  }).sort({ occurredAt: 1 }).session(session || null);
  const adjustments = await TimekeepingCorrectionRequest.find({
    userId,
    workDate: { $gte: start, $lt: end },
    status: 'APPROVED',
    ...tenantFilter
  }).sort({ requestedAt: 1 }).session(session || null);
  const legacyRaw = await RawAttendance.find({
    userId,
    workDate: { $gte: start, $lt: end },
    ...tenantFilter
  }).session(session || null);
  const existingRecord = await AttendanceRecord.findOne({ userId, workDate: start, ...tenantFilter }).session(session || null);

  return { adjustments, events, existingRecord, legacyRaw, start };
};

const resolveTimeline = ({ events, adjustments, legacyRaw, existingRecord }) => {
  let rawCheckIn = events.filter((event) => event.eventType === 'CHECK_IN')[0]?.occurredAt
    || legacyRaw.map((item) => item.checkInTime).filter(Boolean).sort((a, b) => a - b)[0]
    || (existingRecord?.source === 'manual' ? existingRecord.checkInTime : null);
  let rawCheckOut = events.filter((event) => event.eventType === 'CHECK_OUT').at(-1)?.occurredAt
    || legacyRaw.map((item) => item.checkOutTime).filter(Boolean).sort((a, b) => b - a)[0]
    || null;

  // Process biometric PUNCH events from physical devices
  const punchEvents = events
    .filter((event) => event.eventType === 'PUNCH')
    .map((e) => e.occurredAt)
    .sort((a, b) => a - b);

  if (punchEvents.length > 0) {
    if (!rawCheckIn) {
      // Lần quẹt đầu tiên trong ngày được ghi nhận là Giờ Vào (Check-in)
      rawCheckIn = punchEvents[0];
    }
    if (!rawCheckOut && punchEvents.length > 1) {
      // Lần quẹt cuối cùng chỉ được ghi nhận là Giờ Ra (Check-out) khi cách lần Check-in tối thiểu 5 phút (chống quẹt đúp)
      const lastPunch = punchEvents[punchEvents.length - 1];
      if (lastPunch.getTime() - rawCheckIn.getTime() >= DEFAULT_PUNCH_COOLDOWN_MS) {
        rawCheckOut = lastPunch;
      }
    }
  }

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

const calculateAttendanceForUserDate = async ({ userId, workDate, actorId = null, calculatedBy = 'queue_worker', context = null }) => {
  const timezone = DEFAULT_SCHOOL_TIMEZONE;
  const normalizedWorkDate = toWorkDate(workDate, timezone);

  let scope;
  if (context) {
    scope = resolveTenantScope(null, context);
  } else {
    // Resolve user's actual tenant to prevent cross-tenant calculation leak
    const targetUser = await User.findById(userId).select('_id tenantId status');
    if (!targetUser) throw new TimekeepingError('Không tìm thấy tài khoản người dùng để tính công', 404, 'USER_NOT_FOUND');
    const trusted = createTrustedTenantContext({ tenantId: targetUser.tenantId ? targetUser.tenantId.toString() : null, isLegacy: !targetUser.tenantId });
    scope = resolveTenantScope(targetUser, trusted);
  }

  // Authoritative check: User MUST exist and match the scope filter
  const targetUser = await User.findOne({ _id: userId, ...scope.filter }).select('_id tenantId status');
  if (!targetUser) {
    throw new TimekeepingError('Không tìm thấy tài khoản người dùng trong phạm vi trường để tính công', 404, 'USER_NOT_FOUND');
  }

  return withTransaction(async (session) => {
    const inputs = await getCalculationInputs({
      userId,
      workDate: normalizedWorkDate,
      timezone,
      tenantFilter: scope.filter,
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

    // Tra cứu ca làm việc (StaffShift) của nhân sự trong ngày để xác định ngưỡng đi muộn; mặc định 08:00 nếu chưa gán ca
    let scheduledStartTime = DEFAULT_EMPLOYEE_SHIFT_START;
    const empProfile = await Employee.findOne({ userId, ...scope.filter }).select('_id').lean().session(session || null);
    if (empProfile) {
      const weekday = new Date(`${normalizedWorkDate}T00:00:00.000Z`).getUTCDay();
      const activeShift = await StaffShift.findOne({
        employeeId: empProfile._id,
        status: 'active',
        validFrom: { $lte: normalizedWorkDate },
        validUntil: { $gte: normalizedWorkDate },
        weekdays: weekday,
        ...scope.filter
      }).sort({ startTime: 1 }).select('startTime').lean().session(session || null);
      if (activeShift?.startTime) {
        scheduledStartTime = activeShift.startTime;
      }
    }

    const shiftStartAt = createDateTime(normalizedWorkDate, scheduledStartTime, timezone);
    const lateMinutes = timeline.checkInTime && timeline.checkInTime > shiftStartAt
      ? Math.floor((timeline.checkInTime.getTime() - shiftStartAt.getTime()) / 60000)
      : 0;
    const isLate = lateMinutes > 0;

    const oldRecord = inputs.existingRecord;
    if (oldRecord && (oldRecord.isLocked || oldRecord.isPeriodLocked)) {
      return oldRecord;
    }
    const calculationVersion = (oldRecord?.calculationVersion || 0) + 1;
    const autoLateNote = isLate ? `Đi muộn ${lateMinutes} phút (giờ vào chuẩn ${scheduledStartTime})` : '';
    const recordData = {
      tenantId: scope.tenantId || null,
      employeeName: oldRecord?.employeeName || inputs.events[0]?.employeeName || inputs.adjustments[0]?.employeeName || 'Nhân viên',
      checkInTime: timeline.checkInTime,
      checkOutTime: timeline.checkOutTime,
      workingMinutes,
      isLate,
      lateMinutes,
      scheduledStartTime,
      note: oldRecord?.note ? oldRecord.note : autoLateNote,
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
      { userId, workDate: inputs.start, ...scope.filter },
      {
        $set: recordData,
        $setOnInsert: { userId, workDate: inputs.start }
      },
      { new: true, upsert: true, session, setDefaultsOnInsert: true }
    );

    if (inputs.adjustments.length) {
      await TimekeepingCorrectionRequest.updateMany(
        { _id: { $in: inputs.adjustments.map((item) => item._id) }, ...scope.filter },
        { $set: { attendanceRecordId: record._id } },
        { session }
      );
    }

    await AttendanceAuditLog.create([{
      tenantId: scope.tenantId || null,
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

const enqueueUsersForWorkDate = async (workDate, reason, context = null, session = null) => {
  const timezone = DEFAULT_SCHOOL_TIMEZONE;
  const normalizedWorkDate = toWorkDate(workDate, timezone);
  const { start, end } = getWorkDateRange(normalizedWorkDate, timezone);
  const scope = resolveTenantScope(null, context);

  const [eventUsers, adjustmentUsers, legacyUsers, manualUsers] = await Promise.all([
    RawAttendanceEvent.distinct('userId', { workDate: start, isValid: true, ...scope.filter }).session(session || null),
    TimekeepingCorrectionRequest.distinct('userId', { workDate: { $gte: start, $lt: end }, status: 'APPROVED', ...scope.filter }).session(session || null),
    RawAttendance.distinct('userId', { workDate: { $gte: start, $lt: end }, ...scope.filter }).session(session || null),
    AttendanceRecord.distinct('userId', { workDate: start, ...scope.filter }).session(session || null)
  ]);
  const userIds = new Map();
  [...eventUsers, ...adjustmentUsers, ...legacyUsers, ...manualUsers].forEach((id) => userIds.set(id.toString(), id));
  await Promise.all([...userIds.values()].map((userId) => queueRecalculation({
    userId,
    workDate: start,
    reason,
    tenantId: scope.tenantId || null,
    tenantFilter: scope.filter,
    session
  })));
  return userIds.size;
};

const claimQueueItem = async (workerId, queueFilter = {}) => {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + 5 * 60 * 1000);
  return AttendanceRecalculationQueue.findOneAndUpdate(
    {
      status: { $in: ['PENDING', 'FAILED'] },
      nextAttemptAt: { $lte: now },
      $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }],
      ...queueFilter
    },
    {
      $set: { status: 'PROCESSING', lockedBy: workerId, lockedUntil: leaseUntil },
      $inc: { attempts: 1 }
    },
    { new: true, sort: { nextAttemptAt: 1 } }
  );
};

const processQueuedRecalculations = async ({
  workerId,
  maxItems = 100,
  actorId = null,
  queueFilter = null,
  isGlobalWorker = false,
  context = null
} = {}) => {
  if (!isGlobalWorker && !context) {
    throw new TimekeepingError(
      'Yêu cầu xử lý hàng đợi phải có ngữ cảnh trường đáng tin cậy hoặc cờ global worker',
      403,
      'FORBIDDEN'
    );
  }

  let effectiveQueueFilter;

  if (isGlobalWorker === true) {
    effectiveQueueFilter = queueFilter && typeof queueFilter === 'object' ? { ...queueFilter } : {};
  } else {
    const scope = resolveTenantScope(null, context);
    const expectedTenantId = scope.tenantId || null;

    if (queueFilter && typeof queueFilter === 'object') {
      if (queueFilter.tenantId !== undefined && String(queueFilter.tenantId || null) !== String(expectedTenantId)) {
        throw new TimekeepingError(
          'Điều kiện lọc hàng đợi không khớp với ngữ cảnh trường được xác thực',
          403,
          'FORBIDDEN'
        );
      }
    }

    effectiveQueueFilter = {
      ...(queueFilter || {}),
      tenantId: expectedTenantId
    };
  }

  const processed = [];
  for (let index = 0; index < maxItems; index += 1) {
    const item = await claimQueueItem(workerId, effectiveQueueFilter || {});
    if (!item) break;
    try {
      // Create isolated context per queue item based on item's verified tenantId
      const itemContext = item.tenantId
        ? createTrustedTenantContext({ tenantId: item.tenantId })
        : createTrustedTenantContext({ isLegacy: true });

      const itemFilter = buildTenantFilter(itemContext);
      // Validate user belongs to the same tenant as the queue item
      const itemUser = await User.findOne({ _id: item.userId, ...itemFilter });
      if (!itemUser) {
        throw new Error('User tenant mismatch or user not found for recalculation item');
      }

      const record = await calculateAttendanceForUserDate({
        userId: item.userId,
        workDate: item.workDate,
        actorId,
        calculatedBy: 'queue_worker',
        context: itemContext
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

const recalculateAttendanceForDate = async (workDate, actorId = null, context = null) => {
  const normalizedWorkDate = toWorkDate(workDate);
  const scope = resolveTenantScope(null, context);
  const queued = await enqueueUsersForWorkDate(normalizedWorkDate, 'MANUAL_RECALCULATION', context);
  const queueFilter = {
    workDate: normalizedWorkDate,
    tenantId: scope.tenantId || null
  };
  const records = await processQueuedRecalculations({
    workerId: `manual-${process.pid}`,
    actorId,
    maxItems: Math.max(queued, 1),
    queueFilter,
    context
  });
  return records;
};

module.exports = {
  calculateAttendanceForUserDate,
  claimQueueItem,
  enqueueUsersForWorkDate,
  processQueuedRecalculations,
  recalculateAttendanceForDate,
  resolveTenantScope,
  toWorkDate
};
