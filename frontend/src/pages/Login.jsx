import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axiosConfig';
import Icon from '../components/Icon';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const handleSubmit = async (event) => {
    event.preventDefault(); setLoading(true); setError('');
    try { const res = await api.post('/auth/login', { username, password }); localStorage.setItem('token', res.data.token); localStorage.setItem('user', JSON.stringify(res.data.user)); navigate('/dashboard'); }
    catch (err) { setError(err.response?.data?.message || 'Đăng nhập thất bại. Vui lòng thử lại.'); }
    finally { setLoading(false); }
  };
  return <main className="login-page"><section className="login-presentation"><div className="login-brand"><span className="brand-mark"><span>H</span></span><span><strong>Hoa Nắng</strong><small>School Management</small></span></div><div className="presentation-copy"><p className="eyebrow">VẬN HÀNH TRƯỜNG HỌC HIỆU QUẢ</p><h1>Mỗi ngày đến trường<br /><em>là một ngày vui.</em></h1><p>Một không gian làm việc hiện đại, giúp nhà trường kết nối chặt chẽ với học sinh, giáo viên và phụ huynh.</p></div><div className="presentation-cards"><span><Icon name="check" size={18} />Theo dõi điểm danh tức thì</span><span><Icon name="check" size={18} />Quản lý tập trung, an toàn</span></div></section><section className="login-form-section"><div className="login-form-wrap"><div className="mobile-brand login-brand"><span className="brand-mark"><span>H</span></span><strong>Hoa Nắng</strong></div><p className="eyebrow">CHÀO MỪNG TRỞ LẠI</p><h2>Đăng nhập hệ thống</h2><p className="login-intro">Vui lòng nhập thông tin tài khoản của bạn để tiếp tục.</p><form onSubmit={handleSubmit}><label>Tên đăng nhập<input type="text" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Nhập tên đăng nhập" required /></label><label>Mật khẩu<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Nhập mật khẩu" required /></label>{error && <p className="form-error">{error}</p>}<button className="button button-primary login-button" type="submit" disabled={loading}>{loading ? 'Đang xác thực...' : <>Đăng nhập <Icon name="chevronRight" size={18} /></>}</button></form><p className="login-help">Cần hỗ trợ? Liên hệ quản trị viên nhà trường.</p></div></section></main>;
}
