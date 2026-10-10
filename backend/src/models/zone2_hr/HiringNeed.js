const mongoose = require('mongoose');
const shiftSchema = new mongoose.Schema({ name: String, startTime: String, endTime: String, weekdays: [Number] }, { _id: false });
const schema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 140 },
  position: { type: String, enum: ['principal', 'vice_principal', 'teacher', 'head_teacher', 'assistant_teacher', 'accountant', 'chef', 'security', 'hr'], required: true },
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', default: null },
  classroomName: { type: String, default: '' },
  shift: { type: shiftSchema, default: null },
  headcount: { type: Number, required: true, min: 1, max: 20 },
  approvedCount: { type: Number, default: 0, min: 0 },
  targetStartDate: { type: String, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 1000 },
  status: { type: String, enum: ['open', 'filled', 'closed'], default: 'open' },
  closedReason: { type: String, trim: true, maxlength: 500, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ status: 1, targetStartDate: 1 });
schema.index({ classroomId: 1, status: 1 });
module.exports = mongoose.model('HiringNeed', schema);
