import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import SuperAdminSchoolReportModal from '../components/SuperAdminSchoolReportModal';
import SuperAdminSettingsPanel from '../components/SuperAdminSettingsPanel';
import SuperAdminAuditPanel from '../components/SuperAdminAuditPanel';
import {
  getSuperAdminSchools,
  createSchoolWithAdmin,
  updateSchoolAndAdmin,
  enterSchoolWorkspace
} from '../api/multiSchool';
import { getStoredSuperAdminUser, getStoredUser } from '../utils/storage';
import './MultiSchoolManagement.css';

const DEFAULT_MODULE_CATALOG = [
  { key: 'students', label: 'Hồ sơ & Y tế Học sinh', required: true },
  { key: 'classrooms', label: 'Quản lý Lớp & Phân hiệu', required: true },
  { key: 'attendance', label: 'Điểm danh & Đơn xin nghỉ', required: false },
  { key: 'pickups', label: 'Đón trả trẻ & Mã QR', required: false },
  { key: 'guard', label: 'An ninh Trực cổng & Bưu phẩm', required: false },
  { key: 'nutrition', label: 'Bếp ăn, Thực đơn & Lưu mẫu 24h', required: false },
  { key: 'finance', label: 'Học phí, Kế toán & Sổ quỹ', required: false },
  { key: 'hr', label: 'Nhân sự & Bảng lương', required: false },
  { key: 'timekeeping', label: 'Chấm công & Thiết bị ISAPI', required: false },
  { key: 'procurement', label: 'Mua sắm & Cơ sở vật chất', required: false },
  { key: 'feedback', label: 'Phản hồi Phụ huynh & Duyệt hồ sơ', required: false },
  { key: 'chat', label: 'Tin nhắn Nhà trường – Phụ huynh', required: false },
  { key: 'notifications', label: 'Thông báo Nội bộ & Nhắc việc', required: false },
  { key: 'reports', label: 'Báo cáo & Thống kê Điều hành', required: false }
];

const formatCurrency = (val) => `${new Intl.NumberFormat('vi-VN').format(Number(val) || 0)} đ`;

const formatUptime = (seconds) => {
  const s = Math.max(0, Number(seconds) || 0);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days} ngày ${hours} giờ`;
  if (hours > 0) return `${hours} giờ ${mins} phút`;
  return `${mins} phút`;
};

const formatShortDate = (val) => {
  if (!val) return 'Chưa đăng nhập';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const makeEmptyCreateForm = (standards = {}, allModuleKeys = []) => ({
  code: '',
  name: '',
  organizationCode: 'HOA-NANG-GROUP',
  contactEmail: '',
  campusesInput: 'Cơ sở chính',
  adminUsername: 'admin',
  adminPassword: '',
  adminFullName: '',
  adminPhone: '',
  maxCampuses: standards.defaultMaxCampusesPerSchool || 10,
  maxStudents: standards.defaultMaxStudentsPerSchool || 800,
  maxStaff: 200,
  enabledModules: allModuleKeys.length ? [...allModuleKeys] : DEFAULT_MODULE_CATALOG.map((m) => m.key)
});

export default function MultiSchoolManagement() {
  const navigate = useNavigate();
  const [superUser, setSuperUser] = useState(() => getStoredSuperAdminUser() || getStoredUser());
  const [activeSection, setActiveSection] = useState('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [summary, setSummary] = useState({
    totalSchools: 0,
    activeSchools: 0,
    suspendedSchools: 0,
    totalCampuses: 0,
    totalClassrooms: 0,
    totalCapacity: 0,
    totalStudents: 0,
    totalStaff: 0,
    totalStaffPresentToday: 0,
    totalActiveAccounts: 0,
    overallOccupancyPercent: 0,
    overallAttendanceTodayPercent: 0,
    overallCollectionRatePercent: 0,
    totalBilled: 0,
    totalCollected: 0,
    totalOutstandingDebt: 0,
    alertCount: 0
  });
  const [systemHealth, setSystemHealth] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [moduleCatalog, setModuleCatalog] = useState(DEFAULT_MODULE_CATALOG);
  const [systemSettings, setSystemSettings] = useState(null);
  const [schools, setSchools] = useState([]);

  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [enteringId, setEnteringId] = useState('');
  const [reportSchoolId, setReportSchoolId] = useState(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState(() => makeEmptyCreateForm());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [editingSchool, setEditingSchool] = useState(null);
  const [editForm, setEditForm] = useState({
    name: '',
    organizationCode: '',
    contactEmail: '',
    status: 'active',
    adminUsername: 'admin',
    newAdminPassword: '',
    maxCampuses: 10,
    maxStudents: 800,
    maxStaff: 200,
    enabledModules: DEFAULT_MODULE_CATALOG.map((m) => m.key)
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSuperAdminSchools();
      const payload = res.data?.data || {};
      setSummary((prev) => ({ ...prev, ...(payload.summary || {}) }));
      setSystemHealth(payload.systemHealth || null);
      setAlerts(payload.alerts || []);
      if (Array.isArray(payload.moduleCatalog) && payload.moduleCatalog.length > 0) {
        setModuleCatalog(payload.moduleCatalog);
      }
      if (payload.settings) {
        setSystemSettings(payload.settings);
      }
      setSchools(payload.schools || []);
    } catch (err) {
      if (err.response?.status === 401) {
        localStorage.removeItem('superadmin_token');
        localStorage.removeItem('superadmin_user');
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('last_school_code');
        navigate('/login', { replace: true });
        return;
      }
      setNotice({ type: 'error', text: err.response?.data?.message || 'Không thể tải dữ liệu điều hành hệ thống.' });
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const handleLogout = () => {
    localStorage.removeItem('superadmin_token');
    localStorage.removeItem('superadmin_user');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('tenant');
    localStorage.removeItem('last_school_code');
    navigate('/login');
  };

  useEffect(() => {
    if (!showCreateModal && !editingSchool) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (showCreateModal && !creating) setShowCreateModal(false);
        if (editingSchool && !savingEdit) setEditingSchool(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showCreateModal, editingSchool, creating, savingEdit]);

  const openCreateModal = () => {
    setCreateError('');
    setCreateForm(
      makeEmptyCreateForm(
        systemSettings?.preschoolStandards || {},
        moduleCatalog.map((m) => m.key)
      )
    );
    setShowCreateModal(true);
  };

  const toggleCreateModule = (modKey, required) => {
    if (required) return;
    setCreateForm((prev) => {
      const exists = prev.enabledModules.includes(modKey);
      return {
        ...prev,
        enabledModules: exists
          ? prev.enabledModules.filter((k) => k !== modKey)
          : [...prev.enabledModules, modKey]
      };
    });
  };

  const handleCreateSchool = async (e) => {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreateError('');
    try {
      const initialCampuses = createForm.campusesInput
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((cName, idx) => ({
          ...(cName.toLowerCase() === 'cơ sở chính' ? { code: 'CS-CHINH' } : { code: `PH-${idx + 1}` }),
          name: cName
        }));

      const res = await createSchoolWithAdmin({
        code: createForm.code.trim().toUpperCase(),
        name: createForm.name.trim(),
        organizationCode: createForm.organizationCode.trim().toUpperCase(),
        contactEmail: createForm.contactEmail.trim(),
        adminUsername: createForm.adminUsername.trim(),
        adminPassword: createForm.adminPassword,
        adminFullName: createForm.adminFullName.trim(),
        adminPhone: createForm.adminPhone.trim(),
        initialCampuses,
        enabledModules: createForm.enabledModules,
        quotas: {
          maxCampuses: Number(createForm.maxCampuses),
          maxStudents: Number(createForm.maxStudents),
          maxStaff: Number(createForm.maxStaff)
        }
      });
      setShowCreateModal(false);
      await load();
      setNotice({ type: 'success', text: res.data?.message || 'Đã khởi tạo trường học mới kèm tài khoản Admin riêng.' });
    } catch (err) {
      setCreateError(err.response?.data?.message || 'Không thể khởi tạo trường học mới.');
    } finally {
      setCreating(false);
    }
  };

  const openEditModal = (school) => {
    const fullSchool = schools.find((s) => String(s._id) === String(school._id)) || school;
    setEditingSchool(fullSchool);
    setEditForm({
      name: fullSchool.name || '',
      organizationCode: fullSchool.organizationCode || '',
      contactEmail: fullSchool.contactEmail || '',
      status: fullSchool.status || 'active',
      adminUsername: fullSchool.primaryAdmin?.username || 'admin',
      newAdminPassword: '',
      maxCampuses: fullSchool.quotas?.maxCampuses || 10,
      maxStudents: fullSchool.quotas?.maxStudents || 800,
      maxStaff: fullSchool.quotas?.maxStaff || 200,
      enabledModules: Array.isArray(fullSchool.enabledModules)
        ? [...fullSchool.enabledModules]
        : moduleCatalog.map((m) => m.key)
    });
    setEditError('');
  };

  const toggleEditModule = (modKey, required) => {
    if (required) return;
    setEditForm((prev) => {
      const exists = prev.enabledModules.includes(modKey);
      return {
        ...prev,
        enabledModules: exists
          ? prev.enabledModules.filter((k) => k !== modKey)
          : [...prev.enabledModules, modKey]
      };
    });
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingSchool || savingEdit) return;
    setSavingEdit(true);
    setEditError('');
    try {
      await updateSchoolAndAdmin(editingSchool._id, {
        name: editForm.name,
        organizationCode: editForm.organizationCode,
        contactEmail: editForm.contactEmail,
        status: editForm.status,
        adminUsername: editForm.adminUsername,
        newAdminPassword: editForm.newAdminPassword,
        enabledModules: editForm.enabledModules,
        quotas: {
          maxCampuses: Number(editForm.maxCampuses),
          maxStudents: Number(editForm.maxStudents),
          maxStaff: Number(editForm.maxStaff)
        }
      });
      setEditingSchool(null);
      await load();
      setNotice({ type: 'success', text: 'Đã lưu cấu hình trường học, hạn mức và gói phân hệ chức năng.' });
    } catch (err) {
      setEditError(err.response?.data?.message || 'Không thể lưu cập nhật.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleEnterSchool = async (school) => {
    if (enteringId) return;
    setEnteringId(school._id);
    try {
      const res = await enterSchoolWorkspace(school._id);
      const { token, tenant, user } = res.data || {};
      if (token && user) {
        const currentSuperToken = localStorage.getItem('superadmin_token') || localStorage.getItem('token');
        if (currentSuperToken) {
          localStorage.setItem('superadmin_token', currentSuperToken);
          localStorage.setItem('superadmin_user', JSON.stringify(superUser));
        }
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        if (tenant) {
          localStorage.setItem('tenant', JSON.stringify(tenant));
        } else {
          localStorage.removeItem('tenant');
        }
        navigate('/dashboard');
      }
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.message || 'Không thể chuyển vào không gian trường này.' });
    } finally {
      setEnteringId('');
    }
  };

  const filteredSchools = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return schools.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (!q) return true;
      return (
        String(s.code || '').toLowerCase().includes(q) ||
        String(s.name || '').toLowerCase().includes(q) ||
        String(s.organizationCode || '').toLowerCase().includes(q) ||
        String(s.primaryAdmin?.username || '').toLowerCase().includes(q)
      );
    });
  }, [schools, searchQuery, statusFilter]);

  const navItems = [
    {
      id: 'overview',
      label: 'Tổng quan & Hiệu năng',
      icon: 'chart',
      theme: 'system',
      badge: alerts.length > 0 ? alerts.length : null,
      alertBadge: alerts.length > 0
    },
    {
      id: 'schools',
      label: 'Quản lý Trường & Báo cáo',
      icon: 'classes',
      theme: 'student',
      badge: summary.totalSchools || 0,
      alertBadge: false
    },
    {
      id: 'settings',
      label: 'Cấu hình chung Hệ thống',
      icon: 'settings',
      theme: 'ops',
      badge: null,
      alertBadge: false
    },
    {
      id: 'audit',
      label: 'Nhật ký & Bảo mật',
      icon: 'shield',
      theme: 'personal',
      badge: null,
      alertBadge: false
    }
  ];

  const sectionTitleMap = {
    overview: {
      title: 'Dashboard Tổng quan & Hiệu năng Toàn chuỗi',
      subtitle: 'Giám sát sức khỏe máy chủ, điểm danh, lấp đầy lớp, thu học phí và cảnh báo an toàn của toàn bộ các trường.'
    },
    schools: {
      title: 'Quản lý Các Trường & Báo cáo Chi tiết 360°',
      subtitle: 'Cấp phát trường mới, phân quyền gói Module, đặt hạn mức và xem báo cáo độc lập từng trường cho SuperAdmin.'
    },
    settings: {
      title: 'Cấu hình Chung Toàn Hệ thống (Global Settings)',
      subtitle: 'Thiết lập thương hiệu chuỗi, System Banner toàn trường, chuẩn nghiệp vụ Mầm non và chính sách bảo mật.'
    },
    audit: {
      title: 'Nhật ký Kiểm toán & Bảo mật SuperAdmin',
      subtitle: 'Theo dõi mọi thao tác quản trị cấp hệ thống và cập nhật thông tin bảo mật tài khoản Admin Tổng.'
    }
  };

  const renderSidebarContent = (isMobile = false) => (
    <>
      {isMobile ? (
        <div className="mobile-sidebar-header">
          <div className="brand">
            <span className="brand-mark"><Icon name="sun" size={22} stroke={2.2} /></span>
            <span><strong>Hoa Nắng</strong><small>SuperAdmin Center</small></span>
          </div>
          <button type="button" className="mobile-nav-close" onClick={() => setMobileNavOpen(false)} aria-label="Đóng menu">
            <Icon name="close" size={20} />
          </button>
        </div>
      ) : (
        <div className="brand">
          <span className="brand-mark"><Icon name="sun" size={22} stroke={2.2} /></span>
          <span>
            <strong>{systemSettings?.branding?.systemName ? 'Hoa Nắng SaaS' : 'Hoa Nắng'}</strong>
            <small>Trung tâm Đa Trường</small>
          </span>
        </div>
      )}

      <div className="school-tenant-badge" title="Quyền Quản trị Tổng toàn hệ thống">
        <span className="tenant-status-dot" />
        <div className="tenant-info-text">
          <span className="tenant-school-name">Quản trị Tổng Hệ thống</span>
          <span className="tenant-school-code">SUPERADMIN · {summary.activeSchools}/{summary.totalSchools} TRƯỜNG</span>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="Điều hướng trung tâm SuperAdmin">
        <p className="nav-label">ĐIỀU HÀNH TOÀN HỆ THỐNG</p>
        {navItems.map((item) => {
          const active = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveSection(item.id);
                if (isMobile) setMobileNavOpen(false);
              }}
              className={`nav-link nav-link-theme-${item.theme} ${active ? 'active' : ''}`}
              style={{ width: '100%', textAlign: 'left', border: 'none', background: active ? undefined : 'transparent', cursor: 'pointer' }}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.badge != null && (
                <span className={`superadmin-nav-pill-count ${item.alertBadge ? 'alert' : ''}`}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-bottom">
        <div className="account-card">
          <span className="avatar">{(superUser?.username || 'A').charAt(0).toUpperCase()}</span>
          <span>
            <strong>@{superUser?.username || 'admin'}</strong>
            <small>SuperAdmin Toàn chuỗi</small>
          </span>
        </div>
        <button type="button" className="sidebar-logout" onClick={handleLogout}>
          <Icon name="logout" size={17} /> Đăng xuất
        </button>
      </div>
    </>
  );

  const activeMeta = sectionTitleMap[activeSection] || sectionTitleMap.overview;

  return (
    <div className="app-shell">
      {mobileNavOpen && (
        <div className="mobile-nav-backdrop" onClick={() => setMobileNavOpen(false)} role="presentation">
          <aside className="sidebar mobile-sidebar" onClick={(e) => e.stopPropagation()}>
            {renderSidebarContent(true)}
          </aside>
        </div>
      )}

      <aside className="sidebar desktop-sidebar">
        {renderSidebarContent(false)}
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-copy">
            <div className="topbar-title-row">
              <button
                type="button"
                className="mobile-menu-toggle"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Mở menu điều hướng"
              >
                <Icon name="menu" size={22} />
              </button>
              <div>
                <div className="topbar-eyebrow-row">
                  <p className="eyebrow">
                    {systemSettings?.branding?.systemName || 'TRUNG TÂM ĐIỀU HÀNH HỆ THỐNG ĐA TRƯỜNG'}
                  </p>
                  <span className="topbar-tenant-tag">
                    <Icon name="shield" size={13} /> SUPERADMIN
                  </span>
                </div>
                <h1>{activeMeta.title}</h1>
                <p style={{ margin: '4px 0 0', fontSize: '13.5px', color: '#64748b' }}>{activeMeta.subtitle}</p>
              </div>
            </div>
          </div>

          <div className="toolbar-buttons" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="button button-secondary" onClick={load} disabled={loading}>
              <Icon name="refresh" size={15} /> Làm mới số liệu
            </button>
            <button type="button" className="button button-primary" onClick={openCreateModal}>
              <Icon name="plus" size={16} /> Tạo trường mới & Cấp Account
            </button>
          </div>
        </header>

        {systemSettings?.systemBanner?.enabled && systemSettings.systemBanner.message && (
          <div className={`system-global-banner ${systemSettings.systemBanner.level || 'info'}`}>
            <Icon name="alertCircle" size={17} />
            <span>
              <strong>System Banner đang phát toàn chuỗi:</strong> {systemSettings.systemBanner.message}
            </span>
          </div>
        )}

        {systemSettings?.maintenanceMode?.enabled && (
          <div className="system-global-banner critical">
            <Icon name="shield" size={17} />
            <span>
              <strong>CHẾ ĐỘ BẢO TRÌ ĐANG BẬT:</strong> Người dùng tại các trường đang tạm ngưng đăng nhập ({systemSettings.maintenanceMode.message})
            </span>
          </div>
        )}

        <div className="page-content">
          {notice && (
            <div className={notice.type === 'error' ? 'form-error' : 'timekeeping-notice success'} style={{ marginBottom: '18px' }}>
              <Icon name={notice.type === 'error' ? 'alertCircle' : 'check'} size={17} />
              <span>{notice.text}</span>
            </div>
          )}

          {/* ================================================================
              MỤC 1: DASHBOARD TỔNG QUAN & HIỆU NĂNG TOÀN CHUỖI
             ================================================================ */}
          {activeSection === 'overview' && (
            <div>
              <div className="superadmin-kpi-grid">
                <article className="superadmin-kpi-card">
                  <span className="superadmin-kpi-icon blue"><Icon name="shield" size={21} /></span>
                  <div className="superadmin-kpi-body">
                    <small>SỐ TRƯỜNG ĐANG HOẠT ĐỘNG</small>
                    <strong>{summary.activeSchools} / {summary.totalSchools} trường</strong>
                    <span className="superadmin-kpi-sub">
                      {summary.totalCampuses} phân hiệu · {summary.suspendedSchools || 0} tạm ngưng
                    </span>
                  </div>
                </article>

                <article className="superadmin-kpi-card">
                  <span className="superadmin-kpi-icon purple"><Icon name="students" size={21} /></span>
                  <div className="superadmin-kpi-body">
                    <small>QUY MÔ HỌC SINH & LẤP ĐẦY LỚP</small>
                    <strong>{summary.totalStudents} học sinh</strong>
                    <span className="superadmin-kpi-sub">
                      {summary.totalClassrooms} lớp · Lấp đầy {summary.overallOccupancyPercent}% sức chứa
                    </span>
                  </div>
                </article>

                <article className="superadmin-kpi-card">
                  <span className="superadmin-kpi-icon green"><Icon name="attendance" size={21} /></span>
                  <div className="superadmin-kpi-body">
                    <small>CHUYÊN CẦN TOÀN CHUỖI HÔM NAY</small>
                    <strong>
                      {summary.todayStudentRecorded > 0 ? `${summary.overallAttendanceTodayPercent}%` : 'Chưa điểm danh'}
                    </strong>
                    <span className="superadmin-kpi-sub">
                      HS có mặt: {summary.todayStudentPresent}/{summary.todayStudentRecorded} · NS: {summary.totalStaffPresentToday}/{summary.totalStaff}
                    </span>
                  </div>
                </article>

                <article className="superadmin-kpi-card">
                  <span className="superadmin-kpi-icon amber"><Icon name="money" size={21} /></span>
                  <div className="superadmin-kpi-body">
                    <small>THỰC THU HỌC PHÍ TOÀN HỆ THỐNG</small>
                    <strong>{formatCurrency(summary.totalCollected)}</strong>
                    <span className="superadmin-kpi-sub">
                      Đạt {summary.overallCollectionRatePercent}% · Nợ đọng: {formatCurrency(summary.totalOutstandingDebt)}
                    </span>
                  </div>
                </article>

                <article className="superadmin-kpi-card">
                  <span className="superadmin-kpi-icon teal"><Icon name="users" size={21} /></span>
                  <div className="superadmin-kpi-body">
                    <small>TÀI KHOẢN & NHÂN SỰ ACTIVE</small>
                    <strong>{summary.totalActiveAccounts} tài khoản</strong>
                    <span className="superadmin-kpi-sub">
                      {summary.totalStaff} hồ sơ nhân sự các trường
                    </span>
                  </div>
                </article>

                <article className="superadmin-kpi-card">
                  <span className={`superadmin-kpi-icon ${alerts.length > 0 ? 'rose' : 'green'}`}>
                    <Icon name={alerts.length > 0 ? 'alertCircle' : 'check'} size={21} />
                  </span>
                  <div className="superadmin-kpi-body">
                    <small>CẢNH BÁO AN TOÀN & VẬN HÀNH</small>
                    <strong>{alerts.length} cảnh báo</strong>
                    <span className="superadmin-kpi-sub">
                      Mẫu lưu bếp cảnh báo: {summary.totalFoodSampleAlerts || 0} · Phản hồi PH: {summary.totalOpenFeedback || 0}
                    </span>
                  </div>
                </article>
              </div>

              <div className="superadmin-two-col">
                {/* KHỐI HIỆU NĂNG & SỨC KHỎE HỆ THỐNG */}
                <section className="content-card" style={{ padding: '20px 22px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <div>
                      <p className="card-kicker">HIỆU NĂNG HẠ TẦNG & BẢO MẬT</p>
                      <h2 style={{ margin: '2px 0 0' }}>Sức khỏe Máy chủ & Cơ sở dữ liệu</h2>
                    </div>
                    <span className={`student-status ${systemHealth?.status === 'healthy' ? 'enrolled' : 'withdrawn'}`}>
                      {systemHealth?.status === 'healthy' ? 'Hệ thống Ổn định' : 'Cần kiểm tra DB'}
                    </span>
                  </div>

                  {systemHealth ? (
                    <div className="superadmin-health-grid">
                      <div className="superadmin-health-box">
                        <small>ĐỘ TRỄ KẾT NỐI MONGODB</small>
                        <strong style={{ color: '#15803d' }}>
                          {systemHealth.database?.pingMs != null ? `${systemHealth.database.pingMs} ms` : '—'}
                        </strong>
                        <small style={{ marginTop: '4px' }}>DB: {systemHealth.database?.name}</small>
                      </div>

                      <div className="superadmin-health-box">
                        <small>THỜI GIAN HOẠT ĐỘNG (UPTIME)</small>
                        <strong>{formatUptime(systemHealth.uptimeSeconds)}</strong>
                        <small style={{ marginTop: '4px' }}>
                          Node {systemHealth.nodeVersion} · {systemHealth.cpuCores} nhân CPU
                        </small>
                      </div>

                      <div className="superadmin-health-box">
                        <small>BỘ NHỚ RAM MÁY CHỦ ({systemHealth.memory?.systemUsedPercent || 0}%)</small>
                        <strong>
                          {systemHealth.memory?.systemUsedMb} / {systemHealth.memory?.systemTotalMb} MB
                        </strong>
                        <div className="superadmin-progress-track">
                          <div
                            className={`superadmin-progress-fill ${
                              (systemHealth.memory?.systemUsedPercent || 0) > 85 ? 'rose' : 'blue'
                            }`}
                            style={{ width: `${Math.min(100, systemHealth.memory?.systemUsedPercent || 0)}%` }}
                          />
                        </div>
                      </div>

                      <div className="superadmin-health-box">
                        <small>TIẾN TRÌNH BACKEND & LÁ CHẮN BOT</small>
                        <strong>RSS {systemHealth.memory?.processRssMb} MB · Heap {systemHealth.memory?.heapUsedMb} MB</strong>
                        <small style={{ marginTop: '4px', color: systemHealth.antiBotShieldEnabled ? '#15803d' : '#b45309' }}>
                          {systemHealth.antiBotShieldEnabled
                            ? '✓ Lá chắn Anti-Bot & Chống Scanner đang bật'
                            : '⚠ Lá chắn Anti-Bot đang tắt'}
                        </small>
                      </div>
                    </div>
                  ) : (
                    <div className="inline-loader">Đang đo thông số máy chủ...</div>
                  )}
                </section>

                {/* KHỐI CẢNH BÁO AN TOÀN MẦM NON */}
                <section className="content-card" style={{ padding: '20px 22px' }}>
                  <p className="card-kicker">GIÁM SÁT AN TOÀN & CHẤT LƯỢNG DỊCH VỤ</p>
                  <h2 style={{ margin: '2px 0 0' }}>Cảnh báo các trường cần SuperAdmin lưu ý ({alerts.length})</h2>

                  {alerts.length === 0 ? (
                    <div style={{ padding: '32px 12px', textAlign: 'center', color: '#15803d', fontWeight: 600 }}>
                      ✓ Toàn bộ các trường đang vận hành bình thường, không có cảnh báo tồn đọng.
                    </div>
                  ) : (
                    <div className="superadmin-alert-list">
                      {alerts.map((al, idx) => (
                        <div key={`${al.schoolId}-${al.category}-${idx}`} className={`superadmin-alert-item ${al.severity}`}>
                          <div>
                            <strong style={{ display: 'block', fontSize: '13.5px', color: '#0f172a' }}>
                              [{al.schoolCode}] {al.title}
                            </strong>
                            <small style={{ color: '#475569' }}>{al.detail}</small>
                          </div>
                          <button
                            type="button"
                            className="button button-secondary"
                            style={{ whiteSpace: 'nowrap', padding: '6px 11px', fontSize: '12px' }}
                            onClick={() => setReportSchoolId(al.schoolId)}
                          >
                            Xem báo cáo
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              {/* BẢNG XẾP HẠNG & SO SÁNH HIỆU SUẤT CÁC TRƯỜNG */}
              <section className="content-card student-list-card">
                <div className="list-toolbar">
                  <div>
                    <p className="card-kicker">BÁO CÁO HIỆU SUẤT HOẠT ĐỘNG TỪNG TRƯỜNG</p>
                    <h2>Bảng đối chiếu Vận hành – Chuyên cần – Tài chính ({schools.length} trường)</h2>
                    <p>Bấm <strong>&quot;Báo cáo 360°&quot;</strong> để xem chi tiết từng phân hiệu, lớp học, công nợ học phí và lưu mẫu bếp ăn của trường đó.</p>
                  </div>
                  <button type="button" className="button button-secondary" onClick={() => setActiveSection('schools')}>
                    Mở quản lý & cấu hình trường →
                  </button>
                </div>

                {loading ? (
                  <div className="inline-loader">Đang tổng hợp báo cáo các trường...</div>
                ) : schools.length === 0 ? (
                  <div className="multi-school-empty-state">
                    <span className="multi-school-empty-icon"><Icon name="classes" size={28} /></span>
                    <h3>Chưa có trường học nào trong hệ thống</h3>
                    <p>Hãy tạo trường đầu tiên và cấp tài khoản Admin riêng cho trường để bắt đầu thu thập chỉ số vận hành.</p>
                    <button type="button" className="button button-primary" onClick={openCreateModal}>
                      <Icon name="plus" size={16} /> Tạo trường học đầu tiên
                    </button>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Trường học</th>
                          <th>Quy mô & Lấp đầy</th>
                          <th>Điểm danh hôm nay / 30 ngày</th>
                          <th>Tiến độ thu học phí</th>
                          <th>Hoạt động gần nhất</th>
                          <th>Trạng thái</th>
                          <th>Báo cáo & Điều hành</th>
                        </tr>
                      </thead>
                      <tbody>
                        {schools.map((s) => (
                          <tr key={s._id}>
                            <td>
                              <strong style={{ color: '#1d4ed8' }}>{s.code}</strong> · <strong>{s.name}</strong>
                              <small style={{ display: 'block', color: '#64748b' }}>
                                {s.campusCount} phân hiệu · {s.classCount} lớp · {s.staffCount} nhân sự
                              </small>
                            </td>
                            <td style={{ minWidth: '150px' }}>
                              <div>
                                <strong>{s.studentCount}</strong> / {s.quotas?.maxStudents || 800} HS ({s.occupancyPercent}% lớp)
                              </div>
                              <div className="superadmin-progress-track">
                                <div className="superadmin-progress-fill blue" style={{ width: `${s.occupancyPercent}%` }} />
                              </div>
                            </td>
                            <td style={{ minWidth: '155px' }}>
                              <div>
                                Hôm nay: <strong>{s.attendance?.todayRecorded > 0 ? `${s.attendance.todayPercent}%` : 'Chưa ĐD'}</strong>
                                {' · '}30N: <strong>{s.attendance?.rolling30dPercent || 0}%</strong>
                              </div>
                              <div className="superadmin-progress-track">
                                <div
                                  className="superadmin-progress-fill green"
                                  style={{ width: `${s.attendance?.rolling30dPercent || 0}%` }}
                                />
                              </div>
                            </td>
                            <td style={{ minWidth: '165px' }}>
                              <div>
                                <strong>{s.finance?.collectionRatePercent || 0}%</strong> ({formatCurrency(s.finance?.totalCollected)})
                              </div>
                              <div className="superadmin-progress-track">
                                <div
                                  className="superadmin-progress-fill amber"
                                  style={{ width: `${s.finance?.collectionRatePercent || 0}%` }}
                                />
                              </div>
                            </td>
                            <td style={{ whiteSpace: 'nowrap', fontSize: '12.5px' }}>
                              {formatShortDate(s.accountStats?.lastActivityAt)}
                              <small style={{ display: 'block', color: '#64748b' }}>
                                {s.accountStats?.activeAccounts || 0} TK active
                              </small>
                            </td>
                            <td>
                              <span className={`student-status ${s.status === 'active' ? 'enrolled' : 'withdrawn'}`}>
                                {s.status === 'active' ? 'Hoạt động' : 'Tạm ngưng'}
                              </span>
                            </td>
                            <td>
                              <div className="classroom-actions" style={{ flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  className="button button-secondary"
                                  onClick={() => setReportSchoolId(s._id)}
                                >
                                  Báo cáo 360°
                                </button>
                                {s.status === 'active' && (
                                  <button
                                    type="button"
                                    className="button button-primary"
                                    disabled={Boolean(enteringId)}
                                    onClick={() => handleEnterSchool(s)}
                                  >
                                    {enteringId === s._id ? 'Đang mở...' : 'Vào điều hành'}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* ================================================================
              MỤC 2: QUẢN LÝ DANH SÁCH TRƯỜNG, GÓI MODULE & BÁO CÁO CHI TIẾT
             ================================================================ */}
          {activeSection === 'schools' && (
            <section className="content-card student-list-card">
              <div className="list-toolbar">
                <div>
                  <p className="card-kicker">QUẢN TRỊ ĐƠN VỊ TRƯỜNG & PHÂN QUYỀN GÓI TÍNH NĂNG</p>
                  <h2>Danh sách Trường học độc lập ({filteredSchools.length})</h2>
                  <p>
                    SuperAdmin quản lý định danh cấp Trường, gói Phân hệ chức năng và Hạn mức; còn Admin từng trường chỉ quản lý cấu hình các Phân hiệu trực thuộc trường đó.
                  </p>
                </div>
              </div>

              <div className="student-filters" style={{ padding: '0 22px 16px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <label className="search-box" style={{ flex: '1 1 300px' }}>
                  <Icon name="search" size={16} />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Tìm theo mã trường, tên trường, cụm trường hoặc tài khoản Admin..."
                  />
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={{ padding: '10px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', background: '#fff' }}
                >
                  <option value="all">Tất cả trạng thái ({schools.length})</option>
                  <option value="active">Đang hoạt động ({summary.activeSchools})</option>
                  <option value="suspended">Tạm ngưng ({summary.suspendedSchools || 0})</option>
                </select>
              </div>

              {loading ? (
                <div className="inline-loader">Đang tải danh sách trường học...</div>
              ) : filteredSchools.length === 0 ? (
                <div style={{ padding: '36px 20px', textAlign: 'center', color: '#64748b' }}>
                  Không có trường học nào khớp điều kiện tìm kiếm.
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Mã & Tên trường</th>
                        <th>Phân hiệu / Hạn mức</th>
                        <th>Admin riêng của trường</th>
                        <th>Học sinh / Hạn mức</th>
                        <th>Gói Phân hệ</th>
                        <th>Trạng thái</th>
                        <th>Thao tác SuperAdmin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSchools.map((s) => (
                        <tr key={s._id}>
                          <td>
                            <strong style={{ color: '#1d4ed8' }}>{s.code}</strong> · <strong>{s.name}</strong>
                            <small style={{ display: 'block', color: '#64748b' }}>
                              {s.organizationCode ? `Cụm: ${s.organizationCode}` : 'Đơn vị độc lập'}
                              {s.contactEmail ? ` · ${s.contactEmail}` : ''}
                            </small>
                          </td>
                          <td>
                            <strong>{s.campusCount} / {s.quotas?.maxCampuses || 10} phân hiệu</strong>
                            <small style={{ display: 'block', color: '#475569' }}>
                              {(s.campusNames || []).join(', ')}
                            </small>
                          </td>
                          <td>
                            {s.primaryAdmin ? (
                              <>
                                <strong>@{s.primaryAdmin.username}</strong>
                                <small style={{ display: 'block', color: '#64748b' }}>
                                  {s.primaryAdmin.fullName} · {formatShortDate(s.primaryAdmin.lastLogin)}
                                </small>
                              </>
                            ) : (
                              <span className="account-unlinked">Chưa cấp TK</span>
                            )}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <div><strong>{s.studentCount}</strong> / {s.quotas?.maxStudents || 800} HS</div>
                            <small style={{ color: '#64748b' }}>{s.classCount} lớp · {s.staffCount} nhân sự</small>
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <strong>{s.enabledModules?.length || moduleCatalog.length}/{moduleCatalog.length}</strong> phân hệ
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <span className={`student-status ${s.status === 'active' ? 'enrolled' : 'withdrawn'}`}>
                              {s.status === 'active' ? 'Hoạt động' : s.status === 'suspended' ? 'Tạm ngưng' : 'Đã đóng'}
                            </span>
                          </td>
                          <td>
                            <div className="classroom-actions" style={{ flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="button button-secondary"
                                onClick={() => setReportSchoolId(s._id)}
                              >
                                Báo cáo chi tiết
                              </button>
                              <button
                                type="button"
                                className="button button-secondary"
                                onClick={() => openEditModal(s)}
                              >
                                Cấu hình & Phân hệ
                              </button>
                              {s.status === 'active' && (
                                <button
                                  type="button"
                                  className="button button-primary"
                                  disabled={Boolean(enteringId)}
                                  onClick={() => handleEnterSchool(s)}
                                >
                                  {enteringId === s._id ? 'Đang mở...' : 'Vào điều hành'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* ================================================================
              MỤC 3: CẤU HÌNH CHUNG HỆ THỐNG (GLOBAL SETTINGS)
             ================================================================ */}
          {activeSection === 'settings' && (
            <SuperAdminSettingsPanel
              key={systemSettings?.updatedAt || 'global-settings'}
              initialSettings={systemSettings}
              onSaved={(nextSettings) => {
                if (nextSettings) setSystemSettings(nextSettings);
                void load();
              }}
            />
          )}

          {/* ================================================================
              MỤC 4: NHẬT KÝ HOẠT ĐỘNG & BẢO MẬT SUPERADMIN
             ================================================================ */}
          {activeSection === 'audit' && (
            <SuperAdminAuditPanel
              superUser={superUser}
              onSuperUserUpdated={(nextUser) => setSuperUser(nextUser)}
            />
          )}
        </div>
      </main>

      {/* MODAL XEM BÁO CÁO CHI TIẾT 360° TỪNG TRƯỜNG */}
      {reportSchoolId && (
        <SuperAdminSchoolReportModal
          schoolId={reportSchoolId}
          moduleCatalog={moduleCatalog}
          onClose={() => setReportSchoolId(null)}
          onEnterWorkspace={handleEnterSchool}
          onOpenConfig={openEditModal}
        />
      )}

      {/* MODAL KHỞI TẠO TRƯỜNG MỚI KÈM HẠN MỨC & GÓI MODULE */}
      {showCreateModal && createPortal(
        <div
          className="account-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !creating) setShowCreateModal(false);
          }}
        >
          <form
            className="account-modal-card student-form"
            style={{ width: 'min(820px, 96vw)', maxHeight: '90dvh', overflowY: 'auto' }}
            onSubmit={handleCreateSchool}
          >
            <div className="account-modal-header">
              <div>
                <p className="card-kicker">KHỞI TẠO TRƯỜNG MỚI, HẠN MỨC & GÓI TÍNH NĂNG</p>
                <h2>Thêm trường học mới vào hệ thống</h2>
              </div>
              <button type="button" className="button button-secondary" disabled={creating} onClick={() => setShowCreateModal(false)}>
                Đóng
              </button>
            </div>

            {createError && <div className="form-error" role="alert">{createError}</div>}

            <div className="student-form-grid">
              <label>
                Mã trường (School Code) *
                <input
                  required
                  maxLength={20}
                  placeholder="VD: HOANANG-B"
                  value={createForm.code}
                  onChange={(e) => setCreateForm({ ...createForm, code: e.target.value.toUpperCase() })}
                />
              </label>
              <label>
                Tên trường học *
                <input
                  required
                  maxLength={160}
                  placeholder="VD: Trường Mầm non Hoa Nắng - Cơ sở Cầu Giấy"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                />
              </label>
              <label>
                Mã hệ thống / Cụm trường
                <input
                  maxLength={40}
                  placeholder="VD: HOA-NANG-GROUP"
                  value={createForm.organizationCode}
                  onChange={(e) => setCreateForm({ ...createForm, organizationCode: e.target.value.toUpperCase() })}
                />
              </label>
              <label>
                Email liên hệ chính thức
                <input
                  type="email"
                  placeholder="vanphong@hoanang.edu.vn"
                  value={createForm.contactEmail}
                  onChange={(e) => setCreateForm({ ...createForm, contactEmail: e.target.value })}
                />
              </label>
              <label className="form-wide">
                Các Phân hiệu / Cơ sở ban đầu của trường (ngăn cách bằng dấu phẩy)
                <input
                  placeholder="VD: Cơ sở chính, Phân hiệu 1, Phân hiệu 2"
                  value={createForm.campusesInput}
                  onChange={(e) => setCreateForm({ ...createForm, campusesInput: e.target.value })}
                />
              </label>

              <label>
                Hạn mức tối đa Phân hiệu
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={createForm.maxCampuses}
                  onChange={(e) => setCreateForm({ ...createForm, maxCampuses: e.target.value })}
                />
              </label>
              <label>
                Hạn mức tối đa Học sinh
                <input
                  type="number"
                  min={10}
                  max={20000}
                  value={createForm.maxStudents}
                  onChange={(e) => setCreateForm({ ...createForm, maxStudents: e.target.value })}
                />
              </label>

              <fieldset className="student-allergy-fieldset form-wide">
                <legend>Tài khoản Quản trị riêng của trường này (Chỉ quản lý nội bộ & phân hiệu của trường)</legend>
                <div className="student-form-grid" style={{ padding: 0 }}>
                  <label>
                    Tên đăng nhập Admin trường *
                    <input
                      required
                      placeholder="VD: admin_csb"
                      value={createForm.adminUsername}
                      onChange={(e) => setCreateForm({ ...createForm, adminUsername: e.target.value })}
                    />
                  </label>
                  <label>
                    Mật khẩu khởi tạo *
                    <input
                      type="password"
                      required
                      minLength={6}
                      placeholder="Tối thiểu 6 ký tự"
                      value={createForm.adminPassword}
                      onChange={(e) => setCreateForm({ ...createForm, adminPassword: e.target.value })}
                    />
                  </label>
                  <label>
                    Họ tên người quản trị trường
                    <input
                      placeholder="VD: Nguyễn Thị Minh"
                      value={createForm.adminFullName}
                      onChange={(e) => setCreateForm({ ...createForm, adminFullName: e.target.value })}
                    />
                  </label>
                  <label>
                    Số điện thoại liên hệ
                    <input
                      placeholder="09xxxxxxxx"
                      value={createForm.adminPhone}
                      onChange={(e) => setCreateForm({ ...createForm, adminPhone: e.target.value })}
                    />
                  </label>
                </div>
              </fieldset>

              <fieldset className="student-allergy-fieldset form-wide">
                <legend>Phân hệ chức năng cấp phép cho trường ({createForm.enabledModules.length}/{moduleCatalog.length})</legend>
                <div className="superadmin-module-grid">
                  {moduleCatalog.map((mod) => {
                    const checked = createForm.enabledModules.includes(mod.key);
                    return (
                      <label
                        key={mod.key}
                        className={`superadmin-module-Option ${checked ? 'checked' : ''} ${mod.required ? 'locked' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={mod.required}
                          onChange={() => toggleCreateModule(mod.key, mod.required)}
                        />
                        <span>{mod.label}{mod.required ? ' (Bắt buộc)' : ''}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </div>

            <div className="form-actions">
              <button type="button" className="button button-secondary" disabled={creating} onClick={() => setShowCreateModal(false)}>
                Hủy
              </button>
              <button type="submit" className="button button-primary" disabled={creating}>
                {creating ? 'Đang khởi tạo...' : 'Tạo trường & Cấp tài khoản riêng'}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {/* MODAL CẤU HÌNH ĐỊNH DANH TRƯỜNG, HẠN MỨC, MODULE & ACCOUNT ADMIN TRƯỜNG */}
      {editingSchool && createPortal(
        <div
          className="account-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !savingEdit) setEditingSchool(null);
          }}
        >
          <form
            className="account-modal-card student-form"
            style={{ width: 'min(820px, 96vw)', maxHeight: '90dvh', overflowY: 'auto' }}
            onSubmit={handleSaveEdit}
          >
            <div className="account-modal-header">
              <div>
                <p className="card-kicker">CẤU HÌNH CẤP TRƯỜNG, HẠN MỨC & GÓI PHÂN HỆ</p>
                <h2>{editingSchool.name} ({editingSchool.code})</h2>
              </div>
              <button type="button" className="button button-secondary" disabled={savingEdit} onClick={() => setEditingSchool(null)}>
                Đóng
              </button>
            </div>

            {editError && <div className="form-error" role="alert">{editError}</div>}

            <div className="student-form-grid">
              <label className="form-wide">
                Tên trường pháp lý / hiển thị *
                <input
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </label>
              <label>
                Mã cụm / Chuỗi trường
                <input
                  value={editForm.organizationCode}
                  onChange={(e) => setEditForm({ ...editForm, organizationCode: e.target.value.toUpperCase() })}
                />
              </label>
              <label>
                Trạng thái hoạt động của trường
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                >
                  <option value="active">Đang hoạt động</option>
                  <option value="suspended">Tạm ngưng hoạt động (Khóa truy cập)</option>
                </select>
              </label>
              <label>
                Email liên hệ chính thức
                <input
                  type="email"
                  value={editForm.contactEmail}
                  onChange={(e) => setEditForm({ ...editForm, contactEmail: e.target.value })}
                />
              </label>
              <label>
                Hạn mức tối đa Phân hiệu được mở
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={editForm.maxCampuses}
                  onChange={(e) => setEditForm({ ...editForm, maxCampuses: e.target.value })}
                />
              </label>
              <label>
                Hạn mức tối đa Học sinh toàn trường
                <input
                  type="number"
                  min={10}
                  max={20000}
                  value={editForm.maxStudents}
                  onChange={(e) => setEditForm({ ...editForm, maxStudents: e.target.value })}
                />
              </label>
              <label>
                Hạn mức tối đa Nhân sự
                <input
                  type="number"
                  min={5}
                  max={5000}
                  value={editForm.maxStaff}
                  onChange={(e) => setEditForm({ ...editForm, maxStaff: e.target.value })}
                />
              </label>

              <fieldset className="student-allergy-fieldset form-wide">
                <legend>Tài khoản Admin riêng của trường</legend>
                <div className="student-form-grid" style={{ padding: 0 }}>
                  <label>
                    Tên đăng nhập Admin trường
                    <input
                      value={editForm.adminUsername}
                      onChange={(e) => setEditForm({ ...editForm, adminUsername: e.target.value })}
                    />
                  </label>
                  <label>
                    Đặt lại mật khẩu Admin trường (để trống nếu giữ nguyên)
                    <input
                      type="password"
                      placeholder="Nhập mật khẩu mới (>= 6 ký tự)"
                      value={editForm.newAdminPassword}
                      onChange={(e) => setEditForm({ ...editForm, newAdminPassword: e.target.value })}
                    />
                  </label>
                </div>
              </fieldset>

              <fieldset className="student-allergy-fieldset form-wide">
                <legend>
                  Bật / Tắt Phân hệ chức năng cho trường ({editForm.enabledModules.length}/{moduleCatalog.length})
                </legend>
                <div className="superadmin-module-grid">
                  {moduleCatalog.map((mod) => {
                    const checked = editForm.enabledModules.includes(mod.key);
                    return (
                      <label
                        key={mod.key}
                        className={`superadmin-module-Option ${checked ? 'checked' : ''} ${mod.required ? 'locked' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={mod.required}
                          onChange={() => toggleEditModule(mod.key, mod.required)}
                        />
                        <span>{mod.label}{mod.required ? ' (Cốt lõi)' : ''}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </div>

            <div className="form-actions">
              <button type="button" className="button button-secondary" disabled={savingEdit} onClick={() => setEditingSchool(null)}>
                Hủy
              </button>
              <button type="submit" className="button button-primary" disabled={savingEdit}>
                {savingEdit ? 'Đang lưu...' : 'Lưu cấu hình & Phân hệ trường'}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
}
