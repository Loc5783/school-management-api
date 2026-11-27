const mongoose = require('mongoose');
const AuditLog = require('../models/zone1_system/AuditLog');
const Student = require('../models/zone3_school/Student');
const User = require('../models/zone1_system/User');
const Employee = require('../models/zone2_hr/Employee');
const Classroom = require('../models/zone3_school/Classroom');
const { hashPassword } = require('../utils/passwordHash');
const { assertPersonCodeAvailable, generateNextPersonCode } = require('../services/personCodeService');
const {
  buildTenantFilter,
  assertTenantContext,
  InvalidTenantContextError
} = require('../services/tenantFilterService');

const manageableStatuses = ['active', 'inactive', 'suspended'];
const assignableStaffRoles = ['principal', 'teacher', 'accountant', 'chef', 'guard', 'hr'];
const internalRoles = ['admin', ...assignableStaffRoles];
const usernamePattern = /^[a-zA-Z0-9._-]{3,50}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^[0-9+().\s-]{8,20}$/;
const positionByRole = { principal: 'principal', teacher: 'teacher', accountant: 'accountant', chef: 'chef', guard: 'security', hr: 'hr' };
const validPositionsByRole = {
  principal: ['principal', 'vice_principal'],
  teacher: ['teacher', 'head_teacher', 'assistant_teacher'],
  accountant: ['accountant'], chef: ['chef'], guard: ['security'], hr: ['hr']
};

const serializeParent = (user) => ({
  _id: user._id,
  username: user.username,
  profile: {
    fullName: user.profile?.fullName,
    phone: user.profile?.phone,
    email: user.profile?.email
  },
  status: user.status,
  studentIds: (user.parentInfo?.studentIds || []).map((id) => id.toString()),
  requestedClassroom: user.parentInfo?.requestedClassroomId ? {
    _id: user.parentInfo.requestedClassroomId._id || user.parentInfo.requestedClassroomId,
    name: user.parentInfo.requestedClassroomId.name || '',
    fullName: user.parentInfo.requestedClassroomId.fullName || '',
    ageGroup: user.parentInfo.requestedClassroomId.ageGroup || ''
  } : null,
  registrationNote: user.parentInfo?.registrationNote || '',
  createdAt: user.createdAt,
  lastLogin: user.lastLogin
});

const serializeInternalAccount = (user, employee = null) => ({
  _id: user._id,
  username: user.username,
  role: user.role,
  profile: {
    fullName: user.profile?.fullName,
    phone: user.profile?.phone,
    email: user.profile?.email
  },
  status: user.status,
  employeeId: employee?.employeeCode || '',
  createdAt: user.createdAt,
  lastLogin: user.lastLogin
});

const canAssignStaffRole = (actor, role) => actor?.role === 'admin'
  || (actor?.role === 'hr' && ['teacher', 'accountant', 'chef', 'guard', 'hr'].includes(role));

const validateInternalAccount = ({ username, password, profile, role }, actor) => {
  if (typeof username !== 'string' || !usernamePattern.test(username.trim())) return 'Tên đăng nhập chỉ gồm chữ, số, dấu chấm, gạch dưới hoặc gạch ngang (3-50 ký tự)';
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) return 'Mật khẩu phải có từ 8 đến 72 ký tự';
  if (typeof profile?.fullName !== 'string' || !profile.fullName.trim() || profile.fullName.length > 120) return 'Họ và tên phải có từ 1 đến 120 ký tự';
  if (profile?.email && (typeof profile.email !== 'string' || profile.email.length > 254 || !emailPattern.test(profile.email.trim()))) return 'Email không hợp lệ';
  if (profile?.phone && (typeof profile.phone !== 'string' || !phonePattern.test(profile.phone.trim()))) return 'Số điện thoại không hợp lệ';
  if (!assignableStaffRoles.includes(role) || !canAssignStaffRole(actor, role)) return 'Bạn không có quyền gán vai trò này';
  return null;
};

const canManageInternalTarget = (actor, account) => {
  if (String(actor?._id) === String(account?._id)) return 'Không thể tự thay đổi hoặc thu hồi tài khoản của chính mình';
  if (account?.role === 'admin') return 'Không thể thay đổi tài khoản quản trị hệ thống';
  if (actor?.role === 'principal' && account?.role === 'principal') return 'Hiệu trưởng không thể thay đổi tài khoản Hiệu trưởng khác';
  if (actor?.role === 'hr' && account?.role === 'principal') return 'Nhân sự không thể thay đổi tài khoản Hiệu trưởng';
  return null;
};

const writeAudit = (req, action, target, before, after, reason = '', session = null) => {
  const tenantId = req.tenantId || req.user?.tenantId || undefined;
  return AuditLog.create([{
    ...(tenantId ? { tenantId } : {}),
    actorId: req.user._id,
    actorUsername: req.user.username,
    action,
    targetType: 'User',
    targetId: target._id,
    before,
    after,
    reason: reason.trim(),
    requestId: req.header('X-Request-Id') || undefined
  }], session ? { session } : {}).then(([log]) => log);
};

const { runSafeTransaction } = require('../utils/safeTransaction');
const runLinkedAccountTransaction = (operation) => runSafeTransaction(
  operation,
  'MongoDB phải chạy Replica Set để đồng bộ tài khoản và hồ sơ nhân sự'
);

const findParent = async (req, id) => {
  if (!mongoose.isValidObjectId(id)) return null;
  const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
  return User.findOne({ _id: id, role: 'parent', ...tenantFilter });
};

const listParents = async (req, res) => {
  try {
    const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
    const filter = { role: 'parent', ...tenantFilter };
    if (req.query.status) {
      if (!manageableStatuses.includes(req.query.status)) {
        return res.status(400).json({ message: 'Trạng thái lọc không hợp lệ' });
      }
      filter.status = req.query.status;
    }
    const parents = await User.find(filter)
      .select('username status profile parentInfo createdAt lastLogin')
      .populate('parentInfo.requestedClassroomId', 'name fullName ageGroup')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    return res.json({ data: parents.map(serializeParent) });
  } catch (error) {
    if (error instanceof InvalidTenantContextError || error?.name === 'InvalidTenantContextError') {
      return res.status(error.statusCode || 403).json({ message: error.message });
    }
    console.error('List parent accounts failed:', error.message);
    return res.status(500).json({ message: 'Không thể tải danh sách tài khoản phụ huynh' });
  }
};

/**
 * Tạo trực tiếp tài khoản phụ huynh tại trường (do cổng tự đăng ký công khai đã khóa vì lý do bảo mật).
 * Ràng buộc: Cô lập theo `tenantId` và chỉ cho phép gắn học sinh `enrolled` thuộc cùng cơ sở.
 */
const createParentAccount = async (req, res) => {
  try {
    const tenantContext = assertTenantContext(req);
    const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
    const targetTenantId = tenantContext.isSaaS ? tenantContext.tenantId : null;

    const { username, password, profile = {}, studentIds = [], registrationNote = '' } = req.body || {};
    if (typeof username !== 'string' || !usernamePattern.test(username.trim())) {
      return res.status(422).json({ message: 'Tên đăng nhập chỉ gồm chữ, số, dấu chấm, gạch dưới hoặc gạch ngang (3-50 ký tự)' });
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
      return res.status(422).json({ message: 'Mật khẩu phải có từ 8 đến 72 ký tự' });
    }
    if (typeof profile?.fullName !== 'string' || !profile.fullName.trim() || profile.fullName.length > 120) {
      return res.status(422).json({ message: 'Họ và tên phụ huynh phải có từ 1 đến 120 ký tự' });
    }
    if (profile?.email && (typeof profile.email !== 'string' || profile.email.length > 254 || !emailPattern.test(profile.email.trim()))) {
      return res.status(422).json({ message: 'Email phụ huynh không hợp lệ' });
    }
    if (profile?.phone && (typeof profile.phone !== 'string' || !phonePattern.test(profile.phone.trim()))) {
      return res.status(422).json({ message: 'Số điện thoại phụ huynh không hợp lệ' });
    }
    if (!Array.isArray(studentIds) || studentIds.some((id) => !mongoose.isValidObjectId(id))) {
      return res.status(400).json({ message: 'Danh sách mã học sinh liên kết không hợp lệ' });
    }

    const normalizedUsername = username.trim();
    if (await User.exists({ username: normalizedUsername, ...tenantFilter })) {
      return res.status(409).json({ message: 'Tên đăng nhập đã tồn tại trong trường' });
    }

    const uniqueStudentIds = [...new Set(studentIds.map(String))];
    if (uniqueStudentIds.length > 0) {
      const validStudentCount = await Student.countDocuments({
        _id: { $in: uniqueStudentIds },
        status: 'enrolled',
        ...tenantFilter
      });
      if (validStudentCount !== uniqueStudentIds.length) {
        return res.status(400).json({ message: 'Có học sinh không tồn tại hoặc không thuộc danh sách đang theo học của trường' });
      }
    }

    const passwordHash = await hashPassword(password);
    const createdParent = await User.create({
      username: normalizedUsername,
      passwordHash,
      role: 'parent',
      status: uniqueStudentIds.length > 0 ? 'active' : 'inactive',
      permissions: [],
      tenantId: targetTenantId,
      profile: {
        fullName: profile.fullName.trim(),
        phone: String(profile.phone || '').trim(),
        email: String(profile.email || '').trim().toLowerCase()
      },
      parentInfo: {
        studentIds: uniqueStudentIds,
        registrationNote: String(registrationNote || 'Tài khoản do nhà trường cấp trực tiếp').trim().slice(0, 300)
      }
    });

    await writeAudit(req, 'PARENT_ACCOUNT_CREATED', createdParent, {}, {
      username: createdParent.username,
      status: createdParent.status,
      studentIds: uniqueStudentIds
    });

    return res.status(201).json({
      message: uniqueStudentIds.length > 0
        ? 'Đã tạo và kích hoạt tài khoản phụ huynh thành công'
        : 'Đã tạo tài khoản phụ huynh (chờ liên kết học sinh để kích hoạt)',
      data: serializeParent(createdParent)
    });
  } catch (error) {
    if (error instanceof InvalidTenantContextError || error?.name === 'InvalidTenantContextError') {
      return res.status(error.statusCode || 403).json({ message: error.message });
    }
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'Tên đăng nhập phụ huynh đã tồn tại' });
    }
    console.error('Create parent account failed:', error.message);
    return res.status(500).json({ message: 'Không thể tạo tài khoản phụ huynh' });
  }
};

const linkParentStudents = async (req, res) => {
  try {
    const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
    const parent = await findParent(req, req.params.id);
    if (!parent) return res.status(404).json({ message: 'Không tìm thấy tài khoản phụ huynh' });

    const suppliedIds = req.body.studentIds;
    if (!Array.isArray(suppliedIds) || suppliedIds.some((id) => !mongoose.isValidObjectId(id))) {
      return res.status(400).json({ message: 'studentIds phải là danh sách mã học sinh hợp lệ' });
    }
    const uniqueIds = [...new Set(suppliedIds.map(String))];
    if (uniqueIds.length > 0) {
      const studentFilter = { _id: { $in: uniqueIds }, status: 'enrolled', ...tenantFilter };
      const studentCount = await Student.countDocuments(studentFilter);
      if (studentCount !== uniqueIds.length) {
        return res.status(400).json({ message: 'Có học sinh không tồn tại hoặc không còn đang theo học tại trường' });
      }
    }

    const before = { studentIds: (parent.parentInfo?.studentIds || []).map(String) };
    parent.parentInfo = { ...parent.parentInfo?.toObject?.(), studentIds: uniqueIds };
    await parent.save();
    const after = { studentIds: uniqueIds };
    await writeAudit(req, 'PARENT_STUDENTS_LINKED', parent, before, after, req.body.reason || '');
    return res.json({ message: 'Đã liên kết hồ sơ học sinh với phụ huynh', data: serializeParent(parent) });
  } catch (error) {
    if (error instanceof InvalidTenantContextError || error?.name === 'InvalidTenantContextError') {
      return res.status(error.statusCode || 403).json({ message: error.message });
    }
    console.error('Link parent students failed:', error.message);
    return res.status(500).json({ message: 'Không thể liên kết học sinh cho phụ huynh' });
  }
};

const updateParentStatus = async (req, res) => {
  try {
    const { status, reason = '' } = req.body;
    if (!manageableStatuses.includes(status)) {
      return res.status(400).json({ message: 'Chỉ có thể đặt trạng thái hoạt động, chờ kích hoạt hoặc tạm ngưng' });
    }
    const parent = await findParent(req, req.params.id);
    if (!parent) return res.status(404).json({ message: 'Không tìm thấy tài khoản phụ huynh' });
    if (status === 'active' && !(parent.parentInfo?.studentIds || []).length) {
      return res.status(400).json({ message: 'Cần liên kết ít nhất một hồ sơ học sinh trước khi kích hoạt tài khoản' });
    }

    const before = { status: parent.status, authVersion: parent.authVersion || 0 };
    if (parent.status !== status) {
      parent.status = status;
      parent.authVersion = (parent.authVersion || 0) + 1;
      await parent.save();
      await writeAudit(req, 'USER_STATUS_CHANGED', parent, before, { status: parent.status, authVersion: parent.authVersion }, reason);
    }
    return res.json({ message: 'Đã cập nhật trạng thái tài khoản phụ huynh', data: serializeParent(parent) });
  } catch (error) {
    if (error instanceof InvalidTenantContextError || error?.name === 'InvalidTenantContextError') {
      return res.status(error.statusCode || 403).json({ message: error.message });
    }
    console.error('Update parent status failed:', error.message);
    return res.status(500).json({ message: 'Không thể cập nhật trạng thái tài khoản phụ huynh' });
  }
};

const listInternalAccounts = async (req, res) => {
  try {
    const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));

    const filter = {
      role: { $in: internalRoles },
      ...tenantFilter
    };

    if (req.query.status) {
      if (!manageableStatuses.includes(req.query.status)) {
        return res.status(400).json({ success: false, message: 'Trạng thái lọc không hợp lệ' });
      }
      filter.status = req.query.status;
    }

    if (req.query.role) {
      if (!internalRoles.includes(req.query.role)) {
        return res.status(400).json({ success: false, message: 'Vai trò lọc không hợp lệ' });
      }
      filter.role = req.query.role;
    }

    if (req.query.search && typeof req.query.search === 'string' && req.query.search.trim()) {
      const escaped = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { username: { $regex: escaped, $options: 'i' } },
        { 'profile.fullName': { $regex: escaped, $options: 'i' } }
      ];
    }

    const [accounts, total] = await Promise.all([
      User.find(filter)
        .select('username role status profile employeeInfo createdAt lastLogin')
        .sort(req.query.sortBy === 'name' ? { role: 1, 'profile.fullName': 1, username: 1 } : { createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter)
    ]);

    const accountIds = accounts.map((account) => account._id);
    const employees = await Employee.find({
      userId: { $in: accountIds },
      ...tenantFilter
    })
      .select('userId employeeCode')
      .lean();

    const employeeByUserId = new Map(employees.map((employee) => [String(employee.userId), employee]));

    return res.json({
      success: true,
      data: accounts.map((account) => serializeInternalAccount(account, employeeByUserId.get(String(account._id)))),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    if (error instanceof InvalidTenantContextError || error?.name === 'InvalidTenantContextError') {
      return res.status(error.statusCode || 403).json({ success: false, message: error.message });
    }
    console.error('List internal accounts failed:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể tải danh sách tài khoản nội bộ' });
  }
};

const createInternalAccount = async (req, res) => {
  try {
    const tenantContext = assertTenantContext(req);
    const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
    const targetTenantId = tenantContext.isSaaS ? tenantContext.tenantId : null;

    const { username, password, profile = {}, role, existingEmployeeId } = req.body;
    const validationError = validateInternalAccount({ username, password, profile, role }, req.user);
    if (validationError) return res.status(422).json({ success: false, message: validationError });

    if (existingEmployeeId !== undefined && existingEmployeeId !== null && existingEmployeeId !== '' && !mongoose.isValidObjectId(existingEmployeeId)) {
      return res.status(400).json({ success: false, message: 'ID hồ sơ nhân sự liên kết không hợp lệ' });
    }

    const normalizedUsername = username.trim();
    if (await User.exists({ username: normalizedUsername, ...tenantFilter })) {
      return res.status(409).json({ success: false, message: 'Tên đăng nhập đã tồn tại' });
    }

    const passwordHash = await hashPassword(password);
    const txOpts = (session) => (session ? { session } : {});
    const { account, employee, linkedExisting } = await runLinkedAccountTransaction(async (session) => {
      const [createdAccount] = await User.create([{
        username: normalizedUsername,
        passwordHash,
        role,
        status: 'active',
        permissions: [],
        tenantId: targetTenantId,
        profile: {
          fullName: profile.fullName.trim(),
          phone: String(profile.phone || '').trim(),
          email: String(profile.email || '').trim().toLowerCase(),
          address: String(profile.address || '').trim()
        }
      }], txOpts(session));

      const rawRequestedCode = String(req.body?.employeeCode || '').trim().toUpperCase();

      // Ưu tiên liên kết với hồ sơ nhân sự có sẵn chưa gắn tài khoản (tránh sinh bản ghi trùng 0đ lương)
      let targetEmployee = null;
      if (existingEmployeeId) {
        targetEmployee = await Employee.findOne({
          _id: existingEmployeeId,
          status: { $ne: 'resigned' },
          ...tenantFilter
        }).session(session || null);
        if (!targetEmployee) {
          const err = new Error('Không tìm thấy hồ sơ nhân sự để liên kết');
          err.statusCode = 404;
          throw err;
        }
        if (targetEmployee.userId) {
          const err = new Error('Hồ sơ nhân sự này đã được liên kết với một tài khoản khác');
          err.statusCode = 409;
          throw err;
        }
      } else if (rawRequestedCode) {
        targetEmployee = await Employee.findOne({
          employeeCode: rawRequestedCode,
          userId: null,
          status: { $ne: 'resigned' },
          ...tenantFilter
        }).session(session || null);
      }

      let resolvedEmployee = targetEmployee;
      let isLinkedExisting = false;

      if (resolvedEmployee) {
        isLinkedExisting = true;
        resolvedEmployee.userId = createdAccount._id;
        resolvedEmployee.fullName = createdAccount.profile.fullName;
        if (createdAccount.profile.phone) resolvedEmployee.phone = createdAccount.profile.phone;
        if (createdAccount.profile.email) resolvedEmployee.email = createdAccount.profile.email;
        resolvedEmployee.payrollRole = role;
        if (!validPositionsByRole[role]?.includes(resolvedEmployee.position)) {
          resolvedEmployee.position = positionByRole[role] || 'teacher';
        }
        await resolvedEmployee.save(txOpts(session));
      } else {
        const employeeCode = rawRequestedCode
          ? await assertPersonCodeAvailable({ code: rawRequestedCode, tenantId: targetTenantId, excludeUserId: createdAccount._id, session })
          : await generateNextPersonCode({ tenantId: targetTenantId, session });

        const [createdEmployee] = await Employee.create([{
          tenantId: targetTenantId,
          userId: createdAccount._id,
          employeeCode,
          fullName: createdAccount.profile.fullName,
          phone: createdAccount.profile.phone,
          email: createdAccount.profile.email,
          gender: null,
          contractType: null,
          startDate: null,
          qualification: { degree: '', major: '' },
          position: positionByRole[role] || 'teacher',
          payrollRole: role,
          status: 'active',
          salaryConfig: { baseSalary: 0, positionAllowance: 0, lunchAllowance: 0 }
        }], txOpts(session));
        resolvedEmployee = createdEmployee;
      }

      createdAccount.employeeInfo = {
        employeeId: resolvedEmployee.employeeCode,
        position: resolvedEmployee.position || positionByRole[role] || 'teacher',
        baseSalary: Number(resolvedEmployee.salaryConfig?.baseSalary || 0)
      };
      await createdAccount.save(txOpts(session));

      await writeAudit(req, 'INTERNAL_ACCOUNT_CREATED', createdAccount, {}, {
        username: createdAccount.username,
        role: createdAccount.role,
        status: createdAccount.status,
        employeeCode: resolvedEmployee.employeeCode,
        linkedExistingEmployee: isLinkedExisting
      }, '', session);

      return { account: createdAccount, employee: resolvedEmployee, linkedExisting: isLinkedExisting };
    });

    return res.status(201).json({
      success: true,
      message: linkedExisting
        ? 'Đã tạo tài khoản và gắn với hồ sơ nhân sự có sẵn (giữ nguyên mức lương & hợp đồng)'
        : 'Đã tạo tài khoản và khởi tạo hồ sơ nhân sự mới',
      data: serializeInternalAccount(account, employee)
    });
  } catch (error) {
    if (error instanceof InvalidTenantContextError || error?.name === 'InvalidTenantContextError') {
      return res.status(error.statusCode || 403).json({ success: false, message: error.message });
    }
    if (error?.code === 11000) {
      const keyPattern = error?.keyPattern || {};
      if (keyPattern.username) {
        return res.status(409).json({ success: false, message: 'Tên đăng nhập đã tồn tại' });
      }
      if (keyPattern.employeeCode) {
        return res.status(409).json({ success: false, message: 'Mã nhân viên đã tồn tại trên hệ thống' });
      }
      if (keyPattern.userId) {
        return res.status(409).json({ success: false, message: 'Hồ sơ nhân sự cho người dùng này đã tồn tại' });
      }
      return res.status(409).json({ success: false, message: 'Dữ liệu tài khoản hoặc nhân sự bị trùng lặp' });
    }
    console.error('Create internal account failed:', error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : 'Không thể tạo tài khoản nội bộ'
    });
  }
};

const updateInternalAccountRole = async (req, res) => {
  if (!assignableStaffRoles.includes(req.body?.role) || !canAssignStaffRole(req.user, req.body.role)) {
    return res.status(422).json({ success: false, message: 'Bạn không có quyền gán vai trò này' });
  }
  req.body = { role: req.body?.role };
  return updateInternalAccount(req, res);
};

const updateInternalAccount = async (req, res) => {
  try {
    const tenantContext = assertTenantContext(req);
    const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'ID tài khoản không hợp lệ' });
    }

    const account = await User.findOne({
      _id: req.params.id,
      role: { $in: internalRoles },
      ...tenantFilter
    });
    if (!account) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản nội bộ' });
    }

    const targetError = canManageInternalTarget(req.user, account);
    if (targetError) return res.status(409).json({ success: false, message: targetError });

    const { username, password, profile = {}, role, status } = req.body;
    if (username !== undefined && (typeof username !== 'string' || !usernamePattern.test(username.trim()))) {
      return res.status(422).json({ success: false, message: 'Tên đăng nhập không hợp lệ' });
    }
    if (password !== undefined && (typeof password !== 'string' || password.length < 8 || password.length > 72)) {
      return res.status(422).json({ success: false, message: 'Mật khẩu phải có từ 8 đến 72 ký tự' });
    }
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      return res.status(422).json({ success: false, message: 'Hồ sơ tài khoản không hợp lệ' });
    }
    if (profile.fullName !== undefined && (typeof profile.fullName !== 'string' || !profile.fullName.trim() || profile.fullName.length > 120)) {
      return res.status(422).json({ success: false, message: 'Họ và tên phải có từ 1 đến 120 ký tự' });
    }
    if (profile.phone !== undefined && (typeof profile.phone !== 'string' || (profile.phone && !phonePattern.test(profile.phone.trim())))) {
      return res.status(422).json({ success: false, message: 'Số điện thoại không hợp lệ' });
    }
    if (profile.email !== undefined && (typeof profile.email !== 'string' || (profile.email && (profile.email.length > 254 || !emailPattern.test(profile.email.trim()))))) {
      return res.status(422).json({ success: false, message: 'Email không hợp lệ' });
    }
    if (role !== undefined && (!assignableStaffRoles.includes(role) || !canAssignStaffRole(req.user, role))) {
      return res.status(422).json({ success: false, message: 'Bạn không có quyền gán vai trò này' });
    }
    if (status !== undefined && !manageableStatuses.includes(status)) {
      return res.status(422).json({ success: false, message: 'Trạng thái tài khoản không hợp lệ' });
    }

    const nextUsername = username === undefined ? account.username : String(username).trim();
    if (nextUsername !== account.username && await User.exists({
      username: nextUsername,
      _id: { $ne: account._id },
      ...tenantFilter
    })) {
      return res.status(409).json({ success: false, message: 'Tên đăng nhập đã tồn tại' });
    }

    // 1. Initial minimal metadata check to detect alien linkage across the collection (only _id and tenantId)
    const unscopedEmployeeMeta = await Employee.findOne({ userId: account._id }).select('_id tenantId');
    let hasLinkedEmployee = false;

    if (unscopedEmployeeMeta) {
      let isSameTenant = false;
      if (tenantContext.isSaaS) {
        isSameTenant = Boolean(unscopedEmployeeMeta.tenantId && unscopedEmployeeMeta.tenantId.toString() === tenantContext.tenantId.toString());
      } else if (tenantContext.isLegacy) {
        isSameTenant = unscopedEmployeeMeta.tenantId === null || unscopedEmployeeMeta.tenantId === undefined;
      }

      if (!isSameTenant) {
        // Alien/corrupted linkage detected
        return res.status(409).json({
          success: false,
          code: 'CORRUPTED_EMPLOYEE_LINK',
          message: 'Phát hiện liên kết hồ sơ nhân sự ngoại lai không hợp lệ. Vui lòng liên hệ quản trị viên.'
        });
      }

      hasLinkedEmployee = true;
    }

    // 2. If valid linked employee exists, fetch business record scoped to tenant to verify status
    if (hasLinkedEmployee) {
      const linkedEmployee = await Employee.findOne({ userId: account._id, ...tenantFilter }).select('status');
      if (linkedEmployee?.status === 'resigned' && status === 'active') {
        return res.status(409).json({
          success: false,
          message: 'Nhân viên đã nghỉ việc. Cần xử lý hồ sơ tái tuyển dụng trước khi mở lại tài khoản.'
        });
      }
    }

    // 3. Check classroom assignment for teacher: homeroomTeacherId OR teachers.teacherId
    if (account.role === 'teacher' && role && role !== 'teacher') {
      const isAssigned = await Classroom.exists({
        status: 'active',
        ...tenantFilter,
        $or: [
          { homeroomTeacherId: account._id },
          { 'teachers.teacherId': account._id }
        ]
      });
      if (isAssigned) {
        return res.status(409).json({
          success: false,
          message: 'Giáo viên đang được phân công lớp. Hãy chuyển phân công lớp trước khi đổi vai trò.'
        });
      }
    }

    const applyUpdate = async (session) => {
      // 1. Re-verify actor inside session: actor must remain in ['admin', 'hr'], active, and within tenant scope
      const currentActor = await User.findOne({
        _id: req.user._id,
        role: { $in: ['admin', 'hr'] },
        status: 'active',
        ...tenantFilter
      }).session(session);
      if (!currentActor) {
        const error = new Error('Tài khoản thực hiện thao tác không còn quyền quản lý tài khoản nội bộ hoặc đã bị khóa/hạ quyền');
        error.statusCode = 403;
        throw error;
      }

      // Re-verify actor's authority to assign role if role is requested
      if (role !== undefined && (!assignableStaffRoles.includes(role) || !canAssignStaffRole(currentActor, role))) {
        const error = new Error('Bạn không có quyền gán vai trò này');
        error.statusCode = 422;
        throw error;
      }

      // 2. Re-read target User with tenant scope and internalRoles constraint inside transaction
      const target = await User.findOne({
        _id: account._id,
        role: { $in: internalRoles },
        ...tenantFilter
      }).session(session);
      if (!target) {
        const error = new Error('Không tìm thấy tài khoản nội bộ');
        error.statusCode = 404;
        throw error;
      }

      // 3. Re-check canManageInternalTarget on fresh target and actor (prevent targeting principal, other admins, or self)
      const targetErrorInTx = canManageInternalTarget(currentActor, target);
      if (targetErrorInTx) {
        const error = new Error(targetErrorInTx);
        error.statusCode = 409;
        throw error;
      }

      // 4. Re-check username uniqueness within tenant if username is changed
      const effectiveNextUsername = username === undefined ? target.username : String(username).trim();
      if (effectiveNextUsername !== target.username && await User.exists({
        username: effectiveNextUsername,
        _id: { $ne: target._id },
        ...tenantFilter
      }).session(session)) {
        const error = new Error('Tên đăng nhập đã tồn tại');
        error.statusCode = 409;
        throw error;
      }

      // 5. Re-verify that no alien employee was concurrently attached (minimal metadata read)
      const unscopedMetaInTx = await Employee.findOne({ userId: target._id }).select('_id tenantId').session(session);
      if (unscopedMetaInTx) {
        let same = false;
        if (tenantContext.isSaaS) {
          same = Boolean(unscopedMetaInTx.tenantId && unscopedMetaInTx.tenantId.toString() === tenantContext.tenantId.toString());
        } else if (tenantContext.isLegacy) {
          same = unscopedMetaInTx.tenantId === null || unscopedMetaInTx.tenantId === undefined;
        }
        if (!same) {
          const error = new Error('Phát hiện liên kết hồ sơ nhân sự ngoại lai không hợp lệ.');
          error.statusCode = 409;
          error.code = 'CORRUPTED_EMPLOYEE_LINK';
          throw error;
        }
      }

      // 6. Re-read linked Employee with tenant scope
      const employee = unscopedMetaInTx
        ? await Employee.findOne({ userId: target._id, ...tenantFilter }).session(session)
        : null;

      // Ensure linkage state has not changed concurrently
      if (Boolean(hasLinkedEmployee) !== Boolean(employee)) {
        const error = new Error('Liên kết hồ sơ nhân sự đã thay đổi. Vui lòng tải lại danh sách.');
        error.statusCode = 409;
        throw error;
      }

      // 7. Re-check Employee resigned status in transaction on fresh employee snapshot
      const requestedStatus = status !== undefined ? status : target.status;
      if (employee?.status === 'resigned' && requestedStatus === 'active') {
        const error = new Error('Nhân viên đã nghỉ việc. Cần xử lý hồ sơ tái tuyển dụng trước khi mở lại tài khoản.');
        error.statusCode = 409;
        throw error;
      }

      // 8. Re-check Classroom assignment for teacher in transaction with same session on fresh target
      const requestedRole = role !== undefined ? role : target.role;
      if (target.role === 'teacher' && requestedRole && requestedRole !== 'teacher') {
        const isAssigned = await Classroom.exists({
          status: 'active',
          ...tenantFilter,
          $or: [
            { homeroomTeacherId: target._id },
            { 'teachers.teacherId': target._id }
          ]
        }).session(session);
        if (isAssigned) {
          const error = new Error('Giáo viên đang được phân công lớp. Hãy chuyển phân công lớp trước khi đổi vai trò.');
          error.statusCode = 409;
          throw error;
        }
      }

      const before = {
        username: target.username,
        role: target.role,
        status: target.status,
        profile: target.profile?.toObject?.() || target.profile,
        authVersion: target.authVersion || 0
      };

      target.username = effectiveNextUsername;
      if (profile.fullName !== undefined) target.profile.fullName = profile.fullName.trim();
      if (profile.phone !== undefined) target.profile.phone = String(profile.phone || '').trim();
      if (profile.email !== undefined) target.profile.email = String(profile.email || '').trim().toLowerCase();
      if (role !== undefined) target.role = role;
      if (status !== undefined) target.status = status;
      if (password !== undefined) target.passwordHash = await hashPassword(password);
      target.authVersion = (target.authVersion || 0) + 1;
      target.assignmentVersion = (target.assignmentVersion || 0) + 1;

      if (employee) {
        employee.fullName = target.profile.fullName;
        employee.phone = target.profile.phone || '';
        employee.email = target.profile.email || '';
        employee.payrollRole = target.role;
        if (!validPositionsByRole[target.role].includes(employee.position)) {
          employee.position = positionByRole[target.role];
        }
        target.set('employeeInfo.position', employee.position);
        await employee.save({ session });
      }

      await target.save({ session });

      await writeAudit(req, 'INTERNAL_ACCOUNT_UPDATED', target, before, {
        username: target.username,
        role: target.role,
        status: target.status,
        profile: target.profile,
        authVersion: target.authVersion
      }, '', session);

      return { target, employee };
    };

    // Both with Employee and without Employee are executed in the transaction session
    const updated = await runLinkedAccountTransaction(applyUpdate);

    return res.json({
      success: true,
      message: 'Đã cập nhật tài khoản',
      data: serializeInternalAccount(updated.target, updated.employee)
    });
  } catch (error) {
    if (error instanceof InvalidTenantContextError || error?.name === 'InvalidTenantContextError') {
      return res.status(error.statusCode || 403).json({ success: false, message: error.message });
    }
    if (error?.code === 'CORRUPTED_EMPLOYEE_LINK') {
      return res.status(409).json({
        success: false,
        code: 'CORRUPTED_EMPLOYEE_LINK',
        message: error.message || 'Phát hiện liên kết hồ sơ nhân sự ngoại lai không hợp lệ. Vui lòng liên hệ quản trị viên.'
      });
    }
    if (error?.code === 11000) {
      const keyPattern = error?.keyPattern || {};
      if (keyPattern.username) {
        return res.status(409).json({ success: false, message: 'Tên đăng nhập đã tồn tại' });
      }
      if (keyPattern.employeeCode) {
        return res.status(409).json({ success: false, message: 'Mã nhân viên đã tồn tại trên hệ thống' });
      }
      return res.status(409).json({ success: false, message: 'Dữ liệu tài khoản hoặc nhân sự bị trùng lặp' });
    }
    console.error('Update internal account failed:', error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : 'Không thể cập nhật tài khoản'
    });
  }
};

const deactivateInternalAccount = async (req, res) => {
  try {
    const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'ID tài khoản không hợp lệ' });
    }

    const account = await User.findOne({
      _id: req.params.id,
      role: { $in: internalRoles },
      ...tenantFilter
    });
    if (!account) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản nội bộ' });
    }

    const targetError = canManageInternalTarget(req.user, account);
    if (targetError) return res.status(409).json({ success: false, message: targetError });

    const before = { status: account.status, authVersion: account.authVersion || 0 };
    if (account.status !== 'inactive') {
      account.status = 'inactive';
      account.authVersion = (account.authVersion || 0) + 1;
      await account.save();
      await writeAudit(
        req,
        'INTERNAL_ACCOUNT_DEACTIVATED',
        account,
        before,
        { status: account.status, authVersion: account.authVersion },
        req.body?.reason || 'Thu hồi quyền truy cập'
      );
    }

    const linkedEmployee = await Employee.findOne({
      userId: account._id,
      ...tenantFilter
    }).select('employeeCode');

    return res.json({
      success: true,
      message: 'Đã thu hồi quyền truy cập tài khoản',
      data: serializeInternalAccount(account, linkedEmployee)
    });
  } catch (error) {
    if (error instanceof InvalidTenantContextError || error?.name === 'InvalidTenantContextError') {
      return res.status(error.statusCode || 403).json({ success: false, message: error.message });
    }
    console.error('Deactivate internal account failed:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể thu hồi tài khoản' });
  }
};

module.exports = {
  createParentAccount,
  linkParentStudents,
  listParents,
  updateParentStatus,
  listInternalAccounts,
  createInternalAccount,
  updateInternalAccountRole,
  updateInternalAccount,
  deactivateInternalAccount
};
