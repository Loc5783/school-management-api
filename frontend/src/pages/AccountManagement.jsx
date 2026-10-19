import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import ParentAccountManagement from './ParentAccountManagement';
import StudentProfileChangeRequests from './StudentProfileChangeRequests';
import { createInternalAccount, deactivateInternalAccount, getInternalAccounts, updateInternalAccount } from '../api/systemUsers';

const roleOptions = [
  { value: 'principal', label: 'Hiệu trưởng' },
  { value: 'teacher', label: 'Giáo viên' },
  { value: 'accountant', label: 'Kế toán' },
  { value: 'chef', label: 'Nhân viên bếp' },
  { value: 'guard', label: 'Bảo vệ' },
  { value: 'hr', label: 'Nhân sự (HR)' }
];
const statusOptions = { active: 'Đang hoạt động', suspended: 'Tạm ngưng', inactive: 'Đã thu hồi' };
const emptyForm = { fullName: '', username: '', password: '', phone: '', email: '', role: 'teacher', status: 'active' };

export default function AccountManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentRole = JSON.parse(localStorage.getItem('user') || '{}').role;
  const currentUserId = JSON.parse(localStorage.getItem('user') || '{}')._id;
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
  const [form, setForm] = useState(emptyForm);
  const [editingAccount, setEditingAccount] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [modalError, setModalError] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 0 });
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
      const response = await getInternalAccounts({ page, limit: 10 });
      if (requestId !== accountRequestRef.current) return;
      setAccounts(response.data.data || []);
      setPagination(response.data.pagination || { page: 1, limit: 10, total: 0, totalPages: 0 });
    } catch (error) {
      if (requestId !== accountRequestRef.current) return;
      setNotice({ type: 'error', text: error.response?.data?.message || 'Không thể tải danh sách tài khoản.' });
    } finally {
      if (requestId === accountRequestRef.current) {
        setLoading(false);
      }
    }
  }, [page]);

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

  const openCreateModal = (e) => {
    triggerRef.current = e?.currentTarget || document.activeElement;
    setEditingAccount(null);
    setForm(emptyForm);
    setModalError('');
    setShowModal(true);
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

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setModalError('');
    try {
      if (editingAccount) {
        const payload = {
          username: form.username,
          role: form.role,
          status: form.status,
          profile: { fullName: form.fullName, phone: form.phone, email: form.email }
        };
        if (form.password) payload.password = form.password;
        await updateInternalAccount(editingAccount._id, payload);
        setNotice({ type: 'success', text: `Đã cập nhật tài khoản @${form.username}.` });
      } else {
        const createRes = await createInternalAccount({
          username: form.username,
          password: form.password,
          role: form.role,
          profile: { fullName: form.fullName, phone: form.phone, email: form.email }
        });
        const createdAccount = createRes.data?.data;
        if (createdAccount?._id) {
          setHighlightedAccountId(createdAccount._id);
        }
        setNotice({
          type: 'success',
          text: `Đã tạo tài khoản @${form.username} và hồ sơ nhân sự liên kết. Hãy thiết lập lương, hợp đồng và thông tin còn thiếu tại mục Nhân sự & Lương.`
        });
      }
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
          <ParentAccountManagement embedded />
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
                <p className="card-kicker">DANH SÁCH TÀI KHOẢN</p>
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
                  + Tạo tài khoản
                </button>
              </div>
            </div>

            {loading ? (
              <div className="page-loader">
                <span className="loading-orb" />
                Đang tải tài khoản...
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table account-table">
                  <thead>
                    <tr>
                      <th>Nhân sự</th>
                      <th>Tài khoản</th>
                      <th>Vai trò</th>
                      <th>Hồ sơ nhân sự</th>
                      <th>Trạng thái</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.length ? (
                      accounts.map((account) => (
                        <tr
                          key={account._id}
                          className={account._id === highlightedAccountId ? 'account-row-new' : ''}
                        >
                          <td>
                            <div className="account-name-cell">
                              <strong>{account.profile?.fullName || account.username}</strong>
                              {account._id === highlightedAccountId && (
                                <span className="account-new-pill">Mới tạo</span>
                              )}
                            </div>
                            <small>{account.profile?.phone || account.profile?.email || 'Chưa có liên hệ'}</small>
                          </td>
                          <td>@{account.username}</td>
                          <td>
                            <span className="account-role-badge">
                              {account.role === 'admin'
                                ? 'Quản trị hệ thống'
                                : roleOptions.find((role) => role.value === account.role)?.label || account.role}
                            </span>
                          </td>
                          <td>{account.employeeId || <span className="account-unlinked">Chưa liên kết</span>}</td>
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
                                Sửa
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
                      ))
                    ) : (
                      <tr>
                        <td colSpan="6" className="history-empty">
                          Chưa có tài khoản nội bộ.
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

              <form className="student-form account-modal-form" onSubmit={submit}>
                <div className="student-form-grid">
                  <label>
                    Họ và tên
                    <input
                      value={form.fullName}
                      onChange={(event) => setField('fullName', event.target.value)}
                      placeholder="Nhập họ và tên đầy đủ"
                      required
                    />
                  </label>
                  <label>
                    Tên đăng nhập
                    <input
                      value={form.username}
                      onChange={(event) => setField('username', event.target.value)}
                      placeholder="Ví dụ: nguyenvana"
                      minLength="3"
                      maxLength="50"
                      required
                    />
                  </label>
                  <label>
                    Số điện thoại
                    <input
                      value={form.phone}
                      onChange={(event) => setField('phone', event.target.value)}
                      placeholder="Không bắt buộc"
                    />
                  </label>
                  <label>
                    Email
                    <input
                      type="email"
                      value={form.email}
                      onChange={(event) => setField('email', event.target.value)}
                      placeholder="Không bắt buộc"
                    />
                  </label>
                  <label>
                    Vai trò
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
                    <small>Mỗi tài khoản chỉ được gán một vai trò.</small>
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
                    {editingAccount ? 'Đặt lại mật khẩu (để trống nếu giữ nguyên)' : 'Mật khẩu tạm thời'}
                    <input
                      type="password"
                      value={form.password}
                      onChange={(event) => setField('password', event.target.value)}
                      minLength={editingAccount && !form.password ? 0 : 8}
                      maxLength="72"
                      placeholder={editingAccount ? 'Để trống nếu không đổi mật khẩu' : 'Tối thiểu 8 ký tự'}
                      required={!editingAccount}
                    />
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
