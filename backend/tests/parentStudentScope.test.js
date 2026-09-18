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
const StudentAttendance = require('../src/models/zone3_school/StudentAttendance');
const StudentLeaveRequest = require('../src/models/zone3_school/StudentLeaveRequest');
const TuitionFee = require('../src/models/zone4_finance/TuitionFee');

const app = createApp();

let mongoServer;
let classroomA;
let classroomB;
let studentA;
let studentB;
let studentC;
let parentOne;
let parentMany;
let parentNone;
let parentSuspended;
let admin;
let principal;
let teacher;
let accountant;
let attendanceA;
let attendanceB;

const createUser = (overrides = {}) => User.create({
    username: `user-${new mongoose.Types.ObjectId().toString()}`,
    passwordHash: 'not-used-by-this-api-test',
    role: 'parent',
    profile: { fullName: 'Người dùng kiểm thử' },
    status: 'active',
    ...overrides
});

const authHeader = (user) => ({ Authorization: `Bearer ${generateToken(user)}` });

beforeAll(async () => {
    mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

beforeEach(async () => {
    await Promise.all([
        User.deleteMany({}),
        Classroom.deleteMany({}),
        Student.deleteMany({}),
        StudentCodeCounter.deleteMany({}),
        StudentAttendance.deleteMany({}),
        StudentLeaveRequest.deleteMany({}),
        TuitionFee.deleteMany({})
    ]);

    classroomA = new mongoose.Types.ObjectId();
    classroomB = new mongoose.Types.ObjectId();
    [admin, principal, teacher, accountant] = await Promise.all([
        createUser({ role: 'admin', profile: { fullName: 'Quản trị viên' } }),
        createUser({ role: 'principal', profile: { fullName: 'Hiệu trưởng' } }),
        createUser({ role: 'teacher', profile: { fullName: 'Giáo viên A' } }),
        createUser({ role: 'accountant', profile: { fullName: 'Kế toán' } })
    ]);

    await Classroom.create([
        {
            _id: classroomA,
            name: 'Lớp A',
            ageGroup: '3-4', statistics: { currentStudents: 2 },
            teachers: [{ teacherId: teacher._id, teacherName: 'Giáo viên A', role: 'homeroom' }]
        },
        { _id: classroomB, name: 'Lớp B', ageGroup: '4-5', statistics: { currentStudents: 1 } }
    ]);
    await StudentCodeCounter.create({ year: 2026, sequence: 3 });

    [studentA, studentB, studentC] = await Student.create([
        {
            studentCode: 'HS-2026-000001',
            fullName: 'Bé An',
            birthDate: new Date('2020-01-01'),
            gender: 'male',
            classroomId: classroomA,
            className: 'Lớp A',
            status: 'enrolled'
        },
        {
            studentCode: 'HS-2026-000002',
            fullName: 'Bé Bình',
            birthDate: new Date('2020-02-02'),
            gender: 'female',
            classroomId: classroomB,
            className: 'Lớp B',
            status: 'enrolled'
        },
        {
            studentCode: 'HS-2026-000003',
            fullName: 'Bé Chi',
            birthDate: new Date('2020-03-03'),
            gender: 'female',
            classroomId: classroomA,
            className: 'Lớp A',
            status: 'enrolled'
        }
    ]);

    [parentOne, parentMany, parentNone, parentSuspended] = await Promise.all([
        createUser({ parentInfo: { studentIds: [studentA._id] } }),
        createUser({ parentInfo: { studentIds: [studentA._id, studentB._id] } }),
        createUser({ parentInfo: { studentIds: [] } }),
        createUser({ parentInfo: { studentIds: [studentA._id] } })
    ]);

    [attendanceA, attendanceB] = await StudentAttendance.create([
        {
            studentId: studentA._id,
            studentName: studentA.fullName,
            classroomId: classroomA,
            className: 'Lớp A',
            attendDate: new Date('2026-08-28T00:00:00.000Z'),
            status: 'present',
            recordedBy: admin._id,
            recordedByName: 'Quản trị viên'
        },
        {
            studentId: studentB._id,
            studentName: studentB.fullName,
            classroomId: classroomB,
            className: 'Lớp B',
            attendDate: new Date('2026-08-28T00:00:00.000Z'),
            status: 'present',
            recordedBy: admin._id,
            recordedByName: 'Quản trị viên'
        }
    ]);

    await TuitionFee.create([
        {
            studentId: studentA._id,
            studentName: studentA.fullName,
            classroomId: classroomA,
            className: 'Lớp A',
            period: '08-2026',
            tuitionBase: 1000000,
            totalAmount: 1000000,
            dueDate: new Date('2026-08-31')
        },
        {
            studentId: studentB._id,
            studentName: studentB.fullName,
            classroomId: classroomB,
            className: 'Lớp B',
            period: '08-2026',
            tuitionBase: 1000000,
            totalAmount: 1000000,
            dueDate: new Date('2026-08-31')
        }
    ]);
});

describe('parent student data scope', () => {
    test('denies unauthenticated student-list requests', async () => {
        await request(app).get('/api/students').expect(401);
    });

    test('returns only the linked child for a parent with one child', async () => {
        const response = await request(app)
            .get('/api/students')
            .set(authHeader(parentOne))
            .expect(200);

        expect(response.body.data.map((student) => student._id)).toEqual([studentA._id.toString()]);
    });

    test('returns all and only linked children for a parent with many children', async () => {
        const response = await request(app)
            .get('/api/students')
            .set(authHeader(parentMany))
            .expect(200);

        expect(response.body.data.map((student) => student._id).sort())
            .toEqual([studentA._id.toString(), studentB._id.toString()].sort());
    });

    test('blocks all data access for a parent without linked children', async () => {
        const response = await request(app)
            .get('/api/students')
            .set(authHeader(parentNone))
            .expect(403);

        expect(response.body.code).toBe('PARENT_STUDENT_NOT_LINKED');
    });

    test('does not let a classroom query bypass the parent student scope', async () => {
        const response = await request(app)
            .get(`/api/students?classroomId=${classroomB}`)
            .set(authHeader(parentOne))
            .expect(200);

        expect(response.body.data).toEqual([]);
    });

    test('lets a parent view detail for their linked child', async () => {
        const response = await request(app)
            .get(`/api/students/${studentA._id}`)
            .set(authHeader(parentOne))
            .expect(200);

        expect(response.body.data._id).toBe(studentA._id.toString());
    });

    test('denies a parent who requests another existing child', async () => {
        const response = await request(app)
            .get(`/api/students/${studentB._id}`)
            .set(authHeader(parentOne))
            .expect(403);

        expect(response.body.message).toBe('Bạn không có quyền xem thông tin học sinh này');
    });

    test('returns 400 for a malformed student id', async () => {
        const response = await request(app)
            .get('/api/students/not-an-object-id')
            .set(authHeader(parentOne))
            .expect(400);

        expect(response.body.message).toBe('ID học sinh không hợp lệ');
    });

    test('returns 404 for a well-formed but unknown student id', async () => {
        await request(app)
            .get(`/api/students/${new mongoose.Types.ObjectId()}`)
            .set(authHeader(admin))
            .expect(404);
    });

    test('returns attendance for a linked child', async () => {
        const response = await request(app)
            .get(`/api/attendance/student/${studentA._id}?startDate=2026-08-01&endDate=2026-08-31`)
            .set(authHeader(parentOne))
            .expect(200);

        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0].studentId).toBe(studentA._id.toString());
    });

    test('denies attendance for another child before returning any records', async () => {
        const response = await request(app)
            .get(`/api/attendance/student/${studentB._id}`)
            .set(authHeader(parentOne))
            .expect(403);

        expect(response.body.message).toBe('Bạn không có quyền xem dữ liệu điểm danh của học sinh này');
    });

    test('validates attendance date query parameters', async () => {
        await request(app)
            .get(`/api/attendance/student/${studentA._id}?startDate=2026-02-30`)
            .set(authHeader(parentOne))
            .expect(400);
    });

    test('includes the complete end date when querying attendance history', async () => {
        await StudentAttendance.create({
            studentId: studentA._id,
            studentName: studentA.fullName,
            classroomId: classroomA,
            className: 'Lớp A',
            attendDate: new Date('2026-08-31T16:00:00.000Z'),
            status: 'late',
            recordedBy: admin._id,
            recordedByName: 'Quản trị viên'
        });

        const response = await request(app)
            .get(`/api/attendance/student/${studentA._id}?startDate=2026-08-31&endDate=2026-08-31`)
            .set(authHeader(parentOne))
            .expect(200);

        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0].status).toBe('late');
    });

    test('denies parent access to attendance by classroom', async () => {
        const response = await request(app)
            .get(`/api/attendance/class/${classroomA}`)
            .set(authHeader(parentOne))
            .expect(403);

        expect(response.body.message).toBe('Phụ huynh không có quyền xem điểm danh theo lớp');
    });

    test('keeps administrator student-list access unchanged', async () => {
        const response = await request(app)
            .get('/api/students')
            .set(authHeader(admin))
            .expect(200);

        expect(response.body.data).toHaveLength(3);
    });

    test('keeps principal student-list access unchanged', async () => {
        const response = await request(app)
            .get('/api/students')
            .set(authHeader(principal))
            .expect(200);

        expect(response.body.data).toHaveLength(3);
    });

    test('limits a teacher to students in their assigned classroom', async () => {
        const response = await request(app)
            .get('/api/students')
            .set(authHeader(teacher))
            .expect(200);

        expect(response.body.data.map((student) => student._id).sort())
            .toEqual([studentA._id.toString(), studentC._id.toString()].sort());
    });

    test('does not let a classroom query broaden a teacher student scope', async () => {
        const response = await request(app)
            .get(`/api/students?classroomId=${classroomB}`)
            .set(authHeader(teacher))
            .expect(200);

        expect(response.body.data).toEqual([]);
    });

    test('denies a teacher who requests a student in another classroom', async () => {
        await request(app)
            .get(`/api/students/${studentB._id}`)
            .set(authHeader(teacher))
            .expect(403);
    });

    test('allows a teacher to create a student only in an assigned classroom', async () => {
        const ownClassResponse = await request(app)
            .post('/api/students')
            .set(authHeader(teacher))
            .send({ fullName: 'Bé Dũng', birthDate: '2021-01-01', gender: 'male', classroomId: classroomA })
            .expect(201);
        expect(ownClassResponse.body.data.classroomId).toBe(classroomA.toString());

        await request(app)
            .post('/api/students')
            .set(authHeader(teacher))
            .send({ fullName: 'Bé Dương', birthDate: '2021-01-01', gender: 'female', classroomId: classroomB })
            .expect(403);
    });

    test('scopes teacher updates and ignores student fields outside the allowlist', async () => {
        const response = await request(app)
            .put(`/api/students/${studentA._id}`)
            .set(authHeader(teacher))
            .send({ fullName: 'Bé An đã cập nhật' })
            .expect(200);

        expect(response.body.data.fullName).toBe('Bé An đã cập nhật');
        expect(response.body.data.status).toBe('enrolled');

        await request(app)
            .put(`/api/students/${studentA._id}`)
            .set(authHeader(teacher))
            .send({ status: 'withdrawn', attendanceCardId: 'UNAUTHORIZED-CARD' })
            .expect(403);

        await request(app)
            .put(`/api/students/${studentA._id}`)
            .set(authHeader(teacher))
            .send({ classroomId: classroomB })
            .expect(403);
    });

    test('allows a teacher to view attendance for their assigned classroom only', async () => {
        await request(app)
            .get(`/api/attendance/class/${classroomA}`)
            .set(authHeader(teacher))
            .expect(200);

        await request(app)
            .get(`/api/attendance/class/${classroomB}`)
            .set(authHeader(teacher))
            .expect(403);
    });

    test('allows a teacher to update attendance in their assigned classroom only', async () => {
        const response = await request(app)
            .put(`/api/attendance/${attendanceA._id}`)
            .set(authHeader(teacher))
            .send({ status: 'late', note: 'Đến muộn do kẹt xe', studentId: studentB._id })
            .expect(200);

        expect(response.body.data.status).toBe('late');
        expect(response.body.data.note).toBe('Đến muộn do kẹt xe');
        expect(response.body.data.studentId).toBe(studentA._id.toString());

        await request(app)
            .put(`/api/attendance/${attendanceB._id}`)
            .set(authHeader(teacher))
            .send({ status: 'late' })
            .expect(403);
    });

    test('rejects a batch containing a student from another classroom', async () => {
        await request(app)
            .post('/api/attendance/bulk')
            .set(authHeader(teacher))
            .send({
                classroomId: classroomA,
                attendDate: '2026-08-25',
                records: [{ studentId: studentB._id, status: 'present' }]
            })
            .expect(400);
    });

    test('keeps batch attendance idempotent when the request is retried', async () => {
        const payload = {
            classroomId: classroomA,
            attendDate: '2026-08-25',
            records: [{ studentId: studentC._id, status: 'present' }]
        };

        await request(app)
            .post('/api/attendance/bulk')
            .set(authHeader(teacher))
            .send(payload)
            .expect(201);

        await request(app)
            .post('/api/attendance/bulk')
            .set(authHeader(teacher))
            .send(payload)
            .expect(200);

        expect(await StudentAttendance.countDocuments({ studentId: studentC._id })).toBe(1);
        expect((await StudentAttendance.findOne({ studentId: studentC._id })).attendanceDateKey).toBe('2026-08-25');
    });

    test('denies student and attendance data to an accountant role', async () => {
        await request(app)
            .get('/api/students')
            .set(authHeader(accountant))
            .expect(403);

        await request(app)
            .get(`/api/attendance/student/${studentA._id}`)
            .set(authHeader(accountant))
            .expect(403);
    });

    test('lets a parent read tuition for their own child only', async () => {
        const ownResponse = await request(app)
            .get(`/api/finance/tuition/student/${studentA._id}`)
            .set(authHeader(parentOne))
            .expect(200);
        expect(ownResponse.body.data).toHaveLength(1);

        const otherResponse = await request(app)
            .get(`/api/finance/tuition/student/${studentB._id}`)
            .set(authHeader(parentOne))
            .expect(403);
        expect(otherResponse.body.message).toBe('Bạn không có quyền xem học phí của học sinh này');
    });

    test('lets an accountant read tuition but not student profiles', async () => {
        await request(app)
            .get(`/api/finance/tuition/student/${studentA._id}`)
            .set(authHeader(accountant))
            .expect(200);

        await request(app)
            .get(`/api/students/${studentA._id}`)
            .set(authHeader(accountant))
            .expect(403);
    });

    test('returns 400 instead of a CastError for malformed IDs', async () => {
        await request(app)
            .post('/api/attendance/bulk')
            .set(authHeader(teacher))
            .send({ classroomId: 'invalid-id', records: [{ studentId: studentA._id, status: 'present' }] })
            .expect(400);

        await request(app)
            .put('/api/attendance/not-an-object-id')
            .set(authHeader(teacher))
            .send({ status: 'late' })
            .expect(400);

        await request(app)
            .get('/api/finance/tuition/class/not-an-object-id')
            .set(authHeader(accountant))
            .expect(400);

        await request(app)
            .get('/api/reports/not-an-object-id')
            .set(authHeader(admin))
            .expect(400);
    });

    test('denies parents from tuition by classroom and reporting endpoints', async () => {
        await request(app)
            .get(`/api/finance/tuition/class/${classroomA}`)
            .set(authHeader(parentOne))
            .expect(403);

        await request(app)
            .get('/api/reports/dashboard')
            .set(authHeader(parentOne))
            .expect(403);

        await request(app)
            .get('/api/reports/finance?period=08-2026')
            .set(authHeader(parentOne))
            .expect(403);
    });

    test('returns the dashboard payload consumed by the frontend for an administrator', async () => {
        const response = await request(app)
            .get('/api/reports/dashboard')
            .set(authHeader(admin))
            .expect(200);

        expect(response.body.data.summary).toEqual(expect.objectContaining({
            totalStudents: 3,
            totalClassrooms: 2,
            totalTeachers: 1,
            todayRevenue: 0
        }));
        expect(Array.isArray(response.body.data.recentAttendance)).toBe(true);
    });

    test('rejects a valid token when the parent account has been suspended', async () => {
        const token = generateToken(parentSuspended);
        await User.findByIdAndUpdate(parentSuspended._id, { status: 'suspended' });

        await request(app)
            .get('/api/students')
            .set({ Authorization: `Bearer ${token}` })
            .expect(401);
    });

    test('creates class tuition atomically and prevents generating the same period twice', async () => {
        const payload = { classroomId: classroomA, period: '09-2026', tuitionBase: 1200000, mealFee: 300000, busFee: 0, extraFee: 0, discount: 0, dueDate: '2026-09-30' };
        const created = await request(app).post('/api/finance/tuition/bulk').set(authHeader(admin)).send(payload).expect(201);
        expect(created.body.data).toHaveLength(2);
        await request(app).post('/api/finance/tuition/bulk').set(authHeader(admin)).send(payload).expect(409);
        const list = await request(app).get('/api/finance/invoices?period=09-2026').set(authHeader(accountant)).expect(200);
        expect(list.body.pagination.total).toBe(2);
        const debts = await request(app).get('/api/finance/debts?period=09-2026').set(authHeader(accountant)).expect(200);
        expect(debts.body.summary.totalDebt).toBe(3000000);
    });

    test('lets a parent request leave only for a linked child and principal approval creates permitted attendance', async () => {
        const schoolNow = new Date();
        const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short' }).format(schoolNow);
        if (weekday === 'Sat') schoolNow.setUTCDate(schoolNow.getUTCDate() + 2);
        if (weekday === 'Sun') schoolNow.setUTCDate(schoolNow.getUTCDate() + 1);
        const workDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })
            .formatToParts(schoolNow).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
        const dateKey = `${workDate.year}-${workDate.month}-${workDate.day}`;
        const created = await request(app)
            .post('/api/attendance/leave-requests')
            .set(authHeader(parentOne))
            .send({ studentId: studentA._id, startDate: dateKey, endDate: dateKey, reason: 'Bé cần nghỉ để theo dõi sức khỏe.' })
            .expect(201);
        expect(created.body.success).toBe(true);

        await request(app)
            .post('/api/attendance/leave-requests')
            .set(authHeader(parentOne))
            .send({ studentId: studentB._id, startDate: dateKey, endDate: dateKey, reason: 'Không được gửi cho học sinh khác.' })
            .expect(403);

        await request(app)
            .patch(`/api/attendance/leave-requests/${created.body.data._id}/review`)
            .set(authHeader(principal))
            .send({ decision: 'approved', reviewNote: 'Chúc bé mau khỏe.' })
            .expect(200);
        expect(await StudentAttendance.exists({ studentId: studentA._id, attendanceDateKey: dateKey, status: 'absent_permission' })).toBeTruthy();

        const history = await request(app).get('/api/attendance/leave-requests').set(authHeader(parentOne)).expect(200);
        expect(history.body.data).toHaveLength(1);
        expect(history.body.data[0].status).toBe('approved');
    });

    test('keeps absence reports restricted to school attendance roles', async () => {
        await request(app).get('/api/attendance/reports/absence').set(authHeader(parentOne)).expect(403);
        const response = await request(app).get('/api/attendance/reports/absence').set(authHeader(teacher)).expect(200);
        expect(response.body.success).toBe(true);
        expect(Array.isArray(response.body.data.students)).toBe(true);
    });

    test('only permits public parent registration and always assigns one parent role', async () => {
        await request(app)
            .post('/api/auth/register')
            .send({ username: 'phuhuynh-test', password: 'mat-khau-test-123', role: 'teacher', profile: { fullName: 'Phụ huynh test' } })
            .expect(400);

        const response = await request(app)
            .post('/api/auth/register')
            .send({ username: 'phuhuynh-hop-le', password: 'mat-khau-test-123', profile: { fullName: 'Phụ huynh hợp lệ' }, parentInfo: { requestedClassroomId: classroomA, registrationNote: 'Phụ huynh của bé An, cần liên kết hồ sơ.' } })
            .expect(201);
        expect(response.body.data).toEqual(expect.objectContaining({ role: 'parent', status: 'inactive' }));
        expect(await User.exists({ username: 'phuhuynh-hop-le', role: 'parent' })).toBeTruthy();
    });

    test('lets an administrator create and assign exactly one internal role', async () => {
        const created = await request(app)
            .post('/api/system/accounts')
            .set(authHeader(admin))
            .send({ username: 'giaovien-test', password: 'mat-khau-test-123', role: 'teacher', profile: { fullName: 'Giáo viên test' } })
            .expect(201);
        expect(created.body.data.role).toBe('teacher');

        await request(app)
            .patch(`/api/system/accounts/${created.body.data._id}/role`)
            .set(authHeader(admin))
            .send({ role: ['teacher', 'chef'] })
            .expect(422);

        const updated = await request(app)
            .patch(`/api/system/accounts/${created.body.data._id}/role`)
            .set(authHeader(admin))
            .send({ role: 'chef' })
            .expect(200);
        expect(updated.body.data.role).toBe('chef');
        expect(await User.exists({ _id: created.body.data._id, role: 'chef' })).toBeTruthy();

        const edited = await request(app)
            .patch(`/api/system/accounts/${created.body.data._id}`)
            .set(authHeader(admin))
            .send({ username: 'nhanvien-bep-test', status: 'suspended', profile: { fullName: 'Nhân viên bếp test', phone: '0901000000', email: 'bep@example.test' } })
            .expect(200);
        expect(edited.body.data).toEqual(expect.objectContaining({ username: 'nhanvien-bep-test', status: 'suspended', role: 'chef' }));

        const deactivated = await request(app)
            .delete(`/api/system/accounts/${created.body.data._id}`)
            .set(authHeader(admin))
            .send({ reason: 'Kết thúc tài khoản thử nghiệm' })
            .expect(200);
        expect(deactivated.body.data.status).toBe('inactive');
    });
});
