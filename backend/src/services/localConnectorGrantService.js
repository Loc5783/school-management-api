'use strict';

/**
 * @fileoverview Dịch vụ Cấp Khóa Ký Số Ed25519 & Đóng Gói Bộ Cài 1 Chạm cho `Local LAN Connector (127.0.0.1:18686)`.
 *
 * Tại sao dùng cặp khóa bất đối xứng Ed25519 lưu trong `SystemSetting`:
 * - Khi nhà trường tải `HoaNang-Local-LAN-Connector.zip` một lần duy nhất về máy tính văn phòng trường,
 *   bên trong chỉ chứa `publicKeyPem` (khóa công khai xác thực chữ ký của Server) và khóa giải mã phong bì thiết bị.
 * - KHÔNG HỀ CHỨA BẤT KỲ TÊN MIỀN (DOMAIN) CỐ ĐỊNH NÀO TRONG MÃ NGUỒN HAY FILE CẤU HÌNH.
 * - Khi tương lai hệ thống chuyển sang bất kỳ tên miền mới nào, Backend trên tên miền mới ký `X-Connector-Grant`
 *   chứa `allowedOrigin` động hiện tại -> `127.0.0.1:18686` dưới các trường tự động nhận diện chữ ký hợp lệ ngay lập tức,
 *   KHÔNG BAO GIỜ PHẢI CÀI ĐẶT LẠI CONNECTOR DƯỚI TRƯỜNG!
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const SystemSetting = require('../models/zone1_system/SystemSetting');
const TimekeepingDevice = require('../models/zone2_hr/TimekeepingDevice');
const { decryptDeviceCredentials } = require('../utils/deviceCredentialCrypto');
const { buildZipBuffer } = require('../utils/miniZipBuilder');

const GRANT_TTL_MS = 20 * 60 * 1000; // 20 phút cho mỗi phiên thao tác đồng bộ lớn

let cachedBridgeCrypto = null;

/**
 * Sinh cặp khóa Ed25519 + khóa phong bì 32-byte dự phòng tất định từ JWT_SECRET khi chạy kiểm thử không có SystemSetting.
 */
function buildFallbackDeterministicCrypto() {
  const seedMaterial = process.env.CONNECTOR_SIGNING_SEED || process.env.JWT_SECRET || 'hoanang-connector-default-seed';
  const seed = crypto.createHash('sha256').update(`ed25519:${seedMaterial}`).digest();
  // PKCS#8 DER prefix chuẩn RFC 8410 cho khóa riêng Ed25519 32-byte seed
  const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  const privateKeyObj = crypto.createPrivateKey({
    key: Buffer.concat([pkcs8Prefix, seed]),
    format: 'der',
    type: 'pkcs8'
  });
  const publicKeyObj = crypto.createPublicKey(privateKeyObj);
  const envelopeSecretHex = crypto
    .createHash('sha256')
    .update(`envelope:${seedMaterial}`)
    .digest('hex');

  return {
    keyId: 'fallback-ed25519-v1',
    privateKeyPem: privateKeyObj.export({ format: 'pem', type: 'pkcs8' }),
    publicKeyPem: publicKeyObj.export({ format: 'pem', type: 'spki' }),
    envelopeSecretHex
  };
}

/**
 * Đọc hoặc tự động khởi tạo khóa ký Ed25519 toàn nền tảng lưu bền vững trong MongoDB (`SystemSetting`).
 */
async function getOrCreateConnectorBridgeCrypto() {
  if (cachedBridgeCrypto) {
    return cachedBridgeCrypto;
  }

  if (mongoose.connection.readyState !== 1) {
    return buildFallbackDeterministicCrypto();
  }

  let doc = await SystemSetting.findOne({ key: 'GLOBAL_CONFIG' });
  if (
    doc?.connectorBridgeSecurity?.privateKeyPem &&
    doc?.connectorBridgeSecurity?.publicKeyPem &&
    doc?.connectorBridgeSecurity?.envelopeSecretHex?.length === 64
  ) {
    cachedBridgeCrypto = {
      keyId: doc.connectorBridgeSecurity.keyId || 'platform-ed25519-v1',
      privateKeyPem: doc.connectorBridgeSecurity.privateKeyPem,
      publicKeyPem: doc.connectorBridgeSecurity.publicKeyPem,
      envelopeSecretHex: doc.connectorBridgeSecurity.envelopeSecretHex
    };
    return cachedBridgeCrypto;
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const generated = {
    keyId: `hn-ed25519-${Date.now().toString(36)}`,
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }),
    publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }),
    envelopeSecretHex: crypto.randomBytes(32).toString('hex')
  };

  if (!doc) {
    doc = await SystemSetting.create({
      key: 'GLOBAL_CONFIG',
      connectorBridgeSecurity: generated
    });
  } else {
    doc.connectorBridgeSecurity = generated;
    await doc.save();
  }

  cachedBridgeCrypto = generated;
  return cachedBridgeCrypto;
}

/**
 * Xác định động địa chỉ gốc công khai (`Public Origin`) hiện tại của hệ thống mà KHÔNG BAO GIỜ fix cứng tên miền:
 * Ưu tiên:
 * 1. Biến môi trường `PUBLIC_APP_URL` / `PUBLIC_BASE_URL` (nếu quản trị máy chủ chủ động khai báo).
 * 2. `clientOrigin` hợp lệ gửi từ trình duyệt đang mở (`window.location.origin`).
 * 3. `X-Forwarded-Proto` + `X-Forwarded-Host` / `Host` từ Reverse Proxy (Nginx / Cloudflare).
 *
 * @param {import('express').Request} req
 * @param {string} [clientOrigin='']
 * @returns {string}
 */
function resolveDynamicPublicBaseUrl(req, clientOrigin = '') {
  const configuredUrl = String(process.env.PUBLIC_APP_URL || process.env.PUBLIC_BASE_URL || '').trim();
  if (configuredUrl) {
    try {
      const parsed = new URL(configuredUrl);
      return parsed.origin;
    } catch {
      // Bỏ qua nếu biến môi trường nhập sai cú pháp URL
    }
  }

  if (clientOrigin && typeof clientOrigin === 'string') {
    try {
      const parsedClient = new URL(clientOrigin.trim());
      if (parsedClient.protocol === 'http:' || parsedClient.protocol === 'https:') {
        return parsedClient.origin;
      }
    } catch {
      // ignore
    }
  }

  const reqOrigin = req?.header?.('origin');
  if (reqOrigin) {
    try {
      const parsedOrigin = new URL(reqOrigin);
      return parsedOrigin.origin;
    } catch {
      // ignore
    }
  }

  const protoRaw = String(req?.header?.('x-forwarded-proto') || req?.protocol || 'http').split(',')[0].trim();
  const hostRaw = String(req?.header?.('x-forwarded-host') || req?.header?.('host') || 'localhost:5001').split(',')[0].trim();
  return `${protoRaw}://${hostRaw}`;
}

/**
 * Ký cấp `grantToken` (Ed25519) cho phiên trình duyệt đang đăng nhập thuộc đúng `tenantId` (`campus_id`).
 * Kèm danh sách `lockedDevices` để `127.0.0.1:18686` khóa cứng `deviceSerial` tương ứng từng máy của phân hiệu!
 */
async function issueConnectorGrantForTenant({
  tenantId,
  schoolCode,
  schoolName = '',
  allowedOrigin,
  isVendorSupport = false
}) {
  const cryptoBundle = await getOrCreateConnectorBridgeCrypto();
  const devices = await TimekeepingDevice.find({ tenantId })
    .select('_id deviceCode host httpPort httpsPort transportScheme serialNumber campus')
    .lean();

  const now = Date.now();
  const payload = {
    v: 2,
    keyId: cryptoBundle.keyId,
    tenantId: String(tenantId),
    schoolCode: String(schoolCode || ''),
    schoolName: String(schoolName || ''),
    allowedOrigin: String(allowedOrigin || '').trim(),
    isVendorSupport: Boolean(isVendorSupport),
    lockedDevices: devices.map((d) => ({
      deviceId: String(d._id),
      deviceCode: d.deviceCode,
      host: d.host,
      lockedSerial: d.serialNumber || ''
    })),
    iat: now,
    exp: now + GRANT_TTL_MS
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.sign(
    null,
    Buffer.from(payloadB64, 'utf8'),
    cryptoBundle.privateKeyPem
  );

  return {
    grantToken: `${payloadB64}.${signature.toString('base64url')}`,
    expiresAt: new Date(payload.exp).toISOString(),
    connectorUrl: 'http://127.0.0.1:18686',
    lockedDevicesCount: payload.lockedDevices.filter((x) => Boolean(x.lockedSerial)).length
  };
}

/**
 * Mã hóa thông tin đăng nhập ISAPI của 1 máy chấm công thành phong bì `encryptedDeviceAuth`
 * để trình duyệt chuyển tiếp an toàn xuống `127.0.0.1:18686` mà không lộ mật khẩu thô.
 */
async function buildEncryptedDeviceAuthForConnector(tenantId, deviceDoc) {
  const cryptoBundle = await getOrCreateConnectorBridgeCrypto();
  let username = deviceDoc.authUsernameHint || 'admin';
  let password = '';

  if (deviceDoc.encryptedAuth?.cipherText) {
    const creds = decryptDeviceCredentials(tenantId, deviceDoc.encryptedAuth);
    if (creds) {
      username = creds.username || username;
      password = creds.password || '';
    }
  }

  if (!password && deviceDoc.credentialKey) {
    const envUser = process.env[`${deviceDoc.credentialKey}_USERNAME`];
    const envPass = process.env[`${deviceDoc.credentialKey}_PASSWORD`];
    if (envUser && envPass) {
      username = envUser;
      password = envPass;
    }
  }

  if (!password) {
    return null;
  }

  const key = Buffer.from(cryptoBundle.envelopeSecretHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`connector:${String(tenantId)}`, 'utf8'));
  const plainBuf = Buffer.from(JSON.stringify({ username, password }), 'utf8');
  const cipherBuf = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    cipherText: cipherBuf.toString('base64url')
  };
}

/**
 * Đóng gói động bộ cài đặt 1 chạm `HoaNang-Local-LAN-Connector.zip` cho máy tính Windows tại trường.
 */
async function generateDownloadableConnectorZipBuffer() {
  const cryptoBundle = await getOrCreateConnectorBridgeCrypto();
  const candidatePaths = [
    path.resolve(__dirname, '../connector/connector-server.js'),
    path.resolve(__dirname, '../../local-lan-connector/connector-server.js'),
    path.resolve(__dirname, '../../../local-lan-connector/connector-server.js')
  ];
  const serverSourcePath = candidatePaths.find((p) => fs.existsSync(p));
  if (!serverSourcePath) {
    const missingErr = new Error('Tệp bộ kết nối nội bộ đang được cập nhật trên máy chủ.');
    missingErr.code = 'CONNECTOR_PACKAGE_UNAVAILABLE';
    missingErr.statusCode = 500;
    throw missingErr;
  }
  const connectorJsSource = fs.readFileSync(serverSourcePath, 'utf8');

  const configJson = JSON.stringify(
    {
      version: '2.2.0',
      keyId: cryptoBundle.keyId,
      publicKeyPem: cryptoBundle.publicKeyPem,
      envelopeSecretHex: cryptoBundle.envelopeSecretHex,
      note: 'Khong can sua file nay khi he thong doi Ten mien (Domain) moi.'
    },
    null,
    2
  );

  const startAndAutoInstallBat = [
    '@echo off',
    'chcp 65001 >nul',
    'title Bo Ket Noi May Cham Cong Noi Bo - Hoa Nang (v2.2.0)',
    'cd /d "%~dp0"',
    'echo ================================================================',
    'echo   BO KET NOI MAY CHAM CONG NOI BO HOA NANG (127.0.0.1:18686)',
    'echo   Phien ban: v2.2.0 - Quet Kep SADP + TCP Toan Mang Noi Bo',
    'echo ================================================================',
    'where node >nul 2>nul',
    'if %errorlevel% neq 0 (',
    '  echo [!] May tinh nay chua cai Node.js. Vui long cai Node.js LTS tai https://nodejs.org roi chay lai file nay!',
    '  pause',
    '  exit /b 1',
    ')',
    'echo [1/3] Dang dong phien ban Bo ket noi cu (neu dang chay ngam)...',
    'for /f "tokens=5" %%a in (\'netstat -aon ^| findstr "127.0.0.1:18686"\') do taskkill /F /PID %%a >nul 2>nul',
    'timeout /t 1 >nul',
    'set "STARTUP_VBS=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\HoaNangLanConnector.vbs"',
    'echo Set WshShell = CreateObject("WScript.Shell") > "%STARTUP_VBS%"',
    'echo WshShell.CurrentDirectory = "%~dp0" >> "%STARTUP_VBS%"',
    'echo WshShell.Run "node ""%~dp0connector-server.js""", 0, False >> "%STARTUP_VBS%"',
    'echo [2/3] Da cai tu dong khoi dong cung Windows!',
    'echo [3/3] Dang bat Bo ket noi v2.2.0 ngam tai cong 127.0.0.1:18686...',
    'wscript.exe "%STARTUP_VBS%"',
    'timeout /t 2 >nul',
    'echo.',
    'echo HOAN TAT! Bay gio ban hay quay lai trinh duyet Web (trang May cham cong) va bam Quet tim may trong mang nhe!',
    'pause'
  ].join('\r\n');

  const stopAndUninstallBat = [
    '@echo off',
    'chcp 65001 >nul',
    'set "STARTUP_VBS=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\HoaNangLanConnector.vbs"',
    'if exist "%STARTUP_VBS%" del /f /q "%STARTUP_VBS%"',
    'for /f "tokens=5" %%a in (\'netstat -aon ^| findstr "127.0.0.1:18686"\') do taskkill /F /PID %%a >nul 2>nul',
    'echo Da tat va go tu khoi dong Bo ket noi may cham cong tren may tinh nay.',
    'pause'
  ].join('\r\n');

  const readmeTxt = [
    'HƯỚNG DẪN CÀI ĐẶT 1 CHẠM — BỘ KẾT NỐI MÁY CHẤM CÔNG NỘI BỘ HOA NẮNG',
    '====================================================================',
    '',
    '1. Giải nén thư mục này ra ổ đĩa trên máy tính đặt tại văn phòng trường (ví dụ: D:\\HoaNangConnector).',
    '2. Nhấp đúp chuột vào tệp: "1-Bat-Ket-Noi-1-Cham.bat".',
    '   -> Phần mềm sẽ tự động chạy ngầm ở cổng nội bộ 127.0.0.1:18686 và tự bật lại mỗi khi mở máy tính Windows.',
    '3. Quay lại trang Web Quản lý Trường Mầm non Hoa Nắng -> vào mục "Máy chấm công & Cầu nối LAN":',
    '   -> Đèn trạng thái sẽ chuyển sang màu XANH ("Máy tính này đã sẵn sàng kết nối máy chấm công nội bộ").',
    '   -> Bạn có thể Quét tìm máy, Kéo dữ liệu từ máy về Web, Đẩy khuôn mặt học sinh xuống máy và Cập nhật địa chỉ tên miền mới chỉ với 1 cú nhấp chuột!',
    '',
    'Lưu ý quan trọng:',
    '- Khi Nhà cung cấp nâng cấp hoặc đổi Tên miền (Domain) trang Web trong tương lai, bạn KHÔNG CẦN cài đặt lại bộ kết nối này.'
  ].join('\r\n');

  return buildZipBuffer([
    { name: 'HoaNangConnector/connector-server.js', content: connectorJsSource },
    { name: 'HoaNangConnector/connector-config.json', content: configJson },
    { name: 'HoaNangConnector/1-Bat-Ket-Noi-1-Cham.bat', content: startAndAutoInstallBat },
    { name: 'HoaNangConnector/2-Go-Khoi-Dong-Cung-Windows.bat', content: stopAndUninstallBat },
    { name: 'HoaNangConnector/HUONG-DAN-SU-DUNG.txt', content: readmeTxt }
  ]);
}

module.exports = {
  getOrCreateConnectorBridgeCrypto,
  resolveDynamicPublicBaseUrl,
  issueConnectorGrantForTenant,
  buildEncryptedDeviceAuthForConnector,
  generateDownloadableConnectorZipBuffer
};
