const fs = require('fs');

let content = fs.readFileSync('backend/scripts/rehearse_cutover.js', 'utf8');

// 1. Update INDEX_GROUPS in Step 5
const oldIndexGroupsMarker = `  console.log('\\n[5/10] Chuyển đổi và kiểm chứng va chạm (Collision) cho 9 nhóm Index...');

  const INDEX_GROUPS = [`;

const newIndexGroups = `  console.log('\\n[5/10] Chuyển đổi và kiểm chứng va chạm (Collision) cho 21 nhóm Index...');

  const INDEX_GROUPS = [
    {
      col: 'accountingperiods',
      oldIndex: 'month_1',
      field: 'month',
      newSpecs: [
        { name: 'tenantId_1_month_1_unique', keys: { tenantId: 1, month: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
        { name: 'legacy_month_1_unique', keys: { month: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
      ],
      sampleVal: '2027-01'
    },
    {
      col: 'dailycashreconciliations',
      oldIndex: 'workDate_1',
      field: 'workDate',
      newSpecs: [
        { name: 'tenantId_1_workDate_1_unique', keys: { tenantId: 1, workDate: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
        { name: 'legacy_workDate_1_unique', keys: { workDate: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
      ],
      sampleVal: '2027-01-15'
    },
    {
      col: 'operatingexpenserequests',
      oldIndex: 'requestKey_1',
      field: 'requestKey',
      newSpecs: [
        { name: 'tenantId_1_requestKey_1_unique', keys: { tenantId: 1, requestKey: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
        { name: 'legacy_requestKey_1_unique', keys: { requestKey: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
      ],
      sampleVal: 'REQ_TEST_001'
    },
    {
      col: 'feeschedules',
      oldIndex: 'period_1_classroomId_1',
      field: 'period',
      extraKey: 'classroomId',
      newSpecs: [
        { name: 'tenantId_1_period_1_classroomId_1_unique', keys: { tenantId: 1, period: 1, classroomId: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
        { name: 'legacy_period_1_classroomId_1_unique', keys: { period: 1, classroomId: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
      ],
      sampleVal: '01-2027'
    },
    {
      col: 'payments',
      oldIndex: 'receiptNumber_1',
      field: 'receiptNumber',
      newSpecs: [
        { name: 'tenantId_1_receiptNumber_1_unique', keys: { tenantId: 1, receiptNumber: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' }, receiptNumber: { $type: 'string', $gt: '' } } } },
        { name: 'legacy_receiptNumber_1_unique', keys: { receiptNumber: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null, receiptNumber: { $type: 'string', $gt: '' } } } }
      ],
      sampleVal: 'REC_TEST_001'
    },
    {
      col: 'operatingexpenses',
      oldIndex: 'documentNumber_1',
      field: 'documentNumber',
      newSpecs: [
        { name: 'tenantId_1_documentNumber_1_unique', keys: { tenantId: 1, documentNumber: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
        { name: 'legacy_documentNumber_1_unique', keys: { documentNumber: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
      ],
      sampleVal: 'DOC_TEST_001'
    },
    {
      col: 'departments',
      oldIndex: 'code_1',
      field: 'code',
      newSpecs: [
        { name: 'tenantId_1_code_1_unique', keys: { tenantId: 1, code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
        { name: 'legacy_code_1_unique', keys: { code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
      ],
      sampleVal: 'TEST_DEPT'
    },
    {
      col: 'employees',
      oldIndex: 'employeeCode_1',
      field: 'employeeCode',
      newSpecs: [
        { name: 'tenantId_1_employeeCode_1_unique', keys: { tenantId: 1, employeeCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
        { name: 'legacy_employeeCode_1_unique', keys: { employeeCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
      ],
      sampleVal: 'EMP_TEST_001'
    },
    {
      col: 'classrooms',
      oldIndex: 'schoolYear_1_homeroomTeacherId_1',
      field: 'schoolYear',
      extraKey: 'homeroomTeacherId',
      newSpecs: [
        { name: 'tenantId_1_schoolYear_1_homeroomTeacherId_1_unique', keys: { tenantId: 1, schoolYear: 1, homeroomTeacherId: 1 }, options: { unique: true, partialFilterExpression: { status: 'active', homeroomTeacherId: { $type: 'objectId' }, tenantId: { $type: 'objectId' } } } }
      ],
      sampleVal: '2026-2027'
    },
    {
      col: 'students',
      oldIndex: 'studentCode_1',
      field: 'studentCode',
      newSpecs: [
        { name: 'tenantId_1_studentCode_1_unique', keys: { tenantId: 1, studentCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
        { name: 'legacy_studentCode_1_unique', keys: { studentCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
      ],
      sampleVal: 'HS_TEST_001'
    },
    {
      col: 'suppliers',
      oldIndex: 'code_1',
      field: 'code',
      newSpecs: [
        { name: 'tenantId_1_code_1_unique', keys: { tenantId: 1, code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
        { name: 'legacy_code_1_unique', keys: { code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
      ],
      sampleVal: 'SUP_TEST_001'
    },
    {
      col: 'ingredientmasters',
      oldIndex: 'code_1',
      field: 'code',
      newSpecs: [
        { name: 'tenantId_1_code_1_unique', keys: { tenantId: 1, code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
        { name: 'legacy_code_1_unique', keys: { code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
      ],
      sampleVal: 'ING_TEST_001'
    },
    {
      col: 'kitchenstaffs',
      oldIndex: 'staffCode_1',
      field: 'staffCode',
      newSpecs: [
        { name: 'tenantId_1_staffCode_1_unique', keys: { tenantId: 1, staffCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
        { name: 'legacy_staffCode_1_unique', keys: { staffCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
      ],
      sampleVal: 'KS_TEST_001'
    },
    {
      col: 'foodsamples',
      oldIndex: 'sampleCode_1',
      field: 'sampleCode',
      newSpecs: [
        { name: 'tenantId_1_sampleCode_1_unique', keys: { tenantId: 1, sampleCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
        { name: 'legacy_sampleCode_1_unique', keys: { sampleCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
      ],
      sampleVal: 'FS_TEST_001'
    },
    {
      col: 'kitchenequipments',
      oldIndex: 'code_1',
      field: 'code',
      newSpecs: [
        { name: 'tenantId_1_code_1_unique', keys: { tenantId: 1, code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
        { name: 'legacy_code_1_unique', keys: { code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
      ],
      sampleVal: 'EQ_TEST_001'
    },
    {
      col: 'kitchenrequests',
      oldIndex: 'requestCode_1',
      field: 'requestCode',
      newSpecs: [
        { name: 'tenantId_1_requestCode_1_unique', keys: { tenantId: 1, requestCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
        { name: 'legacy_requestCode_1_unique', keys: { requestCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
      ],
      sampleVal: 'KR_TEST_001'
    },
    {
      col: 'pickuprecords',
      oldIndex: 'pickupCode_1',
      field: 'pickupCode',
      newSpecs: [
        { name: 'tenantId_1_pickupCode_1_unique', keys: { tenantId: 1, pickupCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
        { name: 'legacy_pickupCode_1_unique', keys: { pickupCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
      ],
      sampleVal: 'PU_TEST_001'
    },
    {
      col: 'purchaseorders',
      oldIndex: 'orderCode_1',
      field: 'orderCode',
      newSpecs: [
        { name: 'tenantId_1_orderCode_1_unique', keys: { tenantId: 1, orderCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
        { name: 'legacy_orderCode_1_unique', keys: { orderCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
      ],
      sampleVal: 'PO_TEST_001'
    },
    {
      col: 'kitchendayclosings',
      oldIndex: 'dateKey_1',
      field: 'dateKey',
      newSpecs: [
        { name: 'tenantId_1_dateKey_1_unique', keys: { tenantId: 1, dateKey: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
        { name: 'legacy_dateKey_1_unique', keys: { dateKey: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
      ],
      sampleVal: '2027-01-20'
    },
    {
      col: 'studentcodecounters',
      oldIndex: 'year_1',
      field: 'year',
      newSpecs: [
        { name: 'tenantId_1_year_1_unique', keys: { tenantId: 1, year: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
        { name: 'legacy_year_1_unique', keys: { year: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
      ],
      sampleVal: 2029
    },
    {
      col: 'evaluationperiods',
      oldIndex: 'code_1',
      field: 'code',
      newSpecs: [
        { name: 'tenantId_1_code_1_unique', keys: { tenantId: 1, code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
        { name: 'legacy_code_1_unique', keys: { code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
      ],
      sampleVal: 'EVAL_TEST_001'
    }
  ];`;

// Replace INDEX_GROUPS definition
const oldIdxGroupsSlice = content.substring(content.indexOf(oldIndexGroupsMarker), content.indexOf('  for (const group of INDEX_GROUPS) {'));
content = content.replace(oldIdxGroupsSlice, newIndexGroups + '\n\n');

// Update makeDoc in Step 5
const oldMakeDoc = `    const makeDoc = (tenantId, val, sharedExtraKeyVal) => {
      const doc = { tenantId, [group.field]: val };
      if (group.extraKey) {
        doc[group.extraKey] = sharedExtraKeyVal;
      }
      if (group.col === 'payments') {
        doc.invoiceId = new mongoose.Types.ObjectId();
        doc.idempotencyKey = new mongoose.Types.ObjectId().toString();
      } else if (group.col === 'operatingexpenses') {
        doc.idempotencyKey = new mongoose.Types.ObjectId().toString();
      } else if (group.col === 'classrooms') {
        doc.status = 'active';
      }
      return doc;
    };`;

const newMakeDoc = `    const makeDoc = (tenantId, val, sharedExtraKeyVal) => {
      const doc = { tenantId, [group.field]: val };
      if (group.extraKey) {
        doc[group.extraKey] = sharedExtraKeyVal;
      }
      if (group.col === 'payments') {
        doc.invoiceId = new mongoose.Types.ObjectId();
        doc.idempotencyKey = new mongoose.Types.ObjectId().toString();
      } else if (group.col === 'operatingexpenses') {
        doc.idempotencyKey = new mongoose.Types.ObjectId().toString();
      } else if (group.col === 'classrooms') {
        doc.status = 'active';
      } else if (group.col === 'purchaseorders') {
        doc.requestId = new mongoose.Types.ObjectId();
      } else if (group.col === 'foodsamples') {
        doc.mealDate = new Date();
        doc.mealType = 'lunch';
        doc.dishName = 'Món Test';
      } else if (group.col === 'kitchendayclosings') {
        doc.closingDate = new Date('2027-01-20');
        doc.closedBy = new mongoose.Types.ObjectId();
        doc.closedByName = 'Bếp Test';
      } else if (group.col === 'pickuprecords') {
        doc.studentId = new mongoose.Types.ObjectId();
        doc.pickupDate = '2027-01-20';
      } else if (group.col === 'kitchenrequests') {
        doc.mealDate = new Date();
        doc.mealType = 'lunch';
      } else if (group.col === 'students') {
        doc.fullName = 'Học Sinh Test';
        doc.dateOfBirth = new Date('2022-01-01');
        doc.gender = 'male';
        doc.enrollmentDate = new Date();
      } else if (group.col === 'studentcodecounters') {
        doc.seq = 1;
      }
      return doc;
    };`;

content = content.replace(oldMakeDoc, newMakeDoc);

// 2. Update tenantBRoles in Step 6
const oldTenantBRoles = `  const tenantBRoles = [
    { username: 'admin_b', role: 'admin', fullName: 'Quản Trị Viên Trường B' },
    { username: 'hieutruong_b', role: 'principal', fullName: 'Hiệu Trưởng Trường B' },
    { username: 'ketoan_b', role: 'accountant', fullName: 'Kế Toán Trường B' },
    { username: 'hr_b', role: 'hr', fullName: 'Nhân Sự Trường B' },
    { username: 'giaovien_b', role: 'teacher', fullName: 'Giáo Viên Trường B' },
    { username: 'phuhuynh_b', role: 'parent', fullName: 'Phụ Huynh Trường B' }
  ];`;

const newTenantBRoles = `  const tenantBRoles = [
    { username: 'admin_b', role: 'admin', fullName: 'Quản Trị Viên Trường B' },
    { username: 'hieutruong_b', role: 'principal', fullName: 'Hiệu Trưởng Trường B' },
    { username: 'ketoan_b', role: 'accountant', fullName: 'Kế Toán Trường B' },
    { username: 'hr_b', role: 'hr', fullName: 'Nhân Sự Trường B' },
    { username: 'giaovien_b', role: 'teacher', fullName: 'Giáo Viên Trường B' },
    { username: 'phuhuynh_b', role: 'parent', fullName: 'Phụ Huynh Trường B' },
    { username: 'bep_b', role: 'chef', fullName: 'Bếp Trưởng Trường B' },
    { username: 'baove_b', role: 'guard', fullName: 'Bảo Vệ Trường B' }
  ];`;

content = content.replace(oldTenantBRoles, newTenantBRoles);

console.log('Step 5 and Step 6 updated. Saving...');
fs.writeFileSync('backend/scripts/rehearse_cutover.js', content, 'utf8');
