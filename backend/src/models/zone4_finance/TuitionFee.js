const mongoose = require('mongoose');

const TuitionFeeSchema = new mongoose.Schema({
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true
    },
    studentName: {
        type: String,
        required: true
    },
    classroomId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Classroom',
        required: true
    },
    className: {
        type: String,
        required: true
    },
    period: {
        type: String,
        required: true, // 'MM-YYYY' ví dụ '08-2026'
        index: true
    },
    tuitionBase: {
        type: Number,
        required: true,
        min: 0
    },
    mealFee: {
        type: Number,
        default: 0,
        min: 0
    },
    busFee: {
        type: Number,
        default: 0,
        min: 0
    },
    extraFee: {
        type: Number,
        default: 0,
        min: 0
    },
    discount: {
        type: Number,
        default: 0,
        min: 0
    },
    totalAmount: {
        type: Number,
        required: true,
        min: 0
    },
    paidAmount: {
        type: Number,
        default: 0,
        min: 0
    },
    dueDate: {
        type: Date,
        required: true
    },
    status: {
        type: String,
        enum: ['unpaid', 'partial', 'paid', 'cancelled'],
        default: 'unpaid'
    },
    note: String
}, {
    timestamps: true
});

// Indexes
TuitionFeeSchema.index({ studentId: 1, period: 1 });
TuitionFeeSchema.index({ classroomId: 1 });
TuitionFeeSchema.index({ status: 1 });
TuitionFeeSchema.index({ dueDate: 1 });

module.exports = mongoose.model('TuitionFee', TuitionFeeSchema);