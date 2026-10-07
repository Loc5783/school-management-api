const crypto = require('crypto');
const GuardDevice = require('../models/zone3_school/GuardDevice');
const GuardDeviceEvent = require('../models/zone3_school/GuardDeviceEvent');
const Student = require('../models/zone3_school/Student');
const PickupRecord = require('../models/zone3_school/PickupRecord');
const User = require('../models/zone1_system/User');
const Notification = require('../models/zone1_system/Notification');
const { isValidObjectId } = require('../utils/idValidation');
const { DEFAULT_SCHOOL_TIMEZONE, getWorkDate } = require('../utils/dateHelpers');

const currentDay = () => getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
const trim = (value, length) => String(value || '').trim().slice(0, length);
const tokenDigest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const errorResponse = (res, error) => res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Không thể xử lý dữ liệu thiết bị' });
const reject = (message, status = 400) => Object.assign(new Error(message), { status });
const deviceKinds = ['camera', 'plate_reader', 'face_reader', 'rfid_reader', 'gate_controller'];
const compatibleEvents = {
  camera: ['behavior'],
  plate_reader: ['plate'],
  face_reader: ['face'],
  rfid_reader: ['card'],
  gate_controller: ['gate_state']
};
const normalizePlate = (value) => trim(value, 20).toUpperCase().replace(/[\s.-]/g, '');
const safeSnapshot = (value) => {
  const url = trim(value, 1000);
  if (!url) return '';
  try { if (new URL(url).protocol === 'https:') return url; } catch { /* invalid URL */ }
  throw reject('Ảnh tham chiếu phải là liên kết HTTPS');
};

const listDevices = async (_req, res) => {
  try { return res.json({ success: true, data: await GuardDevice.find().sort({ createdAt: -1 }).lean() }); }
  catch (error) { return errorResponse(res, error); }
};

const createDevice = async (req, res) => {
  try {
    const { name, kind, location, snapshotUrl } = req.body || {};
    if (!trim(name, 121) || !trim(location, 161) || !deviceKinds.includes(kind)) throw reject('Cần tên, loại và vị trí thiết bị hợp lệ');
    const token = crypto.randomBytes(32).toString('hex');
    const device = await GuardDevice.create({ name: trim(name, 120), kind, location: trim(location, 160), snapshotUrl: safeSnapshot(snapshotUrl), tokenHash: tokenDigest(token), createdBy: req.user._id });
    return res.status(201).json({ success: true, data: { ...device.toObject(), tokenHash: undefined, accessToken: token }, message: 'Lưu khóa kết nối ngay; hệ thống chỉ hiển thị khóa này một lần' });
  } catch (error) { return errorResponse(res, error); }
};

const updateDevice = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) throw reject('ID thiết bị không hợp lệ');
    const update = {};
    if (req.body?.name !== undefined) { if (!trim(req.body.name, 121)) throw reject('Tên thiết bị không được trống'); update.name = trim(req.body.name, 120); }
    if (req.body?.location !== undefined) { if (!trim(req.body.location, 161)) throw reject('Vị trí không được trống'); update.location = trim(req.body.location, 160); }
    if (req.body?.snapshotUrl !== undefined) update.snapshotUrl = safeSnapshot(req.body.snapshotUrl);
    if (req.body?.enabled !== undefined) { if (typeof req.body.enabled !== 'boolean') throw reject('Trạng thái thiết bị không hợp lệ'); update.enabled = req.body.enabled; }
    const device = await GuardDevice.findByIdAndUpdate(req.params.id, { $set: update }, { returnDocument: 'after', runValidators: true });
    if (!device) throw reject('Không tìm thấy thiết bị', 404);
    return res.json({ success: true, data: device });
  } catch (error) { return errorResponse(res, error); }
};

const rotateDeviceToken = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) throw reject('ID thiết bị không hợp lệ');
    const token = crypto.randomBytes(32).toString('hex');
    const device = await GuardDevice.findByIdAndUpdate(req.params.id, { $set: { tokenHash: tokenDigest(token) } }, { returnDocument: 'after' });
    if (!device) throw reject('Không tìm thấy thiết bị', 404);
    return res.json({ success: true, message: 'Khóa cũ đã hết hiệu lực; lưu khóa mới ngay', data: { id: device._id, accessToken: token } });
  } catch (error) { return errorResponse(res, error); }
};

const listEvents = async (req, res) => {
  try {
    const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
    const filter = req.query.status && ['matched', 'review', 'alert', 'dismissed'].includes(req.query.status) ? { status: req.query.status } : {};
    const [total, data] = await Promise.all([GuardDeviceEvent.countDocuments(filter), GuardDeviceEvent.find(filter).populate('deviceId', 'name kind location').sort({ occurredAt: -1 }).skip((page - 1) * 10).limit(10).lean()]);
    return res.json({ success: true, data, pagination: { page, total, totalPages: Math.max(1, Math.ceil(total / 10)) } });
  } catch (error) { return errorResponse(res, error); }
};

const reviewEvent = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) throw reject('ID sự kiện không hợp lệ');
    if (!['matched', 'dismissed'].includes(req.body?.status)) throw reject('Chỉ được xác nhận hoặc bỏ qua sự kiện');
    const event = await GuardDeviceEvent.findOneAndUpdate({ _id: req.params.id, status: { $in: ['review', 'alert'] } }, { $set: { status: req.body.status, reviewNote: trim(req.body.note, 500), reviewedBy: req.user._id, reviewedAt: new Date() } }, { returnDocument: 'after' });
    if (!event) throw reject('Sự kiện đã được xử lý hoặc không tồn tại', 409);
    return res.json({ success: true, data: event });
  } catch (error) { return errorResponse(res, error); }
};

const resolveMatch = async (eventType, identifier, confidence) => {
  if (eventType === 'behavior') return { status: 'alert', reason: 'Thiết bị báo hành vi bất thường; cần bảo vệ kiểm tra trực tiếp' };
  if (eventType === 'gate_state') return { status: 'review', reason: 'Trạng thái cổng do thiết bị báo; chưa có lệnh điều khiển cổng' };
  if (!identifier) throw reject('Sự kiện nhận diện cần mã hoặc biển số');
  if (confidence !== null && confidence < 0.85) return { status: 'review', reason: 'Độ tin cậy thấp; cần đối chiếu thủ công' };
  if (eventType === 'plate') {
    const records = await PickupRecord.find({ pickupDate: currentDay(), status: 'scheduled', 'picker.vehiclePlate': { $exists: true, $ne: '' } }).select('studentId studentName picker.vehiclePlate').lean();
    const matches = records.filter((record) => normalizePlate(record.picker?.vehiclePlate) === normalizePlate(identifier));
    if (matches.length === 1) return { status: 'review', reason: 'Biển số trùng lịch đón; vẫn phải đối chiếu người đón', studentId: matches[0].studentId, pickupRecordId: matches[0]._id, matchLabel: matches[0].studentName };
    return { status: matches.length ? 'review' : 'alert', reason: matches.length ? 'Biển số trùng nhiều lịch đón; cần đối chiếu' : 'Biển số không có trong lịch đón hôm nay' };
  }
  const field = eventType === 'face' ? 'faceProfileId' : 'attendanceCardId';
  const lookup = eventType === 'card' ? trim(identifier, 120).toUpperCase() : trim(identifier, 120);
  const student = await Student.findOne({ status: 'enrolled', [field]: lookup }).select('_id fullName').lean();
  if (!student) return { status: 'alert', reason: 'Không tìm thấy hồ sơ học sinh khớp mã nhận diện' };
  return { status: 'review', reason: 'Mã khớp hồ sơ; bảo vệ cần kiểm tra trực tiếp trước khi ghi nhận vào trường', studentId: student._id, matchLabel: student.fullName };
};

const ingestEvent = async (req, res) => {
  try {
    const rawToken = req.get('X-Device-Api-Key') || '';
    if (!/^[a-f0-9]{64}$/.test(rawToken)) throw reject('Thiếu khóa kết nối thiết bị', 401);
    if (!isValidObjectId(req.params.id)) throw reject('ID thiết bị không hợp lệ', 401);
    const device = await GuardDevice.findOne({ _id: req.params.id, enabled: true, tokenHash: tokenDigest(rawToken) }).select('+tokenHash');
    if (!device) throw reject('Thiết bị hoặc khóa không hợp lệ', 401);
    const { externalEventId, eventType, identifier = '', confidence = null, snapshotUrl = '', description = '', occurredAt } = req.body || {};
    if (!compatibleEvents[device.kind].includes(eventType) || !trim(externalEventId, 121)) throw reject('Loại sự kiện hoặc mã sự kiện không hợp lệ');
    if (confidence !== null && (typeof confidence !== 'number' || confidence < 0 || confidence > 1)) throw reject('Độ tin cậy phải từ 0 đến 1');
    const eventTime = new Date(occurredAt);
    if (!occurredAt || Number.isNaN(eventTime.getTime()) || Math.abs(Date.now() - eventTime.getTime()) > 24 * 60 * 60 * 1000) throw reject('Thời gian thiết bị phải nằm trong 24 giờ gần đây');
    const duplicate = await GuardDeviceEvent.findOne({ deviceId: device._id, externalEventId: trim(externalEventId, 120) });
    if (duplicate) return res.json({ success: true, repeated: true, data: duplicate });
    const match = await resolveMatch(eventType, trim(identifier, 120), confidence);
    const event = await GuardDeviceEvent.create({ deviceId: device._id, externalEventId: trim(externalEventId, 120), eventType, identifier: eventType === 'plate' ? normalizePlate(identifier) : eventType === 'card' ? trim(identifier, 120).toUpperCase() : trim(identifier, 120), confidence, snapshotUrl: safeSnapshot(snapshotUrl), description: trim(description, 500), occurredAt: eventTime, ...match });
    await GuardDevice.updateOne({ _id: device._id }, { $set: { lastSeenAt: new Date() } });
    if (event.status === 'alert') {
      const recipients = await User.find({ role: { $in: ['guard', 'admin', 'principal'] }, status: 'active' }).select('_id').lean();
      if (recipients.length) await Notification.insertMany(recipients.map((recipient) => ({ recipientId: recipient._id, title: `Cảnh báo cổng: ${device.name}`, message: event.reason, type: 'warning', link: '/guard', metadata: { guardDeviceEventId: event._id, priority: 'high' } })));
    }
    return res.status(201).json({ success: true, data: { id: event._id, status: event.status, reason: event.reason } });
  } catch (error) {
    if (error.code === 11000) { const existing = await GuardDeviceEvent.findOne({ deviceId: req.params.id, externalEventId: trim(req.body?.externalEventId, 120) }); return res.json({ success: true, repeated: true, data: existing }); }
    return errorResponse(res, error);
  }
};

module.exports = { listDevices, createDevice, updateDevice, rotateDeviceToken, listEvents, reviewEvent, ingestEvent };
