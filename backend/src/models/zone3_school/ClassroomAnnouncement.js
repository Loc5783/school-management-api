const mongoose = require('mongoose');

const ClassroomAnnouncementSchema = new mongoose.Schema({
    classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true, index: true },
    className: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    content: { type: String, required: true, trim: true, maxlength: 2000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true, trim: true },
    publishedAt: { type: Date, default: Date.now }
}, { timestamps: true });

ClassroomAnnouncementSchema.index({ classroomId: 1, publishedAt: -1 });
module.exports = mongoose.model('ClassroomAnnouncement', ClassroomAnnouncementSchema);
