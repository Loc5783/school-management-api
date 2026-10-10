const mongoose = require('mongoose');

const changeSchema = new mongoose.Schema({ field: { type: String, required: true }, before: { type: String, default: '' }, after: { type: String, default: '' } }, { _id: false });
const eventSchema = new mongoose.Schema({ action: { type: String, required: true }, actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, actorName: { type: String, required: true }, note: { type: String, maxlength: 2000, default: '' }, at: { type: Date, default: Date.now } }, { _id: false });
const certificateSchema = new mongoose.Schema({ organizationName: { type: String, required: true, maxlength: 200 }, documentNumber: { type: String, required: true, maxlength: 80 }, content: { type: String, required: true, maxlength: 8000 }, employeeSnapshot: mongoose.Schema.Types.Mixed, preparedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, preparedAt: Date, issuedByName: String, issuedAt: Date }, { _id: false });
const schema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  employeeName: { type: String, required: true }, employeeCode: { type: String, required: true },
  type: { type: String, enum: ['profile_change', 'employment_certificate', 'timesheet_feedback', 'payroll_feedback'], required: true },
  subject: { type: String, required: true, maxlength: 160 }, message: { type: String, required: true, maxlength: 2000 },
  changes: [changeSchema], accountBefore: { type: mongoose.Schema.Types.Mixed, default: {} },
  sensitive: { type: Boolean, default: false },
  referenceId: { type: mongoose.Schema.Types.ObjectId, default: null }, referenceSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  status: { type: String, enum: ['pending', 'in_review', 'approved', 'resolved', 'rejected', 'cancelled'], default: 'pending' },
  openKey: { type: String, required: true }, requestId: { type: String, required: true, maxlength: 100 },
  response: { type: String, maxlength: 2000, default: '' }, certificate: { type: certificateSchema, default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, reviewedByName: { type: String, default: '' }, reviewedAt: Date,
  events: [eventSchema]
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ userId: 1, createdAt: -1 });
schema.index({ status: 1, type: 1, createdAt: -1 });
schema.index({ userId: 1, requestId: 1 }, { unique: true });
schema.index({ userId: 1, openKey: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['pending', 'in_review'] } } });
schema.index({ 'certificate.documentNumber': 1 }, { unique: true, partialFilterExpression: { 'certificate.documentNumber': { $type: 'string' } } });
module.exports = mongoose.model('StaffPersonalRequest', schema);
