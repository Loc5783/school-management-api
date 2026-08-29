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
    // Ngày học theo timezone của trường, dùng để chống tạo trùng một học sinh/ngày.
    // Không bắt buộc ở schema để dữ liệu lịch sử chưa migrate vẫn đọc được.
    attendanceDateKey: {
        type: String,
        trim: true,
        match: /^\d{4}-\d{2}-\d{2}$/
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
StudentAttendanceSchema.index(
    { studentId: 1, attendanceDateKey: 1 },
    { unique: true, partialFilterExpression: { attendanceDateKey: { $exists: true } } }
);
StudentAttendanceSchema.index({ classroomId: 1, attendDate: 1 });
StudentAttendanceSchema.index({ attendDate: 1 });

module.exports = mongoose.model('StudentAttendance', StudentAttendanceSchema);
