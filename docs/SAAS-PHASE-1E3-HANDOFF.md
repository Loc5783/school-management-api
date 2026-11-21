# BÁO CÁO NGHIỆM THU & BÀN GIAO TASK 1E.3
## CÁCH LY BIỂU PHÍ VÀ HÓA ĐƠN HỌC PHÍ THEO TRƯỜNG (ZONE 4 FINANCE)

- **Dự án**: `E:\school-management-api`
- **Mốc thực hiện**: Giai đoạn 1E — Task 1E.3 (Cách ly biểu phí và hóa đơn học phí theo trường)
- **Trạng thái**: **HOÀN THÀNH — PASS 100% (35/35 tests Suite 1E.3; Hồi quy 1E.1, 1E.2, 1D.5 và Full Backend 897/897 tests đạt 100%)**
- **Tác nhân triển khai**: Antigravity
- **Người điều phối & nghiệm thu**: Codex
- **Phiên bản MongoDB kiểm chứng**: **MongoDB 8.2.6** (trên `MongoMemoryReplSet` cô lập)

---

## 1. TỔNG QUAN PHẠM VI TASK 1E.3 VÀ BẢO TOÀN WORKSPACE / RUNTIME

Thực hiện nghiêm túc chỉ thị triển khai Task 1E.3 và xử lý đầy đủ các phát hiện nghiệm thu từ Codex, Antigravity đã hoàn thành cách ly toàn diện phân hệ Biểu phí (`FeeSchedule`) và Hóa đơn học phí (`TuitionFee`) thuộc Zone 4 Finance:

1. **Bảo toàn Workspace & Runtime**:
   - Bảo toàn 100% dirty/untracked worktree hiện có; không reset, stash, clean, commit, push hay merge.
   - Không sửa file `.env`, không in token, mật khẩu hay URI chứa thông tin xác thực.
   - Không chạy migration, seed, dropIndex, createIndexes trên database thật.
   - Không thay đổi index declaration trong product schema của các model tài chính.
   - Không tác động lên các tiến trình runtime 5173, 5001 hay MongoDB 27018 rs0; không bật scheduler hay background worker.
   - Toàn bộ kiểm thử được chạy độc lập trên `MongoMemoryReplSet` cô lập thông qua `testDbBootstrap` với lớp bảo vệ `safeDbGuard`.
   - **Router SaaS tài chính (`createSaasApp.js`) tiếp tục giữ đóng HTTP 501 Fail-Closed** cho cả mode `phase1d` và `phase1e`.

2. **Mục tiêu & Các phát hiện nghiệm thu đã giải quyết**:
   - Chuyển đổi và bọc `assertTenantContext(req)` cho toàn bộ các handler đọc/ghi hóa đơn, biểu phí và tải mẫu Excel.
   - Ngăn chặn triệt để đọc/ghi chéo tenant giữa các trường đối với biểu phí, hóa đơn, công nợ, khoản thu thêm, lịch sử điều chỉnh và template Excel.
   - **Cách ly File Excel Mẫu**: `getFeeScheduleTemplate` và `getInvoiceTemplate` xác thực trusted tenant context trước query; `financeExcelImportService` áp dụng `buildTenantFilter(context)` để lọc lớp học và học sinh theo đúng trường trong mọi sheet (kể cả sheet danh mục tra cứu và công thức data validation); hỗ trợ legacy context (`tenantId: null/missing`).
   - **Bảo vệ Populate trong Export**: `exportInvoices` và `exportDebts` bổ sung `match: tenantFilter` khi `.populate('studentId')`, đồng thời vệ sinh dữ liệu `studentCode` dự phòng để ngăn chặn rò rỉ mã học sinh ngoại lai nếu có tham chiếu chéo tenant trong DB.
   - **Re-verify Actor trong Session khi Confirm Import**: `confirmFeeScheduleImport` và `confirmInvoiceImport` kiểm tra lại trạng thái hoạt động và vai trò `['admin', 'accountant']` của actor ngay trong transaction session; ném HTTP 403 và rollback toàn bộ transaction nếu tài khoản bị khóa hoặc hạ quyền.
   - Bảo vệ phân quyền Phụ huynh (`parent`): chỉ được xem học phí và biên lai của con mình (`canAccessStudent`).
   - Xử lý xung đột Global Unique Index `E11000` của Mongoose/MongoDB một cách có kiểm soát (HTTP 409).
   - Concurrency kiểm soát bằng Handshake Barrier hai luồng xác định: bảo đảm tính nguyên tử và chống duplicate hóa đơn đồng thời.

---

## 2. MA TRẬN ENTRY POINT, HELPER VÀ DỊCH VỤ ĐÃ CHUYỂN ĐỔI

| Tên Hàm / Route | Module / File | Vai trò & Loại thao tác | Context Enforcement | Transaction & Lock | Trạng thái Nghiệp vụ |
|---|---|---|---|---|---|
| `getFinanceClassrooms` | [`financeController.js`](file:///E:/school-management-api/backend/src/controllers/financeController.js) | Đọc danh sách lớp | `assertTenantContext(req)` + `buildTenantFilter` | Không | Chỉ lấy lớp thuộc trường |
| `getFeeSchedules` | [`financeController.js`](file:///E:/school-management-api/backend/src/controllers/financeController.js) | Đọc biểu phí theo kỳ | `assertTenantContext(req)` + `buildTenantFilter` | Không | Chỉ lấy biểu phí của trường |
| `saveFeeSchedule` | [`financeController.js`](file:///E:/school-management-api/backend/src/controllers/financeController.js) | Ghi/Cập nhật biểu phí | `assertTenantContext(req)` + `buildTenantFilter` | `runStudentTransaction` + `lockOpenPeriod` | Gán `tenantId`; Bắt E11000 trả 409 |
| `deleteFeeSchedule` | [`financeController.js`](file:///E:/school-management-api/backend/src/controllers/financeController.js) | Xóa biểu phí | `assertTenantContext(req)` + `buildTenantFilter` | `runStudentTransaction` + `lockOpenPeriod` | Không xóa chéo trường khác |
| `createTuitionFee` | [`financeController.js`](file:///E:/school-management-api/backend/src/controllers/financeController.js) | Tạo hóa đơn đơn lẻ | `assertTenantContext(req)` + `buildTenantFilter` | `runStudentTransaction` + `lockOpenPeriod` + Re-verify Actor & Check Trùng in-session | Gán `tenantId`; Chống tạo trùng 409 |
| `createBulkTuitionFees` | [`financeController.js`](file:///E:/school-management-api/backend/src/controllers/financeController.js) | Sinh hóa đơn hàng loạt | `assertTenantContext(req)` + `buildTenantFilter` | `runStudentTransaction` + `lockOpenPeriod` + Re-verify Actor | Chỉ áp dụng học sinh cùng trường |
| `previewBulkTuitionFees` | [`financeController.js`](file:///E:/school-management-api/backend/src/controllers/financeController.js) | Xem trước sinh hàng loạt | `assertTenantContext(req)` + `buildTenantFilter` | Không | Chỉ tính học sinh cùng trường |
| `getTuitionByStudent` | [`financeController.js`](file:///E:/school-management-api/backend/src/controllers/financeController.js) | Đọc hóa đơn theo học sinh | `assertTenantContext(req)` + `buildTenantFilter` + `canAccessStudent` | Không | 404 nếu học sinh khác trường; 403 nếu phụ huynh khác |
| `getTuitionByClass` | [`financeController.js`](file:///E:/school-management-api/backend/src/controllers/financeController.js) | Đọc hóa đơn theo lớp | `assertTenantContext(req)` + `buildTenantFilter` | Không | 404 nếu lớp học khác trường |
| `getInvoices` | [`financeController.js`](file:///E:/school-management-api/backend/src/controllers/financeController.js) | Đọc danh sách hóa đơn | `assertTenantContext(req)` + `buildTenantFilter` | Không | Lọc chính xác theo `tenantId` |
| `getDebtReport` | [`financeController.js`](file:///E:/school-management-api/backend/src/controllers/financeController.js) | Báo cáo công nợ | `assertTenantContext(req)` + `buildTenantFilter` | Không | Tính toán công nợ theo trường |
| `getPaymentsByInvoice` | [`financeController.js`](file:///E:/school-management-api/backend/src/controllers/financeController.js) | Đọc lịch sử thanh toán | `assertTenantContext(req)` + `invoiceScope` | Không | Bảo vệ truy cập chéo tenant và phụ huynh |
| `getReceipt` | [`financeController.js`](file:///E:/school-management-api/backend/src/controllers/financeController.js) | Đọc biên lai thu tiền | `assertTenantContext(req)` + `invoiceScope` | Không | Bảo vệ biên lai khỏi xem trái phép |
| `cancelTuitionFee` | [`financeController.js`](file:///E:/school-management-api/backend/src/controllers/financeController.js) | Hủy hóa đơn chưa thu | `assertTenantContext(req)` + `buildTenantFilter` + Role `admin` | `runStudentTransaction` + `lockOpenPeriod` | Từ chối nếu đã thu một phần/toàn bộ |
| `adjustTuitionFee` | [`financeController.js`](file:///E:/school-management-api/backend/src/controllers/financeController.js) | Điều chỉnh hóa đơn | `assertTenantContext(req)` + `buildTenantFilter` | `runStudentTransaction` + `lockOpenPeriod` | Gán `tenantId` trên `InvoiceAdjustment` |
| `addBulkInvoiceItem` | [`financeController.js`](file:///E:/school-management-api/backend/src/controllers/financeController.js) | Bổ sung khoản thu loạt | `assertTenantContext(req)` + `buildTenantFilter` | `runStudentTransaction` + `lockOpenPeriod` | Gán `tenantId` trên cả hóa đơn và adjustment |
| `getInvoiceAdjustments` | [`financeController.js`](file:///E:/school-management-api/backend/src/controllers/financeController.js) | Lịch sử điều chỉnh | `assertTenantContext(req)` + `invoiceScope` | Không | Chống rò rỉ dữ liệu điều chỉnh |
| `getFeeScheduleTemplate` | [`financeExcelController.js`](file:///E:/school-management-api/backend/src/controllers/financeExcelController.js) | Tải file mẫu biểu phí | `assertTenantContext(req)` + truyền `req` vào service | Không | Chỉ chứa danh mục lớp của tenant |
| `getInvoiceTemplate` | [`financeExcelController.js`](file:///E:/school-management-api/backend/src/controllers/financeExcelController.js) | Tải file mẫu hóa đơn | `assertTenantContext(req)` + truyền `req` vào service | Không | Chỉ chứa học sinh và lớp của tenant |
| `exportFeeSchedules` | [`financeExcelController.js`](file:///E:/school-management-api/backend/src/controllers/financeExcelController.js) | Xuất Excel biểu phí | `assertTenantContext(req)` + `buildTenantFilter` | Không | Chỉ xuất biểu phí của trường |
| `exportInvoices` | [`financeExcelController.js`](file:///E:/school-management-api/backend/src/controllers/financeExcelController.js) | Xuất Excel hóa đơn | `assertTenantContext(req)` + `buildTenantFilter` + Scoped Populate | Không | 404 nếu filter lớp trường khác; Scoped student populate |
| `exportDebts` | [`financeExcelController.js`](file:///E:/school-management-api/backend/src/controllers/financeExcelController.js) | Xuất Excel công nợ | `assertTenantContext(req)` + `buildTenantFilter` + Scoped Populate | Không | Chỉ xuất công nợ trường; Scoped student populate |
| `previewFeeScheduleImport` | [`financeExcelController.js`](file:///E:/school-management-api/backend/src/controllers/financeExcelController.js) | Xem trước import biểu phí | `assertTenantContext(req)` + `buildTenantFilter` | Không | PreviewToken gắn `tenantId` |
| `confirmFeeScheduleImport` | [`financeExcelController.js`](file:///E:/school-management-api/backend/src/controllers/financeExcelController.js) | Xác nhận import biểu phí | `assertTenantContext(req)` + `verifyPreviewToken` + Idempotency | `runStudentTransaction` + `lockOpenPeriod` + Re-verify Actor in session | Gán `tenantId` trên từng schedule; Ném 403 nếu actor bị khóa |
| `previewInvoiceImport` | [`financeExcelController.js`](file:///E:/school-management-api/backend/src/controllers/financeExcelController.js) | Xem trước import hóa đơn | `assertTenantContext(req)` + `buildTenantFilter` | Không | Từ chối học sinh ngoại lai |
| `confirmInvoiceImport` | [`financeExcelController.js`](file:///E:/school-management-api/backend/src/controllers/financeExcelController.js) | Xác nhận import hóa đơn | `assertTenantContext(req)` + `verifyPreviewToken` + Idempotency | `runStudentTransaction` + `lockOpenPeriod` + Re-verify Actor in session | Gán `tenantId` trên từng hóa đơn; Ném 403 nếu actor bị khóa |
| `createPreviewToken` / `verifyPreviewToken` | [`financeExcelImportService.js`](file:///E:/school-management-api/backend/src/services/financeExcelImportService.js) | Mã hóa / Xác thực token xem trước | Nhận và kiểm tra `tenantId` | Không | Chống dùng token chéo trường |

---

## 3. CHI TIẾT CÁC CƠ CHẾ CỐT LÕI

### 3.1. Ranh Giới Dữ Liệu & Fail-Closed Scoping
- **`assertTenantContext(req)`**: Được kích hoạt ở dòng đầu tiên của mọi controller action. Nếu request mang context không hợp lệ hoặc thiếu `tenantId` đối với người dùng SaaS, middleware lập tức ném HTTP 403 `INVALID_TENANT_CONTEXT`.
- **`invoiceScope(req, invoice)`**: Kiểm tra chặt chẽ quyền truy cập hóa đơn/biên lai/lịch sử điều chỉnh:
  - Nếu hóa đơn có `tenantId` không khớp với `req.tenantId` -> Từ chối (HTTP 403 hoặc 404 tùy endpoint).
  - Nếu người dùng có role `parent`, hàm tra cứu hồ sơ học sinh qua `Student.findOne({ _id: invoice.studentId, ...tenantFilter })` và gọi `canAccessStudent(req.user, student, req)` để đảm bảo phụ huynh chỉ xem được dữ liệu của con mình.
- **Xử lý Xung Đột Global Unique Index (E11000)**:
  - Do `FeeScheduleSchema` có index `{ period: 1, classroomId: 1 }` (chưa compound `tenantId`), khi Tenant A đã tạo biểu phí chung toàn trường (`classroomId: null`) cho kỳ `MM-YYYY`, việc Tenant B tạo biểu phí chung cho cùng kỳ sẽ phát sinh lỗi `11000`.
  - Handler `saveFeeSchedule` bắt lỗi này và trả về HTTP 409 có kiểm soát: `"Mức thu kỳ/lớp này đã được lưu, vui lòng tải lại."`, không làm crash tiến trình và không lộ raw MongoDB error.

### 3.2. Atomic Transaction, Lock Open Period & Actor Re-verify trong Session
- **Re-verify Actor**: Trong transaction của `createTuitionFee`, `saveFeeSchedule`, `createBulkTuitionFees`, `cancelTuitionFee`, `adjustTuitionFee`, `confirmFeeScheduleImport`, `confirmInvoiceImport`:
  - Luôn đọc lại actor từ DB bằng chính session của transaction:
    `const actor = await User.findOne({ _id: req.user._id, status: 'active', ...tenantFilter }).session(session);`
  - Nếu tài khoản đã bị khóa hoặc không đủ role -> Ném HTTP 403 và rollback toàn bộ transaction.
- **Lock Open Period**: Gọi `await lockOpenPeriod(fromPeriod(period), session, req);` để tăng `writeVersion` của kỳ kế toán tương ứng và đảm bảo kỳ kế toán đang mở (`status: 'open'`). Nếu kỳ đã đóng, ném HTTP 409. Nếu transaction xảy ra lỗi ghi sau `lockOpenPeriod`, toàn bộ hóa đơn và cập nhật kỳ kế toán đều được rollback nguyên tử.

### 3.3. Concurrency & Handshake Hai Luồng Xác Định (Barrier-based)
- Nhóm test E đã thiết lập cơ chế Handshake Barrier hai luồng cạnh tranh trên cùng một học sinh và kỳ kế toán:
  - Luồng 1 và Luồng 2 cùng gọi `createTuitionFee` đồng thời.
  - Luồng 1 dừng tại điểm `lockOpenPeriod` để chờ Luồng 2 vào lock.
  - Khi Luồng 1 tiếp tục và commit thành công, Luồng 2 (khi được unblock khỏi write lock của `AccountingPeriod`) kiểm tra `TuitionFee.findOne({ studentId, period, status: { $ne: 'cancelled' }, ...tenantFilter }).session(session)` ngay trong transaction session của mình, phát hiện hóa đơn đã được tạo và ném HTTP 409 `Học sinh đã có hóa đơn cho kỳ này`.
  - Kết quả: Đúng 1 request trả về HTTP 201, request còn lại trả về HTTP 409. Database cuối cùng chỉ chứa đúng 1 hóa đơn cho học sinh đó trong kỳ.

### 3.4. Excel Isolation, Template Scoping & Safe Populate
- **Cách ly File Mẫu (Templates)**:
  - `generateFeeScheduleTemplateWorkbook(context)` và `generateInvoiceTemplateWorkbook(context)` nhận context và áp dụng `buildTenantFilter(context, { throwOnInvalid: true })`.
  - Sheet chính, công thức xác thực dữ liệu (dataValidation formulae) và các sheet danh mục tra cứu phụ (Lớp học, Học sinh) chỉ hiển thị dữ liệu thuộc tenant hiện hành.
  - Với legacy context (`tenantId: null/missing`), hệ thống chỉ hiển thị các bản ghi legacy.
- **Bảo vệ Populate trong Export**:
  - `exportInvoices` và `exportDebts` áp dụng `.populate({ path: 'studentId', select: 'studentCode', match: tenantFilter })`.
  - Nếu hóa đơn trỏ nhầm sang `studentId` của tenant khác, trường populate sẽ trả về `null` và hàm xuất sẽ làm sạch `studentCode: ''` thay vì rò rỉ mã học sinh ngoại lai sang file Excel xuất ra.
- **PreviewToken & Idempotency-Key Scoping**:
  - Payload JWT của preview token chứa `tenantId`. Khi xác nhận import, token được giải mã và so khớp `token.tenantId === req.tenantId`. Nếu không khớp, từ chối ngay.
  - `ImportIdempotency` lưu `tenantId`. Nếu trường B gửi cùng một `idempotency-key` đã được trường A sử dụng, hệ thống lập tức từ chối với HTTP 403 `"Idempotency-Key này thuộc về đơn vị trường học khác."`.

---

## 4. KẾT QUẢ KIỂM THỬ THỰC TẾ

> [!IMPORTANT]
> Toàn bộ các test suite được thực thi **100% trên MongoMemoryReplSet (MongoDB 8.2.6)** cô lập thông qua `testDbBootstrap` với lớp bảo vệ `safeDbGuard`. Tuyệt đối không tác động lên cơ sở dữ liệu runtime thật.

### A. Kết quả Suite 1E.3 (`backend/tests/saas/phase1e3_tuition_fee.test.js`)
- **Lệnh thực thi**: `npm test --prefix backend -- phase1e3 --runInBand --forceExit`
- **Kết quả**: **1/1 suite PASS, 35/35 tests PASS 100%**
- **Thời gian chạy**: **15.43 s**
- **Mã thoát (Exit Code)**: **0**
- **Chi tiết 35 ca kiểm thử**:
  - *Nhóm A: Phân quyền và phạm vi đọc (Read Scoping)*: 7/7 tests PASS
    - A.1: Kế toán Tenant A gọi `getFeeSchedules` chỉ thấy biểu phí của Tenant A
    - A.2: Kế toán Tenant A gọi `getInvoices` và `getDebtReport` chỉ thấy hóa đơn của Tenant A
    - A.3: `getTuitionByStudent` với học sinh Tenant B từ Tenant A trả về 404
    - A.4: `getTuitionByClass` với lớp học Tenant B từ Tenant A trả về 404
    - A.5: Phụ huynh Tenant A chỉ được xem học phí của con mình (403 với học sinh khác)
    - A.6: `invoiceScope` bảo vệ chi tiết thanh toán/biên lai khỏi truy cập chéo tenant và phụ huynh trái phép
    - A.7: Chặn context không hợp lệ hoặc giả mạo (Fail-Closed HTTP 403)
  - *Nhóm B: Biểu phí (FeeSchedule) & Global Unique Index E11000*: 6/6 tests PASS
    - B.1: Tạo FeeSchedule theo lớp cụ thể thành công và lưu đúng `tenantId`
    - B.2: Tạo FeeSchedule toàn trường (`classroomId: null`) thành công cho Tenant A
    - B.3: Biểu phí toàn trường của Tenant A không bị tra cứu chéo sang Tenant B
    - B.4: Cố tình tạo FeeSchedule với `classroomId` thuộc Tenant B bị từ chối 404
    - B.5: Xử lý xung đột Global Unique Index E11000 cho biểu phí chung toàn trường (HTTP 409 có kiểm soát)
    - B.6: Xóa `deleteFeeSchedule` chỉ xóa được của tenant mình (404 với tenant khác)
  - *Nhóm C: Hóa đơn học phí (TuitionFee) Scoping & Nghiệp vụ*: 7/7 tests PASS
    - C.1: `createTuitionFee`: Tạo hóa đơn đơn lẻ đúng số tiền fixture và gán `tenantId`
    - C.2: `createTuitionFee`: Cố tạo hóa đơn cho học sinh Tenant B bị từ chối 404
    - C.3: Chống tạo trùng hóa đơn trong cùng tenant (HTTP 409)
    - C.4: `createBulkTuitionFees`: Sinh hàng loạt chỉ áp dụng cho học sinh thuộc tenant
    - C.5: `previewBulkTuitionFees`: Chỉ xem trước học sinh của tenant
    - C.6: `cancelTuitionFee`: Chỉ admin tenant được hủy hóa đơn chưa thu; từ chối hóa đơn ngoại lai hoặc đã thu tiền
    - C.7: `adjustTuitionFee`: Tạo `InvoiceAdjustment` và cập nhật hóa đơn có đúng `tenantId`
  - *Nhóm D: Transaction Rollback & Actor Re-verify & Lock Open Period*: 3/3 tests PASS
    - D.1: Re-verify actor trong session: Nếu tài khoản bị khóa trong transaction -> ném 403 và rollback
    - D.2: Transaction Rollback: Lỗi sau `lockOpenPeriod` -> rollback cả hóa đơn lẫn kỳ kế toán
    - D.3: Kỳ đóng của Tenant A chặn tạo hóa đơn Tenant A, nhưng không ảnh hưởng Tenant B
  - *Nhóm E: Concurrency & Handshake Hai Luồng Xác Định*: 1/1 test PASS
    - E.1: Handshake hai luồng cạnh tranh: hai request `createTuitionFee` đồng thời cạnh tranh trên cùng học sinh và kỳ kế toán -> 1 thành công (201), 1 xung đột (409); DB có đúng 1 hóa đơn.
  - *Nhóm F: Import / Export Excel Học Phí & Biểu Phí*: 10/10 tests PASS
    - F.1: `exportFeeSchedules`, `exportInvoices`, `exportDebts` chỉ xuất dữ liệu đúng tenant
    - F.2: `previewInvoiceImport` từ chối học sinh ngoại lai của Tenant B
    - F.3: Ngăn chặn dùng `previewToken` chéo tenant (HTTP 403)
    - F.4: Ngăn chặn dùng `Idempotency-Key` chéo tenant (HTTP 403)
    - F.5: `confirmInvoiceImport`: Nhập thành công và gán đúng `tenantId` trên các document
    - F.6: Tải template biểu phí (`getFeeScheduleTemplate`) chỉ chứa danh mục lớp của tenant (và hỗ trợ legacy context)
    - F.7: Tải template hóa đơn (`getInvoiceTemplate`) chỉ chứa học sinh và lớp của tenant (và hỗ trợ legacy context)
    - F.8: Xuất Excel hóa đơn / công nợ bảo vệ populate `studentId` khỏi rò rỉ dữ liệu chéo tenant
    - F.9: Xác nhận import biểu phí (`confirmFeeScheduleImport`) re-verify actor trong session và rollback nếu bị khóa
    - F.10: Xác nhận import hóa đơn (`confirmInvoiceImport`) re-verify actor trong session và rollback nếu bị khóa
  - *Nhóm G: SaaS Finance Routes Tiếp Tục Bị Chặn (HTTP 501)*: 1/1 test PASS
    - G.1: `createSaasApp` mode `phase1d` và `phase1e` chặn tất cả các route `/api/v1/finance/...` với HTTP 501

### B. Kết quả Kiểm thử Hồi quy Toàn diện
1. **Suite 1E.2 (`phase1e2_accounting_cash.test.js`)**:
   - Lệnh: `npm test --prefix backend -- phase1e2 --runInBand --forceExit`
   - Kết quả: **33/33 tests PASS (100%)** trong 12.812 s (Exit Code: 0).
2. **Suite 1E.1 (`phase1e1_data_boundary.test.js`)**:
   - Lệnh: `npm test --prefix backend -- phase1e1 --runInBand --forceExit`
   - Kết quả: **99/99 tests PASS (100%)** trong 25.581 s (Exit Code: 0).
3. **Suite 1D.5 (`phase1d5_integration.test.js`)**:
   - Lệnh: `npm test --prefix backend -- phase1d5 --runInBand --forceExit`
   - Kết quả: **48/48 tests PASS (100%)** trong 37.989 s (Exit Code: 0).
4. **Kiểm thử Toàn bộ Backend (Full Test Suite)**:
   - Lệnh: `npm test --prefix backend -- --runInBand --forceExit`
   - Kết quả: **29/29 suites PASS (100%), 897/897 tests PASS (100%)**
   - Thời gian chạy: **499.557 s**
   - Mã thoát (Exit Code): **0**
   - Ghi nhận cảnh báo từ Jest log:
     ```text
     Force exiting Jest: Have you considered using '--detectOpenHandles' to detect async operations that kept running after all tests finished?
     ```

---

## 5. GIỚI HẠN KỸ THUẬT & ĐIỂM DỪNG ĐỂ CODEX NGHIỆM THU

1. **Giới hạn kỹ thuật**:
   - Index declaration trong schema sản phẩm `TuitionFee.js` hiện chưa khai báo partial unique index `{ studentId: 1, period: 1 }` mà index này đang nằm trong script `createIndexes.js`. Trong kiểm thử tích hợp, test suite đã chủ động kích hoạt index này để phản ánh đúng môi trường sản xuất.
   - Các writer tài chính thanh toán (`Payment`), hoàn phí (`TuitionRefundRequest`), chi phí mua sắm (`PurchaseExpense`) và chi phí vận hành (`OperatingExpense`) vẫn thuộc phân vùng legacy và đang chờ chuyển đổi ở **Task 1E.4**.
   - Cổng router SaaS tài chính trên `createSaasApp.js` tiếp tục được khóa chặt với **HTTP 501 Not Implemented** cho đến khi hoàn tất tích hợp toàn bộ Zone 4 ở **Task 1E.5**.

2. **Điểm dừng bàn giao**:
   - Task 1E.3 đã hoàn tất 100% mục tiêu và các phát hiện nghiệm thu về cách ly biểu phí và hóa đơn học phí.
   - Antigravity dừng lại tại đây để bàn giao cho Codex nghiệm thu. Tuyệt đối **không tự ý bắt đầu Task 1E.4 hay 1E.5**.
