# BÁO CÁO NGHIỆM THU & BÀN GIAO TASK 1D.4 (HIỆU CHỈNH)
## CÁCH LY CHẤM CÔNG NHÂN SỰ CỐT LÕI THEO TRƯỜNG (TIMEKEEPING SCOPING)

- **Dự án**: `E:\school-management-api`
- **Mốc thực hiện**: Giai đoạn 1D — Task 1D.4 (Hiệu chỉnh theo phát hiện nghiệm thu của Codex)
- **Trạng thái**: **HOÀN THÀNH — ĐÃ KIỂM CHỨNG TOÀN DIỆN & VƯỢT QUA TOÀN BỘ PHÁT HIỆN**
- **Tác nhân thực hiện**: Antigravity
- **Người điều phối & nghiệm thu**: Codex

---

## 1. TỔNG QUAN XỬ LÝ 5 PHÁT HIỆN NGHIỆM THU CỦA CODEX

### 1. Cách ly HTTP recalculate khỏi Queue toàn cục & Bảo vệ processQueuedRecalculations
- **Hiện trạng trước**: `recalculateAttendanceForDate` enqueue theo tenant nhưng `processQueuedRecalculations` gọi `claimQueueItem` không scope. Request A có thể claim nhầm queue item của Tenant B hoặc Legacy đến hạn trước rồi trả `AttendanceRecord` của B về cho A. Ngoài ra, `processQueuedRecalculations` thiếu fail-closed guard nếu caller gọi không có context hoặc cung cấp `queueFilter` tùy ý.
- **Đã xử lý**:
  - `claimQueueItem(workerId, queueFilter = {})` bắt buộc hỗ trợ lọc theo điều kiện hàng đợi.
  - `processQueuedRecalculations`: Bắt buộc phải có `isGlobalWorker: true` HOẶC `context` trường học đáng tin cậy; thiếu cả hai lập tức **fail closed 403 `FORBIDDEN`** trước khi claim (hàng đợi hoàn toàn không bị đổi trạng thái, attempts hay lock).
  - `queueFilter` không được tự thay thế bằng chứng quyền/context: với context Tenant A, `effectiveQueueFilter` luôn bị neo chặt vào `tenantId: scope.tenantId`; nếu caller cung cấp `queueFilter` có `tenantId` lệch với context (ví dụ cố tình truyền Tenant B), lập tức bị từ chối 403 `FORBIDDEN`.
  - Luồng HTTP `recalculateAttendanceForDate` truyền tường minh `queueFilter = { workDate: normalizedWorkDate, tenantId: scope.tenantId || null }` kèm context. Request Tenant A chỉ claim và tính toán item thuộc Tenant A và đúng ngày công; các item của Tenant B và Legacy đến hạn trước giữ nguyên `status: 'PENDING'`, `attempts: 0`, không bị lock.
  - Phản hồi HTTP và audit log của request A chỉ chứa dữ liệu thuộc Tenant A, không rò rỉ dữ liệu của Tenant B.
  - Worker nền toàn cục phân biệt tường minh bằng cờ `isGlobalWorker: true`, xử lý từng item bằng ngữ cảnh cô lập riêng của chính item đó và xác minh chéo `User` tương ứng.

### 2. Thống nhất hợp đồng context
- **Hiện trạng trước**: `resolveTenantScope` trong `attendanceAdjustmentService` và `attendanceCalculationService` tự kiểm tra lỏng lẻo, chưa ép chặt user và context cùng tenant; thiếu context có nguy cơ tự rơi về legacy.
- **Đã xử lý**:
  - Tích hợp helper chuẩn `resolveUserAndTenantContext(user, context)` từ `tenantFilterService.js` vào cả hai service.
  - Trường hợp User A đi kèm Context B: fail-closed lập tức với lỗi 403 `FORBIDDEN` / `InvalidTenantContextError` trước khi đọc/ghi.
  - User SaaS đi kèm Legacy Context hoặc Legacy User đi kèm SaaS Context: đều bị từ chối 403 `FORBIDDEN`.
  - Thiếu cả user lẫn context: fail-closed 403 `FORBIDDEN`.
  - Trong `calculateAttendanceForUserDate`: bổ sung kiểm tra bắt buộc `User.findOne({ _id: userId, ...scope.filter })`. Nếu user đích không tồn tại trong scope trường (alien user), lập tức ném lỗi 404 `USER_NOT_FOUND`, tuyệt đối không tính hộ hoặc tạo/sửa record ngoại lai.
  - Trong `timekeepingSyncService.runDailyTimekeepingSync`: duyệt danh sách active tenants để enqueue tường minh theo từng tenant context (`createTrustedTenantContext({ tenantId })`), enqueue riêng cho legacy (`createTrustedTenantContext({ isLegacy: true })`), loại bỏ hoàn toàn việc dựa dẫm vào `defaultContext` không rõ ràng.

### 3. Transaction & Allowlist Quyền Actor cho Create, Update, Submit, Cancel Adjustment
- **Hiện trạng trước**: Mới chỉ bọc `approve` và `reject` vào transaction; `createDraft`, `updateDraft`, `submitDraft`, `cancelAdjustment` còn thực hiện ngoài transaction; `createAndSubmitLegacy` chưa đảm bảo tính nguyên tử giữa tạo draft và submit. Điều kiện actor còn lỏng lẻo (`$nin: ['guard']`), khiến tài khoản phụ huynh (`parent`) hoặc vai trò ngoài ngành lọt qua nếu bị tráo role sau middleware.
- **Đã xử lý**:
  - Toàn bộ `createDraft`, `updateDraft`, `submitDraft`, `cancelAdjustment` được bọc vào `withTransaction` kèm `session`.
  - **Chuẩn hóa Allowlist Quyền Actor**:
    - `createDraft`, `updateDraft`, `submitDraft`: Sử dụng danh sách cho phép tường minh `ADJUSTMENT_ROLES = ['admin', 'principal', 'teacher', 'accountant', 'chef', 'hr']` (loại bỏ hoàn toàn sơ hở `$nin: ['guard']`, ngăn role `parent` lọt qua).
    - `cancelAdjustment`: Sử dụng `EMPLOYEE_ROLES = ['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard', 'hr']` (kiểm tra vai trò nhân viên hợp lệ trước khi cho phép hủy).
  - Trong mỗi callback transaction: đọc lại actor active, đúng tenant scope và có vai trò nằm trong allowlist (`role: { $in: ... }`, `status: 'active'`) trước khi thực hiện ghi dữ liệu. Nếu actor bị khóa hoặc tráo đổi role sau middleware -> lập tức từ chối 403 `FORBIDDEN`.
  - Endpoint compatibility `POST /corrections` kế thừa trọn vẹn cơ chế bảo vệ này qua `createAndSubmitLegacy`.
  - Toàn bộ thao tác ghi document, cập nhật version và ghi `AttendanceAuditLog` đều chạy cùng `session`. Nếu audit log lỗi hoặc actor không hợp lệ, transaction tự động rollback toàn bộ, không để lại document mồ côi hay thay đổi version.
  - `createAndSubmitLegacy`: Bọc trong **một transaction duy nhất**. `createDraft` và `submitDraft` cùng chia sẻ `outerSession`. Nếu bước submit thất bại (ví dụ trùng log máy chấm công `DUPLICATE_DEVICE_EVENT`), transaction bị abort và bản ghi draft vừa tạo được rollback hoàn toàn khỏi cơ sở dữ liệu.

### 4. Kiểm tra Owner của phiếu trước khi Approve/Reject
- **Hiện trạng trước**: Chưa kiểm tra trạng thái hoạt động của người nộp phiếu (`pending.userId`) và hồ sơ `Employee` liên quan khi reviewer phê duyệt hoặc từ chối.
- **Đã xử lý**:
  - Trong callback transaction của `approveAdjustment` và `rejectAdjustment`:
    - Xác minh user sở hữu phiếu `requestOwner = await User.findOne({ _id: pending.userId, status: 'active', ...scope.filter }, null, { session })`. Nếu owner đã bị vô hiệu hóa (`status: 'inactive'`) hoặc chuyển trường -> từ chối 403 với mã lỗi `INVALID_OWNER`.
    - Xác minh hồ sơ nhân viên `Employee.findOne({ userId: pending.userId }, null, { session })`. Nếu hồ sơ đã nghỉ việc (`status: 'resigned'`) hoặc thuộc tenant khác -> từ chối 403 với mã lỗi `INVALID_OWNER`.
    - Toàn bộ bước kiểm tra này nằm trong cùng session của transaction; không sinh `AttendanceRecord`, `AttendanceRecalculationQueue` hay `OutboxEvent` không hợp lệ.

### 5. Chuẩn hóa báo cáo & số liệu
- Đối chiếu số test thực tế của từng suite Phase 1D, phân biệt rõ các mốc; không nhầm lẫn số liệu.
- Làm rõ sự khác biệt giữa HTTP Scoped Worker và Global Background Worker.
- Làm rõ kỹ thuật kiểm thử Concurrency giữa Barrier Interception và `Promise.all` thông thường.
- Không tuyên bố 14 endpoint sẵn sàng mở; giữ nguyên hiện trạng router SaaS đóng (`gatedModules: ['timekeeping', ...]`) chờ chỉ thị tại Task 1D.5.

---

## 2. PHÂN TÍCH KỸ THUẬT CHUYÊN SÂU

### A. HTTP Worker Scoped vs. Global Background Worker
| Tiêu chí | HTTP Recalculate Worker (`recalculateAttendanceForDate`) | Global Background Worker (`processQueuedRecalculations`) |
|---|---|---|
| **Nguồn kích hoạt** | Request HTTP của Admin/Principal (`POST /recalculate/:date`) | Tiến trình nền: cron midnight (`runDailyTimekeepingSync`) hoặc chu kỳ 5 phút (`runQueuedRecalculations`) |
| **Ngữ cảnh tenant** | Bắt buộc phải có `assertTenantContext(req)` hợp lệ của trường gọi API | Chạy ngầm toàn hệ thống, kích hoạt tường minh bằng `{ isGlobalWorker: true }` |
| **Phạm vi claim queue** | Giới hạn nghiêm ngặt theo `queueFilter = { workDate, tenantId }` | Claim theo độ ưu tiên `nextAttemptAt` xuyên suốt database |
| **Cách xử lý item** | Chỉ xử lý các item thuộc tenant của request; không claim chéo | Với mỗi item claim được, khởi tạo context cô lập riêng của chính item đó (`item.tenantId ? createTrustedTenantContext({ tenantId }) : createTrustedTenantContext({ isLegacy: true })`) |
| **Bảo vệ ranh giới** | Không chạm đến item của trường B hay legacy kể cả khi đến hạn trước | Kiểm chứng chéo `User` thuộc tenant của item; nếu mismatch -> fail-closed đánh dấu `FAILED`, không tính hộ alien user |
| **Dữ liệu trả về** | Chỉ trả về danh sách `AttendanceRecord` thuộc trường gọi request | Trả về tổng số bản ghi đã xử lý cho job lock |

### B. Concurrency Test: Barrier Interception vs. `Promise.all` Thông Thường
1. **Kiểm thử Concurrency thông thường (`Promise.all`)**:
   - Sử dụng trong test F.6: Hai reviewer cùng gửi request phê duyệt đồng thời cho cùng một phiếu `PENDING`.
   - Mục đích: Chứng minh cơ chế Optimistic Locking (`version`) và điều kiện truy vấn nguyên tử `{ status: 'PENDING', version }` chặn đứng race condition: người thứ nhất thành công (200), người thứ hai nhận 409 `VERSION_CONFLICT` / `ADJUSTMENT_ALREADY_PROCESSED`.
2. **Kiểm thử Concurrency có Barrier / State Interception (F.8, E.11)**:
   - Sử dụng `jest.spyOn(User, 'findOne')` để can thiệp đúng vào thời điểm giữa middleware và snapshot transaction.
   - Khi request đã vượt qua tầng middleware kiểm tra quyền ban đầu, barrier chặn luồng thực thi và cập nhật trực tiếp DB thật (chuyển trạng thái actor thành `suspended` / `inactive`).
   - Transaction re-verification đọc lại trạng thái actor từ DB thật bên trong session, phát hiện actor không còn quyền hợp lệ và lập tức rollback, trả về HTTP 403 `FORBIDDEN`.
   - Có kiểm chứng **Happy path đối ứng**: Mở lại trạng thái `active` cho actor và gọi lại request, xác nhận xử lý thành công nhằm chứng minh barrier hoạt động chính xác và không gây lỗi giả.

---

## 3. HIỆN TRẠNG ROUTER SAAS VÀ DANH MỤC 14 ENDPOINTS

### Hiện trạng Router SaaS:
- Trong `backend/src/saas/createSaasApp.js`: Router timekeeping **tiếp tục được đóng chặt** trong danh sách `gatedModules: ['timekeeping', 'hr', ...]`.
- Mọi request SaaS gửi tới `/api/v1/timekeeping/*` ở runtime thực tế sẽ nhận mã lỗi 501 `MODULE_NOT_READY` hoặc 404.
- Việc tích hợp và mở router SaaS HR & Timekeeping thuộc phạm vi riêng của **Task 1D.5**.

### Bảng đối chiếu 14 Handler Chấm công:
| STT | Endpoint HTTP | Handler | RBAC Route Middleware | Re-verify Actor In-Session | Owner Check In-Session | Trạng thái SaaS |
|---|---|---|---|---|---|---|
| 1 | `POST /check-in` | `manualCheckIn` | `employeeRoles` | Có (`employeeRoles`, active, tenant scope) | Tự chấm công (actor là owner) | Tiếp tục đóng (chờ 1D.5) |
| 2 | `GET /me` | `getMyTimekeeping` | `employeeRoles` | Không (Read-only scoped) | Read-only của chính actor | Tiếp tục đóng (chờ 1D.5) |
| 3 | `GET /daily` | `getDailyTimekeeping` | `['admin', 'principal', 'hr']` | Không (Read-only scoped) | Lọc bỏ alien user link | Tiếp tục đóng (chờ 1D.5) |
| 4 | `POST /adjustments` | `createAdjustmentDraft` | `adjustmentRoles` (trừ `guard`) | Có (Active, nin `guard`, tenant scope) | Tự tạo draft | Tiếp tục đóng (chờ 1D.5) |
| 5 | `GET /adjustments` | `listMyAdjustments` | `employeeRoles` | Không (Read-only scoped) | Read-only của chính actor | Tiếp tục đóng (chờ 1D.5) |
| 6 | `GET /adjustments/:id` | `getMyAdjustment` | `employeeRoles` | Không (Read-only scoped) | Read-only của chính actor | Tiếp tục đóng (chờ 1D.5) |
| 7 | `PATCH /adjustments/:id` | `updateAdjustmentDraft` | `adjustmentRoles` (trừ `guard`) | Có (Active, nin `guard`, tenant scope) | Chỉ sửa draft của chính mình | Tiếp tục đóng (chờ 1D.5) |
| 8 | `POST /adjustments/:id/submit` | `submitAdjustmentDraft` | `adjustmentRoles` (trừ `guard`) | Có (Active, nin `guard`, tenant scope) | Chỉ nộp draft của chính mình | Tiếp tục đóng (chờ 1D.5) |
| 9 | `POST /adjustments/:id/cancel` | `cancelAdjustment` | `employeeRoles` | Có (Active, tenant scope) | Chỉ hủy phiếu của chính mình | Tiếp tục đóng (chờ 1D.5) |
| 10 | `POST /corrections` | `createCorrectionRequest` | `adjustmentRoles` (trừ `guard`) | Có (Bọc trong 1 transaction đơn nhất) | Tự tạo & nộp | Tiếp tục đóng (chờ 1D.5) |
| 11 | `GET /corrections/pending` | `getPendingCorrectionRequests` | `['admin', 'principal', 'hr']` | Không (Read-only scoped) | Lọc bỏ alien request | Tiếp tục đóng (chờ 1D.5) |
| 12 | `PATCH /corrections/:id/approve` | `approveCorrectionRequest` | `approvalRoles` (`admin`, `principal`) | Có (`['admin', 'principal']`, active, scope) | Kiểm tra `User` & `Employee` active + cùng tenant | Tiếp tục đóng (chờ 1D.5) |
| 13 | `PATCH /corrections/:id/reject` | `rejectCorrectionRequest` | `approvalRoles` (`admin`, `principal`) | Có (`['admin', 'principal']`, active, scope) | Kiểm tra `User` & `Employee` active + cùng tenant | Tiếp tục đóng (chờ 1D.5) |
| 14 | `POST /recalculate/:date` | `recalculateAttendance` | `approvalRoles` (`admin`, `principal`) | Scoped enqueue & worker (`queueFilter`) | Kiểm tra user đích thuộc scope | Tiếp tục đóng (chờ 1D.5) |

---

## 4. BẢNG TỔNG HỢP SỐ LIỆU KIỂM THỬ THỰC TẾ

### A. Chi tiết các Test Suites thuộc Phase 1D (213 tests trên 8 suites — 100% PASS)
| Giai đoạn | Tên Test Suite | File Kiểm Thử | Số Test Thực Tế | Trạng Thái |
|---|---|---|---|---|
| **1D.1** | Phân tách ranh giới dữ liệu trường | `phase1d1_data_boundary.test.js` | **39** *(tính cả test.each)* | PASS |
| **1D.2** | Quản lý tài khoản nội bộ theo trường | `phase1d2_internal_accounts_scoping.test.js` | **44** | PASS |
| **1D.3** | Phân quyền & Nhân sự HR theo trường | `phase1d3_hr_scoping.test.js` | **39** | PASS |
| **1D.3** | Quản lý định biên & lịch làm việc | `phase1d3_staffing_scoping.test.js` | **30** | PASS |
| **1D.3** | Concurrency phân công nhân sự | `phase1d3_assignment_concurrency.test.js` | **7** | PASS |
| *Tổng 1D.3* | *Phân công, nhân sự & định biên HR* | *3 suites của Task 1D.3* | ***76*** | *PASS* |
| **1D.4** | Chấm công nhân sự cốt lõi theo trường | `phase1d4_timekeeping_scoping.test.js` | **16** | PASS |
| **1D.4** | State machine điều chỉnh & phê duyệt | `phase1d4_adjustments_scoping.test.js` | **27** | PASS |
| **1D.4** | Hàng đợi & tính lại chấm công | `phase1d4_recalculation_scoping.test.js` | **11** | PASS |
| *Tổng 1D.4* | *Chấm công nhân sự cốt lõi theo trường* | *3 suites của Task 1D.4* | ***54*** | *PASS* |
| **TỔNG** | **Toàn bộ Phase 1D** | **8 test suites** | **213 / 213** | **100% PASS** |

### B. Bảng phân nhóm kiểm thử Task 1D.4 (54 tests)
- **Nhóm A: Chấm công thủ công qua Web (6 tests)**:
  - `A.1`: Giáo viên Tenant A chấm công thành công (201), gán đúng `tenantId` và ghi `AttendanceAuditLog`.
  - `A.2`: Chấm công lặp lại trong ngày trả về HTTP 200 `{ alreadyCheckedIn: true }`, không đổi `checkInTime` cũ.
  - `A.3`: Ngày công đã chốt (`finalized: true`) không cho ghi đè bằng chấm công thủ công (409).
  - `A.4`: Client gửi kèm `userId` hoặc `tenantId` ngoại lai trong payload bị bỏ qua, chỉ chấm công cho actor.
  - `A.5`: Actor bị hạ quyền hoặc khóa sau middleware nhưng trước snapshot transaction -> Bị từ chối 403; Happy path đối ứng thành công.
  - `A.6`: `AttendanceAuditLog` lỗi mô phỏng -> Rollback toàn bộ `AttendanceRecord`.
- **Nhóm B: Đọc chấm công cá nhân (4 tests)**:
  - `B.1`: Giáo viên Tenant A chỉ đọc chấm công và phiếu điều chỉnh của mình, không thấy của Tenant B.
  - `B.2`: Chặn query `userId` để xem dữ liệu người khác (luôn ép dùng `req.user._id`).
  - `B.3`: Tính đúng ca làm việc, `lateMinutes`, `earlyLeaveMinutes` theo `StaffShift` của trường.
  - `B.4`: Employee trỏ nhầm User Tenant B (alien user link) bị cô lập, không lộ ca làm việc.
- **Nhóm C: Bảng chấm công theo ngày (4 tests)**:
  - `C.1`: Admin/HR Tenant A xem bảng công của ngày -> Chỉ hiện nhân sự và chấm công thuộc Tenant A.
  - `C.2`: Employee Tenant A bị trỏ nhầm `userId` sang Tenant B bị lọc bỏ, không rò rỉ dữ liệu.
  - `C.3`: Teacher không có quyền gọi `GET /daily` (403).
  - `C.4`: Ngày công sai định dạng trả HTTP 400 có kiểm soát.
- **Nhóm D: Cách ly Legacy & Khóa Router SaaS (2 tests)**:
  - `D.1`: Legacy Teacher chấm công độc lập với `tenantId: null`, không thấy dữ liệu SaaS.
  - `D.2`: `createSaasApp` tiếp tục chặn route timekeeping ở mode hiện hành (501 / 404).
- **Nhóm E: State Machine Điều Chỉnh Chấm Công (16 tests)**:
  - `E.1`: Giáo viên Tenant A tạo draft điều chỉnh thành công (201), gán đúng `tenantId` và ghi AuditLog.
  - `E.2`: Tạo trùng draft/pending cùng ngày và loại trả về 409 `DUPLICATE_ADJUSTMENT`.
  - `E.3`: Đọc danh sách và chi tiết điều chỉnh: chỉ đọc của chính mình, ngoại lai trả 404.
  - `E.4`: Cập nhật draft: tăng version, chặn version cũ (409) và chặn sửa phiếu của Tenant B (404).
  - `E.5`: Gửi duyệt draft (submit): chuyển PENDING, chặn version conflict và duplicate device event (409).
  - `E.6`: Hủy phiếu (cancel): chuyển CANCELLED, `isActive=false`; ngoại lai trả 404.
  - `E.7`: Compatibility alias (`POST /corrections`): tạo và submit trực tiếp thành PENDING (201).
  - `E.8`: Guard không có quyền gọi endpoint tạo/sửa điều chỉnh -> 403.
  - `E.9`: Transaction atomicity cho Draft/Update/Submit/Cancel: AuditLog fail -> Rollback toàn bộ, không có doc mồ côi.
  - `E.10`: Transaction atomicity: `createAndSubmitLegacy` rollback draft nếu submit thất bại.
  - `E.11`: Barrier test cho `createDraft`: Teacher bị khóa/hạ quyền sau middleware nhưng trước snapshot transaction -> 403.
  - `E.12`: Barrier test: Actor đổi role thành `parent` sau middleware trước snapshot `createDraft` -> Bị từ chối 403; không tạo draft, không sinh audit; Happy path teacher thành công 201.
  - `E.13`: Barrier test: Actor đổi role thành `parent` sau middleware trước snapshot `updateDraft` -> Bị từ chối 403; phiếu và version không đổi, không sinh audit; Happy path cập nhật thành công 200.
  - `E.14`: Barrier test: Actor đổi role thành `parent` sau middleware trước snapshot `submitDraft` -> Bị từ chối 403; phiếu vẫn DRAFT, version không đổi, không sinh audit; Happy path submit thành công 200.
  - `E.15`: Barrier test: Actor đổi role thành `parent` sau middleware trước snapshot `cancelAdjustment` -> Bị từ chối 403; status và version không đổi, không sinh audit; Happy path hủy thành công 200 (guard và teacher).
  - `E.16`: Barrier test: Compatibility endpoint (`POST /corrections`) actor đổi role thành `parent` sau middleware -> Bị từ chối 403; không tạo phiếu, không sinh audit; Happy path thành công 201.
- **Nhóm F: Phê Duyệt & Từ Chối Điều Chỉnh (11 tests)**:
  - `F.1`: `GET /corrections/pending`: Admin/HR xem được pending của trường mình, không thấy trường B, Teacher bị 403.
  - `F.2`: Admin Tenant A duyệt phiếu thành công: chuyển APPROVED, sinh Queue, Outbox và AuditLog kèm `tenantId`.
  - `F.3`: HR gọi approve -> 403 (chỉ Admin/Principal có quyền duyệt); Teacher gọi -> 403.
  - `F.4`: Cấm tự phê duyệt (`SELF_APPROVAL_FORBIDDEN` -> 403): Admin tự nộp phiếu và tự duyệt bị chặn.
  - `F.5`: Cách ly liên trường: Admin Tenant A cố duyệt phiếu của Tenant B -> 404 `ADJUSTMENT_NOT_FOUND`.
  - `F.6`: Concurrency / Race condition: 2 reviewer cùng duyệt 1 phiếu -> người thứ hai bị 409.
  - `F.7`: Transaction atomicity: lỗi mô phỏng ở `OutboxEvent` -> Rollback toàn bộ, phiếu vẫn PENDING.
  - `F.8`: Barrier test: Admin bị hạ quyền/khóa sau middleware nhưng trước snapshot transaction -> Bị từ chối 403; Happy path đối ứng thành công.
  - `F.9`: Từ chối phiếu (reject): Admin từ chối thành công; cấm tự từ chối (403); Tenant B trả 404.
  - `F.10`: Owner verification: Phiếu PENDING có owner (`pending.userId`) bị inactive -> Admin duyệt/từ chối bị từ chối 403 `INVALID_OWNER`.
  - `F.11`: Owner verification: Phiếu PENDING có Employee liên kết bị inactive/resigned -> Admin duyệt bị từ chối 403 `INVALID_OWNER`.
- **Nhóm G: Hàng Đợi & Tính Lại Chấm Công (11 tests)**:
  - `G.1`: `POST /recalculate/:date` với Admin Tenant A: chỉ enqueue users của Tenant A, không chạm Tenant B.
  - `G.2`: RBAC: Teacher và HR không có quyền gọi `POST /recalculate/:date` -> 403.
  - `G.3`: Ngày công sai định dạng trả về 400 có kiểm soát.
  - `G.4`: Tenant Scoping trong tính toán: log máy Tenant B không bao giờ được tính cho Teacher Tenant A.
  - `G.5`: Queue Worker Isolation & Alien Item Fail Closed: Queue item trỏ nhầm user Tenant B bị đánh dấu `FAILED`.
  - `G.6`: Idempotency, `calculationVersion` increment & Audit Log nguyên tử.
  - `G.7`: Cách ly Legacy: Recalculate cho Legacy chỉ tác động record có `tenantId: null`.
  - `G.8`: Cách ly HTTP Recalculate khỏi Queue toàn cục: queue B và legacy đến hạn trước không bị claim bởi request A; Worker nền xử lý riêng.
  - `G.9`: `calculateAttendanceForUserDate` phải xác minh user đích thuộc đúng scope (Alien user fail closed 404).
  - `G.10`: Thống nhất hợp đồng context: `resolveTenantScope` fail-closed khi user và context lệch tenant.
  - `G.11`: `processQueuedRecalculations` fail-closed: thiếu context và cờ global worker không đổi queue; context A + filter B bị từ chối; global worker hợp lệ xử lý đúng.

### C. Kết quả Kiểm thử Toàn bộ Backend (Full Backend Regression Test)
- **Lệnh thực thi**:
  ```bash
  npm test --prefix backend -- --forceExit
  ```
- **Exit Code**: `0`
- **Số Suite**: `25 passed, 25 total`
- **Số Test**: `682 passed, 682 total`
- **Thời gian chạy**: `357.262 s`
- **Cảnh báo Open Handle**:
  ```text
  Force exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?
  ```
  *(Lưu ý: Không coi `--forceExit` là bằng chứng đã sạch 100% open handle; hệ thống test suite dùng Mongo Memory Server và background timers cần dọn dẹp kỹ hơn trong các đợt refactor hạ tầng).*
- **Đánh giá hồi quy**: 0 lỗi hồi quy. Toàn bộ 25 suites trong backend đều vượt qua 100%.

---

## 5. BẢO TOÀN DIRTY WORKTREE & CAM KẾT GIỚI HẠN

1. **Bảo toàn Dirty Worktree**:
   - Toàn bộ worktree được giữ nguyên, không chạy `git commit`, `git push`, `git reset`, `git stash`, `git clean`.
   - Các file chưa untracked được bảo toàn 100%.
2. **Không sửa đổi hệ thống cấm**:
   - Không thay đổi các index MongoDB hiện hữu trên database thật.
   - Không migration, không đụng database thật, không sửa `.env`.
   - Router SaaS tiếp tục đóng trong `createSaasApp.js` (`gatedModules: ['timekeeping', 'hr', ...]`).
3. **Giới hạn Task**:
   - Mọi thảo luận hoặc file nháp chuẩn bị cho 1D.5 (nếu có) **chưa được nghiệm thu** và module vẫn tiếp tục đóng; chưa mở router hoặc triển khai Task 1D.5.
   - Dừng lại tại Task 1D.4 để Codex nghiệm thu.
