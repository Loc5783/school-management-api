'use strict';

/**
 * @fileoverview Tiện ích gắn giao diện tĩnh Frontend (Production Build `dist`) trực tiếp vào máy chủ Express Backend.
 *
 * Mục đích:
 * - Cho phép triển khai hợp nhất (Single-Process / Single-Container): chỉ cần khởi chạy Backend (`node server.js`)
 *   trên một cổng duy nhất (mặc định `5001`) là phục vụ trọn vẹn cả `/api/*` lẫn giao diện React SPA (`index.html`).
 * - Hỗ trợ điều hướng phía trình duyệt (React Router v7 SPA Fallback) mà không bao giờ nuốt nhầm các đường dẫn `/api/*`.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');

/**
 * Xác định thư mục chứa bản build Production của Frontend (`index.html`).
 * Ưu tiên biến môi trường `FRONTEND_DIST_PATH` (trong Docker), sau đó tới `../frontend/dist` (chạy trực tiếp).
 *
 * @returns {string | null} Đường dẫn tuyệt đối nếu đã có bản build, ngược lại trả về `null`
 */
const resolveFrontendDistPath = () => {
  if (process.env.SERVE_FRONTEND === 'false') {
    return null;
  }

  const candidates = [
    process.env.FRONTEND_DIST_PATH ? path.resolve(process.env.FRONTEND_DIST_PATH) : null,
    path.resolve(__dirname, '../../../frontend/dist'),
    path.resolve(__dirname, '../../public')
  ].filter(Boolean);

  for (const dirPath of candidates) {
    const indexHtmlPath = path.join(dirPath, 'index.html');
    if (fs.existsSync(indexHtmlPath)) {
      return dirPath;
    }
  }

  return null;
};

/**
 * Kiểm tra xem request có phải cùng Origin với chính máy chủ Backend hiện tại hay không.
 * Giúp khi triển khai gộp Frontend + Backend lên tên miền bất kỳ không bị lỗi CORS khi gửi POST `/api/*`.
 *
 * @param {string | undefined} origin
 * @param {import('express').Request} req
 * @returns {boolean}
 */
const isSameHostOrigin = (origin, req) => {
  if (!origin) return true;
  try {
    const parsedOrigin = new URL(origin);
    const requestHost = req.header('x-forwarded-host') || req.header('host');
    if (!requestHost) return false;
    const primaryHost = String(requestHost).split(',')[0].trim().toLowerCase();
    return parsedOrigin.host.toLowerCase() === primaryHost;
  } catch {
    return false;
  }
};

/**
 * Gắn middleware phục vụ tài nguyên tĩnh và SPA Fallback (`index.html`) vào ứng dụng Express.
 * NOTE: Hàm này bắt buộc phải được gọi SAU KHI đã đăng ký toàn bộ route `/api/*`.
 *
 * @param {import('express').Express} app
 * @returns {string | null} Đường dẫn thư mục tĩnh đang phục vụ (hoặc `null` nếu chưa build)
 */
const attachFrontendStatic = (app) => {
  const distPath = resolveFrontendDistPath();
  if (!distPath) {
    return null;
  }

  const assetsPath = path.join(distPath, 'assets');
  if (fs.existsSync(assetsPath)) {
    // Các tệp bundle có hash của Vite được lưu bộ nhớ đệm dài hạn (1 năm)
    app.use('/assets', express.static(assetsPath, {
      maxAge: '1y',
      immutable: true,
      index: false
    }));
  }

  // Các tệp tĩnh gốc khác (favicon, manifest, ảnh trong public/)
  app.use(express.static(distPath, {
    index: false,
    maxAge: 0
  }));

  const indexFilePath = path.join(distPath, 'index.html');

  // SPA Fallback tương thích Express 5: trả index.html cho mọi điều hướng GET/HEAD ngoài nhánh /api
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next();
    }
    if (req.path === '/api' || req.path.startsWith('/api/')) {
      return next();
    }

    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(indexFilePath);
  });

  return distPath;
};

module.exports = {
  resolveFrontendDistPath,
  isSameHostOrigin,
  attachFrontendStatic
};

