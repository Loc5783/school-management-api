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

    // 9.3 Quản trị Tổng Đa Trường (Admin chung toàn bộ mặc định 'admin' đăng nhập khi để trống Mã trường -> Tạo trường mới kèm Account riêng)
    await ensureDefaultAdminAccount({ useLegacyApp: false });

    const superLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ schoolCode: '', username: 'admin', password: '123456' });
    expect(superLoginRes.status).toBe(200);
    expect(superLoginRes.body.isSuperAdmin).toBe(true);
    expect(superLoginRes.body.user.role).toBe('superadmin');
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

  test('10. Real-World Workflows Phase 3: Tạo nhân sự 1 bước, Tự cấp TK Phụ huynh gom anh chị em, Trả trẻ 1 chạm tại lớp & Khấu trừ tiền ăn tùy chỉnh', async () => {
    const Notification = require('../../src/models/zone1_system/Notification');
    const PickupRecord = require('../../src/models/zone3_school/PickupRecord');
    const StudentGateEvent = require('../../src/models/zone3_school/StudentGateEvent');
    await Promise.all([PickupRecord.syncIndexes(), StudentGateEvent.syncIndexes(), Notification.syncIndexes()]);

    // 10.1 Tạo lớp mới + Tạo Giáo viên & Cấp Tài khoản đăng nhập trong 1 bước duy nhất
    const classCreateRes = await request(app)
      .post('/api/classrooms')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        name: 'LA-THUCTE-10',
        fullName: 'Lớp Lá Thực Tế 10',
        ageGroup: '5-6',
        schoolYear: '2026-2027',
        maxSize: 25
      });
    expect(classCreateRes.status).toBe(201);
    const realClassId = classCreateRes.body.data._id;

    const createTeacherOneStep = await request(app)
      .post('/api/hr/employees')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        createAccount: true,
        accountUsername: 'gv.thucte10',
        accountPassword: '123456',
        accountRole: 'teacher',
        fullName: 'Cô Giáo Thực Tế 10',
        phone: '0977888999',
        email: 'gv.thucte10@hoanang.edu.vn',
        position: 'teacher',
        payrollRole: 'teacher',
        salaryConfig: { baseSalary: 9500000, standardWorkDays: 26 }
      });
    expect(createTeacherOneStep.status).toBe(201);
    expect(createTeacherOneStep.body.data.userId).toBeTruthy();

    const teacherLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ schoolCode: 'HOANANG-A', username: 'gv.thucte10', password: '123456' });
    expect(teacherLoginRes.status).toBe(200);
    const tokenTeacher10 = teacherLoginRes.body.token;
    const teacherUserId = teacherLoginRes.body.user._id || teacherLoginRes.body.user.id;

    await Classroom.findByIdAndUpdate(realClassId, { homeroomTeacherId: teacherUserId });

    // 10.2 Thêm 2 anh chị em ruột chung SĐT Bố & Mẹ -> Tự cấp TK Phụ huynh cho cả Bố & Mẹ + Gom chung 2 con + Tự điền authorizedPickers
    const sharedParents = [
      { fullName: 'Nguyễn Văn Hùng', phone: '0911222333', email: 'hung.bo@gmail.com', relationship: 'father', isEmergencyContact: true },
      { fullName: 'Lê Thị Mai', phone: '0944555666', email: 'mai.me@gmail.com', relationship: 'mother', isEmergencyContact: false }
    ];

    const sib1Res = await request(app)
      .post('/api/students')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        fullName: 'Bé Nguyễn An Nhiên',
        birthDate: '2021-04-10',
        gender: 'female',
        classroomId: realClassId,
        parents: sharedParents
      });
    expect(sib1Res.status).toBe(201);
    const sib1 = sib1Res.body.data;
    expect(sib1.authorizedPickers.length).toBeGreaterThanOrEqual(2);

    const sib2Res = await request(app)
      .post('/api/students')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        fullName: 'Bé Nguyễn Bảo Khang',
        birthDate: '2021-11-20',
        gender: 'male',
        classroomId: realClassId,
        parents: sharedParents
      });
    expect(sib2Res.status).toBe(201);
    const sib2 = sib2Res.body.data;

    const dadLogin = await request(app)
      .post('/api/auth/login')
      .send({ schoolCode: 'HOANANG-A', username: '0911222333', password: '123456' });
    expect(dadLogin.status).toBe(200);
    expect(dadLogin.body.user.role).toBe('parent');

    const momLogin = await request(app)
      .post('/api/auth/login')
      .send({ schoolCode: 'HOANANG-A', username: '0944555666', password: '123456' });
    expect(momLogin.status).toBe(200);
    expect(momLogin.body.user.role).toBe('parent');

    const momChildrenRes = await request(app)
      .get('/api/students')
      .set('Authorization', `Bearer ${momLogin.body.token}`);
    expect(momChildrenRes.status).toBe(200);
    expect(momChildrenRes.body.data.map((s) => s.fullName).sort()).toEqual([
      'Bé Nguyễn An Nhiên',
      'Bé Nguyễn Bảo Khang'
    ]);

    // 10.3 Cô giáo điểm danh sáng & Trả trẻ 1 chạm buổi chiều ngay tại lớp (không cần PH đặt lịch trước)
    const todayStr = getWorkDate();
    await StudentAttendance.create({
      tenantId: tenantA._id,
      studentId: sib1._id,
      studentName: sib1.fullName,
      classroomId: realClassId,
      className: 'LA-THUCTE-10',
      attendDate: startOfWorkDate(todayStr),
      attendanceDateKey: todayStr,
      status: 'present',
      checkInTime: new Date(),
      recordedBy: teacherUserId,
      recordedByName: 'Cô Giáo Thực Tế 10'
    });

    const rosterBefore = await request(app)
      .get(`/api/pickups/class-roster/${realClassId}`)
      .query({ pickupDate: todayStr })
      .set('Authorization', `Bearer ${tokenTeacher10}`);
    expect(rosterBefore.status).toBe(200);
    expect(rosterBefore.body.data.summary.presentCount).toBe(1);
    const sib1Roster = rosterBefore.body.data.roster.find((r) => String(r.studentId) === String(sib1._id));
    expect(sib1Roster.isPresentToday).toBe(true);
    expect(sib1Roster.departed).toBe(false);
    const momOption = sib1Roster.pickerOptions.find((opt) => opt.fullName === 'Lê Thị Mai');
    expect(momOption).toBeTruthy();

    const handoverRes = await request(app)
      .post('/api/pickups/direct-handover')
      .set('Authorization', `Bearer ${tokenTeacher10}`)
      .send({
        studentId: sib1._id,
        pickupDate: todayStr,
        pickerKey: momOption.key,
        pickerId: momOption.pickerId,
        note: 'Mẹ đón trực tiếp tại cửa lớp'
      });
    expect(handoverRes.status).toBe(201);
    expect(handoverRes.body.data.status).toBe('confirmed');
    expect(handoverRes.body.data.picker.fullName).toBe('Lê Thị Mai');

    const rosterAfter = await request(app)
      .get(`/api/pickups/class-roster/${realClassId}`)
      .query({ pickupDate: todayStr })
      .set('Authorization', `Bearer ${tokenTeacher10}`);
    expect(rosterAfter.status).toBe(200);
    expect(rosterAfter.body.data.summary.departedCount).toBe(1);
    const sib1After = rosterAfter.body.data.roster.find((r) => String(r.studentId) === String(sib1._id));
    expect(sib1After.departed).toBe(true);
    expect(sib1After.departedPickerName).toBe('Lê Thị Mai');

    const mongoose = require('mongoose');
    const parentNotifs = await Notification.find({
      tenantId: tenantA._id,
      'metadata.pickupRecordId': new mongoose.Types.ObjectId(String(handoverRes.body.data._id))
    }).lean();
    expect(parentNotifs).toHaveLength(2);

    // 10.4 Lập học phí đầu tháng 11-2026: tự trừ ngày nghỉ có phép tháng 10-2026 theo đơn giá tùy chỉnh + sửa tay từng bé
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-07']) {
      await StudentAttendance.create({
        tenantId: tenantA._id,
        studentId: sib1._id,
        studentName: sib1.fullName,
        classroomId: realClassId,
        className: 'LA-THUCTE-10',
        attendDate: startOfWorkDate(d),
        attendanceDateKey: d,
        status: 'absent_permission',
        recordedBy: teacherUserId,
        recordedByName: 'Cô Giáo Thực Tế 10'
      });
    }
    await StudentAttendance.create({
      tenantId: tenantA._id,
      studentId: sib2._id,
      studentName: sib2.fullName,
      classroomId: realClassId,
      className: 'LA-THUCTE-10',
      attendDate: startOfWorkDate('2026-10-12'),
      attendanceDateKey: '2026-10-12',
      status: 'absent_permission',
      recordedBy: teacherUserId,
      recordedByName: 'Cô Giáo Thực Tế 10'
    });

    const previewRes = await request(app)
      .post('/api/finance/tuition/bulk/preview')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        classroomId: realClassId,
        period: '11-2026',
        tuitionBase: 1500000,
        mealFee: 880000,
        busFee: 0,
        extraFee: 0,
        discount: 0,
        dueDate: '2026-11-10',
        deductPriorMeal: true,
        creditPeriod: '10-2026',
        dailyMealCreditRate: 45000
      });
    expect(previewRes.status).toBe(200);
    expect(previewRes.body.data.dailyMealCreditRate).toBe(45000);
    const cred1 = previewRes.body.data.studentCredits.find((c) => String(c.studentId) === String(sib1._id));
    const cred2 = previewRes.body.data.studentCredits.find((c) => String(c.studentId) === String(sib2._id));
    expect(cred1.absentDays).toBe(3);
    expect(cred1.appliedDeduction).toBe(135000);
    expect(cred1.finalTotal).toBe(2245000);
    expect(cred2.absentDays).toBe(1);
    expect(cred2.appliedDeduction).toBe(45000);

    const bulkCreateRes = await request(app)
      .post('/api/finance/tuition/bulk')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        classroomId: realClassId,
        period: '11-2026',
        tuitionBase: 1500000,
        mealFee: 880000,
        busFee: 0,
        extraFee: 0,
        discount: 0,
        dueDate: '2026-11-10',
        deductPriorMeal: true,
        creditPeriod: '10-2026',
        dailyMealCreditRate: 45000,
        studentCreditOverrides: {
          [String(sib2._id)]: 50000
        }
      });
    expect(bulkCreateRes.status).toBe(201);
    const inv1 = bulkCreateRes.body.data.find((inv) => String(inv.studentId) === String(sib1._id));
    const inv2 = bulkCreateRes.body.data.find((inv) => String(inv.studentId) === String(sib2._id));
    expect(inv1.discount).toBe(135000);
    expect(inv1.totalAmount).toBe(2245000);
    expect(inv2.discount).toBe(50000);
    expect(inv2.totalAmount).toBe(2330000);
  });

  test('11. Exception & Edge-Case Hardening: Excel mất số 0 đầu SĐT, giữ SĐT/Người phụ trách Phân hiệu, Hoàn tác trả trẻ nhầm & Ràng buộc Lớp/Đa trường', async () => {
    const ExcelJS = require('exceljs');
    const todayStr = getWorkDate();

    // 11.1 Kiểm tra tìm kiếm nhân sự có ký tự đặc biệt Regex (+84, ngoặc tròn) không bị lỗi 500
    const regexSearchHr = await request(app)
      .get('/api/hr/employees')
      .query({ search: '+84(097)[test]' })
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(regexSearchHr.status).toBe(200);

    // 11.2 Lưu & sửa Phân hiệu giữ nguyên SĐT + Người phụ trách trên Tenant.campuses + hỗ trợ tên phân hiệu 1 ký tự
    const addShortCampus = await request(app)
      .post('/api/system/campuses')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        name: 'A',
        address: 'Số 10 Cầu Giấy',
        phone: '0909111222',
        managerName: 'Cô Phạm Thu Thủy'
      });
    expect(addShortCampus.status).toBe(201);
    expect(addShortCampus.body.data.code).toBe('CS-A');

    const campusesAfterSave = await request(app)
      .get('/api/system/campuses')
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(campusesAfterSave.status).toBe(200);
    const savedShort = campusesAfterSave.body.data.campuses.find((c) => c.code === 'CS-A');
    expect(savedShort.phone).toBe('0909111222');
    expect(savedShort.managerName).toBe('Cô Phạm Thu Thủy');

    // 11.3 Nhập Excel khi ô SĐT bị Excel cắt mất số 0 đầu (918765432 -> 0918765432) & bắt trùng mã nhân sự ngay ở Preview
    const existingEmp = await Employee.findOne({ tenantId: tenantA._id }).lean();
    const targetCls = await Classroom.findOne({ tenantId: tenantA._id, name: 'LA-THUCTE-10' }).lean();

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

    const wbErr = new ExcelJS.Workbook();
    await wbErr.xlsx.load(tplRes.body);
    const sheetErr = wbErr.getWorksheet('Danh sách học sinh');
    sheetErr.addRow([
      'LA-THUCTE-10',
      existingEmp.employeeCode, // cố tình trùng mã nhân sự!
      '',
      'Bé Trùng Mã NV',
      '10/05/2021',
      'Nam',
      '01/09/2026',
      'Phụ Huynh Test',
      918765432,
      '',
      'Bố'
    ]);
    const errBuf = Buffer.from(await wbErr.xlsx.writeBuffer());
    const previewCollision = await request(app)
      .post('/api/students/excel/preview')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .field('classroomId', String(targetCls._id))
      .attach('file', errBuf, 'collision.xlsx');
    expect(previewCollision.status).toBe(200);
    expect(previewCollision.body.data.canImport).toBe(false);
    expect(previewCollision.body.data.rows[0].errors.join(' ')).toContain('nhân sự');

    // Bây giờ nhập dòng hợp lệ có SĐT kiểu số mất số 0 đầu (918765432)
    const wbOk = new ExcelJS.Workbook();
    await wbOk.xlsx.load(tplRes.body);
    const sheetOk = wbOk.getWorksheet('Danh sách học sinh');
    sheetOk.addRow([
      'LA-THUCTE-10',
      '',
      '',
      'Bé Hoàng Gia Phúc',
      '12/06/2021',
      'Nam',
      '01/09/2026',
      'Hoàng Văn Long',
      918765432, // 9 chữ số bị mất số 0 đầu
      '',
      'Bố'
    ]);
    const okBuf = Buffer.from(await wbOk.xlsx.writeBuffer());
    const previewOk = await request(app)
      .post('/api/students/excel/preview')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .field('classroomId', String(targetCls._id))
      .attach('file', okBuf, 'no_zero_phone.xlsx');
    expect(previewOk.status).toBe(200);
    expect(previewOk.body.data.canImport).toBe(true);
    expect(previewOk.body.data.rows[0].parent1Phone).toBe('0918765432');

    const confirmOk = await request(app)
      .post('/api/students/excel/confirm')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .set('Idempotency-Key', `idem-edge-${Date.now()}`)
      .send({
        classroomId: String(targetCls._id),
        students: previewOk.body.data.rows
      });
    expect(confirmOk.status).toBe(201);
    const importedChild = confirmOk.body.data[0];

    // Bố đăng nhập được ngay bằng SĐT đã khôi phục số 0 ('0918765432' / '123456')
    const restoredParentLogin = await request(app)
      .post('/api/auth/login')
      .send({ schoolCode: 'HOANANG-A', username: '0918765432', password: '123456' });
    expect(restoredParentLogin.status).toBe(200);

    // 11.4 API lấy lớp đón trả trẻ + Hoàn tác trả trẻ nhầm (Undo Handover) rồi chọn lại người đón khác
    const teacherLogin = await request(app)
      .post('/api/auth/login')
      .send({ schoolCode: 'HOANANG-A', username: 'gv.thucte10', password: '123456' });
    const tokenTeacher = teacherLogin.body.token;

    const pickupClassesRes = await request(app)
      .get('/api/pickups/classrooms')
      .set('Authorization', `Bearer ${tokenTeacher}`);
    expect(pickupClassesRes.status).toBe(200);
    expect(pickupClassesRes.body.data).toHaveLength(1);

    const mistakenHandover = await request(app)
      .post('/api/pickups/direct-handover')
      .set('Authorization', `Bearer ${tokenTeacher}`)
      .send({
        studentId: importedChild._id,
        pickupDate: todayStr,
        pickerFullName: 'Bấm Nhầm Người',
        pickerRelationship: 'Chú'
      });
    expect(mistakenHandover.status).toBe(201);

    const undoRes = await request(app)
      .post(`/api/pickups/${mistakenHandover.body.data._id}/undo-handover`)
      .set('Authorization', `Bearer ${tokenTeacher}`)
      .send({ reason: 'Cô bấm nhầm dòng học sinh' });
    expect(undoRes.status).toBe(200);

    // Sau khi hoàn tác, bé trở về trạng thái chưa đón (departed = false) và có thể trả trẻ lại cho đúng Bố
    const reHandover = await request(app)
      .post('/api/pickups/direct-handover')
      .set('Authorization', `Bearer ${tokenTeacher}`)
      .send({
        studentId: importedChild._id,
        pickupDate: todayStr,
        pickerFullName: 'Hoàng Văn Long',
        pickerRelationship: 'Bố'
      });
    expect(reHandover.status).toBe(201);
    expect(reHandover.body.data.picker.fullName).toBe('Hoàng Văn Long');

    // 11.5 Ràng buộc sửa lớp học: chặn năm học sai (2026-2099), chặn hạ maxSize < sĩ số hiện tại, đồng bộ đổi tên lớp sang Student
    const badYearRes = await request(app)
      .put(`/api/classrooms/${targetCls._id}`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ schoolYear: '2026-2099' });
    expect(badYearRes.status).toBe(422);

    const shrinkMaxRes = await request(app)
      .put(`/api/classrooms/${targetCls._id}`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ maxSize: 1 });
    expect(shrinkMaxRes.status).toBe(422);

    const renameClassRes = await request(app)
      .put(`/api/classrooms/${targetCls._id}`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ name: 'LA-THUCTE-10-MOI' });
    expect(renameClassRes.status).toBe(200);
    const updatedStudent = await Student.findById(importedChild._id).lean();
    expect(updatedStudent.className).toBe('LA-THUCTE-10-MOI');
  });

  test('12. Swagger / OpenAPI 3.0.3 & Database Dictionary: Đầy đủ 7 Zones Database, kiểu trả về API và không đứt gãy $ref', async () => {
    // 12.1 Giao diện Swagger UI hoạt động tại cả /api-docs/ và /api/docs/
    const uiRes1 = await request(app).get('/api-docs/');
    expect(uiRes1.status).toBe(200);
    expect(uiRes1.headers['content-type']).toContain('text/html');
    expect(uiRes1.text).toContain('Tài liệu API & Database');

    const uiRes2 = await request(app).get('/api/docs/');
    expect(uiRes2.status).toBe(200);
    expect(uiRes2.headers['content-type']).toContain('text/html');

    // 12.2 Đặc tả JSON OpenAPI 3.0.3 chi tiết và toàn bộ $ref đều trỏ tới Schema hợp lệ
    const specRes = await request(app).get('/api-docs.json');
    expect(specRes.status).toBe(200);
    const spec = specRes.body;
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.tags.length).toBeGreaterThanOrEqual(15);

    const schemas = spec.components?.schemas || {};
    expect(schemas.DB_Tenant).toBeDefined();
    expect(schemas.DB_Tenant.properties.campuses.items.properties.managerName.type).toBe('string');
    expect(schemas.DB_Student).toBeDefined();
    expect(schemas.DB_Student.properties.vaccinations.type).toBe('array');
    expect(schemas.DB_Student.properties.growthRecords.type).toBe('array');
    expect(schemas.DB_Employee).toBeDefined();
    expect(schemas.DB_TuitionFee).toBeDefined();
    expect(schemas.DB_PickupRecord).toBeDefined();
    expect(schemas.DB_User.properties.passwordHash.writeOnly).toBe(true);

    // Đệ quy kiểm tra mọi tham chiếu $ref trong toàn bộ paths & schemas đều tồn tại 100%
    const collectRefs = (node, list = []) => {
      if (!node || typeof node !== 'object') return list;
      if (typeof node.$ref === 'string') list.push(node.$ref);
      for (const val of Object.values(node)) collectRefs(val, list);
      return list;
    };
    const allRefs = collectRefs(spec);
    expect(allRefs.length).toBeGreaterThan(30);
    for (const ref of allRefs) {
      const schemaName = ref.replace('#/components/schemas/', '');
      expect(schemas[schemaName]).toBeDefined();
    }

    // 12.3 Từ điển Cơ sở dữ liệu 7 Phân vùng (/api/docs/database)
    const dbDictRes = await request(app).get('/api/docs/database');
    expect(dbDictRes.status).toBe(200);
    expect(dbDictRes.body.success).toBe(true);
    expect(dbDictRes.body.totalZones).toBe(7);
    expect(dbDictRes.body.totalCollections).toBeGreaterThanOrEqual(70);
  });

  test('13. Deep Exception & Tenant Isolation Audit Round 2: Regex đặc biệt, ngày không tồn tại, maxSize, ObjectId sai, Object password & Thông báo SaaS', async () => {
    // 13.1 Ký tự Regex đặc biệt "(", "[", "+" trong tìm kiếm Hóa đơn & Món ăn không gây crash 500
    const regexInvoiceRes = await request(app)
      .get('/api/finance/invoices')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .query({ search: 'Lớp Mầm 1 ([+*' });
    expect(regexInvoiceRes.status).toBe(200);

    const regexDishRes = await request(app)
      .get('/api/nutrition/dishes')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .query({ search: 'Cháo thịt (ít muối [+' });
    expect(regexDishRes.status).toBe(200);

    // 13.2 Gửi mảng lặp khóa vào query param (?search=an&search=binh trên Express 5) trả 400 thay vì crash 500 TypeError .trim()
    const arrayQueryStudent = await request(app)
      .get('/api/students?search=an&search=binh')
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(arrayQueryStudent.status).toBe(400);

    // 13.3 Gửi Object thay chuỗi vào password đăng nhập bị chặn 400 thay vì crash 500 bcrypt
    const badLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ schoolCode: tenantA.code, username: 'admin', password: { $gt: '' } });
    expect(badLoginRes.status).toBe(400);

    // 13.4 Gửi ObjectId sai vào các route có middleware khóa kỳ kế toán trả 400 thay vì 500 CastError
    const badCancelInvoice = await request(app)
      .put('/api/finance/tuition/cancel/not-an-object-id')
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(badCancelInvoice.status).toBe(400);

    const badPayrollStatus = await request(app)
      .patch('/api/hr/payroll/not-an-object-id/status')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ status: 'reviewed' });
    expect(badPayrollStatus.status).toBe(400);

    const badPayrollQuery = await request(app)
      .get('/api/hr/payroll?month=abc&year=xyz')
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(badPayrollQuery.status).toBe(400);

    // 13.5 Chặn ngày sinh không tồn tại trên lịch ("2023-02-31") và chặn vượt sĩ số maxSize khi tạo lẻ học sinh
    const tinyClsRes = await request(app)
      .post('/api/classrooms')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ name: 'LOP-MAX-1', ageGroup: '2-3', maxSize: 1, schoolYear: '2026-2027' });
    expect(tinyClsRes.status).toBe(201);
    const tinyClsId = tinyClsRes.body.data._id;

    const fakeDateStudent = await request(app)
      .post('/api/students')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        fullName: 'Bé Ngày 31 Tháng 2',
        birthDate: '2023-02-31',
        gender: 'male',
        classroomId: tinyClsId
      });
    expect(fakeDateStudent.status).toBe(422);

    const firstValidStudent = await request(app)
      .post('/api/students')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        fullName: 'Bé Đủ Sĩ Số 1',
        birthDate: '2023-05-10',
        gender: 'female',
        classroomId: tinyClsId,
        parents: [{ fullName: 'Mẹ Bé 1', phone: '0966778899', relationship: 'mother', isPrimary: true }]
      });
    expect(firstValidStudent.status).toBe(201);

    const overCapacityStudent = await request(app)
      .post('/api/students')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        fullName: 'Bé Vượt Sĩ Số 2',
        birthDate: '2023-06-12',
        gender: 'male',
        classroomId: tinyClsId
      });
    expect(overCapacityStudent.status).toBe(409);

    // 13.6 Cách ly dị ứng thực đơn giữa 2 trường: Admin Trường B không thể kiểm tra lớp của Trường A
    const freshAdminB = await User.findById(adminB._id);
    const freshTenantB = await Tenant.findById(tenantB._id);
    const freshTokenAdminB = generateSchoolUserToken(freshAdminB, freshTenantB);
    const crossTenantAllergy = await request(app)
      .post('/api/nutrition/menus/check-allergies')
      .set('Authorization', `Bearer ${freshTokenAdminB}`)
      .send({ classroomId: tinyClsId, days: [] });
    expect(crossTenantAllergy.status).toBe(404);

    // 13.7 Chặn trả trẻ nhầm khi học sinh đang điểm danh Nghỉ có phép (trừ khi gửi cờ xác nhận forceAbsentHandover)
    const todayStr = getWorkDate(new Date());
    await request(app)
      .post('/api/attendance')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        studentId: firstValidStudent.body.data._id,
        classroomId: tinyClsId,
        attendDate: todayStr,
        status: 'absent_permission',
        note: 'Bé nghỉ ốm có xin phép'
      });

    const blockedAbsentHandover = await request(app)
      .post('/api/pickups/direct-handover')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        studentId: firstValidStudent.body.data._id,
        pickupDate: todayStr,
        pickerFullName: 'Mẹ Bé 1'
      });
    expect(blockedAbsentHandover.status).toBe(409);

    const forcedAbsentHandover = await request(app)
      .post('/api/pickups/direct-handover')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        studentId: firstValidStudent.body.data._id,
        pickupDate: todayStr,
        pickerFullName: 'Mẹ Bé 1',
        forceAbsentHandover: true
      });
    expect(forcedAbsentHandover.status).toBe(201);
  });

  test('14. Anti-Bot Public Shield, NoSQL Sanitizer, Honeypot, Webhook Auth & Preschool Asset/HR Sync', async () => {
    // 14.1 robots.txt cấm thu thập dữ liệu và gắn X-Robots-Tag
    const robotsRes = await request(app).get('/robots.txt');
    expect(robotsRes.status).toBe(200);
    expect(robotsRes.text).toContain('Disallow: /');
    expect(robotsRes.headers['x-robots-tag']).toContain('noindex');

    // 14.2 Chặn ngay các đường dẫn dò quét lỗ hổng (.env, wp-login.php, phpmyadmin) trước SPA Fallback (không trả 200 HTML)
    for (const probePath of ['/.env', '/.git/config', '/wp-login.php', '/phpmyadmin/index.php', '/actuator/env']) {
      const probeRes = await request(app).get(probePath);
      expect(probeRes.status).toBe(404);
      expect(probeRes.headers['content-type']).toMatch(/application\/json/);
    }

    // 14.3 Chặn công cụ quét tự động (sqlmap, nuclei, nikto) qua User-Agent
    const scannerUaRes = await request(app)
      .get('/api/health')
      .set('User-Agent', 'sqlmap/1.8.2#stable (https://sqlmap.org)');
    expect(scannerUaRes.status).toBe(403);
    expect(scannerUaRes.body.code).toBe('BOT_SCANNER_BLOCKED');

    // 14.4 Bẫy Honeypot ẩn trên biểu mẫu đăng nhập chặn ngay Bot tự điền form
    const honeypotLogin = await request(app)
      .post('/api/auth/login')
      .send({
        schoolCode: 'HOANANG-A',
        username: 'admin',
        password: '123456',
        _hp_website: 'http://spam-bot.example.com'
      });
    expect(honeypotLogin.status).toBe(403);
    expect(honeypotLogin.body.code).toBe('BOT_DETECTED');

    // 14.5 Chống NoSQL Operator Injection ($gt, $ne) trên body đăng nhập
    const nosqlLogin = await request(app)
      .post('/api/auth/login')
      .send({
        schoolCode: 'HOANANG-A',
        username: { $gt: '' },
        password: { $gt: '' }
      });
    expect(nosqlLogin.status).toBe(400);

    // 14.6 Khóa đọc /api/attendance/webhook/logs ẩn danh (chống lộ dữ liệu sinh trắc học đa trường)
    const anonWebhookLogs = await request(app).get('/api/attendance/webhook/logs');
    expect(anonWebhookLogs.status).toBe(401);

    const authedWebhookLogs = await request(app)
      .get('/api/attendance/webhook/logs')
      .set('Authorization', `Bearer ${tokenAdminA}`);
    expect(authedWebhookLogs.status).toBe(200);

    // 14.7 Tạo Tài sản lớp học trực tiếp (không bắt buộc tạo ItemMaster trước) thành công 201
    const assetRes = await request(app)
      .post('/api/procurement/assets')
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({
        assetCode: 'TS-LOP-01',
        name: 'Tủ sấy ca cốc tiệt trùng UV',
        category: 'equipment',
        purchaseValue: 6500000,
        currentValue: 6000000,
        location: 'Lớp Nhà trẻ 1',
        status: 'active'
      });
    expect(assetRes.status).toBe(201);
    expect(assetRes.body.data.originalCost).toBe(6500000);
  });
});

