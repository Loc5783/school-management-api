const TuitionFee = require('../models/zone4_finance/TuitionFee');
const FeeSchedule = require('../models/zone4_finance/FeeSchedule');
const Payroll = require('../models/zone2_hr/Payroll');
const { getWorkDate } = require('../utils/dateHelpers');
const { assertOpen, fromPeriod } = require('../services/accountingPeriodService');

const guard = (resolveMonth) => async (req, res, next) => {
    try {
        const month = await resolveMonth(req);
        await assertOpen(month);
        next();
    } catch (error) {
        return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Không thể kiểm tra trạng thái kỳ kế toán' });
    }
};

const invoice = async (req) => {
    const record = await TuitionFee.findById(req.params.id).select('period').lean();
    return fromPeriod(record?.period);
};
const schedule = async (req) => {
    const record = await FeeSchedule.findById(req.params.id).select('period').lean();
    return fromPeriod(record?.period);
};
const payroll = async (req) => {
    const record = await Payroll.findById(req.params.id).select('month year').lean();
    return record ? `${record.year}-${String(record.month).padStart(2, '0')}` : null;
};

module.exports = {
    byInvoice: guard(invoice), bySchedule: guard(schedule), byPayroll: guard(payroll),
    byPeriod: guard((req) => fromPeriod(req.body.period)),
    byPayrollBody: guard((req) => `${req.body.year}-${String(req.body.month).padStart(2, '0')}`),
    byWorkDate: guard((req) => String(req.body.workDate || '').slice(0, 7)),
    byPaidDate: guard((req) => String(req.body.paidAt || '').slice(0, 7)),
    byPayrollPaidDate: guard((req) => req.body.status === 'paid' ? String(req.body.paidDate || '').slice(0, 7) : null),
    currentCashMonth: guard(() => getWorkDate().slice(0, 7))
};
