const mongoose = require('mongoose');

const AccountingPeriodSchema = new mongoose.Schema({
    month: { type: String, required: true, unique: true, match: /^20\d{2}-(0[1-9]|1[0-2])$/ },
    status: { type: String, enum: ['closed', 'open'], required: true },
    revision: { type: Number, default: 1, required: true },
    writeVersion: { type: Number, default: 0, required: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    sourceHash: { type: String, required: true },
    history: [{ action: { type: String, enum: ['closed', 'reopened'], required: true },
        actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        actorName: String, at: { type: Date, default: Date.now }, reason: String,
        sourceHash: String, revision: Number, snapshot: mongoose.Schema.Types.Mixed }]
}, { timestamps: true });

module.exports = mongoose.model('AccountingPeriod', AccountingPeriodSchema);
