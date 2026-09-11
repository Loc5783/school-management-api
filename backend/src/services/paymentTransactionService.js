const mongoose = require('mongoose');
const Payment = require('../models/zone4_finance/Payment');
const TuitionFee = require('../models/zone4_finance/TuitionFee');
const { isValidObjectId } = require('../utils/idValidation');

const PAYMENT_METHODS = new Set(['cash', 'bank_transfer', 'ewallet']);

const createReceiptNumber = () => `PT-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${new mongoose.Types.ObjectId().toString().slice(-8).toUpperCase()}`;

const throwHttpError = (message, statusCode) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    throw error;
};

const runInTransaction = async (operation) => {
    const topology = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!topology.setName && topology.msg !== 'isdbgrid') {
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

const recordPayment = async (payload, user, idempotencyKey) => {
    const { invoiceId, amount, method, txnRef, note } = payload;
    const paymentAmount = Number(amount);
    if (!isValidObjectId(invoiceId)) throwHttpError('ID hóa đơn không hợp lệ', 400);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) throwHttpError('Số tiền thanh toán phải lớn hơn 0', 400);
    if (!PAYMENT_METHODS.has(method)) throwHttpError('Phương thức thanh toán không hợp lệ', 400);
    if (!String(idempotencyKey || '').trim()) throwHttpError('Thiếu mã chống ghi nhận thanh toán trùng', 400);

    return runInTransaction(async (session) => {
        const existing = await Payment.findOne({ invoiceId, idempotencyKey: String(idempotencyKey).trim() }).session(session);
        if (existing) {
            const invoice = await TuitionFee.findById(invoiceId).session(session);
            return { payment: existing, invoice, replayed: true };
        }
        if (txnRef) {
            const sameBankTransaction = await Payment.findOne({ txnRef: String(txnRef).trim() }).session(session);
            if (sameBankTransaction) {
                if (String(sameBankTransaction.invoiceId) === String(invoiceId)) {
                    const invoice = await TuitionFee.findById(invoiceId).session(session);
                    return { payment: sameBankTransaction, invoice, replayed: true };
                }
                throwHttpError('Mã giao dịch ngân hàng đã được dùng cho hóa đơn khác', 409);
            }
        }

        const invoice = await TuitionFee.findById(invoiceId).session(session);
        if (!invoice) throwHttpError('Không tìm thấy hóa đơn', 404);
        if (invoice.status === 'cancelled') throwHttpError('Hóa đơn đã bị hủy', 400);
        const remaining = invoice.totalAmount - invoice.paidAmount;
        if (paymentAmount > remaining) {
            throwHttpError(`Số tiền thanh toán vượt quá số tiền còn lại (${remaining})`, 422);
        }
        const actorName = user.profile?.fullName || user.username;
        const payment = (await Payment.create([{
            invoiceId, amount: paymentAmount, method, txnRef: txnRef ? String(txnRef).trim() : undefined,
            receiptNumber: createReceiptNumber(), idempotencyKey: String(idempotencyKey).trim(), note: String(note || '').trim(), recordedBy: user._id,
            auditTrail: [{ action: 'created', actorId: user._id, actorName }]
        }], { session }))[0];
        invoice.paidAmount += paymentAmount;
        invoice.status = invoice.paidAmount >= invoice.totalAmount ? 'paid' : 'partial';
        await invoice.save({ session });
        return { payment, invoice, replayed: false };
    });
};

module.exports = { recordPayment };
