const { recalculateAttendanceForDate } = require('./attendanceCalculationService');

// Compatibility entry point for existing callers.
const mergeAttendanceForDate = (date, actorId = null) => recalculateAttendanceForDate(date, actorId);

module.exports = { mergeAttendanceForDate };
