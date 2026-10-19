const mongoose = require('mongoose');
const { sanitizeAuditValue, safeReason, stampActor } = require('../../services/hrAuditSafety');

const PayrollEventSchema = new mongoose.Schema({
  payrollId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payroll', required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actorName: { type: String, required: true, trim: true },
  actorRole: { type: String, default: '' },
  action: { type: String, enum: ['generated', 'adjusted', 'reviewed', 'confirmed', 'paid', 'reopened'], required: true },
  before: mongoose.Schema.Types.Mixed,
  after: mongoose.Schema.Types.Mixed,
  reason: { type: String, trim: true, maxlength: 1000, default: '' }
}, { timestamps: true });

PayrollEventSchema.index({ payrollId: 1, createdAt: -1 });
PayrollEventSchema.pre('validate', async function () {
  await stampActor(this, this.actorId);
  this.before = sanitizeAuditValue(this.before); this.after = sanitizeAuditValue(this.after);
  if (this.reason) this.reason = safeReason(this.reason);
});
module.exports = mongoose.model('PayrollEvent', PayrollEventSchema);
