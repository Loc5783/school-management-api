'use strict';

/**
 * @fileoverview Tầng Dịch vụ Điều hành Trung tâm Đa Trường (`superAdminControlService`).
 *
 * Đảm nhận toàn bộ nghiệp vụ tổng hợp số liệu toàn hệ thống cho `SuperAdmin`:
 * 1. Dashboard Hiệu năng & Sức khỏe Hệ thống (CPU/RAM/Uptime/Độ trễ MongoDB/Phiên hoạt động).
 * 2. Thống kê đa chiều toàn bộ Trường học (Điểm danh hôm nay & 30 ngày, Tỷ lệ lấp đầy lớp,
 *    Thu – Chi – Công nợ học phí, Nhân sự đi làm, Cảnh báo an toàn bếp ăn 24h & Phản hồi phụ huynh).
 * 3. Báo cáo Chi tiết 360° cho từng trường cụ thể (`getSchoolDetailedReport`) không cần chuyển ngữ cảnh.
 * 4. Quản lý Cấu hình Chung Hệ thống (`SystemSetting`) có bộ nhớ đệm ngắn hạn (15 giây) để tối ưu hiệu năng.
 * 5. Truy xuất Nhật ký Kiểm toán Hệ thống (`PlatformAuditLog`) có phân trang.
 */

const os = require('os');
const mongoose = require('mongoose');
const Tenant = require('../models/zone1_system/Tenant');
const User = require('../models/zone1_system/User');
const PlatformAdmin = require('../models/zone1_system/PlatformAdmin');
const PlatformAuditLog = require('../models/zone1_system/PlatformAuditLog');
const SystemSetting = require('../models/zone1_system/SystemSetting');
const Classroom = require('../models/zone3_school/Classroom');
const Student = require('../models/zone3_school/Student');
const StudentAttendance = require('../models/zone3_school/StudentAttendance');
const ParentFeedback = require('../models/zone3_school/ParentFeedback');
const Employee = require('../models/zone2_hr/Employee');
const AttendanceRecord = require('../models/zone2_hr/AttendanceRecord');
const Payroll = require('../models/zone2_hr/Payroll');
const TuitionFee = require('../models/zone4_finance/TuitionFee');
const OperatingExpense = require('../models/zone4_finance/OperatingExpense');
const FoodSample = require('../models/zone5_nutrition/FoodSample');
const Menu = require('../models/zone5_nutrition/Menu');

const ALL_MODULE_DEFINITIONS = [
  { key: 'students', label: 'Hồ sơ & Y tế Học sinh', required: true },
  { key: 'classrooms', label: 'Quản lý Lớp & Phân hiệu', required: true },
  { key: 'attendance', label: 'Điểm danh & Đơn xin nghỉ', required: false },
  { key: 'pickups', label: 'Đón trả trẻ & Mã QR', required: false },
  { key: 'guard', label: 'An ninh Trực cổng & Bưu phẩm', required: false },
  { key: 'nutrition', label: 'Bếp ăn, Thực đơn & Lưu mẫu 24h', required: false },
  { key: 'finance', label: 'Học phí, Kế toán & Sổ quỹ', required: false },
  { key: 'hr', label: 'Nhân sự & Bảng lương', required: false },
  { key: 'timekeeping', label: 'Chấm công & Thiết bị ISAPI', required: false },
  { key: 'procurement', label: 'Mua sắm & Cơ sở vật chất', required: false },
  { key: 'feedback', label: 'Phản hồi Phụ huynh & Duyệt hồ sơ', required: false },
  { key: 'chat', label: 'Tin nhắn Nhà trường – Phụ huynh', required: false },
  { key: 'notifications', label: 'Thông báo Nội bộ & Nhắc việc', required: false },
  { key: 'reports', label: 'Báo cáo & Thống kê Điều hành', required: false }
];

const ALL_ENABLED_MODULES = ALL_MODULE_DEFINITIONS.map((m) => m.key);
const REQUIRED_CORE_MODULES = ALL_MODULE_DEFINITIONS.filter((m) => m.required).map((m) => m.key);

const SETTINGS_CACHE_TTL_MS = 15 * 1000;
const DASHBOARD_CACHE_TTL_MS = 5 * 1000;
let cachedSettings = null;
let cachedSettingsAt = 0;
let cachedDashboard = null;
let cachedDashboardAt = 0;

const DEFAULT_SYSTEM_SETTINGS = {
  key: 'GLOBAL_CONFIG',
  branding: {
    systemName: 'Hệ thống Giáo dục Mầm non Hoa Nắng',
    supportEmail: 'admin@hoanang.edu.vn',
    supportHotline: '1900 6868'
  },
  systemBanner: {
    enabled: false,
    level: 'info',
    message: ''
  },
  maintenanceMode: {
    enabled: false,
    message: 'Hệ thống đang bảo trì nâng cấp định kỳ. Vui lòng quay lại sau ít phút.'
  },
  preschoolStandards: {
    defaultSchoolYear: '2026-2027',
    standardCheckInTime: '07:00',
    standardCheckOutTime: '16:30',
    accountingCloseDay: 5,
    referenceCaloriesPerDay: 1250,
    foodSampleRetentionHours: 24,
    defaultMaxCampusesPerSchool: 10,
    defaultMaxStudentsPerSchool: 800
  },
  securityPolicy: {
    sessionTimeoutHours: 8,
    minPasswordLength: 6,
    antiBotShieldEnabled: true
  },
  updatedBy: 'system'
};

/**
 * Chuẩn hóa danh sách phân hệ kích hoạt của trường, luôn giữ các phân hệ lõi bắt buộc.
 *
 * @param {string[] | undefined} rawModules
 * @returns {string[]}
 */
const sanitizeEnabledModules = (rawModules) => {
  if (!Array.isArray(rawModules)) return [...ALL_ENABLED_MODULES];
  const validSet = new Set(ALL_ENABLED_MODULES);
  const selected = new Set(REQUIRED_CORE_MODULES);
  for (const item of rawModules) {
    const key = String(item || '').trim();
    if (validSet.has(key)) selected.add(key);
  }
  return ALL_ENABLED_MODULES.filter((k) => selected.has(k));
};

/**
 * Đọc cấu hình chung toàn hệ thống (có cache ngắn hạn 15s để không tăng tải DB trên mỗi request).
 *
 * @param {{ bypassCache?: boolean }} [options]
 * @returns {Promise<object>}
 */
const getSystemSettings = async ({ bypassCache = false } = {}) => {
  const now = Date.now();
  if (!bypassCache && cachedSettings && now - cachedSettingsAt < SETTINGS_CACHE_TTL_MS) {
    return cachedSettings;
  }

  if (mongoose.connection.readyState !== 1) {
    return { ...DEFAULT_SYSTEM_SETTINGS };
  }

  let doc = await SystemSetting.findOne({ key: 'GLOBAL_CONFIG' }).lean();
  if (!doc) {
    doc = { ...DEFAULT_SYSTEM_SETTINGS };
  } else {
    doc = {
      ...DEFAULT_SYSTEM_SETTINGS,
      ...doc,
      branding: { ...DEFAULT_SYSTEM_SETTINGS.branding, ...(doc.branding || {}) },
      systemBanner: { ...DEFAULT_SYSTEM_SETTINGS.systemBanner, ...(doc.systemBanner || {}) },
      maintenanceMode: { ...DEFAULT_SYSTEM_SETTINGS.maintenanceMode, ...(doc.maintenanceMode || {}) },
      preschoolStandards: { ...DEFAULT_SYSTEM_SETTINGS.preschoolStandards, ...(doc.preschoolStandards || {}) },
      securityPolicy: { ...DEFAULT_SYSTEM_SETTINGS.securityPolicy, ...(doc.securityPolicy || {}) }
    };
  }

  cachedSettings = doc;
  cachedSettingsAt = now;
  return doc;
};

const invalidateSystemSettingsCache = () => {
  cachedSettings = null;
  cachedSettingsAt = 0;
  cachedDashboard = null;
  cachedDashboardAt = 0;
};

const invalidatePlatformDashboardCache = () => {
  cachedDashboard = null;
  cachedDashboardAt = 0;
};

const isAntiBotShieldEnabledSync = () => {
  if (!cachedSettings) return true;
  return cachedSettings.securityPolicy?.antiBotShieldEnabled !== false;
};

/**
 * Cập nhật cấu hình chung toàn hệ thống do SuperAdmin thực hiện và ghi nhận AuditLog.
 *
 * @param {object} payload
 * @param {{ _id: any, username: string }} actor
 * @returns {Promise<object>}
 */
const updateSystemSettings = async (payload = {}, actor) => {
  const current = await getSystemSettings({ bypassCache: true });

  const branding = { ...current.branding };
  if (payload.branding && typeof payload.branding === 'object') {
    if (payload.branding.systemName != null) {
      const cleanName = String(payload.branding.systemName).trim();
      if (cleanName.length < 2 || cleanName.length > 160) {
        throw Object.assign(new Error('Tên hệ thống phải từ 2 đến 160 ký tự'), { statusCode: 422 });
      }
      branding.systemName = cleanName;
    }
    if (payload.branding.supportEmail != null) {
      const cleanEmail = String(payload.branding.supportEmail).trim().toLowerCase();
      if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        throw Object.assign(new Error('Email hỗ trợ không đúng định dạng'), { statusCode: 422 });
      }
      branding.supportEmail = cleanEmail;
    }
    if (payload.branding.supportHotline != null) {
      branding.supportHotline = String(payload.branding.supportHotline).trim().slice(0, 40);
    }
  }

  const systemBanner = { ...current.systemBanner };
  if (payload.systemBanner && typeof payload.systemBanner === 'object') {
    if (payload.systemBanner.enabled !== undefined) {
      systemBanner.enabled = Boolean(payload.systemBanner.enabled);
    }
    if (payload.systemBanner.level != null) {
      const lvl = String(payload.systemBanner.level).trim();
      if (!['info', 'warning', 'critical'].includes(lvl)) {
        throw Object.assign(new Error('Mức độ thông báo hệ thống không hợp lệ'), { statusCode: 422 });
      }
      systemBanner.level = lvl;
    }
    if (payload.systemBanner.message != null) {
      systemBanner.message = String(payload.systemBanner.message).trim().slice(0, 500);
    }
    if (systemBanner.enabled && !systemBanner.message) {
      throw Object.assign(new Error('Vui lòng nhập nội dung thông báo trước khi bật System Banner'), { statusCode: 422 });
    }
  }

  const maintenanceMode = { ...current.maintenanceMode };
  if (payload.maintenanceMode && typeof payload.maintenanceMode === 'object') {
    if (payload.maintenanceMode.enabled !== undefined) {
      maintenanceMode.enabled = Boolean(payload.maintenanceMode.enabled);
    }
    if (payload.maintenanceMode.message != null) {
      const msg = String(payload.maintenanceMode.message).trim().slice(0, 500);
      maintenanceMode.message = msg || DEFAULT_SYSTEM_SETTINGS.maintenanceMode.message;
    }
  }

  const preschoolStandards = { ...current.preschoolStandards };
  if (payload.preschoolStandards && typeof payload.preschoolStandards === 'object') {
    const ps = payload.preschoolStandards;
    if (ps.defaultSchoolYear != null) {
      const sy = String(ps.defaultSchoolYear).trim();
      if (!/^\d{4}-\d{4}$/.test(sy)) {
        throw Object.assign(new Error('Năm học chuẩn phải theo định dạng YYYY-YYYY (VD: 2026-2027)'), { statusCode: 422 });
      }
      preschoolStandards.defaultSchoolYear = sy;
    }
    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (ps.standardCheckInTime != null) {
      const t = String(ps.standardCheckInTime).trim();
      if (!timeRegex.test(t)) throw Object.assign(new Error('Giờ đón chuẩn không hợp lệ (HH:MM)'), { statusCode: 422 });
      preschoolStandards.standardCheckInTime = t;
    }
    if (ps.standardCheckOutTime != null) {
      const t = String(ps.standardCheckOutTime).trim();
      if (!timeRegex.test(t)) throw Object.assign(new Error('Giờ trả chuẩn không hợp lệ (HH:MM)'), { statusCode: 422 });
      preschoolStandards.standardCheckOutTime = t;
    }
    if (ps.accountingCloseDay != null) {
      const day = Number(ps.accountingCloseDay);
      if (!Number.isInteger(day) || day < 1 || day > 28) {
        throw Object.assign(new Error('Ngày khóa sổ kế toán hàng tháng phải từ 1 đến 28'), { statusCode: 422 });
      }
      preschoolStandards.accountingCloseDay = day;
    }
    if (ps.referenceCaloriesPerDay != null) {
      const cal = Number(ps.referenceCaloriesPerDay);
      if (!Number.isFinite(cal) || cal < 600 || cal > 2500) {
        throw Object.assign(new Error('Định mức năng lượng tham chiếu phải từ 600 đến 2500 Kcal/ngày'), { statusCode: 422 });
      }
      preschoolStandards.referenceCaloriesPerDay = Math.round(cal);
    }
    if (ps.foodSampleRetentionHours != null) {
      const hrs = Number(ps.foodSampleRetentionHours);
      if (!Number.isInteger(hrs) || hrs < 24 || hrs > 72) {
        throw Object.assign(new Error('Thời gian lưu mẫu thức ăn tối thiểu phải từ 24 đến 72 giờ (quy định ATTP >= 24h)'), { statusCode: 422 });
      }
      preschoolStandards.foodSampleRetentionHours = hrs;
    }
    if (ps.defaultMaxCampusesPerSchool != null) {
      const mc = Number(ps.defaultMaxCampusesPerSchool);
      if (!Number.isInteger(mc) || mc < 1 || mc > 100) {
        throw Object.assign(new Error('Hạn mức phân hiệu mặc định phải từ 1 đến 100'), { statusCode: 422 });
      }
      preschoolStandards.defaultMaxCampusesPerSchool = mc;
    }
    if (ps.defaultMaxStudentsPerSchool != null) {
      const ms = Number(ps.defaultMaxStudentsPerSchool);
      if (!Number.isInteger(ms) || ms < 10 || ms > 20000) {
        throw Object.assign(new Error('Hạn mức học sinh mặc định phải từ 10 đến 20.000'), { statusCode: 422 });
      }
      preschoolStandards.defaultMaxStudentsPerSchool = ms;
    }
  }

  const securityPolicy = { ...current.securityPolicy };
  if (payload.securityPolicy && typeof payload.securityPolicy === 'object') {
    const sp = payload.securityPolicy;
    if (sp.sessionTimeoutHours != null) {
      const hrs = Number(sp.sessionTimeoutHours);
      if (!Number.isInteger(hrs) || hrs < 1 || hrs > 72) {
        throw Object.assign(new Error('Thời hạn phiên đăng nhập phải từ 1 đến 72 giờ'), { statusCode: 422 });
      }
      securityPolicy.sessionTimeoutHours = hrs;
    }
    if (sp.minPasswordLength != null) {
      const len = Number(sp.minPasswordLength);
      if (!Number.isInteger(len) || len < 6 || len > 32) {
        throw Object.assign(new Error('Độ dài mật khẩu tối thiểu phải từ 6 đến 32 ký tự'), { statusCode: 422 });
      }
      securityPolicy.minPasswordLength = len;
    }
    if (sp.antiBotShieldEnabled !== undefined) {
      securityPolicy.antiBotShieldEnabled = Boolean(sp.antiBotShieldEnabled);
    }
  }

  const updated = await SystemSetting.findOneAndUpdate(
    { key: 'GLOBAL_CONFIG' },
    {
      $set: {
        branding,
        systemBanner,
        maintenanceMode,
        preschoolStandards,
        securityPolicy,
        updatedBy: actor?.username || 'superadmin'
      }
    },
    { upsert: true, returnDocument: 'after' }
  ).lean();

  invalidateSystemSettingsCache();

  if (actor?._id) {
    await PlatformAuditLog.create({
      actorId: actor._id,
      actorUsername: actor.username || 'superadmin',
      action: 'UPDATE_GLOBAL_SYSTEM_SETTINGS',
      targetType: 'system_setting',
      targetId: 'GLOBAL_CONFIG',
      details: {
        bannerEnabled: systemBanner.enabled,
        maintenanceEnabled: maintenanceMode.enabled,
        defaultSchoolYear: preschoolStandards.defaultSchoolYear,
        antiBotShieldEnabled: securityPolicy.antiBotShieldEnabled
      }
    });
  }

  return updated;
};

/**
 * Đo thông số sức khỏe máy chủ & độ trễ kết nối MongoDB thời gian thực.
 *
 * @returns {Promise<object>}
 */
const measureSystemHealth = async () => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = Math.max(0, totalMem - freeMem);
  const procMem = process.memoryUsage();

  let dbPingMs = null;
  let dbConnected = mongoose.connection.readyState === 1;
  if (dbConnected && mongoose.connection.db) {
    const startNs = process.hrtime.bigint();
    try {
      await mongoose.connection.db.admin().ping();
      dbPingMs = Number(process.hrtime.bigint() - startNs) / 1e6;
      dbPingMs = Math.round(dbPingMs * 100) / 100;
    } catch {
      dbConnected = false;
    }
  }

  return {
    status: dbConnected ? 'healthy' : 'degraded',
    uptimeSeconds: Math.floor(process.uptime()),
    serverUptimeSeconds: Math.floor(os.uptime()),
    nodeVersion: process.version,
    platform: `${os.type()} ${os.arch()}`,
    cpuCores: os.cpus()?.length || 1,
    loadAverage1m: Number((os.loadavg?.()[0] || 0).toFixed(2)),
    memory: {
      systemTotalMb: Math.round(totalMem / (1024 * 1024)),
      systemUsedMb: Math.round(usedMem / (1024 * 1024)),
      systemUsedPercent: totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0,
      processRssMb: Math.round(procMem.rss / (1024 * 1024)),
      heapUsedMb: Math.round(procMem.heapUsed / (1024 * 1024)),
      heapTotalMb: Math.round(procMem.heapTotal / (1024 * 1024))
    },
    database: {
      connected: dbConnected,
      pingMs: dbPingMs,
      name: mongoose.connection?.name || 'school_management'
    },
    checkedAt: new Date().toISOString()
  };
};

const getVietnamDateBounds = () => {
  const now = new Date();
  const vnTime = new Date(now.getTime() + 7 * 3600 * 1000);
  const yyyy = vnTime.getUTCFullYear();
  const mm = String(vnTime.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(vnTime.getUTCDate()).padStart(2, '0');
  const todayKey = `${yyyy}-${mm}-${dd}`;

  const startOfToday = new Date(`${todayKey}T00:00:00.000+07:00`);
  const endOfToday = new Date(`${todayKey}T23:59:59.999+07:00`);
  const thirtyDaysAgo = new Date(startOfToday.getTime() - 30 * 24 * 3600 * 1000);
  const sevenDaysAgo = new Date(startOfToday.getTime() - 6 * 24 * 3600 * 1000);
  const dayOfWeek = vnTime.getUTCDay(); // 0: CN, 6: T7

  return { todayKey, startOfToday, endOfToday, thirtyDaysAgo, sevenDaysAgo, isWeekend: dayOfWeek === 0 || dayOfWeek === 6 };
};

/**
 * Tổng hợp Dashboard điều hành toàn diện & danh sách các trường (không N+1, dùng Promise.all + aggregate).
 *
 * @returns {Promise<object>}
 */
const getPlatformDashboardAndSchools = async ({ bypassCache = false } = {}) => {
  const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
  if (!isTestEnv && !bypassCache && cachedDashboard && Date.now() - cachedDashboardAt < DASHBOARD_CACHE_TTL_MS) {
    return cachedDashboard;
  }

  const { todayKey, startOfToday, endOfToday, thirtyDaysAgo, isWeekend } = getVietnamDateBounds();

  const [
    settings,
    systemHealth,
    tenants,
    classStats,
    studentStats,
    staffStats,
    userActivityStats,
    schoolAdmins,
    todayStudentAtt,
    monthStudentAtt,
    todayStaffAtt,
    financeStats,
    expenseStats,
    payrollStats,
    foodSampleStats,
    feedbackStats,
    superAdminCount
  ] = await Promise.all([
    getSystemSettings(),
    measureSystemHealth(),
    Tenant.find({}).sort({ createdAt: 1 }).lean(),
    Classroom.aggregate([
      { $match: { status: 'active', tenantId: { $ne: null } } },
      {
        $group: {
          _id: '$tenantId',
          classCount: { $sum: 1 },
          totalCapacity: { $sum: { $ifNull: ['$capacity', 30] } },
          distinctCampuses: { $addToSet: { $ifNull: ['$campus', 'Cơ sở chính'] } }
        }
      }
    ]),
    Student.aggregate([
      { $match: { tenantId: { $ne: null } } },
      {
        $group: {
          _id: '$tenantId',
          enrolledCount: {
            $sum: { $cond: [{ $in: ['$status', ['enrolled', 'temporarily_absent']] }, 1, 0] }
          },
          strictlyEnrolledCount: {
            $sum: { $cond: [{ $eq: ['$status', 'enrolled'] }, 1, 0] }
          },
          withdrawnCount: {
            $sum: { $cond: [{ $eq: ['$status', 'withdrawn'] }, 1, 0] }
          }
        }
      }
    ]),
    Employee.aggregate([
      { $match: { tenantId: { $ne: null } } },
      {
        $group: {
          _id: '$tenantId',
          activeStaffCount: {
            $sum: { $cond: [{ $in: ['$status', ['active', 'on_leave']] }, 1, 0] }
          },
          resignedStaffCount: {
            $sum: { $cond: [{ $eq: ['$status', 'resigned'] }, 1, 0] }
          }
        }
      }
    ]),
    User.aggregate([
      { $match: { tenantId: { $ne: null } } },
      {
        $group: {
          _id: '$tenantId',
          totalAccounts: { $sum: 1 },
          activeAccounts: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          parentAccounts: { $sum: { $cond: [{ $eq: ['$role', 'parent'] }, 1, 0] } },
          lastActivityAt: { $max: '$lastLogin' }
        }
      }
    ]),
    User.find({ role: 'admin', tenantId: { $ne: null } })
      .select('username status profile tenantId lastLogin')
      .sort({ createdAt: 1 })
      .lean(),
    StudentAttendance.aggregate([
      {
        $match: {
          tenantId: { $ne: null },
          $or: [
            { attendanceDateKey: todayKey },
            { attendDate: { $gte: startOfToday, $lte: endOfToday } }
          ]
        }
      },
      {
        $group: {
          _id: '$tenantId',
          totalRecorded: { $sum: 1 },
          presentCount: {
            $sum: { $cond: [{ $in: ['$status', ['present', 'late']] }, 1, 0] }
          },
          absentCount: {
            $sum: { $cond: [{ $in: ['$status', ['absent', 'absent_permission']] }, 1, 0] }
          }
        }
      }
    ]),
    StudentAttendance.aggregate([
      {
        $match: {
          tenantId: { $ne: null },
          attendDate: { $gte: thirtyDaysAgo, $lte: endOfToday }
        }
      },
      {
        $group: {
          _id: '$tenantId',
          totalRecords30d: { $sum: 1 },
          presentRecords30d: {
            $sum: { $cond: [{ $in: ['$status', ['present', 'late']] }, 1, 0] }
          }
        }
      }
    ]),
    AttendanceRecord.aggregate([
      {
        $match: {
          tenantId: { $ne: null },
          workDate: { $gte: startOfToday, $lte: endOfToday }
        }
      },
      {
        $group: {
          _id: '$tenantId',
          staffPresentToday: {
            $sum: { $cond: [{ $in: ['$status', ['present', 'late', 'half_day']] }, 1, 0] }
          }
        }
      }
    ]),
    TuitionFee.aggregate([
      { $match: { tenantId: { $ne: null }, status: { $ne: 'cancelled' } } },
      {
        $group: {
          _id: '$tenantId',
          totalBilled: { $sum: { $ifNull: ['$totalAmount', 0] } },
          totalCollected: { $sum: { $ifNull: ['$paidAmount', 0] } },
          invoiceCount: { $sum: 1 },
          paidInvoiceCount: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] } },
          unpaidInvoiceCount: { $sum: { $cond: [{ $in: ['$status', ['unpaid', 'partial']] }, 1, 0] } }
        }
      }
    ]),
    OperatingExpense.aggregate([
      { $match: { tenantId: { $ne: null } } },
      { $group: { _id: '$tenantId', totalOperatingExpense: { $sum: { $ifNull: ['$amount', 0] } } } }
    ]),
    Payroll.aggregate([
      { $match: { tenantId: { $ne: null } } },
      { $group: { _id: '$tenantId', totalPayroll: { $sum: { $ifNull: ['$netSalary', 0] } } } }
    ]),
    FoodSample.aggregate([
      { $match: { tenantId: { $ne: null } } },
      {
        $group: {
          _id: '$tenantId',
          alertSampleCount: {
            $sum: { $cond: [{ $in: ['$status', ['sent_to_lab', 'investigating']] }, 1, 0] }
          },
          todaySampleCount: {
            $sum: {
              $cond: [
                { $and: [{ $gte: ['$mealDate', startOfToday] }, { $lte: ['$mealDate', endOfToday] }] },
                1,
                0
              ]
            }
          }
        }
      }
    ]),
    ParentFeedback.aggregate([
      { $match: { tenantId: { $ne: null }, status: { $in: ['pending', 'in_progress'] } } },
      { $group: { _id: '$tenantId', openFeedbackCount: { $sum: 1 } } }
    ]),
    PlatformAdmin.countDocuments({ status: 'active' })
  ]);

  const classMap = new Map(classStats.map((x) => [String(x._id), x]));
  const studentMap = new Map(studentStats.map((x) => [String(x._id), x]));
  const staffMap = new Map(staffStats.map((x) => [String(x._id), x]));
  const userActMap = new Map(userActivityStats.map((x) => [String(x._id), x]));
  const todayAttMap = new Map(todayStudentAtt.map((x) => [String(x._id), x]));
  const monthAttMap = new Map(monthStudentAtt.map((x) => [String(x._id), x]));
  const todayStaffMap = new Map(todayStaffAtt.map((x) => [String(x._id), x]));
  const financeMap = new Map(financeStats.map((x) => [String(x._id), x]));
  const expenseMap = new Map(expenseStats.map((x) => [String(x._id), x.totalOperatingExpense]));
  const payrollMap = new Map(payrollStats.map((x) => [String(x._id), x.totalPayroll]));
  const sampleMap = new Map(foodSampleStats.map((x) => [String(x._id), x]));
  const feedbackMap = new Map(feedbackStats.map((x) => [String(x._id), x.openFeedbackCount]));

  const adminsByTenant = new Map();
  for (const adm of schoolAdmins) {
    const tid = String(adm.tenantId);
    if (!adminsByTenant.has(tid)) adminsByTenant.set(tid, []);
    adminsByTenant.get(tid).push({
      _id: adm._id,
      username: adm.username,
      fullName: adm.profile?.fullName || adm.username,
      email: adm.profile?.email || '',
      phone: adm.profile?.phone || '',
      status: adm.status,
      lastLogin: adm.lastLogin || null
    });
  }

  const alerts = [];

  const schools = tenants.map((t) => {
    const tid = String(t._id);
    const cls = classMap.get(tid) || { classCount: 0, totalCapacity: 0, distinctCampuses: [] };
    const stu = studentMap.get(tid) || { enrolledCount: 0, strictlyEnrolledCount: 0, withdrawnCount: 0 };
    const stf = staffMap.get(tid) || { activeStaffCount: 0, resignedStaffCount: 0 };
    const uAct = userActMap.get(tid) || { totalAccounts: 0, activeAccounts: 0, parentAccounts: 0, lastActivityAt: null };
    const attToday = todayAttMap.get(tid) || { totalRecorded: 0, presentCount: 0, absentCount: 0 };
    const att30d = monthAttMap.get(tid) || { totalRecords30d: 0, presentRecords30d: 0 };
    const staffToday = todayStaffMap.get(tid) || { staffPresentToday: 0 };
    const fin = financeMap.get(tid) || {
      totalBilled: 0,
      totalCollected: 0,
      invoiceCount: 0,
      paidInvoiceCount: 0,
      unpaidInvoiceCount: 0
    };
    const opExp = expenseMap.get(tid) || 0;
    const payExp = payrollMap.get(tid) || 0;
    const smp = sampleMap.get(tid) || { alertSampleCount: 0, todaySampleCount: 0 };
    const openFeedbackCount = feedbackMap.get(tid) || 0;

    const declaredCampuses = Array.isArray(t.campuses) && t.campuses.length > 0
      ? t.campuses.map((c) => c.name).filter(Boolean)
      : ['Cơ sở chính'];
    const mergedCampusNames = [...new Set([...declaredCampuses, ...(cls.distinctCampuses || []).filter(Boolean)])];
    const admins = adminsByTenant.get(tid) || [];

    const enabledModules = t.config?.moduleGateConfigured
      ? sanitizeEnabledModules(t.enabledModules)
      : [...ALL_ENABLED_MODULES];

    const quotas = {
      maxCampuses: t.quotas?.maxCampuses || settings.preschoolStandards.defaultMaxCampusesPerSchool || 10,
      maxStudents: t.quotas?.maxStudents || settings.preschoolStandards.defaultMaxStudentsPerSchool || 800,
      maxStaff: t.quotas?.maxStaff || 200
    };

    const occupancyPercent = cls.totalCapacity > 0
      ? Math.min(100, Math.round((stu.enrolledCount / cls.totalCapacity) * 100))
      : 0;
    const attendanceTodayPercent = stu.strictlyEnrolledCount > 0 && attToday.totalRecorded > 0
      ? Math.round((attToday.presentCount / stu.strictlyEnrolledCount) * 100)
      : (attToday.totalRecorded > 0 ? Math.round((attToday.presentCount / attToday.totalRecorded) * 100) : 0);
    const attendance30dPercent = att30d.totalRecords30d > 0
      ? Math.round((att30d.presentRecords30d / att30d.totalRecords30d) * 100)
      : 0;
    const collectionRatePercent = fin.totalBilled > 0
      ? Math.min(100, Math.round((fin.totalCollected / fin.totalBilled) * 100))
      : 0;
    const outstandingDebt = Math.max(0, fin.totalBilled - fin.totalCollected);

    if (t.status === 'active') {
      if (!isWeekend && stu.strictlyEnrolledCount > 0 && attToday.totalRecorded === 0) {
        alerts.push({
          severity: 'warning',
          category: 'attendance',
          schoolId: t._id,
          schoolCode: t.code,
          schoolName: t.name,
          title: 'Chưa ghi nhận điểm danh học sinh hôm nay',
          detail: `Trường có ${stu.strictlyEnrolledCount} học sinh đang học nhưng chưa phát sinh bản ghi điểm danh ngày ${todayKey}.`
        });
      }
      if (smp.alertSampleCount > 0) {
        alerts.push({
          severity: 'critical',
          category: 'food_safety',
          schoolId: t._id,
          schoolCode: t.code,
          schoolName: t.name,
          title: 'Cảnh báo mẫu lưu thức ăn đang kiểm tra / gửi xét nghiệm',
          detail: `Đang có ${smp.alertSampleCount} mẫu lưu thức ăn ở trạng thái kiểm tra sự cố ATTP.`
        });
      }
      if (openFeedbackCount > 0) {
        alerts.push({
          severity: 'info',
          category: 'feedback',
          schoolId: t._id,
          schoolCode: t.code,
          schoolName: t.name,
          title: 'Phản hồi phụ huynh chờ xử lý',
          detail: `Có ${openFeedbackCount} ý kiến / kiến nghị từ phụ huynh đang chờ nhà trường phản hồi.`
        });
      }
      if (stu.enrolledCount >= Math.round(quotas.maxStudents * 0.9)) {
        alerts.push({
          severity: 'warning',
          category: 'quota',
          schoolId: t._id,
          schoolCode: t.code,
          schoolName: t.name,
          title: 'Sắp chạm hạn mức học sinh của trường',
          detail: `Đang có ${stu.enrolledCount}/${quotas.maxStudents} học sinh (${Math.round((stu.enrolledCount / quotas.maxStudents) * 100)}% hạn mức).`
        });
      }
    }

    return {
      _id: t._id,
      code: t.code,
      name: t.name,
      organizationCode: t.organizationCode || '',
      contactEmail: t.contactEmail || '',
      status: t.status,
      enabledModules,
      moduleGateConfigured: Boolean(t.config?.moduleGateConfigured),
      quotas,
      campuses: Array.isArray(t.campuses) && t.campuses.length > 0
        ? t.campuses
        : [{ code: 'CS-CHINH', name: 'Cơ sở chính', address: '', phone: '', managerName: '', openTime: '07:00', closeTime: '17:00', isActive: true }],
      campusNames: mergedCampusNames,
      campusCount: mergedCampusNames.length,
      classCount: cls.classCount,
      totalCapacity: cls.totalCapacity,
      occupancyPercent,
      studentCount: stu.enrolledCount,
      withdrawnStudentCount: stu.withdrawnCount,
      staffCount: stf.activeStaffCount,
      staffPresentToday: staffToday.staffPresentToday,
      accountStats: {
        totalAccounts: uAct.totalAccounts,
        activeAccounts: uAct.activeAccounts,
        parentAccounts: uAct.parentAccounts,
        lastActivityAt: uAct.lastActivityAt
      },
      attendance: {
        todayRecorded: attToday.totalRecorded,
        todayPresent: attToday.presentCount,
        todayAbsent: attToday.absentCount,
        todayPercent: attendanceTodayPercent,
        rolling30dPercent: attendance30dPercent
      },
      finance: {
        totalBilled: fin.totalBilled,
        totalCollected: fin.totalCollected,
        outstandingDebt,
        collectionRatePercent,
        invoiceCount: fin.invoiceCount,
        unpaidInvoiceCount: fin.unpaidInvoiceCount,
        totalOperatingExpense: opExp,
        totalPayroll: payExp,
        totalExpenditure: opExp + payExp
      },
      safety: {
        foodSampleAlerts: smp.alertSampleCount,
        todayFoodSamples: smp.todaySampleCount,
        openParentFeedback: openFeedbackCount
      },
      primaryAdmin: admins[0] || null,
      adminAccounts: admins,
      createdAt: t.createdAt
    };
  });

  const summary = schools.reduce(
    (acc, item) => {
      acc.totalSchools += 1;
      if (item.status === 'active') acc.activeSchools += 1;
      else if (item.status === 'suspended') acc.suspendedSchools += 1;
      acc.totalCampuses += item.campusCount;
      acc.totalClassrooms += item.classCount;
      acc.totalCapacity += item.totalCapacity;
      acc.totalStudents += item.studentCount;
      acc.totalStaff += item.staffCount;
      acc.totalStaffPresentToday += item.staffPresentToday;
      acc.totalActiveAccounts += item.accountStats.activeAccounts;
      acc.todayStudentRecorded += item.attendance.todayRecorded;
      acc.todayStudentPresent += item.attendance.todayPresent;
      acc.totalBilled += item.finance.totalBilled;
      acc.totalCollected += item.finance.totalCollected;
      acc.totalOutstandingDebt += item.finance.outstandingDebt;
      acc.totalExpenditure += item.finance.totalExpenditure;
      acc.totalOpenFeedback += item.safety.openParentFeedback;
      acc.totalFoodSampleAlerts += item.safety.foodSampleAlerts;
      return acc;
    },
    {
      totalSchools: 0,
      activeSchools: 0,
      suspendedSchools: 0,
      totalCampuses: 0,
      totalClassrooms: 0,
      totalCapacity: 0,
      totalStudents: 0,
      totalStaff: 0,
      totalStaffPresentToday: 0,
      totalActiveAccounts: 0,
      superAdminCount,
      todayStudentRecorded: 0,
      todayStudentPresent: 0,
      totalBilled: 0,
      totalCollected: 0,
      totalOutstandingDebt: 0,
      totalExpenditure: 0,
      totalOpenFeedback: 0,
      totalFoodSampleAlerts: 0
    }
  );

  summary.overallOccupancyPercent = summary.totalCapacity > 0
    ? Math.min(100, Math.round((summary.totalStudents / summary.totalCapacity) * 100))
    : 0;
  summary.overallAttendanceTodayPercent = summary.todayStudentRecorded > 0
    ? Math.round((summary.todayStudentPresent / summary.todayStudentRecorded) * 100)
    : 0;
  summary.overallCollectionRatePercent = summary.totalBilled > 0
    ? Math.min(100, Math.round((summary.totalCollected / summary.totalBilled) * 100))
    : 0;
  summary.alertCount = alerts.length;

  const dashboardPayload = {
    summary,
    systemHealth: {
      ...systemHealth,
      antiBotShieldEnabled: settings.securityPolicy.antiBotShieldEnabled,
      maintenanceModeEnabled: settings.maintenanceMode.enabled
    },
    alerts,
    moduleCatalog: ALL_MODULE_DEFINITIONS,
    settings,
    schools
  };

  if (!isTestEnv) {
    cachedDashboard = dashboardPayload;
    cachedDashboardAt = Date.now();
  }

  return dashboardPayload;
};

/**
 * Truy xuất Báo cáo Chi tiết 360° của một trường cụ thể phục vụ SuperAdmin kiểm tra từ xa.
 *
 * @param {string} tenantId
 * @returns {Promise<object>}
 */
const getSchoolDetailedReport = async (tenantId) => {
  if (!mongoose.Types.ObjectId.isValid(tenantId)) {
    throw Object.assign(new Error('ID trường học không hợp lệ'), { statusCode: 400 });
  }

  const tenant = await Tenant.findById(tenantId).lean();
  if (!tenant) {
    throw Object.assign(new Error('Không tìm thấy trường học cần xem báo cáo'), { statusCode: 404 });
  }

  const tid = tenant._id;
  const { todayKey, startOfToday, endOfToday, sevenDaysAgo } = getVietnamDateBounds();
  const settings = await getSystemSettings();

  const [
    classrooms,
    studentsByClass,
    studentsStatusBreakdown,
    staffRoleBreakdown,
    userRoleBreakdown,
    adminUsers,
    attendanceLast7Days,
    financeByPeriod,
    operatingExpenseTotal,
    payrollByPeriod,
    recentFoodSamples,
    recentMenus,
    openFeedbacks,
    recentPlatformLogs
  ] = await Promise.all([
    Classroom.find({ tenantId: tid, status: 'active' })
      .select('name ageGroup schoolYear capacity campus homeroomTeacherId')
      .populate('homeroomTeacherId', 'username profile.fullName')
      .sort({ campus: 1, name: 1 })
      .lean(),
    Student.aggregate([
      { $match: { tenantId: tid, status: { $in: ['enrolled', 'temporarily_absent'] } } },
      {
        $group: {
          _id: '$classroomId',
          studentCount: { $sum: 1 },
          allergyCount: {
            $sum: {
              $cond: [
                {
                  $gt: [
                    { $size: { $cond: [{ $isArray: '$healthInfo.allergies' }, '$healthInfo.allergies', []] } },
                    0
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      }
    ]),
    Student.aggregate([
      { $match: { tenantId: tid } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    Employee.aggregate([
      { $match: { tenantId: tid } },
      {
        $group: {
          _id: { position: '$position', status: '$status' },
          count: { $sum: 1 }
        }
      }
    ]),
    User.aggregate([
      { $match: { tenantId: tid } },
      {
        $group: {
          _id: '$role',
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          lastLogin: { $max: '$lastLogin' }
        }
      }
    ]),
    User.find({ tenantId: tid, role: { $in: ['admin', 'principal'] } })
      .select('username role status profile lastLogin createdAt')
      .sort({ role: 1, createdAt: 1 })
      .lean(),
    StudentAttendance.aggregate([
      {
        $match: {
          tenantId: tid,
          attendDate: { $gte: sevenDaysAgo, $lte: endOfToday }
        }
      },
      {
        $group: {
          _id: {
            $ifNull: [
              '$attendanceDateKey',
              { $dateToString: { format: '%Y-%m-%d', date: '$attendDate', timezone: '+07:00' } }
            ]
          },
          present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
          late: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
          absentPermission: { $sum: { $cond: [{ $eq: ['$status', 'absent_permission'] }, 1, 0] } },
          absentUnexcused: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
          total: { $sum: 1 }
        }
      },
      { $sort: { _id: -1 } },
      { $limit: 7 }
    ]),
    TuitionFee.aggregate([
      { $match: { tenantId: tid, status: { $ne: 'cancelled' } } },
      {
        $group: {
          _id: '$period',
          invoiceCount: { $sum: 1 },
          totalBilled: { $sum: { $ifNull: ['$totalAmount', 0] } },
          totalCollected: { $sum: { $ifNull: ['$paidAmount', 0] } },
          paidCount: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] } },
          partialCount: { $sum: { $cond: [{ $eq: ['$status', 'partial'] }, 1, 0] } },
          unpaidCount: { $sum: { $cond: [{ $eq: ['$status', 'unpaid'] }, 1, 0] } }
        }
      },
      { $sort: { _id: -1 } },
      { $limit: 6 }
    ]),
    OperatingExpense.aggregate([
      { $match: { tenantId: tid } },
      {
        $group: {
          _id: '$category',
          totalAmount: { $sum: { $ifNull: ['$amount', 0] } },
          count: { $sum: 1 }
        }
      }
    ]),
    Payroll.aggregate([
      { $match: { tenantId: tid } },
      {
        $group: {
          _id: { year: '$year', month: '$month' },
          staffCount: { $sum: 1 },
          totalNetSalary: { $sum: { $ifNull: ['$netSalary', 0] } }
        }
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: 6 }
    ]),
    FoodSample.find({ tenantId: tid })
      .select('sampleCode mealDate mealType dishName status storageTemperature storedByName')
      .sort({ mealDate: -1, createdAt: -1 })
      .limit(8)
      .lean(),
    Menu.find({ tenantId: tid })
      .select('className schoolYear weekNumber startDate endDate status')
      .sort({ startDate: -1 })
      .limit(5)
      .lean(),
    ParentFeedback.find({ tenantId: tid })
      .select('studentName className parentName category subject status createdAt')
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(),
    PlatformAuditLog.find({ targetId: String(tid) })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean()
  ]);

  const classStudentMap = new Map(studentsByClass.map((s) => [String(s._id), s]));
  const classroomReport = classrooms.map((cls) => {
    const stat = classStudentMap.get(String(cls._id)) || { studentCount: 0, allergyCount: 0 };
    const cap = cls.capacity || 30;
    return {
      _id: cls._id,
      name: cls.name,
      ageGroup: cls.ageGroup || '—',
      schoolYear: cls.schoolYear || settings.preschoolStandards.defaultSchoolYear,
      campus: cls.campus || 'Cơ sở chính',
      homeroomTeacher: cls.homeroomTeacherId?.profile?.fullName || cls.homeroomTeacherId?.username || 'Chưa phân công',
      studentCount: stat.studentCount,
      allergyCount: stat.allergyCount,
      capacity: cap,
      occupancyPercent: cap > 0 ? Math.min(100, Math.round((stat.studentCount / cap) * 100)) : 0
    };
  });

  // Tổng hợp theo từng Phân hiệu của trường
  const declaredCampuses = Array.isArray(tenant.campuses) && tenant.campuses.length > 0
    ? [...tenant.campuses]
    : [{ code: 'CS-CHINH', name: 'Cơ sở chính', address: '', phone: '', managerName: '', openTime: '07:00', closeTime: '17:00', isActive: true }];

  const campusStatsMap = new Map();
  for (const cls of classroomReport) {
    const key = String(cls.campus || 'Cơ sở chính').trim().toLowerCase();
    const prev = campusStatsMap.get(key) || { name: cls.campus || 'Cơ sở chính', classCount: 0, studentCount: 0, capacity: 0 };
    prev.classCount += 1;
    prev.studentCount += cls.studentCount;
    prev.capacity += cls.capacity;
    campusStatsMap.set(key, prev);
  }

  for (const [key, stat] of campusStatsMap.entries()) {
    if (!declaredCampuses.some((c) => String(c.name || '').trim().toLowerCase() === key)) {
      declaredCampuses.push({
        code: 'PH-AUTO',
        name: stat.name,
        address: '',
        phone: '',
        managerName: '',
        openTime: '07:00',
        closeTime: '17:00',
        isActive: true
      });
    }
  }

  const campusReport = declaredCampuses.map((c) => {
    const key = String(c.name || '').trim().toLowerCase();
    const stat = campusStatsMap.get(key) || { classCount: 0, studentCount: 0, capacity: 0 };
    return {
      code: c.code || 'CS',
      name: c.name,
      address: c.address || '',
      phone: c.phone || '',
      managerName: c.managerName || '',
      openTime: c.openTime || '07:00',
      closeTime: c.closeTime || '17:00',
      maxClassrooms: c.maxClassrooms || 20,
      isActive: c.isActive !== false,
      classCount: stat.classCount,
      studentCount: stat.studentCount,
      capacity: stat.capacity,
      occupancyPercent: stat.capacity > 0 ? Math.min(100, Math.round((stat.studentCount / stat.capacity) * 100)) : 0
    };
  });

  const studentSummary = { enrolled: 0, temporarily_absent: 0, withdrawn: 0, graduated: 0 };
  for (const s of studentsStatusBreakdown) {
    if (s._id && studentSummary[s._id] !== undefined) {
      studentSummary[s._id] = s.count;
    }
  }

  const financeSummary = financeByPeriod.reduce(
    (acc, p) => {
      acc.totalBilled += p.totalBilled || 0;
      acc.totalCollected += p.totalCollected || 0;
      acc.invoiceCount += p.invoiceCount || 0;
      return acc;
    },
    { totalBilled: 0, totalCollected: 0, invoiceCount: 0 }
  );
  financeSummary.outstandingDebt = Math.max(0, financeSummary.totalBilled - financeSummary.totalCollected);
  financeSummary.collectionRatePercent = financeSummary.totalBilled > 0
    ? Math.min(100, Math.round((financeSummary.totalCollected / financeSummary.totalBilled) * 100))
    : 0;
  financeSummary.operatingExpensesByCategory = operatingExpenseTotal;
  financeSummary.totalOperatingExpenses = operatingExpenseTotal.reduce((s, x) => s + (x.totalAmount || 0), 0);
  financeSummary.totalPayrollPaid = payrollByPeriod.reduce((s, x) => s + (x.totalNetSalary || 0), 0);

  const todayAttRow = attendanceLast7Days.find((d) => d._id === todayKey) || {
    _id: todayKey,
    present: 0,
    late: 0,
    absentPermission: 0,
    absentUnexcused: 0,
    total: 0
  };

  return {
    school: {
      _id: tenant._id,
      code: tenant.code,
      name: tenant.name,
      organizationCode: tenant.organizationCode || '',
      contactEmail: tenant.contactEmail || '',
      status: tenant.status,
      enabledModules: tenant.config?.moduleGateConfigured
        ? sanitizeEnabledModules(tenant.enabledModules)
        : [...ALL_ENABLED_MODULES],
      quotas: {
        maxCampuses: tenant.quotas?.maxCampuses || settings.preschoolStandards.defaultMaxCampusesPerSchool || 10,
        maxStudents: tenant.quotas?.maxStudents || settings.preschoolStandards.defaultMaxStudentsPerSchool || 800,
        maxStaff: tenant.quotas?.maxStaff || 200
      },
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt
    },
    leadershipAccounts: adminUsers.map((u) => ({
      _id: u._id,
      username: u.username,
      role: u.role,
      status: u.status,
      fullName: u.profile?.fullName || u.username,
      phone: u.profile?.phone || '',
      email: u.profile?.email || '',
      lastLogin: u.lastLogin || null
    })),
    campuses: campusReport,
    classrooms: classroomReport,
    students: studentSummary,
    accountsByRole: userRoleBreakdown,
    staffBreakdown: staffRoleBreakdown,
    attendance: {
      today: todayAttRow,
      last7Days: attendanceLast7Days
    },
    finance: {
      summary: financeSummary,
      byPeriod: financeByPeriod,
      payrollHistory: payrollByPeriod
    },
    kitchenAndFeedback: {
      recentMenus,
      recentFoodSamples,
      openFeedbacks
    },
    recentAuditLogs: recentPlatformLogs
  };
};

/**
 * Truy vấn nhật ký thao tác cấp Hệ thống (`PlatformAuditLog`) có phân trang & bộ lọc.
 *
 * @param {{ page?: number, limit?: number, action?: string, search?: string }} query
 * @returns {Promise<object>}
 */
const listPlatformAuditLogs = async (query = {}) => {
  const page = Math.max(1, Math.min(500, parseInt(query.page, 10) || 1));
  const limit = Math.max(5, Math.min(100, parseInt(query.limit, 10) || 25));
  const filter = {};

  if (query.action && String(query.action).trim()) {
    filter.action = String(query.action).trim();
  }
  if (query.search && String(query.search).trim()) {
    const escaped = String(query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { actorUsername: { $regex: escaped, $options: 'i' } },
      { action: { $regex: escaped, $options: 'i' } },
      { targetId: { $regex: escaped, $options: 'i' } },
      { 'details.code': { $regex: escaped, $options: 'i' } },
      { 'details.name': { $regex: escaped, $options: 'i' } }
    ];
  }

  const [items, total] = await Promise.all([
    PlatformAuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    PlatformAuditLog.countDocuments(filter)
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }
  };
};

module.exports = {
  ALL_MODULE_DEFINITIONS,
  ALL_ENABLED_MODULES,
  REQUIRED_CORE_MODULES,
  sanitizeEnabledModules,
  getSystemSettings,
  updateSystemSettings,
  invalidateSystemSettingsCache,
  invalidatePlatformDashboardCache,
  isAntiBotShieldEnabledSync,
  measureSystemHealth,
  getPlatformDashboardAndSchools,
  getSchoolDetailedReport,
  listPlatformAuditLogs
};

