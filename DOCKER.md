# Hướng dẫn Vận hành Dự án bằng Docker (`school-management-api`)

Tài liệu hướng dẫn khởi chạy trọn bộ hệ thống **Quản lý Trường Mầm non Đa cơ sở (SaaS Multi-Tenant)** bằng Docker Compose.

---

## 1. Kiến trúc các Container

| Dịch vụ | Container | Image / Công nghệ | Cổng mặc định | Vai trò |
| :--- | :--- | :--- | :--- | :--- |
| **`frontend`** | `school-frontend` | `nginx:1.27-alpine` + React 19 / Vite 8 | `http://localhost:5173` | Phục vụ giao diện SPA và chuyển tiếp (Reverse Proxy) `/api/*` sang Backend |
| **`backend`** | `school-backend` | `node:22-alpine` + Express 5 / Mongoose 9 | `http://localhost:5000` | Xử lý API nghiệp vụ đa trường (`phase1e`) & nhận Webhook máy chấm công LAN |
| **`mongodb`** | `school-mongodb` | `mongo:7.0` (Replica Set `rs0`) | `127.0.0.1:27017` | Lưu trữ dữ liệu bền vững và hỗ trợ ACID Transaction đa bảng |

### Dữ liệu bền vững (Named Volumes)
- `mongo_data`: Lưu toàn bộ dữ liệu MongoDB qua các lần khởi động lại container.
- `backend_uploads`: Lưu tệp minh chứng bằng cấp/chứng chỉ nhân sự (`/app/uploads/credentials`).

---

## 2. Khởi chạy Nhanh (Chế độ Chuẩn / Production)

1. **Mở Docker Desktop** trên máy tính và đợi Engine sẵn sàng.
2. Tại thư mục gốc của dự án, kiểm tra tệp `.env` (đã được tạo sẵn từ `.env.docker.example`; nếu triển khai máy chủ thật, hãy đổi `JWT_SECRET`).
3. Build và khởi chạy toàn bộ hệ thống chạy ngầm:

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

- **Giao diện Web:** Mở trình duyệt tại `http://localhost:5173`
- **Kiểm tra sức khỏe API:** `http://localhost:5000/api/health` (hoặc `http://localhost:5173/api/health`)

### Tài khoản Admin được tạo tự động khi DB trống
- **Mã trường (School Code):** `HOANANG-A` *(đã được điền sẵn trên màn hình đăng nhập)*
- **Tài khoản:** `admin`
- **Mật khẩu:** `123456`

*(Tùy chọn: Nếu muốn nạp thêm bộ dữ liệu mẫu đầy đủ gồm 2 cơ sở `HOANANG-A`, `HOANANG-B` và đầy đủ 8 vai trò nhân sự/phụ huynh/học sinh để thử nghiệm, chạy lệnh `docker compose exec backend npm run seed:demo` hoặc đặt `AUTO_SEED_ON_EMPTY_DB=true` trong `.env`.)*

---

## 4. Chế độ Phát triển (Hot-Reload khi sửa code)

Nếu bạn muốn vừa sửa mã nguồn ở `backend/src` hoặc `frontend/src` vừa tự động nạp lại ngay trong container mà không cần build lại image:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

---

## 5. Các Lệnh Quản trị Thường dùng

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
  mongodb://127.0.0.1:27017/school_management?directConnection=true
  ```
- **Sao lưu (Backup) Database ra máy ngoài:**
  ```bash
  docker compose exec mongodb mongodump --db school_management --archive > backup_school_management.archive
  ```
- **Khôi phục (Restore) Database từ file archive:**
  *(Mẹo: Đặt `AUTO_SEED_ON_EMPTY_DB=false` trong `.env` nếu muốn khôi phục vào DB trắng)*
  ```bash
  docker compose exec -T mongodb mongorestore --archive --drop < backup_school_management.archive
  ```
- **Xóa sạch toàn bộ container VÀ dữ liệu (Reset từ đầu):**
  ```bash
  docker compose down -v
  ```
