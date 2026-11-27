import { useCallback, useEffect, useState } from 'react';
import { deleteFeeSchedule, getFeeSchedules, saveFeeSchedule } from '../api/finance';
import './FeeSchedulePanel.css';

const money = (value) => `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)} đ`;
const blank = (period) => ({ period, classroomId: '', tuitionBase: '', mealFee: '0', busFee: '0', extraFee: '0', discount: '0', dueDate: '', additionalItems: [], note: '' });
const total = (item) => Number(item.tuitionBase || 0) + Number(item.mealFee || 0) + Number(item.busFee || 0) + Number(item.extraFee || 0) + (item.additionalItems || []).reduce((sum, row) => sum + Number(row.amount || 0), 0) - Number(item.discount || 0);

export default function FeeSchedulePanel({ period, classrooms, onUse }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(() => blank(period));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const response = await getFeeSchedules(period);
      setItems(response.data.data || []);
      setError('');
    } catch (requestError) { setError(requestError.response?.data?.message || 'Không tải được mức thu đã lưu.'); }
  }, [period]);
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, [load]);

  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setMessage(''); setError('');
    try {
      const response = await saveFeeSchedule({ ...form, period, tuitionBase: Number(form.tuitionBase), mealFee: Number(form.mealFee), busFee: Number(form.busFee), extraFee: Number(form.extraFee), discount: Number(form.discount), additionalItems: form.additionalItems.map((item) => ({ name: item.name.trim(), amount: Number(item.amount) })) });
      setMessage(response.data.message || 'Đã lưu mức thu.');
      setForm(blank(period));
      await load();
    } catch (requestError) { setError(requestError.response?.data?.message || 'Không thể lưu mức thu.'); }
    finally { setBusy(false); }
  };
  const remove = async (item) => {
    if (!window.confirm(`Xóa mức thu mẫu ${item.classroomName || 'tất cả lớp'} kỳ ${period}? Hóa đơn đã lập sẽ giữ nguyên.`)) return;
    setBusy(true); setMessage(''); setError('');
    try { await deleteFeeSchedule(item._id); setMessage('Đã xóa mức thu mẫu.'); await load(); }
    catch (requestError) { setError(requestError.response?.data?.message || 'Không thể xóa mức thu.'); }
    finally { setBusy(false); }
  };

  return <div className="fee-schedule-layout">
    <section className="content-card student-form"><div className="card-heading"><div><p className="card-kicker">THIẾT LẬP KHOẢN THU</p><h2>Mức thu kỳ {period}</h2><p>Lưu mẫu chung hoặc riêng theo lớp. Khi lập hóa đơn, chọn đúng mẫu cần áp dụng.</p></div></div>
      {error && <div className="form-error" role="alert">{error}</div>}{message && <div className="form-success" role="status">{message}</div>}
      <form className="student-form-grid" onSubmit={submit}>
        <label>Phạm vi áp dụng<select value={form.classroomId} onChange={(event) => setForm({ ...form, classroomId: event.target.value })}><option value="">Tất cả lớp (mức chung)</option>{classrooms.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label>
        <label>Hạn thanh toán<input type="date" required value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></label>
        {[['tuitionBase', 'Học phí chính'], ['mealFee', 'Tiền ăn'], ['busFee', 'Tiền xe'], ['extraFee', 'Khoản thu khác'], ['discount', 'Giảm trừ chung']].map(([key, label]) => <label key={key}>{label}<input type="number" min="0" required value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>)}
        <div className="form-wide invoice-extra-items"><div><label>Các khoản thu thêm</label><small>Chỉ là mẫu. Hóa đơn hiện có không được sửa tự động.</small></div>{form.additionalItems.map((item, index) => <div className="invoice-extra-row" key={index}><input aria-label={`Tên khoản thu ${index + 1}`} required maxLength="120" value={item.name} onChange={(event) => setForm({ ...form, additionalItems: form.additionalItems.map((row, i) => i === index ? { ...row, name: event.target.value } : row) })} placeholder="Tên khoản thu" /><input aria-label={`Số tiền khoản thu ${index + 1}`} required type="number" min="1" value={item.amount} onChange={(event) => setForm({ ...form, additionalItems: form.additionalItems.map((row, i) => i === index ? { ...row, amount: event.target.value } : row) })} placeholder="Số tiền" /><button type="button" className="button button-danger" onClick={() => setForm({ ...form, additionalItems: form.additionalItems.filter((_, i) => i !== index) })}>Xóa</button></div>)}<button type="button" className="button button-secondary invoice-add-item" onClick={() => setForm({ ...form, additionalItems: [...form.additionalItems, { name: '', amount: '' }] })}>＋ Thêm khoản thu</button></div>
        <label className="form-wide">Ghi chú<textarea maxLength="1000" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
        <div className="form-wide fee-schedule-total"><span>Tổng dự kiến mỗi học sinh</span><strong>{money(total(form))}</strong></div>
        <div className="form-actions form-wide"><button type="button" className="button button-secondary" onClick={() => setForm(blank(period))}>Nhập lại</button><button className="button button-primary" disabled={busy || total(form) < 0}>{busy ? 'Đang lưu...' : 'Lưu mức thu'}</button></div>
      </form>
    </section>
    <section className="content-card student-list-card"><div className="card-heading"><div><p className="card-kicker">MỨC THU ĐÃ LƯU</p><h2>{items.length} mẫu trong kỳ</h2></div></div><div className="fee-schedule-list">{items.length ? items.map((item) => <article key={item._id}><div><strong>{item.classroomName || 'Tất cả lớp'}</strong><small>Hạn {new Date(item.dueDate).toLocaleDateString('vi-VN')} · Cập nhật {new Date(item.updatedAt).toLocaleDateString('vi-VN')}</small></div><strong>{money(total(item))}</strong><div className="fee-schedule-actions"><button type="button" className="button button-secondary" onClick={() => setForm({ ...item, classroomId: item.classroomId || '', dueDate: item.dueDate.slice(0, 10), additionalItems: (item.additionalItems || []).map(({ name, amount }) => ({ name, amount })) })}>Sửa mẫu</button><button type="button" className="button button-primary" onClick={() => onUse(item)}>Dùng để lập hóa đơn</button><button type="button" className="button button-danger" disabled={busy} onClick={() => remove(item)}>Xóa</button></div></article>) : <p>Chưa có mức thu mẫu cho kỳ này.</p>}</div></section>
  </div>;
}
