'use strict';

/**
 * @fileoverview Entrypoint khởi động máy chủ Backend (`npm start` / `npm run dev`).
 * Mặc định khởi chạy ứng dụng chuẩn SaaS Multi-Tenant (`phase1e`) trên toàn mạng LAN (`0.0.0.0:5001`),
 * hỗ trợ đăng nhập theo mã trường (`HOANANG-A`, `HOANANG-B`) cũng như nhận Webhook máy chấm công Hikvision.
 */

require('./src/config/loadEnv');

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const mongoose = require('mongoose');
const connectDB = require('./src/config/database');
const createLegacyApp = require('./app');
const assembleSaasApp = require('./src/saas/assembleSaasApp');
const { ensureDefaultAdminAccount } = require('./src/services/defaultAdminBootstrapService');
const { ensureMultiTenantIndexes } = require('./src/services/multiTenantIndexService');
const { resolveFrontendDistPath } = require('./src/utils/staticFrontendMiddleware');
const { startTimekeepingSync } = require('./src/services/timekeepingSyncService');
const { startGuardAlertReminders } = require('./src/services/guardAlertReminderService');
const { startCredentialReminders } = require('./src/services/credentialReminderService');
const { startStaffHandoverScheduler } = require('./src/services/staffHandoverService');

// Tránh tự động ghi đè compound unique index khi khởi động tiến trình web
mongoose.set('autoIndex', false);

const PORT = Number(process.env.PORT || 5001);
const HOST = process.env.HOST || '0.0.0.0';
const useLegacyApp = process.env.USE_LEGACY_APP === 'true';
const schedulerEnabled = process.env.TIMEKEEPING_SCHEDULER_ENABLED === 'true';

/**
 * Tìm địa chỉ IPv4 mạng LAN nội bộ để hiển thị thuận tiện khi khởi chạy server.
 *
 * @returns {string | null}
 */
const resolveLanIp = () => {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const iface of entries || []) {
      if (iface.family === 'IPv4' && !iface.internal && iface.address.startsWith('192.168.')) {
        return iface.address;
      }
    }
  }
  return null;
};

/**
 * Tự động kiểm tra và biên dịch lại `frontend/dist` khi chạy trực tiếp ngoài Docker (`node server.js` / PM2)
 * nếu mã nguồn `frontend/src` vừa được cập nhật mới hơn bản build `frontend/dist/index.html` (VD: sau khi `git pull`).
 * Giúp máy chủ không bao giờ phục vụ nhầm giao diện cũ.
 */
const getLatestMtimeMs = (dirPath) => {
  let latest = 0;
  if (!fs.existsSync(dirPath)) return latest;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const subLatest = getLatestMtimeMs(fullPath);
      if (subLatest > latest) latest = subLatest;
    } else {
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs > latest) latest = stat.mtimeMs;
    }
  }
  return latest;
};

const ensureFreshFrontendBuild = () => {
  if (
    process.env.RUNNING_IN_DOCKER === 'true'
    || process.env.NODE_ENV === 'test'
    || process.env.SERVE_FRONTEND === 'false'
    || process.env.AUTO_BUILD_FRONTEND === 'false'
  ) {
    return;
  }

  const frontendDir = path.resolve(__dirname, '../frontend');
  const frontendPkg = path.join(frontendDir, 'package.json');
  const frontendSrc = path.join(frontendDir, 'src');
  const distIndex = path.join(frontendDir, 'dist', 'index.html');

  if (!fs.existsSync(frontendPkg) || !fs.existsSync(frontendSrc)) {
    return;
  }

  const distMtime = fs.existsSync(distIndex) ? fs.statSync(distIndex).mtimeMs : 0;
  const srcMtime = getLatestMtimeMs(frontendSrc);

  if (!distMtime || srcMtime > distMtime) {
    try {
      console.log('🔄 Phát hiện giao diện Frontend vừa cập nhật mới — đang tự động build lại frontend/dist...');
      execSync('npm run build', { cwd: frontendDir, stdio: 'inherit' });
      console.log('✅ Đã đồng bộ bản build giao diện Frontend mới nhất.');
    } catch (err) {
      console.warn('⚠️ Không thể tự động build lại Frontend (tiếp tục dùng bản hiện có):', err.message);
    }
  }
};

const startServer = async () => {
  ensureFreshFrontendBuild();
  await connectDB();
  if (!useLegacyApp && process.env.ENSURE_SAAS_INDEXES !== 'false') {
    await ensureMultiTenantIndexes(mongoose.connection.db).catch((err) => {
      console.warn('⚠️ [Bootstrap Indexes] Không thể đồng bộ một số index phụ:', err.message);
    });
  }
  await ensureDefaultAdminAccount({ useLegacyApp });

  const app = useLegacyApp
    ? createLegacyApp()
    : assembleSaasApp({ saasMode: process.env.SAAS_MODE || 'phase1e' });

  const lanIp = resolveLanIp();
  const activeFrontendDist = resolveFrontendDistPath();

  const httpServer = app.listen(PORT, HOST, () => {
    console.log(`🚀 Server (${useLegacyApp ? 'Legacy' : 'SaaS Multi-Tenant'}) đang chạy:`);
    console.log(`   ➜ Local  : http://localhost:${PORT}`);
    console.log(`   ➜ Swagger: http://localhost:${PORT}/api-docs`);
    if (lanIp) {
      console.log(`   ➜ LAN    : http://${lanIp}:${PORT}`);
      console.log(`   ➜ Webhook: http://${lanIp}:${PORT}/api/attendance/webhook`);
    }
    if (activeFrontendDist) {
      console.log(`   ➜ Web UI : Đang phục vụ trực tiếp bản Production Frontend tại http://localhost:${PORT}`);
    } else {
      console.log('   ℹ️  Chưa có bản build Frontend (chạy "npm run build:frontend" nếu muốn chạy gộp cả Web trên Backend)');
    }

    if (schedulerEnabled) {
      startTimekeepingSync();
    } else {
      console.log('ℹ️  Timekeeping pull-scheduler đang tắt (TIMEKEEPING_SCHEDULER_ENABLED=false)');
    }

    if (process.env.BACKGROUND_REMINDERS_ENABLED === 'true') {
      startGuardAlertReminders();
      startCredentialReminders();
      startStaffHandoverScheduler();
    }
  });

  // NOTE: Đóng kết nối HTTP và MongoDB an toàn khi nhận tín hiệu dừng từ Docker (SIGTERM/SIGINT)
  let isShuttingDown = false;
  const gracefulShutdown = (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n🛑 Nhận tín hiệu ${signal}, đang đóng máy chủ và kết nối MongoDB an toàn...`);

    httpServer.close(async () => {
      try {
        await mongoose.connection.close(false);
        console.log('✅ Đã đóng kết nối hoàn tất.');
        process.exit(0);
      } catch (err) {
        console.error('❌ Lỗi khi đóng kết nối MongoDB:', err.message);
        process.exit(1);
      }
    });

    // Bảo vệ tránh treo tiến trình nếu có kết nối keep-alive chưa giải phóng kịp
    setTimeout(() => {
      console.warn('⚠️ Quá thời gian chờ đóng kết nối, buộc thoát tiến trình.');
      process.exit(1);
    }, 8000).unref();
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    console.error('⚠️ [UnhandledRejection] Bắt giữ lỗi bất đồng bộ ngoài luồng request:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('❌ [UncaughtException] Lỗi nghiêm trọng cấp tiến trình:', err);
    gracefulShutdown('uncaughtException');
  });
};

startServer().catch((err) => {
  console.error('❌ Không thể khởi động máy chủ Backend:', err);
  process.exit(1);
});
