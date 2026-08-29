const User = require('../models/zone1_system/User');
const Permission = require('../models/zone1_system/Permission');
const { hashPassword, comparePassword } = require('../utils/passwordHash');
const { generateToken } = require('../utils/jwt');

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,50}$/;

const validatePublicRegistration = ({ username, password, profile }) => {
  if (!USERNAME_PATTERN.test(String(username || ''))) {
    return 'Tên đăng nhập chỉ gồm chữ, số, dấu chấm, gạch dưới hoặc gạch ngang (3-50 ký tự)';
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
    return 'Mật khẩu phải có từ 8 đến 72 ký tự';
  }
  if (!profile?.fullName || !String(profile.fullName).trim()) {
    return 'Vui lòng nhập họ tên phụ huynh';
  }
  return null;
};

// Public registration is intentionally limited to pending parent accounts.
const register = async (req, res) => {
  try {
    const { username, password, profile } = req.body;
    if (Object.hasOwn(req.body, 'role') || Object.hasOwn(req.body, 'permissions')) {
      return res.status(400).json({ message: 'Đăng ký công khai không cho phép chọn vai trò hoặc quyền' });
    }
    const validationError = validatePublicRegistration({ username, password, profile });
    if (validationError) return res.status(400).json({ message: validationError });

    // Kiểm tra username đã tồn tại
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: 'Tên đăng nhập đã tồn tại' });
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Principal activates the account and links children after verification.
    const user = new User({
      username: username.trim(),
      passwordHash: hashedPassword,
      role: 'parent',
      profile: {
        fullName: profile.fullName.trim(),
        phone: profile.phone?.trim(),
        email: profile.email?.trim().toLowerCase(),
        address: profile.address?.trim()
      },
      permissions: [],
      status: 'inactive'
    });

    await user.save();

    res.status(201).json({
      message: 'Đã gửi đăng ký. Nhà trường sẽ kích hoạt tài khoản sau khi xác minh.',
      data: { id: user._id, username: user.username, role: user.role, status: user.status }
    });
  } catch (err) {
    if (err?.code === 11000) return res.status(400).json({ message: 'Tên đăng nhập đã tồn tại' });
    console.error('Public registration failed:', err.message);
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

    // So sánh password
    const isMatch = await comparePassword(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Tên đăng nhập hoặc mật khẩu không đúng' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ message: 'Tài khoản chưa được kích hoạt hoặc đang tạm ngưng' });
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
