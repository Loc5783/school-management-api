import { useCallback, useEffect, useState } from 'react';
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
 * Trang Cài đặt Hệ thống & Hồ sơ Phân hiệu dành cho Admin Phân hiệu Trường (`role === 'admin'`),
 * tuân thủ chặt chẽ phân cấp:
 * Nhà cung cấp phần mềm -> Admin Phân hiệu Trường (hết cấp Admin) -> Các tài khoản chức năng (Giám đốc, Giáo viên, Đầu bếp, Kế toán, Nhân sự, Bảo vệ, Phụ huynh).
 *
 * - Admin Phân hiệu chỉ xem và chỉnh sửa cấu hình vận hành của đúng phân hiệu mình được giao.
 * - Mọi đường dẫn Webhook lấy động theo `window.location.origin` (không cố định tên miền).
 */
export default function SchoolCampusManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const storedUser = getStoredUser() || {};
  const userRole = storedUser.role;
  const isAdmin = userRole === 'admin';
  const isVendorSupport = Boolean(storedUser.isVendorSupport || localStorage.getItem('superadmin_token'));

  // Mặc định nếu vào /campuses?tab=settings thì mở ngay Tab Cài đặt Vận hành; /campuses mở Tab Tổng quan & Hồ sơ Phân hiệu
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
      setSettingsForm({
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
      });
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

      // Đồng bộ luôn thông tin giờ mở/đóng cửa, số điện thoại và người phụ trách vào cơ sở của phân hiệu
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
      title={isAdmin ? 'Quản trị Cài đặt Phân hiệu Trường' : 'Thông tin Phân hiệu Trường'}
      subtitle={
        isAdmin
          ? 'Thiết lập giờ đón trả trẻ, quy tắc vận hành phân hiệu, cấp tài khoản chức năng (Giám đốc, Giáo viên, Đầu bếp, Kế toán, Bảo vệ...) và đồng bộ máy chấm công.'
          : 'Xem thông tin liên hệ, giờ hoạt động chuẩn và quy mô lớp học của phân hiệu.'
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
            <div>
              <strong>🔧 Chế độ Kỹ thuật viên Nhà cung cấp phần mềm:</strong> Bạn đang cấu hình bàn giao cho phân hiệu{' '}
              <strong>{school?.name || '—'} ({school?.code || '—'})</strong>. Bạn có thể đổi nhanh sang phân hiệu khác ở cột menu bên trái để gán máy chấm công.
            </div>
            <Link className="button button-secondary" to="/devices" style={{ minHeight: 36 }}>
              Quét &amp; Gán Máy Chấm Công →
            </Link>
          </div>
        )}

        {notice && (
          <div
            className={notice.type === 'error' ? 'form-error' : 'timekeeping-notice success'}
            role="status"
            style={{ marginBottom: 18 }}
          >
            <Icon name={notice.type === 'error' ? 'alertCircle' : 'check'} size={16} />
            <span>{notice.text}</span>
          </div>
        )}

        {/* 4 THẺ CHỈ SỐ RIÊNG CỦA PHÂN HIỆU */}
        <div className="classroom-summary-grid">
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

        {/* BẢNG LỐI TẮT CHỨC TRÁCH ĐÚNG CHUẨN CỦA ADMIN PHÂN HIỆU TRƯỜNG */}
        {isAdmin && (
          <section
            className="content-card"
            style={{
              padding: '20px 24px',
              marginBottom: 20,
              border: '1px solid #bfdbfe',
              background: 'linear-gradient(135deg, #f8fbff 0%, #eff6ff 100%)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div>
                <p className="card-kicker" style={{ color: '#1d4ed8' }}>TRUNG TÂM QUẢN TRỊ PHÂN HIỆU ({school?.code || 'TRƯỜNG'})</p>
                <h2 style={{ margin: '4px 0 4px', fontSize: 18, color: '#0f172a' }}>
                  {school?.name || 'Trường Mầm non Hoa Nắng'}
                </h2>
                <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>
                  Admin phân hiệu quản lý cài đặt hệ thống của trường mình, tạo các tài khoản chức năng (Giám đốc/Hiệu trưởng, Giáo viên, Đầu bếp, Kế toán, Nhân sự, Bảo vệ) và đồng bộ máy chấm công của phân hiệu.
                </p>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12
              }}
            >
              <Link
                to="/accounts"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '13px 15px',
                  borderRadius: 14,
                  background: '#ffffff',
                  border: '1px solid #dbeafe',
                  boxShadow: '0 2px 8px rgba(30, 58, 138, 0.04)'
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
                  border: '1px solid #dbeafe',
                  boxShadow: '0 2px 8px rgba(30, 58, 138, 0.04)'
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
                  border: '1px solid #dbeafe',
                  boxShadow: '0 2px 8px rgba(30, 58, 138, 0.04)'
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
                  border: '1px solid #dbeafe',
                  boxShadow: '0 2px 8px rgba(30, 58, 138, 0.04)'
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

        {/* THANH CHUYỂN TAB RÕ RÀNG */}
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

        {loading ? (
          <div className="content-card inline-loader">Đang tải thông tin cấu hình phân hiệu...</div>
        ) : activeTab === 'settings' ? (
          /* TAB CÀI ĐẶT VẬN HÀNH PHÂN HIỆU */
          <div style={{ display: 'grid', gap: 22 }}>
            <section className="content-card" style={{ padding: '26px 28px' }}>
              <div style={{ marginBottom: 20, paddingBottom: 14, borderBottom: '1px solid #eef2f7' }}>
                <p className="card-kicker">THÔNG SỐ VẬN HÀNH RIÊNG CỦA PHÂN HIỆU ({school?.code || '—'})</p>
                <h2 style={{ margin: '5px 0 6px', fontSize: 19, color: '#0f172a' }}>
                  Cấu hình giờ đón trả, bếp ăn &amp; liên hệ của {school?.name || 'Phân hiệu'}
                </h2>
                <p style={{ margin: 0, fontSize: 13, color: '#64748b', lineHeight: 1.55 }}>
                  {isAdmin
                    ? 'Mọi thay đổi dưới đây chỉ áp dụng riêng cho phân hiệu trường của bạn, hoàn toàn độc lập với các trường khác trên hệ thống.'
                    : 'Thông số vận hành hiện hành của phân hiệu do Quản trị viên trường thiết lập.'}
                </p>
              </div>

              <form className="student-form" style={{ padding: 0 }} onSubmit={handleSaveCampusSettings}>
                <div className="student-form-grid">
                  <label>
                    Năm học đang áp dụng (YYYY-YYYY) *
                    <input
                      required
                      disabled={!isAdmin}
                      placeholder="VD: 2026-2027"
                      value={settingsForm.schoolYear}
                      onChange={(e) => setSettingsForm({ ...settingsForm, schoolYear: e.target.value })}
                    />
                  </label>

                  <label>
                    Người phụ trách / Đại diện phân hiệu
                    <input
                      disabled={!isAdmin}
                      maxLength={120}
                      placeholder="VD: Cô Nguyễn Thị Minh (Hiệu trưởng)"
                      value={settingsForm.managerName}
                      onChange={(e) => setSettingsForm({ ...settingsForm, managerName: e.target.value })}
                    />
                  </label>

                  <label>
                    Số điện thoại / Hotline văn phòng phân hiệu
                    <input
                      disabled={!isAdmin}
                      maxLength={30}
                      placeholder="VD: 0243 888 9999"
                      value={settingsForm.hotline}
                      onChange={(e) => setSettingsForm({ ...settingsForm, hotline: e.target.value })}
                    />
                  </label>

                  <label>
                    Email liên hệ chính thức của phân hiệu
                    <input
                      type="email"
                      disabled={!isAdmin}
                      placeholder="vanphong@ten-truong.edu.vn"
                      value={settingsForm.contactEmail}
                      onChange={(e) => setSettingsForm({ ...settingsForm, contactEmail: e.target.value })}
                    />
                  </label>

                  <label className="form-wide">
                    Địa chỉ phân hiệu trường
                    <input
                      disabled={!isAdmin}
                      maxLength={300}
                      placeholder="Nhập địa chỉ cụ thể của phân hiệu trường"
                      value={settingsForm.headquartersAddress}
                      onChange={(e) => setSettingsForm({ ...settingsForm, headquartersAddress: e.target.value })}
                    />
                  </label>

                  <label>
                    Giờ mở cửa đón trẻ buổi sáng *
                    <input
                      type="time"
                      required
                      disabled={!isAdmin}
                      value={settingsForm.standardCheckInTime}
                      onChange={(e) => setSettingsForm({ ...settingsForm, standardCheckInTime: e.target.value })}
                    />
                  </label>

                  <label>
                    Giờ trả trẻ chuẩn buổi chiều *
                    <input
                      type="time"
                      required
                      disabled={!isAdmin}
                      value={settingsForm.standardCheckOutTime}
                      onChange={(e) => setSettingsForm({ ...settingsForm, standardCheckOutTime: e.target.value })}
                    />
                  </label>

                  <label>
                    Số phút cho phép trễ trước khi tính đi muộn (0–120 phút)
                    <input
                      type="number"
                      min={0}
                      max={120}
                      disabled={!isAdmin}
                      value={settingsForm.lateGraceMinutes}
                      onChange={(e) => setSettingsForm({ ...settingsForm, lateGraceMinutes: e.target.value })}
                    />
                  </label>

                  <label>
                    Giờ chốt báo nghỉ để bếp cắt suất ăn trong ngày *
                    <input
                      type="time"
                      required
                      disabled={!isAdmin}
                      value={settingsForm.mealCancelCutoffTime}
                      onChange={(e) => setSettingsForm({ ...settingsForm, mealCancelCutoffTime: e.target.value })}
                    />
                  </label>

                  <label className="form-wide">
                    Ghi chú cổng đón trả / hướng dẫn nội bộ tại phân hiệu
                    <input
                      disabled={!isAdmin}
                      maxLength={300}
                      placeholder="VD: Cổng chính mở từ 06:45, phụ huynh đón trẻ xuất trình mã QR tại sảnh tầng 1..."
                      value={settingsForm.campusNotes}
                      onChange={(e) => setSettingsForm({ ...settingsForm, campusNotes: e.target.value })}
                    />
                  </label>

                  <label className="form-wide">
                    Dòng ghi chú cuối Phiếu thu học phí &amp; Thông báo gửi phụ huynh
                    <input
                      disabled={!isAdmin}
                      maxLength={300}
                      placeholder="VD: Mọi thắc mắc kính mời Quý Phụ huynh liên hệ Văn phòng Nhà trường trong giờ hành chính."
                      value={settingsForm.internalAnnouncementFooter}
                      onChange={(e) => setSettingsForm({ ...settingsForm, internalAnnouncementFooter: e.target.value })}
                    />
                  </label>

                  <div className="form-wide" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginTop: 4 }}>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '14px 16px',
                        borderRadius: 12,
                        border: '1px solid #cbd5e1',
                        background: '#f8fafc',
                        cursor: isAdmin ? 'pointer' : 'default'
                      }}
                    >
                      <input
                        type="checkbox"
                        disabled={!isAdmin}
                        checked={settingsForm.requirePickupQrVerification}
                        onChange={(e) => setSettingsForm({ ...settingsForm, requirePickupQrVerification: e.target.checked })}
                      />
                      <span style={{ fontSize: 13, color: '#1e293b' }}>
                        Bắt buộc quét Mã QR / mã xác nhận của người đón khi bàn giao trẻ về nhà
                      </span>
                    </label>

                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '14px 16px',
                        borderRadius: 12,
                        border: '1px solid #cbd5e1',
                        background: '#f8fafc',
                        cursor: isAdmin ? 'pointer' : 'default'
                      }}
                    >
                      <input
                        type="checkbox"
                        disabled={!isAdmin}
                        checked={settingsForm.allowParentOnlineLeave}
                        onChange={(e) => setSettingsForm({ ...settingsForm, allowParentOnlineLeave: e.target.checked })}
                      />
                      <span style={{ fontSize: 13, color: '#1e293b' }}>
                        Cho phép Phụ huynh gửi đơn xin nghỉ phép cho bé trực tuyến trên ứng dụng
                      </span>
                    </label>
                  </div>
                </div>

                {isAdmin && (
                  <div className="form-actions" style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #eef2f7' }}>
                    <button type="submit" className="button button-primary" disabled={savingSettings}>
                      <Icon name="check" size={16} />
                      {savingSettings ? 'Đang lưu cài đặt...' : 'Lưu cài đặt vận hành phân hiệu'}
                    </button>
                  </div>
                )}
              </form>
            </section>
          </div>
        ) : (
          /* TAB HỒ SƠ PHÂN HIỆU & GÓI PHẦN MỀM ĐƯỢC CẤP PHÉP */
          <div style={{ display: 'grid', gap: 22 }}>
            <section className="content-card" style={{ padding: '24px 26px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
                <div>
                  <p className="card-kicker">THÔNG TIN ĐƠN VỊ PHÂN HIỆU</p>
                  <h2 style={{ margin: '4px 0 6px', fontSize: 20, color: '#0f172a' }}>
                    {school?.name || 'Trường Mầm non'} ({school?.code || '—'})
                  </h2>
                  <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
                    Thông tin tóm tắt của phân hiệu hiện tại. Để thay đổi giờ giấc, địa chỉ hoặc quy tắc đón trả trẻ, hãy bấm nút <strong>Chỉnh sửa cài đặt phân hiệu</strong>.
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

            {/* ĐƯỜNG DẪN NHẬN ĐIỂM DANH TỰ ĐỘNG & GÓI TÍNH NĂNG */}
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
                          padding: '5px 12px',
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
