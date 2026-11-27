import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import {
  getSchoolCampuses,
  updateSchoolSystemSettings,
  createCampus,
  updateCampus,
  deleteCampus
} from '../api/multiSchool';
import { getStoredUser } from '../utils/storage';

const makeEmptyCampusForm = (standards = {}) => ({
  code: '',
  name: '',
  address: '',
  phone: '',
  managerName: '',
  openTime: standards?.standardCheckInTime || '07:00',
  closeTime: standards?.standardCheckOutTime || '16:30',
  maxClassrooms: 20,
  notes: '',
  isActive: true
});

const DEFAULT_SCHOOL_SETTINGS = {
  contactEmail: '',
  schoolYear: '2026-2027',
  hotline: '',
  headquartersAddress: '',
  standardCheckInTime: '07:00',
  standardCheckOutTime: '16:30',
  lateGraceMinutes: 15,
  mealCancelCutoffTime: '08:00',
  requirePickupQrVerification: true,
  allowParentOnlineLeave: true,
  internalAnnouncementFooter: ''
};

const MODULE_LABELS = {
  students: 'Hồ sơ Học sinh',
  classrooms: 'Lớp & Phân hiệu',
  attendance: 'Điểm danh',
  pickups: 'Đón trả QR',
  guard: 'Trực cổng',
  nutrition: 'Bếp ăn & Lưu mẫu',
  finance: 'Tài chính Học phí',
  hr: 'Nhân sự & Lương',
  timekeeping: 'Chấm công ISAPI',
  procurement: 'Cơ sở vật chất',
  feedback: 'Phản hồi Phụ huynh',
  chat: 'Tin nhắn',
  notifications: 'Thông báo',
  reports: 'Báo cáo'
};

/**
 * Trung tâm Cài đặt Hệ thống Trường & Cấu hình Phân hiệu dành cho Admin riêng của từng trường (`role === 'admin'`),
 * đồng thời hỗ trợ chế độ xem thông tin cơ sở trực thuộc cho Ban Giám đốc (`role === 'principal'`).
 */
export default function SchoolCampusManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const userRole = getStoredUser().role;
  const isAdmin = userRole === 'admin';

  const activeTab = searchParams.get('tab') === 'settings' ? 'settings' : 'campuses';
  const switchTab = (nextTab) => {
    const next = new URLSearchParams(searchParams);
    if (nextTab === 'campuses') next.delete('tab');
    else next.set('tab', nextTab);
    setSearchParams(next);
  };

  const [school, setSchool] = useState(null);
  const [systemStandards, setSystemStandards] = useState(null);
  const [campuses, setCampuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [deletingCode, setDeletingCode] = useState('');
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  // State Cài đặt Hệ thống Vận hành của Trường & Phân hiệu
  const [settingsForm, setSettingsForm] = useState(DEFAULT_SCHOOL_SETTINGS);
  const [savingSettings, setSavingSettings] = useState(false);

  // State Modal Thêm / Sửa Phân hiệu
  const [showCampusModal, setShowCampusModal] = useState(false);
  const [editingCampus, setEditingCampus] = useState(null);
  const [campusForm, setCampusForm] = useState(() => makeEmptyCampusForm());
  const [savingCampus, setSavingCampus] = useState(false);
  const [campusError, setCampusError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSchoolCampuses();
      const payload = res.data?.data || {};
      const loadedSchool = payload.school || null;
      const loadedStandards = payload.systemStandards || null;
      const loadedCampuses = payload.campuses || [];

      setSchool(loadedSchool);
      setSystemStandards(loadedStandards);
      setCampuses(loadedCampuses);

      const ss = loadedSchool?.schoolSettings || {};
      setSettingsForm({
        contactEmail: loadedSchool?.contactEmail || '',
        schoolYear: ss.schoolYear || loadedStandards?.defaultSchoolYear || '2026-2027',
        hotline: ss.hotline || '',
        headquartersAddress: ss.headquartersAddress || loadedCampuses[0]?.address || '',
        standardCheckInTime: ss.standardCheckInTime || loadedStandards?.standardCheckInTime || '07:00',
        standardCheckOutTime: ss.standardCheckOutTime || loadedStandards?.standardCheckOutTime || '16:30',
        lateGraceMinutes: ss.lateGraceMinutes ?? 15,
        mealCancelCutoffTime: ss.mealCancelCutoffTime || '08:00',
        requirePickupQrVerification: ss.requirePickupQrVerification !== false,
        allowParentOnlineLeave: ss.allowParentOnlineLeave !== false,
        internalAnnouncementFooter: ss.internalAnnouncementFooter || ''
      });
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.message || 'Không thể tải cấu hình trường và phân hiệu.' });
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

  const handleSaveSchoolSettings = async (e) => {
    e.preventDefault();
    if (!isAdmin || savingSettings) return;
    setSavingSettings(true);
    setNotice(null);
    try {
      const res = await updateSchoolSystemSettings({
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
      setNotice({
        type: 'success',
        text: res.data?.message || 'Đã lưu cài đặt hệ thống vận hành của trường & phân hiệu thành công.'
      });
      await load();
    } catch (err) {
      setNotice({
        type: 'error',
        text: err.response?.data?.message || 'Không thể lưu cài đặt hệ thống của trường.'
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const openCreateCampus = () => {
    setEditingCampus(null);
    setCampusForm(makeEmptyCampusForm(school?.schoolSettings || systemStandards));
    setCampusError('');
    setShowCampusModal(true);
  };

  const openEditCampus = (campus) => {
    setEditingCampus(campus);
    setCampusForm({
      code: campus.code || '',
      name: campus.name || '',
      address: campus.address || '',
      phone: campus.phone || '',
      managerName: campus.managerName || '',
      openTime: campus.openTime || school?.schoolSettings?.standardCheckInTime || '07:00',
      closeTime: campus.closeTime || school?.schoolSettings?.standardCheckOutTime || '16:30',
      maxClassrooms: campus.maxClassrooms || 20,
      notes: campus.notes || '',
      isActive: campus.isActive !== false
    });
    setCampusError('');
    setShowCampusModal(true);
  };

  const handleSaveCampus = async (e) => {
    e.preventDefault();
    if (savingCampus) return;
    setSavingCampus(true);
    setCampusError('');
    try {
      const payload = {
        ...campusForm,
        maxClassrooms: Number(campusForm.maxClassrooms) || 20
      };
      if (editingCampus) {
        await updateCampus(editingCampus.code, payload);
      } else {
        await createCampus(payload);
      }
      setShowCampusModal(false);
      await load();
      setNotice({
        type: 'success',
        text: editingCampus ? 'Đã cập nhật cấu hình phân hiệu thành công.' : 'Đã thêm phân hiệu mới cho trường.'
      });
    } catch (err) {
      setCampusError(err.response?.data?.message || 'Không thể lưu cấu hình phân hiệu.');
    } finally {
      setSavingCampus(false);
    }
  };

  useEffect(() => {
    if (!showCampusModal) return undefined;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !savingCampus) {
        setShowCampusModal(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showCampusModal, savingCampus]);

  const handleDeleteCampus = async (campus) => {
    if (deletingCode) return;
    if (!window.confirm(`Xóa phân hiệu "${campus.name}" khỏi danh sách cơ sở của trường?`)) return;
    setDeletingCode(campus.code);
    try {
      await deleteCampus(campus.code);
      await load();
      setNotice({ type: 'success', text: `Đã xóa phân hiệu "${campus.name}".` });
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.message || 'Không thể xóa phân hiệu này.' });
    } finally {
      setDeletingCode('');
    }
  };

  const copyWebhookUrl = async () => {
    if (!school?.code) return;
    const url = `${window.location.origin}/api/attendance/webhook/${school.code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedWebhook(true);
      window.setTimeout(() => setCopiedWebhook(false), 2200);
    } catch {
      // Bỏ qua nếu trình duyệt chặn clipboard
    }
  };

  const totalClasses = campuses.reduce((sum, c) => sum + (c.classCount || 0), 0);
  const totalStudents = campuses.reduce((sum, c) => sum + (c.studentCount || 0), 0);
  const maxCampusesQuota = school?.quotas?.maxCampuses || 10;
  const maxStudentsQuota = school?.quotas?.maxStudents || 800;
  const reachedCampusQuota = campuses.length >= maxCampusesQuota;

  return (
    <AppShell
      title={isAdmin ? 'Cài đặt Hệ thống Trường & Phân hiệu' : 'Hệ thống Phân hiệu & Cơ sở Trường'}
      subtitle={
        isAdmin
          ? 'Quản trị cấu hình vận hành hệ thống của trường, thiết lập các Phân hiệu trực thuộc, phân quyền tài khoản và kết nối thiết bị.'
          : 'Theo dõi quy mô các Phân hiệu trực thuộc và thông số vận hành chuẩn của nhà trường.'
      }
      actions={(
        <div className="toolbar-buttons">
          <button type="button" className="button button-secondary" onClick={load} disabled={loading}>
            <Icon name="refresh" size={15} /> Làm mới
          </button>
          {isAdmin && (
            <button
              type="button"
              className="button button-primary"
              disabled={reachedCampusQuota}
              title={reachedCampusQuota ? `Trường đã đạt hạn mức ${maxCampusesQuota} phân hiệu` : undefined}
              onClick={openCreateCampus}
            >
              <Icon name="plus" size={15} /> Thêm phân hiệu ({campuses.length}/{maxCampusesQuota})
            </button>
          )}
        </div>
      )}
    >
      <section className="classroom-page">
        {notice && (
          <div className={notice.type === 'error' ? 'form-error' : 'timekeeping-notice success'} role="status">
            <Icon name={notice.type === 'error' ? 'alertCircle' : 'check'} size={16} />
            <span>{notice.text}</span>
          </div>
        )}

        {/* 4 THẺ CHỈ SỐ HỆ THỐNG CỦA ĐƠN VỊ TRƯỜNG */}
        <div className="classroom-summary-grid">
          <article>
            <span className="summary-badge blue"><Icon name="shield" size={20} /></span>
            <div>
              <small>MÃ ĐỊNH DANH TRƯỜNG</small>
              <strong>{school?.code || 'HOANANG'}</strong>
            </div>
          </article>
          <article>
            <span className="summary-badge amber"><Icon name="classes" size={20} /></span>
            <div>
              <small>PHÂN HIỆU / HẠN MỨC CẤP</small>
              <strong>{campuses.length} / {maxCampusesQuota} cơ sở</strong>
            </div>
          </article>
          <article>
            <span className="summary-badge green"><Icon name="grid" size={20} /></span>
            <div>
              <small>KHUNG LỚP ĐANG MỞ</small>
              <strong>{totalClasses} lớp</strong>
            </div>
          </article>
          <article>
            <span className="summary-badge purple"><Icon name="students" size={20} /></span>
            <div>
              <small>SĨ SỐ / HẠN MỨC GÓI</small>
              <strong>{totalStudents} / {maxStudentsQuota} HS</strong>
            </div>
          </article>
        </div>

        {/* BẢNG ĐIỀU KHIỂN QUẢN TRỊ NHANH DÀNH RIÊNG CHO ADMIN TRƯỜNG */}
        {isAdmin && (
          <section
            className="content-card"
            style={{
              padding: '18px 22px',
              marginBottom: '18px',
              border: '1px solid #bfdbfe',
              background: 'linear-gradient(135deg, #f8fbff 0%, #eff6ff 100%)'
            }}
          >
            <p className="card-kicker" style={{ color: '#1d4ed8', marginBottom: 4 }}>
              KHÔNG GIAN QUẢN TRỊ KỸ THUẬT & CẤU HÌNH ĐƠN VỊ TRƯỜNG
            </p>
            <h2 style={{ margin: '0 0 6px', fontSize: 17, color: '#0f172a' }}>
              Các tác vụ quản trị của Tài khoản Admin Trường ({school?.name || 'Đơn vị trường'})
            </h2>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
              Tài khoản <strong>Admin trường</strong> chuyên trách cấu hình hệ thống phân hiệu, tạo khung lớp học, kết nối máy chấm công và cấp phát tài khoản cho <strong>Ban Giám đốc, Giáo viên, Đầu bếp, Kế toán, Nhân sự, Bảo vệ</strong> vận hành nghiệp vụ.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))', gap: 12 }}>
              <Link
                to="/accounts"
                className="quick-action"
                style={{ margin: 0, padding: '12px 14px', borderRadius: 12, background: '#fff', border: '1px solid #dbeafe' }}
              >
                <span className="quick-icon blue"><Icon name="users" /></span>
                <span>
                  <strong>Cấp Tài khoản & Vai trò</strong>
                  <small>Tạo Giám đốc, GV, Bếp, Kế toán...</small>
                </span>
                <Icon name="chevronRight" size={16} />
              </Link>
              <Link
                to="/classrooms"
                className="quick-action"
                style={{ margin: 0, padding: '12px 14px', borderRadius: 12, background: '#fff', border: '1px solid #dbeafe' }}
              >
                <span className="quick-icon orange"><Icon name="classes" /></span>
                <span>
                  <strong>Khung Lớp theo Phân hiệu</strong>
                  <small>Khởi tạo lớp & gắn cơ sở</small>
                </span>
                <Icon name="chevronRight" size={16} />
              </Link>
              <Link
                to="/devices"
                className="quick-action"
                style={{ margin: 0, padding: '12px 14px', borderRadius: 12, background: '#fff', border: '1px solid #dbeafe' }}
              >
                <span className="quick-icon green"><Icon name="clock" /></span>
                <span>
                  <strong>Máy chấm công & Webhook</strong>
                  <small>Kết nối thiết bị & ánh xạ ID</small>
                </span>
                <Icon name="chevronRight" size={16} />
              </Link>
              <Link
                to="/audit-logs"
                className="quick-action"
                style={{ margin: 0, padding: '12px 14px', borderRadius: 12, background: '#fff', border: '1px solid #dbeafe' }}
              >
                <span className="quick-icon violet"><Icon name="fileText" /></span>
                <span>
                  <strong>Nhật ký Hệ thống Trường</strong>
                  <small>Kiểm tra lịch sử phân quyền</small>
                </span>
                <Icon name="chevronRight" size={16} />
              </Link>
            </div>
          </section>
        )}

        {/* THANH CHUYỂN ĐỔI GIỮA QUẢN LÝ PHÂN HIỆU & CÀI ĐẶT HỆ THỐNG TRƯỜNG */}
        <div className="account-tabs" role="tablist" style={{ marginBottom: 18 }}>
          <button
            type="button"
            className={activeTab === 'campuses' ? 'active' : ''}
            onClick={() => switchTab('campuses')}
          >
            <Icon name="classes" size={16} />
            1. Danh sách & Cấu hình Phân hiệu ({campuses.length})
          </button>
          <button
            type="button"
            className={activeTab === 'settings' ? 'active' : ''}
            onClick={() => switchTab('settings')}
          >
            <Icon name="settings" size={16} />
            2. Cài đặt Hệ thống Vận hành Trường & Gói cấp phép
          </button>
        </div>

        {/* TAB 1: DANH SÁCH & CẤU HÌNH CÁC PHÂN HIỆU TRỰC THUỘC */}
        {activeTab === 'campuses' && (
          <section className="content-card student-list-card">
            <div className="list-toolbar" style={{ flexWrap: 'wrap' }}>
              <div>
                <p className="card-kicker">CẤU HÌNH VẬN HÀNH TỪNG PHÂN HIỆU TRỰC THUỘC TRƯỜNG</p>
                <h2>Danh sách Phân hiệu / Cơ sở ({campuses.length})</h2>
                <p>
                  {isAdmin
                    ? 'Chỉnh sửa địa chỉ, người phụ trách cơ sở, khung giờ đón – trả trẻ, sức chứa số lớp tối đa và trạng thái hoạt động của từng phân hiệu.'
                    : 'Thông tin địa chỉ, người phụ trách và quy mô lớp học tại từng phân hiệu của nhà trường.'}
                </p>
              </div>
              <Link className="button button-secondary" to="/classrooms">
                <Icon name="classes" size={16} /> Quản lý Lớp học theo Phân hiệu
              </Link>
            </div>

            {loading ? (
              <div className="inline-loader">Đang tải danh sách phân hiệu...</div>
            ) : (
              <div className="table-wrap">
                <table className="data-table account-table">
                  <thead>
                    <tr>
                      <th>Mã cơ sở</th>
                      <th>Tên phân hiệu / Cơ sở</th>
                      <th>Địa chỉ &amp; Điện thoại</th>
                      <th>Phụ trách &amp; Giờ đón – trả</th>
                      <th>Quy mô lớp &amp; Học sinh</th>
                      <th>Trạng thái</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campuses.map((c) => (
                      <tr key={c.code || c.name}>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <code style={{ padding: '3px 8px', borderRadius: 6, background: '#eff6ff', color: '#1e40af', fontWeight: 800 }}>
                            {c.code}
                          </code>
                        </td>
                        <td>
                          <strong>{c.name}</strong>
                          {c.notes && <small>{c.notes}</small>}
                        </td>
                        <td>
                          <div>{c.address || 'Chưa cập nhật địa chỉ'}</div>
                          {c.phone && <small>SĐT: {c.phone}</small>}
                        </td>
                        <td>
                          <div>{c.managerName || '—'}</div>
                          <small>
                            Đón – trả: <strong>{c.openTime || '07:00'} – {c.closeTime || '16:30'}</strong>
                          </small>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <strong>{c.classCount || 0}/{c.maxClassrooms || 20}</strong> lớp · <span>{c.studentCount || 0} HS</span>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span className={`student-status ${c.isActive !== false ? 'enrolled' : 'temporarily_absent'}`}>
                            {c.isActive !== false ? 'Đang hoạt động' : 'Tạm ngưng'}
                          </span>
                        </td>
                        <td>
                          <div className="account-row-actions">
                            <Link className="button button-secondary" to="/classrooms">
                              Xem Lớp
                            </Link>
                            {!isAdmin && (
                              <Link className="button button-secondary" to="/students">
                                Xem HS
                              </Link>
                            )}
                            {isAdmin && (
                              <>
                                <button type="button" className="button button-primary" onClick={() => openEditCampus(c)}>
                                  Cài đặt cơ sở
                                </button>
                                {c.code !== 'CS-CHINH' && (
                                  <button
                                    type="button"
                                    className="button button-danger"
                                    disabled={Boolean(deletingCode)}
                                    onClick={() => handleDeleteCampus(c)}
                                  >
                                    {deletingCode === c.code ? 'Đang xóa...' : 'Xóa'}
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* TAB 2: CÀI ĐẶT HỆ THỐNG VẬN HÀNH CỦA TRƯỜNG & THÔNG TIN CẤP PHÉP */}
        {activeTab === 'settings' && (
          <div style={{ display: 'grid', gap: 18 }}>
            <section className="content-card" style={{ padding: '22px 24px' }}>
              <div style={{ marginBottom: 16 }}>
                <p className="card-kicker">CÀI ĐẶT THÔNG SỐ HỆ THỐNG NỘI BỘ CỦA TRƯỜNG & PHÂN HIỆU</p>
                <h2 style={{ margin: '4px 0 6px' }}>Cấu hình vận hành chung của {school?.name || 'Nhà trường'}</h2>
                <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
                  {isAdmin
                    ? 'Admin trường trực tiếp thiết lập các thông số giờ giấc, quy tắc đón trả trẻ, chốt suất ăn và thông tin liên hệ áp dụng cho các phân hiệu trực thuộc trường.'
                    : 'Các thông số hệ thống hiện hành do Quản trị viên hệ thống của trường thiết lập.'}
                </p>
              </div>

              <form className="student-form" style={{ padding: 0 }} onSubmit={handleSaveSchoolSettings}>
                <div className="student-form-grid">
                  <label>
                    Năm học áp dụng tại trường (YYYY-YYYY) *
                    <input
                      required
                      disabled={!isAdmin}
                      placeholder="VD: 2026-2027"
                      value={settingsForm.schoolYear}
                      onChange={(e) => setSettingsForm({ ...settingsForm, schoolYear: e.target.value })}
                    />
                  </label>

                  <label>
                    Số điện thoại / Hotline văn phòng trường
                    <input
                      disabled={!isAdmin}
                      maxLength={30}
                      placeholder="VD: 0243 888 9999"
                      value={settingsForm.hotline}
                      onChange={(e) => setSettingsForm({ ...settingsForm, hotline: e.target.value })}
                    />
                  </label>

                  <label>
                    Email liên hệ chính thức của trường
                    <input
                      type="email"
                      disabled={!isAdmin}
                      placeholder="vanphong@ten-truong.edu.vn"
                      value={settingsForm.contactEmail}
                      onChange={(e) => setSettingsForm({ ...settingsForm, contactEmail: e.target.value })}
                    />
                  </label>

                  <label>
                    Địa chỉ trụ sở chính
                    <input
                      disabled={!isAdmin}
                      maxLength={300}
                      placeholder="Nhập địa chỉ trụ sở chính của trường"
                      value={settingsForm.headquartersAddress}
                      onChange={(e) => setSettingsForm({ ...settingsForm, headquartersAddress: e.target.value })}
                    />
                  </label>

                  <label>
                    Giờ mở cửa đón trẻ chuẩn toàn trường *
                    <input
                      type="time"
                      required
                      disabled={!isAdmin}
                      value={settingsForm.standardCheckInTime}
                      onChange={(e) => setSettingsForm({ ...settingsForm, standardCheckInTime: e.target.value })}
                    />
                  </label>

                  <label>
                    Giờ trả trẻ chuẩn toàn trường *
                    <input
                      type="time"
                      required
                      disabled={!isAdmin}
                      value={settingsForm.standardCheckOutTime}
                      onChange={(e) => setSettingsForm({ ...settingsForm, standardCheckOutTime: e.target.value })}
                    />
                  </label>

                  <label>
                    Ngưỡng phút tính đi muộn (0–120 phút)
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
                    Giờ chốt báo nghỉ cắt suất ăn bếp trong ngày *
                    <input
                      type="time"
                      required
                      disabled={!isAdmin}
                      value={settingsForm.mealCancelCutoffTime}
                      onChange={(e) => setSettingsForm({ ...settingsForm, mealCancelCutoffTime: e.target.value })}
                    />
                  </label>

                  <label className="form-wide">
                    Ghi chú chân trang trên Thông báo / Phiếu thu của trường
                    <input
                      disabled={!isAdmin}
                      maxLength={300}
                      placeholder="VD: Mọi thắc mắc vui lòng liên hệ Văn phòng Nhà trường trong giờ hành chính."
                      value={settingsForm.internalAnnouncementFooter}
                      onChange={(e) => setSettingsForm({ ...settingsForm, internalAnnouncementFooter: e.target.value })}
                    />
                  </label>

                  <div className="form-wide" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '12px 14px',
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
                      <span>Bắt buộc xác thực Mã QR / OTP khi bàn giao đón trả trẻ</span>
                    </label>

                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '12px 14px',
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
                      <span>Cho phép Phụ huynh gửi đơn xin nghỉ phép trực tuyến trên ứng dụng</span>
                    </label>
                  </div>
                </div>

                {isAdmin && (
                  <div className="form-actions" style={{ marginTop: 18 }}>
                    <button type="submit" className="button button-primary" disabled={savingSettings}>
                      <Icon name="check" size={16} />
                      {savingSettings ? 'Đang lưu cài đặt...' : 'Lưu cài đặt hệ thống trường'}
                    </button>
                  </div>
                )}
              </form>
            </section>

            {/* THÔNG TIN GÓI CẤP PHÉP TỪ SUPERADMIN & ĐƯỜNG DẪN WEBHOOK ĐỒNG BỘ */}
            <section className="content-card" style={{ padding: '20px 24px' }}>
              <p className="card-kicker">THÔNG TIN GÓI CẤP PHÉP PHẦN MỀM & TÍCH HỢP PHẦN CỨNG (DO SUPERADMIN CẤP)</p>
              <h3 style={{ margin: '4px 0 8px', color: '#1e3a8a' }}>
                {school?.name || 'Trường Mầm non'} ({school?.code || '—'})
              </h3>
              <p style={{ margin: '0 0 12px', color: '#475569', fontSize: 13 }}>
                Hạn mức gói: <strong>{maxCampusesQuota} phân hiệu</strong> · <strong>{maxStudentsQuota} học sinh</strong> · <strong>{school?.quotas?.maxStaff || 200} nhân sự</strong>
                {school?.organizationCode ? <> · Cụm hệ thống: <strong>{school.organizationCode}</strong></> : null}
              </p>

              {school?.code && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    flexWrap: 'wrap',
                    padding: '10px 14px',
                    marginBottom: 14,
                    borderRadius: 10,
                    background: '#f8fafc',
                    border: '1px dashed #93c5fd'
                  }}
                >
                  <span style={{ fontSize: 13 }}>
                    Endpoint Webhook đồng bộ máy chấm công &amp; điểm danh HS:{' '}
                    <code style={{ fontWeight: 700, color: '#1e3a8a' }}>
                      {window.location.origin}/api/attendance/webhook/{school.code}
                    </code>
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="button button-secondary" onClick={copyWebhookUrl}>
                      <Icon name="copy" size={14} /> {copiedWebhook ? 'Đã sao chép!' : 'Sao chép URL'}
                    </button>
                    {isAdmin && (
                      <Link className="button button-secondary" to="/devices">
                        Cấu hình Thiết bị →
                      </Link>
                    )}
                  </div>
                </div>
              )}

              {Array.isArray(school?.enabledModules) && school.enabledModules.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {school.enabledModules.map((modKey) => (
                    <span
                      key={modKey}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '999px',
                        background: '#eff6ff',
                        border: '1px solid #bfdbfe',
                        color: '#1e40af',
                        fontSize: '12px',
                        fontWeight: 600
                      }}
                    >
                      ✓ {MODULE_LABELS[modKey] || modKey}
                    </span>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {showCampusModal && createPortal(
          <div
            className="account-modal-backdrop"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget && !savingCampus) setShowCampusModal(false);
            }}
          >
            <form className="account-modal-card student-form" style={{ width: 'min(680px, 96vw)' }} onSubmit={handleSaveCampus}>
              <div className="account-modal-header">
                <div>
                  <p className="card-kicker">{editingCampus ? 'CẤU HÌNH VẬN HÀNH PHÂN HIỆU' : 'THÊM PHÂN HIỆU MỚI'}</p>
                  <h2>{editingCampus ? `Phân hiệu: ${editingCampus.name}` : 'Khai báo Phân hiệu / Cơ sở mới'}</h2>
                </div>
                <button type="button" className="button button-secondary" disabled={savingCampus} onClick={() => setShowCampusModal(false)}>
                  Đóng
                </button>
              </div>

              {campusError && <div className="form-error" role="alert">{campusError}</div>}

              <div className="student-form-grid">
                <label>
                  Tên phân hiệu / Cơ sở *
                  <input
                    required
                    maxLength={120}
                    placeholder="VD: Phân hiệu 2 - Mỹ Đình"
                    value={campusForm.name}
                    onChange={(e) => setCampusForm({ ...campusForm, name: e.target.value })}
                  />
                </label>
                <label>
                  Mã phân hiệu
                  <input
                    maxLength={20}
                    disabled={Boolean(editingCampus)}
                    placeholder="Để trống tự sinh (VD: PH-2)"
                    value={campusForm.code}
                    onChange={(e) => setCampusForm({ ...campusForm, code: e.target.value.toUpperCase() })}
                  />
                </label>
                <label>
                  Người phụ trách cơ sở
                  <input
                    maxLength={120}
                    placeholder="VD: Cô Nguyễn Thu Trang (Phó HT)"
                    value={campusForm.managerName}
                    onChange={(e) => setCampusForm({ ...campusForm, managerName: e.target.value })}
                  />
                </label>
                <label>
                  Điện thoại liên hệ cơ sở
                  <input
                    maxLength={20}
                    placeholder="VD: 0243 999 8888"
                    value={campusForm.phone}
                    onChange={(e) => setCampusForm({ ...campusForm, phone: e.target.value })}
                  />
                </label>
                <label>
                  Giờ mở cửa đón trẻ *
                  <input
                    type="time"
                    required
                    value={campusForm.openTime}
                    onChange={(e) => setCampusForm({ ...campusForm, openTime: e.target.value })}
                  />
                </label>
                <label>
                  Giờ đóng cửa trả trẻ *
                  <input
                    type="time"
                    required
                    value={campusForm.closeTime}
                    onChange={(e) => setCampusForm({ ...campusForm, closeTime: e.target.value })}
                  />
                </label>
                <label>
                  Số lớp học tối đa dự kiến (1–200)
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={campusForm.maxClassrooms}
                    onChange={(e) => setCampusForm({ ...campusForm, maxClassrooms: e.target.value })}
                  />
                </label>
                {editingCampus && editingCampus.code !== 'CS-CHINH' && (
                  <label>
                    Trạng thái hoạt động phân hiệu
                    <select
                      value={campusForm.isActive ? 'active' : 'inactive'}
                      onChange={(e) => setCampusForm({ ...campusForm, isActive: e.target.value === 'active' })}
                    >
                      <option value="active">Đang hoạt động</option>
                      <option value="inactive">Tạm ngưng tuyển sinh / hoạt động</option>
                    </select>
                  </label>
                )}
                <label className="form-wide">
                  Địa chỉ phân hiệu
                  <input
                    maxLength={300}
                    placeholder="Nhập địa chỉ cụ thể của cơ sở / phân hiệu"
                    value={campusForm.address}
                    onChange={(e) => setCampusForm({ ...campusForm, address: e.target.value })}
                  />
                </label>
                <label className="form-wide">
                  Ghi chú vận hành nội bộ cơ sở
                  <input
                    maxLength={500}
                    placeholder="VD: Có sân chơi ngoài trời riêng, cổng đón số 2 đường Nguyễn Cơ Thạch..."
                    value={campusForm.notes}
                    onChange={(e) => setCampusForm({ ...campusForm, notes: e.target.value })}
                  />
                </label>
              </div>

              <div className="form-actions">
                <button type="button" className="button button-secondary" disabled={savingCampus} onClick={() => setShowCampusModal(false)}>
                  Hủy
                </button>
                <button type="submit" className="button button-primary" disabled={savingCampus}>
                  {savingCampus ? 'Đang lưu...' : (editingCampus ? 'Lưu cấu hình phân hiệu' : 'Tạo phân hiệu')}
                </button>
              </div>
            </form>
          </div>,
          document.body
        )}
      </section>
    </AppShell>
  );
}
