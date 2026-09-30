process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');
const createApp = require('../app');
const { generateToken } = require('../src/utils/jwt');
const User = require('../src/models/zone1_system/User');
const Classroom = require('../src/models/zone3_school/Classroom');
const Student = require('../src/models/zone3_school/Student');
const Conversation = require('../src/models/zone1_system/Conversation');
const ChatMessage = require('../src/models/zone1_system/ChatMessage');

const app = createApp();
let mongo;
let parent;
let teacher;
let otherTeacher;
let otherParent;
let student;
let classroom;
const header = (user) => ({ Authorization: `Bearer ${generateToken(user)}` });
const user = (role, name) => User.create({
  username: `${role}-${new mongoose.Types.ObjectId()}`,
  passwordHash: 'x', role, status: 'active', profile: { fullName: name }
});

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Classroom.deleteMany({}), Student.deleteMany({}), Conversation.deleteMany({}), ChatMessage.deleteMany({})]);
  [parent, teacher, otherTeacher, otherParent] = await Promise.all([
    user('parent', 'Mẹ bé An'), user('teacher', 'Cô Hoa'),
    user('teacher', 'Cô lớp khác'), user('parent', 'Phụ huynh khác')
  ]);
  classroom = await Classroom.create({
    name: 'Mầm A', ageGroup: '3-4',
    teachers: [{ teacherId: teacher._id, teacherName: 'Cô Hoa', role: 'homeroom' }]
  });
  student = await Student.create({
    studentCode: 'HS-2026-000901', fullName: 'Bé An', birthDate: new Date('2021-01-01'),
    gender: 'female', classroomId: classroom._id, className: classroom.name, status: 'enrolled'
  });
  parent.parentInfo = { studentIds: [student._id] };
  await parent.save();
  otherParent.parentInfo = { studentIds: [new mongoose.Types.ObjectId()] };
  await otherParent.save();
});

test('parent and assigned teacher can open, send, read and paginate messages', async () => {
  const contacts = await request(app).get('/api/chat/contacts').set(header(parent)).expect(200);
  expect(contacts.body.data).toMatchObject([{ fullName: 'Cô Hoa', studentName: 'Bé An' }]);
  const opened = await request(app).post('/api/chat/conversations').set(header(parent))
    .send({ userId: teacher._id, studentId: student._id }).expect(200);
  const id = opened.body.data._id;
  const reopened = await request(app).post('/api/chat/conversations').set(header(teacher))
    .send({ userId: parent._id, studentId: student._id }).expect(200);
  expect(reopened.body.data._id).toBe(id);

  await request(app).post(`/api/chat/conversations/${id}/messages`).set(header(parent))
    .send({ body: '  Hôm nay con đến muộn  ' }).expect(201);
  const reply = await request(app).post(`/api/chat/conversations/${id}/messages`).set(header(teacher))
    .send({ body: 'Cô đã nhận thông tin.' }).expect(201);
  const inbox = await request(app).get('/api/chat/conversations').set(header(teacher)).expect(200);
  expect(inbox.body.data[0].student.fullName).toBe('Bé An');
  const latest = await request(app).get(`/api/chat/conversations/${id}/messages?limit=1`).set(header(parent)).expect(200);
  expect(latest.body.data[0].body).toBe('Cô đã nhận thông tin.');
  expect(latest.body.hasMore).toBe(true);
  const older = await request(app).get(`/api/chat/conversations/${id}/messages?before=${reply.body.data._id}`)
    .set(header(parent)).expect(200);
  expect(older.body.data[0].body).toBe('Hôm nay con đến muộn');
  await request(app).patch(`/api/chat/conversations/${id}/read`).set(header(parent)).expect(200);
  expect((await ChatMessage.findById(reply.body.data._id)).readAt).toBeTruthy();
});

test('unrelated users and roles cannot discover or read messages', async () => {
  await request(app).get('/api/chat/contacts').expect(401);
  const accountant = await user('accountant', 'Kế toán');
  await request(app).get('/api/chat/contacts').set(header(accountant)).expect(403);
  await request(app).post('/api/chat/conversations').set(header(parent))
    .send({ userId: otherTeacher._id, studentId: student._id }).expect(403);
  await request(app).post('/api/chat/conversations').set(header(otherParent))
    .send({ userId: teacher._id, studentId: student._id }).expect(403);
  const opened = await request(app).post('/api/chat/conversations').set(header(parent))
    .send({ userId: teacher._id, studentId: student._id }).expect(200);
  await request(app).get(`/api/chat/conversations/${opened.body.data._id}/messages`)
    .set(header(otherTeacher)).expect(404);
  await request(app).post(`/api/chat/conversations/${opened.body.data._id}/messages`)
    .set(header(otherTeacher)).send({ body: 'Không hợp lệ' }).expect(404);
});

test('revoking child link or teacher assignment revokes access to history', async () => {
  const opened = await request(app).post('/api/chat/conversations').set(header(parent))
    .send({ userId: teacher._id, studentId: student._id }).expect(200);
  const path = `/api/chat/conversations/${opened.body.data._id}/messages`;
  await request(app).post(path).set(header(parent)).send({ body: 'Tin cũ' }).expect(201);
  await Classroom.updateOne({ _id: classroom._id }, { $set: { teachers: [] } });
  await request(app).get(path).set(header(teacher)).expect(404);
  await request(app).get(path).set(header(parent)).expect(404);
  await Classroom.updateOne({ _id: classroom._id }, { $set: { teachers: [{ teacherId: teacher._id, teacherName: 'Cô Hoa' }] } });
  await User.updateOne({ _id: parent._id }, { $set: { 'parentInfo.studentIds': [] } });
  await request(app).get(path).set(header(parent)).expect(403);
  await request(app).get(path).set(header(teacher)).expect(404);
});
