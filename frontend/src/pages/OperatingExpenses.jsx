import { useCallback, useEffect, useState } from 'react';
import AppShell from '../components/AppShell';
import { createOperatingExpenseRequest, getOperatingExpenseRequests, getOperatingExpenses, recordOperatingExpense, reviewOperatingExpenseRequest } from '../api/finance';
import './AccountingExpenses.css';

const todaySchool = () => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};
const money = (value) => `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)} đ`;
const categories = { utilities: 'Điện, nước, internet', rent: 'Thuê mặt bằng', maintenance: 'Bảo trì, sửa chữa', services: 'Dịch vụ vận hành', other: 'Chi vận hành khác' };
const blankRequest = () => ({ category: 'utilities', payee: '', description: '', amount: '', requestKey: crypto.randomUUID() });
const blankPayment = () => ({ requestId: '', paidAt: todaySchool(), method: 'bank_transfer', transactionRef: '', documentNumber: '', note: '', idempotencyKey: crypto.randomUUID() });

export default function OperatingExpenses() {
  const role = JSON.parse(localStorage.getItem('user') || '{}').role;
  const [month, setMonth] = useState(() => todaySchool().slice(0, 7));
  const [page, setPage] = useState(1);
  const [requestForm, setRequestForm] = useState(blankRequest);
  const [paymentForm, setPaymentForm] = useState(blankPayment);
  const [requestFilter, setRequestFilter] = useState('active');
  const [requestPage, setRequestPage] = useState(1);
  const [requests, setRequests] = useState({ rows: [], totalPages: 1, total: 0 });
  const [reviewNotes, setReviewNotes] = useState({});
  const [state, setState] = useState({ loading: true, rows: [], summary: { count: 0, total: 0 }, totalPages: 1 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true }));
    try {
      const [response, requestResponse] = await Promise.all([getOperatingExpenses(month, page), getOperatingExpenseRequests(requestFilter, requestPage)]);
      setState({ loading: false, rows: response.data.data || [], summary: response.data.summary || { count: 0, total: 0 }, totalPages: response.data.pagination?.totalPages || 1 });
      setRequests({ rows: requestResponse.data.data || [], totalPages: requestResponse.data.pagination?.totalPages || 1, total: requestResponse.data.pagination?.total || 0 });
      setError('');
    } catch (requestError) { setState((current) => ({ ...current, loading: false })); setError(requestError.response?.data?.message || 'Không tải được sổ chi vận hành.'); }
  }, [month, page, requestFilter, requestPage]);
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, [load]);

  const changeRequest = (key, value) => { setError(''); setRequestForm((current) => ({ ...current, [key]: value, requestKey: crypto.randomUUID() })); };
  const changePayment = (key, value) => { setError(''); setPaymentForm((current) => ({ ...current, [key]: value, ...(key === 'method' && value === 'cash' ? { transactionRef: '' } : {}), idempotencyKey: crypto.randomUUID() })); };
  const submitRequest = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await createOperatingExpenseRequest({ category: requestForm.category, payee: requestForm.payee.trim(), description: requestForm.description.trim(), amount: Number(requestForm.amount) }, requestForm.requestKey);
      setNotice(response.data.message || 'Đã gửi đề nghị chi.'); setRequestForm(blankRequest()); setRequestFilter('active'); setRequestPage(1); await load();
    } catch (requestError) { setError(requestError.response?.data?.message || 'Chưa rõ đề nghị đã gửi chưa. Giữ nguyên biểu mẫu và thử lại để tránh gửi trùng.'); }
    finally { setSaving(false); }
  };
  const review = async (request, decision) => {
    if (saving) return;
    setSaving(true); setError(''); setNotice('');
    try { const response = await reviewOperatingExpenseRequest(request._id, decision, (reviewNotes[request._id] || '').trim()); setNotice(response.data.message); setReviewNotes((current) => ({ ...current, [request._id]: '' })); await load(); }
    catch (requestError) { setError(requestError.response?.data?.message || 'Không thể xử lý đề nghị chi.'); }
    finally { setSaving(false); }
  };
  const submitPayment = async (event) => {
    event.preventDefault(); if (saving || !paymentForm.requestId) return;
    const selected = requests.rows.find((item) => item._id === paymentForm.requestId);
    if (!selected || !window.confirm(`Xác nhận đã chi ${money(selected.amount)} cho ${selected.payee}? Kiểm tra chứng từ trước khi ghi sổ.`)) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await recordOperatingExpense({ requestId: selected._id, paidAt: paymentForm.paidAt, method: paymentForm.method, transactionRef: paymentForm.transactionRef.trim(), documentNumber: paymentForm.documentNumber.trim(), note: paymentForm.note.trim() }, paymentForm.idempotencyKey);
      setNotice(response.data.message || 'Đã ghi khoản chi.'); setPaymentForm(blankPayment()); setPage(1); await load();
    } catch (requestError) { setError(requestError.response?.data?.message || 'Chưa rõ khoản chi đã ghi nhận chưa. Giữ nguyên biểu mẫu và thử lại để tránh ghi trùng.'); }
    finally { setSaving(false); }
  };

  return <AppShell title="Sổ chi vận hành" subtitle="Ghi các khoản điện, nước, bảo trì và dịch vụ ngoài đơn mua sắm, có chứng từ để đối soát.">
    <div className="accounting-expenses">
      <section className="content-card accounting-expense-summary"><div><p className="card-kicker">CHI VẬN HÀNH ĐÃ GHI SỔ</p><h2>{money(state.summary.total)}</h2><span>{state.summary.count} chứng từ trong tháng {month.slice(5, 7)}/{month.slice(0, 4)}. Không bao gồm mua sắm, lương và hoàn học phí.</span></div><label>Chọn tháng<input type="month" value={month} onChange={(event) => { if (event.target.value) { setMonth(event.target.value); setPage(1); } }} /></label></section>
      {error && <div className="form-error" role="alert">{error}</div>}{notice && <div className="form-success" role="status">{notice}</div>}
      {role === 'accountant' && <section className="content-card student-form"><div className="card-heading"><div><p className="card-kicker">BƯỚC 1 · ĐỀ NGHỊ CHI</p><h2>Gửi hiệu trưởng phê duyệt</h2><p>Đề nghị chưa phải tiền thực chi và chưa vào sổ đối soát. Sau khi duyệt, nội dung và số tiền không thể tự sửa lúc chi.</p></div></div><form className="student-form-grid" onSubmit={submitRequest}>
        <label>Nhóm chi<select value={requestForm.category} onChange={(event) => changeRequest('category', event.target.value)}>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Đơn vị/người nhận tiền<input required maxLength="160" value={requestForm.payee} onChange={(event) => changeRequest('payee', event.target.value)} placeholder="Ví dụ: Công ty điện lực" /></label>
        <label className="form-wide">Nội dung chi<input required maxLength="500" value={requestForm.description} onChange={(event) => changeRequest('description', event.target.value)} placeholder="Ví dụ: Tiền điện trường tháng 10/2026" /></label>
        <label>Số tiền đề nghị (VNĐ)<input required type="number" min="1" step="1" value={requestForm.amount} onChange={(event) => changeRequest('amount', event.target.value)} /></label>
        <div className="form-actions form-wide"><button className="button button-primary" disabled={saving}>{saving ? 'Đang gửi...' : 'Gửi đề nghị duyệt'}</button></div>
      </form></section>}
      <section className="content-card student-list-card"><div className="card-heading"><div><p className="card-kicker">BƯỚC 2 · PHÊ DUYỆT</p><h2>Đề nghị chi vận hành</h2><p>Hiệu trưởng/admin duyệt hoặc từ chối. Kế toán chỉ ghi chi sau khi đã được duyệt.</p></div><div className="classroom-actions"><button type="button" className="button button-secondary" onClick={() => { setRequestFilter(requestFilter === 'active' ? 'all' : 'active'); setRequestPage(1); }}>{requestFilter === 'active' ? 'Xem toàn bộ lịch sử' : 'Chỉ xem đang xử lý'}</button><button type="button" className="button button-secondary" onClick={load}>Làm mới</button></div></div><div className="accounting-request-list">{requests.rows.map((request) => <article className="accounting-request-item" key={request._id}><div><strong>{categories[request.category]} · {money(request.amount)}</strong><p>{request.description} · {request.payee}</p><small>Người đề nghị: {request.requestedByName} · {new Date(request.createdAt).toLocaleDateString('vi-VN')}</small>{request.reviewedByName && <small>Người duyệt: {request.reviewedByName} · {request.reviewNote || 'Không ghi chú'}</small>}</div><div><span className={`accounting-request-status ${request.status}`}>{({ pending: 'Chờ duyệt', approved: 'Đã duyệt, chờ chi', rejected: 'Đã từ chối', paid: 'Đã chi' })[request.status]}</span>{request.status === 'pending' && ['admin', 'principal'].includes(role) && <div className="accounting-review-actions"><input aria-label="Ghi chú duyệt hoặc lý do từ chối" maxLength="500" placeholder="Lý do từ chối (nếu có)" value={reviewNotes[request._id] || ''} onChange={(event) => setReviewNotes((current) => ({ ...current, [request._id]: event.target.value }))} /><button type="button" className="button button-secondary" disabled={saving} onClick={() => review(request, 'rejected')}>Từ chối</button><button type="button" className="button button-primary" disabled={saving} onClick={() => review(request, 'approved')}>Duyệt</button></div>}{request.status === 'approved' && role === 'accountant' && <button type="button" className="button button-primary" onClick={() => setPaymentForm({ ...blankPayment(), requestId: request._id })}>Nhập chứng từ chi</button>}</div></article>)}{!requests.rows.length && <p className="history-empty">Không có đề nghị trong bộ lọc này.</p>}</div>{requests.total > 20 && <div className="table-pagination"><span>Trang {requestPage}/{requests.totalPages} · {requests.total} đề nghị</span><div><button type="button" disabled={requestPage <= 1} onClick={() => setRequestPage(requestPage - 1)}>‹ Trước</button><button type="button" disabled={requestPage >= requests.totalPages} onClick={() => setRequestPage(requestPage + 1)}>Sau ›</button></div></div>}</section>
      {role === 'accountant' && paymentForm.requestId && <section className="content-card student-form"><div className="card-heading"><div><p className="card-kicker">BƯỚC 3 · GHI CHI THỰC TẾ</p><h2>{money(requests.rows.find((item) => item._id === paymentForm.requestId)?.amount)} · {requests.rows.find((item) => item._id === paymentForm.requestId)?.payee}</h2><p>Chỉ nhập khi tiền đã được chi. Chứng từ sẽ vào sổ tháng thực trả; không có xác nhận tự động từ ngân hàng.</p></div><button type="button" className="button button-secondary" onClick={() => setPaymentForm(blankPayment())}>Đóng</button></div><form className="student-form-grid" onSubmit={submitPayment}>
        <label>Ngày thực chi<input required type="date" max={todaySchool()} value={paymentForm.paidAt} onChange={(event) => changePayment('paidAt', event.target.value)} /></label>
        <label>Hình thức<select value={paymentForm.method} onChange={(event) => changePayment('method', event.target.value)}><option value="bank_transfer">Chuyển khoản</option><option value="cash">Tiền mặt</option></select></label>
        <label>Số chứng từ chi<input required maxLength="120" value={paymentForm.documentNumber} onChange={(event) => changePayment('documentNumber', event.target.value)} placeholder="PC-2026-001" /></label>
        {paymentForm.method === 'bank_transfer' && <label>Mã giao dịch ngân hàng<input required maxLength="120" value={paymentForm.transactionRef} onChange={(event) => changePayment('transactionRef', event.target.value)} placeholder="Mã trên sao kê" /></label>}
        <label className="form-wide">Ghi chú<input maxLength="500" value={paymentForm.note} onChange={(event) => changePayment('note', event.target.value)} /></label>
        <div className="form-actions form-wide"><button className="button button-primary" disabled={saving}>{saving ? 'Đang ghi...' : 'Xác nhận đã chi'}</button></div>
      </form></section>}
      <section className="content-card student-list-card"><div className="card-heading"><div><p className="card-kicker">LỊCH SỬ CHI</p><h2>{state.summary.count} chứng từ trong tháng</h2></div><button type="button" className="button button-secondary" disabled={state.loading} onClick={load}>Làm mới</button></div>{state.rows.some((item) => !item.approvalRequestId) && <p className="accounting-legacy-note">Chứng từ cũ không có mã đề nghị phê duyệt trong hệ thống; cần đối chiếu hồ sơ ngoài hệ thống. Không tự gán trạng thái “đã duyệt”.</p>}<div className="table-wrap"><table className="data-table"><thead><tr><th>Ngày</th><th>Nhóm / nội dung</th><th>Người nhận</th><th>Số tiền</th><th>Chứng từ / căn cứ</th><th>Người ghi</th></tr></thead><tbody>{state.rows.map((item) => <tr key={item._id}><td>{new Date(item.paidAt).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</td><td>{categories[item.category]}<small>{item.description}</small></td><td>{item.payee}</td><td><strong>{money(item.amount)}</strong></td><td>{item.documentNumber}<small>{item.approvalReference}{item.transactionRef ? ` · ${item.transactionRef}` : ''}{!item.approvalRequestId ? ' · Căn cứ nhập thủ công' : ' · Đã duyệt trong hệ thống'}</small></td><td>{item.recordedByName}</td></tr>)}{!state.rows.length && <tr><td colSpan="6" className="history-empty">{state.loading ? 'Đang tải...' : 'Chưa có khoản chi trong tháng này.'}</td></tr>}</tbody></table></div>{state.summary.count > 0 && <div className="table-pagination"><span>Trang {page}/{state.totalPages}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Trước</button><button type="button" disabled={page >= state.totalPages} onClick={() => setPage(page + 1)}>Sau ›</button></div></div>}</section>
    </div>
  </AppShell>;
}
