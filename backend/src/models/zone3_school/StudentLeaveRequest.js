const mongoose = require('mongoose');

// Đơn xin nghỉ là chứng từ nghiệp vụ riêng. Bản ghi điểm danh chỉ được tạo khi
// đơn đã được duyệt, nhờ đó báo cáo không nhầm đơn đang chờ với một ngày nghỉ có phép.
const StudentLeaveRequestSchema = new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    studentName: { type: String, required: true, trim: true },
    classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true, index: true },
    className: { type: String, required: true, trim: true },
    requesterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    requesterName: { type: String, required: true, trim: true },
    startDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    endDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    reason: { type: String, required: true, trim: true, minlength: 5, maxlength: 1000 },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewerName: { type: String, trim: true, default: '' },
    reviewNote: { type: String, trim: true, maxlength: 500, default: '' },
    reviewedAt: { type: Date, default: null }
}, { timestamps: true });

StudentLeaveRequestSchema.index({ studentId: 1, startDate: 1, endDate: 1, status: 1 });
StudentLeaveRequestSchema.index({ classroomId: 1, status: 1, startDate: 1 });
StudentLeaveRequestSchema.index({ requesterId: 1, createdAt: -1 });

module.exports = mongoose.model('StudentLeaveRequest', StudentLeaveRequestSchema);
