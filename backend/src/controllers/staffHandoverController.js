const mongoose = require('mongoose');
const Handover = require('../models/zone2_hr/StaffHandover');
const Employee = require('../models/zone2_hr/Employee');
const User = require('../models/zone1_system/User');
const Classroom = require('../models/zone3_school/Classroom');
const StaffShift = require('../models/zone2_hr/StaffShift');
const Asset = require('../models/zone6_procurement/Asset');
const { getWorkDate } = require('../utils/dateHelpers');
const { fail, checkId, text, inTransaction, audit } = require('../services/credentialService');

const handle = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (error) {
    const conflict = error.code === 11000 || error.code === 112 || error instanceof mongoose.Error.VersionError;
    res.status(conflict ? 409 : error.statusCode || 500).json({ message: conflict ? 'Hồ sơ vừa thay đổi hoặc đã có quy trình bàn giao khác. Hãy tải lại.' : error.statusCode ? error.message : 'Không thể xử lý bàn giao nhân sự.' });
  }
};
const versionOf = (item, version) => { if (!Number.isInteger(version) || version !== item.__v) throw fail('Hồ sơ vừa thay đổi. Hãy tải lại.', 409); };
const same = (a, b) => String(a || '') === String(b || '');
const manager = (role) => ['admin', 'principal', 'hr'].includes(role);
const checkSource = (actor, source) => {
  if (same(actor._id, source.userId?._id || source.userId)) throw fail('Không thể tạo quy trình cho chính mình', 403);
  if (actor.role !== 'admin' && source.userId?.role === 'admin') throw fail('Chỉ quản trị viên được xử lý bàn giao tài khoản quản trị', 403);
  if (actor.role === 'hr' && ['admin', 'principal'].includes(source.userId?.role)) throw fail('HR không được kết thúc việc làm của ban giám hiệu', 403);
};
const activeEmployee = async (id, session) => {
  checkId(id);
  const employee = await Employee.findOne({ _id: id, status: { $in: ['active', 'on_leave'] }, userId: { $ne: null } }).populate('userId', 'role status').session(session);
  if (!employee || employee.userId?.status !== 'active') throw fail('Cần hồ sơ nhân viên và tài khoản đang hoạt động');
  return employee;
};
const assignments = async (employee, session) => {
  const userId = employee.userId._id;
  const [classrooms, shifts, assets] = await Promise.all([
    Classroom.find({ status: 'active', $or: [{ homeroomTeacherId: userId }, { 'teachers.teacherId': userId }] }).select('name').session(session),
    StaffShift.find({ employeeId: employee._id, status: 'active', validUntil: { $gte: getWorkDate() } }).select('name startTime endTime').session(session),
    Asset.find({ assignedTo: userId, status: { $in: ['active', 'maintenance'] } }).select('name serialNumber qrCode').session(session)
  ]);
  return { classrooms, shifts, assets };
};
const snapshotItems = ({ classrooms, shifts, assets }) => [
  ...classrooms.map((item) => ({ kind: 'classroom', title: `Lớp ${item.name}`, referenceId: item._id, details: 'Chuyển phân công lớp cho giáo viên khác trước khi kết thúc.' })),
  ...shifts.map((item) => ({ kind: 'shift', title: `Ca ${item.name} ${item.startTime}–${item.endTime}`, referenceId: item._id, details: 'Kết thúc ca cũ và phân công ca mới.' })),
  ...assets.map((item) => ({ kind: 'asset', title: item.name, referenceId: item._id, details: item.serialNumber || item.qrCode || '' })),
  { kind: 'keys', title: 'Chìa khóa, thẻ ra vào và phương tiện truy cập', details: 'Ghi rõ từng vật; nếu không có, hai bên xác nhận không có.' },
  { kind: 'open_work', title: 'Công việc còn mở và hồ sơ cần tiếp tục', details: 'Ghi rõ việc, hạn xử lý và người tiếp nhận; nếu không có, hai bên xác nhận không có.' }
];

const overview = handle(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  if (!Number.isInteger(page)) throw fail('Số trang không hợp lệ');
  const [plans, total, employees] = await Promise.all([
    Handover.find().sort({ createdAt: -1 }).skip((page - 1) * 10).limit(10)
      .populate('employeeId', 'fullName employeeCode position userId status')
      .populate('receiverEmployeeId', 'fullName employeeCode position userId').lean(),
    Handover.countDocuments(),
    Employee.find({ status: { $in: ['active', 'on_leave'] }, userId: { $ne: null } }).populate('userId', 'role status').select('fullName employeeCode position status userId').sort({ fullName: 1 }).lean()
  ]);
  res.json({ data: { plans, employees: employees.filter((employee) => employee.userId?.status === 'active'), pagination: { page, total, totalPages: Math.max(1, Math.ceil(total / 10)) } } });
});
const myHandovers = handle(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  if (!Number.isInteger(page)) throw fail('Số trang không hợp lệ');
  const employee = await Employee.findOne({ userId: req.user._id }).select('_id').lean();
  if (!employee) return res.json({ data: { plans: [], pagination: { page, total: 0, totalPages: 1 } } });
  const filter = { status: { $in: ['draft', 'scheduled', 'completed'] }, $or: [{ employeeId: employee._id }, { receiverEmployeeId: employee._id }] };
  const [plans, total] = await Promise.all([
    Handover.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 10).limit(10).populate('employeeId', 'fullName employeeCode').populate('receiverEmployeeId', 'fullName employeeCode').lean(),
    Handover.countDocuments(filter)
  ]);
  res.json({ data: { plans, selfEmployeeId: employee._id, pagination: { page, total, totalPages: Math.max(1, Math.ceil(total / 10)) } } });
});
const create = handle(async (req, res) => {
  if (!['transfer', 'resignation'].includes(req.body.kind)) throw fail('Loại bàn giao không hợp lệ');
  const effectiveAt = new Date(req.body.effectiveAt);
  if (!Number.isFinite(effectiveAt.getTime()) || effectiveAt <= new Date()) throw fail('Thời điểm hiệu lực phải ở tương lai');
  const reason = text(req.body.reason, 500, 'Lý do bàn giao', true);
  const data = await inTransaction(async (session) => {
    const source = await activeEmployee(req.body.employeeId, session);
    const receiver = await activeEmployee(req.body.receiverEmployeeId, session);
    if (receiver.status !== 'active') throw fail('Người nhận cần đang làm việc, không trong thời gian nghỉ');
    if (same(source._id, receiver._id)) throw fail('Người nhận phải khác người bàn giao');
    checkSource(req.user, source);
    if (await Handover.exists({ employeeId: source._id, status: { $in: ['draft', 'scheduled'] } }).session(session)) throw fail('Nhân viên đã có quy trình bàn giao chưa kết thúc', 409);
    const current = await assignments(source, session);
    const [plan] = await Handover.create([{ employeeId: source._id, receiverEmployeeId: receiver._id, kind: req.body.kind, reason, effectiveAt, items: snapshotItems(current), createdBy: req.user._id }], { session });
    await audit(req.user, 'STAFF_HANDOVER_CREATED', 'StaffHandover', plan._id, {}, { employeeId: source._id, receiverEmployeeId: receiver._id, kind: plan.kind, effectiveAt, itemCount: plan.items.length }, session, reason);
    return plan;
  });
  res.json({ message: 'Đã tạo danh sách bàn giao', data });
});
const addItem = handle(async (req, res) => {
  checkId(req.params.id);
  if (!['keys', 'open_work'].includes(req.body.kind)) throw fail('Chỉ thêm chìa khóa hoặc công việc còn mở');
  const title = text(req.body.title, 180, 'Tên việc bàn giao', true);
  const details = text(req.body.details, 1000, 'Nội dung bàn giao', true);
  const data = await inTransaction(async (session) => {
    const plan = await Handover.findById(req.params.id).session(session);
    if (!plan) throw fail('Không tìm thấy quy trình bàn giao', 404);
    versionOf(plan, req.body.version);
    if (plan.status !== 'draft') throw fail('Quy trình đã được lên lịch', 409);
    plan.items.push({ kind: req.body.kind, title, details }); await plan.save({ session });
    await audit(req.user, 'STAFF_HANDOVER_UPDATED', 'StaffHandover', plan._id, {}, { kind: req.body.kind, title, details }, session);
    return plan;
  });
  res.json({ message: 'Đã thêm mục bàn giao', data });
});
const acknowledge = handle(async (req, res) => {
  checkId(req.params.id); checkId(req.params.itemId);
  const note = text(req.body.note, 500, 'Nội dung xác nhận', true);
  const data = await inTransaction(async (session) => {
    const plan = await Handover.findById(req.params.id).populate('employeeId', 'userId').populate('receiverEmployeeId', 'userId').session(session);
    if (!plan) throw fail('Không tìm thấy quy trình bàn giao', 404);
    versionOf(plan, req.body.version);
    if (plan.status !== 'draft') throw fail('Quy trình đã được lên lịch, không thể sửa xác nhận', 409);
    const item = plan.items.id(req.params.itemId);
    if (!item) throw fail('Không tìm thấy mục bàn giao', 404);
    const sender = same(plan.employeeId?.userId, req.user._id);
    const receiver = same(plan.receiverEmployeeId?.userId, req.user._id);
    if (!sender && !receiver) throw fail('Bạn không tham gia quy trình bàn giao này', 403);
    if (sender) {
      if (item.handedAt) throw fail('Bạn đã xác nhận giao mục này', 409);
      item.handedAt = new Date();
      item.handedNote = note;
    } else {
      if (!item.handedAt) throw fail('Người giao cần xác nhận trước');
      if (item.receivedAt) throw fail('Bạn đã xác nhận nhận mục này', 409);
      item.receivedAt = new Date();
      item.receivedNote = note;
    }
    await plan.save({ session });
    await audit(req.user, 'STAFF_HANDOVER_ITEM_ACKNOWLEDGED', 'StaffHandover', plan._id, {}, { itemId: item._id, kind: item.kind, party: sender ? 'sender' : 'receiver', note }, session);
    return plan;
  });
  res.json({ message: 'Đã ghi nhận xác nhận bàn giao', data });
});
const validateReady = async (plan, session) => {
  if (plan.items.some((item) => !item.handedAt || !item.receivedAt)) throw fail('Cần người giao và người nhận xác nhận toàn bộ mục bàn giao');
  const source = await activeEmployee(plan.employeeId, session);
  const receiver = await activeEmployee(plan.receiverEmployeeId, session);
  if (receiver.status !== 'active') throw fail('Người nhận đang nghỉ, chưa thể hẹn bàn giao');
  const current = await assignments(source, session);
  if (current.classrooms.length) throw fail(`Giáo viên vẫn phụ trách lớp ${current.classrooms.map((room) => room.name).join(', ')}. Hãy chuyển phân công trước.`, 409);
  const effectiveDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(plan.effectiveAt);
  if (current.shifts.some((shift) => shift.validUntil >= effectiveDay)) throw fail('Còn ca làm có hiệu lực tại thời điểm bàn giao. Hãy kết thúc ca hoặc điều chỉnh phân công.', 409);
  const assetIds = new Set(plan.items.filter((item) => item.kind === 'asset').map((item) => String(item.referenceId)));
  if (current.assets.some((asset) => !assetIds.has(String(asset._id)))) throw fail('Có tài sản mới được giao sau khi lập danh sách. Cần tạo lại quy trình bàn giao.', 409);
  for (const item of plan.items.filter((entry) => entry.kind === 'asset')) {
    const asset = await Asset.findById(item.referenceId).session(session);
    if (!asset || !same(asset.assignedTo, source.userId._id)) throw fail(`Tài sản ${item.title} đã đổi người giữ. Hãy đối chiếu lại trước khi lên lịch.`, 409);
  }
  return { source, receiver };
};
const schedule = handle(async (req, res) => {
  checkId(req.params.id);
  const data = await inTransaction(async (session) => {
    const plan = await Handover.findById(req.params.id).session(session);
    if (!plan) throw fail('Không tìm thấy quy trình bàn giao', 404);
    versionOf(plan, req.body.version);
    if (plan.status !== 'draft' || plan.effectiveAt <= new Date()) throw fail('Quy trình đã xử lý hoặc thời điểm hiệu lực đã qua', 409);
    const { source, receiver } = await validateReady(plan, session);
    if (plan.kind === 'resignation') {
      checkSource(req.user, source);
      const account = await User.findById(source.userId._id).session(session);
      account.accessEndsAt = plan.effectiveAt;
      await account.save({ session });
    }
    for (const item of plan.items.filter((entry) => entry.kind === 'asset')) {
      const moved = await Asset.updateOne({ _id: item.referenceId, assignedTo: source.userId._id }, { $set: { assignedTo: receiver.userId._id, assignedToName: receiver.fullName } }, { session });
      if (moved.matchedCount !== 1) throw fail('Tài sản vừa đổi người giữ. Hãy tải lại trước khi lên lịch.', 409);
    }
    plan.set({ status: 'scheduled', scheduledBy: req.user._id, scheduledAt: new Date() }); await plan.save({ session });
    await audit(req.user, 'STAFF_HANDOVER_SCHEDULED', 'StaffHandover', plan._id, { status: 'draft' }, { status: 'scheduled', effectiveAt: plan.effectiveAt, accessEndsAt: plan.kind === 'resignation' ? plan.effectiveAt : null }, session);
    return plan;
  });
  res.json({ message: 'Đã lên lịch hoàn tất bàn giao', data });
});
const cancel = handle(async (req, res) => {
  checkId(req.params.id); const reason = text(req.body.reason, 500, 'Lý do hủy', true);
  const data = await inTransaction(async (session) => {
    const plan = await Handover.findById(req.params.id).session(session);
    if (!plan) throw fail('Không tìm thấy quy trình bàn giao', 404);
    versionOf(plan, req.body.version);
    if (!['draft', 'scheduled'].includes(plan.status) || plan.effectiveAt <= new Date()) throw fail('Không thể hủy quy trình đã có hiệu lực', 409);
    if (plan.status === 'scheduled') {
      const source = await Employee.findById(plan.employeeId).session(session);
      const receiver = await Employee.findById(plan.receiverEmployeeId).session(session);
      if (source?.userId && receiver?.userId) {
        for (const item of plan.items.filter((entry) => entry.kind === 'asset')) {
          const asset = await Asset.findById(item.referenceId).session(session);
          if (!asset || !same(asset.assignedTo, receiver.userId)) throw fail('Tài sản đã tiếp tục chuyển cho người khác. Cần xử lý thủ công trước khi hủy lịch.', 409);
          const reverted = await Asset.updateOne({ _id: item.referenceId, assignedTo: receiver.userId }, { $set: { assignedTo: source.userId, assignedToName: source.fullName } }, { session });
          if (reverted.matchedCount !== 1) throw fail('Tài sản vừa đổi người giữ. Hãy tải lại trước khi hủy lịch.', 409);
        }
      }
      if (plan.kind === 'resignation' && source?.userId) await User.updateOne({ _id: source.userId, accessEndsAt: plan.effectiveAt }, { $set: { accessEndsAt: null } }, { session });
    }
    const oldStatus = plan.status;
    plan.set({ status: 'cancelled', cancelledBy: req.user._id, cancelledAt: new Date(), cancelReason: reason }); await plan.save({ session });
    await audit(req.user, 'STAFF_HANDOVER_CANCELLED', 'StaffHandover', plan._id, { status: oldStatus }, { status: 'cancelled', reason }, session, reason);
    return plan;
  });
  res.json({ message: 'Đã hủy quy trình bàn giao', data });
});
module.exports = { overview, myHandovers, create, addItem, acknowledge, schedule, cancel };
