const mongoose = require('mongoose');

const StaffReplacementSchema = new mongoose.Schema({
  date: { type: String, required: true },
  kind: { type: String, enum: ['classroom', 'shift'], required: true },
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', default: null },
  shiftId: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffShift', default: null },
  absentEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  replacementEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  note: { type: String, trim: true, maxlength: 500, default: '' },
  status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  cancelledAt: Date
}, { timestamps: true });

StaffReplacementSchema.index({ date: 1, kind: 1, classroomId: 1, shiftId: 1, absentEmployeeId: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
StaffReplacementSchema.index({ date: 1, replacementEmployeeId: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
module.exports = mongoose.model('StaffReplacement', StaffReplacementSchema);
