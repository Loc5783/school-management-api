const mongoose = require('mongoose');
const { sanitizeAuditValue, safeReason, stampActor } = require('../../services/hrAuditSafety');

// Generic security and authorization audit trail. Sensitive values must be
// reduced before being written here (never passwords, tokens, or API keys).
const AuditLogSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actorUsername: { type: String, required: true },
  actorName: { type: String, default: '' }, actorRole: { type: String, default: '' },
  action: {
    type: String,
    enum: [
      'PARENT_STUDENTS_LINKED',
      'USER_STATUS_CHANGED',
      'INTERNAL_ACCOUNT_CREATED',
      'INTERNAL_ACCOUNT_ROLE_CHANGED',
      'INTERNAL_ACCOUNT_UPDATED',
      'INTERNAL_ACCOUNT_DEACTIVATED',
      'EMPLOYEE_RESIGNED',
      'EMPLOYEE_CREATED',
      'EMPLOYEE_UPDATED',
      'CREDENTIAL_REQUIREMENT_UPDATED',
      'CREDENTIAL_POLICY_UPDATED',
      'EMPLOYEE_CREDENTIAL_UPDATED',
      'EMPLOYEE_CREDENTIAL_REVIEWED',
      'HIRING_NEED_CREATED',
      'HIRING_NEED_UPDATED',
      'APPLICANT_CREATED',
      'APPLICANT_UPDATED',
      'APPLICANT_INTERVIEW_UPDATED',
      'APPLICANT_RECOMMENDED',
      'APPLICANT_DECIDED',
      'APPLICANT_ONBOARDING_UPDATED',
      'APPLICANT_LINKED_TO_EMPLOYEE',
      'TRAINING_UPDATED',
      'TRAINING_RESULT_UPDATED',
      'TRAINING_COMPLETED',
      'TRAINING_CANCELLED',
      'STAFF_REVIEW_UPDATED',
      'STAFF_REVIEW_PROFESSIONAL',
      'STAFF_REVIEW_FINALIZED',
      'STAFF_REVIEW_PLAN_COMPLETED',
      'STAFF_HANDOVER_CREATED',
      'STAFF_HANDOVER_UPDATED',
      'STAFF_HANDOVER_ITEM_ACKNOWLEDGED',
      'STAFF_HANDOVER_SCHEDULED',
      'STAFF_HANDOVER_CANCELLED',
      'STAFF_HANDOVER_COMPLETED',
      'INTERNAL_ANNOUNCEMENT_SENT',
      'MONTHLY_TIMESHEET_PUBLISHED',
      'MONTHLY_TIMESHEET_RESPONDED',
      'STAFF_PERSONAL_REQUEST_CREATED',
      'STAFF_PERSONAL_REQUEST_CANCELLED',
      'STAFF_PERSONAL_REQUEST_PROCESSED',
      'EMPLOYEE_LEAVE_APPROVED',
      'EMPLOYEE_LEAVE_REJECTED',
      'EMPLOYEE_LEAVE_CREATED',
      'CLASSROOM_STAFF_ASSIGNED',
      'STAFF_SHIFT_CREATED',
      'STAFF_SHIFT_CANCELLED',
      'STAFF_REPLACEMENT_CREATED',
      'STAFF_REPLACEMENT_CANCELLED',
      'STUDENT_CREATED',
      'STUDENT_UPDATED',
      'STUDENT_STATUS_CHANGED',
      'STUDENT_TRANSFERRED',
      'STUDENT_PROFILE_CHANGE_REQUESTED',
      'STUDENT_PROFILE_CHANGE_APPROVED',
      'STUDENT_PROFILE_CHANGE_REJECTED',
      'FEE_SCHEDULE_IMPORTED',
      'TUITION_INVOICE_IMPORTED',
      'CREATE_EVALUATION_PERIOD',
      'OPEN_EVALUATION_PERIOD',
      'CLOSE_EVALUATION_PERIOD',
      'EVALUATION_PERIOD_CREATED',
      'EVALUATION_PERIOD_OPENED',
      'EVALUATION_PERIOD_CLOSED'
    ],
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
AuditLogSchema.pre('validate', async function () {
  await stampActor(this, this.actorId, this.actorUsername);
  this.before = sanitizeAuditValue(this.before); this.after = sanitizeAuditValue(this.after);
  if (this.reason) this.reason = safeReason(this.reason).slice(0, 500);
});

module.exports = mongoose.model('AuditLog', AuditLogSchema);
