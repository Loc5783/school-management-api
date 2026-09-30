const mongoose = require('mongoose');

const ConversationSchema = new mongoose.Schema({
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    lastMessageText: { type: String, default: '' },
    lastMessageAt: { type: Date, default: null },
    archivedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

ConversationSchema.index({ parentId: 1, teacherId: 1, studentId: 1 }, { unique: true });
ConversationSchema.index({ parentId: 1, lastMessageAt: -1 });
ConversationSchema.index({ teacherId: 1, lastMessageAt: -1 });
ConversationSchema.index({ archivedBy: 1 });

module.exports = mongoose.model('Conversation', ConversationSchema);
