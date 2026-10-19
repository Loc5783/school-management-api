const mongoose = require('mongoose');

const kitchenDayClosingSchema = new mongoose.Schema({
    dateKey: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    rows: [{
        classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true },
        className: String,
        planned: Number,
        cooked: Number,
        delivered: Number,
        received: Number,
        notes: [{ action: String, note: String }]
    }],
    stockMovements: [{
        ingredientId: { type: mongoose.Schema.Types.ObjectId, ref: 'IngredientMaster' },
        ingredientName: String,
        unit: String,
        exported: Number,
        returned: Number,
        spoiled: Number,
        adjusted: Number
    }],
    stockTransactions: [{
        transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryTransaction' },
        type: String,
        ingredientName: String,
        quantity: Number,
        unit: String,
        batchNumber: String,
        sourceExportTransactionId: mongoose.Schema.Types.ObjectId,
        lotAllocations: [{ batchNumber: String, quantity: Number, unit: String }],
        reason: String,
        createdAt: Date
    }],
    note: { type: String, trim: true, maxlength: 2000, default: '' },
    leftoverCookedCount: { type: Number, required: true, min: 0, default: 0 },
    disposedCookedCount: { type: Number, required: true, min: 0, default: 0 },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    closedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('KitchenDayClosing', kitchenDayClosingSchema);
