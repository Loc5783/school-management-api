const mongoose = require('mongoose');

const KitchenStaffSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    fullName: {
        type: String,
        required: true,
        trim: true
    },
    staffCode: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
    },
    phone: {
        type: String,
        required: true,
        trim: true
    },
    position: {
        type: String,
        enum: ['head_chef', 'sous_chef', 'prep_cook', 'cleaner', 'dietitian', 'storekeeper'],
        required: true
    },
    foodSafetyCert: {
        certNumber: { type: String, default: '' },
        issueDate: Date,
        expiryDate: Date,
        issuingOrganization: { type: String, default: 'Chi cục An toàn vệ sinh thực phẩm' },
        isValid: { type: Boolean, default: true }
    },
    healthCheck: {
        checkDate: Date,
        expiryDate: Date,
        result: { type: String, default: 'Đủ điều kiện sức khỏe tiếp xúc trực tiếp thực phẩm' },
        hospital: { type: String, default: '' }
    },
    shift: {
        type: String,
        enum: ['morning', 'afternoon', 'full_day'],
        default: 'morning'
    },
    assignedTasks: [{
        type: String,
        trim: true
    }],
    status: {
        type: String,
        enum: ['active', 'on_leave', 'resigned'],
        default: 'active'
    },
    notes: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

KitchenStaffSchema.index({ position: 1 });
KitchenStaffSchema.index({ status: 1 });

module.exports = mongoose.model('KitchenStaff', KitchenStaffSchema);
