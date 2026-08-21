import api from './axiosConfig';

export const manualCheckIn = (note = '') => api.post('/timekeeping/check-in', { note });
export const createCorrectionRequest = (data) => api.post('/timekeeping/corrections', data);
export const getMyTimekeeping = () => api.get('/timekeeping/me');
