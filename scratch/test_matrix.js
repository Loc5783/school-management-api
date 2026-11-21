'use strict';

const path = require('path');
process.env.NODE_PATH = path.join(__dirname, '../backend/node_modules');
require('module').Module._initPaths();
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const request = require('supertest');
const { startTestDb } = require('../backend/src/saas/testDbBootstrap');
const createSaasApp = require('../backend/src/saas/createSaasApp');
const { generateIsolationFixtures, TEST_PASSWORD } = require('../backend/scripts/fixtures/generate_isolation_fixtures');

async function test() {
  const db = await startTestDb();
  const f = await generateIsolationFixtures();
  const app = createSaasApp({ connection: db.connection, mongoUri: db.uri, saasMode: 'phase1e' });

  const roles = ['admin', 'principal', 'hr', 'accountant', 'teacher', 'chef', 'guard', 'parent'];
  const tokens = { A: {}, B: {} };
  for (const r of roles) {
    const resA = await request(app).post('/api/auth/login').send({ schoolCode: 'HOANANG-A', username: `iso_a_${r}`, password: TEST_PASSWORD });
    tokens.A[r] = resA.body.token;
    const resB = await request(app).post('/api/auth/login').send({ schoolCode: 'HOANANG-B', username: `iso_b_${r}`, password: TEST_PASSWORD });
    tokens.B[r] = resB.body.token;
  }

  const modules = [
    {
      id: 'classrooms',
      name: 'Quản lý Lớp học',
      endpoint: '/api/classrooms',
      searchParam: 'search',
      markerA: 'ISO_A_CLASS_MAM_1',
      markerB: 'ISO_B_CLASS_MAM_1',
      expected: {
        admin: 'ALLOWED',
        principal: 'ALLOWED',
        hr: 'ALLOWED',
        accountant: 'DENIED_BY_RBAC',
        teacher: 'ALLOWED',
        chef: 'DENIED_BY_RBAC',
        guard: 'DENIED_BY_RBAC',
        parent: 'DENIED_BY_RBAC'
      }
    },
    {
      id: 'students',
      name: 'Hồ sơ Học sinh',
      endpoint: '/api/students',
      searchParam: 'search',
      markerA: 'ISO_A_STUDENT_AN',
      markerB: 'ISO_B_STUDENT_BINH',
      expected: {
        admin: 'ALLOWED',
        principal: 'ALLOWED',
        hr: 'ALLOWED',
        accountant: 'DENIED_BY_RBAC',
        teacher: 'ALLOWED',
        chef: 'DENIED_BY_RBAC',
        guard: 'DENIED_BY_RBAC',
        parent: 'ALLOWED'
      }
    },
    {
      id: 'hr_departments',
      name: 'Phòng ban Nhân sự',
      endpoint: '/api/hr/departments',
      searchParam: 'search',
      markerA: 'ISO_A_DEP_SU_PHAM',
      markerB: 'ISO_B_DEP_SU_PHAM',
      expected: {
        admin: 'ALLOWED',
        principal: 'ALLOWED',
        hr: 'ALLOWED',
        accountant: 'ALLOWED',
        teacher: 'DENIED_BY_RBAC',
        chef: 'DENIED_BY_RBAC',
        guard: 'DENIED_BY_RBAC',
        parent: 'DENIED_BY_RBAC'
      }
    },
    {
      id: 'hr_employees',
      name: 'Danh sách Nhân viên',
      endpoint: '/api/hr/employees',
      searchParam: 'search',
      markerA: 'ISO_A_EMP_NGUYEN_A',
      markerB: 'ISO_B_EMP_TRAN_B',
      expected: {
        admin: 'ALLOWED',
        principal: 'ALLOWED',
        hr: 'ALLOWED',
        accountant: 'ALLOWED',
        teacher: 'DENIED_BY_RBAC',
        chef: 'DENIED_BY_RBAC',
        guard: 'DENIED_BY_RBAC',
        parent: 'DENIED_BY_RBAC'
      }
    },
    {
      id: 'hr_staffing',
      name: 'Phân công ca / Staffing',
      endpoint: '/api/hr/staffing',
      searchParam: 'search',
      markerA: 'ISO_A_SHIFT_SANG',
      markerB: 'ISO_B_SHIFT_CHIEU',
      expected: {
        admin: 'ALLOWED',
        principal: 'ALLOWED',
        hr: 'ALLOWED',
        accountant: 'DENIED_BY_RBAC',
        teacher: 'DENIED_BY_RBAC',
        chef: 'DENIED_BY_RBAC',
        guard: 'DENIED_BY_RBAC',
        parent: 'DENIED_BY_RBAC'
      }
    },
    {
      id: 'hr_payroll',
      name: 'Bảng lương nhân sự',
      endpoint: '/api/hr/payroll?month=11&year=2026',
      searchParam: 'search',
      markerA: 'ISO_A_PAYROLL_NOTE',
      markerB: 'ISO_B_PAYROLL_NOTE',
      expected: {
        admin: 'ALLOWED',
        principal: 'ALLOWED',
        hr: 'ALLOWED',
        accountant: 'ALLOWED',
        teacher: 'DENIED_BY_RBAC',
        chef: 'DENIED_BY_RBAC',
        guard: 'DENIED_BY_RBAC',
        parent: 'DENIED_BY_RBAC'
      }
    },
    {
      id: 'leave_requests',
      name: 'Đơn nghỉ phép học sinh',
      endpoint: '/api/attendance/leave-requests',
      searchParam: 'search',
      markerA: 'ISO_A_LEAVE_REQ',
      markerB: 'ISO_B_LEAVE_REQ',
      expected: {
        admin: 'ALLOWED',
        principal: 'ALLOWED',
        hr: 'DENIED_BY_RBAC',
        accountant: 'DENIED_BY_RBAC',
        teacher: 'ALLOWED',
        chef: 'DENIED_BY_RBAC',
        guard: 'DENIED_BY_RBAC',
        parent: 'ALLOWED'
      }
    },
    {
      id: 'dishes',
      name: 'Danh mục Món ăn',
      endpoint: '/api/nutrition/dishes',
      searchParam: 'search',
      markerA: 'ISO_A_DISH_CANH_CHUA',
      markerB: 'ISO_B_DISH_THIT_KHO',
      expected: {
        admin: 'ALLOWED',
        principal: 'ALLOWED',
        hr: 'DENIED_BY_RBAC',
        accountant: 'DENIED_BY_RBAC',
        teacher: 'ALLOWED',
        chef: 'ALLOWED',
        guard: 'DENIED_BY_RBAC',
        parent: 'DENIED_BY_RBAC'
      }
    },
    {
      id: 'menus',
      name: 'Thực đơn Dinh dưỡng',
      endpoint: '/api/nutrition/menus',
      searchParam: 'search',
      markerA: 'ISO_A_CLASS_MAM_1',
      markerB: 'ISO_B_CLASS_MAM_1',
      expected: {
        admin: 'ALLOWED',
        principal: 'ALLOWED',
        hr: 'DENIED_BY_RBAC',
        accountant: 'DENIED_BY_RBAC',
        teacher: 'ALLOWED',
        chef: 'ALLOWED',
        guard: 'DENIED_BY_RBAC',
        parent: 'ALLOWED'
      }
    },
    {
      id: 'ingredients',
      name: 'Nguyên liệu Thực phẩm',
      endpoint: '/api/nutrition/ingredients',
      searchParam: 'search',
      markerA: 'ISO_A_ING_CA_CHUA',
      markerB: 'ISO_B_ING_THIT_HEO',
      expected: {
        admin: 'ALLOWED',
        principal: 'ALLOWED',
        hr: 'DENIED_BY_RBAC',
        accountant: 'ALLOWED',
        teacher: 'DENIED_BY_RBAC',
        chef: 'ALLOWED',
        guard: 'DENIED_BY_RBAC',
        parent: 'DENIED_BY_RBAC'
      }
    },
    {
      id: 'food_samples',
      name: 'Mẫu lưu Thức ăn',
      endpoint: '/api/nutrition/food-samples',
      searchParam: 'search',
      markerA: 'ISO_A_SAMPLE_CANH',
      markerB: 'ISO_B_SAMPLE_THIT',
      expected: {
        admin: 'ALLOWED',
        principal: 'ALLOWED',
        hr: 'DENIED_BY_RBAC',
        accountant: 'DENIED_BY_RBAC',
        teacher: 'DENIED_BY_RBAC',
        chef: 'ALLOWED',
        guard: 'DENIED_BY_RBAC',
        parent: 'DENIED_BY_RBAC'
      }
    },
    {
      id: 'inventory',
      name: 'Kho Dinh dưỡng',
      endpoint: '/api/nutrition/inventory',
      searchParam: 'search',
      markerA: 'BATCH-A1',
      markerB: 'BATCH-B1',
      expected: {
        admin: 'ALLOWED',
        principal: 'ALLOWED',
        hr: 'DENIED_BY_RBAC',
        accountant: 'ALLOWED',
        teacher: 'DENIED_BY_RBAC',
        chef: 'ALLOWED',
        guard: 'DENIED_BY_RBAC',
        parent: 'DENIED_BY_RBAC'
      }
    },
    {
      id: 'fee_schedules',
      name: 'Biểu phí Học tập',
      endpoint: '/api/finance/fee-schedules?period=11-2026',
      searchParam: 'search',
      markerA: 'ISO_A_FEE_SCHEDULE',
      markerB: 'ISO_B_FEE_SCHEDULE',
      expected: {
        admin: 'ALLOWED',
        principal: 'ALLOWED',
        hr: 'DENIED_BY_RBAC',
        accountant: 'ALLOWED',
        teacher: 'DENIED_BY_RBAC',
        chef: 'DENIED_BY_RBAC',
        guard: 'DENIED_BY_RBAC',
        parent: 'DENIED_BY_RBAC'
      }
    },
    {
      id: 'invoices',
      name: 'Hóa đơn Học phí',
      endpoint: '/api/finance/invoices',
      searchParam: 'search',
      markerA: 'ISO_A_TUITION_INV',
      markerB: 'ISO_B_TUITION_INV',
      expected: {
        admin: 'ALLOWED',
        principal: 'ALLOWED',
        hr: 'DENIED_BY_RBAC',
        accountant: 'ALLOWED',
        teacher: 'DENIED_BY_RBAC',
        chef: 'DENIED_BY_RBAC',
        guard: 'DENIED_BY_RBAC',
        parent: 'DENIED_BY_RBAC'
      }
    },
    {
      id: 'operating_expenses',
      name: 'Chi vận hành',
      endpoint: '/api/finance/operating-expenses?month=2026-11',
      searchParam: 'search',
      markerA: 'ISO_A_OP_EXPENSE',
      markerB: 'ISO_B_OP_EXPENSE',
      expected: {
        admin: 'ALLOWED',
        principal: 'ALLOWED',
        hr: 'DENIED_BY_RBAC',
        accountant: 'ALLOWED',
        teacher: 'DENIED_BY_RBAC',
        chef: 'DENIED_BY_RBAC',
        guard: 'DENIED_BY_RBAC',
        parent: 'DENIED_BY_RBAC'
      }
    },
    {
      id: 'purchase_expenses',
      name: 'Chi mua sắm cơ sở',
      endpoint: '/api/finance/expenses?period=11-2026',
      searchParam: 'search',
      markerA: 'ISO_A_PURCHASE_EXPENSE',
      markerB: 'ISO_B_PURCHASE_EXPENSE',
      expected: {
        admin: 'ALLOWED',
        principal: 'ALLOWED',
        hr: 'DENIED_BY_RBAC',
        accountant: 'ALLOWED',
        teacher: 'DENIED_BY_RBAC',
        chef: 'DENIED_BY_RBAC',
        guard: 'DENIED_BY_RBAC',
        parent: 'DENIED_BY_RBAC'
      }
    },
    {
      id: 'refund_requests',
      name: 'Hoàn trả học phí',
      endpoint: '/api/finance/refund-requests',
      searchParam: 'search',
      markerA: 'ISO_A_REFUND_REQ',
      markerB: 'ISO_B_REFUND_REQ',
      expected: {
        admin: 'ALLOWED',
        principal: 'ALLOWED',
        hr: 'DENIED_BY_RBAC',
        accountant: 'ALLOWED',
        teacher: 'DENIED_BY_RBAC',
        chef: 'DENIED_BY_RBAC',
        guard: 'DENIED_BY_RBAC',
        parent: 'DENIED_BY_RBAC'
      }
    },
    {
      id: 'assets',
      name: 'Tài sản cơ sở vật chất',
      endpoint: '/api/procurement/assets',
      searchParam: 'search',
      markerA: 'ISO_A_ASSET_TIVI_55',
      markerB: 'ISO_B_ASSET_DIEU_HOA',
      expected: {
        admin: 'ALLOWED',
        principal: 'ALLOWED',
        hr: 'DENIED_BY_RBAC',
        accountant: 'DENIED_BY_RBAC',
        teacher: 'DENIED_BY_RBAC',
        chef: 'DENIED_BY_RBAC',
        guard: 'DENIED_BY_RBAC',
        parent: 'DENIED_BY_RBAC'
      }
    }
  ];

  let passIsolation = 0;
  let passRbac = 0;
  let blocked501 = 0;
  let failCount = 0;
  let leakCount = 0;

  for (const mod of modules) {
    console.log(`\n=== Testing module: ${mod.name} (${mod.endpoint}) ===`);
    for (const role of roles) {
      const exp = mod.expected[role];
      const tokA = tokens.A[role];
      const tokB = tokens.B[role];

      const resA = await request(app).get(mod.endpoint).set('Authorization', `Bearer ${tokA}`);
      const resB = await request(app).get(mod.endpoint).set('Authorization', `Bearer ${tokB}`);

      if (exp === 'DENIED_BY_RBAC') {
        if (resA.status === 403 && resB.status === 403) {
          passRbac++;
          // console.log(`  [RBAC PASS] ${role}: 403 on both A and B`);
        } else {
          failCount++;
          console.error(`  [RBAC FAIL] ${role}: Expected 403, got A=${resA.status}, B=${resB.status}`);
        }
      } else if (exp === 'ALLOWED') {
        if (resA.status === 501 || resB.status === 501) {
          blocked501++;
          console.warn(`  [501 BLOCKED] ${role}: Endpoint returned 501`);
        } else if (resA.status !== 200 && resA.status !== 201) {
          failCount++;
          console.error(`  [FAIL] ${role}: Expected 200/201, got A=${resA.status}, B=${resB.status}`);
        } else {
          const textA = JSON.stringify(resA.body);
          const textB = JSON.stringify(resB.body);
          const hasA_in_A = textA.includes(mod.markerA);
          const hasB_in_A = textA.includes(mod.markerB);
          const hasB_in_B = textB.includes(mod.markerB);
          const hasA_in_B = textB.includes(mod.markerA);

          if (hasB_in_A || hasA_in_B) {
            leakCount++;
            failCount++;
            console.error(`  [LEAK] ${role}: Data leak detected! hasB_in_A=${hasB_in_A}, hasA_in_B=${hasA_in_B}`);
          } else if (!hasA_in_A || !hasB_in_B) {
            failCount++;
            console.error(`  [FAIL] ${role}: Missing own fixture! hasA_in_A=${hasA_in_A}, hasB_in_B=${hasB_in_B}`);
          } else {
            // Search test 2 directions
            const sep = mod.endpoint.includes('?') ? '&' : '?';
            const sResA = await request(app).get(`${mod.endpoint}${sep}search=${encodeURIComponent(mod.markerB)}`).set('Authorization', `Bearer ${tokA}`);
            const sResB = await request(app).get(`${mod.endpoint}${sep}search=${encodeURIComponent(mod.markerA)}`).set('Authorization', `Bearer ${tokB}`);

            const sTextA = JSON.stringify(sResA.body);
            const sTextB = JSON.stringify(sResB.body);

            if (sTextA.includes(mod.markerB) || sTextB.includes(mod.markerA)) {
              leakCount++;
              failCount++;
              console.error(`  [SEARCH LEAK] ${role}: Search returned other tenant's data!`);
            } else {
              passIsolation++;
              // console.log(`  [ISO PASS] ${role}: A sees A, not B; B sees B, not A; Cross search safe`);
            }
          }
        }
      }
    }
  }

  console.log('\n=======================================');
  console.log(`PASS_ISOLATION: ${passIsolation}`);
  console.log(`PASS_RBAC:      ${passRbac}`);
  console.log(`BLOCKED_501:    ${blocked501}`);
  console.log(`FAIL:           ${failCount}`);
  console.log(`LEAK:           ${leakCount}`);
  console.log('=======================================');

  await db.stop();
}

test().catch(console.error);
