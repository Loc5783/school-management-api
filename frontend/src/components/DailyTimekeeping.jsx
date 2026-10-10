import { useEffect, useState } from 'react';
import { getDailyTimekeeping } from '../api/timekeeping';

const localDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const clock = (value) => value ? new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—';

export default function DailyTimekeeping() {
  const [date, setDate] = useState(localDate);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    getDailyTimekeeping(date).then((response) => { if (active) { setRows(response.data.data?.rows || []); setError(''); } })
      .catch((err) => { if (active) setError(err.response?.data?.message || 'Không tải được bảng công.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [date]);
  return <section className="content-card student-list-card" style={{ marginBottom: 20 }}>
    <div className="card-heading"><div><p className="card-kicker">ĐỐI CHIẾU CA & CHẤM CÔNG</p><h2>Bảng công theo ngày</h2><p>Chỉ xem dữ liệu gốc và ca được phân. Thời gian làm thêm cần quy trình duyệt riêng, chưa tự tính lương.</p></div><label>Ngày công <input type="date" value={date} onChange={(event) => { setLoading(true); setDate(event.target.value); }} /></label></div>
    {error && <p className="form-error">{error}</p>}
    {loading ? <p className="history-empty">Đang tải bảng công...</p> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Nhân viên</th><th>Ca phân công</th><th>Vào</th><th>Ra</th><th>Đi muộn</th><th>Về sớm</th><th>Làm thêm dự kiến</th><th>Tình trạng</th></tr></thead><tbody>{rows.map((item) => <tr key={`${item.employeeId}-${item.shift?.name || 'none'}`}><td><strong>{item.employeeName}</strong><small>{item.employeeCode}</small></td><td>{item.shift ? `${item.shift.name} · ${item.shift.startTime}–${item.shift.endTime}` : 'Chưa có ca'}</td><td>{clock(item.record?.checkInTime)}</td><td>{clock(item.record?.checkOutTime)}</td><td>{item.lateMinutes == null ? '—' : `${item.lateMinutes} phút`}</td><td>{item.earlyLeaveMinutes == null ? '—' : `${item.earlyLeaveMinutes} phút`}</td><td>{item.overtimeMinutes == null ? '—' : `${item.overtimeMinutes} phút`}</td><td>{item.missing ? 'Thiếu lượt chấm' : item.record?.finalized ? 'Đã tổng hợp' : 'Chưa chốt'}</td></tr>)}{!rows.length && <tr><td colSpan="8" className="history-empty">Không có ca hoặc lượt chấm công trong ngày này.</td></tr>}</tbody></table></div>}
  </section>;
}
