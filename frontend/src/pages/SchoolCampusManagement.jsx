import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import {
  getSchoolCampuses,
  updateSchoolSystemSettings,
  updateCampus
} from '../api/multiSchool';
import { getStoredUser } from '../utils/storage';
import { toFriendlyVietnameseNotice } from '../utils/vietnameseHardwareTranslator';

const DEFAULT_SCHOOL_SETTINGS = {
  contactEmail: '',
  schoolYear: '2026-2027',
  hotline: '',
  headquartersAddress: '',
  managerName: '',
  campusNotes: '',
  standardCheckInTime: '07:00',
  standardCheckOutTime: '16:30',
  lateGraceMinutes: 15,
  mealCancelCutoffTime: '08:00',
  requirePickupQrVerification: true,
  allowParentOnlineLeave: true,
  internalAnnouncementFooter: ''
};

const MODULE_LABELS = {
  students: 'Hồ sơ & Y tế Học sinh',
  classrooms: 'Quản lý Khung Lớp học',
  attendance: 'Điểm danh Khuôn mặt & Đơn nghỉ',
  pickups: 'Đón trả trẻ an toàn bằng Mã QR',
  guard: 'Trực cổng Bảo vệ & Khách ra vào',
  nutrition: 'Bếp ăn Bán trú & Lưu mẫu 24h',
  finance: 'Thu học phí & Công nợ',
  hr: 'Hồ sơ Nhân sự & Tiền lương',
  timekeeping: 'Máy chấm công & Cầu nối nội bộ',
  procurement: 'Cơ sở vật chất & Mua sắm',
  feedback: 'Góp ý từ Phụ huynh',
  chat: 'Tin nhắn Giáo viên – Phụ huynh',
  notifications: 'Thông báo Nội bộ Trường',
  reports: 'Báo cáo Thống kê Điều hành'
};

/**
 * Cộng số phút cho phép trễ vào giờ mở cửa đón trẻ để hiển thị mốc giờ tính đi muộn trực quan.
 */
function computeLateThresholdPreview(checkInTime, graceMinutes) {
  const match = String(checkInTime || '07:00').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return checkInTime || '07:15';
  const baseMins = Number(match[1]) * 60 + Number(match[2]);
  const added = Math.max(0, Math.min(120, Number(graceMinutes) || 0));
  const total = (baseMins + added) % (24 * 60);
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Trang Quản trị Cài đặt Vận hành & Hồ sơ Phân hiệu dành cho Admin Phân hiệu Trường (`role === 'admin'`).
 *
 * Bố cục tách bạch rõ 2 chế độ:
 * - `/campuses?tab=settings`: Đưa ngay biểu mẫu 3 khối gọn gàng + cột Tóm tắt trực quan lên đầu màn hình (không bị đẩy trôi xuống đáy).
 * - `/campuses`: Hiển thị 4 thẻ chỉ số tổng quan, lối tắt điều hành, hồ sơ phân hiệu, đường dẫn nhận điểm danh động và gói phần mềm.
 */
export default function SchoolCampusManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const storedUser = getStoredUser() || {};
  const userRole = storedUser.role;
  const isAdmin = userRole === 'admin';
  const isVendorSupport = Boolean(storedUser.isVendorSupport || localStorage.getItem('superadmin_token'));

  const activeTab = searchParams.get('tab') === 'settings' ? 'settings' : 'overview';
  const switchTab = (nextTab) => {
    const next = new URLSearchParams(searchParams);
    if (nextTab === 'overview') next.delete('tab');
    else next.set('tab', nextTab);
    setSearchParams(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const [school, setSchool] = useState(null);
  const [primaryCampus, setPrimaryCampus] = useState(null);
  const [campuses, setCampuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const [settingsForm, setSettingsForm] = useState(DEFAULT_SCHOOL_SETTINGS);
  const [savedSnapshot, setSavedSnapshot] = useState(DEFAULT_SCHOOL_SETTINGS);
  const [savingSettings, setSavingSettings] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSchoolCampuses();
      const payload = res.data?.data || {};
      const loadedSchool = payload.school || null;
      const loadedStandards = payload.systemStandards || null;
      const loadedCampuses = payload.campuses || [];
      const mainCampus = loadedCampuses[0] || null;

      setSchool(loadedSchool);
      setCampuses(loadedCampuses);
      setPrimaryCampus(mainCampus);

      const ss = loadedSchool?.schoolSettings || {};
      const hydrated = {
        contactEmail: loadedSchool?.contactEmail || '',
        schoolYear: ss.schoolYear || loadedStandards?.defaultSchoolYear || '2026-2027',
        hotline: ss.hotline || mainCampus?.phone || '',
        headquartersAddress: ss.headquartersAddress || mainCampus?.address || '',
        managerName: mainCampus?.managerName || '',
        campusNotes: mainCampus?.notes || '',
        standardCheckInTime: ss.standardCheckInTime || mainCampus?.openTime || loadedStandards?.standardCheckInTime || '07:00',
        standardCheckOutTime: ss.standardCheckOutTime || mainCampus?.closeTime || loadedStandards?.standardCheckOutTime || '16:30',
        lateGraceMinutes: ss.lateGraceMinutes ?? 15,
        mealCancelCutoffTime: ss.mealCancelCutoffTime || '08:00',
        requirePickupQrVerification: ss.requirePickupQrVerification !== false,
        allowParentOnlineLeave: ss.allowParentOnlineLeave !== false,
        internalAnnouncementFooter: ss.internalAnnouncementFooter || ''
      };
      setSettingsForm(hydrated);
      setSavedSnapshot(hydrated);
    } catch (err) {
      setNotice({
        type: 'error',
        text: toFriendlyVietnameseNotice(err, 'Chưa tải được thông tin cài đặt của phân hiệu. Bạn hãy bấm Làm mới để thử lại nhé.')
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(settingsForm) !== JSON.stringify(savedSnapshot),
    [settingsForm, savedSnapshot]
  );

  const lateThresholdPreview = useMemo(
    () => computeLateThresholdPreview(settingsForm.standardCheckInTime, settingsForm.lateGraceMinutes),
    [settingsForm.standardCheckInTime, settingsForm.lateGraceMinutes]
  );

  const handleResetChanges = () => {
    setSettingsForm(savedSnapshot);
    setNotice(null);
  };

  const handleSaveCampusSettings = async (e) => {
    e.preventDefault();
    if (!isAdmin || savingSettings) return;
    setSavingSettings(true);
    setNotice(null);
    try {
      await updateSchoolSystemSettings({
        contactEmail: settingsForm.contactEmail.trim(),
        schoolSettings: {
          schoolYear: settingsForm.schoolYear.trim(),
          hotline: settingsForm.hotline.trim(),
          headquartersAddress: settingsForm.headquartersAddress.trim(),
          standardCheckInTime: settingsForm.standardCheckInTime,
          standardCheckOutTime: settingsForm.standardCheckOutTime,
          lateGraceMinutes: Number(settingsForm.lateGraceMinutes),
          mealCancelCutoffTime: settingsForm.mealCancelCutoffTime,
          requirePickupQrVerification: Boolean(settingsForm.requirePickupQrVerification),
          allowParentOnlineLeave: Boolean(settingsForm.allowParentOnlineLeave),
          internalAnnouncementFooter: settingsForm.internalAnnouncementFooter.trim()
        }
      });

      if (primaryCampus?.code) {
        await updateCampus(primaryCampus.code, {
          name: primaryCampus.name || school?.name || 'Cơ sở chính',
          address: settingsForm.headquartersAddress.trim(),
          phone: settingsForm.hotline.trim(),
          managerName: settingsForm.managerName.trim(),
          openTime: settingsForm.standardCheckInTime,
          closeTime: settingsForm.standardCheckOutTime,
          maxClassrooms: primaryCampus.maxClassrooms || 20,
          notes: settingsForm.campusNotes.trim(),
          isActive: true
        }).catch(() => null);
      }

      setNotice({
        type: 'success',
        text: 'Đã lưu thành công toàn bộ cài đặt vận hành cho phân hiệu trường của bạn!'
      });
      await load();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setNotice({
        type: 'error',
        text: toFriendlyVietnameseNotice(err, 'Chưa lưu được cài đặt của phân hiệu. Bạn vui lòng kiểm tra lại các ô vừa nhập nhé.')
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const dynamicWebhookUrl = school?.code
    ? `${window.location.origin}/api/attendance/webhook/${school.code}`
    : `${window.location.origin}/api/attendance/webhook`;

  const copyWebhookUrl = async () => {
    if (!school?.code) return;
    try {
      await navigator.clipboard.writeText(dynamicWebhookUrl);
      setCopiedWebhook(true);
      window.setTimeout(() => setCopiedWebhook(false), 2200);
    } catch {
      // ignore clipboard restriction
    }
  };

  const totalClasses = campuses.reduce((sum, c) => sum + (c.classCount || 0), 0);
  const totalStudents = campuses.reduce((sum, c) => sum + (c.studentCount || 0), 0);
  const maxStudentsQuota = school?.quotas?.maxStudents || 800;
  const maxStaffQuota = school?.quotas?.maxStaff || 200;

  return (
    <AppShell
      title={
        activeTab === 'settings'
          ? 'Cài đặt Vận hành Phân hiệu'
          : isAdmin
            ? 'Hồ sơ Phân hiệu & Gói Phần mềm'
            : 'Thông tin Phân hiệu Trường'
      }
      subtitle={
        activeTab === 'settings'
          ? 'Thiết lập thông tin liên hệ, khung giờ đón trả trẻ, giờ chốt suất ăn bếp và quy tắc an toàn riêng cho phân hiệu.'
          : 'Theo dõi quy mô lớp học, thông tin đơn vị, đường dẫn nhận điểm danh tự động và các phân hệ được cấp phép.'
      }
      actions={(
        <div className="toolbar-buttons">
          <button type="button" className="button button-secondary" onClick={load} disabled={loading}>
            <Icon name="refresh" size={15} /> Làm mới
          </button>
          {isAdmin && (
            <Link className="button button-primary" to="/devices">
              <Icon name="clock" size={15} /> Máy chấm công &amp; Cầu nối nội bộ
            </Link>
          )}
        </div>
      )}
    >
      <section className="classroom-page campus-settings-workspace">
        {isVendorSupport && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
              padding: '12px 18px',
              marginBottom: 18,
              borderRadius: 14,
              background: 'linear-gradient(115deg, #fffbeb, #fef3c7)',
              border: '1px solid #fcd34d',
              color: '#92400e',
              fontSize: 13
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="wrench" size={16} />
              <span>
                <strong>Phiên Kỹ thuật viên Nhà cung cấp:</strong> Đang cấu hình bàn giao cho{' '}
                <strong>{school?.name || '—'} ({school?.code || '—'})</strong>. Bạn có thể chuyển nhanh sang phân hiệu khác ở thanh menu bên trái.
              </span>
            </div>
            <Link className="button button-secondary" to="/devices" style={{ minHeight: 36 }}>
              Quét &amp; Gán Máy Chấm Công →
            </Link>
          </div>
        )}

        {/* THANH CHUYỂN CHẾ ĐỘ NGAY ĐẦU TRANG — KHÔNG ĐẨY BIỂU MẪU TRÔI XUỐNG DƯỚI */}
        <div className="account-tabs" style={{ marginBottom: 20 }}>
          <button
            type="button"
            className={activeTab === 'settings' ? 'active' : ''}
            onClick={() => switchTab('settings')}
          >
            <Icon name="settings" size={15} />
            <span>Cài đặt Vận hành Phân hiệu</span>
          </button>
          <button
            type="button"
            className={activeTab === 'overview' ? 'active' : ''}
            onClick={() => switchTab('overview')}
          >
            <Icon name="shield" size={15} />
            <span>Hồ sơ Phân hiệu &amp; Gói Phần mềm</span>
          </button>
        </div>

        {notice && (
          <div
            className={notice.type === 'error' ? 'form-error' : 'timekeeping-notice success'}
            role="status"
            style={{ marginBottom: 18, fontSize: 13 }}
          >
            <Icon name={notice.type === 'error' ? 'alertCircle' : 'check'} size={16} />
            <span>{notice.text}</span>
          </div>
        )}

        {loading ? (
          <div className="content-card inline-loader">
            <span className="loading-orb" />
            Đang tải thông tin cấu hình của phân hiệu...
          </div>
        ) : activeTab === 'settings' ? (
          /* ─── CHẾ ĐỘ 1: BIỂU MẪU CÀI ĐẶT VẬN HÀNH 3 KHỐI CÂN ĐỐI + CỘT TÓM TẮT TRỰC QUAN ─── */
          <div className="hn-campus-settings-layout">
            <form
              className="hn-campus-settings-form"
              autoComplete="off"
              onSubmit={handleSaveCampusSettings}
            >
              {/* KHỐI 1: THÔNG TIN ĐƠN VỊ & LIÊN HỆ PHÂN HIỆU */}
              <section className="hn-form-section-card">
                <div className="hn-section-head">
                  <span className="hn-section-icon blue">
                    <Icon name="shield" size={20} />
                  </span>
                  <div>
                    <h3>1. Thông tin Đại diện &amp; Liên hệ của Phân hiệu</h3>
                    <p>
                      Hiển thị trên phiếu thông báo, sổ liên lạc điện tử và thông tin liên hệ dành cho phụ huynh của{' '}
                      <strong>{school?.name || 'phân hiệu'}</strong>.
                    </p>
                  </div>
                </div>

                <div className="hn-fields-stack">
                  <div className="hn-grid-contact-top">
                    <div className="hn-field">
                      <label className="hn-field-label" htmlFor="cfg-school-year">
                        Năm học áp dụng <span className="hn-field-req">*</span>
                      </label>
                      <input
                        id="cfg-school-year"
                        required
                        disabled={!isAdmin}
                        placeholder="2026-2027"
                        value={settingsForm.schoolYear}
                        onChange={(e) => setSettingsForm({ ...settingsForm, schoolYear: e.target.value })}
                      />
                    </div>

                    <div className="hn-field">
                      <label className="hn-field-label" htmlFor="cfg-manager-name">
                        Người phụ trách / Hiệu trưởng
                      </label>
                      <input
                        id="cfg-manager-name"
                        disabled={!isAdmin}
                        maxLength={120}
                        placeholder="VD: Cô Nguyễn Thị Minh"
                        value={settingsForm.managerName}
                        onChange={(e) => setSettingsForm({ ...settingsForm, managerName: e.target.value })}
                      />
                    </div>

                    <div className="hn-field">
                      <label className="hn-field-label" htmlFor="cfg-hotline">
                        Điện thoại / Hotline văn phòng
                      </label>
                      <input
                        id="cfg-hotline"
                        disabled={!isAdmin}
                        maxLength={30}
                        placeholder="VD: 0243 888 9999"
                        value={settingsForm.hotline}
                        onChange={(e) => setSettingsForm({ ...settingsForm, hotline: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="hn-grid-contact-bottom">
                    <div className="hn-field">
                      <label className="hn-field-label" htmlFor="cfg-email">
                        Email liên hệ chính thức
                      </label>
                      <input
                        id="cfg-email"
                        type="email"
                        disabled={!isAdmin}
                        placeholder="vanphong@ten-truong.edu.vn"
                        value={settingsForm.contactEmail}
                        onChange={(e) => setSettingsForm({ ...settingsForm, contactEmail: e.target.value })}
                      />
                    </div>

                    <div className="hn-field">
                      <label className="hn-field-label" htmlFor="cfg-address">
                        Địa chỉ phân hiệu trường
                      </label>
                      <input
                        id="cfg-address"
                        disabled={!isAdmin}
                        maxLength={300}
                        placeholder="Số nhà, đường/phố, phường/xã, quận/huyện, tỉnh/thành phố"
                        value={settingsForm.headquartersAddress}
                        onChange={(e) => setSettingsForm({ ...settingsForm, headquartersAddress: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              </section>

              {/* KHỐI 2: KHUNG GIỜ ĐÓN TRẢ TRẺ & CHỐT SUẤT ĂN BẾP */}
              <section className="hn-form-section-card">
                <div className="hn-section-head">
                  <span className="hn-section-icon amber">
                    <Icon name="clock" size={20} />
                  </span>
                  <div>
                    <h3>2. Khung giờ Đón trả trẻ &amp; Chốt suất ăn Bếp</h3>
                    <p>
                      Làm mốc tự động phân loại <strong>Đúng giờ / Đi muộn</strong> khi trẻ quét khuôn mặt tại máy chấm công và chốt số lượng khẩu phần nấu trong ngày cho nhà bếp.
                    </p>
                  </div>
                </div>

                <div className="hn-fields-stack">
                  <div className="hn-grid-time-4">
                    <div className="hn-field">
                      <label className="hn-field-label" htmlFor="cfg-checkin">
                        Giờ mở cửa đón trẻ <span className="hn-field-req">*</span>
                      </label>
                      <input
                        id="cfg-checkin"
                        type="time"
                        required
                        disabled={!isAdmin}
                        value={settingsForm.standardCheckInTime}
                        onChange={(e) => setSettingsForm({ ...settingsForm, standardCheckInTime: e.target.value })}
                      />
                      <span className="hn-field-hint">Giờ bắt đầu ca đón sáng</span>
                    </div>

                    <div className="hn-field">
                      <label className="hn-field-label" htmlFor="cfg-grace">
                        Cho phép trễ tối đa
                      </label>
                      <div className="hn-input-suffix-wrap">
                        <input
                          id="cfg-grace"
                          type="number"
                          min={0}
                          max={120}
                          disabled={!isAdmin}
                          value={settingsForm.lateGraceMinutes}
                          onChange={(e) => setSettingsForm({ ...settingsForm, lateGraceMinutes: e.target.value })}
                        />
                        <span className="hn-input-suffix-tag">phút</span>
                      </div>
                      <span className="hn-field-hint">
                        Quét sau <strong>{lateThresholdPreview}</strong> tính đi muộn
                      </span>
                    </div>

                    <div className="hn-field">
                      <label className="hn-field-label" htmlFor="cfg-meal-cutoff">
                        Giờ chốt báo nghỉ bếp <span className="hn-field-req">*</span>
                      </label>
                      <input
                        id="cfg-meal-cutoff"
                        type="time"
                        required
                        disabled={!isAdmin}
                        value={settingsForm.mealCancelCutoffTime}
                        onChange={(e) => setSettingsForm({ ...settingsForm, mealCancelCutoffTime: e.target.value })}
                      />
                      <span className="hn-field-hint">Báo nghỉ trước giờ này được trừ ăn</span>
                    </div>

                    <div className="hn-field">
                      <label className="hn-field-label" htmlFor="cfg-checkout">
                        Giờ trả trẻ buổi chiều <span className="hn-field-req">*</span>
                      </label>
                      <input
                        id="cfg-checkout"
                        type="time"
                        required
                        disabled={!isAdmin}
                        value={settingsForm.standardCheckOutTime}
                        onChange={(e) => setSettingsForm({ ...settingsForm, standardCheckOutTime: e.target.value })}
                      />
                      <span className="hn-field-hint">Giờ tan học chuẩn chiều</span>
                    </div>
                  </div>

                  <div className="hn-field">
                    <label className="hn-field-label" htmlFor="cfg-gate-notes">
                      Hướng dẫn đón trả trẻ tại cổng phân hiệu
                    </label>
                    <textarea
                      id="cfg-gate-notes"
                      rows={2}
                      disabled={!isAdmin}
                      maxLength={300}
                      placeholder="VD: Cổng chính mở từ 06:45 sáng; phụ huynh đưa đón bé vui lòng quét khuôn mặt hoặc xuất trình mã QR tại sảnh tầng 1..."
                      value={settingsForm.campusNotes}
                      onChange={(e) => setSettingsForm({ ...settingsForm, campusNotes: e.target.value })}
                    />
                  </div>
                </div>
              </section>

              {/* KHỐI 3: QUY TẮC AN TOÀN ĐÓN TRẢ & CHÂN TRANG PHIẾU THU */}
              <section className="hn-form-section-card">
                <div className="hn-section-head">
                  <span className="hn-section-icon green">
                    <Icon name="check" size={20} />
                  </span>
                  <div>
                    <h3>3. Quy tắc An toàn Đón trả &amp; Ghi chú Phiếu thu</h3>
                    <p>
                      Bật/tắt quy trình kiểm tra người đón hộ tại cổng và lời nhắn cuối phiếu thu học phí gửi tới phụ huynh.
                    </p>
                  </div>
                </div>

                <div className="hn-fields-stack">
                  <div className="hn-grid-2">
                    <label className={`hn-switch-card ${settingsForm.requirePickupQrVerification ? 'is-on' : ''}`}>
                      <div className="hn-switch-copy">
                        <strong>Bắt buộc xác thực Mã QR khi bàn giao trẻ</strong>
                        <span>
                          Giáo viên và bảo vệ kiểm tra Mã QR hoặc danh sách người đón đã đăng ký trước khi giao trẻ về nhà.
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        className="hn-switch-input"
                        disabled={!isAdmin}
                        checked={settingsForm.requirePickupQrVerification}
                        onChange={(e) =>
                          setSettingsForm({ ...settingsForm, requirePickupQrVerification: e.target.checked })
                        }
                      />
                      <span className="hn-switch-pill" aria-hidden="true" />
                    </label>

                    <label className={`hn-switch-card ${settingsForm.allowParentOnlineLeave ? 'is-on' : ''}`}>
                      <div className="hn-switch-copy">
                        <strong>Cho phép Phụ huynh gửi đơn xin nghỉ trực tuyến</strong>
                        <span>
                          Phụ huynh có thể báo nghỉ cho bé ngay trên ứng dụng Web để giáo viên chủ nhiệm và nhà bếp nắm số lượng kịp thời.
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        className="hn-switch-input"
                        disabled={!isAdmin}
                        checked={settingsForm.allowParentOnlineLeave}
                        onChange={(e) =>
                          setSettingsForm({ ...settingsForm, allowParentOnlineLeave: e.target.checked })
                        }
                      />
                      <span className="hn-switch-pill" aria-hidden="true" />
                    </label>
                  </div>

                  <div className="hn-field">
                    <label className="hn-field-label" htmlFor="cfg-receipt-footer">
                      Lời nhắn cuối Phiếu thu học phí &amp; Thông báo gửi Phụ huynh
                    </label>
                    <textarea
                      id="cfg-receipt-footer"
                      rows={2}
                      disabled={!isAdmin}
                      maxLength={300}
                      placeholder="VD: Mọi thắc mắc về học phí và khẩu phần ăn, Quý Phụ huynh vui lòng liên hệ Văn phòng Nhà trường trong giờ hành chính."
                      value={settingsForm.internalAnnouncementFooter}
                      onChange={(e) => setSettingsForm({ ...settingsForm, internalAnnouncementFooter: e.target.value })}
                    />
                  </div>
                </div>
              </section>

              {/* THANH HÀNH ĐỘNG LƯU CÀI ĐẶT RÕ RÀNG, THOÁNG ĐÃNG */}
              {isAdmin && (
                <div className="hn-settings-save-bar">
                  <div className={`hn-save-status ${hasUnsavedChanges ? 'dirty' : ''}`}>
                    <span className="hn-save-dot" />
                    <span>
                      {hasUnsavedChanges
                        ? 'Bạn có thay đổi mới chưa lưu — hãy bấm Lưu cài đặt để áp dụng cho phân hiệu.'
                        : 'Toàn bộ thông số đang đồng bộ với cấu hình hiện hành của phân hiệu.'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {hasUnsavedChanges && (
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={savingSettings}
                        onClick={handleResetChanges}
                      >
                        Hoàn tác thay đổi
                      </button>
                    )}
                    <button type="submit" className="button button-primary" disabled={savingSettings}>
                      <Icon name="check" size={16} />
                      {savingSettings ? 'Đang lưu cài đặt...' : 'Lưu cài đặt phân hiệu'}
                    </button>
                  </div>
                </div>
              )}
            </form>

            {/* CỘT TÓM TẮT TRỰC QUAN BÊN PHẢI */}
            <aside className="hn-settings-summary-aside">
              <div className="hn-summary-card">
                <p className="card-kicker" style={{ color: '#2563eb' }}>TÓM TẮT ĐANG ÁP DỤNG</p>
                <h3 style={{ margin: '4px 0 4px', fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                  {school?.name || 'Phân hiệu hiện tại'}
                </h3>
                <p style={{ margin: 0, fontSize: 12.2, color: '#64748b', lineHeight: 1.45 }}>
                  Bảng xem nhanh các mốc vận hành tự động của phân hiệu <strong>{school?.code || '—'}</strong>.
                </p>

                <div className="hn-summary-list">
                  <div className="hn-summary-row">
                    <span>Mã phân hiệu</span>
                    <strong>{school?.code || '—'}</strong>
                  </div>
                  <div className="hn-summary-row">
                    <span>Năm học</span>
                    <strong>{settingsForm.schoolYear || '—'}</strong>
                  </div>
                  <div className="hn-summary-row">
                    <span>Khung giờ đón – trả</span>
                    <strong>{settingsForm.standardCheckInTime} – {settingsForm.standardCheckOutTime}</strong>
                  </div>
                  <div className="hn-summary-row">
                    <span>Mốc tính đi muộn</span>
                    <strong style={{ color: '#d97706' }}>Sau {lateThresholdPreview}</strong>
                  </div>
                  <div className="hn-summary-row">
                    <span>Chốt cắt suất bếp</span>
                    <strong style={{ color: '#2563eb' }}>{settingsForm.mealCancelCutoffTime}</strong>
                  </div>
                  <div className="hn-summary-row">
                    <span>Quét QR đón trẻ</span>
                    <strong style={{ color: settingsForm.requirePickupQrVerification ? '#15803d' : '#64748b' }}>
                      {settingsForm.requirePickupQrVerification ? 'Đang bật' : 'Tắt'}
                    </strong>
                  </div>
                </div>
              </div>

              {isAdmin && (
                <div className="hn-summary-card" style={{ background: '#ffffff', borderColor: '#e2e8f0' }}>
                  <p className="card-kicker">LỐI TẮT QUẢN TRỊ PHÂN HIỆU</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                    <Link
                      to="/accounts"
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
                        color: '#0f172a'
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <Icon name="users" size={15} /> Cấp Tài khoản Chức năng
                      </span>
                      <Icon name="chevronRight" size={15} />
                    </Link>
                    <Link
                      to="/classrooms"
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
                        color: '#0f172a'
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <Icon name="classes" size={15} /> Quản lý Khung Lớp học
                      </span>
                      <Icon name="chevronRight" size={15} />
                    </Link>
                    <Link
                      to="/devices"
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
                        color: '#0f172a'
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <Icon name="clock" size={15} /> Máy chấm công &amp; Khuôn mặt
                      </span>
                      <Icon name="chevronRight" size={15} />
                    </Link>
                  </div>
                </div>
              )}
            </aside>
          </div>
        ) : (
          /* ─── CHẾ ĐỘ 2: HỒ SƠ PHÂN HIỆU, CHỈ SỐ TỔNG QUAN & GÓI PHẦN MỀM ─── */
          <div style={{ display: 'grid', gap: 20 }}>
            <div className="classroom-summary-grid" style={{ marginBottom: 0 }}>
              <article>
                <span className="summary-badge blue"><Icon name="shield" size={20} /></span>
                <div>
                  <small>MÃ PHÂN HIỆU TRƯỜNG</small>
                  <strong>{school?.code || 'HOANANG'}</strong>
                </div>
              </article>
              <article>
                <span className="summary-badge amber"><Icon name="clock" size={20} /></span>
                <div>
                  <small>GIỜ ĐÓN – TRẢ TRẺ CHUẨN</small>
                  <strong>{settingsForm.standardCheckInTime} – {settingsForm.standardCheckOutTime}</strong>
                </div>
              </article>
              <article>
                <span className="summary-badge green"><Icon name="grid" size={20} /></span>
                <div>
                  <small>SỐ LỚP HỌC ĐANG MỞ</small>
                  <strong>{totalClasses} lớp học</strong>
                </div>
              </article>
              <article>
                <span className="summary-badge purple"><Icon name="students" size={20} /></span>
                <div>
                  <small>SĨ SỐ / HẠN MỨC CẤP PHÉP</small>
                  <strong>{totalStudents} / {maxStudentsQuota} bé</strong>
                </div>
              </article>
            </div>

            <section className="content-card" style={{ padding: '24px 26px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
                <div>
                  <p className="card-kicker">THÔNG TIN ĐƠN VỊ PHÂN HIỆU</p>
                  <h2 style={{ margin: '4px 0 6px', fontSize: 20, color: '#0f172a' }}>
                    {school?.name || 'Trường Mầm non'} ({school?.code || '—'})
                  </h2>
                  <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
                    Thông tin hồ sơ và định mức hoạt động của phân hiệu. Bấm <strong>Chỉnh sửa cài đặt phân hiệu</strong> để đổi giờ đón trả, hotline hoặc địa chỉ.
                  </p>
                </div>
                {isAdmin && (
                  <button type="button" className="button button-primary" onClick={() => switchTab('settings')}>
                    <Icon name="settings" size={15} /> Chỉnh sửa cài đặt phân hiệu
                  </button>
                )}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: 14
                }}
              >
                <div style={{ padding: '14px 16px', borderRadius: 12, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                  <small style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>ĐỊA CHỈ PHÂN HIỆU</small>
                  <strong style={{ fontSize: 13.5, color: '#0f172a' }}>{settingsForm.headquartersAddress || 'Chưa cập nhật địa chỉ'}</strong>
                </div>
                <div style={{ padding: '14px 16px', borderRadius: 12, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                  <small style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>NGƯỜI PHỤ TRÁCH &amp; ĐIỆN THOẠI</small>
                  <strong style={{ fontSize: 13.5, color: '#0f172a' }}>
                    {settingsForm.managerName || 'Chưa cập nhật'} {settingsForm.hotline ? `· ${settingsForm.hotline}` : ''}
                  </strong>
                </div>
                <div style={{ padding: '14px 16px', borderRadius: 12, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                  <small style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>KHUNG GIỜ HOẠT ĐỘNG &amp; BẾP ĂN</small>
                  <strong style={{ fontSize: 13.5, color: '#0f172a' }}>
                    Đón {settingsForm.standardCheckInTime} – Trả {settingsForm.standardCheckOutTime} · Chốt bếp {settingsForm.mealCancelCutoffTime}
                  </strong>
                </div>
                <div style={{ padding: '14px 16px', borderRadius: 12, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                  <small style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>HẠN MỨC CẤP PHÉP TỪ NHÀ CUNG CẤP</small>
                  <strong style={{ fontSize: 13.5, color: '#0f172a' }}>
                    Tối đa {maxStudentsQuota} học sinh · {maxStaffQuota} nhân sự
                  </strong>
                </div>
              </div>
            </section>

            {isAdmin && (
              <section
                className="content-card"
                style={{
                  padding: '20px 24px',
                  border: '1px solid #bfdbfe',
                  background: 'linear-gradient(135deg, #f8fbff 0%, #eff6ff 100%)'
                }}
              >
                <div style={{ marginBottom: 14 }}>
                  <p className="card-kicker" style={{ color: '#1d4ed8' }}>ĐIỀU HÀNH NHANH PHÂN HIỆU ({school?.code || 'TRƯỜNG'})</p>
                  <h3 style={{ margin: '4px 0 4px', fontSize: 17, color: '#0f172a' }}>
                    Quản lý tài khoản chức năng, lớp học &amp; thiết bị của phân hiệu
                  </h3>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  <Link
                    to="/accounts"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '13px 15px',
                      borderRadius: 14,
                      background: '#ffffff',
                      border: '1px solid #dbeafe'
                    }}
                  >
                    <span className="quick-icon blue"><Icon name="users" size={18} /></span>
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: 13.5, color: '#0f172a' }}>Cấp Tài khoản Chức năng</strong>
                      <small style={{ color: '#64748b', fontSize: 12 }}>Tạo Giám đốc, Giáo viên, Đầu bếp, Kế toán...</small>
                    </span>
                  </Link>

                  <Link
                    to="/classrooms"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '13px 15px',
                      borderRadius: 14,
                      background: '#ffffff',
                      border: '1px solid #dbeafe'
                    }}
                  >
                    <span className="quick-icon green"><Icon name="classes" size={18} /></span>
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: 13.5, color: '#0f172a' }}>Khung Lớp học Phân hiệu</strong>
                      <small style={{ color: '#64748b', fontSize: 12 }}>Mở lớp mới &amp; gán Giáo viên chủ nhiệm</small>
                    </span>
                  </Link>

                  <Link
                    to="/devices"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '13px 15px',
                      borderRadius: 14,
                      background: '#ffffff',
                      border: '1px solid #dbeafe'
                    }}
                  >
                    <span className="quick-icon violet"><Icon name="clock" size={18} /></span>
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: 13.5, color: '#0f172a' }}>Máy chấm công &amp; Khuôn mặt</strong>
                      <small style={{ color: '#64748b', fontSize: 12 }}>Quét mạng trường, kéo &amp; đẩy khuôn mặt</small>
                    </span>
                  </Link>

                  <Link
                    to="/audit-logs"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '13px 15px',
                      borderRadius: 14,
                      background: '#ffffff',
                      border: '1px solid #dbeafe'
                    }}
                  >
                    <span className="quick-icon amber"><Icon name="fileText" size={18} /></span>
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: 13.5, color: '#0f172a' }}>Nhật ký Hoạt động Trường</strong>
                      <small style={{ color: '#64748b', fontSize: 12 }}>Tra cứu lịch sử thao tác trong phân hiệu</small>
                    </span>
                  </Link>
                </div>
              </section>
            )}

            <section className="content-card" style={{ padding: '24px 26px' }}>
              <p className="card-kicker">KẾT NỐI MÁY CHẤM CÔNG &amp; GÓI TÍNH NĂNG ĐÃ CẤP PHÉP</p>
              <h3 style={{ margin: '4px 0 8px', fontSize: 17, color: '#1e3a8a' }}>
                Địa chỉ nhận điểm danh khuôn mặt tự động theo tên miền hiện tại
              </h3>
              <p style={{ margin: '0 0 14px', color: '#475569', fontSize: 13, lineHeight: 1.55 }}>
                Địa chỉ dưới đây tự động cập nhật theo tên miền trang Web bạn đang truy cập. Khi đổi tên miền mới trong tương lai, bạn chỉ cần mở mục <strong>Máy chấm công</strong> và bấm 1 chạm để đẩy địa chỉ mới xuống máy.
              </p>

              {school?.code && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    flexWrap: 'wrap',
                    padding: '12px 16px',
                    marginBottom: 18,
                    borderRadius: 12,
                    background: '#f8fafc',
                    border: '1px dashed #93c5fd'
                  }}
                >
                  <span style={{ fontSize: 13, wordBreak: 'break-all' }}>
                    Địa chỉ nhận dữ liệu tự động của phân hiệu:{' '}
                    <code style={{ fontWeight: 800, color: '#1e3a8a' }}>{dynamicWebhookUrl}</code>
                  </span>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="button button-secondary" onClick={copyWebhookUrl}>
                      <Icon name="copy" size={14} /> {copiedWebhook ? 'Đã sao chép địa chỉ!' : 'Sao chép địa chỉ'}
                    </button>
                    {isAdmin && (
                      <Link className="button button-primary" to="/devices">
                        Mở trang Máy chấm công →
                      </Link>
                    )}
                  </div>
                </div>
              )}

              {Array.isArray(school?.enabledModules) && school.enabledModules.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#475569', marginBottom: 10 }}>
                    CÁC PHÂN HỆ CHỨC NĂNG ĐANG ĐƯỢC BẬT CHO PHÂN HIỆU ({school.enabledModules.length} phân hệ):
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {school.enabledModules.map((modKey) => (
                      <span
                        key={modKey}
                        style={{
                          padding: '6px 13px',
                          borderRadius: '999px',
                          background: '#eff6ff',
                          border: '1px solid #bfdbfe',
                          color: '#1e40af',
                          fontSize: '12.5px',
                          fontWeight: 600
                        }}
                      >
                        ✓ {MODULE_LABELS[modKey] || modKey}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </section>
    </AppShell>
  );
}
