import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import api from '../api/axiosConfig';

const today = () => new Date().toISOString().slice(0, 10);
const dateText = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('vi-VN') : '—';
const statusText = { scheduled: 'Chờ bàn giao', confirmed: 'Đã bàn giao', cancelled: 'Đã hủy' };
const emptyPicker = { fullName: '', phone: '', relationship: '', isActive: true };

export default function PickupManagement() {
  const role = JSON.parse(localStorage.getItem('user') || '{}').role;
  const isParent = role === 'parent';
  const [students, setStudents] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [pickupDate, setPickupDate] = useState(today());
  const [records, setRecords] = useState([]);
  const [pickers, setPickers] = useState([]);
  const [form, setForm] = useState({ pickerId: '', expectedPickupTime: '', note: '' });
  const [pickerForm, setPickerForm] = useState(emptyPicker);
  const [pickerToRemove, setPickerToRemove] = useState(null);
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
      const response = await api.put(`/students/${selected._id}`, { authorizedPickers });
      const updated = response.data.data;
      setStudents((items) => items.map((item) => item._id === updated._id ? { ...item, authorizedPickers: updated.authorizedPickers } : item));
      setPickers(updated.authorizedPickers || []); setState({ loading: false, saving: false, error: '', success: 'Đã lưu danh sách người được phép đón trẻ.' });
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
      const response = await api.put(`/students/${selected._id}`, { authorizedPickers });
      const updated = response.data.data;
      setStudents((items) => items.map((item) => item._id === updated._id ? { ...item, authorizedPickers: updated.authorizedPickers } : item));
      setPickers(updated.authorizedPickers || []);
      setPickerToRemove(null);
      setState({ loading: false, saving: false, error: '', success: 'Đã xóa người được ủy quyền khỏi hệ thống.' });
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
    try { setState((old) => ({ ...old, saving: true, error: '', success: '' })); await api.patch(`/pickups/${id}/confirm`, {}); await loadRecords(); setState({ loading: false, saving: false, error: '', success: 'Đã xác nhận bàn giao trẻ và gửi thông báo cho phụ huynh.' }); }
    catch (error) { setState((old) => ({ ...old, saving: false, error: error.response?.data?.message || 'Không thể xác nhận bàn giao.', success: '' })); }
  };
  const cancel = async (id) => {
    try { setState((old) => ({ ...old, saving: true, error: '', success: '' })); await api.patch(`/pickups/${id}/cancel`, {}); await loadRecords(); setState({ loading: false, saving: false, error: '', success: 'Đã hủy lịch đón trẻ.' }); }
    catch (error) { setState((old) => ({ ...old, saving: false, error: error.response?.data?.message || 'Không thể hủy lịch đón trẻ.', success: '' })); }
  };

  return <AppShell title={isParent ? 'Đón trẻ & ủy quyền' : 'Xác nhận đón trẻ'} subtitle={isParent ? 'Khai báo người được phép đón và theo dõi việc bàn giao con an toàn.' : 'Chỉ xác nhận bàn giao khi người đón trùng khớp với danh sách đã được phụ huynh ủy quyền.'}>
    {state.error && <div className="form-error">{state.error}</div>}{state.success && <div className="timekeeping-notice success">{state.success}</div>}
    <section className="pickup-toolbar content-card"><label>Ngày đón<input type="date" value={pickupDate} onChange={(event) => setPickupDate(event.target.value)} /></label>{isParent && students.length > 1 && <label>Học sinh<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{students.map((student) => <option key={student._id} value={student._id}>{student.fullName} · {student.currentClassName || 'Chưa xếp lớp'}</option>)}</select></label>}</section>
    {isParent && selected && <section className="pickup-parent-grid">
      <article className="content-card pickup-card"><div className="card-heading"><div><p className="card-kicker">DANH SÁCH ỦY QUYỀN</p><h2>Người được phép đón {selected.fullName}</h2></div><span className="history-count">{pickers.filter((item) => item.isActive !== false).length} người hoạt động</span></div><p className="pickup-help">Chỉ những người trong danh sách này mới có thể được giáo viên hoặc bảo vệ xác nhận bàn giao trẻ.</p>
        <div className="pickup-picker-list">{pickers.length ? pickers.map((picker, index) => <article key={picker._id || index}><span className="student-avatar">{picker.fullName?.charAt(0) || 'N'}</span><div><strong>{picker.fullName}</strong><small>{picker.relationship || 'Người được ủy quyền'} {picker.phone ? `· ${picker.phone}` : ''}</small></div><label className="pickup-active"><input type="checkbox" checked={picker.isActive !== false} onChange={(event) => setPickers((items) => items.map((entry, current) => current === index ? { ...entry, isActive: event.target.checked } : entry))} /> Hoạt động</label><button type="button" aria-label={`Xóa ${picker.fullName}`} onClick={() => setPickerToRemove(index)}>×</button></article>) : <div className="empty-state compact">Chưa khai báo người được phép đón.</div>}</div>
        <div className="pickup-picker-form"><label>Họ và tên<input value={pickerForm.fullName} maxLength="120" onChange={(event) => setPickerForm({ ...pickerForm, fullName: event.target.value })} placeholder="Ví dụ: Nguyễn Văn B" /></label><label>Quan hệ<select value={pickerForm.relationship} onChange={(event) => setPickerForm({ ...pickerForm, relationship: event.target.value })}><option value="">Chọn quan hệ</option><option value="Bố">Bố</option><option value="Mẹ">Mẹ</option><option value="Ông">Ông</option><option value="Bà">Bà</option><option value="Người giám hộ">Người giám hộ</option><option value="Khác">Khác</option></select></label><label>Số điện thoại<input value={pickerForm.phone} maxLength="15" onChange={(event) => setPickerForm({ ...pickerForm, phone: event.target.value })} placeholder="0901 234 567" /></label><button type="button" className="button button-secondary" onClick={addPicker}><Icon name="plus" size={15} /> Thêm vào danh sách</button><p className="pickup-add-help">Người vừa thêm chỉ được lưu chính thức khi bấm “Lưu danh sách ủy quyền” bên dưới.</p></div>
        <div className="form-actions"><button type="button" className="button button-primary" disabled={state.saving} onClick={savePickers}>Lưu danh sách ủy quyền</button></div></article>
      <article className="content-card pickup-card"><div className="card-heading"><div><p className="card-kicker">ĐĂNG KÝ ĐÓN TRẺ</p><h2>Ai sẽ đón bé?</h2></div></div><form className="student-form-grid pickup-request-form" onSubmit={submitPickup}><label className="form-wide">Người đón<select value={form.pickerId} onChange={(event) => setForm({ ...form, pickerId: event.target.value })} required><option value="">Chọn người trong danh sách ủy quyền</option>{pickers.filter((item) => item.isActive !== false && !String(item._id || '').startsWith('new-')).map((picker) => <option key={picker._id} value={picker._id}>{picker.fullName} · {picker.relationship || 'Người được ủy quyền'}</option>)}</select></label><label>Giờ dự kiến (24 giờ)<input type="time" lang="vi" step="60" value={form.expectedPickupTime} onChange={(event) => setForm({ ...form, expectedPickupTime: event.target.value })} /><small>Ví dụ: 17:30, không cần chọn sáng/chiều.</small></label><label>Ngày đón<input value={dateText(pickupDate)} readOnly /></label><label className="form-wide">Ghi chú cho nhà trường<textarea value={form.note} maxLength="500" onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Ví dụ: Người đón thay đổi so với thường ngày." /></label><p className="form-wide pickup-security-note"><Icon name="shield" size={15} /> Nhà trường sẽ đối chiếu họ tên, số điện thoại và giấy tờ tùy thân trước khi bàn giao trẻ.</p><div className="form-actions form-wide"><button className="button button-primary" disabled={state.saving || !pickers.some((item) => item.isActive !== false && !String(item._id || '').startsWith('new-'))}>Gửi đăng ký đón trẻ</button></div></form></article>
    </section>}
    <section className="content-card pickup-history"><div className="card-heading"><div><p className="card-kicker">LỊCH SỬ BÀN GIAO</p><h2>{isParent ? 'Lịch đón của con' : `Lịch đón trẻ ngày ${dateText(pickupDate)}`}</h2></div><span className="history-count">{records.length} lượt</span></div>{state.loading ? <div className="inline-loader"><span className="loading-orb" />Đang tải lịch đón...</div> : records.length ? <div className="pickup-record-list">{records.map((record) => <article key={record._id}><div className="pickup-record-main"><span className="student-avatar">{record.studentName?.charAt(0) || 'B'}</span><div><strong>{record.studentName}</strong><small>{record.className} · Người đón: <b>{record.picker?.fullName}</b>{record.picker?.relationship ? ` (${record.picker.relationship})` : ''}</small>{record.note && <em>{record.note}</em>}</div></div><div className="pickup-record-time"><small>Dự kiến</small><strong>{record.expectedPickupTime || '—'}</strong></div><span className={`student-status pickup-${record.status}`}>{statusText[record.status]}</span><div className="pickup-record-actions">{record.status === 'scheduled' && isParent && <button type="button" className="button button-secondary" disabled={state.saving} onClick={() => cancel(record._id)}>Hủy</button>}{record.status === 'scheduled' && !isParent && <button type="button" className="button button-primary" disabled={state.saving} onClick={() => confirm(record._id)}>Xác nhận bàn giao</button>}{record.status === 'confirmed' && <small>{record.confirmedByName}<br />{new Date(record.confirmedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</small>}</div></article>)}</div> : <div className="empty-state compact">Chưa có lịch đón trẻ trong ngày đã chọn.</div>}</section>
    {pickerToRemove != null && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="remove-picker-title"><section className="content-card pickup-confirm-modal"><span className="parent-payment-icon"><Icon name="alertCircle" size={26} /></span><p className="card-kicker">XÁC NHẬN XÓA</p><h2 id="remove-picker-title">Xóa người được ủy quyền?</h2><p>{pickers[pickerToRemove]?.fullName} sẽ bị xóa khỏi danh sách ủy quyền ngay sau khi bạn xác nhận.</p><div className="form-actions"><button type="button" className="button button-secondary" disabled={state.saving} onClick={() => setPickerToRemove(null)}>Giữ lại</button><button type="button" className="button button-danger" disabled={state.saving} onClick={removePicker}>{state.saving ? 'Đang xóa...' : 'Xóa người này'}</button></div></section></div>}
  </AppShell>;
}
