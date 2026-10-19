const mongoose = require('mongoose');
const Request = require('../models/zone2_hr/StaffPersonalRequest');
const Employee = require('../models/zone2_hr/Employee');
const User = require('../models/zone1_system/User');
const Payroll = require('../models/zone2_hr/Payroll');
const Timesheet = require('../models/zone2_hr/MonthlyTimesheet');
const Handover = require('../models/zone2_hr/StaffHandover');
const Notification = require('../models/zone1_system/Notification');
const { fail, text, checkId, inTransaction, audit } = require('../services/credentialService');
const { createDateTime, getWorkDate } = require('../utils/dateHelpers');
const { PROFILE_FIELDS, SENSITIVE_FIELDS, ACCOUNT_FIELDS, OPEN_STATUSES, actorName, profileValues, normalizeChanges, certificateSnapshot, getSelfEmployee, requestActions, notifyManagers, saveRequest, createTimesheetFeedback } = require('../services/staffPersonalRequestService');

const TYPES = ['profile_change', 'employment_certificate', 'timesheet_feedback', 'payroll_feedback'];
const STATUSES = [...OPEN_STATUSES, 'approved', 'resolved', 'rejected', 'cancelled'];
const handle = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (error) {
    const conflict = error.code === 11000 || error.code === 112 || error instanceof mongoose.Error.VersionError;
    if (!conflict && !error.statusCode) console.error('Không thể xử lý yêu cầu nhân viên:', error.message);
    res.status(conflict ? 409 : error.statusCode || 500).json({ message: conflict ? 'Yêu cầu vừa thay đổi, đã có yêu cầu đang xử lý hoặc số xác nhận đã được dùng. Hãy tải lại.' : error.statusCode ? error.message : 'Không thể xử lý yêu cầu cá nhân.' });
  }
};
const versionOf = (item, version) => { if (!Number.isInteger(version) || version !== item.__v) throw fail('Yêu cầu đã thay đổi. Hãy tải lại trước khi xử lý.', 409); };
const activeActor = async (user, session) => {
  const versionFilter = user.authVersion ? { authVersion: user.authVersion } : { $or: [{ authVersion: 0 }, { authVersion: { $exists: false } }] };
  const account = await User.findOne({ _id: user._id, status: 'active', role: user.role, ...versionFilter }).session(session);
  if (!account || (account.accessEndsAt && account.accessEndsAt <= new Date())) throw fail('Phiên đăng nhập không còn hiệu lực.', 403);
  return account;
};
const periodOf = (value) => {
  if (typeof value !== 'string' || !/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(value)) throw fail('Kỳ công/lương không hợp lệ (YYYY-MM).');
  return { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) };
};
const canView = (request, user) => String(request.userId?._id || request.userId) === String(user._id) || ['admin', 'principal', 'hr'].includes(user.role) || (user.role === 'accountant' && request.type === 'payroll_feedback');

const context = handle(async (req, res) => {
  const employee = await getSelfEmployee(req.user);
  const period = req.query.period ? periodOf(req.query.period) : null;
  const [payrolls, timesheets] = await Promise.all([
    Payroll.find({ employeeId: employee._id, status: { $in: ['confirmed', 'paid'] }, ...(period || {}) }).sort({ year: -1, month: -1 }).limit(24).select('year month status grossSalary netSalary actualWorkDays __v').lean(),
    Timesheet.find({ userId: req.user._id, ...(period ? { period: req.query.period } : {}) }).sort({ period: -1 }).limit(24).select('period revision status totalWorkdays __v').lean()
  ]);
  res.json({ data: { employee: { _id: employee._id, fullName: employee.fullName, employeeCode: employee.employeeCode, position: employee.position, startDate: employee.startDate }, profile: profileValues(employee), fieldLabels: PROFILE_FIELDS, payrolls, timesheets } });
});
const list = (own) => handle(async (req, res) => {
  const page = Number(req.query.page || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw fail('Số trang không hợp lệ.');
  const filter = own ? { userId: req.user._id } : req.user.role === 'accountant' ? { type: 'payroll_feedback' } : {};
  if (req.query.type && req.query.type !== 'all') {
    if (!TYPES.includes(req.query.type)) throw fail('Loại yêu cầu không hợp lệ.');
    if (!own && req.user.role === 'accountant' && req.query.type !== 'payroll_feedback') throw fail('Kế toán chỉ xử lý phản hồi phiếu lương.', 403);
    filter.type = req.query.type;
  }
  const summaryFilter = { ...filter };
  if (req.query.status && req.query.status !== 'all') {
    if (!STATUSES.includes(req.query.status)) throw fail('Trạng thái không hợp lệ.');
    filter.status = req.query.status;
  }
  const [total, counts] = await Promise.all([Request.countDocuments(filter), Request.aggregate([{ $match: summaryFilter }, { $group: { _id: '$status', count: { $sum: 1 } } }])]);
  const totalPages = Math.max(1, Math.ceil(total / 10));
  const currentPage = Math.min(page, totalPages);
  const rows = await Request.find(filter).sort({ createdAt: -1, _id: -1 }).skip((currentPage - 1) * 10).limit(10)
    .select('employeeName employeeCode userId type subject status sensitive response reviewedByName reviewedAt createdAt updatedAt __v referenceSnapshot certificate.documentNumber')
    .populate('userId', 'role').lean();
  res.json({ data: rows.map((item) => ({ ...item, certificate: own && item.status !== 'approved' ? null : item.certificate, userId: item.userId?._id || item.userId, accountRole: item.userId?.role, allowedActions: requestActions(item, req.user, item.userId?.role) })),
    summary: Object.fromEntries(counts.map((entry) => [entry._id, entry.count])), pagination: { page: currentPage, total, totalPages, limit: 10 } });
});
const detail = handle(async (req, res) => {
  checkId(req.params.id);
  const item = await Request.findById(req.params.id).select('-accountBefore').lean();
  if (!item || !canView(item, req.user)) throw fail('Không tìm thấy yêu cầu được phép xem.', 404);
  const [account, employee] = await Promise.all([User.findById(item.userId).select('role profile.fullName').lean(), Employee.findById(item.employeeId).select('employeeCode fullName position startDate status contractType').lean()]);
  if (String(item.userId) === String(req.user._id) && item.status !== 'approved') item.certificate = null;
  res.json({ data: { ...item, accountRole: account?.role, allowedActions: requestActions(item, req.user, account?.role),
    preparationSnapshot: item.type === 'employment_certificate' && employee && account ? certificateSnapshot(employee, account) : null } });
});
const create = handle(async (req, res) => {
  if (!TYPES.includes(req.body.type)) throw fail('Loại yêu cầu không hợp lệ.');
  const subject = text(req.body.subject, 160, 'Tiêu đề', true);
  const message = text(req.body.message, req.body.type === 'timesheet_feedback' ? 1000 : 2000, 'Nội dung', true);
  if (message.length < 5) throw fail('Nội dung yêu cầu phải có ít nhất 5 ký tự.');
  const requestId = text(req.body.requestId, 100, 'Mã lần gửi', true);
  const data = await inTransaction(async (session) => {
    const account = await activeActor(req.user, session);
    const employee = await getSelfEmployee(account, session);
    const base = { employeeId: employee._id, employeeName: employee.fullName, employeeCode: employee.employeeCode, type: req.body.type, subject, message, requestId, openKey: req.body.type };
    if (req.body.type === 'profile_change') {
      if (await Handover.exists({ employeeId: employee._id, status: 'scheduled' }).session(session)) throw fail('Hồ sơ đang chờ bàn giao có hiệu lực. Liên hệ HR trước khi yêu cầu thay đổi.', 409);
      base.changes = normalizeChanges(req.body.changes, employee);
      base.sensitive = base.changes.some((change) => SENSITIVE_FIELDS.includes(change.field));
      base.accountBefore = Object.fromEntries(base.changes.filter((change) => ACCOUNT_FIELDS.includes(change.field)).map((change) => [change.field, account.profile?.[change.field] || '']));
    } else if (req.body.type === 'employment_certificate') {
      if (employee.startDate && getWorkDate(employee.startDate) > getWorkDate()) throw fail('Chưa đến ngày bắt đầu làm việc. HR cần kiểm tra hồ sơ trước khi xác nhận công tác.', 409);
    } else if (req.body.type === 'payroll_feedback') {
      checkId(req.body.referenceId);
      const payroll = await Payroll.findOne({ _id: req.body.referenceId, employeeId: employee._id, status: { $in: ['confirmed', 'paid'] } }).session(session);
      if (!payroll) throw fail('Không tìm thấy phiếu lương đã công bố của bạn.', 404);
      base.referenceId = payroll._id; base.openKey = `payroll:${payroll._id}`;
      base.referenceSnapshot = { period: `${payroll.year}-${String(payroll.month).padStart(2, '0')}`, status: payroll.status, grossSalary: payroll.grossSalary, netSalary: payroll.netSalary, actualWorkDays: payroll.actualWorkDays };
    } else {
      checkId(req.body.referenceId);
      const sheet = await Timesheet.findOne({ _id: req.body.referenceId, userId: account._id }).session(session);
      if (!sheet) throw fail('Không tìm thấy bảng công của bạn.', 404);
      versionOf(sheet, req.body.referenceVersion);
      const previousStatus = sheet.status;
      const previous = { status: sheet.status, note: sheet.employeeNote, respondedAt: sheet.respondedAt };
      sheet.set({ status: 'disputed', employeeNote: message, respondedAt: new Date() }); await sheet.save({ session });
      await audit(account, 'MONTHLY_TIMESHEET_RESPONDED', 'MonthlyTimesheet', sheet._id, { status: previousStatus }, { status: 'disputed', note: message }, session);
      return createTimesheetFeedback({ sheet, user: account, note: message, previous, subject, requestId }, session);
    }
    return saveRequest(base, account, session);
  });
  res.status(201).json({ message: 'Đã gửi yêu cầu để bộ phận phụ trách xử lý.', data });
});
const cancel = handle(async (req, res) => {
  checkId(req.params.id);
  const data = await inTransaction(async (session) => {
    await activeActor(req.user, session);
    const item = await Request.findOne({ _id: req.params.id, userId: req.user._id }).session(session);
    if (!item) throw fail('Không tìm thấy yêu cầu của bạn.', 404);
    versionOf(item, req.body.version);
    if (!OPEN_STATUSES.includes(item.status)) throw fail('Chỉ rút yêu cầu chưa có kết quả.', 409);
    const before = item.status;
    if (item.type === 'timesheet_feedback' && item.referenceSnapshot?.previous) {
      const sheet = await Timesheet.findOne({ _id: item.referenceId, userId: req.user._id }).session(session);
      if (sheet?.status === 'disputed' && sheet.revision === item.referenceSnapshot.revision && sheet.__v === item.referenceSnapshot.timesheetVersion) {
        const previous = item.referenceSnapshot.previous;
        sheet.set({ status: previous.status, employeeNote: previous.note || '', respondedAt: previous.respondedAt || null }); await sheet.save({ session });
        await audit(req.user, 'MONTHLY_TIMESHEET_RESPONDED', 'MonthlyTimesheet', sheet._id, { status: 'disputed' }, { status: sheet.status }, session, 'Nhân viên rút phản hồi bảng công');
      }
    }
    item.status = 'cancelled'; item.events.push({ action: 'cancelled', actorId: req.user._id, actorName: actorName(req.user), note: 'Người gửi đã rút yêu cầu' }); await item.save({ session });
    await audit(req.user, 'STAFF_PERSONAL_REQUEST_CANCELLED', 'StaffPersonalRequest', item._id, { status: before }, { status: item.status }, session);
    await notifyManagers(item, req.user, session, true);
    return item;
  });
  res.json({ message: 'Đã rút yêu cầu. Lịch sử vẫn được lưu.', data });
});
const applyProfile = async (request, employee, account, actor, session) => {
  const current = profileValues(employee);
  for (const change of request.changes) {
    if (current[change.field] !== change.before || (ACCOUNT_FIELDS.includes(change.field) && (account.profile?.[change.field] || '') !== request.accountBefore[change.field])) throw fail('Hồ sơ đã thay đổi sau khi gửi yêu cầu. Đề nghị nhân viên rút và gửi lại để tránh ghi đè dữ liệu.', 409);
  }
  normalizeChanges(Object.fromEntries(request.changes.map((change) => [change.field, change.after])), employee);
  const bankPaths = { bankName: 'bankName', bankAccountNumber: 'accountNumber', bankAccountHolder: 'accountHolder' };
  for (const change of request.changes) {
    if (Object.hasOwn(bankPaths, change.field)) employee.set(`salaryConfig.bankAccount.${bankPaths[change.field]}`, change.after);
    else employee.set(change.field, change.field === 'birthDate' ? change.after ? createDateTime(change.after, '00:00') : null : change.field === 'gender' ? change.after || null : change.after);
    if (ACCOUNT_FIELDS.includes(change.field)) account.set(`profile.${change.field}`, change.after);
  }
  await employee.save({ session }); await account.save({ session });
  const masked = (change, key) => ['idCard', 'bankAccountNumber'].includes(change.field) ? change[key] ? `***${change[key].slice(-4)}` : '' : change[key];
  await audit(actor, 'EMPLOYEE_UPDATED', 'Employee', employee._id,
    Object.fromEntries(request.changes.map((change) => [change.field, masked(change, 'before')])), Object.fromEntries(request.changes.map((change) => [change.field, masked(change, 'after')])), session, `Theo yêu cầu ${request._id}`);
};
const processRequest = handle(async (req, res) => {
  checkId(req.params.id);
  const action = req.body.action;
  if (!['start', 'prepare', 'approve', 'reject', 'resolve'].includes(action)) throw fail('Hành động xử lý không hợp lệ.');
  const response = text(req.body.response || '', 2000, 'Phản hồi', ['reject', 'resolve'].includes(action));
  if (['reject', 'resolve'].includes(action) && response.length < 5) throw fail('Cần giải thích kết quả xử lý ít nhất 5 ký tự.');
  const data = await inTransaction(async (session) => {
    const actor = await activeActor(req.user, session);
    const item = await Request.findById(req.params.id).session(session);
    if (!item) throw fail('Không tìm thấy yêu cầu.', 404);
    versionOf(item, req.body.version);
    const account = await User.findById(item.userId).session(session);
    if (!requestActions(item, actor, account?.role).includes(action)) throw fail('Bạn không có quyền xử lý bước này hoặc yêu cầu đã có kết quả. Không được tự duyệt yêu cầu của mình.', 403);
    const previousStatus = item.status;
    if (action === 'start') item.status = 'in_review';
    if (action === 'prepare' || action === 'approve') {
      const employee = await Employee.findOne({ _id: item.employeeId, userId: item.userId, status: { $in: ['active', 'on_leave'] } }).session(session);
      if (!employee || account?.status !== 'active' || (account.accessEndsAt && account.accessEndsAt <= new Date())) throw fail('Nhân viên không còn hồ sơ và tài khoản hoạt động để áp dụng thay đổi.', 409);
      if (item.type === 'profile_change') {
        if (await Handover.exists({ employeeId: employee._id, status: 'scheduled' }).session(session)) throw fail('Hồ sơ đang chờ bàn giao có hiệu lực. Cần xử lý lịch bàn giao trước.', 409);
        await applyProfile(item, employee, account, actor, session);
      } else if (item.type === 'employment_certificate') {
        if (!employee.startDate || getWorkDate(employee.startDate) > getWorkDate()) throw fail('Cần HR bổ sung ngày vào làm hợp lệ trước khi lập xác nhận công tác.', 409);
        if (action === 'prepare') {
          const draft = req.body.certificate || {};
          item.certificate = { organizationName: text(draft.organizationName, 200, 'Tên trường / đơn vị', true), documentNumber: text(draft.documentNumber, 80, 'Số xác nhận', true).toUpperCase(), content: text(draft.content, 8000, 'Nội dung xác nhận', true), employeeSnapshot: certificateSnapshot(employee, account), preparedBy: actor._id, preparedAt: new Date() };
          item.status = 'in_review';
        } else {
          if (JSON.stringify(certificateSnapshot(employee, account)) !== JSON.stringify(item.certificate.employeeSnapshot)) throw fail('Thông tin công tác đã thay đổi. HR cần chuẩn bị lại bản xác nhận.', 409);
          item.certificate.issuedByName = actorName(actor); item.certificate.issuedAt = new Date();
        }
      }
    }
    if (action === 'approve') item.status = 'approved';
    if (action === 'resolve') item.status = 'resolved';
    if (action === 'reject') item.status = 'rejected';
    item.response = response || (action === 'start' ? 'Đã tiếp nhận và đang xử lý.' : action === 'prepare' ? 'Đã chuẩn bị bản xác nhận, chờ Ban giám hiệu duyệt.' : 'Đã phê duyệt yêu cầu.');
    item.reviewedBy = actor._id; item.reviewedByName = actorName(actor); item.reviewedAt = new Date();
    item.events.push({ action, actorId: actor._id, actorName: actorName(actor), note: item.response }); await item.save({ session });
    await audit(actor, 'STAFF_PERSONAL_REQUEST_PROCESSED', 'StaffPersonalRequest', item._id, { status: previousStatus }, { status: item.status, action, fields: item.changes.map((change) => change.field), documentNumber: item.certificate?.documentNumber || null }, session, item.response);
    if (account?.status === 'active') await Notification.create([{ recipientId: account._id, title: `Yêu cầu của bạn ${item.status === 'approved' ? 'đã được duyệt' : item.status === 'resolved' ? 'đã có kết quả' : item.status === 'rejected' ? 'đã bị từ chối' : 'đang được xử lý'}`, message: `${item.subject}: ${item.response}`, type: item.status === 'rejected' ? 'warning' : 'info', link: `/my-requests?request=${item._id}`, createdBy: actor._id, metadata: { personalRequestId: item._id } }], { session });
    if (action === 'prepare') {
      const approvers = await User.find({ role: { $in: ['admin', 'principal'] }, status: 'active', _id: { $nin: [actor._id, item.userId] } }).select('_id').session(session).lean();
      if (approvers.length) await Notification.insertMany(approvers.map((approver) => ({ recipientId: approver._id, title: 'Xác nhận công tác chờ phê duyệt', message: `${item.employeeName} · Số ${item.certificate.documentNumber}`, type: 'warning', link: `/hr?tab=requests&request=${item._id}`, createdBy: actor._id })), { session });
    }
    return item;
  });
  res.json({ message: 'Đã lưu kết quả xử lý yêu cầu.', data });
});

module.exports = { context, myRequests: list(true), management: list(false), detail, create, cancel, processRequest };
