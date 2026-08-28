const User = require('../models/zone1_system/User');
const AttendanceAuditLog = require('../models/zone2_hr/AttendanceAuditLog');
const RawAttendanceEvent = require('../models/zone2_hr/RawAttendanceEvent');
const OutboxEvent = require('../models/zone1_system/OutboxEvent');
const { queueRecalculation, withTransaction, TimekeepingError } = require('./attendanceAdjustmentService');
const {
  DEFAULT_SCHOOL_TIMEZONE,
  getWorkDate,
  isValidWorkDate,
  startOfWorkDate
} = require('../utils/dateHelpers');

const ingestDeviceEvent = async (input) => {
  const { deviceId, externalEventId, userId, eventType, occurredAt, rawPayload = {} } = input;
  const source = input.source || 'DEVICE';
  if (!deviceId || !externalEventId || !userId || !['CHECK_IN', 'CHECK_OUT'].includes(eventType)) {
    throw new TimekeepingError('Thiếu hoặc sai dữ liệu log máy chấm công');
  }
  if (!['DEVICE', 'CARD', 'FACE', 'MANUAL_CODE'].includes(source)) {
    throw new TimekeepingError('Nguồn chấm công không hợp lệ');
  }
  const occurredAtDate = new Date(occurredAt);
  if (Number.isNaN(occurredAtDate.getTime())) {
    throw new TimekeepingError('occurredAt không hợp lệ');
  }
  if (input.workDate && !isValidWorkDate(input.workDate)) {
    throw new TimekeepingError('workDate phải có định dạng YYYY-MM-DD');
  }
  const workDate = startOfWorkDate(
    input.workDate || getWorkDate(occurredAtDate, DEFAULT_SCHOOL_TIMEZONE),
    DEFAULT_SCHOOL_TIMEZONE
  );

  const existing = await RawAttendanceEvent.findOne({ deviceId, externalEventId });
  if (existing) return { event: existing, duplicate: true };

  try {
    return await withTransaction(async (session) => {
      const user = await User.findOne({ _id: userId, status: 'active' }).session(session);
      if (!user) throw new TimekeepingError('Không tìm thấy nhân viên đang hoạt động', 404, 'EMPLOYEE_NOT_FOUND');

      const [event] = await RawAttendanceEvent.create([{
        deviceId,
        externalEventId,
        userId: user._id,
        employeeName: user.profile?.fullName || user.username,
        workDate,
        eventType,
        source,
        occurredAt: occurredAtDate,
        timezone: DEFAULT_SCHOOL_TIMEZONE,
        rawPayload
      }], { session });
      await queueRecalculation({ userId: user._id, workDate, reason: 'DEVICE_EVENT_RECEIVED', session });
      await OutboxEvent.create([{
        type: 'ATTENDANCE_RECALCULATION_REQUESTED',
        payload: { userId: user._id, workDate, rawEventId: event._id }
      }], { session });
      await AttendanceAuditLog.create([{
        actor: null,
        action: 'RAW_ATTENDANCE_INGESTED',
        entity: 'RawAttendanceEvent',
        entityId: event._id,
        oldValue: null,
        newValue: event.toObject(),
        reason: 'Device event received',
        timestamp: new Date()
      }], { session });
      return { event, duplicate: false };
    });
  } catch (error) {
    if (error?.code === 11000) {
      const event = await RawAttendanceEvent.findOne({ deviceId, externalEventId });
      return { event, duplicate: true };
    }
    throw error;
  }
};

const kioskCheckInByIdentifier = async (actor, identifier) => {
  const code = String(identifier || '').trim().toUpperCase();
  if (!code) throw new TimekeepingError('Vui lòng nhập mã nhân viên');
  if (code.length > 50) throw new TimekeepingError('Mã nhân viên không hợp lệ');

  let employee = await User.findOne({
    status: 'active',
    'employeeInfo.employeeId': code
  });
  if (!employee) {
    employee = await User.findOne({ status: 'active', username: String(identifier).trim() });
  }
  if (!employee) throw new TimekeepingError('Không tìm thấy nhân viên có mã này', 404, 'EMPLOYEE_NOT_FOUND');

  const operatorRoles = ['admin', 'principal', 'guard'];
  if (!operatorRoles.includes(actor.role) && employee._id.toString() !== actor._id.toString()) {
    throw new TimekeepingError('Bạn chỉ có thể chấm công bằng mã của chính mình', 403, 'KIOSK_FORBIDDEN');
  }

  const now = new Date();
  const workDateLabel = getWorkDate(now, DEFAULT_SCHOOL_TIMEZONE);
  const workDate = startOfWorkDate(workDateLabel, DEFAULT_SCHOOL_TIMEZONE);
  const existing = await RawAttendanceEvent.findOne({
    userId: employee._id,
    workDate,
    eventType: 'CHECK_IN',
    isValid: true
  });
  if (existing) {
    return {
      event: existing,
      duplicate: true,
      employee: { id: employee._id, name: employee.profile?.fullName || employee.username, employeeId: employee.employeeInfo?.employeeId || employee.username }
    };
  }

  const result = await ingestDeviceEvent({
    deviceId: 'WEB_KIOSK',
    externalEventId: `WEB_KIOSK-${employee._id}-${workDateLabel}-CHECK_IN`,
    userId: employee._id,
    eventType: 'CHECK_IN',
    source: 'MANUAL_CODE',
    occurredAt: now,
    workDate: workDateLabel,
    rawPayload: { channel: 'WEB_KIOSK', enteredIdentifier: code }
  });

  return {
    ...result,
    employee: { id: employee._id, name: employee.profile?.fullName || employee.username, employeeId: employee.employeeInfo?.employeeId || employee.username }
  };
};

module.exports = { ingestDeviceEvent, kioskCheckInByIdentifier };
