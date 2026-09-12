const express = require('express');
const auth = require('../middlewares/auth');
const roleCheck = require('../middlewares/roleCheck');
const { getMyNotifications, markRead, markAllRead, createNotification } = require('../controllers/notificationController');

const router = express.Router();
router.use(auth);
router.get('/', getMyNotifications);
router.patch('/read-all', markAllRead);
router.patch('/:id/read', markRead);
router.post('/', roleCheck(['admin', 'principal']), createNotification);
module.exports = router;
