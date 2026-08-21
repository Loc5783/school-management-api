const mongoose = require('mongoose');

const StudentSchema = new mongoose.Schema({
    fullName: {
        type: String,
        required: true,
        trim: true
    },
    birthDate: {
        type: Date,
        required: true
    },
    gender: {
        type: String,
        enum: ['male', 'female'],
        required: true
    },
    address: String,
    classroomId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Classroom',
        required: true
    },
    className: {
        type: String,   // Lưu kèm để tránh JOIN
        default: ''
    },
    // Mã định danh dùng cho điểm danh tự động. Chỉ lưu mã tham chiếu,
    // không lưu dữ liệu sinh trắc học/khuôn mặt thô.
    attendanceCardId: {
        type: String,
        trim: true,
        uppercase: true,
        unique: true,
        sparse: true
    },
    faceProfileId: {
        type: String,
        trim: true,
        unique: true,
        sparse: true
    },
    schoolYear: {
        type: String,
        default: '2025-2026'
    },
    parents: [{
        fullName: {
            type: String,
            required: true
        },
        phone: {
            type: String,
            required: true
        },
        email: String,
        relationship: {
            type: String,
            enum: ['father', 'mother', 'guardian']
        },
        isPrimary: {
            type: Boolean,
            default: false
        }
    }],
    authorizedPickers: [{
        fullName: String,
        phone: String,
        relationship: String,
        identityCard: String,
        photoURL: String,
        isActive: {
            type: Boolean,
            default: true
        }
    }],
    allergies: [{
        allergen: String,
        severity: {
            type: String,
            enum: ['mild', 'moderate', 'severe'],
            default: 'moderate'
        },
        note: String
    }],
    disease: {
        name: String,
        description: String,
        medication: String,
        note: String
    },
    emergencyContact: {
        name: String,
        phone: String,
        relationship: String
    },
    enrollmentDate: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['enrolled', 'graduated', 'withdrawn', 'suspended'],
        default: 'enrolled'
    },
    dailyReports: {
        type: [{
            reportDate: {
                type: Date,
                default: Date.now
            },
            activities: String,
            meals: String,
            sleep: String,
            health: String,
            photos: [String],
            recordedBy: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User'
            },
            recordedByName: String,
            sentAt: Date
        }],
        default: []
    }
}, {
    timestamps: true
});

// Indexes
StudentSchema.index({ classroomId: 1 });
StudentSchema.index({ status: 1 });
StudentSchema.index({ fullName: 'text' });

// Middleware tự động gán className trước khi lưu
StudentSchema.pre('save', async function() {
    // Nếu có classroomId và chưa có className
    if (this.classroomId && !this.className) {
        // Lấy model Classroom
        const Classroom = mongoose.model('Classroom');
        // Tìm classroom
        const classroom = await Classroom.findById(this.classroomId);
        if (classroom) {
            this.className = classroom.name;
        }
    }
});

module.exports = mongoose.model('Student', StudentSchema);
