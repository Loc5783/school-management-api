import { useCallback, useEffect, useState } from 'react';
import {
  getStaffing, getStaffingTimetable, getEmployeeLeaves, saveClassroomStaffing, createStaffShift,
  cancelStaffShift, createStaffReplacement, cancelStaffReplacement
} from '../api/hr';


const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shortWeekdays = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const fullWeekdays = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
const days = [['CN', 0], ['T2', 1], ['T3', 2], ['T4', 3], ['T5', 4], ['T6', 5], ['T7', 6]];
const idOf = (value) => String(value?._id || value || '');
const leaveCovers = (leave, date) => leave.status === 'approved' && (leave.workDates?.length ? leave.workDates.includes(date) : leave.startDate?.slice(0, 10) <= date && leave.endDate?.slice(0, 10) >= date);
const emptyShift = { employeeId: '', name: '', startTime: '07:00', endTime: '17:00', weekdays: [1, 2, 3, 4, 5], validFrom: today(), validUntil: `${new Date().getFullYear()}-12-31` };
const emptyReplacement = { kind: 'classroom', targetId: '', absentEmployeeId: '', replacementEmployeeId: '', note: '' };

const getMondayOfWeek = (d) => {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff)).toISOString().slice(0, 10);
};

export default function StaffingManagement({ employees, initialDate }) {
  const [date, setDate] = useState(initialDate || today);
  const [startDate, setStartDate] = useState(() => getMondayOfWeek(initialDate || today()));
  const [viewMode, setViewMode] = useState('timetable'); // 'timetable' | 'day'
  const [timetableData, setTimetableData] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [leaves, setLeaves] = useState([]);
  const [classDrafts, setClassDrafts] = useState({});
  const [shiftForm, setShiftForm] = useState(emptyShift);
  const [replacementForm, setReplacementForm] = useState(emptyReplacement);
  
  // Filters
  const [filterRole, setFilterRole] = useState('all');
  const [filterClass, setFilterClass] = useState('all');
  const [filterEmployee, setFilterEmployee] = useState('all');
  const [filterSchoolYear, setFilterSchoolYear] = useState('all');

  const [state, setState] = useState({ loading: true, saving: false, error: '', notice: '' });
  const active = employees.filter((employee) => employee.status === 'active' && employee.userId?.status === 'active');
  const teachers = active.filter((employee) => employee.userId?.role === 'teacher');
  const shiftWorkers = active.filter((employee) => ['chef', 'guard'].includes(employee.userId?.role));
  const employeeName = (value) => employees.find((employee) => idOf(employee._id) === idOf(value))?.fullName || 'Nhân viên';

  const chosenTarget = replacementForm.kind === 'classroom'
    ? snapshot?.classrooms.find((item) => idOf(item._id) === replacementForm.targetId)
    : snapshot?.duties.find((item) => idOf(item._id) === replacementForm.targetId);
  const eligibleTargets = replacementForm.kind === 'classroom'
    ? (snapshot?.classrooms || []).filter((item) => item.schoolDay)
    : snapshot?.duties || [];

  const absentOptions = replacementForm.kind === 'classroom'
    ? (chosenTarget?.assigned || []).filter((item) => leaves.some((leave) => idOf(leave.employeeId) === idOf(item._id) && leaveCovers(leave, date)))
    : chosenTarget ? employees.filter((employee) => idOf(employee._id) === idOf(chosenTarget.employeeId) && leaves.some((leave) => idOf(leave.employeeId) === idOf(employee._id) && leaveCovers(leave, date))).map((employee) => ({ _id: employee._id, name: employee.fullName })) : [];
  
  const replacementCandidates = (replacementForm.kind === 'classroom' ? teachers : shiftWorkers.filter((employee) => employee.userId?.role === chosenTarget?.role))
    .filter((employee) => !leaves.some((leave) => idOf(leave.employeeId) === idOf(employee._id) && leaveCovers(leave, date)))
    .filter((employee) => !(snapshot?.replacements || []).some((item) => idOf(item.replacementEmployeeId) === idOf(employee._id)))
    .filter((employee) => replacementForm.kind === 'classroom'
      ? !(snapshot?.classrooms || []).some((classroom) => classroom.schoolYear === chosenTarget?.schoolYear && classroom.assigned.some((item) => idOf(item._id) === idOf(employee._id)))
      : !(snapshot?.duties || []).some((duty) => idOf(duty.employeeId) === idOf(employee._id)));

  const load = useCallback(async () => {
    setState((old) => ({ ...old, loading: true, error: '' }));
    try {
      const [staffingRes, timetableRes, leaveRes] = await Promise.all([
        getStaffing(date),
        getStaffingTimetable({
          startDate,
          daysCount: 7,
          role: filterRole === 'all' ? undefined : filterRole,
          classroomId: filterClass === 'all' ? undefined : filterClass,
          employeeId: filterEmployee === 'all' ? undefined : filterEmployee,
          schoolYear: filterSchoolYear === 'all' ? undefined : filterSchoolYear
        }),
        getEmployeeLeaves({ status: 'approved' })
      ]);
      const data = staffingRes.data.data;
      setSnapshot(data);
      setTimetableData(timetableRes.data.data);
      setLeaves(leaveRes.data.data || []);
      setClassDrafts(Object.fromEntries(data.classrooms.map((item) => [idOf(item._id), {
        homeroomTeacherId: idOf(item.homeroomTeacherId),
        supportTeacherIds: (item.supportTeacherIds || []).map(idOf),
        requiredTeachers: item.requiredTeachers,
        teachingWeekdays: item.teachingWeekdays || [1, 2, 3, 4, 5]
      }])));
      setState((old) => ({ ...old, loading: false }));
    } catch (error) {
      setState((old) => ({ ...old, loading: false, error: error.response?.data?.message || 'Không thể tải phân công.' }));
    }
  }, [date, startDate, filterRole, filterClass, filterEmployee, filterSchoolYear]);

  useEffect(() => { load(); }, [load]);

  const run = async (action, success) => {
    setState((old) => ({ ...old, saving: true, error: '', notice: '' }));
    try {
      await action();
      await load();
      setState((old) => ({ ...old, saving: false, notice: success }));
    } catch (error) {
      setState((old) => ({ ...old, saving: false, error: error.response?.data?.message || 'Không thể lưu phân công.' }));
    }
  };

  const updateDraft = (classroomId, patch) => setClassDrafts((old) => ({ ...old, [classroomId]: { ...old[classroomId], ...patch } }));
  const toggleDay = (list, day) => list.includes(day) ? list.filter((item) => item !== day) : [...list, day];
  const setTarget = (kind, targetId) => setReplacementForm({ ...emptyReplacement, kind, targetId });

  const shiftWeek = (deltaDays) => {
    const cur = new Date(startDate);
    cur.setDate(cur.getDate() + deltaDays);
    setStartDate(cur.toISOString().slice(0, 10));
  };

  const targetLabel = (item) => item.kind === 'classroom'
    ? snapshot?.classrooms.find((entry) => idOf(entry._id) === idOf(item.classroomId))?.name
    : snapshot?.duties.find((entry) => idOf(entry._id) === idOf(item.shiftId))?.name;

  const distinctYears = [...new Set((timetableData?.classes || []).map((c) => c.schoolYear).filter(Boolean))];

  return (
    <div className="staffing-page">
      <div className="content-card staffing-heading">
        <div>
          <p className="card-kicker">THỜI KHÓA BIỂU & ĐỊNH MỨC BIÊN CHẾ</p>
          <h2>Phân công công việc nhà trường</h2>
          <p>Thời khóa biểu theo tuần và theo ngày. Kiểm tra định mức giáo viên theo lớp, ca bếp và ca bảo vệ; đảm bảo chủ nhiệm tối đa 1 lớp và không trùng lịch làm việc.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className={`button ${viewMode === 'timetable' ? 'button-primary' : 'button-secondary'}`}
            onClick={() => setViewMode('timetable')}
          >
            Thời khóa biểu tuần
          </button>
          <button
            type="button"
            className={`button ${viewMode === 'day' ? 'button-primary' : 'button-secondary'}`}
            onClick={() => setViewMode('day')}
          >
            Chi tiết ngày & Thay thế
          </button>
        </div>
      </div>

      {state.error && <div className="form-error" role="alert">{state.error}</div>}
      {state.notice && <div className="timekeeping-notice success" role="status">{state.notice}</div>}

      {/* Metric Cards */}
      {snapshot && (
        <div className="staffing-metrics">
          <article>
            <small>LỚP THIẾU GIÁO VIÊN HÔM NAY</small>
            <strong style={{ color: snapshot.teacherShortages.length ? '#b14955' : '#238636' }}>
              {snapshot.teacherShortages.length} lớp
            </strong>
          </article>
          <article>
            <small>GIÁO VIÊN CÒN THIẾU</small>
            <strong style={{ color: snapshot.missingTeacherTotal ? '#b14955' : '#238636' }}>
              {snapshot.missingTeacherTotal} vị trí
            </strong>
          </article>
          <article>
            <small>CA BẾP / BẢO VỆ CHƯA CÓ NGƯỜI</small>
            <strong style={{ color: snapshot.uncoveredShifts ? '#b14955' : '#238636' }}>
              {snapshot.uncoveredShifts} ca
            </strong>
          </article>
        </div>
      )}

      {/* Filter Toolbar */}
      <section className="content-card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
          {viewMode === 'timetable' && (
            <label style={{ display: 'grid', gap: '5px', fontSize: '12px', fontWeight: 700, color: '#4a5b78' }}>
              Tuần bắt đầu từ
              <div style={{ display: 'flex', gap: '6px' }}>
                <button type="button" className="button button-secondary" style={{ padding: '0 8px' }} onClick={() => shiftWeek(-7)}>◀</button>
                <input type="date" value={startDate} onChange={(e) => setStartDate(getMondayOfWeek(e.target.value))} style={{ flex: 1 }} />
                <button type="button" className="button button-secondary" style={{ padding: '0 8px' }} onClick={() => shiftWeek(7)}>▶</button>
              </div>
            </label>
          )}

          {viewMode === 'day' && (
            <label style={{ display: 'grid', gap: '5px', fontSize: '12px', fontWeight: 700, color: '#4a5b78' }}>
              Ngày theo dõi
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          )}

          <label style={{ display: 'grid', gap: '5px', fontSize: '12px', fontWeight: 700, color: '#4a5b78' }}>
            Năm học
            <select value={filterSchoolYear} onChange={(e) => setFilterSchoolYear(e.target.value)}>
              <option value="all">Tất cả năm học</option>
              {distinctYears.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
            </select>
          </label>

          <label style={{ display: 'grid', gap: '5px', fontSize: '12px', fontWeight: 700, color: '#4a5b78' }}>
            Vai trò
            <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)}>
              <option value="all">Tất cả vai trò</option>
              <option value="teacher">Giáo viên đứng lớp</option>
              <option value="chef">Bếp ăn</option>
              <option value="guard">Bảo vệ</option>
            </select>
          </label>

          <label style={{ display: 'grid', gap: '5px', fontSize: '12px', fontWeight: 700, color: '#4a5b78' }}>
            Lọc theo lớp
            <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)}>
              <option value="all">Tất cả các lớp</option>
              {(timetableData?.classes || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </label>

          <label style={{ display: 'grid', gap: '5px', fontSize: '12px', fontWeight: 700, color: '#4a5b78' }}>
            Nhân viên
            <select value={filterEmployee} onChange={(e) => setFilterEmployee(e.target.value)}>
              <option value="all">Tất cả nhân viên</option>
              {active.map((e) => <option key={e._id} value={e._id}>{e.fullName}</option>)}
            </select>
          </label>
        </div>
      </section>

      {state.loading ? (
        <div className="inline-loader" style={{ padding: '30px 0', textAlign: 'center' }}>
          <span className="loading-orb" /> Đang cập nhật thời khóa biểu và phân công...
        </div>
      ) : viewMode === 'timetable' ? (
        /* TIMETABLE VIEW (GRID & MOBILE LIST) */
        <section className="content-card staffing-section">
          <div className="card-heading">
            <div>
              <p className="card-kicker">THỜI KHÓA BIỂU TUẦN</p>
              <h2>Lịch phân công từ {timetableData?.dates[0]} đến {timetableData?.dates[timetableData?.dates.length - 1]}</h2>
            </div>
          </div>

          {/* Desktop Table Grid */}
          <div className="table-wrap timetable-grid-wrap timetable-desktop-grid" style={{ overflowX: 'auto', padding: '0 20px 20px' }}>
            <table className="data-table" style={{ minWidth: '950px', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ minWidth: '170px' }}>ĐƠN VỊ / LỚP / CA</th>
                  {(timetableData?.timetable || []).map((col) => (
                    <th key={col.date} style={{ textAlign: 'center', minWidth: '120px' }}>
                      <span style={{ display: 'block', fontSize: '13px' }}>{shortWeekdays[col.weekday]}</span>
                      <small style={{ color: '#7a8ba8', fontWeight: 'normal' }}>{col.date.slice(5)}</small>
                      {col.shortages > 0 && (
                        <span style={{ display: 'block', fontSize: '10px', color: '#b14955', fontWeight: 800 }}>
                          Thiếu {col.shortages}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Classroom Rows */}
                {filterRole !== 'chef' && filterRole !== 'guard' && (timetableData?.classes || []).map((cls) => {
                  return (
                    <tr key={cls._id}>
                      <td style={{ verticalAlign: 'top', background: '#f8fafc' }}>
                        <strong style={{ color: '#1e3a8a', display: 'block' }}>{cls.name}</strong>
                        <small style={{ color: '#64748b' }}>Năm học: {cls.schoolYear}</small>
                      </td>
                      {(timetableData?.timetable || []).map((dayCol) => {
                        const classDay = dayCol.classrooms.find((c) => String(c._id) === String(cls._id));
                        if (!classDay) return <td key={dayCol.date} style={{ textAlign: 'center', color: '#a0aec0' }}>—</td>;
                        if (!classDay.schoolDay) {
                          return (
                            <td key={dayCol.date} style={{ textAlign: 'center', background: '#fdfdfd', color: '#94a3b8', fontSize: '11px' }}>
                              Nghỉ học
                            </td>
                          );
                        }
                        const isShortage = classDay.quotaStatus === 'shortage';
                        return (
                          <td key={dayCol.date} style={{ verticalAlign: 'top', background: isShortage ? '#fff5f5' : '#fafffc', padding: '8px' }}>
                            <div style={{ fontSize: '11px' }}>
                              <span style={{
                                display: 'inline-block',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '10px',
                                fontWeight: 700,
                                marginBottom: '4px',
                                background: isShortage ? '#fee2e2' : '#dcfce7',
                                color: isShortage ? '#991b1b' : '#166534'
                              }}>
                                {classDay.presentTeachers}/{classDay.requiredTeachers} GV {isShortage ? `· Thiếu ${classDay.missingTeachers}` : '· Đủ'}
                              </span>
                              <div style={{ display: 'grid', gap: '3px', marginTop: '4px' }}>
                                {classDay.assigned.map((t) => (
                                  <div key={t._id} style={{ color: t.absent ? '#9ca3af' : '#1e293b', textDecoration: t.absent ? 'line-through' : 'none' }}>
                                    {t.isHomeroom && <span title="GV Chủ nhiệm" style={{ color: '#d97706', marginRight: '3px' }}>★</span>}
                                    {t.name}
                                    {t.absent && <small style={{ color: '#ef4444', textDecoration: 'none' }}> (nghỉ)</small>}
                                  </div>
                                ))}
                                {classDay.replacements.map((r) => (
                                  <div key={r._id} style={{ color: '#2563eb', fontWeight: 600 }}>
                                    ↳ {r.name} (thay)
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}

                {/* Duty/Shift Rows */}
                {filterRole !== 'teacher' && (
                  <>
                    <tr style={{ background: '#f1f5f9' }}>
                      <td colSpan={8} style={{ fontWeight: 800, color: '#334155', fontSize: '11px', letterSpacing: '0.05em' }}>
                        CA LÀM VIỆC BẾP & BẢO VỆ
                      </td>
                    </tr>
                    {snapshot?.shifts.map((shift) => (
                      <tr key={shift._id}>
                        <td style={{ verticalAlign: 'top', background: '#f8fafc' }}>
                          <strong style={{ display: 'block', color: '#1e3a8a' }}>{shift.name}</strong>
                          <small style={{ color: '#64748b' }}>
                            {shift.role === 'chef' ? 'Bếp' : 'Bảo vệ'} · {shift.startTime}–{shift.endTime}
                          </small>
                        </td>
                        {(timetableData?.timetable || []).map((dayCol) => {
                          const duty = dayCol.duties.find((d) => String(d._id) === String(shift._id));
                          if (!duty) return <td key={dayCol.date} style={{ textAlign: 'center', color: '#cbd5e1' }}>—</td>;
                          const isUncovered = duty.uncovered;
                          return (
                            <td key={dayCol.date} style={{ verticalAlign: 'top', background: isUncovered ? '#fff5f5' : '#fff', padding: '8px' }}>
                              <div style={{ fontSize: '11px' }}>
                                <span style={{
                                  display: 'inline-block',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  background: isUncovered ? '#fee2e2' : '#f0fdf4',
                                  color: isUncovered ? '#991b1b' : '#15803d'
                                }}>
                                  {isUncovered ? 'Chưa có người' : 'Đã phân công'}
                                </span>
                                <div style={{ marginTop: '4px', color: duty.absent ? '#9ca3af' : '#1e293b', textDecoration: duty.absent ? 'line-through' : 'none' }}>
                                  {duty.employeeName}
                                </div>
                                {duty.replacement && (
                                  <div style={{ color: '#2563eb', fontWeight: 600 }}>
                                    ↳ {duty.replacement.name} (thay)
                                  </div>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Card Layout */}
          <div className="timetable-mobile-cards" style={{ display: 'grid', gap: '16px', padding: '0 16px 20px' }}>
            {(timetableData?.timetable || []).map((dayCol) => {
              return (
                <article
                  key={dayCol.date}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    background: '#fff',
                    overflow: 'hidden',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                  }}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 16px',
                    background: '#f8fafc',
                    borderBottom: '1px solid #e2e8f0'
                  }}>
                    <div>
                      <strong style={{ fontSize: '15px', color: '#1e3a8a' }}>
                        {fullWeekdays[dayCol.weekday]} ({dayCol.date})
                      </strong>
                    </div>
                    {dayCol.shortages > 0 ? (
                      <span style={{
                        background: '#fee2e2',
                        color: '#991b1b',
                        padding: '3px 8px',
                        borderRadius: '999px',
                        fontSize: '11px',
                        fontWeight: 800
                      }}>
                        Thiếu {dayCol.shortages} vị trí
                      </span>
                    ) : (
                      <span style={{
                        background: '#dcfce7',
                        color: '#166534',
                        padding: '3px 8px',
                        borderRadius: '999px',
                        fontSize: '11px',
                        fontWeight: 700
                      }}>
                        Đủ định mức
                      </span>
                    )}
                  </div>

                  <div style={{ padding: '12px 16px', display: 'grid', gap: '10px' }}>
                    {/* Classrooms */}
                    {filterRole !== 'chef' && filterRole !== 'guard' && (
                      <div>
                        <small style={{ fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Lớp học & Giáo viên
                        </small>
                        <div style={{ display: 'grid', gap: '8px', marginTop: '6px' }}>
                          {(timetableData?.classes || []).map((cls) => {
                            const classDay = dayCol.classrooms.find((c) => String(c._id) === String(cls._id));
                            if (!classDay) return null;
                            if (!classDay.schoolDay) {
                              return (
                                <div key={cls._id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: '#f8fafc', borderRadius: '6px', fontSize: '12px', color: '#94a3b8' }}>
                                  <span>{cls.name}</span>
                                  <em>Nghỉ học</em>
                                </div>
                              );
                            }
                            const isShortage = classDay.quotaStatus === 'shortage';
                            return (
                              <div
                                key={cls._id}
                                style={{
                                  padding: '8px 10px',
                                  background: isShortage ? '#fff5f5' : '#f8fafc',
                                  border: isShortage ? '1px solid #fecaca' : '1px solid #e2e8f0',
                                  borderRadius: '8px',
                                  fontSize: '12px'
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                  <strong style={{ color: '#1e3a8a' }}>{cls.name}</strong>
                                  <span style={{
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    fontSize: '10px',
                                    fontWeight: 700,
                                    background: isShortage ? '#fee2e2' : '#dcfce7',
                                    color: isShortage ? '#991b1b' : '#166534'
                                  }}>
                                    {classDay.presentTeachers}/{classDay.requiredTeachers} GV {isShortage ? `· Thiếu ${classDay.missingTeachers}` : '· Đủ'}
                                  </span>
                                </div>
                                <div style={{ display: 'grid', gap: '2px' }}>
                                  {classDay.assigned.map((t) => (
                                    <div key={t._id} style={{ color: t.absent ? '#9ca3af' : '#1e293b', textDecoration: t.absent ? 'line-through' : 'none' }}>
                                      {t.isHomeroom && <span title="GV Chủ nhiệm" style={{ color: '#d97706', marginRight: '3px' }}>★</span>}
                                      {t.name}
                                      {t.absent && <small style={{ color: '#ef4444', textDecoration: 'none' }}> (nghỉ)</small>}
                                    </div>
                                  ))}
                                  {classDay.replacements.map((r) => (
                                    <div key={r._id} style={{ color: '#2563eb', fontWeight: 600 }}>
                                      ↳ {r.name} (thay)
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Duties (Kitchen & Security) */}
                    {filterRole !== 'teacher' && (
                      <div style={{ marginTop: '6px' }}>
                        <small style={{ fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Ca làm việc Bếp & Bảo vệ
                        </small>
                        <div style={{ display: 'grid', gap: '8px', marginTop: '6px' }}>
                          {snapshot?.shifts.map((shift) => {
                            const duty = dayCol.duties.find((d) => String(d._id) === String(shift._id));
                            if (!duty) return null;
                            const isUncovered = duty.uncovered;
                            return (
                              <div
                                key={shift._id}
                                style={{
                                  padding: '8px 10px',
                                  background: isUncovered ? '#fff5f5' : '#f8fafc',
                                  border: isUncovered ? '1px solid #fecaca' : '1px solid #e2e8f0',
                                  borderRadius: '8px',
                                  fontSize: '12px'
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                                  <strong>{shift.name} ({shift.role === 'chef' ? 'Bếp' : 'Bảo vệ'})</strong>
                                  <span style={{
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    fontSize: '10px',
                                    fontWeight: 700,
                                    background: isUncovered ? '#fee2e2' : '#dcfce7',
                                    color: isUncovered ? '#991b1b' : '#15803d'
                                  }}>
                                    {isUncovered ? 'Chưa có người' : 'Đã phân công'}
                                  </span>
                                </div>
                                <small style={{ color: '#64748b' }}>{shift.startTime}–{shift.endTime}</small>
                                <div style={{ marginTop: '3px', color: duty.absent ? '#9ca3af' : '#1e293b', textDecoration: duty.absent ? 'line-through' : 'none' }}>
                                  {duty.employeeName}
                                </div>
                                {duty.replacement && (
                                  <div style={{ color: '#2563eb', fontWeight: 600 }}>
                                    ↳ {duty.replacement.name} (thay)
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        /* DAY VIEW & REPLACEMENT MANAGEMENT */
        <>
          <section className="content-card staffing-section">
            <div className="card-heading">
              <div>
                <p className="card-kicker">GIÁO VIÊN THEO LỚP</p>
                <h2>Phân công cố định & định mức</h2>
              </div>
            </div>
            <div className="staffing-class-list">
              {snapshot.classrooms.map((classroom) => {
                const key = idOf(classroom._id);
                const draft = classDrafts[key] || {};
                return (
                  <details key={key} className="staffing-class">
                    <summary>
                      <strong>{classroom.name}</strong>
                      <span>{classroom.schoolDay ? `${classroom.presentTeachers}/${classroom.requiredTeachers} giáo viên` : 'Không có lịch học'}</span>
                      {classroom.missingTeachers > 0 && <b>Thiếu {classroom.missingTeachers}</b>}
                    </summary>
                    <div className="staffing-class-body">
                      <p>
                        Đã phân: {classroom.assigned.map((item) => `${item.name}${item.absent ? ' (nghỉ)' : ''}`).join(', ') || 'Chưa có giáo viên'}
                        {classroom.replacements.length ? ` · Thay: ${classroom.replacements.map((item) => item.name).join(', ')}` : ''}
                      </p>
                      <div className="staffing-fields">
                        <label>
                          Giáo viên chủ nhiệm (tối đa 1 lớp/năm)
                          <select value={draft.homeroomTeacherId || ''} onChange={(e) => updateDraft(key, { homeroomTeacherId: e.target.value })}>
                            <option value="">Chưa phân công</option>
                            {teachers.map((employee) => (
                              <option key={employee._id} value={idOf(employee.userId)}>
                                {employee.fullName}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Định mức giáo viên cần (1-5)
                          <input
                            type="number"
                            min="1"
                            max="5"
                            value={draft.requiredTeachers || 1}
                            onChange={(e) => updateDraft(key, { requiredTeachers: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                      <div className="staffing-checks">
                        <strong>Giáo viên hỗ trợ</strong>
                        {teachers.filter((employee) => idOf(employee.userId) !== draft.homeroomTeacherId).map((employee) => (
                          <label key={employee._id}>
                            <input
                              type="checkbox"
                              checked={(draft.supportTeacherIds || []).includes(idOf(employee.userId))}
                              onChange={() => updateDraft(key, {
                                supportTeacherIds: (draft.supportTeacherIds || []).includes(idOf(employee.userId))
                                  ? draft.supportTeacherIds.filter((v) => v !== idOf(employee.userId))
                                  : [...(draft.supportTeacherIds || []), idOf(employee.userId)]
                              })}
                            />
                            {employee.fullName}
                          </label>
                        ))}
                      </div>
                      <div className="staffing-checks">
                        <strong>Ngày lớp học trong tuần</strong>
                        {days.map(([label, day]) => (
                          <label key={day}>
                            <input
                              type="checkbox"
                              checked={(draft.teachingWeekdays || []).includes(day)}
                              onChange={() => updateDraft(key, { teachingWeekdays: toggleDay(draft.teachingWeekdays || [], day) })}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="button button-primary"
                        disabled={state.saving}
                        onClick={() => run(() => saveClassroomStaffing(key, draft), `Đã lưu phân công lớp ${classroom.name}.`)}
                      >
                        Lưu phân công lớp
                      </button>
                    </div>
                  </details>
                );
              })}
            </div>
          </section>

          <section className="content-card staffing-section">
            <div className="card-heading">
              <div>
                <p className="card-kicker">BẾP & BẢO VỆ</p>
                <h2>Lịch ca làm việc</h2>
              </div>
            </div>
            <div className="staffing-shift-list">
              {snapshot.shifts.map((shift) => (
                <article key={shift._id}>
                  <div>
                    <strong>{shift.name}</strong>
                    <small>{employeeName(shift.employeeId)} · {shift.role === 'chef' ? 'Bếp' : 'Bảo vệ'} · {shift.startTime}–{shift.endTime}{shift.endTime < shift.startTime ? ' (+1 ngày)' : ''}</small>
                    <small>{shift.validFrom} → {shift.validUntil} · {days.filter(([, day]) => shift.weekdays.includes(day)).map(([label]) => label).join(', ')}</small>
                  </div>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={state.saving}
                    onClick={() => window.confirm(`Kết thúc ca ${shift.name}?`) && run(() => cancelStaffShift(shift._id), 'Đã kết thúc phân ca.')}
                  >
                    Kết thúc ca
                  </button>
                </article>
              ))}
              {!snapshot.shifts.length && <p style={{ padding: '0 20px' }}>Chưa có ca bếp/bảo vệ nào.</p>}
            </div>

            <form
              className="staffing-fields staffing-shift-form"
              onSubmit={(event) => {
                event.preventDefault();
                run(() => createStaffShift(shiftForm), 'Đã phân ca làm việc.');
              }}
            >
              <label>
                Nhân viên
                <select required value={shiftForm.employeeId} onChange={(e) => setShiftForm({ ...shiftForm, employeeId: e.target.value })}>
                  <option value="">Chọn bếp hoặc bảo vệ</option>
                  {shiftWorkers.map((employee) => (
                    <option key={employee._id} value={employee._id}>
                      {employee.fullName} · {employee.userId.role === 'chef' ? 'Bếp' : 'Bảo vệ'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tên ca
                <input required maxLength="80" value={shiftForm.name} onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })} placeholder="Ca sáng / ca chiều" />
              </label>
              <label>
                Bắt đầu
                <input type="time" required value={shiftForm.startTime} onChange={(e) => setShiftForm({ ...shiftForm, startTime: e.target.value })} />
              </label>
              <label>
                Kết thúc
                <input type="time" required value={shiftForm.endTime} onChange={(e) => setShiftForm({ ...shiftForm, endTime: e.target.value })} />
              </label>
              <label>
                Hiệu lực từ
                <input type="date" required value={shiftForm.validFrom} onChange={(e) => setShiftForm({ ...shiftForm, validFrom: e.target.value })} />
              </label>
              <label>
                Đến
                <input type="date" required min={shiftForm.validFrom} value={shiftForm.validUntil} onChange={(e) => setShiftForm({ ...shiftForm, validUntil: e.target.value })} />
              </label>
              <div className="staffing-checks staffing-full">
                <strong>Ngày trực trong tuần</strong>
                {days.map(([label, day]) => (
                  <label key={day}>
                    <input type="checkbox" checked={shiftForm.weekdays.includes(day)} onChange={() => setShiftForm({ ...shiftForm, weekdays: toggleDay(shiftForm.weekdays, day) })} />
                    {label}
                  </label>
                ))}
              </div>
              <button type="submit" className="button button-primary" disabled={state.saving}>Thêm ca làm việc</button>
            </form>
          </section>

          <section className="content-card staffing-section">
            <div className="card-heading">
              <div>
                <p className="card-kicker">NGHỈ PHÉP ĐÃ DUYỆT</p>
                <h2>Người thay trong ngày {date}</h2>
              </div>
            </div>
            <div className="staffing-shift-list">
              {snapshot.replacements.map((item) => (
                <article key={item._id}>
                  <div>
                    <strong>{targetLabel(item) || 'Phân công'}</strong>
                    <small>{employeeName(item.absentEmployeeId)} → {employeeName(item.replacementEmployeeId)}</small>
                  </div>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={state.saving}
                    onClick={() => window.confirm('Hủy người thay này?') && run(() => cancelStaffReplacement(item._id), 'Đã hủy người thay.')}
                  >
                    Hủy thay thế
                  </button>
                </article>
              ))}
              {!snapshot.replacements.length && <p style={{ padding: '0 20px' }}>Chưa có người thay trong ngày này.</p>}
            </div>

            <form
              className="staffing-fields staffing-shift-form"
              onSubmit={(event) => {
                event.preventDefault();
                run(() => createStaffReplacement({
                  date,
                  kind: replacementForm.kind,
                  classroomId: replacementForm.kind === 'classroom' ? replacementForm.targetId : null,
                  shiftId: replacementForm.kind === 'shift' ? replacementForm.targetId : null,
                  absentEmployeeId: replacementForm.absentEmployeeId,
                  replacementEmployeeId: replacementForm.replacementEmployeeId,
                  note: replacementForm.note
                }), 'Đã phân người thay.');
              }}
            >
              <label>
                Loại phân công
                <select value={replacementForm.kind} onChange={(e) => setTarget(e.target.value, '')}>
                  <option value="classroom">Lớp học</option>
                  <option value="shift">Ca bếp / bảo vệ</option>
                </select>
              </label>
              <label>
                {replacementForm.kind === 'classroom' ? 'Lớp cần thay' : 'Ca cần thay'}
                <select required disabled={!eligibleTargets.length} value={replacementForm.targetId} onChange={(e) => setTarget(replacementForm.kind, e.target.value)}>
                  <option value="">{eligibleTargets.length ? 'Chọn' : 'Không có lịch trong ngày này'}</option>
                  {replacementForm.kind === 'classroom'
                    ? snapshot.classrooms.map((item) => (
                        <option key={item._id} value={item._id} disabled={!item.schoolDay}>
                          {item.name}{item.schoolDay ? '' : ' · Không học ngày này'}
                        </option>
                      ))
                    : snapshot.duties.map((item) => (
                        <option key={item._id} value={item._id}>{item.name} · {item.employeeName}</option>
                      ))}
                </select>
              </label>
              <label>
                Người nghỉ đã duyệt
                <select
                  required
                  disabled={!replacementForm.targetId}
                  value={replacementForm.absentEmployeeId}
                  onChange={(e) => setReplacementForm({ ...replacementForm, absentEmployeeId: e.target.value, replacementEmployeeId: '' })}
                >
                  <option value="">{replacementForm.targetId && !absentOptions.length ? 'Không có người nghỉ đã duyệt' : 'Chọn người nghỉ'}</option>
                  {absentOptions.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
                </select>
              </label>
              <label>
                Người thay thế (không được tự thay chính mình)
                <select
                  required
                  disabled={!absentOptions.length}
                  value={replacementForm.replacementEmployeeId}
                  onChange={(e) => setReplacementForm({ ...replacementForm, replacementEmployeeId: e.target.value })}
                >
                  <option value="">{replacementForm.absentEmployeeId && !replacementCandidates.length ? 'Không còn nhân sự phù hợp' : 'Chọn người thay'}</option>
                  {replacementCandidates.filter((e) => idOf(e._id) !== replacementForm.absentEmployeeId).map((e) => (
                    <option key={e._id} value={e._id}>{e.fullName}</option>
                  ))}
                </select>
              </label>
              <label className="staffing-full">
                Ghi chú bàn giao
                <input maxLength="500" value={replacementForm.note} onChange={(e) => setReplacementForm({ ...replacementForm, note: e.target.value })} placeholder="Nội dung bàn giao nếu cần" />
              </label>
              <button
                type="submit"
                className="button button-primary"
                disabled={state.saving || !eligibleTargets.length || !replacementForm.targetId || !replacementForm.absentEmployeeId || !replacementForm.replacementEmployeeId}
              >
                Phân người thay thế
              </button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
