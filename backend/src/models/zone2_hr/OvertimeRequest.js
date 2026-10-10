const mongoose = require('mongoose');

const OvertimeRequestSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  workDate: { type: String, required: true },
  requestedMinutes: { type: Number, required: true, min: 1, max: 720 },
  approvedMinutes: { type: Number, min: 0, max: 720, default: 0 },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: Date,
  reviewNote: { type: String, trim: true, maxlength: 500 }
}, { timestamps: true });

OvertimeRequestSchema.index({ employeeId: 1, workDate: 1 }, { unique: true });
OvertimeRequestSchema.index({ status: 1, createdAt: -1 });
module.exports = mongoose.model('OvertimeRequest', OvertimeRequestSchema);
