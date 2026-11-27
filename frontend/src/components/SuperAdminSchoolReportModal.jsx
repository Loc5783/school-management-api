import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import { getSuperAdminSchoolReport } from '../api/multiSchool';

const formatCurrency = (val) => `${new Intl.NumberFormat('vi-VN').format(Number(val) || 0)} đ`;

const formatDateTime = (val) => {
  if (!val) return 'Chưa ghi nhận';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const ROLE_LABELS = {
  admin: 'Admin Trường',
  principal: 'Hiệu trưởng',
  teacher: 'Giáo viên',
  accountant: 'Kế toán',
  hr: 'Nhân sự',
  chef: 'Bếp trưởng',
  guard: 'Bảo vệ',
  parent: 'Phụ huynh'
};

const SAMPLE_STATUS_LABELS = {
  stored: 'Đang lưu mẫu 24h',
  disposed_normal: 'Đã hủy mẫu đạt chuẩn',
  sent_to_lab: 'Đã gửi xét nghiệm',
  investigating: 'Đang điều tra sự cố'
};

export default function SuperAdminSchoolReportModal({
  schoolId,
  moduleCatalog = [],
  onClose,
  onEnterWorkspace,
  onOpenConfig
}) {
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);

  useEffect(() => {
    if (!schoolId) return undefined;
    let cancelled = false;

    const fetchReport = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await getSuperAdminSchoolReport(schoolId);
        if (!cancelled) {
          setReport(res.data?.data || null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || 'Không thể tải báo cáo chi tiết của trường này.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchReport();
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  if (!schoolId) return null;

  const school = report?.school;
  const moduleMap = new Map(moduleCatalog.map((m) => [m.key, m.label]));

  return createPortal(
    <div
      className="account-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className="account-modal-card"
        style={{ width: 'min(1080px, 96vw)', maxHeight: '90dvh', overflowY: 'auto', padding: '24px 28px' }}
      >
        <div className="account-modal-header" style={{ alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <p className="card-kicker">BÁO CÁO GIÁM SÁT 360° DÀNH CHO SUPERADMIN</p>
            <h2 style={{ margin: '4px 0' }}>
              {school ? `${school.name} (${school.code})` : 'Đang tải thông tin trường...'}
            </h2>
            {school && (
              <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                {school.organizationCode ? `Cụm: ${school.organizationCode} · ` : ''}
                Trạng thái:{' '}
                <strong style={{ color: school.status === 'active' ? '#15803d' : '#b91c1c' }}>
                  {school.status === 'active' ? 'Đang hoạt động' : 'Tạm ngưng'}
                </strong>
                {school.contactEmail ? ` · Liên hệ: ${school.contactEmail}` : ''}
              </p>
            )}
          </div>

          <div className="classroom-actions" style={{ flexWrap: 'wrap' }}>
            {school && onOpenConfig && (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  onClose?.();
                  onOpenConfig(school);
                }}
              >
                <Icon name="settings" size={15} /> Cấu hình & Phân hệ
              </button>
            )}
            {school?.status === 'active' && onEnterWorkspace && (
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  onClose?.();
                  onEnterWorkspace(school);
                }}
              >
                <Icon name="shield" size={15} /> Vào điều hành trường
              </button>
            )}
            <button type="button" className="button button-secondary" onClick={onClose}>
              Đóng
            </button>
          </div>
        </div>

        {loading ? (
          <div className="inline-loader" style={{ padding: '48px 0' }}>
            Đang tổng hợp số liệu vận hành, điểm danh, tài chính và bếp ăn của trường...
          </div>
        ) : error ? (
          <div className="form-error" role="alert" style={{ marginTop: '16px' }}>
            <Icon name="alertCircle" size={17} /> {error}
          </div>
        ) : report ? (
          <>
            <div className="superadmin-report-tabs" role="tablist">
              <button
                type="button"
                className={`superadmin-report-tab ${activeTab === 'overview' ? 'active' : ''}`}
                onClick={() => setActiveTab('overview')}
              >
                1. Tổng quan & Phân hiệu ({report.campuses?.length || 0})
              </button>
              <button
                type="button"
                className={`superadmin-report-tab ${activeTab === 'classes' ? 'active' : ''}`}
                onClick={() => setActiveTab('classes')}
              >
                2. Lớp học & Điểm danh 7 ngày ({report.classrooms?.length || 0} lớp)
              </button>
              <button
                type="button"
                className={`superadmin-report-tab ${activeTab === 'finance' ? 'active' : ''}`}
                onClick={() => setActiveTab('finance')}
              >
                3. Tài chính Học phí & Chi phí
              </button>
              <button
                type="button"
                className={`superadmin-report-tab ${activeTab === 'safety' ? 'active' : ''}`}
                onClick={() => setActiveTab('safety')}
              >
                4. Bếp ăn 24h, Phản hồi PH & Tài khoản
              </button>
            </div>

            {activeTab === 'overview' && (
              <div>
                <div className="superadmin-kpi-grid" style={{ marginBottom: '18px' }}>
                  <div className="superadmin-kpi-card">
                    <span className="superadmin-kpi-icon blue"><Icon name="grid" size={20} /></span>
                    <div className="superadmin-kpi-body">
                      <small>PHÂN HIỆU / HẠN MỨC</small>
                      <strong>{report.campuses.length} / {school.quotas.maxCampuses} cơ sở</strong>
                      <span className="superadmin-kpi-sub">{report.classrooms.length} lớp học đang mở</span>
                    </div>
                  </div>
                  <div className="superadmin-kpi-card">
                    <span className="superadmin-kpi-icon purple"><Icon name="students" size={20} /></span>
                    <div className="superadmin-kpi-body">
                      <small>HỌC SINH ĐANG HỌC / HẠN MỨC</small>
                      <strong>{(report.students.enrolled || 0) + (report.students.temporarily_absent || 0)} / {school.quotas.maxStudents}</strong>
                      <span className="superadmin-kpi-sub">
                        Bảo lưu: {report.students.temporarily_absent || 0} · Đã nghỉ: {report.students.withdrawn || 0}
                      </span>
                    </div>
                  </div>
                  <div className="superadmin-kpi-card">
                    <span className="superadmin-kpi-icon green"><Icon name="attendance" size={20} /></span>
                    <div className="superadmin-kpi-body">
                      <small>ĐIỂM DANH HÔM NAY ({report.attendance.today._id})</small>
                      <strong>{(report.attendance.today.present || 0) + (report.attendance.today.late || 0)} có mặt</strong>
                      <span className="superadmin-kpi-sub">
                        Nghỉ phép: {report.attendance.today.absentPermission || 0} · Không phép: {report.attendance.today.absentUnexcused || 0}
                      </span>
                    </div>
                  </div>
                  <div className="superadmin-kpi-card">
                    <span className="superadmin-kpi-icon amber"><Icon name="money" size={20} /></span>
                    <div className="superadmin-kpi-body">
                      <small>TỶ LỆ THU HỌC PHÍ</small>
                      <strong>{report.finance.summary.collectionRatePercent}%</strong>
                      <span className="superadmin-kpi-sub">
                        Đã thu: {formatCurrency(report.finance.summary.totalCollected)}
                      </span>
                    </div>
                  </div>
                </div>

                <section className="content-card" style={{ padding: '16px 20px', marginBottom: '16px' }}>
                  <p className="card-kicker" style={{ marginBottom: '8px' }}>
                    PHÂN HỆ CHỨC NĂNG ĐANG ĐƯỢC CẤP PHÉP ({school.enabledModules.length}/{moduleCatalog.length || 14})
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {school.enabledModules.map((modKey) => (
                      <span
                        key={modKey}
                        style={{
                          padding: '5px 11px',
                          borderRadius: '999px',
                          background: '#eff6ff',
                          border: '1px solid #bfdbfe',
                          color: '#1e40af',
                          fontSize: '12.5px',
                          fontWeight: 600
                        }}
                      >
                        ✓ {moduleMap.get(modKey) || modKey}
                      </span>
                    ))}
                  </div>
                </section>

                <section className="content-card student-list-card" style={{ marginBottom: '16px' }}>
                  <div className="list-toolbar">
                    <div>
                      <p className="card-kicker">CẤU TRÚC CƠ SỞ VẬT CHẤT</p>
                      <h3 style={{ margin: '2px 0' }}>Danh sách Phân hiệu / Cơ sở trực thuộc</h3>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Mã cơ sở</th>
                          <th>Tên phân hiệu</th>
                          <th>Địa chỉ & SĐT</th>
                          <th>Phụ trách & Giờ mở cửa</th>
                          <th>Số lớp / Sĩ số</th>
                          <th>Lấp đầy</th>
                          <th>Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.campuses.map((c) => (
                          <tr key={c.code + c.name}>
                            <td><strong>{c.code}</strong></td>
                            <td><strong>{c.name}</strong></td>
                            <td>
                              <div>{c.address || 'Chưa khai báo địa chỉ'}</div>
                              {c.phone && <small style={{ color: '#64748b' }}>SĐT: {c.phone}</small>}
                            </td>
                            <td>
                              <div>{c.managerName || '—'}</div>
                              <small style={{ color: '#64748b' }}>Giờ: {c.openTime} – {c.closeTime}</small>
                            </td>
                            <td>
                              <strong>{c.classCount} lớp</strong> · {c.studentCount}/{c.capacity || 0} HS
                            </td>
                            <td><strong>{c.occupancyPercent}%</strong></td>
                            <td>
                              <span className={`student-status ${c.isActive ? 'enrolled' : 'temporarily_absent'}`}>
                                {c.isActive ? 'Hoạt động' : 'Tạm ngưng'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="content-card student-list-card">
                  <div className="list-toolbar">
                    <div>
                      <p className="card-kicker">BAN ĐIỀU HÀNH NHÀ TRƯỜNG</p>
                      <h3 style={{ margin: '2px 0' }}>Tài khoản Admin trường & Ban Giám hiệu</h3>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Tài khoản</th>
                          <th>Họ và tên</th>
                          <th>Vai trò</th>
                          <th>Liên hệ</th>
                          <th>Đăng nhập gần nhất</th>
                          <th>Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.leadershipAccounts.length === 0 ? (
                          <tr>
                            <td colSpan={6} style={{ textAlign: 'center', color: '#64748b' }}>
                              Chưa có tài khoản quản trị hoặc hiệu trưởng nào.
                            </td>
                          </tr>
                        ) : (
                          report.leadershipAccounts.map((acc) => (
                            <tr key={acc._id}>
                              <td><strong>@{acc.username}</strong></td>
                              <td>{acc.fullName}</td>
                              <td>{ROLE_LABELS[acc.role] || acc.role}</td>
                              <td>{acc.phone || acc.email || '—'}</td>
                              <td>{formatDateTime(acc.lastLogin)}</td>
                              <td>
                                <span className={`student-status ${acc.status === 'active' ? 'enrolled' : 'withdrawn'}`}>
                                  {acc.status === 'active' ? 'Hoạt động' : 'Đã khóa'}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'classes' && (
              <div>
                <section className="content-card student-list-card" style={{ marginBottom: '18px' }}>
                  <div className="list-toolbar">
                    <div>
                      <p className="card-kicker">CHUYÊN CẦN 7 NGÀY GẦN NHẤT</p>
                      <h3 style={{ margin: '2px 0' }}>Thống kê điểm danh học sinh theo ngày</h3>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Ngày học</th>
                          <th>Có mặt đúng giờ</th>
                          <th>Đi muộn</th>
                          <th>Nghỉ có phép</th>
                          <th>Nghỉ không phép</th>
                          <th>Tổng ghi nhận</th>
                          <th>Tỷ lệ đi học</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.attendance.last7Days.length === 0 ? (
                          <tr>
                            <td colSpan={7} style={{ textAlign: 'center', color: '#64748b' }}>
                              Chưa phát sinh dữ liệu điểm danh trong 7 ngày qua.
                            </td>
                          </tr>
                        ) : (
                          report.attendance.last7Days.map((row) => {
                            const rate = row.total > 0 ? Math.round(((row.present + row.late) / row.total) * 100) : 0;
                            return (
                              <tr key={row._id}>
                                <td><strong>{row._id}</strong></td>
                                <td style={{ color: '#15803d', fontWeight: 700 }}>{row.present}</td>
                                <td style={{ color: '#b45309', fontWeight: 600 }}>{row.late}</td>
                                <td>{row.absentPermission}</td>
                                <td style={{ color: row.absentUnexcused > 0 ? '#b91c1c' : undefined }}>
                                  {row.absentUnexcused}
                                </td>
                                <td>{row.total}</td>
                                <td><strong>{rate}%</strong></td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="content-card student-list-card">
                  <div className="list-toolbar">
                    <div>
                      <p className="card-kicker">DANH MỤC LỚP HỌC ĐANG MỞ</p>
                      <h3 style={{ margin: '2px 0' }}>Chi tiết sĩ số & Giáo viên chủ nhiệm từng lớp</h3>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Tên lớp</th>
                          <th>Độ tuổi</th>
                          <th>Phân hiệu</th>
                          <th>Giáo viên chủ nhiệm</th>
                          <th>Sĩ số / Tối đa</th>
                          <th>Trẻ có lưu ý dị ứng</th>
                          <th>Lấp đầy</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.classrooms.length === 0 ? (
                          <tr>
                            <td colSpan={7} style={{ textAlign: 'center', color: '#64748b' }}>
                              Trường chưa mở lớp học nào.
                            </td>
                          </tr>
                        ) : (
                          report.classrooms.map((cls) => (
                            <tr key={cls._id}>
                              <td><strong>{cls.name}</strong></td>
                              <td>{cls.ageGroup}</td>
                              <td>{cls.campus}</td>
                              <td>{cls.homeroomTeacher}</td>
                              <td><strong>{cls.studentCount}</strong> / {cls.capacity}</td>
                              <td>
                                {cls.allergyCount > 0 ? (
                                  <span style={{ color: '#b45309', fontWeight: 700 }}>{cls.allergyCount} trẻ</span>
                                ) : (
                                  '0'
                                )}
                              </td>
                              <td><strong>{cls.occupancyPercent}%</strong></td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'finance' && (
              <div>
                <div className="superadmin-kpi-grid" style={{ marginBottom: '18px' }}>
                  <div className="superadmin-kpi-card">
                    <span className="superadmin-kpi-icon blue"><Icon name="money" size={20} /></span>
                    <div className="superadmin-kpi-body">
                      <small>TỔNG PHẢI THU HỌC PHÍ</small>
                      <strong>{formatCurrency(report.finance.summary.totalBilled)}</strong>
                      <span className="superadmin-kpi-sub">{report.finance.summary.invoiceCount} phiếu báo thu</span>
                    </div>
                  </div>
                  <div className="superadmin-kpi-card">
                    <span className="superadmin-kpi-icon green"><Icon name="check" size={20} /></span>
                    <div className="superadmin-kpi-body">
                      <small>THỰC THU ĐÃ GHI NHẬN</small>
                      <strong>{formatCurrency(report.finance.summary.totalCollected)}</strong>
                      <span className="superadmin-kpi-sub">Đạt {report.finance.summary.collectionRatePercent}% kế hoạch</span>
                    </div>
                  </div>
                  <div className="superadmin-kpi-card">
                    <span className="superadmin-kpi-icon rose"><Icon name="alertCircle" size={20} /></span>
                    <div className="superadmin-kpi-body">
                      <small>CÔNG NỢ CÒN PHẢI THU</small>
                      <strong>{formatCurrency(report.finance.summary.outstandingDebt)}</strong>
                      <span className="superadmin-kpi-sub">Chưa thu / thu một phần</span>
                    </div>
                  </div>
                  <div className="superadmin-kpi-card">
                    <span className="superadmin-kpi-icon amber"><Icon name="chart" size={20} /></span>
                    <div className="superadmin-kpi-body">
                      <small>TỔNG CHI VẬN HÀNH & LƯƠNG</small>
                      <strong>
                        {formatCurrency(
                          (report.finance.summary.totalOperatingExpenses || 0) +
                          (report.finance.summary.totalPayrollPaid || 0)
                        )}
                      </strong>
                      <span className="superadmin-kpi-sub">
                        Vận hành: {formatCurrency(report.finance.summary.totalOperatingExpenses)}
                      </span>
                    </div>
                  </div>
                </div>

                <section className="content-card student-list-card" style={{ marginBottom: '18px' }}>
                  <div className="list-toolbar">
                    <div>
                      <p className="card-kicker">THEO KỲ KẾ TOÁN</p>
                      <h3 style={{ margin: '2px 0' }}>Tổng hợp thu học phí theo từng tháng</h3>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Kỳ thu (MM-YYYY)</th>
                          <th>Số hóa đơn</th>
                          <th>Tổng phải thu</th>
                          <th>Đã thu</th>
                          <th>Hoàn tất</th>
                          <th>Thu 1 phần</th>
                          <th>Chưa nộp</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.finance.byPeriod.length === 0 ? (
                          <tr>
                            <td colSpan={7} style={{ textAlign: 'center', color: '#64748b' }}>
                              Chưa phát sinh kỳ thu học phí nào.
                            </td>
                          </tr>
                        ) : (
                          report.finance.byPeriod.map((p) => (
                            <tr key={p._id}>
                              <td><strong>{p._id}</strong></td>
                              <td>{p.invoiceCount}</td>
                              <td>{formatCurrency(p.totalBilled)}</td>
                              <td style={{ color: '#15803d', fontWeight: 700 }}>{formatCurrency(p.totalCollected)}</td>
                              <td>{p.paidCount}</td>
                              <td>{p.partialCount}</td>
                              <td style={{ color: p.unpaidCount > 0 ? '#b91c1c' : undefined }}>{p.unpaidCount}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="content-card student-list-card">
                  <div className="list-toolbar">
                    <div>
                      <p className="card-kicker">QUỸ LƯƠNG NHÂN SỰ</p>
                      <h3 style={{ margin: '2px 0' }}>Lịch sử bảng lương các kỳ gần nhất</h3>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Kỳ lương</th>
                          <th>Số nhân sự tính lương</th>
                          <th>Tổng thực lĩnh (Net Salary)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.finance.payrollHistory.length === 0 ? (
                          <tr>
                            <td colSpan={3} style={{ textAlign: 'center', color: '#64748b' }}>
                              Chưa phát sinh bảng lương nào.
                            </td>
                          </tr>
                        ) : (
                          report.finance.payrollHistory.map((pr) => (
                            <tr key={`${pr._id.month}-${pr._id.year}`}>
                              <td><strong>Tháng {String(pr._id.month).padStart(2, '0')}/{pr._id.year}</strong></td>
                              <td>{pr.staffCount} nhân sự</td>
                              <td><strong>{formatCurrency(pr.totalNetSalary)}</strong></td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'safety' && (
              <div>
                <div className="superadmin-two-col">
                  <section className="content-card student-list-card">
                    <div className="list-toolbar">
                      <div>
                        <p className="card-kicker">AN TOÀN VỆ SINH THỰC PHẨM</p>
                        <h3 style={{ margin: '2px 0' }}>Nhật ký lưu mẫu thức ăn 24h gần nhất</h3>
                      </div>
                    </div>
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Mã mẫu</th>
                            <th>Món lưu</th>
                            <th>Nhiệt độ</th>
                            <th>Trạng thái</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.kitchenAndFeedback.recentFoodSamples.length === 0 ? (
                            <tr>
                              <td colSpan={4} style={{ textAlign: 'center', color: '#64748b' }}>
                                Chưa có bản ghi lưu mẫu thức ăn.
                              </td>
                            </tr>
                          ) : (
                            report.kitchenAndFeedback.recentFoodSamples.map((smp) => (
                              <tr key={smp._id}>
                                <td><strong>{smp.sampleCode}</strong></td>
                                <td>{smp.dishName}</td>
                                <td>{smp.storageTemperature}°C</td>
                                <td>
                                  <span
                                    className={`student-status ${
                                      ['sent_to_lab', 'investigating'].includes(smp.status) ? 'withdrawn' : 'enrolled'
                                    }`}
                                  >
                                    {SAMPLE_STATUS_LABELS[smp.status] || smp.status}
                                  </span>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="content-card student-list-card">
                    <div className="list-toolbar">
                      <div>
                        <p className="card-kicker">PHÂN BỔ TÀI KHOẢN THEO VAI TRÒ</p>
                        <h3 style={{ margin: '2px 0' }}>Hoạt động đăng nhập theo từng bộ phận</h3>
                      </div>
                    </div>
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Vai trò</th>
                            <th>Đang hoạt động / Tổng</th>
                            <th>Hoạt động gần nhất</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.accountsByRole.length === 0 ? (
                            <tr>
                              <td colSpan={3} style={{ textAlign: 'center', color: '#64748b' }}>
                                Chưa có tài khoản người dùng.
                              </td>
                            </tr>
                          ) : (
                            report.accountsByRole.map((r) => (
                              <tr key={r._id}>
                                <td><strong>{ROLE_LABELS[r._id] || r._id}</strong></td>
                                <td><strong>{r.active}</strong> / {r.total}</td>
                                <td>{formatDateTime(r.lastLogin)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>

                <section className="content-card student-list-card">
                  <div className="list-toolbar">
                    <div>
                      <p className="card-kicker">TIẾP NHẬN Ý KIẾN PHỤ HUYNH</p>
                      <h3 style={{ margin: '2px 0' }}>Phản hồi & Kiến nghị gần nhất từ Phụ huynh</h3>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Phụ huynh / Học sinh</th>
                          <th>Lớp</th>
                          <th>Tiêu đề phản hồi</th>
                          <th>Thời gian gửi</th>
                          <th>Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.kitchenAndFeedback.openFeedbacks.length === 0 ? (
                          <tr>
                            <td colSpan={5} style={{ textAlign: 'center', color: '#64748b' }}>
                              Không có phản hồi phụ huynh tồn đọng.
                            </td>
                          </tr>
                        ) : (
                          report.kitchenAndFeedback.openFeedbacks.map((fb) => (
                            <tr key={fb._id}>
                              <td>
                                <strong>{fb.parentName}</strong>
                                <small style={{ display: 'block', color: '#64748b' }}>Bé: {fb.studentName}</small>
                              </td>
                              <td>{fb.className || '—'}</td>
                              <td>{fb.subject}</td>
                              <td>{formatDateTime(fb.createdAt)}</td>
                              <td>
                                <span
                                  className={`student-status ${
                                    ['responded', 'closed'].includes(fb.status) ? 'enrolled' : 'temporarily_absent'
                                  }`}
                                >
                                  {fb.status === 'pending'
                                    ? 'Chờ phản hồi'
                                    : fb.status === 'in_progress'
                                      ? 'Đang xử lý'
                                      : 'Đã giải quyết'}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

