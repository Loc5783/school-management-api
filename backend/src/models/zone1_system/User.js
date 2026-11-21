const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    trim: true
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    index: true
  },
  passwordHash: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard', 'hr', 'parent'],
    required: true
  },
  // THÊM TRƯỜNG PERMISSIONS
  permissions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Permission'
  }],
  profile: {
    fullName: {
      type: String,
      required: true
    },
    phone: String,
    email: String,
    address: String
  },
  employeeInfo: {
    employeeId: {
      type: String,
      trim: true,
      uppercase: true
    },
    hireDate: Date,
    baseSalary: Number,
    position: String
  },
  parentInfo: {
    studentIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student'
    }],
    // Thông tin phụ huynh tự khai khi đăng ký; chỉ dùng để khoanh vùng
    // xác minh, không tự động cấp quyền xem bất kỳ hồ sơ học sinh nào.
    requestedClassroomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Classroom',
      default: null
    },
    registrationNote: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ''
    }
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended', 'locked'],
    default: 'active'
  },
  lastLogin: Date,
  // Incremented when a security-sensitive change must invalidate old tokens.
  authVersion: {
    type: Number,
    default: 0
  },
  // Incremented during classroom assignment or role changes to coordinate concurrent operations.
  assignmentVersion: {
    type: Number,
    default: 0
  },
  accessEndsAt: { type: Date, default: null }
}, {
  timestamps: true,
  autoIndex: false,
  autoCreate: false
});

// Normalize employeeId: trim and uppercase, if empty string remove/set undefined
UserSchema.pre('validate', function() {
  if (this.employeeInfo?.employeeId !== undefined) {
    if (typeof this.employeeInfo.employeeId === 'string') {
      const trimmed = this.employeeInfo.employeeId.trim().toUpperCase();
      if (!trimmed) {
        this.employeeInfo.employeeId = undefined;
      } else {
        this.employeeInfo.employeeId = trimmed;
      }
    }
  }
});

// Compound unique username for both legacy (tenantId: null) and multi-tenant (tenantId: ObjectId)
UserSchema.index(
  { tenantId: 1, username: 1 },
  {
    name: 'tenantId_1_username_1',
    unique: true
  }
);

// Multi-tenant partial unique index for employeeId (excludes missing/null/empty):
UserSchema.index(
  { tenantId: 1, 'employeeInfo.employeeId': 1 },
  {
    name: 'tenantId_1_employeeInfo.employeeId_1',
    unique: true,
    partialFilterExpression: {
      'employeeInfo.employeeId': { $type: 'string', $gt: '' }
    }
  }
);

UserSchema.index({ tenantId: 1, status: 1 });

module.exports = mongoose.model('User', UserSchema);
