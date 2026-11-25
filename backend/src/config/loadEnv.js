'use strict';

/**
 * @fileoverview Nạp biến môi trường thông minh cho Backend:
 * - Ưu tiên nạp từ `backend/.env` (nếu có).
 * - Tự động fallback sang `backend/.env.example` nếu người dùng chưa tạo `.env` riêng,
 *   giúp dự án chạy ngay sau khi clone hoặc dùng trực tiếp cấu hình example mặc định.
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const backendRoot = path.resolve(__dirname, '../..');
const primaryEnvPath = path.join(backendRoot, '.env');
const exampleEnvPath = path.join(backendRoot, '.env.example');

if (fs.existsSync(primaryEnvPath)) {
  dotenv.config({ path: primaryEnvPath });
}
if (fs.existsSync(exampleEnvPath)) {
  // Nạp bổ sung các biến còn thiếu từ .env.example (dotenv mặc định không ghi đè biến đã có sẵn)
  dotenv.config({ path: exampleEnvPath });
}

