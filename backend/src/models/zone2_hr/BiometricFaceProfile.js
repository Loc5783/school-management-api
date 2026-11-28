'use strict';

/**
 * @fileoverview Lưu trữ ảnh khuôn mặt chấm công chuyên biệt chuẩn Hikvision FDLib (< 200KB JPEG/PNG),
 * tách biệt hoàn toàn khỏi Avatar hiển thị trên Web và tách khỏi bảng `Student` / `Employee`
 * để tối ưu bộ nhớ khi truy vấn danh sách lớn và đảm bảo cách ly dữ liệu đa trường (`tenantId`).
 */

const mongoose = require('mongoose');

const BiometricFaceProfileSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  subjectType: {
    type: String,
    enum: ['EMPLOYEE', 'STUDENT'],
    required: true
  },
  subjectId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  linkedUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  personCode: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  fullName: {
    type: String,
    trim: true,
    default: ''
  },
  campus: {
    type: String,
    trim: true,
    maxlength: 120,
    default: 'Cơ sở chính'
  },
  mimeType: {
    type: String,
    enum: ['image/jpeg', 'image/png'],
    default: 'image/jpeg'
  },
  imageBase64: {
    type: String,
    required: true
  },
  sizeBytes: {
    type: Number,
    required: true,
    min: 64,
    max: 204800 // Giới hạn cứng phần cứng Hikvision FDLib: <= 200KB
  },
  source: {
    type: String,
    enum: ['UPLOAD', 'CAMERA', 'PULLED_FROM_DEVICE'],
    default: 'UPLOAD'
  },
  lastSyncedAt: {
    type: Date,
    default: null
  },
  syncedDeviceIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TimekeepingDevice'
  }],
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true,
  collection: 'biometric_face_profiles'
});

// Đảm bảo mỗi Nhân sự / Học sinh trong cùng một trường chỉ có 1 hồ sơ ảnh quét mặt chuẩn duy nhất
BiometricFaceProfileSchema.index(
  { tenantId: 1, subjectType: 1, subjectId: 1 },
  { unique: true }
);

BiometricFaceProfileSchema.index({ tenantId: 1, personCode: 1 });
BiometricFaceProfileSchema.index({ tenantId: 1, campus: 1, subjectType: 1 });

module.exports = mongoose.model('BiometricFaceProfile', BiometricFaceProfileSchema);

