# BÁO CÁO NGHIỆM THU VÀ BÀN GIAO TASK 1E.5
# TÍCH HỢP ROUTER TÀI CHÍNH SAAS VÀ NGHIỆM THU PHASE 1E

> **Dự án**: `school-management-api`
> **Giai đoạn**: SaaS Multi-tenant Phase 1E (Tài chính trường học đa trường)
> **Phạm vi task**: Task 1E.5 — Tích hợp router tài chính SaaS, mở cổng `phase1e` có kiểm soát và kiểm chứng toàn diện
> **Trạng thái thực thi**: **HOÀN THÀNH — TOÀN BỘ BACKEND 31/31 SUITES (977/977 TESTS PASS)**

---

## 1. TỔNG QUAN VÀ MỤC TIÊU ĐẠT ĐƯỢC

1. **Kích hoạt SaaS Finance Router trong mode `phase1e`**:
   - Mở chính xác allowlist **51 endpoints tài chính** đã được kiểm chứng cách ly từ các Task 1E.1, 1E.2, 1E.3, 1E.4.
   - Thêm `GET /accounting-summary` vào router báo cáo SaaS (`schoolReportRoutes`).
   - Hỗ trợ đồng thời 2 URL alias: `/api/v1` và `/api` với cùng hành vi nhất quán.
2. **Kế thừa và bảo toàn các phân hệ trước**:
   - Mode `phase1e` kế thừa toàn bộ năng lực của Phase 1B (đọc trường/lớp/học sinh), Phase 1C (chấm công học sinh, chuyển lớp), Phase 1D (nhân sự, tài khoản nội bộ, phân công chủ nhiệm, chấm công giáo viên).
3. **Bảo toàn nguyên tắc Fail-Closed & Gating an ninh**:
   - Mode `phase1d`, `phase1c`, `phase1b`, `phase1a`, unknown mode, typo mode và future modes (`phase1f`, `phase1g`) tiếp tục đóng toàn bộ router tài chính với **HTTP 501 Not Implemented**.
   - Các endpoint tài chính chưa sẵn sàng (chưa SaaS hóa) tiếp tục bị khóa chặn **HTTP 501**:
     - Submodule Bảng lương: `GET /finance/export/payroll` -> HTTP 501.
     - Phân hệ Mua sắm: Toàn bộ `/procurement/*` -> HTTP 501.
     - Phân hệ Báo cáo: Mọi route `/reports/*` ngoài `GET /reports/accounting-summary` -> HTTP 501.
     - Fall-through: Mọi subpath không tồn tại hoặc HTTP method không được cấp phép trong `/finance` (ví dụ `GET /finance/unknown-subroute`, `DELETE /finance/invoices`, `PUT /finance/debts`) đều fall-through về **HTTP 501 Fail-Closed**.
4. **Phân quyền và bảo vệ ranh giới Tenant nghiêm ngặt**:
   - Bắt buộc token trường hợp lệ (`schoolAuthMiddleware`), kiểm tra trạng thái hoạt động của trường (`TENANT_SUSPENDED`), tài khoản người dùng (`USER_INACTIVE`), và phiên làm việc (`SESSION_REVOKED`, `AUTH_VERSION_MISMATCH`).
   - Kiểm tra vai trò (`roleCheck`): Giáo viên bị từ chối 403 khi truy cập tài chính.
   - Phụ huynh chỉ xem học phí và biên lai của con mình (`parentInfo.studentIds`); hoàn toàn không được mở các tuyến hoàn phí `/finance/refund-requests` (HTTP 403).
   - Bảo vệ chống tự duyệt (`Self-Review Protection`): Người lập đề nghị chi hoặc hoàn phí không được tự phê duyệt (HTTP 403).
5. **Kiểm chứng Nội dung Workbook qua HTTP bằng ExcelJS**:
   - Nhận binary buffer trực tiếp từ Supertest và nạp vào `ExcelJS.Workbook`.
   - Template biểu phí và hóa đơn được kiểm tra toàn bộ các sheet (kể cả sheet hướng dẫn, danh mục lớp, danh mục học sinh mẫu): chỉ chứa dữ liệu của Tenant A, tuyệt đối không chứa dữ liệu của Tenant B hay Legacy context.
   - File xuất Excel sổ thu tiền / biên lai kiểm tra số liệu và số tiền thực tế (2.400.000 VNĐ, phương thức tiền mặt), đối soát đúng từng dòng dữ liệu.
6. **Kiểm chứng Luồng Import Thật qua Router**:
   - Sinh file workbook Excel thật bằng ExcelJS trong test.
   - POST preview qua router với multipart `.attach('file', ...)`.
   - POST confirm với `previewToken`, danh sách `rows` và `Idempotency-Key`.
   - Kiểm tra document được tạo trong MongoDB gắn đúng `tenantId`, số tiền, trạng thái (`status: 'unpaid'`).
   - Kiểm tra `AuditLog` lưu lại đúng actor và hành động (`FEE_SCHEDULE_IMPORTED`, `TUITION_INVOICE_IMPORTED`).
   - Idempotency Replay: Gửi lại request cùng key nhận HTTP 200 cached, không tạo thêm bản ghi.
   - Kiểm thử bảo mật: Chặn previewToken chéo tenant (HTTP 403), chặn file chứa học sinh ngoại lai (`canImport: false`), chặn giả mạo tenantId, chặn actor bị khóa giữa preview và confirm (HTTP 401/403, không ghi dở dang).
7. **Độ trung thực của Index Schema và Giới hạn thực tế**:
   - Giữ nguyên 100% index sản phẩm hiện hành; không che giấu giới hạn của unique index toàn cục (`month_1` trên `AccountingPeriod`, `workDate_1` trên `DailyCashReconciliation`).
   - Xung đột toàn cục giữa 2 tenant khi mở/chốt cùng tháng được bẫy thành **HTTP 409 Conflict** có kiểm soát, không làm crash server hay lộ lỗi thô MongoDB.

---

## 2. ALLOWLIST CHI TIẾT 51 ENDPOINTS TÀI CHÍNH ĐƯỢC PHÊ DUYỆT TRONG `phase1e`

Các endpoint được mount tại cả `/api/v1` và `/api`.

| STT | Phương thức | Đường dẫn (relative to `/finance`) | Quyền (Roles) | Middleware & Guards | Handler / Controller |
|---|---|---|---|---|---|
| 1 | `GET` | `/classes` | `admin`, `principal`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `financeController.getFinanceClassrooms` |
| 2 | `GET` | `/fee-schedules` | `admin`, `principal`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `financeController.getFeeSchedules` |
| 3 | `PUT` | `/fee-schedules` | `admin`, `accountant` | `schoolAuthMiddleware`, `roleCheck`, `periodOpen.byPeriod` | `financeController.saveFeeSchedule` |
| 4 | `DELETE` | `/fee-schedules/:id` | `admin`, `accountant` | `schoolAuthMiddleware`, `roleCheck`, `periodOpen.bySchedule` | `financeController.deleteFeeSchedule` |
| 5 | `POST` | `/tuition` | `admin`, `accountant` | `schoolAuthMiddleware`, `roleCheck`, `periodOpen.byPeriod` | `financeController.createTuitionFee` |
| 6 | `POST` | `/tuition/bulk` | `admin`, `accountant` | `schoolAuthMiddleware`, `roleCheck`, `periodOpen.byPeriod` | `financeController.createBulkTuitionFees` |
| 7 | `POST` | `/tuition/bulk/preview` | `admin`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `financeController.previewBulkTuitionFees` |
| 8 | `POST` | `/tuition/bulk/add-item` | `admin`, `accountant` | `schoolAuthMiddleware`, `roleCheck`, `periodOpen.byPeriod` | `financeController.addBulkInvoiceItem` |
| 9 | `POST` | `/payment` | `admin`, `accountant` | `schoolAuthMiddleware`, `roleCheck`, `periodOpen.byInvoice` | `financeController.makePayment` |
| 10 | `GET` | `/tuition/student/:studentId` | `admin`, `principal`, `accountant`, `parent` | `schoolAuthMiddleware`, `roleCheck` | `financeController.getTuitionByStudent` |
| 11 | `GET` | `/tuition/class/:classroomId` | `admin`, `principal`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `financeController.getTuitionByClass` |
| 12 | `GET` | `/invoices` | `admin`, `principal`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `financeController.getInvoices` |
| 13 | `GET` | `/debts` | `admin`, `principal`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `financeController.getDebtReport` |
| 14 | `POST` | `/debts/remind` | `admin`, `principal`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `financeController.sendDebtReminders` |
| 15 | `GET` | `/tuition/:invoiceId/payments` | `admin`, `principal`, `accountant`, `parent` | `schoolAuthMiddleware`, `roleCheck` | `financeController.getPaymentsByInvoice` |
| 16 | `GET` | `/receipt/:paymentId` | `admin`, `principal`, `accountant`, `parent` | `schoolAuthMiddleware`, `roleCheck` | `financeController.getReceipt` |
| 17 | `DELETE` | `/tuition/:id` | `admin` | `schoolAuthMiddleware`, `roleCheck`, `periodOpen.byInvoice` | `financeController.cancelTuitionFee` |
| 18 | `POST` | `/tuition/:id/adjust` | `admin`, `accountant` | `schoolAuthMiddleware`, `roleCheck`, `periodOpen.byInvoice` | `financeController.adjustTuitionFee` |
| 19 | `GET` | `/tuition/:invoiceId/adjustments` | `admin`, `principal`, `accountant`, `parent` | `schoolAuthMiddleware`, `roleCheck` | `financeController.getInvoiceAdjustments` |
| 20 | `GET` | `/refund-requests` | `admin`, `principal`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `tuitionRefundController.listRefundRequests` |
| 21 | `POST` | `/refund-requests` | `admin`, `accountant` | `schoolAuthMiddleware`, `roleCheck`, `periodOpen.byInvoice` | `tuitionRefundController.createRefundRequest` |
| 22 | `PATCH` | `/refund-requests/:id/review` | `admin`, `principal` | `schoolAuthMiddleware`, `roleCheck` | `tuitionRefundController.reviewRefundRequest` |
| 23 | `POST` | `/refund-requests/:id/pay` | `admin`, `accountant` | `schoolAuthMiddleware`, `roleCheck`, `periodOpen.byPaidDate` | `tuitionRefundController.payRefundRequest` |
| 24 | `GET` | `/cashbook` | `admin`, `principal`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `cashbookController.getCashbook` |
| 25 | `PUT` | `/cashbook/reconciliation` | `admin`, `accountant` | `schoolAuthMiddleware`, `roleCheck`, `periodOpen.byWorkDate` | `cashbookController.saveDailyReconciliation` |
| 26 | `GET` | `/accounting-period/:month` | `admin`, `principal`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `accountingPeriodController.getPeriod` |
| 27 | `POST` | `/accounting-period/:month/close` | `admin`, `principal` | `schoolAuthMiddleware`, `roleCheck` | `accountingPeriodController.closePeriod` |
| 28 | `POST` | `/accounting-period/:month/reopen` | `admin`, `principal` | `schoolAuthMiddleware`, `roleCheck` | `accountingPeriodController.reopenPeriod` |
| 29 | `GET` | `/expense-orders` | `admin`, `principal`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `purchaseExpenseController.getOrdersReadyForExpense` |
| 30 | `GET` | `/expenses` | `admin`, `principal`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `purchaseExpenseController.getExpenses` |
| 31 | `POST` | `/expenses` | `admin`, `accountant` | `schoolAuthMiddleware`, `roleCheck`, `periodOpen.byPaidAt` | `purchaseExpenseController.recordExpense` |
| 32 | `GET` | `/procurement-overview` | `admin`, `principal`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `financeController.getAccountingProcurementOverview` |
| 33 | `GET` | `/operating-expenses` | `admin`, `principal`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `operatingExpenseController.getOperatingExpenses` |
| 34 | `GET` | `/operating-expense-requests` | `admin`, `principal`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `operatingExpenseController.listOperatingExpenseRequests` |
| 35 | `POST` | `/operating-expense-requests` | `admin`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `operatingExpenseController.createOperatingExpenseRequest` |
| 36 | `PATCH` | `/operating-expense-requests/:id/review` | `admin`, `principal` | `schoolAuthMiddleware`, `roleCheck` | `operatingExpenseController.reviewOperatingExpenseRequest` |
| 37 | `POST` | `/operating-expenses` | `admin`, `accountant` | `schoolAuthMiddleware`, `roleCheck`, `periodOpen.byPaidAt` | `operatingExpenseController.recordOperatingExpense` |
| 38 | `GET` | `/export/fee-schedules` | `admin`, `principal`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `financeExcelController.exportFeeSchedules` |
| 39 | `GET` | `/export/invoices` | `admin`, `principal`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `financeExcelController.exportInvoices` |
| 40 | `GET` | `/export/debts` | `admin`, `principal`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `financeExcelController.exportDebts` |
| 41 | `GET` | `/export/payments` | `admin`, `principal`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `financeExcelController.exportPayments` |
| 42 | `GET` | `/export/expenses` | `admin`, `principal`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `financeExcelController.exportPurchaseExpenses` |
| 43 | `GET` | `/export/operating-expenses` | `admin`, `principal`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `financeExcelController.exportOperatingExpenses` |
| 44 | `GET` | `/export/cashbook` | `admin`, `principal`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `financeExcelController.exportCashbook` |
| 45 | `GET` | `/export/accounting-report` | `admin`, `principal`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `financeExcelController.exportAccountingReport` |
| 46 | `GET` | `/import/fee-schedules/template` | `admin`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `financeExcelController.getFeeScheduleTemplate` |
| 47 | `POST` | `/import/fee-schedules/preview` | `admin`, `accountant` | `schoolAuthMiddleware`, `roleCheck`, `handleUploadExcel` | `financeExcelController.previewFeeScheduleImport` |
| 48 | `POST` | `/import/fee-schedules/confirm` | `admin`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `financeExcelController.confirmFeeScheduleImport` |
| 49 | `GET` | `/import/invoices/template` | `admin`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `financeExcelController.getInvoiceTemplate` |
| 50 | `POST` | `/import/invoices/preview` | `admin`, `accountant` | `schoolAuthMiddleware`, `roleCheck`, `handleUploadExcel` | `financeExcelController.previewInvoiceImport` |
| 51 | `POST` | `/import/invoices/confirm` | `admin`, `accountant` | `schoolAuthMiddleware`, `roleCheck` | `financeExcelController.confirmInvoiceImport` |

### Tuyến bổ sung trong phân hệ Báo cáo (`schoolReportRoutes.js`)
| STT | Phương thức | Đường dẫn (relative to `/reports`) | Quyền | Handler |
|---|---|---|---|---|
| +1 | `GET` | `/accounting-summary` | `admin`, `principal`, `accountant` | `accountingReportController.getAccountingSummary` |

---

## 3. DANH SÁCH ENDPOINTS TIẾP TỤC ĐÓNG (HTTP 501 FAIL-CLOSED) VÀ LÝ DO

1. **`GET /finance/export/payroll`**:
   - Bị chặn fail-closed 501 ngay đầu `schoolFinanceRoutes.js` thông qua regex/prefix interceptor.
   - *Lý do*: Phân hệ Bảng lương (Payroll) thuộc Zone 2 HR chưa trải qua audit và cô lập đa trường trong Phase 1E.
2. **Toàn bộ Router `/procurement/*`**:
   - Bị chặn fail-closed 501 trong `gatedModules` của `createSaasApp.js`.
   - *Lý do*: Zone 6 Procurement (đề xuất mua sắm, báo giá, nhà cung cấp) chưa hoàn thành audit SaaS.
3. **Các route `/reports/*` khác ngoài `/accounting-summary`**:
   - `/reports/dashboard`, `/reports/finance`, `/reports/principal-work`, `/reports/class-quality` đều trả về HTTP 501.
   - *Lý do*: Chỉ báo cáo kế toán tổng hợp (`accounting-summary`) được cấp phép trong 1E.5. Các báo cáo hoạt động sư phạm và dashboard chung chưa được tách tenant.
4. **Mọi subpath không xác định hoặc HTTP method không được cấp phép trong `/finance`**:
   - Chẳng hạn `GET /api/v1/finance/unknown-subroute-123`, `DELETE /api/v1/finance/invoices`, `PUT /api/finance/debts` đều fall-through về `tenantFeatureGate` (HTTP 501).

---

## 4. MA TRẬN SAAS MODE VÀ TIỀN TỐ ALIAS

| Chế độ (`saasMode`) | Phase 1B (Đọc trường/lớp) | Phase 1C (Điểm danh/Chuyển lớp) | Phase 1D (Nhân sự/Chủ nhiệm/Tính công) | Phase 1E (Tài chính 51 endpoints) | Phân hệ đóng (Payroll/Procurement/Reports khác) |
|---|---|---|---|---|---|
| `phase1e` | **200 OK** | **200 OK** | **200 OK** | **200 OK / 201 Created** | **501 Not Implemented** |
| `phase1d` | 200 OK | 200 OK | 200 OK | **501 Not Implemented** | 501 Not Implemented |
| `phase1c` | 200 OK | 200 OK | 501 Not Implemented | 501 Not Implemented | 501 Not Implemented |
| `phase1b` (Default) | 200 OK | 501 Not Implemented | 501 Not Implemented | 501 Not Implemented | 501 Not Implemented |
| `phase1a` | 501 Not Implemented | 501 Not Implemented | 501 Not Implemented | 501 Not Implemented | 501 Not Implemented |
| Unknown / Typo / Future | 501 Not Implemented | 501 Not Implemented | 501 Not Implemented | 501 Not Implemented | 501 Not Implemented |

- **Tiền tố Alias**: Mọi cấu hình route đều được mount song song tại `/api/v1` và `/api`. Kết quả trả về và xử lý nghiệp vụ tại 2 alias là hoàn toàn tương đương.

---

## 5. DANH SÁCH CÁC FILE SỬA ĐỔI VÀ TẠO MỚI TRONG TASK 1E.5

### Mã nguồn chính (`backend/src/saas/`):
1. **`backend/src/saas/utils/saasMode.js`**:
   - Khai báo hằng `SUPPORTED_FINANCE_MODES = Object.freeze(['phase1e'])`.
   - Bổ sung `phase1e` vào `SUPPORTED_READ_MODES`, `SUPPORTED_WRITE_MODES`, `SUPPORTED_HR_MODES`.
   - Cập nhật comment mô tả rõ `phase1e` là active mode của phân hệ tài chính.
   - Xuất hàm điều kiện `isFinanceAllowed(mode)`.
2. **`backend/src/saas/routes/schoolFinanceRoutes.js`** *(Tạo mới)*:
   - Khai báo 51 endpoints tài chính Zone 4 Finance có đầy đủ `schoolAuthMiddleware`, `roleCheck`, `periodOpen`.
   - Cấu hình Multer memory storage (5MB) kèm `fileFilter` kiểm tra đuôi `.xlsx` và MIME type.
   - Bổ sung middleware `handleUploadExcel` bẫy sạch `LIMIT_FILE_SIZE` và lỗi tệp tin, trả về HTTP 400 JSON kiểm soát không để lộ stack trace.
   - Chặn riêng `/export/payroll` trả về HTTP 501.
   - Catch-all fallback chuyển tiếp request chưa định nghĩa tới `next('router')` để rơi vào `tenantFeatureGate` (HTTP 501).
3. **`backend/src/saas/routes/schoolReportRoutes.js`** *(Tạo mới)*:
   - Khai báo duy nhất route `GET /accounting-summary` cho `admin`, `principal`, `accountant`.
   - Fall-through mọi route báo cáo khác về HTTP 501.
4. **`backend/src/saas/createSaasApp.js`**:
   - Mount `schoolFinanceRoutes` tại `/api/v1/finance` và `/api/finance` khi `isFinanceAllowed(saasMode)` là `true`.
   - Mount `schoolReportRoutes` tại `/api/v1/reports` và `/api/reports` khi `isFinanceAllowed(saasMode)` là `true`.
   - Giữ nguyên cơ chế `gatedModules` chặn 501 cho `finance` và `reports` khi mode không cho phép.

### Bộ kiểm thử (`backend/tests/saas/`):
5. **`backend/tests/saas/phase1e5_integration.test.js`** *(Tạo mới)*:
   - **32 test cases** tích hợp phân thành 5 nhóm:
     - Nhóm A: Mode Gating, Prefixes & Route Aliasing (A.1 -> A.9). Bổ sung A.8 (unknown path/method fall-through 501) và A.9 (đồng nhất alias).
     - Nhóm B: Authentication, RBAC & Tenant Boundary (B.1 -> B.8).
     - Nhóm C: Các luồng nghiệp vụ đại diện qua router thực tế (C.1 -> C.6).
     - Nhóm D: Excel Template, Preview, Confirm & Export Scoping (D.1 -> D.7):
       - D.1: Tải template biểu phí qua HTTP binary Supertest + parse ExcelJS: Kiểm tra toàn bộ sheet (gồm sheet ẩn / nguồn validation), chỉ chứa lớp Tenant A, không chứa Tenant B hay Legacy.
       - D.2: Tải template hóa đơn qua HTTP binary Supertest + parse ExcelJS: Kiểm tra danh mục học sinh mẫu chỉ chứa học sinh Tenant A.
       - D.3: Export sổ thu tiền / biên lai qua HTTP binary Supertest + parse ExcelJS: Kiểm tra dữ liệu và số tiền thực tế (2.400.000 VNĐ), kiểm tra các route export còn lại trong allowlist.
       - D.4: Upload qua Middleware Thật: Bẫy lỗi thiếu file (400), file hỏng (400), file vượt quá 5MB (400 có kiểm soát).
       - D.5: Luồng Import Biểu Phí Thật qua Router: Workbook thật -> POST preview -> POST confirm -> DB check đúng tenant -> Idempotency Replay 200 không duplicate.
       - D.6: Luồng Import Hóa Đơn Thật qua Router: Workbook thật -> POST preview -> POST confirm -> DB check đúng tenant -> Idempotency Replay 200 không duplicate.
       - D.7: Bảo mật Import qua Router: Chặn previewToken chéo tenant (403), chặn file chứa học sinh ngoại lai, chặn giả mạo tenantId, chặn actor bị khóa giữa preview và confirm.
     - Nhóm E: Tính nhất quán, Idempotency Replay & Giới hạn Index (E.1 -> E.2).
6. **Cập nhật các test suite trước để tương thích `phase1e`**:
   - `backend/tests/saas/phase1c4_router.test.js` (test 7.6 cập nhật future modes sang `['phase1f', 'phase1g']`).
   - `backend/tests/saas/phase1d5_integration.test.js` (test A.3 cập nhật future modes sang `['phase1f', 'phase1g']`).
   - `backend/tests/saas/phase1e2_accounting_cash.test.js` (test G.2 cập nhật kiểm tra mode gating `phase1e` mở `/cashbook`).
   - `backend/tests/saas/phase1e3_tuition_fee.test.js` (test G.1 cập nhật kiểm tra mode gating `phase1e` mở biểu phí).
   - `backend/tests/saas/phase1e4_payments_expenses.test.js` (test I.2 cập nhật kiểm tra mode gating `phase1e` mở sổ chi vận hành).

---

## 6. BẰNG CHỨNG KIỂM THỬ THỰC TẾ

Tất cả các lệnh kiểm thử đều được chạy trên MongoDB Replica Set độc lập (`rs0`), không chạm vào database sản phẩm hay runtime đang chạy.

### 6.1. Suite tích hợp Task 1E.5:
```powershell
npm test --prefix backend -- phase1e5 --runInBand --forceExit
```
- **Kết quả**: `PASS tests/saas/phase1e5_integration.test.js`
- **Số lượng test**: **32/32 PASS (100%)**
- **Thời gian**: 10.490 giây
- **Exit code**: `0`
- **Log reference**: Task `task-16854`

### 6.2. Kiểm thử hồi quy các Suite Phase 1E (1E.1 -> 1E.4):
- **1E.4** (`phase1e4_payments_expenses.test.js`): **48/48 PASS** (31.228 s, exit code `0`, log `task-16858`).
- **1E.3** (`phase1e3_tuition_fee.test.js`): **35/35 PASS** (19.707 s, exit code `0`, log `task-16862`).
- **1E.2** (`phase1e2_accounting_cash.test.js`): **33/33 PASS** (13.486 s, exit code `0`, log `task-16866`).
- **1E.1** (`phase1e1_data_boundary.test.js`): **99/99 PASS** (27.834 s, exit code `0`, log `task-16870`).

### 6.3. Kiểm thử hồi quy Phase 1D và Phase 1C:
- **1D.5** (`phase1d5_integration.test.js`): **48/48 PASS** (exit code `0`).
- **1C.4** (`phase1c4_router.test.js`): **63/63 PASS** (exit code `0`).

### 6.4. Kiểm thử toàn bộ Backend (Full Backend Test Suite):
```powershell
npm test --prefix backend -- --runInBand --forceExit
```
- **Tổng kết thực tế**:
  - **Test Suites: 31 passed, 31 total**
  - **Tests: 977 passed, 977 total**
  - **Snapshots: 0 total**
  - **Thời gian**: 612.801 giây
  - **Exit code**: `0`
  - **Log reference**: Task `task-16874`
  - **Chi tiết tiến trình**: Toàn bộ 977 bài kiểm thử (gồm 945 bài của baseline lịch sử + 32 bài tích hợp 1E.5 hoàn thiện) đều xanh 100%.

### 6.5. Kiểm tra định dạng mã nguồn:
```powershell
git diff --check
```
- **Exit code**: `0` (Không có cảnh báo trailing whitespace hay lỗi xung đột dòng).

---

## 7. GIỚI HẠN INDEX VÀ CẢNH BÁO TRIỂN KHAI PRODUCTION

> [!WARNING]
> **Hạn chế về Index Sản phẩm Hiện hành**:
> 1. Hiện tại, schema sản phẩm vẫn duy trì các index unique toàn cục kế thừa từ kiến trúc Single-tenant:
>    - `AccountingPeriod.index({ month: 1 }, { unique: true })`
>    - `DailyCashReconciliation.index({ workDate: 1 }, { unique: true })`
>    - `OperatingExpenseRequest.index({ requestKey: 1 }, { unique: true })`
>    - `FeeSchedule.index({ period: 1, classroomId: 1 }, { unique: true })`
> 2. **Hành vi được kiểm chứng**: Nếu hai trường đồng thời thao tác trên cùng một tháng hoặc ngày làm việc, trường thao tác sau sẽ nhận mã lỗi **HTTP 409 Conflict** có thông báo nghiệp vụ rõ ràng (do vi phạm E11000). Hệ thống không bị sập hay trả lỗi 500.
> 3. **Khuyến cáo**: Không được tuyên bố sẵn sàng triển khai Production cho nhiều trường dùng chung trong cùng kỳ hoạt động cho tới khi kế hoạch Migration Index cơ sở dữ liệu (`docs/SAAS-PHASE-1E-INDEX-DECISIONS.md`) được phê duyệt và thực hiện trên database thật.

---

## 8. CHECKLIST HẠNG MỤC CÒN LẠI SAU PHASE 1E

- [ ] **Thực hiện Kế hoạch Migration Index**: Lập script migration loại bỏ unique index toàn cục và thay bằng compound index có `tenantId` cho 10 bảng Zone 4 Finance.
- [ ] **Giao diện Người dùng (Frontend/UI)**: Tích hợp giao diện quản lý thu/chi, học phí, sổ quỹ và biên lai vào ứng dụng Web React (`frontend/`).
- [ ] **Kiểm thử E2E Trình duyệt**: Thiết lập kịch bản kiểm thử End-to-End browser giả lập hành vi phụ huynh và kế toán trên giao diện người dùng.
- [ ] **SaaS hóa các phân hệ kế tiếp**:
  - Phase 1F: Phân hệ Bảng lương (Payroll) & Chấm công nâng cao.
  - Phase 1G: Phân hệ Mua sắm tổng thể (Procurement & Purchase Orders).
  - Phase 1H: Báo cáo phân tích nâng cao (Dashboard & Principal Reports).

---

## 9. KẾT LUẬN VÀ BÀN GIAO CHO CODEX

Nhiệm vụ **Task 1E.5** đã hoàn tất đúng chỉ dẫn và phạm vi được giao:
- 51 endpoint tài chính SaaS và 1 endpoint báo cáo kế toán đã được tích hợp và kiểm thử an toàn qua Router Express.
- Đã hoàn thiện toàn bộ kiểm chứng nội dung workbook binary qua Supertest + ExcelJS (D.1, D.2, D.3), luồng import thật preview/confirm (D.5, D.6), xử lý lỗi upload middleware sạch sẽ (D.4), bảo mật import (D.7), và cơ chế route alias / allowlist fall-through 501 (A.8, A.9).
- Không có bất kỳ thay đổi nào làm ảnh hưởng tới dirty/untracked files có sẵn của dự án.
- Không can thiệp database thật, không chỉnh sửa index schema sản phẩm.
- Test suite full backend đạt kết quả: **31 suites, 977/977 tests PASS (100%)**.

Antigravity bàn giao kết quả và dừng thực thi để Codex tiến hành nghiệm thu độc lập.
