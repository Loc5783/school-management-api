const mongoose = require('mongoose');

const StudentGateEventSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  studentName: { type: String, required: true, trim: true },
  studentCode: { type: String, required: true, trim: true },
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true, index: true },
  className: { type: String, trim: true, default: '' },
  gateDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
  direction: { type: String, enum: ['arrival', 'departure'], required: true, index: true },
  occurredAt: { type: Date, required: true, default: Date.now },
  method: { type: String, enum: ['manual', 'card', 'qr', 'pickup', 'offline'], default: 'manual' },
  note: { type: String, trim: true, maxlength: 500, default: '' },
  clientEventId: { type: String, trim: true, maxlength: 100 },
  payloadFingerprint: { type: String, trim: true, maxlength: 64 },
  pickupRecordId: { type: mongoose.Schema.Types.ObjectId, ref: 'PickupRecord', default: null },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recordedByName: { type: String, required: true, trim: true }
}, { timestamps: true });

StudentGateEventSchema.index({ studentId: 1, gateDate: 1, direction: 1 }, { unique: true });
StudentGateEventSchema.index({ gateDate: 1, occurredAt: -1 });
// Multi-tenant clientEventId unique index
StudentGateEventSchema.index({ tenantId: 1, clientEventId: 1 }, {
  unique: true,
  sparse: true,
  partialFilterExpression: { tenantId: { $type: 'objectId' } }
});
// Legacy unique index
StudentGateEventSchema.index({ clientEventId: 1 }, {
  unique: true,
  sparse: true,
  partialFilterExpression: { tenantId: null }
});

StudentGateEventSchema.index({ tenantId: 1, studentId: 1, gateDate: 1, direction: 1 });

module.exports = mongoose.model('StudentGateEvent', StudentGateEventSchema);
