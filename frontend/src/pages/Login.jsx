import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axiosConfig';
import Icon from '../components/Icon';

export default function Login() {
  const [schoolCode, setSchoolCode] = useState(() => localStorage.getItem('last_school_code') || '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const payload = {
        username: username.trim(),
        password
      };
      if (schoolCode.trim()) {
        payload.schoolCode = schoolCode.trim().toUpperCase();
      }

      const res = await api.post('/auth/login', payload);
      if (!res.data.token) {
        setError('Không nhận được phiên đăng nhập từ máy chủ.');
        return;
      }

      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      if (payload.schoolCode) {
        localStorage.setItem('last_school_code', payload.schoolCode);
      }
      if (res.data.tenant) {
        localStorage.setItem('tenant', JSON.stringify(res.data.tenant));
      } else {
        localStorage.removeItem('tenant');
      }

      const homeByRole = { parent: '/parent-portal', guard: '/guard', chef: '/kitchen', accountant: '/accounting', hr: '/hr' };
      navigate(homeByRole[res.data.user?.role] || '/dashboard');
    } catch (err) {
      const errCode = err.response?.data?.code;
      if (errCode === 'ACCOUNT_LOCKED') {
        setError('Tài khoản đã bị tạm khóa do nhập sai thông tin nhiều lần. Vui lòng thử lại sau.');
      } else if (errCode === 'TENANT_SUSPENDED') {
        setError('Cơ sở trường học đang tạm ngừng hoạt động. Vui lòng liên hệ quản trị hệ thống.');
      } else {
        setError(err.response?.data?.message || 'Đăng nhập thất bại. Vui lòng kiểm tra lại mã trường, tên đăng nhập và mật khẩu.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-page login-page-refresh">
      <section className="login-presentation" aria-label="Giới thiệu hệ thống Hoa Nắng">
        <div className="login-glow glow-one" />
        <div className="login-glow glow-two" />

        <div className="login-brand">
          <span className="brand-mark"><span>H</span></span>
          <span><strong>Hoa Nắng</strong><small>School Management</small></span>
        </div>

        <div className="presentation-copy">
          <span className="login-story-label">NỀN TẢNG QUẢN LÝ MẦM NON</span>
          <h1>Mọi việc của trường,<br /><em>gọn trong một nơi.</em></h1>
          <p>Hoa Nắng giúp nhà trường phối hợp rõ ràng giữa Ban giám hiệu, giáo viên, nhân viên và phụ huynh.</p>
        </div>

        <div className="login-platform-preview" aria-hidden="true">
          <div className="preview-heading">
            <span>Hôm nay tại Hoa Nắng</span>
            <span className="preview-live-badge"><i />Trực tuyến</span>
          </div>
          <div className="preview-main-row">
            <b>Vận hành thông suốt</b>
            <p>Dữ liệu điểm danh, lớp học và bán trú được đồng bộ tức thời</p>
          </div>
          <div className="preview-metrics-grid">
            <div className="preview-metric-card">
              <span className="metric-icon green"><Icon name="attendance" size={17} /></span>
              <div>
                <strong>98.5%</strong>
                <small>Điểm danh</small>
              </div>
            </div>
            <div className="preview-metric-card">
              <span className="metric-icon blue"><Icon name="classes" size={17} /></span>
              <div>
                <strong>100%</strong>
                <small>Lớp học</small>
              </div>
            </div>
            <div className="preview-metric-card">
              <span className="metric-icon amber"><Icon name="utensils" size={17} /></span>
              <div>
                <strong>An toàn</strong>
                <small>Bếp ăn</small>
              </div>
            </div>
          </div>
        </div>

        <div className="login-highlights">
          <span><b><Icon name="attendance" size={18} /></b>Theo dõi điểm danh tức thời</span>
          <span><b><Icon name="shield" size={18} /></b>Quản lý tập trung, an toàn</span>
          <span><b><Icon name="users" size={18} /></b>Kết nối nhà trường và phụ huynh</span>
        </div>
      </section>

      <section className="login-form-section">
        <div className="login-form-wrap">
          <div className="mobile-brand login-brand">
            <span className="brand-mark"><span>H</span></span>
            <span><strong>Hoa Nắng</strong><small>School Management</small></span>
          </div>

          <div className="login-welcome-icon"><Icon name="shield" size={22} /></div>
          <p className="eyebrow">CHÀO MỪNG TRỞ LẠI</p>
          <h2>Đăng nhập hệ thống</h2>
          <p className="login-intro">Nhập thông tin tài khoản để tiếp tục phiên làm việc của bạn.</p>

          <form onSubmit={handleSubmit} noValidate>
            <label className="login-field">
              <span>Mã trường học (School Code)</span>
              <span className="login-input-wrap">
                <Icon name="classes" size={18} />
                <input
                  type="text"
                  autoComplete="organization"
                  value={schoolCode}
                  onChange={(event) => setSchoolCode(event.target.value.toUpperCase())}
                  placeholder="VD: HOANANG-A"
                  spellCheck="false"
                />
              </span>
            </label>

            <label className="login-field">
              <span>Tên đăng nhập</span>
              <span className="login-input-wrap">
                <Icon name="users" size={18} />
                <input type="text" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Nhập tên đăng nhập" required />
              </span>
            </label>

            <label className="login-field">
              <span>Mật khẩu</span>
              <span className="login-input-wrap">
                <Icon name="shield" size={18} />
                <input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Nhập mật khẩu" required />
                <button type="button" className="password-toggle" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>{showPassword ? 'Ẩn' : 'Hiện'}</button>
              </span>
            </label>

            <div className="login-options">
              <label className="show-password"><input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} /> <span>Hiển thị mật khẩu</span></label>
              <a href="mailto:admin@hoanang.edu.vn">Cần hỗ trợ?</a>
            </div>

            {error && <p className="form-error" role="alert"><Icon name="alertCircle" size={16} />{error}</p>}
            <button className="button button-primary login-button" type="submit" disabled={loading}>
              {loading ? <><span className="loading-orb" />Đang xác thực...</> : <>Đăng nhập <Icon name="chevronRight" size={18} /></>}
            </button>
          </form>

          <div className="login-support"><Icon name="shield" size={17} /><span>Thông tin của bạn được bảo vệ an toàn.</span></div>
        </div>
      </section>
    </main>
  );
}
