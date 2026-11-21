const mongoose = require('mongoose');

const ImportIdempotencySchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant'
  },
  idempotencyKey: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true
  },
  fingerprint: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['processing', 'completed', 'failed'],
    default: 'processing',
    index: true
  },
  lockToken: {
    type: String,
    trim: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  effectiveDate: {
    type: String,
    trim: true
  },
  classroomId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Classroom'
  },
  response: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 86400 // Tự động xóa sau 24 giờ
  }
}, {
  timestamps: true
});

// Index hỗ trợ multi-tenant lookup (SaaS 1C)
ImportIdempotencySchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model('ImportIdempotency', ImportIdempotencySchema);
