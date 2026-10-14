const mongoose = require('mongoose');
const Classroom = require('../models/zone3_school/Classroom');
const Student = require('../models/zone3_school/Student');
const StudentAttendance = require('../models/zone3_school/StudentAttendance');
const ClassroomDailyCareReport = require('../models/zone3_school/ClassroomDailyCareReport');
const ParentFeedback = require('../models/zone3_school/ParentFeedback');
const StaffReview = require('../models/zone2_hr/StaffReview');
const Employee = require('../models/zone2_hr/Employee');
const { getWorkDate, startOfWorkDate } = require('../utils/dateHelpers');

const getClassQualityReport = async (req, res) => {
  try {
    const { classroomId, startDate, endDate } = req.query;

    const today = getWorkDate();
    const endStr = endDate || today;
    // Mặc định xem 30 ngày gần nhất nếu không chỉ định
    const startStr = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const start = startOfWorkDate(startStr);
    const end = new Date(startOfWorkDate(endStr).getTime() + 24 * 60 * 60 * 1000);

    // Lọc theo lớp nếu có
    const classFilter = { status: 'active' };
    if (classroomId) {
      if (!mongoose.isValidObjectId(classroomId)) {
        return res.status(422).json({ message: 'ID lớp học không hợp lệ.' });
      }
      classFilter._id = classroomId;
    }

    const classrooms = await Classroom.find(classFilter)
      .select('name schoolYear homeroomTeacherId teachers maxCapacity requiredTeachers')
      .lean();

    if (!classrooms.length) {
      return res.json({
        success: true,
        data: {
          period: { startDate: startStr, endDate: endStr },
          classes: [],
          message: 'Không tìm thấy lớp học phù hợp'
        }
      });
    }

    const classIds = classrooms.map((c) => c._id);

    // Lấy tất cả học sinh đang học trong các lớp này
    const students = await Student.find({ classroomId: { $in: classIds }, status: 'active' })
      .select('fullName classroomId gender dateOfBirth allergies')
      .lean();

    const studentsByClass = new Map();
    students.forEach((st) => {
      const cId = String(st.classroomId);
      if (!studentsByClass.has(cId)) studentsByClass.set(cId, []);
      studentsByClass.get(cId).push(st);
    });

    // Lấy dữ liệu điểm danh trong khoảng ngày
    const attendances = await StudentAttendance.find({
      classroomId: { $in: classIds },
      attendDate: { $gte: start, $lt: end }
    }).select('studentId classroomId status attendDate attendanceDateKey checkInTime note').lean();

    const attendancesByClass = new Map();
    attendances.forEach((att) => {
      const cId = String(att.classroomId);
      if (!attendancesByClass.has(cId)) attendancesByClass.set(cId, []);
      attendancesByClass.get(cId).push(att);
    });

    // Lấy báo cáo chăm sóc hàng ngày
    const careReports = await ClassroomDailyCareReport.find({
      classroomId: { $in: classIds },
      reportDate: { $gte: start, $lt: end }
    }).sort({ reportDate: -1 }).lean();

    const careReportsByClass = new Map();
    careReports.forEach((cr) => {
      const cId = String(cr.classroomId);
      if (!careReportsByClass.has(cId)) careReportsByClass.set(cId, []);
      careReportsByClass.get(cId).push(cr);
    });

    // Lấy phản hồi của phụ huynh
    const feedbacks = await ParentFeedback.find({
      classroomId: { $in: classIds },
      createdAt: { $gte: start, $lt: end }
    }).lean();

    const feedbacksByClass = new Map();
    feedbacks.forEach((fb) => {
      const cId = String(fb.classroomId);
      if (!feedbacksByClass.has(cId)) feedbacksByClass.set(cId, []);
      feedbacksByClass.get(cId).push(fb);
    });

    // Lấy đánh giá chuyên môn giáo viên (StaffReview)
    const teacherUserIds = [
      ...new Set(classrooms.flatMap((c) => [c.homeroomTeacherId, ...(c.teachers || []).map((t) => t.teacherId)].filter(Boolean).map(String)))
    ];

    const employees = await Employee.find({ userId: { $in: teacherUserIds } })
      .select('fullName userId employeeCode')
      .lean();
    const employeeByUserId = new Map(employees.map((e) => [String(e.userId), e]));
    const employeeIds = employees.map((e) => e._id);

    // Tìm review trong kỳ tương ứng (ví dụ YYYY-MM)
    const periodMonths = [startStr.slice(0, 7), endStr.slice(0, 7)];
    const staffReviews = await StaffReview.find({
      employeeId: { $in: employeeIds },
      period: { $in: periodMonths }
    }).lean();

    const reviewsByEmployeeId = new Map(staffReviews.map((r) => [String(r.employeeId), r]));

    // Tổng hợp dữ liệu theo từng lớp
    const classResults = classrooms.map((cls) => {
      const cId = String(cls._id);
      const classStudents = studentsByClass.get(cId) || [];
      const classAtts = attendancesByClass.get(cId) || [];
      const classCareReports = careReportsByClass.get(cId) || [];
      const classFeedbacks = feedbacksByClass.get(cId) || [];

      // 1. Phân tích chuyên cần:
      // Tập hợp các ngày học thực tế có ghi nhận điểm danh
      const uniqueDays = [...new Set(classAtts.map((a) => a.attendanceDateKey || a.attendDate?.toISOString().slice(0, 10)).filter(Boolean))];
      const schoolDaysCount = uniqueDays.length;

      // Mẫu số: Tổng số lượt học sinh = số trẻ đang học * số ngày học
      const denominator = classStudents.length * schoolDaysCount;

      let presentCount = 0;
      let lateCount = 0;
      let excusedAbsentCount = 0;
      let unexcusedAbsentCount = 0;

      classAtts.forEach((a) => {
        if (a.status === 'present') presentCount += 1;
        else if (a.status === 'late') lateCount += 1;
        else if (a.status === 'absent_permission') excusedAbsentCount += 1;
        else if (a.status === 'absent') unexcusedAbsentCount += 1;
      });

      const totalAbsent = excusedAbsentCount + unexcusedAbsentCount;
      const totalAttended = presentCount + lateCount;
      const attendanceRate = denominator > 0 ? Number(((totalAttended / denominator) * 100).toFixed(1)) : 0;

      // 2. Chăm sóc và ghi chú đáng chú ý:
      const flaggedNotes = [];
      let totalMealsNoted = 0;
      let totalHealthNoted = 0;

      classCareReports.forEach((cr) => {
        if (cr.health && cr.health.trim()) totalHealthNoted += 1;
        if (cr.meals && cr.meals.trim()) totalMealsNoted += 1;
        (cr.studentNotes || []).forEach((sn) => {
          flaggedNotes.push({
            dateKey: cr.dateKey,
            studentName: sn.studentName,
            note: sn.note,
            recordedBy: cr.recordedByName
          });
        });
      });

      // 3. Phản hồi phụ huynh:
      const pendingFeedbacks = classFeedbacks.filter((fb) => fb.status === 'pending');
      const inProgressFeedbacks = classFeedbacks.filter((fb) => fb.status === 'in_progress');
      const resolvedFeedbacks = classFeedbacks.filter((fb) => ['responded', 'closed'].includes(fb.status));

      // 4. Đánh giá giáo viên phụ trách:
      const teacherReviews = [];
      const teachersList = [
        cls.homeroomTeacherId ? { id: cls.homeroomTeacherId, role: 'homeroom' } : null,
        ...(cls.teachers || []).map((t) => ({ id: t.teacherId, role: t.role }))
      ].filter(Boolean);

      teachersList.forEach((t) => {
        const emp = employeeByUserId.get(String(t.id));
        if (emp) {
          const rev = reviewsByEmployeeId.get(String(emp._id));
          if (rev) {
            teacherReviews.push({
              employeeName: emp.fullName,
              role: t.role === 'homeroom' ? 'Chủ nhiệm' : 'Phụ tá/Bộ môn',
              period: rev.period,
              rating: rev.rating,
              generalAssessment: rev.generalAssessment,
              professionalAssessment: rev.professionalAssessment || 'Không có ghi chú chuyên môn',
              status: rev.status
            });
          } else {
            teacherReviews.push({
              employeeName: emp.fullName,
              role: t.role === 'homeroom' ? 'Chủ nhiệm' : 'Phụ tá/Bộ môn',
              evaluationStatus: 'chưa đủ dữ liệu'
            });
          }
        }
      });

      return {
        classroomId: cls._id,
        className: cls.name,
        schoolYear: cls.schoolYear,
        totalEnrolled: classStudents.length,
        // Chuyên cần
        attendance: {
          schoolDaysCount,
          denominator,
          formulaNote: `Mẫu số: ${classStudents.length} học sinh × ${schoolDaysCount} ngày ghi nhận = ${denominator} lượt`,
          presentCount,
          lateCount,
          totalAbsent,
          excusedAbsentCount,
          unexcusedAbsentCount,
          attendanceRate: denominator > 0 ? `${attendanceRate}%` : 'Chưa đủ dữ liệu'
        },
        // Chăm sóc
        careSummary: {
          totalCareReports: classCareReports.length,
          totalHealthNoted,
          totalMealsNoted,
          flaggedNotesCount: flaggedNotes.length,
          flaggedNotes: flaggedNotes.slice(0, 10)
        },
        // Phụ huynh
        parentFeedback: {
          total: classFeedbacks.length,
          pending: pendingFeedbacks.length,
          inProgress: inProgressFeedbacks.length,
          resolved: resolvedFeedbacks.length
        },
        // Đánh giá chuyên môn giáo viên
        teacherEvaluations: teacherReviews.length ? teacherReviews : [{ evaluationStatus: 'chưa đủ dữ liệu' }]
      };
    });

    return res.json({
      success: true,
      data: {
        period: { startDate: startStr, endDate: endStr },
        classes: classResults
      }
    });
  } catch (error) {
    console.error('Lỗi tính toán báo cáo chất lượng lớp:', error);
    return res.status(500).json({ message: 'Không thể tính toán báo cáo chất lượng lớp học.' });
  }
};

module.exports = {
  getClassQualityReport
};
