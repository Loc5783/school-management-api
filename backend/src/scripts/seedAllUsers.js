const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Import models
const User = require('../models/zone1_system/User');
const Permission = require('../models/zone1_system/Permission');

// Danh sách user cần tạo
const users = [
  {
    username: 'admin',
    password: '123456',
    role: 'admin',
    fullName: 'Quản trị viên',
    phone: '0909123456',
    email: 'admin@school.com'
  },
  {
    username: 'principal',
    password: '123456',
    role: 'principal',
    fullName: 'Hiệu trưởng Nguyễn Văn A',
    phone: '0909123457',
    email: 'principal@school.com'
  },
  {
    username: 'teacher',
    password: '123456',
    role: 'teacher',
    fullName: 'Cô giáo Nguyễn Thị B',
    phone: '0909123458',
    email: 'teacher@school.com'
  },
  {
    username: 'accountant',
    password: '123456',
    role: 'accountant',
    fullName: 'Kế toán Trần Văn C',
    phone: '0909123459',
    email: 'accountant@school.com'
  },
  {
    username: 'chef',
    password: '123456',
    role: 'chef',
    fullName: 'Đầu bếp Lê Văn D',
    phone: '0909123460',
    email: 'chef@school.com'
  },
  {
    username: 'guard',
    password: '123456',
    role: 'guard',
    fullName: 'Bảo vệ Phạm Văn E',
    phone: '0909123461',
    email: 'guard@school.com'
  },
  {
    username: 'parent',
    password: '123456',
    role: 'parent',
    fullName: 'Phụ huynh Nguyễn Văn F',
    phone: '0909123462',
    email: 'parent@school.com'
  }
];

// Định nghĩa quyền theo role
const rolePermissions = {
  admin: [], // Admin có toàn quyền, không cần gán
  principal: [
    'student.read', 'student.create', 'student.update', 'student.delete',
    'classroom.read', 'classroom.manage',
    'attendance.manage',
    'tuition.read',
    'report.read',
    'attendance.correction',
    'employee.manage'
  ],
  teacher: [
    'student.read', 'student.create', 'student.update',
    'classroom.read',
    'attendance.manage'
  ],
  accountant: [
    'tuition.read', 'tuition.create', 'tuition.update',
    'payment.create',
    'report.read'
  ],
  chef: [
    'menu.manage',
    'inventory.manage'
  ],
  guard: [
    'attendance.manage'
  ],
  parent: [
    'student.read' // Chỉ xem thông tin con mình
  ]
};

async function seedAllUsers() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Kết nối MongoDB thành công');

    // Tạo permissions nếu chưa có
    const allPermissions = [
      // School
      { name: 'student.read', module: 'school', resource: 'student', action: 'read' },
      { name: 'student.create', module: 'school', resource: 'student', action: 'create' },
      { name: 'student.update', module: 'school', resource: 'student', action: 'update' },
      { name: 'student.delete', module: 'school', resource: 'student', action: 'delete' },
      { name: 'classroom.read', module: 'school', resource: 'classroom', action: 'read' },
      { name: 'classroom.manage', module: 'school', resource: 'classroom', action: 'manage' },
      { name: 'attendance.manage', module: 'school', resource: 'attendance', action: 'manage' },
      // Finance
      { name: 'tuition.read', module: 'finance', resource: 'tuition', action: 'read' },
      { name: 'tuition.create', module: 'finance', resource: 'tuition', action: 'create' },
      { name: 'tuition.update', module: 'finance', resource: 'tuition', action: 'update' },
      { name: 'payment.create', module: 'finance', resource: 'payment', action: 'create' },
      // Nutrition
      { name: 'menu.manage', module: 'nutrition', resource: 'menu', action: 'manage' },
      { name: 'inventory.manage', module: 'nutrition', resource: 'inventory', action: 'manage' },
      // HR
      { name: 'attendance.correction', module: 'hr', resource: 'attendance', action: 'approve' },
      { name: 'employee.manage', module: 'hr', resource: 'employee', action: 'manage' },
      // Report
      { name: 'report.read', module: 'report', resource: 'report', action: 'read' },
    ];

    const permissionMap = {};
    for (const p of allPermissions) {
      const doc = await Permission.findOneAndUpdate(
        { name: p.name },
        p,
        { upsert: true, new: true }
      );
      permissionMap[p.name] = doc._id;
    }
    console.log('✅ Đã tạo permissions');

    // Tạo từng user
    for (const userData of users) {
      const existing = await User.findOne({ username: userData.username });

      // Lấy danh sách permission IDs cho role
      let permissionIds = [];
      if (userData.role !== 'admin') {
        const permNames = rolePermissions[userData.role] || [];
        permissionIds = permNames.map(name => permissionMap[name]).filter(Boolean);
      }

      if (existing) {
        // Cập nhật user hiện có
        existing.profile = {
          fullName: userData.fullName,
          phone: userData.phone,
          email: userData.email
        };
        if (userData.role !== 'admin') {
          existing.permissions = permissionIds;
        }
        await existing.save();
        console.log(`✅ Cập nhật user: ${userData.username} (${userData.role})`);
      } else {
        // Tạo user mới
        const hashedPassword = await bcrypt.hash(userData.password, 10);
        const newUser = new User({
          username: userData.username,
          passwordHash: hashedPassword,
          role: userData.role,
          profile: {
            fullName: userData.fullName,
            phone: userData.phone,
            email: userData.email
          },
          permissions: permissionIds,
          status: 'active'
        });
        await newUser.save();
        console.log(`✅ Tạo user: ${userData.username} (${userData.role})`);
      }
    }

    console.log('✅ Seed hoàn tất!');
    console.log('📋 Danh sách tài khoản để đăng nhập:');
    console.log('   admin / 123456 (Admin - toàn quyền)');
    console.log('   principal / 123456 (Hiệu trưởng)');
    console.log('   teacher / 123456 (Giáo viên)');
    console.log('   accountant / 123456 (Kế toán)');
    console.log('   chef / 123456 (Đầu bếp)');
    console.log('   guard / 123456 (Bảo vệ)');
    console.log('   parent / 123456 (Phụ huynh)');
    process.exit(0);
  } catch (err) {
    console.error('❌ Lỗi seed:', err);
    process.exit(1);
  }
}

seedAllUsers();
