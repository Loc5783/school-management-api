const mongoose = require('mongoose');

const historySchema = new mongoose.Schema({
    action: { type: String, enum: ['cooked', 'delivered', 'received'], required: true },
    count: { type: Number, required: true, min: 0 },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    at: { type: Date, default: Date.now }
}, { _id: false });

const mealServingSchema = new mongoose.Schema({
    dateKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true },
    plannedAtCook: { type: Number, required: true, min: 0 },
    cookedCount: { type: Number, required: true, min: 0 },
    deliveredCount: { type: Number, default: null, min: 0 },
    receivedCount: { type: Number, default: null, min: 0 },
    cookedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    deliveredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    deliveredAt: Date,
    receivedAt: Date,
    history: [historySchema]
}, { timestamps: true, optimisticConcurrency: true });

mealServingSchema.index({ dateKey: 1, classroomId: 1 }, { unique: true });

module.exports = mongoose.model('MealServing', mealServingSchema);
