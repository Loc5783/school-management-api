import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import StudentPagination from '../components/StudentPagination';
import api from '../api/axiosConfig';
import {
  createParentAccount,
  getParentAccounts,
  linkParentStudents,
  updateParentStatus
} from '../api/systemUsers';

const statusLabel = { inactive: 'Chờ kích hoạt', active: 'Đang hoạt động', suspended: 'Tạm ngưng' };
const emptyCreateForm = {
  fullName: '',
  username: '',
  password: '',
  phone: '',
  email: '',
  registrationNote: ''
};

export default function ParentAccountManagement({ embedded = false }) {
  const [parents, setParents] = useState([]);
  const [classrooms, setClassrooms] = useState([]);
  const [selectedClassFilter, setSelectedClassFilter] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [students, setStudents] = useState([]);
  const [studentPage, setStudentPage] = useState(1);
  const [selectedId, setSelectedId] = useState('');
  const [studentIds, setStudentIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const studentRequestRef = useRef(0);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  const selectedParent = useMemo(
    () => parents.find((parent) => parent._id === selectedId),
    [parents, selectedId]
  );

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) =>
        (s.fullName || '').toLowerCase().includes(q)
        || (s.studentCode || '').toLowerCase().includes(q)
        || (s.className || '').toLowerCase().includes(q)
    );
  }, [students, studentSearch]);

  const currentStudentPage = Math.min(studentPage, Math.max(1, Math.ceil(filteredStudents.length / 10)));

  const loadClassrooms = useCallback(async () => {
    try {
      const res = await api.get('/classrooms');
      setClassrooms(res.data?.data || res.data || []);
    } catch {
      setClassrooms([]);
    }
  }, []);

  const loadEligibleStudents = useCallback(async (classroomId = '') => {
    const requestId = ++studentRequestRef.current;
    setStudentsLoading(true);
    try {
      const params = { status: 'enrolled', limit: 200, sortBy: 'fullName', sortOrder: 'asc' };
      if (classroomId) params.classroomId = classroomId;
      const response = await api.get('/students', { params });
      if (studentRequestRef.current === requestId) {
        setStudents(response.data?.data || []);
      }
    } catch (error) {
      if (studentRequestRef.current === requestId) {
        setStudents([]);
        setNotice({
          type: 'error',
          text: error.response?.data?.message || 'Không thể tải danh sách học sinh đang theo học.'
        });
      }
    } finally {
      if (studentRequestRef.current === requestId) {
        setStudentsLoading(false);
      }
    }
  }, []);

  const load = useCallback(async (preferredId = '') => {
    try {
      const parentResponse = await getParentAccounts();
      const accountList = parentResponse.data?.data || [];
      setParents(accountList);
      const nextSelectedId = preferredId || accountList[0]?._id || '';
      const nextSelectedParent = accountList.find((parent) => parent._id === nextSelectedId);
      setSelectedId(nextSelectedId);
      setStudentIds(nextSelectedParent?.studentIds || []);
      const defaultClassId = nextSelectedParent?.requestedClassroom?._id || '';
      setSelectedClassFilter(defaultClassId);
      await loadEligibleStudents(defaultClassId);
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.message || 'Không thể tải hồ sơ phụ huynh.' });
    } finally {
      setLoading(false);
    }
  }, [loadEligibleStudents]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void loadClassrooms();
      void load();
    }, 0);
    return () => window.clearTimeout(initialLoad);
  }, [load, loadClassrooms]);

  const toggleStudent = (id) => {
    setStudentIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  };

  const selectParent = async (parent) => {
    setStudentPage(1);
    setStudentSearch('');
    setSelectedId(parent._id);
    setStudentIds(parent.studentIds || []);
    const classId = parent.requestedClassroom?._id || '';
    setSelectedClassFilter(classId);
    await loadEligibleStudents(classId);
  };

  const handleClassFilterChange = async (classId) => {
    setSelectedClassFilter(classId);
    setStudentPage(1);
    await loadEligibleStudents(classId);
  };

  const saveLinks = async () => {
    if (!selectedParent) return;
    setSaving(true);
    setNotice(null);
    try {
      await linkParentStudents(selectedParent._id, studentIds, 'Nhà trường xác minh và cập nhật liên kết phụ huynh - học sinh');
      await load(selectedParent._id);
      setNotice({ type: 'success', text: 'Đã lưu liên kết học sinh cho phụ huynh.' });
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.message || 'Không thể lưu liên kết.' });
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (status) => {
    if (!selectedParent) return;
    setSaving(true);
    setNotice(null);
    try {
      if (status === 'active') {
        await linkParentStudents(selectedParent._id, studentIds, 'Xác minh học sinh trước khi kích hoạt tài khoản phụ huynh');
      }
      const response = await updateParentStatus(
        selectedParent._id,
        status,
        status === 'suspended' ? 'Tạm ngưng tài khoản phụ huynh' : 'Kích hoạt tài khoản phụ huynh'
      );
      await load(selectedParent._id);
      setNotice({ type: 'success', text: response.data?.message || 'Đã cập nhật trạng thái tài khoản phụ huynh.' });
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.message || 'Không thể cập nhật trạng thái.' });
    } finally {
      setSaving(false);
    }
  };

  const submitCreateParent = async (event) => {
    event.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      const res = await createParentAccount({
        username: createForm.username.trim(),
        password: createForm.password,
        profile: {
          fullName: createForm.fullName.trim(),
          phone: createForm.phone.trim(),
          email: createForm.email.trim()
        },
        registrationNote: createForm.registrationNote.trim()
      });
      const created = res.data?.data;
      setShowCreateModal(false);
      setCreateForm(emptyCreateForm);
      await load(created?._id || '');
      setNotice({
        type: 'success',
        text: `Đã tạo tài khoản phụ huynh @${created?.username || createForm.username}. Hãy chọn học sinh bên phải để liên kết và bấm Kích hoạt tài khoản.`
      });
    } catch (error) {
      setCreateError(error.response?.data?.message || 'Không thể tạo tài khoản phụ huynh.');
    } finally {
      setCreating(false);
    }
  };

  const content = (
    <>
      {notice && (
        <div className={`timekeeping-notice ${notice.type}`}>
          <Icon name={notice.type === 'success' ? 'check' : 'shield'} size={17} />
          {notice.text}
        </div>
      )}

      {loading ? (
        <div className="page-loader">
          <span className="loading-orb" />
          Đang tải tài khoản...
        </div>
      ) : (
        <section className="parent-approval-layout">
          <article className="content-card parent-list-card">
            <div className="card-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <p className="card-kicker">TÀI KHOẢN PHỤ HUYNH</p>
                <h2>{parents.length} hồ sơ</h2>
              </div>
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  setCreateError('');
                  setCreateForm(emptyCreateForm);
                  setShowCreateModal(true);
                }}
              >
                <Icon name="plus" size={15} /> + Cấp tài khoản
              </button>
            </div>

            <div className="parent-account-list">
              {parents.length ? (
                parents.map((parent) => (
                  <button
                    key={parent._id}
                    type="button"
                    className={parent._id === selectedId ? 'parent-account active' : 'parent-account'}
                    onClick={() => selectParent(parent)}
                  >
                    <span className="avatar">{parent.profile?.fullName?.charAt(0) || 'P'}</span>
                    <span>
                      <strong>{parent.profile?.fullName || parent.username}</strong>
                      <small>@{parent.username} · {parent.profile?.phone || 'Chưa có SĐT'}</small>
                    </span>
                    <i className={`parent-status ${parent.status}`}>{statusLabel[parent.status] || parent.status}</i>
                  </button>
                ))
              ) : (
                <p className="history-empty">Chưa có tài khoản phụ huynh. Bấm "+ Cấp tài khoản" để tạo mới.</p>
              )}
            </div>
          </article>

          <article className="content-card parent-review-card">
            {selectedParent ? (
              <>
                <div className="card-heading">
                  <div>
                    <p className="card-kicker">XÁC MINH & LIÊN KẾT CON</p>
                    <h2>{selectedParent.profile?.fullName || selectedParent.username}</h2>
                    <p className="parent-contact">
                      @{selectedParent.username} · {selectedParent.profile?.phone || 'Chưa có SĐT'} · {selectedParent.profile?.email || 'Chưa có email'}
                    </p>
                  </div>
                  <span className={`parent-status ${selectedParent.status}`}>
                    {statusLabel[selectedParent.status] || selectedParent.status}
                  </span>
                </div>

                <div className="parent-review-body">
                  <div className="parent-registration-summary">
                    <span><Icon name="classes" size={17} /></span>
                    <div>
                      <small>Thông tin ghi chú / lớp đăng ký</small>
                      <strong>{selectedParent.requestedClassroom?.name || 'Cấp trực tiếp tại trường'}</strong>
                      <p>{selectedParent.registrationNote || 'Có thể chọn bất kỳ lớp nào bên dưới để gắn đúng hồ sơ các bé của phụ huynh.'}</p>
                    </div>
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                      <h3 style={{ margin: 0 }}>Liên kết học sinh ({studentIds.length} bé đã chọn)</h3>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <select
                          value={selectedClassFilter}
                          onChange={(e) => handleClassFilterChange(e.target.value)}
                          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }}
                        >
                          <option value="">Tất cả lớp đang học</option>
                          {classrooms.map((cls) => (
                            <option key={cls._id} value={cls._id}>{cls.name}</option>
                          ))}
                        </select>
                        <input
                          type="search"
                          value={studentSearch}
                          onChange={(e) => {
                            setStudentSearch(e.target.value);
                            setStudentPage(1);
                          }}
                          placeholder="Tìm tên hoặc mã bé..."
                          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }}
                        />
                      </div>
                    </div>

                    {studentsLoading ? (
                      <div className="inline-loader">
                        <span className="loading-orb" />
                        Đang tải danh sách học sinh...
                      </div>
                    ) : (
                      <div className="parent-student-checklist">
                        {filteredStudents.length ? (
                          filteredStudents.slice((currentStudentPage - 1) * 10, currentStudentPage * 10).map((student) => (
                            <label key={student._id}>
                              <input
                                type="checkbox"
                                checked={studentIds.includes(student._id)}
                                onChange={() => toggleStudent(student._id)}
                              />
                              <span>
                                <strong>{student.fullName}</strong>
                                <small>{student.studentCode ? `${student.studentCode} · ` : ''}{student.className || 'Chưa xếp lớp'}</small>
                              </span>
                            </label>
                          ))
                        ) : (
                          <p className="history-empty">Không tìm thấy học sinh phù hợp.</p>
                        )}
                        <StudentPagination total={filteredStudents.length} page={currentStudentPage} onChange={setStudentPage} />
                      </div>
                    )}
                  </div>

                  <div className="parent-actions">
                    <button type="button" className="button button-secondary" onClick={saveLinks} disabled={saving}>
                      Lưu liên kết ({studentIds.length})
                    </button>
                    {selectedParent.status !== 'active' && (
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={() => changeStatus('active')}
                        disabled={saving || !studentIds.length}
                      >
                        <Icon name="check" size={17} />
                        Kích hoạt tài khoản
                      </button>
                    )}
                    {selectedParent.status === 'active' && (
                      <button type="button" className="button button-secondary" onClick={() => changeStatus('suspended')} disabled={saving}>
                        Tạm ngưng tài khoản
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <strong>Chọn một tài khoản phụ huynh hoặc bấm "+ Cấp tài khoản" để bắt đầu</strong>
              </div>
            )}
          </article>
        </section>
      )}

      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => !creating && setShowCreateModal(false)} role="presentation">
          <form
            className="content-card student-form hr-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={submitCreateParent}
          >
            <div className="card-heading">
              <div>
                <p className="card-kicker">CẤP TÀI KHOẢN CỔNG PHỤ HUYNH</p>
                <h2>Tạo tài khoản phụ huynh mới</h2>
              </div>
              <button type="button" className="button button-secondary" disabled={creating} onClick={() => setShowCreateModal(false)}>
                Đóng
              </button>
            </div>

            {createError && <div className="form-error">{createError}</div>}

            <div className="student-form-grid">
              <label>
                Họ và tên phụ huynh
                <input
                  required
                  maxLength="120"
                  value={createForm.fullName}
                  onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })}
                  placeholder="Ví dụ: Nguyễn Thị Minh"
                />
              </label>
              <label>
                Tên đăng nhập
                <input
                  required
                  minLength="3"
                  maxLength="50"
                  value={createForm.username}
                  onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
                  placeholder="Ví dụ: ph_nguyenthiminh"
                />
              </label>
              <label>
                Số điện thoại
                <input
                  value={createForm.phone}
                  onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
                  placeholder="Ví dụ: 0912345678"
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  placeholder="Không bắt buộc"
                />
              </label>
              <label className="form-wide">
                Mật khẩu khởi tạo
                <input
                  type="password"
                  required
                  minLength="8"
                  maxLength="72"
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  placeholder="Tối thiểu 8 ký tự"
                />
              </label>
              <label className="form-wide">
                Ghi chú xác minh (tên bé / lớp)
                <input
                  maxLength="300"
                  value={createForm.registrationNote}
                  onChange={(e) => setCreateForm({ ...createForm, registrationNote: e.target.value })}
                  placeholder="Ví dụ: Phụ huynh bé Gia Bảo lớp Chồi 1"
                />
              </label>
            </div>

            <div className="form-actions">
              <button type="button" className="button button-secondary" disabled={creating} onClick={() => setShowCreateModal(false)}>
                Hủy
              </button>
              <button type="submit" className="button button-primary" disabled={creating}>
                {creating ? 'Đang tạo...' : 'Tạo tài khoản'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );

  return embedded ? content : (
    <AppShell title="Quản lý tài khoản phụ huynh" subtitle="Cấp tài khoản, liên kết học sinh và kiểm soát trạng thái truy cập cổng phụ huynh.">
      {content}
    </AppShell>
  );
}
