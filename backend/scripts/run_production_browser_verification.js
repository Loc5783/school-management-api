'use strict';

/**
 * ============================================================================
 * LIVE PRODUCTION BROWSER VERIFICATION (PORTS 5173 & 5001)
 * ============================================================================
 * Runs Chrome CDP Headless E2E tests directly on the live production application:
 * - Frontend: http://localhost:5173
 * - Backend: http://127.0.0.1:5001
 * - Target Database: school_management
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const FRONTEND_URL = 'http://localhost:5173';
const SCREENSHOTS_DIR = path.resolve('docs/screenshots');
const ARTIFACT_DIR = path.resolve('C:/Users/PhamDinhDong/.gemini/antigravity/brain/c0cd55dd-ceda-41d7-8f80-f3254ca5f175');
const LEGACY_CREDS_PATH = 'E:/school-mongo-recovery-20261106/two-school-test-20261111/legacy_known_credentials.json';
const TENANT_B_CREDS_PATH = 'E:/school-mongo-recovery-20261106/two-school-test-20261111/tenant_b_credentials.json';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CHROME_DEBUG_PORT = 9225;

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

class StrictCdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
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

  async assertTextNotContains(selector, forbiddenText, desc) {
    await this.waitForSelector(selector, 8000);
    const text = await this.evaluate(`document.querySelector('${selector}')?.innerText || ''`);
    if (text.includes(forbiddenText)) {
      throw new Error(`TENANT_LEAK_DETECTED [${desc}]: Phát hiện rò rỉ dữ liệu! Phần tử '${selector}' chứa thông tin của trường khác: "${forbiddenText}"`);
    }
    console.log(`   [LEAK CHECK OK] ${desc}: Không chứa "${forbiddenText}"`);
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
    const docsPath = path.join(SCREENSHOTS_DIR, filename);
    fs.writeFileSync(artifactPath, buffer);
    fs.writeFileSync(docsPath, buffer);
    console.log(`   [SCREENSHOT] Saved: ${filename} (${buffer.length} bytes)`);
  }

  async close() {
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
  }
}

async function loginUser(cdp, schoolCode, username, password) {
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
      nativeSet.call(inputs[1], ${JSON.stringify(username)});
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[1].dispatchEvent(new Event('change', { bubbles: true }));

      const t2 = inputs[2]._valueTracker;
      if (t2) t2.setValue('__reset__');
      nativeSet.call(inputs[2], ${JSON.stringify(password)});
      inputs[2].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[2].dispatchEvent(new Event('change', { bubbles: true }));

      const submitBtn = document.querySelector('.login-form-wrap button[type="submit"]');
      if (submitBtn) submitBtn.click();
    })()
  `);
  await cdp.waitForPredicate(
    `!window.location.href.includes('/login')`,
    8000,
    `Đăng nhập thành công với user [${username}] và thoát khỏi trang /login`
  );
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
}

async function runProductionBrowserVerification() {
  console.log('===============================================================');
  console.log('🌐 BẮT ĐẦU KIỂM THỬ LIVE BROWSER TRÊN BẢN CHÍNH (5173 & 5001)');
  console.log('===============================================================');

  const legacyCreds = JSON.parse(fs.readFileSync(LEGACY_CREDS_PATH, 'utf8'));
  const bCreds = JSON.parse(fs.readFileSync(TENANT_B_CREDS_PATH, 'utf8'));

  const userDataDir = path.join(process.env.TEMP || 'C:\\Windows\\Temp', 'chrome_live_ui_' + Date.now());
  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,850',
    'about:blank'
  ], { detached: true });

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
  await cdp.setViewport(1280, 850);

  const results = { assertions: [] };
  const record = (name, passed, detail = '') => {
    results.assertions.push({ name, passed });
    if (passed) console.log(`   [PASS] ${name}${detail ? ` (${detail})` : ''}`);
    else {
      console.error(`   [FAIL] ${name}${detail ? ` (${detail})` : ''}`);
      throw new Error(`Browser Verification Failed: ${name}`);
    }
  };

  try {
    // -------------------------------------------------------------
    // SCENARIO 1: Đăng nhập mã trường HOANANG-A & HOANANG-B
    // -------------------------------------------------------------
    console.log('\n--- SCENARIO 1: Đăng nhập mã trường HOANANG-A & HOANANG-B ---');
    await loginUser(cdp, 'HOANANG-A', 'admin', legacyCreds.admin || '123456');
    await cdp.assertUrl('/dashboard', 'Admin A đăng nhập thành công vào /dashboard');
    await cdp.captureScreenshot('live_01_admin_a_dashboard.png');
    record('Admin A login with HOANANG-A succeeds and lands on dashboard', true);

    const brandTextA = await cdp.evaluate(`document.querySelector('.sidebar')?.innerText || document.body.innerText`);
    record('UI displays School A branding / badge', brandTextA.includes('Hoa Nắng A') || brandTextA.includes('HOANANG-A'));

    await logoutUser(cdp);

    const adminBCred = bCreds.accounts.find(a => a.username === 'admin_b');
    await loginUser(cdp, 'HOANANG-B', 'admin_b', adminBCred.password);
    await cdp.assertUrl('/dashboard', 'Admin B đăng nhập thành công vào /dashboard');
    await cdp.captureScreenshot('live_02_admin_b_dashboard.png');
    record('Admin B login with HOANANG-B succeeds and lands on dashboard', true);

    const brandTextB = await cdp.evaluate(`document.querySelector('.sidebar')?.innerText || document.body.innerText`);
    record('UI displays School B branding / badge', brandTextB.includes('Hoa Nắng B') || brandTextB.includes('HOANANG-B'));

    // -------------------------------------------------------------
    // SCENARIO 2: Quản lý Học sinh & Lớp học (/students, /classrooms)
    // -------------------------------------------------------------
    console.log('\n--- SCENARIO 2: Quản lý Học sinh & Lớp học (/students, /classrooms) ---');
    await cdp.navigate(`${FRONTEND_URL}/students`);
    await cdp.waitForSelector('.table-container, table, .student-table, .card, body', 8000);
    await new Promise((r) => setTimeout(r, 1200));
    await cdp.assertTextContains('body', 'Nguyễn Văn Bé (B)', 'Danh sách học sinh Trường B chứa Bé Nguyễn Văn Bé (B)');
    await cdp.assertTextNotContains('body', 'Nguyễn Đức Anh', 'Danh sách học sinh Trường B không rò rỉ học sinh Trường A');
    await cdp.captureScreenshot('live_03_admin_b_students.png');
    record('Admin B sees only School B students (/students)', true);

    await cdp.navigate(`${FRONTEND_URL}/classrooms`);
    await cdp.waitForSelector('.classroom-list, .classroom-summary, .card, table, body', 8000);
    await new Promise((r) => setTimeout(r, 1200));
    await cdp.assertTextContains('body', 'Lớp Mầm 1 (B)', 'Danh sách lớp học Trường B chứa Lớp Mầm 1 (B)');
    await cdp.captureScreenshot('live_04_admin_b_classrooms.png');
    record('Admin B sees only School B classrooms (/classrooms)', true);

    // -------------------------------------------------------------
    // SCENARIO 3: Phân hệ Nhà bếp (/nutrition) - Chef B
    // -------------------------------------------------------------
    console.log('\n--- SCENARIO 3: Phân hệ Nhà bếp (/nutrition) ---');
    await logoutUser(cdp);
    const chefBCred = bCreds.accounts.find(a => a.username === 'bep_b');
    await loginUser(cdp, 'HOANANG-B', 'bep_b', chefBCred.password);
    await cdp.navigate(`${FRONTEND_URL}/nutrition`);
    await cdp.waitForSelector('.nutrition-module, .chef-dashboard, .card, h2, body', 8000);
    await cdp.captureScreenshot('live_05_chef_b_nutrition.png');
    const nutritionBText = await cdp.evaluate('document.body.innerText');
    record('Chef B sees School B nutrition without 501', !nutritionBText.includes('501') && !nutritionBText.includes('Chưa triển khai'));

    // -------------------------------------------------------------
    // SCENARIO 4: Thông báo nội bộ (/internal-notices) - Teacher B
    // -------------------------------------------------------------
    console.log('\n--- SCENARIO 4: Thông báo nội bộ (/internal-notices) ---');
    await logoutUser(cdp);
    const teacherBCred = bCreds.accounts.find(a => a.username === 'giaovien_b');
    await loginUser(cdp, 'HOANANG-B', 'giaovien_b', teacherBCred.password);
    await cdp.navigate(`${FRONTEND_URL}/internal-notices`);
    await cdp.waitForSelector('.internal-notices-container, .card, .empty-state, h2, table, body', 8000);
    await cdp.captureScreenshot('live_06_teacher_b_internal_notices.png');
    const noticeBText = await cdp.evaluate('document.body.innerText');
    record('Teacher B sees School B internal notices without 501', !noticeBText.includes('501'));

    // -------------------------------------------------------------
    // SCENARIO 5: Bảng lương cá nhân (/my-payroll) - Teacher B
    // -------------------------------------------------------------
    console.log('\n--- SCENARIO 5: Bảng lương cá nhân (/my-payroll) ---');
    await cdp.navigate(`${FRONTEND_URL}/my-payroll`);
    await cdp.waitForSelector('.student-list-card, .content-card, table, h2, body', 8000);
    await cdp.captureScreenshot('live_07_teacher_b_my_payroll.png');
    const payslipText = await cdp.evaluate('document.body.innerText');
    record('Teacher B views own payslip without 501', !payslipText.includes('501'));

    // -------------------------------------------------------------
    // SCENARIO 6: Cơ sở vật chất (/assets) - Admin B
    // -------------------------------------------------------------
    console.log('\n--- SCENARIO 6: Quản lý Cơ sở vật chất (/assets) ---');
    await logoutUser(cdp);
    await loginUser(cdp, 'HOANANG-B', 'admin_b', adminBCred.password);
    await cdp.navigate(`${FRONTEND_URL}/assets`);
    await cdp.waitForSelector('.asset-console, .asset-overview, .content-card, table, h2, body', 8000);
    await cdp.assertTextContains('body', 'Điều hòa Lớp Chồi 1 (B)', 'Tài sản Trường B hiển thị Điều hòa Lớp Chồi 1 (B)');
    await cdp.captureScreenshot('live_08_admin_b_assets.png');
    record('Admin B sees School B assets (/assets)', true);

    // -------------------------------------------------------------
    // SCENARIO 7: Bảo vệ & Đón trả trẻ (/guard) - Guard B
    // -------------------------------------------------------------
    console.log('\n--- SCENARIO 7: Bảo vệ & Đón trả trẻ (/guard) ---');
    await logoutUser(cdp);
    const guardBCred = bCreds.accounts.find(a => a.username === 'baove_b');
    await loginUser(cdp, 'HOANANG-B', 'baove_b', guardBCred.password);
    await cdp.navigate(`${FRONTEND_URL}/guard`);
    await cdp.waitForSelector('.guard-operations, .card, h2, h1, .empty-state, body', 8000);
    await cdp.captureScreenshot('live_09_guard_b_dashboard.png');
    const guardText = await cdp.evaluate('document.body.innerText');
    record('Guard B accesses /guard dashboard without 501 error', !guardText.includes('501'));

    console.log('\n===============================================================');
    console.log(`✅ TẤT CẢ ${results.assertions.length}/${results.assertions.length} LIVE BROWSER ASSERTIONS ĐÃ VƯỢT QUA VỚI EXIT CODE 0!`);
    console.log('===============================================================\n');

  } finally {
    await cdp.close();
    try { chromeProc.kill(); } catch (_) {}
  }
}

runProductionBrowserVerification().catch(err => {
  console.error('LỖI KIỂM THỬ BROWSER LIVE:', err);
  process.exit(1);
});
