const mongoose = require('mongoose');
const AttendanceAuditLog = require('../models/zone2_hr/AttendanceAuditLog');
const AttendanceRecalculationQueue = require('../models/zone2_hr/AttendanceRecalculationQueue');
const OutboxEvent = require('../models/zone1_system/OutboxEvent');
const RawAttendanceEvent = require('../models/zone2_hr/RawAttendanceEvent');
const TimekeepingCorrectionRequest = require('../models/zone2_hr/TimekeepingCorrectionRequest');
const {
  DEFAULT_SCHOOL_TIMEZONE,
  addWorkDays,
  createDateTime,
  getWorkDate,
  isValidTime,
  isValidWorkDate,
  startOfWorkDate
} = require('../utils/dateHelpers');

class TimekeepingError extends Error {
  constructor(message, statusCode = 400, code = 'TIMEKEEPING_VALIDATION_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const employeeName = (user) => user.profile?.fullName || user.username;

const normalizeWorkDate = (value, timezone) => {
  if (typeof value === 'string' && isValidWorkDate(value)) return value;
  if (value instanceof Date || typeof value === 'number') return getWorkDate(value, timezone);
  throw new TimekeepingError('Ngày công phải có định dạng YYYY-MM-DD');
};

const normalizePayload = (input, timezone = DEFAULT_SCHOOL_TIMEZONE) => {
  const adjustmentType = input.adjustmentType || input.requestType || 'MISSING_CHECK_IN';
  if (!['MISSING_CHECK_IN', 'MISSING_CHECK_OUT'].includes(adjustmentType)) {
    throw new TimekeepingError('Loại điều chỉnh không hợp lệ');
  }

  const workDate = normalizeWorkDate(input.workDate, timezone);
  const requestedTime = input.requestedTime
    || (adjustmentType === 'MISSING_CHECK_OUT' ? input.requestedCheckOutTime : input.requestedCheckInTime);
  const requestedDayOffset = Number(input.requestedDayOffset || 0);

  if (!isValidTime(requestedTime)) {
    throw new TimekeepingError('Giờ đề nghị phải theo định dạng HH:mm');
  }
  if (![0, 1].includes(requestedDayOffset)) {
    throw new TimekeepingError('requestedDayOffset chỉ nhận 0 hoặc 1');
  }
  if (!input.reason?.trim()) {
    throw new TimekeepingError('Vui lòng nhập lý do điều chỉnh');
  }

  const requestedAt = createDateTime(
    requestedDayOffset ? addWorkDays(workDate, requestedDayOffset) : workDate,
    requestedTime,
    timezone
  );
  if (Number.isNaN(requestedAt.getTime())) {
    throw new TimekeepingError('Thời gian đề nghị không hợp lệ');
  }
  if (requestedAt > new Date()) {
    throw new TimekeepingError('Không thể đề nghị thời gian trong tương lai');
  }

  return {
    workDate,
    workDateStart: startOfWorkDate(workDate, timezone),
    adjustmentType,
    requestedTime,
    requestedDayOffset,
    requestedAt,
    reason: input.reason.trim(),
    timezone
  };
};

const writeAudit = (document, { actorId, action, entity, entityId, oldValue, newValue, reason, session }) => (
  AttendanceAuditLog.create([{
    actor: actorId || null,
    action,
    entity,
    entityId,
    oldValue,
    newValue,
    reason,
    timestamp: new Date()
  }], { session }).then(([entry]) => entry)
);

const findDuplicateDeviceEvent = async ({ userId, adjustmentType, requestedAt, session }) => {
  const toleranceMs = Number(process.env.ATTENDANCE_DUPLICATE_TOLERANCE_MS || 2 * 60 * 1000);
  const eventType = adjustmentType === 'MISSING_CHECK_IN' ? 'CHECK_IN' : 'CHECK_OUT';
  return RawAttendanceEvent.findOne({
    userId,
    eventType,
    isValid: true,
    occurredAt: {
      $gte: new Date(requestedAt.getTime() - toleranceMs),
      $lte: new Date(requestedAt.getTime() + toleranceMs)
    }
  }).session(session || null);
};

const ensureNoDuplicateDeviceEvent = async (payload, userId, session) => {
  const duplicate = await findDuplicateDeviceEvent({
    userId,
    adjustmentType: payload.adjustmentType,
    requestedAt: payload.requestedAt,
    session
  });
  if (duplicate) {
    throw new TimekeepingError(
      'Đã có log máy chấm công hợp lệ gần với thời gian đề nghị',
      409,
      'DUPLICATE_DEVICE_EVENT'
    );
  }
};

const createDraft = async (user, input) => {
  const payload = normalizePayload(input);
  const document = await TimekeepingCorrectionRequest.create({
    userId: user._id,
    employeeName: employeeName(user),
    workDate: payload.workDateStart,
    timezone: payload.timezone,
    adjustmentType: payload.adjustmentType,
    requestType: payload.adjustmentType,
    requestedAt: payload.requestedAt,
    requestedTime: payload.requestedTime,
    requestedDayOffset: payload.requestedDayOffset,
    requestedCheckInTime: payload.adjustmentType === 'MISSING_CHECK_IN' ? payload.requestedTime : undefined,
    requestedCheckOutTime: payload.adjustmentType === 'MISSING_CHECK_OUT' ? payload.requestedTime : undefined,
    reason: payload.reason,
    status: 'DRAFT',
    isActive: true
  });

  await writeAudit(document, {
    actorId: user._id,
    action: 'ADJUSTMENT_DRAFT_CREATED',
    entity: 'TimekeepingCorrectionRequest',
    entityId: document._id,
    oldValue: null,
    newValue: document.toObject(),
    reason: payload.reason
  });

  return document;
};

const updateDraft = async (user, adjustmentId, input) => {
  const existing = await TimekeepingCorrectionRequest.findOne({
    _id: adjustmentId,
    userId: user._id,
    status: { $in: ['DRAFT', 'PENDING'] }
  });
  if (!existing) throw new TimekeepingError('Không tìm thấy phiếu có thể sửa', 404, 'ADJUSTMENT_NOT_EDITABLE');
  if (Number(input.version) !== existing.version) {
    throw new TimekeepingError('Phiếu đã thay đổi, vui lòng tải lại', 409, 'VERSION_CONFLICT');
  }

  const payload = normalizePayload({ ...existing.toObject(), ...input }, existing.timezone);
  const updated = await TimekeepingCorrectionRequest.findOneAndUpdate(
    { _id: existing._id, status: existing.status, version: existing.version },
    {
      $set: {
        workDate: payload.workDateStart,
        timezone: payload.timezone,
        adjustmentType: payload.adjustmentType,
        requestType: payload.adjustmentType,
        requestedAt: payload.requestedAt,
        requestedTime: payload.requestedTime,
        requestedDayOffset: payload.requestedDayOffset,
        requestedCheckInTime: payload.adjustmentType === 'MISSING_CHECK_IN' ? payload.requestedTime : undefined,
        requestedCheckOutTime: payload.adjustmentType === 'MISSING_CHECK_OUT' ? payload.requestedTime : undefined,
        reason: payload.reason
      },
      $inc: { version: 1 }
    },
    { new: true, runValidators: true }
  );
  if (!updated) throw new TimekeepingError('Phiếu đã thay đổi, vui lòng tải lại', 409, 'VERSION_CONFLICT');

  await writeAudit(updated, {
    actorId: user._id,
    action: 'ADJUSTMENT_UPDATED',
    entity: 'TimekeepingCorrectionRequest',
    entityId: updated._id,
    oldValue: existing.toObject(),
    newValue: updated.toObject(),
    reason: payload.reason
  });
  return updated;
};

const submitDraft = async (user, adjustmentId, expectedVersion) => {
  const draft = await TimekeepingCorrectionRequest.findOne({
    _id: adjustmentId,
    userId: user._id,
    status: 'DRAFT'
  });
  if (!draft) throw new TimekeepingError('Không tìm thấy phiếu nháp để gửi', 404, 'ADJUSTMENT_NOT_SUBMITTABLE');
  if (Number(expectedVersion) !== draft.version) {
    throw new TimekeepingError('Phiếu đã thay đổi, vui lòng tải lại', 409, 'VERSION_CONFLICT');
  }

  await ensureNoDuplicateDeviceEvent({
    adjustmentType: draft.adjustmentType,
    requestedAt: draft.requestedAt
  }, user._id);

  const submitted = await TimekeepingCorrectionRequest.findOneAndUpdate(
    { _id: draft._id, status: 'DRAFT', version: draft.version },
    { $set: { status: 'PENDING', submittedAt: new Date() }, $inc: { version: 1 } },
    { new: true }
  );
  if (!submitted) throw new TimekeepingError('Phiếu đã thay đổi, vui lòng tải lại', 409, 'VERSION_CONFLICT');

  await writeAudit(submitted, {
    actorId: user._id,
    action: 'ADJUSTMENT_SUBMITTED',
    entity: 'TimekeepingCorrectionRequest',
    entityId: submitted._id,
    oldValue: draft.toObject(),
    newValue: submitted.toObject(),
    reason: submitted.reason
  });
  return submitted;
};

const cancelAdjustment = async (user, adjustmentId, expectedVersion, cancelReason = '') => {
  const adjustment = await TimekeepingCorrectionRequest.findOne({
    _id: adjustmentId,
    userId: user._id,
    status: { $in: ['DRAFT', 'PENDING'] }
  });
  if (!adjustment) throw new TimekeepingError('Phiếu không thể hủy', 404, 'ADJUSTMENT_NOT_CANCELLABLE');
  if (Number(expectedVersion) !== adjustment.version) {
    throw new TimekeepingError('Phiếu đã thay đổi, vui lòng tải lại', 409, 'VERSION_CONFLICT');
  }

  const cancelled = await TimekeepingCorrectionRequest.findOneAndUpdate(
    { _id: adjustment._id, status: adjustment.status, version: adjustment.version },
    {
      $set: { status: 'CANCELLED', isActive: false, cancelledAt: new Date(), cancelReason: cancelReason.trim() },
      $inc: { version: 1 }
    },
    { new: true }
  );
  if (!cancelled) throw new TimekeepingError('Phiếu đã thay đổi, vui lòng tải lại', 409, 'VERSION_CONFLICT');

  await writeAudit(cancelled, {
    actorId: user._id,
    action: 'ADJUSTMENT_CANCELLED',
    entity: 'TimekeepingCorrectionRequest',
    entityId: cancelled._id,
    oldValue: adjustment.toObject(),
    newValue: cancelled.toObject(),
    reason: cancelReason
  });
  return cancelled;
};

const queueRecalculation = async ({ userId, workDate, reason, session }) => {
  const now = new Date();
  return AttendanceRecalculationQueue.findOneAndUpdate(
    { userId, workDate },
    {
      $set: {
        status: 'PENDING',
        nextAttemptAt: now,
        lockedBy: null,
        lockedUntil: null,
        lastError: null,
        completedAt: null
      },
      $addToSet: { reasons: reason },
      $setOnInsert: { attempts: 0 }
    },
    { upsert: true, new: true, session, setDefaultsOnInsert: true }
  );
};

const withTransaction = async (operation) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await operation(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

const approveAdjustment = async (admin, adjustmentId, expectedVersion, reviewNote = '') => (
  withTransaction(async (session) => {
    const pending = await TimekeepingCorrectionRequest.findById(adjustmentId).session(session);
    if (!pending) throw new TimekeepingError('Không tìm thấy phiếu điều chỉnh', 404, 'ADJUSTMENT_NOT_FOUND');
    if (pending.status !== 'PENDING') {
      throw new TimekeepingError('Phiếu đã được xử lý', 409, 'ADJUSTMENT_ALREADY_PROCESSED');
    }
    if (Number(expectedVersion) !== pending.version) {
      throw new TimekeepingError('Phiếu đã thay đổi, vui lòng tải lại', 409, 'VERSION_CONFLICT');
    }

    await ensureNoDuplicateDeviceEvent({
      adjustmentType: pending.adjustmentType,
      requestedAt: pending.requestedAt
    }, pending.userId, session);

    const approved = await TimekeepingCorrectionRequest.findOneAndUpdate(
      { _id: pending._id, status: 'PENDING', version: pending.version },
      {
        $set: {
          status: 'APPROVED',
          reviewedBy: admin._id,
          reviewedAt: new Date(),
          reviewNote: reviewNote.trim() || null,
          approvedBy: admin._id,
          approvedAt: new Date()
        },
        $inc: { version: 1 }
      },
      { new: true, session }
    );
    if (!approved) throw new TimekeepingError('Phiếu đã được xử lý', 409, 'VERSION_CONFLICT');

    await queueRecalculation({
      userId: approved.userId,
      workDate: approved.workDate,
      reason: 'ADJUSTMENT_APPROVED',
      session
    });
    await OutboxEvent.create([{
      type: 'ATTENDANCE_RECALCULATION_REQUESTED',
      payload: { userId: approved.userId, workDate: approved.workDate, adjustmentId: approved._id }
    }], { session });
    await writeAudit(approved, {
      actorId: admin._id,
      action: 'CORRECTION_APPROVED',
      entity: 'TimekeepingCorrectionRequest',
      entityId: approved._id,
      oldValue: pending.toObject(),
      newValue: approved.toObject(),
      reason: reviewNote,
      session
    });
    return approved;
  })
);

const rejectAdjustment = async (admin, adjustmentId, expectedVersion, reviewNote) => {
  if (!reviewNote?.trim()) throw new TimekeepingError('Bắt buộc nhập ghi chú khi từ chối');
  return withTransaction(async (session) => {
    const pending = await TimekeepingCorrectionRequest.findById(adjustmentId).session(session);
    if (!pending) throw new TimekeepingError('Không tìm thấy phiếu điều chỉnh', 404, 'ADJUSTMENT_NOT_FOUND');
    if (pending.status !== 'PENDING') throw new TimekeepingError('Phiếu đã được xử lý', 409, 'ADJUSTMENT_ALREADY_PROCESSED');
    if (Number(expectedVersion) !== pending.version) throw new TimekeepingError('Phiếu đã thay đổi, vui lòng tải lại', 409, 'VERSION_CONFLICT');

    const rejected = await TimekeepingCorrectionRequest.findOneAndUpdate(
      { _id: pending._id, status: 'PENDING', version: pending.version },
      {
        $set: {
          status: 'REJECTED',
          isActive: false,
          reviewedBy: admin._id,
          reviewedAt: new Date(),
          reviewNote: reviewNote.trim(),
          approvedBy: admin._id,
          approvedAt: new Date(),
          rejectionReason: reviewNote.trim()
        },
        $inc: { version: 1 }
      },
      { new: true, session }
    );
    if (!rejected) throw new TimekeepingError('Phiếu đã được xử lý', 409, 'VERSION_CONFLICT');
    await writeAudit(rejected, {
      actorId: admin._id,
      action: 'CORRECTION_REJECTED',
      entity: 'TimekeepingCorrectionRequest',
      entityId: rejected._id,
      oldValue: pending.toObject(),
      newValue: rejected.toObject(),
      reason: reviewNote,
      session
    });
    return rejected;
  });
};

const createAndSubmitLegacy = async (user, input) => {
  const draft = await createDraft(user, input);
  return submitDraft(user, draft._id, draft.version);
};

module.exports = {
  TimekeepingError,
  approveAdjustment,
  cancelAdjustment,
  createAndSubmitLegacy,
  createDraft,
  employeeName,
  normalizePayload,
  queueRecalculation,
  rejectAdjustment,
  submitDraft,
  updateDraft,
  withTransaction
};
