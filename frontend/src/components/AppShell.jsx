import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import Icon from './Icon';
import api from '../api/axiosConfig';

const allNavItems = [
  { to: '/dashboard', label: 'Tổng quan', icon: 'grid', permission: 'report.read' },
  { to: '/attendance', label: 'Điểm danh', icon: 'attendance', permission: 'attendance.manage' },
  { to: '/timekeeping', label: 'Chấm công nhân sự', icon: 'clock', roles: ['admin', 'principal', 'teacher'] },
  { to: '/parent-accounts', label: 'Duyệt phụ huynh', icon: 'users', roles: ['admin', 'principal'] },
  { to: '/students', label: 'Học sinh', icon: 'students', permission: 'student.read' },
  { to: '/classrooms', label: 'Lớp học', icon: 'classes', permission: 'classroom.read' },
  { to: '/finance', label: 'Tài chính', icon: 'money', permission: 'tuition.read' },
  { to: '/nutrition', label: 'Bếp ăn & Bán trú', icon: 'utensils', roles: ['admin', 'principal', 'chef', 'teacher'] },
  { to: '/reports', label: 'Báo cáo', icon: 'chart', permission: 'report.read' },
];

export default function AppShell({ title, subtitle, actions, children }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await api.get('/auth/me');
        setUser(res.data);
        setPermissions(res.data.permissions || []);
      } catch (err) {
        console.error('Lỗi lấy user:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchUser();
  }, []);

  if (loading) return <div className="page-loader"><span className="loading-orb" /></div>;

  const displayName = user?.profile?.fullName || user?.username || 'Quản trị viên';
  const isAdmin = user?.role === 'admin';

  // Lọc menu dựa trên permissions
  const navItems = allNavItems.filter(item => {
    if (item.roles?.includes(user?.role)) return true;
    if (isAdmin) return true;
    if (!item.permission) return false;
    return permissions.includes(item.permission);
  });

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink to="/dashboard" className="brand" aria-label="Mầm Non Hoa Nắng">
          <span className="brand-mark"><span>H</span></span>
          <span><strong>Hoa Nắng</strong><small>School Management</small></span>
        </NavLink>
        <nav className="sidebar-nav" aria-label="Điều hướng chính">
          <p className="nav-label">QUẢN LÝ</p>
          {navItems.map((item) => (
            <NavLink to={item.to} key={item.to} className="nav-link">
              <Icon name={item.icon} />{item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="nav-link is-disabled"><Icon name="settings" />Cài đặt</span>
          <button className="account-card" onClick={logout} title="Đăng xuất">
            <span className="avatar">{displayName.charAt(0).toUpperCase()}</span>
            <span><strong>{displayName}</strong><small>{user?.role || 'admin'}</small></span>
            <Icon name="logout" size={18} />
          </button>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">HỆ THỐNG QUẢN LÝ TRƯỜNG</p>
            <h1>{title}</h1>
            {subtitle && <p className="page-subtitle">{subtitle}</p>}
          </div>
          <div className="topbar-actions">
            {actions}
            <button className="icon-button" aria-label="Thông báo">
              <Icon name="bell" /><span className="notification-dot" />
            </button>
          </div>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}
