import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';
import { exportHrReport, getHrReports } from '../api/hr';
import './HrReports.css';

const ROLE_LABELS = { principal: 'Hiệu trưởng / Quản trị', teacher: 'Giáo viên', accountant: 'Kế toán', chef: 'Nhân viên bếp', guard: 'Bảo vệ', hr: 'Nhân sự', unclassified: 'Chưa xác định vai trò' };
const STATUSES = { active: 'Đang làm việc', on_leave: 'Đang nghỉ phép', resigned: 'Đã nghỉ việc', unlinked: 'Chưa liên kết', inactive: 'Đã khóa', pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối', cancelled: 'Đã hủy', draft: 'Nháp', reviewed: 'Đã đối soát', confirmed: 'Đã duyệt lương', paid: 'Đã ghi nhận chi trả' };
const ACCOUNT_STATUSES = { active: 'Hoạt động', inactive: 'Đã khóa', pending: 'Chờ duyệt', rejected: 'Đã từ chối', unlinked: 'Chưa liên kết' };
const LEAVE_TYPES = { annual: 'Phép năm', sick: 'Ốm', maternity: 'Thai sản', personal: 'Việc riêng', unpaid: 'Không lương', compensatory: 'Nghỉ bù' };
const MOVEMENTS = { joined: 'Nhận việc', resigned: 'Nghỉ việc', transferred: 'Chuyển công tác' };
const SECTIONS = [['people', 'Nhân sự', 'users'], ['movements', 'Biến động', 'chart'], ['staffing', 'Thiếu người', 'classes'], ['leave', 'Nghỉ phép', 'calendar'], ['overtime', 'Làm thêm', 'clock'], ['payroll', 'Chi phí lương', 'money']];
const number = (value) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value || 0);
const money = (value) => `${number(value)} đ`;
const day = (value) => value ? value.split('-').reverse().join('/') : 'Chưa có';
const period = (value) => value ? `${value.slice(5, 7)}/${value.slice(0, 4)}` : '—';
const schoolDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const initialFilters = () => { const today = schoolDate(); return { fromMonth: today.slice(0, 7), toMonth: today.slice(0, 7), role: 'all', staffingDate: today }; };
const tag = (value, label) => <span className={`hr-report-tag ${value}`}>{label || STATUSES[value] || value}</span>;
const COLUMNS = {
  people: [['Nhân viên', (row) => <><strong>{row.name}</strong><small>{row.code}</small></>], ['Vai trò hiện tại', (row) => ROLE_LABELS[row.role]], ['Tình trạng', (row) => tag(row.status)], ['Ngày vào làm', (row) => day(row.startDate)], ['Tài khoản', (row) => tag(row.accountStatus, ACCOUNT_STATUSES[row.accountStatus])]],
  movements: [['Ngày', (row) => day(row.date)], ['Nhân viên', (row) => <><strong>{row.name}</strong><small>{row.code}</small></>], ['Vai trò hiện tại', (row) => ROLE_LABELS[row.role]], ['Biến động', (row) => <span className={`hr-report-tag ${row.kind}`}>{MOVEMENTS[row.kind]}</span>], ['Nguồn ghi nhận', (row) => row.source]],
  staffing: [['Lớp / ca', (row) => <><strong>{row.name}</strong><small>{row.kind === 'classroom' ? 'Lớp học' : 'Ca làm'} · {ROLE_LABELS[row.role]}</small></>], ['Cần / Sẵn sàng', (row) => `${row.required} / ${row.available}`], ['Còn thiếu', (row) => <span className="hr-report-tag shortage">{row.missing} người</span>], ['Đã phân công', (row) => row.assigned], ['Người thay', (row) => row.replacements]],
  leave: [['Nhân viên', (row) => <><strong>{row.name}</strong><small>{row.code} · {ROLE_LABELS[row.role]}</small></>], ['Loại nghỉ', (row) => LEAVE_TYPES[row.type]], ['Thời gian đơn', (row) => `${day(row.startDate)} – ${day(row.endDate)}`], ['Ngày nghỉ trong kỳ', (row) => <><strong>{row.daysInPeriod === null ? 'Chưa xác định' : `${number(row.daysInPeriod)} ngày`}</strong><small>{row.dateSource}</small></>], ['Trạng thái', (row) => tag(row.status)]],
  overtime: [['Ngày', (row) => day(row.date)], ['Nhân viên', (row) => <><strong>{row.name}</strong><small>{row.code} · {ROLE_LABELS[row.role]}</small></>], ['Yêu cầu', (row) => `${number(row.requestedMinutes / 60)} giờ`], ['Đã duyệt', (row) => `${number(row.approvedMinutes / 60)} giờ`], ['Trạng thái', (row) => tag(row.status)]],
  payroll: [['Kỳ / Nhân viên', (row) => <><strong>{row.name}</strong><small>{row.code} · {period(row.period)}</small></>], ['Vai trò khi lập lương', (row) => ROLE_LABELS[row.role]], ['Tổng thu nhập', (row) => <><strong>{money(row.gross)}</strong><small>Phụ cấp, thưởng: {money(row.allowances)}<br />Làm thêm: {money(row.overtimePay)}</small></>], ['Khấu trừ', (row) => money(row.deductions)], ['Thực lĩnh', (row) => <strong>{money(row.net)}</strong>], ['Trạng thái', (row) => <>{tag(row.status)}{row.paidAt && <small>{day(row.paidAt)}</small>}</>]]
};

export default function HrReports() {
  const [filters, setFilters] = useState(initialFilters);
  const [applied, setApplied] = useState(initialFilters);
  const [section, setSection] = useState('people');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [today] = useState(schoolDate);
  const [lastStaffingDate] = useState(() => { const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 90); return date.toISOString().slice(0, 10); });
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const response = await getHrReports({ ...applied, section, page }, controller.signal);
        if (!controller.signal.aborted) setData(response.data.data);
      } catch (err) {
        if (!controller.signal.aborted) { setError(err.response?.data?.message || 'Không thể tải báo cáo nhân sự.'); setData(null); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [applied, section, page]);
  const apply = (event) => { event.preventDefault(); setPage(1); setLoading(true); setApplied({ ...filters }); };
  const changeSection = (value) => { if (section === value) return; setLoading(true); setPage(1); setSection(value); };
  const download = async () => {
    setExporting(true); setError('');
    try {
      const response = await exportHrReport({ ...applied, section });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url; link.download = `nhan-su-${section}-${applied.fromMonth}-${applied.toMonth}.csv`;
      document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      let message = 'Không thể xuất báo cáo.';
      try { const body = err.response?.data; message = body instanceof Blob ? JSON.parse(await body.text()).message || message : body?.message || message; } catch { /* Keep readable fallback for non-JSON errors. */ }
      setError(message);
    } finally { setExporting(false); }
  };
  const summary = data?.summary;
  const columns = COLUMNS[section];
  const roleMax = Math.max(1, ...(data?.headcountByRole || []).map((row) => row.count));
  return <div className="hr-report-page">
    <section className="content-card hr-report-header">
      <div className="hr-report-title"><span className="hr-report-title-icon"><Icon name="chart" size={26} /></span><div><p className="card-kicker">BÁO CÁO NHÂN SỰ</p><h2>Nhân lực & chi phí vận hành</h2><p>Theo dõi nhân sự hiện tại, biến động trong kỳ và công việc cần bố trí người.</p></div></div>
      <form className="hr-report-filters" onSubmit={apply}>
        <label>Từ tháng<input type="month" min="2000-01" max={today.slice(0, 7)} required value={filters.fromMonth} onChange={(e) => setFilters({ ...filters, fromMonth: e.target.value })} /></label>
        <label>Đến tháng<input type="month" min={filters.fromMonth} max={today.slice(0, 7)} required value={filters.toMonth} onChange={(e) => setFilters({ ...filters, toMonth: e.target.value })} /></label>
        <label>Vai trò<select value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })}><option value="all">Tất cả vai trò</option>{Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Ngày kiểm tra thiếu người<input type="date" required min={today} max={lastStaffingDate} value={filters.staffingDate} onChange={(e) => setFilters({ ...filters, staffingDate: e.target.value })} /></label>
        <button className="button button-primary" disabled={loading}><Icon name="search" size={17} />Xem báo cáo</button>
      </form>
    </section>
    {error && <div className="form-error" role="alert">{error}</div>}
    {loading ? <div className="content-card hr-report-loading" role="status"><span className="loading-orb" />Đang tổng hợp báo cáo...</div> : data && <>
      <div className="hr-report-context"><span>Kỳ: <strong>{period(data.filters.fromMonth)} – {period(data.filters.toMonth)}</strong> · {ROLE_LABELS[data.filters.role] || 'Tất cả vai trò'}</span><small>Cập nhật {new Date(data.generatedAt).toLocaleString('vi-VN', { hour12: false, timeZone: 'Asia/Ho_Chi_Minh' })}</small></div>
      <div className="hr-report-metrics">
        <article><span className="hr-report-metric-icon blue"><Icon name="users" /></span><small>NHÂN SỰ HIỆN TẠI</small><strong>{number(summary.currentEmployees)} <em>người</em></strong><p>{number(summary.linkedActive)} tài khoản hoạt động</p></article>
        <article><span className="hr-report-metric-icon green"><Icon name="chart" /></span><small>BIẾN ĐỘNG TRONG KỲ</small><strong>+{number(summary.joined)} <em>/ −{number(summary.resigned)}</em></strong><p>{number(summary.transferred)} lượt chuyển công tác</p></article>
        <article><span className="hr-report-metric-icon orange"><Icon name="classes" /></span><small>THIẾU NGƯỜI · {day(data.filters.staffingDate)}</small><strong>{number(summary.missingTeachers)} <em>giáo viên</em></strong><p>{number(summary.uncoveredShifts)} ca chưa có người</p></article>
        <article><span className="hr-report-metric-icon purple"><Icon name="calendar" /></span><small>NGHỈ PHÉP ĐÃ DUYỆT</small><strong>{number(summary.approvedLeaveDays)} <em>ngày</em></strong><p>{number(summary.pendingLeaveRequests)} đơn chờ duyệt</p></article>
        <article><span className="hr-report-metric-icon blue"><Icon name="clock" /></span><small>LÀM THÊM ĐÃ DUYỆT</small><strong>{number(summary.approvedOvertimeMinutes / 60)} <em>giờ</em></strong><p>{number(summary.pendingOvertimeRequests)} yêu cầu chờ duyệt</p></article>
        <article><span className="hr-report-metric-icon green"><Icon name="money" /></span><small>THỰC LĨNH THEO KỲ LƯƠNG</small><strong className="hr-report-money">{money(summary.payrollNet)}</strong><p>{number(summary.payrollCount)} phiếu · gồm mọi trạng thái</p></article>
      </div>
      {!!data.warnings.length && <div className="hr-report-warning" role="status"><Icon name="alertCircle" size={19} /><div>{data.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div></div>}
      <div className="hr-report-overview">
        <section className="content-card hr-report-panel"><div className="hr-report-panel-heading"><div><p className="card-kicker">CƠ CẤU HIỆN TẠI</p><h3>Nhân sự theo vai trò</h3></div><span className="hr-report-chip">{number(summary.currentEmployees)} người</span></div>
          <div className="hr-report-bars">{data.headcountByRole.map((row) => <div key={row.role}><div><span>{row.label}</span><strong>{number(row.count)}</strong></div><div className="hr-report-bar-track"><span style={{ width: `${row.count / roleMax * 100}%` }} /></div></div>)}</div>
          <p className="hr-report-note">Gồm đang làm việc và đang nghỉ phép. {summary.unlinked} người chưa liên kết tài khoản; {summary.inactiveAccounts} tài khoản chưa hoạt động.</p>
        </section>
        <section className="content-card hr-report-panel"><div className="hr-report-panel-heading"><div><p className="card-kicker">ĐỐI SOÁT CHI PHÍ</p><h3>Phân biệt lương lập và tiền đã chi</h3></div></div>
          <div className="hr-report-payroll-states">{data.payrollByStatus.map((row) => <div key={row.status}><span>{tag(row.status)}<small>{row.count} phiếu</small></span><strong>{money(row.net)}</strong></div>)}</div>
          <p className="hr-report-note">Tổng thu nhập: {money(summary.payrollGross)}. Đã duyệt, chờ chi: {money(summary.approvedUnpaidNet)}. Tiền đã ghi nhận chi trả tính theo phiếu thuộc kỳ lương đã chọn.</p>
        </section>
      </div>
    </>}
    <section className="content-card hr-report-detail">
      <div className="hr-report-tabs" role="tablist" aria-label="Nội dung báo cáo">{SECTIONS.map(([key, label, icon]) => <button key={key} role="tab" aria-selected={section === key} className={section === key ? 'active' : ''} onClick={() => changeSection(key)}><Icon name={icon} size={17} />{label}{data?.counts && <span>{data.counts[key]}</span>}</button>)}</div>
      <div className="hr-report-detail-heading"><div><h3>{SECTIONS.find(([key]) => key === section)?.[1]}{section === 'staffing' && ` ngày ${day(applied.staffingDate)}`}</h3><p>{section === 'people' ? 'Tình trạng hồ sơ hiện tại, gồm cả người đã nghỉ việc.' : section === 'staffing' ? 'Sẵn sàng theo phân công và đơn nghỉ đã duyệt; không phải số người đã chấm công. Dùng lịch đang lưu cho ngày đã chọn.' : section === 'payroll' ? 'Giữ vai trò tại thời điểm lập phiếu lương. Tiền làm thêm và phụ cấp đã nằm trong tổng thu nhập.' : 'Tính trong các tháng đã chọn; vai trò nhân viên lấy theo hồ sơ hiện tại.'}</p></div><button className="button button-secondary" disabled={loading || exporting || !data} onClick={download}>{exporting ? 'Đang xuất...' : 'Xuất CSV'}</button></div>
      {!loading && data && <>
        {section === 'leave' && <div className="hr-report-leave-types">{data.leaveByType.filter((row) => row.requests).map((row) => <span key={row.type}>{LEAVE_TYPES[row.type]}: <strong>{number(row.days)} ngày</strong> · {row.requests} đơn</span>)}</div>}
        {section === 'payroll' && <div className="hr-report-role-costs">{data.payrollByRole.filter((row) => row.count).map((row) => <div key={row.role}><span>{row.label} · {row.count} phiếu</span><strong>{money(row.net)}</strong><small>Đã chi: {money(row.paid)}</small></div>)}</div>}
        <div className="table-wrap"><table className="hr-report-table"><thead><tr>{columns.map(([title]) => <th key={title} scope="col">{title}</th>)}</tr></thead><tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id}>{columns.map(([title, render]) => <td key={title}>{render(row)}</td>)}</tr>) : <tr><td colSpan={columns.length} className="hr-report-empty"><Icon name={section === 'staffing' ? 'check' : 'chart'} size={28} /><strong>{section === 'staffing' ? 'Không có lớp hoặc ca thiếu người trong bộ lọc này.' : 'Chưa có dữ liệu trong bộ lọc này.'}</strong><span>{section === 'payroll' ? 'Báo cáo chỉ tổng hợp các phiếu lương đã được lập.' : 'Thử chọn kỳ hoặc vai trò khác để đối chiếu.'}</span></td></tr>}</tbody></table></div>
        <div className="hr-report-pagination"><span>{number(data.pagination.total)} mục · Trang {data.pagination.page}/{data.pagination.totalPages} · 10 mục/trang</span><div><button className="button button-secondary" disabled={data.pagination.page <= 1} onClick={() => setPage(data.pagination.page - 1)}>Trước</button><button className="button button-secondary" disabled={data.pagination.page >= data.pagination.totalPages} onClick={() => setPage(data.pagination.page + 1)}>Sau</button></div></div>
        {section === 'staffing' && <div className="hr-report-next"><Link className="button button-primary" to="/hr?tab=staffing">Mở phân công công việc <Icon name="chevronRight" size={16} /></Link></div>}
      </>}
    </section>
  </div>;
}
