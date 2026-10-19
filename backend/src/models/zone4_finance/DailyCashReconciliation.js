const mongoose = require('mongoose');

const amounts = {
    cashIn: { type: Number, required: true, min: 0 },
    cashOut: { type: Number, required: true, min: 0 },
    bankIn: { type: Number, required: true, min: 0 },
    bankOut: { type: Number, required: true, min: 0 },
    walletIn: { type: Number, required: true, min: 0 },
    walletOut: { type: Number, required: true, min: 0 }
};

const DailyCashReconciliationSchema = new mongoose.Schema({
    workDate: { type: String, required: true, unique: true },
    actual: { type: new mongoose.Schema(amounts, { _id: false }), required: true },
    bookSnapshot: { type: new mongoose.Schema(amounts, { _id: false }), required: true },
    sourceSignature: { type: String, required: true },
    evidenceReference: { type: String, required: true, trim: true, maxlength: 120 },
    note: { type: String, trim: true, maxlength: 1000, default: '' },
    revision: { type: Number, required: true, default: 1 },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recordedByName: { type: String, required: true },
    history: [{
        revision: Number,
        actual: new mongoose.Schema(amounts, { _id: false }),
        bookSnapshot: new mongoose.Schema(amounts, { _id: false }),
        sourceSignature: String,
        evidenceReference: String,
        note: String,
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        changedByName: String,
        changedAt: { type: Date, default: Date.now },
        changeReason: String
    }]
}, { timestamps: true });

module.exports = mongoose.model('DailyCashReconciliation', DailyCashReconciliationSchema);
