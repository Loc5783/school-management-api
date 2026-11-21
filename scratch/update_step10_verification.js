const fs = require('fs');

let content = fs.readFileSync('backend/scripts/rehearse_cutover.js', 'utf8');

const targetStart = `  // 2. Verified Inventory of 12 Residual Global Unique Indexes in Database
  console.log('\\n  -> Thực hiện truy vấn kiểm kê 12 Residual Global Unique Index trong MongoDB...');`;

const targetEnd = `  for (const gr of gatedRoutes) {
    const res = await request(app).get(gr).set('Authorization', \`Bearer \${tokenAccountantA}\`);
    recordAssertion(\`Gated route "\${gr}" returns HTTP 501 Not Implemented\`, res.status === 501);
  }`;

const replacementCode = `  // 2. Verified Inventory: All 21 Business Collections Have Compound Multi-Tenant Unique Indexes
  console.log('\\n  -> Thực hiện kiểm kê xác nhận 21 bộ sưu tập nghiệp vụ có Compound Multi-Tenant Unique Index...');
  const COMPOUND_INDEX_VERIFICATIONS = [
    { col: 'accountingperiods', expectedKey: { tenantId: 1, month: 1 } },
    { col: 'dailycashreconciliations', expectedKey: { tenantId: 1, workDate: 1 } },
    { col: 'operatingexpenserequests', expectedKey: { tenantId: 1, requestKey: 1 } },
    { col: 'feeschedules', expectedKey: { tenantId: 1, period: 1, classroomId: 1 } },
    { col: 'payments', expectedKey: { tenantId: 1, receiptNumber: 1 } },
    { col: 'operatingexpenses', expectedKey: { tenantId: 1, documentNumber: 1 } },
    { col: 'departments', expectedKey: { tenantId: 1, code: 1 } },
    { col: 'employees', expectedKey: { tenantId: 1, employeeCode: 1 } },
    { col: 'classrooms', expectedKey: { tenantId: 1, schoolYear: 1, homeroomTeacherId: 1 } },
    { col: 'students', expectedKey: { tenantId: 1, studentCode: 1 } },
    { col: 'suppliers', expectedKey: { tenantId: 1, code: 1 } },
    { col: 'ingredientmasters', expectedKey: { tenantId: 1, code: 1 } },
    { col: 'kitchenstaffs', expectedKey: { tenantId: 1, staffCode: 1 } },
    { col: 'foodsamples', expectedKey: { tenantId: 1, sampleCode: 1 } },
    { col: 'kitchenequipments', expectedKey: { tenantId: 1, code: 1 } },
    { col: 'kitchenrequests', expectedKey: { tenantId: 1, requestCode: 1 } },
    { col: 'pickuprecords', expectedKey: { tenantId: 1, pickupCode: 1 } },
    { col: 'purchaseorders', expectedKey: { tenantId: 1, orderCode: 1 } },
    { col: 'kitchendayclosings', expectedKey: { tenantId: 1, dateKey: 1 } },
    { col: 'studentcodecounters', expectedKey: { tenantId: 1, year: 1 } },
    { col: 'evaluationperiods', expectedKey: { tenantId: 1, code: 1 } }
  ];

  let verifiedCompoundCount = 0;
  for (const item of COMPOUND_INDEX_VERIFICATIONS) {
    const indexes = await db.collection(item.col).indexes();
    const hasCompoundTenant = indexes.some(idx => {
      if (!idx.unique) return false;
      const keys = Object.keys(idx.key);
      return keys.includes('tenantId') && Object.keys(item.expectedKey).every(k => idx.key[k] === item.expectedKey[k]);
    });
    if (hasCompoundTenant) verifiedCompoundCount++;
    recordAssertion(\`Compound Multi-Tenant unique index verified active: \${item.col} (\${JSON.stringify(item.expectedKey)})\`, hasCompoundTenant);
  }
  recordAssertion(\`All 21 business collections have active compound tenant unique indexes\`, verifiedCompoundCount === 21);

  // Verify users.username_1 is the platform global unique username index
  const userIndexes = await db.collection('users').indexes();
  const hasGlobalUsername = userIndexes.some(idx => idx.name === 'username_1' && idx.unique === true && !Object.keys(idx.key).includes('tenantId'));
  recordAssertion('Platform global unique index verified: users.username_1', hasGlobalUsername);

  // --------------------------------------------------------------------------
  // BƯỚC 11: KIỂM CHỨNG TOÀN DIỆN CÁC PHÂN HỆ SAAS CHO CẢ TENANT A VÀ TENANT B
  // --------------------------------------------------------------------------
  console.log('\\n[11/11] Kiểm thử đa trường thực tế (Multi-tenant) cho tất cả các phân hệ và vai trò...');

  // 1. Đăng nhập bổ sung các vai trò cho Tenant A và Tenant B
  const chefPass = legacyCredentials['chef'] || '123456';
  const guardPass = legacyCredentials['guard'] || '123456';
  const teacherPass = legacyCredentials['teacher'] || '123456';
  const adminPass = legacyCredentials['admin'] || '123456';

  const loginResChefA = await request(app).post('/api/auth/login').send({ schoolCode: 'HOANANG-A', username: 'chef', password: chefPass });
  recordAssertion('Real HTTP login Tenant A (chef / HOANANG-A) returns 200 OK', loginResChefA.status === 200);
  const tokenChefA = loginResChefA.body?.token;

  const loginResGuardA = await request(app).post('/api/auth/login').send({ schoolCode: 'HOANANG-A', username: 'guard', password: guardPass });
  recordAssertion('Real HTTP login Tenant A (guard / HOANANG-A) returns 200 OK', loginResGuardA.status === 200);
  const tokenGuardA = loginResGuardA.body?.token;

  const loginResTeacherA = await request(app).post('/api/auth/login').send({ schoolCode: 'HOANANG-A', username: 'teacher', password: teacherPass });
  recordAssertion('Real HTTP login Tenant A (teacher / HOANANG-A) returns 200 OK', loginResTeacherA.status === 200);
  const tokenTeacherA = loginResTeacherA.body?.token;

  const loginResAdminA = await request(app).post('/api/auth/login').send({ schoolCode: 'HOANANG-A', username: 'admin', password: adminPass });
  recordAssertion('Real HTTP login Tenant A (admin / HOANANG-A) returns 200 OK', loginResAdminA.status === 200);
  const tokenAdminA = loginResAdminA.body?.token;

  const credsChefB = credentialsExport.accounts.find(a => a.username === 'bep_b');
  const loginResChefB = await request(app).post('/api/auth/login').send({ schoolCode: 'HOANANG-B', username: 'bep_b', password: credsChefB?.password });
  recordAssertion('Real HTTP login Tenant B (bep_b / HOANANG-B) returns 200 OK', loginResChefB.status === 200);
  const tokenChefB = loginResChefB.body?.token;

  const credsGuardB = credentialsExport.accounts.find(a => a.username === 'baove_b');
  const loginResGuardB = await request(app).post('/api/auth/login').send({ schoolCode: 'HOANANG-B', username: 'baove_b', password: credsGuardB?.password });
  recordAssertion('Real HTTP login Tenant B (baove_b / HOANANG-B) returns 200 OK', loginResGuardB.status === 200);
  const tokenGuardB = loginResGuardB.body?.token;

  const credsTeacherB = credentialsExport.accounts.find(a => a.username === 'giaovien_b');
  const loginResTeacherB = await request(app).post('/api/auth/login').send({ schoolCode: 'HOANANG-B', username: 'giaovien_b', password: credsTeacherB?.password });
  recordAssertion('Real HTTP login Tenant B (giaovien_b / HOANANG-B) returns 200 OK', loginResTeacherB.status === 200);
  const tokenTeacherB = loginResTeacherB.body?.token;

  // Cross-school login rejected
  const crossLoginRes = await request(app).post('/api/auth/login').send({ schoolCode: 'HOANANG-B', username: 'accountant', password: accountantPass });
  recordAssertion('Cross-school login attempt (HOANANG-A user on HOANANG-B) rejected (401/403)', [401, 403].includes(crossLoginRes.status));

  // 2. Multi-Tenant Nutrition (Nhà bếp)
  const resDishesA = await request(app).get('/api/nutrition/dishes').set('Authorization', \`Bearer \${tokenChefA}\`);
  recordAssertion('Chef A queries /api/nutrition/dishes returns 200 OK', resDishesA.status === 200);

  const resDishesB = await request(app).get('/api/nutrition/dishes').set('Authorization', \`Bearer \${tokenChefB}\`);
  recordAssertion('Chef B queries /api/nutrition/dishes returns 200 OK', resDishesB.status === 200);

  // Chef A creates Dish
  const createDishARes = await request(app)
    .post('/api/nutrition/dishes')
    .set('Authorization', \`Bearer \${tokenChefA}\`)
    .send({ name: 'Canh Chua Rau Muống', mealType: 'soup' });
  recordAssertion('Chef A creates dish "Canh Chua Rau Muống" returns 201 Created', createDishARes.status === 201);
  const dishAId = createDishARes.body?.data?._id;

  // Chef B creates Dish with SAME name -> No duplicate conflict between schools
  const createDishBRes = await request(app)
    .post('/api/nutrition/dishes')
    .set('Authorization', \`Bearer \${tokenChefB}\`)
    .send({ name: 'Canh Chua Rau Muống', mealType: 'soup' });
  recordAssertion('Chef B creates dish with SAME name in Tenant B succeeds without collision', createDishBRes.status === 201);
  const dishBId = createDishBRes.body?.data?._id;

  // Chef A queries Dish B directly -> 404 Not Found (Cross-tenant isolated)
  const crossDishRes = await request(app)
    .get(\`/api/nutrition/dishes/\${dishBId}\`)
    .set('Authorization', \`Bearer \${tokenChefA}\`);
  recordAssertion('Chef A querying Dish B directly returns 404 (cross-tenant isolated)', [403, 404].includes(crossDishRes.status));

  // Chef A creates Supplier with code
  const supARes = await request(app)
    .post('/api/nutrition/suppliers')
    .set('Authorization', \`Bearer \${tokenChefA}\`)
    .send({ name: 'NCC Thực Phẩm Sạch A', code: 'NCC-FOOD-01', phone: '0912345678' });
  recordAssertion('Chef A creates supplier returns 201 Created', supARes.status === 201);

  // Chef B creates Supplier with SAME code -> No duplicate conflict
  const supBRes = await request(app)
    .post('/api/nutrition/suppliers')
    .set('Authorization', \`Bearer \${tokenChefB}\`)
    .send({ name: 'NCC Thực Phẩm Sạch B', code: 'NCC-FOOD-01', phone: '0987654321' });
  recordAssertion('Chef B creates supplier with SAME code in Tenant B succeeds without collision', supBRes.status === 201);

  // 3. Multi-Tenant Notifications
  const teacherADoc = await db.collection('users').findOne({ username: 'teacher' });
  const teacherBDoc = await db.collection('users').findOne({ username: 'giaovien_b' });

  const notifARes = await request(app)
    .post('/api/notifications')
    .set('Authorization', \`Bearer \${tokenAdminA}\`)
    .send({
      recipientId: teacherADoc._id.toString(),
      title: 'Họp Hội Đồng Trường A',
      message: 'Kính mời giáo viên tham dự họp hội đồng trường A chiều nay.',
      type: 'info'
    });
  recordAssertion('Admin A creates notification for Teacher A returns 201 Created', notifARes.status === 201);
  const notifAId = notifARes.body?.data?._id || notifARes.body?._id;

  const notifListTeacherA = await request(app).get('/api/notifications').set('Authorization', \`Bearer \${tokenTeacherA}\`);
  const teacherAFoundNotif = (notifListTeacherA.body?.data || notifListTeacherA.body || []).some(n => n.title === 'Họp Hội Đồng Trường A');
  recordAssertion('Teacher A sees School A notification', notifListTeacherA.status === 200 && teacherAFoundNotif);

  const notifListTeacherB = await request(app).get('/api/notifications').set('Authorization', \`Bearer \${tokenTeacherB}\`);
  const teacherBFoundNotif = (notifListTeacherB.body?.data || notifListTeacherB.body || []).some(n => n.title === 'Họp Hội Đồng Trường A');
  recordAssertion('Teacher B does NOT see School A notification (cross-tenant isolated)', notifListTeacherB.status === 200 && !teacherBFoundNotif);

  if (notifAId) {
    const markReadRes = await request(app).patch(\`/api/notifications/\${notifAId}/read\`).set('Authorization', \`Bearer \${tokenTeacherA}\`);
    recordAssertion('Teacher A marks notification read returns 200 OK', markReadRes.status === 200);
  }

  // 4. Multi-Tenant Chat
  // Parent A opens conversation with Teacher A
  const chatOpenRes = await request(app)
    .post('/api/chat/conversations')
    .set('Authorization', \`Bearer \${tokenParentA}\`)
    .send({ userId: teacherADoc._id.toString(), studentId: studentAId });
  recordAssertion('Parent A opens conversation with Teacher A returns 200/201', [200, 201].includes(chatOpenRes.status));
  const convId = chatOpenRes.body?.data?._id || chatOpenRes.body?._id;

  if (convId) {
    const msgRes = await request(app)
      .post(\`/api/chat/conversations/\${convId}/messages\`)
      .set('Authorization', \`Bearer \${tokenParentA}\`)
      .send({ content: 'Xin chào cô giáo, hôm nay cháu có ăn hết cơm không ạ?' });
    recordAssertion('Parent A sends chat message returns 201 Created', [200, 201].includes(msgRes.status));
  }

  // Parent A attempts to open conversation with Teacher B -> Cross-tenant rejected (HTTP 403 Forbidden)
  const crossChatRes = await request(app)
    .post('/api/chat/conversations')
    .set('Authorization', \`Bearer \${tokenParentA}\`)
    .send({ userId: teacherBDoc._id.toString(), studentId: studentAId });
  recordAssertion('Parent A opening chat with Teacher B rejected with HTTP 403 Forbidden', crossChatRes.status === 403);

  // 5. Multi-Tenant Pickups & Guard
  const guardDashARes = await request(app).get('/api/guard/dashboard').set('Authorization', \`Bearer \${tokenGuardA}\`);
  recordAssertion('Guard A accesses /api/guard/dashboard returns 200 OK', guardDashARes.status === 200);

  const guardDashBRes = await request(app).get('/api/guard/dashboard').set('Authorization', \`Bearer \${tokenGuardB}\`);
  recordAssertion('Guard B accesses /api/guard/dashboard returns 200 OK', guardDashBRes.status === 200);

  // Guard A activates emergency mode
  const emgARes = await request(app)
    .post('/api/guard/emergency-mode')
    .set('Authorization', \`Bearer \${tokenGuardA}\`)
    .send({ level: 'security', title: 'Khẩn Cấp Cơ Sở A', instructions: 'Di tản theo cửa số 1' });
  recordAssertion('Guard A activates emergency mode returns 201 Created', emgARes.status === 201);

  // Guard B activates emergency mode concurrently -> Both succeed without collision
  const emgBRes = await request(app)
    .post('/api/guard/emergency-mode')
    .set('Authorization', \`Bearer \${tokenGuardB}\`)
    .send({ level: 'security', title: 'Khẩn Cấp Cơ Sở B', instructions: 'Di tản theo cửa số 2' });
  recordAssertion('Guard B activates emergency mode concurrently in Tenant B without E11000 collision', emgBRes.status === 201);

  const getEmgARes = await request(app).get('/api/guard/emergency-mode').set('Authorization', \`Bearer \${tokenGuardA}\`);
  recordAssertion('Guard A queries emergency mode and gets School A emergency', getEmgARes.status === 200 && getEmgARes.body?.data?.title === 'Khẩn Cấp Cơ Sở A');

  const getEmgBRes = await request(app).get('/api/guard/emergency-mode').set('Authorization', \`Bearer \${tokenGuardB}\`);
  recordAssertion('Guard B queries emergency mode and gets School B emergency', getEmgBRes.status === 200 && getEmgBRes.body?.data?.title === 'Khẩn Cấp Cơ Sở B');

  // 6. Multi-Tenant Procurement
  const procReqARes = await request(app)
    .post('/api/procurement/requests')
    .set('Authorization', \`Bearer \${tokenAdminA}\`)
    .send({
      title: 'Mua Bàn Ghế Gỗ Trường A',
      items: [{ itemName: 'Bàn ghế học sinh', quantity: 10, estimatedPrice: 500000 }]
    });
  recordAssertion('Admin A creates procurement request returns 201 Created', procReqARes.status === 201);
  const reqAId = procReqARes.body?.data?._id;

  const procReqBRes = await request(app)
    .post('/api/procurement/requests')
    .set('Authorization', \`Bearer \${tokenAdminB}\`)
    .send({
      title: 'Mua Bàn Ghế Gỗ Trường B',
      items: [{ itemName: 'Bàn ghế học sinh', quantity: 15, estimatedPrice: 500000 }]
    });
  recordAssertion('Admin B creates procurement request returns 201 Created', procReqBRes.status === 201);

  const listProcARes = await request(app).get('/api/procurement/requests').set('Authorization', \`Bearer \${tokenAdminA}\`);
  const listProcBRes = await request(app).get('/api/procurement/requests').set('Authorization', \`Bearer \${tokenAdminB}\`);
  const reqAInAList = (listProcARes.body?.data || listProcARes.body || []).some(r => r.title === 'Mua Bàn Ghế Gỗ Trường A');
  const reqAInBList = (listProcBRes.body?.data || listProcBRes.body || []).some(r => r.title === 'Mua Bàn Ghế Gỗ Trường A');
  recordAssertion('Admin A sees School A procurement request, Admin B does not (cross-tenant isolated)', reqAInAList && !reqAInBList);

  // 7. Multi-Tenant Classroom & Student Mutations (CRUD)
  // Admin A creates Classroom
  const createClassARes = await request(app)
    .post('/api/classrooms')
    .set('Authorization', \`Bearer \${tokenAdminA}\`)
    .send({
      name: 'Lớp Vàng Anh (A)',
      ageGroup: '3-4',
      schoolYear: '2026-2027',
      maxSize: 30
    });
  recordAssertion('Admin A creates classroom "Lớp Vàng Anh (A)" returns 201 Created', createClassARes.status === 201);
  const newClassAId = createClassARes.body?.data?._id;

  // Admin B creates Classroom with SAME name -> Succeeds without collision
  const createClassBRes = await request(app)
    .post('/api/classrooms')
    .set('Authorization', \`Bearer \${tokenAdminB}\`)
    .send({
      name: 'Lớp Vàng Anh (A)',
      ageGroup: '3-4',
      schoolYear: '2026-2027',
      maxSize: 30
    });
  recordAssertion('Admin B creates classroom with SAME name in Tenant B succeeds without collision', createClassBRes.status === 201);
  const newClassBId = createClassBRes.body?.data?._id;

  // Admin A creates Student
  const createStudARes = await request(app)
    .post('/api/students')
    .set('Authorization', \`Bearer \${tokenAdminA}\`)
    .send({
      fullName: 'Trần Văn Hoàng An',
      studentCode: 'HS-2026-MULTI01',
      classroomId: newClassAId,
      gender: 'male',
      dateOfBirth: '2022-03-10',
      enrollmentDate: '2026-09-01'
    });
  recordAssertion('Admin A creates student "Trần Văn Hoàng An" returns 201 Created', createStudARes.status === 201);
  const newStudentAId = createStudARes.body?.data?._id;

  // Admin B creates Student with SAME studentCode -> Succeeds without collision
  const createStudBRes = await request(app)
    .post('/api/students')
    .set('Authorization', \`Bearer \${tokenAdminB}\`)
    .send({
      fullName: 'Lê Văn Bình Nam',
      studentCode: 'HS-2026-MULTI01',
      classroomId: newClassBId,
      gender: 'male',
      dateOfBirth: '2022-04-12',
      enrollmentDate: '2026-09-01'
    });
  recordAssertion('Admin B creates student with SAME studentCode in Tenant B succeeds without collision', createStudBRes.status === 201);
  const newStudentBId = createStudBRes.body?.data?._id;

  // Admin A updates Student A -> 200 OK
  const updateStudARes = await request(app)
    .put(\`/api/students/\${newStudentAId}\`)
    .set('Authorization', \`Bearer \${tokenAdminA}\`)
    .send({
      fullName: 'Trần Văn Hoàng An (Cập Nhật)'
    });
  recordAssertion('Admin A updates student A returns 200 OK', updateStudARes.status === 200);

  // Admin A tries to update Student B -> 404 Not Found (Cross-tenant mutation rejected)
  const crossUpdateStudRes = await request(app)
    .put(\`/api/students/\${newStudentBId}\`)
    .set('Authorization', \`Bearer \${tokenAdminA}\`)
    .send({
      fullName: 'Tấn Công Chéo Trường'
    });
  recordAssertion('Admin A cross-tenant update Student B rejected with HTTP 404', crossUpdateStudRes.status === 404);

  // 8. Multi-Tenant Parent Feedback & Student Profile Change Requests
  const feedbackARes = await request(app)
    .post('/api/parent-feedback')
    .set('Authorization', \`Bearer \${tokenParentA}\`)
    .send({
      category: 'nutrition',
      title: 'Góp ý thực đơn tuần mới',
      content: 'Cháu rất thích món canh rau ngót thịt bằm của trường.'
    });
  recordAssertion('Parent A submits feedback returns 201 Created', feedbackARes.status === 201);

  const listFbARes = await request(app).get('/api/parent-feedback').set('Authorization', \`Bearer \${tokenAdminA}\`);
  const listFbBRes = await request(app).get('/api/parent-feedback').set('Authorization', \`Bearer \${tokenAdminB}\`);
  const fbAInAList = (listFbARes.body?.data || listFbARes.body || []).some(f => f.title === 'Góp ý thực đơn tuần mới');
  const fbAInBList = (listFbBRes.body?.data || listFbBRes.body || []).some(f => f.title === 'Góp ý thực đơn tuần mới');
  recordAssertion('Admin A sees School A parent feedback, Admin B does not (cross-tenant isolated)', fbAInAList && !fbAInBList);

  const profileReqARes = await request(app)
    .post('/api/student-profile-change-requests')
    .set('Authorization', \`Bearer \${tokenParentA}\`)
    .send({
      studentId: studentAId,
      changeType: 'allergies',
      requestedChanges: { allergies: ['Phấn hoa'] },
      reason: 'Phụ huynh cập nhật thông tin dị ứng mới của con'
    });
  recordAssertion('Parent A submits student profile change request returns 201 Created', profileReqARes.status === 201);

  const listProfileReqARes = await request(app).get('/api/student-profile-change-requests').set('Authorization', \`Bearer \${tokenAdminA}\`);
  const listProfileReqBRes = await request(app).get('/api/student-profile-change-requests').set('Authorization', \`Bearer \${tokenAdminB}\`);
  const prAInAList = (listProfileReqARes.body?.data || listProfileReqARes.body || []).some(r => r.reason === 'Phụ huynh cập nhật thông tin dị ứng mới của con');
  const prAInBList = (listProfileReqBRes.body?.data || listProfileReqBRes.body || []).some(r => r.reason === 'Phụ huynh cập nhật thông tin dị ứng mới của con');
  recordAssertion('Admin A sees School A student profile change request, Admin B does not (cross-tenant isolated)', prAInAList && !prAInBList);`;

content = content.replace(
  content.substring(content.indexOf(targetStart), content.indexOf(targetEnd) + targetEnd.length),
  replacementCode
);

fs.writeFileSync('backend/scripts/rehearse_cutover.js', content, 'utf8');
console.log('Step 10 and Step 11 verification updated in rehearse_cutover.js successfully!');
