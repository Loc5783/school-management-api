const mongoose = require('mongoose');

const EvaluationPeriodSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
  code: {
    type: String,
    required: true,
        trim: true,
    uppercase: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  schoolYear: {
    type: String,
    required: true,
    trim: true
  },
  startDate: {
    type: String, // YYYY-MM-DD
    required: true
  },
  endDate: {
    type: String, // YYYY-MM-DD
    required: true
  },
  status: {
    type: String,
    enum: ['open', 'closed'],
    default: 'open',
    index: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

EvaluationPeriodSchema.index({ schoolYear: 1, status: 1 });

// Multi-tenant code unique
EvaluationPeriodSchema.index({ tenantId: 1, code: 1 }, { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } });
EvaluationPeriodSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { tenantId: null } });

module.exports = mongoose.model('EvaluationPeriod', EvaluationPeriodSchema);
