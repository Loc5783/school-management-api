/**
 * Tiện ích đọc dữ liệu JSON từ `localStorage` an toàn tuyệt đối và sinh mã định danh client (`Idempotency-Key`)
 * tương thích cả môi trường HTTPS, localhost lẫn mạng LAN nội bộ (`http://192.168.x.x`).
 */

export const safeParseStorage = (key, fallback = null) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw === 'undefined' || raw === 'null') return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore storage quota/privacy mode errors
    }
    return fallback;
  }
};

export const getStoredUser = () => safeParseStorage('user', {}) || {};
export const getStoredTenant = () => safeParseStorage('tenant', null);
export const getStoredSuperAdminUser = () => safeParseStorage('superadmin_user', null);

/**
 * Dọn sạch toàn bộ khóa phiên đăng nhập (bao gồm cả phiên Admin Tổng Đa Trường).
 */
export const clearAuthSession = () => {
  try {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('tenant');
    localStorage.removeItem('superadmin_token');
    localStorage.removeItem('superadmin_user');
  } catch {
    // ignore storage errors
  }
};

/**
 * Sinh chuỗi UUID/Idempotency-Key an toàn trên mọi trình duyệt & giao thức mạng:
 * - Trên HTTPS / localhost: dùng `crypto.randomUUID()` chuẩn.
 * - Trên mạng LAN nội bộ không HTTPS (`http://192.168.x.x`): `crypto.randomUUID` không tồn tại,
 *   tự động fallback sang `crypto.getRandomValues` chuẩn RFC-4122 v4 hoặc chuỗi thời gian ngẫu nhiên,
 *   tuyệt đối không bao giờ ném `TypeError: crypto.randomUUID is not a function`.
 *
 * @param {string} [prefix='']
 * @returns {string}
 */
export const generateClientId = (prefix = '') => {
  let id = '';
  try {
    if (typeof globalThis !== 'undefined' && typeof globalThis.crypto?.randomUUID === 'function') {
      id = globalThis.crypto.randomUUID();
    } else if (typeof globalThis !== 'undefined' && typeof globalThis.crypto?.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch {
    id = '';
  }
  if (!id) {
    id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 8)}`;
  }
  return prefix ? `${prefix}-${id}` : id;
};
