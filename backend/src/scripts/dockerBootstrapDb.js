'use strict';

/**
 * @fileoverview Kịch bản khởi tạo an toàn (Idempotent DB Bootstrap) khi khởi chạy container Backend trong Docker.
 *
 * Nhiệm vụ chính:
 * 1. Đảm bảo các index cốt lõi của hệ thống SaaS Multi-Tenant (`Tenant`, `Permission`, `User` và 23 nhóm
 *    compound unique index `{ tenantId: 1, <field>: 1 }`) luôn tồn tại đầy đủ trên MongoDB mới,
 *    đồng thời tương thích an toàn với DB cũ đã có sẵn index cùng cặp khóa (không văng lỗi `IndexOptionsConflict`).
 * 2. Tự động tạo tài khoản `admin` (`123456`) nếu kiểm tra thấy DB chưa có tài khoản admin nào;
 *    hoặc chạy `seedDemoFull.js` nếu bật `AUTO_SEED_ON_EMPTY_DB=true` trên DB trắng.
 */

require('../config/loadEnv');

const path = require('path');
const { execFileSync } = require('child_process');
const mongoose = require('mongoose');
const connectDB = require('../config/database');

const Tenant = require('../models/zone1_system/Tenant');
const Permission = require('../models/zone1_system/Permission');
const User = require('../models/zone1_system/User');
const { ensureDefaultAdminAccount } = require('../services/defaultAdminBootstrapService');

mongoose.set('autoIndex', false);

// Danh sách 23 nhóm Compound Multi-Tenant Unique Index chuẩn kiến trúc SaaS Phase 1E
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
    specs: [
      { name: 'tenantId_1_documentNumber_1_unique', keys: { tenantId: 1, documentNumber: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_documentNumber_1_unique', keys: { documentNumber: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
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

/**
 * So sánh 2 object khóa index (VD: `{ tenantId: 1, code: 1 }`) có trùng khớp thứ tự và chiều sắp xếp hay không.
 *
 * @param {Record<string, unknown>} keyA
 * @param {Record<string, unknown>} keyB
 * @returns {boolean}
 */
const isSameIndexKeys = (keyA, keyB) => {
  const entriesA = Object.entries(keyA || {});
  const entriesB = Object.entries(keyB || {});
  if (entriesA.length !== entriesB.length) return false;
  return entriesA.every(([k, v], idx) => entriesB[idx][0] === k && entriesB[idx][1] === v);
};

/**
 * Đảm bảo toàn bộ compound unique index đa trường đã tồn tại an toàn trên cả DB mới lẫn DB đã có dữ liệu.
 *
 * @param {import('mongoose').mongo.Db} db
 */
const ensureMultiTenantIndexes = async (db) => {
  // Bước 1: Tạo các index hệ thống nền tảng (bỏ qua nếu đã có index tương đương khác tên)
  await Promise.all([
    Tenant.createIndexes().catch(() => {}),
    Permission.createIndexes().catch(() => {}),
    User.createIndexes().catch(() => {})
  ]);

  // Bước 2: Đảm bảo 23 nhóm compound unique index phân tách dữ liệu giữa các trường
  for (const group of MULTI_TENANT_INDEX_GROUPS) {
    const collection = db.collection(group.col);
    const existingIndexes = await collection.indexes().catch(() => []);

    for (const spec of group.specs) {
      const alreadyCovered = existingIndexes.some(
        (idx) => idx.name === spec.name || (Boolean(idx.unique) === Boolean(spec.options?.unique) && isSameIndexKeys(idx.key, spec.keys))
      );
      if (alreadyCovered) {
        continue;
      }

      try {
        await collection.createIndex(spec.keys, { name: spec.name, ...spec.options });
      } catch (err) {
        // Bỏ qua an toàn nếu DB có sẵn đã tạo index tương đương dưới tên/options khác (code 85, 86)
        if (err && (err.code === 85 || err.code === 86)) {
          continue;
        }
        console.warn(`⚠️ [Docker Bootstrap] Bỏ qua tạo index ${spec.name} trên ${group.col}: ${err.message}`);
      }
    }

    // Gỡ index unique toàn cục cũ nếu vô tình tồn tại để không chặn trường thứ 2 tạo cùng mã
    if (existingIndexes.some((idx) => idx.name === group.legacyGlobalIndex)) {
      await collection.dropIndex(group.legacyGlobalIndex).catch(() => {});
    }
  }
};

/**
 * Chạy quy trình khởi tạo cơ sở dữ liệu khi container bắt đầu.
 */
const runBootstrap = async () => {
  const conn = await connectDB();
  let shouldRunDemoSeed = false;

  try {
    if (process.env.ENSURE_SAAS_INDEXES !== 'false') {
      await ensureMultiTenantIndexes(conn.db);
      console.log('✅ [Docker Bootstrap] Đã kiểm tra & đồng bộ các Multi-Tenant Compound Indexes.');
    }

    if (process.env.AUTO_SEED_ON_EMPTY_DB === 'true') {
      const tenantCount = await Tenant.countDocuments({});
      if (tenantCount === 0) {
        shouldRunDemoSeed = true;
      } else {
        console.log(`ℹ️  [Docker Bootstrap] Đã có ${tenantCount} cơ sở trường học trong DB, giữ nguyên dữ liệu hiện có.`);
      }
    }

    // Nếu không chạy seed dữ liệu mẫu đầy đủ, tự động đảm bảo có ít nhất 1 tài khoản admin mặc định (admin / 123456)
    if (!shouldRunDemoSeed) {
      await ensureDefaultAdminAccount({ useLegacyApp: process.env.USE_LEGACY_APP === 'true' });
    }
  } finally {
    await mongoose.disconnect();
  }

  // Bước 3: Chạy seedDemoFull ở tiến trình con độc lập nếu DB hoàn toàn trống và bật cờ AUTO_SEED_ON_EMPTY_DB
  if (shouldRunDemoSeed) {
    console.log('🌱 [Docker Bootstrap] Phát hiện DB mới chưa có dữ liệu — đang khởi tạo dữ liệu mẫu (HOANANG-A & HOANANG-B)...');
    const seedScriptPath = path.join(__dirname, 'seedDemoFull.js');
    execFileSync(process.execPath, [seedScriptPath], { stdio: 'inherit', env: process.env });
  }
};

runBootstrap().catch((err) => {
  console.error('❌ [Docker Bootstrap] Lỗi khởi tạo cơ sở dữ liệu:', err);
  process.exit(1);
});
