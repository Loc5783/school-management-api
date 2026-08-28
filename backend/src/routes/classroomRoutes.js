const express = require('express');
const {
  createClassroom,
  getAllClassrooms,
  getClassroomById,
  updateClassroom,
  deleteClassroom
} = require('../controllers/classroomController');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/checkPermission');

const router = express.Router();

router.use(auth);

router.post('/', checkPermission('classroom.manage'), createClassroom);
router.get('/', checkPermission('classroom.read'), getAllClassrooms);
router.get('/:id', checkPermission('classroom.read'), getClassroomById);
router.put('/:id', checkPermission('classroom.manage'), updateClassroom);
router.delete('/:id', checkPermission('classroom.manage'), deleteClassroom);

module.exports = router;