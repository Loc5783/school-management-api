const mongoose = require('mongoose');

const StudentProfileChangeRequestSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  studentName: { type: String, required: true, trim: true },
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true, index: true },
  className: { type: String, trim: true, default: '' },
  requesterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  requesterName: { type: String, required: true, trim: true },
  changes: { type: mongoose.Schema.Types.Mixed, required: true },
  baseUpdatedAt: { type: Date, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewerName: { type: String, trim: true, default: '' },
  reviewNote: { type: String, trim: true, maxlength: 500, default: '' },
  reviewedAt: { type: Date, default: null }
}, { timestamps: true });

StudentProfileChangeRequestSchema.index({ studentId: 1, status: 1, createdAt: -1 });
StudentProfileChangeRequestSchema.index({ requesterId: 1, createdAt: -1 });
StudentProfileChangeRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('StudentProfileChangeRequest', StudentProfileChangeRequestSchema);
