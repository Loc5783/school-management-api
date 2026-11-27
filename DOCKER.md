# Hướng dẫn Vận hành Dự án bằng Docker (`school-management-api`)

Tài liệu hướng dẫn khởi chạy trọn bộ hệ thống **Quản lý Trường Mầm non Đa cơ sở (SaaS Multi-Tenant)** bằng Docker Compose.

---

## 1. Kiến trúc Hợp nhất (Chạy Backend là chạy luôn cả Frontend!)

Hệ thống đã được đóng gói theo mô hình **Unified Full-Stack Production**: bản build tĩnh của Frontend (`frontend/dist`) được nhúng trực tiếp và phục vụ ngay bên trong máy chủ Express của `backend`.

| Dịch vụ | Container | Image / Công nghệ | Cổng mặc định | Vai trò |
| :--- | :--- | :--- | :--- | :--- |
| **`backend`** | `school-backend` | `node:22-alpine` (nhúng sẵn React 19 Production + Express 5) | `http://localhost:5001` | **Chạy cả Giao diện Web SPA lẫn toàn bộ API `/api/*`** trên duy nhất 1 cổng (`5001`) |
| **`mongodb`** | `school-mongodb` | `mongo:7.0` (Replica Set `rs0`) | `127.0.0.1:27019` | Lưu trữ dữ liệu bền vững và hỗ trợ ACID Transaction đa bảng (tránh đụng cổng `27017` trên Windows) |

### Dữ liệu bền vững (Named Volumes)
- `mongo_data`: Lưu toàn bộ dữ liệu MongoDB qua các lần khởi động lại container.
- `backend_uploads`: Lưu tệp minh chứng bằng cấp/chứng chỉ nhân sự (`/app/uploads/credentials`).

---

## 2. Khởi chạy Nhanh (Chế độ Chuẩn / Production)

1. **Cấu hình môi trường:** Tập trung gọn gàng theo đúng phân hệ (không để file `.env` ở ngoài thư mục gốc):
   - Backend: `backend/.env` *(mẫu tại `backend/.env.example`)*
   - Frontend: `frontend/.env` *(mẫu tại `frontend/.env.example`)*
2. **Mở Docker Desktop** trên máy tính (hoặc chạy `docker desktop start`).
3. Tại thư mục gốc của dự án, build và khởi chạy toàn bộ hệ thống chạy ngầm:

```bash
docker compose up -d --build
```

4. Theo dõi nhật ký khởi tạo lần đầu:

```bash
docker compose logs -f backend
```

> **Lưu ý khởi tạo tự động lần đầu:**
> Khi triển khai lên môi trường mới mà `mongodb` chưa có tài khoản `admin`, `backend` sẽ tự động:
> - Đồng bộ đầy đủ **23 nhóm Multi-Tenant Compound Unique Indexes** (`{ tenantId: 1, <field>: 1 }`).
> - Tự động khởi tạo trường mặc định (`HOANANG-A`), danh mục quyền hệ thống và **tài khoản Quản trị viên mặc định (`admin` / `123456`)** (không chèn dữ liệu rác giả lập).
> - Ở các lần khởi động tiếp theo, khi DB đã có tài khoản `admin`, hệ thống sẽ giữ nguyên 100% tài khoản và mật khẩu hiện có.

---

## 3. Truy cập & Đăng nhập Mặc định

- **Giao diện Web & API hợp nhất:** Mở trình duyệt tại **`http://localhost:5001`**
- **Kiểm tra sức khỏe API:** `http://localhost:5001/api/health`

> **Mẹo chạy không cần Docker (trực tiếp trên máy / VPS):**
> Tại thư mục `backend` (hoặc thư mục gốc), chỉ cần chạy:
> ```bash
> cd backend
> npm run start:prod
> ```
> Lệnh này sẽ tự build Frontend ra Production (`frontend/dist`) rồi chạy `node server.js` — mở `http://localhost:5001` là dùng được ngay cả Frontend lẫn Backend!

### Tài khoản Admin Tổng Đa Trường được tạo tự động khi DB trống
- **Mã trường (School Code):** *(Để trống hoàn toàn)*
- **Tài khoản:** `admin`
- **Mật khẩu:** `123456`
- Sau khi đăng nhập sẽ vào thẳng **Trung tâm Điều hành Hệ thống Đa Trường (`/multi-school`)** để Admin Tổng chủ động tạo từng trường học thực tế và cấp tài khoản Admin riêng cho từng trường.

*(Tùy chọn: Nếu muốn nạp thêm bộ dữ liệu mẫu đầy đủ gồm 2 cơ sở `HOANANG-A`, `HOANANG-B` và đầy đủ 8 vai trò nhân sự/phụ huynh/học sinh để thử nghiệm, chạy lệnh `docker compose exec backend npm run seed:demo` hoặc đặt `AUTO_SEED_ON_EMPTY_DB=true` trong `backend/.env`.)*

---

## 4. Các Lệnh Quản trị Thường dùng

- **Xem trạng thái các container:**
  ```bash
  docker compose ps
  ```
- **Dừng hệ thống (giữ nguyên dữ liệu DB & Uploads):**
  ```bash
  docker compose down
  ```
- **Chạy lại dữ liệu mẫu thủ công bất kỳ lúc nào:**
  ```bash
  docker compose exec backend npm run seed:demo
  ```
- **Kết nối MongoDB Compass từ máy Windows:**
  Dùng chuỗi kết nối:
  ```text
  mongodb://127.0.0.1:27019/school_management?directConnection=true
  ```
- **Sao lưu (Backup) Database ra máy ngoài:**
  ```bash
  docker compose exec mongodb mongodump --db school_management --archive > backup_school_management.archive
  ```
- **Khôi phục (Restore) Database từ file archive:**
  *(Mẹo: Đặt `AUTO_SEED_ON_EMPTY_DB=false` trong `backend/.env` nếu muốn khôi phục vào DB trắng)*
  ```bash
  docker compose exec -T mongodb mongorestore --archive --drop < backup_school_management.archive
  ```
- **Xóa sạch toàn bộ container VÀ dữ liệu (Reset từ đầu):**
  ```bash
  docker compose down -v
  ```
