'use strict';

const mongoose = require('mongoose');

const DeviceSyncLogSchema = new mongoose.Schema({
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
  startedAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  completedAt: {
    type: Date
  },
  status: {
    type: String,
    enum: ['SUCCESS', 'PARTIAL', 'FAILED', 'IN_PROGRESS'],
    default: 'IN_PROGRESS'
  },
  eventsFetched: {
    type: Number,
    default: 0
  },
  eventsIngested: {
    type: Number,
    default: 0
  },
  eventsDuplicate: {
    type: Number,
    default: 0
  },
  eventsUnmapped: {
    type: Number,
    default: 0
  },
  eventsFailed: {
    type: Number,
    default: 0
  },
  errorMessage: {
    type: String,
    trim: true
  },
  syncCursor: {
    type: String,
    trim: true
  },
  triggeredBy: {
    type: String,
    enum: ['MANUAL', 'SCHEDULED', 'TEST'],
    default: 'MANUAL'
  },
  actorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  collection: 'device_sync_logs'
});

DeviceSyncLogSchema.index({ tenantId: 1, deviceId: 1, startedAt: -1 });

module.exports = mongoose.model('DeviceSyncLog', DeviceSyncLogSchema);
