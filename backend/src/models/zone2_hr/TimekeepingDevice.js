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
  // Phân hiệu / Cơ sở lắp đặt thiết bị trong trường ('ALL' nếu là cổng dùng chung toàn trường)
  campus: {
    type: String,
    trim: true,
    maxlength: 120,
    default: 'Cơ sở chính'
  },
  // Vị trí vật lý chi tiết tại phân hiệu (VD: Sảnh đón trẻ Tầng 1, Cổng phụ Khu B)
  location: {
    type: String,
    trim: true,
    maxlength: 160,
    default: 'Sảnh đón trẻ'
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
  macAddress: {
    type: String,
    trim: true,
    default: ''
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
  // Giao thức truyền tải HTTP hoặc HTTPS khi kết nối ISAPI LAN (mặc định https để giữ tương thích ngược với bộ test cũ)
  transportScheme: {
    type: String,
    enum: ['http', 'https'],
    default: 'https'
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
  // ─── QUẢN LÝ DUNG LƯỢNG BỘ NHỚ 500 SLOT / MÁY & PHÂN BỔ THEO PHÂN HIỆU ───
  maxUserCapacity: {
    type: Number,
    min: 10,
    max: 50000,
    default: 500
  },
  currentStoredUsers: {
    type: Number,
    default: 0
  },
  currentStoredFaces: {
    type: Number,
    default: 0
  },
  syncAllocationMode: {
    type: String,
    enum: ['BY_CAMPUS_PRIORITY', 'TODAY_ATTENDANCE_FIRST', 'ALL_ACTIVE'],
    default: 'BY_CAMPUS_PRIORITY'
  },
  syncTargetScope: {
    type: String,
    enum: ['ALL', 'EMPLOYEE_ONLY', 'STUDENT_ONLY'],
    default: 'ALL'
  },
  autoSyncOnChange: {
    type: Boolean,
    default: true
  },
  lastSyncSummary: {
    totalTargets: { type: Number, default: 0 },
    syncedUsers: { type: Number, default: 0 },
    syncedFaces: { type: Number, default: 0 },
    syncedStaffCount: { type: Number, default: 0 },
    syncedStudentCount: { type: Number, default: 0 },
    prunedInactiveCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    message: { type: String, default: '' },
    syncedAt: { type: Date, default: null }
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
  credentialKey: {
    type: String,
    trim: true
  },
  // Tên tài khoản quản trị máy (hiển thị gợi ý không nhạy cảm, mặc định 'admin')
  authUsernameHint: {
    type: String,
    trim: true,
    default: 'admin'
  },
  // Thông tin xác thực ISAPI được mã hóa AES-256-GCM gắn AAD theo tenantId (tuyệt đối không lộ ra JSON/API)
  encryptedAuth: {
    iv: { type: String, default: '' },
    tag: { type: String, default: '' },
    cipherText: { type: String, default: '' }
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
      delete ret.encryptedAuth;
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
TimekeepingDeviceSchema.index({ tenantId: 1, campus: 1 });
TimekeepingDeviceSchema.index({ tenantId: 1, host: 1 });

module.exports = mongoose.model('TimekeepingDevice', TimekeepingDeviceSchema);
