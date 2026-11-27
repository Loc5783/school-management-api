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
  // Danh sách các phân hiệu / cơ sở trực thuộc bên trong cùng một trường (do Admin trường vận hành chi tiết)
  campuses: [{
    code: { type: String, trim: true, uppercase: true },
    name: { type: String, trim: true, required: true },
    address: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    managerName: { type: String, trim: true, default: '' },
    openTime: { type: String, trim: true, default: '07:00' },
    closeTime: { type: String, trim: true, default: '17:00' },
    maxClassrooms: { type: Number, min: 1, max: 200, default: 20 },
    notes: { type: String, trim: true, maxlength: 500, default: '' },
    isActive: { type: Boolean, default: true }
  }],
  // Hạn mức tài nguyên cấp phát cho trường (do SuperAdmin cấu hình)
  quotas: {
    maxCampuses: { type: Number, min: 1, max: 100, default: 10 },
    maxStudents: { type: Number, min: 10, max: 20000, default: 800 },
    maxStaff: { type: Number, min: 5, max: 5000, default: 200 }
  },
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
