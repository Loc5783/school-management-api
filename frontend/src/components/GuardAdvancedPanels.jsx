import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../api/axiosConfig';
import Icon from './Icon';
import { queueGuardOperation } from '../utils/guardOfflineQueue';

const deliveryInitial = { purchaseOrderId: '', supplierName: '', driverName: '', phone: '', vehiclePlate: '', itemsDescription: '', recipientName: '', allowedArea: 'Khu vực giao nhận', note: '' };
const emergencyInitial = { level: 'security', title: '', instructions: '' };
const viDate = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('vi-VN') : '—';
const viTime = (value) => value ? new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—';

export function GuardDeliveryPanel({ date, onOfflineQueued }) {
  const [deliveries, setDeliveries] = useState([]);
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState(deliveryInitial);
  const [state, setState] = useState({ loading: true, saving: false, error: '', success: '' });
  const load = useCallback(async () => {
    try {
      const [deliveryRes, orderRes] = await Promise.all([api.get('/guard/deliveries', { params: { date } }), api.get('/guard/deliveries/expected-orders')]);
      setDeliveries(deliveryRes.data.data || []); setOrders(orderRes.data.data || []); setState((old) => ({ ...old, loading: false, error: '' }));
    } catch (error) { setState((old) => ({ ...old, loading: false, error: error.response?.data?.message || 'Không thể tải sổ giao hàng.' })); }
  }, [date]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const chooseOrder = (id) => {
    const order = orders.find((item) => item._id === id);
    setForm((old) => ({ ...old, purchaseOrderId: id, supplierName: order?.supplierName || old.supplierName, itemsDescription: order?.items?.map((item) => `${item.itemName} × ${item.quantity}`).join(', ') || old.itemsDescription }));
  };
  const submit = async (event) => {
    event.preventDefault(); setState((old) => ({ ...old, saving: true, error: '', success: '' }));
    try { await api.post('/guard/deliveries', form); setForm(deliveryInitial); await load(); setState((old) => ({ ...old, saving: false, success: 'Đã ghi nhận nhà cung cấp vào giao hàng.' })); }
    catch (error) {
      if (!error.response) { queueGuardOperation('delivery', form); setForm(deliveryInitial); onOfflineQueued?.(); setState({ loading: false, saving: false, error: '', success: 'Mất kết nối: lượt giao hàng đã được lưu trên thiết bị để đồng bộ sau.' }); }
      else setState((old) => ({ ...old, saving: false, error: error.response.data?.message || 'Không thể ghi nhận giao hàng.' }));
    }
  };
  const checkout = async (id) => { try { await api.patch(`/guard/deliveries/${id}/check-out`); await load(); } catch (error) { setState((old) => ({ ...old, error: error.response?.data?.message || 'Không thể xác nhận xe rời trường.' })); } };

  return <section className="guard-workspace guard-delivery-workspace">
    <form className="content-card student-form guard-form" onSubmit={submit}><div className="card-heading"><div><p className="card-kicker">GIAO NHẬN TẠI CỔNG</p><h2>Ghi nhận nhà cung cấp giao hàng</h2></div></div>{state.error && <div className="form-error guard-inline-message">{state.error}</div>}{state.success && <div className="timekeeping-notice success guard-inline-message">{state.success}</div>}<div className="student-form-grid">
      <label className="form-wide">Đơn hàng dự kiến<select value={form.purchaseOrderId} onChange={(event) => chooseOrder(event.target.value)}><option value="">Không liên kết đơn mua hàng</option>{orders.map((order) => <option key={order._id} value={order._id}>{order.orderCode} · {order.supplierName}</option>)}</select></label>
      <label>Nhà cung cấp<input value={form.supplierName} maxLength="160" onChange={(event) => setForm({ ...form, supplierName: event.target.value })} required /></label><label>Người giao hàng<input value={form.driverName} maxLength="120" onChange={(event) => setForm({ ...form, driverName: event.target.value })} required /></label>
      <label>Số điện thoại<input value={form.phone} maxLength="20" onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label><label>Biển số xe<input value={form.vehiclePlate} maxLength="20" onChange={(event) => setForm({ ...form, vehiclePlate: event.target.value.toUpperCase() })} /></label>
      <label className="form-wide">Hàng hóa giao đến<textarea value={form.itemsDescription} maxLength="1000" onChange={(event) => setForm({ ...form, itemsDescription: event.target.value })} required /></label>
      <label>Người/bộ phận nhận<input value={form.recipientName} maxLength="120" onChange={(event) => setForm({ ...form, recipientName: event.target.value })} required /></label><label>Khu vực được phép đến<input value={form.allowedArea} maxLength="160" onChange={(event) => setForm({ ...form, allowedArea: event.target.value })} /></label>
      <label className="form-wide">Ghi chú<textarea value={form.note} maxLength="500" onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
    </div><div className="form-actions"><button className="button button-primary" disabled={state.saving || date !== new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())}>Ghi nhận xe vào giao hàng</button></div></form>
    <article className="content-card"><div className="card-heading"><div><p className="card-kicker">SỔ GIAO HÀNG</p><h2>{deliveries.filter((item) => item.status === 'inside').length} xe đang trong trường</h2></div><button className="button button-secondary" onClick={load}>Làm mới</button></div><div className="guard-delivery-list">{state.loading ? <div className="inline-loader"><span className="loading-orb" />Đang tải...</div> : deliveries.length ? deliveries.map((item) => <article key={item._id}><span className="guard-event-icon arrival"><Icon name="card" /></span><div><strong>{item.supplierName}</strong><small>{item.driverName} · {item.vehiclePlate || 'Không có biển số'} · giao cho {item.recipientName}</small><p>{item.itemsDescription}</p></div><div><span className={`student-status ${item.status === 'inside' ? 'temporarily_absent' : 'enrolled'}`}>{item.status === 'inside' ? 'Đang giao hàng' : 'Đã rời trường'}</span><small>Vào {viTime(item.checkInAt)}{item.checkOutAt ? ` · Ra ${viTime(item.checkOutAt)}` : ''}</small>{item.status === 'inside' && <button className="button button-secondary" onClick={() => checkout(item._id)}>Xác nhận rời trường</button>}</div></article>) : <div className="empty-state compact">Chưa có lượt giao hàng trong ngày.</div>}</div></article>
  </section>;
}

export function GuardEmergencyPanel() {
  const role = JSON.parse(localStorage.getItem('user') || '{}').role;
  const isManager = ['admin', 'principal'].includes(role);
  const [active, setActive] = useState(null);
  const [form, setForm] = useState(emergencyInitial);
  const [resolutionNote, setResolutionNote] = useState('');
  const [state, setState] = useState({ loading: true, saving: false, error: '', success: '' });
  const load = useCallback(async () => { try { const response = await api.get('/guard/emergency-mode'); setActive(response.data.data || null); setState((old) => ({ ...old, loading: false, error: '' })); } catch (error) { setState((old) => ({ ...old, loading: false, error: error.response?.data?.message || 'Không thể tải trạng thái khẩn cấp.' })); } }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  const activate = async (event) => { event.preventDefault(); try { setState((old) => ({ ...old, saving: true, error: '', success: '' })); await api.post('/guard/emergency-mode', form); setForm(emergencyInitial); await load(); setState((old) => ({ ...old, saving: false, success: 'Đã phát cảnh báo khẩn cấp toàn trường.' })); } catch (error) { setState((old) => ({ ...old, saving: false, error: error.response?.data?.message || 'Không thể kích hoạt.' })); } };
  const resolve = async () => { try { setState((old) => ({ ...old, saving: true, error: '' })); await api.patch(`/guard/emergency-mode/${active._id}/resolve`, { resolutionNote }); setResolutionNote(''); await load(); setState((old) => ({ ...old, saving: false, success: 'Đã kết thúc chế độ khẩn cấp.' })); } catch (error) { setState((old) => ({ ...old, saving: false, error: error.response?.data?.message || 'Không thể kết thúc.' })); } };
  return <section className="guard-emergency-page">{state.error && <div className="form-error">{state.error}</div>}{state.success && <div className="timekeeping-notice success">{state.success}</div>}{active ? <article className="content-card guard-emergency-active"><span className="guard-emergency-pulse"><Icon name="alertCircle" size={30} /></span><div><p className="card-kicker">CHẾ ĐỘ KHẨN CẤP ĐANG BẬT</p><h2>{active.title}</h2><strong>{active.level.toUpperCase()} · kích hoạt bởi {active.activatedByName}</strong><p>{active.instructions}</p></div>{isManager && <div className="guard-emergency-resolve"><label>Kết quả xử lý<textarea value={resolutionNote} maxLength="1000" onChange={(event) => setResolutionNote(event.target.value)} /></label><button className="button button-primary" disabled={state.saving || !resolutionNote.trim()} onClick={resolve}>Kết thúc chế độ khẩn cấp</button></div>}</article> : <form className="content-card student-form guard-form guard-emergency-form" onSubmit={activate}><div className="card-heading"><div><p className="card-kicker">PHẢN ỨNG NHANH</p><h2>Kích hoạt chế độ xử lý khẩn cấp</h2></div></div><p className="guard-form-help">Chỉ sử dụng khi có nguy cơ thật. Hệ thống sẽ gửi cảnh báo ưu tiên tới bảo vệ, giáo viên và ban quản lý.</p><div className="student-form-grid"><label>Loại tình huống<select value={form.level} onChange={(event) => setForm({ ...form, level: event.target.value })}><option value="security">An ninh</option><option value="fire">Cháy / khói</option><option value="medical">Y tế</option><option value="evacuation">Sơ tán</option><option value="lockdown">Phong tỏa cổng</option></select></label><label>Tiêu đề<input value={form.title} maxLength="160" onChange={(event) => setForm({ ...form, title: event.target.value })} required /></label><label className="form-wide">Hướng dẫn tức thời<textarea value={form.instructions} maxLength="2000" onChange={(event) => setForm({ ...form, instructions: event.target.value })} required /></label></div><div className="form-actions"><button className="button button-danger" disabled={state.saving}>Phát cảnh báo khẩn cấp</button></div></form>}</section>;
}

export function GuardReportPanel() {
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [range, setRange] = useState({ startDate: monthStart, endDate: today });
  const [report, setReport] = useState(null);
  const [state, setState] = useState({ loading: false, error: '' });
  const load = useCallback(async () => { try { setState({ loading: true, error: '' }); const response = await api.get('/guard/reports', { params: range }); setReport(response.data.data); setState({ loading: false, error: '' }); } catch (error) { setState({ loading: false, error: error.response?.data?.message || 'Không thể tải báo cáo.' }); } }, [range]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  const metrics = useMemo(() => report?.totals ? [['Lượt vào', report.totals.arrivals], ['Lượt rời trường', report.totals.departures], ['Bàn giao trẻ', report.totals.pickups], ['Đón bằng OTP', report.totals.otpPickups], ['Khách', report.totals.visitors], ['Giao hàng', report.totals.deliveries], ['Sự cố', report.totals.incidents], ['Bàn giao ca', report.totals.handovers]] : [], [report]);
  return <section className="guard-report-page"><article className="content-card guard-report-filter"><div className="card-heading"><div><p className="card-kicker">BÁO CÁO CỔNG TRƯỜNG</p><h2>Tổng hợp hoạt động theo thời gian</h2></div></div><div><label>Từ ngày<input type="date" value={range.startDate} onChange={(event) => setRange({ ...range, startDate: event.target.value })} /></label><label>Đến ngày<input type="date" value={range.endDate} onChange={(event) => setRange({ ...range, endDate: event.target.value })} /></label><button className="button button-primary" disabled={state.loading} onClick={load}>Xem báo cáo</button></div>{state.error && <div className="form-error">{state.error}</div>}</article><section className="guard-report-metrics">{metrics.map(([label, value]) => <article key={label}><small>{label}</small><strong>{value}</strong></article>)}</section><article className="content-card"><div className="card-heading"><div><p className="card-kicker">NHẬT KÝ TỔNG HỢP</p><h2>{report?.daily?.length || 0} ngày có hoạt động</h2></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Ngày</th><th>Vào</th><th>Ra</th><th>Đón trẻ</th><th>Khách</th><th>Giao hàng</th><th>Sự cố</th><th>Bàn giao ca</th></tr></thead><tbody>{report?.daily?.map((item) => <tr key={item.date}><td>{viDate(item.date)}</td><td>{item.arrivals}</td><td>{item.departures}</td><td>{item.pickups}</td><td>{item.visitors}</td><td>{item.deliveries}</td><td>{item.incidents}</td><td>{item.handovers}</td></tr>)}</tbody></table>{!state.loading && !report?.daily?.length && <div className="empty-state compact">Không có hoạt động trong khoảng ngày đã chọn.</div>}</div></article></section>;
}
