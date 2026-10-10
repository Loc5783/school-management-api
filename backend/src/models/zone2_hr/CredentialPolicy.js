const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'school' },
  schoolType: { type: String, trim: true, maxlength: 100, default: '' }
}, { timestamps: true, optimisticConcurrency: true });
module.exports = mongoose.model('CredentialPolicy', schema);
