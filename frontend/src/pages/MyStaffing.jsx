import { useEffect, useState } from 'react';
import AppShell from '../components/AppShell';
import api from '../api/axiosConfig';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export default function MyStaffing() {
  const [date, setDate] = useState(today);
  const [data, setData] = useState({ classrooms: [], duties: [] });
  const [state, setState] = useState({ loading: true, error: '' });
  useEffect(() => {
    let alive = true;
    api.get('/hr/my-staffing', { params: { date } }).then((response) => {
      if (alive) { setData(response.data.data); setState({ loading: false, error: '' }); }
    }).catch((error) => { if (alive) setState({ loading: false, error: error.response?.data?.message || 'Không thể tải lịch phân công.' }); });
    return () => { alive = false; };
  }, [date]);
  return <AppShell title="Lịch phân công của tôi" subtitle="Lớp phụ trách, ca làm và nhiệm vụ thay thế theo ngày.">
    <section className="content-card staffing-heading"><div><p className="card-kicker">CÔNG VIỆC CỦA TÔI</p><h2>Phân công ngày {date}</h2><p>Ca và người thay được HR/Ban giám hiệu xác nhận. Nếu lịch chưa đúng, hãy liên hệ bộ phận nhân sự.</p></div><label>Chọn ngày<input type="date" value={date} onChange={(event) => { setDate(event.target.value); setState((old) => ({ ...old, loading: true })); }} /></label></section>
    {state.error && <div className="form-error">{state.error}</div>}
    {state.loading ? <div className="inline-loader">Đang tải lịch...</div> : <div className="staffing-my-grid">
      {data.classrooms.map((item) => <article className="content-card" key={item._id}><p className="card-kicker">LỚP HỌC</p><h3>{item.name}</h3><p>{item.schoolDay ? 'Có lịch học' : 'Lớp không học ngày này'} · {item.presentTeachers}/{item.requiredTeachers} giáo viên</p><small>{item.assigned.map((entry) => `${entry.name}${entry.absent ? ' (nghỉ)' : ''}`).join(', ')}</small>{item.replacements.length > 0 && <p>Người dạy thay: {item.replacements.map((entry) => entry.name).join(', ')}</p>}</article>)}
      {data.duties.map((item) => <article className="content-card" key={item._id}><p className="card-kicker">{item.role === 'chef' ? 'CA BẾP' : 'CA BẢO VỆ'}</p><h3>{item.name}</h3><p>{item.startTime} – {item.endTime}{item.endTime < item.startTime ? ' (+1 ngày)' : ''}</p><small>Phân công chính: {item.employeeName}</small>{item.replacement && <p>Người thay: {item.replacement.name}</p>}{item.uncovered && <p className="staffing-uncovered">Ca này chưa có người trực.</p>}</article>)}
      {!data.classrooms.length && !data.duties.length && <section className="content-card staffing-empty">Bạn chưa có phân công trong ngày đã chọn.</section>}
    </div>}
  </AppShell>;
}
