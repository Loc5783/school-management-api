const Classroom = require('../models/zone3_school/Classroom');
const StaffShift = require('../models/zone2_hr/StaffShift');
const { addWorkDays, getWorkDate, isValidWorkDate } = require('../utils/dateHelpers');
const { weekdayOf, worksOn } = require('./staffingService');

const datesBetween = (startDate, endDate) => {
  if (!isValidWorkDate(startDate) || !isValidWorkDate(endDate) || endDate < startDate) return null;
  const dates = [];
  for (let date = startDate; date <= endDate && dates.length <= 366; date = addWorkDays(date, 1)) dates.push(date);
  return dates.length <= 366 ? dates : null;
};

const scheduledLeaveDates = async (employee, startDate, endDate) => {
  const dates = datesBetween(startDate, endDate);
  if (!dates) return null;
  const role = employee.userId?.role;
  if (['chef', 'guard'].includes(role)) {
    const shifts = await StaffShift.find({ employeeId: employee._id, status: 'active', validFrom: { $lte: endDate }, validUntil: { $gte: startDate } }).lean();
    if (shifts.length) return dates.filter((date) => shifts.some((shift) => worksOn(shift, date)));
  }
  if (role === 'teacher') {
    const classrooms = await Classroom.find({ status: 'active', $or: [{ homeroomTeacherId: employee.userId._id }, { 'teachers.teacherId': employee.userId._id }] }).select('teachingWeekdays').lean();
    if (classrooms.length) return dates.filter((date) => classrooms.some((classroom) => (classroom.teachingWeekdays || [1, 2, 3, 4, 5]).includes(weekdayOf(date))));
  }
  return dates.filter((date) => [1, 2, 3, 4, 5].includes(weekdayOf(date)));
};

const leaveDatesInYear = (leave, year) => {
  const start = getWorkDate(leave.startDate);
  const end = getWorkDate(leave.endDate);
  const dates = Array.isArray(leave.workDates) && leave.workDates.length ? leave.workDates : datesBetween(start, end) || [];
  return dates.filter((date) => date.startsWith(`${year}-`));
};

module.exports = { datesBetween, scheduledLeaveDates, leaveDatesInYear };
