'use strict';

/**
 * @fileoverview Service xử lý sự kiện chấm công / điểm danh từ thiết bị phần cứng (Hikvision, Kiosk, Thẻ/Khuôn mặt).
 *
 * Quy tắc nghiệp vụ cốt lõi (đã chuẩn hóa cho cả Học sinh & Nhân viên):
 * 1. Định danh người quẹt (`resolvePersonIdentity`):
 *    - Ưu tiên 1: Tra bảng ánh xạ `AttendanceDevicePersonMapping` (`externalPersonId` -> `EMPLOYEE` / `STUDENT`).
 *    - Ưu tiên 2: Tự động dò khớp theo Mã Nhân viên (`employeeInfo.employeeId` / `Employee.employeeCode`)
 *      hoặc Mã Học sinh (`Student.studentCode`, hỗ trợ cả mã viết liền không dấu gạch ngang `HS2026000001`).
 *    - Ưu tiên 3: Nếu chưa khớp ai, lưu vào `RawAttendanceEvent` với `mappingStatus: 'UNMAPPED'` để Admin gán trên Web.
 * 2. Phân biệt Check-in / Check-out & Chống quẹt đúp 5 phút (`DUPLICATE_PUNCH_COOLDOWN_MS = 300000`):
 *    - Lần quẹt đầu tiên trong ngày = Check-in.
 *    - Các lần quẹt lại trong vòng dưới 5 phút kể từ lúc Check-in = Bỏ qua không ghi thành Check-out (chống camera nhận đúp).
 *    - Các lần quẹt từ phút thứ 5 trở đi = Cập nhật Check-out mới nhất.
 * 3. Tính trạng thái Đi muộn:
 *    - Học sinh: Quẹt Check-in sau `08:00` sáng tính là `late`, từ `08:00` trở về trước tính là `present`.
 *    - Nhân viên: Đối chiếu theo `StaffShift` của nhân sự đó (mặc định `08:00` sáng nếu chưa phân ca).
 */

const User = require('../models/zone1_system/User');
const AttendanceAuditLog = require('../models/zone2_hr/AttendanceAuditLog');
const AttendanceRecalculationQueue = require('../models/zone2_hr/AttendanceRecalculationQueue');
const RawAttendanceEvent = require('../models/zone2_hr/RawAttendanceEvent');
const Employee = require('../models/zone2_hr/Employee');
const StaffShift = require('../models/zone2_hr/StaffShift');
const Student = require('../models/zone3_school/Student');
const StudentAttendance = require('../models/zone3_school/StudentAttendance');
const AttendanceDevicePersonMapping = require('../models/zone2_hr/AttendanceDevicePersonMapping');
const OutboxEvent = require('../models/zone1_system/OutboxEvent');
const { queueRecalculation, withTransaction, TimekeepingError } = require('./attendanceAdjustmentService');
const { calculateAttendanceForUserDate } = require('./attendanceCalculationService');
const { normalizePersonCode } = require('./personCodeService');
const { createTrustedTenantContext } = require('./tenantFilterService');
const {
  DEFAULT_SCHOOL_TIMEZONE,
  addWorkDays,
  createDateTime,
  getWorkDate,
  isValidWorkDate,
  startOfWorkDate
} = require('../utils/dateHelpers');

// Hằng số nghiệp vụ chấm công thiết bị
const DUPLICATE_PUNCH_COOLDOWN_MS = Number(process.env.ATTENDANCE_PUNCH_COOLDOWN_MS || 5 * 60 * 1000); // 5 phút
const STUDENT_MORNING_LATE_CUTOFF = '08:00';

/**
 * Chuẩn hóa mã học sinh viết liền trên máy chấm công (VD: `HS2026000001`) sang định dạng chuẩn DB (`HS-2026-000001`).
 *
 * @param {string} rawCode
 * @returns {string | null}
 */
const buildNormalizedStudentCodeVariant = (rawCode) => {
  const compact = String(rawCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const match = /^HS(\d{4})(\d{1,6})$/.exec(compact);
  if (!match) return null;
  return `HS-${match[1]}-${match[2].padStart(6, '0')}`;
};

/**
 * Tra cứu danh tính Học sinh hoặc Nhân viên từ `externalPersonId` trong phạm vi 1 trường (`tenantId`).
 * Kết hợp tuần tự: Bảng ánh xạ thiết bị -> Mã Nhân viên -> Mã Học sinh.
 *
 * @param {object} params
 * @param {import('mongoose').Types.ObjectId | string} params.tenantId
 * @param {string} params.externalPersonId
 * @param {import('mongoose').Types.ObjectId | null} [params.deviceObjectId]
 * @returns {Promise<{ mappingStatus: 'MAPPED'|'UNMAPPED', subjectType: 'EMPLOYEE'|'STUDENT'|'UNKNOWN', userId: any, studentId: any }>}
 */
const resolvePersonIdentity = async ({ tenantId, externalPersonId, deviceObjectId = null }) => {
  const cleanExternalId = String(externalPersonId || '').trim();
  if (!cleanExternalId || !tenantId) {
    return { mappingStatus: 'UNMAPPED', subjectType: 'UNKNOWN', userId: null, studentId: null };
  }

  // Bước 1: Ưu tiên tra bảng ánh xạ cấu hình trên giao diện Quản trị Thiết bị
  const mappingQuery = {
    tenantId,
    externalPersonId: cleanExternalId,
    active: true
  };
  let mapping = deviceObjectId
    ? await AttendanceDevicePersonMapping.findOne({ ...mappingQuery, deviceId: deviceObjectId }).lean()
    : null;
  if (!mapping) {
    mapping = await AttendanceDevicePersonMapping.findOne(mappingQuery).lean();
  }

  if (mapping) {
    AttendanceDevicePersonMapping.updateOne(
      { _id: mapping._id },
      { $set: { lastMatchedAt: new Date() } }
    ).exec().catch(() => {});

    if (mapping.subjectType === 'STUDENT') {
      return {
        mappingStatus: 'MAPPED',
        subjectType: 'STUDENT',
        userId: null,
        studentId: mapping.studentId || mapping.subjectId
      };
    }
    return {
      mappingStatus: 'MAPPED',
      subjectType: 'EMPLOYEE',
      userId: mapping.userId || mapping.subjectId,
      studentId: null
    };
  }

  // Bước 2: Tự động dò theo Mã Nhân viên (`User.employeeInfo.employeeId` hoặc `Employee.employeeCode`)
  const normalizedCode = (() => {
    try { return normalizePersonCode(cleanExternalId); } catch { return cleanExternalId.toUpperCase(); }
  })();
  const codeCandidates = [...new Set([normalizedCode, cleanExternalId.toUpperCase()].filter(Boolean))];

  const matchedUser = await User.findOne({
    tenantId,
    status: 'active',
    'employeeInfo.employeeId': { $in: codeCandidates }
  }).select('_id').lean();

  if (matchedUser) {
    return { mappingStatus: 'MAPPED', subjectType: 'EMPLOYEE', userId: matchedUser._id, studentId: null };
  }

  const matchedEmployee = await Employee.findOne({
    tenantId,
    status: 'active',
    employeeCode: { $in: codeCandidates },
    userId: { $ne: null }
  }).select('userId').lean();

  if (matchedEmployee?.userId) {
    return { mappingStatus: 'MAPPED', subjectType: 'EMPLOYEE', userId: matchedEmployee.userId, studentId: null };
  }

  // Bước 3: Tự động dò theo Mã Học sinh (`Student.studentCode`, hỗ trợ số nguyên '1', '2'... và cả mã cũ)
  const studentCodeCandidates = [...codeCandidates];
  const dashedVariant = buildNormalizedStudentCodeVariant(cleanExternalId);
  if (dashedVariant && !studentCodeCandidates.includes(dashedVariant)) {
    studentCodeCandidates.push(dashedVariant);
  }

  const matchedStudent = await Student.findOne({
    tenantId,
    status: 'enrolled',
    studentCode: { $in: studentCodeCandidates }
  }).select('_id').lean();

  if (matchedStudent) {
    return { mappingStatus: 'MAPPED', subjectType: 'STUDENT', userId: null, studentId: matchedStudent._id };
  }

  // Bước 4: Chưa khớp -> Đưa vào hàng đợi UNMAPPED để Admin gán trên giao diện Web
  return { mappingStatus: 'UNMAPPED', subjectType: 'UNKNOWN', userId: null, studentId: null };
};

/**
 * Ghi nhận sự kiện thô từ máy chấm công và điều phối sang Điểm danh Học sinh hoặc Chấm công Nhân viên.
 *
 * @param {object} input
 * @returns {Promise<object>}
 */
const ingestDeviceEvent = async (input) => {
  const {
    deviceId,
    deviceObjectId = null,
    externalEventId,
    tenantId,
    externalPersonId,
    occurredAt,
    calculateImmediately = false,
    enableMorningLateCheck = false,
    rawPayload = {}
  } = input;

  const eventType = input.eventType || 'PUNCH';
  const source = input.source || 'DEVICE';
  let userId = input.userId || null;
  let studentId = input.studentId || null;
  let subjectType = input.subjectType || (studentId ? 'STUDENT' : (userId ? 'EMPLOYEE' : null));
  let mappingStatus = input.mappingStatus || (userId || studentId ? 'MAPPED' : 'UNMAPPED');

  if (!userId && !studentId && externalPersonId && tenantId) {
    const resolved = await resolvePersonIdentity({ tenantId, externalPersonId, deviceObjectId });
    userId = resolved.userId;
    studentId = resolved.studentId;
    subjectType = resolved.subjectType;
    mappingStatus = resolved.mappingStatus;
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
  const workDateLabel = input.workDate || getWorkDate(occurredAtDate, timezone);
  const workDate = startOfWorkDate(workDateLabel, timezone);

  // Kiểm tra chống trùng lặp sự kiện (Idempotency) theo tenantId + deviceId + externalEventId
  const query = { deviceId, externalEventId };
  if (tenantId) {
    query.tenantId = tenantId;
  }
  const existing = await RawAttendanceEvent.findOne(query);
  if (existing) {
    return { event: existing, duplicate: true, subjectType: existing.subjectType, mappingStatus: existing.mappingStatus };
  }

  let txResult;
  try {
    txResult = await withTransaction(async (session) => {
      // Nhánh 1: Sự kiện chưa ánh xạ được người dùng -> Lưu an toàn vào danh sách UNMAPPED để Admin gán trên Web
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
          tenantId: tenantId || null,
          actor: null,
          action: 'RAW_ATTENDANCE_INGESTED',
          entity: 'RawAttendanceEvent',
          entityId: event._id,
          oldValue: null,
          newValue: event.toObject(),
          reason: 'Unmapped device event received',
          timestamp: new Date()
        }], { session });

        return { event, duplicate: false, unmapped: true, subjectType: 'UNKNOWN', attendanceAction: 'UNMAPPED' };
      }

      // Nhánh 2: Sự kiện của HỌC SINH -> Ghi nhận Check-in / Check-out trực tiếp vào StudentAttendance
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

        const studentAttOutcome = await ingestStudentDeviceAttendance({
          tenantId: tenantId || student.tenantId,
          student,
          occurredAtDate,
          source,
          workDate,
          deviceId,
          enableMorningLateCheck,
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
          reason: `Student device attendance (${studentAttOutcome.attendanceAction})`,
          timestamp: new Date()
        }], { session });

        return {
          event,
          duplicate: false,
          subjectType: 'STUDENT',
          student,
          attendanceAction: studentAttOutcome.attendanceAction,
          attendanceRecord: studentAttOutcome.record
        };
      }

      // Nhánh 3: Sự kiện của NHÂN VIÊN -> Ghi RawAttendanceEvent & đưa vào tính công
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

      return { event, duplicate: false, subjectType: 'EMPLOYEE', user, resolvedTenantId };
    });
  } catch (error) {
    if (error?.code === 11000) {
      const event = await RawAttendanceEvent.findOne(query);
      return { event, duplicate: true, subjectType: event?.subjectType || 'UNKNOWN' };
    }
    throw error;
  }

  // Nếu là sự kiện Webhook thời gian thực của Nhân viên (`calculateImmediately = true`),
  // tính toán cập nhật ngay lập tức bảng `AttendanceRecord` mà không cần chờ cron nền
  if (calculateImmediately && txResult?.subjectType === 'EMPLOYEE' && txResult.user) {
    const trustedContext = txResult.resolvedTenantId
      ? createTrustedTenantContext({ tenantId: txResult.resolvedTenantId })
      : createTrustedTenantContext({ isLegacy: true });

    const attendanceRecord = await calculateAttendanceForUserDate({
      userId: txResult.user._id,
      workDate: workDateLabel,
      calculatedBy: 'queue_worker',
      context: trustedContext
    });

    await AttendanceRecalculationQueue.updateMany(
      {
        userId: txResult.user._id,
        workDate,
        ...(txResult.resolvedTenantId ? { tenantId: txResult.resolvedTenantId } : { tenantId: null })
      },
      { $set: { status: 'DONE', completedAt: new Date(), lockedBy: null, lockedUntil: null, lastError: null } }
    ).catch(() => {});

    let attendanceAction = 'CHECK_IN';
    if (attendanceRecord.checkOutTime) {
      attendanceAction = attendanceRecord.checkOutTime.getTime() === occurredAtDate.getTime()
        ? 'CHECK_OUT'
        : 'UPDATED';
    } else if (
      attendanceRecord.checkInTime &&
      occurredAtDate.getTime() > attendanceRecord.checkInTime.getTime() &&
      occurredAtDate.getTime() - attendanceRecord.checkInTime.getTime() < DUPLICATE_PUNCH_COOLDOWN_MS
    ) {
      attendanceAction = 'COOLDOWN_IGNORED';
    }

    return {
      ...txResult,
      attendanceAction,
      attendanceRecord
    };
  }

  return txResult;
};

/**
 * Cập nhật điểm danh ngày của Học sinh (`StudentAttendance`) từ máy chấm công:
 * - Quẹt lần đầu trong ngày = Check-in (quẹt sau 08:00 sáng tự động đánh dấu `late`, từ 08:00 trở về trước là `present`).
 * - Quẹt lại trong vòng dưới 5 phút kể từ lúc Check-in = Bỏ qua chống quẹt đúp (`COOLDOWN_IGNORED`).
 * - Quẹt từ phút thứ 5 trở đi = Cập nhật Giờ Ra (`checkOutTime` - `CHECK_OUT`).
 */
async function ingestStudentDeviceAttendance({
  tenantId,
  student,
  occurredAtDate,
  source,
  deviceId,
  enableMorningLateCheck = false,
  session
}) {
  const timezone = DEFAULT_SCHOOL_TIMEZONE;
  const attendanceDateKey = getWorkDate(occurredAtDate, timezone);
  const attendDate = startOfWorkDate(attendanceDateKey, timezone);
  const lateCutoff = createDateTime(attendanceDateKey, STUDENT_MORNING_LATE_CUTOFF, timezone);
  const computedMorningStatus = (enableMorningLateCheck && occurredAtDate.getTime() > lateCutoff.getTime())
    ? 'late'
    : 'present';

  const query = {
    studentId: student._id,
    attendDate
  };
  if (tenantId) query.tenantId = tenantId;

  const existing = await StudentAttendance.findOne(query).session(session);
  const attendanceMethod = source === 'FACE' ? 'face' : (source === 'CARD' ? 'card' : 'manual');
  const formattedTime = occurredAtDate.toLocaleTimeString('vi-VN', { timeZone: timezone, hour: '2-digit', minute: '2-digit' });

  // Trường hợp 1: Học sinh chưa có bản ghi điểm danh trong ngày -> Tạo mới Check-in
  if (!existing) {
    let recordAdmin = await User.findOne({
      ...(tenantId ? { tenantId } : {}),
      role: 'admin',
      status: 'active'
    }).select('_id').session(session);

    if (!recordAdmin) {
      recordAdmin = await User.findOne({
        ...(tenantId ? { tenantId } : {}),
        status: 'active'
      }).select('_id').session(session);
    }

    const recordedById = recordAdmin ? recordAdmin._id : student._id;
    const statusLabel = computedMorningStatus === 'late' ? 'Đi muộn (sau 08:00)' : 'Đúng giờ';

    const [created] = await StudentAttendance.create([{
      tenantId: tenantId || student.tenantId || null,
      studentId: student._id,
      studentName: student.fullName,
      classroomId: student.classroomId,
      className: student.className || 'Chưa xếp lớp',
      attendDate,
      attendanceDateKey,
      status: computedMorningStatus,
      checkInTime: occurredAtDate,
      attendanceMethod,
      recordedBy: recordedById,
      recordedByName: 'Máy chấm công Hikvision',
      note: `Check-in lúc ${formattedTime} (${statusLabel}) qua ${deviceId}`
    }], { session });

    return { attendanceAction: 'CHECK_IN', record: created };
  }

  // Trường hợp 2: Đã có bản ghi nhưng chưa có checkInTime (ví dụ giáo viên mới tạo khống trước đó)
  if (!existing.checkInTime) {
    existing.checkInTime = occurredAtDate;
    existing.status = computedMorningStatus;
    existing.attendanceMethod = attendanceMethod;
    await existing.save({ session });
    return { attendanceAction: 'CHECK_IN', record: existing };
  }

  // Trường hợp 3: Máy đẩy bù sự kiện offline có thời gian sớm hơn checkInTime hiện tại
  if (occurredAtDate.getTime() < existing.checkInTime.getTime()) {
    const previousCheckIn = existing.checkInTime;
    existing.checkInTime = occurredAtDate;
    existing.status = computedMorningStatus;
    if (previousCheckIn.getTime() - occurredAtDate.getTime() >= DUPLICATE_PUNCH_COOLDOWN_MS) {
      if (!existing.checkOutTime || previousCheckIn > existing.checkOutTime) {
        existing.checkOutTime = previousCheckIn;
      }
    }
    await existing.save({ session });
    return { attendanceAction: 'CHECK_IN', record: existing };
  }

  // Trường hợp 4: Quẹt tiếp theo trong ngày -> Kiểm tra ngưỡng chống quẹt đúp 5 phút
  const elapsedFromCheckInMs = occurredAtDate.getTime() - existing.checkInTime.getTime();
  if (elapsedFromCheckInMs < DUPLICATE_PUNCH_COOLDOWN_MS) {
    return { attendanceAction: 'COOLDOWN_IGNORED', record: existing };
  }

  // Đã qua tối thiểu 5 phút kể từ lúc Check-in -> Cập nhật Check-out mới nhất
  if (!existing.checkOutTime || occurredAtDate.getTime() > existing.checkOutTime.getTime()) {
    existing.checkOutTime = occurredAtDate;
    existing.note = existing.note
      ? `${existing.note} | Check-out lúc ${formattedTime}`
      : `Check-out lúc ${formattedTime} qua ${deviceId}`;
    await existing.save({ session });
  }

  return { attendanceAction: 'CHECK_OUT', record: existing };
}

/**
 * Web Kiosk manual code / username check-in.
 */
const kioskCheckInByIdentifier = async (actor, identifier, eventType = 'CHECK_IN') => {
  if (!['CHECK_IN', 'CHECK_OUT'].includes(eventType)) throw new TimekeepingError('Loại chấm công không hợp lệ');
  const code = String(identifier || '').trim().toUpperCase();
  if (!code) throw new TimekeepingError('Vui lòng nhập mã nhân viên');
  if (code.length > 50) throw new TimekeepingError('Mã nhân viên không hợp lệ');

  const tenantFilter = actor.tenantId
    ? { tenantId: actor.tenantId }
    : { tenantId: { $in: [null, undefined] } };

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
    rawPayload: { channel: 'WEB_KIOSK', enteredIdentifier: code },
    calculateImmediately: true
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
  DUPLICATE_PUNCH_COOLDOWN_MS,
  resolvePersonIdentity,
  ingestDeviceEvent,
  kioskCheckInByIdentifier,
  ingestStudentDeviceAttendance
};
