const mongoose = require('mongoose');

const InventoryReconciliationSchema = new mongoose.Schema({
    inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', required: true },
    ingredientId: { type: mongoose.Schema.Types.ObjectId, ref: 'IngredientMaster', required: true },
    ingredientName: { type: String, required: true },
    batchNumber: { type: String, required: true },
    systemQuantity: { type: Number, required: true, min: 0 },
    actualQuantity: { type: Number, required: true, min: 0 },
    difference: { type: Number, required: true },
    unit: { type: String, required: true },
    notes: { type: String, default: '' },
    countedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    countedByName: { type: String, default: '' }
}, { timestamps: true });

InventoryReconciliationSchema.index({ inventoryId: 1, createdAt: -1 });

module.exports = mongoose.model('InventoryReconciliation', InventoryReconciliationSchema);
