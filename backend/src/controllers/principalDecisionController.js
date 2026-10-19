const PayrollEvent = require('../models/zone2_hr/PayrollEvent');
require('../models/zone2_hr/Payroll');
const LeaveRequest = require('../models/zone2_hr/LeaveRequest');
const JobApplicant = require('../models/zone2_hr/JobApplicant');
const StudentProfileChangeRequest = require('../models/zone3_school/StudentProfileChangeRequest');
const TuitionRefundRequest = require('../models/zone4_finance/TuitionRefundRequest');
const OperatingExpenseRequest = require('../models/zone4_finance/OperatingExpenseRequest');
require('../models/zone1_system/User');

const getPrincipalDecisions = async (req, res) => {
    const requestedLimit = Number(req.query.limit || 20);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 50) {
        return res.status(422).json({ message: 'Số bản ghi phải từ 1 đến 50.' });
    }
    try {
        const [payroll, leave, recruitment, profiles, refunds, expenses] = await Promise.all([
            PayrollEvent.find({ action: { $in: ['confirmed', 'reopened'] } }).sort({ createdAt: -1 }).limit(requestedLimit)
                .select('payrollId actorName action createdAt').populate('payrollId', 'employeeName month year').lean(),
            LeaveRequest.find({ status: { $in: ['approved', 'rejected'] }, approvedAt: { $exists: true } })
                .sort({ approvedAt: -1 }).limit(requestedLimit).select('employeeName status approvedByName approvedAt').lean(),
            JobApplicant.find({ status: { $in: ['approved', 'rejected'] }, decidedAt: { $exists: true } })
                .sort({ decidedAt: -1 }).limit(requestedLimit).select('fullName status decidedAt decidedBy').populate('decidedBy', 'username profile.fullName').lean(),
            StudentProfileChangeRequest.find({ status: { $in: ['approved', 'rejected'] }, reviewedAt: { $exists: true } })
                .sort({ reviewedAt: -1 }).limit(requestedLimit).select('studentName status reviewerName reviewedAt').lean(),
            TuitionRefundRequest.find({ reviewedAt: { $exists: true } }).sort({ reviewedAt: -1 }).limit(requestedLimit)
                .select('amount reviewedByName reviewedAt reviewNote status invoiceId').lean(),
            OperatingExpenseRequest.find({ reviewedAt: { $exists: true } }).sort({ reviewedAt: -1 }).limit(requestedLimit)
                .select('payee amount reviewedByName reviewedAt status').lean()
        ]);
        const rows = [
            ...payroll.map((item) => ({ id: item._id, type: 'payroll', title: item.action === 'confirmed' ? 'Duyệt bảng lương' : 'Mở lại bảng lương', subject: item.payrollId ? `${item.payrollId.employeeName} · ${item.payrollId.month}/${item.payrollId.year}` : 'Phiếu lương', actor: item.actorName, at: item.createdAt, status: item.action, path: '/hr?tab=payroll' })),
            ...leave.map((item) => ({ id: item._id, type: 'leave', title: item.status === 'approved' ? 'Duyệt nghỉ phép' : 'Từ chối nghỉ phép', subject: item.employeeName, actor: item.approvedByName, at: item.approvedAt, status: item.status, path: '/hr?tab=leave' })),
            ...recruitment.map((item) => ({ id: item._id, type: 'recruitment', title: item.status === 'approved' ? 'Duyệt nhận việc' : 'Từ chối ứng viên', subject: item.fullName, actor: item.decidedBy?.profile?.fullName || item.decidedBy?.username || 'Không rõ', at: item.decidedAt, status: item.status, path: '/hr?tab=recruitment' })),
            ...profiles.map((item) => ({ id: item._id, type: 'profile', title: item.status === 'approved' ? 'Duyệt hồ sơ học sinh' : 'Từ chối cập nhật hồ sơ', subject: item.studentName, actor: item.reviewerName, at: item.reviewedAt, status: item.status, path: '/student-profile-change-requests' })),
            ...refunds.map((item) => ({ id: item._id, type: 'refund', title: item.status === 'rejected' ? 'Từ chối hoàn học phí' : 'Duyệt hoàn học phí', subject: `${new Intl.NumberFormat('vi-VN').format(item.amount)} đ`, actor: item.reviewedByName, at: item.reviewedAt, status: item.status, path: '/finance?tab=refunds' })),
            ...expenses.map((item) => ({ id: item._id, type: 'expense', title: item.status === 'rejected' ? 'Từ chối chi vận hành' : 'Duyệt chi vận hành', subject: item.payee, actor: item.reviewedByName, at: item.reviewedAt, status: item.status, path: '/accounting/operating-expenses' }))
        ].filter((item) => item.at).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, requestedLimit);
        return res.json({ data: rows });
    } catch (error) {
        console.error('Không thể tải lịch sử quyết định:', error);
        return res.status(500).json({ message: 'Không thể tải lịch sử quyết định.' });
    }
};

module.exports = { getPrincipalDecisions };
