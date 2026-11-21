import api from './axiosConfig';

// Employee
export const manualCheckIn = (note = '') => api.post('/timekeeping/check-in', { note });
export const createCorrectionRequest = (data) => api.post('/timekeeping/corrections', data);
export const getMyTimekeeping = () => api.get('/timekeeping/me');
export const getDailyTimekeeping = (date) => api.get('/timekeeping/daily', { params: { date } });
export const kioskCheckIn = (identifier, action = 'check-in') => api.post('/timekeeping/kiosk/check-in', { identifier, action });

// Admin
export const getPendingCorrections = () => api.get('/timekeeping/corrections/pending');
export const approveCorrection = (id, version, reviewNote = '') => api.patch(`/timekeeping/corrections/${id}/approve`, { version, reviewNote });
export const rejectCorrection = (id, version, reason) => api.patch(`/timekeeping/corrections/${id}/reject`, { version, reason });
export const recalculateAttendance = (date) => api.post(`/timekeeping/recalculate/${date}`);
export const createOvertimeRequest = (data) => api.post('/timekeeping/overtime', data);
export const getMyOvertime = () => api.get('/timekeeping/overtime/me');
export const getOvertimeRequests = () => api.get('/timekeeping/overtime');
export const reviewOvertimeRequest = (id, data) => api.patch(`/timekeeping/overtime/${id}/review`, data);
export const getOvertimeRates = (month, year) => api.get('/timekeeping/overtime-rates', { params: { month, year } });
export const setOvertimeRate = (employeeId, data) => api.put(`/timekeeping/overtime-rates/${employeeId}`, data);

// Timekeeping Hardware Devices & Biometric Person Mapping
export const listTimekeepingDevices = () => api.get('/timekeeping/devices');
export const createTimekeepingDevice = (data) => api.post('/timekeeping/devices', data);
export const updateTimekeepingDevice = (id, data) => api.patch(`/timekeeping/devices/${id}`, data);
export const testTimekeepingDeviceConnection = (id) => api.post(`/timekeeping/devices/${id}/test-connection`);
export const syncTimekeepingDevice = (id, options = {}) => api.post(`/timekeeping/devices/${id}/sync`, options);
export const listPersonMappings = (deviceId) => api.get(`/timekeeping/devices/${deviceId}/person-mappings`);
export const upsertPersonMapping = (deviceId, data) => api.post(`/timekeeping/devices/${deviceId}/person-mappings`, data);
export const deletePersonMapping = (deviceId, mappingId) => api.delete(`/timekeeping/devices/${deviceId}/person-mappings/${mappingId}`);
export const getTimekeepingDeviceSyncLogs = (deviceId) => api.get(`/timekeeping/devices/${deviceId}/sync-logs`);
export const getUnmappedDeviceEvents = (deviceCode) => api.get('/timekeeping/devices-unmapped', { params: deviceCode ? { deviceCode } : {} });
