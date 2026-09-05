const mongoose = require('mongoose');

const FoodInspectionSchema = new mongoose.Schema({
    inspectionDate: {
        type: Date,
        required: true,
        default: Date.now
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
    // BƯỚC 1: Kiểm tra trước khi chế biến (Nguyên liệu đầu vào)
    step1_rawIngredients: [{
        ingredientName: { type: String, required: true },
        supplierName: { type: String, default: '' },
        quantity: { type: Number, default: 0 },
        unit: { type: String, default: 'kg' },
        sensoryCondition: { type: String, default: 'Tươi mới, cảm quan tốt' },
        packagingAndLabel: { type: String, default: 'Bao bì nguyên vẹn, có nhãn mác' },
        quarantineCertificate: { type: Boolean, default: true },
        decision: { type: String, enum: ['accept', 'reject'], default: 'accept' },
        checkTime: { type: Date, default: Date.now }
    }],
    // BƯỚC 2: Kiểm tra trong quá trình chế biến
    step2_processing: {
        kitchenHygiene: { type: String, default: 'Khu vực chế biến sạch sẽ, sàn khô ráo' },
        equipmentHygiene: { type: String, default: 'Dụng cụ dao thớt sống/chín phân biệt rõ' },
        staffHygiene: { type: String, default: 'Nhân viên mặc bảo hộ đầy đủ, đeo găng tay, tạp dề' },
        cookingTemperaturePassed: { type: Boolean, default: true },
        separateRawAndCooked: { type: Boolean, default: true },
        checkTime: { type: Date, default: Date.now },
        notes: { type: String, default: '' }
    },
    // BƯỚC 3: Kiểm tra trước khi ăn (Bàn ăn & Chia suất)
    step3_serving: {
        servingTime: { type: Date, default: Date.now },
        sensoryEvaluation: { type: String, default: 'Thức ăn chín kỹ, màu sắc và mùi vị đặc trưng' },
        foodSampleStored: { type: Boolean, default: true },
        utensilsHygienePassed: { type: Boolean, default: true },
        decision: { type: String, enum: ['approved_for_eating', 'held_for_review'], default: 'approved_for_eating' },
        notes: { type: String, default: '' }
    },
    inspectorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    inspectorName: {
        type: String,
        required: true
    },
    notes: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

FoodInspectionSchema.index({ mealDate: -1, mealType: 1 });

module.exports = mongoose.model('FoodInspection', FoodInspectionSchema);

