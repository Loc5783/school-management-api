const mongoose = require('mongoose');

const KitchenRequestSchema = new mongoose.Schema({
    requestCode: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
    },
    requestType: {
        type: String,
        enum: ['ingredient_purchase', 'equipment_repair', 'equipment_new', 'special_diet', 'cleaning_supplies'],
        required: true
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    requestedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    requestedByName: {
        type: String,
        required: true
    },
    items: [{
        name: { type: String, required: true },
        quantity: { type: Number, required: true, min: 0 },
        unit: { type: String, required: true },
        estimatedCost: { type: Number, default: 0, min: 0 },
        supplierId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Supplier'
        },
        notes: String
    }],
    totalEstimatedCost: {
        type: Number,
        default: 0,
        min: 0
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'medium'
    },
    neededByDate: Date,
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'completed'],
        default: 'pending'
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedByName: String,
    approvalNotes: String
}, {
    timestamps: true
});

KitchenRequestSchema.index({ status: 1 });
KitchenRequestSchema.index({ requestType: 1 });

module.exports = mongoose.model('KitchenRequest', KitchenRequestSchema);
