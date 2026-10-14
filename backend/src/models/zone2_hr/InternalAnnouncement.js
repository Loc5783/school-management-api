const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  category: { type: String, enum: ['shift', 'meeting', 'general', 'directive'], required: true },
  title: { type: String, trim: true, required: true, maxlength: 160 },
  message: { type: String, trim: true, required: true, maxlength: 2000 },
  priority: { type: String, enum: ['normal', 'high', 'urgent'], default: 'normal' },
  targetRoles: [{ type: String, trim: true }],
  eventAt: { type: Date, default: null },
  location: { type: String, trim: true, maxlength: 160, default: '' },
  recipientIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  requestId: { type: String, required: true, trim: true, maxlength: 100, unique: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
schema.index({ createdAt: -1 });
module.exports = mongoose.model('InternalAnnouncement', schema);
