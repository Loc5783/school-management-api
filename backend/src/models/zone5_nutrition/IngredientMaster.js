const mongoose = require('mongoose');

const IngredientMasterSchema = new mongoose.Schema({
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
        enum: ['meat', 'seafood', 'vegetable', 'fruit', 'dry_grain', 'dairy', 'spice', 'other'],
        required: true
    },
    unit: {
        type: String,
        enum: ['kg', 'g', 'l', 'ml', 'piece', 'box', 'can', 'pack'],
        required: true
    },
    standardPrice: {
        type: Number,
        default: 0,
        min: 0
    },
    caloriesPer100g: {
        type: Number,
        default: 0,
        min: 0
    },
    minStockAlert: {
        type: Number,
        default: 5,
        min: 0
    },
    allergens: [{
        type: String,
        trim: true,
        lowercase: true
    }],
    description: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    }
}, {
    timestamps: true
});

IngredientMasterSchema.index({ category: 1 });

module.exports = mongoose.model('IngredientMaster', IngredientMasterSchema);

