const User = require('../models/zone1_system/User');
const Permission = require('../models/zone1_system/Permission');
const { hashPassword, comparePassword } = require('../utils/passwordHash');
const { generateToken } = require('../utils/jwt');

// Đăng ký
const register = async (req, res) => {
  try {
    const { username, password, role, profile, permissions } = req.body;

    // Kiểm tra username đã tồn tại
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: 'Tên đăng nhập đã tồn tại' });
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Xử lý permissions nếu có
    let permissionIds = [];
    if (permissions && permissions.length > 0) {
      const foundPerms = await Permission.find({ name: { $in: permissions } });
      permissionIds = foundPerms.map(p => p._id);
    }

    // Tạo user mới
    const user = new User({
      username,
      passwordHash: hashedPassword,
      role: role || 'parent',
      profile,
      permissions: permissionIds
    });

    await user.save();

    // Populate permissions để trả về
    await user.populate('permissions', 'name');

    // Tạo token
    const token = generateToken(user);

    // Trả về thông tin (không trả password)
    const userResponse = user.toObject();
    delete userResponse.passwordHash;

    res.status(201).json({
      message: 'Đăng ký thành công',
      user: userResponse,
      token
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

// Đăng nhập
const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    // Tìm user
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ message: 'Tên đăng nhập hoặc mật khẩu không đúng' });
    }

    // Kiểm tra trạng thái
    if (user.status === 'locked') {
      return res.status(403).json({ message: 'Tài khoản đã bị khóa' });
    }
    if (user.status === 'inactive') {
      return res.status(403).json({ message: 'Tài khoản chưa được kích hoạt' });
    }

    // So sánh password
    const isMatch = await comparePassword(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Tên đăng nhập hoặc mật khẩu không đúng' });
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
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

// Lấy thông tin user hiện tại (kèm permissions)
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-passwordHash')
      .populate('permissions', 'name');

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
    const { permissions } = req.body; // mảng tên quyền

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
  login,
  getMe,
  getAllPermissions,
  updateUserPermissions
};