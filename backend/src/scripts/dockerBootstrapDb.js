'use strict';

/**
 * @fileoverview Kịch bản khởi tạo an toàn (Idempotent DB Bootstrap) khi khởi chạy container Backend trong Docker.
 */

require('../config/loadEnv');

const path = require('path');
const { execFileSync } = require('child_process');
const mongoose = require('mongoose');
const connectDB = require('../config/database');

const Tenant = require('../models/zone1_system/Tenant');
const { ensureDefaultAdminAccount } = require('../services/defaultAdminBootstrapService');
const { ensureMultiTenantIndexes } = require('../services/multiTenantIndexService');

mongoose.set('autoIndex', false);

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

    if (!shouldRunDemoSeed) {
      await ensureDefaultAdminAccount({ useLegacyApp: process.env.USE_LEGACY_APP === 'true' });
    }
  } finally {
    await mongoose.disconnect();
  }

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
