import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import Icon from './Icon';
import api from '../api/axiosConfig';
import { getUnreadChat } from '../api/chat';

const allNavItems = [
  { to: '/dashboard', label: 'Tổng quan', icon: 'grid', roles: ['admin', 'principal', 'teacher'] },
  { to: '/principal', label: 'Sổ điều hành', icon: 'chart', roles: ['admin', 'principal'] },
  { to: '/accounts', label: 'Tài khoản & vai trò', icon: 'shield', roles: ['admin', 'hr'] },
  { to: '/students', label: 'Học sinh', icon: 'students', roles: ['admin', 'principal', 'teacher', 'hr'] },
  { to: '/classrooms', label: 'Lớp học', icon: 'classes', roles: ['admin', 'principal'] },
  { to: '/attendance', label: 'Điểm danh', icon: 'attendance', roles: ['admin', 'teacher'] },
  { to: '/attendance/reports', label: 'Báo cáo điểm danh', icon: 'attendance', roles: ['principal'] },
  { to: '/timekeeping', label: 'Chấm công nhân sự', icon: 'clock', roles: ['admin', 'principal', 'guard'] },
  { to: '/hr', label: 'Nhân sự', icon: 'users', roles: ['admin', 'principal', 'hr'] },
  { to: '/payroll', label: 'Lương & Chi trả', icon: 'money', roles: ['admin', 'principal', 'accountant', 'hr'] },
  { to: '/finance', label: 'Tài chính', icon: 'money', roles: ['admin', 'principal', 'accountant'] },
  { to: '/accounting', label: 'Tổng quan kế toán', icon: 'grid', roles: ['accountant'] },
  { to: '/accounting/expenses', label: 'Sổ chi mua sắm', icon: 'money', roles: ['accountant', 'admin'] },
  { to: '/accounting/operating-expenses', label: 'Chi vận hành', icon: 'money', roles: ['admin', 'principal', 'accountant'] },
  { to: '/accounting/cashbook', label: 'Đối soát thu – chi', icon: 'chart', roles: ['accountant', 'admin'] },
  { to: '/accounting/report', label: 'Báo cáo kế toán', icon: 'chart', roles: ['accountant', 'admin'] },
  { to: '/kitchen', label: 'Bếp hôm nay', icon: 'grid', roles: ['chef', 'admin'] },
  { to: '/nutrition', label: 'Bếp ăn & Bán trú', icon: 'utensils', roles: ['admin', 'principal', 'chef', 'teacher'] },
  { to: '/guard', label: 'Tổng quan trực cổng', icon: 'grid', roles: ['guard', 'admin'] },
  { to: '/pickups', label: 'Đón trẻ', icon: 'users', roles: ['parent', 'admin', 'principal'] },
  { to: '/assets', label: 'Đề xuất mua sắm', icon: 'settings', roles: ['teacher'] },
  { to: '/assets', label: 'Cơ sở vật chất', icon: 'settings', roles: ['admin', 'principal'] },
  { to: '/reports', label: 'Báo cáo', icon: 'chart', roles: ['admin', 'principal', 'accountant'] },
  { to: '/internal-notices', label: 'Thông báo nội bộ', icon: 'calendar', roles: ['admin', 'principal', 'hr', 'teacher', 'accountant', 'chef', 'guard'] },
  { to: '/my-staffing', label: 'Lịch phân công của tôi', icon: 'calendar', roles: ['teacher', 'chef', 'guard'] },
  { to: '/my-handovers', label: 'Việc bàn giao của tôi', icon: 'users', roles: ['admin', 'principal', 'hr', 'teacher', 'accountant', 'chef', 'guard'] },
  { to: '/my-requests', label: 'Yêu cầu của tôi', icon: 'card', roles: ['admin', 'principal', 'hr', 'teacher', 'accountant', 'chef', 'guard'] },
  { to: '/my-payroll', label: 'Lương của tôi', icon: 'money', roles: ['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard', 'hr'] },
  { to: '/professional-reviews', label: 'Đánh giá chuyên môn', icon: 'users', roles: ['teacher', 'principal', 'admin'], positions: ['head_teacher', 'principal', 'vice_principal'] },
  { to: '/student-profile-change-requests', label: 'Duyệt cập nhật hồ sơ', icon: 'card', roles: ['principal'] },
  { to: '/parent-feedback', label: 'Phản hồi phụ huynh', icon: 'chat', roles: ['principal'] },
  { to: '/parent-dashboard', label: 'Tổng quan', icon: 'grid', roles: ['parent'] },
  { to: '/parent-portal', label: 'Thông tin của con', icon: 'students', roles: ['parent'] },
  { to: '/parent-care', label: 'Sổ chăm sóc của con', icon: 'attendance', roles: ['parent'] },
  { to: '/messages', label: 'Tin nhắn', icon: 'chat', roles: ['parent', 'teacher'] },
  { to: '/daily-care', label: 'Sổ chăm sóc lớp', icon: 'attendance', roles: ['teacher'] },
];

const PRINCIPAL_SIDEBAR_STORAGE_KEY = 'principal_sidebar_open_groups';

const principalNavSections = [
  {
    id: 'overview-ops',
    label: 'TỔNG QUAN & ĐIỀU HÀNH',
    icon: 'grid',
    items: [
      { to: '/principal', label: 'Sổ điều hành', icon: 'chart' },
      { to: '/dashboard', label: 'Tổng quan hôm nay', icon: 'grid' },
      { to: '/internal-notices', label: 'Thông báo chỉ đạo', icon: 'calendar' },
    ],
  },
  {
    id: 'approvals',
    label: 'PHÊ DUYỆT',
    icon: 'check',
    items: [
      { to: '/student-profile-change-requests', label: 'Duyệt hồ sơ học sinh', icon: 'card' },
      { to: '/accounting/operating-expenses', label: 'Duyệt chi vận hành', icon: 'money' },
      { to: '/finance?tab=refunds', label: 'Duyệt hoàn học phí', icon: 'money' },
      { to: '/hr?tab=leave', label: 'Duyệt nghỉ phép', icon: 'calendar' },
      { to: '/payroll', label: 'Duyệt bảng lương', icon: 'money' },
    ],
  },
  {
    id: 'supervision',
    label: 'GIÁM SÁT NHÀ TRƯỜNG',
    icon: 'classes',
    items: [
      { to: '/classrooms', label: 'Lớp học', icon: 'classes' },
      { to: '/pickups', label: 'Giám sát đón trẻ', icon: 'users' },
      { to: '/hr', label: 'Nhân sự', icon: 'users' },
      { to: '/finance', label: 'Tài chính học phí', icon: 'money' },
    ],
  },
  {
    id: 'reports',
    label: 'BÁO CÁO & ĐÁNH GIÁ',
    icon: 'chart',
    items: [
      { to: '/attendance/reports', label: 'Báo cáo chuyên cần', icon: 'attendance' },
      { to: '/reports', label: 'Báo cáo nhà trường', icon: 'chart' },
      { to: '/accounting/report', label: 'Báo cáo kế toán', icon: 'chart' },
      { to: '/professional-reviews', label: 'Đánh giá chuyên môn', icon: 'users' },
    ],
  },
  {
    id: 'feedback',
    label: 'PHẢN HỒI PHỤ HUYNH',
    icon: 'chat',
    items: [
      { to: '/parent-feedback', label: 'Phản hồi phụ huynh', icon: 'chat' },
    ],
  },
  {
    id: 'personal',
    label: 'CÁ NHÂN',
    icon: 'users',
    items: [
      { to: '/my-requests', label: 'Yêu cầu của tôi', icon: 'card' },
      { to: '/my-payroll', label: 'Lương của tôi', icon: 'money' },
    ],
  },
];

const TEACHER_SIDEBAR_STORAGE_KEY = 'teacher_sidebar_open_groups';

const teacherNavSections = [
  {
    id: 'teacher-overview',
    label: 'TỔNG QUAN',
    icon: 'grid',
    items: [
      { to: '/dashboard', label: 'Tổng quan', icon: 'grid' },
    ],
  },
  {
    id: 'teacher-classroom-care',
    label: 'LỚP HỌC & CHĂM SÓC',
    icon: 'classes',
    items: [
      { to: '/students', label: 'Học sinh', icon: 'students' },
      { to: '/attendance', label: 'Điểm danh', icon: 'attendance' },
      { to: '/daily-care', label: 'Sổ chăm sóc lớp', icon: 'attendance' },
      { to: '/nutrition', label: 'Bếp ăn & Bán trú', icon: 'utensils' },
    ],
  },
  {
    id: 'teacher-communication',
    label: 'TRAO ĐỔI',
    icon: 'chat',
    items: [
      { to: '/messages', label: 'Tin nhắn', icon: 'chat' },
      { to: '/internal-notices', label: 'Thông báo nội bộ', icon: 'calendar' },
    ],
  },
  {
    id: 'teacher-work',
    label: 'CÔNG VIỆC',
    icon: 'calendar',
    items: [
      { to: '/my-staffing', label: 'Lịch phân công của tôi', icon: 'calendar' },
      { to: '/my-handovers', label: 'Việc bàn giao của tôi', icon: 'users' },
      { to: '/assets', label: 'Đề xuất mua sắm', icon: 'settings' },
      { to: '/professional-reviews', label: 'Đánh giá chuyên môn', icon: 'users', positions: ['head_teacher'] },
    ],
  },
  {
    id: 'teacher-personal',
    label: 'CÁ NHÂN',
    icon: 'users',
    items: [
      { to: '/my-leave-requests', label: 'Nghỉ phép cá nhân', icon: 'calendar' },
      { to: '/my-requests', label: 'Yêu cầu của tôi', icon: 'card' },
      { to: '/my-payroll', label: 'Lương của tôi', icon: 'money' },
    ],
  },
];

const ACCOUNTANT_SIDEBAR_STORAGE_KEY = 'accountant_sidebar_open_groups';

const accountantNavSections = [
  {
    id: 'accountant-overview',
    label: 'TỔNG QUAN',
    icon: 'grid',
    items: [
      { to: '/accounting', label: 'Tổng quan kế toán', icon: 'grid' },
    ],
  },
  {
    id: 'accountant-tuition',
    label: 'HỌC PHÍ & CÔNG NỢ',
    icon: 'money',
    items: [
      { to: '/finance?tab=invoices', label: 'Hóa đơn học phí', icon: 'card' },
      { to: '/finance?tab=schedules', label: 'Thiết lập mức thu', icon: 'settings' },
      { to: '/finance?tab=create', label: 'Lập học phí theo lớp', icon: 'users' },
      { to: '/finance?tab=debts', label: 'Công nợ', icon: 'chart' },
      { to: '/finance?tab=refunds', label: 'Hoàn học phí', icon: 'money' },
    ],
  },
  {
    id: 'accountant-expenses',
    label: 'CHI PHÍ & THANH TOÁN',
    icon: 'money',
    items: [
      { to: '/accounting/expenses', label: 'Sổ chi mua sắm', icon: 'money' },
      { to: '/accounting/operating-expenses', label: 'Chi vận hành', icon: 'money' },
      { to: '/payroll', label: 'Thanh toán lương', icon: 'users' },
    ],
  },
  {
    id: 'accountant-cashbook',
    label: 'SỔ QUỸ & ĐỐI SOÁT',
    icon: 'chart',
    items: [
      { to: '/accounting/cashbook', label: 'Sổ thu – chi / Đối soát', icon: 'chart' },
    ],
  },
  {
    id: 'accountant-reports',
    label: 'BÁO CÁO',
    icon: 'chart',
    items: [
      { to: '/accounting/report', label: 'Báo cáo kế toán', icon: 'chart' },
      { to: '/finance?tab=report', label: 'Báo cáo kỳ thu', icon: 'chart' },
      { to: '/reports', label: 'Báo cáo tổng hợp', icon: 'chart' },
    ],
  },
  {
    id: 'accountant-personal',
    label: 'CÔNG VIỆC & CÁ NHÂN',
    icon: 'users',
    items: [
      { to: '/internal-notices', label: 'Thông báo nội bộ', icon: 'calendar' },
      { to: '/my-handovers', label: 'Việc bàn giao của tôi', icon: 'users' },
      { to: '/my-requests', label: 'Yêu cầu của tôi', icon: 'card' },
      { to: '/my-payroll', label: 'Lương của tôi', icon: 'money' },
    ],
  },
];

const GUARD_SIDEBAR_STORAGE_KEY = 'guard_sidebar_open_groups';

const guardNavSections = [
  {
    id: 'guard-overview',
    label: 'TỔNG QUAN & CA TRỰC',
    icon: 'grid',
    items: [
      { to: '/guard?tab=overview', label: 'Tổng quan ca trực', icon: 'grid' },
      { to: '/timekeeping', label: 'Chấm công vào/ra ca', icon: 'clock' },
      { to: '/my-staffing', label: 'Lịch phân công của tôi', icon: 'calendar' },
    ],
  },
  {
    id: 'guard-security',
    label: 'AN NINH & TRỰC CỔNG',
    icon: 'shield',
    items: [
      { to: '/guard?tab=visitors', label: 'Khách ra/vào', icon: 'users' },
      { to: '/guard?tab=incidents', label: 'Sự cố an ninh', icon: 'alertCircle' },
      { to: '/guard?tab=emergency', label: 'Xử lý khẩn cấp', icon: 'shield' },
      { to: '/guard?tab=devices', label: 'Thiết bị cổng', icon: 'settings' },
    ],
  },
  {
    id: 'guard-handover',
    label: 'BÀN GIAO & THÔNG BÁO',
    icon: 'clock',
    items: [
      { to: '/guard?tab=handover', label: 'Bàn giao ca trực', icon: 'clock' },
      { to: '/internal-notices', label: 'Thông báo nội bộ', icon: 'calendar' },
    ],
  },
  {
    id: 'guard-personal',
    label: 'CÁ NHÂN',
    icon: 'users',
    items: [
      { to: '/my-leave-requests', label: 'Nghỉ phép cá nhân', icon: 'calendar' },
      { to: '/my-requests', label: 'Yêu cầu của tôi', icon: 'card' },
      { to: '/my-payroll', label: 'Lương của tôi', icon: 'money' },
    ],
  },
];

const isNavItemActive = (itemTo, pathname, search) => {
  const [targetPath, targetQuery] = itemTo.split('?');
  const targetParams = new URLSearchParams(targetQuery || '');
  const targetTab = targetParams.get('tab');

  const currentParams = new URLSearchParams(search || '');
  const currentTab = currentParams.get('tab');

  if (pathname !== targetPath) {
    if (pathname.startsWith(`${targetPath}/`)) {
      if (targetPath === '/accounting') {
        return false;
      }
      if (targetTab) {
        return currentTab === targetTab;
      }
      return true;
    }
    return false;
  }

  // Exact pathname match
  if (targetPath === '/guard') {
    if (targetTab) {
      if (targetTab === 'overview') {
        return !currentTab || currentTab === 'overview';
      }
      return currentTab === targetTab;
    }
    return !currentTab || currentTab === 'overview';
  }

  if (targetPath === '/finance') {
    if (targetTab) {
      if (targetTab === 'invoices') {
        return !currentTab || currentTab === 'invoices' || !['invoices', 'refunds', 'schedules', 'create', 'debts', 'report'].includes(currentTab);
      }
      return currentTab === targetTab;
    }
    return currentTab !== 'refunds';
  }

  if (targetPath === '/hr') {
    if (targetTab) {
      return currentTab === targetTab;
    }
    return currentTab !== 'leave';
  }

  if (targetTab) {
    return currentTab === targetTab;
  }

  return true;
};

const isPrincipalItemActive = isNavItemActive;

const getActiveSectionId = (sections, pathname, search) => {
  for (const section of sections) {
    if (section.items.some((item) => isPrincipalItemActive(item.to, pathname, search))) {
      return section.id;
    }
  }
  return null;
};

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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [prevPath, setPrevPath] = useState(location.pathname);
  const [openSections, setOpenSections] = useState(() => {
    let initialOpen = principalNavSections.map((s) => s.id);
    try {
      const saved = localStorage.getItem(PRINCIPAL_SIDEBAR_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          initialOpen = parsed;
        }
      }
    } catch (e) {
      console.error('Lỗi đọc trạng thái menu hiệu trưởng:', e);
    }
    const activeSectionId = getActiveSectionId(principalNavSections, location.pathname, location.search);
    if (activeSectionId && !initialOpen.includes(activeSectionId)) {
      initialOpen = [...initialOpen, activeSectionId];
    }
    return initialOpen;
  });

  const [teacherOpenSections, setTeacherOpenSections] = useState(() => {
    let initialOpen = teacherNavSections.map((s) => s.id);
    try {
      const saved = localStorage.getItem(TEACHER_SIDEBAR_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          initialOpen = parsed;
        }
      }
    } catch (e) {
      console.error('Lỗi đọc trạng thái menu giáo viên:', e);
    }
    const activeSectionId = getActiveSectionId(teacherNavSections, location.pathname, location.search);
    if (activeSectionId && !initialOpen.includes(activeSectionId)) {
      initialOpen = [...initialOpen, activeSectionId];
    }
    return initialOpen;
  });

  const [accountantOpenSections, setAccountantOpenSections] = useState(() => {
    let initialOpen = accountantNavSections.map((s) => s.id);
    try {
      const saved = localStorage.getItem(ACCOUNTANT_SIDEBAR_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          initialOpen = parsed;
        }
      }
    } catch (e) {
      console.error('Lỗi đọc trạng thái menu kế toán:', e);
    }
    const activeSectionId = getActiveSectionId(accountantNavSections, location.pathname, location.search);
    if (activeSectionId && !initialOpen.includes(activeSectionId)) {
      initialOpen = [...initialOpen, activeSectionId];
    }
    return initialOpen;
  });

  const [guardOpenSections, setGuardOpenSections] = useState(() => {
    let initialOpen = guardNavSections.map((s) => s.id);
    try {
      const saved = localStorage.getItem(GUARD_SIDEBAR_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          initialOpen = parsed;
        }
      }
    } catch (e) {
      console.error('Lỗi đọc trạng thái menu bảo vệ:', e);
    }
    const activeSectionId = getActiveSectionId(guardNavSections, location.pathname, location.search);
    if (activeSectionId && !initialOpen.includes(activeSectionId)) {
      initialOpen = [...initialOpen, activeSectionId];
    }
    return initialOpen;
  });

  if (prevPath !== location.pathname) {
    setPrevPath(location.pathname);
    setMobileNavOpen(false);
  }

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
  }, [location.pathname, location.search, loading]);

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

  const isPrincipal = user?.role === 'principal';
  const isTeacher = user?.role === 'teacher';
  const isAccountant = user?.role === 'accountant';
  const isGuard = user?.role === 'guard';
  const currentLocationKey = `${location.pathname}${location.search}`;
  const [prevLocationKey, setPrevLocationKey] = useState(currentLocationKey);

  if (prevLocationKey !== currentLocationKey) {
    setPrevLocationKey(currentLocationKey);
    if (isPrincipal) {
      const activeSectionId = getActiveSectionId(principalNavSections, location.pathname, location.search);
      if (activeSectionId && !openSections.includes(activeSectionId)) {
        const next = [...openSections, activeSectionId];
        setOpenSections(next);
        try {
          localStorage.setItem(PRINCIPAL_SIDEBAR_STORAGE_KEY, JSON.stringify(next));
        } catch (e) {
          console.error('Lỗi lưu trạng thái menu hiệu trưởng:', e);
        }
      }
    }
    if (isTeacher) {
      const activeSectionId = getActiveSectionId(teacherNavSections, location.pathname, location.search);
      if (activeSectionId && !teacherOpenSections.includes(activeSectionId)) {
        const next = [...teacherOpenSections, activeSectionId];
        setTeacherOpenSections(next);
        try {
          localStorage.setItem(TEACHER_SIDEBAR_STORAGE_KEY, JSON.stringify(next));
        } catch (e) {
          console.error('Lỗi lưu trạng thái menu giáo viên:', e);
        }
      }
    }
    if (isAccountant) {
      const activeSectionId = getActiveSectionId(accountantNavSections, location.pathname, location.search);
      if (activeSectionId && !accountantOpenSections.includes(activeSectionId)) {
        const next = [...accountantOpenSections, activeSectionId];
        setAccountantOpenSections(next);
        try {
          localStorage.setItem(ACCOUNTANT_SIDEBAR_STORAGE_KEY, JSON.stringify(next));
        } catch (e) {
          console.error('Lỗi lưu trạng thái menu kế toán:', e);
        }
      }
    }
    if (isGuard) {
      const activeSectionId = getActiveSectionId(guardNavSections, location.pathname, location.search);
      if (activeSectionId && !guardOpenSections.includes(activeSectionId)) {
        const next = [...guardOpenSections, activeSectionId];
        setGuardOpenSections(next);
        try {
          localStorage.setItem(GUARD_SIDEBAR_STORAGE_KEY, JSON.stringify(next));
        } catch (e) {
          console.error('Lỗi lưu trạng thái menu bảo vệ:', e);
        }
      }
    }
  }

  const toggleSection = (sectionId) => {
    setOpenSections((prev) => {
      const next = prev.includes(sectionId)
        ? prev.filter((id) => id !== sectionId)
        : [...prev, sectionId];
      try {
        localStorage.setItem(PRINCIPAL_SIDEBAR_STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        console.error('Lỗi lưu trạng thái menu hiệu trưởng:', e);
      }
      return next;
    });
  };

  const toggleTeacherSection = (sectionId) => {
    setTeacherOpenSections((prev) => {
      const next = prev.includes(sectionId)
        ? prev.filter((id) => id !== sectionId)
        : [...prev, sectionId];
      try {
        localStorage.setItem(TEACHER_SIDEBAR_STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        console.error('Lỗi lưu trạng thái menu giáo viên:', e);
      }
      return next;
    });
  };

  const toggleAccountantSection = (sectionId) => {
    setAccountantOpenSections((prev) => {
      const next = prev.includes(sectionId)
        ? prev.filter((id) => id !== sectionId)
        : [...prev, sectionId];
      try {
        localStorage.setItem(ACCOUNTANT_SIDEBAR_STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        console.error('Lỗi lưu trạng thái menu kế toán:', e);
      }
      return next;
    });
  };

  const toggleGuardSection = (sectionId) => {
    setGuardOpenSections((prev) => {
      const next = prev.includes(sectionId)
        ? prev.filter((id) => id !== sectionId)
        : [...prev, sectionId];
      try {
        localStorage.setItem(GUARD_SIDEBAR_STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        console.error('Lỗi lưu trạng thái menu bảo vệ:', e);
      }
      return next;
    });
  };

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
  const homePath = user?.role === 'guard' ? '/guard' : user?.role === 'chef' ? '/kitchen' : user?.role === 'accountant' ? '/accounting' : user?.role === 'parent' ? '/parent-dashboard' : user?.role === 'hr' ? '/hr' : isPrincipal ? '/principal' : '/dashboard';

  // Lọc menu dựa trên permissions và vai trò
  // Đảm bảo không trùng lặp route trong danh sách
  const seenPaths = new Set();
  const navItems = allNavItems.filter((item) => {
    if (user?.role === 'parent') return Boolean(item.roles?.includes('parent'));
    if (item.positions && !item.positions.includes(user?.employeeInfo?.position)) return false;
    if (item.roles && !item.roles.includes(user?.role)) return false;
    if (!item.roles && !isAdmin) {
      if (!item.permission || !permissions.includes(item.permission)) return false;
    }
    if (seenPaths.has(item.to)) return false;
    seenPaths.add(item.to);
    return true;
  });

  const renderNavigation = (mobile = false) => {
    if (isPrincipal) {
      const prefix = mobile ? 'mobile' : 'desktop';
      return (
        <div
          className="principal-nav-accordion"
          role="region"
          aria-label={mobile ? 'Menu chức năng hiệu trưởng di động' : 'Menu chức năng hiệu trưởng'}
        >
          {principalNavSections.map((section) => {
            const isOpen = openSections.includes(section.id);
            const contentId = `${prefix}-principal-nav-section-${section.id}`;
            return (
              <div key={section.id} className="nav-accordion-section">
                <button
                  type="button"
                  className={`nav-accordion-header ${isOpen ? 'is-open' : ''}`}
                  aria-expanded={isOpen}
                  aria-controls={contentId}
                  onClick={() => toggleSection(section.id)}
                >
                  <span className="nav-accordion-header-title">
                    {section.icon && <Icon name={section.icon} size={15} />}
                    <span>{section.label}</span>
                  </span>
                  <span className={`nav-accordion-chevron ${isOpen ? 'expanded' : ''}`}>
                    <Icon name="chevronRight" size={14} />
                  </span>
                </button>
                <div
                  id={contentId}
                  className="nav-accordion-content"
                  hidden={!isOpen}
                >
                  {section.items.map((item) => {
                    const isActive = isPrincipalItemActive(item.to, location.pathname, location.search);
                    return (
                      <NavLink
                        to={item.to}
                        key={item.to}
                        aria-current={isActive ? 'page' : undefined}
                        className={() => `nav-link nav-sub-link ${isActive ? 'active' : ''}`.trim()}
                        onClick={mobile ? () => setMobileNavOpen(false) : undefined}
                      >
                        <Icon name={item.icon} />
                        {item.label}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    if (isTeacher) {
      const prefix = mobile ? 'mobile' : 'desktop';
      return (
        <div
          className="principal-nav-accordion teacher-nav-accordion"
          role="region"
          aria-label={mobile ? 'Menu chức năng giáo viên di động' : 'Menu chức năng giáo viên'}
        >
          {teacherNavSections.map((section) => {
            const visibleItems = section.items.filter(
              (item) => !item.positions || item.positions.includes(user?.employeeInfo?.position)
            );
            if (!visibleItems.length) return null;

            const isOpen = teacherOpenSections.includes(section.id);
            const contentId = `${prefix}-teacher-nav-section-${section.id}`;
            return (
              <div key={section.id} className="nav-accordion-section">
                <button
                  type="button"
                  className={`nav-accordion-header ${isOpen ? 'is-open' : ''}`}
                  aria-expanded={isOpen}
                  aria-controls={contentId}
                  onClick={() => toggleTeacherSection(section.id)}
                >
                  <span className="nav-accordion-header-title">
                    {section.icon && <Icon name={section.icon} size={15} />}
                    <span>{section.label}</span>
                  </span>
                  <span className={`nav-accordion-chevron ${isOpen ? 'expanded' : ''}`}>
                    <Icon name="chevronRight" size={14} />
                  </span>
                </button>
                <div
                  id={contentId}
                  className="nav-accordion-content"
                  hidden={!isOpen}
                >
                  {visibleItems.map((item) => {
                    const isActive = isNavItemActive(item.to, location.pathname, location.search);
                    return (
                      <NavLink
                        to={item.to}
                        key={item.to}
                        aria-current={isActive ? 'page' : undefined}
                        className={() => `nav-link nav-sub-link ${isActive ? 'active' : ''}`.trim()}
                        onClick={mobile ? () => setMobileNavOpen(false) : undefined}
                      >
                        <Icon name={item.icon} />
                        {item.label}
                        {item.to === '/messages' && chatUnread.total > 0 && (
                          <span className="nav-chat-count">
                            {chatUnread.total > 99 ? '99+' : chatUnread.total}
                          </span>
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    if (isAccountant) {
      const prefix = mobile ? 'mobile' : 'desktop';
      return (
        <div
          className="principal-nav-accordion accountant-nav-accordion"
          role="region"
          aria-label={mobile ? 'Menu chức năng kế toán di động' : 'Menu chức năng kế toán'}
        >
          {accountantNavSections.map((section) => {
            const isOpen = accountantOpenSections.includes(section.id);
            const contentId = `${prefix}-accountant-nav-section-${section.id}`;
            return (
              <div key={section.id} className="nav-accordion-section">
                <button
                  type="button"
                  className={`nav-accordion-header ${isOpen ? 'is-open' : ''}`}
                  aria-expanded={isOpen}
                  aria-controls={contentId}
                  onClick={() => toggleAccountantSection(section.id)}
                >
                  <span className="nav-accordion-header-title">
                    {section.icon && <Icon name={section.icon} size={15} />}
                    <span>{section.label}</span>
                  </span>
                  <span className={`nav-accordion-chevron ${isOpen ? 'expanded' : ''}`}>
                    <Icon name="chevronRight" size={14} />
                  </span>
                </button>
                <div
                  id={contentId}
                  className="nav-accordion-content"
                  hidden={!isOpen}
                >
                  {section.items.map((item) => {
                    const isActive = isNavItemActive(item.to, location.pathname, location.search);
                    return (
                      <NavLink
                        to={item.to}
                        key={item.to}
                        aria-current={isActive ? 'page' : undefined}
                        className={() => `nav-link nav-sub-link ${isActive ? 'active' : ''}`.trim()}
                        onClick={mobile ? () => setMobileNavOpen(false) : undefined}
                      >
                        <Icon name={item.icon} />
                        {item.label}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    if (isGuard) {
      const prefix = mobile ? 'mobile' : 'desktop';
      return (
        <div
          className="principal-nav-accordion guard-nav-accordion"
          role="region"
          aria-label={mobile ? 'Menu chức năng bảo vệ di động' : 'Menu chức năng bảo vệ'}
        >
          {guardNavSections.map((section) => {
            const isOpen = guardOpenSections.includes(section.id);
            const contentId = `${prefix}-guard-nav-section-${section.id}`;
            return (
              <div key={section.id} className="nav-accordion-section">
                <button
                  type="button"
                  className={`nav-accordion-header ${isOpen ? 'is-open' : ''}`}
                  aria-expanded={isOpen}
                  aria-controls={contentId}
                  onClick={() => toggleGuardSection(section.id)}
                >
                  <span className="nav-accordion-header-title">
                    {section.icon && <Icon name={section.icon} size={15} />}
                    <span>{section.label}</span>
                  </span>
                  <span className={`nav-accordion-chevron ${isOpen ? 'expanded' : ''}`}>
                    <Icon name="chevronRight" size={14} />
                  </span>
                </button>
                <div
                  id={contentId}
                  className="nav-accordion-content"
                  hidden={!isOpen}
                >
                  {section.items.map((item) => {
                    const isActive = isNavItemActive(item.to, location.pathname, location.search);
                    return (
                      <NavLink
                        to={item.to}
                        key={item.to}
                        aria-current={isActive ? 'page' : undefined}
                        className={() => `nav-link nav-sub-link ${isActive ? 'active' : ''}`.trim()}
                        onClick={mobile ? () => setMobileNavOpen(false) : undefined}
                      >
                        <Icon name={item.icon} />
                        {item.label}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <>
        <p className="nav-label">QUẢN LÝ</p>
        {navItems.map((item) => (
          <NavLink
            to={item.to}
            key={item.to}
            className="nav-link"
            onClick={mobile ? () => setMobileNavOpen(false) : undefined}
          >
            <Icon name={item.icon} />
            {item.label}
            {item.to === '/messages' && chatUnread.total > 0 && (
              <span className="nav-chat-count">
                {chatUnread.total > 99 ? '99+' : chatUnread.total}
              </span>
            )}
          </NavLink>
        ))}
      </>
    );
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  return (
    <div className="app-shell">
      {/* Mobile Drawer Overlay */}
      {mobileNavOpen && (
        <div className="mobile-nav-backdrop" onClick={() => setMobileNavOpen(false)} role="presentation">
          <aside className="sidebar mobile-sidebar" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-sidebar-header">
              <NavLink to={homePath} className="brand" onClick={() => setMobileNavOpen(false)} aria-label="Mầm Non Hoa Nắng">
                <span className="brand-mark"><Icon name="sun" size={22} stroke={2.2} /></span>
                <span><strong>Hoa Nắng</strong><small>Mầm Non Hạnh Phúc</small></span>
              </NavLink>
              <button type="button" className="mobile-nav-close" onClick={() => setMobileNavOpen(false)} aria-label="Đóng menu">
                <Icon name="close" size={20} />
              </button>
            </div>
            <nav className="sidebar-nav" aria-label="Điều hướng chính di động">
              {renderNavigation(true)}
            </nav>
            <div className="sidebar-bottom">
              {user?.role === 'parent' ? (
                <NavLink to="/parent-settings" className="nav-link" onClick={() => setMobileNavOpen(false)}>
                  <Icon name="settings" />Cài đặt
                </NavLink>
              ) : (
                <NavLink to="/staff-settings" className="nav-link" onClick={() => setMobileNavOpen(false)}>
                  <Icon name="settings" />Cài đặt tài khoản
                </NavLink>
              )}
              <div className="account-card">
                <span className="avatar">{displayName.charAt(0).toUpperCase()}</span>
                <span><strong>{displayName}</strong><small>{roleLabel}</small></span>
              </div>
              <button className="sidebar-logout" onClick={logout} title="Đăng xuất khỏi hệ thống">
                <Icon name="logout" size={17} />Đăng xuất
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Desktop Persistent Sidebar */}
      <aside className="sidebar desktop-sidebar">
        <NavLink to={homePath} className="brand" aria-label="Mầm Non Hoa Nắng">
          <span className="brand-mark"><Icon name="sun" size={22} stroke={2.2} /></span>
          <span><strong>Hoa Nắng</strong><small>Mầm Non Hạnh Phúc</small></span>
        </NavLink>
        <nav ref={navRef} className="sidebar-nav" aria-label="Điều hướng chính">
          {renderNavigation()}
        </nav>
        <div className="sidebar-bottom">
          {user?.role === 'parent' ? (
            <NavLink to="/parent-settings" className="nav-link">
              <Icon name="settings" />Cài đặt
            </NavLink>
          ) : (
            <NavLink to="/staff-settings" className="nav-link">
              <Icon name="settings" />Cài đặt tài khoản
            </NavLink>
          )}
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
            <div className="topbar-title-row">
              <button type="button" className="mobile-menu-toggle" onClick={() => setMobileNavOpen(true)} aria-label="Mở menu điều hướng">
                <Icon name="menu" size={22} />
              </button>
              <div>
                <p className="eyebrow">HỆ THỐNG QUẢN LÝ TRƯỜNG MẦM NON</p>
                <h1>{title}</h1>
              </div>
            </div>
            {subtitle && <p className="page-subtitle">{subtitle}</p>}
          </div>
          <div className="topbar-actions">
            {actions}
            <div className="notification-menu">
              <button className="icon-button" aria-label={`Thông báo${totalUnread ? `, ${totalUnread} chưa đọc` : ''}`} onClick={toggleNotifications}>
                <Icon name="bell" />{totalUnread > 0 && <span className="notification-count">{totalUnread > 99 ? '99+' : totalUnread}</span>}
              </button>
              {showNotifications && (
                <div className="notification-popover">
                  <div><strong>Thông báo</strong>{totalUnread > 0 && <span>{totalUnread} chưa đọc</span>}</div>
                  {chatUnread.data.length > 0 && (
                    <>
                      <div className="notification-group-label">TIN NHẮN</div>
                      {chatUnread.data.map((item) => (
                        <button key={item.conversationId} className="chat-alert unread" onClick={() => openChatAlert(item)}>
                          <strong>Bạn có {item.count} tin nhắn từ {user?.role === 'teacher' ? 'phụ huynh' : 'giáo viên'} {item.senderName}</strong>
                          <small>Về bé {item.studentName} · Nhấn để xem và đánh dấu đã đọc</small>
                          <span className="chat-unread-dot" />
                        </button>
                      ))}
                    </>
                  )}
                  {notifications.length > 0 && chatUnread.data.length > 0 && <div className="notification-group-label">THÔNG BÁO KHÁC</div>}
                  {notifications.length ? (
                    notifications.map((item) => (
                      <button key={item._id} className={`${item.isRead ? '' : 'unread'} ${item.metadata?.priority === 'high' ? 'priority' : ''}`.trim()} onClick={() => openNotification(item)}>
                        <strong>{item.metadata?.priority === 'high' ? '⚠ ' : ''}{item.title}</strong>
                        <small>{item.message}</small>
                      </button>
                    ))
                  ) : chatUnread.data.length === 0 && <p>Chưa có thông báo mới.</p>}
                </div>
              )}
            </div>
            <div className="topbar-profile">
              <span className="avatar">{displayName.charAt(0).toUpperCase()}</span>
              <span><strong>{displayName}</strong><small className={`role-pill role-pill-${user?.role || 'default'}`}>{roleLabel}</small></span>
              <Icon name="chevronRight" size={15} />
            </div>
          </div>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}
