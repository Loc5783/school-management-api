const mongoose = require('mongoose');

const TenantSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true
  },
  status: {
    type: String,
    enum: ['onboarding', 'active', 'suspended', 'terminated'],
    default: 'active'
  },
  authVersion: {
    type: Number,
    default: 0
  },
  enabledModules: {
    type: [String],
    default: ['students', 'classrooms']
  },
  contactEmail: {
    type: String,
    trim: true,
    lowercase: true,
    default: ''
  },
  // Mã hệ thống/cụm trường (ví dụ: 'HOANANG') để nhóm nhiều trường hoặc phân hiệu độc lập
  organizationCode: {
    type: String,
    trim: true,
    uppercase: true,
    default: ''
  },
  // Liên kết tới trường chính nếu Tenant này là một phân hiệu tách riêng mã đăng nhập
  parentTenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    default: null
  },
  // Danh sách các phân hiệu / cơ sở trực thuộc bên trong cùng một trường
  campuses: [{
    code: { type: String, trim: true, uppercase: true },
    name: { type: String, trim: true, required: true },
    address: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true }
  }],
  config: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  autoIndex: false,
  autoCreate: false
});

TenantSchema.index({ status: 1 });
TenantSchema.index({ organizationCode: 1 });
TenantSchema.index({ parentTenantId: 1 });

module.exports = mongoose.model('Tenant', TenantSchema);
