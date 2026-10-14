const Classroom = require('../models/zone3_school/Classroom');
const Student = require('../models/zone3_school/Student');
const StudentAttendance = require('../models/zone3_school/StudentAttendance');
const PickupRecord = require('../models/zone3_school/PickupRecord');
const SecurityIncident = require('../models/zone3_school/SecurityIncident');
const MealServing = require('../models/zone5_nutrition/MealServing');
const Inventory = require('../models/zone5_nutrition/Inventory');
const FoodInspection = require('../models/zone5_nutrition/FoodInspection');
const KitchenRequest = require('../models/zone5_nutrition/KitchenRequest');
const Menu = require('../models/zone5_nutrition/Menu');
const TuitionRefundRequest = require('../models/zone4_finance/TuitionRefundRequest');
const OperatingExpenseRequest = require('../models/zone4_finance/OperatingExpenseRequest');
const LeaveRequest = require('../models/zone2_hr/LeaveRequest');
const Payroll = require('../models/zone2_hr/Payroll');
const StudentProfileChangeRequest = require('../models/zone3_school/StudentProfileChangeRequest');
const PrincipalTask = require('../models/zone1_system/PrincipalTask');
const { getStaffingSnapshot } = require('../services/staffingService');
const { getWorkDate, startOfWorkDate } = require('../utils/dateHelpers');

const getPrincipalAlerts = async (req, res) => {
  try {
    const today = getWorkDate();
    const now = new Date();
    const todayStart = startOfWorkDate(today);
    const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    // 1. LỚP THIẾU GIÁO VIÊN VÀ CA TRỰC BỊ THIẾU
    let staffing = { teacherShortages: [], uncoveredShifts: [], missingTeacherTotal: 0 };
    try {
      staffing = await getStaffingSnapshot(today);
    } catch (e) {
      console.error('Lỗi tính toán snapshot nhân sự:', e);
    }

    const teacherShortages = (staffing.teacherShortages || []).map((item) => ({
      classroomId: item._id,
      className: item.name,
      schoolYear: item.schoolYear,
      requiredTeachers: item.requiredTeachers,
      presentTeachers: item.presentTeachers,
      missingTeachers: item.missingTeachers,
      schoolDay: item.schoolDay,
      assigned: item.assigned || [],
      replacements: item.replacements || []
    }));

    const uncoveredDuties = (staffing.duties || []).filter((shift) => shift.uncovered).map((shift) => ({
      shiftId: shift._id,
      shiftType: shift.shiftType,
      employeeName: shift.employeeName,
      time: `${shift.startTime || ''} - ${shift.endTime || ''}`
    }));

    // 2. TRẺ CHƯA ĐƯỢC ĐÓN & TỔNG HỢP HIỆN DIỆN HỌC SINH
    // Phân biệt: chưa đến, đang ở trường (chưa đón), đã bàn giao, nghỉ học
    const [activeClasses, activeStudents, todayAttendances, confirmedPickups] = await Promise.all([
      Classroom.find({ status: 'active' }).select('name schoolYear').lean(),
      Student.find({ status: 'active' }).select('fullName classroomId allergies').lean(),
      StudentAttendance.find({
        $or: [
          { attendanceDateKey: today },
          { attendDate: { $gte: todayStart, $lt: tomorrowStart } }
        ]
      }).select('studentId classroomId status checkInTime checkOutTime studentName').lean(),
      PickupRecord.find({ pickupDate: today, status: 'confirmed' }).select('studentId classroomId confirmedAt').lean()
    ]);

    const pickupStudentSet = new Set(confirmedPickups.map((p) => String(p.studentId)));
    const attendanceMap = new Map();
    todayAttendances.forEach((att) => {
      attendanceMap.set(String(att.studentId), att);
    });

    const studentsByClass = new Map();
    activeStudents.forEach((student) => {
      const cId = String(student.classroomId || 'unassigned');
      if (!studentsByClass.has(cId)) studentsByClass.set(cId, []);
      studentsByClass.get(cId).push(student);
    });

    let totalAtSchool = 0;
    let totalPickedUp = 0;
    let totalAbsent = 0;
    let totalNotArrived = 0;

    const uncollectedByClass = activeClasses.map((cls) => {
      const cId = String(cls._id);
      const classStudents = studentsByClass.get(cId) || [];
      let notArrived = 0;
      let atSchool = 0;
      let pickedUp = 0;
      let absent = 0;
      const waitingStudents = [];

      classStudents.forEach((st) => {
        const att = attendanceMap.get(String(st._id));
        if (!att) {
          notArrived += 1;
        } else if (att.status === 'absent' || att.status === 'absent_permission') {
          absent += 1;
        } else if (att.status === 'present' || att.status === 'late') {
          const hasCheckedOut = Boolean(att.checkOutTime);
          const hasPickupRecord = pickupStudentSet.has(String(st._id));
          if (hasCheckedOut || hasPickupRecord) {
            pickedUp += 1;
          } else {
            atSchool += 1;
            waitingStudents.push({
              studentId: st._id,
              studentName: st.fullName,
              checkInTime: att.checkInTime
            });
          }
        } else {
          notArrived += 1;
        }
      });

      totalAtSchool += atSchool;
      totalPickedUp += pickedUp;
      totalAbsent += absent;
      totalNotArrived += notArrived;

      return {
        classroomId: cls._id,
        className: cls.name,
        totalEnrolled: classStudents.length,
        notArrived,
        atSchool, // Số trẻ đang ở trường chờ đón
        pickedUp,
        absent,
        waitingStudents
      };
    });

    // 3. SỰ CỐ AN NINH & AN TOÀN TRƯỜNG HỌC
    const securityIncidents = await SecurityIncident.find({
      $or: [
        { status: { $ne: 'closed' } },
        { severity: { $in: ['serious', 'emergency'] } }
      ]
    }).sort({ createdAt: -1 }).limit(30).lean();

    const openIncidents = securityIncidents.filter((inc) => inc.status !== 'closed');
    const emergencyIncidents = securityIncidents.filter((inc) => ['serious', 'emergency'].includes(inc.severity));
    const unacknowledgedIncidents = emergencyIncidents.filter((inc) => !inc.acknowledgedAt);

    // 4. CẢNH BÁO BẾP ĂN & AN TOÀN THỰC PHẨM
    const [nearExpiryItems, mealServingsToday, heldInspections, pendingKitchenRequests, todayMenus] = await Promise.all([
      Inventory.find({
        status: { $in: ['near_expiry', 'expired'] }
      }).select('ingredientName lotNumber expiryDate status quantity unit').limit(15).lean(),
      MealServing.find({ dateKey: today })
        .populate('classroomId', 'name')
        .lean(),
      FoodInspection.find({
        $or: [
          { mealDateKey: today, stage: 'held' },
          { 'step1_rawIngredients.decision': 'reject' }
        ]
      }).limit(5).lean(),
      KitchenRequest.find({ status: 'pending' })
        .select('requestType title priority createdAt')
        .limit(10).lean(),
      Menu.find({
        status: 'approved',
        startDate: { $lte: todayStart },
        endDate: { $gte: todayStart }
      }).select('name allergyWarnings').lean()
    ]);

    // Học sinh có dị ứng
    const studentsWithAllergies = activeStudents.filter((st) => Array.isArray(st.allergies) && st.allergies.length > 0).map((st) => ({
      studentId: st._id,
      studentName: st.fullName,
      classroomId: st.classroomId,
      allergens: st.allergies.map((a) => a.allergen || a).filter(Boolean)
    }));

    // Sai lệch suất ăn hoặc thiếu suất ăn
    const mealDiscrepancies = [];
    mealServingsToday.forEach((serving) => {
      const clsName = serving.classroomId?.name || 'Lớp';
      if (serving.deliveredCount !== null && serving.receivedCount !== null && serving.deliveredCount !== serving.receivedCount) {
        mealDiscrepancies.push({
          classroomId: serving.classroomId?._id,
          className: clsName,
          type: 'discrepancy',
          message: `Lệch số suất bàn giao: bếp giao ${serving.deliveredCount}, lớp nhận ${serving.receivedCount}`
        });
      }
      if (serving.cookedCount < serving.plannedAtCook) {
        mealDiscrepancies.push({
          classroomId: serving.classroomId?._id,
          className: clsName,
          type: 'shortage',
          message: `Nấu thiếu suất ăn: kế hoạch ${serving.plannedAtCook}, thực nấu ${serving.cookedCount}`
        });
      }
    });

    // 5. CÔNG VIỆC VÀ PHÊ DUYỆT QUÁ HẠN
    const overdueThreshold = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000); // 3 ngày
    const [pendingRefunds, pendingExpenses, pendingLeaves, pendingPayrolls, pendingProfiles, overdueTasks] = await Promise.all([
      TuitionRefundRequest.find({ status: 'pending', createdAt: { $lt: overdueThreshold } })
        .select('amount createdAt studentName reason').lean(),
      OperatingExpenseRequest.find({ status: 'pending', createdAt: { $lt: overdueThreshold } })
        .select('payee amount createdAt purpose category').lean(),
      LeaveRequest.find({ status: 'pending', createdAt: { $lt: overdueThreshold } })
        .select('employeeName startDate endDate createdAt').lean(),
      Payroll.find({ status: 'reviewed', updatedAt: { $lt: overdueThreshold } })
        .select('employeeName month year updatedAt').lean(),
      StudentProfileChangeRequest.find({ status: 'pending', createdAt: { $lt: overdueThreshold } })
        .select('studentName createdAt requestedFields').lean(),
      PrincipalTask.find({
        status: { $ne: 'completed' },
        dueDate: { $lt: now }
      }).select('title department dueDate priority assignedToName createdAt').lean()
    ]);

    const overdueList = [
      ...pendingRefunds.map((r) => ({
        id: r._id,
        type: 'refund',
        typeLabel: 'Hoàn học phí',
        title: `Hoàn phí: ${new Intl.NumberFormat('vi-VN').format(r.amount)} đ (${r.studentName || 'Học sinh'})`,
        createdAt: r.createdAt,
        dueDate: null,
        daysOverdue: Math.max(1, Math.floor((now - new Date(r.createdAt)) / (1000 * 60 * 60 * 24))),
        link: '/finance?tab=refunds'
      })),
      ...pendingExpenses.map((e) => ({
        id: e._id,
        type: 'expense',
        typeLabel: 'Chi vận hành',
        title: `Chi vận hành: ${new Intl.NumberFormat('vi-VN').format(e.amount)} đ (${e.payee})`,
        createdAt: e.createdAt,
        dueDate: null,
        daysOverdue: Math.max(1, Math.floor((now - new Date(e.createdAt)) / (1000 * 60 * 60 * 24))),
        link: '/accounting/operating-expenses'
      })),
      ...pendingLeaves.map((l) => ({
        id: l._id,
        type: 'leave',
        typeLabel: 'Nghỉ phép',
        title: `Đơn nghỉ phép: ${l.employeeName}`,
        createdAt: l.createdAt,
        dueDate: null,
        daysOverdue: Math.max(1, Math.floor((now - new Date(l.createdAt)) / (1000 * 60 * 60 * 24))),
        link: '/hr?tab=leave'
      })),
      ...pendingPayrolls.map((p) => ({
        id: p._id,
        type: 'payroll',
        typeLabel: 'Bảng lương',
        title: `Bảng lương: ${p.employeeName} (${p.month}/${p.year})`,
        createdAt: p.updatedAt,
        dueDate: null,
        daysOverdue: Math.max(1, Math.floor((now - new Date(p.updatedAt)) / (1000 * 60 * 60 * 24))),
        link: '/hr?tab=payroll'
      })),
      ...pendingProfiles.map((p) => ({
        id: p._id,
        type: 'profile',
        typeLabel: 'Hồ sơ học sinh',
        title: `Cập nhật hồ sơ: ${p.studentName}`,
        createdAt: p.createdAt,
        dueDate: null,
        daysOverdue: Math.max(1, Math.floor((now - new Date(p.createdAt)) / (1000 * 60 * 60 * 24))),
        link: '/student-profile-change-requests'
      })),
      ...overdueTasks.map((t) => ({
        id: t._id,
        type: 'task',
        typeLabel: `Nhiệm vụ (${t.department.toUpperCase()})`,
        title: `${t.title} · Phụ trách: ${t.assignedToName || 'Bộ phận'}`,
        createdAt: t.createdAt,
        dueDate: t.dueDate,
        daysOverdue: Math.max(1, Math.floor((now - new Date(t.dueDate)) / (1000 * 60 * 60 * 24))),
        link: '/principal'
      }))
    ].sort((a, b) => b.daysOverdue - a.daysOverdue);

    // KẾT QUẢ ĐẦY ĐỦ CỦA DASHBOARD CẢNH BÁO
    return res.json({
      success: true,
      data: {
        date: today,
        // 1. Giáo viên
        teacherAlerts: {
          shortageCount: teacherShortages.length,
          missingTeacherTotal: teacherShortages.reduce((sum, item) => sum + item.missingTeachers, 0),
          uncoveredShiftsCount: uncoveredDuties.length,
          shortages: teacherShortages,
          uncoveredDuties
        },
        // 2. Học sinh chưa đón
        pickupAlerts: {
          totalEnrolled: activeStudents.length,
          totalAtSchool, // Số trẻ đang ở trường chưa đón
          totalPickedUp,
          totalAbsent,
          totalNotArrived,
          classes: uncollectedByClass
        },
        // 3. Sự cố an ninh
        securityAlerts: {
          openCount: openIncidents.length,
          emergencyCount: emergencyIncidents.length,
          unacknowledgedCount: unacknowledgedIncidents.length,
          incidents: securityIncidents
        },
        // 4. Bếp ăn & an toàn thực phẩm
        kitchenAlerts: {
          nearExpiryCount: nearExpiryItems.length,
          nearExpiryItems,
          mealDiscrepanciesCount: mealDiscrepancies.length,
          mealDiscrepancies,
          heldInspectionsCount: heldInspections.length,
          heldInspections,
          allergyCount: studentsWithAllergies.length,
          studentsWithAllergies: studentsWithAllergies.slice(0, 20),
          pendingRequestsCount: pendingKitchenRequests.length,
          pendingRequests: pendingKitchenRequests,
          menuWarnings: todayMenus.flatMap((m) => m.allergyWarnings || [])
        },
        // 5. Quá hạn
        overdueAlerts: {
          totalOverdue: overdueList.length,
          items: overdueList
        }
      }
    });
  } catch (error) {
    console.error('Lỗi tính toán cảnh báo hiệu trưởng:', error);
    return res.status(500).json({ message: 'Không thể tính toán cảnh báo điều hành của hiệu trưởng.' });
  }
};

module.exports = {
  getPrincipalAlerts
};
