import { useEffect, useState } from 'react';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import { createCorrectionRequest, getMyTimekeeping, manualCheckIn } from '../api/timekeeping';

const toDateInput = (date) => {
  const value = new Date(date);
  const offset = value.getTimezoneOffset();
  return new Date(value.getTime() - offset * 60000).toISOString().slice(0, 10);
};
const formatDate = (value) => new Date(value).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

export default function ManualTimekeeping() {
  const [data, setData] = useState({ records: [], corrections: [] });
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeType, setNoticeType] = useState('');
  const [form, setForm] = useState({ workDate: '', requestedCheckInTime: '08:30', reason: '' });
  const [pageDate] = useState(() => new Date());

  const load = async () => {
    try { const response = await getMyTimekeeping(); setData(response.data.data); }
    catch (error) { setNotice(error.response?.data?.message || 'Không thể tải dữ liệu chấm công.'); setNoticeType('error'); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    let active = true;
    getMyTimekeeping()
      .then((response) => { if (active) setData(response.data.data); })
      .catch((error) => { if (active) { setNotice(error.response?.data?.message || 'Không thể tải dữ liệu chấm công.'); setNoticeType('error'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const today = toDateInput(pageDate);
  const maxCorrectionDate = toDateInput(new Date(pageDate.getTime() - 86400000));
  const todayRecord = data.records.find((record) => toDateInput(record.workDate) === today);

  const checkIn = async () => {
    setCheckingIn(true); setNotice('');
    try {
      const response = await manualCheckIn();
      setNotice(response.data.message); setNoticeType(response.data.alreadyCheckedIn ? 'info' : 'success');
      await load();
    } catch (error) { setNotice(error.response?.data?.message || 'Không thể chấm công.'); setNoticeType('error'); }
    finally { setCheckingIn(false); }
  };
  const submitCorrection = async (event) => {
    event.preventDefault(); setSubmitting(true); setNotice('');
    try {
      const response = await createCorrectionRequest(form);
      setNotice(response.data.message); setNoticeType('success');
      setForm({ workDate: '', requestedCheckInTime: '08:30', reason: '' });
      await load();
    } catch (error) { setNotice(error.response?.data?.message || 'Không thể gửi đơn chấm công bù.'); setNoticeType('error'); }
    finally { setSubmitting(false); }
  };

  return <AppShell title="Chấm công thủ công" subtitle="Ghi nhận công hôm nay hoặc gửi đơn bù cho ngày làm việc đã thiếu.">
    {notice && <div className={`timekeeping-notice ${noticeType}`}><Icon name={noticeType === 'success' ? 'check' : 'shield'} size={17} />{notice}</div>}
    <div className="timekeeping-grid">
      <section className="manual-check-card"><p className="card-kicker">CHẤM CÔNG HÔM NAY</p><h2>{todayRecord ? 'Bạn đã chấm công' : 'Bắt đầu ngày làm việc'}</h2><p className="check-date"><Icon name="calendar" size={15} />{new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(pageDate)}</p><div className="check-in-display"><span className={todayRecord ? 'check-ok' : ''}><Icon name={todayRecord ? 'check' : 'clock'} size={26} /></span><div><strong>{todayRecord ? 'Đã ghi nhận công' : 'Chưa chấm công'}</strong><small>{todayRecord ? `Vào lúc ${new Date(todayRecord.checkInTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}` : 'Nhấn nút bên dưới khi bắt đầu làm việc.'}</small></div></div><button className="button button-primary large-button" onClick={checkIn} disabled={checkingIn || Boolean(todayRecord)}><Icon name="clock" size={18} />{checkingIn ? 'Đang ghi nhận...' : todayRecord ? 'Đã chấm công hôm nay' : 'Chấm công ngay'}</button></section>
      <section className="correction-card content-card"><div><p className="card-kicker">ĐƠN CHẤM CÔNG BÙ</p><h2>Bổ sung công bị thiếu</h2><p>Gửi đơn cho ngày bạn đã làm việc nhưng quên chấm công. Đơn của ngày trước sẽ tự đồng bộ sau 00:00.</p></div><form onSubmit={submitCorrection} className="correction-form"><label>Ngày làm việc<input type="date" max={maxCorrectionDate} value={form.workDate} onChange={(event) => setForm({ ...form, workDate: event.target.value })} required /></label><label>Giờ bắt đầu làm việc<input type="time" value={form.requestedCheckInTime} onChange={(event) => setForm({ ...form, requestedCheckInTime: event.target.value })} required /></label><label className="full-width">Lý do<textarea value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Ví dụ: Quên chấm công khi đến trường lúc 08:30." maxLength="500" required /></label><button className="button button-primary" type="submit" disabled={submitting}><Icon name="plus" size={17} />{submitting ? 'Đang gửi...' : 'Gửi đơn chấm công bù'}</button></form></section>
    </div>
    <section className="content-card timekeeping-history"><div className="card-heading"><div><p className="card-kicker">LỊCH SỬ GẦN ĐÂY</p><h2>Công và đơn chấm công bù</h2></div></div>{loading ? <div className="inline-loader"><span className="loading-orb" />Đang tải lịch sử...</div> : <div className="timekeeping-tables"><div><h3>Bản ghi chấm công</h3>{data.records.length ? <table className="data-table"><thead><tr><th>Ngày công</th><th>Giờ vào</th><th>Nguồn</th><th>Trạng thái</th></tr></thead><tbody>{data.records.slice(0, 8).map((record) => <tr key={record._id}><td>{formatDate(record.workDate)}</td><td>{new Date(record.checkInTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</td><td>{record.source === 'correction' ? 'Chấm công bù' : 'Thủ công'}</td><td><span className="status-badge present"><i />Đủ công</span></td></tr>)}</tbody></table> : <p className="no-history">Chưa có bản ghi.</p>}</div><div><h3>Đơn chấm công bù</h3>{data.corrections.length ? <table className="data-table"><thead><tr><th>Ngày</th><th>Giờ đề nghị</th><th>Trạng thái</th></tr></thead><tbody>{data.corrections.slice(0, 8).map((request) => <tr key={request._id}><td>{formatDate(request.workDate)}</td><td>{request.requestedCheckInTime}</td><td><span className={`correction-status ${request.status}`}>{request.status === 'synced' ? 'Đã đồng bộ' : request.status === 'pending' ? 'Chờ đồng bộ' : 'Từ chối'}</span></td></tr>)}</tbody></table> : <p className="no-history">Chưa có đơn chấm công bù.</p>}</div></div>}</section>
  </AppShell>;
}
