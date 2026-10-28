const express = require('express');
const auth = require('../middlewares/auth');
const roleCheck = require('../middlewares/roleCheck');
const controller = require('../controllers/parentTeacherEvaluationController');

const router = express.Router();
router.use(auth);

router.get('/context', roleCheck(['parent']), controller.getContext);
router.post('/', roleCheck(['parent']), controller.createEvaluation);
router.get('/mine', roleCheck(['parent']), controller.getMyEvaluations);
router.get('/periods', roleCheck(['admin', 'principal', 'hr', 'parent']), controller.getEvaluationPeriods);
router.post('/periods', roleCheck(['admin', 'principal', 'hr']), controller.createEvaluationPeriod);
router.patch('/periods/:id/status', roleCheck(['admin', 'principal', 'hr']), controller.togglePeriodStatus);
router.get('/', roleCheck(['admin', 'principal', 'hr']), controller.listEvaluations);

module.exports = router;
