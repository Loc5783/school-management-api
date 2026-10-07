const express = require('express');
const { ingestEvent } = require('../controllers/guardDeviceController');

const router = express.Router();
router.post('/:id/events', ingestEvent);
module.exports = router;
