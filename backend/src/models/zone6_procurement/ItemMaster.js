const mongoose = require('mongoose');

const ItemMasterSchema = new mongoose.Schema({
    category: {
        type: String,
        enum: ['food', 'equipment', 'stationery', 'toy', 'furniture', 'it'],
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    unit: {
        type: String,
        required: true // VD: cái, bộ, kg, chiếc
    },
    defaultUnitPrice: {
        type: Number,
        default: 0,
        min: 0
    },
    description: String,
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    }
}, {
    timestamps: true
});

ItemMasterSchema.index({ category: 1 });
ItemMasterSchema.index({ name: 'text' });

module.exports = mongoose.model('ItemMaster', ItemMasterSchema);