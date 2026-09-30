import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import { archiveClassroom, assignHomeroomTeacher, createClassroom, listClassrooms, updateClassroom } from '../api/classrooms';
import { getStaffAccounts } from '../api/hr';

const blank = { name: '', fullName: '', subject: '', ageGroup: '3-4', maxSize: 25, schoolYear: '2026-2027' };

export default function ClassroomManagement() {
  const role = JSON.parse(localStorage.getItem('user') || '{}').role;
  const canManage = ['admin', 'principal'].includes(role);
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [teacherAccounts, setTeacherAccounts] = useState([]);
  const [teacherAssignment, setTeacherAssignment] = useState(null);
  const [assigningTeacher, setAssigningTeacher] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [response, staffResponse] = await Promise.all([
        listClassrooms(showArchived),
        canManage ? getStaffAccounts() : Promise.resolve({ data: { data: [] } })
      ]);
      setItems(response.data.data || []);
      setTeacherAccounts((staffResponse.data.data || []).filter((account) => account.role === 'teacher' && account.status === 'active'));
    } catch (err) {
      setError(err.response?.data?.message || 'Không thể tải danh sách lớp.');
    } finally {
      setLoading(false);
    }
  }, [showArchived, canManage]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const summary = useMemo(() => items.reduce((result, item) => ({
    active: result.active + (item.status === 'active' ? 1 : 0),
    students: result.students + (item.status === 'active' ? Number(item.statistics?.currentStudents || 0) : 0),
    capacity: result.capacity + (item.status === 'active' ? Number(item.maxSize || 0) : 0)
  }), { active: 0, students: 0, capacity: 0 }), [items]);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const closeForm = useCallback(() => { setShowForm(false); setEditingId(null); setForm(blank); setError(''); }, []);

  useEffect(() => {
    if (!showForm) return undefined;
    const closeOnEscape = (event) => { if (event.key === 'Escape' && !saving) closeForm(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showForm, saving, closeForm]);

  const openCreate = () => { setEditingId(null); setForm(blank); setError(''); setNotice(''); setShowForm(true); };
  const edit = (item) => {
    setEditingId(item._id);
    setForm({ name: item.name, fullName: item.fullName || '', subject: item.subject || '', ageGroup: item.ageGroup, maxSize: item.maxSize, schoolYear: item.schoolYear });
    setError(''); setNotice(''); setShowForm(true);
  };
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      if (editingId) await updateClassroom(editingId, form);
      else await createClassroom(form);
      const message = editingId ? 'Đã cập nhật thông tin lớp học.' : 'Đã tạo lớp học mới.';
      closeForm(); setNotice(message); await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Không thể lưu lớp học.');
    } finally { setSaving(false); }
  };
  const archive = async (item) => {
    if (!window.confirm(`Lưu trữ lớp ${item.name}?`)) return;
    setError(''); setNotice('');
    try { await archiveClassroom(item._id); setNotice(`Đã lưu trữ lớp ${item.name}.`); await load(); }
    catch (err) { setError(err.response?.data?.message || 'Không thể lưu trữ lớp học.'); }
  };
  const openTeacherAssignment = (classroom) => {
    const homeroom = classroom.teachers?.find((assignment) => assignment.role === 'homeroom');
    setTeacherAssignment({ classroom, teacherId: homeroom?.teacherId ? String(homeroom.teacherId) : '' });
    setError(''); setNotice('');
  };
  const submitTeacherAssignment = async (event) => {
    event.preventDefault();
    if (!teacherAssignment) return;
    setAssigningTeacher(true); setError('');
    try {
      await assignHomeroomTeacher(teacherAssignment.classroom._id, teacherAssignment.teacherId || null);
      setTeacherAssignment(null);
      setNotice(teacherAssignment.teacherId ? 'Đã phân công giáo viên chủ nhiệm.' : 'Đã bỏ phân công giáo viên chủ nhiệm.');
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Không thể phân công giáo viên chủ nhiệm.');
    } finally { setAssigningTeacher(false); }
  };

  const actions = canManage ? <button className="button button-primary classroom-create-button" onClick={openCreate}><Icon name="plus" size={17} />Tạo lớp mới</button> : null;

  return <AppShell title="Lớp học" subtitle="Quản lý danh sách lớp, sĩ số và trạng thái hoạt động." actions={actions}>
    {notice && <div className="timekeeping-notice success"><Icon name="check" size={17} />{notice}</div>}
    {error && !showForm && <div className="timekeeping-notice error"><Icon name="alertCircle" size={17} />{error}</div>}

    <section className="classroom-summary" aria-label="Tổng quan lớp học">
      <article><span className="classroom-summary-icon blue"><Icon name="classes" size={20} /></span><div><small>Lớp đang hoạt động</small><strong>{summary.active}</strong></div></article>
      <article><span className="classroom-summary-icon purple"><Icon name="students" size={20} /></span><div><small>Học sinh đang xếp lớp</small><strong>{summary.students}</strong></div></article>
      <article><span className="classroom-summary-icon green"><Icon name="chart" size={20} /></span><div><small>Tổng sức chứa</small><strong>{summary.capacity}</strong></div></article>
    </section>

    <section className="content-card classroom-list classroom-list-full">
      <div className="card-heading classroom-list-heading">
        <div><p className="card-kicker">DANH SÁCH LỚP HỌC</p><h2>{items.length} lớp {showArchived ? 'được tìm thấy' : 'đang hiển thị'}</h2><p>Theo dõi chương trình, độ tuổi, năm học và sĩ số của từng lớp.</p></div>
        <label className="archive-filter"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /><span>Hiện lớp đã lưu trữ</span></label>
      </div>
      {loading ? <div className="empty-state">Đang tải lớp học...</div> : items.length ? <div className="student-table-wrap"><table className="data-table classroom-table"><thead><tr><th>Lớp học</th><th>Chương trình</th><th>Nhóm tuổi</th><th>Năm học</th><th>Sĩ số</th><th>Giáo viên chủ nhiệm</th><th>Trạng thái</th>{canManage && <th>Thao tác</th>}</tr></thead><tbody>{items.map((item) => {
        const current = Number(item.statistics?.currentStudents || 0);
        const percent = Math.min(100, Math.round((current / Math.max(1, Number(item.maxSize || 1))) * 100));
        const homeroom = item.teachers?.find((assignment) => assignment.role === 'homeroom');
        return <tr key={item._id}><td><div className="classroom-name-cell"><span className="classroom-symbol">{item.name.charAt(0).toUpperCase()}</span><span><strong>{item.name}</strong><small>{item.fullName || 'Chưa có tên đầy đủ'}</small></span></div></td><td><span className={item.subject ? 'classroom-subject' : 'classroom-muted'}>{item.subject || 'Chưa phân theo môn'}</span></td><td>{item.ageGroup} tuổi</td><td>{item.schoolYear}</td><td><div className="classroom-capacity"><span><b>{current}</b> / {item.maxSize} trẻ</span><i><em style={{ width: `${percent}%` }} /></i></div></td><td><span className={homeroom ? 'classroom-subject' : 'classroom-muted'}>{homeroom?.teacherName || 'Chưa phân công'}</span></td><td><span className={`student-status ${item.status === 'archived' ? 'withdrawn' : 'enrolled'}`}>{item.status === 'archived' ? 'Đã lưu trữ' : 'Đang hoạt động'}</span></td>{canManage && <td><div className="classroom-actions"><button className="button button-secondary" onClick={() => openTeacherAssignment(item)} disabled={item.status === 'archived'}>Gán giáo viên</button><button className="button button-secondary" onClick={() => edit(item)} disabled={item.status === 'archived'}>Sửa</button><button className="button button-danger" onClick={() => archive(item)} disabled={item.status === 'archived'}>Lưu trữ</button></div></td>}</tr>;
      })}</tbody></table></div> : <div className="empty-state classroom-empty"><span><Icon name="classes" size={30} /></span><strong>Chưa có lớp học</strong><p>{canManage ? 'Bấm “Tạo lớp mới” để bắt đầu.' : 'Nhà trường chưa khai báo lớp học.'}</p></div>}
    </section>

    {showForm && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) closeForm(); }}><form className="content-card classroom-form classroom-modal" onSubmit={submit}>
      <div className="card-heading"><div><p className="card-kicker">{editingId ? 'CẬP NHẬT LỚP' : 'TẠO LỚP MỚI'}</p><h2>{editingId ? `Sửa ${form.name}` : 'Thông tin lớp học'}</h2><p>Nhập thông tin vận hành cơ bản của lớp mầm non.</p></div><button className="button button-secondary" type="button" onClick={closeForm} disabled={saving}>Đóng</button></div>
      {error && <p className="form-error classroom-modal-error">{error}</p>}
      <div className="classroom-form-fields">
        <label>Tên lớp <span className="field-required">*</span><input required maxLength="80" value={form.name} onChange={(event) => set('name', event.target.value)} placeholder="Ví dụ: MGL 4-5 A" /></label>
        <label>Tên đầy đủ<input maxLength="120" value={form.fullName} onChange={(event) => set('fullName', event.target.value)} placeholder="Ví dụ: Mẫu giáo lớn 4–5 tuổi, lớp A" /></label>
        <label className="form-wide">Môn học / chương trình phụ trách <span className="field-optional">(không bắt buộc)</span><input maxLength="120" value={form.subject} onChange={(event) => set('subject', event.target.value)} placeholder="Để trống nếu lớp chưa phân theo môn" /></label>
        <label>Nhóm tuổi<select value={form.ageGroup} onChange={(event) => set('ageGroup', event.target.value)}><option value="3-4">3–4 tuổi</option><option value="4-5">4–5 tuổi</option><option value="5-6">5–6 tuổi</option></select></label>
        <label>Sĩ số tối đa <span className="field-required">*</span><input required type="number" min="1" max="60" value={form.maxSize} onChange={(event) => set('maxSize', event.target.value)} /></label>
        <label className="form-wide">Năm học <span className="field-required">*</span><input required pattern="\d{4}-\d{4}" value={form.schoolYear} onChange={(event) => set('schoolYear', event.target.value)} placeholder="2026-2027" /></label>
      </div>
      <div className="form-actions"><button className="button button-secondary" type="button" onClick={closeForm} disabled={saving}>Hủy</button><button className="button button-primary" disabled={saving}>{saving ? 'Đang lưu...' : editingId ? 'Lưu thay đổi' : 'Tạo lớp học'}</button></div>
    </form></div>}
    {teacherAssignment && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !assigningTeacher) setTeacherAssignment(null); }}><form className="content-card classroom-form classroom-modal" onSubmit={submitTeacherAssignment}>
      <div className="card-heading"><div><p className="card-kicker">PHÂN CÔNG GIÁO VIÊN</p><h2>{teacherAssignment.classroom.name}</h2><p>Mỗi giáo viên chỉ chủ nhiệm một lớp đang hoạt động trong cùng năm học.</p></div><button className="button button-secondary" type="button" onClick={() => setTeacherAssignment(null)} disabled={assigningTeacher}>Đóng</button></div>
      {error && <p className="form-error classroom-modal-error">{error}</p>}
      <div className="classroom-form-fields"><label className="form-wide">Giáo viên chủ nhiệm<select value={teacherAssignment.teacherId} onChange={(event) => setTeacherAssignment((current) => ({ ...current, teacherId: event.target.value }))}><option value="">-- Chưa phân công --</option>{teacherAccounts.map((teacher) => <option key={teacher._id} value={teacher._id}>{teacher.profile?.fullName || teacher.username} · @{teacher.username}</option>)}</select><small className="field-help">Chỉ hiển thị tài khoản giáo viên đang hoạt động. Chọn “Chưa phân công” để bỏ gán.</small></label></div>
      <div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setTeacherAssignment(null)} disabled={assigningTeacher}>Hủy</button><button className="button button-primary" disabled={assigningTeacher}>{assigningTeacher ? 'Đang lưu...' : 'Lưu phân công'}</button></div>
    </form></div>}
  </AppShell>;
}
