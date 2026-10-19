import { useCallback, useEffect, useState } from 'react';
import { getOvertimeRates, getOvertimeRequests, reviewOvertimeRequest, setOvertimeRate } from '../api/timekeeping';

const status = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' };
const current = new Date();
export default function OvertimeManagement({ employees, canApprove }) {
  const [period, setPeriod] = useState({ month: current.getMonth() + 1, year: current.getFullYear() });
  const [requests, setRequests] = useState([]);
  const [rates, setRates] = useState([]);
  const [rateForm, setRateForm] = useState({ employeeId: '', hourlyAmount: '', reason: '' });
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => { try { const [requestResult, rateResult] = await Promise.all([getOvertimeRequests(), getOvertimeRates(period.month, period.year)]); setRequests(requestResult.data.data || []); setRates(rateResult.data.data || []); } catch (error) { setNotice(error.response?.data?.message || 'Không tải được dữ liệu làm thêm.'); } }, [period.month, period.year]);
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, [load]);
  const saveRate = async (event) => {
    event.preventDefault(); setNotice('');
    try { await setOvertimeRate(rateForm.employeeId, { ...period, hourlyAmount: Number(rateForm.hourlyAmount), reason: rateForm.reason }); setNotice('Đã lưu đơn giá làm thêm. Hãy tạo lại bảng lương nháp để cập nhật tiền làm thêm.'); setRateForm({ employeeId: '', hourlyAmount: '', reason: '' }); await load(); }
    catch (error) { setNotice(error.response?.data?.message || 'Không lưu được đơn giá.'); }
  };
  const review = async (item, decision) => {
    const input = decision === 'approved' ? window.prompt(`Duyệt tối đa ${item.requestedMinutes} phút; nhập số phút được xác nhận:`, String(item.requestedMinutes)) : window.prompt('Nhập lý do từ chối:');
    if (input === null) return;
    try { await reviewOvertimeRequest(item._id, decision === 'approved' ? { decision, approvedMinutes: Number(input) } : { decision, reviewNote: input }); setNotice(decision === 'approved' ? 'Đã duyệt làm thêm. Tạo lại bảng lương nháp để cập nhật.' : 'Đã từ chối yêu cầu.'); await load(); }
    catch (error) { setNotice(error.response?.data?.message || 'Không xử lý được yêu cầu.'); }
  };
  return <section className="content-card student-list-card" style={{ marginBottom: 20 }}><div className="card-heading"><div><p className="card-kicker">XÁC NHẬN LÀM THÊM</p><h2>Yêu cầu & đơn giá</h2><p>HR đặt mức tiền/giờ theo nhân viên và tháng. Ban giám hiệu duyệt số phút; không ai tự duyệt yêu cầu của mình.</p></div></div>
    {notice && <p className="timekeeping-notice">{notice}</p>}
    <div className="table-wrap"><table className="data-table"><thead><tr><th>Nhân viên</th><th>Ngày</th><th>Đề nghị</th><th>Đã duyệt</th><th>Lý do / phản hồi</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{requests.map((item) => <tr key={item._id}><td>{item.employeeId?.fullName || 'Nhân viên'}</td><td>{item.workDate}</td><td>{item.requestedMinutes} phút</td><td>{item.approvedMinutes || 0} phút</td><td>{item.reason}{item.reviewNote && <small>{item.reviewNote}</small>}</td><td>{status[item.status] || item.status}</td><td>{canApprove && item.status === 'pending' ? <div className="classroom-actions"><button className="button button-primary" onClick={() => review(item, 'approved')}>Duyệt</button><button className="button button-secondary" onClick={() => review(item, 'rejected')}>Từ chối</button></div> : '—'}</td></tr>)}{!requests.length && <tr><td colSpan="7" className="history-empty">Chưa có yêu cầu làm thêm.</td></tr>}</tbody></table></div>
    <form className="student-form-grid" onSubmit={saveRate} style={{ padding: 20 }}><label>Tháng<input type="number" min="1" max="12" value={period.month} onChange={(event) => setPeriod({ ...period, month: Number(event.target.value) })} required /></label><label>Năm<input type="number" min="2000" max="2100" value={period.year} onChange={(event) => setPeriod({ ...period, year: Number(event.target.value) })} required /></label><label>Nhân viên<select value={rateForm.employeeId} onChange={(event) => setRateForm({ ...rateForm, employeeId: event.target.value })} required><option value="">Chọn nhân viên</option>{employees.filter((employee) => employee.status === 'active' && ['chef', 'guard'].includes(employee.payrollRole)).map((employee) => <option value={employee._id} key={employee._id}>{employee.fullName} · {employee.employeeCode}</option>)}</select></label><label>Mức tiền/giờ (VND)<input type="number" min="0" max="10000000" value={rateForm.hourlyAmount} onChange={(event) => setRateForm({ ...rateForm, hourlyAmount: event.target.value })} required /></label><label className="form-wide">Căn cứ đặt mức<textarea minLength="5" maxLength="500" value={rateForm.reason} onChange={(event) => setRateForm({ ...rateForm, reason: event.target.value })} required /></label><button className="button button-primary">Lưu mức làm thêm</button></form>
    <div className="table-wrap"><table className="data-table"><thead><tr><th>Nhân viên</th><th>Kỳ lương</th><th>Mức tiền/giờ</th><th>Căn cứ</th></tr></thead><tbody>{rates.map((item) => <tr key={item._id}><td>{item.employeeId?.fullName || 'Nhân viên'}</td><td>{item.month}/{item.year}</td><td>{Number(item.hourlyAmount).toLocaleString('vi-VN')} đ</td><td>{item.reason}</td></tr>)}{!rates.length && <tr><td colSpan="4" className="history-empty">Chưa thiết lập đơn giá cho kỳ này.</td></tr>}</tbody></table></div>
  </section>;
}
