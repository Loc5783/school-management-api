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
    api.get('/hr/my-staffing', { params: { date } })
      .then((response) => {
        if (!alive) return;
        const resData = response.data?.data || response.data || {};
        setData({
          classrooms: Array.isArray(resData.classrooms) ? resData.classrooms : [],
          duties: Array.isArray(resData.duties) ? resData.duties : []
        });
        setState({ loading: false, error: '' });
      })
      .catch((error) => {
        if (!alive) return;
        setState({
          loading: false,
          error: error.response?.data?.message || error.message || 'Không thể tải lịch phân công.'
        });
      });
    return () => { alive = false; };
  }, [date]);

  const classrooms = data?.classrooms || [];
  const duties = data?.duties || [];

  return (
    <AppShell title="Lịch phân công của tôi" subtitle="Lớp phụ trách, ca làm và nhiệm vụ thay thế theo ngày.">
      <section className="content-card staffing-heading">
        <div>
          <p className="card-kicker">CÔNG VIỆC CỦA TÔI</p>
          <h2>Phân công ngày {date}</h2>
          <p>Ca và người thay được HR/Ban giám hiệu xác nhận. Nếu lịch chưa đúng, hãy liên hệ bộ phận nhân sự.</p>
        </div>
        <label>
          Chọn ngày
          <input
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              setState((old) => ({ ...old, loading: true }));
            }}
          />
        </label>
      </section>

      {state.error && <div className="form-error">{state.error}</div>}

      {state.loading ? (
        <div className="inline-loader">Đang tải lịch...</div>
      ) : (
        <div className="staffing-my-grid">
          {classrooms.map((item) => (
            <article className="content-card" key={item._id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p className="card-kicker">LỚP HỌC</p>
                {item.isCovering && (
                  <span style={{ background: '#fef3c7', color: '#92400e', fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px' }}>
                    Dạy thay
                  </span>
                )}
              </div>
              <h3>{item.name}</h3>
              <p>{item.schoolDay ? 'Có lịch học' : 'Lớp không học ngày này'} · {item.presentTeachers}/{item.requiredTeachers} giáo viên</p>
              <small>{(item.assigned || []).map((entry) => `${entry.name}${entry.absent ? ' (nghỉ)' : ''}`).join(', ') || 'Chưa có phân công'}</small>
              {item.replacements && item.replacements.length > 0 && (
                <p style={{ marginTop: '8px', color: '#1d4ed8' }}>
                  Người dạy thay: {item.replacements.map((entry) => entry.name).join(', ')}
                </p>
              )}
            </article>
          ))}

          {duties.map((item) => (
            <article className="content-card" key={item._id}>
              <p className="card-kicker">{item.role === 'chef' ? 'CA BẾP' : 'CA BẢO VỆ'}</p>
              <h3>{item.name}</h3>
              <p>{item.startTime} – {item.endTime}{item.endTime < item.startTime ? ' (+1 ngày)' : ''}</p>
              <small>Phân công chính: {item.employeeName || '—'}</small>
              {item.replacement && (
                <p style={{ marginTop: '6px', color: '#1d4ed8' }}>
                  Người trực thay: <strong>{item.replacement.name}</strong>
                </p>
              )}
              {item.uncovered && (
                <p className="staffing-uncovered" style={{ marginTop: '6px', color: '#b91c1c' }}>
                  Ca này chưa có người trực.
                </p>
              )}
            </article>
          ))}

          {!classrooms.length && !duties.length && !state.error && (
            <section className="content-card staffing-empty">
              Bạn chưa có phân công trong ngày đã chọn.
            </section>
          )}
        </div>
      )}
    </AppShell>
  );
}
