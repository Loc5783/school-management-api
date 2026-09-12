import api from './axiosConfig';

export const getDashboardStats = () => api.get('/reports/dashboard');
export const getClassReport = (classroomId, date) => api.get(`/reports/class/${classroomId}`, { params: { date } });
export const getFinanceReport = (params) => api.get('/reports/finance', { params });
export const getSavedReports = (params) => api.get('/reports', { params });
export const getReportById = (id) => api.get(`/reports/${id}`);
export const saveReport = (data) => api.post('/reports', data);
export const publishReport = (id) => api.put(`/reports/publish/${id}`);
