/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import api from '../api/axiosConfig';
import { getClassReport, getDashboardStats, getFinanceReport, getSavedReports, saveReport } from '../api/reports';

const formatMoney = (value) => `${Number(value || 0).toLocaleString('vi-VN')} đ`;
const formatDate = (value) => value ? new Date(value).toLocaleDateString('vi-VN') : '—';
const today = new Date().toISOString().slice(0, 10);
const currentMonth = new Date().toISOString().slice(0, 7);
const reportTypeLabel = { attendance: 'Chuyên cần', finance: 'Tài chính', student: 'Học sinh', class: 'Lớp học' };

const attendanceStatus = (status) => ({
  present: ['Có mặt', 'present'],
  late: ['Đi muộn', 'late'],
  absent_permission: ['Có phép', 'permission'],
  absent: ['Vắng mặt', 'absent']
}[status] || ['Chưa điểm danh', 'neutral']);

export default function Reports() {
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [dashboardData, setDashboardData] = useState(null);
  const [classrooms, setClassrooms] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedDate, setSelectedDate] = useState(today);
  const [classReportData, setClassReportData] = useState(null);
  const [financeMonth, setFinanceMonth] = useState(currentMonth);
  const [financeData, setFinanceData] = useState(null);
  const [savedReports, setSavedReports] = useState([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [newReportTitle, setNewReportTitle] = useState('');
  const [newReportType, setNewReportType] = useState('attendance');

  const financePeriod = useMemo(() => {
    const [year, month] = financeMonth.split('-');
    return year && month ? `${month}-${year}` : '';
  }, [financeMonth]);

  const showFeedback = (type, text) => {
    setMessage({ type, text });
    window.setTimeout(() => setMessage(null), 4500);
  };

  useEffect(() => {
    const loadClassrooms = async () => {
      try {
        const response = await api.get('/classrooms');
        const list = response.data.data || response.data || [];
        setClassrooms(list);
        if (list.length) setSelectedClassId((current) => current || list[0]._id);
      } catch (err) {
        console.error('Lỗi tải danh sách lớp:', err);
      }
    };
    loadClassrooms();
  }, []);

  const loadTabData = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === 'overview') {
        const response = await getDashboardStats();
        setDashboardData(response.data.data || {});
      }
      if (activeTab === 'attendance' && selectedClassId) {
        const response = await getClassReport(selectedClassId, selectedDate);
        setClassReportData(response.data.data || null);
      }
      if (activeTab === 'finance' && financePeriod) {
        const response = await getFinanceReport({ period: financePeriod });
        setFinanceData(response.data.data || null);
      }
      if (activeTab === 'saved') {
        const response = await getSavedReports();
        setSavedReports(response.data.data || []);
      }
    } catch (err) {
      console.error('Lỗi tải báo cáo:', err);
      showFeedback('error', err.response?.data?.message || 'Không thể tải dữ liệu báo cáo từ máy chủ.');
    } finally {
      setLoading(false);
    }
  }, [activeTab, selectedClassId, selectedDate, financePeriod]);

  useEffect(() => { loadTabData(); }, [loadTabData]);

  const handleSaveReport = async (event) => {
    event.preventDefault();
    const period = activeTab === 'attendance' ? 'daily' : 'monthly';
    const periodValue = activeTab === 'attendance' ? selectedDate : financePeriod;
    const data = activeTab === 'attendance' ? classReportData : activeTab === 'finance' ? financeData : dashboardData;
    try {
      await saveReport({ reportType: newReportType, period, periodValue, note: newReportTitle, data });
      setShowSaveModal(false);
      setNewReportTitle('');
      showFeedback('success', 'Đã lưu bản báo cáo vào kho báo cáo định kỳ.');
      if (activeTab === 'saved') loadTabData();
    } catch (err) {
      showFeedback('error', err.response?.data?.message || 'Không thể lưu báo cáo.');
    }
  };

  const summary = dashboardData?.summary || {};
  const attendanceItems = dashboardData?.recentAttendance || [];
  const attendanceRate = classReportData?.totalStudents ? Math.round(((classReportData.present || 0) / classReportData.totalStudents) * 100) : 0;
  const collectionRate = financeData?.totalAmount ? Math.round((financeData.totalPaid / financeData.totalAmount) * 100) : 0;

  const tabs = [
    ['overview', 'Tổng quan vận hành', 'grid'],
    ['attendance', 'Chuyên cần theo lớp', 'attendance'],
    ['finance', 'Thu chi & học phí', 'money'],
    ['saved', 'Kho báo cáo', 'classes']
  ];

  return (
    <AppShell
      title="Báo cáo & Phân tích"
      subtitle="Theo dõi dữ liệu vận hành để nhà trường ra quyết định kịp thời"
      actions={<div className="report-header-actions"><button className="button button-secondary" onClick={() => window.print()}><Icon name="chart" size={16} /> In báo cáo</button><button className="button button-primary" onClick={() => setShowSaveModal(true)}><Icon name="plus" size={16} /> Lưu kỳ báo cáo</button></div>}
    >
      <section className="report-workspace">
        {message && <div className={`report-toast ${message.type}`}><Icon name={message.type === 'success' ? 'check' : 'alertCircle'} size={17} /><span>{message.text}</span><button onClick={() => setMessage(null)}>×</button></div>}

        <nav className="report-tabs" aria-label="Các loại báo cáo">
          {tabs.map(([key, label, icon]) => <button key={key} className={activeTab === key ? 'active' : ''} onClick={() => setActiveTab(key)}><Icon name={icon} size={17} /><span>{label}</span>{key === 'saved' && savedReports.length > 0 && <b>{savedReports.length}</b>}</button>)}
        </nav>

        {loading ? <div className="report-loading"><span className="loading-orb" /> Đang tổng hợp dữ liệu báo cáo...</div> : <>
          {activeTab === 'overview' && <Overview summary={summary} attendances={attendanceItems} />}
          {activeTab === 'attendance' && <AttendanceReport
            classrooms={classrooms} selectedClassId={selectedClassId} setSelectedClassId={setSelectedClassId}
            selectedDate={selectedDate} setSelectedDate={setSelectedDate} data={classReportData}
            rate={attendanceRate} onRefresh={loadTabData}
          />}
          {activeTab === 'finance' && <FinanceReport financeMonth={financeMonth} setFinanceMonth={setFinanceMonth} data={financeData} rate={collectionRate} onRefresh={loadTabData} />}
          {activeTab === 'saved' && <SavedReports reports={savedReports} />}
        </>}
      </section>

      {showSaveModal && <div className="report-modal-backdrop"><section className="report-modal"><header><p className="card-kicker">KHO BÁO CÁO</p><h2>Lưu kỳ báo cáo</h2><p>Lưu lại ảnh chụp dữ liệu hiện tại để đối chiếu về sau.</p></header><form onSubmit={handleSaveReport} className="report-form"><label>Tên báo cáo<input value={newReportTitle} onChange={(event) => setNewReportTitle(event.target.value)} placeholder="Ví dụ: Báo cáo chuyên cần tháng 09/2026" required /></label><label>Phân loại<select value={newReportType} onChange={(event) => setNewReportType(event.target.value)}><option value="attendance">Chuyên cần học sinh</option><option value="finance">Thu chi tài chính</option><option value="student">Đánh giá học sinh</option><option value="class">Tổng hợp lớp học</option></select></label><div className="report-modal-actions"><button type="button" className="button button-secondary" onClick={() => setShowSaveModal(false)}>Hủy</button><button className="button button-primary">Lưu báo cáo</button></div></form></section></div>}
    </AppShell>
  );
}

function Overview({ summary, attendances }) {
  const cards = [
    ['students', 'Học sinh đang theo học', summary.totalStudents || 0, 'Toàn trường', 'blue'],
    ['classes', 'Lớp đang hoạt động', summary.totalClassrooms || 0, 'Trong năm học', 'orange'],
    ['attendance', 'Tỷ lệ có mặt hôm nay', `${summary.attendanceRate || 0}%`, `${summary.attendedToday || 0} học sinh có mặt`, 'green'],
    ['money', 'Doanh thu ghi nhận hôm nay', formatMoney(summary.todayRevenue), 'Cập nhật trong ngày', 'violet']
  ];
  return <div className="report-overview">
    <section className="report-hero"><div><p className="card-kicker">BỨC TRANH HÔM NAY</p><h2>Trường học vận hành ổn định</h2><p>Dữ liệu được tổng hợp từ điểm danh, hồ sơ lớp học và các khoản thu trong ngày.</p></div><div className="report-hero-rate"><span>CHUYÊN CẦN</span><b>{summary.attendanceRate || 0}%</b><small>{summary.attendedToday || 0}/{summary.totalStudents || 0} học sinh có mặt</small></div></section>
    <section className="report-metric-grid">{cards.map(([icon, label, value, note, tone]) => <article key={label} className={tone}><span><Icon name={icon} size={20} /></span><div><small>{label}</small><strong>{value}</strong><em>{note}</em></div></article>)}</section>
    <section className="report-overview-grid"><article className="report-panel attendance-stream"><div className="report-panel-heading"><div><p className="card-kicker">DÒNG SỰ KIỆN</p><h2>Điểm danh mới nhất</h2></div><span>{attendances.length} lượt</span></div>{attendances.length ? <div className="report-checkin-list">{attendances.map((item, index) => { const [label, tone] = attendanceStatus(item.status); return <div key={`${item.studentName}-${index}`}><span className="report-avatar">{item.studentName?.charAt(0) || 'H'}</span><div><strong>{item.studentName || 'Học sinh'}</strong><small>{item.checkInTime ? new Date(item.checkInTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : 'Đã ghi nhận'}</small></div><span className={`report-status ${tone}`}>{label}</span></div>; })}</div> : <ReportEmpty icon="attendance" title="Chưa có lượt điểm danh hôm nay" text="Dữ liệu điểm danh theo lớp sẽ xuất hiện tại đây sau khi giáo viên ghi nhận." />}</article>
      <aside className="report-insight"><span className="insight-icon"><Icon name="chart" size={20} /></span><p className="card-kicker">GỢI Ý QUẢN LÝ</p><h2>Việc cần theo dõi</h2><ul><li><i className="green" />Kiểm tra các lớp chưa hoàn tất điểm danh.</li><li><i className="orange" />Rà soát các học sinh vắng mặt trong ngày.</li><li><i className="violet" />Đối chiếu học phí trước khi chốt kỳ.</li></ul><p className="insight-note">Báo cáo được cập nhật theo dữ liệu hiện có trong hệ thống.</p></aside>
    </section>
  </div>;
}

function AttendanceReport({ classrooms, selectedClassId, setSelectedClassId, selectedDate, setSelectedDate, data, rate, onRefresh }) {
  const cards = [
    ['Sĩ số lớp', data?.totalStudents || 0, 'blue'], ['Có mặt', data?.present || 0, 'green'], ['Đi muộn', data?.late || 0, 'orange'], ['Vắng / có phép', (data?.absent || 0) + (data?.absentPermission || 0), 'red']
  ];
  return <div className="report-section"><section className="report-filter-card"><div><label>Lớp học<select value={selectedClassId} onChange={(event) => setSelectedClassId(event.target.value)}>{classrooms.length ? classrooms.map((item) => <option key={item._id} value={item._id}>{item.name}</option>) : <option>Chưa có lớp học</option>}</select></label><label>Ngày báo cáo<input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label></div><button className="button button-secondary" onClick={onRefresh}><Icon name="clock" size={15} /> Cập nhật dữ liệu</button></section>
    {data ? <><section className="attendance-report-hero"><div><p className="card-kicker">BÁO CÁO CHUYÊN CẦN</p><h2>{data.className || 'Lớp học'}</h2><p>{formatDate(data.date || selectedDate)} · Tổng hợp sĩ số và tình trạng đến lớp.</p></div><div className="attendance-rate"><div style={{ '--rate': `${rate}%` }}><b>{rate}%</b></div><span>Tỷ lệ có mặt</span></div></section><section className="attendance-summary-grid">{cards.map(([label, value, tone]) => <article key={label} className={tone}><small>{label}</small><strong>{value}</strong></article>)}</section><section className="report-panel"><div className="report-panel-heading"><div><p className="card-kicker">CHI TIẾT THEO HỌC SINH</p><h2>Danh sách điểm danh</h2></div><span>{data.details?.length || 0} học sinh</span></div><div className="report-table-wrap"><table className="report-table"><thead><tr><th>HỌC SINH</th><th>TRẠNG THÁI</th><th>GIỜ ĐẾN</th><th>GHI CHÚ</th></tr></thead><tbody>{data.details?.map((item) => { const [label, tone] = attendanceStatus(item.status); return <tr key={item.studentId}><td><span className="report-avatar">{item.studentName?.charAt(0) || 'H'}</span><strong>{item.studentName}</strong></td><td><span className={`report-status ${tone}`}>{label}</span></td><td>{item.checkInTime ? new Date(item.checkInTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td><td>{item.note || '—'}</td></tr>; })}</tbody></table></div></section></> : <section className="report-panel"><ReportEmpty icon="attendance" title="Chọn lớp để xem báo cáo" text="Chọn lớp học và ngày cần xem; hệ thống sẽ tổng hợp dữ liệu chuyên cần." /></section>}
  </div>;
}

function FinanceReport({ financeMonth, setFinanceMonth, data, rate, onRefresh }) {
  const cards = data ? [['Tổng phải thu', data.totalAmount, 'blue'], ['Đã thu', data.totalPaid, 'green'], ['Công nợ còn lại', data.totalRemaining, 'red']] : [];
  return <div className="report-section"><section className="report-filter-card"><div><label>Kỳ báo cáo<input type="month" value={financeMonth} onChange={(event) => setFinanceMonth(event.target.value)} /></label></div><button className="button button-secondary" onClick={onRefresh}><Icon name="clock" size={15} /> Cập nhật dữ liệu</button></section>{data ? <><section className="finance-summary-grid">{cards.map(([label, value, tone]) => <article key={label} className={tone}><small>{label}</small><strong>{formatMoney(value)}</strong><em>{label === 'Đã thu' ? `${data.statusCounts?.paid || 0} hóa đơn đã hoàn tất` : label === 'Công nợ còn lại' ? `${data.statusCounts?.unpaid || 0} hóa đơn chưa thu` : `${data.totalInvoices || 0} hóa đơn trong kỳ`}</em></article>)}</section><section className="finance-progress-card"><div><div><p className="card-kicker">TIẾN ĐỘ THU HỌC PHÍ</p><h2>Đã hoàn thành {rate}% kế hoạch thu</h2><p>Hệ thống ghi nhận {data.totalPaid ? formatMoney(data.totalPaid) : '0 đ'} trên tổng số {formatMoney(data.totalAmount)}.</p></div><span>{rate}%</span></div><div className="finance-progress"><i style={{ width: `${rate}%` }} /></div><div className="finance-status-row"><span className="paid">Đã thu: {data.statusCounts?.paid || 0}</span><span className="partial">Thu một phần: {data.statusCounts?.partial || 0}</span><span className="unpaid">Chưa thu: {data.statusCounts?.unpaid || 0}</span></div></section><section className="report-panel"><div className="report-panel-heading"><div><p className="card-kicker">PHÂN TÍCH THEO LỚP</p><h2>Tình hình học phí từng lớp</h2></div><span>{data.byClass?.length || 0} lớp</span></div><div className="report-table-wrap"><table className="report-table"><thead><tr><th>LỚP HỌC</th><th>HÓA ĐƠN</th><th>PHẢI THU</th><th>ĐÃ THU</th><th>TIẾN ĐỘ</th></tr></thead><tbody>{data.byClass?.map((item) => { const progress = item.totalAmount ? Math.round((item.paidAmount / item.totalAmount) * 100) : 0; return <tr key={item._id || item.className}><td><strong>{item.className || 'Chưa xếp lớp'}</strong></td><td>{item.totalStudents}</td><td>{formatMoney(item.totalAmount)}</td><td>{formatMoney(item.paidAmount)}</td><td><div className="table-progress"><i style={{ width: `${progress}%` }} /><span>{progress}%</span></div></td></tr>; })}</tbody></table></div></section></> : <section className="report-panel"><ReportEmpty icon="money" title="Chưa có số liệu học phí" text="Chọn kỳ báo cáo để tổng hợp các hóa đơn học phí trong tháng." /></section>}</div>;
}

function SavedReports({ reports }) {
  return <section className="report-panel saved-report-panel"><div className="report-panel-heading"><div><p className="card-kicker">LƯU TRỮ & ĐỐI CHIẾU</p><h2>Kho báo cáo định kỳ</h2><p>Các bản chụp dữ liệu đã lưu để phục vụ kiểm tra và đối chiếu.</p></div><span>{reports.length} bản lưu</span></div>{reports.length ? <div className="saved-report-list">{reports.map((report) => <article key={report._id}><span className="saved-report-icon"><Icon name={report.reportType === 'finance' ? 'money' : report.reportType === 'attendance' ? 'attendance' : 'chart'} size={19} /></span><div><h3>{report.note || `Báo cáo ${reportTypeLabel[report.reportType] || report.reportType}`}</h3><p>{reportTypeLabel[report.reportType] || report.reportType} · Kỳ {report.periodValue || report.period || '—'} · Tạo bởi {report.generatedByName || 'Nhà trường'}</p><small>{formatDate(report.generatedAt || report.createdAt)}</small></div><span className={`report-status ${report.status === 'published' ? 'present' : 'neutral'}`}>{report.status === 'published' ? 'Đã công bố' : 'Bản lưu nội bộ'}</span></article>)}</div> : <ReportEmpty icon="classes" title="Kho báo cáo đang trống" text="Khi cần chốt số liệu, hãy dùng nút “Lưu kỳ báo cáo” để tạo một bản lưu tại đây." />}</section>;
}

function ReportEmpty({ icon, title, text }) {
  return <div className="report-empty"><span><Icon name={icon} size={25} /></span><h3>{title}</h3><p>{text}</p></div>;
}
