'use strict';

/**
 * @fileoverview Bộ điều khiển Quản trị Tổng Hệ thống Đa Trường (`SuperAdmin Control Center`).
 *
 * Trách nhiệm:
 * - Xác thực & bảo mật tài khoản Quản trị Tổng (`PlatformAdmin`).
 * - Cung cấp Dashboard Hiệu năng, Sức khỏe Máy chủ & Báo cáo Tổng hợp các trường (`listAllSchoolsOverview`).
 * - Cung cấp Báo cáo Chi tiết 360° từng trường (`getSchoolDetailedReportHandler`).
 * - Khởi tạo trường mới kèm tài khoản Admin riêng, phân hệ chức năng (`enabledModules`) và hạn mức (`quotas`).
 * - Quản lý Cấu hình Chung Hệ thống (`SystemSetting`) và Nhật ký Kiểm toán (`PlatformAuditLog`).
 */

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const PlatformAdmin = require('../../models/zone1_system/PlatformAdmin');
const PlatformAuditLog = require('../../models/zone1_system/PlatformAuditLog');
const Tenant = require('../../models/zone1_system/Tenant');
const User = require('../../models/zone1_system/User');
const { ensureAllPermissions } = require('../../services/defaultAdminBootstrapService');
const {
  ALL_ENABLED_MODULES,
  sanitizeEnabledModules,
  getSystemSettings,
  updateSystemSettings,
  invalidatePlatformDashboardCache,
  getPlatformDashboardAndSchools,
  getPlatformGrowthAnalytics,
  getSchoolDetailedReport,
  listPlatformAuditLogs,
  listSchoolOperationalLogs,
  dispatchPlatformNotificationToSchools,
  listSchoolAccountsForSuperAdmin,
  createSchoolAccountBySuperAdmin,
  updateSchoolAccountBySuperAdmin
} = require('../../services/superAdminControlService');
const { simulateSchoolWebhookEvent } = require('../../services/timekeepingWebhookService');
const { generatePlatformAdminToken, generateSchoolUserToken } = require('../utils/saasJwt');
const { runSafeTransaction } = require('../../utils/safeTransaction');
const { isHoneypotTriggered } = require('../../middlewares/botScannerShield');

const TENANT_CODE_REGEX = /^[A-Z0-9_-]{3,20}$/;
const BCRYPT_SALT_ROUNDS = 10;

const parseQuotasInput = (rawQuotas, defaultStandards = {}) => {
  const maxCampuses = rawQuotas?.maxCampuses != null
    ? Number(rawQuotas.maxCampuses)
    : (defaultStandards.defaultMaxCampusesPerSchool || 10);
  const maxStudents = rawQuotas?.maxStudents != null
    ? Number(rawQuotas.maxStudents)
    : (defaultStandards.defaultMaxStudentsPerSchool || 800);
  const maxStaff = rawQuotas?.maxStaff != null
    ? Number(rawQuotas.maxStaff)
    : 200;

  if (!Number.isInteger(maxCampuses) || maxCampuses < 1 || maxCampuses > 100) {
    throw Object.assign(new Error('Hạn mức số phân hiệu tối đa phải là số nguyên từ 1 đến 100'), { statusCode: 422 });
  }
  if (!Number.isInteger(maxStudents) || maxStudents < 10 || maxStudents > 20000) {
    throw Object.assign(new Error('Hạn mức số học sinh tối đa phải là số nguyên từ 10 đến 20.000'), { statusCode: 422 });
  }
  if (!Number.isInteger(maxStaff) || maxStaff < 5 || maxStaff > 5000) {
    throw Object.assign(new Error('Hạn mức nhân sự tối đa phải là số nguyên từ 5 đến 5.000'), { statusCode: 422 });
  }

  return { maxCampuses, maxStudents, maxStaff };
};

const parseSaasBillingInput = (rawBilling, existingBilling = {}) => {
  if (!rawBilling || typeof rawBilling !== 'object') {
    return existingBilling || {};
  }
  const useCustomBasePrice = rawBilling.useCustomBasePrice !== undefined
    ? Boolean(rawBilling.useCustomBasePrice)
    : Boolean(existingBilling.useCustomBasePrice);
  const customBasePricePerStudentYear = useCustomBasePrice && rawBilling.customBasePricePerStudentYear != null && rawBilling.customBasePricePerStudentYear !== ''
    ? Math.max(0, Math.min(50000000, Math.round(Number(rawBilling.customBasePricePerStudentYear) || 0)))
    : (useCustomBasePrice ? (existingBilling.customBasePricePerStudentYear ?? 0) : null);

  const useCustomMinStudents = rawBilling.useCustomMinStudents !== undefined
    ? Boolean(rawBilling.useCustomMinStudents)
    : Boolean(existingBilling.useCustomMinStudents);
  const customMinBillableStudents = useCustomMinStudents && rawBilling.customMinBillableStudents != null && rawBilling.customMinBillableStudents !== ''
    ? Math.max(0, Math.min(5000, Math.round(Number(rawBilling.customMinBillableStudents) || 0)))
    : (useCustomMinStudents ? (existingBilling.customMinBillableStudents ?? 0) : null);

  const discountPercent = rawBilling.discountPercent != null && rawBilling.discountPercent !== ''
    ? Math.max(0, Math.min(100, Number(rawBilling.discountPercent) || 0))
    : (existingBilling.discountPercent || 0);

  const billingNote = rawBilling.billingNote != null
    ? String(rawBilling.billingNote).trim().slice(0, 300)
    : (existingBilling.billingNote || '');

  return {
    useCustomBasePrice,
    customBasePricePerStudentYear,
    useCustomMinStudents,
    customMinBillableStudents,
    discountPercent,
    billingNote
  };
};

/**
 * API công khai nhẹ trả về Thương hiệu, System Banner (lọc đúng mã trường nếu có chỉ định) & Chế độ bảo trì.
 */
const getPublicSystemMeta = async (req, res) => {
  try {
    const settings = await getSystemSettings();
    const rawSchoolCode = String(req.query?.schoolCode || '').trim().toUpperCase();
    const targetCodes = Array.isArray(settings.systemBanner?.targetSchoolCodes)
      ? settings.systemBanner.targetSchoolCodes
      : [];

    // Nếu Banner chỉ định danh sách trường cụ thể -> chỉ hiển thị cho đúng trường đó, không phát sang trường khác
    let bannerForSchool = settings.systemBanner;
    if (targetCodes.length > 0) {
      if (!rawSchoolCode || !targetCodes.includes(rawSchoolCode)) {
        bannerForSchool = { enabled: false, level: 'info', message: '', targetSchoolCodes: [] };
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        branding: settings.branding,
        systemBanner: bannerForSchool,
        maintenanceMode: settings.maintenanceMode,
        preschoolStandards: settings.preschoolStandards
      }
    });
  } catch {
    return res.status(200).json({
      success: true,
      data: {
        branding: { systemName: 'Nền tảng Quản lý Mầm non Hoa Nắng SaaS' },
        systemBanner: { enabled: false, level: 'info', message: '' },
        maintenanceMode: { enabled: false, message: '' },
        preschoolStandards: { defaultSchoolYear: '2026-2027' }
      }
    });
  }
};

/**
 * Đăng nhập cổng Quản trị Tổng Hệ thống Đa Trường (`Admin chung toàn bộ`).
 */
const loginSuperAdmin = async (req, res) => {
  try {
    if (isHoneypotTriggered(req)) {
      return res.status(403).json({
        success: false,
        code: 'BOT_DETECTED',
        message: 'Yêu cầu đăng nhập tự động bị từ chối.'
      });
    }

    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập tên đăng nhập và mật khẩu Quản trị Tổng'
      });
    }

    const admin = await PlatformAdmin.findOne({ username });
    if (!admin || admin.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'Tài khoản hoặc mật khẩu Quản trị Tổng không chính xác'
      });
    }

    const isMatch = await bcrypt.compare(password, admin.passwordHash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Tài khoản hoặc mật khẩu Quản trị Tổng không chính xác'
      });
    }

    const token = generatePlatformAdminToken(admin);
    return res.status(200).json({
      success: true,
      message: 'Đăng nhập Quản trị Tổng Hệ thống thành công',
      isSuperAdmin: true,
      token,
      user: {
        _id: admin._id,
        username: admin.username,
        role: 'superadmin',
        platformRole: admin.role,
        profile: {
          fullName: 'Quản trị Tổng Hệ thống (Đa trường)'
        }
      }
    });
  } catch (err) {
    console.error('Lỗi đăng nhập Quản trị Tổng:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi hệ thống khi đăng nhập Quản trị Tổng'
    });
  }
};

const getSuperAdminMe = async (req, res) => {
  return res.status(200).json({
    success: true,
    data: {
      _id: req.platformAdmin._id,
      username: req.platformAdmin.username,
      role: 'superadmin',
      platformRole: req.platformAdmin.role,
      profile: {
        fullName: 'Quản trị Tổng Hệ thống (Đa trường)'
      }
    }
  });
};

/**
 * Cho phép tài khoản Quản trị Tổng tự đổi mật khẩu và/hoặc tên đăng nhập.
 */
const changeSuperAdminPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, newUsername } = req.body || {};
    const settings = await getSystemSettings();
    const minLen = settings.securityPolicy?.minPasswordLength || 6;

    if (typeof currentPassword !== 'string' || !currentPassword) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập mật khẩu hiện tại của Admin Tổng'
      });
    }
    if (typeof newPassword !== 'string' || newPassword.length < minLen) {
      return res.status(422).json({
        success: false,
        message: `Mật khẩu mới của Admin Tổng phải từ ${minLen} ký tự trở lên`
      });
    }

    const admin = await PlatformAdmin.findById(req.platformAdmin._id);
    if (!admin || admin.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'Không tìm thấy phiên Quản trị Tổng hợp lệ'
      });
    }

    const isMatch = await bcrypt.compare(currentPassword, admin.passwordHash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Mật khẩu hiện tại không chính xác'
      });
    }

    if (newUsername != null && String(newUsername).trim() && String(newUsername).trim() !== admin.username) {
      const cleanNewUser = String(newUsername).trim();
      if (!/^[a-zA-Z0-9._-]{3,50}$/.test(cleanNewUser)) {
        return res.status(422).json({
          success: false,
          message: 'Tên đăng nhập mới chỉ gồm chữ không dấu, số, dấu chấm/gạch (3–50 ký tự)'
        });
      }
      const duplicate = await PlatformAdmin.exists({
        username: cleanNewUser,
        _id: { $ne: admin._id }
      });
      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: `Tên đăng nhập "${cleanNewUser}" đã tồn tại`
        });
      }
      admin.username = cleanNewUser;
    }

    admin.passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    admin.authVersion = (admin.authVersion || 0) + 1;
    await admin.save();

    await PlatformAuditLog.create({
      actorId: admin._id,
      actorUsername: admin.username,
      action: 'UPDATE_SUPERADMIN_CREDENTIALS',
      targetType: 'platform_admin',
      targetId: String(admin._id),
      details: { username: admin.username }
    });

    const freshToken = generatePlatformAdminToken(admin);
    return res.status(200).json({
      success: true,
      message: 'Đã cập nhật thông tin bảo mật tài khoản Admin Tổng thành công',
      token: freshToken,
      user: {
        _id: admin._id,
        username: admin.username,
        role: 'superadmin',
        platformRole: admin.role,
        profile: {
          fullName: 'Quản trị Tổng Hệ thống (Đa trường)'
        }
      }
    });
  } catch (err) {
    console.error('Lỗi đổi mật khẩu Admin Tổng:', err);
    return res.status(500).json({
      success: false,
      message: 'Không thể cập nhật mật khẩu Admin Tổng'
    });
  }
};

/**
 * Trả về toàn bộ Dashboard Hiệu năng, Cảnh báo, Sức khỏe Hệ thống & Danh sách Trường học.
 */
const listAllSchoolsOverview = async (req, res) => {
  try {
    const dashboardData = await getPlatformDashboardAndSchools();
    return res.json({
      success: true,
      data: dashboardData
    });
  } catch (err) {
    console.error('Lỗi tải Dashboard hệ thống đa trường:', err);
    return res.status(500).json({ success: false, message: 'Không thể tải dữ liệu điều hành hệ thống trường học' });
  }
};

/**
 * Trả về Báo cáo Tổng kết Tăng trưởng Nền tảng SaaS theo khung thời gian (`7d` | `30d` | `6m` | `12m`).
 */
const getPlatformGrowthReportHandler = async (req, res) => {
  try {
    const range = String(req.query?.range || '12m').trim();
    const data = await getPlatformGrowthAnalytics({ range });
    return res.json({
      success: true,
      data
    });
  } catch (err) {
    console.error('Lỗi tổng hợp báo cáo tăng trưởng SaaS:', err);
    return res.status(500).json({
      success: false,
      message: 'Không thể tải báo cáo tăng trưởng nền tảng SaaS'
    });
  }
};

/**
 * Trả về Báo cáo Chi tiết 360° của một trường cụ thể cho SuperAdmin.
 */
const getSchoolDetailedReportHandler = async (req, res) => {
  try {
    const report = await getSchoolDetailedReport(req.params.id);
    return res.json({
      success: true,
      data: report
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Không thể tải báo cáo chi tiết trường học'
    });
  }
};

/**
 * Đọc Cấu hình Chung Hệ thống cho SuperAdmin.
 */
const getSystemSettingsHandler = async (req, res) => {
  try {
    const settings = await getSystemSettings({ bypassCache: true });
    return res.json({
      success: true,
      data: settings
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: 'Không thể tải cấu hình chung hệ thống'
    });
  }
};

/**
 * Lưu Cấu hình Chung Hệ thống do SuperAdmin chỉnh sửa.
 */
const updateSystemSettingsHandler = async (req, res) => {
  try {
    const updated = await updateSystemSettings(req.body || {}, req.platformAdmin);
    return res.json({
      success: true,
      message: 'Đã lưu cấu hình chung toàn hệ thống thành công',
      data: updated
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Không thể lưu cấu hình chung hệ thống'
    });
  }
};

/**
 * Xem Nhật ký Hoạt động & Bảo mật cấp Hệ thống (`PlatformAuditLog`).
 */
const listPlatformAuditLogsHandler = async (req, res) => {
  try {
    const result = await listPlatformAuditLogs(req.query || {});
    return res.json({
      success: true,
      data: result.items,
      pagination: result.pagination
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: 'Không thể tải nhật ký kiểm toán hệ thống'
    });
  }
};

/**
 * Xem Nhật ký Hoạt động chi tiết của Từng Trường (`AuditLog` nội bộ trường, `TimekeepingWebhookLog` hoặc `AttendanceAuditLog`).
 */
const listSchoolOperationalLogsHandler = async (req, res) => {
  try {
    const result = await listSchoolOperationalLogs(req.query || {});
    return res.json({
      success: true,
      data: result.items,
      pagination: result.pagination
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Không thể tải nhật ký hoạt động của trường'
    });
  }
};

/**
 * SuperAdmin gửi thông báo Hệ thống / Cấp phép / Kỹ thuật tới riêng 1 trường cụ thể (hoặc tất cả trường đang hoạt động).
 */
const dispatchSchoolNotificationHandler = async (req, res) => {
  try {
    const out = await dispatchPlatformNotificationToSchools(req.body || {}, req.platformAdmin);
    const targetDesc = out.targetScope === 'single'
      ? `trường ${out.schools[0]?.name} (${out.schools[0]?.code})`
      : `${out.schoolCount} trường đang hoạt động`;
    return res.status(201).json({
      success: true,
      message: `Đã gửi thông báo hệ thống tới ${out.recipientCount} tài khoản quản lý của ${targetDesc}.`,
      data: out
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Không thể gửi thông báo tới trường'
    });
  }
};

/**
 * Hỗ trợ SuperAdmin gửi gói tin kiểm tra luồng Webhook chấm công / điểm danh theo mã trường (`/api/attendance/webhook/:schoolCode`).
 */
const testSchoolWebhookBySuperAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'ID trường học không hợp lệ' });
    }
    const tenant = await Tenant.findById(id).select('code name status').lean();
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy trường học' });
    }
    if (tenant.status !== 'active') {
      return res.status(422).json({ success: false, message: 'Trường đang tạm ngưng, không thể gửi sự kiện chấm công' });
    }

    const { externalPersonId, personName, verifyMode, occurredAt } = req.body || {};
    const out = await simulateSchoolWebhookEvent({
      schoolCode: tenant.code,
      externalPersonId,
      personName,
      verifyMode,
      occurredAt,
      deviceCode: 'SUPERADMIN-WEBHOOK-TEST',
      sourceIp: req.ip || '127.0.0.1'
    });

    invalidatePlatformDashboardCache();

    return res.status(200).json({
      success: true,
      message: out.record?.processingNote || `Đã kiểm tra Webhook cho trường ${tenant.code}`,
      data: {
        schoolCode: tenant.code,
        endpointPath: `/api/attendance/webhook/${tenant.code}`,
        logId: out.savedId,
        processingStatus: out.record?.processingStatus,
        processingNote: out.record?.processingNote,
        attendanceResult: out.attendanceResult
      }
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Không thể kiểm tra Webhook chấm công của trường'
    });
  }
};

/**
 * Tạo mới một Trường học kèm khởi tạo tự động 1 Tài khoản Admin riêng, danh mục Phân hiệu, Module và Hạn mức.
 */
const createSchoolWithAdmin = async (req, res) => {
  try {
    const settings = await getSystemSettings();
    const minPassLen = settings.securityPolicy?.minPasswordLength || 6;

    const {
      code,
      name,
      organizationCode = '',
      contactEmail = '',
      contactPhone = '',
      address = '',
      representativeName = '',
      subscriptionPlan = 'professional',
      licenseExpiresAt = null,
      adminUsername,
      adminPassword,
      adminFullName = '',
      adminPhone = '',
      adminEmail = '',
      initialCampuses = [],
      enabledModules,
      quotas: rawQuotas,
      saasBilling: rawSaasBilling
    } = req.body || {};

    const cleanCode = String(code || '').trim().toUpperCase();
    const cleanName = String(name || '').trim();
    const cleanAdminUser = String(adminUsername || 'admin').trim();
    const cleanAdminPass = String(adminPassword || '');

    if (!TENANT_CODE_REGEX.test(cleanCode)) {
      return res.status(422).json({
        success: false,
        message: 'Mã trường chỉ gồm chữ in hoa, chữ số, gạch nối/dưới (3–20 ký tự, ví dụ: HOANANG-B)'
      });
    }
    if (cleanName.length < 2 || cleanName.length > 160) {
      return res.status(422).json({
        success: false,
        message: 'Tên trường phải có từ 2 đến 160 ký tự'
      });
    }
    if (!/^[a-zA-Z0-9._-]{3,50}$/.test(cleanAdminUser)) {
      return res.status(422).json({
        success: false,
        message: 'Tên đăng nhập tài khoản Admin trường chỉ gồm chữ không dấu, số, dấu chấm/gạch (3–50 ký tự)'
      });
    }
    if (cleanAdminPass.length < minPassLen) {
      return res.status(422).json({
        success: false,
        message: `Mật khẩu tài khoản Admin trường phải từ ${minPassLen} ký tự trở lên`
      });
    }
    const cleanEmail = String(contactEmail || '').trim().toLowerCase();
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(422).json({
        success: false,
        message: 'Email liên hệ của trường không đúng định dạng'
      });
    }

    const cleanPhone = String(contactPhone || adminPhone || '').trim().slice(0, 25);
    const cleanAddress = String(address || '').trim().slice(0, 300);
    const cleanRepName = String(representativeName || adminFullName || '').trim().slice(0, 120);
    const validPlans = ['trial', 'standard', 'professional', 'enterprise'];
    const cleanPlan = validPlans.includes(subscriptionPlan) ? subscriptionPlan : 'professional';
    const parsedLicenseExpires = licenseExpiresAt ? new Date(licenseExpiresAt) : null;
    const safeLicenseExpires =
      parsedLicenseExpires && !Number.isNaN(parsedLicenseExpires.getTime()) ? parsedLicenseExpires : null;

    const quotas = parseQuotasInput(rawQuotas, settings.preschoolStandards);
    const cleanModules = Array.isArray(enabledModules)
      ? sanitizeEnabledModules(enabledModules, { preserveExplicitSelection: true })
      : [...ALL_ENABLED_MODULES];
    const permissionIds = await ensureAllPermissions();
    const passwordHash = await bcrypt.hash(cleanAdminPass, BCRYPT_SALT_ROUNDS);

    const defaultOpen = settings.preschoolStandards?.standardCheckInTime || '07:00';
    const defaultClose = settings.preschoolStandards?.standardCheckOutTime || '16:30';

    const seenNames = new Set();
    const seenCodes = new Set();
    const parsedCampuses = [];
    if (Array.isArray(initialCampuses)) {
      initialCampuses.forEach((item, idx) => {
        const cName = (typeof item === 'string' ? item.trim() : String(item?.name || '').trim()).slice(0, 120);
        if (!cName || seenNames.has(cName.toLowerCase())) return;
        seenNames.add(cName.toLowerCase());
        let rawCampusCode = (typeof item === 'object' && item?.code)
          ? String(item.code).trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 16)
          : '';
        let cCode = rawCampusCode.length >= 2
          ? rawCampusCode
          : (cName.toLowerCase() === 'cơ sở chính' ? 'CS-CHINH' : `PH-${idx + 1}`);
        while (seenCodes.has(cCode)) {
          cCode = `${cCode.slice(0, 16)}-${parsedCampuses.length + 1}`;
        }
        seenCodes.add(cCode);
        parsedCampuses.push({
          code: cCode,
          name: cName,
          address: (typeof item === 'object' && item?.address) ? String(item.address).trim().slice(0, 300) : (idx === 0 ? cleanAddress : ''),
          phone: (typeof item === 'object' && item?.phone) ? String(item.phone).trim().slice(0, 20) : (idx === 0 ? cleanPhone : ''),
          managerName: (typeof item === 'object' && item?.managerName) ? String(item.managerName).trim().slice(0, 120) : (idx === 0 ? cleanRepName : ''),
          openTime: defaultOpen,
          closeTime: defaultClose,
          maxClassrooms: 20,
          notes: '',
          isActive: true
        });
      });
    }

    if (!parsedCampuses.length) {
      parsedCampuses.push({
        code: 'CS-CHINH',
        name: 'Cơ sở chính',
        address: cleanAddress,
        phone: cleanPhone,
        managerName: cleanRepName,
        openTime: defaultOpen,
        closeTime: defaultClose,
        maxClassrooms: 20,
        notes: '',
        isActive: true
      });
    }

    if (parsedCampuses.length > quotas.maxCampuses) {
      return res.status(422).json({
        success: false,
        message: `Số phân hiệu ban đầu (${parsedCampuses.length}) vượt quá hạn mức tối đa đã cấp (${quotas.maxCampuses})`
      });
    }

    const { createdSchool, createdAdmin } = await runSafeTransaction(async (session) => {
      const sessionOpt = session ? { session } : undefined;
      const existing = await Tenant.findOne({ code: cleanCode }).session(session);
      if (existing) {
        throw Object.assign(new Error(`Mã trường "${cleanCode}" đã tồn tại trên hệ thống`), { statusCode: 409 });
      }

      const [tenant] = await Tenant.create(
        [
          {
            code: cleanCode,
            name: cleanName,
            organizationCode: String(organizationCode || '').trim().toUpperCase().slice(0, 40),
            contactEmail: cleanEmail,
            contactPhone: cleanPhone,
            address: cleanAddress,
            representativeName: cleanRepName,
            subscriptionPlan: cleanPlan,
            licenseExpiresAt: safeLicenseExpires,
            campuses: parsedCampuses,
            enabledModules: cleanModules,
            quotas,
            saasBilling: parseSaasBillingInput(rawSaasBilling),
            config: { moduleGateConfigured: true },
            status: 'active',
            authVersion: 0
          }
        ],
        sessionOpt
      );

      const cleanAdminEmail = String(adminEmail || cleanEmail || '').trim().toLowerCase();
      const [schoolAdmin] = await User.create(
        [
          {
            tenantId: tenant._id,
            username: cleanAdminUser,
            passwordHash,
            role: 'admin',
            permissions: permissionIds,
            profile: {
              fullName: String(adminFullName || cleanRepName || '').trim() || `Quản trị viên ${cleanName}`,
              phone: String(adminPhone || cleanPhone || '').trim(),
              email: cleanAdminEmail
            },
            status: 'active',
            authVersion: 0
          }
        ],
        sessionOpt
      );

      await PlatformAuditLog.create(
        [
          {
            actorId: req.platformAdmin._id,
            actorUsername: req.platformAdmin.username,
            action: 'CREATE_SCHOOL_WITH_ADMIN',
            targetType: 'tenant',
            targetId: String(tenant._id),
            details: {
              code: tenant.code,
              name: tenant.name,
              adminUsername: schoolAdmin.username,
              campusCount: parsedCampuses.length,
              enabledModulesCount: cleanModules.length,
              quotas
            }
          }
        ],
        sessionOpt
      );

      return { createdSchool: tenant, createdAdmin: schoolAdmin };
    });

    invalidatePlatformDashboardCache();

    return res.status(201).json({
      success: true,
      message: `Đã tạo trường "${cleanName}" (${cleanCode}) kèm tài khoản quản trị riêng @${cleanAdminUser}`,
      data: {
        school: createdSchool,
        adminAccount: {
          _id: createdAdmin._id,
          username: createdAdmin.username,
          fullName: createdAdmin.profile?.fullName
        }
      }
    });
  } catch (err) {
    console.error('Lỗi tạo trường học mới:', err);
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Mã trường hoặc tài khoản quản trị bị trùng lặp' });
    }
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Không thể tạo trường học mới'
    });
  }
};

/**
 * Cập nhật thông tin cấp Trường, Trạng thái, Gói Module, Hạn mức & Tài khoản Admin riêng của trường.
 */
const updateSchoolAndAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'ID trường học không hợp lệ' });
    }

    const settings = await getSystemSettings();
    const minPassLen = settings.securityPolicy?.minPasswordLength || 6;

    const {
      name,
      organizationCode,
      contactEmail,
      contactPhone,
      address,
      representativeName,
      subscriptionPlan,
      licenseExpiresAt,
      status,
      adminUsername,
      adminFullName,
      adminPhone,
      newAdminPassword,
      enabledModules,
      quotas: rawQuotas,
      saasBilling: rawSaasBilling
    } = req.body || {};

    const resultData = await runSafeTransaction(async (session) => {
      const sessionOpt = session ? { session } : undefined;
      const tenant = await Tenant.findById(id).session(session);
      if (!tenant) throw Object.assign(new Error('Không tìm thấy trường học'), { statusCode: 404 });

      if (name != null) {
        const cleanName = String(name).trim();
        if (cleanName.length < 2) throw Object.assign(new Error('Tên trường tối thiểu 2 ký tự'), { statusCode: 422 });
        tenant.name = cleanName;
      }
      if (organizationCode != null) {
        tenant.organizationCode = String(organizationCode).trim().toUpperCase().slice(0, 40);
      }
      if (contactEmail != null) {
        const cleanEmail = String(contactEmail).trim().toLowerCase();
        if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
          throw Object.assign(new Error('Email liên hệ của trường không đúng định dạng'), { statusCode: 422 });
        }
        tenant.contactEmail = cleanEmail;
      }
      if (contactPhone != null) {
        tenant.contactPhone = String(contactPhone).trim().slice(0, 25);
        if (Array.isArray(tenant.campuses) && tenant.campuses[0] && !tenant.campuses[0].phone) {
          tenant.campuses[0].phone = tenant.contactPhone;
        }
      }
      if (address != null) {
        tenant.address = String(address).trim().slice(0, 300);
        if (Array.isArray(tenant.campuses) && tenant.campuses[0] && !tenant.campuses[0].address) {
          tenant.campuses[0].address = tenant.address;
        }
      }
      if (representativeName != null) {
        tenant.representativeName = String(representativeName).trim().slice(0, 120);
        if (Array.isArray(tenant.campuses) && tenant.campuses[0] && !tenant.campuses[0].managerName) {
          tenant.campuses[0].managerName = tenant.representativeName;
        }
      }
      if (subscriptionPlan != null && ['trial', 'standard', 'professional', 'enterprise'].includes(subscriptionPlan)) {
        tenant.subscriptionPlan = subscriptionPlan;
      }
      if (licenseExpiresAt !== undefined) {
        if (!licenseExpiresAt) {
          tenant.licenseExpiresAt = null;
        } else {
          const parsedExp = new Date(licenseExpiresAt);
          if (!Number.isNaN(parsedExp.getTime())) {
            tenant.licenseExpiresAt = parsedExp;
          }
        }
      }
      if (status != null) {
        if (!['active', 'suspended', 'terminated'].includes(status)) {
          throw Object.assign(new Error('Trạng thái trường không hợp lệ'), { statusCode: 422 });
        }
        if (tenant.status !== status) {
          tenant.status = status;
          tenant.authVersion = (tenant.authVersion || 0) + 1;
        }
      }
      if (Array.isArray(enabledModules)) {
        tenant.enabledModules = sanitizeEnabledModules(enabledModules, { preserveExplicitSelection: true });
        tenant.config = { ...(tenant.config || {}), moduleGateConfigured: true };
        tenant.markModified('config');
      }
      if (rawQuotas && typeof rawQuotas === 'object') {
        const mergedQuotas = parseQuotasInput(
          {
            maxCampuses: rawQuotas.maxCampuses ?? tenant.quotas?.maxCampuses,
            maxStudents: rawQuotas.maxStudents ?? tenant.quotas?.maxStudents,
            maxStaff: rawQuotas.maxStaff ?? tenant.quotas?.maxStaff
          },
          settings.preschoolStandards
        );
        tenant.quotas = mergedQuotas;
      }
      if (rawSaasBilling && typeof rawSaasBilling === 'object') {
        tenant.saasBilling = parseSaasBillingInput(rawSaasBilling, tenant.saasBilling?.toObject?.() || tenant.saasBilling || {});
      }
      await tenant.save(sessionOpt);

      const cleanNextAdminUser = adminUsername != null ? String(adminUsername).trim() : '';
      const cleanNewPass = newAdminPassword != null ? String(newAdminPassword).trim() : '';

      if (cleanNextAdminUser && (cleanNextAdminUser.length < 3 || cleanNextAdminUser.length > 50 || /\s/.test(cleanNextAdminUser))) {
        throw Object.assign(new Error('Tên đăng nhập Admin trường phải từ 3–50 ký tự và không chứa khoảng trắng'), { statusCode: 422 });
      }
      if (cleanNewPass && cleanNewPass.length < minPassLen) {
        throw Object.assign(new Error(`Mật khẩu mới của Admin trường phải từ ${minPassLen} ký tự trở lên`), { statusCode: 422 });
      }

      if (cleanNextAdminUser || cleanNewPass || adminFullName != null || adminPhone != null) {
        const adminUser = await User.findOne({ tenantId: tenant._id, role: 'admin' }).sort({ createdAt: 1 }).session(session);
        if (adminUser) {
          if (cleanNextAdminUser && cleanNextAdminUser !== adminUser.username) {
            const dup = await User.exists({
              tenantId: tenant._id,
              username: cleanNextAdminUser,
              _id: { $ne: adminUser._id }
            }).session(session);
            if (dup) {
              throw Object.assign(new Error(`Tên đăng nhập "@${cleanNextAdminUser}" đã được sử dụng trong trường này`), { statusCode: 409 });
            }
            adminUser.username = cleanNextAdminUser;
          }
          if (adminFullName != null && String(adminFullName).trim()) {
            adminUser.profile.fullName = String(adminFullName).trim().slice(0, 120);
          }
          if (adminPhone != null) {
            adminUser.profile.phone = String(adminPhone).trim().slice(0, 25);
          }
          if (cleanNewPass) {
            adminUser.passwordHash = await bcrypt.hash(cleanNewPass, BCRYPT_SALT_ROUNDS);
            adminUser.status = 'active';
            adminUser.authVersion = (adminUser.authVersion || 0) + 1;
          }
          await adminUser.save(sessionOpt);
        } else if (cleanNewPass) {
          const targetUsername = cleanNextAdminUser || 'admin';
          const dup = await User.exists({ tenantId: tenant._id, username: targetUsername }).session(session);
          if (dup) {
            throw Object.assign(new Error(`Tên đăng nhập "@${targetUsername}" đã thuộc về nhân sự khác trong trường`), { statusCode: 409 });
          }
          const permissionIds = await ensureAllPermissions();
          const passwordHash = await bcrypt.hash(cleanNewPass, BCRYPT_SALT_ROUNDS);
          await User.create(
            [
              {
                tenantId: tenant._id,
                username: targetUsername,
                passwordHash,
                role: 'admin',
                permissions: permissionIds,
                profile: { fullName: `Quản trị viên ${tenant.name}` },
                status: 'active',
                authVersion: 0
              }
            ],
            sessionOpt
          );
        }
      }

      await PlatformAuditLog.create(
        [
          {
            actorId: req.platformAdmin._id,
            actorUsername: req.platformAdmin.username,
            action: 'UPDATE_SCHOOL_CONFIG',
            targetType: 'tenant',
            targetId: String(tenant._id),
            details: {
              code: tenant.code,
              status: tenant.status,
              enabledModulesCount: tenant.enabledModules?.length,
              quotas: tenant.quotas,
              passwordReset: Boolean(cleanNewPass)
            }
          }
        ],
        sessionOpt
      );

      return tenant;
    });

    invalidatePlatformDashboardCache();

    return res.json({
      success: true,
      message: 'Đã cập nhật cấu hình trường học & phân hệ thành công',
      data: resultData
    });
  } catch (err) {
    console.error('Lỗi cập nhật trường học:', err);
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Tên đăng nhập quản trị trường bị trùng lặp' });
    }
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Không thể cập nhật thông tin trường học'
    });
  }
};

/**
 * Cho phép Quản trị Tổng chuyển ngữ cảnh vào điều hành trực tiếp một trường cụ thể khi cần hỗ trợ.
 */
const enterSchoolWorkspace = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'ID trường học không hợp lệ' });
    }

    const tenant = await Tenant.findById(id);
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy trường học' });
    }
    if (tenant.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Trường học đang tạm ngưng hoạt động. Vui lòng kích hoạt lại trường trước khi truy cập.'
      });
    }

    let schoolAdmin = await User.findOne({ tenantId: tenant._id, role: 'admin', status: 'active' }).sort({ createdAt: 1 });
    if (!schoolAdmin) {
      const inactiveAdmin = await User.findOne({ tenantId: tenant._id, role: 'admin' }).sort({ createdAt: 1 });
      if (inactiveAdmin) {
        inactiveAdmin.status = 'active';
        await inactiveAdmin.save();
        schoolAdmin = inactiveAdmin;
      } else {
        const permissionIds = await ensureAllPermissions();
        const defaultHash = await bcrypt.hash('123456', BCRYPT_SALT_ROUNDS);
        const fallbackUsername = (await User.exists({ tenantId: tenant._id, username: 'admin' }))
          ? `admin_${String(tenant.code || 'school').toLowerCase()}`
          : 'admin';
        schoolAdmin = await User.create({
          tenantId: tenant._id,
          username: fallbackUsername,
          passwordHash: defaultHash,
          role: 'admin',
          permissions: permissionIds,
          profile: { fullName: `Quản trị viên ${tenant.name}` },
          status: 'active',
          authVersion: 0
        });
      }
    }

    const schoolToken = generateSchoolUserToken(schoolAdmin, tenant, '4h', {
      isVendorSupport: true,
      vendorUsername: req.platformAdmin.username
    });
    await PlatformAuditLog.create({
      actorId: req.platformAdmin._id,
      actorUsername: req.platformAdmin.username,
      action: 'ENTER_SCHOOL_WORKSPACE',
      targetType: 'tenant',
      targetId: String(tenant._id),
      details: { code: tenant.code, asSchoolAdmin: schoolAdmin.username }
    });

    const resolvedModules = tenant.config?.moduleGateConfigured
      ? sanitizeEnabledModules(tenant.enabledModules)
      : [...ALL_ENABLED_MODULES];

    return res.json({
      success: true,
      message: `Đang chuyển vào không gian cấu hình & bàn giao của ${tenant.name}`,
      token: schoolToken,
      tenant: {
        _id: tenant._id,
        id: tenant._id,
        code: tenant.code,
        name: tenant.name,
        status: tenant.status,
        enabledModules: resolvedModules,
        moduleGateConfigured: Boolean(tenant.config?.moduleGateConfigured),
        quotas: tenant.quotas || { maxCampuses: 10, maxStudents: 800, maxStaff: 200 }
      },
      user: {
        _id: schoolAdmin._id,
        username: schoolAdmin.username,
        role: schoolAdmin.role,
        profile: schoolAdmin.profile,
        tenantId: tenant._id,
        schoolCode: tenant.code,
        isVendorSupport: true,
        vendorUsername: req.platformAdmin.username
      }
    });
  } catch (err) {
    console.error('Lỗi truy cập không gian trường:', err);
    return res.status(500).json({ success: false, message: 'Không thể chuyển vào quản lý trường học này' });
  }
};

/**
 * Xem danh sách toàn bộ Tài khoản thuộc phạm vi 1 trường cụ thể (`tenantId`) để SuperAdmin quản lý & hỗ trợ.
 */
const listSchoolAccountsHandler = async (req, res) => {
  try {
    const result = await listSchoolAccountsForSuperAdmin(req.params.id, req.query || {});
    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Không thể tải danh sách tài khoản của trường'
    });
  }
};

/**
 * SuperAdmin cấp mới Tài khoản Admin riêng (hoặc tài khoản nhân sự hỗ trợ) cho 1 trường cụ thể.
 */
const createSchoolAccountHandler = async (req, res) => {
  try {
    const created = await createSchoolAccountBySuperAdmin(req.params.id, req.body || {}, req.platformAdmin);
    return res.status(201).json({
      success: true,
      message: `Đã cấp tài khoản @${created.account.username} cho trường ${created.school.code}`,
      data: created
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Tên đăng nhập đã tồn tại trong phạm vi trường này'
      });
    }
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Không thể tạo tài khoản mới cho trường'
    });
  }
};

/**
 * SuperAdmin cập nhật thông tin, đổi mật khẩu hoặc khóa/mở khóa 1 tài khoản thuộc trường.
 */
const updateSchoolAccountHandler = async (req, res) => {
  try {
    const updated = await updateSchoolAccountBySuperAdmin(
      req.params.id,
      req.params.accountId,
      req.body || {},
      req.platformAdmin
    );
    return res.status(200).json({
      success: true,
      message: `Đã cập nhật tài khoản @${updated.account.username} của trường ${updated.school.code}`,
      data: updated
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Tên đăng nhập đã bị trùng trong phạm vi trường này'
      });
    }
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Không thể cập nhật tài khoản của trường'
    });
  }
};

module.exports = {
  getPublicSystemMeta,
  loginSuperAdmin,
  getSuperAdminMe,
  changeSuperAdminPassword,
  listAllSchoolsOverview,
  getPlatformGrowthReportHandler,
  getSchoolDetailedReportHandler,
  getSystemSettingsHandler,
  updateSystemSettingsHandler,
  listPlatformAuditLogsHandler,
  listSchoolOperationalLogsHandler,
  dispatchSchoolNotificationHandler,
  testSchoolWebhookBySuperAdmin,
  createSchoolWithAdmin,
  updateSchoolAndAdmin,
  enterSchoolWorkspace,
  listSchoolAccountsHandler,
  createSchoolAccountHandler,
  updateSchoolAccountHandler
};
