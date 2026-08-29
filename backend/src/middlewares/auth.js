const { verifyToken } = require('../utils/jwt');
const User = require('../models/zone1_system/User');

const auth = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ message: 'Vui lòng đăng nhập để tiếp tục' });
        }
        const decoded = verifyToken(token);
        const user = await User.findById(decoded.sub).select('-passwordHash');
        if (!user || user.status !== 'active' || decoded.authVersion !== (user.authVersion || 0)) {
            return res.status(401).json({ message: 'Phiên đăng nhập không còn hiệu lực' });
        }
        req.user = user;
        next();
    } catch (err) {
        res.status(401).json({ message: 'Vui lòng đăng nhập để tiếp tục' });
    }
};

module.exports = auth;
