'use strict';

/**
 * @fileoverview Dịch vụ đồng bộ an toàn các Compound Unique Index đa trường (`{ tenantId: 1, <field>: 1 }`).
 *
 * Lý do kiến trúc:
 * - Được dùng chung cho cả tiến trình khởi động trực tiếp (`backend/server.js`) lẫn Docker (`dockerBootstrapDb.js`),
 *   đảm bảo khi triển khai trên máy chủ thật nhiều trường học có thể cùng hoạt động trong cùng kỳ kế toán,
 *   cùng ngày đối soát sổ quỹ, cùng mã phòng ban/nhân sự/học sinh mà không bao giờ xung đột khóa toàn cục cũ.
 * - Hoàn toàn Idempotent: chạy lặp lại nhiều lần không sinh lỗi `IndexOptionsConflict` (code 85/86).
 */

const Tenant = require('../models/zone1_system/Tenant');
const Permission = require('../models/zone1_system/Permission');
const User = require('../models/zone1_system/User');

// Danh sách đầy đủ các nhóm Compound Multi-Tenant Unique Index toàn hệ thống
const MULTI_TENANT_INDEX_GROUPS = [
  {
    col: 'accountingperiods',
    legacyGlobalIndex: 'month_1',
    specs: [
      { name: 'tenantId_1_month_1_unique', keys: { tenantId: 1, month: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_month_1_unique', keys: { month: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'dailycashreconciliations',
    legacyGlobalIndex: 'workDate_1',
    specs: [
      { name: 'tenantId_1_workDate_1_unique', keys: { tenantId: 1, workDate: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_workDate_1_unique', keys: { workDate: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'operatingexpenserequests',
    legacyGlobalIndex: 'requestKey_1',
    specs: [
      { name: 'tenantId_1_requestKey_1_unique', keys: { tenantId: 1, requestKey: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_requestKey_1_unique', keys: { requestKey: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'feeschedules',
    legacyGlobalIndex: 'period_1_classroomId_1',
    specs: [
      { name: 'tenantId_1_period_1_classroomId_1_unique', keys: { tenantId: 1, period: 1, classroomId: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_period_1_classroomId_1_unique', keys: { period: 1, classroomId: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'payments',
    legacyGlobalIndex: 'receiptNumber_1',
    specs: [
      { name: 'tenantId_1_receiptNumber_1_unique', keys: { tenantId: 1, receiptNumber: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' }, receiptNumber: { $type: 'string', $gt: '' } } } },
      { name: 'legacy_receiptNumber_1_unique', keys: { receiptNumber: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null, receiptNumber: { $type: 'string', $gt: '' } } } }
    ]
  },
  {
    col: 'operatingexpenses',
    legacyGlobalIndex: 'documentNumber_1',
    extraDropIndexes: ['idempotencyKey_1', 'transactionRef_1'],
    specs: [
      { name: 'tenantId_1_documentNumber_1_unique', keys: { tenantId: 1, documentNumber: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_documentNumber_1_unique', keys: { documentNumber: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } },
      { name: 'tenantId_1_idempotencyKey_1_unique', keys: { tenantId: 1, idempotencyKey: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_idempotencyKey_1_unique', keys: { idempotencyKey: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } },
      { name: 'tenantId_1_transactionRef_1_unique', keys: { tenantId: 1, transactionRef: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' }, transactionRef: { $type: 'string', $gt: '' } } } }
    ]
  },
  {
    col: 'purchaseexpenses',
    legacyGlobalIndex: 'transactionRef_1',
    specs: [
      { name: 'tenantId_1_transactionRef_1_unique', keys: { tenantId: 1, transactionRef: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' }, transactionRef: { $type: 'string', $gt: '' } } } }
    ]
  },
  {
    col: 'importidempotencies',
    legacyGlobalIndex: 'idempotencyKey_1',
    specs: [
      { name: 'tenantId_1_idempotencyKey_1_unique', keys: { tenantId: 1, idempotencyKey: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_idempotencyKey_1_unique', keys: { idempotencyKey: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'principaltasks',
    legacyGlobalIndex: 'deduplicationKey_1',
    specs: [
      { name: 'tenantId_1_deduplicationKey_1_unique', keys: { tenantId: 1, deduplicationKey: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' }, deduplicationKey: { $type: 'string', $gt: '' } } } }
    ]
  },
  {
    col: 'departments',
    legacyGlobalIndex: 'code_1',
    specs: [
      { name: 'tenantId_1_code_1_unique', keys: { tenantId: 1, code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_code_1_unique', keys: { code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'employees',
    legacyGlobalIndex: 'employeeCode_1',
    specs: [
      { name: 'tenantId_1_employeeCode_1_unique', keys: { tenantId: 1, employeeCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_employeeCode_1_unique', keys: { employeeCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'classrooms',
    legacyGlobalIndex: 'schoolYear_1_homeroomTeacherId_1',
    specs: [
      { name: 'tenantId_1_schoolYear_1_homeroomTeacherId_1_unique', keys: { tenantId: 1, schoolYear: 1, homeroomTeacherId: 1 }, options: { unique: true, partialFilterExpression: { status: 'active', homeroomTeacherId: { $type: 'objectId' }, tenantId: { $type: 'objectId' } } } }
    ]
  },
  {
    col: 'students',
    legacyGlobalIndex: 'studentCode_1',
    specs: [
      { name: 'tenantId_1_studentCode_1_unique', keys: { tenantId: 1, studentCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_studentCode_1_unique', keys: { studentCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'suppliers',
    legacyGlobalIndex: 'code_1',
    specs: [
      { name: 'tenantId_1_code_1_unique', keys: { tenantId: 1, code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_code_1_unique', keys: { code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'ingredientmasters',
    legacyGlobalIndex: 'code_1',
    specs: [
      { name: 'tenantId_1_code_1_unique', keys: { tenantId: 1, code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_code_1_unique', keys: { code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'kitchenstaffs',
    legacyGlobalIndex: 'staffCode_1',
    specs: [
      { name: 'tenantId_1_staffCode_1_unique', keys: { tenantId: 1, staffCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_staffCode_1_unique', keys: { staffCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'foodsamples',
    legacyGlobalIndex: 'sampleCode_1',
    specs: [
      { name: 'tenantId_1_sampleCode_1_unique', keys: { tenantId: 1, sampleCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_sampleCode_1_unique', keys: { sampleCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'kitchenequipments',
    legacyGlobalIndex: 'code_1',
    specs: [
      { name: 'tenantId_1_code_1_unique', keys: { tenantId: 1, code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_code_1_unique', keys: { code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'kitchenrequests',
    legacyGlobalIndex: 'requestCode_1',
    specs: [
      { name: 'tenantId_1_requestCode_1_unique', keys: { tenantId: 1, requestCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_requestCode_1_unique', keys: { requestCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'pickuprecords',
    legacyGlobalIndex: 'pickupCode_1',
    specs: [
      { name: 'tenantId_1_pickupCode_1_unique', keys: { tenantId: 1, pickupCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_pickupCode_1_unique', keys: { pickupCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'purchaseorders',
    legacyGlobalIndex: 'orderCode_1',
    specs: [
      { name: 'tenantId_1_orderCode_1_unique', keys: { tenantId: 1, orderCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_orderCode_1_unique', keys: { orderCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'kitchendayclosings',
    legacyGlobalIndex: 'dateKey_1',
    specs: [
      { name: 'tenantId_1_dateKey_1_unique', keys: { tenantId: 1, dateKey: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_dateKey_1_unique', keys: { dateKey: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'studentcodecounters',
    legacyGlobalIndex: 'year_1',
    specs: [
      { name: 'tenantId_1_year_1_unique', keys: { tenantId: 1, year: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_year_1_unique', keys: { year: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'evaluationperiods',
    legacyGlobalIndex: 'code_1',
    specs: [
      { name: 'tenantId_1_code_1_unique', keys: { tenantId: 1, code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_code_1_unique', keys: { code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'guardemergencymodes',
    legacyGlobalIndex: 'activeKey_1',
    specs: [
      { name: 'tenantId_1_activeKey_1_unique', keys: { tenantId: 1, activeKey: 1 }, options: { unique: true, partialFilterExpression: { status: 'active', tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_activeKey_1_unique', keys: { activeKey: 1 }, options: { unique: true, partialFilterExpression: { status: 'active', tenantId: null } } }
    ]
  },
  {
    col: 'internalannouncements',
    legacyGlobalIndex: 'requestId_1',
    specs: [
      { name: 'tenantId_1_requestId_1_unique', keys: { tenantId: 1, requestId: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_requestId_1_unique', keys: { requestId: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  }
];

const isSameIndexKeys = (keyA, keyB) => {
  const entriesA = Object.entries(keyA || {});
  const entriesB = Object.entries(keyB || {});
  if (entriesA.length !== entriesB.length) return false;
  return entriesA.every(([k, v], idx) => entriesB[idx][0] === k && entriesB[idx][1] === v);
};

// Nhóm Index phục vụ truy vấn đọc tần suất cao (Dashboard, Điểm danh, Học phí, Bếp ăn, Nhật ký)
const PERFORMANCE_READ_INDEXES = [
  { col: 'systemsettings', name: 'key_1_unique', keys: { key: 1 }, options: { unique: true } },
  { col: 'studentattendances', name: 'perf_tenant_dateKey_1', keys: { tenantId: 1, attendanceDateKey: 1 } },
  { col: 'studentattendances', name: 'perf_tenant_attendDate_class_1', keys: { tenantId: 1, attendDate: -1, classroomId: 1 } },
  { col: 'attendancerecords', name: 'perf_tenant_workDate_user_1', keys: { tenantId: 1, workDate: -1, userId: 1 } },
  { col: 'tuitionfees', name: 'perf_tenant_period_status_1', keys: { tenantId: 1, period: -1, status: 1 } },
  { col: 'tuitionfees', name: 'perf_tenant_student_status_1', keys: { tenantId: 1, studentId: 1, status: 1 } },
  { col: 'students', name: 'perf_tenant_status_class_1', keys: { tenantId: 1, status: 1, classroomId: 1 } },
  { col: 'classrooms', name: 'perf_tenant_status_campus_1', keys: { tenantId: 1, status: 1, campus: 1 } },
  { col: 'employees', name: 'perf_tenant_status_1', keys: { tenantId: 1, status: 1 } },
  { col: 'foodsamples', name: 'perf_tenant_mealDate_status_1', keys: { tenantId: 1, mealDate: -1, status: 1 } },
  { col: 'platformauditlogs', name: 'perf_createdAt_desc_1', keys: { createdAt: -1 } }
];

/**
 * Đảm bảo toàn bộ compound unique index đa trường đã tồn tại an toàn trên cả DB mới lẫn DB đã có dữ liệu.
 *
 * @param {import('mongoose').mongo.Db} db
 */
const ensureMultiTenantIndexes = async (db) => {
  if (!db) return;

  await Promise.all([
    Tenant.createIndexes().catch(() => {}),
    Permission.createIndexes().catch(() => {}),
    User.createIndexes().catch(() => {})
  ]);

  for (const group of MULTI_TENANT_INDEX_GROUPS) {
    const collection = db.collection(group.col);
    const existingIndexes = await collection.indexes().catch(() => []);

    for (const spec of group.specs) {
      const alreadyCovered = existingIndexes.some(
        (idx) =>
          idx.name === spec.name ||
          (Boolean(idx.unique) === Boolean(spec.options?.unique) && isSameIndexKeys(idx.key, spec.keys))
      );
      if (alreadyCovered) {
        continue;
      }

      try {
        await collection.createIndex(spec.keys, { name: spec.name, ...spec.options });
      } catch (err) {
        if (err && (err.code === 85 || err.code === 86)) {
          continue;
        }
        console.warn(`⚠️ [MultiTenantIndex] Bỏ qua tạo index ${spec.name} trên ${group.col}: ${err.message}`);
      }
    }

    const legacyNamesToDrop = [group.legacyGlobalIndex, ...(group.extraDropIndexes || [])].filter(Boolean);
    for (const oldName of legacyNamesToDrop) {
      if (existingIndexes.some((idx) => idx.name === oldName)) {
        await collection.dropIndex(oldName).catch(() => {});
      }
    }
  }

  for (const perfIdx of PERFORMANCE_READ_INDEXES) {
    try {
      const collection = db.collection(perfIdx.col);
      await collection.createIndex(perfIdx.keys, { name: perfIdx.name, ...(perfIdx.options || {}) });
    } catch {
      // Bỏ qua nếu index tương đương đã tồn tại dưới tên khác
    }
  }
};

module.exports = {
  MULTI_TENANT_INDEX_GROUPS,
  ensureMultiTenantIndexes
};

