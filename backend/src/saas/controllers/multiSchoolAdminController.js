'use strict';

/**
 * @fileoverview Bộ điều khiển Quản trị Tổng Hệ thống Đa Trường (`Admin Chung Toàn Bộ`).
 *
 * Đáp ứng các yêu cầu nghiệp vụ cốt lõi:
 * 1. "admin là quản lý: chung toàn bộ / từng trường":
 *    - Quản trị Tổng (`PlatformAdmin`) xem tổng quan tất cả các trường trong hệ thống và có thể bấm
 *      "Vào quản lý trường" (`enterSchoolWorkspace`) để điều hành chi tiết từng trường, sau đó quay lại bảng tổng.
 * 2. "Mỗi trường 1 account riêng":
 *    - Khi tạo trường mới (`createSchoolWithAdmin`), hệ thống khởi tạo nguyên tử trong cùng Transaction:
 *      Hồ sơ Trường (`Tenant`) + Phân hiệu mặc định (`Cơ sở chính`) + Tài khoản Quản trị riêng của trường đó (`User`, `role: 'admin'`).
 * 3. "Phân trường, Phân hiệu":
 *    - Thống kê trực tiếp số lượng Phân hiệu, Lớp học, Học sinh và Nhân sự của từng trường bằng truy vấn `aggregate` gom nhóm (không N+1).
 */

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const PlatformAdmin = require('../../models/zone1_system/PlatformAdmin');
const PlatformAuditLog = require('../../models/zone1_system/PlatformAuditLog');
const Tenant = require('../../models/zone1_system/Tenant');
const User = require('../../models/zone1_system/User');
const Classroom = require('../../models/zone3_school/Classroom');
const Student = require('../../models/zone3_school/Student');
const Employee = require('../../models/zone2_hr/Employee');
const { ensureAllPermissions } = require('../../services/defaultAdminBootstrapService');
const { generatePlatformAdminToken, generateSchoolUserToken } = require('../utils/saasJwt');
const { runSafeTransaction } = require('../../utils/safeTransaction');
const { isHoneypotTriggered } = require('../../middlewares/botScannerShield');

const TENANT_CODE_REGEX = /^[A-Z0-9_-]{3,20}$/;
const BCRYPT_SALT_ROUNDS = 10;
const ALL_ENABLED_MODULES = [
  'students',
  'classrooms',
  'attendance',
  'hr',
  'timekeeping',
  'finance',
  'reports',
  'nutrition',
  'notifications',
  'chat',
  'pickups',
  'guard',
  'procurement',
  'feedback'
];

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
 * Cho phép tài khoản Quản trị Tổng (`admin`) tự đổi mật khẩu và/hoặc tên đăng nhập của chính mình.
 * Tự động tăng `authVersion` để thu hồi các phiên cũ và cấp lại `token` mới ngay lập tức.
 */
const changeSuperAdminPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, newUsername } = req.body || {};

    if (typeof currentPassword !== 'string' || !currentPassword) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập mật khẩu hiện tại của Admin Tổng'
      });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(422).json({
        success: false,
        message: 'Mật khẩu mới của Admin Tổng phải từ 6 ký tự trở lên'
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
 * Lấy danh sách toàn bộ các trường trong chuỗi kèm thống kê Phân hiệu, Lớp, Học sinh, Nhân sự và Account Admin riêng.
 */
const listAllSchoolsOverview = async (req, res) => {
  try {
    const [tenants, classCounts, studentCounts, staffCounts, schoolAdmins] = await Promise.all([
      Tenant.find({}).sort({ createdAt: 1 }).lean(),
      Classroom.aggregate([
        { $match: { status: 'active', tenantId: { $ne: null } } },
        {
          $group: {
            _id: '$tenantId',
            classCount: { $sum: 1 },
            distinctCampuses: { $addToSet: { $ifNull: ['$campus', 'Cơ sở chính'] } }
          }
        }
      ]),
      Student.aggregate([
        { $match: { status: { $in: ['enrolled', 'temporarily_absent'] }, tenantId: { $ne: null } } },
        { $group: { _id: '$tenantId', studentCount: { $sum: 1 } } }
      ]),
      Employee.aggregate([
        { $match: { status: { $in: ['active', 'on_leave'] }, tenantId: { $ne: null } } },
        { $group: { _id: '$tenantId', staffCount: { $sum: 1 } } }
      ]),
      User.find({ role: 'admin', tenantId: { $ne: null } })
        .select('username status profile tenantId lastLogin')
        .sort({ createdAt: 1 })
        .lean()
    ]);

    const classMap = new Map(classCounts.map((c) => [String(c._id), c]));
    const studentMap = new Map(studentCounts.map((s) => [String(s._id), s.studentCount]));
    const staffMap = new Map(staffCounts.map((e) => [String(e._id), e.staffCount]));
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

    const schools = tenants.map((t) => {
      const tid = String(t._id);
      const clsStat = classMap.get(tid);
      const declaredCampuses = Array.isArray(t.campuses) && t.campuses.length > 0
        ? t.campuses.map((c) => c.name).filter(Boolean)
        : ['Cơ sở chính'];
      const mergedCampusNames = [...new Set([...declaredCampuses, ...(clsStat?.distinctCampuses || [])])];
      const admins = adminsByTenant.get(tid) || [];

      return {
        _id: t._id,
        code: t.code,
        name: t.name,
        organizationCode: t.organizationCode || '',
        contactEmail: t.contactEmail || '',
        status: t.status,
        campuses: Array.isArray(t.campuses) && t.campuses.length > 0
          ? t.campuses
          : [{ code: 'CS-CHINH', name: 'Cơ sở chính', address: '', phone: '', managerName: '', isActive: true }],
        campusNames: mergedCampusNames,
        campusCount: mergedCampusNames.length,
        classCount: clsStat?.classCount || 0,
        studentCount: studentMap.get(tid) || 0,
        staffCount: staffMap.get(tid) || 0,
        primaryAdmin: admins[0] || null,
        adminAccounts: admins,
        createdAt: t.createdAt
      };
    });

    const summary = schools.reduce(
      (acc, item) => {
        acc.totalSchools += 1;
        if (item.status === 'active') acc.activeSchools += 1;
        acc.totalCampuses += item.campusCount;
        acc.totalClassrooms += item.classCount;
        acc.totalStudents += item.studentCount;
        acc.totalStaff += item.staffCount;
        return acc;
      },
      { totalSchools: 0, activeSchools: 0, totalCampuses: 0, totalClassrooms: 0, totalStudents: 0, totalStaff: 0 }
    );

    return res.json({
      success: true,
      data: {
        summary,
        schools
      }
    });
  } catch (err) {
    console.error('Lỗi tải danh sách trường học tổng:', err);
    return res.status(500).json({ success: false, message: 'Không thể tải danh sách hệ thống trường học' });
  }
};

/**
 * Tạo mới một Trường học kèm khởi tạo tự động 1 Tài khoản Admin riêng cho trường đó và danh mục Phân hiệu ban đầu.
 */
const createSchoolWithAdmin = async (req, res) => {
  try {
    const {
      code,
      name,
      organizationCode = '',
      contactEmail = '',
      adminUsername,
      adminPassword,
      adminFullName = '',
      adminPhone = '',
      initialCampuses = []
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
    if (cleanAdminPass.length < 6) {
      return res.status(422).json({
        success: false,
        message: 'Mật khẩu tài khoản Admin trường phải từ 6 ký tự trở lên'
      });
    }
    const cleanEmail = String(contactEmail || '').trim().toLowerCase();
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(422).json({
        success: false,
        message: 'Email liên hệ của trường không đúng định dạng'
      });
    }

    const permissionIds = await ensureAllPermissions();
    const passwordHash = await bcrypt.hash(cleanAdminPass, BCRYPT_SALT_ROUNDS);

    // Chuẩn bị danh sách phân hiệu ban đầu không trùng mã/tên và chuẩn hóa mã an toàn URL
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
          address: (typeof item === 'object' && item?.address) ? String(item.address).trim().slice(0, 300) : '',
          phone: (typeof item === 'object' && item?.phone) ? String(item.phone).trim().slice(0, 20) : '',
          managerName: (typeof item === 'object' && item?.managerName) ? String(item.managerName).trim().slice(0, 120) : '',
          isActive: true
        });
      });
    }

    if (!parsedCampuses.length) {
      parsedCampuses.push({
        code: 'CS-CHINH',
        name: 'Cơ sở chính',
        address: '',
        phone: '',
        managerName: '',
        isActive: true
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
            campuses: parsedCampuses,
            enabledModules: ALL_ENABLED_MODULES,
            status: 'active',
            authVersion: 0
          }
        ],
        sessionOpt
      );

      const [schoolAdmin] = await User.create(
        [
          {
            tenantId: tenant._id,
            username: cleanAdminUser,
            passwordHash,
            role: 'admin',
            permissions: permissionIds,
            profile: {
              fullName: String(adminFullName || '').trim() || `Quản trị viên ${cleanName}`,
              phone: String(adminPhone || '').trim(),
              email: cleanEmail
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
              campusCount: parsedCampuses.length
            }
          }
        ],
        sessionOpt
      );

      return { createdSchool: tenant, createdAdmin: schoolAdmin };
    });

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
 * Cập nhật thông tin trường, trạng thái hoạt động, tên đăng nhập hoặc đặt lại mật khẩu tài khoản Admin riêng của trường.
 */
const updateSchoolAndAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'ID trường học không hợp lệ' });
    }

    const { name, organizationCode, contactEmail, status, adminUsername, newAdminPassword } = req.body || {};

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
      if (status != null) {
        if (!['active', 'suspended', 'terminated'].includes(status)) {
          throw Object.assign(new Error('Trạng thái trường không hợp lệ'), { statusCode: 422 });
        }
        if (tenant.status !== status) {
          tenant.status = status;
          tenant.authVersion = (tenant.authVersion || 0) + 1;
        }
      }
      await tenant.save(sessionOpt);

      const cleanNextAdminUser = adminUsername != null ? String(adminUsername).trim() : '';
      const cleanNewPass = newAdminPassword != null ? String(newAdminPassword).trim() : '';

      if (cleanNextAdminUser && (cleanNextAdminUser.length < 3 || cleanNextAdminUser.length > 50 || /\s/.test(cleanNextAdminUser))) {
        throw Object.assign(new Error('Tên đăng nhập Admin trường phải từ 3–50 ký tự và không chứa khoảng trắng'), { statusCode: 422 });
      }
      if (cleanNewPass && cleanNewPass.length < 6) {
        throw Object.assign(new Error('Mật khẩu mới của Admin trường phải từ 6 ký tự trở lên'), { statusCode: 422 });
      }

      if (cleanNextAdminUser || cleanNewPass) {
        let adminUser = await User.findOne({ tenantId: tenant._id, role: 'admin' }).sort({ createdAt: 1 }).session(session);
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
            details: { code: tenant.code, status: tenant.status, passwordReset: Boolean(cleanNewPass) }
          }
        ],
        sessionOpt
      );

      return tenant;
    });

    return res.json({
      success: true,
      message: 'Đã cập nhật thông tin trường học thành công',
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
 * Cho phép Quản trị Tổng (`Admin chung toàn bộ`) chuyển ngữ cảnh vào điều hành trực tiếp một trường cụ thể (`Admin từng trường`).
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
      // Nếu tài khoản admin sẵn có đang bị inactive thì kích hoạt lại để SuperAdmin không bị kẹt lỗi trùng username
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

    const schoolToken = generateSchoolUserToken(schoolAdmin, tenant, '4h');
    await PlatformAuditLog.create({
      actorId: req.platformAdmin._id,
      actorUsername: req.platformAdmin.username,
      action: 'ENTER_SCHOOL_WORKSPACE',
      targetType: 'tenant',
      targetId: String(tenant._id),
      details: { code: tenant.code, asSchoolAdmin: schoolAdmin.username }
    });

    return res.json({
      success: true,
      message: `Đang chuyển vào không gian quản lý của ${tenant.name}`,
      token: schoolToken,
      tenant: {
        _id: tenant._id,
        id: tenant._id,
        code: tenant.code,
        name: tenant.name,
        status: tenant.status
      },
      user: {
        _id: schoolAdmin._id,
        username: schoolAdmin.username,
        role: schoolAdmin.role,
        profile: schoolAdmin.profile,
        tenantId: tenant._id,
        schoolCode: tenant.code
      }
    });
  } catch (err) {
    console.error('Lỗi truy cập không gian trường:', err);
    return res.status(500).json({ success: false, message: 'Không thể chuyển vào quản lý trường học này' });
  }
};

module.exports = {
  loginSuperAdmin,
  getSuperAdminMe,
  changeSuperAdminPassword,
  listAllSchoolsOverview,
  createSchoolWithAdmin,
  updateSchoolAndAdmin,
  enterSchoolWorkspace
};

