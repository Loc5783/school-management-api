'use strict';

const express = require('express');
const router = express.Router();
const schoolAuthMiddleware = require('../middlewares/schoolAuthMiddleware');
const roleCheck = require('../../middlewares/roleCheck');
const {
  listContacts,
  listUnread,
  getConversation,
  listConversations,
  openConversation,
  listMessages,
  sendMessage,
  updateMessage,
  deleteMessage,
  setConversationArchived,
  markRead
} = require('../../controllers/chatController');
const { getRequestSaasMode, isChatAllowed } = require('../utils/saasMode');

// Defense-in-depth: Chat module gating
router.use((req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isChatAllowed(saasMode)) {
    return next('router');
  }
  next();
});

// Chat is strictly between parents and teachers
router.use(schoolAuthMiddleware, roleCheck(['parent', 'teacher']));

router.get('/contacts', listContacts);
router.get('/unread', listUnread);
router.get('/conversations', listConversations);
router.post('/conversations', openConversation);
router.get('/conversations/:id', getConversation);
router.get('/conversations/:id/messages', listMessages);
router.post('/conversations/:id/messages', sendMessage);
router.patch('/conversations/:id/messages/:messageId', updateMessage);
router.delete('/conversations/:id/messages/:messageId', deleteMessage);
router.patch('/conversations/:id/read', markRead);
router.patch('/conversations/:id/archive', setConversationArchived);

module.exports = router;
