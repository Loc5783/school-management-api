'use strict';

/**
 * @fileoverview Dịch vụ tự động kiểm tra và khởi tạo tài khoản Quản trị viên (`admin`) mặc định khi khởi chạy hệ thống.
 *
 * Quy tắc nghiệp vụ:
 * - Khi triển khai lên môi trường mới (Docker, VPS, Cloud) mà trong cơ sở dữ liệu chưa có bất kỳ tài khoản
 *   `role: 'admin'` nào, hệ thống tự động đồng bộ danh mục quyền (`Permission`), đảm bảo có cơ sở trường học
 *   mặc định (`DEFAULT_SCHOOL_CODE`, mặc định `HOANANG-A` ở chế độ SaaS Multi-Tenant) và tạo tài khoản
 *   `admin` / `123456`.
 * - Nếu trong DB đã có ít nhất một tài khoản `admin`, dịch vụ tuyệt đối giữ nguyên (không ghi đè mật khẩu
 *   hay tạo trùng lặp) để bảo vệ mật khẩu đã đổi trên môi trường vận hành thật.
 */

const bcrypt = require('bcryptjs');
const Tenant = require('../models/zone1_system/Tenant');
const Permission = require('../models/zone1_system/Permission');
const User = require('../models/zone1_system/User');
const PlatformAdmin = require('../models/zone1_system/PlatformAdmin');
const { generateTotpSecret, encryptTotpSecret } = require('../saas/utils/totpHelper');

const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = '123456';
const DEFAULT_SUPERADMIN_USERNAME = 'superadmin';
const DEFAULT_SUPERADMIN_PASSWORD = '123456';
const DEFAULT_SCHOOL_CODE = 'HOANANG-A';
const DEFAULT_SCHOOL_NAME = 'Trường Mầm non Hoa Nắng - Cơ sở A';
const BCRYPT_SALT_ROUNDS = 10;

// Danh mục đầy đủ 29 quyền chuẩn toàn hệ thống để cấp cho tài khoản admin mặc định
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
 * Tìm cơ sở trường học hiện có hoặc khởi tạo cơ sở mặc định cho chế độ SaaS Multi-Tenant.
 *
 * @param {string} defaultSchoolCode
 * @param {string} defaultSchoolName
 * @returns {Promise<{ _id: import('mongoose').Types.ObjectId, code: string, name: string }>}
 */
const resolveOrCreateTargetTenant = async (defaultSchoolCode, defaultSchoolName) => {
  await Tenant.createIndexes().catch(() => {});

  // Ưu tiên tìm theo mã trường mặc định trước
  const preferredTenant = await Tenant.findOne({ code: defaultSchoolCode })
    .select('_id code name status')
    .lean();
  if (preferredTenant) {
    return preferredTenant;
  }

  // Nếu DB đã có sẵn một trường đang hoạt động khác thì gắn admin vào trường đó
  const firstActiveTenant = await Tenant.findOne({ status: 'active' })
    .sort({ createdAt: 1 })
    .select('_id code name status')
    .lean();
  if (firstActiveTenant) {
    return firstActiveTenant;
  }

  // Nếu DB hoàn toàn chưa có trường học nào -> Khởi tạo trường mặc định (upsert chống race-condition)
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
 * Tự động tạo tài khoản `admin` (`123456`) nếu kiểm tra thấy DB chưa có tài khoản admin nào.
 *
 * @param {Object} [options]
 * @param {boolean} [options.useLegacyApp=false] - Chạy ở chế độ Legacy đơn trường (`tenantId: null`) hay SaaS Multi-Tenant
 * @returns {Promise<{ created: boolean, skipped?: boolean, schoolCode?: string | null, username?: string }>}
 */
/**
 * Đảm bảo có ít nhất 1 tài khoản Quản trị Tổng Hệ thống Đa Trường (`PlatformAdmin`, mặc định `superadmin` / `123456`)
 * để chủ chuỗi trường đăng nhập quản lý chung toàn bộ các trường và tạo account riêng cho từng trường.
 */
const ensureDefaultSuperAdminAccount = async () => {
  if (process.env.AUTO_CREATE_DEFAULT_ADMIN === 'false') return;
  const count = await PlatformAdmin.countDocuments({});
  if (count > 0) return;

  await PlatformAdmin.createIndexes().catch(() => {});
  const username = String(process.env.DEFAULT_SUPERADMIN_USERNAME || DEFAULT_SUPERADMIN_USERNAME).trim();
  const password = String(process.env.DEFAULT_SUPERADMIN_PASSWORD || DEFAULT_SUPERADMIN_PASSWORD);
  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  const fallbackMfaKey = process.env.PLATFORM_MFA_ENCRYPTION_KEY || process.env.JWT_SECRET || 'default_superadmin_totp_encryption_key_32chars';
  const encryptedTotp = encryptTotpSecret(generateTotpSecret(), fallbackMfaKey);

  await PlatformAdmin.findOneAndUpdate(
    { username },
    {
      $setOnInsert: {
        username,
        passwordHash,
        role: 'platform_lead',
        totpSecret: encryptedTotp.ciphertext,
        totpSecretIv: encryptedTotp.iv,
        totpSecretTag: encryptedTotp.tag,
        status: 'active',
        authVersion: 0
      }
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
  console.log(`✅ [Bootstrap SuperAdmin] Đã sẵn sàng tài khoản Quản trị Tổng Đa Trường (TK: ${username}).`);
};

const ensureDefaultAdminAccount = async (options = {}) => {
  if (process.env.AUTO_CREATE_DEFAULT_ADMIN === 'false') {
    return { created: false, skipped: true };
  }

  const useLegacyApp = Boolean(options.useLegacyApp ?? (process.env.USE_LEGACY_APP === 'true'));
  if (!useLegacyApp) {
    await ensureDefaultSuperAdminAccount().catch((err) => {
      console.warn('⚠️ [Bootstrap SuperAdmin] Không thể khởi tạo superadmin mặc định:', err.message);
    });
  }
  const adminUsername = String(process.env.DEFAULT_ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME).trim();
  const adminPassword = String(process.env.DEFAULT_ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD);
  const defaultSchoolCode = String(process.env.DEFAULT_SCHOOL_CODE || DEFAULT_SCHOOL_CODE).trim().toUpperCase();
  const defaultSchoolName = String(process.env.DEFAULT_SCHOOL_NAME || DEFAULT_SCHOOL_NAME).trim();

  // Bước 1: Kiểm tra nhanh bằng .lean() xem DB đã có tài khoản admin nào chưa
  const adminQuery = useLegacyApp
    ? { tenantId: { $in: [null, undefined] }, role: 'admin' }
    : { tenantId: { $ne: null }, role: 'admin' };

  const existingAdmin = await User.findOne(adminQuery)
    .select('_id username tenantId')
    .lean();

  if (existingAdmin) {
    return {
      created: false,
      username: existingAdmin.username
    };
  }

  // Bước 2: Đảm bảo index User và danh mục quyền hệ thống trước khi ghi
  await User.createIndexes().catch(() => {});
  const permissionIds = await ensureAllPermissions();
  const passwordHash = await bcrypt.hash(adminPassword, BCRYPT_SALT_ROUNDS);

  // Bước 3A: Chế độ Legacy (không dùng tenantId)
  if (useLegacyApp) {
    const conflictUser = await User.findOne({
      tenantId: { $in: [null, undefined] },
      username: adminUsername
    })
      .select('_id role')
      .lean();

    if (conflictUser && conflictUser.role !== 'admin') {
      console.warn(`⚠️ [Bootstrap Admin] Tên đăng nhập "${adminUsername}" đã tồn tại với vai trò "${conflictUser.role}", không thể tự tạo admin mặc định.`);
      return { created: false, skipped: true };
    }

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

  // Bước 3B: Chế độ chuẩn SaaS Multi-Tenant (gắn với cơ sở trường học)
  const targetTenant = await resolveOrCreateTargetTenant(defaultSchoolCode, defaultSchoolName);

  const conflictTenantUser = await User.findOne({
    tenantId: targetTenant._id,
    username: adminUsername
  })
    .select('_id role')
    .lean();

  if (conflictTenantUser && conflictTenantUser.role !== 'admin') {
    console.warn(`⚠️ [Bootstrap Admin] Tên đăng nhập "${adminUsername}" tại trường ${targetTenant.code} đã thuộc vai trò "${conflictTenantUser.role}", bỏ qua tạo tự động.`);
    return { created: false, skipped: true };
  }

  await User.findOneAndUpdate(
    { tenantId: targetTenant._id, username: adminUsername },
    {
      $setOnInsert: {
        tenantId: targetTenant._id,
        username: adminUsername,
        passwordHash,
        role: 'admin',
        permissions: permissionIds,
        profile: {
          fullName: 'Quản trị viên Hệ thống',
          phone: '0900000000',
          email: 'admin@hoanang.edu.vn'
        },
        status: 'active',
        authVersion: 0
      }
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );

  console.log(`✅ [Bootstrap Admin] DB chưa có admin -> Đã tự động tạo tài khoản quản trị mặc định (Mã trường: ${targetTenant.code} | TK: ${adminUsername}).`);
  return {
    created: true,
    schoolCode: targetTenant.code,
    username: adminUsername
  };
};

module.exports = {
  ensureDefaultAdminAccount,
  ensureAllPermissions
};

