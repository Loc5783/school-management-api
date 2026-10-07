const mongoose = require('mongoose');

const GuardDeviceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  kind: { type: String, required: true, enum: ['camera', 'plate_reader', 'face_reader', 'rfid_reader', 'gate_controller'] },
  location: { type: String, required: true, trim: true, maxlength: 160 },
  snapshotUrl: { type: String, trim: true, maxlength: 1000, default: '' },
  tokenHash: { type: String, required: true, select: false },
  enabled: { type: Boolean, default: true },
  lastSeenAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

module.exports = mongoose.model('GuardDevice', GuardDeviceSchema);
