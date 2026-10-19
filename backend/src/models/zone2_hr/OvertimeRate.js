const mongoose = require('mongoose');

const OvertimeRateSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  month: { type: Number, required: true, min: 1, max: 12 },
  year: { type: Number, required: true, min: 2000, max: 2100 },
  hourlyAmount: { type: Number, required: true, min: 0 },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

OvertimeRateSchema.index({ employeeId: 1, month: 1, year: 1 }, { unique: true });
module.exports = mongoose.model('OvertimeRate', OvertimeRateSchema);
