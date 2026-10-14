const mongoose = require('mongoose');

const PurchaseExpenseSchema = new mongoose.Schema({
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true, index: true },
    orderCode: { type: String, required: true },
    supplierName: { type: String, required: true },
    amount: { type: Number, required: true, min: 1 },
    paidAt: { type: Date, required: true },
    method: { type: String, enum: ['cash', 'bank_transfer'], required: true },
    transactionRef: { type: String, trim: true, maxlength: 120 },
    documentNumber: { type: String, required: true, trim: true, maxlength: 120 },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recordedByName: { type: String, required: true },
    idempotencyKey: { type: String, required: true, maxlength: 120 }
}, { timestamps: true });

PurchaseExpenseSchema.index({ orderId: 1, idempotencyKey: 1 }, { unique: true });
PurchaseExpenseSchema.index({ transactionRef: 1 }, { unique: true, sparse: true });
PurchaseExpenseSchema.index({ paidAt: -1 });

module.exports = mongoose.model('PurchaseExpense', PurchaseExpenseSchema);
