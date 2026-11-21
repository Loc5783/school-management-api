const mongoose = require('mongoose');
const Payment = require('../models/zone4_finance/Payment');
const TuitionFee = require('../models/zone4_finance/TuitionFee');
const User = require('../models/zone1_system/User');
const { isValidObjectId } = require('../utils/idValidation');
const { getWorkDate } = require('../utils/dateHelpers');
const { lockOpenPeriod } = require('./accountingPeriodService');
const {
    resolveTenantContext,
    buildTenantFilter,
    resolveUserAndTenantContext
} = require('./tenantFilterService');

const PAYMENT_METHODS = new Set(['cash', 'bank_transfer', 'ewallet']);

const createReceiptNumber = () => `PT-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${new mongoose.Types.ObjectId().toString().slice(-8).toUpperCase()}`;

const throwHttpError = (message, statusCode) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    throw error;
};

const runInTransaction = async (operation) => {
    const topology = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!topology.setName && topology.msg !== 'isdbgrid' && process.env.ALLOW_STANDALONE_MONGODB !== 'true') {
        throwHttpError('MongoDB phải chạy Replica Set hoặc sharded cluster để ghi nhận thanh toán an toàn', 503);
    }
    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            result = await operation(session);
        });
        return result;
    } finally {
        await session.endSession();
    }
};

const recordPayment = async (payload, user, idempotencyKey, context = null) => {
    const { invoiceId, amount, method, txnRef, note } = payload;
    const paymentAmount = Number(amount);
    if (!isValidObjectId(invoiceId)) throwHttpError('ID hóa đơn không hợp lệ', 400);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) throwHttpError('Số tiền thanh toán phải lớn hơn 0', 400);
    if (!PAYMENT_METHODS.has(method)) throwHttpError('Phương thức thanh toán không hợp lệ', 400);
    if (!String(idempotencyKey || '').trim()) throwHttpError('Thiếu mã chống ghi nhận thanh toán trùng', 400);
    if (String(idempotencyKey).trim().length > 120) throwHttpError('Mã yêu cầu quá dài', 400);
    const normalizedRef = String(txnRef || '').trim();
    if (method !== 'cash' && !normalizedRef) throwHttpError('Chuyển khoản/ví điện tử cần mã giao dịch để đối soát', 422);
    if (normalizedRef.length > 120) throwHttpError('Mã giao dịch tối đa 120 ký tự', 422);

    let effectiveContext = context;
    if (context !== null && context !== undefined) {
        const resolved = resolveTenantContext(context);
        if (!resolved.isValid) {
            throwHttpError('Ngữ cảnh tenant không hợp lệ hoặc bị thiếu', 403);
        }
        if (user) {
            const validation = resolveUserAndTenantContext(user, context);
            if (!validation.isValid) {
                throwHttpError('Tài khoản người dùng và ngữ cảnh tenant không khớp', 403);
            }
        }
        effectiveContext = context;
    } else {
        const userCtx = resolveTenantContext(user);
        if (userCtx.isSaaS) {
            throwHttpError('Thiếu ngữ cảnh tenant đối với tài khoản SaaS', 403);
        }
        effectiveContext = user;
    }

    const tenantFilter = buildTenantFilter(effectiveContext, { throwOnInvalid: true });
    const resolvedContext = resolveTenantContext(effectiveContext);

    const samePayment = (payment) => payment.amount === paymentAmount && payment.method === method && String(payment.txnRef || '') === normalizedRef && String(payment.note || '') === String(note || '').trim();

    try {
        return await runInTransaction(async (session) => {
            const actor = await User.findOne({ _id: user._id, status: 'active', ...tenantFilter }).session(session);
            if (!actor || !['admin', 'accountant'].includes(actor.role)) {
                throwHttpError('Bạn không có quyền thu tiền hoặc tài khoản đã bị khóa', 403);
            }

            const existing = await Payment.findOne({ invoiceId, idempotencyKey: String(idempotencyKey).trim(), ...tenantFilter }).session(session);
            if (existing) {
                if (!samePayment(existing)) throwHttpError('Mã yêu cầu này đã dùng cho khoản thu khác. Hãy tải lại trước khi thử lại.', 409);
                const invoice = await TuitionFee.findOne({ _id: invoiceId, ...tenantFilter }).session(session);
                return { payment: existing, invoice, replayed: true };
            }
            if (normalizedRef) {
                const sameBankTransaction = await Payment.findOne({ txnRef: normalizedRef, ...tenantFilter }).session(session);
                if (sameBankTransaction) {
                    if (String(sameBankTransaction.invoiceId) === String(invoiceId) && samePayment(sameBankTransaction)) {
                        const invoice = await TuitionFee.findOne({ _id: invoiceId, ...tenantFilter }).session(session);
                        return { payment: sameBankTransaction, invoice, replayed: true };
                    }
                    throwHttpError('Mã giao dịch đã được ghi nhận cho khoản thu khác', 409);
                }
            }

            const paidAt = new Date();
            await lockOpenPeriod(getWorkDate(paidAt).slice(0, 7), session, effectiveContext);

            const invoice = await TuitionFee.findOne({ _id: invoiceId, ...tenantFilter }).session(session);
            if (!invoice) throwHttpError('Không tìm thấy hóa đơn', 404);
            if (invoice.status === 'cancelled') throwHttpError('Hóa đơn đã bị hủy', 400);
            const remaining = invoice.totalAmount - invoice.paidAmount;
            if (paymentAmount > remaining) {
                throwHttpError(`Số tiền thanh toán vượt quá số tiền còn lại (${remaining})`, 422);
            }
            const actorName = actor.profile?.fullName || actor.username;
            const paymentPayload = {
                invoiceId,
                amount: paymentAmount,
                paidAt,
                method,
                txnRef: normalizedRef || undefined,
                receiptNumber: createReceiptNumber(),
                idempotencyKey: String(idempotencyKey).trim(),
                note: String(note || '').trim(),
                recordedBy: actor._id,
                auditTrail: [{ action: 'created', actorId: actor._id, actorName, occurredAt: paidAt }]
            };
            if (resolvedContext.isSaaS) {
                paymentPayload.tenantId = resolvedContext.tenantId;
            }
            const payment = (await Payment.create([paymentPayload], { session }))[0];
            invoice.paidAmount += paymentAmount;
            invoice.status = invoice.paidAmount >= invoice.totalAmount ? 'paid' : 'partial';
            await invoice.save({ session });
            return { payment, invoice, replayed: false };
        });
    } catch (error) {
        if (error.code === 11000) {
            throwHttpError('Mã giao dịch, biên lai hoặc mã yêu cầu đã được ghi nhận trong hệ thống. Hãy kiểm tra lại.', 409);
        }
        throw error;
    }
};

module.exports = { recordPayment };
