'use strict';

/**
 * @fileoverview Dịch vụ tự động kiểm tra và khởi tạo tài khoản Quản trị Tổng (`admin`) mặc định khi khởi chạy hệ thống.
 *
 * Quy tắc nghiệp vụ thực tế (Multi-School SaaS):
 * 1. Ở chế độ chuẩn Đa Trường (`useLegacyApp = false`):
 *    - Hệ thống đồng bộ danh mục 29 quyền nền tảng (`Permission`).
 *    - Kiểm tra bảng Quản trị Tổng (`PlatformAdmin`): nếu chưa có tài khoản Admin Tổng nào, hệ thống tự động
 *      khởi tạo tài khoản Admin Tổng mặc định (`username: 'admin'`, mật khẩu `'123456'`, đăng nhập để trống Mã trường).
 *    - Hệ thống KHÔNG tự tạo sẵn trường học ảo; sau khi đăng nhập bằng tài khoản Admin Tổng (`admin`), người quản trị
 *      sẽ chủ động khởi tạo từng trường thực tế và cấp tài khoản Admin riêng cho từng trường tại giao diện `/multi-school`
 *      (trừ khi bật tường minh cờ `AUTO_CREATE_DEFAULT_SCHOOL=true`).
 * 2. Nếu trong DB đã có tài khoản Admin Tổng (`admin` hoặc tài khoản đã đổi tên/mật khẩu), dịch vụ tuyệt đối giữ nguyên,
 *    không ghi đè mật khẩu khi khởi động lại máy chủ.
 */

const bcrypt = require('bcryptjs');
const Tenant = require('../models/zone1_system/Tenant');
const Permission = require('../models/zone1_system/Permission');
const User = require('../models/zone1_system/User');
const PlatformAdmin = require('../models/zone1_system/PlatformAdmin');
const { generateTotpSecret, encryptTotpSecret } = require('../saas/utils/totpHelper');

const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = '123456';
const DEFAULT_SCHOOL_CODE = 'HOANANG-A';
const DEFAULT_SCHOOL_NAME = 'Trường Mầm non Hoa Nắng - Cơ sở A';
const BCRYPT_SALT_ROUNDS = 10;

// Danh mục đầy đủ 29 quyền chuẩn toàn hệ thống để cấp cho các tài khoản quản trị trường
const DEFAULT_PERMISSIONS_CATALOG = [
  { name: 'system.manage', module: 'system', resource: 'system', action: 'manage', description: 'Quản trị hệ thống' },
  { name: 'user.manage', module: 'system', resource: 'user', action: 'manage', description: 'Quản lý người dùng' },
  { name: 'student.read', module: 'school', resource: 'student', action: 'read', description: 'Xem danh sách học sinh' },
  { name: 'student.create', module: 'school', resource: 'student', action: 'create', description: 'Thêm học sinh' },
  { name: 'student.update', module: 'school', resource: 'student', action: 'update', description: 'Cập nhật học sinh' },
  { name: 'student.delete', module: 'school', resource: 'student', action: 'delete', description: 'Xóa học sinh' },
  { name: 'student.view_own', module: 'school', resource: 'student', action: 'view_own', description: 'Xem hồ sơ con' },
  { name: 'classroom.read', module: 'school', resource: 'classroom', action: 'read', description: 'Xem lớp học' },
  { name: 'classroom.manage', module: 'school', resource: 'classroom', action: 'manage', description: 'Quản lý lớp học' },
  { name: 'attendance.manage', module: 'school', resource: 'attendance', action: 'manage', description: 'Điểm danh học sinh' },
  { name: 'tuition.read', module: 'finance', resource: 'tuition', action: 'read', description: 'Xem học phí' },
  { name: 'tuition.create', module: 'finance', resource: 'tuition', action: 'create', description: 'Tạo hóa đơn học phí' },
  { name: 'tuition.update', module: 'finance', resource: 'tuition', action: 'update', description: 'Cập nhật hóa đơn' },
  { name: 'payment.create', module: 'finance', resource: 'payment', action: 'create', description: 'Ghi nhận thanh toán' },
  { name: 'finance.report', module: 'finance', resource: 'report', action: 'read', description: 'Báo cáo tài chính' },
  { name: 'menu.manage', module: 'nutrition', resource: 'menu', action: 'manage', description: 'Quản lý thực đơn' },
  { name: 'inventory.manage', module: 'nutrition', resource: 'inventory', action: 'manage', description: 'Quản lý kho bếp' },
  { name: 'ingredient.manage', module: 'nutrition', resource: 'ingredient', action: 'manage', description: 'Quản lý nguyên liệu' },
  { name: 'foodsample.manage', module: 'nutrition', resource: 'foodsample', action: 'manage', description: 'Lưu mẫu thức ăn' },
  { name: 'kitchen.equipment', module: 'nutrition', resource: 'equipment', action: 'manage', description: 'Thiết bị nhà bếp' },
  { name: 'kitchen.staff', module: 'nutrition', resource: 'staff', action: 'manage', description: 'Nhân sự nhà bếp' },
  { name: 'kitchen.financial', module: 'nutrition', resource: 'financial', action: 'read', description: 'Đối soát chi phí bếp' },
  { name: 'procurement.manage', module: 'procurement', resource: 'procurement', action: 'manage', description: 'Quản lý mua sắm' },
  { name: 'asset.manage', module: 'procurement', resource: 'asset', action: 'manage', description: 'Quản lý tài sản' },
  { name: 'attendance.correction', module: 'hr', resource: 'attendance', action: 'approve', description: 'Duyệt điều chỉnh công' },
  { name: 'employee.manage', module: 'hr', resource: 'employee', action: 'manage', description: 'Quản lý hồ sơ nhân sự' },
  { name: 'payroll.manage', module: 'hr', resource: 'payroll', action: 'manage', description: 'Quản lý bảng lương' },
  { name: 'report.read', module: 'report', resource: 'report', action: 'read', description: 'Xem báo cáo tổng hợp' },
  { name: 'report.manage', module: 'report', resource: 'report', action: 'manage', description: 'Quản lý báo cáo' }
];

/**
 * Đồng bộ danh mục quyền hệ thống bằng một lệnh `bulkWrite` duy nhất (tránh N+1 query).
 *
 * @returns {Promise<import('mongoose').Types.ObjectId[]>} Danh sách `_id` của toàn bộ quyền
 */
const ensureAllPermissions = async () => {
  await Permission.createIndexes().catch(() => {});

  const bulkOps = DEFAULT_PERMISSIONS_CATALOG.map((perm) => ({
    updateOne: {
      filter: { name: perm.name },
      update: { $setOnInsert: perm },
      upsert: true
    }
  }));

  await Permission.bulkWrite(bulkOps, { ordered: false });

  const docs = await Permission.find({}).select('_id').lean();
  return docs.map((doc) => doc._id);
};

/**
 * Tạo chuỗi khóa mã hóa TOTP hợp lệ (đủ >= 32 ký tự theo chuẩn AES-256-GCM của `totpHelper`).
 *
 * @returns {string}
 */
const resolveSafeMfaKey = () => {
  const rawKey = String(process.env.PLATFORM_MFA_ENCRYPTION_KEY || process.env.JWT_SECRET || '').trim();
  if (rawKey.length >= 32) {
    return rawKey;
  }
  return rawKey.padEnd(32, '0') || 'default_superadmin_totp_encryption_key_32chars';
};

/**
 * Đảm bảo DB luôn có tài khoản Quản trị Tổng Đa Trường (`PlatformAdmin`, mặc định `admin` / `123456`).
 *
 * Lưu ý chuyển tiếp an toàn:
 * - Nếu DB hoàn toàn chưa có `PlatformAdmin` nào -> Tạo `admin` / `123456`.
 * - Nếu DB chỉ mới có tài khoản `superadmin` tự sinh từ phiên bản trước mà chưa có `admin` -> Tự bổ sung `admin` / `123456`
 *   để người quản trị đăng nhập ngay bằng tài khoản `admin` (để trống Mã trường) mà không mất dữ liệu cũ.
 * - Nếu đã có `admin` (hoặc tài khoản Admin Tổng đã đổi tên/mật khẩu) -> Giữ nguyên tuyệt đối, không ghi đè mật khẩu.
 *
 * @param {string} adminUsername
 * @param {string} adminPassword
 * @returns {Promise<{ created: boolean, username: string }>}
 */
const ensureDefaultSuperAdminAccount = async (adminUsername, adminPassword) => {
  await PlatformAdmin.createIndexes().catch(() => {});

  const existingPlatformAdmins = await PlatformAdmin.find({})
    .select('_id username role')
    .lean();

  const hasTargetAdmin = existingPlatformAdmins.some((item) => item.username === adminUsername);
  const onlyLegacySuperadmin =
    existingPlatformAdmins.length === 1 &&
    existingPlatformAdmins[0].username === 'superadmin' &&
    adminUsername !== 'superadmin';

  // Nếu đã có tài khoản Admin Tổng hợp lệ (ngoài trường hợp chỉ có 'superadmin' cũ) -> Không ghi đè
  if (existingPlatformAdmins.length > 0 && (hasTargetAdmin || !onlyLegacySuperadmin)) {
    return {
      created: false,
      username: hasTargetAdmin ? adminUsername : existingPlatformAdmins[0].username
    };
  }

  const passwordHash = await bcrypt.hash(adminPassword, BCRYPT_SALT_ROUNDS);
  const encryptedTotp = encryptTotpSecret(generateTotpSecret(), resolveSafeMfaKey());
  const totpCiphertext = encryptedTotp.encrypted || encryptedTotp.ciphertext || '';

  await PlatformAdmin.findOneAndUpdate(
    { username: adminUsername },
    {
      $setOnInsert: {
        username: adminUsername,
        passwordHash,
        role: 'platform_lead',
        totpSecret: totpCiphertext,
        totpSecretIv: encryptedTotp.iv,
        totpSecretTag: encryptedTotp.tag,
        status: 'active',
        authVersion: 0
      }
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );

  console.log(
    `✅ [Bootstrap Admin Tổng] Đã sẵn sàng tài khoản Admin Tổng Đa Trường (TK: ${adminUsername} | Mã trường: để trống).`
  );
  return {
    created: true,
    username: adminUsername
  };
};

/**
 * Tìm cơ sở trường học hiện có hoặc khởi tạo cơ sở mặc định khi bật cờ `AUTO_CREATE_DEFAULT_SCHOOL=true`.
 *
 * @param {string} defaultSchoolCode
 * @param {string} defaultSchoolName
 * @returns {Promise<{ _id: import('mongoose').Types.ObjectId, code: string, name: string }>}
 */
const resolveOrCreateTargetTenant = async (defaultSchoolCode, defaultSchoolName) => {
  await Tenant.createIndexes().catch(() => {});

  const preferredTenant = await Tenant.findOne({ code: defaultSchoolCode })
    .select('_id code name status')
    .lean();
  if (preferredTenant) {
    return preferredTenant;
  }

  const createdTenant = await Tenant.findOneAndUpdate(
    { code: defaultSchoolCode },
    {
      $setOnInsert: {
        code: defaultSchoolCode,
        name: defaultSchoolName,
        status: 'active',
        authVersion: 0
      }
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  ).lean();

  return createdTenant;
};

/**
 * Khởi tạo tài khoản Quản trị mặc định khi máy chủ bắt đầu.
 * - SaaS Multi-Tenant (`useLegacyApp = false`): Tạo tài khoản Admin Tổng (`PlatformAdmin`: `admin` / `123456`).
 *   Các trường học và tài khoản Admin riêng của từng trường sẽ do Admin Tổng chủ động tạo trên giao diện `/multi-school`.
 * - Legacy đơn trường (`useLegacyApp = true`): Tạo tài khoản `User` (`tenantId: null`, `admin` / `123456`).
 *
 * @param {Object} [options]
 * @param {boolean} [options.useLegacyApp=false]
 * @param {boolean} [options.autoCreateDefaultSchool]
 * @returns {Promise<{ created: boolean, skipped?: boolean, isSuperAdmin?: boolean, schoolCode?: string | null, username?: string }>}
 */
const ensureDefaultAdminAccount = async (options = {}) => {
  if (process.env.AUTO_CREATE_DEFAULT_ADMIN === 'false') {
    return { created: false, skipped: true };
  }

  const useLegacyApp = Boolean(options.useLegacyApp ?? (process.env.USE_LEGACY_APP === 'true'));
  const adminUsername = String(
    process.env.DEFAULT_SUPERADMIN_USERNAME || process.env.DEFAULT_ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME
  ).trim();
  const adminPassword = String(
    process.env.DEFAULT_SUPERADMIN_PASSWORD || process.env.DEFAULT_ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD
  );

  // Luôn đồng bộ sẵn danh mục 29 quyền nền tảng để sẵn sàng khi Admin Tổng tạo trường mới
  const permissionIds = await ensureAllPermissions();

  // Chế độ 1: Legacy đơn trường (không dùng Multi-Tenant)
  if (useLegacyApp) {
    await User.createIndexes().catch(() => {});

    const existingLegacyAdmin = await User.findOne({
      tenantId: { $in: [null, undefined] },
      role: 'admin'
    })
      .select('_id username')
      .lean();

    if (existingLegacyAdmin) {
      return {
        created: false,
        schoolCode: null,
        username: existingLegacyAdmin.username
      };
    }

    const conflictUser = await User.findOne({
      tenantId: { $in: [null, undefined] },
      username: adminUsername
    })
      .select('_id role')
      .lean();

    if (conflictUser && conflictUser.role !== 'admin') {
      console.warn(
        `⚠️ [Bootstrap Admin] Tên đăng nhập "${adminUsername}" đã tồn tại với vai trò "${conflictUser.role}", không thể tự tạo admin mặc định.`
      );
      return { created: false, skipped: true };
    }

    const passwordHash = await bcrypt.hash(adminPassword, BCRYPT_SALT_ROUNDS);
    await User.findOneAndUpdate(
      { tenantId: null, username: adminUsername },
      {
        $setOnInsert: {
          tenantId: null,
          username: adminUsername,
          passwordHash,
          role: 'admin',
          permissions: permissionIds,
          profile: {
            fullName: 'Quản trị viên Hệ thống',
            phone: '0900000000',
            email: 'admin@school.local'
          },
          status: 'active',
          authVersion: 0
        }
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );

    console.log(`✅ [Bootstrap Admin] Chưa có tài khoản admin -> Đã tự động tạo tài khoản mặc định (TK: ${adminUsername}).`);
    return { created: true, schoolCode: null, username: adminUsername };
  }

  // Chế độ 2: Chuẩn SaaS Multi-Tenant — Tự động đảm bảo có tài khoản Admin Tổng (`admin`)
  const superAdminResult = await ensureDefaultSuperAdminAccount(adminUsername, adminPassword);

  // Chỉ tự tạo sẵn 1 trường mẫu nếu cấu hình yêu cầu tường minh (`AUTO_CREATE_DEFAULT_SCHOOL=true`)
  const shouldAutoCreateSchool = Boolean(
    options.autoCreateDefaultSchool ?? (process.env.AUTO_CREATE_DEFAULT_SCHOOL === 'true')
  );

  if (shouldAutoCreateSchool) {
    await User.createIndexes().catch(() => {});
    const defaultSchoolCode = String(process.env.DEFAULT_SCHOOL_CODE || DEFAULT_SCHOOL_CODE).trim().toUpperCase();
    const defaultSchoolName = String(process.env.DEFAULT_SCHOOL_NAME || DEFAULT_SCHOOL_NAME).trim();
    const targetTenant = await resolveOrCreateTargetTenant(defaultSchoolCode, defaultSchoolName);

    const existingSchoolAdmin = await User.findOne({ tenantId: targetTenant._id, role: 'admin' })
      .select('_id username')
      .lean();

    if (!existingSchoolAdmin) {
      const schoolAdminPassHash = await bcrypt.hash(adminPassword, BCRYPT_SALT_ROUNDS);
      await User.findOneAndUpdate(
        { tenantId: targetTenant._id, username: adminUsername },
        {
          $setOnInsert: {
            tenantId: targetTenant._id,
            username: adminUsername,
            passwordHash: schoolAdminPassHash,
            role: 'admin',
            permissions: permissionIds,
            profile: {
              fullName: `Quản trị viên ${targetTenant.name}`,
              phone: '0900000000',
              email: 'admin@hoanang.edu.vn'
            },
            status: 'active',
            authVersion: 0
          }
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      );
    }
  }

  return {
    created: superAdminResult.created,
    isSuperAdmin: true,
    schoolCode: null,
    username: superAdminResult.username
  };
};

module.exports = {
  ensureDefaultAdminAccount,
  ensureDefaultSuperAdminAccount,
  ensureAllPermissions
};
