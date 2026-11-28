'use strict';

/**
 * @fileoverview Service tiếp nhận, bóc tách và xử lý nghiệp vụ Check-in / Check-out tự động
 * cho cả Học sinh (`StudentAttendance`) và Nhân viên (`AttendanceRecord`) từ Webhook máy chấm công Hikvision.
 *
 * Luồng xử lý hoàn chỉnh:
 * - Bước 1: Giải mã `Buffer` gốc từ `express.raw` (64KB đầu qua `extractJsonFromMultipart`) hoặc JSON object.
 * - Bước 2: Lọc bỏ các gói nhiễu hệ thống (`heartBeat`, đóng/mở rơ-le cửa `21, 22`, sự kiện hệ thống `majorEventType !== 5`
 *   hoặc quét thất bại không có `employeeNoString`).
 * - Bước 3: Xác định trường học (`tenantId`) qua `schoolCode` trên URL hoặc tự dò theo Serial/IP máy trong `TimekeepingDevice`.
 * - Bước 4: Đẩy sang `attendanceDeviceService.ingestDeviceEvent` (`calculateImmediately: true`) để:
 *   + Ánh xạ tự động + bảng `AttendanceDevicePersonMapping` (nếu chưa khớp ai -> lưu vào danh sách `UNMAPPED` trên Web).
 *   + Áp dụng quy tắc Check-in lần đầu, chống quẹt đúp 5 phút, cập nhật Check-out từ phút thứ 5 trở đi.
 *   + Đánh dấu đi muộn sau `08:00` cho Học sinh và theo `StaffShift` (hoặc `08:00`) cho Nhân viên.
 */

const mongoose = require('mongoose');
const TimekeepingWebhookLog = require('../models/zone2_hr/TimekeepingWebhookLog');
const TimekeepingDevice = require('../models/zone2_hr/TimekeepingDevice');
const Tenant = require('../models/zone1_system/Tenant');
const { ingestDeviceEvent } = require('./attendanceDeviceService');
const { parseXml } = require('./hikvisionIsapiService');
const { publishCampusRealtimeEvent } = require('./realtimeCampusEventHub');
const { buildNaturalRealtimeAttendanceMessage } = require('../utils/vietnameseHardwareTranslator');

const MULTIPART_JSON_SCAN_LIMIT_BYTES = 65536;
const MAX_RAW_PREVIEW_LENGTH = 32768;
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

// Tập mã subEventType xác thực người THÀNH CÔNG của Hikvision thuộc nhóm majorEventType === 5
const VALID_AUTH_PASS_SUB_EVENTS = new Set([
  1,   // Quẹt thẻ hợp lệ
  38,  // Vân tay hợp lệ
  39,  // Vân tay hợp lệ (biến thể firmware)
  75,  // Khuôn mặt hợp lệ (Face OK)
  77,  // Thẻ + Khuôn mặt hợp lệ
  104  // Mật khẩu / PIN hợp lệ
]);

const DOOR_RELAY_NOISE_SUB_EVENTS = new Set([21, 22]);

const SENSITIVE_HEADER_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-device-api-key',
  'x-webhook-token'
]);

const HIKVISION_SUB_EVENT_LABELS = Object.freeze({
  1: 'Quẹt thẻ hợp lệ',
  9: 'Thẻ không tồn tại / chưa đăng ký',
  21: 'Mở rơ-le cửa',
  22: 'Đóng rơ-le cửa',
  38: 'Xác thực vân tay thành công',
  39: 'Xác thực vân tay thành công',
  75: 'Xác thực khuôn mặt thành công (Face OK)',
  76: 'Xác thực khuôn mặt thất bại',
  77: 'Quẹt thẻ + khuôn mặt thành công',
  104: 'Xác thực mật khẩu / PIN thành công'
});

/**
 * Trích xuất khối JSON đầu tiên từ chuỗi `multipart/form-data` bằng bộ đếm ngoặc cân bằng.
 *
 * @param {string} raw
 * @returns {Record<string, any> | null}
 */
const extractJsonFromMultipart = (raw) => {
  if (!raw || typeof raw !== 'string') return null;

  const jsonHeaderIdx = raw.indexOf('application/json');
  const eventLogIdx = raw.indexOf('event_log');
  let searchFrom = 0;
  if (jsonHeaderIdx !== -1) {
    searchFrom = jsonHeaderIdx;
  } else if (eventLogIdx !== -1) {
    searchFrom = eventLogIdx;
  }

  const startIdx = raw.indexOf('{', searchFrom);
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let i = startIdx; i < raw.length; i += 1) {
    const ch = raw[i];
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (ch === '\\') {
      isEscaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(raw.slice(startIdx, i + 1));
          } catch (_err) {
            return null;
          }
        }
      }
    }
  }

  return null;
};

const sanitizeHeaders = (rawHeaders = {}) => {
  const clean = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    clean[key] = SENSITIVE_HEADER_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : value;
  }
  return clean;
};

const truncatePreview = (text) => {
  if (!text || typeof text !== 'string') return '';
  if (text.length <= MAX_RAW_PREVIEW_LENGTH) return text;
  return `${text.slice(0, MAX_RAW_PREVIEW_LENGTH)}... [truncated ${text.length - MAX_RAW_PREVIEW_LENGTH} chars]`;
};

/**
 * Suy luận phương thức xác thực thực tế dựa trên `subEventType` chuẩn Hikvision ISAPI.
 *
 * @param {number | null} subEventType
 * @param {string | null} currentVerifyMode
 * @returns {'FACE' | 'FINGERPRINT' | 'CARD' | 'PASSWORD' | 'UNKNOWN'}
 */
const resolveHikvisionVerifyMethod = (subEventType, currentVerifyMode) => {
  const subType = Number(subEventType);
  const modeStr = String(currentVerifyMode || '').toLowerCase();

  if (subType === 75 || subType === 77) return 'FACE';
  if (subType === 38 || subType === 39) return 'FINGERPRINT';
  if (subType === 1) return 'CARD';
  if (subType === 104) return 'PASSWORD';

  if (modeStr.includes('face') || modeStr.includes('facial') || modeStr.includes('faceorfp')) return 'FACE';
  if (modeStr.includes('fingerprint') || modeStr === '1') return 'FINGERPRINT';
  if (modeStr.includes('card')) return 'CARD';
  if (modeStr.includes('password') || modeStr.includes('pin')) return 'PASSWORD';

  return 'UNKNOWN';
};

/**
 * Bóc tách dữ liệu từ `Buffer` (do `express.raw` trả về), `Object` hoặc `String`.
 *
 * @param {import('express').Request} req
 */
const normalizeIncomingWebhook = (req) => {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  const isMultipart = contentType.includes('multipart/form-data');

  if (Buffer.isBuffer(req.body)) {
    const totalBytes = req.body.length;
    if (totalBytes === 0) {
      return { payloadFormat: 'EMPTY', parsedPayload: null, rawBodyPreview: '', filesMeta: [] };
    }

    const headSliceLength = Math.min(totalBytes, MULTIPART_JSON_SCAN_LIMIT_BYTES);
    const rawHead = req.body.toString('utf8', 0, headSliceLength);
    let parsedPayload = extractJsonFromMultipart(rawHead);

    // Fallback hỗ trợ các dòng firmware Hikvision gửi cảnh báo dạng XML (<EventNotificationAlert>) thay vì JSON
    if (!parsedPayload && (rawHead.includes('<EventNotificationAlert') || rawHead.includes('<AccessControllerEvent'))) {
      const xmlObj = parseXml(rawHead);
      if (xmlObj && typeof xmlObj === 'object' && Object.keys(xmlObj).length > 0) {
        parsedPayload = xmlObj;
      }
    }

    const filesMeta = [];
    if (isMultipart) {
      const imagePartRegex = /name="([^"]+)"(?:;\s*filename="([^"]*)")?[\r\n]+Content-Type:\s*(image\/[a-zA-Z0-9.+-]+)/gi;
      let match;
      while ((match = imagePartRegex.exec(rawHead)) !== null) {
        filesMeta.push({
          fieldName: match[1] || 'Picture',
          originalName: match[2] || '',
          mimeType: match[3] || 'image/jpeg',
          sizeBytes: totalBytes,
          isParsedAsEventJson: false
        });
      }

      if (filesMeta.length === 0 && (/image\/(jpeg|jpg|png)/i.test(rawHead) || totalBytes > headSliceLength)) {
        filesMeta.push({
          fieldName: 'Picture',
          originalName: 'hikvision_capture.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: totalBytes,
          isParsedAsEventJson: false
        });
      }
    }

    const detectedFormat = isMultipart
      ? 'MULTIPART_FORM_DATA'
      : (parsedPayload ? 'JSON' : (contentType.includes('xml') || rawHead.trim().startsWith('<') ? 'XML' : 'PLAIN_TEXT'));

    return {
      payloadFormat: detectedFormat,
      parsedPayload,
      rawBodyPreview: truncatePreview(parsedPayload ? JSON.stringify(parsedPayload) : rawHead),
      filesMeta
    };
  }

  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    return {
      payloadFormat: contentType.includes('application/x-www-form-urlencoded') ? 'FORM_URLENCODED' : 'JSON',
      parsedPayload: req.body,
      rawBodyPreview: truncatePreview(JSON.stringify(req.body)),
      filesMeta: []
    };
  }

  if (typeof req.body === 'string' && req.body.trim()) {
    let parsed = extractJsonFromMultipart(req.body);
    if (!parsed && (req.body.includes('<EventNotificationAlert') || req.body.includes('<AccessControllerEvent'))) {
      const xmlObj = parseXml(req.body);
      if (xmlObj && typeof xmlObj === 'object' && Object.keys(xmlObj).length > 0) {
        parsed = xmlObj;
      }
    }
    return {
      payloadFormat: parsed && !req.body.trim().startsWith('<') ? 'JSON' : (req.body.trim().startsWith('<') ? 'XML' : 'PLAIN_TEXT'),
      parsedPayload: parsed,
      rawBodyPreview: truncatePreview(req.body),
      filesMeta: []
    };
  }

  return {
    payloadFormat: 'EMPTY',
    parsedPayload: null,
    rawBodyPreview: '',
    filesMeta: []
  };
};

/**
 * Trích xuất tóm tắt sự kiện Hikvision từ payload.
 */
const extractHikvisionSummary = (parsedPayload, filesMeta = [], fallbackIp = '') => {
  const hasFaceImage = filesMeta.some(
    (f) => !f.isParsedAsEventJson && String(f.mimeType || '').toLowerCase().startsWith('image/')
  );

  if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) {
    return { hasFaceImage, isHeartbeat: false, isNoiseEvent: true };
  }

  const root = parsedPayload.EventNotificationAlert || parsedPayload;
  const eventInfo = root.AccessControllerEvent || root.accessControllerEvent || root;
  const eventType = root.eventType || null;
  const majorEventType = eventInfo.majorEventType !== undefined ? Number(eventInfo.majorEventType) : null;
  const subEventType = eventInfo.subEventType !== undefined ? Number(eventInfo.subEventType) : null;
  const cleanMajor = Number.isNaN(majorEventType) ? null : majorEventType;
  const cleanSub = Number.isNaN(subEventType) ? null : subEventType;

  const rawEmployeeNo =
    eventInfo.employeeNoString
    ?? eventInfo.EmployeeNo
    ?? eventInfo.employeeNo
    ?? eventInfo.personCode
    ?? eventInfo.studentCode
    ?? eventInfo.employeeCode
    ?? eventInfo.externalPersonId
    ?? (eventInfo.cardNo ? String(eventInfo.cardNo).trim() : null)
    ?? null;
  const employeeNoString = rawEmployeeNo !== null && String(rawEmployeeNo).trim() !== ''
    ? String(rawEmployeeNo).trim()
    : null;

  const isHeartbeat = String(eventType || '').toLowerCase() === 'heartbeat';
  const isDoorRelayNoise = !employeeNoString && cleanSub !== null && DOOR_RELAY_NOISE_SUB_EVENTS.has(cleanSub);
  const isSystemNonPersonEvent = !employeeNoString && cleanMajor !== null && cleanMajor !== 5;
  const isValidPersonPass = Boolean(
    employeeNoString &&
    (cleanMajor === null || cleanMajor === 5) &&
    (cleanSub === null || VALID_AUTH_PASS_SUB_EVENTS.has(cleanSub))
  );

  const rawVerifyInput = eventInfo.currentVerifyMode || root.verifyMode || root.method || null;
  const verifyMethod = resolveHikvisionVerifyMethod(cleanSub, rawVerifyInput);
  const shortSerialNumber = root.shortSerialNumber || eventInfo.shortSerialNumber || null;

  return {
    eventType,
    eventState: root.eventState || null,
    dateTime: root.dateTime || eventInfo.time || root.occurredAt || root.timestamp || null,
    deviceIp: root.ipAddress || fallbackIp || null,
    macAddress: root.macAddress || null,
    shortSerialNumber,
    deviceName: eventInfo.deviceName || root.deviceName || null,
    majorEventType: cleanMajor,
    subEventType: cleanSub,
    subEventLabel: (cleanMajor === 5 && cleanSub !== null)
      ? (HIKVISION_SUB_EVENT_LABELS[cleanSub] || `Sự kiện kiểm soát mã phụ #${cleanSub}`)
      : null,
    employeeNoString,
    personName: eventInfo.name || eventInfo.personName || eventInfo.fullName || null,
    cardNo: eventInfo.cardNo ? String(eventInfo.cardNo).trim() : null,
    userType: eventInfo.userType || null,
    attendanceStatus: eventInfo.attendanceStatus || null,
    currentVerifyMode: verifyMethod !== 'UNKNOWN' ? verifyMethod : (rawVerifyInput || null),
    serialNo: eventInfo.serialNo !== undefined && !Number.isNaN(Number(eventInfo.serialNo))
      ? Number(eventInfo.serialNo)
      : null,
    hasFaceImage,
    isHeartbeat,
    isNoiseEvent: isHeartbeat || isDoorRelayNoise || isSystemNonPersonEvent,
    isValidPersonPass
  };
};

/**
 * Tra cứu ngữ cảnh Trường học (`tenantId`) và Thiết bị (`TimekeepingDevice`):
 * 1. Ưu tiên theo `schoolCode` trên URL (`/api/attendance/webhook/HOANANG-A`).
 * 2. Nếu URL không truyền `schoolCode`, tự dò thiết bị đã đăng ký theo `shortSerialNumber` hoặc `deviceIp`.
 */
const resolveTenantAndDevice = async ({ rawSchoolCode, rawDeviceCode, summary }) => {
  if (mongoose.connection.readyState !== 1) {
    return {
      tenantId: null,
      schoolCode: rawSchoolCode ? String(rawSchoolCode).trim().toUpperCase() : null,
      deviceDoc: null,
      deviceCode: rawDeviceCode ? String(rawDeviceCode).trim().toUpperCase() : 'HIKVISION-WEBHOOK'
    };
  }

  let tenantDoc = null;
  const cleanSchoolCode = String(rawSchoolCode || '').trim().toUpperCase();
  if (cleanSchoolCode) {
    tenantDoc = await Tenant.findOne({ code: cleanSchoolCode, status: 'active' }).select('_id code').lean();
  }

  let deviceDoc = null;
  if (tenantDoc) {
    // Khóa an toàn theo deviceSerial: nếu gói tin gửi kèm Serial của máy đã khóa cho PHÂN HIỆU KHÁC -> chặn cứng!
    if (summary.shortSerialNumber) {
      const foreignLockedDevice = await TimekeepingDevice.findOne({
        serialNumber: summary.shortSerialNumber,
        tenantId: { $ne: tenantDoc._id }
      })
        .select('_id tenantId serialNumber name')
        .lean();
      if (foreignLockedDevice) {
        return {
          tenantId: tenantDoc._id,
          schoolCode: tenantDoc.code,
          deviceDoc: null,
          deviceCode: 'BLOCKED-FOREIGN-SERIAL',
          crossCampusSerialBlocked: true
        };
      }
    }

    // Tìm máy chấm công thuộc trường này (khớp deviceCode, serialNumber hoặc IP, hoặc lấy máy HIKVISION đầu tiên của trường)
    const deviceConditions = [];
    if (rawDeviceCode) deviceConditions.push({ deviceCode: String(rawDeviceCode).trim().toUpperCase() });
    if (summary.shortSerialNumber) deviceConditions.push({ serialNumber: summary.shortSerialNumber });
    if (summary.deviceIp) deviceConditions.push({ host: summary.deviceIp });

    if (deviceConditions.length > 0) {
      deviceDoc = await TimekeepingDevice.findOne({ tenantId: tenantDoc._id, $or: deviceConditions }).lean();
    }
    if (!deviceDoc) {
      deviceDoc = await TimekeepingDevice.findOne({ tenantId: tenantDoc._id, enabled: true }).sort({ createdAt: 1 }).lean();
    }
  } else {
    // URL không có schoolCode -> Tự nhận diện trường thông qua Serial hoặc IP của máy chấm công (nếu duy nhất)
    if (summary.shortSerialNumber) {
      const bySerial = await TimekeepingDevice.find({ serialNumber: summary.shortSerialNumber, enabled: true }).limit(2).lean();
      if (bySerial.length === 1) deviceDoc = bySerial[0];
    }
    if (!deviceDoc && summary.deviceIp) {
      const byIp = await TimekeepingDevice.find({ host: summary.deviceIp, enabled: true }).limit(2).lean();
      if (byIp.length === 1) deviceDoc = byIp[0];
    }
    if (deviceDoc?.tenantId) {
      tenantDoc = await Tenant.findById(deviceDoc.tenantId).select('_id code').lean();
    }
  }

  // Cập nhật trạng thái ONLINE và thời điểm kết nối mới nhất cho thiết bị
  if (deviceDoc?._id) {
    const deviceUpdate = { lastSeenAt: new Date(), status: 'ONLINE' };
    if (summary.shortSerialNumber && !deviceDoc.serialNumber) {
      deviceUpdate.serialNumber = summary.shortSerialNumber;
    }
    TimekeepingDevice.updateOne({ _id: deviceDoc._id }, { $set: deviceUpdate }).exec().catch(() => {});
  }

  return {
    tenantId: tenantDoc?._id || null,
    schoolCode: tenantDoc?.code || (cleanSchoolCode || null),
    deviceDoc,
    deviceCode: deviceDoc?.deviceCode || (rawDeviceCode ? String(rawDeviceCode).trim().toUpperCase() : 'HIKVISION-WEBHOOK')
  };
};

/**
 * Chuyển đổi phương thức xác thực Hikvision sang enum `source` & `authenticationMethod` của `RawAttendanceEvent`.
 */
const mapVerifyMethodToDeviceSource = (verifyMethod) => {
  switch (verifyMethod) {
    case 'FACE':
      return { source: 'FACE', authenticationMethod: 'FACE' };
    case 'CARD':
      return { source: 'CARD', authenticationMethod: 'CARD' };
    case 'PASSWORD':
      return { source: 'DEVICE', authenticationMethod: 'PIN' };
    case 'FINGERPRINT':
    default:
      return { source: 'DEVICE', authenticationMethod: 'UNKNOWN' };
  }
};

/**
 * Tiếp nhận gói tin Webhook Hikvision, lọc nhiễu, ghi nhận Check-in / Check-out tự động cho Học sinh & Nhân viên.
 *
 * @param {import('express').Request} req
 */
const captureIncomingWebhook = async (req) => {
  // Bước 1: Giải mã Buffer / JSON / Multipart
  const { payloadFormat, parsedPayload, rawBodyPreview, filesMeta } = normalizeIncomingWebhook(req);
  const rawSourceIp = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '').trim();
  const cleanSourceIp = rawSourceIp.replace(/^::ffff:/i, '');

  // Bước 2: Bóc tách tóm tắt Hikvision & lọc bỏ gói nhiễu (heartBeat, đóng/mở cửa 21-22, sự kiện hệ thống không người)
  const rawSummary = extractHikvisionSummary(parsedPayload, filesMeta, cleanSourceIp);
  if (rawSummary.isNoiseEvent || payloadFormat === 'EMPTY') {
    return {
      savedId: null,
      persisted: false,
      skippedNoise: true,
      attendanceResult: null,
      record: { payloadFormat, hikvisionSummary: rawSummary, filesMeta }
    };
  }

  if (Buffer.isBuffer(req.body) && parsedPayload) {
    req.body = parsedPayload;
  }

  // Bước 3: Xác định Trường học (tenantId) & Thiết bị (deviceCode)
  const rawSchoolCode = req.params?.schoolCode || req.query?.schoolCode || req.header('X-School-Code') || null;
  const rawDeviceCode = req.query?.deviceCode || req.header('X-Device-Code') || null;
  const { tenantId, schoolCode, deviceDoc, deviceCode, crossCampusSerialBlocked } = await resolveTenantAndDevice({
    rawSchoolCode,
    rawDeviceCode,
    summary: rawSummary
  });

  if (crossCampusSerialBlocked) {
    return {
      savedId: null,
      persisted: false,
      skippedNoise: false,
      crossCampusSerialBlocked: true,
      attendanceResult: { status: 'BLOCKED_CROSS_CAMPUS_SERIAL' },
      record: {
        tenantId,
        schoolCode,
        deviceCode,
        processingStatus: 'IGNORED',
        processingNote: 'Đã chặn an toàn: Máy chấm công gửi sự kiện này đang thuộc về một phân hiệu trường khác.'
      }
    };
  }

  // Bước 4: Xử lý nghiệp vụ Check-in / Check-out Học sinh & Nhân viên nếu là lần quẹt hợp lệ
  let attendanceResult = null;
  let processingStatus = 'IGNORED';
  let processingNote = 'Sự kiện không phải lần xác thực chấm công hợp lệ';

  if (rawSummary.isValidPersonPass) {
    const occurredAtDate = rawSummary.dateTime ? new Date(rawSummary.dateTime) : new Date();
    const validOccurredAt = Number.isNaN(occurredAtDate.getTime()) ? new Date() : occurredAtDate;
    const serialTag = rawSummary.shortSerialNumber || (rawSummary.macAddress ? rawSummary.macAddress.replace(/:/g, '') : deviceCode);
    const externalEventId = rawSummary.serialNo !== null
      ? `HIK-${serialTag}-${rawSummary.serialNo}`
      : `HIK-${serialTag}-${rawSummary.employeeNoString}-${validOccurredAt.getTime()}`;

    const { source, authenticationMethod } = mapVerifyMethodToDeviceSource(rawSummary.currentVerifyMode);

    if (mongoose.connection.readyState === 1 && tenantId) {
      try {
        const ingestOut = await ingestDeviceEvent({
          deviceId: deviceCode,
          deviceObjectId: deviceDoc?._id || null,
          externalEventId,
          tenantId,
          externalPersonId: rawSummary.employeeNoString,
          employeeName: rawSummary.personName || `Mã máy #${rawSummary.employeeNoString}`,
          eventType: 'PUNCH',
          source,
          authenticationMethod,
          vendorEventCode: rawSummary.subEventType !== null ? `${rawSummary.majorEventType || 5}:${rawSummary.subEventType}` : null,
          occurredAt: validOccurredAt,
          calculateImmediately: true,
          enableMorningLateCheck: true,
          rawPayload: parsedPayload || {}
        });

        if (ingestOut.duplicate) {
          processingStatus = 'PROCESSED';
          processingNote = 'Lượt quét này vừa được hệ thống ghi nhận cách đây ít giây nên tự động giữ nguyên.';
          attendanceResult = { status: 'DUPLICATE', subjectType: ingestOut.subjectType };
        } else if (ingestOut.unmapped) {
          processingStatus = 'RECEIVED_RAW';
          const naturalUnmapped = buildNaturalRealtimeAttendanceMessage({
            subjectType: 'UNMAPPED',
            externalPersonId: rawSummary.employeeNoString,
            fullName: rawSummary.personName,
            verifyMode: rawSummary.currentVerifyMode,
            occurredAt: validOccurredAt,
            deviceName: deviceDoc?.name || ''
          });
          processingNote = naturalUnmapped.message;
          attendanceResult = { status: 'UNMAPPED', externalPersonId: rawSummary.employeeNoString };
          publishCampusRealtimeEvent(tenantId, {
            type: 'ATTENDANCE_UNMAPPED_SCAN',
            tone: naturalUnmapped.tone,
            title: naturalUnmapped.title,
            message: naturalUnmapped.message,
            subjectType: 'UNMAPPED',
            personCode: rawSummary.employeeNoString,
            fullName: rawSummary.personName || '',
            deviceName: deviceDoc?.name || '',
            occurredAt: validOccurredAt
          });
        } else if (ingestOut.subjectType === 'STUDENT') {
          processingStatus = 'PROCESSED';
          const isLate = ingestOut.attendanceRecord?.status === 'late';
          const naturalStudent = buildNaturalRealtimeAttendanceMessage({
            subjectType: 'STUDENT',
            fullName: ingestOut.student.fullName,
            className: ingestOut.student.className || '',
            attendanceAction: ingestOut.attendanceAction,
            isLate,
            verifyMode: rawSummary.currentVerifyMode,
            occurredAt: validOccurredAt,
            deviceName: deviceDoc?.name || ''
          });
          processingNote = naturalStudent.message;
          attendanceResult = {
            status: 'OK',
            subjectType: 'STUDENT',
            action: ingestOut.attendanceAction,
            studentId: ingestOut.student._id,
            fullName: ingestOut.student.fullName,
            attendanceStatus: ingestOut.attendanceRecord?.status,
            checkInTime: ingestOut.attendanceRecord?.checkInTime,
            checkOutTime: ingestOut.attendanceRecord?.checkOutTime
          };
          publishCampusRealtimeEvent(tenantId, {
            type: 'STUDENT_GATE_SCAN',
            tone: naturalStudent.tone,
            title: naturalStudent.title,
            message: naturalStudent.message,
            subjectType: 'STUDENT',
            personCode: ingestOut.student.studentCode || rawSummary.employeeNoString,
            fullName: ingestOut.student.fullName,
            className: ingestOut.student.className || '',
            deviceName: deviceDoc?.name || '',
            occurredAt: validOccurredAt
          });
        } else {
          processingStatus = 'PROCESSED';
          const empFullName = ingestOut.user.profile?.fullName || ingestOut.user.username;
          const naturalStaff = buildNaturalRealtimeAttendanceMessage({
            subjectType: 'EMPLOYEE',
            fullName: empFullName,
            attendanceAction: ingestOut.attendanceAction,
            isLate: Boolean(ingestOut.attendanceRecord?.isLate),
            verifyMode: rawSummary.currentVerifyMode,
            occurredAt: validOccurredAt,
            deviceName: deviceDoc?.name || ''
          });
          processingNote = naturalStaff.message;
          attendanceResult = {
            status: 'OK',
            subjectType: 'EMPLOYEE',
            action: ingestOut.attendanceAction,
            userId: ingestOut.user._id,
            fullName: empFullName,
            isLate: ingestOut.attendanceRecord?.isLate || false,
            lateMinutes: ingestOut.attendanceRecord?.lateMinutes || 0,
            checkInTime: ingestOut.attendanceRecord?.checkInTime,
            checkOutTime: ingestOut.attendanceRecord?.checkOutTime
          };
          publishCampusRealtimeEvent(tenantId, {
            type: 'EMPLOYEE_GATE_SCAN',
            tone: naturalStaff.tone,
            title: naturalStaff.title,
            message: naturalStaff.message,
            subjectType: 'EMPLOYEE',
            personCode: rawSummary.employeeNoString,
            fullName: empFullName,
            deviceName: deviceDoc?.name || '',
            occurredAt: validOccurredAt
          });
        }
      } catch (ingestErr) {
        processingStatus = 'FAILED';
        processingNote = `Lỗi khi ghi nhận chấm công: ${ingestErr.message}`;
        attendanceResult = { status: 'ERROR', error: ingestErr.message };
      }
    } else {
      processingStatus = 'RECEIVED_RAW';
      processingNote = 'Chưa xác định được cơ sở trường học (hãy gắn /HOANANG-A lên URL hoặc đăng ký IP/Serial máy vào trường)';
      attendanceResult = { status: 'NO_TENANT' };
    }
  }

  const { isNoiseEvent, isValidPersonPass, shortSerialNumber, ...hikvisionSummary } = rawSummary;
  const logData = {
    tenantId,
    schoolCode,
    deviceCode,
    sourceIp: cleanSourceIp,
    method: req.method,
    url: req.originalUrl || req.url,
    contentType: String(req.headers['content-type'] || ''),
    payloadFormat,
    headers: sanitizeHeaders(req.headers),
    query: req.query || {},
    parsedPayload,
    rawBodyPreview,
    filesMeta,
    hikvisionSummary,
    processingStatus,
    processingNote
  };

  console.info(
    `[Chấm Công Hikvision] Trường: ${schoolCode || 'N/A'} | Mã máy: ${hikvisionSummary.employeeNoString || 'N/A'} (${hikvisionSummary.personName || 'N/A'}) | ` +
    `Phương thức: ${hikvisionSummary.currentVerifyMode || 'N/A'} | Lúc: ${hikvisionSummary.dateTime || 'N/A'} | Kết quả: ${processingNote}`
  );

  if (mongoose.connection.readyState !== 1) {
    return { savedId: null, persisted: false, skippedNoise: false, attendanceResult, record: logData };
  }

  const created = await TimekeepingWebhookLog.create(logData);

  return {
    savedId: String(created._id),
    persisted: true,
    skippedNoise: false,
    attendanceResult,
    record: created.toObject()
  };
};

/**
 * Truy vấn danh sách gói tin Webhook đã lưu (có phân trang, `.lean()`, `.select()`).
 */
const listWebhookLogs = async ({
  tenantId = null,
  schoolCode = null,
  page = 1,
  limit = DEFAULT_PAGE_LIMIT
} = {}) => {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(MAX_PAGE_LIMIT, Math.max(1, parseInt(limit, 10) || DEFAULT_PAGE_LIMIT));
  const skip = (safePage - 1) * safeLimit;

  const filter = {};
  if (tenantId && mongoose.isValidObjectId(tenantId)) {
    filter.tenantId = new mongoose.Types.ObjectId(tenantId);
  } else {
    // Fail-closed: Nếu không có ngữ cảnh trường hợp lệ thì chỉ trả log Legacy (tenantId: null), không bao giờ rò rỉ chéo trường
    filter.tenantId = null;
    if (schoolCode) {
      filter.schoolCode = String(schoolCode).trim().toUpperCase();
    }
  }

  const [items, total] = await Promise.all([
    TimekeepingWebhookLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .select('-rawBodyPreview -headers')
      .lean(),
    TimekeepingWebhookLog.countDocuments(filter)
  ]);

  return {
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit) || 1
    }
  };
};

/**
 * Xem chi tiết đầy đủ 1 bản ghi gói tin Webhook theo ID.
 */
const getWebhookLogDetail = async (id, tenantId = null) => {
  if (!mongoose.isValidObjectId(id)) return null;

  const filter = { _id: id };
  if (tenantId && mongoose.isValidObjectId(tenantId)) {
    filter.tenantId = new mongoose.Types.ObjectId(tenantId);
  } else {
    filter.tenantId = null;
  }

  return TimekeepingWebhookLog.findOne(filter).lean();
};

/**
 * Giả lập gửi 1 gói tin chuẩn Hikvision vào đúng luồng `captureIncomingWebhook` với đuôi `/:schoolCode`
 * để Admin trường hoặc SuperAdmin kiểm tra thông suốt luồng đồng bộ Điểm danh Học sinh & Chấm công Nhân viên.
 *
 * @param {object} params
 * @param {string} params.schoolCode
 * @param {string} params.externalPersonId - Mã học sinh (`studentCode`), mã nhân viên (`employeeCode`) hoặc ID ánh xạ trên máy
 * @param {string} [params.personName]
 * @param {'FACE'|'CARD'|'FINGERPRINT'} [params.verifyMode]
 * @param {string | Date} [params.occurredAt]
 * @param {string} [params.deviceCode]
 * @param {string} [params.sourceIp]
 */
const simulateSchoolWebhookEvent = async ({
  schoolCode,
  externalPersonId,
  personName = '',
  verifyMode = 'FACE',
  occurredAt = null,
  deviceCode = 'SIMULATOR-WEB',
  sourceIp = '127.0.0.1'
}) => {
  const cleanCode = String(schoolCode || '').trim().toUpperCase();
  const cleanPersonId = String(externalPersonId || '').trim();
  if (!cleanCode) {
    throw Object.assign(new Error('Thiếu mã trường (schoolCode) để gửi Webhook'), { statusCode: 400 });
  }
  if (!cleanPersonId) {
    throw Object.assign(new Error('Vui lòng nhập Mã học sinh, Mã nhân viên hoặc ID trên máy chấm công'), { statusCode: 400 });
  }

  const eventDate = occurredAt ? new Date(occurredAt) : new Date();
  const validIso = Number.isNaN(eventDate.getTime()) ? new Date().toISOString() : eventDate.toISOString();
  const normalizedVerify = String(verifyMode || 'FACE').toUpperCase();
  const subEventType = normalizedVerify === 'CARD' ? 1 : (normalizedVerify === 'FINGERPRINT' ? 38 : 75);

  const simulatedPayload = {
    ipAddress: sourceIp,
    dateTime: validIso,
    eventType: 'AccessControllerEvent',
    eventState: 'active',
    AccessControllerEvent: {
      deviceName: `Webhook Test (${cleanCode})`,
      majorEventType: 5,
      subEventType,
      employeeNoString: cleanPersonId,
      name: String(personName || '').trim() || undefined,
      currentVerifyMode: normalizedVerify === 'CARD' ? 'card' : (normalizedVerify === 'FINGERPRINT' ? 'fp' : 'face'),
      serialNo: Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000)
    }
  };

  const mockReq = {
    method: 'POST',
    url: `/api/attendance/webhook/${cleanCode}`,
    originalUrl: `/api/attendance/webhook/${cleanCode}`,
    params: { schoolCode: cleanCode },
    query: deviceCode ? { deviceCode } : {},
    headers: {
      'content-type': 'application/json',
      'user-agent': 'HoaNang-Webhook-Simulator/1.0',
      'x-forwarded-for': sourceIp
    },
    header(name) {
      return this.headers[String(name || '').toLowerCase()];
    },
    body: simulatedPayload,
    ip: sourceIp
  };

  return captureIncomingWebhook(mockReq);
};

module.exports = {
  extractJsonFromMultipart,
  resolveHikvisionVerifyMethod,
  normalizeIncomingWebhook,
  extractHikvisionSummary,
  captureIncomingWebhook,
  simulateSchoolWebhookEvent,
  listWebhookLogs,
  getWebhookLogDetail
};
