/**
 * Bộ kiểm thử tích hợp xác nhận toàn bộ bản vá Báo cáo Chạy thử Lần 1 & Lần 2 (Mầm non Hoa Nắng).
 * Chạy trực tiếp trên MongoDB Replica Set thật (MongoMemoryReplSet) ở chế độ Production SaaS (`phase1e`).
 */

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';

jest.setTimeout(120000);

const request = require('supertest');
const testDbBootstrap = require('../../src/saas/testDbBootstrap');
const createSaasApp = require('../../src/saas/createSaasApp');
const { generateSchoolUserToken } = require('../../src/saas/utils/saasJwt');
const { hashPassword } = require('../../src/utils/passwordHash');
const { getWorkDate, startOfWorkDate } = require('../../src/utils/dateHelpers');

const Tenant = require('../../src/models/zone1_system/Tenant');
const User = require('../../src/models/zone1_system/User');
const AuditLog = require('../../src/models/zone1_system/AuditLog');
const Classroom = require('../../src/models/zone3_school/Classroom');
const Student = require('../../src/models/zone3_school/Student');
const StudentAttendance = require('../../src/models/zone3_school/StudentAttendance');
const Employee = require('../../src/models/zone2_hr/Employee');
const AttendanceRecord = require('../../src/models/zone2_hr/AttendanceRecord');
const Payroll = require('../../src/models/zone2_hr/Payroll');
const TuitionFee = require('../../src/models/zone4_finance/TuitionFee');
const Payment = require('../../src/models/zone4_finance/Payment');
const Menu = require('../../src/models/zone5_nutrition/Menu');
const ProcurementRequest = require('../../src/models/zone6_procurement/ProcurementRequest');
const Report = require('../../src/models/zone7_reporting/Report');

describe('QA & Security Evaluation Fixes — Full Replica Set Verification (phase1e)', () => {
  let bootstrapInstance;
  let app;
  let tenantA;
  let tenantB;
  let adminA;
  let adminB;
  let tokenAdminA;
  let tokenAdminB;
  let classroomA1;
  let classroomA2;

  beforeAll(async () => {
    bootstrapInstance = await testDbBootstrap.startTestDb({
      instanceOpts: [{ dbName: 'school_qa_report_fixes_test' }]
    });

    app = createSaasApp({
      mongoUri: bootstrapInstance.uri,
      connection: bootstrapInstance.connection,
      saasMode: 'phase1e'
    });

    await Promise.all([
      Tenant.syncIndexes(),
      User.syncIndexes(),
      AuditLog.syncIndexes(),
      Classroom.syncIndexes(),
      Student.syncIndexes(),
      StudentAttendance.syncIndexes(),
      Employee.syncIndexes(),
      AttendanceRecord.syncIndexes(),
      Payroll.syncIndexes(),
      TuitionFee.syncIndexes(),
      Payment.syncIndexes(),
      Menu.syncIndexes(),
      ProcurementRequest.syncIndexes(),
      Report.syncIndexes()
    ]);

    tenantA = await Tenant.create({
      code: 'HOANANG-A',
      name: 'Trường Mầm non Hoa Nắng - Cơ sở A',
      status: 'active'
    });
    tenantB = await Tenant.create({
      code: 'HOANANG-B',
      name: 'Trường Mầm non Hoa Nắng - Cơ sở B',
      status: 'active'
    });

    const passwordHash = await hashPassword('Admin@123456');
    adminA = await User.create({
      tenantId: tenantA._id,
      username: 'admin',
      passwordHash,
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Quản trị hệ thống Hoa Nắng' }
    });
    adminB = await User.create({
      tenantId: tenantB._id,
      username: 'admin_b',
      passwordHash,
      role: 'admin',
      status: 'active',
      profile: { fullName: 'Quản trị Cơ sở B' }
    });

    tokenAdminA = generateSchoolUserToken(adminA, tenantA);
    tokenAdminB = generateSchoolUserToken(adminB, tenantB);

    classroomA1 = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Mầm 1',
      ageGroup: '3-4',
      schoolYear: '2026-2027',
      maxSize: 25,
      status: 'active'
    });
    classroomA2 = await Classroom.create({
      tenantId: tenantA._id,
      name: 'Chồi 1',
      ageGroup: '4-5',
      schoolYear: '2026-2027',
      maxSize: 25,
      status: 'active'
    });
  });

  afterAll(async () => {
    if (bootstrapInstance) {
      await bootstrapInstance.stop();
    }
  });

  test('1. Bảo mật HTTP Headers, ẩn X-Powered-By và xử lý JSON lỗi thân thiện tiếng Việt', async () => {
    const healthRes = await request(app)
      .get('/api/health')
      .set('X-Forwarded-Proto', 'https');

    expect(healthRes.status).toBe(200);
    expect(healthRes.headers['x-powered-by']).toBeUndefined();
    expect(healthRes.headers['x-content-type-options']).toBe('nosniff');
    expect(healthRes.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(healthRes.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(healthRes.headers['permissions-policy']).toContain('camera=(self)');
    expect(healthRes.headers['content-security-policy']).toContain("default-src 'self'");
    expect(healthRes.headers['strict-transport-security']).toContain('max-age=31536000');

    const badJsonRes = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"username": "admin", broken_json');

    expect(badJsonRes.status).toBe(400);
    expect(badJsonRes.headers['content-type']).toMatch(/json/);
    expect(badJsonRes.body.message).toMatch(/định dạng/i);
  });

  test('2. Thêm mới, chỉnh sửa và chuyển lớp học sinh trên Replica Set không bị lỗi 500 transaction', async () => {
    const createRes = await request(app)
      .post('/api/students')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        fullName: 'Nguyễn Minh Khôi',
        birthDate: '2022-05-15',
        gender: 'male',
        classroomId: String(classroomA1._id),
        schoolYear: '2026-2027',
        emergencyContact: { name: 'Nguyễn Văn Hùng', phone: '0901234567', relationship: 'Bố' }
      });

    expect(createRes.status).toBe(201);
    const studentId = createRes.body.data._id;
    expect(createRes.body.data.studentCode).toBeTruthy();

    const updateRes = await request(app)
      .put(`/api/students/${studentId}`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        fullName: 'Nguyễn Minh Khôi',
        address: '123 Nguyễn Trãi, Quận 1'
      });
    expect(updateRes.status).toBe(200);

    const transferRes = await request(app)
      .post(`/api/students/${studentId}/transfer`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .set('Idempotency-Key', 'qa-test-transfer-001')
      .send({
        toClassroomId: String(classroomA2._id),
        reason: 'Chuyển lớp theo độ tuổi',
        effectiveDate: getWorkDate()
      });
    expect(transferRes.status).toBe(200);
    expect(String(transferRes.body.data.classroomId || transferRes.body.data.student?.classroomId)).toBe(String(classroomA2._id));
  });

  test('3. Điểm danh tự điền checkInTime, Dashboard tính đúng Doanh thu hôm nay + Đi muộn, và Báo cáo chất lượng lớp nhận sĩ số > 0', async () => {
    const student = await Student.findOne({ tenantId: tenantA._id });
    const todayStr = getWorkDate();

    // Điểm danh đi muộn không truyền checkInTime -> tự động gán giờ đến
    const attRes = await request(app)
      .post('/api/attendance')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        studentId: String(student._id),
        classroomId: String(student.classroomId),
        attendDate: todayStr,
        status: 'late'
      });
    expect([200, 201]).toContain(attRes.status);
    expect(attRes.body.data.checkInTime).toBeTruthy();

    // Ghi nhận 1 khoản thu học phí hôm nay cho tenantA
    const invoice = await TuitionFee.create({
      tenantId: tenantA._id,
      studentId: student._id,
      studentName: student.fullName,
      classroomId: student.classroomId,
      className: 'Chồi 1',
      period: '09-2026',
      tuitionBase: 2000000,
      mealFee: 880000,
      totalAmount: 2880000,
      paidAmount: 1500000,
      dueDate: new Date('2026-09-15T00:00:00.000Z'),
      status: 'partial'
    });
    await Payment.create({
      tenantId: tenantA._id,
      invoiceId: invoice._id,
      amount: 1500000,
      method: 'bank_transfer',
      idempotencyKey: 'qa-test-pay-001',
      paidAt: new Date(),
      recordedBy: adminA._id
    });

    const dashRes = await request(app)
      .get('/api/reports/dashboard')
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(dashRes.status).toBe(200);
    expect(dashRes.body.data.summary.todayRevenue).toBe(1500000);
    expect(dashRes.body.data.summary.attendedToday).toBe(1);

    const qualityRes = await request(app)
      .get('/api/reports/class-quality')
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(qualityRes.status).toBe(200);
    const choi1Row = qualityRes.body.data.classes.find((c) => c.className === 'Chồi 1');
    expect(choi1Row).toBeDefined();
    expect(choi1Row.totalEnrolled).toBeGreaterThan(0);
  });

  test('4. Tự động khấu trừ tiền ăn các ngày nghỉ có phép tháng trước khi phát hành hóa đơn tháng sau', async () => {
    const student = await Student.findOne({ tenantId: tenantA._id });
    // Tạo 2 ngày nghỉ có phép trong tháng 10/2026
    await StudentAttendance.create([
      {
        tenantId: tenantA._id,
        studentId: student._id,
        studentName: student.fullName,
        classroomId: student.classroomId,
        className: 'Chồi 1',
        attendDate: startOfWorkDate('2026-10-12'),
        status: 'absent_permission',
        recordedBy: adminA._id,
        recordedByName: 'Quản trị hệ thống'
      },
      {
        tenantId: tenantA._id,
        studentId: student._id,
        studentName: student.fullName,
        classroomId: student.classroomId,
        className: 'Chồi 1',
        attendDate: startOfWorkDate('2026-10-13'),
        status: 'absent_permission',
        recordedBy: adminA._id,
        recordedByName: 'Quản trị hệ thống'
      }
    ]);

    // Phát hành hóa đơn kỳ 11-2026 với mealFee = 880.000đ (40.000đ/ngày x 22 ngày) -> giảm trừ 80.000đ
    const invRes = await request(app)
      .post('/api/finance/tuition')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        studentId: String(student._id),
        classroomId: String(student.classroomId),
        period: '11-2026',
        tuitionBase: 2000000,
        mealFee: 880000,
        discount: 0,
        dueDate: '2026-11-15'
      });

    expect(invRes.status).toBe(201);
    expect(invRes.body.data.discount).toBe(80000);
    expect(invRes.body.data.totalAmount).toBe(2800000);
    expect(invRes.body.data.note).toContain('Khấu trừ 2 ngày ăn nghỉ có phép kỳ 10-2026');
  });

  test('5. Tạo tài khoản nội bộ liên kết hồ sơ nhân sự có sẵn và tính bảng lương > 0đ thành công', async () => {
    const preExistingEmp = await Employee.create({
      tenantId: tenantA._id,
      userId: null,
      employeeCode: 'NV0099',
      fullName: 'Trần Thị Thu Hà',
      phone: '0988777666',
      position: 'teacher',
      payrollRole: 'teacher',
      status: 'active',
      salaryConfig: {
        baseSalary: 13000000,
        positionAllowance: 500000,
        lunchAllowance: 600000,
        standardWorkDays: 26
      }
    });

    const accRes = await request(app)
      .post('/api/system/accounts')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        username: 'gv_thuha',
        password: 'Password@123',
        role: 'teacher',
        existingEmployeeId: String(preExistingEmp._id),
        profile: { fullName: 'Trần Thị Thu Hà', phone: '0988777666' }
      });

    expect(accRes.status).toBe(201);
    expect(accRes.body.data.employeeId).toBe('NV0099');

    // Đảm bảo không sinh bản ghi Employee trùng lặp
    const empCount = await Employee.countDocuments({ tenantId: tenantA._id, fullName: 'Trần Thị Thu Hà' });
    expect(empCount).toBe(1);

    // Tạo 20 ngày công đã chốt trong tháng 10/2026 cho giáo viên này
    await AttendanceRecord.create({
      tenantId: tenantA._id,
      userId: accRes.body.data._id,
      employeeName: 'Trần Thị Thu Hà',
      workDate: startOfWorkDate('2026-10-05'),
      checkInTime: new Date('2026-10-05T00:30:00.000Z'),
      checkOutTime: new Date('2026-10-05T10:00:00.000Z'),
      status: 'present',
      workday: 20,
      finalized: true
    });

    const payrollRes = await request(app)
      .post('/api/hr/payroll/generate')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ month: 10, year: 2026 });

    expect(payrollRes.status).toBe(200);
    expect(payrollRes.body.data.results.length).toBe(1);
    expect(payrollRes.body.data.results[0].netSalary).toBeGreaterThan(8000000);
  });

  test('6. Admin có toàn quyền tạo & phê duyệt Đề xuất mua sắm và Thực đơn tuần mà không bị chặn maker-checker', async () => {
    const procCreate = await request(app)
      .post('/api/procurement/requests')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        reason: 'Mua quạt mát bổ sung cho lớp Chồi 1',
        category: 'equipment',
        urgency: 'urgent',
        items: [{ itemName: 'Quạt treo tường Panasonic', quantity: 2, unit: 'cái', estimatedPrice: 1200000 }]
      });
    expect(procCreate.status).toBe(201);

    // Admin duyệt ngay (kể cả không truyền level) -> chuyển thẳng sang approved_l2
    const procApprove = await request(app)
      .put(`/api/procurement/requests/${procCreate.body.data._id}/approve`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ status: 'approved' });
    expect(procApprove.status).toBe(200);
    expect(procApprove.body.data.status).toBe('approved_l2');

    // Nguyên liệu báo lỗi tiếng Việt rõ ràng nếu sai danh mục
    const badIng = await request(app)
      .post('/api/nutrition/ingredients')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ name: 'Thịt heo', unit: 'kg', category: 'invalid_cat', caloriesPer100g: 242 });
    expect([400, 422]).toContain(badIng.status);

    // Admin tự tạo và tự duyệt thực đơn đủ 5 ngày Thứ Hai -> Thứ Sáu
    const fullWeekDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].map((dayOfWeek) => ({
      dayOfWeek,
      breakfast: { dishName: 'Cháo thịt bằm', calories: 250, items: [{ dishName: 'Cháo thịt bằm', calories: 250 }] },
      morningSnack: { dishName: 'Sữa tươi', calories: 120, items: [{ dishName: 'Sữa tươi', calories: 120 }] },
      lunch: {
        mainDishes: [{ dishName: 'Thịt kho trứng', calories: 350 }],
        soupDishes: [{ dishName: 'Canh bí đỏ', calories: 100 }]
      },
      afternoonSnack: { dishName: 'Sữa chua', calories: 110, items: [{ dishName: 'Sữa chua', calories: 110 }] }
    }));

    const menuDoc = await Menu.create({
      tenantId: tenantA._id,
      classroomId: classroomA2._id,
      className: 'Chồi 1',
      schoolYear: '2026-2027',
      weekNumber: 45,
      startDate: new Date('2026-11-02T00:00:00.000Z'),
      endDate: new Date('2026-11-06T00:00:00.000Z'),
      status: 'pending_approval',
      createdBy: adminA._id,
      days: fullWeekDays
    });

    const menuApprove = await request(app)
      .post(`/api/nutrition/menus/${menuDoc._id}/approve`)
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(menuApprove.status).toBe(200);
    expect(menuApprove.body.data.status).toBe('published');
  });

  test('7. Toàn bộ các endpoint Nhóm A (Phụ huynh, Nội bộ, Nhật ký HR, Kiosk, Báo cáo, Đổi mật khẩu) trả 200/201 và cô lập tuyệt đối giữa 2 trường', async () => {
    const student = await Student.findOne({ tenantId: tenantA._id });

    // 7.1 Tạo tài khoản phụ huynh & liên kết học sinh trên SaaS
    const createParentRes = await request(app)
      .post('/api/system/parents')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        username: 'ph_minhkhoi',
        password: 'Parent@1234',
        profile: { fullName: 'Nguyễn Văn Hùng', phone: '0901234567' },
        studentIds: [String(student._id)]
      });
    expect(createParentRes.status).toBe(201);
    expect(createParentRes.body.data.status).toBe('active');

    // Tenant B không nhìn thấy phụ huynh của Tenant A
    const listParentsB = await request(app)
      .get('/api/system/parents')
      .set('Authorization', `Bearer ${tokenAdminB}`);
    expect(listParentsB.status).toBe(200);
    expect(listParentsB.body.data).toHaveLength(0);

    // 7.2 Thông báo nội bộ & Nhật ký HR
    const internalRes = await request(app)
      .get('/api/hr/internal')
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(internalRes.status).toBe(200);

    const auditRes = await request(app)
      .get('/api/hr/audit')
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(auditRes.status).toBe(200);
    expect(auditRes.body.data.total).toBeGreaterThan(0);

    // Tenant B không thấy nhật ký của Tenant A
    const auditResB = await request(app)
      .get('/api/hr/audit')
      .set('Authorization', `Bearer ${tokenAdminB}`);
    expect(auditResB.status).toBe(200);
    expect(auditResB.body.data.rows.some((r) => r.actorUsername === 'admin')).toBe(false);

    // 7.3 Kiosk check-in bằng mã nhân viên
    const kioskRes = await request(app)
      .post('/api/timekeeping/kiosk/check-in')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ identifier: 'NV0099', action: 'check-in' });
    expect([200, 201]).toContain(kioskRes.status);

    // 7.4 Báo cáo lớp, báo cáo tài chính kỳ và lưu kho báo cáo
    const classRepRes = await request(app)
      .get(`/api/reports/class/${student.classroomId}`)
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(classRepRes.status).toBe(200);

    const finRepRes = await request(app)
      .get('/api/reports/finance?period=11-2026')
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(finRepRes.status).toBe(200);
    expect(finRepRes.body.data.totalInvoices).toBe(1);

    const saveRepRes = await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        reportType: 'finance',
        period: 'monthly',
        periodValue: '11-2026',
        data: finRepRes.body.data,
        note: 'Báo cáo tháng 11'
      });
    expect(saveRepRes.status).toBe(201);

    const savedListB = await request(app)
      .get('/api/reports')
      .set('Authorization', `Bearer ${tokenAdminB}`);
    expect(savedListB.status).toBe(200);
    expect(savedListB.body.data).toHaveLength(0);

    // 7.5 Đổi mật khẩu cá nhân (/api/auth/me/password)
    const pwRes = await request(app)
      .post('/api/auth/me/password')
      .set('Authorization', `Bearer ${tokenAdminB}`)
      .send({ currentPassword: 'Admin@123456', newPassword: 'NewAdmin@123456' });
    expect(pwRes.status).toBe(200);
  });
});

