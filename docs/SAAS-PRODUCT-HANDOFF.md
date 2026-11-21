# BÁO CÁO NGHIỆM THU VÀ BÀN GIAO SẢN PHẨM SAAS (PHASE 1E & FRONTEND INTEGRATION)

**Dự án**: Trường Mầm Non Đa Cơ Sở (Multi-Tenant SaaS)
**Mục tiêu**: Hoàn thiện kiểm chứng tích hợp SaaS Phase 1E từ Backend đến Giao diện Người dùng (Frontend), kiểm chứng tính cách ly dữ liệu giữa các cơ sở trường học trên môi trường thử nghiệm cô lập, cung cấp công cụ Migration Index Create-Before-Drop an toàn và tài liệu hướng dẫn triển khai.
**Ngày thực hiện**: 11/11/2026
**Tác nhân thực hiện**: Antigravity (Codex điều phối)

---

## 1. TỔNG KẾT KẾT QUẢ VÀ TRẠNG THÁI TRIỂN KHAI

Để đảm bảo tính trung thực kỹ thuật và an toàn hệ thống, các hạng mục được phân định rõ ràng theo 3 trạng thái:
- **`[DONE]`**: Đã hoàn thành triển khai mã nguồn, kiểm thử tự động, và kiểm chứng trực quan có bằng chứng (exit code, logs, screenshots).
- **`[BLOCKED BY RUNTIME]`**: Đã sẵn sàng công cụ và mã nguồn, nhưng bị chặn bởi quy định bảo toàn runtime (không được restart server 5001/5173, không migration database thật 27018 rs0, không sửa .env).
- **`[NOT VERIFIED ON PROD]`**: Chỉ mới kiểm chứng trên môi trường harness và browser CDP cô lập; chưa áp dụng hay kiểm chứng trên dữ liệu và dịch vụ sản phẩm thật.

### Tóm tắt các khối công việc đã hoàn thành:

1. **Khảo sát & Lập Ma trận Đối chiếu (Checklist & Gap Analysis)**: `[DONE]`
   - Lập tài liệu `docs/SAAS-PRODUCT-COMPLETION-CHECKLIST.md` đối chiếu chi tiết 14 nhóm chức năng SaaS từ Backend ra Giao diện Frontend.
   - Xác định rõ kiến trúc API Routing và sự phân tách giữa 2 Backend Entrypoints (`server.js` cho legacy runtime và `createSaasApp.js` cho SaaS mode).
2. **Cấu hình API Routing Frontend & Quản lý Phiên Tenant**: `[DONE]`
   - `frontend/vite.config.js`: Bổ sung proxy `/api` trỏ tới `process.env.VITE_BACKEND_URL || 'http://localhost:5001'` với `changeOrigin: true`. Hỗ trợ override cổng linh hoạt cho môi trường thử nghiệm mà không hardcode cổng test.
   - `frontend/src/api/axiosConfig.js`: Chuẩn hóa base URL thích ứng (`/api` trên browser), tự động dọn sạch `token`, `user`, `tenant` khỏi `localStorage` khi nhận HTTP 401.
   - `frontend/src/pages/Login.jsx`: Bổ sung ô nhập "Mã trường học (School Code)" tự động chuyển in hoa; loại bỏ hoàn toàn việc tự dựng tenant context từ mã trường do người dùng nhập; chỉ lưu `tenant` khi backend phản hồi thành công; dọn sạch session cũ khi đăng nhập tài khoản legacy.
   - `frontend/src/components/AppShell.jsx`: Tự động nhận diện `tenant` từ `GET /auth/me`; hiển thị Huy hiệu Trường học (`.school-tenant-badge`) và Huy hiệu cơ sở (`.topbar-tenant-tag`); chức năng Đăng xuất gọi `/auth/logout` và xóa sạch toàn bộ state và storage.
3. **Kiên cường hóa Giao diện Tài chính & Cổng Phụ huynh**: `[DONE]`
   - `frontend/src/pages/FinanceManagement.jsx`: Bảo vệ hàm `load()`, bọc an toàn báo cáo kỳ thu; hiển thị thông báo trung thực khi endpoint báo cáo chưa được mở trong mode phase1e; tích hợp `FeeSchedulePanel` và `FinanceExcelImportModal`.
   - `frontend/src/pages/ParentPortal.jsx`: Bọc các lời gọi module phụ trợ chưa mở bằng `.catch` an toàn, đảm bảo Phụ huynh luôn xem được thông tin của con và học phí mà không bị lỗi 501.
4. **Thiết kế lại Migration Index An Toàn (Create-Before-Drop & Rollback Guard)**: `[DONE]` (Test DB) / `[BLOCKED BY RUNTIME]` (Prod DB)
   - Hoàn thiện công cụ `backend/scripts/saas_phase1e_index_migration.js`:
     * **Preflight Checks**: Kiểm tra metadata (bắt lỗi `METADATA_MISMATCH` khi index cùng tên nhưng sai key/options), kiểm tra sai kiểu `tenantId` (`INVALID_TENANT_ID_TYPE`), kiểm tra duplicate collision nội bộ tenant.
     * **Create-Before-Drop Apply**: Tạo target compound index -> Tạo target legacy index -> Xác minh cả 2 index active thành công -> Mới drop legacy global index cũ.
     * **Optional receiptNumber**: Sử dụng `{ $type: 'string', $gt: '' }` cho phép nhiều bản ghi null/missing/empty string.
     * **Rollback Guard**: Preflight kiểm tra collision toàn cục giữa các trường; nếu phát hiện xung đột dữ liệu chéo thì **TỪ CHỐI ROLLBACK & BẢO TOÀN TARGET COMPOUND INDEXES**, tuyệt đối không xóa dữ liệu trường học để rollback.
   - Test suite diễn tập `backend/tests/saas/phase1e_migration_rehearsal.test.js`: Đạt **11/11 tests PASS** (2.524s).
5. **Kiểm chứng Trình duyệt Tự động Thực tế (Chrome CDP Browser Automation)**: `[DONE]`
   - Script `backend/scripts/run_saas_browser_verification.js` sử dụng Chrome DevTools Protocol với các assertions thực thụ (ném lỗi throw Error, bắt lỗi trả exit code 1), thao tác DOM trực tiếp qua UI, không gọi API thay thế thao tác.
   - Hỗ trợ cờ `--self-test-negative` chứng minh assertion thất bại làm script trả nonzero (**exit code 1**).
   - **Xuất Excel qua UI có kiểm chứng nội dung bằng ExcelJS**: Bắt sự kiện tải file Blob binary qua hook browser, lưu file `.xlsx` thật ra đĩa, nạp workbook bằng thư viện ExcelJS và xác thực dữ liệu/số tiền thực tế của Trường A đồng thời kiểm tra chống rò rỉ dữ liệu Trường B trên 4 màn hình: Hóa đơn học phí, Biểu phí, Sổ quỹ, Báo cáo kế toán.
   - **Bảo toàn Idempotency & In-flight Lock qua Modal UI thực tế**:
     * Kiểm tra khóa nút submit in-flight (`disabled=true`, text `'Đang ghi...'`) khi có độ trễ mạng có kiểm soát (1500ms), chặn người dùng click lặp (spam click), proxy ghi nhận duy nhất 1 POST request, database chỉ tạo đúng 1 giao dịch chi.
     * Kiểm tra Retry qua UI sau lỗi mạng (mô phỏng HTTP 503 có kiểm soát): form giữ nguyên vẹn các trường đã nhập, Idempotency-Key được bảo toàn tuyệt đối qua lần thử lại (`Key 1 === Key 2`), không tạo giao dịch kép trong database.
     * Kiểm tra API Idempotency trực tiếp: 2 request đồng thời cùng key chỉ tạo 1 bản ghi.
   - Kiểm chứng thành công **10/10 kịch bản thực tế** giữa 2 trường (`MN-ANHDUONG-A` và `MN-SENHONG-B`) và tài khoản Legacy, sinh đủ **9 ảnh chụp màn hình bằng chứng trực quan** và **4 file Excel kiểm chứng**, thoát với **exit code 0**.

---

## 2. BẰNG CHỨNG KIỂM CHỨNG TRÌNH DUYỆT THỰC TẾ (CHROME CDP)

**Command thực thi**:
```powershell
node backend/scripts/run_saas_browser_verification.js
```
**Exit Code**: `0`
**Môi trường thực thi**:
- Backend SaaS App: `http://127.0.0.1:5099` (chạy qua `createSaasApp({ saasMode: 'phase1e' })`)
- Frontend Server: `http://127.0.0.1:5199` (chạy qua static server + reverse proxy `/api` sang 5099)
- Chrome Headless: DevTools Protocol WebSocket port `9222`, viewport desktop `1280x850` và mobile `375x812`
- Database: Isolated MongoMemoryReplSet (được áp dụng `saas_phase1e_index_migration.js` an toàn)

### Chi tiết 10 Kịch bản và Assertions đã đạt 100%:

1. **KỊCH BẢN 1: Giao diện Đăng nhập SaaS**:
   - `[ASSERT OK]` Form có ô nhập Mã trường: chứa "Mã trường học (School Code)".
   - `[SCREENSHOT]` Đã lưu: `docs/screenshots/saas_01_login_screen.png`.
2. **KỊCH BẢN 2: Đăng nhập Kế toán Ánh Dương A**:
   - `[URL ASSERT OK]` Điều hướng vào Tổng quan kế toán: `http://127.0.0.1:5199/accounting`.
   - `[ASSERT OK]` Huy hiệu trường Ánh Dương A trên Sidebar: chứa "Trường Mầm Non Ánh Dương A".
   - `[ASSERT OK]` Huy hiệu mã trường MN-ANHDUONG-A trên Topbar: chứa "MN-ANHDUONG-A".
   - `[SCREENSHOT]` Đã lưu: `docs/screenshots/saas_02_accountant_a_dashboard.png`.
3. **KỊCH BẢN 3: Kế toán A xem Sổ thu học phí, Thu tiền, Biên lai & Xuất Excel qua UI**:
   - `[ASSERT OK]` Có học sinh Ánh Dương của trường: chứa "Nguyễn Ánh Dương".
   - `[LEAK CHECK OK]` Chống rò rỉ: Không có học sinh Sen Hồng của trường B: Không chứa "Lê Sen Hồng".
   - `[SCREENSHOT]` Đã lưu: `docs/screenshots/saas_03_accountant_a_invoices.png`.
   - `[ASSERT OK]` Modal thu tiền đúng học sinh: chứa "Nguyễn Ánh Dương".
   - Thao tác thu tiền 1.000.000 đ qua form modal.
   - `[ASSERT OK]` Bảng hóa đơn hiển thị đã thu 1.000.000 đ: chứa "1.000.000".
   - `[ASSERT OK]` Ghi nhận số tiền thu 1.000.000 đ trong lịch sử: chứa "1.000.000".
   - `[DB ASSERT OK]` Payment được ghi nhận trong DB: `Payment.findOne({ tenantId, amount: 1000000 })` tồn tại (`PT-20261111-A2BE90AF`).
   - **Kiểm chứng Xuất Excel Hóa đơn học phí qua UI**:
     * Bấm nút "Xuất Excel" trên `/finance?tab=invoices`. Bắt sự kiện tải file Blob binary (size = 7.875 bytes).
     * Ghi file ra đĩa: `docs/screenshots/exported_invoices_anhduong.xlsx` (`HoaDonHocPhi_11-2026_*.xlsx`).
     * Nạp workbook bằng ExcelJS: Xác nhận có 1 sheet `Hóa đơn học phí`.
     * `[TENANT A DATA OK]` Assert có dữ liệu học sinh `Nguyễn Ánh Dương` và số tiền `5.500.000 đ`.
     * `[TENANT B ISOLATION OK]` Assert tuyệt đối không chứa dữ liệu trường B (`Lê Sen Hồng`, `MN-SENHONG-B`, `Sen Hồng`).
4. **KỊCH BẢN 4: Kế toán A Thiết lập mức thu mới qua UI**:
   - Điều hướng sang `/finance?tab=schedules`.
   - Điền form mức thu: Hạn nộp `2026-11-28`, Học phí chính `4.200.000 đ`, Tiền ăn `1.300.000 đ`. Bấm "Lưu mức thu".
   - `[SCREENSHOT]` Đã lưu: `docs/screenshots/saas_04_accountant_a_schedules.png`.
   - `[DB ASSERT OK]` FeeSchedule được ghi nhận trong DB: `FeeSchedule.findOne({ tenantId, tuitionBase: 4200000 })` tồn tại.
5. **KỊCH BẢN 5: Quy trình Hoàn phí 3 bước (Kế toán đề nghị -> Hiệu trưởng duyệt UI -> Kế toán chi UI)**:
   - Bước 5.1: Kế toán A vào `/finance?tab=invoices`, mở modal Điều chỉnh trên hóa đơn Nguyễn Ánh Dương, chọn "Đề nghị hoàn tiền", nhập `500.000 đ`, lý do "Hoàn tiền ăn do vắng mặt phép dài ngày". Bấm "Gửi yêu cầu duyệt".
   - `[DB ASSERT OK]` `TuitionRefundRequest` status `pending`: amount 500.000 đ.
   - Bước 5.2: Đăng xuất Kế toán A -> Đăng nhập Hiệu trưởng A (`MN-ANHDUONG-A`, `hieutruong_a`).
   - Vào `/finance?tab=refunds`:
   - `[ASSERT OK]` Hàng chờ duyệt hoàn phí có tên học sinh: chứa "Nguyễn Ánh Dương".
   - `[ASSERT OK]` Số tiền hoàn 500.000 đ: chứa "500.000".
   - Hiệu trưởng thực sự bấm "Duyệt hoàn tiền" trên UI modal.
   - `[DB ASSERT OK]` `TuitionRefundRequest` status chuyển sang `approved` thành công.
   - Bước 5.3: Đăng xuất Hiệu trưởng A -> Đăng nhập lại Kế toán A.
   - Vào `/finance?tab=invoices`, mở modal Điều chỉnh:
   - `[ASSERT OK]` Trạng thái "Đã duyệt, chờ chi" trên hàng chờ modal.
   - Kế toán điền số chứng từ chi `PC-HOAN-001`, chọn chuyển khoản, bấm "Xác nhận đã chi".
   - `[DB ASSERT OK]` `TuitionRefundRequest` status `paid`.
   - `[DB ASSERT OK]` `InvoiceAdjustment`: `type: 'refund'`, `amount: 500000`, `documentNumber: 'PC-HOAN-001'`, `tenantId` khớp.
   - `[DB ASSERT OK]` `TuitionFee`: `paidAmount` giảm từ 1.000.000 đ xuống 500.000 đ, status `partial`.
   - `[ASSERT OK]` Bảng hóa đơn chính cập nhật số tiền đã thu là 500.000 đ.
6. **KỊCH BẢN 6: Quy trình Chi vận hành 3 bước (Kế toán đề nghị -> Hiệu trưởng duyệt UI -> Kế toán chi UI)**:
   - Bước 6.1: Kế toán A vào `/accounting/operating-expenses`. Điền form đề nghị chi: Nhóm chi `Điện, nước, internet`, Đơn vị nhận tiền `Công ty Điện lực Ánh Dương`, Nội dung `Tiền điện cơ sở Ánh Dương T11/2026`, Số tiền `2.500.000 đ`. Bấm "Gửi đề nghị duyệt".
   - `[DB ASSERT OK]` `OperatingExpenseRequest` status `pending`.
   - Bước 6.2: Đăng xuất Kế toán A -> Đăng nhập Hiệu trưởng A.
   - Vào `/accounting/operating-expenses`:
   - `[ASSERT OK]` Đề nghị chi 2.500.000 đ xuất hiện trong danh sách.
   - Hiệu trưởng thực sự bấm "Duyệt" trên UI.
   - `[DB ASSERT OK]` `OperatingExpenseRequest` status chuyển sang `approved`.
   - Bước 6.3: Đăng xuất Hiệu trưởng A -> Đăng nhập lại Kế toán A.
   - Vào `/accounting/operating-expenses`, bấm "Nhập chứng từ chi":
   - Điền số chứng từ chi `PC-DIEN-001`, chọn Tiền mặt, ngày chi `2026-11-11`, bấm "Xác nhận đã chi".
   - `[DB ASSERT OK]` `OperatingExpenseRequest` status `paid`.
   - `[DB ASSERT OK]` `OperatingExpense`: `documentNumber: 'PC-DIEN-001'`, `amount: 2500000`, `category: 'utilities'`, `tenantId` khớp.
   - `[ASSERT OK]` Lịch sử chi hiển thị chứng từ `PC-DIEN-001` và số tiền `2.500.000 đ`.
7. **KỊCH BẢN 7: Import/Export Excel, Đối soát sổ quỹ, Khóa/mở kỳ qua UI**:
   - Bước 7.1: Xuất & Nhập Excel biểu phí qua modal UI:
     * **Kiểm chứng Xuất Excel Biểu phí qua UI**: Bấm nút "Xuất Excel" trên `/finance?tab=schedules`. Bắt sự kiện tải file Blob binary (size = 7.812 bytes), ghi file `docs/screenshots/exported_fee_schedules_anhduong.xlsx` (`MucThu_11-2026_*.xlsx`). Nạp workbook bằng ExcelJS: `[TENANT A DATA OK]` Assert có dữ liệu mức thu của trường A (`4.200.000 đ`, `1.300.000 đ`, kỳ `11-2026`). `[TENANT B ISOLATION OK]` Assert tuyệt đối không chứa dữ liệu trường B (`Lê Sen Hồng`, `MN-SENHONG-B`, `Sen Hồng`).
     * Bấm "Nhập Excel", modal mở ra chứa "Nhập mức thu học phí từ Excel".
     * Nạp file template `.xlsx` hợp lệ qua CDP file input.
     * `[ASSERT OK]` Bảng preview hợp lệ xuất hiện: chứa "Hợp lệ:".
     * Bấm nút "Xác nhận nhập dữ liệu".
     * `[DB ASSERT OK]` `FeeSchedule` kỳ 12-2026 được import thành công vào DB với đúng `tenantId`.
   - Bước 7.2: Xuất Excel Sổ quỹ & Đối soát sổ quỹ qua UI (`/accounting/cashbook`):
     * **Kiểm chứng Xuất Excel Sổ quỹ qua UI**: Bấm nút "Xuất Excel" trên `/accounting/cashbook`. Bắt sự kiện tải file Blob binary (size = 9.763 bytes), ghi file `docs/screenshots/exported_cashbook_anhduong.xlsx` (`SoQuyDoiSoat_*.xlsx`). Nạp workbook bằng ExcelJS: `[TENANT A DATA OK]` Assert có khoản chi vận hành của trường A (`2.500.000 đ`, chứng từ `PC-DIEN-001`). `[TENANT B ISOLATION OK]` Assert tuyệt đối không chứa dữ liệu trường B.
     * Bấm "Nhập đối chiếu" trên ngày hôm nay. Điền căn cứ kiểm kê `BB-KIEMKE-20261109`. Bấm "Lưu đối chiếu".
     * `[DB ASSERT OK]` `DailyCashReconciliation` tồn tại trong DB với đúng `tenantId` và `evidenceReference: 'BB-KIEMKE-20261109'`.
   - Bước 7.3: Xuất Excel Báo cáo & Hiệu trưởng thao tác Khóa / Mở kỳ kế toán qua UI (`/accounting/report`):
     * Chọn tháng đã kết thúc (`2026-10`), kiểm tra kỳ ban đầu mở (`Kỳ đang mở`).
     * **Kiểm chứng Xuất Excel Báo cáo kế toán qua UI**: Chờ nút Xuất Excel sẵn sàng (không bị disabled do đang tải), bấm nút "Xuất Excel". Bắt sự kiện tải file Blob binary (size = 8.094 bytes), ghi file `docs/screenshots/exported_accounting_report_anhduong.xlsx` (`BaoCaoKeToan_2026-10_*.xlsx`). Nạp workbook bằng ExcelJS: `[TENANT A DATA OK]` Assert có tiêu đề và kỳ kế toán `2026-10`. `[TENANT B ISOLATION OK]` Assert tuyệt đối không chứa dữ liệu trường B.
     * Nhập lý do khóa kỳ >10 ký tự: `Chốt số liệu kế toán định kỳ tháng 10/2026`, bấm "Chốt kỳ".
     * `[ASSERT OK]` UI chuyển sang trạng thái "Kỳ đã chốt".
     * `[DB ASSERT OK]` `AccountingPeriod` tháng 2026-10 status `closed`, revision `1`.
     * Nhập lý do mở lại: `Mở lại kỳ để rà soát chứng từ điều chỉnh bổ sung`, bấm "Mở lại kỳ".
     * `[ASSERT OK]` UI chuyển về trạng thái "Kỳ đang mở".
     * `[DB ASSERT OK]` `AccountingPeriod` tháng 2026-10 status `open`, revision `2`.
8. **KỊCH BẢN 8: Đăng nhập Kế toán Sen Hồng B (Tenant B) & Phụ huynh A Portal**:
   - Đăng xuất Kế toán Ánh Dương A -> Đăng nhập Kế toán Sen Hồng B (`MN-SENHONG-B`, `ketoan_b`).
   - `[URL ASSERT OK]` Điều hướng vào Sen Hồng B: `http://127.0.0.1:5199/accounting`.
   - `[ASSERT OK]` Huy hiệu trường Sen Hồng B trên Sidebar: chứa "Trường Mầm Non Sen Hồng B".
   - `[ASSERT OK]` Huy hiệu MN-SENHONG-B trên Topbar: chứa "MN-SENHONG-B".
   - Vào `/finance?tab=invoices`:
   - `[ASSERT OK]` Chỉ thấy học sinh Sen Hồng của trường B: chứa "Lê Sen Hồng".
   - `[LEAK CHECK OK]` Chống rò rỉ: Tuyệt đối KHÔNG có học sinh Ánh Dương của trường A: Không chứa "Nguyễn Ánh Dương".
   - `[SCREENSHOT]` Đã lưu: `docs/screenshots/saas_05_accountant_b_invoices.png`.
   - Vào `/parent-portal` với tài khoản Phụ huynh Ánh Dương A (`MN-ANHDUONG-A`, `phuhuynh_a`):
   - `[ASSERT OK]` Phụ huynh thấy đúng tên con mình: chứa "Nguyễn Ánh Dương".
   - `[LEAK CHECK OK]` Chống rò rỉ: Tuyệt đối không thấy con của trường B: Không chứa "Lê Sen Hồng".
   - `[SCREENSHOT]` Đã lưu: `docs/screenshots/saas_06_parent_a_portal.png`.
9. **KỊCH BẢN 9: Kiểm tra Giao diện Di động (Mobile 375x812)**:
   - Đổi kích thước Viewport sang mobile: `width: 375, height: 812`.
   - Màn hình Login mobile:
     * `[SCREENSHOT]` Đã lưu: `docs/screenshots/saas_07_mobile_responsive.png`.
   - Đăng nhập Kế toán A trên mobile:
     * `[RESPONSIVE OK]` Trang `/accounting` không bị tràn ngang (`scrollWidth <= innerWidth`).
     * Mở Mobile Drawer qua hamburger button:
     * `[ASSERT OK]` Mobile Drawer hiển thị đúng thông tin trường "Trường Mầm Non Ánh Dương A". Đóng Drawer.
   - Vào `/finance` trên mobile:
     * `[RESPONSIVE OK]` Trang Hóa đơn học phí không bị tràn ngang.
     * `[SCREENSHOT]` Đã lưu: `docs/screenshots/saas_08_mobile_finance.png`.
   - Vào `/accounting/cashbook` trên mobile:
     * `[RESPONSIVE OK]` Trang Đối soát sổ quỹ không bị tràn ngang.
     * `[SCREENSHOT]` Đã lưu: `docs/screenshots/saas_09_mobile_cashbook.png`.
10. **KỊCH BẢN 10: SaaS -> Logout -> Legacy login, Reload F5, 401 Unauthorized và Submit lặp**:
    - Bước 10.1: Đăng nhập tài khoản Legacy (bỏ trống ô schoolCode, username `admin_legacy`, password `pass123`):
      * `[URL ASSERT OK]` Tài khoản Legacy điều hướng thành công vào `/dashboard`.
      * `[LEGACY ASSERT OK]` `localStorage.getItem("tenant") === null`.
      * `[LEGACY ASSERT OK]` Sidebar không có `.school-tenant-badge`.
      * Đăng xuất tài khoản Legacy.
    - Bước 10.2: Đăng nhập lại SaaS A (`MN-ANHDUONG-A`, `ketoan_a`), kiểm tra F5 Reload:
      * `[URL ASSERT OK]` Vào `/accounting`.
      * F5 Reload trang qua CDP navigate:
      * `[URL ASSERT OK]` Sau reload F5 vẫn ở `/accounting`.
      * `[ASSERT OK]` Sau reload F5 vẫn giữ huy hiệu trường "Trường Mầm Non Ánh Dương A".
      * `[RELOAD F5 OK]` Phiên đăng nhập và tenant context duy trì nguyên vẹn sau reload.
    - Bước 10.3: Kiểm tra 401 Unauthorized:
      * Giả lập token bị thu hồi/hết hạn trên `localStorage` (`invalid-expired-token`), gọi `GET /api/finance/invoices`.
      * `[URL ASSERT OK]` Interceptor tự động dọn sạch storage và chuyển hướng về `/login`.
      * `[401 CLEANUP OK]` Đã dọn sạch token và tenant sau 401, trở về login.
    - Bước 10.4: Kiểm tra chống submit lặp (Idempotency Guard) qua Modal UI và API:
      * **Bước 10.4a: UI In-flight Lock & Delayed Response qua Modal Ghi chi**:
        - Mở modal ghi chi cho đề nghị của `Công ty Vệ Sinh Xanh`, điền chứng từ `PC-UI-LOCK-001`.
        - Bật độ trễ 1500ms có kiểm soát trên reverse proxy cho endpoint ghi chi.
        - Kế toán bấm "Xác nhận đã chi" qua UI.
        - `[UI IN-FLIGHT LOCK OK]` Kiểm tra ngay trong lúc request đang xử lý: nút xác nhận bị `disabled=true` và text chuyển thành `'Đang ghi...'`.
        - Thao tác spam click 3 lần liên tiếp trong lúc in-flight: toàn bộ click bị chặn tại UI layer.
        - Chờ hoàn tất request.
        - `[PROXY AUDIT OK]` Proxy log xác nhận chỉ phát sinh đúng duy nhất 1 POST request tới backend.
        - `[DB ASSERT OK]` Database chỉ có đúng duy nhất 1 giao dịch `PC-UI-LOCK-001` (`count = 1`).
      * **Bước 10.4b: UI Network Retry sau lỗi mạng 503 (Bảo toàn Form & Idempotency-Key)**:
        - Mở modal ghi chi cho đề nghị của `Công ty Cấp Nước Sạch`, điền chứng từ `PC-UI-RETRY-002`.
        - Bật cờ mô phỏng lỗi mạng 503 có kiểm soát trên reverse proxy cho request ghi tiếp theo.
        - Kế toán bấm "Xác nhận đã chi" lần 1 qua UI.
        - `[NETWORK ERROR DISPLAYED OK]` UI hiển thị thông báo lỗi mạng 503.
        - `[FORM PRESERVED OK]` Toàn bộ biểu mẫu ghi chi giữ nguyên dữ liệu đã nhập (`PC-UI-RETRY-002`), không bị xóa form.
        - Proxy ghi nhận `Key 1` = `038b6080-13d8-43af-9437-9eee0c23f5f4`.
        - `[DB ASSERT PRE-RETRY OK]` Database chưa có bất kỳ giao dịch nào (`count = 0`).
        - Kế toán bấm "Xác nhận đã chi" lần 2 (Retry trực tiếp qua UI, không sửa form).
        - `[RETRY SUCCESS OK]` Ghi nhận thành công sau khi retry.
        - Proxy ghi nhận `Key 2` = `038b6080-13d8-43af-9437-9eee0c23f5f4`.
        - `[IDEMPOTENCY KEY RETENTION OK]` Assert `Key 1 === Key 2` được bảo toàn nguyên vẹn 100% qua lần thử lại.
        - `[DB ASSERT POST-RETRY OK]` Database chỉ có đúng duy nhất 1 giao dịch `PC-UI-RETRY-002` (`count = 1`), không bị trùng lặp.
      * **Bước 10.4c: API Idempotency trực tiếp (Concurrent fetch validation)**:
        - Gửi đồng thời 2 request fetch mang cùng `Idempotency-Key` với chứng từ `PC-API-IDEMP-003`.
        - Cả hai request trả về mã thành công (201/200).
        - `[API IDEMPOTENCY OK]` Database chỉ có đúng duy nhất 1 bản ghi (`count = 1`).

---

## 3. DANH SÁCH ẢNH CHỤP MÀN HÌNH BẰNG CHỨNG (SCREENSHOTS)

Toàn bộ 9 ảnh chụp màn hình đã được lưu đồng thời vào thư mục `docs/screenshots/` và thư mục Artifacts:

| STT | Tên File | Viewport | Nội dung kiểm chứng trực quan |
| :--- | :--- | :--- | :--- |
| 1 | `saas_01_login_screen.png` | 1280x850 | Giao diện đăng nhập SaaS có ô nhập School Code |
| 2 | `saas_02_accountant_a_dashboard.png` | 1280x850 | Kế toán Ánh Dương A với huy hiệu trường trên sidebar & topbar |
| 3 | `saas_03_accountant_a_invoices.png` | 1280x850 | Sổ thu học phí Ánh Dương A (chỉ thấy học sinh trường A, không rò rỉ trường B) |
| 4 | `saas_04_accountant_a_schedules.png` | 1280x850 | Thiết lập mức thu học phí mới 4.200.000 đ |
| 5 | `saas_05_accountant_b_invoices.png` | 1280x850 | Đăng nhập Sen Hồng B (chỉ thấy Lê Sen Hồng, không rò rỉ Nguyễn Ánh Dương) |
| 6 | `saas_06_parent_a_portal.png` | 1280x850 | Cổng Phụ huynh Ánh Dương (thấy đúng con mình, không thấy con trường B) |
| 7 | `saas_07_mobile_responsive.png` | 375x812 | Màn hình đăng nhập di động chuẩn hóa |
| 8 | `saas_08_mobile_finance.png` | 375x812 | Màn hình Hóa đơn học phí di động không tràn ngang |
| 9 | `saas_09_mobile_cashbook.png` | 375x812 | Màn hình Đối soát sổ quỹ di động không tràn ngang |

### Danh sách Tập tin Excel đã Xuất và Kiểm chứng qua ExcelJS:

Toàn bộ 4 tập tin Excel được tải về trực tiếp từ browser UI qua hook CDP Blob, được lưu đồng thời vào `docs/screenshots/` và thư mục Artifacts, và được kiểm chứng nội dung bằng ExcelJS:

| STT | Màn hình Xuất File | Tên File Chuẩn Hóa | Tên File Tải Về Thực Tế | Dung Lượng | Số Sheet | Dữ Liệu Trường A (Assert OK) | Chống Rò Rỉ Trường B (Leak Check OK) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | Sổ thu học phí (`/finance?tab=invoices`) | `exported_invoices_anhduong.xlsx` | `HoaDonHocPhi_11-2026_*.xlsx` | 7.875 bytes | 1 (`Hóa đơn học phí`) | Có `Nguyễn Ánh Dương`, `5.500.000 đ` | Tuyệt đối không chứa `Lê Sen Hồng`, `MN-SENHONG-B`, `Sen Hồng` |
| 2 | Biểu phí học phí (`/finance?tab=schedules`) | `exported_fee_schedules_anhduong.xlsx` | `MucThu_11-2026_*.xlsx` | 7.812 bytes | 1 (`Mức thu học phí`) | Có `4.200.000 đ`, `1.300.000 đ`, kỳ `11-2026` | Tuyệt đối không chứa `Lê Sen Hồng`, `MN-SENHONG-B`, `Sen Hồng` |
| 3 | Sổ quỹ & Đối soát (`/accounting/cashbook`) | `exported_cashbook_anhduong.xlsx` | `SoQuyDoiSoat_*.xlsx` | 9.763 bytes | 1 (`Sổ quỹ`) | Có khoản chi `2.500.000 đ`, chứng từ `PC-DIEN-001` | Tuyệt đối không chứa `Lê Sen Hồng`, `MN-SENHONG-B`, `Sen Hồng` |
| 4 | Báo cáo kế toán (`/accounting/report`) | `exported_accounting_report_anhduong.xlsx` | `BaoCaoKeToan_2026-10_*.xlsx` | 8.094 bytes | 1 (`Báo cáo kế toán`) | Có tiêu đề báo cáo và kỳ kế toán `2026-10` | Tuyệt đối không chứa `Lê Sen Hồng`, `MN-SENHONG-B`, `Sen Hồng` |

---

## 4. BẰNG CHỨNG NEGATIVE SELF-CHECK

**Command thực thi**:
```powershell
node backend/scripts/run_saas_browser_verification.js --self-test-negative
```
**Output thực tế**:
```
=== CHẠY NEGATIVE SELF-CHECK: Chứng minh assertion thất bại làm script trả nonzero ===
[SELF-CHECK OK] Đã bắt lỗi đúng như kỳ vọng: SELF_TEST_NEGATIVE_ASSERTION_FAILURE: Bắt buộc thoát với mã lỗi khác 0
```
**Exit Code**: `1` (Chứng minh rằng assertion thất bại sẽ khiến script dừng ngay lập tức và trả mã lỗi khác 0, không che giấu lỗi).

---

## 5. BẰNG CHỨNG DIỄN TẬP MIGRATION DỮ LIỆU & INDEX (REHEARSAL TEST)

**Command thực thi**:
```powershell
npm test --prefix backend -- tests/saas/phase1e_migration_rehearsal.test.js --runInBand --forceExit
```
**Kết quả thực tế**:
```
PASS tests/saas/phase1e_migration_rehearsal.test.js
  SaaS Phase 1E Index Migration Rehearsal (Expanded Security & Edge Cases)
    √ TC1: Khởi tạo các index Global Unique ban đầu & chứng minh xung đột đa trường (130 ms)
    √ TC2: Preflight phát hiện metadata sai cùng tên (cùng tên month_1 nhưng sai keys) (57 ms)
    √ TC3: Preflight phát hiện sai kiểu tenantId (string thay vì ObjectId) (36 ms)
    √ TC4: Preflight phát hiện duplicate collision nội bộ trong cùng một tenant (46 ms)
    √ TC5: Dry-run khảo sát kế hoạch mà KHÔNG thay đổi database (20 ms)
    √ TC6: Apply Migration an toàn (Zero-Downtime: Tạo mới -> Xác minh -> Drop cũ) (146 ms)
    √ TC7: Kiểm chứng sau migration: 2 trường cùng kỳ, cùng ngày, cùng mã thành công 100% (19 ms)
    √ TC8: Bảo toàn tính duy nhất của dữ liệu Legacy (tenantId: null và tenantId missing) (3 ms)
    √ TC9: Chính sách optional receiptNumber: cho phép nhiều bản ghi null/missing/empty string (4 ms)
    √ TC10: Rollback Guard: Có dữ liệu collision đa trường -> TỪ CHỐI ROLLBACK & GIỮ NGUYÊN TARGET INDEXES (44 ms)
    √ TC11: Tính Idempotent và Resumable: Chạy lại Apply nhiều lần an toàn, không lỗi (45 ms)

Test Suites: 1 passed, 1 total
Tests:       11 passed, 11 total
Snapshots:   0 total
Time:        2.524 s
Exit Code:   0
```

### Chi tiết 6 Collection Zone 4 Finance được di chuyển:
1. `AccountingPeriod`:
   - Global cũ: `{ month: 1 }` (unique)
   - Target compound: `{ tenantId: 1, month: 1 }` (unique, partial: `{ tenantId: { $type: 'objectId' } }`)
   - Target legacy: `{ month: 1 }` (unique, partial: `{ tenantId: null }`)
2. `DailyCashReconciliation`:
   - Global cũ: `{ workDate: 1 }` (unique)
   - Target compound: `{ tenantId: 1, workDate: 1 }` (unique, partial)
   - Target legacy: `{ workDate: 1 }` (unique, partial)
3. `OperatingExpenseRequest`:
   - Global cũ: `{ requestKey: 1 }` (unique)
   - Target compound: `{ tenantId: 1, requestKey: 1 }` (unique, partial)
   - Target legacy: `{ requestKey: 1 }` (unique, partial)
4. `FeeSchedule`:
   - Global cũ: `{ period: 1, classroomId: 1 }` (unique)
   - Target compound: `{ tenantId: 1, period: 1, classroomId: 1 }` (unique, partial)
   - Target legacy: `{ period: 1, classroomId: 1 }` (unique, partial)
5. `Payment`:
   - Global cũ: `{ receiptNumber: 1 }` (unique, sparse)
   - Target compound: `{ tenantId: 1, receiptNumber: 1 }` (unique, partial: `{ receiptNumber: { $type: 'string', $gt: '' }, tenantId: { $type: 'objectId' } }`)
   - Target legacy: `{ receiptNumber: 1 }` (unique, partial: `{ receiptNumber: { $type: 'string', $gt: '' }, tenantId: null }`)
6. `OperatingExpense`:
   - Global cũ: `{ documentNumber: 1 }` (unique)
   - Target compound: `{ tenantId: 1, documentNumber: 1 }` (unique, partial)
   - Target legacy: `{ documentNumber: 1 }` (unique, partial)

---

## 6. BẰNG CHỨNG KIỂM THỬ KHÔNG HỒI QUY TOÀN BỘ BACKEND (FULL REGRESSION SUITE)

**Command thực thi**:
```powershell
npm test --prefix backend -- --runInBand --forceExit
```
**Kết quả thực tế từ log thực thi**:
```
Test Suites: 32 passed, 32 total
Tests:       988 passed, 988 total
Snapshots:   0 total
Time:        468.188 s
Exit Code:   0
```
*(Bao gồm toàn bộ 31 suites lịch sử và suite mới `tests/saas/phase1e_migration_rehearsal.test.js` với 11/11 tests PASS; toàn bộ các endpoint SaaS `/api/v1/*` bảo toàn Domain Isolation nghiêm ngặt)*.

---

## 7. BẰNG CHỨNG BUILD FRONTEND & KIỂM TRA CHẤT LƯỢNG MÃ NGUỒN

**Frontend Build**:
```powershell
npm run build --prefix frontend
```
**Kết quả**:
```
✓ 210 modules transformed.
dist/index.html                     1.15 kB │ gzip:   0.63 kB
dist/assets/index-DZdlXUe2.css    307.69 kB │ gzip:  59.69 kB
dist/assets/index-CGmKT3gC.js   1,293.35 kB │ gzip: 313.62 kB
✓ built in 1.51s
Exit Code: 0
```

**Git Diff & Code Hygiene**:
```powershell
git diff --check
```
**Kết quả**: Exit Code `0` (Không có bất kỳ lỗi cú pháp, khoảng trắng thừa hay conflict markers).

---

## 8. QUY TRÌNH HƯỚNG DẪN KHI TRIỂN KHAI PRODUCTION THỰC TẾ

Khi Codex và người dùng có chỉ thị áp dụng Phase 1E vào môi trường và cơ sở dữ liệu thật, các bước thực hiện tuần tự như sau:

> [!CAUTION]
> Tuyệt đối không chạy lệnh migration khi chưa sao lưu cơ sở dữ liệu và chưa xác minh chuỗi kết nối mục tiêu.

1. **Bước 1: Xác minh Chuỗi kết nối và Điều kiện Tiên quyết**:
   - Chuỗi kết nối mục tiêu: Thay thế `<TARGET_MONGO_URI>` bằng URI thực tế, ví dụ `mongodb://localhost:27018/<DB_NAME>?replicaSet=rs0`.
   - Xác minh database đang chạy có hỗ trợ Replica Set (WiredTiger transaction).
2. **Bước 2: Sao lưu Cơ sở dữ liệu (Backup)**:
   ```bash
   mongodump --uri="<TARGET_MONGO_URI>" --out="./backup_pre_phase1e_indexes"
   ```
3. **Bước 3: Khảo sát Thử nghiệm (Dry-Run)**:
   ```powershell
   $env:MIGRATION_MONGO_URI = "<TARGET_MONGO_URI>"
   node backend/scripts/saas_phase1e_index_migration.js --dry-run
   ```
   Kiểm tra báo cáo preflight: Xác nhận không có metadata sai, không có kiểu `tenantId` không hợp lệ, không có xung đột dữ liệu nội bộ tenant.
4. **Bước 4: Thực hiện Chuyển đổi Index (Apply)**:
   ```powershell
   $env:MIGRATION_MONGO_URI = "<TARGET_MONGO_URI>"
   node backend/scripts/saas_phase1e_index_migration.js --apply
   ```
   Quy trình Create-Before-Drop sẽ tự động tạo index mới, kiểm tra trạng thái active rồi mới xóa index cũ.
5. **Bước 5: Kịch bản Phục hồi nếu Cần thiết (Rollback)**:
   ```powershell
   $env:MIGRATION_MONGO_URI = "<TARGET_MONGO_URI>"
   node backend/scripts/saas_phase1e_index_migration.js --rollback
   ```
   *Lưu ý*: Nếu hệ thống đã phát sinh dữ liệu trùng lặp chéo giữa các trường học mới tạo, Rollback Guard sẽ tự động từ chối rollback để bảo vệ dữ liệu trường học.
6. **Bước 6: Chuyển đổi Entrypoint và Khởi động Lại Dịch vụ**:
   - Cập nhật cấu hình dịch vụ backend chuyển sang chạy qua SaaS factory `createSaasApp({ saasMode: 'phase1e' })`.
   - Khởi động lại dịch vụ backend và frontend.

---

## 9. KẾT LUẬN & TRẠNG THÁI HIỆN TẠI

1. Mọi yêu cầu kỹ thuật về API Routing, Tenant Session, Create-Before-Drop Migration, Rollback Guard, Domain Isolation, và Browser E2E Automation đã được Antigravity thực hiện và kiểm chứng trọn vẹn với bằng chứng thực tế từ log chạy trực tiếp.
2. Không có bất kỳ thay đổi nào làm ảnh hưởng tới dirty/untracked worktree có sẵn, runtime người dùng (5001/5173/27018 rs0), hoặc dữ liệu thật.
3. Antigravity xin dừng lại ở đây để Codex tiến hành thẩm định và nghiệm thu độc lập.
