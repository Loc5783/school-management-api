import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import api from '../api/axiosConfig';

export default function StaffSettings() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault(); setError('');
    if (form.newPassword !== form.confirmPassword) { setError('Mật khẩu xác nhận không khớp'); return; }
    setSaving(true);
    try {
      await api.post('/auth/me/password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      localStorage.removeItem('token'); localStorage.removeItem('user'); navigate('/login', { replace: true });
    } catch (requestError) { setError(requestError.response?.data?.message || 'Không thể đổi mật khẩu'); }
    finally { setSaving(false); }
  };

  return <AppShell title="Cài đặt tài khoản" subtitle="Bảo vệ tài khoản đăng nhập cá nhân của bạn.">
    <section className="content-card staff-request-quick-link"><div><h3>Cập nhật thông tin cá nhân</h3><p>Gửi thông tin mới để HR và Ban giám hiệu kiểm tra trước khi cập nhật hồ sơ.</p></div><Link className="button button-secondary" to="/my-requests?type=profile_change">Yêu cầu cập nhật hồ sơ</Link></section>
    <section className="content-card staff-settings-card"><div className="card-heading"><div><p className="card-kicker">TÀI KHOẢN CÁ NHÂN</p><h2>@{user.username}</h2><p>{user.profile?.fullName || 'Chưa cập nhật họ tên'}</p></div></div>
      <form className="student-form staff-settings-form" onSubmit={submit}>
        <h3>Đổi mật khẩu</h3><p>Sau khi đổi, hệ thống sẽ yêu cầu đăng nhập lại trên các thiết bị.</p>
        {error && <div className="form-error">{error}</div>}
        <label>Mật khẩu hiện tại<input type="password" autoComplete="current-password" required value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} /></label>
        <label>Mật khẩu mới<input type="password" autoComplete="new-password" required minLength="8" maxLength="72" value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} /></label>
        <label>Nhập lại mật khẩu mới<input type="password" autoComplete="new-password" required value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} /></label>
        <button className="button button-primary" disabled={saving}>{saving ? 'Đang lưu...' : 'Đổi mật khẩu'}</button>
      </form>
    </section>
  </AppShell>;
}
