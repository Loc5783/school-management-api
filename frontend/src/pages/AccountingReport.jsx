import { useCallback, useEffect, useState } from 'react';
import AppShell from '../components/AppShell';
import { getAccountingReport, getAccountingPeriod, closeAccountingPeriod, reopenAccountingPeriod } from '../api/finance';
import './AccountingReport.css';

const currentMonth = () => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return `${parts.find((item) => item.type === 'year').value}-${parts.find((item) => item.type === 'month').value}`;
};
const money = (value) => `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)} đ`;
const statusText = { matched: 'Khớp số', difference: 'Chênh lệch', stale: 'Sổ thay đổi', needs_review: 'Cần rà chứng từ', not_recorded: 'Chưa đối soát' };
const csvCell = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const safe = String(value ?? '').replaceAll('"', '""');
  return `"${/^[\s]*[=+@-]/.test(safe) ? `'${safe}` : safe}"`;
};

export default function AccountingReport() {
  const [month, setMonth] = useState(currentMonth);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [periodState, setPeriodState] = useState(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const role = JSON.parse(localStorage.getItem('user') || '{}').role;
  const canClose = ['admin', 'principal'].includes(role);
  const load = useCallback(async () => {
    setLoading(true);
    try { const [summary, period] = await Promise.all([getAccountingReport(month), getAccountingPeriod(month)]); setReport(summary.data.data); setPeriodState(period.data.data); setError(''); }
    catch (requestError) { setReport(null); setPeriodState(null); setError(requestError.response?.data?.message || 'Không tải được báo cáo kế toán.'); }
    finally { setLoading(false); }
  }, [month]);
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, [load]);

  const changePeriod = async () => {
    if (reason.trim().length < 10) { setError('Cần nhập căn cứ hoặc lý do ít nhất 10 ký tự.'); return; }
    const closing = periodState?.status !== 'closed';
    if (!window.confirm(closing ? `Chốt kỳ ${month}? Chỉ có thể sửa dữ liệu kỳ này sau khi mở lại.` : `Mở lại kỳ ${month}? Thao tác sẽ được lưu lịch sử.`)) return;
    setSubmitting(true);
    try {
      if (closing) await closeAccountingPeriod(month, reason.trim());
      else await reopenAccountingPeriod(month, reason.trim());
      setReason(''); await load();
    } catch (requestError) { setError(requestError.response?.data?.message || 'Không thể cập nhật trạng thái kỳ.'); }
    finally { setSubmitting(false); }
  };

  const downloadCsv = () => {
    if (!report) return;
    const rows = [
      ['Báo cáo kế toán', report.month],
      ['Phải thu hóa đơn kỳ', report.invoicePeriod.billed],
      ['Đã thu cho hóa đơn kỳ đến hiện tại', report.invoicePeriod.paidToDate],
      ['Còn phải thu hóa đơn kỳ', report.invoicePeriod.remaining],
      ['Thu học phí thực ghi trong tháng', report.cashFlow.tuitionIncome],
      ['Hoàn học phí thực ghi trong tháng', report.cashFlow.tuitionRefundOutflow],
      ['Chi mua sắm thực ghi trong tháng', report.cashFlow.purchaseOutflow],
      ['Chi vận hành thực ghi trong tháng', report.cashFlow.operatingOutflow],
      ['Chi lương thực ghi trong tháng', report.cashFlow.payrollOutflow],
      ['Chênh lệch thu - chi đã ghi sổ (không phải lợi nhuận)', report.cashFlow.recordedNet],
      [], ['Lớp', 'Số hóa đơn', 'Phải thu', 'Đã thu đến hiện tại', 'Còn phải thu'],
      ...report.invoicePeriod.byClass.map((item) => [item.className, item.invoices, item.billed, item.paidToDate, item.remaining]),
      [], ['Ngày', 'Thu tiền mặt', 'Thu ngân hàng', 'Thu ví', 'Chi tiền mặt', 'Chi ngân hàng', 'Chi ví', 'Chưa rõ phương thức', 'Số chứng từ cần rà'],
      ...report.cashFlow.daily.map((item) => [item.workDate, item.cashIn, item.bankIn, item.walletIn, item.cashOut, item.bankOut, item.walletOut, item.unknownAmount, item.issues])
    ];
    const blob = new Blob([`\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `bao-cao-ke-toan-${report.month}.csv`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <AppShell title="Báo cáo kế toán" subtitle="Báo cáo theo kỳ hóa đơn, kỳ lương và dòng tiền đã ghi nhận.">
    <div className="accounting-report">
      <section className="content-card accounting-report-toolbar"><div><p className="card-kicker">BÁO CÁO TỔNG HỢP</p><h2>Tháng {month.slice(5, 7)}/{month.slice(0, 4)}</h2><p>Số “đã thu cho hóa đơn kỳ” là lũy kế đến lúc xem báo cáo; dòng tiền chỉ tính giao dịch phát sinh trong tháng.</p></div><div className="accounting-report-actions"><label>Chọn tháng<input type="month" value={month} onChange={(event) => { if (event.target.value) setMonth(event.target.value); }} /></label><button type="button" className="button button-secondary" onClick={load} disabled={loading}>Làm mới</button><button type="button" className="button button-primary" onClick={downloadCsv} disabled={!report || loading}>Tải CSV</button></div></section>
      {error && <div className="form-error" role="alert">{error}</div>}{loading && <section className="content-card accounting-report-loading">Đang tổng hợp báo cáo...</section>}
      {!loading && report && <>
        <section className="content-card accounting-report-period"><div><p className="card-kicker">CHỐT KỲ VÀ NHẬT KÝ</p><h2>{periodState?.status === 'closed' ? 'Kỳ đã chốt' : 'Kỳ đang mở'}</h2><p>{periodState?.status === 'closed' ? 'Ảnh chụp lúc chốt được giữ trong lịch sử. Khoản thu nợ kỳ cũ ghi vào tháng thực thu; không sửa hóa đơn kỳ đã chốt.' : 'Chỉ chốt sau khi tháng kết thúc, đối soát khớp và hoàn tất chi lương.'}</p>{periodState?.sourceChanged && <p className="accounting-report-warning">Dữ liệu nguồn của kỳ đã thay đổi so với lúc chốt. Cần rà soát.</p>}</div>{canClose && <div className="accounting-report-period-action"><label>Căn cứ / lý do<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="Nhập ít nhất 10 ký tự" /></label><button type="button" className="button button-secondary" disabled={submitting} onClick={changePeriod}>{submitting ? 'Đang xử lý...' : periodState?.status === 'closed' ? 'Mở lại kỳ' : 'Chốt kỳ'}</button></div>}<div className="accounting-report-history"><strong>Lịch sử thao tác</strong>{periodState?.history?.length ? [...periodState.history].reverse().map((entry, index) => <p key={`${entry.revision}-${index}`}>{entry.action === 'closed' ? 'Chốt kỳ' : 'Mở lại'} · {entry.actorName} · {new Date(entry.at).toLocaleString('vi-VN')} · {entry.reason}</p>) : <p>Chưa có thao tác chốt kỳ.</p>}</div></section>
        <section className="content-card accounting-report-section"><div className="card-heading"><div><p className="card-kicker">HÓA ĐƠN THUỘC KỲ</p><h2>Học phí kỳ {report.period}</h2><p>{report.invoicePeriod.count} hóa đơn chưa hủy. Công nợ được tính theo trạng thái hiện tại, không phải ảnh chụp cuối tháng.</p></div></div><div className="accounting-report-metrics">{[['Phải thu', report.invoicePeriod.billed], ['Đã thu đến hiện tại', report.invoicePeriod.paidToDate], ['Còn phải thu', report.invoicePeriod.remaining], ['Trong đó quá hạn', report.invoicePeriod.overdue]].map(([label, value]) => <div key={label}><small>{label}</small><strong>{money(value)}</strong></div>)}</div><div className="table-wrap"><table className="data-table"><thead><tr><th>Lớp</th><th>Hóa đơn</th><th>Phải thu</th><th>Đã thu đến hiện tại</th><th>Còn phải thu</th></tr></thead><tbody>{report.invoicePeriod.byClass.map((item) => <tr key={item.classroomId}><td>{item.className}</td><td>{item.invoices}</td><td>{money(item.billed)}</td><td>{money(item.paidToDate)}</td><td>{money(item.remaining)}</td></tr>)}{!report.invoicePeriod.byClass.length && <tr><td colSpan="5">Chưa có hóa đơn kỳ này.</td></tr>}</tbody></table></div></section>
        <section className="content-card accounting-report-section"><div className="card-heading"><div><p className="card-kicker">DÒNG TIỀN TRONG THÁNG</p><h2>Thu – chi đã ghi sổ</h2><p>Không phải lợi nhuận: chưa bao gồm khoản ngoài hệ thống, thuế hoặc điều chỉnh ngân hàng.</p></div></div><div className="accounting-report-metrics">{[['Thu học phí', report.cashFlow.tuitionIncome], ['Hoàn học phí', report.cashFlow.tuitionRefundOutflow], ['Chi mua sắm', report.cashFlow.purchaseOutflow], ['Chi vận hành', report.cashFlow.operatingOutflow], ['Chi lương', report.cashFlow.payrollOutflow], ['Chênh lệch ghi sổ', report.cashFlow.recordedNet]].map(([label, value]) => <div key={label}><small>{label}</small><strong>{money(value)}</strong></div>)}</div><div className="accounting-report-methods"><div>Tiền mặt: thu {money(report.cashFlow.byMethod.cashIn)} · chi {money(report.cashFlow.byMethod.cashOut)}</div><div>Chuyển khoản: thu {money(report.cashFlow.byMethod.bankIn)} · chi {money(report.cashFlow.byMethod.bankOut)}</div><div>Ví điện tử: thu {money(report.cashFlow.byMethod.walletIn)} · chi {money(report.cashFlow.byMethod.walletOut)}</div></div>{(report.cashFlow.byMethod.issues > 0 || report.cashFlow.byMethod.unknownAmount > 0) && <p className="accounting-report-warning">{report.cashFlow.byMethod.issues} chứng từ cần rà; {money(report.cashFlow.byMethod.unknownAmount)} chưa xác định phương thức.</p>}</section>
        <section className="content-card accounting-report-section"><div className="card-heading"><div><p className="card-kicker">BẢNG LƯƠNG THUỘC KỲ</p><h2>Tình trạng lương tháng {month.slice(5, 7)}/{month.slice(0, 4)}</h2><p>{report.payrollPeriod.count} phiếu · Tổng thực nhận dự kiến {money(report.payrollPeriod.totalNet)}. Lương chi thực tế trong tháng đã tính ở dòng tiền phía trên.</p></div></div><div className="accounting-report-metrics">{[['Nháp', report.payrollPeriod.byStatus.draft], ['Kế toán đã đối soát', report.payrollPeriod.byStatus.reviewed], ['Hiệu trưởng đã duyệt', report.payrollPeriod.byStatus.confirmed], ['Đã ghi nhận chi', report.payrollPeriod.byStatus.paid]].map(([label, item]) => <div key={label}><small>{label}</small><strong>{item.count} phiếu</strong><span>{money(item.amount)}</span></div>)}</div></section>
        <section className="content-card accounting-report-section"><div className="card-heading"><div><p className="card-kicker">CHẤT LƯỢNG ĐỐI SOÁT</p><h2>Ngày có giao dịch</h2><p>Đối chiếu thủ công với sổ quỹ/sao kê. Nếu sổ nguồn thay đổi, trạng thái trở thành “sổ thay đổi”.</p></div></div><div className="accounting-report-status">{Object.entries(statusText).map(([key, label]) => <div key={key}><strong>{report.cashFlow.reconciliation[key]}</strong><span>{label}</span></div>)}</div><div className="table-wrap"><table className="data-table"><thead><tr><th>Ngày</th><th>Thu</th><th>Chi</th><th>Chứng từ cần rà</th></tr></thead><tbody>{report.cashFlow.daily.map((item) => <tr key={item.workDate}><td>{item.workDate}</td><td>{money(item.cashIn + item.bankIn + item.walletIn)}</td><td>{money(item.cashOut + item.bankOut + item.walletOut)}</td><td>{item.issues}</td></tr>)}{!report.cashFlow.daily.length && <tr><td colSpan="4">Chưa có giao dịch trong tháng.</td></tr>}</tbody></table></div></section>
      </>}
    </div>
  </AppShell>;
}
