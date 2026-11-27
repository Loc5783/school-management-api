import { useEffect, useState } from 'react';
import Icon from '../components/Icon';
import { createMyEmployeeLeave, getMyEmployeeLeaves } from '../api/hr';

const statuses = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối', cancelled: 'Đã hủy' };
const types = { annual: 'Nghỉ phép năm', sick: 'Nghỉ ốm', personal: 'Việc riêng', maternity: 'Thai sản', unpaid: 'Nghỉ không lương' };
const dateText = (date) => date ? new Date(date).toLocaleDateString('vi-VN') : '—';

export default function MyLeaveRequests() {
  const [data, setData] = useState({ employee: null, requests: [] });
  const [form, setForm] = useState({ leaveType: 'annual', startDate: '', endDate: '', reason: '' });
  const [state, setState] = useState({ loading: true, saving: false, error: '', notice: '' });
  const load = async () => {
    setState((old) => ({ ...old, loading: true, error: '' }));
    try {
      const response = await getMyEmployeeLeaves();
      setData(response.data.data || { employee: null, requests: [] });
      setState((old) => ({ ...old, loading: false }));
    } catch (error) { setState((old) => ({ ...old, loading: false, error: error.response?.data?.message || 'Không thể tải đơn nghỉ phép.' })); }
  };
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, []);
  const submit = async (event) => {
    event.preventDefault(); setState((old) => ({ ...old, saving: true, error: '', notice: '' }));
    try {
      await createMyEmployeeLeave({ ...form, employeeId: data.employee?._id });
      setForm({ leaveType: 'annual', startDate: '', endDate: '', reason: '' });
      setState((old) => ({ ...old, saving: false, notice: 'Đã gửi đơn nghỉ phép để Ban giám hiệu duyệt.' }));
      await load();
    } catch (error) { setState((old) => ({ ...old, saving: false, error: error.response?.data?.message || 'Không thể gửi đơn nghỉ phép.' })); }
  };
  if (state.loading) return <div className="inline-loader"><span className="loading-orb" />Đang tải đơn nghỉ...</div>;
  return <div className="adjustment-workspace"><form className="adjustment-form-card content-card" onSubmit={submit}><div className="card-heading compact-heading"><div><p className="card-kicker">ĐƠN CÁ NHÂN</p><h2>Xin nghỉ phép</h2><p>{data.employee ? `${data.employee.fullName} · ${data.employee.employeeCode}` : 'Hồ sơ nhân sự chưa sẵn sàng.'}</p></div><span className="form-security"><Icon name="shield" size={15} />Chờ phê duyệt</span></div>{state.error && <div className="form-error">{state.error}</div>}{state.notice && <div className="timekeeping-notice success"><Icon name="check" size={16} />{state.notice}</div>}<div className="adjustment-form-body"><label>Loại nghỉ<select value={form.leaveType} onChange={(event) => setForm({ ...form, leaveType: event.target.value })}>{Object.entries(types).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Từ ngày<input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} required /></label><label>Đến ngày<input type="date" min={form.startDate} value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} required /></label><label className="adjustment-full-width">Lý do<textarea maxLength="500" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Nêu ngắn gọn lý do nghỉ để nhà trường sắp xếp lớp." required /></label><button className="button button-primary adjustment-submit" disabled={state.saving || !data.employee}>{state.saving ? 'Đang gửi...' : 'Gửi đơn nghỉ phép'}</button></div></form><section className="content-card adjustment-history"><div className="card-heading"><div><p className="card-kicker">LỊCH SỬ CÁ NHÂN</p><h2>Đơn đã gửi</h2></div><span className="history-count">{data.requests.length} đơn</span></div>{data.requests.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Thời gian</th><th>Loại nghỉ</th><th>Lý do</th><th>Trạng thái</th></tr></thead><tbody>{data.requests.map((request) => <tr key={request._id}><td>{dateText(request.startDate)} – {dateText(request.endDate)}</td><td>{types[request.leaveType] || request.leaveType}</td><td>{request.reason}<small>{request.rejectionReason || ''}</small></td><td><span className={`student-status ${request.status === 'approved' ? 'enrolled' : request.status === 'pending' ? 'temporarily_absent' : 'withdrawn'}`}>{statuses[request.status] || request.status}</span></td></tr>)}</tbody></table></div> : <div className="empty-state compact">Chưa có đơn nghỉ phép nào.</div>}</section></div>;
}
