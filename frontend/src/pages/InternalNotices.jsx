import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { getMyInternalAnnouncements, getMyTimesheets, respondMonthlyTimesheet } from '../api/hr';
import api from '../api/axiosConfig';

const when = (value) => value ? new Date(value).toLocaleString('vi-VN', { hour12: false }) : '—';
export default function InternalNotices() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const tab = ['announcements', 'timesheets', 'reminders'].includes(requestedTab) ? requestedTab : 'announcements';
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ data: [], pagination: { page: 1, totalPages: 1 } });
  const [reply, setReply] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const result = tab === 'announcements' ? await getMyInternalAnnouncements({ page }) : tab === 'timesheets' ? await getMyTimesheets({ page }) : await api.get('/notifications', { params: { page, limit: 10 } }); setData(result.data); setError(''); }
    catch (err) { setError(err.response?.data?.message || 'Không thể tải thông báo nội bộ.'); }
  }, [tab, page]);
  useEffect(() => { const timer = setTimeout(load, 0); return () => clearTimeout(timer); }, [load]);
  const changeTab = (next) => { setPage(1); setSearchParams({ tab: next }); };
  const respond = async (event) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await respondMonthlyTimesheet(reply.sheet._id, { status: reply.status, note: reply.note, version: reply.sheet.__v }); setReply(null); await load(); setNotice('Đã gửi phản hồi bảng công.'); }
    catch (err) { setError(err.response?.data?.message || 'Không thể gửi phản hồi.'); }
    finally { setBusy(false); }
  };
  return <AppShell title="Thông báo nội bộ" subtitle="Lịch họp, ca trực, giấy tờ và bảng công chỉ dành cho nhân viên liên quan.">
    <section className="content-card internal-panel"><div className="timekeeping-hub-tabs"><button className={tab === 'announcements' ? 'active' : ''} onClick={() => changeTab('announcements')}>Thông báo</button><button className={tab === 'timesheets' ? 'active' : ''} onClick={() => changeTab('timesheets')}>Bảng công của tôi</button><button className={tab === 'reminders' ? 'active' : ''} onClick={() => changeTab('reminders')}>Nhắc việc & giấy tờ</button></div></section>
    {error && <div className="form-error" role="alert">{error}</div>}{notice && <div className="timekeeping-notice success" role="status">{notice}</div>}
    <section className="content-card internal-panel"><div className="card-heading"><div><p className="card-kicker">{tab === 'announcements' ? 'THÔNG BÁO DÀNH CHO BẠN' : tab === 'timesheets' ? 'ĐỐI CHIẾU CÔNG THÁNG' : 'LỜI NHẮC DÀNH CHO BẠN'}</p><h2>{tab === 'announcements' ? 'Lịch và thông tin mới' : tab === 'timesheets' ? 'Xác nhận bảng công' : 'Nhắc việc & giấy tờ'}</h2></div></div>
      <div className="internal-list">{tab === 'announcements' ? (data.data || []).map((item) => <article key={item._id}><div><small>{when(item.createdAt)} · {item.category === 'meeting' ? 'Lịch họp' : item.category === 'shift' ? 'Ca trực' : 'Thông tin chung'}</small><strong>{item.title}</strong><p>{item.message}</p>{item.eventAt && <small>Thời gian: {when(item.eventAt)} {item.location && `· ${item.location}`}</small>}</div></article>) : tab === 'reminders' ? (data.data || []).map((item) => <article key={item._id}><div><small>{when(item.createdAt)}</small><strong>{item.title}</strong><p>{item.message}</p></div></article>) : (data.data || []).map((sheet) => <article key={sheet._id}><div className="internal-sheet"><div><strong>Bảng công tháng {sheet.period}</strong><small>{sheet.totalWorkdays} công · Lần gửi {sheet.revision} · {sheet.status === 'confirmed' ? 'Đã xác nhận' : sheet.status === 'disputed' ? 'Đã phản hồi' : 'Cần xác nhận'}</small></div><div className="table-wrap"><table className="data-table"><thead><tr><th>NGÀY</th><th>VÀO</th><th>RA</th><th>CÔNG</th></tr></thead><tbody>{sheet.days.map((day) => <tr key={day.workDate}><td>{day.workDate}</td><td>{when(day.checkInTime)}</td><td>{when(day.checkOutTime)}</td><td>{day.workday}</td></tr>)}</tbody></table></div>{!sheet.days.length && <p>Không có ngày công được ghi nhận trong kỳ này.</p>}{sheet.employeeNote && <p>Phản hồi của bạn: {sheet.employeeNote}</p>}{sheet.status === 'pending' && <div className="classroom-actions"><button className="button button-primary" onClick={() => { setError(''); setReply({ sheet, status: 'confirmed', note: '' }); }}>Xác nhận đúng</button><button className="button button-secondary" onClick={() => { setError(''); setReply({ sheet, status: 'disputed', note: '' }); }}>Có sai lệch</button></div>}</div></article>)}{!(data.data || []).length && <p>Chưa có mục nào.</p>}</div>
      <div className="handover-pagination"><span>Trang {data.pagination?.page || 1}/{data.pagination?.totalPages || 1}</span><div><button className="button button-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Trước</button><button className="button button-secondary" disabled={page >= (data.pagination?.totalPages || 1)} onClick={() => setPage(page + 1)}>Sau</button></div></div>
      {tab === 'timesheets' && <div className="staff-request-quick-link"><p>Phản hồi sai lệch sẽ được lưu để HR đối soát. Theo dõi câu trả lời và diễn biến tại Yêu cầu của tôi.</p><Link className="button button-secondary" to="/my-requests">Theo dõi yêu cầu</Link></div>}
    </section>
    {reply && <div className="modal-backdrop"><form className="content-card student-form hr-modal handover-modal" onSubmit={respond}><div className="card-heading"><div><p className="card-kicker">BẢNG CÔNG THÁNG {reply.sheet.period}</p><h2>{reply.status === 'confirmed' ? 'Xác nhận công' : 'Báo sai lệch cho HR'}</h2></div><button type="button" className="button button-secondary" onClick={() => setReply(null)}>Đóng</button></div>{error && <div className="form-error" role="alert">{error}</div>}<p>{reply.sheet.totalWorkdays} công · Lần gửi {reply.sheet.revision}. Sau khi xác nhận không thể tự sửa phản hồi.</p>{reply.status === 'disputed' && <label>Ngày và nội dung sai lệch<textarea required maxLength="1000" value={reply.note} onChange={(e) => setReply({ ...reply, note: e.target.value })} placeholder="Ví dụ: ngày 15/09 thiếu giờ ra ca" /></label>}<div className="form-actions"><button className="button button-primary" disabled={busy}>Gửi xác nhận</button></div></form></div>}
  </AppShell>;
}
