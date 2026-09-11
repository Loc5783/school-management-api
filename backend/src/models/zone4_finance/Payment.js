const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
    invoiceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TuitionFee',
        required: true
    },
    paidAt: {
        type: Date,
        default: Date.now
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    method: {
        type: String,
        enum: ['cash', 'bank_transfer', 'ewallet'],
        required: true
    },
    txnRef: {
        type: String, // Mã giao dịch ngân hàng
        trim: true
    },
    receiptNumber: {
        type: String,
        trim: true,
        uppercase: true,
        immutable: true,
        unique: true,
        sparse: true
    },
    idempotencyKey: {
        type: String,
        required: true,
        trim: true,
        maxlength: 120
    },
    note: String,
    recordedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    auditTrail: [{
        action: { type: String, enum: ['created'], required: true },
        actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        actorName: { type: String, required: true },
        occurredAt: { type: Date, default: Date.now, required: true }
    }]
}, {
    timestamps: true
});

PaymentSchema.index({ invoiceId: 1 });
PaymentSchema.index({ recordedBy: 1 });
PaymentSchema.index({ paidAt: 1 });
PaymentSchema.index({ invoiceId: 1, idempotencyKey: 1 }, { unique: true });
PaymentSchema.index({ txnRef: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Payment', PaymentSchema);
