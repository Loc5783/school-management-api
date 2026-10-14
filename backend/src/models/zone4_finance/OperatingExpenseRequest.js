const mongoose = require('mongoose');

const OperatingExpenseRequestSchema = new mongoose.Schema({
    category: { type: String, enum: ['utilities', 'rent', 'maintenance', 'services', 'other'], required: true },
    payee: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    amount: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'paid'], default: 'pending', required: true },
    requestKey: { type: String, required: true, unique: true, trim: true, maxlength: 120 },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    requestedByName: { type: String, required: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedByName: String,
    reviewedAt: Date,
    reviewNote: { type: String, trim: true, maxlength: 500 },
    expenseId: { type: mongoose.Schema.Types.ObjectId, ref: 'OperatingExpense' },
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    paidByName: String,
    paidAt: Date,
    paymentKey: { type: String, trim: true, maxlength: 120 }
}, { timestamps: true });

OperatingExpenseRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('OperatingExpenseRequest', OperatingExpenseRequestSchema);
