'use strict';

/**
 * @fileoverview Mô hình Cấu hình Chung Toàn Hệ thống (`SystemSetting` - Zone 1).
 *
 * Chỉ do Quản trị Tổng Đa Trường (`SuperAdmin` / `PlatformAdmin`) quản lý.
 * Lưu trữ tập trung các tham số chuẩn Mầm non toàn chuỗi, thông báo hệ thống (System Banner),
 * chế độ bảo trì và chính sách bảo mật dùng chung cho mọi trường trực thuộc.
 */

const mongoose = require('mongoose');

const SystemSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'GLOBAL_CONFIG',
      trim: true
    },
    branding: {
      systemName: {
        type: String,
        trim: true,
        maxlength: 160,
        default: 'Hệ thống Giáo dục Mầm non Hoa Nắng'
      },
      supportEmail: {
        type: String,
        trim: true,
        lowercase: true,
        maxlength: 160,
        default: 'admin@hoanang.edu.vn'
      },
      supportHotline: {
        type: String,
        trim: true,
        maxlength: 40,
        default: '1900 6868'
      }
    },
    systemBanner: {
      enabled: { type: Boolean, default: false },
      level: {
        type: String,
        enum: ['info', 'warning', 'critical'],
        default: 'info'
      },
      message: {
        type: String,
        trim: true,
        maxlength: 500,
        default: ''
      },
      // Để trống = gửi tới tất cả trường đang sử dụng; có mã trường = CHỈ hiển thị cho các trường được chỉ định
      targetSchoolCodes: {
        type: [String],
        default: []
      }
    },
    maintenanceMode: {
      enabled: { type: Boolean, default: false },
      message: {
        type: String,
        trim: true,
        maxlength: 500,
        default: 'Hệ thống đang bảo trì nâng cấp định kỳ. Vui lòng quay lại sau ít phút.'
      }
    },
    preschoolStandards: {
      defaultSchoolYear: {
        type: String,
        trim: true,
        default: '2026-2027'
      },
      standardCheckInTime: {
        type: String,
        trim: true,
        default: '07:00'
      },
      standardCheckOutTime: {
        type: String,
        trim: true,
        default: '16:30'
      },
      accountingCloseDay: {
        type: Number,
        min: 1,
        max: 28,
        default: 5
      },
      referenceCaloriesPerDay: {
        type: Number,
        min: 600,
        max: 2500,
        default: 1250
      },
      foodSampleRetentionHours: {
        type: Number,
        min: 24,
        max: 72,
        default: 24
      },
      defaultMaxCampusesPerSchool: {
        type: Number,
        min: 1,
        max: 100,
        default: 10
      },
      defaultMaxStudentsPerSchool: {
        type: Number,
        min: 10,
        max: 20000,
        default: 800
      },
      defaultMaxStaffPerSchool: {
        type: Number,
        min: 5,
        max: 5000,
        default: 200
      }
    },
    securityPolicy: {
      sessionTimeoutHours: {
        type: Number,
        min: 1,
        max: 72,
        default: 8
      },
      minPasswordLength: {
        type: Number,
        min: 6,
        max: 32,
        default: 6
      },
      antiBotShieldEnabled: {
        type: Boolean,
        default: true
      }
    },
    updatedBy: {
      type: String,
      trim: true,
      default: 'system'
    }
  },
  {
    timestamps: true,
    autoIndex: false,
    autoCreate: false
  }
);

module.exports = mongoose.model('SystemSetting', SystemSettingSchema);

