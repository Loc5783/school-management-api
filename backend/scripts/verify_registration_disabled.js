'use strict';

/**
 * ============================================================================
 * VERIFICATION SCRIPT: PUBLIC REGISTRATION DISABLED
 * ============================================================================
 * Verifies:
 * 1. Backend API: POST /api/auth/register and GET /api/auth/registration-classrooms
 *    are disabled (HTTP 403 Forbidden). No account created in database.
 * 2. Login flows: HOANANG-A and HOANANG-B login remain 100% operational.
 * 3. Frontend UI (Desktop & Mobile):
 *    - /login: Zero "Đăng ký tại đây" / registration links.
 *    - /register: Direct URL redirects cleanly to /login without blank page.
 *    - Real login on UI succeeds for both schools.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mongoose = require('mongoose');

const FRONTEND_URL = 'http://localhost:5173';
const BACKEND_URL = 'http://127.0.0.1:5001';
const LIVE_DB_URI = 'mongodb://127.0.0.1:27018/school_management?replicaSet=rs0&directConnection=true';
const SCREENSHOTS_DIR = path.resolve('docs/screenshots');
const ARTIFACT_DIR = path.resolve('C:/Users/PhamDinhDong/.gemini/antigravity/brain/c0cd55dd-ceda-41d7-8f80-f3254ca5f175');
const LEGACY_CREDS_PATH = 'E:/school-mongo-recovery-20261106/two-school-test-20261111/legacy_known_credentials.json';
const TENANT_B_CREDS_PATH = 'E:/school-mongo-recovery-20261106/two-school-test-20261111/tenant_b_credentials.json';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CHROME_DEBUG_PORT = 9226;

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

async function verifyAll() {
  console.log('===============================================================');
  console.log('🔒 KIỂM TRA TOÀN DIỆN: VÔ HIỆU HÓA TỰ ĐĂNG KÝ TÀI KHOẢN');
  console.log('===============================================================');

  const results = { assertions: [] };
  const record = (name, passed, detail = '') => {
    results.assertions.push({ name, passed });
    if (passed) console.log(`   [PASS] ${name}${detail ? ` (${detail})` : ''}`);
    else {
      console.error(`   [FAIL] ${name}${detail ? ` (${detail})` : ''}`);
      throw new Error(`Verification Failed: ${name}`);
    }
  };

  // --------------------------------------------------------------------------
  // PHẦN 1: KIỂM TRA BACKEND API (PUBLIC REGISTER PHẢI TRẢ VỀ 403 FORBIDDEN)
  // --------------------------------------------------------------------------
  console.log('\n--- PHẦN 1: Kiểm tra Backend API đăng ký công khai ---');

  // Kết nối DB để kiểm tra không tài khoản nào được tạo
  await mongoose.connect(LIVE_DB_URI);
  const db = mongoose.connection.db;
  const initialUserCount = await db.collection('users').countDocuments();
  console.log(`   [INFO] Số lượng tài khoản hiện có trong DB: ${initialUserCount}`);

  // 1.1 Gọi POST /api/auth/register
  const attemptUsername = 'hacker_attempt_' + Date.now();
  const regRes = await fetch(`${BACKEND_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: attemptUsername,
      password: 'StrongPassword123!',
      profile: { fullName: 'Kẻ Tự Đăng Ký' }
    })
  });
  console.log(`   [API] POST /api/auth/register -> HTTP Status: ${regRes.status}`);
  const regBody = await regRes.json().catch(() => ({}));
  record('POST /api/auth/register returns HTTP 403 Forbidden', regRes.status === 403);
  record('Response message indicates registration is disabled', regBody.message && regBody.message.includes('vô hiệu hóa'));

  // 1.2 Kiểm tra DB: tài khoản chắc chắn KHÔNG được tạo
  const userInDb = await db.collection('users').findOne({ username: attemptUsername });
  record('Zero account created in database from public register call', userInDb === null);
  const afterUserCount = await db.collection('users').countDocuments();
  record('Total users in database unchanged', afterUserCount === initialUserCount);

  // 1.3 Gọi GET /api/auth/registration-classrooms
  const classRes = await fetch(`${BACKEND_URL}/api/auth/registration-classrooms`);
  console.log(`   [API] GET /api/auth/registration-classrooms -> HTTP Status: ${classRes.status}`);
  record('GET /api/auth/registration-classrooms returns HTTP 403 Forbidden', classRes.status === 403);

  // 1.4 Kiểm tra luồng đăng nhập HOANANG-A vẫn 200 OK
  const legacyCreds = JSON.parse(fs.readFileSync(LEGACY_CREDS_PATH, 'utf8'));
  const loginARes = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schoolCode: 'HOANANG-A',
      username: 'admin',
      password: legacyCreds.admin || '123456'
    })
  });
  record('Login HOANANG-A (admin) remains 200 OK', loginARes.status === 200);

  // 1.5 Kiểm tra luồng đăng nhập HOANANG-B vẫn 200 OK
  const bCreds = JSON.parse(fs.readFileSync(TENANT_B_CREDS_PATH, 'utf8'));
  const adminBCred = bCreds.accounts.find(a => a.username === 'admin_b');
  const loginBRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schoolCode: 'HOANANG-B',
      username: 'admin_b',
      password: adminBCred.password
    })
  });
  record('Login HOANANG-B (admin_b) remains 200 OK', loginBRes.status === 200);

  await mongoose.disconnect();

  // --------------------------------------------------------------------------
  // PHẦN 2: KIỂM TRA FRONTEND BROWSER QUA CHROME CDP
  // --------------------------------------------------------------------------
  console.log('\n--- PHẦN 2: Kiểm tra Frontend Browser (Desktop & Mobile) ---');

  const userDataDir = path.join(process.env.TEMP || 'C:\\Windows\\Temp', 'chrome_no_reg_' + Date.now());
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

  try {
    // 2.1 Kiểm tra Desktop View (1280x850) trên /login
    console.log('\n[2.1] Kiểm tra giao diện máy tính /login...');
    await cdp.setViewport(1280, 850);
    await cdp.navigate(`${FRONTEND_URL}/login`);
    await cdp.waitForSelector('.login-form-wrap form');
    await new Promise(r => setTimeout(r, 800));

    // Assert: Form đăng nhập tồn tại đầy đủ 3 trường (mã trường, username, password)
    const inputsCount = await cdp.evaluate(`document.querySelectorAll('.login-form-wrap form input').length`);
    const hasOrgInput = await cdp.evaluate(`!!document.querySelector('input[autoComplete="organization"], input[placeholder*="ANHDUONG"]')`);
    const hasUserInput = await cdp.evaluate(`!!document.querySelector('input[autoComplete="username"]')`);
    const hasPassInput = await cdp.evaluate(`!!document.querySelector('input[autoComplete="current-password"]')`);
    record('Desktop login form has schoolCode, username, and password fields', inputsCount >= 3 && hasOrgInput && hasUserInput && hasPassInput);

    // Assert: Không có text "Đăng ký tại đây" hoặc "Chưa có tài khoản"
    const desktopBodyText = await cdp.evaluate(`document.body.innerText`);
    record('Desktop UI does NOT contain "Đăng ký tại đây"', !desktopBodyText.includes('Đăng ký tại đây'));
    record('Desktop UI does NOT contain "Chưa có tài khoản phụ huynh?"', !desktopBodyText.includes('Chưa có tài khoản phụ huynh?'));

    // Assert: Không có bất kỳ link nào trỏ tới /register
    const hasRegisterLink = await cdp.evaluate(`!!document.querySelector('a[href*="/register"]')`);
    record('Desktop UI has zero links pointing to /register', !hasRegisterLink);

    await cdp.captureScreenshot('no_register_01_desktop_login.png');

    // 2.2 Kiểm tra Mobile View (390x844 - iPhone 12/13/14) trên /login
    console.log('\n[2.2] Kiểm tra giao diện điện thoại /login...');
    await cdp.setViewport(390, 844);
    await cdp.navigate(`${FRONTEND_URL}/login`);
    await cdp.waitForSelector('.login-form-wrap form');
    await new Promise(r => setTimeout(r, 800));

    const mobileBodyText = await cdp.evaluate(`document.body.innerText`);
    record('Mobile UI does NOT contain "Đăng ký tại đây"', !mobileBodyText.includes('Đăng ký tại đây'));
    record('Mobile UI does NOT contain "Chưa có tài khoản phụ huynh?"', !mobileBodyText.includes('Chưa có tài khoản phụ huynh?'));
    const hasRegisterLinkMobile = await cdp.evaluate(`!!document.querySelector('a[href*="/register"]')`);
    record('Mobile UI has zero links pointing to /register', !hasRegisterLinkMobile);

    await cdp.captureScreenshot('no_register_02_mobile_login.png');

    // 2.3 Kiểm tra mở trực tiếp URL /register cũ -> chuyển hướng về /login, không bị trang trắng
    console.log('\n[2.3] Kiểm tra mở trực tiếp URL /register cũ...');
    await cdp.setViewport(1280, 850);
    await cdp.navigate(`${FRONTEND_URL}/register`);
    await new Promise(r => setTimeout(r, 1000));

    const currentUrlAfterRedirect = await cdp.evaluate(`window.location.href`);
    console.log(`   [REDIRECT CHECK] URL sau khi mở /register: ${currentUrlAfterRedirect}`);
    record('Direct visit to /register redirects cleanly to /login', currentUrlAfterRedirect.includes('/login'));

    // Assert: Trang không bị trắng (form đăng nhập hiển thị hoàn chỉnh)
    const isBlank = await cdp.evaluate(`document.body.innerText.trim().length === 0`);
    const hasLoginForm = await cdp.evaluate(`!!document.querySelector('.login-form-wrap form')`);
    record('Redirected page is NOT blank and renders login form', !isBlank && hasLoginForm);

    await cdp.captureScreenshot('no_register_03_redirect_to_login.png');

    // 2.4 Kiểm tra đăng nhập thực tế HOANANG-A trên giao diện
    console.log('\n[2.4] Kiểm tra đăng nhập thực tế HOANANG-A trên UI...');
    await loginUser(cdp, 'HOANANG-A', 'admin', legacyCreds.admin || '123456');
    await cdp.waitForPredicate(`window.location.href.includes('/dashboard')`, 8000, 'Vào /dashboard');
    record('Admin A logs in successfully on live UI', true);
    await cdp.captureScreenshot('no_register_04_admin_a_logged_in.png');

    // 2.5 Kiểm tra đăng xuất và đăng nhập HOANANG-B trên giao diện
    console.log('\n[2.5] Kiểm tra đăng nhập thực tế HOANANG-B trên UI...');
    await logoutUser(cdp);
    await loginUser(cdp, 'HOANANG-B', 'admin_b', adminBCred.password);
    await cdp.waitForPredicate(`window.location.href.includes('/dashboard')`, 8000, 'Vào /dashboard');
    record('Admin B logs in successfully on live UI', true);
    await cdp.captureScreenshot('no_register_05_admin_b_logged_in.png');

    console.log('\n===============================================================');
    console.log(`🎉 TẤT CẢ ${results.assertions.length}/${results.assertions.length} ASSERTIONS ĐÃ VƯỢT QUA VỚI EXIT CODE 0!`);
    console.log('===============================================================\n');

  } finally {
    await cdp.close();
    try { chromeProc.kill(); } catch (_) {}
  }
}

verifyAll().catch(err => {
  console.error('LỖI KIỂM TRA:', err);
  process.exit(1);
});
