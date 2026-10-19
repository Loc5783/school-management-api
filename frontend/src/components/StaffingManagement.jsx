import { useCallback, useEffect, useState } from 'react';
import {
  getStaffing, getEmployeeLeaves, saveClassroomStaffing, createStaffShift,
  cancelStaffShift, createStaffReplacement, cancelStaffReplacement
} from '../api/hr';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const days = [['CN', 0], ['T2', 1], ['T3', 2], ['T4', 3], ['T5', 4], ['T6', 5], ['T7', 6]];
const idOf = (value) => String(value?._id || value || '');
const leaveCovers = (leave, date) => leave.status === 'approved' && (leave.workDates?.length ? leave.workDates.includes(date) : leave.startDate?.slice(0, 10) <= date && leave.endDate?.slice(0, 10) >= date);
const emptyShift = { employeeId: '', name: '', startTime: '07:00', endTime: '17:00', weekdays: [1, 2, 3, 4, 5], validFrom: today(), validUntil: `${new Date().getFullYear()}-12-31` };
const emptyReplacement = { kind: 'classroom', targetId: '', absentEmployeeId: '', replacementEmployeeId: '', note: '' };

export default function StaffingManagement({ employees, initialDate }) {
  const [date, setDate] = useState(initialDate || today);
  const [snapshot, setSnapshot] = useState(null);
  const [leaves, setLeaves] = useState([]);
  const [classDrafts, setClassDrafts] = useState({});
  const [shiftForm, setShiftForm] = useState(emptyShift);
  const [replacementForm, setReplacementForm] = useState(emptyReplacement);
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
  const nextClassDate = (() => {
    if (replacementForm.kind !== 'classroom' || eligibleTargets.length || !snapshot?.classrooms.length) return '';
    const candidate = new Date(`${date}T00:00:00.000Z`);
    for (let offset = 1; offset <= 14; offset += 1) {
      candidate.setUTCDate(candidate.getUTCDate() + 1);
      const weekday = candidate.getUTCDay();
      if (snapshot.classrooms.some((item) => (item.teachingWeekdays || [1, 2, 3, 4, 5]).includes(weekday))) return candidate.toISOString().slice(0, 10);
    }
    return '';
  })();
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
      const [staffingRes, leaveRes] = await Promise.all([getStaffing(date), getEmployeeLeaves({ status: 'approved' })]);
      const data = staffingRes.data.data;
      setSnapshot(data);
      setLeaves(leaveRes.data.data || []);
      setClassDrafts(Object.fromEntries(data.classrooms.map((item) => [idOf(item._id), {
        homeroomTeacherId: idOf(item.homeroomTeacherId), supportTeacherIds: (item.supportTeacherIds || []).map(idOf),
        requiredTeachers: item.requiredTeachers, teachingWeekdays: item.teachingWeekdays || [1, 2, 3, 4, 5]
      }])));
      setState((old) => ({ ...old, loading: false }));
    } catch (error) { setState((old) => ({ ...old, loading: false, error: error.response?.data?.message || 'Không thể tải phân công.' })); }
  }, [date]);
  useEffect(() => { load(); }, [load]);

  const run = async (action, success) => {
    setState((old) => ({ ...old, saving: true, error: '', notice: '' }));
    try { await action(); await load(); setState((old) => ({ ...old, saving: false, notice: success })); }
    catch (error) { setState((old) => ({ ...old, saving: false, error: error.response?.data?.message || 'Không thể lưu phân công.' })); }
  };
  const updateDraft = (classroomId, patch) => setClassDrafts((old) => ({ ...old, [classroomId]: { ...old[classroomId], ...patch } }));
  const toggleDay = (list, day) => list.includes(day) ? list.filter((item) => item !== day) : [...list, day];
  const setTarget = (kind, targetId) => setReplacementForm({ ...emptyReplacement, kind, targetId });
  const changeDate = (nextDate) => {
    setDate(nextDate);
    setReplacementForm((old) => ({ ...emptyReplacement, kind: old.kind }));
  };
  const targetLabel = (item) => item.kind === 'classroom'
    ? snapshot?.classrooms.find((entry) => idOf(entry._id) === idOf(item.classroomId))?.name
    : snapshot?.duties.find((entry) => idOf(entry._id) === idOf(item.shiftId))?.name;

  return <div className="staffing-page">
    <div className="content-card staffing-heading"><div><p className="card-kicker">PHÂN CÔNG CÔNG VIỆC</p><h2>Lớp học, ca trực và người thay</h2><p>Phân công cố định của giáo viên lưu theo lớp. Ca bếp/bảo vệ lặp theo thứ trong tuần; người thay chỉ có hiệu lực khi đơn nghỉ đã duyệt.</p></div><label>Ngày cần theo dõi<input type="date" value={date} onChange={(event) => changeDate(event.target.value)} /></label></div>
    {state.error && <div className="form-error">{state.error}</div>}{state.notice && <div className="timekeeping-notice success">{state.notice}</div>}
    {state.loading ? <div className="inline-loader">Đang kiểm tra lịch phân công...</div> : <>
      <div className="staffing-metrics"><article><small>LỚP THIẾU GIÁO VIÊN</small><strong>{snapshot.teacherShortages.length}</strong></article><article><small>GIÁO VIÊN CÒN THIẾU</small><strong>{snapshot.missingTeacherTotal}</strong></article><article><small>CA CHƯA CÓ NGƯỜI</small><strong>{snapshot.uncoveredShifts}</strong></article></div>
      <section className="content-card staffing-section"><div className="card-heading"><div><p className="card-kicker">GIÁO VIÊN THEO LỚP</p><h2>Phân công cố định & định mức</h2></div></div><div className="staffing-class-list">{snapshot.classrooms.map((classroom) => {
        const key = idOf(classroom._id); const draft = classDrafts[key] || {};
        return <details key={key} className="staffing-class"><summary><strong>{classroom.name}</strong><span>{classroom.schoolDay ? `${classroom.presentTeachers}/${classroom.requiredTeachers} giáo viên` : 'Không có lịch học'}</span>{classroom.missingTeachers > 0 && <b>Thiếu {classroom.missingTeachers}</b>}</summary><div className="staffing-class-body"><p>Đã phân: {classroom.assigned.map((item) => `${item.name}${item.absent ? ' (nghỉ)' : ''}`).join(', ') || 'Chưa có giáo viên'}{classroom.replacements.length ? ` · Thay: ${classroom.replacements.map((item) => item.name).join(', ')}` : ''}</p><div className="staffing-fields"><label>Giáo viên chủ nhiệm<select value={draft.homeroomTeacherId || ''} onChange={(event) => updateDraft(key, { homeroomTeacherId: event.target.value })}><option value="">Chưa phân công</option>{teachers.map((employee) => <option key={employee._id} value={idOf(employee.userId)}>{employee.fullName}</option>)}</select></label><label>Số giáo viên cần<input type="number" min="1" max="5" value={draft.requiredTeachers || 1} onChange={(event) => updateDraft(key, { requiredTeachers: Number(event.target.value) })} /></label></div><div className="staffing-checks"><strong>Giáo viên hỗ trợ</strong>{teachers.filter((employee) => idOf(employee.userId) !== draft.homeroomTeacherId).map((employee) => <label key={employee._id}><input type="checkbox" checked={(draft.supportTeacherIds || []).includes(idOf(employee.userId))} onChange={() => updateDraft(key, { supportTeacherIds: (draft.supportTeacherIds || []).includes(idOf(employee.userId)) ? draft.supportTeacherIds.filter((value) => value !== idOf(employee.userId)) : [...(draft.supportTeacherIds || []), idOf(employee.userId)] })} />{employee.fullName}</label>)}</div><div className="staffing-checks"><strong>Ngày lớp học</strong>{days.map(([label, day]) => <label key={day}><input type="checkbox" checked={(draft.teachingWeekdays || []).includes(day)} onChange={() => updateDraft(key, { teachingWeekdays: toggleDay(draft.teachingWeekdays || [], day) })} />{label}</label>)}</div><button className="button button-primary" disabled={state.saving} onClick={() => run(() => saveClassroomStaffing(key, draft), `Đã lưu phân công lớp ${classroom.name}.`)}>Lưu phân công lớp</button></div></details>;
      })}</div></section>
      <section className="content-card staffing-section"><div className="card-heading"><div><p className="card-kicker">BẾP & BẢO VỆ</p><h2>Lịch ca làm việc</h2></div></div><div className="staffing-shift-list">{snapshot.shifts.map((shift) => <article key={shift._id}><div><strong>{shift.name}</strong><small>{employeeName(shift.employeeId)} · {shift.role === 'chef' ? 'Bếp' : 'Bảo vệ'} · {shift.startTime}–{shift.endTime}{shift.endTime < shift.startTime ? ' (+1 ngày)' : ''}</small><small>{shift.validFrom} → {shift.validUntil} · {days.filter(([, day]) => shift.weekdays.includes(day)).map(([label]) => label).join(', ')}</small></div><button className="button button-secondary" disabled={state.saving} onClick={() => window.confirm(`Kết thúc ca ${shift.name}?`) && run(() => cancelStaffShift(shift._id), 'Đã kết thúc phân ca.')}>Kết thúc ca</button></article>)}{!snapshot.shifts.length && <p>Chưa có ca bếp/bảo vệ nào.</p>}</div><form className="staffing-fields staffing-shift-form" onSubmit={(event) => { event.preventDefault(); run(() => createStaffShift(shiftForm), 'Đã phân ca làm việc.'); }}><label>Nhân viên<select required value={shiftForm.employeeId} onChange={(event) => setShiftForm({ ...shiftForm, employeeId: event.target.value })}><option value="">Chọn bếp hoặc bảo vệ</option>{shiftWorkers.map((employee) => <option key={employee._id} value={employee._id}>{employee.fullName} · {employee.userId.role === 'chef' ? 'Bếp' : 'Bảo vệ'}</option>)}</select></label><label>Tên ca<input required maxLength="80" value={shiftForm.name} onChange={(event) => setShiftForm({ ...shiftForm, name: event.target.value })} placeholder="Ca sáng / ca chiều" /></label><label>Bắt đầu<input type="time" required value={shiftForm.startTime} onChange={(event) => setShiftForm({ ...shiftForm, startTime: event.target.value })} /></label><label>Kết thúc<input type="time" required value={shiftForm.endTime} onChange={(event) => setShiftForm({ ...shiftForm, endTime: event.target.value })} /></label><label>Hiệu lực từ<input type="date" required value={shiftForm.validFrom} onChange={(event) => setShiftForm({ ...shiftForm, validFrom: event.target.value })} /></label><label>Đến<input type="date" required min={shiftForm.validFrom} value={shiftForm.validUntil} onChange={(event) => setShiftForm({ ...shiftForm, validUntil: event.target.value })} /></label><div className="staffing-checks staffing-full"><strong>Ngày trực</strong>{days.map(([label, day]) => <label key={day}><input type="checkbox" checked={shiftForm.weekdays.includes(day)} onChange={() => setShiftForm({ ...shiftForm, weekdays: toggleDay(shiftForm.weekdays, day) })} />{label}</label>)}</div><button className="button button-primary" disabled={state.saving}>Thêm ca</button></form></section>
      <section className="content-card staffing-section">
        <div className="card-heading"><div><p className="card-kicker">NGHỈ PHÉP ĐÃ DUYỆT</p><h2>Người thay trong ngày {date}</h2></div></div>
        <div className="staffing-shift-list">
          {snapshot.replacements.map((item) => <article key={item._id}><div><strong>{targetLabel(item) || 'Phân công'}</strong><small>{employeeName(item.absentEmployeeId)} → {employeeName(item.replacementEmployeeId)}</small></div><button className="button button-secondary" disabled={state.saving} onClick={() => window.confirm('Hủy người thay này?') && run(() => cancelStaffReplacement(item._id), 'Đã hủy người thay.')}>Hủy thay thế</button></article>)}
          {!snapshot.replacements.length && <p>Chưa có người thay trong ngày này.</p>}
        </div>
        {!eligibleTargets.length && <div className="staffing-empty-day" role="status">
          <strong>{replacementForm.kind === 'classroom' ? 'Không có lớp học trong ngày đã chọn' : 'Không có ca bếp/bảo vệ trong ngày đã chọn'}</strong>
          <p>{replacementForm.kind === 'classroom'
            ? snapshot.classrooms.length ? 'Lịch hiện tại của các lớp không có buổi học ngày này. Chọn ngày khác hoặc chỉnh lịch học của lớp trước khi phân giáo viên thay.'
              : 'Chưa có lớp đang hoạt động để phân giáo viên thay.'
            : 'Chỉ những ca trực thực sự diễn ra trong ngày này mới có thể phân người thay.'}</p>
          {nextClassDate && <button type="button" className="button button-secondary" onClick={() => changeDate(nextClassDate)}>Xem ngày có lớp gần nhất: {nextClassDate}</button>}
        </div>}
        <form className="staffing-fields staffing-shift-form" onSubmit={(event) => { event.preventDefault(); run(() => createStaffReplacement({ date, kind: replacementForm.kind, classroomId: replacementForm.kind === 'classroom' ? replacementForm.targetId : null, shiftId: replacementForm.kind === 'shift' ? replacementForm.targetId : null, absentEmployeeId: replacementForm.absentEmployeeId, replacementEmployeeId: replacementForm.replacementEmployeeId, note: replacementForm.note }), 'Đã phân người thay.'); }}>
          <label>Loại phân công<select value={replacementForm.kind} onChange={(event) => setTarget(event.target.value, '')}><option value="classroom">Lớp học</option><option value="shift">Ca bếp/bảo vệ</option></select></label>
          <label>{replacementForm.kind === 'classroom' ? 'Lớp' : 'Ca cần thay'}
            <select required disabled={!eligibleTargets.length} value={replacementForm.targetId} onChange={(event) => setTarget(replacementForm.kind, event.target.value)}>
              <option value="">{eligibleTargets.length ? 'Chọn' : 'Không có lịch trong ngày này'}</option>
              {replacementForm.kind === 'classroom'
                ? snapshot.classrooms.map((item) => <option key={item._id} value={item._id} disabled={!item.schoolDay}>{item.name}{item.schoolDay ? '' : ' · Không học ngày này'}</option>)
                : snapshot.duties.map((item) => <option key={item._id} value={item._id}>{item.name} · {item.employeeName}</option>)}
            </select>
          </label>
          <label>Người nghỉ đã được duyệt<select required disabled={!replacementForm.targetId} value={replacementForm.absentEmployeeId} onChange={(event) => setReplacementForm({ ...replacementForm, absentEmployeeId: event.target.value, replacementEmployeeId: '' })}><option value="">{replacementForm.targetId && !absentOptions.length ? 'Không có người nghỉ đã duyệt cho lớp/ca này' : 'Chọn người nghỉ'}</option>{absentOptions.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label>
          <label>Người thay<select required disabled={!absentOptions.length} value={replacementForm.replacementEmployeeId} onChange={(event) => setReplacementForm({ ...replacementForm, replacementEmployeeId: event.target.value })}><option value="">{replacementForm.absentEmployeeId && !replacementCandidates.length ? 'Không còn nhân viên phù hợp và rảnh' : 'Chọn người thay'}</option>{replacementCandidates.filter((employee) => idOf(employee._id) !== replacementForm.absentEmployeeId).map((employee) => <option key={employee._id} value={employee._id}>{employee.fullName}</option>)}</select></label>
          <label className="staffing-full">Ghi chú<input maxLength="500" value={replacementForm.note} onChange={(event) => setReplacementForm({ ...replacementForm, note: event.target.value })} placeholder="Nội dung bàn giao nếu cần" /></label>
          <button className="button button-primary" disabled={state.saving || !eligibleTargets.length || !replacementForm.targetId || !replacementForm.absentEmployeeId || !replacementForm.replacementEmployeeId}>Phân người thay</button>
        </form>
      </section>
    </>}
  </div>;
}
