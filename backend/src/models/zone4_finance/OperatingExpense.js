const mongoose = require('mongoose');

const OperatingExpenseSchema = new mongoose.Schema({
    category: { type: String, enum: ['utilities', 'rent', 'maintenance', 'services', 'other'], required: true },
    payee: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    amount: { type: Number, required: true, min: 1 },
    paidAt: { type: Date, required: true },
    method: { type: String, enum: ['cash', 'bank_transfer'], required: true },
    transactionRef: { type: String, trim: true, maxlength: 120 },
    documentNumber: { type: String, required: true, trim: true, maxlength: 120 },
    approvalReference: { type: String, required: true, trim: true, maxlength: 120 },
    approvalRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'OperatingExpenseRequest' },
    note: { type: String, trim: true, maxlength: 500 },
    idempotencyKey: { type: String, required: true, trim: true, maxlength: 120, unique: true },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recordedByName: { type: String, required: true }
}, { timestamps: true });

OperatingExpenseSchema.index({ paidAt: -1 });
OperatingExpenseSchema.index({ documentNumber: 1 }, { unique: true });
OperatingExpenseSchema.index({ transactionRef: 1 }, { unique: true, partialFilterExpression: { transactionRef: { $type: 'string' } } });
OperatingExpenseSchema.index({ approvalRequestId: 1 }, { unique: true, partialFilterExpression: { approvalRequestId: { $type: 'objectId' } } });

module.exports = mongoose.model('OperatingExpense', OperatingExpenseSchema);
