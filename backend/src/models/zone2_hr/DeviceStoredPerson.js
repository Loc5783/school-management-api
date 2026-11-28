'use strict';

/**
 * @fileoverview Bản chụp danh sách hồ sơ thực tế đang lưu bên trong từng máy chấm công (`DeviceStoredPerson`).
 *
 * Tại sao tách bảng riêng thay vì nhúng mảng vào `TimekeepingDevice`:
 * - Mỗi máy Hikvision lưu tới 500 hồ sơ kèm ảnh khuôn mặt JPEG (`< 200KB`). Nếu gộp vào 1 document `TimekeepingDevice`
 *   sẽ vượt giới hạn 16MB BSON của MongoDB.
 * - Tách riêng theo chuẩn Multi-Tenant `{ tenantId: 1, deviceId: 1, externalPersonId: 1 }` giúp:
 *   1. Hiển thị tức thì danh sách người + ảnh mặt + tên đang nằm trong máy chấm công (kể cả sau khi tải lại trang).
 *   2. Cho phép Quản trị viên bấm 1 chạm "Lấy Ảnh & Tên từ máy về Web" hoặc "Ghép hồ sơ" bất cứ lúc nào.
 */

const mongoose = require('mongoose');

const DeviceStoredPersonSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true
    },
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TimekeepingDevice',
      required: true
    },
    externalPersonId: {
      type: String,
      required: true,
      trim: true
    },
    nameOnDevice: {
      type: String,
      trim: true,
      default: ''
    },
    numOfFace: {
      type: Number,
      default: 0
    },
    numOfCard: {
      type: Number,
      default: 0
    },
    numOfFP: {
      type: Number,
      default: 0
    },
    mimeType: {
      type: String,
      trim: true,
      default: 'image/jpeg'
    },
    imageBase64: {
      type: String,
      default: ''
    },
    sizeBytes: {
      type: Number,
      default: 0
    },
    lastPulledAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true,
    collection: 'device_stored_persons'
  }
);

// Chuẩn Multi-Tenant: luôn đặt tenantId đứng đầu trong compound unique index
DeviceStoredPersonSchema.index(
  { tenantId: 1, deviceId: 1, externalPersonId: 1 },
  { unique: true }
);

DeviceStoredPersonSchema.index({ tenantId: 1, deviceId: 1, updatedAt: -1 });

module.exports = mongoose.model('DeviceStoredPerson', DeviceStoredPersonSchema);

