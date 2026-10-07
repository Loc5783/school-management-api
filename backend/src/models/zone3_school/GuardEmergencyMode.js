const mongoose = require('mongoose');

const GuardEmergencyModeSchema = new mongoose.Schema({
  activeKey: { type: String, default: 'GLOBAL', immutable: true },
  level: { type: String, enum: ['security', 'fire', 'medical', 'evacuation', 'lockdown'], required: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  instructions: { type: String, required: true, trim: true, maxlength: 2000 },
  status: { type: String, enum: ['active', 'resolved'], default: 'active', index: true },
  activatedAt: { type: Date, required: true, default: Date.now },
  activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  activatedByName: { type: String, required: true, trim: true },
  resolvedAt: { type: Date, default: null },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedByName: { type: String, trim: true, default: '' },
  resolutionNote: { type: String, trim: true, maxlength: 1000, default: '' }
}, { timestamps: true });

GuardEmergencyModeSchema.index({ status: 1, activatedAt: -1 });
GuardEmergencyModeSchema.index({ activeKey: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });

module.exports = mongoose.model('GuardEmergencyMode', GuardEmergencyModeSchema);
