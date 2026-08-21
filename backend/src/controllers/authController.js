const User = require('../models/zone1_system/User');
const { hashPassword, comparePassword } = require('../utils/passwordHash');
const { generateToken } = require('../utils/jwt');

// Đăng ký
const register = async (req, res) => {
    try {
        const { username, password, role, profile } = req.body;

        // Kiểm tra username đã tồn tại
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: 'Tên đăng nhập đã tồn tại' });
        }

        // Hash password
        const hashedPassword = await hashPassword(password);

        // Tạo user mới
        const user = new User({
            username,
            passwordHash: hashedPassword,
            role: role || 'parent', // Mặc định là parent
            profile
        });

        await user.save();

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

// Lấy thông tin user hiện tại
const getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('-passwordHash');
        res.json(user);
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server' });
    }
};

module.exports = { register, login, getMe };    