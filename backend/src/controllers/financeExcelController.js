const crypto = require('crypto');
const mongoose = require('mongoose');
const FeeSchedule = require('../models/zone4_finance/FeeSchedule');
const TuitionFee = require('../models/zone4_finance/TuitionFee');
const Payment = require('../models/zone4_finance/Payment');
const PurchaseExpense = require('../models/zone4_finance/PurchaseExpense');
const OperatingExpense = require('../models/zone4_finance/OperatingExpense');
const Payroll = require('../models/zone2_hr/Payroll');
const Classroom = require('../models/zone3_school/Classroom');
const Student = require('../models/zone3_school/Student');
const AuditLog = require('../models/zone1_system/AuditLog');
const ImportIdempotency = require('../models/zone1_system/ImportIdempotency');
const { runStudentTransaction } = require('../services/studentCoreService');
const { lockOpenPeriod, fromPeriod } = require('../services/accountingPeriodService');
const { getCashbookData } = require('./cashbookController');
const { buildAccountingReport } = require('./accountingReportController');
const { addWorkDays, getWorkDate, isValidWorkDate, startOfWorkDate } = require('../utils/dateHelpers');

const exportService = require('../services/financeExcelExportService');
const importService = require('../services/financeExcelImportService');

const actorName = (user) => user?.profile?.fullName || user?.username || 'Kế toán viên';
const httpError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const escapeRegExp = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Phân tích và xác thực một giá trị kỳ/tháng đơn lẻ
 * - Chặn mảng và đối tượng (throw 400)
 * - Yêu cầu chuỗi hợp lệ MM-YYYY hoặc YYYY-MM
 * - Chuẩn hóa về yyyymm: "YYYY-MM"
 */
const parseSingleMonthYear = (rawVal, paramName = 'period') => {
  if (rawVal === undefined) return undefined;
  if (Array.isArray(rawVal) || (typeof rawVal === 'object' && rawVal !== null)) {
    throw httpError(`Tham số "${paramName}" không hợp lệ (không chấp nhận kiểu mảng hoặc đối tượng).`, 400);
  }
  if (typeof rawVal !== 'string') {
    throw httpError(`Tham số "${paramName}" phải là chuỗi ký tự.`, 400);
  }
  const trimmed = rawVal.trim();
  if (!trimmed) return null;

  // Định dạng MM-YYYY (ví dụ: 10-2026)
  const m1 = trimmed.match(/^(0[1-9]|1[0-2])-(20\d{2})$/);
  if (m1) {
    return {
      month: Number(m1[1]),
      year: Number(m1[2]),
      period: trimmed,
      yyyymm: `${m1[2]}-${m1[1]}`
    };
  }

  // Định dạng YYYY-MM (ví dụ: 2026-10)
  const m2 = trimmed.match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
  if (m2) {
    return {
      month: Number(m2[2]),
      year: Number(m2[1]),
      period: `${m2[2]}-${m2[1]}`,
      yyyymm: trimmed
    };
  }

  throw httpError(`Định dạng tham số "${paramName}" ("${trimmed}") không hợp lệ. Vui lòng nhập MM-YYYY hoặc YYYY-MM (ví dụ: 10-2026 hoặc 2026-10).`, 400);
};

/**
 * Trích xuất tháng và năm từ tham số query:
 * - Parse độc lập từng tham số "period" và "month" nếu được cung cấp
 * - Chặn kiểu mảng/đối tượng
 * - Nếu cả hai cùng được truyền, chuẩn hóa về YYYY-MM và đối chiếu: nếu mâu thuẫn thì ném 400
 * - Nếu một tham số đúng, một tham số sai: ném 400 (không bỏ qua tham số sai)
 */
const parseMonthYearFilter = (query = {}) => {
  if (!query || typeof query !== 'object') {
    throw httpError('Tham số truy vấn (query) không hợp lệ.', 400);
  }

  const periodParsed = parseSingleMonthYear(query.period, 'period');
  const monthParsed = parseSingleMonthYear(query.month, 'month');

  // Cả hai không được truyền hoặc rỗng
  if (!periodParsed && !monthParsed) {
    return null;
  }

  // Chỉ truyền một trong hai
  if (periodParsed && !monthParsed) {
    return periodParsed;
  }
  if (!periodParsed && monthParsed) {
    return monthParsed;
  }

  // Cả hai cùng được truyền: kiểm tra khớp kỳ
  if (periodParsed.yyyymm !== monthParsed.yyyymm) {
    throw httpError(
      `Tham số kỳ/tháng mâu thuẫn: period="${query.period}" (${periodParsed.yyyymm}) và month="${query.month}" (${monthParsed.yyyymm}). Vui lòng chỉ định cùng một kỳ hoặc chỉ truyền một tham số.`,
      400
    );
  }

  return periodParsed;
};

/**
 * Quản lý khóa chống import trùng nguyên tử (Idempotency)
 * - Cho phép thử lại khi lần trước thất bại (status 'failed' -> 'processing' với lockToken mới)
 * - Tiếp quản yêu cầu 'processing' bị quá hạn > 2 phút
 * - Trả về phản hồi đã lưu nếu đã 'completed'
 */
const acquireImportLock = async ({ idempotencyKey, fingerprint, userId }) => {
  const currentLockToken = crypto.randomUUID();

  try {
    const doc = await ImportIdempotency.create({
      idempotencyKey,
      fingerprint,
      lockToken: currentLockToken,
      userId,
      status: 'processing'
    });
    return { status: 'acquired', doc, lockToken: currentLockToken };
  } catch (dupErr) {
    if (dupErr.code !== 11000) throw dupErr;

    const existing = await ImportIdempotency.findOne({ idempotencyKey });
    if (!existing) {
      return { status: 'conflict', statusCode: 409, message: 'Yêu cầu đang được xử lý bởi hệ thống.' };
    }
    if (String(existing.userId) !== String(userId)) {
      return { status: 'conflict', statusCode: 403, message: 'Idempotency-Key này thuộc về tài khoản người dùng khác.' };
    }
    if (existing.fingerprint !== fingerprint) {
      return { status: 'conflict', statusCode: 409, message: 'Idempotency-Key đã được sử dụng cho một bộ dữ liệu khác.' };
    }
    if (existing.status === 'completed') {
      return { status: 'cached', response: existing.response };
    }
    if (existing.status === 'failed') {
      // Cho phép thử lại nguyên tử khi lần trước thất bại với cùng key và fingerprint
      const acquired = await ImportIdempotency.findOneAndUpdate(
        { _id: existing._id, status: 'failed', fingerprint, userId },
        { $set: { status: 'processing', lockToken: currentLockToken, updatedAt: new Date() } },
        { returnDocument: 'after' }
      );
      if (!acquired) {
        return { status: 'conflict', statusCode: 409, message: 'Yêu cầu đang được thử lại bởi tiến trình khác.' };
      }
      return { status: 'acquired', doc: acquired, lockToken: currentLockToken };
    }
    if (existing.status === 'processing') {
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      if (existing.updatedAt > twoMinutesAgo) {
        return { status: 'conflict', statusCode: 409, message: 'Yêu cầu đang được xử lý. Vui lòng không gửi lặp lại.' };
      }
      // Tiếp quản yêu cầu treo quá 2 phút
      const acquired = await ImportIdempotency.findOneAndUpdate(
        { _id: existing._id, status: 'processing', updatedAt: existing.updatedAt },
        { $set: { status: 'processing', lockToken: currentLockToken, updatedAt: new Date() } },
        { returnDocument: 'after' }
      );
      if (!acquired) {
        return { status: 'conflict', statusCode: 409, message: 'Yêu cầu đang được tiếp quản bởi tiến trình khác.' };
      }
      return { status: 'acquired', doc: acquired, lockToken: currentLockToken };
    }

    throw dupErr;
  }
};

// ==========================================
// A. CÁC HÀM XUẤT EXCEL (EXPORTS)
// ==========================================

const sendWorkbookResponse = async (res, workbook, filename) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  await workbook.xlsx.write(res);
  res.end();
};

const exportFeeSchedules = async (req, res) => {
  try {
    const my = parseMonthYearFilter(req.query);
    const period = my ? my.period : '';
    const query = period ? { period } : {};
    const schedules = await FeeSchedule.find(query)
      .sort({ period: -1, classroomName: 1 })
      .limit(10001)
      .lean();

    if (schedules.length > 10000) {
      return res.status(422).json({ success: false, message: 'Dữ liệu vượt quá giới hạn 10.000 bản ghi/lần xuất. Vui lòng thu hẹp bộ lọc.' });
    }

    const workbook = exportService.buildFeeSchedulesWorkbook(schedules, period);
    const filename = `MucThuHocPhi_${period || 'TatCa'}_${Date.now()}.xlsx`;
    await sendWorkbookResponse(res, workbook, filename);
  } catch (err) {
    console.error('Lỗi xuất Excel mức thu:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Không thể xuất Excel mức thu.' });
  }
};

const exportInvoices = async (req, res) => {
  try {
    const { classroomId, status, search } = req.query;
    const filter = {};
    const my = parseMonthYearFilter(req.query);
    if (my) {
      filter.period = my.period;
    }
    if (classroomId) {
      if (!mongoose.isValidObjectId(classroomId)) {
        throw httpError('Mã lớp học (classroomId) không hợp lệ.', 400);
      }
      filter.classroomId = classroomId;
    }
    if (status) {
      const validStatuses = ['unpaid', 'partial', 'paid', 'cancelled'];
      if (!validStatuses.includes(status)) {
        throw httpError(`Trạng thái "${status}" không hợp lệ.`, 400);
      }
      filter.status = status;
    }
    if (search && String(search).trim()) {
      const escaped = escapeRegExp(String(search).trim());
      filter.studentName = { $regex: escaped, $options: 'i' };
    }

    let className = 'Tất cả';
    if (classroomId) {
      const cls = await Classroom.findById(classroomId).select('name').lean();
      if (cls) className = cls.name;
    }

    const invoices = await TuitionFee.find(filter)
      .populate('studentId', 'studentCode')
      .sort({ period: -1, className: 1, studentName: 1 })
      .limit(10001)
      .lean();

    if (invoices.length > 10000) {
      return res.status(422).json({ success: false, message: 'Dữ liệu vượt quá giới hạn 10.000 bản ghi/lần xuất. Vui lòng thu hẹp bộ lọc.' });
    }

    const workbook = exportService.buildInvoicesWorkbook(invoices, { period: filter.period, className, status });
    const filename = `HoaDonHocPhi_${filter.period || 'TatCa'}_${Date.now()}.xlsx`;
    await sendWorkbookResponse(res, workbook, filename);
  } catch (err) {
    console.error('Lỗi xuất Excel hóa đơn:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Không thể xuất Excel hóa đơn học phí.' });
  }
};

const exportDebts = async (req, res) => {
  try {
    const { classroomId, overdueOnly } = req.query;
    const filter = {
      status: { $in: ['unpaid', 'partial'] }
    };
    const my = parseMonthYearFilter(req.query);
    if (my) {
      filter.period = my.period;
    }
    if (classroomId) {
      if (!mongoose.isValidObjectId(classroomId)) {
        throw httpError('Mã lớp học (classroomId) không hợp lệ.', 400);
      }
      filter.classroomId = classroomId;
    }

    let className = 'Tất cả lớp';
    if (classroomId) {
      const cls = await Classroom.findById(classroomId).select('name').lean();
      if (cls) className = cls.name;
    }

    const invoices = await TuitionFee.find(filter)
      .populate('studentId', 'studentCode')
      .sort({ dueDate: 1, studentName: 1 })
      .limit(10001)
      .lean();

    if (invoices.length > 10000) {
      return res.status(422).json({ success: false, message: 'Dữ liệu vượt quá giới hạn 10.000 bản ghi/lần xuất. Vui lòng thu hẹp bộ lọc.' });
    }

    const now = new Date();
    const debts = invoices.map(item => {
      const remainingAmount = Math.max(0, Number(item.totalAmount || 0) - Number(item.paidAmount || 0));
      const overdue = new Date(item.dueDate) < now;
      return {
        ...item,
        studentCode: item.studentId?.studentCode || '',
        remainingAmount,
        overdue
      };
    }).filter(d => overdueOnly === 'true' ? d.overdue : true);

    const workbook = exportService.buildDebtsWorkbook(debts, { period: filter.period, className });
    const filename = `CongNoHocPhi_${filter.period || 'TatCa'}_${Date.now()}.xlsx`;
    await sendWorkbookResponse(res, workbook, filename);
  } catch (err) {
    console.error('Lỗi xuất Excel công nợ:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Không thể xuất Excel công nợ.' });
  }
};

const exportPayments = async (req, res) => {
  try {
    const { invoiceId, startDate, endDate } = req.query;
    const filter = {};
    if (invoiceId) {
      if (!mongoose.isValidObjectId(invoiceId)) {
        throw httpError('Mã hóa đơn (invoiceId) không hợp lệ.', 400);
      }
      filter.invoiceId = invoiceId;
    }
    if (startDate) {
      if (!isValidWorkDate(startDate)) {
        throw httpError('Ngày bắt đầu (startDate) không hợp lệ (định dạng YYYY-MM-DD).', 400);
      }
    }
    if (endDate) {
      if (!isValidWorkDate(endDate)) {
        throw httpError('Ngày kết thúc (endDate) không hợp lệ (định dạng YYYY-MM-DD).', 400);
      }
    }
    if (startDate && endDate && startDate > endDate) {
      throw httpError('Khoảng ngày không hợp lệ: ngày bắt đầu lớn hơn ngày kết thúc.', 400);
    }
    if (startDate || endDate) {
      filter.paidAt = {};
      if (startDate) filter.paidAt.$gte = startOfWorkDate(startDate);
      if (endDate) filter.paidAt.$lt = startOfWorkDate(addWorkDays(endDate, 1));
    }

    const payments = await Payment.find(filter)
      .sort({ paidAt: -1 })
      .limit(10001)
      .lean();

    if (payments.length > 10000) {
      return res.status(422).json({ success: false, message: 'Dữ liệu vượt quá giới hạn 10.000 bản ghi/lần xuất. Vui lòng thu hẹp khoảng ngày.' });
    }

    const label = invoiceId ? 'Hóa đơn đã chọn' : (startDate && endDate ? `${startDate} đến ${endDate}` : 'Tất cả');
    const workbook = exportService.buildPaymentsWorkbook(payments, label);
    const filename = `LichSuThuTien_BienLai_${Date.now()}.xlsx`;
    await sendWorkbookResponse(res, workbook, filename);
  } catch (err) {
    console.error('Lỗi xuất Excel biên lai thu tiền:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Không thể xuất Excel biên lai thu tiền.' });
  }
};

const exportPurchaseExpenses = async (req, res) => {
  try {
    const filter = {};
    const my = parseMonthYearFilter(req.query);
    if (my) {
      const startMonthDate = `${my.year}-${String(my.month).padStart(2, '0')}-01`;
      let nextYear = my.year;
      let nextMonth = my.month + 1;
      if (nextMonth > 12) {
        nextMonth = 1;
        nextYear += 1;
      }
      const nextMonthDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
      filter.paidAt = { $gte: startOfWorkDate(startMonthDate), $lt: startOfWorkDate(nextMonthDate) };
    }

    const expenses = await PurchaseExpense.find(filter)
      .sort({ paidAt: -1 })
      .limit(10001)
      .lean();

    if (expenses.length > 10000) {
      return res.status(422).json({ success: false, message: 'Dữ liệu vượt quá giới hạn 10.000 bản ghi/lần xuất. Vui lòng thu hẹp bộ lọc.' });
    }

    const periodLabel = my ? `Kỳ ${my.period}` : 'Tất cả';
    const workbook = exportService.buildPurchaseExpensesWorkbook(expenses, periodLabel);
    const filename = `SoChiMuaSam_${my ? my.period : 'TatCa'}_${Date.now()}.xlsx`;
    await sendWorkbookResponse(res, workbook, filename);
  } catch (err) {
    console.error('Lỗi xuất Excel sổ chi mua sắm:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Không thể xuất Excel sổ chi mua sắm.' });
  }
};

const exportOperatingExpenses = async (req, res) => {
  try {
    const filter = {};
    if (req.query.category) {
      const validCategories = ['utilities', 'rent', 'maintenance', 'services', 'other'];
      if (!validCategories.includes(req.query.category)) {
        throw httpError(`Danh mục chi "${req.query.category}" không hợp lệ.`, 400);
      }
      filter.category = req.query.category;
    }
    const my = parseMonthYearFilter(req.query);
    if (my) {
      const startMonthDate = `${my.year}-${String(my.month).padStart(2, '0')}-01`;
      let nextYear = my.year;
      let nextMonth = my.month + 1;
      if (nextMonth > 12) {
        nextMonth = 1;
        nextYear += 1;
      }
      const nextMonthDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
      filter.paidAt = { $gte: startOfWorkDate(startMonthDate), $lt: startOfWorkDate(nextMonthDate) };
    }

    const expenses = await OperatingExpense.find(filter)
      .populate('approvalRequestId', 'reviewedByName requestKey')
      .sort({ paidAt: -1 })
      .limit(10001)
      .lean();

    if (expenses.length > 10000) {
      return res.status(422).json({ success: false, message: 'Dữ liệu vượt quá giới hạn 10.000 bản ghi/lần xuất. Vui lòng thu hẹp bộ lọc.' });
    }

    const periodLabel = my ? `Kỳ ${my.period}` : 'Tất cả';
    const workbook = exportService.buildOperatingExpensesWorkbook(expenses, periodLabel);
    const filename = `ChiVanHanh_${my ? my.period : 'TatCa'}_${Date.now()}.xlsx`;
    await sendWorkbookResponse(res, workbook, filename);
  } catch (err) {
    console.error('Lỗi xuất Excel chi vận hành:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Không thể xuất Excel chi vận hành.' });
  }
};

const exportCashbook = async (req, res) => {
  try {
    let from = req.query.from ? String(req.query.from).trim() : '';
    let to = req.query.to ? String(req.query.to).trim() : '';

    if (from && !isValidWorkDate(from)) {
      throw httpError('Ngày bắt đầu (from) không hợp lệ (định dạng YYYY-MM-DD).', 400);
    }
    if (to && !isValidWorkDate(to)) {
      throw httpError('Ngày kết thúc (to) không hợp lệ (định dạng YYYY-MM-DD).', 400);
    }
    if (from && to && from > to) {
      throw httpError('Khoảng ngày không hợp lệ: ngày bắt đầu lớn hơn ngày kết thúc.', 400);
    }

    if (!from || !to) {
      const my = parseMonthYearFilter(req.query);
      if (my) {
        from = `${my.year}-${String(my.month).padStart(2, '0')}-01`;
        const lastDay = new Date(Date.UTC(my.year, my.month, 0)).getUTCDate();
        to = `${my.year}-${String(my.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      } else {
        const today = getWorkDate();
        from = from || today;
        to = to || from;
      }
    }

    const cashbookData = await getCashbookData({ from, to });
    const periodLabel = `${from} đến ${to}`;
    const workbook = exportService.buildCashbookWorkbook(cashbookData, periodLabel);
    const filename = `SoQuyDoiSoat_${from}_${to}_${Date.now()}.xlsx`;
    await sendWorkbookResponse(res, workbook, filename);
  } catch (err) {
    console.error('Lỗi xuất Excel sổ quỹ:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Không thể xuất Excel sổ quỹ.' });
  }
};

const exportPayroll = async (req, res) => {
  try {
    let month = null;
    let year = null;

    if (req.query.period) {
      const my = parseMonthYearFilter(req.query);
      if (my) {
        month = my.month;
        year = my.year;
        if (req.query.year !== undefined) {
          const yNum = Number(req.query.year);
          if (yNum !== year) {
            throw httpError(`Năm lương (${req.query.year}) mâu thuẫn với kỳ đã chọn (${my.period}).`, 400);
          }
        }
      }
    } else if (typeof req.query.month === 'string' && req.query.month.includes('-')) {
      const my = parseMonthYearFilter({ month: req.query.month });
      if (my) {
        month = my.month;
        year = my.year;
        if (req.query.year !== undefined) {
          const yNum = Number(req.query.year);
          if (yNum !== year) {
            throw httpError(`Năm lương (${req.query.year}) mâu thuẫn với tháng đã chọn (${my.yyyymm}).`, 400);
          }
        }
      }
    } else {
      if (req.query.month !== undefined && req.query.month !== '') {
        if (Array.isArray(req.query.month) || (typeof req.query.month === 'object' && req.query.month !== null)) {
          throw httpError('Tháng lương không hợp lệ (không chấp nhận kiểu mảng hoặc đối tượng).', 400);
        }
        const mNum = Number(req.query.month);
        if (!Number.isInteger(mNum) || mNum < 1 || mNum > 12) {
          throw httpError('Tháng lương không hợp lệ (1-12).', 400);
        }
        month = mNum;
      } else {
        month = new Date().getMonth() + 1;
      }

      if (req.query.year !== undefined && req.query.year !== '') {
        if (Array.isArray(req.query.year) || (typeof req.query.year === 'object' && req.query.year !== null)) {
          throw httpError('Năm lương không hợp lệ (không chấp nhận kiểu mảng hoặc đối tượng).', 400);
        }
        const yNum = Number(req.query.year);
        if (!Number.isInteger(yNum) || yNum < 2000 || yNum > 2100) {
          throw httpError('Năm lương không hợp lệ (2000-2100).', 400);
        }
        year = yNum;
      } else {
        year = new Date().getFullYear();
      }
    }

    const payrolls = await Payroll.find({ month, year })
      .populate('employeeId', 'employeeCode fullName position')
      .sort({ 'employeeId.fullName': 1 })
      .limit(10001)
      .lean();

    if (payrolls.length > 10000) {
      return res.status(422).json({ success: false, message: 'Dữ liệu vượt quá giới hạn 10.000 bản ghi/lần xuất.' });
    }

    const workbook = exportService.buildPayrollWorkbook(payrolls, { month, year });
    const filename = `BangLuong_${month}_${year}_${Date.now()}.xlsx`;
    await sendWorkbookResponse(res, workbook, filename);
  } catch (err) {
    console.error('Lỗi xuất Excel bảng lương:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Không thể xuất Excel bảng lương.' });
  }
};

const exportAccountingReport = async (req, res) => {
  try {
    const my = parseMonthYearFilter(req.query);
    const month = my ? my.yyyymm : String(req.query.month || getWorkDate().slice(0, 7)).trim();

    const monthPattern = /^(20\d{2})-(0[1-9]|1[0-2])$/;
    if (!monthPattern.test(month)) {
      return res.status(400).json({ success: false, message: 'Tháng báo cáo phải có dạng YYYY-MM (ví dụ: 2026-10)' });
    }

    const reportPayload = await buildAccountingReport(month);
    const workbook = exportService.buildAccountingReportWorkbook(reportPayload, month);
    const filename = `BaoCaoKeToan_${month}_${Date.now()}.xlsx`;
    await sendWorkbookResponse(res, workbook, filename);
  } catch (err) {
    console.error('Lỗi xuất Excel báo cáo kế toán:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Không thể xuất Excel báo cáo kế toán.' });
  }
};

// ==========================================
// B. CÁC HÀM NHẬP EXCEL (IMPORTS)
// ==========================================

const getFeeScheduleTemplate = async (req, res) => {
  try {
    const workbook = await importService.generateFeeScheduleTemplateWorkbook();
    const filename = 'MauNhap_MucThuHocPhi.xlsx';
    await sendWorkbookResponse(res, workbook, filename);
  } catch (err) {
    console.error('Lỗi tải mẫu mức thu:', err);
    return res.status(500).json({ success: false, message: 'Không thể sinh file mẫu mức thu.' });
  }
};

const previewFeeScheduleImport = async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn tập tin Excel (.xlsx) để tải lên.' });
    }
    const { defaultPeriod } = req.body;
    const result = await importService.parseAndValidateFeeSchedules(req.file.buffer, { defaultPeriod });

    let previewToken = null;
    // Chỉ cấp previewToken khi toàn bộ lô đủ điều kiện nhập (không có dòng lỗi, không có xung đột, kỳ mở)
    if (result.canImport && result.validRows === result.totalRows && result.totalRows > 0) {
      const normalizedRows = importService.normalizeFeeSchedulePayloadStrict(result.rows, defaultPeriod);
      const fingerprint = importService.computeFinanceBatchFingerprint('fee_schedule', { period: defaultPeriod }, normalizedRows);
      previewToken = importService.createPreviewToken({
        type: 'fee_schedule',
        userId: req.user._id,
        fingerprint,
        snapshot: []
      });
    }

    return res.json({ success: true, fileName: req.file.originalname, previewToken, ...result });
  } catch (err) {
    console.error('Lỗi xem trước mức thu từ Excel:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Không thể xem trước dữ liệu mức thu.' });
  }
};

const confirmFeeScheduleImport = async (req, res) => {
  let lock = null;
  try {
    const idempotencyKey = req.headers['idempotency-key'];
    if (!idempotencyKey) {
      return res.status(400).json({ success: false, message: 'Thiếu Idempotency-Key trong header để bảo đảm chống import trùng.' });
    }

    const { rows, period, previewToken } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Danh sách mức thu cần nhập không được để trống.' });
    }

    // 1. Kiểm tra cấu trúc và chuẩn hóa payload thuần túy (In-memory, không phụ thuộc trạng thái DB hiện tại)
    const normalizedRows = importService.normalizeFeeSchedulePayloadStrict(rows, period);

    // 2. Tính mã băm Fingerprint chuẩn trên dữ liệu canonical đã chuẩn hóa
    const fingerprint = importService.computeFinanceBatchFingerprint('fee_schedule', { period }, normalizedRows);

    // 3. Khóa chống import trùng: nếu đã completed, trả về kết quả ngay lập tức mà không validate lại DB
    lock = await acquireImportLock({ idempotencyKey, fingerprint, userId: req.user._id });
    if (lock.status === 'cached') {
      return res.status(200).json(lock.response);
    }
    if (lock.status === 'conflict') {
      return res.status(lock.statusCode).json({ success: false, message: lock.message });
    }

    if (previewToken) {
      importService.verifyPreviewToken(previewToken, 'fee_schedule', req.user._id, fingerprint);
    }

    const resultPayload = await runStudentTransaction(async (session) => {
      // 4. Đối chiếu trạng thái DB (lớp học đang hoạt động) trong session
      const canonicalRows = await importService.validateFeeScheduleBatchStrict(normalizedRows, { session });

      // Khóa và kiểm tra kỳ kế toán
      const periods = [...new Set(canonicalRows.map(r => r.period))];
      for (const p of periods) {
        await lockOpenPeriod(fromPeriod(p), session);
      }

      // Concurrency guard: Re-verify & conditional write guard trên Classroom nếu áp dụng lớp cụ thể
      const uniqueClassIds = [...new Set(canonicalRows.map(r => r.classroomId ? String(r.classroomId) : null).filter(Boolean))];
      if (uniqueClassIds.length > 0) {
        const classGuard = await Classroom.updateMany(
          { _id: { $in: uniqueClassIds }, status: 'active' },
          { $inc: { __v: 1 } },
          { session }
        );
        if (classGuard.matchedCount !== uniqueClassIds.length) {
          throw httpError('Lớp học áp dụng mức thu đã bị thay đổi hoặc lưu trữ đồng thời. Toàn bộ lô đã bị hủy, vui lòng tải lại.', 409);
        }
      }

      // Kiểm tra xung đột DB trong transaction
      const existing = await FeeSchedule.find({
        period: { $in: periods }
      }).session(session).lean();

      const existingSet = new Set(existing.map(s => `${s.period}___${String(s.classroomId || '__all__')}`));
      for (const item of canonicalRows) {
        const key = `${item.period}___${String(item.classroomId || '__all__')}`;
        if (existingSet.has(key)) {
          throw httpError(`Mức thu kỳ ${item.period} cho ${item.classroomName || 'Tất cả lớp'} đã tồn tại trong hệ thống. Không thể ghi đè.`, 409);
        }
      }

      // Tạo mới các FeeSchedule từ dữ liệu canonical
      const docsToInsert = canonicalRows.map(r => ({
        period: r.period,
        classroomId: r.classroomId || null,
        classroomName: r.classroomId ? r.classroomName : '',
        tuitionBase: r.tuitionBase,
        mealFee: r.mealFee,
        busFee: r.busFee,
        extraFee: r.extraFee,
        additionalItems: r.additionalItems,
        discount: r.discount,
        dueDate: r.dueDateDate || r.dueDate,
        note: r.note,
        updatedBy: req.user._id
      }));

      const created = await FeeSchedule.insertMany(docsToInsert, { session });

      // Ghi audit log
      for (const sched of created) {
        await AuditLog.create([{
          actorId: req.user._id,
          actorUsername: req.user.username,
          actorName: actorName(req.user),
          actorRole: req.user.role,
          action: 'FEE_SCHEDULE_IMPORTED',
          targetType: 'FeeSchedule',
          targetId: sched._id,
          after: { period: sched.period, classroomName: sched.classroomName, tuitionBase: sched.tuitionBase }
        }], { session });
      }

      const responsePayload = {
        success: true,
        message: `Đã nhập thành công ${created.length} mức thu học phí mới vào hệ thống.`,
        data: created
      };

      // Cập nhật Idempotency completed cùng transaction
      const updateResult = await ImportIdempotency.updateOne(
        { _id: lock.doc._id, lockToken: lock.lockToken, status: 'processing' },
        { $set: { status: 'completed', response: responsePayload } },
        { session }
      );

      if (updateResult.matchedCount === 0) {
        throw httpError('Tiến trình xử lý đã mất quyền sở hữu độc quyền hoặc bị tiếp quản.', 409);
      }

      return responsePayload;
    });

    return res.status(201).json(resultPayload);
  } catch (err) {
    if (lock?.status === 'acquired' && lock?.doc?._id) {
      await ImportIdempotency.updateOne(
        { _id: lock.doc._id, lockToken: lock.lockToken, status: 'processing' },
        { $set: { status: 'failed' } }
      ).catch(() => {});
    }
    console.error('Lỗi xác nhận import mức thu:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Không thể nhập mức thu từ Excel.' });
  }
};

const getInvoiceTemplate = async (req, res) => {
  try {
    const workbook = await importService.generateInvoiceTemplateWorkbook();
    const filename = 'MauNhap_HoaDonHocPhi.xlsx';
    await sendWorkbookResponse(res, workbook, filename);
  } catch (err) {
    console.error('Lỗi tải mẫu hóa đơn:', err);
    return res.status(500).json({ success: false, message: 'Không thể sinh file mẫu hóa đơn.' });
  }
};

const previewInvoiceImport = async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn tập tin Excel (.xlsx) để tải lên.' });
    }
    const { defaultPeriod } = req.body;
    const result = await importService.parseAndValidateInvoices(req.file.buffer, { defaultPeriod });

    let previewToken = null;
    // Chỉ cấp previewToken khi toàn bộ lô đủ điều kiện nhập (không có dòng lỗi, không có xung đột, kỳ mở)
    if (result.canImport && result.validRows === result.totalRows && result.totalRows > 0) {
      const normalizedRows = importService.normalizeInvoicePayloadStrict(result.rows, defaultPeriod);
      const fingerprint = importService.computeFinanceBatchFingerprint('invoice', { period: defaultPeriod }, normalizedRows);
      const snapshot = (result.rows || []).map(r => ({
        studentCode: r.studentCode,
        studentId: String(r.studentId),
        classroomId: String(r.classroomId)
      }));
      previewToken = importService.createPreviewToken({
        type: 'invoice',
        userId: req.user._id,
        fingerprint,
        snapshot
      });
    }

    return res.json({ success: true, fileName: req.file.originalname, previewToken, ...result });
  } catch (err) {
    console.error('Lỗi xem trước hóa đơn từ Excel:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Không thể xem trước dữ liệu hóa đơn.' });
  }
};

const confirmInvoiceImport = async (req, res) => {
  let lock = null;
  try {
    const idempotencyKey = req.headers['idempotency-key'];
    if (!idempotencyKey) {
      return res.status(400).json({ success: false, message: 'Thiếu Idempotency-Key trong header để bảo đảm chống import trùng.' });
    }

    const { rows, period, previewToken } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Danh sách hóa đơn cần nhập không được để trống.' });
    }

    // 1. Kiểm tra cấu trúc và chuẩn hóa payload thuần túy (In-memory, không query DB)
    const normalizedRows = importService.normalizeInvoicePayloadStrict(rows, period);

    // 2. Tính mã băm Fingerprint chuẩn trên dữ liệu canonical đã chuẩn hóa
    const fingerprint = importService.computeFinanceBatchFingerprint('invoice', { period }, normalizedRows);

    // 3. Khóa chống import trùng: nếu đã completed, trả về kết quả cũ ngay lập tức mà không kiểm tra trạng thái DB
    lock = await acquireImportLock({ idempotencyKey, fingerprint, userId: req.user._id });
    if (lock.status === 'cached') {
      return res.status(200).json(lock.response);
    }
    if (lock.status === 'conflict') {
      return res.status(lock.statusCode).json({ success: false, message: lock.message });
    }

    // 4. Bắt buộc kiểm tra previewToken đối với yêu cầu mới/chưa hoàn thành
    const previewData = importService.verifyPreviewToken(previewToken, 'invoice', req.user._id, fingerprint);

    const resultPayload = await runStudentTransaction(async (session) => {
      // 5. Đối chiếu trạng thái DB (học sinh đang học, lớp đang hoạt động) và đối chiếu với snapshot xem trước
      const canonicalRows = await importService.validateInvoiceBatchStrict(normalizedRows, {
        session,
        previewSnapshot: previewData.snapshot
      });

      // Khóa và kiểm tra kỳ kế toán
      const periods = [...new Set(canonicalRows.map(r => r.period))];
      for (const p of periods) {
        await lockOpenPeriod(fromPeriod(p), session);
      }

      // Concurrency guard: Conditional write guard trên Student và Classroom trong transaction
      // a, b. Tạo danh sách studentId và classroomId duy nhất, chuẩn hóa ObjectId về chuỗi
      const uniqueStudentIds = [...new Set(canonicalRows.map(r => String(r.studentId)))];
      const uniqueClassroomIds = [...new Set(canonicalRows.map(r => String(r.classroomId)))];

      // c. Khóa conditional write guard trên tập học sinh duy nhất
      const studentGuard = await Student.updateMany(
        {
          _id: { $in: uniqueStudentIds },
          status: 'enrolled',
          classroomId: { $in: uniqueClassroomIds }
        },
        {
          $inc: { __v: 1 }
        },
        { session }
      );

      // c, f. So sánh matchedCount với số học sinh duy nhất (không phải số dòng hóa đơn)
      if (studentGuard.matchedCount !== uniqueStudentIds.length) {
        throw httpError('Thông tin học sinh hoặc lớp học đã bị thay đổi đồng thời (nghỉ học, chuyển lớp). Toàn bộ lô đã bị hủy, vui lòng xem trước lại.', 409);
      }

      // e. Khóa conditional write guard trên tập lớp học duy nhất
      const classGuard = await Classroom.updateMany(
        {
          _id: { $in: uniqueClassroomIds },
          status: 'active'
        },
        {
          $inc: { __v: 1 }
        },
        { session }
      );

      if (classGuard.matchedCount !== uniqueClassroomIds.length) {
        throw httpError('Lớp học liên quan đã bị thay đổi hoặc lưu trữ đồng thời. Toàn bộ lô đã bị hủy, vui lòng xem trước lại.', 409);
      }

      // Kiểm tra hóa đơn đã tồn tại trong DB với session
      const existingInvoices = await TuitionFee.find({
        studentId: { $in: uniqueStudentIds },
        period: { $in: periods },
        status: { $ne: 'cancelled' }
      }).session(session).select('studentId period').lean();

      const existingSet = new Set(existingInvoices.map(inv => `${String(inv.studentId)}___${inv.period}`));
      for (const item of canonicalRows) {
        const key = `${String(item.studentId)}___${item.period}`;
        if (existingSet.has(key)) {
          throw httpError(`Học sinh "${item.studentName}" (${item.studentCode}) đã có hóa đơn kỳ ${item.period} trong hệ thống. Không lập chồng hóa đơn.`, 409);
        }
      }

      // Tạo mới các TuitionFee CHƯA THU (unpaid, paidAmount = 0) từ dữ liệu canonical
      const docsToInsert = canonicalRows.map(r => ({
        studentId: r.studentId,
        studentName: r.studentName,
        classroomId: r.classroomId,
        className: r.className,
        period: r.period,
        tuitionBase: r.tuitionBase,
        mealFee: r.mealFee,
        busFee: r.busFee,
        extraFee: r.extraFee,
        additionalItems: r.additionalItems,
        discount: r.discount,
        totalAmount: r.totalAmount, // Giá trị do hệ thống tính toán bằng safeAdd/safeSubtract
        paidAmount: 0,
        status: 'unpaid',
        dueDate: r.dueDateDate || r.dueDate,
        note: r.note,
        createdBy: req.user._id
      }));

      const created = await TuitionFee.insertMany(docsToInsert, { session });

      // Ghi audit log
      for (const inv of created) {
        await AuditLog.create([{
          actorId: req.user._id,
          actorUsername: req.user.username,
          actorName: actorName(req.user),
          actorRole: req.user.role,
          action: 'TUITION_INVOICE_IMPORTED',
          targetType: 'TuitionFee',
          targetId: inv._id,
          after: {
            studentName: inv.studentName,
            period: inv.period,
            totalAmount: inv.totalAmount,
            status: 'unpaid'
          }
        }], { session });
      }

      const responsePayload = {
        success: true,
        message: `Đã nhập thành công ${created.length} hóa đơn học phí (chưa thu) kỳ ${period || 'đã chọn'}.`,
        data: created
      };

      // Lưu trạng thái Idempotency completed cùng transaction
      const updateResult = await ImportIdempotency.updateOne(
        { _id: lock.doc._id, lockToken: lock.lockToken, status: 'processing' },
        { $set: { status: 'completed', response: responsePayload } },
        { session }
      );

      if (updateResult.matchedCount === 0) {
        throw httpError('Tiến trình xử lý đã mất quyền sở hữu độc quyền hoặc bị tiếp quản.', 409);
      }

      return responsePayload;
    });

    return res.status(201).json(resultPayload);
  } catch (err) {
    if (lock?.status === 'acquired' && lock?.doc?._id) {
      await ImportIdempotency.updateOne(
        { _id: lock.doc._id, lockToken: lock.lockToken, status: 'processing' },
        { $set: { status: 'failed' } }
      ).catch(() => {});
    }
    console.error('Lỗi xác nhận import hóa đơn:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Không thể nhập hóa đơn từ Excel.' });
  }
};

module.exports = {
  exportFeeSchedules,
  exportInvoices,
  exportDebts,
  exportPayments,
  exportPurchaseExpenses,
  exportOperatingExpenses,
  exportCashbook,
  exportPayroll,
  exportAccountingReport,
  getFeeScheduleTemplate,
  previewFeeScheduleImport,
  confirmFeeScheduleImport,
  getInvoiceTemplate,
  previewInvoiceImport,
  confirmInvoiceImport,
  parseMonthYearFilter,
  acquireImportLock
};
