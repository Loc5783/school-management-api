import api from './axiosConfig';

export const getParentAccounts = (status) => api.get('/system/parents', { params: status ? { status } : {} });
export const linkParentStudents = (id, studentIds, reason = '') => api.patch(`/system/parents/${id}/students`, { studentIds, reason });
export const updateParentStatus = (id, status, reason = '') => api.patch(`/system/parents/${id}/status`, { status, reason });
export const getInternalAccounts = (params = {}) => api.get('/system/accounts', { params });
export const createInternalAccount = (data) => api.post('/system/accounts', data);
export const updateInternalAccountRole = (id, role) => api.patch(`/system/accounts/${id}/role`, { role });
export const updateInternalAccount = (id, data) => api.patch(`/system/accounts/${id}`, data);
export const deactivateInternalAccount = (id, reason = '') => api.delete(`/system/accounts/${id}`, { data: { reason } });
