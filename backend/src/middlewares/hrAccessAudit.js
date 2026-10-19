const mongoose = require('mongoose');
const HrAccessLog = require('../models/zone2_hr/HrAccessLog');

const descriptor = (area, path) => {
  if (area === 'accounts') return { category: 'accounts', targetType: 'User', label: 'Tài khoản nhân viên' };
  if (area === 'timekeeping') return { category: path.includes('overtime-rates') ? 'payroll' : 'timekeeping', targetType: 'AttendanceRecord', label: 'Chấm công và làm thêm' };
  const mappings = [
    [/^\/audit/, 'audit', 'HrAudit', 'Nhật ký và quyền dữ liệu'],
    [/payroll/, 'payroll', 'Payroll', 'Phiếu lương'],
    [/personal-requests\/context/, 'profile', 'Employee', 'Hồ sơ cá nhân và các kỳ đã công bố'],
    [/personal-requests/, 'requests', 'StaffPersonalRequest', 'Yêu cầu nhân viên'],
    [/leave/, 'leave', 'LeaveRequest', 'Nghỉ phép nhân viên'],
    [/staffing/, 'staffing', 'Staffing', 'Phân công lớp và ca'],
    [/credentials/, 'credentials', 'EmployeeCredential', 'Năng lực và giấy tờ'],
    [/recruitment/, 'recruitment', 'JobApplicant', 'Tuyển dụng và tiếp nhận'],
    [/development/, 'development', 'StaffReview', 'Đào tạo và đánh giá'],
    [/handover/, 'handover', 'StaffHandover', 'Bàn giao nhân sự'],
    [/internal.*timesheets/, 'timekeeping', 'MonthlyTimesheet', 'Bảng công tháng'],
    [/internal/, 'internal', 'InternalAnnouncement', 'Thông báo nội bộ'],
    [/reports/, 'reports', 'HrReport', 'Báo cáo nhân sự'],
    [/staff-accounts/, 'accounts', 'User', 'Tài khoản nhân viên']
  ];
  const match = mappings.find(([pattern]) => pattern.test(path));
  return match ? { category: match[1], targetType: match[2], label: match[3] } : { category: 'profile', targetType: 'Employee', label: 'Hồ sơ nhân sự' };
};
const collectIds = (body, ids = new Set(), depth = 0) => {
  if (!body || typeof body !== 'object' || depth > 12) return ids;
  if (body instanceof Date || body instanceof mongoose.Types.ObjectId || Buffer.isBuffer(body)) return ids;
  if (typeof body.toObject === 'function') body = body.toObject();
  if (Array.isArray(body)) { for (const item of body) collectIds(item, ids, depth + 1); return ids; }
  for (const [key, value] of Object.entries(body)) {
    if (['_id', 'employeeId', 'userId', 'payrollId', 'referenceId', 'targetId', 'entityId'].includes(key) && mongoose.isValidObjectId(value)) ids.add(String(value));
    collectIds(value, ids, depth + 1);
  }
  return ids;
};
const hrAccessAudit = (area = 'hr') => (req, res, next) => {
  if (!req.user || (area === 'accounts' && !req.path.startsWith('/accounts'))) return next();
  const description = descriptor(area, req.path);
  const json = res.json.bind(res); const send = res.send.bind(res);
  let intercepted = false;
  const finish = (body, transmit) => {
    if (intercepted) return transmit(body);
    intercepted = true;
    const code = res.statusCode;
    const read = req.method === 'GET' && code >= 200 && code < 300;
    const denied = code === 403 || code === 404;
    if (!read && !denied) return transmit(body);
    const explicit = res.locals.hrAccessTargets;
    const ids = read ? explicit?.ids || [...collectIds(body)] : [];
    if (denied) for (const value of Object.values(req.params || {})) if (mongoose.isValidObjectId(value)) ids.push(String(value));
    const filters = Object.fromEntries(['date', 'workDate', 'period', 'month', 'year', 'fromMonth', 'toMonth', 'fromDate', 'toDate', 'status', 'type', 'page', 'section', 'category', 'operation', 'source', 'role'].filter((key) => typeof req.query[key] === 'string' && req.query[key].length <= 40).map((key) => [key, req.query[key]]));
    const entry = { actorId: req.user._id, actorUsername: req.user.username, actorName: req.user.profile?.fullName || req.user.username, actorRole: req.user.role,
      category: description.category, targetType: description.targetType, targetLabel: explicit?.label || description.label,
      operation: denied ? 'blocked' : req.path.endsWith('/export') ? 'export' : 'read', result: code === 403 ? 'denied' : code === 404 ? 'unavailable' : 'allowed',
      method: req.method, route: `${req.baseUrl}${req.route?.path || req.path}`, scope: req.path.includes('/my-') || req.path.endsWith('/me') || req.path.endsWith('/mine') || req.path.endsWith('/context') ? 'self' : ['admin', 'principal', 'hr', 'accountant'].includes(req.user.role) ? 'management' : 'scoped',
      recordIds: [...new Set(ids.map(String))], filters, statusCode: code };
    void HrAccessLog.create(entry).then(() => { if (!res.destroyed && !res.writableEnded) { res.statusCode = code; transmit(body); } }).catch((error) => {
      console.error('Không thể ghi nhật ký truy cập HR:', error.message);
      if (!res.destroyed && !res.writableEnded) { res.statusCode = 503; json({ message: 'Không thể ghi nhận lượt truy cập. Vui lòng thử lại.' }); }
    });
    return res;
  };
  res.json = (body) => finish(body, json);
  res.send = (body) => finish(body, send);
  next();
};
module.exports = hrAccessAudit;
