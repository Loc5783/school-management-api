process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';

const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const request = require('supertest');
const createApp = require('../app');
const { generateToken } = require('../src/utils/jwt');
const User = require('../src/models/zone1_system/User');
const Employee = require('../src/models/zone2_hr/Employee');
const Department = require('../src/models/zone2_hr/Department');
const Payroll = require('../src/models/zone2_hr/Payroll');
const AttendanceRecord = require('../src/models/zone2_hr/AttendanceRecord');
const Notification = require('../src/models/zone1_system/Notification');

const app = createApp(); let server; let admin; let teacher; let employee;
const header = (user) => ({ Authorization: `Bearer ${generateToken(user)}` });

beforeAll(async () => { server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } }); await mongoose.connect(server.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await server.stop(); });
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Employee.deleteMany({}), Department.deleteMany({}), Payroll.deleteMany({}), AttendanceRecord.deleteMany({}), Notification.deleteMany({})]);
  [admin, teacher] = await Promise.all([
    User.create({ username: 'admin-hr', passwordHash: 'x', role: 'admin', profile: { fullName: 'Hiệu trưởng' }, status: 'active' }),
    User.create({ username: 'teacher-hr', passwordHash: 'x', role: 'teacher', profile: { fullName: 'Cô Mai' }, status: 'active' })
  ]);
  const department = await Department.create({ code: 'MAM', name: 'Tổ Mầm' });
  employee = await Employee.create({ userId: teacher._id, employeeCode: 'GV001', fullName: 'Cô Mai', phone: '0900000000', departmentId: department._id, departmentName: department.name, position: 'teacher', salaryConfig: { baseSalary: 7800000, positionAllowance: 0, lunchAllowance: 0 } });
});

test('generates payroll from attendance and protects personal notifications', async () => {
  await AttendanceRecord.create({ userId: teacher._id, employeeName: 'Cô Mai', workDate: new Date('2026-09-01'), workday: 1, status: 'present' });
  const payroll = await request(app).post('/api/hr/payroll/generate').set(header(admin)).send({ month: 9, year: 2026 }).expect(200);
  expect(payroll.body.data.results).toHaveLength(1);
  expect((await Payroll.findOne({ employeeId: employee._id })).actualWorkDays).toBe(1);

  const created = await request(app).post('/api/notifications').set(header(admin)).send({ recipientId: teacher._id, title: 'Thông báo thử', message: 'Nội dung dành cho Cô Mai', type: 'info', link: '/hr' }).expect(201);
  const inbox = await request(app).get('/api/notifications').set(header(teacher)).expect(200);
  expect(inbox.body.unread).toBe(1);
  await request(app).patch(`/api/notifications/${created.body.data._id}/read`).set(header(teacher)).expect(200);
  expect((await Notification.findById(created.body.data._id)).isRead).toBe(true);
});
