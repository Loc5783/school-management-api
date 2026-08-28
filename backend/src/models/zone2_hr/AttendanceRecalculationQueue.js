const mongoose = require('mongoose');

const AttendanceRecalculationQueueSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  workDate: {
    type: Date,
    required: true
  },
  reasons: {
    type: [String],
    default: []
  },
  status: {
    type: String,
    enum: ['PENDING', 'PROCESSING', 'DONE', 'FAILED'],
    default: 'PENDING'
  },
  attempts: {
    type: Number,
    default: 0
  },
  nextAttemptAt: {
    type: Date,
    default: Date.now
  },
  lockedBy: String,
  lockedUntil: Date,
  lastError: String,
  completedAt: Date
}, { timestamps: true, collection: 'attendance_recalculation_queue' });

AttendanceRecalculationQueueSchema.index({ userId: 1, workDate: 1 }, { unique: true });
AttendanceRecalculationQueueSchema.index({ status: 1, nextAttemptAt: 1, lockedUntil: 1 });

module.exports = mongoose.model('AttendanceRecalculationQueue', AttendanceRecalculationQueueSchema);
