const ExcelJS = require('exceljs');
const {
  assertSafeVnd,
  safeAddVnd,
  safeSubtractVnd,
  safeNetVnd
} = require('../utils/moneyHelpers');

const MAX_EXPORT_RECORDS = 10000;

/**
 * Định dạng thời gian hiện tại theo múi giờ Việt Nam (Asia/Ho_Chi_Minh)
 */
const getVietnamNowString = () => {
  const formatter = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  return formatter.format(new Date());
};

/**
 * Format ngày thành dd/MM/yyyy an toàn theo Asia/Ho_Chi_Minh
 */
const formatDateVN = (dateVal) => {
  if (!dateVal) return '—';
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  if (Number.isNaN(d.getTime())) return '—';
  const formatter = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(d);
};

/**
 * Format ngày giờ thành dd/MM/yyyy HH:mm theo Asia/Ho_Chi_Minh
 */
const formatDateTimeVN = (dateVal) => {
  if (!dateVal) return '—';
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  if (Number.isNaN(d.getTime())) return '—';
  const formatter = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  return formatter.format(d);
};

/**
 * Chống Formula Injection (CSV/Excel Formula Injection Prevention)
 * Các chuỗi bắt đầu bằng '=', '+', '-', '@' sẽ được thêm dấu nháy đơn `'` ở đầu
 */
const sanitizeCell = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('=') || trimmed.startsWith('+') || trimmed.startsWith('-') || trimmed.startsWith('@')) {
      return `'${trimmed}`;
    }
    return trimmed;
  }
  return value;
};

/**
 * Tạo base workbook với banner tiêu đề chuẩn mực, ngày xuất, bộ lọc và định dạng header
 */
const createBaseWorkbook = ({ title, sheetName = 'Dữ liệu', periodText = 'Tất cả', filterText = 'Mặc định' }) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Hệ thống Quản lý Mầm Non Hoa Nắng';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 5 }]
  });

  // Dòng 1: Đơn vị trường học
  const r1 = worksheet.getRow(1);
  r1.values = ['TRƯỜNG MẦM NON HOA NẮNG - BỘ PHẬN KẾ TOÁN & TÀI CHÍNH'];
  r1.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF475569' } };

  // Dòng 2: Tên báo cáo
  const r2 = worksheet.getRow(2);
  r2.values = [title.toUpperCase()];
  r2.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FF1E3A8A' } };
  r2.height = 24;

  // Dòng 3: Metadata thông tin xuất
  const vnTime = getVietnamNowString();
  const r3 = worksheet.getRow(3);
  r3.values = [`Thời điểm xuất: ${vnTime} (Giờ Việt Nam) | Kỳ/Khoảng ngày: ${periodText} | Đơn vị tính: VNĐ | Bộ lọc: ${filterText}`];
  r3.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF64748B' } };

  // Dòng 4: Dòng trống
  worksheet.getRow(4).height = 10;

  return { workbook, worksheet };
};

/**
 * Áp dụng style header chuẩn và borders
 */
const styleHeaderRow = (headerRow) => {
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E3A8A' } // Navy blue
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
    };
  });
};

/**
 * Áp dụng style dòng tổng cộng
 */
const styleTotalRow = (totalRow) => {
  totalRow.height = 24;
  totalRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF0F172A' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF1F5F9' } // Light slate
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF94A3B8' } },
      bottom: { style: 'double', color: { argb: 'FF0F172A' } }
    };
  });
};

/**
 * 1. Xuất Excel Mức thu (FeeSchedule)
 */
const buildFeeSchedulesWorkbook = (schedules, period) => {
  if (!schedules || schedules.length === 0) {
    throw Object.assign(new Error('Không có dữ liệu mức thu phù hợp với bộ lọc hiện tại để xuất Excel.'), { statusCode: 404 });
  }
  if (schedules.length > MAX_EXPORT_RECORDS) {
    throw Object.assign(new Error(`Dữ liệu vượt quá giới hạn ${MAX_EXPORT_RECORDS.toLocaleString('vi-VN')} bản ghi/lần xuất. Vui lòng thu hẹp bộ lọc kỳ thu.`), { statusCode: 422 });
  }

  const { workbook, worksheet } = createBaseWorkbook({
    title: 'Danh sách thiết lập mức thu học phí',
    sheetName: 'Mức thu',
    periodText: period || 'Tất cả các kỳ',
    filterText: period ? `Kỳ thu ${period}` : 'Tất cả'
  });

  const columns = [
    { header: 'STT', key: 'stt', width: 8 },
    { header: 'Kỳ thu', key: 'period', width: 14 },
    { header: 'Phạm vi áp dụng', key: 'classroomName', width: 24 },
    { header: 'Học phí chính (VNĐ)', key: 'tuitionBase', width: 20 },
    { header: 'Tiền ăn (VNĐ)', key: 'mealFee', width: 16 },
    { header: 'Tiền xe (VNĐ)', key: 'busFee', width: 16 },
    { header: 'Khoản thu khác (VNĐ)', key: 'extraFee', width: 20 },
    { header: 'Giảm trừ (VNĐ)', key: 'discount', width: 16 },
    { header: 'Tổng dự kiến / HS (VNĐ)', key: 'total', width: 24 },
    { header: 'Hạn thanh toán', key: 'dueDate', width: 16 },
    { header: 'Khoản thu thêm chi tiết', key: 'additionalItems', width: 35 },
    { header: 'Ghi chú', key: 'note', width: 30 },
    { header: 'Cập nhật lần cuối', key: 'updatedAt', width: 20 }
  ];

  const headerRow = worksheet.getRow(5);
  headerRow.values = columns.map(c => c.header);
  styleHeaderRow(headerRow);

  let totalTuition = 0;
  let totalMeal = 0;
  let totalBus = 0;
  let totalExtra = 0;
  let totalDiscount = 0;
  let totalEstimated = 0;

  schedules.forEach((item, index) => {
    const rowNum = index + 1;
    const tuitionBase = assertSafeVnd(item.tuitionBase, `Mức thu dòng ${rowNum}: Học phí chính`);
    const mealFee = assertSafeVnd(item.mealFee, `Mức thu dòng ${rowNum}: Tiền ăn`);
    const busFee = assertSafeVnd(item.busFee, `Mức thu dòng ${rowNum}: Tiền xe`);
    const extraFee = assertSafeVnd(item.extraFee, `Mức thu dòng ${rowNum}: Khoản thu khác`);
    const discount = assertSafeVnd(item.discount, `Mức thu dòng ${rowNum}: Giảm trừ`);

    let addTotal = 0;
    const addItems = item.additionalItems || [];
    for (let aIdx = 0; aIdx < addItems.length; aIdx++) {
      const a = addItems[aIdx];
      const amt = assertSafeVnd(a.amount, `Mức thu dòng ${rowNum}: Khoản thu thêm "${a.name || aIdx + 1}"`);
      addTotal = safeAddVnd(addTotal, amt, `Mức thu dòng ${rowNum}: Tổng khoản thu thêm`);
    }

    let subtotal = safeAddVnd(tuitionBase, mealFee, `Mức thu dòng ${rowNum}: Tổng thu`);
    subtotal = safeAddVnd(subtotal, busFee, `Mức thu dòng ${rowNum}: Tổng thu`);
    subtotal = safeAddVnd(subtotal, extraFee, `Mức thu dòng ${rowNum}: Tổng thu`);
    subtotal = safeAddVnd(subtotal, addTotal, `Mức thu dòng ${rowNum}: Tổng thu`);
    const itemTotal = safeSubtractVnd(subtotal, discount, `Mức thu dòng ${rowNum}: Tổng dự kiến`);

    totalTuition = safeAddVnd(totalTuition, tuitionBase, 'Tổng cột học phí');
    totalMeal = safeAddVnd(totalMeal, mealFee, 'Tổng cột tiền ăn');
    totalBus = safeAddVnd(totalBus, busFee, 'Tổng cột tiền xe');
    totalExtra = safeAddVnd(totalExtra, extraFee, 'Tổng cột khoản khác');
    totalDiscount = safeAddVnd(totalDiscount, discount, 'Tổng cột giảm trừ');
    totalEstimated = safeAddVnd(totalEstimated, itemTotal, 'Tổng cột dự kiến');

    const extraItemsText = addItems.map(a => `${a.name}: ${Number(a.amount || 0).toLocaleString('vi-VN')} đ`).join('; ');

    const row = worksheet.addRow([
      rowNum,
      sanitizeCell(item.period),
      sanitizeCell(item.classroomName || 'Tất cả lớp (áp dụng chung)'),
      tuitionBase,
      mealFee,
      busFee,
      extraFee,
      discount,
      itemTotal,
      formatDateVN(item.dueDate),
      sanitizeCell(extraItemsText),
      sanitizeCell(item.note),
      formatDateTimeVN(item.updatedAt)
    ]);

    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(4).numFmt = '#,##0';
    row.getCell(5).numFmt = '#,##0';
    row.getCell(6).numFmt = '#,##0';
    row.getCell(7).numFmt = '#,##0';
    row.getCell(8).numFmt = '#,##0';
    row.getCell(9).numFmt = '#,##0';
    row.getCell(10).alignment = { horizontal: 'center' };
    row.getCell(13).alignment = { horizontal: 'center' };
  });

  // Dòng tổng cộng
  const totalRow = worksheet.addRow([
    'TỔNG',
    `${schedules.length} mức thu`,
    '',
    totalTuition,
    totalMeal,
    totalBus,
    totalExtra,
    totalDiscount,
    totalEstimated,
    '',
    '',
    '',
    ''
  ]);
  styleTotalRow(totalRow);
  totalRow.getCell(4).numFmt = '#,##0';
  totalRow.getCell(5).numFmt = '#,##0';
  totalRow.getCell(6).numFmt = '#,##0';
  totalRow.getCell(7).numFmt = '#,##0';
  totalRow.getCell(8).numFmt = '#,##0';
  totalRow.getCell(9).numFmt = '#,##0';

  columns.forEach((col, idx) => {
    worksheet.getColumn(idx + 1).width = col.width;
  });

  return workbook;
};

/**
 * 2. Xuất Excel Hóa đơn học phí (TuitionFee)
 */
const buildInvoicesWorkbook = (invoices, { period, className, status }) => {
  if (!invoices || invoices.length === 0) {
    throw Object.assign(new Error('Không có dữ liệu hóa đơn học phí phù hợp với bộ lọc hiện tại để xuất Excel.'), { statusCode: 404 });
  }
  if (invoices.length > MAX_EXPORT_RECORDS) {
    throw Object.assign(new Error(`Dữ liệu vượt quá giới hạn ${MAX_EXPORT_RECORDS.toLocaleString('vi-VN')} bản ghi/lần xuất. Vui lòng thu hẹp bộ lọc theo lớp hoặc kỳ thu.`), { statusCode: 422 });
  }

  const statusLabel = {
    unpaid: 'Chưa thu',
    partial: 'Thu một phần',
    paid: 'Đã thu đủ',
    cancelled: 'Đã hủy'
  };

  const { workbook, worksheet } = createBaseWorkbook({
    title: 'Danh sách hóa đơn học phí',
    sheetName: 'Hóa đơn học phí',
    periodText: period || 'Tất cả các kỳ',
    filterText: `Lớp: ${className || 'Tất cả'} | Trạng thái: ${statusLabel[status] || 'Tất cả'}`
  });

  const columns = [
    { header: 'STT', width: 8 },
    { header: 'Mã học sinh', width: 18 },
    { header: 'Họ và tên học sinh', width: 26 },
    { header: 'Lớp', width: 16 },
    { header: 'Kỳ thu', width: 12 },
    { header: 'Học phí chính (VNĐ)', width: 20 },
    { header: 'Tiền ăn (VNĐ)', width: 16 },
    { header: 'Tiền xe (VNĐ)', width: 16 },
    { header: 'Khoản thu khác (VNĐ)', width: 20 },
    { header: 'Khoản thu thêm chi tiết', width: 30 },
    { header: 'Giảm trừ (VNĐ)', width: 16 },
    { header: 'Tổng phải thu (VNĐ)', width: 22 },
    { header: 'Đã thu (VNĐ)', width: 18 },
    { header: 'Còn phải thu (VNĐ)', width: 20 },
    { header: 'Trạng thái', width: 16 },
    { header: 'Hạn thanh toán', width: 16 },
    { header: 'Ghi chú', width: 25 }
  ];

  const headerRow = worksheet.getRow(5);
  headerRow.values = columns.map(c => c.header);
  styleHeaderRow(headerRow);

  let sumTotal = 0;
  let sumPaid = 0;
  let sumRemaining = 0;

  invoices.forEach((item, index) => {
    const rowNum = index + 1;
    const totalAmount = assertSafeVnd(item.totalAmount, `Hóa đơn dòng ${rowNum}: Tổng phải thu`);
    const paidAmount = assertSafeVnd(item.paidAmount, `Hóa đơn dòng ${rowNum}: Đã thu`);
    const remaining = safeSubtractVnd(Math.max(totalAmount, paidAmount), paidAmount, `Hóa đơn dòng ${rowNum}: Còn phải thu`);

    sumTotal = safeAddVnd(sumTotal, totalAmount, 'Tổng cột phải thu');
    sumPaid = safeAddVnd(sumPaid, paidAmount, 'Tổng cột đã thu');
    sumRemaining = safeAddVnd(sumRemaining, remaining, 'Tổng cột còn phải thu');

    const extraItemsText = (item.additionalItems || []).map(a => `${a.name}: ${Number(a.amount || 0).toLocaleString('vi-VN')} đ`).join('; ');

    const row = worksheet.addRow([
      rowNum,
      sanitizeCell(item.studentCode || (item.studentId && item.studentId.studentCode) || ''),
      sanitizeCell(item.studentName),
      sanitizeCell(item.className),
      sanitizeCell(item.period),
      Number(item.tuitionBase || 0),
      Number(item.mealFee || 0),
      Number(item.busFee || 0),
      Number(item.extraFee || 0),
      sanitizeCell(extraItemsText),
      Number(item.discount || 0),
      totalAmount,
      paidAmount,
      remaining,
      statusLabel[item.status] || item.status,
      formatDateVN(item.dueDate),
      sanitizeCell(item.note)
    ]);

    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(2).numFmt = '@';
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(5).alignment = { horizontal: 'center' };
    row.getCell(6).numFmt = '#,##0';
    row.getCell(7).numFmt = '#,##0';
    row.getCell(8).numFmt = '#,##0';
    row.getCell(9).numFmt = '#,##0';
    row.getCell(11).numFmt = '#,##0';
    row.getCell(12).numFmt = '#,##0';
    row.getCell(13).numFmt = '#,##0';
    row.getCell(14).numFmt = '#,##0';
    row.getCell(15).alignment = { horizontal: 'center' };
    row.getCell(16).alignment = { horizontal: 'center' };
  });

  const totalRow = worksheet.addRow([
    'TỔNG CỘNG',
    `${invoices.length} hóa đơn`,
    '', '', '', '', '', '', '', '', '',
    sumTotal,
    sumPaid,
    sumRemaining,
    '', '', ''
  ]);
  styleTotalRow(totalRow);
  totalRow.getCell(12).numFmt = '#,##0';
  totalRow.getCell(13).numFmt = '#,##0';
  totalRow.getCell(14).numFmt = '#,##0';

  columns.forEach((col, idx) => {
    worksheet.getColumn(idx + 1).width = col.width;
  });

  return workbook;
};

/**
 * 3. Xuất Excel Báo cáo Công nợ (Debts)
 */
const buildDebtsWorkbook = (debts, { period, className }) => {
  if (!debts || debts.length === 0) {
    throw Object.assign(new Error('Không có dữ liệu công nợ học phí phù hợp với bộ lọc hiện tại để xuất Excel.'), { statusCode: 404 });
  }
  if (debts.length > MAX_EXPORT_RECORDS) {
    throw Object.assign(new Error(`Dữ liệu vượt quá giới hạn ${MAX_EXPORT_RECORDS.toLocaleString('vi-VN')} bản ghi/lần xuất. Vui lòng thu hẹp bộ lọc theo lớp hoặc kỳ thu.`), { statusCode: 422 });
  }

  const { workbook, worksheet } = createBaseWorkbook({
    title: 'Báo cáo theo dõi công nợ học phí',
    sheetName: 'Công nợ',
    periodText: period || 'Tất cả các kỳ',
    filterText: `Lớp: ${className || 'Tất cả lớp'}`
  });

  const columns = [
    { header: 'STT', width: 8 },
    { header: 'Mã học sinh', width: 18 },
    { header: 'Họ và tên học sinh', width: 26 },
    { header: 'Lớp', width: 16 },
    { header: 'Kỳ thu', width: 12 },
    { header: 'Hạn thanh toán', width: 16 },
    { header: 'Tổng phải thu (VNĐ)', width: 22 },
    { header: 'Đã thu (VNĐ)', width: 18 },
    { header: 'Còn phải thu (VNĐ)', width: 22 },
    { header: 'Tình trạng', width: 18 }
  ];

  const headerRow = worksheet.getRow(5);
  headerRow.values = columns.map(c => c.header);
  styleHeaderRow(headerRow);

  let sumTotal = 0;
  let sumPaid = 0;
  let sumRemaining = 0;

  debts.forEach((item, index) => {
    const rowNum = index + 1;
    const totalAmount = assertSafeVnd(item.totalAmount, `Công nợ dòng ${rowNum}: Tổng phải thu`);
    const paidAmount = assertSafeVnd(item.paidAmount, `Công nợ dòng ${rowNum}: Đã thu`);
    const remainingAmount = assertSafeVnd(item.remainingAmount, `Công nợ dòng ${rowNum}: Còn phải thu`);

    sumTotal = safeAddVnd(sumTotal, totalAmount, 'Tổng cột phải thu');
    sumPaid = safeAddVnd(sumPaid, paidAmount, 'Tổng cột đã thu');
    sumRemaining = safeAddVnd(sumRemaining, remainingAmount, 'Tổng cột còn phải thu');

    const row = worksheet.addRow([
      rowNum,
      sanitizeCell(item.studentCode || ''),
      sanitizeCell(item.studentName),
      sanitizeCell(item.className),
      sanitizeCell(item.period),
      formatDateVN(item.dueDate),
      totalAmount,
      paidAmount,
      remainingAmount,
      item.overdue ? 'Quá hạn thanh toán' : 'Trong hạn thanh toán'
    ]);

    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(2).numFmt = '@';
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(5).alignment = { horizontal: 'center' };
    row.getCell(6).alignment = { horizontal: 'center' };
    row.getCell(7).numFmt = '#,##0';
    row.getCell(8).numFmt = '#,##0';
    row.getCell(9).numFmt = '#,##0';
    row.getCell(10).alignment = { horizontal: 'center' };
  });

  const totalRow = worksheet.addRow([
    'TỔNG CỘNG',
    `${debts.length} khoản nợ`,
    '', '', '', '',
    sumTotal,
    sumPaid,
    sumRemaining,
    ''
  ]);
  styleTotalRow(totalRow);
  totalRow.getCell(7).numFmt = '#,##0';
  totalRow.getCell(8).numFmt = '#,##0';
  totalRow.getCell(9).numFmt = '#,##0';

  columns.forEach((col, idx) => {
    worksheet.getColumn(idx + 1).width = col.width;
  });

  return workbook;
};

/**
 * 4. Xuất Excel Lịch sử Thu tiền / Biên lai (Payments)
 */
const buildPaymentsWorkbook = (payments, filterLabel = 'Tất cả') => {
  if (!payments || payments.length === 0) {
    throw Object.assign(new Error('Không có dữ liệu thu tiền / biên lai phù hợp để xuất Excel.'), { statusCode: 404 });
  }
  if (payments.length > MAX_EXPORT_RECORDS) {
    throw Object.assign(new Error(`Dữ liệu vượt quá giới hạn ${MAX_EXPORT_RECORDS.toLocaleString('vi-VN')} bản ghi/lần xuất. Vui lòng thu hẹp khoảng ngày tra cứu.`), { statusCode: 422 });
  }

  const methodLabel = {
    cash: 'Tiền mặt',
    bank_transfer: 'Chuyển khoản ngân hàng',
    bank: 'Chuyển khoản ngân hàng',
    ewallet: 'Ví điện tử',
    wallet: 'Ví điện tử'
  };

  const { workbook, worksheet } = createBaseWorkbook({
    title: 'Sổ lịch sử thu tiền học phí & biên lai',
    sheetName: 'Biên lai thu tiền',
    periodText: filterLabel,
    filterText: filterLabel
  });

  const columns = [
    { header: 'STT', width: 8 },
    { header: 'Số biên lai (Phiếu thu)', width: 22 },
    { header: 'Ngày thu tiền', width: 18 },
    { header: 'Số tiền thu (VNĐ)', width: 20 },
    { header: 'Phương thức', width: 24 },
    { header: 'Mã GD đối soát', width: 24 },
    { header: 'Người thu tiền', width: 22 },
    { header: 'Ghi chú', width: 25 }
  ];

  const headerRow = worksheet.getRow(5);
  headerRow.values = columns.map(c => c.header);
  styleHeaderRow(headerRow);

  let sumAmount = 0;

  payments.forEach((p, index) => {
    const rowNum = index + 1;
    const amount = assertSafeVnd(p.amount, `Biên lai dòng ${rowNum}: Số tiền thu`);
    sumAmount = safeAddVnd(sumAmount, amount, 'Tổng tiền biên lai');

    const row = worksheet.addRow([
      rowNum,
      sanitizeCell(p.receiptNumber || `PT-${String(p._id).slice(-6)}`),
      formatDateTimeVN(p.paidAt),
      amount,
      methodLabel[p.method] || p.method,
      sanitizeCell(p.txnRef || (p.method === 'cash' ? 'Tiền mặt' : '—')),
      sanitizeCell(p.recordedByName || 'Hệ thống'),
      sanitizeCell(p.note || '')
    ]);

    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(2).numFmt = '@';
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(3).alignment = { horizontal: 'center' };
    row.getCell(4).numFmt = '#,##0';
    row.getCell(5).alignment = { horizontal: 'center' };
    row.getCell(6).numFmt = '@';
  });

  const totalRow = worksheet.addRow([
    'TỔNG THU',
    `${payments.length} lượt thu`,
    '',
    sumAmount,
    '', '', '', ''
  ]);
  styleTotalRow(totalRow);
  totalRow.getCell(4).numFmt = '#,##0';

  columns.forEach((col, idx) => {
    worksheet.getColumn(idx + 1).width = col.width;
  });

  return workbook;
};

/**
 * 5. Xuất Excel Sổ chi mua sắm thực chi (Purchase Expenses)
 */
const buildPurchaseExpensesWorkbook = (expenses, filterLabel = 'Tất cả') => {
  if (!expenses || expenses.length === 0) {
    throw Object.assign(new Error('Không có dữ liệu sổ chi mua sắm phù hợp để xuất Excel.'), { statusCode: 404 });
  }
  if (expenses.length > MAX_EXPORT_RECORDS) {
    throw Object.assign(new Error(`Dữ liệu vượt quá giới hạn ${MAX_EXPORT_RECORDS.toLocaleString('vi-VN')} bản ghi/lần xuất. Vui lòng thu hẹp bộ lọc.`), { statusCode: 422 });
  }

  const methodLabel = {
    cash: 'Tiền mặt',
    bank_transfer: 'Chuyển khoản ngân hàng',
    bank: 'Chuyển khoản ngân hàng',
    ewallet: 'Ví điện tử',
    wallet: 'Ví điện tử'
  };

  const { workbook, worksheet } = createBaseWorkbook({
    title: 'Sổ chi mua sắm thiết bị & cơ sở vật chất (Thực chi)',
    sheetName: 'Sổ chi mua sắm',
    periodText: filterLabel,
    filterText: filterLabel
  });

  const columns = [
    { header: 'STT', width: 8 },
    { header: 'Số chứng từ chi', width: 22 },
    { header: 'Mã đơn mua', width: 18 },
    { header: 'Ngày chi tiền', width: 18 },
    { header: 'Nhà cung cấp', width: 28 },
    { header: 'Số tiền chi (VNĐ)', width: 22 },
    { header: 'Hình thức chi', width: 24 },
    { header: 'Mã GD đối soát', width: 24 },
    { header: 'Người lập phiếu chi', width: 22 },
    { header: 'Ghi chú', width: 30 }
  ];

  const headerRow = worksheet.getRow(5);
  headerRow.values = columns.map(c => c.header);
  styleHeaderRow(headerRow);

  let sumAmount = 0;

  expenses.forEach((e, index) => {
    const rowNum = index + 1;
    const amount = assertSafeVnd(e.amount, `Chi mua sắm dòng ${rowNum}: Số tiền chi`);
    sumAmount = safeAddVnd(sumAmount, amount, 'Tổng chi mua sắm');

    const row = worksheet.addRow([
      rowNum,
      sanitizeCell(e.documentNumber || `PC-${String(e._id).slice(-6)}`),
      sanitizeCell(e.orderCode || '—'),
      formatDateTimeVN(e.paidAt),
      sanitizeCell(e.supplierName || '—'),
      amount,
      methodLabel[e.method] || e.method || '—',
      sanitizeCell(e.transactionRef || (e.method === 'cash' ? 'Tiền mặt' : '—')),
      sanitizeCell(e.recordedByName || '—'),
      sanitizeCell(e.note || '')
    ]);

    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(2).numFmt = '@';
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(3).numFmt = '@';
    row.getCell(3).alignment = { horizontal: 'center' };
    row.getCell(4).alignment = { horizontal: 'center' };
    row.getCell(6).numFmt = '#,##0';
    row.getCell(7).alignment = { horizontal: 'center' };
    row.getCell(8).numFmt = '@';
  });

  const totalRow = worksheet.addRow([
    'TỔNG CHI',
    `${expenses.length} khoản chi`,
    '', '', '',
    sumAmount,
    '', '', '', ''
  ]);
  styleTotalRow(totalRow);
  totalRow.getCell(6).numFmt = '#,##0';

  columns.forEach((col, idx) => {
    worksheet.getColumn(idx + 1).width = col.width;
  });

  return workbook;
};

/**
 * 6. Xuất Excel Chi vận hành (Operating Expenses)
 */
const buildOperatingExpensesWorkbook = (expenses, filterLabel = 'Tất cả') => {
  if (!expenses || expenses.length === 0) {
    throw Object.assign(new Error('Không có dữ liệu chi vận hành phù hợp để xuất Excel.'), { statusCode: 404 });
  }
  if (expenses.length > MAX_EXPORT_RECORDS) {
    throw Object.assign(new Error(`Dữ liệu vượt quá giới hạn ${MAX_EXPORT_RECORDS.toLocaleString('vi-VN')} bản ghi/lần xuất. Vui lòng thu hẹp bộ lọc.`), { statusCode: 422 });
  }

  const categoryLabel = {
    utilities: 'Điện / Nước / Viễn thông',
    rent: 'Thuê mặt bằng / Cơ sở',
    maintenance: 'Sửa chữa / Bảo trì',
    services: 'Dịch vụ ngoài / Thuê ngoài',
    other: 'Chi phí vận hành khác'
  };

  const methodLabel = {
    cash: 'Tiền mặt',
    bank_transfer: 'Chuyển khoản ngân hàng',
    bank: 'Chuyển khoản ngân hàng',
    ewallet: 'Ví điện tử',
    wallet: 'Ví điện tử'
  };

  const { workbook, worksheet } = createBaseWorkbook({
    title: 'Sổ theo dõi chi phí vận hành (Thực chi)',
    sheetName: 'Chi vận hành',
    periodText: filterLabel,
    filterText: filterLabel
  });

  const columns = [
    { header: 'STT', width: 8 },
    { header: 'Số chứng từ chi', width: 22 },
    { header: 'Ngày chi tiền', width: 18 },
    { header: 'Danh mục chi', width: 26 },
    { header: 'Nội dung chi tiết', width: 35 },
    { header: 'Số tiền chi (VNĐ)', width: 20 },
    { header: 'Hình thức', width: 24 },
    { header: 'Người / Đơn vị nhận tiền', width: 26 },
    { header: 'Người duyệt chi', width: 22 },
    { header: 'Mã GD đối soát', width: 22 },
    { header: 'Người lập phiếu', width: 22 },
    { header: 'Ghi chú', width: 25 }
  ];

  const headerRow = worksheet.getRow(5);
  headerRow.values = columns.map(c => c.header);
  styleHeaderRow(headerRow);

  let sumAmount = 0;

  expenses.forEach((e, index) => {
    const rowNum = index + 1;
    const amount = assertSafeVnd(e.amount, `Chi vận hành dòng ${rowNum}: Số tiền chi`);
    sumAmount = safeAddVnd(sumAmount, amount, 'Tổng chi vận hành');

    const reviewer = (e.approvalRequestId && typeof e.approvalRequestId === 'object' && e.approvalRequestId.reviewedByName)
      || e.approvalReference
      || '—';

    const row = worksheet.addRow([
      rowNum,
      sanitizeCell(e.documentNumber || `CP-${String(e._id).slice(-6)}`),
      formatDateTimeVN(e.paidAt),
      categoryLabel[e.category] || e.category || 'Chi vận hành',
      sanitizeCell(e.description || ''),
      amount,
      methodLabel[e.method] || e.method || '—',
      sanitizeCell(e.payee || ''),
      sanitizeCell(reviewer),
      sanitizeCell(e.transactionRef || (e.method === 'cash' ? 'Tiền mặt' : '—')),
      sanitizeCell(e.recordedByName || '—'),
      sanitizeCell(e.note || '')
    ]);

    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(2).numFmt = '@';
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(3).alignment = { horizontal: 'center' };
    row.getCell(6).numFmt = '#,##0';
    row.getCell(7).alignment = { horizontal: 'center' };
    row.getCell(10).numFmt = '@';
  });

  const totalRow = worksheet.addRow([
    'TỔNG CHI',
    `${expenses.length} khoản chi`,
    '', '', '',
    sumAmount,
    '', '', '', '', '', ''
  ]);
  styleTotalRow(totalRow);
  totalRow.getCell(6).numFmt = '#,##0';

  columns.forEach((col, idx) => {
    worksheet.getColumn(idx + 1).width = col.width;
  });

  return workbook;
};

/**
 * 7. Xuất Excel Sổ quỹ & Đối soát thu - chi (Cashbook)
 * Duy trì 6 cột riêng biệt: cashIn, bankIn, walletIn, cashOut, bankOut, walletOut
 */
const buildCashbookWorkbook = (cashbookData, periodLabel = '') => {
  const daily = cashbookData?.daily || [];
  const rows = cashbookData?.rows || [];

  if (daily.length === 0 && rows.length === 0) {
    throw Object.assign(new Error('Không có dữ liệu sổ quỹ đối soát cho khoảng ngày đã chọn để xuất Excel.'), { statusCode: 404 });
  }

  const titlePeriod = periodLabel || `${cashbookData?.from || ''} đến ${cashbookData?.to || ''}`;

  const { workbook, worksheet: dailySheet } = createBaseWorkbook({
    title: 'Sổ quỹ & Đối soát thu – chi hàng ngày',
    sheetName: 'Sổ quỹ đối soát ngày',
    periodText: titlePeriod,
    filterText: `Khoảng ngày: ${titlePeriod}`
  });

  // Sheet 1: Đối soát từng ngày làm việc
  const dailyColumns = [
    { header: 'STT', width: 8 },
    { header: 'Ngày làm việc', width: 16 },
    { header: 'Thu tiền mặt (VNĐ)', width: 22 },
    { header: 'Thu chuyển khoản (VNĐ)', width: 24 },
    { header: 'Thu ví điện tử (VNĐ)', width: 22 },
    { header: 'Tổng thu (VNĐ)', width: 22 },
    { header: 'Chi tiền mặt (VNĐ)', width: 22 },
    { header: 'Chi chuyển khoản (VNĐ)', width: 24 },
    { header: 'Chi ví điện tử (VNĐ)', width: 22 },
    { header: 'Tổng chi (VNĐ)', width: 22 },
    { header: 'Chênh lệch ròng ngày (VNĐ)', width: 26 },
    { header: 'Trạng thái đối soát', width: 20 },
    { header: 'Người đối soát', width: 22 },
    { header: 'Ghi chú đối soát', width: 30 }
  ];

  const headerRow1 = dailySheet.getRow(5);
  headerRow1.values = dailyColumns.map(c => c.header);
  styleHeaderRow(headerRow1);

  let sumCashIn = 0;
  let sumBankIn = 0;
  let sumWalletIn = 0;
  let sumTotalIn = 0;
  let sumCashOut = 0;
  let sumBankOut = 0;
  let sumWalletOut = 0;
  let sumTotalOut = 0;
  let sumNet = 0;

  const reconStatusMap = {
    matched: 'Khớp số liệu',
    difference: 'Có chênh lệch',
    stale: 'Cần cập nhật',
    needs_review: 'Cần kiểm tra',
    not_recorded: 'Chưa đối soát'
  };

  daily.forEach((d, index) => {
    const cashIn = assertSafeVnd(d.cashIn || 0, `Sổ quỹ ngày ${d.workDate}: Thu tiền mặt`);
    const bankIn = assertSafeVnd(d.bankIn || 0, `Sổ quỹ ngày ${d.workDate}: Thu chuyển khoản`);
    const walletIn = assertSafeVnd(d.walletIn || 0, `Sổ quỹ ngày ${d.workDate}: Thu ví điện tử`);
    const dayTotalIn = safeAddVnd(cashIn, safeAddVnd(bankIn, walletIn, `Tổng thu ngày ${d.workDate}`), `Tổng thu ngày ${d.workDate}`);

    const cashOut = assertSafeVnd(d.cashOut || 0, `Sổ quỹ ngày ${d.workDate}: Chi tiền mặt`);
    const bankOut = assertSafeVnd(d.bankOut || 0, `Sổ quỹ ngày ${d.workDate}: Chi chuyển khoản`);
    const walletOut = assertSafeVnd(d.walletOut || 0, `Sổ quỹ ngày ${d.workDate}: Chi ví điện tử`);
    const dayTotalOut = safeAddVnd(cashOut, safeAddVnd(bankOut, walletOut, `Tổng chi ngày ${d.workDate}`), `Tổng chi ngày ${d.workDate}`);

    const net = safeNetVnd(dayTotalIn, dayTotalOut, `Chênh lệch ngày ${d.workDate}`);

    sumCashIn = safeAddVnd(sumCashIn, cashIn, 'Tổng thu tiền mặt');
    sumBankIn = safeAddVnd(sumBankIn, bankIn, 'Tổng thu chuyển khoản');
    sumWalletIn = safeAddVnd(sumWalletIn, walletIn, 'Tổng thu ví điện tử');
    sumTotalIn = safeAddVnd(sumTotalIn, dayTotalIn, 'Tổng cộng thu');

    sumCashOut = safeAddVnd(sumCashOut, cashOut, 'Tổng chi tiền mặt');
    sumBankOut = safeAddVnd(sumBankOut, bankOut, 'Tổng chi chuyển khoản');
    sumWalletOut = safeAddVnd(sumWalletOut, walletOut, 'Tổng chi ví điện tử');
    sumTotalOut = safeAddVnd(sumTotalOut, dayTotalOut, 'Tổng cộng chi');

    sumNet = safeNetVnd(sumTotalIn, sumTotalOut, 'Tổng chênh lệch ròng');

    const recon = d.reconciliation;
    const reconStatusText = recon ? (reconStatusMap[recon.status] || recon.status) : 'Chưa đối soát';

    const row = dailySheet.addRow([
      index + 1,
      formatDateVN(d.workDate),
      cashIn,
      bankIn,
      walletIn,
      dayTotalIn,
      cashOut,
      bankOut,
      walletOut,
      dayTotalOut,
      net,
      reconStatusText,
      sanitizeCell(recon?.recordedByName || '—'),
      sanitizeCell(recon?.note || '')
    ]);

    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(3).numFmt = '#,##0';
    row.getCell(4).numFmt = '#,##0';
    row.getCell(5).numFmt = '#,##0';
    row.getCell(6).numFmt = '#,##0';
    row.getCell(7).numFmt = '#,##0';
    row.getCell(8).numFmt = '#,##0';
    row.getCell(9).numFmt = '#,##0';
    row.getCell(10).numFmt = '#,##0';
    row.getCell(11).numFmt = '#,##0';
    row.getCell(12).alignment = { horizontal: 'center' };
  });

  const totalRow1 = dailySheet.addRow([
    'TỔNG CỘNG',
    `${daily.length} ngày`,
    sumCashIn,
    sumBankIn,
    sumWalletIn,
    sumTotalIn,
    sumCashOut,
    sumBankOut,
    sumWalletOut,
    sumTotalOut,
    sumNet,
    '', '', ''
  ]);
  styleTotalRow(totalRow1);
  for (let c = 3; c <= 11; c++) {
    totalRow1.getCell(c).numFmt = '#,##0';
  }

  dailyColumns.forEach((col, idx) => {
    dailySheet.getColumn(idx + 1).width = col.width;
  });

  // Sheet 2: Chi tiết từng giao dịch phát sinh
  if (rows.length > 0) {
    const txSheet = workbook.addWorksheet('Chi tiết giao dịch', {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 5 }]
    });

    const txR1 = txSheet.getRow(1);
    txR1.values = ['TRƯỜNG MẦM NON HOA NẮNG - BỘ PHẬN KẾ TOÁN & TÀI CHÍNH'];
    txR1.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF475569' } };

    const txR2 = txSheet.getRow(2);
    txR2.values = ['CHI TIẾT CÁC PHÁT SINH THU – CHI'];
    txR2.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FF1E3A8A' } };
    txR2.height = 24;

    const txR3 = txSheet.getRow(3);
    txR3.values = [`Kỳ tra cứu: ${titlePeriod} | Tổng số dòng: ${rows.length} giao dịch`];
    txR3.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF64748B' } };
    txSheet.getRow(4).height = 10;

    const txColumns = [
      { header: 'STT', width: 8 },
      { header: 'Thời gian', width: 18 },
      { header: 'Nguồn phát sinh', width: 22 },
      { header: 'Chiều dòng tiền', width: 16 },
      { header: 'Số tiền (VNĐ)', width: 20 },
      { header: 'Phương thức', width: 24 },
      { header: 'Số chứng từ', width: 22 },
      { header: 'Mã GD / Tham chiếu', width: 24 },
      { header: 'Đối tượng liên quan', width: 30 },
      { header: 'Ghi chú / Vấn đề', width: 30 }
    ];

    const txHeaderRow = txSheet.getRow(5);
    txHeaderRow.values = txColumns.map(c => c.header);
    styleHeaderRow(txHeaderRow);

    const sourceNameMap = {
      tuition: 'Học phí',
      tuition_refund: 'Hoàn học phí',
      purchase: 'Chi mua sắm',
      operating: 'Chi vận hành',
      payroll: 'Chi lương'
    };

    const methodDisplay = (m) => {
      if (m === 'cash') return 'Tiền mặt';
      if (m === 'bank_transfer' || m === 'bank') return 'Chuyển khoản ngân hàng';
      if (m === 'ewallet' || m === 'wallet') return 'Ví điện tử';
      return m || '—';
    };

    rows.forEach((r, idx) => {
      const rowNum = idx + 1;
      const amount = assertSafeVnd(r.amount, `Chi tiết giao dịch dòng ${rowNum}: Số tiền`);

      const txRow = txSheet.addRow([
        rowNum,
        formatDateTimeVN(r.paidAt),
        sourceNameMap[r.source] || r.source,
        r.direction === 'in' ? 'Thu vào (+)' : 'Chi ra (-)',
        amount,
        methodDisplay(r.method),
        sanitizeCell(r.documentNumber || '—'),
        sanitizeCell(r.reference || '—'),
        sanitizeCell(r.party || '—'),
        sanitizeCell(r.issue || 'Hợp lệ')
      ]);

      txRow.getCell(1).alignment = { horizontal: 'center' };
      txRow.getCell(2).alignment = { horizontal: 'center' };
      txRow.getCell(3).alignment = { horizontal: 'center' };
      txRow.getCell(4).alignment = { horizontal: 'center' };
      txRow.getCell(5).numFmt = '#,##0';
      txRow.getCell(6).alignment = { horizontal: 'center' };
      txRow.getCell(7).numFmt = '@';
      txRow.getCell(8).numFmt = '@';
    });

    txColumns.forEach((col, idx) => {
      txSheet.getColumn(idx + 1).width = col.width;
    });
  }

  return workbook;
};

/**
 * 8. Xuất Excel Bảng lương (Payroll)
 */
const buildPayrollWorkbook = (payrolls, { month, year }) => {
  if (!payrolls || payrolls.length === 0) {
    throw Object.assign(new Error('Không có dữ liệu bảng lương cho kỳ đã chọn để xuất Excel.'), { statusCode: 404 });
  }

  const statusLabel = {
    draft: 'HR đã lập nháp',
    reviewed: 'Kế toán đã đối soát',
    confirmed: 'Hiệu trưởng đã duyệt',
    paid: 'Đã chi trả'
  };

  const { workbook, worksheet } = createBaseWorkbook({
    title: `Bảng lương nhân sự tháng ${month}/${year}`,
    sheetName: 'Bảng lương',
    periodText: `Tháng ${month}-${year}`,
    filterText: `Kỳ lương: Tháng ${month}/${year}`
  });

  const columns = [
    { header: 'STT', width: 8 },
    { header: 'Mã nhân viên', width: 16 },
    { header: 'Họ và tên nhân viên', width: 26 },
    { header: 'Vị trí / Vai trò', width: 22 },
    { header: 'Lương cơ bản (VNĐ)', width: 20 },
    { header: 'Công chuẩn', width: 14 },
    { header: 'Công thực tế', width: 14 },
    { header: 'Lương theo công (VNĐ)', width: 22 },
    { header: 'Phụ cấp & Thêm giờ (VNĐ)', width: 24 },
    { header: 'Tạm ứng (VNĐ)', width: 18 },
    { header: 'BHXH/BHYT (VNĐ)', width: 18 },
    { header: 'Giảm trừ khác (VNĐ)', width: 20 },
    { header: 'Thực lĩnh (VNĐ)', width: 22 },
    { header: 'Trạng thái', width: 18 },
    { header: 'Ngày chi trả', width: 18 },
    { header: 'Hình thức', width: 20 },
    { header: 'Mã GD chi trả', width: 22 },
    { header: 'Ghi chú', width: 25 }
  ];

  const headerRow = worksheet.getRow(5);
  headerRow.values = columns.map(c => c.header);
  styleHeaderRow(headerRow);

  let sumBase = 0;
  let sumGross = 0;
  let sumAllowance = 0;
  let sumAdvance = 0;
  let sumInsurance = 0;
  let sumOtherDeduction = 0;
  let sumNet = 0;

  payrolls.forEach((p, index) => {
    const rowNum = index + 1;
    const base = assertSafeVnd(p.baseSalary, `Bảng lương NV ${p.employeeName || rowNum}: Lương cơ bản`);
    const gross = assertSafeVnd(p.grossSalary, `Bảng lương NV ${p.employeeName || rowNum}: Tổng thu nhập`);

    const posAllow = assertSafeVnd(p.allowances?.position || 0, `Phụ cấp chức vụ`);
    const lunchAllow = assertSafeVnd(p.allowances?.lunch || 0, `Phụ cấp ăn trưa`);
    const otherAllow = assertSafeVnd(p.allowances?.other || 0, `Phụ cấp khác`);
    const otPay = assertSafeVnd(p.overtimePay || 0, `Tiền làm thêm`);
    const totalAllowances = safeAddVnd(posAllow, safeAddVnd(lunchAllow, safeAddVnd(otherAllow, otPay, 'Phụ cấp'), 'Phụ cấp'), 'Tổng phụ cấp');

    const advance = assertSafeVnd(p.deductions?.advancePayment || 0, `Tạm ứng`);
    const insurance = assertSafeVnd(p.deductions?.insurance || 0, `Bảo hiểm`);
    const otherDeduct = assertSafeVnd(p.deductions?.other || 0, `Giảm trừ khác`);
    const net = assertSafeVnd(p.netSalary, `Bảng lương NV ${p.employeeName || rowNum}: Thực lĩnh`);

    sumBase = safeAddVnd(sumBase, base, 'Tổng lương cơ bản');
    sumGross = safeAddVnd(sumGross, gross, 'Tổng thu nhập');
    sumAllowance = safeAddVnd(sumAllowance, totalAllowances, 'Tổng phụ cấp');
    sumAdvance = safeAddVnd(sumAdvance, advance, 'Tổng tạm ứng');
    sumInsurance = safeAddVnd(sumInsurance, insurance, 'Tổng bảo hiểm');
    sumOtherDeduction = safeAddVnd(sumOtherDeduction, otherDeduct, 'Tổng giảm trừ khác');
    sumNet = safeAddVnd(sumNet, net, 'Tổng thực lĩnh');

    const stdDays = p.standardWorkDays != null ? Number(p.standardWorkDays) : '—';
    const actDays = p.actualWorkDays != null ? Number(p.actualWorkDays) : 0;

    const row = worksheet.addRow([
      rowNum,
      sanitizeCell(p.employeeCode || (p.employeeId && p.employeeId.employeeCode) || ''),
      sanitizeCell(p.employeeName || (p.employeeId && p.employeeId.fullName) || ''),
      sanitizeCell(p.position || p.payrollRole || ''),
      base,
      stdDays,
      actDays,
      gross,
      totalAllowances,
      advance,
      insurance,
      otherDeduct,
      net,
      statusLabel[p.status] || p.status,
      p.paidAt ? formatDateTimeVN(p.paidAt) : '—',
      p.paymentMethod === 'cash' ? 'Tiền mặt' : p.paymentMethod === 'bank_transfer' ? 'Chuyển khoản' : (p.paymentMethod || '—'),
      sanitizeCell(p.paymentReference || ''),
      sanitizeCell(p.note || '')
    ]);

    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(2).numFmt = '@';
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(5).numFmt = '#,##0';
    row.getCell(6).alignment = { horizontal: 'center' };
    row.getCell(7).alignment = { horizontal: 'center' };
    row.getCell(8).numFmt = '#,##0';
    row.getCell(9).numFmt = '#,##0';
    row.getCell(10).numFmt = '#,##0';
    row.getCell(11).numFmt = '#,##0';
    row.getCell(12).numFmt = '#,##0';
    row.getCell(13).numFmt = '#,##0';
    row.getCell(14).alignment = { horizontal: 'center' };
    row.getCell(15).alignment = { horizontal: 'center' };
    row.getCell(16).alignment = { horizontal: 'center' };
    row.getCell(17).numFmt = '@';
  });

  const totalRow = worksheet.addRow([
    'TỔNG CỘNG',
    `${payrolls.length} nhân viên`,
    '', '',
    sumBase,
    '', '',
    sumGross,
    sumAllowance,
    sumAdvance,
    sumInsurance,
    sumOtherDeduction,
    sumNet,
    '', '', '', '', ''
  ]);
  styleTotalRow(totalRow);
  totalRow.getCell(5).numFmt = '#,##0';
  totalRow.getCell(8).numFmt = '#,##0';
  totalRow.getCell(9).numFmt = '#,##0';
  totalRow.getCell(10).numFmt = '#,##0';
  totalRow.getCell(11).numFmt = '#,##0';
  totalRow.getCell(12).numFmt = '#,##0';
  totalRow.getCell(13).numFmt = '#,##0';

  columns.forEach((col, idx) => {
    worksheet.getColumn(idx + 1).width = col.width;
  });

  return workbook;
};

/**
 * 9. Xuất Excel Báo cáo Kế toán tổng hợp (Accounting Report)
 */
const buildAccountingReportWorkbook = (reportData, monthLabel) => {
  if (!reportData) {
    throw Object.assign(new Error('Không có dữ liệu báo cáo kế toán để xuất Excel.'), { statusCode: 404 });
  }

  const { workbook, worksheet } = createBaseWorkbook({
    title: `Báo cáo tài chính kế toán tháng ${monthLabel}`,
    sheetName: 'Báo cáo kế toán',
    periodText: `Tháng ${monthLabel}`,
    filterText: `Kỳ kế toán tháng ${monthLabel}`
  });

  const columns = [
    { header: 'STT', width: 8 },
    { header: 'Hạng mục tài chính', width: 42 },
    { header: 'Số tiền (VNĐ)', width: 25 },
    { header: 'Ghi chú / Thuyết minh', width: 50 }
  ];

  const headerRow = worksheet.getRow(5);
  headerRow.values = columns.map(c => c.header);
  styleHeaderRow(headerRow);

  const cashFlow = reportData.cashFlow || {};
  const tuitionIncome = assertSafeVnd(cashFlow.tuitionIncome || 0, 'Báo cáo: Doanh thu học phí thực thu');
  const purchaseOutflow = assertSafeVnd(cashFlow.purchaseOutflow || 0, 'Báo cáo: Chi mua sắm');
  const operatingOutflow = assertSafeVnd(cashFlow.operatingOutflow || 0, 'Báo cáo: Chi vận hành');
  const payrollOutflow = assertSafeVnd(cashFlow.payrollOutflow || 0, 'Báo cáo: Chi lương');
  const tuitionRefundOutflow = assertSafeVnd(cashFlow.tuitionRefundOutflow || 0, 'Báo cáo: Hoàn phí');

  let totalOutflows = safeAddVnd(purchaseOutflow, operatingOutflow, 'Tổng chi');
  totalOutflows = safeAddVnd(totalOutflows, payrollOutflow, 'Tổng chi');
  totalOutflows = safeAddVnd(totalOutflows, tuitionRefundOutflow, 'Tổng chi');

  const recordedNet = cashFlow.recordedNet != null
    ? assertSafeVnd(cashFlow.recordedNet, 'Báo cáo: Chênh lệch thu – chi', true)
    : safeNetVnd(tuitionIncome, totalOutflows, 'Chênh lệch thu – chi');

  const rows = [
    ['I', 'DOANH THU & THU TIỀN THỰC TẾ', '', ''],
    ['1', 'Tổng doanh thu học phí thực thu', tuitionIncome, 'Dựa trên phiếu thu / biên lai học phí thực tế đã thu'],
    ['II', 'CÁC KHOẢN CHI TIỀN THỰC TẾ', '', ''],
    ['2', 'Tổng chi mua sắm vật tư / cơ sở vật chất', purchaseOutflow, 'Các đơn mua đã ghi nhận sổ chi thực tế'],
    ['3', 'Tổng chi phí vận hành thường xuyên', operatingOutflow, 'Điện, nước, thuê mặt bằng, bảo trì, dịch vụ ngoài...'],
    ['4', 'Tổng chi lương nhân sự thực chi', payrollOutflow, 'Bảng lương nhân viên đã xác nhận chi trả'],
    ['5', 'Tổng chi hoàn tiền học phí', tuitionRefundOutflow, 'Các yêu cầu hoàn phí đã duyệt và thực chi'],
    ['6', 'TỔNG CHI TIỀN TRONG KỲ (2 + 3 + 4 + 5)', totalOutflows, 'Tổng toàn bộ dòng tiền chi ra trong kỳ kế toán'],
    ['III', 'KẾT QUẢ TÀI CHÍNH KỲ BÁO CÁO', '', ''],
    ['7', 'CHÊNH LỆCH THU – CHI TRONG KỲ (1 - 6)', recordedNet, 'Dòng tiền thuần ghi nhận trong kỳ (Thu trừ Chi)']
  ];

  rows.forEach(([stt, item, amount, note]) => {
    const isSectionHeader = stt === 'I' || stt === 'II' || stt === 'III';
    const isSummaryRow = stt === '6' || stt === '7';

    const row = worksheet.addRow([
      stt,
      item,
      isSectionHeader ? '' : Number(amount || 0),
      sanitizeCell(note)
    ]);

    row.getCell(1).alignment = { horizontal: 'center' };
    if (!isSectionHeader) {
      row.getCell(3).numFmt = '#,##0';
    }

    if (isSectionHeader) {
      row.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF1E3A8A' } };
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    } else if (isSummaryRow) {
      row.font = { name: 'Arial', size: 10, bold: true };
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      row.border = {
        top: { style: 'thin', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'double', color: { argb: 'FF0F172A' } }
      };
    }
  });

  columns.forEach((col, idx) => {
    worksheet.getColumn(idx + 1).width = col.width;
  });

  return workbook;
};

module.exports = {
  MAX_EXPORT_RECORDS,
  buildFeeSchedulesWorkbook,
  buildInvoicesWorkbook,
  buildDebtsWorkbook,
  buildPaymentsWorkbook,
  buildPurchaseExpensesWorkbook,
  buildOperatingExpensesWorkbook,
  buildCashbookWorkbook,
  buildPayrollWorkbook,
  buildAccountingReportWorkbook
};
