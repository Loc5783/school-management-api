const Classroom = require('../models/zone3_school/Classroom');
const StaffShift = require('../models/zone2_hr/StaffShift');
const { addWorkDays, getWorkDate, isValidWorkDate } = require('../utils/dateHelpers');
const { weekdayOf, worksOn } = require('./staffingService');
const { buildTenantFilter } = require('./tenantFilterService');

const datesBetween = (startDate, endDate) => {
  if (!isValidWorkDate(startDate) || !isValidWorkDate(endDate) || endDate < startDate) return null;
  const dates = [];
  for (let date = startDate; date <= endDate && dates.length <= 366; date = addWorkDays(date, 1)) dates.push(date);
  return dates.length <= 366 ? dates : null;
};

const scheduledLeaveDates = async (employee, startDate, endDate, context, options = {}) => {
  const dates = datesBetween(startDate, endDate);
  if (!dates) return null;
  const session = options?.session;

  const tenantFilter = buildTenantFilter(context || employee, { throwOnInvalid: true });

  const userId = employee?.userId?._id || employee?.userId;
  const role = employee?.userId?.role || employee?.payrollRole;

  if (['chef', 'guard'].includes(role)) {
    const shiftQuery = StaffShift.find({
      employeeId: employee._id,
      status: 'active',
      validFrom: { $lte: endDate },
      validUntil: { $gte: startDate },
      ...tenantFilter
    });
    if (session) shiftQuery.session(session);
    const shifts = await shiftQuery.lean();
    if (shifts.length) return dates.filter((date) => shifts.some((shift) => worksOn(shift, date)));
  }

  if (role === 'teacher' && userId) {
    const isAlienUser = Boolean(
      employee?.userId?.tenantId &&
      String(employee.userId.tenantId) !== String(employee.tenantId || '')
    );
    if (!isAlienUser) {
      const classQuery = Classroom.find({
        status: 'active',
        ...tenantFilter,
        $or: [
          { homeroomTeacherId: userId },
          { 'teachers.teacherId': userId }
        ]
      }).select('teachingWeekdays');
      if (session) classQuery.session(session);
      const classrooms = await classQuery.lean();
      if (classrooms.length) {
        return dates.filter((date) => classrooms.some((classroom) => (classroom.teachingWeekdays || [1, 2, 3, 4, 5]).includes(weekdayOf(date))));
      }
    }
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
