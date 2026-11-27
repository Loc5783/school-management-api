import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import api from '../api/axiosConfig';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import { getStoredUser } from '../utils/storage';

export default function AttendanceClassList() {
  const [classrooms, setClassrooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const location = useLocation();
  const navigate = useNavigate();
  const role = getStoredUser().role;

  useEffect(() => {
    let active = true;
    const searchParams = new URLSearchParams(location.search);
    const forceShowList = searchParams.get('list') === '1';

    api.get('/classrooms')
      .then((res) => {
        if (!active) return;
        const list = res.data.data || [];
        // Nếu Giáo viên chủ nhiệm chỉ phụ trách đúng 1 lớp (và không bấm nút "Danh sách lớp"), tự mở thẳng lớp đó
        if (role === 'teacher' && list.length === 1 && list[0]?._id && !forceShowList) {
          navigate(`/attendance/class/${list[0]._id}${location.search}`, { replace: true });
          return;
        }
        setClassrooms(list);
      })
      .catch(console.error)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [role, navigate, location.search]);

  const cleanClassSearch = (() => {
    const sp = new URLSearchParams(location.search);
    sp.delete('list');
    const qs = sp.toString();
    return qs ? `?${qs}` : '';
  })();

  const visibleClasses = classrooms.filter((item) =>
    `${item.name} ${item.fullName || ''}`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <AppShell title="Điểm danh" subtitle="Ghi nhận theo lớp, theo dõi lịch sử và báo cáo vắng mặt.">
      <section className="content-card class-list-card">
        <div className="list-toolbar">
          <div>
            <p className="card-kicker">DANH SÁCH LỚP</p>
            <h2>{loading ? 'Đang tải lớp học...' : `${visibleClasses.length} lớp đang hoạt động`}</h2>
          </div>
          <div className="toolbar-buttons">
            {['admin', 'principal', 'teacher'].includes(role) && (
              <Link className="button button-secondary" to="/attendance/reports">
                <Icon name="chart" size={17} />Báo cáo vắng mặt
              </Link>
            )}
            {['admin', 'principal', 'teacher'].includes(role) && (
              <Link className="button button-secondary" to="/attendance/leave-requests">
                <Icon name="attendance" size={17} />{role === 'teacher' ? 'Đơn nghỉ lớp tôi' : 'Duyệt đơn nghỉ'}
              </Link>
            )}
            <label className="search-box">
              <Icon name="search" size={18} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm lớp học..." />
            </label>
          </div>
        </div>
        {loading ? (
          <div className="inline-loader"><span className="loading-orb" />Đang lấy danh sách lớp...</div>
        ) : visibleClasses.length ? (
          <div className="class-grid">
            {visibleClasses.map((cls, index) => (
              <Link key={cls._id} to={`/attendance/class/${cls._id}${cleanClassSearch}`} className="class-card">
                <span className={`class-symbol symbol-${index % 4}`}>{cls.name?.charAt(0) || 'L'}</span>
                <div className="class-info">
                  <h3>{cls.name}</h3>
                  <p>{cls.fullName || `Lớp độ tuổi ${cls.ageGroup || '—'}`}</p>
                  <span><Icon name="students" size={15} />{cls.statistics?.currentStudents || 0} / {cls.maxSize || 25} học sinh</span>
                </div>
                <span className="round-arrow"><Icon name="chevronRight" size={18} /></span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <span className="empty-icon"><Icon name="classes" /></span>
            <strong>Không tìm thấy lớp học</strong>
            <p>Thử tìm bằng tên lớp khác hoặc kiểm tra dữ liệu lớp.</p>
          </div>
        )}
      </section>
    </AppShell>
  );
}
