'use strict';

const path = require('path');
process.env.NODE_PATH = path.join(__dirname, '../node_modules');
require('module').Module._initPaths();
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const request = require('supertest');
const { startTestDb } = require('../src/saas/testDbBootstrap');
const createSaasApp = require('../src/saas/createSaasApp');
const { generateIsolationFixtures, TEST_PASSWORD } = require('./fixtures/generate_isolation_fixtures');

// Detailed results tracking
const matrixStats = {
  totalCells: 0,
  PASS_ISOLATION: 0,
  PASS_RBAC: 0,
  BLOCKED_501: 0,
  NOT_TESTED: 0,
  FAIL: 0,
  LEAK: 0,
  leaks: [],
  failures: [],
  cellResults: []
};

const crossIdStats = {
  total: 0,
  passed: 0,
  failed: 0,
  details: []
};

const safetyStats = {
  total: 0,
  passed: 0,
  failed: 0,
  details: []
};

// 8 roles defined across the SaaS platform
const ROLES = ['admin', 'principal', 'hr', 'accountant', 'teacher', 'chef', 'guard', 'parent'];

// Helper trích xuất đúng mảng kết quả cho từng hợp đồng response của 18 endpoints
function extractResultArray(body, moduleId) {
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body)) return body;
  if (moduleId === 'hr_staffing' && Array.isArray(body.shifts)) return body.shifts;
  if (moduleId === 'hr_payroll' && body.data && Array.isArray(body.data.payrolls)) return body.data.payrolls;
  if (Array.isArray(body.data)) return body.data;
  if (Array.isArray(body.items)) return body.items;
  return [];
}

// 18 key business modules with explicit endpoint, parameters, markers, capabilities, and expected RBAC states
const MODULES = [
  {
    id: 'classrooms',
    name: 'Quản lý Lớp học',
    endpoint: '/api/classrooms',
    supportsSearch: false,
    capability: 'Danh sách lớp học giới hạn theo tenant (List Scoped)',
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
    name: 'Hồ sơ & Danh sách Học sinh',
    endpoint: '/api/students',
    supportsSearch: true,
    capability: 'Tìm kiếm học sinh theo tên/mã (?search=...)',
    searchParam: 'search',
    searchQueryA: 'ISO_A_STUDENT_AN',
    searchQueryB: 'ISO_B_STUDENT_BINH',
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
    supportsSearch: false,
    capability: 'Danh sách tổ/bộ phận giới hạn theo tenant (List Scoped)',
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
    supportsSearch: true,
    capability: 'Tìm kiếm nhân sự theo tên/mã/SĐT (?search=...)',
    searchParam: 'search',
    searchQueryA: 'ISO_A_EMP_NGUYEN_A',
    searchQueryB: 'ISO_B_EMP_TRAN_B',
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
    supportsSearch: false,
    capability: 'Phân công ca làm việc theo tenant & ngày (Date Scoped)',
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
    name: 'Bảng lương Nhân sự',
    endpoint: '/api/hr/payroll?month=11&year=2026',
    supportsSearch: false,
    capability: 'Bảng lương nhân sự theo tenant & kỳ tháng (Period Scoped)',
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
    name: 'Đơn nghỉ phép Học sinh',
    endpoint: '/api/attendance/leave-requests',
    supportsSearch: false,
    capability: 'Đơn nghỉ phép học sinh theo tenant & phạm vi vai trò (List Scoped)',
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
    supportsSearch: true,
    capability: 'Tìm kiếm món ăn dinh dưỡng theo tên (?search=...)',
    searchParam: 'search',
    searchQueryA: 'ISO_A_DISH_CANH_CHUA',
    searchQueryB: 'ISO_B_DISH_THIT_KHO',
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
    supportsSearch: false,
    capability: 'Thực đơn dinh dưỡng theo tenant & tuần/năm (List Scoped)',
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
    supportsSearch: false,
    capability: 'Danh mục nguyên liệu theo tenant & nhóm loại (Category Scoped)',
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
    supportsSearch: false,
    capability: 'Sổ lưu mẫu thức ăn theo tenant & ngày (Date Scoped)',
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
    supportsSearch: false,
    capability: 'Tồn kho nguyên liệu theo tenant & kho thực phẩm (List Scoped)',
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
    supportsSearch: false,
    capability: 'Biểu phí học tập theo tenant & kỳ thu (Period Scoped)',
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
    supportsSearch: true,
    capability: 'Tìm kiếm hóa đơn theo tên học sinh/lớp (?search=...)',
    searchParam: 'search',
    searchQueryA: 'ISO_A_STUDENT_AN',
    searchQueryB: 'ISO_B_STUDENT_BINH',
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
    supportsSearch: false,
    capability: 'Sổ chi vận hành theo tenant & tháng kế toán (Month Scoped)',
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
    supportsSearch: false,
    capability: 'Sổ chi mua sắm CSVC theo tenant & kỳ (Period Scoped)',
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
    supportsSearch: false,
    capability: 'Đơn yêu cầu hoàn trả học phí theo tenant (List Scoped)',
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
    supportsSearch: false,
    capability: 'Danh mục tài sản CSVC theo tenant (List Scoped)',
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

async function main() {
  console.log('================================================================');
  console.log('BẮT ĐẦU KIỂM THỬ MA TRẬN CÁCH LY SAAS HOANANG-A & HOANANG-B');
  console.log('CHẾ ĐỘ NGHIÊM NGẶT: 8 ROLES × 18 MODULES (144 Ô TƯỜNG MINH)');
  console.log('================================================================\n');

  console.log('1. Khởi động MongoMemoryReplSet cô lập...');
  const { connection, uri, stop } = await startTestDb();

  console.log('2. Nạp bộ dữ liệu thử nghiệm fixtures cho 2 trường (HOANANG-A / HOANANG-B)...');
  const fixtureData = await generateIsolationFixtures();
  const m = fixtureData.manifest;

  console.log('3. Khởi tạo SaaS Application (mode: phase1e)...');
  const app = createSaasApp({ connection, mongoUri: uri, saasMode: 'phase1e' });

  // 16 tài khoản (8 vai trò × 2 trường)
  const tokens = { A: {}, B: {} };

  console.log('\n4. Đăng nhập 16 tài khoản qua HTTP /api/auth/login...');
  for (const role of ROLES) {
    const userA = `iso_a_${role}`;
    const resA = await request(app)
      .post('/api/auth/login')
      .send({ schoolCode: 'HOANANG-A', username: userA, password: TEST_PASSWORD });
    if (resA.status !== 200 || !resA.body.token) {
      throw new Error(`Đăng nhập thất bại tài khoản Trường A: ${userA} (status=${resA.status})`);
    }
    tokens.A[role] = resA.body.token;

    const userB = `iso_b_${role}`;
    const resB = await request(app)
      .post('/api/auth/login')
      .send({ schoolCode: 'HOANANG-B', username: userB, password: TEST_PASSWORD });
    if (resB.status !== 200 || !resB.body.token) {
      throw new Error(`Đăng nhập thất bại tài khoản Trường B: ${userB} (status=${resB.status})`);
    }
    tokens.B[role] = resB.body.token;
  }
  console.log('   -> Đăng nhập thành công 16/16 tài khoản.\n');

  console.log('5. Thực thi kiểm thử ma trận 8 roles × 18 modules (144 ô)...');

  for (const mod of MODULES) {
    console.log(`\n--- Phân hệ: [${mod.name}] (${mod.endpoint}) ---`);

    for (const role of ROLES) {
      matrixStats.totalCells++;
      const expectedState = mod.expected[role];

      if (!expectedState) {
        matrixStats.NOT_TESTED++;
        matrixStats.cellResults.push({
          module: mod.id,
          role,
          status: 'NOT_TESTED',
          message: 'Chưa cấu hình trạng thái kỳ vọng'
        });
        console.log(`  [NOT_TESTED] ${role.padEnd(12)}: Chưa có khai báo kỳ vọng`);
        continue;
      }

      const tokA = tokens.A[role];
      const tokB = tokens.B[role];

      const resA = await request(app).get(mod.endpoint).set('Authorization', `Bearer ${tokA}`);
      const resB = await request(app).get(mod.endpoint).set('Authorization', `Bearer ${tokB}`);

      if (expectedState === 'DENIED_BY_RBAC') {
        // DENIED_BY_RBAC: Bắt buộc assert đúng HTTP 403 ở cả A và B độc lập.
        // Ghi nhận riêng "RBAC đạt", KHÔNG quy chụp thành "đã kiểm chứng cách ly dữ liệu".
        const isA403 = resA.status === 403;
        const isB403 = resB.status === 403;

        if (isA403 && isB403) {
          matrixStats.PASS_RBAC++;
          matrixStats.cellResults.push({
            module: mod.id,
            role,
            status: 'PASS_RBAC',
            message: 'RBAC đạt (HTTP 403 Forbidden độc lập ở cả A và B)'
          });
        } else {
          matrixStats.FAIL++;
          const msg = `Lỗi RBAC: Kỳ vọng 403 Forbidden độc lập nhưng nhận A=${resA.status}, B=${resB.status}`;
          matrixStats.failures.push({ module: mod.id, role, message: msg });
          matrixStats.cellResults.push({ module: mod.id, role, status: 'FAIL', message: msg });
          console.error(`  [FAIL_RBAC]   ${role.padEnd(12)}: ${msg}`);
        }
      } else if (expectedState === 'ALLOWED') {
        // ALLOWED: Bắt buộc HTTP 200/201 độc lập ở cả A và B.
        // HTTP 403/404/501/500 không được tính PASS.
        if (resA.status === 501 || resB.status === 501) {
          matrixStats.BLOCKED_501++;
          const msg = `Bị chặn 501 Not Implemented: A=${resA.status}, B=${resB.status}`;
          matrixStats.cellResults.push({ module: mod.id, role, status: 'BLOCKED_501', message: msg });
          console.warn(`  [BLOCKED_501] ${role.padEnd(12)}: ${msg}`);
        } else {
          const statusAOk = resA.status === 200 || resA.status === 201;
          const statusBOk = resB.status === 200 || resB.status === 201;

          if (!statusAOk || !statusBOk) {
            matrixStats.FAIL++;
            const msg = `Lỗi HTTP Contract: Kỳ vọng 200/201 độc lập nhưng nhận A=${resA.status}, B=${resB.status}`;
            matrixStats.failures.push({ module: mod.id, role, message: msg });
            matrixStats.cellResults.push({ module: mod.id, role, status: 'FAIL', message: msg });
            console.error(`  [FAIL_HTTP]   ${role.padEnd(12)}: ${msg}`);
            continue;
          }

          // Trích xuất mảng kết quả thực tế qua helper hợp đồng
          const arrA = extractResultArray(resA.body, mod.id);
          const arrB = extractResultArray(resB.body, mod.id);

          const strArrA = JSON.stringify(arrA);
          const strArrB = JSON.stringify(arrB);

          const hasA_in_A = strArrA.includes(mod.markerA);
          const hasB_in_A = strArrA.includes(mod.markerB);
          const hasB_in_B = strArrB.includes(mod.markerB);
          const hasA_in_B = strArrB.includes(mod.markerA);

          if (hasB_in_A || hasA_in_B) {
            // Không đếm LEAK hai lần nếu LEAK đã tăng FAIL
            matrixStats.LEAK++;
            const msg = `RÒ RỈ DỮ LIỆU: hasB_in_A=${hasB_in_A}, hasA_in_B=${hasA_in_B}`;
            matrixStats.leaks.push({ module: mod.id, role, message: msg });
            matrixStats.cellResults.push({ module: mod.id, role, status: 'LEAK', message: msg });
            console.error(`  [LEAK]        ${role.padEnd(12)}: ${msg}`);
            continue;
          }

          if (!hasA_in_A || !hasB_in_B || arrA.length === 0 || arrB.length === 0) {
            matrixStats.FAIL++;
            const msg = `Thiếu fixture của chính trường: hasA_in_A=${hasA_in_A} (len=${arrA.length}), hasB_in_B=${hasB_in_B} (len=${arrB.length})`;
            matrixStats.failures.push({ module: mod.id, role, message: msg });
            matrixStats.cellResults.push({ module: mod.id, role, status: 'FAIL', message: msg });
            console.error(`  [FAIL_FIXTURE]${role.padEnd(12)}: ${msg}`);
            continue;
          }

          if (mod.supportsSearch) {
            // Endpoint hỗ trợ search: kiểm tra tìm kiếm theo marker
            const sep = mod.endpoint.includes('?') ? '&' : '?';
            const qA = encodeURIComponent(mod.searchQueryA || mod.markerA);
            const qB = encodeURIComponent(mod.searchQueryB || mod.markerB);

            // 1. Kiểm chứng query search thật sự được endpoint áp dụng: tìm marker của chính tenant phải trả đúng fixture
            const sOwnA = await request(app).get(`${mod.endpoint}${sep}search=${qA}`).set('Authorization', `Bearer ${tokA}`);
            const sOwnB = await request(app).get(`${mod.endpoint}${sep}search=${qB}`).set('Authorization', `Bearer ${tokB}`);

            const arrOwnA = extractResultArray(sOwnA.body, mod.id);
            const arrOwnB = extractResultArray(sOwnB.body, mod.id);

            const ownOkA = sOwnA.status === 200 && arrOwnA.length >= 1 && JSON.stringify(arrOwnA).includes(mod.markerA);
            const ownOkB = sOwnB.status === 200 && arrOwnB.length >= 1 && JSON.stringify(arrOwnB).includes(mod.markerB);

            if (!ownOkA || !ownOkB) {
              matrixStats.FAIL++;
              const msg = `Search query không được áp dụng đúng trên fixture trường mình: ownOkA=${ownOkA} (HTTP ${sOwnA.status}, len=${arrOwnA.length}), ownOkB=${ownOkB} (HTTP ${sOwnB.status}, len=${arrOwnB.length})`;
              matrixStats.failures.push({ module: mod.id, role, message: msg });
              matrixStats.cellResults.push({ module: mod.id, role, status: 'FAIL', message: msg });
              console.error(`  [FAIL_SEARCH_OWN] ${role.padEnd(12)}: ${msg}`);
              continue;
            }

            // 2. Search chéo trường: A tìm B và B tìm A
            // Bắt buộc: HTTP 200, đúng cấu trúc, mảng kết quả thực tế có length === 0, không rò rỉ marker đối thủ
            const sCrossA = await request(app).get(`${mod.endpoint}${sep}search=${qB}`).set('Authorization', `Bearer ${tokA}`);
            const sCrossB = await request(app).get(`${mod.endpoint}${sep}search=${qA}`).set('Authorization', `Bearer ${tokB}`);

            const arrCrossA = extractResultArray(sCrossA.body, mod.id);
            const arrCrossB = extractResultArray(sCrossB.body, mod.id);

            const statusCrossAOk = sCrossA.status === 200 && typeof sCrossA.body === 'object' && sCrossA.body !== null;
            const statusCrossBOk = sCrossB.status === 200 && typeof sCrossB.body === 'object' && sCrossB.body !== null;

            if (!statusCrossAOk || !statusCrossBOk) {
              matrixStats.FAIL++;
              const msg = `Search chéo trường lỗi status hoặc cấu trúc: A=${sCrossA.status}, B=${sCrossB.status}`;
              matrixStats.failures.push({ module: mod.id, role, message: msg });
              matrixStats.cellResults.push({ module: mod.id, role, status: 'FAIL', message: msg });
              console.error(`  [FAIL_SEARCH_STATUS] ${role.padEnd(12)}: ${msg}`);
              continue;
            }

            const strCrossA = JSON.stringify(arrCrossA);
            const strCrossB = JSON.stringify(arrCrossB);

            if (strCrossA.includes(mod.markerB) || strCrossB.includes(mod.markerA)) {
              matrixStats.LEAK++;
              const msg = `RÒ RỈ TRONG TÌM KIẾM CHÉO: marker đối thủ xuất hiện trong mảng kết quả search`;
              matrixStats.leaks.push({ module: mod.id, role, message: msg });
              matrixStats.cellResults.push({ module: mod.id, role, status: 'LEAK', message: msg });
              console.error(`  [SEARCH_LEAK] ${role.padEnd(12)}: ${msg}`);
              continue;
            }

            if (arrCrossA.length !== 0 || arrCrossB.length !== 0) {
              matrixStats.FAIL++;
              const msg = `Mảng kết quả tìm kiếm chéo không rỗng (length !== 0): lenA=${arrCrossA.length}, lenB=${arrCrossB.length}`;
              matrixStats.failures.push({ module: mod.id, role, message: msg });
              matrixStats.cellResults.push({ module: mod.id, role, status: 'FAIL', message: msg });
              console.error(`  [FAIL_SEARCH_LEN] ${role.padEnd(12)}: ${msg}`);
              continue;
            }

            matrixStats.PASS_ISOLATION++;
            matrixStats.cellResults.push({
              module: mod.id,
              role,
              status: 'PASS_ISOLATION',
              message: 'Cách ly đạt (A thấy A, B thấy B, search áp dụng đúng, search chéo mảng length === 0, 0 LEAK)'
            });
          } else {
            // Endpoint không hỗ trợ search: kiểm chứng phân vùng dữ liệu qua helper trích xuất mảng
            matrixStats.PASS_ISOLATION++;
            matrixStats.cellResults.push({
              module: mod.id,
              role,
              status: 'PASS_ISOLATION',
              message: `Cách ly đạt [${mod.capability}]: Mảng A chỉ chứa A (len=${arrA.length}), Mảng B chỉ chứa B (len=${arrB.length}), 0 LEAK`
            });
          }
        }
      }
    }
  }

  console.log('\n================================================================');
  console.log('6. KIỂM THỬ TRUY CẬP TRỰC TIẾP ID CHÉO TRƯỜNG (CROSS-TENANT DIRECT ID)');
  console.log('ASSERTION NGHIÊM NGẶT: THEO HỢP ĐỒNG (404/403/409) - CẤM 501 / 200');
  console.log('================================================================\n');

  const crossIdTests = [
    { name: 'GET Classroom B', method: 'get', url: `/api/classrooms/${m.classB._id}`, role: 'admin', expectedStatuses: [404] },
    { name: 'PUT Classroom B', method: 'put', url: `/api/classrooms/${m.classB._id}`, role: 'admin', body: { name: 'Hack Name' }, expectedStatuses: [404] },
    { name: 'DELETE Classroom B', method: 'delete', url: `/api/classrooms/${m.classB._id}`, role: 'admin', expectedStatuses: [404] },
    { name: 'GET Student B', method: 'get', url: `/api/students/${m.studentB._id}`, role: 'admin', expectedStatuses: [404] },
    { name: 'PUT Student B', method: 'put', url: `/api/students/${m.studentB._id}`, role: 'admin', body: { fullName: 'Hack Name' }, expectedStatuses: [404] },
    { name: 'GET Sổ chăm sóc Student B', method: 'get', url: `/api/students/${m.studentB._id}/daily-reports`, role: 'admin', expectedStatuses: [404] },
    { name: 'GET Lịch sử chuyển lớp Student B', method: 'get', url: `/api/students/${m.studentB._id}/transfer-history`, role: 'admin', expectedStatuses: [404] },
    { name: 'GET Employee B', method: 'get', url: `/api/hr/employees/${m.empB._id}`, role: 'hr', expectedStatuses: [404] },
    { name: 'PUT Employee B', method: 'put', url: `/api/hr/employees/${m.empB._id}`, role: 'hr', body: { fullName: 'Hack Name' }, expectedStatuses: [404] },
    { name: 'DELETE Employee B', method: 'delete', url: `/api/hr/employees/${m.empB._id}`, role: 'hr', expectedStatuses: [404, 409] },
    { name: 'GET Dish B', method: 'get', url: `/api/nutrition/dishes/${m.dishB._id}`, role: 'chef', expectedStatuses: [404] },
    { name: 'GET Menu B', method: 'get', url: `/api/nutrition/menus/${m.menuB._id}`, role: 'chef', expectedStatuses: [404] },
    { name: 'GET Điều chỉnh Học phí B', method: 'get', url: `/api/finance/tuition/${m.tuitionFeeB._id}/adjustments`, role: 'accountant', expectedStatuses: [404] },
    { name: 'PUT Asset B', method: 'put', url: `/api/procurement/assets/${m.assetB._id}`, role: 'admin', body: { name: 'Hack Name' }, expectedStatuses: [404] },
    { name: 'DELETE Asset B', method: 'delete', url: `/api/procurement/assets/${m.assetB._id}`, role: 'admin', expectedStatuses: [404] },
    { name: 'PATCH Checkout Khách B', method: 'patch', url: `/api/guard/visitors/${m.visitorB._id}/check-out`, role: 'guard', expectedStatuses: [404] },
    { name: 'PATCH Acknowledge Sự cố B', method: 'patch', url: `/api/guard/incidents/${m.incidentB._id}/acknowledge`, role: 'admin', expectedStatuses: [404] },
    { name: 'PATCH Accept Giao ca B', method: 'patch', url: `/api/guard/handovers/${m.handoverB._id}/accept`, role: 'guard', expectedStatuses: [404] },
    { name: 'PATCH Checkout Giao nhận B', method: 'patch', url: `/api/guard/deliveries/${m.deliveryB._id}/check-out`, role: 'guard', expectedStatuses: [404] }
  ];

  for (const test of crossIdTests) {
    crossIdStats.total++;
    const token = tokens.A[test.role];
    let reqCall = request(app)[test.method](test.url).set('Authorization', `Bearer ${token}`);
    if (test.body) reqCall = reqCall.send(test.body);

    const res = await reqCall;
    const isExpected = test.expectedStatuses.includes(res.status);

    if (isExpected) {
      crossIdStats.passed++;
      crossIdStats.details.push({ test: test.name, status: 'PASS', httpStatus: res.status });
      console.log(`  [CROSS-ID PASS] ${test.name.padEnd(35)} -> HTTP ${res.status} (Chặn đúng hợp đồng)`);
    } else {
      crossIdStats.failed++;
      crossIdStats.details.push({ test: test.name, status: 'FAIL', httpStatus: res.status });
      console.error(`  [CROSS-ID FAIL] ${test.name.padEnd(35)} -> HTTP ${res.status} (Kỳ vọng: ${test.expectedStatuses.join('/')})`);
    }
  }

  console.log('\n================================================================');
  console.log('7. KIỂM THỬ BODY TAMPERING, SHARED CODES VÀ RANH GIỚI VAI TRÒ NỘI BỘ');
  console.log('================================================================\n');

  // 7.1 Body Tampering: Admin A tạo học sinh nhưng gửi kèm tenantId của Trường B
  safetyStats.total++;
  const resTamper = await request(app)
    .post('/api/students')
    .set('Authorization', `Bearer ${tokens.A.admin}`)
    .send({
      fullName: 'ISO_A_STUDENT_TAMPER_TEST',
      birthDate: '2022-01-01',
      gender: 'male',
      classroomId: m.classA._id,
      tenantId: fixtureData.tenants.b._id.toString() // Giả mạo tenantId sang trường B
    });

  if (resTamper.status === 201) {
    const studentDoc = await connection.model('Student').findById(resTamper.body.data._id || resTamper.body.data.id).lean();
    const isOverwritten = studentDoc && studentDoc.tenantId.toString() === fixtureData.tenants.a._id.toString();
    if (isOverwritten) {
      safetyStats.passed++;
      console.log('  [SAFETY PASS] Body Tampering: tenantId bị ghi đè tự động về HOANANG-A từ JWT token');
    } else {
      safetyStats.failed++;
      console.error('  [SAFETY FAIL] Body Tampering: tenantId bị ghi nhận sai!');
    }
  } else {
    safetyStats.passed++;
    console.log(`  [SAFETY PASS] Body Tampering: Từ chối yêu cầu không hợp lệ với HTTP ${resTamper.status}`);
  }

  // 7.2 Shared Business Codes: Kiểm tra compound unique index không xung đột
  safetyStats.total++;
  const sA = await connection.model('Student').findOne({ studentCode: 'HS-2026-000001', tenantId: fixtureData.tenants.a._id }).lean();
  const sB = await connection.model('Student').findOne({ studentCode: 'HS-2026-000001', tenantId: fixtureData.tenants.b._id }).lean();
  if (sA && sB && sA._id.toString() !== sB._id.toString()) {
    safetyStats.passed++;
    console.log(`  [SAFETY PASS] Shared Code: Hai học sinh trùng mã HS-2026-000001 tồn tại độc lập (${sA._id} vs ${sB._id})`);
  } else {
    safetyStats.failed++;
    console.error('  [SAFETY FAIL] Shared Code: Xung đột mã học sinh dùng chung!');
  }

  // 7.3 Phụ huynh A xem con mình vs con trường khác
  safetyStats.total++;
  const resPOwn = await request(app).get(`/api/students/${m.studentA._id}`).set('Authorization', `Bearer ${tokens.A.parent}`);
  const resPOther = await request(app).get(`/api/students/${m.studentB._id}`).set('Authorization', `Bearer ${tokens.A.parent}`);
  if (resPOwn.status === 200 && resPOther.status === 404) {
    safetyStats.passed++;
    console.log('  [SAFETY PASS] Parent Boundary: Phụ huynh A xem được con mình (200), bị chặn con trường B (404)');
  } else {
    safetyStats.failed++;
    console.error(`  [SAFETY FAIL] Parent Boundary: resPOwn=${resPOwn.status}, resPOther=${resPOther.status}`);
  }

  // 7.4 Giáo viên A điểm danh lớp mình vs học sinh trường khác
  safetyStats.total++;
  const resAttOwn = await request(app)
    .post('/api/attendance')
    .set('Authorization', `Bearer ${tokens.A.teacher}`)
    .send({ studentId: m.studentA._id, status: 'present', note: 'Điểm danh giáo viên A' });
  const resAttCross = await request(app)
    .post('/api/attendance')
    .set('Authorization', `Bearer ${tokens.A.teacher}`)
    .send({ studentId: m.studentB._id, status: 'present', note: 'Hack điểm danh trường B' });

  if ([200, 201, 409].includes(resAttOwn.status) && [400, 403, 404].includes(resAttCross.status)) {
    safetyStats.passed++;
    console.log(`  [SAFETY PASS] Teacher Boundary: Giáo viên A điểm danh học sinh mình (${resAttOwn.status}), bị chặn học sinh B (${resAttCross.status})`);
  } else {
    safetyStats.failed++;
    console.error(`  [SAFETY FAIL] Teacher Boundary: resAttOwn=${resAttOwn.status}, resAttCross=${resAttCross.status}`);
  }

  await stop();

  console.log('\n================================================================');
  console.log('TỔNG HỢP KẾT QUẢ KIỂM THỬ MA TRẬN CÁCH LY SAAS HOÀN CHỈNH');
  console.log('================================================================');
  console.log(`1. MA TRẬN 8 ROLES × 18 MODULES (Tổng cộng ${matrixStats.totalCells} ô):`);
  console.log(`   - PASS_ISOLATION (Cách ly đạt):     ${matrixStats.PASS_ISOLATION}`);
  console.log(`   - PASS_RBAC (Phân quyền 403 đạt):    ${matrixStats.PASS_RBAC}`);
  console.log(`   - BLOCKED_501 (Bị chặn 501):         ${matrixStats.BLOCKED_501}`);
  console.log(`   - NOT_TESTED (Chưa kiểm thử):        ${matrixStats.NOT_TESTED}`);
  console.log(`   - FAIL (Thất bại / Sai hợp đồng):    ${matrixStats.FAIL}`);
  console.log(`   - LEAK (Rò rỉ dữ liệu chéo trường):  ${matrixStats.LEAK}`);
  console.log(`2. TRUY CẬP ID TRỰC TIẾP CHÉO TRƯỜNG (${crossIdStats.total} endpoints):`);
  console.log(`   - PASS (Chặn 404/409 đúng hợp đồng): ${crossIdStats.passed}`);
  console.log(`   - FAIL:                              ${crossIdStats.failed}`);
  console.log(`3. CƠ CHẾ AN TOÀN PHỤ TRỢ (${safetyStats.total} kịch bản):`);
  console.log(`   - PASS:                              ${safetyStats.passed}`);
  console.log(`   - FAIL:                              ${safetyStats.failed}`);
  console.log('================================================================');

  // Điều kiện exit code: THẤT BẠI (exit code 1) nếu bất kỳ số nào > 0:
  // BLOCKED_501, NOT_TESTED, FAIL, LEAK, crossIdStats.failed, safetyStats.failed
  const hasFailures =
    matrixStats.BLOCKED_501 > 0 ||
    matrixStats.NOT_TESTED > 0 ||
    matrixStats.FAIL > 0 ||
    matrixStats.LEAK > 0 ||
    crossIdStats.failed > 0 ||
    safetyStats.failed > 0;

  if (hasFailures) {
    console.error(`\n❌ KẾT THÚC VỚI LỖI: BLOCKED_501=${matrixStats.BLOCKED_501}, NOT_TESTED=${matrixStats.NOT_TESTED}, FAIL=${matrixStats.FAIL}, LEAK=${matrixStats.LEAK}, crossIdStats.failed=${crossIdStats.failed}, safetyStats.failed=${safetyStats.failed}`);
    process.exit(1);
  } else {
    console.log('\n✅ XÁC NHẬN: TẤT CẢ CÁC BÀI KIỂM THỬ MA TRẬN ĐẠT CHUẨN AN TOÀN (EXIT CODE 0)!');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Lỗi thực thi kiểm thử ma trận cách ly:', err);
  process.exit(1);
});
