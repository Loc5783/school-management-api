/**
 * @fileoverview Trình điều phối giao tiếp giữa Trình duyệt (trên Cloud Domain bất kỳ) và
 * `Bộ kết nối máy chấm công nội bộ (http://127.0.0.1:18686)` chạy ngay trên máy tính tại Phân hiệu.
 *
 * Đặc điểm kiến trúc:
 * - Tự động truyền `window.location.origin` lên Server để nhận khóa chữ ký `Ed25519` (`X-Connector-Grant`).
 *   Khi đổi tên miền trong tương lai, không bao giờ phải sửa code hay cài lại Connector dưới trường.
 * - Mọi thao tác Quét LAN, Kéo khuôn mặt & lượt quẹt về Web, Đẩy khuôn mặt từ Web xuống máy, Giải phóng bộ nhớ,
 *   Mở cửa từ xa và Cập nhật địa chỉ Webhook mới đều đi qua `127.0.0.1:18686` với khóa cứng `deviceSerial` gắn chặt `campus_id`.
 */

import {
  issueConnectorGrant,
  enrichConnectorScan,
  prepareConnectorDeviceAction,
  ingestConnectorDevicePull,
  completeConnectorDevicePush,
  configureTimekeepingDeviceWebhook
} from '../api/timekeeping';
import { beginTrackedActionNetworkCall } from '../utils/actionProgressGuard';

export const LOCAL_CONNECTOR_BASE_URL = 'http://127.0.0.1:18686';
export const RECOMMENDED_CONNECTOR_VERSION = '2.2.0';

function isSemverOlderThan(currentVer, targetVer) {
  const cur = String(currentVer || '0.0.0').split('.').map((n) => Number(n) || 0);
  const tgt = String(targetVer || '0.0.0').split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i += 1) {
    if ((cur[i] || 0) < (tgt[i] || 0)) return true;
    if ((cur[i] || 0) > (tgt[i] || 0)) return false;
  }
  return false;
}

let cachedGrant = null;

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const finishProgress = beginTrackedActionNetworkCall({
    url,
    method: options.method || 'GET'
  });
  try {
    const res = await window.fetch(url, {
      ...options,
      signal: controller.signal
    });
    return res;
  } catch (err) {
    const wrapped = new Error(err?.message || 'Connector unreachable');
    wrapped.code = 'CONNECTOR_NOT_RUNNING';
    wrapped.isLocalConnectorError = true;
    throw wrapped;
  } finally {
    finishProgress();
    window.clearTimeout(timer);
  }
}

/**
 * Kiểm tra xem máy tính hiện tại của Admin Phân hiệu / Kỹ thuật viên đã bật `127.0.0.1:18686` chưa.
 */
export async function probeLocalConnectorHealth() {
  try {
    const res = await fetchWithTimeout(`${LOCAL_CONNECTOR_BASE_URL}/health`, { method: 'GET' }, 1800);
    if (!res.ok) return { online: false, version: '', needsUpdate: false, lanIps: [] };
    const json = await res.json();
    const version = json?.version || '2.0.0';
    return {
      online: Boolean(json?.success),
      version,
      needsUpdate: Boolean(json?.success) && isSemverOlderThan(version, RECOMMENDED_CONNECTOR_VERSION),
      lanIps: Array.isArray(json?.lanIps) ? json.lanIps : [],
      message: json?.message || 'Bộ kết nối nội bộ đang sẵn sàng.'
    };
  } catch {
    return { online: false, version: '', needsUpdate: false, lanIps: [] };
  }
}

/**
 * Lấy `grantToken` đã ký Ed25519 từ Server theo đúng `window.location.origin` động hiện tại.
 */
export async function ensureValidConnectorGrant(forceRefresh = false) {
  const currentOrigin = window.location.origin;
  if (
    !forceRefresh &&
    cachedGrant &&
    cachedGrant.origin === currentOrigin &&
    cachedGrant.expiresAtMs - Date.now() > 60 * 1000
  ) {
    return cachedGrant;
  }

  const res = await issueConnectorGrant(currentOrigin);
  const data = res.data?.data || {};
  cachedGrant = {
    grantToken: data.grantToken,
    origin: currentOrigin,
    webhookUrl: data.webhookUrl || '',
    expiresAtMs: data.expiresAt ? new Date(data.expiresAt).getTime() : Date.now() + 10 * 60 * 1000
  };
  return cachedGrant;
}

async function callLocalConnectorPost(endpointPath, bodyPayload = {}, timeoutMs = 45000) {
  let grant = await ensureValidConnectorGrant(false);
  let res = await fetchWithTimeout(
    `${LOCAL_CONNECTOR_BASE_URL}${endpointPath}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Connector-Grant': grant.grantToken
      },
      body: JSON.stringify(bodyPayload)
    },
    timeoutMs
  );

  // Nếu vừa thêm máy mới hoặc khóa phiên vừa hết hạn -> xin lại khóa mới 1 lần tự động
  if (res.status === 401) {
    grant = await ensureValidConnectorGrant(true);
    res = await fetchWithTimeout(
      `${LOCAL_CONNECTOR_BASE_URL}${endpointPath}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Connector-Grant': grant.grantToken
        },
        body: JSON.stringify(bodyPayload)
      },
      timeoutMs
    );
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const err = new Error(
      json.message || 'Chưa thực hiện được thao tác với máy chấm công qua Bộ kết nối nội bộ.'
    );
    err.code = json.code || 'CONNECTOR_ERROR';
    err.statusCode = res.status;
    throw err;
  }
  return json.data;
}

/**
 * Quét tìm máy chấm công Hikvision ngay trên mạng LAN của máy tính tại Phân hiệu qua `127.0.0.1:18686`.
 * - Quét hoàn toàn KHÔNG cần nhập mật khẩu trước.
 * - Tương thích ngược thông minh: Nếu máy tính đang chạy bản Connector cũ `2.0.0` (chưa cập nhật lên `2.1.0`),
 *   tự động chia dải mạng thành từng cụm nhỏ 10 địa chỉ để không làm nghẽn kết nối TCP trên Windows!
 */
export async function discoverLanViaLocalConnector({
  subnetPrefix = '',
  probeUsername = 'admin',
  probePassword = '',
  onProgress = null
} = {}) {
  if (typeof onProgress === 'function') {
    onProgress(8, 'Đang kiểm tra kết nối cầu nối mạng nội bộ trên máy tính...');
  }
  const health = await probeLocalConnectorHealth();
  const cleanInput = String(subnetPrefix || '').trim();
  const isLegacyV20 = health.online && String(health.version || '2.0.0') === '2.0.0';

  let mergedSubnets = [];
  let mergedDevices = [];

  const isSingleIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(cleanInput);
  const isExplicitRange = /-/.test(cleanInput);

  if (isLegacyV20 && !isSingleIp && !isExplicitRange) {
    // Chia nhỏ thành từng chặng 10 IP cho bản Connector 2.0.0 đang chạy nền để bắt 100% thiết bị Hikvision trên Windows
    const basePrefixes = [];
    const cleanedPrefix = cleanInput.replace(/\.\d+\/\d+$/, '').replace(/\.\*$/, '').replace(/\.$/, '');
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(cleanedPrefix)) {
      basePrefixes.push(cleanedPrefix);
    } else {
      for (const ip of health.lanIps || []) {
        if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) {
          const p = ip.split('.');
          const pref = `${p[0]}.${p[1]}.${p[2]}`;
          if (!basePrefixes.includes(pref)) basePrefixes.push(pref);
        }
      }
      if (basePrefixes.length === 0) basePrefixes.push('192.168.1');
    }

    const seenHosts = new Set();
    for (const pref of basePrefixes) {
      mergedSubnets.push(`${pref}.1 - ${pref}.254`);
      const windows = [];
      for (let start = 1; start <= 254; start += 10) {
        const end = Math.min(254, start + 9);
        windows.push(`${pref}.${start}-${end}`);
      }
      for (let w = 0; w < windows.length; w += 2) {
        const pair = windows.slice(w, w + 2);
        if (typeof onProgress === 'function') {
          const pct = Math.min(92, Math.round(12 + ((w + 2) / windows.length) * 78));
          onProgress(
            pct,
            `Đang rà quét dải mạng ${pair[0]}${mergedDevices.length > 0 ? ` · Đã phát hiện ${mergedDevices.length} máy` : ''}...`
          );
        }
        const results = await Promise.all(
          pair.map((rangeStr) =>
            callLocalConnectorPost(
              '/lan/discover',
              { subnetPrefix: rangeStr, probeUsername, probePassword },
              12000
            ).catch(() => null)
          )
        );
        for (const r of results) {
          for (const d of r?.discoveredDevices || []) {
            const key = `${d.host}:${d.port}`;
            if (!seenHosts.has(key)) {
              seenHosts.add(key);
              mergedDevices.push(d);
            }
          }
        }
      }
    }
  } else {
    if (typeof onProgress === 'function') {
      const targetHint = cleanInput || (health.lanIps?.[0] ? `${health.lanIps[0].split('.').slice(0, 3).join('.')}.1 - 254` : 'mạng nội bộ');
      onProgress(28, `Đang dò tìm máy chấm công trực tuyến trên dải ${targetHint}...`);
    }
    const localData = await callLocalConnectorPost(
      '/lan/discover',
      { subnetPrefix: cleanInput, probeUsername, probePassword },
      45000
    );
    mergedSubnets = localData?.scannedSubnets || [];
    mergedDevices = localData?.discoveredDevices || [];
  }

  if (typeof onProgress === 'function') {
    onProgress(95, 'Đang đối chiếu trạng thái khóa bảo mật theo phân hiệu...');
  }
  const enrichRes = await enrichConnectorScan({
    scannedSubnets: mergedSubnets,
    discoveredDevices: mergedDevices
  });
  if (typeof onProgress === 'function') {
    onProgress(100, 'Hoàn tất quét mạng nội bộ!');
  }
  return {
    data: enrichRes.data?.data || { scannedSubnets: mergedSubnets, discoveredDevices: mergedDevices },
    message: enrichRes.data?.message || 'Đã quét xong mạng nội bộ tại trường!'
  };
}

/**
 * Xác thực mật khẩu quản trị và đọc trực tiếp Model, Serial phần cứng, Dung lượng bộ nhớ từ máy vừa tìm thấy trong LAN
 * (gọi ở Bước 2 sau khi người dùng chọn máy và nhập mật khẩu).
 */
export async function verifyDiscoveredDeviceCredentialsViaConnector({
  host,
  port = 80,
  transportScheme = 'http',
  username = 'admin',
  password = ''
}) {
  return callLocalConnectorPost(
    '/device/inspect',
    {
      device: {
        host,
        port,
        transportScheme,
        username: String(username || 'admin').trim() || 'admin',
        password: String(password || '')
      }
    },
    12000
  );
}

/**
 * Kiểm tra trạng thái và dung lượng bộ nhớ máy chấm công qua `127.0.0.1:18686` (có kiểm tra khóa `deviceSerial`).
 */
export async function checkCapacityViaLocalConnector(deviceId) {
  const prepRes = await prepareConnectorDeviceAction(deviceId, {
    action: 'INSPECT',
    clientOrigin: window.location.origin
  });
  const task = prepRes.data?.data;
  const info = await callLocalConnectorPost('/device/inspect', task, 15000);
  // Đồng bộ thông tin thiết bị (model, serialNumber, dung lượng) lên Server mà KHÔNG xóa bản chụp hồ sơ trên máy
  const syncRes = await ingestConnectorDevicePull(deviceId, {
    deviceInfo: info,
    users: [],
    events: [],
    overwriteExistingFaces: false,
    inspectOnly: true
  }).catch(() => null);

  return {
    deviceInfo: info,
    message:
      syncRes?.data?.message ||
      `Máy "${task.device?.name}" đang kết nối tốt trong mạng trường: bộ nhớ hiện lưu ${info.currentStoredUsers}/${info.maxUserCapacity || 500} hồ sơ.`
  };
}

/**
 * Kéo danh sách người dùng + ảnh khuôn mặt (<200KB) + lượt điểm danh từ máy Hikvision trong LAN về Web.
 */
export async function pullDeviceUsersViaLocalConnector(
  deviceId,
  overwriteExistingFaces = true,
  syncNamesFromDevice = true
) {
  const prepRes = await prepareConnectorDeviceAction(deviceId, {
    action: 'PULL',
    clientOrigin: window.location.origin
  });
  const task = prepRes.data?.data;
  const pulled = await callLocalConnectorPost('/device/pull', task, 90000);
  const ingestRes = await ingestConnectorDevicePull(deviceId, {
    deviceInfo: pulled.deviceInfo,
    users: pulled.users || [],
    events: pulled.events || [],
    overwriteExistingFaces,
    syncNamesFromDevice
  });
  return ingestRes.data;
}

/**
 * Đẩy danh sách Nhân sự / Học sinh + Ảnh khuôn mặt (<200KB) từ Web xuống đúng máy Hikvision đã khóa `deviceSerial` trong LAN.
 */
export async function pushRosterViaLocalConnector(
  deviceId,
  { fastDelta = true, forceFullSync = false, subjectType = null, subjectId = null } = {}
) {
  const prepRes = await prepareConnectorDeviceAction(deviceId, {
    action: subjectType && subjectId ? 'PUSH_SINGLE' : 'PUSH',
    fastDelta,
    forceFullSync,
    subjectType,
    subjectId,
    clientOrigin: window.location.origin
  });
  const task = prepRes.data?.data;
  const pushed = await callLocalConnectorPost(
    '/device/push',
    {
      device: task.device,
      expectedSerial: task.expectedSerial,
      encryptedDeviceAuth: task.encryptedDeviceAuth,
      targets: task.targets || [],
      fastDelta: task.fastDelta
    },
    120000
  );
  const completeRes = await completeConnectorDevicePush(deviceId, pushed);
  return completeRes.data;
}

/**
 * 1 chạm cập nhật địa chỉ HTTP Listening Webhook theo Tên miền hiện tại (`window.location.origin`) xuống máy Hikvision!
 */
export async function updateWebhookDomainViaLocalConnector(deviceId) {
  const prepRes = await prepareConnectorDeviceAction(deviceId, {
    action: 'WEBHOOK',
    clientOrigin: window.location.origin
  });
  const task = prepRes.data?.data;
  const connectorVerifiedResult = await callLocalConnectorPost(
    '/device/configure-webhook',
    {
      device: task.device,
      expectedSerial: task.expectedSerial,
      encryptedDeviceAuth: task.encryptedDeviceAuth,
      webhookUrl: task.webhookUrl
    },
    20000
  );
  const saveRes = await configureTimekeepingDeviceWebhook(deviceId, {
    clientOrigin: window.location.origin,
    connectorVerifiedResult
  });
  return saveRes.data;
}

/**
 * Giải phóng bộ nhớ người đã nghỉ việc / thôi học qua `127.0.0.1:18686`.
 */
export async function pruneInactiveViaLocalConnector(deviceId) {
  const prepRes = await prepareConnectorDeviceAction(deviceId, {
    action: 'PRUNE',
    clientOrigin: window.location.origin
  });
  const task = prepRes.data?.data;
  const pruned = await callLocalConnectorPost(
    '/device/prune-users',
    {
      device: task.device,
      expectedSerial: task.expectedSerial,
      encryptedDeviceAuth: task.encryptedDeviceAuth,
      personCodes: task.personCodes || []
    },
    35000
  );
  return {
    removedCount: pruned.removedCount || 0,
    message:
      pruned.removedCount > 0
        ? `Đã dọn dẹp ${pruned.removedCount} hồ sơ nghỉ việc/thôi học khỏi bộ nhớ máy "${task.device?.name}"!`
        : `Bộ nhớ máy "${task.device?.name}" đã gọn sạch, không có hồ sơ nghỉ nào cần xóa.`
  };
}

/**
 * Mở khóa cửa từ xa qua `127.0.0.1:18686`.
 */
export async function unlockDoorViaLocalConnector(deviceId, doorNo = 1) {
  const prepRes = await prepareConnectorDeviceAction(deviceId, {
    action: 'UNLOCK_DOOR',
    clientOrigin: window.location.origin
  });
  const task = prepRes.data?.data;
  await callLocalConnectorPost(
    '/device/unlock-door',
    {
      device: task.device,
      expectedSerial: task.expectedSerial,
      encryptedDeviceAuth: task.encryptedDeviceAuth,
      doorNo
    },
    120000
  );
  return {
    message: `Đã mở chốt cửa số ${doorNo} tại "${task.device?.name}" thành công!`
  };
}

