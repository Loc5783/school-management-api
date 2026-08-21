const mongoose = require('mongoose');

const TimekeepingCorrectionRequestSchema = new mongoose.Schema({
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
    requestedCheckInTime: {
        type: String,
        required: true,
        match: /^([01]\d|2[0-3]):[0-5]\d$/
    },
    reason: {
        type: String,
        required: true,
        trim: true,
        maxlength: 500
    },
    status: {
        type: String,
        enum: ['pending', 'synced', 'rejected'],
        default: 'pending'
    },
    syncedAt: Date,
    attendanceRecordId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AttendanceRecord'
    }
}, { timestamps: true });

TimekeepingCorrectionRequestSchema.index({ userId: 1, workDate: 1, status: 1 });

module.exports = mongoose.model('TimekeepingCorrectionRequest', TimekeepingCorrectionRequestSchema);
