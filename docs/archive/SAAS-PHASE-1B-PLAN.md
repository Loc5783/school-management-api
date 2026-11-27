# SaaS 1B: cách ly luồng đọc học sinh và lớp học

Trạng thái: Đã hoàn thành / Đã nghiệm thu (Completed / Accepted). Codex điều phối; Antigravity hoàn tất code, test và review độc lập (Final Independent Review PASS). Không tự triển khai 1C, 1D, 1E.

## Phạm vi và hợp đồng

- Token SaaS hợp lệ chỉ đọc bản ghi thuộc `req.tenantId` được xác minh từ user và tenant; không tin header hoặc query do client đưa.
- Legacy chỉ đọc bản ghi không có `tenantId`; endpoint đăng ký công khai cũng chỉ thấy lớp legacy.
- ID của trường khác trả 404; bộ lọc danh sách chéo trường trả danh sách rỗng với `total = 0`. Vai trò teacher/parent tiếp tục bị giới hạn trong tenant của mình.
- Tất cả thao tác ghi SaaS và các phân hệ sau 1B tiếp tục đóng. Không đổi dữ liệu thật, chạy migration hoặc sync index thật.

## Danh sách việc theo thứ tự

1. **1B.1 — Nền dữ liệu và cổng public legacy.** `[ĐÃ HOÀN THÀNH]`
   - Bổ sung `tenantId` (optional) vào `Student`, `Classroom`, `StudentTransferHistory`; không thay unique index hiện có. Khóa lớp SaaS khỏi danh sách lớp công khai `/auth/registration-classrooms` (`tenantId: null`) và từ chối `requestedClassroomId` của SaaS khi đăng ký legacy (HTTP 400).
   - Bằng chứng: Test suite `backend/tests/saas/phase1b1_boundary.test.js` đạt 100% (khớp cả hai dạng legacy `missing` và `tenantId: null`).
2. **1B.2 — Quy tắc quyền đọc.** `[ĐÃ HOÀN THÀNH]`
   - Xây dựng cơ chế tạo tenant filter duy nhất qua `tenantFilterService.js` cho SaaS (`req.tenantId`) và legacy (`tenantId: null`), loại bỏ hoàn toàn can thiệp từ client header `X-Tenant-Id` và query `tenantId`; tích hợp tiền kiểm tra vào `schoolDataAccessService.js` và `studentAccessService.js`.
   - Bằng chứng: Test suite `backend/tests/saas/phase1b2_tenant_rules.test.js` đạt 100%.
3. **1B.3 — Controller đọc.** `[ĐÃ HOÀN THÀNH]`
   - Áp dụng tenant filter vào `studentController.js` và `classroomController.js` cho danh sách, đếm/phân trang, tìm kiếm trùng tên, chi tiết (ID ngoại lai trả HTTP 404), sổ chăm sóc (`daily-reports`), lịch sử chuyển lớp (`transfer-history`), và trả mảng rỗng `total = 0` khi lọc `classroomId` chéo trường.
   - Bằng chứng: Test suite `backend/tests/saas/phase1b3_read_scoping.test.js` đạt 100%.
4. **1B.4 — Router SaaS.** `[ĐÃ HOÀN THÀNH]`
   - Cấu hình `schoolStudentRoutes.js`, `schoolClassroomRoutes.js`, mount qua `createSaasApp.js` tại `/api/v1` và `/api` với `schoolAuthMiddleware.js`. Ngăn ngừa parameter shadowing qua `reservedRoutes.js`. Giữ fail-closed (HTTP 501 / 403) cho mọi phương thức ghi và module ngoài 1B. Kiểm tra token purpose, phiên bị thu hồi (`RevokedSession`), và tenant `suspended`.
   - Bằng chứng: Test suite `backend/tests/saas/phase1b4_router.test.js` đạt 100%.
5. **1B.5 — Nghiệm thu tích hợp và review.** `[ĐÃ HOÀN THÀNH]`
   - Nghiệm thu tích hợp đa trường (Tenant A, Tenant B, Legacy) với 100% test Supertest HTTP thực tế trong `phase1b5_integration_acceptance.test.js`.
   - Bằng chứng kiểm thử và review:
     - **Backend Suite**: `npm --prefix backend test` -> **Exit code 0**, **12 / 12 test suites passed**, **313 / 313 tests passed** (84.963s).
     - **Frontend Build**: `npm --prefix frontend run build` -> **Exit code 0**, Vite build production thành công sạch sẽ.
     - **Final Independent Review**: Thẩm định độc lập chỉ đọc đạt **VERDICT: PASS** (ghi nhận tại `C:\Users\PhamDinhDong\Documents\Codex\2026-10-30\578\work\saas1b-final-review-result.json` và artifact `phase_1b_read_only_review.md`).

## Ghi chú giới hạn và việc tách riêng để quyết định sau

- **Môi trường kiểm thử giả lập (MongoMemoryReplSet only)**: Toàn bộ quá trình kiểm thử và nghiệm thu 1B được thực hiện trên `MongoMemoryReplSet` trong bộ nhớ ảo; không tác động, không kết nối cơ sở dữ liệu thật, không chạy migration dữ liệu thật và không triển khai (no real DB / migration / deployment).
- **Tách riêng thiết kế chỉ mục toàn cục (Global unique index design remains separate)**: Chỉ mục unique `studentCode` và phân công giáo viên chủ nhiệm (`homeroomTeacherId`) hiện có là global. Thiết kế compound/partial index và kế hoạch chuyển dữ liệu được tách riêng để đánh giá trước các giai đoạn tiếp theo; tuyệt đối không tự ý chạy `syncIndexes` hoặc migration trên database thật trong 1B.
- **Bảo toàn công việc dở dang không liên quan**: Các thay đổi giao diện chưa commit (`frontend/src/index.css`) và file untracked được bảo toàn nguyên trạng theo quy định tại `AGENTS.md`.
- **Bản báo cáo 1A**: Đã được người dùng xác nhận hoàn thành, giữ nguyên phạm vi đã chốt.

## Kết luận bàn giao

Giai đoạn SaaS 1B đã hoàn thành toàn bộ mục tiêu cách ly luồng đọc, bảo đảm an ninh đa trường học, vượt qua toàn bộ 313 bài test backend, build frontend thành công và đạt kết quả PASS trong đợt thẩm định độc lập. Sẵn sàng bàn giao và chờ chỉ thị cho giai đoạn tiếp theo.
