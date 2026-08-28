const User = require('../models/zone1_system/User');

/**
 * Middleware kiểm tra quyền của user
 * @param {string} requiredPermission - Tên quyền cần kiểm tra (VD: 'student.create')
 * @returns {Function} Middleware function
 */
const checkPermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Vui lòng đăng nhập' });
      }

      // Admin có toàn quyền
      if (req.user.role === 'admin') {
        return next();
      }

      // Lấy user với permissions đã populate
      const user = await User.findById(req.user._id).populate('permissions', 'name');
      const userPerms = user.permissions.map(p => p.name);

      // Kiểm tra quyền cụ thể hoặc system.manage
      if (userPerms.includes(requiredPermission) || userPerms.includes('system.manage')) {
        return next();
      }

      return res.status(403).json({
        message: 'Bạn không có quyền thực hiện hành động này',
        required: requiredPermission,
        your_permissions: userPerms
      });
    } catch (err) {
      console.error('CheckPermission error:', err);
      return res.status(500).json({ message: 'Lỗi server' });
    }
  };
};

module.exports = checkPermission;
