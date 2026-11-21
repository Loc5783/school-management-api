'use strict';

/**
 * ============================================================================
 * TEST SUITE: SAAS PHASE 1E MULTI-TENANT INDEX MIGRATION REHEARSAL (EXPANDED)
 * ============================================================================
 * Kiểm thử toàn diện các kịch bản an toàn của migration index:
 * 1. Khởi tạo index ban đầu & chứng minh xung đột global unique cản trở đa trường.
 * 2. Preflight phát hiện metadata sai cùng tên.
 * 3. Preflight phát hiện sai kiểu tenantId (string/number thay vì ObjectId/null).
 * 4. Preflight phát hiện duplicate collision nội bộ tenant.
 * 5. Dry-run lập kế hoạch chính xác không sửa đổi database.
 * 6. Apply an toàn: tạo index mới trước -> xác minh -> drop index cũ.
 * 7. Kiểm chứng 2 trường cùng kỳ, cùng ngày, cùng mã hoạt động trơn tru.
 * 8. Bảo toàn dữ liệu legacy missing và null.
 * 9. Bảo toàn optional receiptNumber (cho phép null, missing, empty string; chỉ unique khi có giá trị).
 * 10. Rollback Guard: Có dữ liệu collision giữa các trường -> TỪ CHỐI ROLLBACK và BẢO TOÀN INDEX MỚI.
 * 11. Idempotent & Resumable: Chạy lại apply nhiều lần an toàn, không lỗi.
 * ============================================================================
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
  MIGRATION_INDEX_SPECS,
  runIndexMigration
} = require('../../scripts/saas_phase1e_index_migration');

describe('SaaS Phase 1E Index Migration Rehearsal (Expanded Security & Edge Cases)', () => {
  let mongoServer;
  let connection;
  let db;

  const tenantAId = new mongoose.Types.ObjectId();
  const tenantBId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    connection = await mongoose.createConnection(uri).asPromise();
    db = connection.db;
  });

  afterAll(async () => {
    if (connection) {
      await connection.close();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  test('TC1: Khởi tạo các index Global Unique ban đầu & chứng minh xung đột đa trường', async () => {
    for (const spec of MIGRATION_INDEX_SPECS) {
      const coll = db.collection(spec.collectionName);
      await coll.createIndex(spec.legacyIndex.keys, {
        name: spec.legacyIndex.name,
        ...spec.legacyIndex.options
      });
      const indexes = await coll.indexes();
      const names = indexes.map((i) => i.name);
      expect(names).toContain(spec.legacyIndex.name);
    }

    const periodColl = db.collection('accountingperiods');
    await periodColl.insertOne({
      tenantId: tenantAId,
      month: '2026-11',
      status: 'open',
      createdAt: new Date()
    });

    // Tenant B insert cùng tháng '2026-11' -> BỊ CHẶN BỞI E11000
    let periodError = null;
    try {
      await periodColl.insertOne({
        tenantId: tenantBId,
        month: '2026-11',
        status: 'open',
        createdAt: new Date()
      });
    } catch (err) {
      periodError = err;
    }
    expect(periodError).toBeDefined();
    expect(periodError.code).toBe(11000);

    // Dọn bản ghi thử nghiệm để kiểm tra preflight tiếp theo
    await periodColl.deleteMany({});
  });

  test('TC2: Preflight phát hiện metadata sai cùng tên (cùng tên month_1 nhưng sai keys)', async () => {
    const periodColl = db.collection('accountingperiods');
    // Drop index đúng và tạo index giả mạo cùng tên 'month_1' nhưng sai key { month: -1 }
    await periodColl.dropIndex('month_1');
    await periodColl.createIndex({ month: -1 }, { name: 'month_1', unique: false });

    let preflightError = null;
    try {
      await runIndexMigration(db, 'apply');
    } catch (err) {
      preflightError = err;
    }

    expect(preflightError).toBeDefined();
    expect(preflightError.message).toContain('PREFLIGHT_FAILED');
    expect(preflightError.message).toContain('METADATA_MISMATCH');

    // Khôi phục lại index đúng
    await periodColl.dropIndex('month_1');
    await periodColl.createIndex({ month: 1 }, { name: 'month_1', unique: true });
  });

  test('TC3: Preflight phát hiện sai kiểu tenantId (string thay vì ObjectId)', async () => {
    const periodColl = db.collection('accountingperiods');
    await periodColl.insertOne({
      tenantId: 'invalid_string_tenant_id', // SAI KIỂU
      month: '2026-11',
      status: 'open'
    });

    let preflightError = null;
    try {
      await runIndexMigration(db, 'apply');
    } catch (err) {
      preflightError = err;
    }

    expect(preflightError).toBeDefined();
    expect(preflightError.message).toContain('INVALID_TENANT_ID_TYPE');

    // Dọn bản ghi sai kiểu
    await periodColl.deleteMany({});
  });

  test('TC4: Preflight phát hiện duplicate collision nội bộ trong cùng một tenant', async () => {
    const periodColl = db.collection('accountingperiods');
    // Tạm thời drop global unique để chèn 2 bản ghi trùng trong cùng Tenant A
    await periodColl.dropIndex('month_1');
    await periodColl.insertMany([
      { tenantId: tenantAId, month: '2026-11', status: 'open' },
      { tenantId: tenantAId, month: '2026-11', status: 'closed' } // Trùng nội bộ Tenant A
    ]);

    let preflightError = null;
    try {
      await runIndexMigration(db, 'apply');
    } catch (err) {
      preflightError = err;
    }

    expect(preflightError).toBeDefined();
    expect(preflightError.message).toContain('TENANT_DUPLICATE_COLLISION');

    // Dọn và tạo lại index ban đầu
    await periodColl.deleteMany({});
    await periodColl.createIndex({ month: 1 }, { name: 'month_1', unique: true });
  });

  test('TC5: Dry-run khảo sát kế hoạch mà KHÔNG thay đổi database', async () => {
    const report = await runIndexMigration(db, 'dry-run');
    expect(report.mode).toBe('dry-run');
    expect(report.preflightPassed).toBe(true);
    expect(report.collections).toHaveLength(6);

    for (const item of report.collections) {
      const planActions = item.actions.filter((a) => a.startsWith('[PLAN]'));
      expect(planActions.length).toBeGreaterThanOrEqual(1);
    }
  });

  test('TC6: Apply Migration an toàn (Zero-Downtime: Tạo mới -> Xác minh -> Drop cũ)', async () => {
    const report = await runIndexMigration(db, 'apply');
    expect(report.mode).toBe('apply');
    expect(report.preflightPassed).toBe(true);

    for (const spec of MIGRATION_INDEX_SPECS) {
      const coll = db.collection(spec.collectionName);
      const indexes = await coll.indexes();
      const names = indexes.map((i) => i.name);

      // Global legacy index đã được drop an toàn
      expect(names).not.toContain(spec.legacyIndex.name);

      // Các target compound index và legacy index phải đã được tạo và active
      for (const target of spec.targetIndexes) {
        expect(names).toContain(target.name);
      }
    }
  });

  test('TC7: Kiểm chứng sau migration: 2 trường cùng kỳ, cùng ngày, cùng mã thành công 100%', async () => {
    const periodColl = db.collection('accountingperiods');
    const scheduleColl = db.collection('feeschedules');
    const reconColl = db.collection('dailycashreconciliations');
    const paymentColl = db.collection('payments');
    const expenseColl = db.collection('operatingexpenses');

    // 1. Cùng tháng '2026-11'
    await periodColl.insertOne({ tenantId: tenantAId, month: '2026-11', status: 'open' });
    await periodColl.insertOne({ tenantId: tenantBId, month: '2026-11', status: 'open' });

    // 2. Cùng kỳ '11-2026', mức chung toàn trường (classroomId: null)
    await scheduleColl.insertOne({ tenantId: tenantAId, period: '11-2026', classroomId: null, tuitionBase: 4000000 });
    await scheduleColl.insertOne({ tenantId: tenantBId, period: '11-2026', classroomId: null, tuitionBase: 5000000 });

    // 3. Cùng ngày đối soát '2026-11-09'
    await reconColl.insertOne({ tenantId: tenantAId, workDate: '2026-11-09', closingBalance: 1000000 });
    await reconColl.insertOne({ tenantId: tenantBId, workDate: '2026-11-09', closingBalance: 2000000 });

    // 4. Cùng số biên lai 'BL-2026-001'
    await paymentColl.insertOne({ tenantId: tenantAId, receiptNumber: 'BL-2026-001', amount: 500000 });
    await paymentColl.insertOne({ tenantId: tenantBId, receiptNumber: 'BL-2026-001', amount: 800000 });

    // 5. Cùng số chứng từ chi 'PC-2026-001'
    await expenseColl.insertOne({ tenantId: tenantAId, documentNumber: 'PC-2026-001', amount: 300000 });
    await expenseColl.insertOne({ tenantId: tenantBId, documentNumber: 'PC-2026-001', amount: 400000 });

    // Khẳng định cả 2 trường đều đã ghi nhận dữ liệu
    expect(await periodColl.countDocuments({ month: '2026-11' })).toBe(2);
    expect(await scheduleColl.countDocuments({ period: '11-2026', classroomId: null })).toBe(2);
    expect(await paymentColl.countDocuments({ receiptNumber: 'BL-2026-001' })).toBe(2);
  });

  test('TC8: Bảo toàn tính duy nhất của dữ liệu Legacy (tenantId: null và tenantId missing)', async () => {
    const periodColl = db.collection('accountingperiods');

    // Bản ghi legacy đầu tiên (tenantId: null)
    await periodColl.insertOne({ tenantId: null, month: '2026-12', status: 'open' });

    // Bản ghi legacy thứ hai (missing tenantId) cùng tháng '2026-12' -> BỊ CHẶN BỞI LEGACY INDEX
    let legacyError = null;
    try {
      await periodColl.insertOne({ month: '2026-12', status: 'open' }); // missing tenantId
    } catch (err) {
      legacyError = err;
    }
    expect(legacyError).toBeDefined();
    expect(legacyError.code).toBe(11000);
  });

  test('TC9: Chính sách optional receiptNumber: cho phép nhiều bản ghi null/missing/empty string', async () => {
    const paymentColl = db.collection('payments');

    // Cùng Tenant A, nhiều khoản thanh toán không có số biên lai (null, missing, chuỗi rỗng)
    const p1 = await paymentColl.insertOne({ tenantId: tenantAId, receiptNumber: null, amount: 100000 });
    const p2 = await paymentColl.insertOne({ tenantId: tenantAId, amount: 200000 }); // missing receiptNumber
    const p3 = await paymentColl.insertOne({ tenantId: tenantAId, receiptNumber: '', amount: 300000 }); // empty string

    expect(p1.insertedId).toBeDefined();
    expect(p2.insertedId).toBeDefined();
    expect(p3.insertedId).toBeDefined();

    // Nhưng nếu có giá trị string thực tế thì phải duy nhất trong nội bộ Tenant A
    let dupError = null;
    try {
      await paymentColl.insertOne({ tenantId: tenantAId, receiptNumber: 'BL-2026-001', amount: 999999 });
    } catch (err) {
      dupError = err;
    }
    expect(dupError).toBeDefined();
    expect(dupError.code).toBe(11000);
  });

  test('TC10: Rollback Guard: Có dữ liệu collision đa trường -> TỪ CHỐI ROLLBACK & GIỮ NGUYÊN TARGET INDEXES', async () => {
    // Database hiện tại đang có dữ liệu của cả Tenant A và Tenant B cùng tháng '2026-11' (từ TC7).
    // Tuyệt đối KHÔNG xóa dữ liệu này đi!
    // Thực thi lệnh rollback: Hệ thống PHẢI TỪ CHỐI ROLLBACK để bảo vệ dữ liệu!

    let rollbackError = null;
    try {
      await runIndexMigration(db, 'rollback');
    } catch (err) {
      rollbackError = err;
    }

    expect(rollbackError).toBeDefined();
    expect(rollbackError.message).toContain('PREFLIGHT_FAILED');
    expect(rollbackError.message).toContain('ROLLBACK_BLOCKED_GLOBAL_COLLISION');

    // Xác minh TARGET COMPOUND INDEXES VẪN CÒN NGUYÊN VẸN, KHÔNG BỊ MẤT
    const periodColl = db.collection('accountingperiods');
    const indexesAfterRejectedRollback = await periodColl.indexes();
    const names = indexesAfterRejectedRollback.map((i) => i.name);

    expect(names).toContain('tenantId_1_month_1_unique');
    expect(names).toContain('legacy_month_1_unique');
    expect(names).not.toContain('month_1');
  });

  test('TC11: Tính Idempotent và Resumable: Chạy lại Apply nhiều lần an toàn, không lỗi', async () => {
    // Chạy lại apply một lần nữa khi các index đã được tạo
    const rerunReport = await runIndexMigration(db, 'apply');
    expect(rerunReport.mode).toBe('apply');
    expect(rerunReport.preflightPassed).toBe(true);

    for (const item of rerunReport.collections) {
      const existsActions = item.actions.filter((a) => a.startsWith('[EXISTS]'));
      expect(existsActions.length).toBeGreaterThanOrEqual(1);
    }
  });
});
