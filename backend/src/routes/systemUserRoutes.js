const express = require('express');
const {
  linkParentStudents,
  listParents,
  updateParentStatus,
  listInternalAccounts,
  createInternalAccount,
  updateInternalAccountRole,
  updateInternalAccount,
  deactivateInternalAccount
} = require('../controllers/systemUserController');
const auth = require('../middlewares/auth');
const roleCheck = require('../middlewares/roleCheck');

const router = express.Router();

router.use(auth);
router.use(require('../middlewares/hrAccessAudit')('accounts'));
// Phụ huynh là dữ liệu nhạy cảm của học sinh, HR không duyệt hoặc liên kết phụ huynh.
router.get('/parents', roleCheck(['admin']), listParents);
router.patch('/parents/:id/students', roleCheck(['admin']), linkParentStudents);
router.patch('/parents/:id/status', roleCheck(['admin']), updateParentStatus);
// HR được quản lý tài khoản nhân sự nhưng không được tạo/sửa tài khoản Hiệu trưởng.
router.get('/accounts', roleCheck(['admin', 'hr']), listInternalAccounts);
router.post('/accounts', roleCheck(['admin', 'hr']), createInternalAccount);
router.patch('/accounts/:id', roleCheck(['admin', 'hr']), updateInternalAccount);
router.patch('/accounts/:id/role', roleCheck(['admin', 'hr']), updateInternalAccountRole);
router.delete('/accounts/:id', roleCheck(['admin', 'hr']), deactivateInternalAccount);

module.exports = router;
