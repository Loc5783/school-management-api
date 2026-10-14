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
  const [principalWork, setPrincipalWork] = useState(null);
  const [principalWorkError, setPrincipalWorkError] = useState('');
  const [attendancePage, setAttendancePage] = useState(1);
  const navigate = useNavigate();
  const role = JSON.parse(localStorage.getItem('user') || '{}').role;
  const isTeacher = role === 'teacher';
  const isPrincipal = role === 'principal';

  useEffect(() => {
    if (!isPrincipal) return;
    api.get('/reports/principal-work')
      .then((response) => setPrincipalWork(response.data.data))
      .catch(() => setPrincipalWorkError('Không tải được số việc chờ xử lý. Vui lòng tải lại trang.'));
  }, [isPrincipal]);

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const res = await api.get('/reports/dashboard', { params: { page: attendancePage, limit: 10 } });
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
  }, [navigate, attendancePage]);

  if (loading) return <div className="page-loader"><span className="loading-orb" />Đang tải không gian làm việc...</div>;

  const summary = data?.summary || {};
  const staffing = data?.staffing;
  const principalWorkItems = [
    { key: 'payroll', label: 'Bảng lương kỳ này', detail: 'Đã đối soát, chờ duyệt', to: '/hr?tab=payroll', icon: 'money', tone: 'blue' },
    { key: 'leave', label: 'Đơn nghỉ nhân sự', detail: 'Chờ người phụ trách xử lý', to: '/hr?tab=leave', icon: 'calendar', tone: 'orange' },
    { key: 'recruitment', label: 'Ứng viên được đề xuất', detail: 'Chờ quyết định tiếp nhận', to: '/hr?tab=recruitment', icon: 'users', tone: 'violet' },
    { key: 'refunds', label: 'Yêu cầu hoàn học phí', detail: 'Chờ duyệt hoàn tiền', to: '/finance?tab=refunds', icon: 'money', tone: 'green' },
    { key: 'operatingExpenses', label: 'Đề nghị chi vận hành', detail: 'Chờ duyệt trước khi chi', to: '/accounting/operating-expenses', icon: 'money', tone: 'orange' },
    { key: 'profileChanges', label: 'Cập nhật hồ sơ học sinh', detail: 'Thay đổi nhạy cảm chờ duyệt', to: '/student-profile-change-requests', icon: 'card', tone: 'blue' },
    { key: 'parentFeedback', label: 'Ý kiến phụ huynh', detail: 'Chờ tiếp nhận', to: '/parent-feedback', icon: 'chat', tone: 'violet' },
  ];
  const cards = isTeacher ? [
    { label: 'Học sinh lớp tôi', value: summary.totalStudents || 0, note: 'Đang theo học', icon: 'students', tone: 'blue', to: '/students', detailLabel: 'Xem học sinh được phân công' },
    { label: 'Lớp được phân công', value: summary.totalClassrooms || 0, note: 'Đang hoạt động', icon: 'classes', tone: 'orange', to: '/attendance', detailLabel: 'Điểm danh lớp được phân công' },
    { label: 'Có mặt hôm nay', value: summary.attendedToday || 0, note: 'Theo điểm danh của lớp', icon: 'attendance', tone: 'green', to: '/attendance', detailLabel: 'Điểm danh lớp' },
  ] : [
    { label: 'Tổng số học sinh', value: summary.totalStudents || 0, note: 'Đang theo học', icon: 'students', tone: 'blue', to: '/students', detailLabel: 'Xem danh sách học sinh' },
    { label: 'Giáo viên & nhân sự', value: summary.totalTeachers || 0, note: 'Đang làm việc', icon: 'users', tone: 'violet', to: '/hr', detailLabel: 'Xem danh sách nhân sự' },
    { label: 'Lớp học hoạt động', value: summary.totalClassrooms || 0, note: 'Trong năm học này', icon: 'classes', tone: 'orange', to: '/classrooms', detailLabel: 'Xem danh sách lớp học' },
    { label: 'Doanh thu hôm nay', value: formatMoney(summary.todayRevenue), note: 'Cập nhật trong ngày', icon: 'money', tone: 'green', to: '/finance', detailLabel: 'Xem giao dịch tài chính' },
  ];
  const attendance = data?.recentAttendance || [];
  const attendancePagination = data?.recentAttendancePagination || {};
  const attendanceOverview = data?.attendanceSummary || {};
  const attendanceBreakdown = [
    { key: 'present', label: 'Có mặt', color: '#35b783', count: attendanceOverview.present || 0 },
    { key: 'late', label: 'Đi muộn', color: '#f0a44b', count: attendanceOverview.late || 0 },
    { key: 'absent', label: 'Vắng mặt', color: '#ed7180', count: attendanceOverview.absent || 0 },
    { key: 'absent_permission', label: 'Có phép', color: '#8a7ae1', count: attendanceOverview.absent_permission || 0 },
  ];
  const attendanceTotal = attendanceOverview.total ?? attendancePagination.total ?? attendance.length;
  const totalAttendancePages = Math.max(1, attendancePagination.totalPages || Math.ceil(attendanceTotal / 10));
  let chartOffset = 0;
  const attendanceChart = attendanceTotal
    ? attendanceBreakdown.filter((entry) => entry.count > 0).map((entry) => {
      const start = chartOffset;
      chartOffset += (entry.count / attendanceTotal) * 100;
      return `${entry.color} ${start}% ${chartOffset}%`;
    }).join(', ')
    : '#e7edf8 0 100%';
  const presentRate = attendanceTotal ? Math.round((attendanceBreakdown[0].count / attendanceTotal) * 100) : 0;
  const todayText = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());

  return (
    <AppShell title={isPrincipal ? 'Tổng quan hiệu trưởng' : 'Tổng quan'} subtitle={`Hôm nay là ${todayText}.`} actions={<Link className="button button-primary" to={isPrincipal ? '/reports' : '/attendance'}><Icon name={isPrincipal ? 'chart' : 'attendance'} size={18} />{isPrincipal ? 'Xem báo cáo trường' : 'Điểm danh hôm nay'}</Link>}>
      {error && <div className="notice notice-warning"><span>!</span>{error}</div>}
      {isPrincipal && <section className="content-card" aria-label="Công việc cần hiệu trưởng xem xét"><div className="card-heading"><div><p className="card-kicker">ĐIỀU HÀNH NHÀ TRƯỜNG</p><h2>Việc cần xem xét</h2><p>Số lượng đang chờ xử lý trên toàn trường. Chọn một mục để mở đúng quy trình.</p></div></div>{principalWorkError && <div className="notice notice-warning" role="alert">{principalWorkError}</div>}<div className="principal-action-grid">{principalWorkItems.map((item) => <Link className="quick-action" to={item.to} key={item.key}><span className={`quick-icon ${item.tone}`}><Icon name={item.icon} /></span><span><strong>{item.label}</strong><small>{item.detail}</small></span><b className="principal-work-count" aria-label={`${principalWork?.[item.key] ?? 'Đang tải'} việc`}>{principalWork ? principalWork[item.key] : '—'}</b><Icon name="chevronRight" size={18} /></Link>)}</div></section>}
      <section className="stat-grid" aria-label="Chỉ số tổng quan">
        {cards.map((card) => <Link className="stat-card stat-card-link" to={card.to} key={card.label} aria-label={card.detailLabel}><div className={`stat-icon ${card.tone}`}><Icon name={card.icon} size={23} /></div><div><p>{card.label}</p><strong>{card.value}</strong><small>{card.note}</small><span className="stat-card-link-hint">{card.detailLabel}<Icon name="chevronRight" size={14} /></span></div></Link>)}
      </section>
      {!isTeacher && data?.staffingError && <div className="notice notice-warning">Chưa thể kiểm tra tình trạng thiếu giáo viên. Vui lòng mở phần phân công để kiểm tra lại.</div>}
      {!isTeacher && staffing && <section className={`content-card dashboard-staffing-alert ${staffing.missingTeacherTotal ? 'has-shortage' : ''}`}><div><p className="card-kicker">PHÂN CÔNG HÔM NAY · {staffing.date}</p><h2>{staffing.missingTeacherTotal ? `Thiếu ${staffing.missingTeacherTotal} giáo viên tại ${staffing.teacherShortages.length} lớp` : 'Các lớp đủ giáo viên theo định mức'}</h2>{staffing.uncoveredShifts > 0 && <p>Còn {staffing.uncoveredShifts} ca bếp/bảo vệ chưa có người trực hoặc người thay.</p>}</div><div className="dashboard-staffing-list">{staffing.teacherShortages.map((item) => <span key={item._id}><strong>{item.name}</strong> · thiếu {item.missingTeachers} người ({item.presentTeachers}/{item.requiredTeachers})</span>)}</div><Link className="button button-secondary" to="/hr?tab=staffing">Xem phân công</Link></section>}
      <section className="dashboard-grid">
        <article className="content-card attendance-card">
          <div className="card-heading"><div><p className="card-kicker">THEO DÕI HÀNG NGÀY</p><h2>Điểm danh gần đây</h2></div><Link to="/attendance" className="text-link">Xem tất cả <Icon name="chevronRight" size={16} /></Link></div>
          <section className="attendance-chart-section" aria-label="Biểu đồ tình hình điểm danh gần đây">
            <div className="attendance-chart-copy"><p>PHÂN BỐ ĐIỂM DANH</p><h3>Tình hình điểm danh hôm nay</h3><span>{attendanceTotal ? `Tổng ${attendanceTotal} lượt điểm danh hôm nay` : 'Chưa có lượt điểm danh để tổng hợp'}</span></div>
            <div className="attendance-donut" style={{ '--attendance-chart': attendanceChart }}><div><strong>{presentRate}%</strong><small>Có mặt</small></div></div>
            <ul className="attendance-chart-legend">{attendanceBreakdown.map((entry) => <li key={entry.key}><i style={{ background: entry.color }} /><span>{entry.label}</span><b>{entry.count}</b></li>)}</ul>
          </section>
          {attendance.length ? <><div className="table-wrap"><table className="data-table"><thead><tr><th>Học sinh</th><th>Trạng thái</th><th>Thời gian đến</th></tr></thead><tbody>{attendance.map((item, index) => <tr key={item._id || index}><td><span className="student-avatar">{item.studentName?.charAt(0) || 'H'}</span>{item.studentName || 'Học sinh'}</td><td><span className={`status-badge ${item.status || 'present'}`}><i />{statusLabel[item.status] || 'Có mặt'}</span></td><td>{item.checkInTime ? new Date(item.checkInTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td></tr>)}</tbody></table></div>{totalAttendancePages > 1 && <nav className="dashboard-pagination" aria-label="Phân trang điểm danh gần đây"><span>Trang {attendancePage}/{totalAttendancePages} · {attendanceTotal} lượt</span><div><button type="button" onClick={() => setAttendancePage((page) => Math.max(1, page - 1))} disabled={attendancePage === 1}>Trước</button><button type="button" onClick={() => setAttendancePage((page) => Math.min(totalAttendancePages, page + 1))} disabled={attendancePage === totalAttendancePages}>Sau <Icon name="chevronRight" size={14} /></button></div></nav>}</> : <div className="empty-state"><span className="empty-icon"><Icon name="attendance" /></span><strong>Chưa có dữ liệu điểm danh</strong><p>Bắt đầu điểm danh để theo dõi tình hình đến lớp hôm nay.</p><Link to="/attendance" className="button button-secondary">Chọn lớp điểm danh</Link></div>}
        </article>
        <aside className="quick-panel"><p className="card-kicker">TRUY CẬP NHANH</p><h2>Công việc hôm nay</h2><Link to="/attendance" className="quick-action"><span className="quick-icon blue"><Icon name="attendance" /></span><span><strong>Điểm danh lớp</strong><small>Ghi nhận có mặt, vắng, đi muộn</small></span><Icon name="chevronRight" size={18} /></Link>{isTeacher ? <><Link to="/attendance/leave-requests" className="quick-action"><span className="quick-icon orange"><Icon name="attendance" /></span><span><strong>Đơn nghỉ lớp tôi</strong><small>Theo dõi đơn phụ huynh đã gửi</small></span><Icon name="chevronRight" size={18} /></Link><Link to="/nutrition" className="quick-action"><span className="quick-icon violet"><Icon name="utensils" /></span><span><strong>Thực đơn & lưu ý ăn uống</strong><small>Xem thực đơn và cảnh báo của lớp</small></span><Icon name="chevronRight" size={18} /></Link><Link to="/messages" className="quick-action"><span className="quick-icon blue"><Icon name="chat" /></span><span><strong>Trao đổi phụ huynh</strong><small>Tin nhắn theo từng học sinh</small></span><Icon name="chevronRight" size={18} /></Link></> : <><Link to="/students" className="quick-action"><span className="quick-icon orange"><Icon name="students" /></span><span><strong>Hồ sơ học sinh</strong><small>Danh sách và tiếp nhận học sinh</small></span><Icon name="chevronRight" size={18} /></Link><Link to="/pickups" className="quick-action"><span className="quick-icon green"><Icon name="users" /></span><span><strong>Sổ đón trả trẻ</strong><small>Quét mã QR và xác thực người đón</small></span><Icon name="chevronRight" size={18} /></Link><Link to="/nutrition" className="quick-action"><span className="quick-icon amber"><Icon name="utensils" /></span><span><strong>Bếp ăn & Dinh dưỡng</strong><small>Thực đơn tuần và an toàn thực phẩm</small></span><Icon name="chevronRight" size={18} /></Link><Link to="/reports" className="quick-action"><span className="quick-icon violet"><Icon name="chart" /></span><span><strong>Xem báo cáo</strong><small>Chuyên cần, dinh dưỡng & vận hành</small></span><Icon name="chevronRight" size={18} /></Link></>}</aside>
      </section>
    </AppShell>
  );
}
