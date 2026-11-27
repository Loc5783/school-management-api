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

  const trimmedSchoolCode = schoolCode.trim().toUpperCase();
  const isSuperAdminFlow = trimmedSchoolCode.length === 0;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');

    try {
      const payload = {
        username: username.trim(),
        password
      };
      if (trimmedSchoolCode) {
        payload.schoolCode = trimmedSchoolCode;
      }

      const res = await api.post('/auth/login', payload);
      if (!res.data?.token) {
        setError('Không nhận được phiên đăng nhập từ máy chủ.');
        return;
      }

      // Luồng 1: Mã trường để trống & xác thực thành công Admin Tổng Đa Trường -> Vào thẳng /multi-school
      if (res.data.isSuperAdmin || res.data.user?.role === 'superadmin') {
        localStorage.setItem('superadmin_token', res.data.token);
        localStorage.setItem('superadmin_user', JSON.stringify(res.data.user));
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('user', JSON.stringify(res.data.user));
        localStorage.removeItem('tenant');
        localStorage.removeItem('last_school_code');
        navigate('/multi-school');
        return;
      }

      // Luồng 2: Đăng nhập vào không gian làm việc của một trường cụ thể
      localStorage.removeItem('superadmin_token');
      localStorage.removeItem('superadmin_user');
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      if (trimmedSchoolCode) {
        localStorage.setItem('last_school_code', trimmedSchoolCode);
      }
      if (res.data.tenant) {
        localStorage.setItem('tenant', JSON.stringify(res.data.tenant));
      } else {
        localStorage.removeItem('tenant');
      }

      const homeByRole = {
        parent: '/parent-portal',
        guard: '/guard',
        chef: '/kitchen',
        accountant: '/accounting',
        hr: '/hr'
      };
      navigate(homeByRole[res.data.user?.role] || '/dashboard');
    } catch (err) {
      const errCode = err.response?.data?.code;
      if (errCode === 'ACCOUNT_LOCKED') {
        setError('Tài khoản đã bị tạm khóa hoặc ngưng hoạt động. Vui lòng liên hệ quản trị hệ thống.');
      } else if (errCode === 'TENANT_SUSPENDED') {
        setError('Cơ sở trường học đang tạm ngừng hoạt động. Vui lòng liên hệ quản trị hệ thống.');
      } else {
        setError(err.response?.data?.message || 'Đăng nhập thất bại. Vui lòng kiểm tra lại thông tin tài khoản.');
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
          <span className="login-story-label">NỀN TẢNG QUẢN LÝ MẦM NON ĐA TRƯỜNG</span>
          <h1>Mọi việc của trường,<br /><em>gọn trong một nơi.</em></h1>
          <p>Hỗ trợ quản trị tập trung toàn hệ thống chuỗi trường, tài khoản độc lập từng trường và chia tách nhiều phân hiệu.</p>
        </div>

        <div className="login-platform-preview" aria-hidden="true">
          <div className="preview-heading">
            <span>Hôm nay tại Hoa Nắng</span>
            <span className="preview-live-badge"><i />Trực tuyến</span>
          </div>
          <div className="preview-main-row">
            <b>Vận hành thông suốt</b>
            <p>Dữ liệu điểm danh, sức khỏe, lớp học và bán trú được đồng bộ tức thời</p>
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
                <strong>Đa cơ sở</strong>
                <small>Trường & Phân hiệu</small>
              </div>
            </div>
            <div className="preview-metric-card">
              <span className="metric-icon amber"><Icon name="utensils" size={17} /></span>
              <div>
                <strong>An toàn</strong>
                <small>Bếp ăn & Y tế</small>
              </div>
            </div>
          </div>
        </div>

        <div className="login-highlights">
          <span><b><Icon name="attendance" size={18} /></b>Theo dõi điểm danh tức thời</span>
          <span><b><Icon name="shield" size={18} /></b>Mỗi trường 1 tài khoản riêng</span>
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
          <p className="login-intro">
            Nhập <strong>Mã trường</strong> để vào trường tương ứng, hoặc <strong>để trống Mã trường</strong> nếu đăng nhập tài khoản Admin Tổng.
          </p>

          <form onSubmit={handleSubmit} noValidate>
            <label className="login-field">
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <span>Mã trường học (School Code)</span>
                <small style={{ fontWeight: 600, fontSize: '11.5px', color: isSuperAdminFlow ? '#b45309' : '#64748b' }}>
                  {isSuperAdminFlow ? 'Đang để trống (Admin Tổng)' : 'Tài khoản trường'}
                </small>
              </span>
              <span className="login-input-wrap">
                <Icon name="classes" size={18} />
                <input
                  type="text"
                  autoComplete="organization"
                  value={schoolCode}
                  onChange={(event) => {
                    setSchoolCode(event.target.value.toUpperCase());
                    if (error) setError('');
                  }}
                  placeholder="Để trống nếu là Admin Tổng (VD trường: HOANANG-A)"
                  spellCheck="false"
                />
                {schoolCode && (
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => {
                      setSchoolCode('');
                      localStorage.removeItem('last_school_code');
                      if (error) setError('');
                    }}
                    title="Xóa mã trường để đăng nhập Admin Tổng"
                  >
                    Xóa
                  </button>
                )}
              </span>
            </label>

            <label className="login-field">
              <span>Tên đăng nhập</span>
              <span className="login-input-wrap">
                <Icon name="users" size={18} />
                <input
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    if (error) setError('');
                  }}
                  placeholder={isSuperAdminFlow ? 'Tài khoản Admin Tổng (VD: admin)' : 'Tên đăng nhập hoặc SĐT phụ huynh'}
                  required
                />
              </span>
            </label>

            <label className="login-field">
              <span>Mật khẩu</span>
              <span className="login-input-wrap">
                <Icon name="shield" size={18} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (error) setError('');
                  }}
                  placeholder="Nhập mật khẩu"
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                >
                  {showPassword ? 'Ẩn' : 'Hiện'}
                </button>
              </span>
            </label>

            <div className="login-options">
              <span className="login-remember-hint">
                <Icon name="check" size={14} />{' '}
                {isSuperAdminFlow
                  ? 'Chế độ Quản trị Tổng Đa Trường'
                  : `Vào trường ${trimmedSchoolCode} · Tự lưu mã trường`}
              </span>
              <a href="mailto:admin@hoanang.edu.vn">Cần hỗ trợ?</a>
            </div>

            {error && <p className="form-error" role="alert"><Icon name="alertCircle" size={16} />{error}</p>}
            <button className="button button-primary login-button" type="submit" disabled={loading}>
              {loading
                ? <><span className="loading-orb" />Đang xác thực...</>
                : <>Đăng nhập <Icon name="chevronRight" size={18} /></>}
            </button>
          </form>

          <div className="login-support"><Icon name="shield" size={17} /><span>Thông tin của bạn được bảo vệ an toàn.</span></div>
        </div>
      </section>
    </main>
  );
}
