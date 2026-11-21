const mongoose = require('mongoose');

const IngredientMasterSchema = new mongoose.Schema({
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tenant',
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    code: {
        type: String,
        required: true,
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
IngredientMasterSchema.index(
    { tenantId: 1, code: 1 },
    { name: 'tenantId_1_code_1_unique', unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } }
);
IngredientMasterSchema.index(
    { code: 1 },
    { name: 'legacy_code_1_unique', unique: true, partialFilterExpression: { tenantId: null } }
);

module.exports = mongoose.model('IngredientMaster', IngredientMasterSchema);

