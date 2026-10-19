import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../api/axiosConfig';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import StudentPagination from '../components/StudentPagination';
import PickupManagement from './PickupManagement';

const statuses = [
  { value: 'present', short: 'Có mặt' },
  { value: 'late', short: 'Muộn' },
  { value: 'absent', short: 'Vắng' },
  { value: 'absent_permission', short: 'Có phép' },
];

const getVietnamToday = () => {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
};

export default function AttendanceDetail() {
  const { classroomId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = searchParams.get('tab') === 'departure' ? 'departure' : 'arrival';
  const urlDate = searchParams.get('date');

  const [students, setStudents] = useState([]);
  const [attendanceMap, setAttendanceMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [page, setPage] = useState(1);

  // Single Source of Truth từ URL: đồng bộ 2 chiều hoàn toàn tự nhiên khi Back/Forward
  const attendDate = urlDate || getVietnamToday();

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setNotice('');
      try {
        const [studentRes, attendanceRes] = await Promise.all([
          api.get('/students', { params: { classroomId, status: 'enrolled', limit: 100 } }),
          api.get(`/attendance/class/${classroomId}`, { params: { date: attendDate } }),
        ]);
        if (!active) return;
        const list = studentRes.data.data || [];
        const map = {};
        (attendanceRes.data.data || []).forEach((record) => {
          map[String(record.studentId)] = record;
        });
        setStudents(list);
        setAttendanceMap(map);
      } catch (err) {
        if (active) setNotice(err.response?.data?.message || 'Không thể tải dữ liệu điểm danh.');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [classroomId, attendDate]);

  const updateRecord = (studentId, values) => {
    setAttendanceMap((old) => ({
      ...old,
      [studentId]: {
        ...old[studentId],
        studentId,
        ...values,
      },
    }));
  };

  const handleDateChange = (newDate) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newDate) {
        next.set('date', newDate);
      } else {
        next.delete('date');
      }
      return next;
    });
  };

  const markAllPresent = () => {
    // Kiểm tra xem đã có học sinh nào bị đánh dấu trạng thái khác 'present' chưa
    const hasNonPresent = students.some((student) => {
      const st = attendanceMap[student._id]?.status;
      return st && st !== 'present';
    });

    if (hasNonPresent) {
      const ok = window.confirm(
        'Một số học sinh đã được đánh dấu vắng hoặc muộn. Bạn có chắc chắn muốn đặt lại tất cả học sinh thành "Có mặt"?'
      );
      if (!ok) return;
    }

    setAttendanceMap((old) =>
      Object.fromEntries(
        students.map((student) => [
          student._id,
          { ...old[student._id], studentId: student._id, status: 'present' },
        ])
      )
    );
  };

  const handleSubmit = async () => {
    const presentStudents = students.filter((s) => attendanceMap[s._id]?.status === 'present');
    const absentStudents = students.filter((s) => {
      const st = attendanceMap[s._id]?.status;
      return st === 'absent' || st === 'absent_permission';
    });
    const lateStudents = students.filter((s) => attendanceMap[s._id]?.status === 'late');
    const unmarkedStudents = students.filter((s) => !attendanceMap[s._id]?.status);

    if (unmarkedStudents.length > 0) {
      const ok = window.confirm(
        `Còn ${unmarkedStudents.length} học sinh chưa được chọn trạng thái điểm danh. Bạn có muốn tiếp tục lưu cho ${students.length - unmarkedStudents.length} học sinh đã chọn?`
      );
      if (!ok) return;
    }

    const records = [];
    const updates = [];
    students.forEach((student) => {
      const record = attendanceMap[student._id];
      if (!record?.status) return; // Không lưu học sinh chưa điểm danh
      if (record._id) {
        updates.push({ id: record._id, status: record.status, note: record.note || '' });
      } else {
        records.push({ studentId: student._id, status: record.status, note: record.note || '' });
      }
    });

    if (!records.length && !updates.length) {
      setNotice('Chưa có học sinh nào được chọn điểm danh để lưu.');
      return;
    }

    setSaving(true);
    setNotice('');
    try {
      if (records.length) {
        await api.post('/attendance/bulk', { classroomId, attendDate, records });
      }
      if (updates.length) {
        await Promise.all(
          updates.map((item) => api.put(`/attendance/${item.id}`, { status: item.status, note: item.note }))
        );
      }
      setNotice(`Đã lưu điểm danh thành công (${presentStudents.length} có mặt, ${absentStudents.length} vắng, ${lateStudents.length} muộn).`);

      // Tải lại dữ liệu điểm danh mới nhất
      const attendanceRes = await api.get(`/attendance/class/${classroomId}`, { params: { date: attendDate } });
      const map = {};
      (attendanceRes.data.data || []).forEach((record) => {
        map[String(record.studentId)] = record;
      });
      setAttendanceMap(map);
    } catch (err) {
      setNotice(err.response?.data?.message || 'Lưu điểm danh chưa thành công.');
    } finally {
      setSaving(false);
    }
  };

  const visible = useMemo(
    () => students.filter((s) => s.fullName.toLowerCase().includes(query.toLowerCase())),
    [students, query]
  );
  const currentPage = Math.min(page, Math.max(1, Math.ceil(visible.length / 10)));

  // Đếm chính xác từng loại trạng thái, không mặc định 'present'
  const presentCount = students.filter((s) => attendanceMap[s._id]?.status === 'present').length;
  const absentCount = students.filter((s) => {
    const st = attendanceMap[s._id]?.status;
    return st === 'absent' || st === 'absent_permission';
  }).length;
  const lateCount = students.filter((s) => attendanceMap[s._id]?.status === 'late').length;
  const unmarkedCount = students.filter((s) => !attendanceMap[s._id]?.status).length;

  const setTab = (tabName) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tabName === 'departure') {
        next.set('tab', 'departure');
      } else {
        next.delete('tab');
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="page-loader">
        <span className="loading-orb" />
        Đang chuẩn bị danh sách điểm danh...
      </div>
    );
  }

  return (
    <AppShell
      title="Điểm danh & Đón trả trẻ"
      subtitle="Tiếp nhận học sinh đến lớp (đón trẻ) và xác minh bàn giao khi ra về (trả trẻ)."
    >
      {notice && (
        <div className={`timekeeping-notice ${notice.startsWith('Đã ') ? 'success' : 'error'}`}>
          {notice}
        </div>
      )}

      {/* Tab Switcher: Đón trẻ vs Trả trẻ */}
      <div className="attendance-workflow-tabs" role="tablist" aria-label="Luồng đón và trả trẻ">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'arrival'}
          className={`attendance-workflow-tab ${activeTab === 'arrival' ? 'active' : ''}`}
          onClick={() => setTab('arrival')}
        >
          <Icon name="attendance" size={17} />
          <span>Đón trẻ (Tiếp nhận đến lớp)</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'departure'}
          className={`attendance-workflow-tab ${activeTab === 'departure' ? 'active' : ''}`}
          onClick={() => setTab('departure')}
        >
          <Icon name="users" size={17} />
          <span>Trả trẻ (Bàn giao người đón)</span>
        </button>
      </div>

      <div className="attendance-topline">
        <button className="back-link" onClick={() => navigate(`/attendance${urlDate ? `?date=${urlDate}` : ''}`)}>
          <Icon name="arrowLeft" size={18} />
          Danh sách lớp
        </button>
        <div className="toolbar-buttons">
          <label className="check-date">
            {activeTab === 'arrival' ? 'Ngày điểm danh' : 'Ngày đón trẻ'}
            <input
              type="date"
              value={attendDate}
              onChange={(event) => handleDateChange(event.target.value)}
            />
          </label>
          {activeTab === 'arrival' && (
            <div className="attendance-summary">
              <span>
                <b>{presentCount}</b> có mặt · <b>{absentCount}</b> vắng{lateCount > 0 && <> · <b>{lateCount}</b> muộn</>}{unmarkedCount > 0 && <> · <b style={{ color: '#d97706' }}>{unmarkedCount}</b> chưa điểm danh</>}
              </span>
              <div>
                <i style={{ width: `${students.length ? (presentCount / students.length) * 100 : 0}%` }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {activeTab === 'arrival' ? (
        <>
          <section className="content-card roster-card">
            <div className="list-toolbar">
              <div>
                <p className="card-kicker">TIẾP NHẬN ĐẦU NGÀY</p>
                <h2>{students.length} học sinh</h2>
              </div>
              <div className="toolbar-buttons">
                <button className="button button-secondary" onClick={markAllPresent}>
                  <Icon name="check" size={17} />
                  Tất cả có mặt
                </button>
                <label className="search-box">
                  <Icon name="search" size={18} />
                  <input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(1);
                    }}
                    placeholder="Tìm học sinh..."
                  />
                </label>
              </div>
            </div>
            <div className="roster-list">
              {visible.slice((currentPage - 1) * 10, currentPage * 10).map((student, index) => {
                const record = attendanceMap[student._id] || {};
                const currentStatus = record.status || null;
                return (
                  <article className="student-row" key={student._id}>
                    <span className="row-number">
                      {String((currentPage - 1) * 10 + index + 1).padStart(2, '0')}
                    </span>
                    <span className="student-avatar large">{student.fullName.charAt(0)}</span>
                    <div className="student-details">
                      <strong>{student.fullName}</strong>
                      <small>
                        {student.gender === 'female' ? 'Nữ' : 'Nam'} · {student.studentCode}
                      </small>
                    </div>
                    <div className="status-controls">
                      {statuses.map((status) => (
                        <button
                          key={status.value}
                          type="button"
                          onClick={() => updateRecord(student._id, { status: status.value })}
                          className={`status-option ${status.value} ${currentStatus === status.value ? 'selected' : ''}`}
                        >
                          {status.short}
                        </button>
                      ))}
                    </div>
                    <input
                      className="note-input"
                      value={record.note || ''}
                      onChange={(event) => updateRecord(student._id, { note: event.target.value })}
                      placeholder="Ghi chú (nếu có)"
                    />
                  </article>
                );
              })}
            </div>
            {!visible.length && (
              <div className="empty-state compact">
                <strong>Không tìm thấy học sinh phù hợp</strong>
              </div>
            )}
            <StudentPagination total={visible.length} page={currentPage} onChange={setPage} />
          </section>
          <div className="form-actions">
            <button className="button button-primary" onClick={handleSubmit} disabled={saving}>
              <Icon name="check" size={18} />
              {saving ? 'Đang lưu...' : 'Lưu điểm danh'}
            </button>
          </div>
        </>
      ) : (
        <section className="attendance-departure-section">
          <PickupManagement embedded classroomId={classroomId} filterDate={attendDate} />
        </section>
      )}
    </AppShell>
  );
}
