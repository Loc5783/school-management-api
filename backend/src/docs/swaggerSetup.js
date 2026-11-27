'use strict';

/**
 * @fileoverview Khởi tạo & gắn giao diện Tài liệu Kỹ thuật OpenAPI 3.0.3 (Swagger UI) + Từ điển Cơ sở dữ liệu 7 Phân vùng.
 *
 * Thiết kế giao diện:
 * - Tối ưu hóa độ tương phản cao trên nền Sáng hiện đại (khóa triệt để xung đột `html.dark-mode` của Swagger UI v5 trên Windows Dark Mode).
 * - Bố cục thẻ gọn gàng (`max-width: 1240px`), thanh công cụ dính phía trên (Sticky Header), ngăn hướng dẫn thu gọn `<details>`
 *   giúp danh sách 15 phân hệ API hiển thị ngay trong tầm mắt mà không phải cuộn trang dài.
 *
 * Đường dẫn truy cập (mặc định cổng 5001):
 * - `GET /api-docs` hoặc `GET /api/docs`: Giao diện trực quan Swagger UI.
 * - `GET /api-docs.json` hoặc `GET /api/openapi.json`: Đặc tả JSON OpenAPI 3.0.3 chuẩn cho Postman / Insomnia / Apidog.
 * - `GET /api/docs/database`: Từ điển cấu trúc 7 Phân vùng Database, khóa ngoại (`ref`) và chỉ mục (`indexes`).
 */

const swaggerUi = require('swagger-ui-express');
const { introspectAllDatabaseModels } = require('./mongooseSchemaConverter');
const { swaggerPathsPart1 } = require('./swaggerPathsPart1');
const { swaggerPathsPart2 } = require('./swaggerPathsPart2');

let cachedSpec = null;
let cachedDbDictionary = null;
let cachedSwaggerUiMiddleware = null;

/**
 * Sinh khối giới thiệu gọn gàng, trực quan (kết hợp HTML badges & ngăn thu gọn `<details>`) ngay đầu trang Swagger UI.
 *
 * @param {Array<Object>} databaseDictionary
 * @returns {string}
 */
const buildDeveloperOverviewMarkdown = (databaseDictionary) => {
  const totalCollections = databaseDictionary.reduce((sum, z) => sum + z.collectionCount, 0);
  const zoneRows = databaseDictionary
    .map((z) => {
      const sampleModels = z.collections
        .slice(0, 6)
        .map((c) => `<code>${c.modelName}</code>`)
        .join(', ');
      const extra = z.collectionCount > 6 ? ` <em>(+${z.collectionCount - 6} bảng khác)</em>` : '';
      return `<tr><td><strong>${z.zoneTitle}</strong></td><td style="text-align:center"><span class="hn-zone-count">${z.collectionCount} bảng</span></td><td>${sampleModels}${extra}</td></tr>`;
    })
    .join('');

  return [
    '<div class="hn-overview-subtitle">Tài liệu kỹ thuật chính thức dành cho lập trình viên <strong>Backend, Frontend &amp; Mobile</strong> tích hợp hệ thống <strong>Quản lý Trường Mầm non Đa Trường &amp; Đa Phân hiệu (Hoa Nắng SaaS)</strong>.</div>',
    '',
    '<div class="hn-stat-strip">',
    '  <div class="hn-stat-chip"><span class="hn-stat-num">15</span><span class="hn-stat-lbl">Phân hệ API Nghiệp vụ</span></div>',
    '  <div class="hn-stat-chip"><span class="hn-stat-num">7</span><span class="hn-stat-lbl">Phân vùng Kiến trúc (Zones)</span></div>',
    `  <div class="hn-stat-chip"><span class="hn-stat-num">${totalCollections}</span><span class="hn-stat-lbl">Bảng MongoDB (Schemas)</span></div>`,
    '  <div class="hn-stat-chip"><span class="hn-stat-num">5001</span><span class="hn-stat-lbl">Cổng API Hợp nhất Mặc định</span></div>',
    '</div>',
    '',
    '<div class="hn-quick-links">',
    '  <a class="hn-quick-btn hn-quick-btn-primary" href="/api-docs.json" target="_blank" rel="noreferrer">⬇ Tải OpenAPI JSON (Postman / Apidog)</a>',
    '  <a class="hn-quick-btn" href="/api/docs/database" target="_blank" rel="noreferrer">🗄 Xem Từ điển Database JSON (7 Zones)</a>',
    '  <a class="hn-quick-btn" href="/api/health" target="_blank" rel="noreferrer">💚 Kiểm tra /api/health</a>',
    '</div>',
    '',
    '<details class="hn-guide-card">',
    '  <summary>🔐 Hướng dẫn Đăng nhập nhanh &amp; Gắn JWT Token gọi thử API (Bấm để mở)</summary>',
    '  <div class="hn-guide-body">',
    '    <ol>',
    '      <li><strong>Admin Tổng Đa Trường (Mặc định tự tạo khi DB trống):</strong> Mở mục <code>01. Xác thực &amp; Phiên đăng nhập</code> → gọi <code>POST /api/auth/login</code> với <code>{ "schoolCode": "", "username": "admin", "password": "123456" }</code> (để trống <code>schoolCode</code>).</li>',
    '      <li><strong>Tài khoản từng Trường (School Workspace):</strong> Gọi <code>POST /api/auth/login</code> kèm mã trường: <code>{ "schoolCode": "HOANANG-A", "username": "admin", "password": "..." }</code>.</li>',
    '      <li><strong>Phụ huynh học sinh:</strong> Đăng nhập tại <code>POST /api/auth/login</code> bằng <code>schoolCode</code> + <code>username = Số điện thoại</code> + mật khẩu mặc định lần đầu <code>123456</code>.</li>',
    '      <li>Sao chép giá trị <code>token</code> trong kết quả JSON → bấm nút <strong>Authorize</strong> màu xanh lá bên dưới → dán Token vào ô <code>BearerAuth</code> → bấm <strong>Authorize</strong>.</li>',
    '    </ol>',
    '    <div class="hn-response-hint">',
    '      <strong>Chuẩn JSON trả về:</strong> Thành công (<code>200/201</code>): <code>{ "success": true, "message": "...", "data": { ... }, "pagination": { ... } }</code> · Lỗi nghiệp vụ (<code>400/401/403/404/409/422</code>): <code>{ "success": false, "message": "Thông báo tiếng Việt rõ ràng" }</code>.',
    '    </div>',
    '  </div>',
    '</details>',
    '',
    '<details class="hn-guide-card">',
    `  <summary>🗄️ Sơ đồ 7 Phân vùng Cơ sở dữ liệu MongoDB (${totalCollections} Collections &amp; Quy tắc Multi-Tenant — Bấm để xem)</summary>`,
    '  <div class="hn-guide-body">',
    '    <p style="margin:0 0 10px">Toàn bộ mô hình dữ liệu thực tế được tự động đồng bộ xuống mục <strong>Schemas</strong> ở cuối trang (bắt đầu bằng tiền tố <code>DB_*</code>), bao gồm kiểu dữ liệu, <code>enum</code>, khóa ngoại (<code>ref</code>) và <code>Indexes</code>.</p>',
    '    <table class="hn-zone-table">',
    '      <thead><tr><th>Phân vùng kiến trúc (Zone)</th><th style="width:110px;text-align:center">Số bảng</th><th>Các bảng tiêu biểu</th></tr></thead>',
    `      <tbody>${zoneRows}</tbody>`,
    '    </table>',
    '    <div class="hn-tenant-alert"><strong>Quy tắc Cách ly Multi-Tenant bắt buộc:</strong> Mọi bản ghi nghiệp vụ của trường đều gắn khóa <code>tenantId</code> (<code>ObjectId</code> trỏ tới <code>Tenant</code>). Hệ thống tự động trích xuất <code>tenantId</code> từ JWT Token đã xác thực, tuyệt đối không tin tưởng <code>tenantId</code> thô gửi từ Client.</div>',
    '  </div>',
    '</details>'
  ].join('\n');
};

/**
 * Xây dựng và lưu bộ nhớ đệm đặc tả OpenAPI 3.0.3 hoàn chỉnh.
 */
const getOpenApiSpecAndDictionary = () => {
  if (cachedSpec && cachedDbDictionary) {
    return { spec: cachedSpec, databaseDictionary: cachedDbDictionary };
  }

  const { dbSchemas, databaseDictionary } = introspectAllDatabaseModels();
  cachedDbDictionary = databaseDictionary;

  cachedSpec = {
    openapi: '3.0.3',
    info: {
      title: 'Tài liệu API & Cơ sở dữ liệu — Hệ thống Quản lý Trường Mầm non Hoa Nắng',
      version: '2.0.0',
      description: buildDeveloperOverviewMarkdown(databaseDictionary),
      contact: {
        name: 'Đội ngũ Phát triển Hệ thống Quản lý Mầm non Hoa Nắng'
      }
    },
    servers: [
      {
        url: '/',
        description: 'Máy chủ hiện tại (Tự động theo IP LAN / Localhost / Domain đang mở)'
      },
      {
        url: 'http://localhost:5001',
        description: 'Máy chủ Localhost chuẩn (Cổng 5001)'
      }
    ],
    tags: [
      { name: '00. Hệ thống & Từ điển Database', description: 'Kiểm tra trạng thái máy chủ & tra cứu cấu trúc 7 phân vùng Database' },
      { name: '01. Xác thực & Phiên đăng nhập (Auth)', description: 'Đăng nhập theo Mã trường, thông tin phiên hiện tại, đổi mật khẩu & đăng xuất' },
      { name: '02. Quản trị Tổng Đa Trường (SuperAdmin)', description: 'Điều hành chuỗi nhiều trường, tạo trường kèm Account Admin riêng & chuyển vào quản lý từng trường' },
      { name: '03. Trường, Phân hiệu & Tài khoản (System)', description: 'Quản lý Cơ sở chính / Phân hiệu trực thuộc trường & danh sách tài khoản nội bộ / phụ huynh' },
      { name: '04. Lớp học (Classrooms)', description: 'Quản lý lớp Nhà trẻ (từ 6 tháng tuổi) & Mẫu giáo, phân hiệu và giáo viên chủ nhiệm' },
      { name: '05. Học sinh, Y tế & Nhập Excel (Students)', description: 'Hồ sơ học sinh, BHYT, nhóm máu, sổ tiêm chủng, cân nặng chiều cao tháng, nhập Excel 2 chế độ & tự cấp TK Phụ huynh' },
      { name: '06. Điểm danh & Đơn xin nghỉ học (Attendance)', description: 'Điểm danh sáng theo lớp, báo cáo chuyên cần & duyệt đơn xin nghỉ phép' },
      { name: '07. Đón trả trẻ 1 chạm & Trực cổng (Pickups & Guard)', description: 'Trả trẻ 1 chạm tại lớp, hoàn tác bấm nhầm, hẹn đón bằng QR & xác thực OTP người đón lạ' },
      { name: '08. Nhân sự, Phân công & Bảng lương (HR & Payroll)', description: 'Tạo nhân sự gộp 1 bước cấp TK, hợp đồng, ca trực, nghỉ phép & duyệt bảng lương 3 bước' },
      { name: '09. Chấm công Nhân sự & Máy Hikvision (Timekeeping)', description: 'Chấm công web/kiosk, đơn chấm công bù, quản lý máy ISAPI & nhận Webhook khuôn mặt' },
      { name: '10. Tài chính, Học phí, Sổ quỹ & Khóa kỳ (Finance)', description: 'Lập học phí tự trừ tiền ăn nghỉ có phép, thu tiền/biên lai, hoàn phí, sổ quỹ & khóa kỳ kế toán' },
      { name: '11. Bếp ăn, Thực đơn & An toàn Thực phẩm (Nutrition)', description: 'Thực đơn tuần kiểm tra dị ứng, suất ăn hàng ngày, lưu mẫu 24h, kiểm thực 3 bước & kho thực phẩm' },
      { name: '12. Mua sắm & Cơ sở vật chất (Procurement & Assets)', description: 'Danh mục tài sản, nhật ký bảo trì, thanh lý, đề xuất mua sắm & đơn đặt hàng' },
      { name: '13. Thông báo, Tin nhắn & Phản hồi (Communication)', description: 'Thông báo realtime, chat Phụ huynh ↔ Giáo viên, góp ý & yêu cầu cập nhật hồ sơ' },
      { name: '14. Báo cáo Điều hành & Thống kê (Reports)', description: 'Dashboard tổng quan, đầu việc Hiệu trưởng & báo cáo kế toán tổng hợp' }
    ],
    security: [{ BearerAuth: [] }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Dán JWT Token nhận được từ `/api/auth/login` (từng trường) hoặc `/api/multi-school/login` (Admin Tổng)'
        }
      },
      schemas: {
        ApiErrorResponse: {
          title: 'Chuẩn Phản hồi Lỗi (Error Envelope)',
          type: 'object',
          required: ['success', 'message'],
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', description: 'Thông báo lỗi tiếng Việt rõ ràng', example: 'Dữ liệu nhập vào chưa hợp lệ.' }
          }
        },
        ApiMessageResponse: {
          title: 'Chuẩn Phản hồi Thông báo Thành công',
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Thao tác thành công' }
          }
        },
        ApiSuccessAny: {
          title: 'Chuẩn Phản hồi Thành công Chung (Data Envelope)',
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Thành công' },
            data: { type: 'object', additionalProperties: true }
          }
        },
        PaginationMeta: {
          title: 'Thông tin Phân trang Chuẩn (Pagination)',
          type: 'object',
          properties: {
            page: { type: 'integer', description: 'Trang hiện tại (bắt đầu từ 1)', example: 1 },
            limit: { type: 'integer', description: 'Số bản ghi tối đa mỗi trang', example: 20 },
            total: { type: 'integer', description: 'Tổng số bản ghi khớp bộ lọc', example: 145 },
            totalPages: { type: 'integer', description: 'Tổng số trang', example: 8 }
          }
        },
        ...dbSchemas
      }
    },
    paths: {
      ...swaggerPathsPart1,
      ...swaggerPathsPart2
    }
  };

  return { spec: cachedSpec, databaseDictionary: cachedDbDictionary };
};

/**
 * Script khởi chạy nhẹ phía trình duyệt:
 * 1. Tắt tự động lớp `dark-mode` của Swagger UI v5 để giao diện luôn sáng rõ, tương phản cao trên mọi máy Windows/macOS.
 * 2. Gắn thanh điều hướng nhanh (Sticky Topbar) và Việt hóa ô tìm kiếm phân hệ.
 */
const CUSTOM_SWAGGER_JS = `
(function () {
  function enforceCleanLightTheme() {
    var root = document.documentElement;
    if (root && root.classList.contains('dark-mode')) {
      root.classList.remove('dark-mode');
    }
  }
  enforceCleanLightTheme();
  try {
    var obs = new MutationObserver(enforceCleanLightTheme);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  } catch (e) {}

  function enhanceSwaggerDom() {
    enforceCleanLightTheme();
    if (!document.getElementById('hn-swagger-navbar')) {
      var bar = document.createElement('div');
      bar.id = 'hn-swagger-navbar';
      bar.innerHTML =
        '<div class="hn-nav-inner">' +
          '<div class="hn-nav-brand">' +
            '<span class="hn-brand-dot">☀</span>' +
            '<span><strong>Hoa Nắng SaaS</strong> · Cổng Tài liệu API &amp; Database</span>' +
          '</div>' +
          '<div class="hn-nav-actions">' +
            '<a href="#/" onclick="window.scrollTo({top:0,behavior:\\'smooth\\'});return false;">Danh sách API</a>' +
            '<a href="#models" onclick="var m=document.querySelector(\\'.swagger-ui section.models\\');if(m){m.scrollIntoView({behavior:\\'smooth\\'});}return false;">Bảng Database (Schemas)</a>' +
            '<a href="/api-docs.json" target="_blank" rel="noreferrer">OpenAPI JSON</a>' +
            '<a href="/dashboard">Về Trang Quản Trị ↗</a>' +
          '</div>' +
        '</div>';
      document.body.insertBefore(bar, document.body.firstChild);
    }

    var filterInput = document.querySelector('.swagger-ui .filter .operation-filter-input');
    if (filterInput && !filterInput.dataset.viReady) {
      filterInput.dataset.viReady = '1';
      filterInput.placeholder = '🔍 Nhập tên phân hệ để lọc nhanh (VD: Học sinh, Lớp học, Đón trả, Học phí, Lương...)';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      enhanceSwaggerDom();
      setTimeout(enhanceSwaggerDom, 400);
      setTimeout(enhanceSwaggerDom, 1200);
    });
  } else {
    enhanceSwaggerDom();
    setTimeout(enhanceSwaggerDom, 400);
    setTimeout(enhanceSwaggerDom, 1200);
  }
})();
`;

const CUSTOM_SWAGGER_CSS = `
  /* 1. Nền sáng chuẩn mực, chống hoàn toàn xung đột màu tối của trình duyệt */
  html, body, html.dark-mode, html.dark-mode body {
    background: #f1f5f9 !important;
    color: #0f172a !important;
    color-scheme: light !important;
    font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif !important;
    margin: 0;
  }
  .swagger-ui, html.dark-mode .swagger-ui {
    background: transparent !important;
    color: #0f172a !important;
    font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif !important;
  }
  .swagger-ui .topbar { display: none !important; }

  /* 2. Thanh điều hướng dính trên cùng (Sticky Topbar) */
  #hn-swagger-navbar {
    position: sticky;
    top: 0;
    z-index: 1000;
    background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%);
    color: #ffffff;
    box-shadow: 0 4px 16px rgba(15, 23, 42, 0.16);
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  }
  #hn-swagger-navbar .hn-nav-inner {
    max-width: 1240px;
    margin: 0 auto;
    padding: 12px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  #hn-swagger-navbar .hn-nav-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 15px;
    color: #f8fafc;
  }
  #hn-swagger-navbar .hn-brand-dot {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: #f59e0b;
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    font-weight: 700;
  }
  #hn-swagger-navbar .hn-nav-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  #hn-swagger-navbar .hn-nav-actions a {
    color: #e2e8f0;
    text-decoration: none;
    font-size: 13px;
    font-weight: 600;
    padding: 6px 12px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.1);
    transition: background 0.15s ease, color 0.15s ease;
  }
  #hn-swagger-navbar .hn-nav-actions a:hover {
    background: rgba(255, 255, 255, 0.22);
    color: #ffffff;
  }

  /* 3. Khung căn giữa gọn gàng (không kéo tràn 1920px gây mỏi mắt) */
  .swagger-ui .wrapper {
    max-width: 1240px !important;
    margin: 0 auto !important;
    padding: 0 24px !important;
  }

  /* 4. Khối Header Giới thiệu (Hero Card) */
  .swagger-ui .information-container.wrapper {
    padding-top: 22px !important;
  }
  .swagger-ui .info {
    margin: 0 0 16px 0 !important;
    background: #ffffff !important;
    border: 1px solid #e2e8f0 !important;
    border-top: 4px solid #2563eb !important;
    border-radius: 14px !important;
    padding: 22px 26px !important;
    box-shadow: 0 4px 14px rgba(15, 23, 42, 0.05) !important;
  }
  .swagger-ui .info .title {
    font-size: 23px !important;
    font-weight: 800 !important;
    color: #0f172a !important;
    letter-spacing: -0.01em !important;
    display: flex !important;
    align-items: center !important;
    flex-wrap: wrap !important;
    gap: 10px !important;
    margin-bottom: 8px !important;
  }
  .swagger-ui .info .title small {
    background: #2563eb !important;
    border-radius: 6px !important;
    padding: 3px 8px !important;
    top: 0 !important;
  }
  .swagger-ui .info .title small.version-stamp {
    background: #059669 !important;
  }
  .hn-overview-subtitle {
    font-size: 14px;
    color: #475569;
    line-height: 1.6;
    margin-bottom: 14px;
  }
  .hn-stat-strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 10px;
    margin: 12px 0 14px;
  }
  .hn-stat-chip {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 10px 14px;
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .hn-stat-num {
    font-size: 20px;
    font-weight: 800;
    color: #1d4ed8;
  }
  .hn-stat-lbl {
    font-size: 13px;
    font-weight: 600;
    color: #334155;
  }
  .hn-quick-links {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 14px;
  }
  .hn-quick-btn {
    display: inline-flex;
    align-items: center;
    padding: 7px 13px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    text-decoration: none !important;
    background: #f1f5f9;
    color: #1e293b !important;
    border: 1px solid #cbd5e1;
    transition: all 0.15s ease;
  }
  .hn-quick-btn:hover {
    background: #e2e8f0;
    border-color: #94a3b8;
  }
  .hn-quick-btn-primary {
    background: #eff6ff;
    color: #1d4ed8 !important;
    border-color: #bfdbfe;
  }
  .hn-quick-btn-primary:hover {
    background: #dbeafe;
  }

  /* Ngăn hướng dẫn thu gọn <details> */
  details.hn-guide-card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    margin-top: 10px;
    overflow: hidden;
  }
  details.hn-guide-card > summary {
    padding: 11px 16px;
    cursor: pointer;
    font-size: 13.5px;
    font-weight: 700;
    color: #1e3a8a;
    user-select: none;
    list-style: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  details.hn-guide-card > summary::-webkit-details-marker { display: none; }
  details.hn-guide-card > summary::after {
    content: '▾ Mở xem';
    font-size: 12px;
    font-weight: 600;
    color: #2563eb;
    background: #eff6ff;
    padding: 3px 9px;
    border-radius: 6px;
  }
  details.hn-guide-card[open] > summary {
    border-bottom: 1px solid #e2e8f0;
    background: #eff6ff;
  }
  details.hn-guide-card[open] > summary::after {
    content: '▴ Thu gọn';
  }
  .hn-guide-body {
    padding: 14px 18px;
    background: #ffffff;
    font-size: 13.5px;
    line-height: 1.65;
    color: #334155;
  }
  .hn-guide-body ol {
    margin: 0 0 10px 18px;
    padding: 0;
  }
  .hn-guide-body li {
    margin-bottom: 6px;
    color: #334155 !important;
  }
  .hn-response-hint, .hn-tenant-alert {
    margin-top: 10px;
    padding: 10px 14px;
    border-radius: 8px;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    color: #166534;
    font-size: 13px;
  }
  .hn-tenant-alert {
    background: #fffbeb;
    border-color: #fde68a;
    color: #92400e;
  }
  .hn-zone-table {
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    overflow: hidden;
  }
  .hn-zone-table th {
    background: #f1f5f9 !important;
    color: #0f172a !important;
    font-weight: 700 !important;
    padding: 9px 12px !important;
    text-align: left;
    border-bottom: 1px solid #cbd5e1 !important;
    font-size: 13px !important;
  }
  .hn-zone-table td {
    padding: 8px 12px !important;
    border-bottom: 1px solid #f1f5f9 !important;
    color: #334155 !important;
    font-size: 13px !important;
    background: #ffffff !important;
  }
  .hn-zone-count {
    display: inline-block;
    background: #eff6ff;
    color: #1d4ed8;
    font-weight: 700;
    font-size: 12px;
    padding: 2px 8px;
    border-radius: 999px;
  }

  /* Định dạng thẻ <code> sáng rõ, dễ đọc */
  .swagger-ui .markdown code,
  .swagger-ui .renderedMarkdown code,
  .hn-guide-body code {
    background: #eff6ff !important;
    color: #1e40af !important;
    padding: 2px 6px !important;
    border-radius: 5px !important;
    font-size: 12.5px !important;
    font-weight: 600 !important;
    border: 1px solid #dbeafe !important;
  }

  /* 5. Thanh chọn Server & Nút Authorize + Ô Tìm kiếm Lọc nhanh */
  .swagger-ui .scheme-container {
    background: #ffffff !important;
    box-shadow: 0 2px 10px rgba(15, 23, 42, 0.04) !important;
    border: 1px solid #e2e8f0 !important;
    border-radius: 12px !important;
    max-width: 1192px !important;
    margin: 0 auto 14px !important;
    padding: 14px 20px !important;
  }
  .swagger-ui .scheme-container .schemes > label {
    color: #334155 !important;
    font-weight: 700 !important;
    font-size: 12.5px !important;
  }
  .swagger-ui select,
  .swagger-ui input[type=text],
  .swagger-ui input[type=search],
  .swagger-ui textarea {
    background: #ffffff !important;
    color: #0f172a !important;
    border: 1px solid #cbd5e1 !important;
    border-radius: 8px !important;
    font-size: 13.5px !important;
  }
  .swagger-ui .btn.authorize {
    background: #059669 !important;
    color: #ffffff !important;
    border-color: #059669 !important;
    border-radius: 8px !important;
    font-weight: 700 !important;
    padding: 7px 16px !important;
    box-shadow: 0 2px 6px rgba(5, 150, 105, 0.25) !important;
  }
  .swagger-ui .btn.authorize svg {
    fill: #ffffff !important;
  }
  .swagger-ui .filter-container {
    margin: 0 0 14px 0 !important;
  }
  .swagger-ui .filter .operation-filter-input {
    width: 100% !important;
    max-width: 100% !important;
    padding: 11px 16px !important;
    border: 2px solid #cbd5e1 !important;
    border-radius: 10px !important;
    background: #ffffff !important;
    font-size: 14px !important;
    box-shadow: 0 2px 6px rgba(15, 23, 42, 0.03) !important;
  }
  .swagger-ui .filter .operation-filter-input:focus {
    border-color: #2563eb !important;
    outline: none !important;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14) !important;
  }

  /* 6. Danh sách 15 Nhóm Phân hệ API (Tag Cards) */
  .swagger-ui .opblock-tag-section {
    background: #ffffff !important;
    border: 1px solid #e2e8f0 !important;
    border-radius: 12px !important;
    margin-bottom: 12px !important;
    padding: 2px 14px !important;
    box-shadow: 0 1px 4px rgba(15, 23, 42, 0.04) !important;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .swagger-ui .opblock-tag-section:hover {
    border-color: #93c5fd !important;
    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.07) !important;
  }
  .swagger-ui .opblock-tag {
    border-bottom: none !important;
    padding: 13px 6px !important;
    margin: 0 !important;
    font-size: 15.5px !important;
    font-weight: 700 !important;
    color: #0f172a !important;
  }
  .swagger-ui .opblock-tag small {
    font-size: 13px !important;
    font-weight: 500 !important;
    color: #64748b !important;
    padding-left: 10px !important;
  }
  .swagger-ui .opblock-tag-section.is-open .opblock-tag {
    border-bottom: 1px solid #f1f5f9 !important;
    margin-bottom: 12px !important;
  }

  /* 7. Thẻ từng API Endpoint (.opblock) phân màu rõ ràng */
  .swagger-ui .opblock {
    border-radius: 10px !important;
    margin: 0 0 10px 0 !important;
    box-shadow: none !important;
    border-width: 1px !important;
  }
  .swagger-ui .opblock .opblock-summary {
    padding: 8px 12px !important;
  }
  .swagger-ui .opblock .opblock-summary-method {
    border-radius: 7px !important;
    font-weight: 800 !important;
    font-size: 12px !important;
    min-width: 74px !important;
    padding: 6px 10px !important;
  }
  .swagger-ui .opblock .opblock-summary-path {
    color: #0f172a !important;
    font-weight: 700 !important;
    font-size: 13.5px !important;
  }
  .swagger-ui .opblock .opblock-summary-description {
    color: #334155 !important;
    font-size: 13px !important;
    font-weight: 500 !important;
  }
  .swagger-ui .opblock.opblock-get { background: #f8fbff !important; border-color: #bfdbfe !important; }
  .swagger-ui .opblock.opblock-get .opblock-summary-method { background: #2563eb !important; }
  .swagger-ui .opblock.opblock-post { background: #f4fdf8 !important; border-color: #a7f3d0 !important; }
  .swagger-ui .opblock.opblock-post .opblock-summary-method { background: #059669 !important; }
  .swagger-ui .opblock.opblock-put { background: #fffcf4 !important; border-color: #fde68a !important; }
  .swagger-ui .opblock.opblock-put .opblock-summary-method { background: #d97706 !important; }
  .swagger-ui .opblock.opblock-patch { background: #f3fdfa !important; border-color: #99f6e4 !important; }
  .swagger-ui .opblock.opblock-patch .opblock-summary-method { background: #0d9488 !important; }
  .swagger-ui .opblock.opblock-delete { background: #fef6f6 !important; border-color: #fecaca !important; }
  .swagger-ui .opblock.opblock-delete .opblock-summary-method { background: #dc2626 !important; }

  .swagger-ui .opblock-section-header {
    background: #f8fafc !important;
    box-shadow: none !important;
    border-top: 1px solid #e2e8f0 !important;
    border-bottom: 1px solid #e2e8f0 !important;
  }
  .swagger-ui .opblock-section-header h4,
  .swagger-ui table thead tr th,
  .swagger-ui table thead tr td,
  .swagger-ui .parameter__name,
  .swagger-ui .parameter__type,
  .swagger-ui .response-col_status,
  .swagger-ui .response-col_description {
    color: #0f172a !important;
  }

  /* 8. Khu vực Mô hình Cơ sở Dữ liệu (Schemas DB_*) ở cuối trang */
  .swagger-ui section.models {
    margin: 24px 0 48px !important;
    padding: 16px 20px !important;
    border-radius: 14px !important;
    border: 1px solid #cbd5e1 !important;
    background: #ffffff !important;
    box-shadow: 0 4px 14px rgba(15, 23, 42, 0.05) !important;
  }
  .swagger-ui section.models h4 {
    font-size: 18px !important;
    font-weight: 800 !important;
    color: #0f172a !important;
  }
  .swagger-ui section.models .model-container {
    background: #f8fafc !important;
    border: 1px solid #e2e8f0 !important;
    border-radius: 10px !important;
    margin: 8px 0 !important;
    padding: 8px 12px !important;
  }
  .swagger-ui .model-title {
    color: #0f172a !important;
    font-weight: 700 !important;
    font-size: 14px !important;
  }
  .swagger-ui .model {
    color: #1e293b !important;
    font-size: 13px !important;
  }
  .swagger-ui .prop-type {
    color: #2563eb !important;
    font-weight: 700 !important;
  }

  /* 9. Hộp thoại Authorize Modal sáng rõ */
  .swagger-ui .dialog-ux .modal-ux {
    background: #ffffff !important;
    border: 1px solid #cbd5e1 !important;
    border-radius: 14px !important;
    box-shadow: 0 20px 50px rgba(15, 23, 42, 0.25) !important;
  }
  .swagger-ui .dialog-ux .modal-ux-header h3,
  .swagger-ui .dialog-ux .modal-ux-content h4,
  .swagger-ui .dialog-ux .modal-ux-content p,
  .swagger-ui .dialog-ux .modal-ux-content label {
    color: #0f172a !important;
  }
`;

const SWAGGER_UI_OPTIONS = {
  customSiteTitle: 'Tài liệu API & Database — Hoa Nắng School Management',
  customCss: CUSTOM_SWAGGER_CSS,
  customJsStr: CUSTOM_SWAGGER_JS,
  swaggerOptions: {
    docExpansion: 'none',
    defaultModelsExpandDepth: 1,
    defaultModelExpandDepth: 2,
    filter: true,
    persistAuthorization: true,
    displayRequestDuration: true,
    tryItOutEnabled: true
  }
};

/**
 * Gắn các endpoint tài liệu OpenAPI / Swagger UI và Từ điển Database vào ứng dụng Express.
 * NOTE: Phải được gọi TRƯỚC `tenantFeatureGate` và `attachFrontendStatic` để không bị nuốt route.
 *
 * @param {import('express').Application} app
 */
const attachSwaggerDocs = (app) => {
  const sendOpenApiJson = (req, res) => {
    const { spec } = getOpenApiSpecAndDictionary();
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).json(spec);
  };

  const sendDatabaseDictionary = (req, res) => {
    const { databaseDictionary } = getOpenApiSpecAndDictionary();
    const totalCollections = databaseDictionary.reduce((sum, z) => sum + z.collectionCount, 0);
    return res.status(200).json({
      success: true,
      totalZones: databaseDictionary.length,
      totalCollections,
      zones: databaseDictionary
    });
  };

  app.get('/api-docs.json', sendOpenApiJson);
  app.get('/api/openapi.json', sendOpenApiJson);
  app.get('/api/v1/openapi.json', sendOpenApiJson);
  app.get('/api/docs/database', sendDatabaseDictionary);

  const setupMiddleware = (req, res, next) => {
    if (!cachedSwaggerUiMiddleware) {
      const { spec } = getOpenApiSpecAndDictionary();
      cachedSwaggerUiMiddleware = swaggerUi.setup(spec, SWAGGER_UI_OPTIONS);
    }
    return cachedSwaggerUiMiddleware(req, res, next);
  };

  app.use('/api-docs', swaggerUi.serve, setupMiddleware);
  app.use('/api/docs', swaggerUi.serve, setupMiddleware);
};

module.exports = {
  getOpenApiSpecAndDictionary,
  attachSwaggerDocs
};
