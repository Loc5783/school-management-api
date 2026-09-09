# Migration Student Core

Migration này chuẩn hóa `studentCode`, `admissionDate` và `status` cho hồ sơ học sinh cũ. Mã mới có dạng `HS-YYYY-000001`; sequence được tiếp tục từ mã lớn nhất đã có của từng năm.

## Quy trình triển khai an toàn

1. Dừng API ghi hồ sơ học sinh hoặc đặt hệ thống vào maintenance window.
2. Sao lưu MongoDB trước khi chạy. Ví dụ: `mongodump --uri="$MONGODB_URI" --db school_management --out backup-before-student-core`.
3. Chạy precheck: `npm run migrate:student-core:dry-run`.
4. Nếu báo mã trùng/sai định dạng, xử lý dữ liệu đó trước; script sẽ không ghi khi precheck không đạt.
5. Chạy migration: `npm run migrate:student-core`.
6. Xác minh: `npm run migrate:student-core:verify`.
7. Khởi động lại API và theo dõi lỗi duplicate key.

Script không gọi `syncIndexes`, nên không xóa hoặc thay đổi index ngoài phạm vi Student. Sau khi toàn bộ hồ sơ có mã hợp lệ, script chỉ tạo unique index `studentCode_1`.

## Rollback

Không chạy rollback tự động vì khôi phục nhầm có thể làm mất dữ liệu phát sinh sau migration. Nếu cần quay lui, dừng API ghi và khôi phục collection `students` cùng `studentcodecounters` từ backup ở bước 2, sau đó chạy verify lại. Không xóa bản ghi trùng tự động; cần người quản trị quyết định hồ sơ hợp lệ.
