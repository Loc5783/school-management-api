const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  kind: { type: String, enum: ['classroom', 'shift', 'asset', 'keys', 'open_work'], required: true },
  title: { type: String, trim: true, required: true, maxlength: 180 },
  details: { type: String, trim: true, maxlength: 1000, default: '' },
  referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },
  handedAt: Date,
  receivedAt: Date,
  handedNote: { type: String, trim: true, maxlength: 500, default: '' },
  receivedNote: { type: String, trim: true, maxlength: 500, default: '' }
});

const schema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  receiverEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  kind: { type: String, enum: ['transfer', 'resignation'], required: true },
  reason: { type: String, trim: true, required: true, maxlength: 500 },
  effectiveAt: { type: Date, required: true },
  status: { type: String, enum: ['draft', 'scheduled', 'completed', 'cancelled'], default: 'draft' },
  items: [itemSchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  scheduledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  scheduledAt: Date,
  completedAt: Date,
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  cancelledAt: Date,
  cancelReason: { type: String, trim: true, maxlength: 500, default: '' },
  processingError: { type: String, trim: true, maxlength: 500, default: '' }
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ employeeId: 1, createdAt: -1 });
schema.index({ status: 1, effectiveAt: 1 });
schema.index({ employeeId: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['draft', 'scheduled'] } } });
module.exports = mongoose.model('StaffHandover', schema);
