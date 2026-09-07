const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const roleCheck = require('../middlewares/roleCheck');
const {
    // Menu
    getMenus,
    getMenuById,
    getClassroomDietaryAlerts,
    createMenu,
    updateMenu,
    submitMenuForApproval,
    approveMenu,
    returnMenuForRevision,
    archiveMenu,
    cloneMenu,
    checkAllergiesDryRun,
    // Dishes & Ingredients
    getDishes,
    createDish,
    updateDish,
    deleteDish,
    getIngredients,
    createIngredient,
    updateIngredient,
    deleteIngredient,
    // Inventory
    getInventoryList,
    importStock,
    exportStock,
    disposeInventoryLot,
    returnUnusedFood,
    reconcileInventoryLot,
    getInventoryReconciliations,
    getInventoryAlertsController,
    getTransactions,
    // Suppliers
    getSuppliers,
    createSupplier,
    updateSupplier,
    // Equipment
    getEquipments,
    createEquipment,
    logEquipmentMaintenance,
    // Staff
    getKitchenStaffList,
    createKitchenStaff,
    updateKitchenStaff,
    // Safety & Samples
    getFoodSamples,
    createFoodSample,
    disposeFoodSample,
    getFoodInspections,
    createFoodInspection,
    // Finance & Requests
    getDailyFinancialReport,
    getKitchenRequests,
    createKitchenRequest,
    approveKitchenRequest
} = require('../controllers/nutritionController');

router.use(auth);

// ===== THỰC ĐƠN TUẦN THEO LỚP & DỊ ỨNG =====
router.get('/menus', roleCheck(['admin', 'principal', 'chef', 'teacher', 'parent']), getMenus);
router.get('/classrooms/:id/dietary-alerts', roleCheck(['admin', 'principal', 'chef', 'teacher']), getClassroomDietaryAlerts);
router.get('/menus/:id', roleCheck(['admin', 'principal', 'chef', 'teacher', 'parent']), getMenuById);
router.post('/menus', roleCheck(['admin', 'principal', 'chef']), createMenu);
router.put('/menus/:id', roleCheck(['admin', 'principal', 'chef']), updateMenu);
router.post('/menus/:id/submit', roleCheck(['admin', 'principal', 'chef']), submitMenuForApproval);
router.post('/menus/:id/approve', roleCheck(['admin', 'principal']), approveMenu);
router.post('/menus/:id/return', roleCheck(['admin', 'principal']), returnMenuForRevision);
router.post('/menus/:id/archive', roleCheck(['admin', 'principal']), archiveMenu);
router.post('/menus/clone', roleCheck(['admin', 'principal', 'chef']), cloneMenu);
router.post('/menus/check-allergies', roleCheck(['admin', 'principal', 'chef', 'teacher']), checkAllergiesDryRun);

// ===== MÓN ĂN & NGUYÊN LIỆU =====
router.get('/dishes', roleCheck(['admin', 'principal', 'chef', 'teacher']), getDishes);
router.post('/dishes', roleCheck(['admin', 'principal', 'chef']), createDish);
router.put('/dishes/:id', roleCheck(['admin', 'principal', 'chef']), updateDish);
router.delete('/dishes/:id', roleCheck(['admin', 'principal', 'chef']), deleteDish);

router.get('/ingredients', roleCheck(['admin', 'principal', 'chef', 'accountant']), getIngredients);
router.post('/ingredients', roleCheck(['admin', 'principal', 'chef']), createIngredient);
router.put('/ingredients/:id', roleCheck(['admin', 'principal', 'chef']), updateIngredient);
router.delete('/ingredients/:id', roleCheck(['admin', 'principal', 'chef']), deleteIngredient);

// ===== KHO THỰC PHẨM & XUẤT NHẬP =====
router.get('/inventory', roleCheck(['admin', 'principal', 'chef', 'accountant']), getInventoryList);
router.post('/inventory/import', roleCheck(['admin', 'principal', 'chef', 'accountant']), importStock);
router.post('/inventory/export', roleCheck(['admin', 'principal', 'chef']), exportStock);
router.post('/inventory/:id/dispose', roleCheck(['admin', 'principal', 'chef']), disposeInventoryLot);
router.post('/inventory/:id/return', roleCheck(['admin', 'principal', 'chef']), returnUnusedFood);
router.post('/inventory/:id/reconcile', roleCheck(['admin', 'principal']), reconcileInventoryLot);
router.get('/inventory/reconciliations', roleCheck(['admin', 'principal']), getInventoryReconciliations);
router.get('/inventory/alerts', roleCheck(['admin', 'principal', 'chef', 'accountant']), getInventoryAlertsController);
router.get('/inventory/transactions', roleCheck(['admin', 'principal', 'chef', 'accountant']), getTransactions);

// ===== NHÀ CUNG CẤP =====
router.get('/suppliers', roleCheck(['admin', 'principal', 'chef', 'accountant']), getSuppliers);
router.post('/suppliers', roleCheck(['admin', 'principal', 'chef']), createSupplier);
router.put('/suppliers/:id', roleCheck(['admin', 'principal', 'chef']), updateSupplier);

// ===== THIẾT BỊ BẾP CHUNG =====
router.get('/equipment', roleCheck(['admin', 'principal', 'chef']), getEquipments);
router.post('/equipment', roleCheck(['admin', 'principal', 'chef']), createEquipment);
router.post('/equipment/:id/maintenance', roleCheck(['admin', 'principal', 'chef']), logEquipmentMaintenance);

// ===== NHÂN VIÊN NHÀ BẾP =====
router.get('/staff', roleCheck(['admin', 'principal', 'chef']), getKitchenStaffList);
router.post('/staff', roleCheck(['admin', 'principal', 'chef']), createKitchenStaff);
router.put('/staff/:id', roleCheck(['admin', 'principal', 'chef']), updateKitchenStaff);

// ===== AN TOÀN THỰC PHẨM: LƯU MẪU 24H & KIỂM THỰC 3 BƯỚC =====
router.get('/food-samples', roleCheck(['admin', 'principal', 'chef']), getFoodSamples);
router.post('/food-samples', roleCheck(['admin', 'principal', 'chef']), createFoodSample);
router.put('/food-samples/:id/dispose', roleCheck(['admin', 'principal', 'chef']), disposeFoodSample);

router.get('/food-inspections', roleCheck(['admin', 'principal', 'chef']), getFoodInspections);
router.post('/food-inspections', roleCheck(['admin', 'principal', 'chef']), createFoodInspection);

// ===== TÀI CHÍNH NHÀ ĂN & ĐỀ XUẤT MUA SẮM =====
router.get('/financials/daily', roleCheck(['admin', 'principal']), getDailyFinancialReport);
router.get('/requests', roleCheck(['admin', 'principal', 'accountant', 'chef']), getKitchenRequests);
router.post('/requests', roleCheck(['admin', 'principal', 'chef']), createKitchenRequest);
router.put('/requests/:id/approve', roleCheck(['admin', 'principal', 'accountant']), approveKitchenRequest);

module.exports = router;
