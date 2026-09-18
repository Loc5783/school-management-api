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
// Phụ huynh là dữ liệu nhạy cảm của học sinh, HR không duyệt hoặc liên kết phụ huynh.
router.get('/parents', roleCheck(['admin', 'principal']), listParents);
router.patch('/parents/:id/students', roleCheck(['admin', 'principal']), linkParentStudents);
router.patch('/parents/:id/status', roleCheck(['admin', 'principal']), updateParentStatus);
// HR được quản lý tài khoản nhân sự nhưng không được tạo/sửa tài khoản Hiệu trưởng.
router.get('/accounts', roleCheck(['admin', 'principal', 'hr']), listInternalAccounts);
router.post('/accounts', roleCheck(['admin', 'principal', 'hr']), createInternalAccount);
router.patch('/accounts/:id', roleCheck(['admin', 'principal', 'hr']), updateInternalAccount);
router.patch('/accounts/:id/role', roleCheck(['admin', 'principal', 'hr']), updateInternalAccountRole);
router.delete('/accounts/:id', roleCheck(['admin', 'principal', 'hr']), deactivateInternalAccount);

module.exports = router;
