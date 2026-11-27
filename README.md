# Hệ thống Quản lý Trường Mầm non Đa Trường & Đa Phân hiệu (`school-management-api`)

Nền tảng quản trị toàn diện dành cho **Chuỗi Trường Mầm non & Cơ sở Giáo dục Mầm non (nhận trẻ từ 6 tháng đến 6 tuổi)** theo kiến trúc **SaaS Multi-Tenant & Unified Full-Stack** (chạy đồng nhất cả Giao diện Web React 19 lẫn API Express 5 trên một cổng duy nhất **`5001`**).

---

## 1. Điểm nổi bật của Hệ thống

- **Kiến trúc Đa Trường & Đa Phân hiệu thực tế**:
  - **Admin Tổng Đa Trường (`PlatformAdmin`)**: Khởi tạo tự động tài khoản `admin` / `123456` khi Database mới tinh (đăng nhập để trống ô *Mã trường*). Chủ động tạo từng trường học độc lập (`Tenant`), chia tách nhiều Phân hiệu (`Campuses`), cấp tài khoản Admin riêng cho từng trường và chuyển ngữ cảnh điều hành từng trường trong 1 chạm.
  - **Cách ly dữ liệu tuyệt đối (`tenantId`)**: Mọi truy vấn đọc/ghi và chỉ mục duy nhất (`Compound Unique Index`) đều gắn chặt với `tenantId` lấy từ JWT Token đã xác thực.
- **Nghiệp vụ Mầm non sát thực tế Việt Nam**:
  - Hỗ trợ đầy đủ 6 nhóm tuổi từ **Nhà trẻ (`6–12 tháng`, `1–2 tuổi`, `2–3 tuổi`)** đến **Mẫu giáo (`3–4`, `4–5`, `5–6 tuổi`)**.
  - Hồ sơ trẻ toàn diện: Mã định danh, Thẻ BHYT, Nhóm máu, Lịch sử tiêm chủng, Biểu đồ cân nặng/chiều cao theo tháng, Dị ứng thực phẩm, Bệnh lý nền và thông tin **2 Phụ huynh** (tự động cấp tài khoản Phụ huynh theo SĐT và gom anh/chị/em ruột chung 1 tài khoản).
  - Nhập danh sách học sinh bằng Excel 24 cột (hỗ trợ cả **Đẩy tổng toàn trường tự chia lớp** cho Hiệu trưởng/Giáo vụ lẫn **Đẩy riêng từng lớp** cho Giáo viên chủ nhiệm).
  - Điểm danh Web / Máy nhận diện Hikvision ISAPI, Đón trả trẻ 1 chạm tại lớp, Quét mã QR cổng bảo vệ và **Hoàn tác trả trẻ nhầm** trong ngày.
  - Thực đơn tuần theo lớp đối chiếu tự động dị ứng thực phẩm của trẻ, Kho bếp FEFO, Kiểm thực 3 bước & Lưu mẫu thức ăn 24h.
  - Học phí tự động khấu trừ tiền ăn những ngày nghỉ có phép tháng trước, Sổ quỹ tiền mặt, Chi vận hành, Mua sắm – Tài sản và Khóa kỳ kế toán ACID Transaction.
- **Bảo mật Public Internet & Chống Bot Quét**:
  - Tích hợp `botScannerShield` chặn sớm (`O(1)`) các công cụ dò quét lỗ hổng (`sqlmap`, `nuclei`, `nikto`, `/.env`, `*.php`, `/wp-admin`, Path Traversal) và tự động tạm khóa IP quét hàng loạt.
  - Sanitizer chống NoSQL Operator Injection (`$gt`, `$ne`, `$where`) & Prototype Pollution toàn cục, kết hợp Honeypot ẩn chống bot điền form và Rate-Limiting đa tầng.

---

## 2. Khởi chạy Nhanh (Cổng mặc định `5001`)

### Cách 1: Chạy bằng Docker Compose (Khuyến nghị Production)
```bash
docker compose up -d --build
```
- Mở trình duyệt tại: **`http://localhost:5001`**
- Tài liệu API & Database (Swagger UI): **`http://localhost:5001/api-docs`**

### Cách 2: Chạy trực tiếp bằng Node.js
```bash
# Cài đặt thư viện cho cả Backend & Frontend
npm run install:all

# Đóng gói giao diện Production và khởi chạy hợp nhất trên cổng 5001
npm run start:prod
```
*(Chế độ phát triển tách rời Hot-Reload: chạy `npm run dev:backend` tại cổng `5001` và `npm run dev:frontend` tại cổng `5173`.)*

---

## 3. Đăng nhập Lần đầu (1 Màn hình Hợp nhất)

| Phạm vi đăng nhập | Ô Mã trường (`School Code`) | Tài khoản mặc định | Mật khẩu mặc định | Màn hình đích |
| :--- | :--- | :--- | :--- | :--- |
| **Admin Tổng (Đa Trường)** | *(Để trống)* | `admin` | `123456` | `/multi-school` (Tạo trường mới & cấp Account riêng) |
| **Nhân sự từng Trường** | Nhập mã trường *(VD: `HOANANG-A`)* | Tài khoản của trường | Do Admin cấp | `/dashboard`, `/principal`, `/accounting`, `/kitchen`, `/guard`, `/hr` |
| **Phụ huynh học sinh** | Nhập mã trường *(VD: `HOANANG-A`)* | Số điện thoại Phụ huynh | `123456` *(lần đầu)* | `/parent-portal` |

---

## 4. Danh mục Tài liệu Kỹ thuật

- 📐 **[Tài liệu Phân tích & Thiết kế Hệ thống](docs/PHAN_TICH_THIET_KE_HE_THONG.md)**: Kiến trúc tổng thể, ma trận 9 vai trò, ERD 7 phân vùng Database, quy trình nghiệp vụ Mầm non, thiết kế bảo mật chống Bot quét và quy chuẩn đặt tên file.
- 📘 **[Hướng dẫn Swagger OpenAPI & Từ điển Database](backend/docs/SWAGGER_DATABASE_GUIDE.md)**: Tra cứu API trực tuyến (`/api-docs`), xuất JSON cho Postman (`/api-docs.json`) và API từ điển 74+ bảng (`/api/docs/database`).
- 🐳 **[Hướng dẫn Triển khai Docker & Sao lưu Dữ liệu](DOCKER.md)**: Vận hành container, cấu hình `.env`, backup & restore MongoDB Replica Set.
- 📏 **[Quy chuẩn Phát triển Dự án (Coding Rules)](AGENTS.md)**: Nguyên tắc kiến trúc phân tầng, tối ưu truy vấn MongoDB, Clean Code và JSDoc tiếng Việt.

