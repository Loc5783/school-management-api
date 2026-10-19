const mongoose = require('mongoose');

const TuitionRefundRequestSchema = new mongoose.Schema({
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'TuitionFee', required: true },
    amount: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true, trim: true, minlength: 5, maxlength: 1000 },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'paid'], default: 'pending', required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    requestedByName: { type: String, required: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedByName: String,
    reviewedAt: Date,
    reviewNote: { type: String, trim: true, maxlength: 500 },
    adjustmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'InvoiceAdjustment' },
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    paidByName: String,
    paidAt: Date,
    paymentKey: { type: String, trim: true, maxlength: 120 }
}, { timestamps: true });

TuitionRefundRequestSchema.index({ invoiceId: 1, createdAt: -1 });
TuitionRefundRequestSchema.index({ invoiceId: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['pending', 'approved'] } } });

module.exports = mongoose.model('TuitionRefundRequest', TuitionRefundRequestSchema);
