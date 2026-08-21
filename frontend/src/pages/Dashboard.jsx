import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/axiosConfig';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';

const formatMoney = (value) => new Intl.NumberFormat('vi-VN').format(value || 0) + 'đ';
const statusLabel = { present: 'Có mặt', absent: 'Vắng mặt', late: 'Đi muộn', absent_permission: 'Có phép' };

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const res = await api.get('/reports/dashboard');
        setData(res.data.data);
      } catch (err) {
        if (err.response?.status === 401) {
          localStorage.removeItem('token');
          navigate('/login');
          return;
        }
        setError('Chưa thể kết nối dữ liệu tổng quan. Các số liệu bên dưới đang hiển thị mặc định.');
        setData({ summary: {}, recentAttendance: [] });
      } finally {
        setLoading(false);
      }
    };
    fetchDashboard();
  }, [navigate]);

  if (loading) return <div className="page-loader"><span className="loading-orb" />Đang tải không gian làm việc...</div>;

  const summary = data?.summary || {};
  const cards = [
    { label: 'Tổng số học sinh', value: summary.totalStudents || 0, note: 'Đang theo học', icon: 'students', tone: 'blue' },
    { label: 'Giáo viên & nhân sự', value: summary.totalTeachers || 0, note: 'Đang làm việc', icon: 'users', tone: 'violet' },
    { label: 'Lớp học hoạt động', value: summary.totalClassrooms || 0, note: 'Trong năm học này', icon: 'classes', tone: 'orange' },
    { label: 'Doanh thu hôm nay', value: formatMoney(summary.todayRevenue), note: 'Cập nhật trong ngày', icon: 'money', tone: 'green' },
  ];
  const attendance = data?.recentAttendance || [];
  const todayText = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());

  return (
    <AppShell title="Tổng quan" subtitle={`Chào buổi sáng! Hôm nay là ${todayText}.`} actions={<Link className="button button-primary" to="/attendance"><Icon name="attendance" size={18} />Điểm danh hôm nay</Link>}>
      {error && <div className="notice notice-warning"><span>!</span>{error}</div>}
      <section className="stat-grid" aria-label="Chỉ số tổng quan">
        {cards.map((card) => <article className="stat-card" key={card.label}><div className={`stat-icon ${card.tone}`}><Icon name={card.icon} size={23} /></div><div><p>{card.label}</p><strong>{card.value}</strong><small>{card.note}</small></div></article>)}
      </section>
      <section className="dashboard-grid">
        <article className="content-card attendance-card">
          <div className="card-heading"><div><p className="card-kicker">THEO DÕI HÀNG NGÀY</p><h2>Điểm danh gần đây</h2></div><Link to="/attendance" className="text-link">Xem tất cả <Icon name="chevronRight" size={16} /></Link></div>
          {attendance.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Học sinh</th><th>Trạng thái</th><th>Thời gian đến</th></tr></thead><tbody>{attendance.slice(0, 6).map((item, index) => <tr key={item._id || index}><td><span className="student-avatar">{item.studentName?.charAt(0) || 'H'}</span>{item.studentName || 'Học sinh'}</td><td><span className={`status-badge ${item.status || 'present'}`}><i />{statusLabel[item.status] || 'Có mặt'}</span></td><td>{item.checkInTime ? new Date(item.checkInTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><Icon name="attendance" /></span><strong>Chưa có dữ liệu điểm danh</strong><p>Bắt đầu điểm danh để theo dõi tình hình đến lớp hôm nay.</p><Link to="/attendance" className="button button-secondary">Chọn lớp điểm danh</Link></div>}
        </article>
        <aside className="quick-panel"><p className="card-kicker">TRUY CẬP NHANH</p><h2>Công việc hôm nay</h2><Link to="/attendance" className="quick-action"><span className="quick-icon blue"><Icon name="attendance" /></span><span><strong>Điểm danh lớp</strong><small>Ghi nhận có mặt, vắng, đi muộn</small></span><Icon name="chevronRight" size={18} /></Link><span className="quick-action is-muted"><span className="quick-icon orange"><Icon name="students" /></span><span><strong>Thêm học sinh</strong><small>Quản lý hồ sơ học sinh</small></span><small>Sắp có</small></span><span className="quick-action is-muted"><span className="quick-icon violet"><Icon name="chart" /></span><span><strong>Xem báo cáo</strong><small>Phân tích vận hành trường học</small></span><small>Sắp có</small></span></aside>
      </section>
    </AppShell>
  );
}
