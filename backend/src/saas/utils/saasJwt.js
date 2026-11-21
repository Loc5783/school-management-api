const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const getIssuer = () => process.env.JWT_ISSUER || 'school-management-api';
const getAudience = () => process.env.JWT_AUDIENCE || 'school-management-web';

const getSigningSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET phải có ít nhất 32 ký tự');
  }
  return secret;
};

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

function validateTokenClaims(decoded, expectedPurpose) {
  if (!decoded || typeof decoded !== 'object') {
    throw new Error('TOKEN_MALFORMED: Payload không hợp lệ');
  }

  // 1. Validate sub
  if (!decoded.sub || typeof decoded.sub !== 'string' || !OBJECT_ID_REGEX.test(decoded.sub)) {
    throw new Error('INVALID_TOKEN_CLAIMS: sub phải là ObjectId 24 ký tự hợp lệ');
  }

  // 2. Validate purpose
  const allowedPurposes = ['SCHOOL_USER_ACCESS', 'PLATFORM_ADMIN_ACCESS', 'PRE_AUTH_MFA_CHALLENGE', 'SUPPORT_ACCESS'];
  if (!decoded.purpose || !allowedPurposes.includes(decoded.purpose)) {
    throw new Error('INVALID_TOKEN_CLAIMS: purpose không hợp lệ');
  }

  if (expectedPurpose && decoded.purpose !== expectedPurpose) {
    throw new Error(`INVALID_TOKEN_CLAIMS: purpose '${decoded.purpose}' không khớp với yêu cầu '${expectedPurpose}'`);
  }

  // 3. Validate issuer and audience
  if (decoded.iss !== getIssuer()) {
    throw new Error('INVALID_TOKEN_CLAIMS: Issuer không hợp lệ');
  }
  if (decoded.aud !== getAudience()) {
    throw new Error('INVALID_TOKEN_CLAIMS: Audience không hợp lệ');
  }

  // 4. Validate iat and exp (Strictly required!)
  if (!Number.isInteger(decoded.iat) || decoded.iat <= 0) {
    throw new Error('INVALID_TOKEN_CLAIMS: iat phải là số nguyên dương');
  }
  if (!Number.isInteger(decoded.exp) || decoded.exp <= decoded.iat) {
    throw new Error('MISSING_OR_INVALID_EXP_CLAIM: exp phải là số nguyên lớn hơn iat');
  }

  // 5. Validate authVersion (non-negative integer, 0 is valid!)
  if (!Number.isInteger(decoded.authVersion) || decoded.authVersion < 0) {
    throw new Error('INVALID_TOKEN_CLAIMS: authVersion phải là số nguyên không âm');
  }

  // 6. Purpose specific validations
  if (decoded.purpose === 'SCHOOL_USER_ACCESS') {
    if (!decoded.tenantId || typeof decoded.tenantId !== 'string' || !OBJECT_ID_REGEX.test(decoded.tenantId)) {
      throw new Error('INVALID_TOKEN_CLAIMS: tenantId phải là ObjectId 24 ký tự hợp lệ');
    }
    if (!Number.isInteger(decoded.tenantAuthVersion) || decoded.tenantAuthVersion < 0) {
      throw new Error('INVALID_TOKEN_CLAIMS: tenantAuthVersion phải là số nguyên không âm');
    }
    if (!decoded.schoolCode || typeof decoded.schoolCode !== 'string' || !decoded.schoolCode.trim()) {
      throw new Error('INVALID_TOKEN_CLAIMS: schoolCode là bắt buộc');
    }
    if (!decoded.jti || typeof decoded.jti !== 'string') {
      throw new Error('INVALID_TOKEN_CLAIMS: jti session id là bắt buộc');
    }
  } else if (decoded.purpose === 'PLATFORM_ADMIN_ACCESS' || decoded.purpose === 'PRE_AUTH_MFA_CHALLENGE') {
    const validPlatformRoles = ['platform_lead', 'platform_support'];
    if (!decoded.role || !validPlatformRoles.includes(decoded.role)) {
      throw new Error('INVALID_TOKEN_CLAIMS: role platform không hợp lệ');
    }
    if (!decoded.jti || typeof decoded.jti !== 'string') {
      throw new Error('INVALID_TOKEN_CLAIMS: jti là bắt buộc');
    }
  }

  return true;
}

const generateSchoolUserToken = (user, tenant, expiresIn = '8h') => {
  const jti = crypto.randomUUID();
  return jwt.sign(
    {
      sub: user._id.toString(),
      username: user.username,
      role: user.role,
      tenantId: tenant._id.toString(),
      schoolCode: tenant.code,
      authVersion: Number.isInteger(user.authVersion) ? user.authVersion : 0,
      tenantAuthVersion: Number.isInteger(tenant.authVersion) ? tenant.authVersion : 0,
      purpose: 'SCHOOL_USER_ACCESS',
      jti
    },
    getSigningSecret(),
    {
      algorithm: 'HS256',
      audience: getAudience(),
      issuer: getIssuer(),
      expiresIn
    }
  );
};

const generateMfaChallengeToken = (admin, expiresIn = '5m', customJti = null) => {
  const jti = customJti || crypto.randomUUID();
  return jwt.sign(
    {
      sub: admin._id.toString(),
      username: admin.username,
      role: admin.role,
      authVersion: Number.isInteger(admin.authVersion) ? admin.authVersion : 0,
      purpose: 'PRE_AUTH_MFA_CHALLENGE',
      jti
    },
    getSigningSecret(),
    {
      algorithm: 'HS256',
      audience: getAudience(),
      issuer: getIssuer(),
      expiresIn
    }
  );
};

const generatePlatformAdminToken = (admin, expiresIn = '8h') => {
  const jti = crypto.randomUUID();
  return jwt.sign(
    {
      sub: admin._id.toString(),
      username: admin.username,
      role: admin.role,
      authVersion: Number.isInteger(admin.authVersion) ? admin.authVersion : 0,
      purpose: 'PLATFORM_ADMIN_ACCESS',
      jti
    },
    getSigningSecret(),
    {
      algorithm: 'HS256',
      audience: getAudience(),
      issuer: getIssuer(),
      expiresIn
    }
  );
};

const generateSupportAccessToken = (admin, tenant, expiresIn = '1h') => {
  const jti = crypto.randomUUID();
  return jwt.sign(
    {
      sub: admin._id.toString(),
      tenantId: tenant._id.toString(),
      schoolCode: tenant.code,
      authVersion: Number.isInteger(admin.authVersion) ? admin.authVersion : 0,
      purpose: 'SUPPORT_ACCESS',
      jti
    },
    getSigningSecret(),
    {
      algorithm: 'HS256',
      audience: getAudience(),
      issuer: getIssuer(),
      expiresIn
    }
  );
};

const verifySaasToken = (token, expectedPurpose = null) => {
  if (!token || typeof token !== 'string') {
    throw new Error('TOKEN_MISSING: Token không tồn tại');
  }

  const decoded = jwt.verify(token, getSigningSecret(), {
    algorithms: ['HS256'],
    audience: getAudience(),
    issuer: getIssuer()
  });

  validateTokenClaims(decoded, expectedPurpose);

  return decoded;
};

module.exports = {
  generateSchoolUserToken,
  generateMfaChallengeToken,
  generatePlatformAdminToken,
  generateSupportAccessToken,
  verifySaasToken,
  validateTokenClaims,
  getSigningSecret
};
