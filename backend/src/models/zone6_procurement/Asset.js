const mongoose = require('mongoose');

const AssetSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    itemId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ItemMaster',
        default: null
    },
    assetCode: {
        type: String,
        trim: true,
        maxlength: 60
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    category: {
        type: String,
        enum: ['food', 'equipment', 'stationery', 'toy', 'furniture', 'it'],
        required: true
    },
    qrCode: String,
    serialNumber: String,
    originalCost: {
        type: Number,
        required: true,
        min: 0,
        default: 0
    },
    residualValue: {
        type: Number,
        min: 0
    },
    purchaseDate: Date,
    warrantyExpiry: Date,
    purchaseOrderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PurchaseOrder'
    },
    classroomId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Classroom',
        default: null
    },
    location: String, // phòng ban / lớp học
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    assignedToName: String,
    maintenanceHistory: [{
        maintenanceDate: Date,
        description: String,
        cost: Number,
        contractor: String,
        nextMaintenanceDate: Date,
        note: String,
        recordedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    }],
    liquidation: {
        liquidationDate: Date,
        liquidationValue: Number,
        reason: String,
        approvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        approvedByName: String,
        note: String
    },
    status: {
        type: String,
        enum: ['active', 'maintenance', 'liquidated', 'lost'],
        default: 'active'
    },
    note: String
}, {
    timestamps: true
});

AssetSchema.index({ itemId: 1 });
AssetSchema.index({ assignedTo: 1 });
AssetSchema.index({ classroomId: 1 });
AssetSchema.index({ status: 1 });
AssetSchema.index({ tenantId: 1, qrCode: 1 });
AssetSchema.index({ qrCode: 1 });

module.exports = mongoose.model('Asset', AssetSchema);
