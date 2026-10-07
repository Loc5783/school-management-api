const mongoose = require('mongoose');

const GuardShiftHandoverSchema = new mongoose.Schema({
  handoverDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
  shiftName: { type: String, enum: ['morning', 'afternoon', 'evening'], required: true },
  receiverName: { type: String, required: true, trim: true, maxlength: 120 },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  status: { type: String, enum: ['pending', 'accepted'], default: 'pending' },
  acceptedAt: { type: Date, default: null },
  acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  acceptanceNote: { type: String, trim: true, maxlength: 500, default: '' },
  childrenRemaining: { type: Number, min: 0, default: 0 },
  visitorsRemaining: { type: Number, min: 0, default: 0 },
  openIncidents: { type: Number, min: 0, default: 0 },
  childrenSnapshot: { type: [{ studentId: mongoose.Schema.Types.ObjectId, studentName: String, className: String }], default: [] },
  visitorsSnapshot: { type: [{ visitorId: mongoose.Schema.Types.ObjectId, fullName: String, hostName: String }], default: [] },
  incidentsSnapshot: { type: [{ incidentId: mongoose.Schema.Types.ObjectId, location: String, description: String, status: String }], default: [] },
  keysAndEquipment: { type: String, trim: true, maxlength: 1000, default: '' },
  notes: { type: String, trim: true, maxlength: 2000, default: '' },
  handedOverBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  handedOverByName: { type: String, required: true, trim: true },
  handedOverAt: { type: Date, default: Date.now, required: true }
}, { timestamps: true });

GuardShiftHandoverSchema.index({ handoverDate: 1, handedOverAt: -1 });
GuardShiftHandoverSchema.index({ receiverId: 1, status: 1, handedOverAt: -1 });
module.exports = mongoose.model('GuardShiftHandover', GuardShiftHandoverSchema);
