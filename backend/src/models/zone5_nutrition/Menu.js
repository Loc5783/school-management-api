const mongoose = require('mongoose');

const MealItemSchema = new mongoose.Schema({
    dishId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dish' },
    dishName: { type: String, default: '' },
    calories: { type: Number, default: 0 },
    notes: { type: String, default: '' }
}, { _id: false });

const DayMealSchema = new mongoose.Schema({
    dayOfWeek: {
        type: String,
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
        required: true
    },
    date: {
        type: Date
    },
    breakfast: {
        dishId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dish' },
        dishName: { type: String, default: '' },
        calories: { type: Number, default: 0 },
        notes: { type: String, default: '' },
        items: [MealItemSchema]
    },
    morningSnack: {
        dishId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dish' },
        dishName: { type: String, default: '' },
        calories: { type: Number, default: 0 },
        notes: { type: String, default: '' },
        items: [MealItemSchema]
    },
    lunch: {
        mainDish: {
            dishId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dish' },
            dishName: { type: String, default: '' }
        },
        stirFryDish: {
            dishId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dish' },
            dishName: { type: String, default: '' }
        },
        soupDish: {
            dishId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dish' },
            dishName: { type: String, default: '' }
        },
        dessert: {
            dishId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dish' },
            dishName: { type: String, default: '' }
        },
        mainDishes: [MealItemSchema],
        stirFryDishes: [MealItemSchema],
        soupDishes: [MealItemSchema],
        desserts: [MealItemSchema],
        calories: { type: Number, default: 0 },
        notes: { type: String, default: '' },
        items: [MealItemSchema]
    },
    afternoonSnack: {
        dishId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dish' },
        dishName: { type: String, default: '' },
        calories: { type: Number, default: 0 },
        notes: { type: String, default: '' },
        items: [MealItemSchema]
    },
    totalCalories: {
        type: Number,
        default: 0
    }
}, { _id: false });

const MenuSchema = new mongoose.Schema({
    classroomId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Classroom',
        required: true
    },
    className: {
        type: String,
        required: true
    },
    schoolYear: {
        type: String,
        default: '2025-2026'
    },
    weekNumber: {
        type: Number,
        required: true,
        min: 1,
        max: 53
    },
    startDate: {
        type: Date,
        required: true
    },
    endDate: {
        type: Date,
        required: true
    },
    dietaryType: {
        type: String,
        enum: ['standard', 'allergy_adjusted', 'medical_diet', 'custom'],
        default: 'standard'
    },
    medicalNotes: {
        type: String,
        default: ''
    },
    allergensExcluded: [{
        type: String,
        trim: true,
        lowercase: true
    }],
    days: [DayMealSchema],
    allergyWarnings: [{
        studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
        studentName: String,
        allergenMatched: String,
        diseaseMatched: String,
        dishName: String,
        dayOfWeek: String,
        mealType: String,
        resolved: { type: Boolean, default: false }
    }],
    status: {
        type: String,
        enum: ['draft', 'pending_approval', 'published', 'archived'],
        default: 'draft'
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    createdByName: String,
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedByName: String
    ,
    approvalNote: {
        type: String,
        trim: true,
        maxlength: 500,
        default: ''
    },
    auditTrail: [{
        action: {
            type: String,
            enum: ['created', 'updated', 'submitted', 'approved', 'returned', 'archived'],
            required: true
        },
        actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        actorName: { type: String, required: true },
        fromStatus: String,
        toStatus: String,
        reason: { type: String, trim: true, maxlength: 500, default: '' },
        occurredAt: { type: Date, default: Date.now, required: true }
    }]
}, {
    timestamps: true
});

MenuSchema.index({ classroomId: 1, schoolYear: 1, weekNumber: 1 }, { unique: true });
MenuSchema.index({ startDate: 1, endDate: 1 });
MenuSchema.index({ status: 1 });

module.exports = mongoose.model('Menu', MenuSchema);
