import api from './axiosConfig';

const superAdminHeaders = () => {
  const superToken = localStorage.getItem('superadmin_token') || localStorage.getItem('token');
  return superToken ? { Authorization: `Bearer ${superToken}` } : {};
};

// API dành cho Admin Tổng Hệ thống Đa Trường (Chung toàn bộ)
export const loginSuperAdmin = (data) => api.post('/multi-school/login', data);
export const getSuperAdminMe = () => api.get('/multi-school/me', { headers: superAdminHeaders() });
export const changeSuperAdminPassword = (data) => api.post('/multi-school/me/password', data, { headers: superAdminHeaders() });
export const getSuperAdminSchools = () => api.get('/multi-school/schools', { headers: superAdminHeaders() });
export const createSchoolWithAdmin = (data) => api.post('/multi-school/schools', data, { headers: superAdminHeaders() });
export const updateSchoolAndAdmin = (id, data) => api.put(`/multi-school/schools/${id}`, data, { headers: superAdminHeaders() });
export const enterSchoolWorkspace = (id) => api.post(`/multi-school/schools/${id}/enter`, {}, { headers: superAdminHeaders() });

// API quản lý Trường & Phân hiệu trong phạm vi từng trường (Từng trường)
export const getSchoolCampuses = () => api.get('/system/campuses');
export const createCampus = (data) => api.post('/system/campuses', data);
export const updateCampus = (campusCode, data) => api.put(`/system/campuses/${encodeURIComponent(campusCode)}`, data);
export const deleteCampus = (campusCode) => api.delete(`/system/campuses/${encodeURIComponent(campusCode)}`);
export const updateCurrentSchoolInfo = (data) => api.put('/system/school-info', data);
