'use strict';

const mongoose = require('mongoose');

/**
 * Immutable event received from a timekeeping device. A device event is never
 * rewritten; invalidation is represented by isValid/invalidReason only.
 */
const RawAttendanceEventSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    index: true
  },
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
  externalPersonId: {
    type: String,
    trim: true
  },
  mappingStatus: {
    type: String,
    enum: ['MAPPED', 'UNMAPPED', 'IGNORED'],
    default: 'MAPPED',
    index: true
  },
  subjectType: {
    type: String,
    enum: ['EMPLOYEE', 'STUDENT', 'UNKNOWN'],
    default: 'EMPLOYEE'
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student'
  },
  employeeName: {
    type: String,
    default: ''
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
    enum: ['CHECK_IN', 'CHECK_OUT', 'PUNCH'],
    required: true
  },
  source: {
    type: String,
    enum: ['DEVICE', 'CARD', 'FACE', 'MANUAL_CODE'],
    default: 'DEVICE'
  },
  authenticationMethod: {
    type: String,
    enum: ['FACE', 'CARD', 'PIN', 'MANUAL_CODE', 'UNKNOWN'],
    default: 'UNKNOWN'
  },
  vendorEventCode: {
    type: String,
    trim: true
  },
  syncBatchId: {
    type: String,
    trim: true
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

// Multi-tenant unique index: prevents duplicate event within the same tenant
RawAttendanceEventSchema.index(
  { tenantId: 1, deviceId: 1, externalEventId: 1 },
  { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } }
);

// Legacy backward compatibility unique index: tenantId is null
RawAttendanceEventSchema.index(
  { deviceId: 1, externalEventId: 1 },
  { unique: true, partialFilterExpression: { tenantId: null } }
);

RawAttendanceEventSchema.index({ tenantId: 1, userId: 1, occurredAt: 1 });
RawAttendanceEventSchema.index({ tenantId: 1, userId: 1, workDate: 1 });
RawAttendanceEventSchema.index({ tenantId: 1, studentId: 1, workDate: 1 });
RawAttendanceEventSchema.index({ userId: 1, occurredAt: 1 });
RawAttendanceEventSchema.index({ userId: 1, workDate: 1 });
RawAttendanceEventSchema.index({ occurredAt: 1 });

module.exports = mongoose.model('RawAttendanceEvent', RawAttendanceEventSchema);
