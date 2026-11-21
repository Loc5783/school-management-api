'use strict';

const mongoose = require('mongoose');
const User = require('../models/zone1_system/User');
const AttendanceAuditLog = require('../models/zone2_hr/AttendanceAuditLog');
const RawAttendanceEvent = require('../models/zone2_hr/RawAttendanceEvent');
const Employee = require('../models/zone2_hr/Employee');
const StaffShift = require('../models/zone2_hr/StaffShift');
const Student = require('../models/zone3_school/Student');
const StudentAttendance = require('../models/zone3_school/StudentAttendance');
const AttendanceDevicePersonMapping = require('../models/zone2_hr/AttendanceDevicePersonMapping');
const OutboxEvent = require('../models/zone1_system/OutboxEvent');
const { queueRecalculation, withTransaction, TimekeepingError } = require('./attendanceAdjustmentService');
const {
  DEFAULT_SCHOOL_TIMEZONE,
  addWorkDays,
  createDateTime,
  getWorkDate,
  isValidWorkDate,
  startOfWorkDate
} = require('../utils/dateHelpers');

/**
 * Ingests a raw device event into the system. Supports both Employee and Student events,
 * unmapped events, and PUNCH / CHECK_IN / CHECK_OUT types with multi-tenant safety.
 */
const ingestDeviceEvent = async (input) => {
  const {
    deviceId,
    externalEventId,
    tenantId,
    externalPersonId,
    occurredAt,
    rawPayload = {}
  } = input;

  const eventType = input.eventType || 'PUNCH';
  const source = input.source || 'DEVICE';
  let userId = input.userId || null;
  let studentId = input.studentId || null;
  let subjectType = input.subjectType || (studentId ? 'STUDENT' : (userId ? 'EMPLOYEE' : null));
  let mappingStatus = input.mappingStatus || (userId || studentId ? 'MAPPED' : 'UNMAPPED');

  // If not explicitly provided with userId/studentId, try resolving via AttendanceDevicePersonMapping
  if (!userId && !studentId && externalPersonId && tenantId) {
    const mapping = await AttendanceDevicePersonMapping.findOne({
      tenantId,
      externalPersonId: String(externalPersonId).trim(),
      active: true
    });
    if (mapping) {
      if (mapping.subjectType === 'STUDENT') {
        studentId = mapping.subjectId || mapping.studentId;
        subjectType = 'STUDENT';
      } else {
        userId = mapping.subjectId || mapping.userId;
        subjectType = 'EMPLOYEE';
      }
      mappingStatus = 'MAPPED';
      AttendanceDevicePersonMapping.updateOne({ _id: mapping._id }, { $set: { lastMatchedAt: new Date() } }).exec().catch(() => {});
    }
  }

  if (!subjectType) {
    subjectType = studentId ? 'STUDENT' : (userId ? 'EMPLOYEE' : 'UNKNOWN');
  }

  const authenticationMethod = input.authenticationMethod || (source === 'FACE' ? 'FACE' : (source === 'CARD' ? 'CARD' : 'UNKNOWN'));
  const vendorEventCode = input.vendorEventCode || null;
  const syncBatchId = input.syncBatchId || null;

  if (!deviceId || !externalEventId) {
    throw new TimekeepingError('Thiếu deviceId hoặc externalEventId của máy chấm công');
  }
  if (!['CHECK_IN', 'CHECK_OUT', 'PUNCH'].includes(eventType)) {
    throw new TimekeepingError('eventType phải là CHECK_IN, CHECK_OUT hoặc PUNCH');
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

  const timezone = input.timezone || DEFAULT_SCHOOL_TIMEZONE;
  const workDate = startOfWorkDate(
    input.workDate || getWorkDate(occurredAtDate, timezone),
    timezone
  );

  // Idempotency check: Look up existing event by deviceId + externalEventId + tenantId
  const query = { deviceId, externalEventId };
  if (tenantId) {
    query.tenantId = tenantId;
  }
  const existing = await RawAttendanceEvent.findOne(query);
  if (existing) {
    return { event: existing, duplicate: true };
  }

  try {
    return await withTransaction(async (session) => {
      // Branch 1: Unmapped event (stored safely without failing transaction, for admin review)
      if (mappingStatus === 'UNMAPPED' || (!userId && !studentId)) {
        const [event] = await RawAttendanceEvent.create([{
          tenantId: tenantId || null,
          deviceId,
          externalEventId,
          externalPersonId: externalPersonId || null,
          mappingStatus: 'UNMAPPED',
          subjectType: 'UNKNOWN',
          userId: null,
          studentId: null,
          employeeName: input.employeeName || 'Chưa ánh xạ',
          workDate,
          eventType,
          source,
          authenticationMethod,
          vendorEventCode,
          syncBatchId,
          occurredAt: occurredAtDate,
          timezone,
          rawPayload
        }], { session });

        await AttendanceAuditLog.create([{
          actor: null,
          action: 'RAW_ATTENDANCE_INGESTED',
          entity: 'RawAttendanceEvent',
          entityId: event._id,
          oldValue: null,
          newValue: event.toObject(),
          reason: 'Unmapped device event received',
          timestamp: new Date()
        }], { session });

        return { event, duplicate: false, unmapped: true };
      }

      // Branch 2: Student event
      if (subjectType === 'STUDENT' || studentId) {
        const studentQuery = { _id: studentId };
        if (tenantId) studentQuery.tenantId = tenantId;

        const student = await Student.findOne(studentQuery).session(session);
        if (!student) {
          throw new TimekeepingError('Không tìm thấy học sinh trong phạm vi trường', 404, 'STUDENT_NOT_FOUND');
        }

        const [event] = await RawAttendanceEvent.create([{
          tenantId: tenantId || student.tenantId || null,
          deviceId,
          externalEventId,
          externalPersonId: externalPersonId || null,
          mappingStatus: 'MAPPED',
          subjectType: 'STUDENT',
          studentId: student._id,
          userId: null,
          employeeName: student.fullName,
          workDate,
          eventType,
          source,
          authenticationMethod,
          vendorEventCode,
          syncBatchId,
          occurredAt: occurredAtDate,
          timezone,
          rawPayload
        }], { session });

        // Upsert student daily attendance
        await ingestStudentDeviceAttendance({
          tenantId: tenantId || student.tenantId,
          student,
          occurredAtDate,
          source,
          workDate,
          deviceId,
          session
        });

        await AttendanceAuditLog.create([{
          tenantId: tenantId || student.tenantId || null,
          actor: null,
          action: 'RAW_ATTENDANCE_INGESTED',
          entity: 'RawAttendanceEvent',
          entityId: event._id,
          oldValue: null,
          newValue: event.toObject(),
          reason: 'Student device attendance ingested',
          timestamp: new Date()
        }], { session });

        return { event, duplicate: false, student };
      }

      // Branch 3: Employee / User event (default)
      const userQuery = { _id: userId, status: 'active' };
      if (tenantId) userQuery.tenantId = tenantId;

      const user = await User.findOne(userQuery).session(session);
      if (!user) {
        throw new TimekeepingError('Không tìm thấy nhân viên đang hoạt động trong phạm vi trường', 404, 'EMPLOYEE_NOT_FOUND');
      }

      const [event] = await RawAttendanceEvent.create([{
        tenantId: tenantId || user.tenantId || null,
        deviceId,
        externalEventId,
        externalPersonId: externalPersonId || null,
        mappingStatus: 'MAPPED',
        subjectType: 'EMPLOYEE',
        userId: user._id,
        studentId: null,
        employeeName: user.profile?.fullName || user.username,
        workDate,
        eventType,
        source,
        authenticationMethod,
        vendorEventCode,
        syncBatchId,
        occurredAt: occurredAtDate,
        timezone,
        rawPayload
      }], { session });

      const resolvedTenantId = tenantId || user.tenantId || null;
      await queueRecalculation({
        userId: user._id,
        workDate,
        reason: 'DEVICE_EVENT_RECEIVED',
        tenantId: resolvedTenantId,
        tenantFilter: resolvedTenantId ? { tenantId: resolvedTenantId } : { tenantId: null },
        session
      });

      await OutboxEvent.create([{
        tenantId: resolvedTenantId,
        type: 'ATTENDANCE_RECALCULATION_REQUESTED',
        payload: { tenantId: resolvedTenantId, userId: user._id, workDate, rawEventId: event._id }
      }], { session });

      await AttendanceAuditLog.create([{
        tenantId: resolvedTenantId,
        actor: null,
        action: 'RAW_ATTENDANCE_INGESTED',
        entity: 'RawAttendanceEvent',
        entityId: event._id,
        oldValue: null,
        newValue: event.toObject(),
        reason: 'Employee device event received',
        timestamp: new Date()
      }], { session });

      return { event, duplicate: false, user };
    });
  } catch (error) {
    if (error?.code === 11000) {
      const event = await RawAttendanceEvent.findOne(query);
      return { event, duplicate: true };
    }
    throw error;
  }
};

/**
 * Upserts a StudentAttendance record from a device punch.
 * Strict idempotency: multiple scans on the same date will not create multiple attendance records.
 */
async function ingestStudentDeviceAttendance({ tenantId, student, occurredAtDate, source, workDate, deviceId, session }) {
  const timezone = DEFAULT_SCHOOL_TIMEZONE;
  const attendanceDateKey = getWorkDate(occurredAtDate, timezone);
  const attendDate = startOfWorkDate(attendanceDateKey, timezone);

  const query = {
    studentId: student._id,
    attendDate
  };
  if (tenantId) query.tenantId = tenantId;

  let existing = await StudentAttendance.findOne(query).session(session);

  if (!existing) {
    // Look up an admin user to act as recordedBy
    let recordAdmin = await User.findOne({
      ...(tenantId ? { tenantId } : {}),
      role: 'admin',
      status: 'active'
    }).session(session);

    if (!recordAdmin) {
      recordAdmin = await User.findOne({
        ...(tenantId ? { tenantId } : {}),
        status: 'active'
      }).session(session);
    }

    const recordedById = recordAdmin ? recordAdmin._id : student._id;
    const recordedByName = 'Máy chấm công Hikvision';

    const attendanceMethod = source === 'FACE' ? 'face' : (source === 'CARD' ? 'card' : 'manual');

    await StudentAttendance.create([{
      tenantId: tenantId || student.tenantId || null,
      studentId: student._id,
      studentName: student.fullName,
      classroomId: student.classroomId,
      className: student.className || 'Chưa xếp lớp',
      attendDate,
      attendanceDateKey,
      status: 'present',
      checkInTime: occurredAtDate,
      attendanceMethod,
      recordedBy: recordedById,
      recordedByName,
      note: `Quét lúc ${occurredAtDate.toLocaleTimeString('vi-VN')} qua ${deviceId}`
    }], { session });
  } else {
    // If existing record has checkInTime and current scan is later, record checkOutTime
    if (existing.checkInTime && occurredAtDate > existing.checkInTime) {
      if (!existing.checkOutTime || occurredAtDate > existing.checkOutTime) {
        existing.checkOutTime = occurredAtDate;
        await existing.save({ session });
      }
    }
  }
}

/**
 * Web Kiosk manual code / username check-in.
 */
const kioskCheckInByIdentifier = async (actor, identifier, eventType = 'CHECK_IN') => {
  if (!['CHECK_IN', 'CHECK_OUT'].includes(eventType)) throw new TimekeepingError('Loại chấm công không hợp lệ');
  const code = String(identifier || '').trim().toUpperCase();
  if (!code) throw new TimekeepingError('Vui lòng nhập mã nhân viên');
  if (code.length > 50) throw new TimekeepingError('Mã nhân viên không hợp lệ');

  const tenantFilter = actor.tenantId ? { tenantId: actor.tenantId } : {};

  let employee = await User.findOne({
    status: 'active',
    'employeeInfo.employeeId': code,
    ...tenantFilter
  });
  if (!employee) {
    employee = await User.findOne({
      status: 'active',
      username: String(identifier).trim(),
      ...tenantFilter
    });
  }
  if (!employee) throw new TimekeepingError('Không tìm thấy nhân viên có mã này', 404, 'EMPLOYEE_NOT_FOUND');

  const operatorRoles = ['admin', 'principal', 'guard'];
  if (!operatorRoles.includes(actor.role) && employee._id.toString() !== actor._id.toString()) {
    throw new TimekeepingError('Bạn chỉ có thể chấm công bằng mã của chính mình', 403, 'KIOSK_FORBIDDEN');
  }

  const now = new Date();
  let workDateLabel = getWorkDate(now, DEFAULT_SCHOOL_TIMEZONE);
  let workDate = startOfWorkDate(workDateLabel, DEFAULT_SCHOOL_TIMEZONE);
  let checkIn = await RawAttendanceEvent.findOne({
    userId: employee._id,
    workDate,
    eventType: 'CHECK_IN',
    isValid: true,
    ...tenantFilter
  });

  if (eventType === 'CHECK_OUT' && !checkIn) {
    const previousDate = addWorkDays(workDateLabel, -1);
    const profile = await Employee.findOne({ userId: employee._id, ...tenantFilter }).select('_id');
    const previousWeekday = new Date(`${previousDate}T00:00:00.000Z`).getUTCDay();
    const overnightShift = profile && await StaffShift.findOne({
      employeeId: profile._id,
      status: 'active',
      validFrom: { $lte: previousDate },
      validUntil: { $gte: previousDate },
      weekdays: previousWeekday,
      $expr: { $lt: ['$endTime', '$startTime'] },
      ...tenantFilter
    });
    if (overnightShift) {
      const previousWorkDate = startOfWorkDate(previousDate, DEFAULT_SCHOOL_TIMEZONE);
      const priorCheckIn = await RawAttendanceEvent.findOne({
        userId: employee._id,
        workDate: previousWorkDate,
        eventType: 'CHECK_IN',
        isValid: true,
        ...tenantFilter
      });
      const priorCheckOut = await RawAttendanceEvent.exists({
        userId: employee._id,
        workDate: previousWorkDate,
        eventType: 'CHECK_OUT',
        isValid: true,
        ...tenantFilter
      });
      const shiftEnd = createDateTime(workDateLabel, overnightShift.endTime, DEFAULT_SCHOOL_TIMEZONE);
      if (priorCheckIn && !priorCheckOut && now >= priorCheckIn.occurredAt && now.getTime() <= shiftEnd.getTime() + 12 * 60 * 60 * 1000) {
        workDateLabel = previousDate;
        workDate = previousWorkDate;
        checkIn = priorCheckIn;
      }
    }
  }

  if (eventType === 'CHECK_OUT' && !checkIn) {
    throw new TimekeepingError('Chưa có giờ vào ca hôm nay. Hãy kiểm tra hoặc gửi phiếu bổ sung giờ vào.', 409, 'CHECK_IN_REQUIRED');
  }

  const existing = await RawAttendanceEvent.findOne({
    userId: employee._id,
    workDate,
    eventType,
    isValid: true,
    ...tenantFilter
  });
  if (existing) {
    return {
      event: existing,
      duplicate: true,
      employee: {
        id: employee._id,
        name: employee.profile?.fullName || employee.username,
        employeeId: employee.employeeInfo?.employeeId || employee.username
      }
    };
  }
  if (eventType === 'CHECK_OUT' && new Date() <= checkIn.occurredAt) {
    throw new TimekeepingError('Giờ ra phải sau giờ vào ca', 409, 'INVALID_CHECK_OUT');
  }

  const result = await ingestDeviceEvent({
    deviceId: 'WEB_KIOSK',
    externalEventId: `WEB_KIOSK-${employee._id}-${workDateLabel}-${eventType}`,
    tenantId: employee.tenantId || null,
    userId: employee._id,
    eventType,
    source: 'MANUAL_CODE',
    occurredAt: now,
    workDate: workDateLabel,
    rawPayload: { channel: 'WEB_KIOSK', enteredIdentifier: code }
  });

  return {
    ...result,
    employee: {
      id: employee._id,
      name: employee.profile?.fullName || employee.username,
      employeeId: employee.employeeInfo?.employeeId || employee.username
    }
  };
};

module.exports = {
  ingestDeviceEvent,
  kioskCheckInByIdentifier,
  ingestStudentDeviceAttendance
};
