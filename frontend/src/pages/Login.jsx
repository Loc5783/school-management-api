import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axiosConfig';
import Icon from '../components/Icon';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [schoolCode, setSchoolCode] = useState('');
  const [showSchoolCodeField, setShowSchoolCodeField] = useState(false);
  const [hpWebsite, setHpWebsite] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const schoolCodeInputRef = useRef(null);
  const navigate = useNavigate();

  const trimmedSchoolCode = schoolCode.trim().toUpperCase();

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');

    try {
      const payload = {
        username: username.trim(),
        password,
        ...(hpWebsite ? { _hp_website: hpWebsite } : {})
      };
      if (trimmedSchoolCode) {
        payload.schoolCode = trimmedSchoolCode;
      }

      const res = await api.post('/auth/login', payload);
      if (!res.data?.token) {
        setError('Không nhận được phiên đăng nhập từ máy chủ.');
        return;
      }

      // Tự động điều hướng theo đúng vai trò (Role) của tài khoản vừa đăng nhập
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

      localStorage.removeItem('superadmin_token');
      localStorage.removeItem('superadmin_user');
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));

      const resolvedSchoolCode = res.data.tenant?.code || trimmedSchoolCode;
      if (resolvedSchoolCode) {
        localStorage.setItem('last_school_code', resolvedSchoolCode);
      }
      if (res.data.tenant) {
        localStorage.setItem('tenant', JSON.stringify(res.data.tenant));
      } else {
        localStorage.removeItem('tenant');
      }

      const homeByRole = {
        admin: '/campuses',
        principal: '/principal',
        teacher: '/dashboard',
        parent: '/parent-dashboard',
        guard: '/guard',
        chef: '/kitchen',
        accountant: '/accounting',
        hr: '/hr'
      };
      navigate(homeByRole[res.data.user?.role] || '/dashboard');
    } catch (err) {
      const errCode = err.response?.data?.code;
      if (errCode === 'SCHOOL_CODE_REQUIRED') {
        setShowSchoolCodeField(true);
        setError(err.response?.data?.message || 'Tài khoản trùng ở nhiều trường, vui lòng nhập thêm Mã trường học.');
        setTimeout(() => schoolCodeInputRef.current?.focus(), 60);
      } else if (errCode === 'ACCOUNT_LOCKED') {
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
          <span><b><Icon name="shield" size={18} /></b>Tự động nhận diện vai trò</span>
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
            Nhập tài khoản và mật khẩu — hệ thống tự động nhận diện vai trò và chuyển vào đúng giao diện làm việc.
          </p>

          <form onSubmit={handleSubmit} noValidate>
            {/* Trường Honeypot ẩn chống Bot tự động điền form đăng nhập */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}>
              <label>
                Website
                <input
                  type="text"
                  name="_hp_website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={hpWebsite}
                  onChange={(e) => setHpWebsite(e.target.value)}
                />
              </label>
            </div>

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
                  placeholder="Tên đăng nhập, email hoặc SĐT phụ huynh"
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

            {showSchoolCodeField && (
              <label className="login-field">
                <span>Mã trường học (tùy chọn)</span>
                <span className="login-input-wrap">
                  <Icon name="classes" size={18} />
                  <input
                    ref={schoolCodeInputRef}
                    type="text"
                    autoComplete="organization"
                    value={schoolCode}
                    onChange={(event) => {
                      setSchoolCode(event.target.value.toUpperCase());
                      if (error) setError('');
                    }}
                    placeholder="VD: HOANANG-A (để trống nếu là Admin Tổng)"
                    spellCheck="false"
                  />
                  {schoolCode && (
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => {
                        setSchoolCode('');
                        if (error) setError('');
                      }}
                    >
                      Xóa
                    </button>
                  )}
                </span>
              </label>
            )}

            <div className="login-options">
              <button
                type="button"
                onClick={() => setShowSchoolCodeField((prev) => !prev)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: '#4f46e5',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {showSchoolCodeField ? 'Ẩn ô Mã trường học' : 'Nhập Mã trường học (nếu trùng tài khoản)'}
              </button>
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
