import { useCallback, useEffect, useState } from 'react';
import AppShell from '../components/AppShell';
import { getExpenseOrders, getPurchaseExpenses, recordPurchaseExpense } from '../api/finance';
import './AccountingExpenses.css';

const schoolToday = () => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
};
const currentMonth = () => schoolToday().slice(0, 7);
const asPeriod = (month) => `${month.slice(5, 7)}-${month.slice(0, 4)}`;
const money = (value) => `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)} đ`;
const freshForm = () => ({ orderId: '', amount: '', paidAt: schoolToday(), method: 'bank_transfer', transactionRef: '', documentNumber: '', note: '', idempotencyKey: crypto.randomUUID() });

export default function AccountingExpenses() {
  const role = JSON.parse(localStorage.getItem('user') || '{}').role;
  const canRecord = ['admin', 'accountant'].includes(role);
  const [month, setMonth] = useState(currentMonth);
  const [page, setPage] = useState(1);
  const [orders, setOrders] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState({ count: 0, total: 0 });
  const [totalPages, setTotalPages] = useState(1);
  const [form, setForm] = useState(freshForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const period = asPeriod(month);
  const selected = orders.find((order) => order._id === form.orderId);
  const remaining = selected ? selected.totalAmount - (selected.paidAmount || 0) : 0;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [orderResponse, expenseResponse] = await Promise.all([getExpenseOrders(), getPurchaseExpenses(asPeriod(month), page)]);
      setOrders(orderResponse.data.data || []);
      setExpenses(expenseResponse.data.data || []);
      setSummary(expenseResponse.data.summary || { count: 0, total: 0 });
      setTotalPages(expenseResponse.data.pagination?.totalPages || 1);
      setError('');
    } catch (requestError) { setError(requestError.response?.data?.message || 'Không tải được sổ chi mua sắm.'); }
    finally { setLoading(false); }
  }, [month, page]);
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, [load]);

  const changeField = (key, value) => {
    setError('');
    const newOrder = key === 'orderId' ? orders.find((order) => order._id === value) : null;
    setForm((current) => ({ ...current, [key]: value,
      ...(key === 'orderId' ? { amount: newOrder ? String(newOrder.totalAmount - (newOrder.paidAmount || 0)) : '' } : {}),
      ...(key === 'method' && value === 'cash' ? { transactionRef: '' } : {}),
      idempotencyKey: crypto.randomUUID() }));
  };
  const submit = async (event) => {
    event.preventDefault();
    if (saving || !selected) return;
    if (!window.confirm(`Ghi nhận đã chi ${money(form.amount)} cho đơn ${selected.orderCode}? Đây là tiền thực chi, không phải chỉ là đơn đặt hàng.`)) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await recordPurchaseExpense({ orderId: form.orderId, amount: Number(form.amount), paidAt: form.paidAt, method: form.method, transactionRef: form.transactionRef.trim(), documentNumber: form.documentNumber.trim(), note: form.note.trim() }, form.idempotencyKey);
      setNotice(response.data.message || 'Đã ghi nhận khoản chi.');
      setForm(freshForm()); setPage(1); await load();
    } catch (requestError) { setError(requestError.response?.data?.message || 'Chưa rõ khoản chi đã ghi nhận chưa. Giữ nguyên thông tin và thử lại để tránh ghi trùng.'); }
    finally { setSaving(false); }
  };

  return <AppShell title="Sổ chi mua sắm" subtitle="Chỉ ghi tiền thực chi cho đơn đã giao, có chứng từ để đối soát.">
    <div className="accounting-expenses">
      <section className="content-card accounting-expense-summary"><div><p className="card-kicker">CHI MUA SẮM ĐÃ GHI NHẬN</p><h2>{money(summary.total)}</h2><span>{summary.count} khoản chi · kỳ {period}. Chưa bao gồm lương và khoản chi ngoài đơn mua sắm.</span></div><label>Chọn tháng<input type="month" value={month} onChange={(event) => { if (event.target.value) { setMonth(event.target.value); setPage(1); } }} /></label></section>
      {error && <div className="form-error" role="alert">{error}</div>}{notice && <div className="form-success" role="status">{notice}</div>}
      {canRecord && <section className="content-card student-form"><div className="card-heading"><div><p className="card-kicker">CHỨNG TỪ CHI</p><h2>Ghi nhận thanh toán cho đơn đã giao</h2><p>Có thể chi nhiều lần nhưng tổng không vượt giá trị đơn. Đơn đang đặt hoặc đã hủy không được ghi chi.</p></div></div><form className="student-form-grid" onSubmit={submit}>
        <label className="form-wide">Đơn mua sắm đã giao<select required value={form.orderId} onChange={(event) => changeField('orderId', event.target.value)}><option value="">Chọn đơn chưa thanh toán đủ</option>{orders.map((order) => <option key={order._id} value={order._id}>{order.orderCode} · {order.supplierName} · còn {money(order.totalAmount - (order.paidAmount || 0))}</option>)}</select></label>
        {selected && <div className="form-wide accounting-order-balance">Tổng đơn {money(selected.totalAmount)} · Đã chi {money(selected.paidAmount)} · Còn lại <strong>{money(remaining)}</strong></div>}
        <label>Số tiền chi (VNĐ)<input type="number" min="1" max={remaining || undefined} step="1" required value={form.amount} onChange={(event) => changeField('amount', event.target.value)} /></label>
        <label>Ngày chi<input type="date" max={schoolToday()} required value={form.paidAt} onChange={(event) => changeField('paidAt', event.target.value)} /></label>
        <label>Hình thức<select value={form.method} onChange={(event) => changeField('method', event.target.value)}><option value="bank_transfer">Chuyển khoản</option><option value="cash">Tiền mặt</option></select></label>
        <label>Số chứng từ<input required maxLength="120" value={form.documentNumber} onChange={(event) => changeField('documentNumber', event.target.value)} placeholder="Ví dụ: PC-2026-001" /></label>
        {form.method === 'bank_transfer' && <label className="form-wide">Mã giao dịch ngân hàng<input required maxLength="120" value={form.transactionRef} onChange={(event) => changeField('transactionRef', event.target.value)} placeholder="Mã trên sao kê" /></label>}
        <label className="form-wide">Ghi chú<input maxLength="500" value={form.note} onChange={(event) => changeField('note', event.target.value)} placeholder="Nội dung thanh toán" /></label>
        <div className="form-actions form-wide"><button className="button button-primary" disabled={saving || !selected}>{saving ? 'Đang ghi nhận...' : 'Ghi nhận đã chi'}</button></div>
      </form></section>}
      <section className="content-card student-list-card"><div className="card-heading"><div><p className="card-kicker">LỊCH SỬ CHI</p><h2>Chứng từ trong kỳ {period}</h2></div><button type="button" className="button button-secondary" onClick={load} disabled={loading}>Làm mới</button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Ngày chi</th><th>Đơn / nhà cung cấp</th><th>Số tiền</th><th>Hình thức / mã giao dịch</th><th>Chứng từ</th><th>Người ghi</th></tr></thead><tbody>{expenses.map((item) => <tr key={item._id}><td>{new Date(item.paidAt).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</td><td>{item.orderCode}<small>{item.supplierName}</small></td><td><strong>{money(item.amount)}</strong></td><td>{item.method === 'cash' ? 'Tiền mặt' : `Chuyển khoản · ${item.transactionRef}`}</td><td>{item.documentNumber}</td><td>{item.recordedByName}</td></tr>)}{!expenses.length && <tr><td colSpan="6" className="history-empty">{loading ? 'Đang tải...' : 'Chưa có khoản chi trong kỳ.'}</td></tr>}</tbody></table></div>{summary.count > 0 && <div className="table-pagination"><span>Trang {page}/{totalPages} · {summary.count} chứng từ</span><div><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Trước</button><button type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Sau ›</button></div></div>}</section>
    </div>
  </AppShell>;
}
