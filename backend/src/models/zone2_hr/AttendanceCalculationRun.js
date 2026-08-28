const mongoose = require('mongoose');

const AttendanceCalculationRunSchema = new mongoose.Schema({
  jobType: {
    type: String,
    enum: ['DAILY', 'MANUAL', 'QUEUE'],
    required: true
  },
  workDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['RUNNING', 'COMPLETED', 'FAILED'],
    default: 'RUNNING'
  },
  workerId: String,
  recordsProcessed: {
    type: Number,
    default: 0
  },
  error: String,
  startedAt: {
    type: Date,
    default: Date.now
  },
  finishedAt: Date
}, { timestamps: true, collection: 'attendance_calculation_runs' });

AttendanceCalculationRunSchema.index({ jobType: 1, workDate: 1, startedAt: -1 });

module.exports = mongoose.model('AttendanceCalculationRun', AttendanceCalculationRunSchema);
