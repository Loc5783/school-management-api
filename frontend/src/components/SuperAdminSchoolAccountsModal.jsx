import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import {
  createSuperAdminSchoolAccount,
  getSuperAdminSchoolAccounts,
  updateSuperAdminSchoolAccount
} from '../api/multiSchool';

const ROLE_META = [
  { key: 'all', label: 'Tất cả tài khoản', badgeClass: 'neutral' },
  { key: 'admin', label: 'Admin riêng của trường', badgeClass: 'role-admin' },
  { key: 'principal', label: 'Ban Giám đốc / Hiệu trưởng', badgeClass: 'role-principal' },
  { key: 'teacher', label: 'Giáo viên đứng lớp', badgeClass: 'role-teacher' },
  { key: 'chef', label: 'Đầu bếp / Dinh dưỡng', badgeClass: 'role-chef' },
  { key: 'accountant', label: 'Kế toán học phí', badgeClass: 'role-accountant' },
  { key: 'hr', label: 'Nhân sự & Lương (HR)', badgeClass: 'role-hr' },
  { key: 'guard', label: 'Bảo vệ cổng', badgeClass: 'role-guard' },
  { key: 'parent', label: 'Phụ huynh học sinh', badgeClass: 'role-parent' }
];

const CREATE_ROLE_OPTIONS = ROLE_META.filter((r) => r.key !== 'all' && r.key !== 'parent');

const STATUS_LABELS = {
  active: 'Đang hoạt động',
  suspended: 'Tạm khóa',
  inactive: 'Đã thu hồi',
  locked: 'Đang khóa'
};

const generateQuickPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let pass = 'Hn@';
  for (let i = 0; i < 6; i += 1) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
};

const formatLoginTime = (val) => {
  if (!val) return 'Chưa đăng nhập';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const makeEmptyAccountForm = (schoolCode = '') => ({
  role: 'admin',
  fullName: '',
  username: schoolCode ? `admin_${String(schoolCode).toLowerCase().replace(/[^a-z0-9]/g, '')}` : '',
  phone: '',
  email: '',
  password: generateQuickPassword(),
  status: 'active'
});

/**
 * Modal chuyên biệt cho phép SuperAdmin xem, cấp mới, đặt lại mật khẩu và khóa/mở khóa
 * toàn bộ tài khoản thuộc phạm vi riêng của từng đơn vị trường học (`tenantId`).
 */
export default function SuperAdminSchoolAccountsModal({ school, onClose, onChanged }) {
  const schoolId = school?._id;
  const [accounts, setAccounts] = useState([]);
  const [schoolMeta, setSchoolMeta] = useState(school || null);
  const [roleSummary, setRoleSummary] = useState({});
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, totalPages: 1 });
  const [roleFilter, setRoleFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);

  // Trạng thái Form Tạo mới / Sửa / Đặt lại mật khẩu ngay trong Modal
  const [formMode, setFormMode] = useState(null); // null | 'create' | 'edit'
  const [editingAcc, setEditingAcc] = useState(null);
  const [form, setForm] = useState(() => makeEmptyAccountForm(school?.code));
  const [showPass, setShowPass] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Phiếu bàn giao 1 chạm ngay khi vừa tạo / đổi mật khẩu
  const [handover, setHandover] = useState(null);
  const [copiedKey, setCopiedKey] = useState('');

  const fetchAccounts = useCallback(
    async (targetPage = 1) => {
      if (!schoolId) return;
      setLoading(true);
      setError('');
      try {
        const res = await getSuperAdminSchoolAccounts(schoolId, {
          page: targetPage,
          limit: 25,
          role: roleFilter !== 'all' ? roleFilter : undefined,
          search: search.trim() || undefined
        });
        const payload = res.data?.data || {};
        setSchoolMeta(payload.school || school);
        setRoleSummary(payload.roleSummary || {});
        setAccounts(payload.items || []);
        setPagination(payload.pagination || { page: 1, limit: 25, total: 0, totalPages: 1 });
      } catch (err) {
        setError(err.response?.data?.message || 'Không thể tải danh sách tài khoản của trường này.');
      } finally {
        setLoading(false);
      }
    },
    [schoolId, roleFilter, search, school]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchAccounts(1);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [fetchAccounts]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !submitting) {
        if (formMode) {
          setFormMode(null);
          setEditingAcc(null);
        } else {
          onClose?.();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, formMode, submitting]);

  if (!schoolId) return null;

  const copyText = async (key, value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(''), 2200);
    } catch {
      // Bỏ qua nếu trình duyệt không cấp quyền clipboard
    }
  };

  const openCreateForm = (defaultRole = 'admin') => {
    setFormError('');
    setEditingAcc(null);
    setShowPass(true);
    setForm({
      ...makeEmptyAccountForm(schoolMeta?.code || school?.code),
      role: defaultRole,
      username: defaultRole === 'admin' ? '' : ''
    });
    setFormMode('create');
  };

  const openEditForm = (acc, prefillResetPass = false) => {
    setFormError('');
    setEditingAcc(acc);
    setShowPass(prefillResetPass);
    setForm({
      role: acc.role,
      fullName: acc.profile?.fullName || '',
      username: acc.username || '',
      phone: acc.profile?.phone || '',
      email: acc.profile?.email || '',
      password: prefillResetPass ? generateQuickPassword() : '',
      status: acc.status === 'active' ? 'active' : 'suspended'
    });
    setFormMode('edit');
  };

  const handleSubmitForm = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFormError('');
    const roleLabel = ROLE_META.find((r) => r.key === form.role)?.label || form.role;

    try {
      if (formMode === 'create') {
        const res = await createSuperAdminSchoolAccount(schoolId, {
          role: form.role,
          username: form.username.trim(),
          password: form.password,
          profile: {
            fullName: form.fullName.trim(),
            phone: form.phone.trim(),
            email: form.email.trim()
          }
        });
        setHandover({
          schoolCode: schoolMeta?.code || school?.code,
          schoolName: schoolMeta?.name || school?.name,
          roleLabel,
          fullName: form.fullName.trim(),
          username: form.username.trim(),
          password: form.password
        });
        setNotice({ type: 'success', text: res.data?.message || `Đã cấp tài khoản @${form.username.trim()} thành công.` });
      } else if (formMode === 'edit' && editingAcc) {
        const payload = {
          username: form.username.trim(),
          status: form.status,
          profile: {
            fullName: form.fullName.trim(),
            phone: form.phone.trim(),
            email: form.email.trim()
          }
        };
        if (editingAcc.role !== 'parent') {
          payload.role = form.role;
        }
        if (form.password.trim()) {
          payload.password = form.password.trim();
        }
        const res = await updateSuperAdminSchoolAccount(schoolId, editingAcc._id, payload);
        if (form.password.trim()) {
          setHandover({
            schoolCode: schoolMeta?.code || school?.code,
            schoolName: schoolMeta?.name || school?.name,
            roleLabel,
            fullName: form.fullName.trim(),
            username: form.username.trim(),
            password: form.password.trim()
          });
        }
        setNotice({ type: 'success', text: res.data?.message || `Đã cập nhật tài khoản @${form.username.trim()}.` });
      }

      setFormMode(null);
      setEditingAcc(null);
      await fetchAccounts(pagination.page);
      onChanged?.();
    } catch (err) {
      setFormError(err.response?.data?.message || 'Không thể lưu thông tin tài khoản.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleLock = async (acc) => {
    if (submitting) return;
    const nextStatus = acc.status === 'active' ? 'suspended' : 'active';
    setSubmitting(true);
    setNotice(null);
    try {
      await updateSuperAdminSchoolAccount(schoolId, acc._id, { status: nextStatus });
      setNotice({
        type: 'success',
        text: nextStatus === 'active'
          ? `Đã mở khóa tài khoản @${acc.username}.`
          : `Đã tạm khóa tài khoản @${acc.username}.`
      });
      await fetchAccounts(pagination.page);
      onChanged?.();
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.message || 'Không thể đổi trạng thái tài khoản.' });
    } finally {
      setSubmitting(false);
    }
  };

  const getRoleBadge = (role) => {
    const found = ROLE_META.find((r) => r.key === role);
    return (
      <span className={`account-role-badge ${found?.badgeClass || ''}`}>
        {found?.label || role}
      </span>
    );
  };

  return createPortal(
    <div
      className="account-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose?.();
      }}
    >
      <div
        className="account-modal-card sa-school-accounts-modal"
        style={{ width: 'min(1080px, 96vw)', maxHeight: '92dvh', overflowY: 'auto' }}
      >
        {/* TIÊU ĐỀ MODAL */}
        <div className="account-modal-header" style={{ flexWrap: 'wrap', gap: 14 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="sa-school-code-pill">{schoolMeta?.code || school?.code}</span>
              <span className="card-kicker" style={{ margin: 0 }}>
                QUẢN LÝ ACCOUNT RIÊNG CỦA TRƯỜNG · CÁCH LY DỮ LIỆU ĐỘC LẬP
              </span>
            </div>
            <h2 style={{ margin: '6px 0 3px' }}>{schoolMeta?.name || school?.name}</h2>
            <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
              SuperAdmin cấp tài khoản <strong>Admin riêng</strong> để bàn giao cho trường; đồng thời có thể xem và hỗ trợ đặt lại mật khẩu cho các tài khoản <strong>Ban Giám đốc, Giáo viên, Đầu bếp, Kế toán, Nhân sự, Bảo vệ</strong> của trường khi cần.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="button button-primary"
              onClick={() => openCreateForm('admin')}
            >
              <Icon name="plus" size={15} /> Cấp thêm Account cho trường
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={submitting}
              onClick={onClose}
            >
              <Icon name="close" size={16} /> Đóng
            </button>
          </div>
        </div>

        {/* THÔNG BÁO THAO TÁC */}
        {notice && (
          <div
            className={notice.type === 'error' ? 'form-error' : 'timekeeping-notice success'}
            style={{ marginBottom: 14 }}
          >
            <Icon name={notice.type === 'error' ? 'alertCircle' : 'check'} size={16} />
            <span>{notice.text}</span>
          </div>
        )}

        {/* PHIẾU BÀN GIAO TÀI KHOẢN 1 CHẠM */}
        {handover && (
          <div className="credential-handover-card" style={{ marginBottom: 16 }}>
            <div style={{ flex: '1 1 420px' }}>
              <h3>✓ Phiếu bàn giao thông tin đăng nhập ({handover.roleLabel})</h3>
              <div className="credential-handover-grid">
                <span>Mã trường: <code>{handover.schoolCode}</code></span>
                <span>Người dùng: <strong>{handover.fullName}</strong></span>
                <span>Tài khoản: <code>{handover.username}</code></span>
                <span>Mật khẩu: <code>{handover.password}</code></span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="button button-primary"
                onClick={() =>
                  copyText(
                    'modal-handover',
                    [
                      `Trường: ${handover.schoolName} (${handover.schoolCode})`,
                      `Vai trò: ${handover.roleLabel}`,
                      `Họ và tên: ${handover.fullName}`,
                      `Tên đăng nhập: ${handover.username}`,
                      `Mật khẩu: ${handover.password}`,
                      `Đăng nhập tại: ${window.location.origin}/login`
                    ].join('\n')
                  )
                }
              >
                <Icon name="copy" size={14} />{' '}
                {copiedKey === 'modal-handover' ? 'Đã sao chép!' : 'Sao chép gửi nhà trường'}
              </button>
              <button type="button" className="button button-secondary" onClick={() => setHandover(null)}>
                Ẩn phiếu
              </button>
            </div>
          </div>
        )}

        {/* DẢI THẺ TỔNG HỢP & LỌC NHANH THEO VAI TRÒ TRONG TRƯỜNG */}
        <div className="sa-account-role-chips" role="tablist" aria-label="Lọc tài khoản theo vai trò">
          {ROLE_META.map((item) => {
            const stat = roleSummary[item.key] || { total: 0, active: 0 };
            if (item.key !== 'all' && item.key !== 'admin' && stat.total === 0 && roleFilter !== item.key) {
              return null;
            }
            const active = roleFilter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                className={`sa-role-chip ${active ? 'active' : ''}`}
                onClick={() => setRoleFilter(item.key)}
              >
                <span>{item.label}</span>
                <b>{stat.total}</b>
              </button>
            );
          })}
        </div>

        {/* KHUNG TẠO MỚI HOẶC CẬP NHẬT / ĐẶT LẠI MẬT KHẨU TÀI KHOẢN */}
        {formMode && (
          <form className="sa-account-inline-form student-form" autoComplete="off" onSubmit={handleSubmitForm}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div>
                <p className="card-kicker" style={{ margin: 0, color: '#1d4ed8' }}>
                  {formMode === 'create' ? 'CẤP TÀI KHOẢN MỚI CHO TRƯỜNG' : `CẬP NHẬT / ĐẶT LẠI MẬT KHẨU (@${editingAcc?.username})`}
                </p>
                <h3 style={{ margin: '3px 0 0', fontSize: 16, color: '#0f172a' }}>
                  {formMode === 'create'
                    ? `Khởi tạo tài khoản thuộc trường ${schoolMeta?.code || ''}`
                    : `Chỉnh sửa tài khoản của ${editingAcc?.profile?.fullName || editingAcc?.username}`}
                </h3>
              </div>
              <button
                type="button"
                className="button button-secondary"
                disabled={submitting}
                onClick={() => {
                  setFormMode(null);
                  setEditingAcc(null);
                }}
              >
                Đóng biểu mẫu
              </button>
            </div>

            {formError && (
              <div className="account-modal-error" role="alert">
                <Icon name="alertCircle" size={16} />
                <span>{formError}</span>
              </div>
            )}

            <div className="student-form-grid">
              <label>
                Vai trò phân quyền trong trường *
                <select
                  value={form.role}
                  disabled={editingAcc?.role === 'parent'}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                >
                  {editingAcc?.role === 'parent' ? (
                    <option value="parent">Phụ huynh học sinh</option>
                  ) : (
                    CREATE_ROLE_OPTIONS.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label}
                      </option>
                    ))
                  )}
                </select>
              </label>

              <label>
                Họ và tên người sử dụng *
                <input
                  required
                  autoComplete="off"
                  placeholder="VD: Nguyễn Thị Minh (Quản trị trường)"
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                />
              </label>

              <label>
                Tên đăng nhập *
                <input
                  required
                  minLength={3}
                  maxLength={50}
                  autoComplete="off"
                  placeholder="VD: admin_hoanang, giamdoc_cs1..."
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value.replace(/\s+/g, '') })}
                />
              </label>

              {formMode === 'edit' ? (
                <label>
                  Trạng thái hoạt động
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    <option value="active">Đang hoạt động</option>
                    <option value="suspended">Tạm khóa đăng nhập</option>
                  </select>
                </label>
              ) : (
                <label>
                  Số điện thoại liên hệ
                  <input
                    autoComplete="off"
                    placeholder="VD: 0912345678"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </label>
              )}

              {formMode === 'edit' && (
                <label>
                  Số điện thoại liên hệ
                  <input
                    autoComplete="off"
                    placeholder="VD: 0912345678"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </label>
              )}

              <label>
                Email liên hệ
                <input
                  type="email"
                  autoComplete="off"
                  placeholder="Không bắt buộc"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>

              <label className="form-wide">
                {formMode === 'create'
                  ? 'Mật khẩu khởi tạo bàn giao *'
                  : 'Mật khẩu mới (để trống nếu giữ nguyên mật khẩu hiện tại)'}
                <div className="password-field-group">
                  <input
                    type={showPass ? 'text' : 'password'}
                    autoComplete="new-password"
                    required={formMode === 'create'}
                    minLength={formMode === 'create' || form.password ? 6 : 0}
                    placeholder={
                      formMode === 'create'
                        ? 'Nhập từ 6 ký tự trở lên'
                        : 'Để trống nếu không đặt lại mật khẩu'
                    }
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                  />
                  <button
                    type="button"
                    className="password-field-btn"
                    onClick={() => setShowPass((v) => !v)}
                  >
                    <Icon name={showPass ? 'eyeOff' : 'eye'} size={15} /> {showPass ? 'Ẩn' : 'Hiện'}
                  </button>
                  <button
                    type="button"
                    className="password-field-btn"
                    onClick={() => {
                      setForm((prev) => ({ ...prev, password: generateQuickPassword() }));
                      setShowPass(true);
                    }}
                  >
                    Tạo mật khẩu ngẫu nhiên
                  </button>
                </div>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button
                type="button"
                className="button button-secondary"
                disabled={submitting}
                onClick={() => {
                  setFormMode(null);
                  setEditingAcc(null);
                }}
              >
                Hủy
              </button>
              <button type="submit" className="button button-primary" disabled={submitting}>
                {submitting
                  ? 'Đang lưu...'
                  : formMode === 'create'
                    ? 'Tạo tài khoản & Xuất phiếu bàn giao'
                    : 'Lưu cập nhật tài khoản'}
              </button>
            </div>
          </form>
        )}

        {/* THANH TÌM KIẾM TRONG DANH SÁCH ACCOUNT CỦA TRƯỜNG */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          <label className="search-box" style={{ flex: '1 1 280px' }}>
            <Icon name="search" size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm theo @username, họ tên, số điện thoại, email hoặc mã nhân viên..."
            />
          </label>
          <span style={{ fontSize: 12.5, color: '#64748b', fontWeight: 600 }}>
            Hiển thị <strong>{accounts.length}</strong> / {pagination.total} tài khoản
          </span>
        </div>

        {/* BẢNG DANH SÁCH TÀI KHOẢN CỦA TRƯỜNG */}
        {loading ? (
          <div className="inline-loader" style={{ minHeight: 180 }}>
            <span className="loading-orb" /> Đang tải danh sách tài khoản của trường...
          </div>
        ) : error ? (
          <div className="form-error" role="alert">
            <Icon name="alertCircle" size={16} /> {error}
          </div>
        ) : (
          <div className="table-wrap" style={{ border: '1px solid #e2e8f0', borderRadius: 14 }}>
            <table className="data-table sa-clean-table">
              <thead>
                <tr>
                  <th>Người sử dụng & Liên hệ</th>
                  <th>Tên đăng nhập</th>
                  <th>Vai trò phân quyền</th>
                  <th>Mã định danh / Hồ sơ</th>
                  <th>Đăng nhập gần nhất</th>
                  <th>Trạng thái</th>
                  <th>Thao tác hỗ trợ</th>
                </tr>
              </thead>
              <tbody>
                {accounts.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '32px 16px', color: '#64748b' }}>
                      Không tìm thấy tài khoản nào khớp bộ lọc hiện tại.
                    </td>
                  </tr>
                ) : (
                  accounts.map((acc) => {
                    const initial = String(acc.profile?.fullName || acc.username || 'U')
                      .trim()
                      .charAt(0)
                      .toUpperCase();
                    return (
                      <tr key={acc._id}>
                        <td>
                          <div className="sa-user-identity-cell">
                            <span className={`sa-user-avatar ${acc.role === 'admin' ? 'is-admin' : ''}`}>
                              {initial}
                            </span>
                            <div>
                              <strong style={{ display: 'block', fontSize: 13.5 }}>
                                {acc.profile?.fullName || acc.username}
                              </strong>
                              <small style={{ marginTop: 2 }}>
                                {[acc.profile?.phone, acc.profile?.email].filter(Boolean).join(' · ') || 'Chưa cập nhật SĐT/Email'}
                              </small>
                            </div>
                          </div>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <code className="sa-username-code">@{acc.username}</code>
                            <button
                              type="button"
                              className="sa-mini-icon-btn"
                              title="Sao chép tên đăng nhập"
                              onClick={() => copyText(`u-${acc._id}`, acc.username)}
                            >
                              <Icon name={copiedKey === `u-${acc._id}` ? 'check' : 'copy'} size={13} />
                            </button>
                          </div>
                        </td>
                        <td>{getRoleBadge(acc.role)}</td>
                        <td style={{ whiteSpace: 'nowrap', fontSize: 12.5 }}>
                          {acc.role === 'admin' ? (
                            <span style={{ color: '#1d4ed8', fontWeight: 700 }}>Quản trị toàn trường</span>
                          ) : acc.role === 'parent' ? (
                            <span>Liên kết {acc.linkedStudentsCount || 0} bé</span>
                          ) : acc.employeeCode ? (
                            <code>{acc.employeeCode}</code>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>Chưa gắn mã NV</span>
                          )}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', fontSize: 12.5 }}>
                          {formatLoginTime(acc.lastLogin)}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span
                            className={`student-status ${
                              acc.status === 'active' ? 'enrolled' : 'withdrawn'
                            }`}
                          >
                            {STATUS_LABELS[acc.status] || acc.status}
                          </span>
                        </td>
                        <td>
                          <div className="sa-inline-actions">
                            <button
                              type="button"
                              className="button button-secondary"
                              onClick={() => openEditForm(acc, true)}
                              disabled={submitting}
                            >
                              Đổi MK
                            </button>
                            <button
                              type="button"
                              className="button button-secondary"
                              onClick={() => openEditForm(acc, false)}
                              disabled={submitting}
                            >
                              Sửa
                            </button>
                            <button
                              type="button"
                              className={`button ${acc.status === 'active' ? 'button-danger' : 'button-primary'}`}
                              onClick={() => handleToggleLock(acc)}
                              disabled={submitting}
                            >
                              {acc.status === 'active' ? 'Khóa' : 'Mở'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {pagination.totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
            <small style={{ color: '#64748b' }}>
              Trang {pagination.page} / {pagination.totalPages} ({pagination.total} tài khoản)
            </small>
            <div className="sa-inline-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={pagination.page <= 1 || loading}
                onClick={() => fetchAccounts(pagination.page - 1)}
              >
                ← Trang trước
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={pagination.page >= pagination.totalPages || loading}
                onClick={() => fetchAccounts(pagination.page + 1)}
              >
                Trang sau →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

