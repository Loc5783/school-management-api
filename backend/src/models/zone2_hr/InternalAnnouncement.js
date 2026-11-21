const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant'
  },
  category: { type: String, enum: ['shift', 'meeting', 'general', 'directive'], required: true },
  title: { type: String, trim: true, required: true, maxlength: 160 },
  message: { type: String, trim: true, required: true, maxlength: 2000 },
  priority: { type: String, enum: ['normal', 'high', 'urgent'], default: 'normal' },
  targetRoles: [{ type: String, trim: true }],
  eventAt: { type: Date, default: null },
  location: { type: String, trim: true, maxlength: 160, default: '' },
  recipientIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  requestId: { type: String, required: true, trim: true, maxlength: 100 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

schema.index(
  { tenantId: 1, requestId: 1 },
  {
    name: 'tenantId_1_requestId_1_unique',
    unique: true,
    partialFilterExpression: { tenantId: { $type: 'objectId' } }
  }
);
schema.index(
  { requestId: 1 },
  {
    name: 'legacy_requestId_1_unique',
    unique: true,
    partialFilterExpression: { tenantId: null }
  }
);
schema.index({ tenantId: 1, createdAt: -1 });
schema.index({ createdAt: -1 });

module.exports = mongoose.model('InternalAnnouncement', schema);
