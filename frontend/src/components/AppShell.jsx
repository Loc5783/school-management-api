import { NavLink, useNavigate } from 'react-router-dom';
import Icon from './Icon';

const navItems = [
  { to: '/dashboard', label: 'Tổng quan', icon: 'grid' },
  { to: '/attendance', label: 'Điểm danh', icon: 'attendance' },
  { to: '/timekeeping', label: 'Chấm công thủ công', icon: 'clock' },
  { to: '/smart-attendance', label: 'Điểm danh tự động', icon: 'camera' },
  { to: '#students', label: 'Học sinh', icon: 'students', disabled: true },
  { to: '#classes', label: 'Lớp học', icon: 'classes', disabled: true },
  { to: '#reports', label: 'Báo cáo', icon: 'chart', disabled: true },
];

export default function AppShell({ title, subtitle, actions, children }) {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const displayName = user.profile?.fullName || user.username || 'Quản trị viên';

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
          {navItems.map((item) => item.disabled ? (
            <span className="nav-link is-disabled" key={item.label}><Icon name={item.icon} />{item.label}<small>Sắp có</small></span>
          ) : (
            <NavLink to={item.to} key={item.to} className="nav-link"><Icon name={item.icon} />{item.label}</NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="nav-link is-disabled"><Icon name="settings" />Cài đặt</span>
          <button className="account-card" onClick={logout} title="Đăng xuất">
            <span className="avatar">{displayName.charAt(0).toUpperCase()}</span>
            <span><strong>{displayName}</strong><small>{user.role || 'admin'}</small></span>
            <Icon name="logout" size={18} />
          </button>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div><p className="eyebrow">HỆ THỐNG QUẢN LÝ TRƯỜNG</p><h1>{title}</h1>{subtitle && <p className="page-subtitle">{subtitle}</p>}</div>
          <div className="topbar-actions">
            {actions}
            <button className="icon-button" aria-label="Thông báo"><Icon name="bell" /><span className="notification-dot" /></button>
          </div>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}
