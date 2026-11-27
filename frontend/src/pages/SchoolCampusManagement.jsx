import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import {
  getSchoolCampuses,
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

export default function SchoolCampusManagement() {
  const userRole = getStoredUser().role;
  const isAdmin = userRole === 'admin';

  const [school, setSchool] = useState(null);
  const [systemStandards, setSystemStandards] = useState(null);
  const [campuses, setCampuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [deletingCode, setDeletingCode] = useState('');

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
      setSchool(payload.school || null);
      setSystemStandards(payload.systemStandards || null);
      setCampuses(payload.campuses || []);
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.message || 'Không thể tải danh sách phân hiệu của trường.' });
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

  const openCreateCampus = () => {
    setEditingCampus(null);
    setCampusForm(makeEmptyCampusForm(systemStandards));
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
      openTime: campus.openTime || systemStandards?.standardCheckInTime || '07:00',
      closeTime: campus.closeTime || systemStandards?.standardCheckOutTime || '16:30',
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

  const totalClasses = campuses.reduce((sum, c) => sum + (c.classCount || 0), 0);
  const totalStudents = campuses.reduce((sum, c) => sum + (c.studentCount || 0), 0);
  const maxCampusesQuota = school?.quotas?.maxCampuses || 10;
  const maxStudentsQuota = school?.quotas?.maxStudents || 800;
  const reachedCampusQuota = campuses.length >= maxCampusesQuota;

  return (
    <AppShell
      title="Quản lý Phân hiệu & Cơ sở trường"
      subtitle="Quản lý cấu hình vận hành của các Phân hiệu trực thuộc trường (định danh cấp Trường và gói tính năng do Quản trị Tổng cấp phát)."
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
              <Icon name="plus" size={15} /> Thêm phân hiệu mới ({campuses.length}/{maxCampusesQuota})
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

        <div className="classroom-summary-grid">
          <article>
            <span className="summary-badge blue"><Icon name="shield" size={20} /></span>
            <div>
              <small>MÃ TRƯỜNG (DO SUPERADMIN CẤP)</small>
              <strong>{school?.code || 'HOANANG'}</strong>
            </div>
          </article>
          <article>
            <span className="summary-badge amber"><Icon name="classes" size={20} /></span>
            <div>
              <small>PHÂN HIỆU / HẠN MỨC CẤP PHÉP</small>
              <strong>{campuses.length} / {maxCampusesQuota} cơ sở</strong>
            </div>
          </article>
          <article>
            <span className="summary-badge green"><Icon name="grid" size={20} /></span>
            <div>
              <small>LỚP ĐANG HOẠT ĐỘNG</small>
              <strong>{totalClasses} lớp</strong>
            </div>
          </article>
          <article>
            <span className="summary-badge purple"><Icon name="students" size={20} /></span>
            <div>
              <small>HỌC SINH / HẠN MỨC TRƯỜNG</small>
              <strong>{totalStudents} / {maxStudentsQuota} HS</strong>
            </div>
          </article>
        </div>

        {/* HỒ SƠ ĐỊNH DANH CẤP TRƯỜNG (CHỈ ĐỌC — DO SUPERADMIN QUẢN LÝ) */}
        <section className="content-card" style={{ padding: '20px 24px', marginBottom: '18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '14px' }}>
            <div>
              <p className="card-kicker">THÔNG TIN ĐỊNH DANH & GÓI TÍNH NĂNG CẤP TRƯỜNG (CHỈ ĐỌC)</p>
              <h2 style={{ margin: '4px 0 6px', color: '#1e3a8a' }}>{school?.name || 'Trường Mầm non'}</h2>
              <p style={{ margin: '0 0 10px', color: '#475569', fontSize: '13.5px' }}>
                Mã trường: <strong>{school?.code || '—'}</strong>
                {school?.organizationCode ? <> · Cụm hệ thống: <strong>{school.organizationCode}</strong></> : null}
                {school?.contactEmail ? <> · Liên hệ: <strong>{school.contactEmail}</strong></> : null}
                {systemStandards?.defaultSchoolYear ? <> · Năm học chuẩn: <strong>{systemStandards.defaultSchoolYear}</strong></> : null}
              </p>

              {Array.isArray(school?.enabledModules) && school.enabledModules.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {school.enabledModules.map((modKey) => (
                    <span
                      key={modKey}
                      style={{
                        padding: '3px 9px',
                        borderRadius: '999px',
                        background: '#f1f5f9',
                        border: '1px solid #cbd5e1',
                        color: '#334155',
                        fontSize: '11.5px',
                        fontWeight: 600
                      }}
                    >
                      ✓ {MODULE_LABELS[modKey] || modKey}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <Link className="button button-secondary" to="/classrooms">
              <Icon name="classes" size={16} /> Mở Quản lý Lớp học theo Phân hiệu
            </Link>
          </div>
        </section>

        <section className="content-card student-list-card">
          <div className="list-toolbar">
            <div>
              <p className="card-kicker">CẤU HÌNH VẬN HÀNH PHÂN HIỆU TRỰC THUỘC TRƯỜNG</p>
              <h2>Danh sách Phân hiệu / Cơ sở ({campuses.length})</h2>
              <p>
                Admin trường quản lý trực tiếp địa chỉ, người phụ trách, khung giờ đón – trả trẻ và trạng thái hoạt động của từng phân hiệu thuộc trường mình.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="inline-loader">Đang tải danh sách phân hiệu...</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Mã cơ sở</th>
                    <th>Tên phân hiệu / Cơ sở</th>
                    <th>Địa chỉ & Điện thoại</th>
                    <th>Phụ trách & Giờ đón – trả</th>
                    <th>Quy mô lớp & Học sinh</th>
                    <th>Trạng thái</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {campuses.map((c) => (
                    <tr key={c.code || c.name}>
                      <td><strong>{c.code}</strong></td>
                      <td>
                        <strong>{c.name}</strong>
                        {c.notes && <small style={{ display: 'block', color: '#64748b' }}>{c.notes}</small>}
                      </td>
                      <td>
                        <div>{c.address || 'Chưa cập nhật địa chỉ'}</div>
                        {c.phone && <small style={{ color: '#64748b' }}>SĐT: {c.phone}</small>}
                      </td>
                      <td>
                        <div>{c.managerName || '—'}</div>
                        <small style={{ color: '#475569' }}>
                          Đón – trả: <strong>{c.openTime || '07:00'} – {c.closeTime || '16:30'}</strong>
                        </small>
                      </td>
                      <td>
                        <strong>{c.classCount || 0}/{c.maxClassrooms || 20} lớp</strong> · <span>{c.studentCount || 0} HS</span>
                      </td>
                      <td>
                        <span className={`student-status ${c.isActive !== false ? 'enrolled' : 'temporarily_absent'}`}>
                          {c.isActive !== false ? 'Đang hoạt động' : 'Tạm ngưng'}
                        </span>
                      </td>
                      <td>
                        <div className="classroom-actions">
                          <Link className="button button-secondary" to="/students">
                            Xem HS
                          </Link>
                          {isAdmin && (
                            <>
                              <button type="button" className="button button-secondary" onClick={() => openEditCampus(c)}>
                                Cấu hình
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
