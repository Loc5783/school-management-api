const crypto = require('crypto');

const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(str) {
  const cleaned = str.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  let index = 0;
  const output = Buffer.alloc(Math.floor((cleaned.length * 5) / 8));

  for (let i = 0; i < cleaned.length; i++) {
    const val = base32Chars.indexOf(cleaned[i]);
    if (val === -1) throw new Error('Invalid base32 character: ' + cleaned[i]);
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      output[index++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return output.subarray(0, index);
}

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += base32Chars[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += base32Chars[(value << (5 - bits)) & 31];
  }
  return output;
}

function generateTotpSecret(length = 20) {
  return base32Encode(crypto.randomBytes(length));
}

function generateTOTP(secretBase32, timeStep = 30, epochTime = Date.now()) {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(epochTime / 1000 / timeStep);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter), 0);

  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (binary % 1000000).toString().padStart(6, '0');
}

function verifyTotpWithStep(secretBase32, code, window = 1, timeStep = 30, now = Date.now()) {
  if (!code || typeof code !== 'string') return { valid: false, matchedStep: null };
  const cleanCode = code.trim();
  if (cleanCode.length !== 6 || !/^\d{6}$/.test(cleanCode)) return { valid: false, matchedStep: null };

  const currentStep = Math.floor(now / 1000 / timeStep);
  for (let step = currentStep - window; step <= currentStep + window; step++) {
    const epoch = step * timeStep * 1000;
    const expected = generateTOTP(secretBase32, timeStep, epoch);
    if (crypto.timingSafeEqual(Buffer.from(cleanCode), Buffer.from(expected))) {
      return { valid: true, matchedStep: step };
    }
  }
  return { valid: false, matchedStep: null };
}

function verifyTOTP(secretBase32, code, window = 1, timeStep = 30, now = Date.now()) {
  return verifyTotpWithStep(secretBase32, code, window, timeStep, now).valid;
}

function getMfaEncryptionKey(customKey) {
  const keySource = customKey !== undefined ? customKey : process.env.PLATFORM_MFA_ENCRYPTION_KEY;
  if (!keySource || typeof keySource !== 'string' || keySource.trim().length < 32) {
    throw new Error('CRITICAL_SAFETY_VIOLATION: PLATFORM_MFA_ENCRYPTION_KEY_MISSING_OR_TOO_SHORT');
  }
  return crypto.createHash('sha256').update(keySource.trim()).digest();
}

function encryptTotpSecret(secret, customKey) {
  if (!secret || typeof secret !== 'string') {
    throw new Error('MFA_SECRET_INVALID: TOTP secret must be a non-empty string');
  }
  const key = getMfaEncryptionKey(customKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(secret, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return { encrypted, iv: iv.toString('hex'), tag };
}

function decryptTotpSecret(encryptedHex, ivHex, tagHex, customKey) {
  if (!encryptedHex || !ivHex || !tagHex) {
    throw new Error('MFA_CIPHERTEXT_INVALID: Missing ciphertext, IV, or authentication tag');
  }
  const key = getMfaEncryptionKey(customKey);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = {
  generateTotpSecret,
  generateTOTP,
  verifyTOTP,
  verifyTotpWithStep,
  encryptTotpSecret,
  decryptTotpSecret,
  getMfaEncryptionKey,
  base32Decode,
  base32Encode
};
