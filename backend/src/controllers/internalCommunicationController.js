const mongoose = require('mongoose');
const Announcement = require('../models/zone2_hr/InternalAnnouncement');
const Timesheet = require('../models/zone2_hr/MonthlyTimesheet');
const Employee = require('../models/zone2_hr/Employee');
const Notification = require('../models/zone1_system/Notification');
const AttendanceRecord = require('../models/zone2_hr/AttendanceRecord');
const Correction = require('../models/zone2_hr/TimekeepingCorrectionRequest');
const { getWorkDate, startOfWorkDate } = require('../utils/dateHelpers');
const { fail, checkId, text, inTransaction, audit } = require('../services/credentialService');
const { createTimesheetFeedback } = require('../services/staffPersonalRequestService');

const handle = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (error) {
    const conflict = error.code === 11000 || error.code === 112 || error instanceof mongoose.Error.VersionError;
    res.status(conflict ? 409 : error.statusCode || 500).json({ message: conflict ? 'Thông tin đã tồn tại hoặc vừa thay đổi. Hãy tải lại.' : error.statusCode ? error.message : 'Không thể xử lý thông báo nội bộ.' });
  }
};
const periodBounds = (period) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period || '') || period >= getWorkDate().slice(0, 7)) throw fail('Chỉ lập bảng công cho tháng đã kết thúc (YYYY-MM)');
  const [year, month] = period.split('-').map(Number);
  const next = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  return { start: startOfWorkDate(`${period}-01`), end: startOfWorkDate(next) };
};
const versionOf = (item, version) => { if (!Number.isInteger(version) || version !== item.__v) throw fail('Dữ liệu đã thay đổi. Hãy tải lại.', 409); };
const periodOf = (date) => getWorkDate(date);

const overview = handle(async (req, res) => {
  const announcementPage = Math.max(1, Number(req.query.announcementPage) || 1);
  const timesheetPage = Math.max(1, Number(req.query.timesheetPage) || 1);
  if (!Number.isInteger(announcementPage) || !Number.isInteger(timesheetPage)) throw fail('Số trang không hợp lệ');
  const [announcements, announcementCount, timesheets, timesheetCount, employees] = await Promise.all([
    Announcement.find().sort({ createdAt: -1 }).skip((announcementPage - 1) * 10).limit(10).lean(), Announcement.countDocuments(),
    Timesheet.find().sort({ period: -1, createdAt: -1 }).skip((timesheetPage - 1) * 10).limit(10).populate('employeeId', 'fullName employeeCode position').lean(), Timesheet.countDocuments(),
    Employee.find({ status: { $in: ['active', 'on_leave'] }, userId: { $ne: null } }).populate('userId', 'role status').select('fullName employeeCode position userId').sort({ fullName: 1 }).lean()
  ]);
  res.json({ data: { announcements, timesheets, employees: employees.filter((employee) => employee.userId?.status === 'active'),
    announcementPagination: { page: announcementPage, total: announcementCount, totalPages: Math.max(1, Math.ceil(announcementCount / 10)) },
    timesheetPagination: { page: timesheetPage, total: timesheetCount, totalPages: Math.max(1, Math.ceil(timesheetCount / 10)) } } });
});
const sendAnnouncement = handle(async (req, res) => {
  if (!['shift', 'meeting', 'general', 'directive'].includes(req.body.category)) throw fail('Loại thông báo không hợp lệ');
  if (req.body.category === 'directive' && !['admin', 'principal'].includes(req.user.role)) {
    throw fail('Chỉ hiệu trưởng hoặc quản trị viên mới được gửi thông báo chỉ đạo', 403);
  }
  const priority = ['normal', 'high', 'urgent'].includes(req.body.priority) ? req.body.priority : 'normal';
  if (['high', 'urgent'].includes(priority) && !['admin', 'principal'].includes(req.user.role)) {
    throw fail('Chỉ hiệu trưởng hoặc quản trị viên mới được gửi thông báo mức độ khẩn cấp/cao', 403);
  }
  const title = text(req.body.title, 160, 'Tiêu đề', true);
  const message = text(req.body.message, 2000, 'Nội dung', true);
  const requestId = text(req.body.requestId, 100, 'Mã lần gửi', true);
  const location = text(req.body.location || '', 160, 'Địa điểm');
  const eventAt = req.body.eventAt ? new Date(req.body.eventAt) : null;
  if (eventAt && (!Number.isFinite(eventAt.getTime()) || eventAt <= new Date())) throw fail('Thời điểm họp/ca phải ở tương lai');
  if (['meeting', 'shift'].includes(req.body.category) && !eventAt) throw fail('Cần nhập thời gian họp hoặc ca làm');
  const employeeIds = Array.isArray(req.body.employeeIds) ? [...new Set(req.body.employeeIds)] : [];
  const roles = Array.isArray(req.body.roles) ? [...new Set(req.body.roles)] : [];
  const allowedRoles = ['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard', 'hr'];
  if (employeeIds.some((id) => !mongoose.isValidObjectId(id)) || roles.some((role) => !allowedRoles.includes(role)) || (!employeeIds.length && !roles.length)) throw fail('Cần chọn nhân viên hoặc vai trò nhận thông báo');
  const data = await inTransaction(async (session) => {
    const employees = await Employee.find({ status: { $in: ['active', 'on_leave'] }, userId: { $ne: null } }).populate('userId', 'role status').select('userId').session(session);
    const selected = employees.filter((employee) => employee.userId?.status === 'active' && (employeeIds.includes(String(employee._id)) || roles.includes(employee.userId.role)));
    if (!selected.length || selected.length > 1000 || employeeIds.some((id) => !selected.some((employee) => String(employee._id) === id))) throw fail('Danh sách người nhận không hợp lệ hoặc vượt 1.000 người');
    const recipientIds = [...new Set(selected.map((employee) => String(employee.userId._id)))];
    const [announcement] = await Announcement.create([{ category: req.body.category, title, message, priority, targetRoles: roles, eventAt, location, recipientIds, requestId, createdBy: req.user._id }], { session });
    await Notification.insertMany(recipientIds.map((recipientId) => ({ recipientId, title: `${priority === 'urgent' ? '[KHẨN] ' : priority === 'high' ? '[QUAN TRỌNG] ' : ''}${title}`, message: `${message}${eventAt ? ` · ${eventAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false })}` : ''}${location ? ` · ${location}` : ''}`, type: priority === 'urgent' ? 'warning' : 'info', link: '/internal-notices', createdBy: req.user._id, metadata: { announcementId: announcement._id, category: announcement.category, priority } })), { session });
    await audit(req.user, 'INTERNAL_ANNOUNCEMENT_SENT', 'InternalAnnouncement', announcement._id, {}, { category: announcement.category, priority, recipientCount: recipientIds.length, eventAt }, session);
    return { announcement, recipientCount: recipientIds.length };
  });
  res.json({ message: `Đã gửi thông báo tới ${data.recipientCount} nhân viên`, data });
});
const myAnnouncements = handle(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  if (!Number.isInteger(page)) throw fail('Số trang không hợp lệ');
  const filter = { recipientIds: req.user._id };
  const [rows, total] = await Promise.all([Announcement.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 10).limit(10).lean(), Announcement.countDocuments(filter)]);
  res.json({ data: rows, pagination: { page, total, totalPages: Math.max(1, Math.ceil(total / 10)) } });
});
const publishTimesheet = handle(async (req, res) => {
  checkId(req.body.employeeId);
  const period = req.body.period;
  const { start, end } = periodBounds(period);
  const data = await inTransaction(async (session) => {
    const employee = await Employee.findOne({ _id: req.body.employeeId, status: { $in: ['active', 'on_leave'] }, userId: { $ne: null } }).populate('userId', 'status role').session(session);
    if (!employee || employee.userId?.status !== 'active') throw fail('Nhân viên chưa có tài khoản đang hoạt động');
    const pendingCorrection = await Correction.exists({ userId: employee.userId._id, workDate: { $gte: start, $lt: end }, status: { $in: ['DRAFT', 'PENDING'] } }).session(session);
    if (pendingCorrection) throw fail('Còn đơn điều chỉnh công chưa xử lý trong tháng. Hãy xử lý trước khi gửi bảng công.', 409);
    const records = await AttendanceRecord.find({ userId: employee.userId._id, workDate: { $gte: start, $lt: end } }).sort({ workDate: 1 }).session(session);
    if (!records.length) throw fail('Tháng này chưa có ngày công được ghi nhận; chưa thể gửi bảng công để xác nhận.', 409);
    if (records.some((record) => !record.finalized || record.needsRecalculation || record.status === 'incomplete' || !record.checkInTime || !record.checkOutTime)) throw fail('Còn bản ghi chấm công chưa chốt hoặc thiếu lượt. Hãy xử lý trước khi gửi bảng công.', 409);
    const days = records.map((record) => ({ workDate: periodOf(record.workDate), checkInTime: record.checkInTime, checkOutTime: record.checkOutTime, workday: record.workday ?? 1, status: record.status }));
    const totalWorkdays = days.reduce((sum, day) => sum + (day.status === 'present' ? day.workday : 0), 0);
    let sheet = await Timesheet.findOne({ employeeId: employee._id, period }).session(session);
    if (sheet && sheet.status !== 'disputed') throw fail('Bảng công đã gửi; chỉ gửi lại khi nhân viên có phản hồi cần chỉnh sửa', 409);
    const previous = sheet ? { status: sheet.status, revision: sheet.revision, totalWorkdays: sheet.totalWorkdays } : {};
    if (sheet) { sheet.set({ days, totalWorkdays, status: 'pending', employeeNote: '', respondedAt: null, publishedBy: req.user._id, publishedAt: new Date(), revision: sheet.revision + 1 }); await sheet.save({ session }); }
    else [sheet] = await Timesheet.create([{ employeeId: employee._id, userId: employee.userId._id, period, days, totalWorkdays, publishedBy: req.user._id }], { session });
    await Notification.create([{ recipientId: employee.userId._id, title: `Bảng công ${period} cần xác nhận`, message: `HR đã gửi bảng công tháng ${period}: ${totalWorkdays} công. Vui lòng kiểm tra từng ngày và xác nhận hoặc phản hồi.`, type: 'attendance', link: '/internal-notices?tab=timesheets', createdBy: req.user._id, metadata: { timesheetId: sheet._id, revision: sheet.revision } }], { session });
    await audit(req.user, 'MONTHLY_TIMESHEET_PUBLISHED', 'MonthlyTimesheet', sheet._id, previous, { status: sheet.status, revision: sheet.revision, totalWorkdays }, session);
    return sheet;
  });
  res.json({ message: 'Đã gửi bảng công cho nhân viên xác nhận', data });
});
const myTimesheets = handle(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  if (!Number.isInteger(page)) throw fail('Số trang không hợp lệ');
  const filter = { userId: req.user._id };
  const [rows, total] = await Promise.all([Timesheet.find(filter).sort({ period: -1 }).skip((page - 1) * 10).limit(10).lean(), Timesheet.countDocuments(filter)]);
  res.json({ data: rows, pagination: { page, total, totalPages: Math.max(1, Math.ceil(total / 10)) } });
});
const respondTimesheet = handle(async (req, res) => {
  checkId(req.params.id);
  if (!['confirmed', 'disputed'].includes(req.body.status)) throw fail('Trạng thái xác nhận không hợp lệ');
  const note = text(req.body.note || '', 1000, 'Phản hồi bảng công', req.body.status === 'disputed');
  const data = await inTransaction(async (session) => {
    const sheet = await Timesheet.findOne({ _id: req.params.id, userId: req.user._id }).session(session);
    if (!sheet) throw fail('Không tìm thấy bảng công của bạn', 404);
    versionOf(sheet, req.body.version);
    if (sheet.status !== 'pending') throw fail('Bảng công đã được phản hồi', 409);
    const previous = { status: sheet.status, note: sheet.employeeNote, respondedAt: sheet.respondedAt };
    sheet.set({ status: req.body.status, employeeNote: note, respondedAt: new Date() }); await sheet.save({ session });
    await audit(req.user, 'MONTHLY_TIMESHEET_RESPONDED', 'MonthlyTimesheet', sheet._id, { status: 'pending' }, { status: sheet.status, note }, session);
    if (sheet.status === 'disputed') {
      await createTimesheetFeedback({ sheet, user: req.user, note, previous }, session);
    }
    return sheet;
  });
  res.json({ message: req.body.status === 'confirmed' ? 'Đã xác nhận bảng công' : 'Đã gửi phản hồi tới HR', data });
});

const getAnnouncementReceipts = handle(async (req, res) => {
  if (!['admin', 'principal', 'hr'].includes(req.user.role)) {
    throw fail('Bạn không có quyền xem biên nhận thông báo', 403);
  }
  checkId(req.params.id);
  const announcement = await Announcement.findById(req.params.id)
    .populate('createdBy', 'username role profile.fullName')
    .lean();
  if (!announcement) throw fail('Không tìm thấy thông báo', 404);

  const notifications = await Notification.find({ 'metadata.announcementId': announcement._id })
    .populate('recipientId', 'username role profile.fullName')
    .lean();

  const total = notifications.length;
  const readCount = notifications.filter((n) => n.isRead).length;
  const unreadCount = total - readCount;
  const readPercent = total > 0 ? Math.round((readCount / total) * 100) : 0;

  const recipients = notifications.map((n) => ({
    userId: n.recipientId?._id,
    fullName: n.recipientId?.profile?.fullName || n.recipientId?.username || 'Chưa rõ',
    role: n.recipientId?.role || '',
    isRead: Boolean(n.isRead),
    readAt: n.readAt || null
  })).sort((a, b) => (b.isRead ? 1 : 0) - (a.isRead ? 1 : 0) || a.fullName.localeCompare(b.fullName));

  res.json({
    data: {
      announcement,
      total,
      readCount,
      unreadCount,
      readPercent,
      recipients
    }
  });
});

module.exports = { overview, sendAnnouncement, myAnnouncements, publishTimesheet, myTimesheets, respondTimesheet, getAnnouncementReceipts };
