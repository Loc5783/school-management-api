/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import api from '../api/axiosConfig';

const dateText = (value) => value ? new Date(value).toLocaleDateString('vi-VN') : '—';

export default function ParentCare() {
  const [children, setChildren] = useState([]); const [selectedId, setSelectedId] = useState('');
  const [reports, setReports] = useState([]); const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, error: '' });
  const selected = useMemo(() => children.find((item) => item._id === selectedId), [children, selectedId]);

  const loadChildren = useCallback(async () => { try {
    const response = await api.get('/students', { params: { status: 'all', limit: 100, sortBy: 'fullName' } });
    const items = response.data.data || []; setChildren(items); setSelectedId((current) => current || items[0]?._id || '');
  } catch (error) { setState({ loading: false, error: error.response?.data?.message || 'Không thể tải danh sách con.' }); } }, []);
  const loadReports = useCallback(async () => { if (!selected) return; setState({ loading: true, error: '' }); try {
    const response = await api.get('/class-communication/care-reports', { params: { classroomId: selected.classroomId } });
    setReports(response.data.data || []); setPage(1); setState({ loading: false, error: '' });
  } catch (error) { setState({ loading: false, error: error.response?.data?.message || 'Không thể tải sổ chăm sóc.' }); } }, [selected]);
  useEffect(() => { loadChildren(); }, [loadChildren]); useEffect(() => { loadReports(); }, [loadReports]);

  const pageSize = 6; const totalPages = Math.max(1, Math.ceil(reports.length / pageSize));
  const visibleReports = reports.slice((page - 1) * pageSize, page * pageSize);
  const privateCount = reports.reduce((sum, report) => sum + (report.studentNotes?.length || 0), 0);

  return <AppShell title="Sổ chăm sóc của con" subtitle="Theo dõi hoạt động, ăn uống, giấc ngủ, sức khỏe và những lưu ý riêng từ giáo viên.">
    {state.error && <div className="form-error">{state.error}</div>}
    {children.length > 1 && <section className="parent-child-switcher">{children.map((child) => <button key={child._id} className={child._id === selectedId ? 'active' : ''} onClick={() => setSelectedId(child._id)}><span className="student-avatar">{child.fullName?.charAt(0) || 'B'}</span><span><strong>{child.fullName}</strong><small>{child.currentClassName || 'Chưa xếp lớp'}</small></span></button>)}</section>}
    {!selected && !state.loading ? <div className="empty-state"><Icon name="students" /><strong>Chưa có học sinh được liên kết</strong><p>Vui lòng liên hệ nhà trường để xác minh tài khoản phụ huynh.</p></div> : <>
      <section className="parent-care-hero"><div><p className="card-kicker">THEO DÕI HẰNG NGÀY</p><h2>{selected?.fullName || 'Học sinh'}</h2><p>{selected?.currentClassName || 'Chưa xếp lớp'} · Dữ liệu do giáo viên phụ trách cập nhật</p></div><div><span><b>{reports.length}</b> ngày đã nhận</span><span className={privateCount ? 'has-private' : ''}><b>{privateCount}</b> lưu ý riêng</span></div></section>
      <section className="content-card parent-care-page"><div className="card-heading"><div><p className="card-kicker">LỊCH SỬ CHĂM SÓC</p><h2>Nhận xét gần đây</h2></div><span className="history-count">Mới nhất trước</span></div>{state.loading ? <div className="inline-loader"><span className="loading-orb" />Đang tải sổ chăm sóc...</div> : visibleReports.length ? <div className="parent-care-timeline">{visibleReports.map((report) => <article key={report._id}><aside><span>{new Date(report.reportDate).getDate()}</span><small>Tháng {new Date(report.reportDate).getMonth() + 1}</small></aside><div><header><div><strong>{dateText(report.reportDate)}</strong><small>{report.recordedByName || 'Giáo viên'} · {report.className}</small></div>{report.studentNotes?.length > 0 && <span className="care-private-badge">Có lưu ý riêng</span>}</header><div className="parent-care-details">{report.activities && <p><Icon name="classes" size={15} /><span><b>Hoạt động</b>{report.activities}</span></p>}{report.meals && <p><Icon name="utensils" size={15} /><span><b>Ăn uống</b>{report.meals}</span></p>}{report.sleep && <p><Icon name="clock" size={15} /><span><b>Giấc ngủ</b>{report.sleep}</span></p>}{report.health && <p><Icon name="attendance" size={15} /><span><b>Sức khỏe</b>{report.health}</span></p>}</div>{report.studentNotes?.map((note) => <div className="parent-care-private" key={note._id || note.studentId}><strong>Lưu ý riêng về {note.studentName}</strong><p>{note.note}</p></div>)}</div></article>)}</div> : <div className="empty-state compact">Giáo viên chưa gửi sổ chăm sóc cho lớp.</div>}{totalPages > 1 && <nav className="student-pagination"><span>Hiển thị {visibleReports.length} / {reports.length} ngày</span><div><button className="button button-secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Trước</button><b>Trang {page}/{totalPages}</b><button className="button button-secondary" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Sau</button></div></nav>}</section>
    </>}
  </AppShell>;
}
