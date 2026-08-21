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
