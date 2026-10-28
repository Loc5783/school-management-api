const Classroom = require('../models/zone3_school/Classroom');
const Employee = require('../models/zone2_hr/Employee');
const LeaveRequest = require('../models/zone2_hr/LeaveRequest');
const StaffShift = require('../models/zone2_hr/StaffShift');
const StaffReplacement = require('../models/zone2_hr/StaffReplacement');
const { getWorkDate, addWorkDays } = require('../utils/dateHelpers');

const weekdayOf = (date) => new Date(`${date}T00:00:00.000Z`).getUTCDay();
const worksOn = (shift, date) => shift.status === 'active' && shift.validFrom <= date && shift.validUntil >= date && shift.weekdays.includes(weekdayOf(date));
const leaveOn = (leave, date) => leave.status === 'approved' && (leave.workDates?.length
  ? leave.workDates.includes(date)
  : getWorkDate(leave.startDate) <= date && getWorkDate(leave.endDate) >= date);

const getStaffingSnapshot = async (date) => {
  const [classes, employees, leaves, shifts, replacements] = await Promise.all([
    Classroom.find({ status: 'active' }).select('name schoolYear teachers homeroomTeacherId requiredTeachers teachingWeekdays').lean(),
    Employee.find({ status: { $ne: 'resigned' } }).select('fullName employeeCode payrollRole status userId').populate('userId', 'role status').lean(),
    LeaveRequest.find({ status: 'approved' }).select('employeeId startDate endDate workDates status').lean(),
    StaffShift.find({ status: 'active', validFrom: { $lte: date }, validUntil: { $gte: date } }).lean(),
    StaffReplacement.find({ date, status: 'active' }).lean()
  ]);
  const byUserId = new Map(employees.filter((employee) => employee.userId?._id).map((employee) => [String(employee.userId._id), employee]));
  const byEmployeeId = new Map(employees.map((employee) => [String(employee._id), employee]));
  const away = new Set(leaves.filter((leave) => leaveOn(leave, date)).map((leave) => String(leave.employeeId)));
  const available = (employee) => Boolean(employee && employee.status === 'active' && employee.userId?.status === 'active' && !away.has(String(employee._id)));
  const classrooms = classes.map((classroom) => {
    const schoolDay = (classroom.teachingWeekdays || [1, 2, 3, 4, 5]).includes(weekdayOf(date));
    const ids = [...new Set([classroom.homeroomTeacherId, ...(classroom.teachers || []).filter((entry) => entry.role !== 'subject').map((entry) => entry.teacherId)].filter(Boolean).map(String))];
    const assigned = ids.map((id) => byUserId.get(id)).filter((employee) => employee?.userId?.role === 'teacher');
    const covering = replacements.filter((entry) => entry.kind === 'classroom' && String(entry.classroomId) === String(classroom._id) &&
      assigned.some((employee) => String(employee._id) === String(entry.absentEmployeeId)) && away.has(String(entry.absentEmployeeId)))
      .map((entry) => byEmployeeId.get(String(entry.replacementEmployeeId))).filter(available);
    const present = [...new Map([...assigned.filter(available), ...covering].map((employee) => [String(employee._id), employee])).values()];
    const required = Math.max(1, classroom.requiredTeachers || 1);
    const missingTeachers = schoolDay ? Math.max(0, required - present.length) : 0;
    const quotaStatus = !schoolDay ? 'off' : missingTeachers > 0 ? 'shortage' : (present.length > required ? 'surplus' : 'sufficient');
    return { _id: classroom._id, name: classroom.name, schoolYear: classroom.schoolYear, requiredTeachers: required, teachingWeekdays: classroom.teachingWeekdays || [1, 2, 3, 4, 5], schoolDay,
      homeroomTeacherId: classroom.homeroomTeacherId || null,
      supportTeacherIds: (classroom.teachers || []).filter((entry) => entry.role === 'support').map((entry) => entry.teacherId),
      assigned: assigned.map((employee) => ({ _id: employee._id, name: employee.fullName, absent: !available(employee) })),
      replacements: covering.map((employee) => ({ _id: employee._id, name: employee.fullName })),
      presentTeachers: present.length, missingTeachers, quotaStatus };
  });
  const duties = shifts.filter((shift) => worksOn(shift, date)).map((shift) => {
    const employee = byEmployeeId.get(String(shift.employeeId));
    const covering = replacements.filter((entry) => entry.kind === 'shift' && String(entry.shiftId) === String(shift._id) &&
      String(entry.absentEmployeeId) === String(shift.employeeId) && away.has(String(entry.absentEmployeeId)))
      .map((entry) => byEmployeeId.get(String(entry.replacementEmployeeId))).find(available);
    const uncovered = !available(employee) && !covering;
    return { ...shift, employeeName: employee?.fullName || 'Không tìm thấy nhân viên', absent: !available(employee),
      replacement: covering ? { _id: covering._id, name: covering.fullName } : null,
      uncovered,
      quotaStatus: uncovered ? 'shortage' : 'sufficient' };
  });
  return { date, classrooms, duties, replacements, teacherShortages: classrooms.filter((item) => item.missingTeachers > 0),
    missingTeacherTotal: classrooms.reduce((sum, item) => sum + item.missingTeachers, 0),
    uncoveredShifts: duties.filter((item) => item.uncovered).length };
};

const getStaffingTimetable = async ({ startDate, daysCount = 7, schoolYear, role, classroomId, employeeId, shiftId }) => {
  const days = [];
  let cur = startDate;
  for (let i = 0; i < daysCount; i++) {
    days.push(cur);
    cur = addWorkDays(cur, 1);
  }

  const [classes, employees, leaves, allShifts, allReplacements] = await Promise.all([
    Classroom.find({ status: 'active', ...(schoolYear ? { schoolYear } : {}), ...(classroomId ? { _id: classroomId } : {}) }).select('name schoolYear teachers homeroomTeacherId requiredTeachers teachingWeekdays').lean(),
    Employee.find({ status: { $ne: 'resigned' } }).select('fullName employeeCode payrollRole status userId position').populate('userId', 'role status').lean(),
    LeaveRequest.find({ status: 'approved' }).select('employeeId startDate endDate workDates status').lean(),
    StaffShift.find({ status: 'active', validFrom: { $lte: days[days.length - 1] }, validUntil: { $gte: days[0] }, ...(shiftId ? { _id: shiftId } : {}) }).lean(),
    StaffReplacement.find({ date: { $in: days }, status: 'active' }).lean()
  ]);

  const byUserId = new Map(employees.filter((e) => e.userId?._id).map((e) => [String(e.userId._id), e]));
  const byEmployeeId = new Map(employees.map((e) => [String(e._id), e]));

  const timetableByDate = days.map((date) => {
    const away = new Set(leaves.filter((l) => leaveOn(l, date)).map((l) => String(l.employeeId)));
    const available = (e) => Boolean(e && e.status === 'active' && e.userId?.status === 'active' && !away.has(String(e._id)));
    const dateReplacements = allReplacements.filter((r) => r.date === date);

    let classrooms = classes.map((classroom) => {
      const schoolDay = (classroom.teachingWeekdays || [1, 2, 3, 4, 5]).includes(weekdayOf(date));
      const ids = [...new Set([classroom.homeroomTeacherId, ...(classroom.teachers || []).filter((entry) => entry.role !== 'subject').map((entry) => entry.teacherId)].filter(Boolean).map(String))];
      const assigned = ids.map((id) => byUserId.get(id)).filter((emp) => emp?.userId?.role === 'teacher');
      const covering = dateReplacements.filter((entry) => entry.kind === 'classroom' && String(entry.classroomId) === String(classroom._id) &&
        assigned.some((emp) => String(emp._id) === String(entry.absentEmployeeId)) && away.has(String(entry.absentEmployeeId)))
        .map((entry) => byEmployeeId.get(String(entry.replacementEmployeeId))).filter(available);
      const present = [...new Map([...assigned.filter(available), ...covering].map((emp) => [String(emp._id), emp])).values()];
      const required = Math.max(1, classroom.requiredTeachers || 1);
      const missingTeachers = schoolDay ? Math.max(0, required - present.length) : 0;
      const quotaStatus = !schoolDay ? 'off' : missingTeachers > 0 ? 'shortage' : (present.length > required ? 'surplus' : 'sufficient');

      return {
        _id: classroom._id,
        name: classroom.name,
        schoolYear: classroom.schoolYear,
        requiredTeachers: required,
        teachingWeekdays: classroom.teachingWeekdays || [1, 2, 3, 4, 5],
        schoolDay,
        homeroomTeacherId: classroom.homeroomTeacherId || null,
        assigned: assigned.map((emp) => ({
          _id: emp._id,
          name: emp.fullName,
          absent: !available(emp),
          isHomeroom: String(emp.userId?._id) === String(classroom.homeroomTeacherId)
        })),
        replacements: covering.map((emp) => ({ _id: emp._id, name: emp.fullName })),
        presentTeachers: present.length,
        missingTeachers,
        quotaStatus
      };
    });

    let duties = allShifts.filter((shift) => worksOn(shift, date)).map((shift) => {
      const employee = byEmployeeId.get(String(shift.employeeId));
      const covering = dateReplacements.filter((entry) => entry.kind === 'shift' && String(entry.shiftId) === String(shift._id) &&
        String(entry.absentEmployeeId) === String(shift.employeeId) && away.has(String(entry.absentEmployeeId)))
        .map((entry) => byEmployeeId.get(String(entry.replacementEmployeeId))).find(available);
      const uncovered = !available(employee) && !covering;
      return {
        ...shift,
        employeeName: employee?.fullName || 'Không tìm thấy nhân viên',
        absent: !available(employee),
        replacement: covering ? { _id: covering._id, name: covering.fullName } : null,
        uncovered,
        quotaStatus: uncovered ? 'shortage' : 'sufficient'
      };
    });

    if (role === 'teacher') duties = [];
    if (['chef', 'guard'].includes(role)) {
      classrooms = [];
      duties = duties.filter((d) => d.role === role);
    }
    if (employeeId) {
      classrooms = classrooms.filter((c) => c.assigned.some((a) => String(a._id) === String(employeeId)) || c.replacements.some((r) => String(r._id) === String(employeeId)));
      duties = duties.filter((d) => String(d.employeeId) === String(employeeId) || (d.replacement && String(d.replacement._id) === String(employeeId)));
    }

    return {
      date,
      weekday: weekdayOf(date),
      classrooms,
      duties,
      shortages: classrooms.filter((c) => c.quotaStatus === 'shortage').length + duties.filter((d) => d.quotaStatus === 'shortage').length
    };
  });

  return {
    startDate,
    daysCount,
    dates: days,
    timetable: timetableByDate,
    classes: classes.map((c) => ({ _id: c._id, name: c.name, schoolYear: c.schoolYear })),
    roles: ['teacher', 'chef', 'guard']
  };
};

module.exports = { getStaffingSnapshot, getStaffingTimetable, leaveOn, weekdayOf, worksOn };
