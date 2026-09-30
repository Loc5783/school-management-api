import api from './axiosConfig';

export const listClassrooms = (includeArchived = false) => api.get('/classrooms', { params: includeArchived ? { includeArchived: 'true' } : {} });
export const createClassroom = (data) => api.post('/classrooms', data);
export const updateClassroom = (id, data) => api.put(`/classrooms/${id}`, data);
export const assignHomeroomTeacher = (id, teacherId) => api.put(`/classrooms/${id}/homeroom-teacher`, { teacherId });
export const archiveClassroom = (id) => api.delete(`/classrooms/${id}`);
