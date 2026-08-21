const mongoose = require('mongoose');

const AttendanceRecordSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    employeeName: {
        type: String,
        required: true
    },
    workDate: {
        type: Date,
        required: true
    },
    checkInTime: {
        type: Date,
        required: true
    },
    checkOutTime: Date,
    workday: {
        type: Number,
        default: 1
    },
    status: {
        type: String,
        enum: ['present', 'incomplete'],
        default: 'present'
    },
    source: {
        type: String,
        enum: ['manual', 'correction'],
        default: 'manual'
    },
    correctionRequestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TimekeepingCorrectionRequest'
    },
    note: String
}, { timestamps: true });

// Một nhân viên chỉ có tối đa một công cho mỗi ngày.
AttendanceRecordSchema.index({ userId: 1, workDate: 1 }, { unique: true });

module.exports = mongoose.model('AttendanceRecord', AttendanceRecordSchema);
