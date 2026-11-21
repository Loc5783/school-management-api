'use strict';

/**
 * @fileoverview Model lưu trữ lịch sử gói tin Webhook thô nhận từ máy chấm công (Hikvision / thiết bị ngoại vi).
 * Mục đích (Bước 1): Lưu nguyên trạng metadata, JSON đã bóc tách (bao gồm cả JSON nằm trong multipart/form-data
 * khi quét khuôn mặt) và tóm tắt sự kiện để kiểm chứng thực tế trước khi ánh xạ sang Check-in/Check-out ở Bước 2.
 *
 * // NOTE: Tuân thủ nguyên tắc bảo mật sinh trắc học & tối ưu MongoDB — chỉ lưu metadata của file ảnh đính kèm
 * (tên trường, dung lượng, mimeType), KHÔNG lưu binary ảnh khuôn mặt thô vào cơ sở dữ liệu.
 */

const mongoose = require('mongoose');

const WEBHOOK_PAYLOAD_FORMATS = Object.freeze([
  'JSON',
  'MULTIPART_FORM_DATA',
  'XML',
  'FORM_URLENCODED',
  'PLAIN_TEXT',
  'EMPTY',
  'UNKNOWN'
]);

const WEBHOOK_PROCESSING_STATUSES = Object.freeze([
  'RECEIVED_RAW',
  'PROCESSED',
  'IGNORED',
  'FAILED'
]);

const WebhookFileMetaSchema = new mongoose.Schema({
  fieldName: { type: String, trim: true, default: '' },
  originalName: { type: String, trim: true, default: '' },
  mimeType: { type: String, trim: true, default: '' },
  sizeBytes: { type: Number, default: 0 },
  isParsedAsEventJson: { type: Boolean, default: false }
}, { _id: false });

const HikvisionEventSummarySchema = new mongoose.Schema({
  eventType: { type: String, trim: true, default: null },
  eventState: { type: String, trim: true, default: null },
  dateTime: { type: String, trim: true, default: null },
  deviceIp: { type: String, trim: true, default: null },
  macAddress: { type: String, trim: true, default: null },
  deviceName: { type: String, trim: true, default: null },
  majorEventType: { type: Number, default: null },
  subEventType: { type: Number, default: null },
  subEventLabel: { type: String, trim: true, default: null },
  employeeNoString: { type: String, trim: true, default: null },
  personName: { type: String, trim: true, default: null },
  cardNo: { type: String, trim: true, default: null },
  userType: { type: String, trim: true, default: null },
  attendanceStatus: { type: String, trim: true, default: null },
  currentVerifyMode: { type: String, trim: true, default: null },
  serialNo: { type: Number, default: null },
  hasFaceImage: { type: Boolean, default: false },
  isHeartbeat: { type: Boolean, default: false }
}, { _id: false });

const TimekeepingWebhookLogSchema = new mongoose.Schema({
  // Cho phép null ở Bước 1 khi máy chấm công bắn vào endpoint test chung chưa gắn mã trường
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    default: null,
    index: true
  },
  schoolCode: {
    type: String,
    trim: true,
    uppercase: true,
    default: null
  },
  deviceCode: {
    type: String,
    trim: true,
    uppercase: true,
    default: null
  },
  sourceIp: {
    type: String,
    trim: true,
    default: ''
  },
  method: {
    type: String,
    trim: true,
    uppercase: true,
    default: 'POST'
  },
  url: {
    type: String,
    trim: true,
    default: ''
  },
  contentType: {
    type: String,
    trim: true,
    default: ''
  },
  payloadFormat: {
    type: String,
    enum: WEBHOOK_PAYLOAD_FORMATS,
    default: 'UNKNOWN'
  },
  headers: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  query: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  parsedPayload: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  rawBodyPreview: {
    type: String,
    default: ''
  },
  filesMeta: {
    type: [WebhookFileMetaSchema],
    default: []
  },
  hikvisionSummary: {
    type: HikvisionEventSummarySchema,
    default: () => ({})
  },
  processingStatus: {
    type: String,
    enum: WEBHOOK_PROCESSING_STATUSES,
    default: 'RECEIVED_RAW',
    index: true
  },
  processingNote: {
    type: String,
    trim: true,
    default: ''
  }
}, {
  timestamps: true,
  collection: 'timekeeping_webhook_logs'
});

// Đặt tenantId lên đầu theo quy chuẩn index Multi-Tenant của dự án
TimekeepingWebhookLogSchema.index({ tenantId: 1, createdAt: -1 });
TimekeepingWebhookLogSchema.index({ createdAt: -1 });
TimekeepingWebhookLogSchema.index({ tenantId: 1, 'hikvisionSummary.employeeNoString': 1, createdAt: -1 });

module.exports = mongoose.model('TimekeepingWebhookLog', TimekeepingWebhookLogSchema);

