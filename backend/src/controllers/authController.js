const User = require('../models/zone1_system/User');
const Classroom = require('../models/zone3_school/Classroom');
const mongoose = require('mongoose');
const Permission = require('../models/zone1_system/Permission');
const { hashPassword, comparePassword } = require('../utils/passwordHash');
const { generateToken } = require('../utils/jwt');

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,50}$/;
const hasLinkedStudent = (user) => Array.isArray(user?.parentInfo?.studentIds) && user.parentInfo.studentIds.length > 0;

const validatePublicRegistration = ({ username, password, profile, parentInfo }) => {
  if (!USERNAME_PATTERN.test(String(username || ''))) {
    return 'Tên đăng nhập chỉ gồm chữ, số, dấu chấm, gạch dưới hoặc gạch ngang (3-50 ký tự)';
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
    return 'Mật khẩu phải có từ 8 đến 72 ký tự';
  }
  if (!profile?.fullName || !String(profile.fullName).trim()) {
    return 'Vui lòng nhập họ tên phụ huynh';
  }
  if (!mongoose.isValidObjectId(parentInfo?.requestedClassroomId)) {
    return 'Vui lòng chọn lớp học của con để nhà trường xác minh';
  }
  const note = String(parentInfo?.registrationNote || '').trim();
  if (note.length < 2 || note.length > 500) {
    return 'Vui lòng nhập tên học sinh hoặc ghi chú xác minh (2-500 ký tự)';
  }
  return null;
};

const getRegistrationClassrooms = async (req, res) => {
  return res.status(403).json({
    success: false,
    message: 'Chức năng tự đăng ký tài khoản đã bị vô hiệu hóa.'
  });
};

const changeMyPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 72) {
      return res.status(422).json({ message: 'Nhập mật khẩu hiện tại và mật khẩu mới từ 8 đến 72 ký tự' });
    }
    if (currentPassword === newPassword) return res.status(422).json({ message: 'Mật khẩu mới phải khác mật khẩu hiện tại' });
    const tenantScope = req.tenantId || req.user?.tenantId
      ? { tenantId: req.tenantId || req.user.tenantId }
      : { tenantId: { $in: [null, undefined] } };
    const account = await User.findOne({ _id: req.user._id, ...tenantScope }).select('passwordHash authVersion');
    if (!account || !await comparePassword(currentPassword, account.passwordHash)) return res.status(400).json({ message: 'Mật khẩu hiện tại không đúng' });
    const changed = await User.updateOne({ _id: account._id, ...tenantScope, authVersion: account.authVersion || 0 }, {
      $set: { passwordHash: await hashPassword(newPassword) }, $inc: { authVersion: 1 }
    });
    if (!changed.modifiedCount) return res.status(409).json({ message: 'Tài khoản vừa thay đổi, vui lòng đăng nhập lại' });
    return res.json({ message: 'Đã đổi mật khẩu. Vui lòng đăng nhập lại.' });
  } catch (error) {
    console.error('Change own password failed:', error.message);
    return res.status(500).json({ message: 'Không thể đổi mật khẩu' });
  }
};

// Chức năng tự đăng ký tài khoản công khai đã bị vô hiệu hóa
const register = async (req, res) => {
  return res.status(403).json({
    success: false,
    message: 'Chức năng tự đăng ký tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ nhà trường để được cấp tài khoản.'
  });
};

// Đăng nhập
const login = async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      return res.status(400).json({ message: 'Vui lòng nhập tên đăng nhập và mật khẩu' });
    }

    // Tìm user
    const user = await User.findOne({ username: username.trim(), tenantId: { $in: [null, undefined] } });
    if (!user) {
      return res.status(401).json({ message: 'Tên đăng nhập hoặc mật khẩu không đúng' });
    }

    // So sánh password
    const isMatch = await comparePassword(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Tên đăng nhập hoặc mật khẩu không đúng' });
    }
    if (user.status !== 'active' || (user.accessEndsAt && user.accessEndsAt <= new Date())) {
      return res.status(403).json({ message: 'Tài khoản chưa được kích hoạt hoặc đang tạm ngưng' });
    }
    if (user.role === 'parent' && !hasLinkedStudent(user)) {
      return res.status(403).json({
        code: 'PARENT_STUDENT_NOT_LINKED',
        message: 'Tài khoản phụ huynh chưa được liên kết với hồ sơ học sinh. Vui lòng liên hệ nhà trường.'
      });
    }

    // Cập nhật lần đăng nhập cuối
    user.lastLogin = new Date();
    await user.save();

    // Populate permissions
    await user.populate('permissions', 'name');

    // Tạo token
    const token = generateToken(user);

    // Trả về thông tin
    const userResponse = user.toObject();
    delete userResponse.passwordHash;

    res.json({
      message: 'Đăng nhập thành công',
      user: userResponse,
      token
    });
  } catch (err) {
    console.error('Login failed:', err.message);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

// Lấy thông tin user hiện tại (kèm permissions)
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-passwordHash')
      .populate('permissions', 'name');
    if (!user) {
      return res.status(401).json({ message: 'Phiên đăng nhập không còn hiệu lực' });
    }

    // Lấy danh sách tên quyền để frontend sử dụng
    const permissions = user.permissions ? user.permissions.map(p => p.name) : [];

    res.json({
      ...user.toObject(),
      permissions
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

// Lấy danh sách tất cả permissions (cho admin)
const getAllPermissions = async (req, res) => {
  try {
    const permissions = await Permission.find().sort({ module: 1, name: 1 });
    res.json({
      message: 'Lấy danh sách quyền thành công',
      data: permissions
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

// Cập nhật permissions cho user (chỉ admin)
const updateUserPermissions = async (req, res) => {
  try {
    const { userId } = req.params;
    const { permissions } = req.body || {}; // mảng tên quyền
    if (!User.db.base.isValidObjectId(userId)) {
      return res.status(400).json({ message: 'ID người dùng không hợp lệ' });
    }
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ message: 'Danh sách quyền phải là một mảng' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy user' });
    }

    const permDocs = await Permission.find({ name: { $in: permissions } });
    user.permissions = permDocs.map(p => p._id);
    await user.save();

    await user.populate('permissions', 'name');

    res.json({
      message: 'Cập nhật quyền thành công',
      data: user
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

module.exports = {
  register,
  getRegistrationClassrooms,
  login,
  getMe,
  changeMyPassword,
  getAllPermissions,
  updateUserPermissions
};
