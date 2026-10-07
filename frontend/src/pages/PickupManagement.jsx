import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import StudentPagination from '../components/StudentPagination';
import api from '../api/axiosConfig';
import { useSearchParams } from 'react-router-dom';
import QRCodeImage from '../components/QRCodeImage';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dateText = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('vi-VN') : '—';
const statusText = { scheduled: 'Chờ bàn giao', confirmed: 'Đã bàn giao', cancelled: 'Đã hủy' };
const emptyPicker = { fullName: '', phone: '', relationship: '', photoURL: '', vehicleType: '', vehiclePlate: '', isActive: true };
const emptyOtpPicker = { studentId: '', fullName: '', phone: '', relationship: '', identityCardLast4: '', photoURL: '', vehicleType: '', vehiclePlate: '' };

export default function PickupManagement() {
  const [searchParams] = useSearchParams();
  const role = JSON.parse(localStorage.getItem('user') || '{}').role;
  const isParent = role === 'parent';
  const [students, setStudents] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [pickupDate, setPickupDate] = useState(today());
  const [records, setRecords] = useState([]);
  const [recordPage, setRecordPage] = useState(1);
  const [pickers, setPickers] = useState([]);
  const [form, setForm] = useState({ pickerId: '', expectedPickupTime: '', note: '' });
  const [pickerForm, setPickerForm] = useState(emptyPicker);
  const [pickerToRemove, setPickerToRemove] = useState(null);
  const [confirmationRecord, setConfirmationRecord] = useState(null);
  const [identityVerified, setIdentityVerified] = useState(false);
  const [confirmationNote, setConfirmationNote] = useState('');
  const [photoCompared, setPhotoCompared] = useState(false);
  const [vehicleCompared, setVehicleCompared] = useState(false);
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [otpStudents, setOtpStudents] = useState([]);
  const [otpSearch, setOtpSearch] = useState('');
  const [otpForm, setOtpForm] = useState(emptyOtpPicker);
  const [otpChallenge, setOtpChallenge] = useState(null);
  const [otpCode, setOtpCode] = useState('');
  const [recordSearch, setRecordSearch] = useState('');
  const [recordStatus, setRecordStatus] = useState('');
  const [state, setState] = useState({ loading: true, saving: false, error: '', success: '' });
  const selected = useMemo(() => students.find((item) => item._id === selectedId), [students, selectedId]);

  const loadStudents = useCallback(async () => {
    if (!isParent) return;
    const response = await api.get('/students', { params: { status: 'all', limit: 100, sortBy: 'fullName' } });
    const items = response.data.data || [];
    const details = await Promise.all(items.map((student) => api.get(`/students/${student._id}`)));
    const enriched = details.map((response, index) => response.data.data || items[index]);
    setStudents(enriched); setSelectedId((value) => value || enriched[0]?._id || '');
  }, [isParent]);
  const loadRecords = useCallback(async () => {
    const response = await api.get('/pickups', { params: { pickupDate, ...(isParent && selectedId ? { studentId: selectedId } : {}) } });
    setRecords(response.data.data || []);
  }, [isParent, pickupDate, selectedId]);
  const load = useCallback(async () => {
    try { setState((old) => ({ ...old, loading: true, error: '' })); await loadStudents(); await loadRecords(); setState((old) => ({ ...old, loading: false })); }
    catch (error) { setState({ loading: false, saving: false, success: '', error: error.response?.data?.message || 'Không thể tải lịch đón trẻ.' }); }
  }, [loadRecords, loadStudents]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (selected) setPickers(selected.authorizedPickers || []); }, [selected]);
  useEffect(() => { if (!state.loading) loadRecords().catch((error) => setState((old) => ({ ...old, error: error.response?.data?.message || 'Không thể tải lịch đón trẻ.' }))); }, [loadRecords, pickupDate, selectedId, state.loading]);

  const savePickers = async () => {
    if (!selected) return;
    try { setState((old) => ({ ...old, saving: true, error: '', success: '' }));
      const authorizedPickers = pickers.map((picker) => {
        const { _id, ...rest } = picker;
        return String(_id || '').startsWith('new-') ? rest : { _id, ...rest };
      });
      await api.post('/student-profile-change-requests', { studentId: selected._id, changes: { authorizedPickers } });
      setState({ loading: false, saving: false, error: '', success: 'Đã gửi thay đổi danh sách người đón để nhà trường phê duyệt.' });
    } catch (error) { setState((old) => ({ ...old, saving: false, error: error.response?.data?.message || 'Không thể lưu người được ủy quyền.', success: '' })); }
  };
  const addPicker = () => {
    if (!pickerForm.fullName.trim()) return setState((old) => ({ ...old, error: 'Vui lòng nhập họ tên người được ủy quyền.', success: '' }));
    setPickers((items) => [...items, { ...pickerForm, fullName: pickerForm.fullName.trim(), _id: `new-${Date.now()}` }]); setPickerForm(emptyPicker); setState((old) => ({ ...old, error: '' }));
  };
  const removePicker = async () => {
    if (pickerToRemove == null) return;
    const remaining = pickers.filter((_, index) => index !== pickerToRemove);
    try {
      setState((old) => ({ ...old, saving: true, error: '', success: '' }));
      const authorizedPickers = remaining.map((picker) => {
        const { _id, ...rest } = picker;
        return String(_id || '').startsWith('new-') ? rest : { _id, ...rest };
      });
      setPickerToRemove(null);
      await api.post('/student-profile-change-requests', { studentId: selected._id, changes: { authorizedPickers } });
      setState({ loading: false, saving: false, error: '', success: 'Đã gửi yêu cầu xóa người được ủy quyền để nhà trường phê duyệt.' });
    } catch (error) {
      setState((old) => ({ ...old, saving: false, error: error.response?.data?.message || 'Không thể xóa người được ủy quyền.', success: '' }));
    }
  };
  const submitPickup = async (event) => {
    event.preventDefault();
    if (!selected || !form.pickerId) return;
    try { setState((old) => ({ ...old, saving: true, error: '', success: '' }));
      await api.post('/pickups', { studentId: selected._id, pickupDate, ...form });
      setForm({ pickerId: '', expectedPickupTime: '', note: '' }); await loadRecords();
      setState({ loading: false, saving: false, error: '', success: 'Đã gửi đăng ký đón trẻ. Vui lòng nhắc người đón mang giấy tờ tùy thân.' });
    } catch (error) { setState((old) => ({ ...old, saving: false, error: error.response?.data?.message || 'Không thể đăng ký đón trẻ.', success: '' })); }
  };
  const confirm = async (id) => {
    try { setState((old) => ({ ...old, saving: true, error: '', success: '' })); await api.patch(`/pickups/${id}/confirm`, { identityVerified, confirmationNote, photoCompared, vehicleCompared }); await loadRecords(); setConfirmationRecord(null); setState({ loading: false, saving: false, error: '', success: 'Đã xác nhận bàn giao trẻ và gửi thông báo cho phụ huynh.' }); }
    catch (error) { setState((old) => ({ ...old, saving: false, error: error.response?.data?.message || 'Không thể xác nhận bàn giao.', success: '' })); }
  };
  const searchOtpStudents = async () => {
    try { const response = await api.get('/guard/students', { params: { search: otpSearch, page: 1 } }); setOtpStudents(response.data.data || []); }
    catch (error) { setState((old) => ({ ...old, error: error.response?.data?.message || 'Không thể tìm học sinh.' })); }
  };
  const requestOtp = async (event) => {
    event.preventDefault();
    try { setState((old) => ({ ...old, saving: true, error: '', success: '' })); const response = await api.post('/guard/pickup-otp', otpForm); setOtpChallenge(response.data.data); setState((old) => ({ ...old, saving: false, success: response.data.message })); }
    catch (error) { setState((old) => ({ ...old, saving: false, error: error.response?.data?.message || 'Không thể gửi OTP.' })); }
  };
  const verifyOtp = async () => {
    try { setState((old) => ({ ...old, saving: true, error: '', success: '' })); await api.post(`/guard/pickup-otp/${otpChallenge.challengeId}/verify`, { otp: otpCode }); await loadRecords(); setShowOtpModal(false); setOtpChallenge(null); setOtpCode(''); setOtpForm(emptyOtpPicker); setState((old) => ({ ...old, saving: false, success: 'OTP hợp lệ. Đã tạo lịch đón thay trong hôm nay.' })); }
    catch (error) { setState((old) => ({ ...old, saving: false, error: error.response?.data?.message || 'Không thể xác nhận OTP.' })); }
  };
  const cancel = async (id) => {
    try { setState((old) => ({ ...old, saving: true, error: '', success: '' })); await api.patch(`/pickups/${id}/cancel`, {}); await loadRecords(); setState({ loading: false, saving: false, error: '', success: 'Đã hủy lịch đón trẻ.' }); }
    catch (error) { setState((old) => ({ ...old, saving: false, error: error.response?.data?.message || 'Không thể hủy lịch đón trẻ.', success: '' })); }
  };
  const visibleRecords = records.filter((record) => (!searchParams.get('studentId') || String(record.studentId) === searchParams.get('studentId')) && (!recordStatus || record.status === recordStatus) && `${record.studentName} ${record.className} ${record.picker?.fullName}`.toLocaleLowerCase('vi').includes(recordSearch.toLocaleLowerCase('vi')));
  const currentRecordPage = Math.min(recordPage, Math.max(1, Math.ceil(visibleRecords.length / 10)));

  return <AppShell title={isParent ? 'Đón trẻ & ủy quyền' : 'Xác nhận đón trẻ'} subtitle={isParent ? 'Khai báo người được phép đón và theo dõi việc bàn giao con an toàn.' : 'Chỉ xác nhận bàn giao khi người đón trùng khớp với danh sách đã được phụ huynh ủy quyền.'}>
    {state.error && <div className="form-error">{state.error}</div>}{state.success && <div className="timekeeping-notice success">{state.success}</div>}
    {!isParent && <section className="pickup-toolbar content-card"><label>Tìm trẻ / lớp / người đón<input value={recordSearch} onChange={(event) => { setRecordSearch(event.target.value); setRecordPage(1); }} placeholder="Nhập tên hoặc lớp..." /></label><label>Trạng thái<select value={recordStatus} onChange={(event) => { setRecordStatus(event.target.value); setRecordPage(1); }}><option value="">Tất cả</option>{Object.entries(statusText).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><button className="button button-secondary" onClick={load} disabled={state.loading}>Làm mới</button><button className="button button-primary" onClick={() => { setShowOtpModal(true); setOtpChallenge(null); void searchOtpStudents(); }}><Icon name="phone" size={16} />Người đón mới bằng OTP</button></section>}
    {confirmationRecord && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="pickup-verification-title"><section className="content-card pickup-confirm-modal pickup-identity-modal"><h2 id="pickup-verification-title">Đối chiếu trước khi bàn giao</h2><p>Học sinh: <strong>{confirmationRecord.studentName}</strong> · {confirmationRecord.className}</p><div className="pickup-identity-grid"><div>{confirmationRecord.picker?.photoURL ? <img src={confirmationRecord.picker.photoURL} alt={`Ảnh ${confirmationRecord.picker.fullName}`} /> : <span className="pickup-photo-placeholder"><Icon name="users" size={32} />Chưa lưu ảnh</span>}</div><div><p>Người đón: <strong>{confirmationRecord.picker?.fullName}</strong> · {confirmationRecord.picker?.relationship}</p><p>Điện thoại: {confirmationRecord.picker?.phone || 'Chưa khai báo'}</p><p>Giấy tờ (4 số cuối): {confirmationRecord.picker?.identityCardLast4 || 'Chưa khai báo'}</p><p>Phương tiện: {confirmationRecord.picker?.vehicleType || 'Chưa khai báo'} · <strong>{confirmationRecord.picker?.vehiclePlate || 'Không có biển số'}</strong></p><span className="student-status enrolled">{confirmationRecord.authorizationMethod === 'otp' ? 'Đã được phụ huynh xác nhận OTP' : 'Người đón đã đăng ký'}</span></div></div>{state.error && <div className="form-error">{state.error}</div>}<label className="pickup-verify-check"><input type="checkbox" checked={identityVerified} onChange={(event) => setIdentityVerified(event.target.checked)} /> Tôi đã đối chiếu họ tên, số điện thoại và giấy tờ người đón.</label>{confirmationRecord.picker?.photoURL && <label className="pickup-verify-check"><input type="checkbox" checked={photoCompared} onChange={(event) => setPhotoCompared(event.target.checked)} /> Tôi đã đối chiếu người thực tế với ảnh đã lưu.</label>}{confirmationRecord.picker?.vehiclePlate && <label className="pickup-verify-check"><input type="checkbox" checked={vehicleCompared} onChange={(event) => setVehicleCompared(event.target.checked)} /> Tôi đã đối chiếu phương tiện và biển số xe.</label>}<label className="guard-resolution">Ghi chú bàn giao<textarea maxLength={500} value={confirmationNote} onChange={(event) => setConfirmationNote(event.target.value)} /></label><div className="form-actions"><button className="button button-secondary" disabled={state.saving} onClick={() => setConfirmationRecord(null)}>Quay lại</button><button className="button button-primary" disabled={state.saving || !identityVerified || (confirmationRecord.picker?.photoURL && !photoCompared) || (confirmationRecord.picker?.vehiclePlate && !vehicleCompared)} onClick={() => confirm(confirmationRecord._id)}>Xác nhận đã bàn giao</button></div></section></div>}
    {showOtpModal && <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="content-card pickup-confirm-modal pickup-otp-modal"><div className="card-heading"><div><p className="card-kicker">NGƯỜI ĐÓN THAY MỘT LẦN</p><h2>Xác nhận bằng OTP phụ huynh</h2></div><button className="button button-secondary" onClick={() => setShowOtpModal(false)}>Đóng</button></div>{state.error && <div className="form-error guard-inline-message">{state.error}</div>}{!otpChallenge ? <form className="student-form-grid" onSubmit={requestOtp}><label className="form-wide">Tìm học sinh<div className="pickup-otp-search"><input value={otpSearch} onChange={(event) => setOtpSearch(event.target.value)} placeholder="Tên hoặc mã học sinh" /><button type="button" className="button button-secondary" onClick={searchOtpStudents}>Tìm</button></div></label><label className="form-wide">Học sinh<select value={otpForm.studentId} onChange={(event) => setOtpForm({ ...otpForm, studentId: event.target.value })} required><option value="">Chọn học sinh</option>{otpStudents.map((student) => <option key={student._id} value={student._id}>{student.fullName} · {student.className}</option>)}</select></label><label>Họ tên người đón<input value={otpForm.fullName} onChange={(event) => setOtpForm({ ...otpForm, fullName: event.target.value })} required /></label><label>Số điện thoại<input value={otpForm.phone} onChange={(event) => setOtpForm({ ...otpForm, phone: event.target.value })} required /></label><label>Quan hệ<input value={otpForm.relationship} onChange={(event) => setOtpForm({ ...otpForm, relationship: event.target.value })} /></label><label>4 số cuối giấy tờ<input value={otpForm.identityCardLast4} maxLength="4" onChange={(event) => setOtpForm({ ...otpForm, identityCardLast4: event.target.value.replace(/\D/g, '') })} /></label><label className="form-wide">URL ảnh người đón<input type="url" value={otpForm.photoURL} onChange={(event) => setOtpForm({ ...otpForm, photoURL: event.target.value })} placeholder="https://..." /></label><label>Phương tiện<input value={otpForm.vehicleType} onChange={(event) => setOtpForm({ ...otpForm, vehicleType: event.target.value })} placeholder="Xe máy, ô tô..." /></label><label>Biển số xe<input value={otpForm.vehiclePlate} onChange={(event) => setOtpForm({ ...otpForm, vehiclePlate: event.target.value.toUpperCase() })} /></label><div className="form-actions form-wide"><button className="button button-primary" disabled={state.saving}>Gửi OTP cho phụ huynh</button></div></form> : <div className="pickup-otp-verify"><span className="parent-payment-icon"><Icon name="phone" size={26} /></span><h3>OTP đã gửi trong thông báo phụ huynh</h3><p>Mã có hiệu lực 10 phút. Chỉ tiếp tục khi phụ huynh chủ động cung cấp mã.</p><label>Mã OTP 6 số<input inputMode="numeric" maxLength="6" value={otpCode} onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, ''))} /></label><button className="button button-primary" disabled={state.saving || otpCode.length !== 6} onClick={verifyOtp}>Xác nhận OTP và tạo lịch đón</button></div>}</section></div>}
    <section className="pickup-toolbar content-card"><label>Ngày đón<input type="date" value={pickupDate} onChange={(event) => { setPickupDate(event.target.value); setRecordPage(1); }} /></label>{isParent && students.length > 1 && <label>Học sinh<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{students.map((student) => <option key={student._id} value={student._id}>{student.fullName} · {student.currentClassName || 'Chưa xếp lớp'}</option>)}</select></label>}</section>
    {isParent && selected && <section className="pickup-parent-grid">
      <article className="content-card pickup-card"><div className="card-heading"><div><p className="card-kicker">DANH SÁCH ỦY QUYỀN</p><h2>Người được phép đón {selected.fullName}</h2></div><span className="history-count">{pickers.filter((item) => item.isActive !== false).length} người hoạt động</span></div><p className="pickup-help">Chỉ những người trong danh sách này mới có thể được giáo viên hoặc bảo vệ xác nhận bàn giao trẻ.</p>
        <div className="pickup-picker-list">{pickers.length ? pickers.map((picker, index) => <article key={picker._id || index}>{picker.photoURL ? <img className="pickup-picker-avatar" src={picker.photoURL} alt={picker.fullName} /> : <span className="student-avatar">{picker.fullName?.charAt(0) || 'N'}</span>}<div><strong>{picker.fullName}</strong><small>{picker.relationship || 'Người được ủy quyền'} {picker.phone ? `· ${picker.phone}` : ''}</small>{(picker.vehicleType || picker.vehiclePlate) && <small>{picker.vehicleType || 'Phương tiện'} · {picker.vehiclePlate || 'Chưa có biển số'}</small>}</div><label className="pickup-active"><input type="checkbox" checked={picker.isActive !== false} onChange={(event) => setPickers((items) => items.map((entry, current) => current === index ? { ...entry, isActive: event.target.checked } : entry))} /> Hoạt động</label><button type="button" aria-label={`Xóa ${picker.fullName}`} onClick={() => setPickerToRemove(index)}>×</button></article>) : <div className="empty-state compact">Chưa khai báo người được phép đón.</div>}</div>
        <div className="pickup-picker-form"><label>Họ và tên<input value={pickerForm.fullName} maxLength="120" onChange={(event) => setPickerForm({ ...pickerForm, fullName: event.target.value })} placeholder="Ví dụ: Nguyễn Văn B" /></label><label>Quan hệ<select value={pickerForm.relationship} onChange={(event) => setPickerForm({ ...pickerForm, relationship: event.target.value })}><option value="">Chọn quan hệ</option><option value="Bố">Bố</option><option value="Mẹ">Mẹ</option><option value="Ông">Ông</option><option value="Bà">Bà</option><option value="Người giám hộ">Người giám hộ</option><option value="Khác">Khác</option></select></label><label>Số điện thoại<input value={pickerForm.phone} maxLength="15" onChange={(event) => setPickerForm({ ...pickerForm, phone: event.target.value })} placeholder="0901 234 567" /></label><label>URL ảnh nhận diện<input type="url" value={pickerForm.photoURL} maxLength="1000" onChange={(event) => setPickerForm({ ...pickerForm, photoURL: event.target.value })} placeholder="https://..." /></label><label>Phương tiện<input value={pickerForm.vehicleType} maxLength="80" onChange={(event) => setPickerForm({ ...pickerForm, vehicleType: event.target.value })} placeholder="Xe máy, ô tô..." /></label><label>Biển số xe<input value={pickerForm.vehiclePlate} maxLength="20" onChange={(event) => setPickerForm({ ...pickerForm, vehiclePlate: event.target.value.toUpperCase() })} /></label><button type="button" className="button button-secondary" onClick={addPicker}><Icon name="plus" size={15} /> Thêm vào danh sách</button><p className="pickup-add-help">Thay đổi này chỉ có hiệu lực sau khi nhà trường phê duyệt.</p></div>
        <div className="form-actions"><button type="button" className="button button-primary" disabled={state.saving} onClick={savePickers}>Gửi nhà trường phê duyệt</button></div></article>
      <article className="content-card pickup-card"><div className="card-heading"><div><p className="card-kicker">ĐĂNG KÝ ĐÓN TRẺ</p><h2>Ai sẽ đón bé?</h2></div></div><form className="student-form-grid pickup-request-form" onSubmit={submitPickup}><label className="form-wide">Người đón<select value={form.pickerId} onChange={(event) => setForm({ ...form, pickerId: event.target.value })} required><option value="">Chọn người trong danh sách ủy quyền</option>{pickers.filter((item) => item.isActive !== false && !String(item._id || '').startsWith('new-')).map((picker) => <option key={picker._id} value={picker._id}>{picker.fullName} · {picker.relationship || 'Người được ủy quyền'}</option>)}</select></label><label>Giờ dự kiến (24 giờ)<input type="time" lang="vi" step="60" value={form.expectedPickupTime} onChange={(event) => setForm({ ...form, expectedPickupTime: event.target.value })} /><small>Ví dụ: 17:30, không cần chọn sáng/chiều.</small></label><label>Ngày đón<input value={dateText(pickupDate)} readOnly /></label><label className="form-wide">Ghi chú cho nhà trường<textarea value={form.note} maxLength="500" onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Ví dụ: Người đón thay đổi so với thường ngày." /></label><p className="form-wide pickup-security-note"><Icon name="shield" size={15} /> Nhà trường sẽ đối chiếu họ tên, số điện thoại và giấy tờ tùy thân trước khi bàn giao trẻ.</p><div className="form-actions form-wide"><button className="button button-primary" disabled={state.saving || !pickers.some((item) => item.isActive !== false && !String(item._id || '').startsWith('new-'))}>Gửi đăng ký đón trẻ</button></div></form></article>
    </section>}
    <section className="content-card pickup-history"><div className="card-heading"><div><p className="card-kicker">LỊCH SỬ BÀN GIAO</p><h2>{isParent ? 'Lịch đón của con' : `Lịch đón trẻ ngày ${dateText(pickupDate)}`}</h2></div><span className="history-count">{records.length} lượt</span></div>{state.loading ? <div className="inline-loader"><span className="loading-orb" />Đang tải lịch đón...</div> : visibleRecords.length ? <div className="pickup-record-list">{visibleRecords.slice((currentRecordPage - 1) * 10, currentRecordPage * 10).map((record) => <article key={record._id}><div className="pickup-record-main"><span className="student-avatar">{record.studentName?.charAt(0) || 'B'}</span><div><strong>{record.studentName}</strong><small>{record.className} · Người đón: <b>{record.picker?.fullName}</b>{record.picker?.relationship ? ` (${record.picker.relationship})` : ''}</small>{record.note && <em>{record.note}</em>}{isParent && record.status === 'scheduled' && record.pickupQrPayload && <div className="pickup-qr-ticket"><QRCodeImage value={record.pickupQrPayload} size={112} label={`QR đón ${record.studentName}`} /><span><strong>QR bàn giao hôm nay</strong><small>Người đón đưa mã này cho bảo vệ quét. Không gửi cho người không được ủy quyền.</small></span></div>}</div></div><div className="pickup-record-time"><small>Dự kiến</small><strong>{record.expectedPickupTime || '—'}</strong></div><span className={`student-status pickup-${record.status}`}>{statusText[record.status]}</span><div className="pickup-record-actions">{record.status === 'scheduled' && isParent && <button type="button" className="button button-secondary" disabled={state.saving} onClick={() => cancel(record._id)}>Hủy</button>}{record.status === 'scheduled' && !isParent && <button type="button" className="button button-primary" disabled={state.saving || pickupDate !== today()} onClick={() => { setConfirmationRecord(record); setIdentityVerified(false); setPhotoCompared(false); setVehicleCompared(false); setConfirmationNote(''); }}>Xác nhận bàn giao</button>}{record.status === 'confirmed' && <small>{record.confirmedByName}<br />{new Date(record.confirmedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</small>}</div></article>)}</div> : <div className="empty-state compact">Chưa có lịch đón trẻ trong ngày đã chọn.</div>}<StudentPagination total={visibleRecords.length} page={currentRecordPage} onChange={setRecordPage} /></section>
    {pickerToRemove != null && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="remove-picker-title"><section className="content-card pickup-confirm-modal"><span className="parent-payment-icon"><Icon name="alertCircle" size={26} /></span><p className="card-kicker">XÁC NHẬN XÓA</p><h2 id="remove-picker-title">Xóa người được ủy quyền?</h2><p>{pickers[pickerToRemove]?.fullName} sẽ bị xóa khỏi danh sách ủy quyền ngay sau khi bạn xác nhận.</p><div className="form-actions"><button type="button" className="button button-secondary" disabled={state.saving} onClick={() => setPickerToRemove(null)}>Giữ lại</button><button type="button" className="button button-danger" disabled={state.saving} onClick={removePicker}>{state.saving ? 'Đang xóa...' : 'Xóa người này'}</button></div></section></div>}
  </AppShell>;
}
