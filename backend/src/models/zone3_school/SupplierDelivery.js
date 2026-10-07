const mongoose = require('mongoose');

const SupplierDeliverySchema = new mongoose.Schema({
  deliveryDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
  purchaseOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', default: null, index: true },
  orderCode: { type: String, trim: true, uppercase: true, maxlength: 50, default: '' },
  supplierName: { type: String, required: true, trim: true, maxlength: 160 },
  driverName: { type: String, required: true, trim: true, maxlength: 120 },
  phone: { type: String, trim: true, maxlength: 20, default: '' },
  vehiclePlate: { type: String, trim: true, uppercase: true, maxlength: 20, default: '' },
  itemsDescription: { type: String, required: true, trim: true, maxlength: 1000 },
  recipientName: { type: String, required: true, trim: true, maxlength: 120 },
  allowedArea: { type: String, trim: true, maxlength: 160, default: 'Khu vực giao nhận' },
  checkInAt: { type: Date, required: true, default: Date.now },
  checkOutAt: { type: Date, default: null },
  status: { type: String, enum: ['inside', 'completed', 'denied'], default: 'inside', index: true },
  note: { type: String, trim: true, maxlength: 500, default: '' },
  clientEventId: { type: String, trim: true, maxlength: 100 },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recordedByName: { type: String, required: true, trim: true },
  checkedOutBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  checkedOutByName: { type: String, trim: true, default: '' }
}, { timestamps: true });

SupplierDeliverySchema.index({ deliveryDate: 1, status: 1, checkInAt: -1 });
SupplierDeliverySchema.index({ clientEventId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('SupplierDelivery', SupplierDeliverySchema);
