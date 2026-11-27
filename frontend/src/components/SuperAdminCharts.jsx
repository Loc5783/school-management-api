import { useState } from 'react';

const formatCompactVnd = (val) => {
  const n = Number(val) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1).replace(/\.0$/, '')} tỷ`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')} tr`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}k`;
  return `${sign}${n} đ`;
};

const formatFullVnd = (val) => `${new Intl.NumberFormat('vi-VN').format(Number(val) || 0)} đ`;

/**
 * Biểu đồ cột nhóm trực quan theo Kỳ kế toán (Phải thu vs Thực thu vs Chi phí vận hành + lương).
 * Nếu chuỗi chưa có nhiều kỳ, tự động hiển thị so sánh giữa các trường để biểu đồ luôn giàu thông tin.
 */
export function EconomicPeriodChart({ economicTrend = [], schools = [] }) {
  const [hoverIdx, setHoverIdx] = useState(null);

  const chartItems = economicTrend.length > 0
    ? economicTrend.map((row) => ({
        key: row.period,
        label: row.label,
        billed: Number(row.billed) || 0,
        collected: Number(row.collected) || 0,
        expenditure: Number(row.totalExpenditure) || 0,
        rate: row.collectionRatePercent || 0
      }))
    : schools.slice(0, 6).map((s) => ({
        key: s._id,
        label: s.code,
        billed: Number(s.finance?.totalBilled) || 0,
        collected: Number(s.finance?.totalCollected) || 0,
        expenditure: Number(s.finance?.totalExpenditure) || 0,
        rate: s.finance?.collectionRatePercent || 0
      }));

  if (chartItems.length === 0) {
    return (
      <div className="sa-chart-empty">
        Chưa phát sinh dữ liệu hóa đơn học phí hoặc chi phí để dựng biểu đồ kinh tế.
      </div>
    );
  }

  const maxVal = Math.max(
    1,
    ...chartItems.flatMap((d) => [d.billed, d.collected, d.expenditure])
  );

  const svgWidth = 640;
  const svgHeight = 240;
  const padLeft = 58;
  const padRight = 18;
  const padTop = 22;
  const padBottom = 42;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;
  const groupW = plotW / chartItems.length;
  const barW = Math.min(24, Math.max(10, (groupW - 24) / 3));

  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="sa-chart-wrapper">
      <div className="sa-chart-legend">
        <span><i style={{ background: '#93c5fd' }} /> Phải thu học phí</span>
        <span><i style={{ background: '#16a34a' }} /> Thực thu đã nộp</span>
        <span><i style={{ background: '#f59e0b' }} /> Chi vận hành & Lương</span>
      </div>

      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="sa-svg-chart"
        role="img"
        aria-label="Biểu đồ kinh tế thu chi toàn chuỗi"
      >
        {yTicks.map((ratio) => {
          const y = padTop + plotH - ratio * plotH;
          const val = Math.round(maxVal * ratio);
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
                {formatCompactVnd(val)}
              </text>
            </g>
          );
        })}

        {chartItems.map((item, idx) => {
          const centerX = padLeft + idx * groupW + groupW / 2;
          const totalGroupBarsWidth = barW * 3 + 8;
          const startX = centerX - totalGroupBarsWidth / 2;

          const hBilled = Math.max(item.billed > 0 ? 3 : 0, (item.billed / maxVal) * plotH);
          const hCollected = Math.max(item.collected > 0 ? 3 : 0, (item.collected / maxVal) * plotH);
          const hExp = Math.max(item.expenditure > 0 ? 3 : 0, (item.expenditure / maxVal) * plotH);

          const isHovered = hoverIdx === idx;

          return (
            <g
              key={item.key}
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{ cursor: 'pointer' }}
            >
              {isHovered && (
                <rect
                  x={padLeft + idx * groupW + 4}
                  y={padTop}
                  width={Math.max(0, groupW - 8)}
                  height={plotH}
                  rx="8"
                  fill="rgba(37, 99, 235, 0.05)"
                />
              )}

              <rect
                x={startX}
                y={padTop + plotH - hBilled}
                width={barW}
                height={hBilled}
                rx="4"
                fill="#93c5fd"
              />
              <rect
                x={startX + barW + 4}
                y={padTop + plotH - hCollected}
                width={barW}
                height={hCollected}
                rx="4"
                fill="#16a34a"
              />
              <rect
                x={startX + (barW + 4) * 2}
                y={padTop + plotH - hExp}
                width={barW}
                height={hExp}
                rx="4"
                fill="#f59e0b"
              />

              <text x={centerX} y={svgHeight - 20} textAnchor="middle" fontSize="11.5" fontWeight="700" fill="#1e293b">
                {item.label}
              </text>
              <text x={centerX} y={svgHeight - 6} textAnchor="middle" fontSize="10" fill="#15803d" fontWeight="700">
                Thu {item.rate}%
              </text>
            </g>
          );
        })}
      </svg>

      {hoverIdx !== null && chartItems[hoverIdx] && (
        <div className="sa-chart-tooltip-bar">
          <strong>Kỳ / Đơn vị {chartItems[hoverIdx].label}:</strong>
          <span>Phải thu: <b>{formatFullVnd(chartItems[hoverIdx].billed)}</b></span>
          <span style={{ color: '#15803d' }}>Thực thu: <b>{formatFullVnd(chartItems[hoverIdx].collected)}</b></span>
          <span style={{ color: '#b45309' }}>Tổng chi: <b>{formatFullVnd(chartItems[hoverIdx].expenditure)}</b></span>
        </div>
      )}
    </div>
  );
}

/**
 * Biểu đồ Donut cơ cấu Dòng tiền: Thực thu – Nợ đọng – Tổng chi vận hành & lương.
 */
export function CashflowDonutChart({ collected = 0, outstanding = 0, expenditure = 0 }) {
  const safeCollected = Math.max(0, Number(collected) || 0);
  const safeOutstanding = Math.max(0, Number(outstanding) || 0);
  const safeExpenditure = Math.max(0, Number(expenditure) || 0);
  const total = safeCollected + safeOutstanding + safeExpenditure;
  const netBalance = safeCollected - safeExpenditure;

  const segments = [
    { key: 'collected', label: 'Thực thu học phí', value: safeCollected, color: '#16a34a' },
    { key: 'outstanding', label: 'Công nợ chưa thu', value: safeOutstanding, color: '#ef4444' },
    { key: 'expenditure', label: 'Chi vận hành & Lương', value: safeExpenditure, color: '#f59e0b' }
  ];

  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  let cumulativeRatio = 0;

  return (
    <div className="sa-donut-layout">
      <div className="sa-donut-figure">
        <svg viewBox="0 0 160 160" width="156" height="156" aria-label="Cơ cấu tài chính">
          <circle cx="80" cy="80" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="20" />
          {total > 0 &&
            segments.map((seg) => {
              const ratio = seg.value / total;
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
          <text x="80" y="74" textAnchor="middle" fontSize="10" fontWeight="700" fill="#64748b">
            CHÊNH LỆCH THU–CHI
          </text>
          <text
            x="80"
            y="93"
            textAnchor="middle"
            fontSize="13.5"
            fontWeight="800"
            fill={netBalance >= 0 ? '#15803d' : '#be123c'}
          >
            {formatCompactVnd(netBalance)}
          </text>
        </svg>
      </div>

      <div className="sa-donut-details">
        {segments.map((seg) => (
          <div key={seg.key} className="sa-donut-row">
            <span className="sa-donut-label">
              <i style={{ background: seg.color }} />
              {seg.label}
            </span>
            <strong>{formatFullVnd(seg.value)}</strong>
          </div>
        ))}
        <div className="sa-donut-row sa-donut-net">
          <span>Dòng tiền ròng (Thực thu − Tổng chi)</span>
          <strong style={{ color: netBalance >= 0 ? '#15803d' : '#be123c' }}>
            {netBalance >= 0 ? '+' : ''}{formatFullVnd(netBalance)}
          </strong>
        </div>
      </div>
    </div>
  );
}

/**
 * Biểu đồ so sánh Mức độ Khai thác & Doanh thu giữa các Trường học.
 */
export function SchoolComparisonBarChart({ schools = [] }) {
  if (!schools.length) {
    return <div className="sa-chart-empty">Chưa có trường học nào để so sánh.</div>;
  }

  const maxRevenue = Math.max(1, ...schools.map((s) => Number(s.finance?.totalBilled) || 0));

  return (
    <div className="sa-horizontal-bars">
      {schools.map((s) => {
        const billed = Number(s.finance?.totalBilled) || 0;
        const collected = Number(s.finance?.totalCollected) || 0;
        const usagePct = s.usage?.usageScorePercent || 0;
        const revWidthPct = Math.min(100, Math.round((collected / maxRevenue) * 100));
        const billedWidthPct = Math.min(100, Math.round((billed / maxRevenue) * 100));

        return (
          <div key={s._id} className="sa-hbar-item">
            <div className="sa-hbar-head">
              <div>
                <strong style={{ color: '#1d4ed8' }}>{s.code}</strong> · <strong>{s.name}</strong>
              </div>
              <span className="sa-hbar-metrics">
                Khai thác: <b>{usagePct}%</b> · Thực thu: <b style={{ color: '#15803d' }}>{formatCompactVnd(collected)}</b> / {formatCompactVnd(billed)}
              </span>
            </div>
            <div className="sa-hbar-dual">
              <div className="sa-hbar-track" title={`Mức độ sử dụng tính năng: ${usagePct}%`}>
                <div className="sa-hbar-fill blue" style={{ width: `${Math.max(usagePct, 4)}%` }} />
              </div>
              <div className="sa-hbar-track" title={`Thực thu / Phải thu: ${formatFullVnd(collected)} / ${formatFullVnd(billed)}`}>
                <div className="sa-hbar-fill light-amber" style={{ width: `${billedWidthPct}%` }}>
                  <div
                    className="sa-hbar-fill green"
                    style={{ width: billed > 0 ? `${Math.min(100, Math.round((collected / billed) * 100))}%` : `${revWidthPct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Biểu đồ phân bố Tài khoản theo Vai trò toàn hệ thống (Giám đốc, Giáo viên, Đầu bếp, Kế toán, Nhân sự, Bảo vệ, Phụ huynh).
 */
export function RoleDistributionChart({ roleDistribution = [] }) {
  const maxRoleCount = Math.max(1, ...roleDistribution.map((r) => r.total || 0));

  return (
    <div className="sa-horizontal-bars">
      {roleDistribution.map((r) => {
        const pct = Math.min(100, Math.round(((r.active || 0) / maxRoleCount) * 100));
        return (
          <div key={r.role} className="sa-hbar-item compact">
            <div className="sa-hbar-head">
              <span><strong>{r.label}</strong></span>
              <span className="sa-hbar-metrics">
                <b>{r.active}</b> hoạt động / {r.total} tổng
              </span>
            </div>
            <div className="sa-hbar-track">
              <div
                className={`sa-hbar-fill ${r.role === 'parent' ? 'teal' : 'purple'}`}
                style={{ width: `${r.active > 0 ? Math.max(pct, 6) : 0}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

