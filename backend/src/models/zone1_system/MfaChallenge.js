const mongoose = require('mongoose');

const MfaChallengeSchema = new mongoose.Schema({
  jti: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PlatformAdmin',
    required: true,
    index: true
  },
  authVersion: {
    type: Number,
    required: true,
    default: 0
  },
  used: {
    type: Boolean,
    required: true,
    default: false
  },
  failedAttempts: {
    type: Number,
    required: true,
    default: 0
  },
  usedAt: {
    type: Date,
    default: null
  },
  expiresAt: {
    type: Date,
    required: true
  }
}, {
  timestamps: true,
  autoIndex: false,
  autoCreate: false
});

// TTL index to automatically remove expired challenges
MfaChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('MfaChallenge', MfaChallengeSchema);
