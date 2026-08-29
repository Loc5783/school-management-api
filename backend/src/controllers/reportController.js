const Report = require('../models/zone7_reporting/Report');
const Student = require('../models/zone3_school/Student');
const Classroom = require('../models/zone3_school/Classroom');
const StudentAttendance = require('../models/zone3_school/StudentAttendance');
const TuitionFee = require('../models/zone4_finance/TuitionFee');
const Payment = require('../models/zone4_finance/Payment');
const { canAccessClassroom } = require('../services/schoolDataAccessService');
const { isValidObjectId } = require('../utils/idValidation');
const {
    DEFAULT_SCHOOL_TIMEZONE,
    getWorkDate,
    getWorkDateRange,
    isValidWorkDate
} = require('../utils/dateHelpers');

const resolveWorkDate = (value) => {
    if (!value) return getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);
    if (isValidWorkDate(value)) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : getWorkDate(parsed, DEFAULT_SCHOOL_TIMEZONE);
};

// ==============================
// 1. Báo cáo tổng quan trường
// ==============================
const getDashboardStats = async (req, res) => {
    try {
        const { start: today, end: tomorrow } = getWorkDateRange(
            getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE),
            DEFAULT_SCHOOL_TIMEZONE
        );

        const User = require('../models/zone1_system/User');
        const [totalStudents, totalClassrooms, totalTeachers, todayRevenue, attendedToday, recentAttendance] = await Promise.all([
            Student.countDocuments({ status: 'enrolled' }),
            Classroom.countDocuments({ status: 'active' }),
            User.countDocuments({ role: 'teacher', status: 'active' }),
            Payment.aggregate([
                { $match: { paidAt: { $gte: today, $lt: tomorrow } } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            StudentAttendance.countDocuments({
                attendDate: { $gte: today, $lt: tomorrow },
                status: 'present'
            }),
            StudentAttendance.find({ attendDate: { $gte: today, $lt: tomorrow } })
                .sort({ checkInTime: -1, createdAt: -1 })
                .limit(6)
                .select('studentName status checkInTime')
                .lean()
        ]);

        res.json({
            message: 'Lấy thống kê tổng quan thành công',
            data: {
                summary: {
                    totalStudents,
                    totalClassrooms,
                    totalTeachers,
                    todayRevenue: todayRevenue[0]?.total || 0,
                    attendedToday,
                    attendanceRate: totalStudents > 0 ? Math.round((attendedToday / totalStudents) * 100) : 0
                },
                recentAttendance
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// ==============================
// 2. Báo cáo theo lớp
// ==============================
const getClassReport = async (req, res) => {
    try {
        const { classroomId } = req.params;
        const { date } = req.query; // ngày cụ thể, nếu không có thì lấy hôm nay

        if (!isValidObjectId(classroomId)) {
            return res.status(400).json({ message: 'ID lớp học không hợp lệ' });
        }

        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, classroomId)) {
            return res.status(403).json({ message: 'Bạn không có quyền xem báo cáo lớp này' });
        }

        // Kiểm tra lớp tồn tại
        const classroom = await Classroom.findById(classroomId);
        if (!classroom) {
            return res.status(404).json({ message: 'Không tìm thấy lớp học' });
        }

        // Lấy danh sách học sinh trong lớp
        const students = await Student.find({ classroomId, status: 'enrolled' });

        const workDate = resolveWorkDate(date);
        if (!workDate) {
            return res.status(400).json({ message: 'Ngày báo cáo không hợp lệ' });
        }
        const { start: targetDate, end: nextDate } = getWorkDateRange(workDate, DEFAULT_SCHOOL_TIMEZONE);

        const attendances = await StudentAttendance.find({
            classroomId,
            attendDate: { $gte: targetDate, $lt: nextDate }
        });

        // Tạo báo cáo
        const report = {
            className: classroom.name,
            date: targetDate,
            totalStudents: students.length,
            present: attendances.filter(a => a.status === 'present').length,
            absent: attendances.filter(a => a.status === 'absent').length,
            late: attendances.filter(a => a.status === 'late').length,
            absentPermission: attendances.filter(a => a.status === 'absent_permission').length,
            details: students.map(student => {
                const att = attendances.find(a => a.studentId.toString() === student._id.toString());
                return {
                    studentId: student._id,
                    studentName: student.fullName,
                    status: att ? att.status : 'absent',
                    checkInTime: att?.checkInTime,
                    note: att?.note || ''
                };
            })
        };

        res.json({
            message: 'Lấy báo cáo lớp thành công',
            data: report
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// ==============================
// 3. Báo cáo học phí theo kỳ
// ==============================
const getFinanceReport = async (req, res) => {
    try {
        const { period } = req.query; // '08-2026'
        if (!period) {
            return res.status(400).json({ message: 'Vui lòng cung cấp period (MM-YYYY)' });
        }

        // Tất cả hóa đơn trong kỳ
        const invoices = await TuitionFee.find({ period });

        const totalInvoices = invoices.length;
        const totalAmount = invoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
        const totalPaid = invoices.reduce((sum, inv) => sum + inv.paidAmount, 0);
        const totalRemaining = totalAmount - totalPaid;

        const paidCount = invoices.filter(inv => inv.status === 'paid').length;
        const partialCount = invoices.filter(inv => inv.status === 'partial').length;
        const unpaidCount = invoices.filter(inv => inv.status === 'unpaid').length;

        // Chi tiết theo lớp
        const byClass = await TuitionFee.aggregate([
            { $match: { period } },
            {
                $group: {
                    _id: '$classroomId',
                    className: { $first: '$className' },
                    totalStudents: { $sum: 1 },
                    totalAmount: { $sum: '$totalAmount' },
                    paidAmount: { $sum: '$paidAmount' },
                    paidCount: {
                        $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] }
                    }
                }
            }
        ]);

        res.json({
            message: 'Lấy báo cáo tài chính thành công',
            data: {
                period,
                totalInvoices,
                totalAmount,
                totalPaid,
                totalRemaining,
                statusCounts: { paid: paidCount, partial: partialCount, unpaid: unpaidCount },
                byClass
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// ==============================
// 4. Lưu báo cáo vào database
// ==============================
const saveReport = async (req, res) => {
    try {
        const { reportType, period, periodValue, data, note } = req.body;

        const report = new Report({
            reportType,
            period,
            periodValue,
            data,
            generatedBy: req.user._id,
            generatedByName: req.user.profile.fullName,
            note
        });

        await report.save();

        res.status(201).json({
            message: 'Lưu báo cáo thành công',
            data: report
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// ==============================
// 5. Lấy danh sách báo cáo đã lưu
// ==============================
const getReports = async (req, res) => {
    try {
        const { reportType, period, limit = 20 } = req.query;
        const filter = {};
        if (reportType) filter.reportType = reportType;
        if (period) filter.period = period;

        const reports = await Report.find(filter)
            .sort({ generatedAt: -1 })
            .limit(parseInt(limit));

        res.json({
            message: 'Lấy danh sách báo cáo thành công',
            data: reports
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// ==============================
// 6. Xem chi tiết báo cáo
// ==============================
const getReportById = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidObjectId(id)) {
            return res.status(400).json({ message: 'ID báo cáo không hợp lệ' });
        }
        const report = await Report.findById(id);
        if (!report) {
            return res.status(404).json({ message: 'Không tìm thấy báo cáo' });
        }
        res.json({
            message: 'Lấy chi tiết báo cáo thành công',
            data: report
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// ==============================
// 7. Công bố báo cáo (publish)
// ==============================
const publishReport = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidObjectId(id)) {
            return res.status(400).json({ message: 'ID báo cáo không hợp lệ' });
        }
        const report = await Report.findByIdAndUpdate(
            id,
            { status: 'published' },
            { returnDocument: 'after' }
        );
        if (!report) {
            return res.status(404).json({ message: 'Không tìm thấy báo cáo' });
        }
        res.json({
            message: 'Công bố báo cáo thành công',
            data: report
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

module.exports = {
    getDashboardStats,
    getClassReport,
    getFinanceReport,
    saveReport,
    getReports,
    getReportById,
    publishReport
};
