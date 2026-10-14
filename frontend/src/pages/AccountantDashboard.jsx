import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { getAccountingProcurementOverview, getDebtReport, getFinanceReport, getOperatingExpenses, getPurchaseExpenses } from '../api/finance';
import { getPayroll } from '../api/hr';
import './AccountantDashboard.css';

const currentMonth = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit'
  }).formatToParts(new Date());
  const year = parts.find((item) => item.type === 'year').value;
  const month = parts.find((item) => item.type === 'month').value;
  return `${year}-${month}`;
};
const asPeriod = (month) => `${month.slice(5, 7)}-${month.slice(0, 4)}`;
const money = (amount) => `${new Intl.NumberFormat('vi-VN').format(Number(amount) || 0)} đ`;
const errorText = (error) => error?.response?.data?.message || (error?.response ? 'Không tải được số liệu.' : 'Không kết nối được máy chủ.');

export default function AccountantDashboard() {
  const [month, setMonth] = useState(currentMonth);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState({ loading: true, finance: null, debts: null, payroll: null, procurement: null, expenses: null, operating: null, errors: {} });
  const load = useCallback(async () => {
    setState((old) => ({ ...old, loading: true, errors: {} }));
    const period = asPeriod(month);
    const [year, monthNumber] = month.split('-').map(Number);
    const [finance, debts, payroll, procurement, expenses, operating] = await Promise.allSettled([
      getFinanceReport(period), getDebtReport({ period }), getPayroll({ month: monthNumber, year }), getAccountingProcurementOverview(period), getPurchaseExpenses(period), getOperatingExpenses(month)
    ]);
    setState({
      loading: false,
      finance: finance.status === 'fulfilled' ? finance.value.data.data : null,
      debts: debts.status === 'fulfilled' ? debts.value.data : null,
      payroll: payroll.status === 'fulfilled' ? payroll.value.data.data : null,
      procurement: procurement.status === 'fulfilled' ? procurement.value.data.data : null,
      expenses: expenses.status === 'fulfilled' ? expenses.value.data.summary : null,
      operating: operating.status === 'fulfilled' ? operating.value.data.summary : null,
      errors: {
        ...(finance.status === 'rejected' && { finance: errorText(finance.reason) }),
        ...(debts.status === 'rejected' && { debts: errorText(debts.reason) }),
        ...(payroll.status === 'rejected' && { payroll: errorText(payroll.reason) }),
        ...(procurement.status === 'rejected' && { procurement: errorText(procurement.reason) }),
        ...(expenses.status === 'rejected' && { expenses: errorText(expenses.reason) }),
        ...(operating.status === 'rejected' && { operating: errorText(operating.reason) })
      }
    });
  }, [month]);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load, reloadKey]);

  const payrolls = state.payroll?.payrolls || [];
  const draftCount = payrolls.filter((item) => item.status === 'draft').length;
  const reviewedCount = payrolls.filter((item) => item.status === 'reviewed').length;
  const awaitingPayment = payrolls.filter((item) => item.status === 'confirmed');
  const payableAmount = awaitingPayment.reduce((sum, item) => sum + (Number(item.netSalary) || 0), 0);
  const paidPayrolls = payrolls.filter((item) => item.status === 'paid');
  const paidPayrollAmount = paidPayrolls.reduce((sum, item) => sum + (Number(item.netSalary) || 0), 0);
  const period = asPeriod(month);

  return <AppShell title="Tổng quan kế toán" subtitle="Thu học phí, công nợ và tình trạng chi lương theo kỳ">
    <main className="accounting-dashboard">
      <section className="content-card accounting-toolbar">
        <div><p className="card-kicker">SỔ KẾ TOÁN</p><h2>Kỳ {period}</h2><p>Hóa đơn đã hủy không tính vào số phải thu. Lương nháp chưa được xem là khoản đã chi.</p></div>
        <div className="accounting-toolbar-actions"><label>Chọn tháng<input type="month" value={month} onChange={(event) => { if (event.target.value) setMonth(event.target.value); }} /></label><button type="button" className="button button-secondary" disabled={state.loading} onClick={() => setReloadKey((value) => value + 1)}>Làm mới</button></div>
      </section>

      {state.loading && <section className="content-card accounting-loading">Đang tổng hợp số liệu kỳ {period}...</section>}
      {!state.loading && <>
        <div className="accounting-metrics">
          <article className="content-card"><small>PHẢI THU HỌC PHÍ</small><strong>{state.finance ? money(state.finance.totalAmount) : '—'}</strong><span>{state.finance?.totalInvoices ?? '—'} hóa đơn chưa hủy</span><Link to={`/finance?tab=report&period=${period}`}>Xem báo cáo →</Link></article>
          <article className="content-card"><small>ĐÃ GHI NHẬN THU</small><strong>{state.finance ? money(state.finance.totalPaid) : '—'}</strong><span>Theo các hóa đơn trong kỳ</span><Link to={`/finance?tab=invoices&period=${period}`}>Xem hóa đơn →</Link></article>
          <article className="content-card"><small>CÒN PHẢI THU</small><strong>{state.finance ? money(state.finance.totalRemaining) : '—'}</strong><span>Chưa bao gồm kỳ khác</span><Link to={`/finance?tab=debts&period=${period}`}>Xem công nợ →</Link></article>
          <article className="content-card accounting-metric-warning"><small>NỢ QUÁ HẠN</small><strong>{state.debts ? money(state.debts.summary?.overdueDebt) : '—'}</strong><span>{state.debts?.summary?.invoices ?? '—'} hóa đơn còn nợ trong kỳ</span><Link to={`/finance?tab=debts&period=${period}`}>Xem danh sách →</Link></article>
        </div>
        <Link className="button button-secondary" to="/accounting/cashbook">Mở sổ đối soát thu – chi →</Link>
        <Link className="button button-secondary" to="/accounting/report">Xem báo cáo kế toán →</Link>
        {(state.errors.finance || state.errors.debts) && <p className="accounting-error" role="alert">{state.errors.finance && `Báo cáo thu: ${state.errors.finance}. `}{state.errors.debts && `Công nợ: ${state.errors.debts}.`}</p>}
        <section className="content-card accounting-section">
          <div className="accounting-section-heading"><div><p className="card-kicker">THU HỌC PHÍ</p><h2>Đối chiếu theo lớp</h2></div><Link className="button button-primary" to="/finance">Mở sổ học phí</Link></div>
          {state.finance?.byClass?.length ? <div className="accounting-table-wrap"><table><thead><tr><th>Lớp</th><th>Hóa đơn</th><th>Phải thu</th><th>Đã thu</th><th>Còn lại</th></tr></thead><tbody>{state.finance.byClass.map((item) => <tr key={item._id}><td>{item.className}</td><td>{item.totalStudents}</td><td>{money(item.totalAmount)}</td><td>{money(item.paidAmount)}</td><td>{money(item.totalAmount - item.paidAmount)}</td></tr>)}</tbody></table></div> : <p className="accounting-empty">{state.errors.finance ? 'Chưa tải được báo cáo thu.' : 'Chưa có hóa đơn trong kỳ này.'}</p>}
        </section>
        <section className="content-card accounting-section">
          <div className="accounting-section-heading"><div><p className="card-kicker">ĐỀ XUẤT & ĐẶT HÀNG</p><h2>Khoản dự kiến cần theo dõi</h2></div><Link className="button button-secondary" to="/accounting/expenses">Mở sổ chi mua sắm</Link></div>
          {state.errors.procurement ? <p className="accounting-error" role="alert">{state.errors.procurement}</p> : <><div className="accounting-procurement-summary"><div><small>Đề xuất đang chờ duyệt</small><strong>{state.procurement?.requests?.length || 0}</strong><span>Ước tính {money(state.procurement?.pendingEstimate)}</span></div><div><small>Đơn đã đặt, chờ giao</small><strong>{state.procurement?.orders?.length || 0}</strong><span>Giá trị đặt {money(state.procurement?.orderedCommitment)}</span></div></div><p className="accounting-footnote">Đây là nhu cầu/đơn đặt trong kỳ, chưa phải khoản đã thanh toán. Không cộng các số này vào “đã chi”.</p><div className="accounting-table-wrap"><table><thead><tr><th>Nguồn</th><th>Người đề xuất / Nhà cung cấp</th><th>Trạng thái</th><th>Giá trị dự kiến</th></tr></thead><tbody>{state.procurement?.requests?.map((item) => <tr key={item._id}><td>Đề xuất · {new Date(item.createdAt).toLocaleDateString('vi-VN')}</td><td>{item.requesterName}</td><td>{item.status === 'approved_l1' ? 'Đã duyệt bước 1' : 'Chờ duyệt'}</td><td>{money(item.totalEstimatedCost)}</td></tr>)}{state.procurement?.orders?.map((item) => <tr key={item._id}><td>Đơn {item.orderCode}</td><td>{item.supplierName}</td><td>Đã đặt, chờ giao</td><td>{money(item.totalAmount)}</td></tr>)}{!state.procurement?.requests?.length && !state.procurement?.orders?.length && <tr><td colSpan="4">Không có đề xuất chờ duyệt hoặc đơn chờ giao trong kỳ.</td></tr>}</tbody></table></div></>}
        </section>
        <section className="content-card accounting-section">
          <div className="accounting-section-heading"><div><p className="card-kicker">THỰC CHI</p><h2>Chi mua sắm đã ghi nhận kỳ {period}</h2></div><Link className="button button-secondary" to="/accounting/expenses">Xem chứng từ</Link></div>
          {state.errors.expenses ? <p className="accounting-error" role="alert">Sổ chi: {state.errors.expenses}</p> : <div className="accounting-expense-total"><strong>{money(state.expenses?.total)}</strong><span>{state.expenses?.count || 0} chứng từ đã ghi nhận. Không bao gồm lương hoặc khoản chi ngoài đơn mua sắm.</span></div>}
        </section>
        <section className="content-card accounting-section">
          <div className="accounting-section-heading"><div><p className="card-kicker">THỰC CHI</p><h2>Chi vận hành tháng {month.slice(5, 7)}/{month.slice(0, 4)}</h2></div><Link className="button button-secondary" to="/accounting/operating-expenses">Mở sổ chi vận hành</Link></div>
          {state.errors.operating ? <p className="accounting-error" role="alert">Sổ chi vận hành: {state.errors.operating}</p> : <div className="accounting-expense-total"><strong>{money(state.operating?.total)}</strong><span>{state.operating?.count || 0} chứng từ đã ghi nhận. Đã đưa vào sổ đối soát và báo cáo kế toán.</span></div>}
        </section>
        <section className="content-card accounting-section">
          <div className="accounting-section-heading"><div><p className="card-kicker">BẢNG LƯƠNG</p><h2>Việc kế toán cần theo dõi</h2></div><Link className="button button-secondary" to="/hr?tab=payroll">Mở bảng lương</Link></div>
          {state.errors.payroll ? <p className="accounting-error" role="alert">Bảng lương: {state.errors.payroll}</p> : <><div className="accounting-payroll-grid"><div><small>Nháp cần đối soát</small><strong>{draftCount}</strong></div><div><small>Chờ hiệu trưởng xác nhận</small><strong>{reviewedCount}</strong></div><div><small>Đã duyệt, chờ chi</small><strong>{awaitingPayment.length}</strong><span>{money(payableAmount)}</span></div><div><small>Phiếu kỳ này đã chi</small><strong>{paidPayrolls.length}</strong><span>{money(paidPayrollAmount)}</span></div><div><small>Cần kiểm tra mức lương</small><strong>{state.payroll?.summary?.salaryReviewCount || 0}</strong></div></div><p className="accounting-footnote">Kế toán đối soát bản nháp; hiệu trưởng xác nhận; chỉ sau đó kế toán mới ghi nhận đã chi. Số đã chi ở đây tính theo kỳ lương, có thể khác tháng tiền thực tế được chuyển.</p></>}
        </section>
      </>}
    </main>
  </AppShell>;
}
