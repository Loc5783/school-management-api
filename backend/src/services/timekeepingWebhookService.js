'use strict';

/**
 * @fileoverview Service tiếp nhận, bóc tách và lưu trữ gói tin Webhook từ máy chấm công Hikvision.
 *
 * Thiết kế đồng bộ theo cơ chế thực chiến của `JussStudio/BE`:
 * 1. Nhận trực tiếp `Buffer` gốc từ `express.raw` (giới hạn 50MB, mọi Content-Type) hoặc JSON object.
 * 2. Với `multipart/form-data` (khi quét khuôn mặt có đính kèm ảnh JPEG nặng): chỉ đọc 64KB đầu tiên
 *    của Buffer và dùng thuật toán đếm ngoặc nhọn `extractJsonFromMultipart` để trích xuất khối JSON
 *    `event_log` chính xác, tránh lỗi regex tham lam ăn vào dữ liệu ảnh nhị phân và tiết kiệm RAM/CPU.
 * 3. Tự động lọc bỏ các gói nhiễu không phải chấm công người thật: gói nhịp tim (`heartBeat`) và
 *    sự kiện đóng/mở rơ-le cửa (`subEventType = 21, 22` không có mã người dùng).
 * 4. Ưu tiên xác định phương thức chấm công (`FACE`, `FINGERPRINT`, `CARD`) qua `subEventType` chuẩn ISAPI
 *    vì `currentVerifyMode` của Hikvision thường trả về chuỗi cấu hình cửa (`faceOrFpOrCardOrPw`).
 */

const mongoose = require('mongoose');
const TimekeepingWebhookLog = require('../models/zone2_hr/TimekeepingWebhookLog');
const Tenant = require('../models/zone1_system/Tenant');

const MULTIPART_JSON_SCAN_LIMIT_BYTES = 65536; // 64KB đầu của gói tin luôn chứa trọn phần JSON event_log
const MAX_RAW_PREVIEW_LENGTH = 32768; // Giới hạn 32KB lưu preview trong DB
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

// Các mã subEventType đóng/mở rơ-le cửa tự động phát sinh sau mỗi lần quẹt trên máy Hikvision
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
  39: 'Xác thực vân tay',
  75: 'Xác thực khuôn mặt thành công (Face OK)',
  76: 'Xác thực khuôn mặt thất bại',
  77: 'Quẹt thẻ + khuôn mặt thành công',
  104: 'Xác thực mật khẩu / PIN thành công'
});

/**
 * Trích xuất khối JSON đầu tiên từ chuỗi `multipart/form-data` bằng bộ đếm ngoặc cân bằng.
 * Lý do: Tránh dùng biểu thức chính quy tham lam bị nuốt nhầm các ký tự `{` `}` ngẫu nhiên nằm trong
 * luồng byte nhị phân của ảnh JPEG đính kèm khi quét khuôn mặt.
 *
 * @param {string} raw - Chuỗi UTF-8 trích từ phần đầu của gói tin
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

/**
 * Ẩn các header nhạy cảm trước khi ghi vào MongoDB.
 *
 * @param {Record<string, any>} rawHeaders
 * @returns {Record<string, any>}
 */
const sanitizeHeaders = (rawHeaders = {}) => {
  const clean = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    clean[key] = SENSITIVE_HEADER_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : value;
  }
  return clean;
};

/**
 * Giới hạn độ dài chuỗi preview để bảo vệ kích thước document MongoDB.
 *
 * @param {string} text
 * @returns {string}
 */
const truncatePreview = (text) => {
  if (!text || typeof text !== 'string') return '';
  if (text.length <= MAX_RAW_PREVIEW_LENGTH) return text;
  return `${text.slice(0, MAX_RAW_PREVIEW_LENGTH)}... [truncated ${text.length - MAX_RAW_PREVIEW_LENGTH} chars]`;
};

/**
 * Suy luận phương thức xác thực thực tế dựa trên `subEventType` chuẩn Hikvision ISAPI
 * trước khi fallback sang `currentVerifyMode` (giống chuẩn xử lý bên `JussStudio/BE`).
 *
 * @param {number | null} subEventType
 * @param {string | null} currentVerifyMode
 * @returns {string} 'FACE' | 'FINGERPRINT' | 'CARD' | 'PASSWORD' | 'UNKNOWN'
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
 * Bóc tách dữ liệu từ `Buffer` (do `express.raw` trả về), `Object` (do `express.json` trả về) hoặc `String`.
 *
 * @param {import('express').Request} req
 * @returns {{
 *   payloadFormat: string,
 *   parsedPayload: Record<string, any> | null,
 *   rawBodyPreview: string,
 *   filesMeta: Array<object>
 * }}
 */
const normalizeIncomingWebhook = (req) => {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  const isMultipart = contentType.includes('multipart/form-data');

  // Nhánh 1: Nhận Buffer trực tiếp từ express.raw({ type: '*/*', limit: '50mb' })
  if (Buffer.isBuffer(req.body)) {
    const totalBytes = req.body.length;
    if (totalBytes === 0) {
      return { payloadFormat: 'EMPTY', parsedPayload: null, rawBodyPreview: '', filesMeta: [] };
    }

    // Chỉ giải mã tối đa 64KB đầu tiên sang UTF-8 để lấy trọn JSON mà không chạm vào vùng ảnh JPEG nặng phía sau
    const headSliceLength = Math.min(totalBytes, MULTIPART_JSON_SCAN_LIMIT_BYTES);
    const rawHead = req.body.toString('utf8', 0, headSliceLength);
    const parsedPayload = extractJsonFromMultipart(rawHead);

    const filesMeta = [];
    if (isMultipart) {
      // Quét nhanh tiêu đề các part ảnh trong vùng header multipart để ghi nhận metadata (không lưu binary ảnh)
      const imagePartRegex = /name="([^"]+)"(?:;\s*filename="([^"]*)")?[\r\n]+Content-Type:\s*(image\/[a-zA-Z0-9.+-]+)/gi;
      let match;
      while ((match = imagePartRegex.exec(rawHead)) !== null) {
        filesMeta.push({
          fieldName: match[1] || 'Picture',
          originalName: match[2] || '',
          mimeType: match[3] || 'image/jpeg',
          sizeBytes: totalBytes, // Tổng kích thước gói multipart nhận được
          isParsedAsEventJson: false
        });
      }

      // Một số firmware đặt Content-Type của ảnh hoặc gửi nhị phân JPEG ngay sau boundary
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

  // Nhánh 2: Đã được express.json() hoặc express.urlencoded() giải mã thành Object
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    return {
      payloadFormat: contentType.includes('application/x-www-form-urlencoded') ? 'FORM_URLENCODED' : 'JSON',
      parsedPayload: req.body,
      rawBodyPreview: truncatePreview(JSON.stringify(req.body)),
      filesMeta: []
    };
  }

  // Nhánh 3: Chuỗi văn bản thuần
  if (typeof req.body === 'string' && req.body.trim()) {
    const parsed = extractJsonFromMultipart(req.body);
    return {
      payloadFormat: parsed ? 'JSON' : (req.body.trim().startsWith('<') ? 'XML' : 'PLAIN_TEXT'),
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
 * Bóc tách tóm tắt nghiệp vụ từ gói tin Hikvision (`AccessControllerEvent` / `EventNotificationAlert`).
 *
 * @param {Record<string, any> | null} parsedPayload
 * @param {Array<object>} filesMeta
 * @param {string} fallbackIp
 * @returns {object}
 */
const extractHikvisionSummary = (parsedPayload, filesMeta = [], fallbackIp = '') => {
  const hasFaceImage = filesMeta.some(
    (f) => !f.isParsedAsEventJson && String(f.mimeType || '').toLowerCase().startsWith('image/')
  );

  if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) {
    return { hasFaceImage, isHeartbeat: false, isDoorRelayNoise: false };
  }

  const root = parsedPayload.EventNotificationAlert || parsedPayload;
  const eventInfo = root.AccessControllerEvent || root.accessControllerEvent || root;
  const eventType = root.eventType || null;
  const majorEventType = eventInfo.majorEventType !== undefined ? Number(eventInfo.majorEventType) : null;
  const subEventType = eventInfo.subEventType !== undefined ? Number(eventInfo.subEventType) : null;
  const cleanSubEvent = Number.isNaN(subEventType) ? null : subEventType;

  const rawEmployeeNo = eventInfo.employeeNoString ?? eventInfo.EmployeeNo ?? eventInfo.employeeNo ?? null;
  const employeeNoString = rawEmployeeNo !== null && String(rawEmployeeNo).trim() !== ''
    ? String(rawEmployeeNo).trim()
    : null;

  const isHeartbeat = String(eventType || '').toLowerCase() === 'heartbeat';
  const isDoorRelayNoise = !employeeNoString && cleanSubEvent !== null && DOOR_RELAY_NOISE_SUB_EVENTS.has(cleanSubEvent);
  const verifyMethod = resolveHikvisionVerifyMethod(cleanSubEvent, eventInfo.currentVerifyMode);

  return {
    eventType,
    eventState: root.eventState || null,
    dateTime: root.dateTime || eventInfo.time || null,
    deviceIp: root.ipAddress || fallbackIp || null,
    macAddress: root.macAddress || null,
    deviceName: eventInfo.deviceName || root.deviceName || null,
    majorEventType: Number.isNaN(majorEventType) ? null : majorEventType,
    subEventType: cleanSubEvent,
    subEventLabel: (majorEventType === 5 && cleanSubEvent !== null)
      ? (HIKVISION_SUB_EVENT_LABELS[cleanSubEvent] || `Sự kiện kiểm soát mã phụ #${cleanSubEvent}`)
      : null,
    employeeNoString,
    personName: eventInfo.name || null,
    cardNo: eventInfo.cardNo ? String(eventInfo.cardNo).trim() : null,
    userType: eventInfo.userType || null,
    attendanceStatus: eventInfo.attendanceStatus || null,
    currentVerifyMode: verifyMethod !== 'UNKNOWN' ? verifyMethod : (eventInfo.currentVerifyMode || null),
    serialNo: eventInfo.serialNo !== undefined && !Number.isNaN(Number(eventInfo.serialNo))
      ? Number(eventInfo.serialNo)
      : null,
    hasFaceImage,
    isHeartbeat,
    isDoorRelayNoise
  };
};

/**
 * Tra cứu `tenantId` nếu URL hoặc query có truyền kèm `schoolCode` (ví dụ `/api/attendance/webhook/HOANANG-A`).
 *
 * @param {string | null} rawSchoolCode
 * @returns {Promise<{ tenantId: import('mongoose').Types.ObjectId | null, schoolCode: string | null }>}
 */
const resolveOptionalTenant = async (rawSchoolCode) => {
  const cleanCode = String(rawSchoolCode || '').trim().toUpperCase();
  if (!cleanCode) return { tenantId: null, schoolCode: null };
  if (mongoose.connection.readyState !== 1) return { tenantId: null, schoolCode: cleanCode };

  const tenant = await Tenant.findOne({ code: cleanCode }).select('_id code').lean();
  return {
    tenantId: tenant ? tenant._id : null,
    schoolCode: cleanCode
  };
};

/**
 * In thông tin sự kiện chấm công ra Terminal rõ ràng để quan sát ngay khi quẹt thử.
 *
 * @param {object} logEntry
 */
const logWebhookToConsole = (logEntry) => {
  const s = logEntry.hikvisionSummary || {};
  console.info(
    `[Chấm Công Hikvision] Mã người: ${s.employeeNoString || 'Chưa rõ'} | Tên: ${s.personName || 'N/A'} | ` +
    `Phương thức: ${s.currentVerifyMode || 'N/A'} (sub=${s.subEventType ?? 'n/a'}) | ` +
    `Thời gian: ${s.dateTime || 'N/A'} | Ảnh mặt: ${s.hasFaceImage ? 'CÓ' : 'KHÔNG'} | Định dạng: ${logEntry.payloadFormat}`
  );
  if (logEntry.parsedPayload) {
    console.info('[Payload Hikvision]:', JSON.stringify(logEntry.parsedPayload, null, 2));
  }
};

/**
 * Tiếp nhận gói tin từ máy chấm công Hikvision:
 * - Bỏ qua các gói nhiễu (`heartBeat`, đóng/mở rơ-le cửa `subEventType = 21, 22`) giống `JussStudio/BE`.
 * - Lưu các sự kiện hợp lệ vào bảng `TimekeepingWebhookLog` và in ra Terminal để đối chiếu.
 *
 * @param {import('express').Request} req
 * @returns {Promise<{ savedId: string | null, persisted: boolean, skippedNoise: boolean, record: object }>}
 */
const captureIncomingWebhook = async (req) => {
  // Bước 1: Giải mã Buffer / JSON / Multipart
  const { payloadFormat, parsedPayload, rawBodyPreview, filesMeta } = normalizeIncomingWebhook(req);
  const sourceIp = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '').trim();

  // Bước 2: Bóc tách các trường nghiệp vụ Hikvision
  const summary = extractHikvisionSummary(parsedPayload, filesMeta, sourceIp);

  // Bước 3: Lọc bỏ sự kiện nhịp tim (heartBeat) và đóng/mở rơ-le cửa (subEventType 21, 22) giống JussStudio/BE
  if (summary.isHeartbeat || summary.isDoorRelayNoise || payloadFormat === 'EMPTY') {
    return {
      savedId: null,
      persisted: false,
      skippedNoise: true,
      record: { payloadFormat, hikvisionSummary: summary, filesMeta }
    };
  }

  // Gán lại req.body đã bóc tách sạch (nếu là Buffer) để middleware log chung không in mảng byte nhị phân
  if (Buffer.isBuffer(req.body) && parsedPayload) {
    req.body = parsedPayload;
  }

  // Bước 4: Tra cứu ngữ cảnh trường học nếu có schoolCode trên URL/query
  const rawSchoolCode = req.params?.schoolCode || req.query?.schoolCode || req.header('X-School-Code') || null;
  const { tenantId, schoolCode } = await resolveOptionalTenant(rawSchoolCode);
  const rawDeviceCode = req.query?.deviceCode || req.header('X-Device-Code') || null;

  const { isDoorRelayNoise, ...hikvisionSummary } = summary;
  const logData = {
    tenantId,
    schoolCode,
    deviceCode: rawDeviceCode ? String(rawDeviceCode).trim().toUpperCase() : null,
    sourceIp,
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
    processingStatus: 'RECEIVED_RAW',
    processingNote: 'Đã nhận sự kiện từ máy Hikvision (Bước 1 - Chờ nối xử lý Check-in/Check-out ở Bước 2)'
  };

  // Bước 5: In chi tiết ra Terminal
  logWebhookToConsole(logData);

  // Bước 6: Lưu lịch sử vào MongoDB
  if (mongoose.connection.readyState !== 1) {
    return { savedId: null, persisted: false, skippedNoise: false, record: logData };
  }

  const created = await TimekeepingWebhookLog.create(logData);

  // TODO (Bước 2): Sau khi kiểm tra gói tin thực tế từ máy Hikvision bắn về (xác nhận định dạng mã học sinh /
  // mã nhân viên trong `hikvisionSummary.employeeNoString`, thời gian `dateTime`, phương thức `currentVerifyMode`),
  // gọi sang `attendanceDeviceService.ingestDeviceEvent(...)` tại đây để tự động ghi nhận Check-in / Check-out
  // cho cả Học sinh (`StudentAttendance`) và Nhân viên (`RawAttendanceEvent` -> `AttendanceRecord`).

  return {
    savedId: String(created._id),
    persisted: true,
    skippedNoise: false,
    record: created.toObject()
  };
};

/**
 * Truy vấn danh sách gói tin Webhook đã lưu (phân trang chuẩn, `.lean()`, `.select()`).
 *
 * @param {object} [params]
 * @returns {Promise<{ items: Array<object>, pagination: object }>}
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
  } else if (schoolCode) {
    filter.schoolCode = String(schoolCode).trim().toUpperCase();
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
 *
 * @param {string} id
 * @param {string | import('mongoose').Types.ObjectId | null} [tenantId=null]
 * @returns {Promise<object | null>}
 */
const getWebhookLogDetail = async (id, tenantId = null) => {
  if (!mongoose.isValidObjectId(id)) return null;

  const filter = { _id: id };
  if (tenantId && mongoose.isValidObjectId(tenantId)) {
    filter.tenantId = new mongoose.Types.ObjectId(tenantId);
  }

  return TimekeepingWebhookLog.findOne(filter).lean();
};

module.exports = {
  extractJsonFromMultipart,
  resolveHikvisionVerifyMethod,
  normalizeIncomingWebhook,
  extractHikvisionSummary,
  captureIncomingWebhook,
  listWebhookLogs,
  getWebhookLogDetail
};
