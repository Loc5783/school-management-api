const mongoose = require('mongoose');

const AttendanceAuditLogSchema = new mongoose.Schema({
  actor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  action: {
    type: String,
    enum: [
      'CORRECTION_CREATED',
      'CORRECTION_APPROVED',
      'CORRECTION_REJECTED',
      'ADJUSTMENT_DRAFT_CREATED',
      'ADJUSTMENT_UPDATED',
      'ADJUSTMENT_SUBMITTED',
      'ADJUSTMENT_CANCELLED',
      'ADJUSTMENT_REVOKED',
      'RAW_ATTENDANCE_INGESTED',
      'RECALCULATION_QUEUED',
      'TIMEKEEPING_MIGRATED',
      'ATTENDANCE_RECALCULATED',
      'MIDNIGHT_SYNC_STARTED',
      'MIDNIGHT_SYNC_COMPLETED',
      'ATTENDANCE_FINALIZED',
      'ATTENDANCE_REOPENED'
    ],
    required: true
  },
  entity: {
    type: String,
    required: true
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    // KHÔNG required nữa, cho phép null
    required: false
  },
  oldValue: mongoose.Schema.Types.Mixed,
  newValue: mongoose.Schema.Types.Mixed,
  reason: String,
  requestId: String,
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

AttendanceAuditLogSchema.index({ entityId: 1 });
AttendanceAuditLogSchema.index({ actor: 1 });
AttendanceAuditLogSchema.index({ timestamp: -1 });

module.exports = mongoose.model('AttendanceAuditLog', AttendanceAuditLogSchema);
