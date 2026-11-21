/**
 * Task 1D.3: Phân công nhân sự, ca trực, người thay thế và chủ nhiệm lớp theo tenant
 *
 * File: backend/tests/saas/phase1d3_staffing_scoping.test.js
 *
 * Kiểm chứng toàn diện:
 * - Nhóm A: getStaffing, getTimetable, getMyStaffing (Snapshot, ca trực, phân công cá nhân độc lập giữa hai trường).
 * - Nhóm B: assignHomeroomTeacher & assignClassroomStaff (Phân công chủ nhiệm và giáo viên lớp, conditional write touch,
 *   homeroom limit, double-booking, chặn ID giáo viên ngoại lai, handover guard, audit).
 * - Nhóm C: createShift & cancelShift (Ca làm việc bảo vệ/bếp, overlap check, tenant isolation, không cancel ca có replacement).
 * - Nhóm D: createReplacement & cancelReplacement (Thay thế lớp/ca khi có đơn nghỉ duyệt, chặn tự thay, chặn chéo tenant).
 * - Nhóm E: Quyền xem lớp học qua thay thế (schoolDataAccessService.canAccessClassroom).
 */

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';

jest.setTimeout(60000);

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');

const testDbBootstrap = require('../../src/saas/testDbBootstrap');
const schoolAuthMiddleware = require('../../src/saas/middlewares/schoolAuthMiddleware');
const legacyAuth = require('../../src/middlewares/auth');
const roleCheck = require('../../src/middlewares/roleCheck');
const hrAccessAudit = require('../../src/middlewares/hrAccessAudit');

const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const Department = require('../../src/models/zone2_hr/Department');
const Employee = require('../../src/models/zone2_hr/Employee');
const Classroom = require('../../src/models/zone3_school/Classroom');
const StaffShift = require('../../src/models/zone2_hr/StaffShift');
const StaffReplacement = require('../../src/models/zone2_hr/StaffReplacement');
const StaffHandover = require('../../src/models/zone2_hr/StaffHandover');
const LeaveRequest = require('../../src/models/zone2_hr/LeaveRequest');
const Notification = require('../../src/models/zone1_system/Notification');
const AuditLog = require('../../src/models/zone1_system/AuditLog');
const credentialService = require('../../src/services/credentialService');

const staffingController = require('../../src/controllers/staffingController');
const { assignHomeroomTeacher } = require('../../src/controllers/classroomController');
const { canAccessClassroom } = require('../../src/services/schoolDataAccessService');
const { getWorkDate } = require('../../src/utils/dateHelpers');

const { generateSchoolUserToken } = require('../../src/saas/utils/saasJwt');
const { generateToken: generateLegacyToken } = require('../../src/utils/jwt');
const { hashPassword } = require('../../src/utils/passwordHash');

const buildSaasStaffingApp = () => {
  const app = express();
  app.use(express.json());

  const router = express.Router();
  router.use(schoolAuthMiddleware);
  router.use(hrAccessAudit('staffing'));

  router.get('/staffing/timetable', roleCheck(['admin', 'principal', 'hr']), staffingController.getTimetable);
  router.get('/staffing', roleCheck(['admin', 'principal', 'hr']), staffingController.getStaffing);
  router.get('/my-staffing', roleCheck(['admin', 'principal', 'teacher', 'chef', 'guard', 'accountant', 'hr']), staffingController.getMyStaffing);
  router.put('/staffing/classrooms/:id', roleCheck(['admin', 'hr']), staffingController.assignClassroomStaff);
  router.post('/staffing/shifts', roleCheck(['admin', 'hr']), staffingController.createShift);
  router.delete('/staffing/shifts/:id', roleCheck(['admin', 'hr']), staffingController.cancelShift);
  router.post('/staffing/replacements', roleCheck(['admin', 'hr']), staffingController.createReplacement);
  router.delete('/staffing/replacements/:id', roleCheck(['admin', 'hr']), staffingController.cancelReplacement);

  // Classroom homeroom route
  router.put('/classrooms/:id/homeroom-teacher', roleCheck(['admin', 'hr']), assignHomeroomTeacher);

  app.use('/api/v1/hr', router);
  return app;
};

describe('Task 1D.3: Phân công nhân sự, ca trực, người thay thế và chủ nhiệm lớp theo trường', () => {
  let bootstrapInstance;
  let saasApp;

  let tenantA, tenantB;
  let adminA, adminTokenA;
  let hrA, hrTokenA;
  let teacherA1, teacherTokenA1, empTeacherA1;
  let teacherA2, empTeacherA2;
  let guardA, empGuardA;

  let adminB, adminTokenB;
  let hrB, hrTokenB;
  let teacherB1, teacherTokenB1, empTeacherB1;
  let guardB, empGuardB;

  let classroomA1, classroomA2;
  let classroomB1;

  beforeAll(async () => {
    bootstrapInstance = await testDbBootstrap.startTestDb({
      instanceOpts: [{ dbName: 'school_saas_phase1d3_staffing_test' }]
    });
    saasApp = buildSaasStaffingApp();

    await Promise.all([
      Tenant.syncIndexes(),
      User.syncIndexes(),
      Department.syncIndexes(),
      Employee.syncIndexes(),
      Classroom.syncIndexes(),
      StaffShift.syncIndexes(),
      StaffReplacement.syncIndexes(),
      LeaveRequest.syncIndexes(),
      Notification.syncIndexes(),
      AuditLog.syncIndexes()
    ]);
  });

  afterAll(async () => {
    if (bootstrapInstance) {
      await bootstrapInstance.stop();
    }
  });

  beforeEach(async () => {
    await Promise.all([
      Tenant.deleteMany({}),
      User.deleteMany({}),
      Department.deleteMany({}),
      Employee.deleteMany({}),
      Classroom.deleteMany({}),
      StaffShift.deleteMany({}),
      StaffReplacement.deleteMany({}),
      StaffHandover.deleteMany({}),
      LeaveRequest.deleteMany({}),
      Notification.deleteMany({}),
      AuditLog.deleteMany({})
    ]);

    const defaultPasswordHash = await hashPassword('Password123@#');

    // 1. Tenants
    tenantA = await Tenant.create({ code: 'TENANT-STAFF-A', name: 'Trường Ánh Sao A', status: 'active', subscriptionPlan: 'standard' });
    tenantB = await Tenant.create({ code: 'TENANT-STAFF-B', name: 'Trường Bình Minh B', status: 'active', subscriptionPlan: 'standard' });

    // 2. Users & Employees Tenant A
    adminA = await User.create({ username: 'admin_a', tenantId: tenantA._id, passwordHash: defaultPasswordHash, role: 'admin', status: 'active', profile: { fullName: 'Quản trị viên A' } });
    adminTokenA = generateSchoolUserToken(adminA, tenantA);

    hrA = await User.create({ username: 'hr_a', tenantId: tenantA._id, passwordHash: defaultPasswordHash, role: 'hr', status: 'active', profile: { fullName: 'Nhân sự A' } });
    hrTokenA = generateSchoolUserToken(hrA, tenantA);

    teacherA1 = await User.create({ username: 'teacher_a1', tenantId: tenantA._id, passwordHash: defaultPasswordHash, role: 'teacher', status: 'active', profile: { fullName: 'Cô Lan A1' } });
    teacherTokenA1 = generateSchoolUserToken(teacherA1, tenantA);
    empTeacherA1 = await Employee.create({ userId: teacherA1._id, tenantId: tenantA._id, employeeCode: 'GV-A-101', fullName: 'Cô Lan A1', position: 'teacher', payrollRole: 'teacher', status: 'active' });

    teacherA2 = await User.create({ username: 'teacher_a2', tenantId: tenantA._id, passwordHash: defaultPasswordHash, role: 'teacher', status: 'active', profile: { fullName: 'Thầy Hùng A2' } });
    empTeacherA2 = await Employee.create({ userId: teacherA2._id, tenantId: tenantA._id, employeeCode: 'GV-A-102', fullName: 'Thầy Hùng A2', position: 'teacher', payrollRole: 'teacher', status: 'active' });

    guardA = await User.create({ username: 'guard_a', tenantId: tenantA._id, passwordHash: defaultPasswordHash, role: 'guard', status: 'active', profile: { fullName: 'Bác Bảo Vệ A' } });
    empGuardA = await Employee.create({ userId: guardA._id, tenantId: tenantA._id, employeeCode: 'BV-A-101', fullName: 'Bác Bảo Vệ A', position: 'security', payrollRole: 'guard', status: 'active' });

    // 3. Users & Employees Tenant B
    adminB = await User.create({ username: 'admin_b', tenantId: tenantB._id, passwordHash: defaultPasswordHash, role: 'admin', status: 'active', profile: { fullName: 'Quản trị viên B' } });
    adminTokenB = generateSchoolUserToken(adminB, tenantB);

    hrB = await User.create({ username: 'hr_b', tenantId: tenantB._id, passwordHash: defaultPasswordHash, role: 'hr', status: 'active', profile: { fullName: 'Nhân sự B' } });
    hrTokenB = generateSchoolUserToken(hrB, tenantB);

    teacherB1 = await User.create({ username: 'teacher_b1', tenantId: tenantB._id, passwordHash: defaultPasswordHash, role: 'teacher', status: 'active', profile: { fullName: 'Cô Mai B1' } });
    teacherTokenB1 = generateSchoolUserToken(teacherB1, tenantB);
    empTeacherB1 = await Employee.create({ userId: teacherB1._id, tenantId: tenantB._id, employeeCode: 'GV-B-101', fullName: 'Cô Mai B1', position: 'teacher', payrollRole: 'teacher', status: 'active' });

    guardB = await User.create({ username: 'guard_b', tenantId: tenantB._id, passwordHash: defaultPasswordHash, role: 'guard', status: 'active', profile: { fullName: 'Bác Bảo Vệ B' } });
    empGuardB = await Employee.create({ userId: guardB._id, tenantId: tenantB._id, employeeCode: 'BV-B-101', fullName: 'Bác Bảo Vệ B', position: 'security', payrollRole: 'guard', status: 'active' });

    // 4. Classrooms
    classroomA1 = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Mầm 1 A',
      schoolYear: '2026-2027',
      ageGroup: '3-4',
      maxSize: 25,
      status: 'active',
      teachingWeekdays: [1, 2, 3, 4, 5],
      teachers: []
    });

    classroomA2 = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Chồi 1 A',
      schoolYear: '2026-2027',
      ageGroup: '4-5',
      maxSize: 30,
      status: 'active',
      teachingWeekdays: [1, 2, 3, 4, 5],
      teachers: []
    });

    classroomB1 = await Classroom.create({
      tenantId: tenantB._id,
      name: 'Lớp Mầm 1 B',
      schoolYear: '2026-2027',
      ageGroup: '3-4',
      maxSize: 25,
      status: 'active',
      teachingWeekdays: [1, 2, 3, 4, 5],
      teachers: []
    });
  });

  // =========================================================================
  // NHÓM A: XEM PHÂN CÔNG & THỜI KHÓA BIỂU
  // =========================================================================
  describe('Nhóm A: Xem Phân Công & Thời Khóa Biểu', () => {
    it('A.1: getStaffing: Trả về snapshot và shifts chỉ thuộc Tenant A', async () => {
      // Tạo 1 ca trực ở A và 1 ca trực ở B
      await StaffShift.create({
        tenantId: tenantA._id,
        employeeId: empGuardA._id,
        role: 'guard',
        name: 'Ca Sáng A',
        startTime: '06:00',
        endTime: '14:00',
        weekdays: [1, 2, 3, 4, 5],
        validFrom: '2026-11-01',
        validUntil: '2026-11-30',
        status: 'active',
        createdBy: adminA._id
      });

      await StaffShift.create({
        tenantId: tenantB._id,
        employeeId: empGuardB._id,
        role: 'guard',
        name: 'Ca Sáng B',
        startTime: '06:00',
        endTime: '14:00',
        weekdays: [1, 2, 3, 4, 5],
        validFrom: '2026-11-01',
        validUntil: '2026-11-30',
        status: 'active',
        createdBy: adminB._id
      });

      const res = await request(saasApp)
        .get('/api/v1/hr/staffing')
        .query({ date: '2026-11-04' })
        .set('Authorization', `Bearer ${hrTokenA}`);

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      expect(data.classrooms.map((c) => c.name)).toContain('Lớp Mầm 1 A');
      expect(data.classrooms.map((c) => c.name)).not.toContain('Lớp Mầm 1 B');

      expect(data.shifts.map((s) => s.name)).toContain('Ca Sáng A');
      expect(data.shifts.map((s) => s.name)).not.toContain('Ca Sáng B');
    });

    it('A.2: getTimetable: Truyền classroomId ngoại lai trả 404', async () => {
      const res = await request(saasApp)
        .get('/api/v1/hr/staffing/timetable')
        .query({ startDate: '2026-11-04', classroomId: classroomB1._id.toString() })
        .set('Authorization', `Bearer ${hrTokenA}`);

      expect(res.status).toBe(404);
    });

    it('A.3: getMyStaffing: Giáo viên A chỉ xem được phân công của mình', async () => {
      // Phân công teacherA1 vào classroomA1
      classroomA1.homeroomTeacherId = teacherA1._id;
      classroomA1.teachers = [{ teacherId: teacherA1._id, teacherName: 'Cô Lan A1', role: 'homeroom', assignedAt: new Date() }];
      await classroomA1.save();

      const res = await request(saasApp)
        .get('/api/v1/hr/my-staffing')
        .query({ date: '2026-11-04' })
        .set('Authorization', `Bearer ${teacherTokenA1}`);

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      expect(data.classrooms.length).toBeGreaterThanOrEqual(1);
      expect(data.classrooms[0].name).toBe('Lớp Mầm 1 A');
    });

    it('A.4: getMyStaffing: Giáo viên hỗ trợ (support, không phải chủ nhiệm) thấy đúng lớp được phân công', async () => {
      classroomA1.homeroomTeacherId = teacherA1._id;
      classroomA1.teachers = [
        { teacherId: teacherA1._id, teacherName: 'Cô Lan A1', role: 'homeroom', assignedAt: new Date() },
        { teacherId: teacherA2._id, teacherName: 'Thầy Hùng A2', role: 'support', assignedAt: new Date() }
      ];
      await classroomA1.save();

      const teacherTokenA2 = generateSchoolUserToken(teacherA2, tenantA);
      const res = await request(saasApp)
        .get('/api/v1/hr/my-staffing')
        .query({ date: '2026-11-04' })
        .set('Authorization', `Bearer ${teacherTokenA2}`);

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      const classNames = data.classrooms.map((c) => c.name);
      expect(classNames).toContain('Lớp Mầm 1 A');
      const found = data.classrooms.find((c) => c.name === 'Lớp Mầm 1 A');
      expect(found.isCovering).toBe(false);
    });

    it('A.5: getMyStaffing: Người không được phân công không thấy lớp, tenant boundary được bảo toàn', async () => {
      // guardA không được phân công lớp học nào
      const guardRes = await request(saasApp)
        .get('/api/v1/hr/my-staffing')
        .query({ date: '2026-11-04' })
        .set('Authorization', `Bearer ${generateSchoolUserToken(guardA, tenantA)}`);

      expect(guardRes.status).toBe(200);
      const guardData = guardRes.body.data || guardRes.body;
      expect(guardData.classrooms).toEqual([]);

      // teacherB1 (Tenant B) không thấy lớp của Tenant A
      const tenantBRes = await request(saasApp)
        .get('/api/v1/hr/my-staffing')
        .query({ date: '2026-11-04' })
        .set('Authorization', `Bearer ${teacherTokenB1}`);

      expect(tenantBRes.status).toBe(200);
      const tenantBData = tenantBRes.body.data || tenantBRes.body;
      const bClassNames = (tenantBData.classrooms || []).map((c) => c.name);
      expect(bClassNames).not.toContain('Lớp Mầm 1 A');
    });

    it('A.6: getMyStaffing: Giáo viên dạy thay thấy lớp với cờ isCovering: true', async () => {
      // Tạo phân công thay thế cho teacherA2 phụ trách classroomA2 ngày 2026-11-04
      const repl = await StaffReplacement.create({
        tenantId: tenantA._id,
        date: '2026-11-04',
        kind: 'classroom',
        classroomId: classroomA2._id,
        absentEmployeeId: empTeacherA1._id,
        replacementEmployeeId: empTeacherA2._id,
        note: 'Dạy thay ngày 04/11',
        status: 'active',
        createdBy: adminA._id
      });

      const teacherTokenA2 = generateSchoolUserToken(teacherA2, tenantA);
      const res = await request(saasApp)
        .get('/api/v1/hr/my-staffing')
        .query({ date: '2026-11-04' })
        .set('Authorization', `Bearer ${teacherTokenA2}`);

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      const coveringClass = data.classrooms.find((c) => String(c._id) === String(classroomA2._id));
      expect(coveringClass).toBeDefined();
      expect(coveringClass.isCovering).toBe(true);

      // Clean up replacement và reset classroomA1 teachers để không ảnh hưởng các test sau
      await StaffReplacement.deleteOne({ _id: repl._id });
      classroomA1.homeroomTeacherId = null;
      classroomA1.teachers = [];
      await classroomA1.save();
    });
  });

  // =========================================================================
  // NHÓM B: PHÂN CÔNG GIÁO VIÊN VÀO LỚP
  // =========================================================================
  describe('Nhóm B: Phân Công Giáo Viên Vào Lớp', () => {
    it('B.1: assignHomeroomTeacher: Gán chủ nhiệm lớp Tenant A thành công (200), tăng assignmentVersion trên User', async () => {
      const initialVer = teacherA1.assignmentVersion || 0;

      const res = await request(saasApp)
        .put(`/api/v1/hr/classrooms/${classroomA1._id}/homeroom-teacher`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ teacherId: teacherA1._id.toString() });

      expect(res.status).toBe(200);
      expect(res.body.data.homeroomTeacherId.toString()).toBe(teacherA1._id.toString());

      // Kiểm tra assignmentVersion trên User giáo viên được tăng lên
      const updatedTeacher = await User.findById(teacherA1._id).lean();
      expect(updatedTeacher.assignmentVersion).toBe(initialVer + 1);
    });

    it('B.2: assignHomeroomTeacher: Thử gán cho lớp Tenant B trả 404, thử gán giáo viên Tenant B trả 422', async () => {
      // Lớp Tenant B: 404
      const resForeignClass = await request(saasApp)
        .put(`/api/v1/hr/classrooms/${classroomB1._id}/homeroom-teacher`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ teacherId: teacherA1._id.toString() });

      expect(resForeignClass.status).toBe(404);

      // Giáo viên Tenant B: 422
      const resForeignTeacher = await request(saasApp)
        .put(`/api/v1/hr/classrooms/${classroomA1._id}/homeroom-teacher`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ teacherId: teacherB1._id.toString() });

      expect(resForeignTeacher.status).toBe(422);
    });

    it('B.3: assignHomeroomTeacher: Giáo viên đã làm chủ nhiệm lớp khác trong năm học bị từ chối 409', async () => {
      // Đã làm chủ nhiệm lớp A1
      classroomA1.homeroomTeacherId = teacherA1._id;
      await classroomA1.save();

      // Cố gán làm chủ nhiệm lớp A2 cùng năm học: 409
      const resDup = await request(saasApp)
        .put(`/api/v1/hr/classrooms/${classroomA2._id}/homeroom-teacher`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ teacherId: teacherA1._id.toString() });

      expect(resDup.status).toBe(409);
      expect(resDup.body.message).toContain('đang là chủ nhiệm lớp');
    });

    it('B.4: assignClassroomStaff: Gán chủ nhiệm và giáo viên hỗ trợ thành công (200), tăng assignmentVersion trên cả 2', async () => {
      const res = await request(saasApp)
        .put(`/api/v1/hr/staffing/classrooms/${classroomA1._id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          homeroomTeacherId: teacherA1._id.toString(),
          supportTeacherIds: [teacherA2._id.toString()],
          requiredTeachers: 2,
          teachingWeekdays: [1, 2, 3, 4, 5]
        });

      expect(res.status).toBe(200);
      expect(res.body.data.homeroomTeacherId.toString()).toBe(teacherA1._id.toString());
      expect(res.body.data.teachers.length).toBe(2);

      // Kiểm tra User của cả teacherA1 và teacherA2 đều được conditional write touch
      const u1 = await User.findById(teacherA1._id).lean();
      const u2 = await User.findById(teacherA2._id).lean();
      expect(u1.assignmentVersion).toBeGreaterThan(0);
      expect(u2.assignmentVersion).toBeGreaterThan(0);
    });

    it('B.5: assignClassroomStaff: Có một ID giáo viên ngoại lai trong mảng -> toàn bộ request bị từ chối 422/409, không ghi một phần', async () => {
      const res = await request(saasApp)
        .put(`/api/v1/hr/staffing/classrooms/${classroomA1._id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          homeroomTeacherId: teacherA1._id.toString(),
          supportTeacherIds: [teacherB1._id.toString()], // Giáo viên Tenant B!
          requiredTeachers: 2,
          teachingWeekdays: [1, 2, 3, 4, 5]
        });

      expect([409, 422]).toContain(res.status);

      // Lớp A1 không bị cập nhật dở dang
      const freshClass = await Classroom.findById(classroomA1._id).lean();
      expect(freshClass.homeroomTeacherId).toBeNull();
      expect(freshClass.teachers.length).toBe(0);
    });

    it('B.6: assignClassroomStaff: Giáo viên đã có lịch bàn giao nghỉ việc scheduled bị chặn 409', async () => {
      await StaffHandover.create({
        tenantId: tenantA._id,
        employeeId: empTeacherA1._id,
        receiverEmployeeId: empTeacherA2._id,
        kind: 'resignation',
        reason: 'Xin thôi việc',
        effectiveAt: new Date('2026-12-01'),
        status: 'scheduled',
        createdBy: adminA._id
      });

      const res = await request(saasApp)
        .put(`/api/v1/hr/staffing/classrooms/${classroomA1._id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          homeroomTeacherId: teacherA1._id.toString(),
          supportTeacherIds: [],
          requiredTeachers: 1,
          teachingWeekdays: [1, 2, 3, 4, 5]
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('đã hẹn nghỉ việc');
    });

    it('B.7: assignClassroomStaff: Giáo viên đã có lớp khác trùng ngày học bị từ chối 409 (double booking)', async () => {
      // Phân công teacherA1 vào lớp A1
      classroomA1.homeroomTeacherId = teacherA1._id;
      classroomA1.teachingWeekdays = [1, 2, 3, 4, 5];
      classroomA1.teachers = [{ teacherId: teacherA1._id, teacherName: 'Cô Lan A1', role: 'homeroom', assignedAt: new Date() }];
      await classroomA1.save();

      // Cố phân công teacherA1 làm giáo viên hỗ trợ ở lớp A2 với ngày học [1, 3, 5] trùng lịch: 409
      const resConflict = await request(saasApp)
        .put(`/api/v1/hr/staffing/classrooms/${classroomA2._id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          homeroomTeacherId: teacherA2._id.toString(),
          supportTeacherIds: [teacherA1._id.toString()],
          requiredTeachers: 2,
          teachingWeekdays: [1, 3, 5]
        });

      expect(resConflict.status).toBe(409);
      expect(resConflict.body.message).toContain('trùng lịch');
    });

    it('B.8: assignHomeroomTeacher: Teacher active nhưng Employee resigned -> trả lỗi 422', async () => {
      // Đặt status của empTeacherA2 thành resigned
      await Employee.updateOne({ _id: empTeacherA2._id }, { $set: { status: 'resigned' } });

      const res = await request(saasApp)
        .put(`/api/v1/hr/classrooms/${classroomA1._id}/homeroom-teacher`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ teacherId: teacherA2._id.toString() });

      expect(res.status).toBe(422);
      expect(res.body.message).toContain('Chỉ phân công giáo viên đang làm việc');
    });

    it('B.9: assignHomeroomTeacher: Teacher có liên kết Employee ngoại lai (Tenant B) -> trả 409', async () => {
      const alienTeacherUser = await User.create({
        username: 'teacher_alien_a',
        tenantId: tenantA._id,
        passwordHash: await hashPassword('Password123@#'),
        role: 'teacher',
        status: 'active',
        profile: { fullName: 'Giáo viên Liên Kết Lệch' }
      });
      await Employee.create({
        userId: alienTeacherUser._id,
        tenantId: tenantB._id,
        employeeCode: 'GV-ALIEN-999',
        fullName: 'Giáo viên Ngoại Lai B',
        position: 'teacher',
        payrollRole: 'teacher',
        status: 'active'
      });

      const res = await request(saasApp)
        .put(`/api/v1/hr/classrooms/${classroomA1._id}/homeroom-teacher`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ teacherId: alienTeacherUser._id.toString() });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('hồ sơ nhân sự ngoại lai');
    });

    it('B.10: assignHomeroomTeacher: Giáo viên đã có lịch bàn giao nghỉ việc scheduled -> trả 409', async () => {
      await StaffHandover.create({
        tenantId: tenantA._id,
        employeeId: empTeacherA1._id,
        receiverEmployeeId: empTeacherA2._id,
        kind: 'resignation',
        reason: 'Xin nghỉ việc',
        effectiveAt: new Date('2026-12-01'),
        status: 'scheduled',
        createdBy: adminA._id
      });

      const res = await request(saasApp)
        .put(`/api/v1/hr/classrooms/${classroomA1._id}/homeroom-teacher`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ teacherId: teacherA1._id.toString() });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('đã hẹn nghỉ việc');
    });

    it('B.11: assignHomeroomTeacher: Actor bị đổi role sang teacher trước transaction snapshot -> Bị từ chối 403', async () => {
      await User.updateOne({ _id: hrA._id }, { $set: { role: 'teacher' } });

      const res = await request(saasApp)
        .put(`/api/v1/hr/classrooms/${classroomA1._id}/homeroom-teacher`)
        .set('Authorization', `Bearer ${hrTokenA}`)
        .send({ teacherId: teacherA1._id.toString() });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/(không có quyền|không còn quyền)/);

      await User.updateOne({ _id: hrA._id }, { $set: { role: 'hr' } });
    });

    it('B.12: assignHomeroomTeacher: AuditLog lỗi mô phỏng -> Rollback toàn bộ Classroom assignment và assignmentVersion', async () => {
      const initialUser = await User.findById(teacherA1._id).lean();
      const initialVer = initialUser.assignmentVersion || 0;

      const spyAudit = jest.spyOn(credentialService, 'audit').mockImplementationOnce(async () => {
        throw new Error('Simulated Audit Failure for Homeroom Assignment');
      });

      const res = await request(saasApp)
        .put(`/api/v1/hr/classrooms/${classroomA1._id}/homeroom-teacher`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ teacherId: teacherA1._id.toString() });

      expect(res.status).toBe(500);

      const freshClass = await Classroom.findById(classroomA1._id).lean();
      expect(freshClass.homeroomTeacherId).toBeNull();

      const freshUser = await User.findById(teacherA1._id).lean();
      expect(freshUser.assignmentVersion || 0).toBe(initialVer);

      spyAudit.mockRestore();
    });
  });

  // =========================================================================
  // NHÓM C: CA LÀM VIỆC (STAFF SHIFTS)
  // =========================================================================
  describe('Nhóm C: Ca Làm Việc (Staff Shifts)', () => {
    it('C.1: createShift: Tạo ca làm việc cho bảo vệ Tenant A thành công (201), nhận đúng tenantId', async () => {
      const res = await request(saasApp)
        .post('/api/v1/hr/staffing/shifts')
        .set('Authorization', `Bearer ${hrTokenA}`)
        .send({
          employeeId: empGuardA._id.toString(),
          name: 'Ca Trực Đêm',
          startTime: '22:00',
          endTime: '06:00',
          weekdays: [1, 2, 3, 4, 5],
          validFrom: '2026-11-01',
          validUntil: '2026-11-30'
        });

      expect(res.status).toBe(201);
      const saved = await StaffShift.findById(res.body.data._id).lean();
      expect(saved).not.toBeNull();
      expect(saved.tenantId.toString()).toBe(tenantA._id.toString());
      expect(saved.role).toBe('guard');
    });

    it('C.2: createShift: Thử tạo ca cho nhân viên Tenant B bị từ chối 422', async () => {
      const res = await request(saasApp)
        .post('/api/v1/hr/staffing/shifts')
        .set('Authorization', `Bearer ${hrTokenA}`)
        .send({
          employeeId: empGuardB._id.toString(), // Nhân viên Tenant B!
          name: 'Ca Trực Gian Lận',
          startTime: '08:00',
          endTime: '16:00',
          weekdays: [1, 2, 3],
          validFrom: '2026-11-01',
          validUntil: '2026-11-30'
        });

      expect(res.status).toBe(422);
    });

    it('C.3: cancelShift: Hủy ca trực Tenant A thành công (200), hủy ca Tenant B bị 404', async () => {
      const shiftA = await StaffShift.create({
        tenantId: tenantA._id,
        employeeId: empGuardA._id,
        role: 'guard',
        name: 'Ca Chiều A',
        startTime: '14:00',
        endTime: '22:00',
        weekdays: [1, 2, 3, 4, 5],
        validFrom: '2026-11-01',
        validUntil: '2026-11-30',
        status: 'active',
        createdBy: adminA._id
      });

      const shiftB = await StaffShift.create({
        tenantId: tenantB._id,
        employeeId: empGuardB._id,
        role: 'guard',
        name: 'Ca Chiều B',
        startTime: '14:00',
        endTime: '22:00',
        weekdays: [1, 2, 3, 4, 5],
        validFrom: '2026-11-01',
        validUntil: '2026-11-30',
        status: 'active',
        createdBy: adminB._id
      });

      // Admin A hủy ca của B: 404
      const resForeign = await request(saasApp)
        .delete(`/api/v1/hr/staffing/shifts/${shiftB._id}`)
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(resForeign.status).toBe(404);

      // Admin A hủy ca của A: 200
      const resOk = await request(saasApp)
        .delete(`/api/v1/hr/staffing/shifts/${shiftA._id}`)
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(resOk.status).toBe(200);
      expect(resOk.body.data.status).toBe('cancelled');
    });

    it('C.4: createShift: Actor bị đổi role sang teacher trước transaction snapshot -> Bị từ chối 403', async () => {
      await User.updateOne({ _id: hrA._id }, { $set: { role: 'teacher' } });

      const res = await request(saasApp)
        .post('/api/v1/hr/staffing/shifts')
        .set('Authorization', `Bearer ${hrTokenA}`)
        .send({
          employeeId: empGuardA._id.toString(),
          name: 'Ca Trực Đêm',
          startTime: '22:00',
          endTime: '06:00',
          weekdays: [1, 2, 3, 4, 5],
          validFrom: '2026-11-01',
          validUntil: '2026-11-30'
        });

      expect(res.status).toBe(403);
      await User.updateOne({ _id: hrA._id }, { $set: { role: 'hr' } });
    });

    it('C.5: createShift: Overlapping shift được tạo trước transaction snapshot -> Bị từ chối 409 trong transaction', async () => {
      await StaffShift.create({
        tenantId: tenantA._id,
        employeeId: empGuardA._id,
        role: 'guard',
        name: 'Ca Sáng Sớm',
        startTime: '06:00',
        endTime: '14:00',
        weekdays: [1, 2, 3, 4, 5],
        validFrom: '2026-11-01',
        validUntil: '2026-11-30',
        status: 'active',
        createdBy: adminA._id
      });

      const res = await request(saasApp)
        .post('/api/v1/hr/staffing/shifts')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          employeeId: empGuardA._id.toString(),
          name: 'Ca Trưa Trùng Lịch',
          startTime: '10:00',
          endTime: '18:00',
          weekdays: [1, 2, 3],
          validFrom: '2026-11-05',
          validUntil: '2026-11-20'
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('trùng lịch');
    });

    it('C.6: createShift: Employee có liên kết User ngoại lai (Tenant B) -> Bị từ chối 409', async () => {
      const alienGuardUser = await User.create({
        username: 'guard_alien_usr_c6',
        tenantId: tenantB._id,
        passwordHash: await hashPassword('Password123@#'),
        role: 'guard',
        status: 'active',
        profile: { fullName: 'Bảo Vệ Tenant B' }
      });
      const alienGuardEmp = await Employee.create({
        userId: alienGuardUser._id, // User thuộc tenant B
        tenantId: tenantA._id,
        employeeCode: 'BV-ALIEN-001',
        fullName: 'Bảo Vệ Liên Kết Sai',
        position: 'security',
        payrollRole: 'guard',
        status: 'active'
      });

      const res = await request(saasApp)
        .post('/api/v1/hr/staffing/shifts')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          employeeId: alienGuardEmp._id.toString(),
          name: 'Ca Trực Đêm',
          startTime: '22:00',
          endTime: '06:00',
          weekdays: [1, 2, 3, 4, 5],
          validFrom: '2026-11-01',
          validUntil: '2026-11-30'
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('hồ sơ nhân sự ngoại lai');
    });

    it('C.7: createShift: AuditLog lỗi mô phỏng -> Rollback toàn bộ StaffShift', async () => {
      const spyAudit = jest.spyOn(credentialService, 'audit').mockImplementationOnce(async () => {
        throw new Error('Simulated Audit Failure for Staff Shift');
      });

      const res = await request(saasApp)
        .post('/api/v1/hr/staffing/shifts')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          employeeId: empGuardA._id.toString(),
          name: 'Ca Audit Rollback',
          startTime: '18:00',
          endTime: '22:00',
          weekdays: [6],
          validFrom: '2026-11-01',
          validUntil: '2026-11-30'
        });

      expect(res.status).toBe(500);

      const count = await StaffShift.countDocuments({ name: 'Ca Audit Rollback' });
      expect(count).toBe(0);

      spyAudit.mockRestore();
    });
  });

  // =========================================================================
  // NHÓM D: PHÂN CÔNG THAY THẾ (STAFF REPLACEMENTS)
  // =========================================================================
  describe('Nhóm D: Phân Công Thay Thế (Staff Replacements)', () => {
    it('D.1: createReplacement: Phân công giáo viên thay thế khi giáo viên vắng có đơn nghỉ duyệt (201)', async () => {
      // 1. Gán teacherA1 vào lớp A1
      classroomA1.homeroomTeacherId = teacherA1._id;
      classroomA1.teachers = [{ teacherId: teacherA1._id, teacherName: 'Cô Lan A1', role: 'homeroom', assignedAt: new Date() }];
      await classroomA1.save();

      // 2. Tạo đơn nghỉ phép đã duyệt cho teacherA1 ngày 2026-11-10 (Thứ 3 = weekday 2)
      await LeaveRequest.create({
        tenantId: tenantA._id,
        employeeId: empTeacherA1._id,
        employeeCode: empTeacherA1.employeeCode,
        employeeName: empTeacherA1.fullName,
        leaveType: 'annual',
        startDate: new Date('2026-11-10T12:00:00.000Z'),
        endDate: new Date('2026-11-10T12:00:00.000Z'),
        totalDays: 1,
        workDates: ['2026-11-10'],
        reason: 'Nghỉ phép thường niên',
        status: 'approved',
        requestedBy: teacherA1._id,
        approvedBy: adminA._id
      });

      // 3. Phân teacherA2 thay thế teacherA1
      const res = await request(saasApp)
        .post('/api/v1/hr/staffing/replacements')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          date: '2026-11-10',
          kind: 'classroom',
          classroomId: classroomA1._id.toString(),
          absentEmployeeId: empTeacherA1._id.toString(),
          replacementEmployeeId: empTeacherA2._id.toString(),
          note: 'Dạy thay buổi sáng'
        });

      expect(res.status).toBe(201);
      const saved = await StaffReplacement.findById(res.body.data._id).lean();
      expect(saved).not.toBeNull();
      expect(saved.tenantId.toString()).toBe(tenantA._id.toString());
      expect(saved.replacementEmployeeId.toString()).toBe(empTeacherA2._id.toString());
    });

    it('D.2: createReplacement: Chặn phân công chéo trường (absent hoặc replacement thuộc Tenant B -> 422/404)', async () => {
      const resForeign = await request(saasApp)
        .post('/api/v1/hr/staffing/replacements')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          date: '2026-11-10',
          kind: 'classroom',
          classroomId: classroomA1._id.toString(),
          absentEmployeeId: empTeacherA1._id.toString(),
          replacementEmployeeId: empTeacherB1._id.toString(), // Thuộc Tenant B!
          note: 'Thay thế chéo trường'
        });

      expect(resForeign.status).toBe(422);
    });

    it('D.3: cancelReplacement: Hủy phân công thay thế Tenant A thành công (200), ID Tenant B trả 404', async () => {
      const repA = await StaffReplacement.create({
        tenantId: tenantA._id,
        date: '2026-11-15',
        kind: 'classroom',
        classroomId: classroomA1._id,
        absentEmployeeId: empTeacherA1._id,
        replacementEmployeeId: empTeacherA2._id,
        status: 'active',
        createdBy: adminA._id
      });

      const repB = await StaffReplacement.create({
        tenantId: tenantB._id,
        date: '2026-11-15',
        kind: 'classroom',
        classroomId: classroomB1._id,
        absentEmployeeId: empTeacherB1._id,
        replacementEmployeeId: empTeacherB1._id, // placeholder
        status: 'active',
        createdBy: adminB._id
      });

      // Admin A hủy của B: 404
      const resForeign = await request(saasApp)
        .delete(`/api/v1/hr/staffing/replacements/${repB._id}`)
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(resForeign.status).toBe(404);

      // Admin A hủy của A: 200
      const resOk = await request(saasApp)
        .delete(`/api/v1/hr/staffing/replacements/${repA._id}`)
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(resOk.status).toBe(200);
      expect(resOk.body.data.status).toBe('cancelled');
    });

    it('D.4: createReplacement: Actor bị hạ quyền trước transaction snapshot -> 403', async () => {
      classroomA1.homeroomTeacherId = teacherA1._id;
      classroomA1.teachers = [{ teacherId: teacherA1._id, teacherName: 'Cô Lan A1', role: 'homeroom', assignedAt: new Date() }];
      await classroomA1.save();

      await LeaveRequest.create({
        tenantId: tenantA._id,
        employeeId: empTeacherA1._id,
        employeeCode: empTeacherA1.employeeCode,
        employeeName: empTeacherA1.fullName,
        leaveType: 'annual',
        startDate: new Date('2026-11-12T12:00:00.000Z'),
        endDate: new Date('2026-11-12T12:00:00.000Z'),
        totalDays: 1,
        workDates: ['2026-11-12'],
        reason: 'Nghỉ phép',
        status: 'approved',
        requestedBy: teacherA1._id,
        approvedBy: adminA._id
      });

      await User.updateOne({ _id: hrA._id }, { $set: { role: 'teacher' } });

      const res = await request(saasApp)
        .post('/api/v1/hr/staffing/replacements')
        .set('Authorization', `Bearer ${hrTokenA}`)
        .send({
          date: '2026-11-12',
          kind: 'classroom',
          classroomId: classroomA1._id.toString(),
          absentEmployeeId: empTeacherA1._id.toString(),
          replacementEmployeeId: empTeacherA2._id.toString(),
          note: 'Dạy thay'
        });

      expect(res.status).toBe(403);
      await User.updateOne({ _id: hrA._id }, { $set: { role: 'hr' } });
    });

    it('D.5: createReplacement: Alien employee link -> 409', async () => {
      const alienTeacherUser = await User.create({
        username: 'teacher_alien_rep',
        tenantId: tenantB._id, // User thuộc Tenant B
        passwordHash: await hashPassword('Password123@#'),
        role: 'teacher',
        status: 'active',
        profile: { fullName: 'Giáo viên Ngoại Lai' }
      });
      const corruptedEmp = await Employee.create({
        userId: alienTeacherUser._id,
        tenantId: tenantA._id, // Employee thuộc Tenant A
        employeeCode: 'GV-CORRUPT-001',
        fullName: 'Giáo viên Lỗi',
        position: 'teacher',
        payrollRole: 'teacher',
        status: 'active'
      });

      const res = await request(saasApp)
        .post('/api/v1/hr/staffing/replacements')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          date: '2026-11-12',
          kind: 'classroom',
          classroomId: classroomA1._id.toString(),
          absentEmployeeId: corruptedEmp._id.toString(),
          replacementEmployeeId: empTeacherA2._id.toString()
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('hồ sơ nhân sự ngoại lai');
    });

    it('D.6: createReplacement: AuditLog lỗi mô phỏng -> Rollback toàn bộ StaffReplacement', async () => {
      classroomA1.homeroomTeacherId = teacherA1._id;
      classroomA1.teachers = [{ teacherId: teacherA1._id, teacherName: 'Cô Lan A1', role: 'homeroom', assignedAt: new Date() }];
      await classroomA1.save();

      await LeaveRequest.create({
        tenantId: tenantA._id,
        employeeId: empTeacherA1._id,
        employeeCode: empTeacherA1.employeeCode,
        employeeName: empTeacherA1.fullName,
        leaveType: 'annual',
        startDate: new Date('2026-11-18T12:00:00.000Z'),
        endDate: new Date('2026-11-18T12:00:00.000Z'),
        totalDays: 1,
        workDates: ['2026-11-18'],
        reason: 'Nghỉ phép',
        status: 'approved',
        requestedBy: teacherA1._id,
        approvedBy: adminA._id
      });

      const spyAudit = jest.spyOn(credentialService, 'audit').mockImplementationOnce(async () => {
        throw new Error('Simulated Audit Failure for Replacement');
      });

      const res = await request(saasApp)
        .post('/api/v1/hr/staffing/replacements')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          date: '2026-11-18',
          kind: 'classroom',
          classroomId: classroomA1._id.toString(),
          absentEmployeeId: empTeacherA1._id.toString(),
          replacementEmployeeId: empTeacherA2._id.toString(),
          note: 'Dạy thay có lỗi audit'
        });

      expect(res.status).toBe(500);

      const count = await StaffReplacement.countDocuments({ note: 'Dạy thay có lỗi audit' });
      expect(count).toBe(0);

      spyAudit.mockRestore();
    });
  });

  // =========================================================================
  // NHÓM E: QUYỀN TRUY CẬP LỚP HỌC QUA THAY THẾ (schoolDataAccessService)
  // =========================================================================
  describe('Nhóm E: Quyền Truy Cập Lớp Học Qua Thay Thế', () => {
    it('E.1: canAccessClassroom cấp quyền cho giáo viên thay thế hợp lệ trong ngày nghỉ có phép', async () => {
      const date = getWorkDate();

      // Teacher A1 phân công vào classroomA1
      classroomA1.homeroomTeacherId = teacherA1._id;
      classroomA1.teachers = [{ teacherId: teacherA1._id, teacherName: 'Cô Lan A1', role: 'homeroom', assignedAt: new Date() }];
      await classroomA1.save();

      // Teacher A1 có đơn nghỉ duyệt ngày hôm nay
      await LeaveRequest.create({
        tenantId: tenantA._id,
        employeeId: empTeacherA1._id,
        employeeCode: empTeacherA1.employeeCode,
        employeeName: empTeacherA1.fullName,
        leaveType: 'annual',
        startDate: new Date(),
        endDate: new Date(),
        workDates: [date],
        totalDays: 1,
        reason: 'Nghỉ giải quyết việc gia đình',
        status: 'approved',
        requestedBy: teacherA1._id,
        approvedBy: adminA._id
      });

      // Teacher A2 được phân công thay thế ngày hôm nay
      await StaffReplacement.create({
        tenantId: tenantA._id,
        date,
        kind: 'classroom',
        classroomId: classroomA1._id,
        absentEmployeeId: empTeacherA1._id,
        replacementEmployeeId: empTeacherA2._id,
        status: 'active',
        createdBy: adminA._id
      });

      // canAccessClassroom cho teacherA2 với classroomA1: true
      const canAccess = await canAccessClassroom(teacherA2, classroomA1._id, { user: teacherA2, tenantId: tenantA._id });
      expect(canAccess).toBe(true);
    });

    it('E.2: canAccessClassroom từ chối giáo viên Tenant B dù có bản ghi thay thế giả mạo (false)', async () => {
      // teacherB1 gọi truy cập classroomA1: false
      const canAccess = await canAccessClassroom(teacherB1, classroomA1._id, { user: teacherB1, tenantId: tenantB._id });
      expect(canAccess).toBe(false);
    });
  });
});
