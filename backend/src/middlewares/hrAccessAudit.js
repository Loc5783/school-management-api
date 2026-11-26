const mongoose = require('mongoose');
const HrAccessLog = require('../models/zone2_hr/HrAccessLog');

const descriptor = (area, path) => {
  if (area === 'accounts') {
    return path.startsWith('/parents')
      ? { category: 'accounts', targetType: 'User', label: 'Tài khoản phụ huynh' }
      : { category: 'accounts', targetType: 'User', label: 'Tài khoản nhân viên' };
  }
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

const ID_KEYS = ['_id', 'employeeId', 'userId', 'payrollId', 'referenceId', 'targetId', 'entityId'];
const LIST_CONTAINER_KEYS = ['rows', 'items', 'records', 'employees', 'payrolls', 'requests', 'announcements', 'timesheets'];

/**
 * Trích xuất nhanh ObjectId từ tầng nông của payload phản hồi (O(N), không đệ quy sâu vào Mongoose Document).
 * Tránh duyệt đệ quy 12 tầng và gọi `.toObject()` trên toàn bộ danh sách khiến API HR/Tài khoản bị trễ ~1 giây.
 */
const extractShallowIds = (body) => {
  const ids = new Set();
  if (!body || typeof body !== 'object') return [];

  const pushFromItem = (item) => {
    if (!item || typeof item !== 'object') return;
    const raw = item._doc && typeof item._doc === 'object' ? item._doc : item;
    for (const key of ID_KEYS) {
      const val = raw[key];
      if (!val) continue;
      const candidate = typeof val === 'object' && val._id ? val._id : val;
      if (mongoose.isValidObjectId(candidate)) {
        ids.add(String(candidate));
      }
    }
  };

  const payload = body.data !== undefined ? body.data : body;
  if (Array.isArray(payload)) {
    for (const item of payload) pushFromItem(item);
  } else if (payload && typeof payload === 'object') {
    pushFromItem(payload);
    for (const listKey of LIST_CONTAINER_KEYS) {
      if (Array.isArray(payload[listKey])) {
        for (const item of payload[listKey]) pushFromItem(item);
      }
    }
  }
  return [...ids];
};

const hrAccessAudit = (area = 'hr') => (req, res, next) => {
  if (!req.user || (area === 'accounts' && !req.path.startsWith('/accounts') && !req.path.startsWith('/parents'))) return next();
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
    const ids = read ? explicit?.ids || extractShallowIds(body) : [];
    if (denied) for (const value of Object.values(req.params || {})) if (mongoose.isValidObjectId(value)) ids.push(String(value));
    const filters = Object.fromEntries(['date', 'workDate', 'period', 'month', 'year', 'fromMonth', 'toMonth', 'fromDate', 'toDate', 'status', 'type', 'page', 'section', 'category', 'operation', 'source', 'role'].filter((key) => typeof req.query[key] === 'string' && req.query[key].length <= 40).map((key) => [key, req.query[key]]));
    const tenantId = req.tenantId || req.user?.tenantId || null;
    const entry = {
      ...(tenantId ? { tenantId } : {}),
      actorId: req.user._id, actorUsername: req.user.username, actorName: req.user.profile?.fullName || req.user.username, actorRole: req.user.role,
      category: description.category, targetType: description.targetType, targetLabel: explicit?.label || description.label,
      operation: denied ? 'blocked' : req.path.endsWith('/export') ? 'export' : 'read', result: code === 403 ? 'denied' : code === 404 ? 'unavailable' : 'allowed',
      method: req.method, route: `${req.baseUrl}${req.route?.path || req.path}`, scope: req.path.includes('/my-') || req.path.endsWith('/me') || req.path.endsWith('/mine') || req.path.endsWith('/context') ? 'self' : ['admin', 'principal', 'hr', 'accountant'].includes(req.user.role) ? 'management' : 'scoped',
      recordIds: [...new Set(ids.map(String))], filters, statusCode: code
    };
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
