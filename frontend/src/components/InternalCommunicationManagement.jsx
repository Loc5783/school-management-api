import { useCallback, useEffect, useState } from 'react';
import { getInternalOverview, publishMonthlyTimesheet, sendInternalAnnouncement } from '../api/hr';

const roles = { admin: 'Quản trị', principal: 'Hiệu trưởng', teacher: 'Giáo viên', accountant: 'Kế toán', chef: 'Nhà bếp', guard: 'Bảo vệ', hr: 'Nhân sự' };
const when = (value) => value ? new Date(value).toLocaleString('vi-VN', { hour12: false }) : '';
const freshForm = () => ({ category: 'meeting', title: '', message: '', eventAt: '', location: '', employeeIds: [], roles: [], requestId: crypto.randomUUID() });
const previousMonth = () => { const date = new Date(); return `${date.getFullYear() - (date.getMonth() === 0 ? 1 : 0)}-${String(date.getMonth() || 12).padStart(2, '0')}`; };

export default function InternalCommunicationManagement() {
  const [data, setData] = useState(null);
  const [announcementPage, setAnnouncementPage] = useState(1);
  const [timesheetPage, setTimesheetPage] = useState(1);
  const [form, setForm] = useState(freshForm);
  const [period, setPeriod] = useState('');
  const [maxPeriod] = useState(previousMonth);
  const [employeeId, setEmployeeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    try { const response = await getInternalOverview({ announcementPage, timesheetPage }); setData(response.data.data); setError(''); }
    catch (err) { setError(err.response?.data?.message || 'Không tải được thông báo nội bộ.'); }
  }, [announcementPage, timesheetPage]);
  useEffect(() => { const timer = setTimeout(load, 0); return () => clearTimeout(timer); }, [load]);
  const run = async (action, success) => {
    if (busy) return false;
    setBusy(true); setError(''); setNotice('');
    try { await action(); await load(); setNotice(success); return true; }
    catch (err) { setError(err.response?.data?.message || 'Không thể lưu thông tin.'); return false; }
    finally { setBusy(false); }
  };
  const toggle = (key, value) => setForm((current) => ({ ...current, [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value] }));
  const send = async (event) => { event.preventDefault(); const ok = await run(() => sendInternalAnnouncement({ ...form, eventAt: form.eventAt ? new Date(form.eventAt).toISOString() : null }), 'Đã gửi thông báo tới người nhận.'); if (ok) setForm(freshForm()); };
  const publish = async (event) => { event.preventDefault(); await run(() => publishMonthlyTimesheet({ employeeId, period }), 'Đã gửi bảng công cho nhân viên xác nhận.'); };
  return <div className="internal-grid">
    {error && <div className="form-error internal-full" role="alert">{error}</div>}{notice && <div className="timekeeping-notice success internal-full" role="status">{notice}</div>}
    <section className="content-card internal-panel"><div className="card-heading"><div><p className="card-kicker">THÔNG BÁO NỘI BỘ</p><h2>Gửi lịch họp, ca trực, thông tin chung</h2></div></div>
      <form className="internal-form" onSubmit={send}>
        <label>Loại thông báo<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value, eventAt: e.target.value === 'general' ? '' : form.eventAt })}><option value="meeting">Lịch họp</option><option value="shift">Ca trực</option><option value="general">Thông tin chung</option></select></label>
        <label>Tiêu đề<input required maxLength="160" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label className="internal-full">Nội dung<textarea required maxLength="2000" rows="4" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
        {form.category !== 'general' && <label>Thời gian (24 giờ)<input type="datetime-local" required value={form.eventAt} onChange={(e) => setForm({ ...form, eventAt: e.target.value })} /></label>}
        <label>Địa điểm<input maxLength="160" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
        <fieldset className="internal-full internal-recipients"><legend>Gửi theo vai trò</legend>{Object.entries(roles).map(([value, label]) => <label key={value}><input type="checkbox" checked={form.roles.includes(value)} onChange={() => toggle('roles', value)} />{label}</label>)}</fieldset>
        <fieldset className="internal-full internal-recipients"><legend>Hoặc chọn nhân viên cụ thể</legend><div className="internal-people">{(data?.employees || []).map((employee) => <label key={employee._id}><input type="checkbox" checked={form.employeeIds.includes(employee._id)} onChange={() => toggle('employeeIds', employee._id)} />{employee.fullName} <small>({roles[employee.userId?.role]})</small></label>)}</div></fieldset>
        <div className="internal-full form-actions"><button className="button button-primary" disabled={busy || (!form.roles.length && !form.employeeIds.length)}>Gửi thông báo</button></div>
      </form>
    </section>
    <section className="content-card internal-panel"><div className="card-heading"><div><p className="card-kicker">BẢNG CÔNG CẦN XÁC NHẬN</p><h2>Gửi cho từng nhân viên đối chiếu</h2></div></div>
      <p>Chỉ gửi tháng đã kết thúc, sau khi xử lý đơn điều chỉnh và chốt đủ lượt chấm. Nhân viên có thể xác nhận hoặc phản hồi để HR đối soát.</p>
      <form className="internal-form" onSubmit={publish}><label>Nhân viên<select required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}><option value="">Chọn nhân viên</option>{(data?.employees || []).map((employee) => <option key={employee._id} value={employee._id}>{employee.fullName} · {employee.employeeCode}</option>)}</select></label><label>Tháng công<input type="month" required max={maxPeriod} value={period} onChange={(e) => setPeriod(e.target.value)} /></label><div className="internal-full form-actions"><button className="button button-primary" disabled={busy}>Gửi bảng công</button></div></form>
      <div className="internal-list">{(data?.timesheets || []).map((sheet) => <article key={sheet._id}><div><strong>{sheet.employeeId?.fullName} · {sheet.period}</strong><small>{sheet.totalWorkdays} công · Lần gửi {sheet.revision}</small>{sheet.employeeNote && <p>Phản hồi: {sheet.employeeNote}</p>}</div><span className={`internal-status ${sheet.status}`}>{sheet.status === 'confirmed' ? 'Đã xác nhận' : sheet.status === 'disputed' ? 'Cần đối soát' : 'Chờ xác nhận'}</span>{sheet.status === 'disputed' && <button className="button button-secondary" disabled={busy} onClick={() => run(() => publishMonthlyTimesheet({ employeeId: sheet.employeeId?._id, period: sheet.period }), 'Đã gửi lại bảng công sau đối soát.')}>Gửi lại sau khi sửa công</button>}</article>)}{!data?.timesheets?.length && <p>Chưa có bảng công đã gửi.</p>}</div>
      <div className="handover-pagination"><span>Trang {data?.timesheetPagination.page || 1}/{data?.timesheetPagination.totalPages || 1}</span><div><button className="button button-secondary" disabled={timesheetPage <= 1} onClick={() => setTimesheetPage(timesheetPage - 1)}>Trước</button><button className="button button-secondary" disabled={timesheetPage >= (data?.timesheetPagination.totalPages || 1)} onClick={() => setTimesheetPage(timesheetPage + 1)}>Sau</button></div></div>
    </section>
    <section className="content-card internal-panel internal-full"><div className="card-heading"><div><p className="card-kicker">LỊCH SỬ GỬI</p><h2>Thông báo đã phát</h2></div></div><div className="internal-list">{(data?.announcements || []).map((item) => <article key={item._id}><div><small>{when(item.createdAt)} · {item.category === 'meeting' ? 'Lịch họp' : item.category === 'shift' ? 'Ca trực' : 'Thông tin chung'} · {item.recipientIds.length} người</small><strong>{item.title}</strong><p>{item.message}</p>{item.eventAt && <small>Thời gian: {when(item.eventAt)} {item.location && `· ${item.location}`}</small>}</div></article>)}{!data?.announcements?.length && <p>Chưa gửi thông báo nào.</p>}</div><div className="handover-pagination"><span>Trang {data?.announcementPagination.page || 1}/{data?.announcementPagination.totalPages || 1}</span><div><button className="button button-secondary" disabled={announcementPage <= 1} onClick={() => setAnnouncementPage(announcementPage - 1)}>Trước</button><button className="button button-secondary" disabled={announcementPage >= (data?.announcementPagination.totalPages || 1)} onClick={() => setAnnouncementPage(announcementPage + 1)}>Sau</button></div></div></section>
  </div>;
}
