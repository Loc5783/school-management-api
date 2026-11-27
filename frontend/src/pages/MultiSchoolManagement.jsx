import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import {
  getSuperAdminSchools,
  createSchoolWithAdmin,
  updateSchoolAndAdmin,
  enterSchoolWorkspace
} from '../api/multiSchool';
import { getStoredSuperAdminUser, getStoredUser } from '../utils/storage';

const emptyCreateForm = {
  code: '',
  name: '',
  organizationCode: 'HOA-NANG-GROUP',
  contactEmail: '',
  campusesInput: 'Cơ sở chính',
  adminUsername: 'admin',
  adminPassword: '',
  adminFullName: '',
  adminPhone: ''
};

export default function MultiSchoolManagement() {
  const navigate = useNavigate();
  const superUser = getStoredSuperAdminUser() || getStoredUser();

  const [summary, setSummary] = useState({
    totalSchools: 0,
    activeSchools: 0,
    totalCampuses: 0,
    totalClassrooms: 0,
    totalStudents: 0,
    totalStaff: 0
  });
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [enteringId, setEnteringId] = useState('');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [editingSchool, setEditingSchool] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', organizationCode: '', contactEmail: '', status: 'active', newAdminPassword: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSuperAdminSchools();
      const payload = res.data?.data || {};
      setSummary(payload.summary || {});
      setSchools(payload.schools || []);
    } catch (err) {
      if (err.response?.status === 401) {
        localStorage.removeItem('superadmin_token');
        localStorage.removeItem('superadmin_user');
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/login', { replace: true });
        return;
      }
      setNotice({ type: 'error', text: err.response?.data?.message || 'Không thể tải danh sách hệ thống trường học.' });
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const handleLogout = () => {
    localStorage.removeItem('superadmin_token');
    localStorage.removeItem('superadmin_user');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('tenant');
    navigate('/login');
  };

  useEffect(() => {
    if (!showCreateModal && !editingSchool) return undefined;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (showCreateModal && !creating) setShowCreateModal(false);
        if (editingSchool && !savingEdit) setEditingSchool(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showCreateModal, editingSchool, creating, savingEdit]);

  const handleCreateSchool = async (e) => {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreateError('');
    try {
      const initialCampuses = createForm.campusesInput
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((cName, idx) => ({
          ...(cName.toLowerCase() === 'cơ sở chính' ? { code: 'CS-CHINH' } : { code: `PH-${idx + 1}` }),
          name: cName
        }));

      const res = await createSchoolWithAdmin({
        code: createForm.code.trim().toUpperCase(),
        name: createForm.name.trim(),
        organizationCode: createForm.organizationCode.trim().toUpperCase(),
        contactEmail: createForm.contactEmail.trim(),
        adminUsername: createForm.adminUsername.trim(),
        adminPassword: createForm.adminPassword,
        adminFullName: createForm.adminFullName.trim(),
        adminPhone: createForm.adminPhone.trim(),
        initialCampuses
      });
      setShowCreateModal(false);
      setCreateForm(emptyCreateForm);
      await load();
      setNotice({ type: 'success', text: res.data?.message || 'Đã tạo trường học mới kèm tài khoản Admin riêng.' });
    } catch (err) {
      setCreateError(err.response?.data?.message || 'Không thể tạo trường học mới.');
    } finally {
      setCreating(false);
    }
  };

  const openEditModal = (school) => {
    setEditingSchool(school);
    setEditForm({
      name: school.name || '',
      organizationCode: school.organizationCode || '',
      contactEmail: school.contactEmail || '',
      status: school.status || 'active',
      adminUsername: school.primaryAdmin?.username || 'admin',
      newAdminPassword: ''
    });
    setEditError('');
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingSchool || savingEdit) return;
    setSavingEdit(true);
    setEditError('');
    try {
      await updateSchoolAndAdmin(editingSchool._id, editForm);
      setEditingSchool(null);
      await load();
      setNotice({ type: 'success', text: 'Đã cập nhật cấu hình trường học & tài khoản quản trị.' });
    } catch (err) {
      setEditError(err.response?.data?.message || 'Không thể lưu cập nhật.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleEnterSchool = async (school) => {
    if (enteringId) return;
    setEnteringId(school._id);
    try {
      const res = await enterSchoolWorkspace(school._id);
      const { token, tenant, user } = res.data || {};
      if (token && user) {
        // Giữ nguyên superadmin_token để nút "Về Quản trị Tổng Đa Trường" trên Sidebar quay lại ngay lập tức
        const currentSuperToken = localStorage.getItem('superadmin_token') || localStorage.getItem('token');
        if (currentSuperToken) {
          localStorage.setItem('superadmin_token', currentSuperToken);
          localStorage.setItem('superadmin_user', JSON.stringify(superUser));
        }
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        if (tenant) {
          localStorage.setItem('tenant', JSON.stringify(tenant));
          if (tenant.code) localStorage.setItem('last_school_code', tenant.code);
        } else {
          localStorage.removeItem('tenant');
        }
        navigate('/dashboard');
      }
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.message || 'Không thể chuyển vào không gian trường này.' });
    } finally {
      setEnteringId('');
    }
  };

  const filteredSchools = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return schools;
    return schools.filter((s) =>
      String(s.code || '').toLowerCase().includes(q) ||
      String(s.name || '').toLowerCase().includes(q) ||
      String(s.organizationCode || '').toLowerCase().includes(q) ||
      String(s.primaryAdmin?.username || '').toLowerCase().includes(q)
    );
  }, [schools, searchQuery]);

  return (
    <div style={{ minHeight: '100dvh', background: '#f4f7fe' }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
          padding: '16px 28px',
          background: 'linear-gradient(105deg, #17357a, #1d4ed8)',
          color: '#ffffff',
          boxShadow: '0 8px 24px rgba(15, 36, 84, 0.18)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span
            style={{
              display: 'grid',
              placeItems: 'center',
              width: '44px',
              height: '44px',
              borderRadius: '13px',
              background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
              color: '#1e293b',
              boxShadow: '0 6px 16px rgba(245, 158, 11, 0.35)'
            }}
          >
            <Icon name="sun" size={22} />
          </span>
          <div>
            <span style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.08em', color: '#bfdbfe' }}>
              TRUNG TÂM ĐIỀU HÀNH HỆ THỐNG ĐA TRƯỜNG (ADMIN CHUNG TOÀN BỘ)
            </span>
            <h1 style={{ margin: '2px 0 0', fontSize: '21px', fontWeight: 800, color: '#ffffff' }}>
              Quản lý Chuỗi Trường & Phân hiệu
            </h1>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="button button-secondary"
            onClick={load}
            disabled={loading}
            style={{ background: 'rgba(255,255,255,0.14)', color: '#fff', borderColor: 'rgba(255,255,255,0.28)' }}
          >
            <Icon name="refresh" size={15} /> Làm mới
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => { setCreateError(''); setShowCreateModal(true); }}
            style={{ background: '#f59e0b', color: '#0f172a', borderColor: '#fbbf24', fontWeight: 800 }}
          >
            <Icon name="plus" size={16} /> Tạo trường mới & Cấp Account riêng
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={handleLogout}
            style={{ background: 'rgba(15,23,42,0.32)', color: '#fff', borderColor: 'rgba(255,255,255,0.22)' }}
          >
            <Icon name="logout" size={15} /> Đăng xuất (@{superUser.username || 'superadmin'})
          </button>
        </div>
      </header>

      <main style={{ maxWidth: '1320px', margin: '0 auto', padding: '26px 24px 48px' }}>
        {notice && (
          <div className={notice.type === 'error' ? 'form-error' : 'timekeeping-notice success'} style={{ marginBottom: '18px' }}>
            <Icon name={notice.type === 'error' ? 'alertCircle' : 'check'} size={17} />
            <span>{notice.text}</span>
          </div>
        )}

        <div className="classroom-summary-grid" style={{ marginBottom: '22px' }}>
          <article>
            <span><Icon name="shield" size={20} /></span>
            <div>
              <small>TỔNG SỐ TRƯỜNG TRONG HỆ THỐNG</small>
              <strong>{summary.activeSchools || 0} / {summary.totalSchools || 0} trường</strong>
            </div>
          </article>
          <article>
            <span><Icon name="grid" size={20} /></span>
            <div>
              <small>TỔNG PHÂN HIỆU / CƠ SỞ</small>
              <strong>{summary.totalCampuses || 0} phân hiệu</strong>
            </div>
          </article>
          <article>
            <span><Icon name="classes" size={20} /></span>
            <div>
              <small>TỔNG LỚP HỌC TOÀN CHUỖI</small>
              <strong>{summary.totalClassrooms || 0} lớp</strong>
            </div>
          </article>
          <article>
            <span><Icon name="students" size={20} /></span>
            <div>
              <small>HỌC SINH & NHÂN SỰ TOÀN HỆ THỐNG</small>
              <strong>{summary.totalStudents || 0} HS · {summary.totalStaff || 0} NS</strong>
            </div>
          </article>
        </div>

        <section className="content-card student-list-card">
          <div className="list-toolbar">
            <div>
              <p className="card-kicker">PHÂN QUYỀN ĐA TRƯỜNG & PHÂN HIỆU</p>
              <h2>Danh sách các Trường học độc lập ({filteredSchools.length})</h2>
              <p>
                Mỗi trường có Mã trường (`School Code`) và Tài khoản Admin riêng biệt; từ mỗi trường lại chia tiếp thành nhiều Phân hiệu / Cơ sở. Nhấn <strong>&quot;Vào quản lý trường&quot;</strong> để điều hành chi tiết từng trường.
              </p>
            </div>
          </div>

          <div className="student-filters" style={{ padding: '0 22px 16px' }}>
            <label className="search-box">
              <Icon name="search" size={16} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm theo mã trường, tên trường, cụm trường hoặc tài khoản Admin..."
              />
            </label>
          </div>

          {loading ? (
            <div className="inline-loader">Đang tải dữ liệu toàn bộ hệ thống trường...</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Mã trường</th>
                    <th>Tên trường & Cụm</th>
                    <th>Các Phân hiệu trực thuộc</th>
                    <th>Tài khoản Admin riêng</th>
                    <th>Quy mô vận hành</th>
                    <th>Trạng thái</th>
                    <th>Điều hành</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSchools.map((s) => (
                    <tr key={s._id}>
                      <td>
                        <strong style={{ color: '#1d4ed8', fontSize: '13.5px' }}>{s.code}</strong>
                      </td>
                      <td>
                        <strong>{s.name}</strong>
                        <small style={{ display: 'block', color: '#64748b' }}>
                          {s.organizationCode ? `Cụm: ${s.organizationCode}` : 'Đơn vị độc lập'}
                          {s.contactEmail ? ` · ${s.contactEmail}` : ''}
                        </small>
                      </td>
                      <td>
                        <strong>{s.campusCount} phân hiệu</strong>
                        <small style={{ display: 'block', color: '#475569' }}>
                          {(s.campusNames || []).join(', ')}
                        </small>
                      </td>
                      <td>
                        {s.primaryAdmin ? (
                          <>
                            <strong>@{s.primaryAdmin.username}</strong>
                            <small style={{ display: 'block', color: '#64748b' }}>
                              {s.primaryAdmin.fullName}
                            </small>
                          </>
                        ) : (
                          <span className="account-unlinked">Chưa cấp TK</span>
                        )}
                      </td>
                      <td>
                        <div><strong>{s.classCount}</strong> lớp · <strong>{s.studentCount}</strong> học sinh</div>
                        <small style={{ color: '#64748b' }}>{s.staffCount} nhân sự</small>
                      </td>
                      <td>
                        <span className={`student-status ${s.status === 'active' ? 'enrolled' : 'withdrawn'}`}>
                          {s.status === 'active' ? 'Hoạt động' : s.status === 'suspended' ? 'Tạm ngưng' : 'Đã đóng'}
                        </span>
                      </td>
                      <td>
                        <div className="classroom-actions">
                          {s.status === 'active' && (
                            <button
                              type="button"
                              className="button button-primary"
                              disabled={Boolean(enteringId)}
                              onClick={() => handleEnterSchool(s)}
                            >
                              {enteringId === s._id ? 'Đang mở...' : 'Vào quản lý trường'}
                            </button>
                          )}
                          <button
                            type="button"
                            className="button button-secondary"
                            onClick={() => openEditModal(s)}
                          >
                            Cấu hình / Đổi MK
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {showCreateModal && createPortal(
        <div
          className="account-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !creating) setShowCreateModal(false);
          }}
        >
          <form className="account-modal-card student-form" style={{ width: 'min(720px, 100%)' }} onSubmit={handleCreateSchool}>
            <div className="account-modal-header">
              <div>
                <p className="card-kicker">KHỞI TẠO TRƯỜNG MỚI & TÀI KHOẢN RIÊNG</p>
                <h2>Thêm trường học mới vào hệ thống</h2>
              </div>
              <button type="button" className="button button-secondary" disabled={creating} onClick={() => setShowCreateModal(false)}>
                Đóng
              </button>
            </div>

            {createError && <div className="form-error" role="alert">{createError}</div>}

            <div className="student-form-grid">
              <label>
                Mã trường (School Code) *
                <input
                  required
                  maxLength={20}
                  placeholder="VD: HOANANG-B"
                  value={createForm.code}
                  onChange={(e) => setCreateForm({ ...createForm, code: e.target.value.toUpperCase() })}
                />
                <small>Dùng để đăng nhập riêng vào trường này.</small>
              </label>
              <label>
                Tên trường học *
                <input
                  required
                  maxLength={160}
                  placeholder="VD: Trường Mầm non Hoa Nắng - Quận Cầu Giấy"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                />
              </label>
              <label>
                Mã hệ thống / Cụm trường
                <input
                  maxLength={40}
                  placeholder="VD: HOA-NANG-GROUP"
                  value={createForm.organizationCode}
                  onChange={(e) => setCreateForm({ ...createForm, organizationCode: e.target.value.toUpperCase() })}
                />
              </label>
              <label>
                Email liên hệ của trường
                <input
                  type="email"
                  placeholder="vanphong@hoanang-b.edu.vn"
                  value={createForm.contactEmail}
                  onChange={(e) => setCreateForm({ ...createForm, contactEmail: e.target.value })}
                />
              </label>
              <label className="form-wide">
                Các Phân hiệu / Cơ sở ban đầu của trường (ngăn cách bằng dấu phẩy)
                <input
                  placeholder="VD: Cơ sở chính, Phân hiệu 1, Phân hiệu 2"
                  value={createForm.campusesInput}
                  onChange={(e) => setCreateForm({ ...createForm, campusesInput: e.target.value })}
                />
              </label>

              <fieldset className="student-allergy-fieldset form-wide">
                <legend>Tài khoản Quản trị riêng của trường này (Mỗi trường 1 Account riêng)</legend>
                <div className="student-form-grid" style={{ padding: 0 }}>
                  <label>
                    Tên đăng nhập Admin trường *
                    <input
                      required
                      placeholder="VD: admin"
                      value={createForm.adminUsername}
                      onChange={(e) => setCreateForm({ ...createForm, adminUsername: e.target.value })}
                    />
                  </label>
                  <label>
                    Mật khẩu khởi tạo *
                    <input
                      type="password"
                      required
                      minLength={6}
                      placeholder="Tối thiểu 6 ký tự"
                      value={createForm.adminPassword}
                      onChange={(e) => setCreateForm({ ...createForm, adminPassword: e.target.value })}
                    />
                  </label>
                  <label>
                    Họ tên người quản trị trường
                    <input
                      placeholder="VD: Nguyễn Thị Minh (Quản trị trường)"
                      value={createForm.adminFullName}
                      onChange={(e) => setCreateForm({ ...createForm, adminFullName: e.target.value })}
                    />
                  </label>
                  <label>
                    Số điện thoại liên hệ
                    <input
                      placeholder="09xxxxxxxx"
                      value={createForm.adminPhone}
                      onChange={(e) => setCreateForm({ ...createForm, adminPhone: e.target.value })}
                    />
                  </label>
                </div>
              </fieldset>
            </div>

            <div className="form-actions">
              <button type="button" className="button button-secondary" disabled={creating} onClick={() => setShowCreateModal(false)}>
                Hủy
              </button>
              <button type="submit" className="button button-primary" disabled={creating}>
                {creating ? 'Đang khởi tạo...' : 'Tạo trường & Cấp tài khoản riêng'}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {editingSchool && createPortal(
        <div
          className="account-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !savingEdit) setEditingSchool(null);
          }}
        >
          <form className="account-modal-card student-form" onSubmit={handleSaveEdit}>
            <div className="account-modal-header">
              <div>
                <p className="card-kicker">CẤU HÌNH TRƯỜNG & ACCOUNT RIÊNG</p>
                <h2>{editingSchool.name} ({editingSchool.code})</h2>
              </div>
              <button type="button" className="button button-secondary" disabled={savingEdit} onClick={() => setEditingSchool(null)}>
                Đóng
              </button>
            </div>

            {editError && <div className="form-error" role="alert">{editError}</div>}

            <div className="student-form-grid">
              <label className="form-wide">
                Tên trường *
                <input
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </label>
              <label>
                Mã cụm / Chuỗi trường
                <input
                  value={editForm.organizationCode}
                  onChange={(e) => setEditForm({ ...editForm, organizationCode: e.target.value.toUpperCase() })}
                />
              </label>
              <label>
                Trạng thái hoạt động
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                >
                  <option value="active">Đang hoạt động</option>
                  <option value="suspended">Tạm ngưng hoạt động</option>
                </select>
              </label>
              <label className="form-wide">
                Email liên hệ
                <input
                  type="email"
                  value={editForm.contactEmail}
                  onChange={(e) => setEditForm({ ...editForm, contactEmail: e.target.value })}
                />
              </label>
              <label>
                Tài khoản Admin trường
                <input
                  value={editForm.adminUsername}
                  onChange={(e) => setEditForm({ ...editForm, adminUsername: e.target.value })}
                />
              </label>
              <label>
                Đặt lại mật khẩu Admin trường (để trống nếu giữ nguyên)
                <input
                  type="password"
                  placeholder="Nhập mật khẩu mới (>= 6 ký tự)"
                  value={editForm.newAdminPassword}
                  onChange={(e) => setEditForm({ ...editForm, newAdminPassword: e.target.value })}
                />
              </label>
            </div>

            <div className="form-actions">
              <button type="button" className="button button-secondary" disabled={savingEdit} onClick={() => setEditingSchool(null)}>
                Hủy
              </button>
              <button type="submit" className="button button-primary" disabled={savingEdit}>
                {savingEdit ? 'Đang lưu...' : 'Lưu thay đổi'}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
}
