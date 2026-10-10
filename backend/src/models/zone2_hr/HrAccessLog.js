const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actorUsername: { type: String, required: true }, actorName: { type: String, required: true }, actorRole: { type: String, required: true },
  category: { type: String, required: true }, operation: { type: String, enum: ['read', 'export', 'blocked'], required: true },
  result: { type: String, enum: ['allowed', 'denied', 'unavailable'], required: true },
  method: { type: String, required: true }, route: { type: String, required: true, maxlength: 250 },
  scope: { type: String, enum: ['self', 'management', 'scoped'], required: true },
  targetType: { type: String, required: true }, targetLabel: { type: String, maxlength: 200, default: '' },
  recordIds: [{ type: mongoose.Schema.Types.ObjectId }], filters: { type: mongoose.Schema.Types.Mixed, default: {} },
  statusCode: { type: Number, required: true }, occurredAt: { type: Date, default: Date.now, required: true }
}, { collection: 'hr_access_logs', versionKey: false });
schema.index({ occurredAt: -1, _id: -1 });
schema.index({ actorId: 1, occurredAt: -1 });
schema.index({ category: 1, occurredAt: -1 });
schema.index({ recordIds: 1, occurredAt: -1 });
module.exports = mongoose.model('HrAccessLog', schema);
