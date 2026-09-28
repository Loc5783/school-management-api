import api from './axiosConfig';

export const getInvoices = (params) => api.get('/finance/invoices', { params });
export const createClassInvoices = (data) => api.post('/finance/tuition/bulk', data);
export const addBulkInvoiceItem = (data) => api.post('/finance/tuition/bulk-additional-item', data);
export const recordPayment = (data) => api.post('/finance/payment', data, { headers: { 'Idempotency-Key': crypto.randomUUID() } });
export const getPayments = (invoiceId) => api.get(`/finance/payment/invoice/${invoiceId}`);
export const getDebtReport = (params) => api.get('/finance/debts', { params });
export const sendDebtReminders = (data) => api.post('/finance/debts/remind', data);
export const getFinanceReport = (period) => api.get('/reports/finance', { params: { period } });
export const cancelInvoice = (id, reason) => api.put(`/finance/tuition/cancel/${id}`, { reason });
export const adjustInvoice = (id, data) => api.post(`/finance/tuition/${id}/adjustments`, data);
export const getInvoiceAdjustments = (id) => api.get(`/finance/tuition/${id}/adjustments`);
export const getReceipt = (paymentId) => api.get(`/finance/receipt/${paymentId}`);
