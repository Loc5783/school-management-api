const mongoose = require('mongoose');

const InventorySchema = new mongoose.Schema({
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tenant',
        index: true
    },
    ingredientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'IngredientMaster',
        required: true
    },
    ingredientName: {
        type: String,
        required: true
    },
    batchNumber: {
        type: String,
        required: true,
        trim: true
    },
    quantity: {
        type: Number,
        required: true,
        min: 0,
        default: 0
    },
    unit: {
        type: String,
        required: true
    },
    costPerUnit: {
        type: Number,
        default: 0,
        min: 0
    },
    expiryDate: {
        type: Date,
        required: true
    },
    supplierId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Supplier'
    },
    supplierName: {
        type: String,
        default: ''
    },
    storageLocation: {
        type: String,
        default: 'Kho thực phẩm chung'
    },
    status: {
        type: String,
        enum: ['available', 'near_expiry', 'expired', 'depleted', 'disposed'],
        default: 'available'
    }
}, {
    timestamps: true
});

InventorySchema.index(
    { tenantId: 1, ingredientId: 1, batchNumber: 1 },
    { name: 'tenantId_1_ingredientId_1_batchNumber_1_unique', unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } }
);
InventorySchema.index(
    { ingredientId: 1, batchNumber: 1 },
    { name: 'legacy_ingredientId_1_batchNumber_1_unique', unique: true, partialFilterExpression: { tenantId: null } }
);
InventorySchema.index({ expiryDate: 1 });
InventorySchema.index({ status: 1 });

module.exports = mongoose.model('Inventory', InventorySchema);
