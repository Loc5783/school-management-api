const mongoose = require('mongoose');
const interviewSchema = new mongoose.Schema({
  scheduledAt: { type: Date, required: true }, interviewerName: { type: String, trim: true, required: true, maxlength: 120 },
  outcome: { type: String, enum: ['pending', 'passed', 'failed'], default: 'pending' },
  feedback: { type: String, trim: true, maxlength: 1000, default: '' },
  evaluatedAt: Date, evaluatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});
const taskSchema = new mongoose.Schema({
  title: { type: String, trim: true, required: true, maxlength: 150 },
  dueOn: { type: String, required: true }, mandatory: { type: Boolean, default: true },
  completedAt: Date, completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});
const schema = new mongoose.Schema({
  needId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringNeed', required: true },
  fullName: { type: String, required: true, trim: true, maxlength: 120 },
  phone: { type: String, required: true, trim: true, maxlength: 20 },
  phoneKey: { type: String, required: true },
  email: { type: String, trim: true, lowercase: true, maxlength: 200, default: '' },
  note: { type: String, trim: true, maxlength: 1000, default: '' },
  status: { type: String, enum: ['applied', 'interviewing', 'recommended', 'approved', 'rejected', 'declined'], default: 'applied' },
  interviews: [interviewSchema],
  proposedStartDate: { type: String, default: '' },
  decisionReason: { type: String, trim: true, maxlength: 1000, default: '' },
  decidedAt: Date, decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  onboardingTasks: [taskSchema],
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  onboardedAt: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ needId: 1, phoneKey: 1 }, { unique: true });
schema.index({ status: 1, proposedStartDate: 1 });
schema.index({ employeeId: 1 }, { unique: true, partialFilterExpression: { employeeId: { $type: 'objectId' } } });
module.exports = mongoose.model('JobApplicant', schema);
