import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import QrCodeImage from '../components/QrCodeImage';
import ParentAccountPanel from '../components/ParentAccountPanel';
import StudentProfileChangeRequests from './StudentProfileChangeRequests';
import {
  createInternalAccount,
  deactivateInternalAccount,
  getInternalAccounts,
  updateInternalAccount
} from '../api/systemUsers';
import { getStoredTenant, getStoredUser } from '../utils/storage';
import {
  POSITION_LABELS,
  PROVISIONING_ROLE_GROUPS,
  getEffectivePosition,
  getWorkspaceSummaryForAccount,
  resolveGroupKeyFromRoleAndPosition,
  suggestUsernameFromFullName
} from '../utils/roleWorkspaceConfig';
import './AccountManagement.css';

const statusOptions = {
  active: 'Đang hoạt động',
  suspended: 'Tạm ngưng',
  inactive: 'Đã thu hồi'
};

const QUICK_ROLE_FILTERS = [
  { key: 'all', label: 'Tất cả vai trò', role: '', position: '' },
  { key: 'principal', label: 'Ban Giám hiệu', role: 'principal', position: '' },
  { key: 'youth_leader', label: 'Tổng phụ trách', role: 'teacher', position: 'youth_leader' },
  { key: 'teacher', label: 'Giáo viên & Bảo mẫu', role: 'teacher', position: '' },
  { key: 'accountant', label: 'Kế toán', role: 'accountant', position: '' },
  { key: 'hr', label: 'Nhân sự (HR)', role: 'hr', position: '' },
  { key: 'chef', label: 'Trưởng bếp & Bán trú', role: 'chef', position: '' },
  { key: 'guard', label: 'Nhân viên (Bảo vệ, Y tế, Tạp vụ...)', role: 'guard', position: '' }
];

const mapEmployeePositionToRole = (pos) => {
  if (['principal', 'vice_principal'].includes(pos)) return 'principal';
  if (['youth_leader', 'head_teacher', 'teacher', 'assistant_teacher'].includes(pos)) return 'teacher';
  if (['chief_accountant', 'accountant'].includes(pos)) return 'accountant';
  if (['hr', 'office_admin'].includes(pos)) return 'hr';
  if (['head_chef', 'chef', 'kitchen_helper'].includes(pos)) return 'chef';
  if (['security', 'nurse', 'cleaner', 'maintenance', 'driver'].includes(pos)) return 'guard';
  return 'teacher';
};

const evaluatePasswordStrength = (pwd) => {
  if (!pwd) return { level: 'none', text: 'Chưa nhập mật khẩu' };
  if (pwd.length < 8) return { level: 'weak', text: `Cần thêm ${8 - pwd.length} ký tự (tối thiểu 8 ký tự)` };
  const hasUpper = /[A-Z]/.test(pwd);
  const hasDigit = /[0-9]/.test(pwd);
  const hasSpecial = /[^A-Za-z0-9]/.test(pwd);
  if (pwd.length >= 9 && hasUpper && hasDigit && hasSpecial) {
    return { level: 'strong', text: 'Mật khẩu mạnh, an toàn bàn giao' };
  }
  return { level: 'medium', text: 'Hợp lệ (nên có thêm chữ hoa & ký tự đặc biệt)' };
};

const createInitialForm = (defaultCampus = 'Cơ sở chính') => ({
  sourceMode: 'create_new',
  existingEmployeeId: '',
  employeeCode: '',
  fullName: '',
  username: '',
  usernameManuallyEdited: false,
  password: '',
  phone: '',
  email: '',
  campus: defaultCampus,
  departmentName: '',
  groupKey: 'teacher',
  role: 'teacher',
  position: 'teacher',
  status: 'active'
});

export default function AccountManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const storedUser = getStoredUser();
  const storedTenant = getStoredTenant();
  const currentRole = storedUser.role;
  const currentUserId = storedUser._id;
  const isAdmin = currentRole === 'admin';
  const canAssignPrincipal = isAdmin;
  const defaultCampusName = storedTenant?.name || 'Cơ sở chính';

  const availableRoleGroups = useMemo(
    () => PROVISIONING_ROLE_GROUPS.filter((g) => canAssignPrincipal || !g.adminOnly),
    [canAssignPrincipal]
  );

  const tabParam = searchParams.get('tab');
  const activeTab = useMemo(() => {
    if (isAdmin) {
      if (tabParam === 'parents') return 'parents';
      if (tabParam === 'profile-requests' || tabParam === 'profiles') return 'profile-requests';
      return 'internal';
    }
    return 'internal';
  }, [isAdmin, tabParam]);

  const setTab = (newTab) => {
    const nextParams = new URLSearchParams(searchParams);
    if (newTab === 'internal') {
      nextParams.delete('tab');
    } else {
      nextParams.set('tab', newTab);
    }
    setSearchParams(nextParams);
  };

  const [accounts, setAccounts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [unlinkedEmployees, setUnlinkedEmployees] = useState([]);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [form, setForm] = useState(() => createInitialForm(defaultCampusName));
  const [editingAccount, setEditingAccount] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [handoverCredential, setHandoverCredential] = useState(null);
  const [copiedHandover, setCopiedHandover] = useState(false);
  const [copiedUsernameId, setCopiedUsernameId] = useState('');
  const [modalError, setModalError] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 12, total: 0, totalPages: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [quickFilterKey, setQuickFilterKey] = useState('all');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [highlightedAccountId, setHighlightedAccountId] = useState(null);

  const modalRef = useRef(null);
  const triggerRef = useRef(null);
  const accountRequestRef = useRef(0);
  const savingRef = useRef(false);

  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  const activeQuickFilter = useMemo(
    () => QUICK_ROLE_FILTERS.find((f) => f.key === quickFilterKey) || QUICK_ROLE_FILTERS[0],
    [quickFilterKey]
  );

  const load = useCallback(async () => {
    const requestId = ++accountRequestRef.current;
    setLoading(true);
    try {
      const response = await getInternalAccounts({
        page,
        limit: 12,
        includeMeta: '1',
        ...(activeQuickFilter.role ? { role: activeQuickFilter.role } : {}),
        ...(activeQuickFilter.position ? { position: activeQuickFilter.position } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(searchQuery.trim() ? { search: searchQuery.trim() } : {})
      });
      if (requestId !== accountRequestRef.current) return;
      setAccounts(response.data?.data || []);
      if (response.data?.summary) {
        setSummary(response.data.summary);
      }
      if (Array.isArray(response.data?.unlinkedEmployees)) {
        setUnlinkedEmployees(response.data.unlinkedEmployees);
      }
      setPagination(response.data?.pagination || { page: 1, limit: 12, total: 0, totalPages: 0 });
    } catch (error) {
      if (requestId !== accountRequestRef.current) return;
      setNotice({
        type: 'error',
        text: error.response?.data?.message || 'Không thể tải danh sách tài khoản nhân sự.'
      });
    } finally {
      if (requestId === accountRequestRef.current) {
        setLoading(false);
      }
    }
  }, [page, activeQuickFilter, statusFilter, searchQuery]);

  useEffect(() => {
    if (activeTab !== 'internal') return;
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, load]);

  const dismissModal = useCallback(() => {
    setShowModal(false);
    setEditingAccount(null);
    setForm(createInitialForm(defaultCampusName));
    setCandidateSearch('');
    setModalError('');
  }, [defaultCampusName]);

  const closeModal = useCallback(() => {
    if (savingRef.current) return;
    dismissModal();
  }, [dismissModal]);

  const openCreateModal = (e, defaultSourceMode = 'create_new') => {
    triggerRef.current = e?.currentTarget || document.activeElement;
    setEditingAccount(null);
    const nextForm = createInitialForm(defaultCampusName);
    nextForm.sourceMode = defaultSourceMode === 'link_existing' && unlinkedEmployees.length > 0
      ? 'link_existing'
      : 'create_new';
    setForm(nextForm);
    setCandidateSearch('');
    setModalError('');
    setShowModal(true);
  };

  const handleSelectRoleGroup = (group) => {
    setForm((curr) => {
      const nextPos = group.positions.some((p) => p.value === curr.position)
        ? curr.position
        : group.defaultPosition;
      const autoUsername =
        !editingAccount && !curr.usernameManuallyEdited && curr.fullName.trim()
          ? suggestUsernameFromFullName(curr.fullName, nextPos)
          : curr.username;
      return {
        ...curr,
        groupKey: group.groupKey,
        role: group.role,
        position: nextPos,
        username: autoUsername
      };
    });
  };

  const handleSelectPosition = (positionValue) => {
    setForm((curr) => {
      const autoUsername =
        !editingAccount && !curr.usernameManuallyEdited && curr.fullName.trim()
          ? suggestUsernameFromFullName(curr.fullName, positionValue)
          : curr.username;
      return {
        ...curr,
        position: positionValue,
        username: autoUsername
      };
    });
  };

  const handleSelectExistingEmployee = (emp) => {
    if (!emp) {
      setForm((curr) => ({
        ...curr,
        existingEmployeeId: '',
        employeeCode: ''
      }));
      return;
    }
    const rawRole = mapEmployeePositionToRole(emp.position);
    const safeRole = !canAssignPrincipal && rawRole === 'principal' ? 'teacher' : rawRole;
    const safePos = !canAssignPrincipal && ['principal', 'vice_principal'].includes(emp.position)
      ? 'teacher'
      : (emp.position || 'teacher');
    const groupKey = resolveGroupKeyFromRoleAndPosition(safeRole, safePos);
    const suggestedUser = suggestUsernameFromFullName(emp.fullName, safePos);

    setForm((curr) => ({
      ...curr,
      sourceMode: 'link_existing',
      existingEmployeeId: emp._id,
      employeeCode: emp.employeeCode || '',
      fullName: emp.fullName || '',
      phone: emp.phone || curr.phone,
      email: emp.email || curr.email,
      campus: emp.campus || curr.campus,
      departmentName: emp.departmentName || curr.departmentName,
      groupKey,
      role: safeRole,
      position: safePos,
      username: curr.usernameManuallyEdited && curr.username ? curr.username : suggestedUser
    }));
  };

  const openEditModal = (account, e) => {
    triggerRef.current = e?.currentTarget || document.activeElement;
    setEditingAccount(account);
    const resolvedPos = getEffectivePosition(account) || 'teacher';
    const resolvedGroup = resolveGroupKeyFromRoleAndPosition(account.role, resolvedPos);
    setForm({
      sourceMode: 'create_new',
      existingEmployeeId: '',
      employeeCode: account.employeeId || '',
      fullName: account.profile?.fullName || '',
      username: account.username || '',
      usernameManuallyEdited: true,
      password: '',
      phone: account.profile?.phone || '',
      email: account.profile?.email || '',
      campus: account.campus || defaultCampusName,
      departmentName: account.departmentName || '',
      groupKey: resolvedGroup,
      role: account.role,
      position: resolvedPos,
      status: account.status || 'active'
    });
    setModalError('');
    setShowModal(true);
  };

  useEffect(() => {
    if (!showModal) return undefined;
    if (!triggerRef.current) {
      triggerRef.current = document.activeElement;
    }
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !savingRef.current) {
        closeModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      if (triggerRef.current && typeof triggerRef.current.focus === 'function') {
        triggerRef.current.focus();
      }
    };
  }, [showModal, closeModal]);

  const handleFullNameChange = (value) => {
    setForm((curr) => {
      const nextUsername =
        !editingAccount && !curr.usernameManuallyEdited
          ? suggestUsernameFromFullName(value, curr.position)
          : curr.username;
      return {
        ...curr,
        fullName: value,
        username: nextUsername
      };
    });
  };

  const generateQuickPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let pass = 'Hn@';
    for (let i = 0; i < 6; i += 1) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setForm((current) => ({ ...current, password: pass }));
    setShowPassword(true);
  };

  const copyUsername = async (username, id) => {
    try {
      await navigator.clipboard.writeText(username);
      setCopiedUsernameId(id);
      window.setTimeout(() => setCopiedUsernameId(''), 1800);
    } catch {
      // ignore clipboard block
    }
  };

  const copyHandoverInfo = async () => {
    if (!handoverCredential) return;
    const text = [
      `THÔNG TIN TÀI KHOẢN LÀM VIỆC — ${handoverCredential.schoolName.toUpperCase()}`,
      `• Họ và tên: ${handoverCredential.fullName}`,
      `• Chức danh & Vai trò: ${handoverCredential.positionLabel}`,
      `• Không gian làm việc: ${handoverCredential.homeLabel}`,
      ...(handoverCredential.phone ? [`• Số điện thoại: ${handoverCredential.phone}`] : []),
      ...(handoverCredential.email ? [`• Email: ${handoverCredential.email}`] : []),
      `• Tên đăng nhập: ${handoverCredential.username}`,
      `• Mật khẩu khởi tạo: ${handoverCredential.password}`,
      ...(handoverCredential.schoolCode ? [`• Mã phân hiệu: ${handoverCredential.schoolCode}`] : []),
      `• Đường dẫn đăng nhập: ${window.location.origin}/login`,
      `(Vui lòng đổi mật khẩu cá nhân ngay sau lần đăng nhập đầu tiên)`
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedHandover(true);
      window.setTimeout(() => setCopiedHandover(false), 2500);
    } catch {
      // Bỏ qua nếu trình duyệt chặn clipboard
    }
  };

  const printHandoverSlip = () => {
    window.print();
  };

  const selectedGroupMeta = useMemo(
    () => availableRoleGroups.find((g) => g.groupKey === form.groupKey) || availableRoleGroups[0],
    [availableRoleGroups, form.groupKey]
  );

  const selectedPositionMeta = useMemo(
    () =>
      selectedGroupMeta?.positions.find((p) => p.value === form.position) ||
      selectedGroupMeta?.positions[0] || { value: form.position, label: POSITION_LABELS[form.position] || form.role, duty: '' },
    [selectedGroupMeta, form.position, form.role]
  );

  const filteredCandidates = useMemo(() => {
    const q = candidateSearch.trim().toLowerCase();
    if (!q) return unlinkedEmployees;
    return unlinkedEmployees.filter(
      (emp) =>
        (emp.fullName || '').toLowerCase().includes(q) ||
        (emp.employeeCode || '').toLowerCase().includes(q) ||
        (emp.phone || '').toLowerCase().includes(q)
    );
  }, [unlinkedEmployees, candidateSearch]);

  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;

    const cleanPhone = form.phone.trim();
    const cleanEmail = form.email.trim();
    if (!editingAccount && !cleanPhone) {
      setModalError('Vui lòng nhập Số điện thoại liên hệ của nhân sự để phục vụ liên lạc nội bộ và hỗ trợ tài khoản.');
      return;
    }

    setSaving(true);
    setModalError('');
    const currentSchool = getStoredTenant() || {};
    const positionLabel = POSITION_LABELS[form.position] || selectedPositionMeta.label;

    try {
      if (editingAccount) {
        const payload = {
          username: form.username.trim(),
          role: form.role,
          position: form.position,
          campus: form.campus.trim(),
          departmentName: form.departmentName.trim(),
          status: form.status,
          profile: {
            fullName: form.fullName.trim(),
            phone: cleanPhone,
            email: cleanEmail
          }
        };
        if (form.password) payload.password = form.password;
        await updateInternalAccount(editingAccount._id, payload);
        if (form.password) {
          setHandoverCredential({
            schoolCode: currentSchool.code || storedUser?.schoolCode || '',
            schoolName: currentSchool.name || 'Nhà trường',
            fullName: form.fullName.trim(),
            username: form.username.trim(),
            password: form.password,
            phone: cleanPhone,
            email: cleanEmail,
            positionLabel,
            homeLabel: selectedGroupMeta?.homeLabel || 'Theo đúng vai trò'
          });
        }
        setNotice({
          type: 'success',
          text: `Đã cập nhật tài khoản @${form.username.trim()} (${positionLabel}).`
        });
      } else {
        const createPayload = {
          username: form.username.trim(),
          password: form.password,
          role: form.role,
          position: form.position,
          campus: form.campus.trim(),
          departmentName: form.departmentName.trim(),
          ...(form.sourceMode === 'link_existing' && form.existingEmployeeId
            ? { existingEmployeeId: form.existingEmployeeId }
            : {}),
          ...(form.sourceMode === 'create_new' && form.employeeCode.trim()
            ? { employeeCode: form.employeeCode.trim().toUpperCase() }
            : {}),
          profile: {
            fullName: form.fullName.trim(),
            phone: cleanPhone,
            email: cleanEmail
          }
        };
        const createRes = await createInternalAccount(createPayload);
        const createdAccount = createRes.data?.data;
        if (createdAccount?._id) {
          setHighlightedAccountId(createdAccount._id);
        }
        setHandoverCredential({
          schoolCode: currentSchool.code || storedUser?.schoolCode || '',
          schoolName: currentSchool.name || 'Nhà trường',
          fullName: form.fullName.trim(),
          username: form.username.trim(),
          password: form.password,
          phone: cleanPhone,
          email: cleanEmail,
          employeeCode: createdAccount?.employeeId || form.employeeCode.trim(),
          positionLabel,
          homeLabel: selectedGroupMeta?.homeLabel || 'Theo đúng vai trò'
        });
        setNotice({
          type: 'success',
          text:
            form.sourceMode === 'link_existing' && form.existingEmployeeId
              ? `Đã cấp tài khoản @${form.username.trim()} (${positionLabel}) và liên kết với hồ sơ nhân sự ${createdAccount?.employeeId || ''}.`
              : `Đã cấp tài khoản @${form.username.trim()} (${positionLabel}) kèm hồ sơ nhân sự mới.`
        });
      }
      setShowPassword(false);
      dismissModal();
      if (page !== 1) setPage(1);
      else await load();
    } catch (error) {
      setModalError(
        error.response?.data?.message || 'Không thể lưu tài khoản. Vui lòng kiểm tra lại thông tin vừa nhập.'
      );
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (account) => {
    if (!window.confirm(`Thu hồi quyền đăng nhập của @${account.username} (${account.profile?.fullName || ''})? Hồ sơ nhân sự và lịch sử chấm công vẫn được giữ nguyên.`)) {
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await deactivateInternalAccount(account._id, 'Thu hồi quyền truy cập từ trang Quản trị Tài khoản');
      setNotice({ type: 'success', text: `Đã thu hồi quyền đăng nhập của @${account.username}.` });
      await load();
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.message || 'Không thể thu hồi tài khoản.' });
    } finally {
      setSaving(false);
    }
  };

  const totalAccountsCount = summary?.totalAll ?? pagination.total;
  const activeAccountsCount = summary?.activeCount ?? accounts.filter((a) => a.status === 'active').length;
  const managementCount =
    (summary?.byRole?.principal || 0) + (summary?.byRole?.accountant || 0) + (summary?.byRole?.hr || 0);
  const teachingKitchenCount = (summary?.byRole?.teacher || 0) + (summary?.byRole?.chef || 0);
  const opsStaffCount = summary?.byRole?.guard || 0;
  const unlinkedCount = summary?.unlinkedEmployeeCount ?? unlinkedEmployees.length;
  const pwdStrength = evaluatePasswordStrength(form.password);

  return (
    <AppShell
      title="Cấp phát Tài khoản & Phân quyền Vai trò"
      subtitle={
        currentRole === 'hr'
          ? 'Cấp tài khoản nhân viên, gán đúng chức danh thực tế và tự động phân tách giao diện làm việc cho từng bộ phận.'
          : 'Quản lý tài khoản nhân sự theo đúng chức trách (Ban Giám hiệu, Tổng phụ trách, Giáo viên, Kế toán, HR, Bếp, Bảo vệ, Y tế, Tạp vụ...) và duyệt Phụ huynh.'
      }
      actions={
        activeTab === 'internal' ? (
          <button
            type="button"
            className="button button-primary"
            onClick={(e) => openCreateModal(e, 'create_new')}
          >
            <Icon name="plus" size={16} />
            Cấp tài khoản nhân sự
          </button>
        ) : null
      }
    >
      {notice && (
        <div className={`timekeeping-notice ${notice.type}`}>
          <Icon name={notice.type === 'success' ? 'check' : 'shield'} size={17} />
          {notice.text}
        </div>
      )}

      {/* Phiếu bàn giao đa phương tiện kèm Mã QR đăng nhập */}
      {handoverCredential && (
        <section className="acc-handover-banner" aria-label="Phiếu bàn giao tài khoản nhân sự">
          <div style={{ flex: '1 1 420px' }}>
            <p className="card-kicker" style={{ color: '#047857', margin: 0 }}>
              PHIẾU BÀN GIAO TÀI KHOẢN NHÂN SỰ VỪA CẤP
            </p>
            <h3 style={{ margin: '4px 0 0', fontSize: 17, color: '#0f172a' }}>
              {handoverCredential.fullName} — <span style={{ color: '#1d4ed8' }}>{handoverCredential.positionLabel}</span>
            </h3>
            <div className="acc-handover-meta-grid">
              <span>
                Tên đăng nhập: <code style={{ fontWeight: 800, color: '#1e3a8a' }}>{handoverCredential.username}</code>
              </span>
              <span>
                Mật khẩu khởi tạo: <code style={{ fontWeight: 800, color: '#b45309' }}>{handoverCredential.password}</code>
              </span>
              {handoverCredential.employeeCode && (
                <span>
                  Mã nhân sự: <strong>{handoverCredential.employeeCode}</strong>
                </span>
              )}
              {handoverCredential.phone && (
                <span>
                  Điện thoại: <strong>{handoverCredential.phone}</strong>
                </span>
              )}
              <span>
                Giao diện mở ra: <strong>{handoverCredential.homeLabel}</strong>
              </span>
              <span>
                Đăng nhập tại: <code>{window.location.origin}/login</code>
              </span>
            </div>
          </div>

          <div className="acc-handover-qr-box">
            <div
              style={{
                padding: 6,
                borderRadius: 12,
                background: '#ffffff',
                border: '1px solid #d1fae5',
                textAlign: 'center'
              }}
            >
              <QrCodeImage value={`${window.location.origin}/login`} size={76} label="Mã QR cổng đăng nhập" />
              <small style={{ display: 'block', fontSize: 10, color: '#64748b', marginTop: 2 }}>Quét mở trang</small>
            </div>
            <div style={{ display: 'grid', gap: 7 }}>
              <button type="button" className="button button-primary" onClick={copyHandoverInfo}>
                <Icon name="copy" size={15} />
                {copiedHandover ? 'Đã sao chép nội dung!' : 'Sao chép gửi Zalo / Email'}
              </button>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="button button-secondary" style={{ flex: 1 }} onClick={printHandoverSlip}>
                  In phiếu
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setHandoverCredential(null)}
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {isAdmin && (
        <div className="account-tabs" role="tablist" style={{ marginBottom: 16 }}>
          <button
            type="button"
            className={activeTab === 'internal' ? 'active' : ''}
            onClick={() => setTab('internal')}
          >
            <Icon name="shield" size={16} />
            Tài khoản Nhân sự ({totalAccountsCount})
          </button>
          <button
            type="button"
            className={activeTab === 'parents' ? 'active' : ''}
            onClick={() => setTab('parents')}
          >
            <Icon name="users" size={16} />
            Tài khoản Phụ huynh
          </button>
          <button
            type="button"
            className={activeTab === 'profile-requests' ? 'active' : ''}
            onClick={() => setTab('profile-requests')}
          >
            <Icon name="card" size={16} />
            Duyệt cập nhật hồ sơ
          </button>
        </div>
      )}

      {activeTab === 'parents' && isAdmin && (
        <section className="account-parent-workspace">
          <div className="account-workspace-heading">
            <div>
              <p className="card-kicker">CỔNG GIA ĐÌNH & ĐÓN TRẢ TRẺ</p>
              <h2>Quản lý & Duyệt tài khoản Phụ huynh</h2>
              <p>Cấp tài khoản riêng cho Phụ huynh, liên kết đúng hồ sơ bé đang theo học để mở Sổ chăm sóc, Học phí & Mã QR đón trẻ.</p>
            </div>
          </div>
          <ParentAccountPanel embedded />
        </section>
      )}

      {activeTab === 'profile-requests' && isAdmin && (
        <section className="account-parent-workspace">
          <StudentProfileChangeRequests embedded />
        </section>
      )}

      {activeTab === 'internal' && (
        <div className="account-management-single-column">
          {/* Thanh 4 chỉ số tổng quan toàn phân hiệu */}
          <section className="acc-kpi-strip" aria-label="Tổng quan tài khoản phân hiệu">
            <article className="acc-kpi-card">
              <div>
                <small>Tổng tài khoản nội bộ</small>
                <strong>{totalAccountsCount}</strong>
                <span className="acc-kpi-sub">{activeAccountsCount} tài khoản đang hoạt động</span>
              </div>
              <span className="acc-kpi-icon blue"><Icon name="shield" size={20} /></span>
            </article>

            <article className="acc-kpi-card">
              <div>
                <small>Điều hành, Kế toán & HR</small>
                <strong>{managementCount}</strong>
                <span className="acc-kpi-sub">Hiệu trưởng · Kế toán · Nhân sự</span>
              </div>
              <span className="acc-kpi-icon violet"><Icon name="chart" size={20} /></span>
            </article>

            <article className="acc-kpi-card">
              <div>
                <small>Chuyên môn & Bán trú</small>
                <strong>{teachingKitchenCount}</strong>
                <span className="acc-kpi-sub">Tổng phụ trách · Giáo viên · Bếp</span>
              </div>
              <span className="acc-kpi-icon amber"><Icon name="students" size={20} /></span>
            </article>

            <article className="acc-kpi-card">
              <div>
                <small>Nhân viên Vận hành</small>
                <strong>{opsStaffCount}</strong>
                <span className="acc-kpi-sub">Bảo vệ · Y tế · Lao công · Kỹ thuật</span>
              </div>
              <span className="acc-kpi-icon teal"><Icon name="users" size={20} /></span>
            </article>
          </section>

          {/* Gợi ý 1 chạm nếu còn hồ sơ nhân sự chưa có tài khoản đăng nhập */}
          {unlinkedCount > 0 && (
            <div className="acc-unlinked-banner">
              <div>
                <strong>Phát hiện {unlinkedCount} hồ sơ nhân sự chưa được cấp tài khoản đăng nhập</strong>
                <p>
                  Bao gồm nhân sự mới nhập hoặc vừa kéo từ máy chấm công khuôn mặt về Web. Bạn có thể bấm chọn để cấp tài khoản ngay mà không cần gõ lại thông tin.
                </p>
              </div>
              <button
                type="button"
                className="button button-primary"
                onClick={(e) => openCreateModal(e, 'link_existing')}
              >
                <Icon name="users" size={16} />
                Chọn nhân sự & Cấp tài khoản ({unlinkedCount})
              </button>
            </div>
          )}

          <section className="content-card account-list-card full-width">
            <div className="card-heading account-list-header">
              <div>
                <p className="card-kicker">PHÂN QUYỀN TÁCH BIỆT THEO CHỨC TRÁCH</p>
                <h2>Danh sách Tài khoản Nhân sự ({pagination.total})</h2>
              </div>
              <div className="account-header-actions">
                <button
                  type="button"
                  className="button button-primary account-create-btn"
                  onClick={(e) => openCreateModal(e, 'create_new')}
                >
                  <Icon name="plus" size={16} />
                  Cấp tài khoản nhân sự
                </button>
              </div>
            </div>

            {/* Thanh tìm kiếm đa năng */}
            <div style={{ padding: '14px 23px 10px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
              <label className="search-box" style={{ flex: '1 1 280px' }}>
                <Icon name="search" size={16} />
                <input
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Tìm theo Họ tên, @username, Số điện thoại, Email hoặc Mã nhân sự..."
                />
              </label>

              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                style={{
                  height: 39,
                  padding: '0 12px',
                  borderRadius: 9,
                  border: '1px solid #cbd5e1',
                  background: '#fff',
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: '#334155'
                }}
              >
                <option value="">Tất cả trạng thái</option>
                <option value="active">Đang hoạt động</option>
                <option value="suspended">Tạm ngưng</option>
                <option value="inactive">Đã thu hồi</option>
              </select>
            </div>

            {/* Dải Chip lọc nhanh theo từng nhóm chức năng */}
            <div className="acc-role-chips" role="tablist" aria-label="Lọc nhanh theo nhóm vai trò">
              {QUICK_ROLE_FILTERS.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  className={`acc-role-chip ${quickFilterKey === chip.key ? 'active' : ''}`}
                  onClick={() => {
                    setQuickFilterKey(chip.key);
                    setPage(1);
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="inline-loader">
                <span className="loading-orb" />
                Đang tải danh sách tài khoản...
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table account-table">
                  <thead>
                    <tr>
                      <th>Nhân sự &amp; Mã định danh</th>
                      <th>Điện thoại &amp; Email liên hệ</th>
                      <th>Chức danh &amp; Giao diện được cấp</th>
                      <th>Tài khoản đăng nhập</th>
                      <th>Hoạt động</th>
                      <th>Trạng thái</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.length ? (
                      accounts.map((account) => {
                        const avatarLetter = String(account.profile?.fullName || account.username || 'U')
                          .trim()
                          .charAt(0)
                          .toUpperCase();
                        const wsSummary = getWorkspaceSummaryForAccount(account);
                        const hasPhone = Boolean(account.profile?.phone);
                        const hasEmail = Boolean(account.profile?.email);

                        return (
                          <tr
                            key={account._id}
                            className={account._id === highlightedAccountId ? 'account-row-new' : ''}
                          >
                            <td>
                              <div className="acc-person-cell">
                                {account.faceDataUrl ? (
                                  <img
                                    src={account.faceDataUrl}
                                    alt={account.profile?.fullName || account.username}
                                    className="acc-face-thumb"
                                  />
                                ) : (
                                  <span className={`acc-avatar-fallback tone-${wsSummary.tone}`}>
                                    {avatarLetter}
                                  </span>
                                )}
                                <div>
                                  <div className="account-name-cell">
                                    <strong>{account.profile?.fullName || account.username}</strong>
                                    {account._id === highlightedAccountId && (
                                      <span className="account-new-pill">Vừa cấp</span>
                                    )}
                                  </div>
                                  <div className="acc-meta-line">
                                    {account.role === 'admin' ? (
                                      <span className="acc-emp-code">Quản trị hệ thống</span>
                                    ) : account.employeeId ? (
                                      <span className="acc-emp-code">Mã NV: {account.employeeId}</span>
                                    ) : (
                                      <span className="account-unlinked">Chưa gắn mã NV</span>
                                    )}
                                    {account.campus && <span>· {account.campus}</span>}
                                    {account.departmentName && <span>· {account.departmentName}</span>}
                                  </div>
                                </div>
                              </div>
                            </td>

                            <td>
                              <div className="acc-contact-stack">
                                {hasPhone ? (
                                  <span className="acc-contact-item">{account.profile.phone}</span>
                                ) : (
                                  <span className="acc-contact-missing">Chưa có SĐT</span>
                                )}
                                {hasEmail ? (
                                  <span className="acc-contact-sub">{account.profile.email}</span>
                                ) : (
                                  <span className="acc-contact-missing">Chưa cập nhật Email</span>
                                )}
                              </div>
                            </td>

                            <td>
                              <span className={`acc-position-pill tone-${wsSummary.tone}`}>
                                {wsSummary.badgeLabel}
                              </span>
                              <span className="acc-workspace-caption">{wsSummary.workspaceLabel}</span>
                            </td>

                            <td style={{ whiteSpace: 'nowrap' }}>
                              <button
                                type="button"
                                className="acc-username-btn"
                                title="Bấm để sao chép tên đăng nhập"
                                onClick={() => copyUsername(account.username, account._id)}
                              >
                                @{account.username}
                                <Icon name={copiedUsernameId === account._id ? 'check' : 'copy'} size={12} />
                              </button>
                            </td>

                            <td style={{ whiteSpace: 'nowrap', fontSize: 12, color: '#64748b' }}>
                              {account.lastLogin
                                ? new Date(account.lastLogin).toLocaleString('vi-VN', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  })
                                : 'Chưa đăng nhập'}
                            </td>

                            <td>
                              <span
                                className={`student-status ${
                                  account.status === 'active' ? 'enrolled' : 'temporarily_absent'
                                }`}
                              >
                                {statusOptions[account.status] || account.status}
                              </span>
                            </td>

                            <td>
                              <div className="account-row-actions">
                                <button
                                  type="button"
                                  className="button button-secondary"
                                  onClick={(e) => openEditModal(account, e)}
                                  disabled={
                                    saving ||
                                    account.role === 'admin' ||
                                    String(account._id) === String(currentUserId) ||
                                    (['principal', 'hr'].includes(currentRole) && account.role === 'principal')
                                  }
                                >
                                  Sửa / Đổi MK
                                </button>
                                <button
                                  type="button"
                                  className="button button-danger"
                                  onClick={() => deactivate(account)}
                                  disabled={
                                    saving ||
                                    account.status === 'inactive' ||
                                    account.role === 'admin' ||
                                    String(account._id) === String(currentUserId) ||
                                    (['principal', 'hr'].includes(currentRole) && account.role === 'principal')
                                  }
                                >
                                  Thu hồi
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan="7" className="history-empty" style={{ textAlign: 'center', padding: '32px 16px' }}>
                          Không tìm thấy tài khoản nhân sự nào khớp với bộ lọc hiện tại.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {pagination.totalPages > 1 && (
              <div className="account-pagination">
                <span>
                  Hiển thị {(pagination.page - 1) * pagination.limit + 1}–
                  {Math.min(pagination.page * pagination.limit, pagination.total)} / {pagination.total} tài khoản
                </span>
                <div>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage((current) => current - 1)}
                  >
                    ← Trang trước
                  </button>
                  <strong>
                    Trang {pagination.page}/{pagination.totalPages}
                  </strong>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={page >= pagination.totalPages || loading}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    Trang sau →
                  </button>
                </div>
              </div>
            )}

            <p className="account-list-hint">
              Mỗi chức danh được định tuyến sang không gian giao diện riêng biệt ngay khi đăng nhập (Bảo vệ vào Trực cổng, Y tế/Lao công vào Cổng Nhân viên vận hành, Trưởng bếp vào Bếp bán trú, Giáo viên vào Lớp học...). Mức lương được bảo mật riêng tại phân hệ <b>Nhân sự &amp; Tiền lương</b>.
            </p>
          </section>
        </div>
      )}

      {/* MODAL CẤP PHÁT / CHỈNH SỬA TÀI KHOẢN NHÂN SỰ MỚI (Bấm ra ngoài KHÔNG tắt) */}
      {showModal &&
        createPortal(
          <div className="modal-backdrop account-modal-backdrop" role="presentation">
            <section
              className="content-card account-modal-card acc-modal-wide"
              ref={modalRef}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="account-modal-title"
              tabIndex={-1}
            >
              <div className="card-heading account-modal-header">
                <div>
                  <p className="card-kicker">
                    {editingAccount ? 'CẬP NHẬT PHÂN QUYỀN & THÔNG TIN LIÊN HỆ' : 'CẤP PHÁT TÀI KHOẢN THEO CHỨC TRÁCH'}
                  </p>
                  <h2 id="account-modal-title">
                    {editingAccount
                      ? `Chỉnh sửa tài khoản @${editingAccount.username}`
                      : 'Cấp tài khoản nhân sự & Gán giao diện vai trò'}
                  </h2>
                </div>
                <button
                  type="button"
                  className="button button-secondary modal-close-btn"
                  onClick={closeModal}
                  disabled={saving}
                  aria-label="Đóng"
                >
                  <Icon name="close" size={18} />
                </button>
              </div>

              {modalError && (
                <div className="form-error account-modal-error">
                  <Icon name="shield" size={16} />
                  <span>{modalError}</span>
                </div>
              )}

              <form className="student-form account-modal-form" autoComplete="off" onSubmit={submit}>
                {/* KHU 1: CHỌN NGUỒN HỒ SƠ NHÂN SỰ (Tạo mới vs Gắn nhân sự sẵn có — không lộ tiền lương) */}
                {!editingAccount && unlinkedEmployees.length > 0 && (
                  <div>
                    <div className="acc-source-Segment" role="tablist">
                      <button
                        type="button"
                        className={`acc-source-tab ${form.sourceMode === 'create_new' ? 'active' : ''}`}
                        onClick={() =>
                          setForm((curr) => ({
                            ...curr,
                            sourceMode: 'create_new',
                            existingEmployeeId: '',
                            employeeCode: ''
                          }))
                        }
                      >
                        <Icon name="plus" size={15} />
                        Tạo mới nhân sự &amp; tài khoản
                      </button>
                      <button
                        type="button"
                        className={`acc-source-tab ${form.sourceMode === 'link_existing' ? 'active' : ''}`}
                        onClick={() =>
                          setForm((curr) => ({
                            ...curr,
                            sourceMode: 'link_existing'
                          }))
                        }
                      >
                        <Icon name="users" size={15} />
                        Chọn nhân sự sẵn có chưa cấp TK ({unlinkedEmployees.length})
                      </button>
                    </div>

                    {form.sourceMode === 'link_existing' && (
                      <div className="acc-candidate-picker">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 12.5, color: '#1e293b' }}>
                            Chọn nhân viên để tự động điền Họ tên, Mã NV &amp; Chức danh (giữ nguyên hợp đồng nhân sự):
                          </strong>
                          <input
                            type="search"
                            value={candidateSearch}
                            onChange={(e) => setCandidateSearch(e.target.value)}
                            placeholder="Tìm nhanh theo tên, mã NV, SĐT..."
                            style={{
                              width: 240,
                              height: 34,
                              padding: '0 10px',
                              borderRadius: 8,
                              border: '1px solid #cbd5e1',
                              fontSize: 12.5,
                              background: '#fff'
                            }}
                          />
                        </div>

                        <div className="acc-candidate-grid">
                          {filteredCandidates.length ? (
                            filteredCandidates.map((emp) => {
                              const isSelected = String(form.existingEmployeeId) === String(emp._id);
                              return (
                                <button
                                  key={emp._id}
                                  type="button"
                                  className={`acc-candidate-card ${isSelected ? 'selected' : ''}`}
                                  onClick={() => handleSelectExistingEmployee(emp)}
                                >
                                  {emp.faceDataUrl ? (
                                    <img src={emp.faceDataUrl} alt={emp.fullName} className="acc-face-thumb" style={{ width: 36, height: 36 }} />
                                  ) : (
                                    <span className="acc-avatar-fallback tone-blue" style={{ width: 36, height: 36, fontSize: 13 }}>
                                      {(emp.fullName || 'N').charAt(0).toUpperCase()}
                                    </span>
                                  )}
                                  <div style={{ minWidth: 0 }}>
                                    <strong>{emp.fullName}</strong>
                                    <small>
                                      Mã: {emp.employeeCode} · {POSITION_LABELS[emp.position] || 'Nhân sự'}
                                    </small>
                                    {emp.phone && <small>{emp.phone}</small>}
                                  </div>
                                </button>
                              );
                            })
                          ) : (
                            <p style={{ margin: '8px 0', fontSize: 12.5, color: '#64748b' }}>
                              Không tìm thấy nhân sự khớp từ khóa.
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* KHU 2: CHỌN NHÓM VAI TRÒ & CHỨC DANH THỰC TẾ + XEM TRƯỚC GIAO DIỆN */}
                <div>
                  <div className="acc-section-label">
                    <span>1. Chọn Vai trò &amp; Chức trách thực tế trong trường *</span>
                    <span style={{ fontWeight: 600, textTransform: 'none', color: '#2563eb' }}>
                      Đang gán: {selectedPositionMeta.label}
                    </span>
                  </div>

                  <div className="acc-role-selector-layout">
                    <div>
                      <div className="acc-role-cards-grid">
                        {availableRoleGroups.map((group) => {
                          const isSelected = form.groupKey === group.groupKey;
                          return (
                            <button
                              key={group.groupKey}
                              type="button"
                              className={`acc-role-card ${isSelected ? 'selected' : ''}`}
                              onClick={() => handleSelectRoleGroup(group)}
                            >
                              <span className="acc-role-card-icon">
                                <Icon name={group.icon} size={16} />
                              </span>
                              <div>
                                <strong>{group.title}</strong>
                                <small>{group.shortDesc}</small>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {/* Chọn Chức danh cụ thể bên trong nhóm vai trò */}
                      {selectedGroupMeta && (
                        <div className="acc-subposition-box">
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>
                            Chọn vị trí công việc cụ thể của nhân sự (quyết định giao diện hiển thị):
                          </span>
                          <div className="acc-subposition-pills">
                            {selectedGroupMeta.positions.map((pos) => (
                              <button
                                key={pos.value}
                                type="button"
                                className={`acc-subposition-pill ${form.position === pos.value ? 'active' : ''}`}
                                onClick={() => handleSelectPosition(pos.value)}
                              >
                                {pos.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Khung xem trước trực quan không gian giao diện của tài khoản */}
                    {selectedGroupMeta && (
                      <aside className="acc-role-preview-panel" aria-label="Xem trước quyền hạn tài khoản">
                        <div>
                          <span className="card-kicker" style={{ color: '#1d4ed8', margin: 0 }}>
                            GIAO DIỆN SẼ HIỂN THỊ CHO TÀI KHOẢN NÀY
                          </span>
                          <h4>{selectedPositionMeta.label}</h4>
                          <p className="acc-role-preview-duty">{selectedPositionMeta.duty}</p>
                          <ul className="acc-preview-list">
                            {selectedGroupMeta.allowedModules.map((mod) => (
                              <li key={mod}>{mod}</li>
                            ))}
                          </ul>
                        </div>
                        <div className="acc-preview-isolation">
                          <strong>Cách ly bảo mật:</strong> {selectedGroupMeta.isolatedNote}
                        </div>
                      </aside>
                    )}
                  </div>
                </div>

                {/* KHU 3: THÔNG TIN NHÂN SỰ & LIÊN HỆ CẦN THIẾT */}
                <div>
                  <div className="acc-section-label">
                    <span>2. Thông tin Hồ sơ &amp; Liên hệ cần thiết</span>
                  </div>
                  <div className="acc-fields-grid-3">
                    <label>
                      Họ và tên nhân sự *
                      <input
                        autoComplete="off"
                        value={form.fullName}
                        onChange={(e) => handleFullNameChange(e.target.value)}
                        placeholder="Ví dụ: Ngô Thị Phương Thảo"
                        required
                      />
                    </label>

                    <label>
                      Số điện thoại liên hệ {!editingAccount ? '*' : ''}
                      <input
                        type="tel"
                        autoComplete="off"
                        value={form.phone}
                        onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value }))}
                        placeholder="Ví dụ: 0912 345 678"
                        required={!editingAccount}
                      />
                    </label>

                    <label>
                      Email công việc / cá nhân
                      <input
                        type="email"
                        autoComplete="off"
                        value={form.email}
                        onChange={(e) => setForm((c) => ({ ...c, email: e.target.value }))}
                        placeholder="Ví dụ: phuongthao@truong.edu.vn"
                      />
                    </label>
                  </div>

                  <div className="acc-fields-grid-3" style={{ marginTop: 12 }}>
                    <label>
                      Mã nhân sự / Mã máy chấm công
                      <input
                        autoComplete="off"
                        value={form.employeeCode}
                        onChange={(e) => setForm((c) => ({ ...c, employeeCode: e.target.value.toUpperCase() }))}
                        placeholder="Để trống tự cấp (VD: GV012)"
                        disabled={Boolean(editingAccount || (form.sourceMode === 'link_existing' && form.existingEmployeeId))}
                      />
                    </label>

                    <label>
                      Phân hiệu / Cơ sở làm việc
                      <input
                        autoComplete="off"
                        value={form.campus}
                        onChange={(e) => setForm((c) => ({ ...c, campus: e.target.value }))}
                        placeholder="Ví dụ: Cơ sở chính"
                      />
                    </label>

                    <label>
                      Tổ / Bộ phận phụ trách
                      <input
                        autoComplete="off"
                        value={form.departmentName}
                        onChange={(e) => setForm((c) => ({ ...c, departmentName: e.target.value }))}
                        placeholder="VD: Khối Mẫu giáo nhỡ, Tổ Bếp, Tổ An ninh..."
                      />
                    </label>
                  </div>
                </div>

                {/* KHU 4: THÔNG TIN ĐĂNG NHẬP & BẢO MẬT */}
                <div>
                  <div className="acc-section-label">
                    <span>3. Tài khoản đăng nhập &amp; Mật khẩu bàn giao</span>
                  </div>
                  <div className="acc-fields-grid-2">
                    <label>
                      Tên đăng nhập (@username) *
                      <div className="acc-inline-input-btn">
                        <input
                          autoComplete="off"
                          value={form.username}
                          onChange={(e) =>
                            setForm((c) => ({
                              ...c,
                              username: e.target.value,
                              usernameManuallyEdited: true
                            }))
                          }
                          placeholder="Ví dụ: gv.phuongthao"
                          minLength="3"
                          maxLength="50"
                          required
                        />
                        {!editingAccount && (
                          <button
                            type="button"
                            className="password-field-btn"
                            onClick={() =>
                              setForm((c) => ({
                                ...c,
                                username: suggestUsernameFromFullName(c.fullName, c.position),
                                usernameManuallyEdited: false
                              }))
                            }
                            title="Gợi ý tự động theo họ tên & chức danh"
                          >
                            Gợi ý mã
                          </button>
                        )}
                      </div>
                    </label>

                    {editingAccount ? (
                      <label>
                        Trạng thái hoạt động của tài khoản
                        <select
                          value={form.status}
                          onChange={(e) => setForm((c) => ({ ...c, status: e.target.value }))}
                        >
                          {Object.entries(statusOptions).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <div
                        style={{
                          padding: '10px 14px',
                          borderRadius: 11,
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          fontSize: 12,
                          color: '#475569',
                          alignSelf: 'end'
                        }}
                      >
                        Nhân viên chỉ cần nhập <strong>@{form.username || 'username'}</strong> và mật khẩu tại trang đăng nhập; hệ thống tự động mở đúng màn hình <strong>{selectedPositionMeta.label}</strong>.
                      </div>
                    )}
                  </div>

                  <label className="form-wide" style={{ marginTop: 12, display: 'block' }}>
                    {editingAccount
                      ? 'Đặt lại mật khẩu mới (để trống nếu giữ nguyên mật khẩu hiện tại)'
                      : 'Mật khẩu khởi tạo bàn giao (tối thiểu 8 ký tự) *'}
                    <div className="password-field-group">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={form.password}
                        onChange={(e) => setForm((c) => ({ ...c, password: e.target.value }))}
                        minLength={editingAccount && !form.password ? 0 : 8}
                        maxLength="72"
                        placeholder={
                          editingAccount
                            ? 'Để trống nếu không đổi mật khẩu'
                            : 'Nhập tối thiểu 8 ký tự hoặc bấm Tạo mật khẩu mạnh'
                        }
                        required={!editingAccount}
                      />
                      <button
                        type="button"
                        className="password-field-btn"
                        onClick={() => setShowPassword((v) => !v)}
                      >
                        <Icon name={showPassword ? 'eyeOff' : 'eye'} size={15} />
                        {showPassword ? 'Ẩn' : 'Hiện'}
                      </button>
                      <button
                        type="button"
                        className="password-field-btn"
                        onClick={generateQuickPassword}
                      >
                        Tạo mật khẩu mạnh
                      </button>
                    </div>
                    {(form.password || !editingAccount) && (
                      <div className="acc-pwd-meter">
                        <span className={`acc-pwd-bars ${pwdStrength.level}`}>
                          <i />
                          <i />
                          <i />
                        </span>
                        <span style={{ color: pwdStrength.level === 'weak' ? '#dc2626' : '#475569' }}>
                          {pwdStrength.text}
                        </span>
                      </div>
                    )}
                  </label>
                </div>

                <div className="form-actions account-modal-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={closeModal}
                    disabled={saving}
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={saving}
                  >
                    <Icon name="check" size={16} />
                    {saving
                      ? 'Đang xử lý...'
                      : editingAccount
                        ? 'Lưu cập nhật tài khoản'
                        : `Cấp tài khoản ${selectedPositionMeta.label}`}
                  </button>
                </div>
              </form>
            </section>
          </div>,
          document.body
        )}
    </AppShell>
  );
}
