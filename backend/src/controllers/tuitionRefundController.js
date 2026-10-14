const mongoose = require('mongoose');
const TuitionFee = require('../models/zone4_finance/TuitionFee');
const InvoiceAdjustment = require('../models/zone4_finance/InvoiceAdjustment');
const TuitionRefundRequest = require('../models/zone4_finance/TuitionRefundRequest');
const { getWorkDate, isValidWorkDate } = require('../utils/dateHelpers');
const { runStudentTransaction } = require('../services/studentCoreService');
const { lockOpenPeriod } = require('../services/accountingPeriodService');

const fail = (message, statusCode = 422) => { const error = new Error(message); error.statusCode = statusCode; throw error; };
const actorName = (user) => user.profile?.fullName || user.username;
const handleError = (res, error, fallback) => {
    if (error.code === 11000 || error.hasErrorLabel?.('TransientTransactionError')) return res.status(409).json({ message: 'Dữ liệu hoàn tiền vừa thay đổi. Hãy tải lại trước khi tiếp tục.' });
    return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : fallback });
};

const listRefundRequests = async (req, res) => {
    const invoiceId = String(req.query.invoiceId || '');
    if (invoiceId && !mongoose.isValidObjectId(invoiceId)) return res.status(400).json({ message: 'ID hóa đơn không hợp lệ' });
    try {
        const filter = invoiceId ? { invoiceId } : { status: { $in: ['pending', 'approved'] } };
        const requests = await TuitionRefundRequest.find(filter).sort({ createdAt: -1 }).limit(100).lean();
        const invoices = await TuitionFee.find({ _id: { $in: requests.map((item) => item.invoiceId) } })
            .select('studentName className period paidAmount').lean();
        const byId = new Map(invoices.map((item) => [String(item._id), item]));
        return res.json({ success: true, data: requests.map((item) => ({ ...item, invoice: byId.get(String(item.invoiceId)) || null })) });
    } catch (error) { return res.status(500).json({ message: 'Không thể tải yêu cầu hoàn tiền' }); }
};

const createRefundRequest = async (req, res) => {
    const { invoiceId, amount, reason } = req.body;
    if (!mongoose.isValidObjectId(invoiceId)) return res.status(400).json({ message: 'ID hóa đơn không hợp lệ' });
    const value = Number(amount);
    const normalizedReason = String(reason || '').trim();
    if (!Number.isSafeInteger(value) || value <= 0) return res.status(422).json({ message: 'Số tiền hoàn phải là số nguyên VND dương' });
    if (normalizedReason.length < 5 || normalizedReason.length > 1000) return res.status(422).json({ message: 'Lý do phải có từ 5 đến 1000 ký tự' });
    try {
        const request = await runStudentTransaction(async (session) => {
            const invoice = await TuitionFee.findById(invoiceId).session(session);
            if (!invoice) fail('Không tìm thấy hóa đơn', 404);
            if (invoice.status === 'cancelled' || value > invoice.paidAmount) fail('Hóa đơn không còn đủ số đã thu để đề nghị hoàn');
            // A closed invoice period remains immutable as a cash period. The refund is posted only to its actual payout month.
            const [created] = await TuitionRefundRequest.create([{
                invoiceId, amount: value, reason: normalizedReason,
                requestedBy: req.user._id, requestedByName: actorName(req.user)
            }], { session });
            return created;
        });
        return res.status(201).json({ success: true, data: request, message: 'Đã gửi yêu cầu hoàn tiền chờ phê duyệt' });
    } catch (error) { return handleError(res, error, 'Không thể gửi yêu cầu hoàn tiền'); }
};

const reviewRefundRequest = async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'ID yêu cầu không hợp lệ' });
    const decision = String(req.body.decision || '');
    const reviewNote = String(req.body.reviewNote || '').trim();
    if (!['approved', 'rejected'].includes(decision)) return res.status(422).json({ message: 'Quyết định không hợp lệ' });
    if (reviewNote.length > 500 || (decision === 'rejected' && reviewNote.length < 5)) return res.status(422).json({ message: 'Từ chối cần lý do từ 5 đến 500 ký tự' });
    try {
        const request = await TuitionRefundRequest.findById(id);
        if (!request) return res.status(404).json({ message: 'Không tìm thấy yêu cầu' });
        if (String(request.requestedBy) === String(req.user._id)) return res.status(403).json({ message: 'Người lập yêu cầu không được tự duyệt' });
        if (request.status !== 'pending') return res.status(409).json({ message: 'Yêu cầu đã được xử lý. Hãy tải lại.' });
        if (decision === 'approved') {
            const invoice = await TuitionFee.findById(request.invoiceId).select('paidAmount status');
            if (!invoice || invoice.status === 'cancelled' || invoice.paidAmount < request.amount) return res.status(409).json({ message: 'Hóa đơn không còn đủ số đã thu để duyệt hoàn' });
        }
        const updated = await TuitionRefundRequest.findOneAndUpdate({ _id: id, status: 'pending' }, {
            $set: { status: decision, reviewedBy: req.user._id, reviewedByName: actorName(req.user), reviewedAt: new Date(), reviewNote }
        }, { returnDocument: 'after', runValidators: true });
        if (!updated) return res.status(409).json({ message: 'Yêu cầu vừa được xử lý. Hãy tải lại.' });
        return res.json({ success: true, data: updated, message: decision === 'approved' ? 'Đã duyệt; kế toán cần ghi chứng từ chi thực tế' : 'Đã từ chối yêu cầu hoàn tiền' });
    } catch (error) { return handleError(res, error, 'Không thể duyệt yêu cầu hoàn tiền'); }
};

const payRefundRequest = async (req, res) => {
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
    try {
        const result = await runStudentTransaction(async (session) => {
            const request = await TuitionRefundRequest.findById(id).session(session);
            if (!request) fail('Không tìm thấy yêu cầu', 404);
            if (request.status === 'paid') {
                const adjustment = await InvoiceAdjustment.findById(request.adjustmentId).session(session);
                if (request.paymentKey !== key || !adjustment || getWorkDate(adjustment.paidAt) !== paidDate
                    || adjustment.method !== method || adjustment.documentNumber !== documentNumber
                    || (adjustment.transactionRef || '') !== transactionRef) fail('Yêu cầu đã ghi chi; hãy tải lại', 409);
                return { request, adjustment, replayed: true };
            }
            if (request.status !== 'approved') fail('Yêu cầu chưa được duyệt hoặc đã bị từ chối', 409);
            if (paidDate < getWorkDate(request.reviewedAt)) fail('Ngày chi không được trước ngày phê duyệt');
            await lockOpenPeriod(paidDate.slice(0, 7), session);
            const invoice = await TuitionFee.findById(request.invoiceId).session(session);
            if (!invoice || invoice.status === 'cancelled' || request.amount > invoice.paidAmount) fail('Hóa đơn không còn đủ số đã thu để hoàn', 409);
            const before = { totalAmount: invoice.totalAmount, paidAmount: invoice.paidAmount, status: invoice.status };
            invoice.paidAmount -= request.amount;
            invoice.status = invoice.paidAmount >= invoice.totalAmount ? 'paid' : (invoice.paidAmount > 0 ? 'partial' : 'unpaid');
            await invoice.save({ session });
            const [adjustment] = await InvoiceAdjustment.create([{
                invoiceId: invoice._id, type: 'refund', amount: request.amount, reason: request.reason,
                paidAt: new Date(`${paidDate}T05:00:00.000Z`), method, transactionRef, documentNumber, idempotencyKey: key,
                recordedBy: req.user._id, recordedByName: actorName(req.user), before,
                after: { totalAmount: invoice.totalAmount, paidAmount: invoice.paidAmount, status: invoice.status }
            }], { session });
            request.status = 'paid'; request.adjustmentId = adjustment._id;
            request.paidBy = req.user._id; request.paidByName = actorName(req.user); request.paidAt = adjustment.paidAt; request.paymentKey = key;
            await request.save({ session });
            return { request, adjustment, replayed: false };
        });
        return res.json({ success: true, data: result, message: result.replayed ? 'Khoản hoàn đã được ghi trước đó' : 'Đã ghi chi hoàn tiền vào tháng thực trả' });
    } catch (error) { return handleError(res, error, 'Không thể ghi chi hoàn tiền'); }
};

module.exports = { listRefundRequests, createRefundRequest, reviewRefundRequest, payRefundRequest };
