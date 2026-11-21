'use strict';

const mongoose = require('mongoose');

const TimekeepingDeviceSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  deviceCode: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  vendor: {
    type: String,
    enum: ['HIKVISION', 'GENERIC'],
    default: 'HIKVISION'
  },
  model: {
    type: String,
    trim: true,
    default: 'DS-K1T320MX'
  },
  serialNumber: {
    type: String,
    trim: true
  },
  host: {
    type: String,
    required: true,
    trim: true
  },
  httpPort: {
    type: Number,
    default: 80
  },
  httpsPort: {
    type: Number,
    default: 443
  },
  sdkPort: {
    type: Number,
    default: 8000
  },
  protocol: {
    type: String,
    enum: ['ISAPI', 'PUSH_API'],
    default: 'ISAPI'
  },
  timezone: {
    type: String,
    default: process.env.SCHOOL_TIMEZONE || 'Asia/Ho_Chi_Minh'
  },
  enabled: {
    type: Boolean,
    default: true
  },
  status: {
    type: String,
    enum: ['ONLINE', 'OFFLINE', 'AUTH_FAILED', 'ERROR', 'UNVERIFIED'],
    default: 'UNVERIFIED'
  },
  statusMessage: {
    type: String,
    trim: true
  },
  lastSeenAt: {
    type: Date
  },
  lastSyncStartedAt: {
    type: Date
  },
  lastSyncCompletedAt: {
    type: Date
  },
  lastSuccessfulEventAt: {
    type: Date
  },
  syncCursor: {
    type: String,
    trim: true
  },
  // Key name in environment variables, e.g. "HIKVISION_HOANANG_A"
  // Credentials are NEVER stored directly in MongoDB document.
  credentialKey: {
    type: String,
    trim: true
  },
  // Hash of API key if the device pushes data directly to our webhook
  apiKeyHash: {
    type: String,
    trim: true
  },
  // Multi-process distributed single-flight lease
  syncLease: {
    lockedBy: { type: String, default: null },
    lockedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null }
  },
  allowSelfSigned: {
    type: Boolean,
    default: true
  },
  timeoutMs: {
    type: Number,
    default: 5000
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  collection: 'timekeeping_devices',
  toJSON: {
    transform: function(doc, ret) {
      delete ret.apiKeyHash;
      delete ret.credentialKey;
      delete ret.syncLease;
      return ret;
    }
  }
});

// Tenant-scoped unique device code
TimekeepingDeviceSchema.index({ tenantId: 1, deviceCode: 1 }, {
  unique: true
});

// Tenant-scoped unique serialNumber index when present and non-empty
TimekeepingDeviceSchema.index({ tenantId: 1, serialNumber: 1 }, {
  unique: true,
  partialFilterExpression: { serialNumber: { $type: 'string', $gt: '' } }
});

// System-wide unique apiKeyHash when present
TimekeepingDeviceSchema.index({ apiKeyHash: 1 }, {
  unique: true,
  partialFilterExpression: { apiKeyHash: { $type: 'string', $gt: '' } }
});

TimekeepingDeviceSchema.index({ tenantId: 1, enabled: 1 });
TimekeepingDeviceSchema.index({ tenantId: 1, host: 1 });

module.exports = mongoose.model('TimekeepingDevice', TimekeepingDeviceSchema);
