const express = require('express');
const {
    createStudent,
    getAllStudents,
    getStudentById,
    updateStudent,
    deleteStudent
} = require('../controllers/studentController');
const auth = require('../middlewares/auth');
const roleCheck = require('../middlewares/roleCheck');

const router = express.Router();

router.use(auth);

router.post('/', roleCheck(['admin', 'principal', 'teacher']), createStudent);
router.get('/', getAllStudents);
router.get('/:id', getStudentById);
router.put('/:id', roleCheck(['admin', 'principal', 'teacher']), updateStudent);
router.delete('/:id', roleCheck(['admin', 'principal']), deleteStudent);

module.exports = router;