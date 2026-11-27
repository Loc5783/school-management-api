# KHẢO SÁT HIỆN TRẠNG VÀ THIẾT KẾ INDEX TÀI CHÍNH ĐA TRƯỜNG (PHASE 1E)
## BÁO CÁO PHÂN TÍCH INDEX, RANH GIỚI DỮ LIỆU VÀ LỘ TRÌNH MIGRATION TÀI CHÍNH

- **Dự án**: `E:\school-management-api`
- **Mốc thực hiện**: Giai đoạn 1E — Task 1E.1 (Nền dữ liệu và thiết kế index tài chính đa trường)
- **Tác nhân thực hiện**: Antigravity
- **Người điều phối & nghiệm thu**: Codex
- **Phiên bản MongoDB kiểm chứng**: **MongoDB 8.2.6** (thực thi trên `MongoMemoryReplSet` cô lập)
- **Trạng thái**: Đã khảo sát toàn bộ 10 model theo schema thật, xác lập thiết kế index compound partial đề xuất (loại bỏ sparse, dùng `$gt: ''`), giữ nguyên index hiện hành cho Task 1E.1.

---

## 1. MỤC TIÊU VÀ NGUYÊN TẮC THIẾT KẾ

Giai đoạn 1E mở rộng kiến trúc SaaS multi-tenant sang phân hệ Tài chính trường học (Zone 4 Finance). Nhiệm vụ của Task 1E.1 là:
1. Thêm trường `tenantId` (ObjectId, ref `Tenant`, top-level, optional, không default, không required, không single index) vào đúng **10 model tài chính cốt lõi**.
2. Khảo sát toàn diện hệ thống index hiện hành đối chiếu giữa Mongoose Schema và script quản trị `createIndexes.js`.
3. Phân loại chuẩn xác:
   - **7 Model có ràng buộc Global Unique** (nguy cơ va chạm chéo tenant khi mở rộng SaaS).
   - **3 Model KHÔNG có Global Unique** (chỉ có index scoped theo ID cha hoặc học sinh).
4. Thiết kế Index Compound Partial tương thích multi-tenant:
   - **Tuyệt đối không kết hợp `sparse: true` và `partialFilterExpression`** (MongoDB từ chối tạo index).
   - Thiết kế partial filter chuẩn xác cho các trường mã tùy chọn (optional codes) bằng biểu thức `{ field: { $gt: '' } }`, loại trừ đồng thời: missing, `null` và chuỗi rỗng `""`.
   - Tránh triệt để lỗi thiết kế: mỗi tenant chỉ tạo được duy nhất 1 bản ghi thiếu mã / có mã rỗng.
5. Thử nghiệm và kiểm chứng cú pháp và hành vi trên MongoDB 8.2.6 thực tế qua collection tạm riêng biệt.
6. **Bảo toàn sản phẩm**: Không sửa index schema sản phẩm hoặc database runtime trong Task 1E.1.

---

## 2. KHẢO SÁT CHI TIẾT 10 MODEL THEO SCHEMA THỰC TẾ

> [!NOTE]
> Khảo sát đối chiếu từng dòng mã nguồn giữa Schema định nghĩa và script `backend/src/scripts/createIndexes.js`.

### 2.1. AccountingPeriod (`accountingperiods`)
- **Khóa nghiệp vụ**: Kỳ kế toán tháng (`month`, định dạng `YYYY-MM`).
- **Hệ thống Index hiện tại**:
  - Trong Schema: `month: { unique: true }` -> `month_1` (`unique: true`).
  - Trong `createIndexes.js`: `['AccountingPeriod', { month: 1 }, { unique: true }]`.
- **Ràng buộc Global Unique**: **CÓ**.
- **Tác động đa trường**: Khi Trường A mở kỳ `2026-11`, Trường B bị chặn không thể mở kỳ cùng tháng `2026-11` (lỗi E11000).
- **Trường tham chiếu (References)**:
  - `tenantId` -> `Tenant`
  - `history.actorId` -> `User`
- **Index đề xuất tương lai (Task 1E.2)**:
  - SaaS: `{ tenantId: 1, month: 1 }`, `unique: true`, `partialFilterExpression: { tenantId: { $type: 'objectId' } }`.
  - Legacy: `{ month: 1 }`, `unique: true`, `partialFilterExpression: { tenantId: null }`.

---

### 2.2. DailyCashReconciliation (`dailycashreconciliations`)
- **Khóa nghiệp vụ**: Ngày đối soát sổ quỹ tiền mặt (`workDate`, định dạng `YYYY-MM-DD`).
- **Hệ thống Index hiện tại**:
  - Trong Schema: `workDate: { unique: true }` -> `workDate_1` (`unique: true`).
  - Trong `createIndexes.js`: `['DailyCashReconciliation', { workDate: 1 }, { unique: true }]`.
- **Ràng buộc Global Unique**: **CÓ**.
- **Tác động đa trường**: Khi Kế toán Trường A chốt sổ quỹ ngày `2026-11-06`, Trường B bị chặn không thể chốt sổ cho cùng ngày (lỗi E11000).
- **Trường tham chiếu (References)**:
  - `tenantId` -> `Tenant`
  - `recordedBy` -> `User`
  - `history.changedBy` -> `User`
- **Index đề xuất tương lai (Task 1E.2)**:
  - SaaS: `{ tenantId: 1, workDate: 1 }`, `unique: true`, `partialFilterExpression: { tenantId: { $type: 'objectId' } }`.
  - Legacy: `{ workDate: 1 }`, `unique: true`, `partialFilterExpression: { tenantId: null }`.

---

### 2.3. FeeSchedule (`feeschedules`)
- **Khóa nghiệp vụ**: Biểu mức thu học phí theo kỳ và lớp (`period`, `classroomId`).
- **Hệ thống Index hiện tại**:
  - Trong Schema: `FeeScheduleSchema.index({ period: 1, classroomId: 1 }, { unique: true })` -> `period_1_classroomId_1`.
  - Trong `createIndexes.js`: `['FeeSchedule', { period: 1, classroomId: 1 }, { unique: true }]`.
- **Ràng buộc Global Unique**: **CÓ** (đối với mức thu chung toàn trường khi `classroomId: null`).
- **Tác động đa trường**: Với biểu phí riêng từng lớp (`classroomId` là ObjectId cụ thể), ID lớp là riêng biệt nên ít va chạm. Nhưng với **biểu phí chung toàn trường** (`classroomId: null`), khi Trường A tạo mức thu kỳ `11-2026`, Trường B bị chặn không thể tạo mức thu chung cho kỳ `11-2026` vì `{ period: "11-2026", classroomId: null }` vi phạm unique index toàn cục.
- **Trường tham chiếu (References)**:
  - `tenantId` -> `Tenant`
  - `classroomId` -> `Classroom` (default: null)
  - `updatedBy` -> `User`
- **Index đề xuất tương lai (Task 1E.3)**:
  - SaaS: `{ tenantId: 1, period: 1, classroomId: 1 }`, `unique: true`, `partialFilterExpression: { tenantId: { $type: 'objectId' } }`.
  - Legacy: `{ period: 1, classroomId: 1 }`, `unique: true`, `partialFilterExpression: { tenantId: null }`.

---

### 2.4. InvoiceAdjustment (`invoiceadjustments`)
- **Khóa nghiệp vụ**: Phiếu điều chỉnh giảm/tăng/hoàn học phí gắn với từng hóa đơn (`invoiceId`, `idempotencyKey`).
- **Hệ thống Index hiện tại**:
  - Trong Schema (4 indexes):
    1. `invoiceId_1`: `{ invoiceId: 1 }` (từ `index: true` trên path `invoiceId`).
    2. `invoiceId_1_createdAt_-1`: `{ invoiceId: 1, createdAt: -1 }`.
    3. `invoiceId_1_idempotencyKey_1`: `{ invoiceId: 1, idempotencyKey: 1 }`, `unique: true`, `partialFilterExpression: { idempotencyKey: { $type: 'string' } }`.
    4. `paidAt_-1`: `{ paidAt: -1 }`.
  - Trong `createIndexes.js`:
    - `['InvoiceAdjustment', { invoiceId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }]`
    - `['InvoiceAdjustment', { paidAt: -1 }]`
- **Ràng buộc Global Unique**: **KHÔNG**. Duy nhất chỉ có unique partial gắn với từng `invoiceId` cụ thể.
- **Tác động đa trường**: Do `invoiceId` là ObjectId của từng hóa đơn, không xảy ra va chạm chéo trường. Tuy nhiên, cần thêm `tenantId` để truy vấn báo cáo điều chỉnh học phí theo trường nhanh chóng mà không quét chéo.
- **Trường tham chiếu (References)**:
  - `tenantId` -> `Tenant`
  - `invoiceId` -> `TuitionFee`
  - `recordedBy` -> `User`
- **Index đề xuất tương lai (Task 1E.4)**:
  - SaaS Query Index: `{ tenantId: 1, invoiceId: 1 }` và `{ tenantId: 1, paidAt: -1 }`.

---

### 2.5. OperatingExpense (`operatingexpenses`)
- **Khóa nghiệp vụ**: Chứng từ chi phí vận hành trường học (`documentNumber`, `idempotencyKey`, `transactionRef`, `approvalRequestId`).
- **Hệ thống Index hiện tại**:
  - Trong Schema (5 indexes):
    1. `idempotencyKey_1`: `{ idempotencyKey: 1 }`, `unique: true` (inline).
    2. `paidAt_-1`: `{ paidAt: -1 }`.
    3. `documentNumber_1`: `{ documentNumber: 1 }`, `unique: true`.
    4. `transactionRef_1`: `{ transactionRef: 1 }`, `unique: true`, `partialFilterExpression: { transactionRef: { $type: 'string' } }`.
    5. `approvalRequestId_1`: `{ approvalRequestId: 1 }`, `unique: true`, `partialFilterExpression: { approvalRequestId: { $type: 'objectId' } }`.
  - Trong `createIndexes.js`: Có đủ cả 5 index trên.
- **Ràng buộc Global Unique**: **CÓ** (cả 4 ràng buộc: `documentNumber`, `idempotencyKey`, `transactionRef`, `approvalRequestId`).
- **Tác động đa trường**:
  - Khi Trường A dùng số chứng từ `PC-2026-001`, Trường B không thể dùng số chứng từ `PC-2026-001`.
  - `transactionRef_1` hiện dùng `{ transactionRef: { $type: 'string' } }`. Nếu hai chứng từ có `transactionRef: ""` (chuỗi rỗng), MongoDB sẽ báo lỗi E11000 trùng chuỗi rỗng!
- **Trường tham chiếu (References)**:
  - `tenantId` -> `Tenant`
  - `approvalRequestId` -> `OperatingExpenseRequest`
  - `recordedBy` -> `User`
- **Index đề xuất tương lai (Task 1E.4)**:
  - Số chứng từ SaaS: `{ tenantId: 1, documentNumber: 1 }`, `unique: true`, `partialFilterExpression: { tenantId: { $type: 'objectId' } }`.
  - Số chứng từ Legacy: `{ documentNumber: 1 }`, `unique: true`, `partialFilterExpression: { tenantId: null }`.
  - Mã giao dịch SaaS: `{ tenantId: 1, transactionRef: 1 }`, `unique: true`, `partialFilterExpression: { tenantId: { $type: 'objectId' }, transactionRef: { $gt: '' } }`.
  - Mã giao dịch Legacy: `{ transactionRef: 1 }`, `unique: true`, `partialFilterExpression: { tenantId: null, transactionRef: { $gt: '' } }`.

---

### 2.6. OperatingExpenseRequest (`operatingexpenserequests`)
- **Khóa nghiệp vụ**: Tờ trình/đề xuất phê duyệt chi tiêu (`requestKey`).
- **Hệ thống Index hiện tại**:
  - Trong Schema (2 indexes):
    1. `requestKey_1`: `{ requestKey: 1 }`, `unique: true` (inline).
    2. `status_1_createdAt_-1`: `{ status: 1, createdAt: -1 }`.
  - Trong `createIndexes.js`: Có cả 2 index trên.
- **Ràng buộc Global Unique**: **CÓ** (`requestKey`).
- **Tác động đa trường**: Trùng mã tờ trình `requestKey` giữa các trường sẽ bị chặn E11000.
- **Trường tham chiếu (References)**:
  - `tenantId` -> `Tenant`
  - `requestedBy` -> `User`
  - `reviewedBy` -> `User`
  - `expenseId` -> `OperatingExpense`
  - `paidBy` -> `User`
- **Index đề xuất tương lai (Task 1E.4)**:
  - SaaS: `{ tenantId: 1, requestKey: 1 }`, `unique: true`, `partialFilterExpression: { tenantId: { $type: 'objectId' } }`.
  - Legacy: `{ requestKey: 1 }`, `unique: true`, `partialFilterExpression: { tenantId: null }`.

---

### 2.7. Payment (`payments`)
- **Khóa nghiệp vụ**: Giao dịch thanh toán học phí (`invoiceId`, `receiptNumber`, `txnRef`, `idempotencyKey`).
- **Hệ thống Index hiện tại**:
  - Trong Schema (6 indexes):
    1. `receiptNumber_1`: `{ receiptNumber: 1 }`, `unique: true, sparse: true` (inline).
    2. `invoiceId_1`: `{ invoiceId: 1 }`.
    3. `recordedBy_1`: `{ recordedBy: 1 }`.
    4. `paidAt_1`: `{ paidAt: 1 }`.
    5. `invoiceId_1_idempotencyKey_1`: `{ invoiceId: 1, idempotencyKey: 1 }`, `unique: true`.
    6. `txnRef_1`: `{ txnRef: 1 }`, `unique: true, sparse: true`.
  - Trong `createIndexes.js`: Chỉ quản lý `['Payment', { invoiceId: 1 }]`.
- **Ràng buộc Global Unique**: **CÓ** (`receiptNumber` và `txnRef` - cả 2 đều global unique sparse).
- **Tác động đa trường**:
  - Khi Trường A xuất biên lai thu tiền số `PT-2026-001`, Trường B không thể xuất biên lai cùng số `PT-2026-001`.
  - Mã giao dịch ngân hàng `txnRef` hiện dùng `sparse: true`. Nếu chuyển sang partial filter không cẩn thận, có nguy cơ mỗi trường chỉ tạo được 1 phiếu thanh toán không có mã ngân hàng.
- **Trường tham chiếu (References)**:
  - `tenantId` -> `Tenant`
  - `invoiceId` -> `TuitionFee` (thực tế schema dùng `invoiceId`, không phải `studentId`!)
  - `recordedBy` -> `User`
  - `auditTrail.actorId` -> `User`
- **Index đề xuất tương lai (Task 1E.4)**:
  - Biên lai thu tiền SaaS: `{ tenantId: 1, receiptNumber: 1 }`, `unique: true`, `partialFilterExpression: { tenantId: { $type: 'objectId' }, receiptNumber: { $gt: '' } }`.
  - Biên lai thu tiền Legacy: `{ receiptNumber: 1 }`, `unique: true`, `partialFilterExpression: { tenantId: null, receiptNumber: { $gt: '' } }`.
  - Mã giao dịch SaaS: `{ tenantId: 1, txnRef: 1 }`, `unique: true`, `partialFilterExpression: { tenantId: { $type: 'objectId' }, txnRef: { $gt: '' } }`.
  - Mã giao dịch Legacy: `{ txnRef: 1 }`, `unique: true`, `partialFilterExpression: { tenantId: null, txnRef: { $gt: '' } }`.

---

### 2.8. PurchaseExpense (`purchaseexpenses`)
- **Khóa nghiệp vụ**: Phiếu chi mua sắm thiết bị/nguyên vật liệu theo đơn đặt hàng (`orderId`, `idempotencyKey`, `transactionRef`).
- **Hệ thống Index hiện tại**:
  - Trong Schema (4 indexes):
    1. `orderId_1`: `{ orderId: 1 }` (từ `index: true` trên path `orderId`).
    2. `orderId_1_idempotencyKey_1`: `{ orderId: 1, idempotencyKey: 1 }`, `unique: true`.
    3. `transactionRef_1`: `{ transactionRef: 1 }`, `unique: true, sparse: true`.
    4. `paidAt_-1`: `{ paidAt: -1 }`.
  - Trong `createIndexes.js`: Có 3 specs tương ứng (`orderId_1_idempotencyKey_1`, `transactionRef_1`, `paidAt_-1`).
- **Ràng buộc Global Unique**: **CÓ** (`transactionRef` - global unique sparse).
- **Tác động đa trường**: Hai trường dùng trùng mã giao dịch ngân hàng sẽ bị chặn bởi `transactionRef_1`.
- **Trường tham chiếu (References)**:
  - `tenantId` -> `Tenant`
  - `orderId` -> `PurchaseOrder` (thực tế schema dùng `orderId`, không phải `requestId`!)
  - `recordedBy` -> `User`
- **Index đề xuất tương lai (Task 1E.4)**:
  - Mã giao dịch SaaS: `{ tenantId: 1, transactionRef: 1 }`, `unique: true`, `partialFilterExpression: { tenantId: { $type: 'objectId' }, transactionRef: { $gt: '' } }`.
  - Mã giao dịch Legacy: `{ transactionRef: 1 }`, `unique: true`, `partialFilterExpression: { tenantId: null, transactionRef: { $gt: '' } }`.

---

### 2.9. TuitionFee (`tuitionfees`)
- **Khóa nghiệp vụ**: Hóa đơn học phí theo học sinh và kỳ thu (`studentId`, `period`).
- **Hệ thống Index hiện tại**:
  - Trong Schema (4 indexes query):
    1. `period_1`: `{ period: 1 }` (từ `index: true` trên path `period`).
    2. `classroomId_1`: `{ classroomId: 1 }`.
    3. `status_1`: `{ status: 1 }`.
    4. `dueDate_1`: `{ dueDate: 1 }`.
  - Trong `createIndexes.js`:
    - `['TuitionFee', { studentId: 1, period: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['unpaid', 'partial', 'paid'] } } }]`.
    - `['TuitionFee', { classroomId: 1, period: 1 }]`.
- **Ràng buộc Global Unique**: **KHÔNG**. Index duy nhất chỉ áp dụng trên cặp `(studentId, period)` để chống xuất trùng hóa đơn cho 1 học sinh trong 1 kỳ. Do `studentId` là ObjectId riêng của học sinh, không xảy ra va chạm chéo trường.
- **Tác động đa trường**: Cần `tenantId` để truy vấn danh sách hóa đơn theo trường và lập báo cáo tài chính không quét chéo.
- **Trường tham chiếu (References)**:
  - `tenantId` -> `Tenant`
  - `studentId` -> `Student`
  - `classroomId` -> `Classroom`
  - `cancelledBy` -> `User`
- **Index đề xuất tương lai (Task 1E.3)**:
  - SaaS Query Index: `{ tenantId: 1, period: 1, status: 1 }`.
  - Compound Unique Index: `{ tenantId: 1, studentId: 1, period: 1 }`, `unique: true`, `partialFilterExpression: { status: { $in: ['unpaid', 'partial', 'paid'] }, tenantId: { $type: 'objectId' } }`.

---

### 2.10. TuitionRefundRequest (`tuitionrefundrequests`)
- **Khóa nghiệp vụ**: Yêu cầu hoàn phí gắn với hóa đơn học phí (`invoiceId`).
- **Hệ thống Index hiện tại**:
  - Trong Schema (2 indexes):
    1. `invoiceId_1_createdAt_-1`: `{ invoiceId: 1, createdAt: -1 }`.
    2. `invoiceId_1`: `{ invoiceId: 1 }`, `unique: true`, `partialFilterExpression: { status: { $in: ['pending', 'approved'] } }`.
  - Trong `createIndexes.js`:
    - `['TuitionRefundRequest', { invoiceId: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['pending', 'approved'] } } }]`.
- **Ràng buộc Global Unique**: **KHÔNG**. Index duy nhất chỉ áp dụng trên `invoiceId` để ngăn chặn việc tạo 2 yêu cầu hoàn phí đang chờ xử lý trên cùng một hóa đơn.
- **Trường tham chiếu (References)**:
  - `tenantId` -> `Tenant`
  - `invoiceId` -> `TuitionFee`
  - `requestedBy` -> `User`
  - `reviewedBy` -> `User`
  - `adjustmentId` -> `InvoiceAdjustment`
  - `paidBy` -> `User`
- **Index đề xuất tương lai (Task 1E.4)**:
  - SaaS Query Index: `{ tenantId: 1, status: 1, createdAt: -1 }`.

---

## 3. PHÂN TÍCH RỦI RO CÁC TRƯỜNG MÃ TÙY CHỌN & CHÍNH SÁCH LOẠI TRỪ

### 3.1. Rà soát các trường mã tùy chọn
Phân hệ tài chính có 4 trường mã tùy chọn (optional codes) đang sử dụng hoặc liên quan tới `sparse`/`partial`:
1. `Payment.receiptNumber`: Mã biên lai thu tiền (không bắt buộc lúc khởi tạo hoặc khi thanh toán online tự động).
2. `Payment.txnRef`: Mã giao dịch ngân hàng / cổng thanh toán (chỉ có khi thanh toán qua ngân hàng/ví điện tử, thanh toán tiền mặt thì không có).
3. `PurchaseExpense.transactionRef`: Mã giao dịch chuyển khoản cho nhà cung cấp (chỉ có khi thanh toán ngân hàng).
4. `OperatingExpense.transactionRef`: Mã giao dịch chi phí vận hành (chỉ có khi chuyển khoản).

### 3.2. Vì sao MongoDB cấm kết hợp `sparse: true` và `partialFilterExpression`
Trong MongoDB:
- Thuộc tính `sparse: true` chỉ loại trừ các document hoàn toàn thiếu trường (missing field).
- `partialFilterExpression` là cơ chế lọc tài liệu nâng cao hơn.
- **MongoDB không cho phép khai báo đồng thời cả hai tùy chọn này trên cùng một index**. Nếu truyền cả `sparse: true` và `partialFilterExpression`, MongoDB sẽ ném lỗi ngay lập tức:
  `Cannot filter and use sparse index at the same time` hoặc lỗi cú pháp index.

### 3.3. Phân biệt hành vi index hiện hành (`sparse: true`) với chính sách loại trừ nâng cao
- **Hành vi của `sparse: true` hiện hành**:
  - Chỉ bỏ qua khi document **thiếu trường hoàn toàn** (key không tồn tại trong BSON document).
  - Nếu document được lưu với giá trị `null` (`{ receiptNumber: null }`) hoặc chuỗi rỗng (`{ receiptNumber: "" }`), MongoDB **vẫn lập chỉ mục** các giá trị đó!
  - Do đó, nếu có từ 2 document trở lên có giá trị `null` hoặc chuỗi rỗng `""`, `sparse unique index` sẽ lập tức ném lỗi trùng lặp E11000!
- **Hạn chế chết người nếu chỉ dùng `{ field: { $type: 'string' } }`**:
  - Chuỗi rỗng `""` có kiểu dữ liệu là `string` (`typeof "" === 'string'`).
  - Do đó, `{ receiptNumber: { $type: 'string' } }` vẫn lập chỉ mục chuỗi rỗng `""`.
  - Kết quả: **Mỗi tenant chỉ có thể tạo đúng 1 bản ghi có chuỗi rỗng `""`**. Bản ghi thứ hai có `""` sẽ bị lỗi E11000 chặn đứng!
- **Giải pháp chính sách loại trừ chuẩn xác: `{ field: { $gt: '' } }`**:
  - Trong thứ tự so sánh BSON của MongoDB: `MinKey < Null < Numbers < Symbol/String < Object < Array < BinData < ObjectId < Bool < Date < Timestamp < Regex < MaxKey`.
  - Chuỗi rỗng `""` là chuỗi nhỏ nhất trong kiểu String.
  - Do đó, điều kiện `{ receiptNumber: { $gt: '' } }` thỏa mãn đồng thời:
    1. **Loại trừ document thiếu trường** (missing field không thỏa mãn `$gt`).
    2. **Loại trừ document có giá trị `null`** (null nhỏ hơn string trong thứ tự BSON).
    3. **Loại trừ document có chuỗi rỗng `""`** (chuỗi rỗng không lớn hơn chính nó).
    4. **Chỉ lập chỉ mục các chuỗi có độ dài > 0** (ví dụ `"REC-001"`, `"TXN-998"`).

### 3.4. Bảng thiết kế Index chuẩn mực cho các trường mã tùy chọn

| Trường | Model | SaaS Index Keys | SaaS partialFilterExpression | Legacy Index Keys | Legacy partialFilterExpression |
|---|---|---|---|---|---|
| `receiptNumber` | `Payment` | `{ tenantId: 1, receiptNumber: 1 }` | `{ tenantId: { $type: 'objectId' }, receiptNumber: { $gt: '' } }` | `{ receiptNumber: 1 }` | `{ tenantId: null, receiptNumber: { $gt: '' } }` |
| `txnRef` | `Payment` | `{ tenantId: 1, txnRef: 1 }` | `{ tenantId: { $type: 'objectId' }, txnRef: { $gt: '' } }` | `{ txnRef: 1 }` | `{ tenantId: null, txnRef: { $gt: '' } }` |
| `transactionRef` | `PurchaseExpense` | `{ tenantId: 1, transactionRef: 1 }` | `{ tenantId: { $type: 'objectId' }, transactionRef: { $gt: '' } }` | `{ transactionRef: 1 }` | `{ tenantId: null, transactionRef: { $gt: '' } }` |
| `transactionRef` | `OperatingExpense` | `{ tenantId: 1, transactionRef: 1 }` | `{ tenantId: { $type: 'objectId' }, transactionRef: { $gt: '' } }` | `{ transactionRef: 1 }` | `{ tenantId: null, transactionRef: { $gt: '' } }` |

---

## 4. KẾT QUẢ THỬ NGHIỆM THỰC TẾ TRÊN MONGODB 8.2.6

> [!NOTE]
> **Phạm vi kiểm chứng PoC**: Thử nghiệm được thực hiện độc lập trên các collection tạm cô lập (`temp_saas_index_verification`, `temp_saas_receipt_verification`, `temp_saas_receipt_legacy_verification`, `temp_flawed_index_demo`) trong suite kiểm thử `backend/tests/saas/phase1e1_data_boundary.test.js`. Trường `receiptNumber` được kiểm chứng trực tiếp làm đại diện cho nhóm trường mã tùy chọn; các trường khác (`Payment.txnRef`, `PurchaseExpense.transactionRef`, `OperatingExpense.transactionRef`) là thiết kế đề xuất áp dụng nguyên lý tương tự. Kết quả PoC này chỉ chứng minh tính khả thi cú pháp và hành vi index trên MongoDB 8.2.6 trong môi trường test cô lập, tuyệt đối không được coi là bằng chứng đã hoàn tất migration trên cơ sở dữ liệu thật.

1. **Kiểm chứng mã bắt buộc (`docCode` / `documentNumber`)**:
   - Trường A và Trường B cùng dùng mã `PC-001` -> Thành công 100%.
   - Trùng mã `PC-001` trong cùng Trường A -> Bị chặn chính xác bởi index `tenantId_1_docCode_1_saas_unique` (E11000).
   - Dữ liệu Legacy trùng mã bị chặn bởi `docCode_1_legacy_unique`, không bị chặn chéo bởi SaaS.

2. **Kiểm chứng mã tùy chọn (`receiptNumber`) với cấu hình loại bỏ sparse, dùng `$gt: ''`**:
   - Đọc metadata index từ MongoDB:
     - `sparse` là `undefined` (hoàn toàn không có cờ sparse).
     - `partialFilterExpression` là `{ tenantId: { $type: 'objectId' }, receiptNumber: { $gt: '' } }`.
   - Tenant A tạo 2 document missing -> Thành công.
   - Tenant A tạo 2 document `null` -> Thành công.
   - Tenant A tạo 2 document chuỗi rỗng `""` -> Thành công.
   - Tenant B cũng tạo nhiều missing, null, empty -> Thành công.
   - Tenant A và B cùng dùng mã hợp lệ `REC-2026-001` -> Cả hai thành công.
   - Trùng mã `REC-2026-001` trong cùng Tenant A -> Bị chặn bởi đúng index `tenantId_1_receiptNumber_1_saas_unique` (E11000).

3. **Kiểm chứng mã tùy chọn Legacy**:
   - Legacy tạo nhiều document missing, null, empty -> Thành công.
   - Trùng mã hợp lệ `REC-LEG-001` trong Legacy -> Bị chặn bởi đúng index `receiptNumber_1_legacy_unique` (E11000).

4. **Kiểm chứng rủi ro cấu hình sai (Negative Verification)**:
   - Thử tạo index kết hợp `{ sparse: true, partialFilterExpression: ... }` -> MongoDB từ chối và ném lỗi cú pháp.
   - Thử tạo index chỉ dùng `{ txnRef: { $type: 'string' } }` (thiếu `$gt: ''`): Khi Tenant A tạo 2 document có `txnRef: ""`, document thứ hai lập tức bị lỗi E11000 duplicate key chặn đứng! Chứng minh việc bắt buộc phải dùng `$gt: ''`.

---

## 5. CƠ CHẾ BẢO VỆ RANH GIỚI DỮ LIỆU & FAIL-CLOSED

### 5.1. Triển khai và giới hạn của `FAIL_CLOSED_FILTER`
Trong `backend/src/services/tenantFilterService.js`, biểu thức `FAIL_CLOSED_FILTER` được định nghĩa như sau:
```javascript
const FAIL_CLOSED_FILTER = Object.freeze({
  _id: new mongoose.Types.ObjectId('000000000000000000000000'),
  tenantId: new mongoose.Types.ObjectId('000000000000000000000000')
});
```
- Khi context của request không hợp lệ (không có trusted symbol, bị giả mạo qua query/body HTTP, hoặc thiếu tenant), `buildTenantFilter` sẽ trả về `FAIL_CLOSED_FILTER`.
- **Bản chất kỹ thuật và giới hạn**:
  - Cặp giá trị `{ _id: ObjectId('00...00'), tenantId: ObjectId('00...00') }` đóng vai trò là một **sentinel filter** trong implementation hiện tại của hệ thống.
  - Tính chất không khớp tài liệu ("fail-closed") của filter này phụ thuộc hoàn toàn vào điều kiện dữ liệu thực tế không chứa document nào mang đúng cặp giá trị `_id` và `tenantId` toàn số 0 đó. Đây không phải là một điều kiện bất khả khớp ở cấp độ cú pháp engine MongoDB.
  - Giới hạn này được ghi nhận như một phụ thuộc hiện hữu của service dùng chung; không tự ý sửa đổi `tenantFilterService.js` trong phạm vi Task 1E.1.
  - Các ca kiểm thử trong suite 1E.1 chỉ chứng minh hành vi fail-closed trên tập fixture của môi trường test cô lập, không tuyên bố chứng minh an toàn tuyệt đối cho mọi trạng thái dữ liệu có thể tồn tại trong thực tế.

### 5.2. Cổng SaaS Mode (SaaS Mode Gate)
- Trong mode `phase1d`: Tất cả các router tài chính (`/finance/*`, `/accounting/*`, `/tuition/*`) đều trả về **HTTP 501** `MODULE_NOT_IMPLEMENTED_IN_PHASE_1A` cho cả hai tiền tố `/api/v1` và `/api`.
- Trong mode tương lai `phase1e`: Khi chưa tích hợp router ở Task 1E.5, hệ thống tiếp tục trả về **HTTP 501** fail-closed.

---

## 6. KẾ HOẠCH MIGRATION INDEX ĐỀ XUẤT VÀ ĐIỀU KIỆN ROLLBACK

> [!CAUTION]
> Mục này chỉ là **thiết kế định hướng**. Mọi thao tác áp dụng lên cơ sở dữ liệu thật bắt buộc phải có kế hoạch thực thi chi tiết và được phê duyệt riêng từ người điều phối (Codex) / người phụ trách hệ thống. Việc giao thực hiện các Task 1E.2–1E.5 **tuyệt đối không tự cấp quyền chạy migration** trên môi trường thật. Không đưa ra cam kết Zero-Downtime hoặc không block write khi chưa có kế hoạch bảo trì được phê duyệt chính thức.

### 6.1. Nguyên tắc chuẩn bị trước Cutover
1. **Không yêu cầu mặc định backfill `tenantId: null`**:
   - Thiết kế Compound Partial Index cho Legacy (`partialFilterExpression: { tenantId: null }`) đã bao phủ cả trường hợp document có `tenantId: null` lẫn trường hợp thiếu trường `tenantId` (missing field). Do đó, không chạy migration backfill gán cứng `tenantId: null` lên dữ liệu cũ một cách tùy tiện.
   - Việc gán `tenantId` của một trường cụ thể cho dữ liệu cũ phải dựa trên xác minh quyền sở hữu nghiệp vụ rõ ràng và được phê duyệt, tuyệt đối không suy đoán.
2. **Kiểm kê dữ liệu toàn diện trước cutover**:
   - Kiểm kê dữ liệu trùng lặp (duplicate) theo các khóa nghiệp vụ trong từng tenant.
   - Kiểm tra các bản ghi có trường mã bị missing, `null`, hoặc chuỗi rỗng `""`.
   - Rà soát các bản ghi có `tenantId` sai kiểu (ví dụ string thay vì ObjectId) để chuẩn hóa.
   - Kiểm kê toàn bộ các writer (tiến trình ghi nền, script import dữ liệu, hoặc cơ chế sync index tự động như `createIndexes.js`, `model.syncIndexes()`) có khả năng tự động tái tạo lại các index global cũ sau khi drop.
3. **Đối chiếu index thực tế với thiết kế**:
   - Sau khi tạo index mới, bắt buộc đối chiếu toàn diện thông qua metadata `db.collection.getIndexes()`:
     - Khóa index (`keyPattern`)
     - Cờ duy nhất (`unique: true`)
     - Biểu thức điều kiện (`partialFilterExpression`, ví dụ `{ $gt: '' }`, `$type`)
     - Tên index (`name`)
   - Không được chỉ nhìn nhận việc "index đã tồn tại" mà bỏ qua kiểm tra options và filter expression.
4. **Điều kiện để drop Global Index cũ**:
   - Chỉ được drop các index global cũ (ví dụ `month_1`, `workDate_1`, `documentNumber_1`) khi:
     1. Các index thay thế (SaaS compound partial index và Legacy partial index) đã sẵn sàng phục vụ truy vấn.
     2. Mọi đường ghi liên quan (API create, update, import, background queue) đã được cập nhật và kiểm chứng tuân thủ đúng hợp đồng `tenantId`.

### 6.2. Phân biệt kịch bản Rollback: Trước vs Sau khi Drop Global Index
- **Giai đoạn 1: Rollback TRƯỚC KHI drop Global Index cũ**:
  - Nếu quá trình build index mới thất bại hoặc phát hiện xung đột dữ liệu:
    1. Hủy bỏ index mới đang build hoặc drop index mới vừa tạo bằng lệnh `db.collection.dropIndex("index_moi_name")`.
    2. Toàn bộ hệ thống vẫn đang được bảo vệ bởi index global cũ, không làm thay đổi ranh giới dữ liệu hiện tại.
    3. Thu thập log lỗi xung đột và báo cáo để xử lý dữ liệu trước khi thử lại.
- **Giai đoạn 2: Rollback SAU KHI đã drop Global Index cũ và đã phát sinh trùng mã giữa các tenant**:
  - Khi index mới đã có hiệu lực, các trường A và B có thể đã tạo các bản ghi hợp lệ có cùng số chứng từ, cùng kỳ hoặc cùng mã biên lai (ví dụ cả Trường A và B đều tạo chứng từ `PC-2026-001`).
  - **CÁC HÀNH ĐỘNG TUYỆT ĐỐI BỊ CẤM**:
    - *Không tự ý khôi phục lại Global Unique Index cũ*: Lệnh tạo lại index global sẽ thất bại ngay lập tức với lỗi duplicate key E11000 và có thể làm crash tiến trình ứng dụng.
    - *Không tự ý sửa hoặc đổi mã chứng từ của các trường*: Vi phạm nghiêm trọng tính toàn vẹn chứng từ kế toán và sổ sách tài chính đã phát hành.
    - *Không tự ý restore backup cũ đè lên database*: Sẽ làm mất toàn bộ các giao dịch, hóa đơn, phiếu thu/chi mới phát sinh từ thời điểm backup đến thời điểm gặp sự cố.
  - **Quy trình xử lý sự cố chuẩn mực**:
    1. **Đóng băng ghi (Freeze writes)**: Tạm dừng các endpoint/tính năng ghi liên quan đến collection gặp sự cố để ngăn chặn phát sinh thêm xung đột.
    2. **Kiểm kê xung đột (Audit conflicts)**: Trích xuất toàn bộ các bản ghi trùng mã giữa các trường và xác định nguyên nhân gốc rễ (lỗi index, lỗi service, hay lỗi logic ứng dụng).
    3. **Ưu tiên giải pháp sửa tiến (Forward-Fix)**: Sửa cấu hình index hoặc cập nhật logic truy vấn trên code để khắc phục sự cố mà vẫn bảo toàn toàn vẹn dữ liệu đã ghi.
    4. **Phương án Migration / Restore (nếu bắt buộc)**: Phải lập kế hoạch chi tiết được Codex phê duyệt, bao gồm giải pháp trích xuất và bảo toàn các bản ghi phát sinh sau thời điểm backup trước khi thực hiện bất kỳ thao tác phục hồi dữ liệu nào.
