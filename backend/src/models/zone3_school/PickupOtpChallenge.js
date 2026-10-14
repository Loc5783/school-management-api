const mongoose = require('mongoose');

const PickupOtpChallengeSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  studentName: { type: String, required: true, trim: true },
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true },
  className: { type: String, trim: true, default: '' },
  pickupDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
  picker: {
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    relationship: { type: String, trim: true, maxlength: 80, default: '' },
    identityCardLast4: { type: String, trim: true, maxlength: 4, default: '' },
    photoURL: { type: String, trim: true, maxlength: 1000, default: '' },
    vehicleType: { type: String, trim: true, maxlength: 80, default: '' },
    vehiclePlate: { type: String, trim: true, uppercase: true, maxlength: 20, default: '' }
  },
  codeHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, min: 0, default: 0 },
  status: { type: String, enum: ['pending', 'verified', 'expired', 'cancelled'], default: 'pending', index: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  requestedByName: { type: String, required: true, trim: true },
  verifiedAt: { type: Date, default: null },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  pickupRecordId: { type: mongoose.Schema.Types.ObjectId, ref: 'PickupRecord', default: null }
}, { timestamps: true });

PickupOtpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });
PickupOtpChallengeSchema.index({ studentId: 1, pickupDate: 1, status: 1 });

module.exports = mongoose.model('PickupOtpChallenge', PickupOtpChallengeSchema);
