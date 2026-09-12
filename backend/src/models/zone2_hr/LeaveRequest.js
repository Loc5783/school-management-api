const mongoose = require('mongoose');

const LeaveRequestSchema = new mongoose.Schema({
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
    leaveType: {
        type: String,
        enum: ['annual', 'sick', 'maternity', 'personal', 'unpaid', 'compensatory'],
        required: true,
        default: 'annual'
    },
    startDate: {
        type: Date,
        required: true
    },
    endDate: {
        type: Date,
        required: true
    },
    totalDays: {
        type: Number,
        required: true,
        min: 0.5
    },
    reason: {
        type: String,
        required: true,
        trim: true
    },
    substituteTeacherId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee'
    },
    substituteTeacherName: {
        type: String,
        default: ''
    },
    attachmentUrl: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedByName: {
        type: String,
        default: ''
    },
    approvedAt: Date,
    rejectionReason: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

LeaveRequestSchema.index({ employeeId: 1, status: 1 });
LeaveRequestSchema.index({ startDate: 1, endDate: 1 });
LeaveRequestSchema.index({ status: 1 });

module.exports = mongoose.model('LeaveRequest', LeaveRequestSchema);
