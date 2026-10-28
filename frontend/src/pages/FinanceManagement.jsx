import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { addBulkInvoiceItem, adjustInvoice, cancelInvoice, createClassInvoices, createRefundRequest, previewClassInvoices, getDebtReport, getFinanceClassrooms, getFinanceReport, getInvoiceAdjustments, getInvoices, getPayments, getReceipt, getRefundRequests, payRefundRequest, recordPayment, reviewRefundRequest, sendDebtReminders, exportInvoices, exportFeeSchedules, exportDebts, exportPayments } from '../api/finance';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import FeeSchedulePanel from './FeeSchedulePanel';
import FinanceExcelImportModal from '../components/FinanceExcelImportModal';

const currentPeriod = () => { const d = new Date(); return `${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`; };
const initialFinanceView = () => {
  const params = new URLSearchParams(window.location.search);
  const requestedTab = params.get('tab');
  const requestedPeriod = params.get('period');
  return {
    tab: ['invoices', 'refunds', 'schedules', 'create', 'debts', 'report'].includes(requestedTab) ? requestedTab : 'invoices',
    period: /^(0[1-9]|1[0-2])-\d{4}$/.test(requestedPeriod || '') ? requestedPeriod : currentPeriod()
  };
};
const money = (value) => new Intl.NumberFormat('vi-VN').format(value || 0) + ' đ';
const statusText = { unpaid: 'Chưa thu', partial: 'Thu một phần', paid: 'Đã thu đủ', cancelled: 'Đã hủy' };
const adjustmentText = { discount: 'Giảm trừ', surcharge: 'Thu thêm', refund: 'Hoàn tiền' };
const dateText = (value) => value ? new Date(value).toLocaleDateString('vi-VN') : '—';
const schoolToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
const emptyAdjustment = () => ({ type: 'discount', amount: '', reason: '', paidDate: schoolToday(), method: 'bank_transfer', transactionRef: '', documentNumber: '' });

export default function FinanceManagement() {
  const role = JSON.parse(localStorage.getItem('user') || '{}').role;
  const canCancel = role === 'admin';
  const canManageInvoices = ['admin', 'accountant'].includes(role);
  const canCollect = canManageInvoices;
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const validTabs = ['invoices', 'refunds', 'schedules', 'create', 'debts', 'report'];
  const resolvedTab = requestedTab && validTabs.includes(requestedTab) ? requestedTab : 'invoices';
  const tab = !canManageInvoices && ['create', 'schedules'].includes(resolvedTab) ? 'invoices' : resolvedTab;

  const changeTab = (key) => {
    const nextParams = new URLSearchParams(searchParams);
    if (key === 'invoices') {
      nextParams.delete('tab');
    } else {
      nextParams.set('tab', key);
    }
    setSearchParams(nextParams);
  };
  const [classrooms, setClassrooms] = useState([]); const [invoices, setInvoices] = useState([]);
  const [invoicePagination, setInvoicePagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [debts, setDebts] = useState([]); const [debtSummary, setDebtSummary] = useState({ totalDebt: 0, overdueDebt: 0 }); const [report, setReport] = useState(null);
  const [debtPagination, setDebtPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [importModal, setImportModal] = useState(null);
  const [payment, setPayment] = useState(null); const [payments, setPayments] = useState([]); const [receipt, setReceipt] = useState(null); const [invoiceDetail, setInvoiceDetail] = useState(null);
  const [paymentError, setPaymentError] = useState('');
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [bulkItem, setBulkItem] = useState(null);
  const [invoicePreview, setInvoicePreview] = useState(null);
  const [issuingInvoices, setIssuingInvoices] = useState(false);
  const [adjustment, setAdjustment] = useState(null); const [adjustments, setAdjustments] = useState([]); const [adjustmentForm, setAdjustmentForm] = useState(emptyAdjustment);
  const [refundRequests, setRefundRequests] = useState([]);
  const [refundQueue, setRefundQueue] = useState([]);
  const [refundReviewNote, setRefundReviewNote] = useState('');
  const adjustmentKey = useRef(null);
  const [adjustmentSubmitting, setAdjustmentSubmitting] = useState(false);
  const changeAdjustment = (changes) => { adjustmentKey.current = null; setAdjustmentForm((current) => ({ ...current, ...changes })); };
  const [filters, setFilters] = useState(() => ({ period: initialFinanceView().period, classroomId: '', status: '', search: '', page: 1, debtPage: 1 }));
  const [form, setForm] = useState({ classroomId: '', applyToAll: false, period: currentPeriod(), tuitionBase: '', mealFee: '0', busFee: '0', extraFee: '0', additionalItems: [], discount: '0', dueDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 5).toISOString().slice(0, 10), note: '' });

  const handleExportInvoices = async (customParams) => {
    if (exporting) return;
    setExporting(true); setError('');
    try {
      await exportInvoices(customParams || filters);
    } catch (err) {
      setError(err.message || 'Không thể xuất Excel hóa đơn.');
    } finally {
      setExporting(false);
    }
  };

  const handleExportSchedules = async () => {
    if (exporting) return;
    setExporting(true); setError('');
    try {
      await exportFeeSchedules(filters.period);
    } catch (err) {
      setError(err.message || 'Không thể xuất Excel mức thu.');
    } finally {
      setExporting(false);
    }
  };

  const handleExportDebts = async () => {
    if (exporting) return;
    setExporting(true); setError('');
    try {
      await exportDebts({ period: filters.period, classroomId: filters.classroomId });
    } catch (err) {
      setError(err.message || 'Không thể xuất Excel công nợ.');
    } finally {
      setExporting(false);
    }
  };

  const handleExportPayments = async () => {
    if (exporting || !payment?.invoice?._id) return;
    setExporting(true); setError('');
    try {
      await exportPayments({ invoiceId: payment.invoice._id });
    } catch (err) {
      setError(err.message || 'Không thể xuất Excel lịch sử thu tiền.');
    } finally {
      setExporting(false);
    }
  };
  const loadRefundQueue = useCallback(async () => { try { const result = await getRefundRequests(); setRefundQueue(result.data.data || []); } catch (err) { setError(err.response?.data?.message || 'Không thể tải danh sách yêu cầu hoàn tiền.'); } }, []);
  useEffect(() => { if (tab === 'refunds') { const timer = window.setTimeout(loadRefundQueue, 0); return () => window.clearTimeout(timer); } }, [tab, loadRefundQueue]);

  const load = useCallback(async (nextFilters = filters) => {
    setLoading(true); setError('');
    try {
      const [classRes, invoiceRes, debtRes, reportRes] = await Promise.all([
        getFinanceClassrooms(), getInvoices({ ...nextFilters, limit: 20 }), getDebtReport({ period: nextFilters.period, classroomId: nextFilters.classroomId, page: nextFilters.debtPage, limit: 10 }), getFinanceReport(nextFilters.period)
      ]);
      setClassrooms(classRes.data.data || []); setInvoices(invoiceRes.data.data || []); setInvoicePagination(invoiceRes.data.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 }); setDebts(debtRes.data.data || []); setDebtSummary(debtRes.data.summary || { totalDebt: 0, overdueDebt: 0 }); setDebtPagination(debtRes.data.pagination || { page: 1, total: 0, totalPages: 1 }); setReport(reportRes.data.data || null);
    } catch (err) { setError(err.response?.data?.message || 'Không thể tải dữ liệu tài chính.'); }
    finally { setLoading(false); }
  }, [filters]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const applyFilters = () => setFilters((current) => ({ ...current, page: 1, debtPage: 1 }));
  const changePage = (page) => setFilters((current) => ({ ...current, page }));
  const changeDebtPage = (debtPage) => setFilters((current) => ({ ...current, debtPage }));
  const invoicePayload = () => ({ ...form, classroomId: form.applyToAll ? undefined : form.classroomId, tuitionBase: Number(form.tuitionBase), mealFee: Number(form.mealFee), busFee: Number(form.busFee), extraFee: Number(form.extraFee), additionalItems: form.additionalItems.map((item) => ({ name: item.name, amount: Number(item.amount) })), discount: Number(form.discount) });
  const invoiceFingerprint = JSON.stringify(invoicePayload());
  const activePreview = invoicePreview?.fingerprint === invoiceFingerprint ? invoicePreview.data : null;
  const submitInvoices = async (event) => {
    event.preventDefault();
    if (issuingInvoices) return;
    setError(''); setNotice(''); setIssuingInvoices(true);
    try {
      const payload = invoicePayload();
      if (!activePreview) {
        const result = await previewClassInvoices(payload);
        setInvoicePreview({ fingerprint: invoiceFingerprint, data: result.data.data });
        setNotice('Đã tạo bản xem trước. Kiểm tra số lớp, số học sinh và tổng tiền rồi bấm lại để xác nhận lập hóa đơn.');
        return;
      }
      if (!activePreview.canCreate) { setError('Không thể lập hóa đơn: kỳ này đã có hóa đơn hoặc không có học sinh đang theo học.'); return; }
      const accepted = window.confirm(`Lập ${activePreview.studentCount} hóa đơn kỳ ${form.period} cho ${activePreview.byClass.length} lớp, tổng ${money(activePreview.totalAmount)}?`);
      if (!accepted) return;
      const res = await createClassInvoices(payload);
      setInvoicePreview(null);
      setNotice(res.data.message || 'Đã lập hóa đơn học phí.'); changeTab('invoices'); await load();
    } catch (err) { setInvoicePreview(null); setError(err.response?.data?.message || 'Không thể xem trước hoặc lập hóa đơn. Vui lòng thử lại.'); }
    finally { setIssuingInvoices(false); }
  };
  const addAdditionalItem = () => setForm((current) => ({ ...current, additionalItems: [...current.additionalItems, { name: '', amount: '' }] }));
  const updateAdditionalItem = (index, key, value) => setForm((current) => ({ ...current, additionalItems: current.additionalItems.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item) }));
  const removeAdditionalItem = (index) => setForm((current) => ({ ...current, additionalItems: current.additionalItems.filter((_, itemIndex) => itemIndex !== index) }));
  const openBulkItem = () => setBulkItem({ period: filters.period, classroomId: filters.classroomId, name: '', amount: '', reason: '' });
  const submitBulkItem = async (event) => { event.preventDefault(); if (!window.confirm(`Thêm khoản “${bulkItem.name}” vào tất cả hóa đơn chưa hủy của ${bulkItem.classroomId ? 'lớp đã chọn' : 'toàn bộ các lớp'} trong kỳ ${bulkItem.period}?`)) return; try { const res = await addBulkInvoiceItem({ ...bulkItem, amount: Number(bulkItem.amount) }); setNotice(res.data.message || 'Đã bổ sung khoản thu.'); setBulkItem(null); await load(); } catch (err) { setError(err.response?.data?.message || 'Không thể bổ sung khoản thu hàng loạt.'); } };
  const openPayment = async (invoice) => { setPaymentError(''); setPayment({ invoice, amount: Math.max(0, invoice.totalAmount - invoice.paidAmount), method: 'cash', txnRef: '', note: '', idempotencyKey: crypto.randomUUID() }); try { const res = await getPayments(invoice._id); setPayments(res.data.data || []); } catch { setPayments([]); } };
  const changePayment = (key, value) => { setPaymentError(''); setPayment((current) => ({ ...current, [key]: value, ...(key === 'method' ? { txnRef: '' } : {}), idempotencyKey: crypto.randomUUID() })); };
  const submitPayment = async (event) => {
    event.preventDefault();
    if (paymentSubmitting) return;
    setPaymentSubmitting(true); setPaymentError('');
    try {
      const res = await recordPayment({ invoiceId: payment.invoice._id, amount: Number(payment.amount), method: payment.method, txnRef: payment.txnRef.trim(), note: payment.note }, payment.idempotencyKey);
      setNotice(res.data.message || 'Đã ghi nhận thanh toán.'); setPayment(null); await load();
    } catch (err) { setPaymentError(err.response?.data?.message || (err.request ? 'Chưa rõ yêu cầu đã được ghi nhận hay chưa. Giữ nguyên thông tin và bấm thử lại; hệ thống dùng cùng mã yêu cầu để tránh thu trùng.' : 'Không thể ghi nhận thu tiền.')); }
    finally { setPaymentSubmitting(false); }
  };
  const openReceipt = async (paymentId) => { try { const res = await getReceipt(paymentId); setReceipt(res.data.data); } catch (err) { setError(err.response?.data?.message || 'Không thể lấy biên lai.'); } };
  const refreshAdjustment = async (invoiceId) => { const [history, requests] = await Promise.all([getInvoiceAdjustments(invoiceId), getRefundRequests(invoiceId)]); setAdjustments(history.data.data || []); setRefundRequests(requests.data.data || []); };
  const openAdjustment = async (invoice) => { setAdjustment(invoice); setError(''); setAdjustmentForm(emptyAdjustment()); setRefundReviewNote(''); try { await refreshAdjustment(invoice._id); } catch { setAdjustments([]); setRefundRequests([]); setError('Không thể tải lịch sử điều chỉnh/hoàn tiền.'); } };
  const submitAdjustment = async (event) => { event.preventDefault(); if (adjustmentSubmitting) return; setAdjustmentSubmitting(true); setError(''); try { const result = adjustmentForm.type === 'refund' ? await createRefundRequest({ invoiceId: adjustment._id, amount: Number(adjustmentForm.amount), reason: adjustmentForm.reason }) : await adjustInvoice(adjustment._id, { type: adjustmentForm.type, amount: Number(adjustmentForm.amount), reason: adjustmentForm.reason }); setNotice(result.data.message || 'Đã ghi nhận yêu cầu.'); await refreshAdjustment(adjustment._id); setAdjustmentForm(emptyAdjustment()); await load(); } catch (err) { setError(err.response?.data?.message || 'Không thể lưu điều chỉnh.'); } finally { setAdjustmentSubmitting(false); } };
  const reviewRefund = async (request, decision) => { if (adjustmentSubmitting) return; setAdjustmentSubmitting(true); setError(''); try { const result = await reviewRefundRequest(request._id, decision, refundReviewNote.trim()); setNotice(result.data.message); setRefundReviewNote(''); await refreshAdjustment(adjustment._id); await loadRefundQueue(); } catch (err) { setError(err.response?.data?.message || 'Không thể xử lý yêu cầu.'); } finally { setAdjustmentSubmitting(false); } };
  const payRefund = async (request) => { if (adjustmentSubmitting) return; setAdjustmentSubmitting(true); setError(''); try { if (!adjustmentKey.current) adjustmentKey.current = crypto.randomUUID(); const result = await payRefundRequest(request._id, { paidDate: adjustmentForm.paidDate, method: adjustmentForm.method, transactionRef: adjustmentForm.transactionRef, documentNumber: adjustmentForm.documentNumber }, adjustmentKey.current); setNotice(result.data.message); adjustmentKey.current = null; await refreshAdjustment(adjustment._id); await loadRefundQueue(); await load(); } catch (err) { setError(err.response?.data?.message || 'Không thể ghi chi hoàn tiền.'); } finally { setAdjustmentSubmitting(false); } };
  const handleCancel = async (invoice) => { const reason = window.prompt(`Nhập lý do hủy hóa đơn của ${invoice.studentName}:`); if (reason === null) return; try { const res = await cancelInvoice(invoice._id, reason); setNotice(res.data.message || 'Đã hủy hóa đơn.'); await load(); } catch (err) { setError(err.response?.data?.message || 'Không thể hủy hóa đơn.'); } };
  const invoiceLines = (invoice) => [
    ['Học phí chính', invoice.tuitionBase], ['Tiền ăn', invoice.mealFee], ['Tiền xe', invoice.busFee], ['Khoản thu khác (cũ)', invoice.extraFee],
    ...(invoice.additionalItems || []).map((item) => [item.name, item.amount]), ['Giảm trừ', invoice.discount ? -invoice.discount : 0]
  ].filter(([, amount]) => Number(amount) !== 0);
  const remindDebts = async (overdueOnly) => { if (!debtSummary.invoices) return; if (!window.confirm(`Gửi nhắc ${overdueOnly ? 'các khoản quá hạn' : 'toàn bộ công nợ'} kỳ ${filters.period} cho phụ huynh đã liên kết? Mỗi khoản chỉ được nhắc một lần trong ngày.`)) return; try { const res = await sendDebtReminders({ period: filters.period, classroomId: filters.classroomId, overdueOnly }); setNotice(`${res.data.message}${res.data.data?.unlinkedInvoices ? ` ${res.data.data.unlinkedInvoices} hóa đơn chưa có phụ huynh liên kết nên không gửi được.` : ''}`); } catch (err) { setError(err.response?.data?.message || 'Không thể gửi nhắc nợ.'); } };

  return <AppShell title="Tài chính học phí" subtitle="Lập học phí, thu tiền, quản lý công nợ, biên lai, điều chỉnh và báo cáo kỳ thu.">
    {error && <div className="form-error">{error}</div>}
    {notice && <div className="form-success">{notice}</div>}
    <section className="content-card timekeeping-hub"><div className="timekeeping-hub-tabs">{[['invoices', 'Hóa đơn học phí'], ['refunds', 'Duyệt hoàn tiền'], ['schedules', 'Thiết lập mức thu'], ['create', 'Lập học phí theo lớp'], ['debts', 'Công nợ'], ['report', 'Báo cáo kỳ thu']].filter(([key]) => canManageInvoices || !['schedules', 'create'].includes(key)).map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => changeTab(key)}>{label}</button>)}</div></section>
    {tab === 'refunds' && <section className="content-card student-list-card"><div className="list-toolbar"><div><p className="card-kicker">HOÀN TIỀN HỌC PHÍ</p><h2>Yêu cầu chờ xử lý</h2><p>Kỳ hóa đơn có thể đã chốt; khoản hoàn chỉ ghi vào tháng thực chi sau khi được duyệt.</p></div><button type="button" className="button button-secondary" onClick={loadRefundQueue}>Làm mới</button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Học sinh · lớp</th><th>Kỳ hóa đơn</th><th>Số tiền</th><th>Người đề nghị</th><th>Trạng thái</th><th></th></tr></thead><tbody>{refundQueue.map((request) => <tr key={request._id}><td>{request.invoice?.studentName || 'Hóa đơn không còn tồn tại'} · {request.invoice?.className || ''}</td><td>{request.invoice?.period || '—'}</td><td>{money(request.amount)}</td><td>{request.requestedByName}</td><td>{request.status === 'pending' ? 'Chờ duyệt' : 'Đã duyệt, chờ chi'}</td><td><button type="button" className="button button-secondary" onClick={() => openAdjustment({ _id: request.invoiceId, studentName: request.invoice?.studentName || 'Hóa đơn', period: request.invoice?.period || '' })}>Mở yêu cầu</button></td></tr>)}{!refundQueue.length && <tr><td colSpan="6" className="history-empty">Không có yêu cầu đang chờ.</td></tr>}</tbody></table></div></section>}
    {tab === 'schedules' && canManageInvoices && <><section className="content-card student-list-card"><div className="list-toolbar"><div><p className="card-kicker">MỨC THU</p><h2>Thiết lập mức thu theo kỳ</h2></div><div className="classroom-actions"><button type="button" className="button button-secondary" onClick={() => setImportModal('schedules')}><Icon name="upload" size={16} />Nhập Excel</button><button type="button" className="button button-secondary" onClick={handleExportSchedules} disabled={exporting}><Icon name="download" size={16} />{exporting ? 'Đang xuất...' : 'Xuất Excel'}</button></div></div><div className="student-filter-grid"><label>Kỳ thu (MM-YYYY)<input value={filters.period} onChange={(event) => setFilters({ ...filters, period: event.target.value })} placeholder="10-2026" /></label></div></section>{/^(0[1-9]|1[0-2])-\d{4}$/.test(filters.period) ? <FeeSchedulePanel period={filters.period} classrooms={classrooms} onUse={(item) => { setForm({ classroomId: item.classroomId || '', applyToAll: !item.classroomId, period: item.period, tuitionBase: String(item.tuitionBase), mealFee: String(item.mealFee), busFee: String(item.busFee), extraFee: String(item.extraFee), additionalItems: (item.additionalItems || []).map(({ name, amount }) => ({ name, amount: String(amount) })), discount: String(item.discount), dueDate: item.dueDate.slice(0, 10), note: item.note || '' }); changeTab('create'); setNotice(`Đã nạp mức thu ${item.classroomName || 'tất cả lớp'}. Kiểm tra lại trước khi lập hóa đơn.`); }} /> : <div className="form-error">Kỳ thu phải có dạng MM-YYYY.</div>}</>}
    {tab === 'invoices' && <section className="content-card student-list-card"><div className="list-toolbar"><div><p className="card-kicker">HÓA ĐƠN HỌC PHÍ</p><h2>Danh sách thu theo kỳ</h2></div><div className="classroom-actions">{canManageInvoices && <button className="button button-secondary" onClick={openBulkItem}>＋ Thêm khoản chung</button>}{canManageInvoices && <button type="button" className="button button-secondary" onClick={() => setImportModal('invoices')}><Icon name="upload" size={16} />Nhập Excel</button>}<button type="button" className="button button-secondary" onClick={() => handleExportInvoices()} disabled={exporting}><Icon name="download" size={16} />{exporting ? 'Đang xuất...' : 'Xuất Excel'}</button><button className="button button-primary" onClick={() => load()}><Icon name="refresh" size={16} />Làm mới</button></div></div><div className="student-filter-grid"><label>Kỳ thu<input value={filters.period} onChange={(e) => setFilters({ ...filters, period: e.target.value })} placeholder="09-2026" /></label><label>Lớp<select value={filters.classroomId} onChange={(e) => setFilters({ ...filters, classroomId: e.target.value })}><option value="">Tất cả lớp</option>{classrooms.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label><label>Trạng thái<select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">Tất cả</option>{Object.entries(statusText).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Tìm học sinh<input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Tên học sinh" /></label></div><div className="form-actions"><button className="button button-secondary" onClick={applyFilters}>Áp dụng bộ lọc</button></div>{loading ? <div className="inline-loader"><span className="loading-orb" />Đang tải...</div> : <><div className="table-wrap"><table className="data-table"><thead><tr><th>Học sinh</th><th>Kỳ</th><th>Phải thu</th><th>Đã thu</th><th>Còn nợ</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{invoices.length ? invoices.map((item) => <tr key={item._id}><td><strong>{item.studentName}</strong><small>{item.className}{item.additionalItems?.length ? ` · ${item.additionalItems.length} khoản thu thêm` : ''}</small></td><td>{item.period}</td><td>{money(item.totalAmount)}</td><td>{money(item.paidAmount)}</td><td>{money(item.totalAmount - item.paidAmount)}</td><td><span className={`student-status ${item.status === 'paid' ? 'enrolled' : item.status === 'partial' ? 'temporarily_absent' : 'withdrawn'}`}>{statusText[item.status]}</span></td><td><div className="classroom-actions"><button className="button button-secondary" onClick={() => setInvoiceDetail(item)}>Chi tiết</button>{canCollect && item.status !== 'paid' && item.status !== 'cancelled' && <button className="button button-primary" onClick={() => openPayment(item)}>Thu tiền</button>}{item.status !== 'cancelled' && <button className="button button-secondary" onClick={() => openAdjustment(item)}>{canManageInvoices ? 'Điều chỉnh' : 'Lịch sử / Duyệt hoàn'}</button>}{canCancel && item.status === 'unpaid' && <button className="button button-danger" onClick={() => handleCancel(item)}>Hủy</button>}</div></td></tr>) : <tr><td colSpan="7" className="history-empty">Chưa có hóa đơn phù hợp.</td></tr>}</tbody></table></div><div className="finance-pagination"><span>Hiển thị {invoices.length ? (invoicePagination.page - 1) * invoicePagination.limit + 1 : 0}–{Math.min(invoicePagination.page * invoicePagination.limit, invoicePagination.total)} / {invoicePagination.total} hóa đơn</span><div><button disabled={invoicePagination.page <= 1} onClick={() => changePage(invoicePagination.page - 1)}>‹ Trước</button><span>Trang {invoicePagination.page}/{invoicePagination.totalPages || 1}</span><button disabled={invoicePagination.page >= invoicePagination.totalPages} onClick={() => changePage(invoicePagination.page + 1)}>Sau ›</button></div></div></>}</section>}
    {tab === 'create' && canManageInvoices && <section className="content-card student-form"><div className="card-heading"><div><p className="card-kicker">LẬP HỌC PHÍ HÀNG LOẠT</p><h2>Tạo hóa đơn cho học sinh đang theo học</h2></div></div><form className="student-form-grid" onSubmit={submitInvoices}><label>Lớp học<select value={form.applyToAll ? '__all__' : form.classroomId} onChange={(e) => setForm({ ...form, applyToAll: e.target.value === '__all__', classroomId: e.target.value === '__all__' ? '' : e.target.value })} required><option value="">Chọn lớp</option><option value="__all__">Tất cả lớp đang hoạt động</option>{classrooms.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select><small>{form.applyToAll ? 'Áp dụng cùng mức thu cho tất cả học sinh đang theo học ở các lớp hoạt động.' : 'Chỉ áp dụng cho học sinh đang theo học của lớp đã chọn.'}</small></label><label>Kỳ thu (MM-YYYY)<input value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} required /></label><label>Học phí chính<input type="number" min="0" value={form.tuitionBase} onChange={(e) => setForm({ ...form, tuitionBase: e.target.value })} required /></label><label>Tiền ăn<input type="number" min="0" value={form.mealFee} onChange={(e) => setForm({ ...form, mealFee: e.target.value })} /></label><label>Tiền xe<input type="number" min="0" value={form.busFee} onChange={(e) => setForm({ ...form, busFee: e.target.value })} /></label><label>Giảm trừ chung<input type="number" min="0" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} /></label><label>Hạn thanh toán<input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} required /></label><div className="form-wide invoice-extra-items"><div><label>Các khoản thu thêm</label><small>Ví dụ: Hội chữ thập đỏ, hội đoàn, dã ngoại, đồng phục. Các khoản này áp dụng chung cho toàn bộ học sinh được chọn.</small></div>{form.additionalItems.map((item, index) => <div className="invoice-extra-row" key={index}><input aria-label={`Tên khoản thu thêm ${index + 1}`} value={item.name} onChange={(e) => updateAdditionalItem(index, 'name', e.target.value)} placeholder="Tên khoản thu, ví dụ: Hội chữ thập đỏ" required /><input aria-label={`Số tiền khoản thu thêm ${index + 1}`} type="number" min="1" value={item.amount} onChange={(e) => updateAdditionalItem(index, 'amount', e.target.value)} placeholder="Số tiền (VNĐ)" required /><button type="button" className="button button-danger" onClick={() => removeAdditionalItem(index)} aria-label={`Xóa khoản thu ${index + 1}`}>Xóa</button></div>)}<button type="button" className="button button-secondary invoice-add-item" onClick={addAdditionalItem}>＋ Thêm khoản thu</button></div><label className="form-wide">Ghi chú<textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Nội dung áp dụng chung cho kỳ thu này" /></label><div className="form-actions form-wide"><button className="button button-primary">{form.applyToAll ? 'Lập hóa đơn cho tất cả lớp' : 'Lập hóa đơn cho lớp'}</button></div></form></section>}
    {tab === 'create' && canManageInvoices && activePreview && <section className="content-card student-list-card"><div className="card-heading"><div><p className="card-kicker">KIỂM TRA TRƯỚC KHI LẬP</p><h2>{activePreview.studentCount} học sinh · {money(activePreview.totalAmount)}</h2><p>Mỗi học sinh: {money(activePreview.perStudent)} · Hạn thanh toán: {dateText(activePreview.dueDate)}</p></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Lớp</th><th>Học sinh đang học</th><th>Đã có hóa đơn kỳ này</th></tr></thead><tbody>{activePreview.byClass.map((item) => <tr key={item.classroomId}><td>{item.name}</td><td>{item.studentCount}</td><td>{item.existingCount}</td></tr>)}</tbody></table></div><p style={{ padding: '0 24px 20px' }}>{activePreview.canCreate ? 'Nếu số liệu đúng, bấm lại nút lập hóa đơn và xác nhận.' : 'Không thể lập: lớp trống hoặc đã có hóa đơn trong kỳ. Hãy kiểm tra lại trước khi tiếp tục.'}</p></section>}
    {tab === 'debts' && <section className="content-card student-list-card"><div className="card-heading"><div><p className="card-kicker">CÔNG NỢ</p><h2>{money(debtSummary.totalDebt)} cần thu</h2><p>Quá hạn: {money(debtSummary.overdueDebt)}</p></div><div className="classroom-actions"><button type="button" className="button button-secondary" onClick={handleExportDebts} disabled={exporting}><Icon name="download" size={16} />{exporting ? 'Đang xuất...' : 'Xuất Excel'}</button>{canManageInvoices && <><button className="button button-secondary" onClick={() => remindDebts(false)}>Nhắc toàn bộ</button><button className="button button-primary" onClick={() => remindDebts(true)} disabled={!debtSummary.overdueDebt}>Nhắc quá hạn</button></>}</div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Học sinh</th><th>Kỳ</th><th>Hạn thanh toán</th><th>Còn phải thu</th><th>Trạng thái</th></tr></thead><tbody>{debts.length ? debts.map((item) => <tr key={item._id}><td><strong>{item.studentName}</strong><small>{item.className}</small></td><td>{item.period}</td><td>{dateText(item.dueDate)}</td><td>{money(item.remainingAmount)}</td><td><span className={`student-status ${item.overdue ? 'withdrawn' : 'enrolled'}`}>{item.overdue ? 'Quá hạn' : 'Trong hạn'}</span></td></tr>) : <tr><td colSpan="5" className="history-empty">Không có công nợ.</td></tr>}</tbody></table></div></section>}
    {tab === 'debts' && debtPagination.total > 0 && <div className="table-pagination"><span>{debtPagination.total} khoản công nợ · Trang {debtPagination.page}/{debtPagination.totalPages}</span><div><button type="button" disabled={debtPagination.page <= 1} onClick={() => changeDebtPage(debtPagination.page - 1)}>‹ Trước</button><button type="button" disabled={debtPagination.page >= debtPagination.totalPages} onClick={() => changeDebtPage(debtPagination.page + 1)}>Sau ›</button></div></div>}
    {tab === 'report' && <><section className="parent-summary-grid">{[['Hóa đơn', report?.totalInvoices], ['Phải thu', money(report?.totalAmount)], ['Đã thu', money(report?.totalPaid)], ['Còn phải thu', money(report?.totalRemaining)]].map(([label, value]) => <article key={label}><div><small>{label}</small><strong>{value || 0}</strong></div></article>)}</section><section className="content-card student-list-card"><div className="card-heading"><div><p className="card-kicker">BÁO CÁO THEO LỚP</p><h2>Kỳ thu {report?.period || filters.period}</h2></div><div className="classroom-actions"><button type="button" className="button button-secondary" onClick={() => handleExportInvoices({ period: filters.period, format: 'report' })} disabled={exporting}><Icon name="download" size={16} />{exporting ? 'Đang xuất...' : 'Xuất Excel'}</button></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Lớp</th><th>Số hóa đơn</th><th>Phải thu</th><th>Đã thu</th><th>Còn nợ</th><th>Đã thu đủ</th></tr></thead><tbody>{report?.byClass?.length ? report.byClass.map((item) => <tr key={item._id}><td>{item.className}</td><td>{item.totalStudents}</td><td>{money(item.totalAmount)}</td><td>{money(item.paidAmount)}</td><td>{money(item.totalAmount - item.paidAmount)}</td><td>{item.paidCount}/{item.totalStudents}</td></tr>) : <tr><td colSpan="6" className="history-empty">Chưa có dữ liệu cho kỳ thu này.</td></tr>}</tbody></table></div></section></>}
    {canManageInvoices && bulkItem && <div className="modal-backdrop"><form className="content-card student-form finance-invoice-detail" onSubmit={submitBulkItem}><div className="card-heading"><div><p className="card-kicker">BỔ SUNG KHOẢN THU HÀNG LOẠT</p><h2>Thêm vào các hóa đơn đã lập</h2><p>Khoản thu được cộng vào hóa đơn chưa hủy, không tạo hóa đơn mới.</p></div><button type="button" className="button button-secondary" onClick={() => setBulkItem(null)}>Đóng</button></div><div className="student-form-grid"><label>Kỳ thu<input value={bulkItem.period} onChange={(e) => setBulkItem({ ...bulkItem, period: e.target.value })} placeholder="09-2026" required /></label><label>Lớp học<select value={bulkItem.classroomId} onChange={(e) => setBulkItem({ ...bulkItem, classroomId: e.target.value })}><option value="">Tất cả lớp</option>{classrooms.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label><label>Tên khoản thu<input value={bulkItem.name} onChange={(e) => setBulkItem({ ...bulkItem, name: e.target.value })} placeholder="Ví dụ: Hội chữ thập đỏ" maxLength="120" required /></label><label>Số tiền / học sinh<input type="number" min="1" value={bulkItem.amount} onChange={(e) => setBulkItem({ ...bulkItem, amount: e.target.value })} placeholder="100000" required /></label><label className="form-wide">Lý do / ghi chú<textarea value={bulkItem.reason} onChange={(e) => setBulkItem({ ...bulkItem, reason: e.target.value })} placeholder="Ví dụ: Thu bổ sung theo thông báo số..." maxLength="1000" /></label></div><div className="form-actions"><button className="button button-primary">Thêm vào hóa đơn phù hợp</button></div></form></div>}
    {invoiceDetail && <div className="modal-backdrop"><section className="content-card student-form finance-invoice-detail"><div className="card-heading"><div><p className="card-kicker">CHI TIẾT HÓA ĐƠN</p><h2>{invoiceDetail.studentName} · {invoiceDetail.period}</h2><p>{invoiceDetail.className}</p></div><button className="button button-secondary" onClick={() => setInvoiceDetail(null)}>Đóng</button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Khoản thu / giảm trừ</th><th>Số tiền</th></tr></thead><tbody>{invoiceLines(invoiceDetail).map(([name, amount], index) => <tr key={`${name}-${index}`}><td>{name}</td><td className={amount < 0 ? 'finance-amount-discount' : ''}>{amount < 0 ? `− ${money(Math.abs(amount))}` : money(amount)}</td></tr>)}<tr className="finance-invoice-total"><td>Tổng phải thu</td><td>{money(invoiceDetail.totalAmount)}</td></tr></tbody></table></div>{invoiceDetail.note && <p className="finance-invoice-note"><strong>Ghi chú:</strong> {invoiceDetail.note}</p>}</section></div>}
    {payment && <div className="modal-backdrop"><form className="content-card student-form" onSubmit={submitPayment}><div className="card-heading"><div><p className="card-kicker">THU TIỀN</p><h2>{payment.invoice.studentName} · {payment.invoice.period}</h2><p>Còn phải thu: {money(payment.invoice.totalAmount - payment.invoice.paidAmount)}</p></div><div className="classroom-actions"><button type="button" className="button button-secondary" onClick={handleExportPayments} disabled={exporting}><Icon name="download" size={16} />{exporting ? 'Đang xuất...' : 'Xuất Excel'}</button><button type="button" className="button button-secondary" onClick={() => setPayment(null)} disabled={paymentSubmitting}>Đóng</button></div></div>{paymentError && <div className="form-error" role="alert">{paymentError}</div>}<div className="student-form-grid"><label>Số tiền thu<input type="number" min="1" max={payment.invoice.totalAmount - payment.invoice.paidAmount} value={payment.amount} onChange={(e) => changePayment('amount', e.target.value)} required /></label><label>Phương thức<select value={payment.method} onChange={(e) => changePayment('method', e.target.value)}><option value="cash">Tiền mặt</option><option value="bank_transfer">Chuyển khoản</option><option value="ewallet">Ví điện tử</option></select></label>{payment.method !== 'cash' && <label className="form-wide">Mã giao dịch để đối soát<input value={payment.txnRef} onChange={(e) => changePayment('txnRef', e.target.value)} placeholder="Mã giao dịch trên sao kê / ví điện tử" maxLength="120" required /></label>}<label className="form-wide">Ghi chú<input value={payment.note} onChange={(e) => changePayment('note', e.target.value)} placeholder="Ví dụ: Phụ huynh nộp tại quầy" /></label></div><div className="form-actions"><button className="button button-primary" disabled={paymentSubmitting}>{paymentSubmitting ? 'Đang ghi nhận...' : 'Xác nhận thu tiền'}</button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Biên lai</th><th>Ngày thu</th><th>Số tiền</th><th>Đối soát</th><th></th></tr></thead><tbody>{payments.map((item) => <tr key={item._id}><td>{item.receiptNumber || `PT-LEGACY-${item._id.slice(-6)}`}</td><td>{dateText(item.paidAt)}</td><td>{money(item.amount)}</td><td>{item.txnRef || (item.method === 'cash' ? 'Tiền mặt' : 'Chưa có mã')}</td><td><button type="button" className="button button-secondary" onClick={() => openReceipt(item._id)}>Xem biên lai</button></td></tr>)}{!payments.length && <tr><td colSpan="5" className="history-empty">Chưa có lần thu nào.</td></tr>}</tbody></table></div></form></div>}
    {adjustment && <div className="modal-backdrop"><div className="content-card student-form"><div className="card-heading"><div><p className="card-kicker">ĐIỀU CHỈNH HÓA ĐƠN</p><h2>{adjustment.studentName} · {adjustment.period}</h2><p>Hoàn tiền: kế toán đề nghị → hiệu trưởng/admin duyệt → kế toán ghi chứng từ chi. Hóa đơn kỳ cũ vẫn giữ kỳ gốc.</p></div><button type="button" className="button button-secondary" disabled={adjustmentSubmitting} onClick={() => { adjustmentKey.current = null; setAdjustment(null); }}>Đóng</button></div>{error && <div className="form-error" role="alert">{error}</div>}
      {canManageInvoices && <form onSubmit={submitAdjustment}><div className="student-form-grid"><label>Loại nghiệp vụ<select value={adjustmentForm.type} onChange={(e) => changeAdjustment({ type: e.target.value })}><option value="discount">Giảm trừ hóa đơn</option><option value="surcharge">Thu thêm</option><option value="refund" disabled={role !== 'accountant'}>Đề nghị hoàn tiền</option></select></label><label>Số tiền<input type="number" min="1" step="1" value={adjustmentForm.amount} onChange={(e) => changeAdjustment({ amount: e.target.value })} required /></label><label className="form-wide">Lý do<textarea value={adjustmentForm.reason} onChange={(e) => changeAdjustment({ reason: e.target.value })} minLength="5" maxLength="1000" required /></label></div><div className="form-actions"><button className="button button-primary" disabled={adjustmentSubmitting}>{adjustmentSubmitting ? 'Đang lưu...' : adjustmentForm.type === 'refund' ? 'Gửi yêu cầu duyệt' : 'Lưu điều chỉnh'}</button></div></form>}
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Thời gian</th><th>Nghiệp vụ</th><th>Số tiền</th><th>Lý do</th><th>Người thực hiện</th></tr></thead><tbody>{adjustments.map((item) => <tr key={item._id}><td>{dateText(item.paidAt || item.createdAt)}</td><td>{adjustmentText[item.type]}</td><td>{money(item.amount)}</td><td>{item.reason}</td><td>{item.recordedByName}</td></tr>)}{!adjustments.length && <tr><td colSpan="5" className="history-empty">Chưa có điều chỉnh.</td></tr>}</tbody></table></div>
      <div className="card-heading"><div><p className="card-kicker">QUY TRÌNH HOÀN TIỀN</p><h3>Yêu cầu và phê duyệt</h3></div></div>
      {refundRequests.map((request) => <div key={request._id} className="content-card" style={{ padding: 16, marginBottom: 12 }}><strong>{money(request.amount)} · {({ pending: 'Chờ duyệt', approved: 'Đã duyệt, chờ chi', rejected: 'Đã từ chối', paid: 'Đã chi' })[request.status]}</strong><p>{request.reason} · Người đề nghị: {request.requestedByName} · {dateText(request.createdAt)}</p>{request.reviewedByName && <p>Người duyệt: {request.reviewedByName} · {request.reviewNote || 'Không ghi chú'}</p>}
        {request.status === 'pending' && ['admin', 'principal'].includes(role) && <div><label>Ghi chú phê duyệt / lý do từ chối<input maxLength="500" value={refundReviewNote} onChange={(event) => setRefundReviewNote(event.target.value)} /></label><div className="form-actions"><button type="button" className="button button-secondary" disabled={adjustmentSubmitting} onClick={() => reviewRefund(request, 'rejected')}>Từ chối</button><button type="button" className="button button-primary" disabled={adjustmentSubmitting} onClick={() => reviewRefund(request, 'approved')}>Duyệt hoàn tiền</button></div></div>}
        {request.status === 'approved' && role === 'accountant' && <div className="student-form-grid"><label>Ngày chi thực tế<input type="date" max={schoolToday()} value={adjustmentForm.paidDate} onChange={(event) => changeAdjustment({ paidDate: event.target.value })} /></label><label>Phương thức<select value={adjustmentForm.method} onChange={(event) => changeAdjustment({ method: event.target.value, transactionRef: '' })}><option value="bank_transfer">Chuyển khoản</option><option value="cash">Tiền mặt</option></select></label><label>Số chứng từ chi<input maxLength="120" value={adjustmentForm.documentNumber} onChange={(event) => changeAdjustment({ documentNumber: event.target.value })} /></label>{adjustmentForm.method === 'bank_transfer' && <label>Mã giao dịch ngân hàng<input maxLength="120" value={adjustmentForm.transactionRef} onChange={(event) => changeAdjustment({ transactionRef: event.target.value })} /></label>}<div className="form-actions form-wide"><button type="button" className="button button-primary" disabled={adjustmentSubmitting} onClick={() => payRefund(request)}>Xác nhận đã chi</button></div></div>}</div>)}
      {!refundRequests.length && <p>Chưa có yêu cầu hoàn tiền cho hóa đơn này.</p>}</div></div>}
    {receipt && <div className="modal-backdrop"><section className="content-card student-form finance-receipt"><div className="card-heading"><div><p className="card-kicker">BIÊN LAI THU HỌC PHÍ</p><h2>{receipt.receiptNumber}</h2></div><button className="button button-secondary" onClick={() => setReceipt(null)}>Đóng</button></div><div className="finance-receipt-body"><p><span>Học sinh</span><strong>{receipt.studentName}</strong></p><p><span>Lớp / kỳ thu</span><strong>{receipt.className} · {receipt.period}</strong></p><p><span>Ngày thu</span><strong>{dateText(receipt.paidAt)}</strong></p><p><span>Hình thức</span><strong>{{ cash: 'Tiền mặt', bank_transfer: 'Chuyển khoản', ewallet: 'Ví điện tử' }[receipt.method]}</strong></p><p><span>Số tiền đã thu</span><strong>{money(receipt.amount)}</strong></p><p><span>Còn lại sau lần thu</span><strong>{money(receipt.totalAmount - receipt.paidAmount)}</strong></p>{receipt.additionalItems?.length > 0 && <p className="finance-receipt-items"><span>Khoản thu thêm</span><strong>{receipt.additionalItems.map((item) => `${item.name}: ${money(item.amount)}`).join(' · ')}</strong></p>}{receipt.txnRef && <p><span>Mã giao dịch</span><strong>{receipt.txnRef}</strong></p>}{receipt.note && <p><span>Ghi chú</span><strong>{receipt.note}</strong></p>}</div><div className="form-actions"><button className="button button-secondary" onClick={() => window.print()}>In biên lai</button></div></section></div>}
    {importModal && (
      <FinanceExcelImportModal
        isOpen={Boolean(importModal)}
        type={importModal === 'schedules' ? 'fee_schedule' : 'invoice'}
        period={filters.period}
        onClose={() => setImportModal(null)}
        onSuccess={async () => {
          setNotice('Nhập dữ liệu Excel thành công.');
          setImportModal(null);
          await load();
        }}
      />
    )}
  </AppShell>;
}
