import api from './axiosConfig';

export const getAttendanceByClass = (classroomId, date) => {
  const url = date ? `/attendance/class/${classroomId}?date=${date}` : `/attendance/class/${classroomId}`;
  return api.get(url);
};

export const createAttendance = (data) => api.post('/attendance', data);

export const createBulkAttendance = (data) => api.post('/attendance/bulk', data);

export const automaticCheckIn = (identifier, method) => api.post('/attendance/check-in', { identifier, method });

export const updateAttendance = (id, data) => api.put(`/attendance/${id}`, data);

export const deleteAttendance = (id) => api.delete(`/attendance/${id}`);

export const getStudentAttendance = (studentId, params) => api.get(`/attendance/student/${studentId}`, { params });
export const createLeaveRequest = (data) => api.post('/attendance/leave-requests', data);
export const getLeaveRequests = (params) => api.get('/attendance/leave-requests', { params });
export const reviewLeaveRequest = (id, data) => api.patch(`/attendance/leave-requests/${id}/review`, data);
export const getAbsenceReport = (params) => api.get('/attendance/reports/absence', { params });
