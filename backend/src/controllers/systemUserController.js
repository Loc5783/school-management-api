const mongoose = require('mongoose');
const AuditLog = require('../models/zone1_system/AuditLog');
const Student = require('../models/zone3_school/Student');
const User = require('../models/zone1_system/User');
const Employee = require('../models/zone2_hr/Employee');
const Classroom = require('../models/zone3_school/Classroom');
const { hashPassword } = require('../utils/passwordHash');

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

const writeAudit = (req, action, target, before, after, reason = '', session = null) => AuditLog.create([{
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

const runLinkedAccountTransaction = async (operation) => {
  const topology = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!topology.setName && topology.msg !== 'isdbgrid') {
    const error = new Error('MongoDB phải chạy Replica Set để đồng bộ tài khoản và hồ sơ nhân sự');
    error.statusCode = 503;
    throw error;
  }
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await operation(session); });
    return result;
  } finally { await session.endSession(); }
};

const findParent = async (id) => {
  if (!mongoose.isValidObjectId(id)) return null;
  return User.findOne({ _id: id, role: 'parent' });
};

const listParents = async (req, res) => {
  try {
    const filter = { role: 'parent' };
    if (req.query.status) {
      if (!manageableStatuses.includes(req.query.status)) {
        return res.status(400).json({ message: 'Trạng thái lọc không hợp lệ' });
      }
      filter.status = req.query.status;
    }
    const parents = await User.find(filter)
      .populate('parentInfo.requestedClassroomId', 'name fullName ageGroup')
      .sort({ createdAt: -1 }).limit(200);
    return res.json({ data: parents.map(serializeParent) });
  } catch (error) {
    console.error('List parent accounts failed:', error.message);
    return res.status(500).json({ message: 'Không thể tải danh sách tài khoản phụ huynh' });
  }
};

const linkParentStudents = async (req, res) => {
  try {
    const parent = await findParent(req.params.id);
    if (!parent) return res.status(404).json({ message: 'Không tìm thấy tài khoản phụ huynh' });

    const suppliedIds = req.body.studentIds;
    if (!Array.isArray(suppliedIds) || suppliedIds.some((id) => !mongoose.isValidObjectId(id))) {
      return res.status(400).json({ message: 'studentIds phải là danh sách mã học sinh hợp lệ' });
    }
    const uniqueIds = [...new Set(suppliedIds.map(String))];
    const requestedClassroomId = parent.parentInfo?.requestedClassroomId;
    const studentFilter = { _id: { $in: uniqueIds }, status: 'enrolled' };
    if (requestedClassroomId) studentFilter.classroomId = requestedClassroomId;
    const studentCount = await Student.countDocuments(studentFilter);
    if (studentCount !== uniqueIds.length) {
      return res.status(400).json({ message: requestedClassroomId ? 'Chỉ được liên kết học sinh đang theo học trong lớp phụ huynh đã đăng ký' : 'Có học sinh không tồn tại hoặc không còn đang theo học' });
    }

    const before = { studentIds: (parent.parentInfo?.studentIds || []).map(String) };
    parent.parentInfo = { ...parent.parentInfo?.toObject?.(), studentIds: uniqueIds };
    await parent.save();
    const after = { studentIds: uniqueIds };
    await writeAudit(req, 'PARENT_STUDENTS_LINKED', parent, before, after, req.body.reason || '');
    return res.json({ message: 'Đã liên kết hồ sơ học sinh với phụ huynh', data: serializeParent(parent) });
  } catch (error) {
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
    const parent = await findParent(req.params.id);
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
    console.error('Update parent status failed:', error.message);
    return res.status(500).json({ message: 'Không thể cập nhật trạng thái tài khoản phụ huynh' });
  }
};

const listInternalAccounts = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const filter = { role: { $in: internalRoles } };
    const [accounts, total] = await Promise.all([
      User.find(filter)
        .select('username role status profile employeeInfo createdAt lastLogin')
        .sort({ role: 1, 'profile.fullName': 1, username: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      User.countDocuments(filter)
    ]);
    const employees = await Employee.find({ userId: { $in: accounts.map((account) => account._id) } })
      .select('userId employeeCode').lean();
    const employeeByUserId = new Map(employees.map((employee) => [String(employee.userId), employee]));
    return res.json({ success: true, data: accounts.map((account) => serializeInternalAccount(account, employeeByUserId.get(String(account._id)))), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('List internal accounts failed:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể tải danh sách tài khoản nội bộ' });
  }
};

const createInternalAccount = async (req, res) => {
  try {
    const { username, password, profile = {}, role } = req.body;
    const validationError = validateInternalAccount({ username, password, profile, role }, req.user);
    if (validationError) return res.status(422).json({ success: false, message: validationError });

    const normalizedUsername = username.trim();
    if (await User.exists({ username: normalizedUsername })) {
      return res.status(409).json({ success: false, message: 'Tên đăng nhập đã tồn tại' });
    }
    const passwordHash = await hashPassword(password);
    const { account, employee } = await runLinkedAccountTransaction(async (session) => {
      const [createdAccount] = await User.create([{
        username: normalizedUsername,
        passwordHash,
        role,
        status: 'active',
        permissions: [],
        profile: {
          fullName: profile.fullName.trim(),
          phone: String(profile.phone || '').trim(),
          email: String(profile.email || '').trim().toLowerCase(),
          address: String(profile.address || '').trim()
        }
      }], { session });
      const employeeCode = `${{ principal: 'HT', teacher: 'GV', accountant: 'KT', chef: 'BEP', guard: 'BV', hr: 'NS' }[role]}-${new Date().getFullYear()}-${String(createdAccount._id).slice(-6).toUpperCase()}`;
      const [createdEmployee] = await Employee.create([{
        userId: createdAccount._id, employeeCode, fullName: createdAccount.profile.fullName,
        phone: createdAccount.profile.phone, email: createdAccount.profile.email,
        gender: null, contractType: null, startDate: null, qualification: { degree: '', major: '' },
        position: positionByRole[role], payrollRole: role, status: 'active',
        salaryConfig: { baseSalary: 0, positionAllowance: 0, lunchAllowance: 0 }
      }], { session });
      createdAccount.employeeInfo = { employeeId: employeeCode, position: positionByRole[role], baseSalary: 0 };
      await createdAccount.save({ session });
      await writeAudit(req, 'INTERNAL_ACCOUNT_CREATED', createdAccount, {}, {
        username: createdAccount.username, role: createdAccount.role, status: createdAccount.status, employeeCode
      }, '', session);
      return { account: createdAccount, employee: createdEmployee };
    });
    return res.status(201).json({ success: true, message: 'Đã tạo tài khoản và liên kết hồ sơ nhân sự', data: serializeInternalAccount(account, employee) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, message: 'Tên đăng nhập đã tồn tại' });
    console.error('Create internal account failed:', error.message);
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Không thể tạo tài khoản nội bộ' });
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
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'ID tài khoản không hợp lệ' });
    const account = await User.findOne({ _id: req.params.id, role: { $in: internalRoles } });
    if (!account) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản nội bộ' });
    const targetError = canManageInternalTarget(req.user, account);
    if (targetError) return res.status(409).json({ success: false, message: targetError });
    const { username, password, profile = {}, role, status } = req.body;
    if (username !== undefined && (typeof username !== 'string' || !usernamePattern.test(username.trim()))) return res.status(422).json({ success: false, message: 'Tên đăng nhập không hợp lệ' });
    if (password !== undefined && (typeof password !== 'string' || password.length < 8 || password.length > 72)) return res.status(422).json({ success: false, message: 'Mật khẩu phải có từ 8 đến 72 ký tự' });
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return res.status(422).json({ success: false, message: 'Hồ sơ tài khoản không hợp lệ' });
    if (profile.fullName !== undefined && (typeof profile.fullName !== 'string' || !profile.fullName.trim() || profile.fullName.length > 120)) return res.status(422).json({ success: false, message: 'Họ và tên phải có từ 1 đến 120 ký tự' });
    if (profile.phone !== undefined && (typeof profile.phone !== 'string' || (profile.phone && !phonePattern.test(profile.phone.trim())))) return res.status(422).json({ success: false, message: 'Số điện thoại không hợp lệ' });
    if (profile.email !== undefined && (typeof profile.email !== 'string' || (profile.email && (profile.email.length > 254 || !emailPattern.test(profile.email.trim()))))) return res.status(422).json({ success: false, message: 'Email không hợp lệ' });
    if (role !== undefined && (!assignableStaffRoles.includes(role) || !canAssignStaffRole(req.user, role))) return res.status(422).json({ success: false, message: 'Bạn không có quyền gán vai trò này' });
    if (status !== undefined && !manageableStatuses.includes(status)) return res.status(422).json({ success: false, message: 'Trạng thái tài khoản không hợp lệ' });

    const nextUsername = username === undefined ? account.username : String(username).trim();
    if (nextUsername !== account.username && await User.exists({ username: nextUsername, _id: { $ne: account._id } })) {
      return res.status(409).json({ success: false, message: 'Tên đăng nhập đã tồn tại' });
    }
    const linkedEmployee = await Employee.findOne({ userId: account._id });
    if (linkedEmployee?.status === 'resigned' && status === 'active') {
      return res.status(409).json({ success: false, message: 'Nhân viên đã nghỉ việc. Cần xử lý hồ sơ tái tuyển dụng trước khi mở lại tài khoản.' });
    }
    if (account.role === 'teacher' && role && role !== 'teacher'
      && await Classroom.exists({ status: 'active', 'teachers.teacherId': account._id })) {
      return res.status(409).json({ success: false, message: 'Giáo viên đang được phân công lớp. Hãy chuyển phân công lớp trước khi đổi vai trò.' });
    }

    const applyUpdate = async (session) => {
      const target = session ? await User.findById(account._id).session(session) : account;
      const employee = session ? await Employee.findOne({ userId: account._id }).session(session) : null;
      if (!target || (session && !employee)) {
        const error = new Error('Liên kết hồ sơ nhân sự đã thay đổi. Vui lòng tải lại danh sách.');
        error.statusCode = 409;
        throw error;
      }
      const before = { username: target.username, role: target.role, status: target.status, profile: target.profile?.toObject?.() || target.profile, authVersion: target.authVersion || 0 };
      target.username = nextUsername;
      if (profile.fullName !== undefined) target.profile.fullName = profile.fullName.trim();
      if (profile.phone !== undefined) target.profile.phone = String(profile.phone || '').trim();
      if (profile.email !== undefined) target.profile.email = String(profile.email || '').trim().toLowerCase();
      if (role !== undefined) target.role = role;
      if (status !== undefined) target.status = status;
      if (password !== undefined) target.passwordHash = await hashPassword(password);
      target.authVersion = (target.authVersion || 0) + 1;

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
      await target.save(session ? { session } : {});
      await writeAudit(req, 'INTERNAL_ACCOUNT_UPDATED', target, before,
        { username: target.username, role: target.role, status: target.status, profile: target.profile, authVersion: target.authVersion }, '', session);
      return { target, employee };
    };
    const updated = linkedEmployee ? await runLinkedAccountTransaction(applyUpdate) : await applyUpdate(null);
    return res.json({ success: true, message: 'Đã cập nhật tài khoản', data: serializeInternalAccount(updated.target, updated.employee) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, message: 'Tên đăng nhập đã tồn tại' });
    console.error('Update internal account failed:', error.message);
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Không thể cập nhật tài khoản' });
  }
};

const deactivateInternalAccount = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'ID tài khoản không hợp lệ' });
    const account = await User.findOne({ _id: req.params.id, role: { $in: internalRoles } });
    if (!account) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản nội bộ' });
    const targetError = canManageInternalTarget(req.user, account);
    if (targetError) return res.status(409).json({ success: false, message: targetError });
    const before = { status: account.status, authVersion: account.authVersion || 0 };
    if (account.status !== 'inactive') {
      account.status = 'inactive';
      account.authVersion = (account.authVersion || 0) + 1;
      await account.save();
      await writeAudit(req, 'INTERNAL_ACCOUNT_DEACTIVATED', account, before, { status: account.status, authVersion: account.authVersion }, req.body?.reason || 'Thu hồi quyền truy cập');
    }
    return res.json({ success: true, message: 'Đã thu hồi quyền truy cập tài khoản', data: serializeInternalAccount(account) });
  } catch (error) {
    console.error('Deactivate internal account failed:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể thu hồi tài khoản' });
  }
};

module.exports = {
  linkParentStudents,
  listParents,
  updateParentStatus,
  listInternalAccounts,
  createInternalAccount,
  updateInternalAccountRole,
  updateInternalAccount,
  deactivateInternalAccount
};
