const mongoose = require('mongoose');

const daySchema = new mongoose.Schema({
  workDate: { type: String, required: true },
  checkInTime: Date,
  checkOutTime: Date,
  workday: { type: Number, required: true },
  status: { type: String, enum: ['present', 'incomplete'], required: true }
}, { _id: false });

const schema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  period: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  days: [daySchema],
  totalWorkdays: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['pending', 'confirmed', 'disputed'], default: 'pending' },
  employeeNote: { type: String, trim: true, maxlength: 1000, default: '' },
  publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  publishedAt: { type: Date, required: true, default: Date.now },
  respondedAt: Date,
  revision: { type: Number, default: 1 }
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ employeeId: 1, period: 1 }, { unique: true });
schema.index({ userId: 1, period: -1 });
module.exports = mongoose.model('MonthlyTimesheet', schema);
