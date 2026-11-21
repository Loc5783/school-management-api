# BÁO CÁO NGHIỆM THU DIỄN TẬP VÀ ĐÁNH GIÁ TÁC ĐỘNG CUTOVER HAI TRƯỜNG (HOANANG-A & HOANANG-B)

> **Tài liệu:** `docs/HOANANG-A-B-CUTOVER-HANDOFF.md`  
> **Dự án:** `school-management-api` (`E:\school-management-api`)  
> **Mốc thực hiện:** Diễn tập Cutover Bản Chính sang SaaS Multi-Tenant (Hoa Nắng A & Hoa Nắng B — Test)  
> **Tác nhân thực hiện:** Antigravity  
> **Người điều phối & nghiệm thu độc lập:** Codex  
> **Thời điểm cập nhật:** 13/11/2026 10:35:00 +07:00  
> **Kết quả thực thi:** `node backend/scripts/rehearse_cutover.js` -> **EXIT CODE 0 (89/89 ASSERTIONS PASS)**  
> **File lưu log & summary thực tế ngoài repo:**  
> - Summary JSON: `E:\school-mongo-recovery-20261106\two-school-test-20261111\rehearsal_run_summary.json`  
> - Execution Log: `E:\school-mongo-recovery-20261106\two-school-test-20261111\rehearsal_run.log`  
> **Trạng thái cốt lõi:** **ĐÃ HOÀN THÀNH DIỄN TẬP 100% TRÊN MÔI TRƯỜNG CÔ LẬP — TẠM DỪNG TRƯỚC KHI APPLY VÀO DATABASE THẬT `school_management` THEO ĐÚNG NGUYÊN TẮC AN TOÀN DO CÓ BLOCKER TÍNH NĂNG NGHIỆP VỤ NHÀ BẾP VÀ CÁC MODULE 501**.

---

## 1. TỔNG QUAN HIỆN TRẠNG VÀ BẢO TOÀN HỆ THỐNG

| Tiêu chí | Trạng thái thực tế | Bằng chứng kiểm chứng |
| :--- | :--- | :--- |
| **Đã apply vào bản chính hay chưa?** | **CHƯA APPLY VÀO DB THẬT** (`school_management`) | Tuân thủ tuyệt đối: Không migration, không drop index, không đổi dữ liệu thật khi chưa nghiệm thu và có lệnh từ Codex. |
| **Môi trường diễn tập (Rehearsal)** | **THÀNH CÔNG 100% (EXIT CODE 0)** | Thực thi trên DB cô lập `school_rehearsal_20261111`, phục hồi từ snapshot mới `snapshot_fresh.ejson` (1.834 docs / 89 collections). |
| **Tiến trình runtime người dùng** | Giữ nguyên vẹn, không gián đoạn | Frontend `:5173`, Backend `:5001`, Mongo `:27018` (rs0). Scheduler tắt (`TIMEKEEPING_SCHEDULER_ENABLED=false`). |
| **Bảo toàn 15 tài khoản Legacy** | **100% NGUYÊN VẸN** | Giữ nguyên `_id`, `username`, `passwordHash`, `role`, `status` (tài khoản `123` giữ nguyên `suspended`). |
| **Mã trường A / B** | Trường A: `HOANANG-A` (`Hoa Nắng A`)<br>Trường B: `HOANANG-B` (`Hoa Nắng B — Test`) | Đăng nhập HTTP thật trả về tenant code chuẩn, tích hợp huy hiệu trên UI. |
| **Thông tin đăng nhập ngoài repo** | File chứng chỉ bảo mật ngoài repo | - Tài khoản A cũ: `E:\school-mongo-recovery-20261106\two-school-test-20261111\legacy_known_credentials.json`<br>- Tài khoản B mới: `E:\school-mongo-recovery-20261106\two-school-test-20261111\tenant_b_credentials.json`. Tuyệt đối không log mật khẩu/token. |
| **Git Worktree** | Giữ nguyên dirty/untracked files | Không commit, không push, không reset, không stash. |

---

## 2. PHẦN 1: CÁC NỘI DUNG ĐÃ CHỨNG MINH (VERIFIED PROOFS)

Kịch bản kiểm thử nghiêm ngặt `backend/scripts/rehearse_cutover.js` đã chạy tự động và vượt qua **chính xác 89/89 assertions với exit code 0**:

### 2.1. Phục hồi Snapshot & Chuẩn hóa Đối chiếu Toàn diện 5 Thuộc tính Index (Không nuốt lỗi)
- Snapshot nguồn: `snapshot_fresh.ejson` (1.834 documents trên 89 collections).
- Toàn bộ index của 89 collections được đối chiếu và phục hồi chính xác (xử lý chuẩn hóa text index `fullName_text` và collection rỗng).
- Đối chiếu nghiêm ngặt cả 5 thuộc tính: `name`, `key`, `unique`, `sparse`, và `partialFilterExpression` (sau chuẩn hóa canonicalize). Bất kỳ sai lệch nào đều ném ngoại lệ dừng ngay lập tức; không có lỗi `createIndex` nào bị nuốt.

### 2.2. Kiểm tra chặt chẽ Manifest theo từng Collection (Fail-Closed)
- `COLLECTION_MANIFEST` gồm 94 định nghĩa collections:
  * Kiểm tra fail-closed: Phát hiện 0 collection ngoại lai ngoài manifest.
  * Kiểm tra tiền kiểm: 100% số lượng document ban đầu của từng collection khớp chính xác với `expectedCount` trong manifest trước khi thực hiện bất kỳ thay đổi nào.
  * Với các collection nghiệp vụ gán sang Trường A (`spec.action === 'ASSIGN_TENANT_ID'`):
    - Khớp số document legacy ban đầu `initialLegacyCount === actualDocCount`.
    - Khớp `modifiedCount === initialLegacyCount`.
    - Khớp số document gán vào A `assignedCount === initialLegacyCount`.
    - Khẳng định số bản ghi còn thiếu `tenantId` bằng 0 (`missingCount === 0`).
  * Khẳng định chính xác **đúng 59 business collections có dữ liệu thực tế** được gán `tenantId` cho Hoa Nắng A.
  * Các collection platform/catalog dùng chung (`tenants`, `platform_admins`, `permissions`, `importidempotencies`) được xác minh không bị gán `tenantId` trái phép (0 bản ghi mang tenantId).

### 2.3. Chuyển đổi và Kiểm chứng va chạm (Collision Tests) cho 9 nhóm Index
Cả 9 nhóm index cốt lõi đều vượt qua 3 bài test nghiêm ngặt (Drop index cũ -> Tạo compound tenant index -> Test trùng mã cùng trường ném E11000 -> Test trùng mã khác trường thành công):
1. `accountingperiods`: `month_1` -> `tenantId_1_month_1_unique` (PASS)
2. `dailycashreconciliations`: `workDate_1` -> `tenantId_1_workDate_1_unique` (PASS)
3. `operatingexpenserequests`: `requestKey_1` -> `tenantId_1_requestKey_1_unique` (PASS)
4. `feeschedules`: `period_1_classroomId_1` -> `tenantId_1_period_1_classroomId_1_unique` (PASS)
5. `payments`: `receiptNumber_1` -> `tenantId_1_receiptNumber_1_unique` (PASS)
6. `operatingexpenses`: `documentNumber_1` -> `tenantId_1_documentNumber_1_unique` (PASS)
7. `departments`: `code_1` -> `tenantId_1_code_1_unique` (PASS)
8. `employees`: `employeeCode_1` -> `tenantId_1_employeeCode_1_unique` (PASS)
9. `classrooms`: `schoolYear_1_homeroomTeacherId_1` -> `tenantId_1_schoolYear_1_homeroomTeacherId_1_unique` (PASS)

### 2.4. Đăng nhập HTTP thật với Mật khẩu đọc từ nguồn cục bộ ngoài Repo
- Đọc mật khẩu tài khoản A an toàn từ file `legacy_known_credentials.json` ngoài repository:
  * Kế toán A: `accountant` với `schoolCode: 'HOANANG-A'` -> **200 OK**, trả về `tenant: { code: 'HOANANG-A', name: 'Hoa Nắng A' }` cho frontend.
  * Phụ huynh A: `phuhuynh.mgl45` với `schoolCode: 'HOANANG-A'` -> **200 OK**.
  * Tài khoản bị khóa `123` (suspended) -> Bị từ chối **401 ACCOUNT_LOCKED**.
  * Phụ huynh B (`phuhuynh_b`), Quản trị B (`admin_b`) đăng nhập thành công với `schoolCode: 'HOANANG-B'` -> **200 OK**.
  * Không in mật khẩu hay access token vào console log và file log.

### 2.5. Phụ huynh xem con & Cách ly chéo Tenant
- **Xem đúng trường**:
  * Phụ huynh A xem đúng con mình (`6aa36ef9ee9f85ced6895ac4` - Bé Nguyễn Đức Anh) -> **200 OK**, trả về dữ liệu đúng học sinh.
  * Phụ huynh B xem đúng con mình (`Nguyễn Văn Bé (B)`) -> **200 OK**, trả về dữ liệu đúng học sinh B.
- **Cách ly cùng trường (Parent Scoping)**:
  * Phụ huynh A gọi API xem một học sinh khác trong cùng trường A (`6a867ae109e25f78bd01aaab` - Bé Nguyễn Văn A) -> **Bị chặn HTTP 403 Forbidden**.
- **Cách ly chéo trường (Cross-Tenant Boundary)**:
  * Phụ huynh A dùng token Trường A gọi học sinh Trường B -> **Bị chặn HTTP 404/403** (cách ly tenant tuyệt đối, không lộ bất kỳ dữ liệu nào).
  * Phụ huynh B dùng token Trường B gọi học sinh Trường A -> **Bị chặn HTTP 404/403** (cách ly tenant tuyệt đối).

### 2.6. Schema hợp lệ cho Trường B, Thao tác ghi nghiệp vụ & Truy vấn Audit Log thực tế
- `Classroom` Trường B tuân thủ enum bắt buộc `ageGroup: '3-4'`.
- Khởi tạo đầy đủ liên kết nhân sự: Phòng ban `GV_B`, Nhân viên `GVB001` liên kết với tài khoản `giaovien_b`.
- Thao tác ghi nghiệp vụ: Quản trị viên Trường B gọi `PUT /api/classrooms/:id/homeroom-teacher` phân công giáo viên chủ nhiệm cho Lớp Mầm 1 (B) -> **200 OK**, database cập nhật `homeroomTeacherId`.
- **Truy vấn Audit Log thực tế trong MongoDB**: Đã truy vấn collection `authorization_audit_logs` và assert thành công sự tồn tại của bản ghi kiểm toán `CLASSROOM_STAFF_ASSIGNED` do `admin_b` thực hiện trên Lớp Mầm 1 (B).

### 2.7. Kiểm tra Factory Khởi động `createProductionSaasApp`
- Guard an toàn: Chặn database không nằm trong allowlist (`Error: Target database is not in authorized databases`).
- Khởi động an toàn: Chạy thành công với `school_rehearsal_20261111` khi có `mongoose.set('autoIndex', false)` và `TIMEKEEPING_SCHEDULER_ENABLED='false'`. Endpoint `/api/health` trả về 200 OK.

### 2.8. Truy vấn kiểm kê thực tế 12 Residual Global Unique Index trong MongoDB
Đã thực hiện truy vấn trực tiếp vào metadata index của các collection trong MongoDB và xác nhận bằng 13 assertions cụ thể:
1. `users.username_1` -> Unique toàn cục, chưa có tenantId (PASS)
2. `students.studentCode_1` -> Unique toàn cục, chưa có tenantId (PASS)
3. `students.attendanceCardId_1` -> Unique toàn cục, chưa có tenantId (PASS)
4. `students.faceProfileId_1` -> Unique toàn cục, chưa có tenantId (PASS)
5. `purchaseorders.orderCode_1` -> Unique toàn cục, chưa có tenantId (PASS)
6. `suppliers.code_1` -> Unique toàn cục, chưa có tenantId (PASS)
7. `ingredientmasters.code_1` -> Unique toàn cục, chưa có tenantId (PASS)
8. `kitchenrequests.requestCode_1` -> Unique toàn cục, chưa có tenantId (PASS)
9. `kitchenequipments.code_1` -> Unique toàn cục, chưa có tenantId (PASS)
10. `kitchenstaffs.staffCode_1` -> Unique toàn cục, chưa có tenantId (PASS)
11. `foodsamples.sampleCode_1` -> Unique toàn cục, chưa có tenantId (PASS)
12. `pickuprecords.pickupCode_1` -> Unique toàn cục, chưa có tenantId (PASS)
13. Khẳng định chính xác đủ 12 index toàn cục đang hoạt động độc lập không có tenantId.

---

## 3. PHẦN 2: CÁC NỘI DUNG CHƯA KIỂM CHỨNG & GIỚI HẠN (LIMITATIONS)

1. **Hành vi va chạm khi 2 trường cùng nhập trùng mã trên 12 Global Unique Indexes**:
   Do 12 index trên vẫn là unique toàn cục, nếu người dùng ở Trường B tạo mới học sinh trùng mã `studentCode` hoặc tạo tài khoản trùng `username` với Trường A, MongoDB sẽ ném lỗi `E11000 duplicate key`. Đây là giới hạn chưa được xử lý trong phạm vi Phase 1A-1E.
2. **Thao tác ghi đồng thời trên các phân hệ chưa SaaS-hóa**:
   Chưa kiểm chứng luồng ghi dữ liệu đồng thời giữa 2 tenant trên các phân hệ Nhà bếp, Đón trẻ, Chat, Thông báo.

---

## 4. PHẦN 3: BLOCKER KỸ THUẬT & KẾ HOẠCH XỬ LÝ (ACTION PLAN)

### 4.1. Bảng kiểm kê các Endpoint bị chặn (HTTP 501 Not Implemented)
Khi chuyển sang app SaaS (`createProductionSaasApp.js`), `tenantFeatureGate` sẽ chặn 501 các route chưa được kiểm chứng SaaS:

| Phân hệ / Module | Đường dẫn API | Trạng thái SaaS | Tác động giao diện người dùng |
| :--- | :--- | :--- | :--- |
| 🔴 **Nhà bếp (Nutrition)** | `/api/nutrition/*` (`/dishes`, `/menus`, `/allergies`) | ❌ **501 Not Implemented** | **NGUY CƠ CAO**: Giao diện Nhà bếp (vừa sửa chọn lớp ở turn trước) sẽ không load được thực đơn và dị ứng. |
| 🔴 **Thông báo nội bộ** | `/api/notifications`, `/api/internal-notices` | ❌ **501 Not Implemented** | Bảng tin thông báo của trường bị trắng/lỗi. |
| 🔴 **Trò chuyện (Chat)** | `/api/chat/*`, `/api/class-communication` | ❌ **501 Not Implemented** | Khung chat giữa giáo viên và phụ huynh không hoạt động. |
| 🔴 **Đón trẻ (Pickups)** | `/api/pickups/*` | ❌ **501 Not Implemented** | Giao diện bảo vệ/giáo viên điểm danh đón trả trẻ bị khóa. |
| 🔴 **Cơ sở vật chất (Procurement)** | `/api/procurement/*` | ❌ **501 Not Implemented** | Đề xuất mua sắm cơ sở vật chất bị khóa. |
| 🔴 **Thêm mới Học sinh / Lớp học** | `POST /api/students`, `POST /api/classrooms` | ❌ **501 Not Implemented** | Nút "Thêm học sinh" và "Thêm lớp" trên giao diện Admin bị khóa (chỉ hỗ trợ đọc và phân công). |

### 4.2. Kế hoạch xử lý cụ thể cho Phân hệ Nhà bếp (Nutrition) trước khi Cutover Thật
Để không làm gián đoạn phân hệ Nhà bếp của người dùng:
1. **Bước 1 (Tenant Scoping)**:
   - Rà soát các model Nhà bếp: `Dish`, `WeeklyMenu`, `KitchenRequest`, `StudentAllergy`.
   - Bổ sung helper `buildTenantFilter(req)` vào `backend/src/controllers/nutritionController.js`.
2. **Bước 2 (Chỉ mục Nhà bếp)**:
   - Chuyển các index unique toàn cục của nhà bếp (`ingredientmasters.code_1`, `kitchenrequests.requestCode_1`, `kitchenequipments.code_1`, `foodsamples.sampleCode_1`) sang compound tenant unique.
3. **Bước 3 (Router Integration)**:
   - Bổ sung `app.use('/api/v1/nutrition', schoolNutritionRoutes)` và `app.use('/api/nutrition', schoolNutritionRoutes)` trong `backend/src/saas/assembleSaasApp.js`.
4. **Bước 4 (Kiểm chứng Browser E2E)**:
   - Chạy lại kịch bản `run_legacy_browser_verification.js` với tài khoản `chef` của Trường A và Trường B để đảm bảo không còn lỗi 501.

---

## 5. KẾT LUẬN & ĐỀ XUẤT CHO CODEX NGHIỆM THU

1. **Khẳng định an toàn**:
   - Quá trình diễn tập kỹ thuật đã hoàn thành 100% với **exit code 0 (89/89 assertions PASS)** trên database diễn tập `school_rehearsal_20261111`.
   - Toàn bộ kết quả và log thực tế được lưu ngoài repository:
     * `E:\school-mongo-recovery-20261106\two-school-test-20261111\rehearsal_run_summary.json`
     * `E:\school-mongo-recovery-20261106\two-school-test-20261111\rehearsal_run.log`
   - Cơ sở dữ liệu thật `school_management` và các tiến trình runtime 5001/5173/27018 hoàn toàn nguyên vẹn, không bị tác động.
2. **Khuyến nghị bàn giao**:
   - **TẠM DỪNG CUTOVER THẬT VÀO `school_management`** tại thời điểm này.
   - Bàn giao kết quả diễn tập và kế hoạch mở rộng module Nhà bếp cho Codex xem xét.
   - Khi Codex phê duyệt mở route Nhà bếp hoặc người dùng đồng ý phạm vi 501, Antigravity sẽ thực hiện quy trình cutover chính thức với snapshot backup tức thời.
