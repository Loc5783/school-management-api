const ExcelJS = require('exceljs');
const crypto = require('crypto');
const Student = require('../models/zone3_school/Student');
const Classroom = require('../models/zone3_school/Classroom');
const { getTeacherClassroomIds } = require('../services/schoolDataAccessService');

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_ROWS = 500;
const MAX_SHEETS = 5;
const MAX_COLUMNS = 20;

const EXCEL_COLUMNS = [
  { header: 'Họ và tên (*)', key: 'fullName', width: 26, required: true },
  { header: 'Ngày sinh (*)', key: 'birthDate', width: 16, required: true },
  { header: 'Giới tính (*)', key: 'gender', width: 14, required: true },
  { header: 'Địa chỉ', key: 'address', width: 32, required: false },
  { header: 'Quốc tịch', key: 'nationality', width: 18, required: false },
  { header: 'Dân tộc', key: 'ethnicity', width: 16, required: false },
  { header: 'Nơi sinh', key: 'birthPlace', width: 22, required: false },
  { header: 'Ghi chú', key: 'notes', width: 30, required: false }
];

const GENDER_MAP = {
  'nam': 'male',
  'nữ': 'female',
  'nu': 'female',
  'male': 'male',
  'female': 'female'
};

const deriveSchoolYear = (date = new Date()) => {
  const parsed = new Date(date);
  const startYear = parsed.getMonth() >= 7 ? parsed.getFullYear() : parsed.getFullYear() - 1;
  return `${startYear}-${startYear + 1}`;
};

/**
 * Tạo file Excel mẫu chuẩn (.xlsx) gồm 3 sheet:
 * 1. "Danh sách học sinh": Chứa header mẫu, định dạng cột, dropdown giới tính trên từng ô C2..C500.
 * 2. "Hướng dẫn": Hướng dẫn chi tiết định dạng, bắt buộc/tùy chọn, ví dụ.
 * 3. "Danh mục": Danh mục giới tính.
 */
const generateTemplateWorkbook = async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Hệ thống Quản lý Trường Mầm non Hoa Nắng';
  workbook.created = new Date();

  // Sheet 1: Danh sách học sinh
  const dataSheet = workbook.addWorksheet('Danh sách học sinh', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  dataSheet.columns = EXCEL_COLUMNS.map(col => ({
    header: col.header,
    key: col.key,
    width: col.width
  }));

  // Style header
  const headerRow = dataSheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
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

  // Sheet 3: Danh mục tham chiếu
  const catSheet = workbook.addWorksheet('Danh mục');
  catSheet.addRow(['Giới tính']);
  catSheet.addRow(['Nam']);
  catSheet.addRow(['Nữ']);
  catSheet.state = 'hidden';

  // Định dạng text cho cột Ngày sinh
  dataSheet.getColumn(2).numFmt = '@';

  // Bắt buộc: Gán dataValidation trực tiếp trên từng ô của cột C (dòng 2 đến 501, đủ 500 học sinh)
  // để Excel hiển thị dropdown thực sự khi người dùng mở file
  for (let r = 2; r <= MAX_ROWS + 1; r++) {
    const cell = dataSheet.getCell(`C${r}`);
    cell.dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"Nam,Nữ"'],
      showErrorMessage: true,
      errorTitle: 'Giới tính không hợp lệ',
      error: 'Vui lòng chọn Nam hoặc Nữ từ danh sách.'
    };
  }

  // Sheet 2: Hướng dẫn
  const guideSheet = workbook.addWorksheet('Hướng dẫn');
  guideSheet.columns = [
    { header: 'Nội dung', key: 'title', width: 28 },
    { header: 'Chi tiết hướng dẫn', key: 'detail', width: 65 }
  ];

  const guideHeader = guideSheet.getRow(1);
  guideHeader.height = 26;
  guideHeader.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  const guideData = [
    ['1. Lớp học nhận dữ liệu', 'Lớp học được chọn trực tiếp trên giao diện web trước khi import. Dữ liệu trong file này sẽ được nạp vào đúng lớp đã chọn.'],
    ['2. Các cột bắt buộc (*)', 'Họ và tên (*), Ngày sinh (*), Giới tính (*). Bắt buộc phải có đầy đủ ở mỗi dòng.'],
    ['3. Định dạng Họ và tên', 'Tối đa 120 ký tự. Hệ thống tự động chuẩn hóa khoảng trắng thừa và giữ nguyên dấu tiếng Việt.'],
    ['4. Định dạng Ngày sinh', 'Hỗ trợ định dạng dd/MM/yyyy (ví dụ: 15/08/2021) hoặc định dạng ngày tháng chuẩn của Excel. Không được ở tương lai.'],
    ['5. Định dạng Giới tính', 'Chọn "Nam" hoặc "Nữ" (hoặc chọn từ dropdown tại cột Giới tính).'],
    ['6. Không dùng công thức', 'Hệ thống từ chối các ô chứa công thức Excel. Vui lòng chuyển thành giá trị tĩnh (Paste Values).'],
    ['7. Các cột tùy chọn', 'Địa chỉ (tối đa 500 ký tự), Quốc tịch (tối đa 80 ký tự, mặc định "Việt Nam" nếu để trống), Dân tộc (tối đa 80 ký tự), Nơi sinh (tối đa 120 ký tự), Ghi chú (tối đa 2000 ký tự).'],
    ['8. Giới hạn import', 'Tối đa 500 học sinh/lần import. File không vượt quá 5 MB.'],
    ['9. Chính sách import', 'Nguyên khối (All or Nothing): nếu có bất kỳ dòng nào bị lỗi, vượt sĩ số hoặc nghi trùng thông tin, hệ thống sẽ yêu cầu sửa trước khi xác nhận lưu.'],
    ['---', '---'],
    ['Ví dụ mẫu dòng 1', 'Họ tên: Nguyễn Văn An | Ngày sinh: 12/03/2021 | Giới tính: Nam | Địa chỉ: 123 Cầu Giấy, Hà Nội'],
    ['Ví dụ mẫu dòng 2', 'Họ tên: Trần Thị Mai | Ngày sinh: 20/09/2022 | Giới tính: Nữ | Nơi sinh: Hà Nội']
  ];

  guideData.forEach(row => guideSheet.addRow(row));
  guideSheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.alignment = { vertical: 'top', wrapText: true };
    }
  });

  return workbook;
};

/**
 * Kiểm tra xem một cell có chứa công thức hay không (phải từ chối ô công thức)
 */
const isFormulaCell = (cell) => {
  if (!cell) return false;
  if (cell.type === ExcelJS.ValueType.Formula) return true;
  if (cell.formula) return true;
  if (typeof cell.value === 'object' && cell.value !== null && cell.value.formula) return true;
  return false;
};

/**
 * Phân tích ngày sinh nghiêm ngặt (hỗ trợ Date, số serial Excel 1900/1904, chuỗi dd/MM/yyyy, yyyy-MM-dd)
 */
const parseBirthDate = (cellValue, is1904 = false) => {
  if (cellValue == null || cellValue === '') return { error: 'Ngày sinh không được để trống' };

  let d = null;

  if (cellValue instanceof Date && !Number.isNaN(cellValue.getTime())) {
    d = cellValue;
  } else if (typeof cellValue === 'number') {
    // Xử lý hệ ngày Excel 1904 vs 1900
    // Hệ 1900: serial 1 = 1900-01-01, 1970-01-01 = 25569
    // Hệ 1904: serial 0 = 1904-01-01, 1970-01-01 = 24107
    const epochOffset = is1904 ? 24107 : 25569;
    const utcDays = Math.floor(cellValue - epochOffset);
    const utcValue = utcDays * 86400;
    d = new Date(utcValue * 1000);
  } else if (typeof cellValue === 'string') {
    const trimmed = cellValue.trim();
    if (!trimmed) return { error: 'Ngày sinh không được để trống' };

    // Kiểm tra định dạng dd/MM/yyyy hoặc d/M/yyyy
    const dmyMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (dmyMatch) {
      const day = Number(dmyMatch[1]);
      const month = Number(dmyMatch[2]);
      const year = Number(dmyMatch[3]);
      d = new Date(Date.UTC(year, month - 1, day));
      if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
        return { error: `Ngày sinh không hợp lệ: ngày ${day} tháng ${month} năm ${year} không tồn tại` };
      }
    } else {
      // Kiểm tra định dạng yyyy-MM-dd
      const ymdMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (ymdMatch) {
        const year = Number(ymdMatch[1]);
        const month = Number(ymdMatch[2]);
        const day = Number(ymdMatch[3]);
        d = new Date(Date.UTC(year, month - 1, day));
        if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
          return { error: `Ngày sinh không hợp lệ: ngày ${day} tháng ${month} năm ${year} không tồn tại` };
        }
      } else {
        return { error: 'Định dạng ngày sinh phải là dd/MM/yyyy (ví dụ: 15/08/2021)' };
      }
    }
  } else if (typeof cellValue === 'object' && cellValue !== null) {
    if (cellValue.text) {
      return parseBirthDate(cellValue.text, is1904);
    }
    return { error: 'Giá trị ngày sinh không đúng định dạng' };
  } else {
    return { error: 'Giá trị ngày sinh không đúng định dạng' };
  }

  if (!d || Number.isNaN(d.getTime())) {
    return { error: 'Ngày sinh không hợp lệ' };
  }

  const now = new Date();
  if (d > now) {
    return { error: 'Ngày sinh không được ở tương lai' };
  }

  // Giới hạn tuổi mầm non hợp lý (0 đến 12 tuổi)
  const ageInYears = (now.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (ageInYears > 12) {
    return { error: 'Độ tuổi học sinh mầm non không hợp lệ (vượt quá 12 tuổi)' };
  }

  // Chuẩn hóa thành Date ISO string dạng YYYY-MM-DD
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dayStr = String(d.getUTCDate()).padStart(2, '0');
  return { date: `${y}-${m}-${dayStr}`, dateObj: d };
};

/**
 * Trích xuất text tĩnh an toàn từ cell, từ chối công thức
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
 * Tính toán mã băm fingerprint chuẩn (SHA-256) trên toàn bộ danh sách học sinh
 * Chuẩn hóa thành cấu trúc JSON xác định (canonical JSON) để loại bỏ hoàn toàn nguy cơ va chạm ký tự phân cách.
 */
const computeBatchFingerprint = (classroomId, rows) => {
  const canonicalData = {
    classroomId: String(classroomId || ''),
    students: (rows || []).map(r => ({
      fullName: String(r.fullName || '').replace(/\s+/g, ' ').trim().toLowerCase(),
      birthDate: String(r.birthDateStr || r.birthDate || '').trim(),
      gender: String(r.gender || '').trim().toLowerCase(),
      address: String(r.address || '').trim(),
      nationality: String(r.nationality || '').trim(),
      ethnicity: String(r.ethnicity || '').trim(),
      birthPlace: String(r.birthPlace || '').trim(),
      notes: String(r.notes || '').trim()
    }))
  };
  const jsonString = JSON.stringify(canonicalData);
  return crypto.createHash('sha256').update(jsonString, 'utf8').digest('hex');
};

/**
 * Kiểm tra tính nghiêm ngặt của 1 dòng dữ liệu (Dùng chung cho cả preview và confirm)
 * Không cho phép âm thầm cắt ngắn chuỗi (.slice()), báo lỗi nếu vượt quá độ dài quy định.
 */
const validateStudentRowStrict = (item, rowNumber, now = new Date(), is1904 = false) => {
  const errors = [];
  const fullName = String(item.fullName || item.rawFullName || '').replace(/\s+/g, ' ').trim();
  const rawGender = String(item.gender || item.rawGender || '').trim();
  const address = item.address != null ? String(item.address).trim() : (item.rawAddress != null ? String(item.rawAddress).trim() : '');
  const nationality = item.nationality != null ? String(item.nationality).trim() : (item.rawNationality != null ? String(item.rawNationality).trim() : '');
  const ethnicity = item.ethnicity != null ? String(item.ethnicity).trim() : (item.rawEthnicity != null ? String(item.rawEthnicity).trim() : '');
  const birthPlace = item.birthPlace != null ? String(item.birthPlace).trim() : (item.rawBirthPlace != null ? String(item.rawBirthPlace).trim() : '');
  const notes = item.notes != null ? String(item.notes).trim() : (item.rawNotes != null ? String(item.rawNotes).trim() : '');

  // 1. Họ và tên
  if (!fullName) {
    errors.push('Họ và tên không được để trống');
  } else if (fullName.length > 120) {
    errors.push(`Họ và tên vượt quá độ dài tối đa 120 ký tự (hiện tại: ${fullName.length} ký tự)`);
  }

  // 2. Ngày sinh
  let birthDateFormatted = '';
  let birthDateObj = null;
  const rawBirth = item.birthDate != null ? item.birthDate : item.rawBirthDate;
  const dateResult = parseBirthDate(rawBirth, is1904);
  if (dateResult.error) {
    errors.push(dateResult.error);
  } else {
    birthDateFormatted = dateResult.date;
    birthDateObj = dateResult.dateObj;
  }

  // 3. Giới tính
  let gender = '';
  if (!rawGender) {
    errors.push('Giới tính không được để trống');
  } else {
    const normalizedGender = rawGender.toLowerCase();
    gender = GENDER_MAP[normalizedGender] || '';
    if (!gender) {
      errors.push(`Giới tính "${rawGender}" không hợp lệ. Vui lòng chọn "Nam" hoặc "Nữ"`);
    }
  }

  // 4. Các trường tùy chọn (Kiểm tra nghiêm ngặt độ dài, không âm thầm cắt ngắn)
  if (address.length > 500) {
    errors.push(`Địa chỉ vượt quá độ dài tối đa 500 ký tự (hiện tại: ${address.length} ký tự)`);
  }
  if (nationality.length > 80) {
    errors.push(`Quốc tịch vượt quá độ dài tối đa 80 ký tự (hiện tại: ${nationality.length} ký tự)`);
  }
  if (ethnicity.length > 80) {
    errors.push(`Dân tộc vượt quá độ dài tối đa 80 ký tự (hiện tại: ${ethnicity.length} ký tự)`);
  }
  if (birthPlace.length > 120) {
    errors.push(`Nơi sinh vượt quá độ dài tối đa 120 ký tự (hiện tại: ${birthPlace.length} ký tự)`);
  }
  if (notes.length > 2000) {
    errors.push(`Ghi chú vượt quá độ dài tối đa 2000 ký tự (hiện tại: ${notes.length} ký tự)`);
  }

  const parsedData = {
    rowNumber,
    fullName,
    birthDate: birthDateFormatted,
    birthDateStr: birthDateFormatted,
    birthDateObj,
    gender,
    genderText: gender === 'female' ? 'Nữ' : (gender === 'male' ? 'Nam' : rawGender),
    address,
    nationality: nationality || 'Việt Nam',
    ethnicity,
    birthPlace,
    notes
  };

  return {
    ...parsedData,
    parsedData,
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Kiểm tra cấu trúc ZIP trực tiếp từ buffer trước khi giải nén:
 * - Bảo vệ chống Zip bomb (tỷ lệ nén bất thường)
 * - Giới hạn dung lượng sau giải nén (tối đa 30 MB)
 * - Giới hạn số lượng entries (tối đa 100) và số lượng worksheet (tối đa 5)
 */
const assertZipSafety = (buffer) => {
  if (!buffer || buffer.length < 22) {
    throw Object.assign(new Error('Tập tin Excel không hợp lệ hoặc bị hỏng.'), { statusCode: 400 });
  }

  // Magic header PK\x03\x04
  if (buffer.readUInt32LE(0) !== 0x04034b50) {
    throw Object.assign(new Error('Tập tin không phải định dạng Excel (.xlsx) hợp lệ.'), { statusCode: 422 });
  }

  // Tìm End of Central Directory (EOCD) trong 65KB cuối
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
    throw Object.assign(new Error(`Tập tin Excel chứa quá nhiều tệp con (${totalEntries}), vượt quá giới hạn an toàn.`), { statusCode: 422 });
  }

  if (cdOffset + cdSize > buffer.length) {
    throw Object.assign(new Error('Cấu trúc nén của tập tin Excel bị sai lệch.'), { statusCode: 422 });
  }

  let offset = cdOffset;
  let totalUncompressedSize = 0;
  let sheetCount = 0;
  const MAX_TOTAL_UNCOMPRESSED = 30 * 1024 * 1024; // 30 MB
  const MAX_ENTRY_UNCOMPRESSED = 10 * 1024 * 1024; // 10 MB

  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > buffer.length) {
      throw Object.assign(new Error(`Tập tin Excel bị hỏng: thiếu dữ liệu Central Directory tại mục thứ ${i + 1}/${totalEntries}.`), { statusCode: 422 });
    }
    const sig = buffer.readUInt32LE(offset);
    if (sig !== 0x02014b50) {
      throw Object.assign(new Error(`Tập tin Excel có cấu trúc nén ZIP không hợp lệ: chữ ký Central Directory bị sai lệch tại mục ${i + 1}.`), { statusCode: 422 });
    }

    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);

    const entryLength = 46 + nameLen + extraLen + commentLen;
    if (offset + entryLength > buffer.length) {
      throw Object.assign(new Error(`Tập tin Excel bị cắt cụt (truncated): mục "${i + 1}" vượt quá độ dài dữ liệu.`), { statusCode: 422 });
    }

    const fileName = buffer.toString('utf8', offset + 46, offset + 46 + nameLen);

    if (fileName.startsWith('xl/worksheets/sheet') && fileName.endsWith('.xml')) {
      sheetCount++;
    }

    if (uncompressedSize > MAX_ENTRY_UNCOMPRESSED) {
      throw Object.assign(new Error(`Tập tin chứa dữ liệu "${fileName}" vượt quá giới hạn giải nén an toàn (${(uncompressedSize / 1024 / 1024).toFixed(1)} MB).`), { statusCode: 422 });
    }

    totalUncompressedSize += uncompressedSize;
    offset += entryLength;
  }

  // Xác nhận đã đọc đúng kích thước khai báo của Central Directory
  if (offset - cdOffset !== cdSize) {
    throw Object.assign(new Error('Kích thước Central Directory không khớp với khai báo EOCD trong tập tin Excel.'), { statusCode: 422 });
  }

  if (sheetCount > MAX_SHEETS) {
    throw Object.assign(new Error(`Tập tin Excel chứa quá nhiều trang tính (${sheetCount} sheets), giới hạn tối đa là ${MAX_SHEETS}.`), { statusCode: 422 });
  }

  if (totalUncompressedSize > MAX_TOTAL_UNCOMPRESSED) {
    throw Object.assign(new Error(`Tổng dung lượng sau giải nén (${(totalUncompressedSize / 1024 / 1024).toFixed(1)} MB) vượt quá giới hạn an toàn.`), { statusCode: 422 });
  }

  const compressionRatio = totalUncompressedSize / Math.max(buffer.length, 1);
  if (compressionRatio > 40 && totalUncompressedSize > 1024 * 1024) {
    throw Object.assign(new Error('Tập tin bị từ chối do tỷ lệ nén bất thường (nghi vấn zip bomb).'), { statusCode: 422 });
  }
};

/**
 * Bỏ dấu tiếng Việt chuẩn bao gồm cả Đ/đ
 */
const normalizeHeaderKey = (text) => {
  return String(text || '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
};

/**
 * Đọc buffer file Excel và parse + validate danh sách học sinh
 */
const parseAndValidateExcelBuffer = async (buffer, classroomId, user) => {
  if (!buffer || !buffer.length) {
    throw Object.assign(new Error('Tập tin rỗng hoặc không tải được dữ liệu.'), { statusCode: 400 });
  }

  if (buffer.length > MAX_FILE_SIZE) {
    throw Object.assign(new Error(`Kích thước tập tin vượt quá giới hạn cho phép (tối đa 5 MB).`), { statusCode: 400 });
  }

  // 1. Kiểm tra an toàn cấu trúc ZIP trực tiếp từ buffer TRƯỚC KHI giải nén
  assertZipSafety(buffer);

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (err) {
    throw Object.assign(new Error('Tập tin không phải định dạng Excel (.xlsx) hợp lệ hoặc bị mã hóa mật khẩu.'), { statusCode: 400 });
  }

  // Giới hạn phòng chống Decompression Bomb
  if (workbook.worksheets.length > MAX_SHEETS) {
    throw Object.assign(new Error(`Tập tin Excel chứa quá nhiều trang tính (${workbook.worksheets.length}/${MAX_SHEETS}).`), { statusCode: 422 });
  }

  const is1904 = Boolean(workbook.properties && workbook.properties.date1904);

  // Tìm worksheet dữ liệu: ưu tiên sheet tên "Danh sách học sinh", hoặc sheet đầu tiên nếu không phải "Hướng dẫn"
  let worksheet = workbook.getWorksheet('Danh sách học sinh');
  if (!worksheet) {
    worksheet = workbook.worksheets.find(s => s.name !== 'Hướng dẫn' && s.name !== 'Danh mục');
    if (!worksheet) {
      worksheet = workbook.worksheets[0];
    }
  }

  if (!worksheet || worksheet.name === 'Hướng dẫn') {
    throw Object.assign(new Error('Không tìm thấy trang tính "Danh sách học sinh" trong file Excel.'), { statusCode: 422 });
  }

  // Kiểm tra giới hạn số dòng và số cột của trang tính (cho phép dòng 1..501 cho template 500 học sinh)
  if (worksheet.rowCount > MAX_ROWS + 100) {
    throw Object.assign(new Error(`Tập tin Excel chứa quá nhiều dòng (${worksheet.rowCount} dòng). Giới hạn tối đa là ${MAX_ROWS} dòng dữ liệu.`), { statusCode: 422 });
  }

  if (worksheet.columnCount > MAX_COLUMNS) {
    throw Object.assign(new Error(`Số lượng cột trong trang tính (${worksheet.columnCount}) vượt quá giới hạn cho phép.`), { statusCode: 422 });
  }

  // Kiểm tra header ở dòng 1
  const headerRow = worksheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers.push({ colNumber, text: extractCellStaticString(cell).text });
  });

  if (!headers.length) {
    throw Object.assign(new Error('File Excel chưa có dòng tiêu đề cột hợp lệ.'), { statusCode: 422 });
  }

  // Ánh xạ tên cột tiếng Việt sang key dữ liệu
  const columnMap = {};
  const duplicateHeaderCheck = new Map();
  const unrecognizedHeaders = [];

  const FIELD_KEYWORDS = {
    fullName: ['hoten', 'hovaten', 'fullname'],
    birthDate: ['ngaysinh', 'birthdate', 'dob'],
    gender: ['gioitinh', 'gender', 'sex'],
    address: ['diachi', 'address'],
    nationality: ['quoctich', 'nationality'],
    ethnicity: ['dantoc', 'ethnicity'],
    birthPlace: ['noisinh', 'birthplace'],
    notes: ['ghichu', 'notes', 'note']
  };

  headers.forEach(h => {
    const raw = normalizeHeaderKey(h.text);

    let matchedField = null;
    for (const [field, keywords] of Object.entries(FIELD_KEYWORDS)) {
      if (keywords.some(k => raw === k || raw.includes(k))) {
        matchedField = field;
        break;
      }
    }

    if (!matchedField) {
      if (h.text.trim()) {
        unrecognizedHeaders.push(h.text.trim());
      }
      return;
    }

    // Kiểm tra header trùng lặp
    if (duplicateHeaderCheck.has(matchedField)) {
      throw Object.assign(new Error(`File Excel có các cột tiêu đề trùng lặp nhau: "${h.text}" và "${duplicateHeaderCheck.get(matchedField)}".`), { statusCode: 422 });
    }

    duplicateHeaderCheck.set(matchedField, h.text);
    columnMap[matchedField] = h.colNumber;
  });

  // Từ chối nếu có cột lạ không thuộc mẫu
  if (unrecognizedHeaders.length > 0) {
    throw Object.assign(new Error(`File Excel chứa cột không được nhận diện: "${unrecognizedHeaders.join(', ')}". Vui lòng chỉ sử dụng đúng các cột trong mẫu quy định.`), { statusCode: 422 });
  }

  const missingRequiredHeaders = [];
  if (!columnMap.fullName) missingRequiredHeaders.push('Họ và tên (*)');
  if (!columnMap.birthDate) missingRequiredHeaders.push('Ngày sinh (*)');
  if (!columnMap.gender) missingRequiredHeaders.push('Giới tính (*)');

  if (missingRequiredHeaders.length > 0) {
    throw Object.assign(new Error(`File Excel thiếu các cột bắt buộc: ${missingRequiredHeaders.join(', ')}`), { statusCode: 422 });
  }

  // Đọc các dòng dữ liệu
  const parsedRows = [];
  let rowCount = 0;
  const now = new Date();

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // Bỏ qua header
    rowCount++;

    // Kiểm tra từng cell xem có chứa công thức không
    const rowErrors = [];

    const cellFullNameObj = extractCellStaticString(row.getCell(columnMap.fullName), 'Họ và tên');
    if (cellFullNameObj.isFormula) rowErrors.push(cellFullNameObj.error);

    const cellBirthDate = row.getCell(columnMap.birthDate);
    if (isFormulaCell(cellBirthDate)) {
      rowErrors.push('Ô cột "Ngày sinh" chứa công thức Excel. Vui lòng chuyển thành giá trị tĩnh.');
    }
    const rawBirthDate = cellBirthDate.value;

    const cellGenderObj = extractCellStaticString(row.getCell(columnMap.gender), 'Giới tính');
    if (cellGenderObj.isFormula) rowErrors.push(cellGenderObj.error);

    let cellAddressObj = { text: '' };
    if (columnMap.address) {
      cellAddressObj = extractCellStaticString(row.getCell(columnMap.address), 'Địa chỉ');
      if (cellAddressObj.isFormula) rowErrors.push(cellAddressObj.error);
    }

    let cellNationalityObj = { text: '' };
    if (columnMap.nationality) {
      cellNationalityObj = extractCellStaticString(row.getCell(columnMap.nationality), 'Quốc tịch');
      if (cellNationalityObj.isFormula) rowErrors.push(cellNationalityObj.error);
    }

    let cellEthnicityObj = { text: '' };
    if (columnMap.ethnicity) {
      cellEthnicityObj = extractCellStaticString(row.getCell(columnMap.ethnicity), 'Dân tộc');
      if (cellEthnicityObj.isFormula) rowErrors.push(cellEthnicityObj.error);
    }

    let cellBirthPlaceObj = { text: '' };
    if (columnMap.birthPlace) {
      cellBirthPlaceObj = extractCellStaticString(row.getCell(columnMap.birthPlace), 'Nơi sinh');
      if (cellBirthPlaceObj.isFormula) rowErrors.push(cellBirthPlaceObj.error);
    }

    let cellNotesObj = { text: '' };
    if (columnMap.notes) {
      cellNotesObj = extractCellStaticString(row.getCell(columnMap.notes), 'Ghi chú');
      if (cellNotesObj.isFormula) rowErrors.push(cellNotesObj.error);
    }

    // Bỏ qua dòng hoàn toàn trống
    const allEmpty = !cellFullNameObj.text && !rawBirthDate && !cellGenderObj.text &&
      !cellAddressObj.text && !cellNationalityObj.text && !cellEthnicityObj.text &&
      !cellBirthPlaceObj.text && !cellNotesObj.text;
    if (allEmpty) return;

    parsedRows.push({
      rowNumber,
      rawFullName: cellFullNameObj.text,
      rawBirthDate,
      rawGender: cellGenderObj.text,
      rawAddress: cellAddressObj.text,
      rawNationality: cellNationalityObj.text,
      rawEthnicity: cellEthnicityObj.text,
      rawBirthPlace: cellBirthPlaceObj.text,
      rawNotes: cellNotesObj.text,
      formulaErrors: rowErrors
    });
  });

  if (!parsedRows.length) {
    throw Object.assign(new Error('Tập tin Excel không có dữ liệu học sinh nào để nhập.'), { statusCode: 422 });
  }

  if (parsedRows.length > MAX_ROWS) {
    throw Object.assign(new Error(`Tập tin Excel chứa ${parsedRows.length} học sinh, vượt quá giới hạn tối đa ${MAX_ROWS} học sinh/lần import.`), { statusCode: 422 });
  }

  // 1. Validate từng dòng dữ liệu bằng bộ validator nghiêm ngặt dùng chung
  const validatedRows = [];
  const inMemoryDuplicates = new Map();

  for (const item of parsedRows) {
    const validated = validateStudentRowStrict(item, item.rowNumber, now, is1904);
    if (item.formulaErrors && item.formulaErrors.length > 0) {
      validated.errors.unshift(...item.formulaErrors);
      validated.isValid = false;
    }

    // Kiểm tra trùng lặp nội bộ trong file (cùng Họ tên + Ngày sinh + Giới tính)
    if (validated.fullName && validated.birthDate && validated.gender) {
      const dupKey = `${validated.fullName.toLowerCase()}||${validated.birthDate}||${validated.gender}`;
      if (!inMemoryDuplicates.has(dupKey)) {
        inMemoryDuplicates.set(dupKey, [validated.rowNumber]);
      } else {
        inMemoryDuplicates.get(dupKey).push(validated.rowNumber);
      }
    }

    validatedRows.push(validated);
  }

  // Đánh dấu lỗi cho các dòng bị trùng lặp nội bộ
  for (const row of validatedRows) {
    if (row.fullName && row.birthDate && row.gender) {
      const dupKey = `${row.fullName.toLowerCase()}||${row.birthDate}||${row.gender}`;
      const duplicateRowNumbers = inMemoryDuplicates.get(dupKey) || [];
      if (duplicateRowNumbers.length > 1) {
        row.isValid = false;
        const otherRows = duplicateRowNumbers.filter(r => r !== row.rowNumber);
        row.errors.push(`Trùng lặp thông tin với dòng ${otherRows.join(', ')} trong file này`);
      }
    }
  }

  // 2. Kiểm tra nghi trùng với học sinh đang tồn tại trong hệ thống (Tuân thủ quyền riêng tư phân lớp)
  let teacherClassroomIds = null;
  if (user && user.role === 'teacher') {
    teacherClassroomIds = (await getTeacherClassroomIds(user)).map(String);
  }

  const validCandidates = validatedRows.filter(r => r.isValid);
  if (validCandidates.length > 0) {
    const fullNames = [...new Set(validCandidates.map(r => r.fullName))];
    const existingStudents = await Student.find({
      fullName: { $in: fullNames }
    }).select('fullName birthDate gender classroomId className studentCode status').lean();

    if (existingStudents.length > 0) {
      for (const row of validCandidates) {
        const match = existingStudents.find(s => {
          if (s.fullName.toLowerCase() !== row.fullName.toLowerCase()) return false;
          if (s.gender !== row.gender) return false;
          if (s.birthDate) {
            const sDate = s.birthDate instanceof Date ? s.birthDate.toISOString().slice(0, 10) : String(s.birthDate).slice(0, 10);
            return sDate === row.birthDate;
          }
          return false;
        });

        if (match) {
          row.isValid = false;
          const isAccessibleByTeacher = !teacherClassroomIds || teacherClassroomIds.includes(String(match.classroomId));

          if (isAccessibleByTeacher || user.role === 'admin' || user.role === 'principal') {
            row.errors.push(`Nghi trùng với học sinh "${match.fullName}" (${match.studentCode || 'Chưa có mã'}, lớp ${match.className || 'Chưa xếp lớp'})`);
            row.duplicateInfo = {
              studentCode: match.studentCode,
              fullName: match.fullName,
              className: match.className
            };
          } else {
            // Không lộ mã học sinh và tên lớp của lớp khác cho giáo viên
            row.errors.push(`Nghi trùng với học sinh "${match.fullName}" đã có hồ sơ trong hệ thống nhà trường. Vui lòng liên hệ Ban giám hiệu để kiểm tra.`);
            row.duplicateInfo = {
              isExternal: true,
              fullName: match.fullName
            };
          }
        }
      }
    }
  }

  const totalRows = validatedRows.length;
  const totalValid = validatedRows.filter(r => r.isValid).length;
  const totalErrors = validatedRows.filter(r => !r.isValid).length;
  const fingerprint = computeBatchFingerprint(classroomId, validatedRows);

  return {
    totalRows,
    totalValid,
    totalErrors,
    isValid: totalErrors === 0 && totalValid > 0,
    canImport: totalErrors === 0 && totalValid > 0,
    fingerprint,
    rows: validatedRows.map(r => ({
      rowNumber: r.rowNumber,
      fullName: r.fullName,
      birthDate: r.birthDate,
      birthDateFormatted: r.birthDate ? r.birthDate.split('-').reverse().join('/') : '',
      gender: r.gender,
      genderText: r.genderText,
      address: r.address,
      nationality: r.nationality,
      ethnicity: r.ethnicity,
      birthPlace: r.birthPlace,
      notes: r.notes,
      isValid: r.isValid,
      errors: r.errors,
      duplicateInfo: r.duplicateInfo || null
    }))
  };
};

module.exports = {
  EXCEL_COLUMNS,
  MAX_FILE_SIZE,
  MAX_ROWS,
  generateTemplateWorkbook,
  parseAndValidateExcelBuffer,
  validateStudentRowStrict,
  computeBatchFingerprint,
  deriveSchoolYear
};
