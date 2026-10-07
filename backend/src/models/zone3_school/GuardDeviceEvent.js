const mongoose = require('mongoose');

const GuardDeviceEventSchema = new mongoose.Schema({
  deviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'GuardDevice', required: true, index: true },
  externalEventId: { type: String, required: true, trim: true, maxlength: 120 },
  eventType: { type: String, required: true, enum: ['plate', 'face', 'card', 'behavior', 'gate_state'] },
  identifier: { type: String, trim: true, maxlength: 120, default: '' },
  confidence: { type: Number, min: 0, max: 1, default: null },
  snapshotUrl: { type: String, trim: true, maxlength: 1000, default: '' },
  description: { type: String, trim: true, maxlength: 500, default: '' },
  occurredAt: { type: Date, required: true },
  receivedAt: { type: Date, default: Date.now },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null },
  pickupRecordId: { type: mongoose.Schema.Types.ObjectId, ref: 'PickupRecord', default: null },
  matchLabel: { type: String, trim: true, maxlength: 160, default: '' },
  status: { type: String, enum: ['matched', 'review', 'alert', 'dismissed'], default: 'review', index: true },
  reason: { type: String, trim: true, maxlength: 500, default: '' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  reviewNote: { type: String, trim: true, maxlength: 500, default: '' }
}, { timestamps: true });

GuardDeviceEventSchema.index({ deviceId: 1, externalEventId: 1 }, { unique: true });
GuardDeviceEventSchema.index({ occurredAt: -1, status: 1 });
module.exports = mongoose.model('GuardDeviceEvent', GuardDeviceEventSchema);
