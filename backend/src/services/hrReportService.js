const Employee = require('../models/zone2_hr/Employee');
const LeaveRequest = require('../models/zone2_hr/LeaveRequest');
const OvertimeRequest = require('../models/zone2_hr/OvertimeRequest');
const Payroll = require('../models/zone2_hr/Payroll');
const StaffHandover = require('../models/zone2_hr/StaffHandover');
const AuditLog = require('../models/zone1_system/AuditLog');
const { getStaffingSnapshot } = require('./staffingService');
const { getWorkDate, startOfWorkDate, addWorkDays, isValidWorkDate } = require('../utils/dateHelpers');

const ROLE_LABELS = { principal: 'Hiệu trưởng', teacher: 'Giáo viên', accountant: 'Kế toán', chef: 'Nhân viên bếp', guard: 'Bảo vệ', hr: 'Nhân sự', unclassified: 'Chưa xác định vai trò' };
const SECTIONS = ['people', 'movements', 'staffing', 'leave', 'overtime', 'payroll'];
const problem = (message) => Object.assign(new Error(message), { statusCode: 422 });
const roleOf = (employee) => {
  if (employee?.userId?.role) return employee.userId.role === 'admin' ? 'principal' : (Object.hasOwn(ROLE_LABELS, employee.userId.role) ? employee.userId.role : 'unclassified');
  return Object.hasOwn(ROLE_LABELS, employee?.payrollRole) ? employee.payrollRole : 'unclassified';
};
const idOf = (value) => String(value?._id || value || '');
const dayOf = (value) => value && Number.isFinite(new Date(value).getTime()) ? getWorkDate(value) : null;
const amount = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const monthIndex = (value) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;

const parseReportFilters = (query = {}) => {
  const currentMonth = getWorkDate().slice(0, 7);
  const fromMonth = query.fromMonth || currentMonth;
  const toMonth = query.toMonth || fromMonth;
  const validMonth = (value) => typeof value === 'string' && /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(value);
  if (!validMonth(fromMonth) || !validMonth(toMonth) || fromMonth > toMonth || monthIndex(toMonth) - monthIndex(fromMonth) > 11 || toMonth > currentMonth) throw problem('Chọn khoảng báo cáo từ 1 đến 12 tháng, không sau tháng hiện tại.');
  const role = query.role || 'all';
  if (role !== 'all' && !Object.hasOwn(ROLE_LABELS, role)) throw problem('Vai trò báo cáo không hợp lệ.');
  const staffingDate = query.staffingDate || getWorkDate();
  if (!isValidWorkDate(staffingDate) || staffingDate < getWorkDate() || staffingDate > addWorkDays(getWorkDate(), 90)) throw problem('Ngày kiểm tra thiếu người phải từ hôm nay đến 90 ngày tới.');
  const section = query.section || 'people';
  if (!SECTIONS.includes(section)) throw problem('Nội dung báo cáo không hợp lệ.');
  const page = query.page === undefined ? 1 : Number(query.page);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw problem('Số trang không hợp lệ.');
  const [year, month] = toMonth.split('-').map(Number);
  const endDate = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  return { fromMonth, toMonth, role, staffingDate, section, page, startDate: `${fromMonth}-01`, endDate,
    start: startOfWorkDate(`${fromMonth}-01`), end: startOfWorkDate(endDate) };
};

const buildHrReport = ({ employees, leaves, overtime, payrolls, handovers, resignations, staffing }, filters) => {
  const nowDate = getWorkDate();
  const matchesRole = (role) => filters.role === 'all' || filters.role === role;
  const inPeriod = (date) => date && date >= filters.startDate && date < filters.endDate;
  const employeeMap = new Map(employees.map((employee) => [idOf(employee._id), employee]));
  const employeeRole = (id) => roleOf(employeeMap.get(idOf(id)));
  const selected = employees.filter((employee) => matchesRole(roleOf(employee)));
  const working = selected.filter((employee) => employee.status !== 'resigned');
  const headcountByRole = Object.entries(ROLE_LABELS).map(([role, label]) => ({ role, label,
    count: working.filter((employee) => roleOf(employee) === role).length,
    active: working.filter((employee) => roleOf(employee) === role && employee.status === 'active').length,
    onLeave: working.filter((employee) => roleOf(employee) === role && employee.status === 'on_leave').length
  })).filter((row) => matchesRole(row.role));
  const peopleRows = selected.map((employee) => ({ id: idOf(employee._id), code: employee.employeeCode, name: employee.fullName,
    role: roleOf(employee), status: employee.status, startDate: dayOf(employee.startDate),
    accountStatus: employee.userId?.status || 'unlinked' })).sort((a, b) => a.name.localeCompare(b.name, 'vi'));

  const movementRows = [];
  for (const employee of selected) {
    const date = dayOf(employee.startDate);
    if (inPeriod(date) && date <= nowDate) movementRows.push({ id: `joined:${employee._id}`, employeeId: idOf(employee._id), code: employee.employeeCode, name: employee.fullName, role: roleOf(employee), date, kind: 'joined', source: 'Ngày vào làm trong hồ sơ' });
  }
  const completedResignations = new Set(handovers.filter((plan) => plan.kind === 'resignation').map((plan) => idOf(plan.employeeId)));
  for (const plan of handovers) {
    if (!matchesRole(employeeRole(plan.employeeId))) continue;
    const employee = employeeMap.get(idOf(plan.employeeId));
    movementRows.push({ id: idOf(plan._id), employeeId: idOf(plan.employeeId), code: employee?.employeeCode || '—', name: employee?.fullName || 'Hồ sơ không còn tồn tại', role: employeeRole(plan.employeeId), date: dayOf(plan.effectiveAt), kind: plan.kind === 'resignation' ? 'resigned' : 'transferred', source: 'Bàn giao đã hoàn tất' });
  }
  const legacySeen = new Set();
  for (const event of resignations) {
    const employeeId = idOf(event.targetId);
    if (completedResignations.has(employeeId) || legacySeen.has(employeeId) || !matchesRole(employeeRole(employeeId))) continue;
    legacySeen.add(employeeId);
    const employee = employeeMap.get(employeeId);
    movementRows.push({ id: idOf(event._id), employeeId, code: employee?.employeeCode || '—', name: employee?.fullName || 'Hồ sơ không còn tồn tại', role: employeeRole(employeeId), date: dayOf(event.occurredAt), kind: 'resigned', source: 'Lịch sử ghi nhận nghỉ việc' });
  }
  movementRows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.name.localeCompare(b.name, 'vi'));

  let unknownLeaveDays = 0;
  const leaveRows = leaves.filter((leave) => matchesRole(employeeRole(leave.employeeId))).map((leave) => {
    const employee = employeeMap.get(idOf(leave.employeeId));
    const storedDates = [...new Set(leave.workDates || [])].sort();
    let daysInPeriod = null;
    let dateSource = 'Thiếu ngày làm được lưu';
    if (storedDates.length) {
      const matchingDates = storedDates.filter(inPeriod);
      if (!matchingDates.length) daysInPeriod = 0;
      else if (matchingDates.length === storedDates.length) daysInPeriod = amount(leave.totalDays);
      else if (amount(leave.totalDays) === storedDates.length) daysInPeriod = matchingDates.length;
      dateSource = daysInPeriod === null ? 'Thiếu số ngày nghỉ từng kỳ' : 'Ngày làm được lưu trong đơn';
    } else if (dayOf(leave.startDate) >= filters.startDate && dayOf(leave.endDate) < filters.endDate) {
      daysInPeriod = amount(leave.totalDays);
      dateSource = 'Tổng ngày ghi trong đơn';
    }
    if (leave.status === 'approved' && daysInPeriod === null) unknownLeaveDays++;
    return { id: idOf(leave._id), code: employee?.employeeCode || leave.employeeCode || '—', name: employee?.fullName || leave.employeeName,
      role: employeeRole(leave.employeeId), type: leave.leaveType, status: leave.status, startDate: dayOf(leave.startDate), endDate: dayOf(leave.endDate), daysInPeriod, dateSource };
  }).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const approvedLeaves = leaveRows.filter((row) => row.status === 'approved');
  const leaveByType = ['annual', 'sick', 'maternity', 'personal', 'unpaid', 'compensatory'].map((type) => ({ type,
    requests: approvedLeaves.filter((row) => row.type === type).length,
    days: approvedLeaves.filter((row) => row.type === type).reduce((sum, row) => sum + (row.daysInPeriod || 0), 0) }));
  const overtimeRows = overtime.filter((entry) => matchesRole(employeeRole(entry.employeeId))).map((entry) => {
    const employee = employeeMap.get(idOf(entry.employeeId));
    return { id: idOf(entry._id), code: employee?.employeeCode || '—', name: employee?.fullName || 'Hồ sơ không còn tồn tại', role: employeeRole(entry.employeeId), date: entry.workDate, status: entry.status,
      requestedMinutes: amount(entry.requestedMinutes), approvedMinutes: entry.status === 'approved' ? amount(entry.approvedMinutes) : 0 };
  }).sort((a, b) => b.date.localeCompare(a.date));
  const payrollRows = payrolls.filter((entry) => matchesRole(entry.payrollRole)).map((entry) => ({ id: idOf(entry._id), code: entry.employeeCode, name: entry.employeeName, role: entry.payrollRole,
    period: `${entry.year}-${String(entry.month).padStart(2, '0')}`, status: entry.status, gross: amount(entry.grossSalary), net: amount(entry.netSalary), overtimePay: amount(entry.overtimePay),
    allowances: Object.values(entry.allowances || {}).reduce((sum, value) => sum + amount(value), 0),
    deductions: Object.values(entry.deductions || {}).reduce((sum, value) => sum + amount(value), 0), paidAt: dayOf(entry.paidAt) }))
    .sort((a, b) => b.period.localeCompare(a.period) || a.name.localeCompare(b.name, 'vi'));
  const payrollByStatus = ['draft', 'reviewed', 'confirmed', 'paid'].map((status) => ({ status,
    count: payrollRows.filter((row) => row.status === status).length,
    gross: payrollRows.filter((row) => row.status === status).reduce((sum, row) => sum + row.gross, 0),
    net: payrollRows.filter((row) => row.status === status).reduce((sum, row) => sum + row.net, 0) }));
  const payrollByRole = Object.entries(ROLE_LABELS).filter(([role]) => matchesRole(role)).map(([role, label]) => ({ role, label,
    count: payrollRows.filter((row) => row.role === role).length,
    gross: payrollRows.filter((row) => row.role === role).reduce((sum, row) => sum + row.gross, 0),
    net: payrollRows.filter((row) => row.role === role).reduce((sum, row) => sum + row.net, 0),
    paid: payrollRows.filter((row) => row.role === role && row.status === 'paid').reduce((sum, row) => sum + row.net, 0) }));
  const staffingRows = [];
  if (matchesRole('teacher')) for (const classroom of staffing.teacherShortages) staffingRows.push({ id: `class:${classroom._id}`, date: staffing.date, kind: 'classroom', name: classroom.name, role: 'teacher', required: classroom.requiredTeachers, available: classroom.presentTeachers, missing: classroom.missingTeachers,
    assigned: classroom.assigned.map((teacher) => `${teacher.name}${teacher.absent ? ' (không sẵn sàng)' : ''}`).join(', ') || 'Chưa phân công', replacements: classroom.replacements.map((teacher) => teacher.name).join(', ') || 'Chưa có' });
  for (const shift of staffing.duties.filter((entry) => entry.uncovered && matchesRole(entry.role))) staffingRows.push({ id: `shift:${shift._id}`, date: staffing.date, kind: 'shift', name: `${shift.name} · ${shift.startTime}–${shift.endTime}`, role: shift.role, required: 1, available: 0, missing: 1, assigned: shift.employeeName, replacements: 'Chưa có' });
  const warnings = [];
  if (working.some((employee) => !employee.startDate)) warnings.push(`${working.filter((employee) => !employee.startDate).length} nhân viên chưa có ngày vào làm; chưa tính được vào biến động nhận việc.`);
  if (unknownLeaveDays) warnings.push(`${unknownLeaveDays} đơn nghỉ đã duyệt giao nhiều kỳ nhưng chưa đủ dữ liệu phân bổ ngày nghỉ; chưa cộng vào tổng ngày nghỉ của kỳ này.`);
  const untrackedResignations = selected.filter((employee) => employee.status === 'resigned' && !completedResignations.has(idOf(employee._id)) && !legacySeen.has(idOf(employee._id)) && !dayOf(employee.endDate));
  if (untrackedResignations.length) warnings.push(`${untrackedResignations.length} hồ sơ đã nghỉ việc thiếu ngày/lịch sử nghỉ; biến động kỳ có thể chưa đầy đủ.`);
  return { generatedAt: new Date().toISOString(), filters: { fromMonth: filters.fromMonth, toMonth: filters.toMonth, role: filters.role, staffingDate: filters.staffingDate },
    summary: { currentEmployees: working.length, linkedActive: working.filter((employee) => employee.userId?.status === 'active').length,
      unlinked: working.filter((employee) => !employee.userId).length, inactiveAccounts: working.filter((employee) => employee.userId && employee.userId.status !== 'active').length,
      joined: movementRows.filter((row) => row.kind === 'joined').length, resigned: movementRows.filter((row) => row.kind === 'resigned').length, transferred: movementRows.filter((row) => row.kind === 'transferred').length,
      approvedLeaveDays: approvedLeaves.reduce((sum, row) => sum + (row.daysInPeriod || 0), 0), pendingLeaveRequests: leaveRows.filter((row) => row.status === 'pending').length,
      approvedOvertimeMinutes: overtimeRows.reduce((sum, row) => sum + row.approvedMinutes, 0), pendingOvertimeRequests: overtimeRows.filter((row) => row.status === 'pending').length,
      payrollCount: payrollRows.length, payrollGross: payrollRows.reduce((sum, row) => sum + row.gross, 0), payrollNet: payrollRows.reduce((sum, row) => sum + row.net, 0),
      paidNet: payrollRows.filter((row) => row.status === 'paid').reduce((sum, row) => sum + row.net, 0),
      approvedUnpaidNet: payrollRows.filter((row) => row.status === 'confirmed').reduce((sum, row) => sum + row.net, 0),
      missingTeachers: staffingRows.filter((row) => row.kind === 'classroom').reduce((sum, row) => sum + row.missing, 0), uncoveredShifts: staffingRows.filter((row) => row.kind === 'shift').length },
    headcountByRole, leaveByType, payrollByStatus, payrollByRole, warnings,
    rows: { people: peopleRows, movements: movementRows, staffing: staffingRows, leave: leaveRows, overtime: overtimeRows, payroll: payrollRows } };
};

const getHrReport = async (filters) => {
  const months = [];
  for (let index = monthIndex(filters.fromMonth); index <= monthIndex(filters.toMonth); index++) months.push({ year: Math.floor(index / 12), month: index % 12 + 1 });
  const [employees, leaves, overtime, payrolls, handovers, resignations, staffing] = await Promise.all([
    Employee.find().select('employeeCode fullName payrollRole status startDate endDate userId').populate('userId', 'role status').lean(),
    LeaveRequest.find({ startDate: { $lt: filters.end }, endDate: { $gte: filters.start } }).select('employeeId employeeCode employeeName leaveType status startDate endDate totalDays workDates').lean(),
    OvertimeRequest.find({ workDate: { $gte: filters.startDate, $lt: filters.endDate } }).select('employeeId workDate status requestedMinutes approvedMinutes').lean(),
    Payroll.find({ $or: months }).select('employeeCode employeeName payrollRole year month status grossSalary netSalary allowances deductions overtimePay paidAt').lean(),
    StaffHandover.find({ status: 'completed', effectiveAt: { $gte: filters.start, $lt: filters.end } }).select('employeeId effectiveAt kind').lean(),
    AuditLog.find({ action: 'EMPLOYEE_RESIGNED', targetType: 'Employee', occurredAt: { $gte: filters.start, $lt: filters.end } }).select('targetId occurredAt').sort({ occurredAt: -1 }).lean(),
    getStaffingSnapshot(filters.staffingDate)
  ]);
  return buildHrReport({ employees, leaves, overtime, payrolls, handovers, resignations, staffing }, filters);
};

module.exports = { ROLE_LABELS, SECTIONS, parseReportFilters, buildHrReport, getHrReport };
