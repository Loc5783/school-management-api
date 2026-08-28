const mongoose = require('mongoose');

const AttendanceJobLockSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true
  },
  ownerId: {
    type: String,
    required: true
  },
  lockedUntil: {
    type: Date,
    required: true
  }
}, { timestamps: true, collection: 'attendance_job_locks' });

AttendanceJobLockSchema.index({ lockedUntil: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AttendanceJobLock', AttendanceJobLockSchema);
