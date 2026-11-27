import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? '/api' : 'http://127.0.0.1:5000/api'),
  headers: { 'Content-Type': 'application/json' },
});

// Interceptor: tự động gắn token vào mọi request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const reqUrl = String(error.config?.url || '');
    const isAuthAttemptOrPasswordCheck =
      reqUrl.includes('/auth/login') ||
      reqUrl.includes('/multi-school/login') ||
      reqUrl.includes('/auth/change-password');

    if (error.response?.status === 401 && !isAuthAttemptOrPasswordCheck) {
      const currentToken = localStorage.getItem('token');
      const superToken = localStorage.getItem('superadmin_token');

      // Nếu Admin Tổng đang vào quản lý 1 trường mà phiên 4h của trường hết hạn -> quay về trang Đa Trường êm ái
      if (superToken && currentToken && superToken !== currentToken && window.location.pathname !== '/multi-school') {
        localStorage.setItem('token', superToken);
        const superUser = localStorage.getItem('superadmin_user');
        if (superUser) localStorage.setItem('user', superUser);
        localStorage.removeItem('tenant');
        window.location.assign('/multi-school');
        return Promise.reject(error);
      }

      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('tenant');
      localStorage.removeItem('superadmin_token');
      localStorage.removeItem('superadmin_user');
      if (window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  }
);

export default api;
