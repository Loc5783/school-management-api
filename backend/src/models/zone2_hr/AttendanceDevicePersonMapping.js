'use strict';

const mongoose = require('mongoose');

const AttendanceDevicePersonMappingSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  deviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TimekeepingDevice',
    required: true,
    index: true
  },
  externalPersonId: {
    type: String,
    required: true,
    trim: true
  },
  subjectType: {
    type: String,
    enum: ['EMPLOYEE', 'STUDENT'],
    required: true
  },
  subjectId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student'
  },
  active: {
    type: Boolean,
    default: true
  },
  lastMatchedAt: {
    type: Date
  },
  // Minimum metadata, strictly NO biometric templates or facial photos
  metadata: {
    displayName: {
      type: String,
      trim: true
    },
    note: {
      type: String,
      trim: true
    }
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  collection: 'attendance_device_person_mappings'
});

// Compound unique: one external person ID maps to one subject on this device in this tenant
AttendanceDevicePersonMappingSchema.index(
  { tenantId: 1, deviceId: 1, externalPersonId: 1 },
  { unique: true }
);

// Prevent contradictory mappings: one subject cannot be mapped twice on the same device
AttendanceDevicePersonMappingSchema.index(
  { tenantId: 1, deviceId: 1, subjectType: 1, subjectId: 1 },
  { unique: true }
);

AttendanceDevicePersonMappingSchema.index({ tenantId: 1, subjectType: 1, subjectId: 1 });

module.exports = mongoose.model('AttendanceDevicePersonMapping', AttendanceDevicePersonMappingSchema);
