const mongoose = require('mongoose');

const SupplierSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    code: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
    },
    contactPerson: {
        type: String,
        default: ''
    },
    phone: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        trim: true,
        lowercase: true
    },
    address: {
        type: String,
        default: ''
    },
    taxCode: {
        type: String,
        trim: true
    },
    categories: [{
        type: String,
        enum: ['meat', 'seafood', 'vegetable', 'fruit', 'dry_grain', 'dairy', 'spice', 'equipment', 'other']
    }],
    foodSafetyCert: {
        certNumber: { type: String, default: '' },
        issuedDate: Date,
        expiryDate: Date,
        issuingAuthority: { type: String, default: '' },
        isValid: { type: Boolean, default: true }
    },
    rating: {
        type: Number,
        min: 1,
        max: 5,
        default: 5
    },
    status: {
        type: String,
        enum: ['active', 'suspended', 'inactive'],
        default: 'active'
    },
    note: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

SupplierSchema.index({ status: 1 });

module.exports = mongoose.model('Supplier', SupplierSchema);
