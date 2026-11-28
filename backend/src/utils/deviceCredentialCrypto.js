'use strict';

/**
 * @fileoverview Tiện ích mã hóa đối xứng AES-256-GCM cho thông tin đăng nhập quản trị thiết bị ISAPI,
 * gắn chặt `tenantId` làm Additional Authenticated Data (AAD) để chống giả mạo chéo trường học.
 */

const crypto = require('crypto');

function deriveEncryptionKey() {
  const rawSecret =
    process.env.DEVICE_CREDENTIAL_SECRET ||
    process.env.JWT_SECRET ||
    'hoanang-school-biometric-device-secret-key-v1';
  return crypto.createHash('sha256').update(String(rawSecret)).digest();
}

/**
 * Mã hóa cặp tài khoản/mật khẩu thiết bị theo ngữ cảnh trường `tenantId`.
 * @param {string|import('mongoose').Types.ObjectId} tenantId
 * @param {string} username
 * @param {string} password
 * @returns {{ iv: string, tag: string, cipherText: string }}
 */
function encryptDeviceCredentials(tenantId, username, password) {
  if (!tenantId || !password) {
    return { iv: '', tag: '', cipherText: '' };
  }
  const key = deriveEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(String(tenantId), 'utf8'));

  const payload = JSON.stringify({
    u: String(username || 'admin').trim() || 'admin',
    p: String(password)
  });

  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    cipherText: encrypted.toString('base64')
  };
}

/**
 * Giải mã thông tin đăng nhập thiết bị theo đúng `tenantId`.
 * @param {string|import('mongoose').Types.ObjectId} tenantId
 * @param {{ iv?: string, tag?: string, cipherText?: string } | null | undefined} encryptedAuth
 * @returns {{ username: string, password: string } | null}
 */
function decryptDeviceCredentials(tenantId, encryptedAuth) {
  if (
    !tenantId ||
    !encryptedAuth ||
    !encryptedAuth.iv ||
    !encryptedAuth.tag ||
    !encryptedAuth.cipherText
  ) {
    return null;
  }

  try {
    const key = deriveEncryptionKey();
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(encryptedAuth.iv, 'base64')
    );
    decipher.setAAD(Buffer.from(String(tenantId), 'utf8'));
    decipher.setAuthTag(Buffer.from(encryptedAuth.tag, 'base64'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedAuth.cipherText, 'base64')),
      decipher.final()
    ]).toString('utf8');

    const parsed = JSON.parse(decrypted);
    if (!parsed || !parsed.u || !parsed.p) return null;
    return {
      username: String(parsed.u),
      password: String(parsed.p)
    };
  } catch {
    return null;
  }
}

module.exports = {
  encryptDeviceCredentials,
  decryptDeviceCredentials
};

