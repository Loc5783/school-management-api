const express = require('express');
const {
    createStudent,
    getAllStudents,
    getStudentById,
    updateStudent,
    changeStudentStatus,
    deleteStudent,
    getDailyReports,
    saveDailyReport,
    downloadExcelTemplate,
    previewExcelImport,
    confirmExcelImport,
    transferStudentClassroom,
    getStudentTransferHistory
} = require('../controllers/studentController');
const auth = require('../middlewares/auth');
const roleCheck = require('../middlewares/roleCheck');
const multer = require('multer');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5 MB
    },
    fileFilter(req, file, cb) {
        if (
            file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            file.originalname.toLowerCase().endsWith('.xlsx')
        ) {
            cb(null, true);
        } else {
            cb(new Error('Chỉ chấp nhận tập tin định dạng Excel (.xlsx)'));
        }
    }
});

const handleUpload = (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ success: false, message: 'Dung lượng file vượt quá giới hạn 5 MB.' });
            }
            return res.status(400).json({ success: false, message: err.message || 'Lỗi tải tập tin lên.' });
        }
        next();
    });
};

const router = express.Router();

router.use(auth);

// Import Excel endpoints
router.get('/excel/template', roleCheck(['admin', 'teacher']), downloadExcelTemplate);
router.post('/excel/preview', roleCheck(['admin', 'teacher']), handleUpload, previewExcelImport);
router.post('/excel/confirm', roleCheck(['admin', 'teacher']), confirmExcelImport);

router.post('/', roleCheck(['admin', 'teacher']), createStudent);
router.get('/', getAllStudents);
router.get('/:id/daily-reports', roleCheck(['admin', 'principal', 'teacher', 'parent']), getDailyReports);
router.put('/:id/daily-reports', roleCheck(['admin', 'teacher']), saveDailyReport);
router.get('/:id', getStudentById);
router.put('/:id', roleCheck(['admin', 'teacher', 'parent']), updateStudent);
router.patch('/:id/status', roleCheck(['admin', 'principal']), changeStudentStatus);
router.post('/:id/transfer', roleCheck(['admin', 'hr', 'principal']), transferStudentClassroom);
router.get('/:id/transfer-history', roleCheck(['admin', 'hr', 'principal', 'teacher', 'parent']), getStudentTransferHistory);
router.delete('/:id', roleCheck(['admin']), deleteStudent);

module.exports = router;
