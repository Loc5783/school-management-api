const mongoose = require('mongoose');
const AuditLog = require('../models/zone1_system/AuditLog');
const Student = require('../models/zone3_school/Student');
const User = require('../models/zone1_system/User');
const Employee = require('../models/zone2_hr/Employee');
const { hashPassword } = require('../utils/passwordHash');

const manageableStatuses = ['active', 'inactive', 'suspended'];
const assignableStaffRoles = ['principal', 'teacher', 'accountant', 'chef', 'guard', 'hr'];
const internalRoles = ['admin', ...assignableStaffRoles];
const usernamePattern = /^[a-zA-Z0-9._-]{3,50}$/;

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

const serializeInternalAccount = (user) => ({
  _id: user._id,
  username: user.username,
  role: user.role,
  profile: {
    fullName: user.profile?.fullName,
    phone: user.profile?.phone,
    email: user.profile?.email
  },
  status: user.status,
  employeeId: user.employeeInfo?.employeeId || '',
  createdAt: user.createdAt,
  lastLogin: user.lastLogin
});

const canAssignStaffRole = (actor, role) => actor?.role === 'admin'
  || (['principal', 'hr'].includes(actor?.role) && ['teacher', 'accountant', 'chef', 'guard', 'hr'].includes(role));

const validateInternalAccount = ({ username, password, profile, role }, actor) => {
  if (!usernamePattern.test(String(username || ''))) return 'Tên đăng nhập chỉ gồm chữ, số, dấu chấm, gạch dưới hoặc gạch ngang (3-50 ký tự)';
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) return 'Mật khẩu phải có từ 8 đến 72 ký tự';
  if (!String(profile?.fullName || '').trim()) return 'Vui lòng nhập họ và tên';
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

const writeAudit = (req, action, target, before, after, reason = '') => AuditLog.create({
  actorId: req.user._id,
  actorUsername: req.user.username,
  action,
  targetType: 'User',
  targetId: target._id,
  before,
  after,
  reason: reason.trim(),
  requestId: req.header('X-Request-Id') || undefined
});

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
    return res.json({ success: true, data: accounts.map(serializeInternalAccount), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
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
    const account = await User.create({
      username: normalizedUsername,
      passwordHash: await hashPassword(password),
      role,
      status: 'active',
      permissions: [],
      profile: {
        fullName: profile.fullName.trim(),
        phone: String(profile.phone || '').trim(),
        email: String(profile.email || '').trim().toLowerCase(),
        address: String(profile.address || '').trim()
      }
    });
    await writeAudit(req, 'INTERNAL_ACCOUNT_CREATED', account, {}, { username: account.username, role: account.role, status: account.status });
    return res.status(201).json({ success: true, message: 'Đã tạo tài khoản nội bộ', data: serializeInternalAccount(account) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, message: 'Tên đăng nhập đã tồn tại' });
    console.error('Create internal account failed:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể tạo tài khoản nội bộ' });
  }
};

const updateInternalAccountRole = async (req, res) => {
  try {
    const { role } = req.body;
    if (!assignableStaffRoles.includes(role) || !canAssignStaffRole(req.user, role)) {
      return res.status(422).json({ success: false, message: 'Bạn không có quyền gán vai trò này' });
    }
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'ID tài khoản không hợp lệ' });
    const account = await User.findOne({ _id: req.params.id, role: { $in: internalRoles } });
    if (!account) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản nội bộ' });
    const targetError = canManageInternalTarget(req.user, account);
    if (targetError) return res.status(409).json({ success: false, message: targetError });
    if (await Employee.exists({ userId: account._id })) {
      return res.status(409).json({ success: false, message: 'Tài khoản đã gắn hồ sơ nhân sự. Hãy cập nhật hồ sơ nhân sự trước khi đổi vai trò.' });
    }
    const before = { role: account.role, authVersion: account.authVersion || 0 };
    if (account.role !== role) {
      account.role = role;
      account.authVersion = (account.authVersion || 0) + 1;
      await account.save();
      await writeAudit(req, 'INTERNAL_ACCOUNT_ROLE_CHANGED', account, before, { role: account.role, authVersion: account.authVersion });
    }
    return res.json({ success: true, message: 'Đã cập nhật vai trò tài khoản', data: serializeInternalAccount(account) });
  } catch (error) {
    console.error('Update internal account role failed:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể cập nhật vai trò tài khoản' });
  }
};

const updateInternalAccount = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'ID tài khoản không hợp lệ' });
    const account = await User.findOne({ _id: req.params.id, role: { $in: internalRoles } });
    if (!account) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản nội bộ' });
    const targetError = canManageInternalTarget(req.user, account);
    if (targetError) return res.status(409).json({ success: false, message: targetError });
    if (await Employee.exists({ userId: account._id })) {
      return res.status(409).json({ success: false, message: 'Tài khoản đã gắn hồ sơ nhân sự. Hãy cập nhật thông tin ở mục Nhân sự & Lương.' });
    }

    const { username, password, profile = {}, role, status } = req.body;
    if (username !== undefined && !usernamePattern.test(String(username))) return res.status(422).json({ success: false, message: 'Tên đăng nhập không hợp lệ' });
    if (password !== undefined && (typeof password !== 'string' || password.length < 8 || password.length > 72)) return res.status(422).json({ success: false, message: 'Mật khẩu phải có từ 8 đến 72 ký tự' });
    if (profile.fullName !== undefined && !String(profile.fullName).trim()) return res.status(422).json({ success: false, message: 'Họ và tên là bắt buộc' });
    if (role !== undefined && (!assignableStaffRoles.includes(role) || !canAssignStaffRole(req.user, role))) return res.status(422).json({ success: false, message: 'Bạn không có quyền gán vai trò này' });
    if (status !== undefined && !manageableStatuses.includes(status)) return res.status(422).json({ success: false, message: 'Trạng thái tài khoản không hợp lệ' });

    const nextUsername = username === undefined ? account.username : String(username).trim();
    if (nextUsername !== account.username && await User.exists({ username: nextUsername, _id: { $ne: account._id } })) {
      return res.status(409).json({ success: false, message: 'Tên đăng nhập đã tồn tại' });
    }
    const before = { username: account.username, role: account.role, status: account.status, profile: account.profile?.toObject?.() || account.profile, authVersion: account.authVersion || 0 };
    account.username = nextUsername;
    if (profile.fullName !== undefined) account.profile.fullName = String(profile.fullName).trim();
    if (profile.phone !== undefined) account.profile.phone = String(profile.phone || '').trim();
    if (profile.email !== undefined) account.profile.email = String(profile.email || '').trim().toLowerCase();
    if (role !== undefined) account.role = role;
    if (status !== undefined) account.status = status;
    if (password !== undefined) account.passwordHash = await hashPassword(password);
    account.authVersion = (account.authVersion || 0) + 1;
    await account.save();
    await writeAudit(req, 'INTERNAL_ACCOUNT_UPDATED', account, before, { username: account.username, role: account.role, status: account.status, profile: account.profile, authVersion: account.authVersion });
    return res.json({ success: true, message: 'Đã cập nhật tài khoản', data: serializeInternalAccount(account) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, message: 'Tên đăng nhập đã tồn tại' });
    console.error('Update internal account failed:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể cập nhật tài khoản' });
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
