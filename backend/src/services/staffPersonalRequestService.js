const Employee = require('../models/zone2_hr/Employee');
const User = require('../models/zone1_system/User');
const Request = require('../models/zone2_hr/StaffPersonalRequest');
const Notification = require('../models/zone1_system/Notification');
const { fail, text, audit } = require('./credentialService');
const { getWorkDate, isValidWorkDate } = require('../utils/dateHelpers');

const PROFILE_FIELDS = { fullName: 'Họ và tên', phone: 'Điện thoại', email: 'Email', address: 'Địa chỉ', birthDate: 'Ngày sinh', gender: 'Giới tính', idCard: 'Giấy tờ định danh', bankName: 'Ngân hàng', bankAccountNumber: 'Số tài khoản', bankAccountHolder: 'Chủ tài khoản' };
const SENSITIVE_FIELDS = ['fullName', 'birthDate', 'gender', 'idCard', 'bankName', 'bankAccountNumber', 'bankAccountHolder'];
const ACCOUNT_FIELDS = ['fullName', 'phone', 'email', 'address'];
const OPEN_STATUSES = ['pending', 'in_review'];
const names = { profile_change: 'Cập nhật hồ sơ', employment_certificate: 'Xác nhận công tác', timesheet_feedback: 'Phản hồi bảng công', payroll_feedback: 'Phản hồi phiếu lương' };
const actorName = (user) => user.profile?.fullName || user.username;
const profileValues = (employee) => ({ fullName: employee.fullName || '', phone: employee.phone || '', email: employee.email || '', address: employee.address || '',
  birthDate: employee.birthDate ? getWorkDate(employee.birthDate) : '', gender: employee.gender || '', idCard: employee.idCard || '',
  bankName: employee.salaryConfig?.bankAccount?.bankName || '', bankAccountNumber: employee.salaryConfig?.bankAccount?.accountNumber || '', bankAccountHolder: employee.salaryConfig?.bankAccount?.accountHolder || '' });
const normalizeChanges = (body, employee) => {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !Object.hasOwn(PROFILE_FIELDS, key))) throw fail('Chỉ được yêu cầu cập nhật thông tin cá nhân và tài khoản nhận lương.');
  const before = profileValues(employee);
  const next = { ...before };
  for (const [field, value] of Object.entries(body)) {
    const maximum = field === 'address' ? 500 : field === 'email' ? 254 : field === 'idCard' ? 30 : field === 'bankAccountNumber' ? 40 : 120;
    next[field] = text(value, maximum, PROFILE_FIELDS[field], field === 'fullName');
    if (field === 'fullName' && next[field].length < 2) throw fail('Họ và tên phải có ít nhất 2 ký tự.');
    if (field === 'email') { next[field] = next[field].toLowerCase(); if (next[field] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next[field])) throw fail('Email không hợp lệ.'); }
    if (field === 'phone' && next[field] && !/^\+?\d{8,15}$/.test(next[field].replace(/[\s().-]/g, ''))) throw fail('Số điện thoại không hợp lệ.');
    if (field === 'birthDate' && next[field] && (!isValidWorkDate(next[field]) || next[field] >= getWorkDate())) throw fail('Ngày sinh không hợp lệ.');
    if (field === 'gender' && !['', 'male', 'female'].includes(next[field])) throw fail('Giới tính không hợp lệ.');
  }
  const bank = ['bankName', 'bankAccountNumber', 'bankAccountHolder'].map((key) => next[key]);
  if (Object.keys(body).some((field) => field.startsWith('bank')) && bank.some(Boolean) && !bank.every(Boolean)) throw fail('Cần điền đủ ngân hàng, số tài khoản và chủ tài khoản, hoặc để trống cả ba.');
  const changes = Object.keys(body).filter((field) => before[field] !== next[field]).map((field) => ({ field, before: before[field], after: next[field] }));
  if (!changes.length) throw fail('Chưa có thông tin nào thay đổi.');
  return changes;
};
const certificateSnapshot = (employee, user) => ({ employeeId: String(employee._id), employeeCode: employee.employeeCode, fullName: employee.fullName, position: employee.position, role: user.role, startDate: employee.startDate ? getWorkDate(employee.startDate) : null, status: employee.status, contractType: employee.contractType || null });
const getSelfEmployee = async (user, session) => {
  const employee = await Employee.findOne({ userId: user._id, status: { $in: ['active', 'on_leave'] } }).session(session || null);
  if (!employee) throw fail('Tài khoản chưa có hồ sơ nhân sự đang làm việc. Hãy liên hệ HR.', 404);
  return employee;
};
const requestActions = (request, user, accountRole) => {
  if (!OPEN_STATUSES.includes(request.status) || String(request.userId?._id || request.userId) === String(user._id)) return [];
  if (user.role === 'accountant') return request.type === 'payroll_feedback' ? [...(request.status === 'pending' ? ['start'] : []), 'resolve', 'reject'] : [];
  if (!['admin', 'principal', 'hr'].includes(user.role) || (user.role === 'hr' && ['admin', 'principal'].includes(accountRole))) return [];
  const actions = request.status === 'pending' ? ['start'] : [];
  if (request.type === 'employment_certificate') return [...actions, 'prepare', ...(['admin', 'principal'].includes(user.role) && request.certificate ? ['approve'] : []), 'reject'];
  if (request.type === 'profile_change') return [...actions, ...(!request.sensitive || ['admin', 'principal'].includes(user.role) ? ['approve'] : []), 'reject'];
  if (request.type === 'payroll_feedback' && user.role === 'hr') return actions;
  return [...actions, 'resolve', 'reject'];
};
const notifyManagers = async (request, user, session, cancelled = false) => {
  const roles = request.type === 'payroll_feedback' ? ['admin', 'principal', 'hr', 'accountant'] : ['admin', 'principal', 'hr'];
  const managers = await User.find({ role: { $in: roles }, status: 'active', _id: { $ne: user._id } }).select('_id').session(session).lean();
  if (managers.length) await Notification.insertMany(managers.map((manager) => ({ recipientId: manager._id, title: cancelled ? 'Nhân viên đã rút yêu cầu' : `Yêu cầu ${names[request.type].toLowerCase()} mới`,
    message: `${request.employeeName} · ${request.employeeCode}: ${request.subject}`, type: cancelled ? 'info' : 'warning', link: `/hr?tab=requests&request=${request._id}`, createdBy: user._id, metadata: { personalRequestId: request._id } })), { session });
};
const saveRequest = async (data, user, session) => {
  const [request] = await Request.create([{ ...data, userId: user._id, events: [{ action: 'created', actorId: user._id, actorName: actorName(user), note: 'Đã gửi yêu cầu' }] }], { session });
  await audit(user, 'STAFF_PERSONAL_REQUEST_CREATED', 'StaffPersonalRequest', request._id, {}, { type: request.type, status: request.status, fields: request.changes.map((change) => change.field), referenceId: request.referenceId }, session);
  await notifyManagers(request, user, session);
  return request;
};
const createTimesheetFeedback = async ({ sheet, user, note, previous, subject, requestId }, session) => {
  const openKey = `timesheet:${sheet._id}:${sheet.revision}`;
  const existing = await Request.findOne({ userId: user._id, openKey, status: { $in: OPEN_STATUSES } }).session(session);
  if (existing) throw fail('Bảng công này đã có phản hồi đang xử lý. Hãy theo dõi tại Yêu cầu của tôi.', 409);
  const employee = await getSelfEmployee(user, session);
  return saveRequest({ employeeId: employee._id, employeeName: employee.fullName, employeeCode: employee.employeeCode, type: 'timesheet_feedback', subject: subject || `Sai lệch bảng công ${sheet.period}`, message: note,
    referenceId: sheet._id, referenceSnapshot: { period: sheet.period, revision: sheet.revision, totalWorkdays: sheet.totalWorkdays, timesheetVersion: sheet.__v, previous: previous || null }, openKey,
    requestId: requestId || `timesheet-${sheet._id}-${sheet.revision}-${sheet.__v}` }, user, session);
};

module.exports = { PROFILE_FIELDS, SENSITIVE_FIELDS, ACCOUNT_FIELDS, OPEN_STATUSES, actorName, profileValues, normalizeChanges, certificateSnapshot, getSelfEmployee, requestActions, notifyManagers, saveRequest, createTimesheetFeedback };
