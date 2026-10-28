const ExcelJS = require('exceljs');
const crypto = require('crypto');
const Classroom = require('../models/zone3_school/Classroom');
const Student = require('../models/zone3_school/Student');
const FeeSchedule = require('../models/zone4_finance/FeeSchedule');
const TuitionFee = require('../models/zone4_finance/TuitionFee');
const { assertOpen, fromPeriod } = require('../services/accountingPeriodService');

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_ROWS = 500;
const PERIOD_REGEX = /^(0[1-9]|1[0-2])-(20\d{2})$/;

/**
 * Danh sách cụm từ chuẩn hóa đại diện cho "Tất cả lớp"
 * So sánh chính xác sau khi normalizeHeader, KHÔNG dùng includes
 */
const ALL_CLASSES_PHRASES = new Set([
  'tatcalopapdungchung',
  'tatcalop',
  'apdungchung',
  'toantruong',
  'all',
  'allclasses'
]);

/**
 * Chuẩn hóa chuỗi header tiếng Việt (bỏ dấu, chuyển thường, xử lý cả Đ/đ -> d)
 */
const normalizeHeader = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/[Đđ]/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
};

const {
  assertSafeVnd,
  safeAddVnd,
  safeSubtractVnd,
  safeNetVnd,
  safeSumArrayVnd
} = require('../utils/moneyHelpers');

const safeAdd = safeAddVnd;
const safeSubtract = safeSubtractVnd;

/**
 * Kiểm tra ô có chứa công thức Excel hay không
 */
const isFormulaCell = (cell) => {
  if (!cell) return false;
  if (cell.formula || cell.sharedFormula) return true;
  if (cell.type === ExcelJS.ValueType.Formula) return true;
  const val = cell.value;
  if (val && typeof val === 'object' && ('formula' in val || 'sharedFormula' in val)) {
    return true;
  }
  if (typeof val === 'string' && val.trim().startsWith('=')) {
    return true;
  }
  return false;
};

/**
 * Trích xuất chuỗi tĩnh an toàn từ cell, từ chối công thức
 */
const extractCellStaticString = (cell, colLabel = '') => {
  if (cell == null) return { text: '' };
  if (isFormulaCell(cell)) {
    return {
      text: '',
      isFormula: true,
      error: `Ô ${colLabel ? `cột "${colLabel}"` : cell.address} chứa công thức Excel. Vui lòng chuyển thành giá trị tĩnh.`
    };
  }

  const val = cell.value;
  if (val == null) return { text: '' };
  if (typeof val === 'string') return { text: val.trim() };
  if (typeof val === 'number') return { text: String(val).trim() };
  if (typeof val === 'boolean') return { text: String(val) };
  if (val instanceof Date) return { text: val.toISOString() };
  if (typeof val === 'object') {
    if (Array.isArray(val.richText)) {
      return { text: val.richText.map(t => t.text || '').join('').trim() };
    }
    if (val.text != null) {
      return { text: String(val.text).trim() };
    }
  }
  return { text: '' };
};

/**
 * Phân tích ngày tháng nghiêm ngặt:
 * - Hỗ trợ Date, serial Excel 1900/1904, chuỗi dd/MM/yyyy, YYYY-MM-DD, và ISO datetime chuẩn.
 * - Từ chối mọi chuỗi có đuôi rác như '2026-10-15Tnot-a-time', '2026-10-15 ghi-chu-rac'.
 * - Từ chối giờ > 23, phút > 59, timezone sai.
 * - Kiểm tra tính hợp lệ lịch thực tế (từ chối 31/02, 29/02 năm không nhuận, 31/04, v.v.).
 * - Từ chối đối tượng chứa nhiều trường ngày mâu thuẫn.
 * - Thống nhất trường canonical dueDate dạng 'YYYY-MM-DD'.
 */
const parseStrictDate = (cellValue, is1904OrOptions = false) => {
  const is1904 = typeof is1904OrOptions === 'boolean'
    ? is1904OrOptions
    : Boolean(is1904OrOptions && (is1904OrOptions.is1904 || is1904OrOptions.date1904));

  if (cellValue == null || cellValue === '') return { error: 'Hạn thanh toán không được để trống' };

  // Nếu là đối tượng (không phải Date)
  if (typeof cellValue === 'object' && !(cellValue instanceof Date)) {
    const candidateKeys = ['dueDate', 'dueDateIso', 'dueDateStr', 'dueDateDate', 'dueDateObj', 'text', 'value'];
    const candidates = [];
    for (const key of candidateKeys) {
      if (key in cellValue && cellValue[key] !== undefined) {
        const raw = cellValue[key];
        if (raw === null || (typeof raw === 'string' && raw.trim() === '')) {
          return { error: `Trường ngày "${key}" trong đối tượng bị để trống` };
        }
        candidates.push({ key, val: raw });
      }
    }

    if (candidates.length === 0) {
      return { error: 'Giá trị ngày không đúng định dạng' };
    }

    let firstRes = null;
    for (const cand of candidates) {
      const res = parseStrictDate(cand.val, is1904);
      if (res.error) return { error: `Trường ngày "${cand.key}" không hợp lệ: ${res.error}` };
      if (!firstRes) {
        firstRes = res;
      } else if (firstRes.dueDate !== res.dueDate) {
        return { error: `Dữ liệu ngày chứa các trường mâu thuẫn (${firstRes.dueDate} khác ${res.dueDate} ở trường "${cand.key}").` };
      }
    }
    return firstRes;
  }

  let year, month, day;

  if (cellValue instanceof Date) {
    if (Number.isNaN(cellValue.getTime())) {
      return { error: 'Giá trị Date không hợp lệ' };
    }
    year = cellValue.getUTCFullYear();
    month = cellValue.getUTCMonth() + 1;
    day = cellValue.getUTCDate();
  } else if (typeof cellValue === 'number') {
    if (!Number.isFinite(cellValue) || cellValue < 1) {
      return { error: 'Giá trị ngày serial Excel không hợp lệ' };
    }
    // Excel 1900 bug: serial 60 là 29/02/1900 không có thật
    if (!is1904 && cellValue === 60) {
      return { error: 'Ngày serial 60 (29/02/1900) không tồn tại trong lịch' };
    }
    const epochOffset = is1904 ? 24107 : (cellValue > 60 ? 25569 : 25568);
    const utcDays = Math.floor(cellValue - epochOffset);
    const d = new Date(utcDays * 86400 * 1000);
    if (Number.isNaN(d.getTime())) return { error: 'Giá trị ngày serial không hợp lệ' };
    year = d.getUTCFullYear();
    month = d.getUTCMonth() + 1;
    day = d.getUTCDate();
  } else if (typeof cellValue === 'string') {
    const trimmed = cellValue.trim();
    if (!trimmed) return { error: 'Hạn thanh toán không được để trống' };

    // Định dạng 1: dd/MM/yyyy hoặc dd-MM-yyyy (nghiêm ngặt không ký tự thừa)
    const dmyMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);

    // Định dạng 2: YYYY-MM-DD chuẩn
    const ymdMatch = trimmed.match(/^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);

    // Định dạng 3: ISO 8601 Datetime nghiêm ngặt (không chấp nhận đuôi rác hay giờ/phút/timezone sai)
    const isoMatch = trimmed.match(/^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[T\s]([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,9})?)?(?:Z|([+-])([01]\d|2[0-3]):?([0-5]\d)?)?$/);

    if (dmyMatch) {
      day = Number(dmyMatch[1]);
      month = Number(dmyMatch[2]);
      year = Number(dmyMatch[3]);
    } else if (ymdMatch) {
      year = Number(ymdMatch[1]);
      month = Number(ymdMatch[2]);
      day = Number(ymdMatch[3]);
    } else if (isoMatch) {
      year = Number(isoMatch[1]);
      month = Number(isoMatch[2]);
      day = Number(isoMatch[3]);
    } else {
      return { error: `Định dạng ngày "${trimmed}" không đúng. Vui lòng sử dụng định dạng dd/MM/yyyy hoặc YYYY-MM-DD.` };
    }
  } else {
    return { error: 'Giá trị ngày không đúng định dạng' };
  }

  // Xác thực sự tồn tại thực tế trên lịch (loại trừ 31/02, 29/02 năm không nhuận, 31/04)
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return { error: `Ngày không tồn tại trong lịch: ngày ${day} tháng ${month} năm ${year}` };
  }

  const canonicalDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const displayDate = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;

  return {
    dueDate: canonicalDate,      // Unified canonical string: "YYYY-MM-DD"
    dueDateStr: displayDate,    // Formatted for UI table: "dd/MM/yyyy"
    dateObj: d                  // UTC midnight Date object
  };
};

/**
 * Xác thực và đối chiếu độc lập các trường ngày trong dòng dữ liệu:
 * - Contract chính thức: dueDate (YYYY-MM-DD).
 * - Các trường tương thích: dueDateIso, dueDateStr, dueDateDate, dueDateObj.
 * - Phân tích độc lập mọi trường thực sự được cung cấp (key in r && r[key] !== undefined).
 * - Từ chối nếu trường được gửi nhưng rỗng hoặc sai định dạng.
 * - Chuẩn hóa tất cả về cùng canonical YYYY-MM-DD. Nếu có mâu thuẫn giữa các trường -> ném lỗi 422.
 * - Trả về { dueDate, dueDateStr, dateObj }.
 */
const validateAndReconcileRowDate = (r, rowNum = 1) => {
  if (r == null || typeof r !== 'object') {
    throw Object.assign(new Error(`Dòng ${rowNum}: Dữ liệu dòng không hợp lệ.`), { statusCode: 422 });
  }

  if (r instanceof Date) {
    const res = parseStrictDate(r);
    if (res.error) throw Object.assign(new Error(`Dòng ${rowNum}: ${res.error}`), { statusCode: 422 });
    return res;
  }

  const candidateKeys = ['dueDate', 'dueDateIso', 'dueDateStr', 'dueDateDate', 'dueDateObj'];
  const provided = [];

  for (const key of candidateKeys) {
    if (key in r && r[key] !== undefined) {
      const rawVal = r[key];
      if (rawVal === null || (typeof rawVal === 'string' && rawVal.trim() === '')) {
        throw Object.assign(
          new Error(`Dòng ${rowNum}: Trường ngày "${key}" được truyền nhưng bị để trống.`),
          { statusCode: 422 }
        );
      }
      const res = parseStrictDate(rawVal);
      if (res.error) {
        throw Object.assign(
          new Error(`Dòng ${rowNum}: Trường ngày "${key}" có giá trị "${rawVal instanceof Date ? rawVal.toISOString() : String(rawVal)}" không hợp lệ (${res.error}).`),
          { statusCode: 422 }
        );
      }
      provided.push({ key, canonical: res.dueDate, dateObj: res.dateObj, display: res.dueDateStr });
    }
  }

  if (provided.length === 0) {
    throw Object.assign(
      new Error(`Dòng ${rowNum}: Hạn thanh toán (dueDate) không được để trống.`),
      { statusCode: 422 }
    );
  }

  const first = provided[0];
  for (let i = 1; i < provided.length; i++) {
    const cur = provided[i];
    if (cur.canonical !== first.canonical) {
      throw Object.assign(
        new Error(`Dòng ${rowNum}: Các trường ngày mâu thuẫn nhau: "${first.key}" (${first.canonical}) khác "${cur.key}" (${cur.canonical}). Vui lòng đồng nhất dữ liệu ngày.`),
        { statusCode: 422 }
      );
    }
  }

  return {
    dueDate: first.canonical,
    dueDateStr: first.display,
    dateObj: first.dateObj
  };
};

const getPreviewSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || typeof secret !== 'string' || secret.trim().length < 32) {
    throw Object.assign(
      new Error('Lỗi cấu hình hệ thống: Khóa bí mật (JWT_SECRET) chưa được cấu hình hoặc có độ dài ít hơn 32 ký tự. Chức năng import tạm thời bị khóa vì lý do an toàn.'),
      { statusCode: 500 }
    );
  }
  return secret.trim();
};

/**
 * Tạo token ký phía server cho kết quả xem trước import (previewToken)
 * Gắn chặt với: type, userId, fingerprint (payload nghiệp vụ), snapshot (học sinh & lớp đối chiếu), thời hạn 15 phút.
 */
const createPreviewToken = ({ type, userId, fingerprint, snapshot = [], expiresInMs = 15 * 60 * 1000 }) => {
  const payload = {
    type,
    userId: String(userId),
    fingerprint,
    snapshot: snapshot.map(s => ({
      studentCode: String(s.studentCode || '').trim().toUpperCase(),
      studentId: String(s.studentId || ''),
      classroomId: String(s.classroomId || '')
    })),
    iat: Date.now(),
    exp: Date.now() + expiresInMs
  };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson, 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', getPreviewSecret()).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
};

/**
 * Kiểm tra và giải mã previewToken:
 * - Kiểm tra chữ ký HMAC-SHA256 chống client sửa/giả mạo
 * - Kiểm tra loại import, đúng userId sở hữu, đúng payload fingerprint
 * - Kiểm tra thời hạn hiệu lực (15 phút)
 * - Trả về payload giải mã chứa snapshot học sinh/lớp
 */
const verifyPreviewToken = (token, expectedType, userId, fingerprint) => {
  if (!token || typeof token !== 'string' || !token.trim()) {
    throw Object.assign(
      new Error('Yêu cầu nhập dữ liệu bắt buộc phải có mã xác thực xem trước (previewToken). Vui lòng tải file và xem trước lại.'),
      { statusCode: 422 }
    );
  }

  const parts = token.trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw Object.assign(
      new Error('Mã xác thực xem trước (previewToken) có định dạng không hợp lệ. Vui lòng xem trước lại.'),
      { statusCode: 422 }
    );
  }

  const [payloadB64, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', getPreviewSecret()).update(payloadB64).digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expSigBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expSigBuf.length || !crypto.timingSafeEqual(sigBuf, expSigBuf)) {
    throw Object.assign(
      new Error('Mã xác thực xem trước (previewToken) không hợp lệ hoặc đã bị chỉnh sửa. Vui lòng xem trước lại.'),
      { statusCode: 422 }
    );
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    throw Object.assign(
      new Error('Nội dung mã xác thực xem trước không thể phân tích cú pháp. Vui lòng xem trước lại.'),
      { statusCode: 422 }
    );
  }

  if (payload.type !== expectedType) {
    throw Object.assign(
      new Error(`Loại dữ liệu xác thực xem trước không khớp (yêu cầu "${expectedType}", hiện tại "${payload.type}"). Vui lòng xem trước lại.`),
      { statusCode: 422 }
    );
  }

  if (String(payload.userId) !== String(userId)) {
    throw Object.assign(
      new Error('Mã xác thực xem trước thuộc về tài khoản người dùng khác. Vui lòng tự thực hiện xem trước.'),
      { statusCode: 403 }
    );
  }

  if (payload.fingerprint !== fingerprint) {
    throw Object.assign(
      new Error('Dữ liệu nhập đã bị thay đổi so với khi xem trước (mã băm dữ liệu không khớp). Vui lòng xem trước lại.'),
      { statusCode: 422 }
    );
  }

  if (Date.now() > payload.exp) {
    throw Object.assign(
      new Error('Mã xác thực xem trước đã hết thời hạn hiệu lực (quá 15 phút). Vui lòng xem trước lại để bảo đảm số liệu mới nhất.'),
      { statusCode: 422 }
    );
  }

  return payload;
};

/**
 * Phân tích số tiền nguyên VND nghiêm ngặt
 * - Từ chối NaN, Infinity, số âm, số thập phân (ví dụ: 1.5, 1,5), chuỗi pha trộn ký tự (ví dụ: 1d2, 10000abc)
 * - Chỉ chấp nhận số nguyên an toàn hoặc chuỗi định dạng số nguyên hợp lệ (có thể kèm phân cách hàng nghìn . , space)
 * - Ô trống: nếu isRequired = false thì mặc định 0, nếu isRequired = true thì báo lỗi
 */
const parseStrictMoney = (cellValue, fieldName = 'Số tiền', isRequired = false) => {
  if (cellValue == null || cellValue === '') {
    if (isRequired) return { error: `${fieldName} không được để trống` };
    return { amount: 0 };
  }

  if (typeof cellValue === 'number') {
    if (!Number.isFinite(cellValue)) return { error: `${fieldName} không phải số hữu hạn hợp lệ` };
    if (cellValue < 0) return { error: `${fieldName} không được là số âm (hiện tại: ${cellValue})` };
    if (!Number.isInteger(cellValue)) {
      return { error: `${fieldName} phải là số nguyên VNĐ, không chấp nhận số thập phân (hiện tại: ${cellValue})` };
    }
    if (!Number.isSafeInteger(cellValue)) return { error: `${fieldName} vượt quá giới hạn số nguyên an toàn của hệ thống` };
    return { amount: cellValue };
  }

  if (typeof cellValue === 'string') {
    let trimmed = cellValue.trim();
    if (!trimmed) {
      if (isRequired) return { error: `${fieldName} không được để trống` };
      return { amount: 0 };
    }

    if (trimmed.startsWith('-')) {
      return { error: `${fieldName} không được là số âm (hiện tại: "${cellValue}")` };
    }

    // Bỏ hậu tố đơn vị tiền tệ ở cuối chuỗi nếu có (đ, ₫, vnd, vnđ)
    trimmed = trimmed.replace(/\s*(?:₫|[đĐ]|[vV][nN][dD]|[vV][nN][đĐ])$/, '').trim();
    if (!trimmed) {
      if (isRequired) return { error: `${fieldName} không được để trống` };
      return { amount: 0 };
    }

    let cleanDigits = null;
    if (/^\d+$/.test(trimmed)) {
      cleanDigits = trimmed;
    } else if (/^\d{1,3}(\.\d{3})+$/.test(trimmed)) {
      cleanDigits = trimmed.replace(/\./g, '');
    } else if (/^\d{1,3}(,\d{3})+$/.test(trimmed)) {
      cleanDigits = trimmed.replace(/,/g, '');
    } else if (/^\d{1,3}(\s\d{3})+$/.test(trimmed)) {
      cleanDigits = trimmed.replace(/\s+/g, '');
    } else {
      return { error: `${fieldName} chứa ký tự không hợp lệ, chứa chữ cái hoặc sai định dạng số ("${cellValue}")` };
    }

    const num = Number(cleanDigits);
    if (!Number.isSafeInteger(num)) {
      return { error: `${fieldName} vượt quá giới hạn số nguyên an toàn của hệ thống` };
    }
    return { amount: num };
  }

  return { error: `${fieldName} có kiểu dữ liệu không hợp lệ` };
};

/**
 * Kiểm tra tính an toàn của tệp ZIP Excel (.xlsx):
 * - Magic header PK\x03\x04
 * - Tìm EOCD (End of Central Directory)
 * - Kiểm tra Central Directory signatures (0x02014b50)
 * - Kiểm tra cdSize và cdEntries toàn vẹn
 * - Giới hạn tối đa 100 entries, tối đa 5 worksheets
 */
const assertZipSafety = (buffer) => {
  if (!buffer || buffer.length < 22) {
    throw Object.assign(new Error('Tập tin Excel không hợp lệ hoặc bị hỏng.'), { statusCode: 400 });
  }

  if (buffer.readUInt32LE(0) !== 0x04034b50) {
    throw Object.assign(new Error('Tập tin không phải định dạng Excel (.xlsx) hợp lệ.'), { statusCode: 422 });
  }

  const maxSearch = Math.min(buffer.length, 65557);
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= buffer.length - maxSearch; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw Object.assign(new Error('Cấu trúc tập tin Excel bị hỏng hoặc không đúng định dạng ZIP.'), { statusCode: 422 });
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (totalEntries > 100) {
    throw Object.assign(new Error(`Tập tin Excel chứa quá nhiều thành phần bên trong (${totalEntries} entries > 100).`), { statusCode: 422 });
  }

  if (cdOffset + cdSize > buffer.length) {
    throw Object.assign(new Error('Central Directory của tập tin Excel bị cắt cụt hoặc hỏng.'), { statusCode: 422 });
  }

  let offset = cdOffset;
  let worksheetCount = 0;
  let entryCount = 0;

  while (offset < cdOffset + cdSize) {
    if (offset + 46 > buffer.length) {
      throw Object.assign(new Error('Dữ liệu Central Directory trong tập tin Excel bị cắt cụt.'), { statusCode: 422 });
    }

    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw Object.assign(new Error('Chữ ký Central Directory của Excel không hợp lệ.'), { statusCode: 422 });
    }

    const fileNameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);

    const entryName = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLen);
    if (entryName.startsWith('xl/worksheets/sheet')) {
      worksheetCount++;
    }

    entryCount++;
    offset += 46 + fileNameLen + extraLen + commentLen;
  }

  if (offset - cdOffset !== cdSize) {
    throw Object.assign(new Error('Kích thước Central Directory của Excel không khớp với khai báo.'), { statusCode: 422 });
  }

  if (entryCount !== totalEntries) {
    throw Object.assign(new Error(`Số lượng entry (${entryCount}) không khớp với tổng khai báo (${totalEntries}) trong EOCD.`), { statusCode: 422 });
  }

  if (worksheetCount > 5) {
    throw Object.assign(new Error(`Tập tin Excel chứa ${worksheetCount} sheet, vượt quá giới hạn tối đa 5 sheet.`), { statusCode: 422 });
  }
};

/**
 * Định nghĩa danh mục cột cho Mức thu (FeeSchedule)
 */
const FEE_SCHEDULE_COLUMNS = {
  scope: { label: 'Phạm vi áp dụng (*)', required: true, aliases: ['phamviapdung', 'phamvi', 'lop', 'lophoc', 'tenlop'] },
  period: { label: 'Kỳ thu (*)', required: true, aliases: ['kythu', 'ky', 'thang'] },
  tuitionBase: { label: 'Học phí chính (*)', required: true, aliases: ['hocphichinh', 'hocphi'] },
  mealFee: { label: 'Tiền ăn', required: false, aliases: ['tienan', 'an'] },
  busFee: { label: 'Tiền xe', required: false, aliases: ['tienxe', 'xe', 'xedua'] },
  extraFee: { label: 'Khoản thu khác', required: false, aliases: ['khoanthukhac', 'thukhac', 'khac'] },
  discount: { label: 'Giảm trừ chung', required: false, aliases: ['giamtruchung', 'giamtru', 'giam'] },
  dueDate: { label: 'Hạn thanh toán (*)', required: true, aliases: ['hanthanhtoan', 'han'] },
  addItemName1: { label: 'Tên khoản thu thêm 1', required: false, aliases: ['tenkhoanthuthem1', 'khoanthuthem1', 'tenkhoan1', 'khoan1'] },
  addItemAmount1: { label: 'Số tiền khoản 1', required: false, aliases: ['sotienkhoan1', 'tienkhoan1', 'sotien1', 'tien1'] },
  addItemName2: { label: 'Tên khoản thu thêm 2', required: false, aliases: ['tenkhoanthuthem2', 'khoanthuthem2', 'tenkhoan2', 'khoan2'] },
  addItemAmount2: { label: 'Số tiền khoản 2', required: false, aliases: ['sotienkhoan2', 'tienkhoan2', 'sotien2', 'tien2'] },
  addItemName3: { label: 'Tên khoản thu thêm 3', required: false, aliases: ['tenkhoanthuthem3', 'khoanthuthem3', 'tenkhoan3', 'khoan3'] },
  addItemAmount3: { label: 'Số tiền khoản 3', required: false, aliases: ['sotienkhoan3', 'tienkhoan3', 'sotien3', 'tien3'] },
  addItemName4: { label: 'Tên khoản thu thêm 4', required: false, aliases: ['tenkhoanthuthem4', 'khoanthuthem4', 'tenkhoan4', 'khoan4'] },
  addItemAmount4: { label: 'Số tiền khoản 4', required: false, aliases: ['sotienkhoan4', 'tienkhoan4', 'sotien4', 'tien4'] },
  addItemName5: { label: 'Tên khoản thu thêm 5', required: false, aliases: ['tenkhoanthuthem5', 'khoanthuthem5', 'tenkhoan5', 'khoan5'] },
  addItemAmount5: { label: 'Số tiền khoản 5', required: false, aliases: ['sotienkhoan5', 'tienkhoan5', 'sotien5', 'tien5'] },
  note: { label: 'Ghi chú', required: false, aliases: ['ghichu', 'note'] }
};

/**
 * Định nghĩa danh mục cột cho Hóa đơn (TuitionFee)
 */
const INVOICE_COLUMNS = {
  studentCode: { label: 'Mã học sinh (*)', required: true, aliases: ['mahocsinh', 'mahs', 'masohocsinh'] },
  inputName: { label: 'Họ và tên', required: false, aliases: ['hovaten', 'hoten', 'tenhocsinh', 'hovatenhocsinh'] },
  inputClass: { label: 'Lớp', required: false, aliases: ['lop', 'tenlop', 'lophoc'] },
  period: { label: 'Kỳ thu (*)', required: true, aliases: ['kythu', 'ky', 'thang'] },
  tuitionBase: { label: 'Học phí chính (*)', required: true, aliases: ['hocphichinh', 'hocphi'] },
  mealFee: { label: 'Tiền ăn', required: false, aliases: ['tienan', 'an'] },
  busFee: { label: 'Tiền xe', required: false, aliases: ['tienxe', 'xe', 'xedua'] },
  extraFee: { label: 'Khoản thu khác', required: false, aliases: ['khoanthukhac', 'thukhac', 'khac'] },
  discount: { label: 'Giảm trừ', required: false, aliases: ['giamtru', 'giamtruchung', 'giam'] },
  dueDate: { label: 'Hạn thanh toán (*)', required: true, aliases: ['hanthanhtoan', 'han'] },
  addItemName1: { label: 'Tên khoản thu thêm 1', required: false, aliases: ['tenkhoanthuthem1', 'khoanthuthem1', 'tenkhoan1', 'khoan1'] },
  addItemAmount1: { label: 'Số tiền khoản 1', required: false, aliases: ['sotienkhoan1', 'tienkhoan1', 'sotien1', 'tien1'] },
  addItemName2: { label: 'Tên khoản thu thêm 2', required: false, aliases: ['tenkhoanthuthem2', 'khoanthuthem2', 'tenkhoan2', 'khoan2'] },
  addItemAmount2: { label: 'Số tiền khoản 2', required: false, aliases: ['sotienkhoan2', 'tienkhoan2', 'sotien2', 'tien2'] },
  addItemName3: { label: 'Tên khoản thu thêm 3', required: false, aliases: ['tenkhoanthuthem3', 'khoanthuthem3', 'tenkhoan3', 'khoan3'] },
  addItemAmount3: { label: 'Số tiền khoản 3', required: false, aliases: ['sotienkhoan3', 'tienkhoan3', 'sotien3', 'tien3'] },
  addItemName4: { label: 'Tên khoản thu thêm 4', required: false, aliases: ['tenkhoanthuthem4', 'khoanthuthem4', 'tenkhoan4', 'khoan4'] },
  addItemAmount4: { label: 'Số tiền khoản 4', required: false, aliases: ['sotienkhoan4', 'tienkhoan4', 'sotien4', 'tien4'] },
  addItemName5: { label: 'Tên khoản thu thêm 5', required: false, aliases: ['tenkhoanthuthem5', 'khoanthuthem5', 'tenkhoan5', 'khoan5'] },
  addItemAmount5: { label: 'Số tiền khoản 5', required: false, aliases: ['sotienkhoan5', 'tienkhoan5', 'sotien5', 'tien5'] },
  note: { label: 'Ghi chú', required: false, aliases: ['ghichu', 'note'] }
};

/**
 * Đối chiếu và xác thực header dòng 1:
 * - Từ chối header trùng sau chuẩn hóa
 * - Từ chối hai cột cùng ánh xạ một trường
 * - Từ chối cột lạ không xác định
 * - Kiểm tra đủ các cột bắt buộc
 */
const mapAndValidateHeaders = (headerRow, columnDefinitions) => {
  const headerMap = {};
  const seenNorms = new Map();
  const fieldToCol = new Map();

  headerRow.eachCell((cell, colNumber) => {
    const rawVal = cell.text || (cell.value ? String(cell.value) : '');
    const trimmedRaw = rawVal.trim();
    if (!trimmedRaw) return;

    const norm = normalizeHeader(trimmedRaw);
    if (seenNorms.has(norm)) {
      throw Object.assign(new Error(`Tiêu đề cột "${trimmedRaw}" ở cột ${colNumber} bị trùng lặp với cột ${seenNorms.get(norm)}.`), { statusCode: 422 });
    }
    seenNorms.set(norm, colNumber);

    let matchedFieldKey = null;
    for (const [fieldKey, def] of Object.entries(columnDefinitions)) {
      if (def.aliases.includes(norm)) {
        matchedFieldKey = fieldKey;
        break;
      }
    }

    if (!matchedFieldKey) {
      throw Object.assign(new Error(`Tập tin Excel chứa cột không được nhận diện: "${trimmedRaw}" (cột ${colNumber}). Vui lòng tải file mẫu chuẩn.`), { statusCode: 422 });
    }

    if (fieldToCol.has(matchedFieldKey)) {
      throw Object.assign(new Error(`Cột "${trimmedRaw}" (cột ${colNumber}) và cột số ${fieldToCol.get(matchedFieldKey)} cùng ánh xạ vào trường "${columnDefinitions[matchedFieldKey].label}".`), { statusCode: 422 });
    }

    fieldToCol.set(matchedFieldKey, colNumber);
    headerMap[matchedFieldKey] = colNumber;
  });

  for (const [fieldKey, def] of Object.entries(columnDefinitions)) {
    if (def.required && !headerMap[fieldKey]) {
      throw Object.assign(new Error(`Tập tin Excel thiếu cột bắt buộc: "${def.label}". Vui lòng tải file mẫu chuẩn.`), { statusCode: 422 });
    }
  }

  return headerMap;
};

/**
 * Xác thực danh sách các khoản thu thêm (additionalItems):
 * - Không cho phép tên trống có tiền, hoặc có tên thiếu tiền
 * - Kiểm tra kiểu mảng, tối đa 5 khoản, tên <= 120 ký tự, số tiền nguyên an toàn > 0
 */
const validateAdditionalItems = (items, rowNum) => {
  if (items == null) return [];
  if (!Array.isArray(items)) {
    throw Object.assign(new Error(`Dòng ${rowNum}: Danh sách khoản thu thêm (additionalItems) phải là một mảng.`), { statusCode: 422 });
  }
  if (items.length > 5) {
    throw Object.assign(new Error(`Dòng ${rowNum}: Số lượng khoản thu thêm tối đa là 5 (hiện tại: ${items.length}).`), { statusCode: 422 });
  }

  const result = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw Object.assign(new Error(`Dòng ${rowNum}: Khoản thu thêm thứ ${i + 1} phải là một đối tượng hợp lệ.`), { statusCode: 422 });
    }

    const rawName = item.name;
    const nameStr = rawName != null ? String(rawName).trim() : '';
    const rawAmount = item.amount;

    if (!nameStr && (rawAmount == null || rawAmount === '')) {
      throw Object.assign(new Error(`Dòng ${rowNum}: Khoản thu thêm thứ ${i + 1} không có nội dung.`), { statusCode: 422 });
    }
    if (!nameStr && rawAmount != null && rawAmount !== '') {
      throw Object.assign(new Error(`Dòng ${rowNum}: Khoản thu thêm thứ ${i + 1} có số tiền nhưng tên khoản thu bị để trống.`), { statusCode: 422 });
    }
    if (nameStr && (rawAmount == null || rawAmount === '')) {
      throw Object.assign(new Error(`Dòng ${rowNum}: Khoản thu thêm "${nameStr}" thiếu số tiền.`), { statusCode: 422 });
    }
    if (nameStr.length > 120) {
      throw Object.assign(new Error(`Dòng ${rowNum}: Tên khoản thu thêm "${nameStr}" vượt quá giới hạn 120 ký tự (hiện tại: ${nameStr.length} ký tự). Vui lòng rút gọn.`), { statusCode: 422 });
    }

    const amountRes = parseStrictMoney(rawAmount, `Số tiền khoản thu thêm "${nameStr}"`, true);
    if (amountRes.error) {
      throw Object.assign(new Error(`Dòng ${rowNum}: ${amountRes.error}`), { statusCode: 422 });
    }
    if (amountRes.amount <= 0) {
      throw Object.assign(new Error(`Dòng ${rowNum}: Số tiền cho khoản thu thêm "${nameStr}" phải lớn hơn 0 (hiện tại: ${amountRes.amount} đ).`), { statusCode: 422 });
    }

    result.push({ name: nameStr, amount: amountRes.amount });
  }

  return result;
};

/**
 * Sinh file Excel mẫu Mức thu (FeeSchedule)
 */
const generateFeeScheduleTemplateWorkbook = async () => {
  const classrooms = await Classroom.find({ status: 'active' }).select('name').sort({ name: 1 }).lean();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Hệ thống Quản lý Mầm Non Hoa Nắng';
  workbook.created = new Date();

  // Sheet 1: Mức thu
  const dataSheet = workbook.addWorksheet('Mức thu', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  const columns = [
    { header: 'Phạm vi áp dụng (*)', key: 'classroomName', width: 28 },
    { header: 'Kỳ thu (*)', key: 'period', width: 16 },
    { header: 'Học phí chính (*)', key: 'tuitionBase', width: 20 },
    { header: 'Tiền ăn', key: 'mealFee', width: 16 },
    { header: 'Tiền xe', key: 'busFee', width: 16 },
    { header: 'Khoản thu khác', key: 'extraFee', width: 18 },
    { header: 'Giảm trừ chung', key: 'discount', width: 16 },
    { header: 'Hạn thanh toán (*)', key: 'dueDate', width: 18 },
    { header: 'Tên khoản thu thêm 1', key: 'addItemName1', width: 24 },
    { header: 'Số tiền khoản 1', key: 'addItemAmount1', width: 18 },
    { header: 'Tên khoản thu thêm 2', key: 'addItemName2', width: 24 },
    { header: 'Số tiền khoản 2', key: 'addItemAmount2', width: 18 },
    { header: 'Ghi chú', key: 'note', width: 30 }
  ];

  dataSheet.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width }));

  const headerRow = dataSheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
    };
  });

  dataSheet.getColumn(2).numFmt = '@';
  dataSheet.getColumn(8).numFmt = '@';

  const classListFormula = classrooms.length > 0
    ? `"${['Tất cả lớp (áp dụng chung)', ...classrooms.map(c => c.name)].slice(0, 30).join(',')}"`
    : '"Tất cả lớp (áp dụng chung)"';

  for (let r = 2; r <= MAX_ROWS + 1; r++) {
    const cellA = dataSheet.getCell(`A${r}`);
    cellA.dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: [classListFormula],
      showErrorMessage: true,
      errorTitle: 'Lớp học không hợp lệ',
      error: 'Vui lòng chọn lớp học từ danh sách hoặc "Tất cả lớp (áp dụng chung)"'
    };
  }

  // Sheet 2: Hướng dẫn
  const guideSheet = workbook.addWorksheet('Hướng dẫn');
  guideSheet.columns = [
    { header: 'Tên cột', key: 'col', width: 26 },
    { header: 'Bắt buộc', key: 'req', width: 14 },
    { header: 'Quy tắc & Định dạng', key: 'rule', width: 45 },
    { header: 'Ví dụ mẫu', key: 'eg', width: 30 }
  ];
  const gHeader = guideSheet.getRow(1);
  gHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  gHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };

  const guideRows = [
    ['Phạm vi áp dụng (*)', 'Bắt buộc', 'Chọn đúng tên lớp đang hoạt động hoặc "Tất cả lớp (áp dụng chung)"', 'Lớp Mầm 1 / Tất cả lớp (áp dụng chung)'],
    ['Kỳ thu (*)', 'Bắt buộc', 'Định dạng MM-YYYY. Tháng từ 01 đến 12, năm 4 chữ số.', '10-2026'],
    ['Học phí chính (*)', 'Bắt buộc', 'Số nguyên dương không âm (VNĐ). Không nhập chữ hay ký hiệu đ/₫.', '2500000'],
    ['Tiền ăn', 'Tùy chọn', 'Số nguyên không âm (VNĐ). Để trống mặc định là 0.', '800000'],
    ['Tiền xe', 'Tùy chọn', 'Số nguyên không âm (VNĐ). Để trống mặc định là 0.', '500000'],
    ['Khoản thu khác', 'Tùy chọn', 'Số nguyên không âm (VNĐ). Để trống mặc định là 0.', '100000'],
    ['Giảm trừ chung', 'Tùy chọn', 'Số nguyên không âm. Không được lớn hơn tổng các khoản thu.', '200000'],
    ['Hạn thanh toán (*)', 'Bắt buộc', 'Định dạng ngày dd/MM/yyyy. Ngày phải có thực trên lịch.', '10/11/2026'],
    ['Tên khoản thu thêm 1', 'Tùy chọn', 'Tên khoản thu riêng (tối đa 120 ký tự). Bắt buộc điền nếu có số tiền.', 'Đồng phục mùa đông'],
    ['Số tiền khoản 1', 'Tùy chọn', 'Số tiền nguyên dương > 0 nếu có tên khoản thu thêm.', '300000'],
    ['Ghi chú', 'Tùy chọn', 'Ghi chú áp dụng cho mức thu này (tối đa 1000 ký tự).', 'Áp dụng cho học kỳ 1 năm học 2026-2027']
  ];
  guideRows.forEach(r => guideSheet.addRow(r));

  // Sheet 3: Danh mục lớp
  const catSheet = workbook.addWorksheet('Danh mục lớp');
  catSheet.addRow(['Tên lớp đang hoạt động']);
  catSheet.addRow(['Tất cả lớp (áp dụng chung)']);
  classrooms.forEach(c => catSheet.addRow([c.name]));

  return workbook;
};

/**
 * Sinh file Excel mẫu Hóa đơn học phí (TuitionFee - CHƯA THU)
 */
const generateInvoiceTemplateWorkbook = async () => {
  const students = await Student.find({ status: 'enrolled' })
    .select('studentCode fullName className')
    .sort({ className: 1, fullName: 1 })
    .limit(200)
    .lean();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Hệ thống Quản lý Mầm Non Hoa Nắng';
  workbook.created = new Date();

  // Sheet 1: Hóa đơn học phí
  const dataSheet = workbook.addWorksheet('Hóa đơn học phí', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  const columns = [
    { header: 'Mã học sinh (*)', key: 'studentCode', width: 18 },
    { header: 'Họ và tên học sinh', key: 'fullName', width: 26 },
    { header: 'Lớp học', key: 'className', width: 18 },
    { header: 'Kỳ thu (*)', key: 'period', width: 16 },
    { header: 'Học phí chính (*)', key: 'tuitionBase', width: 20 },
    { header: 'Tiền ăn', key: 'mealFee', width: 16 },
    { header: 'Tiền xe', key: 'busFee', width: 16 },
    { header: 'Khoản thu khác', key: 'extraFee', width: 18 },
    { header: 'Giảm trừ', key: 'discount', width: 16 },
    { header: 'Hạn thanh toán (*)', key: 'dueDate', width: 18 },
    { header: 'Tên khoản thu thêm 1', key: 'addItemName1', width: 24 },
    { header: 'Số tiền khoản 1', key: 'addItemAmount1', width: 18 },
    { header: 'Ghi chú', key: 'note', width: 30 }
  ];

  dataSheet.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width }));

  const headerRow = dataSheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
    };
  });

  dataSheet.getColumn(1).numFmt = '@';
  dataSheet.getColumn(4).numFmt = '@';
  dataSheet.getColumn(10).numFmt = '@';

  // Sheet 2: Hướng dẫn
  const guideSheet = workbook.addWorksheet('Hướng dẫn');
  guideSheet.columns = [
    { header: 'Tên cột', key: 'col', width: 26 },
    { header: 'Bắt buộc', key: 'req', width: 14 },
    { header: 'Quy tắc & Định dạng', key: 'rule', width: 50 },
    { header: 'Ví dụ mẫu', key: 'eg', width: 30 }
  ];
  const gHeader = guideSheet.getRow(1);
  gHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  gHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };

  const guideRows = [
    ['Mã học sinh (*)', 'Bắt buộc', 'Mã số học sinh hợp lệ đang theo học trong hệ thống.', 'HS2026-001'],
    ['Họ và tên học sinh', 'Tùy chọn', 'Đối chiếu tên học sinh để tránh nhầm mã.', 'Nguyễn Văn An'],
    ['Lớp học', 'Tùy chọn', 'Đối chiếu lớp học hiện tại của bé.', 'Lớp Mầm 1'],
    ['Kỳ thu (*)', 'Bắt buộc', 'Định dạng MM-YYYY (ví dụ: 10-2026).', '10-2026'],
    ['Học phí chính (*)', 'Bắt buộc', 'Số nguyên dương không âm (VNĐ).', '2500000'],
    ['Tiền ăn', 'Tùy chọn', 'Số nguyên không âm (VNĐ).', '800000'],
    ['Tiền xe', 'Tùy chọn', 'Số nguyên không âm (VNĐ).', '500000'],
    ['Khoản thu khác', 'Tùy chọn', 'Số nguyên không âm (VNĐ).', '100000'],
    ['Giảm trừ', 'Tùy chọn', 'Số nguyên không âm. Không được vượt quá tổng các khoản thu.', '200000'],
    ['Hạn thanh toán (*)', 'Bắt buộc', 'Định dạng ngày dd/MM/yyyy.', '15/11/2026'],
    ['Tên khoản thu thêm 1', 'Tùy chọn', 'Tên khoản thu thêm (nếu có).', 'Hội chữ thập đỏ'],
    ['Số tiền khoản 1', 'Tùy chọn', 'Số tiền tương ứng (nguyên dương > 0).', '50000'],
    ['Ghi chú', 'Tùy chọn', 'Ghi chú đính kèm hóa đơn (tối đa 1000 ký tự).', 'Hóa đơn phát hành đầu kỳ'],
    ['NGUYÊN TẮC NGHIỆP VỤ', 'LƯU Ý', '1. Hóa đơn lập từ Excel có trạng thái CHƯA THU (unpaid).\n2. Không hỗ trợ nhập cột "Đã thanh toán" hay số tiền đã thu.\n3. Không phát sinh phiếu thu hay biên lai khi import.', 'Tuân thủ quy trình']
  ];
  guideRows.forEach(r => guideSheet.addRow(r));

  // Sheet 3: Danh mục học sinh tham khảo
  const catSheet = workbook.addWorksheet('Danh mục học sinh mẫu');
  catSheet.addRow(['Mã học sinh', 'Họ và tên học sinh', 'Lớp học']);
  students.forEach(s => catSheet.addRow([s.studentCode, s.fullName, s.className]));

  return workbook;
};

/**
 * Tính mã băm Fingerprint chuẩn (SHA-256) trên cấu trúc Canonical JSON cho lô dữ liệu tài chính
 * - Ngày được chuẩn hóa đúng dạng YYYY-MM-DD
 * - Các khoản thu thêm được sắp xếp theo tên
 * - Sử dụng số nguyên an toàn
 */
const computeFinanceBatchFingerprint = (type, context, rows) => {
  const canonicalData = {
    type: String(type || ''),
    context: {
      period: String(context?.period || ''),
      classroomId: String(context?.classroomId || '')
    },
    rows: (rows || []).map((r, idx) => ({
      index: idx + 1,
      identifier: String(r.studentCode || r.classroomId || r.classroomName || ''),
      period: String(r.period || ''),
      tuitionBase: Number(r.tuitionBase || 0),
      mealFee: Number(r.mealFee || 0),
      busFee: Number(r.busFee || 0),
      extraFee: Number(r.extraFee || 0),
      discount: Number(r.discount || 0),
      dueDate: String(r.dueDate || ''),
      additionalItems: (r.additionalItems || [])
        .map(a => ({ name: String(a.name || '').trim(), amount: Number(a.amount || 0) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'vi')),
      note: String(r.note || '').trim()
    }))
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonicalData), 'utf8').digest('hex');
};

/**
 * Phân tích và kiểm tra file Excel Mức thu (FeeSchedule)
 */
const parseAndValidateFeeSchedules = async (buffer, { defaultPeriod = '' } = {}) => {
  assertZipSafety(buffer);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const is1904 = Boolean(workbook.properties && workbook.properties.date1904);

  let dataSheet = workbook.getWorksheet('Mức thu');
  if (!dataSheet) {
    dataSheet = workbook.worksheets.find(w => normalizeHeader(w.name).includes('mucthu')) || workbook.worksheets[0];
  }

  if (!dataSheet || dataSheet.rowCount <= 1) {
    throw Object.assign(new Error('Tập tin Excel không có dữ liệu mức thu để xử lý.'), { statusCode: 422 });
  }

  // Đối chiếu header cột với dictionary
  const headerRow = dataSheet.getRow(1);
  const headerMap = mapAndValidateHeaders(headerRow, FEE_SCHEDULE_COLUMNS);

  const activeClassrooms = await Classroom.find({ status: 'active' }).select('_id name').lean();
  const classroomByName = new Map();
  activeClassrooms.forEach(c => {
    classroomByName.set(normalizeHeader(c.name), c);
  });

  const parsedRows = [];
  const rowCount = dataSheet.rowCount;

  for (let r = 2; r <= rowCount; r++) {
    const row = dataSheet.getRow(r);
    let hasContent = false;
    row.eachCell(() => { hasContent = true; });
    if (!hasContent) continue;

    const rowNumber = r;
    const errors = [];

    // 1. Phạm vi áp dụng (Lớp)
    const scopeCell = row.getCell(headerMap.scope);
    const scopeRes = extractCellStaticString(scopeCell, 'Phạm vi áp dụng');
    if (scopeRes.isFormula) errors.push(scopeRes.error);
    const scopeStr = scopeRes.text;

    let classroomId = null;
    let classroomName = '';
    let scope = '';

    if (!scopeStr) {
      errors.push('Phạm vi áp dụng không được để trống. Vui lòng ghi rõ tên lớp hoặc "Tất cả lớp (áp dụng chung)".');
    } else {
      const normScope = normalizeHeader(scopeStr);
      if (ALL_CLASSES_PHRASES.has(normScope)) {
        scope = 'all';
        classroomName = 'Tất cả lớp (áp dụng chung)';
      } else {
        const match = classroomByName.get(normScope);
        if (match) {
          scope = 'classroom';
          classroomId = match._id;
          classroomName = match.name;
        } else {
          errors.push(`Không tìm thấy lớp học có tên "${scopeStr}" trong danh sách lớp đang hoạt động.`);
        }
      }
    }

    // 2. Kỳ thu
    const periodCell = row.getCell(headerMap.period);
    const periodRes = extractCellStaticString(periodCell, 'Kỳ thu');
    if (periodRes.isFormula) errors.push(periodRes.error);
    const period = periodRes.text || defaultPeriod;
    if (!period) {
      errors.push('Kỳ thu không được để trống.');
    } else if (!PERIOD_REGEX.test(period)) {
      errors.push(`Kỳ thu "${period}" không đúng định dạng MM-YYYY (ví dụ: 10-2026).`);
    }

    // 3. Học phí chính
    const tuitionCell = row.getCell(headerMap.tuitionBase);
    if (isFormulaCell(tuitionCell)) errors.push('Ô Học phí chính chứa công thức. Vui lòng chuyển thành giá trị số tĩnh.');
    const tuitionRes = parseStrictMoney(tuitionCell.value, 'Học phí chính', true);
    if (tuitionRes.error) errors.push(tuitionRes.error);
    const tuitionBase = tuitionRes.amount || 0;

    // 4. Tiền ăn
    let mealFee = 0;
    if (headerMap.mealFee) {
      const cell = row.getCell(headerMap.mealFee);
      if (isFormulaCell(cell)) errors.push('Ô Tiền ăn chứa công thức.');
      const res = parseStrictMoney(cell.value, 'Tiền ăn', false);
      if (res.error) errors.push(res.error);
      else mealFee = res.amount;
    }

    // 5. Tiền xe
    let busFee = 0;
    if (headerMap.busFee) {
      const cell = row.getCell(headerMap.busFee);
      if (isFormulaCell(cell)) errors.push('Ô Tiền xe chứa công thức.');
      const res = parseStrictMoney(cell.value, 'Tiền xe', false);
      if (res.error) errors.push(res.error);
      else busFee = res.amount;
    }

    // 6. Khoản thu khác
    let extraFee = 0;
    if (headerMap.extraFee) {
      const cell = row.getCell(headerMap.extraFee);
      if (isFormulaCell(cell)) errors.push('Ô Khoản thu khác chứa công thức.');
      const res = parseStrictMoney(cell.value, 'Khoản thu khác', false);
      if (res.error) errors.push(res.error);
      else extraFee = res.amount;
    }

    // 7. Giảm trừ
    let discount = 0;
    if (headerMap.discount) {
      const cell = row.getCell(headerMap.discount);
      if (isFormulaCell(cell)) errors.push('Ô Giảm trừ chứa công thức.');
      const res = parseStrictMoney(cell.value, 'Giảm trừ', false);
      if (res.error) errors.push(res.error);
      else discount = res.amount;
    }

    // 8. Hạn thanh toán (Canonical date YYYY-MM-DD)
    const dueCell = row.getCell(headerMap.dueDate);
    if (isFormulaCell(dueCell)) errors.push('Ô Hạn thanh toán chứa công thức.');
    const dateRes = parseStrictDate(dueCell.value, is1904);
    let dueDate = '';
    let dueDateStr = '';
    if (dateRes.error) {
      errors.push(dateRes.error);
    } else {
      dueDate = dateRes.dueDate;
      dueDateStr = dateRes.dueDateStr;
    }

    // 9. Khoản thu thêm (1 đến 5)
    const additionalItems = [];
    for (let i = 1; i <= 5; i++) {
      const nameCol = headerMap[`addItemName${i}`];
      const amountCol = headerMap[`addItemAmount${i}`];
      if (nameCol && amountCol) {
        const nameCell = row.getCell(nameCol);
        const amountCell = row.getCell(amountCol);
        if (isFormulaCell(nameCell) || isFormulaCell(amountCell)) {
          errors.push(`Khoản thu thêm thứ ${i} chứa công thức.`);
        }
        const nameRes = extractCellStaticString(nameCell, `Tên khoản thu thêm ${i}`);
        const nameStr = nameRes.text;
        const amountVal = amountCell.value;

        const hasName = Boolean(nameStr);
        const hasAmount = amountVal != null && amountVal !== '';

        if (hasName && hasAmount) {
          if (nameStr.length > 120) {
            errors.push(`Tên khoản thu thêm "${nameStr}" vượt quá giới hạn 120 ký tự.`);
          }
          const amtRes = parseStrictMoney(amountVal, `Số tiền khoản ${i}`, true);
          if (amtRes.error) {
            errors.push(amtRes.error);
          } else if (amtRes.amount <= 0) {
            errors.push(`Số tiền khoản thu thêm "${nameStr}" phải lớn hơn 0.`);
          } else {
            additionalItems.push({ name: nameStr, amount: amtRes.amount });
          }
        } else if (hasName && !hasAmount) {
          errors.push(`Khoản thu thêm thứ ${i} ("${nameStr}") thiếu số tiền.`);
        } else if (!hasName && hasAmount) {
          errors.push(`Khoản thu thêm thứ ${i} có số tiền nhưng thiếu tên khoản thu.`);
        }
      }
    }

    // 10. Ghi chú
    let note = '';
    if (headerMap.note) {
      const noteCell = row.getCell(headerMap.note);
      const noteRes = extractCellStaticString(noteCell, 'Ghi chú');
      if (noteRes.isFormula) errors.push(noteRes.error);
      note = noteRes.text;
      if (note.length > 1000) {
        errors.push(`Ghi chú tối đa 1000 ký tự (hiện tại: ${note.length} ký tự). Vui lòng rút gọn.`);
      }
    }

    // 11. Tính tổng tiền bằng helper an toàn
    let estimatedTotal = 0;
    try {
      let addTotal = 0;
      for (const item of additionalItems) {
        addTotal = safeAdd(addTotal, item.amount, 'Tổng khoản thu thêm');
      }
      let subtotal = safeAdd(tuitionBase, mealFee, 'Tổng các khoản thu');
      subtotal = safeAdd(subtotal, busFee, 'Tổng các khoản thu');
      subtotal = safeAdd(subtotal, extraFee, 'Tổng các khoản thu');
      subtotal = safeAdd(subtotal, addTotal, 'Tổng các khoản thu');
      estimatedTotal = safeSubtract(subtotal, discount, 'Số tiền sau giảm trừ');
    } catch (calcErr) {
      errors.push(calcErr.message);
    }

    parsedRows.push({
      rowNumber,
      scope: scope || 'classroom',
      classroomId,
      classroomName,
      period,
      tuitionBase,
      mealFee,
      busFee,
      extraFee,
      additionalItems,
      discount,
      dueDate,       // Canonical YYYY-MM-DD
      dueDateStr,    // dd/MM/yyyy
      estimatedTotal,
      note,
      errors,
      isValid: errors.length === 0,
      isConflict: false,
      conflictReason: ''
    });
  }

  if (parsedRows.length > MAX_ROWS) {
    throw Object.assign(new Error(`Tập tin Excel chứa ${parsedRows.length} dòng dữ liệu, vượt quá giới hạn tối đa ${MAX_ROWS} dòng/lần import. Vui lòng chia nhỏ tập tin.`), { statusCode: 422 });
  }

  if (parsedRows.length === 0) {
    throw Object.assign(new Error('Tập tin Excel không có dòng dữ liệu nào để import.'), { statusCode: 422 });
  }

  // Kiểm tra trùng trong cùng file
  const fileSeen = new Map();
  for (const item of parsedRows) {
    const key = `${item.period}___${String(item.classroomId || '__all__')}`;
    if (fileSeen.has(key)) {
      item.isValid = false;
      item.errors.push(`Trùng lặp cấu hình mức thu với dòng ${fileSeen.get(key)} trong cùng file Excel (cùng kỳ ${item.period} và lớp ${item.classroomName}).`);
    } else {
      fileSeen.set(key, item.rowNumber);
    }
  }

  // Kiểm tra khóa kỳ kế toán
  let periodClosedFound = false;
  let closedPeriodName = '';
  const periodsInFile = [...new Set(parsedRows.map(r => r.period).filter(p => PERIOD_REGEX.test(p)))];
  for (const p of periodsInFile) {
    try {
      await assertOpen(fromPeriod(p));
    } catch {
      periodClosedFound = true;
      closedPeriodName = p;
      break;
    }
  }

  // Kiểm tra xung đột với dữ liệu hiện có trong DB
  const existingSchedules = await FeeSchedule.find({
    period: { $in: periodsInFile }
  }).select('period classroomId classroomName').lean();
  const existingMap = new Set(existingSchedules.map(s => `${s.period}___${String(s.classroomId || '__all__')}`));

  for (const item of parsedRows) {
    if (periodClosedFound && item.period === closedPeriodName) {
      item.isValid = false;
      item.errors.push(`Kỳ kế toán ${item.period} đã chốt sổ. Không thể thêm mới mức thu vào kỳ đã đóng.`);
    }

    const key = `${item.period}___${String(item.classroomId || '__all__')}`;
    if (existingMap.has(key)) {
      item.isConflict = true;
      item.conflictReason = `Mức thu kỳ ${item.period} cho ${item.classroomName} đã tồn tại trong hệ thống. Không thể import ghi đè.`;
      item.isValid = false;
      item.errors.push(item.conflictReason);
    }
  }

  const validRows = parsedRows.filter(r => r.isValid).length;
  const conflictRows = parsedRows.filter(r => r.isConflict).length;
  const invalidRows = parsedRows.filter(r => !r.isValid && !r.isConflict).length;

  let totalEstimatedAmount = 0;
  for (const r of parsedRows.filter(r => r.isValid)) {
    totalEstimatedAmount = safeAdd(totalEstimatedAmount, r.estimatedTotal, 'Tổng tiền dự kiến cả lô');
  }

  return {
    totalRows: parsedRows.length,
    validRows,
    conflictRows,
    invalidRows,
    canImport: validRows === parsedRows.length && !periodClosedFound,
    totalEstimatedAmount,
    rows: parsedRows
  };
};

/**
 * Phân tích và kiểm tra file Excel Hóa đơn học phí (TuitionFee - CHƯA THU)
 */
const parseAndValidateInvoices = async (buffer, { defaultPeriod = '' } = {}) => {
  assertZipSafety(buffer);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const is1904 = Boolean(workbook.properties && workbook.properties.date1904);

  let dataSheet = workbook.getWorksheet('Hóa đơn học phí');
  if (!dataSheet) {
    dataSheet = workbook.worksheets.find(w => normalizeHeader(w.name).includes('hoadon')) || workbook.worksheets[0];
  }

  if (!dataSheet || dataSheet.rowCount <= 1) {
    throw Object.assign(new Error('Tập tin Excel không có dữ liệu hóa đơn để xử lý.'), { statusCode: 422 });
  }

  const headerRow = dataSheet.getRow(1);
  const headerMap = mapAndValidateHeaders(headerRow, INVOICE_COLUMNS);

  const parsedRows = [];
  const candidateStudentCodes = new Set();
  const rowCount = dataSheet.rowCount;

  for (let r = 2; r <= rowCount; r++) {
    const row = dataSheet.getRow(r);
    let hasContent = false;
    row.eachCell(() => { hasContent = true; });
    if (!hasContent) continue;

    const rowNumber = r;
    const errors = [];

    // 1. Mã học sinh
    const codeCell = row.getCell(headerMap.studentCode);
    const codeRes = extractCellStaticString(codeCell, 'Mã học sinh');
    if (codeRes.isFormula) errors.push(codeRes.error);
    const studentCode = codeRes.text.toUpperCase();
    if (!studentCode) {
      errors.push('Mã học sinh không được để trống.');
    } else {
      candidateStudentCodes.add(studentCode);
    }

    // Họ tên và lớp đối chiếu
    let inputName = '';
    if (headerMap.inputName) {
      const nameCell = row.getCell(headerMap.inputName);
      const res = extractCellStaticString(nameCell, 'Họ và tên');
      if (res.isFormula) errors.push(res.error);
      inputName = res.text;
    }

    let inputClass = '';
    if (headerMap.inputClass) {
      const classCell = row.getCell(headerMap.inputClass);
      const res = extractCellStaticString(classCell, 'Lớp');
      if (res.isFormula) errors.push(res.error);
      inputClass = res.text;
    }

    // 2. Kỳ thu
    const periodCell = row.getCell(headerMap.period);
    const periodRes = extractCellStaticString(periodCell, 'Kỳ thu');
    if (periodRes.isFormula) errors.push(periodRes.error);
    const period = periodRes.text || defaultPeriod;
    if (!period) {
      errors.push('Kỳ thu không được để trống.');
    } else if (!PERIOD_REGEX.test(period)) {
      errors.push(`Kỳ thu "${period}" không đúng định dạng MM-YYYY (ví dụ: 10-2026).`);
    }

    // 3. Học phí chính
    const tuitionCell = row.getCell(headerMap.tuitionBase);
    if (isFormulaCell(tuitionCell)) errors.push('Ô Học phí chính chứa công thức.');
    const tuitionRes = parseStrictMoney(tuitionCell.value, 'Học phí chính', true);
    if (tuitionRes.error) errors.push(tuitionRes.error);
    const tuitionBase = tuitionRes.amount || 0;

    // 4. Tiền ăn
    let mealFee = 0;
    if (headerMap.mealFee) {
      const cell = row.getCell(headerMap.mealFee);
      if (isFormulaCell(cell)) errors.push('Ô Tiền ăn chứa công thức.');
      const res = parseStrictMoney(cell.value, 'Tiền ăn', false);
      if (res.error) errors.push(res.error);
      else mealFee = res.amount;
    }

    // 5. Tiền xe
    let busFee = 0;
    if (headerMap.busFee) {
      const cell = row.getCell(headerMap.busFee);
      if (isFormulaCell(cell)) errors.push('Ô Tiền xe chứa công thức.');
      const res = parseStrictMoney(cell.value, 'Tiền xe', false);
      if (res.error) errors.push(res.error);
      else busFee = res.amount;
    }

    // 6. Khoản thu khác
    let extraFee = 0;
    if (headerMap.extraFee) {
      const cell = row.getCell(headerMap.extraFee);
      if (isFormulaCell(cell)) errors.push('Ô Khoản thu khác chứa công thức.');
      const res = parseStrictMoney(cell.value, 'Khoản thu khác', false);
      if (res.error) errors.push(res.error);
      else extraFee = res.amount;
    }

    // 7. Giảm trừ
    let discount = 0;
    if (headerMap.discount) {
      const cell = row.getCell(headerMap.discount);
      if (isFormulaCell(cell)) errors.push('Ô Giảm trừ chứa công thức.');
      const res = parseStrictMoney(cell.value, 'Giảm trừ', false);
      if (res.error) errors.push(res.error);
      else discount = res.amount;
    }

    // 8. Hạn thanh toán (Canonical YYYY-MM-DD)
    const dueCell = row.getCell(headerMap.dueDate);
    if (isFormulaCell(dueCell)) errors.push('Ô Hạn thanh toán chứa công thức.');
    const dateRes = parseStrictDate(dueCell.value, is1904);
    let dueDate = '';
    let dueDateStr = '';
    if (dateRes.error) {
      errors.push(dateRes.error);
    } else {
      dueDate = dateRes.dueDate;
      dueDateStr = dateRes.dueDateStr;
    }

    // 9. Khoản thu thêm (1 đến 5)
    const additionalItems = [];
    for (let i = 1; i <= 5; i++) {
      const nameCol = headerMap[`addItemName${i}`];
      const amountCol = headerMap[`addItemAmount${i}`];
      if (nameCol && amountCol) {
        const nameCell = row.getCell(nameCol);
        const amountCell = row.getCell(amountCol);
        if (isFormulaCell(nameCell) || isFormulaCell(amountCell)) {
          errors.push(`Khoản thu thêm thứ ${i} chứa công thức.`);
        }
        const nameRes = extractCellStaticString(nameCell, `Tên khoản thu thêm ${i}`);
        const nameStr = nameRes.text;
        const amountVal = amountCell.value;

        const hasName = Boolean(nameStr);
        const hasAmount = amountVal != null && amountVal !== '';

        if (hasName && hasAmount) {
          if (nameStr.length > 120) {
            errors.push(`Tên khoản thu thêm "${nameStr}" vượt quá giới hạn 120 ký tự.`);
          }
          const amtRes = parseStrictMoney(amountVal, `Số tiền khoản ${i}`, true);
          if (amtRes.error) {
            errors.push(amtRes.error);
          } else if (amtRes.amount <= 0) {
            errors.push(`Số tiền khoản thu thêm "${nameStr}" phải lớn hơn 0.`);
          } else {
            additionalItems.push({ name: nameStr, amount: amtRes.amount });
          }
        } else if (hasName && !hasAmount) {
          errors.push(`Khoản thu thêm thứ ${i} ("${nameStr}") thiếu số tiền.`);
        } else if (!hasName && hasAmount) {
          errors.push(`Khoản thu thêm thứ ${i} có số tiền nhưng thiếu tên khoản thu.`);
        }
      }
    }

    // 10. Ghi chú
    let note = '';
    if (headerMap.note) {
      const noteCell = row.getCell(headerMap.note);
      const noteRes = extractCellStaticString(noteCell, 'Ghi chú');
      if (noteRes.isFormula) errors.push(noteRes.error);
      note = noteRes.text;
      if (note.length > 1000) {
        errors.push(`Ghi chú tối đa 1000 ký tự (hiện tại: ${note.length} ký tự). Vui lòng rút gọn.`);
      }
    }

    // 11. Backend tự tính tổng tiền an toàn
    let totalAmount = 0;
    try {
      let addTotal = 0;
      for (const item of additionalItems) {
        addTotal = safeAdd(addTotal, item.amount, 'Tổng khoản thu thêm');
      }
      let subtotal = safeAdd(tuitionBase, mealFee, 'Tổng các khoản thu');
      subtotal = safeAdd(subtotal, busFee, 'Tổng các khoản thu');
      subtotal = safeAdd(subtotal, extraFee, 'Tổng các khoản thu');
      subtotal = safeAdd(subtotal, addTotal, 'Tổng các khoản thu');
      totalAmount = safeSubtract(subtotal, discount, 'Tổng số tiền hóa đơn');
    } catch (calcErr) {
      errors.push(calcErr.message);
    }

    parsedRows.push({
      rowNumber,
      studentCode,
      inputName,
      inputClass,
      studentId: null,
      studentName: '',
      classroomId: null,
      className: '',
      period,
      tuitionBase,
      mealFee,
      busFee,
      extraFee,
      additionalItems,
      discount,
      totalAmount,
      paidAmount: 0,
      status: 'unpaid',
      dueDate,       // Canonical YYYY-MM-DD
      dueDateStr,    // dd/MM/yyyy
      note,
      errors,
      isValid: errors.length === 0,
      isConflict: false,
      conflictReason: ''
    });
  }

  if (parsedRows.length > MAX_ROWS) {
    throw Object.assign(new Error(`Tập tin Excel chứa ${parsedRows.length} hóa đơn, vượt quá giới hạn tối đa ${MAX_ROWS} hóa đơn/lần import. Vui lòng chia nhỏ tập tin.`), { statusCode: 422 });
  }

  if (parsedRows.length === 0) {
    throw Object.assign(new Error('Tập tin Excel không có dòng dữ liệu hóa đơn nào để import.'), { statusCode: 422 });
  }

  // Tra cứu danh sách học sinh và danh sách lớp đang hoạt động từ DB
  const [existingStudents, activeClassrooms] = await Promise.all([
    Student.find({
      studentCode: { $in: Array.from(candidateStudentCodes) }
    }).select('_id studentCode fullName classroomId className status').lean(),
    Classroom.find({ status: 'active' }).select('_id name status').lean()
  ]);

  const studentMap = new Map();
  existingStudents.forEach(s => {
    studentMap.set(s.studentCode, s);
  });
  const activeClassroomMap = new Map(activeClassrooms.map(c => [String(c._id), c]));

  // Kiểm tra trùng lặp trong cùng file
  const fileSeen = new Map();
  for (const item of parsedRows) {
    if (!item.studentCode) continue;
    const key = `${item.studentCode}___${item.period}`;
    if (fileSeen.has(key)) {
      item.isValid = false;
      item.errors.push(`Trùng lặp học sinh ${item.studentCode} với dòng ${fileSeen.get(key)} trong cùng file Excel.`);
    } else {
      fileSeen.set(key, item.rowNumber);
    }
  }

  // Đối chiếu hồ sơ học sinh và lớp học hoạt động
  for (const item of parsedRows) {
    if (!item.studentCode) continue;
    const dbStudent = studentMap.get(item.studentCode);

    if (!dbStudent) {
      item.isValid = false;
      item.errors.push(`Không tìm thấy hồ sơ học sinh có mã "${item.studentCode}" trong hệ thống.`);
      continue;
    }

    if (dbStudent.status !== 'enrolled') {
      item.isValid = false;
      item.errors.push(`Học sinh "${dbStudent.fullName}" (${item.studentCode}) đang ở trạng thái "${dbStudent.status}", không thể lập hóa đơn.`);
      continue;
    }

    if (!dbStudent.classroomId) {
      item.isValid = false;
      item.errors.push(`Học sinh "${dbStudent.fullName}" (${item.studentCode}) chưa được xếp lớp. Vui lòng xếp lớp trước khi lập hóa đơn.`);
      continue;
    }

    const studentClass = activeClassroomMap.get(String(dbStudent.classroomId));
    if (!studentClass) {
      item.isValid = false;
      item.errors.push(`Lớp học của học sinh "${dbStudent.fullName}" (${item.studentCode}) không còn hoạt động trong hệ thống.`);
      continue;
    }

    item.studentId = dbStudent._id;
    item.studentName = dbStudent.fullName;
    item.classroomId = dbStudent.classroomId;
    item.className = studentClass.name;

    if (item.inputName && item.inputName.toLowerCase() !== dbStudent.fullName.toLowerCase()) {
      item.errors.push(`Họ tên đối chiếu trong Excel ("${item.inputName}") không khớp với hồ sơ hệ thống ("${dbStudent.fullName}"). Vui lòng kiểm tra lại.`);
      item.isValid = false;
    }
  }

  // Kiểm tra kỳ đóng và hóa đơn đã tồn tại trong DB
  let periodClosedFound = false;
  let closedPeriodName = '';
  const periodsInFile = [...new Set(parsedRows.map(r => r.period).filter(p => PERIOD_REGEX.test(p)))];

  for (const p of periodsInFile) {
    try {
      await assertOpen(fromPeriod(p));
    } catch {
      periodClosedFound = true;
      closedPeriodName = p;
      break;
    }
  }

  const validStudentIds = parsedRows.map(r => r.studentId).filter(Boolean);
  const existingInvoices = await TuitionFee.find({
    studentId: { $in: validStudentIds },
    period: { $in: periodsInFile },
    status: { $ne: 'cancelled' }
  }).select('studentId period').lean();

  const existingInvoiceSet = new Set(existingInvoices.map(inv => `${String(inv.studentId)}___${inv.period}`));

  for (const item of parsedRows) {
    if (periodClosedFound && item.period === closedPeriodName) {
      item.isValid = false;
      item.errors.push(`Kỳ kế toán ${item.period} đã chốt sổ. Không thể tạo hóa đơn mới trong kỳ đã đóng.`);
    }

    if (item.studentId) {
      const key = `${String(item.studentId)}___${item.period}`;
      if (existingInvoiceSet.has(key)) {
        item.isConflict = true;
        item.conflictReason = `Học sinh "${item.studentName}" (${item.studentCode}) đã có hóa đơn kỳ ${item.period} trong hệ thống. Không lập chồng hóa đơn.`;
        item.isValid = false;
        item.errors.push(item.conflictReason);
      }
    }
  }

  const validRows = parsedRows.filter(r => r.isValid).length;
  const conflictRows = parsedRows.filter(r => r.isConflict).length;
  const invalidRows = parsedRows.filter(r => !r.isValid && !r.isConflict).length;

  let totalEstimatedAmount = 0;
  for (const r of parsedRows.filter(r => r.isValid)) {
    totalEstimatedAmount = safeAdd(totalEstimatedAmount, r.totalAmount, 'Tổng tiền dự kiến cả lô');
  }

  return {
    totalRows: parsedRows.length,
    validRows,
    conflictRows,
    invalidRows,
    canImport: validRows === parsedRows.length && !periodClosedFound,
    totalEstimatedAmount,
    rows: parsedRows
  };
};

/**
 * Kiểm tra và chuẩn hóa phạm vi áp dụng (scope) của mức thu học phí:
 * - Hợp đồng chuẩn: scope = 'all' | 'classroom'
 * - Từ chối scope='classroom' kèm isAllClasses=true
 * - Từ chối scope='all' kèm classroomId hoặc classroomName cụ thể (ví dụ: 'Small Class')
 * - Nếu có isAllClasses, bắt buộc phải là boolean thật
 * - Không cho phép bất kỳ trường hợp nào mâu thuẫn được mở rộng ngầm thành toàn trường
 */
const validateFeeScheduleScope = (r, rowNum = 1) => {
  if (r.isAllClasses !== undefined && r.isAllClasses !== null) {
    if (typeof r.isAllClasses !== 'boolean') {
      throw Object.assign(
        new Error(`Dòng ${rowNum}: Trường "isAllClasses" phải là kiểu boolean (true/false), không chấp nhận chuỗi hoặc kiểu dữ liệu khác.`),
        { statusCode: 422 }
      );
    }
  }

  let scope = r.scope;
  if (!scope) {
    if (r.isAllClasses === true) scope = 'all';
    else if (r.isAllClasses === false || r.classroomId || r.classroomName) scope = 'classroom';
    else {
      throw Object.assign(
        new Error(`Dòng ${rowNum}: Phạm vi áp dụng không được để trống. Phải là "all" hoặc "classroom".`),
        { statusCode: 422 }
      );
    }
  }

  if (scope !== 'all' && scope !== 'classroom') {
    throw Object.assign(
      new Error(`Dòng ${rowNum}: Phạm vi áp dụng "${scope}" không hợp lệ. Phải là "all" hoặc "classroom".`),
      { statusCode: 422 }
    );
  }

  if (scope === 'classroom') {
    if (r.isAllClasses === true) {
      throw Object.assign(
        new Error(`Dòng ${rowNum}: Phạm vi "classroom" mâu thuẫn với isAllClasses=true.`),
        { statusCode: 422 }
      );
    }
    const rawClassId = r.classroomId ? String(r.classroomId).trim() : '';
    const rawClassName = String(r.classroomName || '').trim();
    if (!rawClassId && !rawClassName) {
      throw Object.assign(
        new Error(`Dòng ${rowNum}: Phạm vi "classroom" bắt buộc phải có thông tin định danh lớp học (classroomId hoặc classroomName).`),
        { statusCode: 422 }
      );
    }
    if (rawClassName && ALL_CLASSES_PHRASES.has(normalizeHeader(rawClassName))) {
      throw Object.assign(
        new Error(`Dòng ${rowNum}: Tên lớp "${rawClassName}" mâu thuẫn với phạm vi lớp học cụ thể (scope="classroom").`),
        { statusCode: 422 }
      );
    }
    return { scope: 'classroom', classroomId: rawClassId || null, classroomName: rawClassName };
  }

  // scope === 'all'
  if (r.isAllClasses === false) {
    throw Object.assign(
      new Error(`Dòng ${rowNum}: Phạm vi "all" mâu thuẫn với isAllClasses=false.`),
      { statusCode: 422 }
    );
  }
  if (r.classroomId) {
    throw Object.assign(
      new Error(`Dòng ${rowNum}: Phạm vi "Tất cả lớp" (scope="all") không được kèm ID lớp học cụ thể (${r.classroomId}).`),
      { statusCode: 422 }
    );
  }
  const rawClassName = String(r.classroomName || '').trim();
  if (rawClassName) {
    const norm = normalizeHeader(rawClassName);
    if (!ALL_CLASSES_PHRASES.has(norm)) {
      throw Object.assign(
        new Error(`Dòng ${rowNum}: Phạm vi "Tất cả lớp" (scope="all") không được kèm tên lớp học cụ thể ("${rawClassName}").`),
        { statusCode: 422 }
      );
    }
  }

  return { scope: 'all', classroomId: null, classroomName: 'Tất cả lớp (áp dụng chung)' };
};

/**
 * Chuẩn hóa và kiểm tra cấu trúc payload Mức thu thuần túy (In-Memory, không query DB)
 */
const normalizeFeeSchedulePayloadStrict = (rows, defaultPeriod = '') => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw Object.assign(new Error('Danh sách mức thu cần nhập không được để trống.'), { statusCode: 400 });
  }
  if (rows.length > MAX_ROWS) {
    throw Object.assign(new Error(`Số dòng mức thu (${rows.length}) vượt quá giới hạn tối đa ${MAX_ROWS}.`), { statusCode: 422 });
  }

  const normalized = [];
  const seenBatchKeys = new Map();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = r.rowNumber || (i + 1);

    // 1. Kỳ thu
    const period = String(r.period || defaultPeriod || '').trim();
    if (!period || !PERIOD_REGEX.test(period)) {
      throw Object.assign(new Error(`Dòng ${rowNum}: Kỳ thu "${period}" không hợp lệ. Phải có định dạng MM-YYYY.`), { statusCode: 422 });
    }

    // 2. Phạm vi lớp học
    const scopeInfo = validateFeeScheduleScope(r, rowNum);

    // 3. Số tiền
    const tuitionRes = parseStrictMoney(r.tuitionBase, 'Học phí chính', true);
    if (tuitionRes.error) throw Object.assign(new Error(`Dòng ${rowNum}: ${tuitionRes.error}`), { statusCode: 422 });
    const tuitionBase = tuitionRes.amount;

    const mealRes = parseStrictMoney(r.mealFee, 'Tiền ăn', false);
    if (mealRes.error) throw Object.assign(new Error(`Dòng ${rowNum}: ${mealRes.error}`), { statusCode: 422 });
    const mealFee = mealRes.amount;

    const busRes = parseStrictMoney(r.busFee, 'Tiền xe', false);
    if (busRes.error) throw Object.assign(new Error(`Dòng ${rowNum}: ${busRes.error}`), { statusCode: 422 });
    const busFee = busRes.amount;

    const extraRes = parseStrictMoney(r.extraFee, 'Khoản thu khác', false);
    if (extraRes.error) throw Object.assign(new Error(`Dòng ${rowNum}: ${extraRes.error}`), { statusCode: 422 });
    const extraFee = extraRes.amount;

    const discountRes = parseStrictMoney(r.discount, 'Giảm trừ', false);
    if (discountRes.error) throw Object.assign(new Error(`Dòng ${rowNum}: ${discountRes.error}`), { statusCode: 422 });
    const discount = discountRes.amount;

    // Khoản thu thêm
    const additionalItems = validateAdditionalItems(r.additionalItems, rowNum);

    // Tính tổng an toàn
    let addTotal = 0;
    for (const item of additionalItems) {
      addTotal = safeAdd(addTotal, item.amount, `Dòng ${rowNum}: Tổng khoản thu thêm`);
    }
    let subtotal = safeAdd(tuitionBase, mealFee, `Dòng ${rowNum}: Tổng các khoản thu`);
    subtotal = safeAdd(subtotal, busFee, `Dòng ${rowNum}: Tổng các khoản thu`);
    subtotal = safeAdd(subtotal, extraFee, `Dòng ${rowNum}: Tổng các khoản thu`);
    subtotal = safeAdd(subtotal, addTotal, `Dòng ${rowNum}: Tổng các khoản thu`);
    const estimatedTotal = safeSubtract(subtotal, discount, `Dòng ${rowNum}: Số tiền sau giảm trừ`);

    // 4. Hạn thanh toán (đối chiếu nghiêm ngặt mọi trường ngày được cung cấp, thống nhất canonical YYYY-MM-DD)
    const dateRes = validateAndReconcileRowDate(r, rowNum);

    // 5. Ghi chú
    const rawNote = r.note != null ? String(r.note).trim() : '';
    if (rawNote.length > 1000) {
      throw Object.assign(new Error(`Dòng ${rowNum}: Ghi chú vượt quá giới hạn 1000 ký tự (hiện tại: ${rawNote.length} ký tự). Vui lòng rút gọn.`), { statusCode: 422 });
    }

    // Kiểm tra trùng trong cùng lô
    const batchKey = `${period}___${scopeInfo.scope === 'all' ? '__all__' : (scopeInfo.classroomId || normalizeHeader(scopeInfo.classroomName))}`;
    if (seenBatchKeys.has(batchKey)) {
      throw Object.assign(new Error(`Dòng ${rowNum} trùng lặp phạm vi áp dụng "${scopeInfo.classroomName || 'Tất cả lớp'}" kỳ ${period} với dòng ${seenBatchKeys.get(batchKey)} trong cùng lô.`), { statusCode: 422 });
    }
    seenBatchKeys.set(batchKey, rowNum);

    normalized.push({
      rowNumber: rowNum,
      period,
      scope: scopeInfo.scope,
      classroomId: scopeInfo.classroomId,
      classroomName: scopeInfo.classroomName,
      isAllClasses: scopeInfo.scope === 'all',
      tuitionBase,
      mealFee,
      busFee,
      extraFee,
      additionalItems,
      discount,
      estimatedTotal,
      dueDate: dateRes.dueDate, // Canonical string YYYY-MM-DD
      dueDateDate: dateRes.dateObj, // UTC Date object
      note: rawNote
    });
  }

  return normalized;
};

/**
 * Xác thực Mức thu đối chiếu với DB (Classroom đang hoạt động)
 */
const validateFeeScheduleBatchStrict = async (rows, { session } = {}) => {
  const normalizedRows = normalizeFeeSchedulePayloadStrict(rows);

  const activeClassrooms = await Classroom.find({ status: 'active' }).session(session).select('_id name').lean();
  const classroomByName = new Map();
  const classroomById = new Map();
  activeClassrooms.forEach(c => {
    classroomByName.set(normalizeHeader(c.name), c);
    classroomById.set(String(c._id), c);
  });

  const canonicalRows = [];
  for (const r of normalizedRows) {
    if (r.scope === 'all') {
      canonicalRows.push({
        ...r,
        classroomId: null,
        classroomName: 'Tất cả lớp (áp dụng chung)'
      });
    } else {
      let cls = null;
      if (r.classroomId && classroomById.has(String(r.classroomId))) {
        cls = classroomById.get(String(r.classroomId));
      } else if (r.classroomName && classroomByName.has(normalizeHeader(r.classroomName))) {
        cls = classroomByName.get(normalizeHeader(r.classroomName));
      }

      if (!cls) {
        throw Object.assign(new Error(`Dòng ${r.rowNumber}: Không tìm thấy lớp học có tên "${r.classroomName || r.classroomId}" trong danh sách lớp đang hoạt động.`), { statusCode: 422 });
      }

      canonicalRows.push({
        ...r,
        classroomId: cls._id,
        classroomName: cls.name
      });
    }
  }

  return canonicalRows;
};

/**
 * Chuẩn hóa và kiểm tra cấu trúc payload Hóa đơn thuần túy (In-Memory, không query DB)
 */
const normalizeInvoicePayloadStrict = (rows, defaultPeriod = '') => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw Object.assign(new Error('Danh sách hóa đơn cần nhập không được để trống.'), { statusCode: 400 });
  }
  if (rows.length > MAX_ROWS) {
    throw Object.assign(new Error(`Số lượng hóa đơn (${rows.length}) vượt quá giới hạn tối đa ${MAX_ROWS}.`), { statusCode: 422 });
  }

  const normalized = [];
  const seenBatchKeys = new Map();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = r.rowNumber || (i + 1);

    // 1. Mã học sinh
    const studentCode = String(r.studentCode || '').trim().toUpperCase();
    if (!studentCode) {
      throw Object.assign(new Error(`Dòng ${rowNum}: Mã học sinh không được để trống.`), { statusCode: 422 });
    }

    // 2. Kỳ thu
    const period = String(r.period || defaultPeriod || '').trim();
    if (!period || !PERIOD_REGEX.test(period)) {
      throw Object.assign(new Error(`Dòng ${rowNum}: Kỳ thu "${period}" không hợp lệ. Phải có định dạng MM-YYYY.`), { statusCode: 422 });
    }

    // 3. Số tiền
    const tuitionRes = parseStrictMoney(r.tuitionBase, 'Học phí chính', true);
    if (tuitionRes.error) throw Object.assign(new Error(`Dòng ${rowNum}: ${tuitionRes.error}`), { statusCode: 422 });
    const tuitionBase = tuitionRes.amount;

    const mealRes = parseStrictMoney(r.mealFee, 'Tiền ăn', false);
    if (mealRes.error) throw Object.assign(new Error(`Dòng ${rowNum}: ${mealRes.error}`), { statusCode: 422 });
    const mealFee = mealRes.amount;

    const busRes = parseStrictMoney(r.busFee, 'Tiền xe', false);
    if (busRes.error) throw Object.assign(new Error(`Dòng ${rowNum}: ${busRes.error}`), { statusCode: 422 });
    const busFee = busRes.amount;

    const extraRes = parseStrictMoney(r.extraFee, 'Khoản thu khác', false);
    if (extraRes.error) throw Object.assign(new Error(`Dòng ${rowNum}: ${extraRes.error}`), { statusCode: 422 });
    const extraFee = extraRes.amount;

    const discountRes = parseStrictMoney(r.discount, 'Giảm trừ', false);
    if (discountRes.error) throw Object.assign(new Error(`Dòng ${rowNum}: ${discountRes.error}`), { statusCode: 422 });
    const discount = discountRes.amount;

    // Khoản thu thêm
    const additionalItems = validateAdditionalItems(r.additionalItems, rowNum);

    // Tính tổng an toàn
    let addTotal = 0;
    for (const item of additionalItems) {
      addTotal = safeAdd(addTotal, item.amount, `Dòng ${rowNum}: Tổng khoản thu thêm`);
    }
    let subtotal = safeAdd(tuitionBase, mealFee, `Dòng ${rowNum}: Tổng các khoản thu`);
    subtotal = safeAdd(subtotal, busFee, `Dòng ${rowNum}: Tổng các khoản thu`);
    subtotal = safeAdd(subtotal, extraFee, `Dòng ${rowNum}: Tổng các khoản thu`);
    subtotal = safeAdd(subtotal, addTotal, `Dòng ${rowNum}: Tổng các khoản thu`);
    const totalAmount = safeSubtract(subtotal, discount, `Dòng ${rowNum}: Tổng số tiền hóa đơn`);

    // 4. Hạn thanh toán (đối chiếu nghiêm ngặt mọi trường ngày được cung cấp, thống nhất canonical YYYY-MM-DD)
    const dateRes = validateAndReconcileRowDate(r, rowNum);

    // 5. Ghi chú
    const rawNote = r.note != null ? String(r.note).trim() : '';
    if (rawNote.length > 1000) {
      throw Object.assign(new Error(`Dòng ${rowNum}: Ghi chú vượt quá giới hạn 1000 ký tự (hiện tại: ${rawNote.length} ký tự). Vui lòng rút gọn.`), { statusCode: 422 });
    }

    // Trùng học sinh và kỳ trong cùng lô
    const batchKey = `${studentCode}___${period}`;
    if (seenBatchKeys.has(batchKey)) {
      throw Object.assign(new Error(`Dòng ${rowNum} trùng lặp học sinh ${studentCode} kỳ ${period} với dòng ${seenBatchKeys.get(batchKey)} trong cùng lô.`), { statusCode: 422 });
    }
    seenBatchKeys.set(batchKey, rowNum);

    normalized.push({
      rowNumber: rowNum,
      studentCode,
      period,
      tuitionBase,
      mealFee,
      busFee,
      extraFee,
      additionalItems,
      discount,
      totalAmount,
      dueDate: dateRes.dueDate, // Canonical string YYYY-MM-DD
      dueDateDate: dateRes.dateObj, // UTC Date object
      dueDateStr: dateRes.dueDateStr,
      note: rawNote,
      studentId: r.studentId || null,
      studentName: r.studentName || r.inputName || '',
      classroomId: r.classroomId || null,
      className: r.className || r.inputClass || ''
    });
  }

  return normalized;
};

/**
 * Xác thực nghiêm ngặt danh sách Hóa đơn đối chiếu với trạng thái DB (Student, Classroom)
 * - Nếu có previewSnapshot: đối chiếu lớp hiện tại với lớp lúc xem trước; nếu học sinh đã chuyển lớp -> hủy và báo lỗi 422
 * - Dữ liệu chính thức khi ghi lấy từ DB
 */
const validateInvoiceBatchStrict = async (rows, { session, previewSnapshot } = {}) => {
  const normalizedRows = normalizeInvoicePayloadStrict(rows);

  const studentCodes = [...new Set(normalizedRows.map(r => r.studentCode))];
  const [dbStudents, activeClassrooms] = await Promise.all([
    Student.find({
      studentCode: { $in: studentCodes }
    }).session(session).select('_id studentCode fullName classroomId className status').lean(),
    Classroom.find({ status: 'active' }).session(session).select('_id name status').lean()
  ]);

  const studentMap = new Map();
  dbStudents.forEach(s => studentMap.set(s.studentCode, s));
  const activeClassroomMap = new Map(activeClassrooms.map(c => [String(c._id), c]));

  const snapMap = previewSnapshot && Array.isArray(previewSnapshot)
    ? new Map(previewSnapshot.map(s => [s.studentCode, s]))
    : null;

  const canonicalRows = [];

  for (const r of normalizedRows) {
    const dbStudent = studentMap.get(r.studentCode);
    if (!dbStudent) {
      throw Object.assign(new Error(`Dòng ${r.rowNumber}: Không tìm thấy học sinh có mã "${r.studentCode}" trong hệ thống.`), { statusCode: 404 });
    }
    if (dbStudent.status !== 'enrolled') {
      throw Object.assign(new Error(`Dòng ${r.rowNumber}: Học sinh "${dbStudent.fullName}" (${r.studentCode}) đang ở trạng thái "${dbStudent.status}", không thể tạo hóa đơn.`), { statusCode: 422 });
    }
    if (!dbStudent.classroomId) {
      throw Object.assign(new Error(`Dòng ${r.rowNumber}: Học sinh "${dbStudent.fullName}" (${r.studentCode}) chưa được xếp lớp. Không thể tạo hóa đơn khi chưa xếp lớp.`), { statusCode: 422 });
    }

    if (snapMap) {
      const snap = snapMap.get(r.studentCode);
      if (!snap) {
        throw Object.assign(new Error(`Dòng ${r.rowNumber}: Học sinh "${r.studentCode}" không nằm trong danh sách đối chiếu xem trước đã được xác thực. Vui lòng xem trước lại.`), { statusCode: 422 });
      }
      if (snap.studentId && String(dbStudent._id) !== String(snap.studentId)) {
        throw Object.assign(
          new Error(`Dòng ${r.rowNumber}: Hồ sơ học sinh "${dbStudent.fullName}" (${r.studentCode}) đã bị thay đổi hoặc thay thế sau khi xem trước (ID hồ sơ không khớp). Toàn bộ lô đã bị hủy, vui lòng xem trước lại.`),
          { statusCode: 422 }
        );
      }
      if (String(dbStudent.classroomId) !== String(snap.classroomId)) {
        throw Object.assign(
          new Error(`Dòng ${r.rowNumber}: Học sinh "${dbStudent.fullName}" (${r.studentCode}) đã chuyển lớp sau khi xem trước (lớp xem trước khác lớp hiện tại trong hệ thống). Toàn bộ lô đã bị hủy, vui lòng xem trước lại.`),
          { statusCode: 422 }
        );
      }
    }

    const studentClass = activeClassroomMap.get(String(dbStudent.classroomId));
    if (!studentClass) {
      throw Object.assign(new Error(`Dòng ${r.rowNumber}: Lớp học của học sinh "${dbStudent.fullName}" (${r.studentCode}) không còn hoạt động trong hệ thống.`), { statusCode: 422 });
    }

    canonicalRows.push({
      ...r,
      studentId: dbStudent._id,
      studentName: dbStudent.fullName,
      classroomId: studentClass._id,
      className: studentClass.name,
      paidAmount: 0,
      status: 'unpaid'
    });
  }

  return canonicalRows;
};

module.exports = {
  MAX_FILE_SIZE,
  MAX_ROWS,
  PERIOD_REGEX,
  ALL_CLASSES_PHRASES,
  normalizeHeader,
  safeAdd,
  safeSubtract,
  assertZipSafety,
  parseStrictMoney,
  parseStrictDate,
  validateAndReconcileRowDate,
  createPreviewToken,
  verifyPreviewToken,
  validateAdditionalItems,
  validateFeeScheduleScope,
  normalizeFeeSchedulePayloadStrict,
  normalizeInvoicePayloadStrict,
  generateFeeScheduleTemplateWorkbook,
  generateInvoiceTemplateWorkbook,
  computeFinanceBatchFingerprint,
  validateFeeScheduleBatchStrict,
  validateInvoiceBatchStrict,
  parseAndValidateFeeSchedules,
  parseAndValidateInvoices
};
