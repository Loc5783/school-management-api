'use strict';

/**
 * @fileoverview Dịch vụ Quản lý Cụm Máy Chấm Công Hikvision ISAPI, Phân bổ Bộ nhớ 500 Slot theo Phân hiệu (`campus`),
 * Đồng bộ Nhanh Song Song (Delta Sync) và Kéo/Đẩy 2 Chiều (Máy <-> Web) cho Nhân sự & Học sinh.
 *
 * Nâng cấp tốc độ & độ phủ 2 chiều:
 * 1. Song song hóa an toàn (`runWithConcurrency`): Chạy song song trên nhiều máy chấm công (4 máy/lượt)
 *    và tải/nạp song song 3-4 luồng/máy kết hợp Digest Session Cache.
 * 2. Đồng bộ Nhanh Delta (`fastDelta = true`): Tự động nhận biết hồ sơ & ảnh khuôn mặt `<200KB` không thay đổi
 *    để bỏ qua ghi thừa qua mạng, rút ngắn thời gian đồng bộ 200-500 người xuống vài giây.
 * 3. Kéo Nhanh 2 Phía (`pullAllFromDevices` & `quickBidirectionalSync`):
 *    - Máy -> Web: Kéo đồng thời Lịch sử quẹt chấm công/điểm danh (`AcsEvent`) + Hồ sơ & Ảnh khuôn mặt gốc (`FDLib`),
 *      hỗ trợ khớp theo Bảng Ánh Xạ ID máy, Mã NV/HS, Mã thẻ và cho phép Ghép nhanh 1 chạm (`linkPulledDeviceUserToSubject`).
 *    - Web -> Máy: Đẩy nhanh hồ sơ mới/cập nhật + ảnh mặt `<200KB` theo giới hạn 500 slot từng phân hiệu.
 */

const mongoose = require('mongoose');
const Tenant = require('../models/zone1_system/Tenant');
const User = require('../models/zone1_system/User');
const Classroom = require('../models/zone3_school/Classroom');
const Student = require('../models/zone3_school/Student');
const Employee = require('../models/zone2_hr/Employee');
const StaffShift = require('../models/zone2_hr/StaffShift');
const TimekeepingDevice = require('../models/zone2_hr/TimekeepingDevice');
const AttendanceDevicePersonMapping = require('../models/zone2_hr/AttendanceDevicePersonMapping');
const RawAttendanceEvent = require('../models/zone2_hr/RawAttendanceEvent');
const BiometricFaceProfile = require('../models/zone2_hr/BiometricFaceProfile');
const DeviceStoredPerson = require('../models/zone2_hr/DeviceStoredPerson');
const hikvisionIsapiService = require('./hikvisionIsapiService');
const { buildDeviceConfig, syncDeviceEvents } = require('./hikvisionSyncService');
const { ingestDeviceEvent, ingestStudentDeviceAttendance } = require('./attendanceDeviceService');
const { calculateAttendanceForUserDate } = require('./attendanceCalculationService');
const { createTrustedTenantContext } = require('./tenantFilterService');
const { getWorkDate, startOfWorkDate, DEFAULT_SCHOOL_TIMEZONE } = require('../utils/dateHelpers');
const { buildEncryptedDeviceAuthForConnector } = require('./localConnectorGrantService');
const { publishCampusRealtimeEvent } = require('./realtimeCampusEventHub');
const { formatFriendlyVietnameseHardwareNotice } = require('../utils/vietnameseHardwareTranslator');

const DEFAULT_CAMPUS_NAME = 'Cơ sở chính';
const MAX_FACE_BYTES = hikvisionIsapiService.MAX_HIKVISION_FACE_BYTES || 200 * 1024;
const MAX_BASE64_INPUT_CHARS = 360000; // Chặn sớm O(1) trước khi cấp phát Buffer cho chuỗi Base64 quá lớn
const DEVICE_PARALLEL_LIMIT = 4;
const PER_DEVICE_IO_CONCURRENCY = 3;
const DEVICE_BIOMETRIC_LOCK_TTL_MS = 90 * 1000;

// Khóa chống đụng độ thao tác đồng bộ/kéo/xóa đồng thời trên cùng 1 máy chấm công vật lý
const activeDeviceBiometricLocks = new Map();

async function withDeviceBiometricLock(deviceId, opName, fn) {
  const key = String(deviceId || '');
  const now = Date.now();
  const lockedUntil = activeDeviceBiometricLocks.get(key);
  if (lockedUntil && lockedUntil > now) {
    const busyErr = new Error(
      `Thiết bị đang bận xử lý tiến trình khác (${opName}). Vui lòng đợi vài giây rồi thử lại.`
    );
    busyErr.code = 'DEVICE_BUSY';
    busyErr.statusCode = 409;
    throw busyErr;
  }
  activeDeviceBiometricLocks.set(key, now + DEVICE_BIOMETRIC_LOCK_TTL_MS);
  try {
    return await fn();
  } finally {
    activeDeviceBiometricLocks.delete(key);
  }
}

const POSITION_LABELS = Object.freeze({
  principal: 'Hiệu trưởng / Giám đốc',
  vice_principal: 'Phó Hiệu trưởng',
  head_teacher: 'Tổ trưởng chuyên môn',
  teacher: 'Giáo viên đứng lớp',
  assistant_teacher: 'Giáo viên phụ / Bảo mẫu',
  accountant: 'Kế toán trường',
  chef: 'Đầu bếp / Cấp dưỡng',
  hr: 'Nhân sự hành chính',
  nurse: 'Nhân viên Y tế',
  security: 'Bảo vệ an ninh',
  guard: 'Bảo vệ an ninh',
  cleaner: 'Nhân viên tạp vụ'
});

/**
 * Bộ điều phối chạy song song giới hạn số luồng (`concurrency`) để tăng tốc ISAPI mà không làm treo CPU máy chấm công.
 */
async function runWithConcurrency(items, concurrency, workerFn) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency || 3, list.length));
  const results = new Array(list.length);
  let cursor = 0;

  async function runner() {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= list.length) break;
      results[idx] = await workerFn(list[idx], idx);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runner()));
  return results;
}

function removeVietnameseTones(str = '') {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

function createServiceError(message, code, statusCode = 400) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

/**
 * KHÓA CỨNG MÃ PHẦN CỨNG `deviceSerial` GẮN CHẶT VỚI PHÂN HIỆU (`tenantId` / `campus_id`):
 * - Nếu `actualSerial` đọc từ máy Hikvision đang thuộc về một `tenantId` khác -> CHẶN CỨNG (`SERIAL_LOCKED_OTHER_CAMPUS`).
 * - Nếu bản ghi máy hiện tại đã khóa `deviceDoc.serialNumber` mà phần cứng thực tế tại IP đó trả về Serial khác -> CHẶN CỨNG (`HARDWARE_SERIAL_MISMATCH`).
 * - Nếu bản ghi máy chưa lưu Serial và `actualSerial` chưa thuộc trường nào -> Tự động gắn khóa `serialNumber` + `serialLockedAt` cho phân hiệu này!
 */
async function assertDeviceSerialCampusLock(tenantId, deviceDoc, actualSerial = '') {
  const cleanActual = String(actualSerial || '').trim();
  if (!cleanActual) return;

  const foreignConflict = await TimekeepingDevice.findOne({
    serialNumber: cleanActual,
    tenantId: { $ne: tenantId }
  })
    .select('_id tenantId name campus serialNumber')
    .lean();

  if (foreignConflict) {
    throw createServiceError(
      'Chiếc máy chấm công này hiện đang được khóa bảo mật cho một phân hiệu trường khác trên hệ thống. Hệ thống đã tự động dừng lại để không kéo hoặc đẩy nhầm danh sách học sinh. Vui lòng liên hệ Kỹ thuật viên Nhà cung cấp phần mềm nếu bạn cần chuyển máy về phân hiệu của mình.',
      'SERIAL_LOCKED_OTHER_CAMPUS',
      409
    );
  }

  if (deviceDoc.serialNumber && String(deviceDoc.serialNumber).trim() !== cleanActual) {
    throw createServiceError(
      `Chiếc máy chấm công tại địa chỉ ${deviceDoc.host} có mã phần cứng (${cleanActual}) không khớp với máy "${deviceDoc.name}" đã khóa cho phân hiệu của bạn (${deviceDoc.serialNumber}). Hệ thống đã tự động khóa an toàn để bảo vệ dữ liệu học sinh.`,
      'HARDWARE_SERIAL_MISMATCH',
      409
    );
  }

  if (!deviceDoc.serialNumber) {
    const sameTenantDup = await TimekeepingDevice.findOne({
      tenantId,
      serialNumber: cleanActual,
      _id: { $ne: deviceDoc._id }
    })
      .select('_id name')
      .lean();
    if (sameTenantDup) {
      throw createServiceError(
        `Chiếc máy chấm công này đã được lưu sẵn trong phân hiệu dưới tên "${sameTenantDup.name}".`,
        'DUPLICATE_SERIAL_SAME_CAMPUS',
        409
      );
    }
    deviceDoc.serialNumber = cleanActual;
    deviceDoc.serialLockedAt = new Date();
  }
}

/**
 * Giải mã chuỗi Base64 hoặc Data URL thành Buffer ảnh và kiểm tra chuẩn JPEG/PNG <= 200KB.
 */
function parseAndValidateFaceImagePayload(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') {
    throw createServiceError('Vui lòng cung cấp dữ liệu ảnh khuôn mặt hợp lệ', 'INVALID_FACE_IMAGE', 400);
  }
  if (rawInput.length > MAX_BASE64_INPUT_CHARS) {
    throw createServiceError(
      'Dữ liệu ảnh khuôn mặt vượt giới hạn phần cứng 200 KB của máy chấm công Hikvision',
      'FACE_IMAGE_TOO_LARGE',
      400
    );
  }

  let cleanBase64 = rawInput.trim();
  let declaredMime = 'image/jpeg';

  const dataUrlMatch = cleanBase64.match(/^data:(image\/(?:jpeg|jpg|png));base64,([\s\S]+)$/i);
  if (dataUrlMatch) {
    declaredMime = dataUrlMatch[1].toLowerCase() === 'image/png' ? 'image/png' : 'image/jpeg';
    cleanBase64 = dataUrlMatch[2].replace(/\s+/g, '');
  } else {
    cleanBase64 = cleanBase64.replace(/\s+/g, '');
  }

  const buffer = Buffer.from(cleanBase64, 'base64');
  if (!buffer || buffer.length < 100) {
    throw createServiceError('Dữ liệu ảnh khuôn mặt bị rỗng hoặc hỏng', 'CORRUPT_FACE_IMAGE', 400);
  }

  if (buffer.length > MAX_FACE_BYTES) {
    const kb = Math.round((buffer.length / 1024) * 10) / 10;
    throw createServiceError(
      `Ảnh khuôn mặt (${kb} KB) vượt giới hạn phần cứng 200 KB của máy chấm công Hikvision`,
      'FACE_IMAGE_TOO_LARGE',
      400
    );
  }

  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50;
  if (!isJpeg && !isPng) {
    throw createServiceError('Ảnh khuôn mặt phải ở định dạng chuẩn JPEG hoặc PNG', 'UNSUPPORTED_FACE_FORMAT', 400);
  }

  return {
    buffer,
    mimeType: isPng ? 'image/png' : (declaredMime || 'image/jpeg'),
    imageBase64: buffer.toString('base64'),
    sizeBytes: buffer.length
  };
}

/**
 * Tải toàn bộ danh sách Phân hiệu, Nhân sự, Học sinh và Hồ sơ Ảnh khuôn mặt của trường (`tenantId`).
 */
async function loadTenantBiometricContext(tenantId) {
  const [tenantDoc, classrooms, employees, staffUsers, students, faceProfiles] = await Promise.all([
    Tenant.findById(tenantId).select('name code campuses').lean(),
    Classroom.find({ tenantId })
      .select('_id name campus status homeroomTeacherId teachers')
      .lean(),
    Employee.find({ tenantId })
      .select('_id userId employeeCode fullName position payrollRole campus departmentName status')
      .lean(),
    User.find({
      tenantId,
      role: { $in: ['principal', 'teacher', 'accountant', 'chef', 'guard', 'hr'] }
    })
      .select('_id username role status profile employeeInfo')
      .lean(),
    Student.find({ tenantId })
      .select('_id studentCode fullName avatar classroomId className status attendanceCardId faceProfileId')
      .lean(),
    BiometricFaceProfile.find({ tenantId })
      .select('_id subjectType subjectId linkedUserId personCode campus mimeType imageBase64 sizeBytes source updatedAt lastSyncedAt syncedDeviceIds')
      .lean()
  ]);

  const campusSet = new Set([DEFAULT_CAMPUS_NAME]);
  if (Array.isArray(tenantDoc?.campuses)) {
    for (const c of tenantDoc.campuses) {
      if (c?.isActive !== false && c?.name && String(c.name).trim()) {
        campusSet.add(String(c.name).trim());
      }
    }
  }
  const classroomMap = new Map();
  const teacherCampusMap = new Map();
  for (const cls of classrooms) {
    const campusName = String(cls.campus || DEFAULT_CAMPUS_NAME).trim() || DEFAULT_CAMPUS_NAME;
    campusSet.add(campusName);
    classroomMap.set(String(cls._id), {
      name: cls.name,
      campus: campusName,
      status: cls.status
    });
    if (cls.status === 'active') {
      if (cls.homeroomTeacherId) {
        teacherCampusMap.set(String(cls.homeroomTeacherId), campusName);
      }
      if (Array.isArray(cls.teachers)) {
        for (const t of cls.teachers) {
          if (t?.teacherId && !teacherCampusMap.has(String(t.teacherId))) {
            teacherCampusMap.set(String(t.teacherId), campusName);
          }
        }
      }
    }
  }

  for (const emp of employees) {
    if (emp.campus && String(emp.campus).trim()) {
      campusSet.add(String(emp.campus).trim());
    }
  }

  const faceByKey = new Map();
  const faceByCode = new Map();
  for (const fp of faceProfiles) {
    faceByKey.set(`${fp.subjectType}:${String(fp.subjectId)}`, fp);
    if (fp.personCode) {
      faceByCode.set(String(fp.personCode).trim().toUpperCase(), fp);
    }
  }

  const userById = new Map(staffUsers.map((u) => [String(u._id), u]));
  const coveredUserIds = new Set();
  const unifiedRoster = [];

  for (const emp of employees) {
    const linkedUser = emp.userId ? userById.get(String(emp.userId)) : null;
    if (linkedUser) {
      coveredUserIds.add(String(linkedUser._id));
    }
    const personCode = String(emp.employeeCode || linkedUser?.employeeInfo?.employeeId || '').trim().toUpperCase();
    const resolvedCampus =
      (emp.campus && String(emp.campus).trim()) ||
      (emp.userId ? teacherCampusMap.get(String(emp.userId)) : null) ||
      DEFAULT_CAMPUS_NAME;

    const isResigned =
      emp.status === 'resigned' ||
      (linkedUser && ['inactive', 'suspended', 'locked'].includes(linkedUser.status));
    const isActive = !isResigned;

    const faceDoc =
      faceByKey.get(`EMPLOYEE:${String(emp._id)}`) ||
      (linkedUser ? faceByKey.get(`EMPLOYEE:${String(linkedUser._id)}`) : null) ||
      (personCode ? faceByCode.get(personCode) : null) ||
      null;

    unifiedRoster.push({
      subjectType: 'EMPLOYEE',
      subjectId: String(emp._id),
      employeeRecordId: String(emp._id),
      userId: linkedUser ? String(linkedUser._id) : (emp.userId ? String(emp.userId) : null),
      mappingSubjectId: linkedUser ? String(linkedUser._id) : String(emp.userId || emp._id),
      personCode,
      altCodes: [],
      username: linkedUser?.username || '',
      fullName: emp.fullName || linkedUser?.profile?.fullName || linkedUser?.username || '',
      webAvatar: '',
      roleOrClassLabel: POSITION_LABELS[emp.position] || emp.departmentName || 'Nhân sự',
      campus: resolvedCampus,
      status: emp.status,
      isActive,
      isReclaimableInactive: isResigned && Boolean(personCode),
      hasBiometricFace: Boolean(faceDoc),
      faceSizeKB: faceDoc ? Math.max(1, Math.round((faceDoc.sizeBytes / 1024) * 10) / 10) : 0,
      faceDataUrl: faceDoc ? `data:${faceDoc.mimeType || 'image/jpeg'};base64,${faceDoc.imageBase64}` : '',
      faceSource: faceDoc?.source || null,
      faceProfileDoc: faceDoc
    });
  }

  for (const u of staffUsers) {
    if (coveredUserIds.has(String(u._id))) continue;
    const personCode = String(u.employeeInfo?.employeeId || '').trim().toUpperCase();
    if (!personCode) continue;

    const resolvedCampus = teacherCampusMap.get(String(u._id)) || DEFAULT_CAMPUS_NAME;
    const isActive = u.status === 'active';
    const faceDoc =
      faceByKey.get(`EMPLOYEE:${String(u._id)}`) ||
      faceByCode.get(personCode) ||
      null;

    unifiedRoster.push({
      subjectType: 'EMPLOYEE',
      subjectId: String(u._id),
      employeeRecordId: null,
      userId: String(u._id),
      mappingSubjectId: String(u._id),
      personCode,
      altCodes: [],
      username: u.username || '',
      fullName: u.profile?.fullName || u.username || personCode,
      webAvatar: '',
      roleOrClassLabel: POSITION_LABELS[u.role] || 'Nhân sự',
      campus: resolvedCampus,
      status: u.status,
      isActive,
      isReclaimableInactive: !isActive && Boolean(personCode),
      hasBiometricFace: Boolean(faceDoc),
      faceSizeKB: faceDoc ? Math.max(1, Math.round((faceDoc.sizeBytes / 1024) * 10) / 10) : 0,
      faceDataUrl: faceDoc ? `data:${faceDoc.mimeType || 'image/jpeg'};base64,${faceDoc.imageBase64}` : '',
      faceSource: faceDoc?.source || null,
      faceProfileDoc: faceDoc
    });
  }

  for (const stu of students) {
    const clsMeta = stu.classroomId ? classroomMap.get(String(stu.classroomId)) : null;
    const resolvedCampus = clsMeta?.campus || DEFAULT_CAMPUS_NAME;
    const personCode = String(stu.studentCode || '').trim().toUpperCase();
    const isActive = ['enrolled', 'temporarily_absent'].includes(stu.status);
    const isReclaimableInactive = ['withdrawn', 'transferred', 'graduated'].includes(stu.status) && Boolean(personCode);

    const altCodes = [
      stu.attendanceCardId ? String(stu.attendanceCardId).trim().toUpperCase() : '',
      stu.faceProfileId ? String(stu.faceProfileId).trim().toUpperCase() : '',
      personCode ? personCode.replace(/[^A-Z0-9]/g, '') : ''
    ].filter(Boolean);

    const faceDoc =
      faceByKey.get(`STUDENT:${String(stu._id)}`) ||
      (personCode ? faceByCode.get(personCode) : null) ||
      null;

    unifiedRoster.push({
      subjectType: 'STUDENT',
      subjectId: String(stu._id),
      employeeRecordId: null,
      userId: null,
      mappingSubjectId: String(stu._id),
      personCode,
      altCodes,
      username: '',
      fullName: stu.fullName,
      webAvatar: stu.avatar || '',
      roleOrClassLabel: stu.className || clsMeta?.name || 'Học sinh',
      campus: resolvedCampus,
      status: stu.status,
      isActive,
      isReclaimableInactive,
      hasBiometricFace: Boolean(faceDoc),
      faceSizeKB: faceDoc ? Math.max(1, Math.round((faceDoc.sizeBytes / 1024) * 10) / 10) : 0,
      faceDataUrl: faceDoc ? `data:${faceDoc.mimeType || 'image/jpeg'};base64,${faceDoc.imageBase64}` : '',
      faceSource: faceDoc?.source || null,
      faceProfileDoc: faceDoc
    });
  }

  return {
    tenantDoc,
    campuses: Array.from(campusSet),
    unifiedRoster
  };
}

/**
 * Tự động đồng bộ bảng ánh xạ `AttendanceDevicePersonMapping` cho thiết bị sau khi Push/Pull thành công.
 */
async function ensureDevicePersonMapping(tenantId, deviceId, rosterItem, actorId = null, externalCodeOverride = null) {
  const extCode = String(externalCodeOverride || rosterItem?.personCode || '').trim();
  if (!extCode || !rosterItem?.mappingSubjectId) return;
  if (!mongoose.isValidObjectId(rosterItem.mappingSubjectId)) return;

  try {
    await AttendanceDevicePersonMapping.findOneAndUpdate(
      {
        tenantId,
        deviceId,
        externalPersonId: extCode
      },
      {
        $set: {
          subjectType: rosterItem.subjectType,
          subjectId: new mongoose.Types.ObjectId(rosterItem.mappingSubjectId),
          userId:
            rosterItem.subjectType === 'EMPLOYEE' && rosterItem.userId
              ? new mongoose.Types.ObjectId(rosterItem.userId)
              : undefined,
          studentId: rosterItem.subjectType === 'STUDENT' ? new mongoose.Types.ObjectId(rosterItem.mappingSubjectId) : undefined,
          active: true,
          metadata: {
            displayName: rosterItem.fullName || extCode,
            note: `Đồng bộ tự động theo phân hiệu ${rosterItem.campus || DEFAULT_CAMPUS_NAME}`
          },
          ...(actorId ? { createdBy: actorId } : {})
        }
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
  } catch {
    // Bỏ qua nếu đối tượng đã được ánh xạ với một externalPersonId khác trên cùng thiết bị
  }
}

/**
 * Phân bổ thông minh 500 slot/máy theo Phân hiệu (`campus`) và Ca trực hôm nay.
 */
async function selectTargetRosterForDeviceCapacity(tenantId, device, unifiedRoster) {
  const maxCap = Math.max(10, Number(device.maxUserCapacity) || 500);
  const mode = device.syncAllocationMode || 'BY_CAMPUS_PRIORITY';
  const scope = device.syncTargetScope || 'ALL';
  const deviceCampus = String(device.campus || DEFAULT_CAMPUS_NAME).trim();

  const eligibleActive = [];
  const codesToPrune = [];

  for (const item of unifiedRoster) {
    if (!item.personCode) continue;

    if (!item.isActive) {
      if (item.isReclaimableInactive) {
        codesToPrune.push(item.personCode);
      }
      continue;
    }

    if (scope === 'EMPLOYEE_ONLY' && item.subjectType !== 'EMPLOYEE') continue;
    if (scope === 'STUDENT_ONLY' && item.subjectType !== 'STUDENT') continue;

    if (mode === 'BY_CAMPUS_PRIORITY' && deviceCampus && deviceCampus !== 'ALL') {
      if (item.campus !== deviceCampus) continue;
    }

    eligibleActive.push(item);
  }

  let todayShiftEmployeeIds = new Set();
  if (eligibleActive.length > maxCap || mode === 'TODAY_ATTENDANCE_FIRST') {
    const todayStr = getWorkDate(new Date(), device.timezone || DEFAULT_SCHOOL_TIMEZONE);
    const todayWeekday = new Date(`${todayStr}T00:00:00.000Z`).getUTCDay();
    const shifts = await StaffShift.find({
      tenantId,
      status: 'active',
      validFrom: { $lte: todayStr },
      validUntil: { $gte: todayStr },
      weekdays: todayWeekday
    })
      .select('employeeId')
      .lean()
      .catch(() => []);

    todayShiftEmployeeIds = new Set(
      shifts.map((s) => (s.employeeId ? String(s.employeeId) : null)).filter(Boolean)
    );
  }

  const scored = eligibleActive.map((item) => {
    let score = 0;
    if (deviceCampus && deviceCampus !== 'ALL' && item.campus === deviceCampus) score += 500;
    if (item.subjectType === 'EMPLOYEE') {
      score += 120;
      if (item.employeeRecordId && todayShiftEmployeeIds.has(item.employeeRecordId)) {
        score += 200;
      }
    } else {
      score += 90;
    }
    if (item.hasBiometricFace) score += 30;
    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score || a.item.personCode.localeCompare(b.item.personCode));

  const selectedTargets = scored.slice(0, maxCap).map((x) => x.item);
  const overflowCodes = scored.slice(maxCap).map((x) => x.item.personCode);

  return {
    selectedTargets,
    codesToPrune: Array.from(new Set([...codesToPrune, ...overflowCodes]))
  };
}

/**
 * Lấy tổng quan cụm máy chấm công, 4 chỉ số KPI 500-slot và danh sách Nhân sự/Học sinh theo Phân hiệu.
 */
/**
 * Đồng bộ bảng lưu trữ hồ sơ thực tế trên từng máy chấm công (`DeviceStoredPerson`) bằng `bulkWrite` hiệu năng cao.
 * Giúp giao diện Web luôn hiển thị đầy đủ Tên + Mã trên máy + Ảnh khuôn mặt thật đang lưu trong từng máy.
 */
async function syncDeviceStoredPersonsSnapshot(tenantId, deviceId, rawUsers = [], { pruneMissing = true } = {}) {
  const safeUsers = Array.isArray(rawUsers) ? rawUsers : [];
  const ops = [];
  const activeExtIds = [];
  const now = new Date();

  for (const u of safeUsers) {
    const extId = String(u?.employeeNo || u?.externalPersonId || u?.personCode || '').trim();
    if (!extId) continue;
    activeExtIds.push(extId);

    let mimeType = 'image/jpeg';
    let imageBase64 = '';
    let sizeBytes = 0;
    const rawDataUrl = u.faceDataUrl || (u.imageBase64 ? `data:image/jpeg;base64,${u.imageBase64}` : '');
    if (rawDataUrl) {
      try {
        const parsed = parseAndValidateFaceImagePayload(rawDataUrl);
        mimeType = parsed.mimeType;
        imageBase64 = parsed.imageBase64;
        sizeBytes = parsed.sizeBytes;
      } catch {
        imageBase64 = '';
      }
    }

    const updateFields = {
      nameOnDevice: String(u.name ?? u.fullName ?? '').trim(),
      numOfFace: Number(u.numOfFace || (imageBase64 ? 1 : 0)),
      numOfCard: Number(u.numOfCard || 0),
      numOfFP: Number(u.numOfFP || 0),
      lastPulledAt: now
    };
    if (imageBase64) {
      updateFields.mimeType = mimeType;
      updateFields.imageBase64 = imageBase64;
      updateFields.sizeBytes = sizeBytes;
    }

    ops.push({
      updateOne: {
        filter: { tenantId, deviceId, externalPersonId: extId },
        update: { $set: updateFields },
        upsert: true
      }
    });
  }

  if (ops.length > 0) {
    await DeviceStoredPerson.bulkWrite(ops, { ordered: false });
  }
  if (pruneMissing) {
    if (activeExtIds.length === 0) {
      await DeviceStoredPerson.deleteMany({ tenantId, deviceId });
    } else {
      await DeviceStoredPerson.deleteMany({
        tenantId,
        deviceId,
        externalPersonId: { $nin: activeExtIds }
      });
    }
  }
}

function buildRosterLookupMaps(unifiedRoster = [], deviceMappings = []) {
  const byMappingSubjKey = new Map();
  const byCode = new Map();
  const byUsername = new Map();
  const byCampusAndToneFreeName = new Map();
  const byToneFreeName = new Map();

  for (const item of unifiedRoster) {
    if (!item.isActive) continue;
    byMappingSubjKey.set(`${item.subjectType}:${item.subjectId}`, item);
    if (item.mappingSubjectId) {
      byMappingSubjKey.set(`${item.subjectType}:${item.mappingSubjectId}`, item);
    }
    if (item.personCode) {
      byCode.set(item.personCode.toUpperCase(), item);
    }
    if (Array.isArray(item.altCodes)) {
      for (const alt of item.altCodes) {
        if (alt && !byCode.has(alt.toUpperCase())) {
          byCode.set(alt.toUpperCase(), item);
        }
      }
    }
    if (item.username) {
      byUsername.set(item.username.toLowerCase(), item);
    }
    const cleanName = removeVietnameseTones(item.fullName);
    if (cleanName) {
      byCampusAndToneFreeName.set(`${item.campus}::${cleanName}`, item);
      if (!byToneFreeName.has(cleanName)) {
        byToneFreeName.set(cleanName, item);
      }
    }
  }

  const byDeviceAndExtId = new Map();
  const byExtIdOnly = new Map();
  for (const m of deviceMappings) {
    const extKey = String(m.externalPersonId || '').trim().toUpperCase();
    const targetId = String(m.studentId || m.userId || m.subjectId || '');
    const rosterMatch =
      byMappingSubjKey.get(`${m.subjectType}:${targetId}`) ||
      byMappingSubjKey.get(`${m.subjectType}:${String(m.subjectId || '')}`);
    if (extKey && rosterMatch) {
      byDeviceAndExtId.set(`${String(m.deviceId)}::${extKey}`, rosterMatch);
      if (!byExtIdOnly.has(extKey)) byExtIdOnly.set(extKey, rosterMatch);
    }
  }

  const matchDeviceUser = (deviceDoc, extIdRaw, nameRaw) => {
    const codeUpper = String(extIdRaw || '').trim().toUpperCase();
    const devNameNoTone = removeVietnameseTones(nameRaw || '');
    const devIdStr = deviceDoc?._id ? String(deviceDoc._id) : '';
    return (
      (devIdStr ? byDeviceAndExtId.get(`${devIdStr}::${codeUpper}`) : null) ||
      byExtIdOnly.get(codeUpper) ||
      byCode.get(codeUpper) ||
      byUsername.get(String(nameRaw || '').trim().toLowerCase()) ||
      (devNameNoTone && deviceDoc?.campus && deviceDoc.campus !== 'ALL'
        ? byCampusAndToneFreeName.get(`${deviceDoc.campus}::${devNameNoTone}`)
        : null) ||
      (devNameNoTone ? byToneFreeName.get(devNameNoTone) : null) ||
      null
    );
  };

  return { matchDeviceUser };
}

async function getBiometricOverview(tenantId, query = {}, sanitizeDeviceFn = (d) => d) {
  const campusFilter = query.campus && query.campus !== 'ALL' ? String(query.campus).trim() : 'ALL';
  const subjectFilter = ['EMPLOYEE', 'STUDENT'].includes(String(query.subjectType || '').toUpperCase())
    ? String(query.subjectType).toUpperCase()
    : 'ALL';
  const faceFilter = ['WITH_FACE', 'MISSING_FACE'].includes(String(query.faceStatus || '').toUpperCase())
    ? String(query.faceStatus).toUpperCase()
    : 'ALL';
  const search = String(query.search || '').trim().toLowerCase();
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(200, Math.max(10, Number(query.limit) || 60));

  const [deviceDocs, bioCtx] = await Promise.all([
    TimekeepingDevice.find({ tenantId }).sort({ campus: 1, createdAt: 1 }),
    loadTenantBiometricContext(tenantId)
  ]);

  const campusSet = new Set(bioCtx.campuses);
  for (const dev of deviceDocs) {
    if (dev.campus && dev.campus !== 'ALL') {
      campusSet.add(dev.campus);
    }
  }

  const deviceCodes = deviceDocs.map((d) => d.deviceCode);
  const unmappedCounts = deviceCodes.length > 0
    ? await RawAttendanceEvent.aggregate([
        { $match: { tenantId, deviceId: { $in: deviceCodes }, mappingStatus: 'UNMAPPED' } },
        { $group: { _id: '$deviceId', count: { $sum: 1 } } }
      ])
    : [];
  const unmappedMap = new Map(unmappedCounts.map((u) => [u._id, u.count]));

  const filteredDeviceDocs = deviceDocs.filter(
    (d) => campusFilter === 'ALL' || d.campus === campusFilter || d.campus === 'ALL'
  );
  const filteredDeviceIds = filteredDeviceDocs.map((d) => d._id);

  const [storedPersonsDocs, allDeviceMappings] =
    filteredDeviceIds.length > 0
      ? await Promise.all([
          DeviceStoredPerson.find({ tenantId, deviceId: { $in: filteredDeviceIds } })
            .sort({ externalPersonId: 1 })
            .lean(),
          AttendanceDevicePersonMapping.find({
            tenantId,
            deviceId: { $in: filteredDeviceIds },
            active: true
          }).lean()
        ])
      : [[], []];

  const deviceByIdMap = new Map(filteredDeviceDocs.map((d) => [String(d._id), d]));
  const { matchDeviceUser } = buildRosterLookupMaps(bioCtx.unifiedRoster, allDeviceMappings);

  // Ghi nhận hồ sơ Web nào đang nằm trên những máy chấm công nào
  const webSubjectOnDevicesMap = new Map();
  let unmatchedOnDevicesCount = 0;

  const deviceStoredPeople = storedPersonsDocs.map((sp) => {
    const devDoc = deviceByIdMap.get(String(sp.deviceId));
    const matched = matchDeviceUser(devDoc, sp.externalPersonId, sp.nameOnDevice);
    if (matched) {
      const subjKey = `${matched.subjectType}:${matched.subjectId}`;
      if (!webSubjectOnDevicesMap.has(subjKey)) {
        webSubjectOnDevicesMap.set(subjKey, new Set());
      }
      if (devDoc?.name) {
        webSubjectOnDevicesMap.get(subjKey).add(devDoc.name);
      }
    } else {
      unmatchedOnDevicesCount += 1;
    }

    const hasFaceImg = Boolean(sp.imageBase64);
    return {
      _id: String(sp._id),
      deviceId: String(sp.deviceId),
      deviceName: devDoc?.name || 'Máy chấm công',
      deviceCode: devDoc?.deviceCode || '',
      deviceHost: devDoc?.host || '',
      deviceCampus: devDoc?.campus || DEFAULT_CAMPUS_NAME,
      externalPersonId: sp.externalPersonId,
      nameOnDevice: sp.nameOnDevice || `Mã ${sp.externalPersonId}`,
      numOfFace: Number(sp.numOfFace || (hasFaceImg ? 1 : 0)),
      hasFaceOnDevice: Boolean(Number(sp.numOfFace || 0) > 0 || hasFaceImg),
      faceSizeKB: hasFaceImg ? Math.max(1, Math.round(((sp.sizeBytes || 0) / 1024) * 10) / 10) : 0,
      faceDataUrl: hasFaceImg ? `data:${sp.mimeType || 'image/jpeg'};base64,${sp.imageBase64}` : '',
      lastPulledAt: sp.lastPulledAt,
      isMatchedOnWeb: Boolean(matched),
      matchedSubjectType: matched?.subjectType || null,
      matchedSubjectId: matched?.subjectId || null,
      matchedPersonCode: matched?.personCode || '',
      matchedFullName: matched?.fullName || '',
      matchedRoleOrClass: matched?.roleOrClassLabel || ''
    };
  });

  // Đếm số hồ sơ thực tế lưu trong từng máy để hiển thị chính xác trên thẻ máy
  const storedCountByDevId = new Map();
  const storedFaceCountByDevId = new Map();
  for (const sp of deviceStoredPeople) {
    storedCountByDevId.set(sp.deviceId, (storedCountByDevId.get(sp.deviceId) || 0) + 1);
    if (sp.hasFaceOnDevice) {
      storedFaceCountByDevId.set(sp.deviceId, (storedFaceCountByDevId.get(sp.deviceId) || 0) + 1);
    }
  }

  const filteredDevices = filteredDeviceDocs.map((d) => {
    const dIdStr = String(d._id);
    const snapCount = storedCountByDevId.get(dIdStr) || 0;
    const snapFaceCount = storedFaceCountByDevId.get(dIdStr) || 0;
    const dto = sanitizeDeviceFn(d);
    return {
      ...dto,
      currentStoredUsers: Math.max(Number(dto.currentStoredUsers) || 0, snapCount),
      currentStoredFaces: Math.max(Number(dto.currentStoredFaces) || 0, snapFaceCount),
      storedSnapshotCount: snapCount,
      unmappedCount: unmappedMap.get(d.deviceCode) || 0
    };
  });

  const campusScopedRoster = bioCtx.unifiedRoster.filter(
    (item) => campusFilter === 'ALL' || item.campus === campusFilter
  );

  const activeWithCode = campusScopedRoster.filter((item) => item.isActive && Boolean(item.personCode));
  const activeWithFace = activeWithCode.filter((item) => item.hasBiometricFace);
  const reclaimableInactive = campusScopedRoster.filter((item) => item.isReclaimableInactive);

  const syncStatusFilter = String(query.syncStatus || 'ALL').toUpperCase();

  const enrichedActiveRoster = activeWithCode.map((item) => {
    const subjKey = `${item.subjectType}:${item.subjectId}`;
    const devNameSet = new Set(webSubjectOnDevicesMap.get(subjKey) || []);
    if (Array.isArray(item.faceProfileDoc?.syncedDeviceIds)) {
      for (const sId of item.faceProfileDoc.syncedDeviceIds) {
        const dDoc = deviceByIdMap.get(String(sId));
        if (dDoc?.name) devNameSet.add(dDoc.name);
      }
    }
    const syncedDeviceNames = Array.from(devNameSet);
    return {
      ...item,
      isOnDevice: syncedDeviceNames.length > 0,
      syncedDeviceCount: syncedDeviceNames.length,
      syncedDeviceNames
    };
  });

  const filteredActiveRoster = enrichedActiveRoster.filter((item) => {
    if (subjectFilter !== 'ALL' && item.subjectType !== subjectFilter) return false;
    if (faceFilter === 'WITH_FACE' && !item.hasBiometricFace) return false;
    if (faceFilter === 'MISSING_FACE' && item.hasBiometricFace) return false;
    if (syncStatusFilter === 'ON_DEVICE' && !item.isOnDevice) return false;
    if (syncStatusFilter === 'NOT_ON_DEVICE' && item.isOnDevice) return false;
    if (search) {
      const hay = `${item.personCode} ${item.fullName} ${item.roleOrClassLabel} ${item.campus}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  filteredActiveRoster.sort((a, b) => {
    if (a.isOnDevice !== b.isOnDevice) {
      return a.isOnDevice ? -1 : 1;
    }
    if (a.subjectType !== b.subjectType) {
      return a.subjectType === 'EMPLOYEE' ? -1 : 1;
    }
    return a.personCode.localeCompare(b.personCode);
  });

  const totalItems = filteredActiveRoster.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const safePage = Math.min(page, totalPages);
  const pagedRoster = filteredActiveRoster
    .slice((safePage - 1) * limit, safePage * limit)
    .map(({ faceProfileDoc: _omit, altCodes: _omitAlt, ...rest }) => rest);

  // Tóm tắt nhanh danh sách lựa chọn để Ghép 1 chạm khi kéo hồ sơ lạ từ máy về Web
  const quickLinkCandidates = activeWithCode.map((item) => ({
    subjectType: item.subjectType,
    subjectId: item.subjectId,
    mappingSubjectId: item.mappingSubjectId,
    personCode: item.personCode,
    fullName: item.fullName,
    campus: item.campus,
    roleOrClassLabel: item.roleOrClassLabel
  }));

  const schoolCode = bioCtx.tenantDoc?.code || '';
  const totalStoredOnDevices = filteredDevices.reduce(
    (sum, d) => sum + (Number(d.currentStoredUsers) || 0),
    0
  );

  return {
    school: {
      name: bioCtx.tenantDoc?.name || '',
      code: schoolCode,
      campuses: Array.from(campusSet)
    },
    webhookMeta: {
      schoolCode,
      endpointPath: schoolCode ? `/api/attendance/webhook/${schoolCode}` : '/api/attendance/webhook'
    },
    kpi: {
      totalDevices: filteredDevices.length,
      totalSlotCapacity: filteredDevices.reduce((sum, d) => sum + (Number(d.maxUserCapacity) || 500), 0),
      activeWithCodeCount: activeWithCode.length,
      activeStaffCount: activeWithCode.filter((x) => x.subjectType === 'EMPLOYEE').length,
      activeStudentCount: activeWithCode.filter((x) => x.subjectType === 'STUDENT').length,
      withBiometricFaceCount: activeWithFace.length,
      reclaimableInactiveCount: reclaimableInactive.length,
      storedOnDevicesCount: Math.max(totalStoredOnDevices, deviceStoredPeople.length),
      unmatchedOnDevicesCount
    },
    devices: filteredDevices,
    deviceStoredPeople,
    roster: pagedRoster,
    quickLinkCandidates,
    pagination: {
      page: safePage,
      limit,
      totalItems,
      totalPages
    }
  };
}

/**
 * Lưu hoặc cập nhật ảnh quét mặt chấm công (`< 200KB` JPEG/PNG) cho 1 Nhân sự hoặc Học sinh.
 */
async function saveBiometricFacePhoto({
  tenantId,
  subjectType,
  subjectId,
  imageBase64,
  source = 'UPLOAD',
  actorId = null
}) {
  const cleanType = String(subjectType || '').toUpperCase();
  if (!['EMPLOYEE', 'STUDENT'].includes(cleanType)) {
    throw createServiceError('Loại đối tượng phải là EMPLOYEE hoặc STUDENT', 'INVALID_SUBJECT_TYPE', 400);
  }
  if (!mongoose.isValidObjectId(subjectId)) {
    throw createServiceError('ID hồ sơ không hợp lệ', 'INVALID_SUBJECT_ID', 400);
  }

  const parsedImg = parseAndValidateFaceImagePayload(imageBase64);

  let personCode = '';
  let fullName = '';
  let campus = DEFAULT_CAMPUS_NAME;
  let linkedUserId = null;
  let canonicalSubjectId = new mongoose.Types.ObjectId(subjectId);

  if (cleanType === 'EMPLOYEE') {
    let empDoc = await Employee.findOne({ _id: subjectId, tenantId }).lean();
    if (!empDoc) {
      empDoc = await Employee.findOne({ userId: subjectId, tenantId }).lean();
    }
    if (empDoc) {
      canonicalSubjectId = empDoc._id;
      linkedUserId = empDoc.userId || null;
      personCode = String(empDoc.employeeCode || '').trim().toUpperCase();
      fullName = empDoc.fullName || '';
      campus = empDoc.campus || DEFAULT_CAMPUS_NAME;
    } else {
      const userDoc = await User.findOne({ _id: subjectId, tenantId, role: { $ne: 'parent' } }).lean();
      if (!userDoc) {
        throw createServiceError('Không tìm thấy hồ sơ nhân sự trong trường này', 'EMPLOYEE_NOT_FOUND', 404);
      }
      canonicalSubjectId = userDoc._id;
      linkedUserId = userDoc._id;
      personCode = String(userDoc.employeeInfo?.employeeId || '').trim().toUpperCase();
      fullName = userDoc.profile?.fullName || userDoc.username;
    }
  } else {
    const stuDoc = await Student.findOne({ _id: subjectId, tenantId }).lean();
    if (!stuDoc) {
      throw createServiceError('Không tìm thấy hồ sơ học sinh trong trường này', 'STUDENT_NOT_FOUND', 404);
    }
    canonicalSubjectId = stuDoc._id;
    personCode = String(stuDoc.studentCode || '').trim().toUpperCase();
    fullName = stuDoc.fullName || '';
    if (stuDoc.classroomId) {
      const cls = await Classroom.findOne({ _id: stuDoc.classroomId, tenantId }).select('campus').lean();
      if (cls?.campus) campus = cls.campus;
    }
  }

  if (!personCode) {
    throw createServiceError(
      'Hồ sơ này chưa có Mã chấm công (Mã NV / Mã Học sinh). Vui lòng cấp mã trước khi gắn ảnh khuôn mặt.',
      'MISSING_PERSON_CODE',
      400
    );
  }

  // Khi cập nhật ảnh khuôn mặt mới trên Web -> Xóa syncedDeviceIds cũ để lần Đồng bộ nhanh (Delta) tiếp theo biết cần đẩy lại ảnh mới này xuống máy!
  const profile = await BiometricFaceProfile.findOneAndUpdate(
    {
      tenantId,
      subjectType: cleanType,
      subjectId: canonicalSubjectId
    },
    {
      $set: {
        linkedUserId,
        personCode,
        fullName,
        campus,
        mimeType: parsedImg.mimeType,
        imageBase64: parsedImg.imageBase64,
        sizeBytes: parsedImg.sizeBytes,
        source: ['UPLOAD', 'CAMERA', 'PULLED_FROM_DEVICE'].includes(source) ? source : 'UPLOAD',
        syncedDeviceIds: [],
        updatedBy: actorId || null
      }
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );

  return {
    subjectType: cleanType,
    subjectId: String(canonicalSubjectId),
    personCode,
    fullName,
    campus,
    sizeKB: Math.max(1, Math.round((parsedImg.sizeBytes / 1024) * 10) / 10),
    faceDataUrl: `data:${profile.mimeType};base64,${profile.imageBase64}`
  };
}

/**
 * Xóa ảnh quét mặt chấm công trên Web của 1 Nhân sự / Học sinh.
 */
async function deleteBiometricFacePhoto({ tenantId, subjectType, subjectId }) {
  const cleanType = String(subjectType || '').toUpperCase();
  if (!['EMPLOYEE', 'STUDENT'].includes(cleanType) || !mongoose.isValidObjectId(subjectId)) {
    throw createServiceError('Tham số xóa ảnh khuôn mặt không hợp lệ', 'INVALID_PARAMS', 400);
  }
  await BiometricFaceProfile.deleteOne({
    tenantId,
    subjectType: cleanType,
    subjectId: new mongoose.Types.ObjectId(subjectId)
  });
  return { deleted: true };
}

/**
 * Kiểm tra kết nối ISAPI & đọc dung lượng bộ nhớ thực tế (`X / 500 slot`) của máy chấm công thuộc trường.
 */
async function checkDeviceCapacityAndHealth(tenantId, deviceId, overrideOpts = {}) {
  if (!mongoose.isValidObjectId(deviceId)) {
    throw createServiceError('ID thiết bị không hợp lệ', 'INVALID_DEVICE_ID', 400);
  }
  const device = await TimekeepingDevice.findOne({ _id: deviceId, tenantId });
  if (!device) {
    throw createServiceError('Không tìm thấy máy chấm công trong trường này', 'DEVICE_NOT_FOUND', 404);
  }

  const config = await buildDeviceConfig(device, overrideOpts);
  if (!config.username || !config.password) {
    return {
      online: false,
      status: 'NOT_RUN_MISSING_SECRET',
      currentStoredUsers: device.currentStoredUsers || 0,
      currentStoredFaces: device.currentStoredFaces || 0,
      maxUserCapacity: device.maxUserCapacity || 500,
      message: 'Chưa nhập mật khẩu quản trị máy chấm công (ISAPI). Bấm biểu tượng Sửa trên thẻ máy để nhập mật khẩu thiết bị.'
    };
  }

  try {
    const [info, usage] = await Promise.all([
      hikvisionIsapiService.getDeviceInfo(config),
      hikvisionIsapiService.getDeviceCapacityUsage(config, device.maxUserCapacity || 500)
    ]);

    device.status = 'ONLINE';
    device.lastSeenAt = new Date();
    device.currentStoredUsers = usage.currentStoredUsers;
    if (usage.currentStoredFaces > 0) {
      device.currentStoredFaces = usage.currentStoredFaces;
    }
    if (!device.maxUserCapacity && usage.maxUserCapacity) {
      device.maxUserCapacity = usage.maxUserCapacity;
    }
    if (info.model) device.model = info.model;
    if (info.macAddress) device.macAddress = info.macAddress;
    if (info.serialNumber) {
      await assertDeviceSerialCampusLock(tenantId, device, info.serialNumber);
    }
    device.statusMessage = `Đang kết nối tốt • Bộ nhớ đang lưu ${device.currentStoredUsers}/${device.maxUserCapacity || 500} hồ sơ`;
    await device.save();

    return {
      online: true,
      status: 'ONLINE',
      deviceInfo: info,
      currentStoredUsers: device.currentStoredUsers,
      currentStoredFaces: device.currentStoredFaces,
      maxUserCapacity: device.maxUserCapacity || 500,
      message: `Máy "${device.name}" đang kết nối tốt tại ${device.campus}: hiện lưu ${device.currentStoredUsers}/${device.maxUserCapacity || 500} hồ sơ.`
    };
  } catch (err) {
    if (err.code === 'SERIAL_LOCKED_OTHER_CAMPUS' || err.code === 'HARDWARE_SERIAL_MISMATCH') {
      throw err;
    }
    device.status = err.code === 'DEVICE_AUTH_FAILED' ? 'AUTH_FAILED' : 'OFFLINE';
    device.statusMessage = formatFriendlyVietnameseHardwareNotice(err, {
      deviceName: device.name,
      host: device.host,
      campus: device.campus
    });
    await device.save();

    return {
      online: false,
      status: device.status,
      code: err.code || 'CONNECTION_FAILED',
      currentStoredUsers: device.currentStoredUsers || 0,
      maxUserCapacity: device.maxUserCapacity || 500,
      message: device.statusMessage
    };
  }
}

/**
 * Kéo nhanh (Song song) danh sách người dùng & Ảnh khuôn mặt (`< 200KB`) từ 1 máy Hikvision về Web:
 * - Ưu tiên 1: Khớp theo Bảng ánh xạ thiết bị (`AttendanceDevicePersonMapping`) đã liên kết trước đó.
 * - Ưu tiên 2: Khớp theo Mã NV / Mã HS / Mã thẻ (`attendanceCardId` / `faceProfileId` / mã viết liền).
 * - Ưu tiên 3: Khớp theo `username` hoặc Họ tên tiếng Việt không dấu trong cùng phân hiệu.
 * - Với các hồ sơ trên máy chưa khớp tự động (`unmatchedOnDevice`): tải kèm ảnh mặt thu nhỏ để Admin ghép 1 chạm trên Web!
 */
async function pullUsersAndFacesFromDevice(
  tenantId,
  deviceId,
  { overwriteExistingFaces = true, actorId = null, overrideOpts = {}, existingBioCtx = null } = {}
) {
  if (!mongoose.isValidObjectId(deviceId)) {
    throw createServiceError('ID thiết bị không hợp lệ', 'INVALID_DEVICE_ID', 400);
  }
  const device = await TimekeepingDevice.findOne({ _id: deviceId, tenantId });
  if (!device) {
    throw createServiceError('Không tìm thấy máy chấm công trong trường này', 'DEVICE_NOT_FOUND', 404);
  }

  const config = await buildDeviceConfig(device, overrideOpts);
  if (!config.username || !config.password) {
    throw createServiceError(
      'Chưa cấu hình tài khoản/mật khẩu quản trị máy chấm công để kéo dữ liệu ISAPI',
      'DEVICE_CREDENTIALS_MISSING',
      400
    );
  }

  return withDeviceBiometricLock(device._id, 'Kéo dữ liệu người dùng & khuôn mặt', async () => {
  // Kiểm tra khóa cứng Serial phần cứng trước khi kéo dữ liệu từ máy về Web
  const hwInfo = await hikvisionIsapiService.getDeviceInfo(config).catch((err) => {
    if (err.code === 'DEVICE_AUTH_FAILED' || err.code === 'DEVICE_OFFLINE' || err.code === 'DEVICE_TIMEOUT') {
      throw err;
    }
    return null;
  });
  if (hwInfo?.serialNumber) {
    await assertDeviceSerialCampusLock(tenantId, device, hwInfo.serialNumber);
  }

  const [deviceUsers, bioCtx, deviceMappings] = await Promise.all([
    hikvisionIsapiService.fetchAllDeviceUsersWithFaces(config),
    existingBioCtx ? Promise.resolve(existingBioCtx) : loadTenantBiometricContext(tenantId),
    AttendanceDevicePersonMapping.find({ tenantId, deviceId: device._id, active: true }).lean()
  ]);

  const byMappingSubjKey = new Map();
  const byCode = new Map();
  const byUsername = new Map();
  const byCampusAndToneFreeName = new Map();
  const byToneFreeName = new Map();

  for (const item of bioCtx.unifiedRoster) {
    // Chỉ đối chiếu & kéo ảnh mặt cho Nhân sự đang làm việc và Học sinh đang theo học
    if (!item.isActive) continue;

    byMappingSubjKey.set(`${item.subjectType}:${item.subjectId}`, item);
    if (item.mappingSubjectId) {
      byMappingSubjKey.set(`${item.subjectType}:${item.mappingSubjectId}`, item);
    }

    if (item.personCode) {
      byCode.set(item.personCode.toUpperCase(), item);
    }
    if (Array.isArray(item.altCodes)) {
      for (const alt of item.altCodes) {
        if (alt && !byCode.has(alt.toUpperCase())) {
          byCode.set(alt.toUpperCase(), item);
        }
      }
    }
    if (item.username) {
      byUsername.set(item.username.toLowerCase(), item);
    }
    const cleanName = removeVietnameseTones(item.fullName);
    if (cleanName) {
      byCampusAndToneFreeName.set(`${item.campus}::${cleanName}`, item);
      if (!byToneFreeName.has(cleanName)) {
        byToneFreeName.set(cleanName, item);
      }
    }
  }

  // Tra cứu theo bảng ánh xạ thiết bị đã lưu (ví dụ ID "7" trên máy đã gắn với NV-0007)
  const byMappedExtId = new Map();
  for (const m of deviceMappings) {
    const extKey = String(m.externalPersonId || '').trim().toUpperCase();
    const targetId = String(m.studentId || m.userId || m.subjectId || '');
    const rosterMatch = byMappingSubjKey.get(`${m.subjectType}:${targetId}`);
    if (extKey && rosterMatch) {
      byMappedExtId.set(extKey, rosterMatch);
    }
  }

  let matchedCount = 0;
  let pulledFaceCount = 0;
  let totalFacesOnDevice = 0;
  const syncedPeople = [];
  const rawUnmatched = [];

  // Chạy song song tải ảnh khuôn mặt và lưu ánh xạ (tối đa 4 luồng/máy)
  await runWithConcurrency(deviceUsers, 4, async (du) => {
    if (du.numOfFace > 0 || du.faceURL) {
      totalFacesOnDevice += 1;
    }

    const rawEmpNo = String(du.employeeNo || '').trim();
    const codeUpper = rawEmpNo.toUpperCase();
    const devNameNoTone = removeVietnameseTones(du.name || '');

    const matched =
      byMappedExtId.get(codeUpper) ||
      byCode.get(codeUpper) ||
      byUsername.get(String(du.name || '').trim().toLowerCase()) ||
      (devNameNoTone && device.campus && device.campus !== 'ALL'
        ? byCampusAndToneFreeName.get(`${device.campus}::${devNameNoTone}`)
        : null) ||
      (devNameNoTone ? byToneFreeName.get(devNameNoTone) : null) ||
      null;

    if (!matched) {
      rawUnmatched.push(du);
      return;
    }

    matchedCount += 1;
    await ensureDevicePersonMapping(tenantId, device._id, matched, actorId, rawEmpNo);

    if (du.faceURL && (overwriteExistingFaces || !matched.hasBiometricFace)) {
      try {
        const downloaded = await hikvisionIsapiService.downloadDeviceFaceBuffer(config, du.faceURL);
        if (downloaded && downloaded.buffer) {
          const saved = await BiometricFaceProfile.findOneAndUpdate(
            {
              tenantId,
              subjectType: matched.subjectType,
              subjectId: new mongoose.Types.ObjectId(matched.subjectId)
            },
            {
              $set: {
                linkedUserId: matched.userId ? new mongoose.Types.ObjectId(matched.userId) : null,
                personCode: matched.personCode || codeUpper,
                fullName: matched.fullName,
                campus: matched.campus || device.campus || DEFAULT_CAMPUS_NAME,
                mimeType: downloaded.mimeType,
                imageBase64: downloaded.buffer.toString('base64'),
                sizeBytes: downloaded.sizeBytes,
                source: 'PULLED_FROM_DEVICE',
                lastSyncedAt: new Date(),
                updatedBy: actorId || null
              },
              $addToSet: { syncedDeviceIds: device._id }
            },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
          );

          pulledFaceCount += 1;
          syncedPeople.push({
            subjectType: matched.subjectType,
            subjectId: matched.subjectId,
            personCode: matched.personCode || codeUpper,
            fullName: matched.fullName,
            campus: matched.campus,
            sizeKB: Math.max(1, Math.round((downloaded.sizeBytes / 1024) * 10) / 10),
            faceDataUrl: `data:${saved.mimeType};base64,${saved.imageBase64}`
          });
        }
      } catch {
        // Bỏ qua lỗi tải ảnh lẻ để không gián đoạn tiến trình kéo nhanh
      }
    }
  });

  // Tải ảnh khuôn mặt của các hồ sơ chưa khớp trên máy để lưu đầy đủ vào bảng DeviceStoredPerson
  const unmatchedSlice = rawUnmatched.slice(0, 60);
  const unmatchedOnDevice = await runWithConcurrency(unmatchedSlice, 3, async (du) => {
    let previewFaceDataUrl = '';
    if (du.faceURL) {
      try {
        const dl = await hikvisionIsapiService.downloadDeviceFaceBuffer(config, du.faceURL);
        if (dl?.buffer) {
          previewFaceDataUrl = `data:${dl.mimeType};base64,${dl.buffer.toString('base64')}`;
        }
      } catch {
        previewFaceDataUrl = '';
      }
    }
    return {
      deviceId: String(device._id),
      deviceName: device.name,
      employeeNo: du.employeeNo,
      name: du.name || `Mã ${du.employeeNo}`,
      numOfFace: du.numOfFace,
      hasFace: Boolean(du.numOfFace > 0 || previewFaceDataUrl),
      faceDataUrl: previewFaceDataUrl
    };
  });

  // Đồng bộ vào bảng DeviceStoredPerson để giao diện luôn hiển thị rõ toàn bộ hồ sơ trên máy
  const faceByCodeMap = new Map();
  for (const sp of syncedPeople) {
    if (sp.personCode && sp.faceDataUrl) faceByCodeMap.set(String(sp.personCode).toUpperCase(), sp.faceDataUrl);
  }
  const unmatchedFaceMap = new Map(unmatchedOnDevice.map((u) => [String(u.employeeNo), u.faceDataUrl || '']));
  const snapshotPayload = deviceUsers.map((du) => {
    const extNo = String(du.employeeNo || '').trim();
    return {
      employeeNo: extNo,
      name: du.name || '',
      numOfFace: du.numOfFace || 0,
      numOfCard: du.numOfCard || 0,
      numOfFP: du.numOfFP || 0,
      faceDataUrl: unmatchedFaceMap.get(extNo) || faceByCodeMap.get(extNo.toUpperCase()) || ''
    };
  });
  await syncDeviceStoredPersonsSnapshot(tenantId, device._id, snapshotPayload, { pruneMissing: true });

  device.status = 'ONLINE';
  device.lastSeenAt = new Date();
  device.currentStoredUsers = deviceUsers.length;
  device.currentStoredFaces = totalFacesOnDevice;
  device.statusMessage =
    deviceUsers.length === 0
      ? 'Máy đang trống (0 hồ sơ)'
      : unmatchedOnDevice.length > 0 && matchedCount === 0
        ? `Đang lưu ${deviceUsers.length} hồ sơ (${totalFacesOnDevice} khuôn mặt) trên máy — sẵn sàng lấy về Web`
        : `Đang lưu ${deviceUsers.length} hồ sơ trên máy (đã khớp ${matchedCount} hồ sơ Web)`;
  await device.save();

  return {
    deviceId: String(device._id),
    deviceName: device.name,
    campus: device.campus,
    host: device.host,
    totalOnDevice: deviceUsers.length,
    totalFacesOnDevice,
    matchedCount,
    pulledFaceCount,
    syncedPeople,
    unmatchedOnDevice
  };
  });
}

/**
 * Ghép nhanh 1 chạm 1 hồ sơ vừa kéo từ máy chấm công (`unmatchedOnDevice`) vào Nhân sự / Học sinh trên Web:
 * - Lưu ánh xạ `AttendanceDevicePersonMapping` + xử lý bù toàn bộ lượt quẹt `UNMAPPED` trước đó.
 * - Lưu luôn ảnh khuôn mặt `<200KB` vừa kéo từ máy vào `BiometricFaceProfile` của người đó!
 */
async function linkPulledDeviceUserToSubject(tenantId, deviceId, {
  externalPersonId,
  subjectType,
  subjectId,
  faceDataUrl = '',
  actorId = null,
  overrideOpts = {}
}) {
  if (!mongoose.isValidObjectId(deviceId) || !mongoose.isValidObjectId(subjectId)) {
    throw createServiceError('ID thiết bị hoặc ID hồ sơ không hợp lệ', 'INVALID_IDS', 400);
  }
  const cleanExtId = String(externalPersonId || '').trim();
  const cleanType = String(subjectType || '').toUpperCase();
  if (!cleanExtId || !['EMPLOYEE', 'STUDENT'].includes(cleanType)) {
    throw createServiceError('Thiếu mã trên máy hoặc loại đối tượng (EMPLOYEE / STUDENT)', 'INVALID_LINK_PAYLOAD', 400);
  }

  const [device, bioCtx] = await Promise.all([
    TimekeepingDevice.findOne({ _id: deviceId, tenantId }),
    loadTenantBiometricContext(tenantId)
  ]);
  if (!device) {
    throw createServiceError('Không tìm thấy máy chấm công trong trường này', 'DEVICE_NOT_FOUND', 404);
  }

  const matchedItem = bioCtx.unifiedRoster.find(
    (item) =>
      item.subjectType === cleanType &&
      (item.subjectId === String(subjectId) || item.mappingSubjectId === String(subjectId))
  );
  if (!matchedItem || !matchedItem.mappingSubjectId) {
    throw createServiceError(
      cleanType === 'EMPLOYEE'
        ? 'Nhân sự này cần có tài khoản đăng nhập đang hoạt động hoặc hồ sơ hợp lệ để ánh xạ chấm công'
        : 'Không tìm thấy học sinh trong trường này',
      'SUBJECT_NOT_FOUND',
      404
    );
  }

  await ensureDevicePersonMapping(tenantId, device._id, matchedItem, actorId, cleanExtId);

  // Backfill ngay lập tức mọi sự kiện UNMAPPED trước đó của mã máy này
  const unmappedEvents = await RawAttendanceEvent.find({
    tenantId,
    deviceId: device.deviceCode,
    externalPersonId: cleanExtId,
    mappingStatus: 'UNMAPPED'
  }).sort({ occurredAt: 1 });

  if (unmappedEvents.length > 0) {
    await RawAttendanceEvent.updateMany(
      { _id: { $in: unmappedEvents.map((e) => e._id) } },
      {
        $set: {
          mappingStatus: 'MAPPED',
          subjectType: cleanType,
          userId: cleanType === 'EMPLOYEE' ? new mongoose.Types.ObjectId(matchedItem.mappingSubjectId) : null,
          studentId: cleanType === 'STUDENT' ? new mongoose.Types.ObjectId(matchedItem.mappingSubjectId) : null,
          employeeName: matchedItem.fullName
        }
      }
    );

    if (cleanType === 'EMPLOYEE') {
      const trustedCtx = createTrustedTenantContext({ tenantId });
      const distinctDates = [...new Set(unmappedEvents.map((e) => getWorkDate(e.occurredAt, DEFAULT_SCHOOL_TIMEZONE)))];
      for (const workDateStr of distinctDates) {
        await calculateAttendanceForUserDate({
          userId: new mongoose.Types.ObjectId(matchedItem.mappingSubjectId),
          workDate: workDateStr,
          actorId,
          calculatedBy: 'admin',
          context: trustedCtx
        });
      }
    } else {
      const stuDoc = await Student.findOne({ _id: matchedItem.subjectId, tenantId });
      if (stuDoc) {
        for (const ev of unmappedEvents) {
          await ingestStudentDeviceAttendance({
            tenantId,
            student: stuDoc,
            occurredAtDate: ev.occurredAt,
            source: ev.source,
            deviceId: device.deviceCode,
            enableMorningLateCheck: true,
            session: null
          });
        }
      }
    }
  }

  // Lưu ảnh khuôn mặt (ưu tiên từ faceDataUrl, hoặc bản chụp đã lưu trong DeviceStoredPerson, hoặc kéo từ máy)
  let savedFace = null;
  let effectiveFaceDataUrl = faceDataUrl;

  if (!effectiveFaceDataUrl) {
    const cachedPerson = await DeviceStoredPerson.findOne({
      tenantId,
      deviceId: device._id,
      externalPersonId: cleanExtId
    }).lean();
    if (cachedPerson?.imageBase64) {
      effectiveFaceDataUrl = `data:${cachedPerson.mimeType || 'image/jpeg'};base64,${cachedPerson.imageBase64}`;
    }
  }

  if (!effectiveFaceDataUrl) {
    try {
      const config = await buildDeviceConfig(device, overrideOpts);
      if (config.username && config.password) {
        const usersOnDev = await hikvisionIsapiService.fetchAllDeviceUsersWithFaces(config);
        const foundDevUser = usersOnDev.find((u) => u.employeeNo === cleanExtId);
        if (foundDevUser?.faceURL) {
          const dl = await hikvisionIsapiService.downloadDeviceFaceBuffer(config, foundDevUser.faceURL);
          if (dl?.buffer) {
            effectiveFaceDataUrl = `data:${dl.mimeType};base64,${dl.buffer.toString('base64')}`;
          }
        }
      }
    } catch {
      effectiveFaceDataUrl = '';
    }
  }

  if (effectiveFaceDataUrl && matchedItem.personCode) {
    savedFace = await saveBiometricFacePhoto({
      tenantId,
      subjectType: cleanType,
      subjectId: matchedItem.subjectId,
      imageBase64: effectiveFaceDataUrl,
      source: 'PULLED_FROM_DEVICE',
      actorId
    });
  }

  return {
    externalPersonId: cleanExtId,
    subjectType: cleanType,
    subjectId: matchedItem.subjectId,
    fullName: matchedItem.fullName,
    personCode: matchedItem.personCode,
    backfilledEvents: unmappedEvents.length,
    faceSaved: Boolean(savedFace)
  };
}

/**
 * Đồng bộ Nhanh 1 chiều (Web -> Máy chấm công) song song đa thiết bị & Delta Sync thông minh:
 * - Mặc định `fastDelta = true`: Bỏ qua ghi đè mạng cho những người đã có sẵn trên máy với cùng Họ tên & Ảnh khuôn mặt đã đồng bộ,
 *   chỉ đẩy người mới hoặc người vừa đổi thông tin/ảnh mặt (có thể truyền `forceFullSync = true` để ép nạp lại toàn bộ).
 */
async function syncSmartToDevices(
  tenantId,
  { deviceId = null, campus = null, fastDelta = true, forceFullSync = false, actorId = null, overrideOpts = {}, existingBioCtx = null } = {}
) {
  const deviceFilter = { tenantId };
  if (deviceId) {
    if (!mongoose.isValidObjectId(deviceId)) {
      throw createServiceError('ID thiết bị không hợp lệ', 'INVALID_DEVICE_ID', 400);
    }
    deviceFilter._id = deviceId;
  } else {
    deviceFilter.enabled = true;
    if (campus && campus !== 'ALL') {
      deviceFilter.campus = { $in: [String(campus).trim(), 'ALL'] };
    }
  }

  const [devices, bioCtx] = await Promise.all([
    TimekeepingDevice.find(deviceFilter).sort({ campus: 1, createdAt: 1 }),
    existingBioCtx ? Promise.resolve(existingBioCtx) : loadTenantBiometricContext(tenantId)
  ]);

  if (devices.length === 0) {
    throw createServiceError('Chưa có máy chấm công nào đang kích hoạt để đồng bộ', 'NO_ACTIVE_DEVICES', 404);
  }

  const useDelta = Boolean(fastDelta) && !forceFullSync;

  const deviceReports = await runWithConcurrency(devices, DEVICE_PARALLEL_LIMIT, async (device) => {
    return withDeviceBiometricLock(device._id, 'Đẩy đồng bộ 1 chiều', async () => {
    const config = await buildDeviceConfig(device, overrideOpts);
    if (!config.username || !config.password) {
      return {
        deviceId: String(device._id),
        deviceName: device.name,
        campus: device.campus,
        success: false,
        status: 'NOT_RUN_MISSING_SECRET',
        message: `Máy "${device.name}" chưa nhập mật khẩu quản trị ISAPI`
      };
    }

    let existingUsers = [];
    let deviceReachable = true;
    try {
      const hwInfo = await hikvisionIsapiService.getDeviceInfo(config).catch((infoErr) => {
        if (infoErr.code === 'DEVICE_AUTH_FAILED' || infoErr.code === 'DEVICE_OFFLINE' || infoErr.code === 'DEVICE_TIMEOUT') {
          throw infoErr;
        }
        return null;
      });
      if (hwInfo?.serialNumber) {
        await assertDeviceSerialCampusLock(tenantId, device, hwInfo.serialNumber);
      }
      existingUsers = await hikvisionIsapiService.fetchAllDeviceUsersWithFaces(config);
    } catch (err) {
      if (err.code === 'SERIAL_LOCKED_OTHER_CAMPUS' || err.code === 'HARDWARE_SERIAL_MISMATCH') {
        throw err;
      }
      if (err.code === 'DEVICE_AUTH_FAILED' || err.code === 'DEVICE_OFFLINE' || err.code === 'DEVICE_TIMEOUT') {
        deviceReachable = false;
        device.status = err.code === 'DEVICE_AUTH_FAILED' ? 'AUTH_FAILED' : 'OFFLINE';
        device.statusMessage = formatFriendlyVietnameseHardwareNotice(err, {
          deviceName: device.name,
          host: device.host,
          campus: device.campus
        });
        await device.save();
        return {
          deviceId: String(device._id),
          deviceName: device.name,
          campus: device.campus,
          host: device.host,
          success: false,
          status: device.status,
          message: device.statusMessage
        };
      }
      existingUsers = [];
    }

    if (!deviceReachable) {
      return {
        deviceId: String(device._id),
        deviceName: device.name,
        campus: device.campus,
        success: false
      };
    }

    const existingMap = new Map(existingUsers.map((u) => [String(u.employeeNo).trim(), u]));
    const { selectedTargets } = await selectTargetRosterForDeviceCapacity(
      tenantId,
      device,
      bioCtx.unifiedRoster
    );

    let syncedUsers = 0;
    let skippedUnchangedCount = 0;
    let syncedFaces = 0;
    let syncedStaffCount = 0;
    let syncedStudentCount = 0;
    let failedCount = 0;
    const syncedFaceProfileIds = [];
    let abortDeviceLoop = false;

    await runWithConcurrency(selectedTargets, PER_DEVICE_IO_CONCURRENCY, async (target) => {
      if (abortDeviceLoop) return;

      const existingOnDev = existingMap.get(target.personCode) || null;
      const faceDoc = target.faceProfileDoc;
      const alreadySyncedFaceOnThisDevice = Boolean(
        faceDoc &&
          Array.isArray(faceDoc.syncedDeviceIds) &&
          faceDoc.syncedDeviceIds.some((id) => String(id) === String(device._id)) &&
          existingOnDev &&
          Number(existingOnDev.numOfFace) > 0
      );

      // Chế độ Delta Nhanh: Nếu hồ sơ đã nằm sẵn trên máy, trùng tên chuẩn UTF-8 <=60B và không có ảnh mặt mới cần đẩy -> Bỏ qua ghi mạng!
      const expectedSanitizedName = hikvisionIsapiService.sanitizeHikvisionPersonName(
        target.fullName,
        target.personCode
      );
      const nameUnchanged = Boolean(
        existingOnDev && String(existingOnDev.name || '').trim() === expectedSanitizedName
      );
      const noFaceUpdateNeeded = !faceDoc || alreadySyncedFaceOnThisDevice;

      if (useDelta && nameUnchanged && noFaceUpdateNeeded) {
        syncedUsers += 1;
        skippedUnchangedCount += 1;
        if (target.subjectType === 'EMPLOYEE') syncedStaffCount += 1;
        else syncedStudentCount += 1;
        if (Number(existingOnDev.numOfFace) > 0) syncedFaces += 1;
        await ensureDevicePersonMapping(tenantId, device._id, target, actorId);
        return;
      }

      try {
        const faceBuf = faceDoc?.imageBase64 ? Buffer.from(faceDoc.imageBase64, 'base64') : null;
        const pushRes = await hikvisionIsapiService.upsertPersonAndFaceOnDevice(config, {
          personCode: target.personCode,
          fullName: target.fullName,
          faceBuffer: faceBuf,
          existingOnDevice: existingOnDev
        });

        if (pushRes.success) {
          syncedUsers += 1;
          if (target.subjectType === 'EMPLOYEE') syncedStaffCount += 1;
          else syncedStudentCount += 1;

          if (pushRes.faceSynced) {
            syncedFaces += 1;
            if (faceDoc?._id) {
              syncedFaceProfileIds.push(faceDoc._id);
            }
          }
          await ensureDevicePersonMapping(tenantId, device._id, target, actorId);
        } else {
          failedCount += 1;
        }
      } catch (err) {
        failedCount += 1;
        if (err.code === 'DEVICE_AUTH_FAILED' || err.code === 'DEVICE_OFFLINE') {
          abortDeviceLoop = true;
        }
      }
    });

    if (syncedFaceProfileIds.length > 0) {
      await BiometricFaceProfile.updateMany(
        { _id: { $in: syncedFaceProfileIds }, tenantId },
        {
          $set: { lastSyncedAt: new Date() },
          $addToSet: { syncedDeviceIds: device._id }
        }
      );
    }

    const usage = await hikvisionIsapiService
      .getDeviceCapacityUsage(config, device.maxUserCapacity || 500)
      .catch(() => ({
        currentStoredUsers: syncedUsers,
        currentStoredFaces: syncedFaces,
        maxUserCapacity: device.maxUserCapacity || 500
      }));

    const finalStoredUsers = usage.currentStoredUsers > 0 ? usage.currentStoredUsers : syncedUsers;
    const finalStoredFaces = usage.currentStoredFaces > 0 ? usage.currentStoredFaces : syncedFaces;
    const pushedChangedCount = Math.max(0, syncedUsers - skippedUnchangedCount);

    const summary = {
      totalTargets: selectedTargets.length,
      syncedUsers,
      pushedChangedCount,
      skippedUnchangedCount,
      syncedFaces,
      syncedStaffCount,
      syncedStudentCount,
      prunedInactiveCount: 0,
      failedCount,
      message:
        skippedUnchangedCount > 0
          ? `Đồng bộ nhanh ${syncedUsers}/${selectedTargets.length} hồ sơ (nạp mới ${pushedChangedCount}, giữ nguyên ${skippedUnchangedCount} • ${syncedFaces} mặt)`
          : `Đã nạp ${syncedUsers}/${selectedTargets.length} hồ sơ (${syncedStaffCount} NS, ${syncedStudentCount} HS • ${syncedFaces} khuôn mặt)`,
      syncedAt: new Date()
    };

    device.status = syncedUsers > 0 || selectedTargets.length === 0 ? 'ONLINE' : 'OFFLINE';
    device.lastSeenAt = new Date();
    device.currentStoredUsers = finalStoredUsers;
    device.currentStoredFaces = finalStoredFaces;
    device.lastSyncSummary = summary;
    device.statusMessage = summary.message;
    await device.save();

    return {
      deviceId: String(device._id),
      deviceName: device.name,
      campus: device.campus,
      host: device.host,
      success: syncedUsers > 0 || selectedTargets.length === 0,
      currentStoredUsers: finalStoredUsers,
      maxUserCapacity: device.maxUserCapacity || 500,
      ...summary
    };
    }).catch((lockOrDevErr) => ({
      deviceId: String(device._id),
      deviceName: device.name,
      campus: device.campus,
      host: device.host,
      success: false,
      code: lockOrDevErr.code || 'SYNC_DEVICE_ERROR',
      message: lockOrDevErr.message
    }));
  });

  return {
    totalDevices: devices.length,
    syncedDevices: deviceReports.filter((r) => r.success).length,
    deviceReports
  };
}

/**
 * Kéo Nhanh Toàn Cụm từ Máy chấm công về Web (Máy -> Web):
 * Kéo song song trên tất cả máy thuộc phân hiệu/trường cả 2 nguồn dữ liệu:
 * 1. Hồ sơ người dùng & Ảnh khuôn mặt (`pullUsersAndFacesFromDevice`)
 * 2. Lịch sử quẹt chấm công / điểm danh (`syncDeviceEvents`)
 */
async function pullAllFromDevices(
  tenantId,
  { deviceId = null, campus = null, overwriteExistingFaces = false, includeEvents = true, actorId = null, overrideOpts = {} } = {}
) {
  const filter = { tenantId };
  if (deviceId) {
    if (!mongoose.isValidObjectId(deviceId)) {
      throw createServiceError('ID thiết bị không hợp lệ', 'INVALID_DEVICE_ID', 400);
    }
    filter._id = deviceId;
  } else {
    filter.enabled = true;
    if (campus && campus !== 'ALL') {
      filter.campus = { $in: [String(campus).trim(), 'ALL'] };
    }
  }

  const [devices, bioCtx] = await Promise.all([
    TimekeepingDevice.find(filter).sort({ campus: 1, createdAt: 1 }),
    loadTenantBiometricContext(tenantId)
  ]);

  if (devices.length === 0) {
    throw createServiceError('Chưa có máy chấm công nào đang bật để kéo dữ liệu', 'NO_ACTIVE_DEVICES', 404);
  }

  let totalMatchedUsers = 0;
  let totalPulledFaces = 0;
  let totalEventsIngested = 0;
  let totalEventsUnmapped = 0;
  const allSyncedPeople = [];
  const allUnmatchedOnDevice = [];

  const devicePullReports = await runWithConcurrency(devices, DEVICE_PARALLEL_LIMIT, async (dev) => {
    try {
      // Bước 1: Kéo danh sách hồ sơ & ảnh khuôn mặt trước (để tự động tạo ánh xạ ID máy trước khi kéo sự kiện quẹt!)
      const userPull = await pullUsersAndFacesFromDevice(tenantId, dev._id, {
        overwriteExistingFaces,
        actorId,
        overrideOpts,
        existingBioCtx: bioCtx
      });

      totalMatchedUsers += userPull.matchedCount || 0;
      totalPulledFaces += userPull.pulledFaceCount || 0;
      if (Array.isArray(userPull.syncedPeople)) {
        allSyncedPeople.push(...userPull.syncedPeople);
      }
      if (Array.isArray(userPull.unmatchedOnDevice)) {
        allUnmatchedOnDevice.push(...userPull.unmatchedOnDevice);
      }

      // Bước 2: Kéo luôn toàn bộ lượt quẹt chấm công / điểm danh lưu trong máy về bảng Điểm danh
      let eventPull = null;
      if (includeEvents && dev.enabled) {
        const freshDev = await TimekeepingDevice.findById(dev._id);
        eventPull = await syncDeviceEvents(freshDev, {
          actorId,
          triggeredBy: 'MANUAL',
          overrideCreds: overrideOpts
        }).catch(() => null);

        if (eventPull?.summary) {
          totalEventsIngested += eventPull.summary.ingested || 0;
          totalEventsUnmapped += eventPull.summary.unmapped || 0;
        }
      }

      return {
        deviceId: String(dev._id),
        deviceName: dev.name,
        campus: dev.campus,
        host: dev.host,
        success: true,
        totalOnDevice: userPull.totalOnDevice,
        matchedCount: userPull.matchedCount,
        pulledFaceCount: userPull.pulledFaceCount,
        eventsIngested: eventPull?.summary?.ingested || 0,
        eventsUnmapped: eventPull?.summary?.unmapped || 0
      };
    } catch (err) {
      return {
        deviceId: String(dev._id),
        deviceName: dev.name,
        campus: dev.campus,
        host: dev.host,
        success: false,
        message: err.message
      };
    }
  });

  return {
    totalDevices: devices.length,
    pulledDevices: devicePullReports.filter((r) => r.success).length,
    totalMatchedUsers,
    totalPulledFaces,
    totalEventsIngested,
    totalEventsUnmapped,
    syncedPeople: allSyncedPeople.slice(0, 40),
    unmatchedOnDevice: allUnmatchedOnDevice.slice(0, 30),
    deviceReports: devicePullReports
  };
}

/**
 * Đồng Bộ Nhanh 2 Chiều Toàn Diện (`Máy <-> Web` chỉ với 1 cú nhấp chuột):
 * - Pha 1 (Máy -> Web): Kéo toàn bộ lượt quẹt chấm công/điểm danh mới + bổ sung ảnh khuôn mặt quét trực tiếp tại máy về Web.
 * - Pha 2 (Web -> Máy): Đẩy nhanh Delta toàn bộ hồ sơ Nhân sự/Học sinh mới & ảnh khuôn mặt `<200KB` từ Web xuống máy (tối đa 500 slot/máy).
 */
async function quickBidirectionalSync(
  tenantId,
  { deviceId = null, campus = null, actorId = null, overrideOpts = {} } = {}
) {
  const startedAt = Date.now();

  // Pha 1: Kéo nhanh từ Máy về Web (không ghi đè những ảnh mặt mới hơn đang có sẵn trên Web)
  const pullPhase = await pullAllFromDevices(tenantId, {
    deviceId,
    campus,
    overwriteExistingFaces: false,
    includeEvents: true,
    actorId,
    overrideOpts
  });

  // Pha 2: Đẩy nhanh Delta từ Web xuống Máy (tải lại bioCtx để bao gồm cả ảnh vừa kéo từ Máy A sang Máy B cùng phân hiệu!)
  const pushPhase = await syncSmartToDevices(tenantId, {
    deviceId,
    campus,
    fastDelta: true,
    forceFullSync: false,
    actorId,
    overrideOpts
  });

  const durationMs = Date.now() - startedAt;

  return {
    durationMs,
    pullSummary: {
      pulledDevices: pullPhase.pulledDevices,
      totalDevices: pullPhase.totalDevices,
      matchedUsers: pullPhase.totalMatchedUsers,
      pulledFaces: pullPhase.totalPulledFaces,
      eventsIngested: pullPhase.totalEventsIngested,
      eventsUnmapped: pullPhase.totalEventsUnmapped,
      unmatchedOnDevice: pullPhase.unmatchedOnDevice,
      syncedPeople: pullPhase.syncedPeople
    },
    pushSummary: {
      syncedDevices: pushPhase.syncedDevices,
      totalDevices: pushPhase.totalDevices,
      deviceReports: pushPhase.deviceReports
    }
  };
}

/**
 * Đẩy nhanh 1 Nhân sự hoặc 1 Học sinh (+ Ảnh quét mặt `< 200KB`) xuống các máy chấm công thuộc đúng Phân hiệu.
 */
async function pushSinglePersonToCampusDevices(tenantId, {
  subjectType,
  subjectId,
  targetDeviceId = null,
  actorId = null,
  overrideOpts = {}
}) {
  const cleanType = String(subjectType || '').toUpperCase();
  if (!['EMPLOYEE', 'STUDENT'].includes(cleanType) || !mongoose.isValidObjectId(subjectId)) {
    throw createServiceError('Thông tin hồ sơ cần đồng bộ không hợp lệ', 'INVALID_SUBJECT', 400);
  }

  const bioCtx = await loadTenantBiometricContext(tenantId);
  const target = bioCtx.unifiedRoster.find(
    (item) =>
      item.subjectType === cleanType &&
      (item.subjectId === String(subjectId) || item.userId === String(subjectId))
  );

  if (!target) {
    throw createServiceError('Không tìm thấy hồ sơ Nhân sự / Học sinh trong trường này', 'SUBJECT_NOT_FOUND', 404);
  }
  if (!target.personCode) {
    throw createServiceError('Hồ sơ chưa có Mã chấm công để đẩy xuống thiết bị', 'MISSING_PERSON_CODE', 400);
  }

  const devQuery = { tenantId, enabled: true };
  if (targetDeviceId && mongoose.isValidObjectId(targetDeviceId)) {
    devQuery._id = targetDeviceId;
  } else {
    devQuery.campus = { $in: [target.campus || DEFAULT_CAMPUS_NAME, 'ALL'] };
  }

  const devices = await TimekeepingDevice.find(devQuery);
  if (devices.length === 0) {
    throw createServiceError(
      `Chưa có máy chấm công nào đang bật tại phân hiệu "${target.campus}"`,
      'NO_CAMPUS_DEVICES',
      404
    );
  }

  const faceBuf = target.faceProfileDoc?.imageBase64
    ? Buffer.from(target.faceProfileDoc.imageBase64, 'base64')
    : null;

  const results = await runWithConcurrency(devices, DEVICE_PARALLEL_LIMIT, async (dev) => {
    try {
      const config = await buildDeviceConfig(dev, overrideOpts);
      if (!config.username || !config.password) {
        return {
          deviceId: String(dev._id),
          deviceName: dev.name,
          success: false,
          message: 'Thiếu mật khẩu quản trị máy chấm công'
        };
      }

      const pushRes = await hikvisionIsapiService.upsertPersonAndFaceOnDevice(config, {
        personCode: target.personCode,
        fullName: target.fullName,
        faceBuffer: faceBuf
      });

      if (pushRes.success) {
        await ensureDevicePersonMapping(tenantId, dev._id, target, actorId);
        if (pushRes.faceSynced && target.faceProfileDoc?._id) {
          await BiometricFaceProfile.updateOne(
            { _id: target.faceProfileDoc._id, tenantId },
            {
              $set: { lastSyncedAt: new Date() },
              $addToSet: { syncedDeviceIds: dev._id }
            }
          );
        }
        dev.status = 'ONLINE';
        dev.lastSeenAt = new Date();
        await dev.save();
      }

      return {
        deviceId: String(dev._id),
        deviceName: dev.name,
        campus: dev.campus,
        success: pushRes.success,
        faceSynced: pushRes.faceSynced
      };
    } catch (err) {
      return {
        deviceId: String(dev._id),
        deviceName: dev.name,
        campus: dev.campus,
        success: false,
        message: err.message
      };
    }
  });

  const successCount = results.filter((r) => r.success).length;

  return {
    personCode: target.personCode,
    fullName: target.fullName,
    campus: target.campus,
    totalDevices: devices.length,
    syncedDevices: successCount,
    results
  };
}

/**
 * Giải phóng bộ nhớ 500 slot: Xóa toàn bộ Nhân sự đã nghỉ việc & Học sinh đã thôi học/ra trường khỏi bộ nhớ máy chấm công.
 */
async function pruneInactiveUsersOnDevice(tenantId, deviceId, overrideOpts = {}) {
  if (!mongoose.isValidObjectId(deviceId)) {
    throw createServiceError('ID thiết bị không hợp lệ', 'INVALID_DEVICE_ID', 400);
  }
  const device = await TimekeepingDevice.findOne({ _id: deviceId, tenantId });
  if (!device) {
    throw createServiceError('Không tìm thấy máy chấm công trong trường này', 'DEVICE_NOT_FOUND', 404);
  }

  const config = await buildDeviceConfig(device, overrideOpts);
  if (!config.username || !config.password) {
    throw createServiceError('Chưa cấu hình mật khẩu quản trị thiết bị ISAPI', 'DEVICE_CREDENTIALS_MISSING', 400);
  }

  return withDeviceBiometricLock(device._id, 'Giải phóng slot nghỉ', async () => {
  const bioCtx = await loadTenantBiometricContext(tenantId);
  const { codesToPrune } = await selectTargetRosterForDeviceCapacity(tenantId, device, bioCtx.unifiedRoster);

  const delRes = await hikvisionIsapiService.deletePersonsFromDevice(config, codesToPrune);
  const usage = await hikvisionIsapiService
    .getDeviceCapacityUsage(config, device.maxUserCapacity || 500)
    .catch(() => ({ currentStoredUsers: device.currentStoredUsers || 0 }));

  device.status = 'ONLINE';
  device.lastSeenAt = new Date();
  device.currentStoredUsers = usage.currentStoredUsers;
  if (device.lastSyncSummary) {
    device.lastSyncSummary.prunedInactiveCount = delRes.removedCount;
  }
  device.statusMessage = `Đã giải phóng ${delRes.removedCount} slot nghỉ việc/thôi học • Còn ${usage.currentStoredUsers}/${device.maxUserCapacity || 500} slot`;
  await device.save();

  return {
    deviceId: String(device._id),
    deviceName: device.name,
    removedCount: delRes.removedCount,
    currentStoredUsers: usage.currentStoredUsers,
    maxUserCapacity: device.maxUserCapacity || 500,
    message:
      delRes.removedCount > 0
        ? `Đã xóa ${delRes.removedCount} hồ sơ nghỉ việc/thôi học và thu hồi slot trên máy "${device.name}"!`
        : `Bộ nhớ máy "${device.name}" đã sạch, không có hồ sơ nghỉ việc/thôi học nào cần thu hồi.`
  };
  });
}

/**
 * Mở khóa cửa từ xa (`Door 1`) trên máy chấm công của phân hiệu.
 */
async function unlockDoorOnDevice(tenantId, deviceId, doorNo = 1, overrideOpts = {}) {
  if (!mongoose.isValidObjectId(deviceId)) {
    throw createServiceError('ID thiết bị không hợp lệ', 'INVALID_DEVICE_ID', 400);
  }
  const device = await TimekeepingDevice.findOne({ _id: deviceId, tenantId });
  if (!device) {
    throw createServiceError('Không tìm thấy máy chấm công trong trường này', 'DEVICE_NOT_FOUND', 404);
  }

  const config = await buildDeviceConfig(device, overrideOpts);
  if (!config.username || !config.password) {
    throw createServiceError('Chưa cấu hình mật khẩu quản trị thiết bị ISAPI để mở cửa từ xa', 'DEVICE_CREDENTIALS_MISSING', 400);
  }

  const res = await hikvisionIsapiService.remoteUnlockDoor(config, doorNo);
  device.status = 'ONLINE';
  device.lastSeenAt = new Date();
  await device.save();

  return {
    success: true,
    doorNo: res.doorNo,
    deviceName: device.name,
    campus: device.campus,
    location: device.location,
    message: `Đã gửi lệnh mở khóa cửa số ${res.doorNo} tại "${device.name}" (${device.campus} — ${device.location})!`
  };
}

/**
 * Quét tự động máy chấm công Hikvision trong mạng LAN của phân hiệu (hỗ trợ truyền mật khẩu thử để đọc luôn Model/SN/500-slot).
 */
async function scanLanDevicesForTenant(tenantId, { subnetPrefix = null, probeUsername = '', probePassword = '' } = {}) {
  const [existingDevices, allLockedSerials] = await Promise.all([
    TimekeepingDevice.find({ tenantId })
      .select('_id host name campus model serialNumber httpPort httpsPort')
      .lean(),
    TimekeepingDevice.find({
      tenantId: { $ne: tenantId },
      serialNumber: { $type: 'string', $gt: '' }
    })
      .select('serialNumber')
      .lean()
  ]);

  const foreignSerialSet = new Set(allLockedSerials.map((x) => String(x.serialNumber).trim()));

  const scanRes = await hikvisionIsapiService.discoverHikvisionDevicesOnLan({
    subnetPrefix,
    existingDevices,
    probeUsername,
    probePassword
  });

  return {
    ...scanRes,
    discoveredDevices: (scanRes.discoveredDevices || []).map((d) => ({
      ...d,
      lockedToOtherCampus: Boolean(d.serialNumber && foreignSerialSet.has(String(d.serialNumber).trim()))
    }))
  };
}

/**
 * Làm giàu danh sách máy chấm công quét từ `Local LAN Connector (127.0.0.1:18686)` với trạng thái lưu/khóa Serial trên Cloud DB.
 */
async function enrichConnectorDiscoveredDevices(tenantId, rawDiscoveredDevices = []) {
  const [existingDevices, foreignDevices] = await Promise.all([
    TimekeepingDevice.find({ tenantId }).select('_id host name campus model serialNumber').lean(),
    TimekeepingDevice.find({
      tenantId: { $ne: tenantId },
      serialNumber: { $type: 'string', $gt: '' }
    })
      .select('serialNumber')
      .lean()
  ]);

  const bySerial = new Map();
  const byHost = new Map();
  for (const dev of existingDevices) {
    if (dev.serialNumber) bySerial.set(String(dev.serialNumber).trim(), dev);
    if (dev.host) byHost.set(String(dev.host).trim(), dev);
  }
  const foreignSerialSet = new Set(foreignDevices.map((x) => String(x.serialNumber).trim()));

  return (Array.isArray(rawDiscoveredDevices) ? rawDiscoveredDevices : []).map((item) => {
    const cleanSn = String(item.serialNumber || '').trim();
    const matched = (cleanSn ? bySerial.get(cleanSn) : null) || byHost.get(String(item.host || '').trim()) || null;
    const lockedToOtherCampus = Boolean(cleanSn && foreignSerialSet.has(cleanSn));

    return {
      ...item,
      alreadySaved: Boolean(matched),
      savedDeviceId: matched ? String(matched._id) : null,
      savedName: matched?.name || '',
      savedCampus: matched?.campus || '',
      lockedToOtherCampus
    };
  });
}

/**
 * Chuẩn bị gói dữ liệu & phong bì mật khẩu mã hóa `encryptedDeviceAuth` để trình duyệt gửi xuống `Local LAN Connector (127.0.0.1:18686)`.
 */
async function prepareConnectorDeviceTask(
  tenantId,
  deviceId,
  { action = '', operation = '', fastDelta = true, forceFullSync = false, subjectType = null, subjectId = null } = {}
) {
  const rawAction = String(action || operation || 'INSPECT').trim().toUpperCase();
  const normalizedAction = rawAction === 'CONFIGURE-WEBHOOK' || rawAction === 'CONFIGURE_WEBHOOK' ? 'WEBHOOK' : rawAction;
  if (!mongoose.isValidObjectId(deviceId)) {
    throw createServiceError('Mã định danh máy chấm công không hợp lệ.', 'INVALID_DEVICE_ID', 400);
  }
  const device = await TimekeepingDevice.findOne({ _id: deviceId, tenantId });
  if (!device) {
    throw createServiceError('Không tìm thấy máy chấm công này trong phân hiệu của bạn.', 'DEVICE_NOT_FOUND', 404);
  }

  const encryptedDeviceAuth = await buildEncryptedDeviceAuthForConnector(tenantId, device);
  if (!encryptedDeviceAuth) {
    throw createServiceError(
      `Máy "${device.name}" chưa được lưu mật khẩu quản trị. Bạn hãy bấm biểu tượng Sửa trên thẻ máy để nhập mật khẩu thiết bị trước nhé.`,
      'DEVICE_CREDENTIALS_MISSING',
      400
    );
  }

  const scheme = device.transportScheme || (device.httpsPort === 80 ? 'http' : 'https');
  const port = scheme === 'http' ? (device.httpPort || 80) : (device.httpsPort || 443);

  const taskPayload = {
    device: {
      deviceId: String(device._id),
      deviceCode: device.deviceCode,
      name: device.name,
      campus: device.campus,
      host: device.host,
      port,
      transportScheme: scheme,
      username: device.authUsernameHint || 'admin'
    },
    expectedSerial: device.serialNumber || '',
    encryptedDeviceAuth
  };

  if (normalizedAction === 'PUSH' || normalizedAction === 'PUSH_SINGLE') {
    const bioCtx = await loadTenantBiometricContext(tenantId);
    let targetsToPush = [];

    if (normalizedAction === 'PUSH_SINGLE' && subjectType && subjectId) {
      const cleanType = String(subjectType).toUpperCase();
      const single = bioCtx.unifiedRoster.find(
        (x) => x.subjectType === cleanType && (x.subjectId === String(subjectId) || x.userId === String(subjectId))
      );
      if (!single || !single.personCode) {
        throw createServiceError(
          'Hồ sơ này chưa có Mã học sinh / Mã nhân sự để đẩy xuống máy chấm công.',
          'MISSING_PERSON_CODE',
          400
        );
      }
      targetsToPush = [single];
    } else {
      const { selectedTargets } = await selectTargetRosterForDeviceCapacity(tenantId, device, bioCtx.unifiedRoster);
      targetsToPush = selectedTargets;
    }

    taskPayload.fastDelta = Boolean(fastDelta) && !forceFullSync;
    taskPayload.targets = targetsToPush.map((t) => ({
      subjectType: t.subjectType,
      subjectId: t.subjectId,
      personCode: t.personCode,
      fullName: t.fullName,
      imageBase64: t.faceProfileDoc?.imageBase64 || '',
      alreadySyncedOnDevice: Boolean(
        t.faceProfileDoc &&
          Array.isArray(t.faceProfileDoc.syncedDeviceIds) &&
          t.faceProfileDoc.syncedDeviceIds.some((id) => String(id) === String(device._id))
      )
    }));
  } else if (normalizedAction === 'PRUNE') {
    const bioCtx = await loadTenantBiometricContext(tenantId);
    const { codesToPrune } = await selectTargetRosterForDeviceCapacity(tenantId, device, bioCtx.unifiedRoster);
    taskPayload.personCodes = codesToPrune;
  } else if (normalizedAction === 'WEBHOOK') {
    const tenantDoc = await Tenant.findById(tenantId).select('code').lean();
    taskPayload.schoolCode = tenantDoc?.code || '';
  }

  return taskPayload;
}

/**
 * Tiếp nhận dữ liệu Người dùng + Ảnh mặt (<200KB) + Lượt quẹt chấm công do `Local LAN Connector (127.0.0.1:18686)` kéo từ máy Hikvision về Cloud Web.
 * Bắt buộc đối chiếu khóa cứng `deviceSerial` với `tenantId` trước khi lưu!
 */
async function ingestConnectorPulledPayload(
  tenantId,
  deviceId,
  {
    deviceInfo = {},
    users = [],
    events = [],
    overwriteExistingFaces = true,
    syncNamesFromDevice = false,
    inspectOnly = false,
    actorId = null
  } = {}
) {
  if (!mongoose.isValidObjectId(deviceId)) {
    throw createServiceError('Mã máy chấm công không hợp lệ.', 'INVALID_DEVICE_ID', 400);
  }
  const device = await TimekeepingDevice.findOne({ _id: deviceId, tenantId });
  if (!device) {
    throw createServiceError('Không tìm thấy máy chấm công trong phân hiệu của bạn.', 'DEVICE_NOT_FOUND', 404);
  }

  // Khóa an toàn tuyệt đối theo deviceSerial gắn với phân hiệu!
  if (deviceInfo?.serialNumber) {
    await assertDeviceSerialCampusLock(tenantId, device, deviceInfo.serialNumber);
  }

  // Trường hợp chỉ kiểm tra kết nối & đọc dung lượng bộ nhớ (KHÔNG xóa bản chụp hồ sơ trên máy)
  if (inspectOnly) {
    if (deviceInfo?.model) device.model = deviceInfo.model;
    if (deviceInfo?.macAddress) device.macAddress = deviceInfo.macAddress;
    if (deviceInfo?.maxUserCapacity) device.maxUserCapacity = deviceInfo.maxUserCapacity;
    if (deviceInfo?.currentStoredUsers !== undefined) {
      device.currentStoredUsers = Number(deviceInfo.currentStoredUsers) || 0;
    }
    if (deviceInfo?.currentStoredFaces !== undefined) {
      device.currentStoredFaces = Number(deviceInfo.currentStoredFaces) || 0;
    }
    device.status = 'ONLINE';
    device.lastSeenAt = new Date();
    device.statusMessage = `Đang trực tuyến • Bộ nhớ lưu ${device.currentStoredUsers}/${device.maxUserCapacity || 500} hồ sơ`;
    await device.save();

    return {
      deviceId: String(device._id),
      deviceName: device.name,
      currentStoredUsers: device.currentStoredUsers,
      currentStoredFaces: device.currentStoredFaces,
      maxUserCapacity: device.maxUserCapacity || 500,
      message: `Máy "${device.name}" đang kết nối tốt: bộ nhớ hiện lưu ${device.currentStoredUsers}/${device.maxUserCapacity || 500} hồ sơ (${device.currentStoredFaces || 0} ảnh khuôn mặt).`
    };
  }

  return withDeviceBiometricLock(device._id, 'Lưu dữ liệu kéo từ cầu nối nội bộ', async () => {
    const [bioCtx, deviceMappings] = await Promise.all([
      loadTenantBiometricContext(tenantId),
      AttendanceDevicePersonMapping.find({ tenantId, deviceId: device._id, active: true }).lean()
    ]);

    const { matchDeviceUser } = buildRosterLookupMaps(bioCtx.unifiedRoster, deviceMappings);

    const deviceUsers = Array.isArray(users) ? users : [];
    // Lưu toàn bộ hồ sơ thực tế đang có trên máy vào DeviceStoredPerson để hiển thị rõ trên UI
    await syncDeviceStoredPersonsSnapshot(tenantId, device._id, deviceUsers, { pruneMissing: true });

    let matchedCount = 0;
    let pulledFaceCount = 0;
    let updatedNamesCount = 0;
    let totalFacesOnDevice = 0;
    const syncedPeople = [];
    const unmatchedOnDevice = [];

    for (const du of deviceUsers) {
      if (Number(du.numOfFace) > 0 || du.faceDataUrl) {
        totalFacesOnDevice += 1;
      }
      const rawEmpNo = String(du.employeeNo || '').trim();
      if (!rawEmpNo) continue;
      const codeUpper = rawEmpNo.toUpperCase();
      const cleanDevName = String(du.name || '').trim();

      const matched = matchDeviceUser(device, rawEmpNo, cleanDevName);

      if (!matched) {
        if (unmatchedOnDevice.length < 100) {
          unmatchedOnDevice.push({
            deviceId: String(device._id),
            deviceName: device.name,
            employeeNo: rawEmpNo,
            name: cleanDevName || `Mã ${rawEmpNo}`,
            numOfFace: Number(du.numOfFace || 0),
            hasFace: Boolean(Number(du.numOfFace) > 0 || du.faceDataUrl),
            faceDataUrl: du.faceDataUrl || ''
          });
        }
        continue;
      }

      matchedCount += 1;
      await ensureDevicePersonMapping(tenantId, device._id, matched, actorId, rawEmpNo);

      // Cập nhật Tên từ máy về Web nếu người dùng bật lấy cả Ảnh & Tên và tên trên máy hợp lệ
      if (syncNamesFromDevice && cleanDevName && cleanDevName !== rawEmpNo && cleanDevName !== matched.fullName) {
        if (matched.subjectType === 'EMPLOYEE' && matched.employeeRecordId) {
          await Employee.updateOne(
            { _id: matched.employeeRecordId, tenantId },
            { $set: { fullName: cleanDevName } }
          );
          matched.fullName = cleanDevName;
          updatedNamesCount += 1;
        } else if (matched.subjectType === 'STUDENT' && matched.subjectId) {
          await Student.updateOne(
            { _id: matched.subjectId, tenantId },
            { $set: { fullName: cleanDevName } }
          );
          matched.fullName = cleanDevName;
          updatedNamesCount += 1;
        }
      }

      if (du.faceDataUrl && (overwriteExistingFaces || !matched.hasBiometricFace)) {
        try {
          const parsedImg = parseAndValidateFaceImagePayload(du.faceDataUrl);
          const saved = await BiometricFaceProfile.findOneAndUpdate(
            {
              tenantId,
              subjectType: matched.subjectType,
              subjectId: new mongoose.Types.ObjectId(matched.subjectId)
            },
            {
              $set: {
                linkedUserId: matched.userId ? new mongoose.Types.ObjectId(matched.userId) : null,
                personCode: matched.personCode || codeUpper,
                fullName: matched.fullName,
                campus: matched.campus || device.campus || DEFAULT_CAMPUS_NAME,
                mimeType: parsedImg.mimeType,
                imageBase64: parsedImg.imageBase64,
                sizeBytes: parsedImg.sizeBytes,
                source: 'PULLED_FROM_DEVICE',
                lastSyncedAt: new Date(),
                updatedBy: actorId || null
              },
              $addToSet: { syncedDeviceIds: device._id }
            },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
          );
          pulledFaceCount += 1;
          syncedPeople.push({
            subjectType: matched.subjectType,
            subjectId: matched.subjectId,
            personCode: matched.personCode || codeUpper,
            fullName: matched.fullName,
            campus: matched.campus,
            sizeKB: Math.max(1, Math.round((parsedImg.sizeBytes / 1024) * 10) / 10),
            faceDataUrl: `data:${saved.mimeType};base64,${saved.imageBase64}`
          });
        } catch {
          // Bỏ qua ảnh lẻ không hợp lệ
        }
      }
    }

    // Ghi nhận các lượt quẹt chấm công/điểm danh kéo từ máy về bảng Điểm danh
    let eventsIngested = 0;
    const safeEvents = Array.isArray(events) ? events : [];
    for (const ev of safeEvents) {
      const empNo = String(ev.employeeNoString || '').trim();
      if (!empNo) continue;
      const occurredAt = ev.time ? new Date(ev.time) : new Date();
      if (Number.isNaN(occurredAt.getTime())) continue;
      const extEvId = ev.serialNo != null
        ? `HIK-${device.serialNumber || device.deviceCode}-${ev.serialNo}`
        : `HIK-${device.serialNumber || device.deviceCode}-${empNo}-${occurredAt.getTime()}`;
      try {
        const out = await ingestDeviceEvent({
          deviceId: device.deviceCode,
          deviceObjectId: device._id,
          externalEventId: extEvId,
          tenantId,
          externalPersonId: empNo,
          employeeName: ev.name || `Mã số ${empNo}`,
          eventType: 'PUNCH',
          source: 'FACE',
          authenticationMethod: 'FACE',
          occurredAt,
          calculateImmediately: true,
          enableMorningLateCheck: true,
          rawPayload: ev
        });
        if (!out.duplicate && !out.unmapped) {
          eventsIngested += 1;
        }
      } catch {
        // Bỏ qua sự kiện lẻ lỗi
      }
    }

    if (deviceInfo?.model) device.model = deviceInfo.model;
    if (deviceInfo?.macAddress) device.macAddress = deviceInfo.macAddress;
    if (deviceInfo?.maxUserCapacity) device.maxUserCapacity = deviceInfo.maxUserCapacity;
    device.status = 'ONLINE';
    device.lastSeenAt = new Date();
    device.currentStoredUsers = deviceUsers.length;
    device.currentStoredFaces = totalFacesOnDevice;

    let friendlySummary = '';
    if (deviceUsers.length === 0) {
      friendlySummary = `Đã kết nối máy "${device.name}": bộ nhớ máy hiện đang trống (0 hồ sơ). Bạn có thể bấm "Đồng bộ Web xuống máy" để nạp danh sách học sinh & nhân sự xuống máy.`;
    } else if (unmatchedOnDevice.length > 0 && matchedCount === 0) {
      friendlySummary = `Đã đọc thành công ${deviceUsers.length} hồ sơ (${totalFacesOnDevice} ảnh khuôn mặt) đang lưu trong máy "${device.name}"! Bạn có thể xem danh sách ngay bên dưới và bấm "Lấy Ảnh & Tên về Web".`;
    } else if (unmatchedOnDevice.length > 0) {
      friendlySummary = `Đã đọc ${deviceUsers.length} hồ sơ từ máy "${device.name}": cập nhật ${matchedCount} hồ sơ đã khớp (${pulledFaceCount} ảnh mặt) và phát hiện ${unmatchedOnDevice.length} hồ sơ mới trên máy chờ lấy về Web.`;
    } else {
      friendlySummary = `Đã kéo thành công từ máy "${device.name}": cập nhật ${matchedCount} hồ sơ, lưu ${pulledFaceCount} ảnh khuôn mặt${updatedNamesCount > 0 ? `, đồng bộ ${updatedNamesCount} tên` : ''}${eventsIngested > 0 ? ` và ${eventsIngested} lượt điểm danh mới` : ''}!`;
    }

    device.statusMessage = `Đang lưu ${deviceUsers.length} hồ sơ (${totalFacesOnDevice} ảnh mặt) trên máy`;
    await device.save();

    publishCampusRealtimeEvent(tenantId, {
      type: 'DEVICE_PULL_COMPLETED',
      tone: 'success',
      title: `Đọc dữ liệu từ ${device.name}`,
      message: friendlySummary,
      deviceName: device.name
    });

    return {
      deviceId: String(device._id),
      deviceName: device.name,
      campus: device.campus,
      host: device.host,
      totalOnDevice: deviceUsers.length,
      totalFacesOnDevice,
      matchedCount,
      pulledFaceCount,
      updatedNamesCount,
      eventsIngested,
      syncedPeople: syncedPeople.slice(0, 40),
      unmatchedOnDevice,
      message: friendlySummary
    };
  });
}

/**
 * Hoàn tất và lưu trạng thái sau khi `Local LAN Connector (127.0.0.1:18686)` đẩy danh sách khuôn mặt xuống máy Hikvision.
 */
async function completeConnectorPushedPayload(
  tenantId,
  deviceId,
  {
    deviceInfo = {},
    totalTargets = 0,
    syncedUsers = 0,
    syncedFaces = 0,
    skippedUnchangedCount = 0,
    faceSyncedPersonCodes = [],
    failedCount = 0,
    failedItems = [],
    actorId = null
  } = {}
) {
  if (!mongoose.isValidObjectId(deviceId)) {
    throw createServiceError('Mã máy chấm công không hợp lệ.', 'INVALID_DEVICE_ID', 400);
  }
  const device = await TimekeepingDevice.findOne({ _id: deviceId, tenantId });
  if (!device) {
    throw createServiceError('Không tìm thấy máy chấm công trong phân hiệu của bạn.', 'DEVICE_NOT_FOUND', 404);
  }

  if (deviceInfo?.serialNumber) {
    await assertDeviceSerialCampusLock(tenantId, device, deviceInfo.serialNumber);
  }

  const bioCtx = await loadTenantBiometricContext(tenantId);
  const cleanFaceCodes = (Array.isArray(faceSyncedPersonCodes) ? faceSyncedPersonCodes : [])
    .map((c) => String(c || '').trim().toUpperCase())
    .filter(Boolean);

  if (cleanFaceCodes.length > 0) {
    await BiometricFaceProfile.updateMany(
      { tenantId, personCode: { $in: cleanFaceCodes } },
      {
        $set: { lastSyncedAt: new Date() },
        $addToSet: { syncedDeviceIds: device._id }
      }
    );
  }

  // Đảm bảo bảng ánh xạ ID máy & bản chụp hồ sơ trên máy được cập nhật đồng bộ
  const { selectedTargets } = await selectTargetRosterForDeviceCapacity(tenantId, device, bioCtx.unifiedRoster);
  await runWithConcurrency(selectedTargets, 6, async (t) => {
    await ensureDevicePersonMapping(tenantId, device._id, t, actorId);
  });

  if (syncedUsers > 0 && selectedTargets.length > 0) {
    const pushedSnapshot = selectedTargets.slice(0, syncedUsers).map((t) => ({
      employeeNo: t.personCode,
      name: t.fullName,
      numOfFace: t.faceProfileDoc?.imageBase64 ? 1 : 0,
      imageBase64: t.faceProfileDoc?.imageBase64 || ''
    }));
    await syncDeviceStoredPersonsSnapshot(tenantId, device._id, pushedSnapshot, { pruneMissing: false });
  }

  if (deviceInfo?.model) device.model = deviceInfo.model;
  if (deviceInfo?.macAddress) device.macAddress = deviceInfo.macAddress;
  device.status = 'ONLINE';
  device.lastSeenAt = new Date();
  device.currentStoredUsers = Number(deviceInfo?.currentStoredUsers ?? syncedUsers) || syncedUsers;
  device.currentStoredFaces = Number(deviceInfo?.currentStoredFaces ?? syncedFaces) || syncedFaces;

  const friendlyMsg =
    failedCount > 0 && failedItems?.[0]?.reason
      ? `Đã đồng bộ xong ${syncedUsers}/${totalTargets} hồ sơ (${syncedFaces} khuôn mặt) xuống máy "${device.name}". Lưu ý: ${failedItems[0].reason}`
      : `Đã đồng bộ thành công ${syncedUsers} học sinh & nhân sự (${syncedFaces} ảnh khuôn mặt) xuống máy "${device.name}"!`;

  device.lastSyncSummary = {
    totalTargets,
    syncedUsers,
    syncedFaces,
    syncedStaffCount: selectedTargets.filter((x) => x.subjectType === 'EMPLOYEE').length,
    syncedStudentCount: selectedTargets.filter((x) => x.subjectType === 'STUDENT').length,
    prunedInactiveCount: 0,
    failedCount,
    message: friendlyMsg,
    syncedAt: new Date()
  };
  device.statusMessage = friendlyMsg;
  await device.save();

  publishCampusRealtimeEvent(tenantId, {
    type: 'DEVICE_PUSH_COMPLETED',
    tone: failedCount > 0 ? 'warning' : 'success',
    title: `Đồng bộ khuôn mặt xuống ${device.name}`,
    message: friendlyMsg,
    deviceName: device.name
  });

  return {
    deviceId: String(device._id),
    deviceName: device.name,
    syncedUsers,
    syncedFaces,
    skippedUnchangedCount,
    failedCount,
    failedItems: Array.isArray(failedItems) ? failedItems : [],
    message: friendlyMsg
  };
}

/**
 * Cập nhật 1 chạm địa chỉ HTTP Listening Webhook theo Tên miền động hiện tại xuống máy chấm công Hikvision
 * (hỗ trợ cả khi Connector `127.0.0.1:18686` đã đẩy trực tiếp dưới LAN hoặc Backend đẩy qua LAN).
 */
async function configureDeviceWebhookEndpoint(
  tenantId,
  deviceId,
  { publicBaseUrl = '', connectorVerifiedResult = null, overrideOpts = {} } = {}
) {
  if (!mongoose.isValidObjectId(deviceId)) {
    throw createServiceError('Mã máy chấm công không hợp lệ.', 'INVALID_DEVICE_ID', 400);
  }
  const [device, tenantDoc] = await Promise.all([
    TimekeepingDevice.findOne({ _id: deviceId, tenantId }),
    Tenant.findById(tenantId).select('code name').lean()
  ]);
  if (!device) {
    throw createServiceError('Không tìm thấy máy chấm công trong phân hiệu của bạn.', 'DEVICE_NOT_FOUND', 404);
  }
  if (!tenantDoc?.code) {
    throw createServiceError('Không xác định được mã phân hiệu trường.', 'TENANT_NOT_FOUND', 404);
  }

  const cleanBase = String(publicBaseUrl || '').replace(/\/+$/, '');
  const targetWebhookUrl = `${cleanBase}/api/attendance/webhook/${tenantDoc.code}`;

  if (connectorVerifiedResult) {
    if (connectorVerifiedResult.deviceInfo?.serialNumber) {
      await assertDeviceSerialCampusLock(tenantId, device, connectorVerifiedResult.deviceInfo.serialNumber);
    }
  } else {
    const config = await buildDeviceConfig(device, overrideOpts);
    if (!config.username || !config.password) {
      throw createServiceError(
        `Máy "${device.name}" chưa được lưu mật khẩu quản trị. Bạn hãy nhập mật khẩu máy trước khi cập nhật địa chỉ nhận dữ liệu nhé.`,
        'DEVICE_CREDENTIALS_MISSING',
        400
      );
    }
    const info = await hikvisionIsapiService.getDeviceInfo(config);
    if (info?.serialNumber) {
      await assertDeviceSerialCampusLock(tenantId, device, info.serialNumber);
    }
    await hikvisionIsapiService.configureDeviceHttpWebhook(config, targetWebhookUrl);
  }

  device.status = 'ONLINE';
  device.lastSeenAt = new Date();
  device.webhookConfiguredUrl = targetWebhookUrl;
  device.webhookConfiguredAt = new Date();
  device.statusMessage = `Đã trỏ tự động nhận dữ liệu chấm công về ${targetWebhookUrl}`;
  await device.save();

  const friendlyMsg = `Đã cập nhật thành công địa chỉ nhận dữ liệu tự động (${targetWebhookUrl}) xuống máy "${device.name}". Từ bây giờ khi trẻ quét mặt, điểm danh sẽ báo ngay lên màn hình!`;

  publishCampusRealtimeEvent(tenantId, {
    type: 'DEVICE_WEBHOOK_CONFIGURED',
    tone: 'success',
    title: `Đã cập nhật tên miền mới cho ${device.name}`,
    message: friendlyMsg,
    deviceName: device.name
  });

  return {
    deviceId: String(device._id),
    deviceName: device.name,
    webhookUrl: targetWebhookUrl,
    configuredAt: device.webhookConfiguredAt,
    message: friendlyMsg
  };
}

/**
 * Gỡ khóa `deviceSerial` hoặc chuyển máy chấm công sang phân hiệu khác — CHỈ DÀNH RIÊNG CHO KỸ THUẬT VIÊN NHÀ CUNG CẤP (`isVendorSupport`).
 */
async function unlockOrReassignDeviceSerialByVendor(
  tenantId,
  deviceId,
  { newSerialNumber = '', targetSchoolCode = '', targetTenantId = '', isVendorSupport = false } = {}
) {
  if (!isVendorSupport) {
    throw createServiceError(
      'Mã phần cứng của máy chấm công đã được khóa cố định với phân hiệu trường. Chỉ Kỹ thuật viên Nhà cung cấp phần mềm mới có quyền gỡ khóa hoặc chuyển phân hiệu cho thiết bị.',
      'SERIAL_UNLOCK_VENDOR_ONLY',
      403
    );
  }

  if (!mongoose.isValidObjectId(deviceId)) {
    throw createServiceError('Mã máy chấm công không hợp lệ.', 'INVALID_DEVICE_ID', 400);
  }
  const device = await TimekeepingDevice.findOne({ _id: deviceId, tenantId });
  if (!device) {
    throw createServiceError('Không tìm thấy máy chấm công cần gỡ khóa.', 'DEVICE_NOT_FOUND', 404);
  }

  const cleanTargetSchoolCode = String(targetSchoolCode || '').trim().toUpperCase();
  const cleanTargetTenantId = String(targetTenantId || '').trim();
  if (cleanTargetSchoolCode || (cleanTargetTenantId && mongoose.isValidObjectId(cleanTargetTenantId))) {
    const targetQuery = cleanTargetSchoolCode
      ? { code: cleanTargetSchoolCode, status: 'active' }
      : { _id: cleanTargetTenantId, status: 'active' };
    const targetTenant = await Tenant.findOne(targetQuery);
    if (!targetTenant) {
      throw createServiceError(
        `Không tìm thấy phân hiệu trường đang hoạt động cần chuyển đến.`,
        'TARGET_TENANT_NOT_FOUND',
        404
      );
    }
    const prevName = device.name;
    // Khi chuyển sang phân hiệu khác: xóa mật khẩu mã hóa theo AAD cũ và bảng ánh xạ của trường cũ để tuyệt đối an toàn
    await AttendanceDevicePersonMapping.deleteMany({ tenantId: device.tenantId, deviceId: device._id });
    device.tenantId = targetTenant._id;
    device.credentialKey = `HIKVISION_${targetTenant.code.replace(/[^A-Z0-9_]/g, '_')}`;
    device.encryptedAuth = { iv: '', tag: '', cipherText: '' };
    device.webhookConfiguredUrl = '';
    device.webhookConfiguredAt = null;
    device.serialLockedByVendor = true;
    await device.save();

    return {
      transferred: true,
      targetSchoolCode: targetTenant.code,
      targetSchoolName: targetTenant.name,
      message: `Đã chuyển giao máy chấm công "${prevName}" sang phân hiệu ${targetTenant.name} (${targetTenant.code}). Hãy nhập lại mật khẩu thiết bị tại phân hiệu mới để đồng bộ.`
    };
  }

  const cleanNewSn = String(newSerialNumber || '').trim();
  if (cleanNewSn) {
    const conflict = await TimekeepingDevice.findOne({
      serialNumber: cleanNewSn,
      _id: { $ne: device._id }
    }).lean();
    if (conflict) {
      throw createServiceError(
        'Mã phần cứng mới này đang thuộc về một máy chấm công khác trên hệ thống.',
        'SERIAL_LOCKED_OTHER_CAMPUS',
        409
      );
    }
    device.serialNumber = cleanNewSn;
    device.serialLockedAt = new Date();
    device.serialLockedByVendor = true;
  } else {
    device.serialNumber = undefined;
    device.serialLockedAt = null;
  }

  await device.save();
  return {
    transferred: false,
    serialNumber: device.serialNumber || '',
    message: cleanNewSn
      ? `Đã cập nhật khóa mã phần cứng mới (${cleanNewSn}) cho máy "${device.name}".`
      : `Đã gỡ khóa mã phần cứng trên máy "${device.name}". Lần đồng bộ tiếp theo hệ thống sẽ tự nhận mã phần cứng của máy mới.`
  };
}

/**
 * Kéo & lưu trực tiếp hồ sơ từ máy chấm công (`DeviceStoredPerson`: Ảnh khuôn mặt + Họ tên + Mã trên máy)
 * vào danh sách Nhân sự / Học sinh trên Web chỉ với 1 nút bấm.
 *
 * - Với người đã khớp trên Web: cập nhật Ảnh khuôn mặt và Họ tên từ máy về Web.
 * - Với người mới chỉ có trên máy chấm công: tự động tạo hồ sơ Nhân sự trên Web kèm đúng Họ tên, Mã chấm công,
 *   ánh xạ thiết bị và lưu luôn Ảnh khuôn mặt!
 */
async function importPulledUsersToWebRoster(
  tenantId,
  deviceId,
  {
    externalPersonIds = [],
    importAll = false,
    overwriteName = true,
    overwriteFace = true,
    actorId = null
  } = {}
) {
  if (!mongoose.isValidObjectId(deviceId)) {
    throw createServiceError('Mã máy chấm công không hợp lệ.', 'INVALID_DEVICE_ID', 400);
  }
  const device = await TimekeepingDevice.findOne({ _id: deviceId, tenantId });
  if (!device) {
    throw createServiceError('Không tìm thấy máy chấm công trong phân hiệu của bạn.', 'DEVICE_NOT_FOUND', 404);
  }

  const filter = { tenantId, deviceId: device._id };
  const cleanIds = (Array.isArray(externalPersonIds) ? externalPersonIds : [])
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  if (!importAll && cleanIds.length > 0) {
    filter.externalPersonId = { $in: cleanIds };
  }

  const storedDocs = await DeviceStoredPerson.find(filter).sort({ externalPersonId: 1 }).lean();
  if (storedDocs.length === 0) {
    throw createServiceError(
      'Chưa có dữ liệu hồ sơ nào đọc từ máy chấm công này. Bạn hãy bấm "Kéo Ảnh & Tên từ máy về Web" trước nhé.',
      'NO_STORED_DEVICE_USERS',
      400
    );
  }

  const [bioCtx, deviceMappings, existingEmpCodes] = await Promise.all([
    loadTenantBiometricContext(tenantId),
    AttendanceDevicePersonMapping.find({ tenantId, deviceId: device._id, active: true }).lean(),
    Employee.find({ tenantId }).select('employeeCode').lean()
  ]);

  const { matchDeviceUser } = buildRosterLookupMaps(bioCtx.unifiedRoster, deviceMappings);
  const usedEmpCodes = new Set(
    existingEmpCodes.map((e) => String(e.employeeCode || '').trim().toUpperCase()).filter(Boolean)
  );
  for (const item of bioCtx.unifiedRoster) {
    if (item.personCode) usedEmpCodes.add(item.personCode.toUpperCase());
  }

  const allocateEmployeeCode = (rawExtId) => {
    const cleaned = String(rawExtId || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '');
    let baseCode =
      /^[A-Z]/.test(cleaned) && cleaned.length >= 3
        ? cleaned.slice(0, 24)
        : `MCC-${String(cleaned || '001').padStart(3, '0')}`;
    let candidate = baseCode;
    let suffix = 1;
    while (usedEmpCodes.has(candidate)) {
      suffix += 1;
      candidate = `${baseCode}-${suffix}`;
    }
    usedEmpCodes.add(candidate);
    return candidate;
  };

  const targetCampus =
    device.campus && device.campus !== 'ALL' ? device.campus : bioCtx.campuses[0] || DEFAULT_CAMPUS_NAME;

  let importedNewCount = 0;
  let updatedExistingCount = 0;
  let savedFacesCount = 0;

  for (const sp of storedDocs) {
    const extId = String(sp.externalPersonId || '').trim();
    if (!extId) continue;
    const devName = String(sp.nameOnDevice || '').trim();
    const matched = matchDeviceUser(device, extId, devName);

    if (matched) {
      let touched = false;
      if (overwriteName && devName && devName !== extId && devName !== matched.fullName) {
        if (matched.subjectType === 'EMPLOYEE' && matched.employeeRecordId) {
          await Employee.updateOne(
            { _id: matched.employeeRecordId, tenantId },
            { $set: { fullName: devName } }
          );
          matched.fullName = devName;
          touched = true;
        } else if (matched.subjectType === 'STUDENT' && matched.subjectId) {
          await Student.updateOne(
            { _id: matched.subjectId, tenantId },
            { $set: { fullName: devName } }
          );
          matched.fullName = devName;
          touched = true;
        }
      }

      await ensureDevicePersonMapping(tenantId, device._id, matched, actorId, extId);

      if (sp.imageBase64 && (overwriteFace || !matched.hasBiometricFace)) {
        await BiometricFaceProfile.findOneAndUpdate(
          {
            tenantId,
            subjectType: matched.subjectType,
            subjectId: new mongoose.Types.ObjectId(matched.subjectId)
          },
          {
            $set: {
              linkedUserId: matched.userId ? new mongoose.Types.ObjectId(matched.userId) : null,
              personCode: matched.personCode,
              fullName: matched.fullName,
              campus: matched.campus || targetCampus,
              mimeType: sp.mimeType || 'image/jpeg',
              imageBase64: sp.imageBase64,
              sizeBytes: sp.sizeBytes || Buffer.from(sp.imageBase64, 'base64').length,
              source: 'PULLED_FROM_DEVICE',
              lastSyncedAt: new Date(),
              updatedBy: actorId || null
            },
            $addToSet: { syncedDeviceIds: device._id }
          },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );
        savedFacesCount += 1;
        touched = true;
      }
      if (touched) updatedExistingCount += 1;
    } else {
      const newEmpCode = allocateEmployeeCode(extId);
      const finalFullName = devName || `Nhân sự (${newEmpCode})`;

      const createdEmp = await Employee.create({
        tenantId,
        employeeCode: newEmpCode,
        fullName: finalFullName,
        campus: targetCampus,
        departmentName: 'Đồng bộ từ máy chấm công',
        position: 'teacher',
        payrollRole: 'teacher',
        status: 'active',
        salaryConfig: {
          baseSalary: 0,
          lowMonthlySalaryConfirmed: true,
          standardWorkDays: 26
        }
      });

      await AttendanceDevicePersonMapping.findOneAndUpdate(
        {
          tenantId,
          deviceId: device._id,
          externalPersonId: extId
        },
        {
          $set: {
            subjectType: 'EMPLOYEE',
            subjectId: createdEmp._id,
            active: true,
            metadata: {
              displayName: finalFullName,
              note: `Lấy trực tiếp từ máy ${device.name}`
            },
            ...(actorId ? { createdBy: actorId } : {})
          }
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      );

      if (sp.imageBase64) {
        await BiometricFaceProfile.findOneAndUpdate(
          {
            tenantId,
            subjectType: 'EMPLOYEE',
            subjectId: createdEmp._id
          },
          {
            $set: {
              linkedUserId: null,
              personCode: newEmpCode,
              fullName: finalFullName,
              campus: targetCampus,
              mimeType: sp.mimeType || 'image/jpeg',
              imageBase64: sp.imageBase64,
              sizeBytes: sp.sizeBytes || Buffer.from(sp.imageBase64, 'base64').length,
              source: 'PULLED_FROM_DEVICE',
              lastSyncedAt: new Date(),
              updatedBy: actorId || null
            },
            $addToSet: { syncedDeviceIds: device._id }
          },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );
        savedFacesCount += 1;
      }

      importedNewCount += 1;
    }
  }

  const message =
    importedNewCount > 0 && updatedExistingCount > 0
      ? `Đã lấy từ máy "${device.name}" về Web: thêm mới ${importedNewCount} hồ sơ, cập nhật ${updatedExistingCount} hồ sơ có sẵn và lưu ${savedFacesCount} ảnh khuôn mặt!`
      : importedNewCount > 0
        ? `Đã lấy thành công ${importedNewCount} hồ sơ (kèm Họ tên & ${savedFacesCount} ảnh khuôn mặt) từ máy "${device.name}" về danh sách của trường!`
        : `Đã cập nhật thành công Họ tên & ${savedFacesCount} ảnh khuôn mặt từ máy "${device.name}" về danh sách Web!`;

  return {
    deviceId: String(device._id),
    deviceName: device.name,
    importedNewCount,
    updatedExistingCount,
    savedFacesCount,
    message
  };
}

module.exports = {
  parseAndValidateFaceImagePayload,
  getBiometricOverview,
  saveBiometricFacePhoto,
  deleteBiometricFacePhoto,
  checkDeviceCapacityAndHealth,
  pullUsersAndFacesFromDevice,
  linkPulledDeviceUserToSubject,
  importPulledUsersToWebRoster,
  pullAllFromDevices,
  quickBidirectionalSync,
  syncSmartToDevices,
  pushSinglePersonToCampusDevices,
  pruneInactiveUsersOnDevice,
  unlockDoorOnDevice,
  scanLanDevicesForTenant,
  assertDeviceSerialCampusLock,
  enrichConnectorDiscoveredDevices,
  prepareConnectorDeviceTask,
  ingestConnectorPulledPayload,
  completeConnectorPushedPayload,
  configureDeviceWebhookEndpoint,
  unlockOrReassignDeviceSerialByVendor
};
