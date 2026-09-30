const mongoose = require('mongoose');
const Classroom = require('../models/zone3_school/Classroom');
const Student = require('../models/zone3_school/Student');
const User = require('../models/zone1_system/User');
const Conversation = require('../models/zone1_system/Conversation');
const ChatMessage = require('../models/zone1_system/ChatMessage');
const { getLinkedStudentIds } = require('../services/studentAccessService');

const eligibleStatuses = ['enrolled', 'temporarily_absent'];
const pageOf = (query) => ({
    page: Math.max(1, Math.min(100000, Number.parseInt(query.page, 10) || 1)),
    limit: Math.max(1, Math.min(50, Number.parseInt(query.limit, 10) || 20))
});
const fail = (res, error, fallback) => {
    console.error('Chat request failed:', error);
    return res.status(500).json({ message: fallback });
};
const contact = (user, student) => ({
    userId: user._id,
    fullName: user.profile?.fullName || user.username,
    studentId: student._id,
    studentName: student.fullName,
    className: student.className || ''
});
const unreadCountsFor = async (conversations, userId) => {
    if (!conversations.length) return new Map();
    const counts = await ChatMessage.aggregate([
        { $match: { conversationId: { $in: conversations.map((item) => item._id) }, senderId: { $ne: userId }, readAt: null, deletedAt: null } },
        { $group: { _id: '$conversationId', count: { $sum: 1 }, latestAt: { $max: '$createdAt' } } }
    ]);
    return new Map(counts.map((item) => [String(item._id), item]));
};
const conversationView = (item, role, unreadCount = 0) => ({
    _id: item._id,
    otherUser: role === 'parent' ? item.teacherId : item.parentId,
    student: item.studentId,
    lastMessageText: item.lastMessageText,
    lastMessageAt: item.lastMessageAt,
    unreadCount,
    archived: (item.archivedBy || []).some((id) => String(id) === String(role === 'parent' ? item.parentId?._id || item.parentId : item.teacherId?._id || item.teacherId))
});
const messageView = (message) => {
    const raw = typeof message.toObject === 'function' ? message.toObject() : message;
    return { ...raw, body: raw.deletedAt ? '' : raw.body, deleted: Boolean(raw.deletedAt), edited: Boolean(raw.editedAt) };
};
const refreshConversationPreview = async (conversationId) => {
    const latest = await ChatMessage.findOne({ conversationId, deletedAt: null }).sort({ _id: -1 }).select('body createdAt').lean();
    await Conversation.updateOne({ _id: conversationId }, { $set: { lastMessageText: latest?.body || '', lastMessageAt: latest?.createdAt || null } });
};

// Recheck the live school relationship on every read and write. A former teacher
// or an unlinked parent must not retain access to conversation history.
const canChat = async (parentId, teacherId, studentId) => {
    const [parent, teacher, student] = await Promise.all([
        User.findOne({ _id: parentId, role: 'parent', status: 'active' }).select('parentInfo.studentIds').lean(),
        User.findOne({ _id: teacherId, role: 'teacher', status: 'active' }).select('_id').lean(),
        Student.findOne({ _id: studentId, status: { $in: eligibleStatuses } }).select('classroomId').lean()
    ]);
    if (!parent || !teacher || !student || !getLinkedStudentIds(parent).includes(String(student._id))) return false;
    return Boolean(await Classroom.exists({
        _id: student.classroomId,
        status: 'active',
        homeroomTeacherId: teacher._id
    }));
};

const getAccessibleConversation = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(400).json({ message: 'ID cuộc trò chuyện không hợp lệ' });
        return null;
    }
    const conversation = await Conversation.findById(req.params.id);
    const participantId = req.user.role === 'parent' ? conversation?.parentId : conversation?.teacherId;
    if (!conversation || String(participantId) !== String(req.user._id)
        || !await canChat(conversation.parentId, conversation.teacherId, conversation.studentId)) {
        res.status(404).json({ message: 'Không tìm thấy cuộc trò chuyện được phép truy cập' });
        return null;
    }
    return conversation;
};

const listContacts = async (req, res) => {
    try {
        const { page, limit } = pageOf(req.query);
        let contacts = [];
        if (req.user.role === 'parent') {
            const students = await Student.find({
                _id: { $in: getLinkedStudentIds(req.user) }, status: { $in: eligibleStatuses }
            }).select('_id fullName classroomId className').lean();
            const classrooms = await Classroom.find({
                _id: { $in: students.map((student) => student.classroomId) }, status: 'active'
            }).select('_id homeroomTeacherId').lean();
            const classroomById = new Map(classrooms.map((item) => [String(item._id), item]));
            const teacherIds = [...new Set(classrooms.map((item) => item.homeroomTeacherId).filter(Boolean).map(String))];
            const teachers = await User.find({ _id: { $in: teacherIds }, role: 'teacher', status: 'active' })
                .select('_id username profile.fullName').lean();
            const teacherById = new Map(teachers.map((item) => [String(item._id), item]));
            contacts = students.map((student) => {
                const teacherId = classroomById.get(String(student.classroomId))?.homeroomTeacherId;
                const teacher = teacherById.get(String(teacherId));
                return teacher ? contact(teacher, student) : null;
            }).filter(Boolean);
        } else {
            const classrooms = await Classroom.find({
                status: 'active', homeroomTeacherId: req.user._id
            }).select('_id').lean();
            const students = await Student.find({
                classroomId: { $in: classrooms.map((item) => item._id) }, status: { $in: eligibleStatuses }
            }).select('_id fullName className').lean();
            const studentById = new Map(students.map((item) => [String(item._id), item]));
            const parents = await User.find({
                role: 'parent', status: 'active', 'parentInfo.studentIds': { $in: students.map((item) => item._id) }
            }).select('_id username profile.fullName parentInfo.studentIds').lean();
            contacts = parents.flatMap((parent) => getLinkedStudentIds(parent)
                .map((id) => studentById.get(id)).filter(Boolean).map((student) => contact(parent, student)));
        }
        const search = String(req.query.search || '').trim().toLocaleLowerCase('vi').slice(0, 80);
        if (search) contacts = contacts.filter((item) =>
            item.fullName.toLocaleLowerCase('vi').includes(search)
            || item.studentName.toLocaleLowerCase('vi').includes(search)
            || item.className.toLocaleLowerCase('vi').includes(search));
        contacts.sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi') || a.studentName.localeCompare(b.studentName, 'vi'));
        const total = contacts.length;
        return res.json({ data: contacts.slice((page - 1) * limit, page * limit), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } catch (error) { return fail(res, error, 'Không thể tải danh bạ trò chuyện'); }
};

const listConversations = async (req, res) => {
    try {
        const { page, limit } = pageOf(req.query);
        const ownField = req.user.role === 'parent' ? 'parentId' : 'teacherId';
        const archived = req.query.archived === 'true';
        const archiveFilter = archived ? { archivedBy: req.user._id } : { archivedBy: { $ne: req.user._id } };
        const candidates = await Conversation.find({ [ownField]: req.user._id, ...archiveFilter })
            .populate('parentId', 'username profile.fullName')
            .populate('teacherId', 'username profile.fullName')
            .populate('studentId', 'fullName className')
            .sort({ lastMessageAt: -1, updatedAt: -1 });
        const accessible = [];
        for (const item of candidates) {
            if (item.parentId && item.teacherId && item.studentId
                && await canChat(item.parentId._id, item.teacherId._id, item.studentId._id)) {
                accessible.push(item);
            }
        }
        const selected = accessible.slice((page - 1) * limit, page * limit);
        const unread = await unreadCountsFor(selected, req.user._id);
        return res.json({ data: selected.map((item) => conversationView(item, req.user.role, unread.get(String(item._id))?.count || 0)), pagination: { page, limit, total: accessible.length, totalPages: Math.ceil(accessible.length / limit) } });
    } catch (error) { return fail(res, error, 'Không thể tải cuộc trò chuyện'); }
};

const listUnread = async (req, res) => {
    try {
        const ownField = req.user.role === 'parent' ? 'parentId' : 'teacherId';
        const conversations = await Conversation.find({ [ownField]: req.user._id, archivedBy: { $ne: req.user._id } }).select('_id parentId teacherId studentId');
        const unread = await unreadCountsFor(conversations, req.user._id);
        const candidates = conversations.filter((item) => unread.has(String(item._id)));
        const people = await User.find({ _id: { $in: candidates.map((item) => req.user.role === 'parent' ? item.teacherId : item.parentId) } })
            .select('_id username profile.fullName').lean();
        const students = await Student.find({ _id: { $in: candidates.map((item) => item.studentId) } })
            .select('_id fullName').lean();
        const personById = new Map(people.map((item) => [String(item._id), item]));
        const studentById = new Map(students.map((item) => [String(item._id), item]));
        const visible = [];
        for (const item of candidates) {
            if (!personById.has(String(req.user.role === 'parent' ? item.teacherId : item.parentId))
                || !studentById.has(String(item.studentId))
                || !await canChat(item.parentId, item.teacherId, item.studentId)) continue;
            const count = unread.get(String(item._id));
            const sender = personById.get(String(req.user.role === 'parent' ? item.teacherId : item.parentId));
            visible.push({ conversationId: item._id, count: count.count, latestAt: count.latestAt,
                senderName: sender.profile?.fullName || sender.username,
                studentName: studentById.get(String(item.studentId)).fullName });
        }
        visible.sort((a, b) => new Date(b.latestAt) - new Date(a.latestAt));
        return res.json({ data: visible.slice(0, 10), total: visible.reduce((sum, item) => sum + item.count, 0) });
    } catch (error) { return fail(res, error, 'Không thể tải tin nhắn chưa đọc'); }
};

const getConversation = async (req, res) => {
    try {
        const conversation = await getAccessibleConversation(req, res);
        if (!conversation) return;
        await conversation.populate('parentId', 'username profile.fullName');
        await conversation.populate('teacherId', 'username profile.fullName');
        await conversation.populate('studentId', 'fullName className');
        const unread = await unreadCountsFor([conversation], req.user._id);
        return res.json({ data: conversationView(conversation, req.user.role, unread.get(String(conversation._id))?.count || 0) });
    } catch (error) { return fail(res, error, 'Không thể tải cuộc trò chuyện'); }
};

const openConversation = async (req, res) => {
    try {
        const { userId, studentId } = req.body;
        if (!mongoose.isValidObjectId(userId) || !mongoose.isValidObjectId(studentId)) {
            return res.status(400).json({ message: 'ID người nhận hoặc học sinh không hợp lệ' });
        }
        const parentId = req.user.role === 'parent' ? req.user._id : userId;
        const teacherId = req.user.role === 'teacher' ? req.user._id : userId;
        if (!await canChat(parentId, teacherId, studentId)) {
            return res.status(403).json({ message: 'Bạn chỉ có thể trò chuyện với giáo viên/phụ huynh đang liên quan đến học sinh này' });
        }
        const conversation = await Conversation.findOneAndUpdate(
            { parentId, teacherId, studentId },
            { $setOnInsert: { parentId, teacherId, studentId } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        return res.json({ data: { _id: conversation._id } });
    } catch (error) {
        if (error.code === 11000) {
            const parentId = req.user.role === 'parent' ? req.user._id : req.body.userId;
            const teacherId = req.user.role === 'teacher' ? req.user._id : req.body.userId;
            const existing = await Conversation.findOne({ parentId, teacherId, studentId: req.body.studentId });
            if (existing) return res.json({ data: { _id: existing._id } });
        }
        return fail(res, error, 'Không thể mở cuộc trò chuyện');
    }
};

const listMessages = async (req, res) => {
    try {
        const conversation = await getAccessibleConversation(req, res);
        if (!conversation) return;
        const { limit } = pageOf(req.query);
        if (req.query.before && !mongoose.isValidObjectId(req.query.before)) return res.status(400).json({ message: 'Mốc tin nhắn không hợp lệ' });
        const filter = { conversationId: conversation._id };
        if (req.query.before) filter._id = { $lt: req.query.before };
        const messages = await ChatMessage.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
        return res.json({ data: messages.slice(0, limit).reverse().map(messageView), hasMore: messages.length > limit });
    } catch (error) { return fail(res, error, 'Không thể tải tin nhắn'); }
};

const sendMessage = async (req, res) => {
    try {
        const conversation = await getAccessibleConversation(req, res);
        if (!conversation) return;
        if (typeof req.body.body !== 'string') return res.status(400).json({ message: 'Nội dung tin nhắn không hợp lệ' });
        const body = req.body.body.trim();
        if (!body || body.length > 2000) return res.status(400).json({ message: 'Tin nhắn phải có từ 1 đến 2000 ký tự' });
        const message = await ChatMessage.create({ conversationId: conversation._id, senderId: req.user._id, body });
        await Conversation.updateOne({ _id: conversation._id }, { $set: { lastMessageText: body, lastMessageAt: message.createdAt }, $pull: { archivedBy: { $in: [conversation.parentId, conversation.teacherId] } } });
        return res.status(201).json({ data: messageView(message) });
    } catch (error) { return fail(res, error, 'Không thể gửi tin nhắn'); }
};

const updateMessage = async (req, res) => {
    try {
        const conversation = await getAccessibleConversation(req, res); if (!conversation) return;
        if (!mongoose.isValidObjectId(req.params.messageId)) return res.status(400).json({ message: 'ID tin nhắn không hợp lệ' });
        if (typeof req.body.body !== 'string') return res.status(400).json({ message: 'Nội dung tin nhắn không hợp lệ' });
        const body = req.body.body.trim();
        if (!body || body.length > 2000) return res.status(400).json({ message: 'Tin nhắn phải có từ 1 đến 2000 ký tự' });
        const message = await ChatMessage.findOneAndUpdate(
            { _id: req.params.messageId, conversationId: conversation._id, senderId: req.user._id, deletedAt: null },
            { $set: { body, editedAt: new Date() } }, { returnDocument: 'after', runValidators: true }
        );
        if (!message) return res.status(404).json({ message: 'Không tìm thấy tin nhắn của bạn để chỉnh sửa' });
        const latest = await ChatMessage.findOne({ conversationId: conversation._id, deletedAt: null }).sort({ _id: -1 }).select('_id');
        if (String(latest?._id) === String(message._id)) await Conversation.updateOne({ _id: conversation._id }, { $set: { lastMessageText: body } });
        return res.json({ success: true, data: messageView(message) });
    } catch (error) { return fail(res, error, 'Không thể chỉnh sửa tin nhắn'); }
};

const deleteMessage = async (req, res) => {
    try {
        const conversation = await getAccessibleConversation(req, res); if (!conversation) return;
        if (!mongoose.isValidObjectId(req.params.messageId)) return res.status(400).json({ message: 'ID tin nhắn không hợp lệ' });
        const message = await ChatMessage.findOneAndUpdate(
            { _id: req.params.messageId, conversationId: conversation._id, senderId: req.user._id, deletedAt: null },
            { $set: { deletedAt: new Date(), readAt: new Date() } }, { returnDocument: 'after' }
        );
        if (!message) return res.status(404).json({ message: 'Không tìm thấy tin nhắn của bạn để xóa' });
        await refreshConversationPreview(conversation._id);
        return res.json({ success: true, data: messageView(message) });
    } catch (error) { return fail(res, error, 'Không thể xóa tin nhắn'); }
};

const setConversationArchived = async (req, res) => {
    try {
        const conversation = await getAccessibleConversation(req, res); if (!conversation) return;
        const archived = req.body.archived !== false;
        await Conversation.updateOne({ _id: conversation._id }, archived
            ? { $addToSet: { archivedBy: req.user._id } }
            : { $pull: { archivedBy: req.user._id } });
        return res.json({ success: true, archived, message: archived ? 'Đã lưu trữ cuộc trò chuyện' : 'Đã khôi phục cuộc trò chuyện' });
    } catch (error) { return fail(res, error, 'Không thể thay đổi trạng thái lưu trữ'); }
};

const markRead = async (req, res) => {
    try {
        const conversation = await getAccessibleConversation(req, res);
        if (!conversation) return;
        if (req.body?.upTo && !mongoose.isValidObjectId(req.body.upTo)) {
            return res.status(400).json({ message: 'Mốc tin nhắn không hợp lệ' });
        }
        const filter = { conversationId: conversation._id, senderId: { $ne: req.user._id }, readAt: null };
        if (req.body?.upTo) filter._id = { $lte: req.body.upTo };
        await ChatMessage.updateMany(filter, { $set: { readAt: new Date() } });
        const unreadCount = await ChatMessage.countDocuments({ conversationId: conversation._id, senderId: { $ne: req.user._id }, readAt: null });
        return res.json({ success: true, unreadCount });
    } catch (error) { return fail(res, error, 'Không thể đánh dấu đã đọc'); }
};

module.exports = { listContacts, listUnread, getConversation, listConversations, openConversation, listMessages, sendMessage, updateMessage, deleteMessage, setConversationArchived, markRead };
