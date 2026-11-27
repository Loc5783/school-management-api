'use strict';

/**
 * @fileoverview Bộ tự động trích xuất toàn bộ Mongoose Models (7 Phân vùng Database) sang chuẩn OpenAPI 3.0 Schema
 * kèm chú thích tiếng Việt, kiểu dữ liệu chi tiết, khóa ngoại (`ref`), giá trị `enum` và danh sách Index.
 *
 * Lợi ích cho lập trình viên kế thừa:
 * - Đảm bảo tài liệu Database trên Swagger UI luôn khớp 100% với cấu trúc bảng thực tế trong MongoDB.
 * - Hiển thị rõ ràng từng trường dữ liệu, kiểu (`ObjectId`, `Date ISO-8601`, `Number`, `String`, `Boolean`, `Array`, `Object`),
 *   ràng buộc bắt buộc (`required`), giới hạn độ dài/giá trị và liên kết khóa ngoại giữa các bảng.
 */

const fs = require('fs');
const path = require('path');

const ZONE_DESCRIPTIONS = {
  zone1_system: {
    code: 'Zone 1 — Hệ thống & Đa trường (System & Multi-Tenant)',
    summary: 'Quản lý Trường học (Tenant & Phân hiệu), Quản trị Tổng (PlatformAdmin), Tài khoản (User), Phân quyền, Thông báo, Tin nhắn và Nhật ký kiểm toán.'
  },
  zone2_hr: {
    code: 'Zone 2 — Nhân sự, Chấm công & Tiền lương (HR, Timekeeping & Payroll)',
    summary: 'Quản lý Hồ sơ nhân sự, Phòng ban, Phân công lịch trực, Chấm công máy Hikvision ISAPI, Đơn công bù, Nghỉ phép và Bảng lương 3 bước duyệt.'
  },
  zone3_school: {
    code: 'Zone 3 — Học sinh, Lớp học, Điểm danh & Đón trả (School Core)',
    summary: 'Quản lý Lớp học (từ 6 tháng tuổi), Hồ sơ học sinh (2 Phụ huynh, BHYT, Nhóm máu, Tiêm chủng, Cân nặng chiều cao), Điểm danh, Đón trả trẻ 1 chạm & OTP cổng trường.'
  },
  zone4_finance: {
    code: 'Zone 4 — Tài chính, Học phí & Kế toán (Finance & Accounting)',
    summary: 'Quản lý Biểu phí mẫu, Hóa đơn học phí (khấu trừ tiền ăn nghỉ có phép), Phiếu thu/Biên lai, Yêu cầu hoàn phí, Chi mua sắm/vận hành, Sổ quỹ và Khóa kỳ kế toán.'
  },
  zone5_nutrition: {
    code: 'Zone 5 — Bếp ăn, Thực đơn & An toàn Thực phẩm (Nutrition & Kitchen)',
    summary: 'Quản lý Món ăn, Nguyên liệu, Thực đơn tuần kiểm tra dị ứng, Chia suất ăn theo sĩ số điểm danh, Lưu mẫu thức ăn 24h, Kiểm thực 3 bước và Kho bếp.'
  },
  zone6_procurement: {
    code: 'Zone 6 — Mua sắm & Cơ sở vật chất (Procurement & Assets)',
    summary: 'Quản lý Tài sản cố định, Bảo trì/Thanh lý thiết bị, Đề xuất mua sắm và Đơn đặt hàng nhà cung cấp.'
  },
  zone7_reporting: {
    code: 'Zone 7 — Báo cáo & Thống kê Điều hành (Reporting)',
    summary: 'Lưu trữ các bản chụp báo cáo tổng hợp định kỳ phục vụ Ban giám hiệu và Kế toán.'
  }
};

const MODEL_VIETNAMESE_TITLES = {
  Tenant: 'Trường học & Danh mục Phân hiệu (Tenant)',
  PlatformAdmin: 'Tài khoản Quản trị Tổng Đa Trường (SuperAdmin)',
  User: 'Tài khoản Người dùng (Nhân sự nội bộ & Phụ huynh)',
  Permission: 'Danh mục Quyền hạn chi tiết',
  Notification: 'Thông báo Hệ thống & Phụ huynh',
  AuditLog: 'Nhật ký Kiểm toán Thao tác trong Trường',
  PlatformAuditLog: 'Nhật ký Kiểm toán Cấp Hệ thống Đa Trường',
  Conversation: 'Hội thoại Tin nhắn (Giáo viên ↔ Phụ huynh)',
  ChatMessage: 'Tin nhắn Chi tiết trong Hội thoại',
  PrincipalTask: 'Công việc Điều hành của Hiệu trưởng',
  Employee: 'Hồ sơ Nhân sự & Cấu hình Lương',
  Department: 'Tổ chuyên môn / Bộ phận',
  AttendanceRecord: 'Bản ghi Chấm công Ngày của Nhân sự',
  TimekeepingDevice: 'Thiết bị Máy chấm công Khuôn mặt/Vân tay (ISAPI)',
  TimekeepingCorrectionRequest: 'Đơn Giải trình / Chấm công bù Nhân sự',
  LeaveRequest: 'Đơn Xin nghỉ phép của Nhân sự',
  Payroll: 'Phiếu Lương Tháng của Nhân sự',
  MonthlyTimesheet: 'Bảng Công Tháng Chốt Gửi Nhân sự Xác nhận',
  StaffReplacement: 'Phân công Dạy thay / Trực thay Khi Nhân sự Nghỉ',
  StaffShift: 'Ca trực Bếp / Bảo vệ',
  StaffHandover: 'Bàn giao Công việc Khi Nghỉ phép / Thôi việc',
  InternalAnnouncement: 'Thông báo Nội bộ Nhà trường',
  AttendanceDevicePersonMapping: 'Ánh xạ Mã máy chấm công ↔ Hồ sơ Nhân sự / Học sinh',
  TimekeepingWebhookLog: 'Nhật ký Gói tin Sự kiện từ Máy chấm công ISAPI',
  Classroom: 'Lớp học (Nhà trẻ 6 tháng+ & Mẫu giáo, gắn Phân hiệu)',
  ClassroomDailyCareReport: 'Sổ Chăm sóc Hàng ngày tại Lớp (Ăn, Ngủ, Vệ sinh, Tâm trạng)',
  Student: 'Hồ sơ Học sinh (Phụ huynh 1+2, Y tế, Tiêm chủng, Tăng trưởng)',
  StudentAttendance: 'Điểm danh Học sinh Hàng ngày (Sáng đến & Chiều về)',
  StudentLeaveRequest: 'Đơn Xin nghỉ học Có phép từ Phụ huynh',
  StudentTransferHistory: 'Lịch sử Chuyển lớp của Học sinh',
  PickupRecord: 'Bản ghi Đón trả trẻ (Trực tiếp tại lớp / Đặt trước / OTP)',
  PickupOtpChallenge: 'Phiên Xác thực OTP Người đón thay 1 lần',
  StudentGateEvent: 'Sự kiện Học sinh Vào/Rời Cổng trường',
  SchoolVisitor: 'Sổ Khách đến Liên hệ Công tác tại Cổng trường',
  SecurityIncident: 'Biên bản Sự cố An ninh Trường học',
  GuardShiftHandover: 'Biên bản Bàn giao Ca trực Bảo vệ',
  GuardEmergencyMode: 'Trạng thái Khẩn cấp Toàn trường',
  SupplierDelivery: 'Nhật ký Giao nhận Hàng hóa Nhà cung cấp tại Cổng',
  StudentProfileChangeRequest: 'Yêu cầu Phụ huynh Cập nhật Hồ sơ Con',
  ParentFeedback: 'Ý kiến / Phản hồi của Phụ huynh gửi Nhà trường',
  FeeSchedule: 'Biểu mức thu Học phí Mẫu theo Kỳ/Lớp',
  TuitionFee: 'Hóa đơn Học phí Tháng của Học sinh',
  Payment: 'Giao dịch Thu tiền & Biên lai Học phí',
  InvoiceAdjustment: 'Lịch sử Điều chỉnh Giảm trừ / Phụ thu Hóa đơn',
  TuitionRefundRequest: 'Đề nghị Hoàn tiền Học phí (Quy trình Duyệt → Chi)',
  PurchaseExpense: 'Chứng từ Chi Mua sắm từ Đơn đặt hàng',
  OperatingExpense: 'Chứng từ Chi Vận hành Nhà trường',
  OperatingExpenseRequest: 'Đề nghị Duyệt Chi Vận hành',
  AccountingPeriod: 'Kỳ Kế toán Tháng (Mở / Khóa sổ)',
  DailyCashReconciliation: 'Biên bản Đối soát Quỹ Tiền mặt Cuối ngày',
  Dish: 'Món ăn Thực đơn Bán trú',
  IngredientMaster: 'Danh mục Nguyên liệu Thực phẩm & Dinh dưỡng',
  Menu: 'Thực đơn Tuần theo Nhóm tuổi / Lớp',
  MealServing: 'Vận hành Chia suất ăn Hàng ngày theo Lớp',
  KitchenDayClosing: 'Chốt Sổ Suất ăn & Kho Bếp Cuối ngày',
  KitchenRequest: 'Đề xuất Thực phẩm / Vật tư từ Bếp ăn',
  KitchenEquipment: 'Thiết bị Nhà bếp & Bảo trì',
  KitchenStaff: 'Hồ sơ An toàn Vệ sinh Nhân viên Bếp',
  FoodSample: 'Mẫu Lưu Thức ăn 24 giờ (An toàn Thực phẩm)',
  FoodInspection: 'Sổ Kiểm thực 3 Bước Hàng ngày',
  Inventory: 'Tồn kho Thực phẩm Nhà bếp theo Lô',
  InventoryTransaction: 'Giao dịch Nhập / Xuất / Hủy Kho Thực phẩm',
  InventoryReconciliation: 'Biên bản Kiểm kê Kho Thực phẩm',
  Supplier: 'Nhà cung cấp Thực phẩm / Vật tư',
  Asset: 'Tài sản & Thiết bị Cơ sở vật chất',
  ItemMaster: 'Danh mục Vật tư / Hàng hóa Mua sắm',
  ProcurementRequest: 'Đề xuất Mua sắm Vật tư / Thiết bị',
  PurchaseOrder: 'Đơn Đặt hàng Nhà cung cấp',
  Report: 'Báo cáo Tổng hợp Đã lưu'
};

const COMMON_FIELD_NOTES = {
  _id: 'Mã định danh duy nhất của bản ghi (MongoDB ObjectId 24 ký tự hex)',
  tenantId: 'Mã định danh Trường học sở hữu dữ liệu (Cách ly bắt buộc Multi-Tenant)',
  createdAt: 'Thời điểm tạo bản ghi (ISO-8601 UTC)',
  updatedAt: 'Thời điểm cập nhật gần nhất (ISO-8601 UTC)',
  studentCode: 'Mã số học sinh duy nhất trong phạm vi trường (đồng bộ máy chấm công)',
  identityCode: 'Mã định danh cá nhân (CCCD / Mã định danh Bộ GD&ĐT)',
  healthInsuranceCode: 'Mã số thẻ Bảo hiểm Y tế (BHYT) của học sinh',
  bloodType: 'Nhóm máu (A, B, AB, O, A+, A-, B+, B-, AB+, AB-, O+, O-)',
  campus: 'Tên Phân hiệu / Cơ sở trực thuộc trường (mặc định: "Cơ sở chính")',
  ageGroup: 'Nhóm độ tuổi lớp mầm non (6-12m, 1-2, 2-3, 3-4, 4-5, 5-6)',
  period: 'Kỳ học phí theo định dạng MM-YYYY (ví dụ: "11-2026")',
  passwordHash: 'Chuỗi băm mật khẩu bcrypt (Chỉ lưu nội bộ DB — TUYỆT ĐỐI KHÔNG trả về qua API)'
};

const SENSITIVE_HIDDEN_FIELDS = new Set(['passwordHash', 'secret', 'apiKeyHash', 'webhookSecret', 'otpHash']);

/**
 * Chuyển đổi một SchemaType của Mongoose sang đặc tả thuộc tính OpenAPI 3.0.
 *
 * @param {string} fieldName
 * @param {Object} schemaType
 * @param {number} [depth=0]
 * @returns {Object}
 */
const convertSchemaTypeToOpenApi = (fieldName, schemaType, depth = 0) => {
  if (!schemaType || depth > 4) {
    return { type: 'object' };
  }

  const options = schemaType.options || {};
  const instance = schemaType.instance;
  let prop = {};

  // Trường hợp Subdocument nhúng (Embedded Schema)
  if (schemaType.schema && depth <= 3) {
    prop = convertMongooseSchemaToOpenApiObject(schemaType.schema, depth + 1);
    if (instance === 'Array') {
      return {
        type: 'array',
        description: options.description || COMMON_FIELD_NOTES[fieldName] || `Danh sách ${fieldName}`,
        items: prop
      };
    }
    return prop;
  }

  // Trường hợp Mảng cơ bản hoặc Mảng Subdocument
  if (instance === 'Array') {
    let itemSchema = { type: 'string' };
    if (schemaType.caster) {
      itemSchema = convertSchemaTypeToOpenApi(`${fieldName}Item`, schemaType.caster, depth + 1);
    } else if (Array.isArray(options.type) && options.type[0] && typeof options.type[0] === 'object') {
      if (options.type[0].paths) {
        itemSchema = convertMongooseSchemaToOpenApiObject(options.type[0], depth + 1);
      }
    }
    return {
      type: 'array',
      description: COMMON_FIELD_NOTES[fieldName] || undefined,
      items: itemSchema
    };
  }

  switch (instance) {
    case 'ObjectId':
    case 'ObjectID':
      prop = {
        type: 'string',
        format: 'objectId',
        pattern: '^[0-9a-fA-F]{24}$',
        example: '674580a1b2c3d4e5f6000101'
      };
      if (options.ref) {
        prop.description = `${COMMON_FIELD_NOTES[fieldName] ? `${COMMON_FIELD_NOTES[fieldName]} · ` : ''}Khóa ngoại liên kết tới bảng \`${options.ref}\``;
      }
      break;
    case 'String':
      prop = { type: 'string' };
      if (Array.isArray(schemaType.enumValues) && schemaType.enumValues.length > 0) {
        prop.enum = schemaType.enumValues;
      } else if (Array.isArray(options.enum) && options.enum.length > 0) {
        prop.enum = options.enum;
      }
      if (typeof options.maxlength === 'number') prop.maxLength = options.maxlength;
      if (typeof options.minlength === 'number') prop.minLength = options.minlength;
      break;
    case 'Number':
      prop = { type: 'number' };
      if (typeof options.min === 'number') prop.minimum = options.min;
      if (Array.isArray(options.min) && typeof options.min[0] === 'number') prop.minimum = options.min[0];
      if (typeof options.max === 'number') prop.maximum = options.max;
      if (Array.isArray(options.max) && typeof options.max[0] === 'number') prop.maximum = options.max[0];
      break;
    case 'Boolean':
      prop = { type: 'boolean' };
      break;
    case 'Date':
      prop = { type: 'string', format: 'date-time', example: '2026-11-27T08:30:00.000Z' };
      break;
    case 'Mixed':
    default:
      prop = { type: 'object', additionalProperties: true };
      break;
  }

  if (!prop.description && COMMON_FIELD_NOTES[fieldName]) {
    prop.description = COMMON_FIELD_NOTES[fieldName];
  }
  if (
    options.default !== undefined &&
    typeof options.default !== 'function' &&
    options.default !== null &&
    ['string', 'number', 'boolean'].includes(typeof options.default)
  ) {
    prop.default = options.default;
  }
  if (SENSITIVE_HIDDEN_FIELDS.has(fieldName)) {
    prop.writeOnly = true;
    prop.description = COMMON_FIELD_NOTES[fieldName] || 'Trường bảo mật nội bộ DB — không bao giờ trả về trong JSON API.';
  }

  return prop;
};

/**
 * Chuyển đổi một `mongoose.Schema` (kể cả nested paths dạng `profile.fullName`, `salaryConfig.baseSalary`)
 * thành đối tượng Schema `type: 'object'` chuẩn OpenAPI 3.0.
 *
 * @param {import('mongoose').Schema} mongooseSchema
 * @param {number} [depth=0]
 * @returns {Object}
 */
const convertMongooseSchemaToOpenApiObject = (mongooseSchema, depth = 0) => {
  const properties = {};
  const requiredSet = new Set();

  for (const [rawPath, schemaType] of Object.entries(mongooseSchema.paths || {})) {
    if (rawPath === '__v') continue;

    const isRequired = Boolean(
      schemaType.isRequired ||
      schemaType.options?.required === true ||
      (Array.isArray(schemaType.options?.required) && schemaType.options.required[0] === true)
    );

    const segments = rawPath.split('.');
    if (segments.length === 1) {
      properties[rawPath] = convertSchemaTypeToOpenApi(rawPath, schemaType, depth);
      if (isRequired && rawPath !== '_id') requiredSet.add(rawPath);
    } else {
      // Gom các đường dẫn lồng nhau (VD: profile.fullName, parentInfo.studentIds) thành object con dễ nhìn
      let cursor = properties;
      for (let i = 0; i < segments.length - 1; i += 1) {
        const seg = segments[i];
        if (!cursor[seg] || cursor[seg].type !== 'object' || !cursor[seg].properties) {
          cursor[seg] = { type: 'object', properties: {} };
        }
        cursor = cursor[seg].properties;
      }
      const leaf = segments[segments.length - 1];
      cursor[leaf] = convertSchemaTypeToOpenApi(leaf, schemaType, depth + 1);
    }
  }

  const result = {
    type: 'object',
    properties
  };
  if (requiredSet.size > 0) {
    result.required = [...requiredSet];
  }
  return result;
};

/**
 * Quét toàn bộ 7 thư mục phân vùng trong `backend/src/models/` và sinh ra:
 * 1. `dbSchemas`: Map các OpenAPI Schema (`DB_<ModelName>`) gắn vào `components.schemas`.
 * 2. `databaseDictionary`: Mảng từ điển cơ sở dữ liệu phân nhóm theo 7 Zone để lập trình viên tra cứu nhanh.
 */
const introspectAllDatabaseModels = () => {
  const modelsRoot = path.resolve(__dirname, '../models');
  const dbSchemas = {};
  const databaseDictionary = [];

  if (!fs.existsSync(modelsRoot)) {
    return { dbSchemas, databaseDictionary };
  }

  const zoneDirs = fs
    .readdirSync(modelsRoot, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .sort();

  for (const zoneDir of zoneDirs) {
    const zonePath = path.join(modelsRoot, zoneDir);
    const zoneMeta = ZONE_DESCRIPTIONS[zoneDir] || { code: zoneDir, summary: '' };
    const collections = [];

    const files = fs
      .readdirSync(zonePath)
      .filter((f) => f.endsWith('.js'))
      .sort();

    for (const file of files) {
      try {
        const exportedModel = require(path.join(zonePath, file));
        if (!exportedModel || !exportedModel.schema || !exportedModel.modelName) continue;

        const modelName = exportedModel.modelName;
        const collectionName = exportedModel.collection?.collectionName || `${modelName.toLowerCase()}s`;
        const openApiObj = convertMongooseSchemaToOpenApiObject(exportedModel.schema, 0);

        const rawIndexes = typeof exportedModel.schema.indexes === 'function' ? exportedModel.schema.indexes() : [];
        const formattedIndexes = rawIndexes.map(([fields, opts]) => ({
          fields,
          unique: Boolean(opts?.unique),
          partialFilterExpression: opts?.partialFilterExpression || undefined
        }));

        const indexMarkdown = formattedIndexes.length
          ? `\n\n**Indexes MongoDB (${formattedIndexes.length}):** ` +
            formattedIndexes
              .map((idx) => `\`${JSON.stringify(idx.fields)}${idx.unique ? ' (UNIQUE)' : ''}\``)
              .join(', ')
          : '';

        const viTitle = MODEL_VIETNAMESE_TITLES[modelName] || modelName;
        const schemaKey = `DB_${modelName}`;

        dbSchemas[schemaKey] = {
          title: `${viTitle} [Collection: ${collectionName}]`,
          description:
            `**Phân vùng:** ${zoneMeta.code}  \n` +
            `**Tên bảng vật lý (MongoDB Collection):** \`${collectionName}\`  \n` +
            `**Mô hình Mongoose:** \`${modelName}\`` +
            indexMarkdown,
          ...openApiObj
        };

        // Lấy danh sách khóa ngoại liên kết sang bảng khác để vẽ sơ đồ quan hệ dễ đọc
        const relations = [];
        for (const [pName, sType] of Object.entries(exportedModel.schema.paths || {})) {
          if (sType.options?.ref) {
            relations.push({ field: pName, refModel: sType.options.ref });
          } else if (sType.caster?.options?.ref) {
            relations.push({ field: `${pName}[]`, refModel: sType.caster.options.ref });
          }
        }

        collections.push({
          modelName,
          schemaRef: `#/components/schemas/${schemaKey}`,
          collectionName,
          vietnameseTitle: viTitle,
          hasTenantId: Boolean(exportedModel.schema.paths?.tenantId),
          fieldCount: Object.keys(openApiObj.properties || {}).length,
          relations,
          indexes: formattedIndexes
        });
      } catch (err) {
        console.warn(`[SwaggerIntrospect] Bỏ qua file model ${file}:`, err.message);
      }
    }

    databaseDictionary.push({
      zoneFolder: zoneDir,
      zoneTitle: zoneMeta.code,
      zoneSummary: zoneMeta.summary,
      collectionCount: collections.length,
      collections
    });
  }

  return { dbSchemas, databaseDictionary };
};

module.exports = {
  ZONE_DESCRIPTIONS,
  MODEL_VIETNAMESE_TITLES,
  introspectAllDatabaseModels
};
