const express = require('express');
const router = express.Router();
const schoolAuthMiddleware = require('../middlewares/schoolAuthMiddleware');
const roleCheck = require('../../middlewares/roleCheck');
const {
  getAllClassrooms,
  getClassroomById,
  assignHomeroomTeacher,
  createClassroom,
  updateClassroom,
  deleteClassroom
} = require('../../controllers/classroomController');
const { isReservedClassroomSegment } = require('../utils/reservedRoutes');
const {
  getRequestSaasMode,
  isReadModuleAllowed,
  isHomeroomAssignmentAllowed,
  isStudentMutationAllowed
} = require('../utils/saasMode');

// Defense-in-depth: Read modules are enabled only in approved phase1b, 1c, 1d, 1e
router.use((req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isReadModuleAllowed(saasMode)) {
    return next('router');
  }
  next();
});

// Guard against route parameter shadowing:
router.param('id', (req, res, next, id) => {
  if (isReservedClassroomSegment(id)) {
    return next('router');
  }
  next();
});

// Approved 1B read routes for Classrooms
router.get('/', schoolAuthMiddleware, roleCheck(['admin', 'principal', 'teacher', 'hr']), getAllClassrooms);
router.get('/:id', schoolAuthMiddleware, roleCheck(['admin', 'principal', 'teacher', 'hr']), getClassroomById);

// Approved 1D route for homeroom teacher assignment
router.put('/:id/homeroom-teacher', (req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isHomeroomAssignmentAllowed(saasMode)) {
    return next('router');
  }
  next();
}, schoolAuthMiddleware, roleCheck(['admin', 'hr']), assignHomeroomTeacher);

// Mutation gating for Classroom write endpoints (POST, PUT, DELETE)
const mutationGate = (req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isStudentMutationAllowed(saasMode)) {
    return next('router');
  }
  next();
};

router.post('/', mutationGate, schoolAuthMiddleware, roleCheck(['admin', 'principal']), createClassroom);
router.put('/:id', mutationGate, schoolAuthMiddleware, roleCheck(['admin', 'principal']), updateClassroom);
router.delete('/:id', mutationGate, schoolAuthMiddleware, roleCheck(['admin']), deleteClassroom);

module.exports = router;
