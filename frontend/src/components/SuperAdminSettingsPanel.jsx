import { useEffect, useState } from 'react';
import Icon from './Icon';
import {
  getSuperAdminSystemSettings,
  updateSuperAdminSystemSettings
} from '../api/multiSchool';

const emptySettings = {
  branding: {
    systemName: 'Nền tảng Quản lý Mầm non Hoa Nắng SaaS',
    supportEmail: 'support@hoanang.edu.vn',
    supportHotline: '1900 6868'
  },
  systemBanner: {
    enabled: false,
    level: 'info',
    message: '',
    targetSchoolCodes: []
  },
  maintenanceMode: {
    enabled: false,
    message: 'Hệ thống máy chủ đang bảo trì nâng cấp định kỳ. Vui lòng quay lại sau ít phút.'
  },
  preschoolStandards: {
    defaultSchoolYear: '2026-2027',
    defaultMaxCampusesPerSchool: 10,
    defaultMaxStudentsPerSchool: 800,
    defaultMaxStaffPerSchool: 200
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
    systemBanner: {
      ...emptySettings.systemBanner,
      ...(raw.systemBanner || {}),
      targetSchoolCodes: Array.isArray(raw.systemBanner?.targetSchoolCodes)
        ? [...raw.systemBanner.targetSchoolCodes]
        : []
    },
    maintenanceMode: { ...emptySettings.maintenanceMode, ...(raw.maintenanceMode || {}) },
    preschoolStandards: { ...emptySettings.preschoolStandards, ...(raw.preschoolStandards || {}) },
    securityPolicy: { ...emptySettings.securityPolicy, ...(raw.securityPolicy || {}) }
  };
};

export default function SuperAdminSettingsPanel({ initialSettings, schools = [], onSaved }) {
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
          setNotice({ type: 'error', text: err.response?.data?.message || 'Không thể tải cấu hình nền tảng.' });
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

  const toggleBannerTargetSchool = (schoolCode) => {
    setForm((prev) => {
      const current = prev.systemBanner.targetSchoolCodes || [];
      const exists = current.includes(schoolCode);
      const nextCodes = exists ? current.filter((c) => c !== schoolCode) : [...current, schoolCode];
      return {
        ...prev,
        systemBanner: {
          ...prev.systemBanner,
          targetSchoolCodes: nextCodes
        }
      };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await updateSuperAdminSystemSettings(form);
      setNotice({ type: 'success', text: res.data?.message || 'Đã lưu cấu hình Nền tảng Phân phối Phần mềm.' });
      onSaved?.(res.data?.data);
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.message || 'Không thể lưu cấu hình hệ thống.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="inline-loader">Đang tải cấu hình nền tảng...</div>;
  }

  const targetCodes = form.systemBanner.targetSchoolCodes || [];

  return (
    <form className="student-form" autoComplete="off" onSubmit={handleSubmit}>
      {notice && (
        <div className={notice.type === 'error' ? 'form-error' : 'timekeeping-notice success'} style={{ marginBottom: '18px' }}>
          <Icon name={notice.type === 'error' ? 'alertCircle' : 'check'} size={17} />
          <span>{notice.text}</span>
        </div>
      )}

      {/* KHỐI 1: THÔNG TIN ĐƠN VỊ PHÂN PHỐI PHẦN MỀM & BANNER THÔNG BÁO ĐÚNG TRƯỜNG */}
      <section className="content-card" style={{ padding: '22px 24px', marginBottom: '18px' }}>
        <p className="card-kicker">1. ĐƠN VỊ PHÂN PHỐI PHẦN MỀM, SYSTEM BANNER & BẢO TRÌ MÁY CHỦ</p>
        <h2 style={{ margin: '4px 0 6px' }}>Thông tin Nền tảng SaaS & Kênh thông báo kỹ thuật</h2>
        <p style={{ margin: '0 0 18px', color: '#64748b', fontSize: '13.5px' }}>
          SuperAdmin chỉ quản lý hạ tầng phân phối phần mềm. Với thanh thông báo bảo trì/nâng cấp (System Banner), bạn có thể chọn <strong>chỉ hiển thị riêng cho một số trường chỉ định</strong> hoặc toàn bộ các trường đang sử dụng.
        </p>

        <div className="student-form-grid">
          <label>
            Tên Nền tảng Phần mềm SaaS *
            <input
              required
              maxLength={160}
              value={form.branding.systemName}
              onChange={(e) => setForm({ ...form, branding: { ...form.branding, systemName: e.target.value } })}
            />
          </label>
          <label>
            Email bộ phận hỗ trợ kỹ thuật
            <input
              type="email"
              value={form.branding.supportEmail}
              onChange={(e) => setForm({ ...form, branding: { ...form.branding, supportEmail: e.target.value } })}
            />
          </label>
          <label>
            Hotline kỹ thuật hỗ trợ các trường
            <input
              maxLength={40}
              value={form.branding.supportHotline}
              onChange={(e) => setForm({ ...form, branding: { ...form.branding, supportHotline: e.target.value } })}
            />
          </label>
          <label>
            Mức độ thanh thông báo System Banner
            <select
              value={form.systemBanner.level}
              onChange={(e) => setForm({ ...form, systemBanner: { ...form.systemBanner, level: e.target.value } })}
            >
              <option value="info">Thông báo nâng cấp / kỹ thuật (Màu xanh)</option>
              <option value="warning">Lưu ý lịch bảo trì / gia hạn gói (Màu vàng)</option>
              <option value="critical">Cảnh báo hạ tầng khẩn cấp (Màu đỏ)</option>
            </select>
          </label>

          <label className="form-wide" style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.systemBanner.enabled}
              onChange={(e) => setForm({ ...form, systemBanner: { ...form.systemBanner, enabled: e.target.checked } })}
            />
            <strong>Bật hiển thị thanh thông báo từ Nền tảng (System Banner) xuống trường sử dụng</strong>
          </label>

          <label className="form-wide">
            Nội dung thông báo kỹ thuật / bảo trì gửi trường
            <input
              maxLength={500}
              placeholder="VD: Hệ thống sẽ nâng cấp phiên bản mới vào 22h00 tối thứ Bảy tuần này."
              value={form.systemBanner.message}
              onChange={(e) => setForm({ ...form, systemBanner: { ...form.systemBanner, message: e.target.value } })}
            />
          </label>

          {schools.length > 0 && (
            <fieldset className="student-allergy-fieldset form-wide">
              <legend>
                Phạm vi trường nhận System Banner ({targetCodes.length === 0 ? 'Tất cả trường đang sử dụng' : `Chỉ ${targetCodes.length} trường được chọn`})
              </legend>
              <p style={{ margin: '0 0 10px', fontSize: 12.5, color: '#475569' }}>
                Để trống không tích trường nào nếu muốn phát tới tất cả các trường; hoặc tích chọn cụ thể để <strong>thông báo của trường nào chỉ hiển thị ở đúng trường đó</strong>.
              </p>
              <div className="superadmin-module-grid">
                {schools.map((s) => {
                  const checked = targetCodes.includes(s.code);
                  return (
                    <label key={s._id} className={`superadmin-module-Option ${checked ? 'checked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleBannerTargetSchool(s.code)}
                      />
                      <span><strong>{s.code}</strong> — {s.name}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          <label className="form-wide" style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginTop: '6px' }}>
            <input
              type="checkbox"
              checked={form.maintenanceMode.enabled}
              onChange={(e) => setForm({ ...form, maintenanceMode: { ...form.maintenanceMode, enabled: e.target.checked } })}
            />
            <strong style={{ color: form.maintenanceMode.enabled ? '#b91c1c' : undefined }}>
              Bật Chế độ Bảo trì Máy chủ Trung tâm (Tạm dừng đăng nhập phía các trường để nâng cấp hạ tầng)
            </strong>
          </label>

          {form.maintenanceMode.enabled && (
            <label className="form-wide">
              Nội dung hiển thị khi người dùng đăng nhập trong lúc bảo trì máy chủ
              <input
                maxLength={500}
                value={form.maintenanceMode.message}
                onChange={(e) => setForm({ ...form, maintenanceMode: { ...form.maintenanceMode, message: e.target.value } })}
              />
            </label>
          )}
        </div>
      </section>

      {/* KHỐI 2: HẠN MỨC MẶC ĐỊNH KHI CẤP PHÉP GÓI PHẦN MỀM CHO TRƯỜNG MỚI */}
      <section className="content-card" style={{ padding: '22px 24px', marginBottom: '18px' }}>
        <p className="card-kicker">2. CẤU HÌNH MẶC ĐỊNH GÓI CẤP PHÉP KHI TẠO TRƯỜNG MỚI (DEFAULT TENANT QUOTAS)</p>
        <h2 style={{ margin: '4px 0 6px' }}>Hạn mức tài nguyên mặc định cho đơn vị trường mới</h2>
        <p style={{ margin: '0 0 18px', color: '#64748b', fontSize: '13.5px' }}>
          Các quy định vận hành nội bộ (giờ đón trả trẻ, thực đơn bếp ăn, lịch học, thu chi) do Ban Giám hiệu & Admin của từng trường tự chủ thiết lập riêng trong không gian trường đó.
        </p>

        <div className="student-form-grid">
          <label>
            Năm học khởi tạo mặc định (YYYY-YYYY) *
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
            Hạn mức số Phân hiệu mặc định / 1 trường
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
            Hạn mức Học sinh mặc định / 1 trường
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
          <label>
            Hạn mức Nhân sự mặc định / 1 trường
            <input
              type="number"
              min={5}
              max={5000}
              value={form.preschoolStandards.defaultMaxStaffPerSchool || 200}
              onChange={(e) =>
                setForm({
                  ...form,
                  preschoolStandards: {
                    ...form.preschoolStandards,
                    defaultMaxStaffPerSchool: Number(e.target.value)
                  }
                })
              }
            />
          </label>
        </div>
      </section>

      {/* KHỐI 3: CHÍNH SÁCH BẢO MẬT HẠ TẦNG SAAS */}
      <section className="content-card" style={{ padding: '22px 24px', marginBottom: '18px' }}>
        <p className="card-kicker">3. BẢO MẬT HẠ TẦNG PHÂN PHỐI & CHỐNG QUÉT BOT PUBLIC</p>
        <h2 style={{ margin: '4px 0 6px' }}>Chính sách phiên đăng nhập & Lá chắn bảo vệ máy chủ</h2>

        <div className="student-form-grid">
          <label>
            Thời hạn phiên đăng nhập (Giờ: 1–72)
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
            Độ dài mật khẩu tối thiểu khi cấp Admin trường (6–32)
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
          <label className="form-wide" style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginTop: '4px' }}>
            <input
              type="checkbox"
              checked={form.securityPolicy.antiBotShieldEnabled}
              onChange={(e) =>
                setForm({
                  ...form,
                  securityPolicy: { ...form.securityPolicy, antiBotShieldEnabled: e.target.checked }
                })
              }
            />
            <strong>
              Bật Lá chắn Anti-Bot & Chống công cụ quét tự động (SQLMap, Nikto, Nuclei, dò `.env`, `.git`, `/wp-admin`)
            </strong>
          </label>
        </div>

        <div className="form-actions" style={{ marginTop: '18px' }}>
          <button type="submit" className="button button-primary" disabled={saving}>
            <Icon name="check" size={16} />
            {saving ? 'Đang lưu cấu hình...' : 'Lưu Cấu hình Nền tảng SaaS'}
          </button>
        </div>
      </section>
    </form>
  );
}
