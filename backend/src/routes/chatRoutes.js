const express = require('express');
const auth = require('../middlewares/auth');
const roleCheck = require('../middlewares/roleCheck');
const controller = require('../controllers/chatController');

const router = express.Router();
router.use(auth, roleCheck(['parent', 'teacher']));
router.get('/contacts', controller.listContacts);
router.get('/unread', controller.listUnread);
router.get('/conversations', controller.listConversations);
router.post('/conversations', controller.openConversation);
router.get('/conversations/:id', controller.getConversation);
router.get('/conversations/:id/messages', controller.listMessages);
router.post('/conversations/:id/messages', controller.sendMessage);
router.patch('/conversations/:id/messages/:messageId', controller.updateMessage);
router.delete('/conversations/:id/messages/:messageId', controller.deleteMessage);
router.patch('/conversations/:id/read', controller.markRead);
router.patch('/conversations/:id/archive', controller.setConversationArchived);

module.exports = router;
