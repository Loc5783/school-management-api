import { useCallback, useEffect, useState } from 'react';
import api from '../api/axiosConfig';
import Icon from './Icon';

const kindLabel = { camera: 'Camera an ninh', plate_reader: 'Nhận diện biển số', face_reader: 'Nhận diện khuôn mặt', rfid_reader: 'Đầu đọc RFID/NFC', gate_controller: 'Bộ điều khiển cổng' };
const eventLabel = { plate: 'Biển số', face: 'Khuôn mặt', card: 'Thẻ', behavior: 'Hành vi bất thường', gate_state: 'Trạng thái cổng' };
const statusLabel = { matched: 'Đã kiểm tra', review: 'Cần kiểm tra', alert: 'Cảnh báo', dismissed: 'Đã bỏ qua' };
const initialDevice = { name: '', kind: 'camera', location: 'Cổng chính', snapshotUrl: '' };

export default function GuardDevicePanel({ isManager }) {
  const [devices, setDevices] = useState([]);
  const [events, setEvents] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [status, setStatus] = useState('');
  const [form, setForm] = useState(initialDevice);
  const [showForm, setShowForm] = useState(false);
  const [issuedToken, setIssuedToken] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [deviceResponse, eventResponse] = await Promise.all([api.get('/guard/devices'), api.get('/guard/device-events', { params: { page, ...(status ? { status } : {}) } })]);
      setDevices(deviceResponse.data.data || []);
      setEvents(eventResponse.data.data || []);
      setPages(eventResponse.data.pagination?.totalPages || 1);
      setError('');
    } catch (loadError) { setError(loadError.response?.data?.message || 'Không thể tải dữ liệu thiết bị.'); }
  }, [page, status]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); const poll = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30000); return () => { window.clearTimeout(timer); window.clearInterval(poll); }; }, [load]);

  const createDevice = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const response = await api.post('/guard/devices', form);
      setIssuedToken({ name: form.name, id: response.data.data._id, token: response.data.data.accessToken });
      setShowForm(false); setForm(initialDevice); await load(); setMessage('Đã thêm thiết bị. Hãy lưu khóa kết nối vào cấu hình thiết bị ngay.');
    } catch (submitError) { setError(submitError.response?.data?.message || 'Không thể thêm thiết bị.'); }
    finally { setBusy(false); }
  };
  const changeDevice = async (device) => {
    setBusy(true); setError('');
    try { await api.patch(`/guard/devices/${device._id}`, { enabled: !device.enabled }); await load(); setMessage(device.enabled ? 'Đã tạm ngừng tiếp nhận sự kiện từ thiết bị.' : 'Đã bật lại thiết bị.'); }
    catch (updateError) { setError(updateError.response?.data?.message || 'Không thể đổi trạng thái thiết bị.'); }
    finally { setBusy(false); }
  };
  const rotateToken = async (device) => {
    setBusy(true); setError('');
    try { const response = await api.post(`/guard/devices/${device._id}/rotate-token`); setIssuedToken({ name: device.name, id: device._id, token: response.data.data.accessToken }); setMessage('Khóa cũ đã hết hiệu lực. Cập nhật khóa mới trên thiết bị.'); }
    catch (rotateError) { setError(rotateError.response?.data?.message || 'Không thể tạo khóa mới.'); }
    finally { setBusy(false); }
  };
  const review = async (item, nextStatus) => {
    setBusy(true); setError('');
    try { await api.patch(`/guard/device-events/${item._id}/review`, { status: nextStatus }); await load(); setMessage(nextStatus === 'matched' ? 'Đã đánh dấu kiểm tra. Thao tác này không tự ghi nhận học sinh hay mở cổng.' : 'Đã bỏ qua cảnh báo.'); }
    catch (reviewError) { setError(reviewError.response?.data?.message || 'Không thể xử lý sự kiện.'); }
    finally { setBusy(false); }
  };

  return <div className="guard-device-workspace">
    <section className="content-card guard-device-intro"><div className="card-heading"><div><p className="card-kicker">TÍCH HỢP THIẾT BỊ CỔNG</p><h2>Camera, nhận diện và thẻ</h2></div>{isManager && <button className="button button-primary" onClick={() => setShowForm((value) => !value)}><Icon name="plus" size={16} /> Thêm thiết bị</button>}</div><p>Chưa có thiết bị kết nối thì hệ thống chưa thể tự nhận diện. Khi lắp đặt, thiết bị hoặc phần mềm trung gian gửi kết quả nhận diện về đây để bảo vệ đối chiếu.</p><p>Khớp biển số, khuôn mặt hoặc thẻ chỉ là gợi ý kiểm tra. Xác nhận người đón và ghi nhận học sinh qua cổng vẫn theo quy trình trực cổng. Cổng tự động chưa nhận lệnh mở khi chưa cấu hình bộ điều khiển thực tế.</p></section>
    {error && <div className="form-error guard-inline-message">{error}</div>}{message && <div className="timekeeping-notice success guard-inline-message">{message}</div>}
    {issuedToken && <section className="content-card guard-device-token"><strong>Khóa kết nối vừa tạo cho {issuedToken.name}</strong><p>Chỉ hiển thị một lần. Lưu an toàn và nhập vào thiết bị hoặc phần mềm trung gian.</p><code>{issuedToken.token}</code><small>ID thiết bị: {issuedToken.id}</small><button className="button button-secondary" onClick={() => setIssuedToken(null)}>Tôi đã lưu khóa</button></section>}
    {showForm && isManager && <form className="content-card student-form guard-device-form" onSubmit={createDevice}><h3>Đăng ký thiết bị</h3><div className="student-form-grid"><label>Tên thiết bị<input required maxLength="120" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ví dụ: Camera cổng chính" /></label><label>Loại thiết bị<select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>{Object.entries(kindLabel).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><label>Vị trí<input required maxLength="160" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label><label>Ảnh camera qua HTTPS (nếu có)<input type="url" value={form.snapshotUrl} onChange={(event) => setForm({ ...form, snapshotUrl: event.target.value })} placeholder="https://..." /></label></div><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setShowForm(false)}>Hủy</button><button className="button button-primary" disabled={busy}>Lưu và tạo khóa kết nối</button></div></form>}
    <section className="content-card"><div className="card-heading"><div><p className="card-kicker">THIẾT BỊ ĐÃ ĐĂNG KÝ</p><h2>{devices.length} thiết bị</h2></div><button className="button button-secondary" onClick={load}>Làm mới</button></div>{devices.length ? <div className="guard-device-grid">{devices.map((device) => <article key={device._id}><div><strong>{device.name}</strong><span>{kindLabel[device.kind]} · {device.location}</span><small>{device.lastSeenAt ? `Nhận dữ liệu lần cuối: ${new Date(device.lastSeenAt).toLocaleString('vi-VN')}` : 'Chưa nhận dữ liệu từ thiết bị'}</small></div><b className={device.enabled ? 'online' : 'offline'}>{device.enabled ? 'Đang bật' : 'Tạm dừng'}</b>{device.snapshotUrl && device.kind === 'camera' && <a href={device.snapshotUrl} target="_blank" rel="noreferrer">Mở ảnh camera</a>}{isManager && <><button className="button button-secondary" disabled={busy} onClick={() => changeDevice(device)}>{device.enabled ? 'Tạm dừng' : 'Bật lại'}</button><button className="button button-secondary" disabled={busy} onClick={() => rotateToken(device)}>Tạo khóa mới</button></>}</article>)}</div> : <p className="guard-device-empty">Chưa đăng ký thiết bị. Nhận diện tự động và mở cổng chưa hoạt động.</p>}</section>
    <section className="content-card"><div className="card-heading"><div><p className="card-kicker">NHẬT KÝ NHẬN DIỆN</p><h2>Sự kiện cần bảo vệ đối chiếu</h2></div><select aria-label="Lọc trạng thái sự kiện" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">Tất cả trạng thái</option><option value="alert">Cảnh báo</option><option value="review">Cần kiểm tra</option><option value="matched">Đã kiểm tra</option><option value="dismissed">Đã bỏ qua</option></select></div>{events.length ? <div className="guard-device-events">{events.map((item) => <article key={item._id}><div><strong>{eventLabel[item.eventType]} · {item.deviceId?.name || 'Thiết bị'}</strong><small>{new Date(item.occurredAt).toLocaleString('vi-VN')} · {item.identifier || item.description || 'Không có mã'}{item.confidence != null ? ` · tin cậy ${Math.round(item.confidence * 100)}%` : ''}</small><p>{item.reason}{item.matchLabel ? ` · Gợi ý: ${item.matchLabel}` : ''}</p>{item.snapshotUrl && <a href={item.snapshotUrl} target="_blank" rel="noreferrer">Xem ảnh tham chiếu</a>}</div><span className={`guard-device-event-status ${item.status}`}>{statusLabel[item.status]}</span>{['review', 'alert'].includes(item.status) && <div className="guard-device-actions"><button className="button button-secondary" disabled={busy} onClick={() => review(item, 'matched')}>Đã kiểm tra</button><button className="button button-secondary" disabled={busy} onClick={() => review(item, 'dismissed')}>Bỏ qua</button></div>}</article>)}</div> : <p className="guard-device-empty">Chưa có sự kiện nhận diện.</p>}<div className="guard-device-pagination"><button className="button button-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Trang trước</button><span>Trang {page}/{pages}</span><button className="button button-secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Trang sau</button></div></section>
  </div>;
}
