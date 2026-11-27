# BÁO CÁO NGHIỆM THU VÀ BÀN GIAO TASK 1D.3: CÁCH LY NGHIỆP VỤ NHÂN SỰ, NGHỈ PHÉP VÀ PHÂN CÔNG LỚP THEO TRƯỜNG

**Dự án**: Trường Mầm Non / Hệ thống Quản trị Nhà trường (SaaS Multi-Tenant)  
**Workspace**: `E:\school-management-api`  
**Giai đoạn**: Phase 1D — Nhân Sự & Phân Quyền Tổ Chức Đa Trường  
**Nhiệm vụ**: Task 1D.3 — Tenant Scoping cho HR, Staffing, Phân công lớp & Điều phối đồng thời (Race Condition Prevention)  
**Ngày hoàn thành**: 04/11/2026  
**Trạng thái**: **HOÀN THÀNH — ĐÃ KIỂM CHỨNG BẰNG FULL BACKEND TEST (628/628 TESTS PASS TRÊN 22/22 SUITES; 159/159 TESTS PASS TRÊN 5 SUITES PHASE 1D)**

---

## I. MỤC TIÊU VÀ TỔNG QUAN KẾT QUẢ

Task 1D.3 hoàn thành các mục tiêu kỹ thuật trong phạm vi:
1. **Tenant Scoping cho 25 API handlers nghiệp vụ nhân sự, phân công và chủ nhiệm**:
   - 16 handlers tại `backend/src/controllers/hrController.js` (Phòng ban, Đồng bộ tài khoản nhân sự, Hồ sơ nhân sự CRUD, Quản lý đơn nghỉ phép).
   - 8 handlers tại `backend/src/controllers/staffingController.js` (Bảng phân công nhân sự, thời khóa biểu, phân công nhân sự vào lớp, ca làm việc, phân công người dạy thay).
   - 1 handler tại `backend/src/controllers/classroomController.js` (`assignHomeroomTeacher` — phân công giáo viên chủ nhiệm).
2. **Đóng toàn bộ đường truy vấn không có tenant context và scope các helper liên quan**:
   - `staffingService.js`: `getStaffingSnapshot` và `getStaffingTimetable` sử dụng `buildTenantFilter(context, { throwOnInvalid: true })`, fail closed khi thiếu hoặc sai context, không fallback filter `{}`. Cập nhật đầy đủ caller (`staffingController`, `hrController`, `principalAlertsController`, `reportController`, `hrReportService`, `hrReportController`).
   - `staffLeaveService.js`: `scheduledLeaveDates` nhận `context` và `session`, scope cả `StaffShift` và `Classroom` theo tenant, kiểm tra tính hợp lệ của liên kết User-Employee, ngăn chặn lịch của trường khác làm thay đổi `workDates`/`totalDays`.
3. **Bảo vệ toàn vẹn giao dịch và xác minh actor trong transaction session**:
   - **Re-verify actor trong transaction session**:
     - `createDepartment`, `updateDepartment`: Re-verify actor có role `admin`, status `active`, cùng `tenantId`.
     - `syncStaffAccounts`, `createEmployee`, `updateEmployee`: Re-verify actor có role trong `['admin', 'hr']`, status `active`, cùng `tenantId`.
     - `assignHomeroomTeacher`, `assignClassroomStaff`, `createShift`, `cancelShift`, `createReplacement`, `cancelReplacement`, `createLeaveRequest`, `processLeaveRequest`: Re-verify actor tương ứng.
   - **Ngăn chặn triệt để tình huống actor bị hạ quyền hoặc khóa sau middleware nhưng trước snapshot**:
     - Nếu actor bị hạ quyền hoặc khóa sau khi middleware đã xác thực thành công nhưng trước khi transaction snapshot bắt đầu, callback transaction đọc lại actor từ DB qua `session` -> phát hiện vi phạm và ném HTTP 403.
     - Toàn bộ thay đổi nghiệp vụ bị hủy/rollback hoàn toàn; không có bản ghi nào bị thay đổi trong database.
     - Không ghi `AuditLog` cho request bị từ chối; với request thành công, `AuditLog` được ghi với `actorId` và `actorUsername` lấy từ chính actor vừa xác minh trong session.
   - **Kiểm tra liên kết ngoại lai và lịch bàn giao**:
     - Kiểm tra liên kết hồ sơ nhân sự ngoại lai (alien link) và lịch bàn giao nghỉ việc (`StaffHandover` status `scheduled`).
     - Ghi `AuditLog` nguyên tử trong cùng transaction session; nếu audit thất bại, toàn bộ thao tác nghiệp vụ được rollback hoàn toàn.
     - Xác minh recipient của `Notification` thuộc cùng tenant trước khi gửi; không gửi thông báo nếu transaction bị hủy.
4. **Điều phối đồng thời (Concurrency Coordination) giữa Gán lớp và Đổi vai trò**:
   - Điều phối giữa luồng **Gán lớp học** (`assignHomeroomTeacher`, `assignClassroomStaff`) và luồng **Đổi vai trò** (`updateInternalAccountRole`, `updateInternalAccount`) qua cơ chế conditional write trên trường `assignmentVersion` của `User`.
   - Kiểm chứng bằng barrier xác định: WiredTiger WriteConflict ép retry callback trên snapshot mới; invariant được bảo toàn (tài khoản không còn là teacher thì không thể được gán vào lớp active).
5. **Bảo toàn dữ liệu và tuân thủ quy tắc kiến trúc Phase 1D**:
   - Giữ nguyên global unique index trên `Department.code` và `Employee.employeeCode` theo đúng quyết định thiết kế tại `docs/SAAS-PHASE-1D-INDEX-DECISIONS.md`. Bắt lỗi `E11000` chuyển thành HTTP 409 có kiểm soát.
   - Giữ nguyên trạng thái router SaaS HR đóng trong `createSaasApp.js` (trả về HTTP 501 / 404 cho tới Task 1D.5).
   - Bảo toàn toàn bộ dirty worktree, không chạm database thật, không chỉnh sửa file `.env`.

---

## II. BẢNG ĐỐI CHIẾU 25 HANDLERS THEO ROUTE VÀ RBAC THỰC TẾ

Đối chiếu trực tiếp với `backend/src/routes/hrRoutes.js` và `backend/src/routes/classroomRoutes.js`:

| STT | Endpoint | Method | RBAC Thực Tế | Model Đọc / Ghi | Cơ chế Tenant Scoping & Transaction | Side Effects |
|-----|----------|--------|--------------|-----------------|--------------------------------------|--------------|
| **A. HR Controller (`hrController.js`)** | | | | | | |
| 1 | `/api/v1/hr/departments` | GET | `admin`, `principal`, `accountant`, `hr` | `Department` | `buildTenantFilter` áp dụng trực tiếp vào `Department.find` | Không |
| 2 | `/api/v1/hr/departments` | POST | `admin` | `Department`, `User` | `runHrTransaction`: Re-verify actor (`admin`, `active`, scoped tenant); gán `tenantId` từ context; bắt trùng code `E11000` -> 409 | Không ghi audit log (Schema chưa có enum cho Department) |
| 3 | `/api/v1/hr/departments/:id` | PUT | `admin` | `Department`, `User` | `runHrTransaction`: Re-verify actor (`admin`, `active`, scoped tenant); cập nhật theo ID + `tenantFilter`; bắt `E11000` -> 409; cấm sửa/xóa `tenantId` | Không ghi audit log (Schema chưa có enum cho Department) |
| 4 | `/api/v1/hr/staff-accounts` | GET | `admin`, `principal`, `hr` | `User`, `Employee` | Filter `User` role nội bộ + `tenantFilter`; populate `Employee` scoped tenant | Không |
| 5 | `/api/v1/hr/staff-accounts/sync` | POST | `admin`, `hr` | `User`, `Employee` | `runHrTransaction`: Re-verify actor (`admin`/`hr`, `active`, scoped tenant); quét User thiếu Employee trong tenant, tạo Employee với `tenantId`; `syncLinkedUser` | Không |
| 6 | `/api/v1/hr/employees` | GET | `admin`, `principal`, `accountant`, `hr` | `Employee`, `User`, `Department` | `buildTenantFilter` trên `Employee.find`; populate `userId`, `departmentId` scoped tenant | Không |
| 7 | `/api/v1/hr/employees/:id` | GET | `admin`, `principal`, `accountant`, `hr` | `Employee` | `findOne` theo `_id` + `tenantFilter`; sanitize alien reference nếu có | Không |
| 8 | `/api/v1/hr/employees/:id/history` | GET | `admin`, `principal`, `hr` | `Employee`, `AuditLog` | Kiểm tra Employee tồn tại trong tenant trước; query `AuditLog` theo `targetId` | Không |
| 9 | `/api/v1/hr/employees` | POST | `admin`, `hr` | `Employee`, `User`, `Department`, `AuditLog` | `runHrTransaction`: Re-verify actor (`admin`/`hr`, `active`, scoped tenant); validate `userId` & `departmentId` cùng tenant; bắt E11000 -> 409 | `AuditLog` (`EMPLOYEE_CREATED`, actorId từ session) |
| 10 | `/api/v1/hr/employees/:id` | PUT | `admin`, `hr` | `Employee`, `User`, `Department`, `AuditLog`, `StaffHandover` | `runHrTransaction`: Re-verify actor (`admin`/`hr`, `active`, scoped tenant); handover check; validate `departmentId` cùng tenant; cập nhật hồ sơ | `AuditLog` (`EMPLOYEE_UPDATED`, actorId từ session) |
| 11 | `/api/v1/hr/employees/:id` | DELETE | `admin`, `hr` | `Employee` | Trả 409 theo quy định nghiệp vụ hiện hành (yêu cầu chuyển sang status `resigned`) | Không |
| 12 | `/api/v1/hr/leave-requests` | POST | `admin`, `teacher`, `accountant`, `chef`, `guard`, `hr` | `LeaveRequest`, `Employee`, `User` | `runHrTransaction`: Re-verify actor, ownership, write skew touch trên Employee, scope lịch tính ngày, tạo đơn, audit rollback | `Notification` nội bộ sau commit |
| 13 | `/api/v1/hr/my-leave-requests` | GET | `admin`, `principal`, `teacher`, `accountant`, `chef`, `guard`, `hr` | `LeaveRequest`, `Employee` | Lọc `employeeId` của actor + `tenantFilter` | Không |
| 14 | `/api/v1/hr/leave-requests/overview` | GET | `admin`, `principal`, `hr` | `LeaveRequest`, `Employee` | Thống kê số lượng đơn theo status scoped `tenantFilter` | Không |
| 15 | `/api/v1/hr/leave-requests` | GET | `admin`, `principal`, `hr` | `LeaveRequest`, `Employee` | Lọc danh sách đơn nghỉ theo `tenantFilter` + trạng thái duyệt | Không |
| 16 | `/api/v1/hr/leave-requests/:id/review` | PATCH | `admin`, `principal` | `LeaveRequest`, `Employee`, `User` | `runHrTransaction`: Re-verify actor, pending check, write skew touch trên Employee, cập nhật, audit | `Notification` nội bộ sau commit |
| **B. Staffing Controller (`staffingController.js`)** | | | | | | |
| 17 | `/api/v1/hr/staffing` | GET | `admin`, `principal`, `hr` | `Classroom`, `Employee`, `StaffShift`, `StaffReplacement` | Scope toàn bộ query qua `staffingService.getStaffingSnapshot(date, req)` (fail closed) | Không |
| 18 | `/api/v1/hr/staffing/timetable` | GET | `admin`, `principal`, `hr` | `Classroom`, `Employee`, `StaffShift` | Scope toàn bộ query qua `staffingService.getStaffingTimetable(..., req)` (fail closed) | Không |
| 19 | `/api/v1/hr/my-staffing` | GET | `admin`, `principal`, `teacher`, `chef`, `guard`, `accountant`, `hr` | `Classroom`, `StaffShift`, `StaffReplacement` | Lấy phân công lớp và ca trực riêng của actor trong tenant | Không |
| 20 | `/api/v1/hr/staffing/classrooms/:id` | PUT | `admin`, `hr` | `Classroom`, `User`, `Employee` | `inTransaction`: Re-verify actor, check alien link, handover check, double booking check, **conditional write `$inc: { assignmentVersion: 1 }` trên User giáo viên**, audit | `audit` log |
| 21 | `/api/v1/hr/staffing/shifts` | POST | `admin`, `hr` | `StaffShift`, `Employee`, `User` | `inTransaction`: Re-verify actor, check alien link, handover check, write skew touch trên Employee, overlap check, audit | `Notification` sau commit |
| 22 | `/api/v1/hr/staffing/shifts/:id` | DELETE | `admin`, `hr` | `StaffShift`, `StaffReplacement` | `inTransaction`: Re-verify actor, replacement check, cập nhật status `cancelled`, audit | `Notification` sau commit |
| 23 | `/api/v1/hr/staffing/replacements` | POST | `admin`, `hr` | `StaffReplacement`, `Employee`, `LeaveRequest`, `Classroom`, `StaffShift` | `inTransaction`: Re-verify actor, check alien link, absent leave check, replacement leave check, target check, write skew touch, audit | `Notification` sau commit |
| 24 | `/api/v1/hr/staffing/replacements/:id` | DELETE | `admin`, `hr` | `StaffReplacement` | `inTransaction`: Re-verify actor, cập nhật status `cancelled`, audit | `Notification` sau commit |
| **C. Classroom Controller (`classroomController.js`)** | | | | | | |
| 25 | `/api/v1/classrooms/:id/homeroom-teacher` | PUT | `admin`, `hr` | `Classroom`, `User`, `Employee` | `session.withTransaction`: Re-verify actor, **atomic conditional write `$inc: { assignmentVersion: 1 }` trên User**, check alien employee link, check handover, check unique homeroom, audit nguyên tử trong session | `audit` log (`CLASSROOM_STAFF_ASSIGNED`) |

---

## III. CƠ CHẾ ĐIỀU PHỐI ĐỒNG THỜI VÀ GIỚI HẠN TRANSACTION SNAPSHOT

### 1. Phân tích bài toán xung đột (Race Condition)
- **Kịch bản rủi ro**: Luồng 1 (Gán chủ nhiệm hoặc gán hỗ trợ lớp) và Luồng 2 (Đổi vai trò giáo viên sang kế toán/bếp/bảo vệ) chạy song song trên 2 kết nối riêng biệt.
  - Luồng 1 đọc User: thấy vai trò vẫn là `teacher`.
  - Luồng 2 kiểm tra Classroom: thấy giáo viên chưa được gán vào lớp nào.
  - Cả hai commit: Dẫn đến tài khoản không còn là giáo viên nhưng vẫn đứng tên chủ nhiệm trong lớp học đang hoạt động!
- **Giải pháp**: Cơ chế phối hợp conditional write trên trường `assignmentVersion` của document `User`.

### 2. Thiết kế chi tiết
1. **Model `User` (`backend/src/models/zone1_system/User.js`)**:
   - Thêm trường `assignmentVersion: { type: Number, default: 0 }`.
2. **Luồng Gán lớp (`assignHomeroomTeacher` & `assignClassroomStaff`)**:
   - Trong transaction, thực hiện conditional update atomic:
     ```javascript
     const teacher = await User.findOneAndUpdate(
       { _id: teacherId, role: 'teacher', status: 'active', ...tenantFilter },
       { $inc: { assignmentVersion: 1 } },
       { session, new: true }
     );
     if (!teacher) throw error('Chỉ có thể chọn tài khoản giáo viên đang hoạt động', 422);
     ```
3. **Luồng Đổi vai trò (`systemUserController.js`)**:
   - Trong transaction của `updateInternalAccount`, đọc lại User trong session, kiểm tra `Classroom.exists`, và tăng `target.assignmentVersion = (target.assignmentVersion || 0) + 1;` trước khi `await target.save({ session })`.
4. **Cơ chế WiredTiger Write Conflict & Retry Callback**:
   - Vì cả hai transaction đều thực hiện ghi lên cùng một document `User` của giáo viên:
     - MongoDB WiredTiger phát hiện xung đột và buộc transaction thứ hai phải retry callback trên snapshot mới.
     - Nếu Gán lớp commit trước: Luồng Đổi role retry attempt 2 trên snapshot mới, kiểm tra `Classroom.exists` thấy đã có lớp -> **từ chối 409**.
     - Nếu Đổi role commit trước: Luồng Gán lớp retry attempt 2 trên snapshot mới, câu lệnh `User.findOneAndUpdate` với điều kiện `role: 'teacher'` không khớp bản ghi nào -> **từ chối 422**.
   - Bất biến được bảo toàn: **Không bao giờ cả hai cùng thành công**.

### 3. Phân tích Giới hạn của Transaction Snapshot (Snapshot Isolation Limit)
- **Bản chất của Snapshot Isolation trong MongoDB**:
  - Khi một transaction bắt đầu, MongoDB tạo ra một "snapshot" đọc dữ liệu tại thời điểm commit gần nhất. Mọi truy vấn đọc trong transaction callback sẽ nhìn thấy dữ liệu nhất quán tại thời điểm đó.
  - **Giới hạn quan trọng**: Transaction snapshot **không thể tự động phát hiện hoặc ngăn chặn những thay đổi xảy ra trên các collection khác sau thời điểm snapshot bắt đầu**, trừ khi có thao tác ghi xung đột (WiredTiger WriteConflict) trên cùng một document hoặc có cơ chế coordination touch.
  - **Ứng dụng thực tế trong hệ thống**:
    1. Việc đọc lại actor (`User.findOne(...).session(session)`) ngay đầu callback transaction là điều kiện cần để xác minh quyền tại thời điểm snapshot. Nếu actor bị khóa hoặc hạ quyền *trước* khi snapshot bắt đầu, transaction đảm bảo 100% phát hiện và từ chối 403.
    2. Nếu có nguy cơ actor bị hạ quyền đồng thời *trong lúc* transaction đang chạy và cần bảo vệ tuyệt đối không cho thao tác xảy ra, hệ thống áp dụng cơ chế conditional write/touch (tương tự như `assignmentVersion` trên document `User` giữa Gán lớp và Đổi vai trò).

---

## IV. BẰNG CHỨNG KIỂM THỬ THỰC TẾ

### 1. Ba bộ kiểm thử của riêng Task 1D.3 (76/76 tests pass)

```powershell
npm test --prefix backend -- backend/tests/saas/phase1d3_hr_scoping.test.js backend/tests/saas/phase1d3_staffing_scoping.test.js backend/tests/saas/phase1d3_assignment_concurrency.test.js --runInBand --forceExit
```

- **Kết quả**: Exit code `0`
- **Số test suites**: `3 passed, 3 total`
- **Số test cases**: `76 passed, 76 total`
- **Thời gian chạy**: `59.065 s`

Chi tiết từng suite:

#### Suite 1: `backend/tests/saas/phase1d3_hr_scoping.test.js` (39/39 tests passed)
- **Nhóm A (Phòng ban)**: 6 tests (A.1 -> A.6: Cách ly Tenant A/B, tự động gán tenantId, bắt E11000 trả 409, cấm đổi tenantId qua update).
- **Nhóm B (Tài khoản & Đồng bộ)**: 3 tests (B.1 -> B.3: getStaffAccounts cách ly, syncStaffAccounts tạo hồ sơ đúng tenant, không tạo chéo trường).
- **Nhóm C (Hồ sơ nhân sự)**: 8 tests (C.1 -> C.8: CRUD scoped tenant, sanitize alien populate, cấm delete cứng trả 409, audit history scoped).
- **Nhóm D (Nghỉ phép)**: 6 tests (D.1 -> D.6: Tự tạo đơn, cấm tạo hộ người trường khác, notification scoped tenant, getMyLeaveRequests, duyệt đơn).
- **Nhóm E (RBAC Middleware Thật & Legacy)**: 3 tests (E.1 -> E.3: Teacher bị 403, Legacy Admin độc lập, createSaasApp đóng router HR 501).
- **Nhóm F (Tenant Context Enforcement trong Staffing & Leave Helper)**: 4 tests (F.1 -> F.4: fail closed khi thiếu/sai context, cách ly snapshot A/B/Legacy, User A tham chiếu lớp B không làm đổi workDates của đơn A, StaffShift B không làm đổi ngày nghỉ đơn A).
- **Nhóm G (Recipient Notification, Actor Re-verification & Transaction Protection)**: 4 tests (G.1 -> G.4: Employee trỏ alien user không gửi thông báo, actor đổi role sang teacher bị 403 trong transaction, đơn nghỉ trùng lặp bị 409, audit lỗi rollback toàn bộ).
- **Nhóm H (Actor Re-verification trong Transaction Snapshot cho 5 Handler)**: 5 tests (H.1 -> H.5: Barrier/spy cập nhật DB thật sau middleware nhưng trước snapshot, khẳng định từ chối 403, DB không đổi, không ghi audit, kèm happy path đối ứng thành công 200/201 cho: `createDepartment`, `updateDepartment`, `syncStaffAccounts`, `createEmployee`, `updateEmployee`).

> **Giải thích chi tiết về số lượng test HR Scoping tăng từ 35 lên 39 tests:**
> - Trước khi hoàn thiện, suite HR scoping có **35 tests** (gồm 5 tests trong Nhóm G, trong đó có test `G.5` cũ gộp chung 3 handler `syncStaffAccounts`, `createEmployee`, `updateEmployee`).
> - Test `G.5` cũ chỉ cập nhật actor trước khi gọi API nên bị chặn ở middleware pre-check chứ chưa chứng minh được logic re-verify trong transaction snapshot, không có Department, không có barrier/spy và không có happy path.
> - Do đó, test `G.5` cũ đã được **thay thế hoàn toàn** bằng **Nhóm H gồm 5 test cases độc lập (H.1 -> H.5)** cho cả 5 handler.
> - Phép tính số test: `35 ban đầu - 1 (G.5 cũ bị thay thế) + 5 (H.1 -> H.5 mới) = 39 tests`.
> - **Bảo toàn coverage**: Toàn bộ yêu cầu kiểm thử của G.5 cũ không những được giữ nguyên mà còn được nâng cấp toàn diện bằng barrier xác định, kiểm tra DB/audit không đổi, kèm happy path đối ứng, bảo đảm không làm mất bất kỳ khía cạnh kiểm thử nào.

#### Suite 2: `backend/tests/saas/phase1d3_staffing_scoping.test.js` (30/30 tests passed)
- **Nhóm A (Xem phân công & Thời khóa biểu)**: 3 tests (getStaffing snapshot scoped, timetable classroomId ngoại lai 404, getMyStaffing).
- **Nhóm B (Gán giáo viên vào lớp)**: 12 tests (assignHomeroomTeacher scoped, bump assignmentVersion, homeroom limit 409, assignClassroomStaff support teachers, alien teacher ID từ chối 422/409, handover scheduled 409, double booking 409, teacher active nhưng Employee resigned 422, alien employee link 409, handover scheduled 409, actor đổi role trước snapshot 403, audit lỗi rollback toàn bộ assignment và assignmentVersion).
- **Nhóm C (Ca làm việc)**: 7 tests (Tạo ca bảo vệ, cấm tạo ca nhân viên trường khác 422, hủy ca scoped 200/404, actor đổi role trước snapshot 403, overlapping shift tạo trước snapshot 409, alien user link 409, audit lỗi rollback toàn bộ StaffShift).
- **Nhóm D (Phân công thay thế)**: 6 tests (Tạo replacement khi có đơn nghỉ duyệt 201, cấm chéo trường 422, hủy replacement scoped 200/404, actor bị hạ quyền trước snapshot 403, alien employee link 409, audit lỗi rollback toàn bộ StaffReplacement).
- **Nhóm E (Quyền truy cập lớp học qua thay thế)**: 2 tests (`canAccessClassroom` cho phép đúng ngày nghỉ duyệt, từ chối giáo viên trường khác dù có bản ghi thay thế giả mạo).

#### Suite 3: `backend/tests/saas/phase1d3_assignment_concurrency.test.js` (7/7 tests passed)
- **Thứ tự A (Đổi role commit trước -> Gán lớp bị từ chối 422)**: 2 tests (Cả homeroom lẫn support teacher).
- **Thứ tự B (Gán lớp commit trước -> Đổi role bị từ chối 409)**: 2 tests (Cả PATCH /accounts/:id lẫn /accounts/:id/role).
- **Thứ tự C (Overlapping Transactions với Barrier Xác Định)**: 2 tests (Barrier tạm dừng Luồng 1 tại điểm đọc pre-check, kích hoạt Luồng 2 chạy và commit trước; Luồng 1 gặp WiredTiger WriteConflict, driver retry attempt 2 trên snapshot mới, đọc lại điều kiện và từ chối 409; invariant được bảo toàn).
- **Thứ tự D (Độc lập đa trường)**: 1 test (Thao tác ở Tenant B không cản trở Tenant A).

---

### 2. Tổng hợp các test suites riêng của Phase 1D (159/159 tests pass)

> **Lưu ý phân định phạm vi**: Con số **159/159 tests** là tổng số test của **5 suites chuyên biệt thuộc Phase 1D**, KHÔNG PHẢI toàn bộ backend:

```powershell
npm test --prefix backend -- backend/tests/saas/phase1d1_data_boundary.test.js backend/tests/saas/phase1d2_internal_accounts_scoping.test.js backend/tests/saas/phase1d3_hr_scoping.test.js backend/tests/saas/phase1d3_staffing_scoping.test.js backend/tests/saas/phase1d3_assignment_concurrency.test.js --runInBand --forceExit
```

1. `phase1d1_data_boundary.test.js` (Task 1D.1): **39 passed**
2. `phase1d2_internal_accounts_scoping.test.js` (Task 1D.2): **44 passed**
3. `phase1d3_hr_scoping.test.js` (Task 1D.3): **39 passed**
4. `phase1d3_staffing_scoping.test.js` (Task 1D.3): **30 passed**
5. `phase1d3_assignment_concurrency.test.js` (Task 1D.3): **7 passed**
- **Tổng cộng Phase 1D**: **159 passed / 159 total (100%)**.

---

### 3. Kết quả Full Backend Gate (Mốc mới 628/628 tests pass)

```powershell
npm test --prefix backend -- --forceExit
```

- **Exit code**: `0`
- **Tổng số test suites**: `22 passed, 22 total`
- **Tổng số test cases**: `628 passed, 628 total`
- **So sánh mốc trước**: Tăng 4 tests so với mốc **624/624 tests** trước đó (`624 + 4 = 628 tests`, tương ứng với số test của `phase1d3_hr_scoping.test.js` tăng từ 35 lên 39).
- **Thời gian chạy**: `372.939 s`
- **Cảnh báo thực tế từ Jest**:
  ```
  Force exiting Jest: Have you considered using '--detectOpenHandles' to detect async operations that kept running after all tests finished?
  ```
  > **Ghi nhận kỹ thuật**: Việc cờ `--forceExit` kết thúc tiến trình thành công KHÔNG được coi là bằng chứng hệ thống không còn open handle. Jest ghi nhận cảnh báo này do một số kết nối MongoDB in-memory/Replica Set runner và timer nền trong môi trường test harness chưa được đóng hoàn toàn ngay khi test suite cuối cùng kết thúc.

---

## V. CÁC ĐIỂM DỪNG VÀ GIỚI HẠN BÀN GIAO CHO GIAI ĐOẠN TIẾP THEO

1. **Giới hạn Global Unique Index**:
   - `Department.code` (`code_1`) và `Employee.employeeCode` (`employeeCode_1`) tiếp tục giữ unique toàn cục theo thiết kế đã chốt tại `docs/SAAS-PHASE-1D-INDEX-DECISIONS.md`.
   - Các API đã bắt `E11000` và trả về HTTP 409 có kiểm soát. Việc chuyển sang partial compound index theo trường (nếu có) sẽ thực hiện ở giai đoạn migration sau.
2. **Router SaaS HR Tiếp tục Đóng**:
   - File `backend/src/saas/createSaasApp.js` tiếp tục đóng các endpoint HR và Timekeeping (trả về HTTP 501 / 404). Việc tích hợp router chính thức lên SaaS App sẽ được thực hiện tại **Task 1D.5**.
3. **Phân định rõ phạm vi Task 1D.4 và các backlog riêng**:
   - **Task 1D.4** chỉ bao gồm: **Chấm công cốt lõi** (`timekeepingController.js`, `AttendanceRecord`, `MonthlyTimesheet`, daily attendance scoping).
   - **Các phụ thuộc riêng / backlog riêng** (KHÔNG thuộc 1D.4): Tính lương payroll, tài chính (`financeExcelController.js`), xử lý bàn giao công việc CRUD (`StaffHandover`), và xử lý khiếu nại cá nhân (`staffPersonalRequestController.js`).

---

## VI. BẢO TOÀN WORKTREE

- Toàn bộ dirty worktree trước đó được bảo toàn nguyên vẹn (`git status --short`).
- Không có thao tác `git commit`, `git push`, `git reset`, `git stash`, hay `git clean`.
- Không chỉnh sửa file `.env` và không kết nối database môi trường thật.
