const mongoose = require('mongoose');

const RawAttendanceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  employeeName: {
    type: String,
    required: true
  },
  workDate: {
    type: Date,
    required: true,
    index: true
  },
  checkInTime: Date,
  checkOutTime: Date,
  source: {
    type: String,
    enum: ['biometric', 'card', 'face', 'manual'],
    default: 'biometric'
  },
  rawData: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true });

// Đảm bảo mỗi người mỗi ngày chỉ có 1 bản ghi raw
RawAttendanceSchema.index({ userId: 1, workDate: 1 }, { unique: true });

module.exports = mongoose.model('RawAttendance', RawAttendanceSchema);