const mongoose = require('mongoose');

const EmployeeSchema = new mongoose.Schema({
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tenant'
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    employeeCode: {
        type: String,
        required: true,
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
        default: null
    },
    birthDate: Date,
    phone: {
        type: String,
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
    // Phân hiệu / Cơ sở làm việc chính trong trường (hỗ trợ đồng bộ máy chấm công theo từng phân hiệu)
    campus: {
        type: String,
        trim: true,
        maxlength: 120,
        default: 'Cơ sở chính'
    },
    position: {
        type: String,
        enum: [
            'principal',
            'vice_principal',
            'youth_leader',
            'head_teacher',
            'teacher',
            'assistant_teacher',
            'chief_accountant',
            'accountant',
            'head_chef',
            'chef',
            'kitchen_helper',
            'hr',
            'office_admin',
            'nurse',
            'security',
            'cleaner',
            'maintenance',
            'driver'
        ],
        required: true,
        default: 'teacher'
    },
    // Lương được phân loại theo vai trò; tổ/bộ phận chỉ phục vụ cơ cấu nội bộ.
    payrollRole: {
        type: String,
        enum: ['principal', 'teacher', 'accountant', 'chef', 'guard', 'hr'],
        required: true,
        default: 'teacher'
    },
    qualification: {
        degree: { type: String, default: '' },
        major: { type: String, default: '' },
        graduationYear: Number
    },
    contractType: {
        type: String,
        enum: ['probation', 'fixed_1_year', 'fixed_3_year', 'indefinite'],
        default: null
    },
    contractNumber: { type: String, trim: true },
    contractSignedDate: Date,
    contractStartDate: Date,
    startDate: {
        type: Date,
        default: null
    },
    endDate: Date,
    salaryConfig: {
        baseSalary: { type: Number, required: true, default: 0 },
        lowMonthlySalaryConfirmed: { type: Boolean, default: false },
        standardWorkDays: { type: Number, min: 1, max: 31, default: 26 },
        positionAllowance: { type: Number, default: 0 },
        lunchAllowance: { type: Number, default: 0 },
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

EmployeeSchema.index({ tenantId: 1, employeeCode: 1 }, {
    unique: true,
    partialFilterExpression: { tenantId: { $type: 'objectId' } }
});
EmployeeSchema.index({ employeeCode: 1 }, {
    unique: true,
    partialFilterExpression: { tenantId: null }
});
EmployeeSchema.index({ departmentId: 1 });
EmployeeSchema.index({ userId: 1 }, { unique: true, sparse: true });
EmployeeSchema.index({ status: 1 });
EmployeeSchema.index({ position: 1 });
EmployeeSchema.index({ payrollRole: 1, status: 1 });
EmployeeSchema.index({ tenantId: 1, campus: 1, status: 1 });

module.exports = mongoose.model('Employee', EmployeeSchema);
