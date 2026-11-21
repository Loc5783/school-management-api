const { verifyToken } = require('../utils/jwt');
const User = require('../models/zone1_system/User');

const hasLinkedStudent = (user) => Array.isArray(user?.parentInfo?.studentIds) && user.parentInfo.studentIds.length > 0;

const auth = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ message: 'Vui lòng đăng nhập để tiếp tục' });
        }
        const decoded = verifyToken(token);

        // Domain isolation: Legacy auth middleware strictly rejects tokens from SaaS, platform, MFA challenge, or support scopes
        if (decoded.purpose || decoded.tenantId) {
            return res.status(401).json({ message: 'Token đa trường không được phép truy cập hệ thống đơn trường' });
        }

        const user = await User.findById(decoded.sub).select('-passwordHash');
        if (!user || user.status !== 'active' || (user.accessEndsAt && user.accessEndsAt <= new Date()) || decoded.authVersion !== (user.authVersion || 0)) {
            return res.status(401).json({ message: 'Phiên đăng nhập không còn hiệu lực' });
        }

        // Domain isolation: Users assigned to a tenant cannot access legacy single-tenant endpoints
        if (user.tenantId) {
            return res.status(401).json({ message: 'Tài khoản thuộc trường học độc lập không thể truy cập hệ thống đơn trường' });
        }

        if (user.role === 'parent' && !hasLinkedStudent(user)) {
            return res.status(403).json({
                code: 'PARENT_STUDENT_NOT_LINKED',
                message: 'Tài khoản phụ huynh chưa được liên kết với hồ sơ học sinh. Vui lòng liên hệ nhà trường.'
            });
        }
        req.user = user;
        next();
    } catch (err) {
        res.status(401).json({ message: 'Vui lòng đăng nhập để tiếp tục' });
    }
};

module.exports = auth;
