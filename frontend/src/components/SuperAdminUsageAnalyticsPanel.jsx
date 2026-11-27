import { useMemo, useState } from 'react';
import Icon from './Icon';
import {
  CashflowDonutChart,
  EconomicPeriodChart,
  RoleDistributionChart,
  SchoolComparisonBarChart
} from './SuperAdminCharts';

const formatCurrency = (val) => `${new Intl.NumberFormat('vi-VN').format(Number(val) || 0)} đ`;

const formatDateShort = (val) => {
  if (!val) return 'Chưa có';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export default function SuperAdminUsageAnalyticsPanel({
  summary = {},
  economicTrend = [],
  roleDistribution = [],
  schools = [],
  onOpenReport,
  onOpenSchoolLogs,
  onEnterSchool
}) {
  const [query, setQuery] = useState('');
  const [tierFilter, setTierFilter] = useState('all');

  const filteredSchools = useMemo(() => {
    const q = query.trim().toLowerCase();
    return schools.filter((s) => {
      if (tierFilter !== 'all' && s.usage?.usageTier !== tierFilter) return false;
      if (!q) return true;
      return (
        String(s.code || '').toLowerCase().includes(q) ||
        String(s.name || '').toLowerCase().includes(q)
      );
    });
  }, [schools, query, tierFilter]);

  const usageSummary = useMemo(() => {
    if (!schools.length) {
      return { avgUsagePercent: 0, totalWebhookEvents: 0, totalDevices: 0, totalLogins7d: 0 };
    }
    const sumUsage = schools.reduce((s, item) => s + (item.usage?.usageScorePercent || 0), 0);
    const totalWebhookEvents = schools.reduce((s, item) => s + (item.webhook?.totalEvents || 0), 0);
    const totalDevices = schools.reduce((s, item) => s + (item.webhook?.devicesCount || 0), 0);
    const totalLogins7d = schools.reduce((s, item) => s + (item.usage?.logins7dCount || 0), 0);
    return {
      avgUsagePercent: Math.round(sumUsage / schools.length),
      totalWebhookEvents,
      totalDevices,
      totalLogins7d
    };
  }, [schools]);

  const handleExportCsv = () => {
    const headers = [
      'Mã trường',
      'Tên trường',
      'Trạng thái',
      'Mức độ sử dụng (%)',
      'Xếp hạng khai thác',
      'Số phân hiệu',
      'Số lớp',
      'Học sinh đang học',
      'Hạn mức học sinh',
      'Nhân sự đang làm',
      'Tài khoản Active',
      'Đăng nhập 7 ngày',
      'Bản ghi điểm danh 30 ngày',
      'Thực đơn bếp',
      'Mẫu lưu thức ăn',
      'Thiết bị chấm công',
      'Sự kiện Webhook',
      'Phải thu học phí (VND)',
      'Thực thu học phí (VND)',
      'Công nợ (VND)',
      'Tổng chi phí & Lương (VND)',
      'URL Webhook'
    ];

    const escapeCsv = (val) => {
      const str = String(val ?? '');
      if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
      return str;
    };

    const rows = filteredSchools.map((s) => [
      s.code,
      s.name,
      s.status === 'active' ? 'Hoạt động' : 'Tạm ngưng',
      s.usage?.usageScorePercent || 0,
      s.usage?.usageTier || 'Mới khởi tạo',
      s.campusCount || 0,
      s.classCount || 0,
      s.studentCount || 0,
      s.quotas?.maxStudents || 800,
      s.staffCount || 0,
      s.accountStats?.activeAccounts || 0,
      s.usage?.logins7dCount || 0,
      s.attendance?.records30dCount || 0,
      s.usage?.menusCount || 0,
      s.usage?.foodSamplesCount || 0,
      s.webhook?.devicesCount || 0,
      s.webhook?.totalEvents || 0,
      s.finance?.totalBilled || 0,
      s.finance?.totalCollected || 0,
      s.finance?.outstandingDebt || 0,
      s.finance?.totalExpenditure || 0,
      `${window.location.origin}${s.webhook?.endpointPath || `/api/attendance/webhook/${s.code}`}`
    ]);

    const csvContent = '\uFEFF' + [headers, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Bao-cao-thong-ke-su-dung-cac-truong-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* DẢI KPI KINH TẾ & MỨC ĐỘ KHAI THÁC */}
      <div className="superadmin-kpi-grid">
        <article className="superadmin-kpi-card">
          <span className="superadmin-kpi-icon green"><Icon name="money" size={21} /></span>
          <div className="superadmin-kpi-body">
            <small>TỔNG THỰC THU TOÀN CHUỖI</small>
            <strong>{formatCurrency(summary.totalCollected)}</strong>
            <span className="superadmin-kpi-sub">
              Phải thu: {formatCurrency(summary.totalBilled)} ({summary.overallCollectionRatePercent || 0}%)
            </span>
          </div>
        </article>

        <article className="superadmin-kpi-card">
          <span className="superadmin-kpi-icon amber"><Icon name="chart" size={21} /></span>
          <div className="superadmin-kpi-body">
            <small>TỔNG CHI VẬN HÀNH & LƯƠNG</small>
            <strong>{formatCurrency(summary.totalExpenditure)}</strong>
            <span className="superadmin-kpi-sub">
              Dòng tiền ròng: {formatCurrency((summary.totalCollected || 0) - (summary.totalExpenditure || 0))}
            </span>
          </div>
        </article>

        <article className="superadmin-kpi-card">
          <span className="superadmin-kpi-icon rose"><Icon name="alertCircle" size={21} /></span>
          <div className="superadmin-kpi-body">
            <small>CÔNG NỢ HỌC PHÍ CHƯA THU</small>
            <strong>{formatCurrency(summary.totalOutstandingDebt)}</strong>
            <span className="superadmin-kpi-sub">
              Cần đôn đốc kế toán các trường đối soát
            </span>
          </div>
        </article>

        <article className="superadmin-kpi-card">
          <span className="superadmin-kpi-icon blue"><Icon name="activity" size={21} /></span>
          <div className="superadmin-kpi-body">
            <small>MỨC ĐỘ SỬ DỤNG TRUNG BÌNH</small>
            <strong>{usageSummary.avgUsagePercent}% tính năng</strong>
            <span className="superadmin-kpi-sub">
              {usageSummary.totalLogins7d} tài khoản đăng nhập trong 7 ngày qua
            </span>
          </div>
        </article>

        <article className="superadmin-kpi-card">
          <span className="superadmin-kpi-icon purple"><Icon name="users" size={21} /></span>
          <div className="superadmin-kpi-body">
            <small>NHÂN SỰ & PHỤ HUYNH TOÀN HỆ THỐNG</small>
            <strong>{summary.totalActiveAccounts || 0} tài khoản</strong>
            <span className="superadmin-kpi-sub">
              {summary.totalStaff || 0} nhân sự · {summary.totalStudents || 0} học sinh
            </span>
          </div>
        </article>

        <article className="superadmin-kpi-card">
          <span className="superadmin-kpi-icon teal"><Icon name="clock" size={21} /></span>
          <div className="superadmin-kpi-body">
            <small>ĐỒNG BỘ MÁY CHẤM CÔNG WEBHOOK</small>
            <strong>{usageSummary.totalWebhookEvents} lượt đẩy</strong>
            <span className="superadmin-kpi-sub">
              {usageSummary.totalDevices} thiết bị đăng ký trên các trường
            </span>
          </div>
        </article>
      </div>

      {/* HÀNG BIỂU ĐỒ 1: KINH TẾ THEO KỲ & DÒNG TIỀN */}
      <div className="superadmin-two-col">
        <section className="content-card" style={{ padding: '20px 22px' }}>
          <p className="card-kicker">BIỂU ĐỒ TÀI CHÍNH & HỌC PHÍ THEO KỲ</p>
          <h2 style={{ margin: '2px 0 4px' }}>Đối chiếu Phải thu – Thực thu – Chi phí</h2>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#64748b' }}>
            Di chuột vào từng cột kỳ để xem chi tiết số tiền thu học phí và chi lương/vận hành.
          </p>
          <EconomicPeriodChart economicTrend={economicTrend} schools={schools} />
        </section>

        <section className="content-card" style={{ padding: '20px 22px' }}>
          <p className="card-kicker">CƠ CẤU TÀI CHÍNH TOÀN HỆ THỐNG</p>
          <h2 style={{ margin: '2px 0 4px' }}>Tỷ trọng Thực thu, Công nợ & Chi phí</h2>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#64748b' }}>
            Tổng hợp sức khỏe dòng tiền ròng cộng gộp từ tất cả các trường thành viên.
          </p>
          <CashflowDonutChart
            collected={summary.totalCollected}
            outstanding={summary.totalOutstandingDebt}
            expenditure={summary.totalExpenditure}
          />
        </section>
      </div>

      {/* HÀNG BIỂU ĐỒ 2: SO SÁNH MỨC ĐỘ SỬ DỤNG TỪNG TRƯỜNG & CƠ CẤU VAI TRÒ */}
      <div className="superadmin-two-col">
        <section className="content-card" style={{ padding: '20px 22px' }}>
          <p className="card-kicker">SO SÁNH GIỮA CÁC TRƯỜNG TRONG CHUỖI</p>
          <h2 style={{ margin: '2px 0 4px' }}>Biểu đồ Mức độ Khai thác (%) & Doanh thu từng trường</h2>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#64748b' }}>
            Thanh xanh dương thể hiện tỷ lệ khai thác nghiệp vụ; thanh xanh lá thể hiện tiến độ thu học phí.
          </p>
          <SchoolComparisonBarChart schools={schools} />
        </section>

        <section className="content-card" style={{ padding: '20px 22px' }}>
          <p className="card-kicker">PHÂN BỐ TÀI KHOẢN THEO VAI TRÒ</p>
          <h2 style={{ margin: '2px 0 4px' }}>Cơ cấu nhân sự & phụ huynh các trường đã tạo</h2>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#64748b' }}>
            Thống kê các tài khoản Ban Giám đốc, Giáo viên, Đầu bếp, Kế toán, Nhân sự, Bảo vệ do Admin trường khởi tạo.
          </p>
          <RoleDistributionChart roleDistribution={roleDistribution} />
        </section>
      </div>

      {/* BẢNG BÁO CÁO THỐNG KÊ CHI TIẾT TỪNG TRƯỜNG SỬ DỤNG NHƯ THẾ NÀO */}
      <section className="content-card student-list-card">
        <div className="list-toolbar">
          <div>
            <p className="card-kicker">BÁO CÁO THỐNG KÊ SỬ DỤNG HỆ THỐNG CỦA TỪNG TRƯỜNG</p>
            <h2>Chi tiết mức độ vận hành thực tế ({filteredSchools.length} trường)</h2>
            <p>
              Theo dõi từng trường đang sử dụng các phân hệ Điểm danh, Học phí, Bếp ăn, Tài khoản nhân sự và Webhook chấm công như thế nào.
            </p>
          </div>
          <button type="button" className="button button-primary" onClick={handleExportCsv}>
            <Icon name="download" size={15} /> Xuất báo cáo Excel (CSV)
          </button>
        </div>

        <div className="student-filters" style={{ padding: '0 22px 16px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label className="search-box" style={{ flex: '1 1 280px' }}>
            <Icon name="search" size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theo mã trường hoặc tên trường..."
            />
          </label>
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #cbd5e1', background: '#fff' }}
          >
            <option value="all">Mọi mức độ khai thác</option>
            <option value="Sôi nổi">Đang khai thác sôi nổi (&ge; 75%)</option>
            <option value="Đang triển khai">Đang triển khai (40% – 74%)</option>
            <option value="Mới khởi tạo">Mới khởi tạo (&lt; 40%)</option>
          </select>
        </div>

        <div className="table-wrap">
          <table className="data-table sa-clean-table">
            <thead>
              <tr>
                <th>Trường học</th>
                <th>Mức độ sử dụng</th>
                <th>Hạn mức HS & Lớp</th>
                <th>Tài khoản & Đăng nhập</th>
                <th>Điểm danh & Bếp ăn</th>
                <th>Webhook Chấm công</th>
                <th>Kinh tế (Thực thu / Nợ)</th>
                <th>Thao tác nhanh</th>
              </tr>
            </thead>
            <tbody>
              {filteredSchools.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '28px 0', color: '#64748b' }}>
                    Không có trường học nào khớp điều kiện lọc.
                  </td>
                </tr>
              ) : (
                filteredSchools.map((s) => (
                  <tr key={s._id}>
                    <td>
                      <strong style={{ color: '#1d4ed8' }}>{s.code}</strong> · <strong>{s.name}</strong>
                      <small>{s.campusCount}/{s.quotas?.maxCampuses || 10} phân hiệu · {s.enabledModules?.length || 14} phân hệ</small>
                    </td>
                    <td style={{ minWidth: 145 }}>
                      <div>
                        <strong>{s.usage?.usageScorePercent || 0}%</strong> · <span style={{ fontSize: 12, color: '#475569' }}>{s.usage?.usageTier}</span>
                      </div>
                      <div className="superadmin-progress-track">
                        <div
                          className={`superadmin-progress-fill ${(s.usage?.usageScorePercent || 0) >= 75 ? 'green' : 'blue'}`}
                          style={{ width: `${s.usage?.usageScorePercent || 0}%` }}
                        />
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <strong>{s.studentCount} / {s.quotas?.maxStudents || 800} HS</strong>
                      <small>{s.classCount} lớp ({s.occupancyPercent}% sức chứa)</small>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <strong>{s.accountStats?.activeAccounts || 0} TK active</strong>
                      <small>{s.usage?.logins7dCount || 0} đăng nhập 7N · {s.usage?.auditLogs30d || 0} log 30N</small>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <strong>{s.attendance?.records30dCount || 0} lượt ĐD (30N)</strong>
                      <small>{s.usage?.menusCount || 0} thực đơn · {s.usage?.foodSamplesCount || 0} mẫu bếp</small>
                    </td>
                    <td>
                      <strong>{s.webhook?.processedEvents || 0}/{s.webhook?.totalEvents || 0} gói tin</strong>
                      <small>
                        {s.webhook?.devicesCount || 0} máy · Cuối: {formatDateShort(s.webhook?.lastWebhookAt)}
                      </small>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <strong style={{ color: '#15803d' }}>{formatCurrency(s.finance?.totalCollected)}</strong>
                      <small style={{ color: (s.finance?.outstandingDebt || 0) > 0 ? '#be123c' : '#64748b' }}>
                        Nợ: {formatCurrency(s.finance?.outstandingDebt)}
                      </small>
                    </td>
                    <td>
                      <div className="classroom-actions" style={{ flexWrap: 'wrap' }}>
                        <button type="button" className="button button-secondary" onClick={() => onOpenSchoolLogs?.(s._id, 'school_audit')}>
                          Xem Log
                        </button>
                        <button type="button" className="button button-secondary" onClick={() => onOpenReport?.(s._id)}>
                          Báo cáo 360°
                        </button>
                        {s.status === 'active' && (
                          <button type="button" className="button button-primary" onClick={() => onEnterSchool?.(s)}>
                            Điều hành
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

