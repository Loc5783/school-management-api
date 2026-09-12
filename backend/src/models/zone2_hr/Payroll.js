const mongoose = require('mongoose');

const PayrollSchema = new mongoose.Schema({
    employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: true
    },
    employeeCode: {
        type: String,
        required: true
    },
    employeeName: {
        type: String,
        required: true
    },
    departmentName: {
        type: String,
        default: ''
    },
    position: {
        type: String,
        default: 'teacher'
    },
    month: {
        type: Number,
        required: true,
        min: 1,
        max: 12
    },
    year: {
        type: Number,
        required: true
    },
    baseSalary: {
        type: Number,
        required: true,
        min: 0
    },
    standardWorkDays: {
        type: Number,
        default: 26
    },
    actualWorkDays: {
        type: Number,
        default: 26,
        min: 0
    },
    paidLeaveDays: {
        type: Number,
        default: 0
    },
    unpaidLeaveDays: {
        type: Number,
        default: 0
    },
    allowances: {
        position: { type: Number, default: 0 },
        lunch: { type: Number, default: 0 },
        other: { type: Number, default: 0 }
    },
    deductions: {
        insurance: { type: Number, default: 0 },
        advancePayment: { type: Number, default: 0 },
        other: { type: Number, default: 0 }
    },
    grossSalary: {
        type: Number,
        default: 0
    },
    netSalary: {
        type: Number,
        required: true,
        default: 0
    },
    status: {
        type: String,
        enum: ['draft', 'confirmed', 'paid'],
        default: 'draft'
    },
    paidAt: Date,
    note: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

PayrollSchema.index({ employeeId: 1, month: 1, year: 1 }, { unique: true });
PayrollSchema.index({ month: 1, year: 1 });
PayrollSchema.index({ status: 1 });

module.exports = mongoose.model('Payroll', PayrollSchema);
