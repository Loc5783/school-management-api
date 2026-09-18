import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axiosConfig';
import Icon from '../components/Icon';

export default function Register() {
  const [form, setForm] = useState({ username: '', password: '', fullName: '', phone: '', email: '', requestedClassroomId: '', registrationNote: '' });
  const [classrooms, setClassrooms] = useState([]);
  const [classroomsLoading, setClassroomsLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });
  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.get('/auth/registration-classrooms');
        setClassrooms(response.data.data || []);
      } catch (error) {
        setNotice({ type: 'error', text: error.response?.data?.message || 'Không thể tải lớp học. Vui lòng thử lại sau.' });
      } finally {
        setClassroomsLoading(false);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      const response = await api.post('/auth/register', {
        username: form.username,
        password: form.password,
        profile: { fullName: form.fullName, phone: form.phone, email: form.email },
        parentInfo: { requestedClassroomId: form.requestedClassroomId, registrationNote: form.registrationNote }
      });
      setNotice({ type: 'success', text: response.data.message });
      setForm({ username: '', password: '', fullName: '', phone: '', email: '', requestedClassroomId: '', registrationNote: '' });
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
        <label>Lớp của con cần liên kết<select value={form.requestedClassroomId} onChange={update('requestedClassroomId')} disabled={classroomsLoading} required><option value="">{classroomsLoading ? 'Đang tải lớp học...' : '-- Chọn lớp học --'}</option>{classrooms.map((classroom) => <option key={classroom._id} value={classroom._id}>{classroom.name}{classroom.fullName ? ` — ${classroom.fullName}` : ''}</option>)}</select><small>Nhà trường chỉ hiển thị học sinh thuộc lớp này khi xác minh.</small></label>
        <label>Tên con / ghi chú xác minh<textarea value={form.registrationNote} onChange={update('registrationNote')} placeholder="Ví dụ: Bé Nguyễn Minh An, phụ huynh là mẹ của bé. Vui lòng liên hệ xác minh." minLength="2" maxLength="500" required /><small>Thông tin này giúp nhà trường chọn đúng hồ sơ học sinh; chưa tạo quyền xem dữ liệu.</small></label>
        <label>Mật khẩu<input type="password" value={form.password} onChange={update('password')} autoComplete="new-password" minLength="8" maxLength="72" required /></label>
        {notice && <p className={notice.type === 'success' ? 'form-success' : 'form-error'}>{notice.text}</p>}
        <button className="button button-primary login-button" type="submit" disabled={submitting}>{submitting ? 'Đang gửi...' : <>Gửi yêu cầu <Icon name="chevronRight" size={18} /></>}</button>
      </form>
      <p className="login-help">Đã có tài khoản? <Link to="/login">Đăng nhập</Link></p>
    </div></section>
  </main>;
}
