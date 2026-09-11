process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';

const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const request = require('supertest');
const createApp = require('../app');
const { generateToken } = require('../src/utils/jwt');
const User = require('../src/models/zone1_system/User');
const Classroom = require('../src/models/zone3_school/Classroom');
const Student = require('../src/models/zone3_school/Student');
const StudentCodeCounter = require('../src/models/zone3_school/StudentCodeCounter');
const AuditLog = require('../src/models/zone1_system/AuditLog');

const app = createApp();
let mongo; let admin; let principal; let teacher; let parent; let classroomA; let classroomB; let student;
const token = (user) => ({ Authorization: `Bearer ${generateToken(user)}` });
const user = (role, extra = {}) => User.create({ username: `${role}-${new mongoose.Types.ObjectId()}`, passwordHash: 'not-used', role, status: 'active', profile: { fullName: role }, ...extra });
const payload = (overrides = {}) => ({ fullName: 'Bé Minh', birthDate: '2021-02-01', gender: 'male', classroomId: classroomA, schoolYear: '2026-2027', ...overrides });

beforeAll(async () => { mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } }); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Classroom.deleteMany({}), Student.deleteMany({}), StudentCodeCounter.deleteMany({}), AuditLog.deleteMany({})]);
  [admin, principal, teacher] = await Promise.all([user('admin'), user('principal'), user('teacher')]);
  classroomA = new mongoose.Types.ObjectId(); classroomB = new mongoose.Types.ObjectId();
  await Classroom.create([{ _id: classroomA, name: 'Lớp A', ageGroup: '3-4', statistics: { currentStudents: 1 }, teachers: [{ teacherId: teacher._id, teacherName: 'teacher', role: 'homeroom' }] }, { _id: classroomB, name: 'Lớp B', ageGroup: '4-5' }]);
  student = await Student.create({ studentCode: 'HS-2026-000100', fullName: 'Bé Có Sẵn', birthDate: '2021-01-01', gender: 'female', classroomId: classroomA, className: 'Lớp A', admissionDate: '2026-08-01', schoolYear: '2026-2027', status: 'enrolled' });
  parent = await user('parent', { parentInfo: { studentIds: [student._id] } });
});

describe('Student Core Pha 1', () => {
  test('creates immutable, sequential student codes and increments class size atomically', async () => {
    const [one, two] = await Promise.all([request(app).post('/api/students').set(token(admin)).send(payload({ fullName: 'Bé Một', admissionDate: '2026-08-01' })), request(app).post('/api/students').set(token(admin)).send(payload({ fullName: 'Bé Hai', admissionDate: '2026-08-01' }))]);
    expect([one.status, two.status].sort()).toEqual([201, 201]);
    expect(new Set([one.body.data.studentCode, two.body.data.studentCode]).size).toBe(2);
    expect(one.body.data.studentCode).toMatch(/^HS-2026-\d{6}$/);
    await request(app).put(`/api/students/${one.body.data._id}`).set(token(admin)).send({ studentCode: 'HS-2026-999999' }).expect(400);
    expect((await Classroom.findById(classroomA)).statistics.currentStudents).toBe(3);
  });

  test('validates ObjectId, dates, contacts, filter/search/pagination and school year', async () => {
    await request(app).get('/api/students/nope').set(token(admin)).expect(400);
    await request(app).post('/api/students').set(token(admin)).send(payload({ birthDate: '2999-01-01' })).expect(422);
    await request(app).post('/api/students').set(token(admin)).send(payload({ admissionDate: '2020-01-01' })).expect(422);
    await request(app).post('/api/students').set(token(admin)).send(payload({ parents: [{ fullName: 'Mẹ', phone: '123', email: 'bad' }] })).expect(422);
    const result = await request(app).get('/api/students?search=Có%20Sẵn&schoolYear=2026-2027&page=1&limit=1&sortBy=studentCode').set(token(admin)).expect(200);
    expect(result.body.success).toBe(true); expect(result.body.data).toHaveLength(1); expect(result.body.pagination.total).toBe(1);
  });

  test('enforces teacher field allowlist and role data scope', async () => {
    await request(app).post('/api/students').set(token(teacher)).send(payload({ status: 'pending_admission' })).expect(403);
    await request(app).put(`/api/students/${student._id}`).set(token(teacher)).send({ fullName: 'Được phép', parents: [] }).expect(403);
    await request(app).put(`/api/students/${student._id}`).set(token(teacher)).send({ fullName: 'Được phép' }).expect(200);
    await request(app).put(`/api/students/${student._id}`).set(token(teacher)).send({ classroomId: classroomB }).expect(403);
    for (const role of ['accountant', 'chef', 'guard']) await request(app).get('/api/students').set(token(await user(role))).expect(403);
    const parentDetail = await request(app).get(`/api/students/${student._id}`).set(token(parent)).expect(200);
    expect(parentDetail.body.data).not.toHaveProperty('parents'); expect(parentDetail.body.data).not.toHaveProperty('allergies');
  });

  test('changes status idempotently, validates transitions and preserves headcount', async () => {
    await request(app).patch(`/api/students/${student._id}/status`).set(token(principal)).send({ status: 'temporarily_absent', effectiveDate: '2026-09-01' }).expect(200);
    expect((await Classroom.findById(classroomA)).statistics.currentStudents).toBe(1);
    await request(app).patch(`/api/students/${student._id}/status`).set(token(principal)).send({ status: 'temporarily_absent' }).expect(200);
    await request(app).patch(`/api/students/${student._id}/status`).set(token(principal)).send({ status: 'graduated', effectiveDate: '2020-01-01' }).expect(422);
    await request(app).patch(`/api/students/${student._id}/status`).set(token(principal)).send({ status: 'withdrawn', effectiveDate: '2026-09-02' }).expect(200);
    expect((await Classroom.findById(classroomA)).statistics.currentStudents).toBe(0);
  });

  test('rolls back Student and class size when audit write fails', async () => {
    const spy = jest.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('audit unavailable'));
    await request(app).post('/api/students').set(token(admin)).send(payload()).expect(500);
    expect(await Student.countDocuments({ fullName: 'Bé Minh' })).toBe(0);
    expect((await Classroom.findById(classroomA)).statistics.currentStudents).toBe(1);
    spy.mockRestore();
  });
});
