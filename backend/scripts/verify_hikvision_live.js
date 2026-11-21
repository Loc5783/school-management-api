'use strict';

/**
 * Script: verify_hikvision_live.js
 * 
 * Mục đích: Kiểm chứng trực tiếp thiết bị máy chấm công thực tế Hikvision DS-K1T320MX tại IP 192.168.1.8.
 * Chế độ: READ-ONLY (Chỉ đọc deviceInfo và sự kiện, tuyệt đối không ghi dữ liệu hoặc sửa cấu hình).
 * 
 * QUY TẮC AN TOÀN TUYỆT ĐỐI:
 * - Thiết bị mục tiêu duy nhất: 192.168.1.8
 * - TUYỆT ĐỐI KHÔNG gọi, cấu hình hoặc quét IP 192.168.1.22
 * - Nếu không có thông tin credentials trong file môi trường, trả về trạng thái NOT_RUN_MISSING_SECRET.
 */

const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from backend/.env if exists
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const hikvisionIsapiService = require('../src/services/hikvisionIsapiService');

async function runLiveVerification() {
  console.log('===============================================================');
  console.log(' KIỂM CHỨNG TRỰC TIẾP THIẾT BỊ HIKVISION DS-K1T320MX (192.168.1.8) ');
  console.log('===============================================================');

  const targetHost = '192.168.1.8';
  const targetHttpsPort = 443;
  const credentialPrefix = 'HIKVISION_HOANANG_A';

  const username = process.env[`${credentialPrefix}_USERNAME`] || process.env.HIKVISION_USERNAME;
  const password = process.env[`${credentialPrefix}_PASSWORD`] || process.env.HIKVISION_PASSWORD;

  console.log(`[1] Kiểm tra cấu hình an toàn & Boundary IP:`);
  console.log(`    - IP Thiết bị mục tiêu: ${targetHost}:${targetHttpsPort} (HOANANG-A)`);
  console.log(`    - Danh sách IP cấm: 192.168.1.22 (Bảo vệ cứng trong mã nguồn)`);
  
  // Verify safety guard
  try {
    hikvisionIsapiService.validateDeviceHost('192.168.1.22');
    console.error('    [FAIL FATAL] Guard không chặn 192.168.1.22!');
    process.exit(1);
  } catch (err) {
    console.log(`    [PASS SAFETY] Xác nhận IP 192.168.1.22 bị chặn tuyệt đối: ${err.message}`);
  }

  // Check credentials
  console.log(`\n[2] Kiểm tra thông tin bảo mật môi trường:`);
  if (!username || !password) {
    console.log(`    [TRẠNG THÁI]: NOT_RUN_MISSING_SECRET`);
    console.log(`    - Biến môi trường ${credentialPrefix}_USERNAME hoặc PASSWORD chưa được cung cấp.`);
    console.log(`    - Hệ thống đã chuẩn bị sẵn sàng toàn bộ luồng ISAPI Digest Auth và SaaS Multi-Tenant.`);
    console.log(`    - Khi triển khai thực tế trên máy trường, người quản trị chỉ cần bổ sung vào file .env:`);
    console.log(`        HIKVISION_HOANANG_A_USERNAME=<username>`);
    console.log(`        HIKVISION_HOANANG_A_PASSWORD=<password>`);
    console.log('===============================================================');
    return {
      status: 'NOT_RUN_MISSING_SECRET',
      targetHost,
      message: 'Thiếu credentials trong biến môi trường'
    };
  }

  console.log(`    - Đã phát hiện thông tin xác thực cho ${credentialPrefix} (Username: ${username})`);
  console.log(`\n[3] Thực hiện kiểm tra kết nối Read-Only tới thiết bị ${targetHost}...`);

  const deviceConfig = {
    host: targetHost,
    httpsPort: targetHttpsPort,
    useHttps: true,
    allowSelfSigned: true,
    timeoutMs: 5000,
    username,
    password
  };

  try {
    // 1. Get Device Info
    console.log('    - Đang gọi GET /ISAPI/System/deviceInfo (Digest Authentication)...');
    const deviceInfo = await hikvisionIsapiService.getDeviceInfo(deviceConfig);
    console.log('    [THÀNH CÔNG] Thông tin thiết bị phản hồi từ máy thật:');
    console.log(`      + Tên thiết bị: ${deviceInfo.deviceName || '(Trống)'}`);
      console.log(`      + Model: ${deviceInfo.model}`);
    console.log(`      + Số Serial: ${deviceInfo.serialNumber}`);
    console.log(`      + Phiên bản Firmware: ${deviceInfo.firmwareVersion}`);
    console.log(`      + Địa chỉ MAC: ${deviceInfo.macAddress}`);

    // 2. Query Recent ACS Events (Read-Only)
    console.log('\n    - Đang gọi POST /ISAPI/AccessControl/AcsEvent (Đọc log sự kiện mẫu)...');
    const eventsResult = await hikvisionIsapiService.getAcsEvents(deviceConfig, { maxResults: 10 });
    console.log(`    [THÀNH CÔNG] Đọc thành công ${eventsResult.events.length} sự kiện gần nhất (Tổng số trên máy: ${eventsResult.totalMatches})`);

    if (eventsResult.events.length > 0) {
      console.log('      Mẫu sự kiện gần nhất:');
      eventsResult.events.slice(0, 3).forEach((ev, idx) => {
        console.log(`        [${idx + 1}] Thời gian: ${ev.time} | Mã người: ${ev.employeeNoString} (${ev.name || 'N/A'}) | Phương thức: ${ev.authMethod} | Mô tả: ${ev.eventDescription}`);
      });
    }

    console.log('\n===============================================================');
    console.log(' [KẾT QUẢ]: LIVE_VERIFIED_SUCCESS (Kết nối và đọc dữ liệu máy thật 100% ĐẠT)');
    console.log('===============================================================');
    return {
      status: 'LIVE_VERIFIED_SUCCESS',
      targetHost,
      deviceInfo,
      eventsCount: eventsResult.events.length
    };
  } catch (err) {
    console.log(`\n    [THẤT BẠI]: Lỗi kết nối thiết bị (${err.code || 'ERROR'}): ${err.message}`);
    console.log('===============================================================');
    return {
      status: 'FAILED',
      targetHost,
      code: err.code,
      message: err.message
    };
  }
}

if (require.main === module) {
  runLiveVerification()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { runLiveVerification };
