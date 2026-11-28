'use strict';

/**
 * @fileoverview Cầu nối Mạng Nội Bộ Hoa Nắng (`Hoa Nắng Local LAN Connector` — `http://127.0.0.1:18686`).
 *
 * Giải quyết bài toán triển khai thực tế:
 * - Phần mềm Web chạy trên máy chủ Cloud công cộng (HTTPS), trong khi máy chấm công Hikvision (`192.168.x.x`)
 *   nằm sâu trong mạng LAN nội bộ tại từng Phân hiệu trường học.
 * - Khi Admin Trường hoặc Kỹ thuật viên Nhà cung cấp mở Web trên máy tính đặt tại trường, trình duyệt gọi qua
 *   loopback an toàn `http://127.0.0.1:18686` (hỗ trợ chuẩn W3C Secure Context & Chrome Private Network Access)
 *   để Quét mạng LAN, Kéo khuôn mặt & lượt quẹt từ máy về Web, Đẩy khuôn mặt từ Web xuống máy và Cập nhật
 *   địa chỉ HTTP Listening Webhook mới chỉ với 1 chạm.
 *
 * Bảo mật 3 lớp & Hỗ trợ đổi Tên miền (Domain) linh hoạt trọn đời:
 * 1. KHÔNG FIX CỨNG TÊN MIỀN: Connector xác thực yêu cầu bằng chữ ký bất đối xứng `Ed25519` (`publicKeyPem`
 *    của Server). Khi nhà cung cấp đổi tên miền Web trong tương lai, chữ ký từ Server vẫn hợp lệ 100%,
 *    tuyệt đối không phải cài lại Connector dưới các trường!
 * 2. MÃ HÓA MẬT KHẨU THIẾT BỊ: Mật khẩu quản trị Hikvision được Backend bọc trong phong bì `AES-256-GCM`
 *    (`encryptedDeviceAuth`), trình duyệt không cần biết mật khẩu thô mà chỉ chuyển tiếp xuống Connector giải mã.
 * 3. KHÓA CỨNG `deviceSerial` THEO PHÂN HIỆU (`campus_id`): Trước mọi thao tác Kéo / Đẩy / Xóa / Cấu hình Webhook,
 *    Connector đọc trực tiếp `serialNumber` phần cứng thực tế từ máy Hikvision và đối chiếu với `expectedSerial`
 *    đã khóa cho phân hiệu. Nếu khác Serial -> Chặn đứng ngay lập tức, không bao giờ kéo/đẩy nhầm trường!
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const os = require('os');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DEFAULT_CONNECTOR_PORT = Number(process.env.HOANANG_CONNECTOR_PORT || 18686);
const DEFAULT_CONNECTOR_HOST = '127.0.0.1';
const CONNECTOR_VERSION = '2.1.0';
const MAX_HIKVISION_FACE_BYTES = 200 * 1024;
const MAX_ISAPI_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_LOCAL_REQUEST_BYTES = 25 * 1024 * 1024;
const PRIVATE_IPV4_REGEX = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$/;
const PRIVATE_SUBNET_PREFIX_REGEX = /^(10\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}|192\.168\.\d{1,3})$/;
const FORBIDDEN_IPS = Object.freeze(['192.168.1.22']);

const digestChallengeCache = new Map();
const DIGEST_CACHE_TTL_MS = 90 * 1000;

function loadConnectorConfig(explicitConfig = null) {
  if (explicitConfig && typeof explicitConfig === 'object') {
    return explicitConfig;
  }
  const cfgPath = path.join(__dirname, 'connector-config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch {
      return {};
    }
  }
  return {
    publicKeyPem: process.env.CONNECTOR_PUBLIC_KEY_PEM || '',
    envelopeSecretHex: process.env.CONNECTOR_ENVELOPE_SECRET_HEX || ''
  };
}

class ConnectorOperationError extends Error {
  constructor(friendlyMessage, code = 'CONNECTOR_ERROR', statusCode = 400) {
    super(friendlyMessage);
    this.name = 'ConnectorOperationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Xác thực chữ ký số Ed25519 trên `X-Connector-Grant` do Backend ký động.
 * Không phụ thuộc tên miền cố định: chỉ cần Origin của trình duyệt khớp `allowedOrigin` bên trong chữ ký hợp lệ của Server!
 */
function verifyConnectorGrant(grantToken, requestOrigin, publicKeyPem) {
  if (!publicKeyPem) {
    throw new ConnectorOperationError(
      'Bộ kết nối nội bộ chưa có khóa xác thực của hệ thống. Bạn hãy tải lại Bộ kết nối 1 chạm trên trang Máy chấm công nhé.',
      'CONNECTOR_AUTH_INVALID',
      401
    );
  }
  if (!grantToken || typeof grantToken !== 'string' || !grantToken.includes('.')) {
    throw new ConnectorOperationError(
      'Thiếu mã xác thực an toàn từ trang Web. Bạn hãy bấm Làm mới trang rồi thử lại nhé.',
      'CONNECTOR_AUTH_INVALID',
      401
    );
  }

  const [payloadB64, sigB64] = grantToken.trim().split('.');
  if (!payloadB64 || !sigB64) {
    throw new ConnectorOperationError(
      'Mã xác thực kết nối không hợp lệ.',
      'CONNECTOR_AUTH_INVALID',
      401
    );
  }

  const isSignatureValid = crypto.verify(
    null,
    Buffer.from(payloadB64, 'utf8'),
    publicKeyPem,
    Buffer.from(sigB64, 'base64url')
  );

  if (!isSignatureValid) {
    throw new ConnectorOperationError(
      'Chữ ký bảo mật của bộ kết nối không khớp với hệ thống máy chủ. Bạn hãy tải bản Bộ kết nối mới nhất trên trang Máy chấm công nhé.',
      'CONNECTOR_AUTH_INVALID',
      401
    );
  }

  let claims;
  try {
    claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    throw new ConnectorOperationError('Dữ liệu xác thực bị hỏng.', 'CONNECTOR_AUTH_INVALID', 401);
  }

  if (!claims?.exp || Date.now() > Number(claims.exp)) {
    throw new ConnectorOperationError(
      'Phiên kết nối an toàn vừa hết hạn. Bạn chỉ cần bấm thao tác lại một lần nữa nhé.',
      'CONNECTOR_TOKEN_EXPIRED',
      401
    );
  }

  if (requestOrigin && claims.allowedOrigin && String(requestOrigin).toLowerCase() !== String(claims.allowedOrigin).toLowerCase()) {
    throw new ConnectorOperationError(
      'Tên miền trình duyệt không khớp với phiên đăng nhập hiện tại.',
      'CONNECTOR_ORIGIN_MISMATCH',
      403
    );
  }

  return claims;
}

/**
 * Giải mã phong bì mật khẩu quản trị máy chấm công (`AES-256-GCM` gắn AAD `tenantId`).
 */
function decryptConnectorAuthEnvelope(envelope, tenantId, envelopeSecretHex) {
  if (!envelope || !envelope.cipherText || !envelope.iv || !envelope.tag) {
    return null;
  }
  if (!envelopeSecretHex || envelopeSecretHex.length !== 64) {
    throw new ConnectorOperationError(
      'Bộ kết nối thiếu khóa giải mã thiết bị. Vui lòng tải lại Bộ kết nối 1 chạm trên trang Máy chấm công.',
      'CONNECTOR_AUTH_INVALID',
      401
    );
  }
  try {
    const key = Buffer.from(envelopeSecretHex, 'hex');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.iv, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    decipher.setAAD(Buffer.from(`connector:${String(tenantId)}`, 'utf8'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.cipherText, 'base64url')),
      decipher.final()
    ]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    throw new ConnectorOperationError(
      'Không giải mã được thông tin đăng nhập máy chấm công của phân hiệu này.',
      'CONNECTOR_AUTH_INVALID',
      401
    );
  }
}

function validateLanTargetHost(rawHost, allowLoopbackForTest = false) {
  const cleanHost = String(rawHost || '').trim().replace(/^https?:\/\//i, '').split(':')[0].split('/')[0];
  if (!cleanHost) {
    throw new ConnectorOperationError(
      'Bạn chưa nhập địa chỉ mạng của máy chấm công.',
      'DEVICE_INVALID_HOST',
      400
    );
  }
  if (FORBIDDEN_IPS.includes(cleanHost)) {
    throw new ConnectorOperationError(
      'Địa chỉ mạng 192.168.1.22 đang được khóa bảo vệ an toàn, vui lòng chọn đúng máy chấm công của trường.',
      'FORBIDDEN_DEVICE_IP',
      403
    );
  }
  if (allowLoopbackForTest && (cleanHost === '127.0.0.1' || cleanHost === 'localhost')) {
    return cleanHost;
  }
  if (!PRIVATE_IPV4_REGEX.test(cleanHost)) {
    throw new ConnectorOperationError(
      'Địa chỉ máy chấm công phải nằm trong mạng nội bộ của trường (ví dụ: 192.168.1.8).',
      'INVALID_SUBNET_PREFIX',
      400
    );
  }
  return cleanHost;
}

function sanitizeHikvisionPersonName(rawName, fallbackCode = '') {
  const cleaned = String(rawName || fallbackCode || '')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return String(fallbackCode || 'USER').slice(0, 32);
  if (Buffer.byteLength(cleaned, 'utf8') <= 60) return cleaned;
  let out = '';
  let used = 0;
  for (const ch of cleaned) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (used + b > 60) break;
    out += ch;
    used += b;
  }
  return out.trim() || String(fallbackCode || 'USER').slice(0, 32);
}

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function parseDigestChallenge(headerValue) {
  if (!headerValue || !String(headerValue).toLowerCase().startsWith('digest ')) return null;
  const params = {};
  const regex = /(\w+)=(?:"([^"]+)"|([^\s,]+))/g;
  let match;
  while ((match = regex.exec(headerValue)) !== null) {
    params[match[1]] = match[2] !== undefined ? match[2] : match[3];
  }
  return params;
}

function buildDigestAuthHeader({ username, password, method, uri, challenge, nc = 1 }) {
  const { realm, nonce, qop, opaque } = challenge;
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method.toUpperCase()}:${uri}`);
  const ncStr = String(nc).padStart(8, '0');
  const cnonce = crypto.randomBytes(8).toString('hex');
  const response = qop && qop.toLowerCase().includes('auth')
    ? md5(`${ha1}:${nonce}:${ncStr}:${cnonce}:auth:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`
  ];
  if (qop && qop.toLowerCase().includes('auth')) {
    parts.push('qop=auth', `nc=${ncStr}`, `cnonce="${cnonce}"`);
  }
  if (opaque) parts.push(`opaque="${opaque}"`);
  return `Digest ${parts.join(', ')}`;
}

function parseXmlSimple(xmlText) {
  if (!xmlText || typeof xmlText !== 'string') return {};
  const clean = xmlText.replace(/<\?xml[^>]*\?>/i, '').replace(/<!--[\s\S]*?-->/g, '').trim();
  if (!clean) return {};
  function parseNode(text) {
    const result = {};
    const tagPattern = /<([a-zA-Z0-9_:-]+)(?:\s+[^>]*?)?(?:\/>|>([\s\S]*?)<\/\1>)/g;
    let match;
    let found = false;
    while ((match = tagPattern.exec(text)) !== null) {
      found = true;
      const tag = match[1].includes(':') ? match[1].split(':').pop() : match[1];
      const inner = match[2] !== undefined ? match[2].trim() : '';
      const val = inner.includes('<') && /<[a-zA-Z0-9_:-]+/.test(inner)
        ? parseNode(inner)
        : inner.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
      if (result[tag] !== undefined) {
        result[tag] = Array.isArray(result[tag]) ? [...result[tag], val] : [result[tag], val];
      } else {
        result[tag] = val;
      }
    }
    return found ? result : text.trim();
  }
  return parseNode(clean);
}

function rawDeviceRequest({ protocol, host, port, method, path: reqPath, headers = {}, body = null, timeout = 5500, responseType = 'text' }) {
  return new Promise((resolve, reject) => {
    const isHttps = protocol === 'https:';
    const client = isHttps ? https : http;
    const options = {
      protocol,
      hostname: host,
      port: Number(port) || (isHttps ? 443 : 80),
      method,
      path: reqPath,
      headers: { ...headers },
      timeout
    };
    if (isHttps) {
      options.agent = new https.Agent({ rejectUnauthorized: false, keepAlive: false });
    }
    let payloadBuf = null;
    if (body !== null && body !== undefined) {
      payloadBuf = Buffer.isBuffer(body) ? body : (typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(JSON.stringify(body), 'utf8'));
      options.headers['Content-Length'] = payloadBuf.length;
    }

    let settled = false;
    const finishOk = (v) => { if (!settled) { settled = true; resolve(v); } };
    const finishErr = (e) => { if (!settled) { settled = true; reject(e); } };

    const req = client.request(options, (res) => {
      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += b.length;
        if (total > MAX_ISAPI_RESPONSE_BYTES) {
          req.destroy();
          finishErr(new ConnectorOperationError('Dữ liệu phản hồi từ máy chấm công vượt giới hạn an toàn.', 'DEVICE_RESPONSE_TOO_LARGE', 502));
          return;
        }
        chunks.push(b);
      });
      res.on('error', () => {
        finishErr(new ConnectorOperationError('Kết nối với máy chấm công bị ngắt giữa chừng. Bạn hãy thử bấm lại nhé.', 'DEVICE_CONN_RESET', 502));
      });
      res.on('end', () => {
        const full = Buffer.concat(chunks);
        finishOk({
          statusCode: res.statusCode,
          headers: res.headers,
          buffer: full,
          data: responseType === 'buffer' ? full : full.toString('utf8')
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      finishErr(
        new ConnectorOperationError(
          `Chưa liên lạc được với máy chấm công tại địa chỉ ${host}. Bạn hãy kiểm tra xem máy chấm công có đang bật điện và cắm cùng mạng với máy tính này không nhé.`,
          'DEVICE_TIMEOUT',
          504
        )
      );
    });

    req.on('error', () => {
      finishErr(
        new ConnectorOperationError(
          `Chưa kết nối được với máy chấm công tại địa chỉ ${host}. Bạn hãy kiểm tra dây mạng, nguồn điện của máy chấm công hoặc bấm "Quét tìm máy trong mạng trường" nhé.`,
          'DEVICE_OFFLINE',
          503
        )
      );
    });

    if (payloadBuf) req.write(payloadBuf);
    req.end();
  });
}

async function sendIsapiDigest(cfg, { method = 'GET', path: reqPath, body = null, headers = {}, responseType = 'text' }) {
  const host = validateLanTargetHost(cfg.host, Boolean(cfg._allowLoopbackForTesting));
  const useHttps = cfg.transportScheme === 'https';
  const protocol = useHttps ? 'https:' : 'http:';
  const port = Number(cfg.port) || (useHttps ? 443 : 80);
  const username = String(cfg.username || 'admin').trim() || 'admin';
  const password = String(cfg.password || '');

  if (!password) {
    throw new ConnectorOperationError(
      'Máy chấm công này chưa được nhập mật khẩu quản trị. Bạn hãy bấm "Cập nhật thông tin máy" để nhập mật khẩu thiết bị nhé.',
      'DEVICE_CREDENTIALS_MISSING',
      400
    );
  }

  const reqHeaders = {
    Accept: 'application/json, text/xml, application/xml, */*',
    'User-Agent': 'HoaNang-LocalConnector/2.0',
    ...headers
  };
  if (body !== null && body !== undefined && !Buffer.isBuffer(body) && !reqHeaders['Content-Type']) {
    reqHeaders['Content-Type'] = typeof body === 'string' && body.trim().startsWith('<')
      ? 'application/xml; charset=UTF-8'
      : 'application/json; charset=UTF-8';
  }

  const cacheKey = `${protocol}//${host}:${port}:${username}`;
  const cached = digestChallengeCache.get(cacheKey);
  if (cached && Date.now() - cached.updatedAt < DIGEST_CACHE_TTL_MS) {
    cached.nc += 1;
    cached.updatedAt = Date.now();
    reqHeaders.Authorization = buildDigestAuthHeader({
      username,
      password,
      method,
      uri: reqPath,
      challenge: cached.challenge,
      nc: cached.nc
    });
  }

  let res = await rawDeviceRequest({
    protocol,
    host,
    port,
    method,
    path: reqPath,
    headers: reqHeaders,
    body,
    timeout: cfg.timeoutMs || 6000,
    responseType
  });

  if (res.statusCode === 401) {
    digestChallengeCache.delete(cacheKey);
    const challenge = parseDigestChallenge(res.headers['www-authenticate'] || res.headers['WWW-Authenticate']);
    if (!challenge) {
      throw new ConnectorOperationError(
        `Mật khẩu quản trị của máy chấm công (${host}) chưa đúng. Bạn hãy bấm sửa thông tin máy và nhập lại mật khẩu nhé.`,
        'DEVICE_AUTH_FAILED',
        401
      );
    }
    reqHeaders.Authorization = buildDigestAuthHeader({
      username,
      password,
      method,
      uri: reqPath,
      challenge,
      nc: 1
    });
    res = await rawDeviceRequest({
      protocol,
      host,
      port,
      method,
      path: reqPath,
      headers: reqHeaders,
      body,
      timeout: cfg.timeoutMs || 6000,
      responseType
    });
    if (res.statusCode === 401 || res.statusCode === 403) {
      throw new ConnectorOperationError(
        `Mật khẩu quản trị của máy chấm công (${host}) chưa đúng. Bạn hãy kiểm tra và nhập lại mật khẩu thiết bị nhé.`,
        'DEVICE_AUTH_FAILED',
        401
      );
    }
    digestChallengeCache.set(cacheKey, { challenge, nc: 1, updatedAt: Date.now() });
  }

  if (res.statusCode < 200 || res.statusCode >= 300) {
    const bodyTxt = typeof res.data === 'string' ? res.data : '';
    if (/faceQuality|noFace|facePond|FDLib/i.test(bodyTxt)) {
      throw new ConnectorOperationError(
        'Ảnh chân dung chưa nhìn rõ khuôn mặt (có thể hơi tối, nghiêng hoặc bị che khuất) nên máy chấm công chưa nhận.',
        'FACE_QUALITY_LOW',
        422
      );
    }
    throw new ConnectorOperationError(
      `Máy chấm công (${host}) từ chối yêu cầu hoặc chưa hỗ trợ tính năng này.`,
      'DEVICE_HTTP_ERROR',
      400
    );
  }

  if (responseType === 'buffer') {
    return { statusCode: res.statusCode, buffer: res.buffer };
  }

  let parsed = null;
  if (res.data && res.data.trim()) {
    try {
      parsed = JSON.parse(res.data);
    } catch {
      parsed = parseXmlSimple(res.data);
    }
  }
  return { statusCode: res.statusCode, data: parsed, rawText: res.data };
}

/**
 * Đọc thông tin phần cứng & KIỂM TRA KHÓA CỨNG `expectedSerial` gắn chặt với Phân hiệu!
 */
async function inspectAndVerifyDeviceSerial(cfg, expectedSerial = '') {
  const infoRes = await sendIsapiDigest(cfg, { method: 'GET', path: '/ISAPI/System/deviceInfo' });
  const info = infoRes.data?.DeviceInfo || infoRes.data || {};
  const actualSerial = String(info.serialNumber || '').trim();
  const cleanExpected = String(expectedSerial || '').trim();

  if (cleanExpected && actualSerial && cleanExpected !== actualSerial) {
    throw new ConnectorOperationError(
      `Địa chỉ mạng ${cfg.host} hiện đang là một chiếc máy chấm công khác (Mã máy: ${actualSerial}), không khớp với máy đã khóa cho phân hiệu của bạn (${cleanExpected}). Hệ thống đã tự động dừng lại để không kéo hoặc đẩy nhầm dữ liệu học sinh!`,
      'HARDWARE_SERIAL_MISMATCH',
      409
    );
  }

  let currentStoredUsers = 0;
  let currentStoredFaces = 0;
  let maxUserCapacity = 500;

  try {
    const uRes = await sendIsapiDigest(cfg, { method: 'GET', path: '/ISAPI/AccessControl/UserInfo/Count?format=json' });
    const n = uRes.data?.UserInfoCount?.userNumber;
    if (n !== undefined) currentStoredUsers = Number(n) || 0;
  } catch { /* ignore */ }

  try {
    const fRes = await sendIsapiDigest(cfg, { method: 'GET', path: '/ISAPI/Intelligent/FDLib/Count?format=json' });
    const fn = fRes.data?.FDRecordDataInfo?.[0]?.recordDataNumber ?? fRes.data?.FDRecordDataInfo?.recordDataNumber ?? fRes.data?.recordDataNumber;
    if (fn !== undefined) currentStoredFaces = Number(fn) || 0;
  } catch { /* ignore */ }

  try {
    const capRes = await sendIsapiDigest(cfg, { method: 'GET', path: '/ISAPI/AccessControl/UserInfo/capabilities?format=json' });
    const mc = capRes.data?.UserInfo?.maxRecordNum || capRes.data?.maxRecordNum;
    if (Number(mc) > 0) maxUserCapacity = Number(mc);
  } catch { /* ignore */ }

  return {
    deviceName: info.deviceName || '',
    model: info.model || 'DS-K1T320MX',
    serialNumber: actualSerial,
    macAddress: info.macAddress || '',
    firmwareVersion: info.firmwareVersion || '',
    currentStoredUsers,
    currentStoredFaces,
    maxUserCapacity
  };
}

/**
 * Kéo danh sách người dùng + ảnh khuôn mặt (<200KB) + lượt quẹt chấm công gần nhất từ máy Hikvision trong LAN.
 */
async function pullDeviceUsersFacesAndEvents(cfg, { expectedSerial = '', sinceTimeIso = '' } = {}) {
  const deviceInfo = await inspectAndVerifyDeviceSerial(cfg, expectedSerial);

  // 1. Kéo toàn bộ UserInfo
  const allUsers = [];
  let pos = 0;
  for (let page = 0; page < 40; page += 1) {
    const res = await sendIsapiDigest(cfg, {
      method: 'POST',
      path: '/ISAPI/AccessControl/UserInfo/Search?format=json',
      body: {
        UserInfoSearchCond: {
          searchID: `conn-u-${page}`,
          searchResultPosition: pos,
          maxResults: 30
        }
      }
    });
    const root = res.data?.UserInfoSearch || res.data || {};
    let list = root.UserInfo || [];
    if (!Array.isArray(list)) list = list ? [list] : [];
    for (const u of list) {
      if (u && u.employeeNo) {
        allUsers.push({
          employeeNo: String(u.employeeNo).trim(),
          name: String(u.name || '').trim(),
          numOfCard: Number(u.numOfCard || 0),
          numOfFP: Number(u.numOfFP || 0),
          numOfFace: Number(u.numOfFace || 0),
          faceURL: u.faceURL ? String(u.faceURL).trim() : ''
        });
      }
    }
    const st = String(root.responseStatusStrg || '').toUpperCase();
    const total = Number(root.totalMatches || 0);
    pos += list.length;
    if (list.length === 0 || st === 'OK' || st === 'NO MATCH' || (total > 0 && pos >= total)) break;
  }

  // Bổ sung tra cứu FDLib nếu firmware ẩn faceURL trong UserInfo
  if (allUsers.some((u) => u.numOfFace > 0 && !u.faceURL)) {
    const faceMap = new Map();
    let fdPos = 0;
    for (let page = 0; page < 25; page += 1) {
      try {
        const fdRes = await sendIsapiDigest(cfg, {
          method: 'POST',
          path: '/ISAPI/Intelligent/FDLib/FDSearch?format=json',
          body: { searchResultPosition: fdPos, maxResults: 30, faceLibType: 'blackFD', FDID: '1' }
        });
        const rawM = fdRes.data?.MatchList;
        const matches = Array.isArray(rawM) ? rawM : rawM ? [rawM] : [];
        for (const m of matches) {
          const fpid = String(m?.FPID || m?.employeeNo || '').trim();
          const url = String(m?.faceURL || m?.picURL || '').trim();
          if (fpid && url) faceMap.set(fpid, url);
        }
        fdPos += matches.length;
        const st = String(fdRes.data?.responseStatusStrg || '').toUpperCase();
        const total = Number(fdRes.data?.totalMatches || 0);
        if (matches.length === 0 || st === 'OK' || st === 'NO MATCH' || (total > 0 && fdPos >= total)) break;
      } catch {
        break;
      }
    }
    for (const u of allUsers) {
      if (!u.faceURL && faceMap.has(u.employeeNo)) {
        u.faceURL = faceMap.get(u.employeeNo);
      }
    }
  }

  // 2. Tải ảnh khuôn mặt (<200KB) song song 3 luồng
  let cursor = 0;
  async function faceWorker() {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= allUsers.length) break;
      const u = allUsers[idx];
      if (!u.faceURL) continue;
      try {
        let reqPath = u.faceURL;
        if (reqPath.startsWith('http://') || reqPath.startsWith('https://')) {
          const parsedUrl = new URL(reqPath);
          reqPath = `${parsedUrl.pathname}${parsedUrl.search || ''}`;
        } else if (!reqPath.startsWith('/')) {
          reqPath = `/${reqPath}`;
        }
        const dl = await sendIsapiDigest(cfg, { method: 'GET', path: reqPath, responseType: 'buffer' });
        const buf = dl.buffer;
        if (Buffer.isBuffer(buf) && buf.length >= 120 && buf.length <= MAX_HIKVISION_FACE_BYTES) {
          const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
          const isPng = buf[0] === 0x89 && buf[1] === 0x50;
          if (isJpeg || isPng) {
            u.faceDataUrl = `data:${isPng ? 'image/png' : 'image/jpeg'};base64,${buf.toString('base64')}`;
          }
        }
      } catch {
        // Bỏ qua ảnh lẻ lỗi để không chặn luồng kéo
      }
    }
  }
  await Promise.all([faceWorker(), faceWorker(), faceWorker()]);

  // 3. Kéo sự kiện chấm công / điểm danh gần nhất (AcsEvent)
  const events = [];
  try {
    const now = new Date();
    const fallbackStart = new Date(now.getTime() - 3 * 24 * 3600 * 1000);
    const startDate = sinceTimeIso ? new Date(sinceTimeIso) : fallbackStart;
    const toHikTime = (d) => {
      const local = new Date((Number.isNaN(d.getTime()) ? fallbackStart.getTime() : d.getTime()) + 7 * 3600 * 1000);
      return `${local.toISOString().slice(0, 19)}+07:00`;
    };
    let evPos = 0;
    for (let page = 0; page < 15; page += 1) {
      const evRes = await sendIsapiDigest(cfg, {
        method: 'POST',
        path: '/ISAPI/AccessControl/AcsEvent?format=json',
        body: {
          AcsEventCond: {
            searchID: `conn-ev-${page}`,
            searchResultPosition: evPos,
            maxResults: 30,
            major: 5,
            minor: 0,
            startTime: toHikTime(startDate),
            endTime: toHikTime(now)
          }
        }
      });
      const root = evRes.data?.AcsEvent || evRes.data || {};
      let list = root.InfoList || [];
      if (!Array.isArray(list)) list = list ? [list] : [];
      for (const ev of list) {
        const empNo = String(ev?.employeeNoString || ev?.cardNo || '').trim();
        if (empNo) {
          events.push({
            serialNo: ev.serialNo ?? null,
            employeeNoString: empNo,
            name: ev.name || '',
            time: ev.time || '',
            major: Number(ev.major ?? 5),
            minor: Number(ev.minor ?? 75),
            currentVerifyMode: ev.currentVerifyMode || ''
          });
        }
      }
      evPos += list.length;
      const st = String(root.responseStatusStrg || '').toUpperCase();
      const total = Number(root.totalMatches || 0);
      if (list.length === 0 || st === 'OK' || st === 'NO MATCH' || (total > 0 && evPos >= total)) break;
    }
  } catch {
    // Một số thiết bị chưa phát sinh sự kiện AcsEvent
  }

  return {
    deviceInfo,
    users: allUsers.map(({ faceURL: _omit, ...rest }) => rest),
    events
  };
}

/**
 * Đẩy danh sách Nhân sự / Học sinh + Ảnh khuôn mặt (<200KB) từ Web xuống máy Hikvision trong LAN (sau khi đối chiếu `expectedSerial`).
 */
async function pushRosterAndFacesToDevice(cfg, { expectedSerial = '', targets = [], fastDelta = true } = {}) {
  const deviceInfo = await inspectAndVerifyDeviceSerial(cfg, expectedSerial);

  // Đọc danh sách hiện có trên máy để hỗ trợ Delta Sync siêu tốc
  const existingMap = new Map();
  try {
    let pos = 0;
    for (let page = 0; page < 40; page += 1) {
      const res = await sendIsapiDigest(cfg, {
        method: 'POST',
        path: '/ISAPI/AccessControl/UserInfo/Search?format=json',
        body: { UserInfoSearchCond: { searchID: `pre-${page}`, searchResultPosition: pos, maxResults: 30 } }
      });
      const root = res.data?.UserInfoSearch || res.data || {};
      let list = root.UserInfo || [];
      if (!Array.isArray(list)) list = list ? [list] : [];
      for (const u of list) {
        if (u?.employeeNo) existingMap.set(String(u.employeeNo).trim(), u);
      }
      pos += list.length;
      const st = String(root.responseStatusStrg || '').toUpperCase();
      const total = Number(root.totalMatches || 0);
      if (list.length === 0 || st === 'OK' || st === 'NO MATCH' || (total > 0 && pos >= total)) break;
    }
  } catch { /* ignore */ }

  const safeTargets = Array.isArray(targets) ? targets : [];
  let syncedUsers = 0;
  let syncedFaces = 0;
  let skippedUnchangedCount = 0;
  const faceSyncedPersonCodes = [];
  const failedItems = [];

  let cursor = 0;
  async function pushWorker() {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= safeTargets.length) break;
      const item = safeTargets[idx];
      const cleanCode = String(item.personCode || '').trim().slice(0, 32);
      if (!cleanCode) continue;
      const cleanName = sanitizeHikvisionPersonName(item.fullName, cleanCode);
      const existing = existingMap.get(cleanCode) || null;

      if (
        fastDelta &&
        existing &&
        String(existing.name || '').trim() === cleanName &&
        (!item.imageBase64 || (item.alreadySyncedOnDevice && Number(existing.numOfFace) > 0))
      ) {
        syncedUsers += 1;
        skippedUnchangedCount += 1;
        if (Number(existing.numOfFace) > 0) syncedFaces += 1;
        continue;
      }

      const userPayload = {
        UserInfo: {
          employeeNo: cleanCode,
          name: cleanName,
          userType: 'normal',
          Valid: {
            enable: true,
            beginTime: '2020-01-01T00:00:00',
            endTime: '2037-12-31T23:59:59',
            timeType: 'local'
          },
          doorRight: '1',
          RightPlan: [{ doorNo: 1, planTemplateNo: '1' }]
        }
      };

      try {
        if (existing) {
          await sendIsapiDigest(cfg, {
            method: 'PUT',
            path: '/ISAPI/AccessControl/UserInfo/Modify?format=json',
            body: userPayload
          });
        } else {
          try {
            await sendIsapiDigest(cfg, {
              method: 'POST',
              path: '/ISAPI/AccessControl/UserInfo/Record?format=json',
              body: userPayload
            });
          } catch {
            await sendIsapiDigest(cfg, {
              method: 'PUT',
              path: '/ISAPI/AccessControl/UserInfo/SetUp?format=json',
              body: userPayload
            });
          }
        }
        syncedUsers += 1;

        if (item.imageBase64) {
          const faceBuf = Buffer.from(item.imageBase64, 'base64');
          if (faceBuf.length > 0 && faceBuf.length <= MAX_HIKVISION_FACE_BYTES) {
            const boundary = `----HoaNangFace${crypto.randomBytes(6).toString('hex')}`;
            const metaJson = JSON.stringify({ faceLibType: 'blackFD', FDID: '1', FPID: cleanCode });
            const part1 = Buffer.from(
              `--${boundary}\r\nContent-Disposition: form-data; name="FaceDataRecord"\r\nContent-Type: application/json\r\n\r\n${metaJson}\r\n`,
              'utf8'
            );
            const part2 = Buffer.from(
              `--${boundary}\r\nContent-Disposition: form-data; name="img"; filename="${cleanCode}.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
              'utf8'
            );
            const closing = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
            const multipart = Buffer.concat([part1, part2, faceBuf, closing]);

            try {
              await sendIsapiDigest(cfg, {
                method: 'PUT',
                path: '/ISAPI/Intelligent/FDLib/FDSetUp?format=json',
                body: multipart,
                headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }
              });
              syncedFaces += 1;
              faceSyncedPersonCodes.push(cleanCode);
            } catch (faceErr) {
              failedItems.push({
                personCode: cleanCode,
                fullName: item.fullName,
                reason:
                  faceErr.code === 'FACE_QUALITY_LOW'
                    ? `Ảnh chân dung của "${item.fullName}" chưa rõ khuôn mặt nên máy chưa nhận. Bạn hãy chụp lại ảnh nhìn thẳng, đủ sáng nhé.`
                    : `Đã lưu tên "${item.fullName}" nhưng máy chấm công chưa nhận được ảnh khuôn mặt.`
              });
            }
          }
        } else if (existing && Number(existing.numOfFace) > 0) {
          syncedFaces += 1;
        }
      } catch (err) {
        failedItems.push({
          personCode: cleanCode,
          fullName: item.fullName,
          reason: err.message || `Chưa nạp được hồ sơ "${item.fullName}" xuống máy.`
        });
      }
    }
  }

  await Promise.all([pushWorker(), pushWorker(), pushWorker()]);

  const afterInfo = await inspectAndVerifyDeviceSerial(cfg, expectedSerial).catch(() => deviceInfo);

  return {
    deviceInfo: afterInfo,
    totalTargets: safeTargets.length,
    syncedUsers,
    syncedFaces,
    skippedUnchangedCount,
    faceSyncedPersonCodes,
    failedCount: failedItems.length,
    failedItems: failedItems.slice(0, 15)
  };
}

/**
 * 1 chạm cập nhật địa chỉ HTTP Listening Webhook mới xuống thẳng phần cứng máy Hikvision (Hỗ trợ đổi Tên miền linh hoạt!).
 */
async function configureHikvisionWebhookOnLan(cfg, { expectedSerial = '', webhookUrl = '' } = {}) {
  const deviceInfo = await inspectAndVerifyDeviceSerial(cfg, expectedSerial);

  let parsedUrl;
  try {
    parsedUrl = new URL(String(webhookUrl || '').trim());
  } catch {
    throw new ConnectorOperationError(
      'Địa chỉ nhận dữ liệu tự động (Webhook) không hợp lệ.',
      'INVALID_WEBHOOK_URL',
      400
    );
  }

  const isHttps = parsedUrl.protocol === 'https:';
  const hostname = parsedUrl.hostname;
  const portNo = parsedUrl.port ? Number(parsedUrl.port) : (isHttps ? 443 : 80);
  const urlPath = `${parsedUrl.pathname}${parsedUrl.search || ''}`;
  const isIpHost = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  const protocolType = isHttps ? 'HTTPS' : 'HTTP';

  const xmlBody = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<HttpHostNotification version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">',
    '<id>1</id>',
    `<url>${urlPath.replace(/&/g, '&amp;')}</url>`,
    `<protocolType>${protocolType}</protocolType>`,
    '<parameterFormatType>json</parameterFormatType>',
    `<addressingFormatType>${isIpHost ? 'ipaddress' : 'hostname'}</addressingFormatType>`,
    isIpHost ? `<ipAddress>${hostname}</ipAddress>` : `<hostName>${hostname}</hostName>`,
    `<portNo>${portNo}</portNo>`,
    '<httpAuthenticationMethod>none</httpAuthenticationMethod>',
    '</HttpHostNotification>'
  ].join('');

  const jsonBody = {
    HttpHostNotification: {
      id: '1',
      url: urlPath,
      protocolType,
      parameterFormatType: 'json',
      addressingFormatType: isIpHost ? 'ipaddress' : 'hostname',
      ...(isIpHost ? { ipAddress: hostname } : { hostName: hostname }),
      portNo,
      httpAuthenticationMethod: 'none'
    }
  };

  let configured = false;
  const attempts = [
    { method: 'PUT', path: '/ISAPI/Event/notification/httpHosts/1', body: xmlBody },
    { method: 'PUT', path: '/ISAPI/Event/triggers/notifications/httpHosts/1', body: xmlBody },
    { method: 'PUT', path: '/ISAPI/Event/notification/httpHosts/1?format=json', body: jsonBody },
    { method: 'PUT', path: '/ISAPI/Event/triggers/notifications/httpHosts/1?format=json', body: jsonBody },
    { method: 'PUT', path: '/ISAPI/Event/triggers/notifications/httpHosts', body: `<HttpHostNotificationList version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">${xmlBody.replace(/^<\?xml[^>]*\?>/, '')}</HttpHostNotificationList>` }
  ];

  let lastErr = null;
  for (const attempt of attempts) {
    try {
      await sendIsapiDigest(cfg, attempt);
      configured = true;
      break;
    } catch (err) {
      lastErr = err;
      if (err.code === 'DEVICE_AUTH_FAILED' || err.code === 'DEVICE_OFFLINE' || err.code === 'DEVICE_TIMEOUT') {
        throw err;
      }
    }
  }

  if (!configured && lastErr) {
    throw lastErr;
  }

  return {
    success: true,
    deviceInfo,
    webhookUrl: parsedUrl.toString(),
    protocolType,
    hostName: hostname,
    portNo,
    urlPath
  };
}

/**
 * Quét tự động các máy chấm công Hikvision trực tiếp trên mạng LAN của máy tính tại Phân hiệu.
 */
async function discoverLocalLanDevices({ subnetPrefix = '', probeUsername = 'admin', probePassword = '' } = {}) {
  const candidates = new Set();
  const scannedSubnets = [];

  if (subnetPrefix && String(subnetPrefix).trim()) {
    const raw = String(subnetPrefix).trim();
    const cidrMatch = raw.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}\/\d{1,2}$/);
    const rangeMatch = raw.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})\s*-\s*(?:\1\.)?(\d{1,3})$/);
    const singleIp = PRIVATE_IPV4_REGEX.test(raw) ? raw : null;
    const prefixClean = raw.replace(/\.\*$/, '').replace(/\.$/, '');

    if (cidrMatch && PRIVATE_SUBNET_PREFIX_REGEX.test(cidrMatch[1])) {
      scannedSubnets.push(`${cidrMatch[1]}.1 - ${cidrMatch[1]}.254`);
      for (let i = 1; i <= 254; i += 1) candidates.add(`${cidrMatch[1]}.${i}`);
    } else if (rangeMatch && PRIVATE_SUBNET_PREFIX_REGEX.test(rangeMatch[1])) {
      const s = Math.max(1, Math.min(254, Number(rangeMatch[2])));
      const e = Math.max(s, Math.min(254, Number(rangeMatch[3])));
      scannedSubnets.push(`${rangeMatch[1]}.${s} - ${rangeMatch[1]}.${e}`);
      for (let i = s; i <= e; i += 1) candidates.add(`${rangeMatch[1]}.${i}`);
    } else if (singleIp) {
      scannedSubnets.push(singleIp);
      candidates.add(singleIp);
    } else if (PRIVATE_SUBNET_PREFIX_REGEX.test(prefixClean)) {
      scannedSubnets.push(`${prefixClean}.1 - ${prefixClean}.254`);
      for (let i = 1; i <= 254; i += 1) candidates.add(`${prefixClean}.${i}`);
    } else {
      throw new ConnectorOperationError(
        'Địa chỉ mạng bạn nhập chưa đúng dạng mạng nội bộ (ví dụ: 192.168.1 hoặc 192.168.1.8). Hãy xóa trắng ô nhập để hệ thống tự tìm nhé.',
        'INVALID_SUBNET_PREFIX',
        400
      );
    }
  } else {
    const prefixes = new Set();
    const fallbackPrefixes = new Set();
    const nets = os.networkInterfaces();
    for (const [ifaceName, list] of Object.entries(nets)) {
      const isVirtual = /(wsl|docker|vethernet|hyper-v|vbox|vmware|virbr|br-|veth|tailscale|zerotier)/i.test(ifaceName);
      for (const iface of list || []) {
        if (iface.family === 'IPv4' && !iface.internal && PRIVATE_IPV4_REGEX.test(iface.address)) {
          const p = iface.address.split('.');
          const prefix = `${p[0]}.${p[1]}.${p[2]}`;
          fallbackPrefixes.add(prefix);
          if (!isVirtual) {
            prefixes.add(prefix);
          }
        }
      }
    }
    const chosenPrefixes = prefixes.size > 0 ? prefixes : fallbackPrefixes;
    if (chosenPrefixes.size === 0) chosenPrefixes.add('192.168.1');
    for (const p of chosenPrefixes) {
      scannedSubnets.push(`${p}.1 - ${p}.254`);
      for (let i = 1; i <= 254; i += 1) candidates.add(`${p}.${i}`);
    }
  }

  for (const f of FORBIDDEN_IPS) candidates.delete(f);

  // Ưu tiên hàng đầu các IP đang hoạt động trong bảng ARP của máy tính (Windows/Linux/macOS)
  // giúp tìm thấy ngay máy chấm công đang bật mà không bị nghẽn hàng đợi SYN của hệ điều hành
  const arpKnownIps = await new Promise((resolve) => {
    execFile('arp', ['-a'], { timeout: 1200, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve(new Set());
      const hits = new Set();
      const matches = String(stdout).match(/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g);
      for (const ip of matches || []) {
        if (ip && !ip.endsWith('.255') && !ip.endsWith('.0') && !FORBIDDEN_IPS.includes(ip)) {
          hits.add(ip);
        }
      }
      resolve(hits);
    });
  });

  const prioritizedIps = [];
  for (const ip of candidates) {
    if (arpKnownIps.has(ip)) prioritizedIps.push(ip);
  }
  for (const ip of candidates) {
    if (!arpKnownIps.has(ip)) prioritizedIps.push(ip);
  }

  const checkPort = (ip, port, timeoutMs = 700) =>
    new Promise((resolve) => {
      const sock = new net.Socket();
      let done = false;
      const fin = (ok) => {
        if (!done) {
          done = true;
          sock.destroy();
          resolve(ok);
        }
      };
      sock.setTimeout(timeoutMs);
      sock.once('connect', () => fin(true));
      sock.once('timeout', () => fin(false));
      sock.once('error', () => fin(false));
      sock.connect(port, ip);
    });

  // Giới hạn tối đa 16 luồng kiểm tra đồng thời (kiểm tra cổng 80 trước tiên)
  // để tuyệt đối không chạm ngưỡng giới hạn kết nối TCP bán mở trên Windows!
  const openEndpoints = [];
  let cursor = 0;
  const workerCount = Math.min(16, Math.max(1, prioritizedIps.length));
  async function tcpScanWorker() {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= prioritizedIps.length) break;
      const ip = prioritizedIps[idx];
      const isArpLive = arpKnownIps.has(ip);
      const port80Timeout = isArpLive ? 1000 : 650;

      if (await checkPort(ip, 80, port80Timeout)) {
        openEndpoints.push({ ip, port: 80 });
        continue;
      }
      if (await checkPort(ip, 443, isArpLive ? 700 : 420)) {
        openEndpoints.push({ ip, port: 443 });
        continue;
      }
      if (await checkPort(ip, 8080, isArpLive ? 700 : 420)) {
        openEndpoints.push({ ip, port: 8080 });
      }
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => tcpScanWorker()));

  const discoveredDevices = [];
  await Promise.all(
    openEndpoints.map(async ({ ip, port }) => {
      try {
        const protocol = port === 443 ? 'https:' : 'http:';
        const probe = await rawDeviceRequest({
          protocol,
          host: ip,
          port,
          method: 'GET',
          path: '/ISAPI/System/deviceInfo',
          timeout: 1800
        });
        const wwwAuth = String(probe.headers?.['www-authenticate'] || '');
        const serverHdr = String(probe.headers?.server || '');
        const bodyText = String(probe.data || '');
        const isHik =
          (probe.statusCode === 401 && wwwAuth.toLowerCase().includes('digest')) ||
          /hikvision|dnvrs|webs|app-webs/i.test(serverHdr) ||
          bodyText.includes('DeviceInfo') ||
          bodyText.includes('Hikvision');
        if (!isHik) return;

        // Trích xuất tên dòng máy trực tiếp từ Digest Realm mà KHÔNG cần mật khẩu (VD: realm="DS-K1T320MX")
        const realmMatch = wwwAuth.match(/realm="([^"]+)"/i);
        const realmModel =
          realmMatch?.[1] && !/^(hikvision|digest|device|ip camera|login)$/i.test(realmMatch[1].trim())
            ? realmMatch[1].trim()
            : 'DS-K1T320MX';

        const item = {
          host: ip,
          port,
          transportScheme: port === 443 ? 'https' : 'http',
          model: realmModel,
          serialNumber: '',
          macAddress: '',
          currentStoredUsers: null,
          maxUserCapacity: 500,
          authVerified: false
        };

        if (probePassword && String(probePassword).trim()) {
          try {
            const inspected = await inspectAndVerifyDeviceSerial({
              host: ip,
              port,
              transportScheme: item.transportScheme,
              username: probeUsername || 'admin',
              password: String(probePassword),
              timeoutMs: 3000
            });
            item.model = inspected.model || item.model;
            item.serialNumber = inspected.serialNumber || '';
            item.macAddress = inspected.macAddress || '';
            item.currentStoredUsers = inspected.currentStoredUsers;
            item.maxUserCapacity = inspected.maxUserCapacity || 500;
            item.authVerified = true;
          } catch { /* mật khẩu thử chưa khớp vẫn hiển thị máy tìm thấy */ }
        }

        discoveredDevices.push(item);
      } catch { /* ignore non-HTTP port */ }
    })
  );

  return { scannedSubnets, discoveredDevices };
}

function getLocalMachineLanIps() {
  const physicalIps = [];
  const fallbackIps = [];
  const nets = os.networkInterfaces();
  for (const [ifaceName, list] of Object.entries(nets)) {
    const isVirtual = /(wsl|docker|vethernet|hyper-v|vbox|vmware|virbr|br-|veth)/i.test(ifaceName);
    for (const iface of list || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        fallbackIps.push(iface.address);
        if (!isVirtual) {
          physicalIps.push(iface.address);
        }
      }
    }
  }
  return physicalIps.length > 0 ? physicalIps : fallbackIps;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
      size += b.length;
      if (size > MAX_LOCAL_REQUEST_BYTES) {
        req.destroy();
        reject(new ConnectorOperationError('Dữ liệu đồng bộ vượt quá dung lượng cho phép.', 'PAYLOAD_TOO_LARGE', 413));
        return;
      }
      chunks.push(b);
    });
    req.on('error', () => reject(new ConnectorOperationError('Lỗi đọc dữ liệu yêu cầu.', 'BAD_BODY', 400)));
    req.on('end', () => {
      if (size === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ConnectorOperationError('Định dạng dữ liệu gửi xuống bộ kết nối không hợp lệ.', 'BAD_JSON', 400));
      }
    });
  });
}

/**
 * Khởi tạo máy chủ HTTP `Local LAN Connector` lắng nghe duy nhất tại `127.0.0.1` (Loopback an toàn).
 */
function createConnectorHttpServer(customConfig = null) {
  const runtimeCfg = loadConnectorConfig(customConfig);

  return http.createServer(async (req, res) => {
    const origin = req.headers.origin || '*';

    // Chuẩn Chrome Private Network Access (HTTPS Cloud -> http://127.0.0.1:18686)
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Connector-Grant');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const sendJson = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };

    try {
      const urlPath = String(req.url || '/').split('?')[0];

      // 1. Health check (cho phép Web kiểm tra xem máy tính tại trường đã bật Connector chưa)
      if (req.method === 'GET' && urlPath === '/health') {
        return sendJson(200, {
          success: true,
          service: 'HoaNang-Local-LAN-Connector',
          version: CONNECTOR_VERSION,
          lanIps: getLocalMachineLanIps(),
          keyConfigured: Boolean(runtimeCfg.publicKeyPem),
          message: 'Bộ kết nối máy chấm công nội bộ đang hoạt động ổn định trên máy tính này.'
        });
      }

      // Mọi thao tác phần cứng đều bắt buộc kiểm tra chữ ký Ed25519 trên X-Connector-Grant
      const grantHeader = req.headers['x-connector-grant'];
      const grantClaims = verifyConnectorGrant(
        Array.isArray(grantHeader) ? grantHeader[0] : grantHeader,
        req.headers.origin || '',
        runtimeCfg.publicKeyPem
      );

      const body = req.method === 'POST' ? await readJsonBody(req) : {};

      const resolveTargetDeviceConfig = () => {
        const dev = body.device || {};
        let username = String(dev.username || 'admin').trim() || 'admin';
        let password = String(dev.password || '');

        if (body.encryptedDeviceAuth) {
          const unlocked = decryptConnectorAuthEnvelope(
            body.encryptedDeviceAuth,
            grantClaims.tenantId,
            runtimeCfg.envelopeSecretHex
          );
          if (unlocked) {
            username = unlocked.username || username;
            password = unlocked.password || password;
          }
        }

        // Khóa an toàn theo danh sách thiết bị của phân hiệu trong Grant Token
        let lockedSerial = String(body.expectedSerial || '').trim();
        if (dev.deviceId && Array.isArray(grantClaims.lockedDevices)) {
          const foundLock = grantClaims.lockedDevices.find((d) => String(d.deviceId) === String(dev.deviceId));
          if (foundLock?.lockedSerial) {
            lockedSerial = foundLock.lockedSerial;
          }
        }

        return {
          cfg: {
            host: dev.host,
            port: dev.port,
            transportScheme: dev.transportScheme || 'http',
            username,
            password,
            timeoutMs: dev.timeoutMs || 6500,
            _allowLoopbackForTesting: Boolean(runtimeCfg._allowLoopbackForTesting)
          },
          expectedSerial: lockedSerial
        };
      };

      if (req.method === 'POST' && urlPath === '/lan/discover') {
        const result = await discoverLocalLanDevices({
          subnetPrefix: body.subnetPrefix || '',
          probeUsername: body.probeUsername || 'admin',
          probePassword: body.probePassword || ''
        });
        return sendJson(200, { success: true, data: result });
      }

      if (req.method === 'POST' && urlPath === '/device/inspect') {
        const { cfg, expectedSerial } = resolveTargetDeviceConfig();
        const info = await inspectAndVerifyDeviceSerial(cfg, expectedSerial);
        return sendJson(200, { success: true, data: info });
      }

      if (req.method === 'POST' && urlPath === '/device/pull') {
        const { cfg, expectedSerial } = resolveTargetDeviceConfig();
        const pulled = await pullDeviceUsersFacesAndEvents(cfg, {
          expectedSerial,
          sinceTimeIso: body.sinceTimeIso || ''
        });
        return sendJson(200, { success: true, data: pulled });
      }

      if (req.method === 'POST' && urlPath === '/device/push') {
        const { cfg, expectedSerial } = resolveTargetDeviceConfig();
        const pushed = await pushRosterAndFacesToDevice(cfg, {
          expectedSerial,
          targets: body.targets || [],
          fastDelta: body.fastDelta !== false
        });
        return sendJson(200, { success: true, data: pushed });
      }

      if (req.method === 'POST' && urlPath === '/device/configure-webhook') {
        const { cfg, expectedSerial } = resolveTargetDeviceConfig();
        const updated = await configureHikvisionWebhookOnLan(cfg, {
          expectedSerial,
          webhookUrl: body.webhookUrl || ''
        });
        return sendJson(200, { success: true, data: updated });
      }

      if (req.method === 'POST' && urlPath === '/device/prune-users') {
        const { cfg, expectedSerial } = resolveTargetDeviceConfig();
        await inspectAndVerifyDeviceSerial(cfg, expectedSerial);
        const codes = (Array.isArray(body.personCodes) ? body.personCodes : [])
          .map((c) => String(c || '').trim())
          .filter(Boolean);
        let removedCount = 0;
        for (let i = 0; i < codes.length; i += 30) {
          const slice = codes.slice(i, i + 30);
          await sendIsapiDigest(cfg, {
            method: 'PUT',
            path: '/ISAPI/AccessControl/UserInfo/Delete?format=json',
            body: { UserInfoDelCond: { EmployeeNoList: slice.map((employeeNo) => ({ employeeNo })) } }
          });
          removedCount += slice.length;
        }
        const afterInfo = await inspectAndVerifyDeviceSerial(cfg, expectedSerial).catch(() => null);
        return sendJson(200, {
          success: true,
          data: {
            removedCount,
            currentStoredUsers: afterInfo?.currentStoredUsers ?? null
          }
        });
      }

      if (req.method === 'POST' && urlPath === '/device/unlock-door') {
        const { cfg, expectedSerial } = resolveTargetDeviceConfig();
        await inspectAndVerifyDeviceSerial(cfg, expectedSerial);
        const doorNo = Math.max(1, Math.min(8, Number(body.doorNo) || 1));
        await sendIsapiDigest(cfg, {
          method: 'PUT',
          path: `/ISAPI/AccessControl/RemoteControl/door/${doorNo}`,
          body: '<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>'
        });
        return sendJson(200, { success: true, data: { doorNo } });
      }

      return sendJson(404, {
        success: false,
        code: 'NOT_FOUND',
        message: 'Tính năng yêu cầu chưa có trên phiên bản Bộ kết nối này.'
      });
    } catch (err) {
      return sendJson(err.statusCode || 400, {
        success: false,
        code: err.code || 'CONNECTOR_ERROR',
        message:
          err.message ||
          'Chưa kết nối được với máy chấm công tại trường. Bạn hãy kiểm tra dây mạng và nguồn điện của máy nhé.'
      });
    }
  });
}

if (require.main === module) {
  const server = createConnectorHttpServer();
  server.listen(DEFAULT_CONNECTOR_PORT, DEFAULT_CONNECTOR_HOST, () => {
    console.log('================================================================');
    console.log('  BO KET NOI MAY CHAM CONG NOI BO HOA NANG (LOCAL LAN CONNECTOR)');
    console.log(`  Trang thai : DANG HOAT DONG TAI http://${DEFAULT_CONNECTOR_HOST}:${DEFAULT_CONNECTOR_PORT}`);
    console.log(`  Mang LAN   : ${getLocalMachineLanIps().join(', ') || 'Chua ket noi mang'}`);
    console.log('  Ban co the thu nho cua so nay va thao tac tren trang Web!');
    console.log('================================================================');
  });
}

module.exports = {
  CONNECTOR_VERSION,
  DEFAULT_CONNECTOR_PORT,
  ConnectorOperationError,
  verifyConnectorGrant,
  decryptConnectorAuthEnvelope,
  inspectAndVerifyDeviceSerial,
  pullDeviceUsersFacesAndEvents,
  pushRosterAndFacesToDevice,
  configureHikvisionWebhookOnLan,
  discoverLocalLanDevices,
  createConnectorHttpServer
};

