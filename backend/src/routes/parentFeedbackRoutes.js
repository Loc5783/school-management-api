const express = require('express'); const auth = require('../middlewares/auth'); const roleCheck = require('../middlewares/roleCheck'); const controller = require('../controllers/parentFeedbackController');
const router = express.Router(); router.use(auth);
router.post('/', roleCheck(['parent']), controller.createFeedback);
router.get('/', roleCheck(['parent', 'admin', 'principal']), controller.listFeedback);
router.patch('/:id/respond', roleCheck(['admin', 'principal']), controller.respondFeedback);
module.exports = router;
