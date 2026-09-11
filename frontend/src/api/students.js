import api from './axiosConfig';

export const listStudents = (params) => api.get('/students', { params });
export const getStudent = (id) => api.get(`/students/${id}`);
export const createStudent = (data) => api.post('/students', data);
export const updateStudent = (id, data) => api.put(`/students/${id}`, data);
export const changeStudentStatus = (id, data) => api.patch(`/students/${id}/status`, data);
export const deleteStudent = (id, reason) => api.delete(`/students/${id}`, { data: { reason } });
