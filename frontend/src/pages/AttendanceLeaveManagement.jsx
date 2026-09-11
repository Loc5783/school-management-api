/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getLeaveRequests, reviewLeaveRequest } from '../api/attendance';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';

const dateText = (value) => value ? new Date(value).toLocaleDateString('vi-VN') : '—';
const text = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối', cancelled: 'Đã hủy' };

export default function AttendanceLeaveManagement() {
  const [requests, setRequests] = useState([]); const [status, setStatus] = useState('pending'); const [state, setState] = useState({ loading: true, error: '' }); const [workingId, setWorkingId] = useState('');
  const role = JSON.parse(localStorage.getItem('user') || '{}').role; const canReview = ['admin', 'principal'].includes(role);
  const load = async () => { setState({ loading: true, error: '' }); try { const res = await getLeaveRequests(status ? { status } : {}); setRequests(res.data.data || []); setState({ loading: false, error: '' }); } catch (err) { setState({ loading: false, error: err.response?.data?.message || 'Không thể tải đơn xin nghỉ.' }); } };
  useEffect(() => { load(); }, [status]);
  const review = async (item, decision) => { const reviewNote = window.prompt(decision === 'approved' ? 'Ghi chú cho phụ huynh (có thể để trống):' : 'Lý do từ chối (có thể để trống):', '') ?? null; if (reviewNote === null) return; setWorkingId(item._id); try { await reviewLeaveRequest(item._id, { decision, reviewNote }); await load(); } catch (err) { setState((old) => ({ ...old, error: err.response?.data?.message || 'Không thể xử lý đơn.' })); } finally { setWorkingId(''); } };
  return <AppShell title="Duyệt đơn xin nghỉ" subtitle="Duyệt đơn của phụ huynh; hệ thống tự ghi nhận nghỉ có phép vào điểm danh.">
    {state.error && <div className="form-error">{state.error}</div>}<section className="content-card student-list-card"><div className="list-toolbar"><div><p className="card-kicker">ĐƠN XIN NGHỈ</p><h2>Danh sách cần xử lý</h2></div><Link to="/attendance" className="button button-secondary"><Icon name="arrowLeft" size={16} />Điểm danh theo lớp</Link></div><div className="student-filter-grid"><label>Trạng thái<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="pending">Chờ duyệt</option><option value="approved">Đã duyệt</option><option value="rejected">Từ chối</option><option value="">Tất cả</option></select></label></div>{state.loading ? <div className="inline-loader"><span className="loading-orb" />Đang tải...</div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Học sinh</th><th>Thời gian</th><th>Lý do</th><th>Phụ huynh</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{requests.length ? requests.map((item) => <tr key={item._id}><td>{item.studentName}<small>{item.className}</small></td><td>{dateText(item.startDate)} – {dateText(item.endDate)}</td><td>{item.reason}<small>{item.reviewNote}</small></td><td>{item.requesterName}</td><td><span className={`student-status ${item.status === 'approved' ? 'enrolled' : item.status === 'pending' ? 'temporarily_absent' : 'withdrawn'}`}>{text[item.status]}</span></td><td>{canReview && item.status === 'pending' ? <div className="toolbar-buttons"><button className="button button-primary" disabled={workingId === item._id} onClick={() => review(item, 'approved')}>Duyệt</button><button className="button button-secondary" disabled={workingId === item._id} onClick={() => review(item, 'rejected')}>Từ chối</button></div> : '—'}</td></tr>) : <tr><td colSpan="6">Không có đơn phù hợp.</td></tr>}</tbody></table></div>}</section>
  </AppShell>;
}
