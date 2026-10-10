const Employee = require('../models/zone2_hr/Employee');
const StaffShift = require('../models/zone2_hr/StaffShift');
const AttendanceRecord = require('../models/zone2_hr/AttendanceRecord');
const Payroll = require('../models/zone2_hr/Payroll');
const OvertimeRequest = require('../models/zone2_hr/OvertimeRequest');
const OvertimeRate = require('../models/zone2_hr/OvertimeRate');
const AttendanceAuditLog = require('../models/zone2_hr/AttendanceAuditLog');
const { withTransaction } = require('../services/attendanceAdjustmentService');
const { createDateTime, getWorkDate, isValidWorkDate, startOfWorkDate } = require('../utils/dateHelpers');

const fail = (res, error) => res.status(error?.code === 11000 ? 409 : error.statusCode || 500).json({ message: error?.code === 11000 ? 'Ngày này đã có yêu cầu làm thêm' : error.statusCode ? error.message : 'Không thể xử lý yêu cầu làm thêm' });
const problem = (message, statusCode = 422) => Object.assign(new Error(message), { statusCode });

const evidence = async (employee, workDate) => {
  const record = await AttendanceRecord.findOne({ userId: employee.userId, workDate: startOfWorkDate(workDate) });
  if (!record?.checkInTime || !record?.checkOutTime || !record.finalized || record.needsRecalculation) throw problem('Cần có đủ giờ vào/ra và bảng công đã tổng hợp trước khi xin làm thêm', 409);
  const weekday = new Date(`${workDate}T00:00:00.000Z`).getUTCDay();
  const shifts = await StaffShift.find({ employeeId: employee._id, status: 'active', validFrom: { $lte: workDate }, validUntil: { $gte: workDate }, weekdays: weekday });
  if (shifts.length !== 1) throw problem('Chưa có đúng một ca hợp lệ cho ngày này; HR cần kiểm tra lịch phân công', 409);
  const shift = shifts[0];
  const endDate = shift.endTime <= shift.startTime ? new Date(Date.parse(`${workDate}T00:00:00.000Z`) + 86400000).toISOString().slice(0, 10) : workDate;
  const scheduledEnd = createDateTime(endDate, shift.endTime);
  const minutes = Math.max(0, Math.floor((record.checkOutTime - scheduledEnd) / 60000));
  if (!minutes) throw problem('Giờ ra ca không muộn hơn giờ kết thúc ca được phân', 409);
  return { minutes, record };
};

const ensureOpenPayroll = async (employeeId, workDate) => {
  const [year, month] = workDate.split('-').map(Number);
  if (await Payroll.exists({ employeeId, month, year, status: { $in: ['confirmed', 'paid'] } })) {
    throw problem('Bảng lương kỳ này đã xác nhận/chi trả. Không thể thay đổi giờ làm thêm của kỳ đã chốt.', 409);
  }
};

const createOvertime = async (req, res) => {
  try {
    const workDate = String(req.body.workDate || '');
    const requestedMinutes = Number(req.body.requestedMinutes);
    const reason = String(req.body.reason || '').trim();
    if (!isValidWorkDate(workDate) || workDate > getWorkDate()) throw problem('Ngày làm thêm không hợp lệ hoặc nằm trong tương lai');
    if (!Number.isInteger(requestedMinutes) || requestedMinutes < 1 || requestedMinutes > 720) throw problem('Số phút đề nghị phải từ 1 đến 720');
    if (reason.length < 5) throw problem('Vui lòng nhập lý do ít nhất 5 ký tự');
    const employee = await Employee.findOne({ userId: req.user._id, status: 'active' });
    if (!employee) throw problem('Tài khoản chưa liên kết hồ sơ nhân viên đang làm việc', 404);
    await ensureOpenPayroll(employee._id, workDate);
    const { minutes } = await evidence(employee, workDate);
    if (requestedMinutes > minutes) throw problem(`Theo lượt chấm công, tối đa chỉ có ${minutes} phút sau ca`);
    const request = await OvertimeRequest.create({ employeeId: employee._id, userId: req.user._id, workDate, requestedMinutes, reason });
    await AttendanceAuditLog.create({ actor: req.user._id, action: 'OVERTIME_REQUESTED', entity: 'OvertimeRequest', entityId: request._id, newValue: request.toObject(), reason, timestamp: new Date() });
    return res.status(201).json({ message: 'Đã gửi yêu cầu xác nhận làm thêm', data: request });
  } catch (error) { return fail(res, error); }
};

const myOvertime = async (req, res) => {
  try { return res.json({ data: await OvertimeRequest.find({ userId: req.user._id }).sort({ workDate: -1 }).limit(60).lean() }); }
  catch (error) { return fail(res, error); }
};

const listOvertime = async (req, res) => {
  try { return res.json({ data: await OvertimeRequest.find(req.query.status === 'pending' ? { status: 'pending' } : {}).populate('employeeId', 'fullName employeeCode payrollRole').populate('reviewedBy', 'username profile.fullName').sort({ createdAt: -1 }).limit(100).lean() }); }
  catch (error) { return fail(res, error); }
};

const reviewOvertime = async (req, res) => {
  try {
    const decision = String(req.body.decision || '');
    const reviewNote = String(req.body.reviewNote || '').trim();
    if (!['approved', 'rejected'].includes(decision)) throw problem('Quyết định không hợp lệ');
    if (decision === 'rejected' && reviewNote.length < 5) throw problem('Cần ghi lý do từ chối ít nhất 5 ký tự');
    const request = await OvertimeRequest.findById(req.params.id);
    if (!request) throw problem('Không tìm thấy yêu cầu', 404);
    if (request.status !== 'pending') throw problem('Yêu cầu đã được xử lý', 409);
    if (String(request.userId) === String(req.user._id)) throw problem('Không được tự duyệt làm thêm của mình', 403);
    await ensureOpenPayroll(request.employeeId, request.workDate);
    let approvedMinutes = 0;
    if (decision === 'approved') {
      const employee = await Employee.findById(request.employeeId);
      if (!employee || employee.status !== 'active') throw problem('Nhân viên không còn làm việc', 409);
      const { minutes } = await evidence(employee, request.workDate);
      approvedMinutes = Number(req.body.approvedMinutes ?? request.requestedMinutes);
      if (!Number.isInteger(approvedMinutes) || approvedMinutes < 1 || approvedMinutes > request.requestedMinutes || approvedMinutes > minutes) throw problem(`Số phút duyệt không được vượt yêu cầu hoặc ${minutes} phút chấm công thực tế`);
    }
    const updated = await withTransaction(async (session) => {
      const current = await OvertimeRequest.findOne({ _id: request._id, status: 'pending' }).session(session);
      if (!current) throw problem('Yêu cầu đã được người khác xử lý', 409);
      const oldValue = current.toObject();
      const result = await OvertimeRequest.findOneAndUpdate({ _id: current._id, status: 'pending' }, { $set: { status: decision, approvedMinutes, reviewedBy: req.user._id, reviewedAt: new Date(), reviewNote } }, { new: true, session });
      if (!result) throw problem('Yêu cầu đã được người khác xử lý', 409);
      await AttendanceAuditLog.create([{ actor: req.user._id, action: decision === 'approved' ? 'OVERTIME_APPROVED' : 'OVERTIME_REJECTED', entity: 'OvertimeRequest', entityId: result._id, oldValue, newValue: result.toObject(), reason: reviewNote, timestamp: new Date() }], { session });
      return result;
    });
    return res.json({ message: decision === 'approved' ? 'Đã duyệt giờ làm thêm' : 'Đã từ chối yêu cầu', data: updated });
  } catch (error) { return fail(res, error); }
};

const listRates = async (req, res) => {
  try {
    const month = Number(req.query.month);
    const year = Number(req.query.year);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) throw problem('Tháng/năm không hợp lệ');
    return res.json({ data: await OvertimeRate.find({ month, year }).populate('employeeId', 'fullName employeeCode payrollRole').sort({ 'employeeId.fullName': 1 }).lean() });
  } catch (error) { return fail(res, error); }
};

const setRate = async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.employeeId);
    if (!employee || employee.status === 'resigned') throw problem('Không tìm thấy nhân viên đang làm việc', 404);
    if (String(employee.userId) === String(req.user._id)) throw problem('HR không được tự đặt mức làm thêm cho mình', 403);
    const month = Number(req.body.month);
    const year = Number(req.body.year);
    const hourlyAmount = Number(req.body.hourlyAmount);
    const reason = String(req.body.reason || '').trim();
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) throw problem('Tháng/năm không hợp lệ');
    if (!Number.isSafeInteger(hourlyAmount) || hourlyAmount < 0 || hourlyAmount > 10000000) throw problem('Mức tiền/giờ phải là số nguyên từ 0 đến 10.000.000');
    if (reason.length < 5) throw problem('Vui lòng ghi căn cứ đặt mức tiền/giờ');
    if (await Payroll.exists({ employeeId: employee._id, month, year, status: { $in: ['confirmed', 'paid'] } })) throw problem('Kỳ lương đã chốt; không thể thay đổi đơn giá làm thêm', 409);
    const current = await OvertimeRate.findOne({ employeeId: employee._id, month, year });
    const updated = await OvertimeRate.findOneAndUpdate({ employeeId: employee._id, month, year }, { $set: { hourlyAmount, reason, updatedBy: req.user._id } }, { upsert: true, new: true, runValidators: true });
    await AttendanceAuditLog.create({ actor: req.user._id, action: 'OVERTIME_RATE_SET', entity: 'OvertimeRate', entityId: updated._id, oldValue: current?.toObject() || null, newValue: updated.toObject(), reason, timestamp: new Date() });
    return res.json({ message: 'Đã lưu mức làm thêm cho kỳ lương', data: updated });
  } catch (error) { return fail(res, error); }
};

module.exports = { createOvertime, myOvertime, listOvertime, reviewOvertime, listRates, setRate };
