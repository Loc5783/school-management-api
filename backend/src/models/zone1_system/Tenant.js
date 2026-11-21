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

module.exports = mongoose.model('Tenant', TenantSchema);
