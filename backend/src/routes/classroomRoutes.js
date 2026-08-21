const express = require('express');
const {
    createClassroom,
    getAllClassrooms,
    getClassroomById,
    updateClassroom,
    deleteClassroom
} = require('../controllers/classroomController');
const auth = require('../middlewares/auth');
const roleCheck = require('../middlewares/roleCheck');

const router = express.Router();

// Tất cả API đều yêu cầu xác thực
router.use(auth);

// Chỉ admin và principal mới được tạo/sửa/xóa lớp
router.post('/', roleCheck(['admin', 'principal']), createClassroom);
router.get('/', getAllClassrooms);
router.get('/:id', getClassroomById);
router.put('/:id', roleCheck(['admin', 'principal']), updateClassroom);
router.delete('/:id', roleCheck(['admin', 'principal']), deleteClassroom);

module.exports = router;