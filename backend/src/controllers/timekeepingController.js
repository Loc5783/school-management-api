const AttendanceRecord = require('../models/zone2_hr/AttendanceRecord');
const RawAttendanceEvent = require('../models/zone2_hr/RawAttendanceEvent');
const TimekeepingCorrectionRequest = require('../models/zone2_hr/TimekeepingCorrectionRequest');
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
  getWorkDate,
  isValidWorkDate,
  startOfWorkDate
} = require('../utils/dateHelpers');

const sendError = (res, error) => {
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
    if (existing?.checkInTime) {
      return res.status(200).json({
        message: 'Bạn đã chấm công hôm nay',
        alreadyCheckedIn: true,
        data: existing
      });
    }

    const record = await AttendanceRecord.findOneAndUpdate(
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
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
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
    const [records, corrections] = await Promise.all([
      AttendanceRecord.find({ userId: req.user._id }).sort({ workDate: -1 }).limit(31),
      TimekeepingCorrectionRequest.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(31)
    ]);
    return res.json({ message: 'Lấy dữ liệu chấm công thành công', data: { records, corrections } });
  } catch (error) {
    return sendError(res, error);
  }
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
    const result = await kioskCheckInByIdentifier(req.user, req.body.identifier);
    return res.status(result.duplicate ? 200 : 201).json({
      message: result.duplicate
        ? `${result.employee.name} đã chấm công hôm nay`
        : `Đã ghi nhận check-in cho ${result.employee.name}`,
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
