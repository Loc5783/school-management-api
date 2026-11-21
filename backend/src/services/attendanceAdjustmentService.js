const mongoose = require('mongoose');
const AttendanceAuditLog = require('../models/zone2_hr/AttendanceAuditLog');
const AttendanceRecalculationQueue = require('../models/zone2_hr/AttendanceRecalculationQueue');
const Employee = require('../models/zone2_hr/Employee');
const OutboxEvent = require('../models/zone1_system/OutboxEvent');
const RawAttendanceEvent = require('../models/zone2_hr/RawAttendanceEvent');
const TimekeepingCorrectionRequest = require('../models/zone2_hr/TimekeepingCorrectionRequest');
const User = require('../models/zone1_system/User');
const {
  buildTenantFilter,
  createTrustedTenantContext,
  resolveUserAndTenantContext,
  resolveTenantContext
} = require('./tenantFilterService');
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

const ADJUSTMENT_ROLES = Object.freeze(['admin', 'principal', 'teacher', 'accountant', 'chef', 'hr']);
const EMPLOYEE_ROLES = Object.freeze(['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard', 'hr']);

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
    throw new TimekeepingError('Độ lệch ngày chỉ có thể là 0 hoặc 1');
  }
  if (!input.reason || typeof input.reason !== 'string' || !input.reason.trim()) {
    throw new TimekeepingError('Lý do điều chỉnh không được để trống');
  }

  const effectiveDate = requestedDayOffset === 1 ? addWorkDays(workDate, 1) : workDate;
  const requestedAt = createDateTime(
    effectiveDate,
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

const writeAudit = (document, { actorId, action, entity, entityId, oldValue, newValue, reason, tenantId = null, session }) => (
  AttendanceAuditLog.create([{
    tenantId: tenantId !== null && tenantId !== undefined ? tenantId : (document?.tenantId || null),
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

const findDuplicateDeviceEvent = async ({ userId, adjustmentType, requestedAt, tenantFilter = {}, session }) => {
  const toleranceMs = Number(process.env.ATTENDANCE_DUPLICATE_TOLERANCE_MS || 2 * 60 * 1000);
  const eventType = adjustmentType === 'MISSING_CHECK_IN' ? 'CHECK_IN' : 'CHECK_OUT';
  return RawAttendanceEvent.findOne({
    userId,
    eventType,
    isValid: true,
    occurredAt: {
      $gte: new Date(requestedAt.getTime() - toleranceMs),
      $lte: new Date(requestedAt.getTime() + toleranceMs)
    },
    ...tenantFilter
  }).session(session || null);
};

const ensureNoDuplicateDeviceEvent = async (payload, userId, tenantFilter = {}, session) => {
  const duplicate = await findDuplicateDeviceEvent({
    userId,
    adjustmentType: payload.adjustmentType,
    requestedAt: payload.requestedAt,
    tenantFilter,
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

const createDraft = async (user, input, context = null, outerSession = null) => {
  const scope = resolveTenantScope(user, context);
  const payload = normalizePayload(input);

  const operation = async (session) => {
    // 1. Re-verify actor inside transaction session
    const currentActor = await User.findOne({
      _id: user._id,
      role: { $in: ADJUSTMENT_ROLES },
      status: 'active',
      ...scope.filter
    }, null, { session });
    if (!currentActor) {
      throw new TimekeepingError('Tài khoản thực hiện không còn quyền hoặc đã bị khóa/hạ quyền', 403, 'FORBIDDEN');
    }

    // 2. Check duplicate active draft/pending
    const existingActive = await TimekeepingCorrectionRequest.findOne({
      userId: currentActor._id,
      workDate: payload.workDateStart,
      adjustmentType: payload.adjustmentType,
      isActive: true,
      ...scope.filter
    }).session(session);
    if (existingActive) {
      throw new TimekeepingError('Đã tồn tại phiếu điều chỉnh cùng loại cho ngày công này', 409, 'DUPLICATE_ADJUSTMENT');
    }

    // 3. Create draft
    const [document] = await TimekeepingCorrectionRequest.create([{
      tenantId: scope.tenantId || null,
      userId: currentActor._id,
      employeeName: employeeName(currentActor),
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
    }], { session });

    // 4. Write audit within session
    await writeAudit(document, {
      actorId: currentActor._id,
      action: 'ADJUSTMENT_DRAFT_CREATED',
      entity: 'TimekeepingCorrectionRequest',
      entityId: document._id,
      oldValue: null,
      newValue: document.toObject(),
      reason: payload.reason,
      tenantId: scope.tenantId || null,
      session
    });

    return document;
  };

  if (outerSession) return operation(outerSession);
  return withTransaction(operation);
};

const updateDraft = async (user, adjustmentId, input, context = null, outerSession = null) => {
  const scope = resolveTenantScope(user, context);

  const operation = async (session) => {
    // 1. Re-verify actor inside transaction session
    const currentActor = await User.findOne({
      _id: user._id,
      role: { $in: ADJUSTMENT_ROLES },
      status: 'active',
      ...scope.filter
    }, null, { session });
    if (!currentActor) {
      throw new TimekeepingError('Tài khoản thực hiện không còn quyền hoặc đã bị khóa/hạ quyền', 403, 'FORBIDDEN');
    }

    const existing = await TimekeepingCorrectionRequest.findOne({
      _id: adjustmentId,
      userId: currentActor._id,
      status: { $in: ['DRAFT', 'PENDING'] },
      ...scope.filter
    }).session(session);
    if (!existing) throw new TimekeepingError('Không tìm thấy phiếu có thể sửa', 404, 'ADJUSTMENT_NOT_EDITABLE');
    if (Number(input.version) !== existing.version) {
      throw new TimekeepingError('Phiếu đã thay đổi, vui lòng tải lại', 409, 'VERSION_CONFLICT');
    }

    const payload = normalizePayload({ ...existing.toObject(), ...input }, existing.timezone);
    const updated = await TimekeepingCorrectionRequest.findOneAndUpdate(
      { _id: existing._id, status: existing.status, version: existing.version, ...scope.filter },
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
      { new: true, runValidators: true, session }
    );
    if (!updated) throw new TimekeepingError('Phiếu đã thay đổi, vui lòng tải lại', 409, 'VERSION_CONFLICT');

    await writeAudit(updated, {
      actorId: currentActor._id,
      action: 'ADJUSTMENT_UPDATED',
      entity: 'TimekeepingCorrectionRequest',
      entityId: updated._id,
      oldValue: existing.toObject(),
      newValue: updated.toObject(),
      reason: payload.reason,
      tenantId: scope.tenantId || null,
      session
    });
    return updated;
  };

  if (outerSession) return operation(outerSession);
  return withTransaction(operation);
};

const submitDraft = async (user, adjustmentId, expectedVersion, context = null, outerSession = null) => {
  const scope = resolveTenantScope(user, context);

  const operation = async (session) => {
    // 1. Re-verify actor inside transaction session
    const currentActor = await User.findOne({
      _id: user._id,
      role: { $in: ADJUSTMENT_ROLES },
      status: 'active',
      ...scope.filter
    }, null, { session });
    if (!currentActor) {
      throw new TimekeepingError('Tài khoản thực hiện không còn quyền hoặc đã bị khóa/hạ quyền', 403, 'FORBIDDEN');
    }

    const draft = await TimekeepingCorrectionRequest.findOne({
      _id: adjustmentId,
      userId: currentActor._id,
      status: 'DRAFT',
      ...scope.filter
    }).session(session);
    if (!draft) throw new TimekeepingError('Không tìm thấy phiếu nháp để gửi', 404, 'ADJUSTMENT_NOT_SUBMITTABLE');
    if (Number(expectedVersion) !== draft.version) {
      throw new TimekeepingError('Phiếu đã thay đổi, vui lòng tải lại', 409, 'VERSION_CONFLICT');
    }

    await ensureNoDuplicateDeviceEvent({
      adjustmentType: draft.adjustmentType,
      requestedAt: draft.requestedAt
    }, currentActor._id, scope.filter, session);

    const submitted = await TimekeepingCorrectionRequest.findOneAndUpdate(
      { _id: draft._id, status: 'DRAFT', version: draft.version, ...scope.filter },
      { $set: { status: 'PENDING', submittedAt: new Date() }, $inc: { version: 1 } },
      { new: true, session }
    );
    if (!submitted) throw new TimekeepingError('Phiếu đã thay đổi, vui lòng tải lại', 409, 'VERSION_CONFLICT');

    await writeAudit(submitted, {
      actorId: currentActor._id,
      action: 'ADJUSTMENT_SUBMITTED',
      entity: 'TimekeepingCorrectionRequest',
      entityId: submitted._id,
      oldValue: draft.toObject(),
      newValue: submitted.toObject(),
      reason: submitted.reason,
      tenantId: scope.tenantId || null,
      session
    });
    return submitted;
  };

  if (outerSession) return operation(outerSession);
  return withTransaction(operation);
};

const cancelAdjustment = async (user, adjustmentId, expectedVersion, cancelReason = '', context = null, outerSession = null) => {
  const scope = resolveTenantScope(user, context);

  const operation = async (session) => {
    // 1. Re-verify actor inside transaction session
    const currentActor = await User.findOne({
      _id: user._id,
      role: { $in: EMPLOYEE_ROLES },
      status: 'active',
      ...scope.filter
    }, null, { session });
    if (!currentActor) {
      throw new TimekeepingError('Tài khoản thực hiện không còn quyền hoặc đã bị khóa/hạ quyền', 403, 'FORBIDDEN');
    }

    const adjustment = await TimekeepingCorrectionRequest.findOne({
      _id: adjustmentId,
      userId: currentActor._id,
      status: { $in: ['DRAFT', 'PENDING'] },
      ...scope.filter
    }).session(session);
    if (!adjustment) throw new TimekeepingError('Phiếu không thể hủy', 404, 'ADJUSTMENT_NOT_CANCELLABLE');
    if (Number(expectedVersion) !== adjustment.version) {
      throw new TimekeepingError('Phiếu đã thay đổi, vui lòng tải lại', 409, 'VERSION_CONFLICT');
    }

    const cancelled = await TimekeepingCorrectionRequest.findOneAndUpdate(
      { _id: adjustment._id, status: adjustment.status, version: adjustment.version, ...scope.filter },
      {
        $set: { status: 'CANCELLED', isActive: false, cancelledAt: new Date(), cancelReason: cancelReason.trim() },
        $inc: { version: 1 }
      },
      { new: true, session }
    );
    if (!cancelled) throw new TimekeepingError('Phiếu đã thay đổi, vui lòng tải lại', 409, 'VERSION_CONFLICT');

    await writeAudit(cancelled, {
      actorId: currentActor._id,
      action: 'ADJUSTMENT_CANCELLED',
      entity: 'TimekeepingCorrectionRequest',
      entityId: cancelled._id,
      oldValue: adjustment.toObject(),
      newValue: cancelled.toObject(),
      reason: cancelReason,
      tenantId: scope.tenantId || null,
      session
    });
    return cancelled;
  };

  if (outerSession) return operation(outerSession);
  return withTransaction(operation);
};

const queueRecalculation = async ({ userId, workDate, reason, tenantId = null, tenantFilter = {}, session }) => {
  const now = new Date();
  const query = { userId, workDate, ...tenantFilter };
  return AttendanceRecalculationQueue.findOneAndUpdate(
    query,
    {
      $set: {
        tenantId: tenantId || null,
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

const approveAdjustment = async (admin, adjustmentId, expectedVersion, reviewNote = '', context = null) => {
  const scope = resolveTenantScope(admin, context);
  return withTransaction(async (session) => {
    // 1. Re-verify reviewer actor inside transaction session
    const currentActor = await User.findOne({
      _id: admin._id,
      role: { $in: ['admin', 'principal'] },
      status: 'active',
      ...scope.filter
    }, null, { session });
    if (!currentActor) {
      throw new TimekeepingError('Tài khoản thực hiện không còn quyền hoặc đã bị khóa/hạ quyền', 403, 'FORBIDDEN');
    }

    const pending = await TimekeepingCorrectionRequest.findOne({
      _id: adjustmentId,
      ...scope.filter
    }).session(session);
    if (!pending) throw new TimekeepingError('Không tìm thấy phiếu điều chỉnh', 404, 'ADJUSTMENT_NOT_FOUND');
    if (pending.status !== 'PENDING') {
      throw new TimekeepingError('Phiếu đã được xử lý', 409, 'ADJUSTMENT_ALREADY_PROCESSED');
    }
    if (Number(expectedVersion) !== pending.version) {
      throw new TimekeepingError('Phiếu đã thay đổi, vui lòng tải lại', 409, 'VERSION_CONFLICT');
    }

    // 2. Prevent self-approval
    if (String(pending.userId) === String(currentActor._id)) {
      throw new TimekeepingError('Không thể tự phê duyệt phiếu điều chỉnh của chính mình', 403, 'SELF_APPROVAL_FORBIDDEN');
    }

    // 3. Verify request owner (pending.userId) is active and belongs to the same tenant
    const requestOwner = await User.findOne({
      _id: pending.userId,
      status: 'active',
      ...scope.filter
    }, null, { session });
    if (!requestOwner) {
      throw new TimekeepingError('Người gửi yêu cầu điều chỉnh không tồn tại, đã bị vô hiệu hóa hoặc không thuộc trường', 403, 'INVALID_OWNER');
    }

    // 4. Verify associated Employee (if exists) is also active and belongs to the same tenant
    const employee = await Employee.findOne({ userId: pending.userId }, null, { session });
    if (employee) {
      if (scope.tenantId && (!employee.tenantId || String(employee.tenantId) !== String(scope.tenantId))) {
        throw new TimekeepingError('Hồ sơ nhân viên của người gửi không thuộc trường này', 403, 'INVALID_OWNER');
      }
      if (!scope.tenantId && employee.tenantId !== null && employee.tenantId !== undefined) {
        throw new TimekeepingError('Hồ sơ nhân viên của người gửi không hợp lệ', 403, 'INVALID_OWNER');
      }
      if (employee.status !== 'active') {
        throw new TimekeepingError('Hồ sơ nhân viên của người gửi đã bị vô hiệu hóa', 403, 'INVALID_OWNER');
      }
    }

    await ensureNoDuplicateDeviceEvent({
      adjustmentType: pending.adjustmentType,
      requestedAt: pending.requestedAt
    }, pending.userId, scope.filter, session);

    const approved = await TimekeepingCorrectionRequest.findOneAndUpdate(
      { _id: pending._id, status: 'PENDING', version: pending.version, ...scope.filter },
      {
        $set: {
          status: 'APPROVED',
          reviewedBy: currentActor._id,
          reviewedAt: new Date(),
          reviewNote: reviewNote.trim() || null,
          approvedBy: currentActor._id,
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
      tenantId: approved.tenantId || scope.tenantId || null,
      tenantFilter: scope.filter,
      session
    });

    await OutboxEvent.create([{
      tenantId: approved.tenantId || scope.tenantId || null,
      type: 'ATTENDANCE_RECALCULATION_REQUESTED',
      payload: {
        tenantId: approved.tenantId || scope.tenantId || null,
        userId: approved.userId,
        workDate: approved.workDate,
        adjustmentId: approved._id
      }
    }], { session });

    await writeAudit(approved, {
      actorId: currentActor._id,
      action: 'CORRECTION_APPROVED',
      entity: 'TimekeepingCorrectionRequest',
      entityId: approved._id,
      oldValue: pending.toObject(),
      newValue: approved.toObject(),
      reason: reviewNote,
      tenantId: approved.tenantId || scope.tenantId || null,
      session
    });

    return approved;
  });
};

const rejectAdjustment = async (admin, adjustmentId, expectedVersion, reviewNote, context = null) => {
  if (!reviewNote?.trim()) throw new TimekeepingError('Bắt buộc nhập ghi chú khi từ chối');
  const scope = resolveTenantScope(admin, context);
  return withTransaction(async (session) => {
    // 1. Re-verify reviewer actor inside transaction session
    const currentActor = await User.findOne({
      _id: admin._id,
      role: { $in: ['admin', 'principal'] },
      status: 'active',
      ...scope.filter
    }, null, { session });
    if (!currentActor) {
      throw new TimekeepingError('Tài khoản thực hiện không còn quyền hoặc đã bị khóa/hạ quyền', 403, 'FORBIDDEN');
    }

    const pending = await TimekeepingCorrectionRequest.findOne({
      _id: adjustmentId,
      ...scope.filter
    }).session(session);
    if (!pending) throw new TimekeepingError('Không tìm thấy phiếu điều chỉnh', 404, 'ADJUSTMENT_NOT_FOUND');
    if (pending.status !== 'PENDING') throw new TimekeepingError('Phiếu đã được xử lý', 409, 'ADJUSTMENT_ALREADY_PROCESSED');
    if (Number(expectedVersion) !== pending.version) throw new TimekeepingError('Phiếu đã thay đổi, vui lòng tải lại', 409, 'VERSION_CONFLICT');

    // 2. Prevent self-rejection of own request
    if (String(pending.userId) === String(currentActor._id)) {
      throw new TimekeepingError('Không thể tự từ chối phiếu điều chỉnh của chính mình', 403, 'SELF_REJECTION_FORBIDDEN');
    }

    // 3. Verify request owner (pending.userId) is active and belongs to the same tenant
    const requestOwner = await User.findOne({
      _id: pending.userId,
      status: 'active',
      ...scope.filter
    }, null, { session });
    if (!requestOwner) {
      throw new TimekeepingError('Người gửi yêu cầu điều chỉnh không tồn tại, đã bị vô hiệu hóa hoặc không thuộc trường', 403, 'INVALID_OWNER');
    }

    // 4. Verify associated Employee (if exists) is also active and belongs to the same tenant
    const employee = await Employee.findOne({ userId: pending.userId }, null, { session });
    if (employee) {
      if (scope.tenantId && (!employee.tenantId || String(employee.tenantId) !== String(scope.tenantId))) {
        throw new TimekeepingError('Hồ sơ nhân viên của người gửi không thuộc trường này', 403, 'INVALID_OWNER');
      }
      if (!scope.tenantId && employee.tenantId !== null && employee.tenantId !== undefined) {
        throw new TimekeepingError('Hồ sơ nhân viên của người gửi không hợp lệ', 403, 'INVALID_OWNER');
      }
      if (employee.status !== 'active') {
        throw new TimekeepingError('Hồ sơ nhân viên của người gửi đã bị vô hiệu hóa', 403, 'INVALID_OWNER');
      }
    }

    const rejected = await TimekeepingCorrectionRequest.findOneAndUpdate(
      { _id: pending._id, status: 'PENDING', version: pending.version, ...scope.filter },
      {
        $set: {
          status: 'REJECTED',
          isActive: false,
          reviewedBy: currentActor._id,
          reviewedAt: new Date(),
          reviewNote: reviewNote.trim(),
          approvedBy: currentActor._id,
          approvedAt: new Date(),
          rejectionReason: reviewNote.trim()
        },
        $inc: { version: 1 }
      },
      { new: true, session }
    );
    if (!rejected) throw new TimekeepingError('Phiếu đã được xử lý', 409, 'VERSION_CONFLICT');

    await writeAudit(rejected, {
      actorId: currentActor._id,
      action: 'CORRECTION_REJECTED',
      entity: 'TimekeepingCorrectionRequest',
      entityId: rejected._id,
      oldValue: pending.toObject(),
      newValue: rejected.toObject(),
      reason: reviewNote,
      tenantId: rejected.tenantId || scope.tenantId || null,
      session
    });
    return rejected;
  });
};

const createAndSubmitLegacy = async (user, input, context = null) => {
  return withTransaction(async (session) => {
    const draft = await createDraft(user, input, context, session);
    return submitDraft(user, draft._id, draft.version, context, session);
  });
};

module.exports = {
  ADJUSTMENT_ROLES,
  EMPLOYEE_ROLES,
  TimekeepingError,
  approveAdjustment,
  cancelAdjustment,
  createAndSubmitLegacy,
  createDraft,
  employeeName,
  normalizePayload,
  queueRecalculation,
  rejectAdjustment,
  resolveTenantScope,
  submitDraft,
  updateDraft,
  withTransaction
};
