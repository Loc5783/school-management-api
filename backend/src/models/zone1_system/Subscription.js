const mongoose = require('mongoose');

const SubscriptionSchema = new mongoose.Schema({
  targetTenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  planCode: {
    type: String,
    default: 'standard',
    trim: true
  },
  status: {
    type: String,
    enum: ['trial', 'active', 'expired', 'cancelled'],
    default: 'active'
  },
  expiresAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true,
  autoIndex: false,
  autoCreate: false
});

SubscriptionSchema.index({ targetTenantId: 1, status: 1 });

module.exports = mongoose.model('Subscription', SubscriptionSchema);
