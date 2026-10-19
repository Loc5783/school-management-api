import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams, Link } from 'react-router-dom';
import Icon from './Icon';
import { getPersonalRequestContext, getMyPersonalRequests, getStaffPersonalRequests, getPersonalRequest, createPersonalRequest, cancelPersonalRequest, processPersonalRequest } from '../api/hr';
import './StaffPersonalRequests.css';

const TYPES = { profile_change: 'Cập nhật hồ sơ', employment_certificate: 'Xác nhận công tác', timesheet_feedback: 'Phản hồi bảng công', payroll_feedback: 'Phản hồi phiếu lương' };
const STATUS = { pending: 'Chờ tiếp nhận', in_review: 'Đang xử lý', approved: 'Đã phê duyệt', resolved: 'Đã có kết quả', rejected: 'Đã từ chối', cancelled: 'Đã rút' };
const FIELDS = { fullName: 'Họ và tên', phone: 'Số điện thoại', email: 'Email', address: 'Địa chỉ liên hệ', birthDate: 'Ngày sinh', gender: 'Giới tính', idCard: 'Giấy tờ định danh', bankName: 'Tên ngân hàng', bankAccountNumber: 'Số tài khoản nhận lương', bankAccountHolder: 'Chủ tài khoản' };
const POSITIONS = { principal: 'Hiệu trưởng', vice_principal: 'Phó hiệu trưởng', head_teacher: 'Tổ trưởng chuyên môn', teacher: 'Giáo viên', assistant_teacher: 'Trợ giảng', accountant: 'Kế toán', chef: 'Nhân viên bếp', hr: 'Nhân sự', nurse: 'Y tế', security: 'Bảo vệ', cleaner: 'Tạp vụ' };
const ACTIONS = { created: 'Gửi yêu cầu', start: 'Tiếp nhận', prepare: 'Chuẩn bị xác nhận', approve: 'Phê duyệt', reject: 'Từ chối', resolve: 'Trả kết quả', cancelled: 'Rút yêu cầu' };
const when = (value) => value ? new Date(value).toLocaleString('vi-VN', { hour12: false, timeZone: 'Asia/Ho_Chi_Minh' }) : '—';
const money = (value) => `${new Intl.NumberFormat('vi-VN').format(value || 0)} đ`;
const fieldValue = (field, value) => field === 'gender' ? ({ male: 'Nam', female: 'Nữ' }[value] || 'Chưa có') : value || 'Để trống';
const blankForm = (type = 'profile_change', referenceId = '') => ({ type, subject: TYPES[type], message: '', profile: null, referenceId, requestId: crypto.randomUUID() });

function RequestDialog({ title, onClose, busy, children }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    const oldFocus = document.activeElement;
    document.body.style.overflow = 'hidden'; dialogRef.current?.focus();
    const keyboard = (event) => {
      if (event.key === 'Escape' && !busy) closeRef.current();
      if (event.key === 'Tab') {
        const nodes = dialogRef.current?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]');
        if (!nodes?.length) { event.preventDefault(); return; }
        const first = nodes[0]; const last = nodes[nodes.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', keyboard); if (oldFocus?.isConnected) oldFocus.focus(); };
  }, [busy]);
  return createPortal(<div className="staff-request-backdrop"><section className="staff-request-dialog" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}><header><div><p className="card-kicker">YÊU CẦU NHÂN VIÊN</p><h2>{title}</h2></div><button type="button" className="button button-secondary" disabled={busy} onClick={onClose} aria-label="Đóng yêu cầu"><Icon name="close" size={18} /></button></header><div className="staff-request-dialog-body">{children}</div></section></div>, document.body);
}

export default function StaffPersonalRequests({ mode = 'mine' }) {
  const [params] = useSearchParams();
  const manage = mode === 'manage';
  const role = JSON.parse(localStorage.getItem('user') || '{}').role;
  const [type, setType] = useState(manage && role === 'accountant' ? 'payroll_feedback' : 'all');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState(() => !manage && Object.hasOwn(TYPES, params.get('type')) ? blankForm(params.get('type'), params.get('reference') || '') : null);
  const [context, setContext] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [referencePeriod, setReferencePeriod] = useState(params.get('period') || '');
  const [detail, setDetail] = useState(null);
  const [actionForm, setActionForm] = useState(null);
  const [modalError, setModalError] = useState('');
  const [busy, setBusy] = useState(false);
  const initialRequestId = params.get('request');
  const detailRequestRef = useRef(0);
  const formId = form?.requestId;
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setError('');
      try { const response = manage ? await getStaffPersonalRequests({ type, status, page }, controller.signal) : await getMyPersonalRequests({ type, status, page }, controller.signal); if (!controller.signal.aborted) setData(response.data); }
      catch (err) { if (!controller.signal.aborted) { setError(err.response?.data?.message || 'Không tải được yêu cầu.'); setData(null); } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [manage, type, status, page, refresh]);
  useEffect(() => {
    if (!formId) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setContextLoading(true); setModalError('');
      try {
        const response = await getPersonalRequestContext({ ...(referencePeriod ? { period: referencePeriod } : {}) }, controller.signal);
        if (!controller.signal.aborted) { setContext(response.data.data); setForm((current) => current?.requestId === formId ? { ...current, profile: current.profile || response.data.data.profile } : current); }
      } catch (err) { if (!controller.signal.aborted) { setModalError(err.response?.data?.message || 'Không tải được hồ sơ cá nhân.'); setContext(null); } }
      finally { if (!controller.signal.aborted) setContextLoading(false); }
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [formId, referencePeriod]);
  useEffect(() => {
    if (!initialRequestId) return undefined;
    let active = true;
    const sequence = ++detailRequestRef.current;
    const timer = setTimeout(async () => {
      setModalError(''); setDetail({ loading: true });
      try { const response = await getPersonalRequest(initialRequestId); if (active && sequence === detailRequestRef.current) setDetail(response.data.data); }
      catch (err) { if (active && sequence === detailRequestRef.current) { setDetail(null); setError(err.response?.data?.message || 'Không tải được yêu cầu.'); } }
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [initialRequestId]);
  const openDetail = async (id) => {
    const sequence = ++detailRequestRef.current;
    setModalError(''); setDetail({ loading: true });
    try { const response = await getPersonalRequest(id); if (sequence === detailRequestRef.current) setDetail(response.data.data); }
    catch (err) { if (sequence === detailRequestRef.current) { setDetail(null); setError(err.response?.data?.message || 'Không tải được yêu cầu.'); } }
  };
  const run = async (action, message, close) => {
    if (busy) return;
    setBusy(true); setModalError(''); setNotice('');
    try { await action(); close(); setNotice(message); setRefresh((value) => value + 1); }
    catch (err) { setModalError(err.response?.data?.message || 'Không thể lưu yêu cầu.'); }
    finally { setBusy(false); }
  };
  const send = (event) => {
    event.preventDefault();
    const body = { type: form.type, subject: form.subject, message: form.message, requestId: form.requestId };
    if (form.type === 'profile_change') body.changes = Object.fromEntries(Object.entries(form.profile || {}).filter(([key, value]) => value !== context?.profile[key]));
    if (form.type === 'payroll_feedback' || form.type === 'timesheet_feedback') {
      body.referenceId = form.referenceId;
      if (form.type === 'timesheet_feedback') body.referenceVersion = context?.timesheets.find((item) => item._id === form.referenceId)?.__v;
    }
    run(() => createPersonalRequest(body), 'Đã gửi yêu cầu. Bạn sẽ nhận thông báo khi có kết quả.', () => setForm(null));
  };
  const openAction = (action) => {
    const snapshot = detail.preparationSnapshot;
    const content = snapshot ? `Xác nhận ông/bà ${snapshot.fullName}, mã nhân viên ${snapshot.employeeCode}, đang công tác tại đơn vị.\nChức danh: ${POSITIONS[snapshot.position] || snapshot.position}.\nNgày bắt đầu làm việc: ${snapshot.startDate || 'Cần HR bổ sung'}.\n\nXác nhận được lập theo đề nghị của nhân viên để: ${detail.message}` : '';
    setModalError(''); setActionForm({ action, response: '', certificate: { organizationName: detail.certificate?.organizationName || '', documentNumber: detail.certificate?.documentNumber || '', content: detail.certificate?.content || content } });
  };
  const process = (event) => { event.preventDefault(); run(() => processPersonalRequest(detail._id, { version: detail.__v, ...actionForm }), 'Đã lưu kết quả xử lý.', () => { setActionForm(null); setDetail(null); }); };
  const withdraw = () => {
    if (!window.confirm('Bạn muốn rút yêu cầu này? Lịch sử vẫn được lưu. Với phản hồi bảng công, hệ thống chỉ khôi phục trạng thái trước đó nếu bảng công chưa có thay đổi khác.')) return;
    run(() => cancelPersonalRequest(detail._id, { version: detail.__v }), 'Đã rút yêu cầu.', () => setDetail(null));
  };
  const printCertificate = () => {
    document.body.classList.add('staff-request-printing');
    try { window.print(); } finally { document.body.classList.remove('staff-request-printing'); }
  };
  const summary = data?.summary || {};
  const hasReference = ['timesheet_feedback', 'payroll_feedback'].includes(form?.type);
  const references = form?.type === 'payroll_feedback' ? context?.payrolls || [] : context?.timesheets || [];
  const profileChanged = !!context && Object.entries(form?.profile || {}).some(([key, value]) => value !== context.profile[key]);
  const certificate = detail?.status === 'approved' ? detail.certificate : null;
  return <div className="staff-requests-page">
    <section className="content-card staff-requests-hero"><div><p className="card-kicker">{manage ? 'TIẾP NHẬN & XỬ LÝ' : 'KẾT NỐI VỚI BỘ PHẬN PHỤ TRÁCH'}</p><h2>{manage ? role === 'accountant' ? 'Đối soát phản hồi phiếu lương' : 'Yêu cầu của nhân viên' : 'Yêu cầu cá nhân của tôi'}</h2><p>{manage ? 'Xem nội dung, đối chiếu hồ sơ và phản hồi kết quả cho từng nhân viên.' : 'Cập nhật hồ sơ, xin xác nhận công tác hoặc báo sai lệch công và lương.'}</p></div>{!manage && <button className="button button-primary" onClick={() => { setContext(null); setModalError(''); setReferencePeriod(''); setForm(blankForm()); }}><Icon name="plus" size={18} />Gửi yêu cầu</button>}</section>
    {error && <div className="form-error" role="alert">{error}</div>}{notice && <div className="timekeeping-notice success" role="status">{notice}</div>}
    <div className="staff-request-metrics"><article><span>Chờ tiếp nhận</span><strong>{summary.pending || 0}</strong></article><article><span>Đang xử lý</span><strong>{summary.in_review || 0}</strong></article><article><span>Đã có kết quả</span><strong>{(summary.approved || 0) + (summary.resolved || 0)}</strong></article><article><span>Đã từ chối</span><strong>{summary.rejected || 0}</strong></article></div>
    <section className="content-card staff-request-board"><div className="staff-request-toolbar"><div><h3>{manage ? 'Danh sách cần theo dõi' : 'Lịch sử yêu cầu'}</h3><p>Mỗi trang 10 yêu cầu. Mở chi tiết để xem diễn biến xử lý.</p></div><div><select aria-label="Loại yêu cầu" value={type} disabled={manage && role === 'accountant'} onChange={(e) => { setType(e.target.value); setPage(1); }}><option value="all">Tất cả loại yêu cầu</option>{Object.entries(TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="Trạng thái yêu cầu" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="all">Tất cả trạng thái</option>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>
      {loading ? <div className="inline-loader">Đang tải yêu cầu...</div> : <div className="staff-request-list">{(data?.data || []).map((item) => <article key={item._id}><div className={`staff-request-symbol ${item.type}`}><Icon name={item.type === 'profile_change' ? 'card' : item.type === 'employment_certificate' ? 'shield' : item.type === 'payroll_feedback' ? 'money' : 'clock'} size={22} /></div><div className="staff-request-list-content"><div><small>{TYPES[item.type]} · {when(item.createdAt)}</small><span className={`staff-request-status ${item.status}`}>{STATUS[item.status]}</span></div><h3>{item.subject}</h3>{manage && <p><strong>{item.employeeName}</strong> · {item.employeeCode}</p>}{item.sensitive && <span className="staff-request-sensitive">Thông tin nhạy cảm · Ban giám hiệu duyệt</span>}{item.referenceSnapshot?.period && <p>Kỳ {item.referenceSnapshot.period}{item.referenceSnapshot.revision ? ` · Bảng công lần ${item.referenceSnapshot.revision}` : ''}</p>}{item.response && <p className="staff-request-response">{item.response}</p>}<button className="button button-secondary" onClick={() => openDetail(item._id)}>{manage ? 'Xem / Xử lý' : 'Xem chi tiết'}</button></div></article>)}{!data?.data?.length && <div className="staff-request-empty"><Icon name="card" size={32} /><strong>Chưa có yêu cầu trong bộ lọc này.</strong><p>{manage ? 'Yêu cầu mới của nhân viên sẽ xuất hiện tại đây.' : 'Bạn có thể gửi yêu cầu bằng nút phía trên.'}</p></div>}</div>}
      <div className="staff-request-pagination"><span>{data?.pagination?.total || 0} yêu cầu · Trang {data?.pagination?.page || 1}/{data?.pagination?.totalPages || 1}</span><div><button className="button button-secondary" disabled={loading || (data?.pagination?.page || 1) <= 1} onClick={() => setPage(data.pagination.page - 1)}>Trước</button><button className="button button-secondary" disabled={loading || (data?.pagination?.page || 1) >= (data?.pagination?.totalPages || 1)} onClick={() => setPage(data.pagination.page + 1)}>Sau</button></div></div>
    </section>
    {form && <RequestDialog title="Gửi yêu cầu cá nhân" busy={busy} onClose={() => setForm(null)}><form className="staff-request-form" onSubmit={send}>
      {modalError && <div className="form-error" role="alert">{modalError}</div>}
      <label>Loại yêu cầu<select value={form.type} disabled={busy} onChange={(e) => setForm({ ...form, type: e.target.value, subject: TYPES[e.target.value], referenceId: '' })}>{Object.entries(TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Tiêu đề<input required maxLength="160" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></label>
      {contextLoading ? <p className="staff-request-hint">Đang tải thông tin cá nhân...</p> : context && <>
        {form.type === 'profile_change' && <><p className="staff-request-hint">Điền thông tin mới. Hồ sơ chỉ thay đổi sau khi được duyệt; thông tin định danh và ngân hàng cần Ban giám hiệu phê duyệt.</p><div className="staff-request-profile-grid">{Object.entries(FIELDS).map(([field, label]) => <label key={field} className={field === 'address' ? 'staff-request-wide' : ''}>{label}{field === 'gender' ? <select value={form.profile?.gender || ''} onChange={(e) => setForm({ ...form, profile: { ...form.profile, gender: e.target.value } })}><option value="">Chưa cập nhật</option><option value="male">Nam</option><option value="female">Nữ</option></select> : <input type={field === 'birthDate' ? 'date' : field === 'email' ? 'email' : 'text'} required={field === 'fullName'} maxLength={field === 'address' ? 500 : field === 'email' ? 254 : field === 'idCard' ? 30 : field === 'bankAccountNumber' ? 40 : 120} value={form.profile?.[field] || ''} onChange={(e) => setForm({ ...form, profile: { ...form.profile, [field]: e.target.value } })} />}</label>)}</div></>}
        {form.type === 'employment_certificate' && <p className="staff-request-hint">HR chuẩn bị nội dung dựa trên hồ sơ công tác. Sau khi Ban giám hiệu duyệt, bạn có thể xem và in bản xác nhận tại chi tiết yêu cầu.</p>}
        {hasReference && <><div className="staff-request-profile-grid"><label>Tìm theo tháng (không bắt buộc)<input type="month" value={referencePeriod} onChange={(e) => { setReferencePeriod(e.target.value); setForm({ ...form, referenceId: '' }); }} /></label><label>{form.type === 'payroll_feedback' ? 'Phiếu lương đã công bố' : 'Bảng công đã nhận'}<select required value={form.referenceId} onChange={(e) => setForm({ ...form, referenceId: e.target.value })}><option value="">Chọn kỳ cần phản hồi</option>{references.map((item) => <option key={item._id} value={item._id}>{item.period || `${item.year}-${String(item.month).padStart(2, '0')}`}{item.revision ? ` · Lần ${item.revision} · ${item.totalWorkdays} công` : ` · ${money(item.netSalary)}`}</option>)}</select></label></div>{!references.length && <p className="staff-request-hint">Chưa có {form.type === 'payroll_feedback' ? 'phiếu lương đã công bố' : 'bảng công đã gửi'} trong kỳ này. Bạn có thể đổi tháng để tìm.</p>}<p className="staff-request-hint">Ghi rõ ngày hoặc khoản sai lệch. Bộ phận phụ trách sẽ đối soát và trả lời; công và số tiền không tự thay đổi khi gửi phản hồi.</p></>}
      </>}
      <label>{form.type === 'employment_certificate' ? 'Mục đích xin xác nhận' : form.type === 'profile_change' ? 'Lý do cập nhật' : 'Nội dung cần đối soát'}<textarea required minLength="5" maxLength={form.type === 'timesheet_feedback' ? 1000 : 2000} rows="4" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
      <div className="form-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => setForm(null)}>Hủy</button><button className="button button-primary" disabled={busy || contextLoading || !context || (form.type === 'profile_change' && !profileChanged) || (hasReference && !form.referenceId)}>{busy ? 'Đang gửi...' : 'Gửi yêu cầu'}</button></div>
    </form></RequestDialog>}
    {detail && !actionForm && !form && <RequestDialog title={detail.subject || 'Chi tiết yêu cầu'} busy={busy} onClose={() => { detailRequestRef.current++; setDetail(null); }}>{detail.loading ? <p>Đang tải chi tiết...</p> : <>
      {modalError && <div className="form-error" role="alert">{modalError}</div>}<div className="staff-request-detail-heading"><span className={`staff-request-status ${detail.status}`}>{STATUS[detail.status]}</span><span>{detail.employeeName} · {detail.employeeCode}</span></div><p className="staff-request-message">{detail.message}</p>
      {!!detail.changes?.length && <div className="staff-request-changes"><div><strong>Thông tin</strong><strong>Đang lưu lúc gửi</strong><strong>Đề nghị thay đổi</strong></div>{detail.changes.map((change) => <div key={change.field}><span>{FIELDS[change.field] || change.field}</span><span>{fieldValue(change.field, change.before)}</span><strong>{fieldValue(change.field, change.after)}</strong></div>)}</div>}
      {detail.sensitive && <p className="staff-request-hint">Chỉ hiệu trưởng hoặc quản trị viên có thể phê duyệt thay đổi này. HR có thể tiếp nhận và rà soát.</p>}
      {detail.referenceSnapshot?.period && <div className="staff-request-reference"><strong>Kỳ {detail.referenceSnapshot.period}</strong>{detail.type === 'payroll_feedback' ? <p>Thực lĩnh lúc gửi: {money(detail.referenceSnapshot.netSalary)} · {detail.referenceSnapshot.actualWorkDays} công</p> : <p>Bảng công lần {detail.referenceSnapshot.revision} · {detail.referenceSnapshot.totalWorkdays} công</p>}</div>}
      {detail.certificate && <div className="staff-request-certificate"><small>{detail.certificate.organizationName} · Số {detail.certificate.documentNumber}</small><h3>Xác nhận công tác{detail.status !== 'approved' ? ' — bản chuẩn bị' : ''}</h3><p>{detail.certificate.content}</p>{certificate && <><small>Phê duyệt: {certificate.issuedByName} · {when(certificate.issuedAt)}</small><button className="button button-secondary" onClick={printCertificate}>In bản xác nhận</button></>}</div>}
      {detail.response && <div className="staff-request-result"><strong>Kết quả / Phản hồi</strong><p>{detail.response}</p><small>{detail.reviewedByName} · {when(detail.reviewedAt)}</small></div>}
      <div className="staff-request-timeline"><h3>Diễn biến xử lý</h3>{(detail.events || []).map((event, index) => <div key={`${event.at}-${index}`}><span /><div><strong>{ACTIONS[event.action] || event.action}</strong><small>{event.actorName} · {when(event.at)}</small><p>{event.note}</p></div></div>)}</div>
      <div className="staff-request-detail-actions">{manage ? (detail.allowedActions || []).map((action) => <button key={action} className={`button ${action === 'approve' || action === 'resolve' ? 'button-primary' : 'button-secondary'}`} disabled={busy} onClick={() => openAction(action)}>{action === 'approve' && detail.type === 'profile_change' ? 'Duyệt & cập nhật hồ sơ' : ACTIONS[action]}</button>) : ['pending', 'in_review'].includes(detail.status) && <button className="button button-secondary" disabled={busy} onClick={withdraw}>Rút yêu cầu</button>}{!manage && detail.type === 'timesheet_feedback' && <Link className="button button-secondary" to="/internal-notices?tab=timesheets">Mở bảng công</Link>}</div>
      {manage && ['timesheet_feedback', 'payroll_feedback'].includes(detail.type) && <div className="staff-request-detail-actions"><Link className="button button-secondary" to={detail.type === 'timesheet_feedback' ? '/hr?tab=internal' : '/hr?tab=payroll'}>{detail.type === 'timesheet_feedback' ? 'Mở đối soát / gửi lại bảng công' : 'Mở quản lý bảng lương'}</Link></div>}
      {manage && !detail.allowedActions?.length && ['pending', 'in_review'].includes(detail.status) && <p className="staff-request-hint">Yêu cầu cần người có quyền phù hợp xử lý. Người gửi không được tự duyệt; phản hồi lương do kế toán đối soát.</p>}
    </>}</RequestDialog>}
    {actionForm && <RequestDialog title={ACTIONS[actionForm.action]} busy={busy} onClose={() => setActionForm(null)}><form className="staff-request-form" onSubmit={process}>
      {modalError && <div className="form-error" role="alert">{modalError}</div>}<p><strong>{detail.employeeName} · {detail.subject}</strong></p>
      {actionForm.action === 'approve' && detail.type === 'profile_change' && <p className="staff-request-hint">Phê duyệt sẽ áp dụng {detail.changes.length} thay đổi vào hồ sơ và tài khoản liên kết. Các trường khác giữ nguyên.</p>}
      {actionForm.action === 'prepare' && <><label>Tên trường / đơn vị<input required maxLength="200" value={actionForm.certificate.organizationName} onChange={(e) => setActionForm({ ...actionForm, certificate: { ...actionForm.certificate, organizationName: e.target.value } })} /></label><label>Số xác nhận<input required maxLength="80" value={actionForm.certificate.documentNumber} onChange={(e) => setActionForm({ ...actionForm, certificate: { ...actionForm.certificate, documentNumber: e.target.value } })} /></label><label>Nội dung xác nhận<textarea required maxLength="8000" rows="10" value={actionForm.certificate.content} onChange={(e) => setActionForm({ ...actionForm, certificate: { ...actionForm.certificate, content: e.target.value } })} /></label><p className="staff-request-hint">Đối chiếu hồ sơ trước khi trình duyệt. Người gửi nhận bản xác nhận sau khi Ban giám hiệu phê duyệt.</p></>}
      {actionForm.action === 'resolve' && <p className="staff-request-hint">Ghi kết quả đối soát và hướng xử lý cụ thể. Nếu cần sửa công hoặc điều chỉnh lương, thực hiện đúng quy trình tương ứng trước khi thông báo đã hoàn tất.</p>}
      <label>Phản hồi cho nhân viên<textarea required={['resolve', 'reject'].includes(actionForm.action)} minLength={['resolve', 'reject'].includes(actionForm.action) ? 5 : undefined} maxLength="2000" rows="4" value={actionForm.response} onChange={(e) => setActionForm({ ...actionForm, response: e.target.value })} /></label><div className="form-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => setActionForm(null)}>Quay lại</button><button className="button button-primary" disabled={busy}>{busy ? 'Đang lưu...' : 'Xác nhận xử lý'}</button></div>
    </form></RequestDialog>}
    {certificate && createPortal(<section className="staff-request-print"><header><h2>{certificate.organizationName}</h2><p>Số: {certificate.documentNumber}</p></header><h1>XÁC NHẬN CÔNG TÁC</h1><p className="staff-request-print-content">{certificate.content}</p><footer><p>Ngày phê duyệt: {when(certificate.issuedAt)}</p><strong>Người phê duyệt trên hệ thống</strong><p>{certificate.issuedByName}</p></footer></section>, document.body)}
  </div>;
}
