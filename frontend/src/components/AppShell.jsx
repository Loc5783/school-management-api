import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import Icon from './Icon';
import api from '../api/axiosConfig';

const allNavItems = [
  { to: '/dashboard', label: 'Tổng quan', icon: 'grid', permission: 'report.read' },
  { to: '/attendance', label: 'Điểm danh', icon: 'attendance', permission: 'attendance.manage' },
  { to: '/timekeeping', label: 'Chấm công nhân sự', icon: 'clock', roles: ['admin', 'principal', 'teacher'] },
  { to: '/hr', label: 'Nhân sự & Lương', icon: 'users', roles: ['admin', 'principal', 'accountant'] },
  { to: '/parent-accounts', label: 'Duyệt phụ huynh', icon: 'users', roles: ['admin', 'principal'] },
  { to: '/parent-portal', label: 'Thông tin của con', icon: 'students', roles: ['parent'] },
  { to: '/students', label: 'Học sinh', icon: 'students', permission: 'student.read' },
  { to: '/classrooms', label: 'Lớp học', icon: 'classes', permission: 'classroom.read' },
  { to: '/finance', label: 'Tài chính', icon: 'money', permission: 'tuition.read' },
  { to: '/nutrition', label: 'Bếp ăn & Bán trú', icon: 'utensils', roles: ['admin', 'principal', 'chef', 'teacher'] },
  { to: '/assets', label: 'Cơ sở vật chất', icon: 'settings', roles: ['admin', 'principal', 'teacher'] },
  { to: '/reports', label: 'Báo cáo', icon: 'chart', permission: 'report.read' },
];

export default function AppShell({ title, subtitle, actions, children }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);

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

  const loadNotifications = async () => {
    try {
      const res = await api.get('/notifications', { params: { limit: 10 } });
      setNotifications(res.data.data || []);
      setUnreadCount(res.data.unread || 0);
    } catch (err) { console.error('Lỗi lấy thông báo:', err); }
  };

  const toggleNotifications = async () => {
    setShowNotifications((value) => !value);
    if (!showNotifications) await loadNotifications();
  };

  const openNotification = async (item) => {
    if (!item.isRead) {
      try { await api.patch(`/notifications/${item._id}/read`); } catch (err) { console.error(err); }
    }
    setNotifications((items) => items.map((entry) => entry._id === item._id ? { ...entry, isRead: true } : entry));
    setUnreadCount((count) => Math.max(0, count - (item.isRead ? 0 : 1)));
    setShowNotifications(false);
    if (item.link?.startsWith('/')) navigate(item.link);
  };

  if (loading) return <div className="page-loader"><span className="loading-orb" /></div>;

  const displayName = user?.profile?.fullName || user?.username || 'Quản trị viên';
  const isAdmin = user?.role === 'admin';
  const roleLabel = { admin: 'Quản trị viên', principal: 'Hiệu trưởng', teacher: 'Giáo viên', accountant: 'Kế toán', chef: 'Nhân viên bếp', parent: 'Phụ huynh', guard: 'Bảo vệ' }[user?.role] || 'Tài khoản trường';

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
          <span className="brand-mark"><Icon name="classes" size={22} stroke={2.2} /></span>
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
          <div className="topbar-copy">
            <p className="eyebrow">HỆ THỐNG QUẢN LÝ TRƯỜNG</p>
            <h1>{title}</h1>
            {subtitle && <p className="page-subtitle">{subtitle}</p>}
          </div>
          <div className="topbar-actions">
            {actions}
            <div className="notification-menu"><button className="icon-button" aria-label="Thông báo" onClick={toggleNotifications}>
              <Icon name="bell" />{unreadCount > 0 && <span className="notification-dot" />}
            </button>{showNotifications && <div className="notification-popover"><div><strong>Thông báo</strong>{unreadCount > 0 && <span>{unreadCount} chưa đọc</span>}</div>{notifications.length ? notifications.map((item) => <button key={item._id} className={item.isRead ? '' : 'unread'} onClick={() => openNotification(item)}><strong>{item.title}</strong><small>{item.message}</small></button>) : <p>Chưa có thông báo mới.</p>}</div>}</div>
            <div className="topbar-profile"><span className="avatar">{displayName.charAt(0).toUpperCase()}</span><span><strong>{displayName}</strong><small>{roleLabel}</small></span><Icon name="chevronRight" size={15} /></div>
          </div>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}
