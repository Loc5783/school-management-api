import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import {
  changeSuperAdminPassword,
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

const BANNER_LEVEL_LABELS = {
  info: 'Thông báo nâng cấp / kỹ thuật (Màu xanh)',
  warning: 'Lưu ý lịch bảo trì / gia hạn gói (Màu vàng)',
  critical: 'Cảnh báo hạ tầng khẩn cấp (Màu đỏ)'
};

/**
 * Trang Cấu hình Nền tảng Phân phối Phần mềm SaaS dành cho Tổng Admin (`SuperAdmin`).
 *
 * Bố cục 2 cột chuẩn mực:
 * - Cột chính bên trái: 3 thẻ cấu hình nền tảng + thanh trạng thái thay đổi + thẻ đổi mật khẩu SuperAdmin.
 * - Cột phải cố định (Sticky): Tóm tắt trực quan các thông số hạ tầng đang áp dụng và lối tắt điều hành.
 */
export default function SuperAdminSettingsPanel({
  initialSettings,
  schools = [],
  superUser = null,
  onSaved,
  onSuperUserUpdated,
  onNavigateSection
}) {
  const [form, setForm] = useState(() => mergeWithDefaults(initialSettings));
  const [savedSnapshot, setSavedSnapshot] = useState(() => mergeWithDefaults(initialSettings));
  const [loading, setLoading] = useState(!initialSettings);
  const [saving, setSaving] = useState(false);
  const savingLockRef = useRef(false);
  const [notice, setNotice] = useState(null);

  // Form đổi mật khẩu & tài khoản SuperAdmin ngay tại trang Cài đặt Hệ thống
  const [secForm, setSecForm] = useState({
    newUsername: null,
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [savingSec, setSavingSec] = useState(false);
  const savingSecLockRef = useRef(false);
  const [secNotice, setSecNotice] = useState(null);
  const [showSecPwd, setShowSecPwd] = useState({ current: false, next: false, confirm: false });

  const effectiveSecUsername = secForm.newUsername ?? (superUser?.username || 'admin');

  useEffect(() => {
    if (initialSettings) return undefined;

    let cancelled = false;
    const load = async () => {
      try {
        const res = await getSuperAdminSystemSettings();
        const data = res.data?.data;
        if (!cancelled && data) {
          const merged = mergeWithDefaults(data);
          setForm(merged);
          setSavedSnapshot(merged);
        }
      } catch (err) {
        if (!cancelled) {
          setNotice({
            type: 'error',
            text: err.response?.data?.message || 'Không thể tải cấu hình nền tảng. Vui lòng bấm Làm mới số liệu để thử lại.'
          });
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

  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(savedSnapshot),
    [form, savedSnapshot]
  );

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

  const handleResetChanges = () => {
    if (saving) return;
    setForm(savedSnapshot);
    setNotice(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Chặn bấm đúp đồng bộ bằng ref ngay trong cùng 1 frame trước khi React kịp re-render
    if (savingLockRef.current || saving) return;
    savingLockRef.current = true;
    setSaving(true);
    setNotice(null);
    try {
      const res = await updateSuperAdminSystemSettings(form);
      const updated = res.data?.data ? mergeWithDefaults(res.data.data) : form;
      setForm(updated);
      setSavedSnapshot(updated);
      setNotice({
        type: 'success',
        text: res.data?.message || 'Đã lưu thành công cấu hình Nền tảng Phân phối Phần mềm SaaS!'
      });
      onSaved?.(res.data?.data);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setNotice({
        type: 'error',
        text: err.response?.data?.message || 'Không thể lưu cấu hình hệ thống. Vui lòng kiểm tra lại dữ liệu vừa nhập.'
      });
    } finally {
      savingLockRef.current = false;
      setSaving(false);
    }
  };

  const handleSaveSuperAdminCredentials = async (e) => {
    e.preventDefault();
    if (savingSecLockRef.current || savingSec) return;
    if (secForm.newPassword.length < 6) {
      setSecNotice({ type: 'error', text: 'Mật khẩu mới cần có ít nhất 6 ký tự.' });
      return;
    }
    if (secForm.newPassword !== secForm.confirmPassword) {
      setSecNotice({ type: 'error', text: 'Mật khẩu xác nhận chưa trùng khớp với mật khẩu mới.' });
      return;
    }

    savingSecLockRef.current = true;
    setSavingSec(true);
    setSecNotice(null);
    try {
      const res = await changeSuperAdminPassword({
        newUsername: effectiveSecUsername.trim(),
        currentPassword: secForm.currentPassword,
        newPassword: secForm.newPassword
      });
      if (res.data?.token && res.data?.user) {
        localStorage.setItem('superadmin_token', res.data.token);
        localStorage.setItem('superadmin_user', JSON.stringify(res.data.user));
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('user', JSON.stringify(res.data.user));
        onSuperUserUpdated?.(res.data.user);
      }
      setSecForm({ newUsername: res.data?.user?.username ?? effectiveSecUsername.trim(), currentPassword: '', newPassword: '', confirmPassword: '' });
      setSecNotice({
        type: 'success',
        text: 'Đã cập nhật tài khoản & mật khẩu Quản trị Tổng thành công (các phiên đăng nhập cũ đã được thu hồi).'
      });
    } catch (err) {
      setSecNotice({
        type: 'error',
        text: err.response?.data?.message || 'Không thể cập nhật mật khẩu SuperAdmin. Vui lòng kiểm tra mật khẩu hiện tại.'
      });
    } finally {
      savingSecLockRef.current = false;
      setSavingSec(false);
    }
  };

  if (loading) {
    return (
      <div className="content-card inline-loader">
        <span className="loading-orb" />
        Đang tải thông số cấu hình nền tảng SaaS...
      </div>
    );
  }

  const targetCodes = form.systemBanner.targetSchoolCodes || [];
  const allSchoolCodes = schools.map((s) => s.code).filter(Boolean);

  return (
    <div className="hn-campus-settings-layout">
      <div className="hn-campus-settings-form">
        {notice && (
          <div
            className={notice.type === 'error' ? 'form-error' : 'timekeeping-notice success'}
            role="status"
            style={{ marginBottom: 0, fontSize: 13.5 }}
          >
            <Icon name={notice.type === 'error' ? 'alertCircle' : 'check'} size={17} />
            <span>{notice.text}</span>
          </div>
        )}

        <form className="hn-campus-settings-form" autoComplete="off" onSubmit={handleSubmit}>
          {/* KHỐI 1: THÔNG TIN ĐƠN VỊ CUNG CẤP PHẦN MỀM & LIÊN HỆ KỸ THUẬT */}
          <section className="hn-form-section-card">
            <div className="hn-section-head">
              <span className="hn-section-icon blue">
                <Icon name="shield" size={20} />
              </span>
              <div>
                <h3>1. Thương hiệu Nền tảng SaaS &amp; Kênh Hỗ trợ Kỹ thuật</h3>
                <p>
                  Thông tin đơn vị cung cấp phần mềm hiển thị trên thanh tiêu đề trung tâm và chân trang hỗ trợ kỹ thuật của các trường thành viên.
                </p>
              </div>
            </div>

            <div className="hn-fields-stack">
              <div className="hn-field">
                <label className="hn-field-label" htmlFor="sa-system-name">
                  Tên Nền tảng Phần mềm SaaS <span className="hn-field-req">*</span>
                </label>
                <input
                  id="sa-system-name"
                  required
                  maxLength={160}
                  placeholder="VD: Hệ thống Giáo dục Mầm non Hoa Nắng"
                  value={form.branding.systemName}
                  onChange={(e) => setForm({ ...form, branding: { ...form.branding, systemName: e.target.value } })}
                />
              </div>

              <div className="hn-grid-2">
                <div className="hn-field">
                  <label className="hn-field-label" htmlFor="sa-support-email">
                    Email bộ phận hỗ trợ kỹ thuật
                  </label>
                  <input
                    id="sa-support-email"
                    type="email"
                    placeholder="support@hoanang.edu.vn"
                    value={form.branding.supportEmail}
                    onChange={(e) => setForm({ ...form, branding: { ...form.branding, supportEmail: e.target.value } })}
                  />
                  <span className="hn-field-hint">Nhận yêu cầu hỗ trợ kỹ thuật từ Ban Giám hiệu các trường</span>
                </div>

                <div className="hn-field">
                  <label className="hn-field-label" htmlFor="sa-support-hotline">
                    Hotline kỹ thuật hỗ trợ các trường
                  </label>
                  <input
                    id="sa-support-hotline"
                    maxLength={40}
                    placeholder="VD: 1900 6868 hoặc 0912 345 678"
                    value={form.branding.supportHotline}
                    onChange={(e) =>
                      setForm({ ...form, branding: { ...form.branding, supportHotline: e.target.value } })
                    }
                  />
                  <span className="hn-field-hint">Số tổng đài trực sự cố phần mềm &amp; kết nối máy chấm công</span>
                </div>
              </div>
            </div>
          </section>

          {/* KHỐI 2: THANH THÔNG BÁO SYSTEM BANNER & CHẾ ĐỘ BẢO TRÌ TRUNG TÂM */}
          <section className="hn-form-section-card">
            <div className="hn-section-head">
              <span className="hn-section-icon amber">
                <Icon name="bell" size={20} />
              </span>
              <div>
                <h3>2. Thanh Thông báo Nền tảng (System Banner) &amp; Bảo trì Máy chủ</h3>
                <p>
                  Phát thông báo lịch nâng cấp đến toàn chuỗi hoặc <strong>chỉ hiển thị riêng tại các trường được chọn</strong>, và điều khiển chế độ bảo trì hạ tầng trung tâm.
                </p>
              </div>
            </div>

            <div className="hn-fields-stack">
              <label className={`hn-switch-card ${form.systemBanner.enabled ? 'is-on' : ''}`}>
                <div className="hn-switch-copy">
                  <strong>Bật hiển thị thanh thông báo từ Nền tảng (System Banner) xuống trường sử dụng</strong>
                  <span>
                    Khi bật, thanh thông báo sẽ xuất hiện ngay dưới thanh tiêu đề của các trường thuộc phạm vi nhận bên dưới.
                  </span>
                </div>
                <input
                  type="checkbox"
                  className="hn-switch-input"
                  checked={form.systemBanner.enabled}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      systemBanner: { ...form.systemBanner, enabled: e.target.checked }
                    })
                  }
                />
                <span className="hn-switch-pill" aria-hidden="true" />
              </label>

              <div className="hn-grid-contact-bottom">
                <div className="hn-field">
                  <label className="hn-field-label" htmlFor="sa-banner-level">
                    Mức độ màu sắc thông báo
                  </label>
                  <select
                    id="sa-banner-level"
                    value={form.systemBanner.level}
                    onChange={(e) =>
                      setForm({ ...form, systemBanner: { ...form.systemBanner, level: e.target.value } })
                    }
                  >
                    {Object.entries(BANNER_LEVEL_LABELS).map(([k, lbl]) => (
                      <option key={k} value={k}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="hn-field">
                  <label className="hn-field-label" htmlFor="sa-banner-message">
                    Nội dung thông báo kỹ thuật / bảo trì gửi trường
                  </label>
                  <input
                    id="sa-banner-message"
                    maxLength={500}
                    placeholder="VD: Hệ thống sẽ nâng cấp phiên bản mới vào 22h00 tối thứ Bảy tuần này."
                    value={form.systemBanner.message}
                    onChange={(e) =>
                      setForm({ ...form, systemBanner: { ...form.systemBanner, message: e.target.value } })
                    }
                  />
                </div>
              </div>

              {form.systemBanner.message.trim() && (
                <div className={`sa-banner-preview-strip ${form.systemBanner.level || 'info'}`}>
                  <Icon name="alertCircle" size={16} />
                  <span>
                    <strong>Xem trước Banner ({form.systemBanner.enabled ? 'Đang bật' : 'Đang tắt'}):</strong>{' '}
                    {form.systemBanner.message}
                  </span>
                </div>
              )}

              {schools.length > 0 && (
                <div className="sa-target-schools-box">
                  <div className="sa-target-schools-head">
                    <div>
                      <strong>
                        Phạm vi trường nhận System Banner:{' '}
                        <span style={{ color: '#1d4ed8' }}>
                          {targetCodes.length === 0
                            ? `Tất cả trường đang hoạt động (${schools.length} trường)`
                            : `Chỉ ${targetCodes.length}/${schools.length} trường được chọn`}
                        </span>
                      </strong>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                        Không tích chọn trường nào = phát tới toàn bộ các trường; tích chọn cụ thể = trường nào chỉ thấy thông báo của trường đó.
                      </div>
                    </div>

                    <div className="sa-preset-bar">
                      <button
                        type="button"
                        className="sa-preset-btn"
                        data-no-progress="true"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            systemBanner: { ...prev.systemBanner, targetSchoolCodes: [] }
                          }))
                        }
                      >
                        Phát toàn chuỗi (Bỏ chọn riêng)
                      </button>
                      {allSchoolCodes.length > 1 && (
                        <button
                          type="button"
                          className="sa-preset-btn"
                          data-no-progress="true"
                          onClick={() =>
                            setForm((prev) => ({
                              ...prev,
                              systemBanner: { ...prev.systemBanner, targetSchoolCodes: [...allSchoolCodes] }
                            }))
                          }
                        >
                          Tích chọn tất cả ({allSchoolCodes.length})
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="sa-target-school-grid">
                    {schools.map((s) => {
                      const checked = targetCodes.includes(s.code);
                      return (
                        <label
                          key={s._id}
                          className={`sa-target-school-card ${checked ? 'checked' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleBannerTargetSchool(s.code)}
                          />
                          <div className="sa-target-school-meta">
                            <small>{s.code}</small>
                            <strong title={s.name}>{s.name}</strong>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <label className={`hn-switch-card ${form.maintenanceMode.enabled ? 'is-danger-on' : ''}`}>
                <div className="hn-switch-copy">
                  <strong>Bật Chế độ Bảo trì Máy chủ Trung tâm</strong>
                  <span>
                    Tạm ngưng đăng nhập đối với tài khoản tại các trường để nâng cấp cơ sở dữ liệu / máy chủ (Tài khoản SuperAdmin vẫn đăng nhập bình thường).
                  </span>
                </div>
                <input
                  type="checkbox"
                  className="hn-switch-input"
                  checked={form.maintenanceMode.enabled}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      maintenanceMode: { ...form.maintenanceMode, enabled: e.target.checked }
                    })
                  }
                />
                <span className="hn-switch-pill" aria-hidden="true" />
              </label>

              {form.maintenanceMode.enabled && (
                <div className="hn-field">
                  <label className="hn-field-label" htmlFor="sa-maintenance-msg">
                    Thông báo hiển thị trên màn hình đăng nhập trong thời gian bảo trì <span className="hn-field-req">*</span>
                  </label>
                  <input
                    id="sa-maintenance-msg"
                    required
                    maxLength={500}
                    value={form.maintenanceMode.message}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        maintenanceMode: { ...form.maintenanceMode, message: e.target.value }
                      })
                    }
                  />
                </div>
              )}
            </div>
          </section>

          {/* KHỐI 3: HẠN MỨC GÓI MẶC ĐỊNH & CHÍNH SÁCH BẢO MẬT HẠ TẦNG */}
          <section className="hn-form-section-card">
            <div className="hn-section-head">
              <span className="hn-section-icon green">
                <Icon name="lock" size={20} />
              </span>
              <div>
                <h3>3. Hạn mức Mặc định Trường Mới &amp; Chính sách Bảo mật Hạ tầng</h3>
                <p>
                  Thiết lập định mức tài nguyên gợi ý sẵn khi mở trường mới và quy chuẩn an toàn phiên đăng nhập, chống quét lỗ hổng tự động trên Internet.
                </p>
              </div>
            </div>

            <div className="hn-fields-stack">
              <div className="hn-grid-time-4">
                <div className="hn-field">
                  <label className="hn-field-label" htmlFor="sa-def-year">
                    Năm học mặc định <span className="hn-field-req">*</span>
                  </label>
                  <input
                    id="sa-def-year"
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
                  <span className="hn-field-hint">Định dạng YYYY-YYYY</span>
                </div>

                <div className="hn-field">
                  <label className="hn-field-label" htmlFor="sa-def-students">
                    Hạn mức Học sinh / trường
                  </label>
                  <div className="hn-input-suffix-wrap">
                    <input
                      id="sa-def-students"
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
                    <span className="hn-input-suffix-tag">HS</span>
                  </div>
                  <span className="hn-field-hint">Mặc định khi tạo trường</span>
                </div>

                <div className="hn-field">
                  <label className="hn-field-label" htmlFor="sa-def-staff">
                    Hạn mức Nhân sự / trường
                  </label>
                  <div className="hn-input-suffix-wrap">
                    <input
                      id="sa-def-staff"
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
                    <span className="hn-input-suffix-tag">NS</span>
                  </div>
                  <span className="hn-field-hint">Giáo viên &amp; nhân viên</span>
                </div>

                <div className="hn-field">
                  <label className="hn-field-label" htmlFor="sa-def-campuses">
                    Hạn mức Phân hiệu / trường
                  </label>
                  <div className="hn-input-suffix-wrap">
                    <input
                      id="sa-def-campuses"
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
                    <span className="hn-input-suffix-tag">cơ sở</span>
                  </div>
                  <span className="hn-field-hint">Số cơ sở trực thuộc</span>
                </div>
              </div>

              <div className="hn-grid-2">
                <div className="hn-field">
                  <label className="hn-field-label" htmlFor="sa-session-hours">
                    Thời hạn phiên đăng nhập tự động hết hạn
                  </label>
                  <div className="hn-input-suffix-wrap">
                    <input
                      id="sa-session-hours"
                      type="number"
                      min={1}
                      max={72}
                      value={form.securityPolicy.sessionTimeoutHours}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          securityPolicy: {
                            ...form.securityPolicy,
                            sessionTimeoutHours: Number(e.target.value)
                          }
                        })
                      }
                    />
                    <span className="hn-input-suffix-tag">giờ</span>
                  </div>
                  <span className="hn-field-hint">Khuyến nghị 8 giờ (1 ngày làm việc hành chính)</span>
                </div>

                <div className="hn-field">
                  <label className="hn-field-label" htmlFor="sa-min-pwd">
                    Độ dài mật khẩu tối thiểu khi cấp tài khoản Admin trường
                  </label>
                  <div className="hn-input-suffix-wrap">
                    <input
                      id="sa-min-pwd"
                      type="number"
                      min={6}
                      max={32}
                      value={form.securityPolicy.minPasswordLength}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          securityPolicy: {
                            ...form.securityPolicy,
                            minPasswordLength: Number(e.target.value)
                          }
                        })
                      }
                    />
                    <span className="hn-input-suffix-tag">ký tự</span>
                  </div>
                  <span className="hn-field-hint">Tối thiểu từ 6 đến 32 ký tự</span>
                </div>
              </div>

              <label className={`hn-switch-card ${form.securityPolicy.antiBotShieldEnabled ? 'is-on' : ''}`}>
                <div className="hn-switch-copy">
                  <strong>Bật Lá chắn Anti-Bot &amp; Chống công cụ quét tự động trên Internet</strong>
                  <span>
                    Tự động chặn các truy vấn dò quét lỗ hổng (SQLMap, Nikto, Nuclei, dò đường dẫn nhạy cảm <code>.env</code>, <code>.git</code>, <code>/wp-admin</code>).
                  </span>
                </div>
                <input
                  type="checkbox"
                  className="hn-switch-input"
                  checked={form.securityPolicy.antiBotShieldEnabled}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      securityPolicy: { ...form.securityPolicy, antiBotShieldEnabled: e.target.checked }
                    })
                  }
                />
                <span className="hn-switch-pill" aria-hidden="true" />
              </label>
            </div>
          </section>

          {/* THANH LƯU CẤU HÌNH NỀN TẢNG */}
          <div className="hn-settings-save-bar">
            <div className={`hn-save-status ${hasUnsavedChanges ? 'dirty' : ''}`}>
              <span className="hn-save-dot" />
              <span>
                {hasUnsavedChanges
                  ? 'Bạn có thay đổi cấu hình nền tảng chưa lưu — hãy bấm Lưu cấu hình bên phải để áp dụng.'
                  : 'Toàn bộ thông số nền tảng SaaS đang đồng bộ với máy chủ trung tâm.'}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {hasUnsavedChanges && (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={saving}
                  onClick={handleResetChanges}
                >
                  Hoàn tác thay đổi
                </button>
              )}
              <button
                type="submit"
                className="button button-primary"
                disabled={saving}
                aria-busy={saving}
              >
                <Icon name="check" size={16} />
                <span>{saving ? 'Đang lưu cấu hình...' : 'Lưu Cấu hình Nền tảng SaaS'}</span>
              </button>
            </div>
          </div>
        </form>

        {/* KHỐI 4: BẢO MẬT TÀI KHOẢN QUẢN TRỊ TỔNG (SUPERADMIN CREDENTIALS) */}
        <form className="hn-form-section-card" autoComplete="off" onSubmit={handleSaveSuperAdminCredentials}>
          <div className="hn-section-head">
            <span className="hn-section-icon purple">
              <Icon name="users" size={20} />
            </span>
            <div>
              <h3>4. Bảo mật Tài khoản Quản trị Tổng (@{superUser?.username || effectiveSecUsername || 'admin'})</h3>
              <p>
                Đổi tên đăng nhập hoặc mật khẩu của Tổng Admin. Sau khi lưu, hệ thống tự động nâng khóa phiên để đăng xuất các thiết bị lạ.
              </p>
            </div>
          </div>

          {secNotice && (
            <div
              className={secNotice.type === 'error' ? 'form-error' : 'timekeeping-notice success'}
              role="status"
              style={{ marginBottom: 16 }}
            >
              <Icon name={secNotice.type === 'error' ? 'alertCircle' : 'check'} size={16} />
              <span>{secNotice.text}</span>
            </div>
          )}

          <div className="hn-fields-stack">
            <div className="hn-grid-2">
              <div className="hn-field">
                <label className="hn-field-label" htmlFor="sa-sec-username">
                  Tên đăng nhập SuperAdmin <span className="hn-field-req">*</span>
                </label>
                <input
                  id="sa-sec-username"
                  required
                  autoComplete="off"
                  value={effectiveSecUsername}
                  onChange={(e) => setSecForm({ ...secForm, newUsername: e.target.value })}
                />
              </div>

              <div className="hn-field">
                <label className="hn-field-label" htmlFor="sa-sec-cur-pwd">
                  Mật khẩu hiện tại <span className="hn-field-req">*</span>
                </label>
                <div className="sa-password-input-wrap">
                  <input
                    id="sa-sec-cur-pwd"
                    type={showSecPwd.current ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    placeholder="Nhập mật khẩu đang dùng"
                    value={secForm.currentPassword}
                    onChange={(e) => setSecForm({ ...secForm, currentPassword: e.target.value })}
                  />
                  <button
                    type="button"
                    className="sa-password-eye-btn"
                    data-no-progress="true"
                    onClick={() => setShowSecPwd((p) => ({ ...p, current: !p.current }))}
                  >
                    {showSecPwd.current ? 'Ẩn' : 'Hiện'}
                  </button>
                </div>
              </div>
            </div>

            <div className="hn-grid-2">
              <div className="hn-field">
                <label className="hn-field-label" htmlFor="sa-sec-new-pwd">
                  Mật khẩu mới <span className="hn-field-req">*</span>
                </label>
                <div className="sa-password-input-wrap">
                  <input
                    id="sa-sec-new-pwd"
                    type={showSecPwd.next ? 'text' : 'password'}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    placeholder="Tối thiểu 6 ký tự"
                    value={secForm.newPassword}
                    onChange={(e) => setSecForm({ ...secForm, newPassword: e.target.value })}
                  />
                  <button
                    type="button"
                    className="sa-password-eye-btn"
                    data-no-progress="true"
                    onClick={() => setShowSecPwd((p) => ({ ...p, next: !p.next }))}
                  >
                    {showSecPwd.next ? 'Ẩn' : 'Hiện'}
                  </button>
                </div>
              </div>

              <div className="hn-field">
                <label className="hn-field-label" htmlFor="sa-sec-confirm-pwd">
                  Xác nhận mật khẩu mới <span className="hn-field-req">*</span>
                </label>
                <div className="sa-password-input-wrap">
                  <input
                    id="sa-sec-confirm-pwd"
                    type={showSecPwd.confirm ? 'text' : 'password'}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    placeholder="Nhập lại mật khẩu mới"
                    value={secForm.confirmPassword}
                    onChange={(e) => setSecForm({ ...secForm, confirmPassword: e.target.value })}
                  />
                  <button
                    type="button"
                    className="sa-password-eye-btn"
                    data-no-progress="true"
                    onClick={() => setShowSecPwd((p) => ({ ...p, confirm: !p.confirm }))}
                  >
                    {showSecPwd.confirm ? 'Ẩn' : 'Hiện'}
                  </button>
                </div>
                {secForm.confirmPassword && (
                  <span
                    className="hn-field-hint"
                    style={{
                      color: secForm.newPassword === secForm.confirmPassword ? '#15803d' : '#dc2626',
                      fontWeight: 600
                    }}
                  >
                    {secForm.newPassword === secForm.confirmPassword
                      ? '✓ Mật khẩu xác nhận đã khớp'
                      : '⚠ Mật khẩu xác nhận chưa trùng khớp'}
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                type="submit"
                className="button button-primary"
                disabled={savingSec}
                aria-busy={savingSec}
              >
                <Icon name="lock" size={15} />
                <span>{savingSec ? 'Đang cập nhật bảo mật...' : 'Cập nhật Tài khoản & Mật khẩu SuperAdmin'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* CỘT TÓM TẮT TRỰC QUAN BÊN PHẢI */}
      <aside className="hn-settings-summary-aside">
        <div className="hn-summary-card">
          <p className="card-kicker" style={{ color: '#2563eb' }}>TRẠNG THÁI HẠ TẦNG HIỆN HÀNH</p>
          <h3 style={{ margin: '4px 0 4px', fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
            {form.branding.systemName || 'Hoa Nắng SaaS'}
          </h3>
          <p style={{ margin: 0, fontSize: 12.2, color: '#64748b', lineHeight: 1.45 }}>
            Tóm tắt nhanh cấu hình phân phối phần mềm đang áp dụng cho <strong>{schools.length} trường thành viên</strong>.
          </p>

          <div className="hn-summary-list">
            <div className="hn-summary-row">
              <span>Hotline kỹ thuật</span>
              <strong>{form.branding.supportHotline || '—'}</strong>
            </div>
            <div className="hn-summary-row">
              <span>System Banner</span>
              <strong style={{ color: form.systemBanner.enabled ? '#2563eb' : '#64748b' }}>
                {form.systemBanner.enabled
                  ? targetCodes.length === 0
                    ? 'Đang phát toàn chuỗi'
                    : `Đang phát (${targetCodes.length} trường)`
                  : 'Đang tắt'}
              </strong>
            </div>
            <div className="hn-summary-row">
              <span>Chế độ bảo trì</span>
              <strong style={{ color: form.maintenanceMode.enabled ? '#e11d48' : '#15803d' }}>
                {form.maintenanceMode.enabled ? 'Đang bật bảo trì' : 'Hoạt động bình thường'}
              </strong>
            </div>
            <div className="hn-summary-row">
              <span>Năm học mặc định</span>
              <strong>{form.preschoolStandards.defaultSchoolYear || '—'}</strong>
            </div>
            <div className="hn-summary-row">
              <span>Gói mặc định trường mới</span>
              <strong>
                {form.preschoolStandards.defaultMaxStudentsPerSchool} HS ·{' '}
                {form.preschoolStandards.defaultMaxStaffPerSchool || 200} NS
              </strong>
            </div>
            <div className="hn-summary-row">
              <span>Phiên đăng nhập</span>
              <strong>{form.securityPolicy.sessionTimeoutHours} giờ</strong>
            </div>
            <div className="hn-summary-row">
              <span>Lá chắn Anti-Bot</span>
              <strong style={{ color: form.securityPolicy.antiBotShieldEnabled ? '#15803d' : '#d97706' }}>
                {form.securityPolicy.antiBotShieldEnabled ? 'Đang bảo vệ' : 'Đang tắt'}
              </strong>
            </div>
          </div>
        </div>

        {onNavigateSection && (
          <div className="hn-summary-card" style={{ background: '#ffffff', borderColor: '#e2e8f0' }}>
            <p className="card-kicker">LỐI TẮT ĐIỀU HÀNH NHANH</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              <button
                type="button"
                data-no-progress="true"
                onClick={() => onNavigateSection('schools')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: 11,
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#0f172a',
                  cursor: 'pointer'
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="classes" size={15} /> Quản lý Trường &amp; Account ({schools.length})
                </span>
                <Icon name="chevronRight" size={15} />
              </button>
              <button
                type="button"
                data-no-progress="true"
                onClick={() => onNavigateSection('audit')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: 11,
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#0f172a',
                  cursor: 'pointer'
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="fileText" size={15} /> Nhật ký Từng Trường &amp; Webhook
                </span>
                <Icon name="chevronRight" size={15} />
              </button>
              <button
                type="button"
                data-no-progress="true"
                onClick={() => onNavigateSection('overview')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: 11,
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#0f172a',
                  cursor: 'pointer'
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="chart" size={15} /> Tổng quan Kinh tế &amp; Hạ tầng
                </span>
                <Icon name="chevronRight" size={15} />
              </button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
