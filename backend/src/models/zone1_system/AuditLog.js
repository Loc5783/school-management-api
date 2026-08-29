const mongoose = require('mongoose');

// Generic security and authorization audit trail. Sensitive values must be
// reduced before being written here (never passwords, tokens, or API keys).
const AuditLogSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actorUsername: { type: String, required: true },
  action: {
    type: String,
    enum: ['PARENT_STUDENTS_LINKED', 'USER_STATUS_CHANGED'],
    required: true
  },
  targetType: { type: String, required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
  before: { type: mongoose.Schema.Types.Mixed, default: {} },
  after: { type: mongoose.Schema.Types.Mixed, default: {} },
  reason: { type: String, trim: true, maxlength: 500 },
  requestId: { type: String, trim: true, maxlength: 100 },
  occurredAt: { type: Date, default: Date.now, required: true }
}, { timestamps: true, collection: 'authorization_audit_logs' });

AuditLogSchema.index({ targetType: 1, targetId: 1, occurredAt: -1 });
AuditLogSchema.index({ actorId: 1, occurredAt: -1 });
AuditLogSchema.index({ action: 1, occurredAt: -1 });

module.exports = mongoose.model('AuditLog', AuditLogSchema);
