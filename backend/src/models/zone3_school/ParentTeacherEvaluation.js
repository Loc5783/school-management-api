const mongoose = require('mongoose');

const ParentTeacherEvaluationSchema = new mongoose.Schema({
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  parentName: { type: String, required: true, trim: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  studentName: { type: String, required: true, trim: true },
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true, index: true },
  className: { type: String, required: true, trim: true },
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  teacherName: { type: String, required: true, trim: true },
  schoolYear: { type: String, required: true, trim: true },
  period: { type: String, required: true, trim: true }, // e.g. "2025-2026-HK1", "2025-2026-HK2", "2026-10"
  criteria: {
    care: { type: Number, min: 1, max: 5, required: true }, // Tận tình & chăm sóc học sinh
    teaching: { type: Number, min: 1, max: 5, required: true }, // Hoạt động & phương pháp dạy trẻ
    communication: { type: Number, min: 1, max: 5, required: true } // Trao đổi & tương tác với phụ huynh
  },
  overallRating: { type: Number, min: 1, max: 5, required: true },
  feedback: { type: String, trim: true, maxlength: 2000, default: '' }
}, {
  timestamps: true
});

// Prevent duplicate evaluation by the same parent for the same student, teacher, and period
ParentTeacherEvaluationSchema.index(
  { studentId: 1, teacherId: 1, period: 1 },
  { unique: true }
);

ParentTeacherEvaluationSchema.index({ teacherId: 1, schoolYear: 1, createdAt: -1 });
ParentTeacherEvaluationSchema.index({ classroomId: 1, period: 1 });

module.exports = mongoose.model('ParentTeacherEvaluation', ParentTeacherEvaluationSchema);
