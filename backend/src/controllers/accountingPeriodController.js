const { createHash } = require('crypto');
const mongoose = require('mongoose');
const AccountingPeriod = require('../models/zone4_finance/AccountingPeriod');
const { buildAccountingReport } = require('./accountingReportController');
const { getWorkDate } = require('../utils/dateHelpers');
const { monthPattern, lockOpenPeriod } = require('../services/accountingPeriodService');
const reject = (message, statusCode = 409) => { const error = new Error(message); error.statusCode = statusCode; throw error; };

const signature = (report) => createHash('sha256').update(JSON.stringify({
    invoices: report.invoicePeriod.byClass.map(({ classroomId, invoices, billed }) => [String(classroomId), invoices, billed]),
    payroll: report.payrollPeriod,
    cash: report.cashFlow.daily.map(({ workDate, sourceSignature }) => [workDate, sourceSignature])
})).digest('hex');

const getPeriod = async (req, res) => {
    const month = String(req.params.month || '');
    if (!monthPattern.test(month)) return res.status(400).json({ message: 'Tháng không hợp lệ' });
    try {
        const record = await AccountingPeriod.findOne({ month }).lean();
        if (!record) return res.json({ success: true, data: { month, status: 'open', history: [] } });
        const live = await buildAccountingReport(month);
        return res.json({ success: true, data: { ...record, sourceChanged: record.status === 'closed' && record.sourceHash !== signature(live) } });
    } catch (_) { return res.status(500).json({ message: 'Không thể tải trạng thái kỳ kế toán' }); }
};

const closePeriod = async (req, res) => {
    const month = String(req.params.month || '');
    if (!monthPattern.test(month)) return res.status(400).json({ message: 'Tháng không hợp lệ' });
    if (month >= getWorkDate().slice(0, 7)) return res.status(409).json({ message: 'Chỉ chốt tháng đã kết thúc' });
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 10 || reason.length > 500) return res.status(422).json({ message: 'Ghi căn cứ chốt kỳ từ 10 đến 500 ký tự' });
    const session = await mongoose.startSession();
    try {
        let record;
        await session.withTransaction(async () => {
            const open = await lockOpenPeriod(month, session);
            const report = await buildAccountingReport(month, session);
            const states = report.cashFlow.reconciliation;
            if (states.difference || states.stale || states.needs_review || states.not_recorded || report.cashFlow.byMethod.issues || report.cashFlow.byMethod.unknownAmount) {
                reject('Còn ngày chưa đối soát khớp hoặc chứng từ cần rà; chưa thể chốt kỳ');
            }
            const payroll = report.payrollPeriod.byStatus;
            if (payroll.draft.count || payroll.reviewed.count || payroll.confirmed.count) reject('Còn phiếu lương chưa ghi nhận chi trả trong kỳ lương');
            const actorName = req.user.profile?.fullName || req.user.username;
            const revision = open.revision + 1;
            const sourceHash = signature(report);
            const snapshot = { ...report, closedAt: new Date() };
            const event = { action: 'closed', actorId: req.user._id, actorName, at: snapshot.closedAt, reason, sourceHash, revision, snapshot };
            record = await AccountingPeriod.findOneAndUpdate({ _id: open._id, status: 'open', revision: open.revision },
                { $set: { status: 'closed', snapshot, sourceHash, revision }, $push: { history: event } }, { returnDocument: 'after', session });
            if (!record) reject('Kỳ vừa được cập nhật; hãy tải lại');
        });
        return res.json({ success: true, data: record, message: 'Đã chốt kỳ và lưu ảnh chụp báo cáo' });
    } catch (error) {
        if (error.code === 11000 || error.hasErrorLabel?.('TransientTransactionError')) return res.status(409).json({ message: 'Kỳ vừa có giao dịch mới; hãy tải lại và đối soát trước khi chốt' });
        return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Không thể chốt kỳ kế toán' });
    } finally { await session.endSession(); }
};

const reopenPeriod = async (req, res) => {
    const month = String(req.params.month || '');
    if (!monthPattern.test(month)) return res.status(400).json({ message: 'Tháng không hợp lệ' });
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 10 || reason.length > 500) return res.status(422).json({ message: 'Cần lý do mở lại từ 10 đến 500 ký tự' });
    try {
        const existing = await AccountingPeriod.findOne({ month, status: 'closed' }).lean();
        if (!existing) return res.status(409).json({ message: 'Kỳ chưa chốt hoặc đã mở lại' });
        const revision = existing.revision + 1;
        const record = await AccountingPeriod.findOneAndUpdate({ _id: existing._id, status: 'closed', revision: existing.revision },
            { $set: { status: 'open', revision }, $push: { history: { action: 'reopened', actorId: req.user._id,
                actorName: req.user.profile?.fullName || req.user.username, at: new Date(), reason, sourceHash: existing.sourceHash, revision } } }, { returnDocument: 'after' });
        if (!record) return res.status(409).json({ message: 'Kỳ vừa được thay đổi; hãy tải lại' });
        return res.json({ success: true, data: record, message: 'Đã mở lại kỳ; ảnh chụp lần chốt trước vẫn được lưu' });
    } catch (_) { return res.status(500).json({ message: 'Không thể mở lại kỳ kế toán' }); }
};

module.exports = { getPeriod, closePeriod, reopenPeriod };
