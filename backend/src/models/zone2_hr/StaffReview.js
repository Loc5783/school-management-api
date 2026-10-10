const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  period: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  generalAssessment: { type: String, trim: true, required: true, maxlength: 2000 },
  professionalReviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  professionalStatus: { type: String, enum: ['not_required', 'pending', 'approved', 'changes_requested'], default: 'not_required' },
  professionalAssessment: { type: String, trim: true, maxlength: 2000, default: '' },
  professionalReviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  professionalReviewedAt: Date,
  rating: { type: String, enum: ['excellent', 'good', 'needs_improvement', 'unsatisfactory'], default: 'good' },
  improvementPlan: { type: String, trim: true, maxlength: 2000, default: '' },
  improvementDueOn: { type: String, default: '' },
  improvementStatus: { type: String, enum: ['none', 'open', 'completed'], default: 'none' },
  improvementResult: { type: String, trim: true, maxlength: 1000, default: '' },
  improvementCompletedAt: Date,
  status: { type: String, enum: ['draft', 'finalized'], default: 'draft' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  finalizedAt: Date
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ employeeId: 1, period: 1 }, { unique: true });
schema.index({ professionalReviewerId: 1, professionalStatus: 1 });
schema.index({ improvementStatus: 1, improvementDueOn: 1 });
module.exports = mongoose.model('StaffReview', schema);
