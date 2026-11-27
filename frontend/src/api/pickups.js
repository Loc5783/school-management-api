import api from './axiosConfig';

export const getPickups = (params) => api.get('/pickups', { params });
export const getPickupClassrooms = () => api.get('/pickups/classrooms');
export const getClassroomPickupRoster = (classroomId, pickupDate) =>
  api.get(`/pickups/class-roster/${classroomId}`, { params: { pickupDate } });
export const directHandoverPickup = (data) => api.post('/pickups/direct-handover', data);
export const undoHandoverPickup = (id, reason = '') => api.post(`/pickups/${id}/undo-handover`, { reason });
export const createPickupRequest = (data) => api.post('/pickups', data);
export const confirmScheduledPickup = (id, data) => api.patch(`/pickups/${id}/confirm`, data);
export const cancelScheduledPickup = (id, data = {}) => api.patch(`/pickups/${id}/cancel`, data);
export const searchGuardStudents = (params) => api.get('/guard/students', { params });
export const requestGuardPickupOtp = (data) => api.post('/guard/pickup-otp', data);
export const verifyGuardPickupOtp = (challengeId, otp) => api.post(`/guard/pickup-otp/${challengeId}/verify`, { otp });
