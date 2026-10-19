const AttendanceRecord = require('../models/zone2_hr/AttendanceRecord');
const RawAttendanceEvent = require('../models/zone2_hr/RawAttendanceEvent');
const TimekeepingCorrectionRequest = require('../models/zone2_hr/TimekeepingCorrectionRequest');
const Employee = require('../models/zone2_hr/Employee');
const StaffShift = require('../models/zone2_hr/StaffShift');
const AttendanceAuditLog = require('../models/zone2_hr/AttendanceAuditLog');
const { inTransaction, fail } = require('../services/credentialService');
const { ingestDeviceEvent, kioskCheckInByIdentifier } = require('../services/attendanceDeviceService');
const { recalculateAttendanceForDate } = require('../services/attendanceCalculationService');
const {
  approveAdjustment,
  cancelAdjustment: cancelAdjustmentService,
  createAndSubmitLegacy,
  createDraft,
  employeeName,
  rejectAdjustment,
  submitDraft,
  TimekeepingError,
  updateDraft
} = require('../services/attendanceAdjustmentService');
const {
  DEFAULT_SCHOOL_TIMEZONE,
  createDateTime,
  getWorkDate,
  isValidWorkDate,
  startOfWorkDate
} = require('../utils/dateHelpers');

const sendError = (res, error) => {
  if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
  if (error instanceof TimekeepingError) {
    return res.status(error.statusCode).json({ message: error.message, code: error.code });
  }
  if (error?.code === 11000) {
    return res.status(409).json({
      message: 'Đã tồn tại phiếu điều chỉnh cùng loại cho ngày công này',
      code: 'DUPLICATE_ADJUSTMENT'
    });
  }
  console.error('Timekeeping error:', error);
  return res.status(500).json({ message: 'Không thể xử lý yêu cầu chấm công lúc này' });
};

const manualCheckIn = async (req, res) => {
  try {
    const workDate = startOfWorkDate(getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE), DEFAULT_SCHOOL_TIMEZONE);
    const existing = await AttendanceRecord.findOne({ userId: req.user._id, workDate });
    if (existing?.finalized) return res.status(409).json({ message: 'Ngày công đã chốt, không thể ghi đè bằng chấm công thủ công. Vui lòng gửi phiếu điều chỉnh.' });
    if (existing?.checkInTime) {
      return res.status(200).json({
        message: 'Bạn đã chấm công hôm nay',
        alreadyCheckedIn: true,
        data: existing
      });
    }

    const record = await inTransaction(async (session) => {
    const before = await AttendanceRecord.findOne({ userId: req.user._id, workDate }).session(session);
    if (before?.finalized || before?.checkInTime) throw fail('Ngày công đã được ghi nhận hoặc chốt. Vui lòng tải lại.', 409);
    const saved = await AttendanceRecord.findOneAndUpdate(
      { userId: req.user._id, workDate },
      {
        $set: {
          employeeName: employeeName(req.user),
          checkInTime: new Date(),
          source: 'manual',
          checkInSource: 'manual',
          note: req.body.note?.trim() || '',
          timezone: DEFAULT_SCHOOL_TIMEZONE,
          finalized: false,
          needsRecalculation: true
        },
        $setOnInsert: { userId: req.user._id, workDate }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true, session }
    );
    await AttendanceAuditLog.create([{ actor: req.user._id, action: 'MANUAL_CHECK_IN', entity: 'AttendanceRecord', entityId: saved._id,
      oldValue: before?.toObject() || {}, newValue: saved.toObject() }], { session });
    return saved;
    });
    return res.status(201).json({ message: 'Chấm công thành công', alreadyCheckedIn: false, data: record });
  } catch (error) {
    return sendError(res, error);
  }
};

const createAdjustmentDraft = async (req, res) => {
  try {
    const document = await createDraft(req.user, req.body);
    return res.status(201).json({ message: 'Đã tạo phiếu nháp', data: document });
  } catch (error) {
    return sendError(res, error);
  }
};

const updateAdjustmentDraft = async (req, res) => {
  try {
    const document = await updateDraft(req.user, req.params.id, req.body);
    return res.json({ message: 'Đã cập nhật phiếu điều chỉnh', data: document });
  } catch (error) {
    return sendError(res, error);
  }
};

const submitAdjustmentDraft = async (req, res) => {
  try {
    const document = await submitDraft(req.user, req.params.id, req.body.version);
    return res.json({ message: 'Đã gửi phiếu chờ phê duyệt', data: document });
  } catch (error) {
    return sendError(res, error);
  }
};

const cancelAdjustment = async (req, res) => {
  try {
    const document = await cancelAdjustmentService(req.user, req.params.id, req.body.version, req.body.reason || '');
    return res.json({ message: 'Đã hủy phiếu điều chỉnh', data: document });
  } catch (error) {
    return sendError(res, error);
  }
};

// Compatibility endpoint for the existing client: create and submit at once.
const createCorrectionRequest = async (req, res) => {
  try {
    const document = await createAndSubmitLegacy(req.user, req.body);
    return res.status(201).json({
      message: 'Đã gửi đơn chấm công bù. Đơn đang chờ Admin/Principal phê duyệt.',
      data: document
    });
  } catch (error) {
    return sendError(res, error);
  }
};

const getMyTimekeeping = async (req, res) => {
  try {
    const [records, corrections, employee] = await Promise.all([
      AttendanceRecord.find({ userId: req.user._id }).sort({ workDate: -1 }).limit(31),
      TimekeepingCorrectionRequest.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(31),
      Employee.findOne({ userId: req.user._id }).select('_id payrollRole')
    ]);
    const firstDate = records.length ? getWorkDate(records.at(-1).workDate) : getWorkDate();
    const shifts = employee ? await StaffShift.find({ employeeId: employee._id, status: 'active', validUntil: { $gte: firstDate } }).lean() : [];
    const attendance = records.map((record) => {
      const date = getWorkDate(record.workDate);
      const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
      const shift = shifts.find((item) => item.validFrom <= date && item.validUntil >= date && item.weekdays.includes(weekday));
      if (!shift) return { ...record.toObject(), shift: null, lateMinutes: null, earlyLeaveMinutes: null, overtimeMinutes: null };
      const start = createDateTime(date, shift.startTime);
      const endDate = shift.endTime <= shift.startTime ? new Date(Date.parse(`${date}T00:00:00.000Z`) + 86400000).toISOString().slice(0, 10) : date;
      const end = createDateTime(endDate, shift.endTime);
      const diff = (left, right) => Math.max(0, Math.floor((left - right) / 60000));
      return { ...record.toObject(), shift: { name: shift.name, startTime: shift.startTime, endTime: shift.endTime },
        lateMinutes: record.checkInTime ? diff(record.checkInTime, start) : null,
        earlyLeaveMinutes: record.checkOutTime ? diff(end, record.checkOutTime) : null,
        overtimeMinutes: record.checkOutTime ? diff(record.checkOutTime, end) : null };
    });
    return res.json({ message: 'Lấy dữ liệu chấm công thành công', data: { records: attendance, corrections } });
  } catch (error) {
    return sendError(res, error);
  }
};

const getDailyTimekeeping = async (req, res) => {
  try {
    const date = String(req.query.date || getWorkDate());
    if (!isValidWorkDate(date)) return res.status(400).json({ message: 'Ngày công phải có định dạng YYYY-MM-DD' });
    const workDate = startOfWorkDate(date, DEFAULT_SCHOOL_TIMEZONE);
    const [employees, shifts, records] = await Promise.all([
      Employee.find({ status: { $ne: 'resigned' }, userId: { $exists: true, $ne: null } }).select('fullName employeeCode payrollRole userId').lean(),
      StaffShift.find({ status: 'active', validFrom: { $lte: date }, validUntil: { $gte: date } }).lean(),
      AttendanceRecord.find({ workDate }).lean()
    ]);
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    const recordsByUser = new Map(records.map((record) => [String(record.userId), record]));
    const data = employees.flatMap((employee) => {
      const assigned = shifts.filter((shift) => String(shift.employeeId) === String(employee._id) && shift.weekdays.includes(weekday));
      const record = recordsByUser.get(String(employee.userId));
      if (!record && !assigned.length) return [];
      if (!assigned.length) return [{ employeeId: employee._id, employeeName: employee.fullName, employeeCode: employee.employeeCode, role: employee.payrollRole, shift: null, record: record || null, lateMinutes: null, earlyLeaveMinutes: null, overtimeMinutes: null, missing: !record?.checkInTime || !record?.checkOutTime }];
      return assigned.map((shift) => {
        const start = createDateTime(date, shift.startTime);
        const endDate = shift.endTime <= shift.startTime ? new Date(Date.parse(`${date}T00:00:00.000Z`) + 86400000).toISOString().slice(0, 10) : date;
        const end = createDateTime(endDate, shift.endTime);
        const diff = (left, right) => Math.max(0, Math.floor((left - right) / 60000));
        return { employeeId: employee._id, employeeName: employee.fullName, employeeCode: employee.employeeCode, role: employee.payrollRole,
          shift: { name: shift.name, startTime: shift.startTime, endTime: shift.endTime }, record: record || null,
          lateMinutes: record?.checkInTime ? diff(record.checkInTime, start) : null,
          earlyLeaveMinutes: record?.checkOutTime ? diff(end, record.checkOutTime) : null,
          overtimeMinutes: record?.checkOutTime ? diff(record.checkOutTime, end) : null,
          missing: !record?.checkInTime || !record?.checkOutTime };
      });
    });
    return res.json({ data: { date, rows: data } });
  } catch (error) { return sendError(res, error); }
};

const listMyAdjustments = async (req, res) => {
  try {
    const documents = await TimekeepingCorrectionRequest.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(req.query.limit) || 50, 100));
    return res.json({ data: documents });
  } catch (error) {
    return sendError(res, error);
  }
};

const getMyAdjustment = async (req, res) => {
  try {
    const document = await TimekeepingCorrectionRequest.findOne({ _id: req.params.id, userId: req.user._id });
    if (!document) return res.status(404).json({ message: 'Không tìm thấy phiếu điều chỉnh' });
    return res.json({ data: document });
  } catch (error) {
    return sendError(res, error);
  }
};

const getPendingCorrectionRequests = async (req, res) => {
  try {
    const requests = await TimekeepingCorrectionRequest.find({ status: 'PENDING' })
      .populate('userId', 'username profile role')
      .sort({ submittedAt: 1 });
    return res.json({ message: 'Lấy danh sách đơn chờ duyệt thành công', data: requests });
  } catch (error) {
    return sendError(res, error);
  }
};

const approveCorrectionRequest = async (req, res) => {
  try {
    const document = await approveAdjustment(req.user, req.params.id, req.body.version, req.body.reviewNote || '');
    return res.json({ message: 'Đã phê duyệt đơn và đưa vào hàng đợi tính lại', data: document });
  } catch (error) {
    return sendError(res, error);
  }
};

const rejectCorrectionRequest = async (req, res) => {
  try {
    const document = await rejectAdjustment(req.user, req.params.id, req.body.version, req.body.reason || req.body.reviewNote);
    return res.json({ message: 'Đã từ chối đơn chấm công bù', data: document });
  } catch (error) {
    return sendError(res, error);
  }
};

const recalculateAttendance = async (req, res) => {
  try {
    const records = await recalculateAttendanceForDate(req.params.date, req.user._id);
    return res.json({ message: 'Đã đưa dữ liệu vào tính lại', data: records });
  } catch (error) {
    return sendError(res, error);
  }
};

const receiveDeviceEvent = async (req, res) => {
  try {
    const result = await ingestDeviceEvent(req.body);
    return res.status(result.duplicate ? 200 : 201).json({
      message: result.duplicate ? 'Log máy đã được nhận trước đó' : 'Đã lưu log máy bất biến',
      duplicate: result.duplicate,
      data: result.event
    });
  } catch (error) {
    return sendError(res, error);
  }
};

const kioskCheckIn = async (req, res) => {
  try {
    if (req.body.action && !['check-in', 'check-out'].includes(req.body.action)) return res.status(400).json({ message: 'Loại chấm công không hợp lệ' });
    const eventType = req.body.action === 'check-out' ? 'CHECK_OUT' : 'CHECK_IN';
    const result = await kioskCheckInByIdentifier(req.user, req.body.identifier, eventType);
    return res.status(result.duplicate ? 200 : 201).json({
      message: result.duplicate
        ? `${result.employee.name} đã ghi nhận ${eventType === 'CHECK_OUT' ? 'giờ ra' : 'giờ vào'} hôm nay`
        : `Đã ghi nhận ${eventType === 'CHECK_OUT' ? 'giờ ra' : 'giờ vào'} cho ${result.employee.name}`,
      alreadyCheckedIn: result.duplicate,
      data: result
    });
  } catch (error) {
    return sendError(res, error);
  }
};

const getDeviceEvents = async (req, res) => {
  try {
    if (!req.query.userId || !req.query.workDate || !isValidWorkDate(req.query.workDate)) {
      return res.status(400).json({ message: 'Cần gửi userId và workDate theo định dạng YYYY-MM-DD' });
    }
    const workDate = startOfWorkDate(req.query.workDate, DEFAULT_SCHOOL_TIMEZONE);
    const events = await RawAttendanceEvent.find({ userId: req.query.userId, workDate })
      .sort({ occurredAt: 1 })
      .limit(Math.min(Number(req.query.limit) || 100, 500));
    return res.json({ data: events });
  } catch (error) {
    return sendError(res, error);
  }
};

module.exports = {
  approveCorrectionRequest,
  cancelAdjustment,
  createAdjustmentDraft,
  createCorrectionRequest,
  getDeviceEvents,
  getDailyTimekeeping,
  getMyAdjustment,
  getMyTimekeeping,
  getPendingCorrectionRequests,
  kioskCheckIn,
  listMyAdjustments,
  manualCheckIn,
  receiveDeviceEvent,
  recalculateAttendance,
  rejectCorrectionRequest,
  submitAdjustmentDraft,
  updateAdjustmentDraft
};
