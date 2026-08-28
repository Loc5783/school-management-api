const mongoose = require('mongoose');

const OutboxEventSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  status: {
    type: String,
    enum: ['PENDING', 'PUBLISHED', 'FAILED'],
    default: 'PENDING'
  },
  attempts: {
    type: Number,
    default: 0
  },
  publishedAt: Date,
  lastError: String
}, { timestamps: true, collection: 'outbox_events' });

OutboxEventSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('OutboxEvent', OutboxEventSchema);
