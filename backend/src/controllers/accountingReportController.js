const TuitionFee = require('../models/zone4_finance/TuitionFee');
const Payroll = require('../models/zone2_hr/Payroll');
const DailyCashReconciliation = require('../models/zone4_finance/DailyCashReconciliation');
const { loadEntries, statusOf } = require('./cashbookController');
const { getWorkDate } = require('../utils/dateHelpers');

const monthPattern = /^(20\d{2})-(0[1-9]|1[0-2])$/;
const sum = (items, field) => items.reduce((value, item) => value + (Number(item[field]) || 0), 0);

const buildAccountingReport = async (month, session = null) => {
    const [year, monthNumber] = month.split('-').map(Number);
    const period = `${String(monthNumber).padStart(2, '0')}-${year}`;
    const from = `${month}-01`;
    const to = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
        const sources = [
            () => TuitionFee.find({ period, status: { $ne: 'cancelled' } }).select('classroomId className totalAmount paidAmount dueDate status').session(session).lean(),
            () => Payroll.find({ month: monthNumber, year }).select('status netSalary').session(session).lean(),
            () => loadEntries(from, to, session),
            () => DailyCashReconciliation.find({ workDate: { $gte: from, $lte: to } }).select('workDate actual bookSnapshot sourceSignature').session(session).lean()
        ];
        const [invoices, payrolls, cashbook, reconciliations] = session
            ? await sources.reduce(async (previous, source) => [...await previous, await source()], Promise.resolve([]))
            : await Promise.all(sources.map((source) => source()));
        const overdueBefore = new Date(`${getWorkDate()}T00:00:00.000Z`);
        const classMap = new Map();
        for (const invoice of invoices) {
            const key = String(invoice.classroomId);
            if (!classMap.has(key)) classMap.set(key, { classroomId: invoice.classroomId, className: invoice.className, invoices: 0, billed: 0, paidToDate: 0, remaining: 0 });
            const item = classMap.get(key);
            item.invoices += 1; item.billed += Number(invoice.totalAmount) || 0;
            item.paidToDate += Number(invoice.paidAmount) || 0;
            item.remaining += Math.max(0, (Number(invoice.totalAmount) || 0) - (Number(invoice.paidAmount) || 0));
        }
        const tuitionIncome = cashbook.rows.filter((row) => row.source === 'tuition').reduce((total, row) => total + (Number(row.amount) || 0), 0);
        const tuitionRefundOutflow = cashbook.rows.filter((row) => row.source === 'tuition_refund').reduce((total, row) => total + (Number(row.amount) || 0), 0);
        const purchaseOutflow = cashbook.rows.filter((row) => row.source === 'purchase').reduce((total, row) => total + (Number(row.amount) || 0), 0);
        const operatingOutflow = cashbook.rows.filter((row) => row.source === 'operating').reduce((total, row) => total + (Number(row.amount) || 0), 0);
        const payrollOutflow = cashbook.rows.filter((row) => row.source === 'payroll').reduce((total, row) => total + (Number(row.amount) || 0), 0);
        const recordedByDate = new Map(reconciliations.map((item) => [item.workDate, item]));
        const reconciliation = { matched: 0, difference: 0, stale: 0, needs_review: 0, not_recorded: 0 };
        for (const day of cashbook.daily) reconciliation[statusOf(recordedByDate.get(day.workDate), day)] += 1;
        const totalBilled = sum(invoices, 'totalAmount');
        const totalPaidToDate = sum(invoices, 'paidAmount');
        return {
            month, period, generatedAt: new Date(),
            invoicePeriod: { count: invoices.length, billed: totalBilled, paidToDate: totalPaidToDate,
                remaining: invoices.reduce((total, item) => total + Math.max(0, item.totalAmount - item.paidAmount), 0),
                overdue: invoices.reduce((total, item) => total + (item.dueDate < overdueBefore ? Math.max(0, item.totalAmount - item.paidAmount) : 0), 0),
                byClass: [...classMap.values()].sort((a, b) => a.className.localeCompare(b.className, 'vi')) },
            payrollPeriod: { count: payrolls.length, totalNet: sum(payrolls, 'netSalary'),
                byStatus: Object.fromEntries(['draft', 'reviewed', 'confirmed', 'paid'].map((status) => [status, {
                    count: payrolls.filter((item) => item.status === status).length,
                    amount: payrolls.filter((item) => item.status === status).reduce((total, item) => total + (Number(item.netSalary) || 0), 0)
                }])) },
            cashFlow: { tuitionIncome, tuitionRefundOutflow, purchaseOutflow, operatingOutflow, payrollOutflow,
                recordedNet: tuitionIncome - tuitionRefundOutflow - purchaseOutflow - operatingOutflow - payrollOutflow,
                byMethod: cashbook.overall, daily: cashbook.daily, reconciliation }
        };
};

const getAccountingReport = async (req, res) => {
    const month = String(req.query.month || '');
    if (!monthPattern.test(month)) return res.status(400).json({ message: 'Tháng báo cáo phải có dạng YYYY-MM' });
    try {
        return res.json({ success: true, data: await buildAccountingReport(month) });
    } catch (error) { return res.status(500).json({ message: 'Không thể tổng hợp báo cáo kế toán' }); }
};

module.exports = { getAccountingReport, buildAccountingReport };
