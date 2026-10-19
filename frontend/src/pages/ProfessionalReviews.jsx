import { useCallback, useEffect, useState } from 'react';
import AppShell from '../components/AppShell';
import { getProfessionalReviews, reviewProfessionalAssessment } from '../api/hr';

export default function ProfessionalReviews() {
  const [reviews, setReviews] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);
  const load = useCallback(async () => {
    try { const response = await getProfessionalReviews({ page }); setReviews(response.data.data); setPagination(response.data.pagination); setError(''); }
    catch (err) { setError(err.response?.data?.message || 'Không thể tải đánh giá chuyên môn.'); }
  }, [page]);
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, [load]);
  const submit = async (event) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await reviewProfessionalAssessment(form.review._id, { version: form.review.__v, decision: form.decision, assessment: form.assessment }); setForm(null); await load(); setNotice('Đã gửi kết quả cho HR.'); }
    catch (err) { setError(err.response?.data?.message || 'Không thể lưu đánh giá.'); }
    finally { setBusy(false); }
  };
  return <AppShell title="Đánh giá chuyên môn" subtitle="Chỉ hiển thị nhân viên được phân công cho bạn xác nhận.">
    <div className="development-page"><section className="content-card development-board"><div className="card-heading"><div><p className="card-kicker">NGƯỜI PHỤ TRÁCH CHUYÊN MÔN</p><h2>Đánh giá được phân công</h2></div></div>{error && <div className="form-error" role="alert">{error}</div>}{notice && <div className="timekeeping-notice success" role="status">{notice}</div>}
      <div className="development-list">{reviews.map((review) => <article key={review._id} className="development-card"><div className="development-card-heading"><div><small>Kỳ {review.period} · {review.employeeId?.employeeCode}</small><h3>{review.employeeId?.fullName}</h3></div><span className={`development-status ${review.professionalStatus}`}>{review.professionalStatus === 'pending' ? 'Chờ xác nhận' : review.professionalStatus === 'approved' ? 'Đã xác nhận' : 'Đã yêu cầu sửa'}</span></div><p>{review.generalAssessment}</p>{review.professionalAssessment && <p><strong>Nhận xét chuyên môn:</strong> {review.professionalAssessment}</p>}{review.professionalStatus === 'pending' && <button className="button button-primary" onClick={() => { setError(''); setForm({ review, decision: 'approved', assessment: '' }); }}>Nhận xét & quyết định</button>}</article>)}{!reviews.length && <p className="development-empty">Không có đánh giá chuyên môn được phân công.</p>}</div>
      <div className="development-pagination"><span>{pagination.total} mục · Trang {pagination.page}/{pagination.totalPages}</span><div><button className="button button-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Trước</button><button className="button button-secondary" disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>Sau</button></div></div>
    </section></div>
    {form && <div className="modal-backdrop"><form className="content-card student-form hr-modal development-modal" onSubmit={submit}><div className="card-heading"><h2>{form.review.employeeId?.fullName}</h2><button type="button" className="button button-secondary" onClick={() => setForm(null)}>Đóng</button></div>{error && <div className="form-error">{error}</div>}<label>Quyết định chuyên môn<select value={form.decision} onChange={(e) => setForm({ ...form, decision: e.target.value })}><option value="approved">Xác nhận</option><option value="changes_requested">Yêu cầu HR sửa</option></select></label><label>Nhận xét chuyên môn<textarea required maxLength="2000" value={form.assessment} onChange={(e) => setForm({ ...form, assessment: e.target.value })} /></label><div className="form-actions"><button className="button button-primary" disabled={busy}>Gửi kết quả</button></div></form></div>}
  </AppShell>;
}
