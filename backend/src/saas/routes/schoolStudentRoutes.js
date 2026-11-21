const express = require('express');
const router = express.Router();
const multer = require('multer');
const schoolAuthMiddleware = require('../middlewares/schoolAuthMiddleware');
const roleCheck = require('../../middlewares/roleCheck');
const {
  getAllStudents,
  getStudentById,
  createStudent,
  updateStudent,
  changeStudentStatus,
  deleteStudent,
  getDailyReports,
  saveDailyReport,
  downloadExcelTemplate,
  previewExcelImport,
  confirmExcelImport,
  getStudentTransferHistory,
  transferStudentClassroom
} = require('../../controllers/studentController');
const { isReservedStudentSegment } = require('../utils/reservedRoutes');
const {
  getRequestSaasMode,
  isReadModuleAllowed,
  isStudentTransferAllowed,
  isStudentMutationAllowed
} = require('../utils/saasMode');

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

// Defense-in-depth: Read modules are enabled only in approved phase1b, 1c, 1d, 1e
router.use((req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isReadModuleAllowed(saasMode)) {
    return next('router');
  }
  next();
});

const mutationGate = (req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isStudentMutationAllowed(saasMode)) {
    return next('router');
  }
  next();
};

// Excel template & import endpoints (mounted before router.param to avoid shadowing)
router.get('/excel/template', mutationGate, schoolAuthMiddleware, roleCheck(['admin', 'principal', 'teacher']), downloadExcelTemplate);
router.post('/excel/preview', mutationGate, schoolAuthMiddleware, roleCheck(['admin', 'principal', 'teacher']), handleUpload, previewExcelImport);
router.post('/excel/confirm', mutationGate, schoolAuthMiddleware, roleCheck(['admin', 'principal', 'teacher']), confirmExcelImport);

// Guard against route parameter shadowing for other routes
router.param('id', (req, res, next, id) => {
  if (isReservedStudentSegment(id)) {
    return next('router');
  }
  next();
});

// Approved read routes
router.get('/', schoolAuthMiddleware, getAllStudents);
router.get('/:id/daily-reports', schoolAuthMiddleware, roleCheck(['admin', 'principal', 'teacher', 'parent']), getDailyReports);
router.get('/:id/transfer-history', schoolAuthMiddleware, roleCheck(['admin', 'hr', 'principal', 'teacher', 'parent']), getStudentTransferHistory);

// Student transfer write endpoint
router.post('/:id/transfer', (req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isStudentTransferAllowed(saasMode)) {
    return next('router');
  }
  next();
}, schoolAuthMiddleware, roleCheck(['admin', 'hr', 'principal']), transferStudentClassroom);

// Student mutation endpoints
router.post('/', mutationGate, schoolAuthMiddleware, roleCheck(['admin', 'principal', 'teacher']), createStudent);
router.get('/:id', schoolAuthMiddleware, getStudentById);
router.put('/:id', mutationGate, schoolAuthMiddleware, roleCheck(['admin', 'principal', 'teacher', 'parent']), updateStudent);
router.patch('/:id/status', mutationGate, schoolAuthMiddleware, roleCheck(['admin', 'principal']), changeStudentStatus);
router.delete('/:id', mutationGate, schoolAuthMiddleware, roleCheck(['admin']), deleteStudent);
router.put('/:id/daily-reports', mutationGate, schoolAuthMiddleware, roleCheck(['admin', 'principal', 'teacher']), saveDailyReport);

module.exports = router;
