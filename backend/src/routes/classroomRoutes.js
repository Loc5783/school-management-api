const express = require('express');
const {
  createClassroom,
  getAllClassrooms,
  getClassroomById,
  updateClassroom,
  assignHomeroomTeacher,
  deleteClassroom
} = require('../controllers/classroomController');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/checkPermission');
const roleCheck = require('../middlewares/roleCheck');

const router = express.Router();

router.use(auth);

router.post('/', roleCheck(['admin']), createClassroom);
router.get('/', roleCheck(['admin', 'principal', 'teacher']), getAllClassrooms);
router.get('/:id', roleCheck(['admin', 'principal', 'teacher']), getClassroomById);
router.put('/:id', roleCheck(['admin']), updateClassroom);
router.put('/:id/homeroom-teacher', roleCheck(['admin', 'hr']), assignHomeroomTeacher);
router.delete('/:id', roleCheck(['admin']), deleteClassroom);

module.exports = router;
