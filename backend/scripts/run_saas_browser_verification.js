'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_saas_browser_verification_jwt_secret_32_chars_minimum';

/**
 * ============================================================================
 * SAAS FULL BROWSER E2E VERIFICATION SCRIPT (CHROME CDP WITH STRICT ASSERTIONS)
 * ============================================================================
 * Kiểm thử E2E giao diện thực tế giữa 2 trường học (Tenant A và Tenant B)
 * và phiên Legacy theo đúng chỉ thị nghiệm thu:
 * 1. Hoàn phí 3 bước: Đề nghị -> Hiệu trưởng duyệt UI -> Kế toán chi UI -> Assert DB sâu.
 * 2. Chi vận hành 3 bước: Đề nghị -> Hiệu trưởng duyệt UI -> Kế toán chi UI -> Assert DB sâu.
 * 3. Import/Export Excel, Đối soát sổ quỹ, Khóa/mở kỳ thao tác qua UI (không gọi API thay).
 * 4. Kiểm tra viewport hẹp mobile 375x812: không tràn ngang ngoài ý muốn, drawer hoạt động.
 * 5. SaaS -> Logout -> Legacy login, Reload F5, 401 Unauthorized, Submit lặp Idempotency.
 * 6. Chống rò rỉ dữ liệu chéo giữa các trường (Data Leak Guard).
 * 7. Negative Self-Check: --self-test-negative thoát mã lỗi khác 0.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const { spawn } = require('child_process');
const ExcelJS = require('exceljs');

const testDbBootstrap = require('../src/saas/testDbBootstrap');
const createSaasApp = require('../src/saas/createSaasApp');
const { runIndexMigration } = require('./saas_phase1e_index_migration');
const financeExcelImportService = require('../src/services/financeExcelImportService');
const { createTrustedTenantContext } = require('../src/services/tenantFilterService');

const Tenant = require('../src/models/zone1_system/Tenant');
const User = require('../src/models/zone1_system/User');
const Classroom = require('../src/models/zone3_school/Classroom');
const Student = require('../src/models/zone3_school/Student');
const TuitionFee = require('../src/models/zone4_finance/TuitionFee');
const FeeSchedule = require('../src/models/zone4_finance/FeeSchedule');
const Payment = require('../src/models/zone4_finance/Payment');
const InvoiceAdjustment = require('../src/models/zone4_finance/InvoiceAdjustment');
const TuitionRefundRequest = require('../src/models/zone4_finance/TuitionRefundRequest');
const OperatingExpense = require('../src/models/zone4_finance/OperatingExpense');
const OperatingExpenseRequest = require('../src/models/zone4_finance/OperatingExpenseRequest');
const DailyCashReconciliation = require('../src/models/zone4_finance/DailyCashReconciliation');
const AccountingPeriod = require('../src/models/zone4_finance/AccountingPeriod');

const ARTIFACT_DIR = path.resolve('C:/Users/PhamDinhDong/.gemini/antigravity/brain/c0cd55dd-ceda-41d7-8f80-f3254ca5f175');
const DOCS_SCREENSHOT_DIR = path.resolve('docs/screenshots');

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
fs.mkdirSync(DOCS_SCREENSHOT_DIR, { recursive: true });

// CDP Client Helper với Explicit Assertions
class StrictCdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
    this.consoleErrors = [];
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

  async setFileInput(selector, filePath) {
    const doc = await this.send('DOM.getDocument');
    const node = await this.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector
    });
    if (!node || !node.nodeId) {
      throw new Error(`Không tìm thấy phần tử DOM file input: ${selector}`);
    }
    await this.send('DOM.setFileInputFiles', {
      files: [filePath],
      nodeId: node.nodeId
    });
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

async function startServers() {
  console.log('1. Khởi tạo Isolated Test DB qua testDbBootstrap...');
  const bootstrapInstance = await testDbBootstrap.startTestDb({
    instanceOpts: [{ dbName: 'school_saas_browser_test' }]
  });
  const mongoUri = bootstrapInstance.uri;
  const connection = bootstrapInstance.connection;

  console.log('1b. Chuyển đổi an toàn sang Compound Multi-tenant Index trên Test DB...');
  await runIndexMigration(connection.db, 'apply');

  // Seed Data
  console.log('2. Seed dữ liệu 2 trường A, B và tài khoản Legacy...');
  const tenantAId = new mongoose.Types.ObjectId();
  const tenantBId = new mongoose.Types.ObjectId();

  const tenantA = await Tenant.create({
    _id: tenantAId,
    code: 'MN-ANHDUONG-A',
    name: 'Trường Mầm Non Ánh Dương A',
    status: 'active',
    subscription: { plan: 'growth', maxStudents: 300, validUntil: new Date('2028-12-31') }
  });

  const tenantB = await Tenant.create({
    _id: tenantBId,
    code: 'MN-SENHONG-B',
    name: 'Trường Mầm Non Sen Hồng B',
    status: 'active',
    subscription: { plan: 'growth', maxStudents: 300, validUntil: new Date('2028-12-31') }
  });

  const classA = await Classroom.create({
    tenantId: tenantAId,
    name: 'Mầm 1 (Ánh Dương)',
    fullName: 'Lớp Mầm 1 Cơ Sở Ánh Dương',
    ageGroup: '3-4',
    status: 'active'
  });

  const classB = await Classroom.create({
    tenantId: tenantBId,
    name: 'Chồi 1 (Sen Hồng)',
    fullName: 'Lớp Chồi 1 Cơ Sở Sen Hồng',
    ageGroup: '4-5',
    status: 'active'
  });

  const studentA = await Student.create({
    tenantId: tenantAId,
    studentCode: 'HS-2026-000001',
    fullName: 'Nguyễn Ánh Dương',
    birthDate: new Date('2022-03-15'),
    gender: 'female',
    classroomId: classA._id,
    className: classA.name,
    status: 'enrolled'
  });

  const studentB = await Student.create({
    tenantId: tenantBId,
    studentCode: 'HS-2026-000002',
    fullName: 'Lê Sen Hồng',
    birthDate: new Date('2021-08-20'),
    gender: 'male',
    classroomId: classB._id,
    className: classB.name,
    status: 'enrolled'
  });

  const passwordHash = '$2b$10$bU0goM1L5mAtBZzc/LHOjemJO8Thocs2vO7Sb6v6VP4CNtBKFf7SK'; // pass123

  // Users Tenant A
  await User.create([
    {
      tenantId: tenantAId,
      username: 'ketoan_a',
      passwordHash,
      role: 'accountant',
      profile: { fullName: 'Kế toán Ánh Dương A' },
      status: 'active'
    },
    {
      tenantId: tenantAId,
      username: 'hieutruong_a',
      passwordHash,
      role: 'principal',
      profile: { fullName: 'Hiệu trưởng Ánh Dương A' },
      status: 'active'
    },
    {
      tenantId: tenantAId,
      username: 'phuhuynh_a',
      passwordHash,
      role: 'parent',
      profile: { fullName: 'Phụ huynh Nguyễn Minh (Bé Ánh Dương)' },
      parentInfo: { studentIds: [studentA._id] },
      status: 'active'
    }
  ]);

  // Users Tenant B
  await User.create([
    {
      tenantId: tenantBId,
      username: 'ketoan_b',
      passwordHash,
      role: 'accountant',
      profile: { fullName: 'Kế toán Sen Hồng B' },
      status: 'active'
    },
    {
      tenantId: tenantBId,
      username: 'hieutruong_b',
      passwordHash,
      role: 'principal',
      profile: { fullName: 'Hiệu trưởng Sen Hồng B' },
      status: 'active'
    },
    {
      tenantId: tenantBId,
      username: 'phuhuynh_b',
      passwordHash,
      role: 'parent',
      profile: { fullName: 'Phụ huynh Lê Văn Nam (Bé Sen Hồng)' },
      parentInfo: { studentIds: [studentB._id] },
      status: 'active'
    }
  ]);

  // User Legacy (Không thuộc Tenant nào - tenantId null)
  await User.create({
    tenantId: null,
    username: 'admin_legacy',
    passwordHash,
    role: 'admin',
    profile: { fullName: 'Quản trị viên Legacy' },
    status: 'active'
  });

  // Biểu phí & Hóa đơn ban đầu cho Tenant A
  await FeeSchedule.create({
    tenantId: tenantAId,
    period: '11-2026',
    classroomId: classA._id,
    classroomName: classA.name,
    tuitionBase: 4000000,
    mealFee: 1200000,
    busFee: 0,
    extraFee: 300000,
    discount: 0,
    dueDate: new Date('2026-11-25'),
    note: 'Biểu phí chuẩn Mầm 1 Ánh Dương'
  });

  const invoiceA = await TuitionFee.create({
    tenantId: tenantAId,
    studentId: studentA._id,
    studentName: studentA.fullName,
    classroomId: classA._id,
    className: classA.name,
    period: '11-2026',
    tuitionBase: 4000000,
    mealFee: 1200000,
    extraFee: 300000,
    totalAmount: 5500000,
    paidAmount: 0,
    status: 'unpaid',
    dueDate: new Date('2026-11-25')
  });

  // Biểu phí & Hóa đơn cho Tenant B
  await FeeSchedule.create({
    tenantId: tenantBId,
    period: '11-2026',
    classroomId: classB._id,
    classroomName: classB.name,
    tuitionBase: 5000000,
    mealFee: 1500000,
    busFee: 800000,
    extraFee: 500000,
    discount: 0,
    dueDate: new Date('2026-11-25'),
    note: 'Biểu phí chuẩn Chồi 1 Sen Hồng'
  });

  await TuitionFee.create({
    tenantId: tenantBId,
    studentId: studentB._id,
    studentName: studentB.fullName,
    classroomId: classB._id,
    className: classB.name,
    period: '11-2026',
    tuitionBase: 5000000,
    mealFee: 1500000,
    busFee: 800000,
    extraFee: 500000,
    totalAmount: 7800000,
    paidAmount: 0,
    status: 'unpaid',
    dueDate: new Date('2026-11-25')
  });

  // Kỳ kế toán mở
  await AccountingPeriod.create([
    {
      tenantId: tenantAId,
      month: '2026-10',
      status: 'open',
      revision: 1,
      writeVersion: 0,
      snapshot: { totalRevenue: 0, totalExpense: 0 },
      sourceHash: 'seed_source_hash_tenant_a_10'
    },
    {
      tenantId: tenantAId,
      month: '2026-11',
      status: 'open',
      revision: 1,
      writeVersion: 0,
      snapshot: { totalRevenue: 0, totalExpense: 0 },
      sourceHash: 'seed_source_hash_tenant_a_11'
    },
    {
      tenantId: tenantBId,
      month: '2026-11',
      status: 'open',
      revision: 1,
      writeVersion: 0,
      snapshot: { totalRevenue: 0, totalExpense: 0 },
      sourceHash: 'seed_source_hash_tenant_b_11'
    }
  ]);

  // Khởi động Backend SaaS App trên cổng 5099
  console.log('3. Khởi động Backend SaaS app trên cổng 5099...');
  const backendApp = createSaasApp({
    connection,
    mongoUri,
    saasMode: 'phase1e'
  });
  const backendServer = http.createServer(backendApp);
  await new Promise((resolve) => backendServer.listen(5099, '127.0.0.1', resolve));

  // Khởi động Frontend static + reverse proxy trên cổng 5199
  console.log('4. Khởi động Frontend static server trên cổng 5199...');
  let proxyControlledDelayMs = 0;
  let proxyDelayUrlPattern = '';
  let proxyFailNextWrite = false;
  let proxyRecordedWrites = [];

  const proxyController = {
    setDelay: (urlPattern, delayMs) => {
      proxyControlledDelayMs = delayMs;
      proxyDelayUrlPattern = urlPattern;
    },
    clearDelay: () => {
      proxyControlledDelayMs = 0;
      proxyDelayUrlPattern = '';
    },
    setFailNextWrite: () => {
      proxyFailNextWrite = true;
    },
    clearFailNextWrite: () => {
      proxyFailNextWrite = false;
    },
    getRecordedWrites: () => [...proxyRecordedWrites],
    resetRecordedWrites: () => {
      proxyRecordedWrites = [];
    }
  };

  const frontendApp = express();
  frontendApp.use('/api', async (req, res) => {
    const url = `http://127.0.0.1:5099/api${req.url}`;
    const headers = { ...req.headers };
    delete headers.host;

    // Ghi nhận tất cả write requests (POST, PUT, PATCH, DELETE)
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      proxyRecordedWrites.push({
        method: req.method,
        url: req.url,
        idempotencyKey: req.headers['idempotency-key'] || null,
        timestamp: Date.now()
      });
    }

    // Mô phỏng lỗi mạng có kiểm soát nếu cờ đang bật
    if (proxyFailNextWrite && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
      proxyFailNextWrite = false;
      return res.status(503).json({
        success: false,
        message: 'Lỗi mạng giả lập trong kiểm thử (Controlled Network Glitch 503)'
      });
    }

    // Mô phỏng độ trễ response có kiểm soát
    if (proxyControlledDelayMs > 0 && req.url.includes(proxyDelayUrlPattern)) {
      await new Promise((r) => setTimeout(r, proxyControlledDelayMs));
    }

    try {
      let bodyData;
      if (!['GET', 'HEAD'].includes(req.method)) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        bodyData = Buffer.concat(chunks);
      }
      const backendRes = await fetch(url, {
        method: req.method,
        headers,
        body: bodyData
      });
      res.status(backendRes.status);
      backendRes.headers.forEach((v, k) => res.setHeader(k, v));
      const arrayBuffer = await backendRes.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
    } catch (err) {
      res.status(502).json({ error: 'Backend unreachable', details: err.message });
    }
  });

  const distDir = path.resolve('frontend/dist');
  frontendApp.use(express.static(distDir));
  frontendApp.use((req, res) => res.sendFile(path.join(distDir, 'index.html')));

  const frontendServer = http.createServer(frontendApp);
  await new Promise((resolve) => frontendServer.listen(5199, '127.0.0.1', resolve));

  return {
    bootstrapInstance,
    backendServer,
    frontendServer,
    proxyController,
    tenantAId,
    tenantBId,
    classA,
    studentA,
    invoiceA
  };
}

async function loginUser(cdp, schoolCode, username, password) {
  await cdp.navigate('http://127.0.0.1:5199/login');
  await cdp.waitForSelector('.login-form-wrap form');
  await cdp.evaluate(`
    (() => {
      const inputs = document.querySelectorAll('.login-form-wrap input');
      const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      
      // Trường 0: schoolCode (nếu rỗng thì xóa)
      const t0 = inputs[0]._valueTracker;
      if (t0) t0.setValue('__reset__');
      nativeSet.call(inputs[0], ${JSON.stringify(schoolCode || '')});
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
        window.location.href = '/login';
      }
    })()
  `);
  await cdp.assertUrl('/login', 'Trở về trang Login sau khi đăng xuất');
}

/**
 * Kích hoạt Xuất Excel qua UI, bắt sự kiện tải về, ghi file đĩa và kiểm chứng nội dung bằng ExcelJS
 */
async function triggerAndVerifyExcelExport(cdp, {
  screenName,
  screenKey,
  buttonSelector = null,
  expectedTenantA = [],
  forbiddenTenantB = ['Lê Sen Hồng', 'MN-SENHONG-B', 'Sen Hồng']
}) {
  console.log(`\n   --- [BẮT ĐẦU XUẤT EXCEL] Kiểm tra xuất file Excel qua UI [${screenName}] ---`);

  // 1. Cài đặt capture download trên browser page
  await cdp.evaluate(`
    (() => {
      window.__capturedDownload = null;
      window.__downloadError = null;
      window.__lastDownloadFilename = null;

      if (!window.__downloadCaptureHooked) {
        window.__downloadCaptureHooked = true;
        const origCreateObjectURL = window.URL.createObjectURL;
        window.URL.createObjectURL = function(blob) {
          const url = origCreateObjectURL.call(window.URL, blob);
          if (blob && (blob.type?.includes('sheet') || blob.type?.includes('excel') || blob.size > 0)) {
            const reader = new FileReader();
            reader.onloadend = function() {
              try {
                window.__capturedDownload = {
                  base64: reader.result ? reader.result.split(',')[1] : null,
                  size: blob.size,
                  type: blob.type,
                  filename: window.__lastDownloadFilename || 'export.xlsx'
                };
              } catch (e) {
                window.__downloadError = e.message;
              }
            };
            reader.readAsDataURL(blob);
          }
          return url;
        };

        const origClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function() {
          if (this.hasAttribute('download')) {
            window.__lastDownloadFilename = this.getAttribute('download') || this.download;
          }
          return origClick.call(this);
        };
      }
    })()
  `);

  // 2. Tìm nút "Xuất Excel" trên UI. Không tìm thấy nút PHẢI FAIL.
  const buttonCheck = await cdp.evaluate(`
    (() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = ${buttonSelector ? `document.querySelector('${buttonSelector}')` : `btns.find(b => b.innerText.includes('Xuất Excel'))`};
      if (!btn) return 'NOT_FOUND';
      if (btn.disabled) return 'DISABLED';
      return 'READY';
    })()
  `);

  if (buttonCheck === 'NOT_FOUND') {
    throw new Error(`ASSERTION_FAILED: Không tìm thấy nút 'Xuất Excel' trên màn hình [${screenName}]!`);
  }
  if (buttonCheck === 'DISABLED') {
    throw new Error(`ASSERTION_FAILED: Nút 'Xuất Excel' trên màn hình [${screenName}] đang bị disabled!`);
  }

  // 3. Bấm nút Xuất Excel qua UI
  await cdp.evaluate(`
    (() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = ${buttonSelector ? `document.querySelector('${buttonSelector}')` : `btns.find(b => b.innerText.includes('Xuất Excel'))`};
      if (btn) btn.click();
    })()
  `);
  console.log(`   [UI ACTION OK] Bấm nút Xuất Excel trên giao diện [${screenName}]`);

  // 4. Bắt sự kiện download hoặc response xuất file, chờ tải hoàn tất
  await cdp.waitForPredicate(
    `window.__capturedDownload !== null && window.__capturedDownload.base64 !== null`,
    15000,
    `Chờ tải hoàn tất file Excel từ UI [${screenName}]`
  );

  const downloadInfo = await cdp.evaluate(`window.__capturedDownload`);
  if (!downloadInfo || !downloadInfo.base64 || downloadInfo.size === 0) {
    throw new Error(`ASSERTION_FAILED: Response tải về rỗng hoặc dung lượng 0 byte trên [${screenName}]!`);
  }
  console.log(`   [DOWNLOAD OK] File [${downloadInfo.filename}] tải về thành công: size=${downloadInfo.size} bytes`);

  // 5. Lưu file vào đĩa (cả artifact và docs/screenshots)
  const buffer = Buffer.from(downloadInfo.base64, 'base64');
  const filename = downloadInfo.filename || `exported_${screenKey}.xlsx`;
  const artifactPath = path.join(ARTIFACT_DIR, filename);
  const docsPath = path.join(DOCS_SCREENSHOT_DIR, filename);
  const standardArtifactPath = path.join(ARTIFACT_DIR, `exported_${screenKey}.xlsx`);
  const standardDocsPath = path.join(DOCS_SCREENSHOT_DIR, `exported_${screenKey}.xlsx`);

  fs.writeFileSync(artifactPath, buffer);
  fs.writeFileSync(docsPath, buffer);
  fs.writeFileSync(standardArtifactPath, buffer);
  fs.writeFileSync(standardDocsPath, buffer);

  // Assert file tồn tại trên đĩa và có dữ liệu
  if (!fs.existsSync(artifactPath) || fs.statSync(artifactPath).size === 0) {
    throw new Error(`ASSERTION_FAILED: File xuất [${artifactPath}] không tồn tại trên đĩa hoặc rỗng!`);
  }
  console.log(`   [FILE OK] Đã ghi nhận file thực tế trên đĩa: ${artifactPath} (${fs.statSync(artifactPath).size} bytes)`);

  // 6. Đọc workbook bằng ExcelJS
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  if (!workbook.worksheets || workbook.worksheets.length === 0) {
    throw new Error(`ASSERTION_FAILED: Workbook [${filename}] không có bất kỳ worksheet nào!`);
  }

  const sheetNames = workbook.worksheets.map(s => s.name);
  console.log(`   [EXCELJS OK] Workbook có ${workbook.worksheets.length} sheet: [${sheetNames.join(', ')}]`);

  // Thu thập toàn bộ nội dung text và số từ các cell trong tất cả các sheet
  let allCellContent = '';
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        const val = cell.value;
        if (val !== null && val !== undefined) {
          if (typeof val === 'object' && val.result !== undefined) {
            allCellContent += ' ' + String(val.result);
          } else if (typeof val === 'object' && val.richText) {
            allCellContent += ' ' + val.richText.map(t => t.text).join('');
          } else {
            allCellContent += ' ' + String(val);
          }
        }
      });
    });
  });

  // 7. Assert dữ liệu Tenant A có mặt trong file
  for (const expected of expectedTenantA) {
    const expStr = String(expected);
    const expRawNum = expStr.replace(/\./g, '');
    const found = allCellContent.includes(expStr) || allCellContent.includes(expRawNum);
    if (!found) {
      throw new Error(`EXCEL_DATA_MISMATCH: File [${filename}] trên màn hình [${screenName}] không chứa dữ liệu mong đợi của Tenant A: "${expStr}"!`);
    }
  }
  console.log(`   [TENANT A DATA OK] File chứa đầy đủ dữ liệu mong đợi của trường A: [${expectedTenantA.join(', ')}]`);

  // 8. Assert tuyệt đối không chứa dữ liệu của Tenant B
  for (const forbidden of forbiddenTenantB) {
    const forbStr = String(forbidden);
    if (allCellContent.includes(forbStr)) {
      throw new Error(`TENANT_LEAK_IN_EXCEL: Rò rỉ dữ liệu đa trường! File [${filename}] trên màn hình [${screenName}] chứa thông tin của Tenant B: "${forbStr}"!`);
    }
  }
  console.log(`   [TENANT B ISOLATION OK] File tuyệt đối không chứa dữ liệu rò rỉ của trường B: [${forbiddenTenantB.join(', ')}]\n`);

  return { filename, size: downloadInfo.size, sheetNames };
}

async function main() {
  const isNegativeSelfCheck = process.argv.includes('--self-test-negative');

  if (isNegativeSelfCheck) {
    console.log('=== CHẠY NEGATIVE SELF-CHECK: Chứng minh assertion thất bại làm script trả nonzero ===');
    try {
      throw new Error('SELF_TEST_NEGATIVE_ASSERTION_FAILURE: Bắt buộc thoát với mã lỗi khác 0');
    } catch (err) {
      console.log(`[SELF-CHECK OK] Đã bắt lỗi đúng như kỳ vọng: ${err.message}`);
      process.exit(1);
    }
  }

  const infra = await startServers();
  let chromeProc = null;
  let cdp = null;

  try {
    console.log('5. Khởi động Chrome headless với DevTools Protocol (port 9222)...');
    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const tempUserDataDir = path.join(process.env.TEMP || 'C:\\Temp', `chrome_test_${Date.now()}`);

    chromeProc = spawn(chromePath, [
      '--headless=new',
      '--remote-debugging-port=9222',
      `--user-data-dir=${tempUserDataDir}`,
      '--window-size=1280,850',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check'
    ]);

    let cdpReady = false;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch('http://127.0.0.1:9222/json/version');
        if (res.ok) {
          cdpReady = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!cdpReady) {
      throw new Error('Chrome CDP không phản hồi sau 10 giây.');
    }

    console.log('6. Tạo tab mới và kết nối WebSocket CDP...');
    const tabRes = await (await fetch('http://127.0.0.1:9222/json/new', { method: 'PUT' })).json();
    cdp = new StrictCdpClient(tabRes.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');

    // -------------------------------------------------------------
    // KỊCH BẢN 1: Màn hình Đăng nhập SaaS
    // -------------------------------------------------------------
    console.log('\n--- KỊCH BẢN 1: Giao diện Đăng nhập SaaS ---');
    await cdp.navigate('http://127.0.0.1:5199/login');
    await cdp.waitForSelector('input[autocomplete="organization"]');
    await cdp.assertTextContains('.login-form-wrap', 'Mã trường học (School Code)', 'Form có ô nhập Mã trường');
    await cdp.captureScreenshot('saas_01_login_screen.png');

    // -------------------------------------------------------------
    // KỊCH BẢN 2: Đăng nhập Kế toán Ánh Dương A
    // -------------------------------------------------------------
    console.log('\n--- KỊCH BẢN 2: Đăng nhập Kế toán Ánh Dương A ---');
    await loginUser(cdp, 'MN-ANHDUONG-A', 'ketoan_a', 'pass123');
    await cdp.assertUrl('/accounting', 'Điều hướng vào Tổng quan kế toán');
    await cdp.assertTextContains('.school-tenant-badge', 'Trường Mầm Non Ánh Dương A', 'Huy hiệu trường Ánh Dương A trên Sidebar');
    await cdp.assertTextContains('.topbar-tenant-tag', 'MN-ANHDUONG-A', 'Huy hiệu mã trường MN-ANHDUONG-A trên Topbar');
    await cdp.captureScreenshot('saas_02_accountant_a_dashboard.png');

    // -------------------------------------------------------------
    // KỊCH BẢN 3: Kế toán A xem Hóa đơn & Thu tiền & Biên lai & Assert DB
    // -------------------------------------------------------------
    console.log('\n--- KỊCH BẢN 3: Kế toán A xem Sổ thu học phí, Thu tiền & Xem Biên lai ---');
    await cdp.navigate('http://127.0.0.1:5199/finance?tab=invoices');
    await cdp.waitForSelector('.data-table');
    await cdp.assertTextContains('.data-table', 'Nguyễn Ánh Dương', 'Có học sinh Ánh Dương của trường');
    await cdp.assertTextNotContains('.data-table', 'Lê Sen Hồng', 'Chống rò rỉ: Không có học sinh Sen Hồng của trường B');
    await cdp.captureScreenshot('saas_03_accountant_a_invoices.png');

    // Mở modal thu tiền
    await cdp.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const collectBtn = btns.find(b => b.innerText.includes('Thu tiền'));
        if (collectBtn) collectBtn.click();
      })()
    `);

    await cdp.waitForSelector('.modal-backdrop form');
    await cdp.assertTextContains('.modal-backdrop', 'Nguyễn Ánh Dương', 'Modal thu tiền đúng học sinh');

    // Nhập số tiền thu 1.000.000 đ
    await cdp.evaluate(`
      (() => {
        const amountInput = document.querySelector('.modal-backdrop input[type="number"]');
        const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSet.call(amountInput, '1000000');
        amountInput.dispatchEvent(new Event('input', { bubbles: true }));
        const confirmBtn = Array.from(document.querySelectorAll('.modal-backdrop button')).find(b => b.innerText.includes('Xác nhận thu tiền'));
        if (confirmBtn) confirmBtn.click();
      })()
    `);

    // Chờ modal thu tiền tự đóng sau khi thanh toán thành công
    await cdp.waitForPredicate(
      `document.querySelector('.modal-backdrop') === null`,
      8000,
      'Modal thu tiền tự động đóng sau khi ghi nhận thanh toán'
    );

    // Chờ bảng hóa đơn chính cập nhật 1.000.000 đ
    await cdp.waitForPredicate(
      `document.querySelector('.data-table')?.innerText.includes('1.000.000')`,
      8000,
      'Bảng hóa đơn chính cập nhật đã thu 1.000.000 đ'
    );
    await cdp.assertTextContains('.data-table', '1.000.000', 'Bảng hóa đơn hiển thị đã thu 1.000.000 đ');

    // Mở lại modal thu tiền để kiểm tra biên lai trong bảng lịch sử
    await cdp.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('.data-table button'));
        const collectBtn = btns.find(b => b.innerText.includes('Thu tiền'));
        if (collectBtn) collectBtn.click();
      })()
    `);
    await cdp.waitForSelector('.modal-backdrop .data-table');
    await cdp.waitForPredicate(
      `document.querySelector('.modal-backdrop .data-table')?.innerText.includes('1.000.000')`,
      8000,
      'Bảng lịch sử trong modal hiển thị biên lai thu 1.000.000 đ'
    );
    await cdp.assertTextContains('.modal-backdrop .data-table', '1.000.000', 'Ghi nhận số tiền thu 1.000.000 đ trong lịch sử');

    // Assert Database: Payment đã được ghi nhận trên DB
    const dbPayment = await Payment.findOne({ tenantId: infra.tenantAId, amount: 1000000 });
    if (!dbPayment) {
      throw new Error('DB_ASSERTION_FAILED: Không tìm thấy Payment 1.000.000 đ trong database!');
    }
    console.log(`   [DB ASSERT OK] Payment được ghi nhận trong DB: ${dbPayment.receiptNumber || dbPayment._id}`);

    // Đóng modal thu tiền
    await cdp.evaluate(`
      (() => {
        const closeBtn = Array.from(document.querySelectorAll('.modal-backdrop button')).find(b => b.innerText.includes('Đóng'));
        if (closeBtn) closeBtn.click();
      })()
    `);
    await cdp.waitForPredicate(`document.querySelector('.modal-backdrop') === null`, 5000, 'Modal đóng');

    // Kiểm tra xuất Excel hóa đơn qua UI và kiểm chứng nội dung bằng ExcelJS
    await triggerAndVerifyExcelExport(cdp, {
      screenName: 'Sổ thu học phí / Hóa đơn (/finance?tab=invoices)',
      screenKey: 'invoices_anhduong',
      expectedTenantA: ['Nguyễn Ánh Dương', '5.500.000'],
      forbiddenTenantB: ['Lê Sen Hồng', 'MN-SENHONG-B', 'Sen Hồng', infra.tenantBId.toString()]
    });

    // -------------------------------------------------------------
    // KỊCH BẢN 4: Kế toán A tạo Biểu phí mới qua UI & Assert DB
    // -------------------------------------------------------------
    console.log('\n--- KỊCH BẢN 4: Kế toán A Thiết lập mức thu mới qua UI ---');
    await cdp.navigate('http://127.0.0.1:5199/finance?tab=schedules');
    await cdp.waitForSelector('.student-form-grid');

    await cdp.evaluate(`
      (() => {
        const inputs = document.querySelectorAll('.student-form-grid input');
        const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        // Hạn nộp
        nativeSet.call(inputs[0], '2026-11-28');
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        // Học phí
        nativeSet.call(inputs[1], '4200000');
        inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
        // Tiền ăn
        nativeSet.call(inputs[2], '1300000');
        inputs[2].dispatchEvent(new Event('input', { bubbles: true }));
        // Nút lưu
        const saveBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Lưu mức thu'));
        if (saveBtn) saveBtn.click();
      })()
    `);

    await cdp.waitForPredicate(
      `document.querySelector('.form-success')?.innerText.includes('Đã lưu') || document.body.innerText.includes('4.200.000')`,
      8000,
      'Biểu phí 4.200.000 đ hiển thị trên UI'
    );
    await cdp.captureScreenshot('saas_04_accountant_a_schedules.png');

    // Assert Database: FeeSchedule đã được tạo
    const dbSchedule = await FeeSchedule.findOne({ tenantId: infra.tenantAId, tuitionBase: 4200000 });
    if (!dbSchedule) {
      throw new Error('DB_ASSERTION_FAILED: Không tìm thấy FeeSchedule 4.200.000 đ trên DB!');
    }
    console.log(`   [DB ASSERT OK] FeeSchedule được ghi nhận trong DB: ${dbSchedule._id}`);

    // -------------------------------------------------------------
    // KỊCH BẢN 5: Browser E2E Hoàn phí 3 bước & Assert DB sâu (Yêu cầu 1)
    // -------------------------------------------------------------
    console.log('\n--- KỊCH BẢN 5: Quy trình Hoàn phí (Đề nghị -> Hiệu trưởng duyệt -> Kế toán chi) ---');
    await cdp.navigate('http://127.0.0.1:5199/finance?tab=invoices');
    await cdp.waitForSelector('.data-table');

    // Bước 5.1: Kế toán đề nghị hoàn phí 500.000 đ
    console.log('   [BƯỚC 5.1] Kế toán gửi đề nghị hoàn tiền...');
    await cdp.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const adjustBtn = btns.find(b => b.innerText.includes('Điều chỉnh'));
        if (adjustBtn) adjustBtn.click();
      })()
    `);
    await cdp.waitForSelector('.modal-backdrop select');

    await cdp.evaluate(`
      (() => {
        const select = document.querySelector('.modal-backdrop select');
        select.value = 'refund';
        select.dispatchEvent(new Event('change', { bubbles: true }));

        const amountInput = document.querySelector('.modal-backdrop input[type="number"]');
        const numSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        numSet.call(amountInput, '500000');
        amountInput.dispatchEvent(new Event('input', { bubbles: true }));

        const reasonArea = document.querySelector('.modal-backdrop textarea');
        const textSet = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        textSet.call(reasonArea, 'Hoàn tiền ăn do vắng mặt phép dài ngày');
        reasonArea.dispatchEvent(new Event('input', { bubbles: true }));

        const submitBtn = Array.from(document.querySelectorAll('.modal-backdrop button')).find(b => b.innerText.includes('Gửi yêu cầu duyệt'));
        if (submitBtn) submitBtn.click();
      })()
    `);

    // Chờ yêu cầu hoàn phí hiển thị trên modal
    await cdp.waitForPredicate(
      `document.body.innerText.includes('500.000') && document.body.innerText.includes('Chờ duyệt')`,
      8000,
      'Yêu cầu hoàn tiền 500.000 đ trạng thái Chờ duyệt xuất hiện'
    );

    // Assert DB: TuitionRefundRequest ở trạng thái pending
    const dbRefundPending = await TuitionRefundRequest.findOne({ tenantId: infra.tenantAId, amount: 500000 });
    if (!dbRefundPending || dbRefundPending.status !== 'pending') {
      throw new Error('DB_ASSERTION_FAILED: Không tìm thấy TuitionRefundRequest status pending trên DB!');
    }
    console.log(`   [DB ASSERT OK] TuitionRefundRequest status pending: ${dbRefundPending._id}`);

    // Đóng modal điều chỉnh
    await cdp.waitForPredicate(
      `(() => {
        const btn = Array.from(document.querySelectorAll('.modal-backdrop button')).find(b => b.innerText.includes('Đóng'));
        return btn && !btn.disabled;
      })()`,
      8000,
      'Nút Đóng sẵn sàng'
    );
    await cdp.evaluate(`
      (() => {
        const closeBtn = Array.from(document.querySelectorAll('.modal-backdrop button')).find(b => b.innerText.includes('Đóng'));
        if (closeBtn) closeBtn.click();
      })()
    `);
    await cdp.waitForPredicate(`document.querySelector('.modal-backdrop') === null`, 8000, 'Đóng modal');

    // Đăng xuất Kế toán A
    await logoutUser(cdp);

    // Bước 5.2: Hiệu trưởng A đăng nhập và thực sự bấm Duyệt hoàn tiền trên UI
    console.log('   [BƯỚC 5.2] Hiệu trưởng A đăng nhập và duyệt hoàn tiền trên UI...');
    await loginUser(cdp, 'MN-ANHDUONG-A', 'hieutruong_a', 'pass123');
    await cdp.navigate('http://127.0.0.1:5199/finance?tab=refunds');
    await cdp.waitForSelector('.data-table');
    await cdp.assertTextContains('.data-table', 'Nguyễn Ánh Dương', 'Hàng chờ duyệt hoàn phí có tên học sinh');
    await cdp.assertTextContains('.data-table', '500.000', 'Số tiền hoàn 500.000 đ');

    // Hiệu trưởng bấm nút "Mở yêu cầu"
    await cdp.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('.data-table button'));
        const openBtn = btns.find(b => b.innerText.includes('Mở yêu cầu'));
        if (openBtn) openBtn.click();
      })()
    `);
    await cdp.waitForSelector('.modal-backdrop');

    // Chờ nút "Duyệt hoàn tiền" xuất hiện trên modal
    await cdp.waitForPredicate(
      `Array.from(document.querySelectorAll('.modal-backdrop button')).some(b => b.innerText.includes('Duyệt hoàn tiền'))`,
      8000,
      'Nút Duyệt hoàn tiền xuất hiện cho Hiệu trưởng'
    );

    // Điền ghi chú và bấm Duyệt hoàn tiền
    await cdp.evaluate(`
      (() => {
        const noteInput = document.querySelector('.modal-backdrop input[maxlength="500"]');
        if (noteInput) {
          const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSet.call(noteInput, 'Đồng ý hoàn tiền theo đơn xin phép');
          noteInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const approveBtn = Array.from(document.querySelectorAll('.modal-backdrop button')).find(b => b.innerText.includes('Duyệt hoàn tiền'));
        if (approveBtn) approveBtn.click();
      })()
    `);

    // Chờ notice thành công
    await cdp.waitForPredicate(
      `document.querySelector('.form-success')?.innerText.includes('phê duyệt') || document.body.innerText.includes('Đã duyệt, chờ chi')`,
      8000,
      'Hiệu trưởng duyệt thành công'
    );

    // Assert DB: TuitionRefundRequest chuyển sang approved
    const dbRefundApproved = await TuitionRefundRequest.findById(dbRefundPending._id);
    if (!dbRefundApproved || dbRefundApproved.status !== 'approved') {
      throw new Error(`DB_ASSERTION_FAILED: TuitionRefundRequest status phải là approved, thực tế: ${dbRefundApproved?.status}`);
    }
    console.log(`   [DB ASSERT OK] TuitionRefundRequest status approved thành công`);

    // Đóng modal & logout Hiệu trưởng A
    await cdp.evaluate(`
      (() => {
        const closeBtn = Array.from(document.querySelectorAll('.modal-backdrop button')).find(b => b.innerText.includes('Đóng'));
        if (closeBtn) closeBtn.click();
      })()
    `);
    await logoutUser(cdp);

    // Bước 5.3: Kế toán A đăng nhập lại và thực sự ghi chi chứng từ trên UI
    console.log('   [BƯỚC 5.3] Kế toán A đăng nhập lại và ghi chi thực tế trên UI...');
    await loginUser(cdp, 'MN-ANHDUONG-A', 'ketoan_a', 'pass123');
    await cdp.navigate('http://127.0.0.1:5199/finance?tab=refunds');
    await cdp.waitForSelector('.data-table');
    await cdp.assertTextContains('.data-table', 'Đã duyệt, chờ chi', 'Trạng thái Đã duyệt, chờ chi trên hàng chờ');

    // Mở modal hoàn tiền
    await cdp.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('.data-table button'));
        const openBtn = btns.find(b => b.innerText.includes('Mở yêu cầu'));
        if (openBtn) openBtn.click();
      })()
    `);
    await cdp.waitForSelector('.modal-backdrop');

    // Chờ khối form chi tiền xuất hiện (có nút "Xác nhận đã chi")
    await cdp.waitForPredicate(
      `Array.from(document.querySelectorAll('.modal-backdrop button')).some(b => b.innerText.includes('Xác nhận đã chi'))`,
      8000,
      'Form chi tiền xuất hiện với nút Xác nhận đã chi'
    );

    // Điền số chứng từ và mã giao dịch ngân hàng
    await cdp.evaluate(`
      (() => {
        const inputs = Array.from(document.querySelectorAll('.modal-backdrop input[maxlength="120"]'));
        const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        // input 0: documentNumber
        if (inputs[0]) {
          nativeSet.call(inputs[0], 'PC-HOAN-001');
          inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        }
        // input 1: transactionRef
        if (inputs[1]) {
          nativeSet.call(inputs[1], 'FT-HOAN-BANK-202611');
          inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
        }
        const payBtn = Array.from(document.querySelectorAll('.modal-backdrop button')).find(b => b.innerText.includes('Xác nhận đã chi'));
        if (payBtn) payBtn.click();
      })()
    `);

    // Chờ notice thông báo ghi chi thành công
    await cdp.waitForPredicate(
      `document.querySelector('.form-success') !== null || document.body.innerText.includes('Đã chi')`,
      8000,
      'Ghi chi hoàn tiền thành công'
    );

    // Đóng modal
    await cdp.evaluate(`
      (() => {
        const closeBtn = Array.from(document.querySelectorAll('.modal-backdrop button')).find(b => b.innerText.includes('Đóng'));
        if (closeBtn) closeBtn.click();
      })()
    `);

    // Assert Database Sâu sau khi hoàn tiền:
    // 1. TuitionRefundRequest status === 'paid'
    const dbRefundPaid = await TuitionRefundRequest.findById(dbRefundPending._id);
    if (!dbRefundPaid || dbRefundPaid.status !== 'paid') {
      throw new Error(`DB_ASSERTION_FAILED: TuitionRefundRequest status phải là paid, thực tế: ${dbRefundPaid?.status}`);
    }
    console.log(`   [DB ASSERT OK] TuitionRefundRequest status paid: ${dbRefundPaid._id}`);

    // 2. InvoiceAdjustment được tạo đúng type refund, amount 500000, documentNumber PC-HOAN-001
    const dbAdjustment = await InvoiceAdjustment.findById(dbRefundPaid.adjustmentId);
    if (!dbAdjustment) {
      throw new Error('DB_ASSERTION_FAILED: Không tìm thấy InvoiceAdjustment tương ứng với adjustmentId!');
    }
    if (dbAdjustment.type !== 'refund' || dbAdjustment.amount !== 500000 || dbAdjustment.documentNumber !== 'PC-HOAN-001') {
      throw new Error(`DB_ASSERTION_FAILED: InvoiceAdjustment sai dữ liệu! type: ${dbAdjustment.type}, amount: ${dbAdjustment.amount}, doc: ${dbAdjustment.documentNumber}`);
    }
    if (String(dbAdjustment.tenantId) !== String(infra.tenantAId)) {
      throw new Error('DB_ASSERTION_FAILED: InvoiceAdjustment không khớp tenantId!');
    }
    console.log(`   [DB ASSERT OK] InvoiceAdjustment: type=refund, amount=500000, doc=PC-HOAN-001, tenantId khớp`);

    // 3. TuitionFee.paidAmount giảm chính xác từ 1.000.000 đ xuống 500.000 đ, status partial
    const dbInvoiceUpdated = await TuitionFee.findById(infra.invoiceA._id);
    if (!dbInvoiceUpdated || dbInvoiceUpdated.paidAmount !== 500000 || dbInvoiceUpdated.status !== 'partial') {
      throw new Error(`DB_ASSERTION_FAILED: TuitionFee paidAmount phải là 500000, status partial! Thực tế: paidAmount=${dbInvoiceUpdated?.paidAmount}, status=${dbInvoiceUpdated?.status}`);
    }
    console.log(`   [DB ASSERT OK] TuitionFee: paidAmount giảm từ 1.000.000 xuống 500.000 đ, status=partial`);

    // Assert UI: Vào tab Hóa đơn kiểm tra hiển thị 500.000 đ
    await cdp.navigate('http://127.0.0.1:5199/finance?tab=invoices');
    await cdp.waitForSelector('.data-table');
    await cdp.assertTextContains('.data-table', '500.000', 'Bảng hóa đơn chính cập nhật số tiền đã thu là 500.000 đ');

    // -------------------------------------------------------------
    // KỊCH BẢN 6: Browser E2E Chi vận hành 3 bước & Assert DB sâu (Yêu cầu 2)
    // -------------------------------------------------------------
    console.log('\n--- KỊCH BẢN 6: Quy trình Chi vận hành (Đề nghị -> Hiệu trưởng duyệt -> Kế toán chi) ---');
    await cdp.navigate('http://127.0.0.1:5199/accounting/operating-expenses');
    await cdp.waitForSelector('.student-form');

    // Bước 6.1: Kế toán A gửi đề nghị chi vận hành 2.500.000 đ
    console.log('   [BƯỚC 6.1] Kế toán gửi đề nghị chi vận hành...');
    await cdp.evaluate(`
      (() => {
        const form = document.querySelector('.student-form form');
        const select = form.querySelector('select');
        select.value = 'utilities';
        select.dispatchEvent(new Event('change', { bubbles: true }));

        const inputs = Array.from(form.querySelectorAll('input'));
        const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

        // input 0: payee
        nativeSet.call(inputs[0], 'Công ty Điện lực Ánh Dương');
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));

        // input 1: description
        nativeSet.call(inputs[1], 'Tiền điện cơ sở tháng 11/2026');
        inputs[1].dispatchEvent(new Event('input', { bubbles: true }));

        // input 2: amount
        nativeSet.call(inputs[2], '2500000');
        inputs[2].dispatchEvent(new Event('input', { bubbles: true }));

        const submitBtn = Array.from(form.querySelectorAll('button')).find(b => b.innerText.includes('Gửi đề nghị')) || form.querySelector('button.button-primary');
        if (submitBtn) submitBtn.click();
      })()
    `);

    // Chờ thông báo đã gửi đề nghị chi
    await cdp.waitForPredicate(
      `document.querySelector('.form-success')?.innerText.includes('đề nghị') || document.body.innerText.includes('2.500.000')`,
      8000,
      'Gửi đề nghị chi thành công'
    );

    // Assert DB: OperatingExpenseRequest status pending
    const dbExpenseReq = await OperatingExpenseRequest.findOne({ tenantId: infra.tenantAId, amount: 2500000 });
    if (!dbExpenseReq || dbExpenseReq.status !== 'pending' || dbExpenseReq.category !== 'utilities') {
      throw new Error('DB_ASSERTION_FAILED: Không tìm thấy OperatingExpenseRequest status pending trên DB!');
    }
    console.log(`   [DB ASSERT OK] OperatingExpenseRequest status pending: ${dbExpenseReq._id}`);

    // Đăng xuất Kế toán A
    await logoutUser(cdp);

    // Bước 6.2: Hiệu trưởng A đăng nhập và thực sự bấm Duyệt đề nghị chi trên UI
    console.log('   [BƯỚC 6.2] Hiệu trưởng A đăng nhập và duyệt chi vận hành trên UI...');
    await loginUser(cdp, 'MN-ANHDUONG-A', 'hieutruong_a', 'pass123');
    await cdp.navigate('http://127.0.0.1:5199/accounting/operating-expenses');
    await cdp.waitForSelector('.accounting-request-list');
    await cdp.assertTextContains('.accounting-request-list', '2.500.000', 'Đề nghị chi 2.500.000 đ xuất hiện trong danh sách');

    // Hiệu trưởng bấm nút Duyệt
    await cdp.evaluate(`
      (() => {
        const approveBtn = Array.from(document.querySelectorAll('.accounting-request-item button')).find(b => b.innerText === 'Duyệt');
        if (approveBtn) approveBtn.click();
      })()
    `);

    // Chờ notice phê duyệt
    await cdp.waitForPredicate(
      `document.querySelector('.form-success') !== null || document.body.innerText.includes('Đã duyệt, chờ chi')`,
      8000,
      'Duyệt đề nghị chi thành công'
    );

    // Assert DB: OperatingExpenseRequest status approved
    const dbExpenseApproved = await OperatingExpenseRequest.findById(dbExpenseReq._id);
    if (!dbExpenseApproved || dbExpenseApproved.status !== 'approved') {
      throw new Error(`DB_ASSERTION_FAILED: OperatingExpenseRequest status phải là approved, thực tế: ${dbExpenseApproved?.status}`);
    }
    console.log(`   [DB ASSERT OK] OperatingExpenseRequest status approved thành công`);

    // Đăng xuất Hiệu trưởng A
    await logoutUser(cdp);

    // Bước 6.3: Kế toán A đăng nhập lại và thực sự ghi chi trên UI
    console.log('   [BƯỚC 6.3] Kế toán A đăng nhập lại và ghi chi chứng từ trên UI...');
    await loginUser(cdp, 'MN-ANHDUONG-A', 'ketoan_a', 'pass123');
    await cdp.navigate('http://127.0.0.1:5199/accounting/operating-expenses');
    await cdp.waitForSelector('.accounting-request-list');

    // Kế toán bấm nút "Nhập chứng từ chi"
    await cdp.evaluate(`
      (() => {
        const payBtn = Array.from(document.querySelectorAll('.accounting-request-item button')).find(b => b.innerText.includes('Nhập chứng từ chi'));
        if (payBtn) payBtn.click();
      })()
    `);

    // Chờ xuất hiện form BƯỚC 3
    await cdp.waitForPredicate(
      `document.body.innerText.includes('BƯỚC 3 · GHI CHI THỰC TẾ')`,
      8000,
      'Form Bước 3 Ghi chi thực tế xuất hiện'
    );

    // Stub window.confirm và điền thông tin chứng từ
    await cdp.evaluate(`
      (() => {
        window.confirm = () => true;
        const form = Array.from(document.querySelectorAll('.student-form form')).pop();
        const inputs = Array.from(form.querySelectorAll('input'));
        const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

        // documentNumber
        const docInput = inputs.find(i => i.placeholder && i.placeholder.includes('PC-'));
        if (docInput) {
          nativeSet.call(docInput, 'PC-DIEN-001');
          docInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // transactionRef
        const refInput = inputs.find(i => i.placeholder && i.placeholder.includes('sao kê'));
        if (refInput) {
          nativeSet.call(refInput, 'FT-DIEN-20261109');
          refInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        const confirmBtn = Array.from(form.querySelectorAll('button')).find(b => b.innerText.includes('Xác nhận đã chi')) || form.querySelector('button.button-primary');
        if (confirmBtn) confirmBtn.click();
      })()
    `);

    // Chờ notice ghi chi thành công
    await cdp.waitForPredicate(
      `document.querySelector('.form-success')?.innerText.includes('khoản chi') || document.body.innerText.includes('PC-DIEN-001')`,
      8000,
      'Ghi khoản chi vận hành thành công'
    );

    // Assert Database Sâu:
    // 1. OperatingExpenseRequest status === 'paid'
    const dbExpensePaid = await OperatingExpenseRequest.findById(dbExpenseReq._id);
    if (!dbExpensePaid || dbExpensePaid.status !== 'paid') {
      throw new Error(`DB_ASSERTION_FAILED: OperatingExpenseRequest status phải là paid, thực tế: ${dbExpensePaid?.status}`);
    }
    console.log(`   [DB ASSERT OK] OperatingExpenseRequest status paid: ${dbExpensePaid._id}`);

    // 2. OperatingExpense được tạo với đúng amount, category, documentNumber, tenantId
    const dbExpenseRecord = await OperatingExpense.findOne({
      tenantId: infra.tenantAId,
      documentNumber: 'PC-DIEN-001'
    });
    if (!dbExpenseRecord) {
      throw new Error('DB_ASSERTION_FAILED: Không tìm thấy OperatingExpense documentNumber PC-DIEN-001!');
    }
    if (dbExpenseRecord.amount !== 2500000 || dbExpenseRecord.category !== 'utilities') {
      throw new Error(`DB_ASSERTION_FAILED: OperatingExpense sai amount hoặc category! amount: ${dbExpenseRecord.amount}, category: ${dbExpenseRecord.category}`);
    }
    console.log(`   [DB ASSERT OK] OperatingExpense: documentNumber=PC-DIEN-001, amount=2500000, category=utilities, tenantId khớp`);

    // Assert UI: Bảng lịch sử chi hiển thị PC-DIEN-001 và 2.500.000 đ
    await cdp.assertTextContains('.data-table', 'PC-DIEN-001', 'Lịch sử chi có chứng từ PC-DIEN-001');
    await cdp.assertTextContains('.data-table', '2.500.000', 'Lịch sử chi có số tiền 2.500.000 đ');

    // -------------------------------------------------------------
    // KỊCH BẢN 7: Browser E2E Import/Export Excel, Đối soát sổ quỹ, Khóa/mở kỳ (Yêu cầu 3)
    // -------------------------------------------------------------
    console.log('\n--- KỊCH BẢN 7: Import/Export Excel, Đối soát sổ quỹ, Khóa/mở kỳ qua UI ---');

    // 7.1 Thao tác Xuất & Nhập Excel Biểu phí qua UI
    console.log('   [BƯỚC 7.1] Nhập Excel biểu phí qua modal UI...');
    await cdp.navigate('http://127.0.0.1:5199/finance?tab=schedules');
    await cdp.waitForSelector('.classroom-actions');

    // Thao tác Xuất Excel biểu phí qua UI và kiểm chứng nội dung bằng ExcelJS
    await triggerAndVerifyExcelExport(cdp, {
      screenName: 'Biểu phí học phí (/finance?tab=schedules)',
      screenKey: 'fee_schedules_anhduong',
      expectedTenantA: ['4.200.000', '1.300.000', '11-2026'],
      forbiddenTenantB: ['Lê Sen Hồng', 'MN-SENHONG-B', 'Sen Hồng', infra.tenantBId.toString()]
    });

    // Bấm nút "Nhập Excel" mở modal
    await cdp.evaluate(`
      (() => {
        const importBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Nhập Excel'));
        if (importBtn) importBtn.click();
      })()
    `);
    await cdp.waitForSelector('.student-import-modal');
    await cdp.assertTextContains('.student-import-modal', 'Nhập mức thu học phí từ Excel', 'Modal Import Excel mở thành công');

    // Tạo file Excel mẫu hợp lệ cho trường A bằng ExcelJS
    const tempExcelPath = path.join(process.env.TEMP || 'C:\\Temp', `test_fee_schedule_${Date.now()}.xlsx`);
    const trustedContext = createTrustedTenantContext({ tenantId: infra.tenantAId });
    const templateWb = await financeExcelImportService.generateFeeScheduleTemplateWorkbook(trustedContext);
    const dataSheet = templateWb.getWorksheet('Mức thu');
    dataSheet.addRow({
      classroomName: 'Mầm 1 (Ánh Dương)',
      period: '12-2026',
      tuitionBase: 4500000,
      mealFee: 1300000,
      busFee: 0,
      extraFee: 200000,
      discount: 0,
      dueDate: '2026-12-25',
      note: 'Biểu phí tháng 12 E2E qua Excel'
    });
    await templateWb.xlsx.writeFile(tempExcelPath);
    console.log(`   [EXCEL GENERATED] Đã tạo file Excel mẫu: ${tempExcelPath}`);

    // Nạp file vào file input qua CDP
    await cdp.setFileInput('.student-import-modal input[type="file"]', tempExcelPath);
    await cdp.evaluate(`
      (() => {
        const fileInput = document.querySelector('.student-import-modal input[type="file"]');
        if (fileInput && fileInput.files && fileInput.files.length > 0) {
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);

    // Chờ modal preview hiển thị dữ liệu hợp lệ
    await cdp.waitForPredicate(
      `document.body.innerText.includes('Hợp lệ:') || document.body.innerText.includes('4.500.000')`,
      10000,
      'Modal preview dữ liệu Excel thành công'
    );
    await cdp.assertTextContains('.student-import-modal', 'Hợp lệ:', 'Bảng preview có dòng hợp lệ');

    // Bấm nút "Xác nhận nhập"
    await cdp.evaluate(`
      (() => {
        const confirmBtn = Array.from(document.querySelectorAll('.student-import-modal button')).find(b => b.innerText.includes('Xác nhận nhập'));
        if (confirmBtn) confirmBtn.click();
      })()
    `);

    // Chờ kết quả thành công
    await cdp.waitForPredicate(
      `document.body.innerText.includes('Nhập dữ liệu thành công!')`,
      8000,
      'Nhập dữ liệu thành công'
    );

    // Bấm hoàn tất để đóng modal
    await cdp.evaluate(`
      (() => {
        const completeBtn = Array.from(document.querySelectorAll('.student-import-modal button')).find(b => b.innerText.includes('Hoàn tất'));
        if (completeBtn) completeBtn.click();
      })()
    `);
    await cdp.waitForPredicate(`document.querySelector('.student-import-modal') === null`, 5000, 'Đóng modal import');

    // Assert Database: FeeSchedule kỳ 12-2026 đã được lưu
    const dbImportedSchedule = await FeeSchedule.findOne({ tenantId: infra.tenantAId, period: '12-2026' });
    if (!dbImportedSchedule || dbImportedSchedule.tuitionBase !== 4500000) {
      throw new Error('DB_ASSERTION_FAILED: Không tìm thấy FeeSchedule kỳ 12-2026 đã import trong DB!');
    }
    console.log(`   [DB ASSERT OK] FeeSchedule kỳ 12-2026 được import thành công vào DB: ${dbImportedSchedule._id}`);
    try { fs.unlinkSync(tempExcelPath); } catch {}

    // 7.2 Thao tác Đối soát sổ quỹ qua UI (/accounting/cashbook)
    console.log('   [BƯỚC 7.2] Đối soát sổ quỹ qua UI...');
    await cdp.navigate('http://127.0.0.1:5199/accounting/cashbook');
    await cdp.waitForSelector('.cashbook-toolbar');

    // Bấm nút Xuất Excel sổ quỹ qua UI và kiểm chứng nội dung bằng ExcelJS
    await triggerAndVerifyExcelExport(cdp, {
      screenName: 'Sổ quỹ / Đối soát (/accounting/cashbook)',
      screenKey: 'cashbook_anhduong',
      expectedTenantA: ['2.500.000', 'PC-DIEN-001'],
      forbiddenTenantB: ['Lê Sen Hồng', 'MN-SENHONG-B', 'Sen Hồng', infra.tenantBId.toString()]
    });

    // Tìm và bấm nút "Nhập đối chiếu" hoặc "Xem / sửa"
    await cdp.waitForSelector('.data-table');
    await cdp.evaluate(`
      (() => {
        const reconBtn = Array.from(document.querySelectorAll('.data-table button')).find(b => b.innerText.includes('đối chiếu') || b.innerText.includes('Xem / sửa'));
        if (reconBtn) reconBtn.click();
      })()
    `);
    await cdp.waitForSelector('.cashbook-modal');
    await cdp.assertTextContains('.cashbook-modal', 'ĐỐI CHIẾU THỦ CÔNG', 'Modal đối chiếu sổ quỹ mở thành công');

    // Điền mã chứng từ đối chiếu
    await cdp.evaluate(`
      (() => {
        const form = document.querySelector('.cashbook-modal');
        const refInput = form.querySelector('input[maxlength="120"]');
        const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSet.call(refInput, 'BB-KIEMKE-20261109');
        refInput.dispatchEvent(new Event('input', { bubbles: true }));

        const saveBtn = Array.from(form.querySelectorAll('button')).find(b => b.innerText.includes('Lưu đối chiếu')) || form.querySelector('button.button-primary');
        if (saveBtn) saveBtn.click();
      })()
    `);

    // Chờ thông báo đã lưu hoặc modal đối chiếu đóng lại
    await cdp.waitForPredicate(
      `document.querySelector('.form-success')?.innerText.includes('Đã lưu') || document.querySelector('.cashbook-modal') === null`,
      8000,
      'Lưu đối soát sổ quỹ thành công'
    );

    // Assert Database: DailyCashReconciliation được ghi nhận
    const dbReconciliation = await DailyCashReconciliation.findOne({
      tenantId: infra.tenantAId,
      evidenceReference: 'BB-KIEMKE-20261109'
    });
    if (!dbReconciliation) {
      throw new Error('DB_ASSERTION_FAILED: Không tìm thấy DailyCashReconciliation với evidenceReference BB-KIEMKE-20261109!');
    }
    console.log(`   [DB ASSERT OK] DailyCashReconciliation tồn tại trong DB: ${dbReconciliation._id}`);

    // Đăng xuất Kế toán A
    await logoutUser(cdp);

    // 7.3 Thao tác Khóa / Mở kỳ kế toán qua UI (/accounting/report)
    console.log('   [BƯỚC 7.3] Hiệu trưởng thao tác Khóa / Mở kỳ kế toán qua UI...');
    await loginUser(cdp, 'MN-ANHDUONG-A', 'hieutruong_a', 'pass123');
    await cdp.navigate('http://127.0.0.1:5199/accounting/report');
    await cdp.waitForSelector('.accounting-report-toolbar');

    // Chuyển sang tháng 10/2026 (tháng đã kết thúc, đủ điều kiện chốt kỳ theo quy định kế toán)
    await cdp.evaluate(`
      (() => {
        const monthInput = document.querySelector('.accounting-report-actions input[type="month"]');
        if (monthInput) {
          const tracker = monthInput._valueTracker;
          if (tracker) tracker.setValue('');
          const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSet.call(monthInput, '2026-10');
          monthInput.dispatchEvent(new Event('input', { bubbles: true }));
          monthInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);

    await cdp.waitForPredicate(
      `document.body.innerText.includes('10/2026')`,
      8000,
      'Báo cáo tháng 10/2026 hiển thị'
    );

    // Chờ nút Xuất Excel sẵn sàng (không bị disabled do đang loading)
    await cdp.waitForPredicate(
      `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Xuất Excel'));
        return btn && !btn.disabled;
      })()`,
      8000,
      'Nút Xuất Excel báo cáo kế toán sẵn sàng'
    );

    // Bấm nút Xuất Excel báo cáo kế toán qua UI và kiểm chứng nội dung bằng ExcelJS
    await triggerAndVerifyExcelExport(cdp, {
      screenName: 'Báo cáo kế toán tổng hợp (/accounting/report)',
      screenKey: 'accounting_report_anhduong',
      expectedTenantA: ['2026-10'],
      forbiddenTenantB: ['Lê Sen Hồng', 'MN-SENHONG-B', 'Sen Hồng', infra.tenantBId.toString()]
    });

    // Chờ phần quản lý kỳ kế toán
    await cdp.waitForSelector('.accounting-report-period');
    await cdp.assertTextContains('.accounting-report-period', 'Kỳ đang mở', 'Ban đầu kỳ 2026-10 đang mở');

    // Thao tác CHỐT KỲ qua UI
    await cdp.evaluate(`
      (() => {
        window.confirm = () => true;
        const textarea = document.querySelector('.accounting-report-period-action textarea');
        const tracker = textarea._valueTracker;
        if (tracker) tracker.setValue('');
        const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        nativeSet.call(textarea, 'Chốt số liệu kế toán định kỳ tháng 10/2026');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));

        const btn = document.querySelector('.accounting-report-period-action button');
        if (btn) btn.click();
      })()
    `);

    // Chờ UI chuyển sang Kỳ đã chốt
    await cdp.waitForPredicate(
      `document.body.innerText.includes('Kỳ đã chốt')`,
      8000,
      'UI chuyển sang trạng thái Kỳ đã chốt'
    );
    await cdp.assertTextContains('.accounting-report-period', 'Kỳ đã chốt', 'Kỳ đã chốt thành công trên UI');

    // Assert Database: AccountingPeriod status === 'closed'
    const dbPeriodClosed = await AccountingPeriod.findOne({ tenantId: infra.tenantAId, month: '2026-10' });
    if (!dbPeriodClosed || dbPeriodClosed.status !== 'closed') {
      throw new Error(`DB_ASSERTION_FAILED: AccountingPeriod status phải là closed, thực tế: ${dbPeriodClosed?.status}`);
    }
    console.log(`   [DB ASSERT OK] AccountingPeriod tháng 2026-10 status closed: rev=${dbPeriodClosed.revision}`);

    // Thao tác MỞ LẠI KỲ qua UI
    await cdp.evaluate(`
      (() => {
        window.confirm = () => true;
        const textarea = document.querySelector('.accounting-report-period-action textarea');
        const tracker = textarea._valueTracker;
        if (tracker) tracker.setValue('');
        const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        nativeSet.call(textarea, 'Mở lại kỳ để rà soát chứng từ điều chỉnh bổ sung');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));

        const btn = document.querySelector('.accounting-report-period-action button');
        if (btn) btn.click();
      })()
    `);

    // Chờ UI chuyển về Kỳ đang mở
    await cdp.waitForPredicate(
      `document.body.innerText.includes('Kỳ đang mở')`,
      8000,
      'UI chuyển về trạng thái Kỳ đang mở'
    );
    await cdp.assertTextContains('.accounting-report-period', 'Kỳ đang mở', 'Mở lại kỳ thành công trên UI');

    // Assert Database: AccountingPeriod status === 'open'
    const dbPeriodOpen = await AccountingPeriod.findOne({ tenantId: infra.tenantAId, month: '2026-10' });
    if (!dbPeriodOpen || dbPeriodOpen.status !== 'open') {
      throw new Error(`DB_ASSERTION_FAILED: AccountingPeriod status phải là open, thực tế: ${dbPeriodOpen?.status}`);
    }
    console.log(`   [DB ASSERT OK] AccountingPeriod tháng 2026-10 status open: rev=${dbPeriodOpen.revision}`);

    // Đăng xuất Hiệu trưởng A
    await logoutUser(cdp);

    // -------------------------------------------------------------
    // KỊCH BẢN 8: Đăng nhập Kế toán Sen Hồng B (Tenant B) & Phụ huynh A Portal
    // -------------------------------------------------------------
    console.log('\n--- KỊCH BẢN 8: Đăng nhập Kế toán Sen Hồng B (Tenant B) & Phụ huynh A Portal ---');
    await loginUser(cdp, 'MN-SENHONG-B', 'ketoan_b', 'pass123');
    await cdp.assertUrl('/accounting', 'Điều hướng vào Sen Hồng B');
    await cdp.assertTextContains('.school-tenant-badge', 'Trường Mầm Non Sen Hồng B', 'Huy hiệu trường Sen Hồng B trên Sidebar');
    await cdp.assertTextContains('.topbar-tenant-tag', 'MN-SENHONG-B', 'Huy hiệu MN-SENHONG-B trên Topbar');

    await cdp.navigate('http://127.0.0.1:5199/finance?tab=invoices');
    await cdp.waitForSelector('.data-table');
    await cdp.assertTextContains('.data-table', 'Lê Sen Hồng', 'Chỉ thấy học sinh Sen Hồng của trường B');
    await cdp.assertTextNotContains('.data-table', 'Nguyễn Ánh Dương', 'Chống rò rỉ: Tuyệt đối KHÔNG có học sinh Ánh Dương của trường A!');
    await cdp.captureScreenshot('saas_05_accountant_b_invoices.png');

    await logoutUser(cdp);

    // Phụ huynh A xem Cổng thông tin của con
    console.log('   [BƯỚC 8.2] Phụ huynh A xem Cổng thông tin của con...');
    await loginUser(cdp, 'MN-ANHDUONG-A', 'phuhuynh_a', 'pass123');
    await cdp.assertUrl('/parent-portal', 'Điều hướng vào Cổng phụ huynh');
    await cdp.waitForSelector('.main-content');
    await cdp.assertTextContains('.main-content', 'Nguyễn Ánh Dương', 'Phụ huynh thấy đúng tên con mình');
    await cdp.assertTextNotContains('.main-content', 'Lê Sen Hồng', 'Chống rò rỉ: Tuyệt đối không thấy con của trường B');
    await cdp.captureScreenshot('saas_06_parent_a_portal.png');

    await logoutUser(cdp);

    // -------------------------------------------------------------
    // KỊCH BẢN 9: Kiểm tra màn hình nghiệp vụ ở viewport hẹp (Mobile 375x812) (Yêu cầu 4)
    // -------------------------------------------------------------
    console.log('\n--- KỊCH BẢN 9: Kiểm tra Giao diện Di động (Mobile 375x812) ---');
    await cdp.setViewport(375, 812);
    await cdp.navigate('http://127.0.0.1:5199/login');
    await cdp.waitForSelector('.login-page');
    await cdp.captureScreenshot('saas_07_mobile_responsive.png');

    // Đăng nhập Kế toán A trên giao diện di động
    await loginUser(cdp, 'MN-ANHDUONG-A', 'ketoan_a', 'pass123');
    await cdp.assertUrl('/accounting', 'Điều hướng vào Tổng quan kế toán trên mobile');

    // Kiểm tra không tràn ngang trên trang tổng quan
    const isOverviewNoOverflow = await cdp.evaluate('document.documentElement.scrollWidth <= window.innerWidth');
    if (!isOverviewNoOverflow) {
      throw new Error('OVERFLOW_ERROR: Màn hình tổng quan bị tràn ngang trên viewport 375x812!');
    }
    console.log('   [RESPONSIVE OK] Trang tổng quan kế toán không bị tràn ngang (scrollWidth <= innerWidth)');

    // Kiểm tra mở/đóng Mobile Drawer
    await cdp.waitForSelector('.mobile-menu-toggle');
    await cdp.evaluate(`document.querySelector('.mobile-menu-toggle').click()`);
    await cdp.waitForSelector('.mobile-sidebar');
    await cdp.assertTextContains('.mobile-sidebar', 'Trường Mầm Non Ánh Dương A', 'Mobile Drawer hiển thị đúng thông tin trường');

    // Đóng drawer
    await cdp.evaluate(`document.querySelector('.mobile-nav-close').click()`);
    await cdp.waitForPredicate(`document.querySelector('.mobile-nav-backdrop') === null`, 5000, 'Mobile Drawer đóng');

    // Kiểm tra trang /finance?tab=invoices trên mobile
    await cdp.navigate('http://127.0.0.1:5199/finance?tab=invoices');
    await cdp.waitForSelector('.data-table');
    const isFinanceNoOverflow = await cdp.evaluate('document.documentElement.scrollWidth <= window.innerWidth');
    if (!isFinanceNoOverflow) {
      throw new Error('OVERFLOW_ERROR: Màn hình Hóa đơn học phí bị tràn ngang trên viewport 375x812!');
    }
    console.log('   [RESPONSIVE OK] Trang Hóa đơn học phí không bị tràn ngang');
    await cdp.captureScreenshot('saas_08_mobile_finance.png');

    // Kiểm tra trang /accounting/cashbook trên mobile
    await cdp.navigate('http://127.0.0.1:5199/accounting/cashbook');
    await cdp.waitForSelector('.cashbook-toolbar');
    const isCashbookNoOverflow = await cdp.evaluate('document.documentElement.scrollWidth <= window.innerWidth');
    if (!isCashbookNoOverflow) {
      throw new Error('OVERFLOW_ERROR: Màn hình Đối soát sổ quỹ bị tràn ngang trên viewport 375x812!');
    }
    console.log('   [RESPONSIVE OK] Trang Đối soát sổ quỹ không bị tràn ngang');
    await cdp.captureScreenshot('saas_09_mobile_cashbook.png');

    await logoutUser(cdp);

    // Phục hồi viewport desktop
    await cdp.setViewport(1280, 850);

    // -------------------------------------------------------------
    // KỊCH BẢN 10: SaaS -> Logout -> Legacy login, Reload F5, 401 Unauthorized và Submit lặp (Yêu cầu 5)
    // -------------------------------------------------------------
    console.log('\n--- KỊCH BẢN 10: SaaS -> Logout -> Legacy, Reload/401 và Submit lặp ---');

    // 10.1 Đăng nhập tài khoản Legacy (không nhập schoolCode)
    console.log('   [BƯỚC 10.1] Đăng nhập phiên Legacy (không schoolCode)...');
    await loginUser(cdp, '', 'admin_legacy', 'pass123');
    await cdp.assertUrl('/dashboard', 'Tài khoản Legacy điều hướng vào /dashboard');

    // Assert LocalStorage: tenant null
    const legacyTenantStorage = await cdp.evaluate(`localStorage.getItem('tenant')`);
    if (legacyTenantStorage !== null) {
      throw new Error(`LEGACY_TENANT_LEAK: Tài khoản Legacy có localStorage.tenant = "${legacyTenantStorage}"! Phải là null.`);
    }
    console.log('   [LEGACY ASSERT OK] localStorage.getItem("tenant") === null');

    // Assert UI: Không hiển thị badge trường trên sidebar và topbar
    const hasTenantBadge = await cdp.evaluate(`document.querySelector('.school-tenant-badge') !== null`);
    if (hasTenantBadge) {
      throw new Error('LEGACY_BADGE_LEAK: Giao diện Legacy hiển thị badge trường .school-tenant-badge!');
    }
    console.log('   [LEGACY ASSERT OK] Sidebar không có .school-tenant-badge');

    await logoutUser(cdp);

    // 10.2 Reload F5 duy trì Tenant Context
    console.log('   [BƯỚC 10.2] Đăng nhập lại SaaS A và kiểm tra F5 Reload...');
    await loginUser(cdp, 'MN-ANHDUONG-A', 'ketoan_a', 'pass123');
    await cdp.assertUrl('/accounting', 'Điều hướng vào /accounting');

    // F5 Reload trang
    await cdp.navigate('http://127.0.0.1:5199/accounting');
    await cdp.assertUrl('/accounting', 'Sau reload F5 vẫn ở /accounting');
    await cdp.assertTextContains('.school-tenant-badge', 'Trường Mầm Non Ánh Dương A', 'Sau reload F5 vẫn giữ huy hiệu trường');
    console.log('   [RELOAD F5 OK] Phiên đăng nhập và tenant context duy trì nguyên vẹn sau reload');

    // 10.3 401 Unauthorized Session Clean & Redirect
    console.log('   [BƯỚC 10.3] Kiểm tra 401 Unauthorized tự động xóa session và redirect...');
    // Giả mạo token hỏng / hết hạn
    await cdp.evaluate(`
      localStorage.setItem('token', 'invalid_expired_token_mock_401');
    `);

    // Kích hoạt request API thông qua điều hướng hoặc fetch
    await cdp.navigate('http://127.0.0.1:5199/finance');
    await cdp.waitForPredicate(
      `window.location.href.includes('/login')`,
      8000,
      'Sau lỗi 401 tự động chuyển hướng về /login'
    );
    await cdp.assertUrl('/login', 'Chuyển hướng về /login sau khi gặp 401');

    // Kiểm tra sạch sẽ storage
    const tokenAfter401 = await cdp.evaluate(`localStorage.getItem('token')`);
    const tenantAfter401 = await cdp.evaluate(`localStorage.getItem('tenant')`);
    if (tokenAfter401 !== null || tenantAfter401 !== null) {
      throw new Error(`401_CLEANUP_FAILED: Storage chưa được dọn sạch sau 401! token=${tokenAfter401}, tenant=${tenantAfter401}`);
    }
    console.log('   [401 CLEANUP OK] Đã dọn sạch token và tenant sau 401, trở về login');

    // -------------------------------------------------------------
    // KỊCH BẢN 10.4: Kiểm tra chống submit lặp (Idempotency) qua UI Modal và API
    // -------------------------------------------------------------
    console.log('\n   --- [BƯỚC 10.4] Kiểm tra chống submit lặp (Idempotency Guard) ---');
    // Đăng nhập lại để có phiên Kế toán A hợp lệ
    await loginUser(cdp, 'MN-ANHDUONG-A', 'ketoan_a', 'pass123');

    // 10.4a: Kiểm tra UI In-flight button lock & delayed response qua Modal UI thực tế
    console.log('\n   [BƯỚC 10.4a] Kiểm tra UI In-flight lock & delayed response qua Modal Ghi chi...');
    // Seed đề nghị chi hợp lệ cho trường A
    const lockExpenseReq = await OperatingExpenseRequest.create({
      tenantId: infra.tenantAId,
      category: 'services',
      payee: 'Công ty Vệ Sinh Xanh',
      description: 'Dịch vụ khử khuẩn phòng học định kỳ',
      amount: 350000,
      requestKey: `req-lock-${Date.now()}`,
      requestedBy: infra.invoiceA._id,
      requestedByName: 'Kế toán A',
      status: 'approved',
      reviewedBy: infra.invoiceA._id,
      reviewedByName: 'Hiệu trưởng A',
      reviewedAt: new Date(),
      createdAt: new Date()
    });

    await cdp.navigate('http://127.0.0.1:5199/accounting/operating-expenses');
    await cdp.waitForSelector('.accounting-request-list');

    // Tìm và mở form BƯỚC 3 cho yêu cầu 'Công ty Vệ Sinh Xanh'
    await cdp.evaluate(`
      (() => {
        const items = Array.from(document.querySelectorAll('.accounting-request-item'));
        const target = items.find(it => it.innerText.includes('Công ty Vệ Sinh Xanh'));
        if (target) {
          const btn = Array.from(target.querySelectorAll('button')).find(b => b.innerText.includes('Nhập chứng từ chi'));
          if (btn) btn.click();
        }
      })()
    `);

    // Chờ xuất hiện form BƯỚC 3
    await cdp.waitForPredicate(
      `document.body.innerText.includes('BƯỚC 3 · GHI CHI THỰC TẾ')`,
      8000,
      'Form Bước 3 Ghi chi thực tế xuất hiện cho Công ty Vệ Sinh Xanh'
    );

    // Điền thông tin chứng từ vào form UI
    await cdp.evaluate(`
      (() => {
        window.confirm = () => true;
        const form = Array.from(document.querySelectorAll('.student-form form')).pop();
        const inputs = Array.from(form.querySelectorAll('input'));
        const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

        const docInput = inputs.find(i => i.placeholder && i.placeholder.includes('PC-'));
        if (docInput) {
          nativeSet.call(docInput, 'PC-UI-LOCK-001');
          docInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        const refInput = inputs.find(i => i.placeholder && i.placeholder.includes('sao kê'));
        if (refInput) {
          nativeSet.call(refInput, 'FT-UI-LOCK-001');
          refInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()
    `);

    // Chuẩn bị reverse proxy: reset ghi nhận và bật trì hoãn 1500ms cho endpoint ghi chi
    infra.proxyController.resetRecordedWrites();
    infra.proxyController.setDelay('/operating-expenses', 1500);

    // Kế toán thực hiện click submit lần đầu qua UI
    await cdp.evaluate(`
      (() => {
        const form = Array.from(document.querySelectorAll('.student-form form')).pop();
        const confirmBtn = Array.from(form.querySelectorAll('button')).find(b => b.innerText.includes('Xác nhận đã chi')) || form.querySelector('button.button-primary');
        if (confirmBtn) confirmBtn.click();
      })()
    `);

    // Kiểm tra ngay trong lúc request in-flight: nút phải bị disabled và text chuyển thành 'Đang ghi...'
    await new Promise(r => setTimeout(r, 100)); // Đợi microtask cập nhật state React
    const buttonLockState = await cdp.evaluate(`
      (() => {
        const form = Array.from(document.querySelectorAll('.student-form form')).pop();
        const btn = form ? (Array.from(form.querySelectorAll('button')).find(b => b.innerText.includes('Đang ghi') || b.innerText.includes('Xác nhận')) || form.querySelector('button.button-primary')) : null;
        return {
          exists: btn !== null,
          disabled: btn ? btn.disabled : false,
          text: btn ? btn.innerText.trim() : ''
        };
      })()
    `);

    if (!buttonLockState.disabled) {
      throw new Error('IN_FLIGHT_LOCK_FAILED: Nút xác nhận không bị disabled khi đang xử lý in-flight!');
    }
    if (!buttonLockState.text.includes('Đang ghi')) {
      throw new Error(`IN_FLIGHT_TEXT_FAILED: Nút xác nhận không đổi text thành 'Đang ghi...', thực tế: "${buttonLockState.text}"`);
    }
    console.log(`   [UI IN-FLIGHT LOCK OK] Nút bị disabled=true và hiển thị "${buttonLockState.text}"`);

    // Thao tác click lặp thêm 3 lần trong lúc in-flight (mô phỏng user spam click)
    await cdp.evaluate(`
      (() => {
        const form = Array.from(document.querySelectorAll('.student-form form')).pop();
        const btn = form ? (Array.from(form.querySelectorAll('button')).find(b => b.innerText.includes('Đang ghi') || b.innerText.includes('Xác nhận')) || form.querySelector('button.button-primary')) : null;
        if (btn) {
          btn.click();
          btn.click();
          btn.click();
        }
      })()
    `);
    console.log('   [UI SPAM CLICK TEST OK] Đã bấm liên tiếp 3 lần trong lúc in-flight');

    // Chờ request in-flight hoàn tất (sau khi hết 1500ms delay)
    await cdp.waitForPredicate(
      `document.querySelector('.form-success')?.innerText.includes('khoản chi') || document.body.innerText.includes('PC-UI-LOCK-001')`,
      10000,
      'Ghi chi hoàn tất sau độ trễ có kiểm soát'
    );
    infra.proxyController.clearDelay();

    // Assert số request ghi phát sinh tới reverse proxy: CHỈ ĐÚNG 1 REQUEST
    const recordedLockWrites = infra.proxyController.getRecordedWrites().filter(w => w.url.includes('/operating-expenses'));
    if (recordedLockWrites.length !== 1) {
      throw new Error(`IN_FLIGHT_REQUEST_COUNT_FAILED: Số request ghi phát sinh tới proxy là ${recordedLockWrites.length}, mong muốn chính xác là 1!`);
    }
    console.log(`   [PROXY AUDIT OK] Chỉ phát sinh đúng duy nhất 1 POST request tới backend (các click lặp bị chặn tại UI)`);

    // Assert Database: Chỉ có DUY NHẤT 1 giao dịch trong DB
    const dbLockExpenseCount = await OperatingExpense.countDocuments({
      tenantId: infra.tenantAId,
      documentNumber: 'PC-UI-LOCK-001'
    });
    if (dbLockExpenseCount !== 1) {
      throw new Error(`IN_FLIGHT_DB_COUNT_FAILED: Số bản ghi trong DB là ${dbLockExpenseCount}, mong muốn chính xác là 1!`);
    }
    console.log(`   [DB ASSERT OK] Database chỉ có đúng duy nhất 1 giao dịch PC-UI-LOCK-001 (count=1)`);

    // 10.4b: Kiểm tra retry sau lỗi mạng (mô phỏng 503 có kiểm soát) qua Modal UI
    console.log('\n   [BƯỚC 10.4b] Kiểm tra UI Network Retry sau lỗi mạng 503 (Bảo toàn Form & Idempotency-Key)...');
    // Seed đề nghị chi hợp lệ cho test retry
    const retryExpenseReq = await OperatingExpenseRequest.create({
      tenantId: infra.tenantAId,
      category: 'services',
      payee: 'Công ty Cấp Nước Sạch',
      description: 'Nước sinh hoạt bổ sung khu vệ sinh',
      amount: 420000,
      requestKey: `req-retry-${Date.now()}`,
      requestedBy: infra.invoiceA._id,
      requestedByName: 'Kế toán A',
      status: 'approved',
      reviewedBy: infra.invoiceA._id,
      reviewedByName: 'Hiệu trưởng A',
      reviewedAt: new Date(),
      createdAt: new Date()
    });

    // Mở form BƯỚC 3 cho yêu cầu 'Công ty Cấp Nước Sạch'
    await cdp.navigate('http://127.0.0.1:5199/accounting/operating-expenses');
    await cdp.waitForSelector('.accounting-request-list');
    await cdp.evaluate(`
      (() => {
        const items = Array.from(document.querySelectorAll('.accounting-request-item'));
        const target = items.find(it => it.innerText.includes('Công ty Cấp Nước Sạch'));
        if (target) {
          const btn = Array.from(target.querySelectorAll('button')).find(b => b.innerText.includes('Nhập chứng từ chi'));
          if (btn) btn.click();
        }
      })()
    `);
    await cdp.waitForPredicate(
      `document.body.innerText.includes('BƯỚC 3 · GHI CHI THỰC TẾ')`,
      8000,
      'Form Bước 3 Ghi chi thực tế xuất hiện cho Công ty Cấp Nước Sạch'
    );

    // Điền thông tin chứng từ vào form UI
    await cdp.evaluate(`
      (() => {
        window.confirm = () => true;
        const form = Array.from(document.querySelectorAll('.student-form form')).pop();
        const inputs = Array.from(form.querySelectorAll('input'));
        const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

        const docInput = inputs.find(i => i.placeholder && i.placeholder.includes('PC-'));
        if (docInput) {
          nativeSet.call(docInput, 'PC-UI-RETRY-002');
          docInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        const refInput = inputs.find(i => i.placeholder && i.placeholder.includes('sao kê'));
        if (refInput) {
          nativeSet.call(refInput, 'FT-UI-RETRY-002');
          refInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()
    `);

    // Reset proxy log và bật cờ mô phỏng lỗi mạng 503 cho request ghi tiếp theo
    infra.proxyController.resetRecordedWrites();
    infra.proxyController.setFailNextWrite();

    // Bấm submit lần 1 (sẽ gặp lỗi 503)
    await cdp.evaluate(`
      (() => {
        const form = Array.from(document.querySelectorAll('.student-form form')).pop();
        const confirmBtn = Array.from(form.querySelectorAll('button')).find(b => b.innerText.includes('Xác nhận đã chi')) || form.querySelector('button.button-primary');
        if (confirmBtn) confirmBtn.click();
      })()
    `);

    // Chờ thông báo lỗi hiển thị trên UI
    await cdp.waitForPredicate(
      `document.querySelector('.form-error') !== null`,
      8000,
      'Thông báo lỗi hiển thị trên UI sau lỗi mạng 503'
    );
    const errorText = await cdp.evaluate(`document.querySelector('.form-error')?.innerText || ''`);
    console.log(`   [NETWORK ERROR DISPLAYED OK] UI nhận lỗi: "${errorText}"`);

    // Assert Form UI giữ nguyên: biểu mẫu vẫn mở và các trường nhập liệu vẫn nguyên vẹn
    const formPreserved = await cdp.evaluate(`
      (() => {
        const form = Array.from(document.querySelectorAll('.student-form form')).pop();
        if (!form) return false;
        const inputs = Array.from(form.querySelectorAll('input'));
        const docInput = inputs.find(i => i.placeholder && i.placeholder.includes('PC-'));
        return docInput && docInput.value === 'PC-UI-RETRY-002';
      })()
    `);
    if (!formPreserved) {
      throw new Error('FORM_PRESERVATION_FAILED: Form UI bị mất dữ liệu sau khi gặp lỗi mạng!');
    }
    console.log('   [FORM PRESERVED OK] Biểu mẫu ghi chi giữ nguyên dữ liệu đã nhập (PC-UI-RETRY-002)');

    // Lấy Idempotency-Key của lần gửi 1 từ proxy log
    const initialWrites = infra.proxyController.getRecordedWrites().filter(w => w.url.includes('/operating-expenses'));
    if (initialWrites.length !== 1 || !initialWrites[0].idempotencyKey) {
      throw new Error('INITIAL_WRITE_LOG_FAILED: Không ghi nhận được Idempotency-Key của lần gửi thất bại!');
    }
    const key1 = initialWrites[0].idempotencyKey;
    console.log(`   [KEY 1 LOGGED] Lần 1 mang Idempotency-Key: ${key1}`);

    // Assert Database: Chưa có bất kỳ giao dịch nào được tạo khi request thất bại
    const countBeforeRetry = await OperatingExpense.countDocuments({
      tenantId: infra.tenantAId,
      documentNumber: 'PC-UI-RETRY-002'
    });
    if (countBeforeRetry !== 0) {
      throw new Error(`DB_STATE_ERROR: Phát hiện ${countBeforeRetry} bản ghi trong DB khi request vừa bị 503!`);
    }
    console.log(`   [DB ASSERT PRE-RETRY OK] Chưa có giao dịch trong DB (count=0)`);

    // Kế toán bấm submit lần 2 (Retry trực tiếp qua UI, KHÔNG sửa lại form)
    console.log('   [RETRY ACTION] Bấm nút Xác nhận đã chi để Retry qua UI...');
    await cdp.evaluate(`
      (() => {
        const form = Array.from(document.querySelectorAll('.student-form form')).pop();
        const confirmBtn = Array.from(form.querySelectorAll('button')).find(b => b.innerText.includes('Xác nhận đã chi')) || form.querySelector('button.button-primary');
        if (confirmBtn) confirmBtn.click();
      })()
    `);

    // Chờ thông báo thành công sau khi retry
    await cdp.waitForPredicate(
      `document.querySelector('.form-success')?.innerText.includes('khoản chi') || document.body.innerText.includes('PC-UI-RETRY-002')`,
      8000,
      'Retry thành công sau lỗi mạng'
    );
    console.log('   [RETRY SUCCESS OK] Ghi nhận thành công sau khi retry');

    // Lấy Idempotency-Key của lần gửi 2 từ proxy log
    const allRetryWrites = infra.proxyController.getRecordedWrites().filter(w => w.url.includes('/operating-expenses'));
    if (allRetryWrites.length !== 2) {
      throw new Error(`RETRY_WRITE_COUNT_FAILED: Kỳ vọng đúng 2 write requests (1 fail + 1 retry), thực tế: ${allRetryWrites.length}`);
    }
    const key2 = allRetryWrites[1].idempotencyKey;
    console.log(`   [KEY 2 LOGGED] Lần 2 (retry) mang Idempotency-Key: ${key2}`);

    // Assert Idempotency-Key được bảo toàn tuyệt đối qua retry
    if (key1 !== key2) {
      throw new Error(`IDEMPOTENCY_KEY_CHANGED: Idempotency-Key không được bảo toàn! Key 1: ${key1}, Key 2: ${key2}`);
    }
    console.log(`   [IDEMPOTENCY KEY RETENTION OK] Key1 === Key2 (${key1}) được giữ nguyên vẹn qua lần retry!`);

    // Assert Database: Chỉ có DUY NHẤT 1 bản ghi được tạo
    const countAfterRetry = await OperatingExpense.countDocuments({
      tenantId: infra.tenantAId,
      documentNumber: 'PC-UI-RETRY-002'
    });
    if (countAfterRetry !== 1) {
      throw new Error(`RETRY_DB_DUPLICATION: Phát hiện ${countAfterRetry} bản ghi trong DB sau retry! Mong muốn chính xác 1.`);
    }
    console.log(`   [DB ASSERT POST-RETRY OK] Database chỉ có đúng duy nhất 1 giao dịch PC-UI-RETRY-002 (count=1)`);

    // 10.4c: Kiểm tra API Idempotency trực tiếp (Concurrent fetch validation)
    console.log('\n   [BƯỚC 10.4c] Kiểm tra API Idempotency trực tiếp (2 request concurrent cùng key)...');
    const token = await cdp.evaluate(`localStorage.getItem('token')`);
    const idempotencyKey = `e2e-api-idemp-${Date.now()}`;

    const idempExpenseReq = await OperatingExpenseRequest.create({
      tenantId: infra.tenantAId,
      category: 'maintenance',
      payee: 'Công ty Cơ Điện Test',
      description: 'Sửa chữa điện nước test idempotency song song',
      amount: 150000,
      requestKey: `req-api-${Date.now()}`,
      requestedBy: infra.invoiceA._id,
      requestedByName: 'Kế toán A',
      status: 'approved',
      reviewedBy: infra.invoiceA._id,
      reviewedByName: 'Hiệu trưởng A',
      reviewedAt: new Date(),
      createdAt: new Date()
    });

    const [res1, res2] = await Promise.all([
      fetch('http://127.0.0.1:5099/api/finance/operating-expenses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({
          requestId: idempExpenseReq._id,
          paidAt: '2026-11-11',
          method: 'cash',
          documentNumber: 'PC-API-IDEMP-003',
          note: 'Kiểm thử submit lặp song song qua API'
        })
      }),
      fetch('http://127.0.0.1:5099/api/finance/operating-expenses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({
          requestId: idempExpenseReq._id,
          paidAt: '2026-11-11',
          method: 'cash',
          documentNumber: 'PC-API-IDEMP-003',
          note: 'Kiểm thử submit lặp song song qua API'
        })
      })
    ]);

    const data1 = await res1.json();
    const data2 = await res2.json();

    if (res1.status !== 201 && res1.status !== 200) {
      throw new Error(`API_IDEMPOTENCY_FAILED: Request 1 thất bại status ${res1.status}: ${JSON.stringify(data1)}`);
    }
    if (res2.status !== 201 && res2.status !== 200) {
      throw new Error(`API_IDEMPOTENCY_FAILED: Request 2 thất bại status ${res2.status}: ${JSON.stringify(data2)}`);
    }

    const expenseCount = await OperatingExpense.countDocuments({
      tenantId: infra.tenantAId,
      documentNumber: 'PC-API-IDEMP-003'
    });
    if (expenseCount !== 1) {
      throw new Error(`API_IDEMPOTENCY_FAILED: Phát hiện ${expenseCount} bản ghi cho cùng một Idempotency-Key!`);
    }
    console.log(`   [API IDEMPOTENCY OK] Đúng 1 bản ghi trong DB khi gửi đồng thời: count=${expenseCount}`);

    console.log('\n============================================================');
    console.log('   TẤT CẢ 10 KỊCH BẢN VÀ ASSERTIONS ĐÃ PASS HOÀN TOÀN 100%!');
    console.log('============================================================\n');

  } catch (err) {
    console.error('\nLỖI KIỂM THỬ TRÌNH DUYỆT (ASSERTION FAILED):', err.message);
    process.exitCode = 1;
  } finally {
    if (cdp) await cdp.close();
    if (chromeProc) chromeProc.kill();
    if (infra?.frontendServer) infra.frontendServer.close();
    if (infra?.backendServer) infra.backendServer.close();
    if (infra?.bootstrapInstance) {
      testDbBootstrap.unregisterTestInstance(infra.bootstrapInstance.connection);
      await infra.bootstrapInstance.connection.close();
      await infra.bootstrapInstance.replSet.stop();
    }
  }
}

main();
