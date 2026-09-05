const mongoose = require('mongoose');

const KitchenEquipmentSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    code: {
        type: String,
        required: true,
        unique: true,
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

module.exports = mongoose.model('KitchenEquipment', KitchenEquipmentSchema);
