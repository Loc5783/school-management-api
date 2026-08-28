const mongoose = require('mongoose');

const AttendanceRecordSchema = new mongoose.Schema({
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
    required: true
  },
  checkInTime: {
    type: Date
  },
  checkOutTime: {
    type: Date
  },
  workday: {
    type: Number,
    default: 1
  },
  status: {
    type: String,
    enum: ['present', 'incomplete'],
    default: 'present'
  },
  source: {
    type: String,
    enum: ['manual', 'correction', 'merged'],
    default: 'manual'
  },
  correctionRequestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TimekeepingCorrectionRequest'
  },
  note: String,
  finalized: {
    type: Boolean,
    default: false
  },
  workingMinutes: {
    type: Number,
    default: 0
  },
  checkInSource: {
    type: String,
    enum: ['biometric', 'correction', 'manual', 'unknown'],
    default: 'unknown'
  },
  checkOutSource: {
    type: String,
    enum: ['biometric', 'correction', 'manual', 'unknown'],
    default: 'unknown'
  },
  timezone: {
    type: String,
    default: process.env.SCHOOL_TIMEZONE || 'Asia/Ho_Chi_Minh'
  },
  calculationVersion: {
    type: Number,
    default: 0
  },
  inputHash: {
    type: String,
    default: ''
  },
  needsRecalculation: {
    type: Boolean,
    default: false
  },
  calculatedAt: Date,
  calculatedBy: {
    type: String,
    enum: ['manual', 'scheduled_job', 'queue_worker', 'admin'],
    default: 'manual'
  }
}, { timestamps: true });

AttendanceRecordSchema.index({ userId: 1, workDate: 1 }, { unique: true });

module.exports = mongoose.model('AttendanceRecord', AttendanceRecordSchema);
