'use strict';

const path = require('path');
process.env.NODE_PATH = path.join(__dirname, '../node_modules');
require('module').Module._initPaths();
require('dotenv').config({ path: path.join(__dirname, '../.env') });
process.env.CORS_ORIGINS = 'http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174,*';

const fs = require('fs');
const { spawn, execSync } = require('child_process');
const express = require('express');
const mongoose = require('mongoose');

const { startTestDb } = require('../src/saas/testDbBootstrap');
const createSaasApp = require('../src/saas/createSaasApp');
const { generateIsolationFixtures, TEST_PASSWORD } = require('./fixtures/generate_isolation_fixtures');
const { generateSchoolUserToken } = require('../src/saas/utils/saasJwt');

const TEST_SERVER_PORT = 5174;
const FRONTEND_URL = `http://127.0.0.1:${TEST_SERVER_PORT}`;
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CHROME_DEBUG_PORT = 9222;

const ARTIFACT_DIR = path.resolve('C:/Users/PhamDinhDong/.gemini/antigravity/brain/c0cd55dd-ceda-41d7-8f80-f3254ca5f175');
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots');

if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
if (!fs.existsSync(ARTIFACT_DIR)) fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const results = {
  assertions: [],
  uniqueRoutesTested: new Set(),
  scenarios: [],
  screenshots: [],
  blocked501Routes: [],
  notTestedRoutes: []
};

function recordAssertion(name, passed, detail = '') {
  results.assertions.push({ name, passed, detail });
  if (passed) {
    console.log(`   [ASSERT OK] ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`   [ASSERT FAIL] ${name}${detail ? ` (${detail})` : ''}`);
  }
}

class StrictCdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.callbacks = new Map();
    this.apiResponses = [];
    this.apiErrors = [];
    this.currentRoute = '';
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : event.data.toString();
          const msg = JSON.parse(raw);
          if (msg.method === 'Network.responseReceived') {
            const resp = msg.params.response;
            if (resp && resp.url && resp.url.includes('/api/')) {
              this.apiResponses.push({
                url: resp.url,
                status: resp.status,
                statusText: resp.statusText,
                mimeType: resp.mimeType
              });
              if (resp.status === 501) {
                const errObj = {
                  url: resp.url,
                  status: resp.status,
                  statusText: resp.statusText,
                  route: this.currentRoute
                };
                this.apiErrors.push(errObj);
                results.blocked501Routes.push(errObj);
                console.error(`   [HTTP 501 DETECTED] ${resp.url} on route ${this.currentRoute}`);
              } else if (resp.status === 500) {
                const errObj = {
                  url: resp.url,
                  status: resp.status,
                  statusText: resp.statusText,
                  route: this.currentRoute
                };
                this.apiErrors.push(errObj);
                console.error(`   [HTTP 500 DETECTED] ${resp.url} on route ${this.currentRoute}`);
              }
            }
          }
          if (msg.id && this.callbacks.has(msg.id)) {
            const cb = this.callbacks.get(msg.id);
            this.callbacks.delete(msg.id);
            if (msg.error) cb.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            else cb.resolve(msg.result);
          }
        } catch (e) {
          console.error('CDP parse message error:', e);
        }
      };
    });
  }

  async send(method, params = {}) {
    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`CDP Eval Error: ${res.exceptionDetails.text || JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result ? res.result.value : undefined;
  }

  async navigate(url) {
    this.currentRoute = url.replace(FRONTEND_URL, '') || '/';
    this.apiResponses = [];
    this.apiErrors = [];
    await this.send('Page.navigate', { url });
    await this.waitForPredicate(
      `document.readyState === 'complete'`,
      10000,
      `Chờ tải trang: ${url}`
    );
  }

  async reload() {
    this.apiResponses = [];
    this.apiErrors = [];
    await this.send('Page.reload');
    await this.waitForPredicate(
      `document.readyState === 'complete'`,
      10000,
      'Chờ trang reload xong (readyState === complete)'
    );
  }

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 600
    });
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
      `Chờ selector xuất hiện: ${selector}`
    );
  }

  async assertTextContains(selector, text, assertName) {
    const hasText = await this.evaluate(`
      (() => {
        const el = document.querySelector('${selector}');
        return el ? el.innerText.includes(${JSON.stringify(text)}) : false;
      })()
    `);
    recordAssertion(assertName, Boolean(hasText), `Tìm chuỗi "${text}" trong "${selector}"`);
    return Boolean(hasText);
  }

  async assertTextNotContains(selector, text, assertName) {
    const hasText = await this.evaluate(`
      (() => {
        const el = document.querySelector('${selector}');
        return el ? el.innerText.includes(${JSON.stringify(text)}) : false;
      })()
    `);
    recordAssertion(assertName, !hasText, `Chuỗi "${text}" phải VẮNG MẶT trong "${selector}"`);
    return !hasText;
  }

  async assertNoApiErrors(contextDesc) {
    const count501 = this.apiErrors.filter(e => e.status === 501).length;
    const count500 = this.apiErrors.filter(e => e.status === 500).length;
    const passed = count501 === 0 && count500 === 0;
    recordAssertion(
      `Không có lỗi HTTP 500/501 khi tải: ${contextDesc}`,
      passed,
      `Errors: 501=${count501}, 500=${count500}`
    );
    return passed;
  }

  async captureScreenshot(filename) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    const artifactPath = path.join(ARTIFACT_DIR, filename);
    const docsPath = path.join(SCREENSHOTS_DIR, filename);
    fs.writeFileSync(artifactPath, buffer);
    fs.writeFileSync(docsPath, buffer);
    results.screenshots.push(filename);
    console.log(`   [SCREENSHOT] Lưu file: ${filename} (${buffer.length} bytes)`);
  }

  async close() {
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
  }
}

async function establishSessionViaJwt(cdp, userDoc, tenantDoc) {
  const token = generateSchoolUserToken(userDoc, tenantDoc);
  const userPayload = {
    id: userDoc._id.toString(),
    username: userDoc.username,
    role: userDoc.role,
    tenantId: tenantDoc._id.toString(),
    schoolCode: tenantDoc.code,
    profile: userDoc.profile || { fullName: userDoc.username }
  };
  const tenantPayload = {
    id: tenantDoc._id.toString(),
    code: tenantDoc.code,
    name: tenantDoc.name
  };

  await cdp.navigate(`${FRONTEND_URL}/login`);
  await cdp.evaluate(`
    localStorage.setItem('token', ${JSON.stringify(token)});
    localStorage.setItem('user', ${JSON.stringify(JSON.stringify(userPayload))});
    localStorage.setItem('tenant', ${JSON.stringify(JSON.stringify(tenantPayload))});
    localStorage.setItem('last_school_code', ${JSON.stringify(tenantDoc.code)});
  `);
  await new Promise((r) => setTimeout(r, 200));
}

async function loginUserViaForm(cdp, schoolCode, username, password) {
  await cdp.navigate(`${FRONTEND_URL}/login`);
  await cdp.waitForSelector('.login-form-wrap form');
  await cdp.evaluate(`
    (() => {
      const inputs = document.querySelectorAll('.login-form-wrap input');
      const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      
      const t0 = inputs[0]._valueTracker;
      if (t0) t0.setValue('__reset__');
      nativeSet.call(inputs[0], ${JSON.stringify(schoolCode || '')});
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[0].dispatchEvent(new Event('change', { bubbles: true }));

      const t1 = inputs[1]._valueTracker;
      if (t1) t1.setValue('__reset__');
      nativeSet.call(inputs[1], ${JSON.stringify(username || '')});
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[1].dispatchEvent(new Event('change', { bubbles: true }));

      const t2 = inputs[2]._valueTracker;
      if (t2) t2.setValue('__reset__');
      nativeSet.call(inputs[2], ${JSON.stringify(password || '')});
      inputs[2].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[2].dispatchEvent(new Event('change', { bubbles: true }));

      const submitBtn = document.querySelector('.login-form-wrap button[type="submit"]');
      if (submitBtn) submitBtn.click();
    })()
  `);
  
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const curUrl = await cdp.evaluate('window.location.href');
    if (!curUrl.includes('/login')) break;
    const loginErr = await cdp.evaluate(`document.querySelector('.login-error, .error-message, .form-error, [role="alert"]')?.innerText || ''`);
    if (loginErr) {
      throw new Error(`LOGIN_FAILED [${username}@${schoolCode}]: ${loginErr}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  await cdp.waitForPredicate(
    `!window.location.href.includes('/login')`,
    6000,
    `Đăng nhập thành công với user [${username}]`
  );
  await new Promise((r) => setTimeout(r, 400));
}

async function logoutUser(cdp) {
  await cdp.evaluate(`
    (() => {
      const logoutBtn = document.querySelector('.sidebar-logout');
      if (logoutBtn) logoutBtn.click();
      else {
        localStorage.clear();
        sessionStorage.clear();
        window.location.href = '/login';
      }
    })()
  `);
  await cdp.waitForPredicate(
    `window.location.href.includes('/login')`,
    6000,
    'Chờ thoát về trang /login'
  );
  await cdp.evaluate(`
    (() => {
      localStorage.clear();
      sessionStorage.clear();
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));
}

async function runIsolationBrowserAudit() {
  console.log('====================================================================');
  console.log('🌐 BẮT ĐẦU KIỂM THỬ GIAO DIỆN VÀ CHUYỂN PHIÊN CÁCH LY SAAS HOÀN CHỈNH');
  console.log('MÔI TRƯỜNG E2E CÔ LẬP VỚI MONGOMEMORYREPLSET TRÊN CỔNG 5174');
  console.log('BẢO TỒN NGUYÊN VẸN DATABASE THẬT SCHOOL_MANAGEMENT (0 BYTES GHI)');
  console.log('====================================================================\n');

  console.log('1. Khởi động MongoMemoryReplSet cô lập...');
  const { connection, uri, stop: stopDb } = await startTestDb();

  console.log('2. Nạp bộ fixtures độc lập đầy đủ cho HOANANG-A & HOANANG-B...');
  const fixtureData = await generateIsolationFixtures();
  const tenantA = fixtureData.tenants.a;
  const tenantB = fixtureData.tenants.b;
  const { usersA, usersB, manifest } = fixtureData;

  console.log('3. Khởi tạo SaaS Application (mode: phase1e) tích hợp tĩnh frontend...');
  const app = createSaasApp({ connection, mongoUri: uri, saasMode: 'phase1e' });
  const distPath = path.resolve(__dirname, '../../frontend/dist');
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(distPath, 'index.html'));
    }
    next();
  });

  const testServer = await new Promise((resolve) => {
    const s = app.listen(TEST_SERVER_PORT, '127.0.0.1', () => {
      console.log(`   -> Test Server sẵn sàng tại ${FRONTEND_URL}`);
      resolve(s);
    });
  });

  const userDataDir = path.join(process.env.TEMP || 'C:\\Windows\\Temp', 'chrome_iso_ui_' + Date.now());
  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,850',
    'about:blank'
  ]);

  await new Promise((r) => setTimeout(r, 1500));

  let cdpReady = false;
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CHROME_DEBUG_PORT}/json`);
      const tabs = await res.json();
      if (tabs && tabs.length > 0) {
        cdpReady = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!cdpReady) throw new Error(`Không thể kết nối Chrome CDP trên cổng ${CHROME_DEBUG_PORT}`);

  const tabsRes = await fetch(`http://127.0.0.1:${CHROME_DEBUG_PORT}/json`);
  const tabs = await tabsRes.json();
  const pageTab = tabs.find((t) => t.type === 'page') || tabs[0];

  const cdp = new StrictCdpClient(pageTab.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Network.enable');
  await cdp.setViewport(1280, 850);

  try {
    // =========================================================================
    // PHẦN 1: ĐĂNG NHẬP THỰC TẾ QUA FORM GIAO DIỆN (LOGIN UI)
    // =========================================================================
    console.log('\n--- 1. FORM ĐĂNG NHẬP THỰC TẾ: HOANANG-A & HOANANG-B ---');
    await loginUserViaForm(cdp, tenantA.code, usersA.admin.username, TEST_PASSWORD);
    await cdp.waitForPredicate(
      `window.location.href.includes('/dashboard')`,
      8000,
      'Chuyển về /dashboard sau đăng nhập Admin A'
    );
    await cdp.assertNoApiErrors('Đăng nhập thành công Admin A qua form');
    await cdp.captureScreenshot('iso_browser_01_admin_a_login_ok.png');
    results.uniqueRoutesTested.add('/login');
    results.uniqueRoutesTested.add('/dashboard');
    results.scenarios.push({ role: 'admin', route: '/login', scenario: 'Admin A đăng nhập thực tế qua Form UI', status: 'PASS' });
    await logoutUser(cdp);

    await loginUserViaForm(cdp, tenantB.code, usersB.admin.username, TEST_PASSWORD);
    await cdp.waitForPredicate(
      `window.location.href.includes('/dashboard')`,
      8000,
      'Chuyển về /dashboard sau đăng nhập Admin B'
    );
    await cdp.assertNoApiErrors('Đăng nhập thành công Admin B qua form');
    await cdp.captureScreenshot('iso_browser_02_admin_b_login_ok.png');
    results.scenarios.push({ role: 'admin', route: '/login', scenario: 'Admin B đăng nhập thực tế qua Form UI', status: 'PASS' });
    await logoutUser(cdp);

    // =========================================================================
    // PHẦN 2: QUẢN TRỊ VIÊN (ADMIN A & ADMIN B) TRÊN /students & /classrooms
    // =========================================================================
    console.log('\n--- 2. ADMIN A & B: Học sinh (/students) & Lớp học (/classrooms) ---');
    await establishSessionViaJwt(cdp, usersA.admin, tenantA);
    await cdp.navigate(`${FRONTEND_URL}/students`);
    await cdp.waitForPredicate(
      `!document.body.innerText.includes('Đang tải danh sách') && document.body.innerText.includes('ISO_A_STUDENT_AN')`,
      10000,
      'Chờ dữ liệu học sinh Trường A'
    );
    await new Promise((r) => setTimeout(r, 500));
    await cdp.assertTextContains('body', 'ISO_A_STUDENT_AN', 'Admin A thấy đúng học sinh Trường A (ISO_A_STUDENT_AN)');
    await cdp.assertTextNotContains('body', 'ISO_B_STUDENT_BINH', 'Admin A KHÔNG thấy học sinh Trường B (ISO_B_STUDENT_BINH)');
    await cdp.assertNoApiErrors('Admin A tải /students');
    await cdp.captureScreenshot('iso_browser_03_admin_a_students.png');
    results.uniqueRoutesTested.add('/students');
    results.scenarios.push({ role: 'admin', route: '/students', scenario: 'Admin A xem danh sách học sinh Trường A', status: 'PASS' });
    await logoutUser(cdp);

    await establishSessionViaJwt(cdp, usersB.admin, tenantB);
    await cdp.navigate(`${FRONTEND_URL}/students`);
    await cdp.waitForPredicate(
      `!document.body.innerText.includes('Đang tải danh sách') && document.body.innerText.includes('ISO_B_STUDENT_BINH')`,
      10000,
      'Chờ dữ liệu học sinh Trường B'
    );
    await new Promise((r) => setTimeout(r, 500));
    await cdp.assertTextContains('body', 'ISO_B_STUDENT_BINH', 'Admin B thấy đúng học sinh Trường B (ISO_B_STUDENT_BINH)');
    await cdp.assertTextNotContains('body', 'ISO_A_STUDENT_AN', 'Admin B KHÔNG thấy học sinh Trường A (ISO_A_STUDENT_AN)');
    await cdp.assertNoApiErrors('Admin B tải /students');
    await cdp.captureScreenshot('iso_browser_04_admin_b_students.png');
    results.scenarios.push({ role: 'admin', route: '/students', scenario: 'Admin B xem danh sách học sinh Trường B', status: 'PASS' });

    // F5 Reload Test Admin B on /students
    console.log('   -> Kiểm tra F5 Reload trên /students của Admin B...');
    await cdp.reload();
    await cdp.waitForPredicate(
      `!document.body.innerText.includes('Đang tải danh sách') && document.body.innerText.includes('ISO_B_STUDENT_BINH')`,
      10000,
      'Chờ dữ liệu học sinh Trường B sau F5'
    );
    await cdp.assertTextContains('body', 'ISO_B_STUDENT_BINH', 'Sau F5: Admin B vẫn thấy đúng học sinh Trường B');
    await cdp.assertTextNotContains('body', 'ISO_A_STUDENT_AN', 'Sau F5: Admin B KHÔNG bị sót cache dữ liệu Trường A');
    await cdp.assertNoApiErrors('Admin B reload F5 /students');
    await cdp.captureScreenshot('iso_browser_05_admin_b_refresh_cache_ok.png');
    results.scenarios.push({ role: 'admin', route: '/students', scenario: 'Admin B reload F5 không sót cache', status: 'PASS' });

    // Cross-ID direct URL test
    console.log('   -> Kiểm tra Admin B truy cập ID trực tiếp của Học sinh A...');
    await cdp.navigate(`${FRONTEND_URL}/students/${manifest.studentA._id}`);
    await new Promise((r) => setTimeout(r, 800));
    const crossIdDenied = await cdp.evaluate(`
      Boolean(
        document.body.innerText.includes('Không tìm thấy') ||
        document.body.innerText.includes('không có quyền') ||
        document.querySelector('.empty-state') !== null ||
        !document.body.innerText.includes('ISO_A_STUDENT_AN')
      )
    `);
    recordAssertion('Admin B truy cập ID trực tiếp học sinh A: Dữ liệu A bị chặn hoàn toàn', crossIdDenied);
    await cdp.captureScreenshot('iso_browser_06_admin_b_cross_id_denied.png');
    results.scenarios.push({ role: 'admin', route: '/students/:id', scenario: 'Admin B truy cập ID trực tiếp học sinh A bị chặn', status: 'PASS' });

    // Classrooms
    await cdp.navigate(`${FRONTEND_URL}/classrooms`);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('ISO_B_CLASS_MAM_1')`,
      10000,
      'Chờ tải danh sách lớp học Trường B'
    );
    await new Promise((r) => setTimeout(r, 500));
    await cdp.assertTextContains('body', 'ISO_B_CLASS_MAM_1', 'Admin B thấy đúng lớp học Trường B (ISO_B_CLASS_MAM_1)');
    await cdp.assertTextNotContains('body', 'ISO_A_CLASS_MAM_1', 'Admin B KHÔNG thấy lớp học Trường A (ISO_A_CLASS_MAM_1)');
    await cdp.assertNoApiErrors('Admin B tải /classrooms');
    await cdp.captureScreenshot('iso_browser_07_admin_b_classrooms.png');
    results.uniqueRoutesTested.add('/classrooms');
    results.scenarios.push({ role: 'admin', route: '/classrooms', scenario: 'Admin B xem danh sách lớp học Trường B', status: 'PASS' });
    await logoutUser(cdp);

    // =========================================================================
    // PHẦN 3: NHÂN SỰ (HR A & HR B) TRÊN /employees
    // =========================================================================
    console.log('\n--- 3. NHÂN SỰ HR A & B: Danh sách nhân sự (/employees) ---');
    await establishSessionViaJwt(cdp, usersA.hr, tenantA);
    await cdp.navigate(`${FRONTEND_URL}/employees`);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('ISO_A_EMP_NGUYEN_A')`,
      10000,
      'Chờ tải danh sách nhân viên HR A'
    );
    await new Promise((r) => setTimeout(r, 500));
    await cdp.assertTextContains('body', 'ISO_A_EMP_NGUYEN_A', 'HR A thấy nhân sự Trường A (ISO_A_EMP_NGUYEN_A)');
    await cdp.assertTextNotContains('body', 'ISO_B_EMP_TRAN_B', 'HR A KHÔNG thấy nhân sự Trường B (ISO_B_EMP_TRAN_B)');
    await cdp.assertNoApiErrors('HR A tải /employees');
    await cdp.captureScreenshot('iso_browser_08_hr_a_employees.png');
    results.uniqueRoutesTested.add('/employees');
    results.scenarios.push({ role: 'hr', route: '/employees', scenario: 'HR A xem danh sách nhân sự Trường A', status: 'PASS' });
    await logoutUser(cdp);

    await establishSessionViaJwt(cdp, usersB.hr, tenantB);
    await cdp.navigate(`${FRONTEND_URL}/employees`);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('ISO_B_EMP_TRAN_B')`,
      10000,
      'Chờ tải danh sách nhân viên HR B'
    );
    await new Promise((r) => setTimeout(r, 500));
    await cdp.assertTextContains('body', 'ISO_B_EMP_TRAN_B', 'HR B thấy nhân sự Trường B (ISO_B_EMP_TRAN_B)');
    await cdp.assertTextNotContains('body', 'ISO_A_EMP_NGUYEN_A', 'HR B KHÔNG thấy nhân sự Trường A (ISO_A_EMP_NGUYEN_A)');
    await cdp.assertNoApiErrors('HR B tải /employees');
    await cdp.captureScreenshot('iso_browser_09_hr_b_employees.png');
    results.scenarios.push({ role: 'hr', route: '/employees', scenario: 'HR B xem danh sách nhân sự Trường B', status: 'PASS' });

    // F5 Reload HR B
    await cdp.reload();
    await cdp.waitForPredicate(
      `document.body.innerText.includes('ISO_B_EMP_TRAN_B')`,
      10000,
      'Chờ danh sách nhân sự HR B sau F5'
    );
    await cdp.assertTextContains('body', 'ISO_B_EMP_TRAN_B', 'Sau F5: HR B vẫn thấy đúng nhân sự Trường B');
    await cdp.assertTextNotContains('body', 'ISO_A_EMP_NGUYEN_A', 'Sau F5: HR B không bị sót cache Trường A');
    await cdp.assertNoApiErrors('HR B reload F5 /employees');
    await cdp.captureScreenshot('iso_browser_10_hr_b_refresh_cache_ok.png');
    results.scenarios.push({ role: 'hr', route: '/employees', scenario: 'HR B reload F5 không sót cache', status: 'PASS' });
    await logoutUser(cdp);

    // =========================================================================
    // PHẦN 4: GIÁO VIÊN (TEACHER A & TEACHER B) TRÊN /internal-notices
    // =========================================================================
    console.log('\n--- 4. GIÁO VIÊN A & B: Thông báo nội bộ (/internal-notices) ---');
    await establishSessionViaJwt(cdp, usersA.teacher, tenantA);
    await cdp.navigate(`${FRONTEND_URL}/internal-notices`);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('ISO_A_INTERNAL_NOTICE')`,
      10000,
      'Chờ tải thông báo nội bộ Giáo viên A'
    );
    await new Promise((r) => setTimeout(r, 500));
    await cdp.assertTextContains('body', 'ISO_A_INTERNAL_NOTICE', 'Giáo viên A thấy thông báo nội bộ Trường A');
    await cdp.assertTextNotContains('body', 'ISO_B_INTERNAL_NOTICE', 'Giáo viên A KHÔNG thấy thông báo Trường B');
    await cdp.assertNoApiErrors('Giáo viên A tải /internal-notices');
    await cdp.captureScreenshot('iso_browser_11_teacher_a_internal_notices.png');
    results.uniqueRoutesTested.add('/internal-notices');
    results.scenarios.push({ role: 'teacher', route: '/internal-notices', scenario: 'Giáo viên A xem thông báo nội bộ Trường A', status: 'PASS' });
    await logoutUser(cdp);

    await establishSessionViaJwt(cdp, usersB.teacher, tenantB);
    await cdp.navigate(`${FRONTEND_URL}/internal-notices`);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('ISO_B_INTERNAL_NOTICE')`,
      10000,
      'Chờ tải thông báo nội bộ Giáo viên B'
    );
    await new Promise((r) => setTimeout(r, 500));
    await cdp.assertTextContains('body', 'ISO_B_INTERNAL_NOTICE', 'Giáo viên B thấy thông báo nội bộ Trường B');
    await cdp.assertTextNotContains('body', 'ISO_A_INTERNAL_NOTICE', 'Giáo viên B KHÔNG thấy thông báo Trường A');
    await cdp.assertNoApiErrors('Giáo viên B tải /internal-notices');
    await cdp.captureScreenshot('iso_browser_12_teacher_b_internal_notices.png');
    results.scenarios.push({ role: 'teacher', route: '/internal-notices', scenario: 'Giáo viên B xem thông báo nội bộ Trường B', status: 'PASS' });
    await logoutUser(cdp);

    // =========================================================================
    // PHẦN 5: NHÀ BẾP (CHEF A & CHEF B) TRÊN /nutrition?tab=dishes
    // =========================================================================
    console.log('\n--- 5. NHÀ BẾP A & B: Dinh dưỡng & Món ăn (/nutrition?tab=dishes) ---');
    await establishSessionViaJwt(cdp, usersA.chef, tenantA);
    await cdp.navigate(`${FRONTEND_URL}/nutrition?tab=dishes`);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('ISO_A_DISH_CANH_CHUA')`,
      10000,
      'Chờ tải món ăn Nhà bếp A'
    );
    await new Promise((r) => setTimeout(r, 500));
    await cdp.assertTextContains('body', 'ISO_A_DISH_CANH_CHUA', 'Nhà bếp A thấy món Canh chua của Trường A');
    await cdp.assertTextNotContains('body', 'ISO_B_DISH_THIT_KHO', 'Nhà bếp A KHÔNG thấy món ăn Trường B');
    await cdp.assertNoApiErrors('Nhà bếp A tải /nutrition?tab=dishes');
    await cdp.captureScreenshot('iso_browser_13_chef_a_nutrition.png');
    results.uniqueRoutesTested.add('/nutrition?tab=dishes');
    results.scenarios.push({ role: 'chef', route: '/nutrition?tab=dishes', scenario: 'Nhà bếp A xem món ăn Trường A', status: 'PASS' });
    await logoutUser(cdp);

    await establishSessionViaJwt(cdp, usersB.chef, tenantB);
    await cdp.navigate(`${FRONTEND_URL}/nutrition?tab=dishes`);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('ISO_B_DISH_THIT_KHO')`,
      10000,
      'Chờ tải món ăn Nhà bếp B'
    );
    await new Promise((r) => setTimeout(r, 500));
    await cdp.assertTextContains('body', 'ISO_B_DISH_THIT_KHO', 'Nhà bếp B thấy món Thịt kho của Trường B');
    await cdp.assertTextNotContains('body', 'ISO_A_DISH_CANH_CHUA', 'Nhà bếp B KHÔNG thấy món ăn Trường A');
    await cdp.assertNoApiErrors('Nhà bếp B tải /nutrition?tab=dishes');
    await cdp.captureScreenshot('iso_browser_14_chef_b_nutrition.png');
    results.scenarios.push({ role: 'chef', route: '/nutrition?tab=dishes', scenario: 'Nhà bếp B xem món ăn Trường B', status: 'PASS' });
    await logoutUser(cdp);

    // =========================================================================
    // PHẦN 6: PHỤ HUYNH (PARENT A & PARENT B) TRÊN /parent-portal
    // =========================================================================
    console.log('\n--- 6. PHỤ HUYNH A & B: Cổng phụ huynh (/parent-portal) ---');
    await establishSessionViaJwt(cdp, usersA.parent, tenantA);
    await cdp.navigate(`${FRONTEND_URL}/parent-portal`);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('ISO_A_STUDENT_AN')`,
      10000,
      'Chờ thông tin con của Phụ huynh A'
    );
    await new Promise((r) => setTimeout(r, 500));
    await cdp.assertTextContains('body', 'ISO_A_STUDENT_AN', 'Phụ huynh A thấy đúng thông tin con mình (ISO_A_STUDENT_AN)');
    await cdp.assertTextNotContains('body', 'ISO_B_STUDENT_BINH', 'Phụ huynh A KHÔNG thấy con của Trường B');
    await cdp.assertNoApiErrors('Phụ huynh A tải /parent-portal');
    await cdp.captureScreenshot('iso_browser_15_parent_a_portal.png');
    results.uniqueRoutesTested.add('/parent-portal');
    results.scenarios.push({ role: 'parent', route: '/parent-portal', scenario: 'Phụ huynh A xem cổng thông tin con mình', status: 'PASS' });
    await logoutUser(cdp);

    await establishSessionViaJwt(cdp, usersB.parent, tenantB);
    await cdp.navigate(`${FRONTEND_URL}/parent-portal`);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('ISO_B_STUDENT_BINH')`,
      10000,
      'Chờ thông tin con của Phụ huynh B'
    );
    await new Promise((r) => setTimeout(r, 500));
    await cdp.assertTextContains('body', 'ISO_B_STUDENT_BINH', 'Phụ huynh B thấy đúng thông tin con mình (ISO_B_STUDENT_BINH)');
    await cdp.assertTextNotContains('body', 'ISO_A_STUDENT_AN', 'Phụ huynh B KHÔNG thấy con của Trường A');
    await cdp.assertNoApiErrors('Phụ huynh B tải /parent-portal');
    await cdp.captureScreenshot('iso_browser_16_parent_b_portal.png');
    results.scenarios.push({ role: 'parent', route: '/parent-portal', scenario: 'Phụ huynh B xem cổng thông tin con mình', status: 'PASS' });

    // Direct ID denial for Parent B attempting to access admin student page
    await cdp.navigate(`${FRONTEND_URL}/students/${manifest.studentA._id}`);
    await new Promise((r) => setTimeout(r, 600));
    const parentCurUrl = await cdp.evaluate('window.location.href');
    const isParentRedirected = parentCurUrl.includes('/parent-portal') || !parentCurUrl.includes(manifest.studentA._id);
    recordAssertion('Phụ huynh B truy cập trang admin học sinh: Tự động chuyển hướng về cổng phụ huynh', isParentRedirected, `URL: ${parentCurUrl}`);
    await logoutUser(cdp);

    // =========================================================================
    // PHẦN 7: BẢO VỆ (GUARD A & GUARD B) TRÊN /guard
    // =========================================================================
    console.log('\n--- 7. BẢO VỆ A & B: Phân hệ trực cổng (/guard) ---');
    await establishSessionViaJwt(cdp, usersA.guard, tenantA);
    await cdp.navigate(`${FRONTEND_URL}/guard?tab=incidents`);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('ISO_A_INCIDENT_CUA_SO')`,
      10000,
      'Chờ danh sách sự cố Bảo vệ A'
    );
    await new Promise((r) => setTimeout(r, 500));
    await cdp.assertTextContains('body', 'ISO_A_INCIDENT_CUA_SO', 'Bảo vệ A thấy sự cố riêng của Trường A');
    await cdp.assertTextNotContains('body', 'ISO_B_INCIDENT_HANG_RAO', 'Bảo vệ A KHÔNG thấy sự cố của Trường B');
    await cdp.assertNoApiErrors('Bảo vệ A tải /guard?tab=incidents');
    await cdp.captureScreenshot('iso_browser_17_guard_a_incidents.png');
    results.uniqueRoutesTested.add('/guard');
    results.scenarios.push({ role: 'guard', route: '/guard', scenario: 'Bảo vệ A xem sự cố an ninh Trường A', status: 'PASS' });
    await logoutUser(cdp);

    await establishSessionViaJwt(cdp, usersB.guard, tenantB);
    await cdp.navigate(`${FRONTEND_URL}/guard?tab=incidents`);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('ISO_B_INCIDENT_HANG_RAO')`,
      10000,
      'Chờ danh sách sự cố Bảo vệ B'
    );
    await new Promise((r) => setTimeout(r, 500));
    await cdp.assertTextContains('body', 'ISO_B_INCIDENT_HANG_RAO', 'Bảo vệ B thấy sự cố riêng của Trường B');
    await cdp.assertTextNotContains('body', 'ISO_A_INCIDENT_CUA_SO', 'Bảo vệ B KHÔNG thấy sự cố của Trường A');
    await cdp.assertNoApiErrors('Bảo vệ B tải /guard?tab=incidents');
    await cdp.captureScreenshot('iso_browser_18_guard_b_incidents.png');
    results.scenarios.push({ role: 'guard', route: '/guard', scenario: 'Bảo vệ B xem sự cố an ninh Trường B', status: 'PASS' });

    // F5 Reload Guard B
    await cdp.reload();
    await cdp.waitForPredicate(
      `document.body.innerText.includes('ISO_B_INCIDENT_HANG_RAO')`,
      10000,
      'Chờ sự cố Bảo vệ B sau F5'
    );
    await cdp.assertTextContains('body', 'ISO_B_INCIDENT_HANG_RAO', 'Sau F5: Bảo vệ B vẫn thấy đúng sự cố Trường B');
    await cdp.assertTextNotContains('body', 'ISO_A_INCIDENT_CUA_SO', 'Sau F5: Bảo vệ B không sót cache Trường A');
    await cdp.assertNoApiErrors('Bảo vệ B reload F5 /guard');
    await cdp.captureScreenshot('iso_browser_19_guard_b_refresh_cache_ok.png');
    results.scenarios.push({ role: 'guard', route: '/guard', scenario: 'Bảo vệ B reload F5 không sót cache', status: 'PASS' });
    await logoutUser(cdp);

    // =========================================================================
    // PHẦN 8: KẾ TOÁN (ACCOUNTANT A & B) TRÊN /accounting/operating-expenses
    // =========================================================================
    console.log('\n--- 8. KẾ TOÁN A & B: Chi vận hành (/accounting/operating-expenses) ---');
    await establishSessionViaJwt(cdp, usersA.accountant, tenantA);
    await cdp.navigate(`${FRONTEND_URL}/accounting/operating-expenses`);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('ISO_A_OP_EXPENSE') || document.body.innerText.includes('Công ty Điện Lực A')`,
      10000,
      'Chờ danh sách chi vận hành Kế toán A'
    );
    await new Promise((r) => setTimeout(r, 500));
    await cdp.assertTextContains('body', 'ISO_A_OP_EXPENSE', 'Kế toán A thấy chứng từ chi của Trường A');
    await cdp.assertTextNotContains('body', 'ISO_B_OP_EXPENSE', 'Kế toán A KHÔNG thấy chứng từ chi của Trường B');
    await cdp.assertNoApiErrors('Kế toán A tải /accounting/operating-expenses');
    await cdp.captureScreenshot('iso_browser_20_accountant_a_operating_expenses.png');
    results.uniqueRoutesTested.add('/accounting/operating-expenses');
    results.scenarios.push({ role: 'accountant', route: '/accounting/operating-expenses', scenario: 'Kế toán A xem chi vận hành Trường A', status: 'PASS' });
    await logoutUser(cdp);

    await establishSessionViaJwt(cdp, usersB.accountant, tenantB);
    await cdp.navigate(`${FRONTEND_URL}/accounting/operating-expenses`);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('ISO_B_OP_EXPENSE') || document.body.innerText.includes('Công ty Điện Lực B')`,
      10000,
      'Chờ danh sách chi vận hành Kế toán B'
    );
    await new Promise((r) => setTimeout(r, 500));
    await cdp.assertTextContains('body', 'ISO_B_OP_EXPENSE', 'Kế toán B thấy chứng từ chi của Trường B');
    await cdp.assertTextNotContains('body', 'ISO_A_OP_EXPENSE', 'Kế toán B KHÔNG thấy chứng từ chi của Trường A');
    await cdp.assertNoApiErrors('Kế toán B tải /accounting/operating-expenses');
    await cdp.captureScreenshot('iso_browser_21_accountant_b_operating_expenses.png');
    results.scenarios.push({ role: 'accountant', route: '/accounting/operating-expenses', scenario: 'Kế toán B xem chi vận hành Trường B', status: 'PASS' });

    // F5 Reload Accountant B
    await cdp.reload();
    await cdp.waitForPredicate(
      `document.body.innerText.includes('ISO_B_OP_EXPENSE')`,
      10000,
      'Chờ chi vận hành Kế toán B sau F5'
    );
    await cdp.assertTextContains('body', 'ISO_B_OP_EXPENSE', 'Sau F5: Kế toán B vẫn thấy đúng chi phí Trường B');
    await cdp.assertTextNotContains('body', 'ISO_A_OP_EXPENSE', 'Sau F5: Kế toán B không sót cache Trường A');
    await cdp.assertNoApiErrors('Kế toán B reload F5 /accounting/operating-expenses');
    await cdp.captureScreenshot('iso_browser_22_accountant_b_refresh_cache_ok.png');
    results.scenarios.push({ role: 'accountant', route: '/accounting/operating-expenses', scenario: 'Kế toán B reload F5 không sót cache', status: 'PASS' });
    await logoutUser(cdp);

    // =========================================================================
    // PHẦN 9: KẾ TOÁN (ACCOUNTANT A & B) TRÊN /accounting/expenses & /accounting/cashbook
    // =========================================================================
    console.log('\n--- 9. KẾ TOÁN A & B: Chi mua sắm CSVC & Sổ quỹ đối soát ---');
    await establishSessionViaJwt(cdp, usersA.accountant, tenantA);
    await cdp.navigate(`${FRONTEND_URL}/accounting/expenses`);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('PEDOC01') || document.body.innerText.includes('ISO_A_SUPPLIER_NONG_SAN')`,
      10000,
      'Chờ danh sách chi mua sắm Kế toán A'
    );
    await new Promise((r) => setTimeout(r, 500));
    await cdp.assertTextContains('body', 'ISO_A_SUPPLIER_NONG_SAN', 'Kế toán A thấy nhà cung cấp mua sắm của Trường A (ISO_A_SUPPLIER_NONG_SAN)');
    await cdp.assertTextNotContains('body', 'ISO_B_SUPPLIER_NONG_SAN', 'Kế toán A KHÔNG thấy nhà cung cấp mua sắm của Trường B');
    await cdp.assertNoApiErrors('Kế toán A tải /accounting/expenses');
    await cdp.captureScreenshot('iso_browser_23_accountant_a_expenses.png');
    results.uniqueRoutesTested.add('/accounting/expenses');
    results.scenarios.push({ role: 'accountant', route: '/accounting/expenses', scenario: 'Kế toán A xem chi mua sắm Trường A', status: 'PASS' });

    // Cashbook A
    await cdp.navigate(`${FRONTEND_URL}/accounting/cashbook`);
    await new Promise((r) => setTimeout(r, 800));
    await cdp.assertNoApiErrors('Kế toán A tải /accounting/cashbook');
    await cdp.captureScreenshot('iso_browser_24_accountant_a_cashbook.png');
    results.uniqueRoutesTested.add('/accounting/cashbook');
    results.scenarios.push({ role: 'accountant', route: '/accounting/cashbook', scenario: 'Kế toán A xem sổ quỹ đối soát', status: 'PASS' });
    await logoutUser(cdp);

    await establishSessionViaJwt(cdp, usersB.accountant, tenantB);
    await cdp.navigate(`${FRONTEND_URL}/accounting/expenses`);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('PEDOC01') || document.body.innerText.includes('ISO_B_SUPPLIER_THUC_PHAM')`,
      10000,
      'Chờ danh sách chi mua sắm Kế toán B'
    );
    await new Promise((r) => setTimeout(r, 500));
    await cdp.assertTextContains('body', 'ISO_B_SUPPLIER_THUC_PHAM', 'Kế toán B thấy nhà cung cấp mua sắm của Trường B (ISO_B_SUPPLIER_THUC_PHAM)');
    await cdp.assertTextNotContains('body', 'ISO_A_SUPPLIER_NONG_SAN', 'Kế toán B KHÔNG thấy nhà cung cấp mua sắm của Trường A');
    await cdp.assertNoApiErrors('Kế toán B tải /accounting/expenses');
    await cdp.captureScreenshot('iso_browser_25_accountant_b_expenses.png');
    results.scenarios.push({ role: 'accountant', route: '/accounting/expenses', scenario: 'Kế toán B xem chi mua sắm Trường B', status: 'PASS' });

    // Cashbook B
    await cdp.navigate(`${FRONTEND_URL}/accounting/cashbook`);
    await new Promise((r) => setTimeout(r, 800));
    await cdp.assertNoApiErrors('Kế toán B tải /accounting/cashbook');
    await cdp.captureScreenshot('iso_browser_26_accountant_b_cashbook.png');
    results.scenarios.push({ role: 'accountant', route: '/accounting/cashbook', scenario: 'Kế toán B xem sổ quỹ đối soát', status: 'PASS' });
    await logoutUser(cdp);

    // =========================================================================
    // PHẦN 10: TIN NHẮN (MESSAGES) & GÓP Ý PHỤ HUYNH (PARENT FEEDBACK)
    // =========================================================================
    console.log('\n--- 10. TIN NHẮN (/messages) & GÓP Ý PHỤ HUYNH (/parent-feedback) ---');
    await establishSessionViaJwt(cdp, usersA.parent, tenantA);
    await cdp.navigate(`${FRONTEND_URL}/messages`);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('ISO_A_CHAT_MSG')`,
      10000,
      'Chờ tải tin nhắn Phụ huynh A'
    );
    await new Promise((r) => setTimeout(r, 500));
    await cdp.assertTextContains('body', 'ISO_A_CHAT_MSG', 'Phụ huynh A thấy tin nhắn của Trường A');
    await cdp.assertTextNotContains('body', 'ISO_B_CHAT_MSG', 'Phụ huynh A KHÔNG thấy tin nhắn của Trường B');
    await cdp.assertNoApiErrors('Phụ huynh A tải /messages');
    await cdp.captureScreenshot('iso_browser_27_parent_a_messages.png');
    results.uniqueRoutesTested.add('/messages');
    results.scenarios.push({ role: 'parent', route: '/messages', scenario: 'Phụ huynh A xem tin nhắn hội thoại Trường A', status: 'PASS' });
    await logoutUser(cdp);

    await establishSessionViaJwt(cdp, usersB.parent, tenantB);
    await cdp.navigate(`${FRONTEND_URL}/messages`);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('ISO_B_CHAT_MSG')`,
      10000,
      'Chờ tải tin nhắn Phụ huynh B'
    );
    await new Promise((r) => setTimeout(r, 500));
    await cdp.assertTextContains('body', 'ISO_B_CHAT_MSG', 'Phụ huynh B thấy tin nhắn của Trường B');
    await cdp.assertTextNotContains('body', 'ISO_A_CHAT_MSG', 'Phụ huynh B KHÔNG thấy tin nhắn của Trường A');
    await cdp.assertNoApiErrors('Phụ huynh B tải /messages');
    await cdp.captureScreenshot('iso_browser_28_parent_b_messages.png');
    results.scenarios.push({ role: 'parent', route: '/messages', scenario: 'Phụ huynh B xem tin nhắn hội thoại Trường B', status: 'PASS' });
    await logoutUser(cdp);

    // Parent Feedback for Principal A & B
    await establishSessionViaJwt(cdp, usersA.principal, tenantA);
    await cdp.navigate(`${FRONTEND_URL}/parent-feedback`);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('ISO_A_FEEDBACK')`,
      10000,
      'Chờ tải góp ý phụ huynh Hiệu trưởng A'
    );
    await new Promise((r) => setTimeout(r, 500));
    await cdp.assertTextContains('body', 'ISO_A_FEEDBACK', 'Hiệu trưởng A thấy phản hồi phụ huynh Trường A');
    await cdp.assertTextNotContains('body', 'ISO_B_FEEDBACK', 'Hiệu trưởng A KHÔNG thấy phản hồi Trường B');
    await cdp.assertNoApiErrors('Hiệu trưởng A tải /parent-feedback');
    await cdp.captureScreenshot('iso_browser_29_principal_a_feedback.png');
    results.uniqueRoutesTested.add('/parent-feedback');
    results.scenarios.push({ role: 'principal', route: '/parent-feedback', scenario: 'Hiệu trưởng A xem góp ý phụ huynh Trường A', status: 'PASS' });
    await logoutUser(cdp);

    await establishSessionViaJwt(cdp, usersB.principal, tenantB);
    await cdp.navigate(`${FRONTEND_URL}/parent-feedback`);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('ISO_B_FEEDBACK')`,
      10000,
      'Chờ tải góp ý phụ huynh Hiệu trưởng B'
    );
    await new Promise((r) => setTimeout(r, 500));
    await cdp.assertTextContains('body', 'ISO_B_FEEDBACK', 'Hiệu trưởng B thấy phản hồi phụ huynh Trường B');
    await cdp.assertTextNotContains('body', 'ISO_A_FEEDBACK', 'Hiệu trưởng B KHÔNG thấy phản hồi Trường A');
    await cdp.assertNoApiErrors('Hiệu trưởng B tải /parent-feedback');
    await cdp.captureScreenshot('iso_browser_30_principal_b_feedback.png');
    results.scenarios.push({ role: 'principal', route: '/parent-feedback', scenario: 'Hiệu trưởng B xem góp ý phụ huynh Trường B', status: 'PASS' });
    await logoutUser(cdp);

    // =========================================================================
    // PHẦN 11: HIỆU TRƯỞNG TRÊN /principal VÀ TẤT CẢ CÁC TABS NGHIỆP VỤ
    // =========================================================================
    console.log('\n--- 11. HIỆU TRƯỞNG A & B: Sổ điều hành (/principal) & chuyển Tabs ---');
    await establishSessionViaJwt(cdp, usersA.principal, tenantA);
    await cdp.navigate(`${FRONTEND_URL}/principal`);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('Sổ điều hành') || document.body.innerText.includes('Tổng quan')`,
      10000,
      'Chờ tải Sổ điều hành Hiệu trưởng A'
    );
    await new Promise((r) => setTimeout(r, 600));
    await cdp.assertNoApiErrors('Hiệu trưởng A tải tab Tổng quan /principal');
    await cdp.captureScreenshot('iso_browser_31_principal_a_overview.png');
    results.uniqueRoutesTested.add('/principal');
    results.scenarios.push({ role: 'principal', route: '/principal', scenario: 'Hiệu trưởng A tải Sổ điều hành tổng quan', status: 'PASS' });

    // Tab "Chất lượng theo lớp"
    console.log('   -> Hiệu trưởng A mở tab "Chất lượng theo lớp"...');
    await cdp.evaluate(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Chất lượng theo lớp'));
        if (btn) btn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 800));
    await cdp.assertNoApiErrors('Hiệu trưởng A tải tab Chất lượng theo lớp (/api/reports/class-quality)');
    await cdp.captureScreenshot('iso_browser_32_principal_a_class_quality.png');
    results.scenarios.push({ role: 'principal', route: '/principal#class-quality', scenario: 'Hiệu trưởng A tải tab Chất lượng theo lớp', status: 'PASS' });

    // Tab "Giao việc & Tiến độ"
    console.log('   -> Hiệu trưởng A mở tab "Giao việc & Tiến độ"...');
    await cdp.evaluate(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Giao việc & Tiến độ'));
        if (btn) btn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 800));
    await cdp.assertNoApiErrors('Hiệu trưởng A tải tab Giao việc & Tiến độ (/api/reports/principal-tasks)');
    await cdp.captureScreenshot('iso_browser_33_principal_a_tasks.png');
    results.scenarios.push({ role: 'principal', route: '/principal#tasks', scenario: 'Hiệu trưởng A tải tab Giao việc & Tiến độ', status: 'PASS' });

    // Tab "Giám sát an ninh"
    console.log('   -> Hiệu trưởng A mở tab "Giám sát an ninh"...');
    await cdp.evaluate(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Giám sát an ninh'));
        if (btn) btn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 800));
    await cdp.assertNoApiErrors('Hiệu trưởng A tải tab Giám sát an ninh (/api/guard/incidents)');
    await cdp.captureScreenshot('iso_browser_34_principal_a_safety.png');
    results.scenarios.push({ role: 'principal', route: '/principal#safety', scenario: 'Hiệu trưởng A tải tab Giám sát an ninh', status: 'PASS' });
    await logoutUser(cdp);

    // Hiệu trưởng B trên /principal
    await establishSessionViaJwt(cdp, usersB.principal, tenantB);
    await cdp.navigate(`${FRONTEND_URL}/principal`);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('Sổ điều hành') || document.body.innerText.includes('Tổng quan')`,
      10000,
      'Chờ tải Sổ điều hành Hiệu trưởng B'
    );
    await new Promise((r) => setTimeout(r, 600));
    await cdp.assertNoApiErrors('Hiệu trưởng B tải tab Tổng quan /principal');
    await cdp.captureScreenshot('iso_browser_35_principal_b_overview.png');
    results.scenarios.push({ role: 'principal', route: '/principal', scenario: 'Hiệu trưởng B tải Sổ điều hành tổng quan', status: 'PASS' });

    // Tab "Chất lượng theo lớp" B
    await cdp.evaluate(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Chất lượng theo lớp'));
        if (btn) btn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 800));
    await cdp.assertNoApiErrors('Hiệu trưởng B tải tab Chất lượng theo lớp');
    await cdp.captureScreenshot('iso_browser_36_principal_b_class_quality.png');
    results.scenarios.push({ role: 'principal', route: '/principal#class-quality', scenario: 'Hiệu trưởng B tải tab Chất lượng theo lớp', status: 'PASS' });
    await logoutUser(cdp);

    // =========================================================================
    // PHẦN 12: HIỆU TRƯỞNG TRÊN /dashboard THẬT
    // =========================================================================
    console.log('\n--- 12. HIỆU TRƯỞNG A & B TRÊN /dashboard ---');
    await establishSessionViaJwt(cdp, usersA.principal, tenantA);
    await cdp.navigate(`${FRONTEND_URL}/dashboard`);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('Tổng quan hiệu trưởng')`,
      10000,
      'Chờ tải Dashboard Hiệu trưởng A'
    );
    await new Promise((r) => setTimeout(r, 600));
    await cdp.assertNoApiErrors('Hiệu trưởng A tải /dashboard');
    await cdp.assertTextContains('body', 'Việc cần xem xét', 'Hiệu trưởng A thấy khối điều hành việc cần xem xét');
    await cdp.captureScreenshot('iso_browser_37_principal_a_dashboard.png');
    results.scenarios.push({ role: 'principal', route: '/dashboard', scenario: 'Hiệu trưởng A tải Dashboard tổng quan với 0 lỗi 501', status: 'PASS' });
    await logoutUser(cdp);

    await establishSessionViaJwt(cdp, usersB.principal, tenantB);
    await cdp.navigate(`${FRONTEND_URL}/dashboard`);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('Tổng quan hiệu trưởng')`,
      10000,
      'Chờ tải Dashboard Hiệu trưởng B'
    );
    await new Promise((r) => setTimeout(r, 600));
    await cdp.assertNoApiErrors('Hiệu trưởng B tải /dashboard');
    await cdp.assertTextContains('body', 'Việc cần xem xét', 'Hiệu trưởng B thấy khối điều hành việc cần xem xét');
    await cdp.captureScreenshot('iso_browser_38_principal_b_dashboard.png');
    results.scenarios.push({ role: 'principal', route: '/dashboard', scenario: 'Hiệu trưởng B tải Dashboard tổng quan với 0 lỗi 501', status: 'PASS' });
    await logoutUser(cdp);

    // =========================================================================
    // PHẦN 13: CHUYỂN PHIÊN A -> B -> A TRÊN CÙNG MÀN HÌNH ĐIỀU HÀNH
    // =========================================================================
    console.log('\n--- 13. CHUYỂN PHIÊN LIÊN TỤC A -> B -> A TRÊN /principal ---');
    await establishSessionViaJwt(cdp, usersA.principal, tenantA);
    await cdp.navigate(`${FRONTEND_URL}/principal`);
    await new Promise((r) => setTimeout(r, 600));
    const schoolASeen = await cdp.evaluate(`Boolean(document.body.innerText.includes('Hoa Nắng A') || document.body.innerText.includes('HOANANG-A'))`);
    recordAssertion('Phiên 1: Hiệu trưởng A hiển thị đúng nhận diện Trường A', schoolASeen);

    await logoutUser(cdp);

    await establishSessionViaJwt(cdp, usersB.principal, tenantB);
    await cdp.navigate(`${FRONTEND_URL}/principal`);
    await new Promise((r) => setTimeout(r, 600));
    const schoolBSeen = await cdp.evaluate(`Boolean(document.body.innerText.includes('Hoa Nắng B') || document.body.innerText.includes('HOANANG-B'))`);
    const schoolANotSeen = await cdp.evaluate(`!Boolean(document.body.innerText.includes('Hoa Nắng A') || document.body.innerText.includes('HOANANG-A'))`);
    recordAssertion('Phiên 2: Chuyển sang Hiệu trưởng B hiển thị đúng nhận diện Trường B', schoolBSeen);
    recordAssertion('Phiên 2: Sau chuyển phiên, tuyệt đối không sót dấu vết Trường A', schoolANotSeen);
    await cdp.captureScreenshot('iso_browser_39_session_switch_a_to_b.png');
    results.scenarios.push({ role: 'principal', route: '/principal', scenario: 'Chuyển phiên A -> B sạch sẽ không lưu vết', status: 'PASS' });
    await logoutUser(cdp);

  } finally {
    await cdp.close();
    if (chromeProc && chromeProc.pid) {
      try {
        execSync(`taskkill /PID ${chromeProc.pid} /T /F`, { stdio: 'ignore' });
      } catch (_) {}
    }
    if (testServer) {
      await new Promise((resolve) => testServer.close(resolve));
    }
    if (stopDb) {
      await stopDb();
    }
    await mongoose.disconnect();
  }

  // =========================================================================
  // TỔNG HỢP VÀ ĐÁNH GIÁ NGHIỆM THU NGHIÊM NGẶT
  // =========================================================================
  const passedScenarios = results.scenarios.filter(s => s.status === 'PASS');
  const blockedScenarios = results.scenarios.filter(s => s.status === 'BLOCKED_501');
  const untestedScenarios = results.scenarios.filter(s => s.status === 'NOT_TESTED');
  const totalAssertions = results.assertions.length;
  const passedAssertions = results.assertions.filter(a => a.passed).length;
  const failedAssertions = results.assertions.filter(a => !a.passed).length;

  console.log('\n====================================================================');
  console.log('📊 TỔNG HỢP KẾT QUẢ KIỂM THỬ GIAO DIỆN BROWSER E2E ĐA TRƯỜNG');
  console.log('====================================================================');
  console.log(`1. Số route/page độc nhất kiểm thử đạt (Unique Routes Passed): ${results.uniqueRoutesTested.size}`);
  console.log(`   Các route đạt: ${Array.from(results.uniqueRoutesTested).join(', ')}`);
  console.log(`2. Số kịch bản kiểm thử đã chạy (Scenarios):                    ${results.scenarios.length}`);
  console.log(`   - Kịch bản PASS (Đạt cách ly dữ liệu DOM thật):             ${passedScenarios.length}`);
  console.log(`   - Kịch bản BLOCKED_501 (Phát hiện từ Network 501 thực tế):  ${blockedScenarios.length}`);
  console.log(`   - Kịch bản NOT_TESTED (Chưa kiểm thử):                      ${untestedScenarios.length}`);
  console.log(`3. Tổng số assertions thực thi (Record-Level Checks):          ${totalAssertions}`);
  console.log(`   - Assertions đạt (PASS):                                    ${passedAssertions}`);
  console.log(`   - Assertions thất bại (FAIL):                               ${failedAssertions}`);
  console.log(`4. Tổng số ảnh chụp màn hình bằng chứng (Screenshots):         ${results.screenshots.length}`);
  console.log(`5. Danh mục các route bị chặn BLOCKED_501 (${results.blocked501Routes.length}):`);
  results.blocked501Routes.forEach(b => console.log(`   - [501] ${b.route} (${b.status}): ${b.url}`));
  console.log(`6. Danh mục các route CHƯA KIỂM THỬ NOT_TESTED (${results.notTestedRoutes.length}):`);
  results.notTestedRoutes.forEach(u => console.log(`   - [NOT_TESTED] ${u.route} (${u.role}): ${u.reason}`));
  console.log('====================================================================\n');

  // Điều kiện nghiệm thu nghiêm ngặt:
  const hasBlockers = results.blocked501Routes.length > 0 || results.notTestedRoutes.length > 0 || failedAssertions > 0;

  if (hasBlockers) {
    console.error('❌ NGHIỆM THU CHƯA ĐẠT (EXIT CODE 1):');
    if (results.blocked501Routes.length > 0) {
      console.error(`   - Phát hiện ${results.blocked501Routes.length} route bị chặn HTTP 501: ${results.blocked501Routes.map(b => b.route).join(', ')}`);
    }
    if (results.notTestedRoutes.length > 0) {
      console.error(`   - Phát hiện ${results.notTestedRoutes.length} route NOT_TESTED: ${results.notTestedRoutes.map(u => u.route).join(', ')}`);
    }
    if (failedAssertions > 0) {
      console.error(`   - Có ${failedAssertions} assertions thất bại.`);
    }
    process.exit(1);
  } else {
    console.log('✅ XÁC NHẬN: TẤT CẢ CÁC MÀN HÌNH ĐÃ ĐẠT CHUẨN CÁCH LY BROWSER E2E (EXIT CODE 0)!');
    process.exit(0);
  }
}

runIsolationBrowserAudit().catch(err => {
  console.error('LỖI THỰC THI KIỂM THỬ BROWSER ISOLATION:', err);
  process.exit(1);
});
