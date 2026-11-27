const ExcelJS = require('exceljs');
const crypto = require('crypto');
const Student = require('../models/zone3_school/Student');
const Employee = require('../models/zone2_hr/Employee');
const User = require('../models/zone1_system/User');
const { getTeacherClassroomIds } = require('../services/schoolDataAccessService');
const { buildTenantFilter } = require('../services/tenantFilterService');

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_ROWS = 500;
const MAX_SHEETS = 5;
const MAX_COLUMNS = 30;
const MULTI_CLASS_TARGET = '__ALL__';

/**
 * Cấu trúc cột chuẩn của file Excel mẫu nhập học sinh.
 * Hỗ trợ:
 * - Đẩy danh sách tổng toàn trường tự động chia lớp theo cột "Lớp" (dành cho Admin / BGH / Tổng phụ trách).
 * - Đẩy danh sách riêng từng lớp (dành cho Giáo viên chủ nhiệm).
 * - Lưu Mã ID học sinh, Mã định danh cá nhân và thông tin đầy đủ 2 Phụ huynh (dự phòng khẩn cấp).
 */
const EXCEL_COLUMNS = [
  { header: 'Lớp', key: 'classNameInput', width: 20, required: false },
  { header: 'Mã ID học sinh', key: 'studentCode', width: 16, required: false },
  { header: 'Mã định danh học sinh', key: 'identityCode', width: 22, required: false },
  { header: 'Họ và tên (*)', key: 'fullName', width: 26, required: true },
  { header: 'Ngày sinh (*)', key: 'birthDate', width: 16, required: true },
  { header: 'Giới tính (*)', key: 'gender', width: 14, required: true },
  { header: 'Ngày nhập học', key: 'admissionDate', width: 16, required: false },
  { header: 'Họ tên phụ huynh 1', key: 'parent1Name', width: 24, required: false },
  { header: 'Điện thoại phụ huynh 1', key: 'parent1Phone', width: 18, required: false },
  { header: 'Hòm thư phụ huynh 1', key: 'parent1Email', width: 24, required: false },
  { header: 'Quan hệ PH 1', key: 'parent1Relationship', width: 16, required: false },
  { header: 'Họ tên phụ huynh 2', key: 'parent2Name', width: 24, required: false },
  { header: 'Điện thoại phụ huynh 2', key: 'parent2Phone', width: 18, required: false },
  { header: 'Hòm thư phụ huynh 2', key: 'parent2Email', width: 24, required: false },
  { header: 'Quan hệ PH 2', key: 'parent2Relationship', width: 16, required: false },
  { header: 'Dị ứng thực phẩm', key: 'allergiesText', width: 22, required: false },
  { header: 'Bệnh lý / Sức khỏe', key: 'diseaseText', width: 22, required: false },
  { header: 'Địa chỉ', key: 'address', width: 30, required: false },
  { header: 'Quốc tịch', key: 'nationality', width: 16, required: false },
  { header: 'Dân tộc', key: 'ethnicity', width: 15, required: false },
  { header: 'Nơi sinh', key: 'birthPlace', width: 20, required: false },
  { header: 'Ghi chú', key: 'notes', width: 28, required: false },
  { header: 'Mã thẻ BHYT', key: 'healthInsuranceCode', width: 20, required: false },
  { header: 'Nhóm máu', key: 'bloodType', width: 12, required: false }
];

const VALID_BLOOD_TYPES = new Set(['', 'A', 'B', 'AB', 'O', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);

const GENDER_MAP = {
  nam: 'male',
  'nữ': 'female',
  nu: 'female',
  male: 'male',
  female: 'female'
};

const RELATIONSHIP_MAP = {
  bo: 'father',
  cha: 'father',
  ba: 'father',
  father: 'father',
  me: 'mother',
  ma: 'mother',
  mother: 'mother',
  nguoigiamho: 'guardian',
  giamho: 'guardian',
  ong: 'guardian',
  guardian: 'guardian',
  phuhuynh: 'guardian'
};

const deriveSchoolYear = (date = new Date()) => {
  const parsed = new Date(date);
  const startYear = parsed.getMonth() >= 7 ? parsed.getFullYear() : parsed.getFullYear() - 1;
  return `${startYear}-${startYear + 1}`;
};

const normalizeViKey = (text) => String(text || '')
  .replace(/đ/g, 'd')
  .replace(/Đ/g, 'd')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

const normalizeRelationship = (rawValue, fallback = 'guardian') => {
  if (!rawValue) return fallback;
  const key = normalizeViKey(rawValue);
  return RELATIONSHIP_MAP[key] || fallback;
};

/**
 * Tạo file Excel mẫu chuẩn (.xlsx) gồm 3 trang tính:
 * 1. "Danh sách học sinh": Đầy đủ cột Lớp, Mã ID, Mã định danh, 2 Phụ huynh, Y tế & Nhân khẩu; có dropdown Lớp, Giới tính, Quan hệ.
 * 2. "Hướng dẫn": Hướng dẫn chi tiết cách đẩy tổng nhiều lớp và đẩy theo từng lớp.
 * 3. "Danh mục" (ẩn): Nguồn tham chiếu danh sách lớp đang hoạt động của trường.
 *
 * @param {Array<{name: string, campus?: string}>} classrooms Danh sách lớp đang hoạt động của trường (tùy chọn)
 */
const generateTemplateWorkbook = async (classrooms = []) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Hệ thống Quản lý Trường Mầm non Hoa Nắng';
  workbook.created = new Date();

  // Sheet 1: Danh sách học sinh
  const dataSheet = workbook.addWorksheet('Danh sách học sinh', {
    views: [{ state: 'frozen', xSplit: 4, ySplit: 1 }]
  });

  dataSheet.columns = EXCEL_COLUMNS.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width
  }));

  const headerRow = dataSheet.getRow(1);
  headerRow.height = 30;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10.5, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E3A8A' }
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
    };
  });

  // Định dạng text (@) cho các cột Mã, Ngày và Số điện thoại để Excel không tự cắt số 0 đầu
  ['studentCode', 'identityCode', 'healthInsuranceCode', 'birthDate', 'admissionDate', 'parent1Phone', 'parent2Phone'].forEach((colKey) => {
    const col = dataSheet.getColumn(colKey);
    if (col) col.numFmt = '@';
  });

  // Sheet 3: Danh mục tham chiếu (ẩn)
  const catSheet = workbook.addWorksheet('Danh mục');
  catSheet.getCell('A1').value = 'Giới tính';
  catSheet.getCell('A2').value = 'Nam';
  catSheet.getCell('A3').value = 'Nữ';

  catSheet.getCell('B1').value = 'Quan hệ';
  catSheet.getCell('B2').value = 'Bố';
  catSheet.getCell('B3').value = 'Mẹ';
  catSheet.getCell('B4').value = 'Người giám hộ';

  catSheet.getCell('C1').value = 'Lớp học';
  const classNames = [...new Set((classrooms || []).map((c) => String(c.name || '').trim()).filter(Boolean))];
  classNames.forEach((clsName, idx) => {
    catSheet.getCell(`C${idx + 2}`).value = clsName;
  });
  catSheet.state = 'hidden';

  const classDropdownFormula = classNames.length > 0
    ? [`'Danh mục'!$C$2:$C$${classNames.length + 1}`]
    : null;

  // Gán dropdown trực tiếp cho từng dòng 2..501
  for (let r = 2; r <= MAX_ROWS + 1; r++) {
    if (classDropdownFormula) {
      dataSheet.getCell(`A${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: classDropdownFormula,
        showErrorMessage: false
      };
    }

    dataSheet.getCell(`F${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"Nam,Nữ"'],
      showErrorMessage: true,
      errorTitle: 'Giới tính không hợp lệ',
      error: 'Vui lòng chọn Nam hoặc Nữ từ danh sách.'
    };

    ['K', 'O'].forEach((colLetter) => {
      dataSheet.getCell(`${colLetter}${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"Bố,Mẹ,Người giám hộ"'],
        showErrorMessage: false
      };
    });
  }

  // Sheet 2: Hướng dẫn chi tiết
  const guideSheet = workbook.addWorksheet('Hướng dẫn');
  guideSheet.columns = [
    { header: 'Nội dung', key: 'title', width: 32 },
    { header: 'Chi tiết hướng dẫn', key: 'detail', width: 78 }
  ];

  const guideHeader = guideSheet.getRow(1);
  guideHeader.height = 26;
  guideHeader.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  const guideData = [
    ['1. Hai chế độ nhập linh hoạt', '• Đẩy danh sách tổng toàn trường (Admin / Hiệu trưởng / Tổng phụ trách): Chọn "Đẩy danh sách tổng theo cột Lớp" trên web và điền tên lớp vào cột "Lớp" ở từng dòng.\n• Đẩy theo từng lớp (Giáo viên chủ nhiệm): Chọn sẵn 1 lớp trên web (cột "Lớp" có thể để trống hoặc ghi đúng tên lớp đó).'],
    ['2. Các cột bắt buộc (*)', 'Họ và tên (*), Ngày sinh (*), Giới tính (*). Khi đẩy danh sách tổng toàn trường, cột "Lớp" là bắt buộc ở mọi dòng.'],
    ['3. Mã ID & Mã định danh học sinh', '• Mã ID học sinh: Mã nội bộ/máy chấm công của trường (để trống hệ thống tự sinh số tăng dần 1, 2, 3...).\n• Mã định danh học sinh: Mã định danh cá nhân / mã Bộ GD&ĐT (tùy chọn, tối đa 40 ký tự).'],
    ['4. Thông tin 2 Phụ huynh', 'Khuyến khích điền đủ Phụ huynh 1 và Phụ huynh 2 (Họ tên, Điện thoại, Hòm thư Email, Quan hệ Bố/Mẹ/Người giám hộ) để nhà trường luôn có số gọi dự phòng khi khẩn cấp.'],
    ['5. Định dạng Ngày tháng', 'Hỗ trợ dd/MM/yyyy (ví dụ: 15/08/2022) hoặc yyyy-MM-dd. Ngày sinh không được ở tương lai; nhận trẻ từ bậc Nhà trẻ (6 tháng tuổi) đến Mẫu giáo.'],
    ['6. Không dùng công thức Excel', 'Hệ thống từ chối ô chứa công thức để bảo đảm an toàn dữ liệu. Vui lòng dán giá trị tĩnh (Paste Values).'],
    ['7. Chính sách nhập nguyên khối', 'Tối đa 500 học sinh / lần import (tối đa 5 MB). Chỉ lưu khi tất cả các dòng hợp lệ, không trùng lặp và không vượt sĩ số tối đa của từng lớp.'],
    ['---', '---'],
    ['Ví dụ dòng mẫu', 'Lớp: Mầm 1 | Mã ID: (để trống) | Mã định danh: 001322001234 | Họ tên: Nguyễn Minh An | Ngày sinh: 12/05/2023 | Giới tính: Nam | PH1: Nguyễn Văn Hùng - 0901234567 - hung@gmail.com (Bố) | PH2: Trần Thị Lan - 0912345678 - lan@gmail.com (Mẹ)']
  ];

  guideData.forEach((row) => guideSheet.addRow(row));
  guideSheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.alignment = { vertical: 'top', wrapText: true };
    }
  });

  return workbook;
};

const isFormulaCell = (cell) => {
  if (!cell) return false;
  if (cell.type === ExcelJS.ValueType.Formula) return true;
  if (cell.formula) return true;
  if (typeof cell.value === 'object' && cell.value !== null && cell.value.formula) return true;
  return false;
};

const parseBirthDate = (cellValue, is1904 = false) => {
  if (cellValue == null || cellValue === '') return { error: 'Ngày sinh không được để trống' };

  let d = null;
  if (cellValue instanceof Date && !Number.isNaN(cellValue.getTime())) {
    d = cellValue;
  } else if (typeof cellValue === 'number') {
    const epochOffset = is1904 ? 24107 : 25569;
    const utcDays = Math.floor(cellValue - epochOffset);
    d = new Date(utcDays * 86400 * 1000);
  } else if (typeof cellValue === 'string') {
    const trimmed = cellValue.trim();
    if (!trimmed) return { error: 'Ngày sinh không được để trống' };

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
        return { error: 'Định dạng ngày sinh phải là dd/MM/yyyy (ví dụ: 15/08/2022)' };
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

  const ageInYears = (now.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (ageInYears > 12) {
    return { error: 'Độ tuổi học sinh mầm non không hợp lệ (vượt quá 12 tuổi)' };
  }

  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dayStr = String(d.getUTCDate()).padStart(2, '0');
  return { date: `${y}-${m}-${dayStr}`, dateObj: d };
};

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
      return { text: val.richText.map((t) => t.text || '').join('').trim() };
    }
    if (val.text != null) {
      return { text: String(val.text).trim() };
    }
    if (val.hyperlink && val.text == null) {
      return { text: String(val.hyperlink).replace(/^mailto:/i, '').trim() };
    }
  }
  return { text: '' };
};

const computeBatchFingerprint = (classroomId, rows) => {
  const canonicalData = {
    classroomId: String(classroomId || MULTI_CLASS_TARGET),
    students: (rows || []).map((r) => ({
      classNameInput: String(r.classNameInput || r.resolvedClassName || '').trim().toLowerCase(),
      resolvedClassroomId: String(r.resolvedClassroomId || '').trim(),
      studentCode: String(r.studentCode || '').trim().toUpperCase(),
      identityCode: String(r.identityCode || '').trim().toUpperCase(),
      fullName: String(r.fullName || '').replace(/\s+/g, ' ').trim().toLowerCase(),
      birthDate: String(r.birthDateStr || r.birthDate || '').trim(),
      gender: String(r.gender || '').trim().toLowerCase(),
      admissionDate: String(r.admissionDate || '').trim(),
      parent1Name: String(r.parent1Name || r.contactName || '').trim(),
      parent1Phone: String(r.parent1Phone || r.contactPhone || '').trim(),
      parent1Email: String(r.parent1Email || '').trim().toLowerCase(),
      parent2Name: String(r.parent2Name || '').trim(),
      parent2Phone: String(r.parent2Phone || '').trim(),
      parent2Email: String(r.parent2Email || '').trim().toLowerCase(),
      allergiesText: String(r.allergiesText || '').trim().toLowerCase(),
      diseaseText: String(r.diseaseText || '').trim().toLowerCase(),
      address: String(r.address || '').trim(),
      nationality: String(r.nationality || '').trim(),
      ethnicity: String(r.ethnicity || '').trim(),
      birthPlace: String(r.birthPlace || '').trim(),
      notes: String(r.notes || '').trim(),
      healthInsuranceCode: String(r.healthInsuranceCode || '').trim().toUpperCase(),
      bloodType: String(r.bloodType || '').trim().toUpperCase()
    }))
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonicalData), 'utf8').digest('hex');
};

const pickString = (item, primaryKey, rawKey = '') => {
  if (item[primaryKey] != null) return String(item[primaryKey]).trim();
  if (rawKey && item[rawKey] != null) return String(item[rawKey]).trim();
  return '';
};

const normalizeExcelPhone = (rawVal) => {
  if (!rawVal) return '';
  let cleaned = String(rawVal).replace(/[.\s()-]/g, '').trim();
  if (cleaned.startsWith('+84')) {
    cleaned = `0${cleaned.slice(3)}`;
  } else if (cleaned.startsWith('84') && cleaned.length >= 11) {
    cleaned = `0${cleaned.slice(2)}`;
  } else if (/^[35789]\d{8}$/.test(cleaned)) {
    // Khôi phục số 0 đầu bị Excel cắt mất khi gõ vào ô Number
    cleaned = `0${cleaned}`;
  }
  return cleaned;
};

/**
 * Kiểm tra tính hợp lệ nghiêm ngặt của 1 dòng dữ liệu học sinh (dùng chung cho cả Preview & Confirm).
 */
const validateStudentRowStrict = (item, rowNumber, _now = new Date(), is1904 = false) => {
  const errors = [];
  const classNameInput = pickString(item, 'classNameInput', 'rawClassNameInput');
  const studentCode = pickString(item, 'studentCode', 'rawStudentCode').toUpperCase();
  const identityCode = pickString(item, 'identityCode', 'rawIdentityCode').toUpperCase();
  const fullName = pickString(item, 'fullName', 'rawFullName').replace(/\s+/g, ' ');
  const rawGender = pickString(item, 'gender', 'rawGender');
  const address = pickString(item, 'address', 'rawAddress');
  const nationality = pickString(item, 'nationality', 'rawNationality');
  const ethnicity = pickString(item, 'ethnicity', 'rawEthnicity');
  const birthPlace = pickString(item, 'birthPlace', 'rawBirthPlace');
  const notes = pickString(item, 'notes', 'rawNotes');
  const healthInsuranceCode = pickString(item, 'healthInsuranceCode', 'rawHealthInsuranceCode').replace(/\s+/g, '').toUpperCase();
  const rawBloodType = pickString(item, 'bloodType', 'rawBloodType').replace(/^nh[oó]m\s*(m[aá]u)?\s*/i, '').trim().toUpperCase();
  const allergiesText = pickString(item, 'allergiesText', 'rawAllergiesText');
  const diseaseText = pickString(item, 'diseaseText', 'rawDiseaseText');

  // Tương thích ngược với các cột đơn contactName / contactPhone cũ + tự khôi phục số 0 đầu bị mất trong Excel
  const parent1Name = pickString(item, 'parent1Name', 'rawParent1Name') || pickString(item, 'contactName', 'rawContactName');
  const parent1Phone = normalizeExcelPhone(pickString(item, 'parent1Phone', 'rawParent1Phone') || pickString(item, 'contactPhone', 'rawContactPhone'));
  const parent1Email = pickString(item, 'parent1Email', 'rawParent1Email').toLowerCase();
  const parent1RelRaw = pickString(item, 'parent1Relationship', 'rawParent1Relationship');

  const parent2Name = pickString(item, 'parent2Name', 'rawParent2Name');
  const parent2Phone = normalizeExcelPhone(pickString(item, 'parent2Phone', 'rawParent2Phone'));
  const parent2Email = pickString(item, 'parent2Email', 'rawParent2Email').toLowerCase();
  const parent2RelRaw = pickString(item, 'parent2Relationship', 'rawParent2Relationship');

  // 1. Mã ID & Mã định danh
  if (studentCode && !/^[A-Z0-9_-]{1,30}$/.test(studentCode)) {
    errors.push('Mã ID học sinh chỉ được chứa chữ cái không dấu, chữ số, dấu gạch ngang/dưới (tối đa 30 ký tự)');
  }
  if (identityCode.length > 40) {
    errors.push(`Mã định danh học sinh vượt quá 40 ký tự (hiện tại: ${identityCode.length} ký tự)`);
  }

  // 2. Họ và tên
  if (!fullName) {
    errors.push('Họ và tên không được để trống');
  } else if (fullName.length > 120) {
    errors.push(`Họ và tên vượt quá độ dài tối đa 120 ký tự (hiện tại: ${fullName.length} ký tự)`);
  }

  // 3. Ngày sinh
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

  // 4. Giới tính
  let gender = '';
  if (!rawGender) {
    errors.push('Giới tính không được để trống');
  } else {
    gender = GENDER_MAP[rawGender.toLowerCase()] || '';
    if (!gender) {
      errors.push(`Giới tính "${rawGender}" không hợp lệ. Vui lòng chọn "Nam" hoặc "Nữ"`);
    }
  }

  // 5. Độ dài các trường văn bản tùy chọn
  if (address.length > 500) errors.push(`Địa chỉ vượt quá độ dài tối đa 500 ký tự (hiện tại: ${address.length} ký tự)`);
  if (nationality.length > 80) errors.push(`Quốc tịch vượt quá độ dài tối đa 80 ký tự (hiện tại: ${nationality.length} ký tự)`);
  if (ethnicity.length > 80) errors.push(`Dân tộc vượt quá độ dài tối đa 80 ký tự (hiện tại: ${ethnicity.length} ký tự)`);
  if (birthPlace.length > 120) errors.push(`Nơi sinh vượt quá độ dài tối đa 120 ký tự (hiện tại: ${birthPlace.length} ký tự)`);
  if (notes.length > 2000) errors.push(`Ghi chú vượt quá độ dài tối đa 2000 ký tự (hiện tại: ${notes.length} ký tự)`);
  if (healthInsuranceCode.length > 30) errors.push(`Mã thẻ BHYT vượt quá 30 ký tự (hiện tại: ${healthInsuranceCode.length} ký tự)`);
  if (rawBloodType && !VALID_BLOOD_TYPES.has(rawBloodType)) {
    errors.push(`Nhóm máu "${rawBloodType}" không hợp lệ (chấp nhận A, B, AB, O hoặc kèm Rh +/-)`);
  }

  // 6. Ngày nhập học
  let admissionDateFormatted = '';
  let admissionDateObj = null;
  const rawAdmission = item.admissionDate != null ? item.admissionDate : item.rawAdmissionDate;
  if (rawAdmission != null && String(rawAdmission).trim() !== '') {
    const admParsed = parseBirthDate(rawAdmission, is1904);
    if (admParsed.error && !admParsed.error.includes('12 tuổi')) {
      errors.push(admParsed.error.replace(/Ngày sinh/g, 'Ngày nhập học'));
    } else if (admParsed.dateObj) {
      admissionDateFormatted = admParsed.date;
      admissionDateObj = admParsed.dateObj;
      if (birthDateObj && admissionDateObj < birthDateObj) {
        errors.push('Ngày nhập học không được trước ngày sinh');
      }
    }
  }

  // 7. Kiểm tra thông tin Phụ huynh 1 & Phụ huynh 2
  const phoneRegex = /^(0|\+84)\d{9,10}$/;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (parent1Phone && !phoneRegex.test(parent1Phone)) {
    errors.push(`SĐT phụ huynh 1 "${parent1Phone}" không hợp lệ`);
  }
  if (parent1Email && !emailRegex.test(parent1Email)) {
    errors.push(`Hòm thư phụ huynh 1 "${parent1Email}" không đúng định dạng email`);
  }
  if ((parent1Phone || parent1Email) && !parent1Name) {
    errors.push('Vui lòng nhập Họ tên phụ huynh 1 khi đã khai báo SĐT/Hòm thư phụ huynh 1');
  }
  if (parent1Name && !parent1Phone) {
    errors.push('Vui lòng nhập SĐT phụ huynh 1 khi đã khai báo Họ tên phụ huynh 1');
  }

  if (parent2Phone && !phoneRegex.test(parent2Phone)) {
    errors.push(`SĐT phụ huynh 2 "${parent2Phone}" không hợp lệ`);
  }
  if (parent2Email && !emailRegex.test(parent2Email)) {
    errors.push(`Hòm thư phụ huynh 2 "${parent2Email}" không đúng định dạng email`);
  }
  if ((parent2Phone || parent2Email) && !parent2Name) {
    errors.push('Vui lòng nhập Họ tên phụ huynh 2 khi đã khai báo SĐT/Hòm thư phụ huynh 2');
  }
  if (parent2Name && !parent2Phone) {
    errors.push('Vui lòng nhập SĐT phụ huynh 2 khi đã khai báo Họ tên phụ huynh 2');
  }

  const parents = [];
  if (parent1Name && parent1Phone) {
    parents.push({
      fullName: parent1Name,
      phone: parent1Phone,
      ...(parent1Email ? { email: parent1Email } : {}),
      relationship: normalizeRelationship(parent1RelRaw, 'father'),
      isPrimary: true
    });
  }
  if (parent2Name && parent2Phone) {
    parents.push({
      fullName: parent2Name,
      phone: parent2Phone,
      ...(parent2Email ? { email: parent2Email } : {}),
      relationship: normalizeRelationship(parent2RelRaw, 'mother'),
      isPrimary: parents.length === 0
    });
  }

  const primaryParent = parents[0];
  const emergencyContact = primaryParent
    ? {
        name: primaryParent.fullName,
        phone: primaryParent.phone,
        relationship: { father: 'Bố', mother: 'Mẹ', guardian: 'Người giám hộ' }[primaryParent.relationship] || 'Phụ huynh'
      }
    : {};

  // 8. Dị ứng & Bệnh lý
  const allergies = allergiesText
    ? allergiesText.split(/[,;]/).map((s) => s.trim()).filter(Boolean).map((allergen) => ({ allergen, severity: 'moderate', note: '' }))
    : [];
  const disease = diseaseText ? { name: diseaseText.slice(0, 200), description: diseaseText, medication: '', note: '' } : {};

  const parsedData = {
    rowNumber,
    classNameInput,
    resolvedClassroomId: item.resolvedClassroomId || '',
    resolvedClassName: item.resolvedClassName || '',
    studentCode,
    identityCode,
    fullName,
    birthDate: birthDateFormatted,
    birthDateStr: birthDateFormatted,
    birthDateObj,
    admissionDate: admissionDateFormatted,
    admissionDateObj,
    gender,
    genderText: gender === 'female' ? 'Nữ' : (gender === 'male' ? 'Nam' : rawGender),
    parent1Name,
    parent1Phone,
    parent1Email,
    parent1Relationship: parent1RelRaw,
    parent2Name,
    parent2Phone,
    parent2Email,
    parent2Relationship: parent2RelRaw,
    contactName: parent1Name,
    contactPhone: parent1Phone,
    parents,
    emergencyContact,
    allergiesText,
    allergies,
    diseaseText,
    disease,
    address,
    nationality: nationality || 'Việt Nam',
    ethnicity,
    birthPlace,
    notes,
    healthInsuranceCode,
    bloodType: rawBloodType
  };

  return {
    ...parsedData,
    parsedData,
    isValid: errors.length === 0,
    errors
  };
};

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
    throw Object.assign(new Error(`Tập tin Excel chứa quá nhiều tệp con (${totalEntries}), vượt quá giới hạn an toàn.`), { statusCode: 422 });
  }
  if (cdOffset + cdSize > buffer.length) {
    throw Object.assign(new Error('Cấu trúc nén của tập tin Excel bị sai lệch.'), { statusCode: 422 });
  }

  let offset = cdOffset;
  let totalUncompressedSize = 0;
  let sheetCount = 0;
  const MAX_TOTAL_UNCOMPRESSED = 30 * 1024 * 1024;
  const MAX_ENTRY_UNCOMPRESSED = 10 * 1024 * 1024;

  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > buffer.length) {
      throw Object.assign(new Error(`Tập tin Excel bị hỏng: thiếu dữ liệu Central Directory tại mục thứ ${i + 1}/${totalEntries}.`), { statusCode: 422 });
    }
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw Object.assign(new Error(`Tập tin Excel có cấu trúc nén ZIP không hợp lệ tại mục ${i + 1}.`), { statusCode: 422 });
    }

    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);

    const entryLength = 46 + nameLen + extraLen + commentLen;
    if (offset + entryLength > buffer.length) {
      throw Object.assign(new Error(`Tập tin Excel bị cắt cụt (truncated) tại mục "${i + 1}".`), { statusCode: 422 });
    }

    const fileName = buffer.toString('utf8', offset + 46, offset + 46 + nameLen);
    if (fileName.startsWith('xl/worksheets/sheet') && fileName.endsWith('.xml')) {
      sheetCount++;
    }
    if (uncompressedSize > MAX_ENTRY_UNCOMPRESSED) {
      throw Object.assign(new Error(`Tập tin chứa dữ liệu "${fileName}" vượt quá giới hạn giải nén an toàn.`), { statusCode: 422 });
    }

    totalUncompressedSize += uncompressedSize;
    offset += entryLength;
  }

  if (offset - cdOffset !== cdSize) {
    throw Object.assign(new Error('Kích thước Central Directory không khớp với khai báo EOCD trong tập tin Excel.'), { statusCode: 422 });
  }
  if (sheetCount > MAX_SHEETS) {
    throw Object.assign(new Error(`Tập tin Excel chứa quá nhiều trang tính (${sheetCount} sheets), giới hạn tối đa là ${MAX_SHEETS}.`), { statusCode: 422 });
  }
  if (totalUncompressedSize > MAX_TOTAL_UNCOMPRESSED) {
    throw Object.assign(new Error('Tổng dung lượng sau giải nén vượt quá giới hạn an toàn.'), { statusCode: 422 });
  }

  const compressionRatio = totalUncompressedSize / Math.max(buffer.length, 1);
  if (compressionRatio > 40 && totalUncompressedSize > 1024 * 1024) {
    throw Object.assign(new Error('Tập tin bị từ chối do tỷ lệ nén bất thường (nghi vấn zip bomb).'), { statusCode: 422 });
  }
};

/**
 * Nhận diện tiêu đề cột tiếng Việt không xung đột thứ tự từ khóa
 * (hỗ trợ cả mẫu 22 cột mới lẫn các mẫu 8 cột / 13 cột cũ).
 */
const resolveHeaderField = (rawHeader) => {
  const key = normalizeViKey(rawHeader);
  if (!key) return null;

  // 1. Nhóm Phụ huynh 2 (kiểm tra trước Phụ huynh 1 / Phụ huynh chung)
  if (['hotenphuhuynh2', 'phuhuynh2', 'tenphuhuynh2', 'parent2name'].includes(key)) return 'parent2Name';
  if (['dienthoaiphuhuynh2', 'sdtphuhuynh2', 'sodienthoaiphuhuynh2', 'sdtph2', 'parent2phone'].includes(key)) return 'parent2Phone';
  if (['homthuphuhuynh2', 'emailphuhuynh2', 'mailphuhuynh2', 'parent2email'].includes(key)) return 'parent2Email';
  if (['quanheph2', 'quanhephuhuynh2', 'parent2relationship'].includes(key)) return 'parent2Relationship';

  // 2. Nhóm Phụ huynh 1 & tương thích ngược cột Phụ huynh đơn cũ
  if (['hotenphuhuynh1', 'phuhuynh1', 'tenphuhuynh1', 'hotenphuhuynh', 'phuhuynhhocsinh', 'nguoilienhe', 'phuhuynh', 'parent1name', 'parentname', 'contactname'].includes(key)) return 'parent1Name';
  if (['dienthoaiphuhuynh1', 'sdtphuhuynh1', 'sodienthoaiphuhuynh1', 'sdtph1', 'dienthoaiphuhuynh', 'sdtphuhuynh', 'sdtlienhe', 'sodienthoai', 'parent1phone', 'contactphone', 'phone'].includes(key)) return 'parent1Phone';
  if (['homthuphuhuynh1', 'emailphuhuynh1', 'mailphuhuynh1', 'homthuphuhuynh', 'emailphuhuynh', 'email', 'parent1email', 'parentemail'].includes(key)) return 'parent1Email';
  if (['quanheph1', 'quanhephuhuynh1', 'quanhephuhuynh', 'quanhe', 'parent1relationship'].includes(key)) return 'parent1Relationship';

  // 3. Mã học sinh, Mã định danh & Lớp
  if (['madinhdanhhocsinh', 'madinhdanh', 'sodinhdanh', 'madinhdanhcanhan', 'identitycode'].includes(key)) return 'identityCode';
  if (['maidhocsinh', 'maidcuahocsinh', 'mahocsinh', 'mahs', 'studentcode', 'studentid'].includes(key)) return 'studentCode';
  if (['lop', 'lophoc', 'tenlop', 'classroom', 'classname'].includes(key)) return 'classNameInput';

  // 4. Thông tin học sinh cốt lõi
  if (['hovaten', 'hotenhocsinh', 'hoten', 'fullname'].includes(key)) return 'fullName';
  if (['ngaysinh', 'birthdate', 'dob'].includes(key)) return 'birthDate';
  if (['gioitinh', 'gender', 'sex'].includes(key)) return 'gender';
  if (['ngaynhaphoc', 'ngayvaohoc', 'admissiondate'].includes(key)) return 'admissionDate';

  // 5. Y tế & Nhân khẩu
  if (key.includes('diung') || key === 'allergies' || key === 'allergy') return 'allergiesText';
  if (key.includes('benhly') || key.includes('suckhoe') || key === 'disease') return 'diseaseText';
  if (['diachi', 'address'].includes(key)) return 'address';
  if (['quoctich', 'nationality'].includes(key)) return 'nationality';
  if (['dantoc', 'ethnicity'].includes(key)) return 'ethnicity';
  if (['noisinh', 'birthplace'].includes(key)) return 'birthPlace';
  if (['ghichu', 'notes', 'note'].includes(key)) return 'notes';
  if (['mathebhyt', 'mabhyt', 'sobhyt', 'bhyt', 'baohiemyte', 'healthinsurancecode'].includes(key)) return 'healthInsuranceCode';
  if (['nhommau', 'bloodtype'].includes(key)) return 'bloodType';

  return null;
};

/**
 * Đối chiếu tên lớp trong cột "Lớp" của Excel với danh sách lớp đang hoạt động của trường.
 * Hỗ trợ nhập dạng "Mầm 1", "Lớp Mầm 1", hoặc "Mầm 1 (Phân hiệu 2)".
 */
const matchClassroomByInput = (rawInput, availableClassrooms = []) => {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return { classroom: null };

  const lower = trimmed.toLowerCase();
  const normalized = normalizeViKey(trimmed);

  // Khớp chính xác theo "Tên lớp (Phân hiệu)" trước
  const exactWithCampus = availableClassrooms.filter((cls) => {
    const labelWithCampus = `${cls.name} (${cls.campus || 'Cơ sở chính'})`.toLowerCase();
    return labelWithCampus === lower;
  });
  if (exactWithCampus.length === 1) return { classroom: exactWithCampus[0] };

  // Khớp chính xác theo name hoặc fullName
  const exactMatches = availableClassrooms.filter((cls) =>
    String(cls.name || '').trim().toLowerCase() === lower ||
    String(cls.fullName || '').trim().toLowerCase() === lower ||
    normalizeViKey(cls.name) === normalized ||
    normalizeViKey(`Lớp ${cls.name}`) === normalized
  );

  if (exactMatches.length === 1) return { classroom: exactMatches[0] };
  if (exactMatches.length > 1) {
    const campuses = exactMatches.map((m) => m.campus || 'Cơ sở chính').join(', ');
    return {
      classroom: null,
      ambiguousError: `Tên lớp "${trimmed}" tồn tại ở nhiều phân hiệu (${campuses}). Vui lòng ghi rõ "${trimmed} (Tên phân hiệu)"`
    };
  }

  return {
    classroom: null,
    notFoundError: `Không tìm thấy lớp đang hoạt động "${trimmed}" trong trường`
  };
};

/**
 * Đọc buffer file Excel và phân tích + kiểm tra danh sách học sinh.
 * Hỗ trợ cả 2 chế độ:
 * - Chọn 1 lớp cụ thể (`classroomId` là ObjectId).
 * - Đẩy danh sách tổng toàn trường (`classroomId === '__ALL__'` hoặc rỗng), phân lớp theo cột "Lớp".
 */
const parseAndValidateExcelBuffer = async (buffer, classroomId, user, options = {}) => {
  const { availableClassrooms = [], selectedClassroom = null, reqContext = null } = options;
  const isMultiClassMode = !classroomId || classroomId === MULTI_CLASS_TARGET;

  if (!buffer || !buffer.length) {
    throw Object.assign(new Error('Tập tin rỗng hoặc không tải được dữ liệu.'), { statusCode: 400 });
  }
  if (buffer.length > MAX_FILE_SIZE) {
    throw Object.assign(new Error('Kích thước tập tin vượt quá giới hạn cho phép (tối đa 5 MB).'), { statusCode: 400 });
  }

  assertZipSafety(buffer);

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw Object.assign(new Error('Tập tin không phải định dạng Excel (.xlsx) hợp lệ hoặc bị mã hóa mật khẩu.'), { statusCode: 400 });
  }

  if (workbook.worksheets.length > MAX_SHEETS) {
    throw Object.assign(new Error(`Tập tin Excel chứa quá nhiều trang tính (${workbook.worksheets.length}/${MAX_SHEETS}).`), { statusCode: 422 });
  }

  const is1904 = Boolean(workbook.properties && workbook.properties.date1904);

  let worksheet = workbook.getWorksheet('Danh sách học sinh');
  if (!worksheet) {
    worksheet = workbook.worksheets.find((s) => s.name !== 'Hướng dẫn' && s.name !== 'Danh mục') || workbook.worksheets[0];
  }
  if (!worksheet || worksheet.name === 'Hướng dẫn') {
    throw Object.assign(new Error('Không tìm thấy trang tính "Danh sách học sinh" trong file Excel.'), { statusCode: 422 });
  }

  if (worksheet.rowCount > MAX_ROWS + 100) {
    throw Object.assign(new Error(`Tập tin Excel chứa quá nhiều dòng (${worksheet.rowCount} dòng). Giới hạn tối đa là ${MAX_ROWS} dòng dữ liệu.`), { statusCode: 422 });
  }
  if (worksheet.columnCount > MAX_COLUMNS) {
    throw Object.assign(new Error(`Số lượng cột trong trang tính (${worksheet.columnCount}) vượt quá giới hạn cho phép (${MAX_COLUMNS}).`), { statusCode: 422 });
  }

  const headerRow = worksheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers.push({ colNumber, text: extractCellStaticString(cell).text });
  });

  if (!headers.length) {
    throw Object.assign(new Error('File Excel chưa có dòng tiêu đề cột hợp lệ.'), { statusCode: 422 });
  }

  const columnMap = {};
  const duplicateHeaderCheck = new Map();
  const unrecognizedHeaders = [];

  headers.forEach((h) => {
    const matchedField = resolveHeaderField(h.text);
    if (!matchedField) {
      if (h.text.trim()) unrecognizedHeaders.push(h.text.trim());
      return;
    }
    if (duplicateHeaderCheck.has(matchedField)) {
      throw Object.assign(new Error(`File Excel có các cột tiêu đề trùng lặp ý nghĩa: "${h.text}" và "${duplicateHeaderCheck.get(matchedField)}".`), { statusCode: 422 });
    }
    duplicateHeaderCheck.set(matchedField, h.text);
    columnMap[matchedField] = h.colNumber;
  });

  if (unrecognizedHeaders.length > 0) {
    throw Object.assign(new Error(`File Excel chứa cột không được nhận diện: "${unrecognizedHeaders.join(', ')}". Vui lòng tải file Excel mẫu mới nhất để sử dụng.`), { statusCode: 422 });
  }

  const missingRequiredHeaders = [];
  if (!columnMap.fullName) missingRequiredHeaders.push('Họ và tên (*)');
  if (!columnMap.birthDate) missingRequiredHeaders.push('Ngày sinh (*)');
  if (!columnMap.gender) missingRequiredHeaders.push('Giới tính (*)');
  if (isMultiClassMode && !columnMap.classNameInput) {
    missingRequiredHeaders.push('Lớp (bắt buộc khi đẩy danh sách tổng nhiều lớp)');
  }

  if (missingRequiredHeaders.length > 0) {
    throw Object.assign(new Error(`File Excel thiếu các cột bắt buộc: ${missingRequiredHeaders.join(', ')}`), { statusCode: 422 });
  }

  const parsedRows = [];
  const now = new Date();

  const readTextCol = (row, field, label, rowErrors) => {
    if (!columnMap[field]) return '';
    const extracted = extractCellStaticString(row.getCell(columnMap[field]), label);
    if (extracted.isFormula) rowErrors.push(extracted.error);
    return extracted.text;
  };

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const rowErrors = [];

    const rawClassNameInput = readTextCol(row, 'classNameInput', 'Lớp', rowErrors);
    const rawStudentCode = readTextCol(row, 'studentCode', 'Mã ID học sinh', rowErrors);
    const rawIdentityCode = readTextCol(row, 'identityCode', 'Mã định danh học sinh', rowErrors);
    const rawFullName = readTextCol(row, 'fullName', 'Họ và tên', rowErrors);

    const cellBirthDate = row.getCell(columnMap.birthDate);
    if (isFormulaCell(cellBirthDate)) {
      rowErrors.push('Ô cột "Ngày sinh" chứa công thức Excel. Vui lòng chuyển thành giá trị tĩnh.');
    }
    const rawBirthDate = cellBirthDate.value;

    const rawGender = readTextCol(row, 'gender', 'Giới tính', rowErrors);

    let rawAdmissionDate = null;
    if (columnMap.admissionDate) {
      const cellAdmission = row.getCell(columnMap.admissionDate);
      if (isFormulaCell(cellAdmission)) {
        rowErrors.push('Ô cột "Ngày nhập học" chứa công thức Excel. Vui lòng chuyển thành giá trị tĩnh.');
      }
      rawAdmissionDate = cellAdmission.value;
    }

    const rawParent1Name = readTextCol(row, 'parent1Name', 'Họ tên phụ huynh 1', rowErrors);
    const rawParent1Phone = readTextCol(row, 'parent1Phone', 'Điện thoại phụ huynh 1', rowErrors);
    const rawParent1Email = readTextCol(row, 'parent1Email', 'Hòm thư phụ huynh 1', rowErrors);
    const rawParent1Relationship = readTextCol(row, 'parent1Relationship', 'Quan hệ PH 1', rowErrors);

    const rawParent2Name = readTextCol(row, 'parent2Name', 'Họ tên phụ huynh 2', rowErrors);
    const rawParent2Phone = readTextCol(row, 'parent2Phone', 'Điện thoại phụ huynh 2', rowErrors);
    const rawParent2Email = readTextCol(row, 'parent2Email', 'Hòm thư phụ huynh 2', rowErrors);
    const rawParent2Relationship = readTextCol(row, 'parent2Relationship', 'Quan hệ PH 2', rowErrors);

    const rawAllergiesText = readTextCol(row, 'allergiesText', 'Dị ứng thực phẩm', rowErrors);
    const rawDiseaseText = readTextCol(row, 'diseaseText', 'Bệnh lý / Sức khỏe', rowErrors);
    const rawAddress = readTextCol(row, 'address', 'Địa chỉ', rowErrors);
    const rawNationality = readTextCol(row, 'nationality', 'Quốc tịch', rowErrors);
    const rawEthnicity = readTextCol(row, 'ethnicity', 'Dân tộc', rowErrors);
    const rawBirthPlace = readTextCol(row, 'birthPlace', 'Nơi sinh', rowErrors);
    const rawNotes = readTextCol(row, 'notes', 'Ghi chú', rowErrors);
    const rawHealthInsuranceCode = readTextCol(row, 'healthInsuranceCode', 'Mã thẻ BHYT', rowErrors);
    const rawBloodType = readTextCol(row, 'bloodType', 'Nhóm máu', rowErrors);

    const allEmpty = !rawClassNameInput && !rawStudentCode && !rawIdentityCode &&
      !rawFullName && !rawBirthDate && !rawGender && !rawAdmissionDate &&
      !rawParent1Name && !rawParent1Phone && !rawParent1Email &&
      !rawParent2Name && !rawParent2Phone && !rawParent2Email &&
      !rawAllergiesText && !rawDiseaseText && !rawAddress &&
      !rawNationality && !rawEthnicity && !rawBirthPlace && !rawNotes &&
      !rawHealthInsuranceCode && !rawBloodType;
    if (allEmpty) return;

    parsedRows.push({
      rowNumber,
      rawClassNameInput,
      rawStudentCode,
      rawIdentityCode,
      rawFullName,
      rawBirthDate,
      rawGender,
      rawAdmissionDate,
      rawParent1Name,
      rawParent1Phone,
      rawParent1Email,
      rawParent1Relationship,
      rawParent2Name,
      rawParent2Phone,
      rawParent2Email,
      rawParent2Relationship,
      rawAllergiesText,
      rawDiseaseText,
      rawAddress,
      rawNationality,
      rawEthnicity,
      rawBirthPlace,
      rawNotes,
      rawHealthInsuranceCode,
      rawBloodType,
      formulaErrors: rowErrors
    });
  });

  if (!parsedRows.length) {
    throw Object.assign(new Error('Tập tin Excel không có dữ liệu học sinh nào để nhập.'), { statusCode: 422 });
  }
  if (parsedRows.length > MAX_ROWS) {
    throw Object.assign(new Error(`Tập tin Excel chứa ${parsedRows.length} học sinh, vượt quá giới hạn tối đa ${MAX_ROWS} học sinh/lần import.`), { statusCode: 422 });
  }

  // Bước 1: Kiểm tra hợp lệ từng dòng, đối chiếu lớp đích và kiểm tra trùng lặp nội bộ trong file
  const validatedRows = [];
  const inMemoryDuplicates = new Map();
  const inMemoryStudentCodes = new Map();

  for (const item of parsedRows) {
    const validated = validateStudentRowStrict(item, item.rowNumber, now, is1904);
    if (item.formulaErrors?.length) {
      validated.errors.unshift(...item.formulaErrors);
      validated.isValid = false;
    }

    // Phân giải lớp đích cho từng dòng
    if (isMultiClassMode) {
      if (!validated.classNameInput) {
        validated.errors.push('Cột "Lớp" không được để trống khi đẩy danh sách tổng nhiều lớp');
        validated.isValid = false;
      } else {
        const matched = matchClassroomByInput(validated.classNameInput, availableClassrooms);
        if (matched.classroom) {
          validated.resolvedClassroomId = String(matched.classroom._id);
          validated.resolvedClassName = matched.classroom.name;
        } else {
          validated.errors.push(matched.ambiguousError || matched.notFoundError);
          validated.isValid = false;
        }
      }
    } else if (selectedClassroom) {
      if (validated.classNameInput) {
        const matchedSingle = matchClassroomByInput(validated.classNameInput, [selectedClassroom]);
        if (!matchedSingle.classroom) {
          validated.errors.push(`Cột Lớp "${validated.classNameInput}" không khớp với lớp đang chọn "${selectedClassroom.name}". Chọn chế độ "Đẩy danh sách tổng" nếu muốn nhập nhiều lớp cùng lúc`);
          validated.isValid = false;
        }
      }
      validated.resolvedClassroomId = String(selectedClassroom._id);
      validated.resolvedClassName = selectedClassroom.name;
    }

    if (validated.fullName && validated.birthDate && validated.gender) {
      const dupKey = `${validated.fullName.toLowerCase()}||${validated.birthDate}||${validated.gender}`;
      if (!inMemoryDuplicates.has(dupKey)) inMemoryDuplicates.set(dupKey, [validated.rowNumber]);
      else inMemoryDuplicates.get(dupKey).push(validated.rowNumber);
    }

    if (validated.studentCode) {
      if (!inMemoryStudentCodes.has(validated.studentCode)) inMemoryStudentCodes.set(validated.studentCode, [validated.rowNumber]);
      else inMemoryStudentCodes.get(validated.studentCode).push(validated.rowNumber);
    }

    validatedRows.push(validated);
  }

  for (const row of validatedRows) {
    if (row.fullName && row.birthDate && row.gender) {
      const dupKey = `${row.fullName.toLowerCase()}||${row.birthDate}||${row.gender}`;
      const dupRows = inMemoryDuplicates.get(dupKey) || [];
      if (dupRows.length > 1) {
        row.isValid = false;
        row.errors.push(`Trùng lặp thông tin với dòng ${dupRows.filter((r) => r !== row.rowNumber).join(', ')} trong file này`);
      }
    }
    if (row.studentCode) {
      const dupCodeRows = inMemoryStudentCodes.get(row.studentCode) || [];
      if (dupCodeRows.length > 1) {
        row.isValid = false;
        row.errors.push(`Mã ID học sinh "${row.studentCode}" bị trùng ở dòng ${dupCodeRows.filter((r) => r !== row.rowNumber).join(', ')} trong file này`);
      }
    }
  }

  // Bước 2: Đối chiếu trùng lặp với cơ sở dữ liệu theo đúng phạm vi trường (tenantId) trong 1 truy vấn duy nhất
  let teacherClassroomIds = null;
  if (user && user.role === 'teacher') {
    teacherClassroomIds = (await getTeacherClassroomIds(user, reqContext)).map(String);
  }

  const tenantFilter = reqContext ? buildTenantFilter(reqContext) : (user?.tenantId ? { tenantId: user.tenantId } : {});
  const validCandidates = validatedRows.filter((r) => r.isValid);

  if (validCandidates.length > 0) {
    const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const uniqueLowerNames = [...new Set(validCandidates.map((r) => r.fullName.toLowerCase()))];
    const manualCodes = [...new Set(validCandidates.map((r) => r.studentCode).filter(Boolean))];
    const nameRegexes = uniqueLowerNames.map((n) => new RegExp(`^${escapeRegex(n)}$`, 'i'));
    const orConditions = [{ fullName: { $in: nameRegexes } }];
    if (manualCodes.length > 0) {
      orConditions.push({ studentCode: { $in: manualCodes } });
    }

    const [existingStudents, conflictingEmployees, conflictingUsers] = await Promise.all([
      Student.find({
        ...tenantFilter,
        $or: orConditions
      }).select('fullName birthDate gender classroomId className studentCode status').lean(),
      manualCodes.length > 0
        ? Employee.find({ ...tenantFilter, employeeCode: { $in: manualCodes } }).select('employeeCode fullName').lean()
        : Promise.resolve([]),
      manualCodes.length > 0
        ? User.find({ ...tenantFilter, 'employeeInfo.employeeId': { $in: manualCodes } }).select('employeeInfo.employeeId username').lean()
        : Promise.resolve([])
    ]);

    const staffUsedCodes = new Set([
      ...conflictingEmployees.map((e) => String(e.employeeCode || '').toUpperCase()),
      ...conflictingUsers.map((u) => String(u.employeeInfo?.employeeId || '').toUpperCase())
    ]);

    for (const row of validCandidates) {
      if (row.studentCode) {
        if (staffUsedCodes.has(row.studentCode)) {
          row.isValid = false;
          row.errors.push(`Mã ID "${row.studentCode}" đã được cấp cho nhân sự trong trường. Vui lòng chọn mã khác hoặc để trống tự sinh`);
          continue;
        }
        const codeConflict = existingStudents.find((s) => String(s.studentCode || '').toUpperCase() === row.studentCode);
        if (codeConflict) {
          row.isValid = false;
          row.errors.push(`Mã ID học sinh "${row.studentCode}" đã được cấp cho học sinh "${codeConflict.fullName}"`);
          continue;
        }
      }

      const match = existingStudents.find((s) => {
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
        if (isAccessibleByTeacher || ['admin', 'principal'].includes(user?.role)) {
          row.errors.push(`Nghi trùng với học sinh "${match.fullName}" (${match.studentCode || 'Chưa có mã'}, lớp ${match.className || 'Chưa xếp lớp'})`);
          row.duplicateInfo = { studentCode: match.studentCode, fullName: match.fullName, className: match.className };
        } else {
          row.errors.push(`Nghi trùng với học sinh "${match.fullName}" đã có hồ sơ trong hệ thống nhà trường.`);
          row.duplicateInfo = { isExternal: true, fullName: match.fullName };
        }
      }
    }
  }

  const totalRows = validatedRows.length;
  const totalValid = validatedRows.filter((r) => r.isValid).length;
  const totalErrors = validatedRows.filter((r) => !r.isValid).length;
  const fingerprint = computeBatchFingerprint(classroomId, validatedRows);

  return {
    totalRows,
    totalValid,
    totalErrors,
    isMultiClassMode,
    isValid: totalErrors === 0 && totalValid > 0,
    canImport: totalErrors === 0 && totalValid > 0,
    fingerprint,
    rows: validatedRows.map((r) => ({
      rowNumber: r.rowNumber,
      classNameInput: r.classNameInput || r.resolvedClassName || '',
      resolvedClassroomId: r.resolvedClassroomId || '',
      resolvedClassName: r.resolvedClassName || '',
      studentCode: r.studentCode || '',
      identityCode: r.identityCode || '',
      fullName: r.fullName,
      birthDate: r.birthDate,
      birthDateFormatted: r.birthDate ? r.birthDate.split('-').reverse().join('/') : '',
      admissionDate: r.admissionDate || '',
      gender: r.gender,
      genderText: r.genderText,
      parent1Name: r.parent1Name || '',
      parent1Phone: r.parent1Phone || '',
      parent1Email: r.parent1Email || '',
      parent1Relationship: r.parent1Relationship || '',
      parent2Name: r.parent2Name || '',
      parent2Phone: r.parent2Phone || '',
      parent2Email: r.parent2Email || '',
      parent2Relationship: r.parent2Relationship || '',
      contactName: r.contactName || '',
      contactPhone: r.contactPhone || '',
      allergiesText: r.allergiesText || '',
      diseaseText: r.diseaseText || '',
      address: r.address,
      nationality: r.nationality,
      ethnicity: r.ethnicity,
      birthPlace: r.birthPlace,
      notes: r.notes,
      healthInsuranceCode: r.healthInsuranceCode || '',
      bloodType: r.bloodType || '',
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
  MULTI_CLASS_TARGET,
  generateTemplateWorkbook,
  parseAndValidateExcelBuffer,
  validateStudentRowStrict,
  computeBatchFingerprint,
  matchClassroomByInput,
  deriveSchoolYear
};
