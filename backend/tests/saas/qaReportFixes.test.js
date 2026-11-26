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

  test('8. PM Requirements: Lớp < 3 tuổi (6 tháng+), Phân hiệu, Excel mẫu 2 Phụ huynh + Mã định danh & Đẩy tổng nhiều lớp', async () => {
    const ExcelJS = require('exceljs');

    // 8.1 Tạo lớp Nhà trẻ 6–12 tháng ở Cơ sở chính và lớp Nhà trẻ 1–2 tuổi ở Phân hiệu 2
    const nurseryRes = await request(app)
      .post('/api/classrooms')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        name: 'Nhà trẻ 6T-A',
        fullName: 'Nhà trẻ 6–12 tháng A',
        campus: 'Cơ sở chính',
        ageGroup: '6-12m',
        maxSize: 18,
        schoolYear: '2026-2027'
      });
    expect(nurseryRes.status).toBe(201);
    expect(nurseryRes.body.data.ageGroup).toBe('6-12m');
    expect(nurseryRes.body.data.campus).toBe('Cơ sở chính');

    const toddlerBranchRes = await request(app)
      .post('/api/classrooms')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        name: 'Nhà trẻ 1-2B',
        fullName: 'Nhà trẻ 1–2 tuổi Phân hiệu 2',
        campus: 'Phân hiệu 2',
        ageGroup: '1-2',
        maxSize: 20,
        schoolYear: '2026-2027'
      });
    expect(toddlerBranchRes.status).toBe(201);
    expect(toddlerBranchRes.body.data.campus).toBe('Phân hiệu 2');

    // Lọc lớp theo Phân hiệu 2 (cách ly chuẩn Multi-Tenant)
    const branchListRes = await request(app)
      .get('/api/classrooms')
      .query({ campus: 'Phân hiệu 2' })
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(branchListRes.status).toBe(200);
    expect(branchListRes.body.data).toHaveLength(1);
    expect(branchListRes.body.data[0].name).toBe('Nhà trẻ 1-2B');

    // 8.2 Tải file Excel mẫu (.xlsx) và kiểm tra đầy đủ cột Lớp, Mã ID, Mã định danh, 2 Phụ huynh
    const tplRes = await request(app)
      .get('/api/students/excel/template')
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(tplRes.status).toBe(200);

    const tplWb = new ExcelJS.Workbook();
    await tplWb.xlsx.load(tplRes.body);
    const dataSheet = tplWb.getWorksheet('Danh sách học sinh');
    expect(dataSheet).toBeDefined();
    const headerTexts = [];
    dataSheet.getRow(1).eachCell((c) => headerTexts.push(String(c.value)));
    expect(headerTexts).toEqual(expect.arrayContaining([
      'Lớp',
      'Mã ID học sinh',
      'Mã định danh học sinh',
      'Họ và tên (*)',
      'Ngày sinh (*)',
      'Giới tính (*)',
      'Họ tên phụ huynh 1',
      'Điện thoại phụ huynh 1',
      'Hòm thư phụ huynh 1',
      'Họ tên phụ huynh 2',
      'Điện thoại phụ huynh 2',
      'Hòm thư phụ huynh 2'
    ]));

    // 8.3 Điền danh sách tổng gồm học sinh ở 2 lớp khác nhau + 2 phụ huynh + mã định danh (theo đúng thứ tự cột A..V như người dùng nhập trong Excel)
    dataSheet.addRow([
      'Nhà trẻ 6T-A',
      'HS6TA01',
      '001226000111',
      'Lê Bảo Trâm',
      '15/03/2026',
      'Nữ',
      '01/10/2026',
      'Lê Quốc Bảo',
      '0903111222',
      'quocbao@example.com',
      'Bố',
      'Phạm Thu Hà',
      '0904333444',
      'thuha@example.com',
      'Mẹ',
      'Hải sản',
      '',
      'Cầu Giấy, Hà Nội',
      'Việt Nam',
      'Kinh',
      'Hà Nội',
      'Bé ăn cháo nhuyễn'
    ]);
    dataSheet.addRow([
      'Nhà trẻ 1-2B',
      '',
      '001225000222',
      'Đỗ Gia Huy',
      '20/01/2025',
      'Nam',
      '01/10/2026',
      'Đỗ Văn Nam',
      '0912555666',
      'vannam@example.com',
      'Bố',
      'Vũ Thị Mai',
      '0988777888',
      'thimai@example.com',
      'Mẹ',
      '',
      '',
      'Nam Từ Liêm, Hà Nội',
      'Việt Nam',
      'Kinh',
      'Hà Nội',
      ''
    ]);

    const uploadBuffer = Buffer.from(await tplWb.xlsx.writeBuffer());

    // Xem trước ở chế độ Đẩy danh sách tổng toàn trường (__ALL__)
    const previewRes = await request(app)
      .post('/api/students/excel/preview')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .field('classroomId', '__ALL__')
      .attach('file', uploadBuffer, 'Danh_Sach_Tong_Toan_Truong.xlsx');
    expect(previewRes.status).toBe(200);
    expect(previewRes.body.data.canImport).toBe(true);
    expect(previewRes.body.data.totalValid).toBe(2);
    expect(previewRes.body.data.classSummary).toHaveLength(2);

    // Xác nhận lưu nguyên khối vào cả 2 lớp trong 1 Transaction
    const confirmRes = await request(app)
      .post('/api/students/excel/confirm')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .set('Idempotency-Key', 'idem-multi-class-pm-test-001')
      .send({
        classroomId: '__ALL__',
        students: previewRes.body.data.rows
      });
    expect(confirmRes.status).toBe(201);
    expect(confirmRes.body.data).toHaveLength(2);

    const tram = confirmRes.body.data.find((s) => s.fullName === 'Lê Bảo Trâm');
    const huy = confirmRes.body.data.find((s) => s.fullName === 'Đỗ Gia Huy');
    expect(tram.studentCode).toBe('HS6TA01');
    expect(tram.identityCode).toBe('001226000111');
    expect(tram.parents).toHaveLength(2);
    expect(tram.parents[1].phone).toBe('0904333444');
    expect(huy.identityCode).toBe('001225000222');
    expect(huy.parents).toHaveLength(2);

    // Kiểm tra sĩ số của cả 2 lớp đã tăng chính xác (+1 mỗi lớp)
    const checkCls1 = await Classroom.findById(nurseryRes.body.data._id).lean();
    const checkCls2 = await Classroom.findById(toddlerBranchRes.body.data._id).lean();
    expect(checkCls1.statistics.currentStudents).toBe(1);
    expect(checkCls1.statistics.female).toBe(1);
    expect(checkCls2.statistics.currentStudents).toBe(1);
    expect(checkCls2.statistics.male).toBe(1);

    // 8.4 Kiểm tra chế độ Đẩy riêng từng lớp (dành cho Giáo viên chủ nhiệm / Quản lý chọn 1 lớp cụ thể) vẫn hoạt động trơn tru
    const singleWb = new ExcelJS.Workbook();
    const singleSheet = singleWb.addWorksheet('Danh sách học sinh');
    singleSheet.addRow(['Họ và tên (*)', 'Ngày sinh (*)', 'Giới tính (*)', 'Mã định danh học sinh', 'Họ tên phụ huynh 1', 'Điện thoại phụ huynh 1', 'Họ tên phụ huynh 2', 'Điện thoại phụ huynh 2']);
    singleSheet.addRow(['Phạm Minh Châu', '10/02/2026', 'Nữ', '001226000333', 'Phạm Văn Bình', '0977111222', 'Nguyễn Thu Thủy', '0977333444']);
    const singleBuffer = Buffer.from(await singleWb.xlsx.writeBuffer());

    const singlePreview = await request(app)
      .post('/api/students/excel/preview')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .field('classroomId', String(nurseryRes.body.data._id))
      .attach('file', singleBuffer, 'Lop_6TA.xlsx');
    expect(singlePreview.status).toBe(200);
    expect(singlePreview.body.data.canImport).toBe(true);

    const singleConfirm = await request(app)
      .post('/api/students/excel/confirm')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .set('Idempotency-Key', 'idem-single-class-pm-test-002')
      .send({
        classroomId: String(nurseryRes.body.data._id),
        students: singlePreview.body.data.rows
      });
    expect(singleConfirm.status).toBe(201);
    expect(singleConfirm.body.data[0].identityCode).toBe('001226000333');
    expect(singleConfirm.body.data[0].parents).toHaveLength(2);
    expect((await Classroom.findById(nurseryRes.body.data._id).lean()).statistics.currentStudents).toBe(2);
  });

  test('9. Handwritten Sheet Phase 2: BHYT, Nhóm máu, Tiêm chủng, Cân nặng chiều cao tháng, Phân hiệu & Admin Đa Trường', async () => {
    const { ensureDefaultAdminAccount } = require('../../src/services/defaultAdminBootstrapService');

    // 9.1 Cập nhật BHYT & Nhóm máu + Theo dõi Cân nặng Chiều cao theo tháng + Sổ Tiêm chủng
    const targetStudent = await Student.findOne({ tenantId: tenantA._id, status: 'enrolled' });
    expect(targetStudent).toBeTruthy();

    const updateHealthRes = await request(app)
      .put(`/api/students/${targetStudent._id}`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        healthInsuranceCode: 'te1012600099887',
        bloodType: 'O+'
      });
    expect(updateHealthRes.status).toBe(200);
    expect(updateHealthRes.body.data.healthInsuranceCode).toBe('TE1012600099887');
    expect(updateHealthRes.body.data.bloodType).toBe('O+');

    const growthOct = await request(app)
      .post(`/api/students/${targetStudent._id}/growth-records`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ month: '2026-10', weightKg: 14.2, heightCm: 95.0, note: 'Tháng 10 ổn định' });
    expect(growthOct.status).toBe(200);

    const growthNov = await request(app)
      .post(`/api/students/${targetStudent._id}/growth-records`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ month: '2026-11', weightKg: 14.7, heightCm: 96.2, note: 'Tăng cân tốt' });
    expect(growthNov.status).toBe(200);
    expect(growthNov.body.data.growthRecords).toHaveLength(2);
    expect(growthNov.body.data.growthRecords[0].month).toBe('2026-11');
    expect(growthNov.body.data.growthRecords[0].bmi).toBeCloseTo(15.9, 1);

    const vaxRes = await request(app)
      .post(`/api/students/${targetStudent._id}/vaccinations`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        vaccineName: 'Sởi - Quai bị - Rubella (MMR)',
        doseNumber: 2,
        vaccinatedDate: '2026-09-15',
        status: 'completed',
        facility: 'VNVC Cầu Giấy'
      });
    expect(vaxRes.status).toBe(201);
    expect(vaxRes.body.data.vaccinations).toHaveLength(1);
    expect(vaxRes.body.data.vaccinations[0].vaccineName).toContain('MMR');

    // 9.2 Quản lý Trường & Phân hiệu trong từng trường (/api/system/campuses)
    const addCampusRes = await request(app)
      .post('/api/system/campuses')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        code: 'PH-3',
        name: 'Phân hiệu 3 - Cầu Giấy',
        address: '120 Xuân Thủy, Cầu Giấy',
        phone: '02438889999',
        managerName: 'Cô Nguyễn Thu Hà'
      });
    expect(addCampusRes.status).toBe(201);

    const listCampusesRes = await request(app)
      .get('/api/system/campuses')
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(listCampusesRes.status).toBe(200);
    expect(listCampusesRes.body.data.campuses.some((c) => c.name === 'Phân hiệu 3 - Cầu Giấy')).toBe(true);
    expect(listCampusesRes.body.data.campuses.some((c) => c.name === 'Phân hiệu 2' && c.classCount >= 1)).toBe(true);

    // 9.3 Quản trị Tổng Đa Trường (Admin chung toàn bộ -> Tạo trường mới kèm 1 Account Admin riêng -> Chuyển vào quản lý từng trường)
    await ensureDefaultAdminAccount({ useLegacyApp: false });

    const superLoginRes = await request(app)
      .post('/api/multi-school/login')
      .send({ username: 'superadmin', password: '123456' });
    expect(superLoginRes.status).toBe(200);
    expect(superLoginRes.body.isSuperAdmin).toBe(true);
    const superToken = superLoginRes.body.token;

    const createSchoolRes = await request(app)
      .post('/api/multi-school/schools')
      .set('Authorization', `Bearer ${superToken}`)
      .send({
        code: 'HOANANG-C',
        name: 'Trường Mầm non Hoa Nắng - Cơ sở C',
        organizationCode: 'HOA-NANG-GROUP',
        contactEmail: 'csc@hoanang.edu.vn',
        adminUsername: 'admin_csc',
        adminPassword: 'SchoolC@2026',
        adminFullName: 'Quản trị Cơ sở C',
        initialCampuses: [
          { code: 'CS-CHINH', name: 'Cơ sở chính' },
          { code: 'PH-MYDINH', name: 'Phân hiệu Mỹ Đình' }
        ]
      });
    expect(createSchoolRes.status).toBe(201);
    const newSchoolId = createSchoolRes.body.data.school._id;

    // Account riêng của trường mới đăng nhập độc lập và chỉ thấy dữ liệu của trường C
    const loginSchoolC = await request(app)
      .post('/api/auth/login')
      .send({
        schoolCode: 'HOANANG-C',
        username: 'admin_csc',
        password: 'SchoolC@2026'
      });
    expect(loginSchoolC.status).toBe(200);
    expect(loginSchoolC.body.tenant.code).toBe('HOANANG-C');

    const studentsInC = await request(app)
      .get('/api/students')
      .set('Authorization', `Bearer ${loginSchoolC.body.token}`);
    expect(studentsInC.status).toBe(200);
    expect(studentsInC.body.data).toHaveLength(0);

    // Admin Tổng có thể bấm "Vào quản lý trường" để nhận phiên điều hành trực tiếp trường C
    const enterSchoolC = await request(app)
      .post(`/api/multi-school/schools/${newSchoolId}/enter`)
      .set('Authorization', `Bearer ${superToken}`);
    expect(enterSchoolC.status).toBe(200);
    expect(enterSchoolC.body.tenant.code).toBe('HOANANG-C');
    expect(enterSchoolC.body.token).toBeTruthy();

    const overviewRes = await request(app)
      .get('/api/multi-school/schools')
      .set('Authorization', `Bearer ${superToken}`);
    expect(overviewRes.status).toBe(200);
    expect(overviewRes.body.data.summary.totalSchools).toBeGreaterThanOrEqual(3);
  });
});

