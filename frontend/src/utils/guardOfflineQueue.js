import api from '../api/axiosConfig.js';

export class StorageError extends Error {
  constructor(message, code, cause) {
    super(message, { cause });
    this.name = 'StorageError';
    this.code = code;
  }
}

export const StorageErrorCode = {
  CORRUPTED_JSON: 'STORAGE_CORRUPTED_JSON',
  INVALID_SCHEMA: 'STORAGE_INVALID_SCHEMA',
  DUPLICATE_ID: 'STORAGE_DUPLICATE_ID',
  ACCESS_DENIED: 'STORAGE_ACCESS_DENIED',
  QUOTA_EXCEEDED: 'STORAGE_QUOTA_EXCEEDED',
  QUEUE_LOCK_UNSUPPORTED: 'QUEUE_LOCK_UNSUPPORTED'
};

const endpoints = {
  gate: ['/guard/gate-events', 'post'],
  visitor: ['/guard/visitors', 'post'],
  incident: ['/guard/incidents', 'post'],
  delivery: ['/guard/deliveries', 'post']
};

export const getCurrentUserSnapshot = () => {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    const user = JSON.parse(raw);
    const id = user?._id || user?.id || user?.username;
    if (!id) return null;
    return { id: String(id), username: user.username || '', role: user.role || '' };
  } catch {
    return null;
  }
};

export const getStorageKeyForUser = (userSnapshot) => {
  const id = userSnapshot?.id || userSnapshot?._id || userSnapshot?.username || 'anonymous';
  return `school_guard_offline_queue_v1_${id}`;
};

export const getOfflineQueueStorageKey = () => {
  return getStorageKeyForUser(getCurrentUserSnapshot());
};

// Check if modern browser Web Locks API is available
export const isWebLocksSupported = () => {
  return typeof navigator !== 'undefined' && Boolean(navigator.locks?.request);
};

let isLocalSyncing = false;

/**
 * Execute an action with cross-tab queue mutation lock via Web Locks API.
 * In accordance with Fail-Closed principles, if Web Locks API is unavailable,
 * mutations are strictly halted to protect multi-tab queue integrity.
 */
export const withQueueLock = async (targetKey, action) => {
  if (!isWebLocksSupported()) {
    throw new StorageError(
      'Trình duyệt không hỗ trợ Web Locks API để đồng bộ hàng đợi an toàn giữa nhiều tab. Thao tác ghi ngoại tuyến bị dừng để bảo vệ tính toàn vẹn của dữ liệu.',
      StorageErrorCode.QUEUE_LOCK_UNSUPPORTED
    );
  }
  return navigator.locks.request(`guard_queue_mutex_${targetKey}`, async () => {
    return action();
  });
};

/**
 * Validates the structure and contracts of an individual queue item:
 * - id: non-empty string, length <= 100
 * - operation: valid registered endpoint
 * - payload: valid object
 * - payload.clientEventId: non-empty string matching item.id exactly
 */
export const isValidQueueItem = (item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  if (typeof item.id !== 'string' || !item.id.trim() || item.id.length > 100) return false;
  if (!endpoints[item.operation]) return false;
  if (!item.payload || typeof item.payload !== 'object' || Array.isArray(item.payload)) return false;
  if (typeof item.payload.clientEventId !== 'string' || !item.payload.clientEventId.trim()) return false;
  if (item.id !== item.payload.clientEventId) return false;
  return true;
};

/**
 * Validates the entire queue array before any operation:
 * - Ensures array type
 * - Enforces uniqueness of item.id across all items
 * - Validates schema and ID contract (item.id === payload.clientEventId)
 */
export const validateQueue = (queue) => {
  if (!Array.isArray(queue)) {
    throw new StorageError(
      'Dữ liệu hàng đợi không đúng cấu trúc (không phải mảng). Thao tác bị dừng để bảo vệ dữ liệu cũ.',
      StorageErrorCode.INVALID_SCHEMA
    );
  }

  const seenIds = new Set();
  for (let i = 0; i < queue.length; i += 1) {
    const item = queue[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new StorageError(
        `Phần tử thứ ${i + 1} trong hàng đợi không đúng cấu trúc (không phải đối tượng). Thao tác bị dừng để bảo vệ dữ liệu cũ.`,
        StorageErrorCode.INVALID_SCHEMA
      );
    }

    if (typeof item.id !== 'string' || !item.id.trim() || item.id.length > 100) {
      throw new StorageError(
        `Phần tử thứ ${i + 1} có ID không hợp lệ hoặc vượt quá 100 ký tự. Thao tác bị dừng để bảo vệ dữ liệu cũ.`,
        StorageErrorCode.INVALID_SCHEMA
      );
    }

    if (seenIds.has(item.id)) {
      throw new StorageError(
        `Hàng đợi chứa ID trùng lặp (${item.id}) tại vị trí ${i + 1}. Thao tác bị dừng để bảo vệ dữ liệu cũ.`,
        StorageErrorCode.DUPLICATE_ID
      );
    }
    seenIds.add(item.id);

    if (!endpoints[item.operation]) {
      throw new StorageError(
        `Phần tử thứ ${i + 1} (${item.id}) có loại thao tác không hợp lệ: ${item.operation}. Thao tác bị dừng để bảo vệ dữ liệu cũ.`,
        StorageErrorCode.INVALID_SCHEMA
      );
    }

    if (!item.payload || typeof item.payload !== 'object' || Array.isArray(item.payload)) {
      throw new StorageError(
        `Phần tử thứ ${i + 1} (${item.id}) thiếu payload hợp lệ. Thao tác bị dừng để bảo vệ dữ liệu cũ.`,
        StorageErrorCode.INVALID_SCHEMA
      );
    }

    if (typeof item.payload.clientEventId !== 'string' || !item.payload.clientEventId.trim()) {
      throw new StorageError(
        `Phần tử thứ ${i + 1} (${item.id}) thiếu clientEventId trong payload. Thao tác bị dừng để bảo vệ dữ liệu cũ.`,
        StorageErrorCode.INVALID_SCHEMA
      );
    }

    if (item.id !== item.payload.clientEventId) {
      throw new StorageError(
        `Phần tử thứ ${i + 1} có item.id (${item.id}) mâu thuẫn với payload.clientEventId (${item.payload.clientEventId}). Thao tác bị dừng để bảo vệ dữ liệu cũ.`,
        StorageErrorCode.INVALID_SCHEMA
      );
    }
  }

  return queue;
};

/**
 * Đọc hàng đợi từ storage với phân loại lỗi nghiêm ngặt:
 * - Key không tồn tại: trả về [] hợp lệ
 * - JSON hỏng: ném StorageError (CORRUPTED_JSON), KHÔNG coi là rỗng
 * - Cấu trúc sai: ném StorageError (INVALID_SCHEMA), KHÔNG coi là rỗng
 * - ID trùng lặp: ném StorageError (DUPLICATE_ID), KHÔNG coi là rỗng
 * - Bị chặn quyền đọc: ném StorageError (ACCESS_DENIED)
 */
export const readGuardQueue = (targetKey = getOfflineQueueStorageKey()) => {
  let raw;
  try {
    raw = localStorage.getItem(targetKey);
  } catch (error) {
    throw new StorageError('Không có quyền truy cập bộ nhớ trình duyệt', StorageErrorCode.ACCESS_DENIED, error);
  }

  // Key không tồn tại hoặc rỗng -> Hàng đợi rỗng hợp lệ
  if (raw === null || raw === undefined || raw.trim() === '') {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new StorageError('Dữ liệu hàng đợi bị hỏng (JSON không hợp lệ). Thao tác bị dừng để bảo vệ dữ liệu cũ.', StorageErrorCode.CORRUPTED_JSON, error);
  }

  return validateQueue(parsed);
};

/**
 * Đọc hàng đợi an toàn cho UI badges/components để không làm sập giao diện khi storage lỗi
 */
export const safeReadGuardQueue = (targetKey = getOfflineQueueStorageKey()) => {
  let raw;
  try {
    raw = localStorage.getItem(targetKey);
  } catch (error) {
    return { success: false, queue: [], error: new StorageError('Không có quyền truy cập bộ nhớ', StorageErrorCode.ACCESS_DENIED, error), hasCorruptedData: true };
  }

  if (raw === null || raw === undefined || raw.trim() === '') {
    return { success: true, queue: [], error: null, hasCorruptedData: false };
  }

  try {
    const queue = readGuardQueue(targetKey);
    return { success: true, queue, error: null, hasCorruptedData: false };
  } catch (error) {
    return { success: false, queue: [], error, hasCorruptedData: true };
  }
};

const writeStorageQueue = (targetKey, queue) => {
  try {
    const serialized = JSON.stringify(queue);
    localStorage.setItem(targetKey, serialized);
  } catch (error) {
    if (error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014) {
      throw new StorageError('Bộ nhớ trình duyệt đã đầy (QuotaExceededError)', StorageErrorCode.QUOTA_EXCEEDED, error);
    }
    throw new StorageError(`Không thể lưu trữ hàng đợi: ${error.message || 'Lỗi bộ nhớ'}`, StorageErrorCode.ACCESS_DENIED, error);
  }
};

/**
 * Xóa chính xác duy nhất một item theo index, không dùng filter hàng loạt
 * để bảo đảm an toàn dữ liệu ngay cả khi có xung đột ngoài ý muốn.
 */
const removeItemFromStorage = (targetKey, itemId) => {
  const current = readGuardQueue(targetKey);
  const index = current.findIndex((item) => item.id === itemId);
  if (index === -1) {
    return current;
  }
  const updated = [...current.slice(0, index), ...current.slice(index + 1)];
  writeStorageQueue(targetKey, updated);
  return updated;
};

const updateItemInStorage = (targetKey, itemId, patch) => {
  const current = readGuardQueue(targetKey);
  const index = current.findIndex((item) => item.id === itemId);
  if (index === -1) {
    return current;
  }
  const updated = [...current];
  updated[index] = { ...updated[index], ...patch };
  writeStorageQueue(targetKey, updated);
  return updated;
};

/**
 * Thêm thao tác vào hàng đợi ngoại tuyến.
 * Bắt buộc Web Locks API (Fail-Closed).
 * Bảo toàn clientEventId và occurredAt từ thao tác nghiệp vụ ban đầu.
 */
export const queueGuardOperation = async (operation, payload) => {
  if (!endpoints[operation]) throw new StorageError('Thao tác ngoại tuyến không hợp lệ', StorageErrorCode.INVALID_SCHEMA);

  const userSnapshot = getCurrentUserSnapshot();
  const targetKey = getStorageKeyForUser(userSnapshot);

  // Preserve stable clientEventId and occurredAt from initial logical operation if available
  const clientEventId = payload?.clientEventId || (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const occurredAt = payload?.occurredAt || new Date().toISOString();

  const item = {
    id: clientEventId,
    operation,
    payload: { ...payload, clientEventId, occurredAt },
    queuedAt: new Date().toISOString()
  };

  return withQueueLock(targetKey, () => {
    // Đọc hàng đợi hiện hành. Nếu storage bị hỏng hoặc có ID trùng, readGuardQueue sẽ ném StorageError
    // và không bao giờ ghi đè hàng đợi cũ!
    const current = readGuardQueue(targetKey);
    const queue = [...current, item];
    validateQueue(queue);
    writeStorageQueue(targetKey, queue);
    return queue;
  });
};

/**
 * Vòng lặp đồng bộ hàng đợi:
 * - Chốt user và storageKey tại lúc bắt đầu
 * - Dừng ngay nếu user bị đổi hoặc logout
 * - Dùng AbortController 30s timeout cho mỗi request
 * - Chỉ xóa đúng ID khi API thành công
 * - Không nuốt lỗi storage nếu xóa thất bại
 */
const runSyncLoop = async (pinnedUser, pinnedKey, pinnedToken) => {
  let synced = 0;
  const attemptedIds = new Set();
  const MAX_ITERATIONS = 500;
  let storageWarning = null;

  for (let iter = 0; iter < MAX_ITERATIONS; iter += 1) {
    // 1. Kiểm tra tài khoản không bị đổi hoặc logout
    const liveUser = getCurrentUserSnapshot();
    const liveToken = localStorage.getItem('token');
    if (!liveUser || liveUser.id !== pinnedUser.id || liveToken !== pinnedToken) {
      break;
    }

    // 2. Đọc hàng đợi hiện hành dưới queue lock
    let currentQueue;
    try {
      currentQueue = readGuardQueue(pinnedKey);
    } catch (readErr) {
      storageWarning = readErr.message;
      break;
    }

    const item = currentQueue.find((it) => !attemptedIds.has(it.id) && !it.revoked);
    if (!item) {
      break;
    }

    attemptedIds.add(item.id);

    if (!endpoints[item.operation]) {
      try {
        await withQueueLock(pinnedKey, () => {
          updateItemInStorage(pinnedKey, item.id, { lastError: 'Loại thao tác không còn được hỗ trợ' });
        });
      } catch (err) {
        storageWarning = err.message;
        break;
      }
      continue;
    }

    // 3. Thực hiện gửi với AbortController (timeout 30s)
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutTimer = controller ? setTimeout(() => controller.abort(), 30000) : null;

    try {
      const [url, method] = endpoints[item.operation];
      const requestConfig = controller ? { signal: controller.signal } : {};
      await api[method](url, item.payload, requestConfig);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      synced += 1;

      // 4. Xóa item thành công khỏi storage
      try {
        await withQueueLock(pinnedKey, () => {
          removeItemFromStorage(pinnedKey, item.id);
        });
      } catch (storageErr) {
        storageWarning = storageErr.message || 'Đã gửi thành công lên máy chủ nhưng chưa cập nhật được bộ nhớ cục bộ. Thao tác được giữ nguyên để retry an toàn qua idempotency.';
        break;
      }
    } catch (error) {
      if (timeoutTimer) clearTimeout(timeoutTimer);

      const isTimeout = error.name === 'AbortError' || error.code === 'ECONNABORTED';
      if (!error.response || isTimeout) {
        const lastError = isTimeout ? 'Hết thời gian chờ phản hồi (timeout 30s)' : 'Mất kết nối mạng';
        try {
          await withQueueLock(pinnedKey, () => {
            updateItemInStorage(pinnedKey, item.id, { lastError });
          });
        } catch {
          // ignore
        }
        break;
      }

      // Lỗi phản hồi từ server (403 bị thu hồi quyền hoặc 400/409/422):
      const isForbidden = error.response.status === 403;
      const lastError = error.response.data?.message || (isForbidden ? 'Quyền thực hiện đã bị thu hồi' : 'Chưa thể đồng bộ');
      try {
        await withQueueLock(pinnedKey, () => {
          updateItemInStorage(pinnedKey, item.id, {
            lastError,
            revoked: isForbidden,
            statusCode: error.response.status
          });
        });
      } catch (err) {
        storageWarning = err.message;
        break;
      }
    }
  }

  const finalState = safeReadGuardQueue(pinnedKey);
  return {
    synced,
    remaining: finalState.queue,
    storageError: finalState.error?.message || storageWarning || null
  };
};

export const syncGuardQueue = async () => {
  // 1. Ngăn nhiều lượt sync chạy chồng nhau trong cùng một tab
  if (isLocalSyncing) {
    const userSnapshot = getCurrentUserSnapshot();
    const targetKey = getStorageKeyForUser(userSnapshot);
    return { synced: 0, remaining: safeReadGuardQueue(targetKey).queue, inProgress: true };
  }

  // 2. Chốt tài khoản và token tại thời điểm bắt đầu
  const pinnedUser = getCurrentUserSnapshot();
  const pinnedToken = localStorage.getItem('token');
  if (!pinnedUser || !pinnedToken) {
    return { synced: 0, remaining: [], error: 'Chưa đăng nhập hoặc phiên làm việc đã kết thúc.' };
  }
  const pinnedKey = getStorageKeyForUser(pinnedUser);

  // 3. Kiểm tra tính toàn vẹn của storage trước khi bắt đầu
  const initialInspect = safeReadGuardQueue(pinnedKey);
  if (!initialInspect.success) {
    return {
      synced: 0,
      remaining: [],
      error: initialInspect.error.message,
      corrupted: true
    };
  }

  if (initialInspect.queue.length === 0) {
    return { synced: 0, remaining: [] };
  }

  // 4. Áp dụng Web Locks API: Fail-closed nếu trình duyệt không hỗ trợ Web Locks API
  if (!isWebLocksSupported()) {
    return {
      synced: 0,
      remaining: initialInspect.queue,
      unsupported: true,
      error: 'Trình duyệt không hỗ trợ Web Locks API để đồng bộ hàng đợi an toàn giữa nhiều tab.'
    };
  }

  isLocalSyncing = true;
  try {
    return await navigator.locks.request(
      `guard_sync_mutex_${pinnedKey}`,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          const current = safeReadGuardQueue(pinnedKey);
          return { synced: 0, remaining: current.queue, inProgress: true };
        }
        return await runSyncLoop(pinnedUser, pinnedKey, pinnedToken);
      }
    );
  } finally {
    isLocalSyncing = false;
  }
};
