const mongoose = require('mongoose');

const StudentTransferHistorySchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  studentCode: { type: String, required: true, trim: true },
  studentName: { type: String, required: true, trim: true },
  fromClassroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true, index: true },
  fromClassName: { type: String, required: true, trim: true },
  toClassroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true, index: true },
  toClassName: { type: String, required: true, trim: true },
  schoolYear: { type: String, required: true, trim: true },
  reason: { type: String, required: true, trim: true, maxlength: 1000 },
  effectiveDate: { type: Date, default: Date.now },
  transferredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  transferredByName: { type: String, required: true, trim: true }
}, {
  timestamps: true
});

StudentTransferHistorySchema.index({ studentId: 1, createdAt: -1 });
StudentTransferHistorySchema.index({ fromClassroomId: 1, createdAt: -1 });
StudentTransferHistorySchema.index({ toClassroomId: 1, createdAt: -1 });

module.exports = mongoose.model('StudentTransferHistory', StudentTransferHistorySchema);
