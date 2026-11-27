'use strict';

/**
 * @fileoverview Dịch vụ Cảnh báo & Nhắc việc Vận hành Nội bộ theo Từng Trường (`tenantId`).
 *
 * Nguyên tắc cốt lõi (Chuẩn SaaS Multi-Tenant):
 * - Mọi cảnh báo vận hành hằng ngày của nhà trường (chưa điểm danh học sinh, mẫu lưu thức ăn bếp 24h,
 *   ý kiến phụ huynh chờ phản hồi, đơn xin nghỉ phép học sinh, sự kiện máy chấm công chưa ánh xạ)
 *   CHỈ thuộc về nội bộ trường đó (`tenantId`) — tuyệt đối KHÔNG đẩy lên SuperAdmin (đơn vị phân phối phần mềm)
 *   và tuyệt đối KHÔNG gửi chéo sang trường khác.
 * - Tự động đồng bộ vào Chuông Thông báo (`Notification`) của đúng nhân sự phụ trách trong trường đó
 *   thông qua khóa chống trùng `deduplicationKey` theo ngày.
 */

const mongoose = require('mongoose');
const Notification = require('../models/zone1_system/Notification');
const Classroom = require('../models/zone3_school/Classroom');
const Student = require('../models/zone3_school/Student');
const StudentAttendance = require('../models/zone3_school/StudentAttendance');
const StudentLeaveRequest = require('../models/zone3_school/StudentLeaveRequest');
const ParentFeedback = require('../models/zone3_school/ParentFeedback');
const FoodSample = require('../models/zone5_nutrition/FoodSample');
const RawAttendanceEvent = require('../models/zone2_hr/RawAttendanceEvent');
const { getTeacherClassroomIds } = require('./schoolDataAccessService');

// Bộ đệm ngắn 45 giây theo từng user trong trường để không truy vấn lặp mỗi lần polling chuông 5 giây
const SYNC_THROTTLE_MS = 45 * 1000;
const lastSyncByUserMap = new Map();

const getVietnamTodayContext = () => {
  const now = new Date();
  const vnTime = new Date(now.getTime() + 7 * 3600 * 1000);
  const yyyy = vnTime.getUTCFullYear();
  const mm = String(vnTime.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(vnTime.getUTCDate()).padStart(2, '0');
  const todayKey = `${yyyy}-${mm}-${dd}`;
  const startOfToday = new Date(`${todayKey}T00:00:00.000+07:00`);
  const endOfToday = new Date(`${todayKey}T23:59:59.999+07:00`);
  const dayOfWeek = vnTime.getUTCDay();
  return {
    todayKey,
    startOfToday,
    endOfToday,
    isWeekend: dayOfWeek === 0 || dayOfWeek === 6
  };
};

/**
 * Tính danh sách cảnh báo vận hành trong ngày của riêng 1 trường (`tenantId`) theo đúng vai trò người dùng.
 *
 * @param {object} params
 * @param {import('mongoose').Types.ObjectId | string | null} params.tenantId
 * @param {object} params.user
 * @param {object} [params.req]
 * @returns {Promise<Array<{ key: string, severity: string, title: string, message: string, link: string, type: string }>>}
 */
const collectSchoolOperationalAlerts = async ({ tenantId, user, req = null }) => {
  if (!user?._id || user.role === 'parent') {
    return [];
  }

  const hasValidTenant = tenantId && mongoose.Types.ObjectId.isValid(String(tenantId));
  const tenantObjectId = hasValidTenant ? new mongoose.Types.ObjectId(String(tenantId)) : null;
  const tenantFilter = tenantObjectId ? { tenantId: tenantObjectId } : { tenantId: { $in: [null, undefined] } };

  const { todayKey, startOfToday, endOfToday, isWeekend } = getVietnamTodayContext();
  const role = user.role;
  const alerts = [];

  // 1. Nhắc điểm danh học sinh hôm nay (dành cho Admin trường, Hiệu trưởng, Giáo viên của trường đó)
  if (!isWeekend && ['admin', 'principal', 'teacher'].includes(role)) {
    let classScopeFilter = {};
    if (role === 'teacher') {
      const teacherClassIds = await getTeacherClassroomIds(user, req);
      if (!teacherClassIds.length) {
        return [];
      }
      classScopeFilter = { classroomId: { $in: teacherClassIds } };
    }

    const [enrolledCount, recordedTodayCount] = await Promise.all([
      Student.countDocuments({ ...tenantFilter, ...classScopeFilter, status: 'enrolled' }),
      StudentAttendance.countDocuments({
        ...tenantFilter,
        ...classScopeFilter,
        $or: [
          { attendanceDateKey: todayKey },
          { attendDate: { $gte: startOfToday, $lte: endOfToday } }
        ]
      })
    ]);

    if (enrolledCount > 0 && recordedTodayCount === 0) {
      alerts.push({
        key: `attendance-missing:${todayKey}`,
        severity: 'warning',
        type: 'attendance',
        title: role === 'teacher'
          ? 'Lớp phụ trách chưa ghi nhận điểm danh hôm nay'
          : 'Nhà trường chưa ghi nhận điểm danh học sinh hôm nay',
        message: role === 'teacher'
          ? `Lớp của bạn có ${enrolledCount} học sinh đang theo học nhưng chưa điểm danh ngày ${todayKey}.`
          : `Trường hiện có ${enrolledCount} học sinh đang theo học nhưng chưa phát sinh bản ghi điểm danh ngày ${todayKey}.`,
        link: role === 'principal' ? '/attendance/reports' : '/attendance'
      });
    } else if (enrolledCount > recordedTodayCount && recordedTodayCount > 0 && role === 'teacher') {
      const remaining = enrolledCount - recordedTodayCount;
      alerts.push({
        key: `attendance-partial:${todayKey}`,
        severity: 'info',
        type: 'attendance',
        title: `Còn ${remaining} học sinh trong lớp chưa điểm danh hôm nay`,
        message: `Đã điểm danh ${recordedTodayCount}/${enrolledCount} bé trong ngày ${todayKey}.`,
        link: '/attendance'
      });
    }
  }

  // 2. Nhắc đơn xin nghỉ phép của học sinh đang chờ duyệt (Admin trường, Hiệu trưởng, Giáo viên)
  if (['admin', 'principal', 'teacher'].includes(role)) {
    let leaveScope = {};
    if (role === 'teacher') {
      const teacherClassIds = await getTeacherClassroomIds(user, req);
      leaveScope = { classroomId: { $in: teacherClassIds } };
    }
    const pendingLeaves = await StudentLeaveRequest.countDocuments({
      ...tenantFilter,
      ...leaveScope,
      status: 'pending'
    });
    if (pendingLeaves > 0) {
      alerts.push({
        key: `student-leave-pending:${todayKey}`,
        severity: 'info',
        type: 'leave_request',
        title: `Có ${pendingLeaves} đơn xin nghỉ học của phụ huynh chờ xử lý`,
        message: 'Vui lòng kiểm tra và phản hồi đơn xin nghỉ phép để cập nhật chuyên cần & suất ăn bán trú.',
        link: '/attendance/leaves'
      });
    }
  }

  // 3. Cảnh báo mẫu lưu thức ăn 24h tại bếp của trường (Admin trường, Hiệu trưởng, Đầu bếp)
  if (['admin', 'principal', 'chef'].includes(role)) {
    const alertSampleCount = await FoodSample.countDocuments({
      ...tenantFilter,
      status: { $in: ['sent_to_lab', 'investigating'] }
    });
    if (alertSampleCount > 0) {
      alerts.push({
        key: `food-sample-alert:${todayKey}`,
        severity: 'critical',
        type: 'nutrition',
        title: 'Cảnh báo mẫu lưu thức ăn bếp ăn bán trú',
        message: `Bếp ăn của trường đang có ${alertSampleCount} mẫu lưu ở trạng thái gửi xét nghiệm / kiểm tra ATTP.`,
        link: '/nutrition'
      });
    }
  }

  // 4. Nhắc phản hồi phụ huynh gửi riêng cho trường (Admin trường, Hiệu trưởng)
  if (['admin', 'principal'].includes(role)) {
    const openFeedbackCount = await ParentFeedback.countDocuments({
      ...tenantFilter,
      status: { $in: ['pending', 'in_progress'] }
    });
    if (openFeedbackCount > 0) {
      alerts.push({
        key: `parent-feedback-open:${todayKey}`,
        severity: 'info',
        type: 'info',
        title: `Có ${openFeedbackCount} ý kiến phụ huynh gửi nhà trường chờ phản hồi`,
        message: 'Kiểm tra mục Phản hồi phụ huynh để tiếp nhận và giải đáp kịp thời trong phạm vi nhà trường.',
        link: role === 'principal' ? '/parent-feedback' : '/accounts?tab=parents'
      });
    }
  }

  // 5. Nhắc sự kiện máy chấm công của trường chưa ánh xạ hồ sơ (Admin trường, HR)
  if (['admin', 'hr'].includes(role)) {
    const unmappedCount = await RawAttendanceEvent.countDocuments({
      ...tenantFilter,
      mappingStatus: 'UNMAPPED'
    });
    if (unmappedCount > 0) {
      alerts.push({
        key: `device-unmapped:${todayKey}`,
        severity: 'warning',
        type: 'attendance',
        title: `Có ${unmappedCount} lượt quẹt máy chấm công chưa gắn hồ sơ`,
        message: 'Mở quản lý Thiết bị chấm công của trường để ánh xạ ID máy với Học sinh hoặc Nhân viên.',
        link: '/timekeeping'
      });
    }
  }

  return alerts;
};

/**
 * Đồng bộ không trùng lặp các cảnh báo vận hành trong ngày của trường vào Chuông Thông báo (`Notification`)
 * của đúng người dùng trong `tenantId` đó (không bao giờ gửi sang trường khác).
 *
 * @param {object} params
 * @param {any} params.tenantId
 * @param {object} params.user
 * @param {object} [params.req]
 * @param {boolean} [params.force]
 */
const syncSchoolOperationalNotifications = async ({ tenantId, user, req = null, force = false }) => {
  if (!user?._id || user.role === 'parent') return [];

  const cacheKey = `${tenantId || 'legacy'}:${user._id}`;
  const now = Date.now();
  if (!force && lastSyncByUserMap.has(cacheKey) && now - lastSyncByUserMap.get(cacheKey) < SYNC_THROTTLE_MS) {
    return [];
  }
  lastSyncByUserMap.set(cacheKey, now);

  const alerts = await collectSchoolOperationalAlerts({ tenantId, user, req });
  if (!alerts.length) return [];

  const hasValidTenant = tenantId && mongoose.Types.ObjectId.isValid(String(tenantId));
  const tenantObjectId = hasValidTenant ? new mongoose.Types.ObjectId(String(tenantId)) : null;

  await Promise.all(
    alerts.map(async (al) => {
      const deduplicationKey = `school-op:${tenantObjectId || 'legacy'}:${al.key}:${user._id}`;
      try {
        await Notification.updateOne(
          {
            deduplicationKey,
            ...(tenantObjectId ? { tenantId: tenantObjectId } : { tenantId: null })
          },
          {
            $setOnInsert: {
              ...(tenantObjectId ? { tenantId: tenantObjectId } : {}),
              recipientId: user._id,
              title: al.title,
              message: al.message,
              type: al.type || 'warning',
              link: al.link,
              deduplicationKey,
              metadata: {
                source: 'school_operational_reminder',
                severity: al.severity,
                priority: al.severity === 'critical' ? 'high' : 'normal'
              }
            }
          },
          { upsert: true }
        );
      } catch (err) {
        if (err?.code !== 11000) {
          console.error('[SchoolOperationalNotification] Lỗi tạo nhắc việc nội bộ trường:', err.message);
        }
      }
    })
  );

  return alerts;
};

module.exports = {
  collectSchoolOperationalAlerts,
  syncSchoolOperationalNotifications
};

