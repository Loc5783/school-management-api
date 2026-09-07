const mongoose = require('mongoose');

const InventoryTransactionSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['import', 'export', 'return', 'spoilage', 'adjustment'],
        required: true
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
        default: ''
    },
    quantity: {
        type: Number,
        required: true
    },
    unit: {
        type: String,
        required: true
    },
    costPerUnit: {
        type: Number,
        default: 0
    },
    totalAmount: {
        type: Number,
        default: 0
    },
    supplierId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Supplier'
    },
    supplierName: String,
    storageLocation: {
        type: String,
        default: ''
    },
    classroomId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Classroom'
    },
    className: String,
    mealDate: Date,
    mealType: {
        type: String,
        enum: ['breakfast', 'morningSnack', 'lunch', 'afternoonSnack', 'dinner', 'general'],
        default: 'general'
    },
    reason: {
        type: String,
        default: ''
    },
    performedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    performedByName: String
}, {
    timestamps: true
});

InventoryTransactionSchema.index({ ingredientId: 1 });
InventoryTransactionSchema.index({ type: 1 });
InventoryTransactionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('InventoryTransaction', InventoryTransactionSchema);
