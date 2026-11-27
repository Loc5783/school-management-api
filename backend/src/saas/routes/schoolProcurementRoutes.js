'use strict';

const express = require('express');
const router = express.Router();
const schoolAuthMiddleware = require('../middlewares/schoolAuthMiddleware');
const roleCheck = require('../../middlewares/roleCheck');
const {
  createItem,
  getItems,
  updateItem,
  deleteItem,
  createProcurementRequest,
  getProcurementRequests,
  approveProcurementRequest,
  createPurchaseOrder,
  getPurchaseOrders,
  updatePurchaseOrderStatus,
  updatePurchaseOrderDetails,
  getProcurementSuppliers,
  createAsset,
  getAssets,
  updateAsset,
  deleteAsset,
  addMaintenance,
  liquidateAsset
} = require('../../controllers/procurementController');
const { getRequestSaasMode, isProcurementAllowed } = require('../utils/saasMode');

// Defense-in-depth: Procurement module gating
router.use((req, res, next) => {
  const saasMode = getRequestSaasMode(req);
  if (!isProcurementAllowed(saasMode)) {
    return next('router');
  }
  next();
});

router.use(schoolAuthMiddleware);

// Items Master
router.post('/items', roleCheck(['admin', 'principal']), createItem);
router.get('/items', getItems);
router.put('/items/:id', roleCheck(['admin', 'principal']), updateItem);
router.delete('/items/:id', roleCheck(['admin']), deleteItem);

// Procurement Requests
router.post('/requests', roleCheck(['admin', 'principal', 'teacher', 'accountant', 'chef']), createProcurementRequest);
router.get('/requests', getProcurementRequests);
router.put('/requests/:id/approve', roleCheck(['admin', 'principal']), approveProcurementRequest);

// Purchase Orders & Suppliers
router.get('/suppliers', roleCheck(['admin', 'principal', 'accountant']), getProcurementSuppliers);
router.post('/orders', roleCheck(['admin', 'principal', 'accountant']), createPurchaseOrder);
router.get('/orders', roleCheck(['admin', 'principal', 'accountant']), getPurchaseOrders);
router.put('/orders/:id/status', roleCheck(['admin', 'principal', 'accountant']), updatePurchaseOrderStatus);
router.put('/orders/:id/details', roleCheck(['admin', 'principal', 'accountant']), updatePurchaseOrderDetails);

// Assets
router.post('/assets', roleCheck(['admin', 'principal']), createAsset);
router.get('/assets', roleCheck(['admin', 'principal', 'accountant', 'teacher']), getAssets);
router.put('/assets/:id', roleCheck(['admin', 'principal']), updateAsset);
router.delete('/assets/:id', roleCheck(['admin']), deleteAsset);
router.post('/assets/:id/maintenance', roleCheck(['admin', 'principal']), addMaintenance);
router.post('/assets/:id/liquidate', roleCheck(['admin', 'principal']), liquidateAsset);

module.exports = router;
