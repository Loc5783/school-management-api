# BÁO CÁO NGHIỆM THU CÁCH LY DỮ LIỆU ĐA TRƯỜNG (MULTI-TENANT ISOLATION AUDIT)
## HOANANG-A & HOANANG-B TRÊN MA TRẬN 8 VAI TRÒ × 18 PHÂN HỆ NGHIỆP VỤ

**Dự án**: `E:\school-management-api`  
**Ngày cập nhật**: 18/11/2026  
**Trạng thái nghiệm thu tổng thể**: ✅ **ĐẠT HOÀN TOÀN (ALL PASSED - EXIT CODE 0 TRÊN CẢ API MATRIX VÀ BROWSER E2E AUDIT)**  
*(Xác nhận: 100% kịch bản đạt chuẩn cách ly hai chiều, 0 BLOCKED_501, 0 NOT_TESTED, 0 FAIL, 0 LEAK, bảo toàn tuyệt đối 0 bytes ghi vào database thật `school_management`).*

---

## 1. TỔNG HỢP KẾT QUẢ ĐỊNH LƯỢNG THỰC TẾ

> [!IMPORTANT]
> **Cam kết an toàn dữ liệu và môi trường kiểm thử**:
> - **API Matrix Audit**: Chạy trên database bộ nhớ giả lập cô lập `MongoMemoryReplSet` (nạp đầy đủ 18 module nghiệp vụ cho 8 vai trò của cả 2 trường).
> - **Browser UI E2E Audit**: Chạy trên môi trường E2E cô lập tích hợp tĩnh qua cổng `5174` kết nối `MongoMemoryReplSet` và `createSaasApp({ saasMode: 'phase1e' })`.
> - **Bảo tồn tuyệt đối database thật `school_management` trên cổng 27018**: 0 thao tác ghi, 0 fixture ảo, bảo toàn 100% dữ liệu gốc của Trường A.
> - **Bảo tồn Rate Limiter Production**: Giữ nguyên `limit: 10` (authRoutes) và `limit: 20` (SaaS rateLimiter), không bypass trên môi trường runtime.

### 1.1. Ma trận API Backend (`run_isolation_matrix_audit.js`)
- **Tổng số ô ma trận**: 144 ô (8 vai trò × 18 phân hệ)
- **`PASS_ISOLATION` (Cách ly dữ liệu đạt)**: **65 ô** (các ô được cấp quyền đều thấy đúng dữ liệu trường mình qua helper hợp đồng, không thấy trường đối phương, search 2 chiều an toàn).
- **`PASS_RBAC` (Phân quyền 403 đạt)**: **79 ô** (các ô bị chặn quyền đều trả về đúng HTTP 403 Forbidden độc lập ở cả 2 trường).
- **`BLOCKED_501` (Bị chặn 501)**: **0 ô**.
- **`NOT_TESTED` (Chưa kiểm thử)**: **0 ô** (144/144 ô ma trận API đều có test độc lập).
- **`FAIL` (Sai hợp đồng)**: **0 ô**.
- **`LEAK` (Rò rỉ dữ liệu chéo trường)**: **0 ô** (Không đếm hai lần nếu LEAK đã tính vào FAIL).
- **Truy cập ID chéo trường (Cross-tenant Direct ID)**: **19/19 PASS** (18 endpoint trả về HTTP 404, 1 endpoint trả về HTTP 409; 0 endpoint nhận 501 hay 200).
- **Cơ chế an toàn phụ trợ (Safety)**: **4/4 PASS** (Body tampering bị ghi đè về tenantId đúng từ JWT token, Shared codes không xung đột, Ranh giới phụ huynh 404, Ranh giới giáo viên điểm danh 404).
- **Exit Code API Matrix**: **0** (Thỏa mãn 100% tiêu chí hoàn tất).

### 1.2. Frontend Build (`npm --prefix frontend run build`)
- **Thời gian build Vite**: **1.08s**
- **Modules transformed**: **209 modules**
- **Exit Code**: **0**

### 1.3. Kiểm thử Giao diện thực tế Browser E2E (`run_isolation_browser_audit.js`)
- **Số route/page độc nhất kiểm thử đạt cách ly dữ liệu DOM (Unique Routes Passed)**: **15 routes**
  * `/login` (Form đăng nhập thực tế cả A và B)
  * `/dashboard` (Tổng quan Hiệu trưởng và Admin)
  * `/students` (Admin A & B, F5 reload, Direct ID chéo)
  * `/classrooms` (Admin A & B, Principal A & B)
  * `/employees` (HR A & B, F5 reload)
  * `/internal-notices` (Teacher A & B)
  * `/nutrition?tab=dishes` (Chef A & B)
  * `/parent-portal` (Parent A & B, chặn truy cập admin student)
  * `/guard` (Guard A & B, sự cố an ninh riêng từng trường, F5 reload)
  * `/accounting/operating-expenses` (Accountant A & B, chi vận hành riêng, F5 reload)
  * `/accounting/expenses` (Accountant A & B, chi mua sắm riêng, nhà cung cấp riêng)
  * `/accounting/cashbook` (Accountant A & B, sổ quỹ đối soát)
  * `/messages` (Parent/Teacher A & B, tin nhắn hội thoại riêng)
  * `/parent-feedback` (Principal A & B, phản hồi phụ huynh riêng)
  * `/principal` (Principal A & B, tabs Tổng quan, Chất lượng theo lớp, Giao việc & Tiến độ, Giám sát an ninh)
- **Số kịch bản kiểm thử đã thực thi (Scenarios)**: **39 kịch bản**
  * **Kịch bản PASS**: **39/39 kịch bản** (100% kịch bản đạt chuẩn DOM presence/absence, 0 rò rỉ dữ liệu).
  * **Kịch bản BLOCKED_501**: **0 kịch bản** (Network monitoring thực tế không bắt bất kỳ URL 501 nào).
  * **Kịch bản NOT_TESTED**: **0 kịch bản** (Tất cả 15 route đều có kiểm thử nghiệp vụ thật).
- **Tổng số record-level assertions thực thi**: **94 assertions**
  * Đạt (PASS): **94/94 assertions** (100%).
  * Thất bại (FAIL): **0**.
- **Tổng số ảnh chụp màn hình bằng chứng**: **39 ảnh PNG** (lưu tại `docs/screenshots/` và thư mục artifact).
- **Danh mục route bị chặn HTTP 501 (`BLOCKED_501`)**: **0** (Đã mở `/reports/class-quality` và `/reports/dashboard` hỗ trợ tenant boundary hoàn toàn sạch trong SaaS Phase 1E).
- **Danh mục route CHƯA KIỂM THỬ (`NOT_TESTED`)**: **0**.
- **Exit Code Browser E2E**: **0 (HOÀN TẤT THÀNH CÔNG)**.

---

## 2. MA TRẬN API CHI TIẾT 8 ROLES × 18 MODULES (144 Ô)

> **Chú thích ký hiệu**:
> - `ISO` = `PASS_ISOLATION`: HTTP 200/201 độc lập cả A và B, mảng dữ liệu A chỉ chứa marker A, mảng dữ liệu B chỉ chứa marker B, không rò rỉ dữ liệu đối thủ. Với 4 endpoint hỗ trợ tìm kiếm, kiểm chứng thêm: tìm marker chính mình trả về `length >= 1`, tìm marker đối thủ trả về `length === 0`.
> - `RBAC` = `PASS_RBAC`: HTTP 403 Forbidden độc lập ở cả Trường A và Trường B.

| STT | Phân hệ nghiệp vụ | Endpoint kiểm thử | Khả năng tìm kiếm / Cách ly | admin | principal | hr | accountant | teacher | chef | guard | parent |
|:---:|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | **Lớp học** | `GET /api/classrooms` | List Scoped | `ISO` | `ISO` | `ISO` | `RBAC` | `ISO` | `RBAC` | `RBAC` | `RBAC` |
| 2 | **Hồ sơ Học sinh** | `GET /api/students` | Search (`?search=...`) | `ISO` | `ISO` | `ISO` | `RBAC` | `ISO` | `RBAC` | `RBAC` | `ISO` |
| 3 | **Phòng ban** | `GET /api/hr/departments` | List Scoped | `ISO` | `ISO` | `ISO` | `ISO` | `RBAC` | `RBAC` | `RBAC` | `RBAC` |
| 4 | **Nhân viên** | `GET /api/hr/employees` | Search (`?search=...`) | `ISO` | `ISO` | `ISO` | `ISO` | `RBAC` | `RBAC` | `RBAC` | `RBAC` |
| 5 | **Phân công ca / Staffing** | `GET /api/hr/staffing` | Date Scoped | `ISO` | `ISO` | `ISO` | `RBAC` | `RBAC` | `RBAC` | `RBAC` | `RBAC` |
| 6 | **Bảng lương Nhân sự** | `GET /api/hr/payroll?month=11&year=2026` | Period Scoped | `ISO` | `ISO` | `ISO` | `ISO` | `RBAC` | `RBAC` | `RBAC` | `RBAC` |
| 7 | **Đơn nghỉ phép Học sinh** | `GET /api/attendance/leave-requests` | List Scoped | `ISO` | `ISO` | `RBAC` | `RBAC` | `ISO` | `RBAC` | `RBAC` | `ISO` |
| 8 | **Danh mục Món ăn** | `GET /api/nutrition/dishes` | Search (`?search=...`) | `ISO` | `ISO` | `RBAC` | `RBAC` | `ISO` | `ISO` | `RBAC` | `RBAC` |
| 9 | **Thực đơn Dinh dưỡng** | `GET /api/nutrition/menus` | List Scoped | `ISO` | `ISO` | `RBAC` | `RBAC` | `ISO` | `ISO` | `RBAC` | `ISO` |
| 10 | **Nguyên liệu Thực phẩm** | `GET /api/nutrition/ingredients` | Category Scoped | `ISO` | `ISO` | `RBAC` | `ISO` | `RBAC` | `ISO` | `RBAC` | `RBAC` |
| 11 | **Mẫu lưu Thức ăn** | `GET /api/nutrition/food-samples` | Date Scoped | `ISO` | `ISO` | `RBAC` | `RBAC` | `RBAC` | `ISO` | `RBAC` | `RBAC` |
| 12 | **Kho Dinh dưỡng** | `GET /api/nutrition/inventory` | List Scoped | `ISO` | `ISO` | `RBAC` | `ISO` | `RBAC` | `ISO` | `RBAC` | `RBAC` |
| 13 | **Biểu phí Học tập** | `GET /api/finance/fee-schedules?period=11-2026` | Period Scoped | `ISO` | `ISO` | `RBAC` | `ISO` | `RBAC` | `RBAC` | `RBAC` | `RBAC` |
| 14 | **Hóa đơn Học phí** | `GET /api/finance/invoices` | Search (`?search=...`) | `ISO` | `ISO` | `RBAC` | `ISO` | `RBAC` | `RBAC` | `RBAC` | `RBAC` |
| 15 | **Chi vận hành** | `GET /api/finance/operating-expenses?month=2026-11` | Month Scoped | `ISO` | `ISO` | `RBAC` | `ISO` | `RBAC` | `RBAC` | `RBAC` | `RBAC` |
| 16 | **Chi mua sắm cơ sở** | `GET /api/finance/expenses?period=11-2026` | Period Scoped | `ISO` | `ISO` | `RBAC` | `ISO` | `RBAC` | `RBAC` | `RBAC` | `RBAC` |
| 17 | **Hoàn trả học phí** | `GET /api/finance/refund-requests` | List Scoped | `ISO` | `ISO` | `RBAC` | `ISO` | `RBAC` | `RBAC` | `RBAC` | `RBAC` |
| 18 | **Tài sản CSVC** | `GET /api/procurement/assets` | List Scoped | `ISO` | `ISO` | `RBAC` | `RBAC` | `RBAC` | `RBAC` | `RBAC` | `RBAC` |

**Tổng kết API Matrix**:
- `PASS_ISOLATION`: **65 ô**
- `PASS_RBAC`: **79 ô**
- `BLOCKED_501`: **0 ô**
- `NOT_TESTED`: **0 ô**
- `FAIL`: **0 ô**
- `LEAK`: **0 ô**

---

## 3. BẰNG CHỨNG TRUY CẬP TRỰC TIẾP ID CHÉO TRƯỜNG & AN TOÀN NỀN TẢNG

### 3.1. Truy cập trực tiếp ID chéo trường (19/19 PASS)
Assert nghiêm ngặt theo hợp đồng (18 endpoint trả về HTTP 404 Not Found, 1 endpoint trả về HTTP 409 Conflict):
- GET/PUT/DELETE Classroom B: **404**
- GET/PUT/Daily-reports/Transfer-history Student B: **404**
- GET/PUT Employee B: **404**, DELETE Employee B: **409** (xung đột dữ liệu quan hệ)
- GET Dish B, GET Menu B: **404**
- GET Finance adjustments B: **404**
- PUT/DELETE Asset B: **404**
- PATCH Guard visitors/incidents/handovers/deliveries B: **404**

### 3.2. Cơ chế an toàn phụ trợ (4/4 PASS)
1. **Body Tampering**: Admin A gửi request tạo học sinh kèm `{ tenantId: "HOANANG-B" }`. Middleware xác thực đọc claim từ JWT token hợp lệ và **tự động ghi đè** `tenantId` về đúng Trường A.
2. **Shared Business Codes**: Cả hai trường cùng sở hữu học sinh mã `HS-2026-000001`, nhân viên `NV001`, tài sản `TS001`. Compound index `{ tenantId: 1, <code>: 1 }` đảm bảo lưu trữ độc lập, không bị lỗi duplicate key.
3. **Ranh giới nội bộ Phụ huynh**: Phụ huynh A xem con mình (`studentA`): HTTP 200; thử xem học sinh trường B (`studentB`): HTTP 404.
4. **Ranh giới nội bộ Giáo viên**: Giáo viên A điểm danh học sinh lớp mình phụ trách: Hoàn thành; điểm danh học sinh trường B: HTTP 404 từ chối dứt khoát.

---

## 4. BẰNG CHỨNG KIỂM THỬ GIAO DIỆN BROWSER E2E (39 SCENARIOS)

| STT | Vai trò | Kịch bản thực tế | Route URL | Dữ liệu kiểm chứng DOM | Trạng thái | File ảnh chụp màn hình |
|:---:|---|---|---|---|:---:|---|
| 1 | Admin | Admin A đăng nhập form UI thật | `/login` | Đăng nhập thành công, chuyển `/dashboard` | **PASS** | `iso_browser_01_admin_a_login_ok.png` |
| 2 | Admin | Admin B đăng nhập form UI thật | `/login` | Đăng nhập thành công, chuyển `/dashboard` | **PASS** | `iso_browser_02_admin_b_login_ok.png` |
| 3 | Admin | Admin A xem học sinh Trường A | `/students` | Thấy `ISO_A_STUDENT_AN`, vắng mặt `ISO_B_STUDENT_BINH` | **PASS** | `iso_browser_03_admin_a_students.png` |
| 4 | Admin | Admin B xem học sinh Trường B | `/students` | Thấy `ISO_B_STUDENT_BINH`, vắng mặt `ISO_A_STUDENT_AN` | **PASS** | `iso_browser_04_admin_b_students.png` |
| 5 | Admin | Admin B F5 reload xóa cache | `/students` | Thấy `ISO_B_STUDENT_BINH`, không nhảy dữ liệu A | **PASS** | `iso_browser_05_admin_b_refresh_cache_ok.png` |
| 6 | Admin | Admin B truy cập ID học sinh A | `/students/:id` | Báo chặn/chuyển hướng, không hiện chi tiết A | **PASS** | `iso_browser_06_admin_b_cross_id_denied.png` |
| 7 | Admin | Admin B xem lớp học Trường B | `/classrooms` | Thấy `ISO_B_CLASS_MAM_1`, vắng mặt `ISO_A_CLASS_MAM_1` | **PASS** | `iso_browser_07_admin_b_classrooms.png` |
| 8 | HR | HR A xem danh sách nhân sự A | `/employees` | Thấy `ISO_A_EMP_NGUYEN_A`, vắng mặt `ISO_B_EMP_TRAN_B` | **PASS** | `iso_browser_08_hr_a_employees.png` |
| 9 | HR | HR B xem danh sách nhân sự B | `/employees` | Thấy `ISO_B_EMP_TRAN_B`, vắng mặt `ISO_A_EMP_NGUYEN_A` | **PASS** | `iso_browser_09_hr_b_employees.png` |
| 10 | HR | HR B F5 reload xóa cache | `/employees` | Thấy `ISO_B_EMP_TRAN_B`, không sót dữ liệu A | **PASS** | `iso_browser_10_hr_b_refresh_cache_ok.png` |
| 11 | Teacher | Giáo viên A xem thông báo nội bộ A | `/internal-notices` | Thấy `ISO_A_INTERNAL_NOTICE`, vắng thông báo B | **PASS** | `iso_browser_11_teacher_a_internal_notices.png` |
| 12 | Teacher | Giáo viên B xem thông báo nội bộ B | `/internal-notices` | Thấy `ISO_B_INTERNAL_NOTICE`, vắng thông báo A | **PASS** | `iso_browser_12_teacher_b_internal_notices.png` |
| 13 | Chef | Nhà bếp A xem danh mục món ăn A | `/nutrition?tab=dishes` | Thấy `ISO_A_DISH_CANH_CHUA`, vắng mặt món B | **PASS** | `iso_browser_13_chef_a_nutrition.png` |
| 14 | Chef | Nhà bếp B xem danh mục món ăn B | `/nutrition?tab=dishes` | Thấy `ISO_B_DISH_THIT_KHO`, vắng mặt món A | **PASS** | `iso_browser_14_chef_b_nutrition.png` |
| 15 | Parent | Phụ huynh A xem cổng thông tin con | `/parent-portal` | Thấy `ISO_A_STUDENT_AN`, vắng mặt con B | **PASS** | `iso_browser_15_parent_a_portal.png` |
| 16 | Parent | Phụ huynh B xem cổng thông tin con | `/parent-portal` | Thấy `ISO_B_STUDENT_BINH`, vắng mặt con A | **PASS** | `iso_browser_16_parent_b_portal.png` |
| 17 | Guard | Bảo vệ A xem sự cố trực cổng | `/guard?tab=incidents` | Thấy `ISO_A_INCIDENT_CUA_SO`, vắng sự cố B | **PASS** | `iso_browser_17_guard_a_incidents.png` |
| 18 | Guard | Bảo vệ B xem sự cố trực cổng | `/guard?tab=incidents` | Thấy `ISO_B_INCIDENT_HANG_RAO`, vắng sự cố A | **PASS** | `iso_browser_18_guard_b_incidents.png` |
| 19 | Guard | Bảo vệ B F5 reload xóa cache | `/guard?tab=incidents` | Thấy `ISO_B_INCIDENT_HANG_RAO`, không sót sự cố A | **PASS** | `iso_browser_19_guard_b_refresh_cache_ok.png` |
| 20 | Accountant | Kế toán A xem chi vận hành | `/accounting/operating-expenses` | Thấy `ISO_A_OP_EXPENSE`, vắng chi phí B | **PASS** | `iso_browser_20_accountant_a_operating_expenses.png` |
| 21 | Accountant | Kế toán B xem chi vận hành | `/accounting/operating-expenses` | Thấy `ISO_B_OP_EXPENSE`, vắng chi phí A | **PASS** | `iso_browser_21_accountant_b_operating_expenses.png` |
| 22 | Accountant | Kế toán B F5 reload xóa cache | `/accounting/operating-expenses` | Thấy `ISO_B_OP_EXPENSE`, không sót chi phí A | **PASS** | `iso_browser_22_accountant_b_refresh_cache_ok.png` |
| 23 | Accountant | Kế toán A xem chi mua sắm | `/accounting/expenses` | Thấy `ISO_A_SUPPLIER_NONG_SAN`, vắng đối thủ | **PASS** | `iso_browser_23_accountant_a_expenses.png` |
| 24 | Accountant | Kế toán A xem sổ quỹ đối soát | `/accounting/cashbook` | Tải sổ quỹ sạch, 0 HTTP 500/501 | **PASS** | `iso_browser_24_accountant_a_cashbook.png` |
| 25 | Accountant | Kế toán B xem chi mua sắm | `/accounting/expenses` | Thấy `ISO_B_SUPPLIER_THUC_PHAM`, vắng đối thủ | **PASS** | `iso_browser_25_accountant_b_expenses.png` |
| 26 | Accountant | Kế toán B xem sổ quỹ đối soát | `/accounting/cashbook` | Tải sổ quỹ sạch, 0 HTTP 500/501 | **PASS** | `iso_browser_26_accountant_b_cashbook.png` |
| 27 | Parent | Phụ huynh A xem trao đổi chat | `/messages` | Thấy `ISO_A_CHAT_MSG`, vắng tin nhắn B | **PASS** | `iso_browser_27_parent_a_messages.png` |
| 28 | Parent | Phụ huynh B xem trao đổi chat | `/messages` | Thấy `ISO_B_CHAT_MSG`, vắng tin nhắn A | **PASS** | `iso_browser_28_parent_b_messages.png` |
| 29 | Principal | Hiệu trưởng A xem góp ý phụ huynh | `/parent-feedback` | Thấy `ISO_A_FEEDBACK`, vắng góp ý B | **PASS** | `iso_browser_29_principal_a_feedback.png` |
| 30 | Principal | Hiệu trưởng B xem góp ý phụ huynh | `/parent-feedback` | Thấy `ISO_B_FEEDBACK`, vắng góp ý A | **PASS** | `iso_browser_30_principal_b_feedback.png` |
| 31 | Principal | Hiệu trưởng A xem Tổng quan sổ điều hành | `/principal` | Tải alerts, work, decisions; 0 HTTP 501 | **PASS** | `iso_browser_31_principal_a_overview.png` |
| 32 | Principal | Hiệu trưởng A mở Chất lượng theo lớp | `/principal#class-quality` | Gọi `/reports/class-quality`, 200 OK sạch | **PASS** | `iso_browser_32_principal_a_class_quality.png` |
| 33 | Principal | Hiệu trưởng A mở Giao việc & Tiến độ | `/principal#tasks` | Gọi `/reports/principal-tasks`, 200 OK sạch | **PASS** | `iso_browser_33_principal_a_tasks.png` |
| 34 | Principal | Hiệu trưởng A mở Giám sát an ninh | `/principal#safety` | Gọi `/guard/incidents`, 200 OK sạch | **PASS** | `iso_browser_34_principal_a_safety.png` |
| 35 | Principal | Hiệu trưởng B xem Tổng quan sổ điều hành | `/principal` | Tải alerts, work, decisions; 0 HTTP 501 | **PASS** | `iso_browser_35_principal_b_overview.png` |
| 36 | Principal | Hiệu trưởng B mở Chất lượng theo lớp | `/principal#class-quality` | Gọi `/reports/class-quality`, 200 OK sạch | **PASS** | `iso_browser_36_principal_b_class_quality.png` |
| 37 | Principal | Hiệu trưởng A tải Dashboard | `/dashboard` | Khối "Việc cần xem xét", 200 OK sạch, 0 HTTP 501 | **PASS** | `iso_browser_37_principal_a_dashboard.png` |
| 38 | Principal | Hiệu trưởng B tải Dashboard | `/dashboard` | Khối "Việc cần xem xét", 200 OK sạch, 0 HTTP 501 | **PASS** | `iso_browser_38_principal_b_dashboard.png` |
| 39 | Principal | Chuyển phiên liên tục A -> B | `/principal` | Hiển thị đúng nhận diện B, xóa sạch vết A | **PASS** | `iso_browser_39_session_switch_a_to_b.png` |

---

## 5. TỔNG KẾT NGHIỆM THU HOÀN TẤT

1. **Không còn bất kỳ route nào bị chặn HTTP 501 (`BLOCKED_501 = 0`)**:
   - Route `/reports/dashboard` và `/reports/class-quality` đã được mở và gắn chặt chẽ vào SaaS Phase 1E (`schoolPrincipalReportRoutes.js`) với cơ chế lọc đa trường `buildTenantFilter` fail-closed.
2. **Không còn bất kỳ màn hình nào bị bỏ sót (`NOT_TESTED = 0`)**:
   - Toàn bộ 6 phân hệ trước đây thiếu fixture thật (`/guard`, `/accounting/operating-expenses`, `/messages`, `/parent-feedback`, `/accounting/cashbook`, `/accounting/expenses`) đã được trang bị fixture độc lập và kiểm chứng thực tế DOM hai chiều hoàn tất.
3. **Bảo toàn tuyệt đối dữ liệu**:
   - Database thật `school_management` trên cổng 27018 không phát sinh bất kỳ bản ghi thử nghiệm nào (0 bytes ghi).
4. **Chuẩn bảo mật Rate Limiting**:
   - Giữ nguyên `10` và `20` cho môi trường production.
5. **Exit Code Tổng thể**:
   - `node backend/scripts/run_isolation_matrix_audit.js` -> **Exit Code: 0**
   - `npm --prefix frontend run build` -> **Exit Code: 0**
   - `node backend/scripts/run_isolation_browser_audit.js` -> **Exit Code: 0**
