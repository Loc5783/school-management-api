const Payroll = require('../models/zone2_hr/Payroll');
const LeaveRequest = require('../models/zone2_hr/LeaveRequest');
const JobApplicant = require('../models/zone2_hr/JobApplicant');
const TuitionRefundRequest = require('../models/zone4_finance/TuitionRefundRequest');
const OperatingExpenseRequest = require('../models/zone4_finance/OperatingExpenseRequest');
const StudentProfileChangeRequest = require('../models/zone3_school/StudentProfileChangeRequest');
const ParentFeedback = require('../models/zone3_school/ParentFeedback');
const { getWorkDate } = require('../utils/dateHelpers');
const { buildTenantFilter } = require('../services/tenantFilterService');

const getPrincipalWork = async (req, res) => {
    try {
        const [year, month] = getWorkDate().split('-').map(Number);
        const tenantFilter = buildTenantFilter(req);
        const [payroll, leave, recruitment, refunds, operatingExpenses, profileChanges, parentFeedback] = await Promise.all([
            Payroll.countDocuments({ status: 'reviewed', year, month, ...tenantFilter }),
            LeaveRequest.countDocuments({ status: 'pending', ...tenantFilter }),
            JobApplicant.countDocuments({ status: 'recommended', ...tenantFilter }),
            TuitionRefundRequest.countDocuments({ status: 'pending', ...tenantFilter }),
            OperatingExpenseRequest.countDocuments({ status: 'pending', ...tenantFilter }),
            StudentProfileChangeRequest.countDocuments({ status: 'pending', ...tenantFilter }),
            ParentFeedback.countDocuments({ status: 'pending', ...tenantFilter })
        ]);
        res.json({ data: { payroll, leave, recruitment, refunds, operatingExpenses, profileChanges, parentFeedback } });
    } catch (error) {
        console.error('Không thể tải công việc hiệu trưởng:', error);
        res.status(500).json({ message: 'Không thể tải danh sách việc cần hiệu trưởng xem xét.' });
    }
};

module.exports = { getPrincipalWork };
