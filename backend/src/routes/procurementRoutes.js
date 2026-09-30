const express = require('express');
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
} = require('../controllers/procurementController');
const auth = require('../middlewares/auth');
const roleCheck = require('../middlewares/roleCheck');

const router = express.Router();

router.use(auth);

// ===== Items Master =====
router.post('/items', roleCheck(['admin', 'principal']), createItem);
router.get('/items', getItems);
router.put('/items/:id', roleCheck(['admin', 'principal']), updateItem);
router.delete('/items/:id', roleCheck(['admin', 'principal']), deleteItem);

// ===== Procurement Requests =====
router.post('/requests', createProcurementRequest);
router.get('/requests', getProcurementRequests);
router.put('/requests/:id/approve', roleCheck(['admin', 'principal']), approveProcurementRequest);

// ===== Purchase Orders =====
router.get('/suppliers', roleCheck(['admin', 'principal']), getProcurementSuppliers);
router.post('/orders', roleCheck(['admin', 'principal']), createPurchaseOrder);
router.get('/orders', roleCheck(['admin', 'principal']), getPurchaseOrders);
router.put('/orders/:id/status', roleCheck(['admin', 'principal']), updatePurchaseOrderStatus);
router.put('/orders/:id/details', roleCheck(['admin', 'principal']), updatePurchaseOrderDetails);

// ===== Assets =====
router.post('/assets', roleCheck(['admin', 'principal']), createAsset);
router.get('/assets', roleCheck(['admin', 'principal']), getAssets);
router.put('/assets/:id', roleCheck(['admin', 'principal']), updateAsset);
router.delete('/assets/:id', roleCheck(['admin', 'principal']), deleteAsset);
router.post('/assets/:id/maintenance', roleCheck(['admin', 'principal']), addMaintenance);
router.post('/assets/:id/liquidate', roleCheck(['admin', 'principal']), liquidateAsset);

module.exports = router;
