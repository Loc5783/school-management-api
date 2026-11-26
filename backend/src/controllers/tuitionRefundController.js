const mongoose = require('mongoose');
const TuitionFee = require('../models/zone4_finance/TuitionFee');
const InvoiceAdjustment = require('../models/zone4_finance/InvoiceAdjustment');
const TuitionRefundRequest = require('../models/zone4_finance/TuitionRefundRequest');
const User = require('../models/zone1_system/User');
const { getWorkDate, isValidWorkDate } = require('../utils/dateHelpers');
const { runStudentTransaction } = require('../services/studentCoreService');
const { lockOpenPeriod } = require('../services/accountingPeriodService');
const {
    assertTenantContext,
    buildTenantFilter,
    resolveTenantContext
} = require('../services/tenantFilterService');

const fail = (message, statusCode = 422) => { const error = new Error(message); error.statusCode = statusCode; throw error; };
const actorName = (user) => user.profile?.fullName || user.username;
const handleError = (res, error, fallback) => {
    if (error.code === 11000 || error.hasErrorLabel?.('TransientTransactionError')) {
        return res.status(409).json({ message: 'Dữ liệu hoàn tiền vừa thay đổi hoặc đã có yêu cầu xử lý. Hãy tải lại trước khi tiếp tục.' });
    }
    return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : fallback });
};

const listRefundRequests = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const invoiceId = String(req.query.invoiceId || '');
        if (invoiceId && !mongoose.isValidObjectId(invoiceId)) return res.status(400).json({ message: 'ID hóa đơn không hợp lệ' });
        if (invoiceId) {
            const invoiceExists = await TuitionFee.findOne({ _id: invoiceId, ...tenantFilter }).select('_id');
            if (!invoiceExists) return res.json({ success: true, data: [] });
        }
        const filter = { ...(invoiceId ? { invoiceId } : { status: { $in: ['pending', 'approved'] } }), ...tenantFilter };
        const requests = await TuitionRefundRequest.find(filter).sort({ createdAt: -1 }).limit(100).lean();
        const invoices = await TuitionFee.find({ _id: { $in: requests.map((item) => item.invoiceId) }, ...tenantFilter })
            .select('studentName className period paidAmount').lean();
        const byId = new Map(invoices.map((item) => [String(item._id), item]));
        return res.json({ success: true, data: requests.map((item) => ({ ...item, invoice: byId.get(String(item.invoiceId)) || null })) });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Không thể tải yêu cầu hoàn tiền' });
    }
};

const createRefundRequest = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const resolved = resolveTenantContext(req);
        const { invoiceId, amount, reason } = req.body;
        if (!mongoose.isValidObjectId(invoiceId)) return res.status(400).json({ message: 'ID hóa đơn không hợp lệ' });
        const value = Number(amount);
        const normalizedReason = String(reason || '').trim();
        if (!Number.isSafeInteger(value) || value <= 0) return res.status(422).json({ message: 'Số tiền hoàn phải là số nguyên VND dương' });
        if (normalizedReason.length < 5 || normalizedReason.length > 1000) return res.status(422).json({ message: 'Lý do phải có từ 5 đến 1000 ký tự' });

        const request = await runStudentTransaction(async (session) => {
            const actor = await User.findOne({ _id: req.user._id, status: 'active', ...tenantFilter }).session(session);
            if (!actor || !['accountant', 'admin'].includes(actor.role)) {
                fail('Bạn không có quyền lập đề nghị hoàn học phí hoặc tài khoản đã bị khóa', 403);
            }
            const invoice = await TuitionFee.findOne({ _id: invoiceId, ...tenantFilter }).session(session);
            if (!invoice) fail('Không tìm thấy hóa đơn', 404);
            if (invoice.status === 'cancelled' || value > invoice.paidAmount) fail('Hóa đơn không còn đủ số đã thu để đề nghị hoàn');

            const existingPending = await TuitionRefundRequest.find({
                invoiceId,
                status: { $in: ['pending', 'approved'] },
                ...tenantFilter
            }).session(session);
            const pendingTotal = existingPending.reduce((sum, r) => sum + r.amount, 0);
            if (value + pendingTotal > invoice.paidAmount) {
                fail('Tổng số tiền đề nghị hoàn vượt quá số đã thu của hóa đơn', 422);
            }

            const refundPayload = {
                invoiceId,
                amount: value,
                reason: normalizedReason,
                requestedBy: actor._id,
                requestedByName: actor.profile?.fullName || actor.username
            };
            if (resolved.isSaaS) {
                refundPayload.tenantId = resolved.tenantId;
            }
            const [created] = await TuitionRefundRequest.create([refundPayload], { session });
            return created;
        });
        return res.status(201).json({ success: true, data: request, message: 'Đã gửi yêu cầu hoàn tiền chờ phê duyệt' });
    } catch (error) { return handleError(res, error, 'Không thể gửi yêu cầu hoàn tiền'); }
};

const reviewRefundRequest = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'ID yêu cầu không hợp lệ' });
        const decision = String(req.body.decision || '');
        const reviewNote = String(req.body.reviewNote || '').trim();
        if (!['approved', 'rejected'].includes(decision)) return res.status(422).json({ message: 'Quyết định không hợp lệ' });
        if (reviewNote.length > 500 || (decision === 'rejected' && reviewNote.length < 5)) return res.status(422).json({ message: 'Từ chối cần lý do từ 5 đến 500 ký tự' });

        const updated = await runStudentTransaction(async (session) => {
            const reviewer = await User.findOne({ _id: req.user._id, status: 'active', ...tenantFilter }).session(session);
            if (!reviewer || !['admin', 'principal'].includes(reviewer.role)) {
                fail('Bạn không có quyền duyệt yêu cầu hoàn phí hoặc tài khoản đã bị khóa', 403);
            }
            const request = await TuitionRefundRequest.findOne({ _id: id, ...tenantFilter }).session(session);
            if (!request) fail('Không tìm thấy yêu cầu', 404);
            if (reviewer.role !== 'admin' && String(request.requestedBy) === String(reviewer._id)) {
                fail('Người lập yêu cầu không được tự duyệt', 403);
            }
            if (request.status !== 'pending') fail('Yêu cầu đã được xử lý. Hãy tải lại.', 409);
            if (decision === 'approved') {
                const invoice = await TuitionFee.findOne({ _id: request.invoiceId, ...tenantFilter }).session(session).select('paidAmount status');
                if (!invoice || invoice.status === 'cancelled' || invoice.paidAmount < request.amount) {
                    fail('Hóa đơn không còn đủ số đã thu để duyệt hoàn', 409);
                }
            }
            const resDoc = await TuitionRefundRequest.findOneAndUpdate({ _id: id, status: 'pending', ...tenantFilter }, {
                $set: { status: decision, reviewedBy: reviewer._id, reviewedByName: reviewer.profile?.fullName || reviewer.username, reviewedAt: new Date(), reviewNote }
            }, { returnDocument: 'after', runValidators: true, session });
            if (!resDoc) fail('Yêu cầu vừa được xử lý. Hãy tải lại.', 409);
            return resDoc;
        });
        return res.json({ success: true, data: updated, message: decision === 'approved' ? 'Đã duyệt; kế toán cần ghi chứng từ chi thực tế' : 'Đã từ chối yêu cầu hoàn tiền' });
    } catch (error) { return handleError(res, error, 'Không thể duyệt yêu cầu hoàn tiền'); }
};

const payRefundRequest = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const resolved = resolveTenantContext(req);
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'ID yêu cầu không hợp lệ' });
        const paidDate = String(req.body.paidDate || '');
        const method = String(req.body.method || '');
        const transactionRef = String(req.body.transactionRef || '').trim();
        const documentNumber = String(req.body.documentNumber || '').trim();
        const key = String(req.get('Idempotency-Key') || '').trim();
        if (!isValidWorkDate(paidDate) || paidDate > getWorkDate()) return res.status(422).json({ message: 'Ngày chi không hợp lệ hoặc ở tương lai' });
        if (!['cash', 'bank_transfer'].includes(method)) return res.status(422).json({ message: 'Chọn phương thức chi hợp lệ' });
        if (!documentNumber || documentNumber.length > 120) return res.status(422).json({ message: 'Cần số chứng từ chi (tối đa 120 ký tự)' });
        if (transactionRef.length > 120 || (method === 'bank_transfer' && !transactionRef)) return res.status(422).json({ message: 'Chuyển khoản cần mã giao dịch (tối đa 120 ký tự)' });
        if (!key || key.length > 120) return res.status(422).json({ message: 'Thiếu mã yêu cầu chống ghi trùng' });

        const result = await runStudentTransaction(async (session) => {
            const actor = await User.findOne({ _id: req.user._id, status: 'active', ...tenantFilter }).session(session);
            if (!actor || !['accountant', 'admin'].includes(actor.role)) {
                fail('Bạn không có quyền chi trả hoàn phí hoặc tài khoản đã bị khóa', 403);
            }
            const request = await TuitionRefundRequest.findOne({ _id: id, ...tenantFilter }).session(session);
            if (!request) fail('Không tìm thấy yêu cầu', 404);
            if (request.status === 'paid') {
                const adjustment = await InvoiceAdjustment.findOne({ _id: request.adjustmentId, ...tenantFilter }).session(session);
                if (request.paymentKey !== key || !adjustment || getWorkDate(adjustment.paidAt) !== paidDate
                    || adjustment.method !== method || adjustment.documentNumber !== documentNumber
                    || (adjustment.transactionRef || '') !== transactionRef) fail('Yêu cầu đã ghi chi; hãy tải lại', 409);
                return { request, adjustment, replayed: true };
            }
            if (request.status !== 'approved') fail('Yêu cầu chưa được duyệt hoặc đã bị từ chối', 409);
            if (paidDate < getWorkDate(request.reviewedAt)) fail('Ngày chi không được trước ngày phê duyệt');
            await lockOpenPeriod(paidDate.slice(0, 7), session, req);
            const invoice = await TuitionFee.findOne({ _id: request.invoiceId, ...tenantFilter }).session(session);
            if (!invoice || invoice.status === 'cancelled' || request.amount > invoice.paidAmount) fail('Hóa đơn không còn đủ số đã thu để hoàn', 409);
            const before = { totalAmount: invoice.totalAmount, paidAmount: invoice.paidAmount, status: invoice.status };
            invoice.paidAmount -= request.amount;
            invoice.status = invoice.paidAmount >= invoice.totalAmount ? 'paid' : (invoice.paidAmount > 0 ? 'partial' : 'unpaid');
            await invoice.save({ session });
            const adjustmentPayload = {
                invoiceId: invoice._id, type: 'refund', amount: request.amount, reason: request.reason,
                paidAt: new Date(`${paidDate}T05:00:00.000Z`), method, transactionRef, documentNumber, idempotencyKey: key,
                recordedBy: actor._id, recordedByName: actor.profile?.fullName || actor.username, before,
                after: { totalAmount: invoice.totalAmount, paidAmount: invoice.paidAmount, status: invoice.status }
            };
            if (resolved.isSaaS) {
                adjustmentPayload.tenantId = resolved.tenantId;
            }
            const [adjustment] = await InvoiceAdjustment.create([adjustmentPayload], { session });
            request.status = 'paid'; request.adjustmentId = adjustment._id;
            request.paidBy = actor._id; request.paidByName = actor.profile?.fullName || actor.username; request.paidAt = adjustment.paidAt; request.paymentKey = key;
            await request.save({ session });
            return { request, adjustment, replayed: false };
        });
        return res.json({ success: true, data: result, message: result.replayed ? 'Khoản hoàn đã được ghi trước đó' : 'Đã ghi chi hoàn tiền vào tháng thực trả' });
    } catch (error) { return handleError(res, error, 'Không thể ghi chi hoàn tiền'); }
};

module.exports = { listRefundRequests, createRefundRequest, reviewRefundRequest, payRefundRequest };
