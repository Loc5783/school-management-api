const mongoose = require('mongoose');

const StaffShiftSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  role: { type: String, enum: ['chef', 'guard'], required: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  weekdays: [{ type: Number, min: 0, max: 6 }],
  validFrom: { type: String, required: true },
  validUntil: { type: String, required: true },
  status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  cancelledAt: Date
}, { timestamps: true });

StaffShiftSchema.index({ employeeId: 1, status: 1, validFrom: 1, validUntil: 1 });
module.exports = mongoose.model('StaffShift', StaffShiftSchema);
