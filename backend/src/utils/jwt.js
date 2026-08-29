const jwt = require('jsonwebtoken');

const issuer = process.env.JWT_ISSUER || 'school-management-api';
const audience = process.env.JWT_AUDIENCE || 'school-management-web';
const expiresIn = process.env.JWT_EXPIRES_IN || '8h';

const signingSecret = () => {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
        throw new Error('JWT_SECRET phải có ít nhất 32 ký tự');
    }
    return process.env.JWT_SECRET;
};

const generateToken = (user) => {
    return jwt.sign(
        { username: user.username, authVersion: user.authVersion || 0 },
        signingSecret(),
        {
            algorithm: 'HS256',
            audience,
            expiresIn,
            issuer,
            subject: user._id.toString()
        }
    );
};

const verifyToken = (token) => {
    return jwt.verify(token, signingSecret(), {
        algorithms: ['HS256'],
        audience,
        issuer
    });
};

module.exports = { generateToken, verifyToken };
