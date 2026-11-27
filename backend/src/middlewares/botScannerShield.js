'use strict';

/**
 * @fileoverview Lá chắn Bảo mật Chống Bot Dò Quét Lỗ Hổng, Tấn Công Tự Động & NoSQL Injection khi triển khai Public Internet.
 *
 * Các lớp bảo vệ chính:
 * 1. Phục vụ `/robots.txt` cấm lập chỉ mục tìm kiếm và gắn `X-Robots-Tag: noindex, nofollow, noarchive`.
 * 2. Chặn sớm (`O(1)` trước cả JSON Parser và SPA Fallback `index.html`) các đường dẫn dò quét phổ biến
 *    (`/.env`, `/.git`, `/wp-admin`, `*.php`, `/phpmyadmin`, `/actuator`, `/cgi-bin`, Path Traversal `%2e%2e`, Null-byte).
 *    Điều này ngăn chặn hiện tượng "Soft-200" (SPA trả 200 cho mọi URL rác khiến công cụ quét bắn tiếp hàng vạn payload).
 * 3. Chặn các User-Agent công cụ tấn công tự động (`sqlmap`, `nikto`, `nuclei`, `nmap`, `masscan`, `gobuster`, `acunetix`...).
 * 4. Tự động tạm khóa IP ngoại mạng liên tục dò quét bẫy lỗ hổng (`>= 8` lần vi phạm / 5 phút -> cách ly 15 phút)
 *    với bộ nhớ giới hạn cứng (`MAX_TRACKED_IPS = 5000`) chống tràn RAM khi bị DDoS.
 * 5. Làm sạch đệ quy `req.body`, `req.query`, `req.params` chống NoSQL Operator Injection (`$gt`, `$ne`, `$where`...)
 *    và Prototype Pollution (`__proto__`, `constructor`, `prototype`), đồng thời chặn JSON lồng quá sâu (`> 14` tầng).
 */

const MAX_URL_LENGTH = 4096;
const MAX_OBJECT_DEPTH = 14;
const MAX_TRACKED_IPS = 5000;
const STRIKE_WINDOW_MS = 5 * 60 * 1000;
const BAN_DURATION_MS = 15 * 60 * 1000;
const MAX_SCANNER_STRIKES = 8;

// Nhận diện User-Agent của các công cụ dò quét lỗ hổng / khai thác tự động phổ biến
const MALICIOUS_SCANNER_UA_REGEX = /\b(sqlmap|nikto|nmap|masscan|zgrab|nuclei|dirbuster|gobuster|ffuf|wfuzz|acunetix|nessus|openvas|havij|appscan|commix|wpscan|jaeles|feroxbuster|dirsearch)\b/i;

// Nhận diện các đường dẫn dò quét lỗ hổng phổ biến trên Internet (PHP, WordPress, Dotfiles, Cloud/Router exploits)
const EXPLOIT_PROBE_PATH_REGEX = new RegExp(
  [
    '^\\/\\.(env|git|svn|hg|aws|ssh|docker|vscode|idea|htaccess|htpasswd|npmrc|bashrc|DS_Store)(?:[\\/.]|$)',
    '^\\/(wp-admin|wp-login|wp-content|wp-includes|xmlrpc\\.php|phpmyadmin|pma|myadmin|adminer|mysqladmin)(?:[\\/.]|$)',
    '^\\/(actuator|cgi-bin|boaform|HNAP1|GponForm|autodiscover|ecp|_ignition|telescope|server-status|server-info)(?:[\\/.]|$)',
    '^\\/vendor\\/phpunit(?:[\\/]|$)',
    '^\\/(dockerfile|docker-compose|package\\.json|package-lock\\.json|yarn\\.lock|composer\\.json|web\\.config)(?:[\\/.]|$)',
    '\\.(php[0-9]?|phtml|asp|aspx|jsp|jspx|cgi|pl|sh|bak|sql|ini|conf|swp)$'
  ].join('|'),
  'i'
);

const DANGEROUS_PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** @type {Map<string, { count: number, firstAt: number, bannedUntil: number }>} */
const scannerIpTracker = new Map();

/**
 * Kiểm tra môi trường chạy kiểm thử tự động để tránh khóa IP localhost khi test bảo mật.
 * @returns {boolean}
 */
const isTestEnvironment = () =>
  process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);

/**
 * Lấy địa chỉ IP thực của client (tôn trọng cấu hình `trust proxy` của Express).
 * @param {import('express').Request} req
 * @returns {string}
 */
const getClientIp = (req) => {
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').trim();
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
};

/**
 * Kiểm tra IP nội bộ localhost để không tự khóa nhầm máy chủ phát triển.
 * @param {string} ip
 * @returns {boolean}
 */
const isLoopbackIp = (ip) =>
  ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip === 'unknown';

/**
 * Dọn dẹp định kỳ bảng theo dõi IP khi đầy để đảm bảo an toàn bộ nhớ tuyệt đối.
 * @param {number} now
 */
const pruneTrackerIfNeeded = (now) => {
  if (scannerIpTracker.size < MAX_TRACKED_IPS) return;
  for (const [ip, entry] of scannerIpTracker.entries()) {
    if (entry.bannedUntil < now && now - entry.firstAt > STRIKE_WINDOW_MS) {
      scannerIpTracker.delete(ip);
    }
  }
  // Nếu vẫn đầy do tấn công phân tán quy mô lớn, xóa bớt 20% mục cũ nhất (FIFO)
  if (scannerIpTracker.size >= MAX_TRACKED_IPS) {
    let toRemove = Math.ceil(MAX_TRACKED_IPS * 0.2);
    for (const ip of scannerIpTracker.keys()) {
      scannerIpTracker.delete(ip);
      toRemove -= 1;
      if (toRemove <= 0) break;
    }
  }
};

/**
 * Ghi nhận 1 lần vi phạm dò quét lỗ hổng từ IP ngoại mạng; nếu vượt ngưỡng thì cách ly tạm thời.
 * @param {string} ip
 */
const recordScannerStrike = (ip) => {
  if (isTestEnvironment() || isLoopbackIp(ip)) return;

  const now = Date.now();
  pruneTrackerIfNeeded(now);

  const current = scannerIpTracker.get(ip);
  if (!current || now - current.firstAt > STRIKE_WINDOW_MS) {
    scannerIpTracker.set(ip, { count: 1, firstAt: now, bannedUntil: 0 });
    return;
  }

  current.count += 1;
  if (current.count >= MAX_SCANNER_STRIKES) {
    current.bannedUntil = now + BAN_DURATION_MS;
  }
};

/**
 * Kiểm tra xem IP hiện tại có đang trong thời gian bị cách ly do quét lỗ hổng hay không.
 * @param {string} ip
 * @returns {boolean}
 */
const isIpQuarantined = (ip) => {
  if (isTestEnvironment() || isLoopbackIp(ip)) return false;
  const entry = scannerIpTracker.get(ip);
  if (!entry) return false;
  const now = Date.now();
  if (entry.bannedUntil > now) {
    return true;
  }
  if (entry.bannedUntil > 0 && entry.bannedUntil <= now) {
    scannerIpTracker.delete(ip);
  }
  return false;
};

/**
 * Làm sạch đệ quy tại chỗ (in-place) các khóa độc hại (`$*`, `__proto__`, `constructor`, `prototype`)
 * trong `req.body`, `req.query`, `req.params` và kiểm soát độ sâu JSON.
 *
 * @param {unknown} target
 * @param {number} [depth=0]
 */
const sanitizeObjectInPlace = (target, depth = 0) => {
  if (!target || typeof target !== 'object' || Buffer.isBuffer(target) || target instanceof Date) {
    return;
  }
  if (depth > MAX_OBJECT_DEPTH) {
    const err = new Error('Cấu trúc dữ liệu gửi lên lồng nhau vượt quá giới hạn an toàn.');
    err.statusCode = 400;
    throw err;
  }

  if (Array.isArray(target)) {
    for (let i = 0; i < target.length; i += 1) {
      sanitizeObjectInPlace(target[i], depth + 1);
    }
    return;
  }

  for (const key of Object.keys(target)) {
    if (key.startsWith('$') || DANGEROUS_PROTO_KEYS.has(key) || key.includes('\0')) {
      delete target[key];
      continue;
    }
    sanitizeObjectInPlace(target[key], depth + 1);
  }
};

/**
 * Middleware chặn sớm Bot dò quét lỗ hổng, Path Traversal và công cụ khai thác tự động.
 * Đặt TRƯỚC `express.json()` và SPA Fallback để tiết kiệm tối đa tài nguyên CPU/RAM/DB.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const botScannerShieldMiddleware = (req, res, next) => {
  // Chặn công cụ tìm kiếm lập chỉ mục dữ liệu nội bộ nhà trường
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');

  const rawUrl = String(req.originalUrl || req.url || '/');

  // 1. Phục vụ nhanh /robots.txt chuẩn chống thu thập dữ liệu
  if (req.method === 'GET' && rawUrl.split('?')[0] === '/robots.txt') {
    res.type('text/plain');
    return res.status(200).send('User-agent: *\nDisallow: /\n');
  }

  // Cho phép SuperAdmin bật/tắt Lá chắn Anti-Bot thời gian thực từ trang Cấu hình Hệ thống
  try {
    const { isAntiBotShieldEnabledSync } = require('../services/superAdminControlService');
    if (!isAntiBotShieldEnabledSync()) {
      return next();
    }
  } catch {
    // Mặc định luôn bật bảo vệ nếu module cấu hình chưa nạp
  }

  // 2. Từ chối tức thời nếu IP đang bị tạm khóa do hành vi quét lỗ hổng hàng loạt
  const clientIp = getClientIp(req);
  if (isIpQuarantined(clientIp)) {
    return res.status(429).json({
      success: false,
      code: 'SCANNER_QUARANTINED',
      message: 'Phát hiện truy cập bất thường tự động. Địa chỉ mạng của bạn đang bị tạm khóa 15 phút.'
    });
  }

  // 3. Chặn URL quá dài bất thường (Buffer/Regex DoS)
  if (rawUrl.length > MAX_URL_LENGTH) {
    recordScannerStrike(clientIp);
    return res.status(414).json({
      success: false,
      message: 'Đường dẫn truy cập vượt quá độ dài cho phép.'
    });
  }

  // 4. Chặn HTTP Methods lạ thường dùng để dò cấu hình WebDAV/TRACE
  const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
  if (!allowedMethods.has(req.method)) {
    recordScannerStrike(clientIp);
    return res.status(405).json({
      success: false,
      message: 'Phương thức truy cập không được hỗ trợ.'
    });
  }

  // 5. Chặn User-Agent của các công cụ tấn công tự động
  const userAgent = String(req.headers['user-agent'] || '');
  if (userAgent && MALICIOUS_SCANNER_UA_REGEX.test(userAgent)) {
    recordScannerStrike(clientIp);
    return res.status(403).json({
      success: false,
      code: 'BOT_SCANNER_BLOCKED',
      message: 'Truy cập tự động bị từ chối bởi hệ thống bảo vệ máy chủ.'
    });
  }

  // 6. Giải mã an toàn đường dẫn để phát hiện Path Traversal (%2e%2e, %00) & Exploit Probes
  const rawPathname = rawUrl.split('?')[0];
  let decodedPath = rawPathname;
  try {
    decodedPath = decodeURIComponent(rawPathname);
  } catch {
    recordScannerStrike(clientIp);
    return res.status(400).json({
      success: false,
      message: 'Đường dẫn chứa ký tự mã hóa không hợp lệ.'
    });
  }

  if (
    decodedPath.includes('\0') ||
    decodedPath.includes('..') ||
    decodedPath.includes('\\')
  ) {
    recordScannerStrike(clientIp);
    return res.status(400).json({
      success: false,
      code: 'PATH_TRAVERSAL_BLOCKED',
      message: 'Đường dẫn truy cập không hợp lệ.'
    });
  }

  if (EXPLOIT_PROBE_PATH_REGEX.test(decodedPath)) {
    recordScannerStrike(clientIp);
    return res.status(404).json({
      success: false,
      message: 'Không tìm thấy tài nguyên.'
    });
  }

  return next();
};

/**
 * Middleware làm sạch dữ liệu đầu vào sau khi `express.json()` đã phân tích cú pháp body.
 * Chống triệt để NoSQL Injection (`{ "$gt": "" }`) và Prototype Pollution trên toàn bộ API.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const requestPayloadSanitizer = (req, res, next) => {
  try {
    if (req.body && typeof req.body === 'object') {
      sanitizeObjectInPlace(req.body, 0);
    }
    if (req.query && typeof req.query === 'object') {
      sanitizeObjectInPlace(req.query, 0);
    }
    if (req.params && typeof req.params === 'object') {
      sanitizeObjectInPlace(req.params, 0);
    }
    return next();
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      message: err.message || 'Dữ liệu đầu vào không hợp lệ.'
    });
  }
};

/**
 * Kiểm tra trường bẫy Bot ẩn (Honeypot) trên biểu mẫu công khai như Đăng nhập.
 * Người dùng thật không nhìn thấy ô `_hp_website`; bot tự động điền tất cả các ô input sẽ bị chặn ngay.
 *
 * @param {import('express').Request} req
 * @returns {boolean}
 */
const isHoneypotTriggered = (req) => {
  const trapValue = req.body?._hp_website;
  if (trapValue !== undefined && trapValue !== null && String(trapValue).trim() !== '') {
    recordScannerStrike(getClientIp(req));
    return true;
  }
  return false;
};

module.exports = {
  botScannerShieldMiddleware,
  requestPayloadSanitizer,
  sanitizeObjectInPlace,
  isHoneypotTriggered
};

