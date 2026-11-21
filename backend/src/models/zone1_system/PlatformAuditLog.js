const mongoose = require('mongoose');

const PlatformAuditLogSchema = new mongoose.Schema({
  actorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PlatformAdmin',
    required: true,
    index: true
  },
  actorUsername: {
    type: String,
    required: true
  },
  action: {
    type: String,
    required: true,
    trim: true
  },
  targetType: {
    type: String,
    default: 'tenant'
  },
  targetId: {
    type: String,
    default: ''
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  occurredAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  autoIndex: false,
  autoCreate: false
});

PlatformAuditLogSchema.index({ actorId: 1, occurredAt: -1 });
PlatformAuditLogSchema.index({ targetType: 1, targetId: 1 });

module.exports = mongoose.model('PlatformAuditLog', PlatformAuditLogSchema);
