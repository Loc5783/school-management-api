const mongoose = require('mongoose');

const ClassroomDailyCareReportSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true },
    className: { type: String, required: true, trim: true },
    reportDate: { type: Date, required: true },
    dateKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    activities: { type: String, trim: true, maxlength: 1000, default: '' },
    meals: { type: String, trim: true, maxlength: 1000, default: '' },
    sleep: { type: String, trim: true, maxlength: 1000, default: '' },
    health: { type: String, trim: true, maxlength: 1000, default: '' },
    studentNotes: [{
        studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
        studentName: { type: String, required: true, trim: true },
        note: { type: String, required: true, trim: true, maxlength: 1000 }
    }],
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recordedByName: { type: String, required: true, trim: true },
    sentAt: Date
}, { timestamps: true });

ClassroomDailyCareReportSchema.index(
    { tenantId: 1, classroomId: 1, dateKey: 1 },
    { name: 'tenantId_1_classroomId_1_dateKey_1_unique', unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } }
);
ClassroomDailyCareReportSchema.index(
    { classroomId: 1, dateKey: 1 },
    { name: 'legacy_classroomId_1_dateKey_1_unique', unique: true, partialFilterExpression: { tenantId: null } }
);
ClassroomDailyCareReportSchema.index({ tenantId: 1, classroomId: 1, reportDate: -1 });
ClassroomDailyCareReportSchema.index({ classroomId: 1, reportDate: -1 });
module.exports = mongoose.model('ClassroomDailyCareReport', ClassroomDailyCareReportSchema);
