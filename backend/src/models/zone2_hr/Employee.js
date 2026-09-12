const mongoose = require('mongoose');

const EmployeeSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    employeeCode: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
    },
    fullName: {
        type: String,
        required: true,
        trim: true
    },
    gender: {
        type: String,
        enum: ['male', 'female'],
        default: 'female'
    },
    birthDate: Date,
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
    address: String,
    idCard: String,
    departmentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Department'
    },
    departmentName: String,
    position: {
        type: String,
        enum: ['principal', 'vice_principal', 'head_teacher', 'teacher', 'assistant_teacher', 'accountant', 'chef', 'nurse', 'security', 'cleaner'],
        required: true,
        default: 'teacher'
    },
    qualification: {
        degree: { type: String, default: 'Đại học Sư phạm Mầm non' },
        major: { type: String, default: 'Giáo dục Mầm non' },
        graduationYear: Number
    },
    contractType: {
        type: String,
        enum: ['probation', 'fixed_1_year', 'fixed_3_year', 'indefinite'],
        default: 'fixed_1_year'
    },
    startDate: {
        type: Date,
        default: Date.now
    },
    endDate: Date,
    salaryConfig: {
        baseSalary: { type: Number, required: true, default: 7000000 },
        positionAllowance: { type: Number, default: 1000000 },
        lunchAllowance: { type: Number, default: 730000 },
        bankAccount: {
            bankName: String,
            accountNumber: String,
            accountHolder: String
        }
    },
    status: {
        type: String,
        enum: ['active', 'on_leave', 'resigned'],
        default: 'active'
    }
}, {
    timestamps: true
});

EmployeeSchema.index({ departmentId: 1 });
EmployeeSchema.index({ status: 1 });
EmployeeSchema.index({ position: 1 });

module.exports = mongoose.model('Employee', EmployeeSchema);
