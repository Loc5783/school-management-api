# BÁO CÁO NGHIỆM THU & BÀN GIAO TASK 1D.5 (TÍCH HỢP TOÀN DIỆN PHASE 1D)
## TÍCH HỢP ROUTER SAAS NHÂN SỰ, TÀI KHOẢN NỘI BỘ, CHẤM CÔNG VÀ NGHIỆM THU PHASE 1D

- **Dự án**: `E:\school-management-api`
- **Mốc thực hiện**: Giai đoạn 1D — Task 1D.5 (Tích hợp router SaaS và nghiệm thu tích hợp Phase 1D)
- **Trạng thái**: **HOÀN THÀNH TOÀN DIỆN — PASS 100% SUITES & TESTS (48/48 INTEGRATION, 261/261 PHASE 1D, 730/730 FULL BACKEND)**
- **Tác nhân triển khai**: Antigravity
- **Người điều phối & nghiệm thu**: Codex

---

## 1. TỔNG QUAN KẾT QUẢ TRIỂN KHAI VÀ NGHIỆM THU

### Mục tiêu đạt được:
1. **Mở đúng danh mục 44 endpoints nghiệp vụ chuẩn xác** đã được nghiệm thu qua các task 1D.2, 1D.3, 1D.4 vào ứng dụng SaaS thực tế (`createSaasApp.js`).
2. **Khóa chặt theo SaaS Mode Fail-Closed (`saasMode.js`)**:
   - Chỉ mở các module Nhân sự, Tài khoản nội bộ, Phân công chủ nhiệm và Chấm công khi mode là `phase1d`.
   - Các mode trước đó (`phase1b`, `phase1c`, `phase1a`), các giá trị mode chưa hỗ trợ (`phase1e`, `phase1f`) hoặc mode lạ/typo (`unknown`, `phase1d `) tiếp tục giữ nguyên ranh giới đóng: trả về **HTTP 501** (`tenantFeatureGate`) fail-closed.
   - Thứ tự ưu tiên mode chuẩn xác: `options.saasMode` > `process.env.SAAS_MODE` > mặc định `phase1b`.
3. **Hợp đồng Công khai Tuyển dụng cũ (Public 410 Gone)**:
   - Endpoint `/hr/recruitment*` được mount trước `schoolAuthMiddleware`, trả về **HTTP 410 Gone** (`RECRUITMENT_FEATURE_RETIRED`) công khai cho mọi request (kể cả không có Authorization header, có token rác, hoặc token trường). Không yêu cầu JWT/RBAC.
4. **Bảo vệ cổng Submodules chưa mở (HTTP 501)**:
   - Các subpath chưa nghiệm thu như Payroll, Personal Requests, Credentials, Development, Handover, Internal, Reports, Audit Log, Device Events, Kiosk, Overtime, Overtime Rates, Parents Accounts được chặn tường minh bằng HTTP 501 `MODULE_NOT_IMPLEMENTED_IN_PHASE_1A`.
5. **Hỗ trợ đồng nhất Route Aliases**:
   - Tất cả router mới đều được mount song song ở cả hai tiền tố: `/api/v1/*` và `/api/*` theo đúng chuẩn kiến trúc SaaS của dự án và hoạt động đồng nhất 100%.
6. **Kiểm thử tích hợp độc lập (`backend/tests/saas/phase1d5_integration.test.js`)**:
   - **48/48 test cases PASS 100%** bao quát trọn vẹn 6 nhóm chức năng: Mode matrix & Aliases (10 tests), RBAC & Tenant boundary (14 tests), Nghiệp vụ HR/Accounts/Homeroom (9 tests), State machine Chấm công (10 tests), Hàng đợi Recalculate cách ly (1 test), Không hồi quy Phase 1B/1C & Cổng Phase 1E (4 tests).
7. **Kiểm thử hồi quy toàn diện**:
   - Toàn bộ 9 suite của Phase 1D: **261/261 tests PASS 100%** (216.447 s, tăng 48 tests so với baseline 213 tests của 1D.4).
   - Toàn bộ backend test suite: **26/26 suites PASS, 730/730 tests PASS 100%** (522.367 s, tăng 1 suite và 48 tests so với baseline 25 suites, 682 tests trước đó). Không xảy ra bất kỳ lỗi hồi quy nào trên toàn bộ hệ thống.

---

## 2. MA TRẬN 44 ENDPOINTS NGHIỆP VỤ ĐƯỢC MỞ TRONG PHASE 1D

> [!NOTE]
> Bảng danh mục được rà soát đối chiếu từng dòng mã nguồn router thật: `schoolSystemUserRoutes.js`, `schoolHrRoutes.js`, `schoolClassroomRoutes.js`, `schoolTimekeepingRoutes.js`.

### A. Nhóm Tài khoản nội bộ (`/api/v1/system` & `/api/system`) — 5 Endpoints
| STT | Phương thức | Đường dẫn | Handler | Phân quyền RBAC | Cơ chế bảo vệ Tenant & Concurrency | Trạng thái |
|---|---|---|---|---|---|---|
| 1 | `GET` | `/system/accounts` | `listInternalAccounts` | `['admin', 'hr']` | Scoped theo `req.tenantContext.tenantId`, không rò rỉ alien users | **Đã mở** |
| 2 | `POST` | `/system/accounts` | `createInternalAccount` | `['admin', 'hr']` | Transaction + linking `Employee` + `AttendanceAuditLog` + Re-verify actor | **Đã mở** |
| 3 | `PATCH` | `/system/accounts/:id/role` | `updateInternalAccountRole` | `['admin', 'hr']` | Transaction + Khóa chặn đổi role nếu đang chủ nhiệm lớp | **Đã mở** |
| 4 | `PATCH` | `/system/accounts/:id` | `updateInternalAccount` | `['admin', 'hr']` | Transaction + Re-verify actor + Đồng bộ trạng thái User/Employee | **Đã mở** |
| 5 | `DELETE` | `/system/accounts/:id` | `deactivateInternalAccount` | `['admin', 'hr']` | Soft-deactivate + Hủy ca trực tương lai trong cùng transaction | **Đã mở** |

---

### B. Nhóm Nhân sự, Phòng ban, Staffing & Nghỉ phép (`/api/v1/hr` & `/api/hr`) — 24 Endpoints
| STT | Phương thức | Đường dẫn | Handler | Phân quyền RBAC | Cơ chế bảo vệ Tenant & Transaction | Trạng thái |
|---|---|---|---|---|---|---|
| **Phòng ban (3)** |
| 6 | `GET` | `/hr/departments` | `getDepartments` | `employeeRoles` | Scoped tenant query, sắp xếp tên | **Đã mở** |
| 7 | `POST` | `/hr/departments` | `createDepartment` | `['admin']` | Chỉ Admin được tạo; tự động gán `tenantId` từ context | **Đã mở** |
| 8 | `PUT` | `/hr/departments/:id` | `updateDepartment` | `['admin']` | Chỉ Admin được sửa; scoped tenant update | **Đã mở** |
| **Liên kết tài khoản nhân viên (2)** |
| 9 | `GET` | `/hr/staff-accounts` | `getStaffAccounts` | `['admin', 'hr']` | Scoped tenant query tài khoản nội bộ | **Đã mở** |
| 10 | `POST` | `/hr/staff-accounts/sync` | `syncStaffAccounts` | `['admin', 'hr']` | Đồng bộ liên kết User-Employee trong tenant | **Đã mở** |
| **Hồ sơ nhân sự (6)** |
| 11 | `GET` | `/hr/employees` | `getEmployees` | `['admin', 'principal', 'hr']` | Scoped tenant list, hỗ trợ filter department/status | **Đã mở** |
| 12 | `GET` | `/hr/employees/:id/history` | `getEmployeeHistory` | `['admin', 'principal', 'hr']` | Scoped tenant lịch sử phân công/điều chuyển | **Đã mở** |
| 13 | `GET` | `/hr/employees/:id` | `getEmployeeById` | `['admin', 'principal', 'hr']` | Scoped lookup; 404 nếu khác tenant | **Đã mở** |
| 14 | `POST` | `/hr/employees` | `createEmployee` | `['admin', 'hr']` | Gán `tenantId`, validate unique employeeCode | **Đã mở** |
| 15 | `PUT` | `/hr/employees/:id` | `updateEmployee` | `['admin', 'hr']` | Scoped update; không đổi được `tenantId` | **Đã mở** |
| 16 | `DELETE` | `/hr/employees/:id` | `deleteEmployee` | `['admin', 'hr']` | Scoped soft-delete / validation | **Đã mở** |
| **Phân công & Ca trực (8)** |
| 17 | `GET` | `/hr/staffing/timetable` | `getWeeklyTimetable` | `['admin', 'principal', 'hr']` | Mount trước `:id` tránh router shadowing; tenant timetable | **Đã mở** |
| 18 | `GET` | `/hr/staffing` | `getStaffingOverview` | `['admin', 'principal', 'hr']` | Tổng quan phân công giáo viên theo lớp | **Đã mở** |
| 19 | `GET` | `/hr/my-staffing` | `getMyStaffingAssignments` | `employeeRoles` | Xem phân công của chính actor | **Đã mở** |
| 20 | `PUT` | `/hr/staffing/classrooms/:id` | `updateClassroomStaffing` | `['admin', 'principal', 'hr']` | Cập nhật phân công giáo viên đứng lớp | **Đã mở** |
| 21 | `POST` | `/hr/staffing/shifts` | `createStaffShift` | `['admin', 'principal', 'hr']` | Phân ca trực cho nhân viên (bảo vệ/bếp) | **Đã mở** |
| 22 | `DELETE` | `/hr/staffing/shifts/:id` | `deleteStaffShift` | `['admin', 'principal', 'hr']` | Xóa ca trực scoped tenant | **Đã mở** |
| 23 | `POST` | `/hr/staffing/replacements` | `createStaffReplacement` | `['admin', 'principal', 'hr']` | Phân công dạy thay scoped tenant | **Đã mở** |
| 24 | `DELETE` | `/hr/staffing/replacements/:id` | `deleteStaffReplacement` | `['admin', 'principal', 'hr']` | Hủy dạy thay scoped tenant | **Đã mở** |
| **Đơn nghỉ phép nhân sự (5)** |
| 25 | `POST` | `/hr/leave-requests` | `createLeaveRequest` | `employeeRoles` | Tự nộp đơn nghỉ phép; tenant scoped | **Đã mở** |
| 26 | `GET` | `/hr/my-leave-requests` | `getMyLeaveRequests` | `employeeRoles` | Xem danh sách đơn nghỉ phép của chính actor | **Đã mở** |
| 27 | `GET` | `/hr/leave-requests/overview` | `getLeaveRequestsOverview` | `['admin', 'principal', 'hr']` | Mount trước `:id`; tổng quan đơn nghỉ phép | **Đã mở** |
| 28 | `GET` | `/hr/leave-requests` | `getLeaveRequests` | `['admin', 'principal', 'hr']` | Danh sách đơn nghỉ phép toàn trường | **Đã mở** |
| 29 | `PATCH` | `/hr/leave-requests/:id/review` | `reviewLeaveRequest` | `['admin', 'principal']` | Duyệt/từ chối đơn nghỉ; chỉ Admin/Principal | **Đã mở** |

---

### C. Nhóm Phân công chủ nhiệm (`/api/v1/classrooms` & `/api/classrooms`) — 1 Endpoint
| STT | Phương thức | Đường dẫn | Handler | Phân quyền RBAC | Cơ chế phối hợp ghi & SaaS Mode | Trạng thái |
|---|---|---|---|---|---|---|
| 30 | `PUT` | `/classrooms/:id/homeroom-teacher` | `assignHomeroomTeacher` | `['admin', 'hr']` | Transaction đồng thời trên `User` (version check) + `Classroom`; chỉ mở khi mode là `phase1d` | **Đã mở** |

---

### D. Nhóm Chấm công Web & Điều chỉnh công (`/api/v1/timekeeping` & `/api/timekeeping`) — 14 Endpoints
| STT | Phương thức | Đường dẫn | Handler | Phân quyền RBAC | Cơ chế bảo vệ Transaction & Tenant Scoping | Trạng thái |
|---|---|---|---|---|---|---|
| **Chấm công cốt lõi & Tra cứu (3)** |
| 31 | `POST` | `/timekeeping/check-in` | `manualCheckIn` | `employeeRoles` | Tự chấm công web; fast-check + transaction scoped | **Đã mở** |
| 32 | `GET` | `/timekeeping/me` | `getMyTimekeeping` | `employeeRoles` | Tra cứu bảng chấm công của chính actor | **Đã mở** |
| 33 | `GET` | `/timekeeping/daily` | `getDailyTimekeeping` | `['admin', 'principal', 'hr']` | Báo cáo chấm công theo ngày có tenant filter | **Đã mở** |
| **State Machine Điều chỉnh công (6)** |
| 34 | `POST` | `/timekeeping/adjustments` | `createAdjustmentDraft` | `adjustmentRoles` | Transaction + Re-verify actor allowlist | **Đã mở** |
| 35 | `GET` | `/timekeeping/adjustments` | `listMyAdjustments` | `employeeRoles` | Danh sách phiếu điều chỉnh của chính actor | **Đã mở** |
| 36 | `GET` | `/timekeeping/adjustments/:id` | `getMyAdjustment` | `employeeRoles` | Chi tiết phiếu (chính chủ hoặc duyệt viên) | **Đã mở** |
| 37 | `PATCH` | `/timekeeping/adjustments/:id` | `updateAdjustmentDraft` | `adjustmentRoles` | Transaction + Optimistic locking (`version`) | **Đã mở** |
| 38 | `POST` | `/timekeeping/adjustments/:id/submit` | `submitAdjustmentDraft` | `adjustmentRoles` | Transaction + Check duplicate raw event | **Đã mở** |
| 39 | `POST` | `/timekeeping/adjustments/:id/cancel` | `cancelAdjustment` | `employeeRoles` | Transaction + Tự hủy phiếu draft/pending của chính mình | **Đã mở** |
| **Endpoint tương thích Corrections (4)** |
| 40 | `POST` | `/timekeeping/corrections` | `createCorrectionRequest` | `adjustmentRoles` | Transaction kép atomic (draft + submit một bước) | **Đã mở** |
| 41 | `GET` | `/timekeeping/corrections/pending` | `getPendingCorrectionRequests` | `['admin', 'principal', 'hr']` | Lấy danh sách phiếu chờ duyệt scoped tenant | **Đã mở** |
| 42 | `PATCH` | `/timekeeping/corrections/:id/approve` | `approveCorrectionRequest` | `['admin', 'principal', 'hr']` | Transaction + Check Owner Active + Version Lock | **Đã mở** |
| 43 | `PATCH` | `/timekeeping/corrections/:id/reject` | `rejectCorrectionRequest` | `['admin', 'principal', 'hr']` | Transaction + Check Owner Active + Version Lock | **Đã mở** |
| **Tính lại công có cách ly queue (1)** |
| 44 | `POST` | `/timekeeping/recalculate/:date` | `recalculateAttendance` | `['admin', 'principal']` | **HTTP Scoped Worker**: chỉ claim queue item của tenant mình; cô lập hoàn toàn khỏi queue tenant khác | **Đã mở** |

---

### E. Hợp đồng Tuyển dụng cũ (Public Retired Route)
| Phương thức | Đường dẫn | Handler | Phân quyền | Hành vi hợp đồng | Trạng thái |
|---|---|---|---|---|---|
| `USE` (mọi method) | `/hr/recruitment*` | `retiredRecruitmentHandler` | **Public** (không cần JWT/RBAC) | Trả về **HTTP 410 Gone** (`RECRUITMENT_FEATURE_RETIRED`) trên cả `/api/v1` và `/api` kể cả không gửi Authorization header hoặc gửi token sai | **Đã đóng vĩnh viễn** |

---

## 3. DANH SÁCH CÁC CỔNG TIẾP TỤC ĐÓNG CHẶT (FAIL-CLOSED)

Để bảo đảm tính ổn định và tuân thủ lộ trình Phase 1C-1E, các module và endpoint sau tiếp tục bị chặn fail-closed:
1. **Toàn bộ cổng Phase 1E (Phụ huynh, Học phí, Dinh dưỡng, Mua sắm, Chat, Đưa đón)**:
   - `/api/v1/parents/*`, `/api/parents/*` -> HTTP 501 `MODULE_NOT_IMPLEMENTED_IN_PHASE_1A`
   - `/api/v1/finance/*`, `/api/finance/*` -> HTTP 501
   - `/api/v1/nutrition/*`, `/api/nutrition/*` -> HTTP 501
   - `/api/v1/procurement/*`, `/api/procurement/*` -> HTTP 501
   - `/api/v1/chat/*`, `/api/chat/*` -> HTTP 501
   - `/api/v1/pickups/*`, `/api/pickups/*` -> HTTP 501
2. **Subpaths Nhân sự & Chấm công ngoài phạm vi 1D**:
   - `/api/v1/hr/payroll/*` (Bảng lương) -> HTTP 501
   - `/api/v1/hr/personal-requests/*` -> HTTP 501
   - `/api/v1/hr/credentials/*`, `/api/v1/hr/development/*`, `/api/v1/hr/handovers/*` -> HTTP 501
   - `/api/v1/hr/reports/*`, `/api/v1/hr/audit/*`, `/api/v1/hr/internal/*` -> HTTP 501
   - `/api/v1/timekeeping/device-events/*` (Sự kiện máy chấm công thô) -> HTTP 501
   - `/api/v1/timekeeping/kiosk/*` (Kiosk điểm danh) -> HTTP 501
   - `/api/v1/timekeeping/overtime/*` -> HTTP 501
   - `/api/v1/system/parents/*` -> HTTP 501
3. **Các mutation ngoài allowlist của Phase 1B/1C**:
   - `POST /classrooms`, `DELETE /classrooms/:id` -> HTTP 501
   - `POST /students`, `DELETE /students/:id` -> HTTP 501
4. **SaaS Modes cũ hoặc tương lai**:
   - Khi chạy ở mode `phase1b` hoặc `phase1c`: toàn bộ endpoints của HR, System Accounts và Timekeeping tiếp tục trả về HTTP 501 fail-closed.
   - Endpoint `PUT /classrooms/:id/homeroom-teacher` chỉ chấp nhận mode `phase1d`; các mode khác trả về HTTP 501.

---

## 4. CHI TIẾT BẢNG TỔNG HỢP KIỂM THỬ (TEST RESULTS)

### A. Test Suite Tích hợp Mới: `backend/tests/saas/phase1d5_integration.test.js`
- **Kết quả thực tế**: **48/48 tests PASS 100%**
- **Thời gian chạy**: **23.911 s**
- **Mã thoát (Exit Code)**: 0
- **Bao quát chi tiết 6 nhóm**:
  1. *Nhóm A — SaaS Mode Matrix & Route Gating (10 tests)*:
     - `A.1`: `phase1d` mở đúng endpoints HR, Accounts, Timekeeping trên cả 2 aliases `/api/v1` và `/api`.
     - `A.2`: Các mode cũ (`phase1b`, `phase1c`, `phase1a`) fail-closed 501 cho HR, Accounts, Timekeeping và homeroom assignment.
     - `A.3`: Các mode tương lai/lạ (`unknown`, `phase1e`, `phase1f`) fail-closed 501.
     - `A.4`: Hợp đồng công khai 410 Gone cho `/hr/recruitment` với/không token hoặc token sai trên cả 2 aliases.
     - `A.5`: Các submodules chưa duyệt (`/system/parents`, `/hr/payroll`, `/timekeeping/kiosk`, v.v.) fall-through 501.
     - `A.6`: Thứ tự ưu tiên: `options.saasMode` ghi đè `process.env.SAAS_MODE`.
     - `A.7`: `process.env.SAAS_MODE` được áp dụng khi `options.saasMode` bỏ trống.
     - `A.8`: Mặc định là `phase1b` khi cả options và env đều không cấu hình.
     - `A.9`: Thay đổi `process.env.SAAS_MODE` sau khi tạo app không làm thay đổi quyền của app đã tạo.
     - `A.10`: Typo mode (ví dụ `"phase1d "`) fail-closed 501.
  2. *Nhóm B — Xác thực, RBAC & Ranh giới Tenant (14 tests)*:
     - `B.1`: Thiếu hoặc sai token trả về 401.
     - `B.2`: Tài khoản inactive trả về 401 `USER_INACTIVE`.
     - `B.3`: Tenant bị suspended trả về 403 `TENANT_SUSPENDED`.
     - `B.4`: Token Tenant A truy cập nhân viên Tenant B trả về 404.
     - `B.5`: Phân quyền `/system/accounts`: admin & hr được phép; teacher, guard, parent bị chặn 403.
     - `B.6`: HR không thể tạo tài khoản admin hoặc principal (HTTP 422).
     - `B.7`: Chỉ admin được tạo phòng ban; hr và teacher bị chặn 403.
     - `B.8`: Duyệt đơn nghỉ phép nhân viên: chỉ admin & principal được phép; teacher và hr bị chặn 403.
     - `B.9`: Token legacy (thiếu claim SaaS) bị từ chối 401 trên router trường học.
     - `B.10`: Token Platform Admin (`PLATFORM_ADMIN_ACCESS`) bị từ chối 403 `INVALID_TOKEN_PURPOSE` trên router trường học.
     - `B.11`: Stale user authVersion bị từ chối 401 `AUTH_VERSION_MISMATCH`.
     - `B.12`: Stale tenant authVersion bị từ chối 403 `TENANT_AUTH_REVOKED`.
     - `B.13`: Token trỏ tenant không tồn tại trả về 401/403/404.
     - `B.14`: Payload body không thể leo quyền người gọi (body injection `role: admin` bị chặn 403).
  3. *Nhóm C — Nghiệp vụ Nhân sự, Tài khoản nội bộ & Phân công chủ nhiệm (9 tests)*:
     - `C.1`: CRUD tài khoản nội bộ trong Tenant A; chặn sửa đổi chéo tenant.
     - `C.2`: Đồng bộ tài khoản nhân sự liên kết User-Employee trong Tenant A mà không ảnh hưởng Tenant B.
     - `C.3`: Quản lý phòng ban và nhân viên scoped tenant.
     - `C.4`: Tạo ca trực, tra cứu thời khóa biểu và hủy ca trực.
     - `C.5`: Phân công chủ nhiệm `PUT /classrooms/:id/homeroom-teacher` cập nhật cả Classroom và version của User.
     - `C.6`: Gán giáo viên Tenant B vào lớp Tenant A thất bại với 422.
     - `C.7`: Các thao tác ghi đại diện (Accounts, Dept, Shift, Homeroom, Checkin) hoạt động đồng nhất trên cả `/api/v1` và `/api`.
     - `C.8`: Cập nhật phòng ban `PUT /hr/departments/:id`: chỉ admin được phép, hr và teacher bị chặn 403.
     - `C.9`: Chống router shadowing: bảo toàn định tuyến cụ thể `/staffing/timetable` và `/leave-requests/overview`.
  4. *Nhóm D — Chấm công & State Machine Điều chỉnh (10 tests)*:
     - `D.1`: Tự chấm công web tạo bản ghi trong đúng tenant.
     - `D.2`: Tra cứu `/timekeeping/me` và `/timekeeping/daily` cách ly dữ liệu tenant.
     - `D.3`: Toàn bộ vòng đời State Machine: Draft -> Update -> Submit -> Approve.
     - `D.4`: Xung đột version trả về 409 `VERSION_CONFLICT`.
     - `D.5`: Bảo vệ (`guard`) bị cấm tạo phiếu điều chỉnh công (HTTP 403).
     - `D.6`: Người duyệt không được tự duyệt phiếu của chính mình (400 `CANNOT_APPROVE_OWN_REQUEST`).
     - `D.7`: Tự hủy phiếu draft và pending: chính chủ được phép (200 `CANCELLED`), người ngoài bị chặn (403/404).
     - `D.8`: Hiệu trưởng từ chối phiếu điều chỉnh công cập nhật status `REJECTED` kèm audit log.
     - `D.9`: Lỗi tạo audit log kích hoạt atomic rollback việc tạo draft.
     - `D.10`: Lỗi tạo OutboxEvent kích hoạt atomic rollback việc phê duyệt điều chỉnh công.
  5. *Nhóm E — Hàng đợi tính công & HTTP Recalculate Isolation (1 test)*:
     - `E.1`: `POST /timekeeping/recalculate/:date` chỉ claim queue item của Tenant A; queue item của Tenant B và queue legacy đến hạn trước hoàn toàn không bị claim, không bị lock và giữ nguyên `status: 'PENDING'`, `attempts: 0`.
  6. *Nhóm F — Hồi quy Phase 1B/1C & Cổng Phase 1E (4 tests)*:
     - `F.1`: Tra cứu Classrooms và Students tiếp tục hoạt động trơn tru trong mode `phase1d`.
     - `F.2`: Điểm danh học sinh và Chuyển lớp học sinh tiếp tục hoạt động trong mode `phase1d`.
     - `F.3`: Các module nghiệp vụ Phase 1E (`/finance`, `/nutrition`, `/procurement`, `/chat`, `/pickups`) tiếp tục bị khóa chặt 501.
     - `F.4`: Ma trận method/path các mutation ngoài allowlist tiếp tục bị chặn chặt 501.

---

### B. Bảng Đối chiếu Toàn Bộ 9 Suites Phase 1D
| STT | Suite File | Nội dung nghiệp vụ | Số tests runtime | Kết quả |
|---|---|---|---|---|
| 1 | `tests/saas/phase1d1_data_boundary.test.js` | Nền tảng dữ liệu HR & Ranh giới Tenant (1D.1) | 39 | **PASS** |
| 2 | `tests/saas/phase1d2_internal_accounts_scoping.test.js` | Tài khoản nội bộ & Liên kết Employee-User (1D.2) | 44 | **PASS** |
| 3 | `tests/saas/phase1d3_hr_scoping.test.js` | Hồ sơ nhân sự, phòng ban & nghỉ phép (1D.3 HR) | 39 | **PASS** |
| 4 | `tests/saas/phase1d3_staffing_scoping.test.js` | Phân công nhân sự & ca trực (1D.3 Staffing) | 30 | **PASS** |
| 5 | `tests/saas/phase1d3_assignment_concurrency.test.js` | Phối hợp ghi đồng thời User - Classroom (1D.3 Concurrency) | 7 | **PASS** |
| 6 | `tests/saas/phase1d4_timekeeping_scoping.test.js` | Chấm công web cốt lõi (1D.4 Timekeeping) | 16 | **PASS** |
| 7 | `tests/saas/phase1d4_adjustments_scoping.test.js` | Điều chỉnh công & Transaction State Machine (1D.4 Adjustments) | 27 | **PASS** |
| 8 | `tests/saas/phase1d4_recalculation_scoping.test.js` | Tính lại công & Hàng đợi cách ly (1D.4 Recalculation) | 11 | **PASS** |
| 9 | `tests/saas/phase1d5_integration.test.js` | **Kiểm thử tích hợp SaaS Router Phase 1D (1D.5)** | 48 | **PASS** |
| **TỔNG** | **Phase 1D (9 Test Suites)** | **Toàn bộ Phase 1D** | **261** | **PASS 100% (Tổng thời gian chạy: 216.447 s)** |

*Ghi chú*:
- Số test runtime chính xác từng suite: 1D.1: 39; 1D.2: 44; 1D.3 HR: 39, Staffing: 30, Concurrency: 7; 1D.4 Timekeeping: 16, Adjustments: 27, Recalculation: 11; 1D.5: 48.
- Tổng số test runtime Phase 1D: **261 tests trên 9 suites** (Baseline trước 1D.5: 213 tests trên 8 suites + 48 tests mới của 1D.5).

---

### C. Kết quả Full Backend Test Suite (Regression Verification)
- **Lệnh thực thi**: `npm test --prefix backend -- --runInBand --forceExit`
- **Kết quả tổng kết**: **26/26 suites passed (100%), 730/730 tests passed (100%)**
- **Thời gian chạy**: **522.367 s**
- **Mã thoát (Exit Code)**: 0
- **So sánh với baseline trước 1D.5**:
  - Baseline trước 1D.5: 25 suites, 682 tests.
  - Kết quả sau 1D.5: 26 suites (+1 suite `phase1d5_integration.test.js`), 730 tests (+48 tests mới).
  - Hoàn toàn không có hồi quy trên Phase 1A, Phase 1B, Phase 1C hoặc các module legacy.

---

## 5. TỰ REVIEW ĐỘC LẬP (SELF-REVIEW)

1. **Hành vi (Behavioral)**:
   - Tất cả 44 endpoints nghiệp vụ hoạt động đúng theo đặc tả phân quyền RBAC và tenant isolation.
   - Endpoint tuyển dụng cũ trả về đúng HTTP 410 Gone công khai trước auth middleware.
   - Các cổng ngoài phạm vi và submodules chưa hoàn thiện fall-through sạch sẽ về HTTP 501 `tenantFeatureGate`.
2. **An ninh & Cô lập dữ liệu (Security & Tenant Boundary)**:
   - Token JWT được kiểm tra purpose (`SCHOOL_USER_ACCESS`), trạng thái user, trạng thái tenant, authVersion và tenantAuthVersion.
   - Không cho phép người dùng Tenant A xem hoặc tác động dữ liệu Tenant B.
   - Chặn đứng mọi hành vi leo quyền qua body payload injection.
   - Bảo vệ kiểm tra actor quyền hạn trong từng callback transaction.
3. **Tính toàn vẹn & Phối hợp ghi đồng thời (Concurrency & Atomicity)**:
   - Các thao tác cập nhật nhạy cảm (tài khoản, đổi vai trò, phân công chủ nhiệm, state machine chấm công) đều được thực thi trong MongoDB Session Transaction.
   - Kiểm tra `assignmentVersion` trên `User` khi gán chủ nhiệm lớp để ngăn chặn race condition giữa việc đổi vai trò và gán lớp.
   - Lỗi audit log hoặc OutboxEvent kích hoạt rollback transaction toàn vẹn.
4. **Hồi quy & Tương thích ngược (Regression & Backward Compatibility)**:
   - Phase 1B (Classrooms, Students reads) và Phase 1C (Điểm danh học sinh, Chuyển lớp học sinh) hoạt động ổn định 100%.
   - Endpoint tương thích `/timekeeping/corrections` cho frontend cũ tiếp tục hoạt động mượt mà.
5. **Giới hạn đã biết (Known Constraints)**:
   - Ràng buộc global unique trên `Department.code` và `Employee.employeeCode` là giới hạn kỹ thuật phụ thuộc vào các migration dữ liệu còn lại trong lộ trình SaaS hóa; không khuyến nghị thêm tiền tố mã trường như giải pháp chính thức đã nghiệm thu.

---

## 6. PHÂN BIỆT MÔI TRƯỜNG TEST VÀ RUNTIME THẬT

- **Môi trường Test**: Toàn bộ kiểm thử tự động sử dụng `MongoMemoryReplSet` độc lập được khởi tạo qua `testDbBootstrap` với `safeDbGuard`, hoàn toàn không kết nối hay tác động đến database runtime.
- **Môi trường Runtime thật**: Phiên bản runtime đã được Codex khôi phục (Backend `http://localhost:5001`, Frontend `http://localhost:5173`, MongoDB `127.0.0.1:27018` Replica Set `rs0` tại `E:\school-mongo-recovery-20261106\data`) được giữ nguyên vẹn 100%:
  - Không sửa đổi file `.env`.
  - Không reset, seed hay thay đổi dữ liệu tài khoản hoặc cơ sở dữ liệu runtime.
  - Không khởi động scheduler trên môi trường runtime.
  - Không dừng hoặc khởi động lại các tiến trình runtime.

---

## 7. KẾT LUẬN & ĐIỀU KIỆN TIẾP TỤC

- **Nhiệm vụ Task 1D.5 đã hoàn thành toàn diện 100%**.
- Toàn bộ worktree được bảo toàn (không commit, không push, không reset, không stash).
- `git diff --check` đạt mã thoát 0, không có lỗi whitespace hay formatting.
- **DỪNG LẠI TẠI ĐÂY ĐỂ CODEX KIỂM TRA VÀ NGHIỆM THU. TUYỆT ĐỐI KHÔNG TỰ Ý BẮT ĐẦU PHASE 1E.**
