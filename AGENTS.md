# Quy chuẩn Phát triển Dự án (Project Coding Rules)

Mọi thay đổi, bổ sung tính năng, sửa lỗi và tái cấu trúc trong dự án `school-management-api` bắt buộc phải tuân thủ nghiêm ngặt 4 nguyên tắc cốt lõi dưới đây.

---

## 1. Code đúng Kiến trúc (Architecture Compliance)

### Backend (`backend/src/`)
- **Phân tầng rõ ràng, đúng trách nhiệm**:
  - `routes/` (`backend/src/routes/` & `backend/src/saas/routes/`): Chỉ khai báo đường dẫn, gắn middleware xác thực/phân quyền/rate-limit và trỏ tới controller. Không viết logic nghiệp vụ hoặc truy vấn DB trong route.
  - `middlewares/`: Xử lý xác thực JWT, kiểm tra ngữ cảnh trường (`tenantId`), phân quyền theo vai trò (`admin`, `principal`, `teacher`, `accountant`, `chef`, `guard`, `hr`, `parent`), kiểm tra khóa kỳ kế toán và kiểm duyệt đầu vào chung.
  - `controllers/`: Tiếp nhận HTTP request, kiểm tra tính hợp lệ của dữ liệu đầu vào (`req.params`, `req.query`, `req.body`), gọi tầng `services` xử lý và trả HTTP response nhất quán.
  - `services/`: Chứa toàn bộ logic nghiệp vụ cốt lõi, tính toán chuyên môn, điều phối giao dịch nhiều bảng (transactions) để tái sử dụng giữa nhiều controller/scheduler.
  - `models/`: Đặt đúng phân vùng dữ liệu (`zone1_system`, `zone2_hr`, `zone3_school`, `zone4_finance`, `zone5_nutrition`, `zone6_procurement`, `zone7_reporting`).
  - `utils/`: Đặt các hàm tiện ích thuần túy (pure helpers), định dạng ngày giờ, mã hóa, xử lý chuỗi/số dùng chung.
- **Chuẩn SaaS Multi-Tenant bắt buộc**:
  - Mọi truy vấn đọc/ghi (`find`, `findOne`, `create`, `update*`, `delete*`, `aggregate`) trên dữ liệu nghiệp vụ của trường **bắt buộc phải lọc theo `tenantId`** lấy từ ngữ cảnh xác thực (`req.user` / `req.tenant`), tuyệt đối không tin tưởng `tenantId` gửi thô từ client nếu chưa đối chiếu quyền.
  - Tuân thủ các compound unique index dạng `{ tenantId: 1, <field>: 1 }` để đảm bảo cách ly dữ liệu tuyệt đối giữa các cơ sở trường học.

### Frontend (`frontend/src/`)
- **Tách biệt giao diện và dữ liệu**:
  - `api/`: Tập trung toàn bộ lời gọi HTTP qua `axiosConfig.js` theo từng phân hệ; không gọi `axios`/`fetch` rời rạc trực tiếp trong JSX nếu có thể gom về module API.
  - `pages/`: Quản lý bố cục màn hình cấp trang và luồng điều hướng theo vai trò người dùng.
  - `components/`: Thiết kế các thành phần giao diện nhỏ gọn, độc lập, tái sử dụng cao, nhận dữ liệu rõ ràng qua `props`.
  - `utils/` & `styles/`: Tách riêng hàm định dạng dữ liệu hiển thị và kiểu dáng dùng chung.

---

## 2. Tối ưu hóa Hiệu năng (Optimization & Scalability)

- **Tối ưu truy vấn MongoDB / Mongoose**:
  - Loại bỏ triệt để lỗi truy vấn lặp **`N+1`** trong vòng lặp; ưu tiên gom truy vấn bằng `$in`, `bulkWrite`, `aggregate` hoặc chạy song song các tác vụ độc lập bằng `Promise.all`.
  - Sử dụng `.lean()` cho các truy vấn chỉ đọc để giảm chi phí khởi tạo Mongoose Document và tiết kiệm bộ nhớ.
  - Sử dụng `.select()` để chỉ lấy các trường thực sự cần thiết; tuyệt đối không trả về các trường nhạy cảm (`passwordHash`, secret, token nội bộ).
  - Bắt buộc áp dụng phân trang (`page`, `limit`) và giới hạn kích thước trang tối đa cho các API danh sách có dữ liệu tăng trưởng theo thời gian (học sinh, điểm danh, chấm công, hóa đơn, nhật ký).
  - Đặt điều kiện lọc bám sát thứ tự các trường trong index (luôn đưa `tenantId` lên đầu trên các bảng multi-tenant).
- **An toàn giao dịch & tài nguyên**:
  - Với các nghiệp vụ ghi liên hoàn (thu chi học phí, khóa sổ kế toán, duyệt lương, nhập liệu hàng loạt), sử dụng MongoDB Transaction (`startSession` / `withTransaction`) và luôn đóng `session.endSession()` trong khối `finally`.
- **Tối ưu Frontend**:
  - Tránh tính toán nặng hoặc tạo lại object/hàm không cần thiết gây re-render dây chuyền; giữ state gần nơi sử dụng nhất.
  - Luôn xử lý trọn vẹn các trạng thái tải dữ liệu (`loading`, `empty`, `error`) và vô hiệu hóa nút bấm khi đang gửi biểu mẫu (`submitting`) để chống gửi trùng request.

---

## 3. Code Sạch & Bền vững (Clean Code)

- **Đặt tên tường minh, nhất quán**:
  - `camelCase` cho biến, hàm, thuộc tính JSON; `PascalCase` cho React Component và Mongoose Model; `UPPER_SNAKE_CASE` cho hằng số cấu hình/trạng thái.
  - Tên hàm thể hiện rõ hành động (`calculateMonthlyTuition`, `verifyTenantAccess`), tên biến boolean có tiền tố rõ nghĩa (`isActive`, `hasPermission`, `canApprove`).
- **Nguyên tắc Đơn trách nhiệm (SRP) & DRY**:
  - Mỗi hàm và mỗi module chỉ đảm nhận một nhiệm vụ rõ ràng; tách nhỏ các hàm quá dài thành các bước con có tên gọi tự giải thích.
  - Áp dụng **Early Return (Guard Clauses)** để kiểm tra điều kiện lỗi ngay đầu hàm, tránh lồng ghép `if/else` nhiều tầng gây khó đọc.
  - Không dùng *magic numbers* hay *magic strings* rải rác; khai báo thành hằng số dùng chung ở đầu module hoặc trong file constants.
- **Xử lý lỗi chuẩn mực & An toàn**:
  - Không bao giờ để khối `catch` rỗng nuốt lỗi âm thầm.
  - Trả về mã trạng thái HTTP đúng bản chất (`400`/`422` dữ liệu sai, `401` chưa xác thực, `403` không đủ quyền, `404` không tìm thấy, `409` xung đột dữ liệu, `500` lỗi hệ thống) kèm thông báo tiếng Việt rõ ràng cho người dùng và không làm lộ chi tiết hạ tầng nhạy cảm.
  - Bảo toàn tính tương thích ngược với các luồng đang hoạt động ổn định; dọn sạch biến thừa, import thừa và `console.log` debug tạm thời trước khi hoàn tất.

---

## 4. Ghi chú Rõ ràng cho Lập trình viên Kế thừa (Developer Handover & Comments)

Mọi đoạn mã viết mới hoặc chỉnh sửa phải giúp lập trình viên khác đọc vào hiểu ngay ngữ cảnh và phát triển tiếp thuận lợi:

- **Ngôn ngữ & Trọng tâm ghi chú**:
  - Viết ghi chú bằng **tiếng Việt mạch lạc, ngắn gọn, chính xác**.
  - Tập trung giải thích **"Tại sao làm vậy (Why)"**, **quy tắc nghiệp vụ đặc thù** (quy định điểm danh/đón trả trẻ, công thức tính học phí/hoàn phí, định mức dinh dưỡng, quy tắc khóa kỳ kế toán, cách ly multi-tenant) và **các trường hợp biên (edge cases)** — không viết comment lặp lại cú pháp hiển nhiên.
- **Chuẩn JSDoc cho các hàm và module quan trọng**:
  - Ở đầu mỗi file mới và trên các hàm tại `services/`, `middlewares/`, `utils/` hoặc `controllers/` phức tạp, bổ sung khối chú thích mô tả ngắn gọn:
    - Mục đích của file / hàm.
    - Tham số đầu vào quan trọng (`@param`), đặc biệt là yêu cầu về `tenantId`, `user`, `session`.
    - Giá trị trả về (`@returns`) và các ngoại lệ/lỗi nghiệp vụ có thể phát sinh.
- **Đánh dấu điểm mở rộng & lưu ý bảo trì**:
  - Với các thuật toán nhiều bước, đánh số thứ tự các bước chính (`// Bước 1: ...`, `// Bước 2: ...`) để người đọc nắm nhanh luồng chạy.
  - Sử dụng nhãn chuẩn khi cần lưu ý cho người phát triển tiếp theo:
    - `// NOTE:` Giải thích ràng buộc kiến trúc/nghiệp vụ quan trọng không được tự ý bỏ qua.
    - `// TODO:` Đánh dấu rõ phần chờ mở rộng ở giai đoạn tiếp theo kèm điều kiện thực hiện.
