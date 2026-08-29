import api from './axiosConfig';

export const getParentAccounts = (status) => api.get('/system/parents', { params: status ? { status } : {} });
export const linkParentStudents = (id, studentIds, reason = '') => api.patch(`/system/parents/${id}/students`, { studentIds, reason });
export const updateParentStatus = (id, status, reason = '') => api.patch(`/system/parents/${id}/status`, { status, reason });
