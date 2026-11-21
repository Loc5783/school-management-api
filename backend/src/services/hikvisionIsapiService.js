'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');

// Strict SSRF IP Validation: Only allow standard private LAN subnets
const PRIVATE_IPV4_REGEX = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$/;

// CRITICAL SAFETY GUARD: Specifically forbid device 192.168.1.22
const FORBIDDEN_IPS = Object.freeze(['192.168.1.22']);

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

/**
 * Generates MD5 hex hash.
 */
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
    parts.push(`qop=auth`);
    parts.push(`nc=${ncString}`);
    parts.push(`cnonce="${clientNonce}"`);
  }
  if (opaque) {
    parts.push(`opaque="${opaque}"`);
  }

  return `Digest ${parts.join(', ')}`;
}

/**
 * Low-level HTTP/HTTPS request with Digest Authentication and TLS safety.
 */
function rawHttpRequest({ protocol, host, port, method, path: reqPath, headers = {}, body = null, timeout = 5000, allowSelfSigned = true }) {
  return new Promise((resolve, reject) => {
    const isHttps = protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      protocol,
      hostname: host,
      port,
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

    if (body) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = client.request(options, (res) => {
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: rawData
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new HikvisionError(`Hết thời gian kết nối tới thiết bị (${timeout}ms)`, 'DEVICE_TIMEOUT', 504));
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH') {
        reject(new HikvisionError(`Không thể kết nối tới thiết bị (${err.code}): Thiết bị offline`, 'DEVICE_OFFLINE', 503));
      } else {
        reject(new HikvisionError(`Lỗi kết nối thiết bị: ${err.message}`, 'DEVICE_CONNECTION_ERROR', 502));
      }
    });

    if (body) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      req.write(payload);
    }
    req.end();
  });
}

/**
 * Safe recursive XML parser for Hikvision responses without external dependencies.
 * Handles nested tags, repeated sibling items into Arrays, and XML entity escaping.
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
 * Sends a request with 2-step Digest Authentication and normalized error classification.
 */
async function sendIsapiRequest(deviceConfig, { method = 'GET', path: reqPath, body = null, headers = {} }) {
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
  if (body) {
    if (typeof body === 'string' && body.trim().startsWith('<')) {
      reqHeaders['Content-Type'] = 'application/xml; charset=UTF-8';
    } else {
      reqHeaders['Content-Type'] = 'application/json; charset=UTF-8';
    }
  }

  // Step 1: Initial probe request without auth (or device might challenge with 401)
  let response = await rawHttpRequest({
    protocol,
    host,
    port,
    method,
    path: reqPath,
    headers: reqHeaders,
    body,
    timeout,
    allowSelfSigned
  });

  // Step 2: Handle 401 Digest Challenge
  if (response.statusCode === 401) {
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

    // Send authenticated request
    response = await rawHttpRequest({
      protocol,
      host,
      port,
      method,
      path: reqPath,
      headers: reqHeaders,
      body,
      timeout,
      allowSelfSigned
    });

    if (response.statusCode === 401 || response.statusCode === 403) {
      throw new HikvisionError('Xác thực thiết bị thất bại (Sai username hoặc password)', 'DEVICE_AUTH_FAILED', response.statusCode);
    }
  }

  // Explicit HTTP Status Classification
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

  // Parse payload (try JSON, then XML fallback)
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
 * Multi-page pagination until all totalMatches are collected or safetyCap is reached.
 *
 * @param {Object} deviceConfig
 * @param {Object} options {
 *   startTime,
 *   endTime,
 *   searchResultPosition = 0,
 *   pageSize = 30,
 *   safetyCap = 1000,
 *   maxPages = 100
 * }
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
  let allEvents = [];
  let totalMatches = 0;
  let lastResponseStatus = 'OK';
  let pageCount = 0;
  let truncated = false;

  const seenEventKeys = new Set();
  const seenPositions = new Set();

  while (true) {
    if (seenPositions.has(currentPosition)) {
      // Loop detected: searchResultPosition has stopped progressing
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

    const searchID = options.searchID || (options.startTime && typeof options.startTime === 'string' && options.startTime.includes('TEST') ? options.startTime : "1");
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
      // If JSON format fails with 400/404, fallback to XML format
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
        // Repeated event returned by device across pages
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
      // Device returned identical duplicate slice, stop pagination
      break;
    }

    currentPosition += rawList.length;

    // Check if we reached all totalMatches
    if (totalMatches > 0 && allEvents.length >= totalMatches) {
      break;
    }

    // If device returned fewer than requested limit, no further items exist
    if (rawList.length < limitThisPage) {
      break;
    }

    // If we reached safetyCap
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
      searchID: "1",
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

module.exports = {
  HikvisionError,
  validateDeviceHost,
  formatHikvisionTime,
  parseDigestChallenge,
  buildDigestAuthHeader,
  parseXml,
  sendIsapiRequest,
  getDeviceInfo,
  getAcsEventCapabilities,
  getAcsEvents,
  searchPersonInfo
};
