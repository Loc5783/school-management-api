import { useEffect, useState } from 'react';
import { createOvertimeRequest, getMyOvertime } from '../api/timekeeping';

const status = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối', cancelled: 'Đã hủy' };
export default function OvertimeEmployee() {
  const [form, setForm] = useState({ workDate: '', requestedMinutes: '', reason: '' });
  const [requests, setRequests] = useState([]);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const load = () => getMyOvertime().then((res) => setRequests(res.data.data || [])).catch(() => setNotice('Không thể tải yêu cầu làm thêm.'));
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, []);
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setNotice('');
    try { await createOvertimeRequest({ ...form, requestedMinutes: Number(form.requestedMinutes) }); setNotice('Đã gửi yêu cầu chờ Ban giám hiệu duyệt.'); setForm({ workDate: '', requestedMinutes: '', reason: '' }); await load(); }
    catch (error) { setNotice(error.response?.data?.message || 'Không gửi được yêu cầu.'); }
    finally { setSaving(false); }
  };
  return <section className="content-card student-list-card" style={{ marginTop: 20 }}><div className="card-heading"><div><p className="card-kicker">LÀM THÊM GIỜ</p><h2>Yêu cầu xác nhận làm thêm</h2><p>Chỉ gửi khi đã có đủ lượt chấm công và ca phân công. Giờ đã duyệt mới được đưa vào kỳ lương.</p></div></div>
    {notice && <p className="timekeeping-notice">{notice}</p>}
    <form className="student-form-grid" onSubmit={submit} style={{ padding: 20 }}><label>Ngày làm việc<input type="date" value={form.workDate} onChange={(event) => setForm({ ...form, workDate: event.target.value })} required /></label><label>Số phút đề nghị<input type="number" min="1" max="720" value={form.requestedMinutes} onChange={(event) => setForm({ ...form, requestedMinutes: event.target.value })} required /></label><label className="form-wide">Lý do<textarea minLength="5" maxLength="500" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} required /></label><button className="button button-primary" disabled={saving}>{saving ? 'Đang gửi...' : 'Gửi yêu cầu'}</button></form>
    <div className="table-wrap"><table className="data-table"><thead><tr><th>Ngày</th><th>Đề nghị</th><th>Được duyệt</th><th>Lý do</th><th>Trạng thái</th></tr></thead><tbody>{requests.map((item) => <tr key={item._id}><td>{item.workDate}</td><td>{item.requestedMinutes} phút</td><td>{item.approvedMinutes || 0} phút</td><td>{item.reason}{item.reviewNote && <small>Phản hồi: {item.reviewNote}</small>}</td><td>{status[item.status] || item.status}</td></tr>)}{!requests.length && <tr><td colSpan="5" className="history-empty">Chưa có yêu cầu làm thêm.</td></tr>}</tbody></table></div>
  </section>;
}
