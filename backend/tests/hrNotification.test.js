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

test('links one active staff account to one employee profile and synchronizes operational identity', async () => {
  const chef = await User.create({
    username: 'chef-hr', passwordHash: 'x', role: 'chef', status: 'active',
    profile: { fullName: 'Cô Lan bếp', phone: '0911222333', email: 'lan.bep@truong.edu.vn' }
  });
  const accounts = await request(app).get('/api/hr/staff-accounts').set(header(admin)).expect(200);
  expect(accounts.body.data.find((account) => account._id === String(chef._id))).toMatchObject({ username: 'chef-hr', suggestedPosition: 'chef', employeeProfile: null });

  const department = await Department.findOne({ code: 'MAM' });
  const created = await request(app).post('/api/hr/employees').set(header(admin)).send({
    userId: chef._id.toString(), employeeCode: 'BEP-2026-001', fullName: 'Cô Lan bếp', phone: '0911222333',
    email: 'lan.bep@truong.edu.vn', departmentId: department._id.toString(), position: 'chef',
    salaryConfig: { baseSalary: 7200000, positionAllowance: 0, lunchAllowance: 0 }
  }).expect(201);
  expect(String(created.body.data.userId)).toBe(String(chef._id));
  const syncedChef = await User.findById(chef._id);
  expect(syncedChef.employeeInfo.employeeId).toBe('BEP-2026-001');
  expect(syncedChef.employeeInfo.position).toBe('chef');

  await request(app).post('/api/hr/employees').set(header(admin)).send({
    userId: chef._id.toString(), employeeCode: 'BEP-2026-002', fullName: 'Cô Lan khác', phone: '0911222334', position: 'chef'
  }).expect(409);

  await request(app).put(`/api/hr/employees/${created.body.data._id}`).set(header(admin)).send({ userId: '' }).expect(200);
  const unlinkedProfile = await Employee.findById(created.body.data._id);
  expect(unlinkedProfile.userId).toBeUndefined();
  expect((await User.findById(chef._id)).employeeInfo?.employeeId).toBeUndefined();

  const unlinkedTeacher = await User.create({ username: 'teacher-unlinked', passwordHash: 'x', role: 'teacher', status: 'active', profile: { fullName: 'Cô Hạnh' } });
  await request(app).post('/api/hr/employees').set(header(admin)).send({
    userId: unlinkedTeacher._id.toString(), employeeCode: 'GV-2026-002', fullName: 'Cô Hạnh', phone: '0900000001', position: 'chef'
  }).expect(422);
});

test('synchronizes only internal accounts into HR profiles and excludes accounts without configured salary from payroll', async () => {
  const chef = await User.create({ username: 'chef-sync', passwordHash: 'x', role: 'chef', status: 'active', profile: { fullName: 'Cô Bếp' } });
  const parent = await User.create({ username: 'parent-sync', passwordHash: 'x', role: 'parent', status: 'active', profile: { fullName: 'Phụ huynh' } });

  const firstSync = await request(app).post('/api/hr/staff-accounts/sync').set(header(admin)).expect(200);
  expect(firstSync.body.data.created.map((item) => item.fullName)).toEqual(expect.arrayContaining(['Hiệu trưởng', 'Cô Bếp']));
  expect(firstSync.body.data.created.some((item) => item.fullName === 'Phụ huynh')).toBe(false);

  const chefProfile = await Employee.findOne({ userId: chef._id });
  expect(chefProfile).toMatchObject({ fullName: 'Cô Bếp', position: 'chef' });
  expect(chefProfile.employeeCode).toMatch(/^BEP-\d{4}-[A-F0-9]{6}$/);
  expect(chefProfile.salaryConfig.baseSalary).toBe(0);
  expect(await Employee.exists({ userId: parent._id })).toBeNull();
  expect((await User.findById(chef._id)).employeeInfo.employeeId).toBe(chefProfile.employeeCode);

  await request(app).post('/api/hr/staff-accounts/sync').set(header(admin)).expect(200).expect((res) => expect(res.body.data.created).toHaveLength(0));
  const payroll = await request(app).post('/api/hr/payroll/generate').set(header(admin)).send({ month: 9, year: 2026 }).expect(200);
  expect(payroll.body.data.results.map((item) => item.employee)).toEqual(['Cô Mai']);
});
