'use strict';

const express = require('express');
const router = express.Router();
const schoolAuthMiddleware = require('../middlewares/schoolAuthMiddleware');
const roleCheck = require('../../middlewares/roleCheck');
const {
  createRequest,
  listRequests,
  reviewRequest
} = require('../../controllers/studentProfileChangeRequestController');
const { getRequestSaasMode, isFeedbackAllowed } = require('../utils/saasMode');

// Defense-in-depth: Profile Change Request module gating
router.use((req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isFeedbackAllowed(saasMode)) {
    return next('router');
  }
  next();
});

router.use(schoolAuthMiddleware);

router.post('/', roleCheck(['parent']), createRequest);
router.get('/', roleCheck(['parent', 'admin', 'principal']), listRequests);
router.patch('/:id/review', roleCheck(['admin', 'principal']), reviewRequest);
router.put('/:id/review', roleCheck(['admin', 'principal']), reviewRequest);

module.exports = router;
