const mongoose = require('mongoose');

const ParentFeedbackSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  studentName: { type: String, required: true, trim: true },
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true, index: true },
  className: { type: String, trim: true, default: '' },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  parentName: { type: String, required: true, trim: true },
  category: { type: String, enum: ['general', 'health', 'tuition', 'service', 'complaint'], default: 'general', index: true },
  subject: { type: String, required: true, trim: true, minlength: 3, maxlength: 160 },
  message: { type: String, required: true, trim: true, minlength: 10, maxlength: 3000 },
  status: { type: String, enum: ['pending', 'in_progress', 'responded', 'closed'], default: 'pending', index: true },
  response: { type: String, trim: true, maxlength: 3000, default: '' },
  respondedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  responderName: { type: String, trim: true, default: '' },
  respondedAt: { type: Date, default: null }
}, { timestamps: true });

ParentFeedbackSchema.index({ parentId: 1, createdAt: -1 });
ParentFeedbackSchema.index({ status: 1, createdAt: -1 });
ParentFeedbackSchema.index({ studentId: 1, createdAt: -1 });
module.exports = mongoose.model('ParentFeedback', ParentFeedbackSchema);
