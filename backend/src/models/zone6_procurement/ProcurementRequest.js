const mongoose = require('mongoose');

const ProcurementRequestSchema = new mongoose.Schema({
    requesterId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    requesterName: {
        type: String,
        required: true
    },
    requesterDepartment: String,
    category: {
        type: String,
        enum: ['food', 'equipment', 'stationery', 'toy', 'furniture', 'it'],
        required: true
    },
    items: [{
        itemId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'ItemMaster'
        },
        itemName: String,
        quantity: {
            type: Number,
            required: true,
            min: 1
        },
        unit: String,
        estimatedPrice: {
            type: Number,
            min: 0
        },
        totalEstimated: {
            type: Number,
            min: 0
        },
        note: String
    }],
    totalEstimatedCost: {
        type: Number,
        min: 0,
        default: 0
    },
    urgency: {
        type: String,
        enum: ['normal', 'urgent', 'critical'],
        default: 'normal'
    },
    reason: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'approved_l1', 'approved_l2', 'rejected', 'purchased'],
        default: 'pending'
    },
    attachment: String, // URL file báo giá
    approverLevel1: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approverLevel1Name: String,
    approverLevel1At: Date,
    approverLevel2: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approverLevel2Name: String,
    approverLevel2At: Date,
    rejectionReason: String
}, {
    timestamps: true
});

ProcurementRequestSchema.index({ requesterId: 1 });
ProcurementRequestSchema.index({ status: 1 });
ProcurementRequestSchema.index({ urgency: 1 });

module.exports = mongoose.model('ProcurementRequest', ProcurementRequestSchema);