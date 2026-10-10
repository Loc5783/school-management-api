import { useCallback, useEffect, useState } from 'react';
import { getEmployeeLeaves, getEmployeeLeaveOverview, reviewEmployeeLeave } from '../api/hr';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const statusLabel = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' };
const typeLabel = { annual: 'Phép năm', sick: 'Nghỉ ốm', maternity: 'Thai sản', personal: 'Việc riêng', unpaid: 'Không lương', compensatory: 'Nghỉ bù' };
const dateText = (value) => value ? new Date(value).toLocaleDateString('vi-VN') : '—';

export default function EmployeeLeaveManagement({ canApprove, onOpenStaffing }) {
  const [year, setYear] = useState(Number(today().slice(0, 4)));
  const [date, setDate] = useState(today);
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [overview, setOverview] = useState(null);
  const [requests, setRequests] = useState([]);
  const [review, setReview] = useState(null);
  const [reviewNote, setReviewNote] = useState('');
  const [state, setState] = useState({ loading: true, saving: false, error: '', notice: '' });
  const load = useCallback(async () => {
    setState((old) => ({ ...old, loading: true, error: '' }));
    try {
      const [overviewRes, requestsRes] = await Promise.all([getEmployeeLeaveOverview({ year, date }), getEmployeeLeaves({ year, page, limit: 10, ...(status && { status }) })]);
      setOverview(overviewRes.data.data);
      setRequests(requestsRes.data.data || []);
      setPagination(requestsRes.data.pagination || { page: 1, totalPages: 1, total: 0 });
      setState((old) => ({ ...old, loading: false }));
    } catch (error) { setState((old) => ({ ...old, loading: false, error: error.response?.data?.message || 'Không thể tải dữ liệu nghỉ phép.' })); }
  }, [year, date, status, page]);
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, [load]);
  const submitReview = async (event) => {
    event.preventDefault();
    if (!review) return;
    setState((old) => ({ ...old, saving: true, error: '' }));
    try {
      await reviewEmployeeLeave(review.item._id, { approved: review.approved, rejectionReason: review.approved ? '' : reviewNote });
      setReview(null); setReviewNote('');
      await load();
      setState((old) => ({ ...old, saving: false, notice: review.approved ? 'Đã duyệt đơn. Kiểm tra cảnh báo thiếu người theo ngày ở bên trên.' : 'Đã từ chối đơn.' }));
    } catch (error) { setState((old) => ({ ...old, saving: false, error: error.response?.data?.message || 'Không thể xử lý đơn nghỉ.' })); }
  };
  const impact = overview?.impact;
  return <div className="staffing-page">
    <section className="content-card staffing-heading"><div><p className="card-kicker">NGHỈ PHÉP NHÂN VIÊN</p><h2>Đơn nghỉ & ảnh hưởng phân công</h2><p>Ban giám hiệu duyệt đơn; HR theo dõi số ngày nghỉ và xếp người thay trong mục Phân công công việc.</p></div><div className="staffing-fields"><label>Năm theo dõi<input type="number" min="2000" max="2100" value={year} onChange={(event) => { setYear(Number(event.target.value)); setPage(1); }} /></label><label>Ngày kiểm tra thiếu người<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label></div></section>
    {state.error && <div className="form-error">{state.error}</div>}{state.notice && <div className="timekeeping-notice success">{state.notice}</div>}
    {state.loading ? <div className="inline-loader">Đang tổng hợp đơn nghỉ...</div> : <>
      <div className="staffing-metrics"><article><small>LỚP THIẾU GIÁO VIÊN · {date}</small><strong>{impact?.teacherShortages?.length || 0}</strong></article><article><small>GIÁO VIÊN CÒN THIẾU</small><strong>{impact?.missingTeacherTotal || 0}</strong></article><article><small>CA BẾP/BẢO VỆ CHƯA CÓ NGƯỜI</small><strong>{impact?.uncoveredShifts?.length || 0}</strong></article></div>
      {(impact?.teacherShortages?.length || impact?.uncoveredShifts?.length) > 0 && <section className="content-card staffing-section"><div className="card-heading"><div><p className="card-kicker">CẦN SẮP XẾP NGƯỜI THAY</p><h2>Thiếu người ngày {date}</h2></div><button className="button button-primary" onClick={() => onOpenStaffing(date)}>Mở phân công ngày này</button></div><div className="staffing-shift-list">{impact.teacherShortages.map((item) => <article key={item._id}><strong>Lớp {item.name}: thiếu {item.missingTeachers} giáo viên</strong></article>)}{impact.uncoveredShifts.map((item) => <article key={item._id}><strong>Ca {item.name}: chưa có người thay {item.employeeName}</strong></article>)}</div></section>}
      <section className="content-card staffing-section"><div className="card-heading"><div><p className="card-kicker">THEO DÕI NĂM {year}</p><h2>Số ngày nghỉ theo nhân viên</h2><p>Ngày của đơn mới tính theo lịch làm việc khi gửi đơn. Đơn cũ chưa lưu lịch ca được đánh dấu để HR đối soát.</p></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Nhân viên</th><th>Vai trò</th><th>Đã duyệt</th><th>Chờ duyệt</th><th>Theo loại nghỉ</th></tr></thead><tbody>{overview?.employees?.map((item) => <tr key={item._id}><td><strong>{item.fullName}</strong><small>{item.employeeCode}</small></td><td>{item.payrollRole}</td><td>{item.approvedDays} ngày{item.legacyDays > 0 && <small>{item.legacyDays} ngày từ đơn cũ cần đối soát</small>}</td><td>{item.pendingDays} ngày</td><td>{Object.entries(item.byType).map(([type, count]) => `${typeLabel[type] || type}: ${count}`).join(' · ') || '—'}</td></tr>)}</tbody></table></div></section>
      <section className="content-card staffing-section"><div className="card-heading"><div><p className="card-kicker">QUY TRÌNH PHÊ DUYỆT</p><h2>Danh sách đơn nghỉ</h2></div><label>Trạng thái<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="pending">Chờ duyệt</option><option value="approved">Đã duyệt</option><option value="rejected">Từ chối</option><option value="">Tất cả</option></select></label></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Nhân viên</th><th>Khoảng nghỉ</th><th>Số ngày</th><th>Loại / lý do</th><th>Trạng thái</th><th>Người duyệt</th><th>Thao tác</th></tr></thead><tbody>{requests.map((item) => <tr key={item._id}><td>{item.employeeName}</td><td>{dateText(item.startDate)} – {dateText(item.endDate)}</td><td>{item.totalDays}</td><td>{typeLabel[item.leaveType] || item.leaveType}<small>{item.reason}</small></td><td>{statusLabel[item.status] || item.status}</td><td>{item.approvedByName || '—'}{item.approvedAt && <small>{dateText(item.approvedAt)}</small>}{item.rejectionReason && <small>{item.rejectionReason}</small>}</td><td>{canApprove && item.status === 'pending' ? <div className="classroom-actions"><button className="button button-primary" onClick={() => { setReview({ item, approved: true }); setReviewNote(''); }}>Duyệt</button><button className="button button-secondary" onClick={() => { setReview({ item, approved: false }); setReviewNote(''); }}>Từ chối</button></div> : '—'}</td></tr>)}{!requests.length && <tr><td colSpan="7" className="history-empty">Không có đơn nghỉ phù hợp.</td></tr>}</tbody></table></div><div className="form-actions"><span>{pagination.total} đơn · Trang {pagination.page}/{Math.max(1, pagination.totalPages)}</span><button className="button button-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Trang trước</button><button className="button button-secondary" disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>Trang sau</button></div></section>
    </>}
    {review && <div className="modal-backdrop"><form className="content-card student-form hr-modal" onSubmit={submitReview}><div className="card-heading"><div><p className="card-kicker">DUYỆT ĐƠN NGHỈ</p><h2>{review.item.employeeName}</h2><p>{dateText(review.item.startDate)} – {dateText(review.item.endDate)} · {review.item.totalDays} ngày</p></div><button type="button" className="button button-secondary" onClick={() => setReview(null)}>Đóng</button></div><p>Đơn được duyệt sẽ ảnh hưởng ngay tới cảnh báo thiếu giáo viên và ca trực theo ngày.</p>{!review.approved && <label>Lý do từ chối<textarea minLength="5" maxLength="500" required value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /></label>}<div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setReview(null)}>Hủy</button><button className="button button-primary" disabled={state.saving}>{state.saving ? 'Đang xử lý...' : review.approved ? 'Xác nhận duyệt' : 'Xác nhận từ chối'}</button></div></form></div>}
  </div>;
}
