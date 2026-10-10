const mongoose = require('mongoose');
const Access = require('../models/zone2_hr/HrAccessLog');
const Audit = require('../models/zone1_system/AuditLog');
const Payroll = require('../models/zone2_hr/PayrollEvent');
const Attendance = require('../models/zone2_hr/AttendanceAuditLog');
const { sanitizeAuditValue, changeFields, safeReason } = require('../services/hrAuditSafety');
const categories = { profile: 'Hồ sơ nhân sự', payroll: 'Lương', timekeeping: 'Chấm công', staffing: 'Phân công', leave: 'Nghỉ phép', accounts: 'Tài khoản', credentials: 'Giấy tờ', recruitment: 'Tuyển dụng', development: 'Đào tạo / đánh giá', handover: 'Bàn giao', requests: 'Yêu cầu cá nhân', internal: 'Thông báo', reports: 'Báo cáo', audit: 'Nhật ký' };
const hrActions = /^(EMPLOYEE_|CREDENTIAL_|HIRING_|APPLICANT_|TRAINING_|STAFF_|INTERNAL_ACCOUNT_|INTERNAL_ANNOUNCEMENT_|MONTHLY_|CLASSROOM_STAFF_)/;
const categoryExpression = { $switch: { branches: [
  ['EMPLOYEE_LEAVE_', 'leave'], ['EMPLOYEE_', 'profile'], ['CLASSROOM_STAFF_|STAFF_SHIFT_|STAFF_REPLACEMENT_', 'staffing'], ['STAFF_HANDOVER_', 'handover'], ['STAFF_PERSONAL_REQUEST_', 'requests'], ['TRAINING_|STAFF_REVIEW_', 'development'], ['CREDENTIAL_', 'credentials'], ['HIRING_|APPLICANT_', 'recruitment'], ['INTERNAL_ACCOUNT_', 'accounts'], ['MONTHLY_', 'timekeeping'], ['INTERNAL_ANNOUNCEMENT_', 'internal']
].map(([regex, then]) => ({ case: { $regexMatch: { input: '$action', regex: `^(${regex})` } }, then })), default: 'profile' } };
const base = { actorId: 1, actorName: 1, actorRole: 1, actorUsername: 1, action: 1, targetType: 1, targetId: 1, reason: 1, before: 1, after: 1 };
const pipelines = {
  access: [{ $project: { ...base, source: { $literal: 'access' }, occurredAt: 1, category: 1, operation: 1, result: 1, targetLabel: 1, recordIds: 1, route: 1, filters: 1, scope: 1, statusCode: 1 } }],
  security: [{ $match: { action: hrActions } }, { $project: { ...base, source: { $literal: 'security' }, occurredAt: { $ifNull: ['$occurredAt', '$createdAt'] }, category: categoryExpression, operation: { $literal: 'change' }, result: { $literal: 'allowed' } } }],
  payroll: [{ $project: { ...base, source: { $literal: 'payroll' }, occurredAt: '$createdAt', category: { $literal: 'payroll' }, operation: { $literal: 'change' }, targetType: { $literal: 'Payroll' }, targetId: '$payrollId', result: { $literal: 'allowed' } } }],
  timekeeping: [{ $project: { ...base, actorId: '$actor', source: { $literal: 'timekeeping' }, occurredAt: { $ifNull: ['$timestamp', '$createdAt'] }, category: { $cond: [{ $eq: ['$action', 'OVERTIME_RATE_SET'] }, 'payroll', 'timekeeping'] }, operation: { $literal: 'change' }, targetType: '$entity', targetId: '$entityId', before: '$oldValue', after: '$newValue', result: { $literal: 'allowed' } } }]
};
const models = { access: Access, security: Audit, payroll: Payroll, timekeeping: Attendance };
const output = (row, detail = false) => {
  const changes = changeFields(row.before, row.after);
  const { before, after, ...rest } = row;
  return { ...rest, actorName: row.actorName || row.actorUsername || (row.actorId ? String(row.actorId) : 'Tác vụ hệ thống'), actorRole: row.actorRole || 'Chưa ghi vai trò', reason: safeReason(row.reason), changes: detail ? changes : changes.map(({ field }) => field), ...(detail ? { before: sanitizeAuditValue(before), after: sanitizeAuditValue(after) } : {}) };
};
exports.options = async (req, res) => res.json({ data: { categories: Object.entries(categories).filter(([key]) => req.user.role !== 'accountant' || key === 'payroll').map(([value, label]) => ({ value, label })), permissions: [
  { role: 'Admin / Hiệu trưởng / HR', scope: 'Nhật ký nhân sự, công, lương và quy trình HR; không bao gồm hồ sơ phụ huynh / học sinh.' },
  { role: 'Kế toán', scope: 'Nhật ký lương; thông tin việc làm cần đối soát và chi trả, không xem giấy tờ định danh / địa chỉ nhà.' },
  { role: 'Nhân viên', scope: 'Chỉ dữ liệu cá nhân được công bố và công việc được phân công; không truy cập nhật ký tập trung.' },
  { role: 'Phụ huynh', scope: 'Không truy cập dữ liệu nhân sự và nhật ký HR.' }
] } });
exports.list = async (req, res) => {
  try {
    const { category, operation, actorId, fromDate, toDate } = req.query;
    if ([fromDate, toDate].some((value) => {
      if (!value) return false;
      const parsed = new Date(`${value}T00:00:00Z`);
      return !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== value;
    })) return res.status(400).json({ message: 'Ngày tra cứu không hợp lệ.' });
    if (category && !categories[category]) return res.status(400).json({ message: 'Nhóm dữ liệu không hợp lệ.' });
    if (req.user.role === 'accountant' && category && category !== 'payroll') return res.status(403).json({ message: 'Kế toán chỉ xem nhật ký lương.' });
    if (operation && !['read', 'change', 'export', 'blocked'].includes(operation)) return res.status(400).json({ message: 'Thao tác không hợp lệ.' });
    if (actorId && !mongoose.isValidObjectId(actorId)) return res.status(400).json({ message: 'Mã người thao tác không hợp lệ.' });
    const end = toDate ? new Date(`${toDate}T23:59:59.999+07:00`) : new Date();
    const start = fromDate ? new Date(`${fromDate}T00:00:00+07:00`) : new Date(end.getTime() - 7 * 86400000);
    if (!Number.isFinite(+start) || !Number.isFinite(+end) || start > end || end - start > 366 * 86400000) return res.status(400).json({ message: 'Khoảng tra cứu tối đa 366 ngày.' });
    const match = { occurredAt: { $gte: start, $lte: end } };
    if (category || req.user.role === 'accountant') match.category = req.user.role === 'accountant' ? 'payroll' : category;
    if (operation) match.operation = operation;
    if (actorId) match.actorId = new mongoose.Types.ObjectId(actorId);
    const page = Math.max(1, Math.min(100000, parseInt(req.query.page, 10) || 1));
    const pipeline = [...pipelines.access, ...['security', 'payroll', 'timekeeping'].map((source) => ({ $unionWith: { coll: models[source].collection.name, pipeline: pipelines[source] } })), { $match: match }, { $sort: { occurredAt: -1, source: 1, _id: -1 } }, { $facet: { rows: [{ $skip: (page - 1) * 10 }, { $limit: 10 }], total: [{ $count: 'count' }] } }];
    const [result] = await Access.aggregate(pipeline).allowDiskUse(true);
    res.json({ data: { rows: result.rows.map((row) => output(row)), total: result.total[0]?.count || 0, page, pageSize: 10 } });
  } catch (error) { console.error('HR audit:', error.message); res.status(500).json({ message: 'Không thể tải nhật ký.' }); }
};
exports.detail = async (req, res) => {
  try {
    const { source, id } = req.params;
    if (!models[source] || !mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Nhật ký không hợp lệ.' });
    const [row] = await models[source].aggregate([{ $match: { _id: new mongoose.Types.ObjectId(id) } }, ...pipelines[source]]);
    if (!row) return res.status(404).json({ message: 'Không tìm thấy nhật ký nhân sự.' });
    if (req.user.role === 'accountant' && row.category !== 'payroll') return res.status(403).json({ message: 'Kế toán chỉ xem nhật ký lương.' });
    res.json({ data: output(row, true) });
  } catch (error) { console.error('HR audit detail:', error.message); res.status(500).json({ message: 'Không thể tải chi tiết nhật ký.' }); }
};
