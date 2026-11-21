# SAAS PRODUCT COMPLETION CHECKLIST & GAP ANALYSIS
**Dự án**: Trường Mầm Non Đa Cơ Sở (Multi-Tenant SaaS)
**Baseline Backend**: 32 suites, 988/988 PASS (468.188s)
**Mục tiêu**: Đưa toàn bộ các năng lực SaaS từ tầng Backend ra Giao diện Người dùng (Frontend) thực tế, kiểm chứng tính cách ly dữ liệu giữa các cơ sở trường học trên môi trường cô lập, thiết lập tài liệu và công cụ triển khai an toàn.

---

## I. NGUYÊN TẮC PHÂN LOẠI TRẠNG THÁI (STATUS CLASSIFICATION)

Để đảm bảo tính trung thực kỹ thuật và không gây hiểu lầm cho đội ngũ vận hành:
- **`[DONE]`**: Đã hoàn thành triển khai mã nguồn, kiểm thử tự động, và kiểm chứng trực quan có bằng chứng (exit code, logs, screenshots).
- **`[BLOCKED BY RUNTIME]`**: Đã sẵn sàng công cụ và mã nguồn, nhưng bị chặn bởi quy định bảo toàn runtime (không được restart server 5001/5173, không migration database thật 27018 rs0, không sửa .env).
- **`[NOT VERIFIED ON PROD]`**: Chỉ mới kiểm chứng trên môi trường harness và browser CDP cô lập; chưa áp dụng hay kiểm chứng trên dữ liệu và dịch vụ sản phẩm thật.

---

## II. KIẾN TRÚC ROUTING VÀ ENTRYPOINT HỆ THỐNG

### 1. API Routing Frontend
- **Development Proxy (`frontend/vite.config.js`)**:
  - Cấu hình proxy `/api` trỏ tới backend: `process.env.VITE_BACKEND_URL || 'http://localhost:5001'`.
  - Hỗ trợ override cổng linh hoạt thông qua biến môi trường mà không hardcode vào mã nguồn.
- **HTTP Client Adapter (`frontend/src/api/axiosConfig.js`)**:
  - `baseURL`: `import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? '/api' : 'http://localhost:5001/api')`.
  - Trong môi trường trình duyệt: Dùng relative path `/api`, tự động tương thích với Vite dev server proxy (cổng 5173), reverse proxy kiểm thử (cổng 5199), hoặc reverse proxy nginx production.
  - Xử lý 401 Unauthorized: Tự động dọn sạch `token`, `user`, `tenant` khỏi `localStorage` và chuyển hướng về `/login`.

### 2. Backend Entrypoint Distinction
- **Legacy / Runtime Đang Chạy (`backend/server.js`)**:
  - Entrypoint chạy trên cổng 5001 cho chế độ đơn trường (legacy).
  - Được **giữ nguyên vẹn** trong suốt quá trình phát triển để bảo toàn runtime và dữ liệu hiện có.
- **SaaS Application Factory (`backend/src/saas/createSaasApp.js`)**:
  - Entrypoint cho nền tảng SaaS đa trường học, hỗ trợ các mode `phase1a` -> `phase1e`.
  - Tích hợp `saasModeGate` (chặn 501 các module chưa mở theo nguyên tắc fail-closed), `saasTenantResolutionMiddleware`, `saasAuthMiddleware`.
  - Được kiểm chứng qua toàn bộ các bài test tích hợp và kịch bản trình duyệt CDP trên cổng cô lập 5099.

---

## III. MA TRẬN ĐỐI CHIẾU CHI TIẾT TỪNG MODULE

| Nhóm chức năng | Endpoint Backend | Quyền (Roles) | Trạng thái Backend | Giao diện Frontend | Trạng thái Nghiệm thu | Bằng chứng Kiểm chứng |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Xác thực & Tenant Session** | `POST /api/v1/auth/login`<br>`POST /api/auth/login`<br>`GET /api/auth/me`<br>`POST /api/auth/logout` | Public (cần `schoolCode`), Logged-in | Đã cô lập tenant, kiểm tra trạng thái trường, thu hồi phiên | `Login.jsx`<br>`AppShell.jsx` | `[DONE]` | - Ảnh `saas_01_login_screen.png`<br>- Ảnh `saas_02_accountant_a_dashboard.png`<br>- Kịch bản 10: Xóa sạch tenant khi login legacy; reload F5 duy trì session; 401 dọn sạch session và redirect |
| **2. Danh mục Lớp học & Học sinh** | `GET /api/v1/classrooms`<br>`GET /api/v1/students` | `admin, principal, teacher, accountant` | Lọc nghiêm ngặt theo `req.tenant._id` | `ClassroomManagement.jsx`<br>`StudentList.jsx` | `[DONE]` | - Kiểm chứng qua Supertest & Browser CDP<br>- Không rò rỉ học sinh trường khác |
| **3. Điểm danh Học sinh** | `GET /api/v1/attendance/...`<br>`POST /api/v1/attendance/...` | `admin, principal, teacher` | Đã cô lập tenant trong Phase 1C | `SmartAttendance.jsx`<br>`AttendanceDetail.jsx` | `[DONE]` | - Suite Phase 1C pass 100% |
| **4. Biểu phí Học phí (Fee Schedules)** | `GET /api/v1/finance/fee-schedules`<br>`PUT /api/v1/finance/fee-schedules`<br>`DELETE /api/v1/finance/fee-schedules/:id` | `admin, accountant`<br>(xem: `principal`) | Đã cô lập tenant, kiểm tra kỳ mở (`periodOpen`) | `FeeSchedulePanel.jsx`<br>`FinanceManagement.jsx` (Tab Thiết lập mức thu) | `[DONE]` (Test DB)<br>`[NOT VERIFIED ON PROD]` | - Kịch bản 4 CDP: Kế toán A tạo biểu phí 4.200.000 đ thành công<br>- Ảnh `saas_04_accountant_a_schedules.png`<br>- Assert DB: `FeeSchedule` tồn tại |
| **5. Hóa đơn & Công nợ** | `GET /api/v1/finance/invoices`<br>`POST /api/v1/finance/tuition/bulk`<br>`POST /api/v1/finance/tuition/bulk/preview`<br>`PUT /api/v1/finance/tuition/cancel/:id`<br>`GET /api/v1/finance/debts` | `admin, accountant`<br>(xem: `principal`) | Đã cô lập tenant trong Phase 1E.3, kiểm tra kỳ mở, bảo vệ hủy/điều chỉnh | `FinanceManagement.jsx`<br>(Tab Hóa đơn, Công nợ) | `[DONE]` | - Kịch bản 3 CDP: Hóa đơn Ánh Dương A hiển thị chính xác<br>- Leak check: Sen Hồng B không thấy học sinh Ánh Dương A |
| **6. Thu tiền & Biên lai** | `POST /api/v1/finance/payments`<br>`GET /api/v1/finance/invoices/:id/payments`<br>`GET /api/v1/finance/receipts/:paymentId` | `admin, accountant`<br>(xem: `principal, parent`) | Đã cô lập tenant trong Phase 1E.4, ghi nhận thanh toán trong transaction | `FinanceManagement.jsx`<br>(Modal Thu tiền, Modal Biên lai) | `[DONE]` (Test DB)<br>`[NOT VERIFIED ON PROD]` | - Kịch bản 3 CDP: Thu 1.000.000 đ, cập nhật bảng hóa đơn, mở modal biên lai PT-...<br>- Assert DB: `Payment` được tạo với mã PT-20261111-... |
| **7. Hoàn phí 3 bước (Tuition Refund)** | `GET /api/v1/finance/refund-requests`<br>`POST /api/v1/finance/refund-requests`<br>`PATCH /api/v1/finance/refund-requests/:id/review`<br>`POST /api/v1/finance/refund-requests/:id/pay` | `accountant` (lập/chi)<br>`principal, admin` (duyệt)<br>*(CẤM PARENT)* | Bảo vệ phân quyền chặt chẽ, kiểm tra trạng thái duyệt và kỳ kế toán | `FinanceManagement.jsx` (Tab Hoàn phí & Modal Điều chỉnh) | `[DONE]` (Test DB)<br>`[NOT VERIFIED ON PROD]` | - Kịch bản 5 CDP: Kế toán đề nghị 500.000 đ (pending) -> Hiệu trưởng duyệt UI (approved) -> Kế toán chi UI (PC-HOAN-001)<br>- Assert DB sâu: `TuitionRefundRequest` paid, `InvoiceAdjustment` refund, `TuitionFee` paidAmount giảm |
| **8. Chi vận hành (Operating Expense)** | `GET /api/v1/finance/operating-expenses`<br>`GET /api/v1/finance/operating-expense-requests`<br>`POST /api/v1/finance/operating-expense-requests`<br>`PATCH /api/v1/finance/operating-expense-requests/:id/review`<br>`POST /api/v1/finance/operating-expenses` | `accountant` (lập/chi)<br>`principal, admin` (duyệt) | Đã cô lập tenant trong Phase 1E.4, tích hợp sổ quỹ và kỳ kế toán | `OperatingExpenses.jsx` | `[DONE]` (Test DB)<br>`[NOT VERIFIED ON PROD]` | - Kịch bản 6 CDP: Kế toán đề nghị chi 2.500.000 đ -> Hiệu trưởng duyệt UI -> Kế toán ghi chi thực tế UI (PC-DIEN-001)<br>- Assert DB sâu: `OperatingExpenseRequest` paid, `OperatingExpense` được tạo |
| **9. Chi mua sắm (Purchase Expense)** | `GET /api/v1/finance/expense-orders`<br>`GET /api/v1/finance/expenses`<br>`POST /api/v1/finance/expenses` | `admin, accountant`<br>(xem: `principal`) | Đã cô lập tenant trong Phase 1E.4, liên kết đơn mua sắm đã duyệt | `AccountingExpenses.jsx` | `[DONE]` | - Supertest Phase 1E.5: Đơn mua sắm và chứng từ chi lọc đúng tenant |
| **10. Sổ quỹ & Đối soát** | `GET /api/v1/finance/cashbook`<br>`PUT /api/v1/finance/cashbook/reconciliation` | `admin, accountant`<br>(xem: `principal`) | Đã cô lập tenant trong Phase 1E.4, tính toán tồn quỹ tự động | `AccountingCashbook.jsx` | `[DONE]` (Test DB)<br>`[NOT VERIFIED ON PROD]` | - Kịch bản 7.2 CDP: Thao tác mở modal đối chiếu trên UI, nhập số kiểm kê, lưu<br>- Assert DB: `DailyCashReconciliation` tồn tại |
| **11. Kỳ kế toán (Accounting Period)** | `GET /api/v1/finance/accounting-period/:month`<br>`POST /api/v1/finance/accounting-period/:month/close`<br>`POST /api/v1/finance/accounting-period/:month/reopen` | `admin, principal`<br>(xem: `accountant`) | Đã cô lập tenant trong Phase 1E.4, bẫy chặn ghi vào kỳ đóng | `AccountingReport.jsx` | `[DONE]` (Test DB)<br>`[NOT VERIFIED ON PROD]` | - Kịch bản 7.3 CDP: Hiệu trưởng thao tác chốt kỳ tháng 10/2026 trên UI (closed) -> mở lại kỳ trên UI (open)<br>- Assert DB: `AccountingPeriod` rev=2, rev=3 |
| **12. Nhập / Xuất Excel Tài chính** | `GET /api/v1/finance/export/...`<br>`GET /api/v1/finance/import/.../template`<br>`POST /api/v1/finance/import/.../preview`<br>`POST /api/v1/finance/import/.../confirm` | `admin, accountant`<br>(xem export: `principal`) | File mẫu lọc đúng lớp/học sinh của trường; preview/confirm có Idempotency; xuất file chuẩn ExcelJS có phân lập trường | `FinanceExcelImportModal.jsx`<br>`FinanceManagement.jsx`<br>`AccountingCashbook.jsx`<br>`AccountingReport.jsx` | `[DONE]` | - Kịch bản 7.1 CDP: Nạp file .xlsx qua modal UI -> preview hợp lệ -> xác nhận -> Assert DB `FeeSchedule` kỳ 12-2026<br>- Xuất Excel qua UI trên cả 4 màn hình: Hóa đơn, Biểu phí, Sổ quỹ, Báo cáo kế toán; bắt blob binary, lưu file đĩa và đọc xác thực nội dung bằng ExcelJS; assert đầy đủ dữ liệu trường A và tuyệt đối không rò rỉ dữ liệu trường B |
| **13. Cổng Phụ huynh (Parent Portal)** | `GET /api/v1/finance/tuition/student/:studentId` | `parent` (chính chủ con)<br>`admin, principal` | Lọc nghiêm ngặt: Phụ huynh chỉ thấy con mình | `ParentPortal.jsx` | `[DONE]` | - Kịch bản 8 CDP: Phụ huynh Ánh Dương chỉ thấy bé Nguyễn Ánh Dương<br>- Leak check: Không thấy học sinh trường B |
| **14. Responsive Giao diện Di động** | Giao diện đăng nhập, accounting, finance, cashbook | Mọi vai trò | Header topbar, drawer menu, viewport nhỏ 375x812 | `AppShell.jsx`<br>`Login.jsx` | `[DONE]` | - Kịch bản 9 CDP (viewport 375x812)<br>- Assert không tràn ngang (`scrollWidth <= innerWidth`)<br>- Ảnh `saas_07`, `saas_08`, `saas_09` |

---

## IV. TRẠNG THÁI MIGRATION DATABASE THỰC TẾ

| Hạng mục | Trạng thái | Ghi chú & Giới hạn |
| :--- | :--- | :--- |
| **Script Migration Create-Before-Drop** | `[DONE]` | `backend/scripts/saas_phase1e_index_migration.js` có Preflight (Metadata, Type, Duplicate), Apply an toàn (Tạo mới -> Xác minh -> Drop cũ), Rollback Guard chống mất dữ liệu khi có collision. |
| **Diễn tập Cô lập (Rehearsal Test)** | `[DONE]` | `tests/saas/phase1e_migration_rehearsal.test.js`: 11/11 tests PASS (2.524s). |
| **Áp dụng Database Thật (27018 rs0)** | `[BLOCKED BY RUNTIME]` | **CHƯA THỰC HIỆN**. Tuân thủ chỉ thị không can thiệp database thật và không restart runtime trong lượt này. Cần phê duyệt riêng từ Codex và Người dùng. |
| **Phạm vi Giới hạn (Scope Limitations)** | `[DONE]` | Script migration chỉ áp dụng cho 6 collection Zone 4 Finance. Các Zone khác không thuộc phạm vi đợt này. |
