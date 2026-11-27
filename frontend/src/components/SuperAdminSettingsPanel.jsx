import { useEffect, useState } from 'react';
import Icon from './Icon';
import {
  getSuperAdminSystemSettings,
  updateSuperAdminSystemSettings
} from '../api/multiSchool';

const emptySettings = {
  branding: {
    systemName: 'Hệ thống Giáo dục Mầm non Hoa Nắng',
    supportEmail: 'admin@hoanang.edu.vn',
    supportHotline: '1900 6868'
  },
  systemBanner: {
    enabled: false,
    level: 'info',
    message: ''
  },
  maintenanceMode: {
    enabled: false,
    message: 'Hệ thống đang bảo trì nâng cấp định kỳ. Vui lòng quay lại sau ít phút.'
  },
  preschoolStandards: {
    defaultSchoolYear: '2026-2027',
    standardCheckInTime: '07:00',
    standardCheckOutTime: '16:30',
    accountingCloseDay: 5,
    referenceCaloriesPerDay: 1250,
    foodSampleRetentionHours: 24,
    defaultMaxCampusesPerSchool: 10,
    defaultMaxStudentsPerSchool: 800
  },
  securityPolicy: {
    sessionTimeoutHours: 8,
    minPasswordLength: 6,
    antiBotShieldEnabled: true
  }
};

const mergeWithDefaults = (raw) => {
  if (!raw) return emptySettings;
  return {
    branding: { ...emptySettings.branding, ...(raw.branding || {}) },
    systemBanner: { ...emptySettings.systemBanner, ...(raw.systemBanner || {}) },
    maintenanceMode: { ...emptySettings.maintenanceMode, ...(raw.maintenanceMode || {}) },
    preschoolStandards: { ...emptySettings.preschoolStandards, ...(raw.preschoolStandards || {}) },
    securityPolicy: { ...emptySettings.securityPolicy, ...(raw.securityPolicy || {}) }
  };
};

export default function SuperAdminSettingsPanel({ initialSettings, onSaved }) {
  const [form, setForm] = useState(() => mergeWithDefaults(initialSettings));
  const [loading, setLoading] = useState(!initialSettings);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (initialSettings) return undefined;

    let cancelled = false;
    const load = async () => {
      try {
        const res = await getSuperAdminSystemSettings();
        const data = res.data?.data;
        if (!cancelled && data) {
          setForm(mergeWithDefaults(data));
        }
      } catch (err) {
        if (!cancelled) {
          setNotice({ type: 'error', text: err.response?.data?.message || 'Không thể tải cấu hình hệ thống.' });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [initialSettings]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await updateSuperAdminSystemSettings(form);
      setNotice({ type: 'success', text: res.data?.message || 'Đã lưu cấu hình chung toàn hệ thống.' });
      onSaved?.(res.data?.data);
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.message || 'Không thể lưu cấu hình hệ thống.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="inline-loader">Đang tải cấu hình chung hệ thống...</div>;
  }

  return (
    <form className="student-form" onSubmit={handleSubmit}>
      {notice && (
        <div className={notice.type === 'error' ? 'form-error' : 'timekeeping-notice success'} style={{ marginBottom: '18px' }}>
          <Icon name={notice.type === 'error' ? 'alertCircle' : 'check'} size={17} />
          <span>{notice.text}</span>
        </div>
      )}

      {/* KHỐI 1: THƯƠNG HIỆU, SYSTEM BANNER & BẢO TRÌ TOÀN CHUỖI */}
      <section className="content-card" style={{ padding: '22px 24px', marginBottom: '18px' }}>
        <p className="card-kicker">1. THƯƠNG HIỆU, THÔNG BÁO TOÀN HỆ THỐNG & CHẾ ĐỘ BẢO TRÌ</p>
        <h2 style={{ margin: '4px 0 6px' }}>Điều phối thông tin chung xuống tất cả các trường</h2>
        <p style={{ margin: '0 0 18px', color: '#64748b', fontSize: '13.5px' }}>
          Khi bật <strong>System Banner</strong>, thanh thông báo sẽ xuất hiện ngay trên đầu giao diện làm việc của mọi trường trong chuỗi.
        </p>

        <div className="student-form-grid">
          <label>
            Tên thương hiệu Hệ thống chuỗi trường *
            <input
              required
              maxLength={160}
              value={form.branding.systemName}
              onChange={(e) => setForm({ ...form, branding: { ...form.branding, systemName: e.target.value } })}
            />
          </label>
          <label>
            Email hỗ trợ kỹ thuật trung tâm
            <input
              type="email"
              value={form.branding.supportEmail}
              onChange={(e) => setForm({ ...form, branding: { ...form.branding, supportEmail: e.target.value } })}
            />
          </label>
          <label>
            Hotline tổng đài hỗ trợ
            <input
              maxLength={40}
              value={form.branding.supportHotline}
              onChange={(e) => setForm({ ...form, branding: { ...form.branding, supportHotline: e.target.value } })}
            />
          </label>
          <label>
            Mức độ thông báo System Banner
            <select
              value={form.systemBanner.level}
              onChange={(e) => setForm({ ...form, systemBanner: { ...form.systemBanner, level: e.target.value } })}
            >
              <option value="info">Thông tin chung (Màu xanh)</option>
              <option value="warning">Lưu ý / Nhắc lịch chốt sổ (Màu vàng)</option>
              <option value="critical">Cảnh báo khẩn cấp toàn chuỗi (Màu đỏ)</option>
            </select>
          </label>

          <label className="form-wide" style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              style={{ width: '18px', height: '18px' }}
              checked={form.systemBanner.enabled}
              onChange={(e) => setForm({ ...form, systemBanner: { ...form.systemBanner, enabled: e.target.checked } })}
            />
            <strong>Bật hiển thị System Banner tới toàn bộ các trường học trực thuộc</strong>
          </label>

          <label className="form-wide">
            Nội dung System Banner gửi các trường
            <input
              maxLength={500}
              placeholder="VD: Đề nghị các trường hoàn tất khóa sổ kế toán kỳ tháng 11 trước 17h00 ngày 05/12."
              value={form.systemBanner.message}
              onChange={(e) => setForm({ ...form, systemBanner: { ...form.systemBanner, message: e.target.value } })}
            />
          </label>

          <label className="form-wide" style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginTop: '6px' }}>
            <input
              type="checkbox"
              style={{ width: '18px', height: '18px' }}
              checked={form.maintenanceMode.enabled}
              onChange={(e) => setForm({ ...form, maintenanceMode: { ...form.maintenanceMode, enabled: e.target.checked } })}
            />
            <strong style={{ color: form.maintenanceMode.enabled ? '#b91c1c' : undefined }}>
              Kích hoạt Chế độ Bảo trì Toàn Hệ thống (Tạm khóa truy cập của các trường, chỉ SuperAdmin hoạt động)
            </strong>
          </label>

          {form.maintenanceMode.enabled && (
            <label className="form-wide">
              Thông báo hiển thị khi người dùng trường đăng nhập lúc bảo trì
              <input
                maxLength={500}
                value={form.maintenanceMode.message}
                onChange={(e) => setForm({ ...form, maintenanceMode: { ...form.maintenanceMode, message: e.target.value } })}
              />
            </label>
          )}
        </div>
      </section>

      {/* KHỐI 2: THAM SỐ CHUẨN MẦM NON TOÀN HỆ THỐNG */}
      <section className="content-card" style={{ padding: '22px 24px', marginBottom: '18px' }}>
        <p className="card-kicker">2. QUY CHUẨN NGHIỆP VỤ MẦM NON & HẠN MỨC MẶC ĐỊNH</p>
        <h2 style={{ margin: '4px 0 6px' }}>Tham số chuẩn áp dụng khi khởi tạo trường & phân hiệu mới</h2>
        <p style={{ margin: '0 0 18px', color: '#64748b', fontSize: '13.5px' }}>
          Đảm bảo mọi cơ sở trong chuỗi tuân thủ thống nhất chuẩn năm học, khung giờ đón–trả, định mức dinh dưỡng và lưu mẫu ATTP 24h.
        </p>

        <div className="student-form-grid">
          <label>
            Năm học mặc định toàn chuỗi (YYYY-YYYY) *
            <input
              required
              placeholder="2026-2027"
              value={form.preschoolStandards.defaultSchoolYear}
              onChange={(e) =>
                setForm({
                  ...form,
                  preschoolStandards: { ...form.preschoolStandards, defaultSchoolYear: e.target.value }
                })
              }
            />
          </label>
          <label>
            Ngày khóa sổ kế toán hàng tháng (1–28)
            <input
              type="number"
              min={1}
              max={28}
              value={form.preschoolStandards.accountingCloseDay}
              onChange={(e) =>
                setForm({
                  ...form,
                  preschoolStandards: { ...form.preschoolStandards, accountingCloseDay: Number(e.target.value) }
                })
              }
            />
          </label>
          <label>
            Giờ mở cửa đón trẻ chuẩn
            <input
              type="time"
              value={form.preschoolStandards.standardCheckInTime}
              onChange={(e) =>
                setForm({
                  ...form,
                  preschoolStandards: { ...form.preschoolStandards, standardCheckInTime: e.target.value }
                })
              }
            />
          </label>
          <label>
            Giờ trả trẻ chuẩn chiều
            <input
              type="time"
              value={form.preschoolStandards.standardCheckOutTime}
              onChange={(e) =>
                setForm({
                  ...form,
                  preschoolStandards: { ...form.preschoolStandards, standardCheckOutTime: e.target.value }
                })
              }
            />
          </label>
          <label>
            Định mức năng lượng tham chiếu (Kcal/trẻ/ngày)
            <input
              type="number"
              min={600}
              max={2500}
              value={form.preschoolStandards.referenceCaloriesPerDay}
              onChange={(e) =>
                setForm({
                  ...form,
                  preschoolStandards: { ...form.preschoolStandards, referenceCaloriesPerDay: Number(e.target.value) }
                })
              }
            />
          </label>
          <label>
            Thời gian lưu mẫu thức ăn tối thiểu (giờ, chuẩn ATTP &ge; 24h)
            <input
              type="number"
              min={24}
              max={72}
              value={form.preschoolStandards.foodSampleRetentionHours}
              onChange={(e) =>
                setForm({
                  ...form,
                  preschoolStandards: { ...form.preschoolStandards, foodSampleRetentionHours: Number(e.target.value) }
                })
              }
            />
          </label>
          <label>
            Hạn mức Phân hiệu mặc định / 1 trường mới
            <input
              type="number"
              min={1}
              max={100}
              value={form.preschoolStandards.defaultMaxCampusesPerSchool}
              onChange={(e) =>
                setForm({
                  ...form,
                  preschoolStandards: {
                    ...form.preschoolStandards,
                    defaultMaxCampusesPerSchool: Number(e.target.value)
                  }
                })
              }
            />
          </label>
          <label>
            Hạn mức Học sinh mặc định / 1 trường mới
            <input
              type="number"
              min={10}
              max={20000}
              value={form.preschoolStandards.defaultMaxStudentsPerSchool}
              onChange={(e) =>
                setForm({
                  ...form,
                  preschoolStandards: {
                    ...form.preschoolStandards,
                    defaultMaxStudentsPerSchool: Number(e.target.value)
                  }
                })
              }
            />
          </label>
        </div>
      </section>

      {/* KHỐI 3: CHÍNH SÁCH BẢO MẬT & CHỐNG BOT */}
      <section className="content-card" style={{ padding: '22px 24px', marginBottom: '18px' }}>
        <p className="card-kicker">3. AN NINH HỆ THỐNG & CHÍNH SÁCH XÁC THỰC</p>
        <h2 style={{ margin: '4px 0 6px' }}>Kiểm soát phiên đăng nhập & Lá chắn chống Bot quét Public</h2>

        <div className="student-form-grid" style={{ marginTop: '14px' }}>
          <label>
            Thời hạn phiên đăng nhập trường học (giờ, 1–72h)
            <input
              type="number"
              min={1}
              max={72}
              value={form.securityPolicy.sessionTimeoutHours}
              onChange={(e) =>
                setForm({
                  ...form,
                  securityPolicy: { ...form.securityPolicy, sessionTimeoutHours: Number(e.target.value) }
                })
              }
            />
          </label>
          <label>
            Độ dài mật khẩu tối thiểu khi cấp/đổi mật khẩu (6–32 ký tự)
            <input
              type="number"
              min={6}
              max={32}
              value={form.securityPolicy.minPasswordLength}
              onChange={(e) =>
                setForm({
                  ...form,
                  securityPolicy: { ...form.securityPolicy, minPasswordLength: Number(e.target.value) }
                })
              }
            />
          </label>
          <label className="form-wide" style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              style={{ width: '18px', height: '18px' }}
              checked={form.securityPolicy.antiBotShieldEnabled}
              onChange={(e) =>
                setForm({
                  ...form,
                  securityPolicy: { ...form.securityPolicy, antiBotShieldEnabled: e.target.checked }
                })
              }
            />
            <strong>Kích hoạt Lá chắn Anti-Bot, Chặn Scanner lỗ hổng (/.env, *.php, sqlmap...) & Honeypot Login</strong>
          </label>
        </div>

        <div className="form-actions" style={{ marginTop: '20px' }}>
          <button type="submit" className="button button-primary" disabled={saving}>
            {saving ? 'Đang lưu cấu hình...' : 'Lưu toàn bộ Cấu hình Hệ thống'}
          </button>
        </div>
      </section>
    </form>
  );
}
