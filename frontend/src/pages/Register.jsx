import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axiosConfig';
import Icon from '../components/Icon';

export default function Register() {
  const [form, setForm] = useState({ username: '', password: '', fullName: '', phone: '', email: '' });
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });
  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      const response = await api.post('/auth/register', {
        username: form.username,
        password: form.password,
        profile: { fullName: form.fullName, phone: form.phone, email: form.email }
      });
      setNotice({ type: 'success', text: response.data.message });
      setForm({ username: '', password: '', fullName: '', phone: '', email: '' });
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.message || 'Không thể gửi đăng ký.' });
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="login-page">
    <section className="login-presentation">
      <div className="login-brand"><span className="brand-mark"><span>H</span></span><span><strong>Hoa Nắng</strong><small>School Management</small></span></div>
      <div className="presentation-copy"><p className="eyebrow">DÀNH CHO PHỤ HUYNH</p><h1>Đồng hành cùng<br /><em>con mỗi ngày.</em></h1><p>Tài khoản chỉ được sử dụng sau khi nhà trường xác minh và liên kết với hồ sơ học sinh.</p></div>
    </section>
    <section className="login-form-section"><div className="login-form-wrap">
      <p className="eyebrow">ĐĂNG KÝ PHỤ HUYNH</p><h2>Tạo yêu cầu đăng ký</h2><p className="login-intro">Tài khoản nhân viên do Ban giám hiệu cấp. Bạn không thể chọn vai trò hoặc quyền tại đây.</p>
      <form onSubmit={submit}>
        <label>Họ và tên<input value={form.fullName} onChange={update('fullName')} autoComplete="name" required /></label>
        <label>Tên đăng nhập<input value={form.username} onChange={update('username')} autoComplete="username" minLength="3" maxLength="50" required /></label>
        <label>Số điện thoại<input value={form.phone} onChange={update('phone')} autoComplete="tel" /></label>
        <label>Email<input type="email" value={form.email} onChange={update('email')} autoComplete="email" /></label>
        <label>Mật khẩu<input type="password" value={form.password} onChange={update('password')} autoComplete="new-password" minLength="8" maxLength="72" required /></label>
        {notice && <p className={notice.type === 'success' ? 'form-success' : 'form-error'}>{notice.text}</p>}
        <button className="button button-primary login-button" type="submit" disabled={submitting}>{submitting ? 'Đang gửi...' : <>Gửi yêu cầu <Icon name="chevronRight" size={18} /></>}</button>
      </form>
      <p className="login-help">Đã có tài khoản? <Link to="/login">Đăng nhập</Link></p>
    </div></section>
  </main>;
}
