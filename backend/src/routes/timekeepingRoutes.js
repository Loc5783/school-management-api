const express = require('express');
const { manualCheckIn, createCorrectionRequest, getMyTimekeeping } = require('../controllers/timekeepingController');
const auth = require('../middlewares/auth');
const roleCheck = require('../middlewares/roleCheck');

const router = express.Router();
const employeeRoles = ['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard'];

router.use(auth);
router.post('/check-in', roleCheck(employeeRoles), manualCheckIn);
router.post('/corrections', roleCheck(employeeRoles), createCorrectionRequest);
router.get('/me', roleCheck(employeeRoles), getMyTimekeeping);

module.exports = router;
