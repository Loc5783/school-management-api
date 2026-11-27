import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import {
  getSchoolCampuses,
  createCampus,
  updateCampus,
  deleteCampus,
  updateCurrentSchoolInfo
} from '../api/multiSchool';
import { getStoredTenant, getStoredUser } from '../utils/storage';

const emptyCampusForm = {
  code: '',
  name: '',
  address: '',
  phone: '',
  managerName: '',
  isActive: true
};

export default function SchoolCampusManagement() {
  const userRole = getStoredUser().role;
  const isAdmin = userRole === 'admin';

  const [school, setSchool] = useState(null);
  const [campuses, setCampuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [deletingCode, setDeletingCode] = useState('');

  const [showCampusModal, setShowCampusModal] = useState(false);
  const [editingCampus, setEditingCampus] = useState(null);
  const [campusForm, setCampusForm] = useState(emptyCampusForm);
  const [savingCampus, setSavingCampus] = useState(false);
  const [campusError, setCampusError] = useState('');

  const [showSchoolModal, setShowSchoolModal] = useState(false);
  const [schoolForm, setSchoolForm] = useState({ name: '', organizationCode: '', contactEmail: '' });
  const [savingSchool, setSavingSchool] = useState(false);
  const [schoolError, setSchoolError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSchoolCampuses();
      const payload = res.data?.data || {};
      setSchool(payload.school || null);
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
    setCampusForm(emptyCampusForm);
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
      if (editingCampus) {
        await updateCampus(editingCampus.code, campusForm);
      } else {
        await createCampus(campusForm);
      }
      setShowCampusModal(false);
      await load();
      setNotice({
        type: 'success',
        text: editingCampus ? 'Đã cập nhật thông tin phân hiệu thành công.' : 'Đã thêm phân hiệu mới cho trường.'
      });
    } catch (err) {
      setCampusError(err.response?.data?.message || 'Không thể lưu thông tin phân hiệu.');
    } finally {
      setSavingCampus(false);
    }
  };

  useEffect(() => {
    if (!showCampusModal && !showSchoolModal) return undefined;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (showCampusModal && !savingCampus) setShowCampusModal(false);
        if (showSchoolModal && !savingSchool) setShowSchoolModal(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showCampusModal, showSchoolModal, savingCampus, savingSchool]);

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

  const openEditSchool = () => {
    setSchoolError('');
    setSchoolForm({
      name: school?.name || '',
      organizationCode: school?.organizationCode || '',
      contactEmail: school?.contactEmail || ''
    });
    setShowSchoolModal(true);
  };

  const handleSaveSchool = async (e) => {
    e.preventDefault();
    if (savingSchool) return;
    setSavingSchool(true);
    setSchoolError('');
    try {
      const res = await updateCurrentSchoolInfo(schoolForm);
      const updated = res.data?.data;
      if (updated) {
        const storedTenant = getStoredTenant();
        if (storedTenant) {
          localStorage.setItem('tenant', JSON.stringify({ ...storedTenant, name: updated.name }));
          window.dispatchEvent(new Event('tenant-updated'));
        }
      }
      setShowSchoolModal(false);
      await load();
      setNotice({ type: 'success', text: 'Đã cập nhật thông tin định danh của trường.' });
    } catch (err) {
      setSchoolError(err.response?.data?.message || 'Không thể cập nhật thông tin trường.');
    } finally {
      setSavingSchool(false);
    }
  };

  const totalClasses = campuses.reduce((sum, c) => sum + (c.classCount || 0), 0);
  const totalStudents = campuses.reduce((sum, c) => sum + (c.studentCount || 0), 0);

  return (
    <AppShell
      title="Trường & Phân hiệu"
      subtitle="Quản lý thông tin định danh trường học và danh sách các Phân hiệu / Cơ sở trực thuộc."
      actions={(
        <div className="toolbar-buttons">
          <button type="button" className="button button-secondary" onClick={load} disabled={loading}>
            <Icon name="refresh" size={15} /> Làm mới
          </button>
          {isAdmin && (
            <>
              <button type="button" className="button button-secondary" onClick={openEditSchool}>
                <Icon name="settings" size={15} /> Sửa thông tin trường
              </button>
              <button type="button" className="button button-primary" onClick={openCreateCampus}>
                <Icon name="plus" size={15} /> Thêm phân hiệu mới
              </button>
            </>
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
              <small>MÃ TRƯỜNG ĐỘC LẬP</small>
              <strong>{school?.code || 'HOANANG'}</strong>
            </div>
          </article>
          <article>
            <span className="summary-badge amber"><Icon name="classes" size={20} /></span>
            <div>
              <small>TỔNG PHÂN HIỆU / CƠ SỞ</small>
              <strong>{campuses.length} cơ sở</strong>
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
              <small>HỌC SINH TOÀN TRƯỜNG</small>
              <strong>{totalStudents} học sinh</strong>
            </div>
          </article>
        </div>

        <section className="content-card" style={{ padding: '20px 24px', marginBottom: '18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <p className="card-kicker">ĐƠN VỊ TRƯỜNG HỌC ĐANG ĐIỀU HÀNH</p>
              <h2 style={{ margin: '4px 0 6px', color: '#1e3a8a' }}>{school?.name || 'Trường Mầm non'}</h2>
              <p style={{ margin: 0, color: '#475569', fontSize: '13.5px' }}>
                Mã đăng nhập trường: <strong>{school?.code || '—'}</strong>
                {school?.organizationCode ? <> · Cụm / Chuỗi trường: <strong>{school.organizationCode}</strong></> : null}
                {school?.contactEmail ? <> · Liên hệ: <strong>{school.contactEmail}</strong></> : null}
              </p>
            </div>
            <Link className="button button-secondary" to="/classrooms">
              <Icon name="classes" size={16} /> Mở Quản lý Lớp học theo Phân hiệu
            </Link>
          </div>
        </section>

        <section className="content-card student-list-card">
          <div className="list-toolbar">
            <div>
              <p className="card-kicker">CƠ CẤU PHÂN HIỆU TRỰC THUỘC</p>
              <h2>Danh sách Phân hiệu / Cơ sở ({campuses.length})</h2>
              <p>Mỗi trường có thể chia thành nhiều phân hiệu (Cơ sở chính, Phân hiệu 1, Phân hiệu 2...) để phân bổ lớp học và học sinh rõ ràng.</p>
            </div>
          </div>

          {loading ? (
            <div className="inline-loader">Đang tải danh sách phân hiệu...</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Mã phân hiệu</th>
                    <th>Tên phân hiệu / Cơ sở</th>
                    <th>Địa chỉ & Điện thoại</th>
                    <th>Người phụ trách</th>
                    <th>Quy mô hiện tại</th>
                    <th>Trạng thái</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {campuses.map((c) => (
                    <tr key={c.code || c.name}>
                      <td><strong>{c.code}</strong></td>
                      <td><strong>{c.name}</strong></td>
                      <td>
                        <div>{c.address || 'Chưa cập nhật địa chỉ'}</div>
                        {c.phone && <small style={{ color: '#64748b' }}>SĐT: {c.phone}</small>}
                      </td>
                      <td>{c.managerName || '—'}</td>
                      <td>
                        <strong>{c.classCount || 0} lớp</strong> · <span>{c.studentCount || 0} học sinh</span>
                      </td>
                      <td>
                        <span className={`student-status ${c.isActive !== false ? 'enrolled' : 'temporarily_absent'}`}>
                          {c.isActive !== false ? 'Đang hoạt động' : 'Tạm ngưng'}
                        </span>
                      </td>
                      <td>
                        <div className="classroom-actions">
                          <Link className="button button-secondary" to={`/students`}>
                            Xem HS
                          </Link>
                          {isAdmin && (
                            <>
                              <button type="button" className="button button-secondary" onClick={() => openEditCampus(c)}>
                                Sửa
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
            <form className="account-modal-card student-form" onSubmit={handleSaveCampus}>
              <div className="account-modal-header">
                <div>
                  <p className="card-kicker">{editingCampus ? 'CẬP NHẬT PHÂN HIỆU' : 'THÊM PHÂN HIỆU MỚI'}</p>
                  <h2>{editingCampus ? `Phân hiệu: ${editingCampus.name}` : 'Khai báo Phân hiệu / Cơ sở'}</h2>
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
                  Điện thoại cơ sở
                  <input
                    maxLength={20}
                    placeholder="VD: 0243 999 8888"
                    value={campusForm.phone}
                    onChange={(e) => setCampusForm({ ...campusForm, phone: e.target.value })}
                  />
                </label>
                <label className="form-wide">
                  Địa chỉ phân hiệu
                  <input
                    maxLength={300}
                    placeholder="Nhập địa chỉ cụ thể của cơ sở / phân hiệu"
                    value={campusForm.address}
                    onChange={(e) => setCampusForm({ ...campusForm, address: e.target.value })}
                  />
                </label>
              </div>

              <div className="form-actions">
                <button type="button" className="button button-secondary" disabled={savingCampus} onClick={() => setShowCampusModal(false)}>
                  Hủy
                </button>
                <button type="submit" className="button button-primary" disabled={savingCampus}>
                  {savingCampus ? 'Đang lưu...' : (editingCampus ? 'Lưu cập nhật' : 'Tạo phân hiệu')}
                </button>
              </div>
            </form>
          </div>,
          document.body
        )}

        {showSchoolModal && createPortal(
          <div
            className="account-modal-backdrop"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget && !savingSchool) setShowSchoolModal(false);
            }}
          >
            <form className="account-modal-card student-form" onSubmit={handleSaveSchool}>
              <div className="account-modal-header">
                <div>
                  <p className="card-kicker">THÔNG TIN TRƯỜNG HỌC</p>
                  <h2>Cập nhật hồ sơ đơn vị trường</h2>
                </div>
                <button type="button" className="button button-secondary" disabled={savingSchool} onClick={() => setShowSchoolModal(false)}>
                  Đóng
                </button>
              </div>
              {schoolError && <div className="form-error" role="alert">{schoolError}</div>}
              <div className="student-form-grid">
                <label className="form-wide">
                  Tên trường hiển thị *
                  <input
                    required
                    maxLength={160}
                    value={schoolForm.name}
                    onChange={(e) => setSchoolForm({ ...schoolForm, name: e.target.value })}
                  />
                </label>
                <label>
                  Mã cụm / Hệ thống chuỗi trường
                  <input
                    maxLength={40}
                    placeholder="VD: HE-THONG-HOA-NANG"
                    value={schoolForm.organizationCode}
                    onChange={(e) => setSchoolForm({ ...schoolForm, organizationCode: e.target.value.toUpperCase() })}
                  />
                </label>
                <label>
                  Email liên hệ chính thức
                  <input
                    type="email"
                    placeholder="vanphong@truong.edu.vn"
                    value={schoolForm.contactEmail}
                    onChange={(e) => setSchoolForm({ ...schoolForm, contactEmail: e.target.value })}
                  />
                </label>
              </div>
              <div className="form-actions">
                <button type="button" className="button button-secondary" disabled={savingSchool} onClick={() => setShowSchoolModal(false)}>
                  Hủy
                </button>
                <button type="submit" className="button button-primary" disabled={savingSchool}>
                  {savingSchool ? 'Đang lưu...' : 'Lưu thông tin trường'}
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
