import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import { CashflowDonutChart, EconomicPeriodChart } from '../components/SuperAdminCharts';
import SuperAdminSchoolReportModal from '../components/SuperAdminSchoolReportModal';
import SuperAdminSchoolAccountsModal from '../components/SuperAdminSchoolAccountsModal';
import SuperAdminUsageAnalyticsPanel from '../components/SuperAdminUsageAnalyticsPanel';
import SuperAdminSettingsPanel from '../components/SuperAdminSettingsPanel';
import SuperAdminAuditPanel from '../components/SuperAdminAuditPanel';
import {
  getSuperAdminSchools,
  createSchoolWithAdmin,
  updateSchoolAndAdmin,
  enterSchoolWorkspace,
  testSuperAdminSchoolWebhook,
  dispatchSuperAdminNotification
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

const generateRandomAdminPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let pass = 'Hn@';
  for (let i = 0; i < 6; i += 1) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
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
    totalExpenditure: 0,
    alertCount: 0
  });
  const [economicTrend, setEconomicTrend] = useState([]);
  const [roleDistribution, setRoleDistribution] = useState([]);
  const [systemHealth, setSystemHealth] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [moduleCatalog, setModuleCatalog] = useState(DEFAULT_MODULE_CATALOG);
  const [systemSettings, setSystemSettings] = useState(null);
  const [schools, setSchools] = useState([]);

  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [handoverCard, setHandoverCard] = useState(null);
  const [copiedKey, setCopiedKey] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [enteringId, setEnteringId] = useState('');
  const [reportSchoolId, setReportSchoolId] = useState(null);
  const [accountModalSchool, setAccountModalSchool] = useState(null);

  // Điều phối chuyển sang tab Nhật ký của từng trường cụ thể
  const [auditJumpSchoolId, setAuditJumpSchoolId] = useState('all');
  const [auditJumpLogType, setAuditJumpLogType] = useState('school_audit');

  // Modal Tạo Trường Mới
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState(() => makeEmptyCreateForm());
  const [showCreatePass, setShowCreatePass] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Modal Sửa Trường / Cấp lại Tài khoản Admin Trường
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
  const [showEditPass, setShowEditPass] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  // Modal Kiểm tra nhanh Webhook theo mã trường cho SuperAdmin
  const [webhookTestSchool, setWebhookTestSchool] = useState(null);
  const [webhookTestCode, setWebhookTestCode] = useState('');
  const [webhookTestName, setWebhookTestName] = useState('');
  const [webhookTesting, setWebhookTesting] = useState(false);
  const [webhookTestResult, setWebhookTestResult] = useState(null);

  // Modal Gửi Thông báo Hệ thống / Cấp phép xuống đúng Trường được chọn
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [dispatchForm, setDispatchForm] = useState({
    targetScope: 'single',
    schoolId: '',
    type: 'system',
    title: '',
    message: ''
  });
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSuperAdminSchools();
      const payload = res.data?.data || {};
      setSummary((prev) => ({ ...prev, ...(payload.summary || {}) }));
      setEconomicTrend(payload.economicTrend || []);
      setRoleDistribution(payload.roleDistribution || []);
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
    if (!showCreateModal && !editingSchool && !webhookTestSchool && !showDispatchModal) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (showCreateModal && !creating) setShowCreateModal(false);
        if (editingSchool && !savingEdit) setEditingSchool(null);
        if (webhookTestSchool && !webhookTesting) setWebhookTestSchool(null);
        if (showDispatchModal && !dispatching) setShowDispatchModal(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showCreateModal, editingSchool, webhookTestSchool, showDispatchModal, creating, savingEdit, webhookTesting, dispatching]);

  const openDispatchNotificationModal = (school = null) => {
    setDispatchError('');
    setDispatchForm({
      targetScope: 'single',
      schoolId: school?._id || schools[0]?._id || '',
      type: 'system',
      title: '',
      message: ''
    });
    setShowDispatchModal(true);
  };

  const handleDispatchNotification = async (e) => {
    e.preventDefault();
    if (dispatching) return;
    setDispatching(true);
    setDispatchError('');
    try {
      const res = await dispatchSuperAdminNotification({
        targetScope: dispatchForm.targetScope,
        schoolId: dispatchForm.targetScope === 'single' ? dispatchForm.schoolId : undefined,
        type: dispatchForm.type,
        title: dispatchForm.title.trim(),
        message: dispatchForm.message.trim()
      });
      setShowDispatchModal(false);
      setNotice({ type: 'success', text: res.data?.message || 'Đã gửi thông báo hệ thống tới trường thành công.' });
    } catch (err) {
      setDispatchError(err.response?.data?.message || 'Không thể gửi thông báo tới trường.');
    } finally {
      setDispatching(false);
    }
  };

  const copyText = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(''), 2300);
    } catch {
      // Bỏ qua nếu trình duyệt chặn clipboard
    }
  };

  const openSchoolLogs = (schoolId = 'all', logType = 'school_audit') => {
    setAuditJumpSchoolId(schoolId || 'all');
    setAuditJumpLogType(logType);
    setActiveSection('audit');
  };

  const openCreateModal = () => {
    setCreateError('');
    setShowCreatePass(false);
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
    const cleanCode = createForm.code.trim().toUpperCase();
    const cleanUser = createForm.adminUsername.trim();
    const plainPass = createForm.adminPassword;
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
        code: cleanCode,
        name: createForm.name.trim(),
        organizationCode: createForm.organizationCode.trim().toUpperCase(),
        contactEmail: createForm.contactEmail.trim(),
        adminUsername: cleanUser,
        adminPassword: plainPass,
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
      setHandoverCard({
        schoolCode: cleanCode,
        schoolName: createForm.name.trim(),
        username: cleanUser,
        password: plainPass,
        webhookUrl: `${window.location.origin}/api/attendance/webhook/${cleanCode}`
      });
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
    setShowEditPass(false);
    setEditForm({
      name: fullSchool.name || '',
      organizationCode: fullSchool.organizationCode || '',
      contactEmail: fullSchool.contactEmail || '',
      status: fullSchool.status || 'active',
      adminUsername: fullSchool.primaryAdmin?.username || `admin_${String(fullSchool.code || '').toLowerCase()}`,
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
    const plainResetPass = editForm.newAdminPassword.trim();
    const cleanAdminUser = editForm.adminUsername.trim();
    try {
      await updateSchoolAndAdmin(editingSchool._id, {
        name: editForm.name,
        organizationCode: editForm.organizationCode,
        contactEmail: editForm.contactEmail,
        status: editForm.status,
        adminUsername: cleanAdminUser,
        newAdminPassword: plainResetPass,
        enabledModules: editForm.enabledModules,
        quotas: {
          maxCampuses: Number(editForm.maxCampuses),
          maxStudents: Number(editForm.maxStudents),
          maxStaff: Number(editForm.maxStaff)
        }
      });
      if (plainResetPass) {
        setHandoverCard({
          schoolCode: editingSchool.code,
          schoolName: editForm.name,
          username: cleanAdminUser,
          password: plainResetPass,
          webhookUrl: `${window.location.origin}/api/attendance/webhook/${editingSchool.code}`
        });
      }
      setEditingSchool(null);
      await load();
      setNotice({ type: 'success', text: 'Đã lưu cấu hình trường học, tài khoản Admin riêng và phân hệ chức năng.' });
    } catch (err) {
      setEditError(err.response?.data?.message || 'Không thể lưu cập nhật.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleRunSuperWebhookTest = async (e) => {
    e.preventDefault();
    if (!webhookTestSchool || !webhookTestCode.trim() || webhookTesting) return;
    setWebhookTesting(true);
    setWebhookTestResult(null);
    try {
      const res = await testSuperAdminSchoolWebhook(webhookTestSchool._id, {
        externalPersonId: webhookTestCode.trim(),
        personName: webhookTestName.trim(),
        verifyMode: 'FACE'
      });
      setWebhookTestResult(res.data?.data || null);
      await load();
    } catch (err) {
      setWebhookTestResult({
        error: true,
        processingNote: err.response?.data?.message || 'Không thể gửi gói tin kiểm tra Webhook'
      });
    } finally {
      setWebhookTesting(false);
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
        navigate('/campuses');
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
      label: 'Tổng quan & Kinh tế',
      icon: 'chart',
      theme: 'system',
      badge: alerts.length > 0 ? alerts.length : null,
      alertBadge: alerts.length > 0
    },
    {
      id: 'analytics',
      label: 'Thống kê Sử dụng & Biểu đồ',
      icon: 'activity',
      theme: 'finance',
      badge: null,
      alertBadge: false
    },
    {
      id: 'schools',
      label: 'Quản lý Trường & Account',
      icon: 'classes',
      theme: 'student',
      badge: summary.totalSchools || 0,
      alertBadge: false
    },
    {
      id: 'audit',
      label: 'Nhật ký Từng Trường & Log',
      icon: 'fileText',
      theme: 'personal',
      badge: null,
      alertBadge: false
    },
    {
      id: 'settings',
      label: 'Cấu hình chung Hệ thống',
      icon: 'settings',
      theme: 'ops',
      badge: null,
      alertBadge: false
    }
  ];

  const sectionTitleMap = {
    overview: {
      title: 'Trung tâm Phân phối Phần mềm, Kinh tế & Hỗ trợ Các Trường',
      subtitle: 'Cấp phép đơn vị trường sử dụng phần mềm, giám sát hạ tầng máy chủ, biểu đồ kinh tế và hỗ trợ kỹ thuật (mọi cảnh báo vận hành hằng ngày được gửi riêng về đúng từng trường).'
    },
    analytics: {
      title: 'Báo cáo Thống kê Mức độ Sử dụng Phần mềm & Biểu đồ Các Trường',
      subtitle: 'Đo lường chi tiết cách từng trường khai thác gói tính năng, hạn mức Quota, tài khoản người dùng và đồng bộ Webhook.'
    },
    schools: {
      title: 'Cấp phép Đơn vị Trường, Tài khoản Admin & Webhook',
      subtitle: 'Phân phối gói phân hệ phần mềm và cấp tài khoản Admin riêng cho từng trường tự tạo Giám đốc, Giáo viên, Đầu bếp...'
    },
    audit: {
      title: 'Nhật ký Hoạt động Từng Trường, Webhook & Bảo mật',
      subtitle: 'Tra cứu chi tiết nhật ký sử dụng nội bộ của từng trường, lịch sử gói tin máy chấm công và kiểm toán cấp nền tảng.'
    },
    settings: {
      title: 'Cấu hình Nền tảng Phân phối Phần mềm SaaS',
      subtitle: 'Thiết lập thông tin đơn vị cung cấp phần mềm, thông báo bảo trì theo trường, hạn mức gói mặc định và chính sách bảo mật hạ tầng.'
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
            {schools.length > 0 && (
              <button type="button" className="button button-secondary" onClick={() => openDispatchNotificationModal(schools[0])}>
                <Icon name="bell" size={15} /> Gửi thông báo tới trường
              </button>
            )}
            <button type="button" className="button button-primary" onClick={openCreateModal}>
              <Icon name="plus" size={16} /> Cấp phép trường mới & Account
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

          {/* PHIẾU BÀN GIAO NHANH TÀI KHOẢN ADMIN TRƯỜNG & URL WEBHOOK */}
          {handoverCard && (
            <div className="credential-handover-card">
              <div style={{ flex: '1 1 480px' }}>
                <h3>✓ Phiếu bàn giao Tài khoản Admin & Đường dẫn Webhook cho {handoverCard.schoolName} ({handoverCard.schoolCode})</h3>
                <div className="credential-handover-grid" style={{ marginBottom: 6 }}>
                  <span>Mã trường: <code>{handoverCard.schoolCode}</code></span>
                  <span>Tài khoản Admin trường: <code>{handoverCard.username}</code></span>
                  <span>Mật khẩu: <code>{handoverCard.password}</code></span>
                </div>
                <div className="credential-handover-grid">
                  <span>Webhook chấm công & điểm danh HS: <code>POST {handoverCard.webhookUrl}</code></span>
                </div>
                <small style={{ display: 'block', marginTop: 6, color: '#166534' }}>
                  * Gửi thông tin này cho Quản trị viên của trường. Sau khi đăng nhập, Admin trường vào mục <strong>Tài khoản & Phân quyền</strong> để tự tạo tài khoản <strong>Ban Giám đốc/Hiệu trưởng, Giáo viên, Đầu bếp, Kế toán, Nhân sự, Bảo vệ</strong>.
                </small>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() =>
                    copyText(
                      'handover',
                      [
                        `Trường: ${handoverCard.schoolName} (${handoverCard.schoolCode})`,
                        `Đăng nhập tại: ${window.location.origin}/login`,
                        `Tên đăng nhập Admin trường: ${handoverCard.username}`,
                        `Mật khẩu: ${handoverCard.password}`,
                        `Webhook máy chấm công & điểm danh HS: ${handoverCard.webhookUrl}`
                      ].join('\n')
                    )
                  }
                >
                  <Icon name="copy" size={15} /> {copiedKey === 'handover' ? 'Đã sao chép trọn bộ!' : 'Sao chép gửi cho trường'}
                </button>
                <button type="button" className="button button-secondary" onClick={() => setHandoverCard(null)}>
                  Đóng phiếu
                </button>
              </div>
            </div>
          )}

          {/* ================================================================
              MỤC 1: DASHBOARD TỔNG QUAN, BIỂU ĐỒ KINH TẾ & HỖ TRỢ NHANH
             ================================================================ */}
          {activeSection === 'overview' && (
            <div>
              <div className="superadmin-kpi-grid">
                <article className="superadmin-kpi-card">
                  <span className="superadmin-kpi-icon blue"><Icon name="shield" size={21} /></span>
                  <div className="superadmin-kpi-body">
                    <small>ĐƠN VỊ TRƯỜNG ĐƯỢC CẤP PHÉP</small>
                    <strong>{summary.activeSchools} / {summary.totalSchools} trường</strong>
                    <span className="superadmin-kpi-sub">
                      {summary.totalCampuses} phân hiệu · {summary.suspendedSchools || 0} tạm khóa
                    </span>
                  </div>
                </article>

                <article className="superadmin-kpi-card">
                  <span className="superadmin-kpi-icon purple"><Icon name="students" size={21} /></span>
                  <div className="superadmin-kpi-body">
                    <small>SỬ DỤNG HẠN MỨC GÓI (QUOTA HS)</small>
                    <strong>{summary.totalStudents} / {summary.totalStudentQuota || 800} HS</strong>
                    <span className="superadmin-kpi-sub">
                      {summary.totalClassrooms} lớp · Đạt {summary.overallStudentQuotaPercent || 0}% tổng hạn mức cấp
                    </span>
                  </div>
                </article>

                <article className="superadmin-kpi-card">
                  <span className="superadmin-kpi-icon teal"><Icon name="users" size={21} /></span>
                  <div className="superadmin-kpi-body">
                    <small>TÀI KHOẢN SỬ DỤNG PHẦN MỀM</small>
                    <strong>{summary.totalActiveAccounts} tài khoản</strong>
                    <span className="superadmin-kpi-sub">
                      {summary.totalStaff} nhân sự nội bộ tại các trường
                    </span>
                  </div>
                </article>

                <article className="superadmin-kpi-card">
                  <span className="superadmin-kpi-icon amber"><Icon name="money" size={21} /></span>
                  <div className="superadmin-kpi-body">
                    <small>THỰC THU TRÊN NỀN TẢNG</small>
                    <strong>{formatCurrency(summary.totalCollected)}</strong>
                    <span className="superadmin-kpi-sub">
                      Đạt {summary.overallCollectionRatePercent}% · Dư nợ: {formatCurrency(summary.totalOutstandingDebt)}
                    </span>
                  </div>
                </article>

                <article className="superadmin-kpi-card">
                  <span className="superadmin-kpi-icon green"><Icon name="clock" size={21} /></span>
                  <div className="superadmin-kpi-body">
                    <small>ĐỒNG BỘ WEBHOOK PHẦN CỨNG</small>
                    <strong>{summary.totalWebhookEvents || 0} lượt đẩy</strong>
                    <span className="superadmin-kpi-sub">
                      {summary.totalDevices || 0} máy chấm công kết nối theo mã trường
                    </span>
                  </div>
                </article>

                <article className="superadmin-kpi-card">
                  <span className={`superadmin-kpi-icon ${alerts.length > 0 ? 'rose' : 'green'}`}>
                    <Icon name={alerts.length > 0 ? 'alertCircle' : 'check'} size={21} />
                  </span>
                  <div className="superadmin-kpi-body">
                    <small>CẢNH BÁO CẤP PHÉP & HẠ TẦNG</small>
                    <strong>{alerts.length} lưu ý kỹ thuật</strong>
                    <span className="superadmin-kpi-sub">
                      Chỉ báo Quota gói, lỗi Webhook & sức khỏe Server
                    </span>
                  </div>
                </article>
              </div>

              {/* BIỂU ĐỒ DASHBOARD XEM KINH TẾ TOÀN CHUỖI */}
              <div className="superadmin-two-col">
                <section className="content-card" style={{ padding: '20px 22px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                    <div>
                      <p className="card-kicker">BIỂU ĐỒ KINH TẾ CHUỖI TRƯỜNG</p>
                      <h2 style={{ margin: '2px 0 0' }}>Doanh thu Học phí – Thực thu – Chi phí vận hành</h2>
                    </div>
                    <button type="button" className="button button-secondary" onClick={() => setActiveSection('analytics')}>
                      Phân tích sâu & Xuất Excel →
                    </button>
                  </div>
                  <EconomicPeriodChart economicTrend={economicTrend} schools={schools} />
                </section>

                <section className="content-card" style={{ padding: '20px 22px' }}>
                  <p className="card-kicker">PHÂN TÍCH DÒNG TIỀN & CÔNG NỢ</p>
                  <h2 style={{ margin: '2px 0 6px' }}>Cơ cấu Thực thu, Nợ đọng & Chi lương</h2>
                  <CashflowDonutChart
                    collected={summary.totalCollected}
                    outstanding={summary.totalOutstandingDebt}
                    expenditure={summary.totalExpenditure}
                  />
                </section>
              </div>

              {/* TRUNG TÂM HỖ TRỢ NHANH CÁC TRƯỜNG (QUICK SUPPORT) */}
              {schools.length > 0 && (
                <section className="sa-quick-support-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <p className="card-kicker" style={{ color: '#1d4ed8' }}>HỖ TRỢ KỸ THUẬT & BÀN GIAO NHANH CHO CÁC TRƯỜNG</p>
                      <h2 style={{ margin: '2px 0 4px', color: '#0f172a' }}>Hỗ trợ nhanh các trường ({schools.length} trường)</h2>
                      <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>
                        Thao tác 1 chạm: Cấp/Đặt lại mật khẩu tài khoản Admin trường, sao chép đường dẫn Webhook <code>/api/attendance/webhook/&lt;MÃ_TRƯỜNG&gt;</code>, kiểm tra Log hoặc vào hỗ trợ trực tiếp.
                      </p>
                    </div>
                  </div>

                  <div className="sa-quick-support-grid">
                    {schools.map((s) => {
                      const webhookUrl = `${window.location.origin}/api/attendance/webhook/${s.code}`;
                      return (
                        <article key={s._id} className="sa-quick-school-box">
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                            <div>
                              <strong style={{ color: '#1d4ed8', fontSize: 14 }}>{s.code}</strong> · <strong>{s.name}</strong>
                              <small style={{ display: 'block', color: '#64748b', marginTop: 2 }}>
                                Admin trường: <strong>{s.primaryAdmin ? `@${s.primaryAdmin.username}` : 'Chưa có'}</strong> · Khai thác: <strong>{s.usage?.usageScorePercent || 0}%</strong>
                              </small>
                            </div>
                            <span className={`student-status ${s.status === 'active' ? 'enrolled' : 'withdrawn'}`}>
                              {s.status === 'active' ? 'Hoạt động' : 'Tạm ngưng'}
                            </span>
                          </div>

                          <div className="sa-quick-webhook-line" title={webhookUrl}>
                            <code>/api/attendance/webhook/{s.code}</code>
                            <button
                              type="button"
                              className="button button-secondary"
                              style={{ padding: '4px 9px', minHeight: 28, fontSize: 11 }}
                              onClick={() => copyText(`wh-${s._id}`, webhookUrl)}
                            >
                              <Icon name="copy" size={12} /> {copiedKey === `wh-${s._id}` ? 'Đã chép!' : 'Copy URL'}
                            </button>
                          </div>

                          <div className="classroom-actions" style={{ flexWrap: 'wrap', marginTop: 'auto' }}>
                            <button type="button" className="button button-secondary" onClick={() => setAccountModalSchool(s)}>
                              Quản lý Account ({s.accountStats?.totalAccounts || 0})
                            </button>
                            <button type="button" className="button button-secondary" onClick={() => openEditModal(s)}>
                              Cấu hình gói
                            </button>
                            <button type="button" className="button button-secondary" onClick={() => openDispatchNotificationModal(s)}>
                              Gửi thông báo riêng
                            </button>
                            <button
                              type="button"
                              className="button button-secondary"
                              onClick={() => {
                                setWebhookTestSchool(s);
                                setWebhookTestCode('');
                                setWebhookTestName('');
                                setWebhookTestResult(null);
                              }}
                            >
                              Test Webhook
                            </button>
                            <button type="button" className="button button-secondary" onClick={() => openSchoolLogs(s._id, 'school_audit')}>
                              Xem Log
                            </button>
                            {s.status === 'active' && (
                              <button
                                type="button"
                                className="button button-primary"
                                disabled={Boolean(enteringId)}
                                onClick={() => handleEnterSchool(s)}
                              >
                                {enteringId === s._id ? 'Đang mở...' : 'Vào hỗ trợ'}
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}

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

                {/* KHỐI GIÁM SÁT HẠN MỨC CẤP PHÉP & KỸ THUẬT NỀN TẢNG */}
                <section className="content-card" style={{ padding: '20px 22px' }}>
                  <p className="card-kicker">GIÁM SÁT CẤP PHÉP GÓI PHẦN MỀM & TÍCH HỢP KỸ THUẬT</p>
                  <h2 style={{ margin: '2px 0 4px' }}>Lưu ý Hạ tầng & Hạn mức Quota ({alerts.length})</h2>
                  <p style={{ margin: '0 0 10px', fontSize: 12.5, color: '#64748b' }}>
                    Các thông báo vận hành nội bộ (như nhắc điểm danh học sinh, bếp ăn, phản hồi phụ huynh) được gửi trực tiếp vào chuông thông báo của riêng từng trường sử dụng.
                  </p>

                  {alerts.length === 0 ? (
                    <div style={{ padding: '26px 12px', textAlign: 'center', color: '#15803d', fontWeight: 600, background: '#f0fdf4', borderRadius: 12, border: '1px solid #bbf7d0' }}>
                      ✓ Hạ tầng phân phối phần mềm, hạn mức Quota và kết nối Webhook của tất cả các trường đều hoạt động ổn định.
                    </div>
                  ) : (
                    <div className="superadmin-alert-list">
                      {alerts.map((al, idx) => (
                        <div key={`${al.schoolId || 'sys'}-${al.category}-${idx}`} className={`superadmin-alert-item ${al.severity}`}>
                          <div>
                            <strong style={{ display: 'block', fontSize: '13.5px', color: '#0f172a' }}>
                              [{al.schoolCode}] {al.title}
                            </strong>
                            <small style={{ color: '#475569' }}>{al.detail}</small>
                          </div>
                          {al.schoolId && (
                            <button
                              type="button"
                              className="button button-secondary"
                              style={{ whiteSpace: 'nowrap', padding: '6px 11px', fontSize: '12px' }}
                              onClick={() => openEditModal({ _id: al.schoolId })}
                            >
                              Cấu hình gói
                            </button>
                          )}
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
                    <table className="data-table sa-clean-table">
                      <thead>
                        <tr>
                          <th>Trường học</th>
                          <th>Quy mô & Lấp đầy</th>
                          <th>Điểm danh hôm nay / 30 ngày</th>
                          <th>Tiến độ thu học phí</th>
                          <th>Hoạt động & Log</th>
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
                                {s.accountStats?.activeAccounts || 0} TK active · Webhook: {s.webhook?.totalEvents || 0}
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
                                  onClick={() => openSchoolLogs(s._id, 'school_audit')}
                                >
                                  Log trường
                                </button>
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
              MỤC 2: TRANG THỐNG KÊ MỨC ĐỘ SỬ DỤNG & BIỂU ĐỒ KINH TẾ
             ================================================================ */}
          {activeSection === 'analytics' && (
            <SuperAdminUsageAnalyticsPanel
              summary={summary}
              economicTrend={economicTrend}
              roleDistribution={roleDistribution}
              schools={schools}
              onOpenReport={(id) => setReportSchoolId(id)}
              onOpenSchoolLogs={openSchoolLogs}
              onEnterSchool={handleEnterSchool}
            />
          )}

          {/* ================================================================
              MỤC 3: QUẢN LÝ DANH SÁCH TRƯỜNG, ACCOUNT TỪNG TRƯỜNG & WEBHOOK
             ================================================================ */}
          {activeSection === 'schools' && (
            <div>
              {/* 4 THẺ TỔNG HỢP NHANH ACCOUNT & ĐƠN VỊ TRƯỜNG */}
              <div className="classroom-summary-grid">
                <article>
                  <span><Icon name="classes" size={21} /></span>
                  <div>
                    <small>ĐƠN VỊ TRƯỜNG ĐỘC LẬP</small>
                    <strong>{summary.activeSchools} / {summary.totalSchools} trường</strong>
                  </div>
                </article>
                <article>
                  <span className="summary-badge purple"><Icon name="shield" size={21} /></span>
                  <div>
                    <small>TÀI KHOẢN ADMIN TRƯỜNG</small>
                    <strong>
                      {schools.reduce((sum, item) => sum + (item.accountStats?.roleCounts?.admin || (item.primaryAdmin ? 1 : 0)), 0)} Admin riêng
                    </strong>
                  </div>
                </article>
                <article>
                  <span className="summary-badge green"><Icon name="users" size={21} /></span>
                  <div>
                    <small>ACCOUNT NỘI BỘ CÁC TRƯỜNG</small>
                    <strong>
                      {schools.reduce((sum, item) => sum + (item.accountStats?.internalActiveAccounts || 0), 0)} tài khoản nhân sự
                    </strong>
                  </div>
                </article>
                <article>
                  <span className="summary-badge amber"><Icon name="clock" size={21} /></span>
                  <div>
                    <small>PHỤ HUYNH & WEBHOOK ĐỒNG BỘ</small>
                    <strong>
                      {schools.reduce((sum, item) => sum + (item.accountStats?.parentAccounts || 0), 0)} PH · {summary.totalWebhookEvents || 0} lượt quẹt
                    </strong>
                  </div>
                </article>
              </div>

              <section className="content-card student-list-card">
                <div className="list-toolbar" style={{ flexWrap: 'wrap' }}>
                  <div>
                    <p className="card-kicker">QUẢN TRỊ ĐƠN VỊ TRƯỜNG, ACCOUNT TỪNG TRƯỜNG & ĐỒNG BỘ WEBHOOK</p>
                    <h2>Danh sách Trường học &amp; Tài khoản theo từng trường ({filteredSchools.length})</h2>
                    <p style={{ maxWidth: 820, lineHeight: 1.55 }}>
                      Mỗi trường có không gian dữ liệu và <strong>Tài khoản Admin riêng</strong> độc lập. Bấm <strong>&quot;Quản lý Account&quot;</strong> ở từng trường để cấp thêm Admin, đặt lại mật khẩu bàn giao hoặc kiểm tra toàn bộ tài khoản Giám đốc, Giáo viên, Đầu bếp, Kế toán của trường đó.
                    </p>
                  </div>
                </div>

                <div className="student-filters" style={{ padding: '0 22px 16px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <label className="search-box" style={{ flex: '1 1 320px' }}>
                    <Icon name="search" size={16} />
                    <input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Tìm theo mã trường, tên trường, cụm trường hoặc @username Admin..."
                    />
                  </label>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    style={{ padding: '10px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', background: '#fff', fontWeight: 600 }}
                  >
                    <option value="all">Tất cả trạng thái ({schools.length})</option>
                    <option value="active">Đang hoạt động ({summary.activeSchools})</option>
                    <option value="suspended">Tạm ngưng ({summary.suspendedSchools || 0})</option>
                  </select>
                </div>

                {loading ? (
                  <div className="inline-loader">Đang tải danh sách trường học &amp; tài khoản...</div>
                ) : filteredSchools.length === 0 ? (
                  <div style={{ padding: '36px 20px', textAlign: 'center', color: '#64748b' }}>
                    Không có trường học nào khớp điều kiện tìm kiếm.
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table sa-clean-table">
                      <thead>
                        <tr>
                          <th>Đơn vị Trường &amp; Phân hiệu</th>
                          <th>Tài khoản của Trường (Admin &amp; Nhân sự)</th>
                          <th>Webhook Máy chấm công &amp; Điểm danh</th>
                          <th>Quy mô &amp; Gói cấp phép</th>
                          <th>Thao tác Điều hành</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredSchools.map((s) => {
                          const webhookUrl = `${window.location.origin}/api/attendance/webhook/${s.code}`;
                          const rc = s.accountStats?.roleCounts || {};
                          const staffAccCount =
                            (rc.principal || 0) +
                            (rc.teacher || 0) +
                            (rc.chef || 0) +
                            (rc.accountant || 0) +
                            (rc.hr || 0) +
                            (rc.guard || 0);
                          const totalAcc = s.accountStats?.totalAccounts || 0;
                          const quotaPercent = s.quotas?.maxStudents > 0
                            ? Math.min(100, Math.round((s.studentCount / s.quotas.maxStudents) * 100))
                            : 0;

                          return (
                            <tr key={s._id}>
                              <td>
                                <div className="sa-school-identity">
                                  <div className="sa-school-code-row">
                                    <span className="sa-school-code-pill">{s.code}</span>
                                    <span className={`student-status ${s.status === 'active' ? 'enrolled' : 'withdrawn'}`}>
                                      {s.status === 'active' ? 'Hoạt động' : s.status === 'suspended' ? 'Tạm ngưng' : 'Đã đóng'}
                                    </span>
                                  </div>
                                  <strong className="sa-school-title">{s.name}</strong>
                                  <small>
                                    {s.campusCount}/{s.quotas?.maxCampuses || 10} phân hiệu: {(s.campusNames || []).join(', ')}
                                  </small>
                                  {s.contactEmail && <small>Liên hệ: {s.contactEmail}</small>}
                                </div>
                              </td>

                              <td>
                                <div className="sa-school-account-card">
                                  <div className="sa-school-account-top">
                                    {s.primaryAdmin ? (
                                      <div className="sa-user-identity-cell">
                                        <span className="sa-user-avatar is-admin">
                                          {String(s.primaryAdmin.username || 'A').charAt(0).toUpperCase()}
                                        </span>
                                        <div style={{ minWidth: 0 }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                            <code className="sa-username-code">@{s.primaryAdmin.username}</code>
                                            <button
                                              type="button"
                                              className="sa-mini-icon-btn"
                                              title="Sao chép username Admin trường"
                                              onClick={() => copyText(`adm-${s._id}`, s.primaryAdmin.username)}
                                            >
                                              <Icon name={copiedKey === `adm-${s._id}` ? 'check' : 'copy'} size={12} />
                                            </button>
                                          </div>
                                          <small style={{ marginTop: 3 }}>
                                            {s.primaryAdmin.fullName} · {formatShortDate(s.primaryAdmin.lastLogin)}
                                          </small>
                                        </div>
                                      </div>
                                    ) : (
                                      <span className="account-unlinked">Chưa cấp tài khoản Admin</span>
                                    )}
                                  </div>

                                  <div className="sa-account-role-summary-line">
                                    <span className="sa-account-mini-tag">
                                      Admin: <strong>{rc.admin || (s.primaryAdmin ? 1 : 0)}</strong>
                                    </span>
                                    <span className="sa-account-mini-tag">
                                      Nhân sự: <strong>{staffAccCount}</strong>
                                    </span>
                                    <span className="sa-account-mini-tag">
                                      Phụ huynh: <strong>{rc.parent || 0}</strong>
                                    </span>
                                  </div>

                                  <button
                                    type="button"
                                    className="button sa-account-manage-btn"
                                    onClick={() => setAccountModalSchool(s)}
                                  >
                                    <Icon name="users" size={14} /> Quản lý Account trường ({totalAcc} TK)
                                  </button>
                                </div>
                              </td>

                              <td>
                                <div className="sa-webhook-cell-box">
                                  <code>/api/attendance/webhook/{s.code}</code>
                                  <div style={{ marginTop: 7, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <button
                                      type="button"
                                      className="button button-secondary"
                                      style={{ padding: '2px 9px', minHeight: 27, fontSize: 11.5 }}
                                      onClick={() => copyText(`tbl-wh-${s._id}`, webhookUrl)}
                                    >
                                      <Icon name="copy" size={12} /> {copiedKey === `tbl-wh-${s._id}` ? 'Đã chép' : 'Copy URL'}
                                    </button>
                                    <button
                                      type="button"
                                      className="button button-secondary"
                                      style={{ padding: '2px 9px', minHeight: 27, fontSize: 11.5 }}
                                      onClick={() => {
                                        setWebhookTestSchool(s);
                                        setWebhookTestCode('');
                                        setWebhookTestName('');
                                        setWebhookTestResult(null);
                                      }}
                                    >
                                      Test
                                    </button>
                                    <span style={{ fontSize: 11.5, color: '#64748b', fontWeight: 600 }}>
                                      {s.webhook?.totalEvents || 0} lượt đẩy
                                    </span>
                                  </div>
                                </div>
                              </td>

                              <td style={{ minWidth: 180 }}>
                                <div>
                                  <strong>{s.studentCount}</strong> / {s.quotas?.maxStudents || 800} học sinh
                                </div>
                                <div className="superadmin-progress-track" style={{ margin: '6px 0' }}>
                                  <div className="superadmin-progress-fill blue" style={{ width: `${quotaPercent}%` }} />
                                </div>
                                <small>
                                  {s.classCount} lớp · {s.staffCount} nhân sự · <strong>{s.enabledModules?.length || moduleCatalog.length}/{moduleCatalog.length}</strong> phân hệ
                                </small>
                              </td>

                              <td>
                                <div className="sa-school-actions-grid">
                                  <button type="button" className="button button-secondary" onClick={() => openEditModal(s)}>
                                    Cấu hình gói
                                  </button>
                                  <button type="button" className="button button-secondary" onClick={() => setReportSchoolId(s._id)}>
                                    Báo cáo 360°
                                  </button>
                                  <button type="button" className="button button-secondary" onClick={() => openSchoolLogs(s._id, 'school_audit')}>
                                    Xem Log
                                  </button>
                                  <button type="button" className="button button-secondary" onClick={() => openDispatchNotificationModal(s)}>
                                    Gửi TB
                                  </button>
                                  {s.status === 'active' && (
                                    <button
                                      type="button"
                                      className="button button-primary button-enter-wide"
                                      disabled={Boolean(enteringId)}
                                      onClick={() => handleEnterSchool(s)}
                                    >
                                      <Icon name="arrowRight" size={14} />{' '}
                                      {enteringId === s._id ? 'Đang mở...' : 'Vào không gian trường'}
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* ================================================================
              MỤC 4: NHẬT KÝ TỪNG TRƯỜNG, WEBHOOK & BẢO MẬT SUPERADMIN
             ================================================================ */}
          {activeSection === 'audit' && (
            <SuperAdminAuditPanel
              key={`${auditJumpSchoolId}-${auditJumpLogType}`}
              superUser={superUser}
              schools={schools}
              initialSchoolId={auditJumpSchoolId}
              initialLogType={auditJumpLogType}
              onSuperUserUpdated={(nextUser) => setSuperUser(nextUser)}
            />
          )}

          {/* ================================================================
              MỤC 5: CẤU HÌNH NỀN TẢNG PHÂN PHỐI PHẦN MỀM (PLATFORM SETTINGS)
             ================================================================ */}
          {activeSection === 'settings' && (
            <SuperAdminSettingsPanel
              key={systemSettings?.updatedAt || 'global-settings'}
              initialSettings={systemSettings}
              schools={schools}
              onSaved={(nextSettings) => {
                if (nextSettings) setSystemSettings(nextSettings);
                void load();
              }}
            />
          )}
        </div>
      </main>

      {/* MODAL GỬI THÔNG BÁO HỆ THỐNG ĐÍCH DANH CHO TỪNG TRƯỜNG SỬ DỤNG */}
      {showDispatchModal && createPortal(
        <div
          className="account-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !dispatching) setShowDispatchModal(false);
          }}
        >
          <form
            className="account-modal-card student-form"
            style={{ width: 'min(640px, 96vw)' }}
            autoComplete="off"
            onSubmit={handleDispatchNotification}
          >
            <div className="account-modal-header">
              <div>
                <p className="card-kicker">THÔNG BÁO TỪ ĐƠN VỊ CUNG CẤP PHẦN MỀM XUỐNG TRƯỜNG</p>
                <h2>Gửi thông báo tới trường sử dụng</h2>
              </div>
              <button
                type="button"
                className="button button-secondary modal-close-btn"
                disabled={dispatching}
                onClick={() => setShowDispatchModal(false)}
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <p style={{ margin: '0 0 14px', fontSize: 13, color: '#475569', lineHeight: 1.55 }}>
              Thông báo của trường nào sẽ <strong>chỉ gửi vào Chuông thông báo nội bộ của đúng trường đó</strong> (dành cho Admin &amp; Ban Giám hiệu của trường nhận), tuyệt đối không hiển thị sang các trường khác.
            </p>

            {dispatchError && (
              <div className="account-modal-error" role="alert">
                <Icon name="alertCircle" size={16} />
                <span>{dispatchError}</span>
              </div>
            )}

            <div className="student-form-grid">
              <label>
                Phạm vi gửi thông báo
                <select
                  value={dispatchForm.targetScope}
                  onChange={(e) => setDispatchForm({ ...dispatchForm, targetScope: e.target.value })}
                >
                  <option value="single">Chỉ gửi riêng cho 1 trường được chọn</option>
                  <option value="all">Thông báo bảo trì / nâng cấp chung tất cả trường</option>
                </select>
              </label>

              <label>
                Loại thông báo
                <select
                  value={dispatchForm.type}
                  onChange={(e) => setDispatchForm({ ...dispatchForm, type: e.target.value })}
                >
                  <option value="system">Thông báo cấp phép / nâng cấp tính năng</option>
                  <option value="warning">Lưu ý hạn mức gói / bảo trì kỹ thuật</option>
                </select>
              </label>

              {dispatchForm.targetScope === 'single' && (
                <label className="form-wide">
                  Chọn đơn vị trường nhận thông báo *
                  <select
                    required
                    value={dispatchForm.schoolId}
                    onChange={(e) => setDispatchForm({ ...dispatchForm, schoolId: e.target.value })}
                  >
                    {schools.map((s) => (
                      <option key={s._id} value={s._id}>
                        [{s.code}] {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="form-wide">
                Tiêu đề thông báo *
                <input
                  required
                  maxLength={160}
                  placeholder="VD: Thông báo nâng hạn mức học sinh / Cập nhật phân hệ mới"
                  value={dispatchForm.title}
                  onChange={(e) => setDispatchForm({ ...dispatchForm, title: e.target.value })}
                />
              </label>

              <label className="form-wide">
                Nội dung chi tiết gửi Ban Quản trị trường *
                <textarea
                  required
                  maxLength={1500}
                  placeholder="Nhập nội dung thông báo dành riêng cho trường..."
                  value={dispatchForm.message}
                  onChange={(e) => setDispatchForm({ ...dispatchForm, message: e.target.value })}
                />
              </label>
            </div>

            <div className="account-modal-actions">
              <button type="button" className="button button-secondary" disabled={dispatching} onClick={() => setShowDispatchModal(false)}>
                Hủy
              </button>
              <button type="submit" className="button button-primary" disabled={dispatching}>
                <Icon name="send" size={15} /> {dispatching ? 'Đang gửi...' : 'Gửi thông báo xuống trường'}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

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

      {/* MODAL QUẢN LÝ CHI TIẾT ACCOUNT CỦA TỪNG TRƯỜNG */}
      {accountModalSchool && (
        <SuperAdminSchoolAccountsModal
          school={accountModalSchool}
          onClose={() => setAccountModalSchool(null)}
          onChanged={load}
        />
      )}

      {/* MODAL KIỂM TRA NHANH LUỒNG WEBHOOK CHẤM CÔNG / ĐIỂM DANH CỦA TRƯỜNG */}
      {webhookTestSchool && createPortal(
        <div
          className="account-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !webhookTesting) setWebhookTestSchool(null);
          }}
        >
          <form
            className="account-modal-card student-form"
            style={{ width: 'min(620px, 96vw)' }}
            autoComplete="off"
            onSubmit={handleRunSuperWebhookTest}
          >
            <div className="account-modal-header">
              <div>
                <p className="card-kicker">KIỂM TRA ĐỒNG BỘ MÁY CHẤM CÔNG & ĐIỂM DANH HỌC SINH</p>
                <h2>Test Webhook: {webhookTestSchool.name} ({webhookTestSchool.code})</h2>
              </div>
              <button
                type="button"
                className="button button-secondary modal-close-btn"
                disabled={webhookTesting}
                onClick={() => setWebhookTestSchool(null)}
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <p style={{ margin: '0 0 14px', fontSize: 13, color: '#475569', lineHeight: 1.55 }}>
              Gửi thử sự kiện quẹt khuôn mặt vào endpoint <code>/api/attendance/webhook/{webhookTestSchool.code}</code>. Nếu mã khớp <code>studentCode</code> sẽ ghi vào <strong>Điểm danh Học sinh</strong>; nếu khớp <code>employeeCode</code> / <code>username</code> sẽ ghi vào <strong>Chấm công Nhân sự</strong>.
            </p>

            <div className="student-form-grid">
              <label>
                Mã Học sinh hoặc Mã Nhân viên trên máy *
                <input
                  required
                  autoComplete="off"
                  placeholder="VD: HS-2026-000001 hoặc EMP-0001"
                  value={webhookTestCode}
                  onChange={(e) => setWebhookTestCode(e.target.value)}
                />
              </label>
              <label>
                Họ tên hiển thị (tùy chọn)
                <input
                  autoComplete="off"
                  placeholder="VD: Bé Nguyễn An"
                  value={webhookTestName}
                  onChange={(e) => setWebhookTestName(e.target.value)}
                />
              </label>
            </div>

            {webhookTestResult && (
              <div
                style={{
                  marginTop: 16,
                  padding: '12px 15px',
                  borderRadius: 12,
                  border: `1px solid ${webhookTestResult.error ? '#fecdd3' : '#86efac'}`,
                  background: webhookTestResult.error ? '#fff1f2' : '#f0fdf4',
                  color: webhookTestResult.error ? '#be123c' : '#14532d',
                  fontSize: 13
                }}
              >
                <strong>{webhookTestResult.error ? '⚠ Kết quả:' : `✓ Đã xử lý tại ${webhookTestResult.endpointPath}:`}</strong>
                <div style={{ marginTop: 4 }}>{webhookTestResult.processingNote}</div>
              </div>
            )}

            <div className="account-modal-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  const id = webhookTestSchool._id;
                  setWebhookTestSchool(null);
                  openSchoolLogs(id, 'webhook');
                }}
              >
                Xem Nhật ký Webhook trường này
              </button>
              <button type="submit" className="button button-primary" disabled={webhookTesting}>
                <Icon name="send" size={15} /> {webhookTesting ? 'Đang gửi...' : 'Gửi sự kiện Test'}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {/* MODAL KHỞI TẠO TRƯỜNG MỚI KÈM HẠN MỨC, ACCOUNT ADMIN RIÊNG & GÓI MODULE */}
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
            style={{ width: 'min(840px, 96vw)' }}
            autoComplete="off"
            onSubmit={handleCreateSchool}
          >
            <div className="account-modal-header">
              <div>
                <p className="card-kicker">KHỞI TẠO TRƯỜNG MỚI, CẤP ACCOUNT ADMIN & WEBHOOK</p>
                <h2>Thêm trường học mới vào hệ thống</h2>
              </div>
              <button
                type="button"
                className="button button-secondary modal-close-btn"
                disabled={creating}
                onClick={() => setShowCreateModal(false)}
                aria-label="Đóng"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            {createError && <div className="account-modal-error" role="alert"><Icon name="alertCircle" size={16} /><span>{createError}</span></div>}

            <div className="student-form-grid">
              <label>
                Mã trường (School Code — dùng cho đuôi Webhook) *
                <input
                  required
                  autoComplete="off"
                  maxLength={20}
                  placeholder="VD: HOANANG-B"
                  value={createForm.code}
                  onChange={(e) => setCreateForm({ ...createForm, code: e.target.value.toUpperCase().replace(/\s+/g, '') })}
                />
                {createForm.code && (
                  <small style={{ display: 'block', marginTop: 4, color: '#1d4ed8' }}>
                    Webhook của trường: <code>/api/attendance/webhook/{createForm.code}</code>
                  </small>
                )}
              </label>
              <label>
                Tên trường học *
                <input
                  required
                  autoComplete="off"
                  maxLength={160}
                  placeholder="VD: Trường Mầm non Hoa Nắng - Cơ sở Cầu Giấy"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                />
              </label>
              <label>
                Mã hệ thống / Cụm trường
                <input
                  autoComplete="off"
                  maxLength={40}
                  placeholder="VD: HOA-NANG-GROUP"
                  value={createForm.organizationCode}
                  onChange={(e) => setCreateForm({ ...createForm, organizationCode: e.target.value.toUpperCase() })}
                />
              </label>
              <label>
                Email văn phòng trường (không tự điền tài khoản cá nhân)
                <input
                  type="email"
                  name="school_office_contact_email"
                  autoComplete="off"
                  placeholder="vanphong@hoanang.edu.vn"
                  value={createForm.contactEmail}
                  onChange={(e) => setCreateForm({ ...createForm, contactEmail: e.target.value })}
                />
              </label>
              <label className="form-wide">
                Các Phân hiệu / Cơ sở ban đầu của trường (ngăn cách bằng dấu phẩy)
                <input
                  autoComplete="off"
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
                <legend>Tài khoản Quản trị riêng của trường (Dùng để trường tự tạo Giám đốc, Giáo viên, Đầu bếp...)</legend>
                <div className="student-form-grid" style={{ padding: 0 }}>
                  <label>
                    Tên đăng nhập Admin trường *
                    <input
                      required
                      name="new_school_admin_username"
                      autoComplete="off"
                      placeholder="VD: admin_csb"
                      value={createForm.adminUsername}
                      onChange={(e) => setCreateForm({ ...createForm, adminUsername: e.target.value })}
                    />
                  </label>
                  <label>
                    Họ tên người quản trị trường
                    <input
                      autoComplete="off"
                      placeholder="VD: Nguyễn Thị Minh"
                      value={createForm.adminFullName}
                      onChange={(e) => setCreateForm({ ...createForm, adminFullName: e.target.value })}
                    />
                  </label>
                  <label className="form-wide">
                    Mật khẩu khởi tạo bàn giao cho Admin trường *
                    <div className="password-field-group">
                      <input
                        type={showCreatePass ? 'text' : 'password'}
                        name="new_school_admin_password"
                        autoComplete="new-password"
                        required
                        minLength={6}
                        placeholder="Nhập tối thiểu 6 ký tự hoặc bấm Tạo mật khẩu nhanh"
                        value={createForm.adminPassword}
                        onChange={(e) => setCreateForm({ ...createForm, adminPassword: e.target.value })}
                      />
                      <button type="button" className="password-field-btn" onClick={() => setShowCreatePass((v) => !v)}>
                        <Icon name={showCreatePass ? 'eyeOff' : 'eye'} size={15} /> {showCreatePass ? 'Ẩn' : 'Hiện'}
                      </button>
                      <button
                        type="button"
                        className="password-field-btn"
                        onClick={() => {
                          setCreateForm((prev) => ({ ...prev, adminPassword: generateRandomAdminPassword() }));
                          setShowCreatePass(true);
                        }}
                      >
                        Tạo mật khẩu nhanh
                      </button>
                    </div>
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

            <div className="account-modal-actions">
              <button type="button" className="button button-secondary" disabled={creating} onClick={() => setShowCreateModal(false)}>
                Hủy
              </button>
              <button type="submit" className="button button-primary" disabled={creating}>
                {creating ? 'Đang khởi tạo...' : 'Tạo trường & Cấp tài khoản Admin'}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {/* MODAL CẤU HÌNH ĐỊNH DANH TRƯỜNG, HẠN MỨC, MODULE & ĐẶT LẠI ACCOUNT ADMIN TRƯỜNG */}
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
            style={{ width: 'min(840px, 96vw)' }}
            autoComplete="off"
            onSubmit={handleSaveEdit}
          >
            <div className="account-modal-header">
              <div>
                <p className="card-kicker">CẤU HÌNH CẤP TRƯỜNG, CẤP LẠI ACCOUNT ADMIN & PHÂN HỆ</p>
                <h2>{editingSchool.name} ({editingSchool.code})</h2>
              </div>
              <button
                type="button"
                className="button button-secondary modal-close-btn"
                disabled={savingEdit}
                onClick={() => setEditingSchool(null)}
                aria-label="Đóng"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            {editError && <div className="account-modal-error" role="alert"><Icon name="alertCircle" size={16} /><span>{editError}</span></div>}

            <div className="student-form-grid">
              <label className="form-wide">
                Tên trường pháp lý / hiển thị *
                <input
                  required
                  autoComplete="off"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </label>
              <label>
                Mã cụm / Chuỗi trường
                <input
                  autoComplete="off"
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
                  name="edit_school_office_email"
                  autoComplete="off"
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
                <legend>Tài khoản Admin riêng của trường & Đường dẫn Webhook đồng bộ</legend>
                <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: '#fff', border: '1px solid #cbd5e1', fontSize: 12.5 }}>
                  Đường dẫn đồng bộ máy chấm công & điểm danh học sinh của trường:{' '}
                  <code style={{ fontWeight: 700, color: '#1e3a8a' }}>
                    {window.location.origin}/api/attendance/webhook/{editingSchool.code}
                  </code>
                </div>
                <div className="student-form-grid" style={{ padding: 0 }}>
                  <label>
                    Tên đăng nhập Admin trường
                    <input
                      name="edit_school_admin_username"
                      autoComplete="off"
                      value={editForm.adminUsername}
                      onChange={(e) => setEditForm({ ...editForm, adminUsername: e.target.value })}
                    />
                  </label>
                  <label>
                    Cấp mới / Đặt lại mật khẩu Admin trường (để trống nếu giữ nguyên)
                    <div className="password-field-group">
                      <input
                        type={showEditPass ? 'text' : 'password'}
                        name="edit_school_admin_new_password"
                        autoComplete="new-password"
                        placeholder="Nhập mật khẩu mới (>= 6 ký tự)"
                        value={editForm.newAdminPassword}
                        onChange={(e) => setEditForm({ ...editForm, newAdminPassword: e.target.value })}
                      />
                      <button type="button" className="password-field-btn" onClick={() => setShowEditPass((v) => !v)}>
                        <Icon name={showEditPass ? 'eyeOff' : 'eye'} size={15} /> {showEditPass ? 'Ẩn' : 'Hiện'}
                      </button>
                      <button
                        type="button"
                        className="password-field-btn"
                        onClick={() => {
                          setEditForm((prev) => ({ ...prev, newAdminPassword: generateRandomAdminPassword() }));
                          setShowEditPass(true);
                        }}
                      >
                        Tạo MK mới
                      </button>
                    </div>
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

            <div className="account-modal-actions">
              <button type="button" className="button button-secondary" disabled={savingEdit} onClick={() => setEditingSchool(null)}>
                Hủy
              </button>
              <button type="submit" className="button button-primary" disabled={savingEdit}>
                {savingEdit ? 'Đang lưu...' : 'Lưu cấu hình & Tài khoản trường'}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
}
