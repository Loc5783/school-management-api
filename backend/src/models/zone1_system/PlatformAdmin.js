const mongoose = require('mongoose');

const PlatformAdminSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  passwordHash: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['platform_lead', 'platform_support'],
    default: 'platform_support'
  },
  totpSecret: {
    type: String,
    required: true
  },
  totpSecretIv: {
    type: String,
    default: ''
  },
  totpSecretTag: {
    type: String,
    default: ''
  },
  authVersion: {
    type: Number,
    default: 0
  },
  lastUsedTotpStep: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'locked'],
    default: 'active'
  }
}, {
  timestamps: true,
  autoIndex: false,
  autoCreate: false
});

PlatformAdminSchema.methods.toSafeObject = function() {
  return {
    _id: this._id,
    username: this.username,
    role: this.role,
    authVersion: this.authVersion,
    status: this.status,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

module.exports = mongoose.model('PlatformAdmin', PlatformAdminSchema);
