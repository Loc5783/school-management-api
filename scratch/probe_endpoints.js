'use strict';
const path = require('path');
process.env.NODE_PATH = path.join(__dirname, '../backend/node_modules');
require('module').Module._initPaths();
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const request = require('supertest');
const { startTestDb } = require('../backend/src/saas/testDbBootstrap');
const createSaasApp = require('../backend/src/saas/createSaasApp');
const { generateIsolationFixtures, TEST_PASSWORD } = require('../backend/scripts/fixtures/generate_isolation_fixtures');

async function main() {
  const db = await startTestDb();
  const f = await generateIsolationFixtures();
  const app = createSaasApp({ connection: db.connection, mongoUri: db.uri, saasMode: 'phase1e' });

  const roles = ['admin', 'principal', 'hr', 'accountant', 'teacher', 'chef', 'guard', 'parent'];
  const tokens = {};
  for (const r of roles) {
    const res = await request(app).post('/api/auth/login').send({ schoolCode: 'HOANANG-A', username: `iso_a_${r}`, password: TEST_PASSWORD });
    tokens[r] = res.body.token;
  }

  const testList = [
    { ep: '/api/classrooms', name: 'Lớp học' },
    { ep: '/api/students', name: 'Học sinh' },
    { ep: '/api/hr/departments', name: 'Phòng ban' },
    { ep: '/api/hr/employees', name: 'Nhân viên' },
    { ep: '/api/hr/staffing', name: 'Phân công ca / Staffing' },
    { ep: '/api/hr/payroll', name: 'Bảng lương' },
    { ep: '/api/attendance/leave-requests', name: 'Đơn nghỉ phép' },
    { ep: '/api/nutrition/dishes', name: 'Món ăn' },
    { ep: '/api/nutrition/menus', name: 'Thực đơn' },
    { ep: '/api/nutrition/ingredients', name: 'Nguyên liệu' },
    { ep: '/api/nutrition/food-samples', name: 'Mẫu lưu thức ăn' },
    { ep: '/api/nutrition/inventory', name: 'Kho thực phẩm' },
    { ep: '/api/finance/fee-schedules?period=11-2026', name: 'Biểu phí' },
    { ep: '/api/finance/invoices', name: 'Hóa đơn học phí' },
    { ep: '/api/finance/operating-expenses?month=2026-11', name: 'Chi vận hành' },
    { ep: '/api/finance/expenses', name: 'Chi mua sắm' },
    { ep: '/api/finance/refund-requests', name: 'Hoàn trả học phí' },
    { ep: '/api/procurement/assets', name: 'Tài sản' }
  ];

  for (const item of testList) {
    console.log(`\n--- ${item.name} (${item.ep}) ---`);
    for (const r of roles) {
      const res = await request(app).get(item.ep).set('Authorization', `Bearer ${tokens[r]}`);
      console.log(`  ${r.padEnd(12)}: ${res.status}`);
    }
  }

  await db.stop();
}

main().catch(console.error);
