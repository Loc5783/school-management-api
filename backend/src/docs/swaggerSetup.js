'use strict';

/**
 * @fileoverview Khởi tạo & gắn giao diện Tài liệu Kỹ thuật OpenAPI 3.0.3 (Swagger UI) + Từ điển Cơ sở dữ liệu 7 Phân vùng.
 *
 * Đường dẫn truy cập cho lập trình viên:
 * - `GET /api-docs` hoặc `GET /api/docs`: Giao diện trực quan Swagger UI (hỗ trợ Tìm kiếm nhanh, Authorize JWT, Try it out và xem toàn bộ 74 bảng MongoDB).
 * - `GET /api-docs.json` hoặc `GET /api/openapi.json`: Đặc tả JSON OpenAPI 3.0.3 chuẩn để import vào Postman / Insomnia.
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
 * Sinh văn bản Markdown hướng dẫn kiến trúc tổng thể & bảng phân vùng Database ngay đầu trang Swagger UI.
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
        .map((c) => `\`${c.modelName}\``)
        .join(', ');
      const extra = z.collectionCount > 6 ? ` *(+${z.collectionCount - 6} bảng khác)*` : '';
      return `| **${z.zoneTitle}** | \`${z.collectionCount}\` bảng | ${sampleModels}${extra} |`;
    })
    .join('\n');

  return [
    'Tài liệu kỹ thuật chính thức dành cho lập trình viên Backend, Frontend & Mobile tích hợp hệ thống **Quản lý Trường Mầm non Đa Trường & Đa Phân hiệu (Hoa Nắng SaaS)**.',
    '',
    '---',
    '',
    '### 1. Hướng dẫn Đăng nhập & Gọi thử API nhanh (`Try it out`)',
    '1. **Đối với từng Trường học (`School Workspace`)**: Mở mục **01. Xác thực & Phiên đăng nhập** → gọi `POST /api/auth/login` với `{ "schoolCode": "HOANANG-A", "username": "admin", "password": "..." }`.',
    '2. **Đối với Quản trị Tổng Đa Trường (`SuperAdmin`)**: Mở mục **02. Quản trị Tổng Đa Trường** → gọi `POST /api/multi-school/login` (mặc định lần đầu: `superadmin` / `123456`).',
    '3. **Đối với Phụ huynh học sinh**: Đăng nhập tại `POST /api/auth/login` bằng `schoolCode` + `username = Số điện thoại` + mật khẩu mặc định lần đầu `123456`.',
    '4. Sao chép chuỗi `token` trong JSON trả về → bấm nút **Authorize** màu xanh ở góc phải phía trên → dán Token vào ô `BearerAuth` → bấm **Authorize**.',
    '',
    '---',
    '',
    `### 2. Kiến trúc 7 Phân vùng Cơ sở dữ liệu MongoDB (\`${totalCollections}\` Collections)`,
    'Toàn bộ mô hình dữ liệu thực tế được tự động đồng bộ xuống mục **Schemas** ở cuối trang này (bắt đầu bằng tiền tố `DB_*`), bao gồm đầy đủ kiểu dữ liệu, giá trị `enum`, khóa ngoại liên kết (`ref`) và `Indexes`.',
    '',
    '| Phân vùng kiến trúc (Zone) | Số bảng | Các bảng tiêu biểu |',
    '| :--- | :---: | :--- |',
    zoneRows,
    '',
    '> **Quy tắc Cách ly Dữ liệu Multi-Tenant bắt buộc:** Mọi bản ghi nghiệp vụ của trường đều gắn khóa `tenantId` (`ObjectId` trỏ tới `Tenant`). Hệ thống tự động trích xuất `tenantId` từ JWT Token đã xác thực, tuyệt đối không tin tưởng `tenantId` thô gửi từ phía Client.',
    '',
    '---',
    '',
    '### 3. Chuẩn Cấu trúc Dữ liệu Trả về (Response Format) & Mã trạng thái HTTP',
    '- **Thành công (`200 OK`, `201 Created`)**: `{ "success": true, "message": "...", "data": { ... }, "pagination": { "page": 1, "limit": 20, "total": 145, "totalPages": 8 } }`',
    '- **Lỗi đầu vào / Nghiệp vụ (`400`, `401`, `403`, `404`, `409`, `422`, `429`)**: `{ "success": false, "message": "Thông báo tiếng Việt rõ ràng cho người dùng" }`',
    '- **Tải xuống đặc tả JSON cho Postman / Insomnia**: [/api-docs.json](/api-docs.json) · **Từ điển Database JSON**: [/api/docs/database](/api/docs/database)'
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
      title: 'School Management SaaS API & Database Reference',
      version: '2.0.0',
      description: buildDeveloperOverviewMarkdown(databaseDictionary),
      contact: {
        name: 'Đội ngũ Phát triển Hệ thống Quản lý Mầm non Hoa Nắng'
      }
    },
    servers: [
      {
        url: '/',
        description: 'Máy chủ hiện tại (Tự động nhận diện Localhost / LAN / Production Domain)'
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

const CUSTOM_SWAGGER_CSS = `
  .swagger-ui .topbar { display: none !important; }
  .swagger-ui .info { margin: 28px 0 20px; }
  .swagger-ui .info .title { font-size: 28px !important; font-weight: 800 !important; color: #0f172a !important; }
  .swagger-ui .info .markdown p, .swagger-ui .info .markdown li { font-size: 14px !important; line-height: 1.65 !important; color: #334155 !important; }
  .swagger-ui .info .markdown h3 { margin-top: 18px !important; color: #1e3a8a !important; font-size: 17px !important; }
  .swagger-ui .info .markdown table { width: 100%; border-collapse: collapse; margin: 12px 0; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(15,23,42,0.08); }
  .swagger-ui .info .markdown th { background: #eff6ff; color: #1e3a8a; padding: 10px 12px; text-align: left; font-weight: 700; border-bottom: 1px solid #dbeafe; }
  .swagger-ui .info .markdown td { padding: 9px 12px; border-bottom: 1px solid #f1f5f9; font-size: 13.5px; }
  .swagger-ui .opblock-tag { font-size: 16px !important; font-weight: 700 !important; color: #0f172a !important; border-bottom: 1px solid #e2e8f0 !important; padding: 12px 8px !important; }
  .swagger-ui .opblock { border-radius: 10px !important; box-shadow: 0 1px 3px rgba(15,23,42,0.06) !important; margin-bottom: 10px !important; }
  .swagger-ui .opblock .opblock-summary-description { font-size: 13.5px !important; font-weight: 500 !important; color: #1e293b !important; }
  .swagger-ui section.models { border-radius: 12px !important; border: 1px solid #cbd5e1 !important; background: #f8fafc !important; }
  .swagger-ui section.models h4 { font-size: 18px !important; font-weight: 800 !important; color: #0f172a !important; }
`;

const SWAGGER_UI_OPTIONS = {
  customSiteTitle: 'Tài liệu API & Database — Hoa Nắng School Management',
  customCss: CUSTOM_SWAGGER_CSS,
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
