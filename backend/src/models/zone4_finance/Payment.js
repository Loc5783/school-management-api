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
    note: String,
    recordedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});

PaymentSchema.index({ invoiceId: 1 });
PaymentSchema.index({ recordedBy: 1 });
PaymentSchema.index({ paidAt: 1 });

module.exports = mongoose.model('Payment', PaymentSchema);