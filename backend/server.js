'use strict';

/**
 * @fileoverview Entrypoint khởi động máy chủ Backend (`npm start` / `npm run dev`).
 * Mặc định khởi chạy ứng dụng chuẩn SaaS Multi-Tenant (`phase1e`) trên toàn mạng LAN (`0.0.0.0:5000`),
 * hỗ trợ đăng nhập theo mã trường (`HOANANG-A`, `HOANANG-B`) cũng như nhận Webhook máy chấm công Hikvision.
 */

require('./src/config/loadEnv');

const os = require('os');
const mongoose = require('mongoose');
const connectDB = require('./src/config/database');
const createLegacyApp = require('./app');
const assembleSaasApp = require('./src/saas/assembleSaasApp');
const { ensureDefaultAdminAccount } = require('./src/services/defaultAdminBootstrapService');
const { resolveFrontendDistPath } = require('./src/utils/staticFrontendMiddleware');
const { startTimekeepingSync } = require('./src/services/timekeepingSyncService');
const { startGuardAlertReminders } = require('./src/services/guardAlertReminderService');
const { startCredentialReminders } = require('./src/services/credentialReminderService');
const { startStaffHandoverScheduler } = require('./src/services/staffHandoverService');

// Tránh tự động ghi đè compound unique index khi khởi động tiến trình web
mongoose.set('autoIndex', false);

const PORT = Number(process.env.PORT || 5000);
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

const startServer = async () => {
  await connectDB();
  await ensureDefaultAdminAccount({ useLegacyApp });

  const app = useLegacyApp
    ? createLegacyApp()
    : assembleSaasApp({ saasMode: process.env.SAAS_MODE || 'phase1e' });

  const lanIp = resolveLanIp();
  const activeFrontendDist = resolveFrontendDistPath();

  const httpServer = app.listen(PORT, HOST, () => {
    console.log(`🚀 Server (${useLegacyApp ? 'Legacy' : 'SaaS Multi-Tenant'}) đang chạy:`);
    console.log(`   ➜ Local  : http://localhost:${PORT}`);
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
};

startServer();
