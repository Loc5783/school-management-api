# BÁO CÁO NGHIỆM THU & BÀN GIAO TASK 1E.1 (NỀN DỮ LIỆU TÀI CHÍNH MULTI-TENANT)
## NỀN DỮ LIỆU VÀ THIẾT KẾ INDEX TÀI CHÍNH ĐA TRƯỜNG

- **Dự án**: `E:\school-management-api`
- **Mốc thực hiện**: Giai đoạn 1E — Task 1E.1 (Nền dữ liệu và thiết kế index tài chính đa trường)
- **Trạng thái**: **HOÀN THÀNH TOÀN DIỆN — PASS 100% SUITES & TESTS (99/99 TASK 1E.1, 261/261 PHASE 1D, 816/816 FULL BACKEND MỐC TRƯỚC)**
- **Tác nhân triển khai**: Antigravity
- **Người điều phối & nghiệm thu**: Codex
- **Phiên bản MongoDB kiểm chứng**: **MongoDB 8.2.6** (trên `MongoMemoryReplSet` cô lập)

---

## 1. TỔNG QUAN KẾT QUẢ TRIỂN KHAI VÀ NGHIỆM THU

### Mục tiêu đạt được:
1. **Bổ sung trường `tenantId` cho đúng 10 model Zone 4 Finance**:
   - `AccountingPeriod.js`, `DailyCashReconciliation.js`, `FeeSchedule.js`, `InvoiceAdjustment.js`, `OperatingExpense.js`, `OperatingExpenseRequest.js`, `Payment.js`, `PurchaseExpense.js`, `TuitionFee.js`, `TuitionRefundRequest.js`.
   - **Hợp đồng chuẩn**: `type: mongoose.Schema.Types.ObjectId`, `ref: 'Tenant'`, top-level field, optional, không default, không required, không tự thêm single index.
   - **Bảo toàn 100%**: Giữ nguyên toàn bộ options, timestamps, collection name, enum, custom validation, defaults, unique/sparse/partial index hiện hữu và pre/post hook của các model.
2. **Khảo sát toàn diện hệ thống Index và soạn thảo tài liệu quyết định**:
   - Soạn thảo tài liệu chuẩn mực [`docs/SAAS-PHASE-1E-INDEX-DECISIONS.md`](file:///E:/school-management-api/docs/SAAS-PHASE-1E-INDEX-DECISIONS.md) bao quát chi tiết 10 model: tên collection, index keys & options, business keys, phân loại (Natural Key vs Hybrid ObjectId), rủi ro va chạm đa trường E11000, trường tham chiếu thực tế, thiết kế compound partial index tương thích multi-tenant, kế hoạch migration index đề xuất và điều kiện rollback.
   - **Phân loại rõ ràng**: 7 model có ràng buộc Global Unique (`AccountingPeriod`, `DailyCashReconciliation`, `FeeSchedule`, `OperatingExpense`, `OperatingExpenseRequest`, `Payment`, `PurchaseExpense`) và 3 model KHÔNG có Global Unique (`InvoiceAdjustment`, `TuitionRefundRequest`, `TuitionFee` — chỉ có index scoped theo ID cha hoặc học sinh).
   - Ghi nhận rõ ràng: Giới hạn global unique code/mã chứng từ phụ thuộc vào migration dữ liệu còn lại; không khuyến nghị tiền tố mã trường như giải pháp chính thức đã nghiệm thu.
3. **Thiết kế Index Compound Partial chuẩn xác cho các trường mã tùy chọn**:
   - **Loại bỏ hoàn toàn cấu hình kết hợp `sparse: true` và `partialFilterExpression`** (MongoDB từ chối tạo index).
   - Rà soát các trường mã tùy chọn: `Payment.receiptNumber`, `Payment.txnRef`, `PurchaseExpense.transactionRef`, `OperatingExpense.transactionRef`.
   - **Phân biệt hành vi**: `sparse: true` nguyên bản chỉ loại trừ missing field, không loại trừ `null` và chuỗi rỗng `""`. Chỉ dùng `{ $type: 'string' }` sẽ gây lỗi E11000 khi có từ 2 bản ghi mang chuỗi rỗng `""` trong cùng tenant.
   - **Chính sách loại trừ nâng cao**: Sử dụng `{ field: { $gt: '' } }` để loại trừ đồng thời missing, `null` và chuỗi rỗng `""`. Cho phép mỗi tenant tạo không giới hạn bản ghi thiếu mã, nhưng bắt buộc duy nhất mã hợp lệ.
4. **Thử nghiệm PoC trên collection tạm (MongoDB 8.2.6)**:
   - Thử nghiệm trên các collection tạm cô lập (`temp_saas_index_verification`, `temp_saas_receipt_verification`, `temp_saas_receipt_legacy_verification`, `temp_flawed_index_demo`):
     - Hai trường A và B dùng chung mã bắt buộc `PC-001` và mã tùy chọn `REC-2026-001` thành công 100%.
     - Trùng mã trong cùng Tenant A bị chặn bởi đúng tên index `tenantId_1_docCode_1_saas_unique` và `tenantId_1_receiptNumber_1_saas_unique` (E11000).
     - Dữ liệu Legacy được bảo vệ độc lập bởi `docCode_1_legacy_unique` và `receiptNumber_1_legacy_unique`.
     - Chứng minh rủi ro cấu hình sai: MongoDB từ chối kết hợp `sparse: true` và `partialFilterExpression`, và cấu hình thiếu `$gt: ''` gây lỗi duplicate key khi có 2 chuỗi rỗng.
   - **Ranh giới PoC**: Kiểm chứng trực tiếp với trường `receiptNumber` đại diện; các trường khác là thiết kế áp dụng tương tự. Kết quả PoC trong môi trường test cô lập không nâng thành bằng chứng migration production.
5. **Ranh giới dữ liệu và Giới hạn của Sentinel Filter**:
   - Kiểm chứng `buildTenantFilter`: Trusted context A chỉ khớp A, B chỉ khớp B, Legacy chỉ khớp null/missing.
   - Ghi nhận chính xác `FAIL_CLOSED_FILTER` từ implementation thực tế (`tenantFilterService.js`):
     `{ _id: new mongoose.Types.ObjectId('000000000000000000000000'), tenantId: new mongoose.Types.ObjectId('000000000000000000000000') }`.
   - **Bản chất kỹ thuật**: Đây là sentinel filter của implementation hiện tại; tính fail-closed phụ thuộc dữ liệu không chứa cặp giá trị đó, không phải điều kiện bất khả khớp ở cú pháp engine. Test suite kiểm tra trên fixture của test, không tuyên bố chứng minh an toàn cho mọi dữ liệu có thể tồn tại.
   - Kiểm chứng cổng SaaS Mode: Cả `phase1d` và `phase1e` đều chặn **HTTP 501** cho toàn bộ route tài chính ở cả hai tiền tố `/api/v1` và `/api`.

---

## 2. BẢNG 10 MODEL TÀI CHÍNH THEO SCHEMA VÀ INDEX THỰC TẾ

| STT | Model | Collection | Index trong Schema & createIndexes.js | Tham chiếu thực tế (References) | Global Unique? |
|---|---|---|---|---|---|
| 1 | `AccountingPeriod` | `accountingperiods` | - `month_1` (`unique: true`) | `tenantId` -> `Tenant`<br>`history.actorId` -> `User` | **CÓ** (`month`) |
| 2 | `DailyCashReconciliation` | `dailycashreconciliations` | - `workDate_1` (`unique: true`) | `tenantId` -> `Tenant`<br>`recordedBy` -> `User`<br>`history.changedBy` -> `User` | **CÓ** (`workDate`) |
| 3 | `FeeSchedule` | `feeschedules` | - `period_1_classroomId_1` (`unique: true`) | `tenantId` -> `Tenant`<br>`classroomId` -> `Classroom`<br>`updatedBy` -> `User` | **CÓ** (khi `classroomId: null`) |
| 4 | `InvoiceAdjustment` | `invoiceadjustments` | - `invoiceId_1`<br>- `invoiceId_1_createdAt_-1`<br>- `invoiceId_1_idempotencyKey_1` (`unique: true`, partial string)<br>- `paidAt_-1` | `tenantId` -> `Tenant`<br>`invoiceId` -> `TuitionFee`<br>`recordedBy` -> `User` | **KHÔNG** (chỉ unique theo invoiceId) |
| 5 | `OperatingExpense` | `operatingexpenses` | - `documentNumber_1` (`unique: true`)<br>- `idempotencyKey_1` (`unique: true`)<br>- `transactionRef_1` (`unique: true`, partial string)<br>- `approvalRequestId_1` (`unique: true`, partial objectId)<br>- `paidAt_-1` | `tenantId` -> `Tenant`<br>`approvalRequestId` -> `OperatingExpenseRequest`<br>`recordedBy` -> `User` | **CÓ** (`documentNumber`, `idempotencyKey`, `transactionRef`, `approvalRequestId`) |
| 6 | `OperatingExpenseRequest` | `operatingexpenserequests` | - `requestKey_1` (`unique: true`)<br>- `status_1_createdAt_-1` | `tenantId` -> `Tenant`<br>`requestedBy` -> `User`<br>`reviewedBy` -> `User`<br>`expenseId` -> `OperatingExpense`<br>`paidBy` -> `User` | **CÓ** (`requestKey`) |
| 7 | `Payment` | `payments` | - `receiptNumber_1` (`unique: true`, `sparse: true`)<br>- `txnRef_1` (`unique: true`, `sparse: true`)<br>- `invoiceId_1_idempotencyKey_1` (`unique: true`)<br>- `invoiceId_1`, `recordedBy_1`, `paidAt_1` | `tenantId` -> `Tenant`<br>`invoiceId` -> `TuitionFee`<br>`recordedBy` -> `User`<br>`auditTrail.actorId` -> `User` | **CÓ** (`receiptNumber`, `txnRef`) |
| 8 | `PurchaseExpense` | `purchaseexpenses` | - `orderId_1`<br>- `orderId_1_idempotencyKey_1` (`unique: true`)<br>- `transactionRef_1` (`unique: true`, `sparse: true`)<br>- `paidAt_-1` | `tenantId` -> `Tenant`<br>`orderId` -> `PurchaseOrder`<br>`recordedBy` -> `User` | **CÓ** (`transactionRef`) |
| 9 | `TuitionFee` | `tuitionfees` | - `period_1`, `classroomId_1`, `status_1`, `dueDate_1`<br>- createIndexes: `studentId_1_period_1` (unique partial status) | `tenantId` -> `Tenant`<br>`studentId` -> `Student`<br>`classroomId` -> `Classroom`<br>`cancelledBy` -> `User` | **KHÔNG** (chỉ unique theo studentId+period) |
| 10 | `TuitionRefundRequest` | `tuitionrefundrequests` | - `invoiceId_1_createdAt_-1`<br>- `invoiceId_1` (`unique: true`, partial status in ['pending', 'approved']) | `tenantId` -> `Tenant`<br>`invoiceId` -> `TuitionFee`<br>`requestedBy` -> `User`<br>`reviewedBy` -> `User`<br>`adjustmentId` -> `InvoiceAdjustment`<br>`paidBy` -> `User` | **KHÔNG** (chỉ unique theo invoiceId) |

---

## 3. THIẾT KẾ INDEX ĐỀ XUẤT CHO CÁC TRƯỜNG MÃ TÙY CHỌN (LOẠI BỎ SPARSE, DÙNG `$gt: ''`)

| Trường | Model | SaaS Index Keys | SaaS partialFilterExpression | Legacy Index Keys | Legacy partialFilterExpression |
|---|---|---|---|---|---|
| `receiptNumber` | `Payment` | `{ tenantId: 1, receiptNumber: 1 }` | `{ tenantId: { $type: 'objectId' }, receiptNumber: { $gt: '' } }` | `{ receiptNumber: 1 }` | `{ tenantId: null, receiptNumber: { $gt: '' } }` |
| `txnRef` | `Payment` | `{ tenantId: 1, txnRef: 1 }` | `{ tenantId: { $type: 'objectId' }, txnRef: { $gt: '' } }` | `{ txnRef: 1 }` | `{ tenantId: null, txnRef: { $gt: '' } }` |
| `transactionRef` | `PurchaseExpense` | `{ tenantId: 1, transactionRef: 1 }` | `{ tenantId: { $type: 'objectId' }, transactionRef: { $gt: '' } }` | `{ transactionRef: 1 }` | `{ tenantId: null, transactionRef: { $gt: '' } }` |
| `transactionRef` | `OperatingExpense` | `{ tenantId: 1, transactionRef: 1 }` | `{ tenantId: { $type: 'objectId' }, transactionRef: { $gt: '' } }` | `{ transactionRef: 1 }` | `{ tenantId: null, transactionRef: { $gt: '' } }` |

---

## 4. KẾT QUẢ KIỂM THỬ RUNTIME THỰC TẾ

> [!IMPORTANT]
> Toàn bộ các test suite được thực thi **100% trên MongoMemoryReplSet (MongoDB 8.2.6)** cô lập thông qua `testDbBootstrap` với lớp bảo vệ `safeDbGuard`. Tuyệt đối không tác động lên cơ sở dữ liệu runtime thật.

### A. Kết quả Suite mới Task 1E.1 (`backend/tests/saas/phase1e1_data_boundary.test.js`):
- **Trạng thái**: **PASS 100%**
- **Số lượng test cases**: **99 / 99 tests**
- **Thời gian chạy**: ~32.73 s
- **Mã thoát (Exit Code)**: 0
- **Phân bổ chi tiết số test runtime từng nhóm (khớp 100% Jest output)**:
  1. *Nhóm A: Khảo sát Schema 10 model* (**60 tests**):
     - A.1: 10 tests (test.each × 10 model) — `tenantId` là `ObjectId`, ref `'Tenant'`.
     - A.2: 10 tests (test.each × 10 model) — `tenantId` optional, không default, không required.
     - A.3: 10 tests (test.each × 10 model) — Schema không tự thêm single index trên `tenantId`.
     - A.4: 10 tests (test.each × 10 model) — CastError/ValidationError khi `tenantId` sai kiểu.
     - A.5: 10 tests (test.each × 10 model) — Missing hoặc null `tenantId` hợp lệ (Legacy compatibility).
     - A.6: 10 tests (test.each × 10 model) — Xác minh metadata index thật trên schema và collection (đối chiếu unique/sparse/partial).
  2. *Nhóm B: Fixture thực tế và phân biệt BSON raw* (**10 tests**):
     - B.1: 10 tests (test.each × 10 model) — Missing, null, Tenant A, Tenant B phân biệt rõ ở tầng BSON raw document.
  3. *Nhóm C: Ranh giới lọc dữ liệu với `buildTenantFilter`* (**12 tests**):
     - C.1: 10 tests (test.each × 10 model) — Context Tenant A chỉ tìm thấy bản ghi Tenant A.
     - C.2: 1 test — Context không hợp lệ / untrusted fail-closed khi throwOnInvalid=true.
     - C.3: 1 test — Legacy query với filter `{ $or: [{ tenantId: null }, { tenantId: { $exists: false } }] }` chỉ lấy đúng legacy documents.
  4. *Nhóm D: Bảo toàn nghiệp vụ và các index hiện hữu* (**6 tests**):
     - D.1: 1 test — AccountingPeriod trùng month bị chặn E11000.
     - D.2: 1 test — DailyCashReconciliation trùng workDate bị chặn E11000.
     - D.3: 1 test — OperatingExpense trùng documentNumber hoặc idempotencyKey bị chặn E11000.
     - D.4: 1 test — FeeSchedule trùng period và classroomId bị chặn E11000.
     - D.5: 1 test — Payment trùng receiptNumber hoặc trùng invoiceId+idempotencyKey bị chặn E11000.
     - D.6: 1 test — Validation số tiền âm và các quy tắc schema cốt lõi được bảo toàn.
  5. *Nhóm E: Tái hiện giới hạn va chạm mã/kỳ toàn cục giữa Trường A và B* (**4 tests**):
     - E.1: 1 test — A và B cùng mở kỳ kế toán tháng "2026-11" -> B bị chặn bởi index `month_1`.
     - E.2: 1 test — A và B cùng chốt đối soát sổ quỹ "2026-11-06" -> B bị chặn bởi index `workDate_1`.
     - E.3: 1 test — A và B cùng tạo số chứng từ chi "PC-2026-001" -> B bị chặn bởi index `documentNumber_1`.
     - E.4: 1 test — A và B cùng tạo mức thu chung toàn trường (`classroomId: null`) -> B bị chặn bởi index `period_1_classroomId_1`.
  6. *Nhóm F: Thử nghiệm và kiểm chứng cú pháp MongoDB của Index đề xuất* (**5 tests**):
     - F.1: 1 test — Thiết kế mới cho mã bắt buộc (`docCode`): A và B dùng chung mã thành công, trùng trong A bị chặn bởi `tenantId_1_docCode_1_saas_unique`.
     - F.2: 1 test — Dữ liệu Legacy được bảo vệ độc lập bởi `docCode_1_legacy_unique`, không chặn SaaS.
     - F.3: 1 test — Thiết kế mới cho mã tùy chọn (`receiptNumber`): loại bỏ sparse, dùng `$gt: ''`, nhiều missing/null/empty trong A & B thành công, trùng mã trong A bị chặn bởi `tenantId_1_receiptNumber_1_saas_unique`.
     - F.4: 1 test — Thiết kế mới cho mã tùy chọn Legacy: bảo vệ duy nhất mã hợp lệ bởi `receiptNumber_1_legacy_unique`, cho phép nhiều missing/null/empty.
     - F.5: 1 test — Kiểm chứng rủi ro cấu hình sai: cấm sparse+partial và rủi ro nếu thiếu `$gt: ''` gây lỗi E11000 khi có 2 chuỗi rỗng.
  7. *Nhóm G: SaaS Router & Mode Gating fail-closed* (**2 tests**):
     - G.1: 1 test — createSaasApp ở `phase1d` khóa chặt tài chính (HTTP 501) cho cả `/api/v1` và `/api`.
     - G.2: 1 test — Khởi tạo app với future mode `phase1e` vẫn fail-closed HTTP 501.

**Tổng cộng suite 1E.1**: 60 + 10 + 12 + 6 + 4 + 5 + 2 = **99 tests PASS 100%**.

### B. Mốc kiểm tra hồi quy Phase 1D (lượt chạy đã xác nhận):
- Lệnh: `npm test --prefix backend -- phase1d --runInBand --forceExit`
- Kết quả: **9/9 suites PASS, 261/261 tests PASS 100%** (167.15 s, exit code 0).

### C. Mốc kiểm tra toàn bộ Backend (lượt chạy đã xác nhận trước khi sửa test/tài liệu):
- Lệnh: `npm test --prefix backend -- --runInBand --forceExit`
- Kết quả: **27/27 suites PASS, 816/816 tests PASS 100%** (546.558 s, exit code 0).
- Do đợt sửa này chỉ cập nhật file test `phase1e1_data_boundary.test.js` và tài liệu markdown, không sửa mã nguồn sản phẩm (`src/*`), nên không cần chạy lại toàn bộ backend.

---

## 5. BẢO VỆ MÔI TRƯỜNG RUNTIME THẬT

- **Môi trường runtime Codex đã khôi phục**:
  - Frontend: `http://localhost:5173`
  - Backend: `http://localhost:5001`
  - MongoDB khôi phục: `127.0.0.1:27018`, Replica Set `rs0` (`E:\school-mongo-recovery-20261106\data`)
  - Backend đang chạy không có scheduler.
- **Cam kết bảo toàn**:
  - Không sửa `.env`, không reset/seed tài khoản, không đổi mật khẩu, không đổi cổng.
  - Không dừng tiến trình runtime hoặc khởi động scheduler.
  - Không chạy test/migration/syncIndexes trên database runtime.
  - Toàn bộ thay đổi mã nguồn và file kiểm thử mới không vi phạm git formatting (`git diff --check` mã thoát 0).

---

## 6. BACKLOG CHI TIẾT CHO CÁC TASK TIẾP THEO (1E.2 – 1E.5)

> [!IMPORTANT]
> Toàn bộ các nội dung migration index trong backlog dưới đây chỉ là **đề xuất kỹ thuật**. Việc giao triển khai các Task 1E.2–1E.5 **tuyệt đối không tự cấp quyền chạy migration** trên cơ sở dữ liệu thật. Mọi kế hoạch cutover hay thay đổi index thật đều cần phương án chi tiết và phê duyệt riêng từ Codex. Không có cam kết Zero-Downtime hoặc không block write nếu chưa có quy trình bảo trì được phê duyệt.

| Task | Tên nhiệm vụ | Phạm vi & Trách nhiệm | Ràng buộc then chốt |
|---|---|---|---|
| **Task 1E.2** | Kỳ kế toán, Sổ quỹ và Báo cáo tài chính | - Scoped `tenantId` cho `AccountingPeriod`, `DailyCashReconciliation`.<br>- Triển khai compound index `{ tenantId: 1, month: 1 }` và `{ tenantId: 1, workDate: 1 }`.<br>- Controller/Service đối soát quỹ và báo cáo tài chính theo Tenant. | Actor phải cùng Tenant; xử lý transaction an toàn; không cho phép chốt sổ quỹ chéo tenant. |
| **Task 1E.3** | Danh mục mức thu, Biểu phí và Hóa đơn học phí | - Scoped `tenantId` cho `FeeSchedule`, `TuitionFee`.<br>- Triển khai index biểu phí `{ tenantId: 1, period: 1, classroomId: 1 }` xử lý mức thu chung toàn trường (`classroomId: null`).<br>- Sinh hóa đơn học phí theo đợt scoped theo từng tenant. | Không xuất hóa đơn cho học sinh/lớp học khác tenant; chống trùng lặp hóa đơn trong kỳ. |
| **Task 1E.4** | Thanh toán học phí, Hoàn phí và Quản lý chi phí | - Scoped `tenantId` cho `Payment`, `InvoiceAdjustment`, `TuitionRefundRequest`, `OperatingExpense`, `PurchaseExpense`, `OperatingExpenseRequest`.<br>- Triển khai index mã tùy chọn loại bỏ sparse, dùng `{ field: { $gt: '' } }` cho `receiptNumber`, `txnRef`, `transactionRef`. | Kiểm soát transaction đồng thời; biên lai thu tiền và chứng từ chi không xung đột mã giữa các trường; cho phép nhiều phiếu chưa có mã. |
| **Task 1E.5** | Tích hợp SaaS Router tài chính và nghiệm thu Phase 1E | - Mở các router tài chính trên `createSaasApp.js` khi mode là `phase1e`.<br>- Mount cả 2 tiền tố `/api/v1` và `/api`.<br>- Kiểm thử tích hợp toàn diện Phase 1E và nghiệm thu bàn giao. | Chặn fail-closed (HTTP 501) các module chưa hỗ trợ; không hồi quy Phase 1B/1C/1D. |

---

## 7. KẾT LUẬN & ĐIỀU KIỆN DỪNG

- **Task 1E.1 đã hoàn thành trọn vẹn 100% mục tiêu đề ra**:
  - Đã thêm `tenantId` đúng chuẩn vào 10 model tài chính.
  - Đã khảo sát và lập tài liệu thiết kế index chi tiết trong [`docs/SAAS-PHASE-1E-INDEX-DECISIONS.md`](file:///E:/school-management-api/docs/SAAS-PHASE-1E-INDEX-DECISIONS.md).
  - Đã kiểm chứng 99/99 test cases trong `phase1e1_data_boundary.test.js` trên MongoDB 8.2.6.
  - Đã xác nhận không hồi quy trên Phase 1D (261/261 tests).
  - Đã phân bổ và đối chiếu số test từng nhóm chính xác theo runtime output của Jest.
- **Antigravity dừng lại tại đây và bàn giao cho Codex nghiệm thu**.
- **Tuyệt đối không tự ý bắt đầu Task 1E.2** cho đến khi có chỉ thị tiếp theo từ Codex.
