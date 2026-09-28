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
    // Các khoản thu linh hoạt được lập cùng hóa đơn: hoạt động ngoại khóa,
    // hội phí, bảo hiểm... Giữ extraFee để tương thích hóa đơn cũ.
    additionalItems: [{
        name: { type: String, required: true, trim: true, maxlength: 120 },
        amount: { type: Number, required: true, min: 0 }
    }],
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
    note: String,
    cancelledAt: Date,
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelledByName: String,
    cancelReason: { type: String, trim: true, maxlength: 1000, default: '' }
}, {
    timestamps: true
});

// Indexes
// Unique index studentId + period được quản lý bởi migration/createIndexes.
// Hóa đơn đã hủy không chặn việc lập lại một hóa đơn nghiệp vụ mới.
TuitionFeeSchema.index({ classroomId: 1 });
TuitionFeeSchema.index({ status: 1 });
TuitionFeeSchema.index({ dueDate: 1 });

module.exports = mongoose.model('TuitionFee', TuitionFeeSchema);
