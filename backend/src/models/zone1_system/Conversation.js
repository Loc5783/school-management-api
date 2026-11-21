const mongoose = require('mongoose');

const ConversationSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    lastMessageText: { type: String, default: '' },
    lastMessageAt: { type: Date, default: null },
    archivedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

// Compound multi-tenant unique index
ConversationSchema.index({ tenantId: 1, parentId: 1, teacherId: 1, studentId: 1 }, {
    unique: true,
    partialFilterExpression: { tenantId: { $type: 'objectId' } }
});

// Legacy backward-compatible unique index
ConversationSchema.index({ parentId: 1, teacherId: 1, studentId: 1 }, {
    unique: true,
    partialFilterExpression: { tenantId: null }
});

ConversationSchema.index({ tenantId: 1, parentId: 1, lastMessageAt: -1 });
ConversationSchema.index({ tenantId: 1, teacherId: 1, lastMessageAt: -1 });
ConversationSchema.index({ parentId: 1, lastMessageAt: -1 });
ConversationSchema.index({ teacherId: 1, lastMessageAt: -1 });
ConversationSchema.index({ archivedBy: 1 });

module.exports = mongoose.model('Conversation', ConversationSchema);
