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
router.post('/items', roleCheck(['admin']), createItem);
router.get('/items', getItems);
router.put('/items/:id', roleCheck(['admin']), updateItem);
router.delete('/items/:id', roleCheck(['admin']), deleteItem);

// ===== Procurement Requests =====
router.post('/requests', createProcurementRequest);
router.get('/requests', getProcurementRequests);
router.put('/requests/:id/approve', roleCheck(['admin', 'principal']), approveProcurementRequest);

// ===== Purchase Orders =====
router.get('/suppliers', roleCheck(['admin', 'principal']), getProcurementSuppliers);
router.post('/orders', roleCheck(['admin']), createPurchaseOrder);
router.get('/orders', roleCheck(['admin', 'principal']), getPurchaseOrders);
router.put('/orders/:id/status', roleCheck(['admin']), updatePurchaseOrderStatus);
router.put('/orders/:id/details', roleCheck(['admin']), updatePurchaseOrderDetails);

// ===== Assets =====
router.post('/assets', roleCheck(['admin']), createAsset);
router.get('/assets', roleCheck(['admin', 'principal']), getAssets);
router.put('/assets/:id', roleCheck(['admin']), updateAsset);
router.delete('/assets/:id', roleCheck(['admin']), deleteAsset);
router.post('/assets/:id/maintenance', roleCheck(['admin']), addMaintenance);
router.post('/assets/:id/liquidate', roleCheck(['admin']), liquidateAsset);

module.exports = router;
