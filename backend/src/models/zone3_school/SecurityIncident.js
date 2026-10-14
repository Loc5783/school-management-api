const mongoose = require('mongoose');

const SecurityIncidentSchema = new mongoose.Schema({
  incidentDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
  category: { type: String, enum: ['unauthorized_person', 'invalid_picker', 'child_safety', 'accident', 'lost_property', 'equipment', 'fire', 'traffic', 'other'], required: true },
  severity: { type: String, enum: ['normal', 'serious', 'emergency'], default: 'normal', index: true },
  location: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, required: true, trim: true, maxlength: 2000 },
  actionTaken: { type: String, trim: true, maxlength: 1000, default: '' },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null },
  studentName: { type: String, trim: true, default: '' },
  status: { type: String, enum: ['open', 'in_progress', 'handed_over', 'closed'], default: 'open', index: true },
  reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reportedByName: { type: String, required: true, trim: true },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedByName: { type: String, trim: true, default: '' },
  resolvedAt: { type: Date, default: null },
  acknowledgedAt: { type: Date, default: null },
  acknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  acknowledgedByName: { type: String, trim: true, default: '' },
  nextReminderAt: { type: Date, default: null },
  reminderCount: { type: Number, min: 0, default: 0 },
  resolutionNote: { type: String, trim: true, maxlength: 1000, default: '' },
  managementNotes: [{
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String, required: true, trim: true },
    authorRole: { type: String, required: true, trim: true },
    note: { type: String, required: true, trim: true, maxlength: 1000 },
    createdAt: { type: Date, default: Date.now }
  }],
  clientEventId: { type: String, trim: true, maxlength: 100 }
}, { timestamps: true });

SecurityIncidentSchema.index({ status: 1, severity: 1, createdAt: -1 });
SecurityIncidentSchema.index({ clientEventId: 1 }, { unique: true, sparse: true });
module.exports = mongoose.model('SecurityIncident', SecurityIncidentSchema);
