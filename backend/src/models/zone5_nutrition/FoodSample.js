const mongoose = require('mongoose');

const FoodSampleSchema = new mongoose.Schema({
    sampleCode: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
    },
    mealDate: {
        type: Date,
        required: true
    },
    mealType: {
        type: String,
        enum: ['breakfast', 'morningSnack', 'lunch', 'afternoonSnack', 'dinner'],
        required: true
    },
    dishName: {
        type: String,
        required: true,
        trim: true
    },
    dishCategory: {
        type: String,
        default: 'Món chính'
    },
    sampleWeightGram: {
        type: Number,
        required: true,
        default: 100 // Tối thiểu 100g thức ăn đặc hoặc 150ml thức ăn lỏng
    },
    storageTemperature: {
        type: Number,
        default: 4 // Nhiệt độ 2 - 8 độ C
    },
    storageFridge: {
        type: String,
        default: 'Tủ lưu mẫu chuyên dụng 01'
    },
    storedAt: {
        type: Date,
        default: Date.now
    },
    storedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    storedByName: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['stored', 'disposed_normal', 'sent_to_lab', 'investigating'],
        default: 'stored'
    },
    disposedAt: Date,
    disposedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    disposedByName: String,
    sensoryEvaluation: {
        color: { type: String, default: 'Đạt chuẩn' },
        smell: { type: String, default: 'Thơm tự nhiên, không mùi lạ' },
        taste: { type: String, default: 'Bình thường' }
    },
    notes: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

FoodSampleSchema.index({ mealDate: -1 });
FoodSampleSchema.index({ status: 1 });

module.exports = mongoose.model('FoodSample', FoodSampleSchema);
