const mongoose = require('mongoose');

const DishSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    category: {
        type: String,
        enum: ['main_course', 'stir_fry', 'soup', 'snack', 'dessert', 'beverage', 'side_dish'],
        required: true
    },
    ageGroup: [{
        type: String,
        enum: ['3-4', '4-5', '5-6', 'all'],
        default: ['all']
    }],
    calories: {
        type: Number,
        default: 0,
        min: 0
    },
    // Giá trị dinh dưỡng được hiểu trên một khẩu phần dành cho một trẻ,
    // không phải trên toàn bộ mẻ nấu.
    servingSizeGram: {
        type: Number,
        default: 100,
        min: 1
    },
    protein: {
        type: Number,
        default: 0,
        min: 0
    },
    fat: {
        type: Number,
        default: 0,
        min: 0
    },
    carbs: {
        type: Number,
        default: 0,
        min: 0
    },
    allergens: [{
        type: String,
        trim: true,
        lowercase: true
    }],
    ingredients: [{
        ingredientId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'IngredientMaster'
        },
        ingredientName: String,
        quantity: Number,
        unit: String
    }],
    recipe: {
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

DishSchema.index({ name: 1 });
DishSchema.index({ category: 1 });
DishSchema.index({ allergens: 1 });

module.exports = mongoose.model('Dish', DishSchema);
