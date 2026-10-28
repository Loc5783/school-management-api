import api from './axiosConfig';

export const getInvoices = (params) => api.get('/finance/invoices', { params });
export const getFinanceClassrooms = () => api.get('/finance/classrooms');
export const getAccountingProcurementOverview = (period) => api.get('/finance/procurement-overview', { params: { period } });
export const getExpenseOrders = () => api.get('/finance/expense-orders');
export const getPurchaseExpenses = (period, page = 1) => api.get('/finance/expenses', { params: { period, page } });
export const recordPurchaseExpense = (data, idempotencyKey) => api.post('/finance/expenses', data, { headers: { 'Idempotency-Key': idempotencyKey } });
export const getOperatingExpenses = (month, page = 1) => api.get('/finance/operating-expenses', { params: { month, page } });
export const recordOperatingExpense = (data, idempotencyKey) => api.post('/finance/operating-expenses', data, { headers: { 'Idempotency-Key': idempotencyKey } });
export const getOperatingExpenseRequests = (status = 'active', page = 1) => api.get('/finance/operating-expense-requests', { params: { status, page } });
export const createOperatingExpenseRequest = (data, key) => api.post('/finance/operating-expense-requests', data, { headers: { 'Idempotency-Key': key } });
export const reviewOperatingExpenseRequest = (id, decision, reviewNote) => api.patch(`/finance/operating-expense-requests/${id}/review`, { decision, reviewNote });
export const getCashbook = (params) => api.get('/finance/cashbook', { params });
export const saveCashReconciliation = (data) => api.put('/finance/cashbook/reconciliation', data);
export const getFeeSchedules = (period) => api.get('/finance/fee-schedules', { params: { period } });
export const saveFeeSchedule = (data) => api.put('/finance/fee-schedules', data);
export const deleteFeeSchedule = (id) => api.delete(`/finance/fee-schedules/${id}`);
export const createClassInvoices = (data) => api.post('/finance/tuition/bulk', data);
export const previewClassInvoices = (data) => api.post('/finance/tuition/bulk/preview', data);
export const addBulkInvoiceItem = (data) => api.post('/finance/tuition/bulk-additional-item', data);
export const recordPayment = (data, idempotencyKey = crypto.randomUUID()) => api.post('/finance/payment', data, { headers: { 'Idempotency-Key': idempotencyKey } });
export const getPayments = (invoiceId) => api.get(`/finance/payment/invoice/${invoiceId}`);
export const getDebtReport = (params) => api.get('/finance/debts', { params });
export const sendDebtReminders = (data) => api.post('/finance/debts/remind', data);
export const getFinanceReport = (period) => api.get('/reports/finance', { params: { period } });
export const getAccountingReport = (month) => api.get('/reports/accounting-summary', { params: { month } });
export const getAccountingPeriod = (month) => api.get(`/finance/accounting-period/${month}`);
export const closeAccountingPeriod = (month, reason) => api.post(`/finance/accounting-period/${month}/close`, { reason });
export const reopenAccountingPeriod = (month, reason) => api.post(`/finance/accounting-period/${month}/reopen`, { reason });
export const cancelInvoice = (id, reason) => api.put(`/finance/tuition/cancel/${id}`, { reason });
export const adjustInvoice = (id, data, idempotencyKey) => api.post(`/finance/tuition/${id}/adjustments`, data,
  idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined);
export const getInvoiceAdjustments = (id) => api.get(`/finance/tuition/${id}/adjustments`);
export const getRefundRequests = (invoiceId) => api.get('/finance/refund-requests', { params: invoiceId ? { invoiceId } : {} });
export const createRefundRequest = (data) => api.post('/finance/refund-requests', data);
export const reviewRefundRequest = (id, decision, reviewNote) => api.patch(`/finance/refund-requests/${id}/review`, { decision, reviewNote });
export const payRefundRequest = (id, data, key) => api.post(`/finance/refund-requests/${id}/pay`, data, { headers: { 'Idempotency-Key': key } });
export const getReceipt = (paymentId) => api.get(`/finance/receipt/${paymentId}`);

// ==========================================
// CÁC HÀM XUẤT EXCEL & TẢI VỀ
// ==========================================
export const downloadExcelFile = async (url, params = {}, defaultFilename = 'Xuat_Du_Lieu.xlsx') => {
  try {
    const response = await api.get(url, {
      params,
      responseType: 'blob'
    });

    if (response.data && response.data.type === 'application/json') {
      const text = await response.data.text();
      let message = 'Không thể xuất file Excel.';
      try {
        const parsed = JSON.parse(text);
        message = parsed.message || message;
      } catch {
        // ignore parse error
      }
      throw new Error(message);
    }

    let filename = defaultFilename;
    const disposition = response.headers['content-disposition'];
    if (disposition && disposition.includes('filename=')) {
      const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (match && match[1]) {
        filename = decodeURIComponent(match[1].replace(/['"]/g, ''));
      }
    }

    const blob = new Blob([response.data], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(downloadUrl);
  } catch (err) {
    // Nếu backend trả về mã lỗi 4xx/5xx nhưng axios nhận dạng là Blob do responseType: 'blob'
    if (err.response?.data instanceof Blob) {
      try {
        const text = await err.response.data.text();
        const parsed = JSON.parse(text);
        if (parsed.message) {
          err.message = parsed.message;
        }
      } catch {
        // giữ nguyên message của error
      }
    }
    throw err;
  }
};

export const exportFeeSchedules = (param) => {
  const params = typeof param === 'string' ? { period: param } : (param || {});
  return downloadExcelFile('/finance/export/fee-schedules', params, `MucThu_${params.period || 'TatCa'}.xlsx`);
};

export const exportInvoices = (param) => {
  const params = typeof param === 'string' ? { period: param } : (param || {});
  return downloadExcelFile('/finance/export/invoices', params, `HoaDonHocPhi_${params.period || 'TatCa'}.xlsx`);
};

export const exportDebts = (param) => {
  const params = typeof param === 'string' ? { period: param } : (param || {});
  return downloadExcelFile('/finance/export/debts', params, `CongNo_${params.period || 'TatCa'}.xlsx`);
};

export const exportPayments = (param) => {
  const params = typeof param === 'string' ? { invoiceId: param } : (param || {});
  return downloadExcelFile('/finance/export/payments', params, 'LichSuThuTien.xlsx');
};

export const exportPurchaseExpenses = (param) => {
  const params = typeof param === 'string' ? { period: param } : (param || {});
  return downloadExcelFile('/finance/export/expenses', params, `SoChiMuaSam_${params.period || params.month || 'TatCa'}.xlsx`);
};

export const exportOperatingExpenses = (param) => {
  const params = typeof param === 'string' ? { month: param, period: param } : (param || {});
  return downloadExcelFile('/finance/export/operating-expenses', params, `ChiVanHanh_${params.month || params.period || 'TatCa'}.xlsx`);
};

export const exportCashbook = (param) => {
  let params = {};
  if (typeof param === 'string') {
    if (param.includes('-') && param.length === 10) {
      params = { from: param, to: param };
    } else {
      params = { month: param };
    }
  } else if (param && typeof param === 'object') {
    params = { ...param };
  }
  const label = params.from && params.to ? `${params.from}_${params.to}` : (params.month || 'KyHienTai');
  return downloadExcelFile('/finance/export/cashbook', params, `SoQuy_${label}.xlsx`);
};

export const exportPayroll = (param1, param2) => {
  const params = (typeof param1 === 'object' && param1 !== null)
    ? { ...param1 }
    : { month: param1, year: param2 };
  return downloadExcelFile('/finance/export/payroll', params, `BangLuong_${params.month || ''}_${params.year || ''}.xlsx`);
};

export const exportAccountingReport = (param) => {
  const params = typeof param === 'string' ? { month: param } : (param || {});
  return downloadExcelFile('/finance/export/accounting-report', params, `BaoCaoKeToan_${params.month || 'KyHienTai'}.xlsx`);
};

// ==========================================
// CÁC HÀM NHẬP EXCEL
// ==========================================
export const downloadFeeScheduleTemplate = () => downloadExcelFile('/finance/import/fee-schedules/template', {}, 'MauNhap_MucThuHocPhi.xlsx');
export const previewFeeScheduleImport = (formData) => api.post('/finance/import/fee-schedules/preview', formData, {
  headers: { 'Content-Type': 'multipart/form-data' }
});
export const confirmFeeScheduleImport = (data, idempotencyKey) => api.post('/finance/import/fee-schedules/confirm', data, {
  headers: { 'Idempotency-Key': idempotencyKey }
});

export const downloadInvoiceTemplate = () => downloadExcelFile('/finance/import/invoices/template', {}, 'MauNhap_HoaDonHocPhi.xlsx');
export const previewInvoiceImport = (formData) => api.post('/finance/import/invoices/preview', formData, {
  headers: { 'Content-Type': 'multipart/form-data' }
});
export const confirmInvoiceImport = (data, idempotencyKey) => api.post('/finance/import/invoices/confirm', data, {
  headers: { 'Idempotency-Key': idempotencyKey }
});
