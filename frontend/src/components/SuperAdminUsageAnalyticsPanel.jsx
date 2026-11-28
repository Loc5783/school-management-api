import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import {
  AddonAdoptionChart,
  PlatformGrowthTimelineChart,
  RoleDistributionChart,
  SaasRevenueBreakdownDonut
} from './SuperAdminCharts';
import { formatCompactVnd, formatFullVnd } from '../utils/currencyFormatters';
import {
  getSuperAdminGrowthReport,
  updateSuperAdminSystemSettings
} from '../api/multiSchool';

const RANGE_OPTIONS = [
  { key: '7d', label: '7 ngày qua' },
  { key: '30d', label: '30 ngày qua' },
  { key: '6m', label: '6 tháng' },
  { key: '12m', label: '12 tháng / Năm học' }
];

const METRIC_TABS = [
  { key: 'schools', label: 'Số trường sử dụng' },
  { key: 'accounts', label: 'Tài khoản người dùng' },
  { key: 'students', label: 'Học sinh tính phí' },
  { key: 'arr', label: 'Doanh thu ARR' }
];

const PLAN_LABELS = {
  professional: 'Gói Toàn diện',
  standard: 'Gói Tiêu chuẩn',
  enterprise: 'Gói Chuỗi trường',
  trial: 'Dùng thử'
};

const formatInt = (val) => new Intl.NumberFormat('vi-VN').format(Math.round(Number(val) || 0));

const formatDateShort = (val) => {
  if (!val) return 'Chưa ghi nhận';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
};

/**
 * Trang Báo cáo Tổng kết & Tăng trưởng Kinh doanh dành riêng cho Nhà cung cấp Hệ thống (`SuperAdmin`).
 *
 * Tập trung 100% vào các chỉ số cốt lõi của đơn vị phân phối SaaS:
 * 1. Tăng trưởng số lượng trường sử dụng, tài khoản & học sinh theo từng mốc thời gian (`7d`, `30d`, `6m`, `12m`).
 * 2. Thống kê chi tiết số lượng tài khoản sử dụng ở từng trường (Admin, Giáo viên, Kế toán, Bếp, Nhân sự, Phụ huynh).
 * 3. Mô hình định giá linh hoạt theo Học sinh/năm + Các gói Add-on bán kèm (Bếp ăn & Dinh dưỡng, Đón trả trẻ QR, Máy chấm công...).
 */
export default function SuperAdminUsageAnalyticsPanel({
  summary = {},
  addonAdoption = [],
  saasPricing = null,
  roleDistribution = [],
  schools = [],
  onOpenReport,
  onOpenConfig,
  onOpenAccounts,
  onEnterSchool,
  onPricingSaved
}) {
  const [range, setRange] = useState('12m');
  const [growthMetric, setGrowthMetric] = useState('schools');
  const [growthData, setGrowthData] = useState({ timeline: [], rangeSummary: {} });
  const [loadingGrowth, setLoadingGrowth] = useState(true);

  const [query, setQuery] = useState('');
  const [planFilter, setPlanFilter] = useState('all');

  // Khung cấu hình nhanh Bảng giá Học sinh/năm & Giá bán từng Add-on ngay trên trang Báo cáo
  const [showPricingDrawer, setShowPricingDrawer] = useState(false);
  const [pricingDraft, setPricingDraft] = useState(() => ({
    basePricePerStudentYear: saasPricing?.basePricePerStudentYear ?? 120000,
    minBillableStudentsPerSchool: saasPricing?.minBillableStudentsPerSchool ?? 30,
    addonCatalog: Array.isArray(saasPricing?.addonCatalog) ? saasPricing.addonCatalog : []
  }));
  const [savingPricing, setSavingPricing] = useState(false);
  const savingPricingLockRef = useRef(false);
  const [pricingNotice, setPricingNotice] = useState(null);

  const loadGrowth = useCallback(async (targetRange) => {
    setLoadingGrowth(true);
    try {
      const res = await getSuperAdminGrowthReport(targetRange);
      const payload = res.data?.data || {};
      setGrowthData({
        timeline: payload.timeline || [],
        rangeSummary: payload.rangeSummary || {}
      });
    } catch {
      setGrowthData({ timeline: [], rangeSummary: {} });
    } finally {
      setLoadingGrowth(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadGrowth(range);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [range, loadGrowth]);

  const openPricingEditor = () => {
    setPricingNotice(null);
    setPricingDraft({
      basePricePerStudentYear: saasPricing?.basePricePerStudentYear ?? 120000,
      minBillableStudentsPerSchool: saasPricing?.minBillableStudentsPerSchool ?? 30,
      addonCatalog: (saasPricing?.addonCatalog || []).map((item) => ({ ...item }))
    });
    setShowPricingDrawer((prev) => !prev);
  };

  const handleAddonDraftChange = (moduleKey, field, value) => {
    setPricingDraft((prev) => ({
      ...prev,
      addonCatalog: prev.addonCatalog.map((item) =>
        item.moduleKey === moduleKey
          ? {
              ...item,
              [field]: field === 'price' ? Math.max(0, Number(value) || 0) : value
            }
          : item
      )
    }));
  };

  const handleSavePricingPolicy = async (e) => {
    e.preventDefault();
    if (savingPricingLockRef.current || savingPricing) return;
    savingPricingLockRef.current = true;
    setSavingPricing(true);
    setPricingNotice(null);
    try {
      await updateSuperAdminSystemSettings({
        saasPricing: {
          basePricePerStudentYear: Math.max(0, Math.round(Number(pricingDraft.basePricePerStudentYear) || 0)),
          minBillableStudentsPerSchool: Math.max(0, Math.round(Number(pricingDraft.minBillableStudentsPerSchool) || 0)),
          addonCatalog: pricingDraft.addonCatalog.map((a) => ({
            moduleKey: a.moduleKey,
            pricingMode: a.pricingMode,
            price: Math.max(0, Math.round(Number(a.price) || 0))
          }))
        }
      });
      setPricingNotice({
        type: 'success',
        text: 'Đã lưu Bảng giá Học sinh/năm & danh mục Gói Add-on. Toàn bộ doanh thu ước tính đã được tính lại!'
      });
      await onPricingSaved?.();
      await loadGrowth(range);
    } catch (err) {
      setPricingNotice({
        type: 'error',
        text: err.response?.data?.message || 'Không thể lưu cấu hình bảng giá SaaS.'
      });
    } finally {
      savingPricingLockRef.current = false;
      setSavingPricing(false);
    }
  };

  const filteredSchools = useMemo(() => {
    const q = query.trim().toLowerCase();
    return schools.filter((s) => {
      if (planFilter !== 'all' && (s.subscriptionPlan || 'professional') !== planFilter) return false;
      if (!q) return true;
      return (
        String(s.code || '').toLowerCase().includes(q) ||
        String(s.name || '').toLowerCase().includes(q) ||
        String(s.representativeName || '').toLowerCase().includes(q)
      );
    });
  }, [schools, query, planFilter]);

  const handleExportSummaryCsv = () => {
    const headers = [
      'Mã trường',
      'Tên trường',
      'Trạng thái',
      'Gói hợp đồng',
      'Ngày tham gia',
      'Thời hạn bản quyền',
      'Tổng tài khoản đang dùng',
      'TK Admin trường',
      'TK Giáo viên',
      'TK Kế toán & HR',
      'TK Đầu bếp & Nhân viên',
      'TK Phụ huynh',
      'Đăng nhập 7 ngày qua',
      'Sĩ số HS đang học',
      'Sĩ số HS tính phí',
      'Đơn giá nền (VND/HS/năm)',
      'Số Add-on kích hoạt',
      'Danh sách Add-on đang mua',
      'Phí Gói Nền/năm (VND)',
      'Phí các Gói Add-on/năm (VND)',
      'Chiết khấu (%)',
      'Tổng Phí Bản quyền/năm ARR (VND)',
      'Bình quân/tháng MRR (VND)'
    ];

    const escapeCsv = (val) => {
      const str = String(val ?? '');
      if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
      return str;
    };

    const rows = filteredSchools.map((s) => {
      const rc = s.accountStats?.roleCounts || {};
      const bill = s.saasBilling || {};
      const addonNames = (bill.activeAddons || []).map((a) => a.label).join('; ');
      return [
        s.code,
        s.name,
        s.status === 'active' ? 'Đang hoạt động' : 'Tạm ngưng',
        PLAN_LABELS[s.subscriptionPlan] || 'Gói Toàn diện',
        formatDateShort(s.createdAt),
        s.licenseExpiresAt ? formatDateShort(s.licenseExpiresAt) : 'Không giới hạn',
        s.accountStats?.activeAccounts || 0,
        rc.admin || 0,
        rc.teacher || 0,
        (rc.accountant || 0) + (rc.hr || 0) + (rc.principal || 0),
        (rc.chef || 0) + (rc.guard || 0),
        rc.parent || 0,
        s.accountStats?.logins7dCount || 0,
        s.studentCount || 0,
        bill.billableStudents || 0,
        bill.effectiveBasePrice || saasPricing?.basePricePerStudentYear || 0,
        bill.activeAddonCount || 0,
        addonNames || 'Chỉ dùng Gói Nền',
        bill.coreAnnualAmount || 0,
        bill.addonAnnualAmount || 0,
        bill.discountPercent || 0,
        bill.contractedArr || bill.netAnnualAmount || 0,
        bill.estimatedMrr || Math.round((bill.netAnnualAmount || 0) / 12)
      ];
    });

    const csvContent = '\uFEFF' + [headers, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Bao-cao-tong-ket-SaaS-Admin-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const rs = growthData.rangeSummary || {};
  const activeRangeLabel = RANGE_OPTIONS.find((r) => r.key === range)?.label || '12 tháng';
  const basePriceDisplay = saasPricing?.basePricePerStudentYear ?? 120000;
  const minStuDisplay = saasPricing?.minBillableStudentsPerSchool ?? 30;

  return (
    <div>
      {/* THANH ĐIỀU KHIỂN KHUNG THỜI GIAN ĐỘNG & CẤU HÌNH BẢNG GIÁ HỌC SINH / ADD-ON */}
      <section className="sa-exec-toolbar-card">
        <div>
          <p className="card-kicker" style={{ color: '#1d4ed8', margin: 0 }}>
            BÁO CÁO TỔNG KẾT NHÀ CUNG CẤP PHẦN MỀM SAAS
          </p>
          <h2 style={{ margin: '3px 0 2px', fontSize: 18, color: '#0f172a' }}>
            Tăng trưởng Trường học, Tài khoản Sử dụng &amp; Doanh thu Bản quyền ({activeRangeLabel})
          </h2>
          <span style={{ fontSize: 12.5, color: '#475569' }}>
            Đơn giá chuẩn đang áp dụng: <strong>{formatFullVnd(basePriceDisplay)} / học sinh / năm</strong>
            {minStuDisplay > 0 ? ` (Cam kết tối thiểu ${minStuDisplay} HS/trường)` : ' (Không áp mức tối thiểu)'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div className="sa-range-segmented" role="tablist" aria-label="Chọn khung thời gian thống kê">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                role="tab"
                aria-selected={range === opt.key}
                className={range === opt.key ? 'active' : ''}
                onClick={() => setRange(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="button button-secondary"
            data-no-progress="true"
            onClick={openPricingEditor}
          >
            <Icon name="settings" size={15} />
            <span>{showPricingDrawer ? 'Thu gọn Bảng giá & Add-on' : 'Tùy chỉnh Giá /HS/năm & Add-on'}</span>
          </button>

          <button type="button" className="button button-primary" onClick={handleExportSummaryCsv}>
            <Icon name="download" size={15} /> Xuất Báo cáo Excel (CSV)
          </button>
        </div>
      </section>

      {/* BẢNG TÙY CHỈNH NHANH ĐƠN GIÁ HỌC SINH/NĂM & CÁC GÓI BÁN THÊM (ADD-ON) */}
      {showPricingDrawer && (
        <form className="sa-pricing-config-card" onSubmit={handleSavePricingPolicy}>
          <div className="sa-form-section-head">
            <div>
              <strong style={{ fontSize: 14, color: '#1e3a8a' }}>
                Cấu hình Công thức Thu phí theo Học sinh/năm &amp; Giá bán các Module Add-on
              </strong>
              <div style={{ fontSize: 12.5, color: '#475569', marginTop: 2 }}>
                Thay đổi tại đây áp dụng làm bảng giá chuẩn cho mọi trường (bạn vẫn có thể đặt giá ưu đãi / chiết khấu riêng cho từng trường trong mục Cấu hình gói của trường đó).
              </div>
            </div>
            <button
              type="button"
              className="button button-secondary"
              data-no-progress="true"
              onClick={() => setShowPricingDrawer(false)}
            >
              Đóng
            </button>
          </div>

          {pricingNotice && (
            <div
              className={pricingNotice.type === 'error' ? 'form-error' : 'timekeeping-notice success'}
              style={{ marginBottom: 4 }}
            >
              <Icon name={pricingNotice.type === 'error' ? 'alertCircle' : 'check'} size={16} />
              <span>{pricingNotice.text}</span>
            </div>
          )}

          <div className="hn-grid-2">
            <div className="hn-field">
              <label className="hn-field-label" htmlFor="cfg-base-stu-price">
                Đơn giá Gói Nền chuẩn / 1 Học sinh / Năm (VND) *
              </label>
              <div className="hn-input-suffix-wrap">
                <input
                  id="cfg-base-stu-price"
                  type="number"
                  min={0}
                  step={5000}
                  required
                  value={pricingDraft.basePricePerStudentYear}
                  onChange={(e) =>
                    setPricingDraft({ ...pricingDraft, basePricePerStudentYear: e.target.value })
                  }
                />
                <span className="hn-input-suffix-tag">đ/HS/năm</span>
              </div>
              <span className="hn-field-hint">
                Bao gồm 6 phân hệ Gói Nền: Lớp học, Hồ sơ HS, Điểm danh, Tài khoản, Báo cáo &amp; Thông báo
              </span>
            </div>

            <div className="hn-field">
              <label className="hn-field-label" htmlFor="cfg-min-stu-seats">
                Số Học sinh tính phí tối thiểu / 1 Trường (Đặt 0 nếu thu đúng sĩ số thực)
              </label>
              <div className="hn-input-suffix-wrap">
                <input
                  id="cfg-min-stu-seats"
                  type="number"
                  min={0}
                  max={5000}
                  required
                  value={pricingDraft.minBillableStudentsPerSchool}
                  onChange={(e) =>
                    setPricingDraft({ ...pricingDraft, minBillableStudentsPerSchool: e.target.value })
                  }
                />
                <span className="hn-input-suffix-tag">HS tối thiểu</span>
              </div>
              <span className="hn-field-hint">
                Đảm bảo chi phí duy trì máy chủ đối với các trường mới mở ít học sinh
              </span>
            </div>
          </div>

          <div className="sa-addon-pricing-grid">
            {pricingDraft.addonCatalog.map((addon) => (
              <div key={addon.moduleKey} className="sa-addon-pricing-item">
                <div className="sa-addon-pricing-title">
                  <strong>{addon.label}</strong>
                  <small>{addon.desc}</small>
                </div>
                <div className="sa-addon-pricing-controls">
                  <select
                    value={addon.pricingMode}
                    onChange={(e) =>
                      handleAddonDraftChange(addon.moduleKey, 'pricingMode', e.target.value)
                    }
                  >
                    <option value="per_student_year">Cộng theo đ / HS / năm</option>
                    <option value="flat_school_year">Trọn gói đ / Trường / năm</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    step={addon.pricingMode === 'flat_school_year' ? 100000 : 5000}
                    value={addon.price}
                    onChange={(e) => handleAddonDraftChange(addon.moduleKey, 'price', e.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              type="submit"
              className="button button-primary"
              disabled={savingPricing}
              aria-busy={savingPricing}
            >
              <Icon name="check" size={16} />
              <span>{savingPricing ? 'Đang lưu & tính lại...' : 'Lưu Bảng giá & Cập nhật Báo cáo'}</span>
            </button>
          </div>
        </form>
      )}

      {/* 6 THẺ KPI TỔNG KẾT CHO TỔNG ADMIN (100% CHỈ SỐ KINH DOANH & TĂNG TRƯỞNG SAAS) */}
      <div className="superadmin-kpi-grid">
        <article className="superadmin-kpi-card">
          <span className="superadmin-kpi-icon green"><Icon name="money" size={21} /></span>
          <div className="superadmin-kpi-body">
            <small>DOANH THU BẢN QUYỀN NĂM (ARR)</small>
            <strong>{formatFullVnd(summary.totalContractedArr || 0)}</strong>
            <span className="superadmin-kpi-sub">
              ~{formatFullVnd(summary.estimatedMrr || 0)}/tháng · Tăng mới ({activeRangeLabel}):{' '}
              <b style={{ color: '#15803d' }}>+{formatCompactVnd(rs.newArrInRange || 0)}</b>
            </span>
          </div>
        </article>

        <article className="superadmin-kpi-card">
          <span className="superadmin-kpi-icon blue"><Icon name="shield" size={21} /></span>
          <div className="superadmin-kpi-body">
            <small>ĐƠN VỊ TRƯỜNG ĐANG SỬ DỤNG</small>
            <strong>{summary.activeSchools || 0} / {summary.totalSchools || 0} trường</strong>
            <span className="superadmin-kpi-sub">
              +{rs.newSchoolsInRange || 0} trường mới ({activeRangeLabel}) · {summary.trialSchools || 0} dùng thử
            </span>
          </div>
        </article>

        <article className="superadmin-kpi-card">
          <span className="superadmin-kpi-icon teal"><Icon name="students" size={21} /></span>
          <div className="superadmin-kpi-body">
            <small>HỌC SINH TÍNH PHÍ BẢN QUYỀN</small>
            <strong>{formatInt(summary.totalBillableStudents || 0)} HS tính phí</strong>
            <span className="superadmin-kpi-sub">
              Sĩ số thực: {formatInt(summary.totalStudents || 0)} bé (+{formatInt(rs.newStudentsInRange || 0)} mới trong kỳ)
            </span>
          </div>
        </article>

        <article className="superadmin-kpi-card">
          <span className="superadmin-kpi-icon purple"><Icon name="users" size={21} /></span>
          <div className="superadmin-kpi-body">
            <small>TÀI KHOẢN SỬ DỤNG TOÀN HỆ THỐNG</small>
            <strong>{formatInt(summary.totalActiveAccounts || 0)} tài khoản</strong>
            <span className="superadmin-kpi-sub">
              {formatInt(summary.totalInternalAccounts || 0)} nhân sự · {formatInt(summary.totalParentAccounts || 0)} phụ huynh (+{formatInt(rs.newAccountsInRange || 0)} mới)
            </span>
          </div>
        </article>

        <article className="superadmin-kpi-card">
          <span className="superadmin-kpi-icon amber"><Icon name="grid" size={21} /></span>
          <div className="superadmin-kpi-body">
            <small>DOANH THU TỪ CÁC GÓI ADD-ON</small>
            <strong>{formatFullVnd(summary.totalAddonArr || 0)} / năm</strong>
            <span className="superadmin-kpi-sub">
              Chiếm {summary.totalContractedArr > 0 ? Math.round(((summary.totalAddonArr || 0) / summary.totalContractedArr) * 100) : 0}% tổng ARR (Bếp ăn, Đón trẻ, Chấm công...)
            </span>
          </div>
        </article>

        <article className="superadmin-kpi-card">
          <span className="superadmin-kpi-icon rose"><Icon name="activity" size={21} /></span>
          <div className="superadmin-kpi-body">
            <small>GIÁ TRỊ HỢP ĐỒNG BÌNH QUÂN / TRƯỜNG</small>
            <strong>{formatFullVnd(summary.avgArrPerPaidSchool || 0)} / năm</strong>
            <span className="superadmin-kpi-sub">
              {formatInt(rs.activeLoginUsersInRange || summary.totalLogins7d || 0)} TK đăng nhập hoạt động · {summary.totalDevices || 0} máy chấm công
            </span>
          </div>
        </article>
      </div>

      {/* HÀNG BIỂU ĐỒ 1: BIỂU ĐỒ TĂNG TRƯỞNG THEO THỜI ĐIỂM & CƠ CẤU DOANH THU BẢN QUYỀN */}
      <div className="superadmin-two-col">
        <section className="content-card" style={{ padding: '20px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <div>
              <p className="card-kicker">BIỂU ĐỒ TĂNG TRƯỞNG THEO TỪNG THỜI ĐIỂM ({activeRangeLabel.toUpperCase()})</p>
              <h2 style={{ margin: '2px 0 3px' }}>Lũy kế sử dụng &amp; Tăng mới qua từng mốc thời gian</h2>
              <p style={{ margin: 0, fontSize: 12.5, color: '#64748b' }}>
                Di chuột vào từng cột mốc để xem bao nhiêu trường/tài khoản/học sinh đang dùng tại thời điểm đó.
              </p>
            </div>

            <div className="sa-metric-pills" role="tablist">
              {METRIC_TABS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="tab"
                  aria-selected={growthMetric === m.key}
                  className={growthMetric === m.key ? 'active' : ''}
                  onClick={() => setGrowthMetric(m.key)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {loadingGrowth ? (
            <div className="inline-loader" style={{ minHeight: 230 }}>
              <span className="loading-orb" /> Đang tổng hợp chuỗi thời gian tăng trưởng...
            </div>
          ) : (
            <PlatformGrowthTimelineChart timeline={growthData.timeline} metric={growthMetric} />
          )}
        </section>

        <section className="content-card" style={{ padding: '20px 22px' }}>
          <p className="card-kicker">CƠ CẤU DOANH THU BẢN QUYỀN PHẦN MỀM (SAAS ARR)</p>
          <h2 style={{ margin: '2px 0 4px' }}>Tỷ trọng Gói Nền theo Học sinh &amp; Các Gói Add-on</h2>
          <p style={{ margin: '0 0 12px', fontSize: 12.8, color: '#64748b' }}>
            Phân tích nguồn thu bản quyền từ đầu học sinh/năm và doanh thu bán thêm các module nâng cao.
          </p>
          <SaasRevenueBreakdownDonut
            coreArr={summary.totalCoreArr || 0}
            perStudentAddonArr={summary.totalPerStudentAddonArr || 0}
            flatAddonArr={summary.totalFlatAddonArr || 0}
            potentialTrialArr={summary.totalPotentialTrialArr || 0}
          />
        </section>
      </div>

      {/* HÀNG BIỂU ĐỒ 2: TỶ LỆ TRƯỜNG MUA ADD-ON & PHÂN BỐ TÀI KHOẢN NGƯỜI DÙNG */}
      <div className="superadmin-two-col">
        <section className="content-card" style={{ padding: '20px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <div>
              <p className="card-kicker">DOANH THU &amp; TỶ LỆ MUA CÁC MODULE BÁN THÊM (ADD-ON STORE)</p>
              <h2 style={{ margin: '2px 0 3px' }}>Hiệu quả kinh doanh từng Gói Add-on</h2>
              <p style={{ margin: 0, fontSize: 12.5, color: '#64748b' }}>
                Theo dõi bao nhiêu trường đã kích hoạt Add-on Bếp ăn &amp; Dinh dưỡng, Đón trả trẻ QR, Máy chấm công...
              </p>
            </div>
          </div>
          <AddonAdoptionChart addonAdoption={addonAdoption} />
        </section>

        <section className="content-card" style={{ padding: '20px 22px' }}>
          <p className="card-kicker">QUY MÔ NGƯỜI DÙNG TRÊN TOÀN NỀN TẢNG</p>
          <h2 style={{ margin: '2px 0 4px' }}>Phân bố Tài khoản đang sử dụng theo Vai trò</h2>
          <p style={{ margin: '0 0 12px', fontSize: 12.8, color: '#64748b' }}>
            Tổng hợp số lượng tài khoản Admin trường, Ban Giám hiệu, Giáo viên, Kế toán, Đầu bếp, Nhân sự và Phụ huynh.
          </p>
          <RoleDistributionChart roleDistribution={roleDistribution} />
        </section>
      </div>

      {/* BẢNG TỔNG KẾT TÀI KHOẢN SỬ DỤNG, SĨ SỐ TÍNH PHÍ, GÓI ADD-ON & BẢN QUYỀN TỪNG TRƯỜNG */}
      <section className="content-card student-list-card">
        <div className="list-toolbar" style={{ flexWrap: 'wrap' }}>
          <div>
            <p className="card-kicker">BẢNG TỔNG KẾT KHÁCH HÀNG TRƯỜNG HỌC, TÀI KHOẢN &amp; PHÍ BẢN QUYỀN NĂM</p>
            <h2>Chi tiết tài khoản sử dụng, gói Add-on &amp; doanh thu theo từng trường ({filteredSchools.length} trường)</h2>
            <p>
              Kiểm tra chính xác mỗi trường có bao nhiêu tài khoản đang dùng, bao nhiêu học sinh tính phí, đã mua những Add-on nào và tổng phí bản quyền/năm.
            </p>
          </div>
        </div>

        <div className="student-filters" style={{ padding: '0 22px 16px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label className="search-box" style={{ flex: '1 1 300px' }}>
            <Icon name="search" size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theo mã trường, tên trường hoặc người đại diện..."
            />
          </label>
          <select
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value)}
            style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #cbd5e1', background: '#fff', fontWeight: 600 }}
          >
            <option value="all">Tất cả gói hợp đồng ({schools.length})</option>
            <option value="professional">Gói Toàn diện (Professional)</option>
            <option value="standard">Gói Tiêu chuẩn</option>
            <option value="enterprise">Gói Chuỗi trường (Enterprise)</option>
            <option value="trial">Đang Dùng thử (Trial)</option>
          </select>
        </div>

        <div className="table-wrap">
          <table className="data-table sa-clean-table">
            <thead>
              <tr>
                <th>Đơn vị Trường &amp; Gói</th>
                <th>Tài khoản đang sử dụng</th>
                <th>Học sinh tính phí / năm</th>
                <th>Gói Nền &amp; Các Add-on đã mua</th>
                <th>Phí Bản quyền / Năm (ARR)</th>
                <th>Thao tác quản trị</th>
              </tr>
            </thead>
            <tbody>
              {filteredSchools.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '32px 0', color: '#64748b' }}>
                    Không có trường học nào khớp điều kiện tìm kiếm.
                  </td>
                </tr>
              ) : (
                filteredSchools.map((s) => {
                  const rc = s.accountStats?.roleCounts || {};
                  const bill = s.saasBilling || {};
                  const activeAddons = bill.activeAddons || [];
                  const previewAddons = activeAddons.slice(0, 3);
                  const remainCount = Math.max(0, activeAddons.length - previewAddons.length);

                  return (
                    <tr key={s._id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                          <span className="sa-school-code-pill">{s.code}</span>
                          <span className="sa-plan-badge">{PLAN_LABELS[s.subscriptionPlan] || 'Gói Toàn diện'}</span>
                        </div>
                        <strong className="sa-school-title">{s.name}</strong>
                        <small>
                          Tham gia: {formatDateShort(s.createdAt)}
                          {s.licenseExpiresAt ? ` · Hạn: ${formatDateShort(s.licenseExpiresAt)}` : ''}
                        </small>
                      </td>

                      <td style={{ minWidth: 210 }}>
                        <div>
                          <strong style={{ color: '#1e3a8a', fontSize: 14 }}>
                            {formatInt(s.accountStats?.activeAccounts || 0)} tài khoản hoạt động
                          </strong>
                        </div>
                        <small>
                          Admin: <strong>{rc.admin || 0}</strong> · GV: <strong>{rc.teacher || 0}</strong> · Bếp/KT/NV:{' '}
                          <strong>
                            {(rc.chef || 0) + (rc.accountant || 0) + (rc.hr || 0) + (rc.guard || 0) + (rc.principal || 0)}
                          </strong>{' '}
                          · PH: <strong>{rc.parent || 0}</strong>
                        </small>
                        <small style={{ color: '#0f766e' }}>
                          {s.accountStats?.logins7dCount || 0} tài khoản đăng nhập 7 ngày qua
                        </small>
                      </td>

                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div>
                          <strong>{formatInt(bill.billableStudents || 0)} HS tính phí</strong>
                        </div>
                        <small>
                          Thực tế đang học: <strong>{formatInt(s.studentCount || 0)}</strong> / {formatInt(s.quotas?.maxStudents || 800)} bé
                        </small>
                        <small>
                          Đơn giá nền: <strong>{formatFullVnd(bill.effectiveBasePrice || basePriceDisplay)}</strong>/HS
                          {bill.useCustomBasePrice ? ' (Giá riêng)' : ''}
                        </small>
                      </td>

                      <td style={{ minWidth: 220 }}>
                        <div style={{ marginBottom: 5 }}>
                          <strong>{bill.activeCoreCount || 6}/6</strong> module Gói Nền ·{' '}
                          <strong style={{ color: '#15803d' }}>{activeAddons.length} Add-on</strong>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {previewAddons.map((ad) => (
                            <span key={ad.moduleKey} className="sa-addon-mini-chip">
                              + {ad.label.split(',')[0]}
                            </span>
                          ))}
                          {remainCount > 0 && (
                            <span className="sa-addon-mini-chip muted">+{remainCount} Add-on khác</span>
                          )}
                          {activeAddons.length === 0 && (
                            <span style={{ fontSize: 11.5, color: '#64748b' }}>Chưa mua thêm Add-on</span>
                          )}
                        </div>
                      </td>

                      <td style={{ whiteSpace: 'nowrap' }}>
                        {bill.isTrial ? (
                          <>
                            <strong style={{ color: '#2563eb' }}>Đang dùng thử (0 đ)</strong>
                            <small>Quy đổi sau Trial: {formatFullVnd(bill.netAnnualAmount || 0)}/năm</small>
                          </>
                        ) : (
                          <>
                            <strong style={{ color: '#15803d', fontSize: 14.5 }}>
                              {formatFullVnd(bill.contractedArr || bill.netAnnualAmount || 0)} / năm
                            </strong>
                            <small>
                              Nền: {formatCompactVnd(bill.coreAnnualAmount)} + Add-on: {formatCompactVnd(bill.addonAnnualAmount)}
                              {bill.discountPercent > 0 ? ` (−${bill.discountPercent}%)` : ''}
                            </small>
                            <small style={{ color: '#475569' }}>
                              ~{formatFullVnd(bill.estimatedMrr || 0)} / tháng
                            </small>
                          </>
                        )}
                      </td>

                      <td>
                        <div className="sa-school-actions-grid">
                          {onOpenAccounts && (
                            <button
                              type="button"
                              className="button button-secondary"
                              onClick={() => onOpenAccounts(s)}
                            >
                              Tài khoản ({s.accountStats?.totalAccounts || 0})
                            </button>
                          )}
                          {onOpenConfig && (
                            <button
                              type="button"
                              className="button button-secondary"
                              onClick={() => onOpenConfig(s)}
                            >
                              Giá &amp; Add-on
                            </button>
                          )}
                          {onOpenReport && (
                            <button
                              type="button"
                              className="button button-secondary"
                              onClick={() => onOpenReport(s._id)}
                            >
                              Chi tiết 360°
                            </button>
                          )}
                          {s.status === 'active' && onEnterSchool && (
                            <button
                              type="button"
                              className="button button-primary"
                              onClick={() => onEnterSchool(s)}
                            >
                              Vào hỗ trợ
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
