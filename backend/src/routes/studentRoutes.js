const express = require('express');
const {
    createStudent,
    getAllStudents,
    getStudentById,
    updateStudent,
    changeStudentStatus,
    deleteStudent,
    getDailyReports,
    saveDailyReport
} = require('../controllers/studentController');
const auth = require('../middlewares/auth');
const roleCheck = require('../middlewares/roleCheck');

const router = express.Router();

router.use(auth);

router.post('/', roleCheck(['admin', 'principal', 'teacher']), createStudent);
router.get('/', getAllStudents);
router.get('/:id/daily-reports', roleCheck(['admin', 'principal', 'teacher', 'parent']), getDailyReports);
router.put('/:id/daily-reports', roleCheck(['admin', 'principal', 'teacher']), saveDailyReport);
router.get('/:id', getStudentById);
router.put('/:id', roleCheck(['admin', 'principal', 'teacher', 'parent']), updateStudent);
router.patch('/:id/status', roleCheck(['admin', 'principal']), changeStudentStatus);
router.delete('/:id', roleCheck(['admin', 'principal']), deleteStudent);

module.exports = router;
