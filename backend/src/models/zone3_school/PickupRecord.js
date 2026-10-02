const mongoose = require('mongoose');

// A pickup record is an operational handover log.  The picker details are a
// snapshot so later edits to a student's authorized-picker list cannot alter
// historical records.
const PickupRecordSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  studentName: { type: String, required: true, trim: true },
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true, index: true },
  className: { type: String, required: true, trim: true },
  requesterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  requesterName: { type: String, required: true, trim: true },
  pickupDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
  expectedPickupTime: { type: String, trim: true, match: /^([01]\d|2[0-3]):[0-5]\d$/, default: '' },
  picker: {
    pickerId: { type: mongoose.Schema.Types.ObjectId, required: true },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    relationship: { type: String, trim: true, default: '' },
    identityCardLast4: { type: String, trim: true, maxlength: 4, default: '' }
  },
  note: { type: String, trim: true, maxlength: 500, default: '' },
  status: { type: String, enum: ['scheduled', 'confirmed', 'cancelled'], default: 'scheduled', index: true },
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  confirmedByName: { type: String, trim: true, default: '' },
  confirmedAt: { type: Date, default: null },
  confirmationNote: { type: String, trim: true, maxlength: 500, default: '' },
  cancelledAt: { type: Date, default: null },
  cancellationReason: { type: String, trim: true, maxlength: 500, default: '' }
}, { timestamps: true });

PickupRecordSchema.index({ studentId: 1, pickupDate: 1, status: 1 });
PickupRecordSchema.index({ classroomId: 1, pickupDate: 1, status: 1 });
PickupRecordSchema.index({ requesterId: 1, pickupDate: -1 });

module.exports = mongoose.model('PickupRecord', PickupRecordSchema);
