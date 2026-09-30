import { useCallback, useEffect, useState } from 'react';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import { getMyPayroll } from '../api/hr';

const money = (value) => `${new Intl.NumberFormat('vi-VN').format(Number(value || 0))} đ`;
const statusText = { draft: 'Bản nháp', confirmed: 'Đã xác nhận', paid: 'Đã chi trả' };

export default function MyPayroll() {
  const today = new Date();
  const [period, setPeriod] = useState({ month: today.getMonth() + 1, year: today.getFullYear() });
  const [data, setData] = useState(null);
  const [state, setState] = useState({ loading: true, error: '' });

  const load = useCallback(async () => {
    setState({ loading: true, error: '' });
    try {
      const response = await getMyPayroll(period);
      setData(response.data.data);
      setState({ loading: false, error: '' });
    } catch (error) {
      setData(null);
      setState({ loading: false, error: error.response?.data?.message || 'Không thể tải phiếu lương cá nhân.' });
    }
  }, [period]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(initialLoad);
  }, [load]);
  const payroll = data?.payroll;
  const allowanceTotal = Number(payroll?.allowances?.position || 0) + Number(payroll?.allowances?.lunch || 0) + Number(payroll?.allowances?.other || 0);
  const deductionTotal = Number(payroll?.deductions?.insurance || 0) + Number(payroll?.deductions?.advancePayment || 0) + Number(payroll?.deductions?.other || 0);

  return <AppShell title="Lương của tôi" subtitle="Theo dõi phiếu lương cá nhân theo từng tháng. Chỉ bạn có thể xem dữ liệu này.">
    <section className="content-card student-list-card">
      <div className="list-toolbar"><div><p className="card-kicker">PHIẾU LƯƠNG CÁ NHÂN</p><h2>{data?.employee?.fullName || 'Tra cứu phiếu lương'}</h2><p>{data?.employee?.employeeCode ? `${data.employee.employeeCode} · ${data.employee.payrollRole || data.employee.position}` : 'Chọn kỳ lương để xem dữ liệu đã được lập.'}</p></div><div className="toolbar-buttons"><label>Kỳ lương<select aria-label="Tháng lương" value={period.month} onChange={(event) => setPeriod((old) => ({ ...old, month: Number(event.target.value) }))}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{String(index + 1).padStart(2, '0')}</option>)}</select></label><label>Năm<input type="number" min="2000" max="2100" value={period.year} onChange={(event) => setPeriod((old) => ({ ...old, year: Number(event.target.value) }))} /></label><button className="button button-primary" onClick={load} disabled={state.loading}><Icon name="search" size={17} />Xem phiếu</button></div></div>
      {state.loading ? <div className="inline-loader"><span className="loading-orb" />Đang tải phiếu lương...</div> : state.error ? <div className="empty-state error"><strong>{state.error}</strong><p>HR cần liên kết hồ sơ nhân sự trước khi có thể lập và xem bảng lương.</p></div> : !payroll ? <div className="empty-state"><span className="empty-icon"><Icon name="money" /></span><strong>Chưa có phiếu lương tháng {period.month}/{period.year}</strong><p>Phiếu lương chỉ xuất hiện sau khi bộ phận HR/Kế toán lập bảng lương cho kỳ này.</p></div> : <div className="payroll-self-view"><div className="parent-summary-grid"><article><div><small>Thực nhận</small><strong>{money(payroll.netSalary)}</strong></div></article><article><div><small>Tổng thu nhập</small><strong>{money(payroll.grossSalary)}</strong></div></article><article><div><small>Tổng khấu trừ</small><strong>{money(deductionTotal)}</strong></div></article><article><div><small>Trạng thái</small><strong>{statusText[payroll.status] || payroll.status}</strong></div></article></div><div className="table-wrap"><table className="data-table"><tbody><tr><th colSpan="2">Chi tiết ngày công</th></tr><tr><td>Lương cơ bản</td><td><b>{money(payroll.baseSalary)}</b></td></tr><tr><td>Công thực tế / công chuẩn</td><td>{payroll.actualWorkDays || 0} / {payroll.standardWorkDays || 26} công {payroll.paidLeaveDays ? `· ${payroll.paidLeaveDays} ngày nghỉ hưởng lương` : ''}</td></tr><tr><th colSpan="2">Phụ cấp</th></tr><tr><td>Chức vụ + ăn trưa + khác</td><td>{money(allowanceTotal)}</td></tr><tr><th colSpan="2">Khấu trừ</th></tr><tr><td>Bảo hiểm</td><td>{money(payroll.deductions?.insurance)}</td></tr><tr><td>Tạm ứng + khác</td><td>{money(Number(payroll.deductions?.advancePayment || 0) + Number(payroll.deductions?.other || 0))}</td></tr><tr><th>Thực nhận</th><th>{money(payroll.netSalary)}</th></tr></tbody></table></div>{payroll.note && <p className="field-help"><b>Ghi chú từ HR/Kế toán:</b> {payroll.note}</p>}</div>}
    </section>
  </AppShell>;
}
