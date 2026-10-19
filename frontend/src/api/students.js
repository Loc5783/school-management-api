import api from './axiosConfig';

export const listStudents = (params) => api.get('/students', { params });
export const getStudent = (id) => api.get(`/students/${id}`);
export const createStudent = (data) => api.post('/students', data);
export const updateStudent = (id, data) => api.put(`/students/${id}`, data);
export const changeStudentStatus = (id, data) => api.patch(`/students/${id}/status`, data);
export const deleteStudent = (id, reason) => api.delete(`/students/${id}`, { data: { reason } });
export const getDailyReports = (id) => api.get(`/students/${id}/daily-reports`);
export const saveDailyReport = (id, data) => api.put(`/students/${id}/daily-reports`, data);
export const downloadExcelTemplate = () => api.get('/students/excel/template', { responseType: 'blob' });
export const previewExcelImport = (formData) => api.post('/students/excel/preview', formData, {
  headers: { 'Content-Type': 'multipart/form-data' }
});
export const confirmExcelImport = (data, idempotencyKey) => api.post('/students/excel/confirm', data, {
  headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}
});
