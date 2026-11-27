import axios from 'axios';
import { clearAuthSession } from '../utils/storage';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? '/api' : 'http://127.0.0.1:5001/api'),
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' }
});

// Interceptor Request: tự động gắn token phù hợp (ưu tiên superadmin_token cho các API điều hành Đa Trường)
api.interceptors.request.use((config) => {
  const reqUrl = String(config.url || '');
  const isMultiSchoolApi = reqUrl.startsWith('/multi-school') && !reqUrl.includes('/multi-school/login');
  const token = isMultiSchoolApi
    ? (localStorage.getItem('superadmin_token') || localStorage.getItem('token'))
    : localStorage.getItem('token');

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  return config;
});

// Interceptor Response: giải mã lỗi Blob tải file, chuẩn hóa lỗi mạng/413/429 tiếng Việt và xử lý hết hạn phiên 401 thông minh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const reqUrl = String(error.config?.url || '');

    // 1. Nếu gọi API tải tệp (responseType: 'blob') mà bị lỗi 4xx/5xx, giải mã Blob sang JSON để hiển thị đúng thông báo tiếng Việt
    if (
      typeof Blob !== 'undefined' &&
      error.response?.data instanceof Blob &&
      (error.response.data.type?.includes('json') || error.response.data.size < 8192)
    ) {
      try {
        const text = await error.response.data.text();
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
          error.response.data = parsed;
        }
      } catch {
        // Không phải JSON hợp lệ -> giữ nguyên để xử lý mặc định bên dưới
      }
    }

    // 2. Chuẩn hóa thông báo tiếng Việt cho các trường hợp mất mạng, timeout, vượt dung lượng (413) hoặc thao tác quá nhanh (429)
    if (!error.response) {
      const timeoutMsg = error.code === 'ECONNABORTED'
        ? 'Máy chủ phản hồi quá thời gian chờ. Vui lòng kiểm tra kết nối mạng và thử lại.'
        : 'Không thể kết nối tới máy chủ. Vui lòng kiểm tra mạng Internet hoặc Wi-Fi.';
      error.message = timeoutMsg;
      error.response = {
        status: 0,
        data: { success: false, message: timeoutMsg }
      };
      return Promise.reject(error);
    }

    if (error.response.status === 413) {
      const msg413 = error.response.data?.message || 'Tệp tin hoặc dữ liệu gửi lên vượt quá dung lượng cho phép (tối đa 5 MB).';
      error.response.data = { ...(typeof error.response.data === 'object' ? error.response.data : {}), message: msg413 };
    } else if (error.response.status === 429) {
      const msg429 = error.response.data?.message || 'Bạn thao tác quá nhanh, vui lòng đợi vài giây rồi thử lại.';
      error.response.data = { ...(typeof error.response.data === 'object' ? error.response.data : {}), message: msg429 };
    }

    // 3. Xử lý hết hạn phiên 401 an toàn giữa Admin Tổng Đa Trường và Tài khoản từng Trường
    const isAuthAttemptOrPasswordCheck =
      reqUrl.includes('/auth/login') ||
      reqUrl.includes('/multi-school/login') ||
      reqUrl.includes('/auth/change-password') ||
      reqUrl.includes('/auth/me/password') ||
      reqUrl.includes('/multi-school/me/password');

    if (error.response.status === 401 && !isAuthAttemptOrPasswordCheck) {
      const currentToken = localStorage.getItem('token');
      const superToken = localStorage.getItem('superadmin_token');
      const isMultiSchoolEndpoint = reqUrl.startsWith('/multi-school');

      // Nếu Admin Tổng đang vào quản lý 1 trường mà phiên 4h của trường hết hạn -> quay về trang Đa Trường êm ái
      if (!isMultiSchoolEndpoint && superToken && currentToken && superToken !== currentToken) {
        localStorage.setItem('token', superToken);
        const superUser = localStorage.getItem('superadmin_user');
        if (superUser) localStorage.setItem('user', superUser);
        localStorage.removeItem('tenant');
        if (window.location.pathname !== '/multi-school') {
          window.location.assign('/multi-school');
        }
        return Promise.reject(error);
      }

      clearAuthSession();
      if (window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    }

    return Promise.reject(error);
  }
);

export default api;
