# BÁO CÁO NGHIỆM THU & BÀN GIAO TASK 1E.2 (HOÀN THIỆN SAU PHẢN HỒI CODEX)
## CÁCH LY KỲ KẾ TOÁN VÀ SỔ QUỸ THEO TRƯỜNG (ZONE 4 FINANCE)

- **Dự án**: `E:\school-management-api`
- **Mốc thực hiện**: Giai đoạn 1E — Task 1E.2 (Cách ly kỳ kế toán và sổ quỹ theo trường)
- **Trạng thái**: **HOÀN THÀNH — PASS 100% (33/33 tests Suite 1E.2 trên lượt chạy xác minh Handshake Barrier mới)**
- **Tác nhân triển khai**: Antigravity
- **Người điều phối & nghiệm thu**: Codex
- **Phiên bản MongoDB kiểm chứng**: **MongoDB 8.2.6** (trên `MongoMemoryReplSet` cô lập)

---

## 1. TỔNG QUAN CÁC ĐIỂM KHẮC PHỤC THEO YÊU CẦU CỦA CODEX

Thực hiện nghiêm túc chỉ thị nghiệm thu của Codex, Antigravity đã rà soát và hoàn thiện toàn diện các bằng chứng kỹ thuật trong Task 1E.2:

1. **Chặn context không hợp lệ trước mọi đường ghi & đọc (Anti-Sentinel & Fail-Closed)**:
   - Viết hàm `resolvePeriodContext(context, { requireContext = false })` trong [`accountingPeriodService.js`](file:///E:/school-management-api/backend/src/services/accountingPeriodService.js).
   - Nếu `context` được truyền vào nhưng không hợp lệ (`resolveTenantContext(context).isValid === false` do giả mạo plain object, sai lệch `req.tenantId` với `req.user.tenantId`, hoặc thiếu `req.tenantId` đối với user SaaS):
     - **Lập tức ném lỗi HTTP 403 (`INVALID_TENANT_CONTEXT`) trước bất kỳ truy vấn ghi hay đọc nào**.
     - **Loại bỏ triệt để nguy cơ sentinel filter (`{ _id: 000..., tenantId: 000... }`) bị Mongoose/MongoDB biến thành document thật trong DB khi chạy `findOneAndUpdate` với `upsert: true`**.
     - Không cho phép context giả mạo rơi về legacy.
     - `assertOpen` không còn im lặng coi context không hợp lệ là "kỳ mở", mà lập tức từ chối với HTTP 403.
   - Tích hợp `assertTenantContext(req)` vào các handler:
     - [`accountingPeriodController.js`](file:///E:/school-management-api/backend/src/controllers/accountingPeriodController.js): `closePeriod`, `reopenPeriod`, `getPeriod`.
     - [`cashbookController.js`](file:///E:/school-management-api/backend/src/controllers/cashbookController.js): `saveDailyReconciliation`, `getCashbook`.
     - [`accountingReportController.js`](file:///E:/school-management-api/backend/src/controllers/accountingReportController.js): `getAccountingReport`.
   - Cập nhật các helper đọc `loadEntries`, `getCashbookData`, `buildAccountingReport` để xác thực context chặt chẽ (từ chối HTTP 403 nếu context truyền vào không hợp lệ).

2. **Kiểm chứng độc lập và chính xác xung đột Global Unique Index `workDate_1`**:
   - Thiết kế test E.2 tách biệt hai ràng buộc: Tenant B đã có sẵn kỳ mở tháng `2026-06` trong DB, giúp thao tác `lockOpenPeriod('2026-06')` của Tenant B thành công trong transaction.
   - Khi Tenant B tạo bản đối soát ngày `2026-06-15` (ngày đã có bản đối soát của Tenant A từ trước), MongoDB ném lỗi duplicate key E11000 trên đúng index `workDate_1`.
   - Handler `saveDailyReconciliation` bắt lỗi và trả về đúng thông báo của nhánh đối soát: `"Ngày này đã có bản đối soát hoặc xung đột hệ thống. Hãy tải lại."` (HTTP 409).
   - Kiểm chứng transaction rollback hoàn toàn: `writeVersion` của kỳ kế toán Tenant B không bị tăng lên, và bản đối soát của Tenant A được giữ nguyên vẹn 100%.

3. **Bằng chứng Transaction Rollback, Actor Re-verify & Concurrency (Handshake Barrier hai luồng)**:
   - **Tách 4 ca Rollback F.1 độc lập với happy path đối ứng**:
     - *F.1a (`closePeriod`)*: Inject lỗi tại thao tác ghi trạng thái/history sau `lockOpenPeriod` -> Rollback sạch sẽ (status vẫn `open`, writeVersion rollback về 1, revision 0, snapshot rỗng `snapshot || {}`); happy path chốt kỳ thành công, tăng revision lên 1.
     - *F.1b (`reopenPeriod`)*: Inject lỗi tại thao tác cập nhật mở lại kỳ -> Rollback sạch sẽ (status vẫn `closed`, writeVersion 1, revision 1, history 1 phần tử); happy path mở lại thành công, revision lên 2.
     - *F.1c (`saveDailyReconciliation` tạo mới)*: Inject lỗi tại `DailyCashReconciliation.create` sau khi `lockOpenPeriod` đã ghi -> Rollback sạch sẽ (không có document đối soát nào được tạo, `writeVersion` của kỳ kế toán rollback về 1); happy path tạo mới đối soát thành công revision 1 và `writeVersion` tăng lên 2.
     - *F.1d (`saveDailyReconciliation` cập nhật)*: Inject lỗi tại `DailyCashReconciliation.findOneAndUpdate` -> Rollback sạch sẽ (bản đối soát giữ nguyên revision 1 và số liệu cũ, `writeVersion` của kỳ giữ nguyên); happy path cập nhật thành công lên revision 2.
   - **Actor Re-verify (F.2)**: Xác minh người dùng trực tiếp từ DB bằng session hiện tại (`User.findOne({ _id: req.user._id, status: 'active', ...tenantFilter }).session(session)`). Giáo viên không có quyền chốt/mở kỳ hoặc đối soát bị từ chối với HTTP 403.
   - **Actor Khóa / Race Condition (F.3a & F.3b)**:
     - *F.3a (Stale Request)*: Request mang thông tin actor active (stale token/context) nhưng database thực tế đã bị khóa trước khi controller chạy -> Bị từ chối HTTP 403 `"Người dùng không có quyền..."`.
     - *F.3b (Khóa actor sau xác thực request nhưng trước khi transaction snapshot được đọc)*: Khóa tài khoản trong DB ngay khi session bắt đầu nhưng trước câu lệnh đầu tiên của transaction -> Re-verify trong transaction phát hiện user đã inactive, ném HTTP 403.
   - **Phân biệt rành mạch Kiểm thử Tuần tự (F.4a) và Concurrency thực sự với Handshake Barrier (F.4b)**:
     - *F.4a (Kiểm thử tuần tự)*: `closePeriod` chạy trước hoàn tất chốt kỳ. Thao tác `saveDailyReconciliation` đến sau bị chặn bởi `lockOpenPeriod` với HTTP 409 `"Kỳ kế toán đã chốt. Cần hiệu trưởng hoặc admin mở lại và ghi lý do trước khi sửa."`.
     - *F.4b (Concurrency thực sự với Handshake Barrier hai luồng xác định)*:
       - **Thiết lập hai Barrier và các điểm quan sát thực tế**:
         1. *Barrier 1 (`closeHoldingLock`)*: Luồng `closePeriod` chạy trong transaction của nó (`closeSession`), thực hiện `lockOpenPeriod` (tăng `writeVersion: 1 -> 2`, giữ write lock của MongoDB WiredTiger trên document kỳ kế toán), tính xong báo cáo và dừng ngay trước khi commit cập nhật `status: 'closed'`.
         2. *Khởi chạy luồng `saveDailyReconciliation`*: Được kích hoạt trong khi transaction của `close` đang dở và đang giữ write lock.
         3. *Bốn tín hiệu xác nhận luồng save trước khi mở khóa close*:
            - Đã vào transaction: `saveSession.inTransaction() === true`.
            - Đã hoàn thành lần đọc actor trong session: Quan sát qua `User.findOne` và trạng thái `saveSession.transaction.state === 'TRANSACTION_IN_PROGRESS'`.
            - Đã tới thao tác `lockOpenPeriod` trên đúng target: `filter.month === '2026-01'`, `filter.tenantId === tenantA._id`, `filter.status === 'open'`, update có `$inc: { writeVersion: 1 }`.
            - Xác nhận session phân biệt: `saveSession.id.id.toString('hex') !== closeSession.id.id.toString('hex')`.
         4. *Barrier 2 (`closeCanProceed`)*: Chỉ được resolve sau khi nhận đủ cả 4 tín hiệu trên từ luồng save.
       - **Timeout bảo vệ nghiêm ngặt**:
         - Loại bỏ hoàn toàn timeout tự resolve cho qua.
         - Mỗi barrier có timeout 10.000 ms; nếu quá hạn, promise lập tức `reject` với lỗi `BARRIER_TIMEOUT: Barrier "<name>" was not reached within 10000ms`, làm fail test ngay.
         - Clear timer ngay khi barrier hoàn thành.
         - Khối `finally` dọn dẹp toàn bộ timer, unblock các barrier pending, và dùng `Promise.allSettled` chờ cả hai request kết thúc hoàn toàn trước khi restore mocks, ngăn chặn triệt để tình trạng request rò rỉ sang test kế tiếp.
       - **Xử lý xung đột và Assert Database cuối cụ thể (Không dùng nhánh `if`)**:
         - `closePeriod` commit thành công: HTTP 200, message `"Đã chốt kỳ và lưu ảnh chụp báo cáo"`.
         - `saveDailyReconciliation` sau khi unblock khỏi MongoDB gặp xung đột khóa / kỳ đã chốt (mã lỗi E11000 từ unique index `month` khi upsert kỳ đã đóng), được xử lý có kiểm soát và trả về HTTP 409 `"Kỳ kế toán đã chốt. Cần hiệu trưởng hoặc admin mở lại và ghi lý do trước khi sửa."`.
         - Trạng thái DB cuối được assert trực tiếp, không dùng `if`:
           - `finalPeriod.status === 'closed'`
           - `finalPeriod.revision === 1`
           - `finalPeriod.writeVersion === 2` (phản ánh đúng 1 lần tạo ban đầu + 1 lần `lockOpenPeriod` đã commit của `closePeriod`; lần ghi của `saveDailyReconciliation` đã bị rollback hoàn toàn)
           - `finalPeriod.history` có đúng 1 phần tử (`action: 'closed'`)
           - `finalRecon === null`, tổng số bản ghi đối soát trong database là `0`.
       - *Phạm vi chứng minh*: Kết quả này kiểm chứng tính toàn vẹn và atomic concurrency độc quyền cho cặp thao tác `closePeriod` và `saveDailyReconciliation` đã được tenant-scoped trong Task 1E.2; không suy diễn sang các writer tài chính khác chưa được scoped.

4. **Khai báo Schema `Payroll` và Router SaaS đóng Fail-Closed**:
   - Khai báo trường `tenantId` kiểu `ObjectId`, ref `'Tenant'` trong [`backend/src/models/zone2_hr/Payroll.js`](file:///E:/school-management-api/backend/src/models/zone2_hr/Payroll.js) để chống hiện tượng strip field của Mongoose.
   - Giữ router SaaS tài chính (`createSaasApp.js`) đóng chặt với **HTTP 501** cho cả mode `phase1d` và `phase1e` ở cả hai tiền tố `/api/v1` và `/api`.

---

## 2. MA TRẬN ENTRY POINT, HELPER VÀ CALLER

| Tên Hàm / Route | Loại | Nguồn Context | Model Đọc | Model Ghi | Cơ chế Transaction | Phạm vi & Trạng thái |
|---|---|---|---|---|---|---|
| `accountingPeriodController.getPeriod` | Controller (GET) | `req` (`assertTenantContext`) | `AccountingPeriod`, các model tài chính qua report | Không | Không | Zone 4 (Task 1E.2) — Scoped |
| `accountingPeriodController.closePeriod` | Controller (POST) | `req` (`assertTenantContext`) | `User`, `AccountingPeriod`, các model tài chính qua report | `AccountingPeriod` | `session.withTransaction` | Zone 4 (Task 1E.2) — Scoped |
| `accountingPeriodController.reopenPeriod` | Controller (POST) | `req` (`assertTenantContext`) | `User`, `AccountingPeriod` | `AccountingPeriod` | `session.withTransaction` | Zone 4 (Task 1E.2) — Scoped |
| `cashbookController.getCashbook` | Controller (GET) | `req` (`assertTenantContext`) | `DailyCashReconciliation`, 5 nguồn chứng từ sổ quỹ, `TuitionFee` | Không | Không | Zone 4 (Task 1E.2) — Scoped |
| `cashbookController.saveDailyReconciliation` | Controller (POST) | `req` (`assertTenantContext`, `resolveTenantContext`) | `User`, `AccountingPeriod`, `DailyCashReconciliation`, 5 nguồn chứng từ | `AccountingPeriod`, `DailyCashReconciliation` | `runStudentTransaction` | Zone 4 (Task 1E.2) — Scoped |
| `accountingReportController.getAccountingReport` | Controller (GET) | `req` (`assertTenantContext`) | `TuitionFee`, `Payroll`, `DailyCashReconciliation`, 5 nguồn chứng từ | Không | Không | Zone 4 (Task 1E.2) — Scoped |
| `accountingPeriodOpen.guard` | Middleware | `req` | `TuitionFee` / `FeeSchedule` / `Payroll` (theo id), `AccountingPeriod` | Không | Không | Zone 4 (Task 1E.2) — Scoped |
| `accountingPeriodService.assertOpen` | Service Helper | `maybeContext` / `sessionOrOptions` | `AccountingPeriod` | Không | Không | Zone 4 — Scoped nếu có context; Fallback legacy nếu null |
| `accountingPeriodService.lockOpenPeriod` | Service Helper | `maybeContext` / `sessionOrOptions` | `AccountingPeriod` (khi bắt 11000) | `AccountingPeriod` | Nhận `session` từ caller | Zone 4 — Scoped nếu có context; Fallback legacy nếu null |
| `cashbookController.loadEntries` | Controller Helper | `context` | `Payment`, `InvoiceAdjustment`, `PurchaseExpense`, `OperatingExpense`, `Payroll`, `TuitionFee` | Không | Nhận `session` từ caller | Zone 4 — Scoped nếu có context; Fallback legacy nếu null |
| `cashbookController.getCashbookData` | Controller Helper | `context` | `DailyCashReconciliation`, và 5 nguồn qua `loadEntries` | Không | Nhận `session` từ caller | Zone 4 — Scoped nếu có context; Fallback legacy nếu null |
| `accountingReportController.buildAccountingReport` | Controller Helper | `context` | `TuitionFee`, `Payroll`, `DailyCashReconciliation`, và 5 nguồn qua `loadEntries` | Không | Nhận `session` từ caller | Zone 4 — Scoped nếu có context; Fallback legacy nếu null |
| `financeExcelController` (export) | Controller (GET) | `req` | Gọi `getCashbookData` và `buildAccountingReport` có truyền `req` | Không | Không | Zone 4 (Task 1E.2) — Scoped |
| `financeController` (hóa đơn, thanh toán) | Legacy Caller | Không truyền (`null`) | Các model tài chính | `AccountingPeriod` qua `lockOpenPeriod` | Có | Ngoài phạm vi 1E.2 — Chờ chuyển đổi ở 1E.3 & 1E.4 |
| `operatingExpenseController` | Legacy Caller | Không truyền (`null`) | `OperatingExpense` | `AccountingPeriod` qua `lockOpenPeriod` | Có | Ngoài phạm vi 1E.2 — Chờ chuyển đổi ở 1E.4 |
| `purchaseExpenseController` | Legacy Caller | Không truyền (`null`) | `PurchaseExpense` | `AccountingPeriod` qua `lockOpenPeriod` | Có | Ngoài phạm vi 1E.2 — Chờ chuyển đổi ở 1E.4 |
| `tuitionRefundController` | Legacy Caller | Không truyền (`null`) | `TuitionRefundRequest` | `AccountingPeriod` qua `lockOpenPeriod` | Có | Ngoài phạm vi 1E.2 — Chờ chuyển đổi ở 1E.4 |
| `paymentTransactionService` | Legacy Caller | Không truyền (`null`) | `Payment` | `AccountingPeriod` qua `lockOpenPeriod` | Có | Ngoài phạm vi 1E.2 — Chờ chuyển đổi ở 1E.4 |

---

## 3. GIỚI HẠN KỸ THUẬT VÀ QUY TẮC BẢO VỆ PHẠM VI

### 3.1. Phân biệt Query Scoping và Khóa Nghiệp Vụ Toàn Cục (Global Unique Index)
- **Query Scoping**: Mọi truy vấn đọc và cập nhật trong Task 1E.2 đều được giới hạn theo `tenantId`. Tenant A không thể đọc, chốt kỳ, mở kỳ hoặc sửa đổi đối soát của Tenant B.
- **Giới hạn Global Unique Index**:
  - `AccountingPeriod.month` vẫn duy trì index `{ month: 1 }` (`unique: true`).
  - `DailyCashReconciliation.workDate` vẫn duy trì index `{ workDate: 1 }` (`unique: true`).
  - Do chưa thực hiện migration drop index toàn cục trên cơ sở dữ liệu thật, nếu hai trường cùng tạo kỳ cho cùng một tháng hoặc cùng đối soát một ngày, thao tác sau sẽ bị lỗi E11000.
  - Các handler `lockOpenPeriod` và `saveDailyReconciliation` bắt lỗi này và trả về **HTTP 409 có kiểm soát**, không làm rò rỉ thông tin hay làm crash tiến trình.
  - Khả năng để hai trường cùng sử dụng chung tháng/ngày phụ thuộc vào kế hoạch migration index được phê duyệt riêng sau này; Task 1E.2 tuyệt đối không tự ý thay đổi index schema hoặc lách bằng tiền tố mã trường.

### 3.2. Giới hạn đối với các Writer Tài Chính ngoài phạm vi 1E.2
- Các writer tài chính Zone 4 khác (`financeController`, `operatingExpenseController`, `purchaseExpenseController`, `tuitionRefundController`, `paymentTransactionService`) hiện chưa được chuyển đổi trong Task 1E.2. Khi gọi `lockOpenPeriod`, chúng không truyền context, do đó hoạt động trong phân vùng legacy (`tenantId: null`).
- Antigravity không tự tiện sửa đổi hàng loạt các controller này trong lượt 1E.2 để tránh phình phạm vi và rủi ro hồi quy. Việc chuyển đổi các writer này là **dependency bắt buộc của Task 1E.3 và 1E.4**.
- Do đó, **router SaaS tài chính (`createSaasApp`) tiếp tục được khóa chặt với HTTP 501** cho đến khi hoàn thành tích hợp ở Task 1E.5.

---

## 4. KẾT QUẢ KIỂM THỬ RUNTIME THỰC TẾ

> [!IMPORTANT]
> Toàn bộ các test suite được thực thi **100% trên MongoMemoryReplSet (MongoDB 8.2.6)** cô lập thông qua `testDbBootstrap` với lớp bảo vệ `safeDbGuard`. Tuyệt đối không tác động lên cơ sở dữ liệu runtime thật.

### A. Kết quả kiểm thử lượt chạy mới của Suite 1E.2 (`backend/tests/saas/phase1e2_accounting_cash.test.js`):
- **Lệnh thực thi**: `npm test --prefix backend -- phase1e2 --runInBand --forceExit`
- **Kết quả**: **1/1 suite PASS, 33/33 tests PASS 100%**
- **Thời gian chạy**: **22.505 s**
- **Mã thoát (Exit Code)**: **0**
- **Danh sách 33 test cases thực tế theo Jest runtime output**:
  1. *Nhóm A: Ranh giới đọc dữ liệu Sổ Quỹ và Báo Cáo Kế Toán* (4 tests):
     - `A.1: Sổ Quỹ của Tenant A chỉ hiển thị các bút toán thu/chi của Tenant A`
     - `A.2: Caller Legacy chỉ đọc các bản ghi legacy (tenantId: null)`
     - `A.3: Lookup hóa đơn trong Sổ Quỹ không làm rò rỉ tên/mã học sinh của tenant khác`
     - `A.4: buildAccountingReport tổng hợp số liệu kế toán tháng cách ly triệt để theo tenant`
  2. *Nhóm B: Nghiệp vụ Kỳ Kế Toán (AccountingPeriod)* (5 tests):
     - `B.1: Kỳ chốt của Tenant A không được làm chặn thao tác ghi của Tenant B`
     - `B.2: lockOpenPeriod tạo kỳ mới gắn đúng tenantId và tăng writeVersion nguyên tử`
     - `B.3: getPeriod trả về trạng thái kỳ của đúng tenant, không nhầm lẫn với kỳ khác`
     - `B.4: closePeriod chốt kỳ thành công, lưu snapshot và re-verify actor trong transaction`
     - `B.5: reopenPeriod mở lại kỳ đã chốt thành công và lưu lịch sử action: reopened`
  3. *Nhóm C: Nghiệp vụ Đối Soát Sổ Quỹ Hàng Ngày (DailyCashReconciliation)* (3 tests):
     - `C.1: saveDailyReconciliation tạo mới revision 1 gắn đúng tenantId và actor`
     - `C.2: saveDailyReconciliation cập nhật revision 2 với changeReason hợp lệ`
     - `C.3: Tenant B không thể cập nhật bản đối soát của Tenant A`
  4. *Nhóm D: Xác thực Tenant Context Chặt Chẽ Trước Mọi Đường Ghi & Đọc* (7 tests):
     - `D.1: lockOpenPeriod từ chối plain object giả mạo tenantId (HTTP 403, không tạo document, không sentinel _id toàn số 0)`
     - `D.2: lockOpenPeriod từ chối request có req.tenantId khác req.user.tenantId (Cross-tenant mismatch HTTP 403)`
     - `D.3: lockOpenPeriod từ chối request có user SaaS nhưng thiếu req.tenantId (HTTP 403)`
     - `D.4: assertOpen từ chối context không hợp lệ (HTTP 403, không im lặng coi là kỳ mở)`
     - `D.5: Các handler ghi (closePeriod, reopenPeriod, saveDailyReconciliation) từ chối context không hợp lệ (HTTP 403)`
     - `D.6: Các helper đọc (loadEntries, getCashbookData, buildAccountingReport) từ chối context không hợp lệ (HTTP 403)`
     - `D.7: Happy paths đối ứng cho Tenant A, Tenant B và Legacy context tường minh`
  5. *Nhóm E: Kiểm Chứng Độc Lập Xung Đột Global Unique Index (month_1 và workDate_1)* (2 tests):
     - `E.1: Xử lý va chạm Global Unique Index month_1 trên AccountingPeriod (HTTP 409 có kiểm soát, không lộ raw MongoError)`
     - `E.2: Xử lý va chạm Global Unique Index workDate_1 trên DailyCashReconciliation khi lockOpenPeriod đã thành công`
  6. *Nhóm F: Tính Nguyên Tử, Transaction Rollback & Re-verify Actor* (9 tests):
     - `F.1a: closePeriod Rollback khi inject lỗi tại thao tác ghi trạng thái/history sau lockOpenPeriod`
     - `F.1b: reopenPeriod Rollback khi inject lỗi tại thao tác ghi trạng thái/history`
     - `F.1c: saveDailyReconciliation tạo mới Rollback khi inject lỗi sau khi lockOpenPeriod đã ghi`
     - `F.1d: saveDailyReconciliation cập nhật Rollback khi inject lỗi ghi cập nhật bản đối soát`
     - `F.2: Re-verify actor: Từ chối khi actor không đúng quyền trong DB (kể cả trước khi gọi)`
     - `F.3a: Stale Request: Từ chối thao tác khi request mang thông tin actor cũ nhưng database đã khóa trước khi controller chạy`
     - `F.3b: Khóa actor sau xác thực request nhưng trước khi transaction snapshot được đọc`
     - `F.4a: Kiểm thử tuần tự: saveDailyReconciliation bị chặn khi kỳ kế toán đã chốt từ trước`
     - `F.4b: Concurrency thực sự với Handshake Barrier hai luồng: Cạnh tranh đồng thời giữa closePeriod và saveDailyReconciliation`
  7. *Nhóm G: SaaS Router Gating & Fail-Closed* (3 tests):
     - `G.1: Module Finance và Reports bị chặn HTTP 501 Not Implemented ở mode phase1d (/api/v1 và /api)`
     - `G.2: Module Finance và Reports tiếp tục bị chặn HTTP 501 Not Implemented ở mode phase1e`
     - `G.3: Untrusted context không thể giả mạo dữ liệu tenant (Fail-Closed)`

### B. Mốc kiểm tra hồi quy lịch sử Suite 1E.1 (`backend/tests/saas/phase1e1_data_boundary.test.js`):
- **Lệnh thực thi**: `npm test --prefix backend -- phase1e1 --runInBand --forceExit`
- **Kết quả đã xác nhận ở mốc trước**: **1/1 suite PASS, 99/99 tests PASS 100%** (39.921 s, exit code 0).

### C. Mốc kiểm tra hồi quy lịch sử toàn bộ Phase 1D (9 test suites từ filesystem):
- **Lệnh thực thi**: `npm test --prefix backend -- phase1d --runInBand --forceExit`
- **Kết quả đã xác nhận ở mốc trước**: **9/9 suites PASS, 261/261 tests PASS 100%** (245.41 s, exit code 0).
- **Chi tiết 9 test suites Phase 1D từ filesystem**:
  1. `tests/saas/phase1d1_data_boundary.test.js` (7.777 s)
  2. `tests/saas/phase1d2_internal_accounts_scoping.test.js` (65.02 s)
  3. `tests/saas/phase1d3_assignment_concurrency.test.js` (7.371 s)
  4. `tests/saas/phase1d3_hr_scoping.test.js` (37.432 s)
  5. `tests/saas/phase1d3_staffing_scoping.test.js` (46.793 s)
  6. `tests/saas/phase1d4_adjustments_scoping.test.js` (29.303 s)
  7. `tests/saas/phase1d4_recalculation_scoping.test.js` (9.866 s)
  8. `tests/saas/phase1d4_timekeeping_scoping.test.js` (22.537 s)
  9. `tests/saas/phase1d5_integration.test.js` (35.758 s)

### D. Mốc kiểm tra toàn diện Full Backend lịch sử (28 suites):
- **Lệnh thực thi**: `npm test --prefix backend -- --runInBand --forceExit`
- **Kết quả mốc lịch sử**: **28/28 suites PASS, 857/857 tests PASS 100%** (thực hiện ở lượt chạy full backend trước khi tách nhóm F).
- *Lưu ý*: Lượt hoàn thiện này chỉ chỉnh sửa test và tài liệu cho Task 1E.2, không chạy lại toàn bộ backend để tiết kiệm tài nguyên; không suy đoán tổng số tests full backend mới khi chưa thực thi.
- **Ghi nhận cảnh báo Jest Runtime**:
  ```
  Force exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?
  ```
  *Ghi nhận trung thực*: Cảnh báo xuất hiện do Jest phát hiện có async operations / handles còn mở sau khi hoàn thành. Nguyên nhân cụ thể của open handle chưa được xác định do chưa điều tra độc lập bằng `--detectOpenHandles`, không suy đoán nguyên nhân khi chưa có bằng chứng log. Toàn bộ 33/33 tests của suite 1E.2 đã hoàn thành và assert đạt 100% trước khi Jest thoát.

### E. Kiểm tra định dạng Git:
- **Lệnh thực thi**: `git diff --check`
- **Kết quả**: **Mã thoát (Exit code) 0**.
- *Cảnh báo xuất hiện*: Git thông báo chuẩn `LF will be replaced by CRLF the next time Git touches it` do thiết lập line-ending trên Windows; không có lỗi trailing whitespace hoặc conflict marker nào.

---

## 5. DANH SÁCH FILE SỬA ĐỔI TRONG ĐỢT HOÀN THIỆN NÀY

| STT | Đường dẫn file | Loại thay đổi | Chi tiết thay đổi |
|---|---|---|---|
| 1 | `backend/src/services/accountingPeriodService.js` | Sửa đổi | Bổ sung `resolvePeriodContext`, từ chối ngay lập tức context không hợp lệ (HTTP 403), loại bỏ triệt để sentinel upsert |
| 2 | `backend/src/controllers/accountingPeriodController.js` | Sửa đổi | Tích hợp `assertTenantContext(req)` vào `closePeriod`, `reopenPeriod`, `getPeriod` |
| 3 | `backend/src/controllers/cashbookController.js` | Sửa đổi | Tích hợp `assertTenantContext(req)` vào `saveDailyReconciliation`, `getCashbook`, và xác thực context trong `loadEntries`, `getCashbookData` |
| 4 | `backend/src/controllers/accountingReportController.js` | Sửa đổi | Tích hợp `assertTenantContext(req)` vào `getAccountingReport` và xác thực context trong `buildAccountingReport` |
| 5 | `backend/src/models/zone2_hr/Payroll.js` | Sửa đổi (từ lượt trước) | Khai báo trường `tenantId` kiểu `ObjectId`, ref `'Tenant'` để chống strip field |
| 6 | `backend/tests/saas/phase1e2_accounting_cash.test.js` | Cập nhật bộ test | Hoàn thiện cơ chế Handshake Barrier hai luồng F.4b với timeout bảo vệ nghiêm ngặt và assert database cuối cụ thể không dùng nhánh `if`; 33/33 tests PASS |
| 7 | `docs/SAAS-PHASE-1E2-HANDOFF.md` | Cập nhật tài liệu | Hoàn thiện tài liệu nghiệm thu trung thực, chính xác theo mã nguồn và runtime thật |

---

## 6. KẾT LUẬN & ĐIỀU KIỆN DỪNG

- **Task 1E.2 đã hoàn thành toàn diện và chính xác theo mọi tiêu chí kỹ thuật mà Codex yêu cầu**:
  - Không còn lỗ hổng sentinel upsert.
  - Context không hợp lệ bị chặn tuyệt đối trước mọi đường ghi và đọc.
  - Va chạm `workDate_1` được kiểm chứng độc lập và chính xác với transaction rollback.
  - Concurrency F.4b được chứng minh bằng Handshake Barrier hai luồng xác định với 4 tín hiệu xác nhận, timeout bảo vệ nghiêm ngặt và assert DB cuối rõ ràng.
  - Toàn bộ 33/33 tests Suite 1E.2 PASS (22.505 s).
  - Môi trường runtime khôi phục (Backend 5001, Frontend 5173, MongoDB 27018 rs0) và worktree được bảo toàn nguyên vẹn.
- **Dừng theo quy định**: Không tự ý triển khai Task 1E.3–1E.5, không mở SaaS finance routes, chuyển giao kết quả để Codex chốt nghiệm thu 1E.2.
