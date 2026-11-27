# Hướng dẫn Tra cứu Tài liệu API (Swagger) & Cơ sở dữ liệu (Database)

Tài liệu kỹ thuật toàn diện của dự án `school-management-api` được tích hợp trực tiếp vào máy chủ Backend theo chuẩn **OpenAPI 3.0.3**.

---

## 1. Các đường dẫn truy cập khi chạy máy chủ (`npm start` / `npm run dev`)

| Đường dẫn | Mục đích sử dụng |
| :--- | :--- |
| **`http://localhost:5001/api-docs`** *(hoặc `/api/docs`)* | Giao diện **Swagger UI** trực quan: tra cứu toàn bộ API theo 15 nhóm nghiệp vụ, tìm kiếm nhanh (`Filter`), gắn JWT Token (`Authorize`), bấm gọi thử (`Try it out`) và xem chi tiết toàn bộ 74 bảng MongoDB ở mục **Schemas** cuối trang. |
| **`http://localhost:5001/api-docs.json`** *(hoặc `/api/openapi.json`)* | Tập tin đặc tả **OpenAPI 3.0.3 JSON** thô để Import 1 chạm vào **Postman**, **Insomnia**, **Apidog** hoặc trình sinh mã TypeScript/Mobile. |
| **`http://localhost:5001/api/docs/database`** | API trả về **Từ điển Cơ sở dữ liệu 7 Phân vùng (Database Dictionary)** dạng JSON gồm danh sách bảng vật lý (`collectionName`), số trường, khóa ngoại (`ref`) liên kết giữa các bảng và danh sách `Indexes` (bao gồm các compound unique index cách ly `tenantId`). |

---

## 2. Cấu trúc 7 Phân vùng Cơ sở dữ liệu (`backend/src/models/`)

1. **`zone1_system` (Hệ thống & Đa trường)**: `Tenant` (Trường & danh mục Phân hiệu `campuses`), `PlatformAdmin` (Admin Tổng), `User` (Nhân sự nội bộ & Phụ huynh), `Permission`, `Notification`, `Conversation`, `ChatMessage`, `AuditLog`, `PlatformAuditLog`...
2. **`zone2_hr` (Nhân sự, Chấm công & Tiền lương)**: `Employee`, `Department`, `AttendanceRecord`, `TimekeepingDevice`, `TimekeepingCorrectionRequest`, `LeaveRequest`, `Payroll`, `StaffReplacement`, `StaffShift`...
3. **`zone3_school` (Học sinh, Lớp học, Điểm danh & Đón trả)**: `Classroom` (từ `6-12m` đến `5-6` tuổi), `Student` (Phụ huynh 1+2, `healthInsuranceCode`, `bloodType`, `vaccinations`, `growthRecords`, `authorizedPickers`), `StudentAttendance`, `StudentLeaveRequest`, `PickupRecord`, `PickupOtpChallenge`, `StudentGateEvent`...
4. **`zone4_finance` (Tài chính, Học phí & Kế toán)**: `FeeSchedule`, `TuitionFee`, `Payment`, `InvoiceAdjustment`, `TuitionRefundRequest`, `PurchaseExpense`, `OperatingExpense`, `AccountingPeriod`, `DailyCashReconciliation`...
5. **`zone5_nutrition` (Bếp ăn & An toàn Thực phẩm)**: `Dish`, `IngredientMaster`, `Menu`, `MealServing`, `FoodSample`, `FoodInspection`, `Inventory`, `InventoryTransaction`, `Supplier`...
6. **`zone6_procurement` (Mua sắm & Cơ sở vật chất)**: `Asset`, `ItemMaster`, `ProcurementRequest`, `PurchaseOrder`.
7. **`zone7_reporting` (Báo cáo Điều hành)**: `Report`.

---

## 3. Cơ chế Tự động Đồng bộ Database Schema cho Lập trình viên Kế thừa

- Bộ chuyển đổi [`mongooseSchemaConverter.js`](../src/docs/mongooseSchemaConverter.js) tự động đọc trực tiếp tất cả Mongoose Models trong 7 thư mục `zone1_system` → `zone7_reporting` khi mở tài liệu.
- Khi lập trình viên thêm trường mới hoặc bảng mới vào `backend/src/models/`, mục **Schemas (`DB_<ModelName>`)** và API `/api/docs/database` sẽ **tự động cập nhật kiểu dữ liệu, `enum`, `required`, khóa ngoại `ref` và `Indexes`** mà không sợ tài liệu bị lệch so với code thực tế.
- Các trường nhạy cảm (`passwordHash`, `secret`, `apiKeyHash`, `otpHash`) được tự động đánh dấu `writeOnly: true` để lập trình viên biết rõ cột tồn tại dưới DB nhưng không bao giờ lộ ra qua API trả về.

