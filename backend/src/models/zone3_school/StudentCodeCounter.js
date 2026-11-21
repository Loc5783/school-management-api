const mongoose = require('mongoose');

const StudentCodeCounterSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    year: { type: Number, required: true },
    sequence: { type: Number, required: true, default: 0 }
}, { timestamps: true });

// Compound multi-tenant unique index
StudentCodeCounterSchema.index({ tenantId: 1, year: 1 }, {
    unique: true,
    partialFilterExpression: { tenantId: { $type: 'objectId' } }
});

// Legacy backward-compatible unique index
StudentCodeCounterSchema.index({ year: 1 }, {
    unique: true,
    partialFilterExpression: { tenantId: null }
});

module.exports = mongoose.model('StudentCodeCounter', StudentCodeCounterSchema);
