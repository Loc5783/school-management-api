/**
 * @fileoverview Các hàm định dạng tiền tệ VND dùng chung cho biểu đồ và báo cáo SaaS.
 */

export const formatCompactVnd = (val) => {
  const n = Number(val) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2).replace(/\.?0+$/, '')} tỷ`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')} tr`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}k`;
  return `${sign}${n} đ`;
};

export const formatFullVnd = (val) => `${new Intl.NumberFormat('vi-VN').format(Math.round(Number(val) || 0))} đ`;

