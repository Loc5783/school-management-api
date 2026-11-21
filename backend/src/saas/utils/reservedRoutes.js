/**
 * Reserved Route Segment Definitions for SaaS Multi-Tenant Routing
 * 
 * Prevents route parameter shadowing where single-segment unapproved endpoints
 * (such as /export, /template, /active) get inadvertently captured by `/:id`
 * parameter handlers in schoolStudentRoutes and schoolClassroomRoutes.
 * 
 * By checking against this explicit bounded list and calling `next('router')`,
 * unapproved actions cleanly fall through to the downstream HTTP 501 tenantFeatureGate
 * (both when authenticated and unauthenticated), while preserving HTTP 400 Bad Request
 * handling for genuine malformed detail ID attempts (e.g., /invalid-id, /not-a-valid-objectid).
 */

const COMMON_RESERVED_SEGMENTS = Object.freeze([
  'export',
  'template',
  'templates',
  'import',
  'preview',
  'confirm',
  'active',
  'batch',
  'stats',
  'statistics',
  'summary',
  'search',
  'reports',
  'excel',
  'registration',
  'register',
  'download',
  'upload'
]);

const STUDENT_SPECIFIC_RESERVED = Object.freeze([
  'transfer',
  'transfers',
  'status',
  'profile'
]);

const CLASSROOM_SPECIFIC_RESERVED = Object.freeze([
  'homeroom-teacher',
  'registration-classrooms'
]);

const ATTENDANCE_SPECIFIC_RESERVED = Object.freeze([
  'webhook',
  'bulk',
  'check-in',
  'checkin',
  'leave-requests',
  'leave-request',
  'absence',
  'student',
  'students',
  'class',
  'classes',
  'classroom',
  'classrooms',
  'device',
  'devices',
  'device-events',
  'kiosk',
  'qr',
  'rfid',
  'card',
  'face'
]);

const RESERVED_STUDENT_SEGMENTS = new Set([
  ...COMMON_RESERVED_SEGMENTS,
  ...STUDENT_SPECIFIC_RESERVED
]);

const RESERVED_CLASSROOM_SEGMENTS = new Set([
  ...COMMON_RESERVED_SEGMENTS,
  ...CLASSROOM_SPECIFIC_RESERVED
]);

const RESERVED_ATTENDANCE_SEGMENTS = new Set([
  ...COMMON_RESERVED_SEGMENTS,
  ...ATTENDANCE_SPECIFIC_RESERVED
]);

const normalizeSegment = (segment) => String(segment || '').trim().toLowerCase();

const isReservedStudentSegment = (segment) => {
  return RESERVED_STUDENT_SEGMENTS.has(normalizeSegment(segment));
};

const isReservedClassroomSegment = (segment) => {
  return RESERVED_CLASSROOM_SEGMENTS.has(normalizeSegment(segment));
};

const isReservedAttendanceSegment = (segment) => {
  return RESERVED_ATTENDANCE_SEGMENTS.has(normalizeSegment(segment));
};

module.exports = {
  COMMON_RESERVED_SEGMENTS,
  STUDENT_SPECIFIC_RESERVED,
  CLASSROOM_SPECIFIC_RESERVED,
  ATTENDANCE_SPECIFIC_RESERVED,
  RESERVED_STUDENT_SEGMENTS,
  RESERVED_CLASSROOM_SEGMENTS,
  RESERVED_ATTENDANCE_SEGMENTS,
  normalizeSegment,
  isReservedStudentSegment,
  isReservedClassroomSegment,
  isReservedAttendanceSegment
};
