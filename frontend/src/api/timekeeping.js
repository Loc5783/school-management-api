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

// Timekeeping Hardware Devices & Biometric 500-Slot ISAPI Sync (Multi-Campus & Fast 2-Way)
export const getBiometricOverview = (params = {}) => api.get('/timekeeping/biometric-overview', { params });
export const listTimekeepingDevices = () => api.get('/timekeeping/devices');
export const createTimekeepingDevice = (data) => api.post('/timekeeping/devices', data);
export const updateTimekeepingDevice = (id, data) => api.patch(`/timekeeping/devices/${id}`, data);
export const deleteTimekeepingDevice = (id) => api.delete(`/timekeeping/devices/${id}`);

export const discoverLanTimekeepingDevices = (payloadOrSubnet = {}) => {
  const body =
    typeof payloadOrSubnet === 'string'
      ? { subnetPrefix: payloadOrSubnet || undefined }
      : payloadOrSubnet;
  return api.post('/timekeeping/devices/discover-lan', body);
};

export const checkTimekeepingDeviceCapacity = (id) =>
  api.post(`/timekeeping/devices/${id}/check-capacity`);
export const pullTimekeepingDeviceUsers = (id, overwriteExistingFaces = true) =>
  api.post(`/timekeeping/devices/${id}/pull-users`, { overwriteExistingFaces });
export const linkPulledTimekeepingUser = (deviceId, payload) =>
  api.post(`/timekeeping/devices/${deviceId}/link-pulled-user`, payload);
export const importPulledUsersFromDeviceToWeb = (deviceId, payload = {}) =>
  api.post(`/timekeeping/devices/${deviceId}/import-to-web`, payload);

export const pushSmartSyncToDevice = (id, payload = {}) =>
  api.post(`/timekeeping/devices/${id}/push-sync`, payload);
export const syncAllTimekeepingDevicesSmart = (payload = {}) =>
  api.post('/timekeeping/devices/sync-all', payload);
export const pullAllTimekeepingDevicesFast = (payload = {}) =>
  api.post('/timekeeping/devices/pull-all', payload);
export const quickBidirectionalSyncDevices = (payload = {}) =>
  api.post('/timekeeping/devices/quick-bidirectional-sync', payload);
export const quickBidirectionalSyncSingleDevice = (id) =>
  api.post(`/timekeeping/devices/${id}/quick-bidirectional-sync`);

export const pruneTimekeepingDeviceSlots = (id) =>
  api.post(`/timekeeping/devices/${id}/prune-inactive`);
export const unlockTimekeepingDeviceDoor = (id, doorNo = 1) =>
  api.post(`/timekeeping/devices/${id}/unlock-door`, { doorNo });

export const uploadBiometricFacePhoto = (subjectType, subjectId, payload) =>
  api.put(`/timekeeping/biometric-faces/${subjectType}/${subjectId}`, payload);
export const deleteBiometricFacePhoto = (subjectType, subjectId) =>
  api.delete(`/timekeeping/biometric-faces/${subjectType}/${subjectId}`);
export const pushSingleBiometricPerson = (subjectType, subjectId, payload = {}) =>
  api.post(`/timekeeping/biometric-faces/${subjectType}/${subjectId}/push`, payload);

export const testTimekeepingDeviceConnection = (id) => api.post(`/timekeeping/devices/${id}/test-connection`);
export const syncTimekeepingDevice = (id, options = {}) => api.post(`/timekeeping/devices/${id}/sync`, options);
export const listPersonMappings = (deviceId) => api.get(`/timekeeping/devices/${deviceId}/person-mappings`);
export const upsertPersonMapping = (deviceId, data) => api.post(`/timekeeping/devices/${deviceId}/person-mappings`, data);
export const deletePersonMapping = (deviceId, mappingId) => api.delete(`/timekeeping/devices/${deviceId}/person-mappings/${mappingId}`);
export const getTimekeepingDeviceSyncLogs = (deviceId) => api.get(`/timekeeping/devices/${deviceId}/sync-logs`);
export const getUnmappedDeviceEvents = (deviceCode) => api.get('/timekeeping/devices-unmapped', { params: deviceCode ? { deviceCode } : {} });
export const simulateSchoolTimekeepingWebhook = (data) => api.post('/timekeeping/devices/simulate-webhook', data);
export const getSchoolWebhookLogs = (params = {}) => api.get('/attendance/webhook/logs', { params });

// Cầu nối Mạng Nội Bộ (Local LAN Connector 127.0.0.1:18686), Tên miền động & Thông báo SSE Trực tiếp
export const downloadConnectorPackageZip = () =>
  api.get('/timekeeping/connector-package', { responseType: 'blob' });
export const issueConnectorGrant = (clientOrigin) =>
  api.post('/timekeeping/connector-grant', { clientOrigin });
export const enrichConnectorScan = (payload) =>
  api.post('/timekeeping/devices/connector-enrich-scan', payload);
export const prepareConnectorDeviceAction = (deviceId, payload = {}) =>
  api.post(`/timekeeping/devices/${deviceId}/connector-prepare`, payload);
export const ingestConnectorDevicePull = (deviceId, payload = {}) =>
  api.post(`/timekeeping/devices/${deviceId}/connector-ingest-pull`, payload);
export const completeConnectorDevicePush = (deviceId, payload = {}) =>
  api.post(`/timekeeping/devices/${deviceId}/connector-complete-push`, payload);
export const configureTimekeepingDeviceWebhook = (deviceId, payload = {}) =>
  api.post(`/timekeeping/devices/${deviceId}/configure-webhook`, payload);
export const unlockDeviceSerialByVendor = (deviceId, payload = {}) =>
  api.post(`/timekeeping/devices/${deviceId}/unlock-serial`, payload);
export const getCampusLiveEvents = (limit = 15) =>
  api.get('/timekeeping/live-events', { params: { limit } });
