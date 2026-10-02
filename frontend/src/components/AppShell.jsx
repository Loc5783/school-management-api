import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import Icon from './Icon';
import api from '../api/axiosConfig';
import { getUnreadChat } from '../api/chat';

const allNavItems = [
  { to: '/dashboard', label: 'Tổng quan', icon: 'grid', roles: ['admin', 'principal', 'teacher'] },
  { to: '/attendance', label: 'Điểm danh', icon: 'attendance', roles: ['admin', 'principal', 'teacher'] },
  { to: '/timekeeping', label: 'Chấm công nhân sự', icon: 'clock', roles: ['admin', 'principal', 'teacher'] },
  { to: '/my-payroll', label: 'Lương của tôi', icon: 'money', roles: ['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard', 'hr'] },
  { to: '/hr', label: 'Nhân sự & Lương', icon: 'users', roles: ['admin', 'principal', 'accountant', 'hr'] },
  { to: '/accounts', label: 'Tài khoản & vai trò', icon: 'shield', roles: ['admin', 'principal', 'hr'] },
  { to: '/student-profile-change-requests', label: 'Duyệt cập nhật hồ sơ', icon: 'card', roles: ['admin', 'principal'] },
  { to: '/parent-feedback', label: 'Phản hồi phụ huynh', icon: 'chat', roles: ['admin', 'principal'] },
  { to: '/parent-dashboard', label: 'Tổng quan', icon: 'grid', roles: ['parent'] },
  { to: '/parent-portal', label: 'Thông tin của con', icon: 'students', roles: ['parent'] },
  { to: '/parent-care', label: 'Sổ chăm sóc của con', icon: 'attendance', roles: ['parent'] },
  { to: '/pickups', label: 'Đón trẻ', icon: 'users', roles: ['parent', 'teacher', 'guard', 'admin', 'principal'] },
  { to: '/messages', label: 'Tin nhắn', icon: 'chat', roles: ['parent', 'teacher'] },
  { to: '/daily-care', label: 'Sổ chăm sóc lớp', icon: 'attendance', roles: ['teacher'] },
  { to: '/students', label: 'Học sinh', icon: 'students', roles: ['admin', 'principal', 'teacher'] },
  { to: '/classrooms', label: 'Lớp học', icon: 'classes', roles: ['admin', 'principal'] },
  { to: '/finance', label: 'Tài chính', icon: 'money', permission: 'tuition.read' },
  { to: '/nutrition', label: 'Bếp ăn & Bán trú', icon: 'utensils', roles: ['admin', 'principal', 'chef', 'teacher'] },
  { to: '/assets', label: 'Đề xuất mua sắm', icon: 'settings', roles: ['teacher'] },
  { to: '/assets', label: 'Cơ sở vật chất', icon: 'settings', roles: ['admin', 'principal'] },
  { to: '/reports', label: 'Báo cáo', icon: 'chart', permission: 'report.read' },
];

export default function AppShell({ title, subtitle, actions, children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const navRef = useRef(null);
  const chatUnreadRequestRef = useRef(0);
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatUnread, setChatUnread] = useState({ total: 0, data: [] });
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

  useEffect(() => {
    if (loading) return undefined;
    const frame = requestAnimationFrame(() => {
      const nav = navRef.current;
      const activeLink = nav?.querySelector('.nav-link.active');
      if (!nav || !activeLink) return;
      const targetTop = activeLink.offsetTop - (nav.clientHeight - activeLink.offsetHeight) / 2;
      nav.scrollTo({ top: Math.max(0, targetTop), behavior: 'auto' });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.pathname, loading]);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await api.get('/notifications', { params: { limit: 10 } });
      setNotifications(res.data.data || []);
      setUnreadCount(res.data.unread || 0);
    } catch (err) { console.error('Lỗi lấy thông báo:', err); }
  }, []);

  const loadUnreadChat = useCallback(async () => {
    const requestId = ++chatUnreadRequestRef.current;
    try {
      const res = await getUnreadChat();
      if (requestId === chatUnreadRequestRef.current) {
        setChatUnread({ total: res.data.total || 0, data: res.data.data || [] });
      }
    } catch (err) { console.error('Lỗi lấy tin nhắn chưa đọc:', err); }
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    const chatEnabled = ['parent', 'teacher'].includes(user.role);
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      void loadNotifications();
      if (chatEnabled) void loadUnreadChat();
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener('chat:updated', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('chat:updated', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [user, loadNotifications, loadUnreadChat]);

  const toggleNotifications = async () => {
    setShowNotifications((value) => !value);
    if (!showNotifications) {
      await loadNotifications();
      if (['parent', 'teacher'].includes(user?.role)) await loadUnreadChat();
    }
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

  const openChatAlert = (item) => {
    setShowNotifications(false);
    navigate(`/messages?conversation=${item.conversationId}`);
  };

  if (loading) return <div className="page-loader"><span className="loading-orb" /></div>;

  const displayName = user?.profile?.fullName || user?.username || 'Quản trị viên';
  const isAdmin = user?.role === 'admin';
  const roleLabel = { admin: 'Quản trị viên', principal: 'Hiệu trưởng', teacher: 'Giáo viên', accountant: 'Kế toán', chef: 'Nhân viên bếp', hr: 'Nhân sự', parent: 'Phụ huynh', guard: 'Bảo vệ' }[user?.role] || 'Tài khoản trường';
  const totalUnread = unreadCount + chatUnread.total;

  // Lọc menu dựa trên permissions
  const navItems = allNavItems.filter(item => {
    // Phụ huynh chỉ dùng cổng thông tin của con và tin nhắn giáo viên.
    // Không hiển thị trang quản lý/danh sách học sinh, kể cả khi tài khoản
    // cũ còn mang permission student.read.
    if (user?.role === 'parent') return Boolean(item.roles?.includes('parent'));
    // Mục khai báo roles là khu vực chuyên biệt: kể cả Admin cũng chỉ nhìn thấy
    // khi vai trò của họ nằm trong danh sách (ví dụ cổng thông tin phụ huynh).
    if (item.roles) return item.roles.includes(user?.role);
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
        <nav ref={navRef} className="sidebar-nav" aria-label="Điều hướng chính">
          <p className="nav-label">QUẢN LÝ</p>
          {navItems.map((item) => (
            <NavLink to={item.to} key={item.to} className="nav-link">
              <Icon name={item.icon} />{item.label}{item.to === '/messages' && chatUnread.total > 0 && <span className="nav-chat-count">{chatUnread.total > 99 ? '99+' : chatUnread.total}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {user?.role === 'parent' ? <NavLink to="/parent-settings" className="nav-link"><Icon name="settings" />Cài đặt</NavLink> : <span className="nav-link is-disabled"><Icon name="settings" />Cài đặt</span>}
          <div className="account-card">
            <span className="avatar">{displayName.charAt(0).toUpperCase()}</span>
            <span><strong>{displayName}</strong><small>{roleLabel}</small></span>
          </div>
          <button className="sidebar-logout" onClick={logout} title="Đăng xuất khỏi hệ thống">
            <Icon name="logout" size={17} />Đăng xuất
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
            <div className="notification-menu"><button className="icon-button" aria-label={`Thông báo${totalUnread ? `, ${totalUnread} chưa đọc` : ''}`} onClick={toggleNotifications}>
              <Icon name="bell" />{totalUnread > 0 && <span className="notification-count">{totalUnread > 99 ? '99+' : totalUnread}</span>}
            </button>{showNotifications && <div className="notification-popover"><div><strong>Thông báo</strong>{totalUnread > 0 && <span>{totalUnread} chưa đọc</span>}</div>{chatUnread.data.length > 0 && <><div className="notification-group-label">TIN NHẮN</div>{chatUnread.data.map((item) => <button key={item.conversationId} className="chat-alert unread" onClick={() => openChatAlert(item)}><strong>Bạn có {item.count} tin nhắn từ {user?.role === 'teacher' ? 'phụ huynh' : 'giáo viên'} {item.senderName}</strong><small>Về bé {item.studentName} · Nhấn để xem và đánh dấu đã đọc</small><span className="chat-unread-dot" /></button>)}</>}{notifications.length > 0 && chatUnread.data.length > 0 && <div className="notification-group-label">THÔNG BÁO KHÁC</div>}{notifications.length ? notifications.map((item) => <button key={item._id} className={item.isRead ? '' : 'unread'} onClick={() => openNotification(item)}><strong>{item.title}</strong><small>{item.message}</small></button>) : chatUnread.data.length === 0 && <p>Chưa có thông báo mới.</p>}</div>}</div>
            <div className="topbar-profile"><span className="avatar">{displayName.charAt(0).toUpperCase()}</span><span><strong>{displayName}</strong><small>{roleLabel}</small></span><Icon name="chevronRight" size={15} /></div>
          </div>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}
