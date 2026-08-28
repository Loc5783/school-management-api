const mongoose = require('mongoose');

const TimekeepingCorrectionRequestSchema = new mongoose.Schema({
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
  timezone: {
    type: String,
    required: true,
    default: process.env.SCHOOL_TIMEZONE || 'Asia/Ho_Chi_Minh'
  },
  requestedAt: {
    type: Date,
    required: true
  },
  requestedTime: {
    type: String,
    required: true,
    match: /^([01]\d|2[0-3]):[0-5]\d$/
  },
  requestedDayOffset: {
    type: Number,
    enum: [0, 1],
    default: 0
  },
  adjustmentType: {
    type: String,
    enum: ['MISSING_CHECK_IN', 'MISSING_CHECK_OUT'],
    required: true
  },
  // Legacy fields are retained while current frontend clients migrate.
  requestedCheckInTime: {
    type: String,
    match: /^([01]\d|2[0-3]):[0-5]\d$/
  },
  requestType: {
    type: String,
    enum: ['MISSING_CHECK_IN', 'MISSING_CHECK_OUT', 'ATTENDANCE_CORRECTION', 'LATE_JUSTIFICATION', 'DEVICE_FAILURE', 'COMPENSATION'],
    default: 'MISSING_CHECK_IN'
  },
  requestedCheckOutTime: {
    type: String,
    match: /^([01]\d|2[0-3]):[0-5]\d$/
  },
  reason: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  status: {
    type: String,
    enum: ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'REVOKED'],
    default: 'DRAFT'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  version: {
    type: Number,
    default: 1
  },
  submittedAt: Date,
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewedAt: Date,
  reviewNote: {
    type: String,
    trim: true,
    maxlength: 500
  },
  cancelledAt: Date,
  cancelReason: {
    type: String,
    trim: true,
    maxlength: 500
  },
  revokedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  revokedAt: Date,
  revokeReason: {
    type: String,
    trim: true,
    maxlength: 500
  },
  // Legacy review fields retained for existing clients/data.
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: {
    type: Date
  },
  rejectionReason: {
    type: String,
    trim: true,
    maxlength: 500
  },
  syncedAt: {
    type: Date
  },
  attendanceRecordId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AttendanceRecord'
  }
}, { timestamps: true });

TimekeepingCorrectionRequestSchema.index(
  { userId: 1, workDate: 1, adjustmentType: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);
TimekeepingCorrectionRequestSchema.index({ userId: 1, workDate: 1, status: 1 });
TimekeepingCorrectionRequestSchema.index({ status: 1, workDate: 1 });

module.exports = mongoose.model('TimekeepingCorrectionRequest', TimekeepingCorrectionRequestSchema);
