const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 150 },
  category: { type: String, enum: ['degree', 'certificate', 'training', 'health', 'other'], required: true },
  schoolType: { type: String, trim: true, maxlength: 100, default: '' },
  positions: [{ type: String, enum: ['principal', 'vice_principal', 'head_teacher', 'teacher', 'assistant_teacher', 'accountant', 'chef', 'hr', 'nurse', 'security', 'cleaner'] }],
  required: { type: Boolean, default: true },
  expiryRequired: { type: Boolean, default: false },
  warningDays: { type: Number, min: 1, max: 365, default: 30 },
  active: { type: Boolean, default: true },
  note: { type: String, trim: true, maxlength: 500, default: '' }
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ active: 1, schoolType: 1 });
module.exports = mongoose.model('CredentialRequirement', schema);
