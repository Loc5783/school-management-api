const { createHash } = require('crypto');
const mongoose = require('mongoose');
const AccountingPeriod = require('../models/zone4_finance/AccountingPeriod');
const User = require('../models/zone1_system/User');
const { buildAccountingReport } = require('./accountingReportController');
const { getWorkDate } = require('../utils/dateHelpers');
const { runSafeTransaction } = require('../utils/safeTransaction');
const { monthPattern, lockOpenPeriod } = require('../services/accountingPeriodService');
const { buildTenantFilter, assertTenantContext } = require('../services/tenantFilterService');
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
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const record = await AccountingPeriod.findOne({ ...tenantFilter, month }).lean();
        if (!record) return res.json({ success: true, data: { month, status: 'open', history: [] } });
        const live = await buildAccountingReport(month, null, req);
        return res.json({ success: true, data: { ...record, sourceChanged: record.status === 'closed' && record.sourceHash !== signature(live) } });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Không thể tải trạng thái kỳ kế toán' });
    }
};

const closePeriod = async (req, res) => {
    const month = String(req.params.month || '');
    if (!monthPattern.test(month)) return res.status(400).json({ message: 'Tháng không hợp lệ' });
    if (month >= getWorkDate().slice(0, 7)) return res.status(409).json({ message: 'Chỉ chốt tháng đã kết thúc' });
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 10 || reason.length > 500) return res.status(422).json({ message: 'Ghi căn cứ chốt kỳ từ 10 đến 500 ký tự' });
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const record = await runSafeTransaction(async (session) => {
            const actor = await User.findOne({ _id: req.user._id, status: 'active', ...tenantFilter }).session(session);
            if (!actor || !['admin', 'principal'].includes(actor.role)) {
                reject('Người dùng không có quyền chốt kỳ kế toán hoặc tài khoản đã bị khóa', 403);
            }
            const open = await lockOpenPeriod(month, session, req);
            const report = await buildAccountingReport(month, session, req);
            const states = report.cashFlow.reconciliation;
            if (states.difference || states.stale || states.needs_review || states.not_recorded || report.cashFlow.byMethod.issues || report.cashFlow.byMethod.unknownAmount) {
                reject('Còn ngày chưa đối soát khớp hoặc chứng từ cần rà; chưa thể chốt kỳ');
            }
            const payroll = report.payrollPeriod.byStatus;
            if (payroll.draft.count || payroll.reviewed.count || payroll.confirmed.count) reject('Còn phiếu lương chưa ghi nhận chi trả trong kỳ lương');
            const actorName = actor.profile?.fullName || actor.username;
            const revision = open.revision + 1;
            const sourceHash = signature(report);
            const snapshot = { ...report, closedAt: new Date() };
            const event = { action: 'closed', actorId: actor._id, actorName, at: snapshot.closedAt, reason, sourceHash, revision, snapshot };
            const updatedRecord = await AccountingPeriod.findOneAndUpdate({ _id: open._id, ...tenantFilter, status: 'open', revision: open.revision },
                { $set: { status: 'closed', snapshot, sourceHash, revision }, $push: { history: event } }, { returnDocument: 'after', ...(session ? { session } : {}) });
            if (!updatedRecord) reject('Kỳ vừa được cập nhật; hãy tải lại');
            return updatedRecord;
        }, 'MongoDB cần Replica Set để chốt kỳ kế toán an toàn');
        return res.json({ success: true, data: record, message: 'Đã chốt kỳ và lưu ảnh chụp báo cáo' });
    } catch (outerError) {
        if (outerError.code === 11000 || outerError.hasErrorLabel?.('TransientTransactionError')) {
            return res.status(409).json({ message: 'Kỳ vừa có giao dịch mới; hãy tải lại và đối soát trước khi chốt' });
        }
        return res.status(outerError.statusCode || 500).json({ message: outerError.statusCode ? outerError.message : 'Không thể chốt kỳ kế toán' });
    }
};

const reopenPeriod = async (req, res) => {
    const month = String(req.params.month || '');
    if (!monthPattern.test(month)) return res.status(400).json({ message: 'Tháng không hợp lệ' });
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 10 || reason.length > 500) return res.status(422).json({ message: 'Cần lý do mở lại từ 10 đến 500 ký tự' });
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const record = await runSafeTransaction(async (session) => {
            const actor = await User.findOne({ _id: req.user._id, status: 'active', ...tenantFilter }).session(session);
            if (!actor || !['admin', 'principal'].includes(actor.role)) {
                reject('Người dùng không có quyền mở lại kỳ kế toán hoặc tài khoản đã bị khóa', 403);
            }
            const existing = await AccountingPeriod.findOne({ ...tenantFilter, month, status: 'closed' }).session(session);
            if (!existing) reject('Kỳ chưa chốt hoặc đã mở lại', 409);
            const revision = existing.revision + 1;
            const actorName = actor.profile?.fullName || actor.username;
            const historyEntry = { action: 'reopened', actorId: actor._id,
                actorName, at: new Date(), reason, sourceHash: existing.sourceHash, revision };
            const reopenedRecord = await AccountingPeriod.findOneAndUpdate({ _id: existing._id, ...tenantFilter, status: 'closed', revision: existing.revision },
                { $set: { status: 'open', revision }, $push: { history: historyEntry } }, { returnDocument: 'after', ...(session ? { session } : {}) });
            if (!reopenedRecord) reject('Kỳ vừa được thay đổi; hãy tải lại', 409);
            return reopenedRecord;
        }, 'MongoDB cần Replica Set để mở lại kỳ kế toán an toàn');
        return res.json({ success: true, data: record, message: 'Đã mở lại kỳ; ảnh chụp lần chốt trước vẫn được lưu' });
    } catch (outerError) {
        return res.status(outerError.statusCode || 500).json({ message: outerError.statusCode ? outerError.message : 'Không thể mở lại kỳ kế toán' });
    }
};

module.exports = { getPeriod, closePeriod, reopenPeriod };
