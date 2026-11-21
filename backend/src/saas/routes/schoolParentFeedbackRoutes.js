'use strict';

const express = require('express');
const router = express.Router();
const schoolAuthMiddleware = require('../middlewares/schoolAuthMiddleware');
const roleCheck = require('../../middlewares/roleCheck');
const {
  createFeedback,
  listFeedback,
  respondFeedback
} = require('../../controllers/parentFeedbackController');
const { getRequestSaasMode, isFeedbackAllowed } = require('../utils/saasMode');

// Defense-in-depth: Feedback module gating
router.use((req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isFeedbackAllowed(saasMode)) {
    return next('router');
  }
  next();
});

router.use(schoolAuthMiddleware);

router.post('/', roleCheck(['parent']), createFeedback);
router.get('/', roleCheck(['parent', 'admin', 'principal']), listFeedback);
router.patch('/:id/respond', roleCheck(['admin', 'principal']), respondFeedback);
router.put('/:id/respond', roleCheck(['admin', 'principal']), respondFeedback);

module.exports = router;
