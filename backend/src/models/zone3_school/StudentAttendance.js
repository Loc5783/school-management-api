const mongoose = require('mongoose');

const StudentAttendanceSchema = new mongoose.Schema({
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true
    },
    studentName: {
        type: String,
        required: true
    },
    classroomId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Classroom',
        required: true
    },
    className: {
        type: String,
        required: true
    },
    attendDate: {
        type: Date,
        required: true,
        default: () => new Date().setHours(0, 0, 0, 0)
    },
    status: {
        type: String,
        enum: ['present', 'absent', 'late', 'absent_permission'],
        default: 'present'
    },
    checkInTime: Date,
    checkOutTime: Date,
    attendanceMethod: {
        type: String,
        enum: ['manual', 'card', 'face'],
        default: 'manual'
    },
    pickerName: String,   // Tên người đón (nếu có)
    recordedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    recordedByName: {
        type: String,
        required: true
    },
    note: String
}, {
    timestamps: true
});

// Indexes để truy vấn nhanh
StudentAttendanceSchema.index({ studentId: 1, attendDate: 1 });
StudentAttendanceSchema.index({ classroomId: 1, attendDate: 1 });
StudentAttendanceSchema.index({ attendDate: 1 });

module.exports = mongoose.model('StudentAttendance', StudentAttendanceSchema);
