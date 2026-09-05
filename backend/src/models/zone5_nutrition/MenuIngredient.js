const mongoose = require('mongoose');

const MenuIngredientSchema = new mongoose.Schema({
    menuId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Menu',
        required: true
    },
    dishId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Dish'
    },
    ingredientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'IngredientMaster',
        required: true
    },
    quantityPerStudent: {
        type: Number,
        required: true,
        min: 0
    },
    unit: {
        type: String,
        required: true
    },
    estimatedCost: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

MenuIngredientSchema.index({ menuId: 1 });
MenuIngredientSchema.index({ ingredientId: 1 });

module.exports = mongoose.model('MenuIngredient', MenuIngredientSchema);

