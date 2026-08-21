import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/axiosConfig';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';

const statuses = [
  { value: 'present', label: 'Có mặt', short: 'Có mặt' },
  { value: 'late', label: 'Đi muộn', short: 'Muộn' },
  { value: 'absent', label: 'Vắng mặt', short: 'Vắng' },
  { value: 'absent_permission', label: 'Có phép', short: 'Có phép' },
];

export default function AttendanceDetail() {
  const { classroomId } = useParams();
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [attendanceMap, setAttendanceMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [studentRes, attendRes] = await Promise.all([
          api.get(`/students?classroomId=${classroomId}`),
          api.get(`/attendance/class/${classroomId}?date=${today}`),
        ]);
        const list = studentRes.data.data || [];
        setStudents(list);
        const map = {};
        (attendRes.data.data || []).forEach((att) => { map[att.studentId] = att; });
        setAttendanceMap(map);
      } catch (err) {
        console.error(err);
        setNotice('Không thể tải đầy đủ dữ liệu điểm danh. Vui lòng thử tải lại trang.');
      } finally { setLoading(false); }
    };
    fetchData();
  }, [classroomId, today]);

  const updateRecord = (studentId, values) => setAttendanceMap((prev) => ({
    ...prev,
    [studentId]: { ...prev[studentId], studentId, studentName: students.find((item) => item._id === studentId)?.fullName || '', status: prev[studentId]?.status || 'present', ...values },
  }));
  const markAllPresent = () => setAttendanceMap((prev) => Object.fromEntries(students.map((student) => [student._id, { ...prev[student._id], studentId: student._id, studentName: student.fullName, status: 'present' }])));
  const handleSubmit = async () => {
    setSaving(true);
    try {
      const records = []; const updates = [];
      students.forEach((student) => {
        const record = attendanceMap[student._id];
        if (record?._id) updates.push({ id: record._id, status: record.status, note: record.note || '' });
        else if (record) records.push({ studentId: student._id, status: record.status, checkInTime: new Date().toISOString(), note: record.note || '' });
      });
      if (records.length) await api.post('/attendance/bulk', { classroomId, attendDate: today, records });
      await Promise.all(updates.map((item) => api.put(`/attendance/${item.id}`, { status: item.status, note: item.note })));
      navigate('/attendance');
    } catch (err) { console.error(err); setNotice('Lưu điểm danh chưa thành công. Vui lòng thử lại.'); } finally { setSaving(false); }
  };
  const visibleStudents = useMemo(() => students.filter((student) => student.fullName.toLowerCase().includes(query.toLowerCase())), [students, query]);
  const presentCount = students.filter((student) => (attendanceMap[student._id]?.status || 'present') === 'present').length;
  const formattedDate = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date());

  if (loading) return <div className="page-loader"><span className="loading-orb" />Đang chuẩn bị danh sách điểm danh...</div>;
  return <AppShell title="Ghi nhận điểm danh" subtitle={formattedDate} actions={<button className="button button-primary" onClick={handleSubmit} disabled={saving}><Icon name="check" size={18} />{saving ? 'Đang lưu...' : 'Lưu điểm danh'}</button>}>
    {notice && <div className="notice notice-warning"><span>!</span>{notice}</div>}
    <div className="attendance-topline"><button className="back-link" onClick={() => navigate('/attendance')}><Icon name="arrowLeft" size={18} />Danh sách lớp</button><div className="attendance-summary"><span><b>{presentCount}</b> / {students.length} có mặt</span><div><i style={{ width: `${students.length ? (presentCount / students.length) * 100 : 0}%` }} /></div></div></div>
    <section className="content-card roster-card"><div className="list-toolbar"><div><p className="card-kicker">DANH SÁCH HỌC SINH</p><h2>{students.length} học sinh</h2></div><div className="toolbar-buttons"><button className="button button-secondary" onClick={markAllPresent}><Icon name="check" size={17} />Đánh dấu tất cả có mặt</button><label className="search-box"><Icon name="search" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm học sinh..." /></label></div></div>
      <div className="roster-list">{visibleStudents.map((student, index) => { const record = attendanceMap[student._id] || {}; const currentStatus = record.status || 'present'; return <article className="student-row" key={student._id}><span className="row-number">{String(index + 1).padStart(2, '0')}</span><span className="student-avatar large">{student.fullName.charAt(0)}</span><div className="student-details"><strong>{student.fullName}</strong><small>{student.gender === 'female' ? 'Nữ' : 'Nam'} · {student.birthDate ? new Date(student.birthDate).toLocaleDateString('vi-VN') : 'Chưa có ngày sinh'}</small></div><div className="status-controls" aria-label={`Trạng thái của ${student.fullName}`}>{statuses.map((status) => <button key={status.value} onClick={() => updateRecord(student._id, { status: status.value })} className={`status-option ${status.value} ${currentStatus === status.value ? 'selected' : ''}`}>{status.short}</button>)}</div><input className="note-input" value={record.note || ''} onChange={(event) => updateRecord(student._id, { note: event.target.value })} placeholder="Ghi chú (nếu có)" /></article>; })}</div>
      {!visibleStudents.length && <div className="empty-state compact"><strong>Không tìm thấy học sinh phù hợp</strong></div>}
    </section>
  </AppShell>;
}
