const mongoose = require('mongoose');

const ChatMessageSchema = new mongoose.Schema({
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    readAt: { type: Date, default: null },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null }
}, { timestamps: true });

ChatMessageSchema.index({ conversationId: 1, _id: -1 });
ChatMessageSchema.index({ conversationId: 1, senderId: 1, readAt: 1 });

module.exports = mongoose.model('ChatMessage', ChatMessageSchema);
