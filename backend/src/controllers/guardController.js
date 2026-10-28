const Student = require('../models/zone3_school/Student');
const mongoose = require('mongoose');
const User = require('../models/zone1_system/User');
const Notification = require('../models/zone1_system/Notification');
const PickupRecord = require('../models/zone3_school/PickupRecord');
const StudentGateEvent = require('../models/zone3_school/StudentGateEvent');
const SchoolVisitor = require('../models/zone3_school/SchoolVisitor');
const SecurityIncident = require('../models/zone3_school/SecurityIncident');
const GuardShiftHandover = require('../models/zone3_school/GuardShiftHandover');
const PickupOtpChallenge = require('../models/zone3_school/PickupOtpChallenge');
const SupplierDelivery = require('../models/zone3_school/SupplierDelivery');
const GuardEmergencyMode = require('../models/zone3_school/GuardEmergencyMode');
const PurchaseOrder = require('../models/zone6_procurement/PurchaseOrder');
const crypto = require('crypto');
const { isValidObjectId } = require('../utils/idValidation');
const { DEFAULT_SCHOOL_TIMEZONE, getWorkDate, isValidWorkDate } = require('../utils/dateHelpers');
const {
  resolveEventDateAndTime,
  computeFingerprint,
  computeFingerprintV1,
  computeFingerprintV2,
  canonicalGatePayload,
  canonicalGatePayloadV1,
  canonicalGatePayloadV2,
  canonicalVisitorPayload,
  canonicalVisitorPayloadV1,
  canonicalVisitorPayloadV2,
  canonicalIncidentPayload,
  canonicalIncidentPayloadV1,
  canonicalIncidentPayloadV2,
  canonicalDeliveryPayload,
  canonicalDeliveryPayloadV1,
  canonicalDeliveryPayloadV2,
  canonicalGateFromDoc,
  canonicalGateFromDocV1,
  canonicalGateFromDocV2,
  canonicalVisitorFromDoc,
  canonicalVisitorFromDocV1,
  canonicalVisitorFromDocV2,
  canonicalIncidentFromDoc,
  canonicalIncidentFromDocV1,
  canonicalIncidentFromDocV2,
  canonicalDeliveryFromDoc,
  canonicalDeliveryFromDocV1,
  canonicalDeliveryFromDocV2,
  verifyIdempotency
} = require('../utils/idempotencyHelper');

const today = () => getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
const actorName = (user) => user?.profile?.fullName || user?.username || 'Nhân viên trực cổng';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const sendError = (res, error, fallback) => res.status(error.status || 500).json({ success: false, message: error.message || fallback });
const clean = (value, max = 500) => String(value || '').trim().slice(0, max);
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const REMINDER_INTERVAL_MS = 15 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;
const hashOtp = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const createPickupCode = () => crypto.randomBytes(8).toString('hex').toUpperCase();
const parseOccurredAt = (value) => {
  if (!value) return new Date();
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || getWorkDate(date, DEFAULT_SCHOOL_TIMEZONE) !== today()) throw fail('Dữ liệu ngoại tuyến chỉ được đồng bộ trong đúng ngày phát sinh');
  return date;
};

const notifyParents = async (studentId, title, message, actorId, metadata = {}) => {
  const parents = await User.find({ role: 'parent', status: 'active', 'parentInfo.studentIds': studentId }).select('_id').lean();
  if (!parents.length) return;
  await Notification.insertMany(parents.map((parent) => ({ recipientId: parent._id, title, message, type: 'attendance', link: '/parent-portal', createdBy: actorId, metadata: { studentId, ...metadata } })));
};

const notifyManagers = async (title, message, actorId, metadata = {}, session = null) => {
  const managers = await User.find({ role: { $in: ['admin', 'principal'] }, status: 'active' }).select('_id').lean();
  if (!managers.length) return;
  await Notification.insertMany(managers.map((manager) => ({ recipientId: manager._id, title, message, type: 'warning', link: '/guard', createdBy: actorId, metadata: { ...metadata, priority: 'high' } })), session ? { session } : {});
};

const getGateState = async (gateDate) => {
  const [events, grouped] = await Promise.all([
    StudentGateEvent.find({ gateDate }).sort({ occurredAt: -1 }).lean(),
    StudentGateEvent.aggregate([{ $match: { gateDate: { $lte: gateDate } } }, { $sort: { gateDate: -1, occurredAt: -1, _id: -1 } }, { $group: { _id: '$studentId', event: { $first: '$$ROOT' } } }])
  ]);
  const latest = grouped.map((entry) => entry.event);
  return { events, latest, inside: latest.filter((event) => event.direction === 'arrival') };
};

const getDashboard = async (req, res) => {
  try {
    const gateDate = req.query.date || today();
    if (!isValidWorkDate(gateDate)) throw fail('Ngày trực không hợp lệ');
    const isGuard = req.user.role === 'guard';
    if (isGuard) {
      const [visitors, incidents, handovers] = await Promise.all([
        SchoolVisitor.find(gateDate === today() ? { $or: [{ visitDate: gateDate }, { status: 'inside' }] } : { visitDate: gateDate }).sort({ checkInAt: -1 }).lean(),
        SecurityIncident.find({ status: { $ne: 'closed' } }).sort({ createdAt: -1 }).lean(),
        GuardShiftHandover.find(gateDate === today() ? { $or: [{ handoverDate: gateDate }, { receiverId: req.user._id, status: 'pending' }] } : { handoverDate: gateDate }).select('-childrenSnapshot -childrenRemaining').sort({ handedOverAt: -1 }).limit(5).lean()
      ]);
      return res.json({
        success: true,
        data: {
          date: gateDate,
          summary: {
            visitorsInside: visitors.filter((item) => item.status === 'inside').length,
            openIncidents: incidents.length
          },
          visitorsInside: visitors.filter((item) => item.status === 'inside').slice(0, 12),
          incidents: incidents.slice(0, 10),
          priorityIncidents: incidents.filter((item) => ['serious', 'emergency'].includes(item.severity) && !item.acknowledgedAt),
          handovers
        }
      });
    }
    const [{ events, inside }, enrolled, pickups, visitors, incidents, handovers] = await Promise.all([
      getGateState(gateDate),
      Student.countDocuments({ status: 'enrolled' }),
      PickupRecord.find({ pickupDate: gateDate }).sort({ expectedPickupTime: 1, createdAt: -1 }).lean(),
      SchoolVisitor.find(gateDate === today() ? { $or: [{ visitDate: gateDate }, { status: 'inside' }] } : { visitDate: gateDate }).sort({ checkInAt: -1 }).lean(),
      SecurityIncident.find({ status: { $ne: 'closed' } }).sort({ createdAt: -1 }).lean(),
      GuardShiftHandover.find(gateDate === today() ? { $or: [{ handoverDate: gateDate }, { receiverId: req.user._id, status: 'pending' }] } : { handoverDate: gateDate }).sort({ handedOverAt: -1 }).limit(5).lean()
    ]);
    const arrivalIds = new Set(events.filter((event) => event.direction === 'arrival').map((event) => String(event.studentId)));
    const departureIds = new Set(events.filter((event) => event.direction === 'departure').map((event) => String(event.studentId)));
    return res.json({
      success: true,
      data: {
        date: gateDate,
        summary: {
          enrolled,
          arrived: arrivalIds.size,
          departed: departureIds.size,
          remaining: inside.length,
          pickupPending: pickups.filter((item) => item.status === 'scheduled').length,
          pickupCompleted: pickups.filter((item) => item.status === 'confirmed').length,
          visitorsInside: visitors.filter((item) => item.status === 'inside').length,
          openIncidents: incidents.length
        },
        studentsInside: inside,
        recentGateEvents: events.slice(0, 12),
        pendingPickups: pickups.filter((item) => item.status === 'scheduled').slice(0, 12),
        visitorsInside: visitors.filter((item) => item.status === 'inside').slice(0, 12),
        incidents: incidents.slice(0, 10),
        priorityIncidents: incidents.filter((item) => ['serious', 'emergency'].includes(item.severity) && !item.acknowledgedAt),
        handovers
      }
    });
  } catch (error) { return sendError(res, error, 'Không thể tải tổng quan trực cổng'); }
};

const searchStudents = async (req, res) => {
  try {
    const query = clean(req.query.search, 80);
    const page = Number(req.query.page || 1);
    if (!Number.isSafeInteger(page) || page < 1) throw fail('Trang tìm kiếm không hợp lệ');
    const filter = { status: 'enrolled' };
    if (query) filter.$or = [{ fullName: { $regex: escapeRegex(query), $options: 'i' } }, { studentCode: { $regex: escapeRegex(query), $options: 'i' } }, { attendanceCardId: query.toUpperCase() }];
    const total = await Student.countDocuments(filter);
    const students = await Student.find(filter).select('fullName studentCode avatar classroomId className authorizedPickers emergencyContact attendanceCardId').sort({ fullName: 1, _id: 1 }).skip((page - 1) * 10).limit(10).lean();
    const data = students.map((student) => ({
      _id: student._id, fullName: student.fullName, studentCode: student.studentCode, avatar: student.avatar,
      classroomId: student.classroomId, className: student.className,
      emergencyContact: student.emergencyContact?.phone ? { name: student.emergencyContact.name, relationship: student.emergencyContact.relationship, phoneLast4: String(student.emergencyContact.phone).slice(-4) } : null,
      authorizedPickers: (student.authorizedPickers || []).filter((picker) => picker.isActive !== false).map((picker) => ({ _id: picker._id, fullName: picker.fullName, relationship: picker.relationship, phoneLast4: String(picker.phone || '').slice(-4), identityCardLast4: String(picker.identityCard || '').slice(-4), photoURL: picker.photoURL || '', vehicleType: picker.vehicleType || '', vehiclePlate: picker.vehiclePlate || '' }))
    }));
    return res.json({ success: true, data, pagination: { page, limit: 10, total, totalPages: Math.max(1, Math.ceil(total / 10)) } });
  } catch (error) { return sendError(res, error, 'Không thể tìm học sinh'); }
};

const listGateEvents = async (req, res) => {
  try {
    const gateDate = req.query.date || today();
    if (!isValidWorkDate(gateDate)) throw fail('Ngày trực không hợp lệ');
    const data = await StudentGateEvent.find({ gateDate }).sort({ occurredAt: -1 }).lean();
    return res.json({ success: true, data });
  } catch (error) { return sendError(res, error, 'Không thể tải nhật ký cổng'); }
};

const recordGateEvent = async (req, res) => {
  try {
    const { studentId, direction, note = '', method = 'manual', clientEventId = '', occurredAt } = req.body || {};
    if (!isValidObjectId(studentId)) throw fail('ID học sinh không hợp lệ');
    if (!['arrival', 'departure'].includes(direction)) throw fail('Chiều di chuyển không hợp lệ');
    if (direction === 'departure' && req.user.role === 'guard') throw fail('Bảo vệ phải xác nhận người đón tại mục Đón trẻ trước khi ghi nhận trẻ rời trường', 403);
    if (!['manual', 'card', 'qr', 'offline'].includes(method)) throw fail('Phương thức ghi nhận không hợp lệ');
    if (String(note).length > 500) throw fail('Ghi chú tối đa 500 ký tự');

    const { dateObj, normalizedOccurredAt, workDate: gateDate } = resolveEventDateAndTime(occurredAt);
    const canonicalPayloadV2 = canonicalGatePayloadV2({ studentId, direction, method, note, gateDate, occurredAt: normalizedOccurredAt });
    const canonicalPayloadV1 = canonicalGatePayloadV1({ studentId, direction, method, note, gateDate });
    const payloadFingerprint = computeFingerprintV2(canonicalPayloadV2);

    if (clientEventId) {
      const repeated = await StudentGateEvent.findOne({ clientEventId }).lean();
      if (repeated) {
        const verify = verifyIdempotency({
          existingDoc: repeated,
          currentUserId: req.user._id,
          ownerField: 'recordedBy',
          incomingFingerprint: payloadFingerprint,
          incomingCanonicalV2: canonicalPayloadV2,
          incomingCanonicalV1: canonicalPayloadV1,
          incomingNormalizedOccurredAt: normalizedOccurredAt,
          canonicalFromDocV1Fn: canonicalGateFromDocV1,
          canonicalFromDocV2Fn: canonicalGateFromDocV2
        });
        if (verify.status === 'conflict') {
          return res.status(409).json({ success: false, message: verify.message });
        }
        return res.json({ success: true, repeated: true, message: 'Dữ liệu ngoại tuyến đã được đồng bộ trước đó', data: verify.doc });
      }
    }

    if (gateDate !== today()) {
      throw fail('Dữ liệu ngoại tuyến chỉ được đồng bộ trong đúng ngày phát sinh', 422);
    }

    const student = await Student.findOne({ _id: studentId, status: 'enrolled' }).select('fullName studentCode classroomId className');
    if (!student) throw fail('Không tìm thấy học sinh đang theo học', 404);
    const opposite = direction === 'arrival' ? 'departure' : 'arrival';
    const oppositeEvent = await StudentGateEvent.exists({ studentId, gateDate, direction: opposite });
    if (direction === 'arrival' && oppositeEvent) throw fail('Học sinh đã rời trường hôm nay, cần quản lý xác minh nếu quay lại', 409);
    if (direction === 'departure' && !oppositeEvent) throw fail('Chưa có ghi nhận học sinh vào trường hôm nay', 409);
    const event = await StudentGateEvent.create({ studentId: student._id, studentName: student.fullName, studentCode: student.studentCode, classroomId: student.classroomId, className: student.className || '', gateDate, direction, occurredAt: dateObj, method, note: clean(note), ...(clientEventId ? { clientEventId: clean(clientEventId, 100), payloadFingerprint } : {}), recordedBy: req.user._id, recordedByName: actorName(req.user) });
    await notifyParents(student._id, direction === 'arrival' ? `Đã vào trường: ${student.fullName}` : `Đã rời trường: ${student.fullName}`, direction === 'arrival' ? `${student.fullName} đã được ghi nhận qua cổng trường.` : `${student.fullName} đã được ghi nhận rời trường.`, req.user._id, { gateEventId: event._id, direction });
    return res.status(201).json({ success: true, message: direction === 'arrival' ? 'Đã ghi nhận học sinh vào trường' : 'Đã ghi nhận học sinh rời trường', data: event });
  } catch (error) {
    if (error?.code === 11000) {
      const isClientEventConflict = error.keyPattern?.clientEventId || (error.message && error.message.includes('clientEventId'));
      if (req.body?.clientEventId && isClientEventConflict) {
        const repeated = await StudentGateEvent.findOne({ clientEventId: req.body.clientEventId }).lean();
        if (repeated) {
          const { normalizedOccurredAt, workDate: gateDate } = resolveEventDateAndTime(req.body.occurredAt);
          const canonicalPayloadV2 = canonicalGatePayloadV2({
            studentId: req.body.studentId,
            direction: req.body.direction,
            method: req.body.method,
            note: req.body.note,
            gateDate,
            occurredAt: normalizedOccurredAt
          });
          const canonicalPayloadV1 = canonicalGatePayloadV1({
            studentId: req.body.studentId,
            direction: req.body.direction,
            method: req.body.method,
            note: req.body.note,
            gateDate
          });
          const payloadFingerprint = computeFingerprintV2(canonicalPayloadV2);
          const verify = verifyIdempotency({
            existingDoc: repeated,
            currentUserId: req.user._id,
            ownerField: 'recordedBy',
            incomingFingerprint: payloadFingerprint,
            incomingCanonicalV2: canonicalPayloadV2,
            incomingCanonicalV1: canonicalPayloadV1,
            incomingNormalizedOccurredAt: normalizedOccurredAt,
            canonicalFromDocV1Fn: canonicalGateFromDocV1,
            canonicalFromDocV2Fn: canonicalGateFromDocV2
          });
          if (verify.status === 'conflict') {
            return res.status(409).json({ success: false, message: verify.message });
          }
          return res.json({ success: true, repeated: true, message: 'Dữ liệu ngoại tuyến đã được đồng bộ trước đó', data: verify.doc });
        }
      }
      return res.status(409).json({ success: false, message: 'Sự kiện này đã được ghi nhận trước đó' });
    }
    return sendError(res, error, 'Không thể ghi nhận qua cổng');
  }
};

const listVisitors = async (req, res) => {
  try {
    const visitDate = req.query.date || today();
    if (!isValidWorkDate(visitDate)) throw fail('Ngày không hợp lệ');
    const data = await SchoolVisitor.find(visitDate === today() ? { $or: [{ visitDate }, { status: 'inside' }] } : { visitDate }).sort({ checkInAt: -1 }).lean();
    return res.json({ success: true, data });
  } catch (error) { return sendError(res, error, 'Không thể tải danh sách khách'); }
};

const createVisitor = async (req, res) => {
  try {
    const { fullName, phone = '', organization = '', purpose, hostName, allowedArea = '', identityLast4 = '', vehiclePlate = '', badgeNumber = '', note = '', clientEventId = '', occurredAt } = req.body || {};
    if (!clean(fullName, 121) || !clean(purpose, 501) || !clean(hostName, 121)) throw fail('Họ tên khách, mục đích và người cần gặp là bắt buộc');
    if (phone && !/^[0-9+().\s-]{8,20}$/.test(phone)) throw fail('Số điện thoại không hợp lệ');
    if (identityLast4 && !/^\d{4}$/.test(identityLast4)) throw fail('Chỉ nhập 4 số cuối giấy tờ');

    const { dateObj, normalizedOccurredAt, workDate: visitDate } = resolveEventDateAndTime(occurredAt);
    const canonicalPayloadV2 = canonicalVisitorPayloadV2({ fullName, phone, organization, purpose, hostName, allowedArea, identityLast4, vehiclePlate, badgeNumber, visitDate, occurredAt: normalizedOccurredAt, note });
    const canonicalPayloadV1 = canonicalVisitorPayloadV1({ fullName, phone, organization, purpose, hostName, allowedArea, identityLast4, vehiclePlate, badgeNumber, visitDate, note });
    const payloadFingerprint = computeFingerprintV2(canonicalPayloadV2);

    if (clientEventId) {
      const repeated = await SchoolVisitor.findOne({ clientEventId }).lean();
      if (repeated) {
        const verify = verifyIdempotency({
          existingDoc: repeated,
          currentUserId: req.user._id,
          ownerField: 'recordedBy',
          incomingFingerprint: payloadFingerprint,
          incomingCanonicalV2: canonicalPayloadV2,
          incomingCanonicalV1: canonicalPayloadV1,
          incomingNormalizedOccurredAt: normalizedOccurredAt,
          canonicalFromDocV1Fn: canonicalVisitorFromDocV1,
          canonicalFromDocV2Fn: canonicalVisitorFromDocV2
        });
        if (verify.status === 'conflict') {
          return res.status(409).json({ success: false, message: verify.message });
        }
        return res.json({ success: true, repeated: true, message: 'Dữ liệu ngoại tuyến đã được đồng bộ trước đó', data: verify.doc });
      }
    }

    if (visitDate !== today()) {
      throw fail('Dữ liệu ngoại tuyến chỉ được đồng bộ trong đúng ngày phát sinh', 422);
    }

    const item = await SchoolVisitor.create({ fullName: clean(fullName, 120), phone: clean(phone, 20), organization: clean(organization, 160), purpose: clean(purpose, 500), hostName: clean(hostName, 120), allowedArea: clean(allowedArea, 160), identityLast4, vehiclePlate: clean(vehiclePlate, 20).toUpperCase(), badgeNumber: clean(badgeNumber, 30).toUpperCase(), visitDate, checkInAt: dateObj, note: clean(note), ...(clientEventId ? { clientEventId: clean(clientEventId, 100), payloadFingerprint } : {}), recordedBy: req.user._id, recordedByName: actorName(req.user) });
    return res.status(201).json({ success: true, message: 'Đã ghi nhận khách vào trường', data: item });
  } catch (error) {
    if (error?.code === 11000) {
      const isClientEventConflict = error.keyPattern?.clientEventId || (error.message && error.message.includes('clientEventId'));
      if (req.body?.clientEventId && isClientEventConflict) {
        const repeated = await SchoolVisitor.findOne({ clientEventId: req.body.clientEventId }).lean();
        if (repeated) {
          const { normalizedOccurredAt, workDate: visitDate } = resolveEventDateAndTime(req.body.occurredAt);
          const canonicalPayloadV2 = canonicalVisitorPayloadV2({
            fullName: req.body.fullName,
            phone: req.body.phone,
            organization: req.body.organization,
            purpose: req.body.purpose,
            hostName: req.body.hostName,
            allowedArea: req.body.allowedArea,
            identityLast4: req.body.identityLast4,
            vehiclePlate: req.body.vehiclePlate,
            badgeNumber: req.body.badgeNumber,
            visitDate,
            occurredAt: normalizedOccurredAt,
            note: req.body.note
          });
          const canonicalPayloadV1 = canonicalVisitorPayloadV1({
            fullName: req.body.fullName,
            phone: req.body.phone,
            organization: req.body.organization,
            purpose: req.body.purpose,
            hostName: req.body.hostName,
            allowedArea: req.body.allowedArea,
            identityLast4: req.body.identityLast4,
            vehiclePlate: req.body.vehiclePlate,
            badgeNumber: req.body.badgeNumber,
            visitDate,
            note: req.body.note
          });
          const payloadFingerprint = computeFingerprintV2(canonicalPayloadV2);
          const verify = verifyIdempotency({
            existingDoc: repeated,
            currentUserId: req.user._id,
            ownerField: 'recordedBy',
            incomingFingerprint: payloadFingerprint,
            incomingCanonicalV2: canonicalPayloadV2,
            incomingCanonicalV1: canonicalPayloadV1,
            incomingNormalizedOccurredAt: normalizedOccurredAt,
            canonicalFromDocV1Fn: canonicalVisitorFromDocV1,
            canonicalFromDocV2Fn: canonicalVisitorFromDocV2
          });
          if (verify.status === 'conflict') {
            return res.status(409).json({ success: false, message: verify.message });
          }
          return res.json({ success: true, repeated: true, message: 'Dữ liệu ngoại tuyến đã được đồng bộ trước đó', data: verify.doc });
        }
      }
      return res.status(409).json({ success: false, message: 'Thông tin khách bị trùng khóa duy nhất' });
    }
    return sendError(res, error, 'Không thể ghi nhận khách');
  }
};

const checkoutVisitor = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) throw fail('ID lượt khách không hợp lệ');
    const item = await SchoolVisitor.findById(req.params.id);
    if (!item) throw fail('Không tìm thấy lượt khách', 404);
    if (item.status === 'checked_out') return res.json({ success: true, message: 'Khách đã được ghi nhận rời trường trước đó', data: item });
    if (item.status !== 'inside') throw fail('Lượt khách này không thể xác nhận rời trường', 409);
    item.status = 'checked_out'; item.checkOutAt = new Date(); item.checkedOutBy = req.user._id; item.checkedOutByName = actorName(req.user); await item.save();
    return res.json({ success: true, message: 'Đã ghi nhận khách rời trường', data: item });
  } catch (error) { return sendError(res, error, 'Không thể xác nhận khách rời trường'); }
};

const listIncidents = async (req, res) => {
  try {
    const filter = req.query.status ? { status: req.query.status } : {};
    if (req.query.status && !['open', 'in_progress', 'handed_over', 'closed'].includes(req.query.status)) throw fail('Trạng thái sự cố không hợp lệ');
    const data = await SecurityIncident.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    return res.json({ success: true, data });
  } catch (error) { return sendError(res, error, 'Không thể tải sự cố'); }
};

const createIncident = async (req, res) => {
  try {
    const { category, severity = 'normal', location, description, actionTaken = '', studentId = null, clientEventId = '', occurredAt } = req.body || {};
    if (!['unauthorized_person', 'invalid_picker', 'child_safety', 'accident', 'lost_property', 'equipment', 'fire', 'traffic', 'other'].includes(category)) throw fail('Loại sự cố không hợp lệ');
    if (!['normal', 'serious', 'emergency'].includes(severity)) throw fail('Mức độ sự cố không hợp lệ');
    if (!clean(location, 161) || !clean(description, 2001)) throw fail('Vị trí và nội dung sự cố là bắt buộc');
    let student = null;
    if (studentId) { if (!isValidObjectId(studentId)) throw fail('ID học sinh không hợp lệ'); student = await Student.findById(studentId).select('fullName'); if (!student) throw fail('Không tìm thấy học sinh', 404); }

    const { dateObj, normalizedOccurredAt, workDate: incidentDate } = resolveEventDateAndTime(occurredAt);
    const canonicalPayloadV2 = canonicalIncidentPayloadV2({ incidentDate, category, severity, location, description, actionTaken, studentId, occurredAt: normalizedOccurredAt });
    const canonicalPayloadV1 = canonicalIncidentPayloadV1({ incidentDate, category, severity, location, description, actionTaken, studentId });
    const payloadFingerprint = computeFingerprintV2(canonicalPayloadV2);

    if (clientEventId) {
      const repeated = await SecurityIncident.findOne({ clientEventId }).lean();
      if (repeated) {
        const verify = verifyIdempotency({
          existingDoc: repeated,
          currentUserId: req.user._id,
          ownerField: 'reportedBy',
          incomingFingerprint: payloadFingerprint,
          incomingCanonicalV2: canonicalPayloadV2,
          incomingCanonicalV1: canonicalPayloadV1,
          incomingNormalizedOccurredAt: normalizedOccurredAt,
          canonicalFromDocV1Fn: canonicalIncidentFromDocV1,
          canonicalFromDocV2Fn: canonicalIncidentFromDocV2
        });
        if (verify.status === 'conflict') {
          return res.status(409).json({ success: false, message: verify.message });
        }
        return res.json({ success: true, repeated: true, message: 'Dữ liệu ngoại tuyến đã được đồng bộ trước đó', data: verify.doc });
      }
    }

    if (incidentDate !== today()) {
      throw fail('Dữ liệu ngoại tuyến chỉ được đồng bộ trong đúng ngày phát sinh', 422);
    }

    const item = await mongoose.connection.transaction(async (session) => {
      const [incident] = await SecurityIncident.create([{ incidentDate, occurredAt: dateObj, category, severity, location: clean(location, 160), description: clean(description, 2000), actionTaken: clean(actionTaken, 1000), studentId: student?._id || null, studentName: student?.fullName || '', ...(clientEventId ? { clientEventId: clean(clientEventId, 100), payloadFingerprint } : {}), reportedBy: req.user._id, reportedByName: actorName(req.user), nextReminderAt: severity === 'normal' ? null : new Date(Date.now() + REMINDER_INTERVAL_MS) }], { session });
      if (severity !== 'normal') await notifyManagers(`Sự cố ${severity === 'emergency' ? 'khẩn cấp' : 'nghiêm trọng'} tại ${incident.location}`, incident.description, req.user._id, { incidentId: incident._id, severity }, session);
      return incident;
    });
    return res.status(201).json({ success: true, message: 'Đã ghi nhận sự cố và gửi cảnh báo phù hợp', data: item });
  } catch (error) {
    if (error?.code === 11000) {
      const isClientEventConflict = error.keyPattern?.clientEventId || (error.message && error.message.includes('clientEventId'));
      if (req.body?.clientEventId && isClientEventConflict) {
        const repeated = await SecurityIncident.findOne({ clientEventId: req.body.clientEventId }).lean();
        if (repeated) {
          const { normalizedOccurredAt, workDate: incidentDate } = resolveEventDateAndTime(req.body.occurredAt);
          const canonicalPayloadV2 = canonicalIncidentPayloadV2({
            incidentDate,
            category: req.body.category,
            severity: req.body.severity,
            location: req.body.location,
            description: req.body.description,
            actionTaken: req.body.actionTaken,
            studentId: req.body.studentId,
            occurredAt: normalizedOccurredAt
          });
          const canonicalPayloadV1 = canonicalIncidentPayloadV1({
            incidentDate,
            category: req.body.category,
            severity: req.body.severity,
            location: req.body.location,
            description: req.body.description,
            actionTaken: req.body.actionTaken,
            studentId: req.body.studentId
          });
          const payloadFingerprint = computeFingerprintV2(canonicalPayloadV2);
          const verify = verifyIdempotency({
            existingDoc: repeated,
            currentUserId: req.user._id,
            ownerField: 'reportedBy',
            incomingFingerprint: payloadFingerprint,
            incomingCanonicalV2: canonicalPayloadV2,
            incomingCanonicalV1: canonicalPayloadV1,
            incomingNormalizedOccurredAt: normalizedOccurredAt,
            canonicalFromDocV1Fn: canonicalIncidentFromDocV1,
            canonicalFromDocV2Fn: canonicalIncidentFromDocV2
          });
          if (verify.status === 'conflict') {
            return res.status(409).json({ success: false, message: verify.message });
          }
          return res.json({ success: true, repeated: true, message: 'Dữ liệu ngoại tuyến đã được đồng bộ trước đó', data: verify.doc });
        }
      }
      return res.status(409).json({ success: false, message: 'Sự cố bị trùng khóa duy nhất' });
    }
    return sendError(res, error, 'Không thể ghi nhận sự cố');
  }
};

const updateIncident = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) throw fail('ID sự cố không hợp lệ');
    const status = req.body?.status;
    const allowed = req.user.role === 'guard' ? ['in_progress', 'handed_over'] : ['in_progress', 'handed_over', 'closed'];
    if (!allowed.includes(status)) throw fail('Bạn không được chuyển sang trạng thái này', 403);
    const item = await SecurityIncident.findById(req.params.id);
    if (!item) throw fail('Không tìm thấy sự cố', 404);
    if (item.status === 'closed') throw fail('Sự cố đã đóng, không thể thay đổi', 409);
    if (item.status === 'handed_over' && req.user.role === 'guard') throw fail('Sự cố đã bàn giao cho quản lý', 409);
    if (status === 'closed' && !clean(req.body?.resolutionNote, 1000)) throw fail('Vui lòng ghi kết quả xử lý trước khi đóng sự cố');
    if (status === 'closed' && ['serious', 'emergency'].includes(item.severity) && !item.acknowledgedAt) throw fail('Quản lý cần tiếp nhận cảnh báo trước khi đóng sự cố', 409);
    item.status = status; item.resolutionNote = clean(req.body?.resolutionNote, 1000);
    if (status === 'closed') { item.resolvedAt = new Date(); item.resolvedBy = req.user._id; item.resolvedByName = actorName(req.user); }
    await item.save();
    return res.json({ success: true, message: 'Đã cập nhật trạng thái sự cố', data: item });
  } catch (error) { return sendError(res, error, 'Không thể cập nhật sự cố'); }
};

const acknowledgeIncident = async (req, res) => {
  try {
    if (!['admin', 'principal'].includes(req.user.role)) throw fail('Chỉ quản lý được xác nhận tiếp nhận cảnh báo', 403);
    if (!isValidObjectId(req.params.id)) throw fail('ID sự cố không hợp lệ');
    const item = await SecurityIncident.findOneAndUpdate(
      { _id: req.params.id, severity: { $in: ['serious', 'emergency'] }, status: { $ne: 'closed' }, acknowledgedAt: null },
      { $set: { acknowledgedAt: new Date(), acknowledgedBy: req.user._id, acknowledgedByName: actorName(req.user), nextReminderAt: null } },
      { returnDocument: 'after' }
    );
    if (item) return res.json({ success: true, message: 'Đã tiếp nhận cảnh báo sự cố', data: item });
    const existing = await SecurityIncident.findById(req.params.id);
    if (!existing) throw fail('Không tìm thấy sự cố', 404);
    if (existing.acknowledgedAt) return res.json({ success: true, message: 'Cảnh báo đã được tiếp nhận', data: existing });
    throw fail('Sự cố không còn chờ tiếp nhận', 409);
  } catch (error) { return sendError(res, error, 'Không thể tiếp nhận cảnh báo'); }
};

const addManagementInstruction = async (req, res) => {
  try {
    if (!['admin', 'principal'].includes(req.user.role)) throw fail('Chỉ ban giám hiệu/quản trị viên mới được ghi chỉ đạo', 403);
    if (!isValidObjectId(req.params.id)) throw fail('ID sự cố không hợp lệ');
    const note = clean(req.body?.note, 1000);
    if (!note) throw fail('Nội dung chỉ đạo không được để trống');
    const item = await SecurityIncident.findById(req.params.id);
    if (!item) throw fail('Không tìm thấy sự cố', 404);
    if (!item.managementNotes) item.managementNotes = [];
    item.managementNotes.push({
      authorId: req.user._id,
      authorName: actorName(req.user),
      authorRole: req.user.role,
      note,
      createdAt: new Date()
    });
    await item.save();
    return res.json({ success: true, message: 'Đã thêm chỉ đạo quản lý cho sự cố', data: item });
  } catch (error) { return sendError(res, error, 'Không thể ghi chỉ đạo quản lý'); }
};

const listReceivers = async (req, res) => {
  try {
    const data = await User.find({ role: { $in: ['guard', 'admin', 'principal'] }, status: 'active', _id: { $ne: req.user._id } }).select('_id username role profile.fullName').sort({ 'profile.fullName': 1 }).lean();
    return res.json({ success: true, data: data.map((item) => ({ _id: item._id, name: item.profile?.fullName || item.username, role: item.role })) });
  } catch (error) { return sendError(res, error, 'Không thể tải người nhận ca'); }
};

const listHandovers = async (req, res) => {
  try {
    const handoverDate = req.query.date || today();
    if (!isValidWorkDate(handoverDate)) throw fail('Ngày bàn giao không hợp lệ');
    const filter = handoverDate === today() ? { $or: [{ handoverDate }, { receiverId: req.user._id, status: 'pending' }] } : { handoverDate };
    let query = GuardShiftHandover.find(filter).sort({ handedOverAt: -1 }).limit(50);
    if (req.user.role === 'guard') {
      query = query.select('-childrenSnapshot -childrenRemaining');
    }
    const data = await query.lean();
    return res.json({ success: true, data });
  } catch (error) { return sendError(res, error, 'Không thể tải lịch sử bàn giao'); }
};

const createHandover = async (req, res) => {
  try {
    const { shiftName, receiverId, keysAndEquipment = '', notes = '' } = req.body || {};
    if (!['morning', 'afternoon', 'evening'].includes(shiftName)) throw fail('Ca trực không hợp lệ');
    if (!isValidObjectId(receiverId)) throw fail('Vui lòng chọn tài khoản nhận bàn giao');
    if (String(receiverId) === String(req.user._id)) throw fail('Không thể tự nhận ca của mình');
    const receiver = await User.findOne({ _id: receiverId, role: { $in: ['guard', 'admin', 'principal'] }, status: 'active' }).select('username profile.fullName role');
    if (!receiver) throw fail('Tài khoản nhận bàn giao không còn hoạt động', 404);
    const isGuard = req.user.role === 'guard';
    const [inside, visitors, incidents] = await Promise.all([
      isGuard ? Promise.resolve([]) : getGateState(today()).then((res) => res.inside),
      SchoolVisitor.find({ status: 'inside' }).select('fullName hostName').lean(),
      SecurityIncident.find({ status: { $ne: 'closed' } }).select('location description status').lean()
    ]);
    const item = await mongoose.connection.transaction(async (session) => {
      const [handover] = await GuardShiftHandover.create([{
        handoverDate: today(),
        shiftName,
        receiverId: receiver._id,
        receiverName: receiver.profile?.fullName || receiver.username,
        childrenRemaining: isGuard ? 0 : inside.length,
        visitorsRemaining: visitors.length,
        openIncidents: incidents.length,
        childrenSnapshot: isGuard ? [] : inside.map((entry) => ({ studentId: entry.studentId, studentName: entry.studentName, className: entry.className })),
        visitorsSnapshot: visitors.map((entry) => ({ visitorId: entry._id, fullName: entry.fullName, hostName: entry.hostName })),
        incidentsSnapshot: incidents.map((entry) => ({ incidentId: entry._id, location: entry.location, description: entry.description, status: entry.status })),
        keysAndEquipment: clean(keysAndEquipment, 1000),
        notes: clean(notes, 2000),
        handedOverBy: req.user._id,
        handedOverByName: actorName(req.user)
      }], { session });
      await Notification.create([{
        recipientId: receiver._id,
        title: 'Bạn có ca trực cần nhận bàn giao',
        message: `${actorName(req.user)} đã bàn giao ca ${shiftName}. Vui lòng kiểm tra khách và sự cố còn tồn.`,
        type: 'warning',
        link: '/guard',
        createdBy: req.user._id,
        metadata: { handoverId: handover._id, priority: 'high' }
      }], { session });
      return handover;
    });
    const safeData = isGuard ? (() => {
      const obj = typeof item.toObject === 'function' ? item.toObject() : { ...item };
      delete obj.childrenSnapshot;
      delete obj.childrenRemaining;
      return obj;
    })() : item;
    return res.status(201).json({ success: true, message: 'Đã lưu biên bản bàn giao ca', data: safeData });
  } catch (error) { return sendError(res, error, 'Không thể bàn giao ca'); }
};

const acceptHandover = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) throw fail('ID biên bản không hợp lệ');
    const note = String(req.body?.acceptanceNote || '').trim();
    if (note.length > 500) throw fail('Ghi chú tiếp nhận tối đa 500 ký tự');
    const item = await mongoose.connection.transaction(async (session) => {
      const accepted = await GuardShiftHandover.findOneAndUpdate(
        { _id: req.params.id, receiverId: req.user._id, status: 'pending', handedOverBy: { $ne: req.user._id } },
        { $set: { status: 'accepted', acceptedAt: new Date(), acceptedBy: req.user._id, acceptanceNote: note } },
        { returnDocument: 'after', session }
      );
      if (accepted) await Notification.create([{ recipientId: accepted.handedOverBy, title: 'Ca trực đã được tiếp nhận', message: `${actorName(req.user)} đã xác nhận nhận ca ${accepted.shiftName}.`, type: 'info', link: '/guard', createdBy: req.user._id, metadata: { handoverId: accepted._id } }], { session });
      return accepted;
    });
    const isGuard = req.user.role === 'guard';
    const safeData = (result) => {
      if (!result || !isGuard) return result;
      const obj = typeof result.toObject === 'function' ? result.toObject() : { ...result };
      delete obj.childrenSnapshot;
      delete obj.childrenRemaining;
      return obj;
    };
    if (item) {
      return res.json({ success: true, message: 'Đã xác nhận nhận ca trực', data: safeData(item) });
    }
    const existing = await GuardShiftHandover.findById(req.params.id);
    if (!existing) throw fail('Không tìm thấy biên bản', 404);
    if (String(existing.receiverId) !== String(req.user._id)) throw fail('Bạn không phải người nhận ca được chỉ định', 403);
    if (existing.status === 'accepted') return res.json({ success: true, message: 'Ca trực đã được tiếp nhận', data: safeData(existing) });
    throw fail('Không thể nhận biên bản này', 409);
  } catch (error) { return sendError(res, error, 'Không thể xác nhận nhận ca'); }
};

const resolveQrCode = async (req, res) => {
  try {
    const rawCode = clean(req.body?.code, 120).toUpperCase();
    if (!rawCode) throw fail('Vui lòng quét hoặc nhập mã QR');
    const pickupCode = rawCode.startsWith('PICKUP:') ? rawCode.slice(7) : rawCode;
    const pickup = await PickupRecord.findOne({ pickupCode, pickupDate: today(), status: 'scheduled' }).lean();
    if (pickup) {
      const { pickupCode: hidden, ...safePickup } = pickup;
      return res.json({ success: true, data: { type: 'pickup', pickup: safePickup } });
    }
    const studentCode = rawCode.startsWith('STUDENT:') ? rawCode.slice(8) : rawCode;
    const student = await Student.findOne({ status: 'enrolled', $or: [{ studentCode }, { attendanceCardId: studentCode }] }).select('fullName studentCode avatar classroomId className attendanceCardId authorizedPickers').lean();
    if (!student) throw fail('Mã QR không hợp lệ hoặc không còn hiệu lực', 404);
    const latest = await StudentGateEvent.findOne({ studentId: student._id, gateDate: today() }).sort({ occurredAt: -1 }).lean();
    return res.json({ success: true, data: { type: 'student', student: { _id: student._id, fullName: student.fullName, studentCode: student.studentCode, avatar: student.avatar, classroomId: student.classroomId, className: student.className, gateStatus: latest?.direction || 'not_recorded' } } });
  } catch (error) { return sendError(res, error, 'Không thể đọc mã QR'); }
};

const requestPickupOtp = async (req, res) => {
  try {
    const { studentId, fullName, phone, relationship = '', identityCardLast4 = '', photoURL = '', vehicleType = '', vehiclePlate = '' } = req.body || {};
    if (!isValidObjectId(studentId)) throw fail('ID học sinh không hợp lệ');
    if (!clean(fullName, 121) || !/^[0-9+().\s-]{8,20}$/.test(String(phone || ''))) throw fail('Họ tên và số điện thoại người đón không hợp lệ');
    if (identityCardLast4 && !/^\d{4}$/.test(identityCardLast4)) throw fail('Giấy tờ chỉ nhập 4 số cuối');
    if (photoURL && !/^https?:\/\//i.test(photoURL)) throw fail('Ảnh người đón phải là đường dẫn http/https');
    const student = await Student.findOne({ _id: studentId, status: 'enrolled' }).select('fullName classroomId className');
    if (!student) throw fail('Không tìm thấy học sinh đang theo học', 404);
    const parents = await User.find({ role: 'parent', status: 'active', 'parentInfo.studentIds': student._id }).select('_id profile.fullName').lean();
    if (!parents.length) throw fail('Học sinh chưa có tài khoản phụ huynh đang hoạt động để nhận OTP', 409);
    await PickupOtpChallenge.updateMany({ studentId: student._id, pickupDate: today(), status: 'pending' }, { $set: { status: 'cancelled' } });
    const otp = String(crypto.randomInt(100000, 1000000));
    const challenge = await PickupOtpChallenge.create({
      studentId: student._id, studentName: student.fullName, classroomId: student.classroomId, className: student.className || '', pickupDate: today(),
      picker: { fullName: clean(fullName, 120), phone: clean(phone, 20), relationship: clean(relationship, 80), identityCardLast4, photoURL: clean(photoURL, 1000), vehicleType: clean(vehicleType, 80), vehiclePlate: clean(vehiclePlate, 20).toUpperCase() },
      codeHash: hashOtp(otp), expiresAt: new Date(Date.now() + OTP_TTL_MS), requestedBy: req.user._id, requestedByName: actorName(req.user)
    });
    await Notification.insertMany(parents.map((parent) => ({ recipientId: parent._id, title: `Mã OTP đón ${student.fullName}`, message: `${fullName} đang chờ xác nhận đón trẻ. Mã OTP: ${otp}. Mã có hiệu lực 10 phút; chỉ cung cấp khi bạn đồng ý.`, type: 'warning', link: '/pickups', createdBy: req.user._id, metadata: { studentId: student._id, otpChallengeId: challenge._id, priority: 'high' } })));
    return res.status(201).json({ success: true, message: 'Đã gửi OTP tới tài khoản phụ huynh liên kết', data: { challengeId: challenge._id, expiresAt: challenge.expiresAt, phoneLast4: String(phone).replace(/\D/g, '').slice(-4) } });
  } catch (error) { return sendError(res, error, 'Không thể gửi OTP xác nhận'); }
};

const verifyPickupOtp = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id) || !/^\d{6}$/.test(String(req.body?.otp || ''))) throw fail('Mã OTP không hợp lệ');
    const candidate = await PickupOtpChallenge.findById(req.params.id).select('+codeHash');
    if (!candidate) throw fail('Không tìm thấy yêu cầu OTP', 404);
    if (candidate.status === 'verified' && candidate.pickupRecordId) {
      const existingRecord = await PickupRecord.findById(candidate.pickupRecordId);
      return res.json({ success: true, message: 'OTP đã được xác nhận trước đó', data: existingRecord });
    }
    if (candidate.status !== 'pending') throw fail('Yêu cầu OTP không còn hiệu lực', 409);
    if (candidate.expiresAt <= new Date()) { candidate.status = 'expired'; await candidate.save(); throw fail('Mã OTP đã hết hạn', 409); }
    if (candidate.codeHash !== hashOtp(req.body.otp)) {
      candidate.attempts += 1;
      if (candidate.attempts >= 5) candidate.status = 'cancelled';
      await candidate.save();
      throw fail(candidate.attempts >= 5 ? 'OTP sai quá 5 lần, yêu cầu đã bị khóa' : `OTP không đúng, còn ${5 - candidate.attempts} lần thử`, 422);
    }
    const item = await mongoose.connection.transaction(async (session) => {
      const challenge = await PickupOtpChallenge.findOne({ _id: req.params.id, status: 'pending', expiresAt: { $gt: new Date() }, codeHash: hashOtp(req.body.otp) }).select('+codeHash').session(session);
      if (!challenge) throw fail('Yêu cầu OTP vừa được xử lý hoặc không còn hiệu lực', 409);
      if (await PickupRecord.exists({ studentId: challenge.studentId, pickupDate: challenge.pickupDate, status: 'scheduled' }).session(session)) throw fail('Học sinh đã có lịch đón đang hiệu lực trong ngày', 409);
      const parent = await User.findOne({ role: 'parent', status: 'active', 'parentInfo.studentIds': challenge.studentId }).select('_id profile.fullName username').session(session);
      if (!parent) throw fail('Tài khoản phụ huynh không còn hoạt động', 409);
      const [record] = await PickupRecord.create([{ studentId: challenge.studentId, studentName: challenge.studentName, classroomId: challenge.classroomId, className: challenge.className, requesterId: parent._id, requesterName: parent.profile?.fullName || parent.username, pickupDate: challenge.pickupDate, expectedPickupTime: '', note: 'Người đón thay được phụ huynh xác nhận bằng OTP tại cổng', authorizationMethod: 'otp', otpChallengeId: challenge._id, pickupCode: createPickupCode(), picker: { pickerId: challenge._id, ...challenge.picker.toObject() } }], { session });
      challenge.status = 'verified'; challenge.verifiedAt = new Date(); challenge.verifiedBy = req.user._id; challenge.pickupRecordId = record._id; await challenge.save({ session });
      await Notification.create([{ recipientId: parent._id, title: `Đã xác nhận OTP đón ${challenge.studentName}`, message: `${challenge.picker.fullName} đã được xác nhận là người đón thay trong hôm nay.`, type: 'info', link: '/pickups', createdBy: req.user._id, metadata: { pickupRecordId: record._id, studentId: challenge.studentId } }], { session });
      return record;
    });
    return res.json({ success: true, message: 'OTP hợp lệ, đã tạo lịch bàn giao trong ngày', data: item });
  } catch (error) { return sendError(res, error, 'Không thể xác nhận OTP'); }
};

const listSupplierDeliveries = async (req, res) => {
  try {
    const deliveryDate = req.query.date || today();
    if (!isValidWorkDate(deliveryDate)) throw fail('Ngày giao hàng không hợp lệ');
    const filter = deliveryDate === today() ? { $or: [{ deliveryDate }, { status: 'inside' }] } : { deliveryDate };
    const data = await SupplierDelivery.find(filter).sort({ checkInAt: -1 }).lean();
    return res.json({ success: true, data });
  } catch (error) { return sendError(res, error, 'Không thể tải sổ giao hàng'); }
};

const listExpectedDeliveries = async (req, res) => {
  try {
    const data = await PurchaseOrder.find({ status: 'ordered' }).select('_id orderCode supplierName expectedDelivery items').sort({ expectedDelivery: 1 }).limit(100).lean();
    return res.json({ success: true, data });
  } catch (error) { return sendError(res, error, 'Không thể tải đơn hàng đang chờ'); }
};

const createSupplierDelivery = async (req, res) => {
  try {
    const { purchaseOrderId = null, supplierName, driverName, phone = '', vehiclePlate = '', itemsDescription, recipientName, allowedArea = 'Khu vực giao nhận', note = '', clientEventId = '', occurredAt } = req.body || {};
    if (!clean(supplierName, 161) || !clean(driverName, 121) || !clean(itemsDescription, 1001) || !clean(recipientName, 121)) throw fail('Nhà cung cấp, người giao, hàng hóa và người nhận là bắt buộc');
    if (phone && !/^[0-9+().\s-]{8,20}$/.test(phone)) throw fail('Số điện thoại không hợp lệ');

    const { dateObj, normalizedOccurredAt, workDate: deliveryDate } = resolveEventDateAndTime(occurredAt);
    const canonicalPayloadV2 = canonicalDeliveryPayloadV2({
      deliveryDate,
      occurredAt: normalizedOccurredAt,
      purchaseOrderId,
      supplierName,
      driverName,
      phone,
      vehiclePlate,
      itemsDescription,
      recipientName,
      allowedArea,
      note
    });
    const canonicalPayloadV1 = canonicalDeliveryPayloadV1({
      deliveryDate,
      purchaseOrderId,
      supplierName,
      driverName,
      phone,
      vehiclePlate,
      itemsDescription,
      recipientName,
      allowedArea,
      note
    });
    const payloadFingerprint = computeFingerprintV2(canonicalPayloadV2);

    if (clientEventId) {
      const repeated = await SupplierDelivery.findOne({ clientEventId }).lean();
      if (repeated) {
        const verify = verifyIdempotency({
          existingDoc: repeated,
          currentUserId: req.user._id,
          ownerField: 'recordedBy',
          incomingFingerprint: payloadFingerprint,
          incomingCanonicalV2: canonicalPayloadV2,
          incomingCanonicalV1: canonicalPayloadV1,
          incomingNormalizedOccurredAt: normalizedOccurredAt,
          canonicalFromDocV1Fn: canonicalDeliveryFromDocV1,
          canonicalFromDocV2Fn: canonicalDeliveryFromDocV2
        });
        if (verify.status === 'conflict') {
          return res.status(409).json({ success: false, message: verify.message });
        }
        return res.json({ success: true, repeated: true, message: 'Dữ liệu ngoại tuyến đã được đồng bộ trước đó', data: verify.doc });
      }
    }

    if (deliveryDate !== today()) {
      throw fail('Dữ liệu ngoại tuyến chỉ được đồng bộ trong đúng ngày phát sinh', 422);
    }

    let order = null;
    if (purchaseOrderId) { if (!isValidObjectId(purchaseOrderId)) throw fail('Mã đơn hàng không hợp lệ'); order = await PurchaseOrder.findOne({ _id: purchaseOrderId, status: 'ordered' }).select('orderCode supplierName'); if (!order) throw fail('Đơn hàng không còn ở trạng thái chờ giao', 409); }
    const item = await SupplierDelivery.create({ deliveryDate, purchaseOrderId: order?._id || null, orderCode: order?.orderCode || '', supplierName: clean(supplierName || order?.supplierName, 160), driverName: clean(driverName, 120), phone: clean(phone, 20), vehiclePlate: clean(vehiclePlate, 20).toUpperCase(), itemsDescription: clean(itemsDescription, 1000), recipientName: clean(recipientName, 120), allowedArea: clean(allowedArea, 160), note: clean(note), checkInAt: dateObj, ...(clientEventId ? { clientEventId: clean(clientEventId, 100), payloadFingerprint } : {}), recordedBy: req.user._id, recordedByName: actorName(req.user) });
    return res.status(201).json({ success: true, message: 'Đã ghi nhận nhà cung cấp vào giao hàng', data: item });
  } catch (error) {
    if (error?.code === 11000) {
      const isClientEventConflict = error.keyPattern?.clientEventId || (error.message && error.message.includes('clientEventId'));
      if (req.body?.clientEventId && isClientEventConflict) {
        const repeated = await SupplierDelivery.findOne({ clientEventId: req.body.clientEventId }).lean();
        if (repeated) {
          const { normalizedOccurredAt, workDate: deliveryDate } = resolveEventDateAndTime(req.body.occurredAt);
          const canonicalPayloadV2 = canonicalDeliveryPayloadV2({
            deliveryDate,
            occurredAt: normalizedOccurredAt,
            purchaseOrderId: req.body.purchaseOrderId,
            supplierName: req.body.supplierName,
            driverName: req.body.driverName,
            phone: req.body.phone,
            vehiclePlate: req.body.vehiclePlate,
            itemsDescription: req.body.itemsDescription,
            recipientName: req.body.recipientName,
            allowedArea: req.body.allowedArea,
            note: req.body.note
          });
          const canonicalPayloadV1 = canonicalDeliveryPayloadV1({
            deliveryDate,
            purchaseOrderId: req.body.purchaseOrderId,
            supplierName: req.body.supplierName,
            driverName: req.body.driverName,
            phone: req.body.phone,
            vehiclePlate: req.body.vehiclePlate,
            itemsDescription: req.body.itemsDescription,
            recipientName: req.body.recipientName,
            allowedArea: req.body.allowedArea,
            note: req.body.note
          });
          const payloadFingerprint = computeFingerprintV2(canonicalPayloadV2);
          const verify = verifyIdempotency({
            existingDoc: repeated,
            currentUserId: req.user._id,
            ownerField: 'recordedBy',
            incomingFingerprint: payloadFingerprint,
            incomingCanonicalV2: canonicalPayloadV2,
            incomingCanonicalV1: canonicalPayloadV1,
            incomingNormalizedOccurredAt: normalizedOccurredAt,
            canonicalFromDocV1Fn: canonicalDeliveryFromDocV1,
            canonicalFromDocV2Fn: canonicalDeliveryFromDocV2
          });
          if (verify.status === 'conflict') {
            return res.status(409).json({ success: false, message: verify.message });
          }
          return res.json({ success: true, repeated: true, message: 'Dữ liệu ngoại tuyến đã được đồng bộ trước đó', data: verify.doc });
        }
      }
      return res.status(409).json({ success: false, message: 'Lượt giao hàng bị trùng khóa duy nhất' });
    }
    return sendError(res, error, 'Không thể ghi nhận giao hàng');
  }
};

const checkoutSupplierDelivery = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) throw fail('ID lượt giao hàng không hợp lệ');
    const item = await SupplierDelivery.findById(req.params.id);
    if (!item) throw fail('Không tìm thấy lượt giao hàng', 404);
    if (item.status === 'completed') return res.json({ success: true, message: 'Lượt giao hàng đã hoàn tất trước đó', data: item });
    item.status = 'completed'; item.checkOutAt = new Date(); item.checkedOutBy = req.user._id; item.checkedOutByName = actorName(req.user); await item.save();
    return res.json({ success: true, message: 'Đã ghi nhận xe giao hàng rời trường', data: item });
  } catch (error) { return sendError(res, error, 'Không thể hoàn tất giao hàng'); }
};

const getEmergencyMode = async (req, res) => {
  try { return res.json({ success: true, data: await GuardEmergencyMode.findOne({ status: 'active' }).sort({ activatedAt: -1 }).lean() }); }
  catch (error) { return sendError(res, error, 'Không thể tải trạng thái khẩn cấp'); }
};

const activateEmergencyMode = async (req, res) => {
  try {
    const { level, title, instructions } = req.body || {};
    if (!['security', 'fire', 'medical', 'evacuation', 'lockdown'].includes(level) || !clean(title, 161) || !clean(instructions, 2001)) throw fail('Vui lòng chọn loại, tiêu đề và hướng dẫn khẩn cấp');
    if (await GuardEmergencyMode.exists({ status: 'active' })) throw fail('Đang có một chế độ khẩn cấp hoạt động', 409);
    const item = await GuardEmergencyMode.create({ level, title: clean(title, 160), instructions: clean(instructions, 2000), activatedBy: req.user._id, activatedByName: actorName(req.user) });
    const recipients = await User.find({ status: 'active', role: { $in: ['admin', 'principal', 'teacher', 'guard', 'hr'] } }).select('_id').lean();
    if (recipients.length) await Notification.insertMany(recipients.filter((user) => String(user._id) !== String(req.user._id)).map((user) => ({ recipientId: user._id, title: `KHẨN CẤP: ${item.title}`, message: item.instructions, type: 'warning', link: '/guard', createdBy: req.user._id, metadata: { emergencyModeId: item._id, priority: 'high' } })));
    return res.status(201).json({ success: true, message: 'Đã kích hoạt chế độ khẩn cấp và gửi cảnh báo', data: item });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, message: 'Đang có một chế độ khẩn cấp hoạt động' });
    return sendError(res, error, 'Không thể kích hoạt chế độ khẩn cấp');
  }
};

const resolveEmergencyMode = async (req, res) => {
  try {
    if (!['admin', 'principal'].includes(req.user.role)) throw fail('Chỉ hiệu trưởng hoặc quản trị viên được kết thúc chế độ khẩn cấp', 403);
    if (!isValidObjectId(req.params.id)) throw fail('ID tình huống khẩn cấp không hợp lệ');
    const note = clean(req.body?.resolutionNote, 1000);
    if (!note) throw fail('Vui lòng nhập kết quả xử lý');
    const item = await GuardEmergencyMode.findOneAndUpdate({ _id: req.params.id, status: 'active' }, { $set: { status: 'resolved', resolvedAt: new Date(), resolvedBy: req.user._id, resolvedByName: actorName(req.user), resolutionNote: note } }, { returnDocument: 'after' });
    if (!item) throw fail('Tình huống không còn hoạt động', 409);
    return res.json({ success: true, message: 'Đã kết thúc chế độ khẩn cấp', data: item });
  } catch (error) { return sendError(res, error, 'Không thể kết thúc chế độ khẩn cấp'); }
};

const getGuardReport = async (req, res) => {
  try {
    const endDate = req.query.endDate || today();
    const startDate = req.query.startDate || endDate;
    if (!isValidWorkDate(startDate) || !isValidWorkDate(endDate) || startDate > endDate) throw fail('Khoảng ngày báo cáo không hợp lệ');
    const days = Math.floor((new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86400000) + 1;
    if (days > 92) throw fail('Báo cáo tối đa 92 ngày');
    const [gate, pickups, visitors, deliveries, incidents, handovers] = await Promise.all([
      StudentGateEvent.find({ gateDate: { $gte: startDate, $lte: endDate } }).select('gateDate direction').lean(),
      PickupRecord.find({ pickupDate: { $gte: startDate, $lte: endDate } }).select('pickupDate status authorizationMethod').lean(),
      SchoolVisitor.find({ visitDate: { $gte: startDate, $lte: endDate } }).select('visitDate status').lean(),
      SupplierDelivery.find({ deliveryDate: { $gte: startDate, $lte: endDate } }).select('deliveryDate status').lean(),
      SecurityIncident.find({ incidentDate: { $gte: startDate, $lte: endDate } }).select('incidentDate severity status').lean(),
      GuardShiftHandover.find({ handoverDate: { $gte: startDate, $lte: endDate } }).select('handoverDate status').lean()
    ]);
    const daily = new Map();
    const row = (date) => { if (!daily.has(date)) daily.set(date, { date, arrivals: 0, departures: 0, pickups: 0, visitors: 0, deliveries: 0, incidents: 0, handovers: 0 }); return daily.get(date); };
    gate.forEach((item) => { row(item.gateDate)[item.direction === 'arrival' ? 'arrivals' : 'departures'] += 1; });
    pickups.filter((item) => item.status === 'confirmed').forEach((item) => { row(item.pickupDate).pickups += 1; });
    visitors.forEach((item) => { row(item.visitDate).visitors += 1; }); deliveries.forEach((item) => { row(item.deliveryDate).deliveries += 1; }); incidents.forEach((item) => { row(item.incidentDate).incidents += 1; }); handovers.forEach((item) => { row(item.handoverDate).handovers += 1; });
    const totals = { arrivals: gate.filter((i) => i.direction === 'arrival').length, departures: gate.filter((i) => i.direction === 'departure').length, pickups: pickups.filter((i) => i.status === 'confirmed').length, otpPickups: pickups.filter((i) => i.authorizationMethod === 'otp').length, visitors: visitors.length, deliveries: deliveries.length, incidents: incidents.length, emergencyIncidents: incidents.filter((i) => i.severity === 'emergency').length, handovers: handovers.length };
    return res.json({ success: true, data: { startDate, endDate, totals, daily: [...daily.values()].sort((a, b) => b.date.localeCompare(a.date)) } });
  } catch (error) { return sendError(res, error, 'Không thể lập báo cáo cổng trường'); }
};

module.exports = { getDashboard, searchStudents, listGateEvents, recordGateEvent, listVisitors, createVisitor, checkoutVisitor, listIncidents, createIncident, updateIncident, acknowledgeIncident, addManagementInstruction, listHandovers, listReceivers, createHandover, acceptHandover, resolveQrCode, requestPickupOtp, verifyPickupOtp, listSupplierDeliveries, listExpectedDeliveries, createSupplierDelivery, checkoutSupplierDelivery, getEmergencyMode, activateEmergencyMode, resolveEmergencyMode, getGuardReport };
