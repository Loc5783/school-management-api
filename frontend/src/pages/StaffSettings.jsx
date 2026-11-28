import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import api from '../api/axiosConfig';
import { clearAuthSession, getStoredTenant, getStoredUser } from '../utils/storage';
import { getUserRoleBadgeLabel } from '../utils/roleWorkspaceConfig';

/**
 * Trang Cài đặt & Bảo mật Tài khoản dành cho Admin Phân hiệu Trường và Nhân sự nội bộ (`/settings`).
 * Bố cục 2 cột rõ ràng, có nút Hiện/Ẩn mật khẩu, kiểm tra khớp mật khẩu trực tiếp và khóa chống bấm đúp.
 */
export default function StaffSettings() {
  const navigate = useNavigate();
  const user = getStoredUser() || {};
  const tenant = getStoredTenant() || {};
  const isAdmin = user.role === 'admin';

  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showPwd, setShowPwd] = useState({ current: false, next: false, confirm: false });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingLockRef = useRef(false);

  const roleLabel = getUserRoleBadgeLabel(user);

  const submit = async (event) => {
    event.preventDefault();
    if (savingLockRef.current || saving) return;
    setError('');

    if (form.newPassword.length < 8) {
      setError('Mật khẩu mới cần có ít nhất 8 ký tự để đảm bảo an toàn.');
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setError('Mật khẩu xác nhận chưa khớp với mật khẩu mới.');
      return;
    }

    savingLockRef.current = true;
    setSaving(true);
    try {
      await api.post('/auth/me/password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword
      });
      clearAuthSession();
      navigate('/login', { replace: true });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Không thể đổi mật khẩu. Vui lòng kiểm tra lại mật khẩu hiện tại.');
    } finally {
      savingLockRef.current = false;
      setSaving(false);
    }
  };

  return (
    <AppShell
      title="Cài đặt & Bảo mật Tài khoản"
      subtitle="Quản lý mật khẩu đăng nhập, kiểm tra thông tin định danh và bảo vệ phiên làm việc cá nhân."
      actions={
        isAdmin ? (
          <div className="toolbar-buttons">
            <Link className="button button-secondary" to="/campuses?tab=settings">
              <Icon name="settings" size={15} /> Cài đặt Vận hành Phân hiệu
            </Link>
            <Link className="button button-primary" to="/accounts">
              <Icon name="users" size={15} /> Quản lý Tài khoản Trường
            </Link>
          </div>
        ) : undefined
      }
    >
      <div className="hn-campus-settings-layout">
        <form className="hn-form-section-card" autoComplete="off" onSubmit={submit}>
          <div className="hn-section-head">
            <span className="hn-section-icon blue">
              <Icon name="lock" size={20} />
            </span>
            <div>
              <h3>Đổi mật khẩu bảo mật tài khoản</h3>
              <p>
                Sau khi đổi mật khẩu thành công, hệ thống sẽ tự động thu hồi mọi phiên đăng nhập cũ trên các thiết bị khác và chuyển về màn hình đăng nhập lại.
              </p>
            </div>
          </div>

          {error && (
            <div className="form-error" role="alert" style={{ marginBottom: 16 }}>
              <Icon name="alertCircle" size={16} />
              <span style={{ marginLeft: 6 }}>{error}</span>
            </div>
          )}

          <div className="hn-fields-stack">
            <div className="hn-field">
              <label className="hn-field-label" htmlFor="stf-cur-pwd">
                Mật khẩu hiện tại <span className="hn-field-req">*</span>
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  id="stf-cur-pwd"
                  type={showPwd.current ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="Nhập mật khẩu đang sử dụng"
                  style={{ paddingRight: 72 }}
                  value={form.currentPassword}
                  onChange={(event) => setForm({ ...form, currentPassword: event.target.value })}
                />
                <button
                  type="button"
                  data-no-progress="true"
                  onClick={() => setShowPwd((p) => ({ ...p, current: !p.current }))}
                  style={{
                    position: 'absolute',
                    right: 8,
                    minHeight: 30,
                    padding: '0 10px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    background: '#f8fafc',
                    color: '#334155',
                    fontSize: 11.5,
                    fontWeight: 700
                  }}
                >
                  {showPwd.current ? 'Ẩn' : 'Hiện'}
                </button>
              </div>
            </div>

            <div className="hn-grid-2">
              <div className="hn-field">
                <label className="hn-field-label" htmlFor="stf-new-pwd">
                  Mật khẩu mới <span className="hn-field-req">*</span>
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    id="stf-new-pwd"
                    type={showPwd.next ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    maxLength={72}
                    placeholder="Tối thiểu 8 ký tự"
                    style={{ paddingRight: 72 }}
                    value={form.newPassword}
                    onChange={(event) => setForm({ ...form, newPassword: event.target.value })}
                  />
                  <button
                    type="button"
                    data-no-progress="true"
                    onClick={() => setShowPwd((p) => ({ ...p, next: !p.next }))}
                    style={{
                      position: 'absolute',
                      right: 8,
                      minHeight: 30,
                      padding: '0 10px',
                      borderRadius: 8,
                      border: '1px solid #cbd5e1',
                      background: '#f8fafc',
                      color: '#334155',
                      fontSize: 11.5,
                      fontWeight: 700
                    }}
                  >
                    {showPwd.next ? 'Ẩn' : 'Hiện'}
                  </button>
                </div>
                <span className="hn-field-hint">Nên kết hợp chữ hoa, chữ thường và chữ số</span>
              </div>

              <div className="hn-field">
                <label className="hn-field-label" htmlFor="stf-confirm-pwd">
                  Nhập lại mật khẩu mới <span className="hn-field-req">*</span>
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    id="stf-confirm-pwd"
                    type={showPwd.confirm ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    placeholder="Nhập lại đúng mật khẩu mới"
                    style={{ paddingRight: 72 }}
                    value={form.confirmPassword}
                    onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
                  />
                  <button
                    type="button"
                    data-no-progress="true"
                    onClick={() => setShowPwd((p) => ({ ...p, confirm: !p.confirm }))}
                    style={{
                      position: 'absolute',
                      right: 8,
                      minHeight: 30,
                      padding: '0 10px',
                      borderRadius: 8,
                      border: '1px solid #cbd5e1',
                      background: '#f8fafc',
                      color: '#334155',
                      fontSize: 11.5,
                      fontWeight: 700
                    }}
                  >
                    {showPwd.confirm ? 'Ẩn' : 'Hiện'}
                  </button>
                </div>
                {form.confirmPassword && (
                  <span
                    className="hn-field-hint"
                    style={{
                      color: form.newPassword === form.confirmPassword ? '#15803d' : '#dc2626',
                      fontWeight: 600
                    }}
                  >
                    {form.newPassword === form.confirmPassword
                      ? '✓ Mật khẩu xác nhận đã trùng khớp'
                      : '⚠ Mật khẩu xác nhận chưa trùng khớp'}
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 6 }}>
              <button className="button button-primary" type="submit" disabled={saving} aria-busy={saving}>
                <Icon name="check" size={16} />
                <span>{saving ? 'Đang cập nhật mật khẩu...' : 'Cập nhật mật khẩu mới'}</span>
              </button>
            </div>
          </div>
        </form>

        <aside className="hn-settings-summary-aside">
          <div className="hn-summary-card">
            <p className="card-kicker" style={{ color: '#2563eb' }}>HỒ SƠ PHIÊN ĐĂNG NHẬP</p>
            <h3 style={{ margin: '4px 0 4px', fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
              {user.profile?.fullName || `@${user.username || 'user'}`}
            </h3>
            <p style={{ margin: 0, fontSize: 12.2, color: '#64748b', lineHeight: 1.45 }}>
              Thông tin tài khoản đang đăng nhập trên trình duyệt hiện tại.
            </p>

            <div className="hn-summary-list">
              <div className="hn-summary-row">
                <span>Tên đăng nhập</span>
                <strong>@{user.username || '—'}</strong>
              </div>
              <div className="hn-summary-row">
                <span>Vai trò chức trách</span>
                <strong style={{ color: '#1d4ed8' }}>{roleLabel}</strong>
              </div>
              <div className="hn-summary-row">
                <span>Đơn vị trường</span>
                <strong>{tenant?.name || tenant?.code || 'Hệ thống Hoa Nắng'}</strong>
              </div>
              {user.profile?.phone && (
                <div className="hn-summary-row">
                  <span>Số điện thoại</span>
                  <strong>{user.profile.phone}</strong>
                </div>
              )}
              {user.profile?.email && (
                <div className="hn-summary-row">
                  <span>Email liên hệ</span>
                  <strong>{user.profile.email}</strong>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
