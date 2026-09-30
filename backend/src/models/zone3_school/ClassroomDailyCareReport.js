const mongoose = require('mongoose');

const ClassroomDailyCareReportSchema = new mongoose.Schema({
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

ClassroomDailyCareReportSchema.index({ classroomId: 1, dateKey: 1 }, { unique: true });
ClassroomDailyCareReportSchema.index({ classroomId: 1, reportDate: -1 });
module.exports = mongoose.model('ClassroomDailyCareReport', ClassroomDailyCareReportSchema);
