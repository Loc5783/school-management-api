import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api/axiosConfig';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';

const statuses = [
  { value: 'present', short: 'Có mặt' }, { value: 'late', short: 'Muộn' },
  { value: 'absent', short: 'Vắng' }, { value: 'absent_permission', short: 'Có phép' },
];

export default function AttendanceDetail() {
  const { classroomId } = useParams(); const navigate = useNavigate();
  const [students, setStudents] = useState([]); const [attendanceMap, setAttendanceMap] = useState({});
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState(''); const [notice, setNotice] = useState('');
  const [attendDate, setAttendDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => { let active = true; const load = async () => {
    setLoading(true); setNotice('');
    try {
      const [studentRes, attendanceRes] = await Promise.all([
        api.get('/students', { params: { classroomId, status: 'enrolled', limit: 100 } }),
        api.get(`/attendance/class/${classroomId}`, { params: { date: attendDate } }),
      ]);
      if (!active) return;
      const list = studentRes.data.data || []; const map = {};
      (attendanceRes.data.data || []).forEach((record) => { map[String(record.studentId)] = record; });
      setStudents(list); setAttendanceMap(map);
    } catch (err) { if (active) setNotice(err.response?.data?.message || 'Không thể tải dữ liệu điểm danh.'); }
    finally { if (active) setLoading(false); }
  }; load(); return () => { active = false; }; }, [classroomId, attendDate]);

  const updateRecord = (studentId, values) => setAttendanceMap((old) => ({ ...old, [studentId]: { ...old[studentId], studentId, status: old[studentId]?.status || 'present', ...values } }));
  const markAllPresent = () => setAttendanceMap((old) => Object.fromEntries(students.map((student) => [student._id, { ...old[student._id], studentId: student._id, status: 'present' }])));
  const handleSubmit = async () => { setSaving(true); setNotice(''); try {
    const records = []; const updates = [];
    students.forEach((student) => { const record = attendanceMap[student._id]; if (record?._id) updates.push({ id: record._id, status: record.status, note: record.note || '' }); else records.push({ studentId: student._id, status: record?.status || 'present', note: record?.note || '' }); });
    if (records.length) await api.post('/attendance/bulk', { classroomId, attendDate, records });
    await Promise.all(updates.map((item) => api.put(`/attendance/${item.id}`, { status: item.status, note: item.note })));
    setNotice('Đã lưu điểm danh.');
  } catch (err) { setNotice(err.response?.data?.message || 'Lưu điểm danh chưa thành công.'); } finally { setSaving(false); } };
  const visible = useMemo(() => students.filter((s) => s.fullName.toLowerCase().includes(query.toLowerCase())), [students, query]);
  const presentCount = students.filter((s) => (attendanceMap[s._id]?.status || 'present') === 'present').length;

  if (loading) return <div className="page-loader"><span className="loading-orb" />Đang chuẩn bị danh sách điểm danh...</div>;
  return <AppShell title="Ghi nhận điểm danh" subtitle="Chọn ngày để xem lại lịch sử hoặc ghi nhận tình hình của lớp.">
    {notice && <div className={`timekeeping-notice ${notice.startsWith('Đã ') ? 'success' : 'error'}`}>{notice}</div>}
    <div className="attendance-topline"><button className="back-link" onClick={() => navigate('/attendance')}><Icon name="arrowLeft" size={18} />Danh sách lớp</button><div className="toolbar-buttons"><label className="check-date">Ngày điểm danh<input type="date" value={attendDate} onChange={(event) => setAttendDate(event.target.value)} /></label><div className="attendance-summary"><span><b>{presentCount}</b> / {students.length} có mặt</span><div><i style={{ width: `${students.length ? (presentCount / students.length) * 100 : 0}%` }} /></div></div></div></div>
    <section className="content-card roster-card"><div className="list-toolbar"><div><p className="card-kicker">DANH SÁCH HỌC SINH</p><h2>{students.length} học sinh</h2></div><div className="toolbar-buttons"><button className="button button-secondary" onClick={markAllPresent}><Icon name="check" size={17} />Tất cả có mặt</button><label className="search-box"><Icon name="search" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm học sinh..." /></label></div></div>
      <div className="roster-list">{visible.map((student, index) => { const record = attendanceMap[student._id] || {}; const current = record.status || 'present'; return <article className="student-row" key={student._id}><span className="row-number">{String(index + 1).padStart(2, '0')}</span><span className="student-avatar large">{student.fullName.charAt(0)}</span><div className="student-details"><strong>{student.fullName}</strong><small>{student.gender === 'female' ? 'Nữ' : 'Nam'} · {student.studentCode}</small></div><div className="status-controls">{statuses.map((status) => <button key={status.value} onClick={() => updateRecord(student._id, { status: status.value })} className={`status-option ${status.value} ${current === status.value ? 'selected' : ''}`}>{status.short}</button>)}</div><input className="note-input" value={record.note || ''} onChange={(event) => updateRecord(student._id, { note: event.target.value })} placeholder="Ghi chú (nếu có)" /></article>; })}</div>
      {!visible.length && <div className="empty-state compact"><strong>Không tìm thấy học sinh phù hợp</strong></div>}
    </section>
    <div className="form-actions"><button className="button button-primary" onClick={handleSubmit} disabled={saving}><Icon name="check" size={18} />{saving ? 'Đang lưu...' : 'Lưu điểm danh'}</button></div>
  </AppShell>;
}
