const mongoose = require('mongoose');

/**
 * Immutable event received from a timekeeping device. A device event is never
 * rewritten; invalidation is represented by isValid/invalidReason only.
 */
const RawAttendanceEventSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: true,
    trim: true
  },
  externalEventId: {
    type: String,
    required: true,
    trim: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  employeeName: {
    type: String,
    required: true
  },
  // Business work date (shift start date), separate from occurredAt so an
  // event at 05:00 can still belong to the previous night's shift.
  workDate: {
    type: Date,
    required: true,
    index: true
  },
  eventType: {
    type: String,
    enum: ['CHECK_IN', 'CHECK_OUT'],
    required: true
  },
  source: {
    type: String,
    enum: ['DEVICE', 'CARD', 'FACE', 'MANUAL_CODE'],
    default: 'DEVICE'
  },
  occurredAt: {
    type: Date,
    required: true
  },
  receivedAt: {
    type: Date,
    default: Date.now
  },
  timezone: {
    type: String,
    required: true,
    default: process.env.SCHOOL_TIMEZONE || 'Asia/Ho_Chi_Minh'
  },
  isValid: {
    type: Boolean,
    default: true
  },
  invalidReason: String,
  rawPayload: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true, collection: 'raw_attendance_events' });

RawAttendanceEventSchema.index({ deviceId: 1, externalEventId: 1 }, { unique: true });
RawAttendanceEventSchema.index({ userId: 1, occurredAt: 1 });
RawAttendanceEventSchema.index({ userId: 1, workDate: 1 });
RawAttendanceEventSchema.index({ occurredAt: 1 });

module.exports = mongoose.model('RawAttendanceEvent', RawAttendanceEventSchema);
