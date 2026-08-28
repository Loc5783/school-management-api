const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  passwordHash: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard', 'parent'],
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
    }]
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'locked'],
    default: 'active'
  },
  lastLogin: Date
}, {
  timestamps: true
});

UserSchema.index({ 'employeeInfo.employeeId': 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('User', UserSchema);
