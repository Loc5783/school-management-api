const mongoose = require('mongoose');

const SchoolVisitorSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true, maxlength: 120 },
  phone: { type: String, trim: true, maxlength: 20, default: '' },
  organization: { type: String, trim: true, maxlength: 160, default: '' },
  purpose: { type: String, required: true, trim: true, maxlength: 500 },
  hostName: { type: String, required: true, trim: true, maxlength: 120 },
  allowedArea: { type: String, trim: true, maxlength: 160, default: '' },
  identityLast4: { type: String, trim: true, maxlength: 4, default: '' },
  vehiclePlate: { type: String, trim: true, uppercase: true, maxlength: 20, default: '' },
  badgeNumber: { type: String, trim: true, uppercase: true, maxlength: 30, default: '' },
  visitDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
  checkInAt: { type: Date, required: true, default: Date.now },
  checkOutAt: { type: Date, default: null },
  status: { type: String, enum: ['inside', 'checked_out', 'denied'], default: 'inside', index: true },
  note: { type: String, trim: true, maxlength: 500, default: '' },
  clientEventId: { type: String, trim: true, maxlength: 100 },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recordedByName: { type: String, required: true, trim: true },
  checkedOutBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  checkedOutByName: { type: String, trim: true, default: '' }
}, { timestamps: true });

SchoolVisitorSchema.index({ visitDate: 1, status: 1, checkInAt: -1 });
SchoolVisitorSchema.index({ clientEventId: 1 }, { unique: true, sparse: true });
module.exports = mongoose.model('SchoolVisitor', SchoolVisitorSchema);
