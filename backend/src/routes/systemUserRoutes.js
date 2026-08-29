const express = require('express');
const { linkParentStudents, listParents, updateParentStatus } = require('../controllers/systemUserController');
const auth = require('../middlewares/auth');
const roleCheck = require('../middlewares/roleCheck');

const router = express.Router();

// Transitional gate: Giai đoạn C will replace this with explicit
// system.user permissions after role/permission migration.
router.use(auth, roleCheck(['admin', 'principal']));
router.get('/parents', listParents);
router.patch('/parents/:id/students', linkParentStudents);
router.patch('/parents/:id/status', updateParentStatus);

module.exports = router;
