const { verifyToken } = require('../utils/jwt');
const User = require('../models/zone1_system/User');

const auth = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token) {
            throw new Error();
        }
        const decoded = verifyToken(token);
        const user = await User.findById(decoded.id).select('-passwordHash');
        if (!user) {
            throw new Error();
        }
        req.user = user;
        req.token = token;
        next();
    } catch (err) {
        res.status(401).json({ message: 'Vui lòng đăng nhập để tiếp tục' });
    }
};

module.exports = auth;