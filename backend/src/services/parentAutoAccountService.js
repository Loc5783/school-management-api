'use strict';

/**
 * @fileoverview Dịch vụ tự động khởi tạo & liên kết Tài khoản Phụ huynh (`User` với `role: 'parent'`)
 * từ thông tin Phụ huynh 1 & Phụ huynh 2 trong hồ sơ học sinh hoặc file Excel nhập hàng loạt.
 *
 * Quy tắc nghiệp vụ thực tế:
 * - Tên đăng nhập = Số điện thoại chuẩn hóa (ví dụ `0901234567`).
 * - Mật khẩu mặc định lần đầu = `123456` (chỉ áp dụng khi tạo mới; tuyệt đối không ghi đè mật khẩu nếu tài khoản đã tồn tại).
 * - Nếu cả Phụ huynh 1 (Bố) và Phụ huynh 2 (Mẹ) đều có số điện thoại riêng hợp lệ, hệ thống tạo/gắn cho cả 2 tài khoản.
 * - Nếu nhiều anh/chị/em ruột dùng chung số điện thoại Bố/Mẹ, hệ thống tự động gom chung (`$addToSet`) vào cùng 1 tài khoản Phụ huynh.
 * - Đồng thời tự động điền Bố/Mẹ vào danh sách `authorizedPickers` để buổi chiều cô giáo có thể bấm trả trẻ ngay.
 */

const bcrypt = require('bcryptjs');
const User = require('../models/zone1_system/User');

const DEFAULT_PARENT_PASSWORD = process.env.DEFAULT_PARENT_PASSWORD || '123456';
const BCRYPT_SALT_ROUNDS = 10;
const PHONE_ACCOUNT_REGEX = /^0\d{9,10}$/;

const RELATIONSHIP_LABEL = {
  father: 'Bố',
  mother: 'Mẹ',
  guardian: 'Người giám hộ'
};

/**
 * Chuẩn hóa số điện thoại Việt Nam về dạng `0xxxxxxxxx` để dùng thống nhất làm `username`.
 *
 * @param {string} rawPhone
 * @returns {string} Chuỗi SĐT hợp lệ hoặc `''` nếu không đủ chuẩn làm tài khoản
 */
const normalizeParentPhoneUsername = (rawPhone) => {
  if (!rawPhone) return '';
  let cleaned = String(rawPhone).replace(/[.\s()-]/g, '').trim();
  if (cleaned.startsWith('+84')) {
    cleaned = `0${cleaned.slice(3)}`;
  } else if (cleaned.startsWith('84') && cleaned.length >= 11) {
    cleaned = `0${cleaned.slice(2)}`;
  } else if (/^[35789]\d{8}$/.test(cleaned)) {
    // Khôi phục số 0 đầu khi cột SĐT trong Excel định dạng Number làm mất số 0 (VD: 912345678 -> 0912345678)
    cleaned = `0${cleaned}`;
  }
  return PHONE_ACCOUNT_REGEX.test(cleaned) ? cleaned : '';
};

/**
 * Đồng bộ danh sách Phụ huynh 1 & 2 sang `authorizedPickers` (người được phép đón trẻ)
 * nếu người đó chưa có mặt trong danh sách đón trẻ.
 *
 * @param {Array<Object>} parents
 * @param {Array<Object>} existingPickers
 * @returns {Array<Object>}
 */
const buildAuthorizedPickersFromParents = (parents = [], existingPickers = []) => {
  const result = Array.isArray(existingPickers) ? [...existingPickers] : [];
  if (!Array.isArray(parents) || !parents.length) return result;

  for (const parent of parents) {
    const fullName = String(parent?.fullName || '').trim();
    const phone = normalizeParentPhoneUsername(parent?.phone) || String(parent?.phone || '').trim();
    if (!fullName) continue;

    const alreadyExists = result.some((p) => {
      const pPhone = normalizeParentPhoneUsername(p?.phone) || String(p?.phone || '').trim();
      if (phone && pPhone && phone === pPhone) return true;
      return String(p?.fullName || '').trim().toLowerCase() === fullName.toLowerCase();
    });

    if (!alreadyExists) {
      result.push({
        fullName,
        phone,
        relationship: RELATIONSHIP_LABEL[parent.relationship] || parent.relationship || 'Phụ huynh',
        isActive: true
      });
    }
  }

  return result.slice(0, 10);
};

/**
 * Tự động tạo mới hoặc gắn bổ sung học sinh vào tài khoản Phụ huynh theo SĐT (hỗ trợ xử lý lô lớn không N+1).
 *
 * @param {Object} params
 * @param {Array<Object>} params.students - Danh sách hồ sơ học sinh vừa lưu (có `_id` và `parents`)
 * @param {import('mongoose').Types.ObjectId|null} [params.tenantId=null] - Ngữ cảnh trường học Multi-Tenant
 * @param {import('mongoose').ClientSession|null} [params.session=null] - Phiên giao dịch MongoDB
 * @returns {Promise<{ createdCount: number, linkedCount: number }>}
 */
const syncParentAccountsForStudents = async ({ students = [], tenantId = null, session = null }) => {
  if (!Array.isArray(students) || students.length === 0) {
    return { createdCount: 0, linkedCount: 0 };
  }

  // Bước 1: Gom nhóm toàn bộ SĐT phụ huynh hợp lệ -> tập hợp studentIds của các con
  const parentByPhone = new Map();
  for (const student of students) {
    if (!student?._id || !Array.isArray(student.parents)) continue;
    for (const parent of student.parents) {
      const phoneUsername = normalizeParentPhoneUsername(parent?.phone);
      const fullName = String(parent?.fullName || '').trim();
      if (!phoneUsername || !fullName) continue;

      if (!parentByPhone.has(phoneUsername)) {
        parentByPhone.set(phoneUsername, {
          username: phoneUsername,
          fullName,
          phone: phoneUsername,
          email: String(parent?.email || '').trim().toLowerCase(),
          studentIds: new Map()
        });
      }
      const entry = parentByPhone.get(phoneUsername);
      entry.studentIds.set(String(student._id), student._id);
      if (!entry.email && parent?.email) {
        entry.email = String(parent.email).trim().toLowerCase();
      }
    }
  }

  if (parentByPhone.size === 0) {
    return { createdCount: 0, linkedCount: 0 };
  }

  // Bước 2: Truy vấn 1 lần duy nhất toàn bộ tài khoản trùng SĐT trong cùng trường (tenantId)
  const tenantCondition = tenantId ? { tenantId } : { tenantId: { $in: [null, undefined] } };
  const allUsernames = [...parentByPhone.keys()];
  const existingUsers = await User.find({
    ...tenantCondition,
    username: { $in: allUsernames }
  })
    .select('_id username role status parentInfo tenantId')
    .session(session)
    .lean();

  const existingByUsername = new Map(existingUsers.map((u) => [u.username, u]));

  let needsNewPasswordHash = false;
  for (const phone of allUsernames) {
    if (!existingByUsername.has(phone)) {
      needsNewPasswordHash = true;
      break;
    }
  }

  // Chỉ băm mật khẩu mặc định đúng 1 lần cho cả lô hàng trăm học sinh để đạt tốc độ tối đa
  const defaultPasswordHash = needsNewPasswordHash
    ? await bcrypt.hash(DEFAULT_PARENT_PASSWORD, BCRYPT_SALT_ROUNDS)
    : null;

  // Bước 3: Lập danh sách bulkWrite tạo mới hoặc gắn thêm con vào tài khoản phụ huynh hiện có
  const bulkOps = [];
  let createdCount = 0;
  let linkedCount = 0;

  for (const [phone, info] of parentByPhone.entries()) {
    const studentObjectIds = [...info.studentIds.values()];
    const existing = existingByUsername.get(phone);

    if (existing) {
      // Nếu SĐT đang được dùng làm username của nhân sự nội bộ -> bỏ qua để bảo vệ phân quyền nhân sự
      if (existing.role !== 'parent') continue;

      const updateDoc = {
        $addToSet: {
          'parentInfo.studentIds': { $each: studentObjectIds }
        }
      };
      if (existing.status === 'inactive') {
        updateDoc.$set = { status: 'active' };
      }

      bulkOps.push({
        updateOne: {
          filter: { _id: existing._id },
          update: updateDoc
        }
      });
      linkedCount += 1;
    } else {
      bulkOps.push({
        insertOne: {
          document: {
            tenantId: tenantId || null,
            username: phone,
            passwordHash: defaultPasswordHash,
            role: 'parent',
            permissions: [],
            profile: {
              fullName: info.fullName,
              phone: info.phone,
              email: info.email || ''
            },
            parentInfo: {
              studentIds: studentObjectIds,
              requestedClassroomId: null,
              registrationNote: 'Tự động khởi tạo từ hồ sơ học sinh'
            },
            status: 'active',
            authVersion: 0
          }
        }
      });
      createdCount += 1;
    }
  }

  if (bulkOps.length > 0) {
    try {
      await User.bulkWrite(bulkOps, { ...(session ? { session } : {}), ordered: false });
    } catch (err) {
      // Bắt xung đột E11000 nếu 2 yêu cầu song song cùng tạo mới 1 SĐT phụ huynh tại cùng thời điểm
      if (err.code === 11000 || (Array.isArray(err.writeErrors) && err.writeErrors.every((e) => e.code === 11000))) {
        for (const [phone, info] of parentByPhone.entries()) {
          const studentObjectIds = [...info.studentIds.values()];
          await User.updateOne(
            { ...tenantCondition, username: phone, role: 'parent' },
            { $addToSet: { 'parentInfo.studentIds': { $each: studentObjectIds } } },
            session ? { session } : undefined
          );
        }
      } else {
        throw err;
      }
    }
  }

  return { createdCount, linkedCount };
};

module.exports = {
  DEFAULT_PARENT_PASSWORD,
  normalizeParentPhoneUsername,
  buildAuthorizedPickersFromParents,
  syncParentAccountsForStudents
};

