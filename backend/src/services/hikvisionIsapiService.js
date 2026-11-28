'use strict';

/**
 * @fileoverview Tầng giao tiếp chuẩn Hikvision ISAPI (HTTP/HTTPS Digest Authentication RFC 2617/7616).
 * Hỗ trợ:
 * - Chống SSRF & bảo vệ danh sách IP cấm (`FORBIDDEN_IPS`).
 * - Quét tự động máy chấm công Hikvision trong mạng LAN nội bộ (`discoverHikvisionDevicesOnLan`).
 * - Đọc thông tin phần cứng & dung lượng bộ nhớ 500 slot (`getDeviceInfo`, `getDeviceCapacityUsage`).
 * - Đồng bộ 1 chiều an toàn Nhân sự & Học sinh + Ảnh khuôn mặt `<200KB` (`upsertPersonAndFaceOnDevice`).
 * - Kéo danh sách người dùng & tải ảnh khuôn mặt gốc từ máy về Web (`fetchAllDeviceUsersWithFaces`, `downloadDeviceFaceBuffer`).
 * - Giải phóng slot nghỉ việc/thôi học (`deletePersonsFromDevice`) & Mở khóa cửa từ xa (`remoteUnlockDoor`).
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const os = require('os');
const net = require('net');

// Strict SSRF IP Validation: Only allow standard private LAN subnets
const PRIVATE_IPV4_REGEX = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$/;
const PRIVATE_SUBNET_PREFIX_REGEX = /^(10\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}|192\.168\.\d{1,3})$/;

// CRITICAL SAFETY GUARD: Specifically forbid device 192.168.1.22
const FORBIDDEN_IPS = Object.freeze(['192.168.1.22']);
const MAX_HIKVISION_FACE_BYTES = 200 * 1024; // 200KB hardware limit

// Bộ nhớ đệm Digest Nonce ngắn hạn (90s) theo endpoint giúp giảm 50% số gói tin khứ hồi khi đồng bộ hàng loạt
const digestChallengeCache = new Map();
const DIGEST_CACHE_TTL_MS = 90 * 1000;
const MAX_DIGEST_CACHE_ENTRIES = 200;
const MAX_ISAPI_RESPONSE_BYTES = 8 * 1024 * 1024; // Chặn cứng 8MB chống tràn RAM khi thiết bị lỗi stream vô hạn

function setDigestCacheBounded(key, value) {
  if (digestChallengeCache.size >= MAX_DIGEST_CACHE_ENTRIES && !digestChallengeCache.has(key)) {
    const oldestKey = digestChallengeCache.keys().next().value;
    if (oldestKey !== undefined) {
      digestChallengeCache.delete(oldestKey);
    }
  }
  digestChallengeCache.set(key, value);
}

/**
 * Chuẩn hóa Họ tên đẩy xuống Hikvision ISAPI:
 * - Loại bỏ ký tự điều khiển (\r, \n, \t, \0) gây vỡ JSON/XML.
 * - Cắt an toàn theo ranh giới ký tự sao cho tổng số byte UTF-8 <= 60 bytes
 *   (Phần cứng Hikvision DS-K1T320MX giới hạn cứng `name` tối đa 63 bytes UTF-8, tên tiếng Việt có dấu dài dễ vượt nếu chỉ cắt theo `.slice(0, 64)`).
 */
function sanitizeHikvisionPersonName(rawName, fallbackCode = '') {
  const cleaned = String(rawName || fallbackCode || '')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return String(fallbackCode || 'USER').slice(0, 32);
  if (Buffer.byteLength(cleaned, 'utf8') <= 60) return cleaned;

  let out = '';
  let usedBytes = 0;
  for (const ch of cleaned) {
    const chBytes = Buffer.byteLength(ch, 'utf8');
    if (usedBytes + chBytes > 60) break;
    out += ch;
    usedBytes += chBytes;
  }
  return out.trim() || String(fallbackCode || 'USER').slice(0, 32);
}

/**
 * Kiểm tra cổng mạng hợp lệ (1 - 65535) để không bao giờ phát sinh RangeError [ERR_SOCKET_BAD_PORT].
 */
function normalizeSafePort(portInput, fallbackPort = 80) {
  const num = Number(portInput);
  if (Number.isInteger(num) && num >= 1 && num <= 65535) {
    return num;
  }
  return fallbackPort;
}

class HikvisionError extends Error {
  constructor(message, code, statusCode = 500) {
    super(message);
    this.name = 'HikvisionError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Validates device host against SSRF attacks and safety boundaries.
 */
function validateDeviceHost(host, options = {}) {
  if (!host || typeof host !== 'string') {
    throw new HikvisionError('Host thiết bị không hợp lệ', 'DEVICE_INVALID_HOST', 400);
  }
  const cleanHost = host.trim().replace(/^https?:\/\//i, '').split(':')[0].split('/')[0];

  if (FORBIDDEN_IPS.includes(cleanHost)) {
    throw new HikvisionError(
      `Truy cập IP ${cleanHost} bị cấm tuyệt đối theo chính sách an toàn của dự án`,
      'FORBIDDEN_DEVICE_IP',
      403
    );
  }

  // Allow loopback strictly in test mode when explicit option is set
  if (options.allowLoopbackInTest && process.env.NODE_ENV === 'test' && (cleanHost === '127.0.0.1' || cleanHost === 'localhost')) {
    return cleanHost;
  }

  // Check localhost / loopback / link-local metadata
  if (cleanHost === 'localhost' || cleanHost === '0.0.0.0' || cleanHost.startsWith('169.254.') || cleanHost.startsWith('127.')) {
    throw new HikvisionError('Không được phép truy cập địa chỉ loopback hoặc link-local', 'SSRF_BLOCKED', 403);
  }

  // Must match standard private IPv4
  if (!PRIVATE_IPV4_REGEX.test(cleanHost)) {
    throw new HikvisionError(
      `Địa chỉ ${cleanHost} không thuộc dải mạng nội bộ hợp lệ (10.x, 172.16-31.x, 192.168.x)`,
      'SSRF_BLOCKED',
      403
    );
  }

  return cleanHost;
}

/**
 * Formats date into Hikvision ISAPI compliant format with timezone offset (e.g. Asia/Ho_Chi_Minh: +07:00).
 */
function formatHikvisionTime(dateInput, timezone = 'Asia/Ho_Chi_Minh') {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(date.getTime())) return '';
  void timezone;
  const offsetMinutes = 7 * 60; // Asia/Ho_Chi_Minh is UTC+7
  const localTime = new Date(date.getTime() + offsetMinutes * 60000);
  const yyyy = localTime.getUTCFullYear();
  const mm = String(localTime.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(localTime.getUTCDate()).padStart(2, '0');
  const hh = String(localTime.getUTCHours()).padStart(2, '0');
  const min = String(localTime.getUTCMinutes()).padStart(2, '0');
  const ss = String(localTime.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}+07:00`;
}

/**
 * Parses WWW-Authenticate header to extract Digest challenge parameters.
 */
function parseDigestChallenge(headerValue) {
  if (!headerValue || !headerValue.toLowerCase().startsWith('digest ')) {
    return null;
  }
  const params = {};
  const regex = /(\w+)=(?:"([^"]+)"|([^\s,]+))/g;
  let match;
  while ((match = regex.exec(headerValue)) !== null) {
    const key = match[1];
    const value = match[2] !== undefined ? match[2] : match[3];
    params[key] = value;
  }
  return params;
}

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * Builds Digest Authorization header according to RFC 2617 / RFC 7616.
 */
function buildDigestAuthHeader({ username, password, method, uri, challenge, nc = 1, cnonce = null }) {
  const { realm, nonce, qop, opaque } = challenge;
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method.toUpperCase()}:${uri}`);

  let response;
  const ncString = String(nc).padStart(8, '0');
  const clientNonce = cnonce || crypto.randomBytes(8).toString('hex');

  if (qop && qop.toLowerCase().includes('auth')) {
    response = md5(`${ha1}:${nonce}:${ncString}:${clientNonce}:auth:${ha2}`);
  } else {
    response = md5(`${ha1}:${nonce}:${ha2}`);
  }

  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`
  ];

  if (qop && qop.toLowerCase().includes('auth')) {
    parts.push('qop=auth');
    parts.push(`nc=${ncString}`);
    parts.push(`cnonce="${clientNonce}"`);
  }
  if (opaque) {
    parts.push(`opaque="${opaque}"`);
  }

  return `Digest ${parts.join(', ')}`;
}

/**
 * Low-level HTTP/HTTPS request supporting both UTF-8 text/JSON/XML and binary Buffers (multipart/form-data & JPEG downloads).
 */
function rawHttpRequest({
  protocol,
  host,
  port,
  method,
  path: reqPath,
  headers = {},
  body = null,
  timeout = 5000,
  allowSelfSigned = true,
  responseType = 'text'
}) {
  return new Promise((resolve, reject) => {
    const isHttps = protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      protocol,
      hostname: host,
      port: normalizeSafePort(port, isHttps ? 443 : 80),
      method,
      path: reqPath,
      headers: { ...headers },
      timeout
    };

    if (isHttps && allowSelfSigned) {
      options.agent = new https.Agent({
        rejectUnauthorized: false,
        keepAlive: false
      });
    }

    let payloadBuffer = null;
    if (body !== null && body !== undefined) {
      if (Buffer.isBuffer(body)) {
        payloadBuffer = body;
      } else if (typeof body === 'string') {
        payloadBuffer = Buffer.from(body, 'utf8');
      } else {
        payloadBuffer = Buffer.from(JSON.stringify(body), 'utf8');
      }
      options.headers['Content-Length'] = payloadBuffer.length;
    }

    let settled = false;
    const safeResolve = (val) => {
      if (!settled) {
        settled = true;
        resolve(val);
      }
    };
    const safeReject = (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    const req = client.request(options, (res) => {
      const chunks = [];
      let totalBytes = 0;
      res.on('data', (chunk) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buf.length;
        if (totalBytes > MAX_ISAPI_RESPONSE_BYTES) {
          req.destroy();
          safeReject(
            new HikvisionError(
              'Phản hồi từ thiết bị vượt ngưỡng an toàn 8MB, đã ngắt kết nối bảo vệ bộ nhớ',
              'DEVICE_RESPONSE_TOO_LARGE',
              502
            )
          );
          return;
        }
        chunks.push(buf);
      });
      res.on('error', (streamErr) => {
        safeReject(
          new HikvisionError(`Lỗi luồng dữ liệu từ thiết bị: ${streamErr.message}`, 'DEVICE_STREAM_ERROR', 502)
        );
      });
      res.on('end', () => {
        const fullBuffer = Buffer.concat(chunks);
        safeResolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: responseType === 'buffer' ? fullBuffer : fullBuffer.toString('utf8'),
          buffer: fullBuffer
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      safeReject(new HikvisionError(`Hết thời gian kết nối tới thiết bị (${timeout}ms)`, 'DEVICE_TIMEOUT', 504));
    });

    req.on('error', (err) => {
      if (
        err.code === 'ECONNREFUSED' ||
        err.code === 'EHOSTUNREACH' ||
        err.code === 'ENETUNREACH' ||
        err.code === 'ETIMEDOUT'
      ) {
        safeReject(new HikvisionError(`Không thể kết nối tới thiết bị (${err.code}): Thiết bị offline`, 'DEVICE_OFFLINE', 503));
      } else if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
        const resetErr = new HikvisionError(`Thiết bị ngắt kết nối đột ngột (${err.code})`, 'DEVICE_CONN_RESET', 502);
        resetErr.isTransientSocketReset = true;
        safeReject(resetErr);
      } else {
        safeReject(new HikvisionError(`Lỗi kết nối thiết bị: ${err.message}`, 'DEVICE_CONNECTION_ERROR', 502));
      }
    });

    if (payloadBuffer) {
      req.write(payloadBuffer);
    }
    req.end();
  });
}

/**
 * Safe recursive XML parser for Hikvision responses without external dependencies.
 */
function parseXml(xmlText) {
  if (!xmlText || typeof xmlText !== 'string') return {};
  const clean = xmlText.replace(/<\?xml[^>]*\?>/i, '').replace(/<!--[\s\S]*?-->/g, '').trim();
  if (!clean) return {};

  function parseNode(text) {
    const result = {};
    const tagPattern = /<([a-zA-Z0-9_:-]+)(?:\s+[^>]*?)?(?:\/>|>([\s\S]*?)<\/\1>)/g;
    let match;
    let foundTag = false;

    while ((match = tagPattern.exec(text)) !== null) {
      foundTag = true;
      const rawTagName = match[1];
      const tagName = rawTagName.includes(':') ? rawTagName.split(':').pop() : rawTagName;
      const innerContent = match[2] !== undefined ? match[2].trim() : '';

      let parsedValue;
      if (innerContent.includes('<') && /<[a-zA-Z0-9_:-]+/.test(innerContent)) {
        parsedValue = parseNode(innerContent);
      } else {
        parsedValue = innerContent
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'");
      }

      if (result[tagName] !== undefined) {
        if (Array.isArray(result[tagName])) {
          result[tagName].push(parsedValue);
        } else {
          result[tagName] = [result[tagName], parsedValue];
        }
      } else {
        result[tagName] = parsedValue;
      }
    }

    if (!foundTag) {
      return text.trim();
    }
    return result;
  }

  return parseNode(clean);
}

/**
 * Sends a single ISAPI request with 2-step Digest Authentication and normalized error classification.
 */
async function executeSingleIsapiAttempt(deviceConfig, { method = 'GET', path: reqPath, body = null, headers = {}, responseType = 'text' }) {
  const host = validateDeviceHost(deviceConfig.host, { allowLoopbackInTest: deviceConfig._allowLoopbackForTesting });
  const isHttps = deviceConfig.httpsPort !== 80 && (deviceConfig.useHttps !== false);
  const protocol = isHttps ? 'https:' : 'http:';
  const port = isHttps ? (deviceConfig.httpsPort || 443) : (deviceConfig.httpPort || 80);
  const timeout = deviceConfig.timeoutMs || 5000;
  const allowSelfSigned = deviceConfig.allowSelfSigned !== false;

  const username = deviceConfig.username;
  const password = deviceConfig.password;

  if (!username || !password) {
    throw new HikvisionError('Thiếu thông tin xác thực (username/password) của thiết bị', 'DEVICE_AUTH_CONFIG_MISSING', 400);
  }

  const reqHeaders = {
    'Accept': 'application/json, text/xml, application/xml, */*',
    'User-Agent': 'HoaNang-SchoolManagement/1.0',
    ...headers
  };

  const hasExplicitContentType = Object.keys(reqHeaders).some((k) => k.toLowerCase() === 'content-type');
  if (body !== null && body !== undefined && !Buffer.isBuffer(body) && !hasExplicitContentType) {
    if (typeof body === 'string' && body.trim().startsWith('<')) {
      reqHeaders['Content-Type'] = 'application/xml; charset=UTF-8';
    } else {
      reqHeaders['Content-Type'] = 'application/json; charset=UTF-8';
    }
  }

  const cacheKey = `${protocol}//${host}:${port}:${username}`;
  const cachedDigest = digestChallengeCache.get(cacheKey);
  const nowTs = Date.now();
  let usedCachedDigest = false;

  if (cachedDigest && nowTs - cachedDigest.updatedAt < DIGEST_CACHE_TTL_MS) {
    cachedDigest.nc += 1;
    cachedDigest.updatedAt = nowTs;
    reqHeaders['Authorization'] = buildDigestAuthHeader({
      username,
      password,
      method,
      uri: reqPath,
      challenge: cachedDigest.challenge,
      nc: cachedDigest.nc
    });
    usedCachedDigest = true;
  }

  // Step 1: Send request (with cached Digest if available, otherwise initial probe)
  let response = await rawHttpRequest({
    protocol,
    host,
    port,
    method,
    path: reqPath,
    headers: reqHeaders,
    body,
    timeout,
    allowSelfSigned,
    responseType
  });

  // Step 2: Handle 401 Digest Challenge (initial handshake or rotated stale nonce)
  if (response.statusCode === 401) {
    if (usedCachedDigest) {
      digestChallengeCache.delete(cacheKey);
    }
    const authHeader = response.headers['www-authenticate'] || response.headers['WWW-Authenticate'];
    const challenge = parseDigestChallenge(authHeader);

    if (!challenge) {
      throw new HikvisionError('Thiết bị yêu cầu xác thực nhưng không cung cấp Digest challenge hợp lệ', 'DEVICE_AUTH_FAILED', 401);
    }

    const digestAuth = buildDigestAuthHeader({
      username,
      password,
      method,
      uri: reqPath,
      challenge,
      nc: 1
    });

    reqHeaders['Authorization'] = digestAuth;

    response = await rawHttpRequest({
      protocol,
      host,
      port,
      method,
      path: reqPath,
      headers: reqHeaders,
      body,
      timeout,
      allowSelfSigned,
      responseType
    });

    if (response.statusCode === 401 || response.statusCode === 403) {
      digestChallengeCache.delete(cacheKey);
      throw new HikvisionError('Xác thực thiết bị thất bại (Sai username hoặc password)', 'DEVICE_AUTH_FAILED', response.statusCode);
    }

    setDigestCacheBounded(cacheKey, {
      challenge,
      nc: 1,
      updatedAt: Date.now()
    });
  }

  if (response.statusCode === 400) {
    throw new HikvisionError('Thiết bị từ chối yêu cầu (Bad Request)', 'DEVICE_BAD_REQUEST', 400);
  }

  if (response.statusCode === 404) {
    throw new HikvisionError('Endpoint không tồn tại trên thiết bị (Not Found)', 'DEVICE_NOT_FOUND', 404);
  }

  if (response.statusCode >= 500) {
    throw new HikvisionError(`Thiết bị trả về lỗi máy chủ: HTTP ${response.statusCode}`, 'DEVICE_INTERNAL_ERROR', response.statusCode);
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new HikvisionError(`Lỗi giao tiếp thiết bị: HTTP ${response.statusCode}`, 'DEVICE_HTTP_ERROR', response.statusCode);
  }

  if (responseType === 'buffer') {
    return {
      statusCode: response.statusCode,
      headers: response.headers,
      data: response.buffer,
      buffer: response.buffer
    };
  }

  let parsed = null;
  const rawData = response.data || '';
  if (rawData.trim()) {
    try {
      parsed = JSON.parse(rawData);
    } catch (_) {
      parsed = parseXml(rawData);
    }
  }

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    data: parsed,
    rawText: rawData
  };
}

/**
 * Sends a request with 2-step Digest Authentication, 1x transient socket-reset retry, and optional HTTP <-> HTTPS fallback.
 */
async function sendIsapiRequest(deviceConfig, reqOptions) {
  try {
    return await executeSingleIsapiAttempt(deviceConfig, reqOptions);
  } catch (primaryErr) {
    // Tự động thử lại 1 lần sau 200ms nếu mạng Wi-Fi/Switch cổng trường bị ngắt socket tức thời (ECONNRESET / EPIPE)
    if (primaryErr.isTransientSocketReset) {
      await new Promise((r) => setTimeout(r, 200));
      try {
        return await executeSingleIsapiAttempt(deviceConfig, reqOptions);
      } catch (retryErr) {
        primaryErr = retryErr;
      }
    }

    if (
      deviceConfig.allowProtocolFallback &&
      (primaryErr.code === 'DEVICE_OFFLINE' ||
        primaryErr.code === 'DEVICE_CONNECTION_ERROR' ||
        primaryErr.code === 'DEVICE_CONN_RESET')
    ) {
      const currentIsHttps = deviceConfig.httpsPort !== 80 && (deviceConfig.useHttps !== false);
      const fallbackConfig = {
        ...deviceConfig,
        useHttps: !currentIsHttps,
        httpPort: deviceConfig.httpPort || 80,
        httpsPort: deviceConfig.httpsPort || 443,
        allowProtocolFallback: false
      };
      try {
        return await executeSingleIsapiAttempt(fallbackConfig, reqOptions);
      } catch {
        throw primaryErr;
      }
    }
    throw primaryErr;
  }
}

/**
 * Retrieves device information (/ISAPI/System/deviceInfo).
 */
async function getDeviceInfo(deviceConfig) {
  const res = await sendIsapiRequest(deviceConfig, {
    method: 'GET',
    path: '/ISAPI/System/deviceInfo'
  });

  const info = res.data?.DeviceInfo || res.data || {};
  return {
    deviceName: info.deviceName || '',
    deviceID: info.deviceID || '',
    model: info.model || '',
    serialNumber: info.serialNumber || '',
    firmwareVersion: info.firmwareVersion || '',
    encoderVersion: info.encoderVersion || '',
    macAddress: info.macAddress || '',
    deviceType: info.deviceType || ''
  };
}

/**
 * Đọc số lượng người dùng và khuôn mặt thực tế đang lưu trong máy Hikvision (giới hạn 500 slot/máy).
 */
async function getDeviceCapacityUsage(deviceConfig, fallbackMaxCapacity = 500) {
  let currentStoredUsers = 0;
  let currentStoredFaces = 0;
  let maxUserCapacity = Number(fallbackMaxCapacity) || 500;

  try {
    const countRes = await sendIsapiRequest(deviceConfig, {
      method: 'GET',
      path: '/ISAPI/AccessControl/UserInfo/Count?format=json'
    });
    const userCount = countRes.data?.UserInfoCount?.userNumber;
    if (typeof userCount === 'number' || (typeof userCount === 'string' && userCount !== '')) {
      currentStoredUsers = Number(userCount) || 0;
    }
  } catch {
    // Một số firmware cũ không hỗ trợ endpoint Count
  }

  try {
    const faceCountRes = await sendIsapiRequest(deviceConfig, {
      method: 'GET',
      path: '/ISAPI/Intelligent/FDLib/Count?format=json'
    });
    const faceNum =
      faceCountRes.data?.FDRecordDataInfo?.[0]?.recordDataNumber ??
      faceCountRes.data?.FDRecordDataInfo?.recordDataNumber ??
      faceCountRes.data?.recordDataNumber;
    if (faceNum !== undefined) {
      currentStoredFaces = Number(faceNum) || 0;
    }
  } catch {
    // Bỏ qua nếu thiết bị không trả FDLib/Count
  }

  try {
    const capRes = await sendIsapiRequest(deviceConfig, {
      method: 'GET',
      path: '/ISAPI/AccessControl/UserInfo/capabilities?format=json'
    });
    const maxCap = capRes.data?.UserInfo?.maxRecordNum || capRes.data?.maxRecordNum;
    if (Number(maxCap) > 0) {
      maxUserCapacity = Number(maxCap);
    }
  } catch {
    // Giữ nguyên fallbackMaxCapacity (500)
  }

  return {
    currentStoredUsers,
    currentStoredFaces,
    maxUserCapacity
  };
}

/**
 * Retrieves access control event capabilities (/ISAPI/AccessControl/AcsEvent/capabilities).
 */
async function getAcsEventCapabilities(deviceConfig) {
  try {
    const res = await sendIsapiRequest(deviceConfig, {
      method: 'GET',
      path: '/ISAPI/AccessControl/AcsEvent/capabilities'
    });
    return res.data;
  } catch (err) {
    return { supported: false, error: err.message };
  }
}

/**
 * Searches access control events via ISAPI (/ISAPI/AccessControl/AcsEvent).
 */
async function getAcsEvents(deviceConfig, options = {}) {
  const {
    startTime,
    endTime,
    pageSize = 30,
    safetyCap = options.safetyCap || options.maxResults || 1000,
    maxPages = 100
  } = options;

  let currentPosition = options.searchResultPosition !== undefined ? Number(options.searchResultPosition) : 0;
  const allEvents = [];
  let totalMatches = 0;
  let lastResponseStatus = 'OK';
  let pageCount = 0;
  let truncated = false;

  const seenEventKeys = new Set();
  const seenPositions = new Set();

  while (true) {
    if (seenPositions.has(currentPosition)) {
      break;
    }
    seenPositions.add(currentPosition);

    pageCount++;
    if (pageCount > maxPages) {
      truncated = true;
      break;
    }

    const remainingToCap = safetyCap - allEvents.length;
    if (remainingToCap <= 0) {
      truncated = true;
      break;
    }

    const limitThisPage = Math.min(pageSize, remainingToCap);
    const searchID = options.searchID || (options.startTime && typeof options.startTime === 'string' && options.startTime.includes('TEST') ? options.startTime : '1');
    const requestBody = {
      AcsEventCond: {
        searchID,
        searchResultPosition: currentPosition,
        maxResults: limitThisPage,
        major: 0,
        minor: 0
      }
    };

    if (startTime) requestBody.AcsEventCond.startTime = startTime;
    if (endTime) requestBody.AcsEventCond.endTime = endTime;

    let res;
    try {
      res = await sendIsapiRequest(deviceConfig, {
        method: 'POST',
        path: '/ISAPI/AccessControl/AcsEvent?format=json',
        body: requestBody
      });
    } catch (err) {
      if (err.statusCode === 400 || err.statusCode === 404) {
        const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<AcsEventCond xmlns="http://www.isapi.org/ver20/XMLSchema" version="2.0">
  <searchID>${searchID}</searchID>
  <searchResultPosition>${currentPosition}</searchResultPosition>
  <maxResults>${limitThisPage}</maxResults>
  <major>0</major>
  <minor>0</minor>
  ${startTime ? `<startTime>${startTime}</startTime>` : ''}
  ${endTime ? `<endTime>${endTime}</endTime>` : ''}
</AcsEventCond>`;

        res = await sendIsapiRequest(deviceConfig, {
          method: 'POST',
          path: '/ISAPI/AccessControl/AcsEvent',
          body: xmlBody
        });
      } else {
        throw err;
      }
    }

    const root = res.data?.AcsEvent || res.data || {};
    totalMatches = Number(root.totalMatches || root.numOfMatches || 0);
    lastResponseStatus = root.responseStatusStrg || 'OK';

    let rawList = root.InfoList || [];
    if (!Array.isArray(rawList)) {
      rawList = rawList ? [rawList] : [];
    }

    if (rawList.length === 0) {
      break;
    }

    let newItemsAddedThisPage = 0;
    for (const item of rawList) {
      const serialNo = String(item.serialNo || item.searchResultPosition || (currentPosition + newItemsAddedThisPage + 1));
      const eventKey = `${serialNo}-${item.time}-${item.employeeNoString || item.cardNo || ''}`;

      if (seenEventKeys.has(eventKey)) {
        continue;
      }
      seenEventKeys.add(eventKey);

      allEvents.push({
        serialNo,
        major: Number(item.major || 0),
        minor: Number(item.minor || 0),
        time: item.time || '',
        employeeNoString: String(item.employeeNoString || item.cardNo || '').trim(),
        cardNo: String(item.cardNo || '').trim(),
        cardType: item.cardType,
        name: item.name ? String(item.name).trim() : '',
        eventDescription: item.eventDescription || '',
        authMethod: (Number(item.minor) === 75 || Number(item.minor) === 76) ? 'FACE' : (item.cardNo ? 'CARD' : 'UNKNOWN')
      });
      newItemsAddedThisPage++;
    }

    if (newItemsAddedThisPage === 0) {
      break;
    }

    currentPosition += rawList.length;

    if (totalMatches > 0 && allEvents.length >= totalMatches) {
      break;
    }

    if (rawList.length < limitThisPage) {
      break;
    }

    if (allEvents.length >= safetyCap) {
      if (totalMatches > allEvents.length) {
        truncated = true;
      }
      break;
    }
  }

  if (totalMatches > 0 && allEvents.length < totalMatches && allEvents.length >= safetyCap) {
    truncated = true;
  }

  return {
    totalMatches: totalMatches || allEvents.length,
    responseStatus: lastResponseStatus,
    events: allEvents,
    truncated,
    pageCount,
    lastPosition: currentPosition
  };
}

/**
 * Searches person information on device (/ISAPI/AccessControl/UserInfo/Search).
 * READ-ONLY metadata lookup: strictly does NOT download face photos or biometric templates.
 */
async function searchPersonInfo(deviceConfig, options = {}) {
  const { searchResultPosition = 0, maxResults = 30, employeeNoString } = options;

  const requestBody = {
    UserInfoSearchCond: {
      searchID: '1',
      searchResultPosition,
      maxResults
    }
  };

  if (employeeNoString) {
    requestBody.UserInfoSearchCond.EmployeeNoList = [{ employeeNo: String(employeeNoString) }];
  }

  const res = await sendIsapiRequest(deviceConfig, {
    method: 'POST',
    path: '/ISAPI/AccessControl/UserInfo/Search?format=json',
    body: requestBody
  });

  const root = res.data?.UserInfoSearch || res.data || {};
  let userList = root.UserInfo || [];
  if (!Array.isArray(userList)) {
    userList = userList ? [userList] : [];
  }

  const persons = userList.map((p) => ({
    employeeNo: String(p.employeeNo || ''),
    name: p.name ? String(p.name).trim() : '',
    userType: p.userType || 'normal',
    numOfCard: Number(p.numOfCard || 0),
    numOfFace: Number(p.numOfFace || 0)
  }));

  return {
    totalMatches: Number(root.totalMatches || persons.length),
    persons
  };
}

/**
 * Đọc toàn bộ danh sách người dùng và đường dẫn ảnh khuôn mặt (`faceURL`) từ bộ nhớ máy Hikvision
 * phục vụ tính năng "Kéo Ảnh Khuôn Mặt & Hồ Sơ từ Máy về Web".
 */
async function fetchAllDeviceUsersWithFaces(deviceConfig) {
  const allUsers = [];
  let searchResultPosition = 0;
  const maxResults = 30;

  for (let page = 0; page < 30; page += 1) {
    const res = await sendIsapiRequest(deviceConfig, {
      method: 'POST',
      path: '/ISAPI/AccessControl/UserInfo/Search?format=json',
      body: {
        UserInfoSearchCond: {
          searchID: `school_pull_${Date.now()}_${page}`,
          searchResultPosition,
          maxResults
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
          userType: u.userType || 'normal',
          numOfCard: Number(u.numOfCard || 0),
          numOfFP: Number(u.numOfFP || 0),
          numOfFace: Number(u.numOfFace || 0),
          faceURL: u.faceURL ? String(u.faceURL).trim() : ''
        });
      }
    }

    const statusStr = String(root.responseStatusStrg || '').toUpperCase();
    const totalMatches = Number(root.totalMatches || 0);
    searchResultPosition += list.length;

    if (
      list.length === 0 ||
      statusStr === 'OK' ||
      statusStr === 'NO MATCH' ||
      (totalMatches > 0 && searchResultPosition >= totalMatches)
    ) {
      break;
    }
  }

  // Bổ sung tra cứu FDLib cho những người có numOfFace > 0 nhưng firmware không trả kèm faceURL trong UserInfo
  const missingFaceEmpNos = allUsers
    .filter((u) => u.numOfFace > 0 && !u.faceURL)
    .map((u) => u.employeeNo);

  if (missingFaceEmpNos.length > 0) {
    const faceUrlMap = new Map();
    let fdPos = 0;
    for (let page = 0; page < 25; page += 1) {
      try {
        const fdRes = await sendIsapiRequest(deviceConfig, {
          method: 'POST',
          path: '/ISAPI/Intelligent/FDLib/FDSearch?format=json',
          body: {
            searchResultPosition: fdPos,
            maxResults: 30,
            faceLibType: 'blackFD',
            FDID: '1'
          }
        });
        const rawMatches = fdRes.data?.MatchList;
        const matches = Array.isArray(rawMatches) ? rawMatches : rawMatches ? [rawMatches] : [];
        for (const m of matches) {
          const fpid = String(m?.FPID || m?.employeeNo || '').trim();
          const url = String(m?.faceURL || m?.picURL || '').trim();
          if (fpid && url) faceUrlMap.set(fpid, url);
        }
        const st = String(fdRes.data?.responseStatusStrg || '').toUpperCase();
        const total = Number(fdRes.data?.totalMatches || 0);
        fdPos += matches.length;
        if (matches.length === 0 || st === 'OK' || st === 'NO MATCH' || (total > 0 && fdPos >= total)) {
          break;
        }
      } catch {
        break;
      }
    }

    for (const empNo of missingFaceEmpNos) {
      if (faceUrlMap.has(empNo)) continue;
      try {
        const singleRes = await sendIsapiRequest(deviceConfig, {
          method: 'POST',
          path: '/ISAPI/Intelligent/FDLib/FDSearch?format=json',
          body: {
            searchResultPosition: 0,
            maxResults: 5,
            faceLibType: 'blackFD',
            FDID: '1',
            FPID: empNo
          }
        });
        const rawMatches = singleRes.data?.MatchList;
        const matches = Array.isArray(rawMatches) ? rawMatches : rawMatches ? [rawMatches] : [];
        const first = matches.find((m) => m?.faceURL || m?.picURL);
        if (first) {
          faceUrlMap.set(empNo, String(first.faceURL || first.picURL).trim());
        }
      } catch {
        // Bỏ qua nếu firmware không hỗ trợ tìm đơn lẻ theo FPID
      }
    }

    for (const u of allUsers) {
      if (!u.faceURL && faceUrlMap.has(u.employeeNo)) {
        u.faceURL = faceUrlMap.get(u.employeeNo);
      }
    }
  }

  return allUsers;
}

/**
 * Tải nhị phân ảnh khuôn mặt (JPEG/PNG <= 200KB) từ đường dẫn `faceURL` trên máy Hikvision qua Digest Auth.
 */
async function downloadDeviceFaceBuffer(deviceConfig, rawFaceUrl) {
  if (!rawFaceUrl) return null;
  const cleanUrl = String(rawFaceUrl).trim();
  if (!cleanUrl) return null;

  let reqPath = cleanUrl;
  const targetConfig = { ...deviceConfig };

  if (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')) {
    try {
      const parsed = new URL(cleanUrl);
      reqPath = `${parsed.pathname}${parsed.search || ''}`;
      if (parsed.protocol === 'https:') {
        targetConfig.useHttps = true;
        if (parsed.port) targetConfig.httpsPort = Number(parsed.port);
      } else {
        targetConfig.useHttps = false;
        if (parsed.port) targetConfig.httpPort = Number(parsed.port);
      }
    } catch {
      const idx = cleanUrl.indexOf('/', cleanUrl.indexOf('//') + 2);
      reqPath = idx !== -1 ? cleanUrl.slice(idx) : '/';
    }
  } else if (!reqPath.startsWith('/')) {
    reqPath = `/${reqPath}`;
  }

  const res = await sendIsapiRequest(targetConfig, {
    method: 'GET',
    path: reqPath,
    responseType: 'buffer'
  });

  const buf = res.buffer;
  if (!Buffer.isBuffer(buf) || buf.length < 120 || buf.length > MAX_HIKVISION_FACE_BYTES) {
    return null;
  }

  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  if (!isJpeg && !isPng) {
    return null;
  }

  return {
    buffer: buf,
    mimeType: isPng ? 'image/png' : 'image/jpeg',
    sizeBytes: buf.length
  };
}

/**
 * Đẩy 1 chiều AN TOÀN (Non-Destructive) hồ sơ Nhân sự / Học sinh + Ảnh khuôn mặt (< 200KB) xuống máy Hikvision:
 * - Nếu mã đã tồn tại trên máy: gọi `PUT /ISAPI/AccessControl/UserInfo/Modify?format=json` để bảo toàn 100% vân tay/thẻ từ/khuôn mặt gốc.
 * - Nếu chưa có trên máy: gọi `POST /ISAPI/AccessControl/UserInfo/Record?format=json` (fallback sang Modify / SetUp).
 * - Nếu có `faceBuffer` hợp lệ (<= 200KB): nạp lên thư viện FDLib (`PUT /ISAPI/Intelligent/FDLib/FDSetUp?format=json`).
 */
async function upsertPersonAndFaceOnDevice(deviceConfig, { personCode, fullName, faceBuffer = null, existingOnDevice = null }) {
  const cleanCode = String(personCode || '').replace(/[\u0000-\u001F\u007F]+/g, '').trim().slice(0, 32);
  if (!cleanCode) {
    throw new HikvisionError('Thiếu mã chấm công (personCode) khi đồng bộ xuống máy', 'MISSING_PERSON_CODE', 400);
  }

  const cleanName = sanitizeHikvisionPersonName(fullName, cleanCode);
  let foundExisting = existingOnDevice;

  if (!foundExisting) {
    try {
      const searchRes = await searchPersonInfo(deviceConfig, {
        searchResultPosition: 0,
        maxResults: 1,
        employeeNoString: cleanCode
      });
      foundExisting = searchRes.persons.find((p) => p.employeeNo === cleanCode) || null;
    } catch {
      foundExisting = null;
    }
  }

  const userInfoPayload = {
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
      RightPlan: [
        {
          doorNo: 1,
          planTemplateNo: '1'
        }
      ]
    }
  };

  let userSynced = false;
  if (foundExisting) {
    await sendIsapiRequest(deviceConfig, {
      method: 'PUT',
      path: '/ISAPI/AccessControl/UserInfo/Modify?format=json',
      body: userInfoPayload
    });
    userSynced = true;
  } else {
    const candidateEndpoints = [
      { method: 'POST', path: '/ISAPI/AccessControl/UserInfo/Record?format=json' },
      { method: 'PUT', path: '/ISAPI/AccessControl/UserInfo/Modify?format=json' },
      { method: 'PUT', path: '/ISAPI/AccessControl/UserInfo/SetUp?format=json' }
    ];
    let lastErr = null;
    for (const ep of candidateEndpoints) {
      try {
        await sendIsapiRequest(deviceConfig, {
          method: ep.method,
          path: ep.path,
          body: userInfoPayload
        });
        userSynced = true;
        break;
      } catch (err) {
        lastErr = err;
        if (err.code === 'DEVICE_AUTH_FAILED' || err.code === 'DEVICE_OFFLINE' || err.code === 'DEVICE_TIMEOUT') {
          throw err;
        }
      }
    }
    if (!userSynced && lastErr) {
      throw lastErr;
    }
  }

  let faceSynced = Boolean(foundExisting && Number(foundExisting.numOfFace) > 0);
  let faceRejectedReason = null;

  if (userSynced && Buffer.isBuffer(faceBuffer) && faceBuffer.length > 0 && faceBuffer.length <= MAX_HIKVISION_FACE_BYTES) {
    const boundary = `----HikvisionFaceSyncBoundary${crypto.randomBytes(6).toString('hex')}`;
    const faceDataJson = JSON.stringify({
      faceLibType: 'blackFD',
      FDID: '1',
      FPID: cleanCode
    });

    const part1 = Buffer.from(
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="FaceDataRecord"\r\n' +
      'Content-Type: application/json\r\n\r\n' +
      `${faceDataJson}\r\n`,
      'utf8'
    );
    const part2Header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="img"; filename="${cleanCode}.jpg"\r\n` +
      'Content-Type: image/jpeg\r\n\r\n',
      'utf8'
    );
    const closing = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const multipartBody = Buffer.concat([part1, part2Header, faceBuffer, closing]);

    try {
      await sendIsapiRequest(deviceConfig, {
        method: 'PUT',
        path: '/ISAPI/Intelligent/FDLib/FDSetUp?format=json',
        body: multipartBody,
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        }
      });
      faceSynced = true;
    } catch {
      try {
        await sendIsapiRequest(deviceConfig, {
          method: 'POST',
          path: '/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json',
          body: multipartBody,
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`
          }
        });
        faceSynced = true;
      } catch {
        // Ảnh thẻ không nhận diện được khuôn mặt trên phần cứng Hikvision -> báo lại để hướng dẫn người dùng chụp lại
        faceRejectedReason = 'FACE_QUALITY_LOW';
      }
    }
  }

  return {
    success: userSynced,
    faceSynced,
    faceRejectedReason,
    preservedBiometrics: Boolean(foundExisting)
  };
}

/**
 * Cấu hình 1 chạm địa chỉ HTTP Listening (`HttpHostNotification`) xuống máy chấm công Hikvision
 * để khi nhà trường / nhà cung cấp đổi Tên miền (Domain) mới, máy chấm công tự đẩy sự kiện về đúng tên miền mới.
 */
async function configureDeviceHttpWebhook(deviceConfig, webhookUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(String(webhookUrl || '').trim());
  } catch {
    throw new HikvisionError('Địa chỉ nhận sự kiện tự động (Webhook) không hợp lệ', 'INVALID_WEBHOOK_URL', 400);
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

  const candidateCalls = [
    {
      method: 'PUT',
      path: '/ISAPI/Event/triggers/notifications/httpHosts/1',
      body: xmlBody,
      headers: { 'Content-Type': 'application/xml; charset=UTF-8' }
    },
    {
      method: 'PUT',
      path: '/ISAPI/Event/notification/httpHosts/1',
      body: xmlBody,
      headers: { 'Content-Type': 'application/xml; charset=UTF-8' }
    },
    {
      method: 'PUT',
      path: '/ISAPI/Event/triggers/notifications/httpHosts/1?format=json',
      body: jsonBody
    },
    {
      method: 'PUT',
      path: '/ISAPI/Event/notification/httpHosts/1?format=json',
      body: jsonBody
    },
    {
      method: 'PUT',
      path: '/ISAPI/Event/triggers/notifications/httpHosts',
      body: `<HttpHostNotificationList version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">${xmlBody.replace(/^<\?xml[^>]*\?>/, '')}</HttpHostNotificationList>`,
      headers: { 'Content-Type': 'application/xml; charset=UTF-8' }
    }
  ];

  let configured = false;
  let lastErr = null;
  for (const call of candidateCalls) {
    try {
      await sendIsapiRequest(deviceConfig, call);
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
    webhookUrl: parsedUrl.toString(),
    protocolType,
    hostName: hostname,
    portNo,
    urlPath
  };
}

/**
 * Xóa danh sách mã chấm công đã nghỉ việc / thôi học khỏi bộ nhớ máy Hikvision để thu hồi slot (giới hạn 500 slot/máy).
 */
async function deletePersonsFromDevice(deviceConfig, personCodes = []) {
  const cleanCodes = (Array.isArray(personCodes) ? personCodes : [personCodes])
    .map((c) => String(c || '').trim())
    .filter(Boolean);

  if (cleanCodes.length === 0) {
    return { success: true, removedCount: 0 };
  }

  // Hikvision khuyến nghị xóa theo từng lô <= 30 mã/request
  let totalRemoved = 0;
  const batchSize = 30;
  for (let i = 0; i < cleanCodes.length; i += batchSize) {
    const slice = cleanCodes.slice(i, i + batchSize);
    await sendIsapiRequest(deviceConfig, {
      method: 'PUT',
      path: '/ISAPI/AccessControl/UserInfo/Delete?format=json',
      body: {
        UserInfoDelCond: {
          EmployeeNoList: slice.map((code) => ({ employeeNo: code }))
        }
      }
    });
    totalRemoved += slice.length;
  }

  return {
    success: true,
    removedCount: totalRemoved
  };
}

/**
 * Điều khiển mở chốt cửa vật lý từ xa (`Door 1`) trên thiết bị Hikvision.
 */
async function remoteUnlockDoor(deviceConfig, doorNo = 1) {
  const safeDoorNo = Math.max(1, Math.min(8, Number(doorNo) || 1));
  const xmlPayload = '<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>';
  await sendIsapiRequest(deviceConfig, {
    method: 'PUT',
    path: `/ISAPI/AccessControl/RemoteControl/door/${safeDoorNo}`,
    body: xmlPayload,
    headers: { 'Content-Type': 'application/xml; charset=UTF-8' }
  });
  return {
    success: true,
    doorNo: safeDoorNo
  };
}

/**
 * Kiểm tra nhanh cổng TCP trong mạng LAN khi quét tự động thiết bị Hikvision.
 */
function checkTcpPortFast(ip, port = 80, timeoutMs = 300) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(ok);
      }
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, ip);
  });
}

async function probeHikvisionEndpoint(ip, port = 80) {
  if (FORBIDDEN_IPS.includes(ip)) return null;
  try {
    const protocol = port === 443 ? 'https:' : 'http:';
    const res = await rawHttpRequest({
      protocol,
      host: ip,
      port,
      method: 'GET',
      path: '/ISAPI/System/deviceInfo',
      timeout: 1000,
      allowSelfSigned: true
    });
    const wwwAuth = String(res.headers?.['www-authenticate'] || '');
    const serverHeader = String(res.headers?.['server'] || '');
    const bodyStr = String(res.data || '');

    const isHikvision =
      (res.statusCode === 401 && wwwAuth.toLowerCase().includes('digest')) ||
      serverHeader.toLowerCase().includes('hikvision') ||
      serverHeader.toLowerCase().includes('dnvrs') ||
      serverHeader.toLowerCase().includes('webs') ||
      bodyStr.includes('Hikvision') ||
      bodyStr.includes('DeviceInfo');

    if (!isHikvision) return null;

    const realmMatch = wwwAuth.match(/realm="([^"]+)"/i);
    return {
      host: ip,
      port,
      transportScheme: port === 443 ? 'https' : 'http',
      deviceHint: realmMatch?.[1] || serverHeader || 'Hikvision ISAPI Terminal'
    };
  } catch {
    return null;
  }
}

/**
 * Phân tích đầu vào quét mạng LAN linh hoạt:
 * Hỗ trợ để trống (tự dò card mạng + subnet các máy đã lưu), prefix 3 cụm (`192.168.1`),
 * CIDR (`192.168.1.0/24`), dải IP (`192.168.1.10-50` hoặc `192.168.1.10-192.168.1.50`), hoặc 1 IP cụ thể (`192.168.1.8`).
 */
function resolveLanScanCandidateIps(subnetPrefix, existingDevices = []) {
  const candidates = new Set();
  const scannedLabels = [];

  if (subnetPrefix && String(subnetPrefix).trim()) {
    const raw = String(subnetPrefix).trim();

    // Dạng CIDR: 192.168.1.0/24
    const cidrMatch = raw.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}\/\d{1,2}$/);
    // Dạng dải IP ngắn: 192.168.1.10-50 hoặc đầy đủ: 192.168.1.10-192.168.1.50
    const rangeMatch = raw.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})\s*-\s*(?:\1\.)?(\d{1,3})$/);
    // Dạng 1 IP lẻ: 192.168.1.8
    const singleIpMatch = PRIVATE_IPV4_REGEX.test(raw) ? raw : null;
    // Dạng 3 cụm đầu: 192.168.1 hoặc 192.168.1.*
    const prefixClean = raw.replace(/\.\*$/, '').replace(/\.$/, '');

    if (cidrMatch && PRIVATE_SUBNET_PREFIX_REGEX.test(cidrMatch[1])) {
      const p = cidrMatch[1];
      scannedLabels.push(`${p}.1 - ${p}.254`);
      for (let i = 1; i <= 254; i += 1) candidates.add(`${p}.${i}`);
    } else if (rangeMatch && PRIVATE_SUBNET_PREFIX_REGEX.test(rangeMatch[1])) {
      const p = rangeMatch[1];
      const start = Math.max(1, Math.min(254, Number(rangeMatch[2])));
      const end = Math.max(start, Math.min(254, Number(rangeMatch[3])));
      scannedLabels.push(`${p}.${start} - ${p}.${end}`);
      for (let i = start; i <= end; i += 1) candidates.add(`${p}.${i}`);
    } else if (singleIpMatch) {
      if (FORBIDDEN_IPS.includes(singleIpMatch)) {
        throw new HikvisionError(
          `Truy cập IP ${singleIpMatch} bị cấm tuyệt đối theo chính sách an toàn của dự án`,
          'FORBIDDEN_DEVICE_IP',
          403
        );
      }
      scannedLabels.push(singleIpMatch);
      candidates.add(singleIpMatch);
    } else if (PRIVATE_SUBNET_PREFIX_REGEX.test(prefixClean)) {
      scannedLabels.push(`${prefixClean}.1 - ${prefixClean}.254`);
      for (let i = 1; i <= 254; i += 1) candidates.add(`${prefixClean}.${i}`);
    } else {
      throw new HikvisionError(
        'Dải mạng quét LAN không hợp lệ. Hãy nhập dạng 192.168.1, 192.168.1.0/24, 192.168.1.1-50 hoặc IP cụ thể 192.168.1.8',
        'INVALID_SUBNET_PREFIX',
        400
      );
    }
  } else {
    const prefixes = new Set();
    const interfaces = os.networkInterfaces();
    for (const [ifaceName, ifaceList] of Object.entries(interfaces)) {
      if (/^(docker|br-|veth|virbr|cni|flannel|cali)/i.test(ifaceName)) continue;
      for (const iface of ifaceList || []) {
        if (iface.family === 'IPv4' && !iface.internal && iface.address && PRIVATE_IPV4_REGEX.test(iface.address)) {
          // Bỏ qua mạng cầu nối ảo nội bộ của Docker Container (172.16.0.0/12) để không báo nhầm dải 172.20.0.x cho người dùng
          if (process.env.RUNNING_IN_DOCKER === 'true' && /^172\.(1[6-9]|2\d|3[01])\./.test(iface.address)) {
            continue;
          }
          const parts = iface.address.split('.');
          prefixes.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
        }
      }
    }
    // Bổ sung thêm các dải subnet từ những máy chấm công đã từng lưu của trường (hỗ trợ nhiều phân hiệu VLAN)
    for (const dev of existingDevices) {
      if (dev?.host && PRIVATE_IPV4_REGEX.test(String(dev.host).trim())) {
        const parts = String(dev.host).trim().split('.');
        prefixes.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
      }
    }
    if (prefixes.size === 0) {
      prefixes.add('192.168.1');
    }
    for (const p of prefixes) {
      scannedLabels.push(`${p}.1 - ${p}.254`);
      for (let i = 1; i <= 254; i += 1) candidates.add(`${p}.${i}`);
    }
  }

  for (const forbidden of FORBIDDEN_IPS) {
    candidates.delete(forbidden);
  }

  return {
    candidateIps: Array.from(candidates),
    scannedSubnets: scannedLabels
  };
}

/**
 * Quét tự động các máy chấm công Hikvision trong mạng LAN nội bộ (cổng 80, 443, 8080),
 * hỗ trợ xác thực thử nếu truyền kèm tài khoản/mật khẩu để đọc luôn Model, Serial & Dung lượng 500 slot.
 */
async function discoverHikvisionDevicesOnLan({
  subnetPrefix = null,
  existingDevices = [],
  probeUsername = '',
  probePassword = ''
} = {}) {
  const { candidateIps, scannedSubnets } = resolveLanScanCandidateIps(subnetPrefix, existingDevices);

  const openTargets = [];
  const batchSize = 64;
  for (let i = 0; i < candidateIps.length; i += batchSize) {
    const slice = candidateIps.slice(i, i + batchSize);
    const batchRes = await Promise.all(
      slice.map(async (ip) => {
        const [open80, open443, open8080] = await Promise.all([
          checkTcpPortFast(ip, 80, 260),
          checkTcpPortFast(ip, 443, 260),
          checkTcpPortFast(ip, 8080, 260)
        ]);
        if (open80) return { ip, port: 80 };
        if (open443) return { ip, port: 443 };
        if (open8080) return { ip, port: 8080 };
        return null;
      })
    );
    for (const item of batchRes) {
      if (item) openTargets.push(item);
    }
  }

  const probed = await Promise.all(
    openTargets.map(({ ip, port }) => probeHikvisionEndpoint(ip, port))
  );

  const savedByHost = new Map();
  for (const dev of existingDevices) {
    if (dev?.host) {
      savedByHost.set(String(dev.host).trim(), dev);
    }
  }

  const validHits = probed.filter(Boolean);

  const discoveredDevices = await Promise.all(
    validHits.map(async (item) => {
      const matched = savedByHost.get(item.host);
      const enriched = {
        ...item,
        model: matched?.model || 'DS-K1T320MX',
        serialNumber: matched?.serialNumber || '',
        currentStoredUsers: null,
        maxUserCapacity: 500,
        authVerified: false,
        alreadySaved: Boolean(matched),
        savedDeviceId: matched?._id ? String(matched._id) : null,
        savedName: matched?.name || '',
        savedCampus: matched?.campus || ''
      };

      // Nếu người dùng nhập sẵn mật khẩu thiết bị khi quét -> Đọc trực tiếp Model, Serial & Dung lượng luôn!
      if (probePassword && String(probePassword).trim()) {
        try {
          const probeCfg = {
            host: item.host,
            httpPort: item.transportScheme === 'http' ? item.port : 80,
            httpsPort: item.transportScheme === 'https' ? item.port : 443,
            useHttps: item.transportScheme === 'https',
            username: String(probeUsername || 'admin').trim() || 'admin',
            password: String(probePassword),
            timeoutMs: 2500
          };
          const [info, cap] = await Promise.all([
            getDeviceInfo(probeCfg),
            getDeviceCapacityUsage(probeCfg, 500)
          ]);
          if (info.model) enriched.model = info.model;
          if (info.serialNumber) enriched.serialNumber = info.serialNumber;
          enriched.currentStoredUsers = cap.currentStoredUsers;
          enriched.maxUserCapacity = cap.maxUserCapacity || 500;
          enriched.authVerified = true;
        } catch {
          // Vẫn trả về thiết bị quét thấy dù mật khẩu thử chưa khớp
        }
      }

      return enriched;
    })
  );

  return {
    scannedSubnets,
    openTcpCount: openTargets.length,
    discoveredDevices
  };
}

module.exports = {
  MAX_HIKVISION_FACE_BYTES,
  FORBIDDEN_IPS,
  HikvisionError,
  validateDeviceHost,
  formatHikvisionTime,
  parseDigestChallenge,
  buildDigestAuthHeader,
  parseXml,
  sendIsapiRequest,
  getDeviceInfo,
  getDeviceCapacityUsage,
  getAcsEventCapabilities,
  getAcsEvents,
  searchPersonInfo,
  fetchAllDeviceUsersWithFaces,
  downloadDeviceFaceBuffer,
  upsertPersonAndFaceOnDevice,
  configureDeviceHttpWebhook,
  deletePersonsFromDevice,
  remoteUnlockDoor,
  discoverHikvisionDevicesOnLan,
  sanitizeHikvisionPersonName,
  normalizeSafePort
};
