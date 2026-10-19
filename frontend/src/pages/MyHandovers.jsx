import { useCallback, useEffect, useState } from 'react';
import AppShell from '../components/AppShell';
import { acknowledgeHandoverItem, getMyHandovers } from '../api/hr';

const labels = { classroom: 'Lớp học', shift: 'Ca làm', asset: 'Tài sản', keys: 'Chìa khóa / quyền ra vào', open_work: 'Công việc còn mở' };
export default function MyHandovers() {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    try { const response = await getMyHandovers({ page }); setData(response.data.data); setError(''); }
    catch (err) { setError(err.response?.data?.message || 'Không thể tải việc bàn giao.'); }
  }, [page]);
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, [load]);
  const submit = async (event) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await acknowledgeHandoverItem(form.plan._id, form.item._id, { version: form.plan.__v, note: form.note }); setForm(null); await load(); setNotice('Đã lưu xác nhận bàn giao.'); }
    catch (err) { setError(err.response?.data?.message || 'Không thể xác nhận bàn giao.'); }
    finally { setBusy(false); }
  };
  return <AppShell title="Việc bàn giao của tôi" subtitle="Xác nhận từng mục đã giao hoặc đã nhận trước khi HR lên lịch hoàn tất."><div className="handover-page">{error && <div className="form-error" role="alert">{error}</div>}{notice && <div className="timekeeping-notice success" role="status">{notice}</div>}<section className="content-card handover-board"><div className="card-heading"><div><p className="card-kicker">BÀN GIAO CÔNG VIỆC</p><h2>Danh sách liên quan đến bạn</h2></div></div><div className="handover-list">{data?.plans.map((plan) => { const sender = String(plan.employeeId?._id) === String(data.selfEmployeeId); return <article key={plan._id} className="handover-card"><div className="handover-card-head"><div><small>{plan.kind === 'resignation' ? 'NGHỈ VIỆC' : 'CHUYỂN VIỆC'} · {new Date(plan.effectiveAt).toLocaleString('vi-VN', { hour12: false })}</small><h3>{plan.employeeId?.fullName} → {plan.receiverEmployeeId?.fullName}</h3></div><span className={`handover-status ${plan.status}`}>{plan.status === 'draft' ? 'Đang bàn giao' : plan.status === 'scheduled' ? 'Đã lên lịch' : 'Hoàn tất'}</span></div><div className="handover-items">{plan.items.map((item) => { const canAcknowledge = plan.status === 'draft' && (sender ? !item.handedAt : item.handedAt && !item.receivedAt); return <div key={item._id}><strong>{labels[item.kind]}: {item.title}</strong><small>{item.details}</small><span>{item.handedAt ? '✓ Đã giao' : '○ Chờ giao'} · {item.receivedAt ? '✓ Đã nhận' : '○ Chờ nhận'}</span>{item.handedNote && <small>Người giao: {item.handedNote}</small>}{item.receivedNote && <small>Người nhận: {item.receivedNote}</small>}{canAcknowledge && <button className="button button-secondary" onClick={() => { setError(''); setForm({ plan, item, sender, note: '' }); }}>{sender ? 'Xác nhận đã giao' : 'Xác nhận đã nhận'}</button>}</div>; })}</div></article>; })}{data && !data.plans.length && <p className="handover-empty">Bạn chưa có việc bàn giao.</p>}</div><div className="handover-pagination"><span>{data?.pagination.total || 0} mục · Trang {data?.pagination.page || 1}/{data?.pagination.totalPages || 1}</span><div><button className="button button-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Trước</button><button className="button button-secondary" disabled={page >= (data?.pagination.totalPages || 1)} onClick={() => setPage(page + 1)}>Sau</button></div></div></section></div>
    {form && <div className="modal-backdrop"><form className="content-card student-form hr-modal handover-modal" onSubmit={submit}><div className="card-heading"><h2>{form.sender ? 'Xác nhận đã giao' : 'Xác nhận đã nhận'}</h2><button type="button" className="button button-secondary" onClick={() => setForm(null)}>Đóng</button></div><p><strong>{form.item.title}</strong></p><p>{form.item.details}</p>{error && <div className="form-error">{error}</div>}<label>Nội dung thực tế / xác nhận không có<textarea required maxLength="500" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Ghi rõ số lượng, tình trạng hoặc nội dung bàn giao" /></label><div className="form-actions"><button className="button button-primary" disabled={busy}>Xác nhận</button></div></form></div>}
  </AppShell>;
}
