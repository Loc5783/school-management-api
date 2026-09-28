const mongoose = require('mongoose');

const InvoiceAdjustmentSchema = new mongoose.Schema({
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'TuitionFee', required: true, index: true },
    type: { type: String, enum: ['discount', 'surcharge', 'refund'], required: true },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recordedByName: { type: String, required: true },
    before: {
        totalAmount: Number,
        paidAmount: Number,
        status: String
    },
    after: {
        totalAmount: Number,
        paidAmount: Number,
        status: String
    }
}, { timestamps: true });

InvoiceAdjustmentSchema.index({ invoiceId: 1, createdAt: -1 });

module.exports = mongoose.model('InvoiceAdjustment', InvoiceAdjustmentSchema);
