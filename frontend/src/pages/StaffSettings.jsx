import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import api from '../api/axiosConfig';
import { clearAuthSession, getStoredUser } from '../utils/storage';

export default function StaffSettings() {
  const navigate = useNavigate();
  const user = getStoredUser();

  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setError('');
    if (form.newPassword !== form.confirmPassword) {
      setError('Mật khẩu xác nhận không khớp');
      return;
    }
    setSaving(true);
    try {
      await api.post('/auth/me/password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword
      });
      clearAuthSession();
      navigate('/login', { replace: true });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Không thể đổi mật khẩu');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell
      title="Cài đặt & Bảo mật Tài khoản"
      subtitle="Quản lý mật khẩu và bảo vệ phiên đăng nhập cá nhân của bạn."
    >
      <section className="content-card staff-settings-card">
        <div className="card-heading">
          <div>
            <p className="card-kicker">TÀI KHOẢN ĐĂNG NHẬP</p>
            <h2>@{user.username}</h2>
            <p>{user.profile?.fullName || 'Chưa cập nhật họ tên'}</p>
          </div>
        </div>
        <form className="student-form staff-settings-form" onSubmit={submit}>
          <h3>Đổi mật khẩu bảo mật</h3>
          <p>Sau khi đổi mật khẩu, hệ thống sẽ tự động thu hồi các phiên cũ và yêu cầu đăng nhập lại.</p>
          {error && <div className="form-error">{error}</div>}
          <label>
            Mật khẩu hiện tại
            <input
              type="password"
              autoComplete="current-password"
              required
              value={form.currentPassword}
              onChange={(event) => setForm({ ...form, currentPassword: event.target.value })}
            />
          </label>
          <label>
            Mật khẩu mới
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength="8"
              maxLength="72"
              value={form.newPassword}
              onChange={(event) => setForm({ ...form, newPassword: event.target.value })}
            />
          </label>
          <label>
            Nhập lại mật khẩu mới
            <input
              type="password"
              autoComplete="new-password"
              required
              value={form.confirmPassword}
              onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
            />
          </label>
          <button className="button button-primary" type="submit" disabled={saving}>
            {saving ? 'Đang lưu...' : 'Đổi mật khẩu'}
          </button>
        </form>
      </section>
    </AppShell>
  );
}
