import api from './axiosConfig';

export const getInvoices = (params) => api.get('/finance/invoices', { params });
export const createClassInvoices = (data) => api.post('/finance/tuition/bulk', data);
export const recordPayment = (data) => api.post('/finance/payment', data, { headers: { 'Idempotency-Key': crypto.randomUUID() } });
export const getPayments = (invoiceId) => api.get(`/finance/payment/invoice/${invoiceId}`);
export const getDebtReport = (params) => api.get('/finance/debts', { params });
export const getFinanceReport = (period) => api.get('/reports/finance', { params: { period } });
