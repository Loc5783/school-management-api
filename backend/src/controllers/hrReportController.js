const { ROLE_LABELS, parseReportFilters, getHrReport } = require('../services/hrReportService');

const statusLabels = { active: 'Đang làm việc', on_leave: 'Đang nghỉ phép', resigned: 'Đã nghỉ việc', unlinked: 'Chưa liên kết', inactive: 'Đã khóa', pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối', cancelled: 'Đã hủy', draft: 'Nháp', reviewed: 'Đã đối soát', confirmed: 'Đã duyệt lương', paid: 'Đã ghi nhận chi trả' };
const leaveLabels = { annual: 'Phép năm', sick: 'Ốm', maternity: 'Thai sản', personal: 'Việc riêng', unpaid: 'Không lương', compensatory: 'Nghỉ bù' };
const movementLabels = { joined: 'Nhận việc', resigned: 'Nghỉ việc', transferred: 'Chuyển công tác' };
const CSV_COLUMNS = {
  people: [['code', 'Mã nhân viên'], ['name', 'Họ và tên'], ['role', 'Vai trò hiện tại'], ['status', 'Tình trạng'], ['startDate', 'Ngày vào làm'], ['accountStatus', 'Tài khoản']],
  movements: [['date', 'Ngày'], ['code', 'Mã nhân viên'], ['name', 'Họ và tên'], ['role', 'Vai trò hiện tại'], ['kind', 'Biến động'], ['source', 'Nguồn ghi nhận']],
  staffing: [['date', 'Ngày kiểm tra'], ['kind', 'Loại'], ['name', 'Lớp / ca'], ['role', 'Vai trò'], ['required', 'Số người cần'], ['available', 'Sẵn sàng'], ['missing', 'Còn thiếu'], ['assigned', 'Đã phân công'], ['replacements', 'Người thay']],
  leave: [['code', 'Mã nhân viên'], ['name', 'Họ và tên'], ['role', 'Vai trò hiện tại'], ['type', 'Loại nghỉ'], ['startDate', 'Từ ngày'], ['endDate', 'Đến ngày'], ['status', 'Trạng thái'], ['daysInPeriod', 'Ngày nghỉ trong kỳ'], ['dateSource', 'Nguồn tính ngày']],
  overtime: [['date', 'Ngày làm thêm'], ['code', 'Mã nhân viên'], ['name', 'Họ và tên'], ['role', 'Vai trò hiện tại'], ['status', 'Trạng thái'], ['requestedMinutes', 'Phút yêu cầu'], ['approvedMinutes', 'Phút đã duyệt']],
  payroll: [['period', 'Kỳ lương'], ['code', 'Mã nhân viên'], ['name', 'Họ và tên'], ['role', 'Vai trò khi lập lương'], ['status', 'Trạng thái'], ['gross', 'Tổng thu nhập'], ['allowances', 'Phụ cấp và thưởng'], ['overtimePay', 'Tiền làm thêm'], ['deductions', 'Khấu trừ'], ['net', 'Thực lĩnh'], ['paidAt', 'Ngày ghi nhận chi trả']]
};
const csvValue = (value) => {
  let text = String(value ?? '');
  // Keep names and free text as text when opened in spreadsheet software.
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
const exportValue = (section, key, value) => {
  if (key === 'role') return ROLE_LABELS[value] || 'Chưa xác định vai trò';
  if (key === 'accountStatus' && value === 'active') return 'Hoạt động';
  if (key === 'status' || key === 'accountStatus') return statusLabels[value] || value;
  if (key === 'type') return leaveLabels[value] || value;
  if (key === 'kind') return section === 'movements' ? movementLabels[value] : value === 'classroom' ? 'Lớp học' : 'Ca làm';
  if (key === 'daysInPeriod' && value === null) return 'Chưa xác định';
  return value;
};
const handleError = (res, error) => {
  if (!error.statusCode) console.error('Không thể lập báo cáo nhân sự:', error);
  return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Không thể tải báo cáo nhân sự. Vui lòng thử lại.' });
};
const overview = async (req, res) => {
  try {
    const filters = parseReportFilters(req.query);
    const report = await getHrReport(filters);
    const rows = report.rows[filters.section];
    const totalPages = Math.max(1, Math.ceil(rows.length / 10));
    const page = Math.min(filters.page, totalPages);
    const counts = Object.fromEntries(Object.entries(report.rows).map(([section, items]) => [section, items.length]));
    const { rows: allRows, ...summary } = report;
    void allRows;
    res.json({ data: { ...summary, counts, section: filters.section, rows: rows.slice((page - 1) * 10, page * 10),
      pagination: { page, total: rows.length, totalPages, limit: 10 } } });
  } catch (error) { handleError(res, error); }
};
const exportCsv = async (req, res) => {
  try {
    const filters = parseReportFilters(req.query);
    const report = await getHrReport(filters);
    const columns = CSV_COLUMNS[filters.section];
    const lines = [columns.map(([, label]) => csvValue(label)).join(','),
      ...report.rows[filters.section].map((row) => columns.map(([key]) => csvValue(exportValue(filters.section, key, row[key]))).join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="hr-${filters.section}-${filters.fromMonth}-${filters.toMonth}.csv"`);
    res.send(`\uFEFF${lines.join('\r\n')}`);
  } catch (error) { handleError(res, error); }
};

module.exports = { overview, exportCsv };
