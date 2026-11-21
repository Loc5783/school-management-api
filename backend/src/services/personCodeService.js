'use strict';

/**
 * @fileoverview Service cấp phát và kiểm tra tính duy nhất của Mã định danh cá nhân (dùng chung 1 dãy số `1, 2, 3...`
 * cho cả Nhân viên và Học sinh trong phạm vi từng cơ sở trường học `tenantId`).
 *
 * Lý do thiết kế:
 * - Trên máy chấm công Hikvision của mỗi trường, mỗi người (dù là giáo viên, nhân viên hay học sinh) đều dùng
 *   chung một trường `employeeNoString` dạng số nguyên dương (`1`, `2`, `3`...).
 * - Việc dùng chung 1 dãy số duy nhất và kiểm tra chống trùng chéo giữa `Employee`, `User` và `Student` đảm bảo
 *   khi quét khuôn mặt/vân tay/thẻ, hệ thống nhận diện chính xác 100% mà không bao giờ xảy ra xung đột mã.
 */

const mongoose = require('mongoose');
const StudentCodeCounter = require('../models/zone3_school/StudentCodeCounter');

// Sử dụng year = 0 trong bảng StudentCodeCounter làm bộ đếm dãy số chung toàn trường
const UNIFIED_PERSON_SEQUENCE_BUCKET = 0;
const VALID_PERSON_CODE_REGEX = /^[A-Z0-9_-]{1,30}$/;

/**
 * Tạo đối tượng lỗi kèm mã HTTP chuẩn.
 *
 * @param {string} message
 * @param {number} statusCode
 * @returns {Error}
 */
const createCodeError = (message, statusCode = 422) => Object.assign(new Error(message), { statusCode });

/**
 * Chuẩn hóa mã định danh:
 * - Nếu là chuỗi thuần chữ số (VD: `"01"`, `"2"`): chuẩn hóa về số nguyên dương không có số `0` thừa ở đầu (`"1"`, `"2"`).
 * - Vẫn chấp nhận chuỗi chữ-số hợp lệ để bảo toàn tương thích ngược với dữ liệu/bộ kiểm thử cũ.
 *
 * @param {string | number} rawCode
 * @returns {string}
 */
const normalizePersonCode = (rawCode) => {
  const trimmed = String(rawCode ?? '').trim().toUpperCase();
  if (!trimmed) return '';

  if (/^\d+$/.test(trimmed)) {
    const num = Number.parseInt(trimmed, 10);
    if (!Number.isSafeInteger(num) || num <= 0) {
      throw createCodeError('Mã số định danh phải là số nguyên dương lớn hơn 0 (ví dụ: 1, 2, 3...)', 422);
    }
    return String(num);
  }

  if (!VALID_PERSON_CODE_REGEX.test(trimmed)) {
    throw createCodeError('Mã định danh chỉ được chứa số hoặc chữ cái không dấu (tối đa 30 ký tự)', 422);
  }

  return trimmed;
};

/**
 * Xây dựng bộ lọc `tenantId` chuẩn SaaS Multi-Tenant.
 *
 * @param {import('mongoose').Types.ObjectId | string | null} tenantId
 * @returns {Record<string, any>}
 */
const buildScopeFilter = (tenantId) => (tenantId ? { tenantId } : { tenantId: { $in: [null, undefined] } });

/**
 * Kiểm tra mã định danh chưa bị bất kỳ Nhân viên, Tài khoản hay Học sinh nào khác trong cùng trường sử dụng.
 *
 * @param {object} params
 * @param {string | number} params.code
 * @param {import('mongoose').Types.ObjectId | string | null} [params.tenantId=null]
 * @param {import('mongoose').Types.ObjectId | string | null} [params.excludeEmployeeId=null]
 * @param {import('mongoose').Types.ObjectId | string | null} [params.excludeUserId=null]
 * @param {import('mongoose').Types.ObjectId | string | null} [params.excludeStudentId=null]
 * @param {import('mongoose').ClientSession | null} [params.session=null]
 * @returns {Promise<string>} Mã đã chuẩn hóa nếu hợp lệ và chưa bị trùng
 */
const assertPersonCodeAvailable = async ({
  code,
  tenantId = null,
  excludeEmployeeId = null,
  excludeUserId = null,
  excludeStudentId = null,
  session = null
}) => {
  const cleanCode = normalizePersonCode(code);
  if (!cleanCode) {
    throw createCodeError('Vui lòng nhập mã định danh hợp lệ', 422);
  }

  const Employee = mongoose.model('Employee');
  const User = mongoose.model('User');
  const Student = mongoose.model('Student');
  const scope = buildScopeFilter(tenantId);

  const empFilter = { ...scope, employeeCode: cleanCode };
  if (excludeEmployeeId) empFilter._id = { $ne: excludeEmployeeId };

  const userFilter = { ...scope, 'employeeInfo.employeeId': cleanCode };
  if (excludeUserId) userFilter._id = { $ne: excludeUserId };

  const stuFilter = { ...scope, studentCode: cleanCode };
  if (excludeStudentId) stuFilter._id = { $ne: excludeStudentId };

  const [conflictEmp, conflictUser, conflictStu] = await Promise.all([
    Employee.findOne(empFilter).select('fullName').session(session || null).lean(),
    User.findOne(userFilter).select('username profile.fullName').session(session || null).lean(),
    Student.findOne(stuFilter).select('fullName').session(session || null).lean()
  ]);

  if (conflictEmp) {
    throw createCodeError(
      `Mã "${cleanCode}" đã được cấp cho nhân viên "${conflictEmp.fullName}". Nhân viên và học sinh dùng chung dãy mã trên máy chấm công nên không được trùng nhau.`,
      409
    );
  }
  if (conflictUser) {
    const name = conflictUser.profile?.fullName || conflictUser.username;
    throw createCodeError(
      `Mã "${cleanCode}" đã được gắn với tài khoản nhân sự "${name}". Vui lòng chọn mã số khác.`,
      409
    );
  }
  if (conflictStu) {
    throw createCodeError(
      `Mã "${cleanCode}" đã được cấp cho học sinh "${conflictStu.fullName}". Nhân viên và học sinh dùng chung dãy mã trên máy chấm công nên không được trùng nhau.`,
      409
    );
  }

  return cleanCode;
};

/**
 * Tìm số nguyên dương lớn nhất hiện có trên cả 3 bảng `Employee`, `User`, `Student` của trường
 * để đồng bộ lại bộ đếm khi có người từng nhập tay một mã số lớn hơn bộ đếm hiện tại.
 *
 * @param {import('mongoose').Types.ObjectId | string | null} tenantId
 * @param {import('mongoose').ClientSession | null} session
 * @returns {Promise<number>}
 */
const findCurrentMaxNumericCode = async (tenantId, session = null) => {
  const Employee = mongoose.model('Employee');
  const User = mongoose.model('User');
  const Student = mongoose.model('Student');
  const scope = buildScopeFilter(tenantId);

  const [emps, users, students] = await Promise.all([
    Employee.find({ ...scope, employeeCode: /^\d+$/ }).select('employeeCode').session(session || null).lean(),
    User.find({ ...scope, 'employeeInfo.employeeId': /^\d+$/ }).select('employeeInfo.employeeId').session(session || null).lean(),
    Student.find({ ...scope, studentCode: /^\d+$/ }).select('studentCode').session(session || null).lean()
  ]);

  let maxVal = 0;
  for (const item of emps) {
    const n = Number.parseInt(item.employeeCode, 10);
    if (Number.isSafeInteger(n) && n > maxVal) maxVal = n;
  }
  for (const item of users) {
    const n = Number.parseInt(item.employeeInfo?.employeeId, 10);
    if (Number.isSafeInteger(n) && n > maxVal) maxVal = n;
  }
  for (const item of students) {
    const n = Number.parseInt(item.studentCode, 10);
    if (Number.isSafeInteger(n) && n > maxVal) maxVal = n;
  }
  return maxVal;
};

/**
 * Sinh tự động mã số nguyên tiếp theo (`"1"`, `"2"`, `"3"`...) dùng chung cho cả Nhân viên và Học sinh trong cùng trường.
 *
 * @param {object} [params]
 * @param {import('mongoose').Types.ObjectId | string | null} [params.tenantId=null]
 * @param {import('mongoose').ClientSession | null} [params.session=null]
 * @returns {Promise<string>}
 */
const generateNextPersonCode = async ({ tenantId = null, session = null } = {}) => {
  const counterFilter = {
    tenantId: tenantId || null,
    year: UNIFIED_PERSON_SEQUENCE_BUCKET
  };

  // Tăng nguyên tử bộ đếm của trường
  let counter = await StudentCodeCounter.findOneAndUpdate(
    counterFilter,
    {
      $inc: { sequence: 1 },
      $setOnInsert: { tenantId: tenantId || null, year: UNIFIED_PERSON_SEQUENCE_BUCKET }
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, session }
  );

  let candidate = String(counter.sequence);

  // Kiểm tra nếu candidate vô tình đụng phải mã số đã được nhập thủ công từ trước thì nhảy vượt lên max + 1
  try {
    await assertPersonCodeAvailable({ code: candidate, tenantId, session });
    return candidate;
  } catch (err) {
    if (err.statusCode !== 409) throw err;

    const currentMax = await findCurrentMaxNumericCode(tenantId, session);
    const nextSafe = Math.max(counter.sequence, currentMax) + 1;
    counter = await StudentCodeCounter.findOneAndUpdate(
      counterFilter,
      { $max: { sequence: nextSafe } },
      { upsert: true, returnDocument: 'after', session }
    );
    return String(counter.sequence);
  }
};

module.exports = {
  UNIFIED_PERSON_SEQUENCE_BUCKET,
  normalizePersonCode,
  assertPersonCodeAvailable,
  generateNextPersonCode
};

