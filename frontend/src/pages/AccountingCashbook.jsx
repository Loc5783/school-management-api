import { useCallback, useEffect, useState } from 'react';
import AppShell from '../components/AppShell';
import { getCashbook, saveCashReconciliation } from '../api/finance';
import './AccountingCashbook.css';

const keys = ['cashIn', 'cashOut', 'bankIn', 'bankOut', 'walletIn', 'walletOut'];
const labels = { cashIn: 'Tiền mặt thu', cashOut: 'Tiền mặt chi', bankIn: 'Chuyển khoản thu', bankOut: 'Chuyển khoản chi', walletIn: 'Ví điện tử thu', walletOut: 'Ví điện tử chi' };
const sourceText = { tuition: 'Thu học phí', tuition_refund: 'Hoàn học phí', purchase: 'Chi mua sắm', operating: 'Chi vận hành', payroll: 'Chi lương' };
const methodText = { cash: 'Tiền mặt', bank_transfer: 'Chuyển khoản', ewallet: 'Ví điện tử', unknown: 'Chưa xác định' };
const statusText = { not_recorded: 'Chưa đối soát', matched: 'Khớp số', difference: 'Có chênh lệch', stale: 'Sổ đã thay đổi', needs_review: 'Cần rà chứng từ' };
const money = (value) => `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)} đ`;
const todaySchool = () => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
};
const blankActual = () => Object.fromEntries(keys.map((key) => [key, '0']));

export default function AccountingCashbook() {
  const role = JSON.parse(localStorage.getItem('user') || '{}').role;
  const canSave = ['admin', 'accountant'].includes(role);
  const today = todaySchool();
  const [filter, setFilter] = useState({ from: `${today.slice(0, 7)}-01`, to: today });
  const [query, setQuery] = useState({ from: `${today.slice(0, 7)}-01`, to: today, page: 1 });
  const [state, setState] = useState({ loading: true, rows: [], daily: [], overall: {}, pagination: { page: 1, total: 0, totalPages: 1 } });
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ actual: blankActual(), evidenceReference: '', note: '', changeReason: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [modalError, setModalError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true }));
    try {
      const response = await getCashbook(query);
      setState({ loading: false, rows: response.data.data || [], daily: response.data.daily || [], overall: response.data.overall || {}, pagination: response.data.pagination || { page: 1, total: 0, totalPages: 1 } });
      setError('');
    } catch (requestError) { setState((current) => ({ ...current, loading: false })); setError(requestError.response?.data?.message || 'Không tải được sổ đối soát.'); }
  }, [query]);
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, [load]);

  const openDay = (day) => {
    setSelected(day); setModalError('');
    setForm({ actual: Object.fromEntries(keys.map((key) => [key, String(day.reconciliation?.actual?.[key] ?? day[key] ?? 0)])),
      evidenceReference: day.reconciliation?.evidenceReference || '', note: day.reconciliation?.note || '', changeReason: '' });
  };
  const save = async (event) => {
    event.preventDefault();
    if (!selected || saving) return;
    setSaving(true); setModalError(''); setNotice('');
    try {
      const response = await saveCashReconciliation({ workDate: selected.workDate,
        actual: Object.fromEntries(keys.map((key) => [key, Number(form.actual[key])])),
        evidenceReference: form.evidenceReference.trim(), note: form.note.trim(),
        changeReason: form.changeReason.trim(), expectedRevision: selected.reconciliation?.revision || 0 });
      setSelected(null); setNotice(response.data.message || 'Đã lưu đối soát.'); await load();
    } catch (requestError) { setModalError(requestError.response?.data?.message || 'Không thể lưu đối soát. Hãy kiểm tra mạng và tải lại trước khi thử lại.'); }
    finally { setSaving(false); }
  };
  const page = state.pagination.page;
  const totals = state.overall;

  return <AppShell title="Đối soát thu – chi" subtitle="Sổ nội bộ theo ngày giao dịch; so với sổ quỹ và sao kê do kế toán nhập.">
    <div className="accounting-cashbook">
      <section className="content-card cashbook-toolbar"><div><p className="card-kicker">SỔ DÒNG TIỀN NỘI BỘ</p><h2>Tra cứu giao dịch</h2><p>Khớp số nhập tay không đồng nghĩa ngân hàng đã xác nhận. Lương tính theo ngày chi trả, không theo tháng lương.</p></div><div className="cashbook-filters"><label>Từ ngày<input type="date" value={filter.from} onChange={(event) => setFilter({ ...filter, from: event.target.value })} /></label><label>Đến ngày<input type="date" value={filter.to} onChange={(event) => setFilter({ ...filter, to: event.target.value })} /></label><button className="button button-primary" onClick={() => setQuery({ ...filter, page: 1 })}>Xem sổ</button></div></section>
      {error && <div className="form-error" role="alert">{error}</div>}{notice && <div className="form-success" role="status">{notice}</div>}
      <section className="cashbook-totals">{[['Tiền mặt thu', totals.cashIn], ['Tiền mặt chi', totals.cashOut], ['Chuyển khoản thu', totals.bankIn], ['Chuyển khoản chi', totals.bankOut], ['Ví thu', totals.walletIn], ['Ví chi', totals.walletOut]].map(([label, value]) => <article className="content-card" key={label}><small>{label}</small><strong>{money(value)}</strong></article>)}</section>
      {(totals.issues > 0 || totals.unknownAmount > 0) && <div className="form-error" role="alert">{totals.issues || 0} giao dịch cần rà chứng từ; {money(totals.unknownAmount)} chưa xác định hình thức thanh toán. Các khoản này không được tự phân vào tiền mặt/ngân hàng.</div>}
      <section className="content-card student-list-card"><div className="card-heading"><div><p className="card-kicker">THEO NGÀY</p><h2>Đối chiếu số thực tế</h2></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Ngày</th><th>Thu nội bộ</th><th>Chi nội bộ</th><th>Vấn đề</th><th>Trạng thái</th><th></th></tr></thead><tbody>{state.daily.map((day) => <tr key={day.workDate}><td>{day.workDate}</td><td>{money(day.cashIn + day.bankIn + day.walletIn)}</td><td>{money(day.cashOut + day.bankOut + day.walletOut)}</td><td>{day.issues ? `${day.issues} chứng từ cần rà` : day.unknownAmount ? 'Thiếu hình thức chi' : '—'}</td><td><span className={`cashbook-status ${day.reconciliation?.status || 'not_recorded'}`}>{statusText[day.reconciliation?.status || 'not_recorded']}</span></td><td>{canSave && day.workDate <= today && <button type="button" className="button button-secondary" onClick={() => openDay(day)}>{day.reconciliation ? 'Xem / sửa' : 'Nhập đối chiếu'}</button>}</td></tr>)}</tbody></table></div></section>
      <section className="content-card student-list-card"><div className="card-heading"><div><p className="card-kicker">CHI TIẾT</p><h2>{state.pagination.total} giao dịch trong khoảng ngày</h2></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Ngày</th><th>Nguồn</th><th>Đối tượng</th><th>Thu / chi</th><th>Phương thức</th><th>Mã / chứng từ</th><th>Kiểm tra</th></tr></thead><tbody>{state.rows.map((row) => <tr key={`${row.source}-${row.id}`}><td>{new Date(row.paidAt).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</td><td>{sourceText[row.source]}</td><td>{row.party}</td><td>{row.direction === 'in' ? '+' : '−'}{money(row.amount)}</td><td>{methodText[row.method] || row.method}</td><td>{row.reference || row.documentNumber || '—'}</td><td>{row.issue || '—'}</td></tr>)}{!state.rows.length && <tr><td colSpan="7" className="history-empty">{state.loading ? 'Đang tải...' : 'Chưa có giao dịch trong khoảng ngày này.'}</td></tr>}</tbody></table></div><div className="table-pagination"><span>Trang {page}/{state.pagination.totalPages}</span><div><button type="button" disabled={page <= 1} onClick={() => setQuery({ ...query, page: page - 1 })}>‹ Trước</button><button type="button" disabled={page >= state.pagination.totalPages} onClick={() => setQuery({ ...query, page: page + 1 })}>Sau ›</button></div></div></section>
    </div>
    {selected && <div className="modal-backdrop"><form className="content-card student-form cashbook-modal" onSubmit={save}><div className="card-heading"><div><p className="card-kicker">ĐỐI CHIẾU THỦ CÔNG</p><h2>Ngày {selected.workDate}</h2><p>Nhập tổng thực tế từ sổ quỹ/sao kê. Mọi lần sửa được lưu lịch sử và cần lý do.</p></div><button type="button" className="button button-secondary" disabled={saving} onClick={() => setSelected(null)}>Đóng</button></div>{modalError && <div className="form-error" role="alert">{modalError}</div>}
      <div className="student-form-grid">{keys.map((key) => <label key={key}>{labels[key]}<input type="number" min="0" step="1" required value={form.actual[key]} onChange={(event) => setForm({ ...form, actual: { ...form.actual, [key]: event.target.value } })} /><small>Sổ nội bộ: {money(selected[key])} · Chênh lệch: {money(Number(form.actual[key] || 0) - selected[key])}</small></label>)}
        <label className="form-wide">Mã sổ quỹ / sao kê / chứng từ đối chiếu<input required maxLength="120" value={form.evidenceReference} onChange={(event) => setForm({ ...form, evidenceReference: event.target.value })} /></label>
        <label className="form-wide">Ghi chú<textarea maxLength="1000" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
        {selected.reconciliation && <label className="form-wide">Lý do sửa bản đối soát<input required minLength="5" maxLength="500" value={form.changeReason} onChange={(event) => setForm({ ...form, changeReason: event.target.value })} /></label>}
      </div><div className="form-actions"><button className="button button-primary" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu đối chiếu'}</button></div>
      {selected.reconciliation?.history?.length > 0 && <div className="cashbook-history"><strong>Lịch sử {selected.reconciliation.history.length} lần lưu</strong>{selected.reconciliation.history.slice().reverse().map((entry) => <p key={entry.revision}>Lần {entry.revision} · {entry.changedByName} · {new Date(entry.changedAt).toLocaleString('vi-VN')} · {entry.changeReason || 'Lập lần đầu'}</p>)}</div>}
    </form></div>}
  </AppShell>;
}
