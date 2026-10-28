const crypto = require('crypto');
const { DEFAULT_SCHOOL_TIMEZONE, getWorkDate } = require('./dateHelpers');

const clean = (val, max = 500) => String(val || '').trim().slice(0, max);

const isLeapYear = (year) => (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);

const getDaysInMonth = (year, month) => {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
};

/**
 * Strictly parses an ISO 8601 date-time string.
 * Enforces calendar rules:
 * - Leap year for February
 * - Valid days in month (28, 29, 30, 31)
 * - Hour (0-23), minute (0-59), second (0-59)
 * - Timezone: Z or [+-]HH:mm, where HH in 0-23, mm in 0-59
 * Rejects nonexistent calendar dates like 2026-02-31 without JavaScript rollover.
 */
const parseStrictIsoDateTime = (value) => {
  if (typeof value !== 'string') return null;
  const str = value.trim();
  if (!str) return null;

  // Strict ISO 8601 datetime pattern: YYYY-MM-DDTHH:mm:ss[.sss][Z|(+|-)HH:mm]
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:(Z)|([+-])(\d{2}):?(\d{2}))?$/i);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fractionStr = match[7];
  const isZ = Boolean(match[8]);
  const tzSign = match[9];
  const tzHourStr = match[10];
  const tzMinStr = match[11];

  if (year < 1000 || year > 9999) return null;
  if (month < 1 || month > 12) return null;
  const maxDays = getDaysInMonth(year, month);
  if (day < 1 || day > maxDays) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;
  if (second < 0 || second > 59) return null;

  let offsetMinutes = 0;
  if (tzSign && tzHourStr && tzMinStr) {
    const tzHour = Number(tzHourStr);
    const tzMin = Number(tzMinStr);
    if (tzHour < 0 || tzHour > 23 || tzMin < 0 || tzMin > 59) return null;
    offsetMinutes = (tzSign === '-' ? -1 : 1) * (tzHour * 60 + tzMin);
  } else if (!isZ && (tzSign || tzHourStr || tzMinStr)) {
    return null;
  }

  let ms = 0;
  if (fractionStr) {
    ms = Number(fractionStr.slice(0, 3).padEnd(3, '0'));
  }

  const candidateUtcEpoch = Date.UTC(year, month - 1, day, hour, minute, second, ms) - (offsetMinutes * 60 * 1000);
  const dateObj = new Date(candidateUtcEpoch);
  if (Number.isNaN(dateObj.getTime())) return null;

  return {
    dateObj,
    normalizedIso: dateObj.toISOString()
  };
};

const normalizeOccurredAt = (val, { allowEmpty = true } = {}) => {
  if (val === undefined || val === null || val === '') {
    return '';
  }
  const parsed = parseStrictIsoDateTime(val);
  if (!parsed) {
    if (allowEmpty) return '';
    const err = new Error('Thời điểm phát sinh (occurredAt) không hợp lệ');
    err.status = 400;
    throw err;
  }
  return parsed.normalizedIso;
};

const resolveEventDateAndTime = (occurredAtInput) => {
  let dateObj;
  let normalizedOccurredAt = '';
  let hasExplicitOccurredAt = false;

  if (occurredAtInput !== undefined && occurredAtInput !== null && occurredAtInput !== '') {
    if (typeof occurredAtInput !== 'string') {
      const err = new Error('Thời điểm phát sinh (occurredAt) không hợp lệ');
      err.status = 400;
      throw err;
    }
    const parsed = parseStrictIsoDateTime(occurredAtInput);
    if (!parsed) {
      const err = new Error('Thời điểm phát sinh (occurredAt) không hợp lệ');
      err.status = 400;
      throw err;
    }
    dateObj = parsed.dateObj;
    normalizedOccurredAt = parsed.normalizedIso;
    hasExplicitOccurredAt = true;
  } else {
    dateObj = new Date();
    normalizedOccurredAt = '';
    hasExplicitOccurredAt = false;
  }

  const workDate = getWorkDate(dateObj, DEFAULT_SCHOOL_TIMEZONE);
  return { dateObj, normalizedOccurredAt, workDate, hasExplicitOccurredAt };
};

/**
 * V1 Fingerprint Contract:
 * - 64-char hex string (SHA256, no prefix)
 * - Canonical payload DOES NOT include occurredAt
 */
const computeFingerprintV1 = (canonicalObj) => {
  const sortedKeys = Object.keys(canonicalObj).sort();
  const sorted = {};
  for (const k of sortedKeys) {
    sorted[k] = canonicalObj[k];
  }
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
};

/**
 * V2 Fingerprint Contract:
 * - Prefixed with 'v2:'
 * - Canonical payload DOES include normalized occurredAt
 */
const computeFingerprintV2 = (canonicalObj) => {
  const sortedKeys = Object.keys(canonicalObj).sort();
  const sorted = {};
  for (const k of sortedKeys) {
    sorted[k] = canonicalObj[k];
  }
  const hash = crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
  return `v2:${hash}`;
};

const computeFingerprint = computeFingerprintV2;

// --- Gate ---
const canonicalGatePayloadV1 = ({ studentId, direction, method, note, gateDate }) => ({
  studentId: String(studentId?._id || studentId || ''),
  direction: String(direction || ''),
  method: String(method || 'manual'),
  gateDate: String(gateDate || ''),
  note: clean(note, 500)
});

const canonicalGatePayloadV2 = ({ studentId, direction, method, note, gateDate, occurredAt }) => ({
  studentId: String(studentId?._id || studentId || ''),
  direction: String(direction || ''),
  method: String(method || 'manual'),
  gateDate: String(gateDate || ''),
  occurredAt: normalizeOccurredAt(occurredAt),
  note: clean(note, 500)
});

const canonicalGatePayload = canonicalGatePayloadV2;

const canonicalGateFromDocV1 = (doc) => canonicalGatePayloadV1({
  studentId: doc.studentId,
  direction: doc.direction,
  method: doc.method,
  note: doc.note,
  gateDate: doc.gateDate
});

const canonicalGateFromDocV2 = (doc) => canonicalGatePayloadV2({
  studentId: doc.studentId,
  direction: doc.direction,
  method: doc.method,
  note: doc.note,
  gateDate: doc.gateDate,
  occurredAt: doc.occurredAt
});

const canonicalGateFromDoc = canonicalGateFromDocV2;

// --- Visitor ---
const canonicalVisitorPayloadV1 = ({ fullName, phone, organization, purpose, hostName, allowedArea, identityLast4, vehiclePlate, badgeNumber, visitDate, note }) => ({
  fullName: clean(fullName, 120),
  phone: clean(phone, 20),
  organization: clean(organization, 160),
  purpose: clean(purpose, 500),
  hostName: clean(hostName, 120),
  allowedArea: clean(allowedArea, 160),
  identityLast4: String(identityLast4 || ''),
  vehiclePlate: clean(vehiclePlate, 20).toUpperCase(),
  badgeNumber: clean(badgeNumber, 30).toUpperCase(),
  visitDate: String(visitDate || ''),
  note: clean(note, 500)
});

const canonicalVisitorPayloadV2 = ({ fullName, phone, organization, purpose, hostName, allowedArea, identityLast4, vehiclePlate, badgeNumber, visitDate, occurredAt, note }) => ({
  fullName: clean(fullName, 120),
  phone: clean(phone, 20),
  organization: clean(organization, 160),
  purpose: clean(purpose, 500),
  hostName: clean(hostName, 120),
  allowedArea: clean(allowedArea, 160),
  identityLast4: String(identityLast4 || ''),
  vehiclePlate: clean(vehiclePlate, 20).toUpperCase(),
  badgeNumber: clean(badgeNumber, 30).toUpperCase(),
  visitDate: String(visitDate || ''),
  occurredAt: normalizeOccurredAt(occurredAt),
  note: clean(note, 500)
});

const canonicalVisitorPayload = canonicalVisitorPayloadV2;

const canonicalVisitorFromDocV1 = (doc) => canonicalVisitorPayloadV1({
  fullName: doc.fullName,
  phone: doc.phone,
  organization: doc.organization,
  purpose: doc.purpose,
  hostName: doc.hostName,
  allowedArea: doc.allowedArea,
  identityLast4: doc.identityLast4,
  vehiclePlate: doc.vehiclePlate,
  badgeNumber: doc.badgeNumber,
  visitDate: doc.visitDate,
  note: doc.note
});

const canonicalVisitorFromDocV2 = (doc) => canonicalVisitorPayloadV2({
  fullName: doc.fullName,
  phone: doc.phone,
  organization: doc.organization,
  purpose: doc.purpose,
  hostName: doc.hostName,
  allowedArea: doc.allowedArea,
  identityLast4: doc.identityLast4,
  vehiclePlate: doc.vehiclePlate,
  badgeNumber: doc.badgeNumber,
  visitDate: doc.visitDate,
  occurredAt: doc.checkInAt || doc.occurredAt,
  note: doc.note
});

const canonicalVisitorFromDoc = canonicalVisitorFromDocV2;

// --- Incident ---
const canonicalIncidentPayloadV1 = ({ incidentDate, category, severity, location, description, actionTaken, studentId }) => ({
  incidentDate: String(incidentDate || ''),
  category: String(category || ''),
  severity: String(severity || 'normal'),
  location: clean(location, 160),
  description: clean(description, 2000),
  actionTaken: clean(actionTaken, 1000),
  studentId: studentId ? String(studentId?._id || studentId) : null
});

const canonicalIncidentPayloadV2 = ({ incidentDate, category, severity, location, description, actionTaken, studentId, occurredAt }) => ({
  incidentDate: String(incidentDate || ''),
  category: String(category || ''),
  severity: String(severity || 'normal'),
  location: clean(location, 160),
  description: clean(description, 2000),
  actionTaken: clean(actionTaken, 1000),
  studentId: studentId ? String(studentId?._id || studentId) : null,
  occurredAt: normalizeOccurredAt(occurredAt)
});

const canonicalIncidentPayload = canonicalIncidentPayloadV2;

const canonicalIncidentFromDocV1 = (doc) => canonicalIncidentPayloadV1({
  incidentDate: doc.incidentDate,
  category: doc.category,
  severity: doc.severity,
  location: doc.location,
  description: doc.description,
  actionTaken: doc.actionTaken,
  studentId: doc.studentId
});

const canonicalIncidentFromDocV2 = (doc) => canonicalIncidentPayloadV2({
  incidentDate: doc.incidentDate,
  category: doc.category,
  severity: doc.severity,
  location: doc.location,
  description: doc.description,
  actionTaken: doc.actionTaken,
  studentId: doc.studentId,
  occurredAt: doc.occurredAt || doc.createdAt
});

const canonicalIncidentFromDoc = canonicalIncidentFromDocV2;

// --- Delivery ---
const canonicalDeliveryPayloadV1 = ({ deliveryDate, purchaseOrderId, supplierName, driverName, phone, vehiclePlate, itemsDescription, recipientName, allowedArea, note }) => ({
  deliveryDate: String(deliveryDate || ''),
  purchaseOrderId: purchaseOrderId ? String(purchaseOrderId?._id || purchaseOrderId) : null,
  supplierName: clean(supplierName, 160),
  driverName: clean(driverName, 120),
  phone: clean(phone, 20),
  vehiclePlate: clean(vehiclePlate, 20).toUpperCase(),
  itemsDescription: clean(itemsDescription, 1000),
  recipientName: clean(recipientName, 120),
  allowedArea: clean(allowedArea, 160),
  note: clean(note, 500)
});

const canonicalDeliveryPayloadV2 = ({ deliveryDate, occurredAt, purchaseOrderId, supplierName, driverName, phone, vehiclePlate, itemsDescription, recipientName, allowedArea, note }) => ({
  deliveryDate: String(deliveryDate || ''),
  occurredAt: normalizeOccurredAt(occurredAt),
  purchaseOrderId: purchaseOrderId ? String(purchaseOrderId?._id || purchaseOrderId) : null,
  supplierName: clean(supplierName, 160),
  driverName: clean(driverName, 120),
  phone: clean(phone, 20),
  vehiclePlate: clean(vehiclePlate, 20).toUpperCase(),
  itemsDescription: clean(itemsDescription, 1000),
  recipientName: clean(recipientName, 120),
  allowedArea: clean(allowedArea, 160),
  note: clean(note, 500)
});

const canonicalDeliveryPayload = canonicalDeliveryPayloadV2;

const canonicalDeliveryFromDocV1 = (doc) => canonicalDeliveryPayloadV1({
  deliveryDate: doc.deliveryDate,
  purchaseOrderId: doc.purchaseOrderId,
  supplierName: doc.supplierName,
  driverName: doc.driverName,
  phone: doc.phone,
  vehiclePlate: doc.vehiclePlate,
  itemsDescription: doc.itemsDescription,
  recipientName: doc.recipientName,
  allowedArea: doc.allowedArea,
  note: doc.note
});

const canonicalDeliveryFromDocV2 = (doc) => canonicalDeliveryPayloadV2({
  deliveryDate: doc.deliveryDate,
  occurredAt: doc.checkInAt || doc.occurredAt,
  purchaseOrderId: doc.purchaseOrderId,
  supplierName: doc.supplierName,
  driverName: doc.driverName,
  phone: doc.phone,
  vehiclePlate: doc.vehiclePlate,
  itemsDescription: doc.itemsDescription,
  recipientName: doc.recipientName,
  allowedArea: doc.allowedArea,
  note: doc.note
});

const canonicalDeliveryFromDoc = canonicalDeliveryFromDocV2;

/**
 * Normalizes user/actor ID from various input forms:
 * - String ID (trimmed, non-empty)
 * - Mongoose ObjectId or BSON ObjectId (via toHexString or toString)
 * - Populated reference object with _id
 * Returns null if missing, empty, or invalid structure (Fail-closed).
 */
const extractActorId = (val) => {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof val === 'object' && !Array.isArray(val)) {
    // Check if it's an ObjectId directly (has toHexString)
    if (typeof val.toHexString === 'function') {
      const hex = val.toHexString();
      return typeof hex === 'string' && hex.trim() ? hex.trim() : null;
    }
    // Check populated reference with _id (guard against self-reference like ObjectId._id === ObjectId)
    if (val._id !== undefined && val._id !== val) {
      return extractActorId(val._id);
    }
    if (typeof val.toString === 'function') {
      const s = val.toString();
      if (s && s !== '[object Object]' && s.trim()) {
        return s.trim();
      }
    }
  }
  return null;
};

/**
 * Validates whether an existing record matches the incoming request for idempotent replay.
 * Handles:
 * 1. Fail-closed ownership verification (recordedBy / reportedBy)
 * 2. V2 fingerprint matching ('v2:...') against incoming request
 * 3. V1 legacy fingerprint matching (raw sha256 hex) against incoming V1 canonical AND timestamp verification
 * 4. Documents without fingerprint: verifies incoming V1 canonical against doc V1 canonical AND timestamp verification
 */
const verifyIdempotency = ({
  existingDoc,
  currentUserId,
  ownerField,
  incomingFingerprint,
  incomingCanonicalV2,
  incomingCanonicalV1,
  incomingNormalizedOccurredAt,
  canonicalFromDocV1Fn,
  canonicalFromDocV2Fn,
  canonicalFromDocFn
}) => {
  if (!existingDoc) return null;

  // 1. Ownership check (Fail-closed)
  const normalizedCurrentUserId = extractActorId(currentUserId);
  if (!normalizedCurrentUserId) {
    return {
      status: 'conflict',
      message: 'Không thể xác định danh tính người dùng hiện tại để kiểm tra quyền sở hữu bản ghi.'
    };
  }

  // Inspect existing doc ownership fields
  const hasRecordedBy = existingDoc.recordedBy !== undefined && existingDoc.recordedBy !== null && existingDoc.recordedBy !== '';
  const hasReportedBy = existingDoc.reportedBy !== undefined && existingDoc.reportedBy !== null && existingDoc.reportedBy !== '';

  const recordedById = hasRecordedBy ? extractActorId(existingDoc.recordedBy) : null;
  if (hasRecordedBy && !recordedById) {
    return {
      status: 'conflict',
      message: 'Dữ liệu chủ sở hữu bản ghi (recordedBy) không đúng cấu trúc hợp lệ.'
    };
  }

  const reportedById = hasReportedBy ? extractActorId(existingDoc.reportedBy) : null;
  if (hasReportedBy && !reportedById) {
    return {
      status: 'conflict',
      message: 'Dữ liệu chủ sở hữu bản ghi (reportedBy) không đúng cấu trúc hợp lệ.'
    };
  }

  // Conflict if both exist and contradict each other
  if (hasRecordedBy && hasReportedBy && recordedById !== reportedById) {
    return {
      status: 'conflict',
      message: 'Thông tin chủ sở hữu bản ghi không nhất quán giữa recordedBy và reportedBy. Thao tác bị từ chối để đảm bảo an toàn.'
    };
  }

  let docActorId = null;
  if (ownerField === 'recordedBy') {
    if (!hasRecordedBy) {
      return {
        status: 'conflict',
        message: 'Bản ghi thiếu thông tin chủ sở hữu (recordedBy). Không thể phát lại thao tác.'
      };
    }
    docActorId = recordedById;
  } else if (ownerField === 'reportedBy') {
    if (!hasReportedBy) {
      return {
        status: 'conflict',
        message: 'Bản ghi thiếu thông tin chủ sở hữu (reportedBy). Không thể phát lại thao tác.'
      };
    }
    docActorId = reportedById;
  } else {
    // Auto-detect when ownerField is omitted
    if (!hasRecordedBy && !hasReportedBy) {
      return {
        status: 'conflict',
        message: 'Bản ghi thiếu thông tin chủ sở hữu (recordedBy/reportedBy). Không thể phát lại thao tác.'
      };
    }
    docActorId = recordedById || reportedById;
  }

  if (!docActorId) {
    return {
      status: 'conflict',
      message: 'Không thể xác định chủ sở hữu hợp lệ của bản ghi cũ.'
    };
  }

  if (docActorId !== normalizedCurrentUserId) {
    return {
      status: 'conflict',
      message: 'Mã clientEventId đã tồn tại cho một người dùng khác. Vui lòng tạo thao tác mới.'
    };
  }

  // 2. Existing doc has payloadFingerprint
  if (existingDoc.payloadFingerprint) {
    // 2a. V2 fingerprint
    if (existingDoc.payloadFingerprint.startsWith('v2:')) {
      const incomingV2 = incomingFingerprint || (incomingCanonicalV2 ? computeFingerprintV2(incomingCanonicalV2) : null);
      if (incomingV2 && existingDoc.payloadFingerprint === incomingV2) {
        return { status: 'replay', doc: existingDoc };
      }
      return {
        status: 'conflict',
        message: 'Mã clientEventId đã tồn tại với nội dung khác. Không thể ghi đè bản ghi cũ.'
      };
    }

    // 2b. Legacy V1 fingerprint (no 'v2:' prefix)
    // First, verify timestamp data exists and matches
    const rawDocTime = existingDoc.checkInAt || existingDoc.occurredAt || existingDoc.createdAt;
    if (!rawDocTime) {
      return {
        status: 'conflict',
        message: 'Bản ghi cũ thiếu dữ liệu thời điểm để đối chiếu an toàn. Không thể phát lại thao tác.'
      };
    }
    const docDate = new Date(rawDocTime);
    if (Number.isNaN(docDate.getTime())) {
      return {
        status: 'conflict',
        message: 'Thời điểm trong bản ghi cũ không hợp lệ để đối chiếu an toàn.'
      };
    }
    const docIso = docDate.toISOString();
    if (!incomingNormalizedOccurredAt) {
      return {
        status: 'conflict',
        message: 'Yêu cầu thiếu thời điểm phát sinh để đối chiếu an toàn với bản ghi cũ.'
      };
    }
    if (incomingNormalizedOccurredAt !== docIso) {
      return {
        status: 'conflict',
        message: 'Mã clientEventId đã tồn tại với thời điểm phát sinh khác. Không thể ghi đè bản ghi cũ.'
      };
    }

    // Next, verify incoming request canonical payload against V1 fingerprint contract
    if (!incomingCanonicalV1) {
      return {
        status: 'conflict',
        message: 'Không có dữ liệu canonical v1 để đối chiếu bản ghi cũ.'
      };
    }
    const incomingV1Hash = computeFingerprintV1(incomingCanonicalV1);
    if (existingDoc.payloadFingerprint === incomingV1Hash) {
      return { status: 'replay', doc: existingDoc };
    }
    return {
      status: 'conflict',
      message: 'Mã clientEventId đã tồn tại với nội dung khác. Không thể ghi đè bản ghi cũ.'
    };
  }

  // 3. Existing doc has no payloadFingerprint (legacy un-fingerprinted doc)
  const rawDocTime = existingDoc.checkInAt || existingDoc.occurredAt || existingDoc.createdAt;
  if (!rawDocTime) {
    return {
      status: 'conflict',
      message: 'Bản ghi cũ thiếu dữ liệu thời điểm để đối chiếu an toàn. Không thể phát lại thao tác.'
    };
  }
  const docDate = new Date(rawDocTime);
  if (Number.isNaN(docDate.getTime())) {
    return {
      status: 'conflict',
      message: 'Thời điểm trong bản ghi cũ không hợp lệ để đối chiếu an toàn.'
    };
  }
  const docIso = docDate.toISOString();
  if (!incomingNormalizedOccurredAt || incomingNormalizedOccurredAt !== docIso) {
    return {
      status: 'conflict',
      message: 'Mã clientEventId đã tồn tại với thời điểm phát sinh khác. Không thể ghi đè bản ghi cũ.'
    };
  }

  const v1FromDocFn = canonicalFromDocV1Fn || canonicalFromDocFn;
  if (v1FromDocFn && incomingCanonicalV1) {
    const docV1Canonical = v1FromDocFn(existingDoc);
    const docV1Hash = computeFingerprintV1(docV1Canonical);
    const incomingV1Hash = computeFingerprintV1(incomingCanonicalV1);
    if (docV1Hash === incomingV1Hash) {
      return { status: 'replay', doc: existingDoc };
    }
  }

  return {
    status: 'conflict',
    message: 'Mã clientEventId đã tồn tại với nội dung khác. Không thể ghi đè bản ghi cũ.'
  };
};

module.exports = {
  parseStrictIsoDateTime,
  normalizeOccurredAt,
  resolveEventDateAndTime,
  computeFingerprint,
  computeFingerprintV1,
  computeFingerprintV2,
  canonicalGatePayload,
  canonicalGatePayloadV1,
  canonicalGatePayloadV2,
  canonicalVisitorPayload,
  canonicalVisitorPayloadV1,
  canonicalVisitorPayloadV2,
  canonicalIncidentPayload,
  canonicalIncidentPayloadV1,
  canonicalIncidentPayloadV2,
  canonicalDeliveryPayload,
  canonicalDeliveryPayloadV1,
  canonicalDeliveryPayloadV2,
  canonicalGateFromDoc,
  canonicalGateFromDocV1,
  canonicalGateFromDocV2,
  canonicalVisitorFromDoc,
  canonicalVisitorFromDocV1,
  canonicalVisitorFromDocV2,
  canonicalIncidentFromDoc,
  canonicalIncidentFromDocV1,
  canonicalIncidentFromDocV2,
  canonicalDeliveryFromDoc,
  canonicalDeliveryFromDocV1,
  canonicalDeliveryFromDocV2,
  extractActorId,
  verifyIdempotency
};
