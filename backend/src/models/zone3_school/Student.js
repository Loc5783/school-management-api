const mongoose = require('mongoose');

const StudentStatusHistorySchema = new mongoose.Schema({
    fromStatus: String,
    toStatus: {
        type: String,
        enum: ['pending_admission', 'enrolled', 'temporarily_absent', 'withdrawn', 'transferred', 'graduated'],
        required: true
    },
    reason: { type: String, trim: true, maxlength: 500, default: '' },
    effectiveDate: { type: Date, required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    changedByName: { type: String, required: true },
    changedAt: { type: Date, default: Date.now, required: true }
}, { _id: false });

const StudentSchema = new mongoose.Schema({
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tenant'
    },
    studentCode: {
        type: String,
        trim: true,
        uppercase: true,
        required: true,
        immutable: false,
        match: /^[A-Z0-9_-]{1,30}$/
    },
    // Mã định danh cá nhân / mã Bộ GD&ĐT của học sinh (tùy chọn, phục vụ quản lý hồ sơ liên thông)
    identityCode: {
        type: String,
        trim: true,
        uppercase: true,
        maxlength: 40,
        default: ''
    },
    // Mã số thẻ Bảo hiểm Y tế (BHYT) của trẻ
    healthInsuranceCode: {
        type: String,
        trim: true,
        uppercase: true,
        maxlength: 30,
        default: ''
    },
    // Nhóm máu phục vụ sơ cấp cứu và hồ sơ y tế học đường
    bloodType: {
        type: String,
        trim: true,
        enum: ['', 'A', 'B', 'AB', 'O', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
        default: ''
    },
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
    nationality: { type: String, trim: true, default: 'Việt Nam' },
    ethnicity: { type: String, trim: true, default: '' },
    birthPlace: { type: String, trim: true, default: '' },
    avatar: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, maxlength: 2000, default: '' },
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
        uppercase: true
    },
    faceProfileId: {
        type: String,
        trim: true
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
        vehicleType: { type: String, trim: true, maxlength: 80, default: '' },
        vehiclePlate: { type: String, trim: true, uppercase: true, maxlength: 20, default: '' },
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
    // Sổ theo dõi tiêm chủng của học sinh
    vaccinations: {
        type: [{
            vaccineName: { type: String, required: true, trim: true, maxlength: 150 },
            doseNumber: { type: Number, min: 1, max: 20, default: 1 },
            vaccinatedDate: { type: Date },
            status: {
                type: String,
                enum: ['completed', 'scheduled', 'missed'],
                default: 'completed'
            },
            facility: { type: String, trim: true, maxlength: 150, default: '' },
            note: { type: String, trim: true, maxlength: 500, default: '' },
            recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            recordedByName: { type: String, default: '' },
            recordedAt: { type: Date, default: Date.now }
        }],
        default: []
    },
    // Biểu đồ / Sổ theo dõi cân nặng & chiều cao định kỳ theo tháng (YYYY-MM)
    growthRecords: {
        type: [{
            month: {
                type: String,
                required: true,
                trim: true,
                match: /^\d{4}-(0[1-9]|1[0-2])$/
            },
            measuredAt: { type: Date, default: Date.now },
            weightKg: { type: Number, required: true, min: 1, max: 120 },
            heightCm: { type: Number, required: true, min: 30, max: 200 },
            bmi: { type: Number, min: 5, max: 60 },
            nutritionStatus: { type: String, trim: true, maxlength: 80, default: 'Bình thường' },
            note: { type: String, trim: true, maxlength: 500, default: '' },
            recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            recordedByName: { type: String, default: '' }
        }],
        default: []
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
    admissionDate: {
        type: Date
    },
    exitDate: {
        type: Date
    },
    status: {
        type: String,
        enum: ['pending_admission', 'enrolled', 'temporarily_absent', 'withdrawn', 'transferred', 'graduated'],
        default: 'enrolled'
    },
    statusHistory: {
        type: [StudentStatusHistorySchema],
        default: []
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
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
StudentSchema.index({ tenantId: 1, identityCode: 1 });
// Multi-tenant studentCode unique index
StudentSchema.index({ tenantId: 1, studentCode: 1 }, {
    unique: true,
    partialFilterExpression: { tenantId: { $type: 'objectId' } }
});
// Legacy backward compatibility unique index
StudentSchema.index({ studentCode: 1 }, {
    unique: true,
    partialFilterExpression: { tenantId: null }
});

// Multi-tenant attendanceCardId unique index
StudentSchema.index({ tenantId: 1, attendanceCardId: 1 }, {
    unique: true,
    partialFilterExpression: { tenantId: { $type: 'objectId' }, attendanceCardId: { $type: 'string' } }
});
StudentSchema.index({ attendanceCardId: 1 }, {
    unique: true,
    partialFilterExpression: { tenantId: null, attendanceCardId: { $type: 'string' } }
});

// Multi-tenant faceProfileId unique index
StudentSchema.index({ tenantId: 1, faceProfileId: 1 }, {
    unique: true,
    partialFilterExpression: { tenantId: { $type: 'objectId' }, faceProfileId: { $type: 'string' } }
});
StudentSchema.index({ faceProfileId: 1 }, {
    unique: true,
    partialFilterExpression: { tenantId: null, faceProfileId: { $type: 'string' } }
});

StudentSchema.index({ tenantId: 1, classroomId: 1, status: 1 });
StudentSchema.index({ classroomId: 1, status: 1, fullName: 1 });

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
    if (!this.admissionDate && this.enrollmentDate) this.admissionDate = this.enrollmentDate;
});

module.exports = mongoose.model('Student', StudentSchema);
