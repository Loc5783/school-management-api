/**
 * Tiện ích đọc dữ liệu JSON từ `localStorage` an toàn tuyệt đối,
 * tự dọn dẹp dữ liệu hỏng để không bao giờ gây lỗi trắng trang (SyntaxError trong JSON.parse).
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

