# BÁO CÁO NGHIỆM THU & BÀN GIAO TASK 1E.4 (CẬP NHẬT HOÀN THIỆN)
## CÁCH LY THANH TOÁN, HOÀN PHÍ VÀ CÁC KHOẢN CHI THEO TRƯỜNG (ZONE 4 FINANCE)

- **Dự án**: `E:\school-management-api`
- **Mốc thực hiện**: Giai đoạn 1E — Task 1E.4 (Cách ly thanh toán, hoàn phí và các khoản chi theo trường)
- **Trạng thái**: **HOÀN THÀNH — PASS 100% (48/48 tests Suite 1E.4; Hồi quy 1E.1, 1E.2, 1E.3, 1D.5 đạt 100%; Full Backend 30 suites 945/945 tests)**
- **Tác nhân triển khai**: Antigravity
- **Người điều phối & nghiệm thu**: Codex
- **Phiên bản MongoDB kiểm chứng**: **MongoDB 8.2.6** (trên `MongoMemoryReplSet` cô lập)

---

## 1. TỔNG QUAN PHẠM VI TASK 1E.4 VÀ BẢO TOÀN WORKSPACE / RUNTIME

Thực hiện nghiêm túc chỉ thị triển khai Task 1E.4 và các phát hiện nghiệm thu từ Codex, Antigravity đã hoàn thành cách ly toàn diện các nghiệp vụ thanh toán học phí, đề nghị và chi trả hoàn phí, chi vận hành và chi mua sắm thuộc Zone 4 Finance:

1. **Bảo toàn Workspace & Runtime**:
   - Bảo toàn 100% dirty/untracked worktree hiện có; không reset, stash, clean, commit, push hay merge.
   - Không sửa file `.env`, không in token, mật khẩu hay URI chứa thông tin xác thực.
   - Không chạy migration, seed, dropIndex, createIndexes trên database thật.
   - **Tuyệt đối không thay đổi index declaration trong product schema của các model tài chính.**
   - Không tác động lên các tiến trình runtime 5173, 5001 hay MongoDB 27018 rs0; không bật scheduler hay background worker.
   - Toàn bộ kiểm thử được chạy độc lập trên `MongoMemoryReplSet` cô lập thông qua `testDbBootstrap` với lớp bảo vệ `safeDbGuard`.
   - **Router SaaS tài chính (`createSaasApp.js`) tiếp tục giữ đóng HTTP 501 Fail-Closed** cho cả mode `phase1d` và `phase1e` đối với tất cả route `/api/v1/finance/...` và `/api/finance/...`.
   - **Tuyệt đối không bắt đầu Task 1E.5**; dừng lại ngay sau khi hoàn tất kiểm thử và tài liệu bàn giao để Codex nghiệm thu.

2. **Nội dung hoàn thiện theo các phát hiện nghiệm thu của Codex**:
   - **Khôi phục độ trung thực của index trong test**: Loại bỏ hoàn toàn lệnh `AccountingPeriod.collection.dropIndex('month_1')` trong suite kiểm thử chuẩn. Đọc lại metadata index để assert `month_1` vẫn unique. Phản ánh đúng giới hạn hiện hành (Tenant B ghi cùng tháng với Tenant A nhận HTTP 409 có kiểm soát do va chạm global unique), test riêng việc `assertOpen` của B không đọc kỳ đóng của A, kiểm chứng happy path của B trên kỳ độc lập và PoC compound index trên collection tạm riêng biệt (`temp_accountingperiods_poc`).
   - **Viết lại toàn diện Concurrency Nhóm H theo Handshake Barrier 2 luồng xác định**:
     - Loại bỏ việc spy trên các hàm bị destructure; quan sát chính xác tại Mongoose query/exec (`findOne`, `findOneAndUpdate`).
     - Handshake xác nhận 2 session khác biệt nhau (`session1.id !== session2.id`), cả 2 session đều đang trong transaction thật (`inTransaction()`).
     - Barrier có timeout bảo vệ (8000ms) sẽ tự động reject, không bao giờ tự resolve ngầm.
     - Bao phủ trọn vẹn cả 5 kịch bản tranh chấp:
       - H.1: Hai khoản thu cạnh tranh: không thu vượt số còn lại của hóa đơn.
       - H.2: Hai khoản chi mua sắm cạnh tranh: không chi vượt phần còn lại của đơn hàng.
       - H.3: Hai request chi cùng đề nghị vận hành: chỉ 1 khoản chi được chấp nhận, request sau bị từ chối 409.
       - H.4: Hai request chi cùng đề nghị hoàn phí: chỉ 1 adjustment được ghi nhận, `paidAmount` giảm đúng 1 lần.
       - H.5: Writer 1E.4 cạnh tranh với `closePeriod`: writer bị chặn 409, không commit ghi trái phép vào kỳ đã đóng.
   - **Rà soát Rollback & Audit Trail**:
     - Phân biệt rõ ràng giữa embedded `auditTrail` (trong `Payment`), business `history` (trong `AccountingPeriod`, `TuitionRefundRequest`) và `AuditLog` collection riêng biệt. Không assert `AuditLog` khi code nghiệp vụ không ghi vào collection này.
     - Kiểm chứng rollback nguyên tử cả 4 luồng nghiệp vụ ghi: thanh toán học phí, chi trả hoàn phí, chi mua sắm, chi vận hành; assert `writeVersion` của `AccountingPeriod` được rollback về trạng thái trước đó. Kèm happy path đối ứng lưu embedded `auditTrail`.
   - **Đính chính phân quyền xem đề nghị hoàn phí**:
     - Tuyến đường `GET /refund-requests` (hàm `tuitionRefundController.listRefundRequests`) được bảo vệ bởi middleware `roleCheck(['admin', 'principal', 'accountant'])`. Phụ huynh KHÔNG có quyền truy cập endpoint này (nhận HTTP 403 từ router). Phụ huynh chỉ tương tác qua cổng thông tin phụ huynh / xem hóa đơn, không qua router nội bộ tài chính.
   - **Rà soát Context Enforcement (`INVALID_TENANT_CONTEXT`)**:
     - Mọi entry point đều từ chối context giả mạo, untrusted context hoặc thiếu `tenantId` với HTTP 403 `INVALID_TENANT_CONTEXT` trước khi chạm vào bất kỳ câu lệnh truy vấn nào.

---

## 2. MA TRẬN ENTRY POINT, HELPER VÀ DỊCH VỤ ĐÃ CHUYỂN ĐỔI

| Tên Hàm / Route | Module / File | Vai trò & Nghiệp vụ | Context Enforcement | Transaction & Lock | Trạng thái Nghiệp vụ Multi-Tenant |
|---|---|---|---|---|---|
| `recordPayment` | [`paymentTransactionService.js`](file:///E:/school-management-api/backend/src/services/paymentTransactionService.js) | Dịch vụ thu tiền học phí | `resolveTenantContext` + `resolveUserAndTenantContext` | `runInTransaction` + Re-verify Actor + `lockOpenPeriod(..., effectiveContext)` | Gán `tenantId`; Bắt E11000 trả HTTP 409; Idempotency replay/conflict |
| `makePayment` | [`financeController.js`](file:///E:/school-management-api/backend/src/controllers/financeController.js) | Controller thu tiền học phí | `assertTenantContext(req)` + truyền `req` vào service | Gọi `recordPayment` | Thông báo thanh toán chỉ gửi cho phụ huynh và hiệu trưởng cùng trường |
| `getAccountingProcurementOverview` | [`financeController.js`](file:///E:/school-management-api/backend/src/controllers/financeController.js) | Tổng quan mua sắm kế toán | `assertTenantContext(req)` + `buildTenantFilter` | Không | Lọc chính xác `ProcurementRequest` và `PurchaseOrder` theo trường |
| `listRefundRequests` | [`tuitionRefundController.js`](file:///E:/school-management-api/backend/src/controllers/tuitionRefundController.js) | Danh sách đề nghị hoàn phí | `assertTenantContext(req)` + `buildTenantFilter` | Không | Role check `['admin', 'principal', 'accountant']`. Lọc chính xác theo trường |
| `createRefundRequest` | [`tuitionRefundController.js`](file:///E:/school-management-api/backend/src/controllers/tuitionRefundController.js) | Lập đề nghị hoàn học phí | `assertTenantContext(req)` + `buildTenantFilter` | `runStudentTransaction` + Re-verify Actor | Gán `tenantId`; Chống hoàn vượt quá số tiền đã thu của hóa đơn |
| `reviewRefundRequest` | [`tuitionRefundController.js`](file:///E:/school-management-api/backend/src/controllers/tuitionRefundController.js) | Duyệt/Từ chối đề nghị hoàn phí | `assertTenantContext(req)` + `buildTenantFilter` | `runStudentTransaction` + Re-verify Reviewer | Chặn người lập tự duyệt (403); Conditional update status `pending` |
| `payRefundRequest` | [`tuitionRefundController.js`](file:///E:/school-management-api/backend/src/controllers/tuitionRefundController.js) | Ghi nhận chi trả hoàn phí | `assertTenantContext(req)` + `buildTenantFilter` | `runStudentTransaction` + Re-verify Actor + `lockOpenPeriod` | Gán `tenantId` cho `InvoiceAdjustment`; Giảm `paidAmount` hóa đơn; Idempotency |
| `listOperatingExpenseRequests` | [`operatingExpenseController.js`](file:///E:/school-management-api/backend/src/controllers/operatingExpenseController.js) | Danh sách đề nghị chi vận hành | `assertTenantContext(req)` + `buildTenantFilter` | Không | Lọc chính xác theo trường; Tenant khác không thể thấy |
| `createOperatingExpenseRequest` | [`operatingExpenseController.js`](file:///E:/school-management-api/backend/src/controllers/operatingExpenseController.js) | Lập đề nghị chi vận hành | `assertTenantContext(req)` + `buildTenantFilter` | `User.findOne` actor check | Gán `tenantId`; Bắt E11000 trên `requestKey` trả HTTP 409 có kiểm soát |
| `reviewOperatingExpenseRequest` | [`operatingExpenseController.js`](file:///E:/school-management-api/backend/src/controllers/operatingExpenseController.js) | Duyệt/Từ chối đề nghị chi VH | `assertTenantContext(req)` + `buildTenantFilter` | `User.findOne` reviewer check | Chặn người lập tự duyệt (403); Conditional update status `pending` |
| `getOperatingExpenses` | [`operatingExpenseController.js`](file:///E:/school-management-api/backend/src/controllers/operatingExpenseController.js) | Sổ chi vận hành & Tổng hợp | `assertTenantContext(req)` + `buildTenantFilter` | Không | Find và aggregate group đều lọc scoped theo `...tenantFilter` |
| `recordOperatingExpense` | [`operatingExpenseController.js`](file:///E:/school-management-api/backend/src/controllers/operatingExpenseController.js) | Ghi nhận khoản chi vận hành | `assertTenantContext(req)` + `buildTenantFilter` | `runStudentTransaction` + Re-verify Actor + `lockOpenPeriod` | Gán `tenantId` cho `OperatingExpense`; Cập nhật request `status: 'paid'`; Idempotency |
| `getExpenseOrders` | [`purchaseExpenseController.js`](file:///E:/school-management-api/backend/src/controllers/purchaseExpenseController.js) | Đơn hàng đã giao chưa thanh toán | `assertTenantContext(req)` + `buildTenantFilter` | Không | Lọc `PurchaseOrder` delivered thuộc trường chưa thanh toán hết |
| `getPurchaseExpenses` | [`purchaseExpenseController.js`](file:///E:/school-management-api/backend/src/controllers/purchaseExpenseController.js) | Sổ chi mua sắm & Tổng hợp | `assertTenantContext(req)` + `buildTenantFilter` | Không | Find và aggregate group đều lọc scoped theo `...tenantFilter` |
| `recordPurchaseExpense` | [`purchaseExpenseController.js`](file:///E:/school-management-api/backend/src/controllers/purchaseExpenseController.js) | Ghi nhận chi mua sắm | `assertTenantContext(req)` + `buildTenantFilter` | `session.withTransaction` + Re-verify Actor + `lockOpenPeriod` | Gán `tenantId` cho `PurchaseExpense`; Chống chi vượt còn lại; Trả `replayed` |
| `exportPayments` | [`financeExcelController.js`](file:///E:/school-management-api/backend/src/controllers/financeExcelController.js) | Xuất Excel lịch sử thanh toán | `assertTenantContext(req)` + `buildTenantFilter` | Không | Kiểm tra `invoiceId` thuộc tenant; Chỉ xuất thanh toán của trường |
| `exportPurchaseExpenses` | [`financeExcelController.js`](file:///E:/school-management-api/backend/src/controllers/financeExcelController.js) | Xuất Excel sổ chi mua sắm | `assertTenantContext(req)` + `buildTenantFilter` | Không | Chỉ xuất các khoản chi mua sắm của trường |
| `exportOperatingExpenses` | [`financeExcelController.js`](file:///E:/school-management-api/backend/src/controllers/financeExcelController.js) | Xuất Excel sổ chi vận hành | `assertTenantContext(req)` + `buildTenantFilter` | Không | Scoped populate `approvalRequestId` với `match: tenantFilter` |

---

## 3. ĐÁNH GIÁ ĐIỀU KIỆN SẴN SÀNG CHO TASK 1E.5 (ROUTER CUTOVER)

Dưới đây là bảng phân loại các endpoint Zone 4 Finance về mức độ sẵn sàng khi mở cổng router SaaS trong Task 1E.5:

### 3.1. Nhóm ĐỦ ĐIỀU KIỆN (Ready for Cutover in 1E.5)
Các endpoint đã được bọc `assertTenantContext`, cô lập tenant, kiểm soát transaction và index va chạm:
1. **Thu học phí**:
   - `POST /finance/payments`: Thu tiền học phí, idempotency, re-verify actor, khóa kỳ kế toán, notification scoped.
   - `GET /finance/payments`: Danh sách thanh toán theo tenant.
   - `GET /finance/payments/invoice/:invoiceId`: Thanh toán theo hóa đơn, scoped tenant.
   - `GET /finance/receipts/:id`: Lấy biên lai, scoped tenant và phụ huynh.
2. **Hoàn học phí**:
   - `GET /refund-requests`: Danh sách đề nghị hoàn phí (`admin`, `principal`, `accountant`).
   - `POST /refund-requests`: Lập đề nghị hoàn phí, chống hoàn vượt số đã thu.
   - `PUT /refund-requests/:id/review`: Phê duyệt đề nghị hoàn phí, chặn self-review.
   - `POST /refund-requests/:id/pay`: Chi trả hoàn phí, ghi `InvoiceAdjustment`, conditional update.
3. **Chi vận hành**:
   - `GET /operating-expenses/requests`: Danh sách đề nghị chi vận hành.
   - `POST /operating-expenses/requests`: Lập đề nghị chi, xử lý va chạm `requestKey`.
   - `PUT /operating-expenses/requests/:id/review`: Phê duyệt đề nghị chi, chặn self-review.
   - `GET /operating-expenses`: Sổ chi vận hành & tổng hợp.
   - `POST /operating-expenses`: Ghi nhận chi vận hành, idempotency, khóa kỳ kế toán.
4. **Chi mua sắm**:
   - `GET /purchase-expenses/orders`: Đơn hàng đã giao cần thanh toán.
   - `GET /purchase-expenses`: Sổ chi mua sắm & tổng hợp.
   - `POST /purchase-expenses`: Ghi nhận chi mua sắm, chống chi vượt đơn hàng.
   - `GET /finance/procurement-overview`: Tổng quan mua sắm kế toán.
5. **Xuất Excel Sổ Chi & Biên Lai**:
   - `GET /finance/export/payments`: Xuất Excel thanh toán.
   - `GET /finance/export/purchase-expenses`: Xuất Excel chi mua sắm.
   - `GET /finance/export/operating-expenses`: Xuất Excel chi vận hành (scoped populate).

### 3.2. Nhóm CẦN LƯU Ý GIỚI HẠN / ĐIỀU KIỆN TIÊN QUYẾT TRƯỚC CUTOVER
- **Giới hạn Global Unique Index `month_1`**: Do schema sản phẩm hiện hành vẫn mang unique index toàn cục trên `AccountingPeriod.month`, các trường SaaS khác nhau ghi nhận thanh toán/chi phí trong cùng tháng vẫn va chạm mức database và nhận HTTP 409 có kiểm soát. Kế hoạch cutover router trong 1E.5 cần đi kèm hoặc lưu ý về migration index compound `{ tenantId: 1, month: 1 }` đã được lập trong `SAAS-PHASE-1E-INDEX-DECISIONS.md`.
- **Router SaaS (`createSaasApp.js`)**: Hiện tại cả mode `phase1d` và `phase1e` đều đang trả HTTP 501 Fail-Closed cho toàn bộ prefix `/finance`, `/refund-requests`, `/operating-expenses`, `/purchase-expenses`. Việc mở router sẽ được kích hoạt theo chỉ thị riêng của Codex trong Task 1E.5.

---

## 4. BẢNG CHI TIẾT 48 CA KIỂM THỬ SUITE 1E.4 (ĐẠT 100% PASS)

| Nhóm | Mã Test | Nội dung kiểm thử | Kết quả | Thời gian |
|---|---|---|---|---|
| **Nhóm A: Phân quyền & Tenant Boundary** | A.1 | Kế toán Tenant A xem danh sách thanh toán/chi phí chỉ thấy dữ liệu của Tenant A | **PASS** | 240 ms |
| | A.2 | Kế toán Tenant A gọi makePayment với invoiceId thuộc Tenant B bị từ chối 404 | **PASS** | 185 ms |
| | A.3 | Chặn context không hợp lệ hoặc giả mạo trước mọi query ghi/đọc (HTTP 403) | **PASS** | 315 ms |
| | A.4 | Phụ huynh chỉ được xem biên lai của con mình; xem của học sinh khác bị 403 | **PASS** | 216 ms |
| | A.5 | Kế toán Tenant A gọi getPaymentsByInvoice / getReceipt với dữ liệu của Tenant B nhận 404 | **PASS** | 182 ms |
| **Nhóm B: Thanh toán học phí & Idempotency** | B.1 | Happy path: Thu tiền thành công, gán tenantId, cập nhật TuitionFee chính xác | **PASS** | 240 ms |
| | B.2 | Idempotency replay: Gửi lại cùng key và payload -> replayed: true, không tạo doc mới | **PASS** | 498 ms |
| | B.3 | Idempotency conflict: Gửi lại cùng key nhưng khác payload -> trả về HTTP 409 | **PASS** | 524 ms |
| | B.4 | Chống thu tiền cho hóa đơn của Tenant B từ Tenant A -> HTTP 404 | **PASS** | 479 ms |
| | B.5 | Chống thu vượt số còn lại của hóa đơn -> HTTP 422 | **PASS** | 463 ms |
| | B.6 | Chống thu tiền cho hóa đơn đã bị hủy (status: cancelled) -> HTTP 400 | **PASS** | 467 ms |
| | B.7 | Xung đột Global Unique Index txnRef với tenant khác -> HTTP 409 có kiểm soát | **PASS** | 486 ms |
| | B.8 | Thông báo thanh toán chỉ gửi đến phụ huynh và hiệu trưởng của Tenant A | **PASS** | 488 ms |
| **Nhóm C: Đề nghị & Chi trả Hoàn phí** | C.1 | Happy path: Lập đề nghị hoàn tiền thành công và gán đúng tenantId | **PASS** | 527 ms |
| | C.2 | Duyệt đề nghị hoàn tiền: Hiệu trưởng duyệt thành công, người lập không được tự duyệt | **PASS** | 417 ms |
| | C.3 | Chi trả hoàn tiền: Tạo InvoiceAdjustment, giảm paidAmount hóa đơn, gán tenantId | **PASS** | 349 ms |
| | C.4 | Replay idempotency khi chi trả hoàn phí | **PASS** | 497 ms |
| | C.5 | Chống hoàn vượt quá số tiền đã thu của hóa đơn -> HTTP 422 | **PASS** | 475 ms |
| | C.6 | Tenant A không thể xem, duyệt hoặc chi trả đề nghị hoàn tiền của Tenant B (404) | **PASS** | 474 ms |
| **Nhóm D: Chi Vận Hành (Operating Expenses)** | D.1 | Happy path: Tạo đề nghị chi vận hành thành công và lưu đúng tenantId | **PASS** | 456 ms |
| | D.2 | Duyệt đề nghị chi: Hiệu trưởng duyệt thành công, người lập không được tự duyệt | **PASS** | 462 ms |
| | D.3 | Ghi nhận chi vận hành: Tạo OperatingExpense có tenantId, cập nhật request thành paid | **PASS** | 470 ms |
| | D.4 | Tenant A không xem, không duyệt và không ghi chi cho đề nghị của Tenant B (404) | **PASS** | 592 ms |
| | D.5 | Sổ chi vận hành getOperatingExpenses chỉ hiển thị chi phí của đúng tenant | **PASS** | 477 ms |
| | D.6 | Xung đột Global Unique Index trên requestKey giữa hai tenant -> HTTP 409 có kiểm soát | **PASS** | 453 ms |
| **Nhóm E: Chi Mua Sắm (Purchase Expenses)** | E.1 | Happy path: Ghi nhận chi mua sắm, lưu đúng tenantId và cập nhật PurchaseOrder.paidAmount | **PASS** | 517 ms |
| | E.2 | Idempotency replay khi chi mua sắm | **PASS** | 506 ms |
| | E.3 | Chống chi vượt giá trị đơn hàng còn lại -> HTTP 422 | **PASS** | 462 ms |
| | E.4 | Cách ly tenant: Đơn hàng của Tenant B bị từ chối 404 khi Tenant A ghi chi | **PASS** | 438 ms |
| | E.5 | Tổng quan mua sắm getAccountingProcurementOverview chỉ tính toán dữ liệu của tenant mình | **PASS** | 442 ms |
| **Nhóm F: Xuất Excel Sổ Chi & Biên Lai** | F.1 | exportPayments: Chỉ xuất các khoản thanh toán của đúng tenant | **PASS** | 501 ms |
| | F.2 | exportPurchaseExpenses: Chỉ xuất sổ chi mua sắm của tenant mình | **PASS** | 399 ms |
| | F.3 | exportOperatingExpenses: Chỉ xuất chi vận hành của tenant mình; populate approvalRequestId an toàn | **PASS** | 434 ms |
| **Nhóm G: Transaction Rollback & Actor Re-verify** | G.1 | Re-verify actor trong session: Tài khoản bị khóa -> rollback hoàn toàn; Happy path lưu embedded auditTrail | **PASS** | 519 ms |
| | G.2 | Rollback thanh toán học phí: Lỗi ghi sau Payment.create -> rollback cả Payment lẫn writeVersion kỳ | **PASS** | 504 ms |
| | G.3 | Rollback chi trả hoàn phí: Lỗi ghi sau InvoiceAdjustment.create -> rollback cả adjustment, request và kỳ | **PASS** | 498 ms |
| | G.4 | Rollback chi mua sắm: Lỗi sau PurchaseExpense.create -> rollback cả expense, order và kỳ | **PASS** | 440 ms |
| | G.5 | Rollback chi vận hành: Lỗi sau OperatingExpense.create -> rollback cả expense, request và kỳ | **PASS** | 451 ms |
| **Nhóm H: Concurrency & Handshake Hai Luồng** | H.1 | Hai khoản thu cạnh tranh: không thu vượt hóa đơn (Handshake barrier hai luồng xác định) | **PASS** | 513 ms |
| | H.2 | Hai khoản chi mua sắm cạnh tranh: không chi vượt đơn hàng (Handshake barrier hai luồng xác định) | **PASS** | 522 ms |
| | H.3 | Hai request chi cùng đề nghị vận hành: chỉ một khoản chi (Handshake barrier hai luồng xác định) | **PASS** | 570 ms |
| | H.4 | Hai request chi cùng đề nghị hoàn phí: chỉ một adjustment, paidAmount giảm đúng một lần (Handshake barrier) | **PASS** | 561 ms |
| | H.5 | Writer 1E.4 cạnh tranh closePeriod: không commit ghi trái phép vào kỳ đã đóng (Handshake barrier) | **PASS** | 576 ms |
| **Nhóm I: Kỳ Kế Toán Cách Ly & Cổng SaaS 501** | I.1a | Đọc phạm vi kỳ kế toán: assertOpen của Tenant B không bị ảnh hưởng bởi kỳ đóng của Tenant A | **PASS** | 462 ms |
| | I.1b | Giới hạn index hiện hành: Đường ghi của Tenant B cùng tháng nhận HTTP 409 có kiểm soát do va chạm month_1 | **PASS** | 521 ms |
| | I.1c | Happy path độc lập: Tenant B ghi nhận thanh toán thành công trong kỳ không bị tranh chấp | **PASS** | 449 ms |
| | I.1d | PoC kiểm chứng thiết kế index tương lai { tenantId: 1, month: 1 } trên collection tạm riêng biệt | **PASS** | 508 ms |
| | I.2 | createSaasApp tiếp tục chặn tất cả các route /api/v1/finance/... với HTTP 501 | **PASS** | 602 ms |

---

## 5. TỔNG HỢP KẾT QUẢ KIỂM THỬ THỰC TẾ

```text
========================================================================================
A. KIỂM THỬ ĐỘC LẬP TỪNG SUITE LIÊN QUAN:
----------------------------------------------------------------------------------------
1. Suite 1E.4 (phase1e4_payments_expenses.test.js) [Bản mới - Khôi phục index sản phẩm nguyên bản]:
   - Command:   npm test --prefix backend -- phase1e4 --runInBand --forceExit
   - Kết quả:   Test Suites: 1 passed, 1 total
   - Số test:   48 passed, 48 total (100%)
   - Thời gian: 26.54 s
   - Exit Code: 0
   - Cảnh báo:  Force exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?

2. Suite 1E.3 (phase1e3_tuition_fee.test.js):
   - Command:   npm test --prefix backend -- phase1e3 --runInBand --forceExit
   - Kết quả:   Test Suites: 1 passed, 1 total
   - Số test:   35 passed, 35 total (100%)
   - Thời gian: 16.837 s
   - Exit Code: 0
   - Cảnh báo:  Force exiting Jest (như trên)

3. Suite 1E.2 (phase1e2_accounting_cash.test.js):
   - Command:   npm test --prefix backend -- phase1e2 --runInBand --forceExit
   - Kết quả:   Test Suites: 1 passed, 1 total
   - Số test:   33 passed, 33 total (100%)
   - Thời gian: 10.709 s
   - Exit Code: 0
   - Cảnh báo:  Force exiting Jest (như trên)

4. Suite 1E.1 (phase1e1_data_boundary.test.js):
   - Command:   npm test --prefix backend -- phase1e1 --runInBand --forceExit
   - Kết quả:   Test Suites: 1 passed, 1 total
   - Số test:   99 passed, 99 total (100%)
   - Thời gian: 25.892 s
   - Exit Code: 0
   - Cảnh báo:  Force exiting Jest (như trên)

5. Suite 1D.5 (phase1d5_integration.test.js):
   - Command:   npm test --prefix backend -- phase1d5 --runInBand --forceExit
   - Kết quả:   Test Suites: 1 passed, 1 total
   - Số test:   48 passed, 48 total (100%)
   - Thời gian: 31.471 s
   - Exit Code: 0
   - Cảnh báo:  Force exiting Jest (như trên)

----------------------------------------------------------------------------------------
B. TOÀN BỘ BACKEND SUITE (FULL REGRESSION):
----------------------------------------------------------------------------------------
1. Mốc mới thực thi thực tế (Sau khi khôi phục index sản phẩm & hoàn thiện 48 tests 1E.4):
   - Command:     npm test --prefix backend -- --runInBand --forceExit
   - Test Suites: 30 passed, 30 total (100%)
   - Tests:       945 passed, 945 total (100%)
   - Snapshots:   0 total
   - Thời gian:   374.947 s (ước lượng 593 s)
   - Exit Code:   0
   - Log File:    file:///C:/Users/PhamDinhDong/.gemini/antigravity/brain/c0cd55dd-ceda-41d7-8f80-f3254ca5f175/.system_generated/tasks/task-16174.log
   - Cảnh báo ghi nhận từ Jest / Mongoose:
     * "Force exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?"
     * "(node:32824) [MONGOOSE] Warning: mongoose: the `new` option for `findOneAndUpdate()` and `findOneAndReplace()` is deprecated. Use `returnDocument: 'after'` instead."
   - Ghi chú:     Không suy đoán nguyên nhân open handle; cờ --forceExit được duy trì theo đúng cấu hình harness của dự án.

2. Mốc cũ lịch sử (Ghi nhận để đối chiếu, lượt chạy trước khi hoàn thiện phát hiện nghiệm thu):
   - Suite 1E.4 cũ khi còn tạm drop month_1: 40 tests (tổng full backend lúc đó: 30 suites, 937/937 tests, thời gian: 596.36 s).
   - Mốc mới 945 tests phản ánh đầy đủ: 8 ca kiểm thử bổ sung của Suite 1E.4 (khôi phục index sản phẩm nguyên bản, mở rộng Concurrency Nhóm H lên 5 kịch bản và Nhóm I PoC compound index trên collection riêng).

----------------------------------------------------------------------------------------
C. KIỂM TRA ĐỊNH DẠNG & KHOẢNG TRẮNG:
----------------------------------------------------------------------------------------
- Command:   git diff --check
- Exit Code: 0 (Không phát hiện lỗi khoảng trắng hay syntax marker)
========================================================================================
```

---

## 6. KẾT LUẬN & ĐIỂM DỪNG BÀN GIAO CHO CODEX

1. **Kết quả đạt được**:
   - Toàn bộ 48 ca kiểm thử của Task 1E.4 đạt **100% PASS** trên cơ sở dữ liệu cô lập MongoDB 8.2.6.
   - Hồi quy toàn diện các suite liên quan (1E.3, 1E.2, 1E.1, 1D.5) đều đạt **100% PASS**.
   - Kiểm tra khoảng trắng `git diff --check` đạt exit code 0, không có lỗi định dạng hay trailing whitespace.
   - Toàn bộ worktree được bảo toàn; không commit, push, stash hay merge.

2. **Điểm dừng bàn giao**:
   - Antigravity dừng lại tại đây và bàn giao toàn bộ báo cáo cùng mã nguồn cho Codex tiến hành nghiệm thu độc lập.
   - Tuyệt đối không tự ý bắt đầu Task 1E.5 hoặc mở bất kỳ route tài chính nào trên SaaS app khi chưa có chỉ thị rõ ràng từ Codex.
