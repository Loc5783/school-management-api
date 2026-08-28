import api from './axiosConfig';

// Employee
export const manualCheckIn = (note = '') => api.post('/timekeeping/check-in', { note });
export const createCorrectionRequest = (data) => api.post('/timekeeping/corrections', data);
export const getMyTimekeeping = () => api.get('/timekeeping/me');
export const kioskCheckIn = (identifier) => api.post('/timekeeping/kiosk/check-in', { identifier });

// Admin
export const getPendingCorrections = () => api.get('/timekeeping/corrections/pending');
export const approveCorrection = (id, version, reviewNote = '') => api.patch(`/timekeeping/corrections/${id}/approve`, { version, reviewNote });
export const rejectCorrection = (id, version, reason) => api.patch(`/timekeeping/corrections/${id}/reject`, { version, reason });
export const recalculateAttendance = (date) => api.post(`/timekeeping/recalculate/${date}`);
