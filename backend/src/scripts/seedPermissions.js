const mongoose = require('mongoose');
require('dotenv').config();

const Permission = require('../models/zone1_system/Permission');
const User = require('../models/zone1_system/User');
const bcrypt = require('bcryptjs');

// Định nghĩa tất cả permissions
const allPermissions = [
  // ===== SYSTEM =====
  { name: 'system.manage', module: 'system', resource: 'system', action: 'manage', description: 'Quản trị hệ thống' },
  { name: 'user.manage', module: 'system', resource: 'user', action: 'manage', description: 'Quản lý người dùng' },

  // ===== SCHOOL =====
  { name: 'student.read', module: 'school', resource: 'student', action: 'read', description: 'Xem danh sách học sinh' },
  { name: 'student.create', module: 'school', resource: 'student', action: 'create', description: 'Thêm học sinh' },
  { name: 'student.update', module: 'school', resource: 'student', action: 'update', description: 'Sửa học sinh' },
  { name: 'student.delete', module: 'school', resource: 'student', action: 'delete', description: 'Xóa học sinh' },
  { name: 'student.view_own', module: 'school', resource: 'student', action: 'view_own', description: 'Xem con của mình' },

  { name: 'classroom.read', module: 'school', resource: 'classroom', action: 'read', description: 'Xem danh sách lớp' },
  { name: 'classroom.manage', module: 'school', resource: 'classroom', action: 'manage', description: 'Quản lý lớp học' },

  { name: 'attendance.manage', module: 'school', resource: 'attendance', action: 'manage', description: 'Quản lý điểm danh học sinh' },

  // ===== FINANCE =====
  { name: 'tuition.read', module: 'finance', resource: 'tuition', action: 'read', description: 'Xem học phí' },
  { name: 'tuition.create', module: 'finance', resource: 'tuition', action: 'create', description: 'Tạo hóa đơn học phí' },
  { name: 'tuition.update', module: 'finance', resource: 'tuition', action: 'update', description: 'Sửa hóa đơn' },
  { name: 'payment.create', module: 'finance', resource: 'payment', action: 'create', description: 'Ghi nhận thanh toán' },
  { name: 'finance.report', module: 'finance', resource: 'report', action: 'read', description: 'Xem báo cáo tài chính' },

  // ===== NUTRITION =====
  { name: 'menu.manage', module: 'nutrition', resource: 'menu', action: 'manage', description: 'Quản lý thực đơn' },
  { name: 'inventory.manage', module: 'nutrition', resource: 'inventory', action: 'manage', description: 'Quản lý kho bếp' },
  { name: 'ingredient.manage', module: 'nutrition', resource: 'ingredient', action: 'manage', description: 'Quản lý nguyên liệu' },

  // ===== PROCUREMENT =====
  { name: 'procurement.manage', module: 'procurement', resource: 'procurement', action: 'manage', description: 'Quản lý mua sắm' },
  { name: 'asset.manage', module: 'procurement', resource: 'asset', action: 'manage', description: 'Quản lý tài sản' },

  // ===== HR =====
  { name: 'attendance.correction', module: 'hr', resource: 'attendance', action: 'approve', description: 'Duyệt đơn chấm công bù' },
  { name: 'employee.manage', module: 'hr', resource: 'employee', action: 'manage', description: 'Quản lý nhân viên' },
  { name: 'payroll.manage', module: 'hr', resource: 'payroll', action: 'manage', description: 'Quản lý lương' },

  // ===== REPORT =====
  { name: 'report.read', module: 'report', resource: 'report', action: 'read', description: 'Xem báo cáo' },
  { name: 'report.manage', module: 'report', resource: 'report', action: 'manage', description: 'Tạo báo cáo' },
];

// Gán permissions cho từng role
const rolePermissions = {
  admin: allPermissions.map(p => p.name),

  principal: [
    'student.read', 'classroom.read', 'classroom.manage',
    'attendance.manage', 'tuition.read', 'report.read',
    'attendance.correction', 'employee.manage', 'payroll.manage'
  ],

  teacher: [
    'student.read', 'student.create', 'student.update',
    'classroom.read', 'attendance.manage'
  ],

  accountant: [
    'tuition.read', 'tuition.create', 'tuition.update',
    'payment.create', 'finance.report', 'report.read'
  ],

  chef: [
    'menu.manage', 'inventory.manage', 'ingredient.manage'
  ],

  guard: [
    'attendance.manage'
  ],

  parent: [
    'student.view_own'
  ],
};

async function seedPermissions() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Kết nối DB thành công');

    // 1. Tạo permissions
    console.log('🔄 Đang tạo permissions...');
    const permMap = {};
    for (const p of allPermissions) {
      const perm = await Permission.findOneAndUpdate(
        { name: p.name },
        p,
        { upsert: true, new: true }
      );
      permMap[p.name] = perm._id;
    }
    console.log(`✅ Đã tạo ${Object.keys(permMap).length} permissions`);

    // 2. Gán permissions cho từng role
    console.log('🔄 Đang gán permissions cho roles...');
    for (const [role, permNames] of Object.entries(rolePermissions)) {
      const permIds = permNames.map(name => permMap[name]).filter(id => id);
      await User.updateMany(
        { role: role },
        { $set: { permissions: permIds } }
      );
      console.log(`  - ${role}: ${permIds.length} permissions`);
    }

    // 3. Tạo admin nếu chưa có
    const adminExists = await User.findOne({ username: 'admin' });
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash('123456', 10);
      const admin = new User({
        username: 'admin',
        passwordHash: hashedPassword,
        role: 'admin',
        profile: {
          fullName: 'Quản trị viên',
          phone: '0909123456',
          email: 'admin@school.com'
        },
        status: 'active',
        permissions: Object.values(permMap)
      });
      await admin.save();
      console.log('✅ Đã tạo admin user với toàn quyền');
    } else {
      // Cập nhật admin có toàn quyền
      await User.updateOne(
        { username: 'admin' },
        { $set: { permissions: Object.values(permMap) } }
      );
      console.log('✅ Đã cập nhật admin với toàn quyền');
    }

    console.log('🎉 Seed permissions hoàn tất!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Lỗi seed:', err);
    process.exit(1);
  }
}

seedPermissions();
