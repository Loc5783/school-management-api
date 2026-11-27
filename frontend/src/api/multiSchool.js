import api from './axiosConfig';

const superAdminHeaders = () => {
  const superToken = localStorage.getItem('superadmin_token') || localStorage.getItem('token');
  return superToken ? { Authorization: `Bearer ${superToken}` } : {};
};

// API công khai nhẹ cho toàn hệ thống (System Banner, Thương hiệu & Tham số chuẩn)
export const getPublicSystemMeta = () => api.get('/multi-school/public-meta');

// API dành cho Admin Tổng Hệ thống Đa Trường (SuperAdmin)
export const loginSuperAdmin = (data) => api.post('/multi-school/login', data);
export const getSuperAdminMe = () => api.get('/multi-school/me', { headers: superAdminHeaders() });
export const changeSuperAdminPassword = (data) => api.post('/multi-school/me/password', data, { headers: superAdminHeaders() });
export const getSuperAdminSchools = () => api.get('/multi-school/schools', { headers: superAdminHeaders() });
export const getSuperAdminSchoolReport = (id) => api.get(`/multi-school/schools/${id}/report`, { headers: superAdminHeaders() });
export const createSchoolWithAdmin = (data) => api.post('/multi-school/schools', data, { headers: superAdminHeaders() });
export const updateSchoolAndAdmin = (id, data) => api.put(`/multi-school/schools/${id}`, data, { headers: superAdminHeaders() });
export const enterSchoolWorkspace = (id) => api.post(`/multi-school/schools/${id}/enter`, {}, { headers: superAdminHeaders() });
export const getSuperAdminSystemSettings = () => api.get('/multi-school/settings', { headers: superAdminHeaders() });
export const updateSuperAdminSystemSettings = (data) => api.put('/multi-school/settings', data, { headers: superAdminHeaders() });
export const getSuperAdminAuditLogs = (params = {}) => api.get('/multi-school/audit-logs', { params, headers: superAdminHeaders() });

// API quản lý Phân hiệu / Cơ sở trong phạm vi từng trường (Admin trường)
export const getSchoolCampuses = () => api.get('/system/campuses');
export const createCampus = (data) => api.post('/system/campuses', data);
export const updateCampus = (campusCode, data) => api.put(`/system/campuses/${encodeURIComponent(campusCode)}`, data);
export const deleteCampus = (campusCode) => api.delete(`/system/campuses/${encodeURIComponent(campusCode)}`);
