const mongoose = require('mongoose');

const ClassroomSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    fullName: {
        type: String,
        trim: true
    },
    ageGroup: {
        type: String,
        enum: ['3-4', '4-5', '5-6'],
        required: true
    },
    maxSize: {
        type: Number,
        default: 25
    },
    schoolYear: {
        type: String,
        default: '2025-2026'
    },
    status: {
        type: String,
        enum: ['active', 'archived'],
        default: 'active'
    },
    // Nhúng danh sách giáo viên (theo thiết kế)
    teachers: [{
        teacherId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        teacherName: String,
        role: {
            type: String,
            enum: ['homeroom', 'support', 'subject'],
            default: 'support'
        },
        assignedAt: {
            type: Date,
            default: Date.now
        }
    }],
    // Thống kê nhanh (tính toán định kỳ)
    statistics: {
        currentStudents: {
            type: Number,
            default: 0
        },
        male: {
            type: Number,
            default: 0
        },
        female: {
            type: Number,
            default: 0
        }
    }
}, {
    timestamps: true
});

// Index để tìm kiếm nhanh
ClassroomSchema.index({ name: 1 });
ClassroomSchema.index({ schoolYear: 1 });
ClassroomSchema.index({ status: 1 });

module.exports = mongoose.model('Classroom', ClassroomSchema);