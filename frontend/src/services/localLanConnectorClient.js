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

export const LOCAL_CONNECTOR_BASE_URL = 'http://127.0.0.1:18686';

let cachedGrant = null;

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
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
    window.clearTimeout(timer);
  }
}

/**
 * Kiểm tra xem máy tính hiện tại của Admin Phân hiệu / Kỹ thuật viên đã bật `127.0.0.1:18686` chưa.
 */
export async function probeLocalConnectorHealth() {
  try {
    const res = await fetchWithTimeout(`${LOCAL_CONNECTOR_BASE_URL}/health`, { method: 'GET' }, 1800);
    if (!res.ok) return { online: false };
    const json = await res.json();
    return {
      online: Boolean(json?.success),
      version: json?.version || '2.0.0',
      lanIps: Array.isArray(json?.lanIps) ? json.lanIps : [],
      message: json?.message || 'Bộ kết nối nội bộ đang sẵn sàng.'
    };
  } catch {
    return { online: false, lanIps: [] };
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
 */
export async function discoverLanViaLocalConnector({
  subnetPrefix = '',
  probeUsername = 'admin',
  probePassword = ''
} = {}) {
  const localData = await callLocalConnectorPost(
    '/lan/discover',
    { subnetPrefix, probeUsername, probePassword },
    35000
  );
  const enrichRes = await enrichConnectorScan({
    scannedSubnets: localData?.scannedSubnets || [],
    discoveredDevices: localData?.discoveredDevices || []
  });
  return {
    data: enrichRes.data?.data || localData,
    message: enrichRes.data?.message || 'Đã quét xong mạng nội bộ tại trường!'
  };
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
  // Đồng bộ thông tin thiết bị (model, serialNumber, dung lượng) lên Server
  const syncRes = await ingestConnectorDevicePull(deviceId, {
    deviceInfo: info,
    users: [],
    events: [],
    overwriteExistingFaces: false
  }).catch(() => null);

  return {
    deviceInfo: info,
    message:
      syncRes?.data?.message ||
      `Máy "${task.device?.name}" đang kết nối tốt trong mạng trường: hiện lưu ${info.currentStoredUsers}/${info.maxUserCapacity || 500} hồ sơ.`
  };
}

/**
 * Kéo danh sách người dùng + ảnh khuôn mặt (<200KB) + lượt điểm danh từ máy Hikvision trong LAN về Web.
 */
export async function pullDeviceUsersViaLocalConnector(deviceId, overwriteExistingFaces = true) {
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
    overwriteExistingFaces
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

