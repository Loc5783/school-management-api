const mongoose = require('mongoose');

const TaskHistorySchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ['created', 'assigned', 'accepted', 'progress_updated', 'completed', 'reviewed', 'reopened'],
    required: true
  },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actorName: { type: String, required: true, trim: true },
  actorRole: { type: String, required: true, trim: true },
  note: { type: String, trim: true, maxlength: 1000, default: '' },
  at: { type: Date, default: Date.now }
}, { _id: false });

const PrincipalTaskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, trim: true, maxlength: 2000, default: '' },
  department: {
    type: String,
    enum: ['hr', 'accountant', 'chef', 'guard', 'teacher'],
    required: true,
    index: true
  },
  sourceType: {
    type: String,
    enum: ['refund', 'operating_expense', 'leave', 'payroll', 'recruitment', 'profile_change', 'incident', 'general'],
    default: 'general',
    index: true
  },
  sourceId: { type: String, default: null },
  deduplicationKey: { type: String, unique: true, sparse: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assignedToName: { type: String, trim: true, default: '' },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignedByName: { type: String, required: true, trim: true },
  dueDate: { type: Date, default: null, index: true },
  priority: {
    type: String,
    enum: ['normal', 'high', 'urgent'],
    default: 'normal',
    index: true
  },
  status: {
    type: String,
    enum: ['pending_acceptance', 'in_progress', 'completed', 'needs_review'],
    default: 'pending_acceptance',
    index: true
  },
  resultNote: { type: String, trim: true, maxlength: 1000, default: '' },
  history: [TaskHistorySchema]
}, { timestamps: true });

PrincipalTaskSchema.index({ department: 1, status: 1 });
PrincipalTaskSchema.index({ assignedTo: 1, status: 1 });

module.exports = mongoose.model('PrincipalTask', PrincipalTaskSchema);
