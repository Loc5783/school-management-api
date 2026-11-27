'use strict';

/**
 * @fileoverview Bộ điều khiển Quản lý Đón & Trả trẻ (`pickupController.js`).
 * Hỗ trợ song song 2 luồng thực tế tại trường mầm non:
 * 1. Luồng Phụ huynh đăng ký trước trên cổng Phụ huynh / Bảo vệ xác thực OTP người đón lạ.
 * 2. Luồng Trả trẻ trực tiếp 1 chạm tại lớp (`getClassroomPickupRoster` & `directHandover`):
 *    Giáo viên/Bảo vệ chọn trực tiếp Bố/Mẹ/Người được ủy quyền từ hồ sơ học sinh đang có mặt
 *    mà không bắt buộc phụ huynh phải thao tác đặt lịch trước mỗi chiều.
 */

const mongoose = require('mongoose');
const crypto = require('crypto');
const PickupRecord = require('../models/zone3_school/PickupRecord');
const Student = require('../models/zone3_school/Student');
const Classroom = require('../models/zone3_school/Classroom');
const StudentAttendance = require('../models/zone3_school/StudentAttendance');
const Notification = require('../models/zone1_system/Notification');
const StudentGateEvent = require('../models/zone3_school/StudentGateEvent');
const User = require('../models/zone1_system/User');
const PickupOtpChallenge = require('../models/zone3_school/PickupOtpChallenge');
const { canAccessStudent, getLinkedStudentIds, isParent } = require('../services/studentAccessService');
const { canAccessClassroom, getTeacherClassroomIds } = require('../services/schoolDataAccessService');
const { isValidObjectId } = require('../utils/idValidation');
const { buildTenantFilter, resolveTenantContext } = require('../services/tenantFilterService');
const { runSafeTransaction } = require('../utils/safeTransaction');
const {
  DEFAULT_SCHOOL_TIMEZONE,
  getWorkDate,
  getWorkDateRange,
  isValidWorkDate
} = require('../utils/dateHelpers');

const PARENT_RELATIONSHIP_LABEL = {
  father: 'Bố',
  mother: 'Mẹ',
  guardian: 'Người giám hộ'
};

const STAFF_PICKUP_ROLES = ['teacher', 'guard', 'admin', 'principal'];

const resolveRequestTenantId = (req) => {
  const resolved = resolveTenantContext(req);
  if (resolved.isValid && resolved.isSaaS && resolved.tenantId) {
    return new mongoose.Types.ObjectId(String(resolved.tenantId));
  }
  return req.tenantId || req.user?.tenantId || null;
};

const today = () => getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
const actorName = (user) => user?.profile?.fullName || user?.username || 'Nhân viên nhà trường';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const createPickupCode = () => crypto.randomBytes(8).toString('hex').toUpperCase();

const accessStudent = async (user, student, req = null) => {
  if (isParent(user)) return canAccessStudent(user, student._id);
  if (user.role === 'teacher') return canAccessClassroom(user, student.classroomId, req || user);
  return ['guard', 'admin', 'principal'].includes(user.role);
};

const loadStudent = async (studentId, tenantFilter = {}) => {
  if (!isValidObjectId(studentId)) throw fail('ID học sinh không hợp lệ');
  const student = await Student.findOne({ ...tenantFilter, _id: studentId })
    .select('fullName classroomId currentClassName className authorizedPickers parents status')
    .lean();
  if (!student) throw fail('Không tìm thấy học sinh', 404);
  return student;
};

/**
 * Chuẩn hóa danh sách người đón gợi ý từ `authorizedPickers` + `parents` của học sinh
 * để giáo viên chọn nhanh 1 chạm ngay trên màn hình trả trẻ buổi chiều.
 *
 * @param {Object} student
 * @returns {Array<{ key: string, pickerId: string, fullName: string, phone: string, relationship: string }>}
 */
const buildStudentPickerOptions = (student) => {
  const options = [];
  const seenKeys = new Set();

  const activePickers = Array.isArray(student?.authorizedPickers)
    ? student.authorizedPickers.filter((item) => item && item.isActive !== false && String(item.fullName || '').trim())
    : [];

  for (const picker of activePickers) {
    const fullName = String(picker.fullName || '').trim();
    const phone = String(picker.phone || '').trim();
    const dedupKey = `${fullName.toLowerCase()}|${phone}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);
    options.push({
      key: String(picker._id || dedupKey),
      pickerId: picker._id ? String(picker._id) : '',
      fullName,
      phone,
      relationship: String(picker.relationship || 'Người được ủy quyền').trim()
    });
  }

  const parents = Array.isArray(student?.parents) ? student.parents : [];
  for (let idx = 0; idx < parents.length; idx += 1) {
    const parent = parents[idx];
    const fullName = String(parent?.fullName || '').trim();
    if (!fullName) continue;
    const phone = String(parent?.phone || '').trim();
    const dedupKey = `${fullName.toLowerCase()}|${phone}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);
    options.push({
      key: `parent-${idx}-${phone || fullName}`,
      pickerId: '',
      fullName,
      phone,
      relationship: PARENT_RELATIONSHIP_LABEL[parent.relationship] || parent.relationship || 'Phụ huynh'
    });
  }

  return options;
};

/**
 * Trả danh sách lớp hoạt động được phép xem để Giáo viên / Bảo vệ / BGH chọn lớp trả trẻ nhanh
 * (tránh lỗi 403 khi Bảo vệ gọi sang /api/classrooms của phân hệ quản lý lớp).
 */
const listPickupClassrooms = async (req, res) => {
  try {
    if (!STAFF_PICKUP_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền xem danh sách lớp trả trẻ' });
    }
    const tenantFilter = buildTenantFilter(req);
    const filter = { ...tenantFilter, status: 'active' };
    if (req.user.role === 'teacher') {
      const teacherClassIds = await getTeacherClassroomIds(req.user, req);
      filter._id = { $in: teacherClassIds };
    }
    const classrooms = await Classroom.find(filter)
      .select('_id name fullName campus ageGroup statistics')
      .sort({ campus: 1, name: 1 })
      .lean();
    return res.json({ success: true, data: classrooms });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Không thể tải danh sách lớp trả trẻ'
    });
  }
};

const listPickupRecords = async (req, res) => {
  try {
    const pickupDate = req.query.pickupDate || today();
    if (!isValidWorkDate(pickupDate)) return res.status(400).json({ success: false, message: 'Ngày đón không hợp lệ' });
    const tenantFilter = buildTenantFilter(req);
    const filter = { ...tenantFilter, pickupDate };
    if (isParent(req.user)) filter.studentId = { $in: getLinkedStudentIds(req.user) };
    else if (req.user.role === 'teacher') filter.classroomId = { $in: await getTeacherClassroomIds(req.user, req) };
    else if (!['guard', 'admin', 'principal'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Bạn không có quyền xem lịch đón trẻ' });
    if (req.query.studentId) {
      if (!isValidObjectId(req.query.studentId)) return res.status(400).json({ success: false, message: 'ID học sinh không hợp lệ' });
      if (isParent(req.user) && !canAccessStudent(req.user, req.query.studentId)) return res.status(403).json({ success: false, message: 'Bạn không có quyền xem lịch đón của học sinh này' });
      filter.studentId = req.query.studentId;
    }
    if (req.query.classroomId) {
      if (!isValidObjectId(req.query.classroomId)) return res.status(400).json({ success: false, message: 'ID lớp không hợp lệ' });
      if (req.user.role === 'teacher') {
        const teacherClassIds = await getTeacherClassroomIds(req.user, req);
        if (!teacherClassIds.map(String).includes(String(req.query.classroomId))) {
          return res.status(403).json({ success: false, message: 'Bạn không có quyền truy cập lớp học này' });
        }
      }
      filter.classroomId = req.query.classroomId;
    }
    const records = await PickupRecord.find(filter).sort({ expectedPickupTime: 1, createdAt: -1 }).lean();
    const data = records.map((record) => {
      const { pickupCode, ...safeRecord } = record;
      return isParent(req.user) ? { ...safeRecord, pickupQrPayload: pickupCode ? `PICKUP:${pickupCode}` : '' } : safeRecord;
    });
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Không thể tải lịch đón trẻ' });
  }
};

/**
 * Lấy danh sách học sinh của lớp kèm trạng thái điểm danh buổi sáng, danh sách Bố/Mẹ/Người đón
 * và trạng thái đã trả trẻ trong ngày để Giáo viên/Bảo vệ thao tác trả trẻ 1 chạm.
 */
const getClassroomPickupRoster = async (req, res) => {
  try {
    const { classroomId } = req.params;
    if (!isValidObjectId(classroomId)) {
      return res.status(400).json({ success: false, message: 'ID lớp học không hợp lệ' });
    }
    const pickupDate = req.query.pickupDate || today();
    if (!isValidWorkDate(pickupDate)) {
      return res.status(400).json({ success: false, message: 'Ngày đón không hợp lệ' });
    }
    if (!STAFF_PICKUP_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền xem danh sách trả trẻ của lớp' });
    }
    if (req.user.role === 'teacher' && !(await canAccessClassroom(req.user, classroomId, req))) {
      return res.status(403).json({ success: false, message: 'Bạn không được phân công phụ trách lớp học này' });
    }

    const tenantFilter = buildTenantFilter(req);
    const { start, end } = getWorkDateRange(pickupDate, DEFAULT_SCHOOL_TIMEZONE);

    // Chạy song song 5 truy vấn chỉ đọc (.lean() + .select()) tránh N+1
    const [classroom, students, attendances, pickupRecords, gateDepartures] = await Promise.all([
      Classroom.findOne({ ...tenantFilter, _id: classroomId }).select('_id name fullName campus').lean(),
      Student.find({ ...tenantFilter, classroomId, status: 'enrolled' })
        .select('_id studentCode fullName classroomId currentClassName className parents authorizedPickers')
        .sort({ fullName: 1 })
        .lean(),
      StudentAttendance.find({
        ...tenantFilter,
        classroomId,
        $or: [
          { attendanceDateKey: pickupDate },
          { attendDate: { $gte: start, $lt: end } }
        ]
      })
        .select('studentId status checkInTime checkOutTime pickerName')
        .lean(),
      PickupRecord.find({
        ...tenantFilter,
        classroomId,
        pickupDate,
        status: { $in: ['scheduled', 'confirmed'] }
      })
        .select('_id studentId status expectedPickupTime picker confirmedAt confirmedByName note authorizationMethod')
        .sort({ createdAt: -1 })
        .lean(),
      StudentGateEvent.find({
        ...tenantFilter,
        classroomId,
        gateDate: pickupDate,
        direction: 'departure'
      })
        .select('studentId occurredAt recordedByName note pickupRecordId')
        .lean()
    ]);

    if (!classroom) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy lớp học' });
    }

    const attendanceMap = new Map(attendances.map((item) => [String(item.studentId), item]));
    const gateDepartureMap = new Map(gateDepartures.map((item) => [String(item.studentId), item]));
    const scheduledByStudent = new Map();
    const confirmedByStudent = new Map();

    for (const rec of pickupRecords) {
      const sid = String(rec.studentId);
      if (rec.status === 'confirmed' && !confirmedByStudent.has(sid)) {
        confirmedByStudent.set(sid, rec);
      } else if (rec.status === 'scheduled' && !scheduledByStudent.has(sid)) {
        scheduledByStudent.set(sid, rec);
      }
    }

    let presentCount = 0;
    let departedCount = 0;

    const roster = students.map((student) => {
      const sid = String(student._id);
      const att = attendanceMap.get(sid) || null;
      const attendanceStatus = att?.status || 'unmarked';
      const isPresentToday = attendanceStatus === 'present' || attendanceStatus === 'late';
      if (isPresentToday) presentCount += 1;

      const confirmedPickup = confirmedByStudent.get(sid) || null;
      const scheduledPickup = scheduledByStudent.get(sid) || null;
      const gateDeparture = gateDepartureMap.get(sid) || null;
      const departed = Boolean(confirmedPickup || gateDeparture || att?.checkOutTime);
      if (departed) departedCount += 1;

      const pickerOptions = buildStudentPickerOptions(student);

      return {
        studentId: student._id,
        studentCode: student.studentCode,
        fullName: student.fullName,
        className: classroom.name,
        attendanceStatus,
        isPresentToday,
        checkInTime: att?.checkInTime || null,
        pickerOptions,
        scheduledPickup,
        confirmedPickup,
        confirmedPickupId: confirmedPickup?._id || gateDeparture?.pickupRecordId || null,
        departed,
        departedAt: confirmedPickup?.confirmedAt || gateDeparture?.occurredAt || att?.checkOutTime || null,
        departedPickerName: confirmedPickup?.picker?.fullName || att?.pickerName || '',
        departedRelationship: confirmedPickup?.picker?.relationship || '',
        departedConfirmedBy: confirmedPickup?.confirmedByName || gateDeparture?.recordedByName || ''
      };
    });

    return res.json({
      success: true,
      data: {
        classroom,
        pickupDate,
        summary: {
          totalStudents: roster.length,
          presentCount,
          departedCount,
          waitingCount: Math.max(0, (presentCount || roster.length) - departedCount)
        },
        roster
      }
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Không thể tải danh sách trả trẻ của lớp'
    });
  }
};

/**
 * Xác nhận trả trẻ trực tiếp tại lớp (1 chạm) mà không cần phụ huynh phải đặt lịch trước trên web.
 * Đồng bộ nguyên tử trong 1 MongoDB Transaction:
 * - Ghi nhận/cập nhật `PickupRecord` (`confirmed`)
 * - Ghi sự kiện cổng `StudentGateEvent` (`departure`)
 * - Cập nhật `checkOutTime` & `pickerName` trên `StudentAttendance` hôm nay (nếu có)
 * - Gửi thông báo tức thời tới tất cả tài khoản Phụ huynh đã liên kết với bé
 */
const directHandover = async (req, res) => {
  try {
    const {
      studentId,
      pickupDate = today(),
      pickerKey = '',
      pickerId = '',
      pickerFullName = '',
      pickerPhone = '',
      pickerRelationship = '',
      note = ''
    } = req.body || {};

    if (!isValidObjectId(studentId)) throw fail('ID học sinh không hợp lệ');
    if (!isValidWorkDate(pickupDate) || pickupDate !== today()) {
      throw fail('Chỉ xác nhận bàn giao trả trẻ trong đúng ngày hôm nay', 409);
    }
    const cleanNote = String(note || '').trim();
    if (cleanNote.length > 500) throw fail('Ghi chú bàn giao tối đa 500 ký tự');

    const handoverRecord = await runSafeTransaction(async (session) => {
      const sessionOpt = session ? { session } : undefined;
      const tenantFilter = buildTenantFilter(req);
      const tenantId = resolveRequestTenantId(req);

      const student = await Student.findOne({ ...tenantFilter, _id: studentId })
        .select('studentCode fullName classroomId currentClassName className parents authorizedPickers status')
        .session(session);
      if (!student || student.status !== 'enrolled') {
        throw fail('Học sinh không tồn tại hoặc không còn đang theo học', 404);
      }
      if (!(await accessStudent(req.user, student, req)) || !STAFF_PICKUP_ROLES.includes(req.user.role)) {
        throw fail('Bạn không có quyền xác nhận trả trẻ cho học sinh này', 403);
      }

      const existingDeparture = await StudentGateEvent.findOne({
        ...tenantFilter,
        studentId: student._id,
        gateDate: pickupDate,
        direction: 'departure'
      }).session(session);
      if (existingDeparture) {
        throw fail('Học sinh đã được xác nhận đón về trước đó trong ngày hôm nay', 409);
      }

      // Bước 1: Xác định thông tin người đón từ danh sách Bố/Mẹ/Ủy quyền hoặc nhập tay
      const options = buildStudentPickerOptions(student);
      let chosen = null;
      if (pickerId && isValidObjectId(pickerId)) {
        chosen = options.find((opt) => opt.pickerId === String(pickerId)) || null;
      }
      if (!chosen && pickerKey) {
        chosen = options.find((opt) => opt.key === String(pickerKey)) || null;
      }
      if (!chosen && pickerFullName) {
        const cleanName = String(pickerFullName).trim();
        if (cleanName.length < 2) throw fail('Vui lòng nhập họ tên người đón hợp lệ');
        chosen = {
          pickerId: '',
          fullName: cleanName,
          phone: String(pickerPhone || '').trim(),
          relationship: String(pickerRelationship || 'Người thân').trim()
        };
      }
      if (!chosen && options.length > 0) {
        chosen = options[0];
      }
      if (!chosen) {
        throw fail('Vui lòng chọn hoặc nhập họ tên người đón trẻ');
      }

      const resolvedPickerObjectId = isValidObjectId(chosen.pickerId)
        ? new mongoose.Types.ObjectId(chosen.pickerId)
        : new mongoose.Types.ObjectId();

      const now = new Date();
      const staffDisplayName = actorName(req.user);

      // Bước 2: Tìm các tài khoản phụ huynh liên kết với học sinh để gửi thông báo
      const parentUsers = await User.find({
        ...tenantFilter,
        role: 'parent',
        status: 'active',
        'parentInfo.studentIds': student._id
      })
        .select('_id')
        .session(session)
        .lean();

      // Bước 3: Nếu phụ huynh đã đặt lịch trước hôm nay thì cập nhật luôn bản ghi đó, ngược lại tạo mới
      const scheduledRecord = await PickupRecord.findOne({
        ...tenantFilter,
        studentId: student._id,
        pickupDate,
        status: 'scheduled'
      }).session(session);

      let savedRecord = null;
      if (scheduledRecord) {
        scheduledRecord.picker = {
          ...scheduledRecord.picker?.toObject?.(),
          pickerId: scheduledRecord.picker?.pickerId || resolvedPickerObjectId,
          fullName: chosen.fullName,
          phone: chosen.phone || scheduledRecord.picker?.phone || '',
          relationship: chosen.relationship || scheduledRecord.picker?.relationship || ''
        };
        scheduledRecord.status = 'confirmed';
        scheduledRecord.confirmedBy = req.user._id;
        scheduledRecord.confirmedByName = staffDisplayName;
        scheduledRecord.confirmedAt = now;
        scheduledRecord.confirmationNote = cleanNote;
        await scheduledRecord.save(sessionOpt);
        savedRecord = scheduledRecord;
      } else {
        const [created] = await PickupRecord.create(
          [
            {
              ...(tenantId ? { tenantId } : {}),
              studentId: student._id,
              studentName: student.fullName,
              classroomId: student.classroomId,
              className: student.currentClassName || student.className || 'Lớp học',
              requesterId: parentUsers[0]?._id || req.user._id,
              requesterName: chosen.fullName,
              pickupDate,
              expectedPickupTime: '',
              note: cleanNote,
              pickupCode: createPickupCode(),
              authorizationMethod: 'registered',
              picker: {
                pickerId: resolvedPickerObjectId,
                fullName: chosen.fullName,
                phone: chosen.phone || '',
                relationship: chosen.relationship || 'Phụ huynh'
              },
              status: 'confirmed',
              confirmedBy: req.user._id,
              confirmedByName: staffDisplayName,
              confirmedAt: now,
              confirmationNote: cleanNote
            }
          ],
          sessionOpt
        );
        savedRecord = created;
      }

      // Bước 4: Lưu nhật ký cổng ra trường & đồng bộ giờ về vào bảng điểm danh trong ngày
      await StudentGateEvent.create(
        [
          {
            ...(tenantId ? { tenantId } : {}),
            studentId: student._id,
            studentName: student.fullName,
            studentCode: student.studentCode,
            classroomId: student.classroomId,
            className: savedRecord.className,
            gateDate: pickupDate,
            direction: 'departure',
            occurredAt: now,
            method: 'pickup',
            note: cleanNote,
            pickupRecordId: savedRecord._id,
            recordedBy: req.user._id,
            recordedByName: staffDisplayName
          }
        ],
        sessionOpt
      );

      const { start, end } = getWorkDateRange(pickupDate, DEFAULT_SCHOOL_TIMEZONE);
      await StudentAttendance.updateOne(
        {
          ...tenantFilter,
          studentId: student._id,
          $or: [
            { attendanceDateKey: pickupDate },
            { attendDate: { $gte: start, $lt: end } }
          ]
        },
        {
          $set: {
            checkOutTime: now,
            pickerName: `${chosen.fullName}${chosen.relationship ? ` (${chosen.relationship})` : ''}`
          }
        },
        sessionOpt
      );

      // Bước 5: Gửi thông báo cho toàn bộ tài khoản Phụ huynh của bé (cả Bố & Mẹ)
      if (parentUsers.length > 0) {
        const timeStr = now.toLocaleTimeString('vi-VN', {
          timeZone: DEFAULT_SCHOOL_TIMEZONE,
          hour: '2-digit',
          minute: '2-digit'
        });
        await Notification.insertMany(
          parentUsers.map((parentUser) => ({
            ...(tenantId ? { tenantId } : {}),
            recipientId: parentUser._id,
            title: `Đã đón bé: ${student.fullName}`,
            message: `${chosen.fullName}${chosen.relationship ? ` (${chosen.relationship})` : ''} đã đón bé ${student.fullName} lúc ${timeStr}.`,
            type: 'attendance',
            link: '/pickups',
            createdBy: req.user._id,
            metadata: { pickupRecordId: savedRecord._id, studentId: student._id }
          })),
          sessionOpt
        );
      }

      return savedRecord;
    });

    return res.status(201).json({
      success: true,
      message: `Đã xác nhận trả bé ${handoverRecord.studentName} cho ${handoverRecord.picker.fullName}`,
      data: handoverRecord
    });
  } catch (error) {
    const status = error.code === 11000 ? 409 : (error.status || 500);
    const message = error.code === 11000
      ? 'Học sinh đã được bàn giao trong ngày hôm nay'
      : (error.message || 'Không thể xác nhận trả trẻ');
    return res.status(status).json({ success: false, message });
  }
};

const createPickupRecord = async (req, res) => {
  try {
    const { studentId, pickerId, pickupDate = today(), expectedPickupTime = '', note = '' } = req.body || {};
    if (!isValidWorkDate(pickupDate) || pickupDate < today()) throw fail('Chỉ có thể đăng ký đón trẻ từ hôm nay trở đi');
    if (!isValidObjectId(pickerId)) throw fail('Vui lòng chọn người được ủy quyền đón trẻ');
    if (expectedPickupTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(expectedPickupTime)) throw fail('Giờ dự kiến phải có dạng HH:mm');
    if (String(note).trim().length > 500) throw fail('Ghi chú tối đa 500 ký tự');
    const tenantFilter = buildTenantFilter(req);
    const tenantId = resolveRequestTenantId(req);
    const student = await loadStudent(studentId, tenantFilter);
    if (!await accessStudent(req.user, student, req) || !isParent(req.user)) throw fail('Bạn chỉ được đăng ký đón cho con đã liên kết', 403);
    const picker = student.authorizedPickers?.find((item) => String(item._id) === String(pickerId) && item.isActive !== false);
    if (!picker) throw fail('Người này không còn trong danh sách được phép đón trẻ');
    const existing = await PickupRecord.exists({ ...tenantFilter, studentId: student._id, pickupDate, status: 'scheduled' });
    if (existing) throw fail('Đã có một yêu cầu đón trẻ đang hiệu lực trong ngày này', 409);
    const identity = String(picker.identityCard || '');
    const item = await PickupRecord.create({
      ...(tenantId ? { tenantId } : {}),
      studentId: student._id, studentName: student.fullName, classroomId: student.classroomId,
      className: student.currentClassName || student.className || '', requesterId: req.user._id,
      requesterName: actorName(req.user), pickupDate, expectedPickupTime, note: String(note).trim(), pickupCode: createPickupCode(),
      picker: { pickerId: picker._id, fullName: picker.fullName, phone: picker.phone || '', relationship: picker.relationship || '', identityCardLast4: identity.slice(-4), photoURL: picker.photoURL || '', vehicleType: picker.vehicleType || '', vehiclePlate: picker.vehiclePlate || '' }
    });
    const guards = await User.find({ ...tenantFilter, role: 'guard', status: 'active' }).select('_id').lean();
    if (guards.length) await Notification.insertMany(guards.map((guard) => ({ ...(tenantId ? { tenantId } : {}), recipientId: guard._id, title: `Lịch đón mới: ${student.fullName}`, message: `${picker.fullName} dự kiến đón trẻ lúc ${expectedPickupTime || 'chưa xác định giờ'}.`, type: 'info', link: '/pickups', createdBy: req.user._id, metadata: { pickupRecordId: item._id, studentId: student._id } })));
    const data = item.toObject(); delete data.pickupCode; data.pickupQrPayload = `PICKUP:${item.pickupCode}`;
    return res.status(201).json({ success: true, message: 'Đã đăng ký người đón trẻ. Giáo viên/bảo vệ sẽ xác nhận khi bàn giao.', data });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Không thể đăng ký đón trẻ' });
  }
};

/**
 * Hoàn tác bàn giao trẻ khi Giáo viên / Bảo vệ bấm nhầm học sinh hoặc chọn nhầm người đón trong ngày hôm nay.
 * Xóa nguyên tử sự kiện rời cổng `StudentGateEvent`, trả `StudentAttendance.checkOutTime` về rỗng
 * và đánh dấu hủy `PickupRecord` để có thể thao tác trả trẻ lại đúng người.
 */
const undoHandover = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) throw fail('ID bàn giao không hợp lệ');
    const reason = String(req.body?.reason || 'Hoàn tác do bấm nhầm tại lớp').trim().slice(0, 500);

    const reverted = await runSafeTransaction(async (session) => {
      const sessionOpt = session ? { session } : undefined;
      const tenantFilter = buildTenantFilter(req);

      const record = await PickupRecord.findOne({ ...tenantFilter, _id: req.params.id }).session(session);
      if (!record) throw fail('Không tìm thấy bản ghi bàn giao trẻ', 404);
      if (
        !(await accessStudent(req.user, { _id: record.studentId, classroomId: record.classroomId }, req)) ||
        !STAFF_PICKUP_ROLES.includes(req.user.role)
      ) {
        throw fail('Bạn không có quyền hoàn tác bàn giao của lớp này', 403);
      }
      if (record.pickupDate !== today()) {
        throw fail('Chỉ được phép hoàn tác bàn giao nhầm ngay trong ngày hôm nay', 409);
      }
      if (record.status !== 'confirmed') {
        throw fail('Bản ghi này chưa ở trạng thái đã bàn giao nên không thể hoàn tác', 409);
      }

      record.status = 'cancelled';
      record.cancelledAt = new Date();
      record.cancellationReason = reason;
      await record.save(sessionOpt);

      await StudentGateEvent.deleteOne(
        {
          ...tenantFilter,
          studentId: record.studentId,
          gateDate: record.pickupDate,
          direction: 'departure'
        },
        sessionOpt
      );

      const { start, end } = getWorkDateRange(record.pickupDate, DEFAULT_SCHOOL_TIMEZONE);
      await StudentAttendance.updateOne(
        {
          ...tenantFilter,
          studentId: record.studentId,
          $or: [
            { attendanceDateKey: record.pickupDate },
            { attendDate: { $gte: start, $lt: end } }
          ]
        },
        { $set: { checkOutTime: null, pickerName: '' } },
        sessionOpt
      );

      return record;
    });

    return res.json({
      success: true,
      message: `Đã hoàn tác bàn giao của bé ${reverted.studentName}. Bạn có thể chọn lại người đón chính xác.`,
      data: reverted
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Không thể hoàn tác bàn giao trẻ'
    });
  }
};

const confirmPickupRecord = async (req, res) => {
  try {
    const { confirmationNote = '', photoCompared = false, vehicleCompared = false } = req.body || {};
    if (!isValidObjectId(req.params.id)) throw fail('ID lịch đón không hợp lệ');
    if (String(confirmationNote).trim().length > 500) throw fail('Ghi chú xác nhận tối đa 500 ký tự');
    const result = await runSafeTransaction(async (session) => {
      const sessionOpt = session ? { session } : undefined;
      const tenantFilter = buildTenantFilter(req);
      const tenantId = resolveRequestTenantId(req);
      const record = await PickupRecord.findOne({ ...tenantFilter, _id: req.params.id }).session(session);
      if (!record) throw fail('Không tìm thấy lịch đón trẻ', 404);
      if (!await accessStudent(req.user, { _id: record.studentId, classroomId: record.classroomId }, req) || !['teacher', 'guard', 'admin', 'principal'].includes(req.user.role)) throw fail('Bạn không có quyền xác nhận bàn giao này', 403);
      if (record.status === 'confirmed') return { record, repeated: true };
      if (record.status !== 'scheduled') throw fail('Lịch đón trẻ này không còn hiệu lực', 409);
      if (record.pickupDate !== today()) throw fail('Chỉ xác nhận bàn giao trong đúng ngày đã đăng ký', 409);
      const student = await Student.findOne({ ...tenantFilter, _id: record.studentId }).select('studentCode authorizedPickers status').session(session);
      if (!student || student.status !== 'enrolled') throw fail('Học sinh không còn đang theo học', 409);
      if (record.authorizationMethod === 'otp') {
        const challenge = await PickupOtpChallenge.findOne({ ...tenantFilter, _id: record.otpChallengeId, status: 'verified', pickupRecordId: record._id }).session(session);
        if (!challenge) throw fail('Xác nhận OTP của người đón không còn hiệu lực', 409);
      } else if (!student.authorizedPickers?.some((picker) => String(picker._id) === String(record.picker.pickerId) && picker.isActive !== false)) {
        throw fail('Người đón đã bị gỡ hoặc ngừng ủy quyền. Hãy liên hệ phụ huynh xác nhận lại.', 409);
      }
      if (req.user.role === 'guard' && req.body?.identityVerified !== true) throw fail('Vui lòng xác nhận đã đối chiếu người đón trước khi bàn giao');
      if (record.picker.photoURL && photoCompared !== true) throw fail('Vui lòng đối chiếu ảnh người đón trước khi bàn giao');
      if (record.picker.vehiclePlate && vehicleCompared !== true) throw fail('Vui lòng đối chiếu phương tiện và biển số trước khi bàn giao');
      const departure = await StudentGateEvent.findOne({ ...tenantFilter, studentId: record.studentId, gateDate: record.pickupDate, direction: 'departure' }).session(session);
      if (departure) throw fail('Học sinh đã được ghi nhận rời trường trong ngày này', 409);
      record.status = 'confirmed'; record.confirmedBy = req.user._id; record.confirmedByName = actorName(req.user); record.confirmedAt = new Date(); record.confirmationNote = String(confirmationNote).trim(); record.photoCompared = photoCompared === true; record.vehicleCompared = vehicleCompared === true;
      await record.save(sessionOpt);
      await StudentGateEvent.create([{ ...(tenantId ? { tenantId } : {}), studentId: record.studentId, studentName: record.studentName, studentCode: student.studentCode, classroomId: record.classroomId, className: record.className, gateDate: record.pickupDate, direction: 'departure', occurredAt: record.confirmedAt, method: 'pickup', note: record.confirmationNote, pickupRecordId: record._id, recordedBy: req.user._id, recordedByName: actorName(req.user) }], sessionOpt);
      await Notification.create([{ ...(tenantId ? { tenantId } : {}), recipientId: record.requesterId, title: `Đã xác nhận đón trẻ: ${record.studentName}`, message: `${record.picker.fullName} đã đón ${record.studentName} lúc ${record.confirmedAt.toLocaleTimeString('vi-VN', { timeZone: DEFAULT_SCHOOL_TIMEZONE, hour: '2-digit', minute: '2-digit' })}.`, type: 'info', link: '/pickups', createdBy: req.user._id, metadata: { pickupRecordId: record._id, studentId: record.studentId } }], sessionOpt);
      return { record, repeated: false };
    });
    return res.json({ success: true, message: result.repeated ? 'Lịch đón trẻ đã được xác nhận trước đó' : 'Đã xác nhận bàn giao trẻ', data: result.record });
  } catch (error) {
    return res.status(error.code === 11000 ? 409 : error.status || 500).json({ success: false, message: error.code === 11000 ? 'Học sinh đã được bàn giao trong ngày này' : error.message || 'Không thể xác nhận bàn giao trẻ' });
  }
};

const cancelPickupRecord = async (req, res) => {
  try {
    const reason = String(req.body?.reason || '').trim();
    if (!isValidObjectId(req.params.id)) throw fail('ID lịch đón không hợp lệ');
    const tenantFilter = buildTenantFilter(req);
    const tenantId = resolveRequestTenantId(req);
    const record = await PickupRecord.findOne({ ...tenantFilter, _id: req.params.id });
    if (!record) throw fail('Không tìm thấy lịch đón trẻ', 404);
    if (!isParent(req.user) || !canAccessStudent(req.user, record.studentId)) throw fail('Bạn không có quyền hủy lịch đón này', 403);
    if (record.status !== 'scheduled') throw fail('Chỉ có thể hủy lịch đang chờ bàn giao', 409);
    record.status = 'cancelled'; record.cancelledAt = new Date(); record.cancellationReason = reason;
    await record.save();
    const guards = await User.find({ ...tenantFilter, role: 'guard', status: 'active' }).select('_id').lean();
    if (guards.length) await Notification.insertMany(guards.map((guard) => ({ ...(tenantId ? { tenantId } : {}), recipientId: guard._id, title: `Đã hủy lịch đón: ${record.studentName}`, message: `${record.requesterName} đã hủy lịch đón của ${record.studentName}.${reason ? ` Lý do: ${reason}` : ''}`, type: 'warning', link: '/pickups', createdBy: req.user._id, metadata: { pickupRecordId: record._id, studentId: record.studentId } })));
    return res.json({ success: true, message: 'Đã hủy lịch đón trẻ', data: record });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Không thể hủy lịch đón trẻ' });
  }
};

module.exports = {
  listPickupClassrooms,
  listPickupRecords,
  getClassroomPickupRoster,
  directHandover,
  undoHandover,
  createPickupRecord,
  confirmPickupRecord,
  cancelPickupRecord
};
