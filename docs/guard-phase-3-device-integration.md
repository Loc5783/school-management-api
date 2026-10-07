# Tích hợp thiết bị cổng trường (giai đoạn 3)

Hiện chưa có thiết bị thực. Mục **Trực cổng trường → Thiết bị cổng** cho phép quản trị viên đăng ký thiết bị và cấp khóa kết nối một lần. Bảo vệ xem nhật ký nhận diện, ảnh tham chiếu, cảnh báo và đối chiếu trực tiếp. Các sự kiện từ thiết bị không tự điểm danh, xác nhận người đón hoặc mở cổng.

## Khi lắp đặt thiết bị

1. Xác định model và cách lấy kết quả từ camera/đầu đọc (HTTP callback, SDK hoặc phần mềm trung gian). Nếu camera chỉ xuất RTSP, cần phần mềm trung gian chuyển kết quả nhận diện hoặc ảnh snapshot qua HTTPS; trình duyệt không phát RTSP trực tiếp.
2. Quản trị viên đăng ký từng thiết bị đúng loại và vị trí. Lưu `ID thiết bị` cùng khóa 64 ký tự được hiển thị một lần. Khóa được lưu trong cơ sở dữ liệu dưới dạng SHA-256, có thể tạo khóa mới để vô hiệu hóa khóa cũ.
3. Phần mềm trung gian gọi `POST /api/guard-device/{ID thiết bị}/events` với header `X-Device-Api-Key: {khóa}` và JSON. `externalEventId` phải duy nhất đối với mỗi thiết bị; gửi lại cùng mã không tạo bản ghi trùng. Đồng hồ thiết bị phải đồng bộ; `occurredAt` chỉ nhận sự kiện trong 24 giờ gần đây.

Ví dụ một lần đọc biển số:

```json
{
  "externalEventId": "anpr-20261007-0001",
  "eventType": "plate",
  "identifier": "29A-12345",
  "confidence": 0.94,
  "occurredAt": "2026-10-07T08:00:00+07:00",
  "snapshotUrl": "https://example.edu.vn/camera/event-0001.jpg"
}
```

Loại thiết bị và sự kiện tương ứng:

| Loại thiết bị | `eventType` | `identifier` |
|---|---|---|
| `plate_reader` | `plate` | Biển số nhận diện |
| `face_reader` | `face` | Mã hồ sơ khuôn mặt do hệ thống nhận diện trả về; không gửi ảnh hoặc vector khuôn mặt vào mã này |
| `rfid_reader` | `card` | Mã thẻ học sinh |
| `camera` | `behavior` | Để trống hoặc mã sự kiện của nhà sản xuất; mô tả ở `description` |
| `gate_controller` | `gate_state` | Trạng thái cổng do thiết bị báo |

Ảnh tham chiếu là liên kết HTTPS, không chứa thông tin đăng nhập trong URL. Khóa kết nối chỉ dùng ở thiết bị/phần mềm trung gian, không đưa vào frontend. Hệ thống chỉ lưu mã hồ sơ khuôn mặt và kết quả nhận diện, không lưu mẫu sinh trắc học thô.

## Quy tắc hiện tại

- Biển số được đối chiếu với lịch đón trẻ trong ngày. Trùng biển số vẫn phải kiểm tra đúng người đón và lịch đón; biển số không có trong lịch sẽ báo bảo vệ.
- Mã khuôn mặt và mã thẻ được đối chiếu với hồ sơ học sinh đang theo học. Kết quả nhận diện chỉ tạo gợi ý kiểm tra.
- Độ tin cậy dưới 85% yêu cầu kiểm tra thủ công. Sự kiện hành vi bất thường tạo cảnh báo cho bảo vệ và quản lý.
- Bộ điều khiển cổng mới chỉ báo trạng thái. Lệnh mở cổng cần adapter riêng theo model thực tế, kiểm tra liên động và nghiệm thu tại hiện trường. Không dùng một kết quả nhận diện đơn lẻ để mở cổng.

Khi có model cụ thể, cần nối SDK/webhook của nhà sản xuất, cấu hình camera HTTPS hoặc gateway RTSP, kiểm tra thực tế các trường hợp trẻ chưa có lịch đón, nhận diện sai, mất mạng và cổng không phản hồi.
