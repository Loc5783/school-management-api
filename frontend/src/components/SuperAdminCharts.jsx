import { useState } from 'react';
import { formatCompactVnd, formatFullVnd } from '../utils/currencyFormatters';

const formatInt = (val) => new Intl.NumberFormat('vi-VN').format(Math.round(Number(val) || 0));

const METRIC_META = {
  schools: {
    title: 'Số trường sử dụng',
    cumulativeLabel: 'Tổng trường lũy kế',
    newLabel: 'Trường mở mới trong kỳ',
    lineColor: '#2563eb',
    barColor: '#93c5fd',
    formatAxis: (v) => `${formatInt(v)}`,
    formatValue: (v) => `${formatInt(v)} trường`,
    getCumulative: (d) => Number(d.cumulativeSchools) || 0,
    getNew: (d) => Number(d.newSchools) || 0
  },
  accounts: {
    title: 'Tài khoản sử dụng',
    cumulativeLabel: 'Tổng TK hoạt động lũy kế',
    newLabel: 'Tài khoản cấp mới trong kỳ',
    lineColor: '#7c3aed',
    barColor: '#c4b5fd',
    formatAxis: (v) => `${formatInt(v)}`,
    formatValue: (v) => `${formatInt(v)} tài khoản`,
    getCumulative: (d) => Number(d.cumulativeAccounts) || 0,
    getNew: (d) => Number(d.newAccounts) || 0
  },
  students: {
    title: 'Học sinh trên hệ thống',
    cumulativeLabel: 'Tổng HS đang học lũy kế',
    newLabel: 'Học sinh tăng mới trong kỳ',
    lineColor: '#0d9488',
    barColor: '#99f6e4',
    formatAxis: (v) => `${formatInt(v)}`,
    formatValue: (v) => `${formatInt(v)} học sinh`,
    getCumulative: (d) => Number(d.cumulativeStudents) || 0,
    getNew: (d) => Number(d.newStudents) || 0
  },
  arr: {
    title: 'Doanh thu bản quyền năm (ARR)',
    cumulativeLabel: 'Tổng ARR lũy kế tại thời điểm',
    newLabel: 'ARR tăng thêm trong kỳ',
    lineColor: '#16a34a',
    barColor: '#86efac',
    formatAxis: (v) => formatCompactVnd(v),
    formatValue: (v) => formatFullVnd(v),
    getCumulative: (d) => Number(d.estimatedArr) || 0,
    getNew: (d) => Number(d.newArrAdded) || 0
  }
};

/**
 * Biểu đồ Tăng trưởng Nền tảng SaaS theo thời điểm (Kết hợp Cột tăng mới + Đường lũy kế mượt mà).
 * Cho phép Nhà cung cấp phần mềm theo dõi:
 * - Có bao nhiêu trường dùng và tăng thêm ở từng mốc thời gian.
 * - Có bao nhiêu tài khoản & học sinh sử dụng tại từng thời điểm.
 * - Tốc độ tăng trưởng Doanh thu Bản quyền Năm (ARR).
 */
export function PlatformGrowthTimelineChart({ timeline = [], metric = 'schools' }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const meta = METRIC_META[metric] || METRIC_META.schools;

  if (!Array.isArray(timeline) || timeline.length === 0) {
    return (
      <div className="sa-chart-empty">
        Chưa có dữ liệu chuỗi thời gian để hiển thị biểu đồ tăng trưởng.
      </div>
    );
  }

  const maxVal = Math.max(
    1,
    ...timeline.map((item) => Math.max(meta.getCumulative(item), meta.getNew(item)))
  );

  const svgWidth = 680;
  const svgHeight = 250;
  const padLeft = 64;
  const padRight = 22;
  const padTop = 24;
  const padBottom = 42;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;
  const stepX = plotW / timeline.length;
  const barW = Math.min(30, Math.max(12, stepX * 0.42));

  const points = timeline.map((item, idx) => {
    const cx = padLeft + idx * stepX + stepX / 2;
    const cumVal = meta.getCumulative(item);
    const newVal = meta.getNew(item);
    const cy = padTop + plotH - (cumVal / maxVal) * plotH;
    const barH = Math.max(newVal > 0 ? 4 : 0, (newVal / maxVal) * plotH);
    return { cx, cy, cumVal, newVal, barH, item };
  });

  const linePath = points
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.cx.toFixed(1)} ${p.cy.toFixed(1)}`)
    .join(' ');

  const areaPath = points.length > 0
    ? `${linePath} L ${points[points.length - 1].cx.toFixed(1)} ${(padTop + plotH).toFixed(1)} L ${points[0].cx.toFixed(1)} ${(padTop + plotH).toFixed(1)} Z`
    : '';

  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const activePoint = hoverIdx !== null && points[hoverIdx] ? points[hoverIdx] : points[points.length - 1];

  return (
    <div className="sa-chart-wrapper">
      <div className="sa-chart-legend">
        <span>
          <i style={{ background: meta.lineColor, borderRadius: '999px' }} /> {meta.cumulativeLabel}
        </span>
        <span>
          <i style={{ background: meta.barColor }} /> {meta.newLabel}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="sa-svg-chart"
        role="img"
        aria-label={`Biểu đồ tăng trưởng ${meta.title}`}
      >
        <defs>
          <linearGradient id={`saAreaGrad-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={meta.lineColor} stopOpacity="0.18" />
            <stop offset="100%" stopColor={meta.lineColor} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {yTicks.map((ratio) => {
          const y = padTop + plotH - ratio * plotH;
          const val = maxVal * ratio;
          return (
            <g key={ratio}>
              <line
                x1={padLeft}
                y1={y}
                x2={svgWidth - padRight}
                y2={y}
                stroke="#e2e8f0"
                strokeDasharray={ratio === 0 ? undefined : '4 4'}
              />
              <text x={padLeft - 8} y={y + 4} textAnchor="end" fontSize="10.5" fill="#64748b" fontWeight="600">
                {meta.formatAxis(val)}
              </text>
            </g>
          );
        })}

        {areaPath && <path d={areaPath} fill={`url(#saAreaGrad-${metric})`} />}

        {points.map((p, idx) => {
          const isHovered = hoverIdx === idx;
          return (
            <g
              key={p.item.key}
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={padLeft + idx * stepX + 2}
                y={padTop}
                width={Math.max(0, stepX - 4)}
                height={plotH}
                rx="8"
                fill={isHovered ? 'rgba(37, 99, 235, 0.06)' : 'transparent'}
              />

              <rect
                x={p.cx - barW / 2}
                y={padTop + plotH - p.barH}
                width={barW}
                height={p.barH}
                rx="5"
                fill={meta.barColor}
                opacity={isHovered ? 1 : 0.85}
              />

              <text
                x={p.cx}
                y={svgHeight - 16}
                textAnchor="middle"
                fontSize={timeline.length > 9 ? '10' : '11'}
                fontWeight="700"
                fill={isHovered ? '#0f172a' : '#475569'}
              >
                {p.item.label}
              </text>
            </g>
          );
        })}

        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke={meta.lineColor}
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {points.map((p, idx) => {
          const isHovered = hoverIdx === idx;
          return (
            <g
              key={`pt-${p.item.key}`}
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{ cursor: 'pointer' }}
            >
              <circle
                cx={p.cx}
                cy={p.cy}
                r={isHovered ? 6 : 4.2}
                fill="#ffffff"
                stroke={meta.lineColor}
                strokeWidth={isHovered ? 3 : 2.4}
              />
            </g>
          );
        })}
      </svg>

      {activePoint && (
        <div className="sa-chart-tooltip-bar">
          <strong>Mốc {activePoint.item.tooltipRange || activePoint.item.label}:</strong>
          <span style={{ color: meta.lineColor }}>
            Lũy kế: <b>{meta.formatValue(activePoint.cumVal)}</b>
          </span>
          <span style={{ color: '#0f172a' }}>
            Tăng mới trong kỳ: <b>+{meta.formatValue(activePoint.newVal)}</b>
          </span>
          {metric === 'accounts' && (
            <span style={{ color: '#0f766e' }}>
              Có đăng nhập/hoạt động: <b>{formatInt(activePoint.item.activeAccountsAtPoint || 0)} TK</b>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Biểu đồ Donut cơ cấu Doanh thu Bản quyền SaaS Năm (ARR):
 * Tách bạch rõ Gói Nền (thu theo đầu học sinh/năm) vs Các Gói Add-on bán thêm.
 */
export function SaasRevenueBreakdownDonut({
  coreArr = 0,
  perStudentAddonArr = 0,
  flatAddonArr = 0,
  potentialTrialArr = 0
}) {
  const safeCore = Math.max(0, Number(coreArr) || 0);
  const safeStuAddon = Math.max(0, Number(perStudentAddonArr) || 0);
  const safeFlatAddon = Math.max(0, Number(flatAddonArr) || 0);
  const totalArr = safeCore + safeStuAddon + safeFlatAddon;
  const estimatedMrr = Math.round(totalArr / 12);

  const segments = [
    { key: 'core', label: 'Gói Nền (Thu theo Học sinh/năm)', value: safeCore, color: '#2563eb' },
    { key: 'stuAddon', label: 'Add-on theo Học sinh/năm (Bếp, Đón trẻ...)', value: safeStuAddon, color: '#16a34a' },
    { key: 'flatAddon', label: 'Add-on trọn gói Trường/năm (Chấm công, NS...)', value: safeFlatAddon, color: '#f59e0b' }
  ];

  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  let cumulativeRatio = 0;

  return (
    <div className="sa-donut-layout">
      <div className="sa-donut-figure">
        <svg viewBox="0 0 160 160" width="158" height="158" aria-label="Cơ cấu doanh thu bản quyền SaaS">
          <circle cx="80" cy="80" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="20" />
          {totalArr > 0 &&
            segments.map((seg) => {
              const ratio = seg.value / totalArr;
              const dash = ratio * circumference;
              const offset = -cumulativeRatio * circumference;
              cumulativeRatio += ratio;
              if (ratio <= 0) return null;
              return (
                <circle
                  key={seg.key}
                  cx="80"
                  cy="80"
                  r={radius}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth="20"
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={offset}
                  transform="rotate(-90 80 80)"
                />
              );
            })}
          <text x="80" y="73" textAnchor="middle" fontSize="9.5" fontWeight="800" fill="#64748b">
            TỔNG ARR / NĂM
          </text>
          <text x="80" y="92" textAnchor="middle" fontSize="13.5" fontWeight="800" fill="#0f172a">
            {formatCompactVnd(totalArr)}
          </text>
          <text x="80" y="107" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#15803d">
            ~{formatCompactVnd(estimatedMrr)}/tháng
          </text>
        </svg>
      </div>

      <div className="sa-donut-details">
        {segments.map((seg) => {
          const pct = totalArr > 0 ? Math.round((seg.value / totalArr) * 100) : 0;
          return (
            <div key={seg.key} className="sa-donut-row">
              <span className="sa-donut-label">
                <i style={{ background: seg.color }} />
                {seg.label}
              </span>
              <strong>
                {formatFullVnd(seg.value)}{' '}
                <small style={{ color: '#64748b', fontWeight: 600 }}>({pct}%)</small>
              </strong>
            </div>
          );
        })}

        <div className="sa-donut-row sa-donut-net">
          <span>Bình quân doanh thu tháng (MRR ước tính)</span>
          <strong style={{ color: '#15803d' }}>{formatFullVnd(estimatedMrr)} / tháng</strong>
        </div>

        {potentialTrialArr > 0 && (
          <div className="sa-donut-row" style={{ background: '#eff6ff', borderColor: '#bfdbfe' }}>
            <span style={{ color: '#1e40af', fontWeight: 600 }}>Tiềm năng chuyển đổi từ trường Dùng thử</span>
            <strong style={{ color: '#1d4ed8' }}>+{formatFullVnd(potentialTrialArr)} / năm</strong>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Biểu đồ Hiệu quả Bán kèm các Gói Add-on (Bếp ăn & Dinh dưỡng, Đón trả trẻ QR, Máy chấm công...).
 */
export function AddonAdoptionChart({ addonAdoption = [] }) {
  if (!addonAdoption.length) {
    return <div className="sa-chart-empty">Chưa có cấu hình danh mục Add-on.</div>;
  }

  const sorted = [...addonAdoption].sort(
    (a, b) => (b.estimatedArr - a.estimatedArr) || (b.activatedSchoolsCount - a.activatedSchoolsCount)
  );

  return (
    <div className="sa-horizontal-bars">
      {sorted.map((item) => {
        const priceTag =
          item.price <= 0
            ? 'Tặng kèm (0 đ)'
            : item.pricingMode === 'flat_school_year'
              ? `+${formatCompactVnd(item.price)}/trường/năm`
              : `+${formatCompactVnd(item.price)}/HS/năm`;

        return (
          <div key={item.moduleKey} className="sa-hbar-item compact">
            <div className="sa-hbar-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                <strong>{item.label}</strong>
                <span className="sa-addon-price-pill">{priceTag}</span>
              </div>
              <span className="sa-hbar-metrics">
                <b>{item.activatedSchoolsCount}/{item.totalActiveSchools}</b> trường ({item.adoptionPercent}%) ·{' '}
                <b style={{ color: '#15803d' }}>{formatCompactVnd(item.estimatedArr)}/năm</b>
              </span>
            </div>
            <div className="sa-hbar-track">
              <div
                className={`sa-hbar-fill ${item.adoptionPercent >= 70 ? 'green' : 'blue'}`}
                style={{ width: `${item.activatedSchoolsCount > 0 ? Math.max(item.adoptionPercent, 6) : 0}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Biểu đồ So sánh Quy mô Tài khoản Sử dụng, Học sinh Tính phí & Giá trị Hợp đồng giữa các Trường.
 */
export function SchoolComparisonBarChart({ schools = [] }) {
  if (!schools.length) {
    return <div className="sa-chart-empty">Chưa có trường học nào trên hệ thống để so sánh.</div>;
  }

  const maxAccounts = Math.max(1, ...schools.map((s) => Number(s.accountStats?.totalAccounts) || 0));
  const maxArr = Math.max(1, ...schools.map((s) => Number(s.saasBilling?.netAnnualAmount) || 0));

  return (
    <div className="sa-horizontal-bars">
      {schools.map((s) => {
        const totalAcc = s.accountStats?.totalAccounts || 0;
        const staffAcc = s.accountStats?.internalActiveAccounts || 0;
        const parentAcc = s.accountStats?.parentAccounts || 0;
        const billableStu = s.saasBilling?.billableStudents || s.studentCount || 0;
        const arr = s.saasBilling?.netAnnualAmount || 0;
        const accPct = Math.min(100, Math.round((totalAcc / maxAccounts) * 100));
        const arrPct = Math.min(100, Math.round((arr / maxArr) * 100));

        return (
          <div key={s._id} className="sa-hbar-item">
            <div className="sa-hbar-head">
              <div>
                <strong style={{ color: '#1d4ed8' }}>{s.code}</strong> · <strong>{s.name}</strong>
              </div>
              <span className="sa-hbar-metrics">
                <b>{totalAcc}</b> TK ({staffAcc} NS · {parentAcc} PH) · <b>{billableStu}</b> HS tính phí ·{' '}
                <b style={{ color: '#15803d' }}>{formatCompactVnd(arr)}/năm</b>
              </span>
            </div>
            <div className="sa-hbar-dual">
              <div className="sa-hbar-track" title={`Tài khoản sử dụng: ${totalAcc} tài khoản`}>
                <div className="sa-hbar-fill purple" style={{ width: `${totalAcc > 0 ? Math.max(accPct, 5) : 0}%` }} />
              </div>
              <div className="sa-hbar-track" title={`Giá trị bản quyền/năm: ${formatFullVnd(arr)}`}>
                <div className="sa-hbar-fill green" style={{ width: `${arr > 0 ? Math.max(arrPct, 5) : 0}%` }} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Biểu đồ phân bố Tài khoản Sử dụng theo Vai trò toàn hệ thống.
 */
export function RoleDistributionChart({ roleDistribution = [] }) {
  const maxRoleCount = Math.max(1, ...roleDistribution.map((r) => r.total || 0));
  const totalAll = roleDistribution.reduce((s, r) => s + (r.total || 0), 0);

  return (
    <div className="sa-horizontal-bars">
      {roleDistribution.map((r) => {
        const pct = Math.min(100, Math.round(((r.active || 0) / maxRoleCount) * 100));
        const sharePct = totalAll > 0 ? Math.round(((r.total || 0) / totalAll) * 100) : 0;
        return (
          <div key={r.role} className="sa-hbar-item compact">
            <div className="sa-hbar-head">
              <span>
                <strong>{r.label}</strong>
              </span>
              <span className="sa-hbar-metrics">
                <b>{r.active}</b> đang dùng / {r.total} đã cấp ({sharePct}%)
              </span>
            </div>
            <div className="sa-hbar-track">
              <div
                className={`sa-hbar-fill ${r.role === 'parent' ? 'teal' : r.role === 'admin' ? 'blue' : 'purple'}`}
                style={{ width: `${r.active > 0 ? Math.max(pct, 6) : 0}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
