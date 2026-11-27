import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import ParentAccountPanel from '../components/ParentAccountPanel';
import StudentProfileChangeRequests from './StudentProfileChangeRequests';
import { createInternalAccount, deactivateInternalAccount, getInternalAccounts, updateInternalAccount } from '../api/systemUsers';
import { getEmployees } from '../api/hr';
import { getStoredTenant, getStoredUser } from '../utils/storage';

const roleOptions = [
  { value: 'principal', label: 'Ban Giám đốc / Hiệu trưởng' },
  { value: 'teacher', label: 'Giáo viên đứng lớp' },
  { value: 'chef', label: 'Đầu bếp / Dinh dưỡng' },
  { value: 'accountant', label: 'Kế toán học phí' },
  { value: 'hr', label: 'Nhân sự & Tiền lương (HR)' },
  { value: 'guard', label: 'Bảo vệ & An ninh cổng' }
];
const statusOptions = { active: 'Đang hoạt động', suspended: 'Tạm ngưng', inactive: 'Đã thu hồi' };
const emptyForm = { existingEmployeeId: '', fullName: '', username: '', password: '', phone: '', email: '', role: 'teacher', status: 'active' };
const mapEmployeeToAccountRole = (emp) => {
  if (emp?.payrollRole && ['principal', 'teacher', 'accountant', 'chef', 'guard', 'hr'].includes(emp.payrollRole)) {
    return emp.payrollRole;
  }
  const byPos = {
    principal: 'principal',
    vice_principal: 'principal',
    teacher: 'teacher',
    head_teacher: 'teacher',
    assistant_teacher: 'teacher',
    accountant: 'accountant',
    chef: 'chef',
    security: 'guard',
    hr: 'hr'
  };
  return byPos[emp?.position] || 'teacher';
};
const formatVnd = (val) => `${new Intl.NumberFormat('vi-VN').format(Number(val || 0))} đ`;

export default function AccountManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentRole = getStoredUser().role;
  const currentUserId = getStoredUser()._id;
  const isAdmin = currentRole === 'admin';
  const canAssignPrincipal = isAdmin;
  const availableRoles = roleOptions.filter((item) => canAssignPrincipal || item.value !== 'principal');

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
  const [unlinkedEmployees, setUnlinkedEmployees] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingAccount, setEditingAccount] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [handoverCredential, setHandoverCredential] = useState(null);
  const [copiedHandover, setCopiedHandover] = useState(false);
  const [modalError, setModalError] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 12, total: 0, totalPages: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
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

  const load = useCallback(async () => {
    const requestId = ++accountRequestRef.current;
    setLoading(true);
    try {
      const response = await getInternalAccounts({
        page,
        limit: 12,
        ...(roleFilter ? { role: roleFilter } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(searchQuery.trim() ? { search: searchQuery.trim() } : {})
      });
      if (requestId !== accountRequestRef.current) return;
      setAccounts(response.data.data || []);
      setPagination(response.data.pagination || { page: 1, limit: 12, total: 0, totalPages: 0 });
    } catch (error) {
      if (requestId !== accountRequestRef.current) return;
      setNotice({ type: 'error', text: error.response?.data?.message || 'Không thể tải danh sách tài khoản.' });
    } finally {
      if (requestId === accountRequestRef.current) {
        setLoading(false);
      }
    }
  }, [page, roleFilter, statusFilter, searchQuery]);

  useEffect(() => {
    if (activeTab !== 'internal') return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, load]);

  const dismissModal = useCallback(() => {
    setShowModal(false);
    setEditingAccount(null);
    setForm(emptyForm);
    setModalError('');
  }, []);

  const closeModal = useCallback(() => {
    if (savingRef.current) return;
    dismissModal();
  }, [dismissModal]);

  const openCreateModal = async (e) => {
    triggerRef.current = e?.currentTarget || document.activeElement;
    setEditingAccount(null);
    setForm(emptyForm);
    setModalError('');
    setShowModal(true);
    try {
      const empRes = await getEmployees();
      const list = (empRes.data?.data || []).filter((emp) => !emp.userId && emp.status !== 'resigned');
      setUnlinkedEmployees(list);
    } catch {
      setUnlinkedEmployees([]);
    }
  };

  const handleSelectExistingEmployee = (employeeId) => {
    if (!employeeId) {
      setForm((current) => ({ ...current, existingEmployeeId: '' }));
      return;
    }
    const matched = unlinkedEmployees.find((emp) => String(emp._id) === String(employeeId));
    if (!matched) return;
    const mappedRole = mapEmployeeToAccountRole(matched);
    const safeRole = (!canAssignPrincipal && mappedRole === 'principal') ? 'teacher' : mappedRole;
    setForm((current) => ({
      ...current,
      existingEmployeeId: matched._id,
      fullName: matched.fullName || current.fullName,
      phone: matched.phone || current.phone,
      email: matched.email || current.email,
      role: safeRole
    }));
  };

  const openEditModal = (account, e) => {
    triggerRef.current = e?.currentTarget || document.activeElement;
    setEditingAccount(account);
    setForm({
      fullName: account.profile?.fullName || '',
      username: account.username,
      password: '',
      phone: account.profile?.phone || '',
      email: account.profile?.email || '',
      role: account.role,
      status: account.status
    });
    setModalError('');
    setShowModal(true);
  };

  // Lock body scroll and manage focus trap when modal is open
  useEffect(() => {
    if (showModal) {
      if (!triggerRef.current) {
        triggerRef.current = document.activeElement;
      }
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      const focusableSelector =
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

      const focusTimer = setTimeout(() => {
        if (modalRef.current) {
          const focusables = modalRef.current.querySelectorAll(focusableSelector);
          if (focusables.length > 0) {
            focusables[0].focus();
          } else {
            modalRef.current.focus();
          }
        }
      }, 50);

      const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          if (!savingRef.current) {
            closeModal();
          }
          return;
        }

        if (e.key === 'Tab' && modalRef.current) {
          const focusables = Array.from(modalRef.current.querySelectorAll(focusableSelector));
          if (!focusables.length) {
            e.preventDefault();
            return;
          }
          const firstElement = focusables[0];
          const lastElement = focusables[focusables.length - 1];

          if (e.shiftKey) {
            if (document.activeElement === firstElement || !modalRef.current.contains(document.activeElement)) {
              e.preventDefault();
              lastElement.focus();
            }
          } else {
            if (document.activeElement === lastElement || !modalRef.current.contains(document.activeElement)) {
              e.preventDefault();
              firstElement.focus();
            }
          }
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => {
        clearTimeout(focusTimer);
        document.body.style.overflow = originalOverflow;
        window.removeEventListener('keydown', handleKeyDown);
        if (triggerRef.current && typeof triggerRef.current.focus === 'function') {
          triggerRef.current.focus();
        }
      };
    }
  }, [showModal, closeModal]);

  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const generateQuickPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let pass = 'Hn@';
    for (let i = 0; i < 6; i += 1) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setForm((current) => ({ ...current, password: pass }));
    setShowPassword(true);
  };

  const copyHandoverInfo = async () => {
    if (!handoverCredential) return;
    const text = [
      `Trường: ${handoverCredential.schoolName}${handoverCredential.schoolCode ? ` (${handoverCredential.schoolCode})` : ''}`,
      `Họ tên: ${handoverCredential.fullName}`,
      `Vai trò: ${handoverCredential.roleLabel}`,
      `Tên đăng nhập: ${handoverCredential.username}`,
      `Mật khẩu: ${handoverCredential.password}`,
      `Đường dẫn đăng nhập: ${window.location.origin}/login`
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedHandover(true);
      window.setTimeout(() => setCopiedHandover(false), 2500);
    } catch {
      // Bỏ qua nếu trình duyệt chặn clipboard
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setModalError('');
    const currentSchool = getStoredTenant() || {};
    const roleLabel = roleOptions.find((r) => r.value === form.role)?.label || form.role;
    try {
      if (editingAccount) {
        const payload = {
          username: form.username.trim(),
          role: form.role,
          status: form.status,
          profile: { fullName: form.fullName.trim(), phone: form.phone.trim(), email: form.email.trim() }
        };
        if (form.password) payload.password = form.password;
        await updateInternalAccount(editingAccount._id, payload);
        if (form.password) {
          setHandoverCredential({
            schoolCode: currentSchool.code || getStoredUser()?.schoolCode || '',
            schoolName: currentSchool.name || 'Nhà trường',
            fullName: form.fullName.trim(),
            username: form.username.trim(),
            password: form.password,
            roleLabel
          });
        }
        setNotice({ type: 'success', text: `Đã cập nhật tài khoản @${form.username.trim()}.` });
      } else {
        const createRes = await createInternalAccount({
          username: form.username.trim(),
          password: form.password,
          role: form.role,
          ...(form.existingEmployeeId ? { existingEmployeeId: form.existingEmployeeId } : {}),
          profile: { fullName: form.fullName.trim(), phone: form.phone.trim(), email: form.email.trim() }
        });
        const createdAccount = createRes.data?.data;
        if (createdAccount?._id) {
          setHighlightedAccountId(createdAccount._id);
        }
        setHandoverCredential({
          schoolCode: currentSchool.code || getStoredUser()?.schoolCode || '',
          schoolName: currentSchool.name || 'Nhà trường',
          fullName: form.fullName.trim(),
          username: form.username.trim(),
          password: form.password,
          roleLabel
        });
        setNotice({
          type: 'success',
          text: form.existingEmployeeId
            ? `Đã tạo tài khoản @${form.username.trim()} (${roleLabel}) và liên kết hồ sơ nhân sự ${createdAccount?.employeeId || ''}.`
            : `Đã tạo tài khoản @${form.username.trim()} (${roleLabel}) kèm hồ sơ nhân sự mới.`
        });
      }
      setShowPassword(false);
      dismissModal();
      if (page !== 1) setPage(1);
      else await load();
    } catch (error) {
      setModalError(error.response?.data?.message || 'Không thể lưu tài khoản. Vui lòng kiểm tra lại thông tin.');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (account) => {
    if (!window.confirm(`Thu hồi quyền truy cập của @${account.username}? Hồ sơ và lịch sử vẫn được giữ lại.`)) return;
    setSaving(true);
    setNotice(null);
    try {
      await deactivateInternalAccount(account._id, 'Thu hồi quyền từ quản trị tài khoản');
      setNotice({ type: 'success', text: `Đã thu hồi quyền truy cập của @${account.username}.` });
      await load();
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.message || 'Không thể thu hồi tài khoản.' });
    } finally {
      setSaving(false);
    }
  };

  const activeCountOnPage = accounts.filter((account) => account.status === 'active').length;
  const pendingStaffCountOnPage = accounts.filter((account) => !account.employeeId && account.status === 'active').length;

  return (
    <AppShell
      title="Tài khoản & phân quyền"
      subtitle={
        currentRole === 'hr'
          ? 'Cấp và quản lý tài khoản nhân viên theo đúng vai trò.'
          : 'Cấp tài khoản nội bộ, duyệt đăng ký phụ huynh, phê duyệt cập nhật hồ sơ và kiểm soát truy cập theo đúng vai trò.'
      }
    >
      {notice && (
        <div className={`timekeeping-notice ${notice.type}`}>
          <Icon name={notice.type === 'success' ? 'check' : 'shield'} size={17} />
          {notice.text}
        </div>
      )}

      {handoverCredential && (
        <div className="credential-handover-card">
          <div>
            <h3>✓ Phiếu bàn giao tài khoản nhân sự vừa cấp ({handoverCredential.roleLabel})</h3>
            <div className="credential-handover-grid">
              <span>Nhân sự: <strong>{handoverCredential.fullName}</strong></span>
              <span>Tên đăng nhập: <code>{handoverCredential.username}</code></span>
              <span>Mật khẩu: <code>{handoverCredential.password}</code></span>
              {handoverCredential.schoolCode && (
                <span>Mã trường: <code>{handoverCredential.schoolCode}</code></span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button type="button" className="button button-primary" onClick={copyHandoverInfo}>
              <Icon name="copy" size={15} /> {copiedHandover ? 'Đã sao chép!' : 'Sao chép gửi nhân sự'}
            </button>
            <button type="button" className="button button-secondary" onClick={() => setHandoverCredential(null)}>
              Ẩn
            </button>
          </div>
        </div>
      )}

      <section className="account-hero">
        <div>
          <p className="card-kicker">QUẢN TRỊ TRUY CẬP</p>
          <h2>Quản lý tài khoản tập trung</h2>
          <p>
            Mỗi tài khoản có một vai trò duy nhất. Toàn bộ tài khoản nội bộ được quản lý tập trung và phân trang rõ ràng.
          </p>
        </div>
        <div className="account-hero-metrics">
          <span>
            <b>{activeCountOnPage}</b> đang hoạt động trên trang này
          </span>
          <span>
            <b>{pendingStaffCountOnPage}</b> chờ gắn hồ sơ trên trang này
          </span>
        </div>
      </section>

      {isAdmin && (
        <div className="account-tabs" role="tablist">
          <button
            type="button"
            className={activeTab === 'internal' ? 'active' : ''}
            onClick={() => setTab('internal')}
          >
            <Icon name="shield" size={16} />
            Tài khoản nội bộ
          </button>
          <button
            type="button"
            className={activeTab === 'parents' ? 'active' : ''}
            onClick={() => setTab('parents')}
          >
            <Icon name="users" size={16} />
            Duyệt tài khoản phụ huynh
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
              <p className="card-kicker">YÊU CẦU TỪ BÊN NGOÀI</p>
              <h2>Duyệt tài khoản phụ huynh</h2>
              <p>Kiểm tra thông tin, liên kết con và kích hoạt quyền truy cập trong một luồng.</p>
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
          <section className="content-card account-list-card full-width">
            <div className="card-heading account-list-header">
              <div>
                <p className="card-kicker">DANH SÁCH TÀI KHOẢN ĐƠN VỊ TRƯỜNG</p>
                <h2>{pagination.total} tài khoản nội bộ</h2>
              </div>
              <div className="account-header-actions">
                <span className="history-count">{activeCountOnPage} hoạt động trên trang này</span>
                <button
                  type="button"
                  className="button button-primary account-create-btn"
                  onClick={openCreateModal}
                >
                  <Icon name="plus" size={16} />
                  Tạo tài khoản nhân sự
                </button>
              </div>
            </div>

            <div style={{ padding: '0 23px 16px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
              <label className="search-box" style={{ flex: '1 1 260px' }}>
                <Icon name="search" size={16} />
                <input
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Tìm theo họ tên hoặc @username..."
                />
              </label>
              <select
                value={roleFilter}
                onChange={(e) => {
                  setRoleFilter(e.target.value);
                  setPage(1);
                }}
                style={{ height: 39, padding: '0 12px', borderRadius: 9, border: '1px solid #cbd5e1', background: '#fff', fontSize: 12.5, fontWeight: 600, color: '#334155' }}
              >
                <option value="">Tất cả vai trò trong trường</option>
                <option value="admin">Quản trị viên trường (Admin)</option>
                {roleOptions.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                style={{ height: 39, padding: '0 12px', borderRadius: 9, border: '1px solid #cbd5e1', background: '#fff', fontSize: 12.5, fontWeight: 600, color: '#334155' }}
              >
                <option value="">Tất cả trạng thái</option>
                <option value="active">Đang hoạt động</option>
                <option value="suspended">Tạm ngưng</option>
                <option value="inactive">Đã thu hồi</option>
              </select>
            </div>

            {loading ? (
              <div className="inline-loader">
                <span className="loading-orb" />
                Đang tải tài khoản...
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table account-table">
                  <thead>
                    <tr>
                      <th>Nhân sự &amp; Liên hệ</th>
                      <th>Tên đăng nhập</th>
                      <th>Vai trò phân quyền</th>
                      <th>Mã nhân sự</th>
                      <th>Đăng nhập gần nhất</th>
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
                        return (
                          <tr
                            key={account._id}
                            className={account._id === highlightedAccountId ? 'account-row-new' : ''}
                          >
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                                <span
                                  className="avatar"
                                  style={
                                    account.role === 'admin'
                                      ? { background: '#2563eb', color: '#fff', width: 35, height: 35 }
                                      : { width: 35, height: 35 }
                                  }
                                >
                                  {avatarLetter}
                                </span>
                                <div>
                                  <div className="account-name-cell">
                                    <strong>{account.profile?.fullName || account.username}</strong>
                                    {account._id === highlightedAccountId && (
                                      <span className="account-new-pill">Mới tạo</span>
                                    )}
                                  </div>
                                  <small>{[account.profile?.phone, account.profile?.email].filter(Boolean).join(' · ') || 'Chưa có SĐT / Email'}</small>
                                </div>
                              </div>
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <code style={{ padding: '3px 8px', borderRadius: 6, background: '#f1f5f9', color: '#1e3a8a', fontWeight: 700, fontSize: 12.5 }}>
                                @{account.username}
                              </code>
                            </td>
                            <td>
                              <span className={`account-role-badge role-${account.role}`}>
                                {account.role === 'admin'
                                  ? 'Admin riêng của trường'
                                  : roleOptions.find((role) => role.value === account.role)?.label || account.role}
                              </span>
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {account.role === 'admin' ? (
                                <span style={{ color: '#3730a3', fontWeight: 700, fontSize: 12 }}>Quản trị trường</span>
                              ) : account.employeeId ? (
                                <code style={{ fontWeight: 700, color: '#0f172a' }}>{account.employeeId}</code>
                              ) : (
                                <span className="account-unlinked">Chưa liên kết</span>
                              )}
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
                        <td colSpan="7" className="history-empty" style={{ textAlign: 'center', padding: '28px 16px' }}>
                          Không có tài khoản nội bộ nào khớp bộ lọc.
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
              Có thể sửa tài khoản đã liên kết hồ sơ nhân sự tại đây. Vai trò và thông tin liên hệ sẽ đồng bộ sang hồ sơ nhân sự; lương vẫn quản lý tại mục <b>Nhân sự & Lương</b>.
            </p>
          </section>
        </div>
      )}

      {/* Modal Tạo/Sửa Tài Khoản dùng React Portal */}
      {showModal &&
        createPortal(
          <div className="modal-backdrop account-modal-backdrop" onClick={closeModal} role="presentation">
            <section
              className="content-card account-modal-card"
              ref={modalRef}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="account-modal-title"
              tabIndex={-1}
            >
              <div className="card-heading account-modal-header">
                <div>
                  <p className="card-kicker">{editingAccount ? 'CẬP NHẬT TÀI KHOẢN' : 'CẤP TÀI KHOẢN NỘI BỘ'}</p>
                  <h2 id="account-modal-title">{editingAccount ? 'Chỉnh sửa tài khoản' : 'Tạo tài khoản nhân sự'}</h2>
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

              <p className="account-form-note">
                {editingAccount
                  ? 'Thông tin họ tên, liên hệ và vai trò sẽ đồng bộ với hồ sơ nhân sự đã liên kết. Nếu giáo viên đang phụ trách lớp, hãy chuyển phân công lớp trước khi đổi vai trò.'
                  : 'Mỗi tài khoản có một vai trò và được tạo cùng hồ sơ nhân sự. Lương mặc định là 0 cho tới khi HR thiết lập. Phụ huynh đăng ký ở trang riêng.'}
              </p>

              <form className="student-form account-modal-form" autoComplete="off" onSubmit={submit}>
                <div className="student-form-grid">
                  {!editingAccount && unlinkedEmployees.length > 0 && (
                    <label className="form-wide">
                      Gắn với hồ sơ nhân sự có sẵn (giữ nguyên mức lương & mã NV)
                      <select
                        value={form.existingEmployeeId || ''}
                        onChange={(event) => handleSelectExistingEmployee(event.target.value)}
                      >
                        <option value="">-- Tạo mới hồ sơ nhân sự (mức lương khởi tạo 0 đ) --</option>
                        {unlinkedEmployees.map((emp) => (
                          <option key={emp._id} value={emp._id}>
                            {emp.employeeCode} — {emp.fullName}
                            {emp.salaryConfig?.baseSalary > 0 ? ` · Lương: ${formatVnd(emp.salaryConfig.baseSalary)}` : ' · Chưa đặt lương'}
                          </option>
                        ))}
                      </select>
                      <small>Chọn nhân sự có sẵn để tránh tạo trùng hồ sơ nhân viên 0đ khi tính bảng lương.</small>
                    </label>
                  )}
                  <label>
                    Họ và tên *
                    <input
                      autoComplete="off"
                      value={form.fullName}
                      onChange={(event) => setField('fullName', event.target.value)}
                      placeholder="Nhập họ và tên đầy đủ"
                      required
                    />
                  </label>
                  <label>
                    Tên đăng nhập *
                    <input
                      autoComplete="off"
                      value={form.username}
                      onChange={(event) => setField('username', event.target.value)}
                      placeholder="Ví dụ: giamdoc_cs1, giaovien_mam1, daubep01"
                      minLength="3"
                      maxLength="50"
                      required
                    />
                  </label>
                  <label>
                    Số điện thoại
                    <input
                      autoComplete="off"
                      value={form.phone}
                      onChange={(event) => setField('phone', event.target.value)}
                      placeholder="Không bắt buộc"
                    />
                  </label>
                  <label>
                    Email
                    <input
                      type="email"
                      autoComplete="off"
                      value={form.email}
                      onChange={(event) => setField('email', event.target.value)}
                      placeholder="Không bắt buộc"
                    />
                  </label>
                  <label>
                    Vai trò phân quyền trong trường *
                    <select
                      value={form.role}
                      onChange={(event) => setField('role', event.target.value)}
                    >
                      {availableRoles.map((role) => (
                        <option key={role.value} value={role.value}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                    <small>Admin trường cấp tài khoản cho Ban Giám đốc/Hiệu trưởng, Giáo viên, Đầu bếp, Kế toán, Nhân sự, Bảo vệ.</small>
                  </label>
                  {editingAccount && (
                    <label>
                      Trạng thái
                      <select
                        value={form.status}
                        onChange={(event) => setField('status', event.target.value)}
                      >
                        {Object.entries(statusOptions).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="form-wide">
                    {editingAccount ? 'Đặt lại mật khẩu (để trống nếu giữ nguyên)' : 'Mật khẩu khởi tạo (tối thiểu 8 ký tự) *'}
                    <div className="password-field-group">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={form.password}
                        onChange={(event) => setField('password', event.target.value)}
                        minLength={editingAccount && !form.password ? 0 : 8}
                        maxLength="72"
                        placeholder={editingAccount ? 'Để trống nếu không đổi mật khẩu' : 'Nhập tối thiểu 8 ký tự hoặc bấm Tạo nhanh'}
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
                        Tạo mật khẩu chuẩn
                      </button>
                    </div>
                  </label>
                </div>
                <div className="form-actions account-modal-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={closeModal}
                    disabled={saving}
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={saving}
                  >
                    {saving ? 'Đang lưu...' : editingAccount ? 'Lưu thay đổi' : 'Tạo tài khoản'}
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
