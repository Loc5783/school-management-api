'use strict';

/**
 * ============================================================================
 * SAAS PHASE 1E MULTI-TENANT INDEX MIGRATION SCRIPT (SAFE & RESUMABLE)
 * ============================================================================
 * Mục đích:
 * Chuyển đổi an toàn 6 index Global Unique cản trở đa trường (Zone 4 Finance)
 * thành Compound Tenant Unique ({ tenantId, ... }) và Legacy Partial Unique ({ tenantId: null }).
 *
 * Danh mục 6 Collection xử lý:
 * 1. AccountingPeriod: { month: 1 } -> { tenantId: 1, month: 1 } + { month: 1, tenantId: null }
 * 2. DailyCashReconciliation: { workDate: 1 } -> { tenantId: 1, workDate: 1 } + { workDate: 1, tenantId: null }
 * 3. OperatingExpenseRequest: { requestKey: 1 } -> { tenantId: 1, requestKey: 1 } + { requestKey: 1, tenantId: null }
 * 4. FeeSchedule: { period: 1, classroomId: 1 } -> { tenantId: 1, period: 1, classroomId: 1 } + { period: 1, classroomId: 1, tenantId: null }
 * 5. Payment: { receiptNumber: 1 } -> { tenantId: 1, receiptNumber: 1 } + { receiptNumber: 1, tenantId: null }
 *    * Chính sách: Loại bỏ receiptNumber missing/null/empty bằng { $type: 'string', $gt: '' }.
 * 6. OperatingExpense: { documentNumber: 1 } -> { tenantId: 1, documentNumber: 1 } + { documentNumber: 1, tenantId: null }
 *
 * Nguyên tắc An toàn Tuyệt đối:
 * - Preflight toàn diện trước mutation: Kiểm tra metadata, kiểu tenantId, và trùng lặp.
 * - Quy tắc bảo vệ Zero-Downtime: Tạo index mới -> Xác minh -> Chỉ drop index cũ sau khi index mới đã bảo vệ.
 * - Rollback có chốt chặn: Nếu phát hiện xung đột toàn cầu giữa các tenant, TỪ CHỐI ROLLBACK để bảo vệ dữ liệu.
 * - Checkpoint & Idempotent: Có thể chạy lại an toàn sau partial failure.
 * ============================================================================
 */

const mongoose = require('mongoose');

const SCOPE_LIMITATIONS = {
  zone: 'Zone 4 Finance (Phase 1E)',
  coveredCollections: [
    'accountingperiods',
    'dailycashreconciliations',
    'operatingexpenserequests',
    'feeschedules',
    'payments',
    'operatingexpenses'
  ],
  outOfScopeNote: 'Script này không can thiệp các index ngoài Zone 4 (như User.username, Student.studentCode, Classroom.name). Các index đó tuân theo lộ trình của từng Phase riêng biệt.',
  operationalPrecondition: 'Khi chạy trên production, phải đảm bảo autoIndex/syncIndexes của Mongoose không được tự động chạy lại schema cũ gây xung đột.'
};

const MIGRATION_INDEX_SPECS = [
  {
    collectionName: 'accountingperiods',
    displayName: 'AccountingPeriod (Kỳ kế toán)',
    uniqueFields: ['month'],
    legacyIndex: {
      name: 'month_1',
      keys: { month: 1 },
      options: { unique: true }
    },
    targetIndexes: [
      {
        name: 'tenantId_1_month_1_unique',
        keys: { tenantId: 1, month: 1 },
        options: {
          unique: true,
          partialFilterExpression: { tenantId: { $type: 'objectId' } }
        }
      },
      {
        name: 'legacy_month_1_unique',
        keys: { month: 1 },
        options: {
          unique: true,
          partialFilterExpression: { tenantId: null }
        }
      }
    ]
  },
  {
    collectionName: 'dailycashreconciliations',
    displayName: 'DailyCashReconciliation (Đối soát tiền mặt ngày)',
    uniqueFields: ['workDate'],
    legacyIndex: {
      name: 'workDate_1',
      keys: { workDate: 1 },
      options: { unique: true }
    },
    targetIndexes: [
      {
        name: 'tenantId_1_workDate_1_unique',
        keys: { tenantId: 1, workDate: 1 },
        options: {
          unique: true,
          partialFilterExpression: { tenantId: { $type: 'objectId' } }
        }
      },
      {
        name: 'legacy_workDate_1_unique',
        keys: { workDate: 1 },
        options: {
          unique: true,
          partialFilterExpression: { tenantId: null }
        }
      }
    ]
  },
  {
    collectionName: 'operatingexpenserequests',
    displayName: 'OperatingExpenseRequest (Đề xuất chi vận hành)',
    uniqueFields: ['requestKey'],
    legacyIndex: {
      name: 'requestKey_1',
      keys: { requestKey: 1 },
      options: { unique: true }
    },
    targetIndexes: [
      {
        name: 'tenantId_1_requestKey_1_unique',
        keys: { tenantId: 1, requestKey: 1 },
        options: {
          unique: true,
          partialFilterExpression: { tenantId: { $type: 'objectId' } }
        }
      },
      {
        name: 'legacy_requestKey_1_unique',
        keys: { requestKey: 1 },
        options: {
          unique: true,
          partialFilterExpression: { tenantId: null }
        }
      }
    ]
  },
  {
    collectionName: 'feeschedules',
    displayName: 'FeeSchedule (Biểu phí mẫu theo lớp/trường)',
    uniqueFields: ['period', 'classroomId'],
    legacyIndex: {
      name: 'period_1_classroomId_1',
      keys: { period: 1, classroomId: 1 },
      options: { unique: true }
    },
    targetIndexes: [
      {
        name: 'tenantId_1_period_1_classroomId_1_unique',
        keys: { tenantId: 1, period: 1, classroomId: 1 },
        options: {
          unique: true,
          partialFilterExpression: { tenantId: { $type: 'objectId' } }
        }
      },
      {
        name: 'legacy_period_1_classroomId_1_unique',
        keys: { period: 1, classroomId: 1 },
        options: {
          unique: true,
          partialFilterExpression: { tenantId: null }
        }
      }
    ]
  },
  {
    collectionName: 'payments',
    displayName: 'Payment (Thanh toán học phí / Số biên lai)',
    uniqueFields: ['receiptNumber'],
    isOptionalCode: true,
    policyNote: 'Biên lai là mã tùy chọn. Áp dụng chính sách nghiệm thu Phase 1E: loại bỏ hoàn toàn missing, null và empty string ("", length 0).',
    legacyIndex: {
      name: 'receiptNumber_1',
      keys: { receiptNumber: 1 },
      options: { unique: true, sparse: true }
    },
    targetIndexes: [
      {
        name: 'tenantId_1_receiptNumber_1_unique',
        keys: { tenantId: 1, receiptNumber: 1 },
        options: {
          unique: true,
          partialFilterExpression: {
            tenantId: { $type: 'objectId' },
            receiptNumber: { $type: 'string', $gt: '' }
          }
        }
      },
      {
        name: 'legacy_receiptNumber_1_unique',
        keys: { receiptNumber: 1 },
        options: {
          unique: true,
          partialFilterExpression: {
            tenantId: null,
            receiptNumber: { $type: 'string', $gt: '' }
          }
        }
      }
    ]
  },
  {
    collectionName: 'operatingexpenses',
    displayName: 'OperatingExpense (Chứng từ chi vận hành)',
    uniqueFields: ['documentNumber'],
    legacyIndex: {
      name: 'documentNumber_1',
      keys: { documentNumber: 1 },
      options: { unique: true }
    },
    targetIndexes: [
      {
        name: 'tenantId_1_documentNumber_1_unique',
        keys: { tenantId: 1, documentNumber: 1 },
        options: {
          unique: true,
          partialFilterExpression: { tenantId: { $type: 'objectId' } }
        }
      },
      {
        name: 'legacy_documentNumber_1_unique',
        keys: { documentNumber: 1 },
        options: {
          unique: true,
          partialFilterExpression: { tenantId: null }
        }
      }
    ]
  }
];

/**
 * So sánh cấu trúc key và options của 2 index để phát hiện sai lệch metadata
 */
function compareIndexSpec(actual, expectedKeys, expectedOptions = {}) {
  // 1. So sánh keys
  const actualKeys = actual.key || {};
  const actualKeyStr = JSON.stringify(actualKeys);
  const expectedKeyStr = JSON.stringify(expectedKeys);
  if (actualKeyStr !== expectedKeyStr) {
    return { match: false, reason: `Sai cấu trúc keys: thực tế ${actualKeyStr} khác kỳ vọng ${expectedKeyStr}` };
  }

  // 2. So sánh unique
  const actualUnique = Boolean(actual.unique);
  const expectedUnique = Boolean(expectedOptions.unique);
  if (actualUnique !== expectedUnique) {
    return { match: false, reason: `Sai thuộc tính unique: thực tế ${actualUnique} khác kỳ vọng ${expectedUnique}` };
  }

  // 3. So sánh partialFilterExpression nếu có
  if (expectedOptions.partialFilterExpression) {
    const actualPartialStr = JSON.stringify(actual.partialFilterExpression || {});
    const expectedPartialStr = JSON.stringify(expectedOptions.partialFilterExpression);
    if (actualPartialStr !== expectedPartialStr) {
      return { match: false, reason: `Sai partialFilterExpression: thực tế ${actualPartialStr} khác kỳ vọng ${expectedPartialStr}` };
    }
  }

  return { match: true };
}

/**
 * Lấy danh sách index an toàn, phân biệt rõ lỗi collection chưa tồn tại với lỗi DB khác
 */
async function getCollectionIndexesSafe(coll) {
  try {
    return await coll.indexes();
  } catch (err) {
    // Chỉ coi là collection chưa có nếu đúng mã lỗi NamespaceNotFound / ns does not exist
    if (err.code === 26 || err.codeName === 'NamespaceNotFound' || (err.message && err.message.includes('ns does not exist'))) {
      return null;
    }
    // Mọi lỗi khác (kết nối, auth, network) phải rethrow
    throw err;
  }
}

/**
 * Preflight Check toàn diện cho một collection
 */
async function preflightCollection(coll, spec, mode) {
  const existingIndexes = await getCollectionIndexesSafe(coll);
  const issues = [];

  if (existingIndexes === null) {
    // Collection chưa tồn tại
    return {
      exists: false,
      existingIndexes: [],
      issues: []
    };
  }

  const existingMap = new Map();
  for (const idx of existingIndexes) {
    existingMap.set(idx.name, idx);
  }

  // 1. Kiểm tra metadata index trùng tên nhưng sai key/options
  // Kiểm tra legacy index
  if (existingMap.has(spec.legacyIndex.name)) {
    const actual = existingMap.get(spec.legacyIndex.name);
    const cmp = compareIndexSpec(actual, spec.legacyIndex.keys, spec.legacyIndex.options);
    if (!cmp.match) {
      issues.push(`[METADATA_MISMATCH] Index ${spec.legacyIndex.name}: ${cmp.reason}`);
    }
  }

  // Kiểm tra các target indexes
  for (const target of spec.targetIndexes) {
    if (existingMap.has(target.name)) {
      const actual = existingMap.get(target.name);
      const cmp = compareIndexSpec(actual, target.keys, target.options);
      if (!cmp.match) {
        issues.push(`[METADATA_MISMATCH] Target index ${target.name}: ${cmp.reason}`);
      }
    }
  }

  // 2. Kiểm tra dữ liệu: Sai kiểu tenantId (tenantId tồn tại nhưng không phải ObjectId và không phải null)
  try {
    const badTenantCount = await coll.countDocuments({
      tenantId: { $exists: true, $ne: null, $not: { $type: 'objectId' } }
    });
    if (badTenantCount > 0) {
      issues.push(`[INVALID_TENANT_ID_TYPE] Có ${badTenantCount} bản ghi mang tenantId không phải kiểu ObjectId/null`);
    }
  } catch (err) {
    issues.push(`[QUERY_ERROR] Lỗi kiểm tra kiểu tenantId: ${err.message}`);
  }

  // 3. Kiểm tra Duplicate Collision nội bộ tenant trước khi Apply
  if (mode === 'apply') {
    try {
      const groupFields = { tenantId: '$tenantId' };
      const matchCriteria = { tenantId: { $type: 'objectId' } };

      for (const field of spec.uniqueFields) {
        groupFields[field] = `$${field}`;
        if (spec.isOptionalCode && field === 'receiptNumber') {
          matchCriteria[field] = { $type: 'string', $gt: '' };
        }
      }

      const dupes = await coll.aggregate([
        { $match: matchCriteria },
        { $group: { _id: groupFields, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $limit: 5 }
      ]).toArray();

      if (dupes.length > 0) {
        issues.push(`[TENANT_DUPLICATE_COLLISION] Phát hiện ${dupes.length} nhóm bản ghi trùng lặp vi phạm compound unique trong cùng một tenant: ${JSON.stringify(dupes.map((d) => d._id))}`);
      }
    } catch (err) {
      issues.push(`[AGGREGATION_ERROR] Lỗi kiểm tra trùng lặp tenant: ${err.message}`);
    }
  }

  // 4. Kiểm tra Global Collision trước khi Rollback
  if (mode === 'rollback') {
    try {
      const groupFields = {};
      const matchCriteria = {};

      for (const field of spec.uniqueFields) {
        groupFields[field] = `$${field}`;
        if (spec.isOptionalCode && field === 'receiptNumber') {
          matchCriteria[field] = { $type: 'string', $gt: '' };
        }
      }

      const globalDupes = await coll.aggregate([
        { $match: matchCriteria },
        { $group: { _id: groupFields, count: { $sum: 1 }, tenants: { $addToSet: '$tenantId' } } },
        { $match: { count: { $gt: 1 } } },
        { $limit: 5 }
      ]).toArray();

      if (globalDupes.length > 0) {
        issues.push(`[ROLLBACK_BLOCKED_GLOBAL_COLLISION] Không thể rollback vì đã có ${globalDupes.length} nhóm dữ liệu trùng khóa toàn cục giữa các tenant: ${JSON.stringify(globalDupes.map((d) => ({ key: d._id, count: d.count, tenantCount: d.tenants.length })))}. Giữ nguyên index bảo vệ compound hiện tại!`);
      }
    } catch (err) {
      issues.push(`[AGGREGATION_ERROR] Lỗi kiểm tra trùng lặp toàn cục: ${err.message}`);
    }
  }

  return {
    exists: true,
    existingIndexes: existingIndexes.map((idx) => idx.name),
    issues
  };
}

/**
 * Thực thi Migration hoặc Dry-run hoặc Rollback
 */
async function runIndexMigration(db, mode = 'dry-run') {
  const allowedModes = ['dry-run', 'apply', 'rollback'];
  if (!allowedModes.includes(mode)) {
    throw new Error(`Chế độ không hợp lệ: "${mode}". Chấp nhận: ${allowedModes.join(', ')}`);
  }

  const results = {
    mode,
    scope: SCOPE_LIMITATIONS,
    timestamp: new Date().toISOString(),
    preflightPassed: true,
    checkpoint: {},
    collections: []
  };

  // =========================================================================
  // GIAI ĐOẠN 1: PREFLIGHT TOÀN BỘ CÁC COLLECTION TRƯỚC MỌI MUTATION
  // =========================================================================
  const preflightReports = new Map();
  let totalIssues = 0;

  for (const spec of MIGRATION_INDEX_SPECS) {
    const coll = db.collection(spec.collectionName);
    const preflight = await preflightCollection(coll, spec, mode);
    preflightReports.set(spec.collectionName, preflight);

    if (preflight.issues.length > 0) {
      totalIssues += preflight.issues.length;
    }
  }

  if (totalIssues > 0) {
    results.preflightPassed = false;
    for (const spec of MIGRATION_INDEX_SPECS) {
      const p = preflightReports.get(spec.collectionName);
      results.collections.push({
        collection: spec.collectionName,
        displayName: spec.displayName,
        preflightIssues: p.issues,
        actions: [`[ABORTED] Bị chặn bởi preflight check (${p.issues.length} lỗi)`]
      });
    }

    const firstIssue = Array.from(preflightReports.values())
      .flatMap((p) => p.issues)[0];
    const err = new Error(`PREFLIGHT_FAILED: Phát hiện ${totalIssues} lỗi kiểm định trước mutation. Lỗi đầu tiên: ${firstIssue}`);
    err.details = results;
    throw err;
  }

  // =========================================================================
  // GIAI ĐOẠN 2: THỰC THI (DRY-RUN / APPLY / ROLLBACK)
  // =========================================================================
  for (const spec of MIGRATION_INDEX_SPECS) {
    const coll = db.collection(spec.collectionName);
    const preflight = preflightReports.get(spec.collectionName);
    const existingNames = new Set(preflight.existingIndexes);

    const itemReport = {
      collection: spec.collectionName,
      displayName: spec.displayName,
      policyNote: spec.policyNote || null,
      existingIndexes: preflight.existingIndexes,
      actions: []
    };

    if (mode === 'dry-run') {
      // 1. Khảo sát tình trạng target indexes
      for (const target of spec.targetIndexes) {
        if (existingNames.has(target.name)) {
          itemReport.actions.push(`[EXISTS] Target index ${target.name} đã sẵn sàng`);
        } else {
          itemReport.actions.push(`[PLAN] Sẽ tạo target index: ${target.name}`);
        }
      }
      // 2. Khảo sát tình trạng drop legacy index
      if (existingNames.has(spec.legacyIndex.name)) {
        itemReport.actions.push(`[PLAN] Sẽ drop global unique index ${spec.legacyIndex.name} (chỉ sau khi target indexes được xác minh)`);
      } else {
        itemReport.actions.push(`[ALREADY_DROPPED] Global unique index ${spec.legacyIndex.name} đã được drop trước đó`);
      }
    } else if (mode === 'apply') {
      // BƯỚC 1: TẠO CÁC TARGET INDEXES TRƯỚC (ZERO-DOWNTIME PROTECTION)
      for (const target of spec.targetIndexes) {
        if (!existingNames.has(target.name)) {
          await coll.createIndex(target.keys, {
            name: target.name,
            ...target.options
          });
          itemReport.actions.push(`[CREATED] Đã tạo index mới: ${target.name}`);
        } else {
          itemReport.actions.push(`[EXISTS] Index mới ${target.name} đã tồn tại`);
        }
      }

      // BƯỚC 2: XÁC MINH TARGET INDEXES ĐÃ HOẠT ĐỘNG
      const verifyIndexes = await coll.indexes();
      const verifyNames = new Set(verifyIndexes.map((idx) => idx.name));
      for (const target of spec.targetIndexes) {
        if (!verifyNames.has(target.name)) {
          throw new Error(`VERIFICATION_FAILED: Index mới ${target.name} không tìm thấy sau khi tạo! Dừng khẩn cấp, KHÔNG drop index cũ.`);
        }
      }
      itemReport.actions.push('[VERIFIED] Đã xác minh tất cả target compound index active và bảo vệ toàn vẹn dữ liệu');

      // BƯỚC 3: CHỈ DROP GLOBAL INDEX CŨ SAU KHI INDEX MỚI ĐÃ SẴN SÀNG
      if (verifyNames.has(spec.legacyIndex.name)) {
        await coll.dropIndex(spec.legacyIndex.name);
        itemReport.actions.push(`[DROPPED] Đã drop an toàn global index: ${spec.legacyIndex.name}`);
      } else {
        itemReport.actions.push(`[SKIP] Global index ${spec.legacyIndex.name} không còn tồn tại`);
      }

      results.checkpoint[spec.collectionName] = 'applied';
    } else if (mode === 'rollback') {
      // BƯỚC 1: TẠO LẠI GLOBAL INDEX CŨ TRƯỚC
      const currentIndexes = await coll.indexes();
      const currentNames = new Set(currentIndexes.map((idx) => idx.name));

      if (!currentNames.has(spec.legacyIndex.name)) {
        await coll.createIndex(spec.legacyIndex.keys, {
          name: spec.legacyIndex.name,
          ...spec.legacyIndex.options
        });
        itemReport.actions.push(`[RESTORED] Đã khôi phục thành công global unique index: ${spec.legacyIndex.name}`);
      } else {
        itemReport.actions.push(`[EXISTS] Global unique index ${spec.legacyIndex.name} đã tồn tại`);
      }

      // BƯỚC 2: XÁC MINH GLOBAL INDEX ĐÃ HOẠT ĐỘNG
      const verifyRollback = await coll.indexes();
      const rollbackNames = new Set(verifyRollback.map((idx) => idx.name));
      if (!rollbackNames.has(spec.legacyIndex.name)) {
        throw new Error(`ROLLBACK_VERIFICATION_FAILED: Không thể xác minh global index ${spec.legacyIndex.name} sau khi tạo lại! Dừng khẩn cấp, KHÔNG drop target indexes.`);
      }
      itemReport.actions.push(`[VERIFIED] Global unique index ${spec.legacyIndex.name} đã active`);

      // BƯỚC 3: DROP CÁC TARGET INDEXES
      for (const target of spec.targetIndexes) {
        if (rollbackNames.has(target.name)) {
          await coll.dropIndex(target.name);
          itemReport.actions.push(`[DROPPED] Đã dọn dẹp target index: ${target.name}`);
        }
      }

      results.checkpoint[spec.collectionName] = 'rolled_back';
    }

    results.collections.push(itemReport);
  }

  return results;
}

// CLI runner
if (require.main === module) {
  const args = process.argv.slice(2);
  let mode = 'dry-run';
  if (args.includes('--apply')) mode = 'apply';
  else if (args.includes('--rollback')) mode = 'rollback';

  const mongoUri = process.env.MIGRATION_MONGO_URI;
  if (!mongoUri) {
    console.error('LỖI BẢO MẬT: Biến môi trường MIGRATION_MONGO_URI chưa được thiết lập.');
    console.error('Ví dụ chạy đúng:');
    console.error('  $env:MIGRATION_MONGO_URI = "<TARGET_MONGO_URI>"');
    console.error('  node backend/scripts/saas_phase1e_index_migration.js --dry-run');
    process.exit(1);
  }

  (async () => {
    try {
      console.log(`=== BẮT ĐẦU CHẠY MIGRATION INDEX (Chế độ: ${mode.toUpperCase()}) ===`);
      console.log(`Phạm vi: ${SCOPE_LIMITATIONS.zone}`);
      console.log(`Collections: ${SCOPE_LIMITATIONS.coveredCollections.join(', ')}`);
      console.log(`Lưu ý: ${SCOPE_LIMITATIONS.outOfScopeNote}\n`);

      const conn = await mongoose.connect(mongoUri);
      const db = conn.connection.db;

      const report = await runIndexMigration(db, mode);
      console.log(JSON.stringify(report, null, 2));

      await mongoose.disconnect();
      console.log('\n=== THỰC THI MIGRATION HOÀN TẤT THÀNH CÔNG ===');
      process.exit(0);
    } catch (err) {
      console.error('\nLỖI THỰC THI MIGRATION:', err.message);
      if (err.details) {
        console.error('Chi tiết Preflight / Checkpoint:', JSON.stringify(err.details, null, 2));
      }
      process.exit(1);
    }
  })();
}

module.exports = {
  SCOPE_LIMITATIONS,
  MIGRATION_INDEX_SPECS,
  compareIndexSpec,
  preflightCollection,
  runIndexMigration
};
