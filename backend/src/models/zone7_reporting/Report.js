const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
    reportType: {
        type: String,
        enum: ['student', 'attendance', 'finance', 'hr', 'class'],
        required: true
    },
    period: {
        type: String,
        enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'],
        required: true
    },
    periodValue: {
        type: String,
        required: true // e.g., '2026-08-20', '08-2026', 'Q3-2026'
    },
    data: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    generatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    generatedByName: {
        type: String,
        required: true
    },
    generatedAt: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['draft', 'published'],
        default: 'draft'
    },
    filePath: String,
    note: String
}, {
    timestamps: true
});

ReportSchema.index({ reportType: 1, period: 1, periodValue: 1 });
ReportSchema.index({ generatedBy: 1 });
ReportSchema.index({ generatedAt: -1 });

module.exports = mongoose.model('Report', ReportSchema);