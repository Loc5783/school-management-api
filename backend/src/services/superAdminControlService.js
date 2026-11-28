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
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const Tenant = require('../models/zone1_system/Tenant');
const User = require('../models/zone1_system/User');
const Notification = require('../models/zone1_system/Notification');
const PlatformAdmin = require('../models/zone1_system/PlatformAdmin');
const PlatformAuditLog = require('../models/zone1_system/PlatformAuditLog');
const AuditLog = require('../models/zone1_system/AuditLog');
const SystemSetting = require('../models/zone1_system/SystemSetting');
const Classroom = require('../models/zone3_school/Classroom');
const Student = require('../models/zone3_school/Student');
const StudentAttendance = require('../models/zone3_school/StudentAttendance');
const ParentFeedback = require('../models/zone3_school/ParentFeedback');
const Employee = require('../models/zone2_hr/Employee');
const AttendanceRecord = require('../models/zone2_hr/AttendanceRecord');
const AttendanceAuditLog = require('../models/zone2_hr/AttendanceAuditLog');
const TimekeepingDevice = require('../models/zone2_hr/TimekeepingDevice');
const TimekeepingWebhookLog = require('../models/zone2_hr/TimekeepingWebhookLog');
const Payroll = require('../models/zone2_hr/Payroll');
const TuitionFee = require('../models/zone4_finance/TuitionFee');
const OperatingExpense = require('../models/zone4_finance/OperatingExpense');
const FoodSample = require('../models/zone5_nutrition/FoodSample');
const Menu = require('../models/zone5_nutrition/Menu');
const { ensureAllPermissions } = require('./defaultAdminBootstrapService');
const { generateNextPersonCode } = require('./personCodeService');
const { runSafeTransaction } = require('../utils/safeTransaction');

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
    systemName: 'Nền tảng Quản lý Mầm non Hoa Nắng SaaS',
    supportEmail: 'support@hoanang.edu.vn',
    supportHotline: '1900 6868'
  },
  systemBanner: {
    enabled: false,
    level: 'info',
    message: '',
    targetSchoolCodes: []
  },
  maintenanceMode: {
    enabled: false,
    message: 'Hệ thống máy chủ đang bảo trì nâng cấp định kỳ. Vui lòng quay lại sau ít phút.'
  },
  preschoolStandards: {
    defaultSchoolYear: '2026-2027',
    standardCheckInTime: '07:00',
    standardCheckOutTime: '16:30',
    accountingCloseDay: 5,
    referenceCaloriesPerDay: 1250,
    foodSampleRetentionHours: 24,
    defaultMaxCampusesPerSchool: 10,
    defaultMaxStudentsPerSchool: 800,
    defaultMaxStaffPerSchool: 200
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

  let doc = await SystemSetting.findOne({ key: 'GLOBAL_CONFIG' }).select('-connectorBridgeSecurity').lean();
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
    if (Array.isArray(payload.systemBanner.targetSchoolCodes)) {
      systemBanner.targetSchoolCodes = [
        ...new Set(
          payload.systemBanner.targetSchoolCodes
            .map((c) => String(c || '').trim().toUpperCase())
            .filter(Boolean)
        )
      ];
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
    if (ps.defaultMaxStaffPerSchool != null) {
      const mst = Number(ps.defaultMaxStaffPerSchool);
      if (!Number.isInteger(mst) || mst < 5 || mst > 5000) {
        throw Object.assign(new Error('Hạn mức nhân sự mặc định phải từ 5 đến 5.000'), { statusCode: 422 });
      }
      preschoolStandards.defaultMaxStaffPerSchool = mst;
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

  const { todayKey, startOfToday, endOfToday, thirtyDaysAgo, sevenDaysAgo, isWeekend } = getVietnamDateBounds();

  const [
    settings,
    systemHealth,
    tenants,
    classStats,
    studentStats,
    staffStats,
    userActivityStats,
    roleDistRaw,
    schoolAdmins,
    todayStudentAtt,
    monthStudentAtt,
    todayStaffAtt,
    financeStats,
    tuitionByPeriodRaw,
    expenseStats,
    expenseByMonthRaw,
    payrollStats,
    payrollByPeriodRaw,
    foodSampleStats,
    menuStats,
    deviceStats,
    webhookLogStats,
    schoolAuditStats,
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
          totalCapacity: { $sum: { $ifNull: ['$maxSize', { $ifNull: ['$capacity', 25] }] } },
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
          adminAccounts: { $sum: { $cond: [{ $eq: ['$role', 'admin'] }, 1, 0] } },
          principalAccounts: { $sum: { $cond: [{ $eq: ['$role', 'principal'] }, 1, 0] } },
          teacherAccounts: { $sum: { $cond: [{ $eq: ['$role', 'teacher'] }, 1, 0] } },
          chefAccounts: { $sum: { $cond: [{ $eq: ['$role', 'chef'] }, 1, 0] } },
          accountantAccounts: { $sum: { $cond: [{ $eq: ['$role', 'accountant'] }, 1, 0] } },
          hrAccounts: { $sum: { $cond: [{ $eq: ['$role', 'hr'] }, 1, 0] } },
          guardAccounts: { $sum: { $cond: [{ $eq: ['$role', 'guard'] }, 1, 0] } },
          parentAccounts: { $sum: { $cond: [{ $eq: ['$role', 'parent'] }, 1, 0] } },
          internalActiveAccounts: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$status', 'active'] }, { $ne: ['$role', 'parent'] }] },
                1,
                0
              ]
            }
          },
          logins7dCount: {
            $sum: { $cond: [{ $gte: ['$lastLogin', sevenDaysAgo] }, 1, 0] }
          },
          lastActivityAt: { $max: '$lastLogin' }
        }
      }
    ]),
    User.aggregate([
      { $match: { tenantId: { $ne: null } } },
      {
        $group: {
          _id: '$role',
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } }
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
    TuitionFee.aggregate([
      { $match: { tenantId: { $ne: null }, status: { $ne: 'cancelled' } } },
      {
        $group: {
          _id: '$period',
          billed: { $sum: { $ifNull: ['$totalAmount', 0] } },
          collected: { $sum: { $ifNull: ['$paidAmount', 0] } },
          invoiceCount: { $sum: 1 }
        }
      }
    ]),
    OperatingExpense.aggregate([
      { $match: { tenantId: { $ne: null } } },
      { $group: { _id: '$tenantId', totalOperatingExpense: { $sum: { $ifNull: ['$amount', 0] } } } }
    ]),
    OperatingExpense.aggregate([
      { $match: { tenantId: { $ne: null } } },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m',
              date: { $ifNull: ['$expenseDate', { $ifNull: ['$createdAt', startOfToday] }] },
              timezone: '+07:00'
            }
          },
          operatingExpense: { $sum: { $ifNull: ['$amount', 0] } }
        }
      }
    ]),
    Payroll.aggregate([
      { $match: { tenantId: { $ne: null } } },
      { $group: { _id: '$tenantId', totalPayroll: { $sum: { $ifNull: ['$netSalary', 0] } } } }
    ]),
    Payroll.aggregate([
      { $match: { tenantId: { $ne: null } } },
      {
        $group: {
          _id: { year: '$year', month: '$month' },
          payroll: { $sum: { $ifNull: ['$netSalary', 0] } }
        }
      }
    ]),
    FoodSample.aggregate([
      { $match: { tenantId: { $ne: null } } },
      {
        $group: {
          _id: '$tenantId',
          totalSamples: { $sum: 1 },
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
    Menu.aggregate([
      { $match: { tenantId: { $ne: null } } },
      { $group: { _id: '$tenantId', menuCount: { $sum: 1 } } }
    ]),
    TimekeepingDevice.aggregate([
      { $match: { tenantId: { $ne: null } } },
      {
        $group: {
          _id: '$tenantId',
          devicesCount: { $sum: 1 },
          onlineDevicesCount: { $sum: { $cond: [{ $eq: ['$status', 'ONLINE'] }, 1, 0] } }
        }
      }
    ]),
    TimekeepingWebhookLog.aggregate([
      { $match: { tenantId: { $ne: null } } },
      {
        $group: {
          _id: '$tenantId',
          totalEvents: { $sum: 1 },
          processedEvents: { $sum: { $cond: [{ $eq: ['$processingStatus', 'PROCESSED'] }, 1, 0] } },
          failedEvents: { $sum: { $cond: [{ $eq: ['$processingStatus', 'FAILED'] }, 1, 0] } },
          lastWebhookAt: { $max: '$createdAt' }
        }
      }
    ]),
    AuditLog.aggregate([
      { $match: { tenantId: { $ne: null }, occurredAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: '$tenantId', auditCount30d: { $sum: 1 } } }
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
  const menuMap = new Map(menuStats.map((x) => [String(x._id), x.menuCount]));
  const deviceMap = new Map(deviceStats.map((x) => [String(x._id), x]));
  const webhookMap = new Map(webhookLogStats.map((x) => [String(x._id), x]));
  const schoolAuditMap = new Map(schoolAuditStats.map((x) => [String(x._id), x.auditCount30d]));
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
    const uAct = userActMap.get(tid) || {
      totalAccounts: 0,
      activeAccounts: 0,
      parentAccounts: 0,
      internalActiveAccounts: 0,
      logins7dCount: 0,
      lastActivityAt: null
    };
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
    const smp = sampleMap.get(tid) || { totalSamples: 0, alertSampleCount: 0, todaySampleCount: 0 };
    const menuCount = menuMap.get(tid) || 0;
    const devStat = deviceMap.get(tid) || { devicesCount: 0, onlineDevicesCount: 0 };
    const whStat = webhookMap.get(tid) || { totalEvents: 0, processedEvents: 0, lastWebhookAt: null };
    const auditCount30d = schoolAuditMap.get(tid) || 0;
    const openFeedbackCount = feedbackMap.get(tid) || 0;

    // Điểm mức độ khai thác phần mềm thực tế của trường (thang 100%)
    let usageScorePercent = 0;
    if (cls.classCount > 0 && stu.enrolledCount > 0) usageScorePercent += 20;
    if (uAct.internalActiveAccounts >= 2) usageScorePercent += 20;
    else if (uAct.internalActiveAccounts === 1) usageScorePercent += 10;
    if (att30d.totalRecords30d > 0) usageScorePercent += 25;
    if (fin.invoiceCount > 0) usageScorePercent += 20;
    if (menuCount > 0 || smp.totalSamples > 0 || whStat.totalEvents > 0 || devStat.devicesCount > 0) {
      usageScorePercent += 15;
    }
    const usageTier = usageScorePercent >= 75 ? 'Sôi nổi' : (usageScorePercent >= 40 ? 'Đang triển khai' : 'Mới khởi tạo');

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

    // NOTE: SuperAdmin chỉ là đơn vị phân phối & cấp phép phần mềm xuống các trường,
    // TUYỆT ĐỐI KHÔNG trộn lẫn thông báo nghiệp vụ hằng ngày của nội bộ trường (như chưa điểm danh HS,
    // lưu mẫu thức ăn bếp hay phản hồi phụ huynh) lên cảnh báo của SuperAdmin.
    // Chỉ cảnh báo các vấn đề cấp Nền tảng SaaS: Hạn mức gói cấp phép (Quota), Thiếu tài khoản Admin bàn giao, Lỗi tích hợp Webhook.
    if (t.status === 'active') {
      const activeAdmins = admins.filter((a) => a.status === 'active');
      if (activeAdmins.length === 0) {
        alerts.push({
          severity: 'warning',
          category: 'licensing',
          schoolId: t._id,
          schoolCode: t.code,
          schoolName: t.name,
          title: 'Trường chưa có tài khoản Admin hoạt động',
          detail: 'Đơn vị trường đang mở nhưng chưa có tài khoản Admin active để quản trị nội bộ.'
        });
      }
      if (stu.enrolledCount >= Math.round(quotas.maxStudents * 0.9)) {
        alerts.push({
          severity: 'warning',
          category: 'quota',
          schoolId: t._id,
          schoolCode: t.code,
          schoolName: t.name,
          title: 'Sắp chạm hạn mức Học sinh của gói cấp phép',
          detail: `Đang sử dụng ${stu.enrolledCount}/${quotas.maxStudents} học sinh (${Math.round((stu.enrolledCount / quotas.maxStudents) * 100)}% hạn mức gói).`
        });
      }
      if (mergedCampusNames.length >= quotas.maxCampuses && quotas.maxCampuses > 1) {
        alerts.push({
          severity: 'info',
          category: 'quota',
          schoolId: t._id,
          schoolCode: t.code,
          schoolName: t.name,
          title: 'Đã sử dụng hết hạn mức số Phân hiệu được cấp',
          detail: `Đang mở ${mergedCampusNames.length}/${quotas.maxCampuses} phân hiệu theo gói phần mềm.`
        });
      }
      if ((whStat.failedEvents || 0) > 0) {
        alerts.push({
          severity: 'critical',
          category: 'webhook_integration',
          schoolId: t._id,
          schoolCode: t.code,
          schoolName: t.name,
          title: 'Phát sinh gói tin máy chấm công lỗi kỹ thuật (Webhook FAILED)',
          detail: `Có ${whStat.failedEvents} gói tin đẩy từ thiết bị vào /api/attendance/webhook/${t.code} gặp lỗi xử lý.`
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
        internalActiveAccounts: uAct.internalActiveAccounts || 0,
        parentAccounts: uAct.parentAccounts,
        logins7dCount: uAct.logins7dCount || 0,
        lastActivityAt: uAct.lastActivityAt,
        roleCounts: {
          admin: uAct.adminAccounts || 0,
          principal: uAct.principalAccounts || 0,
          teacher: uAct.teacherAccounts || 0,
          chef: uAct.chefAccounts || 0,
          accountant: uAct.accountantAccounts || 0,
          hr: uAct.hrAccounts || 0,
          guard: uAct.guardAccounts || 0,
          parent: uAct.parentAccounts || 0
        }
      },
      attendance: {
        todayRecorded: attToday.totalRecorded,
        todayPresent: attToday.presentCount,
        todayAbsent: attToday.absentCount,
        todayPercent: attendanceTodayPercent,
        rolling30dPercent: attendance30dPercent,
        records30dCount: att30d.totalRecords30d || 0
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
        totalExpenditure: opExp + payExp,
        netCashflow: fin.totalCollected - (opExp + payExp)
      },
      safety: {
        foodSampleAlerts: smp.alertSampleCount,
        todayFoodSamples: smp.todaySampleCount,
        totalFoodSamples: smp.totalSamples || 0,
        openParentFeedback: openFeedbackCount
      },
      webhook: {
        endpointPath: `/api/attendance/webhook/${t.code}`,
        devicesCount: devStat.devicesCount,
        onlineDevicesCount: devStat.onlineDevicesCount,
        totalEvents: whStat.totalEvents,
        processedEvents: whStat.processedEvents,
        lastWebhookAt: whStat.lastWebhookAt || null
      },
      usage: {
        usageScorePercent,
        usageTier,
        menusCount: menuCount,
        foodSamplesCount: smp.totalSamples || 0,
        auditLogs30d: auditCount30d,
        logins7dCount: uAct.logins7dCount || 0,
        studentQuotaPercent: quotas.maxStudents > 0 ? Math.min(100, Math.round((stu.enrolledCount / quotas.maxStudents) * 100)) : 0,
        campusQuotaPercent: quotas.maxCampuses > 0 ? Math.min(100, Math.round((mergedCampusNames.length / quotas.maxCampuses) * 100)) : 0
      },
      primaryAdmin: admins[0] || null,
      adminAccounts: admins,
      createdAt: t.createdAt
    };
  });

  if ((systemHealth.memory?.systemUsedPercent || 0) > 88 || systemHealth.status !== 'healthy') {
    alerts.unshift({
      severity: 'critical',
      category: 'infrastructure',
      schoolId: null,
      schoolCode: 'PLATFORM',
      schoolName: 'Hạ tầng Máy chủ SaaS',
      title: systemHealth.status !== 'healthy'
        ? 'Kết nối Cơ sở dữ liệu trung tâm đang suy giảm'
        : `Bộ nhớ RAM máy chủ đạt mức cao (${systemHealth.memory?.systemUsedPercent}%)`,
      detail: 'SuperAdmin cần kiểm tra tài nguyên hạ tầng máy chủ phân phối phần mềm.'
    });
  }

  const summary = schools.reduce(
    (acc, item) => {
      acc.totalSchools += 1;
      if (item.status === 'active') acc.activeSchools += 1;
      else if (item.status === 'suspended') acc.suspendedSchools += 1;
      acc.totalCampuses += item.campusCount;
      acc.totalClassrooms += item.classCount;
      acc.totalCapacity += item.totalCapacity;
      acc.totalStudentQuota += item.quotas?.maxStudents || 0;
      acc.totalStudents += item.studentCount;
      acc.totalStaff += item.staffCount;
      acc.totalStaffPresentToday += item.staffPresentToday;
      acc.totalActiveAccounts += item.accountStats.activeAccounts;
      acc.totalWebhookEvents += item.webhook?.totalEvents || 0;
      acc.totalDevices += item.webhook?.devicesCount || 0;
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
      totalStudentQuota: 0,
      totalStudents: 0,
      totalStaff: 0,
      totalStaffPresentToday: 0,
      totalActiveAccounts: 0,
      totalWebhookEvents: 0,
      totalDevices: 0,
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

  summary.overallStudentQuotaPercent = summary.totalStudentQuota > 0
    ? Math.min(100, Math.round((summary.totalStudents / summary.totalStudentQuota) * 100))
    : 0;

  summary.overallOccupancyPercent = summary.totalCapacity > 0
    ? Math.min(100, Math.round((summary.totalStudents / summary.totalCapacity) * 100))
    : 0;
  summary.overallAttendanceTodayPercent = summary.todayStudentRecorded > 0
    ? Math.round((summary.todayStudentPresent / summary.todayStudentRecorded) * 100)
    : 0;
  summary.overallCollectionRatePercent = summary.totalBilled > 0
    ? Math.min(100, Math.round((summary.totalCollected / summary.totalBilled) * 100))
    : 0;
  summary.netCashflow = summary.totalCollected - summary.totalExpenditure;
  summary.alertCount = alerts.length;

  // Tổng hợp chuỗi thời gian Kinh tế theo kỳ (tối đa 6 kỳ gần nhất) để vẽ biểu đồ trực quan
  const normalizePeriodKey = (rawPeriod) => {
    const s = String(rawPeriod || '').trim();
    const m1 = /^(\d{4})[-/](\d{1,2})$/.exec(s);
    if (m1) {
      const mm = m1[2].padStart(2, '0');
      return { sortKey: `${m1[1]}-${mm}`, label: `${mm}/${m1[1]}` };
    }
    const m2 = /^(\d{1,2})[-/](\d{4})$/.exec(s);
    if (m2) {
      const mm = m2[1].padStart(2, '0');
      return { sortKey: `${m2[2]}-${mm}`, label: `${mm}/${m2[2]}` };
    }
    return null;
  };

  const periodBucketMap = new Map();
  const ensureBucket = (sortKey, label) => {
    if (!periodBucketMap.has(sortKey)) {
      periodBucketMap.set(sortKey, {
        period: sortKey,
        label,
        billed: 0,
        collected: 0,
        outstanding: 0,
        operatingExpense: 0,
        payroll: 0,
        totalExpenditure: 0,
        netBalance: 0,
        invoiceCount: 0
      });
    }
    return periodBucketMap.get(sortKey);
  };

  for (const row of tuitionByPeriodRaw) {
    const norm = normalizePeriodKey(row._id);
    if (!norm) continue;
    const b = ensureBucket(norm.sortKey, norm.label);
    b.billed += row.billed || 0;
    b.collected += row.collected || 0;
    b.invoiceCount += row.invoiceCount || 0;
  }

  for (const row of expenseByMonthRaw) {
    const norm = normalizePeriodKey(row._id);
    if (!norm) continue;
    const b = ensureBucket(norm.sortKey, norm.label);
    b.operatingExpense += row.operatingExpense || 0;
  }

  for (const row of payrollByPeriodRaw) {
    if (!row._id?.year || !row._id?.month) continue;
    const mm = String(row._id.month).padStart(2, '0');
    const sortKey = `${row._id.year}-${mm}`;
    const b = ensureBucket(sortKey, `${mm}/${row._id.year}`);
    b.payroll += row.payroll || 0;
  }

  const economicTrend = [...periodBucketMap.values()]
    .sort((a, b) => a.period.localeCompare(b.period))
    .slice(-6)
    .map((b) => {
      const outstanding = Math.max(0, b.billed - b.collected);
      const totalExpenditure = b.operatingExpense + b.payroll;
      const collectionRatePercent = b.billed > 0 ? Math.min(100, Math.round((b.collected / b.billed) * 100)) : 0;
      return {
        ...b,
        outstanding,
        totalExpenditure,
        netBalance: b.collected - totalExpenditure,
        collectionRatePercent
      };
    });

  // Phân bố tài khoản theo vai trò trên toàn chuỗi trường
  const ROLE_CATALOG = [
    { role: 'admin', label: 'Quản trị trường (School Admin)' },
    { role: 'principal', label: 'Ban Giám đốc / Hiệu trưởng' },
    { role: 'teacher', label: 'Giáo viên đứng lớp' },
    { role: 'accountant', label: 'Kế toán học phí' },
    { role: 'hr', label: 'Nhân sự & Tiền lương' },
    { role: 'chef', label: 'Đầu bếp & Dinh dưỡng' },
    { role: 'guard', label: 'Bảo vệ & An ninh cổng' },
    { role: 'parent', label: 'Phụ huynh học sinh' }
  ];
  const roleRawMap = new Map(roleDistRaw.map((r) => [String(r._id), r]));
  const roleDistribution = ROLE_CATALOG.map((rc) => {
    const found = roleRawMap.get(rc.role) || { total: 0, active: 0 };
    return {
      role: rc.role,
      label: rc.label,
      total: found.total || 0,
      active: found.active || 0
    };
  });

  const dashboardPayload = {
    summary,
    economicTrend,
    roleDistribution,
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
      .select('name ageGroup schoolYear maxSize capacity campus homeroomTeacherId')
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
    const cap = cls.maxSize || cls.capacity || 25;
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

/**
 * Truy xuất Nhật ký Hoạt động của Từng Trường cụ thể (`school_audit`, `webhook`, `attendance_audit`)
 * hoặc toàn bộ các trường dành cho SuperAdmin kiểm tra, hỗ trợ kỹ thuật & đối soát.
 *
 * @param {{ schoolId?: string, logType?: string, search?: string, action?: string, page?: number, limit?: number }} query
 * @returns {Promise<object>}
 */
const listSchoolOperationalLogs = async (query = {}) => {
  const logType = String(query.logType || 'school_audit').trim();
  if (logType === 'platform') {
    return listPlatformAuditLogs(query);
  }

  const page = Math.max(1, Math.min(500, parseInt(query.page, 10) || 1));
  const limit = Math.max(5, Math.min(100, parseInt(query.limit, 10) || 25));
  const skip = (page - 1) * limit;

  const tenants = await Tenant.find({}).select('code name').lean();
  const tenantMap = new Map(tenants.map((t) => [String(t._id), { code: t.code, name: t.name }]));

  let tenantFilter = { $ne: null };
  if (query.schoolId && String(query.schoolId).trim() && String(query.schoolId).trim() !== 'all') {
    const rawSchoolId = String(query.schoolId).trim();
    if (!mongoose.Types.ObjectId.isValid(rawSchoolId)) {
      throw Object.assign(new Error('Mã định danh trường học không hợp lệ'), { statusCode: 400 });
    }
    tenantFilter = new mongoose.Types.ObjectId(rawSchoolId);
  }

  const escapedSearch = query.search && String(query.search).trim()
    ? String(query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    : '';

  // Nhánh 1: Nhật ký gói tin Webhook máy chấm công & điểm danh học sinh của trường (`TimekeepingWebhookLog`)
  if (logType === 'webhook') {
    const filter = { tenantId: tenantFilter };
    if (query.action && String(query.action).trim()) {
      filter.processingStatus = String(query.action).trim();
    }
    if (escapedSearch) {
      filter.$or = [
        { schoolCode: { $regex: escapedSearch, $options: 'i' } },
        { deviceCode: { $regex: escapedSearch, $options: 'i' } },
        { processingNote: { $regex: escapedSearch, $options: 'i' } },
        { 'hikvisionSummary.employeeNoString': { $regex: escapedSearch, $options: 'i' } },
        { 'hikvisionSummary.personName': { $regex: escapedSearch, $options: 'i' } }
      ];
    }

    const [rawItems, total] = await Promise.all([
      TimekeepingWebhookLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-rawBodyPreview -headers')
        .lean(),
      TimekeepingWebhookLog.countDocuments(filter)
    ]);

    const items = rawItems.map((item) => {
      const tInfo = item.tenantId ? tenantMap.get(String(item.tenantId)) : null;
      return {
        _id: item._id,
        logType: 'webhook',
        occurredAt: item.createdAt,
        schoolId: item.tenantId || null,
        schoolCode: item.schoolCode || tInfo?.code || 'N/A',
        schoolName: tInfo?.name || '',
        actorUsername: item.deviceCode || 'HIKVISION',
        actorRole: 'device_webhook',
        action: item.processingStatus || 'RECEIVED_RAW',
        personCode: item.hikvisionSummary?.employeeNoString || '',
        personName: item.hikvisionSummary?.personName || '',
        verifyMode: item.hikvisionSummary?.currentVerifyMode || '',
        url: item.url || '',
        summary: item.processingNote || 'Gói tin từ thiết bị chấm công'
      };
    });

    return {
      items,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
    };
  }

  // Nhánh 2: Nhật ký chấm công & điều chỉnh ca làm việc của trường (`AttendanceAuditLog`)
  if (logType === 'attendance_audit') {
    const filter = { tenantId: tenantFilter };
    if (query.action && String(query.action).trim()) {
      filter.action = String(query.action).trim();
    }
    if (escapedSearch) {
      filter.$or = [
        { actorName: { $regex: escapedSearch, $options: 'i' } },
        { action: { $regex: escapedSearch, $options: 'i' } },
        { entity: { $regex: escapedSearch, $options: 'i' } },
        { reason: { $regex: escapedSearch, $options: 'i' } }
      ];
    }

    const [rawItems, total] = await Promise.all([
      AttendanceAuditLog.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AttendanceAuditLog.countDocuments(filter)
    ]);

    const items = rawItems.map((item) => {
      const tInfo = item.tenantId ? tenantMap.get(String(item.tenantId)) : null;
      return {
        _id: item._id,
        logType: 'attendance_audit',
        occurredAt: item.timestamp || item.createdAt,
        schoolId: item.tenantId || null,
        schoolCode: tInfo?.code || 'N/A',
        schoolName: tInfo?.name || '',
        actorUsername: item.actorName || 'Hệ thống tự động',
        actorRole: item.actorRole || 'system',
        action: item.action,
        targetType: item.entity,
        summary: item.reason || `Đối tượng: ${item.entity}`
      };
    });

    return {
      items,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
    };
  }

  // Nhánh 3 (Mặc định): Nhật ký Nghiệp vụ & Phân quyền nội bộ của Từng Trường (`AuditLog`)
  const filter = { tenantId: tenantFilter };
  if (query.action && String(query.action).trim()) {
    filter.action = String(query.action).trim();
  }
  if (escapedSearch) {
    filter.$or = [
      { actorUsername: { $regex: escapedSearch, $options: 'i' } },
      { actorName: { $regex: escapedSearch, $options: 'i' } },
      { action: { $regex: escapedSearch, $options: 'i' } },
      { targetType: { $regex: escapedSearch, $options: 'i' } },
      { reason: { $regex: escapedSearch, $options: 'i' } }
    ];
  }

  const [rawItems, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ occurredAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(filter)
  ]);

  const items = rawItems.map((item) => {
    const tInfo = item.tenantId ? tenantMap.get(String(item.tenantId)) : null;
    const targetHint = item.after?.username
      ? `@${item.after.username}${item.after.role ? ` (${item.after.role})` : ''}`
      : (item.after?.fullName || item.after?.studentCode || item.reason || '');
    return {
      _id: item._id,
      logType: 'school_audit',
      occurredAt: item.occurredAt || item.createdAt,
      schoolId: item.tenantId || null,
      schoolCode: tInfo?.code || 'N/A',
      schoolName: tInfo?.name || '',
      actorUsername: item.actorUsername || item.actorName || 'admin',
      actorName: item.actorName || '',
      actorRole: item.actorRole || '',
      action: item.action,
      targetType: item.targetType,
      summary: [targetHint, item.reason].filter(Boolean).join(' · ') || `Bảng: ${item.targetType}`
    };
  });

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
  };
};

/**
 * Gửi thông báo Hệ thống / Cấp phép / Bảo trì từ SuperAdmin xuống ĐÚNG trường được chọn
 * (hoặc toàn bộ các trường đang sử dụng nếu SuperAdmin chủ động chọn `targetScope = 'all'`).
 * Đảm bảo thông báo của trường nào CHỈ gửi vào `tenantId` của trường đó, tuyệt đối không lộ sang trường khác.
 *
 * @param {object} payload
 * @param {'single'|'all'} [payload.targetScope]
 * @param {string} [payload.schoolId]
 * @param {string[]} [payload.recipientRoles]
 * @param {string} payload.title
 * @param {string} payload.message
 * @param {'info'|'warning'|'success'} [payload.type]
 * @param {{ _id: any, username: string }} actor
 */
const dispatchPlatformNotificationToSchools = async (payload = {}, actor) => {
  const targetScope = payload.targetScope === 'all' ? 'all' : 'single';
  const cleanTitle = String(payload.title || '').trim();
  const cleanMessage = String(payload.message || '').trim();
  const notifType = ['info', 'warning', 'success', 'system'].includes(payload.type) ? payload.type : 'system';

  if (cleanTitle.length < 3 || cleanTitle.length > 160) {
    throw Object.assign(new Error('Tiêu đề thông báo phải từ 3 đến 160 ký tự'), { statusCode: 422 });
  }
  if (cleanMessage.length < 5 || cleanMessage.length > 1500) {
    throw Object.assign(new Error('Nội dung thông báo phải từ 5 đến 1.500 ký tự'), { statusCode: 422 });
  }

  let targetTenants = [];
  if (targetScope === 'single') {
    const rawSchoolId = String(payload.schoolId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(rawSchoolId)) {
      throw Object.assign(new Error('Vui lòng chọn đơn vị trường cần gửi thông báo'), { statusCode: 400 });
    }
    const tenant = await Tenant.findById(rawSchoolId).select('_id code name status').lean();
    if (!tenant) {
      throw Object.assign(new Error('Không tìm thấy trường học cần gửi thông báo'), { statusCode: 404 });
    }
    targetTenants = [tenant];
  } else {
    targetTenants = await Tenant.find({ status: 'active' }).select('_id code name status').lean();
  }

  if (!targetTenants.length) {
    throw Object.assign(new Error('Chưa có trường học đang hoạt động để nhận thông báo'), { statusCode: 422 });
  }

  const allowedRoles = ['admin', 'principal', 'teacher', 'accountant', 'hr', 'chef', 'guard'];
  const requestedRoles = Array.isArray(payload.recipientRoles)
    ? payload.recipientRoles.filter((r) => allowedRoles.includes(r))
    : [];
  const targetRoles = requestedRoles.length > 0 ? requestedRoles : ['admin', 'principal'];

  const tenantIds = targetTenants.map((t) => t._id);
  const recipients = await User.find({
    tenantId: { $in: tenantIds },
    role: { $in: targetRoles },
    status: 'active'
  })
    .select('_id tenantId role')
    .lean();

  if (recipients.length > 0) {
    await Notification.insertMany(
      recipients.map((rec) => ({
        tenantId: rec.tenantId,
        recipientId: rec._id,
        title: `[Hệ thống Phần mềm] ${cleanTitle}`,
        message: cleanMessage,
        type: notifType === 'warning' ? 'warning' : 'system',
        link: rec.role === 'admin' ? '/campuses' : '/dashboard',
        metadata: {
          source: 'platform_distributor',
          priority: notifType === 'warning' ? 'high' : 'normal',
          dispatchedBy: actor?.username || 'superadmin'
        }
      }))
    );
  }

  if (actor?._id) {
    await PlatformAuditLog.create({
      actorId: actor._id,
      actorUsername: actor.username || 'superadmin',
      action: 'DISPATCH_SCHOOL_NOTIFICATION',
      targetType: targetScope === 'single' ? 'tenant' : 'all_tenants',
      targetId: targetScope === 'single' ? String(targetTenants[0]._id) : 'ALL_ACTIVE_SCHOOLS',
      details: {
        code: targetScope === 'single' ? targetTenants[0].code : `ALL (${targetTenants.length})`,
        name: targetScope === 'single' ? targetTenants[0].name : 'Toàn bộ các trường đang sử dụng',
        recipientCount: recipients.length,
        roles: targetRoles,
        title: cleanTitle
      }
    });
  }

  return {
    targetScope,
    schoolCount: targetTenants.length,
    recipientCount: recipients.length,
    schools: targetTenants.map((t) => ({ _id: t._id, code: t.code, name: t.name }))
  };
};

const STAFF_POSITION_BY_ROLE = {
  principal: 'principal',
  teacher: 'teacher',
  accountant: 'accountant',
  chef: 'chef',
  guard: 'security',
  hr: 'hr'
};

const ALLOWED_SUPERADMIN_CREATE_ROLES = [
  'admin',
  'principal',
  'teacher',
  'chef',
  'accountant',
  'hr',
  'guard'
];

const USERNAME_REGEX = /^[a-zA-Z0-9._-]{3,50}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Truy xuất danh sách toàn bộ tài khoản người dùng (`User`) thuộc phạm vi 1 trường (`tenantId`)
 * kèm thống kê số lượng theo từng vai trò, đảm bảo không trả về `passwordHash` và không lỗi N+1.
 *
 * @param {string} schoolId - `_id` của đơn vị trường (`Tenant`).
 * @param {{ role?: string, status?: string, search?: string, page?: number, limit?: number }} [query]
 * @returns {Promise<object>}
 */
const listSchoolAccountsForSuperAdmin = async (schoolId, query = {}) => {
  if (!mongoose.Types.ObjectId.isValid(schoolId)) {
    throw Object.assign(new Error('Mã định danh trường học không hợp lệ'), { statusCode: 400 });
  }

  const tenantObjId = new mongoose.Types.ObjectId(schoolId);
  const tenant = await Tenant.findById(tenantObjId)
    .select('_id code name status contactEmail quotas')
    .lean();
  if (!tenant) {
    throw Object.assign(new Error('Không tìm thấy đơn vị trường học'), { statusCode: 404 });
  }

  const page = Math.max(1, Math.min(500, parseInt(query.page, 10) || 1));
  const limit = Math.max(5, Math.min(100, parseInt(query.limit, 10) || 25));
  const skip = (page - 1) * limit;

  // Bắt buộc lọc theo `tenantId` ở vị trí đầu tiên để bám sát compound index { tenantId: 1, ... }
  const filter = { tenantId: tenantObjId };
  const validRoles = ['admin', 'principal', 'teacher', 'chef', 'accountant', 'hr', 'guard', 'parent'];
  if (query.role && query.role !== 'all' && validRoles.includes(String(query.role).trim())) {
    filter.role = String(query.role).trim();
  }
  const validStatuses = ['active', 'suspended', 'inactive', 'locked'];
  if (query.status && query.status !== 'all' && validStatuses.includes(String(query.status).trim())) {
    filter.status = String(query.status).trim();
  }
  if (query.search && String(query.search).trim()) {
    const escaped = String(query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { username: { $regex: escaped, $options: 'i' } },
      { 'profile.fullName': { $regex: escaped, $options: 'i' } },
      { 'profile.phone': { $regex: escaped, $options: 'i' } },
      { 'profile.email': { $regex: escaped, $options: 'i' } },
      { 'employeeInfo.employeeId': { $regex: escaped, $options: 'i' } }
    ];
  }

  const [roleStatsRaw, users, total] = await Promise.all([
    User.aggregate([
      { $match: { tenantId: tenantObjId } },
      {
        $group: {
          _id: '$role',
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } }
        }
      }
    ]),
    User.find(filter)
      .select('username role status profile employeeInfo parentInfo createdAt lastLogin')
      .sort({ role: 1, createdAt: 1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter)
  ]);

  const userIds = users.map((u) => u._id);
  const linkedEmployees = userIds.length > 0
    ? await Employee.find({ tenantId: tenantObjId, userId: { $in: userIds } })
        .select('userId employeeCode position status')
        .lean()
    : [];
  const empByUser = new Map(linkedEmployees.map((e) => [String(e.userId), e]));

  const roleSummary = {
    all: { total: 0, active: 0 },
    admin: { total: 0, active: 0 },
    principal: { total: 0, active: 0 },
    teacher: { total: 0, active: 0 },
    chef: { total: 0, active: 0 },
    accountant: { total: 0, active: 0 },
    hr: { total: 0, active: 0 },
    guard: { total: 0, active: 0 },
    parent: { total: 0, active: 0 }
  };

  for (const row of roleStatsRaw) {
    if (row._id && roleSummary[row._id]) {
      roleSummary[row._id] = { total: row.total || 0, active: row.active || 0 };
    }
    roleSummary.all.total += row.total || 0;
    roleSummary.all.active += row.active || 0;
  }

  const items = users.map((u) => {
    const emp = empByUser.get(String(u._id));
    return {
      _id: u._id,
      username: u.username,
      role: u.role,
      status: u.status,
      profile: {
        fullName: u.profile?.fullName || u.username,
        phone: u.profile?.phone || '',
        email: u.profile?.email || ''
      },
      employeeCode: emp?.employeeCode || u.employeeInfo?.employeeId || '',
      linkedStudentsCount: Array.isArray(u.parentInfo?.studentIds) ? u.parentInfo.studentIds.length : 0,
      lastLogin: u.lastLogin || null,
      createdAt: u.createdAt || null
    };
  });

  return {
    school: {
      _id: tenant._id,
      code: tenant.code,
      name: tenant.name,
      status: tenant.status,
      contactEmail: tenant.contactEmail || '',
      quotas: tenant.quotas || { maxCampuses: 10, maxStudents: 800, maxStaff: 200 }
    },
    roleSummary,
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }
  };
};

/**
 * SuperAdmin khởi tạo thêm Tài khoản Quản trị trường (`admin`) hoặc Tài khoản Nhân sự nội bộ
 * cho đúng đơn vị trường (`tenantId`), đảm bảo tự động gắn quyền/hồ sơ nhân sự và ghi AuditLog.
 *
 * @param {string} schoolId
 * @param {object} payload
 * @param {{ _id: any, username: string }} actor
 * @returns {Promise<object>}
 */
const createSchoolAccountBySuperAdmin = async (schoolId, payload = {}, actor) => {
  if (!mongoose.Types.ObjectId.isValid(schoolId)) {
    throw Object.assign(new Error('Mã định danh trường học không hợp lệ'), { statusCode: 400 });
  }

  const settings = await getSystemSettings();
  const minPassLen = settings.securityPolicy?.minPasswordLength || 6;

  const cleanUsername = String(payload.username || '').trim();
  const rawPassword = String(payload.password || '');
  const cleanRole = String(payload.role || 'admin').trim();
  const cleanFullName = String(payload.profile?.fullName ?? payload.fullName ?? '').trim();
  const cleanPhone = String(payload.profile?.phone ?? payload.phone ?? '').trim();
  const cleanEmail = String(payload.profile?.email ?? payload.email ?? '').trim().toLowerCase();

  if (!USERNAME_REGEX.test(cleanUsername)) {
    throw Object.assign(
      new Error('Tên đăng nhập chỉ gồm chữ không dấu, số, dấu chấm, gạch ngang/dưới (3–50 ký tự)'),
      { statusCode: 422 }
    );
  }
  if (rawPassword.length < minPassLen || rawPassword.length > 72) {
    throw Object.assign(
      new Error(`Mật khẩu khởi tạo phải từ ${minPassLen} đến 72 ký tự`),
      { statusCode: 422 }
    );
  }
  if (!ALLOWED_SUPERADMIN_CREATE_ROLES.includes(cleanRole)) {
    throw Object.assign(new Error('Vai trò tài khoản cấp cho trường không hợp lệ'), { statusCode: 422 });
  }
  if (!cleanFullName || cleanFullName.length > 120) {
    throw Object.assign(new Error('Vui lòng nhập họ và tên người sử dụng (1–120 ký tự)'), { statusCode: 422 });
  }
  if (cleanEmail && !EMAIL_REGEX.test(cleanEmail)) {
    throw Object.assign(new Error('Địa chỉ email không đúng định dạng'), { statusCode: 422 });
  }

  const permissionIds = cleanRole === 'admin' ? await ensureAllPermissions() : [];
  const passwordHash = await bcrypt.hash(rawPassword, 10);

  const createdResult = await runSafeTransaction(async (session) => {
    const sessionOpt = session ? { session } : undefined;
    const tenant = await Tenant.findById(schoolId).session(session);
    if (!tenant) {
      throw Object.assign(new Error('Không tìm thấy đơn vị trường học'), { statusCode: 404 });
    }

    const exists = await User.exists({ tenantId: tenant._id, username: cleanUsername }).session(session);
    if (exists) {
      throw Object.assign(
        new Error(`Tên đăng nhập "@${cleanUsername}" đã tồn tại trong trường ${tenant.code}`),
        { statusCode: 409 }
      );
    }

    const [createdUser] = await User.create(
      [
        {
          tenantId: tenant._id,
          username: cleanUsername,
          passwordHash,
          role: cleanRole,
          permissions: permissionIds,
          profile: {
            fullName: cleanFullName,
            phone: cleanPhone,
            email: cleanEmail
          },
          status: 'active',
          authVersion: 0
        }
      ],
      sessionOpt
    );

    let employeeCode = '';
    if (cleanRole !== 'admin') {
      employeeCode = await generateNextPersonCode({ tenantId: tenant._id, session });
      const position = STAFF_POSITION_BY_ROLE[cleanRole] || 'teacher';
      await Employee.create(
        [
          {
            tenantId: tenant._id,
            userId: createdUser._id,
            employeeCode,
            fullName: cleanFullName,
            phone: cleanPhone,
            email: cleanEmail,
            gender: null,
            contractType: null,
            startDate: null,
            qualification: { degree: '', major: '' },
            position,
            payrollRole: cleanRole,
            status: 'active',
            salaryConfig: { baseSalary: 0, positionAllowance: 0, lunchAllowance: 0 }
          }
        ],
        sessionOpt
      );
      createdUser.employeeInfo = {
        employeeId: employeeCode,
        position,
        baseSalary: 0
      };
      await createdUser.save(sessionOpt);
    }

    if (actor?._id) {
      await PlatformAuditLog.create(
        [
          {
            actorId: actor._id,
            actorUsername: actor.username || 'superadmin',
            action: 'UPDATE_SCHOOL_CONFIG',
            targetType: 'school_user',
            targetId: String(createdUser._id),
            details: {
              code: tenant.code,
              name: tenant.name,
              adminUsername: createdUser.username,
              createdRole: cleanRole
            }
          }
        ],
        sessionOpt
      );
    }

    return {
      school: { _id: tenant._id, code: tenant.code, name: tenant.name },
      account: {
        _id: createdUser._id,
        username: createdUser.username,
        role: createdUser.role,
        status: createdUser.status,
        profile: createdUser.profile,
        employeeCode,
        createdAt: createdUser.createdAt
      }
    };
  });

  invalidatePlatformDashboardCache();
  return createdResult;
};

/**
 * SuperAdmin cập nhật thông tin, đặt lại mật khẩu (tự động nâng `authVersion`) hoặc khóa/mở khóa
 * một tài khoản thuộc đúng phạm vi `tenantId` của trường.
 *
 * @param {string} schoolId
 * @param {string} accountId
 * @param {object} payload
 * @param {{ _id: any, username: string }} actor
 * @returns {Promise<object>}
 */
const updateSchoolAccountBySuperAdmin = async (schoolId, accountId, payload = {}, actor) => {
  if (!mongoose.Types.ObjectId.isValid(schoolId) || !mongoose.Types.ObjectId.isValid(accountId)) {
    throw Object.assign(new Error('Định danh trường học hoặc tài khoản không hợp lệ'), { statusCode: 400 });
  }

  const settings = await getSystemSettings();
  const minPassLen = settings.securityPolicy?.minPasswordLength || 6;

  const updatedResult = await runSafeTransaction(async (session) => {
    const sessionOpt = session ? { session } : undefined;
    const tenant = await Tenant.findById(schoolId).session(session);
    if (!tenant) {
      throw Object.assign(new Error('Không tìm thấy đơn vị trường học'), { statusCode: 404 });
    }

    // Cách ly tuyệt đối theo tenantId: không bao giờ chạm tới User của trường khác
    const targetUser = await User.findOne({ _id: accountId, tenantId: tenant._id }).session(session);
    if (!targetUser) {
      throw Object.assign(new Error('Không tìm thấy tài khoản trong phạm vi trường này'), { statusCode: 404 });
    }

    let bumpedAuth = false;

    if (payload.username != null) {
      const nextUsername = String(payload.username).trim();
      if (!USERNAME_REGEX.test(nextUsername)) {
        throw Object.assign(
          new Error('Tên đăng nhập chỉ gồm chữ không dấu, số, dấu chấm, gạch ngang/dưới (3–50 ký tự)'),
          { statusCode: 422 }
        );
      }
      if (nextUsername !== targetUser.username) {
        const dup = await User.exists({
          tenantId: tenant._id,
          username: nextUsername,
          _id: { $ne: targetUser._id }
        }).session(session);
        if (dup) {
          throw Object.assign(
            new Error(`Tên đăng nhập "@${nextUsername}" đã thuộc về tài khoản khác trong trường ${tenant.code}`),
            { statusCode: 409 }
          );
        }
        targetUser.username = nextUsername;
        bumpedAuth = true;
      }
    }

    const nextFullName = payload.profile?.fullName ?? payload.fullName;
    const nextPhone = payload.profile?.phone ?? payload.phone;
    const nextEmail = payload.profile?.email ?? payload.email;

    if (nextFullName != null) {
      const cleanName = String(nextFullName).trim();
      if (!cleanName || cleanName.length > 120) {
        throw Object.assign(new Error('Họ và tên phải từ 1 đến 120 ký tự'), { statusCode: 422 });
      }
      targetUser.profile.fullName = cleanName;
    }
    if (nextPhone != null) {
      targetUser.profile.phone = String(nextPhone).trim().slice(0, 25);
    }
    if (nextEmail != null) {
      const cleanMail = String(nextEmail).trim().toLowerCase();
      if (cleanMail && !EMAIL_REGEX.test(cleanMail)) {
        throw Object.assign(new Error('Địa chỉ email không đúng định dạng'), { statusCode: 422 });
      }
      targetUser.profile.email = cleanMail;
    }

    if (payload.role != null && targetUser.role !== 'parent') {
      const nextRole = String(payload.role).trim();
      if (!ALLOWED_SUPERADMIN_CREATE_ROLES.includes(nextRole)) {
        throw Object.assign(new Error('Vai trò cập nhật không hợp lệ'), { statusCode: 422 });
      }
      if (targetUser.role === 'admin' && nextRole !== 'admin') {
        const otherActiveAdmins = await User.countDocuments({
          tenantId: tenant._id,
          role: 'admin',
          status: 'active',
          _id: { $ne: targetUser._id }
        }).session(session);
        if (otherActiveAdmins === 0) {
          throw Object.assign(
            new Error('Không thể hạ quyền tài khoản Admin duy nhất đang hoạt động của trường'),
            { statusCode: 422 }
          );
        }
      }
      if (nextRole === 'admin' && targetUser.role !== 'admin') {
        targetUser.permissions = await ensureAllPermissions();
      }
      targetUser.role = nextRole;
      bumpedAuth = true;
    }

    if (payload.status != null) {
      const nextStatus = String(payload.status).trim();
      if (!['active', 'suspended', 'inactive'].includes(nextStatus)) {
        throw Object.assign(new Error('Trạng thái tài khoản không hợp lệ'), { statusCode: 422 });
      }
      if (targetUser.role === 'admin' && nextStatus !== 'active' && tenant.status === 'active') {
        const otherActiveAdmins = await User.countDocuments({
          tenantId: tenant._id,
          role: 'admin',
          status: 'active',
          _id: { $ne: targetUser._id }
        }).session(session);
        if (otherActiveAdmins === 0) {
          throw Object.assign(
            new Error('Trường đang hoạt động phải giữ tối thiểu 1 tài khoản Admin đang mở. Hãy cấp thêm Admin khác trước khi khóa.'),
            { statusCode: 422 }
          );
        }
      }
      if (targetUser.status !== nextStatus) {
        targetUser.status = nextStatus;
        bumpedAuth = true;
      }
    }

    const rawNewPass = payload.password != null ? String(payload.password) : '';
    if (rawNewPass) {
      if (rawNewPass.length < minPassLen || rawNewPass.length > 72) {
        throw Object.assign(
          new Error(`Mật khẩu mới phải từ ${minPassLen} đến 72 ký tự`),
          { statusCode: 422 }
        );
      }
      targetUser.passwordHash = await bcrypt.hash(rawNewPass, 10);
      if (payload.status == null && targetUser.status !== 'active') {
        targetUser.status = 'active';
      }
      bumpedAuth = true;
    }

    if (bumpedAuth) {
      targetUser.authVersion = (targetUser.authVersion || 0) + 1;
    }

    await targetUser.save(sessionOpt);

    // Đồng bộ sang hồ sơ Employee liên kết nếu có trong cùng trường
    const linkedEmp = await Employee.findOne({ tenantId: tenant._id, userId: targetUser._id }).session(session);
    if (linkedEmp) {
      linkedEmp.fullName = targetUser.profile?.fullName || linkedEmp.fullName;
      linkedEmp.phone = targetUser.profile?.phone || '';
      linkedEmp.email = targetUser.profile?.email || '';
      await linkedEmp.save(sessionOpt);
    }

    if (actor?._id) {
      await PlatformAuditLog.create(
        [
          {
            actorId: actor._id,
            actorUsername: actor.username || 'superadmin',
            action: 'UPDATE_SCHOOL_CONFIG',
            targetType: 'school_user',
            targetId: String(targetUser._id),
            details: {
              code: tenant.code,
              name: tenant.name,
              adminUsername: targetUser.username,
              role: targetUser.role,
              status: targetUser.status,
              passwordReset: Boolean(rawNewPass)
            }
          }
        ],
        sessionOpt
      );
    }

    return {
      school: { _id: tenant._id, code: tenant.code, name: tenant.name },
      account: {
        _id: targetUser._id,
        username: targetUser.username,
        role: targetUser.role,
        status: targetUser.status,
        profile: targetUser.profile,
        employeeCode: linkedEmp?.employeeCode || targetUser.employeeInfo?.employeeId || '',
        lastLogin: targetUser.lastLogin || null
      }
    };
  });

  invalidatePlatformDashboardCache();
  return updatedResult;
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
  listPlatformAuditLogs,
  listSchoolOperationalLogs,
  dispatchPlatformNotificationToSchools,
  listSchoolAccountsForSuperAdmin,
  createSchoolAccountBySuperAdmin,
  updateSchoolAccountBySuperAdmin
};

