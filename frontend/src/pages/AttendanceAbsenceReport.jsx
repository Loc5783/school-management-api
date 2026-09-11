/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axiosConfig';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';

const workDate = (offset = 0) => { const date = new Date(); date.setDate(date.getDate() + offset); return date.toISOString().slice(0, 10); };

export default function AttendanceAbsenceReport() {
  const [filters, setFilters] = useState({ startDate: workDate(-29), endDate: workDate(), classroomId: '' });
  const [classrooms, setClassrooms] = useState([]); const [report, setReport] = useState(null); const [state, setState] = useState({ loading: true, error: '' });
  const load = async () => { setState({ loading: true, error: '' }); try { const [classesRes, reportRes] = await Promise.all([api.get('/classrooms'), api.get('/attendance/reports/absence', { params: filters })]); setClassrooms(classesRes.data.data || []); setReport(reportRes.data.data); setState({ loading: false, error: '' }); } catch (err) { setState({ loading: false, error: err.response?.data?.message || 'Không thể lập báo cáo.' }); } };
  useEffect(() => { load(); }, []);
  return <AppShell title="Báo cáo vắng mặt" subtitle="Theo dõi nghỉ không phép, nghỉ có phép và đi muộn theo khoảng thời gian.">
    {state.error && <div className="form-error">{state.error}</div>}
    <section className="content-card student-list-card"><div className="list-toolbar"><div><p className="card-kicker">BÁO CÁO ĐIỂM DANH</p><h2>Tổng hợp tình hình chuyên cần</h2></div><Link to="/attendance" className="button button-secondary"><Icon name="arrowLeft" size={16} />Điểm danh theo lớp</Link></div>
      <div className="student-filter-grid"><label>Từ ngày<input type="date" value={filters.startDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value })} /></label><label>Đến ngày<input type="date" value={filters.endDate} onChange={(e) => setFilters({ ...filters, endDate: e.target.value })} /></label><label>Lớp học<select value={filters.classroomId} onChange={(e) => setFilters({ ...filters, classroomId: e.target.value })}><option value="">Tất cả lớp được phân quyền</option>{classrooms.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label><button className="button button-primary" onClick={load} disabled={state.loading}><Icon name="search" size={17} />Xem báo cáo</button></div>
      {state.loading ? <div className="inline-loader"><span className="loading-orb" />Đang tổng hợp...</div> : <><div className="parent-summary-grid"><article><div><small>Vắng không phép</small><strong>{report?.totals?.absent || 0} lượt</strong></div></article><article><div><small>Nghỉ có phép</small><strong>{report?.totals?.permitted || 0} lượt</strong></div></article><article><div><small>Đi muộn</small><strong>{report?.totals?.late || 0} lượt</strong></div></article></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Học sinh</th><th>Lớp</th><th>Vắng</th><th>Có phép</th><th>Muộn</th><th>Tổng lượt</th></tr></thead><tbody>{report?.students?.length ? report.students.map((item) => <tr key={item.studentId}><td>{item.studentName}</td><td>{item.className}</td><td>{item.absent}</td><td>{item.permitted}</td><td>{item.late}</td><td><b>{item.total}</b></td></tr>) : <tr><td colSpan="6">Không có lượt vắng hoặc đi muộn trong khoảng đã chọn.</td></tr>}</tbody></table></div></>}
    </section>
  </AppShell>;
}
