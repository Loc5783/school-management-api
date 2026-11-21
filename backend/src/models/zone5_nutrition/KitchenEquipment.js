const mongoose = require('mongoose');

const KitchenEquipmentSchema = new mongoose.Schema({
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tenant',
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    code: {
        type: String,
        required: true,
        uppercase: true,
        trim: true
    },
    category: {
        type: String,
        enum: ['cooking', 'cooling_freezer', 'storage', 'sanitization', 'processing', 'water_filter', 'other'],
        required: true
    },
    condition: {
        type: String,
        enum: ['good', 'maintenance_needed', 'broken', 'repairing'],
        default: 'good'
    },
    modelNumber: {
        type: String,
        default: ''
    },
    manufacturer: {
        type: String,
        default: ''
    },
    purchaseDate: Date,
    warrantyExpiryDate: Date,
    location: {
        type: String,
        default: 'Bếp ăn chính'
    },
    lastSanitizedDate: Date,
    nextMaintenanceDate: Date,
    maintenanceLogs: [{
        maintenanceDate: { type: Date, default: Date.now },
        description: { type: String, required: true },
        cost: { type: Number, default: 0 },
        technician: String,
        notes: String
    }],
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    },
    notes: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

KitchenEquipmentSchema.index({ condition: 1 });
KitchenEquipmentSchema.index({ category: 1 });
KitchenEquipmentSchema.index(
    { tenantId: 1, code: 1 },
    { name: 'tenantId_1_code_1_unique', unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } }
);
KitchenEquipmentSchema.index(
    { code: 1 },
    { name: 'legacy_code_1_unique', unique: true, partialFilterExpression: { tenantId: null } }
);

module.exports = mongoose.model('KitchenEquipment', KitchenEquipmentSchema);
