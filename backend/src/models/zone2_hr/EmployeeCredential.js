const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  requirementId: { type: mongoose.Schema.Types.ObjectId, ref: 'CredentialRequirement', required: true },
  number: { type: String, trim: true, maxlength: 100, default: '' },
  issuer: { type: String, trim: true, maxlength: 200, required: true },
  issuedOn: { type: String, required: true },
  expiresOn: { type: String, default: '' },
  evidenceUrl: { type: String, trim: true, maxlength: 2000, default: '' },
  evidenceFile: {
    filename: { type: String, default: '' },
    originalName: { type: String, default: '' },
    path: { type: String, default: '' },
    mimetype: { type: String, default: '' },
    size: { type: Number, default: 0 },
    uploadedAt: { type: Date, default: null }
  },
  note: { type: String, trim: true, maxlength: 1000, default: '' },
  verification: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  verifiedAt: { type: Date, default: null },
  reviewNote: { type: String, trim: true, maxlength: 500, default: '' }
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ employeeId: 1, requirementId: 1 }, { unique: true });
schema.index({ expiresOn: 1, verification: 1 });
module.exports = mongoose.model('EmployeeCredential', schema);
