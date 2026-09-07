import api from './axiosConfig';

export const getWeeklyMenus = (params) => api.get('/nutrition/menus', { params });
export const getMenuById = (id) => api.get(`/nutrition/menus/${id}`);
export const getClassroomDietaryAlerts = (classroomId) => api.get(`/nutrition/classrooms/${classroomId}/dietary-alerts`);
export const createMenu = (data) => api.post('/nutrition/menus', data);
export const updateMenu = (id, data) => api.put(`/nutrition/menus/${id}`, data);
export const cloneMenu = (data) => api.post('/nutrition/menus/clone', data);
export const checkMenuAllergies = (data) => api.post('/nutrition/menus/check-allergies', data);

export const getDishes = (params) => api.get('/nutrition/dishes', { params });
export const createDish = (data) => api.post('/nutrition/dishes', data);
export const updateDish = (id, data) => api.put(`/nutrition/dishes/${id}`, data);
export const deleteDish = (id) => api.delete(`/nutrition/dishes/${id}`);

export const getIngredients = (params) => api.get('/nutrition/ingredients', { params });
export const createIngredient = (data) => api.post('/nutrition/ingredients', data);
export const updateIngredient = (id, data) => api.put(`/nutrition/ingredients/${id}`, data);
export const deleteIngredient = (id) => api.delete(`/nutrition/ingredients/${id}`);

export const getInventory = () => api.get('/nutrition/inventory');
export const importInventoryStock = (data) => api.post('/nutrition/inventory/import', data);
export const exportInventoryStock = (data) => api.post('/nutrition/inventory/export', data);
export const disposeInventoryLot = (id, data) => api.post(`/nutrition/inventory/${id}/dispose`, data);
export const returnUnusedFood = (id, data) => api.post(`/nutrition/inventory/${id}/return`, data);
export const reconcileInventoryLot = (id, data) => api.post(`/nutrition/inventory/${id}/reconcile`, data);
export const getInventoryReconciliations = () => api.get('/nutrition/inventory/reconciliations');
export const getInventoryAlerts = () => api.get('/nutrition/inventory/alerts');
export const getInventoryTransactions = (params) => api.get('/nutrition/inventory/transactions', { params });

export const getSuppliers = () => api.get('/nutrition/suppliers');
export const createSupplier = (data) => api.post('/nutrition/suppliers', data);

export const getEquipments = () => api.get('/nutrition/equipment');
export const createEquipment = (data) => api.post('/nutrition/equipment', data);
export const logEquipmentMaintenance = (id, data) => api.post(`/nutrition/equipment/${id}/maintenance`, data);

export const getKitchenStaff = () => api.get('/nutrition/staff');
export const createKitchenStaff = (data) => api.post('/nutrition/staff', data);

export const getFoodSamples = () => api.get('/nutrition/food-samples');
export const createFoodSample = (data) => api.post('/nutrition/food-samples', data);
export const disposeFoodSample = (id, data) => api.put(`/nutrition/food-samples/${id}/dispose`, data);

export const getFoodInspections = () => api.get('/nutrition/food-inspections');
export const createFoodInspection = (data) => api.post('/nutrition/food-inspections', data);

export const getDailyMealFinancials = (date) => api.get('/nutrition/financials/daily', { params: { date } });
export const getKitchenRequests = (params) => api.get('/nutrition/requests', { params });
export const createKitchenRequest = (data) => api.post('/nutrition/requests', data);
export const approveKitchenRequest = (id, data) => api.put(`/nutrition/requests/${id}/approve`, data);
