# Quyết định Kỹ thuật Chỉ mục (Index Decisions) — SaaS Phase 1D

**Tài liệu:** `docs/SAAS-PHASE-1D-INDEX-DECISIONS.md`  
**Giai đoạn:** SaaS Phase 1D.1 — Nền Dữ Liệu Nhân Sự & Phòng Ban Đa Trường  
**Dự án:** `school-management-api` (`E:\school-management-api`)  
**Ngày cập nhật:** 04/11/2026  
**Trạng thái:** Tài liệu kỹ thuật thiết kế & khảo sát thực nghiệm; Chưa thực hiện migration trên DB thật.

---

## 1. Mục Đích và Phạm Vi Tài Liệu

Tài liệu này xác lập cơ sở kỹ thuật và quy trình chuẩn bị cho việc chuyển đổi chỉ mục (index cutover) của phân hệ Nhân sự & Chấm công (`zone2_hr`) từ mô hình đơn trường (legacy single-tenant) sang mô hình đa trường (SaaS multi-tenant).

### Nguyên tắc bất biến của Task 1D.1:
1. **Bảo tồn nguyên trạng**: Không sửa đổi hoặc xóa bất kỳ index hiện hữu nào của 7 model HR trên codebase hoặc database phát triển/production trong Task 1D.1.
2. **Không tự ý né lỗi**: Không thêm tiền tố tenant (ví dụ `TENANTA_GV`) vào mã để vượt qua unique index toàn cục một cách giả tạo.
3. **Thực nghiệm chính xác**: Mọi kết luận về cú pháp MongoDB partial index và hành vi BSON đều phải được kiểm chứng thực tế trên WiredTiger engine trong môi trường kiểm thử cô lập (`MongoMemoryReplSet`).

---

## 2. Phần A — Hiện Trạng Chỉ Mục Thực Tế Của 7 Mô Hình HR

Dưới đây là bảng hiện trạng chỉ mục được đọc trực tiếp từ schema Mongoose và kiểm tra thực tế trong runtime qua `collection.indexes()` trên `MongoMemoryReplSet`:

| Mô hình (Model) | Collection | Tên Index Thực Tế | Khóa Index (Key Pattern) | Thuộc Tính (Options) | Ý Nghĩa Nghiệp Vụ |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Department** | `departments` | `_id_` | `{ _id: 1 }` | `unique: true` | Khóa chính tự sinh MongoDB. |
| | | `code_1` | `{ code: 1 }` | `unique: true` **(Global Unique)** | Mã phòng ban duy nhất trên toàn hệ thống (ví dụ: `BGH`, `KT`, `GV`). |
| | | `status_1` | `{ status: 1 }` | Thường | Lọc danh sách phòng ban theo trạng thái (`active`/`inactive`). |
| **Employee** | `employees` | `_id_` | `{ _id: 1 }` | `unique: true` | Khóa chính tự sinh MongoDB. |
| | | `employeeCode_1` | `{ employeeCode: 1 }` | `unique: true` **(Global Unique)** | Mã nhân viên duy nhất toàn hệ thống (ví dụ: `NV001`, `GV010`). |
| | | `departmentId_1` | `{ departmentId: 1 }` | Thường | Truy vấn danh sách nhân viên trực thuộc phòng ban. |
| | | `userId_1` | `{ userId: 1 }` | `unique: true, sparse: true` | Liên kết 1-1 giữa hồ sơ nhân viên và tài khoản người dùng; cho phép nhân viên chưa cấp tài khoản (`userId: null`/missing). |
| | | `status_1` | `{ status: 1 }` | Thường | Lọc trạng thái nhân sự (`active`, `probation`, `resigned`, v.v.). |
| | | `position_1` | `{ position: 1 }` | Thường | Lọc theo vị trí công tác (`teacher`, `accountant`, `driver`, v.v.). |
| | | `payrollRole_1_status_1` | `{ payrollRole: 1, status: 1 }` | Compound thường | Tối ưu hóa tính lương theo vai trò tính lương và trạng thái làm việc. |
| **LeaveRequest** | `leaverequests` | `_id_` | `{ _id: 1 }` | `unique: true` | Khóa chính tự sinh MongoDB. |
| | | `employeeId_1_status_1` | `{ employeeId: 1, status: 1 }` | Compound thường | Lọc đơn xin nghỉ phép của từng nhân viên theo trạng thái duyệt (`pending`, `approved`, `rejected`). |
| | | `startDate_1_endDate_1` | `{ startDate: 1, endDate: 1 }` | Compound thường | Truy vấn và kiểm tra trùng lặp khoảng thời gian nghỉ phép. |
| | | `status_1` | `{ status: 1 }` | Thường | Quản lý luồng duyệt đơn toàn trường. |
| **StaffShift** | `staffshifts` | `_id_` | `{ _id: 1 }` | `unique: true` | Khóa chính tự sinh MongoDB. |
| | | `employeeId_1_status_1_validFrom_1_validUntil_1` | `{ employeeId: 1, status: 1, validFrom: 1, validUntil: 1 }` | Compound thường | Tìm ca làm việc hiệu lực của nhân viên theo mốc thời gian. |
| **StaffReplacement** | `staffreplacements` | `_id_` | `{ _id: 1 }` | `unique: true` | Khóa chính tự sinh MongoDB. |
| | | `date_1_kind_1_classroomId_1_shiftId_1_absentEmployeeId_1` | `{ date: 1, kind: 1, classroomId: 1, shiftId: 1, absentEmployeeId: 1 }` | `unique: true`, `partialFilterExpression: { status: 'active' }` | **Partial Index 1**: Trong một ngày và lớp/ca, một nhân viên vắng mặt chỉ được có 1 người dạy/làm thay đang hoạt động. |
| | | `date_1_replacementEmployeeId_1` | `{ date: 1, replacementEmployeeId: 1 }` | `unique: true`, `partialFilterExpression: { status: 'active' }` | **Partial Index 2**: Trong một ngày, một nhân viên thay thế không thể nhận trùng 2 nhiệm vụ làm thay đang hoạt động. |
| **AttendanceRecord** | `attendancerecords` | `_id_` | `{ _id: 1 }` | `unique: true` | Khóa chính tự sinh MongoDB. |
| | | `userId_1_workDate_1` | `{ userId: 1, workDate: 1 }` | `unique: true` | Mỗi tài khoản người dùng chỉ có đúng 1 bản ghi điểm danh/chấm công trong 1 ngày làm việc. |
| **MonthlyTimesheet** | `monthlytimesheets` | `_id_` | `{ _id: 1 }` | `unique: true` | Khóa chính tự sinh MongoDB. Kèm `optimisticConcurrency: true` trên schema (`__v`). |
| | | `employeeId_1_period_1` | `{ employeeId: 1, period: 1 }` | `unique: true` | Mỗi nhân viên chỉ có đúng 1 bảng tổng hợp công cho mỗi kỳ (tháng) tính công (`period`: YYYY-MM). |
| | | `userId_1_period_-1` | `{ userId: 1, period: -1 }` | Compound thường | Hỗ trợ người dùng tra cứu lịch sử bảng công cá nhân theo thứ tự thời gian giảm dần. |

---

## 3. Phần B — Đánh Giá Tác Động Khi Vận Hành Đa Trường (SaaS Impact Analysis)

### 3.1. Va chạm chỉ mục mã phòng ban (`Department.code_1`)
- **Phân tích xung đột**: Chỉ mục `code_1` hiện tại là **toàn cục (global unique)**. Theo nghiệp vụ mầm non thực tế, hầu hết mọi trường học đều thiết lập các tổ/phòng ban với mã chuẩn hóa tương đương: `BGH` (Ban Giám Hiệu), `GV` (Tổ Giáo Viên), `KT` (Tổ Kế Toán), `NV` (Tổ Nuôi Dưỡng / Phục Vụ).
- **Hậu quả thực tế**: Ngay khi Trường A (Tenant A) tạo phòng ban `GV`, Trường B (Tenant B) tạo phòng ban `GV` sẽ lập tức bị MongoDB chặn với lỗi `E11000 duplicate key error: dup key: { code: "GV" }`.
- **Hiện trạng Task 1D.1**: Giới hạn này được bảo toàn và chứng minh bằng bài kiểm thử `D.1` trong file `phase1d1_data_boundary.test.js`.

### 3.2. Va chạm chỉ mục mã nhân sự (`Employee.employeeCode_1`)
- **Phân tích xung đột**: Chỉ mục `employeeCode_1` hiện tại là **toàn cục (global unique)**. Các trường mầm non độc lập thường sử dụng quy tắc đặt mã nhân sự bắt đầu từ các số thứ tự cơ bản như `GV001`, `GV002`, `NV001`, `KT001`.
- **Hậu quả thực tế**: Trường B không thể tạo nhân viên mang mã `GV001` nếu Trường A đã sử dụng mã này, dù hai nhân viên thuộc hai pháp nhân trường học hoàn toàn khác nhau.
- **Hiện trạng Task 1D.1**: Giới hạn này được bảo toàn và chứng minh bằng bài kiểm thử `D.2` trong file `phase1d1_data_boundary.test.js`.

### 3.3. Các chỉ mục dựa trên `ObjectId` (`User._id`, `Employee._id`, `Classroom._id`)
- **Phân tích an toàn va chạm tự nhiên**:
  - `Employee.userId_1` (`unique: true, sparse: true`): Khóa ngoại `userId` tham chiếu đến `User._id` (UUID/ObjectId ngẫu nhiên toàn cục). Vì mỗi tài khoản `User` chỉ thuộc về 1 trường duy nhất (hoặc legacy), không thể xảy ra va chạm ngẫu nhiên giữa các tenant.
  - `AttendanceRecord.userId_1_workDate_1` (`unique: true`): Dựa trên `userId` (ObjectId), không bị trùng lặp chéo trường.
  - `MonthlyTimesheet.employeeId_1_period_1` (`unique: true`): Dựa trên `employeeId` (ObjectId), không bị trùng lặp chéo trường.
  - `StaffReplacement`: Hai partial unique index dựa trên các cặp `ObjectId` (`absentEmployeeId`, `replacementEmployeeId`, `classroomId`, `shiftId`), không phát sinh va chạm ngẫu nhiên giữa các tenant.
- **Rủi ro rò rỉ chéo tenant (Cross-Tenant Referential Integrity)**:
  - MongoDB và Mongoose không kiểm tra ràng buộc khóa ngoại (foreign key constraint) ở tầng database.
  - Nếu tầng Controller/Service không thẩm tra `tenantId` của các thực thể liên quan (ví dụ: gán `replacementEmployeeId` của Trường A cho ca trực của Trường B), database vẫn chấp nhận lưu nếu các ObjectId hợp lệ.
  - **Kết luận**: Bài toán toàn vẹn dữ liệu cho các model này sẽ được giải quyết triệt để tại tầng Service Scoping ở các Task **1D.3 (HR Scoping)** và **1D.4 (Timekeeping Scoping)**.

---

## 4. Phần C — Thiết Kế Chuyển Đổi Index Cho Các Task Sau (1D.2 – 1D.5)

Để hỗ trợ đầy đủ các thao tác ghi (CRUD) độc lập cho từng tenant mà vẫn bảo đảm 100% tính toàn vẹn dữ liệu cho các bản ghi legacy hiện hữu:

### 4.1. Thiết kế Chỉ mục cho SaaS Multi-Tenant (Compound Partial Unique)
Áp dụng cho các trường hợp mã cần duy nhất trong từng trường học:
1. **Department**:
   ```javascript
   DepartmentSchema.index(
     { tenantId: 1, code: 1 },
     {
       name: 'tenantId_1_code_1',
       unique: true,
       partialFilterExpression: { tenantId: { $type: 'objectId' } }
     }
   );
   ```
2. **Employee**:
   ```javascript
   EmployeeSchema.index(
     { tenantId: 1, employeeCode: 1 },
     {
       name: 'tenantId_1_employeeCode_1',
       unique: true,
       partialFilterExpression: { tenantId: { $type: 'objectId' } }
     }
   );
   ```
*Đặc tính kỹ thuật:* Chỉ mục này chỉ đánh chỉ mục các document có `tenantId` là kiểu `ObjectId`. Các bản ghi legacy (`tenantId: null` hoặc không có `tenantId`) sẽ hoàn toàn bị bỏ qua, không gây va chạm.

---

### 4.2. Phân Tích Kỹ Thuật: Hạn Chế Cú Pháp MongoDB Partial Filter & Giải Pháp Cho Dữ Liệu Legacy

#### a) Vấn đề cú pháp: Phân tích nguyên nhân lỗi Code 67 của mẫu chứa `$exists: false` và vai trò của `$or`
Khi thử nghiệm tạo index legacy với biểu thức kết hợp chứa `$exists: false` (ví dụ: `partialFilterExpression: { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] }` hoặc `{ tenantId: { $exists: false } }`), MongoDB từ chối và trả về lỗi:
```text
MongoServerError: Error in specification ... :: caused by :: Expression not supported in partial index: $not tenantId exists
Code: 67, codeName: 'CannotCreateIndex'
```
**Giải thích chính xác theo tài liệu chính thức của MongoDB ([MongoDB Manual - Partial Indexes](https://www.mongodb.com/docs/manual/core/index-partial/))**:
1. Toán tử logic `$or` **được MongoDB hỗ trợ chính thức** trong `partialFilterExpression` (cùng với `$and`, `$in`, `$gt`, `$gte`, `$lt`, `$lte`, `$type`, `$exists: true`, và so sánh đẳng thức).
2. Lỗi `CannotCreateIndex` (Code 67) xảy ra **không phải do toán tử `$or` bị cấm**, mà nguyên nhân cốt lõi là do mệnh đề con `{ tenantId: { $exists: false } }`.
3. Trong engine MongoDB:
   - Biểu thức `{ field: { $exists: false } }` được biểu diễn nội bộ dưới dạng phủ định `$not: { field: { $exists: true } }`.
   - Toán tử `$not` hoàn toàn không nằm trong danh mục toán tử được hỗ trợ của `partialFilterExpression`.
   - Do đó, bất kỳ biểu thức nào chứa `{ $exists: false }` đều sẽ kích hoạt lỗi `Expression not supported in partial index: $not tenantId exists`.
4. Ngoài ra, biểu thức mảng kiểu dữ liệu `$type: ['null', 'missing']` cũng không hợp lệ vì `'missing'` không phải là một BSON type name được chấp nhận trong truy vấn `$type`.

#### b) Kết quả thử nghiệm thực tế với `{ tenantId: null }` và Lưu ý phân định thiết kế
Theo chuẩn ngữ nghĩa so sánh BSON của MongoDB:
Biểu thức so sánh đẳng thức `{ tenantId: null }` khớp với cả hai trường hợp:
1. Document có trường `tenantId` với giá trị tường minh là `null`.
2. Document hoàn toàn **không có trường `tenantId`** (missing/undefined).

**Kết quả kiểm chứng thực nghiệm trên WiredTiger (`MongoMemoryReplSet` Node.js v24 + MongoDB 8.2.6)**:
- Thử nghiệm tạo index: `{ code: 1 }` với `partialFilterExpression: { tenantId: null }` -> **Thành công (Code: OK)**.
- Thử nghiệm chèn document 1 (missing `tenantId`): `{ code: "KT" }` -> Được index thành công.
- Thử nghiệm chèn document 2 (null `tenantId`): `{ code: "KT", tenantId: null }` -> **Bị chặn chính xác bởi E11000** (`dup key: { code: "KT" }`).
- Thử nghiệm chèn document 3 (missing `tenantId`): `{ code: "KT" }` -> **Bị chặn chính xác bởi E11000**.
- Thử nghiệm chèn document 4 (SaaS `tenantId: ObjectId`): `{ code: "KT", tenantId: ObjectId(...) }` -> **Thành công, bỏ qua index legacy**.

> [!IMPORTANT]
> **Phân định rõ ràng giữa Kết quả thử nghiệm và Trạng thái triển khai**:
> - Các cấu hình chỉ mục SaaS `{ tenantId: 1, code: 1 }` và legacy `{ code: 1 }` với `partialFilterExpression: { tenantId: null }` nêu trên là **kết quả khảo sát thực nghiệm và đề xuất thiết kế kỹ thuật cho các giai đoạn tiếp theo (1D.2 – 1D.5)**.
> - Task 1D.1 đã bổ sung trường tenantId vào 7 schema HR, nhưng chưa thay đổi khai báo index trong schema, chưa thay đổi index trên database thật và chưa chạy migration.
> - Ý nghĩa của khảo sát: Khẳng định khi triển khai ở phase sau, giải pháp dùng `{ tenantId: null }` sẽ không yêu cầu chạy migration ghi đè `tenantId: null` vào dữ liệu legacy cũ, vì MongoDB tự động bao phủ cả document thiếu trường `tenantId`.

**Đề xuất cấu hình chỉ mục legacy cho giai đoạn sau (chưa triển khai ở 1D.1)**:
```javascript
// Dành cho Department (thiết kế giai đoạn sau)
DepartmentSchema.index(
  { code: 1 },
  {
    name: 'legacy_code_1',
    unique: true,
    partialFilterExpression: { tenantId: null }
  }
);

// Dành cho Employee (thiết kế giai đoạn sau)
EmployeeSchema.index(
  { employeeCode: 1 },
  {
    name: 'legacy_employeeCode_1',
    unique: true,
    partialFilterExpression: { tenantId: null }
  }
);
```

---

## 5. Phần D — Quy Trình Chuyển Đổi Index An Toàn (Safe Cutover Procedure)

### 5.1. Điều kiện tiên quyết trước khi thực hiện chuyển đổi
1. Bản sao lưu cơ sở dữ liệu (Full Database Backup / Snapshot) đã hoàn tất và được xác thực khả năng phục hồi.
2. Không có tiến trình import nhân sự hoặc thay đổi cơ cấu phòng ban đang diễn ra trong thời gian chuyển đổi.
3. Không bắt đầu chuyển đổi nếu test suite liên quan chưa đạt 100% pass trên môi trường staging.

### 5.2. Kiểm tra trùng lặp dữ liệu trước khi tạo index (Pre-Migration Duplicate Detection)
Trước khi tạo bất kỳ index unique nào, phải chạy các câu lệnh aggregation để rà soát:
```javascript
// 1. Kiểm tra trùng lặp mã phòng ban trong dữ liệu legacy
db.departments.aggregate([
  { $match: { $or: [{ tenantId: null }, { tenantId: { $exists: false } }] } },
  { $group: { _id: "$code", count: { $sum: 1 }, ids: { $push: "$_id" } } },
  { $match: { count: { $gt: 1 } } }
]);

// 2. Kiểm tra trùng lặp mã nhân viên trong dữ liệu legacy
db.employees.aggregate([
  { $match: { $or: [{ tenantId: null }, { tenantId: { $exists: false } }] } },
  { $group: { _id: "$employeeCode", count: { $sum: 1 }, ids: { $push: "$_id" } } },
  { $match: { count: { $gt: 1 } } }
]);

// 3. Kiểm tra trùng lặp mã nội bộ trong từng tenant (nếu đã có dữ liệu SaaS thử nghiệm)
db.departments.aggregate([
  { $match: { tenantId: { $type: "objectId" } } },
  { $group: { _id: { tenantId: "$tenantId", code: "$code" }, count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } }
]);
```
**Điều kiện dừng khẩn cấp**: Nếu bất kỳ câu lệnh aggregation nào trả về kết quả (`count > 1`), quy trình migration phải **dừng lập tức**. Cần làm sạch dữ liệu trước khi chuyển sang bước tạo index.

---

### 5.3. Trình tự thực thi chuyển đổi (Execution Cutover Sequence)

> [!CAUTION]
> **Quy tắc cốt tử**: TUYỆT ĐỐI KHÔNG xóa index cũ (`code_1`, `employeeCode_1`) trước khi các index mới (cả SaaS và Legacy) đã được khởi tạo hoàn tất và xác minh tính hợp lệ trên runtime.

Thứ tự thực hiện nghiêm ngặt qua 5 bước:

```text
[Bước 1: Tạo Index SaaS Mới]
       │
       ▼
[Bước 2: Tạo Index Legacy Mới]
       │
       ▼
[Bước 3: Xác minh Runtime qua listIndexes()]
       │
       ▼
[Bước 4: Kiểm thử Va chạm Thử nghiệm có Kiểm soát]
       │
       ▼
[Bước 5: Xóa (Drop) Index Global Cũ]
```

1. **Bước 1 — Tạo Index SaaS Mới**:
   - Tạo `tenantId_1_code_1` trên `departments` với `partialFilterExpression: { tenantId: { $type: 'objectId' } }`.
   - Tạo `tenantId_1_employeeCode_1` trên `employees` với `partialFilterExpression: { tenantId: { $type: 'objectId' } }`.
2. **Bước 2 — Tạo Index Legacy Mới**:
   - Tạo `legacy_code_1` trên `departments` với `partialFilterExpression: { tenantId: null }`.
   - Tạo `legacy_employeeCode_1` trên `employees` với `partialFilterExpression: { tenantId: null }`.
3. **Bước 3 — Xác minh Runtime qua `listIndexes()`**:
   - **Lưu ý kỹ thuật**: Tùy chọn `background: true` đã bị **deprecated và hoàn toàn bị bỏ qua từ MongoDB 4.2+** (WiredTiger sử dụng cơ chế build index tối ưu không khóa đọc/ghi kéo dài). Do đó, script migration **không được dựa vào `background: true`** để giả định trạng thái hoàn tất.
   - Script phải gọi `await collection.indexes()` hoặc `db.collection.listIndexes()` để xác nhận:
     * Tên index tồn tại.
     * Thuộc tính `unique: true`.
     * Biểu thức `partialFilterExpression` chính xác từng trường.
4. **Bước 4 — Kiểm thử Va chạm Thử nghiệm có Kiểm soát**:
   - Thử nghiệm chèn một bản ghi trùng lặp giả định trong transaction kiểm tra để xác nhận lỗi `E11000` được ném ra từ đúng tên index mới (`legacy_code_1` hoặc `tenantId_1_code_1`).
5. **Bước 5 — Xóa (Drop) Index Global Cũ**:
   - Sau khi cả 4 bước trên thành công 100%, tiến hành drop index global cũ:
     * `await db.collection('departments').dropIndex('code_1');`
     * `await db.collection('employees').dropIndex('employeeCode_1');`

---

## 6. Phần E — Kế Hoạch Phục Hồi Hai Giai Đoạn (Two-Phase Rollback Strategy)

Do đặc thù của index duy nhất (unique index), chiến lược rollback trước và sau khi drop index cũ hoàn toàn khác nhau về bản chất:

```
                                    Thời điểm Cutover (Drop index global cũ)
                                                   │
                Giai đoạn 1                        │                    Giai đoạn 2
            (Trước khi drop index cũ)              │              (Sau khi hệ thống chạy đa trường)
  ─────────────────────────────────────────────────┼─────────────────────────────────────────────────►
  • Chỉ cần drop các index mới dở dang.            │ • KHÔNG THỂ recreate lại index global unique nếu
  • Index cũ vẫn bảo vệ tính toàn vẹn.             │   đã có dữ liệu trùng mã giữa các tenant.
  • Không làm mất hay sai lệch dữ liệu.            │ • Cần: Đóng băng ghi, rà soát trùng lặp,
                                                   │   giải quyết xung đột hoặc forward-fix.
```

### 6.1. Giai đoạn 1 — Rollback Trước Khi Drop Index Cũ (Pre-Cutover Rollback)
- **Hoàn cảnh kích hoạt**: Quá trình tạo index mới ở Bước 1, 2, 3 hoặc 4 gặp sự cố (ví dụ timeout, vi phạm ràng buộc dữ liệu, lỗi cú pháp hoặc driver).
- **Trạng thái an toàn**: Index global cũ `code_1` và `employeeCode_1` vẫn đang tồn tại và duy trì tính toàn vẹn cho dữ liệu legacy.
- **Biện pháp rollback**:
  1. Hủy bỏ tác vụ tạo index đang thực thi.
  2. Xóa các index mới vừa tạo nếu có:
     ```javascript
     await db.collection('departments').dropIndex('tenantId_1_code_1').catch(() => {});
     await db.collection('departments').dropIndex('legacy_code_1').catch(() => {});
     await db.collection('employees').dropIndex('tenantId_1_employeeCode_1').catch(() => {});
     await db.collection('employees').dropIndex('legacy_employeeCode_1').catch(() => {});
     ```
  3. Hệ thống giữ nguyên trạng thái đơn trường ban đầu mà không bị gián đoạn hay mất dữ liệu.

### 6.2. Giai đoạn 2 — Rollback Sau Khi Đã Drop Index Cũ và Hệ Thống Đã Vận Hành SaaS Đa Trường (Post-Cutover Rollback)

#### a) Bản chất rủi ro kỹ thuật: Tại sao KHÔNG THỂ rollback đơn giản bằng cách tạo lại index global unique?
Khi hệ thống đã mở cho các trường SaaS hoạt động:
- Trường A đã tạo phòng ban `code: "GV"`.
- Trường B cũng đã tạo phòng ban `code: "GV"`.
- Cả hai bản ghi này đều hợp lệ dưới index mới `{ tenantId: 1, code: 1 }`.

Nếu tại thời điểm này xuất hiện sự cố và đội ngũ kỹ thuật muốn "rollback" bằng cách gọi lệnh:
```javascript
db.departments.createIndex({ code: 1 }, { unique: true });
```
Lệnh trên **CHẮC CHẮN SẼ THẤT BẠI** với mã lỗi `E11000 duplicate key error`:
```text
MongoServerError: E11000 duplicate key error collection: school_db.departments index: code_1 dup key: { code: "GV" }
```
MongoDB sẽ từ chối tạo index unique toàn cục chừng nào trong collection vẫn còn ít nhất 2 document mang cùng một giá trị `code`.

#### b) Quy trình xử lý thực tế khi cần rollback ở Giai đoạn 2:
1. **Đóng băng ghi nghiệp vụ (Freeze Writes)**:
   - Kích hoạt chế độ bảo trì hoặc chuyển các endpoint HR sang chế độ chỉ đọc (read-only) để ngăn việc tạo thêm dữ liệu mới.
2. **Kiểm kê và phân loại xung đột dữ liệu (Collision Inventory)**:
   - Chạy query aggregation kiểm tra danh sách toàn bộ các mã đang bị trùng lặp giữa các tenant.
3. **Thứ tự ưu tiên và nguyên tắc xử lý**:
   - **Ưu tiên 1 — Sửa tiến về trước (Forward-Fix tại Application/Service Layer)**:
     * Nếu sự cố phát sinh do logic điều hướng hoặc xử lý tại service layer, giữ nguyên cấu trúc index compound và áp dụng bản vá lỗi mã nguồn (hotfix/patch) tại tầng ứng dụng. Đây là phương án khuyến nghị hàng đầu vì bảo toàn 100% tính nguyên vẹn của dữ liệu người dùng đã sinh ra và không làm xáo trộn cấu trúc dữ liệu.
   - **Ưu tiên 2 — Kế hoạch xử lý dữ liệu và khôi phục index theo quy trình phê duyệt riêng**:
     * Tuyệt đối **KHÔNG tự ý chạy script thêm tiền tố (prefix) vào `Department.code` hoặc `Employee.employeeCode` theo cách mặc định**, vì đây là thay đổi trực tiếp lên dữ liệu định danh nghiệp vụ của các trường học.
     * Mọi can thiệp vào dữ liệu (như đổi mã, chuẩn hóa mã hoặc di chuyển dữ liệu tenant) và việc khôi phục index toàn cục (global unique) bắt buộc phải tuân theo kế hoạch migration chi tiết, được đánh giá rủi ro tác động nghiệp vụ và có sự phê duyệt riêng của các bên liên quan trước khi thực hiện.

---

## 7. Phần F — Trạng Thái Sẵn Sàng và Các Phụ Thuộc Của Task 1D.1

| Hạng Mục | Trạng Thái | Chi Tiết Kỹ Thuật |
| :--- | :---: | :--- |
| **Schema 7 Model HR** | **SẴN SÀNG** | Đã bổ sung trường `tenantId` (kiểu `ObjectId`, ref `'Tenant'`, optional, top-level, không tự sinh single index) vào đúng 7 model: `Department`, `Employee`, `LeaveRequest`, `StaffShift`, `StaffReplacement`, `AttendanceRecord`, `MonthlyTimesheet`. |
| **Bảo toàn Index Hiện Có** | **SẴN SÀNG** | Toàn bộ index cũ, validation, timestamp, enum, default và concurrency control của 7 model được giữ nguyên vẹn 100%. |
| **Kiểm thử Giới hạn Toàn Cục** | **SẴN SÀNG** | Nhóm D đã tái hiện trung thực lỗi `E11000` trên `code_1` và `employeeCode_1` khi hai tenant dùng chung mã. |
| **Kiểm thử Độc lập StaffReplacement** | **SẴN SÀNG** | Nhóm C đã tách riêng và chứng minh độc lập 2 partial unique index khi `status: 'active'`. |
| **Khóa Fail-Closed Router** | **SẴN SÀNG** | 4 endpoint đại diện được kiểm thử trong Nhóm E (`GET /api/v1/hr/departments`, `GET /api/v1/hr/employees`, `GET /api/v1/timekeeping/daily`, `POST /api/v1/system/accounts`) tiếp tục trả về **HTTP 501 Not Implemented** (`MODULE_NOT_IMPLEMENTED_IN_PHASE_1A`) trong chế độ kiểm thử SaaS của Task 1D.1. |
| **Phụ thuộc chưa giải quyết (Chờ 1D.2 – 1D.5)** | **CHƯA MỞ** | 1. Chưa mở router SaaS HR.<br>2. Chưa tạo tài khoản trường học đa tenant.<br>3. Chưa thay đổi index trên database thật.<br>4. Chưa triển khai controller/service scoping cho nghiệp vụ HR. |
