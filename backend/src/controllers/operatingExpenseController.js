const OperatingExpense = require('../models/zone4_finance/OperatingExpense');
const OperatingExpenseRequest = require('../models/zone4_finance/OperatingExpenseRequest');
const User = require('../models/zone1_system/User');
const mongoose = require('mongoose');
const { getWorkDate, isValidWorkDate, startOfWorkDate } = require('../utils/dateHelpers');
const { runStudentTransaction } = require('../services/studentCoreService');
const { lockOpenPeriod } = require('../services/accountingPeriodService');
const {
    assertTenantContext,
    buildTenantFilter,
    resolveTenantContext
} = require('../services/tenantFilterService');

const fail = (message, statusCode = 422) => { const error = new Error(message); error.statusCode = statusCode; throw error; };
const monthPattern = /^20\d{2}-(0[1-9]|1[0-2])$/;
const actorName = (user) => user.profile?.fullName || user.username;
const handleError = (res, error, fallback) => {
    if (error.code === 11000 || error.hasErrorLabel?.('TransientTransactionError')) {
        return res.status(409).json({ message: 'Dữ liệu vừa được cập nhật hoặc chứng từ/mã yêu cầu bị trùng lặp. Hãy tải lại trước khi tiếp tục.' });
    }
    return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : fallback });
};

const listOperatingExpenseRequests = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const status = String(req.query.status || 'active');
        if (!['active', 'all'].includes(status)) return res.status(400).json({ message: 'Bộ lọc không hợp lệ' });
        const page = Number(req.query.page || 1);
        if (!Number.isInteger(page) || page < 1) return res.status(400).json({ message: 'Trang không hợp lệ' });
        const filter = { ...(status === 'active' ? { status: { $in: ['pending', 'approved'] } } : {}), ...tenantFilter };
        const [data, total] = await Promise.all([
            OperatingExpenseRequest.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 20).limit(20).lean(),
            OperatingExpenseRequest.countDocuments(filter)
        ]);
        return res.json({ success: true, data, pagination: { page, total, totalPages: Math.max(1, Math.ceil(total / 20)) } });
    } catch (error) { return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Không thể tải đề nghị chi' }); }
};

const createOperatingExpenseRequest = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const resolved = resolveTenantContext(req);
        const { category } = req.body;
        const payee = String(req.body.payee || '').trim();
        const description = String(req.body.description || '').trim();
        const amount = Number(req.body.amount);
        const requestKey = String(req.get('Idempotency-Key') || '').trim();
        if (!['utilities', 'rent', 'maintenance', 'services', 'other'].includes(category)) fail('Nhóm chi không hợp lệ');
        if (!payee || payee.length > 160) fail('Nhập đơn vị/người nhận tiền (tối đa 160 ký tự)');
        if (!description || description.length > 500) fail('Nhập nội dung chi (tối đa 500 ký tự)');
        if (!Number.isSafeInteger(amount) || amount <= 0) fail('Số tiền đề nghị phải là số nguyên VND dương');
        if (!requestKey || requestKey.length > 120) fail('Thiếu mã yêu cầu chống ghi trùng', 400);

        const result = await runStudentTransaction(async (session) => {
            const actor = await User.findOne({ _id: req.user._id, status: 'active', ...tenantFilter }).session(session);
            if (!actor || !['accountant', 'admin'].includes(actor.role)) {
                fail('Bạn không có quyền lập đề nghị chi hoặc tài khoản đã bị khóa', 403);
            }
            const existing = await OperatingExpenseRequest.findOne({ requestKey, ...tenantFilter }).session(session);
            if (existing) {
                if (existing.category !== category || existing.payee !== payee || existing.description !== description || existing.amount !== amount) fail('Mã yêu cầu đã dùng cho đề nghị khác', 409);
                return { request: existing, replayed: true };
            }
            const requestPayload = {
                category, payee, description, amount, requestKey,
                requestedBy: actor._id, requestedByName: actor.profile?.fullName || actor.username
            };
            if (resolved.isSaaS) {
                requestPayload.tenantId = resolved.tenantId;
            }
            const [request] = await OperatingExpenseRequest.create([requestPayload], { session });
            return { request, replayed: false };
        });
        return res.status(result.replayed ? 200 : 201).json({ success: true,
            message: result.replayed ? 'Đề nghị đã được gửi trước đó' : 'Đã gửi đề nghị chi chờ phê duyệt', data: result.request });
    } catch (error) { return handleError(res, error, 'Không thể gửi đề nghị chi'); }
};

const reviewOperatingExpenseRequest = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'ID đề nghị không hợp lệ' });
        const decision = String(req.body.decision || '');
        const reviewNote = String(req.body.reviewNote || '').trim();
        if (!['approved', 'rejected'].includes(decision)) return res.status(422).json({ message: 'Quyết định không hợp lệ' });
        if (reviewNote.length > 500 || (decision === 'rejected' && reviewNote.length < 5)) return res.status(422).json({ message: 'Từ chối cần lý do từ 5 đến 500 ký tự' });

        const updated = await runStudentTransaction(async (session) => {
            const reviewer = await User.findOne({ _id: req.user._id, status: 'active', ...tenantFilter }).session(session);
            if (!reviewer || !['admin', 'principal'].includes(reviewer.role)) {
                fail('Bạn không có quyền duyệt đề nghị chi hoặc tài khoản đã bị khóa', 403);
            }
            const request = await OperatingExpenseRequest.findOne({ _id: req.params.id, ...tenantFilter }).session(session).select('status requestedBy');
            if (!request) fail('Không tìm thấy đề nghị', 404);
            if (String(request.requestedBy) === String(reviewer._id)) fail('Người lập không được tự duyệt', 403);
            if (request.status !== 'pending') fail('Đề nghị đã được xử lý. Hãy tải lại.', 409);
            const resDoc = await OperatingExpenseRequest.findOneAndUpdate({ _id: request._id, status: 'pending', ...tenantFilter }, {
                $set: { status: decision, reviewedBy: reviewer._id, reviewedByName: reviewer.profile?.fullName || reviewer.username, reviewedAt: new Date(), reviewNote }
            }, { returnDocument: 'after', runValidators: true, session });
            if (!resDoc) fail('Đề nghị vừa được xử lý. Hãy tải lại.', 409);
            return resDoc;
        });
        return res.json({ success: true, data: updated, message: decision === 'approved' ? 'Đã duyệt; kế toán có thể ghi chi sau khi thanh toán thực tế' : 'Đã từ chối đề nghị chi' });
    } catch (error) { return handleError(res, error, 'Không thể xử lý đề nghị chi'); }
};

const getOperatingExpenses = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const month = String(req.query.month || '');
        const page = Number(req.query.page || 1);
        if (!monthPattern.test(month)) return res.status(400).json({ message: 'Tháng tra cứu phải có dạng YYYY-MM' });
        if (!Number.isInteger(page) || page < 1) return res.status(400).json({ message: 'Trang không hợp lệ' });
        const [year, monthNumber] = month.split('-').map(Number);
        const from = startOfWorkDate(`${month}-01`);
        const to = startOfWorkDate(new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10));
        const filter = { paidAt: { $gte: from, $lt: to }, ...tenantFilter };
        const [data, totals] = await Promise.all([
            OperatingExpense.find(filter).sort({ paidAt: -1, _id: -1 }).skip((page - 1) * 20).limit(20).lean(),
            OperatingExpense.aggregate([{ $match: filter }, { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$amount' } } }])
        ]);
        const summary = totals[0] || { count: 0, total: 0 };
        return res.json({ success: true, data, summary: { count: summary.count, total: summary.total },
            pagination: { page, totalPages: Math.max(1, Math.ceil(summary.count / 20)) } });
    } catch (error) { return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Không thể tải sổ chi vận hành' }); }
};

const recordOperatingExpense = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const resolved = resolveTenantContext(req);
        const { paidAt, method } = req.body;
        const requestId = String(req.body.requestId || '');
        const documentNumber = String(req.body.documentNumber || '').trim();
        const transactionRef = method === 'cash' ? '' : String(req.body.transactionRef || '').trim();
        const note = String(req.body.note || '').trim();
        const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
        if (!mongoose.isValidObjectId(requestId)) fail('Chọn đề nghị chi đã được duyệt', 400);
        if (!isValidWorkDate(paidAt) || paidAt > getWorkDate()) fail('Ngày chi không hợp lệ hoặc ở tương lai');
        if (!['cash', 'bank_transfer'].includes(method)) fail('Phương thức chi không hợp lệ');
        if (!documentNumber || documentNumber.length > 120) fail('Cần số chứng từ chi (tối đa 120 ký tự)');
        if (transactionRef.length > 120 || (method === 'bank_transfer' && !transactionRef)) fail('Chuyển khoản cần mã giao dịch (tối đa 120 ký tự)');
        if (note.length > 500) fail('Ghi chú tối đa 500 ký tự');
        if (!idempotencyKey || idempotencyKey.length > 120) fail('Thiếu mã yêu cầu chống ghi trùng', 400);

        const result = await runStudentTransaction(async (session) => {
            const actor = await User.findOne({ _id: req.user._id, status: 'active', ...tenantFilter }).session(session);
            if (!actor || !['accountant', 'admin'].includes(actor.role)) {
                fail('Bạn không có quyền ghi khoản chi vận hành hoặc tài khoản đã bị khóa', 403);
            }
            const request = await OperatingExpenseRequest.findOne({ _id: requestId, ...tenantFilter }).session(session);
            if (!request) fail('Không tìm thấy đề nghị chi', 404);
            if (request.status === 'paid') {
                const expense = await OperatingExpense.findOne({ _id: request.expenseId, ...tenantFilter }).session(session);
                if (request.paymentKey !== idempotencyKey || !expense || getWorkDate(expense.paidAt) !== paidAt
                    || expense.method !== method || (expense.transactionRef || '') !== transactionRef
                    || expense.documentNumber !== documentNumber || (expense.note || '') !== note) fail('Khoản chi đã được ghi; hãy tải lại sổ', 409);
                return { expense, replayed: true };
            }
            if (request.status !== 'approved') fail('Đề nghị chưa được phê duyệt hoặc đã bị từ chối', 409);
            if (paidAt < getWorkDate(request.reviewedAt)) fail('Ngày chi không được trước ngày phê duyệt');
            await lockOpenPeriod(paidAt.slice(0, 7), session, req);

            const approvalReference = `DX-${request._id}`;
            const expensePayload = {
                category: request.category, payee: request.payee, description: request.description, amount: request.amount,
                paidAt: new Date(`${paidAt}T05:00:00.000Z`), method,
                transactionRef: transactionRef || undefined, documentNumber, approvalReference, note,
                approvalRequestId: request._id, idempotencyKey,
                recordedBy: actor._id, recordedByName: actor.profile?.fullName || actor.username
            };
            if (resolved.isSaaS) {
                expensePayload.tenantId = resolved.tenantId;
            }
            const [expense] = await OperatingExpense.create([expensePayload], { session });
            request.status = 'paid'; request.expenseId = expense._id; request.paidBy = actor._id;
            request.paidByName = actor.profile?.fullName || actor.username; request.paidAt = expense.paidAt; request.paymentKey = idempotencyKey;
            await request.save({ session });
            return { expense, replayed: false };
        });
        return res.status(result.replayed ? 200 : 201).json({ success: true,
            message: result.replayed ? 'Khoản chi đã được ghi nhận trước đó' : 'Đã ghi khoản chi vận hành vào sổ', data: result.expense });
    } catch (error) { return handleError(res, error, 'Không thể ghi khoản chi vận hành'); }
};

module.exports = { getOperatingExpenses, listOperatingExpenseRequests, createOperatingExpenseRequest, reviewOperatingExpenseRequest, recordOperatingExpense };
