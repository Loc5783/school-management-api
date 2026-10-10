const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  status: { type: String, enum: ['invited', 'attended', 'absent'], default: 'invited' },
  result: { type: String, enum: ['pending', 'passed', 'failed'], default: 'pending' },
  note: { type: String, trim: true, maxlength: 500, default: '' },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  recordedAt: Date
});

const schema = new mongoose.Schema({
  title: { type: String, trim: true, required: true, maxlength: 180 },
  category: { type: String, enum: ['child_care', 'first_aid', 'food_safety', 'fire_safety', 'professional', 'other'], required: true },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  location: { type: String, trim: true, required: true, maxlength: 180 },
  instructor: { type: String, trim: true, required: true, maxlength: 120 },
  note: { type: String, trim: true, maxlength: 1000, default: '' },
  status: { type: String, enum: ['scheduled', 'completed', 'cancelled'], default: 'scheduled' },
  participants: [participantSchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  completedAt: Date
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ startsAt: -1, status: 1 });
schema.index({ 'participants.employeeId': 1 });
module.exports = mongoose.model('TrainingEvent', schema);
