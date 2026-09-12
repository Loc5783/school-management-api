import api from './axiosConfig';

// ===== Tài sản & Thiết bị =====
export const getAssets = (params) => api.get('/procurement/assets', { params });
export const createAsset = (data) => api.post('/procurement/assets', data);
export const updateAsset = (id, data) => api.put(`/procurement/assets/${id}`, data);
export const deleteAsset = (id) => api.delete(`/procurement/assets/${id}`);
export const addAssetMaintenance = (id, data) => api.post(`/procurement/assets/${id}/maintenance`, data);
export const liquidateAsset = (id, data) => api.post(`/procurement/assets/${id}/liquidate`, data);

// ===== Danh mục mặt hàng =====
export const getProcurementItems = (params) => api.get('/procurement/items', { params });
export const createProcurementItem = (data) => api.post('/procurement/items', data);

// ===== Đề xuất mua sắm =====
export const getProcurementRequests = (params) => api.get('/procurement/requests', { params });
export const createProcurementRequest = (data) => api.post('/procurement/requests', data);
export const approveProcurementRequest = (id, data) => api.put(`/procurement/requests/${id}/approve`, data);

// ===== Đơn đặt hàng =====
export const getPurchaseOrders = (params) => api.get('/procurement/orders', { params });
export const createPurchaseOrder = (data) => api.post('/procurement/orders', data);
export const updatePurchaseOrderStatus = (id, data) => api.put(`/procurement/orders/${id}/status`, data);
