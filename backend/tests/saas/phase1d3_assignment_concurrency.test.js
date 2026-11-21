/**
 * Task 1D.3: Kiểm chứng điều phối đồng thời giữa Gán lớp và Đổi vai trò (Concurrency & Invariant Verification)
 *
 * File: backend/tests/saas/phase1d3_assignment_concurrency.test.js
 *
 * Kiểm chứng chuyên sâu:
 * - Thứ tự A: Đổi role commit trước -> Gán lớp (cả homeroom lẫn classroom staff) bị từ chối (422), lớp không bị gán sai vai trò.
 * - Thứ tự B: Gán lớp commit trước -> Đổi role (cả endpoint update thường lẫn /role) bị từ chối (409), role giữ nguyên 'teacher'.
 * - Thứ tự C: Hai transaction chồng lấn (Overlapping Transactions) với Barrier xác định:
 *   WiredTiger WriteConflict ép retry trên document User dùng chung; snapshot mới kiểm tra lại điều kiện;
 *   Invariant bất biến: KHÔNG BAO GIỜ tồn tại tài khoản role khác 'teacher' mà vẫn được gán lớp active.
 * - Thứ tự D: Độc lập đa trường: Gán lớp hoặc đổi role ở Tenant B không gây xung đột hoặc chặn nhầm Tenant A.
 *
 * Không sử dụng sleep; không mutate document query trong bộ nhớ; không thêm hook vào code sản phẩm.
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
const roleCheck = require('../../src/middlewares/roleCheck');
const hrAccessAudit = require('../../src/middlewares/hrAccessAudit');

const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const Employee = require('../../src/models/zone2_hr/Employee');
const Classroom = require('../../src/models/zone3_school/Classroom');
const AuditLog = require('../../src/models/zone1_system/AuditLog');

const { assignHomeroomTeacher } = require('../../src/controllers/classroomController');
const { assignClassroomStaff } = require('../../src/controllers/staffingController');
const {
  updateInternalAccount,
  updateInternalAccountRole
} = require('../../src/controllers/systemUserController');

const { generateSchoolUserToken } = require('../../src/saas/utils/saasJwt');
const { hashPassword } = require('../../src/utils/passwordHash');

const buildApp = () => {
  const app = express();
  app.use(express.json());

  const router = express.Router();
  router.use(schoolAuthMiddleware);
  router.use(hrAccessAudit('concurrency'));

  // Classroom assignments
  router.put('/classrooms/:id/homeroom-teacher', roleCheck(['admin', 'hr']), assignHomeroomTeacher);
  router.put('/staffing/classrooms/:id', roleCheck(['admin', 'hr']), assignClassroomStaff);

  // User management
  router.patch('/accounts/:id', roleCheck(['admin', 'hr']), updateInternalAccount);
  router.patch('/accounts/:id/role', roleCheck(['admin', 'hr']), updateInternalAccountRole);

  app.use('/api/v1', router);
  return app;
};

describe('Task 1D.3: Điều phối đồng thời giữa Gán lớp và Đổi vai trò (Race & Invariant)', () => {
  let bootstrapInstance;
  let app;

  let tenantA, tenantB;
  let adminA, adminTokenA;
  let teacherA, teacherTokenA, empTeacherA;
  let teacherB, teacherTokenB, empTeacherB;

  let classroomA1, classroomB1;

  beforeAll(async () => {
    bootstrapInstance = await testDbBootstrap.startTestDb({
      instanceOpts: [{ dbName: 'school_saas_phase1d3_concurrency_test' }]
    });
    app = buildApp();

    await Promise.all([
      Tenant.syncIndexes(),
      User.syncIndexes(),
      Employee.syncIndexes(),
      Classroom.syncIndexes(),
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
      Employee.deleteMany({}),
      Classroom.deleteMany({}),
      AuditLog.deleteMany({})
    ]);

    const defaultPasswordHash = await hashPassword('Password123@#');

    // 1. Tenants
    tenantA = await Tenant.create({ code: 'TENANT-CC-A', name: 'Trường Thử Nghiệm A', status: 'active', subscriptionPlan: 'standard' });
    tenantB = await Tenant.create({ code: 'TENANT-CC-B', name: 'Trường Thử Nghiệm B', status: 'active', subscriptionPlan: 'standard' });

    // 2. Users & Employees
    adminA = await User.create({
      username: 'admin_a',
      tenantId: tenantA._id,
      passwordHash: defaultPasswordHash,
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Quản trị viên A' }
    });
    adminTokenA = generateSchoolUserToken(adminA, tenantA);

    teacherA = await User.create({
      username: 'teacher_a',
      tenantId: tenantA._id,
      passwordHash: defaultPasswordHash,
      role: 'teacher',
      status: 'active',
      profile: { fullName: 'Giáo viên Nguyễn Văn A' }
    });
    teacherTokenA = generateSchoolUserToken(teacherA, tenantA);

    empTeacherA = await Employee.create({
      userId: teacherA._id,
      tenantId: tenantA._id,
      employeeCode: 'GV-A-CC1',
      fullName: 'Giáo viên Nguyễn Văn A',
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active'
    });

    teacherB = await User.create({
      username: 'teacher_b',
      tenantId: tenantB._id,
      passwordHash: defaultPasswordHash,
      role: 'teacher',
      status: 'active',
      profile: { fullName: 'Giáo viên Trần Thị B' }
    });
    teacherTokenB = generateSchoolUserToken(teacherB, tenantB);

    empTeacherB = await Employee.create({
      userId: teacherB._id,
      tenantId: tenantB._id,
      employeeCode: 'GV-B-CC1',
      fullName: 'Giáo viên Trần Thị B',
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active'
    });

    // 3. Classrooms
    classroomA1 = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Lớp Lá 1 A',
      schoolYear: '2026-2027',
      ageGroup: '5-6',
      maxSize: 30,
      status: 'active',
      teachingWeekdays: [1, 2, 3, 4, 5],
      teachers: []
    });

    classroomB1 = await Classroom.create({
      tenantId: tenantB._id,
      name: 'Lớp Lá 1 B',
      schoolYear: '2026-2027',
      ageGroup: '5-6',
      maxSize: 30,
      status: 'active',
      teachingWeekdays: [1, 2, 3, 4, 5],
      teachers: []
    });
  });

  // =========================================================================
  // THỨ TỰ A: ĐỔI ROLE COMMIT TRƯỚC -> GÁN LỚP CHẠY SAU BỊ TỪ CHỐI (422)
  // =========================================================================
  describe('Thứ tự A: Đổi role commit trước -> Gán lớp bị từ chối (422)', () => {
    it('A.1: Đổi role sang accountant commit trước -> assignHomeroomTeacher bị từ chối 422', async () => {
      // 1. Đổi role teacherA sang accountant
      const resRole = await request(app)
        .patch(`/api/v1/accounts/${teacherA._id}/role`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ role: 'accountant' });

      expect(resRole.status).toBe(200);
      expect(resRole.body.data.role).toBe('accountant');

      // 2. Thử gán làm chủ nhiệm lớp: bị từ chối 422
      const resAssign = await request(app)
        .put(`/api/v1/classrooms/${classroomA1._id}/homeroom-teacher`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ teacherId: teacherA._id.toString() });

      expect(resAssign.status).toBe(422);
      expect(resAssign.body.message).toContain('Chỉ có thể chọn tài khoản giáo viên đang hoạt động');

      // Lớp không có chủ nhiệm
      const freshClass = await Classroom.findById(classroomA1._id).lean();
      expect(freshClass.homeroomTeacherId).toBeNull();
    });

    it('A.2: Đổi role sang accountant commit trước -> assignClassroomStaff bị từ chối 422', async () => {
      // 1. Đổi role teacherA sang accountant
      const resRole = await request(app)
        .patch(`/api/v1/accounts/${teacherA._id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ role: 'accountant' });

      expect(resRole.status).toBe(200);

      // 2. Thử phân công làm support teacher qua assignClassroomStaff: 422
      const resAssign = await request(app)
        .put(`/api/v1/staffing/classrooms/${classroomA1._id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          supportTeacherIds: [teacherA._id.toString()],
          requiredTeachers: 1,
          teachingWeekdays: [1, 2, 3, 4, 5]
        });

      expect(resAssign.status).toBe(422);
      expect(resAssign.body.message).toContain('Chỉ phân công giáo viên đang làm việc và có tài khoản hợp lệ');

      // Lớp không bị gán giáo viên
      const freshClass = await Classroom.findById(classroomA1._id).lean();
      expect(freshClass.teachers.length).toBe(0);
    });
  });

  // =========================================================================
  // THỨ TỰ B: GÁN LỚP COMMIT TRƯỚC -> ĐỔI ROLE BỊ TỪ CHỐI (409)
  // =========================================================================
  describe('Thứ tự B: Gán lớp commit trước -> Đổi role bị từ chối (409)', () => {
    it('B.1: Gán chủ nhiệm commit trước -> Đổi role qua /role bị từ chối 409', async () => {
      // 1. Gán làm chủ nhiệm lớp
      const resAssign = await request(app)
        .put(`/api/v1/classrooms/${classroomA1._id}/homeroom-teacher`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ teacherId: teacherA._id.toString() });

      expect(resAssign.status).toBe(200);

      // 2. Cố đổi role sang accountant: bị chặn 409
      const resRole = await request(app)
        .patch(`/api/v1/accounts/${teacherA._id}/role`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ role: 'accountant' });

      expect(resRole.status).toBe(409);
      expect(resRole.body.message).toContain('Giáo viên đang được phân công lớp');

      // Role vẫn là teacher
      const freshUser = await User.findById(teacherA._id).lean();
      expect(freshUser.role).toBe('teacher');
    });

    it('B.2: Gán support teacher qua assignClassroomStaff commit trước -> Đổi role qua PATCH /accounts/:id bị từ chối 409', async () => {
      // 1. Gán support teacher
      const resAssign = await request(app)
        .put(`/api/v1/staffing/classrooms/${classroomA1._id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          supportTeacherIds: [teacherA._id.toString()],
          requiredTeachers: 1,
          teachingWeekdays: [1, 2, 3, 4, 5]
        });

      expect(resAssign.status).toBe(200);

      // 2. Cố đổi role sang chef: bị chặn 409
      const resRole = await request(app)
        .patch(`/api/v1/accounts/${teacherA._id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ role: 'chef' });

      expect(resRole.status).toBe(409);
      expect(resRole.body.message).toContain('Giáo viên đang được phân công lớp');

      const freshUser = await User.findById(teacherA._id).lean();
      expect(freshUser.role).toBe('teacher');
    });
  });

  // =========================================================================
  // THỨ TỰ C: OVERLAPPING TRANSACTIONS VỚI BARRIER XÁC ĐỊNH
  // =========================================================================
  describe('Thứ tự C: Overlapping Transactions (WiredTiger WriteConflict & Invariant Guarantee)', () => {
    it('C.1: Gán chủ nhiệm và Đổi role qua /role: Barrier xác định kích hoạt WiredTiger WriteConflict và Driver Retry', async () => {
      let barrierFired = false;
      let retryCount = 0;

      const originalExists = Classroom.exists;
      Classroom.exists = function (...args) {
        const query = originalExists.apply(this, args);
        const originalThen = query.then.bind(query);
        query.then = function (onFulfilled, onRejected) {
          const filter = args[0] || {};
          const hasSession = query.getOptions().session;
          if (filter['$or'] && hasSession) {
            retryCount++;
            if (!barrierFired) {
              barrierFired = true;
              // Luồng 1 tạm dừng sau khi đọc xong Classroom.exists (thấy null)
              // Kích hoạt Luồng 2 (gán chủ nhiệm) chạy và commit trước
              return request(app)
                .put(`/api/v1/classrooms/${classroomA1._id}/homeroom-teacher`)
                .set('Authorization', `Bearer ${adminTokenA}`)
                .send({ teacherId: teacherA._id.toString() })
                .then((resAssign) => {
                  expect(resAssign.status).toBe(200);
                  return originalThen(onFulfilled, onRejected);
                });
            }
          }
          return originalThen(onFulfilled, onRejected);
        };
        return query;
      };

      try {
        // Luồng 1: Đổi role sang accountant
        const resRole = await request(app)
          .patch(`/api/v1/accounts/${teacherA._id}/role`)
          .set('Authorization', `Bearer ${adminTokenA}`)
          .send({ role: 'accountant' });

        // Luồng 1 gặp WriteConflict trên document User, driver tự động retry attempt 2
        // Ở attempt 2, Classroom.exists đọc snapshot mới, phát hiện lớp đã được gán và từ chối 409
        expect(resRole.status).toBe(409);
        expect(resRole.body.message).toContain('Giáo viên đang được phân công lớp');
        expect(barrierFired).toBe(true);
        expect(retryCount).toBeGreaterThanOrEqual(2);

        // Invariant: User vẫn là teacher, Classroom đã được gán chủ nhiệm
        const finalUser = await User.findById(teacherA._id).lean();
        const finalClass = await Classroom.findById(classroomA1._id).lean();
        expect(finalUser.role).toBe('teacher');
        expect(String(finalClass.homeroomTeacherId)).toBe(String(teacherA._id));
      } finally {
        Classroom.exists = originalExists;
      }
    });

    it('C.2: assignClassroomStaff và Đổi role qua PATCH /accounts/:id: Barrier xác định bảo toàn Invariant', async () => {
      let barrierFired = false;
      let retryCount = 0;

      const originalExists = Classroom.exists;
      Classroom.exists = function (...args) {
        const query = originalExists.apply(this, args);
        const originalThen = query.then.bind(query);
        query.then = function (onFulfilled, onRejected) {
          const filter = args[0] || {};
          const hasSession = query.getOptions().session;
          if (filter['$or'] && hasSession) {
            retryCount++;
            if (!barrierFired) {
              barrierFired = true;
              // Luồng 1 dừng sau khi đọc pre-check
              // Kích hoạt Luồng 2 (assignClassroomStaff) chạy và commit
              return request(app)
                .put(`/api/v1/staffing/classrooms/${classroomA1._id}`)
                .set('Authorization', `Bearer ${adminTokenA}`)
                .send({
                  supportTeacherIds: [teacherA._id.toString()],
                  requiredTeachers: 1,
                  teachingWeekdays: [1, 2, 3, 4, 5]
                })
                .then((resAssign) => {
                  expect(resAssign.status).toBe(200);
                  return originalThen(onFulfilled, onRejected);
                });
            }
          }
          return originalThen(onFulfilled, onRejected);
        };
        return query;
      };

      try {
        const resRole = await request(app)
          .patch(`/api/v1/accounts/${teacherA._id}`)
          .set('Authorization', `Bearer ${adminTokenA}`)
          .send({ role: 'chef' });

        expect(resRole.status).toBe(409);
        expect(resRole.body.message).toContain('Giáo viên đang được phân công lớp');
        expect(barrierFired).toBe(true);
        expect(retryCount).toBeGreaterThanOrEqual(2);

        const finalUser = await User.findById(teacherA._id).lean();
        const finalClass = await Classroom.findById(classroomA1._id).lean();
        expect(finalUser.role).toBe('teacher');
        expect(finalClass.teachers.some((t) => String(t.teacherId) === String(teacherA._id))).toBe(true);
      } finally {
        Classroom.exists = originalExists;
      }
    });
  });

  // =========================================================================
  // THỨ TỰ D: ĐỘC LẬP ĐA TRƯỜNG (TENANT ISOLATION)
  // =========================================================================
  describe('Thứ tự D: Độc Lập Đa Trường (Tenant Isolation)', () => {
    it('D.1: Gán lớp ở Tenant B không ảnh hưởng hoặc xung đột với đổi role ở Tenant A', async () => {
      // Gán teacherB vào classroomB1 ở Tenant B
      const resB = await request(app)
        .put(`/api/v1/classrooms/${classroomB1._id}/homeroom-teacher`)
        .set('Authorization', `Bearer ${generateSchoolUserToken(teacherB, tenantB)}`) // hoặc adminB
        .set('Authorization', `Bearer ${generateSchoolUserToken(adminA, tenantB)}`) // adminB
        .send({ teacherId: teacherB._id.toString() });

      // Đổi role teacherA ở Tenant A: thành công bình thường
      const resA = await request(app)
        .patch(`/api/v1/accounts/${teacherA._id}/role`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ role: 'accountant' });

      expect(resA.status).toBe(200);
      expect(resA.body.data.role).toBe('accountant');
    });
  });
});
