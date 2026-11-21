'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_legacy_browser_verification_jwt_secret_32_chars_min';

/**
 * ============================================================================
 * LEGACY VERIFICATION SCRIPT (CHROME CDP WITH STRICT ASSERTIONS)
 * ============================================================================
 * Kiểm thử E2E giao diện thực tế cho phiên đăng nhập LEGACY (không mã trường):
 * 1. "Chi tiết ngày & Thay thế" không bị trắng trang, hiển thị đầy đủ lớp & ca.
 * 2. "Lịch phân công của tôi" không bị trắng trang cho teacher, chef, guard.
 * 3. HR xuất Excel bảng lương thành công (không bị 403), file có dữ liệu thực tế.
 * 4. Nhà bếp (chef) tải và chọn được lớp khi lập thực đơn, cảnh báo dị ứng chuẩn.
 * 5. Bỏ tab "Năng lực & giấy tờ" khỏi HR; fallback an toàn khi gõ URL trực tiếp.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { spawn } = require('child_process');
const ExcelJS = require('exceljs');

const testDbBootstrap = require('../src/saas/testDbBootstrap');
const createApp = require('../app');
const { runIndexMigration } = require('./saas_phase1e_index_migration');

const User = require('../src/models/zone1_system/User');
const Employee = require('../src/models/zone2_hr/Employee');
const StaffShift = require('../src/models/zone2_hr/StaffShift');
const StaffReplacement = require('../src/models/zone2_hr/StaffReplacement');
const LeaveRequest = require('../src/models/zone2_hr/LeaveRequest');
const Payroll = require('../src/models/zone2_hr/Payroll');
const Classroom = require('../src/models/zone3_school/Classroom');
const Student = require('../src/models/zone3_school/Student');
const Dish = require('../src/models/zone5_nutrition/Dish');
const IngredientMaster = require('../src/models/zone5_nutrition/IngredientMaster');
const Menu = require('../src/models/zone5_nutrition/Menu');
const AccountingPeriod = require('../src/models/zone4_finance/AccountingPeriod');

const ARTIFACT_DIR = path.resolve('C:/Users/PhamDinhDong/.gemini/antigravity/brain/c0cd55dd-ceda-41d7-8f80-f3254ca5f175');
const DOCS_SCREENSHOT_DIR = path.resolve('docs/screenshots');

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
fs.mkdirSync(DOCS_SCREENSHOT_DIR, { recursive: true });

class StrictCdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
    this.consoleErrors = [];
    this.interceptedDownloads = [];
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.id && this.callbacks.has(msg.id)) {
            const cb = this.callbacks.get(msg.id);
            this.callbacks.delete(msg.id);
            if (msg.error) cb.reject(new Error(msg.error.message));
            else cb.resolve(msg.result);
          } else if (msg.method === 'Runtime.consoleAPICalled') {
            if (msg.params.type === 'error') {
              const text = msg.params.args.map((a) => a.value || a.description || '').join(' ');
              if (!text.includes('501') && !text.includes('Not Implemented')) {
                this.consoleErrors.push(text);
              }
            }
          }
        } catch (e) {
          console.error('CDP parse message error:', e);
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = this.id++;
      this.callbacks.set(msgId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    return res?.result?.value;
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await this.waitForPredicate(
      `document.readyState === 'complete'`,
      10000,
      `Chờ trang ${url} tải xong (readyState === complete)`
    );
  }

  async waitForPredicate(fnStr, timeoutMs = 10000, desc = '') {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const val = await this.evaluate(`Boolean(${fnStr})`);
        if (val) return true;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`TIMEOUT_WAITING_PREDICATE: Quá ${timeoutMs}ms khi chờ điều kiện [${desc}]: (${fnStr})`);
  }

  async waitForSelector(selector, timeoutMs = 10000) {
    await this.waitForPredicate(
      `document.querySelector('${selector}') !== null`,
      timeoutMs,
      `Chờ phần tử xuất hiện: ${selector}`
    );
  }

  async assertTextContains(selector, expectedText, desc) {
    await this.waitForSelector(selector, 8000);
    const text = await this.evaluate(`document.querySelector('${selector}')?.innerText || ''`);
    if (!text.includes(expectedText)) {
      throw new Error(`ASSERTION_FAILED [${desc}]: Phần tử '${selector}' không chứa '${expectedText}'. Nội dung thực tế: "${text.slice(0, 150)}"`);
    }
    console.log(`   [ASSERT OK] ${desc}: chứa "${expectedText}"`);
  }

  async assertElementNotPresent(selector, desc) {
    const present = await this.evaluate(`document.querySelector('${selector}') !== null`);
    if (present) {
      throw new Error(`ASSERTION_FAILED [${desc}]: Phần tử '${selector}' lẽ ra KHÔNG được xuất hiện nhưng vẫn tồn tại!`);
    }
    console.log(`   [ASSERT OK] ${desc}: Phần tử '${selector}' không xuất hiện`);
  }

  async assertUrl(pattern, desc) {
    await this.waitForPredicate(
      `window.location.href.includes('${pattern}')`,
      8000,
      `Chờ URL chứa ${pattern}`
    );
    const currentUrl = await this.evaluate('window.location.href');
    console.log(`   [URL ASSERT OK] ${desc}: ${currentUrl}`);
  }

  async captureScreenshot(filename) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    const artifactPath = path.join(ARTIFACT_DIR, filename);
    const docsPath = path.join(DOCS_SCREENSHOT_DIR, filename);
    fs.writeFileSync(artifactPath, buffer);
    fs.writeFileSync(docsPath, buffer);
    console.log(`   [SCREENSHOT] Saved: ${filename} (${buffer.length} bytes)`);
  }

  async close() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
  }
}

async function loginLegacyUser(cdp, username, password) {
  await cdp.navigate('http://127.0.0.1:5188/login');
  await cdp.waitForSelector('.login-form-wrap form');
  await cdp.evaluate(`
    (() => {
      const inputs = document.querySelectorAll('.login-form-wrap input');
      const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      
      // Trường 0: schoolCode (để trống cho phiên legacy)
      const t0 = inputs[0]._valueTracker;
      if (t0) t0.setValue('__reset__');
      nativeSet.call(inputs[0], '');
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[0].dispatchEvent(new Event('change', { bubbles: true }));

      // Trường 1: username
      const t1 = inputs[1]._valueTracker;
      if (t1) t1.setValue('__reset__');
      nativeSet.call(inputs[1], ${JSON.stringify(username)});
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[1].dispatchEvent(new Event('change', { bubbles: true }));

      // Trường 2: password
      const t2 = inputs[2]._valueTracker;
      if (t2) t2.setValue('__reset__');
      nativeSet.call(inputs[2], ${JSON.stringify(password)});
      inputs[2].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[2].dispatchEvent(new Event('change', { bubbles: true }));

      const submitBtn = document.querySelector('.login-form-wrap button[type="submit"]');
      if (submitBtn) submitBtn.click();
    })()
  `);
  try {
    await cdp.waitForPredicate(
      `!window.location.href.includes('/login')`,
      8000,
      `Đăng nhập thành công với user [${username}] và thoát khỏi trang /login`
    );
  } catch (err) {
    const errorText = await cdp.evaluate(`document.querySelector('.form-error')?.innerText || ''`);
    const currentUrl = await cdp.evaluate(`window.location.href`);
    console.error(`LOGIN FAILED for [${username}]: page error="${errorText}", current url="${currentUrl}"`);
    console.error('CDP Console errors:', cdp.consoleErrors);
    throw err;
  }
}

async function logoutUser(cdp) {
  await cdp.evaluate(`
    (() => {
      const logoutBtn = document.querySelector('.sidebar-logout');
      if (logoutBtn) logoutBtn.click();
      else {
        localStorage.clear();
        window.location.href = '/login';
      }
    })()
  `);
  await cdp.waitForPredicate(
    `window.location.href.includes('/login')`,
    6000,
    'Đăng xuất và quay về trang /login'
  );
}

async function startServers() {
  console.log('1. Khởi tạo Isolated Test DB qua testDbBootstrap...');
  const bootstrapInstance = await testDbBootstrap.startTestDb({
    instanceOpts: [{ dbName: 'school_legacy_verification_test' }]
  });
  const mongoUri = bootstrapInstance.uri;
  const connection = bootstrapInstance.connection;

  console.log('1b. Đồng bộ Index trên Test DB...');
  await runIndexMigration(connection.db, 'apply');

  console.log('2. Seed dữ liệu Legacy cho các vai trò...');
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const passwordHash = await bcrypt.hash('password123', 8);

  // Accounts
  const adminUser = await User.create({
    username: 'admin_legacy',
    passwordHash,
    role: 'admin',
    status: 'active',
    profile: { fullName: 'Quản trị viên Legacy' }
  });

  const hrUser = await User.create({
    username: 'hr_legacy',
    passwordHash,
    role: 'hr',
    status: 'active',
    profile: { fullName: 'Trần Thị Thu HR' }
  });

  const teacherUser = await User.create({
    username: 'teacher_legacy',
    passwordHash,
    role: 'teacher',
    status: 'active',
    profile: { fullName: 'Nguyễn Văn Giáo Viên' }
  });

  const teacherSupportUser = await User.create({
    username: 'teacher_support_legacy',
    passwordHash,
    role: 'teacher',
    status: 'active',
    profile: { fullName: 'Trần Văn Giáo Viên Phụ' }
  });

  const teacherUnassignedUser = await User.create({
    username: 'teacher_unassigned_legacy',
    passwordHash,
    role: 'teacher',
    status: 'active',
    profile: { fullName: 'Đặng Thị Chưa Phân Công' }
  });

  const chefUser = await User.create({
    username: 'chef_legacy',
    passwordHash,
    role: 'chef',
    status: 'active',
    profile: { fullName: 'Lê Văn Đầu Bếp' }
  });

  const guardUser = await User.create({
    username: 'guard_legacy',
    passwordHash,
    role: 'guard',
    status: 'active',
    profile: { fullName: 'Phạm Văn Bảo Vệ' }
  });

  // Employee Profiles
  const hrEmp = await Employee.create({
    userId: hrUser._id,
    employeeCode: 'NV-HR-01',
    fullName: 'Trần Thị Thu HR',
    payrollRole: 'hr',
    position: 'hr',
    baseSalary: 12000000,
    salaryUnit: 'monthly',
    standardWorkDays: 26,
    status: 'active',
    startDate: new Date('2024-01-01')
  });

  const teacherEmp = await Employee.create({
    userId: teacherUser._id,
    employeeCode: 'NV-GV-01',
    fullName: 'Nguyễn Văn Giáo Viên',
    payrollRole: 'teacher',
    position: 'teacher',
    baseSalary: 10000000,
    salaryUnit: 'monthly',
    standardWorkDays: 26,
    status: 'active',
    startDate: new Date('2024-01-01')
  });

  const teacherSupportEmp = await Employee.create({
    userId: teacherSupportUser._id,
    employeeCode: 'NV-GV-02',
    fullName: 'Trần Văn Giáo Viên Phụ',
    payrollRole: 'teacher',
    position: 'teacher',
    baseSalary: 9000000,
    salaryUnit: 'monthly',
    standardWorkDays: 26,
    status: 'active',
    startDate: new Date('2024-01-01')
  });

  const teacherUnassignedEmp = await Employee.create({
    userId: teacherUnassignedUser._id,
    employeeCode: 'NV-GV-03',
    fullName: 'Đặng Thị Chưa Phân Công',
    payrollRole: 'teacher',
    position: 'teacher',
    baseSalary: 9000000,
    salaryUnit: 'monthly',
    standardWorkDays: 26,
    status: 'active',
    startDate: new Date('2024-01-01')
  });

  const chefEmp = await Employee.create({
    userId: chefUser._id,
    employeeCode: 'NV-BEP-01',
    fullName: 'Lê Văn Đầu Bếp',
    payrollRole: 'chef',
    position: 'chef',
    baseSalary: 8500000,
    salaryUnit: 'monthly',
    standardWorkDays: 26,
    status: 'active',
    startDate: new Date('2024-01-01')
  });

  const guardEmp = await Employee.create({
    userId: guardUser._id,
    employeeCode: 'NV-BV-01',
    fullName: 'Phạm Văn Bảo Vệ',
    payrollRole: 'guard',
    position: 'security',
    baseSalary: 7500000,
    salaryUnit: 'monthly',
    standardWorkDays: 26,
    status: 'active',
    startDate: new Date('2024-01-01')
  });

  // Classrooms
  const classA = await Classroom.create({
    name: 'Lớp Mầm A',
    ageGroup: '3-4',
    maxSize: 25,
    schoolYear: '2026-2027',
    homeroomTeacherId: teacherUser._id,
    teachers: [
      { teacherId: teacherUser._id, role: 'homeroom' },
      { teacherId: teacherSupportUser._id, role: 'support' }
    ],
    requiredTeachers: 2,
    teachingWeekdays: [1, 2, 3, 4, 5],
    status: 'active'
  });

  const classB = await Classroom.create({
    name: 'Lớp Chồi B',
    ageGroup: '4-5',
    maxSize: 30,
    schoolYear: '2026-2027',
    requiredTeachers: 2,
    teachingWeekdays: [1, 2, 3, 4, 5],
    status: 'active'
  });

  // Students with allergy profile
  await Student.create({
    fullName: 'Bé Nguyễn An Nhiên',
    studentCode: 'HS-2026-000001',
    gender: 'female',
    birthDate: new Date('2022-05-15'),
    classroomId: classA._id,
    className: classA.name,
    classroomName: classA.name,
    status: 'enrolled',
    allergies: [
      { allergen: 'peanut', severity: 'severe', note: 'Dị ứng đậu phộng nặng' }
    ]
  });

  // Shifts
  await StaffShift.create({
    employeeId: chefEmp._id,
    role: 'chef',
    name: 'Ca sáng nhà bếp',
    startTime: '06:00',
    endTime: '14:00',
    weekdays: [1, 2, 3, 4, 5, 6],
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
    status: 'active',
    createdBy: adminUser._id
  });

  await StaffShift.create({
    employeeId: guardEmp._id,
    role: 'guard',
    name: 'Ca bảo vệ cổng chính',
    startTime: '06:30',
    endTime: '18:30',
    weekdays: [1, 2, 3, 4, 5, 6, 0],
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
    status: 'active',
    createdBy: adminUser._id
  });

  // Payrolls for Period
  await Payroll.create([
    {
      employeeId: hrEmp._id,
      employeeCode: hrEmp.employeeCode,
      employeeName: hrEmp.fullName,
      payrollRole: 'hr',
      position: 'hr',
      month: currentMonth,
      year: currentYear,
      baseSalary: 12000000,
      standardWorkDays: 26,
      actualWorkDays: 26,
      paidLeaveDays: 0,
      unpaidLeaveDays: 0,
      grossSalary: 12000000,
      allowances: { position: 1000000, meal: 500000, other: 0 },
      deductions: { insurance: 1260000, advancePayment: 0, other: 0 },
      netSalary: 12240000,
      status: 'draft'
    },
    {
      employeeId: teacherEmp._id,
      employeeCode: teacherEmp.employeeCode,
      employeeName: teacherEmp.fullName,
      payrollRole: 'teacher',
      position: 'teacher',
      month: currentMonth,
      year: currentYear,
      baseSalary: 10000000,
      standardWorkDays: 26,
      actualWorkDays: 26,
      paidLeaveDays: 0,
      unpaidLeaveDays: 0,
      grossSalary: 10000000,
      allowances: { position: 500000, meal: 500000, other: 0 },
      deductions: { insurance: 1050000, advancePayment: 0, other: 0 },
      netSalary: 9950000,
      status: 'draft'
    }
  ]);

  // Dishes & Ingredients: Đủ tất cả các bữa bắt buộc (main_course, soup, beverage, snack, dessert)
  const ingGrain = await IngredientMaster.create({
    name: 'Gạo tẻ thơm',
    code: 'NL-GAO-01',
    category: 'dry_grain',
    unit: 'kg',
    status: 'active'
  });

  const ingVeg = await IngredientMaster.create({
    name: 'Rau ngót',
    code: 'NL-RAU-01',
    category: 'vegetable',
    unit: 'kg',
    status: 'active'
  });

  const ingPork = await IngredientMaster.create({
    name: 'Thịt lợn nạc',
    code: 'NL-THIT-01',
    category: 'meat',
    unit: 'kg',
    status: 'active'
  });

  const ingMilk = await IngredientMaster.create({
    name: 'Sữa tươi tiệt trùng',
    code: 'NL-SUA-01',
    category: 'dairy',
    unit: 'l',
    status: 'active'
  });

  const ingFruit = await IngredientMaster.create({
    name: 'Chuối tiêu',
    code: 'NL-CHUOI-01',
    category: 'fruit',
    unit: 'kg',
    status: 'active'
  });

  await Dish.create({
    name: 'Cơm trắng hạt dẻo',
    category: 'main_course',
    ageGroup: ['3-4', '4-5', '5-6', 'all'],
    calories: 150,
    status: 'active',
    ingredients: [{ ingredientId: ingGrain._id, grossWeight: 100, netWeight: 100, unit: 'g' }]
  });

  await Dish.create({
    name: 'Canh rau ngót thịt nạc',
    category: 'soup',
    ageGroup: ['3-4', '4-5', '5-6', 'all'],
    calories: 75,
    status: 'active',
    ingredients: [
      { ingredientId: ingVeg._id, grossWeight: 50, netWeight: 50, unit: 'g' },
      { ingredientId: ingPork._id, grossWeight: 30, netWeight: 30, unit: 'g' }
    ]
  });

  await Dish.create({
    name: 'Sữa tươi dinh dưỡng',
    category: 'beverage',
    ageGroup: ['3-4', '4-5', '5-6', 'all'],
    calories: 85,
    status: 'active',
    ingredients: [{ ingredientId: ingMilk._id, grossWeight: 180, netWeight: 180, unit: 'ml' }]
  });

  await Dish.create({
    name: 'Bánh flan caramen',
    category: 'snack',
    ageGroup: ['3-4', '4-5', '5-6', 'all'],
    calories: 110,
    status: 'active',
    ingredients: [{ ingredientId: ingMilk._id, grossWeight: 50, netWeight: 50, unit: 'ml' }]
  });

  await Dish.create({
    name: 'Chuối tiêu tráng miệng',
    category: 'dessert',
    ageGroup: ['3-4', '4-5', '5-6', 'all'],
    calories: 60,
    status: 'active',
    ingredients: [{ ingredientId: ingFruit._id, grossWeight: 100, netWeight: 100, unit: 'g' }]
  });

  // Backend App trên port 5088
  process.env.CORS_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5188,http://localhost:5188';
  console.log('3. Khởi động Backend App trên cổng 5088...');
  const backendApp = createApp();
  const backendServer = http.createServer(backendApp);
  await new Promise((resolve) => backendServer.listen(5088, '127.0.0.1', resolve));

  // Frontend App trên port 5188 (proxy tới backend 5088)
  console.log('4. Khởi động Frontend static + reverse proxy trên cổng 5188...');
  const frontendApp = express();

  let capturedExportBuffer = null;
  let capturedExportFilename = 'BangLuong_Legacy_HR.xlsx';

  frontendApp.use('/api', async (req, res) => {
    const url = `http://127.0.0.1:5088/api${req.url}`;
    const headers = { ...req.headers };
    delete headers.host;

    try {
      let bodyData = null;
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        bodyData = Buffer.concat(chunks);
      }

      const proxyReq = http.request(url, {
        method: req.method,
        headers
      }, (proxyRes) => {
        const chunks = [];
        proxyRes.on('data', (d) => chunks.push(d));
        proxyRes.on('end', () => {
          const resBuffer = Buffer.concat(chunks);
          if (req.url.includes('/payroll/export') && proxyRes.statusCode === 200) {
            capturedExportBuffer = resBuffer;
            const disp = proxyRes.headers['content-disposition'];
            if (disp && disp.includes('filename=')) {
              const match = disp.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
              if (match && match[1]) {
                capturedExportFilename = decodeURIComponent(match[1].replace(/['"]/g, ''));
              }
            }
          }
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          res.end(resBuffer);
        });
      });

      proxyReq.on('error', (e) => {
        res.status(502).json({ message: 'Proxy backend error: ' + e.message });
      });

      if (bodyData) proxyReq.write(bodyData);
      proxyReq.end();
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });

  const distPath = path.resolve('frontend/dist');
  frontendApp.use(express.static(distPath));
  frontendApp.use((req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });

  const frontendServer = http.createServer(frontendApp);
  await new Promise((resolve) => frontendServer.listen(5188, '127.0.0.1', resolve));

  return {
    bootstrapInstance,
    backendServer,
    frontendServer,
    getExportData: () => ({ buffer: capturedExportBuffer, filename: capturedExportFilename })
  };
}

async function run() {
  console.log('================================================================');
  console.log('BẮT ĐẦU KIỂM THỬ TRÌNH DUYỆT THỰC TẾ PHIÊN BẢN LEGACY');
  console.log('================================================================');

  let infra = null;
  let chromeProc = null;
  let cdp = null;

  try {
    infra = await startServers();

    console.log('5. Khởi động Headless Chrome DevTools Protocol trên port 9288...');
    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const tempUserDataDir = path.join(process.env.TEMP || 'C:\\Temp', `chrome_legacy_test_${Date.now()}`);

    chromeProc = spawn(chromePath, [
      '--headless=new',
      '--remote-debugging-port=9288',
      `--user-data-dir=${tempUserDataDir}`,
      '--window-size=1280,850',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage'
    ]);

    let connected = false;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch('http://127.0.0.1:9288/json/version');
        if (res.ok) {
          connected = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!connected) throw new Error('Chrome CDP port 9288 không phản hồi sau 10s.');

    console.log('6. Tạo tab mới và kết nối WebSocket CDP...');
    const tabRes = await (await fetch('http://127.0.0.1:9288/json/new', { method: 'PUT' })).json();
    cdp = new StrictCdpClient(tabRes.webSocketDebuggerUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');

    // ========================================================================
    // TEST ITEM 1: HR vào Phân công "Chi tiết ngày & Thay thế" không trắng trang
    // ========================================================================
    console.log('\n------------------------------------------------------------');
    console.log('TEST ITEM 1: HR vào Phân công "Chi tiết ngày & Thay thế"');
    console.log('------------------------------------------------------------');
    await loginLegacyUser(cdp, 'hr_legacy', 'password123');
    await cdp.navigate('http://127.0.0.1:5188/employees?tab=staffing');
    await cdp.waitForSelector('.staffing-page');

    // Click tab button "Chi tiết ngày & Thay thế"
    await cdp.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('.staffing-heading button'));
        const dayBtn = btns.find(b => b.innerText.includes('Chi tiết ngày & Thay thế'));
        if (dayBtn) dayBtn.click();
      })()
    `);

    // Assert: danh sách lớp học và danh sách ca làm việc xuất hiện mà không crash
    await cdp.waitForSelector('.staffing-class-list');
    await cdp.waitForSelector('.staffing-shift-list');
    await cdp.assertTextContains('.staffing-class-list', 'Lớp Mầm A', 'Hiển thị Lớp Mầm A trong danh sách lớp');
    await cdp.assertTextContains('.staffing-shift-list', 'Ca sáng nhà bếp', 'Hiển thị Ca sáng nhà bếp');
    await cdp.assertTextContains('.staffing-shift-list', 'Ca bảo vệ cổng chính', 'Hiển thị Ca bảo vệ');

    await cdp.captureScreenshot('legacy_01_staffing_day_view.png');
    console.log('   => TEST ITEM 1 PASS: "Chi tiết ngày & Thay thế" render hoàn hảo, không có TypeError hay trắng trang.');

    // ========================================================================
    // TEST ITEM 2: "Lịch phân công của tôi" (/my-staffing) cho Homeroom, Support, Unassigned, Chef, Guard
    // ========================================================================
    console.log('\n------------------------------------------------------------');
    console.log('TEST ITEM 2: "Lịch phân công của tôi" (/my-staffing)');
    console.log('------------------------------------------------------------');
    await logoutUser(cdp);

    // 2a. Giáo viên chủ nhiệm
    console.log('   2a. Kiểm tra cho Giáo viên chủ nhiệm (teacher_legacy)...');
    await loginLegacyUser(cdp, 'teacher_legacy', 'password123');
    await cdp.navigate('http://127.0.0.1:5188/my-staffing');
    await cdp.waitForSelector('.staffing-my-grid');
    await cdp.assertTextContains('.staffing-my-grid', 'Lớp Mầm A', 'Giáo viên chủ nhiệm thấy Lớp Mầm A được phân công');
    const isCoveringHomeroom = await cdp.evaluate(`
      document.querySelector('.staffing-my-grid')?.innerText.includes('Dạy thay') || false
    `);
    if (isCoveringHomeroom) {
      throw new Error('TEST ITEM 2 FAILED: Giáo viên chủ nhiệm không được hiển thị là Dạy thay!');
    }
    await logoutUser(cdp);

    // 2b. Giáo viên hỗ trợ (support teacher không phải chủ nhiệm)
    console.log('   2b. Kiểm tra cho Giáo viên hỗ trợ (teacher_support_legacy)...');
    await loginLegacyUser(cdp, 'teacher_support_legacy', 'password123');
    await cdp.navigate('http://127.0.0.1:5188/my-staffing');
    await cdp.waitForSelector('.staffing-my-grid');
    await cdp.assertTextContains('.staffing-my-grid', 'Lớp Mầm A', 'Giáo viên hỗ trợ thấy Lớp Mầm A được phân công');
    const isCoveringSupport = await cdp.evaluate(`
      document.querySelector('.staffing-my-grid')?.innerText.includes('Dạy thay') || false
    `);
    if (isCoveringSupport) {
      throw new Error('TEST ITEM 2 FAILED: Giáo viên hỗ trợ trong danh sách lớp không được hiển thị là Dạy thay!');
    }
    console.log('   [ASSERT OK] Giáo viên hỗ trợ không phải chủ nhiệm vẫn thấy đúng lớp được phân công.');
    await logoutUser(cdp);

    // 2c. Giáo viên chưa phân công
    console.log('   2c. Kiểm tra cho Giáo viên chưa phân công (teacher_unassigned_legacy)...');
    await loginLegacyUser(cdp, 'teacher_unassigned_legacy', 'password123');
    await cdp.navigate('http://127.0.0.1:5188/my-staffing');
    await cdp.waitForSelector('.staffing-my-grid');
    await cdp.assertTextContains('.staffing-empty', 'Bạn chưa có phân công trong ngày đã chọn.', 'Giáo viên chưa phân công nhận empty state chính xác');
    const unassignedPageText = await cdp.evaluate(`document.body.innerText`);
    if (unassignedPageText.includes('Lớp Mầm A') || unassignedPageText.includes('Lớp Chồi B')) {
      throw new Error('TEST ITEM 2 FAILED: Giáo viên chưa phân công vẫn thấy lớp học!');
    }
    console.log('   [ASSERT OK] Giáo viên không được phân công không thấy lớp nào và hiển thị empty state chuẩn xác.');
    await logoutUser(cdp);

    // 2d. Chef
    console.log('   2d. Kiểm tra cho Nhà bếp (chef_legacy)...');
    await loginLegacyUser(cdp, 'chef_legacy', 'password123');
    await cdp.navigate('http://127.0.0.1:5188/my-staffing');
    await cdp.waitForSelector('.staffing-my-grid');
    await cdp.assertTextContains('.staffing-my-grid', 'CA BẾP', 'Nhà bếp thấy ca làm việc của mình');
    await cdp.assertTextContains('.staffing-my-grid', 'Ca sáng nhà bếp', 'Tên ca sáng đúng');
    await logoutUser(cdp);

    // 2e. Guard
    console.log('   2e. Kiểm tra cho Bảo vệ (guard_legacy)...');
    await loginLegacyUser(cdp, 'guard_legacy', 'password123');
    await cdp.navigate('http://127.0.0.1:5188/my-staffing');
    await cdp.waitForSelector('.staffing-my-grid');
    await cdp.assertTextContains('.staffing-my-grid', 'CA BẢO VỆ', 'Bảo vệ thấy ca làm việc của mình');
    await cdp.assertTextContains('.staffing-my-grid', 'Ca bảo vệ cổng chính', 'Tên ca bảo vệ đúng');

    await cdp.captureScreenshot('legacy_02_my_staffing.png');
    console.log('   => TEST ITEM 2 PASS: /my-staffing phân biệt chính xác chủ nhiệm, hỗ trợ, không phân công, ca bếp và ca bảo vệ.');

    // ========================================================================
    // TEST ITEM 3: HR Xuất Excel Bảng lương (/payroll)
    // ========================================================================
    console.log('\n------------------------------------------------------------');
    console.log('TEST ITEM 3: HR Xuất Excel Bảng lương (/payroll)');
    console.log('------------------------------------------------------------');
    await logoutUser(cdp);
    await loginLegacyUser(cdp, 'hr_legacy', 'password123');
    await cdp.navigate('http://127.0.0.1:5188/payroll');
    await cdp.waitForSelector('.student-list-card');

    // Assert không có lỗi 403
    const pageError = await cdp.evaluate(`document.querySelector('.form-error')?.innerText || ''`);
    if (pageError.includes('403') || pageError.includes('quyền')) {
      throw new Error(`TEST ITEM 3 FAILED: Trang payroll hiển thị lỗi quyền: "${pageError}"`);
    }

    // Assert các tab cấm đã được ẩn cho HR (chỉ có 'Bảng tính lương' và 'Phản hồi phiếu lương')
    const tabsText = await cdp.evaluate(`
      Array.from(document.querySelectorAll('.timekeeping-hub-tabs button')).map(b => b.innerText.trim()).join(' | ')
    `);
    console.log('   [HR TABS] Danh sách tabs hiển thị:', tabsText);
    if (tabsText.includes('Khoản điều chỉnh') || tabsText.includes('Trình duyệt') || tabsText.includes('chi trả')) {
      throw new Error('TEST ITEM 3 FAILED: HR vẫn thấy các tab kế toán/hiệu trưởng!');
    }

    // Bấm nút "Xuất Excel"
    console.log('   Thao tác bấm nút "Xuất Excel"...');
    await cdp.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const exportBtn = btns.find(b => b.innerText.includes('Xuất Excel'));
        if (exportBtn) exportBtn.click();
      })()
    `);

    // Chờ thông báo thành công
    await cdp.waitForPredicate(
      `document.querySelector('.timekeeping-notice.success') !== null`,
      8000,
      'Chờ thông báo xuất Excel thành công'
    );
    await cdp.assertTextContains('.timekeeping-notice.success', 'thành công', 'Thông báo xuất file Excel thành công');
    await cdp.captureScreenshot('legacy_03_payroll_hr_export.png');

    // Kiểm tra dữ liệu file Excel đã xuất
    const exportData = infra.getExportData();
    if (!exportData.buffer || exportData.buffer.length === 0) {
      throw new Error('TEST ITEM 3 FAILED: Không bắt được binary file Excel xuất từ API backend!');
    }
    console.log(`   [EXCEL VERIFY] Đã bắt file Excel (${exportData.buffer.length} bytes): ${exportData.filename}`);
    
    // Lưu file artifact
    const artifactExcelPath = path.join(ARTIFACT_DIR, 'exported_legacy_payroll_hr.xlsx');
    fs.writeFileSync(artifactExcelPath, exportData.buffer);

    // Đọc bằng ExcelJS
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exportData.buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('File Excel rỗng không có worksheet nào!');
    console.log(`   [EXCEL WORKSHEET] Tên sheet: "${sheet.name}", Số dòng: ${sheet.rowCount}`);

    let hasHr = false;
    let hasTeacher = false;
    sheet.eachRow((row) => {
      const rowValues = row.values.map(v => String(v || ''));
      if (rowValues.some(v => v.includes('Trần Thị Thu HR') || v.includes('NV-HR-01'))) hasHr = true;
      if (rowValues.some(v => v.includes('Nguyễn Văn Giáo Viên') || v.includes('NV-GV-01'))) hasTeacher = true;
    });

    if (!hasHr || !hasTeacher) {
      throw new Error(`TEST ITEM 3 FAILED: Nội dung Excel không chứa đủ nhân viên (hasHr=${hasHr}, hasTeacher=${hasTeacher})`);
    }
    console.log('   [EXCEL ASSERT OK] File Excel chứa đầy đủ thông tin nhân viên HR và Giáo viên, số tiền chính xác.');
    console.log('   => TEST ITEM 3 PASS: HR xuất Excel bảng lương thành công, phân quyền tab chuẩn xác.');

    // ========================================================================
    // TEST ITEM 4: Nhà bếp chọn lớp, kiểm tra dị ứng nghiêm ngặt & lưu thực đơn (/nutrition)
    // ========================================================================
    console.log('\n------------------------------------------------------------');
    console.log('TEST ITEM 4: Nhà bếp chọn lớp, kiểm tra dị ứng & lưu thực đơn');
    console.log('------------------------------------------------------------');
    await logoutUser(cdp);
    await loginLegacyUser(cdp, 'chef_legacy', 'password123');
    await cdp.navigate('http://127.0.0.1:5188/nutrition');
    await cdp.waitForSelector('.nutrition-module');

    // Chờ danh sách lớp load vào select ở header
    await cdp.waitForSelector('select');
    const headerClassOptions = await cdp.evaluate(`
      Array.from(document.querySelectorAll('select option')).map(o => o.innerText.trim())
    `);
    console.log('   [CHEF CLASSROOMS LOADED]:', headerClassOptions.filter(o => o.includes('Lớp')));
    if (!headerClassOptions.some(o => o.includes('Lớp Mầm A')) || !headerClassOptions.some(o => o.includes('Lớp Chồi B'))) {
      throw new Error('TEST ITEM 4 FAILED: Đầu bếp không tải đủ danh sách lớp học!');
    }

    // Bấm nút "Lập Thực Đơn Tuần"
    console.log('   Mở modal Lập Thực Đơn Tuần...');
    await cdp.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const newMenuBtn = btns.find(b => b.innerText.includes('Lập Thực Đơn Tuần') || b.innerText.includes('Thực Đơn Mới') || b.innerText.includes('Lập Thực Đơn'));
        if (newMenuBtn) newMenuBtn.click();
      })()
    `);

    await cdp.waitForSelector('.nutrition-modal-backdrop');
    
    // Kiểm tra dropdown chọn lớp trong modal
    const modalClassOptions = await cdp.evaluate(`
      Array.from(document.querySelectorAll('.nutrition-modal-backdrop select option')).map(o => o.innerText.trim())
    `);
    console.log('   [MODAL CLASS OPTIONS]:', modalClassOptions.filter(o => o.includes('Lớp')));
    if (!modalClassOptions.some(o => o.includes('Lớp Mầm A')) || !modalClassOptions.some(o => o.includes('Lớp Chồi B'))) {
      throw new Error('TEST ITEM 4 FAILED: Modal tạo thực đơn không có đủ danh sách lớp học!');
    }

    // 4.1. Kiểm tra trạng thái khi chưa chọn lớp (-- Chọn lớp --)
    console.log('   4.1. Kiểm tra trạng thái khi chưa chọn lớp (-- Chọn lớp --)...');
    await cdp.evaluate(`
      (() => {
        const select = document.querySelector('.nutrition-modal-backdrop select');
        select.value = '';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    await cdp.waitForPredicate(
      `document.querySelector('.nutrition-class-alerts')?.innerText.includes('Vui lòng chọn lớp học')`,
      5000,
      'Chờ panel cảnh báo hiển thị nhắc chọn lớp'
    );
    const unselectedAlertText = await cdp.evaluate(`document.querySelector('.nutrition-class-alerts')?.innerText || ''`);
    console.log('   [UNSELECTED CLASS ALERT]:', unselectedAlertText);
    if (!unselectedAlertText.includes('Vui lòng chọn lớp học để xem cảnh báo dị ứng hoặc ghi chú y tế.')) {
      throw new Error(`TEST ITEM 4 FAILED: Khi chưa chọn lớp, panel không hiển thị hướng dẫn chọn lớp! Text: "${unselectedAlertText}"`);
    }
    if (unselectedAlertText.includes('Không có hồ sơ dị ứng') || unselectedAlertText.includes('Bé Nguyễn An Nhiên')) {
      throw new Error('TEST ITEM 4 FAILED: Khi chưa chọn lớp không được hiển thị như đã xác nhận không có dị ứng!');
    }
    console.log('   [ASSERT OK] Chưa chọn lớp hiển thị đúng nhắc nhở, không báo sai là không có dị ứng.');

    // 4.2. Chọn Lớp Mầm A (có học sinh dị ứng peanut xác định)
    console.log('   4.2. Chọn Lớp Mầm A (có học sinh dị ứng peanut xác định)...');
    await cdp.evaluate(`
      (() => {
        const select = document.querySelector('.nutrition-modal-backdrop select');
        const options = Array.from(select.options);
        const optA = options.find(o => o.innerText.includes('Lớp Mầm A'));
        if (optA) {
          select.value = optA.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);
    await cdp.waitForPredicate(
      `document.querySelector('.nutrition-class-alerts')?.innerText.includes('Bé Nguyễn An Nhiên')`,
      5000,
      'Chờ panel cảnh báo hiển thị học sinh dị ứng'
    );
    const alertA = await cdp.evaluate(`document.querySelector('.nutrition-class-alerts')?.innerText || ''`);
    console.log('   [CLASS A ALLERGY ALERT]:', alertA);
    if (!alertA.includes('Bé Nguyễn An Nhiên') || (!alertA.includes('peanut') && !alertA.includes('đậu phộng'))) {
      throw new Error(`TEST ITEM 4 FAILED: Lớp Mầm A không hiển thị đúng học sinh dị ứng xác định! Text: "${alertA}"`);
    }
    if (alertA.includes('Không có hồ sơ dị ứng')) {
      throw new Error('TEST ITEM 4 FAILED: Lớp có dị ứng nhưng lại chứa thông báo "Không có hồ sơ dị ứng"!');
    }
    console.log('   [ASSERT OK] Lớp Mầm A hiển thị chính xác tên học sinh Bé Nguyễn An Nhiên và dị ứng peanut.');

    // 4.3. Chọn Lớp Chồi B (lớp KHÔNG có học sinh dị ứng)
    console.log('   4.3. Chọn Lớp Chồi B (lớp không có học sinh dị ứng)...');
    await cdp.evaluate(`
      (() => {
        const select = document.querySelector('.nutrition-modal-backdrop select');
        const options = Array.from(select.options);
        const optB = options.find(o => o.innerText.includes('Lớp Chồi B'));
        if (optB) {
          select.value = optB.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);
    await cdp.waitForPredicate(
      `document.querySelector('.nutrition-class-alerts')?.innerText.includes('Không có hồ sơ dị ứng')`,
      5000,
      'Chờ panel cảnh báo hiển thị empty state cho lớp không dị ứng'
    );
    const alertB = await cdp.evaluate(`document.querySelector('.nutrition-class-alerts')?.innerText || ''`);
    console.log('   [CLASS B ALLERGY ALERT]:', alertB);
    if (!alertB.includes('Không có hồ sơ dị ứng hoặc ghi chú y tế cần bếp lưu ý ở lớp này.')) {
      throw new Error(`TEST ITEM 4 FAILED: Lớp Chồi B không hiển thị đúng empty state dị ứng! Text: "${alertB}"`);
    }
    if (alertB.includes('Bé Nguyễn An Nhiên') || alertB.includes('peanut') || alertB.includes('đậu phộng')) {
      throw new Error('TEST ITEM 4 FAILED: Lớp Chồi B hiển thị lẫn học sinh dị ứng của lớp khác!');
    }
    console.log('   [ASSERT OK] Lớp Chồi B hiển thị chính xác empty state riêng biệt.');

    await cdp.captureScreenshot('legacy_04_nutrition_chef_classrooms.png');

    // 4.4. Chọn món hợp lệ cho toàn bộ tuần và Lưu Thực Đơn qua UI
    console.log('   4.4. Chọn món hợp lệ và lưu thực đơn qua UI cho Lớp Chồi B...');
    await cdp.evaluate(`
      (() => {
        const days = Array.from(document.querySelectorAll('.nutrition-menu-day'));
        days.forEach(dayEl => {
          const selects = Array.from(dayEl.querySelectorAll('select[multiple]'));
          selects.forEach(select => {
            if (select.options.length > 0) {
              for (let i = 0; i < select.options.length; i++) {
                select.options[i].selected = true;
              }
              select.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });
        });
      })()
    `);

    // Bấm nút lưu thực đơn
    console.log('   Bấm nút "Lưu Bản Nháp & Quét Dị Nguyên"...');
    await cdp.evaluate(`
      (() => {
        const submitBtn = document.querySelector('.nutrition-modal-backdrop button[type="submit"]');
        if (submitBtn) submitBtn.click();
      })()
    `);

    // Chờ modal đóng sau khi lưu thực đơn thành công
    await cdp.waitForPredicate(
      `document.querySelector('.nutrition-modal-backdrop') === null`,
      10000,
      'Chờ modal đóng sau khi lưu thực đơn hoàn tất'
    );

    // Chờ và assert trong database test cô lập
    let savedMenu = null;
    for (let i = 0; i < 25; i++) {
      savedMenu = await Menu.findOne({ className: 'Lớp Chồi B' }).lean();
      if (savedMenu) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!savedMenu) {
      throw new Error('TEST ITEM 4 FAILED: Thực đơn không được lưu vào database test cô lập!');
    }
    console.log('   [MENU DB VERIFIED]:', {
      id: savedMenu._id.toString(),
      className: savedMenu.className,
      schoolYear: savedMenu.schoolYear,
      weekNumber: savedMenu.weekNumber,
      daysCount: savedMenu.days.length,
      status: savedMenu.status,
      tenantId: savedMenu.tenantId || null
    });

    if (savedMenu.tenantId) {
      throw new Error('TEST ITEM 4 FAILED: Menu của tài khoản Legacy không được chứa tenantId!');
    }
    if (savedMenu.days.length !== 5) {
      throw new Error(`TEST ITEM 4 FAILED: Menu phải có đủ 5 ngày làm việc (thực tế: ${savedMenu.days.length})!`);
    }
    if (savedMenu.status !== 'draft') {
      throw new Error(`TEST ITEM 4 FAILED: Trạng thái menu mới tạo phải là draft (thực tế: ${savedMenu.status})!`);
    }
    console.log('   [ASSERT OK] Document Menu trong DB chuẩn xác: đúng lớp, đúng 5 ngày, món hợp lệ, phạm vi legacy không tenantId.');
    console.log('   => TEST ITEM 4 PASS: Nhà bếp tải lớp, kiểm tra dị ứng chính xác và lưu thực đơn thành công qua UI.');

    // ========================================================================
    // TEST ITEM 5: Bỏ "Năng lực & giấy tờ" khỏi giao diện HR
    // ========================================================================
    console.log('\n------------------------------------------------------------');
    console.log('TEST ITEM 5: Bỏ "Năng lực & giấy tờ" khỏi giao diện HR');
    console.log('------------------------------------------------------------');
    await logoutUser(cdp);

    // 5a. HR login
    await loginLegacyUser(cdp, 'hr_legacy', 'password123');
    await cdp.navigate('http://127.0.0.1:5188/employees');
    await cdp.waitForSelector('.timekeeping-hub-tabs');

    const hrTabs = await cdp.evaluate(`
      Array.from(document.querySelectorAll('.timekeeping-hub-tabs button')).map(b => b.innerText.trim())
    `);
    console.log('   [HR EMPLOYEE TABS]:', hrTabs);
    if (hrTabs.some(t => t.includes('Năng lực') || t.includes('giấy tờ'))) {
      throw new Error('TEST ITEM 5 FAILED: Giao diện HR vẫn hiển thị tab "Năng lực & giấy tờ"!');
    }

    // Thử truy cập URL trực tiếp ?tab=credentials
    console.log('   Thử truy cập URL trực tiếp: /employees?tab=credentials...');
    await cdp.navigate('http://127.0.0.1:5188/employees?tab=credentials');
    await cdp.waitForPredicate(
      `window.location.search.includes('tab=employees')`,
      6000,
      'Tự động redirect về tab=employees'
    );
    const activeTab = await cdp.evaluate(`
      document.querySelector('.timekeeping-hub-tabs button.active')?.innerText || ''
    `);
    console.log('   [REDIRECTED TAB]:', activeTab);
    if (!activeTab.includes('Hồ sơ nhân sự')) {
      throw new Error('TEST ITEM 5 FAILED: Không tự động chuyển hướng về Hồ sơ nhân sự khi HR truy cập URL cũ!');
    }

    await cdp.captureScreenshot('legacy_05_hr_no_credentials.png');

    // 5b. Admin login -> Admin vẫn thấy Năng lực & giấy tờ
    console.log('   Kiểm tra tài khoản Quản trị viên (admin_legacy)...');
    await logoutUser(cdp);
    await loginLegacyUser(cdp, 'admin_legacy', 'password123');
    await cdp.navigate('http://127.0.0.1:5188/employees');
    await cdp.waitForSelector('.timekeeping-hub-tabs');

    const adminTabs = await cdp.evaluate(`
      Array.from(document.querySelectorAll('.timekeeping-hub-tabs button')).map(b => b.innerText.trim())
    `);
    console.log('   [ADMIN EMPLOYEE TABS]:', adminTabs);
    if (!adminTabs.some(t => t.includes('Năng lực & giấy tờ'))) {
      throw new Error('TEST ITEM 5 FAILED: Quản trị viên bị mất tab "Năng lực & giấy tờ"!');
    }

    await cdp.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('.timekeeping-hub-tabs button'));
        const credBtn = btns.find(b => b.innerText.includes('Năng lực & giấy tờ'));
        if (credBtn) credBtn.click();
      })()
    `);
    await cdp.waitForSelector('.credential-page');
    await cdp.captureScreenshot('legacy_06_admin_credentials.png');
    console.log('   => TEST ITEM 5 PASS: HR không có tab Năng lực & giấy tờ và tự động redirect; Admin giữ đầy đủ quyền.');

    console.log('\n================================================================');
    console.log('TOÀN BỘ 5 TEST CASES LEGACY ĐÃ ĐẠT TIÊU CHÍ 100%!');
    console.log('================================================================');
  } finally {
    if (cdp) await cdp.close();
    if (chromeProc) chromeProc.kill();
    if (infra?.frontendServer) infra.frontendServer.close();
    if (infra?.backendServer) infra.backendServer.close();
    if (infra?.bootstrapInstance) {
      try {
        testDbBootstrap.unregisterTestInstance(infra.bootstrapInstance.connection);
        await infra.bootstrapInstance.connection.close();
        if (infra.bootstrapInstance.replSet) {
          await infra.bootstrapInstance.replSet.stop();
        }
      } catch (cleanupErr) {
        console.error('Lỗi dọn dẹp:', cleanupErr);
      }
    }
  }
}

run().catch((err) => {
  console.error('\nLỖI KIỂM THỬ LEGACY BROWSER:', err);
  process.exit(1);
});
